// Linux: Chrome's extension-management page is not reachable from AT-SPI yet, so there is no helper.
import type { OsAdapter } from "./types.js";

export const linux: OsAdapter = {
  name: "linux",
  unsupportedReason: "Unpacked-extension developer operations are not automated on Linux yet; use chrome://extensions for Load unpacked, reload, errors and remove",
  reportsLoadedId: false,
  helper: () => { throw new Error(linux.unsupportedReason!); },
};
