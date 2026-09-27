// Run programs for setup scripts. OS adapters decide how a harness CLI name becomes a process.
import { spawnSync } from "node:child_process";
import { root } from "./host-client.mjs";

export function spawn(program, args, options = {}) {
  return spawnSync(program, args, { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, windowsHide: true, ...options });
}

export function check(result, label) {
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed (${result.status}): ${(result.stderr || result.stdout).trim()}`);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.stdout;
}

export const run = (program, args, options) => check(spawn(program, args, options), `${program} ${args[0] ?? ""}`.trim());
