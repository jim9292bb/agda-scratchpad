/**
 * Builds static/{library,als,agdai}/ from deploy-assets/.cache/ (for
 * .agdai and manifests), from each library's OS-path source tree (for
 * source zips), and from deploy-assets/als/ (for ALS wasm/data) — the one
 * place that turns "files a deployer placed or generated" into "what the
 * browser runtime actually fetches".
 *
 * Per selected library (from deploy.local.json, matched against profiles):
 *   - zips the library's source tree (from agdaLibPath's parent directory)
 *     into static/library/<name>.zip, wrapped under a folder named <name>
 *     — reproducing the shape of a GitHub tag-archive zip so the browser's
 *     existing client-side unzip (which strips that wrapper) needs no change.
 *   - if deploy-assets/.cache/<id>/_build/ exists AND useAgdai is true,
 *     copies it into static/agdai/<name>/_build/.
 *   - if deploy-assets/.cache/<id>/agdai-manifest.json exists AND useAgdai
 *     is true, copies it to static/agdai/<name>/agdai-manifest.json.
 *     If absent, prefetching for that library is simply disabled at runtime
 *     (src/lib/agda/prefetch.js degrades gracefully per library).
 *
 * Per selected ALS version:
 *   - copies deploy-assets/als/<version>/<wasmFilename> into
 *     static/als/<version>/ unchanged.
 *   - zips deploy-assets/als/<version>/agda-data/ into
 *     static/als/<version>/<AGDA_DATA_ZIP_NAME> (no wrapper).
 *
 * Run via `npm run setup` (scripts/setup-assets.sh), after
 * deploy-assets/print-required-files.mjs has confirmed everything needed
 * is present.
 */

import { cp, mkdir, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { zipDirectory } from './zip-utils.mjs'
import { REPO_ROOT, getLocalLibraries, getSelectedAlsVersions } from './resolve-deploy-config.mjs'

const DEPLOY_ASSETS = join(REPO_ROOT, 'deploy-assets')
const STATIC = join(REPO_ROOT, 'static')
const AGDA_DATA_ZIP_NAME = 'agda-data.zip'

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

  for (const lib of getLocalLibraries()) {
    const libSrcRoot = dirname(lib.agdaLibPath)

    console.log(`[${lib.name}] zipping source into static/library/${lib.name}.zip...`)
    await zipDirectory(libSrcRoot, join(STATIC, 'library', `${lib.name}.zip`), {
      prefix: lib.name,
      exclude: ['.git', '_build'],
    })

    if (lib.useAgdai) {
      const buildDir = join(lib.cacheDir, '_build')
      if (await exists(buildDir)) {
        console.log(`[${lib.name}] copying prebuilt .agdai cache into static/agdai/${lib.name}/_build/...`)
        await cp(buildDir, join(STATIC, 'agdai', lib.name, '_build'), { recursive: true })
      }

      const manifestSrc = join(lib.cacheDir, 'agdai-manifest.json')
      if (await exists(manifestSrc)) {
        console.log(`[${lib.name}] copying agdai-manifest.json...`)
        await mkdir(join(STATIC, 'agdai', lib.name), { recursive: true })
        await cp(manifestSrc, join(STATIC, 'agdai', lib.name, 'agdai-manifest.json'))
      } else {
        console.log(`[${lib.name}] no agdai-manifest.json in cache — prefetching disabled (run \`npm run generate-manifest\`).`)
      }
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
