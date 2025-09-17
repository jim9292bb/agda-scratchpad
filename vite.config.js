import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vitest/config'

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
  },
  clearScreen: false,
  plugins: [
    sveltekit(),
    coiPlugin(),
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
