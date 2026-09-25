# MCP client support

Chrome Ops keeps client-specific installation outside the core runtime.

## Local stdio clients

- Codex — local MCP configuration/CLI when detected.
- Cursor — global `~/.cursor/mcp.json` or Cursor's programmatic MCP registration API.
- Claude clients — adapter to be implemented after current local configuration is detected/verified.

These clients launch `dist/index.js`; that short-lived stdio process talks to the persistent Chrome Ops Host on `127.0.0.1:32146`.

## Grok Build

Grok Build supports local stdio MCP servers natively. Register Chrome Ops with Grok's own `grok mcp add` command. Grok Build also supports user/project TOML MCP configuration and compatibility imports from Cursor/Claude MCP files.

Topology: `Grok Build -> Chrome Ops stdio MCP -> persistent Host -> Chrome`.

This support is for the local **Grok Build CLI**, not the grok.com Custom MCP connector product.
