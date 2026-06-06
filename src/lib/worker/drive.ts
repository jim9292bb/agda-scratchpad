import * as Runno from '@runno/wasi'
import { SPSCReader } from 'spsc/reader'
import { SPSCWriter } from 'spsc/writer'
import JSZip from 'jszip'
import { fread, bufGetUint32LE, writeLenPrefixed, fwrite } from '$lib/stdlib'
import { createPerformanceTrace } from '$lib/performance'

import { uint8ArrayToBase64, base64ToUint8Array } from './util-base64'
import type { DriveWorkerInitObject } from './types'
import type { DriveProxyExtensionStats, DriveProxyPathStats, DriveProxyStats } from './types'

const now = new Date()

function createFileEntry(path: string, content: string | Uint8Array) {
  const obj = {
    path,
    timestamps: {
      access: now,
      change: now,
      modification: now,
    },
    mode: typeof content === 'string' ? 'string' : 'binary' as any,
    content,
  } as Runno.WASIFile
  return [path, obj] as const
}

function fsAssign(path: string, content: string | Uint8Array) {
  const [key, obj] = createFileEntry(path, content)
  fs[key] = obj
  return obj
}

const { stdin, stdout, agdaDataZip, agdaStdlibZip, agdaCubicalZip } = await new Promise<DriveWorkerInitObject>(r => {
  addEventListener('message', event => {
    r(event.data)
  }, { once: true })
})

const performanceTrace = createPerformanceTrace()

async function extractZip(data: ArrayBuffer, prefix = '', pathResolver?: (path: string) => string | null) {
  const zip = await JSZip.loadAsync(data)
  const filePromises: Promise<void>[] = []
  let files = 0

  if (prefix === '/') prefix = ''

  zip.forEach((_path, file) => {
    if (file.dir) return
    const path = pathResolver ? pathResolver(_path) : _path
    if (path == null) return
    files++
    filePromises.push(file.async('uint8array').then(content => {
      fsAssign(`${prefix}/${path}`, content)
    }))
  })

  await Promise.all(filePromises)
  return { files }
}

// TODO: make this changable dynamically
const userSourceFilePath = '/source.agda'

const fs: Record<string, Runno.WASIFile> = Object.fromEntries([
  createFileEntry(userSourceFilePath, ''),
])

if (agdaDataZip) {
  await performanceTrace.measure('Extract Agda builtins zip', () => extractZip(agdaDataZip, '/'), {
    bytes: agdaDataZip.byteLength,
  })
}

const agdaLibraries: string[] = []
const agdaDefaults: string[] = []

if (agdaStdlibZip) {
  await performanceTrace.measure('Extract standard-library zip', () => extractZip(agdaStdlibZip, '/stdlib', p => {
    if (!p.match(/^agda-stdlib-[\.\d]+\/src/) &&
        !p.match(/^agda-stdlib-[\.\d]+\/standard-library\.agda-lib$/)) {
      return null
    }
    return p.replace(/^agda-stdlib-[\.\d]+\//, '')
  }), { bytes: agdaStdlibZip.byteLength })
  agdaLibraries.push('/stdlib/standard-library.agda-lib')
  agdaDefaults.push('standard-library')
}

if (agdaCubicalZip) {
  await performanceTrace.measure('Extract Cubical zip', () => extractZip(agdaCubicalZip, '/cubical', p => {
    if (!p.startsWith('cubical-0.9/')) return null
    return p.replace(/^cubical-0\.9\//, '')
  }), { bytes: agdaCubicalZip.byteLength })
  agdaLibraries.push('/cubical/cubical.agda-lib')
  agdaDefaults.push('cubical-0.9')
}

if (agdaLibraries.length) {
  fsAssign('/home/root/.config/agda/libraries', `${agdaLibraries.join('\n')}\n`)
  fsAssign('/home/root/.config/agda/defaults', `${agdaDefaults.join('\n')}\n`)
}

postMessage({ type: 'fs-ready', performanceEntries: performanceTrace.entries })

const wasi = new Runno.WASI({ fs })
const drive = wasi.drive

// do the normalization the dirty way
function removeTrailingDotDots(path: string) {
  let dotdotCount = 0
  while (path.endsWith('/..')) {
    path = path.slice(0, -3)
    dotdotCount++
  }

  if (path === '..') {
    return '.'
  }

  for (let i = 0; i < dotdotCount; i++) {
    const lastSlash = path.lastIndexOf('/', path.length - 4)
    if (lastSlash < 0) {
      return '.'
    }
    path = path.slice(0, lastSlash)
  }

  return path
}

const origPathStat = drive.pathStat.bind(drive)
const ENABLE_DRIVE_PATH_STAT_CACHE = import.meta.env.VITE_ENABLE_DRIVE_PATH_STAT_CACHE === 'true'
const pathStatCache = new Map<string, ReturnType<typeof origPathStat>>()

function pathStatCacheKey(fdDir: number, path: string) {
  return `${fdDir}\0${path}`
}

function clearPathStatCache() {
  if (pathStatCache.size) pathStatCache.clear()
}

drive.pathStat = (fdDir: number, path: string) => {
  path = removeTrailingDotDots(path)
  if (!ENABLE_DRIVE_PATH_STAT_CACHE) return origPathStat(fdDir, path)

  const key = pathStatCacheKey(fdDir, path)
  const cached = pathStatCache.get(key)
  if (cached) return cached

  const result = origPathStat(fdDir, path)
  pathStatCache.set(key, result)
  return result
}

const origDriveOpen = drive.open.bind(drive)
drive.open = (fdDir: number, path: string, oflags: number, fdflags: number) =>
  origDriveOpen(fdDir, removeTrailingDotDots(path), oflags, fdflags)

const reader = new SPSCReader(stdin)
const writer = new SPSCWriter(stdout)

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const openFdPaths = new Map<number, string>()

function createDriveProxyExtensionStats(): DriveProxyExtensionStats {
  return {
    pathStat: 0,
    open: 0,
    read: 0,
    write: 0,
  }
}

function createDriveProxyStats(): DriveProxyStats {
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
    agda: createDriveProxyExtensionStats(),
    agdai: createDriveProxyExtensionStats(),
  }
}

let driveProxyStats: DriveProxyStats = createDriveProxyStats()

function snapshotAndResetDriveProxyStats() {
  const stats = driveProxyStats
  driveProxyStats = createDriveProxyStats()
  return stats
}

function normalizeDuration(durationMs: number) {
  return Math.round(durationMs * 1000) / 1000
}

function normalizeProfilePath(path: unknown) {
  return typeof path === 'string' ? removeTrailingDotDots(path) : null
}

function pathExtension(path: string) {
  if (path.endsWith('.agdai')) return 'agdai'
  if (path.endsWith('.agda')) return 'agda'
  return null
}

function recordPathStats(stats: Record<string, DriveProxyPathStats>, path: string | null, durationMs: number) {
  if (!path) return
  const current = stats[path] ?? { count: 0, durationMs: 0 }
  current.count++
  current.durationMs = normalizeDuration(current.durationMs + durationMs)
  stats[path] = current
}

function recordPathStatResult(path: string | null, res: any) {
  if (!path) return
  driveProxyStats.uniquePathStatPaths = Object.keys(driveProxyStats.pathStatPaths).length
  if (Array.isArray(res) && res[0] === 0) {
    driveProxyStats.pathStatSuccesses++
  } else {
    driveProxyStats.pathStatFailures++
  }
}

function recordExtensionPathOperation(path: string | null, operation: keyof DriveProxyExtensionStats) {
  if (!path) return
  const extension = pathExtension(path)
  if (!extension) return
  driveProxyStats[extension][operation]++
}

function recordExtensionFdOperation(fd: unknown, operation: keyof DriveProxyExtensionStats) {
  if (typeof fd !== 'number') return
  recordExtensionPathOperation(openFdPaths.get(fd) ?? null, operation)
}

function recordDriveProxyMethod(method: string, durationMs: number) {
  driveProxyStats.totalCalls++
  driveProxyStats.totalDurationMs = normalizeDuration(driveProxyStats.totalDurationMs + durationMs)
  driveProxyStats.methods[method] = (driveProxyStats.methods[method] ?? 0) + 1
  driveProxyStats.methodDurationsMs[method] = normalizeDuration((driveProxyStats.methodDurationsMs[method] ?? 0) + durationMs)
}

function getRequestPath(method: string, args: any[]) {
  if (method === 'pathStat' || method === 'open' || method === 'unlink' || method === 'pathCreateDir') {
    return normalizeProfilePath(args[1])
  }
  if (method === 'rename') {
    return normalizeProfilePath(args[1])
  }
  return null
}

function trackFdPathAfterResponse(method: string, args: any[], res: any) {
  const succeeded = Array.isArray(res) && res[0] === 0

  if (method === 'open') {
    const path = normalizeProfilePath(args[1])
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

function maybeInvalidatePathStatCache(method: string) {
  if (!ENABLE_DRIVE_PATH_STAT_CACHE) return
  if (
    method === 'open' ||
    method === 'write' ||
    method === 'pwrite' ||
    method === 'unlink' ||
    method === 'rename' ||
    method === 'pathCreateDir' ||
    method === 'pathSetAccessTime' ||
    method === 'pathSetModificationTime' ||
    method === 'setSize'
  ) {
    clearPathStatCache()
  }
}

async function mainLoop() {
  const driveProxy = drive as unknown as {[k: string]: (...args: any[]) => any}
  while (true) {
    const typeBuf = fread(reader, 4)
    const msgType = bufGetUint32LE(typeBuf)

    if (msgType === 1) {
      const lenBuf = fread(reader, 4)
      const data = fread(reader, bufGetUint32LE(lenBuf))
      drive.fs[userSourceFilePath].mode = 'binary'
      drive.fs[userSourceFilePath].content = data
      fwrite(writer, new Uint8Array([0]))
      continue
    } else if (msgType === 2) {
      console.warn('DUMP FS', drive.fs)
      fwrite(writer, new Uint8Array([0]))
      continue
    } else if (msgType === 3) {
      writeLenPrefixed(writer, encoder.encode(JSON.stringify(snapshotAndResetDriveProxyStats())))
      continue
    } else if (msgType !== 0) {
      throw new Error('Invalid msg type ' + msgType)
    }

    const lenBuf = fread(reader, 4)
    const data = fread(reader, bufGetUint32LE(lenBuf))
    const req: { method: string; args: any[] } = JSON.parse(decoder.decode(data))

    if (req.method === 'write' || req.method === 'pwrite') {
      req.args[1] = base64ToUint8Array(req.args[1])
    }
    // console.warn('DRIVE <--', req)
    const requestPath = getRequestPath(req.method, req.args)
    if ((req.method === 'write' || req.method === 'pwrite') && req.args[1] != null) {
      driveProxyStats.bytesWritten += req.args[1].byteLength
      recordExtensionFdOperation(req.args[0], 'write')
    }
    const methodStart = performance.now()
    let res = driveProxy[req.method](...req.args)
    const durationMs = normalizeDuration(performance.now() - methodStart)
    recordDriveProxyMethod(req.method, durationMs)
    if (req.method === 'pathStat') {
      recordPathStats(driveProxyStats.pathStatPaths, requestPath, durationMs)
      recordPathStatResult(requestPath, res)
      recordExtensionPathOperation(requestPath, 'pathStat')
    } else if (req.method === 'open') {
      recordPathStats(driveProxyStats.openPaths, requestPath, durationMs)
      recordExtensionPathOperation(requestPath, 'open')
    }
    trackFdPathAfterResponse(req.method, req.args, res)
    maybeInvalidatePathStatCache(req.method)
    // console.warn('DRIVE -->', res)
    if (req.method === 'read') {
      if (res[1] != null) driveProxyStats.bytesRead += res[1].byteLength
      recordExtensionFdOperation(req.args[0], 'read')
      if (res[1] != null) res[1] = uint8ArrayToBase64(res[1])
    } else if (req.method === 'pread') {
      if (res[1] != null) driveProxyStats.bytesRead += res[1].byteLength
      recordExtensionFdOperation(req.args[0], 'read')
      if (res[1] != null) res[1] = uint8ArrayToBase64(res[1])
    }
    writeLenPrefixed(writer, encoder.encode(JSON.stringify(res)))
  }
}

mainLoop()
