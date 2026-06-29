/**
 * Fallback for producing a library's `_build/<numeric agda version>/agda/...`
 * prebuilt `.agdai` cache on a native `agda` older than 2.8.0 (no
 * `--build-library`, see deploy-assets/README.md "What to place"). Prefer
 * `agda --build-library` directly when available — it's simpler and
 * slightly faster; this script exists only for deployers pinning an
 * older `alsVersion` in deploy.config.json.
 *
 * Drives ONE single `agda --interaction-json` session and sends it one
 * `Cmd_load` per "source vertex" of the library's own dependency graph
 * (a module nothing else in the library imports — read from the
 * already-generated `agdai-manifest.json`, see generate-manifest.mjs).
 * Every other module gets pulled in and cached as a side effect of
 * loading whichever source vertex imports it (confirmed empirically: a
 * module's own `.agdai` gets written the first time anything in the
 * session needs it, regardless of whether it was named explicitly).
 *
 * Calling `Cmd_load` on exactly the source vertices is provably both
 * necessary and sufficient: a source vertex is never in any other
 * module's import closure (nothing imports it), so it can only ever be
 * reached by naming it directly — and since the graph is a DAG, tracing
 * "who imports this" from any module always terminates at some source
 * vertex, so the union of all source vertices' closures covers every
 * module. This also sidesteps the InfectiveImport/CoInfectiveImport
 * problem a hand-written combined `Everything.agda` can hit (confirmed
 * empirically: two modules with mutually exclusive `{-# OPTIONS #-}`,
 * loaded via separate `Cmd_load` calls with no combining import edge
 * between them, both load cleanly) — no synthetic entry point is ever
 * written.
 *
 * Usage:
 *   node deploy-assets/build-agdai-cache.mjs --library <folderName>
 */

import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { REPO_ROOT, getSelectedLibraries } from './resolve-deploy-config.mjs'
import { parseAgdaLibInclude } from './agda-lib-utils.mjs'

const DEPLOY_ASSETS = join(REPO_ROOT, 'deploy-assets')

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

function moduleNameToPath(mod) {
  return mod.split('.').join(sep) + '.agda'
}

/** Modules nothing else in `graph` imports — see header comment for why
 *  calling Cmd_load on exactly this set is both necessary and sufficient. */
function findSourceVertices(graph) {
  const hasIncoming = new Set()
  for (const mod of Object.keys(graph)) {
    for (const dep of graph[mod]) {
      if (dep in graph) hasIncoming.add(dep)
    }
  }
  return Object.keys(graph).filter(mod => !hasIncoming.has(mod))
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
  const manifestPath = join(libRoot, 'agdai-manifest.json')
  let graph
  try {
    graph = JSON.parse(await readFile(manifestPath, 'utf8')).graph
  } catch {
    throw new Error(`${manifestPath} not found — run \`node deploy-assets/generate-manifest.mjs --library ${args.library}\` first.`)
  }

  const sourceVertices = findSourceVertices(graph)
  console.log(`[${lib.folderName}] ${sourceVertices.length} source vertices to Cmd_load (covers all ${Object.keys(graph).length} modules)`)

  const versionResult = spawnSync('agda', ['--numeric-version'], { encoding: 'utf8' })
  const agdaVersion = versionResult.stdout?.trim()
  if (!agdaVersion) throw new Error('could not determine native agda\'s numeric version (`agda --numeric-version` produced no output)')
  console.log(`native agda version: ${agdaVersion}`)

  // Register every currently-selected library so `depend:` resolves
  // (same requirement as `agda --build-library`'s own --library-file=,
  // see deploy-assets/README.md "What to place").
  const tmpDir = await mkdtemp(join(tmpdir(), 'agda-build-cache-'))
  const libraryFile = join(tmpDir, 'libraries')
  const allLibs = getSelectedLibraries()
  await writeFile(
    libraryFile,
    allLibs.map(l => join(DEPLOY_ASSETS, 'library', l.folderName, l.agdaLibFile)).join('\n') + '\n',
  )

  const proc = spawn('agda', ['--interaction-json', `--library-file=${libraryFile}`], { cwd: libRoot })
  let buf = ''
  let pending = null
  proc.stdout.on('data', d => {
    buf += d
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (!pending) continue
      if (line.includes('"kind":"Error"')) pending.failed = true
      // A load's response always ends with a second `Status` line, on both
      // success and failure (confirmed empirically: a real type error never
      // produces an `InteractionPoints` response at all, only a real load
      // that completes scope/type-checking does, so waiting on that would
      // hang forever on failure).
      if (line.includes('"kind":"Status"')) {
        pending.statusCount++
        if (pending.statusCount >= 2) {
          const p = pending
          pending = null
          p.done()
        }
      }
    }
  })
  proc.on('error', err => { throw err })

  function loadOne(mod) {
    return new Promise((resolve, reject) => {
      // `done` closes over `entry` directly (not the outer mutable
      // `pending`, which is already reset to null by the time this runs).
      const entry = { failed: false, statusCount: 0 }
      entry.done = () => (entry.failed ? reject(new Error(`Cmd_load reported an error for ${mod}`)) : resolve())
      pending = entry
      const path = join(includeDir, moduleNameToPath(mod))
      proc.stdin.write(`IOTCM "${path}" NonInteractive Direct (Cmd_load "${path}" [])\n`)
    })
  }

  const t0 = performance.now()
  let count = 0
  for (const mod of sourceVertices) {
    await loadOne(mod)
    count++
    if (count % 50 === 0) console.log(`  ${count}/${sourceVertices.length}...`)
  }
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1)

  proc.stdin.write('IOTCM "" NonInteractive Direct Cmd_exit\n')
  proc.stdin.end()

  console.log(`[${lib.folderName}] done: ${sourceVertices.length} Cmd_load calls, ${elapsed}s`)
  console.log(`.agdai written under ${join(libRoot, '_build', agdaVersion, 'agda')}`)
}

main().catch(err => { console.error(err); process.exit(1) })
