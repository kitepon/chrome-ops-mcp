import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ChromeBridgeClient } from "./bridge.js";
import { helper } from "./helper.js";

const bridge = new ChromeBridgeClient();
const server = new McpServer({ name: "chrome-ops-mcp", version: "0.1.0" });
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const proxy = (name: string, description: string, schema: Record<string, z.ZodTypeAny>, method = name) =>
  server.tool(name, description, schema, async args => text(await bridge.call(method, args)));

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
server.tool("extension_dev_load", "Load an unpacked Chrome extension directory through the restricted Windows helper. The directory must contain manifest.json.", { path:z.string().min(1) }, async ({path})=>text(await helper("load",path)));
server.tool("extension_dev_reload", "Reload an installed unpacked extension by exact extension id through Chrome's extension-management UI.", { id:z.string().regex(/^[a-p]{32}$/) }, async ({id})=>text(await helper("reload",id)));
server.tool("extension_dev_errors", "Open the Errors view for an unpacked extension by exact extension id.", { id:z.string().regex(/^[a-p]{32}$/) }, async ({id})=>text(await helper("errors",id)));
server.tool("extension_dev_remove", "Remove an unpacked extension by exact extension id and verify it disappeared from chrome.management.", { id:z.string().regex(/^[a-p]{32}$/) }, async ({id})=>{
  const action=await helper("remove",id); let removed=false;
  for(let i=0;i<20;i++){await new Promise(r=>setTimeout(r,100));try{await bridge.call("extensions.get",{id})}catch{removed=true;break}}
  if(!removed) throw new Error(`Chrome still reports extension ${id} after remove confirmation`);
  return text({action,verifiedRemoved:true});
});
proxy("content_setting_get", "Get an effective per-site Chrome content setting.", { kind: z.enum(["cookies","images","javascript","popups","notifications","microphone","camera","automaticDownloads","clipboard"]), primaryUrl: z.string().url() }, "settings.contentGet");
proxy("content_setting_set", "Set a per-site Chrome content setting using the extension API.", { kind: z.enum(["cookies","images","javascript","popups","notifications","microphone","camera","automaticDownloads","clipboard"]), primaryPattern: z.string(), setting: z.enum(["allow","block","ask","session_only"]) }, "settings.contentSet");

await server.connect(new StdioServerTransport());
