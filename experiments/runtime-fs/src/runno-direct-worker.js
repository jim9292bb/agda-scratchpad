import { parentPort, workerData } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import * as Runno from '@runno/wasi'
import JSZip from 'jszip'
import { LspMessageParser } from './lsp.js'

const { Result } = Runno.WASISnapshotPreview1
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const now = new Date()
const debugEnabled = Boolean(workerData.debug)

function debug(message, detail = {}) {
  if (debugEnabled) parentPort.postMessage({ type: 'debug', message, detail })
}

function createFileEntry(path, content) {
  return [path, {
    path,
    timestamps: { access: now, change: now, modification: now },
    mode: typeof content === 'string' ? 'string' : 'binary',
    content,
  }]
}

function fsAssign(fs, path, content) {
  const [key, obj] = createFileEntry(path, content)
  fs[key] = obj
  return obj
}

async function extractZip(fs, data, prefix = '', pathResolver = path => path) {
  const zip = await JSZip.loadAsync(data)
  const files = []
  zip.forEach((path, file) => {
    if (file.dir) return
    const resolved = pathResolver(path)
    if (resolved == null) return
    files.push(file.async('uint8array').then(content => {
      fsAssign(fs, `${prefix}/${resolved}`, content)
    }))
  })
  await Promise.all(files)
  return files.length
}

const fs = Object.fromEntries([
  createFileEntry('/source.agda', workerData.source),
])

const env = {
  HOME: '/home/root',
  Agda_datadir: '/',
}

const agdaStdlibZip = await readFile(workerData.stdlibZipPath)
const agdaCubicalZip = await readFile(workerData.cubicalZipPath)

await extractZip(fs, agdaStdlibZip, '/stdlib', path => {
  if (!path.match(/^agda-stdlib-[\.\d]+\/src/) &&
      !path.match(/^agda-stdlib-[\.\d]+\/standard-library\.agda-lib$/)) {
    return null
  }
  return path.replace(/^agda-stdlib-[\.\d]+\//, '')
})

await extractZip(fs, agdaCubicalZip, '/cubical', path => {
  if (!path.startsWith('cubical-0.9/')) return null
  return path.replace(/^cubical-0\.9\//, '')
})

fsAssign(fs, '/home/root/.config/agda/libraries', '/stdlib/standard-library.agda-lib\n/cubical/cubical.agda-lib\n')
fsAssign(fs, '/home/root/.config/agda/defaults', 'standard-library\ncubical-0.9\n')

const wasmBytes = await readFile(workerData.wasmPath)
const module = await WebAssembly.compile(wasmBytes)

const runnoInterceptor = (name, args, ret) => {
  if (name === 'fd_fdstat_set_flags' && args[0] === 0 && args[1] === 4) return 0
  if (name === 'path_readlink') return 28
  if (name === 'path_filestat_get' && ret === 76) return 44
  if (name === 'path_create_directory' && ret === 76) return 20
  return ret
}

function createStats() {
  return {
    totalCalls: 0,
    methods: {},
    pathStatCount: 0,
    agdaiRead: 0,
    agdaiWrite: 0,
  }
}

let stats = createStats()
const fdPaths = new Map()

function wrapDriveForStats(drive) {
  const methods = [
    'open', 'close', 'read', 'pread', 'write', 'pwrite', 'pathStat', 'renumber',
    'unlink', 'rename', 'pathCreateDir', 'exists', 'fileType', 'fileFdflags',
  ]

  for (const method of methods) {
    if (typeof drive[method] !== 'function') continue
    const orig = drive[method].bind(drive)
    drive[method] = (...args) => {
      stats.totalCalls++
      stats.methods[method] = (stats.methods[method] ?? 0) + 1
      if (method === 'pathStat') stats.pathStatCount++
      if ((method === 'write' || method === 'pwrite') && fdPaths.get(args[0])?.endsWith('.agdai')) {
        stats.agdaiWrite++
      }
      const res = orig(...args)
      if (method === 'open' && Array.isArray(res) && res[0] === 0 && typeof res[1] === 'number') {
        fdPaths.set(res[1], args[1])
      } else if (method === 'close' && Array.isArray(res) && res[0] === 0) {
        fdPaths.delete(args[0])
      } else if ((method === 'read' || method === 'pread') && fdPaths.get(args[0])?.endsWith('.agdai')) {
        stats.agdaiRead++
      } else if (method === 'renumber' && Array.isArray(res) && res[0] === 0) {
        const path = fdPaths.get(args[0])
        if (path) {
          fdPaths.delete(args[0])
          fdPaths.set(args[1], path)
        }
      }
      return res
    }
  }
}

function snapshotStats() {
  const result = stats
  stats = createStats()
  return result
}

function patchImportObject(wasi, pollStdin) {
  const { wasi_snapshot_preview1, ...rest } = wasi.getImportObject()
  const origFdRead = wasi_snapshot_preview1.fd_read
  const origFdWrite = wasi_snapshot_preview1.fd_write
  const origPollOneoff = wasi_snapshot_preview1.poll_oneoff

  return {
    ...rest,
    wasi_snapshot_preview1: {
      ...wasi_snapshot_preview1,
      fd_read: wrapFdRead.bind(wasi)(origFdRead),
      fd_write: wrapFdWrite.bind(wasi)(origFdWrite),
      poll_oneoff: wrapPollOneoff.bind(wasi)(origPollOneoff, pollStdin),
    },
  }
}

function collectIOVectors(view, ptr, len) {
  const ptrlens = []
  let lenTotal = 0
  for (let i = 0; i < len; i++) {
    const bufferPtr = view.getUint32(ptr, true)
    ptr += 4
    const bufferLen = view.getUint32(ptr, true)
    ptr += 4
    lenTotal += bufferLen
    ptrlens.push([bufferPtr, bufferLen])
  }
  return { lenTotal, ptrlens }
}

function readIOVectorsMerged(view, iovsDesc) {
  const source = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  const result = new Uint8Array(iovsDesc.lenTotal)
  let written = 0
  for (const [ptr, len] of iovsDesc.ptrlens) {
    result.set(source.subarray(ptr, ptr + len), written)
    written += len
  }
  return result
}

function writeIntoIOVectors(buf, iovsDesc, input) {
  let written = 0
  for (const [ptr, len] of iovsDesc.ptrlens) {
    const extent = Math.min(written + len, input.byteLength)
    buf.set(input.slice(written, extent), ptr)
    written = extent
    if (written === input.byteLength) break
  }
}

function wrapFdRead(origFdRead) {
  return (...args) => {
    const [fd, iovsPtr, iovsLen, retptr0] = args
    if (fd !== 0) return origFdRead(...args)
    const view = new DataView(this.memory.buffer)
    const iovDescs = collectIOVectors(view, iovsPtr, iovsLen)
    const input = this.context.stdin(iovDescs.lenTotal)
    if (input == null) return Result.EAGAIN
    const bytes = Math.min(iovDescs.lenTotal, input.byteLength)
    writeIntoIOVectors(new Uint8Array(this.memory.buffer), iovDescs, input)
    view.setUint32(retptr0, bytes, true)
    return Result.SUCCESS
  }
}

function wrapFdWrite(origFdWrite) {
  return (...args) => {
    const [fd, ciovsPtr, ciovsLen, retptr0] = args
    if (fd !== 1 && fd !== 2) return origFdWrite(...args)
    const view = new DataView(this.memory.buffer)
    const iovDescs = collectIOVectors(view, ciovsPtr, ciovsLen)
    const iov = readIOVectorsMerged(view, iovDescs)
    const bytesWritten = iov.byteLength
    if (bytesWritten > 0) {
      const stdfn = fd === 1 ? this.context.stdout : this.context.stderr
      stdfn(iov)
    }
    view.setUint32(retptr0, bytesWritten, true)
    return Result.SUCCESS
  }
}

const SUBSCRIPTION_SIZE = 48
const EVENT_SIZE = 32
const EVENT_CLOCK = 0
const EVENT_FD_READ = 1

function wrapPollOneoff(origPollOneoff, pollStdin) {
  return (...args) => {
    const [inPtr, outPtr, nsubscriptions, retptr0] = args
    let hasStdin = false
    let clock = null
    for (let i = 0; i < nsubscriptions; i++) {
      const ptr = inPtr + i * SUBSCRIPTION_SIZE
      const view = new DataView(this.memory.buffer, ptr, SUBSCRIPTION_SIZE)
      const userdata = new Uint8Array(this.memory.buffer, ptr, 8).slice()
      const type = view.getUint8(8)
      const unionView = new DataView(this.memory.buffer, ptr + 9, SUBSCRIPTION_SIZE - 9)
      const fd = unionView.getUint32(0, true)
      debug('poll-subscription', { type, fd })
      if (type === EVENT_FD_READ && fd === 0) hasStdin = true
      if (type === EVENT_CLOCK) {
        const timeoutRawNanos = unionView.getBigUint64(8, true)
        clock = { userdata, timeout: Number(timeoutRawNanos) / 1e6 }
      }
    }

    if (hasStdin) {
      const ready = pollStdin(clock ? clock.timeout : -1)
      if (!ready && clock) {
        const eventBuffer = new Uint8Array(this.memory.buffer, outPtr, EVENT_SIZE)
        eventBuffer.set(clock.userdata, 0)
        const eventView = new DataView(this.memory.buffer, outPtr, EVENT_SIZE)
        eventView.setUint16(8, Result.SUCCESS, true)
        eventView.setUint16(10, EVENT_CLOCK, true)
        new DataView(this.memory.buffer, retptr0, 4).setUint32(0, 1, true)
        return Result.SUCCESS
      }
    }

    return origPollOneoff(...args)
  }
}

function runSetup() {
  const stdout = []
  const stderr = []
  const setupStart = performance.now()
  const wasi = new Runno.WASI({
    args: ['als', '--setup'],
    env,
    fs,
    debug: runnoInterceptor,
    stdout: out => stdout.push(typeof out === 'string' ? out : decoder.decode(out)),
    stderr: err => stderr.push(typeof err === 'string' ? err : decoder.decode(err)),
  })
  const instance = new WebAssembly.Instance(module, wasi.getImportObject())
  const { exitCode } = wasi.start({ module, instance })
  const setupMs = Math.round((performance.now() - setupStart) * 1000) / 1000
  if (exitCode !== 0) {
    throw new Error(`als --setup failed with ${exitCode}: ${stderr.join('') || stdout.join('')}`)
  }
  return setupMs
}

const stdinSab = workerData.stdinSab
const stdinState = new Int32Array(stdinSab, 0, 2)
const stdinBytes = new Uint8Array(stdinSab, 8)
let stdinOffset = 0
let stdinLength = 0
const incomingParser = new LspMessageParser()
const outgoingParser = new LspMessageParser()

function readStdin(len) {
  debug('stdin-read-request', { len, available: Atomics.load(stdinState, 0), buffered: stdinLength })
  if (stdinLength === 0) {
    const available = Atomics.load(stdinState, 0)
    if (available === 0) return null
    stdinLength = available
    stdinOffset = 0
  }

  const bytes = Math.min(len, stdinLength - stdinOffset)
  const result = stdinBytes.slice(stdinOffset, stdinOffset + bytes)
  stdinOffset += bytes
  if (stdinOffset >= stdinLength) {
    stdinLength = 0
    stdinOffset = 0
    Atomics.store(stdinState, 0, 0)
    Atomics.store(stdinState, 1, 1)
    Atomics.notify(stdinState, 1)
  }

  for (const message of incomingParser.push(result)) {
    debug('stdin-message', { method: message.method, id: message.id })
    if (message.method === 'agda' && message.params?.contents?.includes('Cmd_load')) {
      snapshotStats()
    }
  }
  return result
}

function pollStdin(timeout) {
  debug('poll-stdin', { timeout, available: Atomics.load(stdinState, 0), buffered: stdinLength })
  if (Atomics.load(stdinState, 0) > 0 || stdinLength > 0) return true
  if (timeout === 0) return false
  const waitMs = timeout < 0 ? undefined : timeout
  Atomics.wait(stdinState, 0, 0, waitMs)
  return Atomics.load(stdinState, 0) > 0
}

const setupMs = runSetup()
parentPort.postMessage({ type: 'ready', setupMs })

const wasi = new Runno.WASI({
  args: ['als', '--raw'],
  env,
  fs,
  debug: runnoInterceptor,
  stdin: readStdin,
  stdout(out) {
    const chunk = out instanceof Uint8Array ? out : encoder.encode(out)
    for (const message of outgoingParser.push(chunk)) {
      debug('outgoing-message', { id: message.id, method: message.method, tag: message.params?.tag })
      if (message.method === 'agda' && message.params?.tag === 'ResponseEnd') {
        parentPort.postMessage({ type: 'driveStats', stats: snapshotStats() })
      }
    }
    const transferred = chunk.slice()
    parentPort.postMessage({ type: 'stdout', chunk: transferred }, [transferred.buffer])
  },
  stderr(err) {
    const text = err instanceof Uint8Array ? decoder.decode(err) : String(err)
    if (text) parentPort.postMessage({ type: 'stderr', text })
  },
})

wrapDriveForStats(wasi.drive)
const instance = new WebAssembly.Instance(module, patchImportObject(wasi, pollStdin))
const { exitCode } = wasi.start({ module, instance })
parentPort.postMessage({ type: 'exit', exitCode })
