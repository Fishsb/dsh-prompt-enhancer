'use strict';
// ============================================================================
// lib/shortcut-win.cjs — Windows 桌面快捷方式生成（最可靠路径）
//
// 背景（2026-08-18 排查）：Node 手写 .lnk（无 LinkTargetIDList）即使 IconLocation
// 正确、ICO 有效，Shell 也显示白纸——IDList 必需。WScript.Shell（pywin32 等价）
// 能生成完整 .lnk（含 IDList），但它把图标路径写进 IconEnvironmentDataBlock
// (0xA0000007) 的 TargetAnsi（%USERPROFILE% 形式），TargetUnicode 留空——
// Shell 优先读 TargetUnicode → 空 → 白纸。所以：WScript 生成 + Node 补 TargetUnicode。
//
// 本模块：写临时 VBS（UTF-16LE BOM，cscript 可解析中文）→ spawn cscript.exe
// （Windows 自带，无 Python 依赖）→ WScript.Shell 创建完整 .lnk →
// Node 读回 .lnk 修补 IconEnvironmentDataBlock.TargetUnicode（绝对路径 UTF-16LE）→
// 清理临时文件。
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const BLOCK_SIG_ICON_ENV = 0xa0000007;
const BLOCK_SIZE = 788;
const TARGET_ANSI_LEN = 260;
const TARGET_UNICODE_LEN = 520;

/**
 * 在 .lnk 中修补 IconEnvironmentDataBlock.TargetUnicode（Shell 优先读的字段）。
 * 返回 { ok, size }。
 */
function fixTargetUnicode(lnkPath, iconPathAbs) {
  const b = fs.readFileSync(lnkPath);
  let blockStart = -1;
  for (let i = 4; i < b.length - 4; i++) {
    if (b.readUInt32LE(i) === BLOCK_SIG_ICON_ENV && b.readUInt32LE(i - 4) === BLOCK_SIZE) {
      blockStart = i - 4;
      break;
    }
  }
  if (blockStart === -1) {
    // 无 IconEnvironmentDataBlock → 可能是旧 buildLnk 产物；返回 false 由调用方决定
    return { ok: false, reason: 'no IconEnvironmentDataBlock' };
  }
  const uniStart = blockStart + 8 + TARGET_ANSI_LEN;
  const targetUni = Buffer.from(iconPathAbs, 'utf16le');
  if (targetUni.length + 2 > TARGET_UNICODE_LEN) return { ok: false, reason: 'icon path too long' };

  const out = Buffer.from(b);
  out.fill(0, uniStart, uniStart + TARGET_UNICODE_LEN);
  targetUni.copy(out, uniStart);
  fs.writeFileSync(lnkPath, out);

  // 字节级验证（整文件 UTF-16LE decode 会因 Header 错位假阴性）
  const vb = fs.readFileSync(lnkPath);
  const ok = vb.indexOf(Buffer.from(iconPathAbs, 'utf16le')) !== -1;
  return { ok, size: vb.length };
}

/**
 * 生成 VBS 源码（UTF-16LE BOM 写出，cscript 可解析中文 .lnk 名）。
 */
function buildVbs({ lnkPath, target, args, workingDir, iconPathEnv }) {
  const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const lines = [
    'Set ws = CreateObject("WScript.Shell")',
    'Set lnk = ws.CreateShortcut(' + q(lnkPath) + ')',
    'lnk.TargetPath = ' + q(target),
    'lnk.Arguments = ' + q(args || ''),
    'lnk.WorkingDirectory = ' + q(workingDir || os.homedir()),
    'lnk.IconLocation = ' + q(iconPathEnv + ',0'),
    'lnk.Description = "DSH port restart"',
    'lnk.Save',
    'WScript.Echo "OK"',
    '',
  ];
  return lines.join('\r\n');
}

/**
 * 用 cscript + WScript.Shell 创建完整 .lnk（含 IDList），再补 TargetUnicode。
 * @param {object} opts
 * @param {string} opts.lnkPath        目标 .lnk 绝对路径
 * @param {string} opts.target         exe 绝对路径
 * @param {string} opts.args           参数
 * @param {string} opts.workingDir     工作目录
 * @param {string} opts.iconPath       图标 .ico 绝对路径（写入 TargetUnicode）
 * @param {string} opts.iconPathEnv    图标 .ico 环境变量路径（如 %USERPROFILE%\...，写入 TargetAnsi）
 */
function makeShortcutWin(opts) {
  const { lnkPath, target, args, workingDir, iconPath, iconPathEnv } = opts;

  // 1. 写临时 VBS（UTF-16LE + BOM）
  const vbsPath = path.join(os.tmpdir(), 'dsh-make-shortcut-' + process.pid + '.vbs');
  const vbsSrc = buildVbs({ lnkPath, target, args, workingDir, iconPathEnv });
  const bom = Buffer.from([0xff, 0xfe]);
  fs.writeFileSync(vbsPath, Buffer.concat([bom, Buffer.from(vbsSrc, 'utf16le')]));

  try {
    // 2. cscript 执行（Windows 自带）
    const res = spawnSync('cscript.exe', ['//nologo', vbsPath], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
    });
    if (res.status !== 0) {
      return { ok: false, code: 'CSCRIPT_FAIL', message: String(res.stderr || res.stdout || res.error || 'cscript exit ' + res.status).slice(0, 300) };
    }
    if (!fs.existsSync(lnkPath)) {
      return { ok: false, code: 'SHORTCUT_MISSING', message: 'not created: ' + lnkPath };
    }

    // 3. 补 TargetUnicode
    const fix = fixTargetUnicode(lnkPath, iconPath);
    const size = fs.statSync(lnkPath).size;
    return { ok: true, shortcutPath: lnkPath, size, fix, cscriptStdout: String(res.stdout || '').trim() };
  } finally {
    try { fs.unlinkSync(vbsPath); } catch { /* ignore */ }
  }
}

module.exports = { makeShortcutWin, fixTargetUnicode };
