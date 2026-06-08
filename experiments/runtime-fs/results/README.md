# Runtime / Filesystem Results

This directory records manually curated benchmark summaries. Raw benchmark JSON
should stay in stdout or `/tmp` unless it is intentionally preserved as a sample.

## Measured Combinations

### `runno-proxy-current`

- Runtime: `@runno/wasi`
- Filesystem: the same ALS worker plus cross-worker Runno drive proxy shape used
  by the main app.
- Status: completes first and second `Cmd_load`.
- Fixtures measured: `builtin-nat`, `stdlib-nat`, `cubical-prelude`.

Representative `cubical-prelude` result:

| Mode | First load | Second load | First pathStat duration | Second pathStat duration |
| --- | ---: | ---: | ---: | ---: |
| cache off | 13764.666ms | 4025.44ms | 5454.161ms | 3639.323ms |
| cache on | 10338.347ms | 1648.406ms | 2145.568ms | 1328.583ms |

`--pathstat-cache` is experiment-only. It does not change the main app runtime.

### `runno-direct-fs`

- Runtime: `@runno/wasi`
- Filesystem: direct Runno in-memory drive inside the ALS worker.
- Status: blocked.
- Observed behavior: ALS accepts `Cmd_load` and opens `/source.agda`, but the
  benchmark does not receive Agda `ResponseEnd`.
- Current blocker marker:

```text
[Debug] VFS: opening file:///source.agda
```

## Planned Combinations

### `vscode-wasm-memfs`

- Intended runtime/filesystem: `@vscode/wasm-wasi` plus
  `createMemoryFileSystem()`.
- Reference: `references/vscode-als-wasm-loader`.
- Current blocker: `npm run probe:vscode-wasm` reports that
  `@vscode/wasm-wasi/v1`, `@agda-web/wasm-wasi-core`, and
  `@agda-web/wasm-wasi-lsp` cannot be imported from `experiments/runtime-fs`.
  The reference repo's `vscode-wasm/wasm-wasi-core` and
  `vscode-wasm/wasm-wasi-lsp` package artifacts are also missing in this
  workspace.

### `browser-wasi-shim-memfs`

- Intended runtime/filesystem: `@agda-web/browser_wasi_shim` memory filesystem.
- Status: later-stage placeholder. It is lower priority than
  `vscode-wasm-memfs` because ALS raw LSP stdin/poll behavior is more likely to
  require custom runtime work.
