/**
 * Shows which libraries in deploy.local.json have prebuilt .agdai cache
 * and/or a manifest in deploy-assets/.cache/.
 *
 * Useful before running `npm run setup` to know what is ready.
 *
 * Usage: node deploy-assets/check-agdai-status.mjs
 */

import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { getLocalLibraries } from './resolve-deploy-config.mjs'

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

async function main() {
  const libs = getLocalLibraries()

  if (libs.length === 0) {
    console.log('No libraries configured — create deploy.local.json from deploy.local.example.json.')
    return
  }

  for (const lib of libs) {
    const hasManifest = await exists(join(lib.cacheDir, 'agdai-manifest.json'))
    const hasBuild = await exists(join(lib.cacheDir, '_build'))
    const useAgdai = lib.useAgdai ? '' : ' (useAgdai: false)'

    const manifest = hasManifest ? '✓ manifest' : '✗ manifest (run `npm run generate-manifest`)'
    const build = hasBuild ? '✓ _build' : '✗ _build (run `npm run build-agdai`)'
    console.log(`${lib.name}${useAgdai}: ${manifest}  ${build}`)
    if (lib.useAgdai && (hasManifest || hasBuild)) {
      console.log(`  cache id: ${lib.cacheId}`)
    }
  }
}

main().catch(err => { console.error(err); process.exit(1) })
