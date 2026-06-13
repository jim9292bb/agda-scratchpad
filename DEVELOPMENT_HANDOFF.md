# Development Handoff

This file is the first document to read when opening a new Codex conversation
for this repository.

## Current Project Goal

The project is a browser-hosted, single-file Agda scratchpad IDE for
demonstration, learning, and practice.

The product target is close to JSCoq scratchpad:

- one editable source buffer backed by `/source.agda`;
- fast browser startup for small examples and exercises;
- reliable Agda/ALS loading, goals, context, messages, and shortcuts;
- preloaded standard-library and Cubical Agda support;
- no multi-file project workflow.

Do not turn this into a full project IDE. Avoid file explorers, multi-file
editing, package manager UI, project configuration UI, or VSCode parity work
unless the user explicitly changes the product goal.

Primary scope documents:

- `PROJECT_GOAL.md`
- `ROADMAP.md`
- `AGENTS.md`
- `CODEX_WORKFLOWS.md`

## Current Branch And Direction

Current active branch:

```text
agda-scratchpad
```

The `browser-wasi-shim-memfs` runtime backend is fully integrated as the
default. The `RuntimeBackend` interface lives in `src/lib/runtime/interface.ts`
and is implemented by `BrowserWasiShimRuntimeBackend` in
`src/lib/runtime/browser-wasi-shim.ts`. The Runno proxy path has been removed.

## Runtime Evidence

The runtime/filesystem benchmark harness lives in:

```text
experiments/runtime-fs/
```

The current comparison conclusion is in:

```text
experiments/runtime-fs/results/CONCLUSION.md
```

Measured runtime/filesystem combinations:

- `runno-proxy-current`: matches the current main app architecture and remains
  the behavioral baseline.
- `browser-wasi-shim-memfs`: completes first and second `Cmd_load` for
  `builtin-nat`, `stdlib-nat`, and `cubical-prelude`; much faster than
  `runno-proxy-current` in the benchmark harness.
- `browser-wasi-shim-overlay-snapshot`: also completes the same fixtures; wall
  time is roughly on par with `browser-wasi-shim-memfs`.
- `runno-direct-fs`: blocked at the raw ALS `ResponseEnd` completion path.
- `vscode-wasm-memfs`: not currently benchmarkable because required built
  artifacts are missing.

Representative Cubical Prelude results:

| Runtime | First load | Second load |
| --- | ---: | ---: |
| `runno-proxy-current` | 13595.696ms | 4057.193ms |
| `browser-wasi-shim-memfs` | 7292.786ms | 97.148ms |
| `browser-wasi-shim-overlay-snapshot` | 7461.118ms | 97.545ms |

Interpretation:

- `browser-wasi-shim-memfs` is the best next migration candidate.
- The benchmark result does not prove the main app can switch runtimes without
  integration work.
- The main integration risk is not Agda command semantics; it is replacing the
  current ALS worker plus drive worker source-sync path with a backend interface
  that supports `/source.agda`, library setup, LSP transport, and performance
  reporting.

## Main App State

Runtime backend interface:

```text
src/lib/runtime/interface.ts    — RuntimeBackend interface
src/lib/runtime/browser-wasi-shim.ts — BrowserWasiShimRuntimeBackend implementation
src/lib/controller.svelte.ts    — uses RuntimeBackend; Runno path removed
```

The Settings panel exposes a runtime backend selector persisted in local
storage. Currently only `browser-wasi-shim-memfs` is implemented.

## Next Tasks

Runtime and filesystem:

- browser-test library loading to verify both first and second load timings
  match experiment harness benchmarks;
- decide whether `browser-wasi-shim-overlay-snapshot` is worth implementing
  after verifying main-app `browser-wasi-shim-memfs` behavior;
- investigate persistent browser-side cache for extracted library files or
  `.agdai` files only after the above is verified;
- leave `runno-direct-fs` and `vscode-wasm-memfs` as documented blockers unless
  new evidence appears.

Scratchpad features (see `ROADMAP.md` for full list):

- move query results from raw Log into a structured Queries view;
- continue Diagnostics and Output Panel work;
- add Unicode input support inside the command input prompt;
- add a `C-x C-=` lookup command and browser regression tests for the Unicode input method;
- add normalization/prefix variants when the command UI is ready;
- add constraints/metas only where they help single-file learning workflows.

## Verification Expectations

For documentation-only changes:

```sh
git diff --check
```

For Svelte, TypeScript, worker, runtime, or import changes:

```sh
source /usr/share/nvm/init-nvm.sh && npm run check
source /usr/share/nvm/init-nvm.sh && npm run build
```

For runtime startup, library loading, editor, shortcut, goal, settings, or
messages behavior:

```sh
source /usr/share/nvm/init-nvm.sh && npm run test:browser:libraries
```

Use more specific `test:browser:*` scripts when changing the matching feature.

## Development Rules For New Conversations

- Read this file first, then `AGENTS.md`.
- Do not push unless explicitly requested.
- Commit only when requested.
- Keep changes scoped to the current phase.
- Preserve the single-file scratchpad scope.
- Treat benchmark experiments as evidence, not automatic production decisions.
- Do not edit files under `../references/` unless explicitly requested.
