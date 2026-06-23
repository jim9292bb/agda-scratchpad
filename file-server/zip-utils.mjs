/**
 * Minimal ZIP extraction/creation using only Node built-ins (no external
 * dependency). `extractZip` reads the central directory, decompresses each
 * entry with DecompressionStream, and writes it to destDir, preserving the
 * directory structure. `zipDirectory` writes a STORED-only (uncompressed)
 * ZIP from a directory tree — used by scripts/setup-assets.sh to produce
 * the zips the browser runtime fetches, from a deployer-placed raw
 * directory. STORED is fine here: this is a local build step, not a
 * download, so size doesn't matter the way it does for fetched assets.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

async function collectFiles(dir, exclude, base, result = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    const topLevel = relative(base, p).split(sep)[0]
    if (exclude.includes(topLevel)) continue
    if (entry.isDirectory()) await collectFiles(p, exclude, base, result)
    else result.push(p)
  }
  return result
}

/**
 * Writes a STORED-only ZIP at destZip containing every file under srcDir,
 * skipping any top-level child named in `exclude`. `prefix`, if given,
 * wraps every entry under `<prefix>/...` — used to reproduce the wrapper
 * folder a GitHub tag-archive zip would have had, so the browser's
 * existing unzip-and-strip-prefix logic needs no changes.
 */
export async function zipDirectory(srcDir, destZip, { prefix = '', exclude = [] } = {}) {
  const files = await collectFiles(srcDir, exclude, srcDir)
  const chunks = []
  const entries = []
  let offset = 0

  for (const filePath of files) {
    const rel = relative(srcDir, filePath).split(sep).join('/')
    const name = prefix ? `${prefix}/${rel}` : rel
    const data = await readFile(filePath)
    const crc = crc32(data)
    const nameBytes = Buffer.from(name, 'utf8')

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)

    chunks.push(local, nameBytes, data)
    entries.push({ name: nameBytes, crc, size: data.length, offset })
    offset += local.length + nameBytes.length + data.length
  }

  const cdStart = offset
  for (const e of entries) {
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(e.crc, 16)
    central.writeUInt32LE(e.size, 20)
    central.writeUInt32LE(e.size, 24)
    central.writeUInt16LE(e.name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(e.offset, 42)

    chunks.push(central, e.name)
    offset += central.length + e.name.length
  }
  const cdSize = offset - cdStart

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdSize, 12)
  eocd.writeUInt32LE(cdStart, 16)
  eocd.writeUInt16LE(0, 20)
  chunks.push(eocd)

  await mkdir(join(destZip, '..'), { recursive: true })
  await writeFile(destZip, Buffer.concat(chunks))
  return entries.length
}

export async function extractZip(zipPath, destDir) {
  const buf = await readFile(zipPath)
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const dec = new TextDecoder()

  // Find EOCD (End of Central Directory)
  let eocdOffset = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break }
  }
  if (eocdOffset < 0) throw new Error(`ZIP EOCD not found in ${zipPath}`)

  const cdOffset = view.getUint32(eocdOffset + 16, true)
  const cdSize   = view.getUint32(eocdOffset + 12, true)

  const tasks = []
  let pos = cdOffset
  let count = 0

  while (pos < cdOffset + cdSize) {
    if (view.getUint32(pos, true) !== 0x02014b50) break

    const method      = view.getUint16(pos + 10, true)
    const compSize    = view.getUint32(pos + 20, true)
    const fnLen       = view.getUint16(pos + 28, true)
    const extraLen    = view.getUint16(pos + 30, true)
    const commentLen  = view.getUint16(pos + 32, true)
    const localOffset = view.getUint32(pos + 42, true)
    const name        = dec.decode(bytes.subarray(pos + 46, pos + 46 + fnLen))
    pos += 46 + fnLen + extraLen + commentLen

    if (name.endsWith('/')) continue

    const lOff = localOffset, cSize = compSize, meth = method
    const outPath = join(destDir, name)

    tasks.push((async () => {
      const localFnLen    = view.getUint16(lOff + 26, true)
      const localExtraLen = view.getUint16(lOff + 28, true)
      const dataStart     = lOff + 30 + localFnLen + localExtraLen
      const compData      = bytes.subarray(dataStart, dataStart + cSize)

      let content
      if (meth === 0) {
        content = compData.slice()
      } else {
        const ds = new DecompressionStream('deflate-raw')
        const writer = ds.writable.getWriter()
        const reader = ds.readable.getReader()
        writer.write(compData)
        writer.close()
        const chunks = []
        let total = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          total += value.byteLength
        }
        content = new Uint8Array(total)
        let off = 0
        for (const c of chunks) { content.set(c, off); off += c.byteLength }
      }

      await mkdir(join(outPath, '..'), { recursive: true })
      await writeFile(outPath, content)
    })())
    count++
  }

  await Promise.all(tasks)
  return count
}
