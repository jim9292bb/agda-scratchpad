/**
 * Prints the list of (url, destination filename) pairs that `npm run setup`
 * needs to download for this deployment's configured ALS versions and
 * libraries (deploy.config.mjs). Consumed by scripts/download-assets.sh.
 *
 * Output: one "URL<TAB>filename" pair per line, deduplicated by filename.
 */

import { getSelectedAlsVersions, getSelectedLibraries } from './resolve-deploy-config.mjs'

const seen = new Map()
function add(url, filename) {
  if (!url || !filename) return
  seen.set(filename, url)
}

for (const als of getSelectedAlsVersions()) {
  add(als.wasmUrl, als.wasmFilename)
  add(als.dataZipUrl, als.dataZipName)
}

for (const lib of getSelectedLibraries()) {
  add(lib.sourceArchiveUrl, lib.sourceZipName)
  add(lib.agdaiZipUrl, lib.agdaiZipName)
}

for (const [filename, url] of seen) {
  console.log(`${url}\t${filename}`)
}
