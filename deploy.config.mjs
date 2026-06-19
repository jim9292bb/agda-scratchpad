/**
 * Single source of truth for which ALS/Agda versions and library
 * combinations this deployment bundles. Self-deployers: fork this repo and
 * edit this file, then run `npm run setup && npm run build` to produce a
 * deployment with your chosen combination.
 *
 * Defaults match this project's own deployment (ALS 2.8.0 with Standard
 * Library v2.3 + Cubical v0.9) — editing this file does not change anything
 * unless you also change the values below.
 *
 * Schema:
 *   - alsVersions: which ALS/Agda WASM versions to bundle. Each must have a
 *     matching entry in file-server/als-catalog.mjs.
 *   - librarySets: which library combinations to offer end users, and which
 *     bundled ALS version(s) each combination works with. Each library
 *     reference (name + version) must have a matching entry in
 *     file-server/libraries.mjs.
 *
 * You are responsible for verifying that the libraries within one
 * `librarySet` are actually compatible with each other (same underlying
 * type theory — e.g. don't mix a Cubical library with a non-Cubical one —
 * and no conflicting transitive version requirements, e.g. two different
 * stdlib versions). Nothing here checks this automatically. See ROADMAP.md
 * "Curated Multi-Library Support" for context and known compatibility
 * concerns between candidate libraries (agda-categories, plfa,
 * agda-unimath, 1lab).
 */

export const DEPLOY_CONFIG = {
  alsVersions: ['2.8.0'],

  librarySets: [
    {
      id: 'stdlib-2.3-cubical-0.9',
      label: 'Standard Library v2.3 + Cubical v0.9',
      libraries: [
        { name: 'stdlib', version: '2.3' },
        { name: 'cubical', version: '0.9' },
      ],
      compatibleAlsVersions: ['2.8.0'],
    },
  ],
}
