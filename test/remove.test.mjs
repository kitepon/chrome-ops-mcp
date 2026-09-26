import test, { mock } from "node:test";
import assert from "node:assert/strict";

// 実際のMCPハンドラーを登録し、外部のChromeとネイティブ操作だけを置き換える。
const handlers = new Map();
let inventory;
let calls;
const mockNamed = (specifier, exports) => mock.module(specifier,
  Number(process.versions.node.split(".")[0]) < 24 ? { namedExports: exports } : { exports });
mockNamed("@modelcontextprotocol/sdk/server/mcp.js", {
  McpServer: class {
    tool(name, _description, _schema, handler) { handlers.set(name, handler); }
    async connect() {}
  },
});
mockNamed("../dist/bridge.js", {
  ChromeBridgeClient: class {
    async call(method) {
      if (method === "host.status") return { connected: true, bridgeSession: "same-profile" };
      if (method === "extensions.preparePage") return { token: "12345678-1234-4123-8123-123456789abc", tabId: 19 };
      calls.push(method); return inventory();
    }
  },
});
mockNamed("../dist/helper.js", {
  helper: async (operation, id) => ({ ok: true, operation, data: { extensionId: id } }),
});
await import("../dist/index.js");
const id = "a".repeat(32);
const remove = () => handlers.get("extension_dev_remove")({ id });

test("削除は正常な一覧応答で対象IDが消えた時だけ成功する", async () => {
  calls = [];
  inventory = () => [{ id: "b".repeat(32) }];
  const result = await remove();
  assert.equal(JSON.parse(result.content[0].text).verifiedRemoved, true);
  assert.deepEqual(calls, ["extensions.list"]);
});

test("一覧への反映前は対象IDの不在を待つ", async () => {
  calls = [];
  inventory = () => calls.length === 1 ? [{ id }] : [];
  await remove();
  assert.equal(calls.length, 2);
});

test("通信障害を削除成功に変換しない", async () => {
  calls = [];
  const failure = new Error("fixture transport timeout");
  inventory = () => { throw failure; };
  await assert.rejects(remove(), error => error === failure);
  assert.equal(calls.length, 1);
});

test("一覧が取得できない応答を削除成功に変換しない", async () => {
  calls = [];
  inventory = () => null;
  await assert.rejects(remove(), /inventory is unavailable/);
});

test("対象が残り続けた場合は失敗する", async () => {
  calls = [];
  inventory = () => [{ id }];
  await assert.rejects(remove(), /still reports extension/);
  assert.equal(calls.length, 20);
});
