# Chrome Ops Helper

Native helper boundary for Chrome developer-mode operations unavailable through public extension APIs.

The helper is intentionally **not** a shell, terminal, generic UI automation server, or arbitrary filesystem API. See `docs/ARCHITECTURE.md` for the allowlist.

The first implementation target is Windows/Chrome. macOS can implement the same four-operation contract later.
