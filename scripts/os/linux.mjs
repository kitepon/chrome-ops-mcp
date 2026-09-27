// Linux: the Host runs as a systemd user service. There is no developer-operation helper yet.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { root, waitFor } from "../lib/host-client.mjs";
import { check, spawn } from "../lib/process.mjs";

const unitName = "chrome-ops-host.service";
const unitPath = resolve(process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config"), "systemd/user", unitName);
const host = resolve(root, "dist/host.js");

const systemctl = (args, { allowFailure = false } = {}) => {
  const result = spawn("systemctl", ["--user", ...args]);
  return allowFailure ? result : (check(result, `systemctl --user ${args.join(" ")}`), result);
};

function unitState() {
  const result = systemctl(["show", unitName, "--property=LoadState,ActiveState,MainPID"], { allowFailure: true });
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
    if (previous === desired && old.running && serving(old.pid)) return { changed: false, service: unitName };
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
    return { changed: true, service: unitName };
  },

  uninstallService() {
    assertOwnedUnit();
    const hadUnit = existsSync(unitPath);
    const previous = unitState();
    if (previous.loaded) systemctl(["disable", "--now", unitName], { allowFailure: true });
    rmSync(unitPath, { force: true });
    systemctl(["daemon-reload"], { allowFailure: true });
    return { removed: hadUnit || previous.loaded, service: unitName, unitRemoved: !existsSync(unitPath) };
  },

  serviceStatus() {
    const state = unitState();
    const ports = { chrome: listeningPids(32145), clients: listeningPids(32146) };
    return { ok: state.running && serving(state.pid), kind: "systemd", unit: unitName, ...state, unitExists: existsSync(unitPath), ports };
  },

  developerOperations: () => ({ supported: false, ok: true, reason: "Load unpacked, reload, errors and remove are not automated on Linux yet" }),
  nativeBridgeUpdate: null,
};
