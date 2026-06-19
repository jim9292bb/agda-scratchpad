/**
 * Library specs shared by extract-agdai.mjs and generate-manifest.mjs.
 * Adding a library here should be enough to extend both scripts — no script
 * changes required for a library that follows the same shape as stdlib/cubical
 * (a prebuilt `.agdai` cache zip in static/, a source archive in static/
 * matching sourceZipPattern, and a single .agda-lib at the archive root).
 *
 * Does not yet support multiple versions of the same library concurrently;
 * see ROADMAP.md "Curated Multi-Library Support".
 */

export const LIBRARIES = [
  {
    name: 'stdlib',
    libKey: 's',
    agdaiZipName: 'stdlib-agdai.zip',
    sourceZipPattern: /^agda-stdlib-.*\.zip$/,
    optionsPragma: '{-# OPTIONS --rewriting --guardedness --sized-types #-}',
  },
  {
    name: 'cubical',
    libKey: 'c',
    agdaiZipName: 'cubical-agdai.zip',
    sourceZipPattern: /^agda-cubical-.*\.zip$/,
    optionsPragma: '{-# OPTIONS --cubical --guardedness #-}',
  },
]
