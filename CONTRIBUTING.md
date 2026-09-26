# Contributing

Chrome Ops targets developer workflows that ordinary browser automation cannot cover cleanly. Keep new capabilities narrow and auditable.

Before a pull request:

```sh
npm ci
npm test
npm audit --omit=dev
```

Do not add generic shell execution or arbitrary desktop input to the helper. Prefer Chrome extension APIs or CDP first; use the native helper only for Chrome developer-management UI that public APIs cannot expose.
