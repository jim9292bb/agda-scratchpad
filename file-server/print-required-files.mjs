/**
 * Verifies file-server/{library,als}/ contains everything the currently
 * configured deploy.config.mjs needs, before scripts/setup-assets.sh zips
 * and copies it into static/. Prints MISSING: lines for anything absent
 * and exits non-zero if anything required is missing.
 *
 * Per library: its .agda-lib file (required — confirms the library's
 * source was placed at all) and its _build/ prebuilt .agdai cache
 * (optional, like agdaiCacheVersion itself — without it the library still
 * works, just without prefetching/caching).
 *
 * Per ALS version: its wasm file (required) and its agda-data/ directory
 * (optional, mirroring dataZipName being optional on the catalog).
 *
 * Each library's own dependency graph
 * (file-server/library/<name>/agdai-manifest.json) is always optional —
 * prefetch.js degrades gracefully per library without one.
 *
 * Usage: node file-server/print-required-files.mjs
 */

import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, getSelectedAlsVersions, getSelectedLibraries } from './resolve-deploy-config.mjs'

const FILE_SERVER = join(REPO_ROOT, 'file-server')

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function main() {
  let missing = false

  for (const lib of getSelectedLibraries()) {
    const libRoot = join(FILE_SERVER, 'library', lib.name)
    const agdaLibPath = join(libRoot, lib.agdaLibFile)
    if (!(await exists(agdaLibPath))) {
      console.error(`MISSING: file-server/library/${lib.name}/${lib.agdaLibFile}`)
      missing = true
    }
    if (lib.agdaiCacheVersion && !(await exists(join(libRoot, '_build')))) {
      console.log(`(optional, not found) file-server/library/${lib.name}/_build/ — no prebuilt .agdai cache, will type-check from source`)
    }
    if (!(await exists(join(libRoot, 'agdai-manifest.json')))) {
      console.log(`(optional, not found) file-server/library/${lib.name}/agdai-manifest.json — prefetch disabled for this library, .agdai files still load on demand`)
    }
  }

  for (const als of getSelectedAlsVersions()) {
    const wasmPath = join(FILE_SERVER, 'als', als.wasmFilename)
    if (!(await exists(wasmPath))) {
      console.error(`MISSING: file-server/als/${als.wasmFilename}`)
      missing = true
    }
    if (als.dataZipName && !(await exists(join(FILE_SERVER, 'als', 'agda-data')))) {
      console.log('(optional, not found) file-server/als/agda-data/ — ALS will run without prebuilt Agda builtin data')
    }
  }

  if (missing) {
    console.error('')
    console.error('Some required library/ALS files are missing. Either:')
    console.error("  - run 'npm run auto-configure' to fetch this project's own shipped defaults, or")
    console.error('  - place them by hand in file-server/library/<name>/ or file-server/als/ (see file-server/README.md)')
    process.exit(1)
  }
}

main()
