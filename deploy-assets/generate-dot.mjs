/**
 * Generates the `.dot` dependency graph for one library — requires a
 * native `agda` binary on `PATH` (not the WASM build). Always processes
 * exactly one library at a time — see `--library` below. Run
 * deploy-assets/dot-to-manifest.mjs afterward to convert the result into
 * that library's `deploy-assets/library/<name>/agdai-manifest.json`.
 *
 * For the library given via `--library`, this:
 *   - registers every currently-selected library's (deploy.config.mjs)
 *     `.agda-lib` together in a shared `libraries` file, so a `depend:`
 *     on another configured library (e.g. agda-categories on
 *     standard-library) resolves correctly — even though only one
 *     library's Everything.agda gets generated/checked this run;
 *   - writes a synthetic Everything.agda (importing every module the
 *     library defines) into the library's own include dir;
 *   - records which modules that library actually owns (own-modules.json)
 *     — needed later to attribute a module to the right library when
 *     the check sees modules from libraries it merely imports;
 *   - runs `agda --only-scope-checking --dependency-graph` against it,
 *     and removes the synthetic Everything.agda again afterward
 *     (success or warning-only — see below).
 *
 * agda exits non-zero on warnings alone (e.g. deprecated modules) even
 * though the Dot backend still wrote a complete `.dot` file — confirmed
 * empirically that a real failure (e.g. a missing required
 * `--scope-check-pragma`) writes no `.dot` file at all, not a partial
 * one — so this only fails loudly if the `.dot` file is actually missing
 * afterward, not on every non-zero exit.
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
 *   node deploy-assets/generate-dot.mjs --library <name> [--scope-check-pragma <pragma>]
 *
 * To (re)generate every selected library's graph, run this once per
 * library, each followed by deploy-assets/dot-to-manifest.mjs (see
 * deploy-assets/README.md).
 */

import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { REPO_ROOT, getSelectedLibraries } from './resolve-deploy-config.mjs'

const execFileAsync = promisify(execFile)

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
  await writeFile(everythingPath, everythingContent)

  try {
    console.log(`[${target.name}] running agda --dependency-graph (this can take a while)...`)
    await execFileAsync('agda', [
      `--library-file=${libraryFilePath}`,
      '-i', includeDir,
      '--only-scope-checking',
      `--dependency-graph=${dotFile}`,
      everythingPath,
    ], { cwd: libRoot, maxBuffer: 64 * 1024 * 1024 })
  } catch (err) {
    console.warn(`[${target.name}] agda exited with a warning/error (continuing if the .dot file was still written):`)
    console.warn(err.stderr || err.message)
  } finally {
    await rm(everythingPath, { force: true })
  }

  await readFile(dotFile).catch(() => {
    throw new Error(`[${target.name}] agda did not produce a dependency graph at ${relative(REPO_ROOT, dotFile)} — see the warning above for what went wrong.`)
  })

  console.log(`\n[${target.name}] wrote ${relative(REPO_ROOT, dotFile)}.`)
  console.log('Run next: node deploy-assets/dot-to-manifest.mjs')
}

main().catch(err => { console.error(err); process.exit(1) })
