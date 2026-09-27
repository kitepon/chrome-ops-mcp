// Talk to the persistent Chrome Ops Host from setup and doctor scripts.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));

export function hostCall(method, params = {}) {
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

export const hostStatus = () => hostCall("host.status");

export async function waitFor(predicate, description, limitMs = 5000) {
  const deadline = Date.now() + limitMs;
  do {
    if (await predicate()) return;
    await sleep(120);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}`);
}

// The Bridge reports hashes of the files on disk and the version of the manifest it is running.
// Replacing the files alone changes the hashes but not the running version.
export function bridgeExpectation() {
  const sha256 = path => createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex");
  const version = JSON.parse(readFileSync(resolve(root, "extension/manifest.json"), "utf8")).version;
  return { sourceHash: sha256("extension/service-worker.js"), manifestHash: sha256("extension/manifest.json"), version };
}

export async function bridgeIsCurrent(expected = bridgeExpectation()) {
  let capabilities;
  try { capabilities = await hostCall("extensions.capabilities"); }
  catch (error) {
    if (error.message === "Unknown method: extensions.capabilities") return false;
    throw error;
  }
  return capabilities?.preparePage === true && capabilities.sourceHash === expected.sourceHash &&
    capabilities.manifestHash === expected.manifestHash && capabilities.runningVersion === expected.version;
}

// Bridges from 0.2.3 reload themselves from disk, so setup needs no browser UI input.
export async function reloadBridgeItself(status) {
  let capabilities;
  try { capabilities = await hostCall("extensions.capabilities"); } catch { return false; }
  if (capabilities?.reloadSelf !== true) return false;
  await hostCall("extensions.reloadSelf");
  await waitFor(async () => {
    const now = await hostStatus();
    if (now.ambiguousProfiles) throw new Error("Multiple Bridge profiles connected after update");
    return now.connected && now.bridgeSession !== status.bridgeSession && await bridgeIsCurrent();
  }, "reloaded Chrome Ops Bridge to reconnect with the expected source", 45000);
  return true;
}
