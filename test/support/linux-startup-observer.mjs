// Test-only preload. Never imported by the installed Host or supervisor.
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { availableParallelism, loadavg } from "node:os";
import { performance } from "node:perf_hooks";
import { errorMonitor } from "node:events";

const output = process.env.CHROME_OPS_TEST_DIAGNOSTICS;
if (process.platform === "linux" && output) {
  const originalSpawn = childProcess.spawn;
  let observed = false;
  childProcess.spawn = function(command, args, options) {
    if (observed || options?.stdio?.[3] !== "pipe" || options?.stdio?.[4] !== "pipe") {
      return Reflect.apply(originalSpawn, this, arguments);
    }
    observed = true;
    const version = childProcess.spawnSync(command, ["--version"], { encoding: "utf8", timeout: 2000, maxBuffer: 4096 });
    const start = performance.now();
    const record = { at: new Date().toISOString(), node: process.version, binary: basename(command),
      version: version.status === 0 ? version.stdout.trim().slice(0, 300) : null,
      versionProbeStatus: version.status, versionProbeError: version.error?.code ?? null,
      parallelism: availableParallelism(), loadavg: loadavg(),
      environment: Object.fromEntries(["DBUS_SESSION_BUS_ADDRESS", "DBUS_SYSTEM_BUS_ADDRESS", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR"]
        .map(name => [name, { present: !!process.env[name], ...(name.startsWith("DBUS") ? { scheme: process.env[name]?.split(":", 1)[0] ?? null } : {}) }])),
      syscalls: process.env.CHROME_OPS_TEST_STRACE === "1", events: [], samples: [], droppedSamples: 0, errors: [] };
    const mark = (type, extra = {}) => record.events.push({ ms: Number((performance.now() - start).toFixed(3)), type, ...extra });
    const save = reason => {
      record.savedAt = reason;
      try { writeFileSync(output, JSON.stringify(record)); }
      catch { process.stderr.write("Chrome test diagnostics could not be saved\n"); }
    };
    const traceArgs = ["-D", "-f", "-ttt", "-T", "-e", "trace=read,write,poll,ppoll,epoll_wait,epoll_pwait,epoll_pwait2,futex,connect",
      "-e", "raw=read,write", "-o", output + ".strace", command, ...args];
    mark("spawn_call");
    // -D keeps the tracee as our direct child. Do not add a wrapper process/group
    // whose termination would change the supervisor's existing cleanup semantics.
    const child = Reflect.apply(originalSpawn, this, record.syscalls ? ["strace", traceArgs, options] : [command, args, options]);
    record.chromePid = child.pid ?? null;
    const sample = () => {
      if (!child.pid) return;
      try {
        const raw = readFileSync(`/proc/${child.pid}/stat`, "utf8");
        const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
        const scheduler = readFileSync(`/proc/${child.pid}/schedstat`, "utf8").trim().split(/\s+/).map(Number);
        record.samples.push({ ms: Number((performance.now() - start).toFixed(3)), pid: child.pid, parentPid: Number(fields[1]),
          state: fields[0], userTicks: Number(fields[11]), systemTicks: Number(fields[12]), threads: Number(fields[17]),
          runNs: scheduler[0], runqueueNs: scheduler[1], wchan: readFileSync(`/proc/${child.pid}/wchan`, "utf8").trim() });
        if (record.samples.length > 200) { record.samples.shift(); record.droppedSamples++; }
      } catch (error) {
        if (error.code !== "ENOENT" && record.errors.length < 5) record.errors.push({ stage: "proc", code: error.code });
      }
    };
    const sampler = setInterval(sample, 100);
    sampler.unref();
    process.once("exit", code => { clearInterval(sampler); record.supervisorExitCode = code; save("supervisor_exit"); });
    child.once("spawn", () => { mark("spawn"); sample(); });
    child.once(errorMonitor, error => { mark("spawn_error", { code: error.code }); save("spawn_error"); });
    child.once("exit", (code, signal) => mark("child_exit", { code, signal }));
    child.once("close", (code, signal) => { clearInterval(sampler); mark("child_close", { code, signal }); save("child_close"); });
    let requestId, buffer = "", firstBytes = false;
    const input = child.stdio[3], outputStream = child.stdio[4];
    const write = input.write;
    input.write = function(...values) {
      let versionRequest = false;
      if (requestId === undefined) {
        let packet;
        try { packet = JSON.parse(values[0].toString().split("\0", 1)[0]); } catch { /* Observation must not change a write. */ }
        if (packet?.method === "Browser.getVersion" && Number.isSafeInteger(packet.id)) {
          requestId = packet.id;
          versionRequest = true;
          mark("version_request_write");
          const last = values.length - 1, callback = values[last];
          if (typeof callback === "function") values[last] = function(...result) {
            mark("version_request_write_complete", { error: result[0]?.code ?? null });
            return Reflect.apply(callback, this, result);
          };
        }
      }
      const accepted = Reflect.apply(write, this, values);
      if (versionRequest) mark("version_request_write_return", { backpressure: accepted === false });
      return accepted;
    };
    const onData = chunk => {
      if (requestId === undefined) return;
      if (!firstBytes) { firstBytes = true; mark("first_response_bytes"); }
      buffer += chunk.toString();
      if (buffer.length > 65536) { mark("response_observation_limit"); outputStream.off("data", onData); buffer = ""; return; }
      for (let end; (end = buffer.indexOf("\0")) >= 0;) {
        let packet;
        try { packet = JSON.parse(buffer.slice(0, end)); } catch {
          mark("invalid_response"); outputStream.off("data", onData); buffer = ""; return;
        }
        buffer = buffer.slice(end + 1);
        if (packet?.id === requestId) {
          mark("version_response", { protocolError: !!packet.error });
          outputStream.off("data", onData); buffer = ""; return;
        }
      }
    };
    outputStream.on("data", onData);
    return child;
  };
  syncBuiltinESMExports();
}
