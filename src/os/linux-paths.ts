// Linux: where the dedicated development Chrome keeps its profile and control socket.
// Shared by the supervisor (linux-chrome.ts), the helper (linux-helper.ts) and setup (scripts/os/linux.mjs).
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const serviceName = "chrome-ops-chrome.service";

export const profileDir = () => process.env.CHROME_OPS_CHROME_PROFILE ??
  join(process.env.XDG_DATA_HOME || join(homedir(), ".local/share"), "chrome-ops/chrome-profile");

export const socketPath = () => process.env.CHROME_OPS_CHROME_SOCKET ??
  join(process.env.XDG_RUNTIME_DIR || join(homedir(), ".local/state"), "chrome-ops/chrome.sock");

export function chromeBinary(): string|null {
  if (process.env.CHROME_OPS_CHROME_BINARY) return process.env.CHROME_OPS_CHROME_BINARY;
  for (const name of ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"]) {
    for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
      if (existsSync(join(directory, name))) return join(directory, name);
    }
  }
  return null;
}
