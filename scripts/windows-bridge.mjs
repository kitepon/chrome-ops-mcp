// Update an already connected unpacked Chrome Ops Bridge on Windows so its worker matches this checkout.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const helper = resolve(root, "helper/windows/chrome-ops-helper.ps1");
const sha256 = value => createHash("sha256").update(value).digest("hex");

function hostCall(method, params = {}) {
  return new Promise((resolvePromise, reject) => {
    const socket = new WebSocket("ws://127.0.0.1:32146");
    const id = randomUUID();
    const timer = setTimeout(() => { socket.terminate(); reject(new Error(`Host request timed out: ${method}`)); }, 17000);
    socket.on("open", () => socket.send(JSON.stringify({ id, type: "request", method, params })));
    socket.on("message", raw => {
      let response;
      try { response = JSON.parse(raw.toString()); } catch (error) { clearTimeout(timer); socket.close(); reject(error); return; }
      if (response.id !== id) return;
      clearTimeout(timer);
      socket.close();
      response.ok ? resolvePromise(response.result) : reject(new Error(response.error));
    });
    socket.on("error", error => { clearTimeout(timer); reject(error); });
  });
}

async function waitFor(check, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export async function updateBridge() {
  await waitFor(async () => { try { return (await hostCall("host.status")).host === true; } catch { return false; } }, "Chrome Ops Host", 15000);
  const status = await hostCall("host.status");
  if (status.ambiguousProfiles) throw new Error("Multiple Chrome Ops Bridge profiles are connected; close the unintended Bridge profile before setup");
  if (!status.connected) return { connected: false, bridgeUpdated: false };
  const sourceHash = sha256(readFileSync(resolve(root, "extension/service-worker.js")));
  const manifestHash = sha256(readFileSync(resolve(root, "extension/manifest.json")));
  const version = JSON.parse(readFileSync(resolve(root, "extension/manifest.json"), "utf8")).version;
  const current = async () => {
    try {
      const capabilities = await hostCall("extensions.capabilities");
      return capabilities?.preparePage === true && capabilities.sourceHash === sourceHash && capabilities.manifestHash === manifestHash && capabilities.runningVersion === version;
    } catch (error) {
      if (error.message === "Unknown method: extensions.capabilities") return false;
      throw error;
    }
  };
  if (await current()) return { connected: true, bridgeUpdated: false };
  const extensions = await hostCall("extensions.list");
  const matches = Array.isArray(extensions) ? extensions.filter(item => item?.name === "Chrome Ops MCP Bridge" && item.installType === "development" && item.enabled === true) : [];
  if (matches.length !== 1) throw new Error("Expected exactly one enabled unpacked Chrome Ops MCP Bridge in the connected profile");
  const tabs = await hostCall("tabs.list");
  const hashes = (Array.isArray(tabs) ? tabs : []).filter(tab => tab?.active === true && typeof tab.url === "string" && tab.url.length > 0).map(tab => sha256(tab.url));
  if (hashes.length === 0) throw new Error("No active Bridge-profile tab can identify a Chrome window; no browser input was sent");
  const result = spawnSync("pwsh", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper, "-Operation", "bootstrap", "-ExtensionId", matches[0].id, "-ActiveUrlHashes", JSON.stringify(hashes)], { encoding: "utf8", windowsHide: true });
  let response;
  try { response = JSON.parse(result.stdout.trim()); } catch { throw new Error(`Native Bridge update returned invalid output: ${result.stderr || result.stdout}`); }
  if (response.ok !== true) throw new Error(`Native Bridge update did not complete: ${response.error}`);
  await waitFor(async () => {
    const now = await hostCall("host.status");
    if (now.ambiguousProfiles) throw new Error("Multiple Bridge profiles connected after update");
    return now.connected && now.bridgeSession !== status.bridgeSession && await current();
  }, "updated Chrome Ops Bridge to reconnect with the expected source", 12000);
  return { connected: true, bridgeUpdated: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  updateBridge().then(result => console.log(JSON.stringify({ ok: true, ...result })), error => {
    console.log(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  });
}
