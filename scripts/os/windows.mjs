// Windows: the Host runs as a logon Scheduled Task and the PowerShell 7 helper drives chrome://extensions.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { root, waitFor } from "../lib/host-client.mjs";
import { check, spawn } from "../lib/process.mjs";

const taskName = "Chrome Ops Host";
const taskDescription = "Persistent local host for Chrome Ops MCP";
const host = resolve(root, "dist/host.js");
const helper = resolve(root, "helper/windows/chrome-ops-helper.ps1");

// Values travel as environment variables so PowerShell never has to parse them as code.
function powershell(script, env = {}) {
  const prologue = "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);";
  const output = check(spawn("pwsh", ["-NoProfile", "-NonInteractive", "-Command", prologue + script],
    { env: { ...process.env, ...env } }), "pwsh");
  return output.trim() ? JSON.parse(output) : null;
}

function listeningPids(port) {
  const rows = powershell("@(Get-NetTCPConnection -State Listen -LocalPort $env:CO_PORT -ErrorAction SilentlyContinue|ForEach-Object{$_.OwningProcess})|ConvertTo-Json -Compress -AsArray",
    { CO_PORT: String(port) });
  return [...new Set(rows ?? [])];
}

function readTask() {
  return powershell("$t=Get-ScheduledTask -TaskName $env:CO_TASK -ErrorAction SilentlyContinue;if(-not $t){'null'}else{[pscustomobject]@{state=[string]$t.State;description=$t.Description;execute=$t.Actions[0].Execute;arguments=$t.Actions[0].Arguments;workingDirectory=$t.Actions[0].WorkingDirectory}|ConvertTo-Json -Compress}",
    { CO_TASK: taskName });
}

// The build hash rides on the command line so a changed Host build changes the task definition.
function desiredTask() {
  const hostBuild = createHash("sha256").update(readFileSync(host)).digest("hex");
  return { execute: process.execPath, arguments: `"${host}" --build=${hostBuild}`, workingDirectory: root };
}

function registerTask(task) {
  powershell(`$a=New-ScheduledTaskAction -Execute $env:CO_EXE -Argument $env:CO_ARGS -WorkingDirectory $env:CO_DIR
$tr=New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$s=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $env:CO_TASK -Action $a -Trigger $tr -Settings $s -Description $env:CO_DESC -Force|Out-Null`,
  { CO_EXE: task.execute, CO_ARGS: task.arguments, CO_DIR: task.workingDirectory, CO_TASK: taskName, CO_DESC: taskDescription });
}

const taskCommand = verb => powershell(`${verb}-ScheduledTask -TaskName $env:CO_TASK -ErrorAction SilentlyContinue`, { CO_TASK: taskName });
const portsFree = () => listeningPids(32145).length === 0 && listeningPids(32146).length === 0;
const portsServed = () => listeningPids(32145).length === 1 && listeningPids(32146).length === 1;

// Harness CLIs are often npm shims (.cmd/.ps1). Run what the shim runs so no shell re-parses the arguments.
function resolveCommand(name) {
  const found = spawn("where.exe", [name]);
  if (found.status !== 0) return null;
  const paths = found.stdout.split(/\r?\n/).filter(Boolean);
  const exe = paths.find(path => /\.exe$/i.test(path));
  if (exe) return { command: exe, prefix: [] };
  const cmd = paths.find(path => /\.cmd$/i.test(path));
  // npm shims name the real program relative to themselves, after an optional bundled node.exe.
  const targets = cmd ? [...readFileSync(cmd, "utf8").matchAll(/"%dp0%\\([^"%]+)"/g)].map(match => resolve(dirname(cmd), match[1])) : [];
  const script = targets.find(path => /\.[cm]?js$/i.test(path) && existsSync(path));
  if (script) return { command: process.execPath, prefix: [script] };
  const program = targets.find(path => /\.exe$/i.test(path) && existsSync(path));
  if (program) return { command: program, prefix: [] };
  const ps1 = paths.find(path => /\.ps1$/i.test(path)) ?? (cmd && existsSync(cmd.replace(/\.cmd$/i, ".ps1")) ? cmd.replace(/\.cmd$/i, ".ps1") : null);
  if (ps1) return { command: "pwsh", prefix: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1] };
  return null;
}

export const windows = {
  name: "windows",
  stateDir: resolve(process.env.LOCALAPPDATA ?? resolve(process.env.USERPROFILE ?? ".", "AppData/Local"), "ChromeOps"),

  exec(program, args) {
    const resolved = resolveCommand(program);
    if (!resolved) return { error: Object.assign(new Error(`${program} is not on PATH`), { code: "ENOENT" }), status: null, stdout: "", stderr: "" };
    return spawn(resolved.command, [...resolved.prefix, ...args]);
  },

  prepare() {
    const version = spawn("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"]);
    if (version.error || Number(version.stdout.trim()) < 7) throw new Error("PowerShell 7+ (pwsh) is required");
  },

  async installService() {
    const desired = desiredTask();
    const previous = readTask();
    if (previous && previous.description !== taskDescription) throw new Error(`Scheduled task ${taskName} is not a Chrome Ops task; no changes were made`);
    const same = previous && previous.execute === desired.execute && previous.arguments === desired.arguments &&
      previous.workingDirectory === desired.workingDirectory;
    if (same && previous.state === "Running" && portsServed()) return { changed: false, service: taskName };
    registerTask(desired);
    try {
      taskCommand("Stop");
      await waitFor(portsFree, "Chrome Ops ports 32145/32146 to be released after stopping the Host task", 15000);
      taskCommand("Start");
      await waitFor(portsServed, "Scheduled Task Host to listen on localhost", 15000);
    } catch (error) {
      if (previous) { registerTask(previous); taskCommand("Start"); }
      else powershell("Unregister-ScheduledTask -TaskName $env:CO_TASK -Confirm:$false -ErrorAction SilentlyContinue", { CO_TASK: taskName });
      throw error;
    }
    return { changed: true, service: taskName };
  },

  uninstallService() {
    const previous = readTask();
    if (previous && previous.description !== taskDescription) throw new Error(`Scheduled task ${taskName} is not a Chrome Ops task; no changes were made`);
    if (previous) {
      taskCommand("Stop");
      powershell("Unregister-ScheduledTask -TaskName $env:CO_TASK -Confirm:$false", { CO_TASK: taskName });
    }
    return { removed: previous !== null, service: taskName };
  },

  serviceStatus() {
    const task = readTask();
    const ports = { chrome: listeningPids(32145), clients: listeningPids(32146) };
    return { ok: task?.state === "Running" && ports.chrome.length === 1 && ports.clients.length === 1,
      kind: "scheduled-task", name: taskName, exists: task !== null, state: task?.state ?? null, ports };
  },

  developerOperations() {
    const version = spawn("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]);
    const ok = !version.error && Number(version.stdout.trim().split(".")[0]) >= 7;
    return { supported: true, ok, powershell: ok ? version.stdout.trim() : null, helper };
  },

  nativeBridgeUpdate(extensionId, hashes) {
    const result = spawn("pwsh", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper, "-Operation", "bootstrap",
      "-ExtensionId", extensionId, "-ActiveUrlHashes", JSON.stringify(hashes)]);
    let response;
    try { response = JSON.parse(result.stdout.trim()); } catch { throw new Error(`Native Bridge update returned invalid output: ${result.stderr || result.stdout}`); }
    if (response.ok !== true) throw new Error(`Native Bridge update did not complete: ${response.error}`);
  },
};
