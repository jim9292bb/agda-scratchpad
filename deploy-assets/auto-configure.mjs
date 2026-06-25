/**
 * Fetches this project's own shipped default library/ALS files and
 * extracts them into the raw deploy-assets/{library,als}/ layout — i.e. it
 * does exactly what a self-deployer placing files by hand would do
 * (download an archive, unzip it, put the contents in the designated
 * directory), automated for this project's own shipped defaults
 * specifically (stdlib 2.3, cubical 0.9, agda-categories 0.3.0, ALS 2.8.0).
 *
 * This is NOT a generic, deploy.config.mjs-driven downloader — it doesn't
 * read the catalogs or deploy.config.mjs at all. If you add a library/ALS
 * version of your own, this script knows nothing about it; place that
 * file/directory in deploy-assets/library/<name>/ or deploy-assets/als/ by
 * hand instead. See deploy-assets/README.md.
 *
 * Safe to run repeatedly: skips anything already present.
 *
 * This only populates deploy-assets/{library,als}/ — it does not touch
 * static/. Run `npm run setup` afterward.
 *
 * Usage: node deploy-assets/auto-configure.mjs
 */

import { mkdir, mkdtemp, rm, readdir, cp, access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { extractZip } from './zip-utils.mjs'

const DEPLOY_ASSETS = dirname(fileURLToPath(import.meta.url))
const RELEASE = 'https://github.com/jim9292bb/agda-playground/releases/download/cache-2.8.0'

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function download(url, destPath) {
  console.log(`  downloading: ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status} ${res.statusText}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await mkdir(join(destPath, '..'), { recursive: true })
  await writeFile(destPath, buf)
}

async function findSoleSubdir(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const dirs = entries.filter(e => e.isDirectory())
  if (dirs.length !== 1) throw new Error(`expected exactly one subdirectory in ${dir}, found: ${dirs.map(d => d.name).join(', ') || '(none)'}`)
  return join(dir, dirs[0].name)
}

/** Downloads a source archive (with a GitHub tag-archive wrapper folder) and extracts it into destDir, stripping the wrapper. */
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

/**
 * Downloads a zip whose internal paths are already relative to destDir
 * (no wrapper to strip) and extracts it there. `marker` is checked instead
 * of destDir itself, since destDir may already exist for an unrelated
 * reason (e.g. a library's source was already extracted into the same
 * directory this zip's contents — its _build/ — also extracts into).
 */
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

async function main() {
  const workDir = await mkdtemp(join(tmpdir(), 'auto-configure-'))
  try {
    console.log("Fetching this project's own shipped default assets...")

    // library/<name>/ — stdlib 2.3, cubical 0.9, agda-categories 0.3.0:
    // source archives (wrapper-stripped), prebuilt .agdai caches (already
    // laid out as _build/<version>/agda/... inside the zip), and each
    // library's own dependency graph — maintainer-produced (see
    // deploy-assets/README.md "Regenerating the dependency graph" +
    // deploy-assets/dot-to-manifest.mjs), uploaded to the same release.
    // Self-deployers who change
    // deploy.config.mjs get nothing here and must produce their own (see
    // deploy-assets/README.md). The manifest fetch is best-effort per
    // library: prefetching is optional, so a missing release asset
    // shouldn't fail the whole fetch.
    async function fetchManifest(name) {
      try {
        await fetchFile(`${RELEASE}/${name}-manifest.json`, join(DEPLOY_ASSETS, 'library', name, 'agdai-manifest.json'))
      } catch (err) {
        console.warn(`  could not fetch ${name}-manifest.json (prefetching will be disabled for ${name}): ${err.message}`)
      }
    }

    await fetchSource(
      'https://github.com/agda/agda-stdlib/archive/refs/tags/v2.3.zip',
      join(DEPLOY_ASSETS, 'library', 'stdlib'), workDir)
    await fetchFlatZip(
      `${RELEASE}/stdlib-agdai.zip`,
      join(DEPLOY_ASSETS, 'library', 'stdlib'), workDir,
      join(DEPLOY_ASSETS, 'library', 'stdlib', '_build'))
    await fetchManifest('stdlib')

    await fetchSource(
      'https://github.com/agda/cubical/archive/refs/tags/v0.9.zip',
      join(DEPLOY_ASSETS, 'library', 'cubical'), workDir)
    await fetchFlatZip(
      `${RELEASE}/cubical-agdai.zip`,
      join(DEPLOY_ASSETS, 'library', 'cubical'), workDir,
      join(DEPLOY_ASSETS, 'library', 'cubical', '_build'))
    await fetchManifest('cubical')

    await fetchSource(
      'https://github.com/agda/agda-categories/archive/refs/tags/v0.3.0.zip',
      join(DEPLOY_ASSETS, 'library', 'agda-categories'), workDir)
    await fetchFlatZip(
      `${RELEASE}/agda-categories-agdai.zip`,
      join(DEPLOY_ASSETS, 'library', 'agda-categories'), workDir,
      join(DEPLOY_ASSETS, 'library', 'agda-categories', '_build'))
    await fetchManifest('agda-categories')

    // als/2.8.0/ — ALS 2.8.0 wasm (flat file) and the Agda builtins data
    // directory (already laid out relative to the VFS root inside the
    // zip). Each ALS version gets its own directory — see
    // deploy-assets/als-catalog.mjs for why agda-data/ can't be shared
    // flat across versions.
    await fetchFile(
      'https://github.com/agda-web/agda-language-server/releases/download/nightly-20260407/als-2.8.0.wasm',
      join(DEPLOY_ASSETS, 'als', '2.8.0', 'als-2.8ext.wasm'))
    await fetchFlatZip(
      `${RELEASE}/agda-data.zip`,
      join(DEPLOY_ASSETS, 'als', '2.8.0', 'agda-data'), workDir)

    console.log('Done. Run `npm run setup` next to prepare static/ for serving.')
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

main().catch(err => { console.error(err); process.exit(1) })
