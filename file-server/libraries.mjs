/**
 * Catalog of all library versions this project knows how to build a `.agdai`
 * cache and dependency manifest for, and how to register at runtime in the
 * browser VFS. A deployment's `deploy.config.mjs` picks a subset (via
 * `profiles[].libraries`) to actually bundle; catalog entries not referenced
 * by any configured profile are simply not built.
 *
 * This catalog is pure metadata — it does not say where to download a
 * library's files from. Whatever a configured entry needs
 * (`sourceZipName`, `agdaiZipName`) must already exist under
 * `static/library/` by the time `npm run setup` runs — either because
 * `npm run auto-configure` fetched this project's own shipped defaults
 * (a separate, hardcoded script — see `scripts/auto-configure.sh`), or
 * because you placed the file there by hand. See file-server/README.md.
 *
 * Each entry needs:
 *   - name, version: identify the entry; deploy.config.mjs references libraries
 *     by this pair.
 *   - libKey: short tag stored in the runtime prefetch manifest.
 *   - sourceZipName: the expected filename under `static/library/`.
 *   - archiveRootPrefix: the single top-level folder inside the source
 *     archive (e.g. GitHub tag-archive zips extract into `<repo>-<tag>/`).
 *     Stripped when extracting into the VFS.
 *   - includeSubpath: matches the library's own `.agda-lib`'s `include:`
 *     field (empty string if `include: .`). Only paths under this subpath,
 *     plus agdaLibFile itself, are kept when extracting into the VFS.
 *   - agdaLibFile: the `.agda-lib` filename at the archive root.
 *   - libraryName: the exact `name:` value declared inside that `.agda-lib`
 *     (used verbatim in the VFS's `~/.config/agda/libraries`/`defaults`).
 *   - agdaiZipName: the expected filename (under `static/library/`) of a
 *     prebuilt `.agdai` cache zip, tied to a specific ALS/Agda version it
 *     was compiled with (currently always 2.8.0 — see
 *     experiments/build-library). Optional: without it, the library still
 *     works, but type-checks from source on every load instead of using a
 *     cache.
 *   - optionsPragma: the `{-# OPTIONS #-}` line needed to scope-check the
 *     library's generated Everything.agda (file-server/generate-manifest.mjs
 *     only; not used at runtime, which reads the library's own flags via its
 *     registered `.agda-lib`).
 *
 * Adding a library/version that follows the same shape as stdlib/cubical
 * (one `.agda-lib` at the source archive root) should only require a new
 * entry here plus the actual file under `static/library/` (see
 * file-server/README.md). See ROADMAP.md "Curated Multi-Library Support"
 * before adding plfa/agda-unimath/1lab — their exact `.agda-lib` layout and
 * type-theory compatibility with existing entries hasn't been confirmed yet.
 */

export const LIBRARY_CATALOG = [
  {
    name: 'stdlib',
    version: '2.3',
    libKey: 's',
    sourceZipName: 'agda-stdlib-2.3.zip',
    archiveRootPrefix: 'agda-stdlib-2.3',
    includeSubpath: 'src',
    agdaLibFile: 'standard-library.agda-lib',
    libraryName: 'standard-library-2.3',
    // The Agda interface-format version the prebuilt .agdai cache was built
    // with (see experiments/build-library) — i.e. the version subdirectory
    // under static/agdai/stdlib/_build/. Not necessarily the same as any
    // particular session's active ALS version; a mismatch just means a
    // slower from-source recompile instead of a cache hit, not an error.
    agdaiCacheVersion: '2.8.0',
    agdaiZipName: 'stdlib-agdai.zip',
    optionsPragma: '{-# OPTIONS --rewriting --guardedness --sized-types #-}',
  },
  {
    name: 'cubical',
    version: '0.9',
    libKey: 'c',
    sourceZipName: 'agda-cubical-0.9.zip',
    archiveRootPrefix: 'cubical-0.9',
    includeSubpath: '',
    agdaLibFile: 'cubical.agda-lib',
    libraryName: 'cubical-0.9',
    agdaiCacheVersion: '2.8.0',
    agdaiZipName: 'cubical-agdai.zip',
    optionsPragma: '{-# OPTIONS --cubical --guardedness #-}',
  },
  {
    name: 'agda-categories',
    version: '0.3.0',
    libKey: 'a',
    sourceZipName: 'agda-categories-0.3.0.zip',
    archiveRootPrefix: 'agda-categories-0.3.0',
    includeSubpath: 'src',
    agdaLibFile: 'agda-categories.agda-lib',
    libraryName: 'agda-categories',
    // Targets Agda 2.8.0 + standard-library-2.3 (per the v0.3.0 release notes).
    agdaiCacheVersion: '2.8.0',
    agdaiZipName: 'agda-categories-agdai.zip',
    //
    // No options here (unlike stdlib/cubical): not every file in this library
    // declares --without-K/--safe (e.g. Categories.Adjoint.Parametric has no
    // pragma at all), so giving the generated Everything.agda either flag
    // trips Agda's coinfective check (CoInfectiveImport) against those files.
    optionsPragma: '',
  },
]

/**
 * @param {string} name
 * @param {string} version
 */
export function findLibrary(name, version) {
  const lib = LIBRARY_CATALOG.find(l => l.name === name && l.version === version)
  if (!lib) {
    throw new Error(`no catalog entry for ${name}@${version} in file-server/libraries.mjs`)
  }
  return lib
}
