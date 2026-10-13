// The demo on a device that opens it for the very first time (nothing saved): it has to come up, in either language,
// with one line in every room. Run with: npm run check (which bundles the app's own code in demo mode for this).
// Why it exists: on 2026-10-13 a helper used while the first state is made was declared further down the file, and a
// brand-new device got a blank page. The other checks never start from nothing in demo mode, so none of them saw it.
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const bundle = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/.cache/act-check-demo/device.js')).href
let passed = 0
const failed = []
const eq = (what, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) passed++; else failed.push(what + '\n      salió    ' + a + '\n      esperado ' + b) }

for (const lang of ['es', 'en']) {
  // a device with nothing on it but, perhaps, the language somebody chose on the entry screen
  globalThis.localStorage = { getItem: (k) => (k === 'act_lang' && lang === 'en' ? 'en' : null), setItem() {}, removeItem() {} }
  globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true } }
  let m = null, error = ''
  try { m = await import(bundle + '?' + lang) } catch (e) { error = String(e) }
  eq('[' + lang + '] el demo arranca en un aparato nuevo', error, '')
  if (!m) continue
  eq('[' + lang + '] es el demo: sin servidor', m.supabase, null)
  eq('[' + lang + '] una línea en cada departamento, con el nombre que se guarda siempre igual', m.store.get().lines.map((l) => [l.dept, l.name]), [['Kitchen', 'Braiser 1'], ['RTE', 'Línea 1'], ['Spiral', 'Línea 1'], ['MFO', 'Línea 1'], ['Packing', 'Línea 1']])
  eq('[' + lang + '] y se lee en el idioma de la pantalla', m.store.get().lines.map((l) => m.lineLabel(l.name))[1], lang === 'en' ? 'Line 1' : 'Línea 1')
  eq('[' + lang + '] con sus productos de ejemplo y nada registrado', [m.store.get().products.length > 0, m.store.get().runs.length, m.store.get().stops.length], [true, 0, 0])
}
if (failed.length) { console.log('✗ ' + failed.length + ' FALLARON de ' + (passed + failed.length) + ':'); for (const f of failed) console.log('  ' + f); process.exit(1) }
console.log('✓ ' + passed + ' comprobaciones, todas correctas')
