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
import { fileURLToPath } from 'node:url'
import { join, dirname, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { extractZip } from './zip-utils.mjs'
import { LIBRARIES } from './libraries.mjs'

const execFileAsync = promisify(execFile)

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATIC = join(__dirname, '../static')

// Everything.agda must sit inside the library's own include path so its
// module name ("Everything") resolves there, not at the extraction root.
const EVERYTHING_FILENAME = 'Everything.agda'

async function findOne(dir, pattern) {
  const entries = await readdir(dir)
  const matches = entries.filter(e => pattern.test(e))
  if (matches.length !== 1) {
    throw new Error(`expected exactly one match for ${pattern} in ${dir}, found: ${matches.join(', ') || '(none)'}`)
  }
  return matches[0]
}

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

/** Builds Everything.agda, runs `agda --dependency-graph`, returns its parsed edge map. */
async function buildLibraryGraph(lib, workDir) {
  const agdaiDir = join(STATIC, 'agdai', lib.name)

  console.log(`[${lib.name}] extracting source archive...`)
  const zipName = await findOne(STATIC, lib.sourceZipPattern)
  const extractDir = join(workDir, lib.name)
  await mkdir(extractDir, { recursive: true })
  await extractZip(join(STATIC, zipName), extractDir)
  const libRoot = join(extractDir, await findSoleSubdir(extractDir))

  const agdaLibFile = (await readdir(libRoot)).find(f => f.endsWith('.agda-lib'))
  if (!agdaLibFile) throw new Error(`[${lib.name}] no .agda-lib file found in ${libRoot}`)
  const include = parseAgdaLibInclude(await readFile(join(libRoot, agdaLibFile), 'utf8'))
  const includeDir = include ? join(libRoot, include) : libRoot

  console.log(`[${lib.name}] copying prebuilt .agdai cache (include="${include || '.'}")...`)
  const agdaVersion = await findSoleSubdir(join(agdaiDir, '_build'))
  await cp(join(agdaiDir, '_build'), join(libRoot, '_build'), { recursive: true })

  console.log(`[${lib.name}] generating Everything.agda...`)
  const agdaFiles = (await findAgdaFiles(includeDir)).sort()
  const everythingPath = join(includeDir, EVERYTHING_FILENAME)
  const imports = agdaFiles.map(f => `import ${pathToModuleName(f, includeDir)}`)
  await writeFile(everythingPath, `${lib.optionsPragma}\nmodule Everything where\n${imports.join('\n')}\n`)

  console.log(`[${lib.name}] running agda --dependency-graph (this can take a while)...`)
  const dotFile = join(workDir, `${lib.name}.dot`)
  try {
    await execFileAsync('agda', [
      '--library-file=/dev/null',
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
  }

  const dotContent = await readFile(dotFile, 'utf8').catch(() => {
    throw new Error(`[${lib.name}] agda did not produce a dependency graph at ${dotFile}`)
  })
  console.log(`[${lib.name}] agda version used for .agdai cache: ${agdaVersion}`)
  return parseDot(dotFile, dotContent)
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'agda-manifest-'))

  try {
    const graphs = {}
    const libOf = {}
    for (const lib of LIBRARIES) {
      const edges = await buildLibraryGraph(lib, dir)
      for (const mod of Object.keys(edges)) libOf[mod] = lib.libKey
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
