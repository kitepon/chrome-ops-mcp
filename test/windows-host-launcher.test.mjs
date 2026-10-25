import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const source = fileURLToPath(new URL("../scripts/os/windows-host-launcher.cs", import.meta.url));
const compiler = resolve(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
const build = `--build=${"a".repeat(64)}`;

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await sleep(30);
  }
  assert.fail("Timed out waiting for fixture process lifecycle");
}
function running(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

test("Windows background launcher preserves paths, failures and task-owned process lifetime", { skip: process.platform !== "win32" }, async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "chrome-ops 空白 %USERNAME% "));
  let supervisor;
  let pids = [];
  try {
    const launcher = resolve(dir, "host-launcher.exe");
    const compiled = spawnSync(compiler, ["/nologo", "/target:winexe", `/out:${launcher}`, source], { windowsHide: true, encoding: "utf8" });
    assert.ifError(compiled.error);
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const binary = readFileSync(launcher);
    assert.equal(binary.readUInt16LE(binary.readUInt32LE(0x3c) + 24 + 68), 2, "launcher must use the GUI PE subsystem");
    const entry = resolve(dir, "host fixture.cjs");
    const receipt = resolve(dir, "receipt.json");
    writeFileSync(entry, `const fs = require('node:fs');\nsetTimeout(() => { fs.writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)})); process.exit(23); }, 250);\n`);
    const result = spawnSync(launcher, [process.execPath, entry, build], { cwd: dir, windowsHide: true, timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 23, "launcher must wait for and return the child's failure");
    const observed = JSON.parse(readFileSync(receipt, "utf8"));
    // Windows may expand a TEMP directory's 8.3 alias in process.cwd(). Compare
    // the actual directory, while retaining exact argument and literal-path checks.
    assert.equal(realpathSync.native(observed.cwd), realpathSync.native(dir));
    assert.deepEqual(observed.args, [build]);
    writeFileSync(entry, "process.exit(0);\n");
    const success = spawnSync(launcher, [process.execPath, entry, build], { windowsHide: true, timeout: 10000 });
    assert.ifError(success.error);
    assert.equal(success.status, 0);
    const missing = spawnSync(launcher, [resolve(dir, "missing.exe"), entry, build], { windowsHide: true, timeout: 10000 });
    assert.ifError(missing.error);
    assert.notEqual(missing.status, 0, "a launch error must fail");

    rmSync(receipt);
    writeFileSync(entry, `const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});\nrequire('node:fs').writeFileSync(${JSON.stringify(receipt)},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);\n`);
    supervisor = spawn(launcher, [process.execPath, entry, build], { windowsHide: true, stdio: "ignore" });
    await waitFor(() => existsSync(receipt));
    pids = JSON.parse(readFileSync(receipt, "utf8"));
    assert.ok(pids.every(running));
    supervisor.kill();
    await waitFor(() => pids.every(pid => !running(pid)));
  } finally {
    supervisor?.kill();
    for (const pid of pids) if (running(pid)) process.kill(pid);
    rmSync(dir, { recursive: true, force: true });
  }
});
