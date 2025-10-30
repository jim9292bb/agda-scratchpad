/** @import { SPSCReader } from 'spsc/reader' */
/** @import { SPSCWriter } from 'spsc/writer' */
/** @import { ALSWorkerInitObject, ALSWorkerInitResultProxied } from '$lib/worker/types' */
import { SPSCError } from 'spsc'
import * as Comlink from 'comlink'
import { freadAsync, fwriteAsync, makeBufUint32LE, writeLenPrefixedAsync } from './stdlib'

function browserSupportBYOBReadable() {
  try {
    // feature detection
    new ReadableStream({ type: 'bytes' })
    return true
  } catch { return false }
}

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

  if (!browserSupportBYOBReadable()) {
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
        const rr = reader.read(view.byteLength, { nonblock: true })
        if (!rr.ok) {
          if (rr.error === SPSCError.Again) {
            await new Promise(resolve => pendingRead = resolve)
            continue
          }
          throw new Error('read failed')
        }
        if (rr.bytesRead) {
          const sz = Math.min(view.byteLength, rr.bytesRead)
          view.set(rr.data.subarray(0, sz))
          controller.byobRequest.respond(sz)
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
 * @param {any} initialMessage
 * @returns {Promise<{ worker: Worker, event: MessageEvent }>} */
export function makeDriveHostWorker(initialMessage) {
  const worker = new Worker(
    new URL('$lib/worker/drive.js?worker&inline', import.meta.url), {
      name: 'Runno drive host',
      type: 'module',
    })

  return new Promise((_res, _rej) => {
    let done = false
    const res = (/** @type {MessageEvent} */ evt) => !done && (cleanup(), _res({ worker, event: evt }))
    const rej = (/** @type {unknown} */ err) => !done && (cleanup(), _rej(err))
    function cleanup() {
      done = true
      worker.removeEventListener('message', res)
      worker.removeEventListener('error', rej)
    }
    worker.addEventListener('message', res)
    worker.addEventListener('error', rej)

    // FIXME
    /** @type {Transferable[]} */
    const transferables = [initialMessage.agdaDataZip, initialMessage.agdaStdlibZip].filter(Boolean)

    worker.postMessage(initialMessage, transferables)
  })
}

/**
 * @param {ALSWorkerInitObject} initObject
 * @param {(worker: Worker) => void} workerPreCallback
 */
export function makeLspWorker(initObject, workerPreCallback) {
  const worker = new Worker(
    new URL('$lib/worker/als.js?worker&inline', import.meta.url),
    { name: 'ALS LSP Worker', type: 'module' })

  /**
   * @type {Comlink.Remote<{
   *          init: (initObj: ALSWorkerInitObject) =>
   *            ALSWorkerInitResultProxied}>} */
  const endpoint = Comlink.wrap(worker)
  workerPreCallback?.(worker)

  const { wasmSource, stdinWaker } = initObject

  const initPromise = endpoint.init(Comlink.transfer(initObject, [
    ...(wasmSource.type === 'stream' ? [wasmSource.stream] : []),
    stdinWaker,
  ]))

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

/**
 * @param {Int32Array<SharedArrayBuffer>} lock
 * @param {() => Promise<unknown>} callback */
export async function withDriveLock(lock, callback) {
  while (Atomics.compareExchange(lock, 0, 0, 1) !== 0) {
    console.warn('drive is busy, retrying later...')
    await new Promise(r => setTimeout(r, 100))
  }

  await callback()

  if (Atomics.compareExchange(lock, 0, 1, 0) !== 1) {
    throw new Error('mutex content corrupted')
  }

  Atomics.notify(lock, 0, 1)
}

const encoder = new TextEncoder()

/**
 * @param {import('./controller.svelte').DriveHandle} _
 * @param {string} doc */
export function writeSourceFileToDrive({lock, stdinWriter, stdoutReader}, doc) {
  return withDriveLock(lock, async () => {
    // FIXME: we should invoke Runno internal calls directly
    await fwriteAsync(stdinWriter, makeBufUint32LE(1))
    await writeLenPrefixedAsync(stdinWriter, encoder.encode(doc))
    await freadAsync(stdoutReader, 1)
  })
}
