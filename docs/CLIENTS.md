# Harness support

Chrome Ops supports four harnesses: Claude Code, Codex, Cursor, and the local Grok Build CLI. Each launches the stdio MCP server (`node dist/index.js`); that short-lived process talks to the persistent Chrome Ops Host on `127.0.0.1:32146`.

Topology: `harness -> Chrome Ops stdio MCP -> persistent Host -> Chrome Bridge extension -> Chrome`.

## Registration

```sh
npm run register            # every installed harness
npm run register:<harness>  # claude, codex, cursor, or grok
```

Registration runs `npm run setup`'s Host step first, so the Host is running before a harness can start the server. The flow is the same on every OS and for every harness:

1. Read the existing `chrome-ops` entry through the harness adapter.
2. If it already launches this Node with this checkout's `dist/index.js`, do nothing.
3. If a different `chrome-ops` entry exists, stop without changing anything.
4. Otherwise back up the harness configuration file, add the entry, and read it back.

| Harness | Adapter | How it is registered | Configuration |
| --- | --- | --- | --- |
| Claude Code | `scripts/harness/claude.mjs` | `claude mcp add-json --scope user` | `~/.claude.json` |
| Codex | `scripts/harness/codex.mjs` | `codex mcp add` | `~/.codex/config.toml` |
| Cursor | `scripts/harness/cursor.mjs` | writes `mcpServers.chrome-ops` | `~/.cursor/mcp.json` (editor and `cursor-agent`) |
| Grok Build | `scripts/harness/grok.mjs` | `grok mcp add`, then `grok mcp doctor` | `~/.grok/config.toml` |

On Windows the harness CLIs are often npm shims. The Windows OS adapter runs the program the shim points at, so arguments are never re-parsed by `cmd.exe` or PowerShell.

`npm run doctor` shows `detected`, `registered`, and any error per harness.

## Checking a harness

| Harness | Check |
| --- | --- |
| Claude Code | `claude mcp list` shows `chrome-ops ... ✔ Connected` |
| Codex | ask it to call `chrome_status` |
| Cursor | `cursor-agent mcp list-tools chrome-ops` lists the tools |
| Grok Build | `grok mcp doctor chrome-ops` reports it healthy |

## Adding a harness

Add `scripts/harness/<name>.mjs` exporting `{ name, configFile, detect(os), read(os), add(os, server) }` and list it in `scripts/harness/index.mjs`. Run harness CLIs through `os.exec(program, args)` so each OS can resolve them. Do not put OS checks in a harness adapter.

Grok support is for the local **Grok Build CLI**, not the grok.com Custom MCP connector product.
