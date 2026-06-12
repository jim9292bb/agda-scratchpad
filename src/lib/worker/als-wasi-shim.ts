/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import * as Comlink from 'comlink'
import JSZip from 'jszip'
import {
  WASI,
  Fd,
  File,
  Directory,
  PreopenDirectory,
  ConsoleStdout,
  StdinBuffer,
  wasi as wasiDefs,
} from '@agda-web/browser_wasi_shim'
import { SPSC } from 'spsc'
import { SPSCWriter } from 'spsc/writer'
import type { WASMSource } from './types'

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
  stdlibZip: ArrayBuffer
  cubicalZip: ArrayBuffer
  dataZip?: ArrayBuffer
  stdlibAgdaiZip?: ArrayBuffer
  cubicalAgdaiZip?: ArrayBuffer
  agdaVersion: string
}

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

async function extractZip(
  root: Directory,
  bytes: ArrayBuffer,
  baseDir: string,
  pathResolver: (path: string) => string | null,
): Promise<void> {
  const zip = await JSZip.loadAsync(bytes)
  const tasks: Promise<void>[] = []
  zip.forEach((path, entry) => {
    if (entry.dir) return
    const resolved = pathResolver(path)
    if (resolved == null) return
    tasks.push(
      entry.async('uint8array').then(content => {
        writeFileTo(root, `${baseDir}/${resolved}`, content)
      }),
    )
  })
  await Promise.all(tasks)
}

async function buildFilesystem(opts: {
  stdlibZip: ArrayBuffer
  cubicalZip: ArrayBuffer
  dataZip?: ArrayBuffer
  stdlibAgdaiZip?: ArrayBuffer
  cubicalAgdaiZip?: ArrayBuffer
}): Promise<{ root: Directory; sourceFile: File }> {
  const root = new Directory(new Map())

  const sourceFile = writeFileTo(root, 'source.agda', enc.encode(''))

  // stdlib
  await extractZip(root, opts.stdlibZip, 'stdlib', path => {
    if (!path.match(/^agda-stdlib-[\d.]+\/src/) &&
        !path.match(/^agda-stdlib-[\d.]+\/standard-library\.agda-lib$/)) return null
    return path.replace(/^agda-stdlib-[\d.]+\//, '')
  })

  // pre-built stdlib .agdai cache (paths already relative to stdlib root)
  if (opts.stdlibAgdaiZip) {
    await extractZip(root, opts.stdlibAgdaiZip, 'stdlib', path => path)
  }

  // cubical
  await extractZip(root, opts.cubicalZip, 'cubical', path => {
    if (!path.match(/^cubical-[\d.]+\//)) return null
    return path.replace(/^cubical-[\d.]+\//, '')
  })

  // pre-built cubical .agdai cache (paths already relative to cubical root)
  if (opts.cubicalAgdaiZip) {
    await extractZip(root, opts.cubicalAgdaiZip, 'cubical', path => path)
  }

  // builtin data (old Agda versions)
  if (opts.dataZip) {
    await extractZip(root, opts.dataZip, '', path => path)
  }

  // library config files (for versions using --setup, these get overwritten by --setup)
  writeFileTo(root, 'home/root/.config/agda/libraries',
    enc.encode('stdlib/standard-library.agda-lib\ncubical/cubical.agda-lib\n'))
  writeFileTo(root, 'home/root/.config/agda/defaults',
    enc.encode('standard-library\ncubical-0.9\n'))

  return { root, sourceFile }
}

// ── Live source PreopenDirectory ──────────────────────────────────────────────

class LiveSourcePreopenDirectory extends PreopenDirectory {
  private _sourceFile: File
  private _sourceSab: SharedArrayBuffer

  constructor(name: string, contents: Map<string, any>, sourceFile: File, sourceSab: SharedArrayBuffer) {
    super(name, contents)
    this._sourceFile = sourceFile
    this._sourceSab = sourceSab
  }

  private _refreshSource(): void {
    const header = new Int32Array(this._sourceSab, 0, 1)
    const len = Atomics.load(header, 0)
    if (len > 0) {
      this._sourceFile.data = new Uint8Array(this._sourceSab, 4, len).slice()
    }
  }

  override path_open(
    dirflags: number,
    path_str: string,
    oflags: number,
    fs_rights_base: bigint,
    fs_rights_inheriting: bigint,
    fd_flags: number,
  ) {
    if (path_str === 'source.agda') this._refreshSource()
    return super.path_open(dirflags, path_str, oflags, fs_rights_base, fs_rights_inheriting, fd_flags)
  }

  override path_filestat_get(flags: number, path_str: string) {
    if (path_str === 'source.agda') this._refreshSource()
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
) {
  const stdinFd = new StdinBuffer(stdinSab)
  const stdoutFd = new SPSCStdoutFd(stdoutSab, stdinWaker)
  const stderrFd = ConsoleStdout.lineBuffered(msg => console.warn('ALS:', msg))
  const rootFd = new LiveSourcePreopenDirectory('/', root.contents, sourceFile, sourceSab)
  return new WASI(['als', '--raw'], env, [stdinFd, stdoutFd, stderrFd, rootFd])
}

function makeSpawnWasi(root: Directory, args: string[]) {
  const captured: string[] = []
  const spawnStdin = SPSC.allocateArrayBuffer(4096)
  const stdinFd = new StdinBuffer(spawnStdin)
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
  stdlibZip,
  cubicalZip,
  dataZip,
  stdlibAgdaiZip,
  cubicalAgdaiZip,
  agdaVersion,
}: WASIShimWorkerInitObject) {
  const [module, { root, sourceFile }] = await Promise.all([
    compileWasm(wasmSource),
    buildFilesystem({ stdlibZip, cubicalZip, dataZip, stdlibAgdaiZip, cubicalAgdaiZip }),
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
      const wasiInst = makeMainWasi(root, sourceFile, sourceSab, stdin, stdout, stdinWaker)
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
