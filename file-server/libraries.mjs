/**
 * Catalog of all library versions this project knows how to build a `.agdai`
 * cache and dependency manifest for. A deployment's `deploy.config.mjs` picks
 * a subset (via `librarySets`) to actually bundle; catalog entries that
 * aren't referenced by any configured `librarySet` are simply not built.
 *
 * Each entry needs:
 *   - name, version: identify the entry; deploy.config.mjs references libraries
 *     by this pair.
 *   - libKey: short tag stored in the runtime prefetch manifest.
 *   - sourceArchiveUrl: where to download the library's source from.
 *   - sourceZipName: the local filename in static/ after download.
 *   - agdaiZipUrl / agdaiZipName: a prebuilt `.agdai` cache zip and where to
 *     download it from, tied to a specific ALS/Agda version it was compiled
 *     with (currently always 2.8.0 — see experiments/build-library). Both
 *     optional together: without them, the library still works, but
 *     type-checks from source on every load instead of using a cache.
 *   - optionsPragma: the `{-# OPTIONS #-}` line needed to scope-check the
 *     library's generated Everything.agda.
 *
 * Adding a library/version that follows the same shape as stdlib/cubical
 * (one `.agda-lib` at the source archive root) should only require a new
 * entry here. See ROADMAP.md "Curated Multi-Library Support" before adding
 * agda-categories/plfa/agda-unimath/1lab — their exact `.agda-lib` layout and
 * type-theory compatibility with existing entries hasn't been confirmed yet.
 */

const CACHE_2_8_0 = 'https://github.com/jim9292bb/agda-scratchpad/releases/download/cache-2.8.0'

export const LIBRARY_CATALOG = [
  {
    name: 'stdlib',
    version: '2.3',
    libKey: 's',
    sourceArchiveUrl: 'https://github.com/agda/agda-stdlib/archive/refs/tags/v2.3.zip',
    sourceZipName: 'agda-stdlib-2.3.zip',
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
    agdaiZipUrl: `${CACHE_2_8_0}/cubical-agdai.zip`,
    agdaiZipName: 'cubical-agdai.zip',
    optionsPragma: '{-# OPTIONS --cubical --guardedness #-}',
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
