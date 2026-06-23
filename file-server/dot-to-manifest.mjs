/**
 * Phase B of dependency-graph generation: pure parsing, no `agda`
 * required. Reads the `.dot` files produced by running the commands
 * file-server/prepare-dependency-graph.mjs printed, and writes one
 * dependency-graph manifest per library — used by the browser runtime to
 * prefetch .agdai files in parallel (src/lib/agda/prefetch.js) — to
 * file-server/library/<name>/agdai-manifest.json.
 *
 * Each library's manifest only contains modules that library itself
 * defines (`{ graph: { [ownModule]: [deps...] } }` — deps may reference
 * modules from other libraries by name, e.g. agda-categories depending on
 * stdlib; the browser loads every active-profile library's manifest
 * together, so cross-library edges still resolve). There's no `libOf`
 * field — within one library's own file, every key is trivially "this
 * library's module"; the browser derives the equivalent of `libOf`
 * itself when merging multiple libraries' manifests (see prefetch.js).
 *
 * Usage (after running prepare-dependency-graph.mjs and its printed agda
 * commands):
 *   node file-server/dot-to-manifest.mjs
 */

import { readFile, writeFile, rm } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { REPO_ROOT, getSelectedLibraries } from './resolve-deploy-config.mjs'

const FILE_SERVER = join(REPO_ROOT, 'file-server')
const WORK_DIR = join(FILE_SERVER, '.dependency-graph-work')
const EVERYTHING_FILENAME = 'Everything.agda'

function parseDot(content) {
  const label = {}
  for (const m of content.matchAll(/\b(m\d+)\[label="([^"]+)"\]/g)) label[m[1]] = m[2]
  const edges = {}
  for (const k of Object.values(label)) edges[k] = []
  for (const m of content.matchAll(/\b(m\d+) -> (m\d+)/g)) {
    const s = label[m[1]], d = label[m[2]]
    if (s && d) edges[s].push(d)
  }
  return edges
}

function parseAgdaLibInclude(src) {
  const m = src.match(/^include:\s*(.+)/m)
  const include = m ? m[1].trim().split(/\s+/)[0] : '.'
  return include === '.' ? '' : include
}

function isExcluded(mod) {
  return mod.startsWith('Agda.') || mod === 'Everything'
}

async function main() {
  const libs = getSelectedLibraries()

  const ownModulesByLib = JSON.parse(await readFile(join(WORK_DIR, 'own-modules.json'), 'utf8').catch(() => {
    throw new Error(`${relative(REPO_ROOT, WORK_DIR)}/own-modules.json not found — run file-server/prepare-dependency-graph.mjs first`)
  }))

  for (const lib of libs) {
    const dotFile = join(WORK_DIR, `${lib.name}.dot`)
    const dotContent = await readFile(dotFile, 'utf8').catch(() => {
      throw new Error(`[${lib.name}] ${relative(REPO_ROOT, dotFile)} not found — did you run the agda command file-server/prepare-dependency-graph.mjs printed for this library?`)
    })
    const edges = parseDot(dotContent)
    const ownModules = ownModulesByLib[lib.name] || []

    // Every owned module gets a key, even with an empty deps array — a
    // leaf module (no non-builtin dependencies) still needs to be
    // attributable to this library when prefetch.js derives ownership
    // from which file a module's key appears in (there's no separate
    // ownModules field in the manifest itself, see header comment).
    const graph = {}
    for (const mod of ownModules) {
      if (isExcluded(mod)) continue
      graph[mod] = (edges[mod] || []).filter(d => !isExcluded(d))
    }

    const json = JSON.stringify({ graph })
    const manifestPath = join(FILE_SERVER, 'library', lib.name, 'agdai-manifest.json')
    await writeFile(manifestPath, json)
    console.log(`[${lib.name}] wrote ${Object.keys(graph).length} modules, ${(json.length / 1024).toFixed(0)} KB to ${relative(REPO_ROOT, manifestPath)}`)
  }

  for (const lib of libs) {
    const libRoot = join(FILE_SERVER, 'library', lib.name)
    const agdaLibPath = join(libRoot, lib.agdaLibFile)
    const include = parseAgdaLibInclude(await readFile(agdaLibPath, 'utf8'))
    const includeDir = include ? join(libRoot, include) : libRoot
    await rm(join(includeDir, EVERYTHING_FILENAME), { force: true })
  }
  await rm(WORK_DIR, { recursive: true, force: true })

  console.log('Cleaned up synthetic Everything.agda files and the working directory.')
  console.log('Run `npm run setup` to copy the new manifests into static/.')
}

main().catch(err => { console.error(err); process.exit(1) })
