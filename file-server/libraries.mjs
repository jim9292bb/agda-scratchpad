/**
 * Catalog of all library versions this project knows how to build a `.agdai`
 * cache and dependency manifest for, and how to register at runtime in the
 * browser VFS. A deployment's `deploy.config.mjs` picks a subset (via
 * `profiles[].libraries`) to actually bundle; catalog entries not referenced
 * by any configured profile are simply not built or fetched.
 *
 * Each entry needs:
 *   - name, version: identify the entry; deploy.config.mjs references libraries
 *     by this pair.
 *   - libKey: short tag stored in the runtime prefetch manifest.
 *   - sourceArchiveUrl: where to download the library's source from.
 *   - sourceZipName: the local filename in static/ after download.
 *   - archiveRootPrefix: the single top-level folder inside the source
 *     archive (e.g. GitHub tag-archive zips extract into `<repo>-<tag>/`).
 *     Stripped when extracting into the VFS.
 *   - includeSubpath: matches the library's own `.agda-lib`'s `include:`
 *     field (empty string if `include: .`). Only paths under this subpath,
 *     plus agdaLibFile itself, are kept when extracting into the VFS.
 *   - agdaLibFile: the `.agda-lib` filename at the archive root.
 *   - libraryName: the exact `name:` value declared inside that `.agda-lib`
 *     (used verbatim in the VFS's `~/.config/agda/libraries`/`defaults`).
 *   - agdaiZipUrl / agdaiZipName: a prebuilt `.agdai` cache zip and where to
 *     download it from, tied to a specific ALS/Agda version it was compiled
 *     with (currently always 2.8.0 — see experiments/build-library). Both
 *     optional together: without them, the library still works, but
 *     type-checks from source on every load instead of using a cache.
 *   - optionsPragma: the `{-# OPTIONS #-}` line needed to scope-check the
 *     library's generated Everything.agda (file-server/generate-manifest.mjs
 *     only; not used at runtime, which reads the library's own flags via its
 *     registered `.agda-lib`).
 *
 * Adding a library/version that follows the same shape as stdlib/cubical
 * (one `.agda-lib` at the source archive root) should only require a new
 * entry here. See ROADMAP.md "Curated Multi-Library Support" before adding
 * plfa/agda-unimath/1lab — their exact `.agda-lib` layout and type-theory
 * compatibility with existing entries hasn't been confirmed yet.
 */

const CACHE_2_8_0 = 'https://github.com/jim9292bb/agda-scratchpad/releases/download/cache-2.8.0'

export const LIBRARY_CATALOG = [
  {
    name: 'stdlib',
    version: '2.3',
    libKey: 's',
    sourceArchiveUrl: 'https://github.com/agda/agda-stdlib/archive/refs/tags/v2.3.zip',
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
    agdaiZipUrl: `${CACHE_2_8_0}/stdlib-agdai.zip`,
    agdaiZipName: 'stdlib-agdai.zip',
    optionsPragma: '{-# OPTIONS --rewriting --guardedness --sized-types #-}',
  },
  {
    name: 'cubical',
    version: '0.9',
    libKey: 'c',
    sourceArchiveUrl: 'https://github.com/agda/cubical/archive/refs/tags/v0.9.zip',
    sourceZipName: 'agda-cubical-0.9.zip',
    archiveRootPrefix: 'cubical-0.9',
    includeSubpath: '',
    agdaLibFile: 'cubical.agda-lib',
    libraryName: 'cubical-0.9',
    agdaiCacheVersion: '2.8.0',
    agdaiZipUrl: `${CACHE_2_8_0}/cubical-agdai.zip`,
    agdaiZipName: 'cubical-agdai.zip',
    optionsPragma: '{-# OPTIONS --cubical --guardedness #-}',
  },
  {
    name: 'agda-categories',
    version: '0.3.0',
    libKey: 'a',
    sourceArchiveUrl: 'https://github.com/agda/agda-categories/archive/refs/tags/v0.3.0.zip',
    sourceZipName: 'agda-categories-0.3.0.zip',
    archiveRootPrefix: 'agda-categories-0.3.0',
    includeSubpath: 'src',
    agdaLibFile: 'agda-categories.agda-lib',
    libraryName: 'agda-categories',
    // Targets Agda 2.8.0 + standard-library-2.3 (per the v0.3.0 release notes).
    // No prebuilt .agdai cache yet — agdaiCacheVersion/agdaiZipUrl/agdaiZipName
    // intentionally omitted; it type-checks from source on every load.
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
