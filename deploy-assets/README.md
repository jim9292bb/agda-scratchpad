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

**2. Place library source and ALS files** — see ["What to place"](#what-to-place) below.

**3. Create `deploy.config.json`** from the example, and fill in OS-absolute paths
to each library's `.agda-lib` file:

```sh
cp deploy.config.example.json deploy.config.json
```

Edit `deploy.config.json` and set `agdaLibPath` for each library.

**4. (Optional) Generate or import prebuilt `.agdai` cache:**

```sh
npm run import-agdai
```

Fastest option: copies `_build/` from each library's own source dir. Use this
if you've already type-checked the library with native agda.

```sh
npm run generate-manifest
npm run build-agdai
```

Builds from scratch with native agda. `generate-manifest` is only required
first if agda < 2.8.0; agda ≥ 2.8.0 uses `--build-library` directly.

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
    <version>/                         # must match alsVersion in deploy.config.json
      <wasmFilename>                   # a single binary file
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
there — just copy the whole `lib/prim/` directory over. The resulting `_build/`
may not cover every builtin (only those your library transitively imports); run
`npm run build-agda-data` after copying to fill in the rest.

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
| `id` | yes | Identifies the profile in the UI and local storage |
| `label` | yes | Display name shown in the profile selector |
| `alsVersion` | yes | ALS build this profile uses. All profiles sharing the same `alsVersion` must agree on `wasmFilename` |
| `wasmFilename` | yes | Filename of the ALS wasm binary under `deploy-assets/als/<alsVersion>/` |
| `libraries` | yes | List of `{ name, label?, version? }` — see below |

Each entry in `libraries`:

| Field | Required | Description |
|---|---|---|
| `name` | yes | `.agda-lib` `name:` value — used as the static-asset key (`static/library/<name>.zip`, `static/agdai/<name>/`), the VFS folder name, and the lookup key in `libraries`. Must be unique per profile; if the same `name` appears in multiple profiles, every reference must agree on `label`/`version` |
| `label` | no | UI display name (e.g. `"stdlib"`). Falls back to `name` if absent |
| `version` | no | Version string shown in the UI (e.g. `"2.3"`). Cosmetic only — not used to build any path or cache key |

**`libraries`** — per-library local configuration, a list of `{ name, agdaLibPath, useAgdai? }`:

| Field | Required | Description |
|---|---|---|
| `name` | yes | Must match a library `name` in a `profiles` entry |
| `agdaLibPath` | yes | Absolute OS path to the library's `.agda-lib` file (e.g. `/home/user/agda-stdlib/standard-library.agda-lib`) |
| `useAgdai` | no (default `false`) | Whether to generate/serve the `.agdai` cache for this library. Set to `true` after running `npm run import-agdai` or `npm run build-agdai` |

`npm run auto-configure` creates `deploy.config.json` automatically (with
`useAgdai: true` for downloaded libraries) when it doesn't already exist.

### Adding a library or ALS version

1. Add a `{ name, label?, version? }` entry to a `deploy.config.json` profile's
   `libraries`. For a new ALS version, set that profile's `alsVersion` /
   `wasmFilename` directly. No separate catalog file to update.

2. Add a matching entry to `deploy.config.json`:

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
Run the same native `agda` you intend to deploy with (matching this project's
`alsVersion`).

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
| `generate-manifest` | Generates a library's dependency-graph manifest via `Cmd_tokenHighlighting` — see ["Regenerating the dependency graph"](#regenerating-the-dependency-graph). Supports `--library <name>` and `--agda-bin <path>` |
| `build-agdai` | Builds `.agdai` cache for a library: `--build-library` for agda ≥ 2.8.0, `Cmd_load`-per-vertex fallback for older versions. Supports `--library <name>` and `--agda-bin <path>` |
| `build-agda-data` | Compiles every `.agda` in `agda-data/` with `--only-type-check` to produce a complete builtin `_build/` cache. Supports `--als-version <version>` and `--agda-bin <path>` |
| `import-agdai` | Copies `_build/` from `dirname(agdaLibPath)` into `.cache/<id>/_build/`. Fastest option when the library has already been type-checked with native agda. Supports `--library <name>` and `--force` |
| `check-agdai` | Prints per-library manifest and `_build` status in `deploy-assets/.cache/` |

## How the manifest is used at runtime

`generate-manifest.mjs` writes one `{ graph }` per library, keyed by module
name, each value the list of modules it directly imports — the full
direct-edge graph, not transitively reduced. At runtime,
`src/lib/agda/prefetch.js` loads every active-profile library's manifest,
merges them into one working graph, computes the transitive closure from the
user's `import` statements, and triggers parallel fetches.
