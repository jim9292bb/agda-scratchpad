/**
 * Prints the list of (filename, destination subdir) pairs that need to
 * exist under static/{library,als}/ for this deployment's configured ALS
 * versions and libraries (deploy.config.mjs) to actually work.
 *
 * Output: one "filename<TAB>subdir" pair per line, deduplicated by
 * filename. subdir is "library" or "als" — see scripts/setup-assets.sh
 * and file-server/README.md for what lives where.
 *
 * This does not say where to get those files from — see
 * file-server/README.md for the two ways: `npm run auto-configure`
 * (fetches this project's own shipped defaults) or placing them by hand.
 * Consumed by scripts/setup-assets.sh to verify everything needed is
 * actually present before declaring success.
 */

import { getSelectedAlsVersions, getSelectedLibraries } from './resolve-deploy-config.mjs'

const seen = new Map()
function add(filename, subdir) {
  if (!filename) return
  seen.set(filename, subdir)
}

for (const als of getSelectedAlsVersions()) {
  add(als.wasmFilename, 'als')
  add(als.dataZipName, 'als')
}

for (const lib of getSelectedLibraries()) {
  add(lib.sourceZipName, 'library')
  add(lib.agdaiZipName, 'library')
}

for (const [filename, subdir] of seen) {
  console.log(`${filename}\t${subdir}`)
}
