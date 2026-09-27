#!/usr/bin/env node
// Setup entry point: setup | uninstall | doctor | register [harness].
// This file and scripts/lib/ are shared; scripts/os/ holds OS code and scripts/harness/ holds harness code.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { updateBridge } from "./lib/bridge-update.mjs";
import { hostStatus, root, waitFor } from "./lib/host-client.mjs";
import { harnessNamed, inspect, register } from "./lib/registration.mjs";
import { harnesses } from "./harness/index.mjs";
import { currentOs } from "./os/index.mjs";

async function setup(os) {
  os.prepare();
  if (!existsSync(resolve(root, "dist/host.js")) || !existsSync(resolve(root, "dist/index.js"))) {
    throw new Error("Built TypeScript files are missing; run npm ci and npm run build");
  }
  const before = await hostStatus().catch(() => null);
  const service = await os.installService();
  await waitFor(async () => (await hostStatus().catch(() => null))?.host === true, "Chrome Ops Host to answer host.status", 10000);
  // A Bridge that was connected before a Host restart comes back within its 30-second reconnect alarm.
  if (service.changed && before?.connected) {
    await waitFor(async () => (await hostStatus()).connected === true, "the previously connected Chrome Ops Bridge to reconnect", 45000);
  }
  return { ok: true, os: os.name, ...service, running: true, ...await updateBridge(os) };
}

async function registerHarnesses(os, name) {
  const installed = await setup(os);
  const targets = name ? [harnessNamed(name)] : Object.values(harnesses).filter(harness => harness.detect(os));
  if (targets.length === 0) throw new Error("No supported harness (Claude Code, Codex, Cursor, Grok) is installed for this user");
  return { ok: true, os: os.name, host: { changed: installed.changed, connected: installed.connected },
    registered: targets.map(harness => register(os, harness)) };
}

async function doctor(os) {
  const service = os.serviceStatus();
  let host;
  try { host = await hostStatus(); } catch (error) { host = { error: String(error.message) }; }
  const developerOperations = os.developerOperations();
  return {
    ok: service.ok && host.host === true && developerOperations.ok,
    os: os.name,
    node: { path: process.execPath, version: process.version },
    service, host, developerOperations,
    harnesses: inspect(os),
  };
}

try {
  const os = currentOs();
  let result;
  switch (process.argv[2]) {
    case "setup": result = await setup(os); break;
    case "uninstall": result = { ok: true, os: os.name, ...os.uninstallService() }; break;
    case "doctor": result = await doctor(os); break;
    case "register": result = await registerHarnesses(os, process.argv[3]); break;
    default: throw new Error("Expected setup, uninstall, doctor, or register [claude|codex|cursor|grok]");
  }
  process.stdout.write(`${JSON.stringify(result, null, process.argv[2] === "doctor" ? 2 : 0)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: String(error.message) })}\n`);
  process.exitCode = 1;
}
