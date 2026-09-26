#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import WebSocket from "ws";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const label = "dev.kitepon.chrome-ops-host";
const domain = `gui/${process.getuid()}`;
const service = `${domain}/${label}`;
const plist = resolve(homedir(), "Library/LaunchAgents", `${label}.plist`);
const host = resolve(root, "dist/host.js");
const native = resolve(root, "helper/macos/.build/release/chrome-ops-helper");
const logDir = resolve(homedir(), "Library/Logs/ChromeOps");
const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));

function command(program, args, { allowMissing = false, logOutput = false } = {}) {
  const result = spawnSync(program, args, { encoding: "utf8", cwd: root, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  if (logOutput) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.status === 0 || (allowMissing && result.status === 1)) return result;
  throw new Error(`${program} ${args[0]} failed (${result.status}): ${(result.stderr || result.stdout).trim()}`);
}

function launchStatus() {
  const result = spawnSync("launchctl", ["print", service], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (!result.stderr.includes(`Could not find service "${label}"`)) {
      throw new Error(`launchctl print failed (${result.status}): ${result.stderr.trim()}`);
    }
    return { loaded: false, running: false, pid: null };
  }
  const pid = Number(result.stdout.match(/\bpid = (\d+)\b/)?.[1] ?? 0) || null;
  return { loaded: true, running: pid !== null, pid };
}

function listeningPids(port) {
  const result = command("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { allowMissing: true });
  return result.stdout.trim().split(/\s+/).filter(Boolean).map(Number);
}

function xml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function jobDefinition() {
  const hostBuild = createHash("sha256").update(readFileSync(host)).digest("hex");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(host)}</string></array>
<key>EnvironmentVariables</key><dict><key>CHROME_OPS_HOST_BUILD</key><string>${hostBuild}</string></dict>
<key>KeepAlive</key><true/>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(resolve(logDir, "host.stdout.log"))}</string>
<key>StandardErrorPath</key><string>${xml(resolve(logDir, "host.stderr.log"))}</string>
</dict></plist>
`;
}

function assertOwnedPlist() {
  if (!existsSync(plist)) return;
  const actual = command("plutil", ["-extract", "Label", "raw", "-o", "-", plist]).stdout.trim();
  if (actual !== label) throw new Error(`LaunchAgent file belongs to ${actual}; no changes were made`);
}

function writeJob(contents) {
  mkdirSync(dirname(plist), { recursive: true, mode: 0o700 });
  const temporary = `${plist}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, contents, { mode: 0o600 });
    command("plutil", ["-lint", temporary]);
    renameSync(temporary, plist);
  } finally {
    rmSync(temporary, { force: true });
  }
}

async function waitFor(predicate, description, limitMs = 5000) {
  const deadline = Date.now() + limitMs;
  do {
    if (await predicate()) return;
    await sleep(120);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}`);
}

function legacyHostPid() {
  const chrome = listeningPids(32145);
  const clients = listeningPids(32146);
  const owners = [...new Set([...chrome, ...clients])];
  if (owners.length === 0) return null;
  if (owners.length !== 1 || chrome.length !== 1 || clients.length !== 1) {
    throw new Error("Chrome Ops ports have different or ambiguous owners; no process was stopped");
  }
  const pid = owners[0];
  const args = command("ps", ["-p", String(pid), "-o", "args="]).stdout.trim();
  const cwd = command("lsof", ["-nP", "-a", "-p", String(pid), "-d", "cwd", "-Fn"])
    .stdout.split("\n").find(line => line.startsWith("n"))?.slice(1);
  if (cwd !== root || !/^(?:\S*\/)?node (?:dist\/host\.js|\S*\/dist\/host\.js)$/.test(args)) {
    throw new Error(`Ports 32145/32146 belong to an unrecognized process (${pid}); no process was stopped`);
  }
  return pid;
}

async function hostCall(method, params = {}) {
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

const hostStatus = () => hostCall("host.status");

async function updateBridge() {
  const status = await hostStatus();
  if (status.ambiguousProfiles) throw new Error("Multiple Chrome Ops Bridge profiles are connected; close the unintended Bridge profile before setup");
  if (!status.connected) return { connected: false, bridgeUpdated: false };
  const sourceHash = createHash("sha256").update(readFileSync(resolve(root, "extension/service-worker.js"))).digest("hex");
  const manifestHash = createHash("sha256").update(readFileSync(resolve(root, "extension/manifest.json"))).digest("hex");
  const version = JSON.parse(readFileSync(resolve(root, "extension/manifest.json"), "utf8")).version;
  let capabilities;
  try { capabilities = await hostCall("extensions.capabilities"); }
  catch (error) {
    if (error.message !== "Unknown method: extensions.capabilities") throw error;
  }
  if (capabilities?.preparePage === true && capabilities.sourceHash === sourceHash && capabilities.manifestHash === manifestHash && capabilities.runningVersion === version) {
    return { connected: true, bridgeUpdated: false };
  }
  const extensions = await hostCall("extensions.list");
  if (!Array.isArray(extensions)) throw new Error("Bridge extension inventory is invalid");
  const matches = extensions.filter(item => item?.name === "Chrome Ops MCP Bridge" && item.installType === "development" && item.enabled === true);
  if (matches.length !== 1) throw new Error("Expected exactly one enabled unpacked Chrome Ops MCP Bridge in the connected profile");
  const tabs = await hostCall("tabs.list");
  if (!Array.isArray(tabs)) throw new Error("Bridge tab inventory is invalid");
  const hashes = tabs.filter(tab => tab?.active === true && typeof tab.url === "string" && tab.url.length > 0)
    .map(tab => createHash("sha256").update(tab.url).digest("hex"));
  if (hashes.length === 0) throw new Error("No active Bridge-profile tab can identify a Chrome window; no browser input was sent");
  const before = await hostStatus();
  if (!before.connected || before.bridgeSession !== status.bridgeSession) {
    throw new Error("Bridge profile changed during setup; no browser input was sent");
  }
  const result = command(native, ["bootstrap", matches[0].id, JSON.stringify(hashes)]);
  let response;
  try { response = JSON.parse(result.stdout); } catch { throw new Error("Native Bridge update returned invalid JSON"); }
  if (response.ok !== true) throw new Error("Native Bridge update did not complete");
  await waitFor(async () => {
    const current = await hostStatus();
    if (current.ambiguousProfiles) throw new Error("Multiple Bridge profiles connected after update");
    if (!current.connected || current.bridgeSession === status.bridgeSession) return false;
    try {
      const currentCapabilities = await hostCall("extensions.capabilities");
      return currentCapabilities?.preparePage === true && currentCapabilities.sourceHash === sourceHash && currentCapabilities.manifestHash === manifestHash && currentCapabilities.runningVersion === version;
    } catch { return false; }
  }, "updated Chrome Ops Bridge to reconnect with the expected source", 12000);
  return { connected: true, bridgeUpdated: true };
}

async function setup() {
  if (existsSync(resolve(root, "node_modules/typescript/bin/tsc"))) {
    command(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc")], { logOutput: true });
  }
  if (!existsSync(host) || !existsSync(resolve(root, "dist/index.js"))) {
    throw new Error("Built TypeScript files are missing; run npm ci and npm run build");
  }
  command("swift", ["build", "--package-path", resolve(root, "helper/macos"), "-c", "release"], { logOutput: true });
  if (!existsSync(native)) throw new Error("Swift build did not create the release helper");
  assertOwnedPlist();
  mkdirSync(logDir, { recursive: true, mode: 0o700 });
  const desired = jobDefinition();
  const previous = existsSync(plist) ? readFileSync(plist, "utf8") : null;
  const oldService = launchStatus();
  const oldConnection = oldService.running && listeningPids(32146).includes(oldService.pid)
    ? await hostStatus() : null;
  if (oldService.loaded && previous === null) {
    throw new Error(`LaunchAgent ${label} is loaded from another location; no changes were made`);
  }
  if (oldService.loaded && previous === desired && oldService.running &&
      listeningPids(32145).includes(oldService.pid) && listeningPids(32146).includes(oldService.pid)) {
    const status = await hostStatus();
    return { ok: true, changed: false, service: label, running: status.host, ...await updateBridge() };
  }
  if (oldService.loaded) command("launchctl", ["bootout", service]);
  let legacyStopped = false;
  let installed;
  try {
    const oldPid = legacyHostPid();
    if (oldPid !== null) {
      process.kill(oldPid, "SIGTERM");
      legacyStopped = true;
      await waitFor(() => listeningPids(32145).length === 0 && listeningPids(32146).length === 0,
        "previous development Host to release its ports");
    }
    writeJob(desired);
    command("launchctl", ["bootstrap", domain, plist]);
    await waitFor(async () => {
      const current = launchStatus();
      return current.running && listeningPids(32145).includes(current.pid) &&
        listeningPids(32146).includes(current.pid);
    }, "LaunchAgent Host to listen on localhost", 10000);
    const status = await hostStatus();
    if (status.host !== true) throw new Error("LaunchAgent Host did not answer host.status");
    if (oldConnection?.connected) {
      await waitFor(async () => (await hostStatus()).connected === true,
        "the previously connected Chrome Ops Bridge to reconnect", 10000);
    }
    installed = { ok: true, changed: true, service: label, running: true };
  } catch (error) {
    if (launchStatus().loaded) command("launchctl", ["bootout", service]);
    if (previous === null) rmSync(plist, { force: true });
    else writeJob(previous);
    if (oldService.loaded) command("launchctl", ["bootstrap", domain, plist]);
    else if (legacyStopped) spawn(process.execPath, [host], { cwd: root, detached: true, stdio: "ignore" }).unref();
    throw error;
  }
  return { ...installed, ...await updateBridge() };
}

function uninstall() {
  assertOwnedPlist();
  const previous = launchStatus();
  const hadPlist = existsSync(plist);
  if (previous.loaded) command("launchctl", ["bootout", service]);
  if (existsSync(plist)) rmSync(plist);
  return { ok: true, removed: previous.loaded || hadPlist, service: label, plistRemoved: !existsSync(plist) };
}

async function doctor() {
  const job = launchStatus();
  const ports = { chrome: listeningPids(32145), clients: listeningPids(32146) };
  let hostResult;
  try { hostResult = await hostStatus(); } catch (error) { hostResult = { error: String(error.message) }; }
  let helperResult;
  if (!existsSync(native)) helperResult = { built: false, error: "Run npm run setup:macos to build the Swift helper" };
  else {
    const result = command(native, ["doctor", "--permissions-only"], { allowMissing: true });
    try {
      const report = JSON.parse(result.stdout);
      helperResult = { built: true, accessibility: report.data?.accessibility ?? false,
        screenRecordingUsed: report.data?.screenRecordingUsed ?? false,
        error: report.error ?? null };
    } catch { helperResult = { built: true, error: "Native helper doctor returned invalid JSON" }; }
  }
  const codex = spawnSync("codex", ["mcp", "get", "chrome-ops", "--json"], { encoding: "utf8" });
  let codexRegistered = false;
  let codexError = null;
  if (codex.status === 0) {
    try {
      const entry = JSON.parse(codex.stdout).transport;
      codexRegistered = entry?.type === "stdio" && entry.command === process.execPath &&
        entry.args?.length === 1 && entry.args[0] === resolve(root, "dist/index.js");
    } catch { codexError = "Codex MCP registration returned invalid JSON"; }
  } else if (codex.error) codexError = codex.error.message;
  else if (!codex.stderr.includes("No MCP server named 'chrome-ops' found")) codexError = codex.stderr.trim();
  const cursorConfig = resolve(homedir(), ".cursor/mcp.json");
  let cursorRegistered = false;
  let cursorError = null;
  if (existsSync(cursorConfig)) {
    try {
      const entry = JSON.parse(readFileSync(cursorConfig, "utf8")).mcpServers?.["chrome-ops"];
      cursorRegistered = entry?.command === process.execPath && entry.args?.length === 1 &&
        entry.args[0] === resolve(root, "dist/index.js");
    } catch { cursorError = "Cursor MCP configuration is invalid JSON"; }
  }
  const grok = spawnSync("grok", ["mcp", "list", "--json"], { encoding: "utf8" });
  let grokRegistered = false;
  let grokError = null;
  if (grok.status === 0) {
    try {
      grokRegistered = JSON.parse(grok.stdout).some(item => item.name === "chrome-ops" &&
        item.command === process.execPath && item.args?.length === 1 &&
        item.args[0] === resolve(root, "dist/index.js"));
    } catch { grokError = "Grok MCP inventory returned invalid JSON"; }
  } else grokError = grok.error?.message ?? grok.stderr.trim();
  return {
    ok: job.running && ports.chrome.includes(job.pid) && ports.clients.includes(job.pid) &&
      hostResult.host === true && helperResult.accessibility === true,
    node: { path: process.execPath, version: process.version },
    launchAgent: { label, ...job, plistExists: existsSync(plist) },
    host: { ...hostResult, ports }, nativeHelper: helperResult,
    clients: {
      codex: { detected: codex.error === undefined, registered: codexRegistered, error: codexError },
      cursor: { detected: existsSync("/Applications/Cursor.app") || existsSync(resolve(homedir(), "Applications/Cursor.app")), registered: cursorRegistered, error: cursorError },
      grok: { detected: grok.error === undefined, registered: grokRegistered, error: grokError },
    },
  };
}

if (process.platform !== "darwin") throw new Error("macOS Host management requires macOS");
try {
  let result;
  switch (process.argv[2]) {
    case "setup": result = await setup(); break;
    case "uninstall": result = uninstall(); break;
    case "doctor": result = await doctor(); break;
    default: throw new Error("Expected setup, uninstall, or doctor");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: String(error.message) })}\n`);
  process.exitCode = 1;
}
