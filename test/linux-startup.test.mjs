import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chmodSync,existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

for(const mode of ['protocol-error','malformed-reply','pipe-close','null-reply','no-reply','stubborn-error']) {
  test(`Linux startup ${mode} reports failure and reaps its owned Chrome`, {skip:process.platform!=='linux',timeout:30000},async t=>{
    const dir=mkdtempSync(join(tmpdir(),'chrome-ops-startup-'));
    const fixture=join(dir,'chrome.mjs'),pidFile=join(dir,'chrome.pid'),socket=join(dir,'chrome.sock');
    writeFileSync(fixture,`#!/usr/bin/env node
import {createReadStream,createWriteStream,writeFileSync} from 'node:fs';
writeFileSync(process.env.FIXTURE_PID,String(process.pid));
const input=createReadStream(null,{fd:3}),output=createWriteStream(null,{fd:4});
setInterval(()=>{},1000);
if(process.env.FIXTURE_MODE==='stubborn-error')process.on('SIGTERM',()=>{});
input.once('data',chunk=>{
  if(process.env.FIXTURE_MODE==='no-reply')return;
  if(process.env.FIXTURE_MODE==='pipe-close'){output.end();return;}
  if(process.env.FIXTURE_MODE==='null-reply'){output.write('null\\0');return;}
  if(process.env.FIXTURE_MODE==='malformed-reply'){output.write('invalid-json\\0');return;}
  const request=JSON.parse(chunk.toString().split('\\0')[0]);
  output.write(JSON.stringify({id:request.id,error:{message:'fixture startup rejection'}})+'\\0');
});
`);
    chmodSync(fixture,0o700);
    const child=spawn(process.execPath,['dist/os/linux-chrome.js'],{env:{...process.env,CHROME_OPS_CHROME_BINARY:fixture,CHROME_OPS_CHROME_PROFILE:join(dir,'profile'),CHROME_OPS_CHROME_SOCKET:socket,FIXTURE_PID:pidFile,FIXTURE_MODE:mode},stdio:['ignore','ignore','pipe']});
    let stderr='';child.stderr.on('data',c=>stderr+=c);
    let fixturePid;
    try{
      const [code]=await once(child,'exit',{signal:t.signal});
      assert.notEqual(code,0,stderr);
      assert.ok(existsSync(pidFile),'fake Chrome started');fixturePid=Number(readFileSync(pidFile,'utf8'));
      let alive=true;try{process.kill(fixturePid,0);}catch(error){if(error.code==='ESRCH')alive=false;else throw error;}
      assert.equal(alive,false,`owned Chrome ${fixturePid} survived startup failure`);
      assert.equal(existsSync(socket),false,'failed startup never advertises readiness');
      assert.match(stderr,['protocol-error','stubborn-error'].includes(mode)?/fixture startup rejection/:mode==='malformed-reply'?/JSON|Unexpected token/:mode==='null-reply'?/Invalid Chrome DevTools reply/:mode==='no-reply'?/Chrome did not answer Browser.getVersion/:/closed|ended|disconnect/i);
    }finally{
      if(!fixturePid&&existsSync(pidFile))fixturePid=Number(readFileSync(pidFile,'utf8'));
      if(fixturePid)try{process.kill(fixturePid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
      if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
      rmSync(dir,{recursive:true,force:true});
    }
  });
}
