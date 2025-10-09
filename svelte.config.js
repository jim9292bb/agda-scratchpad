import adapter from '@sveltejs/adapter-static'

const CI = 'CI' in process.env

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({ precompress: false }),
    paths: {
      base: CI ? '/als-demo' : '',
    }
  }
}

export default config
