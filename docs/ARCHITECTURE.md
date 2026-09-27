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

On macOS and Windows, the Bridge first prepares a fixed management tab in its own Chrome profile. The helper matches that exact tab before using developer controls. The installer has one internal, fixed Bridge-update action for an already connected unpacked Bridge; it is not an MCP tool and does not accept arbitrary URLs or input commands.

## Code layout: shared, OS, harness

Shared code, OS adaptation, and harness adaptation are separated at the file level. Shared files do not branch on `process.platform`; OS files do not know about harnesses; harness files do not know about OSes.

### MCP server (`src/`)

- Shared: `index.ts` (tools), `bridge.ts` (Host client), `host.ts` (persistent Host), `helper.ts` (runs the OS helper and parses its JSON), `protocol.ts`.
- OS: `os/macos.ts`, `os/windows.ts`, `os/linux.ts`, selected by `os/index.ts`. Contract in `os/types.ts`:
  - `unsupportedReason` — `null` when the OS has a developer-operation helper.
  - `reportsLoadedId` — whether the helper reads the new id after Load unpacked. Otherwise the server takes the one new development extension.
  - `usesManagementTab` — whether the Bridge must prepare a chrome://extensions tab before the helper runs (macOS, Windows).
  - `helper(operation, value, token)` — the helper command line.
  - `startBrowser` — starts the Chrome that carries the Bridge when Chrome Ops owns it (Linux); `null` elsewhere.

### Setup (`scripts/`)

- Shared: `chrome-ops.mjs` (entry: `setup`, `uninstall`, `doctor`, `register`), `lib/host-client.mjs`, `lib/bridge-update.mjs`, `lib/registration.mjs`, `lib/process.mjs`.
- OS: `os/macos.mjs` (LaunchAgent, Swift build), `os/windows.mjs` (Scheduled Task, npm-shim resolution), `os/linux.mjs` (systemd user services for the Host and the development Chrome, and its launcher). Each exports:
  - `name`, `stateDir` (backups), `exec(program, args)` (runs a harness CLI), `prepare()`,
  - `installService()` → `{ changed, service }` (idempotent, rolls back on failure), `uninstallService()`, `serviceStatus()`,
  - `developerOperations()` (doctor), `nativeBridgeUpdate(id, activeTabHashes)` or `null`.
- Harness: `harness/claude.mjs`, `harness/codex.mjs`, `harness/cursor.mjs`, `harness/grok.mjs`. See `docs/CLIENTS.md`.

`test/adapters.test.mjs` checks that every OS and harness adapter fills the same contract.

### Native helpers (`helper/`)

`helper/contract.ts` is shared. `helper/macos/` (Swift, Accessibility) and `helper/windows/` (PowerShell 7, UI Automation) implement it by driving the user's Chrome.

### Linux development Chrome

Wayland does not let another program press Chrome's buttons, and Chrome only exposes its pages to AT-SPI when started with `--force-renderer-accessibility`. So on Linux Chrome Ops does not drive the user's Chrome. Instead:

- `src/os/linux-chrome.ts` runs as the `chrome-ops-chrome` systemd user service. It starts Chrome with a dedicated profile, `--remote-debugging-pipe` and `--enable-unsafe-extension-debugging`, turns on developer mode, and loads the Bridge from this checkout (loading again on every start keeps it current). No debugging port is opened.
- It listens on `$XDG_RUNTIME_DIR/chrome-ops/chrome.sock` (user-only). `src/os/linux-helper.ts` is the helper command: it sends one `{operation, value}` request there, starting the service first if needed, and prints the same result JSON as the other helpers.
- Load uses `Extensions.loadUnpacked`, remove uses `Extensions.uninstall` (unpacked only). Reload and errors open chrome://extensions in a background tab and call `chrome.developerPrivate.reload` / `getExtensionInfo`, the same source as the Errors view. Values are an absolute directory or an exact extension id; the expressions are fixed.
- The service is not started at login. `npm run setup`, a developer operation, or the **Chrome Ops Chrome** launcher starts it; closing the last window stops it.
- `src/os/linux-paths.ts` holds the profile, socket and Chrome locations shared by the service, the helper and setup.
