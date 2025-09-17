/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import * as Comlink from 'comlink'
import * as Runno from '@runno/wasi'

import { SPSCError } from 'spsc'
import { SPSCReader } from 'spsc/reader'
import { SPSCWriter } from 'spsc/writer'
import { patchImportObject } from './patch-wasi'
import { proxyWASIDrive } from './proxy-wasi-drive'

type MyStdioDef = {
  stdin: (len: number) => Uint8Array | null
  stdout: (out: Uint8Array) => void
  stderr: (err: Uint8Array) => void
}

type PatchedRunnoWASIContextOptions = Partial<
  Omit<Runno.WASIContextOptions, 'stdin' | 'stdout' | 'stderr'> & MyStdioDef
>

export {}

if (!crossOriginIsolated) {
  throw new Error('The worker should be run in a COI context.')
}

const { WASI } = Runno

let stderrBuf = ''
const stderrDecoder = new TextDecoder()

/**
 * @param {PatchedRunnoWASIContextOptions} opt
 * @returns {Runno.WASIContextOptions} */
function definePatchedRunnoWASIContextOptions(
  opt: PatchedRunnoWASIContextOptions): Runno.WASIContextOptions {
  return opt as any
}

async function init({ port: stdinWakerPort, stdinSab, stdoutSab, driveHostInSab, driveHostOutSab }: {
  port: MessagePort,
  stdinSab: SharedArrayBuffer,
  stdoutSab: SharedArrayBuffer,
  driveHostInSab: SharedArrayBuffer,
  driveHostOutSab: SharedArrayBuffer,
}) {
  console.log('Loading wasm...')

  const stdinReader = new SPSCReader(stdinSab)
  const stdoutWriter = new SPSCWriter(stdoutSab, stdinWakerPort)

  const wasi = new WASI(definePatchedRunnoWASIContextOptions({
    args: ['als', '+RTS', '-V1'],
    env: {
      'HOME': '/home/root',
      'Agda_datadir': '/',
    },
    debug: (name, args_, ret, _data) => {
      const args = args_ as any[]
      // hide the warn failing to set stdin to nonblocking mode
      if (name === 'fd_fdstat_set_flags' && args[0] === 0 && args[1] === 4) {
        return 0  // success
      }
      // workaround a bug where mkdir's error code is wrong
      if (name === 'path_open' && ret === 76) {
        return 2  // EPERM
      }
      if (name === 'path_create_directory' && ret === 76) {
        return 20  // EEXIST
      }
      return ret
    },
    stdin(len) {
      const result = stdinReader.read(len, { nonblock: true })
      if (!result.ok) {
        if (result.error == SPSCError.Again) {
          return null
        }
        throw new Error('Read from stdin failed')
      }

      return result.data
    },
    stdout(buf) {
      const result = stdoutWriter.write(buf)
      if (!result.ok) {
        throw new Error('Write to stdout failed')
      }
    },
    stderr(buf) {
      let str = stderrDecoder.decode(buf, { stream: true })
      let nl
      while (nl = str.indexOf('\n'), nl >= 0) {
        console.warn('>>> ' + stderrBuf + str.slice(0, nl))
        stderrBuf = ''
        str = str.slice(nl + 1)
      }
      stderrBuf += str
    },
  }))

  const importObject = patchImportObject(wasi, timeout => {
    let waitDuration = timeout < 0 ? Infinity : Math.max(timeout - Date.now(), 0)
    return stdinReader.pollRead(waitDuration)
  })

  const wasm = await WebAssembly.instantiateStreaming(fetch('/als-demo/als.wasm'), importObject)
  function start() {
    proxyWASIDrive(wasi.drive, driveHostInSab, driveHostOutSab)
    const execResult = wasi.start(wasm)
    console.log('exec end', execResult)
    return execResult
  }

  return Comlink.proxy({ start })
}

Comlink.expose({
  init,
})
