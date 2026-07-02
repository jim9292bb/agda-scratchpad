/**
 * Installs precompiled .agdai files and generates the dependency-graph
 * manifest for each configured library.
 *
 * Builds with native agda directly in the library's source directory:
 *   agda ≥ 2.8.0 — agda --build-library (single command)
 *   agda < 2.8.0 — agda --interaction-json + Cmd_load per source vertex;
 *                  dependency graph is computed in memory, not written to file
 *
 * After building, copies the library's _build/ into deploy-assets/.cache/
 * and regenerates the dependency-graph manifest.
 *
 * Usage:
 *   node deploy-assets/install-agdai-cache.mjs [--library <name>] [--agda-bin <path>]
 *
 * Without --library, processes all libraries in deploy.config.json with useAgdai: true.
 * --agda-bin defaults to "agda" on PATH.
 */

import { readFile, writeFile, access, mkdir, cp, rm } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { getLocalLibraries } from './resolve-deploy-config.mjs'
import { parseAgdaLibInclude } from './agda-lib-utils.mjs'
import { buildGraph, processLibrary as generateManifest } from './generate-manifest.mjs'

function parseArgs(argv) {
  const args = { library: null, agdaBin: 'agda' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--library') {
      args.library = argv[++i]
    } else if (argv[i] === '--agda-bin') {
      args.agdaBin = argv[++i]
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

function buildWithBuildLibrary(lib, agdaBin, libraryFile) {
  return new Promise((resolve, reject) => {
    console.log(`[${lib.name}] running agda --build-library...`)
    const proc = spawn(agdaBin, [
      `--build-library=${lib.agdaLibPath}`,
      `--library-file=${libraryFile}`,
    ], { stdio: ['ignore', 'inherit', 'inherit'] })
    proc.on('error', reject)
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`agda --build-library exited ${code} for "${lib.name}"`))
      else resolve()
    })
  })
}

async function buildWithCmdLoad(lib, agdaBin, graph, includeDir, libraryFile) {
  const sourceVertices = findSourceVertices(graph)
  console.log(`[${lib.name}] ${sourceVertices.length} source vertices to Cmd_load (covers all ${Object.keys(graph).length} modules)`)

  const proc = spawn(agdaBin, ['--interaction-json', `--library-file=${libraryFile}`], {
    cwd: includeDir,
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
      const path = join(includeDir, moduleNameToPath(mod))
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
  const libSrcRoot = dirname(lib.agdaLibPath)
  const includeDir = include ? join(libSrcRoot, include) : libSrcRoot

  const allLibs = getLocalLibraries()
  const libraryFile = join(lib.cacheDir, 'libraries')
  await writeFile(
    libraryFile,
    allLibs.map(l => l.agdaLibPath).join('\n') + '\n',
  )

  if (versionGte(agdaVersion, [2, 8, 0])) {
    await buildWithBuildLibrary(lib, agdaBin, libraryFile)
  } else {
    // Compute dependency graph in memory to find source vertices for Cmd_load.
    const graph = await buildGraph(lib, agdaBin)
    await buildWithCmdLoad(lib, agdaBin, graph, includeDir, libraryFile)
  }

  const srcBuild = join(libSrcRoot, '_build')
  const destBuild = join(lib.cacheDir, '_build')
  await rm(destBuild, { recursive: true, force: true })
  await cp(srcBuild, destBuild, { recursive: true })
  console.log(`[${lib.name}] .agdai written to .cache/${lib.cacheId}/_build/`)
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
    await buildAgdai(lib, args.agdaBin)
    await generateManifest(lib, args.agdaBin)
  }
  console.log('Run `npm run setup` to copy .agdai files into static/.')
}

main().catch(err => { console.error(err); process.exit(1) })
