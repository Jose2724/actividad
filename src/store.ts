// Demo: everything is kept on this device (localStorage). The real version syncs to a server so the manager sees it live.
export type Dept = 'Kitchen' | 'RTE' | 'Spiral' | 'MFO' | 'Packing'
export const DEPTS: Dept[] = ['Kitchen', 'RTE', 'Spiral', 'MFO', 'Packing']

/**
 * How each department counts its work and why its lines stop — the words of the shift manager and of the office
 * sheets ("FORMATO POR CUARTO"): Kitchen cooks mezclas in braisers, Spiral cooks batches (they call them mezclas too),
 * RTE fills carts whose pouches are counted by the office (pouches per cart depend on the code), MFO fills bins and
 * writes the cases and the bin number, Packing builds pallets and writes the cases and the tag number.
 * qty: 'none' = only count the units; 'ask' = ask the quantity each time (Packing proposes the usual one);
 * 'auto' = every unit carries the quantity given at the start (pouches per cart).
 */
export type DeptCfg = { lineWord: string; unit: string; plural: string; done: string; qty: 'none' | 'ask' | 'auto'; qtyQ: string; qtyUnit: string; perUnitLabel: string; refLabel: string; reasons: string[] }
export const CFG: Record<Dept, DeptCfg> = {
  Kitchen: { lineWord: 'Braiser', unit: 'Mezcla', plural: 'Mezclas', done: 'Mezcla lista', qty: 'none', qtyQ: '', qtyUnit: '', perUnitLabel: '', refLabel: '', reasons: ['Braiser apagado', 'Esperando ingredientes', 'Esperando que recojan producto', 'Máquina / mantenimiento', 'Limpieza', 'Falta de personal', 'Break', 'Calidad'] },
  Spiral: { lineWord: 'Línea', unit: 'Mezcla', plural: 'Mezclas', done: 'Mezcla lista', qty: 'none', qtyQ: '', qtyUnit: '', perUnitLabel: '', refLabel: '', reasons: ['Falta de producto de Kitchen', 'Horno (temperatura)', 'Temperatura interna baja', 'Esperando carros / RTE', 'Máquina / mantenimiento', 'Limpieza', 'Falta de personal', 'Break', 'Calidad'] },
  RTE: { lineWord: 'Línea', unit: 'Carro', plural: 'Carros', done: 'Carro listo', qty: 'auto', qtyQ: '', qtyUnit: 'pouches', perUnitLabel: 'Pouches por carro', refLabel: '', reasons: ['Falta de salsa (Kitchen)', 'Falta de arroz / arroz muy frío', 'Falta de carrito vacío', 'Cambio de rollo de plástico', 'Plástico atascado / no corta', 'Máquina corta o rompe paquetes (mecánico)', 'Impresora de sello no imprime', 'Peso fuera de rango (reempaque)', 'Aire en el paquete', 'Conteo / pesado de meatballs', 'Limpieza', 'Falta de personal', 'Break'] },
  MFO: { lineWord: 'Línea', unit: 'Bin', plural: 'Bins', done: 'Bin listo', qty: 'ask', qtyQ: '¿Cuántas cajas lleva este bin?', qtyUnit: 'cajas', perUnitLabel: '', refLabel: 'N° de bin', reasons: ['Armado de máquina', 'Pegado de labels / stickers', 'Esperando gas', 'Falta de producto del freezer', 'Preparación (picar pollo…)', 'Falta de material', 'Máquina / mantenimiento', 'Limpieza', 'Falta de personal', 'Break'] },
  Packing: { lineWord: 'Línea', unit: 'Pallet', plural: 'Pallets', done: 'Pallet listo', qty: 'ask', qtyQ: '¿Cuántas cajas lleva este pallet?', qtyUnit: 'cajas', perUnitLabel: 'Cajas por pallet', refLabel: 'N° de tag', reasons: ['Falta de producto que empacar', 'Esperando autorización de QC', 'Label equivocado (despegar labels)', 'Plástico / film', 'Falta de cajas / material de empaque', 'Personal pasó a otra línea', 'Etiquetadora / impresora', 'Montacargas / espacio', 'Máquina / mantenimiento', 'Limpieza', 'Falta de personal', 'Break'] },
}

export type Line = { id: string; dept: Dept; name: string }
/** one finished unit of work (a cart, a mezcla, a pallet…), how much it carried and its tag / bin number */
export type Unit = { at: number; qty: number | null; ref: string }
/** one product code run on one line: the clock starts at startedAt; perUnit = quantity per unit (boxes per pallet, pouches per cart) */
export type Run = { id: string; dept: Dept; lineId: string; line: string; code: string; lot: string; date: string; startedAt: number; endedAt: number | null; units: Unit[]; perUnit: number | null; by: string }
/** a stop with its reason; lineId null = the whole department */
export type Stop = { id: string; dept: Dept; lineId: string | null; reason: string; note: string; startedAt: number; endedAt: number | null; by: string }
/**
 * The office's master table ("YIEL CALCULO" + cases per pallet + pouches per cart): with it, mezclas become expected
 * pouches, cases and pallets. The demo ships with made-up example products; the real ones are typed on the device.
 */
export type Product = { code: string; name: string; pouchesPerCase: number; casesPerMix: number; cratesPerCart: number; pouchesPerCrate: number; casesPerPallet: number }
/** "12x10" in the office's RTE sheet: crates per cart × pouches per crate */
export const cartPouches = (p: Product) => p.cratesPerCart * p.pouchesPerCrate
/** mezclas scheduled per day and code ("SCHEDULE" in the office's AVANCE sheet) */
export type Schedule = Record<string, Record<string, number>>
export type State = { lines: Line[]; runs: Run[]; stops: Stop[]; products: Product[]; schedule: Schedule }
const SAMPLE_PRODUCTS: Product[] = [
  { code: 'A100', name: 'Meatballs 2.4 oz · pouch 48 oz', pouchesPerCase: 8, casesPerMix: 18, cratesPerCart: 12, pouchesPerCrate: 10, casesPerPallet: 36 },
  { code: 'B200', name: 'Stuffed peppers · pouch 60 oz', pouchesPerCase: 8, casesPerMix: 6, cratesPerCart: 12, pouchesPerCrate: 6, casesPerPallet: 40 },
  { code: 'C300', name: 'Turkey meatballs 1.1 oz · pouch 16 oz', pouchesPerCase: 6, casesPerMix: 70, cratesPerCart: 12, pouchesPerCrate: 20, casesPerPallet: 105 },
  { code: 'D400', name: 'Meatballs 2.4 oz · pouch 4.5 lb', pouchesPerCase: 2, casesPerMix: 50, cratesPerCart: 12, pouchesPerCrate: 6, casesPerPallet: 105 },
  { code: 'E500', name: 'Rice · pouch 60 oz', pouchesPerCase: 5, casesPerMix: 20, cratesPerCart: 12, pouchesPerCrate: 6, casesPerPallet: 105 },
]

const KEY = 'act_v1'
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))
const pad = (n: number) => String(n).padStart(2, '0')
export const dayOf = (ms: number) => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) }
export const today = () => dayOf(Date.now())
/** the plant's lot number is the Julian date: last digit of the year + day of the year (10/07/2026 → 6280) */
export function lotFor(ds: string) {
  const [y, m, d] = ds.split('-').map(Number)
  if (!y || !m || !d) return ''
  const day = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1
  return String(y % 10) + String(day).padStart(3, '0')
}

function fresh(): State { return { lines: DEPTS.map((d) => ({ id: uid(), dept: d, name: CFG[d].lineWord + ' 1' })), runs: [], stops: [], products: SAMPLE_PRODUCTS, schedule: {} } }
function load(): State {
  try {
    type Raw = { lines: Line[]; stops: Stop[]; runs: (Omit<Run, 'units' | 'perUnit'> & { units?: Partial<Unit>[]; perUnit?: number | null; carts?: number[] })[]; products?: (Partial<Product> & { pouchesPerCart?: number })[]; schedule?: Schedule }
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as Raw | null
    // runs saved by earlier demos counted carts as plain timestamps, then units without a tag number; products had
    // the pouches per cart as one number
    if (s && s.lines && s.runs && s.stops) {
      const units = (r: Raw['runs'][number]): Unit[] => (r.units ? r.units.map((u) => ({ at: u.at ?? 0, qty: u.qty ?? null, ref: u.ref ?? '' })) : (r.carts ?? []).map((at) => ({ at, qty: null, ref: '' })))
      const products: Product[] = s.products ? s.products.map((p) => ({ code: p.code ?? '', name: p.name ?? '', pouchesPerCase: p.pouchesPerCase ?? 0, casesPerMix: p.casesPerMix ?? 0, cratesPerCart: p.cratesPerCart ?? (p.pouchesPerCart ? 12 : 0), pouchesPerCrate: p.pouchesPerCrate ?? (p.pouchesPerCart ? Math.round(p.pouchesPerCart / 12) : 0), casesPerPallet: p.casesPerPallet ?? 0 })) : SAMPLE_PRODUCTS
      return { lines: s.lines, stops: s.stops, runs: s.runs.map((r) => ({ ...r, units: units(r), perUnit: r.perUnit ?? null })), products, schedule: s.schedule ?? {} }
    }
  } catch { /* empty */ }
  return fresh()
}
let state = load()
const subs = new Set<() => void>()
function set(next: State) { state = next; try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* full */ } subs.forEach((f) => f()) }
export const store = { get: () => state, subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f) } } }
const pref = (k: string) => ({
  get: () => { try { return localStorage.getItem(k) || '' } catch { return '' } },
  set: (v: string) => { try { localStorage.setItem(k, v) } catch { /* private */ } },
})
/** who is using this device, and the department they picked when entering */
export const user = pref('act_user')
export const myDept = pref('act_dept')

export function addLine(dept: Dept) { const n = state.lines.filter((l) => l.dept === dept).length + 1; set({ ...state, lines: [...state.lines, { id: uid(), dept, name: CFG[dept].lineWord + ' ' + n }] }) }
export function removeLine(id: string) { set({ ...state, lines: state.lines.filter((l) => l.id !== id) }) }
export function startRun(line: Line, code: string, lot: string, date: string, perUnit: number | null) {
  set({ ...state, runs: [...state.runs, { id: uid(), dept: line.dept, lineId: line.id, line: line.name, code, lot, date, startedAt: Date.now(), endedAt: null, units: [], perUnit, by: user.get() }] })
}
export function unitDone(runId: string, qty: number | null, ref = '') { set({ ...state, runs: state.runs.map((r) => (r.id === runId ? { ...r, units: [...r.units, { at: Date.now(), qty, ref }] } : r)) }) }
export function endRun(runId: string) { set({ ...state, runs: state.runs.map((r) => (r.id === runId ? { ...r, endedAt: Date.now() } : r)) }) }
export function startStop(dept: Dept, lineId: string | null, reason: string, note: string) {
  set({ ...state, stops: [...state.stops, { id: uid(), dept, lineId, reason, note, startedAt: Date.now(), endedAt: null, by: user.get() }] })
}
export function endStop(id: string) { set({ ...state, stops: state.stops.map((x) => (x.id === id ? { ...x, endedAt: Date.now() } : x)) }) }
export function reset() { set(fresh()) }
export const productOf = (s: State, code: string) => s.products.find((p) => p.code.trim().toUpperCase() === code.trim().toUpperCase())
/** saves a product by its position in the list (a new one goes at the end) */
export function saveProduct(i: number, p: Product) { const products = [...state.products]; if (i >= products.length) products.push(p); else products[i] = p; set({ ...state, products }) }
export function removeProduct(i: number) { set({ ...state, products: state.products.filter((_, k) => k !== i) }) }
/** products loaded from the office's file: an existing code is updated (blank numbers keep what was there), a new one is added */
export function mergeProducts(list: Product[]) {
  const products = [...state.products]
  for (const p of list) {
    const i = products.findIndex((x) => x.code.trim().toUpperCase() === p.code.trim().toUpperCase())
    if (i < 0) products.push(p)
    else products[i] = { ...products[i], name: p.name || products[i].name, pouchesPerCase: p.pouchesPerCase || products[i].pouchesPerCase, casesPerMix: p.casesPerMix || products[i].casesPerMix, cratesPerCart: p.cratesPerCart || products[i].cratesPerCart, pouchesPerCrate: p.pouchesPerCrate || products[i].pouchesPerCrate, casesPerPallet: p.casesPerPallet || products[i].casesPerPallet }
  }
  set({ ...state, products })
}
/** the office's CSV (columns found by their names, in Spanish or English) → products; returns what could be read */
export function parseProductsCsv(text: string): Product[] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (q) { if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch }
    else if (ch === '"') q = true
    else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase())
  const find = (...keys: string[]) => head.findIndex((h) => keys.some((k) => h.includes(k)))
  const cCode = find('código', 'codigo', 'code'), cName = find('producto rte', 'producto', 'r-t-e', 'item', 'name')
  const cPpc = find('pouches por caja', 'pouches/'), cYield = find('cajas por mezcla', 'yield x'), cPallet = find('cajas por pallet', 'palet')
  const cCrates = find('guacales'), cPerCrate = find('pouches por guacal')
  const n = (r: string[], c: number) => (c < 0 ? 0 : Number(String(r[c] ?? '').replace(',', '.').trim()) || 0)
  const out: Product[] = []
  for (const r of rows) {
    const code = cCode < 0 ? '' : String(r[cCode] ?? '').trim().toUpperCase()
    if (!code) continue
    out.push({ code, name: cName < 0 ? '' : String(r[cName] ?? '').trim(), pouchesPerCase: n(r, cPpc), casesPerMix: n(r, cYield), cratesPerCart: n(r, cCrates), pouchesPerCrate: n(r, cPerCrate), casesPerPallet: n(r, cPallet) })
  }
  return out
}
export function productsCsv(products: Product[]) {
  const q = (v: string | number) => '"' + String(v).replace(/"/g, '""') + '"'
  const head = ['Código', 'Producto', 'Pouches por caja', 'Cajas por mezcla (yield)', 'Cajas por pallet', 'Guacales por carro', 'Pouches por guacal']
  return '﻿' + [head, ...products.map((p) => [p.code, p.name, p.pouchesPerCase, p.casesPerMix, p.casesPerPallet, p.cratesPerCart, p.pouchesPerCrate])].map((r) => r.map(q).join(',')).join('\r\n')
}
export function setSchedule(date: string, code: string, n: number) { set({ ...state, schedule: { ...state.schedule, [date]: { ...(state.schedule[date] ?? {}), [code.trim().toUpperCase()]: n } } }) }

export const openRun = (s: State, lineId: string) => s.runs.find((r) => r.lineId === lineId && !r.endedAt)
/** the stop holding this line right now: its own, or one of the whole department */
export const openStop = (s: State, dept: Dept, lineId: string) => s.stops.find((x) => !x.endedAt && x.dept === dept && (x.lineId === lineId || x.lineId === null))
export const deptStop = (s: State, dept: Dept) => s.stops.find((x) => !x.endedAt && x.dept === dept && x.lineId === null)
export const stopsOf = (s: State, dept: Dept, lineId: string) => s.stops.filter((x) => x.dept === dept && (x.lineId === lineId || x.lineId === null))
/** the quantity per unit for this code: the last time this department ran it, or else the master table */
export function lastPerUnit(s: State, dept: Dept, code: string) {
  const last = [...s.runs].reverse().find((r) => r.dept === dept && r.code === code.trim().toUpperCase() && r.perUnit != null)?.perUnit
  if (last != null) return last
  const p = productOf(s, code)
  return p ? (dept === 'RTE' ? cartPouches(p) : dept === 'Packing' ? p.casesPerPallet : null) || null : null
}

const overlap = (a: number, b: number, x: Stop, now: number) => Math.max(0, Math.min(b, x.endedAt ?? now) - Math.max(a, x.startedAt))
/** time between two moments without what was spent stopped */
export const activeBetween = (a: number, b: number, stops: Stop[], now: number) => Math.max(0, b - a - stops.reduce((t, x) => t + overlap(a, b, x, now), 0))

export function runStats(s: State, r: Run, now: number) {
  const stops = stopsOf(s, r.dept, r.lineId), end = r.endedAt ?? now
  const working = activeBetween(r.startedAt, end, stops, now)
  const down = stops.reduce((t, x) => t + overlap(r.startedAt, end, x, now), 0)
  const unitTimes = r.units.map((u, i) => activeBetween(i ? r.units[i - 1].at : r.startedAt, u.at, stops, now))
  const avg = unitTimes.length ? unitTimes.reduce((a, b) => a + b, 0) / unitTimes.length : 0
  const qty = r.units.reduce((t, u) => t + (u.qty ?? 0), 0)
  const reasons: Record<string, number> = {}
  for (const x of stops) { const o = overlap(r.startedAt, end, x, now); if (o > 0) reasons[x.reason] = (reasons[x.reason] ?? 0) + o }
  return { working, down, unitTimes, avg, qty, reasons, total: end - r.startedAt }
}
/** "2 carros · 240 pouches": what a run produced, in the department's own words (with the tag / bin numbers if asked) */
export function madeText(r: Run, qty: number, withRefs = false) {
  const c = CFG[r.dept]
  const refs = withRefs ? r.units.map((u) => u.ref).filter(Boolean) : []
  return r.units.length + ' ' + (r.units.length === 1 ? c.unit : c.plural).toLowerCase() + (c.qty !== 'none' ? ' · ' + qty + ' ' + c.qtyUnit : '') + (refs.length ? ' (' + c.refLabel.replace('N° de ', '') + ' ' + refs.join(', ') + ')' : '')
}

export function fmtDur(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  return (h ? h + ':' : '') + pad(m) + ':' + pad(x)
}
export const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
