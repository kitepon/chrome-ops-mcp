// Grok Build manages ~/.grok/config.toml through `grok mcp` and can check a server with `grok mcp doctor`.
import { check } from "../lib/process.mjs";

export const grok = {
  name: "grok",
  configFile: ".grok/config.toml",
  detect: os => !os.exec("grok", ["--version"]).error,
  read(os) {
    const inventory = JSON.parse(check(os.exec("grok", ["mcp", "list", "--json"]), "grok mcp list"));
    if (!Array.isArray(inventory)) throw new Error("Grok MCP inventory is not an array");
    const matches = inventory.filter(item => item.name === "chrome-ops");
    if (matches.length > 1) throw new Error("Grok has duplicate chrome-ops entries");
    return matches[0];
  },
  add(os, server) {
    check(os.exec("grok", ["mcp", "add", "chrome-ops", "--", server.command, ...server.args]), "grok mcp add");
    check(os.exec("grok", ["mcp", "doctor", "chrome-ops"]), "grok mcp doctor");
  },
};
