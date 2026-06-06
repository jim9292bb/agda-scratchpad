import { Worker } from 'node:worker_threads'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeLspMessage, LspMessageParser } from './lsp.js'
import { fixtureNames, readFixture } from './fixtures.js'
import { durationSince, nowMs } from './timing.js'

const here = dirname(fileURLToPath(import.meta.url))
const experimentRoot = dirname(here)
const appRoot = join(experimentRoot, '..', '..')

function parseArgs(argv) {
  const args = {
    runtime: 'runno-direct-fs',
    fixture: 'cubical-prelude',
    allFixtures: false,
    debug: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--runtime') args.runtime = argv[++i]
    else if (arg === '--fixture') args.fixture = argv[++i]
    else if (arg === '--all-fixtures') args.allFixtures = true
    else if (arg === '--debug-runtime') args.debug = true
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run benchmark -- [--runtime runno-direct-fs] [--fixture cubical-prelude] [--all-fixtures]')
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return args
}

class DirectStdinWriter {
  constructor(sharedBuffer) {
    this.state = new Int32Array(sharedBuffer, 0, 2)
    this.bytes = new Uint8Array(sharedBuffer, 8)
    this.queue = []
    this.flushScheduled = false
  }

  write(payload) {
    if (payload.byteLength > this.bytes.byteLength) {
      throw new Error(`Payload too large for stdin buffer: ${payload.byteLength}`)
    }
    this.queue.push(payload)
    this.scheduleFlush()
  }

  scheduleFlush() {
    if (this.flushScheduled) return
    this.flushScheduled = true
    setTimeout(() => this.flush(), 0)
  }

  flush() {
    this.flushScheduled = false
    if (!this.queue.length) return
    if (Atomics.load(this.state, 0) !== 0) {
      this.scheduleFlush()
      return
    }
    const payload = this.queue.shift()
    this.bytes.set(payload, 0)
    Atomics.store(this.state, 1, 0)
    Atomics.store(this.state, 0, payload.byteLength)
    Atomics.notify(this.state, 0)
    if (this.queue.length) this.scheduleFlush()
  }
}

function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

class LspSession {
  constructor(worker, stdinWriter) {
    this.worker = worker
    this.stdinWriter = stdinWriter
    this.parser = new LspMessageParser()
    this.nextId = 1
    this.pendingResponses = new Map()
    this.pendingResponseEnds = []
    this.pendingDriveStats = []
    this.setupMs = 0
    this.stderr = []

    worker.on('message', message => this.handleWorkerMessage(message))
    worker.on('error', err => {
      for (const pending of this.pendingResponses.values()) pending.reject(err)
      for (const pending of this.pendingResponseEnds) pending.reject(err)
      for (const pending of this.pendingDriveStats) pending.reject(err)
    })
    worker.on('exit', code => {
      if (code === 0) return
      const err = new Error(`Worker exited with ${code}: ${this.stderr.join('')}`)
      for (const pending of this.pendingResponses.values()) pending.reject(err)
      for (const pending of this.pendingResponseEnds) pending.reject(err)
      for (const pending of this.pendingDriveStats) pending.reject(err)
    })
  }

  waitForReady() {
    if (this.readyPromise) return this.readyPromise
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
      this.readyTimeout = setTimeout(() => reject(new Error('Timed out waiting for worker ready')), 60000)
    })
    return this.readyPromise
  }

  handleWorkerMessage(message) {
    if (message.type === 'ready') {
      this.setupMs = message.setupMs
      clearTimeout(this.readyTimeout)
      this.readyResolve?.()
      return
    }
    if (message.type === 'stderr') {
      this.stderr.push(message.text)
      return
    }
    if (message.type === 'debug') {
      this.stderr.push(`[debug:${message.message}] ${JSON.stringify(message.detail)}\n`)
      return
    }
    if (message.type === 'driveStats') {
      const pending = this.pendingDriveStats.shift()
      if (pending) pending.resolve(message.stats)
      return
    }
    if (message.type === 'stdout') {
      if (this.debug) {
        this.stderr.push(`[debug:stdout-chunk] ${new TextDecoder().decode(message.chunk).replaceAll('\r', '\\\\r').replaceAll('\n', '\\\\n').slice(0, 120)}\n`)
      }
      for (const payload of this.parser.push(message.chunk)) {
        if (this.debug) this.stderr.push(`[debug:stdout-message] ${JSON.stringify({ id: payload.id, method: payload.method })}\n`)
        this.handleLspPayload(payload)
      }
      return
    }
    if (message.type === 'exit') {
      if (message.exitCode !== 0) {
        const err = new Error(`ALS worker exited with ${message.exitCode}: ${this.stderr.join('')}`)
        for (const pending of this.pendingResponses.values()) pending.reject(err)
        for (const pending of this.pendingResponseEnds) pending.reject(err)
        for (const pending of this.pendingDriveStats) pending.reject(err)
      }
    }
  }

  handleLspPayload(payload) {
    if (payload.method && Object.prototype.hasOwnProperty.call(payload, 'id')) {
      this.send({ jsonrpc: '2.0', id: payload.id, result: null })
      if (payload.method === 'agda' && payload.params?.tag === 'ResponseEnd') {
        const pending = this.pendingResponseEnds.shift()
        if (pending) pending.resolve(payload)
      }
      return
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'id')) {
      const pending = this.pendingResponses.get(payload.id)
      if (pending) {
        this.pendingResponses.delete(payload.id)
        pending.resolve(payload)
      }
    }
  }

  send(payload) {
    this.stdinWriter.write(encodeLspMessage(payload))
  }

  request(method, params) {
    const id = this.nextId++
    const payload = { jsonrpc: '2.0', id, method, params }
    const response = new Promise((resolve, reject) => {
      this.pendingResponses.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pendingResponses.delete(id)) {
          reject(new Error(`Timed out waiting for response ${id} (${method}). stderr=${this.stderr.join('')}`))
        }
      }, 60000)
    })
    this.send(payload)
    return response
  }

  createRequestPayload(method, params) {
    const id = this.nextId++
    const response = new Promise((resolve, reject) => {
      this.pendingResponses.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pendingResponses.delete(id)) {
          reject(new Error(`Timed out waiting for response ${id} (${method}). stderr=${this.stderr.join('')}`))
        }
      }, 60000)
    })
    return {
      id,
      response,
      bytes: encodeLspMessage({ jsonrpc: '2.0', id, method, params }),
    }
  }

  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, params })
  }

  waitForResponseEnd() {
    return new Promise((resolve, reject) => {
      this.pendingResponseEnds.push({ resolve, reject })
      setTimeout(() => reject(new Error('Timed out waiting for Agda ResponseEnd')), 120000)
    })
  }

  waitForDriveStats() {
    return new Promise((resolve, reject) => {
      this.pendingDriveStats.push({ resolve, reject })
      setTimeout(() => reject(new Error(`Timed out waiting for drive stats. stderr=${this.stderr.join('')}`)), 120000)
    })
  }

  async initialize(source) {
    await this.waitForReady()
    await this.request('initialize', {
      processId: null,
      rootUri: 'file:///',
      capabilities: {},
      workspaceFolders: null,
    })
    this.notify('initialized', {})
    await sleep(0)
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri: 'file:///source.agda',
        languageId: 'agda',
        version: 1,
        text: source,
      },
    })
    await sleep(0)
    this.notify('textDocument/didSave', {
      textDocument: { uri: 'file:///source.agda' },
    })
    await sleep(0)
  }

  async loadAgdaFile() {
    const loadCommand = 'IOTCM "/source.agda" NonInteractive Direct (Cmd_load "/source.agda" [])'
    const responseEnd = this.waitForResponseEnd()
    const driveStats = this.waitForDriveStats()
    const start = nowMs()
    const request = this.createRequestPayload('agda', { tag: 'CmdReq', contents: loadCommand })
    this.stdinWriter.write(request.bytes)
    const response = await request.response
    if (response.result?.contents != null) {
      throw new Error(`Cmd_load request failed: ${JSON.stringify(response.result)}`)
    }
    await responseEnd
    return {
      durationMs: durationSince(start),
      driveStats: await driveStats,
    }
  }

  async shutdown() {
    try {
      await this.request('shutdown', null)
      this.notify('exit', {})
    } catch {
      // The worker may already be terminating after exit; benchmark data is already collected.
    }
  }
}

function flattenResult({ runtime, fixture, setupMs, firstLoad, secondLoad }) {
  return {
    runtime,
    fixture,
    setupMs,
    firstLoadMs: firstLoad.durationMs,
    secondLoadMs: secondLoad.durationMs,
    firstLoad: {
      totalFsCalls: firstLoad.driveStats.totalCalls,
      methods: firstLoad.driveStats.methods,
      pathStatCount: firstLoad.driveStats.pathStatCount,
      agdaiRead: firstLoad.driveStats.agdaiRead,
      agdaiWrite: firstLoad.driveStats.agdaiWrite,
    },
    secondLoad: {
      totalFsCalls: secondLoad.driveStats.totalCalls,
      methods: secondLoad.driveStats.methods,
      pathStatCount: secondLoad.driveStats.pathStatCount,
      agdaiRead: secondLoad.driveStats.agdaiRead,
      agdaiWrite: secondLoad.driveStats.agdaiWrite,
    },
  }
}

async function runRunnoDirectFs(fixture, options = {}) {
  const source = await readFixture(experimentRoot, fixture)
  const stdinSab = new SharedArrayBuffer(1024 * 1024 + 8)
  const worker = new Worker(new URL('./runno-direct-worker.js', import.meta.url), {
    type: 'module',
    workerData: {
      stdinSab,
      source,
      wasmPath: join(appRoot, 'static', 'als-2.8ext.wasm'),
      stdlibZipPath: join(appRoot, 'static', 'agda-stdlib-2.3.zip'),
      cubicalZipPath: join(appRoot, 'static', 'agda-cubical-0.9.zip'),
      debug: options.debug,
    },
  })
  const session = new LspSession(worker, new DirectStdinWriter(stdinSab))
  session.debug = options.debug
  try {
    await session.initialize(source)
    const firstLoad = await session.loadAgdaFile()
    const secondLoad = await session.loadAgdaFile()
    await session.shutdown()
    await worker.terminate()
    return flattenResult({ runtime: 'runno-direct-fs', fixture, setupMs: session.setupMs, firstLoad, secondLoad })
  } catch (err) {
    await worker.terminate()
    throw err
  }
}

async function runBenchmark(runtime, fixture) {
  if (runtime !== 'runno-direct-fs') {
    throw new Error(`Runtime ${runtime} is not implemented. Available: runno-direct-fs`)
  }
  return runRunnoDirectFs(fixture, { debug: args.debug })
}

const args = parseArgs(process.argv.slice(2))
const fixtures = args.allFixtures ? fixtureNames : [args.fixture]
const results = []
for (const fixture of fixtures) {
  results.push(await runBenchmark(args.runtime, fixture))
}
console.log(JSON.stringify(args.allFixtures ? results : results[0], null, 2))
