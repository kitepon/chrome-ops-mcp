// Linux: Chrome Ops runs its own development Chrome and performs the operations through that Chrome's DevTools pipe.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { serviceName } from "./linux-paths.js";
import type { OsAdapter } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));

export const linux: OsAdapter = {
  name: "linux",
  unsupportedReason: null,
  reportsLoadedId: true,
  usesManagementTab: false,
  startBrowser: () => { spawnSync("systemctl", ["--user", "start", serviceName]); },
  helper: (operation, value) => ({ command: process.execPath, args: [resolve(here, "linux-helper.js"), operation, value] }),
};
