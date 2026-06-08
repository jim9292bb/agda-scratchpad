# browser-wasi-shim-memfs Adapter Placeholder

This adapter is intentionally deferred.

Reference implementation:

- `../../../../../references/agda-web-browser_wasi_shim/src/wasi.ts`
- `../../../../../references/agda-web-browser_wasi_shim/src/fs_mem.ts`

The relevant design is a pure JavaScript WASI implementation with memory
filesystem primitives. It is useful as a future comparison point, but it is not
the next adapter to implement because ALS raw LSP stdin/poll behavior is more
likely to need custom integration work than the `vscode-wasm-memfs` path.
