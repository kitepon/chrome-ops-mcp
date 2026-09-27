// Linux: run a dedicated development Chrome and serve the four developer operations through its DevTools pipe.
// The chrome-ops-chrome systemd user service starts this file; linux-helper.ts talks to it over a user-only Unix socket.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { dirname, isAbsolute, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { chromeBinary, packageRoot, profileDir, socketPath } from "./linux-paths.js";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const extensionId = /^[a-p]{32}$/;

class DevTools {
  private next = 1;
  private buffer = "";
  private waiting = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  constructor(private input: Writable, output: Readable) {
    output.setEncoding("utf8");
    output.on("data", (chunk: string) => {
      this.buffer += chunk;
      for (let end = this.buffer.indexOf("\0"); end >= 0; end = this.buffer.indexOf("\0")) {
        const message = JSON.parse(this.buffer.slice(0, end));
        this.buffer = this.buffer.slice(end + 1);
        const waiter = this.waiting.get(message.id);
        if (!waiter) continue;
        this.waiting.delete(message.id);
        clearTimeout(waiter.timer);
        message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
      }
    });
  }
  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`Chrome did not answer ${method}`)); }, 15000);
      this.waiting.set(id, { resolve, reject, timer });
      this.input.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  }
}

// chrome.developerPrivate exists only on chrome://extensions, so each operation opens that page in a background tab.
async function onManagementPage<T>(devtools: DevTools, use: (evaluate: (expression: string) => Promise<any>) => Promise<T>): Promise<T> {
  const { targetId } = await devtools.send("Target.createTarget", { url: "chrome://extensions/", background: true });
  try {
    const { sessionId } = await devtools.send("Target.attachToTarget", { targetId, flatten: true });
    const evaluate = async (expression: string) => {
      const reply = await devtools.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
      return reply.result.value;
    };
    for (let attempt = 0; !(await evaluate("location.href.startsWith('chrome://extensions') && !!globalThis.chrome?.developerPrivate")); attempt++) {
      if (attempt >= 50) throw new Error("chrome://extensions did not load");
      await sleep(100);
    }
    return await use(evaluate);
  } finally {
    await devtools.send("Target.closeTarget", { targetId }).catch(() => undefined);
  }
}

// Only these four operations exist; values are an absolute directory or an exact extension id, never code.
async function run(devtools: DevTools, operation: string, value: string): Promise<unknown> {
  if (operation === "load") {
    if (!isAbsolute(value) || !statSync(value, { throwIfNoEntry: false })?.isDirectory() || !existsSync(join(value, "manifest.json"))) {
      throw new Error("Load path must be an absolute directory containing manifest.json");
    }
    const { id } = await devtools.send("Extensions.loadUnpacked", { path: value });
    return { path: value, extensionId: id };
  }
  if (!["reload", "errors", "remove"].includes(operation)) throw new Error(`Unknown operation ${operation}`);
  if (!extensionId.test(value)) throw new Error("Expected an exact extension id");
  const id = JSON.stringify(value);
  return onManagementPage(devtools, async evaluate => {
    const info = await evaluate(`chrome.developerPrivate.getExtensionInfo(${id}).then(e => ({
      name: e.name, location: e.location,
      runtimeErrors: e.runtimeErrors.map(x => ({ severity: x.severity, message: x.message, source: x.source })),
      manifestErrors: e.manifestErrors.map(x => ({ message: x.message, manifestKey: x.manifestKey })) }))`);
    if (operation === "errors") {
      const errors = [...info.runtimeErrors, ...info.manifestErrors].map((error: { message: string }) => error.message);
      return { extensionId: value, control: "errors", errors, hasErrorsView: true, runtimeErrors: info.runtimeErrors, manifestErrors: info.manifestErrors };
    }
    if (info.location !== "UNPACKED") throw new Error(`Extension ${value} is not an unpacked development extension`);
    if (operation === "remove") {
      await devtools.send("Extensions.uninstall", { id: value });
      return { extensionId: value, name: info.name, removed: true };
    }
    const failure = await evaluate(`chrome.developerPrivate.reload(${id}, { failQuietly: true, populateErrorForUnpacked: true }).then(error => error ?? null)`);
    if (failure) throw new Error(`Reload failed: ${failure.error ?? JSON.stringify(failure)}`);
    return { extensionId: value, control: "reload" };
  });
}

function serve(socket: Socket, handle: (operation: string, value: string) => Promise<unknown>) {
  let request = "", answered = false;
  socket.setEncoding("utf8");
  socket.on("data", async chunk => {
    request += chunk;
    const end = request.indexOf("\n");
    if (end < 0 || answered) return;
    answered = true;
    let operation = "unknown";
    try {
      const parsed = JSON.parse(request.slice(0, end));
      operation = String(parsed.operation);
      const data = await handle(operation, String(parsed.value));
      socket.end(`${JSON.stringify({ ok: true, operation: `extension.dev.${operation}`, data })}\n`);
    } catch (error) {
      socket.end(`${JSON.stringify({ ok: false, operation: `extension.dev.${operation}`, error: (error as Error).message })}\n`);
    }
  });
  socket.on("error", () => undefined);
}

const binary = chromeBinary();
if (!binary) throw new Error("Google Chrome or Chromium was not found; set CHROME_OPS_CHROME_BINARY");
mkdirSync(profileDir(), { recursive: true, mode: 0o700 });
const extra = (process.env.CHROME_OPS_CHROME_ARGS ?? "").split(/\s+/).filter(Boolean);
const chrome = spawn(binary, [`--user-data-dir=${profileDir()}`, "--remote-debugging-pipe", "--enable-unsafe-extension-debugging",
  "--no-first-run", "--no-default-browser-check", ...extra], { stdio: ["ignore", "inherit", "inherit", "pipe", "pipe"] });
const devtools = new DevTools(chrome.stdio[3] as Writable, chrome.stdio[4] as Readable);
const path = socketPath();
chrome.on("exit", code => { rmSync(path, { force: true }); process.exit(code === 0 ? 0 : 1); });
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => chrome.kill("SIGTERM"));

await devtools.send("Browser.getVersion");
// The Errors view only collects errors in developer mode.
await onManagementPage(devtools, evaluate => evaluate("chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }).then(() => true)"));
// Loading the Bridge again on every start also brings it up to date with this checkout.
if (process.env.CHROME_OPS_LOAD_BRIDGE !== "0") await devtools.send("Extensions.loadUnpacked", { path: join(packageRoot, "extension") });

let queue: Promise<unknown> = Promise.resolve();
const handle = (operation: string, value: string) => {
  const result = queue.then(() => run(devtools, operation, value));
  queue = result.catch(() => undefined);
  return result;
};
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
chmodSync(dirname(path), 0o700);
rmSync(path, { force: true });
const server = createServer(socket => serve(socket, handle));
server.listen(path, () => { chmodSync(path, 0o600); console.error(`Chrome Ops development Chrome ready: ${path}`); });
