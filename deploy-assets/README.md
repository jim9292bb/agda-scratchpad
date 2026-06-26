# deploy-assets

Tooling that prepares the static assets the browser app fetches at runtime:
ALS WASM binaries, library source archives, the per-module `.agdai` cache
under `static/agdai/`, and each library's own dependency manifest
(`static/agdai/<folderName>/agdai-manifest.json`) used to prefetch
`.agdai` files in parallel.

This is a clearly-separated subdirectory within this repo, not a standalone
package — and not a split-out-later candidate either: `src/lib/runtime/interface.ts`
imports `deploy-assets/generated-libraries.mjs` (and `../deploy.config.json`)
directly at build time, not just during CI, so this stays in the same repo as
the app it serves. See [ROADMAP.md](../ROADMAP.md) "Curated Multi-Library
Support" for the current plan to extend this to libraries beyond
stdlib/cubical/agda-categories — plfa, agda-unimath, 1lab.

## Deploying this project

1. `git clone` this repo.
2. Place the library and ALS files you need, **raw** (no zips), into
   `deploy-assets/library/<folderName>/` and `deploy-assets/als/` —
   see "What to place" below. `npm run auto-configure` does this step for this
   project's own shipped defaults (stdlib 2.3, cubical 0.9,
   agda-categories 0.3.0, ALS 2.8.0) — it downloads the same archives a
   self-deployer would, and extracts them into the same raw layout, so
   there's no separate mechanism, just an automated version of the same
   manual step.
3. Edit **`../deploy.config.json`** (repo root) to select which
   libraries/ALS versions to bundle. There's no separate library catalog to
   cross-reference any more — each profile's `libraries` entry (`{
   folderName, agdaLibFile, name?, version? }`) is everything this
   project's tooling needs structurally (see "Adding a library or ALS
   version" below).
4. `npm run setup` — verifies everything `deploy.config.json` needs is
   present, generates `deploy-assets/generated-libraries.mjs` from the
   real `.agda-lib` files you placed, then zips/copies everything into
   `static/` for serving.
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
    <folderName>/                    # whatever you set as folderName in deploy.config.json —
                                      #   e.g. stdlib-2.3/, cubical-0.9/, agda-categories-0.3.0/.
                                      #   Naming it <name>-<version> is just a convention, not a
                                      #   requirement — it can be anything; including a version
                                      #   string lets two versions of the same library be placed
                                      #   side by side (see ROADMAP.md "Curated Multi-Library
                                      #   Support")
      <agdaLibFile>                   # at whatever depth the library uses
      src/...                         # wherever this file's own `include:` points — raw .agda source
      _build/<numeric agda version>/agda/...   # optional: raw prebuilt .agdai files — the
                                      #   subdirectory name must be the exact `agda
                                      #   --numeric-version` of whatever ALS build will run
                                      #   against it (detected live, not declared anywhere)
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
mode.

No zips anywhere in `deploy-assets/` — `npm run setup` is what zips a
library's source tree (and `agda-data/`) into the zips the browser fetches
at runtime, and copies a `_build/` tree as-is into `static/agdai/<folderName>/`
(those are served flat, one `.agdai` file per request, never as a zip).
`everything/` and `dots/` are excluded from the source zip entirely —
they're working files for regenerating the dependency graph, not
something the browser ever needs. Both `deploy-assets/library/` and
`deploy-assets/als/` are gitignored; nothing in them is committed.

Neither libraries nor ALS versions have a separate catalog file to
cross-reference any more — every profile's own fields in
`deploy.config.json` are already everything this project's tooling needs
structurally (see "`deploy.config.json` schema" below). There is no
"fill in a URL" option anywhere in this project — nothing here says where
to download anything from. `npm run auto-configure` is the one
exception, and it's deliberately narrow: a hardcoded script that fetches
only the exact files this project's own shipped defaults need. It
doesn't read `deploy.config.json` — adding your own library/ALS version
gets you nothing from it. See `deploy-assets/auto-configure.mjs`'s own
header comment.

### `deploy.config.json` schema

`deploy.config.json` (repo root) is plain JSON — no comment syntax, so the
full field docs live here instead of inline in the file itself. Default
reproduces this project's own deployment (ALS 2.8.0 with Standard
Library v2.3 + Cubical v0.9) unchanged.

Schema: a flat list of `profiles`. Each profile is a complete,
ready-to-use combination — one ALS/Agda version plus the library set that
goes with it. There is deliberately no separate "pick an ALS version" +
"pick a library set" pair of independent choices: every option in
`profiles` is valid by construction, so the UI only needs a single
profile selector (shown below the ALS status card when more than one
profile is configured) and can never present an incompatible pairing.

- `id`, `label`: identify the profile in the profile selector / local storage.
- `alsVersion`, `wasmFilename`: which ALS build this profile uses — this
  *is* the ALS catalog now, there's no separate file to cross-reference.
  If the same `alsVersion` is referenced from more than one profile,
  every reference must agree on `wasmFilename` (it's the same build, not
  a second one).
- `libraries`: a list of `{ folderName, agdaLibFile, name?, version? }` —
  this *is* the library catalog now, there's no separate file to
  cross-reference:
  - `folderName` (required): the directory name under
    `deploy-assets/library/` — also this library's identity for every
    internal purpose (cache keys, asset paths, VFS folder name). Must be
    unique; if the same `folderName` is referenced from more than one
    profile, every reference must agree on `agdaLibFile`/`name`/`version`
    (it's the same library, not a second one).
  - `agdaLibFile` (required): the `.agda-lib` filename at that library's
    root. `npm run setup` reads this file directly to learn its
    `include:`/`name:` (written to `deploy-assets/generated-libraries.mjs`
    — see "What `npm run setup` generates" below) — neither is
    hand-maintained here, so they can't drift from the real file.
  - `name`, `version` (optional): cosmetic only (e.g. shown in the UI) —
    nothing reads these to build a path or a cache key.

You are responsible for verifying that the libraries within one profile
are actually compatible with each other (same underlying type theory —
e.g. don't mix a Cubical library with a non-Cubical one — and no
conflicting transitive version requirements, e.g. two different stdlib
versions) and that they work with the chosen `alsVersion`. Nothing here
checks this automatically. See [ROADMAP.md](../ROADMAP.md) "Curated
Multi-Library Support" for context and known compatibility concerns
between candidate libraries (agda-categories, plfa, agda-unimath, 1lab).

### Adding a library or ALS version

1. Add a `{ folderName, agdaLibFile, name?, version? }` entry directly to
   a `deploy.config.json` profile's `libraries` — there's no separate
   library catalog file to add an entry to first. (For a new ALS version,
   set that profile's `alsVersion`/`wasmFilename` directly the same way —
   no separate ALS catalog file either.) `folderName` and `agdaLibFile`
   are required; `name`/`version` are optional and purely cosmetic (e.g.
   shown in the UI) — nothing reads them to build a path or a cache key.
2. If the library `depend:`s on another configured library (e.g.
   agda-categories depends on `standard-library-2.3`), the browser
   runtime registers every selected library together automatically, so
   `depend:` resolves at runtime with no extra step — `libraryName` (the
   exact `name:` declared inside the library's own `.agda-lib`, which is
   what `depend:` actually matches against) is read directly from that
   file by `npm run setup`, not hand-declared anywhere in this project.
   Regenerating the dependency graph (below) is the one place this isn't
   automatic — you register the dependency yourself when you write the
   shared library-file.
3. Place the library's raw source (or the ALS's wasm/`agda-data/`) under
   `deploy-assets/library/<folderName>/` or `deploy-assets/als/` by
   hand, then run `npm run setup` (this is also what generates
   `deploy-assets/generated-libraries.mjs` — see "What `npm run setup`
   generates" below).
4. Regenerate the dependency graph (below) if you want prefetching for it.

Check [ROADMAP.md](../ROADMAP.md) before adding plfa/agda-unimath/1lab — their exact
`.agda-lib` layout and type-theory compatibility with existing entries
hasn't been confirmed yet.

### What `npm run setup` generates

`deploy-assets/generate-library-info.mjs` reads every selected library's
real `deploy-assets/library/<folderName>/<agdaLibFile>` directly and
writes `deploy-assets/generated-libraries.mjs`, mapping each `folderName`
to the `includeSubpath`/`libraryName` parsed straight out of that file's
`include:`/`name:` lines. `src/lib/runtime/interface.ts` imports this
generated file at build time (Vite inlines it into the compiled bundle —
no extra runtime fetch). Nothing hand-declares `includeSubpath`/
`libraryName` anywhere in this project any more, so they can never drift
from what the real file says.

This generated file is gitignored (depends on `deploy-assets/library/`,
which is itself gitignored) — `npm run setup` always regenerates it. It's
also regenerated as a `predev`/`precheck`/`prebuild` step (see
`package.json`) so `npm run check`/`npm run build`/`npm run dev` never
hard-fail just because `deploy-assets/library/` hasn't been populated yet
(e.g. CI's fast `check-and-build` job deliberately skips
`auto-configure`/`setup` — a library whose `.agda-lib` isn't there yet is
just skipped with a warning in that case, not an error; the resulting
empty/partial file is enough for the build to type-check and compile,
since `src/routes/+layout.js` sets `ssr = false`, so the actual
`GENERATED_LIBRARY_INFO` content is only read once a real browser session
runs the app — by which point a real deployment has always run `npm run
setup` for real). `npm run setup` itself stays strict: it only ever
reaches `generate-library-info.mjs` after
`deploy-assets/print-required-files.mjs` has confirmed every required
`.agda-lib` genuinely exists, so nothing is silently skipped in that path.

Each ALS version's own prebuilt `.agdai` cache version is no longer
declared anywhere either (the old `agdaiCacheVersion` catalog field is
gone) — `src/lib/agda/prefetch.js` asks the running ALS itself, live, via
`agda --numeric-version` (`src/lib/worker/als-wasi-shim.ts`'s
`getNumericAgdaVersion()`), and uses that to build the `_build/<version>/`
prefetch path. This means a placed `_build/` cache only ever gets used if
its subdirectory name matches the *actual* running Agda version exactly —
no possibility of a hand-typed version guess drifting from reality. A
mismatch (or no `_build/` at all) just means a slower from-source
recompile instead of a cache hit, never an error.

### Regenerating the dependency graph

Each library has its own dependency graph
(`deploy-assets/library/<folderName>/agdai-manifest.json`, copied to
`static/agdai/<folderName>/agdai-manifest.json` by `npm run setup`) — never one
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
   `deploy-assets/library/<folderName>/everything/` — each one `import`s
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
   per *currently-selected* library (`deploy.config.json`), each the
   absolute path to `deploy-assets/library/<folderName>/<agdaLibFile>`
   (look up `folderName`/`agdaLibFile` in `deploy.config.json`). Every
   selected library needs to be listed here even if you're only
   regenerating one of them.

3. **Run `agda` yourself**, once per file you wrote in step 1:

   ```sh
   agda --library-file=<your library-file from step 2> \
        -i <deploy-assets/library/<folderName>/ + that library's own .agda-lib `include:`> \
        -i deploy-assets/library/<folderName>/everything \
        --only-scope-checking \
        --dependency-graph=deploy-assets/library/<folderName>/dots/<whatever>.dot \
        deploy-assets/library/<folderName>/everything/<whatever>.agda
   ```

   The second `-i` is required — confirmed empirically that without it,
   `agda` rejects the entry file with `ModuleNameDoesntMatchFileName`
   (it needs to find your file via some `-i` search path, since
   `everything/` isn't part of the library's own registered include
   path). Run with your working directory at
   `deploy-assets/library/<folderName>/`.
   Requires a **native** `agda` binary on `PATH` (not the WASM build).
   Read its output: `agda` exits non-zero on warnings alone (e.g.
   deprecated modules) even when the `.dot` file it wrote is complete, so
   a non-zero exit by itself isn't proof of a real problem — but a real
   error (confirmed: e.g. a missing required option) means no `.dot` file
   gets written at all. Place the resulting `.dot` file under
   `deploy-assets/library/<folderName>/dots/`.

4. **Convert the `.dot` file(s) into the manifest:**

   ```sh
   node deploy-assets/dot-to-manifest.mjs --library <folderName>
   ```

   This is pure parsing — no `agda` needed. It merges every
   `.dot` file under `deploy-assets/library/<folderName>/dots/`,
   checks that every module the library actually defines (scanned
   directly from its source tree, not from your `everything/` files, so
   it doesn't matter how you grouped them) got a label somewhere across
   them — erroring out by name if not, rather than silently recording a
   missing module as having no dependencies — and writes
   `deploy-assets/library/<folderName>/agdai-manifest.json` (dependency edges
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

Neither libraries nor ALS versions have a catalog file any more —
`deploy.config.json`'s own profile fields are already everything this
project's tooling needs structurally; see "`deploy.config.json` schema"
above.

- **`resolve-deploy-config.mjs`** — resolves `deploy.config.json`,
  validating every reference up front (a typo, or a folderName/alsVersion
  referenced with two conflicting specs across profiles, fails fast with
  a clear error). Exports `getSelectedLibraries()` and
  `getSelectedAlsVersions()` — deduplicated across all configured
  profiles — used by the scripts below instead of reading
  `deploy.config.json` directly.
- **`agda-lib-utils.mjs`** — tiny shared parsers for raw `.agda-lib` file
  content (`include:`/`name:`), no `agda` binary needed. Used by both
  `generate-library-info.mjs` and `dot-to-manifest.mjs`.

### Scripts

- **`print-required-files.mjs`** — checks `deploy-assets/{library,als}/` for
  everything the currently-configured `deploy.config.json` needs (files and
  directories), printing `MISSING: ...` lines and exiting non-zero if
  anything required is absent. Run automatically by `npm run setup` before
  it builds `static/`.
- **`generate-library-info.mjs`** — generates
  `deploy-assets/generated-libraries.mjs` from the real `.agda-lib` files
  in `deploy-assets/library/` — see "What `npm run setup` generates"
  above. Run automatically by `npm run setup`, and also as a
  `predev`/`precheck`/`prebuild` step (`package.json`).
- **`build-static-assets.mjs`** — zips each selected library's raw source
  into `static/library/<folderName>.zip`, copies a placed `_build/` tree
  and `agdai-manifest.json` into `static/agdai/<folderName>/`, copies each
  selected ALS version's wasm, and zips its `agda-data/` into
  `static/als/<version>/agda-data.zip`. Runs automatically as part of
  `npm run setup`.
- **`dot-to-manifest.mjs`** — converts a library's placed `.dot` file(s)
  (`deploy-assets/library/<folderName>/dots/`) into its dependency-graph
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
