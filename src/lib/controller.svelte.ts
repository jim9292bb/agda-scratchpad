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
  reportFetchProgress,
  writeSourceFileToDrive,
} from '$lib'
import type { ALSWorkerInitResultProxied, WASMLoadingProgress } from '$lib/worker/types'
import { asset } from '$app/paths'
import { ALSMessageRouter, makeLSPTransport, type AgdaIOTCMStatus } from './agda/transport'
import { commit } from './codemirror/offsets'

const isSafari = /Apple Computer/.test((navigator as any).vendor)

type ALSWorkerStatus = 'initial' | 'errored' | 'loading' | 'loaded' | 'active' | 'deactivating' | 'terminated' | 'exited'
type SupportedAgdaVersion = '2.6.4.3' | '2.7.0.1' | '2.8.0'

const agdaSupportData: Record<SupportedAgdaVersion, { path: string, stdlib: string[] }> = {
  '2.6.4.3': { path: 'als.wasm', stdlib: ['2.0'] },
  '2.7.0.1': { path: 'als.wasm', stdlib: ['2.3'] },
  '2.8.0': { path: 'als.wasm', stdlib: ['2.3'] },
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
  driveHandle: {
    lock: Int32Array<SharedArrayBuffer>,
    stdinWriter: SPSCWriter,
    stdoutReader: SPSCReader,
  }
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
      throw new Error('cannot do start if WASM is already running')
    }

    if (this.workerInitData) {
      if (!this._lspWorker) {
        throw new Error('runaway worker')
      }
      console.warn('reusing worker')
      return this._startALSWASM()
    }

    this.alsWorkerStatus = 'loading'
    const wasmResponse = await this.fetchWASMAndData()

    if (isSafari) {
      // Safari does not support transfering a ReadableStream, so fake it here
      const result = await wasmResponse.arrayBuffer()
      const blob = new Blob([result], { type: 'application/wasm' })
      this.wasmLoadingProgress = {
        source: { type: 'url', url: URL.createObjectURL(blob) },
        bytesLoaded: result.byteLength,
        bytesTotal: result.byteLength,
        finished: Promise.resolve(),
      }
    } else {
      const prog = reportFetchProgress(wasmResponse, (loaded) => {
        this.wasmLoadingProgress!.bytesLoaded = loaded
      })
      this.wasmLoadingProgress = { ...prog, bytesLoaded: 0 }
    }

    this.wasmLoadingProgress.finished.then(() => this.alsWorkerStatus = 'loaded')

    return this.runALSWASM()
  }

  async restartALSWASM() {
    await this.stopALSWASM()
    // FIXME: make one tick for the status transition, is it required?
    await new Promise(r => setTimeout(r))
    return this.startALSWASM()
  }

  async _startALSWASM() {
    this.alsWorkerStatus = 'active'
    this.runningWASM = this.workerInitData!.start()

    SPSC.resetArrayBuffer(this.config.agdaBuffers.stdin)
    SPSC.resetArrayBuffer(this.config.agdaBuffers.stdout)

    this.lspClient!.connect(this.alsRouter!.transport)
    this.editorView!.dispatch({
      effects:
        this.lspClientCompartment.reconfigure(this.lspClient!.plugin(`file://${this.currentFilePath}`)),
    })

    const ret = await this.runningWASM
    this.runningWASM = undefined
    this.alsWorkerStatus = 'exited'
    console.log('worker exited', ret)
    return ret
  }

  async fetchWASMAndData() {
    const resp = await fetch(asset('/als.wasm'))
    if (!resp.ok) {
      this.alsWorkerStatus = 'errored'
    }

    // TODO: this depends on the version requested
    const rdata = await fetch(asset('/agda-data.zip'))
    if (rdata.ok) {
      this.agdaDataZip = rdata.arrayBuffer().then(ab => new Uint8Array(ab))
    } else {
      this.alsWorkerStatus = 'errored'
    }

    return resp
  }

  async setupALSWASM() {
    if (this._driveHostWorker) {
      throw new Error('should not be reusing existing drive host worker')
    }

    if (!this.agdaDataZip) {
      throw new Error('agda data is undefined')
    }

    const worker = this._driveHostWorker = makeDriveHostWorker()

    worker.postMessage({
      stdin: this.config.driveBuffers.stdin,
      stdout: this.config.driveBuffers.stdout,
      agdaDataZip: await this.agdaDataZip,
    })
    return new Promise<void>((res, rej) => {
      worker.addEventListener('message', c => {
        if (c.data !== 'fs-ready') {
          return rej('drive worker did not respond correctly')
        }
        res()
      }, { once: true })
    })
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

  async runALSWASM() {
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
      this.setupALSWASM()
        .catch(err => { console.error('Failed to setup ALS WASM', err) }),
    ])

    return this._startALSWASM()
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

    console.timeLog('update-fs', 'file is synced.')

    this.editorView!.dispatch({effects: commit.of()})

    this.lspClient!.notification('textDocument/didSave', {
      textDocument: {
        uri: 'file://' + this.currentFilePath,
      },
    })

    const encodedFilePath = JSON.stringify(this.currentFilePath)

    this.lspClient!.request('agda', {
      tag: 'CmdReq',
      contents: `IOTCM ${encodedFilePath} NonInteractive Direct (Cmd_load ${encodedFilePath} [])`,
    })
  }
}
