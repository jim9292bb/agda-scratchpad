import * as Runno from '@runno/wasi'
import { SPSCReader } from 'spsc/reader'
import { SPSCWriter } from 'spsc/writer'
import JSZip from 'jszip'
import { fread, bufGetUint32LE, writeLenPrefixed, fwrite } from '$lib/stdlib'

import { uint8ArrayToBase64, base64ToUint8Array } from './util-base64'
import type { DriveWorkerInitObject } from './types'

const now = new Date()

function createFileEntry(path: string, content: string | Uint8Array) {
  const obj = {
    path,
    timestamps: {
      access: now,
      change: now,
      modification: now,
    },
    mode: typeof content === 'string' ? 'string' : 'binary' as any,
    content,
  } as Runno.WASIFile
  return [path, obj] as const
}

const { stdin, stdout, agdaDataZip } = await new Promise<DriveWorkerInitObject>(r => {
  addEventListener('message', event => {
    r(event.data)
  }, { once: true })
})

// TODO: make this changable dynamically
const userSourceFilePath = '/source.agda'

const fs: Record<string, Runno.WASIFile> = Object.fromEntries([
  createFileEntry(userSourceFilePath, ''),
])

const zip = await JSZip.loadAsync(agdaDataZip)

const filePromises: Promise<void>[] = []

zip.forEach((path, file) => {
  if (file.dir) return
  filePromises.push(file.async('uint8array').then(content => {
    const [key, obj] = createFileEntry(`/${path}`, content)
    fs[key] = obj
  }))
})

await Promise.all(filePromises)

postMessage('fs-ready')

const wasi = new Runno.WASI({ fs })
const drive = wasi.drive

const reader = new SPSCReader(stdin)
const writer = new SPSCWriter(stdout)

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function mainLoop() {
  const driveProxy = drive as unknown as {[k: string]: (...args: any[]) => any}
  while (true) {
    const typeBuf = fread(reader, 4)
    const msgType = bufGetUint32LE(typeBuf)

    if (msgType === 1) {
      const lenBuf = fread(reader, 4)
      const data = fread(reader, bufGetUint32LE(lenBuf))
      drive.fs[userSourceFilePath].mode = 'binary'
      drive.fs[userSourceFilePath].content = data
      fwrite(writer, new Uint8Array([0]))
      continue
    } else if (msgType === 2) {
      console.warn('DUMP FS', drive.fs)
      fwrite(writer, new Uint8Array([0]))
      continue
    } else if (msgType !== 0) {
      throw new Error('Invalid msg type ' + msgType)
    }

    const lenBuf = fread(reader, 4)
    const data = fread(reader, bufGetUint32LE(lenBuf))
    const req: { method: string; args: any[] } = JSON.parse(decoder.decode(data))

    if (req.method === 'write') {
      req.args[1] = base64ToUint8Array(req.args[1])
    }
    // console.warn('DRIVE <--', req)
    let res = driveProxy[req.method](...req.args)
    // console.warn('DRIVE -->', res)
    if (req.method === 'read') {
      res[1] = uint8ArrayToBase64(res[1])
    }
    writeLenPrefixed(writer, encoder.encode(JSON.stringify(res)))
  }
}

mainLoop()
