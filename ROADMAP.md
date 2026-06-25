# Agda Playground Roadmap

This roadmap tracks work for a browser-hosted, single-file Agda playground for
teaching, demonstrations, and practice. The project takes a similar approach to the
JSCoq scratchpad: focused interaction with one source buffer, not development of
a multi-file Agda project.

`banacorn/agda-mode-vscode` is a reference for Agda interaction behavior,
shortcut semantics, and request/response handling. It is not the product
roadmap, and this project does not aim for complete VSCode parity.

Use [PROJECT_GOAL.md](PROJECT_GOAL.md) for product scope and
[docs/AGDA_MODE_VSCODE_MAPPING.md](docs/AGDA_MODE_VSCODE_MAPPING.md) for
researched Agda command mappings.

## Scope Boundaries

- [x] Preserve the single-file playground model backed by `/source.agda`.
- [x] Treat Cubical Agda and the standard library as preloaded runtime assets, not as project-management features.
- [ ] Do not add multi-file editing.
- [ ] Do not add a file explorer.
- [ ] Do not add an open package manager UI (arbitrary user-supplied library
      formats, dependency resolution, or a library registry). A bounded
      file-server-origin override (see "Custom File Server / Library Source")
      is an explicit, scoped exception to this line, not a contradiction of it.
- [ ] Do not add project/workspace configuration UI.
- [ ] Do not port Agda executable download or version switching unless multiple WASM runtimes are intentionally supported.
- [ ] Do not port VSCode-specific Markdown preview or editor-workspace keybindings.
- [ ] Do not split `deploy-assets/` into its own repository. `src/lib/runtime/interface.ts`
      imports `deploy-assets/libraries.mjs`/`als-catalog.mjs` directly at
      build time, not just during CI — it's a build-time dependency of the
      app, not standalone tooling that happens to live alongside it. A
      split would trade that zero-friction same-repo import for npm/git
      submodule version-pinning overhead, with no actual external consumer
      to justify it.

## Development Priorities

1. Correctness of the Agda interaction lifecycle.
2. Clear goal and context display.
3. Reliable Agda shortcuts for exercises.
4. Good diagnostics and query output.
5. Unicode input suitable for Agda practice.
6. Browser regression coverage for common teaching examples.
7. UI polish that keeps the playground simple.

## Runtime and Library Support

Goal: examples should load reliably in a browser without local Agda installation.

- [x] Load ALS/Agda `2.8.0` from WASM.
- [x] Preserve existing standard-library behavior.
- [x] Add Cubical Agda `v0.9` as a static runtime asset.
- [x] Extract Cubical into the virtual filesystem at startup.
- [x] Register Cubical in Agda library configuration.
- [x] Set the default source to a minimal Cubical example.
- [x] Show Cubical `v0.9` in startup configuration.
- [x] Add a scripted Cubical regression that loads `Cubical.Foundations.Prelude`.
- [x] Add a scripted standard-library regression that loads `Data.Nat.Base`.
- [x] Show a read-only runtime summary for Agda, ALS, stdlib, and Cubical versions.

## Runtime and Library Performance

Goal: make ALS/WASM startup and library loading measurable before changing the
runtime architecture.

- [x] Add timing instrumentation for WASM response fetch, ALS worker initialization, library zip fetch, library extraction, Agda setup, source sync, `Cmd_load`, and token highlighting.
- [x] Add drive proxy call and byte counters around Agda load commands.
- [x] Add drive proxy method timing, top path, and `.agda` / `.agdai` profiling around `Cmd_load`.
- [x] Add double-load profiling for Cubical Prelude to compare first and second `Cmd_load`.
- [x] Add a default-off `pathStat` cache experiment switch for local benchmarking.
- [x] Add an isolated runtime/filesystem benchmark harness with a `runno-direct-fs` adapter scaffold.
- [x] Add a `runno-proxy-current` runtime/filesystem baseline that matches the main app drive proxy architecture.
- [x] Show collected performance timings in the runtime/info panel.
- [x] Browser-test that startup and library preparation timings are visible.
- [ ] Evaluate pathStat-heavy lookup optimization in the WASI drive proxy.
- [x] Add an experiment-only `runno-proxy-current --pathstat-cache` benchmark.
- [ ] Evaluate persistent IndexedDB caching for extracted stdlib and Cubical files.
- [ ] Evaluate lazy library extraction instead of eager JSZip inflation.
- [ ] Evaluate prebuilt `.agdai` interface caches for selected teaching examples.
- [ ] Resolve the `runno-direct-fs` raw ALS `ResponseEnd` blocker or replace it with a better direct baseline.
- [ ] Evaluate direct in-memory FS or memfs-style architecture experiments against Runno drive proxy overhead.
- [x] Add a `vscode-wasm-memfs` dependency/artifact probe and blocker report.
- [x] Add a benchmarkable `browser-wasi-shim-memfs` runtime/filesystem adapter.
- [x] Add a benchmarkable `browser-wasi-shim-overlay-snapshot` runtime/filesystem adapter.
- [x] Compare `runno-proxy-current`, `browser-wasi-shim-memfs`, and `browser-wasi-shim-overlay-snapshot` benchmark results.
- [x] Document the runtime/filesystem comparison conclusion.
- [x] Add a main-app runtime backend selector scaffold.
- [x] Add a behavior-preserving runtime backend abstraction around the current `runno-proxy-current` path.
- [x] Port `browser-wasi-shim-memfs` into the main app behind the runtime backend selector.
- [x] Browser-test library loading with both runtime backends. — moot:
      `runno-proxy-current` was fully removed; `browser-wasi-shim-memfs` is
      the sole backend (no selector exists in the UI anymore), so there's
      only one backend to browser-test — already covered by the regular
      `test:browser:libraries`/`test:browser:library-cache-profile` suites.
- [x] Decide whether `browser-wasi-shim-overlay-snapshot` is worth porting
      after the simpler memfs backend works. — decided no: memfs became the
      sole backend; overlay-snapshot was never ported into the main app.

## Curated Multi-Library Support

Goal: let users pick from a small, project-curated set of well-known Agda
libraries beyond stdlib/cubical — concrete motivating examples: `agda/agda-categories`,
`plfa/plfa.github.io`, `UniMath/agda-unimath`, `plt-amy/1lab` (verify exact repo
coordinates before implementing), and multiple versions of a given library.
This replaces an earlier, more open-ended "point at any custom file server
URL" design (see git history of this file). That design was scoped for
letting users self-host an *untrusted* alternate origin, which needs a
trust/warning/hash-pinning model. The actual need here doesn't require
that: every library in the curated set is still built and served by this
project's own CI from the same trusted origin as stdlib/cubical today —
users are choosing from a menu, not supplying an arbitrary external server.
No new trust boundary, no hash pinning, no warning dialogs needed.

Self-deployers configure which Agda environment combinations their
deployment offers via `deploy.config.mjs` (repo root) — see that file's
comments for the schema. The schema is a flat list of `profiles`; each
profile is a complete, ready-to-use combination (one ALS version + a
compatible library set), not a separate "pick an ALS version" + "pick a
library set" pair of independent choices — every option is valid by
construction, so there's nothing to cross-reference or filter in the UI.
Everything under `deploy-assets/` reads from it via
`deploy-assets/resolve-deploy-config.mjs` instead of hardcoding stdlib/cubical.
The default config reproduces this project's own deployment (ALS 2.8.0,
stdlib 2.3 + Cubical 0.9, as a single profile) unchanged.

Done:

- [x] Generalize `deploy-assets/generate-manifest.mjs` and `extract-agdai.mjs`
      to read a library spec catalog (`deploy-assets/libraries.mjs`) instead of
      the hardcoded stdlib/cubical pair.
- [x] Add `deploy.config.mjs` + `deploy-assets/als-catalog.mjs` +
      `deploy-assets/resolve-deploy-config.mjs`: a single config file drives
      which ALS versions and library combinations get downloaded
      (`scripts/download-assets.sh` → `deploy-assets/print-download-list.mjs`),
      cached (`extract-agdai.mjs`), and exposed to the runtime
      (`src/lib/runtime/interface.ts`'s `agdaVersionMap`).
- [x] `interface.ts`'s `agdaVersionMap`/`supportedAgdaVersions` derived from
      `deploy.config.mjs` instead of a hardcoded 3-entry map; dropped the
      unused `stdlibCandidates` field.
- [x] Flattened the schema from independent `alsVersions` + `librarySets`
      (with a `compatibleAlsVersions` cross-reference) to a single flat
      `profiles` list, each a self-contained (alsVersion, libraries) pairing —
      removes the possibility of the UI ever presenting an invalid pairing
      and the need for compatibility-filtering logic.
- [x] Verified behavior-preserving at each step: regenerated
      `static/agdai-manifest.json` was byte-for-byte identical to the
      pre-refactor version (2232 modules, 292 KB) after the library-spec
      generalization, after adding deploy.config.mjs, and again after the
      profiles flattening.

Done (continued):

- [x] `src/lib/worker/als-wasi-shim.ts`'s `buildFilesystem()` no longer
      hardcodes stdlib/cubical: it takes a generic `LibraryToLoad[]` and
      generates `~/.config/agda/libraries`/`defaults` from each library's
      `folderName`/`agdaLibFile`/`libraryName` (added as explicit fields on
      `deploy-assets/libraries.mjs` catalog entries, alongside
      `archiveRootPrefix`/`includeSubpath` for the generic zip-extraction
      path-rewrite). This is the actual mechanism that combines multiple
      libraries for one Agda session — Agda's own `.agda-lib`
      `depend:`/`flags:` resolution handles the rest; `deploy.config.mjs`'s
      job is only to decide which `.agda-lib` paths get registered.
- [x] Added a "Deployment profile" `<select>` to Settings → Runtime and
      libraries (previously a static read-only display), populated from
      `interface.ts`'s `deployProfiles` export. `AgdaController.switchProfile()`
      terminates the current worker and restarts with the new profile's ALS
      version + libraries; the backend is now constructed lazily since it
      depends on the active profile.
- [x] `src/lib/agda/prefetch.js`'s `AGDA_VERSION` constant is gone;
      `triggerPrefetch()` takes the active profile's resolved libraries and
      builds each `.agdai` path from that library's own
      `agdaiCacheVersion`/`folderName`/`includeSubpath`, scoped to the
      active profile's `libKey`s.
- [x] Verified via the real browser regression suites (not just
      `npm run check`/`build`): `test:browser:core-commands` and
      `test:browser:library-loads` both PASS against this refactor.

Done (agda-categories, second library proving the system generalizes):

- [x] Added `agda-categories` v0.3.0 (targets Agda 2.8.0 + standard-library-2.3,
      per its release notes) to `deploy-assets/libraries.mjs`, and a
      `stdlib-2.3-agda-categories-0.3.0-als-2.8.0` profile to `deploy.config.mjs`.
- [x] `deploy-assets/generate-manifest.mjs` now extracts every selected
      library's source upfront and builds one shared real `--library-file`
      registering all of them (previously each library was checked against
      `--library-file=/dev/null` in total isolation), so a library with a
      `depend:` on another configured library resolves the same way the
      browser runtime resolves it. Two bugs fixed along the way:
      (1) leaving each library's generated `Everything.agda` in place caused
      `[AmbiguousTopLevelModuleName]` once a later library's search path
      could see an earlier one's leftover file — fixed by deleting it
      immediately after that library's check; (2) a library's dependency
      graph naturally includes modules from libraries it depends on (e.g.
      agda-categories pulls in stdlib modules), so attributing `libOf` from
      the full edge map let a later library "steal" ownership of an earlier
      library's module — fixed by attributing `libOf` only from the modules
      a library actually defines (`findAgdaFiles(includeDir)`), not every
      module reachable from its generated `Everything.agda`.
- [x] Removed agda-categories' `optionsPragma` (`--without-K --safe` was
      previously assumed uniform across the library, but at least one file,
      `Categories.Adjoint.Parametric.agda`, has no `{-# OPTIONS #-}` pragma
      at all — declaring those flags on the generated `Everything.agda`
      tripped Agda's coinfective check, `[CoInfectiveImport]`, against such
      files). No options at all on the wrapper file is the correct fix:
      coinfective flags are only enforced when the *importer* declares them.
- [x] `static/agdai-manifest.json` regenerated (2734 modules, 371 KB; 1153
      stdlib, 1090 cubical, 502 agda-categories — matches agda-categories'
      502 source files).
- [x] Added `scripts/browser-test-agda-categories-smoke.sh`
      (`npm run test:browser:agda-categories`): switches the Settings →
      Runtime profile selector to the agda-categories profile via the real
      UI, loads a fixture importing `Categories.Category.Core`, and asserts
      a clean `Load finished.` with no library-resolution errors. Verified
      no regression in `test:browser:libraries` / `test:browser:library-cache-profile`
      (the stdlib+cubical profile) after these changes.
- [x] Prebuilt an `.agdai` cache for agda-categories via
      `experiments/build-library` (`npm run build:agda-categories`).
      `--build-library`'s 600s timeout was too short for a full type-check of
      ~500 modules depending on stdlib (bumped to 1800s). Also: `--build-library`
      writes interfaces for *every* module it checks, including depended-on
      libraries' (here, some stdlib modules), into the same HOME-rooted
      `_build/` tree as the library being built — `collectAgdai()` now only
      keeps a `.agdai` if a matching `.agda` source exists under that
      library's own extracted root, so the result is exactly agda-categories'
      502 modules (verified 1:1 against its source tree — no missing, no
      foreign leakage). Uploaded as `agda-categories-agdai.zip` to the
      `cache-2.8.0` GitHub release alongside stdlib/cubical's, and wired into
      `deploy-assets/libraries.mjs`'s `agdaiCacheVersion`/`agdaiZipUrl`/
      `agdaiZipName` — `print-download-list.mjs`/`extract-agdai.mjs` already
      read these generically, no script changes needed there.
- [x] Fixed: the prebuilt cache above was actually never used at runtime.
      `src/lib/worker/als-wasi-shim.ts`'s `_ensureAgdai()` (the on-demand
      `.agdai` network-fetch path, triggered when the WASM Agda process
      probes for an interface file) had a hardcoded
      `path_str.startsWith('stdlib/_build/') || path_str.startsWith('cubical/_build/')`
      check — a leftover from before the multi-library generalization that
      never got updated for new library folder names. Any other library's
      `.agdai` probe silently returned without fetching, so Agda always fell
      back to recompiling from source. The original smoke fixture (a single
      shallow `Categories.Category.Core` import) didn't exercise this path
      deeply enough to expose it — its "first Cmd_load ~4.1s" reading was
      almost entirely stdlib's (working) cache plus one tiny from-source
      agda-categories file. Caught when manually loading a deeper import
      (`Categories.Category.Monoidal.Instance.StrictCats`, ~170 transitive
      modules) showed dozens of `Checking <module>` log lines and a 123s
      load. Fixed by generalizing the check to `path_str.includes('/_build/')`
      — any registered library's real cache path always contains `_build/`;
      source-tree probes never do. Same load now takes ~9s with zero
      `Checking <module>` lines. Strengthened
      `scripts/browser-test-agda-categories-smoke.sh`'s fixture to use the
      deep import and assert no `Checking Categories\.` lines appear, so a
      regression of this path-prefix check is actually caught next time.
- [x] Removed download URLs from `deploy-assets/libraries.mjs`/`als-catalog.mjs`
      entirely (`sourceArchiveUrl`, `agdaiZipUrl`, `wasmUrl`, `dataZipUrl`) —
      both catalogs are now pure metadata; self-deployers can no longer
      configure a download URL, only place files by hand in
      `deploy-assets/library/`/`deploy-assets/als/`. `print-download-list.mjs`
      (URL-driven) was replaced by `print-required-files.mjs` (just
      filenames, for `scripts/setup-assets.sh`'s verification step).
      `scripts/download-assets.sh` was renamed to `scripts/auto-configure.sh`
      and rewritten as a hardcoded, non-catalog-driven fetch of exactly this
      project's own shipped defaults — used by this project's own CI
      (`npm run auto-configure`), not a generic/extensible mechanism.
- [x] Switched `deploy-assets/{library,als}/` from staging *compressed
      archives* to staging **raw, unzipped files** — a deployer (or
      `npm run auto-configure`, now `deploy-assets/auto-configure.mjs`,
      rewritten in Node to fetch-and-extract instead of fetch-and-leave-as-zip)
      places a raw library source tree plus an optional raw `_build/`
      `.agdai` cache under `deploy-assets/library/<name>/`, and a raw wasm +
      `agda-data/` directory under `deploy-assets/als/`. `npm run setup`
      (`deploy-assets/build-static-assets.mjs`) is now responsible for
      zipping whatever the browser runtime needs as a zip (library source,
      `agda-data.zip` — both fetched and unzipped client-side, confirmed
      via `src/lib/runtime/browser-wasi-shim.ts`/`als-wasi-shim.ts`) using
      a new pure-Node `zipDirectory()` in `zip-utils.mjs`, wrapping the
      source zip under `archiveRootPrefix` so the existing client-side
      unzip-and-strip logic needs zero changes. `.agdai` cache files
      (never fetched by the browser — confirmed `agdaiZipAsset` is
      unused at runtime) are just copied as a tree, no zip step needed;
      `extract-agdai.mjs` deleted as a result.
- [x] Split `deploy-assets/generate-manifest.mjs` (single script: build
      Everything.agda, invoke native `agda --dependency-graph`, parse the
      `.dot`, write `static/agdai-manifest.json`, committed to git) into
      `prepare-dependency-graph.mjs` (everything except invoking `agda` —
      writes a generated `run-agda.sh` that, per library, writes/runs/
      cleans up its own synthetic `Everything.agda` in sequence, avoiding
      `AmbiguousTopLevelModuleName` from two libraries' synthetic files
      coexisting) and `dot-to-manifest.mjs` (pure `.dot`-parsing, no `agda`
      needed). The dependency graph is no longer committed to git or
      auto-fetched for anything beyond this project's own shipped
      defaults: self-deployers who change `deploy.config.mjs` must produce
      their own via the two scripts above and place the result themselves.
      This project's own default graphs (stdlib + cubical + agda-categories)
      are produced the same way by a maintainer and uploaded to the
      `cache-2.8.0` GitHub Release, where `npm run auto-configure`
      downloads them from (best-effort — missing one just disables
      prefetching for that library, doesn't fail the rest).
- [x] Split the dependency graph itself from one combined
      `{ graph, libOf }` file (covering the union of every library
      referenced by *any* configured profile) into one `{ graph }` file
      per library (`deploy-assets/library/<name>/agdai-manifest.json` →
      `static/agdai/<name>/agdai-manifest.json`) — a session now only
      fetches the manifests for its *active* profile's libraries, and
      adding a new library later never touches an existing one's
      manifest. `libOf` is gone from the file format: within one
      library's own file every key is trivially "this library's module";
      `src/lib/agda/prefetch.js` derives the equivalent client-side when
      merging the active profile's libraries' manifests (one
      `fetch()`-and-cache per library, keyed by `libKey`), so cross-library
      dependency edges (agda-categories → stdlib) still resolve — every
      active-profile library's manifest is loaded up front, not
      discovered-and-fetched mid-walk. `src/lib/runtime/interface.ts`'s
      `ResolvedLibrary` gained `manifestAsset`, derived purely from the
      existing folder-name convention (no new catalog field, same as
      `_build/`).
- [x] Removed several `libraries.mjs` catalog fields nothing but
      themselves needed: `libKey` (now computed inline in
      `interface.ts` as `${name}@${version}`), `agdaiZipName`/
      `ResolvedLibrary.agdaiZipAsset` (dead — confirmed unread anywhere,
      and `build-static-assets.mjs` no longer produces a zip at that
      path at all), `sourceZipName`/`archiveRootPrefix` (now derived in
      `findLibrary()` — neither value's exact text matters, only
      uniqueness/non-emptiness, which `name`+`version` already
      guarantee), and `optionsPragma` (confirmed empirically necessary —
      `.agda-lib` `flags:` don't apply to the synthetic `Everything.agda`
      — but nothing else reads it, so it moved to a
      `--scope-check-pragma` CLI flag on `prepare-dependency-graph.mjs`
      instead of living in a catalog every other tool also reads).
      `experiments/build-library/src/build-agdai.mjs` and
      `experiments/runtime-fs/src/{benchmark.js,vscode-wasm-memfs-runtime.js}`
      — previously hardcoding the literal zip filenames/archive prefixes
      — were switched to read `findLibrary()`'s derived values instead,
      so they no longer silently break if those values change.
- [x] `prepare-dependency-graph.mjs` is now always scoped to exactly one
      library per run (`--library <name>`, required), since there's no
      longer a per-library `optionsPragma` to read for a batch of
      libraries at once — every *currently-selected* library is still
      registered together in the shared `libraries` file regardless (so
      `depend:` still resolves), only the Everything.agda/dot-output step
      is limited to the one requested library. `dot-to-manifest.mjs`
      mirrors this: it processes whatever `own-modules.json` says was
      most recently prepared, not every selected library. Verified by
      running this new flow for real (native agda) for all three of this
      project's own libraries and diffing the output manifests against
      the previously-committed ones — byte-identical.
- [x] Renamed `prepare-dependency-graph.mjs` to `generate-dot.mjs` and had
      it invoke `agda` directly (`execFile`) instead of generating an
      intermediate `run-agda.sh` for the deployer to run separately — one
      command now produces the `.dot` file end to end, matching
      `dot-to-manifest.mjs`'s framing as "one script generates the `.dot`,
      one converts it." Verified by running it for real for all three of
      this project's own libraries — byte-identical output to before.
      Also added a completeness check to `dot-to-manifest.mjs`: every
      module `own-modules.json` expects must have a label in the parsed
      `.dot` graph, or it errors out naming the missing ones, instead of
      silently recording them as having zero dependencies. Confirmed (by
      manually truncating a real `.dot` file's edge lines while leaving
      labels intact) that this only catches a module never being labeled
      at all, not an existing label missing some of its edges — there's
      no independent source of truth for edge-completeness short of
      reimplementing Agda's own import resolution, and no evidence Agda's
      Dot backend ever produces output in that partially-labeled shape
      (a real hard failure, tested directly, writes no `.dot` file at
      all, not a partial one).
- [x] Reversed course on `generate-dot.mjs`: deleted it entirely instead
      of having it invoke `agda`. A single synthetic `Everything.agda`
      covering a whole library can't always work — a library mixing
      modules that need mutually exclusive `{-# OPTIONS #-}` has no one
      pragma value that covers all of them — so splitting modules into
      groups (and writing the right options per group) needs a human who
      understands the library's structure, not a script guessing.
      Self-deployers now write their own `Everything.agda`-style file(s)
      under `deploy-assets/library/<name>/everything/`, run native `agda
      --dependency-graph` themselves (so they see its real output
      directly, not a wrapper's tolerance logic deciding for them), and
      place the resulting `.dot` file(s) under
      `deploy-assets/library/<name>/dots/`. The shared library-file
      needed for cross-library `depend:` resolution is now also pure
      documentation (`deploy-assets/README.md`) — no script writes it.
      `dot-to-manifest.mjs` is the only script left: it takes `--library
      <name>`, computes that library's own module set by scanning its
      source tree directly (not derived from the `everything/` files, so
      it doesn't matter how modules got grouped), merges every `.dot` file
      under `dots/`, and runs the existing completeness check against the
      merged result. `build-static-assets.mjs`'s zip-exclude list gained
      `everything`/`dots` so neither ships to the browser. Also required
      an extra `-i deploy-assets/library/<name>/everything` flag on the
      `agda` invocation, confirmed empirically — without it agda rejects
      the entry file with `ModuleNameDoesntMatchFileName`, since
      `everything/` isn't part of the library's own registered include
      path. Verified by manually walking the new flow for real (native
      agda) for stdlib, cubical, and agda-categories. stdlib and
      agda-categories came out byte-identical to the previously-committed
      manifests; cubical gained one module
      (`Cubical.Codata.Everything`) that the old `generate-dot.mjs` had
      been silently dropping — its own `findAgdaFiles()` excluded any
      file literally named `Everything.agda` anywhere in the tree (by
      filename, not by checking the module name), which incorrectly
      caught this real, nested library module purely by filename
      coincidence with the synthetic entry-point convention. The new
      implementation only excludes the dedicated `everything/`/`dots/`
      directories, not files by name, so this module is now correctly
      included.

Not yet implemented:

- [ ] Add specs for plfa, agda-unimath, 1lab to `deploy-assets/libraries.mjs`
      (confirm each library's actual `.agda-lib` name/include path/required
      OPTIONS first), and add corresponding profile(s) to `deploy.config.mjs`.

Considered and rejected: having `npm run setup` skip libraries outside some
"default" profile. The runtime is already lazy where it matters — a browser
session only fetches its *active* profile's source zip
(`browser-wasi-shim.ts`'s `_fetchLibraryZips`), and `.agdai` files are
fetched per-file on demand via the prefetch manifest, never as a bulk zip.
`npm run setup` downloading every configured profile's libraries is a
one-time, deployer-side build cost (CI time / disk), not something any end
user pays for — not worth the added complexity.

Done (fixed stale browser-test selectors — `npm run test:browser` now passes
all 18 scripts cleanly):

- [x] `scripts/browser-common.sh`'s `click_button`/`wait_for_button` looked
      up buttons by text content only; the Settings toggle is icon-only
      (`aria-label="Settings"`, no text), so any test opening Settings had
      likely never passed against the current UI. Both helpers now also
      match by `aria-label`.
- [x] `scripts/browser-test-settings-dialog.sh` and
      `scripts/browser-test-shortcut-overrides.sh` had their own inline
      Settings-button lookups (same text-only bug, bypassing the helper) —
      fixed the same way. `settings-dialog.sh` also asserted the Settings
      button lives in a `.als-buttons` container with a `Restart` button
      found via `button[class*="restart"]` — neither class exists in the
      current markup (button text is `Restart`, container is
      `.control-card-row`); updated to match.
- [x] `scripts/browser-test-error-display.sh` looked up a `.messages-view-select
      select` to switch to the errors view; the messages panel now uses a
      `.messages-tab-group` of buttons (Log/Queries/Errors), not a select.
      Updated to click the Errors tab button.
- [x] `scripts/browser-test-example-picker.sh` looked up a `#scratchpad-example`
      `<select>`; the example picker is now a button + dropdown menu
      (`.header-examples-btn` / `.header-examples-menu` /
      `.header-examples-item`). Updated to open the menu and click the
      target item by its label.

## Goal Lifecycle and Editor State

Goal: Agda goals should remain correct after load, edits, case split, give,
refine, auto, and asynchronous ALS responses.

- [x] Create a centralized goal state module.
- [x] Track each goal by Agda interaction point id.
- [x] Store each goal's outer range, inner range, input, and document version.
- [x] Map CodeMirror offsets to Agda UTF-8 ranges through one shared utility.
- [x] Update goal ranges after every CodeMirror document transaction.
- [x] Reject or rebase async Agda responses when the document version is stale.
- [x] Rebuild goal ids from Agda `InteractionPoints` after `Load`.
- [x] Merge existing and newly generated goals after `Give` and `Refine`.
- [x] Remove goal boundaries after successful `Give`.
- [x] Add defensive handling for damaged or partially edited goal boundaries.
- [x] Verify `Load` updates highlighting, diagnostics, warnings, and goals after the goal-state refactor.
- [x] Add browser regression coverage for damaged or partially edited goal boundaries.

## Core Practice Commands

Goal: common Agda exercise workflows should work from the editor with familiar
Agda shortcuts.

- [x] Keep `C-c C-l` wired to `Cmd_load`.
- [x] Wire `C-c C-Space` Give using `Cmd_give WithoutForce goalId range content`.
- [x] Wire `C-c C-c` Case split using `Cmd_make_case goalId range content`.
- [x] After Case split, replace the old goal with returned clauses and immediately reload.
- [x] Wire `C-c C-r` Refine using `Cmd_refine_or_intro False goalId range content`.
- [x] Replace provisional Auto behavior with real `Cmd_autoOne normalization goalId range content`.
- [x] Implement `C-c C-m` Elaborate and give using `Cmd_elaborate_give`.
- [x] Implement `C-c C-h` Helper function type using `Cmd_helper_function`.
- [x] Show a clear error when a command requires content but the current goal is empty.
- [x] Show a clear error when the cursor is not inside a goal.
- [x] Extract core command construction into `src/lib/agda/commands.js`.
- [x] Browser-test Load, Give, Case split, Refine, Auto, Elaborate and give, and Helper function type with `agent-browser` scripts.

## Goal Queries and Exploration

Goal: learners should be able to inspect goal type, context, inferred types,
normal forms, scope, and module contents without leaving the playground.

- [x] Implement `C-c C-t` Goal type using `Cmd_goal_type`.
- [x] Implement `C-c C-e` Context using `Cmd_context`.
- [x] Wire `C-c C-,` Goal type and context using `Cmd_goal_type_context`.
- [x] Wire `C-c C-.` Goal type, context, and inferred type using `Cmd_goal_type_context_infer`.
- [x] Align `C-c C-,` and `C-c C-.` semantics with `agda-mode-vscode` naming and expected output.
- [x] Implement `C-c C-;` Goal type, context, and checked type using `Cmd_goal_type_context_check`.
- [x] Wire `C-c C-d` Infer type using `Cmd_infer`.
- [x] Wire `C-c C-n` Compute normal form using `Cmd_compute`.
- [x] Implement `C-c C-z` Search about using `Cmd_search_about_toplevel`.
- [x] Implement `C-c C-o` Module contents using `Cmd_show_module_contents`.
- [x] Implement `C-c C-w` Why in scope using `Cmd_why_in_scope`.
- [x] Extract query command construction into `src/lib/agda/commands.js`.
- [x] Move query results from the raw log into a structured Queries panel.
      (`.queries-panel`/`queriesPanel()` snippet in `+page.svelte`, backed by
      `agdaController.queryResults`.)
- [x] Render query results without losing Agda formatting. (`<pre
      class="query-result-content">` preserves whitespace.)
- [x] Browser-test query shortcuts with reusable fixtures.
      (`scripts/browser-test-query-shortcuts.sh` uses
      `test-fixtures/agda/query-bool.agda`.)

## Goals Panel and Navigation

Goal: the Goals panel should be the main practice aid for single-file proof and
program construction.

- [x] Show current goals below the editor.
- [x] Make Goals panel entries clickable.
- [x] Move the editor cursor into the selected goal when a goal is clicked.
- [x] Add Next goal command.
- [x] Add Previous goal command.
- [x] Show goal ids in the editor as CodeMirror decorations.
- [x] Highlight the active goal.
- [x] Keep the Goals panel synchronized after edits, Load, Give, Refine, and Case split.
- [x] Display goal type and context for the active goal.
- [x] Add a browser regression for active goal type/context display.
- [ ] Consider a compact mode for examples with many goals.

## Command Input Panel

Goal: when a command needs text and the active goal is empty, users should be
able to type the required content in a panel, similar to the useful parts of
`agda-mode-vscode`'s goal input workflow.

- [x] Add a panel prompt for commands that require input when the active goal is empty.
- [x] Use the prompt result as command content for Case split, Give, Refine, Elaborate and give, Helper function type, Infer, Compute, Search, Module contents, Why in scope, and checked-type queries.
- [x] Allow cancelling the prompt without sending an Agda command.
- [x] Restore editor focus after prompt submit or cancel.
- [x] Support Agda Unicode input method inside the prompt after the Unicode input method exists.
- [x] Add browser regressions for prompt submit, cancel, and focus restore.

## Shortcut Configuration

Goal: Agda shortcuts should work for learners by default, while still allowing
users to replace bindings that conflict with their browser, operating system, or
keyboard layout.

- [x] Centralize shortcut definitions in a data-driven registry instead of scattering hard-coded key checks through UI event handlers.
- [x] Keep the default bindings aligned with familiar Agda mode shortcuts where practical.
- [x] Add a floating Settings dialog with a shortcut settings section.
- [x] Add a lightweight shortcut settings UI for replacing command bindings.
- [x] Validate replacement bindings and warn about duplicate Agda command shortcuts.
- [x] Persist shortcut overrides in browser local storage.
- [x] Add a reset-to-default-shortcuts action.
- [x] Make shortcut help render from the same registry used by the dispatcher.
- [x] Add a collapsible, scrollable Commands panel rendered from the shortcut registry.
- [x] Browser-test overridden shortcuts for representative command classes.
- [x] Browser-test an overridden Load shortcut.
- [x] Browser-test an overridden goal command shortcut.
- [x] Browser-test an overridden query command shortcut.

## Diagnostics and Output Panels

Goal: errors, warnings, logs, and query results should be readable for learners
and not buried in raw transport output.

- [x] Parse Agda errors into structured diagnostics.
- [x] Show file, line, and column for errors.
- [x] Allow clicking an error to jump to its source position.
- [x] Handle `JumpToError` responses by moving the editor cursor to the reported position.
- [x] Add a Messages panel with switchable Log and Errors views.
- [ ] Separate output into Log, Goals, Queries, Warnings, and Errors.
- [ ] Preserve raw Agda output behind a debug view.
- [ ] Add an internal debug panel for request/response tracing.
- [x] Add teaching-oriented examples for syntax errors and semantic errors.

## Unicode Input Method

Goal: learners should be able to type Agda symbols in the browser without an
external editor setup.

- [x] Add Agda input method triggered by backslash.
- [x] Use `../references/agda-mode-vscode/asset/keymap.js` as the trie source.
- [x] Show a floating two-row tooltip: Row 1 = candidate symbols, Row 2 = key suggestions for continuing input.
- [x] Support selecting candidates with keyboard navigation (← → move one by one, ↑ ↓ page through 9 per page, 1–9 select by position).
- [x] Replace the input sequence with the chosen Unicode symbol.
- [x] Ensure Agda shortcuts still have priority while the editor is focused.
- [x] Support Agda Unicode input inside the command input prompt.
- [ ] Add a lookup command similar to `C-x C-=`.
- [x] Browser-test Unicode input method flows.

## Normalization and Command Variants

Goal: expose useful Agda command variants without copying VSCode's exact prefix
UI when it does not fit the browser playground.

- [ ] Support AsIs normalization.
- [ ] Support Simplified normalization.
- [ ] Support Instantiated normalization where supported.
- [ ] Support Normalised normalization.
- [ ] Support HeadNormal normalization.
- [ ] Add a browser-friendly alternative to VSCode's `C-u` prefix flow.
- [ ] Apply normalization variants to Goal type, Context, Auto, Compute, Search, and Constraints.

## Constraints and Metas

Goal: expose constraints and metas only where they help learning and debugging
single-file exercises.

- [ ] Implement Show constraints using `Cmd_constraints`.
- [ ] Implement Solve one constraint using `Cmd_solveOne`.
- [ ] Implement Solve all constraints using `Cmd_solveAll`.
- [ ] Implement Show goals/metas using `Cmd_metas`.
- [ ] Display constraints in a structured panel.
- [ ] Handle Agda version differences in command syntax.

## Playground UX and Teaching Examples

Goal: the default experience should support demos and short practice sessions.

- [x] Add a small example picker for built-in single-file examples.
- [x] Move the example picker into the editor header as a compact selector.
- [x] Include examples for natural numbers, case split, auto, refine, queries, Cubical import, and standard-library import.
- [x] Keep examples as single buffers, not as multi-file projects.
- [x] Apply selected examples immediately without a separate example load or reset button.
- [ ] Keep debug output hidden by default.
- [ ] Make shortcut help easier to scan for beginners.

## Browser Regression Suite

Goal: common playground workflows should be repeatable by AI coding agents and humans.

- [x] Add reusable Agda fixtures under `test-fixtures/agda/`.
- [x] Add shared `agent-browser` helper functions.
- [x] Add browser regression script for goal lifecycle basics.
- [x] Add browser regression script for damaged or partially edited goal boundaries.
- [x] Add browser regression script for Load state refresh across highlighting, diagnostics, warnings, and goals.
- [x] Add browser regression script for the collapsible Commands panel.
- [x] Add browser regression script for the Settings dialog shell.
- [x] Add browser regression script for Auto.
- [x] Add browser regression script for query shortcuts.
- [x] Add browser regression script for command input panel submit, cancel, and focus restore.
- [x] Add browser regression script for active Goals panel details.
- [x] Add browser regression script for Cubical load.
- [x] Add browser regression script for standard-library load.
- [x] Add browser regression script for syntax and semantic error display.
- [x] Expose browser regressions through `package.json` scripts where practical.

## AI-Assisted Workflow and Methodology

Goal: keep AI-assisted development predictable without making the repository
depend on agent-specific tooling.

- [x] Document plugin and MCP usage for this workspace.
- [x] Document lightweight Superpowers-inspired development practices.
- [x] Add spec-first, systematic debugging, verification, and review checklists.
- [ ] Keep workflow documentation synchronized when new browser regressions or
      major development phases are added.

## Implementation Notes

- Prioritize single-file learning workflows over project-oriented IDE features.
- Prioritize goal lifecycle correctness before adding more shortcuts.
- Treat `InteractionPoints` as the source of truth for Agda goal ids.
- Treat CodeMirror document changes as the source of truth for current ranges.
- Always reload after Case split so new holes receive real Agda interaction point ids.
- Avoid command-specific hacks that search raw `{! !}` text without consulting goal state.
- Route all keyboard shortcuts through the shortcut registry once shortcut configuration exists.
- Keep request construction separate from UI event handling.
- Keep response handling separate from editor mutation.
- Use `agda-mode-vscode` as an interaction reference, not as a parity checklist.
- Include browser tests for any editor, shortcut, goal, or panel behavior change.

## References

- [PROJECT_GOAL.md](PROJECT_GOAL.md)
- [docs/AGDA_MODE_VSCODE_MAPPING.md](docs/AGDA_MODE_VSCODE_MAPPING.md)
- https://coq.vercel.app/scratchpad.html
- https://github.com/banacorn/agda-mode-vscode/blob/master/package.json
- https://github.com/banacorn/agda-mode-vscode/blob/master/src/Request.res
- https://github.com/banacorn/agda-mode-vscode/blob/master/src/Goals.res
- https://github.com/banacorn/agda-mode-vscode/blob/master/src/State/State__Command.res
- https://github.com/banacorn/agda-mode-vscode/blob/master/src/State/State__Response.res
