# vscode-wasm-memfs Adapter Placeholder

This adapter is intentionally not implemented until the dependency probe passes.

Reference implementation:

- `../../../../../references/vscode-als-wasm-loader/extension.ts` from this adapter directory
- `@vscode/wasm-wasi/v1`
- `@agda-web/wasm-wasi-core`
- `@agda-web/wasm-wasi-lsp`

The relevant design is `wasm.createMemoryFileSystem()` plus `wasm.createProcess(...)`, rather than the main app's `@runno/wasi` cross-worker drive proxy.

Before implementing this adapter, verify that the `vscode-wasm` submodules or packaged `@agda-web/wasm-wasi-core` artifacts are available locally.

Current workspace status:

- `references/vscode-als-wasm-loader/vscode-wasm/wasm-wasi-core` is missing in this workspace.
- `references/vscode-als-wasm-loader/vscode-wasm/wasm-wasi-lsp` is missing in this workspace.
- Run `npm run probe:vscode-wasm` from `experiments/runtime-fs` for current import and artifact status.
