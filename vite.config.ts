import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { thirdPartyLicenses } from './build/third-party-licenses.ts'
import { siteFiles } from './build/site-files.ts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  return {
    plugins: [vue(), thirdPartyLicenses(), siteFiles(env.VITE_SITE_URL ?? '')],
    // Relative asset paths, so the build works from any sub-path (e.g. GitHub Pages at /<repo>/)
    // or a custom domain without configuration.
    base: './',
  }
})
