# Chrome Ops architecture

Chrome Ops is developer-only tooling for AI coding agents. It is not general browser automation.

## Trust boundaries

1. **MCP server** — exposes developer-oriented tools to the AI client.
2. **Chrome extension** — owns privileged Chrome extension APIs and CDP (`chrome.debugger`).
3. **Chrome helper** — narrow native component for operations Chrome does not expose to extensions, especially developer-mode extension lifecycle actions.

The helper MUST NOT become a generic desktop automation or arbitrary command-execution API. Its allowlist is intentionally small:

- `extension.dev.load(path)`
- `extension.dev.reload(extensionId)`
- `extension.dev.errors(extensionId)`
- `extension.dev.remove(extensionId)`

Paths passed to `load` must resolve to a directory containing `manifest.json`. The helper reports the exact resolved path before/with the operation result.

## Chrome-side tools

The extension remains responsible for tabs, CDP attach/detach, Runtime, Console, Network, WebSocket/SSE, installed-extension metadata, and supported Chrome settings.

Network secrets are redacted before crossing from the extension to the MCP process.

## Developer workflow target

`edit -> extension_dev_reload -> extension_dev_errors -> console/network inspection -> fix -> repeat`

Initial `Load unpacked` is a helper operation because Chrome's public extension APIs do not expose arbitrary unpacked-directory loading.

On every OS with a helper, the Bridge first prepares a fixed management tab in its own Chrome profile. The helper matches that exact tab before using developer controls. The installer has one internal, fixed Bridge-update action for an already connected unpacked Bridge; it is not an MCP tool and does not accept arbitrary URLs or input commands.

## Code layout: shared, OS, harness

Shared code, OS adaptation, and harness adaptation are separated at the file level. Shared files do not branch on `process.platform`; OS files do not know about harnesses; harness files do not know about OSes.

### MCP server (`src/`)

- Shared: `index.ts` (tools), `bridge.ts` (Host client), `host.ts` (persistent Host), `helper.ts` (runs the OS helper and parses its JSON), `protocol.ts`.
- OS: `os/macos.ts`, `os/windows.ts`, `os/linux.ts`, selected by `os/index.ts`. Contract in `os/types.ts`:
  - `unsupportedReason` — `null` when the OS has a developer-operation helper.
  - `reportsLoadedId` — whether the helper reads the new id after Load unpacked. Otherwise the server takes the one new development extension.
  - `helper(operation, value, token)` — the helper command line.

### Setup (`scripts/`)

- Shared: `chrome-ops.mjs` (entry: `setup`, `uninstall`, `doctor`, `register`), `lib/host-client.mjs`, `lib/bridge-update.mjs`, `lib/registration.mjs`, `lib/process.mjs`.
- OS: `os/macos.mjs` (LaunchAgent, Swift build), `os/windows.mjs` (Scheduled Task, npm-shim resolution), `os/linux.mjs` (systemd user service). Each exports:
  - `name`, `stateDir` (backups), `exec(program, args)` (runs a harness CLI), `prepare()`,
  - `installService()` → `{ changed, service }` (idempotent, rolls back on failure), `uninstallService()`, `serviceStatus()`,
  - `developerOperations()` (doctor), `nativeBridgeUpdate(id, activeTabHashes)` or `null`.
- Harness: `harness/claude.mjs`, `harness/codex.mjs`, `harness/cursor.mjs`, `harness/grok.mjs`. See `docs/CLIENTS.md`.

`test/adapters.test.mjs` checks that every OS and harness adapter fills the same contract.

### Native helpers (`helper/`)

`helper/contract.ts` is shared. `helper/macos/` (Swift, Accessibility) and `helper/windows/` (PowerShell 7, UI Automation) implement it. Linux has no helper yet.
