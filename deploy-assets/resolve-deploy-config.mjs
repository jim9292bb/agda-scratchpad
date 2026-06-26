/**
 * Resolves deploy.config.mjs — validating it up front so a typo or
 * conflicting reference fails fast with a clear error instead of silently
 * building the wrong thing. ALS versions still cross-reference
 * deploy-assets/als-catalog.mjs; libraries no longer cross-reference a
 * separate catalog — deploy.config.mjs's own `libraries` entries (each a
 * `{ folderName, agdaLibFile, name?, version? }`) are already everything
 * this project's tooling needs structurally. (`includeSubpath`/
 * `libraryName` are not in that shape — they're generated from the real
 * `.agda-lib` content by deploy-assets/generate-library-info.mjs instead,
 * which only the browser runtime needs; see its own header comment.)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { DEPLOY_CONFIG } from '../deploy.config.mjs'
import { findAls } from './als-catalog.mjs'

export { DEPLOY_CONFIG }

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Resolved, deduplicated ALS catalog entries referenced by any configured profile. */
export function getSelectedAlsVersions() {
  const seen = new Map()
  for (const profile of DEPLOY_CONFIG.profiles) {
    if (!seen.has(profile.alsVersion)) seen.set(profile.alsVersion, findAls(profile.alsVersion))
  }
  return [...seen.values()]
}

/**
 * Deduplicated library entries referenced by any configured profile, keyed
 * by folderName — augmented with sourceZipName/archiveRootPrefix (derived
 * from folderName; their exact text doesn't matter, only that
 * sourceZipName is unique and archiveRootPrefix is non-empty, both of
 * which folderName already guarantees).
 *
 * Throws if the same folderName is referenced more than once with a
 * different agdaLibFile/name/version — that would mean two different
 * libraries are trying to share one staging directory.
 */
export function getSelectedLibraries() {
  const seenRaw = new Map()
  const resolved = new Map()
  for (const profile of DEPLOY_CONFIG.profiles) {
    for (const lib of profile.libraries) {
      const prevRaw = seenRaw.get(lib.folderName)
      if (prevRaw && JSON.stringify(prevRaw) !== JSON.stringify(lib)) {
        throw new Error(`deploy.config.mjs: folderName "${lib.folderName}" is referenced with two different specs (${JSON.stringify(prevRaw)} vs ${JSON.stringify(lib)}) — every reference to the same folderName must describe the same library.`)
      }
      if (!prevRaw) {
        seenRaw.set(lib.folderName, lib)
        resolved.set(lib.folderName, {
          ...lib,
          sourceZipName: `${lib.folderName}.zip`,
          archiveRootPrefix: lib.folderName,
        })
      }
    }
  }
  return [...resolved.values()]
}
