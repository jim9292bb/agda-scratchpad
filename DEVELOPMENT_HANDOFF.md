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
runtime-browser-wasi-shim
```

This branch is for investigating and gradually integrating a faster
`browser-wasi-shim-memfs` runtime backend into the main scratchpad app.

The current production/default runtime remains:

```text
runno-proxy-current
```

The `browser-wasi-shim-memfs` setting is only scaffolded in the main UI. It is
not yet wired as a working app runtime backend.

## Current Runtime Evidence

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

Runtime backend selection scaffold currently exists in:

```text
src/lib/controller.svelte.ts
src/routes/+page.svelte
```

Current scaffold:

- defines supported runtime backend ids;
- persists the selected runtime backend in local storage;
- shows the selected backend in Settings and Runtime summary;
- passes the selected backend into `AgdaController`.

Current limitation:

- `AgdaController` still always uses the existing Runno proxy worker path;
- selecting `browser-wasi-shim-memfs` does not change runtime behavior yet.

## Immediate Next Task

Implement a runtime backend abstraction for the main app before porting the
`browser_wasi_shim` worker.

Recommended first slice:

1. Add a small backend interface for the controller's runtime operations:
   source sync, startup/setup, LSP worker access, drive stats, and shutdown if
   needed.
2. Move the existing `runno-proxy-current` path behind that interface without
   changing behavior.
3. Keep `runno-proxy-current` as the default and only active backend.
4. Run:
   ```sh
   source /usr/share/nvm/init-nvm.sh && npm run check
   source /usr/share/nvm/init-nvm.sh && npm run build
   ```
5. Run a browser library regression if runtime startup code changes:
   ```sh
   source /usr/share/nvm/init-nvm.sh && npm run test:browser:libraries
   ```

Do this as a behavior-preserving refactor. Do not add the
`browser-wasi-shim-memfs` worker in the same commit unless the interface is
already stable and the change remains small.

## Next Runtime Integration Tasks

After the backend interface exists:

1. Add a main-app `browser-wasi-shim-memfs` worker based on
   `experiments/runtime-fs/src/browser-wasi-shim-runtime.js`.
2. Make the worker expose the same minimum operations required by the backend
   interface.
3. Replace the current drive-worker-only source sync with a backend-owned source
   write operation.
4. Keep performance stats shape compatible enough that the runtime panel does
   not break. Missing stats can be explicit zero/empty values at first.
5. Gate the new backend behind the existing Settings selector.
6. Verify at minimum:
   ```sh
   source /usr/share/nvm/init-nvm.sh && npm run check
   source /usr/share/nvm/init-nvm.sh && npm run build
   source /usr/share/nvm/init-nvm.sh && npm run test:browser:libraries
   ```
7. Manually test both backends before making `browser-wasi-shim-memfs` a serious
   default candidate.

## Later Work

Runtime and filesystem:

- compare main-app `browser-wasi-shim-memfs` behavior against experiment
  harness timings;
- decide whether `browser-wasi-shim-overlay-snapshot` has a real production
  advantage after the simpler memfs backend works;
- investigate persistent browser-side cache for extracted library files or
  `.agdai` files only after backend switching works;
- leave `runno-direct-fs` and `vscode-wasm-memfs` as documented blockers unless
  new evidence appears.

Scratchpad IDE features:

- move query results from raw Log into a structured Queries view;
- continue Diagnostics and Output Panel work;
- implement the Agda Unicode input method using
  `../references/agda-web-agda-input`;
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
