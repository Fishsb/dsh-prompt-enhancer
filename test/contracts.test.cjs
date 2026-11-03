const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const c=require('../src/shared/contracts/index.cjs');

test('contract matches live RPC registry',function(){
  const raw=execFileSync(process.execPath,['scripts/rpc-manifest.mjs','--json'],{encoding:'utf8'});
  const manifest=JSON.parse(raw.slice(0,raw.indexOf('RING-STATE')));
  assert.deepEqual([...c.methods].sort(),[...manifest.live].sort());
});

test('contract result status has four states',function(){
  assert.deepEqual([...c.status],['changed','unchanged','skipped','failed']);
});

test('contract degraded reasons are frozen and stable',function(){
  for (const reason of ['relevance','relevance-timeout','intent','docs','history-timeout','webplan','v2progress-failed','output-truncated']) {
    assert.ok(c.degraded.includes(reason), 'missing degraded reason: ' + reason);
  }
  assert.equal(Object.isFrozen(c.degraded),true);
});
