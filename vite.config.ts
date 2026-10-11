import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The two apps look different, so nobody takes the demo for the real one: their own icon (public/live-*.png blue,
 * public/demo-*.png orange with a DEMO band, drawn by tools/make-icons.py), their own name under the icon and in the
 * browser tab, and their own colour for the bar at the top of the installed app. The manifest keeps one address
 * (manifest.webmanifest) so the apps already installed pick the change up.
 */
function flavor(demo: boolean): Plugin {
  const f = demo
    ? { key: 'demo', name: 'Actividad DEMO', short: 'Activ. DEMO', theme: '#c2410c' }
    : { key: 'live', name: 'Actividad', short: 'Actividad', theme: '#0f766e' }
  const manifest = () => JSON.stringify({
    name: f.name, short_name: f.short,
    description: 'Actividad de producción por departamento: líneas, códigos, paros y avance del día' + (demo ? ' (demo: los datos se quedan en este aparato)' : ''),
    start_url: './', scope: './', display: 'standalone', orientation: 'any', background_color: '#f3f6f9', theme_color: f.theme, lang: 'es',
    icons: [
      { src: `./${f.key}-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `./${f.key}-512.png`, sizes: '512x512', type: 'image/png' },
      { src: `./${f.key}-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2)
  return {
    name: 'actividad-flavor',
    transformIndexHtml: { order: 'pre', handler: (html) => html.replaceAll('__FLAVOR__', f.key).replaceAll('__APP_NAME__', f.name).replaceAll('__APP_SHORT__', f.short).replaceAll('__THEME__', f.theme) },
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest() }) },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!(req.url ?? '').split('?')[0].endsWith('/manifest.webmanifest')) return next()
        res.setHeader('Content-Type', 'application/manifest+json'); res.end(manifest())
      })
    },
  }
}

// Two builds of the same app:
//  - demo (mode "demo", folder docs/, GitHub Pages at /actividad/): no server keys, everything stays on the device
//  - server (default mode, folder dist/, Vercel at /): keys from the environment, shared with every tablet
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return { plugins: [react(), flavor(!env.VITE_SUPABASE_URL)], base: env.VITE_BASE || '/' }
})
