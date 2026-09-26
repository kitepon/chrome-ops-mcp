# Chrome Ops Helper

Native helper boundary for Chrome developer-mode operations unavailable through public extension APIs.

The helper is intentionally **not** a shell, terminal, generic UI automation server, or arbitrary filesystem API. See `docs/ARCHITECTURE.md` for the allowlist.

Windows uses PowerShell 7 and UI Automation. macOS uses Swift and Accessibility APIs. Both implement the same four-operation contract. On macOS, `npm run setup:macos` builds the release helper used by the MCP server.
