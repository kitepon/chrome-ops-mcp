import {WebSocketServer,WebSocket} from "ws";
import {randomUUID} from "node:crypto";

const chromePort=Number(process.env.CHROME_OPS_CHROME_PORT??32145);
const clientPort=Number(process.env.CHROME_OPS_HOST_PORT??32146);
let chrome:WebSocket|undefined; let lastSeenAt:number|undefined;
const pending=new Map<string,{client:WebSocket;clientId:string;timer:NodeJS.Timeout}>();
const chromeWss=new WebSocketServer({host:"127.0.0.1",port:chromePort});
const clientWss=new WebSocketServer({host:"127.0.0.1",port:clientPort});

chromeWss.on("connection",(ws,req)=>{if(!["127.0.0.1","::1"].includes(req.socket.remoteAddress??""))return ws.close(1008,"local only");let authenticated=false;const authTimer=setTimeout(()=>{if(!authenticated)ws.close(1008,"hello required")},2000);ws.on("message",raw=>{let m:any;try{m=JSON.parse(raw.toString())}catch{return}if(!authenticated){if(m.type!=="hello"||m.role!=="chrome-extension"||m.protocol!==1)return ws.close(1008,"invalid hello");authenticated=true;clearTimeout(authTimer);chrome?.close(1012,"replaced");chrome=ws;lastSeenAt=Date.now();return}lastSeenAt=Date.now();if(m.type!=="response")return;const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);p.client.send(JSON.stringify({...m,id:p.clientId}))});ws.on("close",()=>{clearTimeout(authTimer);if(chrome===ws)chrome=undefined})});

clientWss.on("connection",(client,req)=>{if(!["127.0.0.1","::1"].includes(req.socket.remoteAddress??""))return client.close(1008,"local only");client.on("message",raw=>{let m:any;try{m=JSON.parse(raw.toString())}catch{return}if(m.type!=="request")return;if(m.method==="host.status")return client.send(JSON.stringify({id:m.id,type:"response",ok:true,result:{host:true,connected:chrome?.readyState===WebSocket.OPEN,lastSeenAt:lastSeenAt?new Date(lastSeenAt).toISOString():null}}));if(chrome?.readyState!==WebSocket.OPEN)return client.send(JSON.stringify({id:m.id,type:"response",ok:false,error:"Chrome Ops extension is not connected to Host"}));const chromeId=randomUUID();const timer=setTimeout(()=>{pending.delete(chromeId);client.send(JSON.stringify({id:m.id,type:"response",ok:false,error:`Chrome request timed out: ${m.method}`}))},15000);pending.set(chromeId,{client,clientId:m.id,timer});chrome.send(JSON.stringify({...m,id:chromeId}))})});

console.error(`Chrome Ops Host ready: extension ws://127.0.0.1:${chromePort}, MCP clients ws://127.0.0.1:${clientPort}`);
