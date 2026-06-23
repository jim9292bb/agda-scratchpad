/**
 * Phase A of dependency-graph generation: does everything except invoke
 * `agda` itself, then tells you exactly what to run.
 *
 * For every currently-selected library (deploy.config.mjs), this:
 *   - computes the Everything.agda content for the library (importing
 *     every module it defines), to be written, used, and removed by the
 *     generated script below — not written eagerly here, because every
 *     selected library's .agda-lib is registered together (so a library
 *     that `depend:`s on another configured library, e.g. agda-categories
 *     on standard-library, resolves correctly), and two libraries' synthetic
 *     Everything.agda files can't coexist without an AmbiguousTopLevelModuleName
 *     error — only one may exist on disk at a time;
 *   - records which modules each library actually owns (own-modules.json)
 *     — needed later to attribute a module to the right library when
 *     multiple libraries' checks see modules from libraries they merely
 *     import.
 * It then writes a single shell script
 * (file-server/.dependency-graph-work/run-agda.sh) that, for each library
 * in turn, writes that library's Everything.agda, runs `agda
 * --dependency-graph`, and removes Everything.agda again before moving to
 * the next library.
 *
 * This script does NOT run `agda` itself — that requires a native `agda`
 * binary, which this script (and this project's own tooling) deliberately
 * doesn't assume is available in every environment that wants to produce
 * a dependency graph. Run the generated script yourself, then run
 * file-server/dot-to-manifest.mjs to produce the final
 * file-server/agdai-manifest.json.
 *
 * Prerequisite: each selected library's raw source must already be in
 * file-server/library/<name>/ (see file-server/README.md).
 *
 * Usage:
 *   node file-server/prepare-dependency-graph.mjs
 */

import { readFile, writeFile, mkdir, readdir, rm, chmod } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { REPO_ROOT, getSelectedLibraries } from './resolve-deploy-config.mjs'

const FILE_SERVER = join(REPO_ROOT, 'file-server')
const WORK_DIR = join(FILE_SERVER, '.dependency-graph-work')
const EVERYTHING_FILENAME = 'Everything.agda'

function parseAgdaLibInclude(src) {
  const m = src.match(/^include:\s*(.+)/m)
  const include = m ? m[1].trim().split(/\s+/)[0] : '.'
  return include === '.' ? '' : include
}

async function findAgdaFiles(dir, result = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) await findAgdaFiles(p, result)
    else if (entry.name.endsWith('.agda') && entry.name !== EVERYTHING_FILENAME) result.push(p)
  }
  return result
}

function pathToModuleName(filePath, includeDir) {
  return relative(includeDir, filePath)
    .replace(/\.agda$/, '')
    .split(sep)
    .join('.')
}

function shQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

async function main() {
  await rm(WORK_DIR, { recursive: true, force: true })
  await mkdir(WORK_DIR, { recursive: true })

  const libs = getSelectedLibraries()
  const prepared = []
  const ownModulesByLib = {}

  for (const lib of libs) {
    const libRoot = join(FILE_SERVER, 'library', lib.name)
    const agdaLibPath = join(libRoot, lib.agdaLibFile)
    const include = parseAgdaLibInclude(await readFile(agdaLibPath, 'utf8'))
    const includeDir = include ? join(libRoot, include) : libRoot

    console.log(`[${lib.name}] scanning modules...`)
    const agdaFiles = (await findAgdaFiles(includeDir)).sort()
    ownModulesByLib[lib.name] = agdaFiles.map(f => pathToModuleName(f, includeDir))
    const imports = agdaFiles.map(f => `import ${pathToModuleName(f, includeDir)}`)
    const pragma = lib.optionsPragma ? `${lib.optionsPragma}\n` : ''
    const everythingContent = `${pragma}module Everything where\n${imports.join('\n')}\n`

    prepared.push({ lib, libRoot, includeDir, agdaLibPath, everythingContent })
  }

  const libraryFilePath = join(WORK_DIR, 'libraries')
  await writeFile(libraryFilePath, prepared.map(p => p.agdaLibPath).join('\n') + '\n')
  await writeFile(join(WORK_DIR, 'own-modules.json'), JSON.stringify(ownModulesByLib))

  const scriptLines = ['#!/usr/bin/env bash', 'set -euo pipefail', '']
  for (const { lib, libRoot, includeDir, everythingContent } of prepared) {
    const dotFile = join(WORK_DIR, `${lib.name}.dot`)
    const everythingPath = join(includeDir, EVERYTHING_FILENAME)
    scriptLines.push(
      `echo '[${lib.name}] writing Everything.agda...'`,
      `cat > ${shQuote(everythingPath)} <<'EVERYTHING_AGDA_EOF'`,
      everythingContent,
      'EVERYTHING_AGDA_EOF',
      `echo '[${lib.name}] running agda --dependency-graph (this can take a while)...'`,
      `(cd ${shQuote(libRoot)} && agda --library-file=${shQuote(libraryFilePath)} -i ${shQuote(includeDir)} --only-scope-checking --dependency-graph=${shQuote(dotFile)} ${shQuote(everythingPath)}) || echo '[${lib.name}] agda exited with a warning/error (continuing if the .dot file was still written)'`,
      `rm -f ${shQuote(everythingPath)}`,
      '',
    )
  }
  const scriptPath = join(WORK_DIR, 'run-agda.sh')
  await writeFile(scriptPath, scriptLines.join('\n'))
  await chmod(scriptPath, 0o755)

  console.log(`\nWrote ${relative(REPO_ROOT, scriptPath)}.`)
  console.log('\nRun it yourself (requires a native `agda` binary on PATH):\n')
  console.log(`  bash ${relative(REPO_ROOT, scriptPath)}`)
  console.log('\nThen run: node file-server/dot-to-manifest.mjs')
}

main().catch(err => { console.error(err); process.exit(1) })
