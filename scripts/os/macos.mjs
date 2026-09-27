// macOS: the Host runs as a LaunchAgent and the Swift helper drives chrome://extensions.
import { spawn as spawnDetached } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { root, waitFor } from "../lib/host-client.mjs";
import { check, run, spawn } from "../lib/process.mjs";

const label = "dev.kitepon.chrome-ops-host";
const domain = () => `gui/${process.getuid()}`;
const service = () => `${domain()}/${label}`;
const plist = resolve(homedir(), "Library/LaunchAgents", `${label}.plist`);
const host = resolve(root, "dist/host.js");
const native = resolve(root, "helper/macos/.build/release/chrome-ops-helper");
const logDir = resolve(homedir(), "Library/Logs/ChromeOps");

function launchStatus() {
  const result = spawn("launchctl", ["print", service()]);
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
  const result = spawn("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) throw new Error(`lsof failed (${result.status}): ${result.stderr.trim()}`);
  return result.stdout.trim().split(/\s+/).filter(Boolean).map(Number);
}

const serving = pid => listeningPids(32145).includes(pid) && listeningPids(32146).includes(pid);

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
  const actual = run("plutil", ["-extract", "Label", "raw", "-o", "-", plist]).trim();
  if (actual !== label) throw new Error(`LaunchAgent file belongs to ${actual}; no changes were made`);
}

function writeJob(contents) {
  mkdirSync(dirname(plist), { recursive: true, mode: 0o700 });
  const temporary = `${plist}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, contents, { mode: 0o600 });
    run("plutil", ["-lint", temporary]);
    renameSync(temporary, plist);
  } finally {
    rmSync(temporary, { force: true });
  }
}

// A Host started by hand from this checkout before the LaunchAgent existed.
function legacyHostPid() {
  const chrome = listeningPids(32145);
  const clients = listeningPids(32146);
  const owners = [...new Set([...chrome, ...clients])];
  if (owners.length === 0) return null;
  if (owners.length !== 1 || chrome.length !== 1 || clients.length !== 1) {
    throw new Error("Chrome Ops ports have different or ambiguous owners; no process was stopped");
  }
  const pid = owners[0];
  const args = run("ps", ["-p", String(pid), "-o", "args="]).trim();
  const cwd = run("lsof", ["-nP", "-a", "-p", String(pid), "-d", "cwd", "-Fn"])
    .split("\n").find(line => line.startsWith("n"))?.slice(1);
  if (cwd !== root || !/^(?:\S*\/)?node (?:dist\/host\.js|\S*\/dist\/host\.js)$/.test(args)) {
    throw new Error(`Ports 32145/32146 belong to an unrecognized process (${pid}); no process was stopped`);
  }
  return pid;
}

export const macos = {
  name: "macos",
  stateDir: resolve(homedir(), "Library/Application Support/ChromeOps"),
  exec: (program, args) => spawn(program, args),

  prepare() {
    const build = spawn("swift", ["build", "--package-path", resolve(root, "helper/macos"), "-c", "release"]);
    if (build.stdout) process.stderr.write(build.stdout);
    check(build, "swift build");
    if (!existsSync(native)) throw new Error("Swift build did not create the release helper");
  },

  async installService() {
    assertOwnedPlist();
    mkdirSync(logDir, { recursive: true, mode: 0o700 });
    const desired = jobDefinition();
    const previous = existsSync(plist) ? readFileSync(plist, "utf8") : null;
    const old = launchStatus();
    if (old.loaded && previous === null) throw new Error(`LaunchAgent ${label} is loaded from another location; no changes were made`);
    if (old.loaded && previous === desired && old.running && serving(old.pid)) return { changed: false, service: label };
    if (old.loaded) run("launchctl", ["bootout", service()]);
    let legacyStopped = false;
    try {
      const legacy = legacyHostPid();
      if (legacy !== null) {
        process.kill(legacy, "SIGTERM");
        legacyStopped = true;
        await waitFor(() => listeningPids(32145).length === 0 && listeningPids(32146).length === 0, "previous development Host to release its ports");
      }
      writeJob(desired);
      run("launchctl", ["bootstrap", domain(), plist]);
      await waitFor(() => { const now = launchStatus(); return now.running && serving(now.pid); }, "LaunchAgent Host to listen on localhost", 10000);
    } catch (error) {
      if (launchStatus().loaded) run("launchctl", ["bootout", service()]);
      if (previous === null) rmSync(plist, { force: true });
      else writeJob(previous);
      if (old.loaded) run("launchctl", ["bootstrap", domain(), plist]);
      else if (legacyStopped) spawnDetached(process.execPath, [host], { cwd: root, detached: true, stdio: "ignore" }).unref();
      throw error;
    }
    return { changed: true, service: label };
  },

  uninstallService() {
    assertOwnedPlist();
    const previous = launchStatus();
    const hadPlist = existsSync(plist);
    if (previous.loaded) run("launchctl", ["bootout", service()]);
    if (existsSync(plist)) rmSync(plist);
    return { removed: previous.loaded || hadPlist, service: label, plistRemoved: !existsSync(plist) };
  },

  serviceStatus() {
    const job = launchStatus();
    const ports = { chrome: listeningPids(32145), clients: listeningPids(32146) };
    return { ok: job.running && serving(job.pid), kind: "launchd", label, ...job, plistExists: existsSync(plist), ports };
  },

  developerOperations() {
    if (!existsSync(native)) return { supported: true, ok: false, built: false, error: "Run npm run setup to build the Swift helper" };
    const result = spawn(native, ["doctor", "--permissions-only"]);
    try {
      const report = JSON.parse(result.stdout);
      const accessibility = report.data?.accessibility ?? false;
      return { supported: true, ok: accessibility === true, built: true, accessibility,
        screenRecordingUsed: report.data?.screenRecordingUsed ?? false, error: report.error ?? null };
    } catch { return { supported: true, ok: false, built: true, error: "Native helper doctor returned invalid JSON" }; }
  },

  nativeBridgeUpdate(extensionId, hashes) {
    let response;
    try { response = JSON.parse(run(native, ["bootstrap", extensionId, JSON.stringify(hashes)])); }
    catch (error) { throw new Error(`Native Bridge update failed: ${error.message}`); }
    if (response.ok !== true) throw new Error("Native Bridge update did not complete");
  },
};
