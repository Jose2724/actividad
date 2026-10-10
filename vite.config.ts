import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Two builds of the same app:
//  - demo (mode "demo", folder docs/, GitHub Pages at /actividad/): no server keys, everything stays on the device
//  - server (default mode, folder dist/, Vercel at /): keys from the environment, shared with every tablet
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return { plugins: [react()], base: env.VITE_BASE || '/' }
})
