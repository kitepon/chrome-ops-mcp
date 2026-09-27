// Bring an already connected unpacked Bridge up to date with this checkout. Shared by every OS.
import { createHash } from "node:crypto";
import { bridgeIsCurrent, hostCall, hostStatus, reloadBridgeItself, waitFor } from "./host-client.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");

export async function updateBridge(os) {
  const status = await hostStatus();
  if (status.ambiguousProfiles) throw new Error("Multiple Chrome Ops Bridge profiles are connected; close the unintended Bridge profile before setup");
  if (!status.connected) return { connected: false, bridgeUpdated: false };
  if (await bridgeIsCurrent()) return { connected: true, bridgeUpdated: false };
  if (await reloadBridgeItself(status)) return { connected: true, bridgeUpdated: true };
  // Bridges older than 0.2.3 cannot reload themselves; only an OS helper can press their reload control.
  if (!os.nativeBridgeUpdate) throw new Error("The connected Chrome Ops Bridge is older than 0.2.3; reload it once from chrome://extensions");
  const extensions = await hostCall("extensions.list");
  const matches = Array.isArray(extensions) ? extensions.filter(item => item?.name === "Chrome Ops MCP Bridge" && item.installType === "development" && item.enabled === true) : [];
  if (matches.length !== 1) throw new Error("Expected exactly one enabled unpacked Chrome Ops MCP Bridge in the connected profile");
  const tabs = await hostCall("tabs.list");
  const hashes = (Array.isArray(tabs) ? tabs : []).filter(tab => tab?.active === true && typeof tab.url === "string" && tab.url.length > 0).map(tab => sha256(tab.url));
  if (hashes.length === 0) throw new Error("No active Bridge-profile tab can identify a Chrome window; no browser input was sent");
  const before = await hostStatus();
  if (!before.connected || before.bridgeSession !== status.bridgeSession) throw new Error("Bridge profile changed during setup; no browser input was sent");
  os.nativeBridgeUpdate(matches[0].id, hashes);
  await waitFor(async () => {
    const now = await hostStatus();
    if (now.ambiguousProfiles) throw new Error("Multiple Bridge profiles connected after update");
    return now.connected && now.bridgeSession !== status.bridgeSession && await bridgeIsCurrent();
  }, "updated Chrome Ops Bridge to reconnect with the expected source", 12000);
  return { connected: true, bridgeUpdated: true };
}
