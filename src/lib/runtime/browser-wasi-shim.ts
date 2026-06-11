import { SPSC } from 'spsc'
import { SPSCWriter } from 'spsc/writer'
import { SPSCReader } from 'spsc/reader'
import { asset } from '$app/paths'

import {
  makeWasiShimLspWorker,
  traceFetchProgress,
} from '$lib'
import { fetchWASMAndData, type SupportedAgdaVersion } from './interface'
import { createPerformanceTrace } from '$lib/performance.js'
import type { ALSWorkerInitResultProxied } from '$lib/worker/types'
import type { BackendInitOptions, DriveHandle, LSPStreams, RuntimeBackend } from './interface'
import type { DriveProxyStats, WASMLoadingProgress } from '$lib/worker/types'

const SOURCE_SAB_CAPACITY = 4 * 1024 * 1024  // 4 MB

const emptyDriveProxyStats: DriveProxyStats = {
  totalCalls: 0,
  totalDurationMs: 0,
  bytesRead: 0,
  bytesWritten: 0,
  methods: {},
  methodDurationsMs: {},
  pathStatPaths: {},
  openPaths: {},
  uniquePathStatPaths: 0,
  pathStatSuccesses: 0,
  pathStatFailures: 0,
  agda: { pathStat: 0, open: 0, read: 0, write: 0 },
  agdai: { pathStat: 0, open: 0, read: 0, write: 0 },
}

const isSafari = /Apple Computer/.test((navigator as any).vendor)

export class BrowserWasiShimRuntimeBackend implements RuntimeBackend {
  private readonly _agdaBuffers: { stdin: SharedArrayBuffer; stdout: SharedArrayBuffer }
  private readonly _agdaVersion: SupportedAgdaVersion

  private readonly _agdaStdinWriter: SPSCWriter
  private readonly _agdaStdoutReader: SPSCReader
  private readonly _sourceSab: SharedArrayBuffer

  _lspWorker: Worker | undefined
  private _workerInitData: ALSWorkerInitResultProxied | undefined
  private _wasmLoadingProgress: WASMLoadingProgress | null = null

  constructor(
    agdaBuffers: { stdin: SharedArrayBuffer; stdout: SharedArrayBuffer },
    _driveBuffers: { lock: SharedArrayBuffer; stdin: SharedArrayBuffer; stdout: SharedArrayBuffer },
    agdaVersion: SupportedAgdaVersion,
  ) {
    this._agdaBuffers = agdaBuffers
    this._agdaVersion = agdaVersion

    this._agdaStdinWriter = new SPSCWriter(agdaBuffers.stdin)
    this._agdaStdoutReader = new SPSCReader(agdaBuffers.stdout)
    this._sourceSab = new SharedArrayBuffer(SOURCE_SAB_CAPACITY)
  }

  getLSPStreams(): LSPStreams {
    return { stdinWriter: this._agdaStdinWriter, stdoutReader: this._agdaStdoutReader }
  }

  getDriveHandle(): DriveHandle {
    // not used by this backend; return a stub
    return {
      lock: new Int32Array(new SharedArrayBuffer(4), 0, 1),
      stdinWriter: new SPSCWriter(new SharedArrayBuffer(SPSC.allocateArrayBuffer(4096).byteLength)),
      stdoutReader: new SPSCReader(new SharedArrayBuffer(SPSC.allocateArrayBuffer(4096).byteLength)),
    }
  }

  isInitialized(): boolean {
    return !!this._workerInitData && !!this._lspWorker
  }

  resetBuffers(): void {
    SPSC.resetArrayBuffer(this._agdaBuffers.stdin)
    SPSC.resetArrayBuffer(this._agdaBuffers.stdout)
  }

  async init(options: BackendInitOptions): Promise<MessagePort> {
    const { agdaVersion, callbacks } = options
    const trace = createPerformanceTrace()

    const wasmAndData = await trace.measure(
      'Fetch ALS WASM response',
      () => fetchWASMAndData(agdaVersion),
      { agdaVersion },
    )

    const progressCtx = traceFetchProgress(wasmAndData.wasm, (loaded) => {
      this._wasmLoadingProgress!.bytesLoaded = loaded
    })

    if (isSafari) {
      this._wasmLoadingProgress = {
        ...progressCtx,
        source: { type: 'url', url: 'fakeurl' },
        bytesLoaded: 0,
      }
      callbacks.onWASMLoadingProgressChange(this._wasmLoadingProgress)

      const resp = new Response(progressCtx.source.stream, { headers: { 'Content-Type': 'application/wasm' } })
      const blob = await resp.blob()
      this._wasmLoadingProgress = {
        source: { type: 'url', url: URL.createObjectURL(blob) },
        bytesLoaded: blob.size,
        bytesTotal: blob.size,
        finished: Promise.resolve(),
      }
      callbacks.onWASMLoadingProgressChange(this._wasmLoadingProgress)
    } else {
      this._wasmLoadingProgress = { ...progressCtx, bytesLoaded: 0 }
      callbacks.onWASMLoadingProgressChange(this._wasmLoadingProgress)
    }

    this._wasmLoadingProgress.finished.then(() => callbacks.onWASMLoaded())

    const wakerChannel = new MessageChannel()

    const [dataZipData, stdlibData, cubicalData] = await Promise.all([
      wasmAndData.dataFile
        ? trace.measure('Read Agda builtins data', () => wasmAndData.dataFile!.arrayBuffer())
        : Promise.resolve(undefined),
      trace.measure('Fetch standard-library zip', () =>
        fetch(asset('/agda-stdlib-2.3.zip')).then(x => x.arrayBuffer())),
      trace.measure('Fetch Cubical zip', () =>
        fetch(asset('/agda-cubical-0.9.zip')).then(x => x.arrayBuffer())),
    ])

    const { initPromise } = makeWasiShimLspWorker({
      wasmSource: { ...this._wasmLoadingProgress.source },
      stdinWaker: wakerChannel.port2,
      stdin: this._agdaBuffers.stdin,
      stdout: this._agdaBuffers.stdout,
      sourceSab: this._sourceSab,
      stdlibZip: stdlibData,
      cubicalZip: cubicalData,
      dataZip: dataZipData,
      agdaVersion,
    }, worker => {
      this._lspWorker = worker
      worker.addEventListener('error', (evt) => {
        console.error('[wasi-shim worker error]', evt)
      })
    })

    this._workerInitData = await trace.measure('Initialize WASI shim worker', () => initPromise)

    await trace.measure('Read ALS version', () =>
      this._workerInitData!.getALSVersion().then(ver => callbacks.onVersionReceived(ver)))

    if (this._wasmLoadingProgress.source.type === 'url' &&
        this._wasmLoadingProgress.source.url.startsWith('blob:')) {
      URL.revokeObjectURL(this._wasmLoadingProgress.source.url)
    }

    callbacks.onDriveCreated()
    callbacks.onPerformanceEntries(trace.entries)

    return wakerChannel.port1
  }

  run(): Promise<number> {
    return this._workerInitData!.start()
  }

  async syncSourceFile(doc: string): Promise<void> {
    const encoded = new TextEncoder().encode(doc)
    if (encoded.byteLength + 4 > SOURCE_SAB_CAPACITY) {
      throw new Error(`Source file too large for sourceSab: ${encoded.byteLength} bytes`)
    }
    const header = new Int32Array(this._sourceSab, 0, 1)
    const body = new Uint8Array(this._sourceSab, 4, encoded.byteLength)
    body.set(encoded)
    Atomics.store(header, 0, encoded.byteLength)
  }

  async resetDriveProxyStats(): Promise<void> {
    // no-op: this backend has no drive proxy
  }

  async getDriveProxyStats(): Promise<DriveProxyStats> {
    return { ...emptyDriveProxyStats }
  }

  terminate(): void {
    this._wasmLoadingProgress?.cancel?.()
    this._wasmLoadingProgress = null

    this._lspWorker?.terminate()
    this._lspWorker = undefined
    this._workerInitData = undefined
  }
}
