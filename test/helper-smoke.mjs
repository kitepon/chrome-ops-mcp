import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const c=new Client({name:"helper-smoke",version:"0.1"}); await c.connect(new StdioClientTransport({command:process.execPath,args:["dist/index.js"]}));
const r=await c.callTool({name:"extension_dev_reload",arguments:{id:"gdhdlofolohgjlaoomjdhnankhmlnapn"}}); console.log(JSON.stringify(r.content)); await c.close();
