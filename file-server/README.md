# file-server

Tooling that prepares the static assets the browser app fetches at runtime:
the per-module `.agdai` cache under `static/agdai/` and the dependency
manifest (`static/agdai-manifest.json`) used to prefetch them in parallel.

This is a clearly-separated subdirectory within this repo, not a standalone
package. It may be split into its own repository later if there's real demand
for forking just this piece; see ROADMAP.md "Curated Multi-Library Support"
for the current plan to extend this to libraries beyond stdlib/cubical
(agda-categories, plfa, agda-unimath, 1lab) before assuming a split is needed.

## Scripts

### `libraries.mjs`

The shared spec for every library both scripts below operate on. Each entry
needs: `name`, `libKey` (a short tag stored in the manifest), `agdaiZipName`
(the prebuilt `.agdai` cache zip in `static/`), `sourceZipPattern` (regex to
find the source archive in `static/`), and `optionsPragma` (the `{-# OPTIONS #-}`
line needed to scope-check the library's `Everything.agda`). Adding a library
that follows the same shape as stdlib/cubical (one `.agda-lib` at the source
archive root, a prebuilt `.agdai` cache zip) should only require adding an
entry here — see ROADMAP.md before adding agda-categories/plfa/agda-unimath/1lab,
since their exact `.agda-lib` layout hasn't been confirmed yet.

### `extract-agdai.mjs`

Extracts each library's prebuilt `.agdai` cache zip (downloaded by
`npm run setup`) into `static/agdai/<name>/`, so individual `.agdai` files can
be served on demand. Runs automatically as part of `npm run setup` (see
`scripts/download-assets.sh`); only needs Node.js.

```sh
node file-server/extract-agdai.mjs
```

### `generate-manifest.mjs`

Generates `static/agdai-manifest.json`: a module dependency graph across all
configured libraries, used by the browser runtime (`src/lib/agda/prefetch.js`)
to fetch all `.agdai` files a source buffer needs in parallel, instead of one
at a time as ALS requests them during `Cmd_load`.

**This is a maintenance script, not part of the regular build.** Run it
manually and commit the resulting `static/agdai-manifest.json` whenever a
configured library's version or the Agda version changes, or when a library
is added to/removed from `libraries.mjs`.

Prerequisites:

- `npm run setup` has been run (provides the source archives and `.agdai`
  cache zips).
- `node file-server/extract-agdai.mjs` has been run (provides
  `static/agdai/`).
- A **native** `agda` binary on `PATH` (not the WASM build). It doesn't need
  to match the bundled `.agdai` cache's interface format version — if it
  doesn't, the script still produces a correct result, just slower, because
  Agda falls back to a full recompile from source for any module whose cached
  interface it can't reuse.

```sh
node file-server/generate-manifest.mjs
```

### `zip-utils.mjs`

Shared minimal ZIP extraction helper (no external dependency) used by both
scripts above.

## How the manifest is used at runtime

`generate-manifest.mjs` runs `agda --only-scope-checking --dependency-graph`
against a generated `Everything.agda` that imports every module in each
library, then parses the resulting Dot graph. The Dot output is
transitively-reduced (only direct edges), so the manifest stores direct
dependencies per module; `src/lib/agda/prefetch.js` computes the transitive
closure at runtime from the user's `import` statements before triggering
parallel fetches.
