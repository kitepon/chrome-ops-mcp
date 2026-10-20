import {mock} from 'node:test';
const exports={ChromeBridgeClient:class {
  constructor(url){process.send?.({event:'constructor',url});}
  async connect(){process.send?.({event:'connect'});}
  close(){}
  async call(method,params){
    process.send?.({event:'call',method,params});
    const mode=process.env.AUDIT_TEST_MODE;
    if(method==='host.status'){
      this.count=(this.count||0)+1;
      return {connected:mode!=='offline',bridgeCount:mode==='multi'?2:1,bridgeSession:mode==='changed'&&this.count===2?'changed':'first'};
    }
    if(mode==='error')throw Error('SECRET synthetic exception');
    const service=params.service;
    const account=service.startsWith('google-')?{email_sha256:'a'.repeat(64),domain:'example.test'}:service==='x-connected-apps'?{screen_name:'@QLyun35332'}:null;
    if(mode==='raw-email'&&account)account.email='SECRET@example.test';
    return {service,status:mode==='cleanup'?'stopped':'ok',stop_reason:mode==='cleanup'?'cleanup_failed':null,account:mode==='cleanup'?null:account,
      items:[],item_count:0,truncated:false,unconfirmed:[]};
  }
}};
mock.module(new URL('../../dist/bridge.js',import.meta.url).href,Number(process.versions.node.split('.')[0])<24?{namedExports:exports}:{exports});
