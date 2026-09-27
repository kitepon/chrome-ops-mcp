// Codex manages ~/.codex/config.toml through `codex mcp`.
import { check } from "../lib/process.mjs";

const missing = stderr => stderr.includes("No MCP server named 'chrome-ops' found");

export const codex = {
  name: "codex",
  configFile: ".codex/config.toml",
  detect: os => !os.exec("codex", ["--version"]).error,
  read(os) {
    const existing = os.exec("codex", ["mcp", "get", "chrome-ops", "--json"]);
    if (existing.error) throw existing.error;
    if (existing.status === 0) return JSON.parse(existing.stdout);
    if (missing(existing.stderr)) return undefined;
    throw new Error(`Cannot inspect Codex MCP registration: ${existing.stderr.trim()}`);
  },
  add(os, server) {
    check(os.exec("codex", ["mcp", "add", "chrome-ops", "--", server.command, ...server.args]), "codex mcp add");
  },
};
