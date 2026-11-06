// Writes the guide of the 🤖 Ayuda into supabase/functions/act-ayuda/core.ts (between its KB markers), from:
// - tools/ayuda/kb/*.md: the chapters written by hand, each with who may read it (roles, and rooms for an operator);
// - src/reasons.ts: the 37 reason codes, read from the code so the list is always the app's own;
// - src/Numbers.tsx and src/miniKpi.ts: "¿Qué significa cada número?", the math of each number, as the app says it;
// - the screens a link may open (DESTINOS), each with who sees it (the same rules as App.tsx's sees());
// - public/ayuda/img/manifest.json: the screenshots an answer may show.
// Run: node tools/ayuda/build-kb.mjs   (npm run build runs it too). When a screen or a number changes, change its
// chapter or the code it is read from and run this again; then deploy the function again.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')
const STR = String.raw`'((?:[^'\\]|\\.)*)'`
const unq = (s) => s.replace(/\\'/g, "'").replace(/\\n/g, '\n')
const ALL_BUT_OP = ['mgr', 'office', 'viewer', 'admin']

// ---- the chapters by hand ----
const sections = []
for (const f of readdirSync(resolve(root, 'tools/ayuda/kb')).filter((x) => x.endsWith('.md')).sort()) {
  const raw = read('tools/ayuda/kb/' + f).replace(/\r\n/g, '\n')
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) throw new Error(f + ': no front matter')
  const head = Object.fromEntries(m[1].split('\n').map((l) => l.split(/:\s*/, 2)).map(([k, ...v]) => [k.trim(), l(v)]))
  function l(v) { return v.join(':').trim() }
  for (const k of ['id', 'title', 'roles']) if (!head[k]) throw new Error(f + ': no ' + k)
  sections.push({ id: head.id, title: head.title, roles: head.roles.split(',').map((x) => x.trim()), ...(head.depts ? { depts: head.depts.split(',').map((x) => x.trim()) } : {}), text: m[2].trim() })
}

// ---- the reason codes, from src/reasons.ts ----
const reasons = read('src/reasons.ts')
const cats = Object.fromEntries([...reasons.matchAll(new RegExp(String.raw`\{ key: '(\w+)', label: ${STR}`, 'g'))].map((x) => [x[1], unq(x[2])]))
const fam = { Availability: 'Disponibilidad', Performance: 'Rendimiento', Quality: 'Calidad' }
const codes = [...reasons.matchAll(new RegExp(String.raw`c\('([A-Z]{3}-\d\d)', ${STR}, ${STR}, '(\w+)'(?:, '(\w+)')?\)`, 'g'))]
  .map((x) => ({ code: x[1], label: unq(x[2]), def: unq(x[4]), cat: x[6], family: x[7] || 'Availability' }))
if (codes.length !== 37) throw new Error('reason codes: expected 37, read ' + codes.length)
const byCat = {}
for (const c of codes) (byCat[c.cat] ??= []).push(c)
sections.push({
  id: 'reason-codes', title: 'La lista de reason codes (códigos de paro)', roles: ['all'],
  text: 'Cuando los reason codes están prendidos, cada paro lleva UNO de estos códigos, y solo de esta lista. En la ventana de paro se escoge primero la categoría (el cuadro) y después el código. PLN-… = paro planeado; los demás no son planeados.\n'
    + Object.entries(byCat).map(([k, list]) => '**' + (cats[k] ?? k) + '**\n' + list.map((c) => '- ' + c.code + ' · ' + c.label + ' — ' + c.def + ' (' + (c.code.startsWith('PLN-') ? 'planeado' : 'no planeado') + ', ' + fam[c.family] + ')').join('\n')).join('\n'),
})

// ---- the numbers, from src/Numbers.tsx and src/miniKpi.ts ----
const nums = read('src/Numbers.tsx'), mini = read('src/miniKpi.ts')
const groupNames = Object.fromEntries([...nums.matchAll(new RegExp(String.raw`\['(\w+)', tr\(${STR}\)\]`, 'g'))].map((x) => [x[1], unq(x[2])]))
const itemsOf = (src, start, end) => {
  const body = src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)))
  return body.split(/\{ id: '/).slice(1).map((chunk) => {
    const f = (k) => { const m = chunk.match(new RegExp(k + String.raw`: tr\(` + STR)); return m ? unq(m[1]) : '' }
    return { id: chunk.slice(0, chunk.indexOf("'")), group: (chunk.match(/group: '(\w+)'/) || [])[1] || 'kpi', title: f('title'), means: f('means'), math: f('math'), eg: f('eg') }
  }).filter((x) => x.title && x.math)
}
const numItems = [...itemsOf(nums, 'const items = (): Item[] => [', '\n]'), ...itemsOf(mini, 'export const miniGuide', '\n]').map((x) => ({ ...x, group: 'kpi', title: 'Mini KPI · ' + x.title }))]
if (numItems.length < 40) throw new Error('numbers: read only ' + numItems.length)
const numText = (list) => list.map((x) => '- **' + x.title + '**: ' + x.means + ' Cómo se saca: ' + x.math + (x.eg ? ' Ejemplo: ' + x.eg : '')).join('\n')
const floorGroups = ['tiempo', 'prod']
for (const [g, name] of Object.entries(groupNames)) {
  const list = numItems.filter((x) => x.group === g)
  if (!list.length) continue
  sections.push({ id: 'numeros-' + g, title: 'Qué significa cada número · ' + name, roles: floorGroups.includes(g) ? ['all'] : ALL_BUT_OP, text: numText(list) })
}

// ---- the screens a link may open: [[ir:DESTINO]] (App.tsx's sees() decides again on the tablet) ----
const D = (id, label, roles, note = '') => ({ id, label, roles, note })
const ALL = ['all']
export const DESTINOS = [
  D('act', 'En vivo: las líneas del cuarto', ALL),
  D('act:Kitchen', 'En vivo de Kitchen', ALL_BUT_OP), D('act:RTE', 'En vivo de RTE', ALL_BUT_OP), D('act:Spiral', 'En vivo de Spiral', ALL_BUT_OP), D('act:MFO', 'En vivo de MFO', ALL_BUT_OP), D('act:Packing', 'En vivo de Packing', ALL_BUT_OP),
  D('rep', 'Reportes › Producción', ALL), D('rep:gen', 'Reportes › Producción › General', ALL), D('rep:code', 'Reportes › Producción › Por código', ALL), D('rep:shift', 'Reportes › Producción › Por turno', ALL), D('rep:rec', 'Reportes › Producción › Registros', ALL), D('rep:chg', 'Reportes › Producción › Cambios', ALL),
  D('rtime', 'Reportes › Tiempo', ALL), D('rstop', 'Reportes › Paros', ALL), D('ratt', 'Reportes › Asistencia', ALL, 'si la asistencia está prendida'),
  D('pt', 'Planeación › Programa del día', ALL, 'si está prendida para todos'),
  D('wo', 'Planeación › Pedidos de producción', ALL_BUT_OP), D('po', 'Planeación › Pedidos con PO', ALL_BUT_OP), D('prod', 'Planeación › Productos', ALL_BUT_OP), D('goals', 'Planeación › Metas', ALL_BUT_OP, 'con permiso Poner metas'),
  D('av', 'Trazabilidad › Avance', ALL_BUT_OP), D('lt', 'Trazabilidad › Lotes', ALL_BUT_OP, 'si está prendida'), D('pal', 'Trazabilidad › Pallets y bins', ['mgr', 'office', 'viewer', 'admin', 'op'], 'operadores: solo Packing'), D('hold', 'Trazabilidad › On hold', ALL_BUT_OP), D('fl', 'Trazabilidad › Flujo', ['admin']),
  D('home', 'Indicadores › Resumen', ALL_BUT_OP), D('wt', 'Indicadores › Pesos', ALL_BUT_OP), D('dash', 'Indicadores › Dashboard', ALL_BUT_OP), D('mini', 'Indicadores › Mini KPI', ALL_BUT_OP), D('kpi', 'Indicadores › KPI diario', ['admin'], 'el dueño y su lista'), D('pplh', 'Indicadores › PPLH', ['admin'], 'el dueño y su lista'),
  D('msg', 'Mensajes', ALL_BUT_OP),
  D('set', 'Ajustes', ALL), D('set:device', 'Ajustes › Este aparato', ALL),
  D('set:shifts', 'Ajustes › Turnos y calendario', ALL_BUT_OP), D('set:day', 'Ajustes › Día de trabajo', ALL_BUT_OP), D('set:lines', 'Ajustes › Líneas', ALL_BUT_OP), D('set:stops', 'Ajustes › Paros (Reason Codes)', ALL_BUT_OP), D('set:kpi', 'Ajustes › KPI (pesos)', ALL_BUT_OP), D('set:mini', 'Ajustes › Mini KPI', ALL_BUT_OP), D('set:weights', 'Ajustes › Ritmo mínimo', ALL_BUT_OP), D('set:consumo', 'Ajustes › Consumo', ALL_BUT_OP), D('set:attendance', 'Ajustes › Asistencia', ALL_BUT_OP), D('set:people', 'Ajustes › Empleados', ALL_BUT_OP, 'con permiso Manejar empleados'), D('set:devices', 'Ajustes › Tablets', ALL_BUT_OP), D('set:program', 'Ajustes › Pestañas nuevas', ['admin']),
]
const destText = (rolesOk) => DESTINOS.filter((d) => rolesOk(d.roles)).map((d) => '- ' + d.id + ' → ' + d.label + (d.note ? ' (' + d.note + ')' : '')).join('\n')
sections.push({ id: 'destinos-op', title: 'DESTINOS para [[ir:…]]', roles: ['op'], text: destText((r) => r.includes('all') || r.includes('op')) })
sections.push({ id: 'destinos', title: 'DESTINOS para [[ir:…]]', roles: ALL_BUT_OP, text: destText(() => true) + '\n(act:CUARTO lleva al cuarto. Si la persona no ve un destino, la app no muestra el botón.)' })

// ---- the screenshots ----
const manifest = resolve(root, 'public/ayuda/img/manifest.json')
const images = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : []

// ---- into core.ts ----
// the version is the guide's own fingerprint: the same guide, the same text (so a build changes nothing by itself)
const version = createHash('sha256').update(JSON.stringify({ sections, images })).digest('hex').slice(0, 10)
const kb = { version, sections, images }
const core = resolve(root, 'supabase/functions/act-ayuda/core.ts')
const src = readFileSync(core, 'utf8')
const a = src.indexOf('/*KB*/'), b = src.indexOf('/*KB*/', a + 6)
if (a < 0 || b < 0) throw new Error('core.ts: KB markers not found')
writeFileSync(core, src.slice(0, a) + '/*KB*/ export const KB: Kb = ' + JSON.stringify(kb) + ' /*KB*/' + src.slice(b + 6))
// the destinations for the app too (src/ayudaLinks.ts), so the tablet knows each id
writeFileSync(resolve(root, 'src/ayudaLinks.ts'), '// written by tools/ayuda/build-kb.mjs: the screens an answer of the 🤖 Ayuda may open ([[ir:ID]]) and its screenshots\n'
  + 'export const AYUDA_LINKS: Record<string, string> = ' + JSON.stringify(Object.fromEntries(DESTINOS.map((d) => [d.id, d.label])), null, 1) + '\n'
  + 'export const AYUDA_IMAGES: Record<string, string> = ' + JSON.stringify(Object.fromEntries(images.map((i) => [i.id, i.caption])), null, 1) + '\n')
const chars = JSON.stringify(kb).length
console.log('ayuda kb:', sections.length, 'sections,', codes.length, 'codes,', numItems.length, 'numbers,', images.length, 'images,', Math.round(chars / 1000) + ' k chars (~' + Math.round(chars / 3.5 / 1000) + 'k tokens)')
