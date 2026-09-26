import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
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
async function connect(port, origin) {
  for (let i = 0; i < 20; i++) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : undefined);
    try {
      await once(socket, "open");
      return socket;
    } catch (error) {
      if (error.code !== "ECONNREFUSED" || i === 19) throw error;
      await delay(20);
    }
  }
}
async function request(socket, method) {
  const id = `${method}-${Math.random()}`;
  const reply = new Promise(resolve => {
    const onMessage = raw => {
      const response = JSON.parse(raw.toString());
      if (response.id !== id) return;
      socket.off("message", onMessage);
      resolve(response);
    };
    socket.on("message", onMessage);
  });
  socket.send(JSON.stringify({ id, type: "request", method }));
  return reply;
}

test("複数Bridge接続時はプロファイルを推測せず、単一接続へ戻ると復旧する", async () => {
  const [chromePort, clientPort] = await freePorts();
  const host = spawn(process.execPath, ["dist/host.js"], {
    env: { ...process.env, CHROME_OPS_CHROME_PORT: String(chromePort), CHROME_OPS_HOST_PORT: String(clientPort) },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const sockets = [];
  try {
    await once(host.stderr, "data");
    const first = await connect(chromePort, "chrome-extension://" + "a".repeat(32)); sockets.push(first);
    first.send(JSON.stringify({ type: "hello", role: "chrome-extension", protocol: 1 }));
    first.on("message", raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === "request") first.send(JSON.stringify({ id: message.id, type: "response", ok: true, result: "first-profile" }));
    });
    const second = await connect(chromePort, "chrome-extension://" + "b".repeat(32)); sockets.push(second);
    second.send(JSON.stringify({ type: "hello", role: "chrome-extension", protocol: 1 }));
    const client = await connect(clientPort); sockets.push(client);
    let status;
    for (let i = 0; i < 20; i++) {
      status = (await request(client, "host.status")).result;
      if (status.bridgeCount === 2) break;
      await delay(20);
    }
    assert.equal(status.bridgeCount, 2);
    assert.equal(status.connected, false);
    assert.equal(status.ambiguousProfiles, true);
    assert.match((await request(client, "tabs.list")).error, /Multiple Chrome Ops Bridge profiles/);
    second.close();
    await once(second, "close");
    status = (await request(client, "host.status")).result;
    assert.equal(status.bridgeCount, 1);
    assert.equal(status.connected, true);
    assert.equal(typeof status.bridgeSession, "string");
    assert.equal((await request(client, "tabs.list")).result, "first-profile");
  } finally {
    for (const socket of sockets) socket.close();
    host.kill("SIGTERM");
    await once(host, "exit");
  }
});
