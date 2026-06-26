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
   `deploy-assets/library/<name>-<version>/` and `deploy-assets/als/` —
   see "What to place" below. `npm run auto-configure` does this step for this
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
    <name>-<version>/                # e.g. stdlib-2.3/, cubical-0.9/, agda-categories-0.3.0/ —
                                      #   includes the version so two versions of the same
                                      #   library can be placed side by side (see ROADMAP.md
                                      #   "Curated Multi-Library Support")
      <agdaLibFile>                   # at whatever depth the library uses
      src/...                         # wherever includeSubpath points — raw .agda source
      _build/<agdaiCacheVersion>/agda/...   # optional: raw prebuilt .agdai files
      agdai-manifest.json             # optional: this library's own dependency graph (see below)
      everything/                     # optional: only while regenerating the dependency graph —
        *.agda                        #   your own Everything.agda-style file(s), see below
      dots/                           # optional: only while regenerating the dependency graph —
        *.dot                         #   agda's output for each file in everything/, see below
  als/
    <version>/                        # e.g. 2.8.0/ — one directory per ALS version
      <wasmFilename>                   # a single binary file
      agda-data/                       # raw extracted Agda builtin data (required)
```

Each ALS version gets its own directory rather than sharing one flat
`als/` — `agda-data/` (the `Agda.Builtin.*` primitive source files that
ship with a given Agda compiler build) isn't safely interchangeable
across versions: a newer compiler's primitive sources can use
syntax/BUILTINs an older compiler doesn't recognize. `agda-data/` is
required for every ALS version (`npm run setup` refuses to proceed
without it) — there's no optional "run without prebuilt builtin data"
mode. See `deploy-assets/als-catalog.mjs`'s header comment.

No zips anywhere in `deploy-assets/` — `npm run setup` is what zips a
library's source tree (and `agda-data/`) into the zips the browser fetches
at runtime, and copies a `_build/` tree as-is into `static/agdai/<name>/`
(those are served flat, one `.agdai` file per request, never as a zip).
`everything/` and `dots/` are excluded from the source zip entirely —
they're working files for regenerating the dependency graph, not
something the browser ever needs. Both `deploy-assets/library/` and
`deploy-assets/als/` are gitignored; nothing in them is committed.

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
   agda-categories depends on `standard-library-2.3`), the browser
   runtime registers every selected library together automatically, so
   `depend:` resolves at runtime with no extra step. Regenerating the
   dependency graph (below) is the one place this isn't automatic — you
   register the dependency yourself when you write the shared
   library-file.
3. Reference the new entry from a `deploy.config.mjs` profile.
4. Place the library's raw source (or the ALS's wasm/`agda-data/`) under
   `deploy-assets/library/<name>-<version>/` or `deploy-assets/als/` by
   hand, then run `npm run setup`.
5. Regenerate the dependency graph (below) if you want prefetching for it.

Check [ROADMAP.md](../ROADMAP.md) before adding plfa/agda-unimath/1lab — their exact
`.agda-lib` layout and type-theory compatibility with existing entries
hasn't been confirmed yet.

### Regenerating the dependency graph

Each library has its own dependency graph
(`deploy-assets/library/<name>-<version>/agdai-manifest.json`, copied to
`static/agdai/<name>/agdai-manifest.json` by `npm run setup`) — never one
combined file. A session only ever loads the graphs for its active
profile's libraries, so adding a library later never touches an existing
one's manifest. These are never auto-fetched for libraries/ALS versions
you've added or changed — `npm run auto-configure` only ever supplies
this project's own shipped default graphs.

This project does not generate `Everything.agda` or invoke `agda` for
you — you do both yourself, so you see `agda`'s real output directly
(not a wrapper script's guess at whether something went wrong), and so
you can split a library's modules into more than one file if it needs
incompatible `{-# OPTIONS #-}` in different parts (confirmed: a single
combined import file can't always work — some libraries mix modules
needing mutually exclusive options, and no one `{-# OPTIONS #-}` line
covers both).

1. **Write one or more `Everything.agda`-style files** under
   `deploy-assets/library/<name>-<version>/everything/` — each one `import`s
   whichever modules you've grouped together, with whatever
   `{-# OPTIONS #-}` line (if any) that group needs at the top. One file
   covering every module is enough for libraries whose modules don't
   conflict on options — this project's own three libraries each only
   need one:

   | library          | `{-# OPTIONS #-}` for its one `everything/` file        |
   |------------------|-----------------------------------------------------------|
   | `stdlib`         | `{-# OPTIONS --rewriting --guardedness --sized-types #-}` |
   | `cubical`        | `{-# OPTIONS --cubical --guardedness #-}`                  |
   | `agda-categories`| *(none — not every file declares `--without-K`/`--safe`   |
   |                  | consistently, so giving the file either trips a            |
   |                  | `CoInfectiveImport` error)*                                 |

   This isn't always the same as the library's own `.agda-lib` `flags:`
   — confirmed empirically that `.agda-lib` flags don't apply to a
   hand-written `Everything.agda`.

2. **Write the shared library-file** agda needs to resolve `depend:`
   across libraries (e.g. agda-categories on standard-library) — one line
   per *currently-selected* library (`deploy.config.mjs`), each the
   absolute path to `deploy-assets/library/<name>-<version>/<agdaLibFile>`
   (look up `agdaLibFile` in `libraries.mjs`). Every selected library
   needs to be listed here even if you're only regenerating one of them.

3. **Run `agda` yourself**, once per file you wrote in step 1:

   ```sh
   agda --library-file=<your library-file from step 2> \
        -i <deploy-assets/library/<name>-<version>/ + includeSubpath from libraries.mjs> \
        -i deploy-assets/library/<name>-<version>/everything \
        --only-scope-checking \
        --dependency-graph=deploy-assets/library/<name>-<version>/dots/<whatever>.dot \
        deploy-assets/library/<name>-<version>/everything/<whatever>.agda
   ```

   The second `-i` is required — confirmed empirically that without it,
   `agda` rejects the entry file with `ModuleNameDoesntMatchFileName`
   (it needs to find your file via some `-i` search path, since
   `everything/` isn't part of the library's own registered include
   path). Run with your working directory at
   `deploy-assets/library/<name>-<version>/`.
   Requires a **native** `agda` binary on `PATH` (not the WASM build).
   Read its output: `agda` exits non-zero on warnings alone (e.g.
   deprecated modules) even when the `.dot` file it wrote is complete, so
   a non-zero exit by itself isn't proof of a real problem — but a real
   error (confirmed: e.g. a missing required option) means no `.dot` file
   gets written at all. Place the resulting `.dot` file under
   `deploy-assets/library/<name>-<version>/dots/`.

4. **Convert the `.dot` file(s) into the manifest:**

   ```sh
   node deploy-assets/dot-to-manifest.mjs --library <name>
   ```

   This is pure parsing — no `agda` needed (`<name>` here is the catalog's
   bare `name`, e.g. `stdlib`, not `<name>-<version>` — the script resolves
   the rest via `deploy.config.mjs`/`libraries.mjs`). It merges every
   `.dot` file under `deploy-assets/library/<name>-<version>/dots/`,
   checks that every module the library actually defines (scanned
   directly from its source tree, not from your `everything/` files, so
   it doesn't matter how you grouped them) got a label somewhere across
   them — erroring out by name if not, rather than silently recording a
   missing module as having no dependencies — and writes
   `deploy-assets/library/<name>-<version>/agdai-manifest.json` (dependency edges
   may still name modules from other libraries by name, which is fine:
   the browser loads every active-profile library's manifest together).
   This check only confirms a module got labeled, not that its specific
   edges are complete — there's no independent way to verify that short
   of reimplementing Agda's own import resolution, which is the other
   reason you watch `agda`'s real output yourself in step 3 instead of
   trusting an automated check alone.

Run `npm run setup` afterward to copy the manifest into `static/`. (If
the native `agda`'s interface format version doesn't match a placed
`_build/` cache, step 3 still produces a correct result, just slower —
full recompile instead of a cache hit.)

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
  and `agdai-manifest.json` into `static/agdai/<name>/`, copies each
  selected ALS version's wasm, and zips its `agda-data/` into
  `static/als/<version>/agda-data.zip`. Runs automatically as part of
  `npm run setup`.
- **`dot-to-manifest.mjs`** — converts a library's placed `.dot` file(s)
  (`deploy-assets/library/<name>-<version>/dots/`) into its dependency-graph
  manifest — see "Regenerating the dependency graph" above. This project
  doesn't generate `.dot` files itself; that's always a manual step.
- **`auto-configure.mjs`** — fetches and extracts this project's own
  shipped default library/ALS files into the raw layout. Hardcoded, not
  catalog-driven — see its own header comment.
- **`zip-utils.mjs`** — shared minimal ZIP extraction/creation helpers (no
  external dependency) used by the scripts above.

## How the manifest is used at runtime

A native `agda --only-scope-checking --dependency-graph` run (yours, by
hand — see "Regenerating the dependency graph" above) produces a Dot
graph from your own `Everything.agda`-style file(s); `dot-to-manifest.mjs`
merges and parses them into one `{ graph }` per library. The Dot output
is transitively-reduced (only direct edges), so each manifest stores
direct dependencies per module. At runtime,
`src/lib/agda/prefetch.js` loads every active-profile library's manifest,
merges them into one working graph (deriving which library owns each
module from which file it came from — there's no `libOf` field in the
files themselves), computes the transitive closure from the user's
`import` statements, and triggers parallel fetches.
