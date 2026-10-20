# Fixed account-audit entry

`node bin/audit-read.js` is a separate, non-MCP entry. It reads exactly one service
name from stdin and prints one JSON object. It accepts no arguments, tool names,
JavaScript, URLs, tab IDs, or nonempty `SSH_ORIGINAL_COMMAND`. Invalid input is
`rejected` without contacting the Host. A restricted SSH key can invoke this
entry using an absolute Node path and an absolute script path; SSH key policy and
registration remain the responsibility of the SSH administrator.

```sh
printf '%s\n' google-connections | node bin/audit-read.js
```

The entry ignores `CHROME_OPS_HOST_URL` and connects only to the existing local
Host at `127.0.0.1:32146`. It checks that exactly one Bridge profile is connected,
and that its session is unchanged after reading. It never starts an MCP server,
enumerates MCP tools, or exposes the other Chrome Ops capabilities.

## Services and URLs

The Bridge owns this table; callers cannot supply a URL.

| Service | Entry URL | Allowed query |
| --- | --- | --- |
| `google-connections` | `https://myaccount.google.com/connections` | None, or one numeric `authuser` |
| `google-cloud-projects` | `https://console.cloud.google.com/cloud-resource-manager` | Unique `organizationId`, `project`, `authuser`; nonempty ASCII letters, digits, hyphens |
| `x-connected-apps` | `https://x.com/settings/connected_apps` | None |
| `discord-developer-apps` | `https://discord.com/developers/applications` | None |
| `discord-authorized-apps` | No URL configured | Always `ok` with `all: not_supported`; no Host or browser connection |

All configured URLs require the exact HTTPS origin and path, no fragment or URL
credentials. URL checks run before evaluation, inside its document, and after
evaluation. X permits only `@QLyun35332` and `@Bell_QuoLu`, compared without case.
Other X accounts stop before application headings or items are read, and their
screen name is not returned. Accounts are never switched.

## Lifecycle and data

One internal `audit.read({service})` request opens a new tab with `active:false`
in an existing normal window belonging to the Bridge profile. It attaches its
own debugger, runs one fixed synchronous DOM projection with `Runtime.evaluate`,
and closes only that new tab in a `finally` block. It enables none of the
Runtime/Log/Network event streams. General tab/DevTools requests cannot target an
active audit tab, and audit events, including late events, are excluded from the
existing capture caches. Normal developer capture remains available elsewhere.

No window is created or focused. No click, input, page reload, DOM write, fetch,
account mutation, or permission revocation is performed. Page loads still make
the site's normal requests, and Chrome may display its debugger indicator.
There is one concurrent audit; another is `stopped/busy`. Slow page loads stop
after about six seconds, inside the existing Host's 15-second request deadline;
the entry also has a 30-second overall deadline.

If closing fails, the result is `stopped/cleanup_failed`, with nonzero exit code
and no account/items. Only numeric tab IDs are retained in `storage.session` for
cleanup before the next supported audit. This needs the `storage` permission;
no page data, URL, or title is stored. Session storage survives worker suspension
but is cleared by browser restart or extension reload/update. An abrupt crash
between tab creation and recording its ID cannot be made transactional with the
Chrome tabs API. Normal completion and caught failures always attempt cleanup.

Fixed semantic readers use visible named headings/lists, labeled fields and
project-table columns. Unrecognized layouts stop with `page_shape_changed`.
An empty list is reported only with a recognized inventory container. Unread
fields are explicitly `needs_click`, `not_found` or `not_supported`. Input and
textarea values, token fields, whole-page text/HTML, cookies, storage, console,
network records and exception text are never returned. These readers are
conservative; they have been tested on synthetic pages, not signed-in accounts.
Live account inspection belongs to the auditor and may require selector updates.

Google identity is returned only as SHA-256 of the trimmed lowercase UTF-8 email
and its domain; the email is hashed inside the Bridge before the Host receives
the result. X returns the permitted public screen name. Discord returns no
account object. Google connection fields are `name`, `section`, `access`, `since`;
Cloud fields are `name`, `project_id`, `state`. X returns `name`, `detail_path`,
with `permissions`/`granted` unconfirmed. Discord returns `name`, `application_id`,
with its five Bot toggles unconfirmed. This version never opens detail pages.

The output has `service`, `entry_version`, `started_at`, `finished_at`, `status`,
`stop_reason`, `account`, `items`, `item_count`, `truncated`, `unconfirmed`.
Strings are limited to 200 Unicode code points with controls removed; there are
at most 200 items. Stopped results discard all items and account data. Status is
`ok`, `stopped`, or `rejected`; only `ok` exits with code 0. Stop reasons are
`redirect`, `login_required`, `account_unknown`, `multi_bridge`, `session_changed`,
`url_mismatch`, `page_shape_changed`, `timeout`, `bridge_unavailable`, `read_failed`,
`cleanup_failed`, `busy`, `no_window`. Invalid input uses `rejected` and a null
stop reason. `not_supported` is an unconfirmed reason, not a stop reason.

The Host and entry add no page-content logs. Existing Host startup logging is
unchanged. Treat the JSON values as untrusted data. The entry does not grant an
SSH account fewer privileges by itself: use a dedicated restricted key, trusted
ownership of the checkout and runtime, and the SSH administrator's policy.

## Tests

Run `npm test`, `npm run test:unit`, and `npm audit --omit=dev`. Set
`CHROME_OPS_AUDIT_TEST_CHROME` to a Chrome binary to run the real-Bridge test.
On Windows it uses Git's OpenSSL by default; `CHROME_OPS_AUDIT_TEST_OPENSSL` can
select another installed OpenSSL. Tests use a separate temporary Chrome profile,
a local HTTPS proxy and freshly generated temporary test certificates. Only the
fixture Bridge's localhost port and a fixed cache-size inspection method are
changed. Synthetic pages are served at the allowed origins without using any
signed-in browser profile or changing a service's account settings.
