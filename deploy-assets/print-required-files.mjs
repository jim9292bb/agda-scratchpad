/**
 * Verifies that everything needed for `npm run setup` is present:
 *   - Each configured library's .agda-lib file (confirms the source is
 *     reachable at the agdaLibPath in deploy.config.json).
 *   - Each ALS version's wasm file and agda-data/ directory.
 *
 * Libraries with useAgdai: true that are missing their cache (.agdai files
 * or manifest) get a non-fatal warning — the library still works, just
 * without prefetching.
 *
 * Exits non-zero if any required file is missing.
 *
 * Usage: node deploy-assets/print-required-files.mjs
 */

import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, getLocalLibraries, getSelectedAlsVersions } from './resolve-deploy-config.mjs'

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
  const libs = getLocalLibraries()

  if (libs.length === 0) {
    console.error('No libraries configured — set agdaLibPath in each profile\'s libraries in deploy.config.json.')
    process.exit(1)
  }

  for (const lib of libs) {
    if (!(await exists(lib.agdaLibPath))) {
      console.error(`MISSING: ${lib.agdaLibPath}  (library "${lib.name}" — check agdaLibPath in deploy.config.json)`)
      missing = true
    }

    if (lib.useAgdai) {
      if (!(await exists(join(lib.cacheDir, '_build')))) {
        console.log(`(optional, not found) .cache/${lib.cacheId}/_build/ for "${lib.name}" — no prebuilt .agdai, run \`npm run build-agdai\``)
      }
      if (!(await exists(join(lib.cacheDir, 'agdai-manifest.json')))) {
        console.log(`(optional, not found) .cache/${lib.cacheId}/agdai-manifest.json for "${lib.name}" — prefetch disabled, run \`npm run generate-manifest\``)
      }
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
    console.error('Some required files are missing. Either:')
    console.error("  - run 'npm run auto-configure' to fetch this project's own shipped defaults, or")
    console.error('  - set agdaLibPath in deploy.config.json (see deploy.config.example.json) and run npm run install-als')
    process.exit(1)
  }
}

main()
