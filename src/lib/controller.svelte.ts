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
  makeDriveHostWorker,
  makeLspWorker,
  traceFetchProgress,
  writeSourceFileToDrive,
} from '$lib'
import type { ALSWorkerInitResultProxied, WASMLoadingProgress } from '$lib/worker/types'
import { asset } from '$app/paths'
import { ALSMessageRouter, makeLSPTransport, type AgdaIOTCMStatus } from './agda/transport'
import { commit } from './codemirror/offsets'

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
    path: asset('/als-2.8.wasm'),
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
  currentFilePath = $state<string>('/source.agda')
  iotcmStatus = $state<AgdaIOTCMStatus>('init')

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
    const wasmAndData = await fetchWASMAndData(this.config.agdaVersion).catch(() => null)

    if (wasmAndData == null) {
      this.alsWorkerStatus = 'errored'
      return
    }

    const id = Math.random()
    const progressCtx = traceFetchProgress(wasmAndData.wasm, (loaded) => {
      this.wasmLoadingProgress!.bytesLoaded = loaded
    })

    if (isSafari) {
      // Safari does not support transfering a ReadableStream, so we consume the stream and pass its object URL to worker
      // TODO: revoke object URL after use
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

  async initDriveHostWorker(agdaDataZip: Uint8Array | null) {
    if (this._driveHostWorker) {
      throw new Error('should not be reusing existing drive host worker')
    }

    const { lock, stdin, stdout } = this.config.driveBuffers
    new Int32Array(lock).set([0])
    SPSC.resetArrayBuffer(stdin)
    SPSC.resetArrayBuffer(stdout)

    const { worker, event } = await makeDriveHostWorker({ stdin, stdout, agdaDataZip })
    if (event.data !== 'fs-ready') {
      throw new Error('drive worker did not respond correctly')
    }

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

    this.workerInitData = await initPromise

    await Promise.all([
      this.workerInitData.getALSVersion().then(ver => this.receivedALSVersion = ver),
      this.initDriveHostWorker(dataFile ? await dataFile.arrayBuffer().then(x => new Uint8Array(x)) : null)
        .catch(err => { console.error('Failed to setup ALS drive host worker', err) }),
    ])

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

    this.alsWorkerStatus = 'terminated'
    this.deactivate()
  }

  deactivate() {
    this.lspClient!.disconnect()
    this.editorView!.dispatch({
      effects: this.lspClientCompartment.reconfigure([]),
    })
  }

  async loadAgdaFile() {
    if (this.driveIsLocked) {
      throw new Error('drive lock is already acquired')
    }

    console.log('will update fs...')
    console.time('update-fs')

    const doc = this.editorView!.state.doc.toString()
    localStorage.setItem(LS_DOC_KEY, doc)

    this.driveIsLocked = true
    await writeSourceFileToDrive(this.driveHandle, doc)
    this.driveIsLocked = false

    console.log('file is synced.')
    console.timeEnd('update-fs')

    this.editorView!.dispatch({effects: commit.of()})

    this.lspClient!.notification('textDocument/didSave', {
      textDocument: {
        uri: 'file://' + this.currentFilePath,
      },
    })

    const encodedFilePath = JSON.stringify(this.currentFilePath)

    await this.lspClient!.request('agda', {
      tag: 'CmdReq',
      contents: `IOTCM ${encodedFilePath} NonInteractive Direct (Cmd_load ${encodedFilePath} [])`,
    })
  }
}
