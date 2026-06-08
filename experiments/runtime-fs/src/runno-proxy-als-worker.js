import { parentPort, workerData } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import * as Runno from '@runno/wasi'
import { SPSCError } from 'spsc'
import { SPSCReader } from 'spsc/reader'
import { SPSCWriter } from 'spsc/writer'
import {
  base64ToUint8Array,
  bufGetUint32LE,
  fread,
  fwrite,
  uint8ArrayToBase64,
  writeLenPrefixed,
} from './spsc-utils.js'

const { Result } = Runno.WASISnapshotPreview1
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const debugEnabled = Boolean(workerData.debug)

function traceState(kind, value) {
  if (debugEnabled) parentPort.postMessage({ type: 'traceState', kind, value })
}

const env = {
  HOME: '/home/root',
  Agda_datadir: '/',
}

const runnoInterceptor = (name, args, ret) => {
  if (name === 'fd_fdstat_set_flags' && args[0] === 0 && args[1] === 4) return 0
  if (name === 'path_readlink') return 28
  if (name === 'path_filestat_get' && ret === 76) return 44
  if (name === 'path_create_directory' && ret === 76) return 20
  return ret
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

function fixStatCommon(result) {
  if (Array.isArray(result) && result.length > 1 && result[1]?.timestamps) {
    const file = result[1]
    file.timestamps.access = new Date(file.timestamps.access)
    file.timestamps.change = new Date(file.timestamps.change)
    file.timestamps.modification = new Date(file.timestamps.modification)
  }
  return result
}

function proxyWasiDrive(drive, lock, stdin, stdout) {
  const driveMutex = new Int32Array(lock, 0, 1)
  const reader = new SPSCReader(stdin)
  const writer = new SPSCWriter(stdout)

  const methods = [
    'open', 'close', 'read', 'pread', 'write', 'pwrite', 'sync', 'seek', 'tell',
    'renumber', 'unlink', 'rename', 'list', 'stat', 'pathStat', 'setFlags',
    'setSize', 'setAccessTime', 'setModificationTime', 'pathSetAccessTime',
    'pathSetModificationTime', 'pathCreateDir', 'exists', 'fileType',
    'fileFdflags',
  ]

  for (const method of methods) {
    drive[method] = (...args) => {
      const startedAt = performance.now()
      if (method === 'setSize') {
        args[1] = args[1].toString()
      } else if ((method === 'write' || method === 'pwrite') && args[1] != null) {
        args[1] = uint8ArrayToBase64(args[1])
      }

      while (true) {
        const oldFlag = Atomics.compareExchange(driveMutex, 0, 0, 1)
        if (oldFlag === 0) break
        Atomics.wait(driveMutex, 0, oldFlag)
      }

      fwrite(writer, new Uint8Array(new Uint32Array([0]).buffer))
      writeLenPrefixed(writer, encoder.encode(JSON.stringify({ method, args })))
      Atomics.notify(driveMutex, 0, 1)

      const len = bufGetUint32LE(fread(reader, 4))
      const data = fread(reader, len)

      const oldFlag = Atomics.compareExchange(driveMutex, 0, 1, 0)
      if (oldFlag !== 1) throw new Error('drive mutex content is corrupted')
      Atomics.notify(driveMutex, 0, 1)

      let result = JSON.parse(decoder.decode(data))
      if (method === 'pathStat' || method === 'stat') {
        result = fixStatCommon(result)
      } else if ((method === 'read' || method === 'pread') && result[1] != null) {
        result[1] = base64ToUint8Array(result[1])
      }
      traceState('fs', {
        method,
        durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
        path: typeof args[1] === 'string' ? args[1] : null,
        fd: typeof args[0] === 'number' ? args[0] : null,
        resultCode: Array.isArray(result) ? result[0] : null,
      })
      return result
    }
  }
}

function createWasi(args, options = {}) {
  const wasi = new Runno.WASI({
    args: ['als', ...args],
    env,
    debug: runnoInterceptor,
    stdin: options.stdin,
    stdout: options.stdout,
    stderr(err) {
      const text = err instanceof Uint8Array ? decoder.decode(err) : String(err)
      if (text) parentPort.postMessage({ type: 'stderr', text })
    },
  })
  proxyWasiDrive(wasi.drive, workerData.drive.lock, workerData.drive.stdin, workerData.drive.stdout)
  return wasi
}

const wasmBytes = await readFile(workerData.wasmPath)
const module = await WebAssembly.compile(wasmBytes)

function runSetup() {
  const start = performance.now()
  const wasi = createWasi(['--setup'], {
    stdout() {},
    stdin() {
      return null
    },
  })
  const instance = new WebAssembly.Instance(module, wasi.getImportObject())
  const { exitCode } = wasi.start({ module, instance })
  const setupMs = Math.round((performance.now() - start) * 1000) / 1000
  if (exitCode !== 0) throw new Error(`als --setup failed with ${exitCode}`)
  return setupMs
}

const setupMs = runSetup()
parentPort.postMessage({ type: 'ready', setupMs })

const stdinReader = new SPSCReader(workerData.stdin)
const stdoutWriter = new SPSCWriter(workerData.stdout)

const wasi = createWasi(['--raw'], {
  stdin(len) {
    const result = stdinReader.read(len, { nonblock: true })
    if (!result.ok) {
      if (result.error === SPSCError.Again) return null
      throw new Error(`WASM failed to read from stdin: ${result.error}`)
    }
    return result.data
  },
  stdout(buf) {
    const data = buf instanceof Uint8Array ? buf : encoder.encode(buf)
    fwrite(stdoutWriter, data)
  },
})

function pollStdin(timeout) {
  const waitDuration = timeout < 0 ? Infinity : Math.max(timeout - Date.now(), 0)
  return stdinReader.pollRead(waitDuration)
}

const instance = new WebAssembly.Instance(module, patchImportObject(wasi, pollStdin))

const { exitCode } = wasi.start({ module, instance })
parentPort.postMessage({ type: 'exit', exitCode })
