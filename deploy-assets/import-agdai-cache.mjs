/**
 * Copies prebuilt .agdai files from a library's own _build/ directory
 * (produced by normal Agda usage) into deploy-assets/.cache/<id>/_build/.
 *
 * Use this when you've already type-checked the library with native Agda
 * and don't want to re-run it via `npm run build-agdai`.
 *
 * Usage:
 *   node deploy-assets/import-agdai-cache.mjs [--library <name>] [--force]
 *
 * Without --library, processes all libraries in deploy.local.json that have
 * useAgdai: true. With --library <name>, processes only that one.
 * --force overwrites an existing .cache/<id>/_build/ without prompting.
 */

import { access, cp, rm, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getLocalLibraries } from './resolve-deploy-config.mjs'

function parseArgs(argv) {
  const args = { library: null, force: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--library') args.library = argv[++i]
    else if (argv[i] === '--force') args.force = true
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  return args
}

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

async function importLibrary(lib, force) {
  const src = join(dirname(lib.agdaLibPath), '_build')
  const dst = join(lib.cacheDir, '_build')

  if (!(await exists(src))) {
    console.error(`[${lib.name}] no _build/ found at ${src} — type-check the library with native Agda first.`)
    return false
  }

  if (await exists(dst)) {
    if (!force) {
      console.error(`[${lib.name}] .cache/${lib.cacheId}/_build/ already exists — use --force to overwrite.`)
      return false
    }
    await rm(dst, { recursive: true })
  }

  await mkdir(lib.cacheDir, { recursive: true })
  await cp(src, dst, { recursive: true })
  console.log(`[${lib.name}] copied ${src} → .cache/${lib.cacheId}/_build/`)
  return true
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
      return
    }
  }

  let ok = true
  for (const lib of libs) {
    if (!(await importLibrary(lib, args.force))) ok = false
  }
  if (!ok) process.exit(1)
  console.log('Run `npm run setup` to copy .agdai files into static/.')
}

main().catch(err => { console.error(err); process.exit(1) })
