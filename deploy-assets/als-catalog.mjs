/**
 * Catalog of ALS/Agda WASM builds this project knows how to fetch and run.
 * A deployment's `deploy.config.mjs` picks a subset (`alsVersions`) to bundle.
 *
 * Library/ALS version compatibility is declared the other way around, on
 * each `librarySet` in `deploy.config.mjs` (`compatibleAlsVersions`), not
 * here — that's the single place deployers configure compatibility.
 *
 * This catalog is pure metadata — it does not say where to download a
 * WASM build from. What you place is
 * `deploy-assets/als/<version>/<wasmFilename>` (a single binary, unchanged)
 * and a raw `deploy-assets/als/<version>/agda-data/` directory — both
 * required for every version, either by hand, or via `npm run
 * auto-configure` for this project's own shipped defaults (a separate,
 * hardcoded script — see `deploy-assets/auto-configure.mjs`). `npm run
 * setup` (`deploy-assets/build-static-assets.mjs`) copies the wasm as-is
 * and zips `agda-data/` into `static/als/<version>/<AGDA_DATA_ZIP_NAME>`.
 * See deploy-assets/README.md.
 *
 * `agda-data/` has no per-entry field for its own output filename — every
 * version's is just `AGDA_DATA_ZIP_NAME` below, since unlike
 * `wasmFilename` (which must stay distinct so multiple versions' wasm
 * binaries can coexist if ever bundled together), each version's
 * `agda-data.zip` already lives under its own `static/als/<version>/`,
 * so there's no collision to avoid naming around.
 *
 * Each version gets its own directory rather than a shared flat one
 * because `agda-data/` (the `Agda.Builtin.*` primitive source files that
 * ship with a given Agda compiler build, plus its matching `.agdai`
 * cache) is not safely interchangeable across versions — a newer
 * compiler's primitive sources can use syntax/BUILTINs an older compiler
 * doesn't recognize, which is a real compile failure, not just a missed
 * cache hit. (The `.agdai` cache itself is safe to share even if it
 * weren't separated like this — it's written under a version-numbered
 * `_build/<version>/` subpath, so a version only ever reads its own; it's
 * the primitive *source* files that need real per-version isolation.)
 * Since agda-data/ is mandatory for every version, there's no optional
 * "does this version even have one" flag to track — if you add a new ALS
 * version, you place its matching agda-data/ too, or `npm run setup`
 * refuses to proceed (see `deploy-assets/print-required-files.mjs`).
 */

export const AGDA_DATA_ZIP_NAME = 'agda-data.zip'

export const ALS_CATALOG = [
  {
    version: '2.6.4.3',
    wasmFilename: 'als-2.6.wasm',
  },
  {
    version: '2.7.0.1',
    wasmFilename: 'als-2.7ext.wasm',
  },
  {
    version: '2.8.0',
    wasmFilename: 'als-2.8ext.wasm',
  },
]

/** @param {string} version */
export function findAls(version) {
  const entry = ALS_CATALOG.find(e => e.version === version)
  if (!entry) {
    throw new Error(`no catalog entry for ALS ${version} in deploy-assets/als-catalog.mjs`)
  }
  return entry
}
