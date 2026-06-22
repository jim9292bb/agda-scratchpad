# file-server

Tooling that prepares the static assets the browser app fetches at runtime:
ALS WASM binaries, library source archives, the per-module `.agdai` cache
under `static/agdai/`, and the dependency manifest (`static/agdai-manifest.json`)
used to prefetch `.agdai` files in parallel.

This is a clearly-separated subdirectory within this repo, not a standalone
package. It may be split into its own repository later if there's real demand
for forking just this piece; see ROADMAP.md "Curated Multi-Library Support"
for the current plan to extend this to libraries beyond stdlib/cubical/
agda-categories — plfa, agda-unimath, 1lab — before assuming a split is
needed.

## Configuring a deployment

### Use an existing library/ALS combination

Edit **`../deploy.config.mjs`** (repo root) — add or edit a `profiles[]`
entry referencing libraries/ALS versions already in the catalogs below by
`name`+`version`. See that file's comments for the schema. Then run
`npm run setup && npm run build`.

### Add a library that isn't in the catalog yet

1. Add an entry to `libraries.mjs` — `name`, `version`, `libKey`,
   `sourceArchiveUrl`/`sourceZipName`, optionally `agdaiZipUrl`/`agdaiZipName`,
   and `optionsPragma`. See the comments at the top of that file for what
   each field means.
2. If the library `depend:`s on another configured library (e.g.
   agda-categories depends on `standard-library-2.3`), no extra step is
   needed — `generate-manifest.mjs` and the browser runtime both register
   every selected library together, so `depend:` resolves the same way in
   both places.
3. Reference the new entry from a `deploy.config.mjs` profile.
4. Run `npm run setup`, then regenerate the dependency manifest (below).

Check ROADMAP.md before adding plfa/agda-unimath/1lab — their exact
`.agda-lib` layout and type-theory compatibility with existing entries
hasn't been confirmed yet.

### Add or change an ALS/Agda version

Add an entry to `als-catalog.mjs` (`version`, `wasmUrl`/`wasmFilename`,
optionally `dataZipUrl`/`dataZipName`), then reference it from a
`deploy.config.mjs` profile's `alsVersion`. There's no separate
library/ALS compatibility table — each profile *is* a validated
(`alsVersion`, `libraries`) pairing, so there's nothing to cross-reference.

### Supply your own library/ALS files instead of downloading

`npm run setup` downloads everything `deploy.config.mjs`'s profiles need
into `file-server/library/` and `file-server/als/`, then syncs them into
`static/library/`/`static/als/` for serving — but it skips any file
that's already present. To use a private library, a custom fork, or a
prebuilt `.agdai` cache you built yourself instead of the catalog's
download, place the correctly-named file in `file-server/library/` or
`file-server/als/` by hand before running `npm run setup`. Both
directories are gitignored; nothing in them is committed. Everything
downstream (extraction, manifest generation, the runtime's fetch URLs)
reads from the same `static/{library,als}/` location regardless of how
the file got there.

### Regenerate the dependency manifest

Run after `npm run setup` whenever a configured library's version, the
Agda version, or which libraries are selected changes:

```sh
node file-server/extract-agdai.mjs    # if not already run by npm run setup
node file-server/generate-manifest.mjs
```

Commit the resulting `static/agdai-manifest.json`. Requires a **native**
`agda` binary on `PATH` (not the WASM build) — see `generate-manifest.mjs`'s
own header comment for what happens if its interface format version
doesn't match the bundled `.agdai` cache (still correct, just slower).

## Reference

### Catalogs

- **`libraries.mjs`** — every library *version* this project knows how to
  build a `.agdai` cache and dependency manifest for.
- **`als-catalog.mjs`** — every ALS/Agda WASM build this project knows how
  to fetch and run.
- **`resolve-deploy-config.mjs`** — resolves `deploy.config.mjs` against
  both catalogs above, validating every reference up front (a typo fails
  fast with a clear error). Exports `getSelectedLibraries()` and
  `getSelectedAlsVersions()` — deduplicated across all configured profiles
  — used by the scripts below instead of reading the catalogs or config
  directly.

### Scripts

- **`print-download-list.mjs`** — prints `URL<TAB>filename<TAB>subdir`
  tuples (`subdir` is `library` or `als`) for everything `npm run setup`
  needs to download. Consumed by `scripts/download-assets.sh`; not meant
  to be run standalone.
- **`extract-agdai.mjs`** — extracts each configured library's prebuilt
  `.agdai` cache zip (from `static/library/`) into `static/agdai/<name>/`,
  so individual `.agdai` files can be served on demand. Runs automatically
  as part of `npm run setup`.
- **`generate-manifest.mjs`** — generates `static/agdai-manifest.json`. A
  maintenance script, not part of the regular build — see "Regenerate the
  dependency manifest" above.
- **`zip-utils.mjs`** — shared minimal ZIP extraction helper (no external
  dependency) used by both scripts above.

## How the manifest is used at runtime

`generate-manifest.mjs` runs `agda --only-scope-checking --dependency-graph`
against a generated `Everything.agda` that imports every module in each
library, then parses the resulting Dot graph. The Dot output is
transitively-reduced (only direct edges), so the manifest stores direct
dependencies per module; `src/lib/agda/prefetch.js` computes the transitive
closure at runtime from the user's `import` statements before triggering
parallel fetches.
