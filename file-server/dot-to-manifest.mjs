/**
 * Phase B of dependency-graph generation: pure parsing, no `agda`
 * required. Reads the `.dot` files produced by running the commands
 * file-server/prepare-dependency-graph.mjs printed, merges them into the
 * combined module dependency graph the browser runtime uses to prefetch
 * .agdai files in parallel (src/lib/agda/prefetch.js), and writes
 * file-server/agdai-manifest.json.
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

async function main() {
  const libs = getSelectedLibraries()

  const ownModulesByLib = JSON.parse(await readFile(join(WORK_DIR, 'own-modules.json'), 'utf8').catch(() => {
    throw new Error(`${relative(REPO_ROOT, WORK_DIR)}/own-modules.json not found — run file-server/prepare-dependency-graph.mjs first`)
  }))

  const graphs = {}
  const libOf = {}

  for (const lib of libs) {
    const dotFile = join(WORK_DIR, `${lib.name}.dot`)
    const dotContent = await readFile(dotFile, 'utf8').catch(() => {
      throw new Error(`[${lib.name}] ${relative(REPO_ROOT, dotFile)} not found — did you run the agda command file-server/prepare-dependency-graph.mjs printed for this library?`)
    })
    const edges = parseDot(dotContent)
    Object.assign(graphs, edges)

    const ownModules = ownModulesByLib[lib.name] || []
    for (const mod of ownModules) libOf[mod] = lib.libKey
  }

  const graph = {}
  for (const [mod, deps] of Object.entries(graphs)) {
    if (mod.startsWith('Agda.') || mod === 'Everything') continue
    const filtered = deps.filter(d => !d.startsWith('Agda.') && d !== 'Everything')
    if (filtered.length) graph[mod] = filtered
  }
  for (const mod of Object.keys(libOf)) {
    if (mod.startsWith('Agda.') || mod === 'Everything') delete libOf[mod]
  }

  const manifest = { graph, libOf }
  const json = JSON.stringify(manifest)
  await writeFile(join(FILE_SERVER, 'agdai-manifest.json'), json)

  console.log(`Wrote ${Object.keys(graph).length} modules, ${(json.length / 1024).toFixed(0)} KB to file-server/agdai-manifest.json`)

  for (const lib of libs) {
    const libRoot = join(FILE_SERVER, 'library', lib.name)
    const agdaLibPath = join(libRoot, lib.agdaLibFile)
    const include = parseAgdaLibInclude(await readFile(agdaLibPath, 'utf8'))
    const includeDir = include ? join(libRoot, include) : libRoot
    await rm(join(includeDir, EVERYTHING_FILENAME), { force: true })
  }
  await rm(WORK_DIR, { recursive: true, force: true })

  console.log('Cleaned up synthetic Everything.agda files and the working directory.')
  console.log('Run `npm run setup` to copy the new manifest into static/.')
}

main().catch(err => { console.error(err); process.exit(1) })
