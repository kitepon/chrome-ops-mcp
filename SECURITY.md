# Security

Chrome Ops is intentionally powerful developer tooling. The Chrome extension can attach the Chrome DevTools Protocol to tabs, inspect network activity, evaluate JavaScript, and manage supported browser settings. The Windows helper can operate a narrow subset of `chrome://extensions` developer controls.

## Local boundaries

- Host WebSockets bind only to `127.0.0.1`.
- The Windows helper exposes no arbitrary shell, click, keypress, URL, or filesystem API.
- Developer extension operations are scoped by exact extension id where applicable and destructive removal is verified after confirmation.
- Network event output redacts Cookie, Set-Cookie, Authorization, Proxy-Authorization and cookie value fields before crossing the extension boundary.

## Important limitation

`network_response_body` intentionally returns captured response bodies. Application payloads can themselves contain API keys, tokens, personal data, or other secrets. Chrome Ops does **not** attempt to guess and redact arbitrary secrets inside response bodies. Use the tool only on applications and sessions whose data you are authorized to inspect.

## Reporting

Do not publish suspected vulnerabilities as a public issue until the maintainer has had a reasonable opportunity to assess them. Use the repository's private security reporting feature when available.
