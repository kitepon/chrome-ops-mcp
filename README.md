# Chrome Ops MCP

Developer-focused MCP + persistent local host + Chrome Manifest V3 extension for Chrome operations that ordinary browser automation does not expose well.

Chrome Ops is for AI coding agents that need to inspect and operate **Chrome as a developer**, not just click web pages. It lets an agent read DevTools Console/Network data, inspect response bodies and streams, evaluate JavaScript, and manage unpacked Chrome extensions during an edit-test-debug loop.

Initial capabilities: tab discovery, CDP attach/detach, Console/Log capture, Network/WebSocket/EventSource capture, Runtime.evaluate, installed-extension inventory/enable-disable/uninstall, and selected per-site content settings.

This project targets **developers using AI coding agents**. The intended loop is edit -> reload -> inspect Console/Network -> fix -> repeat, including Chrome-extension development.

Client adapters are documented in `docs/CLIENTS.md`. Codex, Cursor, and the local Grok Build CLI use stdio MCP. Chrome Ops never needs to expose its localhost Host ports for these clients.

Network event observations are redacted before they cross the extension boundary: Cookie, Set-Cookie, Authorization, proxy authorization, and cookie value fields are replaced with `[REDACTED]`. Response bodies requested explicitly with `network_response_body` are **not** content-scanned for arbitrary secrets; see `SECURITY.md`.

## Development

```powershell
npm install
npm run build
npm start
```

On Windows, the current developer baseline is PowerShell 7+. `npm run setup:windows` builds the project and registers **Chrome Ops Host** as a per-user logon scheduled task. The Host owns the persistent Chrome connection; short-lived stdio MCP processes connect to it on localhost. It does not modify an MCP client's configuration unless that client is explicitly supported/detected.

## Quick start (Windows alpha)

Requirements: Windows 11, Chrome, Node.js 22+, PowerShell 7+, and Chrome Developer mode. The v0.1 helper is validated with Japanese and English Chrome UI labels.

```powershell
npm install
npm run setup:windows
npm run doctor
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `extension/` from this package/repository. Then register the MCP with one or more detected clients:

```powershell
npm run register:codex
npm run register:cursor
npm run register:grok
```

Restart/reload the MCP client after registration if it does not pick up the new server immediately.

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

## Known boundary

Chrome's public `chrome.management` extension API can inspect installed extensions but does not expose arbitrary unpacked-directory loading or another extension's developer reload action. Chrome Ops uses a deliberately narrow PowerShell 7 + Windows UI Automation helper for those developer-mode operations. The helper is not a generic shell/UI automation API.

### v0.1 alpha limitations

- Windows is the only helper implementation today.
- Chrome Developer mode must already be enabled for unpacked-extension operations.
- Developer-management UI automation is currently validated against Japanese and English Chrome labels; other UI languages are not yet guaranteed.
- The Chrome Ops extension itself must be loaded manually once during initial setup. Future packaging can automate/bootstrap this separately.
- Client registration adapters currently cover Codex, Cursor, and Grok Build. See `docs/CLIENTS.md`.
