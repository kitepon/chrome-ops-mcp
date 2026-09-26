import {WebSocketServer,WebSocket} from "ws";
import {randomUUID} from "node:crypto";
import {once} from "node:events";

const chromePort=Number(process.env.CHROME_OPS_CHROME_PORT??32145);
const clientPort=Number(process.env.CHROME_OPS_HOST_PORT??32146);
const bridges=new Set<WebSocket>(); let lastSeenAt:number|undefined;
const bridgeSessions=new WeakMap<WebSocket,string>();
const pending=new Map<string,{client:WebSocket;clientId:string;chrome:WebSocket;timer:NodeJS.Timeout}>();
// ブラウザが送るOriginをUpgrade前に確認し、別サイトからのlocalhost接続を拒否する。
function guardedServer(port:number, allowedOrigin:(origin:string|undefined)=>boolean){
  const server=new WebSocketServer({host:"127.0.0.1",port});
  const shouldHandle=server.shouldHandle.bind(server);
  server.shouldHandle=req=>["127.0.0.1","::1"].includes(req.socket.remoteAddress??"")&&
    allowedOrigin(req.headers.origin===undefined?undefined:typeof req.headers.origin==="string"?req.headers.origin:"")&&shouldHandle(req);
  return server;
}
const chromeWss=guardedServer(chromePort,origin=>typeof origin==="string"&&/^chrome-extension:\/\/[a-p]{32}$/.test(origin));
const clientWss=guardedServer(clientPort,origin=>origin===undefined);

chromeWss.on("connection",(ws,req)=>{if(!["127.0.0.1","::1"].includes(req.socket.remoteAddress??""))return ws.close(1008,"local only");let authenticated=false;const authTimer=setTimeout(()=>{if(!authenticated)ws.close(1008,"hello required")},2000);ws.on("message",raw=>{let m:any;try{m=JSON.parse(raw.toString())}catch{return}if(!authenticated){if(m.type!=="hello"||m.role!=="chrome-extension"||m.protocol!==1)return ws.close(1008,"invalid hello");authenticated=true;clearTimeout(authTimer);bridges.add(ws);bridgeSessions.set(ws,randomUUID());lastSeenAt=Date.now();return}lastSeenAt=Date.now();if(m.type!=="response")return;const p=pending.get(m.id);if(!p||p.chrome!==ws)return;clearTimeout(p.timer);pending.delete(m.id);p.client.send(JSON.stringify({...m,id:p.clientId}))});ws.on("close",()=>{clearTimeout(authTimer);bridges.delete(ws)})});

clientWss.on("connection",(client,req)=>{if(!["127.0.0.1","::1"].includes(req.socket.remoteAddress??""))return client.close(1008,"local only");client.on("message",raw=>{let m:any;try{m=JSON.parse(raw.toString())}catch{return}if(m.type!=="request")return;const active=[...bridges].filter(ws=>ws.readyState===WebSocket.OPEN);if(m.method==="host.status")return client.send(JSON.stringify({id:m.id,type:"response",ok:true,result:{host:true,connected:active.length===1,bridgeCount:active.length,ambiguousProfiles:active.length>1,bridgeSession:active.length===1?bridgeSessions.get(active[0]):null,lastSeenAt:lastSeenAt?new Date(lastSeenAt).toISOString():null}}));if(active.length!==1)return client.send(JSON.stringify({id:m.id,type:"response",ok:false,error:active.length===0?"Chrome Ops extension is not connected to Host":"Multiple Chrome Ops Bridge profiles are connected; leave the Bridge enabled only in the intended Chrome profile"}));const chrome=active[0];const chromeId=randomUUID();const timer=setTimeout(()=>{pending.delete(chromeId);client.send(JSON.stringify({id:m.id,type:"response",ok:false,error:`Chrome request timed out: ${m.method}`}))},15000);pending.set(chromeId,{client,clientId:m.id,chrome,timer});chrome.send(JSON.stringify({...m,id:chromeId}))})});

await Promise.all([once(chromeWss,"listening"),once(clientWss,"listening")]);
console.error(`Chrome Ops Host ready: extension ws://127.0.0.1:${chromePort}, MCP clients ws://127.0.0.1:${clientPort}`);
