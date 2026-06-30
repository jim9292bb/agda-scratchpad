/**
 * Verifies that everything needed for `npm run setup` is present:
 *   - Each configured library's .agda-lib file (confirms the source is
 *     reachable at the agdaLibPath in deploy.local.json).
 *   - Each ALS version's wasm file (confirmed to report the expected version
 *     via --version) and agda-data/ directory.
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
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { REPO_ROOT, getLocalLibraries, getSelectedAlsVersions } from './resolve-deploy-config.mjs'

const DEPLOY_ASSETS = join(REPO_ROOT, 'deploy-assets')
const RUN_ALS_VERSION_SCRIPT = join(DEPLOY_ASSETS, 'run-als-version.mjs')

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function tryGetWasmVersionString(wasmPath) {
  try {
    return execFileSync(process.execPath, [RUN_ALS_VERSION_SCRIPT, wasmPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

async function main() {
  let missing = false
  const libs = getLocalLibraries()

  if (libs.length === 0) {
    console.error('No libraries configured — create deploy.local.json from deploy.local.example.json and set agdaLibPath for each library.')
    process.exit(1)
  }

  for (const lib of libs) {
    if (!(await exists(lib.agdaLibPath))) {
      console.error(`MISSING: ${lib.agdaLibPath}  (library "${lib.name}" — check agdaLibPath in deploy.local.json)`)
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
    } else {
      const versionString = tryGetWasmVersionString(wasmPath)
      if (!versionString || !versionString.includes(`Agda v${als.version}`)) {
        console.error(`MISMATCH: deploy-assets/als/${als.version}/${als.wasmFilename} reports itself as "${versionString ?? '(could not run it)'}", but deploy.config.json's alsVersion for it is "${als.version}" — these must match.`)
        missing = true
      }
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
    console.error('  - configure deploy.local.json with paths to your installed libraries (see deploy.local.example.json)')
    process.exit(1)
  }
}

main()
