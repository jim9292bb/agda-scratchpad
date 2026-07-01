/**
 * Installs precompiled .agdai files and generates the dependency-graph
 * manifest for each configured library.
 *
 * Two modes:
 *
 *   --from <path>     Copy _build/ from the given directory.
 *
 *   (no --from)       Build from scratch with native agda:
 *                     agda ≥ 2.8.0 — agda --build-library (single command)
 *                     agda < 2.8.0 — agda --interaction-json + Cmd_load per
 *                                    source vertex; dependency graph is
 *                                    computed in memory, not written to file
 *
 * In both modes the dependency-graph manifest is (re)generated after
 * _build/ is in place — manifest and cache are always in sync.
 *
 * Usage:
 *   node deploy-assets/install-agdai-cache.mjs [--from <path>] [--library <name>] [--agda-bin <path>] [--force]
 *
 * Without --library, processes all libraries in deploy.config.json with useAgdai: true.
 * --agda-bin defaults to "agda" on PATH.
 * --force overwrites an existing _build/ without prompting.
 */

import { readFile, writeFile, access, mkdir, cp, rm } from 'node:fs/promises'
import { dirname, join, basename, sep } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { getLocalLibraries } from './resolve-deploy-config.mjs'
import { parseAgdaLibInclude } from './agda-lib-utils.mjs'
import { buildGraph, processLibrary as generateManifest } from './generate-manifest.mjs'

function parseArgs(argv) {
  const args = { importMode: false, fromPath: null, library: null, agdaBin: 'agda', force: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('-'))
        throw new Error('--from requires a directory path')
      args.importMode = true
      args.fromPath = argv[++i]
    } else if (argv[i] === '--library') {
      args.library = argv[++i]
    } else if (argv[i] === '--agda-bin') {
      args.agdaBin = argv[++i]
    } else if (argv[i] === '--force') {
      args.force = true
    } else {
      console.error(`unknown argument: ${argv[i]}`)
      process.exit(1)
    }
  }
  return args
}

async function exists(p) {
  try { await access(p); return true } catch { return false }
}

// --- import mode ---

async function importBuild(lib, fromPath, force) {
  const src = join(fromPath, '_build')
  const dst = join(lib.cacheDir, '_build')

  if (!(await exists(src))) {
    throw new Error(`no _build/ found at ${src}`)
  }
  if (await exists(dst)) {
    if (!force) throw new Error(`.cache/${lib.cacheId}/_build/ already exists — use --force to overwrite`)
    await rm(dst, { recursive: true })
  }
  await mkdir(lib.cacheDir, { recursive: true })
  await cp(src, dst, { recursive: true })
  console.log(`[${lib.name}] copied _build/ from ${src}`)
}

// --- build mode ---

function parseAgdaVersion(str) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(str?.trim() ?? '')
  if (!m) return null
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])]
}

function versionGte(v, [major, minor, patch]) {
  if (v[0] !== major) return v[0] > major
  if (v[1] !== minor) return v[1] > minor
  return v[2] >= patch
}

function moduleNameToPath(mod) {
  return mod.split('.').join(sep) + '.agda'
}

function findSourceVertices(graph) {
  const hasIncoming = new Set()
  for (const deps of Object.values(graph))
    for (const dep of deps)
      if (dep in graph) hasIncoming.add(dep)
  return Object.keys(graph).filter(mod => !hasIncoming.has(mod))
}

function buildWithBuildLibrary(lib, agdaBin, tempAgdaLibPath, libraryFile) {
  return new Promise((resolve, reject) => {
    console.log(`[${lib.name}] running agda --build-library...`)
    const proc = spawn(agdaBin, [
      `--build-library=${tempAgdaLibPath}`,
      `--library-file=${libraryFile}`,
    ], { stdio: ['ignore', 'inherit', 'inherit'] })
    proc.on('error', reject)
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`agda --build-library exited ${code} for "${lib.name}"`))
      else resolve()
    })
  })
}

async function buildWithCmdLoad(lib, agdaBin, graph, tempIncludeDir, libraryFile) {
  const sourceVertices = findSourceVertices(graph)
  console.log(`[${lib.name}] ${sourceVertices.length} source vertices to Cmd_load (covers all ${Object.keys(graph).length} modules)`)

  const proc = spawn(agdaBin, ['--interaction-json', `--library-file=${libraryFile}`], {
    cwd: tempIncludeDir,
  })
  let buf = ''
  let pending = null
  proc.stdout.on('data', d => {
    buf += d
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (!pending) continue
      if (line.includes('"kind":"Error"')) pending.failed = true
      if (line.includes('"kind":"Status"')) {
        pending.statusCount++
        if (pending.statusCount >= 2) {
          const p = pending; pending = null; p.done()
        }
      }
    }
  })
  proc.on('error', err => { throw err })

  function loadOne(mod) {
    return new Promise((resolve, reject) => {
      const entry = { failed: false, statusCount: 0 }
      entry.done = () => (entry.failed ? reject(new Error(`Cmd_load reported an error for ${mod}`)) : resolve())
      pending = entry
      const path = join(tempIncludeDir, moduleNameToPath(mod))
      proc.stdin.write(`IOTCM "${path}" NonInteractive Direct (Cmd_load "${path}" [])\n`)
    })
  }

  const t0 = performance.now()
  let count = 0
  for (const mod of sourceVertices) {
    await loadOne(mod)
    if (++count % 50 === 0) console.log(`  ${count}/${sourceVertices.length}...`)
  }
  proc.stdin.write('IOTCM "" NonInteractive Direct Cmd_exit\n')
  proc.stdin.end()
  console.log(`[${lib.name}] Cmd_load done: ${sourceVertices.length} vertices, ${((performance.now() - t0) / 1000).toFixed(1)}s`)
}

async function buildAgdai(lib, agdaBin) {
  const versionStr = spawnSync(agdaBin, ['--numeric-version'], { encoding: 'utf8' }).stdout
  const agdaVersion = parseAgdaVersion(versionStr)
  if (!agdaVersion) throw new Error(`could not determine agda version from "${agdaBin} --numeric-version": ${versionStr}`)
  console.log(`[${lib.name}] agda version: ${agdaVersion.join('.')}`)

  const agdaLibSrc = await readFile(lib.agdaLibPath, 'utf8')
  const include = parseAgdaLibInclude(agdaLibSrc)

  const buildTemp = join(lib.cacheDir, 'build-temp')
  await rm(buildTemp, { recursive: true, force: true })
  await mkdir(buildTemp, { recursive: true })
  const libSrcRoot = dirname(lib.agdaLibPath)
  await cp(libSrcRoot, buildTemp, { recursive: true })
  const tempAgdaLibPath = join(buildTemp, basename(lib.agdaLibPath))
  const tempIncludeDir = include ? join(buildTemp, include) : buildTemp

  const allLibs = getLocalLibraries()
  const libraryFile = join(lib.cacheDir, 'libraries')
  await writeFile(
    libraryFile,
    allLibs.map(l => l.name === lib.name ? tempAgdaLibPath : l.agdaLibPath).join('\n') + '\n',
  )

  try {
    if (versionGte(agdaVersion, [2, 8, 0])) {
      await buildWithBuildLibrary(lib, agdaBin, tempAgdaLibPath, libraryFile)
    } else {
      // Compute dependency graph in memory to find source vertices for Cmd_load.
      const graph = await buildGraph(lib, agdaBin)
      await buildWithCmdLoad(lib, agdaBin, graph, tempIncludeDir, libraryFile)
    }
    const tempBuild = join(buildTemp, '_build')
    const destBuild = join(lib.cacheDir, '_build')
    await rm(destBuild, { recursive: true, force: true })
    await cp(tempBuild, destBuild, { recursive: true })
    console.log(`[${lib.name}] .agdai written to .cache/${lib.cacheId}/_build/`)
  } finally {
    await rm(buildTemp, { recursive: true, force: true })
  }
}

// --- main ---

async function installLibrary(lib, args) {
  if (args.importMode) {
    await importBuild(lib, args.fromPath, args.force)
  } else {
    await buildAgdai(lib, args.agdaBin)
  }
  await generateManifest(lib, args.agdaBin)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let libs = getLocalLibraries()

  if (args.library) {
    const target = libs.find(l => l.name === args.library)
    if (!target) {
      const names = libs.map(l => l.name).join(', ') || '(none configured)'
      throw new Error(`"${args.library}" not found in deploy.config.json. Available: ${names}`)
    }
    libs = [target]
  } else {
    libs = libs.filter(l => l.useAgdai)
    if (libs.length === 0) {
      console.log('No libraries have useAgdai: true in deploy.config.json — nothing to do.')
      console.log('Set useAgdai: true for the libraries you want to install .agdai for,')
      console.log('or use --library <name> to install for a specific library regardless.')
      return
    }
  }

  for (const lib of libs) {
    await installLibrary(lib, args)
  }
  console.log('Run `npm run setup` to copy .agdai files into static/.')
}

main().catch(err => { console.error(err); process.exit(1) })
