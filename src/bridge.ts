import WebSocket from "ws";
import { randomUUID } from "node:crypto";

export class ChromeBridgeClient {
  private socket?: WebSocket;
  private pending=new Map<string,{resolve(v:unknown):void;reject(e:Error):void;timer:NodeJS.Timeout}>();
  constructor(private url=process.env.CHROME_OPS_HOST_URL ?? "ws://127.0.0.1:32146"){}
  async connect(timeoutMs=5000){
    if(this.socket?.readyState===WebSocket.OPEN)return;
    const ws=new WebSocket(this.url); this.socket=ws;
    await new Promise<void>((resolve,reject)=>{const t=setTimeout(()=>reject(new Error("Chrome Ops Host connection timed out")),timeoutMs);ws.once("open",()=>{clearTimeout(t);resolve()});ws.once("error",e=>{clearTimeout(t);reject(e)})});
    ws.on("message",raw=>this.onMessage(raw.toString()));
  }
  connected(){return this.socket?.readyState===WebSocket.OPEN}
  async status(){try{await this.connect();return await this.call("host.status")}catch{return{connected:false,host:false}}}
  async call(method:string,params?:unknown,timeoutMs=15000):Promise<unknown>{
    await this.connect(); const id=randomUUID();
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`Host request timed out: ${method}`))},timeoutMs);this.pending.set(id,{resolve,reject,timer});this.socket!.send(JSON.stringify({id,type:"request",method,params}))});
  }
  private onMessage(raw:string){let m:any;try{m=JSON.parse(raw)}catch{return}if(m.type!=="response")return;const p=this.pending.get(m.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.id);m.ok?p.resolve(m.result):p.reject(new Error(m.error??"Host operation failed"))}
}
