/**
 * Fetches this project's own shipped default library/ALS files, places
 * library sources into deploy-assets/library/<name>/, creates or updates
 * deploy.config.json to point at them, and populates
 * deploy-assets/.cache/<id>/ with prebuilt .agdai and dependency-graph
 * manifests from the release.
 *
 * This is NOT a generic, deploy.config.json-driven downloader — it doesn't
 * read the catalogs or deploy.config.json at all. It's hardcoded for this
 * project's own shipped defaults (stdlib 2.3, cubical 0.9, agda-categories
 * 0.3.0, ALS 2.8.0). If you add a library/ALS version of your own, place
 * files by hand instead; see deploy-assets/README.md.
 *
 * Safe to run repeatedly: each step is skipped if its output already exists.
 *
 * After this script finishes, run `npm run setup` to build static/.
 *
 * Usage: node deploy-assets/auto-configure.mjs
 */

import { mkdir, mkdtemp, rm, readdir, cp, access, writeFile, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { extractZip } from './zip-utils.mjs'
import { getLocalLibraries } from './resolve-deploy-config.mjs'

const DEPLOY_ASSETS = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(DEPLOY_ASSETS, '..')
const RELEASE = 'https://github.com/jim9292bb/agda-playground/releases/download/cache-2.8.0'

// Hardcoded metadata for this project's shipped defaults.
// Each entry: { name, agdaLibFile, sourceUrl, releaseAssetPrefix }
const SHIPPED_LIBRARIES = [
  {
    name: 'standard-library',
    agdaLibFile: 'standard-library.agda-lib',
    sourceUrl: 'https://github.com/agda/agda-stdlib/archive/refs/tags/v2.3.zip',
    releaseAssetPrefix: 'stdlib',
  },
  {
    name: 'cubical',
    agdaLibFile: 'cubical.agda-lib',
    sourceUrl: 'https://github.com/agda/cubical/archive/refs/tags/v0.9.zip',
    releaseAssetPrefix: 'cubical',
  },
  {
    name: 'agda-categories',
    agdaLibFile: 'agda-categories.agda-lib',
    sourceUrl: 'https://github.com/agda/agda-categories/archive/refs/tags/v0.3.0.zip',
    releaseAssetPrefix: 'agda-categories',
  },
]

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

async function download(url, destPath) {
  console.log(`  downloading: ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status} ${res.statusText}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await mkdir(dirname(destPath), { recursive: true })
  await writeFile(destPath, buf)
}

async function findSoleSubdir(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const dirs = entries.filter(e => e.isDirectory())
  if (dirs.length !== 1) throw new Error(`expected exactly one subdirectory in ${dir}, found: ${dirs.map(d => d.name).join(', ') || '(none)'}`)
  return join(dir, dirs[0].name)
}

/** Downloads a source archive (GitHub tag zip with a wrapper folder) and extracts into destDir, stripping the wrapper. */
async function fetchSource(url, destDir, workDir) {
  if (await exists(destDir)) {
    console.log(`  already present: ${destDir}`)
    return
  }
  const zipPath = join(workDir, url.split('/').pop())
  await download(url, zipPath)
  const tmp = await mkdtemp(join(workDir, 'extract-'))
  await extractZip(zipPath, tmp)
  const wrapped = await findSoleSubdir(tmp)
  await mkdir(destDir, { recursive: true })
  await cp(wrapped, destDir, { recursive: true })
}

/** Downloads a flat zip (paths already relative to destDir) and extracts into destDir. */
async function fetchFlatZip(url, destDir, workDir, marker = destDir) {
  if (await exists(marker)) {
    console.log(`  already present: ${marker}`)
    return
  }
  const zipPath = join(workDir, url.split('/').pop())
  await download(url, zipPath)
  await mkdir(destDir, { recursive: true })
  await extractZip(zipPath, destDir)
}

async function fetchFile(url, destPath) {
  if (await exists(destPath)) {
    console.log(`  already present: ${destPath}`)
    return
  }
  await download(url, destPath)
}

async function ensureDeployConfig(libraries) {
  const configPath = join(REPO_ROOT, 'deploy.config.json')
  if (await exists(configPath)) {
    console.log(`  already present: deploy.config.json (leaving as-is — delete it to regenerate)`)
    return
  }
  const example = JSON.parse(await readFile(join(REPO_ROOT, 'deploy.config.example.json'), 'utf8'))
  const libByName = new Map(libraries.map(l => [l.name, l]))
  const config = {
    ...example,
    libraries: (example.libraries ?? []).map(entry => {
      const downloaded = libByName.get(entry.name)
      return downloaded
        ? { name: entry.name, agdaLibPath: downloaded.agdaLibPath, useAgdai: true }
        : entry
    }),
  }
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n')
  console.log(`  created deploy.config.json`)
}

async function main() {
  const workDir = await mkdtemp(join(tmpdir(), 'auto-configure-'))
  try {
    console.log("Fetching this project's own shipped default assets...")

    // 1. Download library source archives
    const libsWithPaths = []
    for (const lib of SHIPPED_LIBRARIES) {
      const destDir = join(DEPLOY_ASSETS, 'library', lib.name)
      await fetchSource(lib.sourceUrl, destDir, workDir)
      libsWithPaths.push({ name: lib.name, agdaLibPath: join(destDir, lib.agdaLibFile), releaseAssetPrefix: lib.releaseAssetPrefix })
    }

    // 2. Create deploy.config.json if absent (points at the downloaded sources)
    await ensureDeployConfig(libsWithPaths)

    // 3. Resolve cache dirs (getLocalLibraries re-reads deploy.local.json and assigns IDs)
    const resolvedLibs = getLocalLibraries()
    const libByName = new Map(resolvedLibs.map(l => [l.name, l]))

    // 4. Download prebuilt .agdai and manifests into .cache/<id>/
    for (const lib of libsWithPaths) {
      const resolved = libByName.get(lib.name)
      if (!resolved) {
        console.warn(`  warning: "${lib.name}" not in deploy.local.json — skipping cache download`)
        continue
      }
      await mkdir(resolved.cacheDir, { recursive: true })

      await fetchFlatZip(
        `${RELEASE}/${lib.releaseAssetPrefix}-agdai.zip`,
        resolved.cacheDir,
        workDir,
        join(resolved.cacheDir, '_build'),
      )

      try {
        await fetchFile(
          `${RELEASE}/${lib.releaseAssetPrefix}-manifest.json`,
          join(resolved.cacheDir, 'agdai-manifest.json'),
        )
      } catch (err) {
        console.warn(`  could not fetch ${lib.releaseAssetPrefix}-manifest.json (prefetching will be disabled for "${lib.name}"): ${err.message}`)
      }
    }

    // 5. ALS wasm and data
    await fetchFile(
      'https://github.com/agda-web/agda-language-server/releases/download/nightly-20260407/als-2.8.0.wasm',
      join(DEPLOY_ASSETS, 'als', '2.8.0', 'als-2.8ext.wasm'),
    )
    await fetchFlatZip(
      `${RELEASE}/agda-data.zip`,
      join(DEPLOY_ASSETS, 'als', '2.8.0', 'agda-data'),
      workDir,
    )

    console.log('Done. Run `npm run setup` next to prepare static/ for serving.')
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

main().catch(err => { console.error(err); process.exit(1) })
