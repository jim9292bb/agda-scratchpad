/**
 * Pre-fetch .agdai files for a source buffer using each active library's
 * own dependency manifest (see file-server/dot-to-manifest.mjs). Each
 * manifest maps that library's own modules to their direct dependencies
 * (transitively-reduced graph, deps may name modules from other
 * libraries). We load every active-profile library's manifest, merge
 * them into one working graph, compute the transitive closure, and kick
 * off parallel fetches before ALS type-checks.
 */

/** @type {Map<string, { graph: Record<string, string[]> } | null>} */
const manifestCache = new Map()

/**
 * @param {import('$lib/runtime/interface').ResolvedLibrary} lib
 * @returns {Promise<{ graph: Record<string, string[]> } | null>}
 */
async function loadLibraryManifest(lib) {
  const cached = manifestCache.get(lib.libKey)
  if (cached !== undefined) return cached
  let result = null
  try {
    const resp = await fetch(lib.manifestAsset)
    if (resp.ok) result = await resp.json()
  } catch {
    // manifest unavailable — prefetch disabled for this library, on-demand fetch still works
  }
  manifestCache.set(lib.libKey, result)
  return result
}

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
 * @param {import('$lib/runtime/interface').ResolvedLibrary} lib
 */
function modToAgdaiPath(mod, lib) {
  if (!lib.agdaiCacheVersion) return null
  const rel = mod.replaceAll('.', '/')
  const sub = lib.includeSubpath ? `${lib.includeSubpath}/` : ''
  return `${lib.folderName}/_build/${lib.agdaiCacheVersion}/agda/${sub}${rel}.agdai`
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
 * @param {import('$lib/runtime/interface').ResolvedLibrary[]} activeLibraries
 *   - the currently-active profile's resolved libraries; every one of
 *     their manifests is loaded so cross-library dependency edges (e.g.
 *     agda-categories importing stdlib modules) resolve correctly.
 */
export async function triggerPrefetch(src, prefetchFn, activeLibraries) {
  const libByKey = new Map(activeLibraries.map(lib => [lib.libKey, lib]))

  /** @type {Record<string, string[]>} */
  const graph = {}
  /** @type {Record<string, string>} */
  const libOf = {}
  await Promise.all(activeLibraries.map(async lib => {
    const manifest = await loadLibraryManifest(lib)
    if (!manifest) return
    for (const [mod, deps] of Object.entries(manifest.graph)) {
      graph[mod] = deps
      libOf[mod] = lib.libKey
    }
  }))

  const imports = parseTopLevelImports(src)
  const allDeps = new Set()
  for (const mod of imports) collectDeps(mod, graph, allDeps)
  allDeps.delete('Everything')

  const paths = []
  for (const mod of allDeps) {
    const lib = libByKey.get(libOf[mod])
    if (!lib) continue
    const path = modToAgdaiPath(mod, lib)
    if (path) paths.push(path)
  }

  if (paths.length > 0) {
    console.debug(`[prefetch] ${paths.length} .agdai files for ${imports.length} imports`)
    prefetchFn(paths)
  }
}
