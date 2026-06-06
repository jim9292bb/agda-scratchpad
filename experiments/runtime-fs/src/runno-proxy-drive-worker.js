import { parentPort, workerData } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import * as Runno from '@runno/wasi'
import JSZip from 'jszip'
import { SPSCReader } from 'spsc/reader'
import { SPSCWriter } from 'spsc/writer'
import {
  base64ToUint8Array,
  bufGetUint32LE,
  fread,
  fwrite,
  uint8ArrayToBase64,
  writeLenPrefixed,
} from './spsc-utils.js'

const now = new Date()
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const sourceFilePath = '/source.agda'

function createFileEntry(path, content) {
  return [path, {
    path,
    timestamps: { access: now, change: now, modification: now },
    mode: typeof content === 'string' ? 'string' : 'binary',
    content,
  }]
}

function fsAssign(fs, path, content) {
  const [key, obj] = createFileEntry(path, content)
  fs[key] = obj
  return obj
}

async function extractZip(fs, data, prefix = '', pathResolver = path => path) {
  const zip = await JSZip.loadAsync(data)
  const files = []
  zip.forEach((path, file) => {
    if (file.dir) return
    const resolved = pathResolver(path)
    if (resolved == null) return
    files.push(file.async('uint8array').then(content => {
      fsAssign(fs, `${prefix}/${resolved}`, content)
    }))
  })
  await Promise.all(files)
  return files.length
}

function removeTrailingDotDots(path) {
  let dotdotCount = 0
  while (path.endsWith('/..')) {
    path = path.slice(0, -3)
    dotdotCount++
  }
  if (path === '..') return '.'
  for (let i = 0; i < dotdotCount; i++) {
    const lastSlash = path.lastIndexOf('/', path.length - 4)
    if (lastSlash < 0) return '.'
    path = path.slice(0, lastSlash)
  }
  return path
}

function createExtensionStats() {
  return { pathStat: 0, open: 0, read: 0, write: 0 }
}

function createStats() {
  return {
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
    agda: createExtensionStats(),
    agdai: createExtensionStats(),
  }
}

let stats = createStats()
const openFdPaths = new Map()

function normalizeDuration(durationMs) {
  return Math.round(durationMs * 1000) / 1000
}

function snapshotAndResetStats() {
  const result = stats
  stats = createStats()
  return result
}

function normalizePath(path) {
  return typeof path === 'string' ? removeTrailingDotDots(path) : null
}

function pathExtension(path) {
  if (path.endsWith('.agdai')) return 'agdai'
  if (path.endsWith('.agda')) return 'agda'
  return null
}

function recordPathStats(bucket, path, durationMs) {
  if (!path) return
  const current = bucket[path] ?? { count: 0, durationMs: 0 }
  current.count++
  current.durationMs = normalizeDuration(current.durationMs + durationMs)
  bucket[path] = current
}

function recordExtensionPathOperation(path, operation) {
  if (!path) return
  const extension = pathExtension(path)
  if (!extension) return
  stats[extension][operation]++
}

function recordExtensionFdOperation(fd, operation) {
  if (typeof fd !== 'number') return
  recordExtensionPathOperation(openFdPaths.get(fd) ?? null, operation)
}

function requestPath(method, args) {
  if (method === 'pathStat' || method === 'open' || method === 'unlink' || method === 'pathCreateDir') {
    return normalizePath(args[1])
  }
  if (method === 'rename') return normalizePath(args[1])
  return null
}

function trackFdPathAfterResponse(method, args, res) {
  const succeeded = Array.isArray(res) && res[0] === 0
  if (method === 'open') {
    const path = normalizePath(args[1])
    const fd = Array.isArray(res) ? res[1] : null
    if (succeeded && path && typeof fd === 'number') openFdPaths.set(fd, path)
    return
  }
  if (succeeded && method === 'close' && typeof args[0] === 'number') {
    openFdPaths.delete(args[0])
    return
  }
  if (succeeded && method === 'renumber' && typeof args[0] === 'number' && typeof args[1] === 'number') {
    const path = openFdPaths.get(args[0])
    if (!path) return
    openFdPaths.delete(args[0])
    openFdPaths.set(args[1], path)
  }
}

function fixStatCommon(result) {
  if (Array.isArray(result) && result.length > 1 && result[1]?.timestamps) {
    const file = result[1]
    file.timestamps.access = new Date(file.timestamps.access)
    file.timestamps.change = new Date(file.timestamps.change)
    file.timestamps.modification = new Date(file.timestamps.modification)
  }
  return result
}

const fs = Object.fromEntries([
  createFileEntry(sourceFilePath, ''),
])

const stdlibZip = await readFile(workerData.stdlibZipPath)
const cubicalZip = await readFile(workerData.cubicalZipPath)

const extractionStart = performance.now()
const stdlibFiles = await extractZip(fs, stdlibZip, '/stdlib', path => {
  if (!path.match(/^agda-stdlib-[\.\d]+\/src/) &&
      !path.match(/^agda-stdlib-[\.\d]+\/standard-library\.agda-lib$/)) {
    return null
  }
  return path.replace(/^agda-stdlib-[\.\d]+\//, '')
})
const cubicalFiles = await extractZip(fs, cubicalZip, '/cubical', path => {
  if (!path.startsWith('cubical-0.9/')) return null
  return path.replace(/^cubical-0\.9\//, '')
})

fsAssign(fs, '/home/root/.config/agda/libraries', '/stdlib/standard-library.agda-lib\n/cubical/cubical.agda-lib\n')
fsAssign(fs, '/home/root/.config/agda/defaults', 'standard-library\ncubical-0.9\n')

const wasi = new Runno.WASI({ fs })
const drive = wasi.drive
const origPathStat = drive.pathStat.bind(drive)
drive.pathStat = (fdDir, path) => origPathStat(fdDir, removeTrailingDotDots(path))
const origOpen = drive.open.bind(drive)
drive.open = (fdDir, path, oflags, fdflags) => origOpen(fdDir, removeTrailingDotDots(path), oflags, fdflags)

const reader = new SPSCReader(workerData.stdin)
const writer = new SPSCWriter(workerData.stdout)
parentPort.postMessage({
  type: 'ready',
  extractionMs: normalizeDuration(performance.now() - extractionStart),
  stdlibFiles,
  cubicalFiles,
})

while (true) {
  const msgType = bufGetUint32LE(fread(reader, 4))

  if (msgType === 1) {
    const payloadLength = bufGetUint32LE(fread(reader, 4))
    const data = fread(reader, payloadLength)
    drive.fs[sourceFilePath].mode = 'binary'
    drive.fs[sourceFilePath].content = data
    fwrite(writer, new Uint8Array([0]))
    continue
  }

  if (msgType === 3) {
    writeLenPrefixed(writer, encoder.encode(JSON.stringify(snapshotAndResetStats())))
    continue
  }

  if (msgType !== 0) {
    throw new Error(`Invalid drive message type: ${msgType}`)
  }

  const payloadLength = bufGetUint32LE(fread(reader, 4))
  const req = JSON.parse(decoder.decode(fread(reader, payloadLength)))
  if (req.method === 'write' || req.method === 'pwrite') {
    req.args[1] = base64ToUint8Array(req.args[1])
  }

  const path = requestPath(req.method, req.args)
  if ((req.method === 'write' || req.method === 'pwrite') && req.args[1] != null) {
    stats.bytesWritten += req.args[1].byteLength
    recordExtensionFdOperation(req.args[0], 'write')
  }

  const start = performance.now()
  let res = drive[req.method](...req.args)
  const durationMs = normalizeDuration(performance.now() - start)
  stats.totalCalls++
  stats.totalDurationMs = normalizeDuration(stats.totalDurationMs + durationMs)
  stats.methods[req.method] = (stats.methods[req.method] ?? 0) + 1
  stats.methodDurationsMs[req.method] = normalizeDuration((stats.methodDurationsMs[req.method] ?? 0) + durationMs)

  if (req.method === 'pathStat') {
    recordPathStats(stats.pathStatPaths, path, durationMs)
    stats.uniquePathStatPaths = Object.keys(stats.pathStatPaths).length
    if (Array.isArray(res) && res[0] === 0) stats.pathStatSuccesses++
    else stats.pathStatFailures++
    recordExtensionPathOperation(path, 'pathStat')
  } else if (req.method === 'open') {
    recordPathStats(stats.openPaths, path, durationMs)
    recordExtensionPathOperation(path, 'open')
  }

  trackFdPathAfterResponse(req.method, req.args, res)

  if (req.method === 'pathStat' || req.method === 'stat') {
    res = fixStatCommon(res)
  } else if (req.method === 'read' || req.method === 'pread') {
    if (res[1] != null) stats.bytesRead += res[1].byteLength
    recordExtensionFdOperation(req.args[0], 'read')
    if (res[1] != null) res[1] = uint8ArrayToBase64(res[1])
  }

  writeLenPrefixed(writer, encoder.encode(JSON.stringify(res)))
}
