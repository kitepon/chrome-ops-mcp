import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto, createHash} from 'node:crypto';
import {parseHTML} from 'linkedom';
import {auditPage, auditCurrentPage, googleAccount} from './fixtures/audit-pages.mjs';

const source = readFileSync(new URL('../extension/service-worker.js', import.meta.url), 'utf8');
const urls = {
  'google-connections':'https://myaccount.google.com/connections',
  'google-cloud-projects':'https://console.cloud.google.com/cloud-resource-manager',
  'x-connected-apps':'https://x.com/settings/connected_apps',
  'discord-developer-apps':'https://discord.com/developers/applications',
};
function fixture(options = {}) {
  const calls = [], tabs = new Map([[1, {id:1, active:true, url:'https://owner.invalid/', windowId:7}]]);
  let id = 10, eventListener, elapsed = 0;
  const event = {addListener(){}};
  const chrome = {
    storage:{session:{async get(){return {auditPendingTabIds:options.pendingIds || []};},async set(value){options.pendingIds=JSON.parse(JSON.stringify(value.auditPendingTabIds));}}},
    runtime:{onStartup:event,onInstalled:event}, action:{onClicked:event},
    alarms:{create(){}, onAlarm:event}, extension:{inIncognitoContext:options.incognito || false},
    windows:{getAll:async()=>options.windows ?? [{id:7}], getLastFocused:async()=>({id:7})},
    tabs:{
      async create(params) { calls.push(['create',params]); const tab={id:id++, status:'complete', ...params};tabs.set(tab.id,tab); if(options.created)await options.created(tab);return tab; },
      async get(tabId) { const tab=tabs.get(tabId); if(!tab)throw Error('gone');return {...tab,...options.tab}; },
      async remove(tabId) { calls.push(['remove',tabId]);if(options.failClose)throw Error('synthetic close failure');tabs.delete(tabId); },
      async query() {return [...tabs.values()];},
    },
    debugger:{
      onDetach:event, onEvent:{addListener(fn){eventListener=fn;}},
      async attach(target) {calls.push(['attach',target]);if(options.failAttach)throw Error('synthetic attach failure');},
      async detach(target) {calls.push(['detach',target]);},
      async sendCommand(target, method, params) {
        calls.push(['command',method,params]);
        if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'fixture-frame'}}};
        if(method==='Page.createIsolatedWorld'){
          assert.equal(params.frameId,'fixture-frame');
          if(options.failWorld)throw Error('Cannot isolate');
          if(options.missingWorld)return {};
          return {executionContextId:42};
        }
        if(method!=='Runtime.evaluate')return {};
        assert.equal(params.contextId,42,'all reads run in the fixed isolated world');
        if(options.evaluating)await options.evaluating(target);
        if(options.failEvaluate)throw Error('SECRET synthetic error never forwarded');
        if(options.exception)return {exceptionDetails:{text:'SECRET'}};
        const service=Object.keys(urls).find(key=>urls[key]===tabs.get(target.tabId).url);
        const {document}=parseHTML(options.html ?? auditPage(service, options.count ?? 1));
        for(const input of document.querySelectorAll('input, textarea'))Object.defineProperty(input,'value',{get(){throw Error('Input values must not be read');}});
        const location=new URL(options.documentUrl ?? tabs.get(target.tabId).url);
        const value=vm.runInNewContext(params.expression,{document,location,URL});
        if(options.navigateAfter)options.tab={url:options.navigateAfter};
        return {result:{value}};
      },
    },
  };
  const context=vm.createContext({chrome,URL,crypto:webcrypto,TextEncoder,Uint8Array,
    WebSocket:class {static CONNECTING=0;static OPEN=1;readyState=0;},
    Date:class extends Date {static now(){return Date.now()+elapsed;}},
    clearTimeout,clearInterval,setTimeout:(fn,ms=0)=>{elapsed+=ms;return setTimeout(fn,0);},setInterval(){},console,
  });
  vm.runInContext(source,context);
  return {calls,tabs,options,context,
    read:service=>context.dispatch('audit.read',{service}),
    dispatch:(method,p)=>context.dispatch(method,p),
    emit:(id,method,params={})=>eventListener({tabId:id},method,params),
    cacheSize:()=>vm.runInContext('consoleEntries.size + networkEntries.size + requestIndex.size',context),
  };
}
const plain=value=>JSON.parse(JSON.stringify(value));
for(const service of Object.keys(urls))test(`${service}: background read, fixed fields, private cleanup`,async()=>{
  const f=fixture();const result=plain(await f.read(service));
  assert.equal(result.status,'ok');assert.equal(result.item_count,1);
  assert.equal(result.items[0].name,'Fixture 0');
  assert.equal(f.calls[0][1].url,urls[service]);assert.equal(f.calls[0][1].active,false);
  assert.deepEqual([...f.tabs.keys()],[1]);assert.equal(f.tabs.get(1).active,true);
  assert.deepEqual(f.calls.filter(c=>c[0]==='command').map(c=>c[1]),['Page.getFrameTree','Page.createIsolatedWorld','Runtime.evaluate']);
  const params=f.calls.find(c=>c[0]==='command'&&c[1]==='Runtime.evaluate')[2];
  assert.equal(params.throwOnSideEffect,undefined);assert.equal(params.returnByValue,true);assert.equal(params.awaitPromise,false);
  assert.equal(f.cacheSize(),0);assert.ok(!JSON.stringify(result).includes('Audit@EXAMPLE.test'));
  if(service.startsWith('google-'))assert.equal(result.account.email_sha256,createHash('sha256').update('audit@example.test').digest('hex'));
  if(service==='x-connected-apps')assert.ok(result.unconfirmed.some(x=>x.field==='permissions'&&x.reason==='needs_click'));
  if(service==='discord-developer-apps')assert.equal(result.unconfirmed.filter(x=>x.reason==='needs_click').length,5);
});

test('unsupported Discord creates no tab and calls no debugger',async()=>{
  const f=fixture();const r=plain(await f.read('discord-authorized-apps'));
  assert.equal(r.status,'ok');assert.deepEqual(r.unconfirmed,[{field:'all',reason:'not_supported'}]);assert.equal(f.calls.length,0);
});
for(const service of Object.keys(urls))test(`${service}: current layout remains scoped to named fields`,async()=>{
  const f=fixture({html:auditCurrentPage(service)}),r=await f.read(service);
  assert.equal(r.status,'ok');assert.equal(r.item_count,1);assert.equal(r.items[0].name,'Fixture 0');
  assert.deepEqual([...f.tabs.keys()],[1]);assert.equal(f.cacheSize(),0);
});
test('waits for SPA identity/inventory without treating an initial shell as empty',async()=>{
  let count=0,f;f=fixture({html:'<main></main>',evaluating(){if(++count===2)f.options.html=auditPage('x-connected-apps');}});
  const r=await f.read('x-connected-apps');assert.equal(r.status,'ok');assert.equal(r.item_count,1);assert.equal(count,2);
});
test('Cloud organization-only shells remain unconfirmed until project rows arrive',async()=>{
  const loaded=auditCurrentPage('google-cloud-projects');
  const shell=loaded.replace(/<tbody>[\s\S]*?<\/tbody>/,'<tbody><tr><td></td><td>組織なし</td><td></td><td></td></tr></tbody>');
  assert.equal((await fixture({html:shell}).read('google-cloud-projects')).stop_reason,'page_shape_changed');
  let count=0,f;f=fixture({html:shell,evaluating(){if(++count===2)f.options.html=loaded;}});
  const result=await f.read('google-cloud-projects');assert.equal(result.status,'ok');assert.equal(result.item_count,1);assert.equal(count,2);
});
test('unknown/prototype services and arbitrary URL/JS arguments are refused',async()=>{
  const f=fixture();
  for(const p of [{service:'__proto__'},{service:'constructor'},{service:'id'},{service:'google-connections',url:'https://evil.invalid'},{service:'google-connections',expression:'1'}])await assert.rejects(f.dispatch('audit.read',p));
  assert.equal(f.calls.length,0);
});
test('URL query allowlists reject lookalike origins, duplicates, fragments and navigation paths',()=>{
  const f=fixture(), allowed=(service,url)=>vm.runInContext('auditUrlAllowed',f.context)(service,url,urls[service]);
  for(const url of ['https://myaccount.google.com/connections','https://myaccount.google.com/connections?authuser=2'])assert.equal(allowed('google-connections',url),true);
  for(const suffix of ['?authuser=x','?authuser=1&authuser=2','?project=x','#all','/details'])assert.equal(allowed('google-connections',urls['google-connections']+suffix),false);
  assert.equal(allowed('google-connections','https://myaccount.google.com.evil.invalid/connections'),false);
  assert.equal(allowed('google-cloud-projects',urls['google-cloud-projects']+'?organizationId=123&project=fixture-1&authuser=2'),true);
  assert.equal(allowed('google-cloud-projects',urls['google-cloud-projects']+'?project=a%2Fb'),false);
});
test('redirect, page timeout, evaluation failure and exception always close only the new tab',async()=>{
  for(const options of [{tab:{url:'https://accounts.google.com/login'}},{tab:{pendingUrl:'https://evil.invalid'}},{tab:{status:'loading'}},{failEvaluate:true},{exception:true},{failAttach:true},{failWorld:true},{missingWorld:true}]){
    const f=fixture(options),r=await f.read('google-connections');
    assert.equal(r.status,'stopped');assert.deepEqual([...f.tabs.keys()],[1]);assert.ok(!JSON.stringify(r).includes('SECRET'));
    if(options.missingWorld)assert.ok(!f.calls.some(c=>c[0]==='command'&&c[1]==='Runtime.evaluate'));
  }
});
test('same-document guard and post-evaluation URL check discard data on navigation',async()=>{
  for(const options of [{documentUrl:'https://evil.invalid/'},{navigateAfter:'https://evil.invalid/'}]){
    const f=fixture(options),r=await f.read('google-connections');
    assert.equal(r.stop_reason,'url_mismatch');assert.equal(r.items.length,0);assert.deepEqual([...f.tabs.keys()],[1]);
  }
});
test('missing inventory is stopped; a named empty inventory is a confirmed zero',async()=>{
  const missing=fixture({html:googleAccount+'<main><h1>Your connections to third-party apps &amp; services</h1><ul></ul></main>'});
  assert.equal((await missing.read('google-connections')).stop_reason,'page_shape_changed');
  const empty=await fixture({count:0}).read('google-connections');assert.equal(empty.status,'ok');assert.equal(empty.item_count,0);
});
test('login and missing account stop without returning app data; input values are untouched',async()=>{
  const login=await fixture({html:'<main><input type="password" value="SECRET"></main>'}).read('google-connections');assert.equal(login.stop_reason,'login_required');
  const missing=await fixture({html:'<main><h1>Connected apps</h1></main>'}).read('x-connected-apps');assert.equal(missing.stop_reason,'account_unknown');
  const f=fixture({html:auditPage('discord-developer-apps')+'<input value="SECRET"><textarea>SECRET</textarea>'});
  assert.equal((await f.read('discord-developer-apps')).status,'ok');
});
test('truncates to 200 entries, strips controls, and limits Unicode values to 200 code points',async()=>{
  const f=fixture({count:201});const r=await f.read('google-connections');assert.equal(r.item_count,200);assert.equal(r.truncated,true);
  const raw={status:'ok',account:{email:'audit@example.test'},items:[{name:'🙂'.repeat(210)+'\u0001'}],unconfirmed:[],truncated:false};
  const clean=await vm.runInContext('auditResult',f.context)('google-connections',raw);assert.equal([...clean.items[0].name].length,200);assert.ok(!clean.items[0].name.includes('\u0001'));
});
test('audit events and late events never enter caches; generic calls cannot attach the private tab',async()=>{
  let f;
  f=fixture({evaluating:async target=>{
    for(const method of ['devtools.attach','devtools.evaluate','devtools.networkRead','tabs.activate'])await assert.rejects(f.dispatch(method,{tabId:target.tabId,expression:'1'}),/private/);
    for(const method of ['Runtime.consoleAPICalled','Log.entryAdded','Network.requestWillBeSent'])f.emit(target.tabId,method,{secret:'SECRET'});
    await assert.rejects(f.dispatch('extensions.reloadSelf',{}),/cleanup/);
  }});
  assert.equal((await f.read('google-connections')).status,'ok');f.emit(10,'Runtime.consoleAPICalled',{secret:'SECRET'});assert.equal(f.cacheSize(),0);
});
test('normal developer capture remains enabled on ordinary tabs',async()=>{
  const f=fixture();await f.dispatch('devtools.attach',{tabId:1});
  assert.deepEqual(f.calls.filter(x=>x[0]==='command').map(x=>x[1]),['Runtime.enable','Log.enable','Network.enable']);
  f.emit(1,'Runtime.consoleAPICalled',{args:[]});assert.equal(f.cacheSize(),1);
});
test('concurrent audit is busy without creating a second tab',async()=>{
  let unblock;const gate=new Promise(resolve=>{unblock=resolve;});
  const f=fixture({evaluating:()=>gate});const first=f.read('google-connections');
  while(!f.calls.some(c=>c[0]==='command'))await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal((await f.read('x-connected-apps')).stop_reason,'busy');unblock();assert.equal((await first).status,'ok');
  assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
});
test('close failure is stopped and ownership retains only the ID until next-call retry',async()=>{
  const f=fixture({failClose:true});const r=await f.read('google-connections');
  assert.equal(r.status,'stopped');assert.equal(r.stop_reason,'cleanup_failed');
  assert.deepEqual(plain(vm.runInContext('[...auditTabs]',f.context)),[10]);
  assert.equal((await f.read('x-connected-apps')).stop_reason,'cleanup_failed');assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
  f.options.failClose=false;assert.equal((await f.read('x-connected-apps')).status,'ok');assert.deepEqual([...f.tabs.keys()],[1]);
});
test('no normal window and incognito never create or activate a window',async()=>{
  for(const options of [{windows:[]},{incognito:true}]){const f=fixture(options);assert.equal((await f.read('google-connections')).stop_reason,'no_window');assert.equal(f.calls.length,0);}
});
test('X rejects other accounts before reading item names and accepts both fixed handles case-insensitively',async()=>{
  const wrong=await fixture({html:auditPage('x-connected-apps').replace('@QLyun35332','@other_account')}).read('x-connected-apps');
  assert.equal(wrong.stop_reason,'account_unknown');assert.equal(wrong.account,null);assert.equal(wrong.items.length,0);
  const bell=await fixture({html:auditPage('x-connected-apps').replace('@QLyun35332','@bELL_qUoLu')}).read('x-connected-apps');assert.equal(bell.status,'ok');
});
test('pending ID-only recovery survives a worker restart; removed tabs do not become a cleanup failure',async()=>{
  const f=fixture({pendingIds:[99]});const r=await f.read('google-connections');assert.equal(r.status,'ok');assert.deepEqual(f.calls[0],['remove',99]);assert.deepEqual(f.options.pendingIds,[]);
});
test('hidden inventory rows do not become visible app results',async()=>{
  const html=auditPage('google-connections').replace('<li>','<li hidden>');const r=await fixture({html}).read('google-connections');assert.equal(r.status,'ok');assert.equal(r.item_count,0);
});
