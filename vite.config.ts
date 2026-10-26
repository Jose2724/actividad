import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** a build's id: made of the files the page names (its hashed scripts and styles), so it only changes when the app does */
const buildIdOf = (html: string) => createHash('sha1').update([...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map((m) => m[1]).sort().join('\n')).digest('hex').slice(0, 12)

/**
 * The two apps look different, so nobody takes the demo for the real one: their own icon (public/live-*.png blue,
 * public/demo-*.png orange with a DEMO band, drawn by tools/make-icons.py), their own name under the icon and in the
 * browser tab, and their own colour for the bar at the top of the installed app. The manifest keeps one address
 * (manifest.webmanifest) so the apps already installed pick the change up.
 */
function flavor(demo: boolean): Plugin {
  const f = demo
    ? { key: 'demo', name: 'Actividad DEMO', short: 'Activ. DEMO', theme: '#c2410c' }
    : { key: 'live', name: 'Actividad', short: 'Actividad', theme: '#581447' }
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
    transformIndexHtml: { order: 'pre', handler: (html) => html.replaceAll('__FLAVOR__', f.key).replaceAll('__APP_NAME__', f.name).replaceAll('__APP_SHORT__', f.short).replaceAll('__THEME__', f.theme).replaceAll('__BUILD__', 'dev') },
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest() }) },
    // once everything is written: the page carries its build's id, and version.json publishes it (see src/update.ts)
    writeBundle(options) {
      const dir = options.dir ?? 'dist', file = join(dir, 'index.html')
      if (!existsSync(file)) return // a bundle without a page (the tests')
      const html = readFileSync(file, 'utf8'), build = buildIdOf(html)
      writeFileSync(file, html.replace(/<meta name="act-build" content="[^"]*" \/>/, `<meta name="act-build" content="${build}" />`))
      writeFileSync(join(dir, 'version.json'), JSON.stringify({ build }) + '\n')
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]
        if (path.endsWith('/version.json')) { res.setHeader('Content-Type', 'application/json'); res.end('{"build":"dev"}'); return }
        if (!path.endsWith('/manifest.webmanifest')) return next()
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
