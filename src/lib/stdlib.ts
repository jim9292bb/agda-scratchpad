import type { SPSCReader } from 'spsc/reader'
import type { SPSCWriter } from 'spsc/writer'

export function fread(reader: SPSCReader, len: number): Uint8Array {
  let nread = 0
  let buf: undefined | Uint8Array

  if (len <= 0) return new Uint8Array()
  while (nread < len) {
    const rr = reader.read(len - nread)
    if (!rr.ok) {
      throw new Error('read failed')
    }
    if (buf === undefined) {
      if (rr.bytesRead === len) {
        // fast path: the buffer is fulfilled at once
        return rr.data
      }
      buf = new Uint8Array(len)
    }
    buf.set(rr.data, nread)
    nread += rr.bytesRead
  }
  return buf!
}

export function fwrite(writer: SPSCWriter, data: Uint8Array) {
  let nwritten = 0
  while (nwritten < data.length) {
    const wr = writer.write(data)
    if (!wr.ok) {
      throw new Error('write failed')
    }
    nwritten += wr.bytesWritten
  }
}

export function bufGetUint32LE(buf: Uint8Array) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  return view.getUint32(0, true)
}

export function writeLenPrefixed(writer: SPSCWriter, payload: Uint8Array) {
  const lenBuf = new Uint32Array([payload.byteLength])
  fwrite(writer, new Uint8Array(lenBuf.buffer))
  fwrite(writer, payload)
}
