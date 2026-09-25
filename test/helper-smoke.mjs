import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const c=new Client({name:"helper-smoke",version:"0.1"}); await c.connect(new StdioClientTransport({command:process.execPath,args:["dist/index.js"]}));
const list=await c.callTool({name:"extensions_list",arguments:{}});const all=JSON.parse(list.content[0].text);const target=all.find(x=>x.name==='Chrome Ops MCP Bridge');if(!target)throw new Error('Chrome Ops extension not installed');const r=await c.callTool({name:"extension_dev_reload",arguments:{id:target.id}}); console.log(JSON.stringify(r.content)); await c.close();
