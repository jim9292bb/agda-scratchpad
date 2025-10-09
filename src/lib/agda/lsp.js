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

/** @implements {Transformer<Uint8Array, string>} */
export class LSPMessageDecoder {
  constructor() {
    this.buffer = new Uint8Array
    this.pending = -1
    this.decoder = new TextDecoder
  }

  findBoundary() {
    for (let idx = 0; idx <= this.buffer.length - 4; idx++) {
      idx = this.buffer.indexOf(13, idx)
      if (idx < 0) break
      if (this.buffer[idx + 1] == 10 &&
          this.buffer[idx + 2] == 13 &&
          this.buffer[idx + 3] == 10) {
        return idx
      }
    }
    return -1
  }

  /**
   * @param {Uint8Array} chunk
   * @param {TransformStreamDefaultController<string>} controller
   */
  async transform(chunk, controller) {
    this.buffer = concatUint8Arrays(this.buffer, chunk)
    while (true) {
      if (this.pending == -1) {
        // header phase; this is accidentally conforming to use "ascii" encoding
        const brk = this.findBoundary()
        if (brk < 0) break
        const header = String.fromCharCode(...this.buffer.subarray(0, brk))
        const matched = header.match(/^content-length:\s*(\d+)/i)
        if (!matched) throw new Error(`failed to parse header: ${JSON.stringify(header)}`)
        this.pending = Number.parseInt(matched[1], 10)
        this.buffer = this.buffer.subarray(brk + 4)
      } else if (this.pending <= this.buffer.byteLength) {
        const p = this.pending
        // content phase; decode with UTF-8
        controller.enqueue(this.decoder.decode(this.buffer.subarray(0, p)))
        this.buffer = this.buffer.subarray(p)
        this.pending = -1
      } else {
        break
      }
    }
  }

  flush() {
    const { buffer, decoder } = this
    if (buffer.byteLength) {
      throw new Error(`trailing data in the buffer: ${JSON.stringify(decoder.decode(buffer))}`)
    }
  }
}
