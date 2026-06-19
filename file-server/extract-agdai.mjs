/**
 * Extracts each library's prebuilt `.agdai` cache zip (see libraries.mjs)
 * into static/agdai/<name>/ so individual .agdai files can be served on
 * demand from GitHub Pages.
 *
 * Run after `npm run setup` during CI build:
 *   node file-server/extract-agdai.mjs
 */

import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { extractZip } from './zip-utils.mjs'
import { LIBRARIES } from './libraries.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATIC = join(__dirname, '../static')
const OUT = join(STATIC, 'agdai')

async function main() {
  await mkdir(OUT, { recursive: true })

  for (const lib of LIBRARIES) {
    console.log(`Extracting ${lib.agdaiZipName}...`)
    const count = await extractZip(join(STATIC, lib.agdaiZipName), join(OUT, lib.name))
    console.log(`  ${count} files`)
  }

  console.log('Done.')
}

main().catch(err => { console.error(err); process.exit(1) })
