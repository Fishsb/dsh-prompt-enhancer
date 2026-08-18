'use strict';
// ============================================================================
// scripts/build-icon.cjs — 多尺寸 ICO 打包（BITMAPINFOHEADER 格式）
//
// 读 assets/ico-{16,32,48,64}.png → 纯 PNG 解码 → RGBA → ICO 编码 → 写
// assets/deepseek.ico + 生成 lib/shortcut-icon.cjs（base64 内嵌）。
//
// 布局（MS-ICON）：ICONDIR + ICONDIRENTRY×N + IMAGE DATA×N
//   —— 所有 entry 在前、所有数据在后（曾写成交替导致 .ico 损坏 Shell 白纸）
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZES = [16, 32, 48, 64];
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const OUTPUT_ICO = path.join(ASSETS_DIR, 'deepseek.ico');
const OUTPUT_MODULE = path.join(__dirname, '..', 'lib', 'shortcut-icon.cjs');

// ---------------------------------------------------------------------------
// PNG 解码（纯手写）：支持 color type 6 (RGBA) / 2 (RGB)
// ---------------------------------------------------------------------------

function decodePNG(buf) {
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
    throw new Error('not a PNG file');
  }
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idatChunks = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 8 + len + 4;
  }
  if (colorType !== 6 && colorType !== 2) throw new Error('unsupported color type ' + colorType);
  if (bitDepth !== 8) throw new Error('unsupported depth ' + bitDepth);
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  let prevRow = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[x - channels] : 0;
      const up = prevRow[x];
      const upLeft = x >= channels ? prevRow[x - channels] : 0;
      let val;
      switch (filter) {
        case 0: val = row[x]; break;
        case 1: val = (row[x] + left) & 0xff; break;
        case 2: val = (row[x] + up) & 0xff; break;
        case 3: val = (row[x] + ((left + up) >> 1)) & 0xff; break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
          let pr;
          if (pa <= pb && pa <= pc) pr = left;
          else if (pb <= pc) pr = up;
          else pr = upLeft;
          val = (row[x] + pr) & 0xff;
          break;
        }
        default: throw new Error('unsupported filter ' + filter + ' at row ' + y);
      }
      out[x] = val;
    }
    const dst = y * width * 4;
    if (channels === 4) out.copy(pixels, dst);
    else {
      for (let x = 0; x < width; x++) {
        pixels[dst + x * 4] = out[x * 3];
        pixels[dst + x * 4 + 1] = out[x * 3 + 1];
        pixels[dst + x * 4 + 2] = out[x * 3 + 2];
        pixels[dst + x * 4 + 3] = 255;
      }
    }
    prevRow = out;
  }
  return { width, height, pixels };
}

// ---------------------------------------------------------------------------
// RGBA → ICO BITMAPINFOHEADER（XOR=BGRA32 bottom-up + AND=1bit, biHeight=×2）
// ---------------------------------------------------------------------------

function encodeICOBMP(width, height, rgba) {
  const xorStride = width * 4;
  const xorSize = xorStride * height;
  const xor = Buffer.alloc(xorSize);
  for (let y = 0; y < height; y++) {
    const srcRow = y * width * 4;
    const dstRow = (height - 1 - y) * xorStride;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4, d = dstRow + x * 4;
      xor[d] = rgba[s + 2]; xor[d + 1] = rgba[s + 1]; xor[d + 2] = rgba[s]; xor[d + 3] = rgba[s + 3];
    }
  }
  const andStride = Math.ceil(width / 8);
  const andStrideAligned = (andStride + 3) & ~3;
  const andSize = andStrideAligned * height;
  const and = Buffer.alloc(andSize);
  for (let y = 0; y < height; y++) {
    const srcRow = y * width * 4;
    const dstRow = (height - 1 - y) * andStrideAligned;
    for (let x = 0; x < width; x++) {
      if (rgba[srcRow + x * 4 + 3] < 128) and[dstRow + (x >> 3)] |= (1 << (7 - (x & 7)));
    }
  }
  const bih = Buffer.alloc(40);
  bih.writeUInt32LE(40, 0); bih.writeInt32LE(width, 4); bih.writeInt32LE(height * 2, 8);
  bih.writeUInt16LE(1, 12); bih.writeUInt16LE(32, 14); bih.writeUInt32LE(xorSize + andSize, 20);
  return Buffer.concat([bih, xor, and]);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const bmps = [];
for (const size of SIZES) {
  const pngPath = path.join(ASSETS_DIR, 'ico-' + size + '.png');
  if (!fs.existsSync(pngPath)) {
    console.error('missing source PNG:', pngPath);
    process.exit(1);
  }
  const { width, height, pixels } = decodePNG(fs.readFileSync(pngPath));
  if (width !== size || height !== size) {
    console.error('size mismatch for', pngPath, ': expected', size, 'got', width + 'x' + height);
    process.exit(1);
  }
  const bmp = encodeICOBMP(width, height, pixels);
  bmps.push({ size, bmp });
  console.log('decoded ico-' + size + '.png -> BMP', bmp.length, 'bytes');
}

// ICONDIR header (6)
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(bmps.length, 4);

// ICONDIRENTRY × N（全部在前）
const entries = [];
let dataOffset = 6 + 16 * bmps.length;
for (const { size, bmp } of bmps) {
  const e = Buffer.alloc(16);
  e[0] = size === 256 ? 0 : size;
  e[1] = size === 256 ? 0 : size;
  e[2] = 0;
  e[3] = 0;
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(bmp.length, 8);
  e.writeUInt32LE(dataOffset, 12);
  entries.push(e);
  dataOffset += bmp.length;
}

// 布局: header + 所有 entries + 所有 bmps
const out = Buffer.concat([header, ...entries, ...bmps.map((x) => x.bmp)]);
fs.writeFileSync(OUTPUT_ICO, out);
console.log('written ICO:', OUTPUT_ICO, out.length, 'bytes, sizes:', SIZES.join('/'));

// 生成内嵌模块
const b64 = out.toString('base64');
const moduleSrc = "'use strict';\n" +
  '// ============================================================================\n' +
  '// lib/shortcut-icon.cjs — 桌面快捷方式鲸鱼图标（内嵌 base64，不依赖 assets 路径）\n' +
  '// 由 scripts/build-icon.cjs 生成；改图标源 PNG 后运行 node scripts/build-icon.cjs 再提交。\n' +
  '// 2026-08-18（用户需求）：图标直接保存在项目里。\n' +
  '// ============================================================================\n' +
  'const ICON_B64 = \'' + b64 + '\';\n' +
  '\n' +
  'function shortcutIconBuffer() {\n' +
  '  return Buffer.from(ICON_B64, \'base64\');\n' +
  '}\n' +
  '\n' +
  'module.exports = { ICON_B64, shortcutIconBuffer };\n';
fs.writeFileSync(OUTPUT_MODULE, moduleSrc);
console.log('written module:', OUTPUT_MODULE, moduleSrc.length, 'bytes');

// 验证布局
const vb = fs.readFileSync(OUTPUT_ICO);
const vCount = vb.readUInt16LE(4);
console.log('verify header count:', vCount);
for (let i = 0; i < vCount; i++) {
  const off = 6 + i * 16;
  const w = vb[off] === 0 ? 256 : vb[off];
  const h = vb[off + 1] === 0 ? 256 : vb[off + 1];
  const dataOff = vb.readUInt32LE(off + 12);
  const dataLen = vb.readUInt32LE(off + 8);
  const bihSize = vb.readUInt32LE(dataOff);
  console.log('  ' + w + 'x' + h + ' off=' + dataOff + ' len=' + dataLen + ' BIHsize=' + bihSize + (bihSize === 40 ? ' OK' : ' BAD'));
}
