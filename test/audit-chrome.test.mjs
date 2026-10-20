// Real Chrome + real unpacked Bridge. An isolated HTTPS proxy serves synthetic
// pages at the allowlisted origins; no account/profile or live service is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {createServer as httpServer} from 'node:http';
import {createServer as httpsServer} from 'node:https';
import {WebSocketServer} from 'ws';
import {auditPage} from './fixtures/audit-pages.mjs';
const binary=process.env.CHROME_OPS_AUDIT_TEST_CHROME;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('real Chrome: fixed background audit tabs, guarded Runtime-only reads, no caches, final cleanup',{skip:!binary||!existsSync(binary),timeout:60000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'chrome-ops-audit-'));
  const key=join(dir,'key.pem'),cert=join(dir,'cert.pem');
  const openssl=process.env.CHROME_OPS_AUDIT_TEST_OPENSSL??(process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl');
  assert.equal(spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-keyout',key,'-out',cert,'-nodes','-subj','/CN=chrome-ops-synthetic.invalid','-days','1'],{stdio:'ignore'}).status,0,'test certificate generation');
  let service,mode='ok';
  const sockets=new Set();
  const pages=httpsServer({key:readFileSync(key),cert:readFileSync(cert)},(req,res)=>{
    const host=req.headers.host?.split(':')[0];
    if(!['myaccount.google.com','console.cloud.google.com','x.com','discord.com','accounts.google.com'].includes(host)){res.writeHead(404).end();return;}
    if(mode==='redirect'&&host!=='accounts.google.com'){res.writeHead(302,{Location:'https://accounts.google.com/'}).end();return;}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(mode==='login'?'<main><input type="password" value="fixture-never-read"></main>':auditPage(service));
  });
  const proxy=httpServer((_req,res)=>res.writeHead(404).end());
  proxy.on('connect',(_req,socket,head)=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)socket.unshift(head);pages.emit('connection',socket);});
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  const extension=join(dir,'extension');mkdirSync(extension);
  writeFileSync(join(extension,'manifest.json'),readFileSync('extension/manifest.json'));
  const workerSource=readFileSync('extension/service-worker.js','utf8')
    .replace('async function dispatch(method, p) {','async function dispatch(method, p) { if(method === "test.auditCaches") return {console:consoleEntries.size,network:networkEntries.size,requests:requestIndex.size,pending:auditTabs.size};')
    .replace('ws://127.0.0.1:32145',`ws://127.0.0.1:${server.address().port}`);
  writeFileSync(join(extension,'service-worker.js'),workerSource);
  const chrome=spawn(binary,[`--user-data-dir=${join(dir,'profile')}`,'--headless=new','--no-sandbox','--remote-debugging-pipe','--enable-unsafe-extension-debugging','--no-first-run','--no-default-browser-check','--disable-background-networking','--ignore-certificate-errors',`--proxy-server=http://127.0.0.1:${proxy.address().port}`,'about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe']});
  let seq=0,buffer='',socket;const waiting=new Map(),requests=new Map();
  chrome.stderr.resume();
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++seq,timer=setTimeout(()=>{waiting.delete(id);reject(Error(`CDP timeout: ${method}`));},8000);
    waiting.set(id,{resolve,reject,timer});chrome.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');
  });
  chrome.stdio[4].setEncoding('utf8');chrome.stdio[4].on('data',chunk=>{
    buffer+=chunk;
    for(let end;(end=buffer.indexOf('\0'))>=0;){
      const msg=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
      if(msg.id&&waiting.has(msg.id)){const p=waiting.get(msg.id);waiting.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(Error(msg.error.message)):p.resolve(msg.result);}
    }
  });
  t.after(async()=>{
    for(const p of requests.values()){clearTimeout(p.timer);p.reject(Error('test closing'));}requests.clear();
    for(const ws of server.clients)ws.terminate();await new Promise(resolve=>server.close(resolve));
    await send('Browser.close').catch(()=>chrome.kill());
    if(chrome.exitCode===null)await Promise.race([once(chrome,'exit'),sleep(5000).then(()=>chrome.kill())]);
    for(const p of waiting.values()){clearTimeout(p.timer);p.reject(Error('test closing'));}waiting.clear();
    for(const socket of sockets)socket.destroy();await new Promise(resolve=>proxy.close(resolve));pages.close();
    rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250});
  });
  server.on('connection',ws=>{
    socket=ws;ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='response'&&requests.has(msg.id)){const p=requests.get(msg.id);requests.delete(msg.id);clearTimeout(p.timer);msg.ok?p.resolve(msg.result):p.reject(Error(msg.error));}});
  });
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=String(++seq),timer=setTimeout(()=>{requests.delete(id);reject(Error(`Bridge timeout: ${method}`));},12000);requests.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,type:'request',method,params}));});
  await send('Browser.getVersion');await send('Extensions.loadUnpacked',{path:extension});
  for(let i=0;i<100&&!socket;i++)await sleep(50);assert.ok(socket,'test Bridge connected');
  const before=await call('tabs.list');
  for(service of ['google-connections','google-cloud-projects','x-connected-apps','discord-developer-apps']){
    const result=await call('audit.read',{service});
    assert.equal(result.status,'ok',`${service}: ${result.stop_reason}`);assert.equal(result.item_count,1);
    assert.deepEqual(await call('tabs.list'),before,'original tabs and active state preserved');
  }
  for(mode of ['redirect','login']){
    service='google-connections';const result=await call('audit.read',{service});
    assert.equal(result.status,'stopped');assert.equal(result.stop_reason,mode==='redirect'?'redirect':'login_required');assert.deepEqual(await call('tabs.list'),before);
  }
  assert.deepEqual(await call('test.auditCaches'),{console:0,network:0,requests:0,pending:0});
});
