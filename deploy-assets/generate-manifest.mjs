/**
 * Generates `deploy-assets/.cache/<id>/agdai-manifest.json` — the
 * dependency graph `src/lib/agda/prefetch.js` uses to prefetch `.agdai`
 * files — directly from each library's own source tree at the OS path
 * recorded in `deploy.local.json`, no hand-written `Everything.agda` and
 * no native `--dependency-graph` run required.
 *
 * For each of the library's own source files, this spawns
 * `agda --interaction-json` and sends `Cmd_tokenHighlighting` — an Agda
 * interaction command that returns purely lexical token highlighting for
 * a single file without loading, resolving, or type-checking any of its
 * imports (confirmed: it works standalone even when the imports don't
 * exist). Every highlighted range that is *not* a `keyword` (comments —
 * including nested ones — literate prose/code-fence markup, symbols,
 * holes, pragma bodies, string/number literals) is replaced with a
 * single space; matching `\bimport\b\s*(\S+)\s` against the result then
 * correctly extracts the file's own direct import targets, immune to
 * every edge case found while developing this (multi-line `import`,
 * comments glued with zero surrounding whitespace, semicolon-glued
 * declarations, literate prose that happens to contain text shaped like
 * an import statement).
 *
 * This is strictly more complete than the `agda --dependency-graph`-based
 * approach it replaces: that tool's Dot backend applies a transitive
 * reduction (for graph-visualization purposes), silently dropping real
 * direct edges whenever the same target is also reachable some other
 * way. `prefetch.js`'s `collectDeps` does a plain transitive-closure
 * walk, so the extra (previously-dropped) edges this script keeps don't
 * change prefetch behavior — closure is invariant under transitive
 * reduction — they just make the manifest's own per-module edge list
 * accurate.
 *
 * Usage:
 *   node deploy-assets/generate-manifest.mjs [--library <name>]
 *
 * Without --library, processes all libraries in deploy.local.json that
 * have useAgdai: true. With --library <name>, processes only that one
 * (regardless of its useAgdai setting — useful for one-off regeneration).
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { cpus } from 'node:os'
import { getLocalLibraries } from './resolve-deploy-config.mjs'
import { parseAgdaLibInclude } from './agda-lib-utils.mjs'

// Every extension agda's own lexer recognizes (`.agda` plus every literate
// variant) — confirmed empirically that `import` resolution searches all of
// these, not just `.agda`/`.lagda` (the two an unrelated error message
// happens to list as examples).
const AGDA_FILE_EXTENSIONS = [
  '.agda', '.lagda', '.lagda.tex', '.lagda.rst',
  '.lagda.md', '.lagda.org', '.lagda.tree', '.lagda.typ',
]

function parseArgs(argv) {
  const args = { library: null, agdaBin: 'agda' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--library') args.library = argv[++i]
    else if (argv[i] === '--agda-bin') args.agdaBin = argv[++i]
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  return args
}

function matchAgdaExtension(filename) {
  return AGDA_FILE_EXTENSIONS.find(ext => filename.endsWith(ext))
}

function pathToModuleName(filePath, includeDir, ext) {
  return relative(includeDir, filePath)
    .slice(0, -ext.length)
    .split(sep)
    .join('.')
}

async function findAgdaFiles(dir, result = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) await findAgdaFiles(p, result)
    else if (matchAgdaExtension(entry.name)) result.push(p)
  }
  return result
}

function isExcluded(mod) {
  return mod.startsWith('Agda.')
}

/** Run `tasks` (each a () => Promise) with at most `limit` in flight at once. */
async function runPool(tasks, limit) {
  const results = new Array(tasks.length)
  let next = 0
  async function worker() {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

/** @returns {Promise<{ atoms: string[], range: [number, number] }[]>} */
function getHighlightingPayload(absPath, agdaBin) {
  return new Promise((resolve, reject) => {
    const proc = spawn(agdaBin, ['--interaction-json'])
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', d => { stdout += d })
    proc.stderr.on('data', d => { stderr += d })
    proc.on('error', reject)
    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`agda --interaction-json exited ${code} for ${absPath}: ${stderr || stdout}`))
        return
      }
      const line = stdout.split('\n').find(l => l.includes('"kind":"HighlightingInfo"'))
      if (!line) {
        reject(new Error(`no HighlightingInfo response for ${absPath}: ${stdout || stderr}`))
        return
      }
      try {
        resolve(JSON.parse(line.slice(line.indexOf('{'))).info.payload)
      } catch (err) {
        reject(new Error(`malformed HighlightingInfo response for ${absPath}: ${err.message}`))
      }
    })
    const cmd = `IOTCM "${absPath}" NonInteractive Direct (Cmd_tokenHighlighting "${absPath}" Keep)\n`
    proc.stdin.write(cmd)
    proc.stdin.end()
  })
}

const IMPORT_RE = /\bimport\b\s*(\S+)\s/g

async function extractImports(absPath, agdaBin) {
  const src = await readFile(absPath, 'utf8')
  const chars = [...src]
  const payload = await getHighlightingPayload(absPath, agdaBin)
  for (const { atoms, range } of payload) {
    if (atoms.includes('keyword')) continue
    const [start, end] = range
    for (let i = start - 1; i < end - 1; i++) chars[i] = ' '
  }
  const cleaned = chars.join('')
  const found = new Set()
  for (const m of cleaned.matchAll(IMPORT_RE)) found.add(m[1])
  return [...found]
}

/** Extracts the dependency graph from a library's source tree. Does not write to disk. */
export async function buildGraph(lib, agdaBin = 'agda') {
  const agdaLibSrc = await readFile(lib.agdaLibPath, 'utf8')
  const include = parseAgdaLibInclude(agdaLibSrc)
  const libRoot = dirname(lib.agdaLibPath)
  const includeDir = include ? join(libRoot, include) : libRoot

  const agdaFiles = (await findAgdaFiles(includeDir)).sort()
  console.log(`[${lib.name}] extracting imports from ${agdaFiles.length} files (${agdaBin} --interaction-json, ${cpus().length}-way parallel)...`)

  const graph = {}
  await runPool(
    agdaFiles.map(file => async () => {
      const ext = matchAgdaExtension(file)
      const mod = pathToModuleName(file, includeDir, ext)
      const imports = await extractImports(file, agdaBin)
      graph[mod] = imports.filter(d => !isExcluded(d))
    }),
    cpus().length,
  )
  return graph
}

/** Builds the dependency graph and writes it to .cache/<id>/agdai-manifest.json. */
export async function processLibrary(lib, agdaBin = 'agda') {
  const graph = await buildGraph(lib, agdaBin)
  await mkdir(lib.cacheDir, { recursive: true })
  const json = JSON.stringify({ graph })
  const manifestPath = join(lib.cacheDir, 'agdai-manifest.json')
  await writeFile(manifestPath, json)
  console.log(`[${lib.name}] wrote ${Object.keys(graph).length} modules, ${(json.length / 1024).toFixed(0)} KB to .cache/${lib.cacheId}/agdai-manifest.json`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let libs = getLocalLibraries()

  if (args.library) {
    const target = libs.find(l => l.name === args.library)
    if (!target) {
      const names = libs.map(l => l.name).join(', ') || '(none configured)'
      throw new Error(`"${args.library}" not found in deploy.local.json. Available: ${names}`)
    }
    libs = [target]
  } else {
    libs = libs.filter(l => l.useAgdai)
    if (libs.length === 0) {
      console.log('No libraries have useAgdai: true in deploy.local.json — nothing to do.')
      console.log('Set useAgdai: true for the libraries you want to generate manifests for,')
      console.log('or use --library <name> to generate for a specific library regardless.')
      return
    }
  }

  for (const lib of libs) {
    await processLibrary(lib, args.agdaBin)
  }
  console.log('Run `npm run setup` to copy manifests into static/.')
}

main().catch(err => { console.error(err); process.exit(1) })
