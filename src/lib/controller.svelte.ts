import { SPSC } from 'spsc'
import { SPSCReader } from 'spsc/reader'
import { SPSCWriter } from 'spsc/writer'

import type { EditorView } from '@codemirror/view'
import { Compartment } from '@codemirror/state'
import { LSPClient, languageServerExtensions } from '@codemirror/lsp-client'

import { hoverTooltips } from '$lib/codemirror/lsp-hover'

import {
  createReadableByteStream,
  createWritableByteStream,
  getAndResetDriveProxyStats,
  makeDriveHostWorker,
  makeLspWorker,
  traceFetchProgress,
  writeSourceFileToDrive,
} from '$lib'
import type { ALSWorkerInitResultProxied, WASMLoadingProgress } from '$lib/worker/types'
import { asset } from '$app/paths'
import { ALSMessageRouter, makeLSPTransport, type AgdaIOTCMStatus } from './agda/transport'
import { commit } from './codemirror/offsets'
import { getAgdaDocumentVersion } from './agda/goal-state'
import { createPerformanceTrace, formatPerformanceEntry } from './performance'
import type { DriveProxyStats, DriveWorkerReadyMessage, PerformanceEntry } from './worker/types'

const isSafari = /Apple Computer/.test((navigator as any).vendor)

type ALSWorkerStatus = 'initial' | 'errored' | 'loading' | 'loaded' | 'active' | 'deactivating' | 'terminated' | 'exited'

const supportedAgdaVersion = ['2.6.4.3', '2.7.0.1', '2.8.0'] as const
export type SupportedAgdaVersion = typeof supportedAgdaVersion[number]

export interface DriveHandle {
  lock: Int32Array<SharedArrayBuffer>,
  stdinWriter: SPSCWriter,
  stdoutReader: SPSCReader,
}

interface AgdaVersionSpec {
  path: string
  stdlibCandidates: string[]
  // zip archive to unpack to the initial drive. since 2.8.0 this is no longer required.
  // instead, a `--setup` command must be executed once
  dataPath?: string
}

export const agdaVersionMap: Record<SupportedAgdaVersion, AgdaVersionSpec> = {
  ['__proto__' as any]: null,
  '2.6.4.3': {
    path: asset('/als-2.6.wasm'),
    stdlibCandidates: ['2.0', '2.1'],
    dataPath: asset('/agda-data.zip'),
  },
  '2.7.0.1': {
    path: asset('/als-2.7ext.wasm'),
    stdlibCandidates: ['2.1.1', '2.2', '2.3'],
    dataPath: asset('/agda-data.zip'),
  },
  '2.8.0': {
    path: asset('/als-2.8ext.wasm'),
    stdlibCandidates: ['2.3'],
  },
}

export async function fetchWASMAndData(agdaVersion: SupportedAgdaVersion) {
  if (!(agdaVersion in agdaVersionMap)) {
    throw new Error(
      `version ${agdaVersion} not in list of supported versions: ${JSON.stringify(supportedAgdaVersion)}`)
  }

  const { path, dataPath } = agdaVersionMap[agdaVersion]
  const wasm = await fetch(path)
  if (!wasm.ok || wasm.status >= 400) {
    throw new Error(`failed to fetch ALS WASM: ${wasm.statusText}`)
  }

  let dataFile = null
  if (dataPath) {
    dataFile = await fetch(dataPath)
    if (!dataFile.ok || dataFile.status >= 400) {
      throw new Error(`failed to fetch data file: ${dataFile.statusText}`)
    }
  }

  return { wasm, dataFile }
}

export const LS_DOC_KEY = 'agda-web-ide-beta:doc'
const loadArgs: string[] = []

function makeLspClient(rootUri: string = '/') {
  const lspExtsWithoutHover = languageServerExtensions().filter(x => !('active' in x))

  return new LSPClient({
    timeout: 10000,
    rootUri,
    extensions: [
      ...lspExtsWithoutHover,
      hoverTooltips(),
    ],
  })
}

function formatDriveProxyStats(stats: DriveProxyStats): Record<string, unknown> {
  const methods = Object.entries(stats.methods)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([method, count]) => `${method} ${count}`)
    .join(', ')

  return {
    calls: stats.totalCalls,
    readBytes: stats.bytesRead,
    writtenBytes: stats.bytesWritten,
    methods,
  }
}

export class AgdaController {
  agdaStdinWriter: SPSCWriter
  agdaStdoutReader: SPSCReader
  driveHandle: DriveHandle
  editorView?: EditorView
  lspClient?: LSPClient
  alsRouter?: ALSMessageRouter
  workerInitData?: ALSWorkerInitResultProxied
  runningWASM?: Promise<number>
  agdaDataZip?: Promise<Uint8Array>

  lspClientCompartment = new Compartment()
  driveIsLocked = false

  alsWorkerStatus = $state<ALSWorkerStatus>('initial')
  wasmLoadingProgress = $state<WASMLoadingProgress | null>(null)
  receivedALSVersion = $state<string | undefined>()
  driveIsCreated = $state(false)
  currentFilePath = $state('/source.agda')
  iotcmStatus = $state<AgdaIOTCMStatus>('init')
  performanceEntries = $state<PerformanceEntry[]>([])

  _lspWorker: Worker | undefined
  _driveHostWorker: Worker | undefined

  constructor(readonly config: {
    agdaBuffers: {
      stdin: SharedArrayBuffer,
      stdout: SharedArrayBuffer,
    },
    driveBuffers: {
      lock: SharedArrayBuffer
      stdin: SharedArrayBuffer,
      stdout: SharedArrayBuffer,
    },
    agdaVersion: SupportedAgdaVersion,
  }) {
    this.agdaStdinWriter = new SPSCWriter(config.agdaBuffers.stdin)
    this.agdaStdoutReader = new SPSCReader(config.agdaBuffers.stdout)
    this.driveHandle = {
      lock: new Int32Array(config.driveBuffers.lock, 0, 1),
      stdinWriter: new SPSCWriter(config.driveBuffers.stdin),
      stdoutReader: new SPSCReader(config.driveBuffers.stdout),
    }

    this.lspClient = makeLspClient()
  }

  connectEditorView(view: EditorView) {
    this.editorView = view
  }

  appendPerformanceEntries(entries: PerformanceEntry[]) {
    if (!entries.length) return
    this.performanceEntries = [...this.performanceEntries, ...entries]
    for (const entry of entries) {
      console.info('[perf]', formatPerformanceEntry(entry), entry.detail ?? '')
    }
  }

  async measurePerformance<T>(
    label: string,
    callback: () => Promise<T>,
    detail?: Record<string, unknown>,
  ): Promise<T> {
    const trace = createPerformanceTrace()
    try {
      return await trace.measure(label, callback, detail)
    } finally {
      this.appendPerformanceEntries(trace.entries)
    }
  }

  async resetDriveProxyStats() {
    if (!this.driveIsCreated) return
    await getAndResetDriveProxyStats(this.driveHandle)
  }

  async appendDriveProxyStats(label: string) {
    if (!this.driveIsCreated) return
    const stats = await getAndResetDriveProxyStats(this.driveHandle)
    this.appendPerformanceEntries([{
      label,
      durationMs: 0,
      detail: formatDriveProxyStats(stats),
    }])
  }

  async startALSWASM() {
    if (this.runningWASM) {
      throw new Error('WASM is already running')
    }

    if (this.workerInitData) {
      if (!this._lspWorker) {
        throw new Error('runaway worker')
      }
      console.warn('reusing worker')
      return this._startALSWASM(this.workerInitData)
    }

    if (this.wasmLoadingProgress) {
      throw new Error('wasm is already loading')
    }

    this.alsWorkerStatus = 'loading'
    this.performanceEntries = []
    const wasmAndData = await this.measurePerformance(
      'Fetch ALS WASM response',
      () => fetchWASMAndData(this.config.agdaVersion),
      { agdaVersion: this.config.agdaVersion },
    ).catch(() => null)

    if (wasmAndData == null) {
      this.alsWorkerStatus = 'errored'
      return
    }

    const progressCtx = traceFetchProgress(wasmAndData.wasm, (loaded) => {
      this.wasmLoadingProgress!.bytesLoaded = loaded
    })

    if (isSafari) {
      // Safari does not support transfering a ReadableStream, so we consume the stream and pass its object URL to worker
      this.wasmLoadingProgress = {
        ...progressCtx,
        source: { type: 'url', url: 'fakeurl' },
        bytesLoaded: 0,
        // we read it till end; by the time "finished" is awaited, the object is replaced with the real one below
      }

      const resp = new Response(progressCtx.source.stream, { headers: { 'Content-Type':  'application/wasm' } })
      const blob = await resp.blob()
      this.wasmLoadingProgress = {
        source: { type: 'url', url: URL.createObjectURL(blob) },
        bytesLoaded: blob.size,
        bytesTotal: blob.size,
        finished: Promise.resolve(),
      }
    } else {
      this.wasmLoadingProgress = { ...progressCtx, bytesLoaded: 0 }
    }

    this.wasmLoadingProgress.finished.then(() => this.alsWorkerStatus = 'loaded')

    return this.runALSWASM(wasmAndData.dataFile)
  }

  async restartALSWASM() {
    await this.stopALSWASM()
    // FIXME: make one tick for the status transition, is it required?
    await new Promise(r => setTimeout(r))
    return this.startALSWASM()
  }

  async _startALSWASM(workerInitData: ALSWorkerInitResultProxied) {
    this.alsWorkerStatus = 'active'

    SPSC.resetArrayBuffer(this.config.agdaBuffers.stdin)
    SPSC.resetArrayBuffer(this.config.agdaBuffers.stdout)

    this.runningWASM = workerInitData.start()

    this.lspClient!.connect(this.alsRouter!.transport)
    this.editorView!.dispatch({
      effects:
        this.lspClientCompartment.reconfigure(this.lspClient!.plugin(`file://${this.currentFilePath}`)),
    })

    const ret = await this.runningWASM
    this.runningWASM = undefined
    this.deactivate()

    this.alsWorkerStatus = 'exited'
    console.log('ALS worker exited with code', ret)
    return ret
  }

  async initDriveHostWorker(options: {builtin?: ArrayBuffer, stdlib?: ArrayBuffer, cubical?: ArrayBuffer}) {
    if (this._driveHostWorker) {
      throw new Error('should not be reusing existing drive host worker')
    }

    const { lock, stdin, stdout } = this.config.driveBuffers
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
      this.appendPerformanceEntries(readyMessage.performanceEntries)
    }

    this.driveIsCreated = true
    return this._driveHostWorker = worker
  }

  makeALSTransport(stdinWaker: MessagePort) {
    if (!this.editorView) {
      throw new Error('EditorView not ready')
    }

    const lspClientReadable = createReadableByteStream(this.agdaStdoutReader, stdinWaker)
    const lspClientWritable = createWritableByteStream(this.agdaStdinWriter)

    const router = makeLSPTransport(
      this.editorView,
      status => {
        this.iotcmStatus = status
      },
    )

    router.intercept(lspClientReadable, lspClientWritable)

    return router
  }

  async runALSWASM(dataFile: Response | null) {
    if (!this.wasmLoadingProgress) {
      throw new Error('No active loading wasm')
    }

    const wakerChannel = new MessageChannel()

    this.alsRouter = this.makeALSTransport(wakerChannel.port1)

    const { initPromise } = makeLspWorker({
      wasmSource: { ...this.wasmLoadingProgress.source },
      stdinWaker: wakerChannel.port2,
      stdin: this.config.agdaBuffers.stdin,
      stdout: this.config.agdaBuffers.stdout,
      // note that we pipe the app's stdout to drive's stdin and vice versa
      driveBuffers: {
        lock: this.config.driveBuffers.lock,
        stdin: this.config.driveBuffers.stdout,
        stdout: this.config.driveBuffers.stdin,
      },
      args: ['--raw'],
    }, worker => {
      this._lspWorker = worker
      worker.addEventListener('error', (evt) => {
        console.error(evt)
        debugger
      })
    })

    this.workerInitData = await this.measurePerformance('Initialize ALS worker', () => initPromise)

    const [, dataFileData, stdlibData, cubicalData] = await Promise.all([
      this.measurePerformance('Read ALS version', () => this.workerInitData!.getALSVersion().then(ver => this.receivedALSVersion = ver)),
      dataFile
        ? this.measurePerformance('Read Agda builtins data', () => dataFile.arrayBuffer())
        : Promise.resolve(undefined),
      this.measurePerformance('Fetch standard-library zip', () => fetch(asset('/agda-stdlib-2.3.zip')).then(x => x.arrayBuffer())),
      this.measurePerformance('Fetch Cubical zip', () => fetch(asset('/agda-cubical-0.9.zip')).then(x => x.arrayBuffer())),
    ])

    try {
      await this.measurePerformance('Initialize virtual filesystem', () => this.initDriveHostWorker({
        builtin: dataFileData,
        stdlib: stdlibData,
        cubical: cubicalData,
      }))
    } catch (err) {
      return Promise.reject(new Error('Failed to setup ALS drive host worker', { cause: err }))
    }

    if (this.config.agdaVersion === '2.8.0') {
      try {
        await this.measurePerformance('Run Agda --setup', () => this.workerInitData!.spawn(['--setup']))
      } catch (err) {
        console.warn('failed to complete the setup stage of agda', err)
        this.alsWorkerStatus = 'errored'
        return -1
      }
    }

    // revoke object url after it is consumed
    if (this.wasmLoadingProgress.source.type === 'url' &&
        this.wasmLoadingProgress.source.url.startsWith('blob:')) {
      URL.revokeObjectURL(this.wasmLoadingProgress.source.url)
    }

    return this._startALSWASM(this.workerInitData)
  }

  async stopALSWASM() {
    if (this.alsWorkerStatus !== 'active') {
      throw new Error('cannot stop if the status is not active')
    }
    // FIXME: cannot reuse the worker, transport just deadlock
    this.alsWorkerStatus = 'deactivating'
    await this.lspClient!.request('shutdown', null)
    this.lspClient!.notification('exit', null)
    await this.runningWASM
    this.runningWASM = undefined
    this.alsWorkerStatus = 'exited'
    this.deactivate()
  }

  terminateALSWASM() {
    console.log('attempting to terminate the worker')
    if (this.wasmLoadingProgress) {
      this.wasmLoadingProgress.cancel?.()
    }
    this.wasmLoadingProgress = null

    this._lspWorker?.terminate()
    this._lspWorker = undefined
    this.workerInitData = undefined
    this.runningWASM = undefined

    this._driveHostWorker?.terminate()
    this._driveHostWorker = undefined
    this.driveIsCreated = false

    this.alsWorkerStatus = 'terminated'
    this.deactivate()
  }

  deactivate() {
    this.lspClient!.disconnect()
    this.editorView!.dispatch({
      effects: this.lspClientCompartment.reconfigure([]),
    })
  }

  async syncSourceFileToDrive() {
    if (this.driveIsLocked) {
      throw new Error('drive lock is already acquired')
    }

    console.log('will update fs...')
    console.time('update-fs')

    const doc = this.editorView!.state.doc.toString()
    localStorage.setItem(LS_DOC_KEY, doc)

    this.driveIsLocked = true
    try {
      await this.measurePerformance('Sync source to virtual filesystem', () => writeSourceFileToDrive(this.driveHandle, doc), {
        bytes: new TextEncoder().encode(doc).byteLength,
      })
    } finally {
      this.driveIsLocked = false
    }

    console.log('file is synced.')
    console.timeEnd('update-fs')

    this.editorView!.dispatch({effects: commit.of()})

    this.lspClient!.notification('textDocument/didSave', {
      textDocument: {
        uri: 'file://' + this.currentFilePath,
      },
    })
  }

  async runAgdaInteraction(interaction: string, options: { suppressAgdaInternalErrors?: boolean, suppressDisplayInfo?: boolean } = {}) {
    const encodedFilePath = JSON.stringify(this.currentFilePath)

    this.alsRouter!.lastAgdaInternalError = null
    this.alsRouter!.lastAgdaError = null
    await this.runAgdaCommand({
      tag: 'CmdReq',
      contents: `IOTCM ${encodedFilePath} NonInteractive Direct ${interaction}`,
    }, options)
    if (this.alsRouter!.lastAgdaInternalError) {
      throw new Error(`ALS failed to process ${this.currentFilePath}: ${this.alsRouter!.lastAgdaInternalError}`)
    }
    if (this.alsRouter!.lastAgdaError) {
      throw new Error(this.alsRouter!.lastAgdaError)
    }
  }

  async loadAgdaFile() {
    await this.syncSourceFileToDrive()

    const encodedFilePath = JSON.stringify(this.currentFilePath)

    await this.resetDriveProxyStats()
    try {
      await this.measurePerformance('Agda Cmd_load', async () => {
      this.alsRouter!.lastAgdaInternalError = null
      this.alsRouter!.lastAgdaError = null
      await this.runAgdaCommand({
        tag: 'CmdReq',
        contents: `IOTCM ${encodedFilePath} NonInteractive Direct (Cmd_load ${encodedFilePath} ${JSON.stringify(loadArgs)})`,
      })
      if (this.alsRouter!.lastAgdaInternalError) {
        throw new Error(`ALS failed to process ${this.currentFilePath}: ${this.alsRouter!.lastAgdaInternalError}`)
      }
      if (this.alsRouter!.lastAgdaError) {
        throw new Error(this.alsRouter!.lastAgdaError)
      }
      }, { file: this.currentFilePath })
    } finally {
      await this.appendDriveProxyStats('Drive proxy after Cmd_load')
    }

    await this.resetDriveProxyStats()
    try {
      await this.measurePerformance('Agda token highlighting', async () => {
      await this.runAgdaCommand({
        tag: 'CmdReq',
        contents: `IOTCM ${encodedFilePath} NonInteractive Direct (Cmd_tokenHighlighting ${encodedFilePath} Keep)`,
      }, { suppressAgdaInternalErrors: true })
      }, { file: this.currentFilePath })
    } finally {
      await this.appendDriveProxyStats('Drive proxy after token highlighting')
    }
  }

  async runAgdaCommand(
    params: { tag: 'CmdReq', contents: string },
    options: { suppressAgdaInternalErrors?: boolean, suppressDisplayInfo?: boolean } = {},
  ) {
    if (!this.alsRouter) {
      throw new Error('ALS router not ready')
    }

    this.alsRouter.suppressAgdaInternalErrors = options.suppressAgdaInternalErrors ?? false
    this.alsRouter.suppressDisplayInfo = options.suppressDisplayInfo ?? false
    this.alsRouter.beginCommandDocumentVersion(getAgdaDocumentVersion(this.editorView!.state))
    try {
      await this.lspClient!.request('agda', params)

      while (this.iotcmStatus !== 'ready') {
        await new Promise(r => setTimeout(r, 50))
      }
    } finally {
      this.alsRouter.suppressAgdaInternalErrors = false
      this.alsRouter.suppressDisplayInfo = false
      this.alsRouter.clearCommandDocumentVersion()
    }
  }
}
