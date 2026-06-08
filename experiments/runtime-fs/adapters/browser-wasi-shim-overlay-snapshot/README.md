# browser-wasi-shim-overlay-snapshot Adapter

This adapter is implemented and benchmarkable.

It uses the same pure-JS `@agda-web/browser_wasi_shim` runtime as the
`browser-wasi-shim-memfs` adapter, but builds the library filesystem as a
snapshot-like layer:

- stdlib and Cubical files are preloaded from the same zip assets
- library `.agda` files are treated as readonly snapshot content
- `.agdai` outputs and `/source.agda` remain writable overlay content

The goal is to separate library preload cost from `Cmd_load` cost while keeping
the same ALS `initialize` + two `Cmd_load` protocol as the other benchmarkable
adapters.

Run:

```sh
npm run benchmark:browser-wasi-shim-overlay-snapshot -- --fixture builtin-nat
npm run benchmark:browser-wasi-shim-overlay-snapshot -- --fixture stdlib-nat
npm run benchmark:browser-wasi-shim-overlay-snapshot -- --fixture cubical-prelude
```
