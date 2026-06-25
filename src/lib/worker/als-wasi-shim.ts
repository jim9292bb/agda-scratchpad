/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import * as Comlink from 'comlink'
import {
  WASI,
  Fd,
  File,
  Directory,
  PreopenDirectory,
  ConsoleStdout,
  ReadablePipe,
  wasi as wasiDefs,
} from '@agda-web/browser_wasi_shim'
import { SPSC } from 'spsc'
import { SPSCWriter } from 'spsc/writer'
import type { WASMSource, LibraryToLoad } from './types'

export {}

if (!crossOriginIsolated) {
  throw new Error('The worker should be run in a COI context.')
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface WASIShimWorkerInitObject {
  wasmSource: WASMSource
  stdinWaker: MessagePort
  stdin: SharedArrayBuffer
  stdout: SharedArrayBuffer
  sourceSab: SharedArrayBuffer
  libraries: LibraryToLoad[]
  dataZip: ArrayBuffer
  /** SharedArrayBuffer for on-demand .agdai network fetch via Atomics bridge */
  agdaiFetchSab?: SharedArrayBuffer
  agdaVersion: string
}

// SAB layout for on-demand .agdai fetch (must match browser-wasi-shim.ts)
const AGDAI_SAB_PATH_OFFSET = 16       // 4 int32 header slots × 4 bytes
const AGDAI_SAB_PATH_MAX = 4096
const AGDAI_SAB_CONTENT_OFFSET = AGDAI_SAB_PATH_OFFSET + AGDAI_SAB_PATH_MAX  // 4112

// ── WASM compilation ─────────────────────────────────────────────────────────

async function compileWasm(source: WASMSource): Promise<WebAssembly.Module> {
  if (source.type === 'url') {
    return WebAssembly.compile(await fetch(source.url).then(x => x.arrayBuffer()))
  }
  return WebAssembly.compileStreaming(new Response(source.stream, {
    headers: { 'Content-Type': 'application/wasm' },
  }))
}

// ── Filesystem utilities ──────────────────────────────────────────────────────

const enc = new TextEncoder()

function ensureDir(root: Directory, relPath: string): Directory {
  const parts = relPath.split('/').filter(Boolean)
  let dir = root
  for (const part of parts) {
    let child = dir.contents.get(part)
    if (!child) {
      child = new Directory(new Map())
      ;(child as any).parent = dir
      dir.contents.set(part, child)
    } else if (!(child instanceof Directory)) {
      throw new Error(`Path component '${part}' is not a directory`)
    }
    dir = child as Directory
  }
  return dir
}

function writeFileTo(root: Directory, relPath: string, bytes: Uint8Array, readonly = false): File {
  const parts = relPath.split('/').filter(Boolean)
  const name = parts.pop()!
  const dir = ensureDir(root, parts.join('/'))
  const file = new File(bytes, { readonly })
  ;(file as any).parent = dir
  dir.contents.set(name, file)
  return file
}

async function extractZipFast(
  root: Directory,
  buf: ArrayBuffer,
  baseDir: string,
  pathResolver: (path: string) => string | null,
): Promise<void> {
  const bytes = new Uint8Array(buf)
  const view = new DataView(buf)
  const dec = new TextDecoder()

  // Scan backwards for EOCD signature (0x06054b50); ZIP comment can be up to 65535 bytes
  let eocdOffset = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break }
  }
  if (eocdOffset < 0) throw new Error('ZIP: EOCD not found')

  const cdOffset = view.getUint32(eocdOffset + 16, true)
  const cdSize = view.getUint32(eocdOffset + 12, true)

  const tasks: Promise<void>[] = []
  let pos = cdOffset

  while (pos < cdOffset + cdSize) {
    if (view.getUint32(pos, true) !== 0x02014b50) break // central dir file header

    const method = view.getUint16(pos + 10, true)
    const compSize = view.getUint32(pos + 20, true)
    const fnLen = view.getUint16(pos + 28, true)
    const extraLen = view.getUint16(pos + 30, true)
    const commentLen = view.getUint16(pos + 32, true)
    const localOffset = view.getUint32(pos + 42, true)
    const name = dec.decode(bytes.subarray(pos + 46, pos + 46 + fnLen))
    pos += 46 + fnLen + extraLen + commentLen

    if (name.endsWith('/')) continue
    const resolved = pathResolver(name)
    if (resolved == null) continue

    const fullPath = baseDir ? `${baseDir}/${resolved}` : resolved
    const lOff = localOffset, cSize = compSize, meth = method

    tasks.push((async () => {
      // Read local file header to find actual data start
      const localFnLen = view.getUint16(lOff + 26, true)
      const localExtraLen = view.getUint16(lOff + 28, true)
      const dataStart = lOff + 30 + localFnLen + localExtraLen
      const compData = bytes.subarray(dataStart, dataStart + cSize)

      let content: Uint8Array
      if (meth === 0) {
        content = compData.slice() // STORE
      } else {
        // DEFLATE — use native DecompressionStream (C++ speed, no JS decompressor)
        const ds = new DecompressionStream('deflate-raw')
        const writer = ds.writable.getWriter()
        const reader = ds.readable.getReader()
        writer.write(compData)
        writer.close()
        const chunks: Uint8Array[] = []
        let totalLen = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          totalLen += value.byteLength
        }
        content = new Uint8Array(totalLen)
        let off = 0
        for (const c of chunks) { content.set(c, off); off += c.byteLength }
      }
      writeFileTo(root, fullPath, content)
    })())
  }

  await Promise.all(tasks)
}

async function buildFilesystem(opts: {
  libraries: LibraryToLoad[]
  dataZip: ArrayBuffer
}): Promise<{ root: Directory; sourceFile: File }> {
  const root = new Directory(new Map())

  const sourceFile = writeFileTo(root, 'source.agda', enc.encode(''))

  // All extractions are independent (different VFS dirs) — run in parallel
  const tasks: Promise<void>[] = []
  for (const lib of opts.libraries) {
    tasks.push(extractZipFast(root, lib.zip, lib.folderName, path => {
      if (!path.startsWith(`${lib.archiveRootPrefix}/`)) return null
      const rel = path.slice(lib.archiveRootPrefix.length + 1)
      if (!lib.includeSubpath) return rel  // `include: .` — keep everything
      if (rel.startsWith(`${lib.includeSubpath}/`) || rel === lib.agdaLibFile) return rel
      return null
    }))
    if (lib.agdaiZip) {
      tasks.push(extractZipFast(root, lib.agdaiZip, lib.folderName, path => path))
    }
  }
  tasks.push(extractZipFast(root, opts.dataZip, '', path => path))
  await Promise.all(tasks)

  // library config files (for versions using --setup, these get overwritten by --setup)
  writeFileTo(root, 'home/root/.config/agda/libraries',
    enc.encode(opts.libraries.map(lib => `${lib.folderName}/${lib.agdaLibFile}\n`).join('')))
  writeFileTo(root, 'home/root/.config/agda/defaults',
    enc.encode(opts.libraries.map(lib => `${lib.libraryName}\n`).join('')))

  return { root, sourceFile }
}

// ── Live source PreopenDirectory ──────────────────────────────────────────────

class LiveSourcePreopenDirectory extends PreopenDirectory {
  private _sourceFile: File
  private _sourceSab: SharedArrayBuffer
  private _agdaiFetchSab: SharedArrayBuffer | undefined
  private _agdaiRoot: Directory
  private _agdaiFetched = new Set<string>()
  private readonly _pathEnc = new TextEncoder()

  constructor(
    name: string,
    root: Directory,
    sourceFile: File,
    sourceSab: SharedArrayBuffer,
    agdaiFetchSab?: SharedArrayBuffer,
  ) {
    super(name, root.contents)
    this._sourceFile = sourceFile
    this._sourceSab = sourceSab
    this._agdaiFetchSab = agdaiFetchSab
    this._agdaiRoot = root
  }

  private _refreshSource(): void {
    const header = new Int32Array(this._sourceSab, 0, 1)
    const len = Atomics.load(header, 0)
    if (len > 0) {
      this._sourceFile.data = new Uint8Array(this._sourceSab, 4, len).slice()
    }
  }

  private _ensureAgdai(path_str: string): void {
    if (!this._agdaiFetchSab) return
    if (!path_str.endsWith('.agdai')) return
    if (this._agdaiFetched.has(path_str)) return
    // Only fetch paths under a library's _build/ interface-cache tree (the
    // layout produced by `--build-library`, served from static/agdai/<lib>/).
    // Any other library folder's path is checked the same way — lib/prim,
    // source.agdai, and short-path probes (e.g. stdlib/src/...) never match
    // and would just 404 the network fetch.
    if (!path_str.includes('/_build/')) return

    this._agdaiFetched.add(path_str)  // mark before fetch to avoid retry on NOENT
    const content = this._fetchAgdaiSync(path_str)
    if (content) writeFileTo(this._agdaiRoot, path_str, content)
  }

  private _fetchAgdaiSync(path: string): Uint8Array | null {
    const sab = this._agdaiFetchSab!
    const ctrl = new Int32Array(sab)
    const pathBytes = this._pathEnc.encode(path)
    if (pathBytes.length > AGDAI_SAB_PATH_MAX) return null

    new Uint8Array(sab, AGDAI_SAB_PATH_OFFSET, pathBytes.length).set(pathBytes)
    Atomics.store(ctrl, 1, pathBytes.length)
    Atomics.store(ctrl, 0, 1)   // request
    Atomics.notify(ctrl, 0)
    // Block until main thread writes response (status becomes 2)
    Atomics.wait(ctrl, 0, 1)
    const status = Atomics.load(ctrl, 2)
    if (status !== 0) { Atomics.store(ctrl, 0, 0); return null }
    const len = Atomics.load(ctrl, 3)
    const content = new Uint8Array(sab, AGDAI_SAB_CONTENT_OFFSET, len).slice()
    Atomics.store(ctrl, 0, 0)   // idle
    return content
  }

  override path_open(
    dirflags: number,
    path_str: string,
    oflags: number,
    fs_rights_base: bigint,
    fs_rights_inheriting: bigint,
    fd_flags: number,
  ) {
    if (path_str === 'source.agda') {
      this._refreshSource()
    } else if (path_str.endsWith('.agdai')) {
      // Skip network fetch for O_CREAT (ALS writing a newly compiled file)
      const isWrite = (oflags & 1 /* OFLAGS_CREAT */) !== 0
      if (!isWrite && !this._agdaiFetched.has(path_str)) {
        // Check VFS first — files already there (e.g. lib/prim from --setup) need no fetch
        const probe = super.path_open(dirflags, path_str, oflags, fs_rights_base, fs_rights_inheriting, fd_flags)
        if (probe.ret === 0) return probe
        this._ensureAgdai(path_str)
      }
    }
    return super.path_open(dirflags, path_str, oflags, fs_rights_base, fs_rights_inheriting, fd_flags)
  }

  override path_filestat_get(flags: number, path_str: string) {
    if (path_str === 'source.agda') {
      this._refreshSource()
    } else if (path_str.endsWith('.agdai') && !this._agdaiFetched.has(path_str)) {
      // Check VFS first — avoids spurious fetches for files already present
      const probe = super.path_filestat_get(flags, path_str)
      if (probe.ret === 0) return probe
      this._ensureAgdai(path_str)
    }
    return super.path_filestat_get(flags, path_str)
  }
}

// ── SPSC stdout Fd ────────────────────────────────────────────────────────────

class SPSCStdoutFd extends Fd {
  private _writer: SPSCWriter

  constructor(stdout: SharedArrayBuffer, stdinWaker: MessagePort) {
    super()
    this._writer = new SPSCWriter(stdout, stdinWaker)
  }

  fd_fdstat_get() {
    const fdstat = new wasiDefs.Fdstat(wasiDefs.FILETYPE_CHARACTER_DEVICE, 0)
    fdstat.fs_rights_base = BigInt(wasiDefs.RIGHTS_FD_WRITE)
    return { ret: 0, fdstat }
  }

  fd_filestat_get() {
    return {
      ret: 0,
      filestat: new wasiDefs.Filestat(0n, wasiDefs.FILETYPE_CHARACTER_DEVICE, BigInt(0)),
    }
  }

  fd_write(data: Uint8Array): { ret: number; nwritten: number } {
    const result = this._writer.write(data)
    if (!result.ok) {
      return { ret: wasiDefs.ERRNO_IO, nwritten: 0 }
    }
    return { ret: 0, nwritten: result.bytesWritten }
  }
}

// ── WASI factory ─────────────────────────────────────────────────────────────

const env = ['HOME=/home/root', 'Agda_datadir=/']

function makeMainWasi(
  root: Directory,
  sourceFile: File,
  sourceSab: SharedArrayBuffer,
  stdinSab: SharedArrayBuffer,
  stdoutSab: SharedArrayBuffer,
  stdinWaker: MessagePort,
  agdaiFetchSab?: SharedArrayBuffer,
) {
  const stdinFd = new ReadablePipe(stdinSab)
  const stdoutFd = new SPSCStdoutFd(stdoutSab, stdinWaker)
  const stderrFd = ConsoleStdout.lineBuffered(msg => console.warn('ALS:', msg))
  const rootFd = new LiveSourcePreopenDirectory('/', root, sourceFile, sourceSab, agdaiFetchSab)
  return new WASI(['als', '--raw'], env, [stdinFd, stdoutFd, stderrFd, rootFd])
}

function makeSpawnWasi(root: Directory, args: string[]) {
  const captured: string[] = []
  const spawnStdin = SPSC.allocateArrayBuffer(4096)
  const stdinFd = new ReadablePipe(spawnStdin)
  const stdoutFd = ConsoleStdout.lineBuffered(line => captured.push(line + '\n'))
  const stderrFd = ConsoleStdout.lineBuffered(msg => console.warn('ALS spawn:', msg))
  const rootFd = new PreopenDirectory('/', root.contents)
  const wasiInst = new WASI(['als', ...args], env, [stdinFd, stdoutFd, stderrFd, rootFd])
  return { wasiInst, captured }
}

// ── Worker init ───────────────────────────────────────────────────────────────

async function init({
  wasmSource,
  stdinWaker,
  stdin,
  stdout,
  sourceSab,
  libraries,
  dataZip,
  agdaiFetchSab,
  agdaVersion,
}: WASIShimWorkerInitObject) {
  const [module, { root, sourceFile }] = await Promise.all([
    compileWasm(wasmSource),
    buildFilesystem({ libraries, dataZip }),
  ])

  if (agdaVersion === '2.8.0') {
    const { wasiInst } = makeSpawnWasi(root, ['--setup'])
    const setupInstance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasiInst.wasiImport })
    const exitCode = wasiInst.start(setupInstance)
    if (exitCode !== 0) {
      throw new Error(`als --setup exited with code ${exitCode}`)
    }
  }

  let cachedVersion: string | null = null

  return Comlink.proxy({
    getALSVersion: async () => {
      if (cachedVersion) return cachedVersion
      const { wasiInst, captured } = makeSpawnWasi(root, ['--version'])
      const versionInstance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasiInst.wasiImport })
      wasiInst.start(versionInstance)
      cachedVersion = captured.join('').trim()
      return cachedVersion
    },

    start: async (): Promise<number> => {
      const wasiInst = makeMainWasi(root, sourceFile, sourceSab, stdin, stdout, stdinWaker, agdaiFetchSab)
      const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasiInst.wasiImport })
      return wasiInst.start(instance)
    },

    spawn: async (args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
      const { wasiInst, captured } = makeSpawnWasi(root, args)
      const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasiInst.wasiImport })
      const exitCode = wasiInst.start(instance)
      return { exitCode, stdout: captured.join(''), stderr: '' }
    },
  })
}

Comlink.expose({ init })
