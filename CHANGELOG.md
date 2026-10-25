# Changelog

## Unreleased

- Reap the Linux supervisor’s owned Chrome on startup failure, reject pending
  DevTools requests when its pipe ends, and close owned control sockets on exit.
  Keep the existing 15-second command deadline and report failures as failures.
- Release DevTools streams and leave replacement files or sockets untouched after
  the original server has closed its Unix socket.
- Run the Windows Host logon task without opening a console window, preserving
  task lifetime, child exit codes, restart policy, and startup failure diagnostics.
  Existing installations migrate through the normal setup command.

## 0.5.4-alpha.0

- Update body-parser, fast-uri, ip-address, and Zod to patched releases and
  raise the declared Zod minimum to 4.6.7. Keep the MCP transport, tools,
  Host access restrictions, and audit service permissions unchanged.

## 0.5.3-alpha.0

- Read Cloud project rows behind the collapsed No organization branch by allowing
  one strictly scoped tree expansion in the audit-owned background tab. Refuse
  ambiguous controls and keep empty/unknown trees unconfirmed. No project
  selection or URL/query permission is added.
- Verify the expansion action is recorded once and the adjacent Delete action
  remains unrecorded, including an independent recorder positive control.

## 0.5.2-alpha.0

- Start the fixed isolated DOM read after the allowed URL commits, without
  waiting for images and other subresources to finish. A ready inventory can be
  read while Chrome still reports the tab as loading. Blank/uncommitted pages
  remain unread, and redirect checks and cleanup are preserved.
- Add real Chrome regressions with never-finishing image responses for both
  Google audit services. Keep the existing total and internal time limits.

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
