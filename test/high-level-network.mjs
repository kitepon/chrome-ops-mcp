import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const client=new Client({name:"chrome-ops-network-smoke",version:"0.1.0"});
await client.connect(new StdioClientTransport({command:process.execPath,args:["dist/index.js"]}));
await new Promise(r=>setTimeout(r,2500));
const call=async(name,args={})=>client.callTool({name,arguments:args});
const tabs=JSON.parse((await call("tabs_list")).content[0].text);
const tab=tabs.find(t=>/^https?:/.test(t.url)); if(!tab) throw new Error("No HTTP tab");
await call("devtools_attach",{tabId:tab.id}); await call("page_reload",{tabId:tab.id}); await new Promise(r=>setTimeout(r,1500));
const requests=JSON.parse((await call("network_requests",{tabId:tab.id})).content[0].text);
console.log("requests",requests.length);
const response=requests.find(r=>r.status===200 && r.requestId);
if(response){const body=JSON.parse((await call("network_response_body",{tabId:tab.id,requestId:response.requestId})).content[0].text);console.log("response-body",response.url,body.body?.length??0,body.base64Encoded);}
const failures=JSON.parse((await call("network_failures",{tabId:tab.id,failuresOnly:true})).content[0].text); console.log("failures",failures.length);
await call("devtools_detach",{tabId:tab.id}); await client.close();
