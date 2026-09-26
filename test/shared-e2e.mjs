import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const url = `http://127.0.0.1:${process.env.CHROME_OPS_TEST_PORT ?? 32147}/chrome-ops-e2e`;
const client = new Client({name:"chrome-ops-shared-e2e",version:"0.1.0"});
const call = async (name, args = {}) => {
  const result = await client.callTool({name, arguments:args});
  assert.ok(!result.isError, `${name}: ${result.content?.[0]?.text}`);
  return JSON.parse(result.content[0].text);
};
const waitFor = async (read, match) => {
  for (let i=0; i<50; i++) {
    const value = await read();
    if (match(value)) return value;
    await new Promise(resolve => setTimeout(resolve,100));
  }
  throw new Error("Timed out waiting for E2E postcondition");
};
let tab;
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:["dist/index.js"]}));
  assert.equal((await call("chrome_status")).connected, true);
  const targets = (await call("tabs_list")).filter(tab => tab.url === url);
  assert.equal(targets.length, 1, `Open exactly one test tab: ${url}`);
  tab = targets[0];
  assert.equal((await call("devtools_attach", {tabId:tab.id})).attached, true);
  const evaluate = async expression => {
    const result = await call("runtime_evaluate", {tabId:tab.id,expression});
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  assert.equal(await evaluate("document.title"), "Chrome Ops E2E");
  await call("page_reload", {tabId:tab.id});
  await waitFor(() => call("console_read", {tabId:tab.id}), value => JSON.stringify(value).includes("chrome-ops-e2e-ready"));
  const token = randomUUID(); // Synthetic credential, generated at runtime and never printed.
  const run = randomUUID(); // Distinguish this run from previously captured requests.
  assert.equal(await evaluate(`(async()=>{
    document.cookie='chrome_ops_fixture=${token}; SameSite=Strict';
    await (await fetch('/ok?run=${run}',{headers:{Authorization:'Bearer ${token}'}})).text();
    await (await fetch('/fail?run=${run}')).text();
    await new Promise((resolve,reject)=>{const e=new EventSource('/events');e.onmessage=()=>{e.close();resolve()};e.onerror=()=>{e.close();reject(new Error('SSE failed'))}});
    await new Promise((resolve,reject)=>{const w=new WebSocket('ws://'+location.host+'/ws');w.onopen=()=>w.send('chrome-ops-e2e-ws');w.onmessage=()=>{w.close();resolve()};w.onerror=()=>reject(new Error('WebSocket failed'))});
    document.cookie='chrome_ops_fixture=; Max-Age=0'; return true;
  })()`), true);
  const requests = await waitFor(() => call("network_requests", {tabId:tab.id}), value => value.some(r => r.url.endsWith(`/fail?run=${run}`) && r.status === 503));
  const response = requests.find(r => r.url.endsWith(`/ok?run=${run}`) && r.status === 200);
  assert.ok(response);
  await waitFor(() => call("network_read", {tabId:tab.id,limit:1000}), value => value.some(e => e.method === "Network.loadingFinished" && e.params.requestId === response.requestId));
  assert.equal((await call("network_response_body", {tabId:tab.id,requestId:response.requestId})).body, "chrome-ops-e2e-response");
  assert.ok((await call("network_failures", {tabId:tab.id,failuresOnly:true})).some(r=>r.status===503));
  assert.ok(JSON.stringify(await call("websocket_messages", {tabId:tab.id})).includes("chrome-ops-e2e-ws"));
  assert.ok(JSON.stringify(await call("eventsource_messages", {tabId:tab.id})).includes("chrome-ops-e2e-sse"));
  const network = JSON.stringify(await call("network_read", {tabId:tab.id,limit:1000}));
  assert.ok(network.includes("[REDACTED]"));
  if (network.includes(token)) {
    const paths = [];
    const locate = (value, path) => {
      if (typeof value === "string" && value.includes(token)) paths.push(path);
      else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) locate(child, `${path}.${key}`);
    };
    for (const event of JSON.parse(network)) locate(event.params, event.method);
    console.error("Synthetic credential found at (values omitted):", paths);
  }
  assert.ok(!network.includes(token), "Synthetic credential leaked");
  console.log("PASS: stdio/Host/Chrome, tabs, attach, evaluate, reload, Console, HTTP, failures, response body, WebSocket, SSE, credential redaction");
} finally {
  if (tab) await call("devtools_detach", {tabId:tab.id});
  await client.close();
}
