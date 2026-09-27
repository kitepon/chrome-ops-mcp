// Claude Code keeps user-scoped MCP servers in ~/.claude.json and adds them with `claude mcp add-json`.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { check } from "../lib/process.mjs";

const config = resolve(homedir(), ".claude.json");

export const claude = {
  name: "claude",
  configFile: ".claude.json",
  detect: os => !os.exec("claude", ["--version"]).error,
  read: () => existsSync(config) ? JSON.parse(readFileSync(config, "utf8")).mcpServers?.["chrome-ops"] : undefined,
  add(os, server) {
    check(os.exec("claude", ["mcp", "add-json", "--scope", "user", "chrome-ops", JSON.stringify({ type: "stdio", ...server })]), "claude mcp add-json");
  },
};
