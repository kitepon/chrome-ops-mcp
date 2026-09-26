const ENDPOINT = "ws://127.0.0.1:32145";
let ws;
let retry;
let heartbeat;
const consoleEntries = new Map();
const networkEntries = new Map();
const requestIndex = new Map();
const attached = new Set();

function push(map, id, value, max = 2000) {
  const a = map.get(id) || []; a.push({ ts: Date.now(), ...value });
  if (a.length > max) a.splice(0, a.length - max); map.set(id, a);
}
function sanitize(value, key = "") {
  // CDPは認証ヘッダーをオブジェクトだけでなく生のヘッダー文字列にも重複して入れる。
  const sensitive = /^(cookie|set-cookie|authorization|proxy-authorization|value|headersText|requestHeadersText|cookieLine)$/i;
  if (sensitive.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map(v => sanitize(v));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, sanitize(v,k)]));
  return value;
}
function connect() {
  clearTimeout(retry);
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  const socket = new WebSocket(ENDPOINT);
  ws = socket;
  socket.onopen = () => {
    socket.send(JSON.stringify({ type:"hello", role:"chrome-extension", protocol:1 }));
    clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type:"event", event:"heartbeat", data:{ ts:Date.now() } }));
    }, 20000);
  };
  socket.onmessage = async e => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type !== "request") return;
    try { respond(socket, msg.id, true, await dispatch(msg.method, msg.params || {})); }
    catch (e) { respond(socket, msg.id, false, undefined, e?.message || String(e)); }
  };
  socket.onclose = () => {
    if (ws !== socket) return;
    clearInterval(heartbeat);
    retry = setTimeout(connect, 1500);
  };
  socket.onerror = () => socket.close();
}
function respond(socket, id, ok, result, error) { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id, type:"response", ok, result, error })); }

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.action.onClicked.addListener(connect);
// While the Host is down the worker goes idle and its retry timer dies with it; an alarm wakes it to reconnect.
chrome.alarms.create("reconnect", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "reconnect") connect(); });
connect();

chrome.debugger.onDetach.addListener(source => { if (source.tabId != null) attached.delete(source.tabId); });
chrome.debugger.onEvent.addListener((source, method, params) => {
  const id = source.tabId; if (id == null) return;
  if (method === "Runtime.consoleAPICalled" || method === "Runtime.exceptionThrown" || method === "Log.entryAdded") push(consoleEntries, id, { method, params });
  if (method.startsWith("Network.")) push(networkEntries, id, { method, params });
  if (method === "Network.requestWillBeSent") {
    const m = requestIndex.get(id) || new Map();
    m.set(params.requestId, { requestId:params.requestId, url:params.request.url, method:params.request.method, type:params.type, startedAt:params.timestamp }); requestIndex.set(id,m);
  }
  if (method === "Network.responseReceived") {
    const m = requestIndex.get(id) || new Map(); const r=m.get(params.requestId)||{requestId:params.requestId};
    Object.assign(r,{url:params.response.url,status:params.response.status,statusText:params.response.statusText,mimeType:params.response.mimeType,type:params.type,remoteIPAddress:params.response.remoteIPAddress}); m.set(params.requestId,r); requestIndex.set(id,m);
  }
  if (method === "Network.loadingFailed") {
    const m=requestIndex.get(id)||new Map(); const r=m.get(params.requestId)||{requestId:params.requestId}; Object.assign(r,{failed:true,errorText:params.errorText,canceled:params.canceled}); m.set(params.requestId,r); requestIndex.set(id,m);
  }
});

async function ensureAttached(tabId) {
  if (!attached.has(tabId)) {
    await chrome.debugger.attach({ tabId }, "1.3"); attached.add(tabId);
    await Promise.all(["Runtime.enable","Log.enable","Network.enable"].map(m => chrome.debugger.sendCommand({ tabId }, m)));
  }
}
async function dispatch(method, p) {
  switch (method) {
    case "tabs.list": return (await chrome.tabs.query({})).map(t => ({ id:t.id, title:t.title, url:t.url, active:t.active, windowId:t.windowId }));
    case "tabs.activate": await chrome.tabs.update(p.tabId, { active:true }); return { ok:true };
    case "devtools.attach": await ensureAttached(p.tabId); return { attached:true, tabId:p.tabId };
    case "devtools.detach": if (attached.has(p.tabId)) await chrome.debugger.detach({tabId:p.tabId}); attached.delete(p.tabId); return { attached:false };
    case "devtools.consoleRead": { const v = consoleEntries.get(p.tabId)||[]; if(p.clear) consoleEntries.set(p.tabId,[]); return v; }
    case "devtools.networkRead": { const v = networkEntries.get(p.tabId)||[]; const out = p.limit ? v.slice(-p.limit) : v; if(p.clear) networkEntries.set(p.tabId,[]); return sanitize(out); }
    case "network.requests": { const all=[...(requestIndex.get(p.tabId)?.values()||[])]; return sanitize(all.filter(r => !p.failuresOnly || r.failed || (r.status>=400))); }
    case "network.responseBody": { await ensureAttached(p.tabId); const body=await chrome.debugger.sendCommand({tabId:p.tabId},"Network.getResponseBody",{requestId:p.requestId}); return {requestId:p.requestId,base64Encoded:body.base64Encoded,body:body.body}; }
    case "network.webSocket": { const v=networkEntries.get(p.tabId)||[]; return sanitize(v.filter(e => e.method.startsWith("Network.webSocket"))); }
    case "network.eventSource": { const v=networkEntries.get(p.tabId)||[]; return sanitize(v.filter(e => e.method === "Network.eventSourceMessageReceived")); }
    case "devtools.evaluate": await ensureAttached(p.tabId); return chrome.debugger.sendCommand({tabId:p.tabId}, "Runtime.evaluate", { expression:p.expression, awaitPromise:p.awaitPromise??true, returnByValue:p.returnByValue??true });
    case "devtools.reload": await ensureAttached(p.tabId); await chrome.debugger.sendCommand({tabId:p.tabId}, "Page.reload", {ignoreCache:p.ignoreCache??false}); return {reloading:true};
    case "extensions.list": return chrome.management.getAll();
    case "extensions.get": return chrome.management.get(p.id);
    case "extensions.capabilities": {
      const hash = async path => {
        const bytes = await (await fetch(chrome.runtime.getURL(path))).arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
      };
      return { preparePage:true, sourceHash:await hash("service-worker.js"), manifestHash:await hash("manifest.json") };
    }
    case "extensions.preparePage": {
      if (chrome.extension.inIncognitoContext) throw new Error("Chrome Ops Bridge is running in an incognito profile");
      const windows = (await chrome.windows.getAll({ windowTypes:["normal"] })).filter(w => !w.incognito);
      const last = windows.length ? await chrome.windows.getLastFocused({ windowTypes:["normal"] }) : null;
      const target = last && !last.incognito && windows.some(w => w.id === last.id)
        ? last : windows.length === 1 ? windows[0] : null;
      if (windows.length && !target) throw new Error("The Bridge profile has multiple Chrome windows and no unique last-focused normal window");
      const token = crypto.randomUUID();
      const url = `chrome://extensions/?chromeOps=${token}`;
      let windowId, tab;
      if (target) {
        windowId = target.id;
        tab = await chrome.tabs.create({ windowId, url, active:true });
      } else {
        const created = await chrome.windows.create({ url, focused:true, incognito:false });
        windowId = created.id;
        const matches = await chrome.tabs.query({ windowId, active:true });
        if (matches.length !== 1) throw new Error("Chrome did not return one extension management tab");
        tab = matches[0];
      }
      if (windowId == null) throw new Error("Chrome did not return a normal window for extension management");
      if (tab.id == null) throw new Error("Chrome did not return the extension management tab ID");
      try { await chrome.windows.update(windowId, { focused:true }); }
      catch (error) { await chrome.tabs.remove(tab.id); throw error; }
      return { token, tabId:tab.id };
    }
    case "extensions.setEnabled": await chrome.management.setEnabled(p.id,p.enabled); return chrome.management.get(p.id);
    case "extensions.uninstall": await chrome.management.uninstall(p.id,{showConfirmDialog:true}); return {requested:true};
    case "settings.contentGet": { const api=chrome.contentSettings[p.kind]; if(!api) throw new Error(`Unsupported setting: ${p.kind}`); return api.get({primaryUrl:p.primaryUrl}); }
    case "settings.contentSet": { const api=chrome.contentSettings[p.kind]; if(!api) throw new Error(`Unsupported setting: ${p.kind}`); await api.set({primaryPattern:p.primaryPattern,setting:p.setting}); return {ok:true}; }
    default: throw new Error(`Unknown method: ${method}`);
  }
}
