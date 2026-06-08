# Runtime / Filesystem Experiments

This directory is an isolated benchmark harness for ALS WASM runtime and virtual filesystem experiments. It does not change the main Agda Scratchpad IDE runtime.

## Goal

Measure how much `Cmd_load` time comes from the WASM runtime and filesystem architecture, using the same ALS 2.8.0 WASM and the same stdlib/Cubical assets as the main app.

## Benchmark Protocol

Each adapter must:

1. Prepare Agda builtins, standard-library, Cubical, and Agda library config in a virtual filesystem.
2. Write the fixture source to `/source.agda`.
3. Start ALS and initialize it through LSP.
4. Run `Cmd_load` twice in the same ALS session.
5. Print JSON to stdout when both loads reach Agda `ResponseEnd`.

The baseline JSON shape is:

```json
{
  "runtime": "runno-proxy-current",
  "fixture": "cubical-prelude",
  "pathStatCache": false,
  "setupMs": 700,
  "firstLoadMs": 11000,
  "secondLoadMs": 3000,
  "firstLoad": {
    "totalFsCalls": 0,
    "methods": {},
    "methodDurationsMs": {},
    "pathStatCount": 0,
    "pathStatCacheHits": 0,
    "pathStatCacheMisses": 0,
    "agdaiRead": 0,
    "agdaiWrite": 0
  },
  "secondLoad": {
    "totalFsCalls": 0,
    "methods": {},
    "methodDurationsMs": {},
    "pathStatCount": 0,
    "pathStatCacheHits": 0,
    "pathStatCacheMisses": 0,
    "agdaiRead": 0,
    "agdaiWrite": 0
  }
}
```

## Commands

From this directory:

```sh
npm run benchmark -- --fixture cubical-prelude
npm run benchmark -- --runtime runno-proxy-current --fixture cubical-prelude
npm run benchmark -- --runtime runno-proxy-current --fixture cubical-prelude --pathstat-cache
npm run benchmark:runno-proxy -- --fixture cubical-prelude
npm run benchmark:runno-proxy:pathstat-cache -- --fixture cubical-prelude
npm run benchmark:runno-direct -- --fixture builtin-nat
npm run benchmark:fixtures
npm run probe:vscode-wasm
```

From the main `als-demo` directory:

```sh
npm run experiment:runtime-fs -- --fixture cubical-prelude
```

The first adapter, `runno-direct-fs`, is intentionally close to the main app's
ALS worker but removes the cross-worker drive proxy. It currently starts ALS,
initializes LSP, opens `/source.agda`, and accepts `Cmd_load`, but it does not
yet receive the Agda `ResponseEnd` request in Node's direct single-worker WASI
loop. A timeout at:

```text
[Debug] VFS: opening file:///source.agda
```

means the adapter reached ALS load processing but did not finish the Agda
interaction. Treat this as a harness/runtime finding, not as a main app failure.

## Fixtures

- `builtin-nat`: imports `Agda.Builtin.Nat`.
- `stdlib-nat`: imports `Data.Nat.Base`.
- `cubical-prelude`: imports `Cubical.Foundations.Prelude` with Cubical options.

## Adapters

- `runno-proxy-current`: implemented baseline. Reproduces the main app's ALS worker plus drive worker proxy architecture and is the primary runtime for completed first/second load measurements.
- `runno-direct-fs`: scaffolded. Uses `@runno/wasi` with the virtual filesystem directly in the ALS worker, without the main app's cross-worker drive proxy. It currently exposes a direct raw ALS scheduling blocker before `ResponseEnd`.
- `vscode-wasm-memfs`: planned. See `adapters/vscode-wasm-memfs/README.md`.
- `browser-wasi-shim-memfs`: planned later-stage comparison. See `adapters/browser-wasi-shim-memfs/README.md`.

## Dependency Probes

`npm run probe:vscode-wasm` checks whether the `vscode-wasm-memfs` adapter can
be implemented from currently available dependencies and local artifacts. If it
reports blockers, do not treat `vscode-wasm-memfs` as benchmarkable yet.

## PathStat Cache Experiment

`--pathstat-cache` enables an experiment-only cache in the `runno-proxy-current`
drive worker. It does not change the main app runtime. Compare cache off/on for
the same fixture and inspect `pathStatCacheHits`, `pathStatCacheMisses`,
`pathStatCount`, and `methodDurationsMs.pathStat`.

## Reading Results

Compare `firstLoadMs` against `secondLoadMs` to see whether `.agdai` cache is effective in the same session. Compare `pathStatCount` and `.agdai` read/write counters against the main app browser profiling to estimate the cost of the current cross-worker drive proxy.
