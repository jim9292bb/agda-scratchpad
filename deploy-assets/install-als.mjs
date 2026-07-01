/**
 * Sets up an ALS WASM build for deployment — no native agda required.
 *
 * 1. Extracts agda-data source via `als --setup`
 * 2. Compiles all builtin .agda files via `als --raw` + LSP; reads Agda
 *    version from `Cmd_show_version` during the same session
 * 3. Installs agda-data/ and the .wasm file into deploy-assets/als/<version>/
 *
 * Usage:
 *   node deploy-assets/install-als.mjs <path-to-als.wasm> [--force]
 *
 * --force overwrites an existing deploy-assets/als/<version>/ directory.
 */

import { readFile, writeFile, mkdir, cp, rm, mkdtemp, access, readdir } from 'node:fs/promises'
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

// Run als --setup in a child process with stdout suppressed (it prints
// "Writing /..." for every file, which is too verbose for normal use).
function runAlsSetup(wasmPath, workDir) {
  const code = `
import { readFile } from 'node:fs/promises'
import { WASI } from 'node:wasi'
const wasi = new WASI({ version: 'preview1', args: ['als', '--setup'],
  env: { HOME: '/home/root', Agda_datadir: '/' }, preopens: { '/': ${JSON.stringify(workDir)} } })
const buf = await readFile(${JSON.stringify(wasmPath)})
const mod = await WebAssembly.compile(buf)
const inst = await WebAssembly.instantiate(mod, wasi.getImportObject())
try { wasi.start(inst) } catch {}
`
  const r = spawnSync(process.execPath, ['--input-type=module'], {
    input: code, encoding: 'utf8', timeout: 30_000,
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`als --setup failed: ${r.stderr.trim()}`)
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
// child process and communicating via LSP JSON-RPC. Also queries Agda version
// via Cmd_show_version before compilation and returns it.
//
// ALS protocol details relevant here:
//   - Client sends:  { id, method: 'agda', params: { tag: 'CmdReq', contents: 'IOTCM ...' } }
//   - ALS replies:   { id, result: { tag: 'CmdRes', contents: null } }  (accepted)
//   - ALS then sends a series of notifications, then a REQUEST with:
//                    { id, method: 'agda', params: { tag: 'ResponseEnd' } }
//   - Client must ACK that request with { id, result: null } to unblock ALS.
//   - After the ACK, ALS is ready for the next command.
//   - Cmd_show_version emits a ResponseJSONRaw notification before ResponseEnd
//     with params.contents = { kind: 'DisplayInfo', info: { kind: 'Version', version: '...' } }
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

  const agdaVersion = await sendCmd('IOTCM "/source.agda" NonInteractive Direct Cmd_show_version')
  if (!agdaVersion) throw new Error('Cmd_show_version did not return a version')

  const primDir = join(workDir, 'lib', 'prim')
  const files = await findAgdaFiles(primDir)
  const vfsFiles = files.map(f => f.replace(workDir, ''))

  const t0 = performance.now()
  for (let i = 0; i < vfsFiles.length; i++) {
    const f = JSON.stringify(vfsFiles[i])
    await sendCmd(`IOTCM ${f} NonInteractive Direct (Cmd_load ${f} [])`)
    process.stdout.write(`\r  ${i + 1}/${vfsFiles.length}`)
  }
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1)
  process.stdout.write(`\r  compiled ${vfsFiles.length} files in ${elapsed}s\n`)

  child.kill()
  await rm(workerPath, { force: true })
  return agdaVersion
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!(await exists(args.wasmPath))) {
    console.error(`file not found: ${args.wasmPath}`)
    process.exit(1)
  }

  const wasmFilename = basename(args.wasmPath)
  let agdaVersion = null

  const tempDir = await mkdtemp(join(tmpdir(), 'als-setup-'))
  try {
    // 1. Extract agda-data source via als --setup (fast, synchronous)
    console.log('Extracting agda-data source (als --setup)...')
    runAlsSetup(args.wasmPath, tempDir)
    console.log('  done')

    // 2. Compile builtins + read Agda version via LSP
    console.log('Compiling builtins via ALS WASM...')
    agdaVersion = await compileBuiltins(args.wasmPath, tempDir)

    const alsDir = join(DEPLOY_ASSETS, 'als', agdaVersion)
    const agdaDataDir = join(alsDir, 'agda-data')
    const destWasm = join(alsDir, wasmFilename)

    if ((await exists(agdaDataDir)) && !args.force) {
      console.error(`\nalready configured: ${relative(REPO_ROOT, agdaDataDir)}`)
      console.error('Use --force to overwrite.')
      process.exit(1)
    }

    // 3. Install
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
