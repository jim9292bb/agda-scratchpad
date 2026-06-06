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
  "runtime": "runno-direct-fs",
  "fixture": "cubical-prelude",
  "setupMs": 700,
  "firstLoadMs": 11000,
  "secondLoadMs": 3000,
  "firstLoad": {
    "totalFsCalls": 0,
    "methods": {},
    "pathStatCount": 0,
    "agdaiRead": 0,
    "agdaiWrite": 0
  },
  "secondLoad": {
    "totalFsCalls": 0,
    "methods": {},
    "pathStatCount": 0,
    "agdaiRead": 0,
    "agdaiWrite": 0
  }
}
```

## Commands

From this directory:

```sh
npm run benchmark -- --fixture cubical-prelude
npm run benchmark:fixtures
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

- `runno-direct-fs`: scaffolded. Uses `@runno/wasi` with the virtual filesystem directly in the ALS worker, without the main app's cross-worker drive proxy. It currently exposes a direct raw ALS scheduling blocker before `ResponseEnd`.
- `vscode-wasm-memfs`: planned. See `adapters/vscode-wasm-memfs/README.md`.

Recommended next adapter:

- `runno-proxy-current`: reproduce the main app's ALS worker plus drive worker
  protocol in Node or browser automation, then compare its completed JSON
  result with the direct adapter once the direct `ResponseEnd` blocker is
  resolved.

## Reading Results

Compare `firstLoadMs` against `secondLoadMs` to see whether `.agdai` cache is effective in the same session. Compare `pathStatCount` and `.agdai` read/write counters against the main app browser profiling to estimate the cost of the current cross-worker drive proxy.
