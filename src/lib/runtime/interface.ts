import type { SPSCReader } from 'spsc/reader'
import type { SPSCWriter } from 'spsc/writer'
import type { WASMLoadingProgress, PerformanceEntry, DriveProxyStats } from '$lib/worker/types'
import { asset } from '$app/paths'
import DEPLOY_CONFIG from '../../../deploy.config.json'
import { GENERATED_LIBRARY_INFO } from '../../../deploy-assets/generated-libraries.mjs'

// Always this — not a per-version field, since unlike wasmFilename (which
// must stay distinct per version if ever bundled together), every
// version's agda-data.zip already lives under its own static/als/<version>/,
// so there's no collision to avoid naming around. Also referenced
// (independently, must match) by deploy-assets/build-static-assets.mjs.
const AGDA_DATA_ZIP_NAME = 'agda-data.zip'

// ── Deployment profiles ───────────────────────────────────────────────────────
//
// Which ALS/library combinations this deployment offers is configured in
// deploy.config.json, not hardcoded here. Each profile is a complete,
// ready-to-use combination (one ALS version + a compatible library set);
// there's no separate "ALS version" + "library set" pair of independent
// choices to keep in sync. See deploy-assets/README.md "Adding a library
// or ALS version" for the field docs (deploy.config.json is plain JSON,
// no comment syntax to carry them inline).

export { DEPLOY_CONFIG }
export const deployProfiles = DEPLOY_CONFIG.profiles
export type DeployProfile = (typeof deployProfiles)[number]

/**
 * A library reference resolved with its asset URLs and the
 * includeSubpath/libraryName generated from its real `.agda-lib` content
 * (deploy-assets/generated-libraries.mjs — see
 * deploy-assets/generate-library-info.mjs).
 */
export interface ResolvedLibrary {
  /** The .agda-lib `name:` value — this library's identity for every
   *  internal purpose (cache key, static-asset paths, VFS folder name). */
  name: string
  /** Cosmetic only (shown in the UI). */
  label?: string
  /** Cosmetic only (shown in the UI). */
  version?: string
  /** In-memory identifier for the prefetch manifest cache — equals name. */
  libKey: string
  sourceZipAsset: string
  /** This library's own dependency-graph manifest. */
  manifestAsset: string
  archiveRootPrefix: string
  includeSubpath: string
  agdaLibFile: string
  libraryName: string
}

/** Resolves a profile's `libraries` references against deploy-assets/generated-libraries.mjs. */
export function resolveProfileLibraries(profile: DeployProfile): ResolvedLibrary[] {
  const seenRaw = new Map<string, DeployProfile['libraries'][number]>()
  const resolved: ResolvedLibrary[] = []
  for (const lib of profile.libraries) {
    const prevRaw = seenRaw.get(lib.name)
    if (prevRaw && JSON.stringify(prevRaw) !== JSON.stringify(lib)) {
      throw new Error(`deploy.config.json profile "${profile.id}" references library "${lib.name}" with two different specs (${JSON.stringify(prevRaw)} vs ${JSON.stringify(lib)}) — every reference to the same library name must describe the same library.`)
    }
    if (prevRaw) continue
    seenRaw.set(lib.name, lib)

    const info = GENERATED_LIBRARY_INFO[lib.name as keyof typeof GENERATED_LIBRARY_INFO]
    if (!info) {
      throw new Error(`deploy.config.json profile "${profile.id}" references library "${lib.name}" with no matching entry in deploy-assets/generated-libraries.mjs — run \`npm run setup\` after configuring deploy.local.json.`)
    }
    resolved.push({
      name: lib.name,
      label: lib.label,
      version: lib.version,
      libKey: lib.name,
      sourceZipAsset: asset(`/library/${lib.name}.zip`),
      manifestAsset: asset(`/agdai/${lib.name}/agdai-manifest.json`),
      archiveRootPrefix: lib.name,
      includeSubpath: info.includeSubpath,
      agdaLibFile: info.agdaLibFilename,
      libraryName: info.libraryName,
    })
  }

  // Every resolved library gets registered with Agda together (see
  // src/lib/worker/als-wasi-shim.ts's libraries/defaults config files);
  // if two of them declare the same libraryName, Agda's depend:
  // resolution between them becomes ambiguous.
  const seenBy = new Map<string, string>()
  for (const lib of resolved) {
    const prevLibKey = seenBy.get(lib.libraryName)
    if (prevLibKey) {
      throw new Error(`deploy.config.json profile "${profile.id}" selects two libraries with the same libraryName "${lib.libraryName}" (${prevLibKey} and ${lib.libKey}) — Agda's depend: resolution between them would be ambiguous`)
    }
    seenBy.set(lib.libraryName, lib.libKey)
  }

  return resolved
}

// Validated eagerly for every configured profile (not just the active
// one) so a conflict fails at build/dev time, matching agdaVersionMap's
// construction below.
for (const profile of deployProfiles) {
  resolveProfileLibraries(profile)
}

// ── Agda version types and WASM manifest ─────────────────────────────────────
//
// Derived from the set of alsVersion values used across deployProfiles. No
// separate ALS catalog to cross-reference any more — each profile's own
// alsVersion+wasmFilename are already everything needed.

export const supportedAgdaVersions: readonly string[] =
  [...new Set(deployProfiles.map(p => p.alsVersion))]
export type SupportedAgdaVersion = string

interface AgdaVersionSpec {
  path: string
  dataPath: string
}

// Throws if the same alsVersion is referenced more than once with a
// different wasmFilename — that would mean two different ALS builds are
// trying to claim the same version number.
export const agdaVersionMap: Record<SupportedAgdaVersion, AgdaVersionSpec> = Object.create(null)
const seenWasmFilenameByVersion = new Map<string, string>()
for (const profile of deployProfiles) {
  const { alsVersion, wasmFilename } = profile
  const prevWasmFilename = seenWasmFilenameByVersion.get(alsVersion)
  if (prevWasmFilename && prevWasmFilename !== wasmFilename) {
    throw new Error(`deploy.config.json: alsVersion "${alsVersion}" is referenced with two different wasmFilename values (${prevWasmFilename} vs ${wasmFilename}) — every reference to the same alsVersion must describe the same ALS build.`)
  }
  if (prevWasmFilename) continue
  seenWasmFilenameByVersion.set(alsVersion, wasmFilename)
  agdaVersionMap[alsVersion] = {
    path: asset(`/als/${alsVersion}/${wasmFilename}`),
    dataPath: asset(`/als/${alsVersion}/${AGDA_DATA_ZIP_NAME}`),
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

  const dataFile = await fetch(dataPath)
  if (!dataFile.ok || dataFile.status >= 400) {
    throw new Error(`failed to fetch data file: ${dataFile.statusText}`)
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
  /** Bare numeric Agda version (`agda --numeric-version`, e.g. "2.8.0") — used
   *  to build the prefetch .agdai cache path (replaces the old hand-maintained
   *  agdaiCacheVersion catalog field; see src/lib/agda/prefetch.js). */
  onNumericAgdaVersionReceived(version: string): void
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
