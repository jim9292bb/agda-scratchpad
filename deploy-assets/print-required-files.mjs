/**
 * Verifies deploy-assets/{library,als}/ contains everything the currently
 * configured deploy.config.mjs needs, before scripts/setup-assets.sh zips
 * and copies it into static/. Prints MISSING: lines for anything absent
 * and exits non-zero if anything required is missing.
 *
 * Per library: its .agda-lib file (required — confirms the library's
 * source was placed at all) and its _build/ prebuilt .agdai cache
 * (optional, like agdaiCacheVersion itself — without it the library still
 * works, just without prefetching/caching).
 *
 * Per ALS version (each isolated under deploy-assets/als/<version>/ — see
 * deploy-assets/als-catalog.mjs for why): its wasm file and its
 * agda-data/ directory, both required for every version.
 *
 * Each library's own dependency graph
 * (deploy-assets/library/<folderName>/agdai-manifest.json) is always
 * optional — prefetch.js degrades gracefully per library without one.
 *
 * Usage: node deploy-assets/print-required-files.mjs
 */

import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, getSelectedAlsVersions, getSelectedLibraries } from './resolve-deploy-config.mjs'

const DEPLOY_ASSETS = join(REPO_ROOT, 'deploy-assets')

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
    const libRoot = join(DEPLOY_ASSETS, 'library', lib.folderName)
    const agdaLibPath = join(libRoot, lib.agdaLibFile)
    if (!(await exists(agdaLibPath))) {
      console.error(`MISSING: deploy-assets/library/${lib.folderName}/${lib.agdaLibFile}`)
      missing = true
    }
    if (lib.agdaiCacheVersion && !(await exists(join(libRoot, '_build')))) {
      console.log(`(optional, not found) deploy-assets/library/${lib.folderName}/_build/ — no prebuilt .agdai cache, will type-check from source`)
    }
    if (!(await exists(join(libRoot, 'agdai-manifest.json')))) {
      console.log(`(optional, not found) deploy-assets/library/${lib.folderName}/agdai-manifest.json — prefetch disabled for this library, .agdai files still load on demand`)
    }
  }

  for (const als of getSelectedAlsVersions()) {
    const alsRoot = join(DEPLOY_ASSETS, 'als', als.version)
    const wasmPath = join(alsRoot, als.wasmFilename)
    if (!(await exists(wasmPath))) {
      console.error(`MISSING: deploy-assets/als/${als.version}/${als.wasmFilename}`)
      missing = true
    }
    if (!(await exists(join(alsRoot, 'agda-data')))) {
      console.error(`MISSING: deploy-assets/als/${als.version}/agda-data/`)
      missing = true
    }
  }

  if (missing) {
    console.error('')
    console.error('Some required library/ALS files are missing. Either:')
    console.error("  - run 'npm run auto-configure' to fetch this project's own shipped defaults, or")
    console.error('  - place them by hand in deploy-assets/library/<name>-<version>/ or deploy-assets/als/ (see deploy-assets/README.md)')
    process.exit(1)
  }
}

main()
