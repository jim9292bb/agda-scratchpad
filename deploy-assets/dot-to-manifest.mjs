/**
 * Converts one library's `.dot` dependency-graph file(s) — produced by
 * running native `agda --only-scope-checking --dependency-graph` yourself
 * against your own Everything.agda-style file(s) (see
 * deploy-assets/README.md "Regenerating the dependency graph") — into
 * that library's `deploy-assets/library/<folderName>/agdai-manifest.json`,
 * used by the browser runtime to prefetch .agdai files in parallel
 * (src/lib/agda/prefetch.js).
 *
 * This project does not generate Everything.agda or invoke `agda` for
 * you: a single synthetic file importing every module can't always
 * scope-check (confirmed: a library mixing modules that need mutually
 * exclusive options has no single `{-# OPTIONS #-}` line that works for
 * all of them), so splitting modules into groups — and writing the right
 * options for each — needs a human who understands the library's
 * structure. You place as many `.agda` "import everything in this group"
 * files as you need under `deploy-assets/library/<folderName>/everything/`,
 * run `agda --dependency-graph` against each yourself (so you see its real
 * output directly, not a wrapper's guess at whether it succeeded), and
 * place the resulting `.dot` files under
 * `deploy-assets/library/<folderName>/dots/`. This script only merges
 * whatever `.dot` files it finds there.
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
 * "ownModules" (which labels in the merged `.dot` graphs actually belong
 * to this library, as opposed to other libraries pulled in transitively)
 * is computed by scanning the library's own raw source tree directly —
 * not derived from your `everything/` files — so it doesn't matter how
 * you split modules into groups.
 *
 * Usage:
 *   node deploy-assets/dot-to-manifest.mjs --library <folderName>
 */

import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { REPO_ROOT, getSelectedLibraries } from './resolve-deploy-config.mjs'
import { parseAgdaLibInclude } from './agda-lib-utils.mjs'

const DEPLOY_ASSETS = join(REPO_ROOT, 'deploy-assets')
// Directories under a library's own root that are never part of its own
// module set, regardless of where includeSubpath points (e.g. cubical's
// empty includeSubpath means its includeDir is the library root itself,
// the same place these live).
const NON_MODULE_DIRS = new Set(['_build', 'everything', 'dots'])

function parseArgs(argv) {
  const args = { library: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--library') args.library = argv[++i]
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  if (!args.library) {
    throw new Error('--library <folderName> is required — pass the folderName of exactly one currently-selected library (deploy.config.json) to process.')
  }
  return args
}

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

async function findAgdaFiles(dir, result = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && NON_MODULE_DIRS.has(entry.name)) continue
    const p = join(dir, entry.name)
    if (entry.isDirectory()) await findAgdaFiles(p, result)
    else if (entry.name.endsWith('.agda')) result.push(p)
  }
  return result
}

function pathToModuleName(filePath, includeDir) {
  return relative(includeDir, filePath)
    .replace(/\.agda$/, '')
    .split(sep)
    .join('.')
}

function isExcluded(mod) {
  return mod.startsWith('Agda.') || mod === 'Everything'
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const lib = getSelectedLibraries().find(l => l.folderName === args.library)
  if (!lib) {
    const names = getSelectedLibraries().map(l => l.folderName).join(', ') || '(none)'
    throw new Error(`"${args.library}" is not a currently-selected library — check deploy.config.json. Selected: ${names}`)
  }

  const libRoot = join(DEPLOY_ASSETS, 'library', lib.folderName)
  const agdaLibPath = join(libRoot, lib.agdaLibFile)
  const include = parseAgdaLibInclude(await readFile(agdaLibPath, 'utf8'))
  const includeDir = include ? join(libRoot, include) : libRoot

  const agdaFiles = (await findAgdaFiles(includeDir)).sort()
  const ownModules = agdaFiles.map(f => pathToModuleName(f, includeDir))

  const dotsDir = join(libRoot, 'dots')
  const dotFilenames = (await readdir(dotsDir).catch(() => {
    throw new Error(`${relative(REPO_ROOT, dotsDir)} not found — place your .dot file(s) there first (see deploy-assets/README.md "Regenerating the dependency graph").`)
  })).filter(f => f.endsWith('.dot'))
  if (dotFilenames.length === 0) {
    throw new Error(`No .dot files found in ${relative(REPO_ROOT, dotsDir)} — place at least one there first.`)
  }

  const edges = {}
  for (const filename of dotFilenames) {
    const content = await readFile(join(dotsDir, filename), 'utf8')
    Object.assign(edges, parseDot(content))
  }

  // Don't trust "we have some .dot files" as proof every module got
  // checked by something — a module missing from the merged graph would
  // otherwise be silently recorded as having zero dependencies. This only
  // confirms every owned module got a label somewhere across your .dot
  // files; it can't confirm any one label's edges are complete (no
  // independent source of truth for that short of reimplementing Agda's
  // own import resolution) — that's why you run `agda` yourself and watch
  // its real output, instead of this script trying to guess for you.
  const missing = ownModules.filter(mod => !isExcluded(mod) && !(mod in edges))
  if (missing.length > 0) {
    throw new Error(`[${lib.folderName}] missing ${missing.length} expected module(s) across the .dot files in ${relative(REPO_ROOT, dotsDir)} (e.g. ${missing.slice(0, 3).join(', ')}) — check that every module is covered by one of your everything/ files and that its agda run succeeded.`)
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
  const manifestPath = join(libRoot, 'agdai-manifest.json')
  await writeFile(manifestPath, json)
  console.log(`[${lib.folderName}] wrote ${Object.keys(graph).length} modules, ${(json.length / 1024).toFixed(0)} KB to ${relative(REPO_ROOT, manifestPath)}`)
  console.log('Run `npm run setup` to copy it into static/.')
}

main().catch(err => { console.error(err); process.exit(1) })
