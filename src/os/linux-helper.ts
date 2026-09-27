// Linux helper: hand one developer operation to the development Chrome supervisor and print its JSON result.
// It starts the chrome-ops-chrome service when the supervisor is not running yet.
import { spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { serviceName, socketPath } from "./linux-paths.js";

const [operation, value] = process.argv.slice(2);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function ask(): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath());
    let reply = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ operation, value })}\n`));
    socket.on("data", chunk => { reply += chunk; });
    socket.on("end", () => resolve(reply.trim()));
    socket.on("error", reject);
  });
}

let reply: string|undefined;
for (let attempt = 0; attempt < 150 && reply === undefined; attempt++) {
  try {
    reply = await ask();
  } catch (error) {
    if (!["ENOENT", "ECONNREFUSED"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    if (attempt === 0 && process.env.CHROME_OPS_CHROME_SOCKET === undefined) spawnSync("systemctl", ["--user", "start", serviceName]);
    await sleep(200);
  }
}
if (reply === undefined) {
  process.stdout.write(`${JSON.stringify({ ok: false, operation: `extension.dev.${operation}`, error: `The Chrome Ops development Chrome (${serviceName}) did not start` })}\n`);
  process.exit(1);
}
process.stdout.write(`${reply}\n`);
process.exit(JSON.parse(reply).ok ? 0 : 1);
