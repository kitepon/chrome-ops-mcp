// Register the stdio MCP server with a harness. The flow is shared; the harness adapter owns its configuration.
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { harnesses } from "../harness/index.mjs";
import { root } from "./host-client.mjs";

// Every harness launches this Node with the built server, so a registration is tied to this checkout.
export const server = () => ({ command: process.execPath, args: [resolve(root, "dist/index.js")] });

export function matching(entry) {
  const found = entry?.transport ?? entry;
  const expected = server();
  return (found?.type === undefined || found.type === "stdio") &&
    found?.command === expected.command && Array.isArray(found.args) &&
    found.args.length === 1 && found.args[0] === expected.args[0];
}

function backup(os, harness) {
  const source = resolve(homedir(), harness.configFile);
  if (!existsSync(source)) return null;
  const directory = resolve(os.stateDir, "backups");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = resolve(directory, `${harness.name}-${new Date().toISOString().replaceAll(":", "-")}-${process.pid}-${basename(source)}`);
  copyFileSync(source, target);
  chmodSync(target, 0o600);
  return target;
}

export function harnessNamed(name) {
  const harness = harnesses[name];
  if (!harness) throw new Error(`Expected one of: ${Object.keys(harnesses).join(", ")}`);
  return harness;
}

export function register(os, harness) {
  if (!existsSync(server().args[0])) throw new Error("Built MCP server is missing; run npm run setup");
  if (!harness.detect(os)) throw new Error(`${harness.name} is not installed for this user`);
  const existing = harness.read(os);
  if (existing) {
    if (!matching(existing)) throw new Error(`${harness.name} has a different chrome-ops server; no configuration was changed`);
    return { harness: harness.name, changed: false };
  }
  const archive = backup(os, harness);
  harness.add(os, server());
  if (!matching(harness.read(os))) throw new Error(`${harness.name} registration readback differs from the requested stdio command`);
  return { harness: harness.name, changed: true, backup: archive };
}

export function inspect(os) {
  return Object.fromEntries(Object.values(harnesses).map(harness => {
    let detected = false;
    let registered = false;
    let error = null;
    try {
      detected = harness.detect(os);
      if (detected) registered = matching(harness.read(os));
    } catch (failure) { error = String(failure.message); }
    return [harness.name, { detected, registered, error }];
  }));
}
