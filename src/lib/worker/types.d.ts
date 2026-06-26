export type WASMSource =
  | { type: 'stream', stream: ReadableStream<Uint8Array> }
  | { type: 'url', url: string }

/** A library to extract into the WASI shim VFS at startup. See
 *  ResolvedLibrary in src/lib/runtime/interface.ts, which the main thread
 *  resolves a deploy.config.mjs profile's libraries into before fetching
 *  each one's zip and constructing this. */
export interface LibraryToLoad {
  /** folder to extract this library under in the VFS, e.g. "stdlib" */
  folderName: string
  zip: ArrayBuffer
  agdaiZip?: ArrayBuffer
  archiveRootPrefix: string
  includeSubpath: string
  agdaLibFile: string
  libraryName: string
}

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
  getNumericAgdaVersion: () => Promise<string>
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
  uniquePathStatPaths: number
  pathStatSuccesses: number
  pathStatFailures: number
  agda: DriveProxyExtensionStats
  agdai: DriveProxyExtensionStats
}

export type DriveWorkerReadyMessage =
  | 'fs-ready'
  | {
      type: 'fs-ready'
      performanceEntries: PerformanceEntry[]
    }
