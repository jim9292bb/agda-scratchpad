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

/** Resolved, deduplicated ALS catalog entries referenced by any configured profile. */
export function getSelectedAlsVersions() {
  const seen = new Map()
  for (const profile of DEPLOY_CONFIG.profiles) {
    if (!seen.has(profile.alsVersion)) seen.set(profile.alsVersion, findAls(profile.alsVersion))
  }
  return [...seen.values()]
}

/** Resolved, deduplicated library catalog entries referenced by any configured profile. */
export function getSelectedLibraries() {
  const seen = new Map()
  for (const profile of DEPLOY_CONFIG.profiles) {
    for (const { name, version } of profile.libraries) {
      const key = `${name}@${version}`
      if (!seen.has(key)) seen.set(key, findLibrary(name, version))
    }
  }
  return [...seen.values()]
}
