# macOS implementation handoff

This document is the execution brief for the macOS development task.

## Workspace

Work only from:

```text
~/Developer/chrome-ops-mcp
```

If `~/Developer` does not exist, create it. Clone the public repository into that exact path:

```bash
mkdir -p ~/Developer
cd ~/Developer
git clone https://github.com/kitepon/chrome-ops-mcp.git
cd chrome-ops-mcp
```

If the repository already exists there, do not clone a second copy. Inspect status, preserve local work, and update safely.

## Product goal

Chrome Ops is developer-only MCP tooling for AI coding agents. It gives an agent Chrome DevTools/CDP visibility plus developer-mode extension lifecycle operations that normal browser automation cannot cover.

The public Windows alpha is `v0.1.0-alpha`. macOS support is the next platform target; do not redesign the working core without evidence that macOS requires it.

## Already implemented and verified on Windows

- MCP stdio server (`src/index.ts`)
- persistent local Host (`src/host.ts`)
- Chrome Manifest V3 extension (`extension/`)
- tabs and CDP attach/detach
- Console/Log capture
- HTTP request summaries and failures
- response-body retrieval
- WebSocket and EventSource/SSE capture
- Runtime.evaluate and Page.reload
- extension inventory / enable-disable / uninstall APIs
- content settings
- network credential-header/cookie redaction
- unpacked extension Load / exact-ID Reload / Errors / Remove via narrow Windows helper
- destructive Remove postcondition verification through `chrome.management`
- Host autostart through Windows Task Scheduler
- Codex, Cursor and Grok Build local stdio adapters
- `doctor`

Do not claim a helper action succeeded solely because UI automation returned success. Preserve the existing postcondition philosophy; Windows testing found real false-success cases during reload/remove development.

## Architecture to preserve

```text
AI client (Codex / Cursor / Grok Build / compatible MCP client)
        |
        | stdio MCP
        v
Chrome Ops MCP
        |
        | ws://127.0.0.1:32146
        v
Persistent Chrome Ops Host
        |
        | ws://127.0.0.1:32145
        v
Chrome Ops Extension -> Chrome APIs / CDP

OS-specific helper -> chrome://extensions developer UI
```

The Host ports stay localhost-only. Do not expose them publicly.

## macOS implementation target

Keep the TypeScript MCP, Host, extension and protocol shared unless a real incompatibility is observed.

Replace only the OS-specific pieces:

```text
Windows                           macOS
PowerShell 7 + UI Automation -> Swift + AXUIElement
Task Scheduler               -> LaunchAgent
```

Suggested source layout:

```text
helper/
  windows/
  macos/
    Package.swift
    Sources/ChromeOpsHelper/...
scripts/
  setup-windows.ps1
  setup-macos.sh
```

The exact Swift layout may change if there is a concrete reason.

## Required macOS helper contract

Match the existing logical contract:

- `extension.dev.load(path)`
- `extension.dev.reload(extensionId)`
- `extension.dev.errors(extensionId)`
- `extension.dev.remove(extensionId)`

The macOS helper must remain narrow. Do **not** add arbitrary shell execution, arbitrary mouse/keyboard input, arbitrary URLs, or a generic desktop-automation API.

Prefer macOS Accessibility APIs (`AXUIElement`) and semantic UI elements over screen coordinates.

`load(path)` must resolve and validate the directory and require `manifest.json` before touching Chrome UI.

Reload / Errors / Remove must identify the intended extension by exact extension ID. Removal must still be verified after the UI confirmation through Chrome's management API.

## macOS permissions

Determine and document the minimum permissions actually required. Accessibility permission is expected for Chrome UI automation. Do not state that Screen Recording is required unless implementation/testing demonstrates that it is needed.

Detect missing Accessibility authorization and return an actionable diagnostic rather than silently failing.

## Host startup

Implement a per-user LaunchAgent equivalent to the Windows `Chrome Ops Host` scheduled task.

Requirements:

- starts after user login
- runs the built `dist/host.js`
- uses the actual Node executable discovered during setup
- is idempotent on repeated setup
- supports clean uninstall/removal
- `doctor` reports whether it is loaded/running

Do not require root for normal installation if avoidable.

## First actions on the Mac

Before editing code, record the actual environment:

```bash
uname -a
sw_vers
uname -m
which node && node --version
which npm && npm --version
which swift && swift --version
which git && git --version
```

Then:

```bash
cd ~/Developer/chrome-ops-mcp
npm ci
npm test
npm audit --omit=dev
```

Do not proceed past a failing baseline without explaining/fixing it.

## E2E order

1. Prove the existing shared Host + Chrome extension + stdio MCP works on macOS before writing the native helper.
2. Verify tabs and CDP against a real HTTP(S) tab.
3. Verify Console and Network capture.
4. Implement Accessibility authorization diagnostics.
5. Implement Swift helper `load` using a disposable fixture extension.
6. Discover the loaded fixture's actual extension ID through `extensions_list`.
7. Implement and verify exact-ID reload. Use an observable manifest/version change or equivalent postcondition; do not trust UI invocation alone.
8. Implement Errors extraction.
9. Implement Remove, including confirmation and `chrome.management` postcondition verification.
10. Implement LaunchAgent setup/uninstall and extend `doctor`.
11. Re-run Windows-neutral CI/build tests and ensure Windows paths/behavior were not regressed.

## Test fixture

Use `test/fixtures/dummy-extension` or create a macOS-safe disposable fixture. Never use an unrelated user's installed extension for destructive E2E tests.

## Client support

Codex, Cursor and Grok Build are local stdio targets. Reuse the existing MCP server. Adapt registration scripts for macOS paths/configuration only after inspecting the actual installed clients on the Mac; do not invent config paths.

## Security invariants

- localhost-only Host transport
- no generic native automation surface
- exact extension identity for developer lifecycle operations
- validate unpacked path before load
- redact known sensitive Network headers/cookie values before leaving Chrome
- remember that `network_response_body` intentionally returns application payloads and does not promise arbitrary-secret redaction
- fail closed when the target UI/extension cannot be identified unambiguously

## Definition of done for macOS alpha

Do not call macOS support complete until all of these are demonstrated on a real Mac:

- clean build/test baseline
- Host persists independently of an individual MCP stdio process
- Chrome extension connects to Host
- CDP Console and Network observation works
- unpacked fixture Load succeeds
- exact-ID Reload is proven by postcondition
- Errors can be retrieved
- Remove is confirmed and verified absent through Chrome API
- LaunchAgent survives a Host/MCP restart scenario
- `doctor` accurately reports macOS dependencies, permissions, Host and supported clients
- README has reproducible macOS setup instructions
- no personal paths, IDs, tokens, cookies, private IPs, or test secrets are committed

## Git workflow

Start from current `main`. Use a dedicated branch such as `feat/macos-support`. Keep commits reviewable. Do not overwrite or rewrite the published `v0.1.0-alpha` tag.

Before pushing:

```bash
npm test
npm audit --omit=dev
git status
```

The intended next public version is a macOS-capable v0.2 alpha/beta only after real Mac E2E evidence exists.
