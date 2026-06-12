/**
 * Offline --build-library experiment using native Agda 2.8.0.
 *
 * Extracts stdlib and cubical zips into a temp directory, runs native
 * `agda --build-library` for each, collects the generated .agdai files,
 * and writes them to results/ as zip archives.
 *
 * Prerequisites: `agda` 2.8.0 binary in $PATH.
 *
 * Usage:
 *   node src/build-agdai.mjs               # both stdlib and cubical
 *   node src/build-agdai.mjs --stdlib-only
 *   node src/build-agdai.mjs --cubical-only
 */

import { readFile, writeFile, mkdir, rm, mkdtemp } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createReadStream } from 'node:fs'
import JSZip from '../node_modules/jszip/dist/jszip.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT   = join(__dirname, '..')
const STATIC = join(__dirname, '../../../static')
const RESULTS = join(ROOT, 'results')

const STDLIB_ZIP  = join(STATIC, 'agda-stdlib-2.3.zip')
const CUBICAL_ZIP = join(STATIC, 'agda-cubical-0.9.zip')

// Library names as they appear in the .agda-lib `name:` field
const STDLIB_LIB_NAME  = 'standard-library-2.3'
const CUBICAL_LIB_NAME = 'cubical-0.9'

const cliArgs = process.argv.slice(2)
const stdlibOnly  = cliArgs.includes('--stdlib-only')
const cubicalOnly = cliArgs.includes('--cubical-only')
const runStdlib   = !cubicalOnly
const runCubical  = !stdlibOnly

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

async function collectAgdai(dir, baseDir, zip, prefix = '') {
  const { readdir, stat } = await import('node:fs/promises')
  const entries = await readdir(dir)
  let count = 0
  for (const entry of entries) {
    const full = join(dir, entry)
    const rel = prefix ? `${prefix}/${entry}` : entry
    const s = await stat(full)
    if (s.isDirectory()) {
      count += await collectAgdai(full, baseDir, zip, rel)
    } else if (entry.endsWith('.agdai')) {
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
      timeout: 600_000,
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
    // Shared directory layout used by both libraries
    const stdlibDir  = join(tmpBase, 'stdlib')
    const cubicalDir = join(tmpBase, 'cubical')
    const configDir  = join(tmpBase, 'config')
    const libsFile   = join(configDir, 'libraries')

    await mkdir(configDir, { recursive: true })

    // Extract stdlib
    console.log('\nExtracting stdlib...')
    const t1 = performance.now()
    const stdlibCount = await extractZip(STDLIB_ZIP, stdlibDir, path => {
      if (path.match(/^agda-stdlib-[\d.]+\/standard-library\.agda-lib$/)) {
        return path.replace(/^agda-stdlib-[\d.]+\//, '')
      }
      if (path.match(/^agda-stdlib-[\d.]+\/src\//)) {
        return path.replace(/^agda-stdlib-[\d.]+\//, '')
      }
      return null
    })
    console.log(`  ${stdlibCount} files in ${((performance.now() - t1) / 1000).toFixed(1)}s`)

    // Extract cubical
    console.log('Extracting cubical...')
    const t2 = performance.now()
    const cubicalCount = await extractZip(CUBICAL_ZIP, cubicalDir, path => {
      if (!path.match(/^cubical-[\d.]+\//)) return null
      return path.replace(/^cubical-[\d.]+\//, '')
    })
    console.log(`  ${cubicalCount} files in ${((performance.now() - t2) / 1000).toFixed(1)}s`)

    // Write libraries config file (paths must be absolute for native Agda)
    await writeFile(libsFile,
      `${join(stdlibDir, 'standard-library.agda-lib')}\n${join(cubicalDir, 'cubical.agda-lib')}\n`)

    await mkdir(RESULTS, { recursive: true })

    if (runStdlib) {
      console.log(`\nRunning: agda --build-library (cwd=${stdlibDir})`)
      const { exitCode, elapsedS } = runBuildLibrary(stdlibDir, configDir)
      console.log(`  exit=${exitCode}, ${elapsedS}s`)
      if (exitCode !== 0) {
        console.warn(`  WARNING: exited with ${exitCode}, collecting partial results`)
      }

      const zip = new JSZip()
      const count = await collectAgdai(stdlibDir, stdlibDir, zip)
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
      const count = await collectAgdai(cubicalDir, cubicalDir, zip)
      console.log(`  collected ${count} .agdai files`)

      if (count > 0) {
        const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
        const out = join(RESULTS, 'cubical-agdai.zip')
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
