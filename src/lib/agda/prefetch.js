/**
 * Pre-fetch .agdai files for a source buffer using a static dependency manifest.
 * The manifest maps module names to their direct dependencies (transitively-reduced graph).
 * We compute the transitive closure and kick off parallel fetches before ALS type-checks.
 */

import { asset } from '$app/paths'

const AGDA_VERSION = '2.8.0'

/** @type {{ graph: Record<string, string[]>, libOf: Record<string, string> } | null} */
let manifest = null
let manifestLoading = false

async function loadManifest() {
  if (manifest || manifestLoading) return
  manifestLoading = true
  try {
    const resp = await fetch(asset('/agdai-manifest.json'))
    if (resp.ok) manifest = await resp.json()
  } catch {
    // manifest unavailable — prefetch disabled, on-demand fetch still works
  }
}

// kick off manifest load eagerly
loadManifest()

/**
 * @param {string} mod
 * @param {Record<string, string[]>} graph
 * @param {Set<string>} visited
 */
function collectDeps(mod, graph, visited = new Set()) {
  if (visited.has(mod)) return visited
  visited.add(mod)
  for (const dep of (graph[mod] ?? [])) collectDeps(dep, graph, visited)
  return visited
}

/**
 * @param {string} mod  e.g. "Data.Nat.Base"
 * @param {string} lib  "s" = stdlib, "c" = cubical
 */
function modToAgdaiPath(mod, lib) {
  const rel = mod.replaceAll('.', '/')
  if (lib === 's') return `stdlib/_build/${AGDA_VERSION}/agda/src/${rel}.agdai`
  if (lib === 'c') return `cubical/_build/${AGDA_VERSION}/agda/${rel}.agdai`
  return null
}

/**
 * Parse top-level import module names from Agda source (no comment stripping needed
 * for this use case — false positives just add extra prefetches, not errors).
 * @param {string} src
 * @returns {string[]}
 */
function parseTopLevelImports(src) {
  const mods = new Set()
  for (const m of src.matchAll(/^\s*(?:open\s+)?import\s+([\w.]+)/gm))
    mods.add(m[1])
  return [...mods]
}

/**
 * Fire-and-forget: pre-fetch all .agdai files needed to type-check src.
 * @param {string} src  - current editor content
 * @param {(paths: string[]) => void} prefetchFn  - backend.prefetchAgdai
 */
export function triggerPrefetch(src, prefetchFn) {
  if (!manifest) return
  const { graph, libOf } = manifest

  const imports = parseTopLevelImports(src)
  const allDeps = new Set()
  for (const mod of imports) collectDeps(mod, graph, allDeps)
  allDeps.delete('Everything')

  const paths = []
  for (const mod of allDeps) {
    const lib = libOf[mod]
    if (!lib) continue
    const path = modToAgdaiPath(mod, lib)
    if (path) paths.push(path)
  }

  if (paths.length > 0) {
    console.debug(`[prefetch] ${paths.length} .agdai files for ${imports.length} imports`)
    prefetchFn(paths)
  }
}
