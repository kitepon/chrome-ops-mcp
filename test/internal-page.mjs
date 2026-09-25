import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const c=new Client({name:"internal-test",version:"0.1"}); await c.connect(new StdioClientTransport({command:process.execPath,args:["dist/index.js"]})); await new Promise(r=>setTimeout(r,2500));
const call=async(name,args={})=>c.callTool({name,arguments:args}); const tabs=JSON.parse((await call("tabs_list")).content[0].text); const t=tabs.find(x=>x.url?.startsWith("chrome://extensions")); if(!t) throw new Error("extensions tab missing");
console.log("attach",JSON.stringify((await call("devtools_attach",{tabId:t.id})).content)); console.log("eval",JSON.stringify((await call("runtime_evaluate",{tabId:t.id,expression:"({title:document.title,tag:document.documentElement.tagName})"})).content)); await c.close();
