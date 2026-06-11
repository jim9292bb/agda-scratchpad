import { SPSC } from 'spsc'
import { SPSCReader } from 'spsc/reader'
import { SPSCWriter } from 'spsc/writer'

import { asset } from '$app/paths'
import {
  createReadableByteStream,
  createWritableByteStream,
  getAndResetDriveProxyStats,
  makeDriveHostWorker,
  makeLspWorker,
  traceFetchProgress,
  writeSourceFileToDrive,
} from '$lib'
import { fetchWASMAndData, type DriveHandle, type SupportedAgdaVersion } from './interface'
import { createPerformanceTrace } from '$lib/performance.js'
import type { ALSWorkerInitResultProxied, DriveWorkerReadyMessage, WASMLoadingProgress } from '$lib/worker/types'
import type { BackendInitOptions, LSPStreams, RuntimeBackend } from './interface'

const isSafari = /Apple Computer/.test((navigator as any).vendor)

export class RunnoRuntimeBackend implements RuntimeBackend {
  private readonly _agdaBuffers: { stdin: SharedArrayBuffer; stdout: SharedArrayBuffer }
  private readonly _driveBuffers: { lock: SharedArrayBuffer; stdin: SharedArrayBuffer; stdout: SharedArrayBuffer }
  private readonly _agdaVersion: SupportedAgdaVersion

  private readonly _agdaStdinWriter: SPSCWriter
  private readonly _agdaStdoutReader: SPSCReader
  private readonly _driveHandle: DriveHandle

  _lspWorker: Worker | undefined
  _driveHostWorker: Worker | undefined
  private _workerInitData: ALSWorkerInitResultProxied | undefined
  private _wasmLoadingProgress: WASMLoadingProgress | null = null

  constructor(
    agdaBuffers: { stdin: SharedArrayBuffer; stdout: SharedArrayBuffer },
    driveBuffers: { lock: SharedArrayBuffer; stdin: SharedArrayBuffer; stdout: SharedArrayBuffer },
    agdaVersion: SupportedAgdaVersion,
  ) {
    this._agdaBuffers = agdaBuffers
    this._driveBuffers = driveBuffers
    this._agdaVersion = agdaVersion

    this._agdaStdinWriter = new SPSCWriter(agdaBuffers.stdin)
    this._agdaStdoutReader = new SPSCReader(agdaBuffers.stdout)
    this._driveHandle = {
      lock: new Int32Array(driveBuffers.lock, 0, 1),
      stdinWriter: new SPSCWriter(driveBuffers.stdin),
      stdoutReader: new SPSCReader(driveBuffers.stdout),
    }
  }

  getLSPStreams(): LSPStreams {
    return { stdinWriter: this._agdaStdinWriter, stdoutReader: this._agdaStdoutReader }
  }

  getDriveHandle(): DriveHandle {
    return this._driveHandle
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

    const { initPromise } = makeLspWorker({
      wasmSource: { ...this._wasmLoadingProgress.source },
      stdinWaker: wakerChannel.port2,
      stdin: this._agdaBuffers.stdin,
      stdout: this._agdaBuffers.stdout,
      // ALS worker talks to drive worker: pipe directions are swapped from controller's perspective
      driveBuffers: {
        lock: this._driveBuffers.lock,
        stdin: this._driveBuffers.stdout,
        stdout: this._driveBuffers.stdin,
      },
      args: ['--raw'],
    }, worker => {
      this._lspWorker = worker
      worker.addEventListener('error', (evt) => {
        console.error(evt)
        debugger
      })
    })

    this._workerInitData = await trace.measure('Initialize ALS worker', () => initPromise)

    const [, dataFileData, stdlibData, cubicalData] = await Promise.all([
      trace.measure('Read ALS version', () =>
        this._workerInitData!.getALSVersion().then(ver => callbacks.onVersionReceived(ver))),
      wasmAndData.dataFile
        ? trace.measure('Read Agda builtins data', () => wasmAndData.dataFile!.arrayBuffer())
        : Promise.resolve(undefined),
      trace.measure('Fetch standard-library zip', () => fetch(asset('/agda-stdlib-2.3.zip')).then(x => x.arrayBuffer())),
      trace.measure('Fetch Cubical zip', () => fetch(asset('/agda-cubical-0.9.zip')).then(x => x.arrayBuffer())),
    ])

    await trace.measure('Initialize virtual filesystem', () =>
      this._initDriveHostWorker({ builtin: dataFileData, stdlib: stdlibData, cubical: cubicalData }, callbacks))

    if (agdaVersion === '2.8.0') {
      await trace.measure('Run Agda --setup', () => this._workerInitData!.spawn(['--setup']))
    }

    if (this._wasmLoadingProgress.source.type === 'url' &&
        this._wasmLoadingProgress.source.url.startsWith('blob:')) {
      URL.revokeObjectURL(this._wasmLoadingProgress.source.url)
    }

    callbacks.onPerformanceEntries(trace.entries)

    return wakerChannel.port1
  }

  private async _initDriveHostWorker(
    options: { builtin?: ArrayBuffer; stdlib?: ArrayBuffer; cubical?: ArrayBuffer },
    callbacks: BackendInitOptions['callbacks'],
  ): Promise<void> {
    if (this._driveHostWorker) {
      throw new Error('should not be reusing existing drive host worker')
    }

    const { lock, stdin, stdout } = this._driveBuffers
    new Int32Array(lock).set([0])
    SPSC.resetArrayBuffer(stdin)
    SPSC.resetArrayBuffer(stdout)

    const { worker, event } = await makeDriveHostWorker({
      stdin, stdout,
      agdaDataZip: options.builtin ?? null,
      agdaStdlibZip: options.stdlib ?? null,
      agdaCubicalZip: options.cubical ?? null,
    })

    const readyMessage = event.data as DriveWorkerReadyMessage
    if (readyMessage !== 'fs-ready' && readyMessage.type !== 'fs-ready') {
      throw new Error('drive worker did not respond correctly')
    }
    if (readyMessage !== 'fs-ready') {
      callbacks.onPerformanceEntries(readyMessage.performanceEntries)
    }

    this._driveHostWorker = worker
    callbacks.onDriveCreated()
  }

  run(): Promise<number> {
    return this._workerInitData!.start()
  }

  async syncSourceFile(doc: string): Promise<void> {
    await writeSourceFileToDrive(this._driveHandle, doc)
  }

  async resetDriveProxyStats(): Promise<void> {
    await getAndResetDriveProxyStats(this._driveHandle)
  }

  async getDriveProxyStats() {
    return getAndResetDriveProxyStats(this._driveHandle)
  }

  terminate(): void {
    this._wasmLoadingProgress?.cancel?.()
    this._wasmLoadingProgress = null

    this._lspWorker?.terminate()
    this._lspWorker = undefined
    this._workerInitData = undefined

    this._driveHostWorker?.terminate()
    this._driveHostWorker = undefined
  }
}
