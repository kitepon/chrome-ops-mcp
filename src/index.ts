import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { ChromeBridgeClient } from "./bridge.js";
import { helper } from "./helper.js";

const bridge = new ChromeBridgeClient();
const server = new McpServer({ name: "chrome-ops-mcp", version: "0.2.0-alpha.0" });
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const proxy = (name: string, description: string, schema: Record<string, z.ZodTypeAny>, method = name) =>
  server.tool(name, description, schema, async args => text(await bridge.call(method, args)));
const bridgeSession=async()=>{
  const status=await bridge.call("host.status");
  if(!status||typeof status!=="object"||!("connected" in status)||status.connected!==true||
     !("bridgeSession" in status)||typeof status.bridgeSession!=="string"){
    throw new Error("A unique Chrome Ops Bridge profile is required for developer operations");
  }
  return status.bridgeSession;
};
const preparedMacPage=async(session:string)=>{
  const prepared=await bridge.call("extensions.preparePage");
  if(!prepared||typeof prepared!=="object"||!("token" in prepared)||
     typeof prepared.token!=="string"||!("tabId" in prepared)||typeof prepared.tabId!=="number"){
    throw new Error("Chrome did not return a prepared extension management tab");
  }
  if(await bridgeSession()!==session) throw new Error("Chrome Ops Bridge profile changed before the developer operation");
  return prepared.token;
};
const macDeveloperOperation=async(operation:"reload"|"errors"|"remove",id:string)=>{
  const session=await bridgeSession();
  const token=await preparedMacPage(session);
  const action=await helper(operation,id,token);
  if(await bridgeSession()!==session) throw new Error("Chrome Ops Bridge profile changed during the developer operation");
  return {action,session};
};

server.tool("chrome_status", "Check whether Chrome Ops Host and the Chrome extension are connected.", {}, async () => text(await bridge.status()));
proxy("tabs_list", "List Chrome tabs and their ids, URLs, titles and active state.", {}, "tabs.list");
proxy("tab_activate", "Activate a Chrome tab by id.", { tabId: z.number().int() }, "tabs.activate");
proxy("devtools_attach", "Attach Chrome DevTools Protocol to a tab and start collecting Console, Log and Network events.", { tabId: z.number().int() }, "devtools.attach");
proxy("devtools_detach", "Detach Chrome DevTools Protocol from a tab.", { tabId: z.number().int() }, "devtools.detach");
proxy("console_read", "Read captured console/log entries for a tab.", { tabId: z.number().int(), clear: z.boolean().optional() }, "devtools.consoleRead");
proxy("network_read", "Read captured HTTP/WebSocket/EventSource activity. Cookie, authorization, and cookie-value fields are redacted before leaving Chrome.", { tabId: z.number().int(), clear: z.boolean().optional(), limit: z.number().int().min(1).max(1000).optional() }, "devtools.networkRead");
proxy("network_requests", "List HTTP requests observed since DevTools attach, summarized by request id, URL, method, status and failure state.", { tabId:z.number().int() }, "network.requests");
proxy("network_failures", "List only failed HTTP requests or responses with status >= 400.", { tabId:z.number().int(), failuresOnly:z.literal(true).default(true) }, "network.requests");
proxy("network_response_body", "Get the response body for a captured request id. Use network_requests first to identify the request.", { tabId:z.number().int(), requestId:z.string() }, "network.responseBody");
proxy("websocket_messages", "Read captured WebSocket lifecycle and frame events for a tab.", { tabId:z.number().int() }, "network.webSocket");
proxy("eventsource_messages", "Read captured Server-Sent Events (EventSource) messages for a tab.", { tabId:z.number().int() }, "network.eventSource");
proxy("runtime_evaluate", "Evaluate JavaScript in the inspected tab using Chrome DevTools Protocol Runtime.evaluate.", { tabId: z.number().int(), expression: z.string(), awaitPromise: z.boolean().optional(), returnByValue: z.boolean().optional() }, "devtools.evaluate");
proxy("page_reload", "Reload an inspected tab through Chrome DevTools Protocol so subsequent network activity can be captured.", { tabId: z.number().int(), ignoreCache: z.boolean().optional() }, "devtools.reload");
proxy("extensions_list", "List installed Chrome extensions/apps including enabled and install type.", {}, "extensions.list");
proxy("extension_get", "Get metadata for one installed extension, including install type and enabled state.", { id:z.string() }, "extensions.get");
proxy("extension_set_enabled", "Enable or disable an installed extension. Chrome may require a user gesture/confirmation.", { id: z.string(), enabled: z.boolean() }, "extensions.setEnabled");
proxy("extension_uninstall", "Request uninstall of another extension. Chrome always presents confirmation for another extension.", { id: z.string() }, "extensions.uninstall");
server.tool("extension_dev_load", "Load an unpacked Chrome extension directory through the restricted native helper. The directory must contain manifest.json.", { path:z.string().min(1) }, async ({path})=>{
  if(process.platform!=="darwin") return text(await helper("load",path));
  const directory=await realpath(path);
  if(!(await stat(directory)).isDirectory()||!(await stat(join(directory,"manifest.json"))).isFile()){
    throw new Error("Load path must be a directory containing manifest.json");
  }
  const inventory=async()=>{
    const result=await bridge.call("extensions.list");
    if(!Array.isArray(result)) throw new Error("Chrome extension inventory is unavailable");
    return result as {id?:string;installType?:string}[];
  };
  const originalSession=await bridgeSession();
  const before=new Set((await inventory()).map(entry=>entry?.id).filter((id):id is string=>typeof id==="string"));
  const token=await preparedMacPage(originalSession);
  const action=await helper("load",directory,token);
  if(!action||typeof action!=="object"||!("data" in action)||!action.data||
     typeof action.data!=="object"||!("extensionId" in action.data)||typeof action.data.extensionId!=="string"){
    throw new Error("Native helper did not identify the newly loaded extension");
  }
  const id=action.data.extensionId;
  if(before.has(id)) throw new Error(`Chrome reported an existing extension ${id} as a new load`);
  for(let i=0;i<20;i++){
    const found=(await inventory()).find(entry=>entry?.id===id);
    if(found){
      if(await bridgeSession()!==originalSession) throw new Error("Chrome Ops Bridge profile changed during Load unpacked");
      if(found.installType!=="development") throw new Error(`Loaded extension ${id} is not an unpacked development extension`);
      return text({...action,verifiedLoaded:true,extensionId:id});
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`Chrome management did not report the loaded extension ${id}`);
});
server.tool("extension_dev_reload", "Reload an installed unpacked extension by exact extension id through Chrome's extension-management UI.", { id:z.string().regex(/^[a-p]{32}$/) }, async ({id})=>text(process.platform==="darwin"?(await macDeveloperOperation("reload",id)).action:await helper("reload",id)));
server.tool("extension_dev_errors", "Open the Errors view for an unpacked extension by exact extension id.", { id:z.string().regex(/^[a-p]{32}$/) }, async ({id})=>text(process.platform==="darwin"?(await macDeveloperOperation("errors",id)).action:await helper("errors",id)));
server.tool("extension_dev_remove", "Remove an unpacked extension by exact extension id and verify it disappeared from chrome.management.", { id:z.string().regex(/^[a-p]{32}$/) }, async ({id})=>{
  const operation=process.platform==="darwin"?await macDeveloperOperation("remove",id):{action:await helper("remove",id),session:null};
  const action=operation.action; let removed=false;
  for(let i=0;i<20;i++){
    await new Promise(r=>setTimeout(r,100));
    if(operation.session!==null&&await bridgeSession()!==operation.session) throw new Error("Chrome Ops Bridge profile changed before remove verification");
    const inventory=await bridge.call("extensions.list");
    if(!Array.isArray(inventory)) throw new Error("Chrome extension inventory is unavailable after remove confirmation");
    if(operation.session!==null&&await bridgeSession()!==operation.session) throw new Error("Chrome Ops Bridge profile changed during remove verification");
    if(!inventory.some(entry=>entry && typeof entry==="object" && entry.id===id)){removed=true;break}
  }
  if(!removed) throw new Error(`Chrome still reports extension ${id} after remove confirmation`);
  return text({action,verifiedRemoved:true});
});
proxy("content_setting_get", "Get an effective per-site Chrome content setting.", { kind: z.enum(["cookies","images","javascript","popups","notifications","microphone","camera","automaticDownloads","clipboard"]), primaryUrl: z.string().url() }, "settings.contentGet");
proxy("content_setting_set", "Set a per-site Chrome content setting using the extension API.", { kind: z.enum(["cookies","images","javascript","popups","notifications","microphone","camera","automaticDownloads","clipboard"]), primaryPattern: z.string(), setting: z.enum(["allow","block","ask","session_only"]) }, "settings.contentSet");

await server.connect(new StdioServerTransport());
