# vscode-wasm-memfs Adapter Bring-up

Reference implementation:

- `../../../../../references/vscode-als-wasm-loader/extension.ts` from this adapter directory
- `@vscode/wasm-wasi/v1`
- `@agda-web/wasm-wasi-core`
- `@agda-web/wasm-wasi-lsp`

The relevant design is `wasm.createMemoryFileSystem()` plus `wasm.createProcess(...)`, rather than the main app's `@runno/wasi` cross-worker drive proxy.

Current harness status:

- A minimal benchmark adapter exists in `src/vscode-wasm-memfs-runtime.js`.
- It loads reference modules through direct file imports and installs a small
  `vscode` shim so the benchmark can distinguish import failures from runtime
  bring-up failures.
- It does not depend on the main app runtime and does not modify the reference
  repo.

Current workspace blockers:

- Reference source directories exist locally.
- The current blocker is not source absence; it is missing built worker
  artifacts under
  `references/vscode-als-wasm-loader/vscode-wasm/wasm-wasi-core/dist/desktop/`.
- Without `mainWorker.js` and `threadWorker.js`, `createProcess(...)` cannot
  start the desktop runtime inside the experiment harness.

Use:

```sh
npm run probe:vscode-wasm
npm run benchmark -- --runtime vscode-wasm-memfs --fixture builtin-nat
```

The probe reports source presence, artifact presence, and importability as
separate checks. The benchmark command is expected to fail until the worker
artifacts exist, but it should fail with a stage-specific blocker message.
