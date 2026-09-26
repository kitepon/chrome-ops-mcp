import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const source = readFileSync(resolve("extension/service-worker.js"), "utf8");
function bridge({ windows, last, incognito = false }) {
  const calls = [];
  const listeners = [];
  const runtimeListener = { addListener(callback) { listeners.push(callback); } };
  const listener = { addListener() {} };
  let sockets = 0;
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    readyState = FakeWebSocket.CONNECTING;
    constructor() { sockets++; }
  }
  const chrome = {
    runtime: { onStartup: runtimeListener, onInstalled: runtimeListener },
    action: { onClicked: listener },
    debugger: { onDetach: listener, onEvent: listener },
    extension: { inIncognitoContext: incognito },
    windows: {
      async getAll() { return windows; },
      async getLastFocused() { return last; },
      async create(options) { calls.push(["createWindow", options]); return { id: 7 }; },
      async update(id, options) { calls.push(["focusWindow", id, options]); },
    },
    tabs: {
      async create(options) { calls.push(["createTab", options]); return { id: 19 }; },
      async query(options) { calls.push(["queryTab", options]); return [{ id: 19 }]; },
      async remove(id) { calls.push(["removeTab", id]); },
    },
  };
  const context = { chrome, crypto: { randomUUID: () => "12345678-1234-4123-8123-123456789abc" },
    WebSocket: FakeWebSocket, clearTimeout() {}, clearInterval() {}, setTimeout() {}, setInterval() {}, console };
  vm.runInNewContext(source, context);
  return { calls, listeners, socketCount: () => sockets, prepare: () => context.dispatch("extensions.preparePage", {}) };
}

test("起動とインストール通知が重なってもBridge接続は一本", () => {
  const fixture = bridge({ windows: [], last: null });
  fixture.listeners.forEach(listener => listener());
  assert.equal(fixture.socketCount(), 1);
});

test("Bridgeは自身の通常プロファイルの窓に固定の管理URLだけを開く", async () => {
  const fixture = bridge({ windows: [{ id: 7, incognito: false }], last: { id: 7, incognito: false } });
  const result = await fixture.prepare();
  assert.equal(result.tabId, 19);
  assert.equal(result.token, "12345678-1234-4123-8123-123456789abc");
  assert.equal(fixture.calls[0][0], "createTab");
  assert.equal(fixture.calls[0][1].url, `chrome://extensions/?chromeOps=${result.token}`);
  assert.equal(fixture.calls[0][1].windowId, 7);
  assert.equal(fixture.calls[1][0], "focusWindow");
});

test("複数窓で対象を一意に選べなければ操作しない", async () => {
  const fixture = bridge({ windows: [{ id: 7, incognito: false }, { id: 8, incognito: false }], last: { id: 9, incognito: true } });
  await assert.rejects(fixture.prepare(), /no unique last-focused/);
  assert.equal(fixture.calls.length, 0);
});

test("シークレットプロファイルでは管理タブを作らない", async () => {
  const fixture = bridge({ windows: [], last: null, incognito: true });
  await assert.rejects(fixture.prepare(), /incognito profile/);
  assert.equal(fixture.calls.length, 0);
});
