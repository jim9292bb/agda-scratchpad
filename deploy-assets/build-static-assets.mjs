/**
 * Builds static/{library,als}/ and static/agdai/ from the raw files in
 * deploy-assets/{library,als}/ — the one place that turns "files a deployer
 * placed by hand" into "what the browser runtime actually fetches".
 *
 * Per selected library:
 *   - zips deploy-assets/library/<folderName>/ (excluding _build/,
 *     agdai-manifest.json, everything/ and dots/ — the dependency-graph
 *     working files, see deploy-assets/README.md — and any leftover
 *     Everything.agda) into static/library/<sourceZipName>, wrapped under
 *     a folder named archiveRootPrefix — this reproduces the shape of a
 *     GitHub tag-archive zip, so the browser's existing client-side unzip
 *     (which strips that wrapper) needs no changes. `folderName`
 *     (`<name>-<version>`) is staging-side only — so two different
 *     versions of the same-named library can be placed side by side — not
 *     to be confused with the static output below, which is still keyed
 *     by `name` alone (only one version of a given library is currently
 *     servable per static/ build; see ROADMAP.md "Curated Multi-Library
 *     Support").
 *   - if deploy-assets/library/<folderName>/_build/ exists, copies it as-is
 *     into static/agdai/<name>/_build/ (already individual .agdai files —
 *     no zip involved at any point for these; they're served flat on
 *     demand).
 *   - if deploy-assets/library/<folderName>/agdai-manifest.json exists,
 *     copies it to static/agdai/<name>/agdai-manifest.json unchanged (it's
 *     already the final shape — see deploy-assets/dot-to-manifest.mjs). If
 *     absent, prefetching for that library is simply disabled at runtime
 *     (src/lib/agda/prefetch.js degrades gracefully per library).
 *
 * Per selected ALS version (each one isolated under its own
 * deploy-assets/als/<version>/ and static/als/<version>/ — see
 * deploy-assets/als-catalog.mjs for why agda-data/ specifically can't be
 * shared flat across versions):
 *   - copies deploy-assets/als/<version>/<wasmFilename> into
 *     static/als/<version>/ unchanged.
 *   - zips deploy-assets/als/<version>/agda-data/ (required, not optional
 *     — see deploy-assets/print-required-files.mjs) into
 *     static/als/<version>/<AGDA_DATA_ZIP_NAME> (no wrapper — the
 *     browser unzips it at the VFS root).
 *
 * Run via `npm run setup` (scripts/setup-assets.sh), after
 * deploy-assets/print-required-files.mjs has confirmed everything needed is
 * present.
 */

import { cp, mkdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { zipDirectory } from './zip-utils.mjs'
import { AGDA_DATA_ZIP_NAME } from './als-catalog.mjs'
import { REPO_ROOT, getSelectedAlsVersions, getSelectedLibraries } from './resolve-deploy-config.mjs'

const DEPLOY_ASSETS = join(REPO_ROOT, 'deploy-assets')
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
    const libRoot = join(DEPLOY_ASSETS, 'library', lib.folderName)

    console.log(`[${lib.name}] zipping source into static/library/${lib.sourceZipName}...`)
    await zipDirectory(libRoot, join(STATIC, 'library', lib.sourceZipName), {
      prefix: lib.archiveRootPrefix,
      exclude: ['_build', 'Everything.agda', 'agdai-manifest.json', 'everything', 'dots'],
    })

    const buildDir = join(libRoot, '_build')
    if (await exists(buildDir)) {
      console.log(`[${lib.name}] copying prebuilt .agdai cache into static/agdai/${lib.name}/_build/...`)
      await cp(buildDir, join(STATIC, 'agdai', lib.name, '_build'), { recursive: true })
    }

    const manifestSrc = join(libRoot, 'agdai-manifest.json')
    if (await exists(manifestSrc)) {
      console.log(`[${lib.name}] copying agdai-manifest.json...`)
      await mkdir(join(STATIC, 'agdai', lib.name), { recursive: true })
      await cp(manifestSrc, join(STATIC, 'agdai', lib.name, 'agdai-manifest.json'))
    } else {
      console.log(`[${lib.name}] no agdai-manifest.json — prefetching disabled for this library (.agdai files still load on demand).`)
    }
  }

  for (const als of getSelectedAlsVersions()) {
    const alsSrcRoot = join(DEPLOY_ASSETS, 'als', als.version)
    const alsOutRoot = join(STATIC, 'als', als.version)
    await mkdir(alsOutRoot, { recursive: true })

    console.log(`[als ${als.version}] copying ${als.wasmFilename}...`)
    await cp(join(alsSrcRoot, als.wasmFilename), join(alsOutRoot, als.wasmFilename))

    console.log(`[als ${als.version}] zipping agda-data/ into static/als/${als.version}/${AGDA_DATA_ZIP_NAME}...`)
    await zipDirectory(join(alsSrcRoot, 'agda-data'), join(alsOutRoot, AGDA_DATA_ZIP_NAME))
  }

  console.log('Done.')
}

main().catch(err => { console.error(err); process.exit(1) })
