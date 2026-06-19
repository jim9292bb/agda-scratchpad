/**
 * Catalog of ALS/Agda WASM builds this project knows how to fetch and run.
 * A deployment's `deploy.config.mjs` picks a subset (`alsVersions`) to bundle.
 *
 * Library/ALS version compatibility is declared the other way around, on
 * each `librarySet` in `deploy.config.mjs` (`compatibleAlsVersions`), not
 * here — that's the single place deployers configure compatibility.
 */

const NIGHTLY = 'https://github.com/agda-web/agda-language-server/releases/download/nightly-20260407'
// agda-data.zip currently only contains a .agdai cache built for Agda 2.8.0's
// interface format (see src/lib/runtime/interface.ts); other versions still
// list it below to preserve existing behavior, but it won't speed them up.
const DATA_ZIP_URL = 'https://github.com/jim9292bb/agda-scratchpad/releases/download/cache-2.8.0/agda-data.zip'

export const ALS_CATALOG = [
  {
    version: '2.6.4.3',
    wasmUrl: `${NIGHTLY}/als-2.6.4.3.wasm`,
    wasmFilename: 'als-2.6.wasm',
    dataZipUrl: DATA_ZIP_URL,
    dataZipName: 'agda-data.zip',
  },
  {
    version: '2.7.0.1',
    wasmUrl: `${NIGHTLY}/als-2.7.0.1.wasm`,
    wasmFilename: 'als-2.7ext.wasm',
    dataZipUrl: DATA_ZIP_URL,
    dataZipName: 'agda-data.zip',
  },
  {
    version: '2.8.0',
    wasmUrl: `${NIGHTLY}/als-2.8.0.wasm`,
    wasmFilename: 'als-2.8ext.wasm',
    dataZipUrl: DATA_ZIP_URL,
    dataZipName: 'agda-data.zip',
  },
]

/** @param {string} version */
export function findAls(version) {
  const entry = ALS_CATALOG.find(e => e.version === version)
  if (!entry) {
    throw new Error(`no catalog entry for ALS ${version} in file-server/als-catalog.mjs`)
  }
  return entry
}
