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
for (const f of readdirSync(resolve(here, '../src')).filter((f) => /\.tsx?$/.test(f) && !['en.ts', 'i18n.ts', 'trx.tsx'].includes(f))) {
  const src = readFileSync(resolve(here, '../src', f), 'utf8')
  for (const x of src.matchAll(/\b(?:trx?\(\s*|trIn\(\s*'e[ns]'\s*,\s*)'((?:[^'\\]|\\.)*)'/g)) { const k = unquote(x[1]); if (!used.has(k)) used.set(k, f) }
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
// ---- the same app loaded in English: what is shown changes, what is kept does not ----
globalThis.localStorage = { getItem: (k) => (k === 'act_lang' ? 'en' : null), setItem() {}, removeItem() {} }
const en = await import(pathToFileURL(resolve(here, '../node_modules/.cache/act-check/device.js')).href + '?en')
let off = 0
const eq = (what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { off++; console.log('  ✗ ' + what + ': salió ' + JSON.stringify(got) + ', esperado ' + JSON.stringify(want)) } }
eq('el idioma se lee al cargar', [m.lang, en.lang], ['es', 'en'])
eq('las palabras de cada departamento', [en.CFG.RTE.unit, en.CFG.RTE.plural, en.CFG.RTE.done, en.CFG.Kitchen.unit, en.CFG.Packing.qtyUnit, en.CFG.Packing.refLabel, en.CFG.RTE.lineWord], ['Cart', 'Carts', 'Cart done', 'Batch', 'cases', 'Tag no.', 'Line'])
eq('las causas de paro se guardan como siempre y solo se muestran traducidas', [en.CFG.RTE.quick, en.CFG.RTE.quick.map((r) => en.tr(r)), en.SETUP], [m.CFG.RTE.quick, ['Mechanical issue', 'Out of plastic', 'Break'], 'Set up'])
eq('una causa escrita en inglés es la misma causa, en cualquiera de los dos idiomas', [en.tidyReason('RTE', 'mechanical issue'), m.tidyReason('RTE', 'Out of Plastic'), en.tidyReason('RTE', 'sin plastico'), en.tidyReason('RTE', 'something else')], ['Problema mecánico', 'Sin plástico', 'Sin plástico', 'something else'])
eq('cajas y sueltos', [en.casesText({ cases: 3, loose: 1 }), en.casesText({ cases: 1, loose: 0 }), en.casesText({ cases: 1188, loose: 4 }), m.casesText({ cases: 3, loose: 1 })], ['3 cases and 1 loose', '1 case', '1,188 cases and 4 loose', '3 cajas y 1 suelto'])
eq('los nombres de las líneas se guardan igual: "Línea 3" se lee "Line 3", y quien escribe "Line 4" guarda "Línea 4"', [en.lineLabel('Línea 3'), en.lineLabel('Braiser 2'), en.lineLabel('Empaque A'), en.tidyLineName('Line 4'), en.tidyLineName(' line  7 '), m.lineLabel('Línea 3'), m.tidyLineName('Line 4'), en.freeLineNames(en.store.get(), 'RTE', 2)], ['Line 3', 'Braiser 2', 'Empaque A', 'Línea 4', 'Línea 7', 'Línea 3', 'Line 4', ['Línea 1', 'Línea 2']])
eq('la nota de un Set up se guarda igual y se lee en inglés; una nota escrita a mano no se toca', [en.noteLabel('Después de 0100'), en.noteLabel('De 0100 a 0215'), en.noteLabel('selladora'), m.noteLabel('De 0100 a 0215')], ['After 0100', 'From 0100 to 0215', 'selladora', 'De 0100 a 0215'])
eq('el horario de un turno', [en.shiftHours(en.shiftsOf(en.store.get(), '2026-10-12'), 1), m.shiftHours(m.shiftsOf(m.store.get(), '2026-10-12'), 1)], ['6:00 AM to 3:00 PM', '6:00 AM a 3:00 PM'])
eq('el historial guarda siempre las mismas palabras', [en.shiftsText(en.shiftsOf(en.store.get(), '2026-10-12')), en.filterFile('0100', '6285', 2)], ['Turno 1 de 6:00 AM a 3:00 PM · Turno 2 de 3:30 PM a 1:00 AM', '-turno2-cod-0100-lote-6285'])
eq('los títulos de un reporte filtrado', [en.filterTitle('0100', '6285', 2), m.filterTitle('0100', '6285', 2)], [' · Shift 2 · code 0100 · lot 6285', ' · Turno 2 · código 0100 · lote 6285'])
eq('una frase con sus piezas, y una que falta sale en español', [en.tr('Se ven {0} de {1}', 10, 163), en.tr('Esta frase no existe {0}', 5), m.tr('Se ven {0} de {1}', 10, 163)], ['Showing 10 of 163', 'Esta frase no existe 5', 'Se ven 10 de 163'])
console.log(bad || off ? '✗ inglés: ' + used.size + ' textos, ' + missing.length + ' sin traducir' : '✓ inglés: ' + used.size + ' textos, todos traducidos')
if ((bad || off) && !list) process.exit(1)
