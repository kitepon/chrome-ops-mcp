// Cursor (editor and cursor-agent) reads global MCP servers from ~/.cursor/mcp.json.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

const config = resolve(homedir(), ".cursor/mcp.json");

function load() {
  const value = JSON.parse(existsSync(config) ? readFileSync(config, "utf8") : "{\"mcpServers\":{}}");
  if (value.mcpServers === undefined) value.mcpServers = {};
  if (!value.mcpServers || typeof value.mcpServers !== "object" || Array.isArray(value.mcpServers)) {
    throw new Error("Cursor mcpServers is not an object; no configuration was changed");
  }
  return value;
}

export const cursor = {
  name: "cursor",
  configFile: ".cursor/mcp.json",
  detect: os => existsSync(resolve(homedir(), ".cursor")) || !os.exec("cursor-agent", ["--version"]).error,
  read: () => existsSync(config) ? load().mcpServers["chrome-ops"] : undefined,
  add(_os, server) {
    const value = load();
    value.mcpServers["chrome-ops"] = { type: "stdio", ...server };
    mkdirSync(dirname(config), { recursive: true, mode: 0o700 });
    const temporary = `${config}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: existsSync(config) ? statSync(config).mode & 0o777 : 0o600 });
    renameSync(temporary, config);
  },
};
