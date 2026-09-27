// Windows: the PowerShell 7 helper drives chrome://extensions through UI Automation.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { OsAdapter } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));

export const windows: OsAdapter = {
  name: "windows",
  unsupportedReason: null,
  // The Windows helper cannot read the new id; the server takes the one new development extension instead.
  reportsLoadedId: false,
  usesManagementTab: true,
  startBrowser: null,
  helper: (operation, value) => ({
    command: "pwsh",
    args: ["-NoProfile","-ExecutionPolicy","Bypass","-File",resolve(here, "../../helper/windows/chrome-ops-helper.ps1"),
      "-Operation",operation, ...(operation === "load" ? ["-Path", value] : ["-ExtensionId", value])],
  }),
};
