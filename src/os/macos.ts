// macOS: the Swift helper drives chrome://extensions through the Accessibility API.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { OsAdapter } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));

export const macos: OsAdapter = {
  name: "macos",
  unsupportedReason: null,
  reportsLoadedId: true,
  helper: (operation, value, pageToken) => ({
    command: resolve(here, "../../helper/macos/.build/release/chrome-ops-helper"),
    args: [operation, value, ...(pageToken ? [pageToken] : [])],
  }),
};
