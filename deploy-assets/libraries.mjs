/**
 * Catalog of all library versions this project knows how to build a `.agdai`
 * cache and dependency manifest for, and how to register at runtime in the
 * browser VFS. A deployment's `deploy.config.mjs` picks a subset (via
 * `profiles[].libraries`) to actually bundle; catalog entries not referenced
 * by any configured profile are simply not built.
 *
 * This catalog is pure metadata — it does not say where to download a
 * library's files from. What you place is a raw, unzipped library source
 * tree at `deploy-assets/library/<name>/` (plus an optional raw `_build/`
 * with prebuilt `.agdai` files) — either by hand, or via
 * `npm run auto-configure` for this project's own shipped defaults (a
 * separate, hardcoded script — see `deploy-assets/auto-configure.mjs`).
 * `npm run setup` (`deploy-assets/build-static-assets.mjs`) then zips that
 * raw tree into `static/library/<sourceZipName>` — see findLibrary() below,
 * not a field you write yourself. See deploy-assets/README.md.
 *
 * Each entry needs:
 *   - name, version: identify the entry; deploy.config.mjs references libraries
 *     by this pair. Also the expected directory name under
 *     `deploy-assets/library/`. (The runtime's in-memory `libKey` — used to
 *     key the prefetch manifest cache — is just `${name}@${version}`,
 *     computed on the fly; not a separate field here. `sourceZipName` and
 *     `archiveRootPrefix` are also derived from `name`/`version` —
 *     see findLibrary() — rather than written here, since their exact
 *     text carries no meaning: `sourceZipName` only needs to be unique,
 *     which `name`+`version` already guarantees; `archiveRootPrefix` only
 *     needs to be non-empty, which any derived value satisfies.)
 *   - includeSubpath: matches the library's own `.agda-lib`'s `include:`
 *     field (empty string if `include: .`). Only paths under this subpath,
 *     plus agdaLibFile itself, are kept when extracting into the VFS.
 *   - agdaLibFile: the `.agda-lib` filename at the library's root.
 *   - libraryName: the exact `name:` value declared inside that `.agda-lib`
 *     (used verbatim in the VFS's `~/.config/agda/libraries`/`defaults`).
 *
 * There is no `optionsPragma`/`flags` field here for dependency-graph
 * generation — that's not something this project produces at all
 * anymore. Regenerating a library's dependency graph means writing your
 * own Everything.agda-style file(s) (with whatever `{-# OPTIONS #-}` they
 * need — not always the same as the library's own `.agda-lib` `flags:`,
 * confirmed empirically that `.agda-lib` flags don't apply to a
 * hand-written Everything.agda) and running native `agda` yourself — see
 * deploy-assets/README.md "Regenerating the dependency graph" (you'll
 * still read `agdaLibFile`/`includeSubpath` from this catalog by hand to
 * do that, but no script does it for you, and there's no field here for
 * the pragma decision itself).
 *
 * Adding a library/version that follows the same shape as stdlib/cubical
 * (one `.agda-lib` at the source root) should only require a new entry
 * here plus the raw source placed under `deploy-assets/library/<name>/` (see
 * deploy-assets/README.md). See ROADMAP.md "Curated Multi-Library Support"
 * before adding plfa/agda-unimath/1lab — their exact `.agda-lib` layout and
 * type-theory compatibility with existing entries hasn't been confirmed yet.
 */

export const LIBRARY_CATALOG = [
  {
    name: 'stdlib',
    version: '2.3',
    includeSubpath: 'src',
    agdaLibFile: 'standard-library.agda-lib',
    libraryName: 'standard-library-2.3',
    // The Agda interface-format version the prebuilt .agdai cache was built
    // with (see experiments/build-library) — i.e. the version subdirectory
    // under static/agdai/stdlib/_build/. Not necessarily the same as any
    // particular session's active ALS version; a mismatch just means a
    // slower from-source recompile instead of a cache hit, not an error.
    agdaiCacheVersion: '2.8.0',
  },
  {
    name: 'cubical',
    version: '0.9',
    includeSubpath: '',
    agdaLibFile: 'cubical.agda-lib',
    libraryName: 'cubical-0.9',
    agdaiCacheVersion: '2.8.0',
  },
  {
    name: 'agda-categories',
    version: '0.3.0',
    includeSubpath: 'src',
    agdaLibFile: 'agda-categories.agda-lib',
    libraryName: 'agda-categories',
    // Targets Agda 2.8.0 + standard-library-2.3 (per the v0.3.0 release notes).
    agdaiCacheVersion: '2.8.0',
  },
]

/**
 * @param {string} name
 * @param {string} version
 */
export function findLibrary(name, version) {
  const lib = LIBRARY_CATALOG.find(l => l.name === name && l.version === version)
  if (!lib) {
    throw new Error(`no catalog entry for ${name}@${version} in deploy-assets/libraries.mjs`)
  }
  return {
    ...lib,
    // Derived, not written by hand: sourceZipName only needs to be unique
    // (name+version already guarantees that), archiveRootPrefix only needs
    // to be non-empty (see the header comment above) — neither value's
    // exact text matters, so there's nothing to write/get-wrong by hand.
    sourceZipName: `${lib.name}-${lib.version}.zip`,
    archiveRootPrefix: lib.name,
  }
}
