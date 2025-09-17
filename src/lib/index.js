/** @import { SPSCReader } from 'spsc/reader' */
/** @import { SPSCWriter } from 'spsc/writer' */
import { SPSCError } from 'spsc'

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

  // TODO: polyfill for Safari
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
          break
        } else {
          console.log('process ends')
          controller.close()
        }
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

/** @returns {TransformStream<Uint8Array, string>} */
export function makeChunkifyStream() {
  const decoder = new TextDecoder()
  let buffer = new Uint8Array()
  let pending = -1

  function findBoundary() {
    for (let idx = 0; idx <= buffer.length - 4; idx++) {
      idx = buffer.indexOf(13, idx)
      if (idx < 0) break
      if (buffer[idx + 1] == 10 &&
          buffer[idx + 2] == 13 &&
          buffer[idx + 3] == 10) {
        return idx
      }
    }
    return -1
  }

  /**
   * @param {Uint8Array} a
   * @param {Uint8Array} b
   */
  function concatUint8Arrays(a, b) {
    const result = new Uint8Array(a.byteLength + b.byteLength)
    result.set(a)
    result.set(b, a.byteLength)
    return result
  }

  return new TransformStream({
    async transform(chunk, controller) {
      buffer = concatUint8Arrays(buffer, chunk)
      while (true) {
        if (pending == -1) {
          // header phase; this is accidentally conforming to use "ascii" encoding
          const brk = findBoundary()
          if (brk < 0) break
          const header = String.fromCharCode(...buffer.subarray(0, brk))
          const matched = header.match(/^content-length:\s*(\d+)/i)
          if (!matched) throw new Error(`failed to parse header: ${JSON.stringify(header)}`)
          pending = Number.parseInt(matched[1], 10)
          buffer = buffer.subarray(brk + 4)
        } else if (pending <= buffer.byteLength) {
          // content phase; decode with UTF-8
          controller.enqueue(decoder.decode(buffer.subarray(0, pending)))
          buffer = buffer.subarray(pending)
          pending = -1
        } else {
          break
        }
      }
    },
    flush() {
      if (buffer.byteLength) {
        throw new Error(`trailing data in the buffer: ${JSON.stringify(decoder.decode(buffer))}`)
      }
    }
  })
}
