# file-server

Tooling that prepares the static assets the browser app fetches at runtime:
ALS WASM binaries, library source archives, the per-module `.agdai` cache
under `static/agdai/`, and the dependency manifest (`static/agdai-manifest.json`)
used to prefetch `.agdai` files in parallel.

This is a clearly-separated subdirectory within this repo, not a standalone
package. It may be split into its own repository later if there's real demand
for forking just this piece; see [ROADMAP.md](../ROADMAP.md) "Curated
Multi-Library Support" for the current plan to extend this to libraries beyond stdlib/cubical/
agda-categories — plfa, agda-unimath, 1lab — before assuming a split is
needed.

## Configuring a deployment

### Use an existing library/ALS combination

Edit **`../deploy.config.mjs`** (repo root) — add or edit a `profiles[]`
entry referencing libraries/ALS versions already in the catalogs below by
`name`+`version`. See that file's comments for the schema. If you haven't
changed which libraries/ALS versions are selected, `npm run auto-configure`
already has every file this project ships by default, so
`npm run auto-configure && npm run setup && npm run build` is enough.

### Add a library/ALS version, or supply your own files

`libraries.mjs`/`als-catalog.mjs` are **pure metadata catalogs** — they
describe how to register and use a library/ALS version (its `.agda-lib`
name, include path, cache version, etc.), but never where to download it
from. There is no "fill in a URL" option. Every file referenced by a
catalog entry must be placed by hand into `file-server/library/` or
`file-server/als/`, whether it's a brand-new library you're adding, a
custom fork, or a prebuilt `.agdai` cache you built yourself.

`npm run auto-configure` is the one exception, and it's deliberately
narrow: it's a hardcoded script that fetches only the exact files this
project's own shipped defaults need (stdlib 2.3, cubical 0.9,
agda-categories 0.3.0, ALS 2.8.0). It doesn't read the catalogs or
`deploy.config.mjs` — adding your own library/ALS version gets you
nothing from it. See `scripts/auto-configure.sh`'s own header comment.

To add a library/ALS version:

1. Add an entry to `libraries.mjs` (`name`, `version`, `libKey`,
   `sourceZipName`, `archiveRootPrefix`, `includeSubpath`, `agdaLibFile`,
   `libraryName`, optionally `agdaiCacheVersion`/`agdaiZipName`, and
   `optionsPragma`) or `als-catalog.mjs` (`version`, `wasmFilename`,
   optionally `dataZipName`). See the comments at the top of each file for
   what every field means. There's no separate library/ALS compatibility
   table — each `deploy.config.mjs` profile *is* a validated
   (`alsVersion`, `libraries`) pairing, so there's nothing to
   cross-reference.
2. If the library `depend:`s on another configured library (e.g.
   agda-categories depends on `standard-library-2.3`), no extra step is
   needed — `generate-manifest.mjs` and the browser runtime both register
   every selected library together, so `depend:` resolves the same way in
   both places.
3. Reference the new entry from a `deploy.config.mjs` profile.
4. Place the file(s) the catalog entry's `sourceZipName`/`agdaiZipName`/
   `wasmFilename`/`dataZipName` point to into `file-server/library/` or
   `file-server/als/` by hand, then run `npm run setup` — it only ever
   reads whatever's already in `file-server/{library,als}/` and syncs it
   into `static/library/`/`static/als/`, so a manually-placed file ends up
   served exactly the same way as anything `auto-configure` fetches.
5. Regenerate the dependency manifest (below).

Both `file-server/library/` and `file-server/als/` are gitignored; nothing
in them is committed.

Check [ROADMAP.md](../ROADMAP.md) before adding plfa/agda-unimath/1lab — their exact
`.agda-lib` layout and type-theory compatibility with existing entries
hasn't been confirmed yet.

### Regenerate the dependency manifest

Run after `npm run setup` whenever a configured library's version, the
Agda version, or which libraries are selected changes. Requires a
**native** `agda` binary on `PATH` (not the WASM build):

```sh
node file-server/extract-agdai.mjs    # if not already run by npm run setup
node file-server/generate-manifest.mjs
```

Commit the resulting `static/agdai-manifest.json`. (If the native `agda`'s
interface format version doesn't match the bundled `.agdai` cache, this
still produces a correct result, just slower — see
`generate-manifest.mjs`'s own header comment.)

## Reference

### Catalogs

- **`libraries.mjs`** — every library *version* this project knows how to
  build a `.agdai` cache and dependency manifest for. Pure metadata — no
  download URLs; see "Add a library/ALS version, or supply your own
  files" above.
- **`als-catalog.mjs`** — every ALS/Agda WASM build this project knows how
  to fetch and run. Also pure metadata.
- **`resolve-deploy-config.mjs`** — resolves `deploy.config.mjs` against
  both catalogs above, validating every reference up front (a typo fails
  fast with a clear error). Exports `getSelectedLibraries()` and
  `getSelectedAlsVersions()` — deduplicated across all configured profiles
  — used by the scripts below instead of reading the catalogs or config
  directly.

### Scripts

- **`print-required-files.mjs`** — prints `filename<TAB>subdir` pairs
  (`subdir` is `library` or `als`) for every library/ALS file the
  currently-configured `deploy.config.mjs` needs. Consumed by
  `scripts/setup-assets.sh` to verify everything needed actually landed in
  `static/{library,als}/` before declaring success; not meant to be run
  standalone. Has no notion of where those files come from — that's
  `scripts/auto-configure.sh`'s job for this project's own defaults, or
  manual placement for anything else.
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
