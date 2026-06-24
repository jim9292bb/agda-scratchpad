/**
 * Catalog of ALS/Agda WASM builds this project knows how to fetch and run.
 * A deployment's `deploy.config.mjs` picks a subset (`alsVersions`) to bundle.
 *
 * Library/ALS version compatibility is declared the other way around, on
 * each `librarySet` in `deploy.config.mjs` (`compatibleAlsVersions`), not
 * here — that's the single place deployers configure compatibility.
 *
 * This catalog is pure metadata — it does not say where to download a
 * WASM build from. What you place is `deploy-assets/als/<wasmFilename>` (a
 * single binary, unchanged) and a raw `deploy-assets/als/agda-data/`
 * directory — either by hand, or via `npm run auto-configure` for this
 * project's own shipped defaults (a separate, hardcoded script — see
 * `deploy-assets/auto-configure.mjs`). `npm run setup`
 * (`deploy-assets/build-static-assets.mjs`) copies the wasm as-is and zips
 * `agda-data/` into `static/als/<dataZipName>` — `dataZipName` describes
 * that *output*, not something you place yourself. See
 * deploy-assets/README.md.
 */

// agda-data.zip currently only contains a .agdai cache built for Agda 2.8.0's
// interface format (see src/lib/runtime/interface.ts); other versions still
// list it below to preserve existing behavior, but it won't speed them up.

export const ALS_CATALOG = [
  {
    version: '2.6.4.3',
    wasmFilename: 'als-2.6.wasm',
    dataZipName: 'agda-data.zip',
  },
  {
    version: '2.7.0.1',
    wasmFilename: 'als-2.7ext.wasm',
    dataZipName: 'agda-data.zip',
  },
  {
    version: '2.8.0',
    wasmFilename: 'als-2.8ext.wasm',
    dataZipName: 'agda-data.zip',
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
