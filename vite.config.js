import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vitest/config'
import { exec } from 'child_process'

const VITE_SERVE_ENABLE_SSL = 'VITE_SERVE_ENABLE_SSL' in process.env

/** @returns {import('vite').Plugin<unknown>} */
const coiPlugin = () => ({
  name: 'coi-plugin',
  configureServer(server) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
      next()
    })
  },
})

/** @type {() => Promise<string>} */
const getGitCommitHash = () => new Promise((resolve, reject) => {
  exec('git describe --tags --always --abbrev=8 --dirty', (err, result) => {
    if (err) return reject(err)
    resolve(result.trim())
  })
})

export default defineConfig(async ({ command }) => {
  const GIT_COMMIT_HASH = JSON.stringify(
    command === 'serve' ? 'DEV' : await getGitCommitHash())

  console.log(`GIT_COMMIT_HASH is ${GIT_COMMIT_HASH}`)

  return {
  server: {
    port: 8099,
    https: VITE_SERVE_ENABLE_SSL,
    allowedHosts: 'all',
    fs: {
      // SvelteKit's default fs.allow excludes the project root, but
      // src/lib/runtime/interface.ts imports deploy.config.mjs and
      // deploy-assets/*.mjs (outside src/) at build time.
      allow: ['.'],
    },
  },
  define: {
    // XXX: is using env better?
    APP_REPO_URL: JSON.stringify('https://github.com/agda-web/als-demo'),
    APP_COMMIT_ID: GIT_COMMIT_HASH,
  },
  clearScreen: false,
  plugins: [
    sveltekit(),
    coiPlugin(),
    ...VITE_SERVE_ENABLE_SSL ? [await import('@vitejs/plugin-basic-ssl').then(basicSsl => basicSsl.default())] : [],
  ],
  build: {
    // bumped for TLA
    target: ['es2022', 'edge89', 'firefox89', 'chrome89', 'safari15'],
  },
  worker: {
    format: 'es',
  },
  test: {
    globals: true,
    include: ['src/**/*.{test,spec}.{js,ts}'],
  },
}})
