/**
 * Generates static/agdai-manifest.json: a module dependency graph for the
 * standard library and Cubical Agda, used by the browser runtime to prefetch
 * .agdai files in parallel instead of fetching them one at a time as ALS
 * requests them sequentially during Cmd_load.
 *
 * Requires a native `agda` binary on PATH (not the WASM build). The graph is
 * produced via `agda --only-scope-checking --dependency-graph`, which reads
 * each module's already-compiled .agdai (from static/agdai/, produced by
 * `npm run setup` + file-server/extract-agdai.mjs) instead of re-type-checking
 * from source. If the native agda's interface format version doesn't match
 * the bundled .agdai cache, this still works, just slower (full recompile).
 *
 * Prerequisites (run first if missing):
 *   npm run setup
 *   node file-server/extract-agdai.mjs
 *
 * Usage:
 *   node file-server/generate-manifest.mjs
 *
 * This is a maintenance script, not part of the regular build. Run it and
 * commit the resulting static/agdai-manifest.json when the bundled stdlib,
 * Cubical, or Agda version changes.
 */

import { readFile, writeFile, mkdir, mkdtemp, readdir, cp, rm } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { extractZip } from './zip-utils.mjs'
import { REPO_ROOT, getSelectedLibraries } from './resolve-deploy-config.mjs'

const execFileAsync = promisify(execFile)

const STATIC = join(REPO_ROOT, 'static')

// Everything.agda must sit inside the library's own include path so its
// module name ("Everything") resolves there, not at the extraction root.
const EVERYTHING_FILENAME = 'Everything.agda'

async function findSoleSubdir(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const dirs = entries.filter(e => e.isDirectory())
  if (dirs.length !== 1) {
    throw new Error(`expected exactly one subdirectory in ${dir}, found: ${dirs.map(d => d.name).join(', ') || '(none)'}`)
  }
  return dirs[0].name
}

function parseAgdaLibInclude(src) {
  const m = src.match(/^include:\s*(.+)/m)
  const include = m ? m[1].trim().split(/\s+/)[0] : '.'
  return include === '.' ? '' : include
}

async function findAgdaFiles(dir, result = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) await findAgdaFiles(p, result)
    else if (entry.name.endsWith('.agda') && entry.name !== 'Everything.agda') result.push(p)
  }
  return result
}

function pathToModuleName(filePath, includeDir) {
  return relative(includeDir, filePath)
    .replace(/\.agda$/, '')
    .split(sep)
    .join('.')
}

function parseDot(dotFile, content) {
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

/** Extracts a library's source archive and locates its .agda-lib/include dir. */
async function extractLibrarySource(lib, workDir) {
  console.log(`[${lib.name}@${lib.version}] extracting source archive...`)
  const extractDir = join(workDir, lib.name)
  await mkdir(extractDir, { recursive: true })
  await extractZip(join(STATIC, 'library', lib.sourceZipName), extractDir)
  const libRoot = join(extractDir, await findSoleSubdir(extractDir))

  const agdaLibFile = (await readdir(libRoot)).find(f => f.endsWith('.agda-lib'))
  if (!agdaLibFile) throw new Error(`[${lib.name}] no .agda-lib file found in ${libRoot}`)
  const include = parseAgdaLibInclude(await readFile(join(libRoot, agdaLibFile), 'utf8'))
  const includeDir = include ? join(libRoot, include) : libRoot

  return { lib, libRoot, includeDir, agdaLibFile }
}

/**
 * Builds Everything.agda, runs `agda --dependency-graph`, returns its parsed
 * edge map. `libraryFilePath` must register every selected library's
 * .agda-lib (not just this one's) so libraries with a `depend:` on another
 * configured library (e.g. agda-categories on standard-library) resolve,
 * mirroring how the browser runtime registers all of a profile's libraries
 * together.
 */
async function buildLibraryGraph({ lib, libRoot, includeDir }, workDir, libraryFilePath) {
  const agdaiDir = join(STATIC, 'agdai', lib.name)

  if (lib.agdaiZipName) {
    console.log(`[${lib.name}] copying prebuilt .agdai cache...`)
    const agdaVersion = await findSoleSubdir(join(agdaiDir, '_build'))
    await cp(join(agdaiDir, '_build'), join(libRoot, '_build'), { recursive: true })
    console.log(`[${lib.name}] .agdai cache was built with Agda ${agdaVersion}`)
  } else {
    console.log(`[${lib.name}] no prebuilt .agdai cache configured; agda will type-check from source (slower).`)
  }

  console.log(`[${lib.name}] generating Everything.agda...`)
  const agdaFiles = (await findAgdaFiles(includeDir)).sort()
  const ownModules = new Set(agdaFiles.map(f => pathToModuleName(f, includeDir)))
  const everythingPath = join(includeDir, EVERYTHING_FILENAME)
  const imports = agdaFiles.map(f => `import ${pathToModuleName(f, includeDir)}`)
  const pragma = lib.optionsPragma ? `${lib.optionsPragma}\n` : ''
  await writeFile(everythingPath, `${pragma}module Everything where\n${imports.join('\n')}\n`)

  console.log(`[${lib.name}] running agda --dependency-graph (this can take a while)...`)
  const dotFile = join(workDir, `${lib.name}.dot`)
  try {
    await execFileAsync('agda', [
      `--library-file=${libraryFilePath}`,
      '-i', includeDir,
      '--only-scope-checking',
      `--dependency-graph=${dotFile}`,
      everythingPath,
    ], { cwd: libRoot, maxBuffer: 64 * 1024 * 1024 })
  } catch (err) {
    // agda exits non-zero on warnings (e.g. deprecated modules) even though
    // the Dot backend still wrote its output; only fail if the file is missing.
    console.warn(`[${lib.name}] agda exited with a warning/error (continuing if dependency graph was still written):`)
    console.warn(err.stderr || err.message)
  } finally {
    // Each other selected library is also registered in libraryFilePath, so
    // its include dir is on the search path while checking this one. Leaving
    // this Everything.agda in place would make the next library's check see
    // two same-named top-level modules (AmbiguousTopLevelModuleName).
    await rm(everythingPath, { force: true })
  }

  const dotContent = await readFile(dotFile, 'utf8').catch(() => {
    throw new Error(`[${lib.name}] agda did not produce a dependency graph at ${dotFile}`)
  })
  // edges includes every transitively-checked module, including ones from
  // libraries this one depends on (e.g. agda-categories pulls in stdlib
  // modules) — ownModules narrows attribution to modules this library
  // actually defines, so a later library's pass can't steal ownership of an
  // earlier library's module it merely imports.
  return { edges: parseDot(dotFile, dotContent), ownModules }
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'agda-manifest-'))

  try {
    const extracted = []
    for (const lib of getSelectedLibraries()) {
      extracted.push(await extractLibrarySource(lib, dir))
    }

    // Shared across all libraries (not per-profile): registering extra
    // libraries that a given check doesn't depend on is harmless, and the
    // manifest itself is a flat union over every selected library anyway.
    const libraryFilePath = join(dir, 'libraries')
    await writeFile(libraryFilePath, extracted.map(e => join(e.libRoot, e.agdaLibFile)).join('\n') + '\n')

    const graphs = {}
    const libOf = {}
    for (const entry of extracted) {
      const { edges, ownModules } = await buildLibraryGraph(entry, dir, libraryFilePath)
      for (const mod of ownModules) libOf[mod] = entry.lib.libKey
      Object.assign(graphs, edges)
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
    await writeFile(join(STATIC, 'agdai-manifest.json'), json)

    console.log(`\nDone. ${Object.keys(graph).length} modules, ${(json.length / 1024).toFixed(0)} KB written to static/agdai-manifest.json`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

main().catch(err => { console.error(err); process.exit(1) })
