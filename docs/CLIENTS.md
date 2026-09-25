# MCP client support

Chrome Ops keeps client-specific installation outside the core runtime.

## Local stdio clients

- Codex — local MCP configuration/CLI when detected.
- Cursor — global `~/.cursor/mcp.json` or Cursor's programmatic MCP registration API.
- Claude clients — adapter to be implemented after current local configuration is detected/verified.

These clients launch `dist/index.js`; that short-lived stdio process talks to the persistent Chrome Ops Host on `127.0.0.1:32146`.

## Grok

As of 2026-09, grok.com Custom MCP connectors require an MCP server URL reachable from the public internet. localhost/private-network URLs are not accepted. Therefore Grok must not be treated like a local stdio client.

Planned topology:

`Grok -> authenticated HTTPS MCP gateway -> local Chrome Ops gateway -> persistent Host -> Chrome`

The public gateway is optional and disabled by default. It must authenticate every connection and expose only Chrome Ops MCP methods; it must never expose the Host WebSocket ports directly.
