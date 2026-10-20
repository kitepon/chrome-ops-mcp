# Changelog

## 0.5.1-alpha.0

- Read current Google Linked apps, Cloud account/tree-grid, X settings-card and
  Discord application-card layouts, while preserving fixed service/URL rules.
- Wait within a bounded deadline for SPA identity and inventory rendering.
  Organization-only Cloud loading shells remain unconfirmed rather than empty.
- Use a top-frame isolated world for fixed DOM reads, without enabling Runtime,
  Log or Network event streams. Page replacements of URL/DOM prototypes cannot
  replace the reader's built-ins.
- Add real-Chrome regressions for current layouts, delayed hydration, page
  prototype replacements, and the real Host/CLI multiple-profile stop.
- Refresh the transitive Hono lockfile patch to resolve GHSA-5r4p-p66f-jhc7.

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
