import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  // Set the base path to the repository name for GitHub Pages
  base: '/Three-Car-Sim/',
  build: {
    outDir: 'dist',
  },
  // If you are worried about side-channel attacks (Spectre/Meltdown) 
  // and need SharedArrayBuffer, you would typically need these headers.
  // Note: GitHub Pages doesn't support setting these headers directly, 
  // so you might need a service worker hack (like coi-serviceworker) if using SAB.
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
