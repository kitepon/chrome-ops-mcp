// Select the setup adapter for the running OS.
import { linux } from "./linux.mjs";
import { macos } from "./macos.mjs";
import { windows } from "./windows.mjs";

const adapters = { darwin: macos, win32: windows, linux };

export function currentOs() {
  const adapter = adapters[process.platform];
  if (!adapter) throw new Error(`Unsupported platform: ${process.platform}`);
  return adapter;
}
