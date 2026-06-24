/**
 * Phase A of dependency-graph generation: does everything except invoke
 * `agda` itself, then tells you exactly what to run. Always processes
 * exactly one library at a time — see `--library` below.
 *
 * For the library given via `--library`, this:
 *   - registers every currently-selected library's (deploy.config.mjs)
 *     `.agda-lib` together in a shared `libraries` file, so a `depend:`
 *     on another configured library (e.g. agda-categories on
 *     standard-library) resolves correctly — even though only one
 *     library's Everything.agda gets generated/checked this run;
 *   - computes the Everything.agda content for that one library
 *     (importing every module it defines), to be written, used, and
 *     removed by the generated script below;
 *   - records which modules that library actually owns (own-modules.json)
 *     — needed later to attribute a module to the right library when
 *     the check sees modules from libraries it merely imports.
 * It then writes a shell script (deploy-assets/.dependency-graph-work/run-agda.sh)
 * that writes the library's Everything.agda, runs `agda --dependency-graph`,
 * and removes Everything.agda again.
 *
 * This script does NOT run `agda` itself — that requires a native `agda`
 * binary, which this script (and this project's own tooling) deliberately
 * doesn't assume is available in every environment that wants to produce
 * a dependency graph. Run the generated script yourself, then run
 * deploy-assets/dot-to-manifest.mjs to produce the library's
 * deploy-assets/library/<name>/agdai-manifest.json.
 *
 * There is no `optionsPragma` catalog field — the `{-# OPTIONS #-}` line
 * a library's generated Everything.agda needs (if any; most libraries
 * need none) is supplied via `--scope-check-pragma`, since nothing else
 * in this project reads it. It's not always the same as the library's own
 * `.agda-lib` `flags:` — confirmed empirically that `.agda-lib` flags do
 * not apply to the synthetic Everything.agda, e.g. stdlib needs
 * `--rewriting --guardedness --sized-types` declared here even though
 * `standard-library.agda-lib`'s own `flags:` doesn't mention any of them
 * (omitting it fails with `InfectiveImport`). See deploy-assets/README.md
 * for the known-correct value for each of this project's own libraries.
 *
 * Prerequisite: each selected library's raw source must already be in
 * deploy-assets/library/<name>/ (see deploy-assets/README.md).
 *
 * Usage:
 *   node deploy-assets/prepare-dependency-graph.mjs --library <name> [--scope-check-pragma <pragma>]
 *
 * To (re)generate every selected library's graph, run this once per
 * library (each followed by its printed `agda` command and
 * dot-to-manifest.mjs — see deploy-assets/README.md).
 */

import { readFile, writeFile, mkdir, readdir, rm, chmod } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { REPO_ROOT, getSelectedLibraries } from './resolve-deploy-config.mjs'

const DEPLOY_ASSETS = join(REPO_ROOT, 'deploy-assets')
const WORK_DIR = join(DEPLOY_ASSETS, '.dependency-graph-work')
const EVERYTHING_FILENAME = 'Everything.agda'

function parseArgs(argv) {
  const args = { library: null, scopeCheckPragma: '' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--library') args.library = argv[++i]
    else if (argv[i] === '--scope-check-pragma') args.scopeCheckPragma = argv[++i]
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  if (!args.library) {
    throw new Error('--library <name> is required — pass the name of exactly one currently-selected library (deploy.config.mjs) to process.')
  }
  return args
}

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

async function libRootInfo(lib) {
  const libRoot = join(DEPLOY_ASSETS, 'library', lib.name)
  const agdaLibPath = join(libRoot, lib.agdaLibFile)
  const include = parseAgdaLibInclude(await readFile(agdaLibPath, 'utf8'))
  const includeDir = include ? join(libRoot, include) : libRoot
  return { libRoot, agdaLibPath, includeDir }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const libs = getSelectedLibraries()
  const target = libs.find(l => l.name === args.library)
  if (!target) {
    throw new Error(`"${args.library}" is not a currently-selected library — check deploy.config.mjs. Selected: ${libs.map(l => l.name).join(', ') || '(none)'}`)
  }

  await rm(WORK_DIR, { recursive: true, force: true })
  await mkdir(WORK_DIR, { recursive: true })

  // Every selected library's .agda-lib is registered together, even though
  // only `target` gets its Everything.agda generated/checked this run, so
  // a depend: on another configured library resolves correctly.
  const allLibInfo = await Promise.all(libs.map(async lib => ({ lib, info: await libRootInfo(lib) })))
  const libraryFilePath = join(WORK_DIR, 'libraries')
  await writeFile(libraryFilePath, allLibInfo.map(({ info }) => info.agdaLibPath).join('\n') + '\n')

  const { info } = allLibInfo.find(({ lib }) => lib.name === target.name)
  const { libRoot, includeDir } = info

  console.log(`[${target.name}] scanning modules...`)
  const agdaFiles = (await findAgdaFiles(includeDir)).sort()
  const ownModules = agdaFiles.map(f => pathToModuleName(f, includeDir))
  const imports = agdaFiles.map(f => `import ${pathToModuleName(f, includeDir)}`)
  const pragma = args.scopeCheckPragma ? `${args.scopeCheckPragma}\n` : ''
  const everythingContent = `${pragma}module Everything where\n${imports.join('\n')}\n`

  await writeFile(join(WORK_DIR, 'own-modules.json'), JSON.stringify({ [target.name]: ownModules }))

  const dotFile = join(WORK_DIR, `${target.name}.dot`)
  const everythingPath = join(includeDir, EVERYTHING_FILENAME)
  const scriptLines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    `echo '[${target.name}] writing Everything.agda...'`,
    `cat > ${shQuote(everythingPath)} <<'EVERYTHING_AGDA_EOF'`,
    everythingContent,
    'EVERYTHING_AGDA_EOF',
    `echo '[${target.name}] running agda --dependency-graph (this can take a while)...'`,
    `(cd ${shQuote(libRoot)} && agda --library-file=${shQuote(libraryFilePath)} -i ${shQuote(includeDir)} --only-scope-checking --dependency-graph=${shQuote(dotFile)} ${shQuote(everythingPath)}) || echo '[${target.name}] agda exited with a warning/error (continuing if the .dot file was still written)'`,
    `rm -f ${shQuote(everythingPath)}`,
    '',
  ]
  const scriptPath = join(WORK_DIR, 'run-agda.sh')
  await writeFile(scriptPath, scriptLines.join('\n'))
  await chmod(scriptPath, 0o755)

  console.log(`\nWrote ${relative(REPO_ROOT, scriptPath)}.`)
  console.log('\nRun it yourself (requires a native `agda` binary on PATH):\n')
  console.log(`  bash ${relative(REPO_ROOT, scriptPath)}`)
  console.log('\nThen run: node deploy-assets/dot-to-manifest.mjs')
}

main().catch(err => { console.error(err); process.exit(1) })
