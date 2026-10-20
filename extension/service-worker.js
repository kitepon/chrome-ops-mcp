const ENDPOINT = "ws://127.0.0.1:32145";
let ws;
let retry;
let heartbeat;
const consoleEntries = new Map();
const networkEntries = new Map();
const requestIndex = new Map();
const attached = new Set();
// A single request owns these tabs from creation through cleanup. Never route
// general DevTools calls or captured events through an audit tab.
const auditTabs = new Set();
let auditBusy = false;
const auditUrls = Object.freeze({
  "google-connections": "https://myaccount.google.com/connections",
  "google-cloud-projects": "https://console.cloud.google.com/cloud-resource-manager",
  "x-connected-apps": "https://x.com/settings/connected_apps",
  "discord-developer-apps": "https://discord.com/developers/applications",
});
function auditUrlAllowed(service, href, entry) {
  try {
    const url = new URL(href), base = new URL(entry);
    if (url.origin !== base.origin || url.pathname !== base.pathname || url.hash || url.username || url.password) return false;
    const keys = [...url.searchParams.keys()];
    if (keys.length !== new Set(keys).size) return false;
    if (service === "google-connections") return keys.every(key => key === "authuser" && /^[0-9]+$/.test(url.searchParams.get(key)));
    if (service === "google-cloud-projects") return keys.every(key => ["organizationId", "project", "authuser"].includes(key) && /^[A-Za-z0-9-]+$/.test(url.searchParams.get(key)));
    return !url.search;
  } catch { return false; }
}

// This function is serialized into Runtime.evaluate; it has no extension-side
// dependencies. Only named DOM fields are read, never a document/body dump or
// input/textarea values. Unknown layouts deliberately stop the audit.
function auditProject(service) {
  const stopped = stop_reason => ({ status:"stopped", stop_reason });
  const visible = node => !!node && !node.closest('[hidden], [aria-hidden="true"]') &&
    (typeof node.getClientRects !== "function" || node.getClientRects().length > 0);
  const text = node => visible(node) ? (typeof node.innerText === "string" ? node.innerText : node.textContent)?.trim() || null : null;
  const label = node => visible(node) ? node.getAttribute("aria-label") || null : null;
  const fieldText = (row, pattern) => {
    const term = [...row.querySelectorAll("dt")].find(node => pattern.test(text(node) || ""));
    return term?.nextElementSibling?.tagName === "DD" ? text(term.nextElementSibling) : null;
  };
  if (document.querySelector('input[type="password"], form[action*="signin"], form[action*="login"]')) return stopped("login_required");
  const main = document.querySelector('main, [role="main"]');
  if (!main) return stopped("page_shape_changed");
  const listsNamed = pattern => [...main.querySelectorAll('[role="list"], ul')].filter(list => {
    if (!visible(list)) return false;
    const heading = list.getAttribute("aria-labelledby");
    return pattern.test(label(list) || text(heading ? document.getElementById(heading) : null) || "");
  });
  let account = null;
  if (service.startsWith("google-")) {
    const accountButton = document.querySelector('[aria-label^="Google Account:"], [aria-label^="Google アカウント:"]');
    const email = label(accountButton)?.match(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0];
    if (!email) return stopped("account_unknown");
    account = { email };
  }
  if (service === "x-connected-apps") {
    const button = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    const screenName = [...(button?.querySelectorAll('span, [dir="ltr"]') || [])].map(text).find(value => /^@[A-Za-z0-9_]{1,15}$/.test(value || ""));
    if (!screenName || !["@qlyun35332", "@bell_quolu"].includes(screenName.toLowerCase())) return stopped("account_unknown");
    account = { screen_name:screenName };
  }
  // Account checks precede even heading reads: an application's name may itself
  // be a heading. A disallowed X account must never have its inventory read.
  const headings = [...main.querySelectorAll('h1, h2, [role="heading"]')].map(text);
  const items = [], unconfirmed = [];
  const add = (field, reason) => unconfirmed.push({ field, reason });
  let truncated = false, hiddenRows = false;
  if (service === "google-connections") {
    if (!headings.some(value => /^(Your connections to third-party apps (?:&|and) services|Third-party apps (?:&|and) services|サードパーティのアプリとサービス(?:との接続)?)$/i.test(value || ""))) return stopped("page_shape_changed");
    const lists = listsNamed(/^(Third-party apps (?:&|and) services|Sign in with Google|サードパーティのアプリとサービス|Google でログイン)$/i);
    if (!lists.length) return stopped("page_shape_changed");
    for (const row of lists.flatMap(list => [...list.querySelectorAll(':scope > [role="listitem"], :scope > li')])) {
      if (!visible(row)) { hiddenRows = true; continue; }
      const name = text(row.querySelector('h3, h2, [role="heading"]'));
      if (!name) return stopped("page_shape_changed");
      const sectionName = text(row.closest("section")?.querySelector('h2, [role="heading"]'));
      const section = /^(Sign in with Google|Google でログイン|Third-party apps (?:&|and) services|サードパーティのアプリとサービス)$/i.test(sectionName || "") ? sectionName : null;
      items.push({ name, section,
        access:fieldText(row, /^(Access|Permissions|アクセス権|アクセス権限|権限)$/i),
        since:fieldText(row, /^(Connected since|Since|接続日|接続開始日)$/i),
      });
      if (items.length > 200) { truncated = true; break; }
    }
    if (items.some(item => !item.access)) add("access", "needs_click");
    if (items.some(item => !item.since)) add("since", "not_found");
    if (items.some(item => !item.section)) add("section", "not_found");
  } else if (service === "google-cloud-projects") {
    const tables = [...main.querySelectorAll('table, [role="grid"]')];
    let table, columns;
    for (const candidate of tables) {
      if (!visible(candidate)) continue;
      const headers = [...candidate.querySelectorAll('th, [role="columnheader"]')].map(text);
      const name = headers.findIndex(value => /^(Project name|Name|プロジェクト名|名前)$/i.test(value || ""));
      const project_id = headers.findIndex(value => /^(Project ID|プロジェクト\s*ID)$/i.test(value || ""));
      if (name >= 0 && project_id >= 0) { table = candidate; columns = { name, project_id, state:headers.findIndex(value => /^(Status|State|ステータス|状態)$/i.test(value || "")) }; break; }
    }
    if (!table) return stopped("page_shape_changed");
    for (const row of table.querySelectorAll('tbody tr, [role="row"]')) {
      if (!visible(row)) { hiddenRows = true; continue; }
      const cells = [...row.querySelectorAll('td, [role="gridcell"]')];
      if (!cells.length) continue;
      const name = text(cells[columns.name]), project_id = text(cells[columns.project_id]);
      if (!name || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project_id || "")) return stopped("page_shape_changed");
      items.push({ name, project_id, state:text(cells[columns.state]) });
      if (items.length > 200) { truncated = true; break; }
    }
    add("organization", "needs_click"); add("pagination", "needs_click");
    if (items.some(item => !item.state)) add("state", "not_found");
  } else {
    const x = service === "x-connected-apps";
    if (!headings.some(value => x ? /^(Connected apps|連携しているアプリ)$/i.test(value || "") : /^(Applications|My Applications|アプリケーション)$/i.test(value || ""))) return stopped("page_shape_changed");
    const seen = new Set();
    for (const link of main.querySelectorAll("a[href]")) {
      if (!visible(link)) { hiddenRows = true; continue; }
      let url;
      try { url = new URL(link.getAttribute("href"), location.href); } catch { continue; }
      if (url.origin !== location.origin || url.search || url.hash) continue;
      const match = x ? url.pathname.match(/^\/settings\/connected_apps\/([0-9]+)$/) : url.pathname.match(/^\/developers\/applications\/([0-9]{17,20})(?:\/(?:information|bot))?$/);
      if (!match || seen.has(match[1])) continue;
      seen.add(match[1]);
      const name = text(link.querySelector('h2, h3, [role="heading"], [dir="auto"]'));
      if (!name) return stopped("page_shape_changed");
      items.push(x ? { name, detail_path:url.pathname, permissions:null, granted:null } : {
        name, application_id:match[1], public_bot:null, requires_code_grant:null,
        presence_intent:null, server_members_intent:null, message_content_intent:null,
      });
      if (items.length > 200) { truncated = true; break; }
    }
    // A heading alone is not proof of an empty inventory.
    if (!items.length && !listsNamed(x ? /^(Connected apps|連携しているアプリ)$/i : /^(Applications|My Applications|アプリケーション)$/i).length) return stopped("page_shape_changed");
    if (x) { add("permissions", "needs_click"); add("granted", "needs_click"); }
    else for (const field of ["public_bot", "requires_code_grant", "presence_intent", "server_members_intent", "message_content_intent"]) add(field, "needs_click");
  }
  if (hiddenRows) add("items", "not_found");
  return { status:"ok", stop_reason:null, account, items:items.slice(0, 200), truncated, unconfirmed };
}

async function auditResult(service, raw) {
  const empty = { service, status:"stopped", stop_reason:"page_shape_changed", account:null, items:[], item_count:0, truncated:false, unconfirmed:[] };
  if (!raw || typeof raw !== "object") return empty;
  if (raw.status === "stopped") return { ...empty, stop_reason:["login_required", "account_unknown", "url_mismatch"].includes(raw.stop_reason) ? raw.stop_reason : "page_shape_changed" };
  if (raw.status !== "ok" || !Array.isArray(raw.items) || !Array.isArray(raw.unconfirmed)) return empty;
  const clean = value => typeof value === "string" ? [...value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "")].slice(0, 200).join("") : null;
  let account = null;
  if (service.startsWith("google-")) {
    const email = raw.account?.email?.trim().toLowerCase();
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ...empty, stop_reason:"account_unknown" };
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
    account = { email_sha256:[...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join(""), domain:clean(email.split("@")[1]) };
  } else if (service === "x-connected-apps") {
    if (!["@qlyun35332", "@bell_quolu"].includes(raw.account?.screen_name?.toLowerCase())) return { ...empty, stop_reason:"account_unknown" };
    account = { screen_name:raw.account.screen_name };
  }
  const fields = {
    "google-connections":["name", "section", "access", "since"],
    "google-cloud-projects":["name", "project_id", "state"],
    "x-connected-apps":["name", "detail_path", "permissions", "granted"],
    "discord-developer-apps":["name", "application_id", "public_bot", "requires_code_grant", "presence_intent", "server_members_intent", "message_content_intent"],
  }[service];
  const items = raw.items.slice(0, 200).map(item => Object.fromEntries(fields.map(field => [field, clean(item?.[field])])));
  if (items.some(item => !item.name)) return empty;
  const unconfirmed = raw.unconfirmed.slice(0, 32).filter(item => typeof item?.field === "string" && ["needs_click", "not_found", "not_supported"].includes(item.reason)).map(item => ({ field:clean(item.field), reason:item.reason }));
  return { service, status:"ok", stop_reason:null, account, items, item_count:items.length, truncated:raw.truncated === true || raw.items.length > 200, unconfirmed };
}

async function closeAuditTab(tabId) {
  try { await chrome.tabs.remove(tabId); }
  catch {
    // A tab already closed by the user needs no further cleanup. Do not mistake
    // an API failure for absence, and keep ownership if a close really failed.
    const tabs = await chrome.tabs.query({});
    if (tabs.some(tab => tab.id === tabId)) throw new Error("Audit tab cleanup failed");
  }
  auditTabs.delete(tabId);
  await chrome.storage.session.set({ auditPendingTabIds:[...auditTabs] });
}

async function auditRead(p) {
  const service = p.service;
  if (Object.keys(p).some(key => key !== "service") ||
      typeof service !== "string") throw new Error("Invalid audit request");
  const unconfirmed = stop_reason => ({ service, status:"stopped", stop_reason, account:null, items:[], item_count:0, truncated:false, unconfirmed:[] });
  if (service === "discord-authorized-apps") return { ...unconfirmed(null), status:"ok", unconfirmed:[{ field:"all", reason:"not_supported" }] };
  if (!Object.hasOwn(auditUrls, service)) throw new Error("Unsupported audit service");
  if (chrome.extension.inIncognitoContext) return unconfirmed("no_window");
  if (auditBusy) return unconfirmed("busy");
  auditBusy = true;
  let tabId;
  let result;
  try {
    const { auditPendingTabIds = [] } = await chrome.storage.session.get("auditPendingTabIds");
    if (!Array.isArray(auditPendingTabIds) || auditPendingTabIds.length > 8 || auditPendingTabIds.some(id => !Number.isInteger(id))) throw new Error("Invalid audit recovery state");
    for (const id of auditPendingTabIds) auditTabs.add(id);
    // Retry any earlier close failure before opening another tab.
    for (const id of auditTabs) await closeAuditTab(id);
    const windows = (await chrome.windows.getAll({ windowTypes:["normal"] })).filter(w => !w.incognito);
    if (!windows.length) return unconfirmed("no_window");
    const last = await chrome.windows.getLastFocused({ windowTypes:["normal"] });
    const target = windows.find(w => w.id === last?.id) ?? (windows.length === 1 ? windows[0] : null);
    if (!target) return unconfirmed("no_window");
    const url = auditUrls[service];
    const tab = await chrome.tabs.create({ windowId:target.id, url, active:false });
    if (!Number.isInteger(tab.id)) throw new Error("Audit tab creation failed");
    tabId = tab.id;
    auditTabs.add(tabId);
    await chrome.storage.session.set({ auditPendingTabIds:[...auditTabs] });
    let ready = false;
    // Keep the whole request inside the Host's 15-second deadline. A slow or
    // redirected page is unconfirmed; it is never an empty app inventory.
    for (let i = 0; i < 60; i++) {
      const current = await chrome.tabs.get(tabId);
      if (current.pendingUrl && !auditUrlAllowed(service, current.pendingUrl, url)) { result = unconfirmed("redirect"); break; }
      if (current.status === "complete") {
        if (!auditUrlAllowed(service, current.url, url)) result = unconfirmed("redirect");
        else ready = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) result ??= unconfirmed("timeout");
    else {
      // Deliberately do NOT use ensureAttached(): it enables Runtime/Log/Network
      // event streams. A new audit tab has no pre-existing debugger attachment.
      await chrome.debugger.attach({ tabId }, "1.3");
      const evaluated = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        // The guard executes in the same document as the fixed projection.
        // URL checks before/after alone leave a navigation race.
        expression:`(() => { if (!(${auditUrlAllowed.toString()})(${JSON.stringify(service)}, location.href, ${JSON.stringify(url)})) return {status:"stopped",stop_reason:"url_mismatch"}; return (${auditProject.toString()})(${JSON.stringify(service)}); })()`,
        returnByValue:true, awaitPromise:false,
        timeout:1000, silent:true, allowUnsafeEvalBlockedByCSP:false,
      });
      const current = await chrome.tabs.get(tabId);
      if (!auditUrlAllowed(service, current.url, url) || (current.pendingUrl && !auditUrlAllowed(service, current.pendingUrl, url))) result = unconfirmed("url_mismatch");
      else if (evaluated.exceptionDetails || !evaluated.result ||
               !Object.hasOwn(evaluated.result, "value") || evaluated.result.subtype === "promise") result = unconfirmed("page_shape_changed");
      else result = await auditResult(service, evaluated.result.value);
    }
  } catch {
    // Never forward CDP exception text, page content, or browser API errors.
    result = unconfirmed(tabId === undefined && auditTabs.size ? "cleanup_failed" : "read_failed");
  } finally {
    try {
      if (tabId !== undefined) {
        try { await chrome.debugger.detach({ tabId }); } catch { /* Closing also detaches. */ }
        try { await closeAuditTab(tabId); } catch { result = unconfirmed("cleanup_failed"); }
      }
    } finally { auditBusy = false; }
  }
  return result;
}

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
  if (auditTabs.has(id) || !attached.has(id)) return;
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
  if (Number.isInteger(p.tabId) && auditTabs.has(p.tabId)) throw new Error("Audit tabs are private to their read request");
  switch (method) {
    case "audit.read": return auditRead(p);
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
      // getURL reads the files on disk, which change before the running worker is reloaded; the in-memory manifest does not.
      return { preparePage:true, reloadSelf:true, sourceHash:await hash("service-worker.js"), manifestHash:await hash("manifest.json"), runningVersion:chrome.runtime.getManifest().version };
    }
    case "extensions.reloadSelf": {
      if (auditBusy || auditTabs.size) throw new Error("Finish audit tab cleanup before reloading the Bridge");
      // Answer first; the reload ends this worker and its Host connection.
      setTimeout(() => chrome.runtime.reload(), 200);
      return { reloading:true };
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
