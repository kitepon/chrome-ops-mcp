import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
const keys=['service','entry_version','started_at','finished_at','status','stop_reason','account','items','item_count','truncated','unconfirmed'].sort();
function run(input,{args=[],env={}}={}){
  return new Promise((resolve,reject)=>{
    const child=fork('bin/audit-read.js',args,{execArgv:['--experimental-test-module-mocks','--import','./test/fixtures/audit-client-mock.mjs'],env:{...process.env,...env},stdio:['pipe','pipe','pipe','ipc']});
    let stdout='',stderr='';const calls=[];
    child.on('message',message=>calls.push(message));child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',reject);
    child.once('close',code=>{try{const json=JSON.parse(stdout);assert.deepEqual(Object.keys(json).sort(),keys);assert.ok(Date.parse(json.started_at));assert.ok(Date.parse(json.finished_at));assert.equal(json.entry_version,'0.5.3-alpha.0');resolve({code,json,stdout,stderr,calls});}catch(e){e.message+=` (child exit ${code}; stderr: ${stderr})`;reject(e);}});
    child.stdin.end(input);
  });
}
test('rejects unknown/empty/multiline/oversize/shell/JSON/JS inputs without contacting Host',async()=>{
  for(const input of ['','\n','unknown\n','x'.repeat(65)+'\n','google-connections\nx-connected-apps\n','google-connections; id\n','{"service":"google-connections"}\n','console.log(1)\n']){
    const r=await run(input);assert.equal(r.code,1);assert.equal(r.json.status,'rejected');assert.ok(!r.calls.some(x=>x.event==='connect'||x.event==='call'));assert.equal(r.stdout.split('\n').length,2);
  }
});
test('rejects arguments and an SSH original command',async()=>{
  for(const options of [{args:['id']},{env:{SSH_ORIGINAL_COMMAND:'id'}}]){const r=await run('google-connections\n',options);assert.equal(r.json.status,'rejected');assert.equal(r.code,1);}
});
test('five service names produce the fixed envelope, unsupported Discord never connects',async()=>{
  for(const service of ['google-connections','google-cloud-projects','x-connected-apps','discord-developer-apps','discord-authorized-apps']){
    const r=await run(service+'\r\n');assert.equal(r.code,0);assert.equal(r.json.status,'ok');assert.equal(r.json.service,service);
    assert.equal(r.calls[0].url,'ws://127.0.0.1:32146');
    if(service==='discord-authorized-apps'){assert.ok(!r.calls.some(x=>x.event==='connect'));assert.deepEqual(r.json.unconfirmed,[{field:'all',reason:'not_supported'}]);}
    else assert.deepEqual(r.calls.filter(x=>x.event==='call').map(x=>x.method),['host.status','audit.read','host.status']);
  }
});
test('multiple bridges, changed session, missing bridge, cleanup failure and raw payload fail closed',async()=>{
  for(const [mode,reason] of [['multi','multi_bridge'],['changed','session_changed'],['offline','bridge_unavailable'],['cleanup','cleanup_failed'],['error','read_failed'],['raw-email','read_failed']]){
    const r=await run('google-connections\n',{env:{AUDIT_TEST_MODE:mode,CHROME_OPS_HOST_URL:'ws://evil.invalid'}});
    assert.equal(r.code,1);assert.equal(r.json.status,'stopped');assert.equal(r.json.stop_reason,reason);assert.equal(r.json.items.length,0);assert.equal(r.json.account,null);assert.ok(!r.stdout.includes('SECRET'));
  }
});
