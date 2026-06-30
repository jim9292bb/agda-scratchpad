/**
 * Resolves the two deploy config files into validated, ready-to-use
 * library and ALS-version records that all deploy-time scripts consume.
 *
 * deploy.config.json  (committed) — profiles and ALS version info; no
 *                     OS-specific paths; imported by the TypeScript
 *                     bundle (interface.ts) as well.
 *
 * deploy.local.json   (gitignored, created from deploy.local.example.json)
 *                     — per-library { name, agdaLibPath, useAgdai }.
 *                     Only read by Node.js deploy scripts, never bundled.
 *                     Optional: if absent, getLocalLibraries() returns [].
 *
 * deploy-assets/.cache/index.json  (gitignored, auto-managed here) —
 *                     maps each agdaLibPath to a stable random cache-dir
 *                     ID so generated .agdai and manifests persist across
 *                     runs even if deploy.local.json is recreated.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import DEPLOY_CONFIG from '../deploy.config.json' with { type: 'json' }

export { DEPLOY_CONFIG }

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const CACHE_DIR = join(REPO_ROOT, 'deploy-assets', '.cache')
const INDEX_PATH = join(CACHE_DIR, 'index.json')

// ── deploy.local.json ─────────────────────────────────────────────────────────

function readLocalConfig() {
  try {
    return JSON.parse(readFileSync(join(REPO_ROOT, 'deploy.local.json'), 'utf8'))
  } catch {
    return { libraries: [] }
  }
}

// ── Cache index management ────────────────────────────────────────────────────
// Maps agdaLibPath → 8-char random hex ID (stable once assigned).

function readCacheIndex() {
  try {
    return JSON.parse(readFileSync(INDEX_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function writeCacheIndex(index) {
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n')
}

/** Returns the stable cache ID for `agdaLibPath`, assigning a new one if needed. */
function ensureCacheId(agdaLibPath, index) {
  if (!index[agdaLibPath]) {
    index[agdaLibPath] = randomBytes(4).toString('hex')
    return true // dirty
  }
  return false
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Deduplicated ALS versions referenced by any configured profile.
 * Throws if the same alsVersion is used with two different wasmFilenames.
 */
export function getSelectedAlsVersions() {
  const seenRaw = new Map()
  const resolved = new Map()
  for (const profile of DEPLOY_CONFIG.profiles) {
    const { alsVersion, wasmFilename } = profile
    const prev = seenRaw.get(alsVersion)
    if (prev && prev !== wasmFilename) {
      throw new Error(`deploy.config.json: alsVersion "${alsVersion}" is referenced with two different wasmFilename values (${prev} vs ${wasmFilename})`)
    }
    if (!prev) {
      seenRaw.set(alsVersion, wasmFilename)
      resolved.set(alsVersion, { version: alsVersion, wasmFilename })
    }
  }
  return [...resolved.values()]
}

/**
 * All libraries that appear in any profile AND have an entry in
 * deploy.local.json with a non-empty agdaLibPath. Each entry has:
 *   name        — the .agda-lib `name:` value (identifier + static-asset key)
 *   agdaLibPath — absolute OS path to the .agda-lib file
 *   useAgdai    — whether to generate/serve .agdai cache (default false)
 *   cacheId     — stable random ID for deploy-assets/.cache/<cacheId>/
 *   cacheDir    — absolute path to that cache directory
 *
 * Also prunes any index entry whose agdaLibPath is no longer in
 * deploy.local.json, to keep the index tidy.
 */
export function getLocalLibraries() {
  const local = readLocalConfig()
  const index = readCacheIndex()
  let dirty = false

  // All library names referenced in any profile
  const profileNames = new Set()
  for (const profile of DEPLOY_CONFIG.profiles) {
    for (const lib of profile.libraries) profileNames.add(lib.name)
  }

  const localByName = new Map(local.libraries.map(l => [l.name, l]))
  const activeAgdaLibPaths = new Set()
  const result = []

  for (const name of profileNames) {
    const entry = localByName.get(name)
    if (!entry?.agdaLibPath) continue
    activeAgdaLibPaths.add(entry.agdaLibPath)
    if (ensureCacheId(entry.agdaLibPath, index)) dirty = true
    result.push({
      name,
      agdaLibPath: entry.agdaLibPath,
      useAgdai: entry.useAgdai ?? false,
      cacheId: index[entry.agdaLibPath],
      cacheDir: join(CACHE_DIR, index[entry.agdaLibPath]),
    })
  }

  // Prune stale index entries
  for (const path of Object.keys(index)) {
    if (!activeAgdaLibPaths.has(path)) {
      delete index[path]
      dirty = true
    }
  }

  if (dirty) writeCacheIndex(index)
  return result
}
