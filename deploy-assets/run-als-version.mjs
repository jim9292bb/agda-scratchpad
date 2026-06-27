/**
 * Runs an `als` WASM build with `--version` via Node's built-in WASI and
 * prints whatever it writes to stdout, verbatim.
 *
 * Always run as a child process (see deploy-assets/print-required-files.mjs)
 * rather than imported in-process — Node's WASI implementation writes
 * directly to the real fd 1, bypassing `process.stdout.write`, so
 * in-process capture (monkey-patching `process.stdout.write`) doesn't see
 * anything; only a parent process piping this one's actual stdout does.
 *
 * Usage: node deploy-assets/run-als-version.mjs <path to .wasm>
 */

import { readFile } from 'node:fs/promises'
import { WASI } from 'node:wasi'

const [, , wasmPath] = process.argv
if (!wasmPath) {
  console.error('usage: node run-als-version.mjs <path to .wasm>')
  process.exit(1)
}

const wasi = new WASI({ version: 'preview1', args: ['als', '--version'], env: {}, preopens: {} })
const wasmBuffer = await readFile(wasmPath)
const wasmModule = await WebAssembly.compile(wasmBuffer)
const instance = await WebAssembly.instantiate(wasmModule, wasi.getImportObject())
wasi.start(instance)
