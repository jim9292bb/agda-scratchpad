/**
 * Compiles all Agda builtin source files in deploy-assets/als/<version>/agda-data/
 * to produce a complete _build/ interface cache — every builtin module, not just
 * those transitively reachable from a library you've already type-checked.
 *
 * Running native `agda` on a library only compiles the builtins that library
 * imports, leaving others without a precompiled .agdai. This script ensures
 * full coverage by compiling each .agda file in agda-data/ directly; agda
 * handles transitive dependencies automatically, so ordering doesn't matter.
 *
 * Usage:
 *   node deploy-assets/build-agda-data.mjs [--als-version <version>] [--agda-bin <path>]
 *
 * Without --als-version, processes agda-data/ for every ALS version in deploy.config.json.
 * --agda-bin defaults to "agda" on PATH.
 */

import { readdir, access } from 'node:fs/promises'
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

async function buildAgdaData(agdaDataDir, agdaBin) {
  if (!(await exists(agdaDataDir))) {
    console.log(`  skipping — not present: ${relative(REPO_ROOT, agdaDataDir)}`)
    return 0
  }

  const files = await findAgdaFiles(agdaDataDir)
  console.log(`  ${files.length} .agda files found`)

  let failures = 0
  for (const file of files) {
    const rel = relative(agdaDataDir, file)
    const result = spawnSync(agdaBin, ['-i', agdaDataDir, '--only-type-check', file], {
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
