// Linux: Chrome Ops runs its own development Chrome and performs the operations through that Chrome's DevTools pipe.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { startService } from "./linux-paths.js";
import type { OsAdapter } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));

export const linux: OsAdapter = {
  name: "linux",
  unsupportedReason: null,
  reportsLoadedId: true,
  usesManagementTab: false,
  startBrowser: startService,
  helper: (operation, value) => ({ command: process.execPath, args: [resolve(here, "linux-helper.js"), operation, value] }),
};
