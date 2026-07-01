/**
 * Compiles all Agda builtin source files to produce a complete _build/ interface
 * cache in deploy-assets/als/<version>/agda-data/.
 *
 * Running native `agda` on a library only compiles the builtins that library
 * imports, leaving others without a precompiled .agdai. This script ensures
 * full coverage by compiling each .agda file in agda's own prim directory
 * (so there is no include-path conflict), then syncing the resulting _build/
 * into our agda-data copy.
 *
 * Usage:
 *   node deploy-assets/build-agda-data.mjs [--als-version <version>] [--agda-bin <path>]
 *
 * Without --als-version, processes agda-data/ for every ALS version in deploy.config.json.
 * --agda-bin defaults to "agda" on PATH.
 */

import { readdir, access, cp, rm } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { getSelectedAlsVersions, REPO_ROOT } from './resolve-deploy-config.mjs'

const DEPLOY_ASSETS = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const args = { alsVersion: null, agdaBin: 'agda' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--als-version') args.alsVersion = argv[++i]
    else if (argv[i] === '--agda-bin') args.agdaBin = argv[++i]
    else { console.error(`unknown argument: ${argv[i]}`); process.exit(1) }
  }
  return args
}

async function exists(p) {
  try { await access(p); return true } catch { return false }
}

async function findAgdaFiles(dir) {
  const results = []
  async function walk(d) {
    const entries = await readdir(d, { withFileTypes: true })
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name !== '_build') await walk(join(d, e.name))
      } else if (e.isFile() && e.name.endsWith('.agda')) {
        results.push(join(d, e.name))
      }
    }
  }
  await walk(dir)
  return results
}

// Find where Agda/Primitive.agda lives inside agdaDataDir.
// Handles two layouts:
//   agda-data/Agda/Primitive.agda          (cp -r .../lib/prim/ agda-data/)
//   agda-data/lib/prim/Agda/Primitive.agda (cp -r .../lib agda-data/)
async function findPrimRoot(agdaDataDir) {
  for (const candidate of [agdaDataDir, join(agdaDataDir, 'lib', 'prim')]) {
    if (await exists(join(candidate, 'Agda', 'Primitive.agda'))) return candidate
  }
  return null
}

async function buildAgdaData(agdaDataDir, agdaBin) {
  if (!(await exists(agdaDataDir))) {
    console.log(`  skipping — not present: ${relative(REPO_ROOT, agdaDataDir)}`)
    return 0
  }

  const ourPrimRoot = await findPrimRoot(agdaDataDir)
  if (!ourPrimRoot) {
    throw new Error(`cannot find Agda/Primitive.agda under ${agdaDataDir} — is agda-data set up correctly?`)
  }

  const printResult = spawnSync(agdaBin, ['--print-agda-dir'], { encoding: 'utf8' })
  if (printResult.status !== 0 || !printResult.stdout.trim()) {
    throw new Error(`"${agdaBin} --print-agda-dir" failed`)
  }
  const agdaPrimDir = join(printResult.stdout.trim(), 'lib', 'prim')

  if (!(await exists(agdaPrimDir))) {
    throw new Error(`agda prim dir not found: ${agdaPrimDir}`)
  }

  const files = await findAgdaFiles(agdaPrimDir)
  console.log(`  ${files.length} .agda files in ${agdaPrimDir}`)

  const t0 = performance.now()
  let failures = 0
  for (const file of files) {
    const rel = relative(agdaPrimDir, file)
    // Run agda with the file's absolute path and no -i flag. Agda resolves
    // its own prim directory internally; adding -i would create a duplicate
    // path and trigger AmbiguousTopLevelModuleName.
    const result = spawnSync(agdaBin, [file], {
      encoding: 'utf8',
      timeout: 60_000,
    })
    if (result.status !== 0) {
      console.error(`  FAIL: ${rel}`)
      if (result.stderr) console.error(result.stderr.trimEnd())
      failures++
    } else {
      console.log(`  ok: ${rel}`)
    }
  }

  const elapsed = ((performance.now() - t0) / 1000).toFixed(1)
  console.log(`  compiled ${files.length} files in ${elapsed}s, ${failures} failure(s)`)

  if (failures === 0) {
    const srcBuild = join(agdaPrimDir, '_build')
    const dstBuild = join(ourPrimRoot, '_build')
    if (await exists(srcBuild)) {
      await rm(dstBuild, { recursive: true, force: true })
      await cp(srcBuild, dstBuild, { recursive: true })
      console.log(`  copied _build/ → ${relative(REPO_ROOT, dstBuild)}`)
    } else {
      console.warn(`  warning: no _build/ found in ${agdaPrimDir} after compilation`)
    }
  }

  return failures
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const versions = [...getSelectedAlsVersions().values()]
  const targets = args.alsVersion
    ? versions.filter(v => v.version === args.alsVersion)
    : versions

  if (args.alsVersion && targets.length === 0) {
    console.error(`als-version "${args.alsVersion}" not found in deploy.config.json`)
    process.exit(1)
  }

  let totalFailures = 0
  for (const { version } of targets) {
    const agdaDataDir = join(DEPLOY_ASSETS, 'als', version, 'agda-data')
    console.log(`\nALS ${version}: ${relative(REPO_ROOT, agdaDataDir)}`)
    totalFailures += await buildAgdaData(agdaDataDir, args.agdaBin)
  }

  if (totalFailures > 0) {
    console.error(`\n${totalFailures} file(s) failed to compile`)
    process.exit(1)
  }
  console.log('\nDone.')
}

main().catch(err => { console.error(err); process.exit(1) })
