export type WASMSource =
  | { type: 'stream', stream: ReadableStream<Uint8Array> }
  | { type: 'url', url: string }

export interface WASMLoadingProgress {
  source: WASMSource
  bytesLoaded: number
  bytesTotal: number
  finished: Promise<void>
}

export interface ALSWorkerInitObject {
  wasmSource: WASMSource
  args?: string[]
  stdinWaker: MessagePort
  stdin: SharedArrayBuffer
  stdout: SharedArrayBuffer

  driveBuffers: {
    lock: SharedArrayBuffer
    stdin: SharedArrayBuffer
    stdout: SharedArrayBuffer
  }
}

export interface ALSWorkerInitResultProxied {
  getALSVersion: () => Promise<string>
  start: () => Promise<number>
}

export interface DriveWorkerInitObject {
  stdin: SharedArrayBuffer
  stdout: SharedArrayBuffer
  agdaDataZip: Uint8Array
}
