/**
 * Minimal ZIP extraction using only Node built-ins (no external dependency).
 * Reads the central directory, decompresses each entry with DecompressionStream,
 * and writes it to destDir, preserving the directory structure.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

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
