/**
 * Offline --build-library experiment using native Agda 2.8.0.
 *
 * Extracts each configured library's zip into a temp directory, runs native
 * `agda --build-library` for each, collects the generated .agdai files,
 * and writes them to results/ as zip archives.
 *
 * agda-categories depends on standard-library-2.3 (`depend:` in its
 * .agda-lib), so it needs stdlib's source extracted and registered in the
 * shared `libraries` config file even when only building agda-categories.
 *
 * Prerequisites: `agda` 2.8.0 binary in $PATH.
 *
 * Usage:
 *   node src/build-agdai.mjs                    # stdlib, cubical, agda-categories
 *   node src/build-agdai.mjs --stdlib-only
 *   node src/build-agdai.mjs --cubical-only
 *   node src/build-agdai.mjs --agda-categories-only
 */

import { readFile, writeFile, mkdir, rm, mkdtemp } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createReadStream } from 'node:fs'
import JSZip from '../node_modules/jszip/dist/jszip.js'
import { findLibrary } from '../../../deploy-assets/libraries.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT   = join(__dirname, '..')
const STATIC = join(__dirname, '../../../static')
const RESULTS = join(ROOT, 'results')

const STDLIB_ENTRY          = findLibrary('stdlib', '2.3')
const CUBICAL_ENTRY         = findLibrary('cubical', '0.9')
const AGDA_CATEGORIES_ENTRY = findLibrary('agda-categories', '0.3.0')

const STDLIB_ZIP          = join(STATIC, 'library', STDLIB_ENTRY.sourceZipName)
const CUBICAL_ZIP         = join(STATIC, 'library', CUBICAL_ENTRY.sourceZipName)
const AGDA_CATEGORIES_ZIP = join(STATIC, 'library', AGDA_CATEGORIES_ENTRY.sourceZipName)

/** Strips entry.archiveRootPrefix and keeps only includeSubpath/ + agdaLibFile, mirroring src/lib/worker/als-wasi-shim.ts's buildFilesystem(). */
function stripArchiveRoot(entry) {
  return path => {
    if (!path.startsWith(`${entry.archiveRootPrefix}/`)) return null
    const rel = path.slice(entry.archiveRootPrefix.length + 1)
    if (!entry.includeSubpath) return rel
    if (rel.startsWith(`${entry.includeSubpath}/`) || rel === entry.agdaLibFile) return rel
    return null
  }
}

const cliArgs = process.argv.slice(2)
const stdlibOnly     = cliArgs.includes('--stdlib-only')
const cubicalOnly    = cliArgs.includes('--cubical-only')
const categoriesOnly = cliArgs.includes('--agda-categories-only')
const anyOnly        = stdlibOnly || cubicalOnly || categoriesOnly
const runStdlib     = anyOnly ? stdlibOnly : true
const runCubical    = anyOnly ? cubicalOnly : true
const runCategories = anyOnly ? categoriesOnly : true
// agda-categories depends on stdlib, so stdlib's source must be extracted
// (and registered in the shared libraries file) whenever agda-categories
// runs, even on an --agda-categories-only invocation that isn't rebuilding
// stdlib's own .agdai zip.
const extractStdlib = runStdlib || runCategories

// ---------------------------------------------------------------------------
// Zip extraction to disk
// ---------------------------------------------------------------------------

async function extractZip(zipPath, destDir, pathFilter) {
  const buf = await readFile(zipPath)
  const zip = await JSZip.loadAsync(buf)
  const tasks = []
  zip.forEach((path, entry) => {
    if (entry.dir) return
    const rel = pathFilter(path)
    if (rel == null) return
    tasks.push((async () => {
      const data = await entry.async('uint8array')
      const out = join(destDir, rel)
      await mkdir(dirname(out), { recursive: true })
      await writeFile(out, data)
    })())
  })
  await Promise.all(tasks)
  return tasks.length
}

// ---------------------------------------------------------------------------
// Zip collection from disk
// ---------------------------------------------------------------------------

/**
 * `--build-library` caches interfaces for every module it type-checks,
 * including ones from a *depended-on* library (e.g. building agda-categories
 * also writes stdlib interfaces under agda-categories' _build/, since both
 * share AGDA_DIR/HOME for that invocation). `libDir` is used to verify each
 * candidate .agdai actually has a matching .agda source under this library's
 * own root, filtering out interfaces that just happen to be a dependency's.
 */
async function collectAgdai(dir, baseDir, zip, libDir, prefix = '') {
  const { readdir, stat, access } = await import('node:fs/promises')
  const entries = await readdir(dir)
  let count = 0
  for (const entry of entries) {
    const full = join(dir, entry)
    const rel = prefix ? `${prefix}/${entry}` : entry
    const s = await stat(full)
    if (s.isDirectory()) {
      count += await collectAgdai(full, baseDir, zip, libDir, rel)
    } else if (entry.endsWith('.agdai')) {
      const sourcePath = join(libDir, rel.replace(/^_build\/[^/]+\/agda\//, '').replace(/\.agdai$/, '.agda'))
      const ownsSource = await access(sourcePath).then(() => true, () => false)
      if (!ownsSource) continue
      const data = await readFile(full)
      zip.file(rel, data)
      count++
    }
  }
  return count
}

// ---------------------------------------------------------------------------
// Native agda invocation
// ---------------------------------------------------------------------------

function agdaVersion() {
  const result = spawnSync('agda', ['--version'], { encoding: 'utf8' })
  return result.stdout?.trim() ?? '(unknown)'
}

function runBuildLibrary(libDir, configDir) {
  const t = performance.now()
  const result = spawnSync(
    'agda',
    ['--build-library'],
    {
      cwd: libDir,
      env: {
        ...process.env,
        HOME: libDir,
        AGDA_DIR: configDir,
      },
      encoding: 'utf8',
      // agda-categories' full --build-library (not just scope-checking) ran
      // past the previous 600s timeout (370/502 modules checked); stdlib and
      // cubical comfortably finish well under this too.
      timeout: 1_800_000,
    }
  )
  const elapsedS = ((performance.now() - t) / 1000).toFixed(1)

  if (result.stderr) process.stderr.write(result.stderr)
  if (result.stdout) process.stdout.write(result.stdout)

  return { exitCode: result.status ?? 1, elapsedS }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Agda binary: ${agdaVersion()}`)

  const tmpBase = await mkdtemp(join(tmpdir(), 'agda-build-library-'))
  console.log(`Working directory: ${tmpBase}`)

  try {
    // Shared directory layout used by all libraries
    const stdlibDir  = join(tmpBase, 'stdlib')
    const cubicalDir = join(tmpBase, 'cubical')
    const categoriesDir = join(tmpBase, 'agda-categories')
    const configDir  = join(tmpBase, 'config')
    const libsFile   = join(configDir, 'libraries')

    await mkdir(configDir, { recursive: true })

    const registeredLibs = []

    if (extractStdlib) {
      console.log('\nExtracting stdlib...')
      const t1 = performance.now()
      const stdlibCount = await extractZip(STDLIB_ZIP, stdlibDir, stripArchiveRoot(STDLIB_ENTRY))
      console.log(`  ${stdlibCount} files in ${((performance.now() - t1) / 1000).toFixed(1)}s`)
      registeredLibs.push(join(stdlibDir, 'standard-library.agda-lib'))
    }

    if (runCubical) {
      console.log('Extracting cubical...')
      const t2 = performance.now()
      const cubicalCount = await extractZip(CUBICAL_ZIP, cubicalDir, stripArchiveRoot(CUBICAL_ENTRY))
      console.log(`  ${cubicalCount} files in ${((performance.now() - t2) / 1000).toFixed(1)}s`)
      registeredLibs.push(join(cubicalDir, 'cubical.agda-lib'))
    }

    if (runCategories) {
      console.log('Extracting agda-categories...')
      const t3 = performance.now()
      const categoriesCount = await extractZip(AGDA_CATEGORIES_ZIP, categoriesDir, stripArchiveRoot(AGDA_CATEGORIES_ENTRY))
      console.log(`  ${categoriesCount} files in ${((performance.now() - t3) / 1000).toFixed(1)}s`)
      registeredLibs.push(join(categoriesDir, 'agda-categories.agda-lib'))
    }

    // Write libraries config file (paths must be absolute for native Agda).
    // Every extracted library is registered together, even ones not being
    // rebuilt this invocation, so depend: references (agda-categories on
    // stdlib) resolve the same way the browser runtime resolves them.
    await writeFile(libsFile, registeredLibs.join('\n') + '\n')

    await mkdir(RESULTS, { recursive: true })

    if (runStdlib) {
      console.log(`\nRunning: agda --build-library (cwd=${stdlibDir})`)
      const { exitCode, elapsedS } = runBuildLibrary(stdlibDir, configDir)
      console.log(`  exit=${exitCode}, ${elapsedS}s`)
      if (exitCode !== 0) {
        console.warn(`  WARNING: exited with ${exitCode}, collecting partial results`)
      }

      const zip = new JSZip()
      const count = await collectAgdai(stdlibDir, stdlibDir, zip, stdlibDir)
      console.log(`  collected ${count} .agdai files`)

      if (count > 0) {
        const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
        const out = join(RESULTS, 'stdlib-agdai.zip')
        await writeFile(out, bytes)
        console.log(`  wrote ${out} (${(bytes.byteLength / 1024).toFixed(0)} KiB)`)
      }
    }

    if (runCubical) {
      console.log(`\nRunning: agda --build-library (cwd=${cubicalDir})`)
      const { exitCode, elapsedS } = runBuildLibrary(cubicalDir, configDir)
      console.log(`  exit=${exitCode}, ${elapsedS}s`)
      if (exitCode !== 0) {
        console.warn(`  WARNING: exited with ${exitCode}, collecting partial results`)
      }

      const zip = new JSZip()
      const count = await collectAgdai(cubicalDir, cubicalDir, zip, cubicalDir)
      console.log(`  collected ${count} .agdai files`)

      if (count > 0) {
        const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
        const out = join(RESULTS, 'cubical-agdai.zip')
        await writeFile(out, bytes)
        console.log(`  wrote ${out} (${(bytes.byteLength / 1024).toFixed(0)} KiB)`)
      }
    }

    if (runCategories) {
      console.log(`\nRunning: agda --build-library (cwd=${categoriesDir})`)
      const { exitCode, elapsedS } = runBuildLibrary(categoriesDir, configDir)
      console.log(`  exit=${exitCode}, ${elapsedS}s`)
      if (exitCode !== 0) {
        console.warn(`  WARNING: exited with ${exitCode}, collecting partial results`)
      }

      const zip = new JSZip()
      const count = await collectAgdai(categoriesDir, categoriesDir, zip, categoriesDir)
      console.log(`  collected ${count} .agdai files`)

      if (count > 0) {
        const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
        const out = join(RESULTS, 'agda-categories-agdai.zip')
        await writeFile(out, bytes)
        console.log(`  wrote ${out} (${(bytes.byteLength / 1024).toFixed(0)} KiB)`)
      }
    }

  } finally {
    await rm(tmpBase, { recursive: true, force: true })
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
