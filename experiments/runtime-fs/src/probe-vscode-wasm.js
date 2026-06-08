import { access, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import Module from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const experimentRoot = dirname(here)
const appRoot = join(experimentRoot, '..', '..')
const workspaceRoot = join(appRoot, '..')
const vscodeLoaderRoot = join(workspaceRoot, 'references', 'vscode-als-wasm-loader')
const vscodeWasmRoot = join(vscodeLoaderRoot, 'vscode-wasm')
const wasmWasiRoot = join(vscodeWasmRoot, 'wasm-wasi')
const coreDir = join(vscodeWasmRoot, 'wasm-wasi-core')
const lspDir = join(vscodeWasmRoot, 'wasm-wasi-lsp')

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

function createDisposable() {
  return { dispose() {} }
}

class EventEmitter {
  constructor() {
    this.listeners = new Set()
    this.event = listener => {
      this.listeners.add(listener)
      return createDisposable()
    }
  }

  fire(value) {
    for (const listener of this.listeners) listener(value)
  }
}

class Uri {
  constructor({ scheme = 'file', authority = '', path = '/', fsPath = null }) {
    this.scheme = scheme
    this.authority = authority
    this.path = path
    this.fsPath = fsPath ?? path
  }

  static file(path) {
    return new Uri({ scheme: 'file', path, fsPath: path })
  }

  static parse(value) {
    const url = new URL(value)
    return new Uri({
      scheme: url.protocol.replace(/:$/, ''),
      authority: url.host,
      path: url.pathname,
      fsPath: url.pathname,
    })
  }

  static from(parts) {
    return new Uri(parts)
  }

  static joinPath(base, ...segments) {
    const joined = join(base.fsPath, ...segments)
    return Uri.file(joined)
  }

  toString() {
    return this.scheme === 'file' ? pathToFileURL(this.fsPath).toString() : `${this.scheme}://${this.authority}${this.path}`
  }
}

function createVsCodeShim() {
  return {
    Uri,
    EventEmitter,
    Disposable: class Disposable {
      dispose() {}
    },
    workspace: {
      workspaceFolders: [],
      fs: {
        async readFile(uri) {
          return readFile(uri.fsPath)
        },
        isWritableFileSystem() {
          return false
        },
      },
      onDidChangeWorkspaceFolders() {
        return createDisposable()
      },
    },
    window: {
      createOutputChannel() {
        return {
          trace() {},
          debug() {},
          info() {},
          warn() {},
          error() {},
          appendLine() {},
          dispose() {},
        }
      },
    },
    extensions: {
      all: [],
      getExtension() {
        return undefined
      },
      onDidChange() {
        return createDisposable()
      },
    },
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

async function importWithShimProbe(path) {
  const shim = createVsCodeShim()
  const require = Module.createRequire(import.meta.url)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'vscode') return shim
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const mod = require(path)
    return {
      ok: true,
      exports: Object.keys(mod).sort(),
    }
  } catch (err) {
    return {
      ok: false,
      error: err?.code ? `${err.code}: ${err.message}` : String(err?.message ?? err),
    }
  } finally {
    Module._load = originalLoad
  }
}

const probes = {
  node: {
    version: process.version,
    supportedByExperiment: Number(process.versions.node.split('.')[0]) >= 20,
  },
  reference: {
    vscodeAlsWasmLoader: {
      path: vscodeLoaderRoot,
      sourceExists: await exists(vscodeLoaderRoot),
      packageVersion: await packageVersion(join(vscodeLoaderRoot, 'package.json')),
    },
    wasmWasi: {
      path: wasmWasiRoot,
      sourceExists: await exists(wasmWasiRoot),
      packageJsonExists: await exists(join(wasmWasiRoot, 'package.json')),
      apiEntryExists: await exists(join(wasmWasiRoot, 'lib', 'api', 'v1.js')),
    },
    wasmWasiCore: {
      path: coreDir,
      sourceExists: await exists(coreDir),
      packageJsonExists: await exists(join(coreDir, 'package.json')),
      desktopEntryExists: await exists(join(coreDir, 'lib', 'desktop', 'extension.js')),
      workerArtifactExists: await exists(join(coreDir, 'dist', 'desktop', 'mainWorker.js')),
      threadWorkerArtifactExists: await exists(join(coreDir, 'dist', 'desktop', 'threadWorker.js')),
    },
    wasmWasiLsp: {
      path: lspDir,
      sourceExists: await exists(lspDir),
      packageJsonExists: await exists(join(lspDir, 'package.json')),
      libEntryExists: await exists(join(lspDir, 'lib', 'main.js')),
    },
  },
  imports: {
    experimentResolution: {
      '@vscode/wasm-wasi/v1': await importProbe('@vscode/wasm-wasi/v1'),
      '@agda-web/wasm-wasi-core': await importProbe('@agda-web/wasm-wasi-core'),
      '@agda-web/wasm-wasi-lsp': await importProbe('@agda-web/wasm-wasi-lsp'),
    },
    directReferenceWithShim: {
      wasmWasiV1: await importWithShimProbe(join(wasmWasiRoot, 'lib', 'api', 'v1.js')),
      wasmWasiCoreDesktop: await importWithShimProbe(join(coreDir, 'lib', 'desktop', 'extension.js')),
      wasmWasiLsp: await importWithShimProbe(join(lspDir, 'lib', 'main.js')),
    },
  },
}

const blockers = []
if (!probes.reference.wasmWasi.sourceExists || !probes.reference.wasmWasi.packageJsonExists) {
  blockers.push('Reference source for wasm-wasi is missing.')
}
if (!probes.reference.wasmWasiCore.sourceExists || !probes.reference.wasmWasiCore.packageJsonExists) {
  blockers.push('Reference source for wasm-wasi-core is missing.')
}
if (!probes.reference.wasmWasiLsp.sourceExists || !probes.reference.wasmWasiLsp.packageJsonExists) {
  blockers.push('Reference source for wasm-wasi-lsp is missing.')
}
if (!probes.reference.wasmWasiCore.workerArtifactExists || !probes.reference.wasmWasiCore.threadWorkerArtifactExists) {
  blockers.push('wasm-wasi-core desktop worker artifacts are missing under dist/desktop; createProcess cannot start yet.')
}
for (const [name, result] of Object.entries(probes.imports.experimentResolution)) {
  if (!result.ok) blockers.push(`experiments/runtime-fs cannot resolve ${name}: ${result.error}`)
}
for (const [name, result] of Object.entries(probes.imports.directReferenceWithShim)) {
  if (!result.ok) blockers.push(`direct reference import failed for ${name}: ${result.error}`)
}

console.log(JSON.stringify({
  adapter: 'vscode-wasm-memfs',
  implementable: blockers.length === 0,
  blockers,
  probes,
}, null, 2))
