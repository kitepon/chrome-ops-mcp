# Changelog

## 0.5.0-alpha.0

- Add `bin/audit-read.js`, a service-name-only audit entry with fixed Bridge URLs
  and DOM readers, background tab ownership/cleanup, and no event capture.
- Preserve failed-cleanup tab IDs in session memory only and retry before the
  next supported audit. Bridge 0.3.0 adds `storage` permission for these IDs.
- Keep X inventory restricted to the two configured accounts; mark unsupported
  Discord authorized-app access and deferred detail fields as unconfirmed.
- Test input rejection, URL/account boundaries, failure cleanup, event exclusion
  and fixed output on synthetic DOMs and real Chrome. No new MCP tool is exposed.
- Keep Homebrew Node registrations on the formula's stable `opt` path across
  upgrades. This includes the previously local Mac registration repair.
- Require the patched MCP SDK (`^1.32.1`; lockfile selects 1.32.1).
