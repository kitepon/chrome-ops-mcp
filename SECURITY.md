# Security

Chrome Ops is intentionally powerful developer tooling. The Chrome extension can attach the Chrome DevTools Protocol to tabs, inspect network activity, evaluate JavaScript, and manage supported browser settings. The Windows and macOS helpers can operate a narrow subset of `chrome://extensions` developer controls.

## Local boundaries

- Host WebSockets bind only to `127.0.0.1`.
- The Chrome endpoint accepts WebSocket handshakes only from a Chrome extension origin; the MCP client endpoint rejects browser Origin headers. This prevents a web page from using the localhost Host as an MCP client. Local non-browser processes are within the user's trust boundary.
- Neither helper exposes an arbitrary shell, click, keypress, URL, or filesystem API.
- Developer extension operations are scoped by exact extension id where applicable and destructive removal is verified after confirmation.
- Network event output redacts Cookie, Set-Cookie, Authorization, Proxy-Authorization and cookie value fields before crossing the extension boundary.
- The macOS helper uses Accessibility authorization for Chrome developer controls. It does not use Screen Recording APIs. Its permission-only doctor check does not inspect Chrome windows.

## Important limitation

`network_response_body` intentionally returns captured response bodies. Application payloads can themselves contain API keys, tokens, personal data, or other secrets. Chrome Ops does **not** attempt to guess and redact arbitrary secrets inside response bodies. Use the tool only on applications and sessions whose data you are authorized to inspect.

## Reporting

Do not publish suspected vulnerabilities as a public issue until the maintainer has had a reasonable opportunity to assess them. Use the repository's private security reporting feature when available.
