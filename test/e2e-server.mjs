// Disposable, localhost-only target. Never run browser tests against an arbitrary user tab.
import http from "node:http";
import { WebSocketServer } from "ws";

const port = Number(process.env.CHROME_OPS_TEST_PORT ?? 32147);
const server = http.createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/chrome-ops-e2e") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html><title>Chrome Ops E2E</title><h1>Chrome Ops E2E</h1>
      <p>Disposable local test page. No account or personal data.</p>
      <script>console.log('chrome-ops-e2e-ready');</script>`);
  } else if (path === "/ok") {
    res.setHeader("Content-Type", "text/plain");
    res.end("chrome-ops-e2e-response");
  } else if (path === "/fail") {
    res.writeHead(503).end("expected fixture failure");
  } else if (path === "/events") {
    res.writeHead(200, {"Content-Type":"text/event-stream", "Cache-Control":"no-cache"});
    res.write("data: chrome-ops-e2e-sse\n\n");
    req.on("close", () => res.end());
  } else res.writeHead(404).end();
});
const websocket = new WebSocketServer({server, path:"/ws"});
websocket.on("connection", socket => socket.on("message", data => socket.send(data.toString())));
server.listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}/chrome-ops-e2e`));
