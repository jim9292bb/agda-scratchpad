import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vitest/config'

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

export default defineConfig({
  server: {
    port: 8099,
    https: VITE_SERVE_ENABLE_SSL,
  },
  optimizeDeps: {
    include: ['@runno/wasi', 'jszip'],
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
})
