// Every text of the screens has its English. Run with: npm run check
// It reads the texts where they are written (tr('…'), trx('…') in src/), adds the ones that are data (the causes of the
// stops of each room), and compares them with src/en.ts: what is missing, what is left over, and whether each
// English text uses the same pieces ({0}, {1}…) as its Spanish.
import { readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true } }
const m = await import(pathToFileURL(resolve(here, '../node_modules/.cache/act-check/device.js')).href + '?i18n')

const unquote = (t) => t.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c) => (c[0] === 'u' ? String.fromCharCode(parseInt(c.slice(1), 16)) : c === 'n' ? '\n' : c))
const used = new Map() // text → where
for (const f of readdirSync(resolve(here, '../src')).filter((f) => /\.tsx?$/.test(f) && f !== 'en.ts')) {
  const src = readFileSync(resolve(here, '../src', f), 'utf8')
  for (const x of src.matchAll(/\btr(?:x|In)?\(\s*(?:'e[ns]'\s*,\s*)?'((?:[^'\\]|\\.)*)'/g)) { const k = unquote(x[1]); if (!used.has(k)) used.set(k, f) }
}
// what is data and is shown through tr(): the causes of the stops, and "Otra"
for (const d of m.DEPTS) for (const r of [...m.CFG[d].reasons, ...m.CFG[d].quick]) if (!used.has(r)) used.set(r, 'causes of ' + d)
used.set('Otra', 'causes')

const pieces = (t) => [...new Set([...t.matchAll(/\{(\d+)\}/g)].map((x) => Number(x[1])))].sort((a, b) => a - b)
const missing = [...used].filter(([k]) => !(k in m.EN))
const extra = Object.keys(m.EN).filter((k) => !used.has(k))
const wrong = Object.entries(m.EN).filter(([k, v]) => pieces(v).some((i) => !pieces(k).includes(i)))
const same = Object.entries(m.EN).filter(([k, v]) => k === v && /[áéíóúñ¿¡]/i.test(k))
const empty = Object.entries(m.EN).filter(([, v]) => !String(v).trim())

const list = process.argv.includes('--list')
if (list) for (const [k, f] of missing) console.log(JSON.stringify(k) + '  ← ' + f)
const bad = missing.length + wrong.length + empty.length + same.length
for (const [k] of wrong) console.log('  ✗ pieces that the Spanish does not have: ' + JSON.stringify(k))
for (const [k] of empty) console.log('  ✗ empty English: ' + JSON.stringify(k))
for (const [k] of same) console.log('  ✗ English left in Spanish: ' + JSON.stringify(k))
if (!list && missing.length) console.log('  ✗ ' + missing.length + ' texts without English, for example: ' + missing.slice(0, 5).map(([k]) => JSON.stringify(k)).join(', ') + '  (node tests/i18n.mjs --list shows them all)')
if (extra.length) console.log('  · ' + extra.length + ' English texts nothing uses any more: ' + extra.slice(0, 8).map((k) => JSON.stringify(k)).join(', '))
console.log(bad ? '✗ inglés: ' + used.size + ' textos, ' + missing.length + ' sin traducir' : '✓ inglés: ' + used.size + ' textos, todos traducidos')
if (bad && !list) process.exit(1)
