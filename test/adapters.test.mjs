import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { linux } = await import("../scripts/os/linux.mjs");
const { macos } = await import("../scripts/os/macos.mjs");
const { windows } = await import("../scripts/os/windows.mjs");
const { harnesses } = await import("../scripts/harness/index.mjs");

test("every OS adapter fills the same setup contract", () => {
  const keys = ["name", "stateDir", "exec", "prepare", "installService", "uninstallService", "serviceStatus", "developerOperations", "nativeBridgeUpdate"];
  for (const os of [linux, macos, windows]) assert.deepEqual(Object.keys(os).sort(), [...keys].sort(), os.name);
  assert.equal(linux.nativeBridgeUpdate, null);
  assert.equal(linux.developerOperations().supported, true);
});

test("every MCP-server OS adapter fills the same helper contract", async () => {
  const { linux: linuxServer } = await import("../dist/os/linux.js");
  const { macos: macosServer } = await import("../dist/os/macos.js");
  const { windows: windowsServer } = await import("../dist/os/windows.js");
  const keys = ["helper", "name", "reportsLoadedId", "unsupportedReason", "usesManagementTab"];
  for (const os of [linuxServer, macosServer, windowsServer]) assert.deepEqual(Object.keys(os).sort(), keys, os.name);
  // Linux works on its own development Chrome, so the Bridge does not prepare a management tab for it.
  assert.equal(linuxServer.usesManagementTab, false);
  assert.deepEqual(linuxServer.helper("reload", "a".repeat(32)).args.slice(1), ["reload", "a".repeat(32)]);
});

test("every harness adapter fills the same registration contract", () => {
  assert.deepEqual(Object.keys(harnesses).sort(), ["claude", "codex", "cursor", "grok"]);
  for (const harness of Object.values(harnesses)) {
    assert.deepEqual(Object.keys(harness).sort(), ["add", "configFile", "detect", "name", "read"], harness.name);
  }
});

test("registration writes a stdio entry that matches this checkout and keeps other servers", async t => {
  const home = mkdtempSync(join(tmpdir(), "chrome-ops-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home; process.env.USERPROFILE = home;
  t.after(() => Object.assign(process.env, saved));
  const { cursor } = await import(`../scripts/harness/cursor.mjs?home=${Date.now()}`);
  const { matching, server } = await import("../scripts/lib/registration.mjs");
  const configPath = join(home, ".cursor/mcp.json");
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(join(home, ".cursor"));
  writeFileSync(configPath, JSON.stringify({ mcpServers: { other: { command: "x" } } }));
  cursor.add(null, server());
  const written = JSON.parse(readFileSync(configPath, "utf8"));
  assert.deepEqual(written.mcpServers.other, { command: "x" });
  assert.equal(matching(written.mcpServers["chrome-ops"]), true);
  assert.equal(matching({ ...server(), command: "/elsewhere/node" }), false);
  assert.equal(matching({ transport: { type: "stdio", ...server() } }), true);
});
