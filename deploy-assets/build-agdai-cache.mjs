/**
 * Builds precompiled `.agdai` files for a library and stores them in
 * `deploy-assets/.cache/<id>/_build/` — the path `build-static-assets.mjs`
 * reads when copying to `static/agdai/<name>/_build/`.
 *
 * To avoid writing files outside this project, the library's source tree
 * is temporarily copied into `.cache/<id>/build-temp/`, Agda is run there
 * (so its `_build/` output lands under `build-temp/`), `_build/` is moved
 * to `.cache/<id>/_build/`, then `build-temp/` is deleted — always, even
 * on error (try/finally).
 *
 * Supports two build modes selected automatically by `agda --numeric-version`:
 *
 *   ≥ 2.8.0  — `agda --build-library=<temp.agda-lib> --library-file=<f>`
 *              (single command, no interaction protocol needed)
 *
 *   < 2.8.0  — `agda --interaction-json --library-file=<f>`, then one
 *              `Cmd_load` per source vertex (modules nothing else in the
 *              library imports; their union's closure covers every module —
 *              see comments in the Cmd_load section for the proof sketch).
 *              This avoids the InfectiveImport/CoInfectiveImport issue
 *              a combined Everything.agda would hit.
 *
 * The library's `agdai-manifest.json` (in `.cache/<id>/agdai-manifest.json`)
 * must exist before calling this — run `npm run generate-manifest` first.
 *
 * Usage:
 *   node deploy-assets/build-agdai-cache.mjs [--library <name>] [--agda-bin <path>]
 *
 * Without --library, processes all libraries in deploy.local.json that have
 * useAgdai: true.
 */

import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises'
import { dirname, join, basename, sep } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { getLocalLibraries } from './resolve-deploy-config.mjs'
import { parseAgdaLibInclude } from './agda-lib-utils.mjs'

function parseArgs(argv) {
  const args = { library: null, agdaBin: 'agda' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--library') args.library = argv[++i]
    else if (argv[i] === '--agda-bin') args.agdaBin = argv[++i]
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  return args
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
  for (const mod of Object.keys(graph)) {
    for (const dep of graph[mod]) {
      if (dep in graph) hasIncoming.add(dep)
    }
  }
  return Object.keys(graph).filter(mod => !hasIncoming.has(mod))
}

async function buildLibrary(lib, agdaBin) {
  const manifestPath = join(lib.cacheDir, 'agdai-manifest.json')
  let graph
  try {
    graph = JSON.parse(await readFile(manifestPath, 'utf8')).graph
  } catch {
    throw new Error(`${manifestPath} not found — run \`npm run generate-manifest -- --library ${lib.name}\` first.`)
  }

  const versionStr = spawnSync(agdaBin, ['--numeric-version'], { encoding: 'utf8' }).stdout
  const agdaVersion = parseAgdaVersion(versionStr)
  if (!agdaVersion) throw new Error(`could not determine agda version from "${agdaBin} --numeric-version": ${versionStr}`)
  console.log(`[${lib.name}] agda version: ${agdaVersion.join('.')}`)

  // Resolve include subpath from the real .agda-lib
  const agdaLibSrc = await readFile(lib.agdaLibPath, 'utf8')
  const include = parseAgdaLibInclude(agdaLibSrc)

  // Prepare build-temp: copy library source into .cache/<id>/build-temp/
  const buildTemp = join(lib.cacheDir, 'build-temp')
  await rm(buildTemp, { recursive: true, force: true })
  await mkdir(buildTemp, { recursive: true })
  const libSrcRoot = dirname(lib.agdaLibPath)
  await cp(libSrcRoot, buildTemp, { recursive: true })
  const tempAgdaLibPath = join(buildTemp, basename(lib.agdaLibPath))
  const tempIncludeDir = include ? join(buildTemp, include) : buildTemp

  // Write a libraries file listing all local libraries, using the temp copy
  // for this lib and OS paths for all others (so depend: can resolve).
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
      await buildWithCmdLoad(lib, agdaBin, graph, tempIncludeDir, libraryFile, agdaVersion)
    }

    // Copy _build/ from temp into .cache/<id>/_build/
    const tempBuild = join(buildTemp, '_build')
    const destBuild = join(lib.cacheDir, '_build')
    await rm(destBuild, { recursive: true, force: true })
    await cp(tempBuild, destBuild, { recursive: true })
    console.log(`[${lib.name}] .agdai written to .cache/${lib.cacheId}/_build/`)
  } finally {
    await rm(buildTemp, { recursive: true, force: true })
  }
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

async function buildWithCmdLoad(lib, agdaBin, graph, tempIncludeDir, libraryFile, agdaVersion) {
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
      // A Cmd_load response always ends with a second Status line, on both
      // success and failure — waiting for statusCount>=2 is robust across
      // agda versions (confirmed empirically in prior testing).
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
    count++
    if (count % 50 === 0) console.log(`  ${count}/${sourceVertices.length}...`)
  }
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1)

  proc.stdin.write('IOTCM "" NonInteractive Direct Cmd_exit\n')
  proc.stdin.end()

  console.log(`[${lib.name}] Cmd_load done: ${sourceVertices.length} vertices, ${elapsed}s`)
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
      console.log('Set useAgdai: true for the libraries you want to build .agdai for,')
      console.log('or use --library <name> to build for a specific library regardless.')
      return
    }
  }

  for (const lib of libs) {
    await buildLibrary(lib, args.agdaBin)
  }
  console.log('Run `npm run setup` to copy .agdai files into static/.')
}

main().catch(err => { console.error(err); process.exit(1) })
