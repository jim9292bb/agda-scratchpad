# browser-wasi-shim-memfs Adapter

This adapter is implemented and benchmarkable.

Reference implementation:

- `../../../../../references/agda-web-browser_wasi_shim/src/wasi.ts`
- `../../../../../references/agda-web-browser_wasi_shim/src/fs_mem.ts`

It uses the pure-JS `@agda-web/browser_wasi_shim` runtime plus a memory
filesystem, then runs ALS through the same `initialize` + `Cmd_load` protocol
as the `runno-proxy-current` baseline.

Implementation notes:

- The benchmark worker builds the reference package once and imports
  `references/agda-web-browser_wasi_shim/dist/index.js`.
- The worker normalizes leading `/` path inputs before calling the WASI shim,
  because the shim only accepts relative WASI paths.
- The benchmark records per-load filesystem statistics from the WASI import
  wrappers, including `path_filestat_get`, `path_open`, `.agda`, and `.agdai`
  counts.

Run:

```sh
npm run benchmark:browser-wasi-shim -- --fixture builtin-nat
npm run benchmark:browser-wasi-shim -- --fixture stdlib-nat
npm run benchmark:browser-wasi-shim -- --fixture cubical-prelude
```
