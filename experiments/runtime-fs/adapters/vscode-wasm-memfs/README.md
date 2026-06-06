# vscode-wasm-memfs Adapter Placeholder

This adapter is intentionally not implemented in the first experiment phase.

Reference implementation:

- `../../../../../references/vscode-als-wasm-loader/extension.ts` from this adapter directory
- `@vscode/wasm-wasi/v1`
- `@agda-web/wasm-wasi-core`
- `@agda-web/wasm-wasi-lsp`

The relevant design is `wasm.createMemoryFileSystem()` plus `wasm.createProcess(...)`, rather than the main app's `@runno/wasi` cross-worker drive proxy.

Before implementing this adapter, verify that the `vscode-wasm` submodules or packaged `@agda-web/wasm-wasi-core` artifacts are available locally.
