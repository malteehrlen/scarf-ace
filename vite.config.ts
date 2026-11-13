import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { thirdPartyLicenses } from './build/third-party-licenses.ts'

export default defineConfig({
  plugins: [vue(), thirdPartyLicenses()],
  // Relative asset paths, so the build works from any sub-path (e.g. GitHub Pages at /<repo>/)
  // or a custom domain without configuration.
  base: './',
})
