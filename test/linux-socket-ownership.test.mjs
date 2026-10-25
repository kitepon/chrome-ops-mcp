import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chmodSync,existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

test('Linux startup cleanup preserves a replacement at its released socket path',{skip:process.platform!=='linux',timeout:10000},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'chrome-ops-ownership-'));
 const fixture=join(dir,'chrome.mjs'),pidFile=join(dir,'chrome.pid'),marker=join(dir,'stopping'),socket=join(dir,'chrome.sock');
 writeFileSync(fixture,`#!/usr/bin/env node
import{createReadStream,createWriteStream,writeFileSync}from'node:fs';
writeFileSync(process.env.FIXTURE_PID,String(process.pid));
const input=createReadStream(null,{fd:3}),output=createWriteStream(null,{fd:4});
let buffer='';
input.on('data',chunk=>{buffer+=chunk;for(let end=buffer.indexOf('\\0');end>=0;end=buffer.indexOf('\\0')){
 const request=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
 const result=request.method==='Target.createTarget'?{targetId:'fixture'}:request.method==='Target.attachToTarget'?{sessionId:'fixture'}:request.method==='Runtime.evaluate'?{result:{value:true}}:{};
 output.write(JSON.stringify({id:request.id,result})+'\\0');
}});
process.on('SIGTERM',()=>{writeFileSync(process.env.FIXTURE_STOPPING,'stopping');setTimeout(()=>process.exit(0),500);});
setInterval(()=>{},1000);
`);
 chmodSync(fixture,0o700);
 const child=spawn(process.execPath,['--experimental-test-module-mocks','--import','./test/fixtures/linux-socket-chmod-failure.mjs','dist/os/linux-chrome.js'],{env:{...process.env,CHROME_OPS_CHROME_BINARY:fixture,CHROME_OPS_CHROME_PROFILE:join(dir,'profile'),CHROME_OPS_CHROME_SOCKET:socket,CHROME_OPS_LOAD_BRIDGE:'0',FIXTURE_PID:pidFile,FIXTURE_STOPPING:marker},stdio:['ignore','ignore','pipe']});
 const finished=once(child,'exit',{signal:t.signal});let stderr='';child.stderr.on('data',c=>stderr+=c);
 try{
  const deadline=Date.now()+5000;
  while(!existsSync(marker)&&Date.now()<deadline)await sleep(10,undefined,{signal:t.signal});
  assert.ok(existsSync(marker),'owned Chrome enters shutdown after socket permission failure');
  assert.equal(existsSync(socket),false,'server already released its original socket');
  writeFileSync(socket,'replacement-owned-by-another-invocation');
  const[code]=await finished;assert.notEqual(code,0);assert.match(stderr,/fixture socket permission failure/);
  assert.equal(readFileSync(socket,'utf8'),'replacement-owned-by-another-invocation');
 }finally{
  if(existsSync(pidFile))try{process.kill(Number(readFileSync(pidFile,'utf8')),'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  rmSync(dir,{recursive:true,force:true});
 }
});
