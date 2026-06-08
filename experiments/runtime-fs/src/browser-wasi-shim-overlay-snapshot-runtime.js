import { parentPort, workerData } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { SPSC } from 'spsc'
import {
  Fd,
  File,
  Directory,
  PreopenDirectory,
  StdinBuffer,
  WASI,
  wasi,
} from '../../../../references/agda-web-browser_wasi_shim/dist/index.js'
import { LspMessageParser } from './lsp.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const debugEnabled = Boolean(workerData?.debug)

function debug(message, detail = {}) {
  if (debugEnabled) parentPort.postMessage({ type: 'debug', message, detail })
}

function traceState(kind, value) {
  if (debugEnabled) parentPort.postMessage({ type: 'traceState', kind, value })
}

function nowMs() {
  return performance.now()
}

function durationSince(start) {
  return Math.round((performance.now() - start) * 1000) / 1000
}

function makeStageError(stage, message, cause) {
  const error = new Error(`browser-wasi-shim-overlay-snapshot blocked at ${stage}: ${message}`)
  error.stage = stage
  error.cause = cause
  return error
}

function createStats() {
  return {
    pathStatCache: false,
    pathStatCacheHits: 0,
    pathStatCacheMisses: 0,
    totalCalls: 0,
    totalDurationMs: 0,
    bytesRead: 0,
    bytesWritten: 0,
    methods: {},
    methodDurationsMs: {},
    pathStatPaths: {},
    openPaths: {},
    uniquePathStatPaths: 0,
    pathStatSuccesses: 0,
    pathStatFailures: 0,
    pathStatCount: 0,
    agda: { pathStat: 0, open: 0, read: 0, write: 0 },
    agdai: { pathStat: 0, open: 0, read: 0, write: 0 },
    agdaiRead: 0,
    agdaiWrite: 0,
  }
}

function flattenStats(stats) {
  return {
    ...stats,
    uniquePathStatPaths: Object.keys(stats.pathStatPaths).length,
  }
}

function normalizeDuration(durationMs) {
  return Math.round(durationMs * 1000) / 1000
}

function normalizeWasiPath(path) {
  if (typeof path !== 'string') return path
  const trimmed = path.replace(/^\/+/, '')
  return trimmed === '' ? '.' : trimmed
}

function pathExtension(path) {
  if (!path) return null
  if (path.endsWith('.agdai')) return 'agdai'
  if (path.endsWith('.agda')) return 'agda'
  return null
}

function recordPathStats(bucket, path, durationMs) {
  if (!path) return
  const current = bucket[path] ?? { count: 0, durationMs: 0 }
  current.count++
  current.durationMs = normalizeDuration(current.durationMs + durationMs)
  bucket[path] = current
}

function incrementExtension(stats, path, operation) {
  const ext = pathExtension(path)
  if (!ext) return
  stats[ext][operation]++
  if (ext === 'agdai' && operation === 'read') stats.agdaiRead++
  if (ext === 'agdai' && operation === 'write') stats.agdaiWrite++
}

function ensureDir(root, relPath) {
  const parts = relPath.split('/').filter(Boolean)
  let dir = root
  for (const part of parts) {
    let child = dir.contents.get(part)
    if (!child) {
      child = new Directory(new Map())
      child.parent = dir
      dir.contents.set(part, child)
    } else if (!(child instanceof Directory)) {
      throw new Error(`Path component ${part} is not a directory`)
    }
    dir = child
  }
  return dir
}

function ensureParentDir(root, relPath) {
  const parts = relPath.split('/').filter(Boolean)
  const name = parts.pop()
  if (!name) throw new Error(`Invalid path ${relPath}`)
  return { dir: ensureDir(root, parts.join('/')), name }
}

function writeFile(root, relPath, bytes, readonly = false) {
  const { dir, name } = ensureParentDir(root, relPath)
  const file = new File(bytes, { readonly })
  dir.contents.set(name, file)
  file.parent = dir
  return file
}

async function extractZip(root, bytes, baseDir, stripPrefix, pathResolver, readonlyResolver = () => false) {
  const zip = await JSZip.loadAsync(bytes)
  const tasks = []
  zip.forEach((path, entry) => {
    if (entry.dir) return
    if (!path.startsWith(stripPrefix)) return
    const rel = path.replace(stripPrefix, '')
    const resolved = pathResolver ? pathResolver(path, rel) : rel
    if (resolved == null) return
    tasks.push(entry.async('uint8array').then(content => writeFile(root, `${baseDir}/${resolved}`, content, readonlyResolver(path, resolved, rel))))
  })
  await Promise.all(tasks)
  return tasks.length
}

function createRootFs(sourceBytes) {
  const root = new Directory(new Map())
  writeFile(root, 'source.agda', typeof sourceBytes === 'string' ? encoder.encode(sourceBytes) : sourceBytes)
  return root
}

function createSpscBuffer(capacity = 1024 * 1024) {
  const sab = SPSC.allocateArrayBuffer(capacity)
  SPSC.resetArrayBuffer(sab)
  return sab
}

function createOutputSink(kind) {
  return new (class extends Fd {
    fd_fdstat_get() {
      const fdstat = new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0)
      fdstat.fs_rights_base = BigInt(wasi.RIGHTS_FD_WRITE)
      return { ret: 0, fdstat }
    }

    fd_filestat_get() {
      return { ret: 0, filestat: new wasi.Filestat(0n, wasi.FILETYPE_CHARACTER_DEVICE, BigInt(0)) }
    }

    fd_write(data) {
      if (kind === 'stdout') {
        const chunk = data.slice()
        parentPort.postMessage({ type: 'stdout', chunk }, [chunk.buffer])
      } else {
        const text = decoder.decode(data)
        if (text) parentPort.postMessage({ type: 'stderr', text })
      }
      return { ret: 0, nwritten: data.byteLength }
    }
  })()
}

function createInstrumentedImport(wasiInstance, stats) {
  const fdPaths = new Map()
  const memoryView = () => new DataView(wasiInstance.inst.exports.memory.buffer)

  const pathSpecs = {
    path_filestat_get: [{ ptr: 2, len: 3 }],
    path_open: [{ ptr: 2, len: 3 }],
    path_create_directory: [{ ptr: 1, len: 2 }],
    path_filestat_set_times: [{ ptr: 2, len: 3 }],
    path_unlink_file: [{ ptr: 1, len: 2 }],
    path_remove_directory: [{ ptr: 1, len: 2 }],
    path_readlink: [{ ptr: 1, len: 2 }],
    path_symlink: [{ ptr: 0, len: 1 }, { ptr: 3, len: 4 }],
    path_link: [{ ptr: 2, len: 3 }, { ptr: 5, len: 6 }],
    path_rename: [{ ptr: 1, len: 2 }, { ptr: 4, len: 5 }],
  }

  const normalizePathArgs = (methodName, args) => {
    const spec = pathSpecs[methodName]
    if (!spec) return { path: null, args }
    const forwarded = args.slice()
    const memory = new Uint8Array(wasiInstance.inst.exports.memory.buffer)
    const paths = []
    for (const item of spec) {
      const original = decoder.decode(memory.slice(args[item.ptr], args[item.ptr] + args[item.len]))
      const normalized = normalizeWasiPath(original)
      paths.push(normalized)
      const bytes = encoder.encode(normalized)
      memory.set(bytes, args[item.ptr])
      forwarded[item.len] = bytes.byteLength
    }
    return { path: paths.length === 1 ? paths[0] : paths, args: forwarded }
  }

  const wrap = (methodName, fn) => {
    if (typeof fn !== 'function') return fn
    return (...args) => {
      const startedAt = nowMs()
      const { path, args: forwardedArgs } = normalizePathArgs(methodName, args)
      const result = fn(...forwardedArgs)
      const durationMs = nowMs() - startedAt

      stats.totalCalls++
      stats.totalDurationMs = normalizeDuration(stats.totalDurationMs + durationMs)
      stats.methods[methodName] = (stats.methods[methodName] ?? 0) + 1
      stats.methodDurationsMs[methodName] = normalizeDuration((stats.methodDurationsMs[methodName] ?? 0) + durationMs)

      if (methodName === 'path_filestat_get') {
        stats.pathStatCount++
        recordPathStats(stats.pathStatPaths, path, durationMs)
        if (result === 0) stats.pathStatSuccesses++
        else stats.pathStatFailures++
        incrementExtension(stats, path, 'pathStat')
      }

      if (methodName === 'path_open' && result === 0) {
        const openedFd = memoryView().getUint32(forwardedArgs[8], true)
        const openedPath = Array.isArray(path) ? path[0] : path
        fdPaths.set(openedFd, openedPath)
        stats.openPaths[openedPath ?? ''] = (stats.openPaths[openedPath ?? ''] ?? 0) + 1
        incrementExtension(stats, openedPath, 'open')
      }

      if (methodName === 'fd_close' && result === 0) {
        fdPaths.delete(args[0])
      }

      if (methodName === 'fd_renumber' && result === 0) {
        const fromPath = fdPaths.get(args[0]) ?? null
        if (fromPath) {
          fdPaths.delete(args[0])
          fdPaths.set(args[1], fromPath)
        }
      }

      if ((methodName === 'fd_read' || methodName === 'fd_pread') && result === 0) {
        const fdPath = fdPaths.get(args[0]) ?? null
        if (fdPath) {
          incrementExtension(stats, fdPath, 'read')
          const nreadPtr = methodName === 'fd_read' ? args[3] : args[4]
          const nread = memoryView().getUint32(nreadPtr, true)
          stats.bytesRead += nread
        }
      }

      if ((methodName === 'fd_write' || methodName === 'fd_pwrite') && result === 0) {
        const fdPath = fdPaths.get(args[0]) ?? null
        if (fdPath) {
          incrementExtension(stats, fdPath, 'write')
          const nwrittenPtr = methodName === 'fd_write' ? args[3] : args[4]
          const nwritten = memoryView().getUint32(nwrittenPtr, true)
          stats.bytesWritten += nwritten
        }
      }

      if (methodName === 'path_open' || methodName === 'path_filestat_get') {
        traceState('fs', {
          method: methodName,
          path,
          durationMs: normalizeDuration(durationMs),
          resultCode: result,
        })
      }

      return result
    }
  }

  const wrapped = {
    __resetTracking() {
      fdPaths.clear()
    },
  }
  for (const [name, fn] of Object.entries(wasiInstance.wasiImport)) {
    wrapped[name] = wrap(name, fn)
  }
  return wrapped
}

async function buildFilesystem(sourceBytes, stdlibZipPath, cubicalZipPath) {
  const root = createRootFs(sourceBytes)

  const stdlibZip = await readFile(stdlibZipPath)
  await extractZip(root, stdlibZip, 'stdlib', '', path => {
    if (
      !path.match(/^agda-stdlib-[\.\d]+\/src/) &&
      !path.match(/^agda-stdlib-[\.\d]+\/standard-library\.agda-lib$/)
    ) {
      return null
    }
    return path.replace(/^agda-stdlib-[\.\d]+\//, '')
  }, (_path, resolved) => !resolved.endsWith('.agdai'))

  const cubicalZip = await readFile(cubicalZipPath)
  await extractZip(root, cubicalZip, 'cubical', '', path => {
    if (!path.startsWith('cubical-0.9/')) return null
    return path.replace(/^cubical-0\.9\//, '')
  }, (_path, resolved) => !resolved.endsWith('.agdai'))

  writeFile(root, 'home/root/.config/agda/libraries', encoder.encode('stdlib/standard-library.agda-lib\ncubical/cubical.agda-lib\n'))
  writeFile(root, 'home/root/.config/agda/defaults', encoder.encode('standard-library\ncubical-0.9\n'))

  return root
}

function createWasi(fsRoot, stdinBuffer, stdoutSink, stderrSink, stats = null, args = ['als'], debug = false) {
  const wasi = new WASI(args, ['HOME=/home/root', 'Agda_datadir=/'], [stdinBuffer, stdoutSink, stderrSink, new PreopenDirectory('/', fsRoot.contents)], { debug })
  if (stats) {
    wasi.wasiImport = createInstrumentedImport(wasi, stats)
  }
  return wasi
}

async function runSetup(module, fsRoot) {
  const setupStats = createStats()
  const setupWasi = createWasi(
    fsRoot,
    new StdinBuffer(createSpscBuffer()),
    createOutputSink('stdout'),
    createOutputSink('stderr'),
    setupStats,
    ['als', '--setup'],
    debugEnabled,
  )
  const setupInstance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: setupWasi.wasiImport })
  const startedAt = nowMs()
  const exitCode = setupWasi.start(setupInstance)
  const setupMs = durationSince(startedAt)
  if (exitCode !== 0) {
    throw makeStageError('setup', `als --setup failed with ${exitCode}`, null)
  }
  return setupMs
}

async function runRaw(module, fsRoot, setupMs) {
  const stats = createStats()
  const stdinBuffer = new StdinBuffer(workerData.stdin)
  let rawWasi = null
  const snapshotAndResetStats = () => {
    const snapshot = flattenStats(stats)
    Object.assign(stats, createStats())
    rawWasi?.wasiImport?.__resetTracking?.()
    return snapshot
  }

  const stdoutParser = new LspMessageParser()

  const stdoutSink = createBinarySink(chunk => {
    const parserChunk = chunk.slice()
    for (const payload of stdoutParser.push(parserChunk)) {
      debug('stdout-message', {
        id: payload.id ?? null,
        method: payload.method ?? null,
        paramsTag: payload.params?.tag ?? null,
        resultTag: payload.result?.tag ?? payload.result?.contents?.tag ?? null,
      })
      if (payload.result?.tag === 'CmdRes' || payload.result?.contents?.tag === 'CmdRes') {
        traceState('fs-summary', { sawCmdRes: true, totalCalls: stats.totalCalls })
      }
      if (payload.method === 'agda' && payload.params?.tag === 'ResponseEnd') {
        parentPort.postMessage({ type: 'driveStats', stats: snapshotAndResetStats() })
      }
    }
    parentPort.postMessage({ type: 'stdout', chunk: parserChunk }, [parserChunk.buffer])
  })
  const stderrSink = createTextSink(text => parentPort.postMessage({ type: 'stderr', text }))
  rawWasi = createWasi(
    fsRoot,
    stdinBuffer,
    stdoutSink,
    stderrSink,
    stats,
    ['als', '--raw'],
    debugEnabled,
  )
  rawWasi.wasiImport = createInstrumentedImport(rawWasi, stats)
  const rawInstance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: rawWasi.wasiImport })
  parentPort.postMessage({ type: 'ready', setupMs })

  let exitCode = 0
  try {
    exitCode = rawWasi.start(rawInstance)
  } catch (error) {
    const text = error?.stack ?? error?.message ?? String(error)
    parentPort.postMessage({ type: 'stderr', text: `${text}\n` })
    parentPort.postMessage({ type: 'exit', exitCode: 1 })
    return
  }
  traceState('wasi-exit', { exitCode })
  parentPort.postMessage({ type: 'exit', exitCode })
}

function createBinarySink(onChunk) {
  return new (class extends Fd {
    fd_fdstat_get() {
      const fdstat = new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0)
      fdstat.fs_rights_base = BigInt(wasi.RIGHTS_FD_WRITE)
      return { ret: 0, fdstat }
    }

    fd_filestat_get() {
      return { ret: 0, filestat: new wasi.Filestat(0n, wasi.FILETYPE_CHARACTER_DEVICE, BigInt(0)) }
    }

    fd_write(data) {
      const chunk = data.slice()
      onChunk(chunk)
      return { ret: 0, nwritten: data.byteLength }
    }
  })()
}

function createTextSink(onText) {
  return new (class extends Fd {
    fd_fdstat_get() {
      const fdstat = new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0)
      fdstat.fs_rights_base = BigInt(wasi.RIGHTS_FD_WRITE)
      return { ret: 0, fdstat }
    }

    fd_filestat_get() {
      return { ret: 0, filestat: new wasi.Filestat(0n, wasi.FILETYPE_CHARACTER_DEVICE, BigInt(0)) }
    }

    fd_write(data) {
      const text = decoder.decode(data)
      if (text) onText(text)
      return { ret: 0, nwritten: data.byteLength }
    }
  })()
}

export async function runBrowserWasiShimOverlaySnapshot(fixture, options = {}) {
  const source = workerData.source
  const fsRoot = await buildFilesystem(source, workerData.stdlibZipPath, workerData.cubicalZipPath)
  const wasmBytes = await readFile(workerData.wasmPath)
  const module = await WebAssembly.compile(wasmBytes)

  try {
    const setupMs = await runSetup(module, fsRoot)
    await runRaw(module, fsRoot, setupMs)
  } catch (error) {
    throw error?.stage ? error : makeStageError(error?.stage ?? 'runtime', error?.message ?? String(error), error)
  }
}

if (parentPort) {
  const main = async () => {
    try {
      const source = workerData.source
      const fsRoot = await buildFilesystem(source, workerData.stdlibZipPath, workerData.cubicalZipPath)
      const wasmBytes = await readFile(workerData.wasmPath)
      const module = await WebAssembly.compile(wasmBytes)
      const setupMs = await runSetup(module, fsRoot)
      await runRaw(module, fsRoot, setupMs)
    } catch (error) {
      const text = error?.stack ?? error?.message ?? String(error)
      parentPort.postMessage({ type: 'stderr', text: `${text}\n` })
      parentPort.postMessage({ type: 'exit', exitCode: 1 })
    }
  }
  main()
}
