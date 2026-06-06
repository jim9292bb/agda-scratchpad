import { SPSCError } from 'spsc'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function fread(reader, len) {
  let nread = 0
  let buf
  if (len <= 0) return new Uint8Array()
  while (nread < len) {
    const rr = reader.read(len - nread)
    if (!rr.ok) throw new Error(`read failed: ${rr.error}`)
    if (buf === undefined) {
      if (rr.bytesRead === len) return rr.data
      buf = new Uint8Array(len)
    }
    buf.set(rr.data, nread)
    nread += rr.bytesRead
  }
  return buf
}

export function fwrite(writer, data) {
  while (data.length) {
    const wr = writer.write(data)
    if (!wr.ok) throw new Error(`write failed: ${wr.error}`)
    data = data.subarray(wr.bytesWritten)
  }
}

export async function readAvailable(reader, maxBytes = 64 * 1024) {
  const rr = reader.read(maxBytes, { nonblock: true })
  if (rr.ok) return rr.data
  if (rr.error === SPSCError.Again) return null
  throw new Error(`read failed: ${rr.error}`)
}

export async function freadAsync(reader, len, waitMs = 5) {
  let nread = 0
  const data = new Uint8Array(len)
  while (nread < len) {
    const rr = reader.read(len - nread, { nonblock: true })
    if (rr.ok) {
      data.set(rr.data, nread)
      nread += rr.bytesRead
      continue
    }
    if (rr.error !== SPSCError.Again) throw new Error(`read failed: ${rr.error}`)
    await new Promise(resolve => setTimeout(resolve, waitMs))
  }
  return data
}

export function makeBufUint32LE(n) {
  return new Uint8Array(new Uint32Array([n]).buffer)
}

export function bufGetUint32LE(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  return view.getUint32(0, true)
}

export function writeLenPrefixed(writer, payload) {
  fwrite(writer, makeBufUint32LE(payload.byteLength))
  fwrite(writer, payload)
}

export async function readLenPrefixedAsync(reader) {
  const lenBuf = await freadAsync(reader, 4)
  return freadAsync(reader, bufGetUint32LE(lenBuf))
}

export function writeJsonMessage(writer, type, payload) {
  fwrite(writer, makeBufUint32LE(type))
  writeLenPrefixed(writer, encoder.encode(JSON.stringify(payload)))
}

export async function readJsonResponse(reader) {
  const payload = await readLenPrefixedAsync(reader)
  return JSON.parse(decoder.decode(payload))
}

export function uint8ArrayToBase64(buf) {
  return Buffer.from(buf).toString('base64')
}

export function base64ToUint8Array(base64) {
  return new Uint8Array(Buffer.from(base64, 'base64'))
}
