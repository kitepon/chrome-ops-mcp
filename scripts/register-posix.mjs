#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { register } from "./clients.mjs";
import { root } from "./host-client.mjs";

const client = process.argv[2];
const hostScript = { darwin: "macos-host.mjs", linux: "linux-host.mjs" }[process.platform];
if (!hostScript) throw new Error("POSIX client registration requires macOS or Linux");
try {
  // 登録の正規入口でHostの準備と実効結果も確認する。
  const setup = spawnSync(process.execPath, [resolve(root, "scripts", hostScript), "setup"], { cwd: root, encoding: "utf8" });
  if (setup.error) throw setup.error;
  if (setup.status !== 0) throw new Error(`Host setup failed: ${(setup.stderr || setup.stdout).trim()}`);
  process.stdout.write(`${JSON.stringify(register(client))}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, client, error: String(error.message) })}\n`);
  process.exitCode = 1;
}
