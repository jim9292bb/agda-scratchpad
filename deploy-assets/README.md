# deploy-assets

Tooling that prepares the static assets the browser app fetches at runtime:
ALS WASM binaries, library source archives, the per-module `.agdai` cache
under `static/agdai/`, and each library's own dependency manifest
(`static/agdai/<name>/agdai-manifest.json`) used to prefetch `.agdai` files
in parallel.

This is a clearly-separated subdirectory within this repo, not a standalone
package — and not a split-out-later candidate either: `src/lib/runtime/interface.ts`
imports `deploy-assets/generated-libraries.mjs` (and `../deploy.config.json`)
directly at build time, not just during CI, so this stays in the same repo as
the app it serves. See [ROADMAP.md](../ROADMAP.md) "Curated Multi-Library
Support" for the current plan to extend this to libraries beyond
stdlib/cubical/agda-categories — plfa, agda-unimath, 1lab.

## Deploying this project

### Quick start (this project's own shipped defaults)

```sh
npm run auto-configure   # download stdlib/cubical/agda-categories + ALS 2.8.0,
                         # create deploy.local.json, fetch prebuilt .agdai + manifests
npm run setup            # zip/copy everything into static/
npm run check
npm run build
```

### Manual setup (custom libraries or ALS versions)

**1. Clone and install:**

```sh
git clone https://github.com/jim9292bb/agda-playground.git
cd als-demo
npm install
```

**2. Place library source and ALS files** — see "What to place" below.

**3. Create `deploy.local.json`** from the example, and fill in OS-absolute paths
to each library's `.agda-lib` file:

```sh
cp deploy.local.example.json deploy.local.json
# Edit deploy.local.json — set agdaLibPath for each library
```

**4. (Optional) Generate or import prebuilt `.agdai` cache:**

```sh
npm run import-agdai     # copy _build/ from each library's own source dir
                         # (fastest — if you've already type-checked with native agda)
```

```sh
npm run build-agdai      # build from scratch with native agda (slow, ~8 min for stdlib)
                         # requires generate-manifest first if agda < 2.8.0
```

```sh
npm run generate-manifest   # generate dependency-graph manifests (requires native agda)
```

Check what's ready at any time:

```sh
npm run check-agdai
```

**5. Build and verify:**

```sh
npm run setup            # verify everything is present, zip/copy into static/
npm run check
npm run build
```

### What to place

```
deploy-assets/
  library/
    <name>/                            # library name: value from its .agda-lib
      <name>.agda-lib                  # (or whatever filename the library uses)
      src/...                          # raw .agda source
  als/
    <version>/                         # must match alsVersion in deploy.config.json
      <wasmFilename>                   # a single binary file
      agda-data/                       # required — see notes below
        Agda/Builtin/*.agda
        agda-builtins.agda-lib
        _build/<numeric agda version>/agda/Agda/Builtin/*.agdai

deploy-assets/.cache/                  # gitignored, auto-managed — do not edit by hand
  index.json                           # maps agdaLibPath → cache ID
  <id>/
    _build/<numeric agda version>/agda/...   # prebuilt .agdai files
    agdai-manifest.json                      # dependency graph for prefetching
```

No zips anywhere in `deploy-assets/` — `npm run setup` is what zips library
source and `agda-data/` into the archives the browser fetches at runtime.
`deploy-assets/library/` and `deploy-assets/als/` are gitignored; nothing in
them is committed. `.cache/` is also gitignored and auto-managed by the npm
scripts — do not edit it by hand.

**`deploy-assets/library/<name>/`** — `name` is the `.agda-lib` `name:` value
(e.g. `standard-library`, `cubical`, `agda-categories`). This is also the
static-asset key: library zip served as `static/library/<name>.zip`, `.agdai`
files served under `static/agdai/<name>/`. If you need two versions of the
same library side by side, see ROADMAP.md "Curated Multi-Library Support".

**`deploy-assets/als/<version>/agda-data/`** — raw extracted Agda builtin
data, required for every ALS version. Two halves: `Agda/Builtin/*.agda` is
primitive source that ships with the Agda compiler itself; `_build/<numeric
agda version>/agda/...` is a precompiled interface cache for those same
primitives. To get it: find it with:

```sh
agda --print-agda-dir
# → <path>
# then: cp -r <path>/lib/prim/ deploy-assets/als/<version>/agda-data/
```

The `_build/` cache inside is generated automatically the first time native
`agda` type-checks anything that uses Agda's builtins. If you've already run
native `agda` once (e.g. to produce a library's `.agdai` cache), it's already
there — just copy the whole `lib/prim/` directory over.

**`deploy-assets/.cache/<id>/_build/`** — prebuilt `.agdai` files. Populate
with one of:

```sh
npm run import-agdai             # copy from library's own _build/ (fastest)
npm run build-agdai              # build from scratch (agda ≥ 2.8.0: --build-library;
                                 # agda < 2.8.0: session-based Cmd_load fallback)
npm run import-agdai -- --force  # overwrite existing cache
```

If your native `agda` predates 2.8.0 (no `--build-library`), run
`npm run generate-manifest` for that library first — `build-agdai` reads its
`agdai-manifest.json` to find the source vertices to `Cmd_load`. The
`--agda-bin` flag (for both scripts) defaults to `agda` on `PATH`; pass a
full path if you have multiple versions installed.

### `deploy.config.json` schema

`deploy.config.json` (repo root) is plain JSON — no comment syntax, so the
full field docs live here. It is committed; it never contains OS-specific
paths (those live in the gitignored `deploy.local.json`).

Schema: a flat list of `profiles`. Each profile is a complete, ready-to-use
combination — one ALS/Agda version plus the library set that goes with it.
There is deliberately no separate "pick an ALS version" + "pick a library set"
pair of independent choices: every option in `profiles` is valid by
construction, so the UI only needs a single profile selector and can never
present an incompatible pairing.

- `id`, `label`: identify the profile in the UI / local storage.
- `alsVersion`, `wasmFilename`: which ALS build this profile uses. If the same
  `alsVersion` appears in more than one profile, every reference must agree on
  `wasmFilename`.
- `libraries`: a list of `{ name, label?, version? }`:
  - `name` (required): the `.agda-lib` `name:` value — used as the
    static-asset key (`static/library/<name>.zip`,
    `static/agdai/<name>/`), the VFS folder name inside the browser's virtual
    filesystem, and the identifier for looking up entries in `deploy.local.json`.
    Must be unique per profile; if the same `name` appears in multiple profiles,
    every reference must agree on `label`/`version`.
  - `label` (optional): UI display name (e.g. `"stdlib"`). Shown in the
    library selector. If absent, `name` is used.
  - `version` (optional): version string shown in the UI (e.g. `"2.3"`).
    Cosmetic only — nothing reads it to build a path or cache key.

### `deploy.local.json` schema

`deploy.local.json` (repo root, gitignored) maps library names to OS-specific
paths. Create it from the example:

```sh
cp deploy.local.example.json deploy.local.json
```

Schema: a list of `{ name, agdaLibPath, useAgdai? }`:
- `name`: must match a library `name` in `deploy.config.json`.
- `agdaLibPath`: absolute OS path to that library's `.agda-lib` file
  (e.g. `/home/user/agda-stdlib/standard-library.agda-lib`).
- `useAgdai` (optional, default `false`): whether to generate/serve the `.agdai`
  cache for this library. Set to `true` after running `npm run import-agdai` or
  `npm run build-agdai`.

`npm run auto-configure` creates this file automatically (with `useAgdai: true`)
when it doesn't already exist, pointing at the sources it downloads into
`deploy-assets/library/`.

### Adding a library or ALS version

1. Add a `{ name, label?, version? }` entry to a `deploy.config.json` profile's
   `libraries`. For a new ALS version, set that profile's `alsVersion` /
   `wasmFilename` directly. No separate catalog file to update.

2. Add a matching entry to `deploy.local.json`:

   ```json
   { "name": "my-library", "agdaLibPath": "/absolute/path/to/my-library.agda-lib" }
   ```

3. Place the library's raw source under `deploy-assets/library/<name>/` and
   the ALS wasm/`agda-data/` under `deploy-assets/als/<version>/`.

4. Optionally generate or import the `.agdai` cache and manifest:

   ```sh
   npm run import-agdai -- --library my-library
   npm run generate-manifest -- --library my-library
   ```

5. Run setup:

   ```sh
   npm run setup
   ```

Check ROADMAP.md before adding plfa/agda-unimath/1lab — their `.agda-lib`
layout and type-theory compatibility with existing entries hasn't been
confirmed yet.

### What `npm run setup` generates

`deploy-assets/generate-library-info.mjs` reads every library's real
`.agda-lib` file at its `agdaLibPath` and writes
`deploy-assets/generated-libraries.mjs`, mapping each `name` to the
`includeSubpath`, `libraryName`, and `agdaLibFilename` parsed straight out of
that file's `include:` / `name:` lines. `src/lib/runtime/interface.ts` imports
this generated file at build time (Vite inlines it into the compiled bundle —
no extra runtime fetch). Nothing hand-declares these fields anywhere in this
project, so they can never drift from what the real `.agda-lib` says.

This generated file is gitignored — `npm run setup` always regenerates it. It's
also regenerated as a `predev`/`precheck`/`prebuild` step (`package.json`), so
`npm run check`/`npm run build`/`npm run dev` never hard-fail just because
`deploy.local.json` hasn't been set up yet (a library without a configured path
is just skipped with a warning — the resulting empty/partial file is enough for
the build to type-check and compile, since the actual `GENERATED_LIBRARY_INFO`
content is only read once a real browser session runs the app).

Each ALS version's prebuilt `.agdai` cache version is no longer declared
anywhere either — `src/lib/agda/prefetch.js` asks the running ALS for its
numeric Agda version live, and uses that to build the `_build/<version>/`
prefetch path. A mismatch (or no `_build/` at all) just means a slower
from-source recompile instead of a cache hit, never an error.

### Regenerating the dependency graph

```sh
npm run generate-manifest                    # all useAgdai:true libraries
npm run generate-manifest -- --library <name>  # one specific library
```

No `Everything.agda` to hand-write, no native `--dependency-graph` run.
For every file under the library's own `.agda-lib` `include:`, this spawns
`agda --interaction-json` and asks for `Cmd_tokenHighlighting`: a real Agda
interaction command that returns purely lexical token highlighting for that one
file *without* loading or type-checking any of its imports. Every highlighted
range that isn't a `keyword` — comments (including nested ones), literate
prose/markup, symbols, holes, pragma bodies, string/number literals — gets
replaced with a single space; matching `\bimport\b\s*(\S+)\s` against what's
left correctly extracts that file's own direct import targets, immune to every
edge case found while building this (multi-line `import`, a comment between
`import` and the module name with zero surrounding whitespace,
semicolon-glued declarations, literate prose that happens to look like an
import statement).

Requires a **native** `agda` binary on `PATH` (not the WASM build). Runs at
`os.cpus().length`-way parallelism; regenerating all of stdlib (1153 files)
takes about 10 seconds.

This relies on `--interaction-json` (introduced in Agda 2.6.1) and parses
its `Cmd_tokenHighlighting` JSON response's `payload`/`atoms`/`range` fields.
Run the same native `agda` you intend to deploy with (matching this project's
`alsVersion`).

The output (`deploy-assets/.cache/<id>/agdai-manifest.json`) is strictly more
complete than the old `--dependency-graph`-based graph: confirmed by
reproducing this project's previously-shipped manifests exactly — applying
transitive reduction to the new output reproduces the old file edge-for-edge.
The old approach was silently dropping real direct edges because `agda
--dependency-graph`'s Dot backend applies a transitive reduction for
visualization. `prefetch.js`'s `collectDeps` only does a transitive-closure
walk, so the extra edges kept here don't change prefetch behavior (closure is
invariant under transitive reduction) — they just make each module's own edge
list accurate.

There's no option-conflict problem to work around either (unlike the old
`Everything.agda` approach, which had to split `agda-categories` across
multiple files because no single `{-# OPTIONS #-}` line satisfies every one of
its modules) — each file is scanned on its own, never combined into a synthetic
entry point.

## Reference

### Scripts

- **`resolve-deploy-config.mjs`** — reads `deploy.config.json` and
  `deploy.local.json`, auto-assigns stable random IDs for each `agdaLibPath`
  in `deploy-assets/.cache/index.json`. Exports `getLocalLibraries()` and
  `getSelectedAlsVersions()` — used by the scripts below.
- **`agda-lib-utils.mjs`** — shared parsers for raw `.agda-lib` content
  (`include:` / `name:`), no `agda` binary needed.
- **`print-required-files.mjs`** — checks that everything `deploy.config.json`
  needs is present (library `.agda-lib` files, ALS wasm/`agda-data/`), and
  actually runs each ALS wasm with `--version` to confirm it reports itself as
  the configured `alsVersion`. Exits non-zero if anything required is missing
  or mismatched. Libraries with `useAgdai: true` that are missing their cache
  get a non-fatal warning. Run automatically by `npm run setup` before it
  builds `static/`.
- **`run-als-version.mjs`** — runs a given ALS wasm with `--version` via
  Node's built-in WASI and prints its stdout verbatim. Always invoked as a
  child process (by `print-required-files.mjs`), never imported.
- **`generate-library-info.mjs`** — generates `deploy-assets/generated-libraries.mjs`
  from the real `.agda-lib` files — see "What `npm run setup` generates" above.
  Run automatically by `npm run setup`, and as a `predev`/`precheck`/`prebuild` step.
- **`build-static-assets.mjs`** — zips each library's raw source into
  `static/library/<name>.zip`, copies prebuilt `.agdai` and manifest from
  `.cache/<id>/` into `static/agdai/<name>/`, copies each ALS wasm, and zips
  its `agda-data/` into `static/als/<version>/agda-data.zip`. Runs
  automatically as part of `npm run setup`.
- **`generate-manifest.mjs`** — generates a library's dependency-graph manifest
  via `agda --interaction-json`'s `Cmd_tokenHighlighting` — see "Regenerating
  the dependency graph" above. Writes to `deploy-assets/.cache/<id>/agdai-manifest.json`.
- **`build-agdai-cache.mjs`** — builds a library's `.agdai` cache. For
  agda ≥ 2.8.0 uses `--build-library`; for older versions drives
  `agda --interaction-json` with one `Cmd_load` per source vertex. Temporarily
  copies the library into `.cache/<id>/build-temp/`, runs Agda there, moves
  `_build/` to `.cache/<id>/_build/`, deletes `build-temp/` in `finally`.
- **`import-agdai-cache.mjs`** — copies `_build/` from each library's own
  source directory (at `dirname(agdaLibPath)`) into `.cache/<id>/_build/`. Use
  this when you've already type-checked the library with native Agda.
  Supports `--library <name>` and `--force`.
- **`check-agdai-status.mjs`** — prints per-library status of the `.agdai`
  cache and manifest in `deploy-assets/.cache/`.
- **`auto-configure.mjs`** — fetches and extracts this project's own shipped
  default library/ALS files, creates `deploy.local.json`, and downloads
  prebuilt `.agdai` + manifests. Hardcoded, not catalog-driven — see its own
  header comment.
- **`zip-utils.mjs`** — shared minimal ZIP extraction/creation helpers (no
  external dependency).

## How the manifest is used at runtime

`generate-manifest.mjs` writes one `{ graph }` per library, keyed by module
name, each value the list of modules it directly imports — the full
direct-edge graph, not transitively reduced. At runtime,
`src/lib/agda/prefetch.js` loads every active-profile library's manifest,
merges them into one working graph, computes the transitive closure from the
user's `import` statements, and triggers parallel fetches.
