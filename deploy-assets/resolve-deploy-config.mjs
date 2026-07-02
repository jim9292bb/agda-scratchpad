/**
 * Resolves deploy.config.json into validated, ready-to-use library and
 * ALS-version records that all deploy-time scripts consume.
 *
 * deploy.config.json  (gitignored, created from deploy.config.example.json)
 *                     — profiles, ALS version info, and per-library
 *                     { agdaLibPath, useAgdai }. Also imported by the
 *                     TypeScript bundle (interface.ts) at build time.
 *                     deploy-assets/ensure-deploy-config.mjs copies the
 *                     example into place automatically on a fresh clone.
 *
 * deploy-assets/.cache/index.json  (gitignored, auto-managed here) —
 *                     maps each agdaLibPath to a stable random cache-dir
 *                     ID so generated .agdai and manifests persist across
 *                     runs even if deploy.config.json is recreated.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseAgdaLibName } from './agda-lib-utils.mjs'

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const CACHE_DIR = join(REPO_ROOT, 'deploy-assets', '.cache')
const INDEX_PATH = join(CACHE_DIR, 'index.json')

// ── deploy.config.json ────────────────────────────────────────────────────────

function readDeployConfig() {
  try {
    return JSON.parse(readFileSync(join(REPO_ROOT, 'deploy.config.json'), 'utf8'))
  } catch {
    return { profiles: [], libraries: [] }
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
 * Deduplicated ALS names referenced by any configured profile.
 * wasmFilename is discovered by scanning deploy-assets/als/<als>/ for a .wasm file.
 * Returns { version: alsName, wasmFilename } pairs.
 */
export function getSelectedAlsVersions() {
  const { profiles } = readDeployConfig()
  const seen = new Set()
  const result = []
  for (const profile of profiles) {
    const { als } = profile
    if (!als || seen.has(als)) continue
    seen.add(als)
    const alsDir = join(REPO_ROOT, 'deploy-assets', 'als', als)
    let wasmFilename
    try {
      wasmFilename = readdirSync(alsDir).find(f => f.endsWith('.wasm'))
    } catch {}
    result.push({ version: als, wasmFilename: wasmFilename ?? '' })
  }
  return result
}

/**
 * All libraries that appear in any profile whose .agda-lib file is readable.
 * Each entry has:
 *   name        — the .agda-lib `name:` value (identifier + static-asset key)
 *   agdaLibPath — absolute OS path to the .agda-lib file (primary key in profiles)
 *   useAgdai    — true if any profile's library entry has useAgdai: true
 *   cacheId     — stable random ID for deploy-assets/.cache/<cacheId>/
 *   cacheDir    — absolute path to that cache directory
 *
 * `name` is read directly from the .agda-lib file at agdaLibPath.
 * `useAgdai` is ORed across all profile entries that share the same agdaLibPath.
 *
 * Also prunes any index entry whose agdaLibPath is no longer in the
 * config, to keep the index tidy.
 */
export function getLocalLibraries() {
  const config = readDeployConfig()
  const index = readCacheIndex()
  let dirty = false

  // Collect agdaLibPath entries from all profiles; OR useAgdai across profiles
  const profileLibsByPath = new Map()
  for (const profile of config.profiles) {
    for (const lib of profile.libraries) {
      if (!lib.agdaLibPath) continue
      const existing = profileLibsByPath.get(lib.agdaLibPath)
      if (existing) {
        existing.useAgdai = existing.useAgdai || (lib.useAgdai ?? false)
      } else {
        profileLibsByPath.set(lib.agdaLibPath, { useAgdai: lib.useAgdai ?? false })
      }
    }
  }

  const activeAgdaLibPaths = new Set()
  const result = []

  for (const [agdaLibPath, libInfo] of profileLibsByPath) {
    let src
    try { src = readFileSync(agdaLibPath, 'utf8') } catch { continue }
    const name = parseAgdaLibName(src)
    if (!name) continue
    activeAgdaLibPaths.add(agdaLibPath)
    if (ensureCacheId(agdaLibPath, index)) dirty = true
    result.push({
      name,
      agdaLibPath,
      useAgdai: libInfo.useAgdai,
      cacheId: index[agdaLibPath],
      cacheDir: join(CACHE_DIR, index[agdaLibPath]),
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
