import { access, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const experimentRoot = dirname(here)
const appRoot = join(experimentRoot, '..', '..')
const workspaceRoot = join(appRoot, '..')
const vscodeLoaderRoot = join(workspaceRoot, 'references', 'vscode-als-wasm-loader')

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function packageVersion(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8')).version ?? null
  } catch {
    return null
  }
}

async function importProbe(specifier) {
  try {
    const mod = await import(specifier)
    return {
      ok: true,
      exports: Object.keys(mod).sort(),
    }
  } catch (err) {
    return {
      ok: false,
      error: err?.code ? `${err.code}: ${err.message}` : String(err?.message ?? err),
    }
  }
}

const coreDir = join(vscodeLoaderRoot, 'vscode-wasm', 'wasm-wasi-core')
const lspDir = join(vscodeLoaderRoot, 'vscode-wasm', 'wasm-wasi-lsp')

const probes = {
  node: {
    version: process.version,
    supportedByExperiment: Number(process.versions.node.split('.')[0]) >= 20,
  },
  reference: {
    vscodeAlsWasmLoader: {
      path: vscodeLoaderRoot,
      exists: await exists(vscodeLoaderRoot),
      packageVersion: await packageVersion(join(vscodeLoaderRoot, 'package.json')),
    },
    wasmWasiCoreSubmodule: {
      path: coreDir,
      exists: await exists(coreDir),
      packageJsonExists: await exists(join(coreDir, 'package.json')),
      distExists: await exists(join(coreDir, 'dist')),
    },
    wasmWasiLspSubmodule: {
      path: lspDir,
      exists: await exists(lspDir),
      packageJsonExists: await exists(join(lspDir, 'package.json')),
      distExists: await exists(join(lspDir, 'dist')),
    },
  },
  imports: {
    '@vscode/wasm-wasi/v1': await importProbe('@vscode/wasm-wasi/v1'),
    '@agda-web/wasm-wasi-core': await importProbe('@agda-web/wasm-wasi-core'),
    '@agda-web/wasm-wasi-lsp': await importProbe('@agda-web/wasm-wasi-lsp'),
  },
}

const blockers = []
if (!probes.imports['@vscode/wasm-wasi/v1'].ok) {
  blockers.push('Cannot import @vscode/wasm-wasi/v1 from experiments/runtime-fs.')
}
if (!probes.imports['@agda-web/wasm-wasi-core'].ok) {
  blockers.push('Cannot import @agda-web/wasm-wasi-core from experiments/runtime-fs.')
}
if (!probes.imports['@agda-web/wasm-wasi-lsp'].ok) {
  blockers.push('Cannot import @agda-web/wasm-wasi-lsp from experiments/runtime-fs.')
}
if (!probes.reference.wasmWasiCoreSubmodule.packageJsonExists) {
  blockers.push('references/vscode-als-wasm-loader/vscode-wasm/wasm-wasi-core is missing package.json; local submodule/artifact is not available.')
}
if (!probes.reference.wasmWasiLspSubmodule.packageJsonExists) {
  blockers.push('references/vscode-als-wasm-loader/vscode-wasm/wasm-wasi-lsp is missing package.json; local submodule/artifact is not available.')
}

console.log(JSON.stringify({
  adapter: 'vscode-wasm-memfs',
  implementable: blockers.length === 0,
  blockers,
  probes,
}, null, 2))
