/** @import { SPSCReader } from 'spsc/reader' */
/** @import { SPSCWriter } from 'spsc/writer' */
import { SPSCError } from 'spsc'
import * as Comlink from 'comlink'

// feature detection, unfortunately async
let browserSupportBYOBReadable = false
queueMicrotask(() => {
  ;(async () => {
    const rs = new ReadableStream({
      type: 'bytes',
      // when this is defined, byobRequest should always be available
      // https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/ReadableStream#autoallocatechunksize
      autoAllocateChunkSize: 8,
      async pull(controller) {
        const breq = controller.byobRequest
        if (breq?.view == null) {
          throw new Error('byobRequest support is borked')
        }
        const view = new Uint8Array(breq.view.buffer, breq.view.byteOffset, breq.view.byteLength)
        view[0] = 1
        breq.respond(1)
        controller.close()
      },
    })
    const ws = new WritableStream()
    await rs.pipeTo(ws)
    return true
  })().catch(() => false).then(ok => browserSupportBYOBReadable = ok)
})

/**
 * @param {SPSCReader} reader
 * @param {MessagePort} waker
 * @returns {ReadableStream<Uint8Array<ArrayBuffer>>}
 */
export function createReadableByteStream(reader, waker) {
  /** @type {((data?: unknown) => void) | undefined} */
  let pendingRead
  waker.onmessage = () => {
    if (pendingRead) {
      pendingRead()
      pendingRead = undefined
    }
  }

  if (!browserSupportBYOBReadable) {
    console.warn('Browser not support byob readable streams; using the fallback impl.')

    return new ReadableStream({
      async pull(controller) {
        while (true) {
          const rr = reader.read(controller.desiredSize ?? 4096, { nonblock: true })
          if (!rr.ok) {
            if (rr.error === SPSCError.Again) {
              await new Promise(resolve => pendingRead = resolve)
              continue
            }
            throw new Error('read failed')
          }

          if (rr.bytesRead) {
            controller.enqueue(/** @type {Uint8Array<ArrayBuffer>} */(rr.data))
          } else {
            console.log('process ends')
            controller.close()
          }
          break
        }
      }
    })
  }

  // "autoAllocateChunkSize" assumes forcing byob
  return new ReadableStream({
    type: 'bytes',
    async pull(controller) {
      while (true) {
        if (controller.byobRequest == null) throw new Error('there should be a byobRequest')
        const view = /** @type {Uint8Array<ArrayBuffer>} */(controller.byobRequest.view)
        const rr = reader.read(view.byteLength, { nonblock: true, into: view })
        if (!rr.ok) {
          if (rr.error === SPSCError.Again) {
            await new Promise(resolve => pendingRead = resolve)
            continue
          }
          throw new Error('read failed')
        }
        if (rr.bytesRead) {
          controller.byobRequest.respond(rr.bytesRead)
        } else {
          console.log('process ends')
          controller.close()
        }
        break
      }
    },
    autoAllocateChunkSize: reader.capacity,
  })
}

/**
 * @param {SPSCWriter} writer
 * @returns {WritableStream<Uint8Array<ArrayBuffer>>}
 *
 * TODO: waker; I think setTimeout is acceptable
 */
export function createWritableByteStream(writer) {
  return new WritableStream({
    async write(chunk) {
      let nwritten = 0
      while (nwritten < chunk.byteLength) {
        const wr = writer.write(chunk.subarray(nwritten), { nonblock: true })
        if (!wr.ok) {
          if (wr.error === SPSCError.Again) {
            await new Promise(r => setTimeout(r, 50))
            continue
          }
          throw new Error(`write failed at ${nwritten}/${chunk.byteLength}: ${wr.error}`)
        }
        nwritten += wr.bytesWritten
      }
    }
  })
}

/**
 * @typedef {{ wasmSource: import('$lib/worker/types').WASMSource, stdinWaker: MessagePort, stdin: SharedArrayBuffer, stdout: SharedArrayBuffer, sourceSab: SharedArrayBuffer, stdlibZip: ArrayBuffer, cubicalZip: ArrayBuffer, dataZip?: ArrayBuffer, agdaVersion: string }} WASIShimWorkerInitObject
 */

/**
 * @param {WASIShimWorkerInitObject} initObject
 * @param {(worker: Worker) => void} [workerPreCallback]
 */
export function makeWasiShimLspWorker(initObject, workerPreCallback) {
  const worker = new Worker(
    new URL('$lib/worker/als-wasi-shim.js?worker&inline', import.meta.url),
    { name: 'ALS WASI Shim Worker', type: 'module' })

  /** @type {Comlink.Remote<{ init: (obj: any) => any }>} */
  const endpoint = Comlink.wrap(worker)
  workerPreCallback?.(worker)

  const { wasmSource, stdinWaker, stdlibZip, cubicalZip, dataZip } = initObject

  const transferables = [
    ...(wasmSource.type === 'stream' ? [wasmSource.stream] : []),
    stdinWaker,
    stdlibZip,
    cubicalZip,
    ...(dataZip ? [dataZip] : []),
  ]

  const initPromise = endpoint.init(Comlink.transfer(initObject, transferables))

  return { endpoint, initPromise }
}

/**
 * @param {Response} resp
 * @param {(loaded: number) => void} callback */
export function traceFetchProgress(resp, callback) {
  if (resp.body == null) {
    throw new Error('Fetched no body')
  }
  if (resp.bodyUsed) {
    throw new Error('body has been consumed')
  }

  let loaded = 0, bytesTotal = -1

  const contentLength = resp.headers.get('content-length')
  if (contentLength != null) {
    bytesTotal = Number.parseInt(contentLength, 10)
  }

  /** @type {(arg: unknown) => void} */
  let dispatchFinish
  const finished = new Promise(r => dispatchFinish = r)

  let cancelled = false
  const reader = resp.body.getReader()

  // NOTE: transform stream cannot give precise progress report; seemingly because it is pull-based
  /** @type {ReadableStream<Uint8Array>} */
  const stream = new ReadableStream({
    start(controller) {
      const drainStream = async () => {
        while (true) {
          const iter = await reader.read()
          if (cancelled) {
            throw new Error('cancelled')
          }
          if (iter.done) break
          loaded += iter.value.byteLength
          callback(loaded)
          controller.enqueue(iter.value)
        }
        controller.close()
      }

      drainStream().then(dispatchFinish, err => {
        controller.error(err)
      }).finally(() => {
        reader.releaseLock()
      })
    },
  })

  return {
    source: { type: /** @type {const} */('stream'), stream },
    bytesTotal,
    finished,
    // it is preferable to call the stream's cancel method, but the worker
    // might have locked and terminating the worker would not help
    // https://github.com/whatwg/streams/issues/1256
    cancel: () => {
      cancelled = true
    },
  }
}

