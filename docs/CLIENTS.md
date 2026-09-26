# MCP client support

Chrome Ops keeps client-specific installation outside the core runtime.

## Local stdio clients

- Codex — local MCP configuration/CLI when detected.
- Cursor — global `~/.cursor/mcp.json`.
- Grok Build — local MCP configuration/CLI when detected.
- Claude clients — adapter to be implemented after current local configuration is detected/verified.

These clients launch `dist/index.js`; that short-lived stdio process talks to the persistent Chrome Ops Host on `127.0.0.1:32146`.

On macOS, run `npm run setup:macos` first, then `npm run register:codex`, `npm run register:cursor`, or `npm run register:grok` for each installed client. Each registration command also checks Host setup. Existing client settings are backed up before a change, and a conflicting `chrome-ops` entry is reported instead of replaced. Run `npm run doctor` to inspect the exact registration state. Setup reloads an already connected unpacked Bridge when its worker source changes; it requires a uniquely connected Chrome profile and Accessibility authorization. Client configuration uses the current absolute Node executable and built MCP server path; relocation or a Node change requires deliberately updating that entry.

## Grok Build

Grok Build supports local stdio MCP servers natively. Register Chrome Ops with Grok's own `grok mcp add` command. Grok Build also supports user/project TOML MCP configuration and compatibility imports from Cursor/Claude MCP files.

Topology: `Grok Build -> Chrome Ops stdio MCP -> persistent Host -> Chrome`.

This support is for the local **Grok Build CLI**, not the grok.com Custom MCP connector product.
