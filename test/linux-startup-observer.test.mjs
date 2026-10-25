import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const observer = new URL("./support/linux-startup-observer.mjs", import.meta.url).href;
const hasStrace = process.platform === "linux" && spawnSync("strace", ["--version"]).status === 0;
for (const traced of [false, true]) {
  for (const protocolError of [false, true]) {
    test(`startup observation preserves direct-child ownership and ${protocolError ? "failure" : "success"}, strace=${traced}`,
      { skip: process.platform !== "linux" || (traced && !hasStrace), timeout: 10000 }, async () => {
      const dir = mkdtempSync(join(tmpdir(), "chrome-ops-observer-"));
      const fixture = join(dir, "fake-chrome.mjs"), receipt = join(dir, "receipt.json"), output = join(dir, "startup.json");
      const secret = "fixture-secret-must-not-be-captured";
      const args = ["--remote-debugging-pipe", "--user-data-dir=" + join(dir, "profile with spaces"), "literal %USERNAME%"];
      const exitCode = protocolError ? 23 : 17;
      let supervisor, closed;
      try {
        writeFileSync(fixture, `#!/usr/bin/env node
import {createReadStream,createWriteStream,writeFileSync} from 'node:fs';
if(process.argv.includes('--version')){console.log('Fake Chrome observation 1.0');process.exit(0)}
writeFileSync(${JSON.stringify(receipt)},JSON.stringify({pid:process.pid,parent:process.ppid,args:process.argv.slice(2)}));
const input=createReadStream(null,{fd:3}),output=createWriteStream(null,{fd:4});
setInterval(()=>{},1000);
input.once('data',c=>{const p=JSON.parse(c.toString().split('\\0')[0]);output.write(JSON.stringify({id:p.id,${protocolError ? "error:{message:" + JSON.stringify(secret) + "}" : "result:{product:'FakeChrome/1.0'}"}})+'\\0')});
`);
        chmodSync(fixture, 0o700);
        const code = `import {spawn} from 'node:child_process';
const child=spawn(${JSON.stringify(fixture)},${JSON.stringify(args)},{stdio:['ignore','ignore','pipe','pipe','pipe']});
let buffer='';child.stdio[4].on('data',c=>{buffer+=c;if(buffer.includes('\\0'))child.kill('SIGTERM')});
child.once('spawn',()=>child.stdio[3].write(JSON.stringify({id:1,method:'Browser.getVersion',params:{secret:${JSON.stringify(secret)}}})+'\\0',()=>{}));
child.once('close',()=>{process.exitCode=${exitCode}});
`;
        supervisor = spawn(process.execPath, ["--import", observer, "--input-type=module", "-e", code],
          { env: { ...process.env, CHROME_OPS_TEST_DIAGNOSTICS: output, CHROME_OPS_TEST_STRACE: traced ? "1" : "0" }, stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        supervisor.stderr.on("data", c => stderr += c);
        closed = new Promise((resolve, reject) => { supervisor.once("error", reject); supervisor.once("close", resolve); });
        assert.equal(await closed, exitCode, stderr);
        const raw = readFileSync(output, "utf8"), observation = JSON.parse(raw), actual = JSON.parse(readFileSync(receipt, "utf8"));
        assert.equal(actual.parent, supervisor.pid, "Chrome must remain the supervisor's direct child");
        assert.equal(observation.chromePid, actual.pid, "signals must still target the Chrome PID");
        assert.deepEqual(actual.args, args);
        assert.equal(observation.supervisorExitCode, exitCode);
        assert.equal(observation.version, "Fake Chrome observation 1.0");
        assert.equal(observation.savedAt, "supervisor_exit");
        assert.ok(observation.events.some(e => e.type === "version_request_write_complete"));
        assert.ok(observation.events.some(e => e.type === "version_response" && e.protocolError === protocolError));
        assert.ok(observation.events.some(e => e.type === "child_close" && e.signal === "SIGTERM"));
        assert.ok(observation.samples.length > 0);
        assert.ok(!raw.includes(secret), "request parameters and protocol-error text must not be recorded");
        if (traced) {
          const trace = readFileSync(output + ".strace", "utf8");
          assert.ok(trace.includes("read(") && trace.includes("write("));
          assert.ok(!trace.includes(secret), "syscall buffers must be raw addresses");
        }
      } finally {
        if (supervisor && supervisor.exitCode === null && supervisor.signalCode === null) supervisor.kill("SIGKILL");
        if (closed) await closed;
        if (existsSync(receipt)) {
          const pid = JSON.parse(readFileSync(receipt, "utf8")).pid;
          try { if (readFileSync(`/proc/${pid}/cmdline`).includes(Buffer.from(fixture))) process.kill(pid, "SIGKILL"); }
          catch (error) { if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error; }
        }
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}

test("startup observation does not consume an unhandled child spawn error", { skip: process.platform !== "linux", timeout: 10000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "chrome-ops-observer-error-"));
  const output = join(dir, "startup.json");
  try {
    const code = `import {spawn} from 'node:child_process';
const child=spawn(${JSON.stringify(join(dir, "missing-chrome"))},[],{stdio:['ignore','ignore','pipe','pipe','pipe']});
child.once('close',()=>{process.exitCode=37});`;
    const child = spawn(process.execPath, ["--import", observer, "--input-type=module", "-e", code],
      { env: { ...process.env, CHROME_OPS_TEST_DIAGNOSTICS: output, CHROME_OPS_TEST_STRACE: "0" }, stdio: "ignore" });
    const exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(exitCode, 1, "observing an error must preserve the original unhandled-error exit");
    const data = JSON.parse(readFileSync(output, "utf8"));
    assert.ok(data.events.some(e => e.type === "spawn_error" && e.code === "ENOENT"));
    assert.equal(data.supervisorExitCode, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
