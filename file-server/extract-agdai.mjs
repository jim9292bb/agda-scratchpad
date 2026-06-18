/**
 * Extracts stdlib-agdai.zip and cubical-agdai.zip into static/agdai/
 * so individual .agdai files can be served on demand from GitHub Pages.
 *
 * Run after `npm run setup` during CI build:
 *   node file-server/extract-agdai.mjs
 */

import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { extractZip } from './zip-utils.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATIC = join(__dirname, '../static')
const OUT = join(STATIC, 'agdai')

async function main() {
  await mkdir(OUT, { recursive: true })

  const stdlibZip  = join(STATIC, 'stdlib-agdai.zip')
  const cubicalZip = join(STATIC, 'cubical-agdai.zip')

  console.log('Extracting stdlib-agdai.zip...')
  const stdlibCount = await extractZip(stdlibZip, join(OUT, 'stdlib'))
  console.log(`  ${stdlibCount} files`)

  console.log('Extracting cubical-agdai.zip...')
  const cubicalCount = await extractZip(cubicalZip, join(OUT, 'cubical'))
  console.log(`  ${cubicalCount} files`)

  console.log('Done.')
}

main().catch(err => { console.error(err); process.exit(1) })
