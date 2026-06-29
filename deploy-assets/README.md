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
    <folderName>/                    # see notes below
      <agdaLibFile>                  # at whatever depth the library uses
      src/...                        # raw .agda source
      _build/<numeric agda version>/agda/...   # optional, see notes below
      agdai-manifest.json            # optional, see notes below
  als/
    <version>/                       # see notes below
      <wasmFilename>                 # a single binary file
      agda-data/                     # required, see notes below
        Agda/Builtin/*.agda
        agda-builtins.agda-lib
        _build/<numeric agda version>/agda/Agda/Builtin/*.agdai
```

No zips anywhere in `deploy-assets/` — `npm run setup` is what zips a
library's source tree (and `agda-data/`) into the zips the browser fetches
at runtime, and copies a `_build/` tree as-is into `static/agdai/<folderName>/`
(those are served flat, one `.agdai` file per request, never as a zip).
Both `deploy-assets/library/` and `deploy-assets/als/` are gitignored;
nothing in them is committed.

**`deploy-assets/library/<folderName>/`** — `folderName` is whatever you
set it to in `deploy.config.json` — e.g. `stdlib-2.3/`, `cubical-0.9/`,
`agda-categories-0.3.0/`. Naming it `<name>-<version>` is just a
convention, not a requirement — it can be anything; including a version
string lets two versions of the same library be placed side by side (see
ROADMAP.md "Curated Multi-Library Support").

**`deploy-assets/library/<folderName>/_build/<numeric agda version>/agda/...`**
— optional raw prebuilt `.agdai` files. The subdirectory name must
exactly match the numeric Agda version of whatever ALS build will run
against it (parsed live from that build's own `--version` output, not
declared anywhere). To produce this yourself: `cd` into this library's
own root (where its `.agda-lib` lives) and run native
`agda --build-library` — writes the `_build/` tree here directly, no
separate collection step. If it `depend:`s on another library (e.g.
agda-categories on standard-library), register that other library first
via a library-file: a plain text file with one line per
*currently-selected* library (`deploy.config.json`), each the absolute
path to `deploy-assets/library/<folderName>/<agdaLibFile>` (look up
`folderName`/`agdaLibFile` in `deploy.config.json`), passed to
`--build-library` as `--library-file=<path to that file>`; confirmed
empirically that a library with no `depend:` (e.g. cubical) needs no
`--library-file=` at all.

**`deploy-assets/library/<folderName>/agdai-manifest.json`** — optional,
this library's own dependency graph; see "Regenerating the dependency
graph" below.

**`deploy-assets/als/<version>/`** — unlike a library's `folderName` (any
name you like), this one must be byte-for-byte identical to that
version's `alsVersion` in `deploy.config.json` — it's used directly as a
lookup path (`deploy-assets/build-static-assets.mjs`,
`print-required-files.mjs`), not just a label. A mismatch (e.g. `"2.8"`
here vs `"2.8.0"` in `deploy.config.json`) means `npm run setup` reports
the wasm/`agda-data` as `MISSING` even though you placed them. `npm run
setup` also actually runs the wasm with `--version` to confirm the file
inside genuinely is that build, not just correctly named. Each version
gets its own directory rather than sharing one flat `als/` because
`agda-data/`'s primitive source files (below) aren't safely
interchangeable across versions: a newer compiler's primitive sources can
use syntax/BUILTINs an older compiler doesn't recognize.

**`deploy-assets/als/<version>/agda-data/`** — raw extracted Agda builtin
data, required for every ALS version (`npm run setup` refuses to proceed
without it) — there's no optional "run without prebuilt builtin data"
mode. Two halves: `Agda/Builtin/*.agda` is primitive source that ships
with the Agda compiler itself; `_build/<numeric agda version>/agda/...`
is a precompiled interface cache for those same primitives, safe to
share across versions even without the per-version directory above —
already namespaced by its own version subpath, same as a library's own
`_build/`, so a mismatched ALS version simply won't find it and
recompiles from the source half instead.

To get it: it's just `lib/prim/` from wherever your **native** `agda`
binary (matching the ALS version you're placing it for) keeps its own
bundled data — find it with `agda --print-agda-dir`, then it's
`<that path>/lib/prim/`. The `_build/<version>/` cache inside isn't
something you build with a separate command — confirmed empirically (by
comparing file timestamps): it's generated automatically, in place, the
first time that `agda` binary type-checks *anything* that transitively
uses Agda's builtins (which is effectively everything, including any of
this project's own libraries). If you've already run native `agda` once
for any reason (e.g. to produce a library's own prebuilt `.agdai` cache,
above), the prim cache is already sitting there — just copy the whole
`lib/prim/` directory over. If not, run `agda` against any trivial file
first (even one that just declares `module M where`), then copy.

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
   Regenerating the dependency graph (below) needs no extra step either —
   `generate-manifest.mjs` extracts each module's own `import` targets by
   name, whichever library they happen to belong to.
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
gone) — `src/lib/agda/prefetch.js` asks the running ALS itself, live, for
its numeric Agda version (`src/lib/worker/als-wasi-shim.ts`'s
`getNumericAgdaVersion()`), and uses that to build the
`_build/<version>/` prefetch path. (There's no `--numeric-version` flag
on `als` itself — confirmed empirically, it's not one of the few options
`als --help` lists, and isn't forwarded to the underlying Agda library
either; `getNumericAgdaVersion()` parses the version number straight out
of `als`'s own `--version` output instead, which *is* a real flag.) This
means a placed `_build/` cache only ever gets used if its subdirectory
name matches the *actual* running Agda version exactly — no possibility
of a hand-typed version guess drifting from reality. A mismatch (or no
`_build/` at all) just means a slower from-source recompile instead of a
cache hit, never an error.

### Regenerating the dependency graph

Each library has its own dependency graph
(`deploy-assets/library/<folderName>/agdai-manifest.json`, copied to
`static/agdai/<folderName>/agdai-manifest.json` by `npm run setup`) — never one
combined file. A session only ever loads the graphs for its active
profile's libraries, so adding a library later never touches an existing
one's manifest. These are never auto-fetched for libraries/ALS versions
you've added or changed — `npm run auto-configure` only ever supplies
this project's own shipped default graphs.

```sh
node deploy-assets/generate-manifest.mjs --library <folderName>
```

That's the whole process — no `Everything.agda` to hand-write, no shared
library-file, no native `--dependency-graph` run. For every file under
the library's own `.agda-lib` `include:` (any extension `agda` itself
recognizes — `.agda` and every literate variant), this spawns
`agda --interaction-json` and asks it for `Cmd_tokenHighlighting`: a
real Agda interaction command that returns purely lexical token
highlighting for that one file *without* loading, resolving, or
type-checking any of its imports (confirmed: it works even when an
imported module doesn't exist). Every highlighted range that isn't a
`keyword` — comments (including nested ones), literate prose/code-fence
markup, symbols, holes, pragma bodies, string/number literals — gets
replaced with a single space; matching `\bimport\b\s*(\S+)\s` against
what's left correctly extracts that file's own direct import targets,
immune to every edge case found while building this (multi-line
`import`, a comment sitting between `import` and the module name with
zero surrounding whitespace, semicolon-glued declarations, literate
prose that happens to contain text shaped like an import statement).
Requires a **native** `agda` binary on `PATH` (not the WASM build) —
same prerequisite as before, just no other setup. Runs at
`os.cpus().length`-way parallelism; regenerating all of stdlib (1153
files) takes about 10 seconds.

There's no `--no-options`/option-conflict problem to work around either
(unlike the old `Everything.agda` approach, which had to split
`agda-categories` across multiple files because no single
`{-# OPTIONS #-}` line satisfies every one of its modules) — each file
is scanned on its own, never combined into one synthetic entry point.

This is strictly more complete than the old `--dependency-graph`-based
graph, not just simpler: confirmed by reproducing this project's
previously-shipped manifests exactly — applying standard transitive
reduction to the new tool's output reproduces the old file edge-for-edge
for all three of this project's libraries. The old approach was
silently dropping real direct edges, because `agda --dependency-graph`'s
Dot backend applies a transitive reduction (for graph-visualization
purposes) that this project's old pipeline took as the manifest's
source of truth. `prefetch.js`'s `collectDeps` only does a transitive-
closure walk, so the extra edges this script keeps don't change
prefetch behavior (closure is invariant under transitive reduction) —
they just make each module's own edge list accurate.

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
  `generate-library-info.mjs` and `generate-manifest.mjs`.

### Scripts

- **`print-required-files.mjs`** — checks `deploy-assets/{library,als}/` for
  everything the currently-configured `deploy.config.json` needs (files and
  directories), printing `MISSING: ...` lines and exiting non-zero if
  anything required is absent. Also actually runs each placed `als` wasm
  with `--version` (via `run-als-version.mjs`) to confirm it reports
  itself as the `alsVersion` it's configured under — printing
  `MISMATCH: ...` if not, since the directory name alone is just a string
  you typed and doesn't guarantee the wasm file inside is actually that
  build. Run automatically by `npm run setup` before it builds `static/`.
- **`run-als-version.mjs`** — runs a given `als` wasm path with `--version`
  via Node's built-in WASI and prints its stdout verbatim. Always invoked
  as a child process (by `print-required-files.mjs`), never imported —
  Node's WASI implementation writes directly to the real stdout file
  descriptor, bypassing `process.stdout.write`, so only a parent process
  piping this one's actual stdout can capture it.
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
- **`generate-manifest.mjs`** — generates a library's dependency-graph
  manifest directly from its own placed source tree, via
  `agda --interaction-json`'s `Cmd_tokenHighlighting` — see "Regenerating
  the dependency graph" above.
- **`auto-configure.mjs`** — fetches and extracts this project's own
  shipped default library/ALS files into the raw layout. Hardcoded, not
  catalog-driven — see its own header comment.
- **`zip-utils.mjs`** — shared minimal ZIP extraction/creation helpers (no
  external dependency) used by the scripts above.

## How the manifest is used at runtime

`generate-manifest.mjs` (see "Regenerating the dependency graph" above)
asks `agda --interaction-json` for each of a library's own files' direct
`import` targets and writes one `{ graph }` per library, keyed by
module name, each value the list of modules it directly imports — the
full direct-edge graph, not transitively reduced. At runtime,
`src/lib/agda/prefetch.js` loads every active-profile library's manifest,
merges them into one working graph (deriving which library owns each
module from which file it came from — there's no `libOf` field in the
files themselves), computes the transitive closure from the user's
`import` statements, and triggers parallel fetches.
