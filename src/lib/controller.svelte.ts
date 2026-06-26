import type { EditorView } from '@codemirror/view'
import { Compartment } from '@codemirror/state'
import { LSPClient, languageServerExtensions } from '@codemirror/lsp-client'

import { hoverTooltips } from '$lib/codemirror/lsp-hover'

import {
  createReadableByteStream,
  createWritableByteStream,
} from '$lib'
import { ALSMessageRouter, makeLSPTransport, type AgdaIOTCMStatus } from './agda/transport'
import { commit } from './codemirror/offsets'
import { getAgdaDocumentVersion } from './agda/goal-state'
import { createPerformanceTrace, formatDurationMs, formatPerformanceEntry } from './performance'
import type { DriveProxyStats, PerformanceEntry, WASMLoadingProgress } from './worker/types'
import { BrowserWasiShimRuntimeBackend } from './runtime/browser-wasi-shim'
import {
  deployProfiles, resolveProfileLibraries,
  type SupportedAgdaVersion, type DriveHandle, type RuntimeBackend, type DeployProfile,
} from './runtime/interface'

export type { SupportedAgdaVersion, DriveHandle, DeployProfile }
export { deployProfiles, resolveProfileLibraries }

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
    .map(([method, count]) => `${method} ${count} / ${formatDurationMs(stats.methodDurationsMs[method] ?? 0)}`)
    .join(', ')

  const formatTopPaths = (paths: DriveProxyStats['pathStatPaths']) =>
    Object.entries(paths)
      .sort((a, b) => b[1].count - a[1].count || b[1].durationMs - a[1].durationMs)
      .slice(0, 4)
      .map(([path, pathStats]) => `${path} ${pathStats.count} / ${formatDurationMs(pathStats.durationMs)}`)
      .join('; ')

  const formatExtensionStats = (label: string, extensionStats: DriveProxyStats['agda']) =>
    `${label} pathStat ${extensionStats.pathStat}, open ${extensionStats.open}, read ${extensionStats.read}, write ${extensionStats.write}`

  return {
    calls: stats.totalCalls,
    totalMs: stats.totalDurationMs,
    readBytes: stats.bytesRead,
    writtenBytes: stats.bytesWritten,
    pathStatCount: stats.methods.pathStat ?? 0,
    pathStatMs: stats.methodDurationsMs.pathStat ?? 0,
    openCount: stats.methods.open ?? 0,
    openMs: stats.methodDurationsMs.open ?? 0,
    uniquePathStatPaths: stats.uniquePathStatPaths,
    pathStatSuccesses: stats.pathStatSuccesses,
    pathStatFailures: stats.pathStatFailures,
    agdaiPathStat: stats.agdai.pathStat,
    agdaiOpen: stats.agdai.open,
    agdaiRead: stats.agdai.read,
    agdaiWrite: stats.agdai.write,
    agdaPathStat: stats.agda.pathStat,
    agdaOpen: stats.agda.open,
    agdaRead: stats.agda.read,
    agdaWrite: stats.agda.write,
    methods,
    topPathStatPaths: formatTopPaths(stats.pathStatPaths),
    topOpenPaths: formatTopPaths(stats.openPaths),
    agdaStats: formatExtensionStats('.agda', stats.agda),
    agdaiStats: formatExtensionStats('.agdai', stats.agdai),
  }
}

export class AgdaController {
  private _backend: RuntimeBackend | undefined

  editorView?: EditorView
  lspClient?: LSPClient
  alsRouter?: ALSMessageRouter
  runningWASM?: Promise<number>

  lspClientCompartment = new Compartment()
  driveIsLocked = false

  alsWorkerStatus = $state<'initial' | 'errored' | 'loading' | 'loaded' | 'active' | 'deactivating' | 'terminated' | 'exited'>('initial')
  wasmLoadingProgress = $state<WASMLoadingProgress | null>(null)
  wasmLibraryFetchProgress = $state<{ fetched: number; total: number } | null>(null)
  receivedALSVersion = $state<string | undefined>()
  /** Bare numeric Agda version (`agda --numeric-version`) — used by triggerPrefetch
   *  to locate the matching prebuilt .agdai cache, if any (see prefetch.js). */
  receivedNumericAgdaVersion = $state<string | undefined>()
  driveIsCreated = $state(false)
  currentFilePath = $state('/source.agda')
  iotcmStatus = $state<AgdaIOTCMStatus>('init')
  performanceEntries = $state<PerformanceEntry[]>([])
  queryResults = $state<Array<{ id: number; label: string; content: string }>>([])
  private _nextQueryId = 0

  /** Which deploy.config.json profile (ALS version + library set) is currently active.
   *  Switching requires a session restart — see switchProfile(). */
  selectedProfileId = $state<string>(deployProfiles[0]?.id ?? '')

  get activeProfile(): DeployProfile {
    return deployProfiles.find(p => p.id === this.selectedProfileId) ?? deployProfiles[0]
  }

  appendQueryResult(label: string, content: string) {
    this.queryResults = [{ id: this._nextQueryId++, label, content }, ...this.queryResults]
  }

  clearQueryResults() {
    this.queryResults = []
  }

  get driveHandle(): DriveHandle {
    return this._ensureBackend().getDriveHandle()
  }

  get backend(): RuntimeBackend {
    return this._ensureBackend()
  }

  private _ensureBackend(): RuntimeBackend {
    if (!this._backend) {
      this._backend = new BrowserWasiShimRuntimeBackend(
        this.config.agdaBuffers, this.config.driveBuffers, this.activeProfile.alsVersion)
    }
    return this._backend
  }

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
  }) {
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
    await this._ensureBackend().resetDriveProxyStats()
  }

  async appendDriveProxyStats(label: string) {
    if (!this.driveIsCreated) return
    const stats = await this._ensureBackend().getDriveProxyStats()
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

    const backend = this._ensureBackend()

    if (backend.isInitialized()) {
      console.warn('reusing worker')
      return this._startALSWASM()
    }

    if (this.wasmLoadingProgress) {
      throw new Error('wasm is already loading')
    }

    this.alsWorkerStatus = 'loading'
    this.performanceEntries = []

    const port1 = await backend.init({
      agdaVersion: this.activeProfile.alsVersion,
      libraries: resolveProfileLibraries(this.activeProfile),
      agdaBuffers: this.config.agdaBuffers,
      driveBuffers: this.config.driveBuffers,
      callbacks: {
        onWASMLoadingProgressChange: (p) => { this.wasmLoadingProgress = p },
        onWASMLoaded: () => { this.alsWorkerStatus = 'loaded' },
        onVersionReceived: (ver) => { this.receivedALSVersion = ver },
        onNumericAgdaVersionReceived: (ver) => { this.receivedNumericAgdaVersion = ver },
        onLibraryFetchProgress: (fetched, total) => { this.wasmLibraryFetchProgress = { fetched, total } },
        onDriveCreated: () => { this.driveIsCreated = true },
        onPerformanceEntries: (entries) => { this.appendPerformanceEntries(entries) },
      },
    }).catch(() => null)

    if (port1 == null) {
      this.alsWorkerStatus = 'errored'
      return
    }

    this.alsRouter = this.makeALSTransport(port1)
    return this._startALSWASM()
  }

  async restartALSWASM() {
    await this.stopALSWASM()
    // FIXME: make one tick for the status transition, is it required?
    await new Promise(r => setTimeout(r))
    return this.startALSWASM()
  }

  /** Switches to a different deploy.config.json profile (ALS version + library set).
   *  Always restarts: a new WASM instance and VFS are needed either way. */
  async switchProfile(profileId: string) {
    if (profileId === this.selectedProfileId) return
    if (!deployProfiles.some(p => p.id === profileId)) {
      throw new Error(`unknown environment id: ${profileId}`)
    }

    if (this.alsWorkerStatus === 'active') {
      await this.stopALSWASM()
    }
    this.terminateALSWASM()
    this._backend = undefined
    this.alsWorkerStatus = 'initial'
    this.selectedProfileId = profileId

    await new Promise(r => setTimeout(r))
    return this.startALSWASM()
  }

  async _startALSWASM() {
    this.alsWorkerStatus = 'active'

    this._ensureBackend().resetBuffers()
    this.runningWASM = this._ensureBackend().run()

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

  makeALSTransport(stdinWaker: MessagePort) {
    if (!this.editorView) {
      throw new Error('EditorView not ready')
    }

    const { stdinWriter, stdoutReader } = this._ensureBackend().getLSPStreams()
    const lspClientReadable = createReadableByteStream(stdoutReader, stdinWaker)
    const lspClientWritable = createWritableByteStream(stdinWriter)

    const router = makeLSPTransport(
      this.editorView,
      status => {
        this.iotcmStatus = status
      },
    )

    router.intercept(lspClientReadable, lspClientWritable)
    router.appendQueryResult = (label, content) => this.appendQueryResult(label, content)

    return router
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
    this._backend?.terminate()
    this.wasmLoadingProgress = null
    this.wasmLibraryFetchProgress = null
    this.runningWASM = undefined
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
      await this.measurePerformance('Sync source to virtual filesystem', () => this._ensureBackend().syncSourceFile(doc), {
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
