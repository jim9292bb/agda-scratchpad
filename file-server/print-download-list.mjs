/**
 * Prints the list of (url, destination filename, destination subdir) tuples
 * that `npm run setup` needs to download for this deployment's configured
 * ALS versions and libraries (deploy.config.mjs). Consumed by
 * scripts/download-assets.sh.
 *
 * Output: one "URL<TAB>filename<TAB>subdir" tuple per line, deduplicated by
 * filename. subdir is "library" or "als" — see scripts/download-assets.sh
 * and file-server/README.md for what lives where.
 */

import { getSelectedAlsVersions, getSelectedLibraries } from './resolve-deploy-config.mjs'

const seen = new Map()
function add(url, filename, subdir) {
  if (!url || !filename) return
  seen.set(filename, { url, subdir })
}

for (const als of getSelectedAlsVersions()) {
  add(als.wasmUrl, als.wasmFilename, 'als')
  add(als.dataZipUrl, als.dataZipName, 'als')
}

for (const lib of getSelectedLibraries()) {
  add(lib.sourceArchiveUrl, lib.sourceZipName, 'library')
  add(lib.agdaiZipUrl, lib.agdaiZipName, 'library')
}

for (const [filename, { url, subdir }] of seen) {
  console.log(`${url}\t${filename}\t${subdir}`)
}
