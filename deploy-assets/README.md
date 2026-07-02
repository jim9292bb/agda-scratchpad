# deploy-assets

Tooling that prepares the static assets the browser app fetches at runtime:
ALS WASM binaries, library source archives, the per-module `.agdai` cache
under `static/agdai/`, and each library's own dependency manifest
(`static/agdai/<name>/agdai-manifest.json`) used to prefetch `.agdai` files
in parallel.

This is a clearly-separated subdirectory within this repo, not a standalone
package — and not a split-out-later candidate either:
[`src/lib/runtime/interface.ts`](../src/lib/runtime/interface.ts)
imports [`deploy-assets/generated-libraries.mjs`](generated-libraries.mjs) (and `../deploy.config.json`)
directly at build time, not just during CI, so this stays in the same repo as
the app it serves. See [ROADMAP.md](../ROADMAP.md) "Curated Multi-Library
Support" for the current plan to extend this to libraries beyond
stdlib/cubical/agda-categories — plfa, agda-unimath, 1lab.

## Deploying this project

### Quick start (this project's own shipped defaults)

```sh
git clone https://github.com/jim9292bb/agda-playground.git
cd agda-playground/als-demo
npm install
npm run auto-configure
npm run setup
npm run check
npm run build
```

`auto-configure` downloads stdlib/cubical/agda-categories + ALS 2.8.0, creates
`deploy.config.json`, and fetches prebuilt `.agdai` + manifests. `setup` then
zips/copies everything into `static/`.

### Manual setup (custom libraries or ALS versions)

**1. Clone and install:**

```sh
git clone https://github.com/jim9292bb/agda-playground.git
cd als-demo
npm install
```

**2. Place ALS files** — see ["What to place"](#what-to-place) below.

**3. Create `deploy.config.json`** from the example, and fill in OS-absolute paths
to each library's `.agda-lib` file:

```sh
cp deploy.config.example.json deploy.config.json
```

Edit `deploy.config.json` and set `agdaLibPath` for each library — see [`deploy.config.json` schema](#deployconfigjson-schema) below.

**4. (Optional) Generate prebuilt `.agdai` cache:**

Builds with native agda directly in the library's source directory and copies
the resulting `_build/` into the project cache. If the library was already
compiled (e.g. a previous run), agda skips unchanged files and completes in
milliseconds. First-time builds take ~8 min for stdlib.

```sh
npm run install-agdai
```

Generates the dependency-graph manifest afterwards.

Check what's ready at any time:

```sh
npm run check-agdai
```

**5. Build and verify:**

```sh
npm run setup
npm run check
npm run build
```

### What to place

Library source trees can live anywhere on your OS — their location is
recorded in the gitignored `deploy.config.json` (`agdaLibPath`), not in a
fixed project subdirectory. The only thing you need to place inside the
project is the ALS wasm and data:

```
deploy-assets/
  als/
    <als-name>/                        # matches the "als" field in deploy.config.json
      <als-name>.wasm                  # a single .wasm binary (filename discovered automatically)
      agda-data/                       # required — see notes below
        Agda/Builtin/*.agda
        agda-builtins.agda-lib
        _build/<numeric agda version>/agda/Agda/Builtin/*.agdai
```

`deploy-assets/als/` is gitignored; nothing in it is committed.
`deploy-assets/.cache/` is gitignored and auto-managed by the npm scripts —
do not edit it by hand.

(`npm run auto-configure` also downloads library sources into
`deploy-assets/library/<name>/` and points `deploy.config.json` at them —
that directory is gitignored too, and using it is entirely optional.)

**`deploy-assets/als/<als-name>/agda-data/`** — raw extracted Agda builtin
data, required for every ALS build. Two halves: `Agda/Builtin/*.agda` is
primitive source that ships with the Agda compiler itself; `_build/<numeric
agda version>/agda/...` is a precompiled interface cache for those same
primitives. To get it: find it with:

```sh
agda --print-agda-dir
# → <path>
# then: cp -r <path>/lib/prim/ deploy-assets/als/<als-name>/agda-data/
```

The `_build/` cache inside is generated automatically the first time native
`agda` type-checks anything that uses Agda's builtins. If you've already run
native `agda` once (e.g. to produce a library's `.agdai` cache), it's already
there — just copy the whole `lib/prim/` directory over. The resulting `_build/`
may not cover every builtin (only those your library transitively imports); run
`npm run build-agda-data` after copying to fill in the rest.

**`deploy-assets/.cache/<id>/_build/`** — prebuilt `.agdai` files. Populate
with:

```sh
npm run install-agdai
```

If your native `agda` predates 2.8.0 (no `--build-library`), run
`npm run generate-manifest` for that library first — `install-agdai` reads its
`agdai-manifest.json` to find the source vertices to `Cmd_load`. The
`--agda-bin` flag defaults to `agda` on `PATH`; pass a full path if you have
multiple versions installed.

### `deploy.config.json` schema

`deploy.config.json` (repo root, gitignored) is plain JSON — no comment
syntax, so the full field docs live here. Created from
`deploy.config.example.json` automatically on a fresh clone (by
`ensure-deploy-config.mjs`), or manually:

```sh
cp deploy.config.example.json deploy.config.json
```

Top-level fields:

**`profiles`** — a flat list of complete, ready-to-use ALS/library
combinations. There is deliberately no separate "pick an ALS version" +
"pick a library set" pair of independent choices: every option in `profiles`
is valid by construction, so the UI only needs a single profile selector and
can never present an incompatible pairing.

| Field | Required | Description |
|---|---|---|
| `label` | yes | Display name shown in the profile selector. Must be unique across all profiles — used as the profile's identity in the UI and local storage |
| `als` | yes | Name of the ALS directory under `deploy-assets/als/`. The `.wasm` filename is discovered automatically by scanning that directory |
| `libraries` | yes | List of library entries — see below |

Each entry in `libraries`:

| Field | Required | Description |
|---|---|---|
| `agdaLibPath` | yes | Absolute OS path to the library's `.agda-lib` file (e.g. `/home/user/agda-stdlib/standard-library.agda-lib`). The library `name` (used as the static-asset key) is parsed directly from this file's `name:` line |
| `label` | no | UI display name (e.g. `"stdlib"`). Falls back to the parsed `name:` value if absent |
| `version` | no | Version string shown in the UI (e.g. `"2.3"`). Cosmetic only |
| `useAgdai` | no (default `false`) | Whether to generate/serve the `.agdai` cache for this library. Set to `true` after running `npm run install-agdai` |

`npm run auto-configure` creates `deploy.config.json` automatically (with
`useAgdai: true` for downloaded libraries) when it doesn't already exist.

### Adding a library or ALS version

1. Add an entry to a `deploy.config.json` profile's `libraries`:

   ```json
   { "agdaLibPath": "/absolute/path/to/my-library.agda-lib", "label": "my-library" }
   ```

   For a new ALS build, set that profile's `als` to the directory name you chose
   (e.g. `"als-2.9"`) and place the files there. No separate catalog file to update.

2. Place the library's raw source under `deploy-assets/library/<name>/` (where
   `<name>` is the `name:` value from the `.agda-lib` file) and the ALS wasm /
   `agda-data/` under `deploy-assets/als/<als-name>/`.

3. Optionally generate or import the `.agdai` cache and manifest:

   ```sh
   npm run install-agdai -- --library my-library
   npm run generate-manifest -- --library my-library
   ```

4. Run setup:

   ```sh
   npm run setup
   ```

Check [ROADMAP.md](../ROADMAP.md) before adding plfa/agda-unimath/1lab — their `.agda-lib`
layout and type-theory compatibility with existing entries hasn't been
confirmed yet.

### What `npm run setup` generates

[`generate-library-info.mjs`](generate-library-info.mjs) reads every library's real
`.agda-lib` file at its `agdaLibPath` and writes
[`generated-libraries.mjs`](generated-libraries.mjs), mapping each `name` to the
`includeSubpath`, `libraryName`, and `agdaLibFilename` parsed straight out of
that file's `include:` / `name:` lines.
[`src/lib/runtime/interface.ts`](../src/lib/runtime/interface.ts) imports
this generated file at build time (Vite inlines it into the compiled bundle —
no extra runtime fetch). Nothing hand-declares these fields anywhere in this
project, so they can never drift from what the real `.agda-lib` says.

This generated file is gitignored — `npm run setup` always regenerates it. It's
also regenerated as a `predev`/`precheck`/`prebuild` step ([`package.json`](../package.json)), so
`npm run check`/`npm run build`/`npm run dev` never hard-fail just because
`deploy.config.json` hasn't been set up yet (a library without a configured path
is just skipped with a warning — the resulting empty/partial file is enough for
the build to type-check and compile, since the actual `GENERATED_LIBRARY_INFO`
content is only read once a real browser session runs the app).

Each ALS version's prebuilt `.agdai` cache version is no longer declared
anywhere either — [`src/lib/agda/prefetch.js`](../src/lib/agda/prefetch.js) asks the running ALS for its
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
Run the same native `agda` you intend to deploy with (matching the ALS build
you have placed in `deploy-assets/als/`).

The output (`deploy-assets/.cache/<id>/agdai-manifest.json`) is strictly more
complete than the old `--dependency-graph`-based graph: confirmed by
reproducing this project's previously-shipped manifests exactly — applying
transitive reduction to the new output reproduces the old file edge-for-edge.
The old approach was silently dropping real direct edges because `agda
--dependency-graph`'s Dot backend applies a transitive reduction for
visualization. [`prefetch.js`](../src/lib/agda/prefetch.js)'s `collectDeps` only does a transitive-closure
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

| `npm run` | Description |
|---|---|
| `auto-configure` | Downloads this project's default libraries and ALS wasm, creates `deploy.config.json`, fetches prebuilt `.agdai` and manifests. Hardcoded for the shipped defaults — run once on a fresh clone instead of manual setup |
| `setup` | Verifies all required files are present, zips library sources into `static/library/`, copies `.agdai`/manifests from `.cache/` into `static/agdai/`, copies ALS wasm and zips `agda-data/` into `static/als/` |
| `install-agdai` | Installs `.agdai` cache and generates the dependency-graph manifest. `--from <path>`: copy `_build/` from the given directory; no `--from`: build with native agda (`--build-library` for agda ≥ 2.8.0, `Cmd_load`-per-vertex for older). Supports `--library <name>`, `--agda-bin <path>`, `--force` |
| `install-als` | Sets up an ALS WASM build from a single `.wasm` file — no native agda required. Extracts agda-data source via `als --setup`, compiles all builtins via ALS WASM LSP, installs into `deploy-assets/als/<name>/`. Required: `--wasm <path>`. Supports `--name <als-name>` (defaults to the Agda version string) |
| `build-agda-data` | Compiles all `.agda` files in agda's own prim directory and copies the resulting `_build/` into `agda-data/`. Ensures every builtin has a precompiled `.agdai`, not just those your library happens to import. Supports `--als-version <version>` and `--agda-bin <path>` |
| `check-agdai` | Prints per-library manifest and `_build` status in `deploy-assets/.cache/` |

## How the manifest is used at runtime

`generate-manifest.mjs` writes one `{ graph }` per library, keyed by module
name, each value the list of modules it directly imports — the full
direct-edge graph, not transitively reduced. At runtime,
`src/lib/agda/prefetch.js` loads every active-profile library's manifest,
merges them into one working graph, computes the transitive closure from the
user's `import` statements, and triggers parallel fetches.
