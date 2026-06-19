/**
 * Resolves deploy.config.mjs against the library/ALS catalogs, validating
 * every reference up front so a typo in deploy.config.mjs fails fast with a
 * clear error instead of silently building the wrong thing.
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { DEPLOY_CONFIG } from '../deploy.config.mjs'
import { findLibrary } from './libraries.mjs'
import { findAls } from './als-catalog.mjs'

export { DEPLOY_CONFIG }

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Resolved ALS catalog entries for every version listed in deploy.config.mjs. */
export function getSelectedAlsVersions() {
  return DEPLOY_CONFIG.alsVersions.map(findAls)
}

/** Resolved, deduplicated library catalog entries referenced by any configured librarySet. */
export function getSelectedLibraries() {
  const seen = new Map()
  for (const set of DEPLOY_CONFIG.librarySets) {
    for (const { name, version } of set.libraries) {
      const key = `${name}@${version}`
      if (!seen.has(key)) seen.set(key, findLibrary(name, version))
    }
  }
  return [...seen.values()]
}

// Validate every librarySet's compatibleAlsVersions against alsVersions up front.
for (const set of DEPLOY_CONFIG.librarySets) {
  for (const alsVersion of set.compatibleAlsVersions) {
    if (!DEPLOY_CONFIG.alsVersions.includes(alsVersion)) {
      throw new Error(
        `deploy.config.mjs: librarySet "${set.id}" lists compatibleAlsVersions "${alsVersion}", ` +
        `but that version is not in alsVersions: ${JSON.stringify(DEPLOY_CONFIG.alsVersions)}`)
    }
  }
}
