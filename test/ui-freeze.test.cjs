const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const {i18nSource}=require('./helpers/client-i18n.cjs');
function snapshot(){
const s=i18nSource();
const i=s.indexOf('const ZH = {');
const j=s.lastIndexOf('const EN = {');
const e=s.indexOf('\n};',j);
return s.slice(i,e+3).replace(/\r\n/g,'\n')+'\n';
}
test('user-visible i18n text is frozen',function(){
const expected=fs.readFileSync(path.join(__dirname,'fixtures/ui-freeze/i18n.source.txt'),'utf8');
assert.equal(snapshot(),expected);
});
