import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const noop = () => {};
const event = {addListener:noop};
const context = vm.createContext({
  WebSocket:class {}, clearTimeout:noop, clearInterval:noop,
  chrome:{runtime:{onStartup:event,onInstalled:event},action:{onClicked:event},debugger:{onDetach:event,onEvent:event}},
});
vm.runInContext(readFileSync(new URL("../extension/service-worker.js",import.meta.url),"utf8"),context);
const sanitize = input => JSON.parse(JSON.stringify(context.sanitize(input)));

test("redacts structured credentials and cookie values recursively", () => {
  assert.deepEqual(sanitize([{headers:{Cookie:"dummy",Authorization:"dummy","Set-Cookie":"dummy","Proxy-Authorization":"dummy",Accept:"text/plain"},cookie:{name:"fixture",value:"dummy"}}]),
    [{headers:{Cookie:"[REDACTED]",Authorization:"[REDACTED]","Set-Cookie":"[REDACTED]","Proxy-Authorization":"[REDACTED]",Accept:"text/plain"},cookie:"[REDACTED]"}]);
  assert.deepEqual(sanitize({cookies:[{name:"fixture",value:"dummy"}]}), {cookies:[{name:"fixture",value:"[REDACTED]"}]});
});
test("redacts CDP's raw copies of request/response headers and cookie lines", () => {
  const input = {method:"Network.webSocketHandshakeResponseReceived",params:{response:{status:101,
    requestHeadersText:"GET /ws HTTP/1.1\r\nCookie: fixture=dummy\r\n",
    headersText:"HTTP/1.1 101 Switching Protocols\r\nSet-Cookie: fixture=dummy\r\n",
    blockedCookies:[{cookieLine:"fixture=dummy"}],headers:{Upgrade:"websocket"}}}};
  const result = sanitize(input);
  assert.equal(result.params.response.requestHeadersText,"[REDACTED]");
  assert.equal(result.params.response.headersText,"[REDACTED]");
  assert.equal(result.params.response.blockedCookies[0].cookieLine,"[REDACTED]");
  assert.equal(result.params.response.status,101);
  assert.equal(result.params.response.headers.Upgrade,"websocket");
  assert.ok(!JSON.stringify(result).includes("dummy"));
});
test("does not scan arbitrary application payloads", () => {
  assert.deepEqual(sanitize({body:"application payload",payloadData:"frame"}),{body:"application payload",payloadData:"frame"});
});
