#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scripts = dirname(fileURLToPath(import.meta.url));
const action = process.argv[2];
const names = { doctor: "doctor", "register-codex": "register-codex",
  "register-cursor": "register-cursor", "register-grok": "register-grok", "register-claude": "register-claude" };
if (!(action in names)) throw new Error("Expected doctor or a supported register action");
let program;
let args;
if (process.platform === "win32") {
  program = "pwsh";
  args = ["-NoProfile", "-File", resolve(scripts, `${names[action]}.ps1`)];
} else if (process.platform === "darwin" || process.platform === "linux") {
  program = process.execPath;
  args = action === "doctor"
    ? [resolve(scripts, process.platform === "darwin" ? "macos-host.mjs" : "linux-host.mjs"), "doctor"]
    : [resolve(scripts, "register-posix.mjs"), action.slice("register-".length)];
} else {
  throw new Error(`Unsupported platform: ${process.platform}`);
}
const result = spawnSync(program, args, { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
