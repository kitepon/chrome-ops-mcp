// Update an already connected unpacked Chrome Ops Bridge on Windows so its worker matches this checkout.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bridgeIsCurrent, hostCall, reloadBridgeItself, root, waitFor } from "./host-client.mjs";

const helper = resolve(root, "helper/windows/chrome-ops-helper.ps1");
const sha256 = value => createHash("sha256").update(value).digest("hex");

export async function updateBridge({ waitConnected = false } = {}) {
  await waitFor(async () => { try { return (await hostCall("host.status")).host === true; } catch { return false; } }, "Chrome Ops Host", 15000);
  // A Bridge that was connected before the Host restart comes back within its 30-second reconnect alarm.
  if (waitConnected) await waitFor(async () => (await hostCall("host.status")).connected === true, "the previously connected Chrome Ops Bridge to reconnect", 45000);
  const status = await hostCall("host.status");
  if (status.ambiguousProfiles) throw new Error("Multiple Chrome Ops Bridge profiles are connected; close the unintended Bridge profile before setup");
  if (!status.connected) return { connected: false, bridgeUpdated: false };
  if (await bridgeIsCurrent()) return { connected: true, bridgeUpdated: false };
  if (await reloadBridgeItself(status)) return { connected: true, bridgeUpdated: true };
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
    return now.connected && now.bridgeSession !== status.bridgeSession && await bridgeIsCurrent();
  }, "updated Chrome Ops Bridge to reconnect with the expected source", 12000);
  return { connected: true, bridgeUpdated: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--connected")) {
    console.log(String(await hostCall("host.status").then(status => status.connected === true, () => false)));
    process.exit(0);
  }
  updateBridge({ waitConnected: process.argv.includes("--wait-connected") }).then(result => console.log(JSON.stringify({ ok: true, ...result })), error => {
    console.log(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  });
}
