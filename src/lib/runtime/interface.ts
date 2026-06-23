import type { SPSCReader } from 'spsc/reader'
import type { SPSCWriter } from 'spsc/writer'
import type { WASMLoadingProgress, PerformanceEntry, DriveProxyStats } from '$lib/worker/types'
import { asset } from '$app/paths'
import { DEPLOY_CONFIG } from '../../../deploy.config.mjs'
import { ALS_CATALOG } from '../../../file-server/als-catalog.mjs'
import { LIBRARY_CATALOG } from '../../../file-server/libraries.mjs'

// ── Deployment profiles ───────────────────────────────────────────────────────
//
// Which ALS/library combinations this deployment offers is configured in
// deploy.config.mjs, not hardcoded here. Each profile is a complete,
// ready-to-use combination (one ALS version + a compatible library set);
// there's no separate "ALS version" + "library set" pair of independent
// choices to keep in sync.

export { DEPLOY_CONFIG }
export const deployProfiles = DEPLOY_CONFIG.profiles
export type DeployProfile = (typeof deployProfiles)[number]

/** A library catalog entry resolved with its source/agdai zip asset URLs (via asset()). */
export interface ResolvedLibrary {
  name: string
  version: string
  libKey: string
  sourceZipAsset: string
  agdaiZipAsset?: string
  /** This library's own dependency-graph manifest (see file-server/dot-to-manifest.mjs). */
  manifestAsset: string
  /** folder name to extract this library under in the VFS, e.g. "stdlib" */
  folderName: string
  archiveRootPrefix: string
  includeSubpath: string
  agdaLibFile: string
  libraryName: string
  /** Agda interface-format version the prebuilt .agdai cache was built with, if any. */
  agdaiCacheVersion?: string
}

/** Resolves a profile's `libraries` references against file-server/libraries.mjs's catalog. */
export function resolveProfileLibraries(profile: DeployProfile): ResolvedLibrary[] {
  return profile.libraries.map(({ name, version }) => {
    const entry = LIBRARY_CATALOG.find(l => l.name === name && l.version === version)
    if (!entry) {
      throw new Error(`deploy.config.mjs profile "${profile.id}" references ${name}@${version} with no matching file-server/libraries.mjs entry`)
    }
    return {
      name: entry.name,
      version: entry.version,
      libKey: entry.libKey,
      sourceZipAsset: asset(`/library/${entry.sourceZipName}`),
      agdaiZipAsset: entry.agdaiZipName ? asset(`/library/${entry.agdaiZipName}`) : undefined,
      manifestAsset: asset(`/agdai/${entry.name}/agdai-manifest.json`),
      folderName: entry.name,
      archiveRootPrefix: entry.archiveRootPrefix,
      includeSubpath: entry.includeSubpath,
      agdaLibFile: entry.agdaLibFile,
      libraryName: entry.libraryName,
      agdaiCacheVersion: entry.agdaiCacheVersion,
    }
  })
}

// ── Agda version types and WASM manifest ─────────────────────────────────────
//
// Derived from the set of alsVersion values used across deployProfiles.

export const supportedAgdaVersions: readonly string[] =
  [...new Set(deployProfiles.map(p => p.alsVersion))]
export type SupportedAgdaVersion = string

interface AgdaVersionSpec {
  path: string
  /** zip archive to unpack to the initial drive; not needed since 2.8.0 (use --setup instead) */
  dataPath?: string
}

export const agdaVersionMap: Record<SupportedAgdaVersion, AgdaVersionSpec> = Object.create(null)
for (const version of supportedAgdaVersions) {
  const entry = ALS_CATALOG.find(e => e.version === version)
  if (!entry) {
    throw new Error(`deploy.config.mjs lists ALS version "${version}" with no matching file-server/als-catalog.mjs entry`)
  }
  agdaVersionMap[version] = {
    path: asset(`/als/${entry.wasmFilename}`),
    dataPath: entry.dataZipName ? asset(`/als/${entry.dataZipName}`) : undefined,
  }
}

export async function fetchWASMAndData(agdaVersion: SupportedAgdaVersion) {
  if (!(agdaVersion in agdaVersionMap)) {
    throw new Error(
      `version ${agdaVersion} not in list of supported versions: ${JSON.stringify(supportedAgdaVersions)}`)
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

// ── Drive handle ─────────────────────────────────────────────────────────────

export interface DriveHandle {
  lock: Int32Array<SharedArrayBuffer>
  stdinWriter: SPSCWriter
  stdoutReader: SPSCReader
}

// ── Backend interface ─────────────────────────────────────────────────────────

export interface BackendCallbacks {
  onWASMLoadingProgressChange(progress: WASMLoadingProgress | null): void
  onWASMLoaded(): void
  onVersionReceived(version: string): void
  onLibraryFetchProgress(fetched: number, total: number): void
  onDriveCreated(): void
  onPerformanceEntries(entries: PerformanceEntry[]): void
}

export interface BackendInitOptions {
  agdaVersion: SupportedAgdaVersion
  libraries: ResolvedLibrary[]
  agdaBuffers: { stdin: SharedArrayBuffer; stdout: SharedArrayBuffer }
  driveBuffers: { lock: SharedArrayBuffer; stdin: SharedArrayBuffer; stdout: SharedArrayBuffer }
  callbacks: BackendCallbacks
}

export interface LSPStreams {
  stdinWriter: SPSCWriter
  stdoutReader: SPSCReader
}

export interface RuntimeBackend {
  /** init() creates a MessageChannel internally; port2 is transferred to the ALS worker,
   *  port1 is returned so the controller can wire up the LSP transport. */
  init(options: BackendInitOptions): Promise<MessagePort>
  getLSPStreams(): LSPStreams
  getDriveHandle(): DriveHandle
  /** Reset agda SPSC buffers; must be called before run(). */
  resetBuffers(): void
  /** Start the WASM main loop; resolves with the exit code when WASM exits. */
  run(): Promise<number>
  syncSourceFile(doc: string): Promise<void>
  resetDriveProxyStats(): Promise<void>
  getDriveProxyStats(): Promise<DriveProxyStats>
  isInitialized(): boolean
  terminate(): void
  /** Fire-and-forget: fetch .agdai files into cache so they're ready when ALS requests them. */
  prefetchAgdai?(paths: string[]): void
}
