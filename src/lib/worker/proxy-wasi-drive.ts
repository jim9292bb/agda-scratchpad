import { SPSCReader } from 'spsc/reader'
import { SPSCWriter } from 'spsc/writer'
import { bufGetUint32LE, fread, writeLenPrefixed } from '$lib/stdlib'
import type { WASIFile } from '@runno/wasi'

interface RunnoDriveProps {
  nextFD: number
  openMap: Map<number, unknown>
}

export type RunnoDrive = RunnoDriveProps & {
  [k in typeof driveMethods[number]]: (...args: any[]) => any
}

// NOTE: non-JSON-serializable input/outputs are marked by asterisks (*)
// R<T> = [number - SUCCESS] | [SUCCESS, T]
// WASITimestamps = { a, m, c: Date }  <-- ***
// DE = { name: string; type: number }
// DS = {
//   path: string;
//   byteLength: number;
//   timestamps: WASITimestamps;  <-- ***
//   type: FileType = number;
// }

export const driveMethods = [
  'open',      // (number, string, number, number) -> R<number>
  'close',     // (number) -> number
  'read',      // *O* (number, number) -> R<Uint8Array>
  'pread',     // *O* (number, number, number) -> R<Uint8Array>
  'write',     // *I* (number, Uint8Array) -> number
  'pwrite',    // *I* (number, Uint8Array, number) -> number
  'sync',      // (number) -> number
  'seek',      // *I/O* (number, bigint, number) -> R<bigint>
  'tell',      // *I/O* (number, bigint, number) -> R<bigint>
  'renumber',  // (number, number) -> number
  'unlink',    // (number, string) -> number
  'rename',    // (number, string, number, string) -> number
  'list',      // (number) -> R<DE[]>
  'stat',      // *O* (number) -> R<DS>
  'pathStat',  // *O* (number, string) -> R<DS>
  'setFlags',  // (number, number) -> number
  'setSize',   // *I* (number, bigint) -> number
  'setAccessTime',            // *I* (number, Date) -> number
  'setModificationTime',      // *I* (number, Date) -> number
  'pathSetAccessTime',        // *I* (number, string, Date) -> number
  'pathSetModificationTime',  // *I* (number, string, Date) -> number
  'pathCreateDir',  // (number, string) -> number
  'exists',         // (number) -> boolean
  'fileType',       // (number) -> number
  'fileFdflags',    // (number) -> number
] as const

function fixStatCommon(result: [number] | [number, WASIFile]): typeof result {
  if (result.length > 1) {
    const file = result[1]!
    file.timestamps.access = new Date(file.timestamps.access)
    file.timestamps.change = new Date(file.timestamps.change)
    file.timestamps.modification = new Date(file.timestamps.modification)
  }
  return result
}

// TODO: properly ser/deser all methods
export function proxyWASIDrive(drive: RunnoDrive, stdin: SharedArrayBuffer, stdout: SharedArrayBuffer) {
  const reader = new SPSCReader(stdin)
  const writer = new SPSCWriter(stdout)
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  for (const method of driveMethods) {
    drive[method] = (...args) => {
      if (method === 'setSize') {
        args[1] = args[1].toString()
      }
      writeLenPrefixed(writer, encoder.encode(JSON.stringify({ method, args })))
      const buf = fread(reader, 4)
      const payloadLength = bufGetUint32LE(buf)
      const recved = fread(reader, payloadLength)
      let data = JSON.parse(decoder.decode(recved))
      if (method === 'pathStat' || method === 'stat') {
        data = fixStatCommon(data)
      } else if (method === 'read' || method === 'pread') {
        if (data[1]) {
          // FIXME: this is dumb
          data[1] = new Uint8Array(data[1])
        }
      }
      return data
    }
  }
}
