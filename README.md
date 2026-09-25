# Chrome Ops MCP

Developer-focused MCP + persistent local host + Chrome Manifest V3 extension for Chrome operations that ordinary browser automation does not expose well.

Initial capabilities: tab discovery, CDP attach/detach, Console/Log capture, Network/WebSocket/EventSource capture, Runtime.evaluate, installed-extension inventory/enable-disable/uninstall, and selected per-site content settings.

This project targets **developers using AI coding agents**. The intended loop is edit -> reload -> inspect Console/Network -> fix -> repeat, including Chrome-extension development.

Client adapters are documented in `docs/CLIENTS.md`. Codex, Cursor, and the local Grok Build CLI use stdio MCP. Chrome Ops never needs to expose its localhost Host ports for these clients.

Network observations are redacted before they cross the extension boundary: Cookie, Set-Cookie, Authorization, proxy authorization, and cookie value fields are replaced with `[REDACTED]`.

## Development

```powershell
npm install
npm run build
npm start
```

On Windows, the current developer baseline is PowerShell 7+. `npm run setup:windows` builds the project and registers **Chrome Ops Host** as a per-user logon scheduled task. The Host owns the persistent Chrome connection; short-lived stdio MCP processes connect to it on localhost. It does not modify an MCP client's configuration unless that client is explicitly supported/detected.

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this repository's `extension` folder. The extension connects only to `ws://127.0.0.1:32145`.

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
