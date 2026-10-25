# Contributing

Chrome Ops targets developer workflows that ordinary browser automation cannot cover cleanly. Keep new capabilities narrow and auditable.

Before a pull request:

```sh
npm ci
npm test
npm audit --omit=dev
```

Do not add generic shell execution or arbitrary desktop input to the helper. Prefer Chrome extension APIs or CDP first; use the native helper only for Chrome developer-management UI that public APIs cannot expose.

The Linux Chrome integration test preloads a test-only startup observer. It records
Chrome/Node versions, request/response timing, bounded `/proc` CPU and wait samples,
and environment presence (never credentials, request parameters, or response text).
A failed run can retain `startup.json` and a raw-buffer syscall trace under
`CHROME_OPS_TEST_FAILURE_DIR`; successful runs remove their temporary observations.
The supervisor's Chrome arguments, request deadlines and cleanup stay unchanged.

Linux Node 24 CI also sets `CHROME_OPS_TEST_STRACE=1` and requires `strace` on PATH.
It uses `strace -D` so Chrome remains the supervisor's direct child. Tracing can
change timing; the Linux Node 22 job records passive observations for comparison.
The workflow uploads failed-test observations for seven days. The observer and its
fixtures are test files, excluded from the npm package. These diagnostics do not
establish the cause of an intermittent startup timeout by themselves.
