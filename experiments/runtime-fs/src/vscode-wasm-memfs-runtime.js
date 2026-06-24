import Module from 'node:module'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { encodeLspMessage, LspMessageParser } from './lsp.js'
import { durationSince, nowMs } from './timing.js'
import { findLibrary } from '../../../deploy-assets/libraries.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const experimentRoot = dirname(here)
const appRoot = join(experimentRoot, '..', '..')
const workspaceRoot = join(appRoot, '..')
const STDLIB_ENTRY = findLibrary('stdlib', '2.3')
const CUBICAL_ENTRY = findLibrary('cubical', '0.9')
const referenceRoot = join(workspaceRoot, 'references', 'vscode-als-wasm-loader')
const vscodeWasmRoot = join(referenceRoot, 'vscode-wasm')
const wasmWasiRoot = join(vscodeWasmRoot, 'wasm-wasi')
const wasmWasiCoreRoot = join(vscodeWasmRoot, 'wasm-wasi-core')
const wasmWasiLspRoot = join(vscodeWasmRoot, 'wasm-wasi-lsp')

const wasmWasiV1Entry = join(wasmWasiRoot, 'lib', 'api', 'v1.js')
const wasmWasiCoreDesktopEntry = join(wasmWasiCoreRoot, 'lib', 'desktop', 'extension.js')
const wasmWasiCoreWorker = join(wasmWasiCoreRoot, 'dist', 'desktop', 'mainWorker.js')
const wasmWasiLspEntry = join(wasmWasiLspRoot, 'lib', 'main.js')

function createDisposable(callback = () => {}) {
  return { dispose: callback }
}

class EventEmitter {
  constructor() {
    this.listeners = new Set()
    this.event = listener => {
      this.listeners.add(listener)
      return createDisposable(() => this.listeners.delete(listener))
    }
  }

  fire(value) {
    for (const listener of this.listeners) listener(value)
  }

  dispose() {
    this.listeners.clear()
  }
}

class Uri {
  constructor({ scheme = 'file', authority = '', path = '/', fsPath = null }) {
    this.scheme = scheme
    this.authority = authority
    this.path = path || '/'
    this.fsPath = fsPath ?? (scheme === 'file' ? this.path : this.path)
  }

  static file(path) {
    return new Uri({ scheme: 'file', path, fsPath: path })
  }

  static parse(value) {
    const url = new URL(value)
    return new Uri({
      scheme: url.protocol.replace(/:$/, ''),
      authority: url.host,
      path: url.pathname || '/',
      fsPath: url.protocol === 'file:' ? url.pathname : url.pathname,
    })
  }

  static from(parts) {
    return new Uri({
      scheme: parts.scheme ?? 'file',
      authority: parts.authority ?? '',
      path: parts.path ?? '/',
      fsPath: parts.scheme === 'file' || parts.scheme == null ? (parts.path ?? '/') : (parts.path ?? '/'),
    })
  }

  static joinPath(base, ...segments) {
    const nextPath = posix.join(base.path, ...segments)
    const fsPath = base.scheme === 'file' ? join(base.fsPath, ...segments) : nextPath
    return new Uri({
      scheme: base.scheme,
      authority: base.authority,
      path: nextPath.startsWith('/') ? nextPath : `/${nextPath}`,
      fsPath,
    })
  }

  toString() {
    if (this.scheme === 'file') return pathToFileURL(this.fsPath).toString()
    return `${this.scheme}://${this.authority}${this.path}`
  }
}

function createOutputChannel() {
  return {
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    appendLine() {},
    show() {},
    dispose() {},
  }
}

function createVsCodeShim() {
  return {
    Uri,
    EventEmitter,
    Disposable: class Disposable {
      constructor(callback = () => {}) {
        this.callback = callback
      }

      dispose() {
        this.callback()
      }
    },
    window: {
      createOutputChannel: () => createOutputChannel(),
    },
    workspace: {
      workspaceFolders: [],
      fs: {
        async readFile(uri) {
          return readFile(uri.fsPath)
        },
        async stat(uri) {
          const { stat } = await import('node:fs/promises')
          const value = await stat(uri.fsPath)
          return {
            type: value.isDirectory() ? 2 : 1,
            ctime: value.ctimeMs,
            mtime: value.mtimeMs,
            size: value.size,
          }
        },
        isWritableFileSystem() {
          return false
        },
      },
      onDidChangeWorkspaceFolders() {
        return createDisposable()
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

function installVsCodeShim() {
  const shim = createVsCodeShim()
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'vscode') return shim
    return originalLoad.call(this, request, parent, isMain)
  }
  return () => {
    Module._load = originalLoad
  }
}

function makeStageError(stage, message, cause) {
  const error = new Error(`vscode-wasm-memfs blocked at ${stage}: ${message}`)
  error.stage = stage
  error.cause = cause
  return error
}

function emptyDriveStats() {
  return {
    totalCalls: 0,
    methods: {},
    methodDurationsMs: {},
    pathStatCount: 0,
    pathStatCacheHits: 0,
    pathStatCacheMisses: 0,
    agdaiRead: 0,
    agdaiWrite: 0,
  }
}

function createPatchedStdio(wasmApi) {
  const stdinPipe = wasmApi.createWritable()
  const originalRead = stdinPipe.read.bind(stdinPipe)
  stdinPipe.read = function patchedRead(mode, size) {
    if (this.fillLevel === 0) {
      const error = new Error('This read to stdin would block')
      error._isWasiError = true
      error.errno = 6
      throw error
    }
    return originalRead(mode, size)
  }
  return {
    in: { kind: 'pipeIn', pipe: stdinPipe },
    out: { kind: 'pipeOut' },
    err: { kind: 'pipeOut' },
  }
}

async function importWithShim(modulePath) {
  const require = Module.createRequire(import.meta.url)
  const restore = installVsCodeShim()
  try {
    return require(modulePath)
  } finally {
    restore()
  }
}

async function loadRuntimeModules() {
  const [wasmWasi, wasmWasiCoreDesktop, wasmWasiLsp] = await Promise.all([
    importWithShim(wasmWasiV1Entry),
    importWithShim(wasmWasiCoreDesktopEntry),
    importWithShim(wasmWasiLspEntry),
  ])
  return { wasmWasi, wasmWasiCoreDesktop, wasmWasiLsp }
}

async function ensureArtifacts() {
  const { access } = await import('node:fs/promises')
  try {
    await access(wasmWasiCoreWorker)
  } catch (error) {
    throw makeStageError('process startup', `missing worker artifact ${wasmWasiCoreWorker}`, error)
  }
}

function ensureDirectory(memfs, target) {
  const parts = normalizeMemfsPath(target).split('/').filter(Boolean)
  let current = ''
  for (const part of parts) {
    current = current ? `${current}/${part}` : part
    try {
      memfs.createDirectory(current)
    } catch {
      // Existing directories are fine for deterministic extraction.
    }
  }
}

function normalizeMemfsPath(target) {
  if (target === '/' || target === '') return '.'
  return target.replace(/^\/+/, '')
}

async function unzipToMemfs(memfs, bytes, stripPrefix = '') {
  const zip = await JSZip.loadAsync(bytes)
  const entries = Object.values(zip.files)
  for (const entry of entries) {
    if (entry.dir) continue
    let target = `/${entry.name}`
    if (stripPrefix && target.startsWith(`/${stripPrefix}/`)) {
      target = target.slice(stripPrefix.length + 1)
    }
    const normalizedTarget = normalizeMemfsPath(target)
    const dir = posix.dirname(normalizedTarget)
    if (dir && dir !== '.') ensureDirectory(memfs, dir)
    memfs.createFile(normalizedTarget, await entry.async('uint8array'))
  }
}

async function writeTextFile(memfs, target, content) {
  const normalizedTarget = normalizeMemfsPath(target)
  const dir = posix.dirname(normalizedTarget)
  if (dir && dir !== '.') ensureDirectory(memfs, dir)
  memfs.createFile(normalizedTarget, new TextEncoder().encode(content))
}

function createDirectSession(process, debug = false) {
  const parser = new LspMessageParser()
  const stderrChunks = []
  const debugChunks = []
  let nextId = 1
  const pendingResponses = new Map()
  const pendingResponseEnds = []
  const processRun = process.run()

  processRun.then(exitCode => {
    if (exitCode === 0) return
    const error = new Error(`WASM process exited with code ${exitCode}. stderr=${stderrChunks.join('')}`)
    for (const pending of pendingResponses.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    pendingResponses.clear()
    while (pendingResponseEnds.length > 0) {
      pendingResponseEnds.shift()?.reject?.(error)
    }
  }).catch(error => {
    for (const pending of pendingResponses.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    pendingResponses.clear()
    while (pendingResponseEnds.length > 0) {
      pendingResponseEnds.shift()?.reject?.(error)
    }
  })

  process.stdout.onData(data => {
    for (const payload of parser.push(data)) {
      if (payload.method && Object.prototype.hasOwnProperty.call(payload, 'id')) {
        void writePayload({ jsonrpc: '2.0', id: payload.id, result: null })
        if (payload.method === 'agda' && payload.params?.tag === 'ResponseEnd') {
          const pending = pendingResponseEnds.shift()
          pending?.resolve(payload)
        }
        continue
      }

      if (Object.prototype.hasOwnProperty.call(payload, 'id')) {
        const pending = pendingResponses.get(payload.id)
        if (pending) {
          pendingResponses.delete(payload.id)
          clearTimeout(pending.timeout)
          pending.resolve(payload)
        }
      }
    }
  })

  if (process.stderr) {
    process.stderr.onData(data => {
      const text = new TextDecoder().decode(data)
      stderrChunks.push(text)
      if (debug) debugChunks.push(text)
    })
  }

  async function writePayload(payload) {
    await process.stdin.write(encodeLspMessage(payload))
  }

  function request(method, params) {
    const id = nextId++
    const payload = { jsonrpc: '2.0', id, method, params }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingResponses.delete(id)
        reject(new Error(`Timed out waiting for ${method}. stderr=${stderrChunks.join('')}`))
      }, 60000)
      pendingResponses.set(id, { resolve, reject, timeout })
      void writePayload(payload).catch(reject)
    })
  }

  async function notify(method, params) {
    await writePayload({ jsonrpc: '2.0', method, params })
  }

  function waitForResponseEnd() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for Agda ResponseEnd. stderr=${stderrChunks.join('')}`)), 120000)
      pendingResponseEnds.push({
        resolve(payload) {
          clearTimeout(timeout)
          resolve(payload)
        },
        reject(error) {
          clearTimeout(timeout)
          reject(error)
        },
      })
    })
  }

  return {
    stderrChunks,
    debugChunks,
    async initialize(source) {
      await request('initialize', {
        processId: null,
        rootUri: 'file:///',
        capabilities: {},
        workspaceFolders: null,
      })
      await notify('initialized', {})
      await notify('textDocument/didOpen', {
        textDocument: {
          uri: 'file:///source.agda',
          languageId: 'agda',
          version: 1,
          text: source,
        },
      })
      await notify('textDocument/didSave', {
        textDocument: { uri: 'file:///source.agda' },
      })
    },
    async load() {
      const responseEnd = waitForResponseEnd()
      const start = nowMs()
      const response = await request('agda', {
        tag: 'CmdReq',
        contents: 'IOTCM "/source.agda" NonInteractive Direct (Cmd_load "/source.agda" [])',
      })
      if (response.result?.contents != null) {
        throw new Error(`Cmd_load request failed: ${JSON.stringify(response.result)}`)
      }
      await responseEnd
      return { durationMs: durationSince(start), driveStats: emptyDriveStats() }
    },
    async shutdown() {
      try {
        await request('shutdown', null)
      } finally {
        await notify('exit', {})
      }
    },
  }
}

export async function runVscodeWasmMemfs(fixture, options = {}) {
  const source = await readFile(join(experimentRoot, 'fixtures', `${fixture}.agda`), 'utf8')
  await ensureArtifacts()

  let modules
  try {
    modules = await loadRuntimeModules()
  } catch (error) {
    throw makeStageError('imports', error?.message ?? String(error), error)
  }

  const activate = modules.wasmWasiCoreDesktop.activate ?? modules.wasmWasiCoreDesktop.default?.activate
  if (typeof activate !== 'function') {
    throw makeStageError('runtime activation', 'desktop extension entry did not export activate()')
  }

  const context = {
    extensionUri: Uri.file(wasmWasiCoreRoot),
    extension: {
      packageJSON: {
        version: '1.0.2999',
      },
    },
  }

  let wasmApi
  try {
    const loader = await activate(context)
    wasmApi = loader.load(1)
  } catch (error) {
    throw makeStageError('runtime activation', error?.message ?? String(error), error)
  }

  const memfsRoot = await wasmApi.createMemoryFileSystem()

  const setupStart = nowMs()
  await Promise.all([
    unzipToMemfs(memfsRoot, await readFile(join(appRoot, 'static', 'library', STDLIB_ENTRY.sourceZipName)), STDLIB_ENTRY.archiveRootPrefix),
    unzipToMemfs(memfsRoot, await readFile(join(appRoot, 'static', 'library', CUBICAL_ENTRY.sourceZipName)), CUBICAL_ENTRY.archiveRootPrefix),
    writeTextFile(memfsRoot, '/home/user/.config/agda/libraries', ['/standard-library.agda-lib', '/cubical.agda-lib'].join('\n')),
    writeTextFile(memfsRoot, '/home/user/.config/agda/defaults', ['standard-library', 'cubical-0.9'].join('\n')),
    writeTextFile(memfsRoot, '/source.agda', source),
  ])
  const setupMs = durationSince(setupStart)

  let process
  try {
    process = await wasmApi.createProcess('als', WebAssembly.compile(await readFile(join(appRoot, 'static', 'als', 'als-2.8ext.wasm'))), {
      initial: 1,
      maximum: 1,
      shared: true,
    }, {
      env: {
        TMPDIR: '/tmp',
        HOME: '/home/user',
        Agda_datadir: '/opt/agda',
      },
      stdio: createPatchedStdio(wasmApi),
      args: ['+RTS', '-V1', '-RTS'],
      mountPoints: [
        { kind: 'memoryFileSystem', fileSystem: memfsRoot, mountPoint: '/' },
      ],
    })
  } catch (error) {
    throw makeStageError('process startup', error?.message ?? String(error), error)
  }

  const session = createDirectSession(process, options.debug)
  try {
    try {
      await session.initialize(source)
    } catch (error) {
      throw makeStageError('LSP initialize', error?.message ?? String(error), error)
    }

    let firstLoad
    try {
      firstLoad = await session.load()
    } catch (error) {
      throw makeStageError('Cmd_load', error?.message ?? String(error), error)
    }

    let secondLoad
    try {
      secondLoad = await session.load()
    } catch (error) {
      throw makeStageError('ResponseEnd', error?.message ?? String(error), error)
    }

    await session.shutdown()
    await process.terminate()
    return {
      runtime: 'vscode-wasm-memfs',
      fixture,
      setupMs,
      firstLoad,
      secondLoad,
    }
  } catch (error) {
    await process.terminate().catch(() => {})
    throw error
  }
}
