/**
 * Verifies deploy-assets/{library,als}/ contains everything the currently
 * configured deploy.config.json needs, before scripts/setup-assets.sh zips
 * and copies it into static/. Prints MISSING: lines for anything absent
 * and exits non-zero if anything required is missing.
 *
 * Per library: its .agda-lib file (required — confirms the library's
 * source was placed at all) and its _build/ prebuilt .agdai cache
 * (optional — without it the library still works, just without
 * prefetching/caching; which version it was built for is detected live
 * at runtime by parsing the running ALS's own `--version` output, not
 * declared here).
 *
 * Per ALS version (each isolated under deploy-assets/als/<version>/ — see
 * deploy-assets/README.md "What to place" for why): its wasm file
 * (required, and actually run with `--version` via Node's own WASI to
 * confirm it reports itself as the alsVersion you configured it under —
 * the directory name alone is just a string you typed; this catches the
 * wasm file itself being the wrong build) and its agda-data/ directory
 * (required), both for every version.
 *
 * Each library's own dependency graph
 * (deploy-assets/library/<folderName>/agdai-manifest.json) is always
 * optional — prefetch.js degrades gracefully per library without one.
 *
 * Usage: node deploy-assets/print-required-files.mjs
 */

import { access } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { REPO_ROOT, getSelectedAlsVersions, getSelectedLibraries } from './resolve-deploy-config.mjs'

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

/**
 * Runs a placed `als` wasm with `--version` (in a child process — see
 * run-als-version.mjs's own header comment for why) and returns its
 * stdout, or null if it couldn't be run at all (corrupt file, wrong
 * architecture, etc).
 */
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

  for (const lib of getSelectedLibraries()) {
    const libRoot = join(DEPLOY_ASSETS, 'library', lib.folderName)
    const agdaLibPath = join(libRoot, lib.agdaLibFile)
    if (!(await exists(agdaLibPath))) {
      console.error(`MISSING: deploy-assets/library/${lib.folderName}/${lib.agdaLibFile}`)
      missing = true
    }
    if (!(await exists(join(libRoot, '_build')))) {
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
    } else {
      const versionString = tryGetWasmVersionString(wasmPath)
      if (!versionString || !versionString.includes(`Agda v${als.version}`)) {
        console.error(`MISMATCH: deploy-assets/als/${als.version}/${als.wasmFilename} reports itself as "${versionString ?? '(could not run it)'}", but deploy.config.json's alsVersion for it is "${als.version}" — these must match. Place the right wasm build under deploy-assets/als/${als.version}/.`)
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
    console.error('Some required library/ALS files are missing. Either:')
    console.error("  - run 'npm run auto-configure' to fetch this project's own shipped defaults, or")
    console.error('  - place them by hand in deploy-assets/library/<folderName>/ or deploy-assets/als/ (see deploy-assets/README.md)')
    process.exit(1)
  }
}

main()
