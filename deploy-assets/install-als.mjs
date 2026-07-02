/**
 * Sets up an ALS WASM build for deployment — no native agda required.
 *
 * 1. Detects Agda version via `als --version`
 * 2. Downloads agda-data source (lib/prim/) from Hackage
 * 3. Compiles all builtin .agda files via `als --raw` + LSP Cmd_load
 * 4. Installs agda-data/ and the .wasm file into deploy-assets/als/<version>/
 *
 * Usage:
 *   node deploy-assets/install-als.mjs <path-to-als.wasm> [--force]
 *
 * --force overwrites an existing deploy-assets/als/<version>/ directory.
 */

import { writeFile, mkdir, cp, rm, mkdtemp, access, readdir } from 'node:fs/promises'
import { dirname, join, basename, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { REPO_ROOT } from './resolve-deploy-config.mjs'

const DEPLOY_ASSETS = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const args = { wasmPath: null, force: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--force') args.force = true
    else if (!args.wasmPath) args.wasmPath = resolve(argv[i])
    else { console.error(`unknown argument: ${argv[i]}`); process.exit(1) }
  }
  if (!args.wasmPath) {
    console.error('usage: node deploy-assets/install-als.mjs <path-to-als.wasm> [--force]')
    process.exit(1)
  }
  return args
}

async function exists(p) {
  try { await access(p); return true } catch { return false }
}

// Detect Agda version by running als --version via a WASI child process.
// Returns e.g. "2.8.0".
function detectAgdaVersion(wasmPath) {
  const code = `
import { readFile } from 'node:fs/promises'
import { WASI } from 'node:wasi'
const wasi = new WASI({ version: 'preview1', args: ['als', '--version'],
  env: { HOME: '/home/root', Agda_datadir: '/' }, preopens: {} })
const buf = await readFile(${JSON.stringify(wasmPath)})
const mod = await WebAssembly.compile(buf)
const inst = await WebAssembly.instantiate(mod, wasi.getImportObject())
try { wasi.start(inst) } catch {}
`
  const r = spawnSync(process.execPath, ['--input-type=module'], {
    input: code, encoding: 'utf8', timeout: 30_000,
  })
  if (r.error) throw r.error
  const m = r.stdout.trim().match(/Agda v([\d.]+)/)
  if (!m) throw new Error(`could not parse Agda version from ALS output: "${r.stdout.trim()}"`)
  return m[1]
}

// Download agda-data source (lib/prim/) for the given Agda version from Hackage.
// Hackage tarball path: Agda-<version>/src/data/lib/prim/
async function downloadAgdaData(agdaVersion, workDir) {
  const url = `https://hackage.haskell.org/package/Agda-${agdaVersion}/Agda-${agdaVersion}.tar.gz`
  console.log(`  fetching ${url}`)
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Hackage download failed: ${resp.status} ${resp.statusText}`)

  const tarPath = join(tmpdir(), `agda-${agdaVersion}-${process.pid}.tar.gz`)
  try {
    await writeFile(tarPath, Buffer.from(await resp.arrayBuffer()))
    // --strip-components=3 removes Agda-<version>/src/data, leaving lib/prim/ in workDir
    const r = spawnSync('tar', [
      '-xzf', tarPath, '-C', workDir,
      '--strip-components=3',
      `Agda-${agdaVersion}/src/data/lib/prim`,
    ], { encoding: 'utf8' })
    if (r.error) throw r.error
    if (r.status !== 0) throw new Error(`tar extraction failed: ${r.stderr.trim()}`)
  } finally {
    await rm(tarPath, { force: true })
  }
}

async function findAgdaFiles(dir) {
  const results = []
  async function walk(d) {
    const entries = await readdir(d, { withFileTypes: true })
    for (const e of entries) {
      if (e.isDirectory() && e.name !== '_build') await walk(join(d, e.name))
      else if (e.isFile() && e.name.endsWith('.agda')) results.push(join(d, e.name))
    }
  }
  await walk(dir)
  return results
}

// Compile all .agda files in workDir/lib/prim/ by running als --raw as a
// child process and communicating via LSP JSON-RPC.
//
// ALS protocol details:
//   - Client sends:  { id, method: 'agda', params: { tag: 'CmdReq', contents: 'IOTCM ...' } }
//   - ALS replies:   { id, result: { tag: 'CmdRes', contents: null } }  (accepted)
//   - ALS then sends notifications, then a REQUEST:
//                    { id, method: 'agda', params: { tag: 'ResponseEnd' } }
//   - Client must ACK: { id, result: null }
async function compileBuiltins(wasmPath, workDir) {
  const workerPath = join(tmpdir(), `als-setup-worker-${process.pid}.mjs`)
  await writeFile(workerPath, `
import { readFile } from 'node:fs/promises'
import { WASI } from 'node:wasi'
const [,,workDir, wasmPath] = process.argv
const wasi = new WASI({ version: 'preview1', args: ['als', '--raw'],
  env: { HOME: '/home/root', Agda_datadir: '/' }, preopens: { '/': workDir } })
const buf = await readFile(wasmPath)
const mod = await WebAssembly.compile(buf)
const inst = await WebAssembly.instantiate(mod, wasi.getImportObject())
try { wasi.start(inst) } catch(e) { if (!String(e).includes('exit')) throw e }
`)

  const child = spawn(process.execPath, [workerPath, workDir, wasmPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stderr.on('data', d => {
    const s = d.toString()
    if (!s.includes('ExperimentalWarning') && !s.includes('[Info]') && !s.includes('[Debug]') && !s.includes('[Warning]'))
      process.stderr.write(s)
  })

  let nextId = 1
  const send = obj => {
    const body = JSON.stringify({ jsonrpc: '2.0', ...obj })
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  }

  let inBuf = ''
  let capturedVersion = null
  let pendingResolve = null
  let initResolve = null
  const initId = nextId++
  const initDone = new Promise(r => { initResolve = r })

  child.stdout.on('data', d => {
    inBuf += d.toString()
    for (;;) {
      const m = inBuf.match(/Content-Length: (\d+)\r\n\r\n/)
      if (!m) break
      const len = parseInt(m[1])
      const start = m.index + m[0].length
      if (inBuf.length < start + len) break
      const body = inBuf.slice(start, start + len)
      inBuf = inBuf.slice(start + len)
      try {
        const msg = JSON.parse(body)
        if (msg.id === initId && msg.result != null && initResolve) {
          initResolve(); initResolve = null
        }
        if (msg.id != null && msg.method === 'agda') {
          const { tag, contents } = msg.params ?? {}
          if (tag === 'ResponseJSONRaw' &&
              contents?.kind === 'DisplayInfo' &&
              contents?.info?.kind === 'Version') {
            capturedVersion = contents.info.version
          }
          send({ id: msg.id, result: null })
          if (tag === 'ResponseEnd' && pendingResolve) {
            const resolve = pendingResolve
            const version = capturedVersion
            pendingResolve = null
            capturedVersion = null
            resolve(version)
          }
        }
      } catch {}
    }
  })

  const sendCmd = contents => new Promise((resolve, reject) => {
    pendingResolve = resolve
    send({ id: nextId++, method: 'agda', params: { tag: 'CmdReq', contents } })
    setTimeout(() => reject(new Error(`timeout: ${contents.slice(0, 60)}`)), 120_000)
  })

  send({ id: initId, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } })
  await initDone
  send({ method: 'initialized', params: {} })

  const lspVersion = await sendCmd('IOTCM "/source.agda" NonInteractive Direct Cmd_show_version')
  if (!lspVersion) throw new Error('Cmd_show_version did not return a version')

  const primDir = join(workDir, 'lib', 'prim')
  const files = await findAgdaFiles(primDir)
  const vfsFiles = files.map(f => f.replace(workDir, ''))

  const t0 = performance.now()
  for (let i = 0; i < vfsFiles.length; i++) {
    await sendCmd(`IOTCM ${JSON.stringify(vfsFiles[i])} NonInteractive Direct (Cmd_load ${JSON.stringify(vfsFiles[i])} [])`)
    process.stdout.write(`\r  ${i + 1}/${vfsFiles.length}`)
  }
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1)
  process.stdout.write(`\r  compiled ${vfsFiles.length} files in ${elapsed}s\n`)

  child.kill()
  await rm(workerPath, { force: true })
  return lspVersion
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!(await exists(args.wasmPath))) {
    console.error(`file not found: ${args.wasmPath}`)
    process.exit(1)
  }

  const wasmFilename = basename(args.wasmPath)

  console.log('Detecting Agda version...')
  const agdaVersion = detectAgdaVersion(args.wasmPath)
  console.log(`  Agda ${agdaVersion}`)

  const alsDir = join(DEPLOY_ASSETS, 'als', agdaVersion)
  const agdaDataDir = join(alsDir, 'agda-data')
  const destWasm = join(alsDir, wasmFilename)

  if ((await exists(agdaDataDir)) && !args.force) {
    console.error(`\nalready configured: ${relative(REPO_ROOT, agdaDataDir)}`)
    console.error('Use --force to overwrite.')
    process.exit(1)
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'als-setup-'))
  try {
    console.log('Downloading agda-data source from Hackage...')
    await downloadAgdaData(agdaVersion, tempDir)
    console.log('  done')

    console.log('Compiling builtins via ALS WASM...')
    const lspVersion = await compileBuiltins(args.wasmPath, tempDir)
    if (lspVersion !== agdaVersion)
      throw new Error(`version mismatch: als --version reported "${agdaVersion}" but Cmd_show_version returned "${lspVersion}"`)

    console.log(`Installing to ${relative(REPO_ROOT, alsDir)}/...`)
    if (await exists(agdaDataDir)) await rm(agdaDataDir, { recursive: true })
    await mkdir(join(agdaDataDir, 'lib', 'prim'), { recursive: true })
    await cp(join(tempDir, 'lib', 'prim'), join(agdaDataDir, 'lib', 'prim'), { recursive: true })
    if (resolve(args.wasmPath) !== resolve(destWasm)) await cp(args.wasmPath, destWasm)
    console.log(`  agda-data/ and ${wasmFilename} installed`)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }

  console.log('\nDone.')
  console.log(`\nAdd to each profile in deploy.config.json:`)
  console.log(`  "alsVersion": ${JSON.stringify(agdaVersion)},`)
  console.log(`  "wasmFilename": ${JSON.stringify(wasmFilename)}`)
}

main().catch(err => { console.error(err.message ?? err); process.exit(1) })
