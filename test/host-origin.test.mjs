import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import WebSocket from "ws";

async function freePorts() {
  const servers = [net.createServer(), net.createServer()];
  for (const server of servers) {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
  }
  const ports = servers.map(server => server.address().port);
  for (const server of servers) { server.close(); await once(server, "close"); }
  return ports;
}

async function connectionResult(port, origin) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : undefined);
  return new Promise(resolve => {
    socket.once("open", () => { socket.close(); resolve("accepted"); });
    socket.once("unexpected-response", (_request, response) => { response.resume(); resolve("rejected"); });
    socket.once("error", () => resolve("rejected"));
  });
}

test("ブラウザの別サイトからHostの両ポートに接続できない", async () => {
  const [chromePort, clientPort] = await freePorts();
  const host = spawn(process.execPath, ["dist/host.js"], {
    env: { ...process.env, CHROME_OPS_CHROME_PORT: String(chromePort), CHROME_OPS_HOST_PORT: String(clientPort) },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await once(host.stderr, "data");
    assert.equal(await connectionResult(clientPort, "https://untrusted.example"), "rejected");
    assert.equal(await connectionResult(chromePort, "https://untrusted.example"), "rejected");
    assert.equal(await connectionResult(clientPort), "accepted");
    assert.equal(await connectionResult(chromePort, "chrome-extension://" + "a".repeat(32)), "accepted");
  } finally {
    host.kill("SIGTERM");
    await once(host, "exit");
  }
});
