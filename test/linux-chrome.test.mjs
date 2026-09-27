// Linux only: run the development Chrome supervisor headless and drive the four operations through the Linux helper.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { chromeBinary } = await import("../dist/os/linux-paths.js");
const skip = process.platform !== "linux" ? "Linux only" : chromeBinary() ? false : "Chrome is not installed";

test("the Linux helper loads, reloads, reads errors from, and removes an unpacked extension", { skip, timeout: 120000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "chrome-ops-linux-"));
  const env = { ...process.env, CHROME_OPS_CHROME_PROFILE: join(dir, "profile"), CHROME_OPS_CHROME_SOCKET: join(dir, "run/chrome.sock"),
    CHROME_OPS_CHROME_ARGS: "--headless=new --no-sandbox", CHROME_OPS_LOAD_BRIDGE: "0" };
  const supervisor = spawn(process.execPath, ["dist/os/linux-chrome.js"], { env, stdio: ["ignore", "ignore", "pipe"] });
  t.after(async () => {
    supervisor.kill("SIGTERM");
    await new Promise(resolve => supervisor.exitCode === null ? supervisor.once("exit", resolve) : resolve());
    // Chrome's helper processes can still be writing to the profile for a moment after the browser exits.
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  });
  for (let i = 0; i < 150 && !existsSync(env.CHROME_OPS_CHROME_SOCKET); i++) await new Promise(resolve => setTimeout(resolve, 200));
  assert.ok(existsSync(env.CHROME_OPS_CHROME_SOCKET), "supervisor socket");

  const fixture = join(dir, "throwing");
  mkdirSync(fixture);
  writeFileSync(join(fixture, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "Chrome Ops Throwing Fixture", version: "0.0.1", background: { service_worker: "sw.js" } }));
  writeFileSync(join(fixture, "sw.js"), "throw new Error('fixture boom');\n");
  const helper = (...args) => {
    const result = spawnSync(process.execPath, ["dist/os/linux-helper.js", ...args], { env, encoding: "utf8" });
    return { status: result.status, reply: JSON.parse(result.stdout) };
  };

  const loaded = helper("load", fixture);
  assert.equal(loaded.status, 0, JSON.stringify(loaded.reply));
  const id = loaded.reply.data.extensionId;
  assert.match(id, /^[a-p]{32}$/);

  let errors;
  for (let i = 0; i < 30; i++) {
    errors = helper("errors", id);
    if (errors.reply.data?.errors?.some(message => message.includes("fixture boom"))) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(errors.reply.data.errors.some(message => message.includes("fixture boom")), JSON.stringify(errors.reply));

  assert.deepEqual(helper("reload", id).reply.data, { extensionId: id, control: "reload" });
  assert.equal(helper("errors", "not-an-id").status, 1);
  assert.equal(helper("load", "relative/path").status, 1);
  assert.equal(helper("remove", id).reply.data.removed, true);
  assert.equal(helper("errors", id).status, 1, "removed extension is gone");
});
