// Linux: the Host runs as a systemd user service. A second user service runs Chrome Ops' own development Chrome,
// which performs the developer operations through its DevTools pipe (see src/os/linux-chrome.ts).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { hostStatus, root, waitFor } from "../lib/host-client.mjs";
import { check, spawn } from "../lib/process.mjs";
import { chromeBinary, profileDir, serviceName as chromeUnitName, socketPath } from "../../dist/os/linux-paths.js";

const unitName = "chrome-ops-host.service";
const unitDir = resolve(process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config"), "systemd/user");
const unitPath = resolve(unitDir, unitName);
const chromeUnitPath = resolve(unitDir, chromeUnitName);
const launcherPath = resolve(process.env.XDG_DATA_HOME || resolve(homedir(), ".local/share"), "applications/chrome-ops-chrome.desktop");
const host = resolve(root, "dist/host.js");
const supervisor = resolve(root, "dist/os/linux-chrome.js");

const systemctl = (args, { allowFailure = false } = {}) => {
  const result = spawn("systemctl", ["--user", ...args]);
  return allowFailure ? result : (check(result, `systemctl --user ${args.join(" ")}`), result);
};

function unitState(name = unitName) {
  const result = systemctl(["show", name, "--property=LoadState,ActiveState,MainPID"], { allowFailure: true });
  const fields = Object.fromEntries((result.stdout ?? "").trim().split("\n").filter(Boolean).map(line => line.split("=", 2)));
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

const serving = pid => listeningPids(32145).includes(pid) && listeningPids(32146).includes(pid);

// systemd expands % specifiers everywhere; ExecStart also takes quoted words, WorkingDirectory a bare path.
const literal = value => value.replaceAll("%", "%%");
const quote = value => `"${literal(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;

function unitDefinition() {
  const hostBuild = createHash("sha256").update(readFileSync(host)).digest("hex");
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

// The development Chrome is not started at login: setup starts it, and the helper or the launcher starts it on demand.
// Closing its last window ends the service until the next start.
function chromeUnitDefinition() {
  const build = createHash("sha256").update(readFileSync(supervisor)).digest("hex");
  return `[Unit]
Description=Chrome Ops development Chrome

[Service]
ExecStart=${quote(process.execPath)} ${quote(supervisor)}
WorkingDirectory=${literal(root)}
Environment=CHROME_OPS_CHROME_BUILD=${build}
Restart=on-failure
RestartSec=5
UMask=0077
`;
}

const launcherDefinition = () => `[Desktop Entry]
Type=Application
Name=Chrome Ops Chrome
Comment=Development Chrome managed by Chrome Ops
Exec=systemctl --user start ${chromeUnitName}
Icon=google-chrome
Terminal=false
Categories=Development;
`;

function assertOwned(path, marker) {
  if (existsSync(path) && !readFileSync(path, "utf8").includes(marker)) {
    throw new Error(`${path} was not written by Chrome Ops; no changes were made`);
  }
}

function assertOwnedUnit() {
  assertOwned(unitPath, "Description=Chrome Ops MCP Host");
  assertOwned(chromeUnitPath, "Description=Chrome Ops development Chrome");
  assertOwned(launcherPath, "Name=Chrome Ops Chrome");
}

function writeUnit(contents, path = unitPath) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, contents, { mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

const chromeReady = () => unitState(chromeUnitName).running && existsSync(socketPath());

// Start (or restart after a change) the development Chrome and wait for its Bridge to reach the Host.
async function installChrome() {
  if (!chromeBinary()) throw new Error("Google Chrome or Chromium was not found; install it or set CHROME_OPS_CHROME_BINARY");
  const desired = chromeUnitDefinition();
  const previous = existsSync(chromeUnitPath) ? readFileSync(chromeUnitPath, "utf8") : null;
  const changed = previous !== desired || !existsSync(launcherPath) || readFileSync(launcherPath, "utf8") !== launcherDefinition();
  if (!changed && chromeReady()) return false;
  writeUnit(desired, chromeUnitPath);
  writeUnit(launcherDefinition(), launcherPath);
  systemctl(["daemon-reload"]);
  systemctl([previous === desired ? "start" : "restart", chromeUnitName]);
  await waitFor(chromeReady, "the Chrome Ops development Chrome to start (it needs a graphical session)", 30000);
  await waitFor(async () => (await hostStatus().catch(() => null))?.connected === true, "the Bridge in the development Chrome to connect", 45000);
  return true;
}

export const linux = {
  name: "linux",
  stateDir: resolve(process.env.XDG_STATE_HOME || resolve(homedir(), ".local/state"), "chrome-ops"),
  exec: (program, args) => spawn(program, args),
  prepare() {},

  async installService() {
    assertOwnedUnit();
    const desired = unitDefinition();
    const previous = existsSync(unitPath) ? readFileSync(unitPath, "utf8") : null;
    const old = unitState();
    if (previous === desired && old.running && serving(old.pid)) return { changed: false, service: unitName, chromeChanged: await installChrome() };
    const others = [...new Set([...listeningPids(32145), ...listeningPids(32146)])].filter(pid => pid !== old.pid);
    if (others.length) throw new Error(`Ports 32145/32146 belong to another process (${others.join(", ")}); no process was stopped`);
    writeUnit(desired);
    try {
      systemctl(["daemon-reload"]);
      systemctl(["enable", unitName]);
      systemctl(["restart", unitName]);
      await waitFor(() => { const now = unitState(); return now.running && serving(now.pid); }, "systemd Host to listen on localhost", 10000);
    } catch (error) {
      if (previous === null) {
        systemctl(["disable", "--now", unitName], { allowFailure: true });
        rmSync(unitPath, { force: true });
      } else writeUnit(previous);
      systemctl(["daemon-reload"], { allowFailure: true });
      if (previous !== null && old.running) systemctl(["restart", unitName], { allowFailure: true });
      throw error;
    }
    return { changed: true, service: unitName, chromeChanged: await installChrome() };
  },

  uninstallService() {
    assertOwnedUnit();
    const hadUnit = existsSync(unitPath) || existsSync(chromeUnitPath);
    const previous = unitState();
    if (unitState(chromeUnitName).loaded) systemctl(["stop", chromeUnitName], { allowFailure: true });
    if (previous.loaded) systemctl(["disable", "--now", unitName], { allowFailure: true });
    for (const path of [unitPath, chromeUnitPath, launcherPath]) rmSync(path, { force: true });
    systemctl(["daemon-reload"], { allowFailure: true });
    // The development Chrome profile holds the user's own browsing data, so it stays.
    return { removed: hadUnit || previous.loaded, service: unitName, unitRemoved: !existsSync(unitPath) && !existsSync(chromeUnitPath), keptProfile: profileDir() };
  },

  serviceStatus() {
    const state = unitState();
    const ports = { chrome: listeningPids(32145), clients: listeningPids(32146) };
    return { ok: state.running && serving(state.pid), kind: "systemd", unit: unitName, ...state, unitExists: existsSync(unitPath), ports };
  },

  developerOperations() {
    const chrome = chromeBinary();
    const state = unitState(chromeUnitName);
    return { supported: true, ok: chrome !== null && existsSync(chromeUnitPath), chrome, service: chromeUnitName,
      running: state.running, socket: existsSync(socketPath()), profile: profileDir(), launcher: existsSync(launcherPath) ? launcherPath : null };
  },
  nativeBridgeUpdate: null,
};
