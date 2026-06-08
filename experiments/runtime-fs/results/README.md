# Runtime / Filesystem Results

This directory records manually curated benchmark summaries. Raw benchmark JSON
should stay in stdout or `/tmp` unless it is intentionally preserved as a sample.

For the current cross-runtime conclusion, see [CONCLUSION.md](./CONCLUSION.md).

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

### `browser-wasi-shim-memfs`

- Runtime: `@agda-web/browser_wasi_shim`
- Filesystem: pure-JS in-memory WASI filesystem with the benchmark harness'
  own import wrappers for path and file statistics.
- Status: completes first and second `Cmd_load`.
- Fixtures measured: `builtin-nat`, `stdlib-nat`, `cubical-prelude`.

Measured results:

| Fixture | First load | Second load | First pathStat duration | Second pathStat duration |
| --- | ---: | ---: | ---: | ---: |
| builtin-nat | 611.774ms | 54.298ms | 18.506ms | 14.148ms |
| stdlib-nat | 11693.622ms | 222.132ms | 260.654ms | 47.714ms |
| cubical-prelude | 7295.579ms | 116.794ms | 65.546ms | 49.017ms |

Representative `cubical-prelude` comparison against the current
`runno-proxy-current` baseline:

| Mode | First load | Second load | First pathStat duration | Second pathStat duration |
| --- | ---: | ---: | ---: | ---: |
| runno-proxy-current | 15597.248ms | 3963.452ms | 5399.811ms | 3595.534ms |
| browser-wasi-shim-memfs | 7295.579ms | 116.794ms | 65.546ms | 49.017ms |

### `runno-direct-fs`

- Runtime: `@runno/wasi`
- Filesystem: direct Runno in-memory drive inside the ALS worker.
- Status: blocked.
- Observed behavior:
  - ALS accepts the `agda` request and returns `CmdRes`.
  - The benchmark still times out waiting for Agda `ResponseEnd`.
  - The last traced filesystem operation is `pathStat("lib") -> 76`.
  - The direct worker ends up parked in a `poll-stdin` wait with no more input.
- Current blocker class: architecture-level ALS raw interaction completion in
  the direct-hosted runtime. Treat this as a blocker for the direct baseline,
  not the next optimization target.

## Planned Combinations

### `vscode-wasm-memfs`

- Intended runtime/filesystem: `@vscode/wasm-wasi` plus
  `createMemoryFileSystem()`.
- Reference: `references/vscode-als-wasm-loader`.
- Status: bring-up skeleton added, but still blocked before a successful
  benchmark.
- Current blocker shape:
  - reference source exists locally
  - direct reference imports can be tested under a minimal `vscode` shim
  - `wasm-wasi-core` desktop worker artifacts under `dist/desktop` are missing,
    so `createProcess(...)` cannot start the runtime yet
- Use `npm run probe:vscode-wasm` for the current source/artifact/import split.

### `browser-wasi-shim-memfs`

- Intended runtime/filesystem: `@agda-web/browser_wasi_shim` memory filesystem.
- Status: later-stage placeholder. It is lower priority than
  `vscode-wasm-memfs` because ALS raw LSP stdin/poll behavior is more likely to
  require custom runtime work.
