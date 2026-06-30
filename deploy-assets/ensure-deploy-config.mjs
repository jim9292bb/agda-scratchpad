/**
 * Copies deploy.config.example.json → deploy.config.json if the latter
 * doesn't exist yet. Run automatically as a predev/precheck/prebuild step
 * so that `npm run check` and `npm run build` never fail on a fresh clone
 * just because deploy.config.json hasn't been set up.
 *
 * The generated file is gitignored. To customise the deployment (library
 * paths, profiles, ALS version), edit deploy.config.json directly.
 */

import { copyFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  const configPath = join(REPO_ROOT, 'deploy.config.json')
  const examplePath = join(REPO_ROOT, 'deploy.config.example.json')
  try {
    await access(configPath)
  } catch {
    await copyFile(examplePath, configPath)
    console.log('Created deploy.config.json from deploy.config.example.json (edit it to set your agdaLibPath values)')
  }
}

main().catch(err => { console.error(err); process.exit(1) })
