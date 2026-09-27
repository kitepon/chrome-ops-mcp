# Chrome Ops MCP

Developer-focused MCP + persistent local host + Chrome Manifest V3 extension for Chrome operations that ordinary browser automation does not expose well.

Chrome Ops is for AI coding agents that need to inspect and operate **Chrome as a developer**, not just click web pages. It lets an agent read DevTools Console/Network data, inspect response bodies and streams, evaluate JavaScript, and manage unpacked Chrome extensions during an edit-test-debug loop.

Initial capabilities: tab discovery, CDP attach/detach, Console/Log capture, Network/WebSocket/EventSource capture, Runtime.evaluate, installed-extension inventory/enable-disable/uninstall, and selected per-site content settings.

This project targets **developers using AI coding agents**. The intended loop is edit -> reload -> inspect Console/Network -> fix -> repeat, including Chrome-extension development.

Supported harnesses are Claude Code, Codex, Cursor, and the local Grok Build CLI. Each launches the stdio MCP server; Chrome Ops never exposes its localhost Host ports to them. See `docs/CLIENTS.md`.

Network event observations are redacted before they cross the extension boundary: Cookie, Set-Cookie, Authorization, proxy authorization, and cookie value fields are replaced with `[REDACTED]`. Response bodies requested explicitly with `network_response_body` are **not** content-scanned for arbitrary secrets; see `SECURITY.md`.

## Support

| | Host service | Unpacked-extension developer operations |
| --- | --- | --- |
| macOS | LaunchAgent | Swift helper (Accessibility) |
| Windows 11 | logon Scheduled Task | PowerShell 7 helper (UI Automation) |
| Linux (systemd) | systemd user service | not automated yet — use `chrome://extensions` |

Claude Code, Codex, Cursor, and Grok Build are registered the same way on every OS.

## Quick start

Requirements: Chrome with Developer mode, Node.js 22+, and Git. macOS also needs the Swift toolchain (`swift`) and Accessibility permission for the app that runs Chrome Ops. Windows also needs PowerShell 7+ (`pwsh`). Linux needs a systemd user session.

```sh
git clone https://github.com/kitepon/chrome-ops-mcp.git
cd chrome-ops-mcp
npm run setup
```

`npm run setup` installs dependencies, builds, and starts the persistent **Chrome Ops Host** as a per-user service for this OS. It is safe to repeat. When an unpacked Bridge is already connected, it also updates the Bridge from this checkout and waits for the new worker to reconnect.

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this repository's `extension/` directory. Load it in one Chrome profile only; if several Bridge profiles connect, Chrome Ops reports the ambiguity instead of guessing. Then register the harnesses you use:

```sh
npm run register          # every installed harness
npm run register:claude   # or one of: claude, codex, cursor, grok
npm run doctor
```

Registration backs up the harness configuration before a change and refuses to replace a different `chrome-ops` entry. Restart or reload the harness if it does not discover the new server immediately. `npm run doctor` reports the Host service, the Bridge connection, developer-operation readiness, and the registration state of each harness. `npm run uninstall` stops and removes the Host service; it leaves the Bridge extension and harness registrations in place.

Registrations point at the absolute path of the current Node executable and of `dist/index.js` in this checkout. Moving the checkout or changing Node requires registering again.

Logs: macOS writes the Host log to `~/Library/Logs/ChromeOps/`; Linux uses `journalctl --user -u chrome-ops-host`. Backups of harness configuration go to `~/Library/Application Support/ChromeOps/backups` (macOS), `%LOCALAPPDATA%\ChromeOps\backups` (Windows), or `${XDG_STATE_HOME:-~/.local/state}/chrome-ops/backups` (Linux).

## Code layout

Shared code, OS adaptation, and harness adaptation live in separate files.

| Area | Shared | OS adaptation | Harness adaptation |
| --- | --- | --- | --- |
| MCP server | `src/index.ts`, `src/bridge.ts`, `src/host.ts`, `src/helper.ts` | `src/os/{macos,windows,linux}.ts` | — |
| Setup | `scripts/chrome-ops.mjs`, `scripts/lib/` | `scripts/os/{macos,windows,linux}.mjs` | `scripts/harness/{claude,codex,cursor,grok}.mjs` |
| Native helper | `helper/contract.ts` | `helper/macos/`, `helper/windows/` | — |

See `docs/ARCHITECTURE.md` for the contracts between them.

## Core MCP tools

- DevTools: `devtools_attach`, `console_read`, `runtime_evaluate`, `page_reload`
- Network: `network_requests`, `network_failures`, `network_response_body`, `websocket_messages`, `eventsource_messages`
- Extensions: `extensions_list`, `extension_get`, `extension_set_enabled`
- Unpacked extension development: `extension_dev_load`, `extension_dev_reload`, `extension_dev_errors`, `extension_dev_remove`
- Chrome content settings: `content_setting_get`, `content_setting_set`

The extension connects only to the local Chrome Ops Host on `127.0.0.1`.

Chrome 116+ keeps extension service workers alive when WebSocket traffic is active; the bridge sends a 20-second heartbeat. Active `chrome.debugger` sessions also keep the worker alive on Chrome 118+.

## Verified locally

- MCP stdio client -> server -> extension WebSocket connection
- Live Chrome tab enumeration
- `chrome.debugger.attach()` with protocol `1.3`
- `Runtime.evaluate` against a real HTTP tab
- Console/Log capture
- Network capture after `Page.reload`
- Network credential redaction
- Persistent Host survives individual stdio MCP client lifetimes
- Windows helper: Load unpacked, exact-ID reload, Errors extraction, remove + postcondition verification
- macOS helper: Load unpacked, exact-ID reload, Errors extraction, remove + postcondition verification on a disposable fixture
- macOS LaunchAgent: setup, repeat setup, restart, uninstall, and reinstall with stdio MCP reconnection
- v0.3 on macOS 27, Windows 11, and Ubuntu 26.04: `npm run setup`, `npm run register` for Claude Code, Codex, Cursor, and Grok Build, `npm run doctor`, and each harness's own MCP check. Load/reload/errors/remove passed on macOS and Windows with a disposable fixture.

## Known boundary

Chrome's public `chrome.management` extension API can inspect installed extensions but does not expose arbitrary unpacked-directory loading or another extension's developer reload action. Chrome Ops uses deliberately narrow PowerShell 7 + Windows UI Automation and Swift + macOS Accessibility helpers for those developer-mode operations. The helpers are not generic shell/UI automation APIs.

### v0.3 alpha limitations

- Chrome Developer mode must already be enabled for unpacked-extension operations.
- Developer-management UI automation is currently validated against Japanese and English Chrome labels; other UI languages are not yet guaranteed.
- The Chrome Ops extension itself must be loaded manually once during initial setup. Later `npm run setup` runs update an already connected unpacked Bridge.
- Linux does not automate Load unpacked, reload, errors, or remove yet. Chrome's extension-management page is not exposed through AT-SPI in the tested GNOME Wayland session; everything else works on Linux.
- Each unpacked-extension developer operation prepares its own management tab in the connected Bridge profile. Load verifies the new development extension through Chrome's management API before returning `verifiedLoaded: true`. Reload reports UI submission; check an observable version or behavior change. Remove verifies absence through Chrome's management API.
- Each OS was verified on one machine and Chrome installation.
