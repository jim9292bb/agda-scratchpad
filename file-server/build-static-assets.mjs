/**
 * Builds static/{library,als}/ and static/agdai/ from the raw files in
 * file-server/{library,als}/ — the one place that turns "files a deployer
 * placed by hand" into "what the browser runtime actually fetches".
 *
 * Per selected library:
 *   - zips file-server/library/<name>/ (excluding _build/ and any leftover
 *     Everything.agda) into static/library/<sourceZipName>, wrapped under
 *     a folder named archiveRootPrefix — this reproduces the shape of a
 *     GitHub tag-archive zip, so the browser's existing client-side unzip
 *     (which strips that wrapper) needs no changes.
 *   - if file-server/library/<name>/_build/ exists, copies it as-is into
 *     static/agdai/<name>/_build/ (already individual .agdai files — no
 *     zip involved at any point for these; they're served flat on demand).
 *
 * Per selected ALS version:
 *   - copies file-server/als/<wasmFilename> into static/als/ unchanged.
 *   - if file-server/als/agda-data/ exists and dataZipName is configured,
 *     zips it (no wrapper — the browser unzips agda-data.zip at the VFS
 *     root) into static/als/<dataZipName>.
 *
 * If file-server/agdai-manifest.json exists, copies it to
 * static/agdai-manifest.json unchanged (it's already the final shape —
 * see file-server/dot-to-manifest.mjs). If absent, prefetching is simply
 * disabled at runtime (src/lib/agda/prefetch.js degrades gracefully).
 *
 * Run via `npm run setup` (scripts/setup-assets.sh), after
 * file-server/print-required-files.mjs has confirmed everything needed is
 * present.
 */

import { cp, mkdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { zipDirectory } from './zip-utils.mjs'
import { REPO_ROOT, getSelectedAlsVersions, getSelectedLibraries } from './resolve-deploy-config.mjs'

const FILE_SERVER = join(REPO_ROOT, 'file-server')
const STATIC = join(REPO_ROOT, 'static')

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function main() {
  await mkdir(join(STATIC, 'library'), { recursive: true })
  await mkdir(join(STATIC, 'als'), { recursive: true })
  await mkdir(join(STATIC, 'agdai'), { recursive: true })

  for (const lib of getSelectedLibraries()) {
    const libRoot = join(FILE_SERVER, 'library', lib.name)

    console.log(`[${lib.name}] zipping source into static/library/${lib.sourceZipName}...`)
    await zipDirectory(libRoot, join(STATIC, 'library', lib.sourceZipName), {
      prefix: lib.archiveRootPrefix,
      exclude: ['_build', 'Everything.agda'],
    })

    const buildDir = join(libRoot, '_build')
    if (await exists(buildDir)) {
      console.log(`[${lib.name}] copying prebuilt .agdai cache into static/agdai/${lib.name}/_build/...`)
      await cp(buildDir, join(STATIC, 'agdai', lib.name, '_build'), { recursive: true })
    }
  }

  for (const als of getSelectedAlsVersions()) {
    console.log(`[als ${als.version}] copying ${als.wasmFilename}...`)
    await cp(join(FILE_SERVER, 'als', als.wasmFilename), join(STATIC, 'als', als.wasmFilename))

    const dataDir = join(FILE_SERVER, 'als', 'agda-data')
    if (als.dataZipName && (await exists(dataDir))) {
      console.log(`[als ${als.version}] zipping agda-data/ into static/als/${als.dataZipName}...`)
      await zipDirectory(dataDir, join(STATIC, 'als', als.dataZipName))
    }
  }

  const manifestSrc = join(FILE_SERVER, 'agdai-manifest.json')
  if (await exists(manifestSrc)) {
    console.log('Copying agdai-manifest.json...')
    await cp(manifestSrc, join(STATIC, 'agdai-manifest.json'))
  } else {
    console.log('No file-server/agdai-manifest.json — prefetching will be disabled (.agdai files still load on demand).')
  }

  console.log('Done.')
}

main().catch(err => { console.error(err); process.exit(1) })
