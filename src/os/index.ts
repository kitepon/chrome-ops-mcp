// Select the adapter for the running OS.
import { linux } from "./linux.js";
import { macos } from "./macos.js";
import type { OsAdapter } from "./types.js";
import { windows } from "./windows.js";

const adapters: Partial<Record<NodeJS.Platform, OsAdapter>> = { darwin: macos, win32: windows, linux };

export function currentOs(): OsAdapter {
  const adapter = adapters[process.platform];
  if (!adapter) throw new Error(`Unsupported platform: ${process.platform}`);
  return adapter;
}
