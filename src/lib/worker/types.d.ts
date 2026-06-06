export type WASMSource =
  | { type: 'stream', stream: ReadableStream<Uint8Array> }
  | { type: 'url', url: string }

export interface WASMLoadingProgress {
  source: WASMSource
  bytesLoaded: number
  bytesTotal: number
  finished: Promise<void>
  cancel?: () => void
}

export interface ALSWorkerInitObject {
  wasmSource: WASMSource
  args?: string[]
  stdinWaker: MessagePort
  stdin: SharedArrayBuffer
  stdout: SharedArrayBuffer

  driveBuffers: DriveBuffers
}

export interface DriveBuffers {
  lock: SharedArrayBuffer
  stdin: SharedArrayBuffer
  stdout: SharedArrayBuffer
}

interface _WASISpawnOptions {
  ignoreExitCode?: boolean
  drive?: DriveBuffers
  env: Record<string, string>
}

export interface WASISpawnOptions extends Partial<_WASISpawnOptions> {}

export interface ALSWorkerInitResultProxied {
  getALSVersion: () => Promise<string>
  start: () => Promise<number>
  spawn: (args: string[], options?: WASISpawnOptions) =>
    Promise<{exitCode: number, stdout: string, stderr: string}>
}

export interface DriveWorkerInitObject {
  stdin: SharedArrayBuffer
  stdout: SharedArrayBuffer
  agdaDataZip: ArrayBuffer | null
  agdaStdlibZip: ArrayBuffer | null
  agdaCubicalZip: ArrayBuffer | null
}

export interface PerformanceEntry {
  label: string
  durationMs: number
  detail?: Record<string, unknown>
  failed?: boolean
}

export interface DriveProxyPathStats {
  count: number
  durationMs: number
}

export interface DriveProxyExtensionStats {
  pathStat: number
  open: number
  read: number
  write: number
}

export interface DriveProxyStats {
  totalCalls: number
  totalDurationMs: number
  bytesRead: number
  bytesWritten: number
  methods: Record<string, number>
  methodDurationsMs: Record<string, number>
  pathStatPaths: Record<string, DriveProxyPathStats>
  openPaths: Record<string, DriveProxyPathStats>
  agda: DriveProxyExtensionStats
  agdai: DriveProxyExtensionStats
}

export type DriveWorkerReadyMessage =
  | 'fs-ready'
  | {
      type: 'fs-ready'
      performanceEntries: PerformanceEntry[]
    }
