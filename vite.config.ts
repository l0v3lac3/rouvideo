import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative base so the built app works on GitHub Pages project sites
  // (<user>.github.io/react-convex-app/) without extra configuration.
  base: './',
})
