// Contract that each OS adapter fills for the MCP server. Everything else in src/ is shared by all OSes.
export type DeveloperOperation = "load"|"reload"|"errors"|"remove";

export interface HelperInvocation { command: string; args: string[] }

export interface OsAdapter {
  name: "macos"|"windows"|"linux";
  /** Why unpacked-extension developer operations are unavailable here, or null when the helper exists. */
  unsupportedReason: string|null;
  /** True when the helper reads the new extension id from Chrome's page after Load unpacked. */
  reportsLoadedId: boolean;
  /** True when the helper drives a chrome://extensions tab that the Bridge must prepare first. */
  usesManagementTab: boolean;
  helper(operation: DeveloperOperation, value: string, pageToken?: string): HelperInvocation;
  /** Starts the Chrome that carries the Bridge when Chrome Ops owns it (Linux); null when the user runs Chrome. */
  startBrowser: (() => void)|null;
}
