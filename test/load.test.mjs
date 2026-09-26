import test, { mock } from "node:test";
import assert from "node:assert/strict";

const handlers = new Map();
const id = "a".repeat(32);
const token = "12345678-1234-4123-8123-123456789abc";
const path = new URL("./fixtures/dummy-extension/", import.meta.url).pathname;
let bridgeCall;
let helperCalls = [];
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
    async call(method) { return bridgeCall(method); }
  },
});
mockNamed("../dist/helper.js", {
  helper: async (...args) => {
    helperCalls.push(args);
    return { ok: true, operation: "extension.dev.load", data: { extensionId: id } };
  },
});
await import("../dist/index.js");
const load = input => handlers.get("extension_dev_load")({ path: input });
const macTest = process.platform === "darwin" ? test : test.skip;

macTest("公開Loadは管理タブ準備と管理APIの事後確認まで一回で行う", async () => {
  let lists = 0;
  helperCalls = [];
  bridgeCall = async method => {
    if (method === "host.status") return { connected: true, bridgeSession: "same-profile" };
    if (method === "extensions.list") return ++lists === 1 ? [] : [{ id, installType: "development" }];
    if (method === "extensions.preparePage") return { token, tabId: 19 };
    throw new Error(`unexpected ${method}`);
  };
  const result = JSON.parse((await load(path)).content[0].text);
  assert.equal(result.verifiedLoaded, true);
  assert.equal(result.extensionId, id);
  assert.deepEqual(helperCalls, [["load", path.slice(0, -1), token]]);
});

macTest("manifestがない場合は管理タブを開かない", async () => {
  helperCalls = [];
  bridgeCall = async method => { throw new Error(`unexpected Chrome request: ${method}`); };
  await assert.rejects(load(new URL("./", import.meta.url).pathname), /manifest\.json/);
  assert.equal(helperCalls.length, 0);
});

macTest("Bridge接続が準備中に切り替わったらネイティブ操作に進まない", async () => {
  helperCalls = [];
  let statuses = 0;
  bridgeCall = async method => {
    if (method === "host.status") return { connected: true, bridgeSession: ++statuses === 1 ? "first" : "second" };
    if (method === "extensions.list") return [];
    if (method === "extensions.preparePage") return { token, tabId: 19 };
    throw new Error(`unexpected ${method}`);
  };
  await assert.rejects(load(path), /profile changed before the developer operation/);
  assert.equal(helperCalls.length, 0);
});

macTest("管理APIが開発用拡張と認めない場合は成功にしない", async () => {
  helperCalls = [];
  let lists = 0;
  bridgeCall = async method => {
    if (method === "host.status") return { connected: true, bridgeSession: "same-profile" };
    if (method === "extensions.list") return ++lists === 1 ? [] : [{ id, installType: "normal" }];
    if (method === "extensions.preparePage") return { token, tabId: 19 };
    throw new Error(`unexpected ${method}`);
  };
  await assert.rejects(load(path), /not an unpacked development extension/);
});

macTest("Reload・Errors・Removeも管理ページを一回の呼び出し内で準備する", async () => {
  helperCalls = [];
  let preparations = 0;
  bridgeCall = async method => {
    if (method === "host.status") return { connected: true, bridgeSession: "same-profile" };
    if (method === "extensions.preparePage") { preparations++; return { token, tabId: 19 }; }
    if (method === "extensions.list") return [];
    throw new Error(`unexpected ${method}`);
  };
  for (const operation of ["reload", "errors", "remove"]) {
    const result = await handlers.get(`extension_dev_${operation}`)({ id });
    assert.equal(result.isError, undefined);
  }
  assert.equal(preparations, 3);
  assert.deepEqual(helperCalls, [
    ["reload", id, token],
    ["errors", id, token],
    ["remove", id, token],
  ]);
});
