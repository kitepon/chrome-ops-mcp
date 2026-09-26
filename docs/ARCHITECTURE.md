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

On macOS, the Bridge first prepares a fixed management tab in its own Chrome profile. The helper matches that exact tab before using developer controls. The installer has one internal, fixed Bridge-update action for an already connected unpacked Bridge; it is not an MCP tool and does not accept arbitrary URLs or input commands.
