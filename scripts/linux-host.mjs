#!/usr/bin/env node
// Install the persistent Chrome Ops Host as a systemd user service on Linux.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { inspectClients } from "./clients.mjs";
import { bridgeIsCurrent, hostStatus, reloadBridgeItself, root, waitFor } from "./host-client.mjs";

const unitName = "chrome-ops-host.service";
const unitPath = resolve(process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config"), "systemd/user", unitName);
const host = resolve(root, "dist/host.js");

function command(program, args, { allowFailure = false } = {}) {
  const result = spawnSync(program, args, { encoding: "utf8", cwd: root, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${program} ${args.join(" ")} failed (${result.status}): ${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

const systemctl = (...args) => command("systemctl", ["--user", ...args]);

function serviceStatus() {
  const result = command("systemctl", ["--user", "show", unitName, "--property=LoadState,ActiveState,MainPID"], { allowFailure: true });
  const fields = Object.fromEntries(result.stdout.trim().split("\n").filter(Boolean).map(line => line.split("=", 2)));
  const pid = Number(fields.MainPID) || null;
  return { loaded: fields.LoadState === "loaded", running: fields.ActiveState === "active" && pid !== null, pid };
}

// Owners of the listening Host ports, read from /proc so no extra tools are needed.
function listeningPids(port) {
  const inodes = new Set();
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    if (!existsSync(table)) continue;
    for (const line of readFileSync(table, "utf8").trim().split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields[3] === "0A" && parseInt(fields[1].split(":").at(-1), 16) === port) inodes.add(fields[9]);
    }
  }
  if (inodes.size === 0) return [];
  const pids = new Set();
  for (const pid of readdirSync("/proc").filter(name => /^\d+$/.test(name))) {
    let fds;
    try { fds = readdirSync(`/proc/${pid}/fd`); } catch { continue; }
    for (const fd of fds) {
      let link;
      try { link = readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
      const inode = link.match(/^socket:\[(\d+)\]$/)?.[1];
      if (inode && inodes.has(inode)) { pids.add(Number(pid)); break; }
    }
  }
  return [...pids];
}

function unitDefinition() {
  const hostBuild = createHash("sha256").update(readFileSync(host)).digest("hex");
  // systemd expands % specifiers everywhere; ExecStart also takes quoted words, WorkingDirectory a bare path.
  const literal = value => value.replaceAll("%", "%%");
  const quote = value => `"${literal(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
  return `[Unit]
Description=Chrome Ops MCP Host

[Service]
ExecStart=${quote(process.execPath)} ${quote(host)}
WorkingDirectory=${literal(root)}
Environment=CHROME_OPS_HOST_BUILD=${hostBuild}
Restart=always
RestartSec=2
UMask=0077

[Install]
WantedBy=default.target
`;
}

function assertOwnedUnit() {
  if (!existsSync(unitPath)) return;
  if (!readFileSync(unitPath, "utf8").includes("Description=Chrome Ops MCP Host")) {
    throw new Error(`${unitPath} is not a Chrome Ops unit; no changes were made`);
  }
}

function writeUnit(contents) {
  mkdirSync(dirname(unitPath), { recursive: true, mode: 0o700 });
  const temporary = `${unitPath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, contents, { mode: 0o600 });
    renameSync(temporary, unitPath);
  } finally {
    rmSync(temporary, { force: true });
  }
}

async function updateBridge() {
  const status = await hostStatus();
  if (status.ambiguousProfiles) throw new Error("Multiple Chrome Ops Bridge profiles are connected; close the unintended Bridge profile before setup");
  if (!status.connected) return { connected: false, bridgeUpdated: false };
  if (await bridgeIsCurrent()) return { connected: true, bridgeUpdated: false };
  if (await reloadBridgeItself(status)) return { connected: true, bridgeUpdated: true };
  throw new Error("The connected Chrome Ops Bridge is older than 0.2.3; reload it once from chrome://extensions");
}

async function setup() {
  if (!existsSync(host) || !existsSync(resolve(root, "dist/index.js"))) {
    throw new Error("Built TypeScript files are missing; run npm ci and npm run build");
  }
  assertOwnedUnit();
  const desired = unitDefinition();
  const previous = existsSync(unitPath) ? readFileSync(unitPath, "utf8") : null;
  const old = serviceStatus();
  const serving = pid => listeningPids(32145).includes(pid) && listeningPids(32146).includes(pid);
  if (previous === desired && old.running && serving(old.pid)) {
    return { ok: true, changed: false, service: unitName, running: true, ...await updateBridge() };
  }
  const others = [...new Set([...listeningPids(32145), ...listeningPids(32146)])].filter(pid => pid !== old.pid);
  if (others.length) throw new Error(`Ports 32145/32146 belong to another process (${others.join(", ")}); no process was stopped`);
  const wasConnected = old.running ? (await hostStatus().catch(() => null))?.connected === true : false;
  writeUnit(desired);
  try {
    systemctl("daemon-reload");
    systemctl("enable", unitName);
    systemctl("restart", unitName);
    await waitFor(() => { const now = serviceStatus(); return now.running && serving(now.pid); },
      "systemd Host to listen on localhost", 10000);
    if ((await hostStatus()).host !== true) throw new Error("systemd Host did not answer host.status");
    if (wasConnected) {
      await waitFor(async () => (await hostStatus()).connected === true, "the previously connected Chrome Ops Bridge to reconnect", 45000);
    }
  } catch (error) {
    if (previous === null) {
      command("systemctl", ["--user", "disable", "--now", unitName], { allowFailure: true });
      rmSync(unitPath, { force: true });
    } else writeUnit(previous);
    command("systemctl", ["--user", "daemon-reload"], { allowFailure: true });
    if (previous !== null && old.running) command("systemctl", ["--user", "restart", unitName], { allowFailure: true });
    throw error;
  }
  return { ok: true, changed: true, service: unitName, running: true, ...await updateBridge() };
}

function uninstall() {
  assertOwnedUnit();
  const hadUnit = existsSync(unitPath);
  const previous = serviceStatus();
  if (previous.loaded) command("systemctl", ["--user", "disable", "--now", unitName], { allowFailure: true });
  rmSync(unitPath, { force: true });
  command("systemctl", ["--user", "daemon-reload"], { allowFailure: true });
  return { ok: true, removed: hadUnit || previous.loaded, service: unitName, unitRemoved: !existsSync(unitPath) };
}

async function doctor() {
  const service = serviceStatus();
  const ports = { chrome: listeningPids(32145), clients: listeningPids(32146) };
  let hostResult;
  try { hostResult = await hostStatus(); } catch (error) { hostResult = { error: String(error.message) }; }
  return {
    ok: service.running && ports.chrome.includes(service.pid) && ports.clients.includes(service.pid) && hostResult.host === true,
    node: { path: process.execPath, version: process.version },
    systemd: { unit: unitName, ...service, unitExists: existsSync(unitPath) },
    host: { ...hostResult, ports },
    developerOperations: { supported: false, reason: "Load unpacked, reload, errors and remove are not automated on Linux yet" },
    clients: inspectClients(),
  };
}

if (process.platform !== "linux") throw new Error("Linux Host management requires Linux");
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
