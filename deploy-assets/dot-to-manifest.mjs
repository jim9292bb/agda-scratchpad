/**
 * Phase B of dependency-graph generation: pure parsing, no `agda`
 * required. Reads whichever `.dot` file(s) prepare-dependency-graph.mjs's
 * printed `agda` command produced (one library per
 * prepare-dependency-graph.mjs run — see its own header comment) and
 * writes that library's dependency-graph manifest — used by the browser
 * runtime to prefetch .agdai files in parallel (src/lib/agda/prefetch.js)
 * — to deploy-assets/library/<name>/agdai-manifest.json.
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
 * This processes whatever's recorded in own-modules.json (written by the
 * most recent prepare-dependency-graph.mjs run) — not every currently-
 * selected library — so it stays in sync with prepare-dependency-graph.mjs
 * always being scoped to one library per invocation.
 *
 * Usage (after running prepare-dependency-graph.mjs and its printed agda
 * command):
 *   node deploy-assets/dot-to-manifest.mjs
 */

import { readFile, writeFile, rm } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { REPO_ROOT, getSelectedLibraries } from './resolve-deploy-config.mjs'

const DEPLOY_ASSETS = join(REPO_ROOT, 'deploy-assets')
const WORK_DIR = join(DEPLOY_ASSETS, '.dependency-graph-work')
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
  const ownModulesByLib = JSON.parse(await readFile(join(WORK_DIR, 'own-modules.json'), 'utf8').catch(() => {
    throw new Error(`${relative(REPO_ROOT, WORK_DIR)}/own-modules.json not found — run deploy-assets/prepare-dependency-graph.mjs first`)
  }))
  const names = Object.keys(ownModulesByLib)

  for (const name of names) {
    const dotFile = join(WORK_DIR, `${name}.dot`)
    const dotContent = await readFile(dotFile, 'utf8').catch(() => {
      throw new Error(`[${name}] ${relative(REPO_ROOT, dotFile)} not found — did you run the agda command prepare-dependency-graph.mjs printed?`)
    })
    const edges = parseDot(dotContent)
    const ownModules = ownModulesByLib[name] || []

    // Don't trust "the .dot file exists" alone as proof agda finished
    // checking every module — that's only confirmed for the one failure
    // mode actually tested (a hard scope-check error writes no file at
    // all, not a partial one — Agda's Dot backend appears to write its
    // output once, at the end of a fully-completed-or-warnings-only run,
    // not incrementally). A module missing from the parsed graph would
    // otherwise be silently recorded as having zero dependencies instead
    // of failing loudly, if some other failure mode ever left a partial
    // .dot behind.
    //
    // This only checks every owned module got a label (a `m123[label=...]`
    // line) — not that its specific edges are complete. There's no
    // independent source of truth for "how many edges should module X
    // have" short of reimplementing Agda's own import resolution, so a
    // label that exists but is missing some of its `->` edges (confirmed,
    // by manually truncating a real .dot file, to slip past this check)
    // can't be detected this way. Not a known real failure mode — labels
    // and edges are both written in the same single pass — but worth
    // naming as this check's actual boundary.
    const missing = ownModules.filter(mod => !isExcluded(mod) && !(mod in edges))
    if (missing.length > 0) {
      throw new Error(`[${name}] ${relative(REPO_ROOT, dotFile)} is missing ${missing.length} expected module(s) (e.g. ${missing.slice(0, 3).join(', ')}) — agda may have failed partway through; re-run the agda command and check its output for errors.`)
    }

    // Every owned module gets a key, even with an empty deps array — a
    // leaf module (no non-builtin dependencies) still needs to be
    // attributable to this library when prefetch.js derives ownership
    // from which file a module's key appears in (there's no separate
    // ownModules field in the manifest itself, see header comment).
    const graph = {}
    for (const mod of ownModules) {
      if (isExcluded(mod)) continue
      graph[mod] = edges[mod].filter(d => !isExcluded(d))
    }

    const json = JSON.stringify({ graph })
    const manifestPath = join(DEPLOY_ASSETS, 'library', name, 'agdai-manifest.json')
    await writeFile(manifestPath, json)
    console.log(`[${name}] wrote ${Object.keys(graph).length} modules, ${(json.length / 1024).toFixed(0)} KB to ${relative(REPO_ROOT, manifestPath)}`)
  }

  // Defensive cleanup: prepare-dependency-graph.mjs's generated run-agda.sh
  // already removes its own synthetic Everything.agda after running agda,
  // but clean up again here in case that script was interrupted.
  const libs = getSelectedLibraries().filter(lib => names.includes(lib.name))
  for (const lib of libs) {
    const libRoot = join(DEPLOY_ASSETS, 'library', lib.name)
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
