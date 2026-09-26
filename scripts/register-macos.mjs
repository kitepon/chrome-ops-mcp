#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = homedir();
const client = process.argv[2];
const index = resolve(root, "dist/index.js");
const command = process.execPath;

function run(program, args) {
  const result = spawnSync(program, args, { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} ${args[0]} failed (${result.status}): ${(result.stderr || result.stdout).trim()}`);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.stdout;
}

function backup(relative) {
  const source = resolve(home, relative);
  if (!existsSync(source)) return null;
  const directory = resolve(home, "Library/Application Support/ChromeOps/backups");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = `${client}-${new Date().toISOString().replaceAll(":", "-")}-${process.pid}.tar.gz`;
  const target = resolve(directory, filename);
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

function codexRegistration() {
  const existing = spawnSync("codex", ["mcp", "get", "chrome-ops", "--json"], { encoding: "utf8" });
  if (existing.error) throw existing.error;
  if (existing.status === 0) {
    const entry = JSON.parse(existing.stdout);
    if (!matching(entry)) throw new Error("Codex has a different chrome-ops server; no configuration was changed");
    return { ok: true, client: "codex", changed: false };
  }
  if (!existing.stderr.includes("No MCP server named 'chrome-ops' found")) {
    throw new Error(`Cannot inspect Codex MCP registration: ${existing.stderr.trim()}`);
  }
  const archive = backup(".codex/config.toml");
  run("codex", ["mcp", "add", "chrome-ops", "--", command, index]);
  const entry = JSON.parse(run("codex", ["mcp", "get", "chrome-ops", "--json"]));
  if (!matching(entry)) throw new Error("Codex registration readback differs from the requested stdio command");
  return { ok: true, client: "codex", changed: true, backup: archive };
}

function cursorRegistration() {
  if (!existsSync("/Applications/Cursor.app") && !existsSync(resolve(home, "Applications/Cursor.app"))) {
    throw new Error("Cursor application is not installed on this Mac");
  }
  const path = resolve(home, ".cursor/mcp.json");
  const source = existsSync(path) ? readFileSync(path, "utf8") : "{\n  \"mcpServers\": {}\n}\n";
  const config = JSON.parse(source);
  if (config.mcpServers === undefined) config.mcpServers = {};
  if (!config.mcpServers || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers)) {
    throw new Error("Cursor mcpServers is not an object; no configuration was changed");
  }
  const existing = config.mcpServers["chrome-ops"];
  if (existing) {
    if (!matching(existing)) throw new Error("Cursor has a different chrome-ops server; no configuration was changed");
    return { ok: true, client: "cursor", changed: false };
  }
  const archive = backup(".cursor/mcp.json");
  config.mcpServers["chrome-ops"] = { type: "stdio", command, args: [index] };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: existsSync(path) ? statSync(path).mode & 0o777 : 0o600 });
  renameSync(temporary, path);
  const readback = JSON.parse(readFileSync(path, "utf8")).mcpServers?.["chrome-ops"];
  if (!matching(readback)) throw new Error("Cursor registration readback differs from the requested stdio command");
  return { ok: true, client: "cursor", changed: true, backup: archive };
}

function grokRegistration() {
  const existing = JSON.parse(run("grok", ["mcp", "list", "--json"]));
  if (!Array.isArray(existing)) throw new Error("Grok MCP inventory is not an array");
  const matches = existing.filter(item => item.name === "chrome-ops");
  if (matches.length > 1) throw new Error("Grok has duplicate chrome-ops entries");
  if (matches.length === 1) {
    if (!matching(matches[0])) throw new Error("Grok has a different chrome-ops server; no configuration was changed");
    return { ok: true, client: "grok", changed: false };
  }
  const archive = backup(".grok/config.toml");
  run("grok", ["mcp", "add", "chrome-ops", "--", command, index]);
  const after = JSON.parse(run("grok", ["mcp", "list", "--json"]));
  if (after.filter(item => item.name === "chrome-ops" && matching(item)).length !== 1) {
    throw new Error("Grok registration readback differs from the requested stdio command");
  }
  run("grok", ["mcp", "doctor", "chrome-ops"]);
  return { ok: true, client: "grok", changed: true, backup: archive };
}

if (process.platform !== "darwin") throw new Error("macOS client registration requires macOS");
try {
  if (!existsSync(index)) throw new Error("Built MCP server is missing; run npm run setup:macos");
  // 登録の正規入口でHostの準備と実効結果も確認する。
  run(process.execPath, [resolve(root, "scripts/macos-host.mjs"), "setup"]);
  const result = client === "codex" ? codexRegistration()
    : client === "cursor" ? cursorRegistration()
      : client === "grok" ? grokRegistration()
        : (() => { throw new Error("Expected codex, cursor, or grok"); })();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, client, error: String(error.message) })}\n`);
  process.exitCode = 1;
}
