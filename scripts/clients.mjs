// MCP client registration for macOS and Linux. Each client launches the stdio server with this Node and dist/index.js.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { root } from "./host-client.mjs";

const home = homedir();
export const index = resolve(root, "dist/index.js");
const command = process.execPath;
const backupDirectory = process.platform === "darwin"
  ? resolve(home, "Library/Application Support/ChromeOps/backups")
  : resolve(process.env.XDG_STATE_HOME || resolve(home, ".local/state"), "chrome-ops/backups");

function run(program, args) {
  const result = spawnSync(program, args, { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} ${args[0]} failed (${result.status}): ${(result.stderr || result.stdout).trim()}`);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.stdout;
}

function onPath(program) {
  return spawnSync(program, ["--version"], { encoding: "utf8" }).error === undefined;
}

function backup(client, relative) {
  const source = resolve(home, relative);
  if (!existsSync(source)) return null;
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  const target = resolve(backupDirectory, `${client}-${new Date().toISOString().replaceAll(":", "-")}-${process.pid}.tar.gz`);
  run("tar", ["-czf", target, "-C", home, relative]);
  chmodSync(target, 0o600);
  return target;
}

function matching(entry) {
  const server = entry?.transport ?? entry;
  return (server?.type === undefined || server.type === "stdio") &&
    server?.command === command && Array.isArray(server.args) &&
    server.args.length === 1 && server.args[0] === index;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: existsSync(path) ? statSync(path).mode & 0o777 : 0o600 });
  renameSync(temporary, path);
}

const cursorConfig = resolve(home, ".cursor/mcp.json");
const cursorDetected = () => existsSync("/Applications/Cursor.app") || existsSync(resolve(home, "Applications/Cursor.app")) ||
  onPath("cursor-agent") || existsSync(resolve(home, ".cursor"));
// Claude Code keeps user-scoped servers in ~/.claude.json.
const claudeConfig = resolve(home, ".claude.json");
const claudeEntry = () => existsSync(claudeConfig) ? JSON.parse(readFileSync(claudeConfig, "utf8")).mcpServers?.["chrome-ops"] : undefined;

const registrations = {
  codex() {
    const existing = spawnSync("codex", ["mcp", "get", "chrome-ops", "--json"], { encoding: "utf8" });
    if (existing.error) throw existing.error;
    if (existing.status === 0) {
      if (!matching(JSON.parse(existing.stdout))) throw new Error("Codex has a different chrome-ops server; no configuration was changed");
      return { changed: false };
    }
    if (!existing.stderr.includes("No MCP server named 'chrome-ops' found")) {
      throw new Error(`Cannot inspect Codex MCP registration: ${existing.stderr.trim()}`);
    }
    const archive = backup("codex", ".codex/config.toml");
    run("codex", ["mcp", "add", "chrome-ops", "--", command, index]);
    if (!matching(JSON.parse(run("codex", ["mcp", "get", "chrome-ops", "--json"])))) {
      throw new Error("Codex registration readback differs from the requested stdio command");
    }
    return { changed: true, backup: archive };
  },
  cursor() {
    if (!cursorDetected()) throw new Error("Cursor is not installed for this user");
    const config = JSON.parse(existsSync(cursorConfig) ? readFileSync(cursorConfig, "utf8") : "{\"mcpServers\":{}}");
    if (config.mcpServers === undefined) config.mcpServers = {};
    if (!config.mcpServers || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers)) {
      throw new Error("Cursor mcpServers is not an object; no configuration was changed");
    }
    const existing = config.mcpServers["chrome-ops"];
    if (existing) {
      if (!matching(existing)) throw new Error("Cursor has a different chrome-ops server; no configuration was changed");
      return { changed: false };
    }
    const archive = backup("cursor", ".cursor/mcp.json");
    config.mcpServers["chrome-ops"] = { type: "stdio", command, args: [index] };
    writeJson(cursorConfig, config);
    if (!matching(JSON.parse(readFileSync(cursorConfig, "utf8")).mcpServers?.["chrome-ops"])) {
      throw new Error("Cursor registration readback differs from the requested stdio command");
    }
    return { changed: true, backup: archive };
  },
  grok() {
    const existing = JSON.parse(run("grok", ["mcp", "list", "--json"]));
    if (!Array.isArray(existing)) throw new Error("Grok MCP inventory is not an array");
    const matches = existing.filter(item => item.name === "chrome-ops");
    if (matches.length > 1) throw new Error("Grok has duplicate chrome-ops entries");
    if (matches.length === 1) {
      if (!matching(matches[0])) throw new Error("Grok has a different chrome-ops server; no configuration was changed");
      return { changed: false };
    }
    const archive = backup("grok", ".grok/config.toml");
    run("grok", ["mcp", "add", "chrome-ops", "--", command, index]);
    const after = JSON.parse(run("grok", ["mcp", "list", "--json"]));
    if (after.filter(item => item.name === "chrome-ops" && matching(item)).length !== 1) {
      throw new Error("Grok registration readback differs from the requested stdio command");
    }
    run("grok", ["mcp", "doctor", "chrome-ops"]);
    return { changed: true, backup: archive };
  },
  claude() {
    if (!onPath("claude")) throw new Error("Claude Code is not installed for this user");
    const existing = claudeEntry();
    if (existing) {
      if (!matching(existing)) throw new Error("Claude Code has a different chrome-ops server; no configuration was changed");
      return { changed: false };
    }
    const archive = backup("claude", ".claude.json");
    run("claude", ["mcp", "add-json", "--scope", "user", "chrome-ops", JSON.stringify({ type: "stdio", command, args: [index] })]);
    if (!matching(claudeEntry())) throw new Error("Claude Code registration readback differs from the requested stdio command");
    return { changed: true, backup: archive };
  },
};

export function register(client) {
  if (!(client in registrations)) throw new Error("Expected codex, cursor, grok, or claude");
  if (!existsSync(index)) throw new Error("Built MCP server is missing; run the setup command for this platform");
  return { ok: true, client, ...registrations[client]() };
}

export function inspectClients() {
  const codex = spawnSync("codex", ["mcp", "get", "chrome-ops", "--json"], { encoding: "utf8" });
  let codexRegistered = false;
  let codexError = null;
  if (codex.status === 0) {
    try { codexRegistered = matching(JSON.parse(codex.stdout)); } catch { codexError = "Codex MCP registration returned invalid JSON"; }
  } else if (codex.error) codexError = codex.error.message;
  else if (!codex.stderr.includes("No MCP server named 'chrome-ops' found")) codexError = codex.stderr.trim();
  let cursorRegistered = false;
  let cursorError = null;
  if (existsSync(cursorConfig)) {
    try { cursorRegistered = matching(JSON.parse(readFileSync(cursorConfig, "utf8")).mcpServers?.["chrome-ops"]); }
    catch { cursorError = "Cursor MCP configuration is invalid JSON"; }
  }
  const grok = spawnSync("grok", ["mcp", "list", "--json"], { encoding: "utf8" });
  let grokRegistered = false;
  let grokError = null;
  if (grok.status === 0) {
    try { grokRegistered = JSON.parse(grok.stdout).some(item => item.name === "chrome-ops" && matching(item)); }
    catch { grokError = "Grok MCP inventory returned invalid JSON"; }
  } else grokError = grok.error?.message ?? grok.stderr.trim();
  let claudeRegistered = false;
  let claudeError = null;
  try { claudeRegistered = matching(claudeEntry()); } catch { claudeError = "Claude Code configuration is invalid JSON"; }
  return {
    codex: { detected: codex.error === undefined, registered: codexRegistered, error: codexError },
    cursor: { detected: cursorDetected(), registered: cursorRegistered, error: cursorError },
    grok: { detected: grok.error === undefined, registered: grokRegistered, error: grokError },
    claude: { detected: onPath("claude"), registered: claudeRegistered, error: claudeError },
  };
}
