# deploy-assets

Tooling that prepares the static assets the browser app fetches at runtime:
ALS WASM binaries, library source archives, the per-module `.agdai` cache
under `static/agdai/`, and each library's own dependency manifest
(`static/agdai/<name>/agdai-manifest.json`) used to prefetch `.agdai`
files in parallel.

This is a clearly-separated subdirectory within this repo, not a standalone
package — and not a split-out-later candidate either: `src/lib/runtime/interface.ts`
imports `libraries.mjs`/`als-catalog.mjs` directly at build time, not just
during CI, so this stays in the same repo as the app it serves. See
[ROADMAP.md](../ROADMAP.md) "Curated Multi-Library Support" for the
current plan to extend this to libraries beyond stdlib/cubical/
agda-categories — plfa, agda-unimath, 1lab.

## Deploying this project

1. `git clone` this repo.
2. Place the library and ALS files you need, **raw** (no zips), into
   `deploy-assets/library/<name>/` and `deploy-assets/als/` — see "What to
   place" below. `npm run auto-configure` does this step for this
   project's own shipped defaults (stdlib 2.3, cubical 0.9,
   agda-categories 0.3.0, ALS 2.8.0) — it downloads the same archives a
   self-deployer would, and extracts them into the same raw layout, so
   there's no separate mechanism, just an automated version of the same
   manual step.
3. Edit **`../deploy.config.mjs`** (repo root) to select which
   libraries/ALS versions to bundle, by `name`+`version`, referencing
   entries already in `libraries.mjs`/`als-catalog.mjs` (see "Adding a
   library or ALS version" below if you need one that isn't there yet).
4. `npm run setup` — verifies everything `deploy.config.mjs` needs is
   present, then zips/copies it into `static/` for serving.
5. `npm run check`
6. `npm run build`

For this project's own shipped defaults, steps 2–6 collapse to:

```sh
npm run auto-configure && npm run setup && npm run check && npm run build
```

### What to place

```
deploy-assets/
  library/
    <name>/                          # e.g. stdlib/, cubical/, agda-categories/
      <agdaLibFile>                   # at whatever depth the library uses
      src/...                         # wherever includeSubpath points — raw .agda source
      _build/<agdaiCacheVersion>/agda/...   # optional: raw prebuilt .agdai files
      agdai-manifest.json             # optional: this library's own dependency graph (see below)
  als/
    <wasmFilename>                    # a single binary file
    agda-data/                        # raw extracted Agda builtin data (optional)
```

No zips anywhere in `deploy-assets/` — `npm run setup` is what zips a
library's source tree (and `agda-data/`) into the zips the browser fetches
at runtime, and copies a `_build/` tree as-is into `static/agdai/<name>/`
(those are served flat, one `.agdai` file per request, never as a zip).
Both `deploy-assets/library/` and `deploy-assets/als/` are gitignored; nothing
in them is committed.

`libraries.mjs`/`als-catalog.mjs` are **pure metadata catalogs** — they
describe how to register and use a library/ALS version (its `.agda-lib`
name, include path, cache version, the filenames `npm run setup` should
*produce*), but never where to download anything from. There is no
"fill in a URL" option anywhere in this project. `npm run auto-configure`
is the one exception, and it's deliberately narrow: a hardcoded script
that fetches only the exact files this project's own shipped defaults
need. It doesn't read the catalogs or `deploy.config.mjs` — adding your
own library/ALS version gets you nothing from it. See
`deploy-assets/auto-configure.mjs`'s own header comment.

### Adding a library or ALS version

1. Add an entry to `libraries.mjs` (`name`, `version`, `includeSubpath`,
   `agdaLibFile`, `libraryName`, optionally `agdaiCacheVersion`) or
   `als-catalog.mjs` (`version`, `wasmFilename`, optionally `dataZipName`).
   See the comments at the top of each file for what every field means.
   There's no separate library/ALS compatibility table — each
   `deploy.config.mjs` profile *is* a validated (`alsVersion`, `libraries`)
   pairing, so there's nothing to cross-reference.
2. If the library `depend:`s on another configured library (e.g.
   agda-categories depends on `standard-library-2.3`), no extra step is
   needed — `generate-dot.mjs` and the browser runtime both
   register every selected library together, so `depend:` resolves the
   same way in both places.
3. Reference the new entry from a `deploy.config.mjs` profile.
4. Place the library's raw source (or the ALS's wasm/`agda-data/`) under
   `deploy-assets/library/<name>/` or `deploy-assets/als/` by hand, then run
   `npm run setup`.
5. Regenerate the dependency graph (below) if you want prefetching for it.

Check [ROADMAP.md](../ROADMAP.md) before adding plfa/agda-unimath/1lab — their exact
`.agda-lib` layout and type-theory compatibility with existing entries
hasn't been confirmed yet.

### Regenerating the dependency graph

Each library has its own dependency graph
(`deploy-assets/library/<name>/agdai-manifest.json`, copied to
`static/agdai/<name>/agdai-manifest.json` by `npm run setup`) — never one
combined file. A session only ever loads the graphs for its active
profile's libraries, so adding a library later never touches an existing
one's manifest. These are never auto-fetched for libraries/ALS versions
you've added or changed — `npm run auto-configure` only ever supplies
this project's own shipped default graphs. Producing your own is two
steps, always scoped to **one library per run** — run both once per
library you want to (re)generate:

```sh
node deploy-assets/generate-dot.mjs --library <name> [--scope-check-pragma <pragma>]
```

Requires a **native** `agda` binary on `PATH` (not the WASM build).
`<name>` must be one of the currently-selected libraries
(`deploy.config.mjs`). Registers every *currently-selected* library
together in a shared library-file (so a `depend:` on another configured
library, e.g. agda-categories on standard-library, resolves), even though
only the requested library's synthetic `Everything.agda` gets generated
and checked. `--scope-check-pragma` supplies the `{-# OPTIONS #-}` line
(if any) that synthetic file needs to scope-check — there's no catalog
field for this (nothing else reads it), and it's not always the same as
the library's own `.agda-lib` `flags:` — confirmed empirically that
`.agda-lib` flags don't apply to the synthetic `Everything.agda`. The
known-correct value for each of this project's own libraries:

| library          | `--scope-check-pragma`                                  |
|------------------|-----------------------------------------------------------|
| `stdlib`         | `{-# OPTIONS --rewriting --guardedness --sized-types #-}` |
| `cubical`        | `{-# OPTIONS --cubical --guardedness #-}`                  |
| `agda-categories`| *(omit — empty)*                                           |

Then:

```sh
node deploy-assets/dot-to-manifest.mjs
```

This is pure parsing — no `agda` needed — and writes
`deploy-assets/library/<name>/agdai-manifest.json` for the library you
just processed (dependency edges may still name modules from other
libraries by name, which is fine: the browser loads every active-profile
library's manifest together). Run `npm run setup` afterward to copy it
into `static/`. (If the native `agda`'s interface format version doesn't
match a placed `_build/` cache, this still produces a correct result,
just slower — full recompile instead of a cache hit.)

To regenerate every selected library's graph, repeat both commands once
per library.

This project's own shipped graphs (for stdlib, cubical, and
agda-categories) are produced this same way by a maintainer and uploaded
to the `cache-2.8.0` GitHub Release alongside the other prebuilt assets,
where `npm run auto-configure` downloads them from — independently per
library, so a missing one only disables prefetching for that library.

## Reference

### Catalogs

- **`libraries.mjs`** — every library *version* this project knows how to
  build a `.agdai` cache and dependency graph for. Pure metadata.
- **`als-catalog.mjs`** — every ALS/Agda WASM build this project knows how
  to fetch and run. Also pure metadata.
- **`resolve-deploy-config.mjs`** — resolves `deploy.config.mjs` against
  both catalogs above, validating every reference up front (a typo fails
  fast with a clear error). Exports `getSelectedLibraries()` and
  `getSelectedAlsVersions()` — deduplicated across all configured profiles
  — used by the scripts below instead of reading the catalogs or config
  directly.

### Scripts

- **`print-required-files.mjs`** — checks `deploy-assets/{library,als}/` for
  everything the currently-configured `deploy.config.mjs` needs (files and
  directories), printing `MISSING: ...` lines and exiting non-zero if
  anything required is absent. Run automatically by `npm run setup` before
  it builds `static/`.
- **`build-static-assets.mjs`** — zips each selected library's raw source
  into `static/library/<sourceZipName>`, copies a placed `_build/` tree
  and `agdai-manifest.json` into `static/agdai/<name>/`, copies the ALS
  wasm, and zips `agda-data/` into `static/als/<dataZipName>`. Runs
  automatically as part of `npm run setup`.
- **`generate-dot.mjs`** / **`dot-to-manifest.mjs`** — the
  two-phase dependency-graph generator described above.
- **`auto-configure.mjs`** — fetches and extracts this project's own
  shipped default library/ALS files into the raw layout. Hardcoded, not
  catalog-driven — see its own header comment.
- **`zip-utils.mjs`** — shared minimal ZIP extraction/creation helpers (no
  external dependency) used by the scripts above.

## How the manifest is used at runtime

`generate-dot.mjs`'s native `agda --only-scope-checking
--dependency-graph` invocation produces a Dot graph from a generated
`Everything.agda` that imports every module in each library;
`dot-to-manifest.mjs` parses it into one `{ graph }` per library. The Dot
output is transitively-reduced (only direct edges), so each manifest
stores direct dependencies per module. At runtime,
`src/lib/agda/prefetch.js` loads every active-profile library's manifest,
merges them into one working graph (deriving which library owns each
module from which file it came from — there's no `libOf` field in the
files themselves), computes the transitive closure from the user's
`import` statements, and triggers parallel fetches.
