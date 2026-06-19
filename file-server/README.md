# file-server

Tooling that prepares the static assets the browser app fetches at runtime:
ALS WASM binaries, library source archives, the per-module `.agdai` cache
under `static/agdai/`, and the dependency manifest (`static/agdai-manifest.json`)
used to prefetch `.agdai` files in parallel.

This is a clearly-separated subdirectory within this repo, not a standalone
package. It may be split into its own repository later if there's real demand
for forking just this piece; see ROADMAP.md "Curated Multi-Library Support"
for the current plan to extend this to libraries beyond stdlib/cubical
(agda-categories, plfa, agda-unimath, 1lab) before assuming a split is needed.

## Configuring a deployment

**`../deploy.config.mjs`** (repo root) is the single file a self-deployer
edits to choose which ALS/Agda versions and library combinations their
deployment bundles. See that file's comments for the schema. Everything in
this directory reads from it (via `resolve-deploy-config.mjs`) rather than
hardcoding a specific combination — the default config reproduces this
project's own deployment unchanged.

## Catalogs

### `libraries.mjs`

Catalog of every library *version* this project knows how to build a
`.agdai` cache and dependency manifest for. `deploy.config.mjs`'s
`librarySets` reference entries here by `name`+`version`. Each entry needs:
`name`, `version`, `libKey` (short tag stored in the manifest),
`sourceArchiveUrl`/`sourceZipName` (where to download the source from and
what to call it locally), `agdaiZipUrl`/`agdaiZipName` (optional — a prebuilt
`.agdai` cache; without one the library still works, just type-checks from
source every load), and `optionsPragma` (the `{-# OPTIONS #-}` line needed
to scope-check the library's generated `Everything.agda`).

Adding a library/version that follows the same shape as stdlib/cubical (one
`.agda-lib` at the source archive root) should only require a new catalog
entry plus a reference to it from `deploy.config.mjs` — see ROADMAP.md before
adding agda-categories/plfa/agda-unimath/1lab, since their exact `.agda-lib`
layout and type-theory compatibility with existing entries hasn't been
confirmed yet.

### `als-catalog.mjs`

Catalog of ALS/Agda WASM builds this project knows how to fetch and run.
`deploy.config.mjs`'s `alsVersions` references entries here by version.
Library/ALS compatibility is *not* declared here — it's declared the other
way around, on each `librarySet`'s `compatibleAlsVersions` in
`deploy.config.mjs`, which is the one place deployers configure it.

### `resolve-deploy-config.mjs`

Resolves `deploy.config.mjs` against both catalogs above, validating every
reference up front (a typo fails fast with a clear error). Exports
`getSelectedLibraries()` and `getSelectedAlsVersions()`, used by the scripts
below instead of reading the catalogs or config directly.

## Scripts

### `print-download-list.mjs`

Prints `URL<TAB>filename` pairs for everything `npm run setup` needs to
download for the *currently configured* ALS versions and libraries.
Consumed by `scripts/download-assets.sh`; not meant to be run standalone.

### `extract-agdai.mjs`

Extracts each configured library's prebuilt `.agdai` cache zip (downloaded
by `npm run setup`) into `static/agdai/<name>/`, so individual `.agdai`
files can be served on demand. Runs automatically as part of `npm run setup`
(see `scripts/download-assets.sh`); only needs Node.js.

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
configured library's version or the Agda version changes, or when
`deploy.config.mjs` changes which libraries are selected.

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
