// Everything is saved on this device first (localStorage). With a server configured (see supabase.ts) every change is
// also queued for upload (outbox.ts) and what other devices send arrives through sync.ts.
import { push } from './outbox'

export type Dept = 'Kitchen' | 'RTE' | 'Spiral' | 'MFO' | 'Packing'
export const DEPTS: Dept[] = ['Kitchen', 'RTE', 'Spiral', 'MFO', 'Packing']

/**
 * How each department counts its work and why its lines stop — the words of the shift manager and of the office
 * sheets ("FORMATO POR CUARTO"): Kitchen cooks mezclas in braisers, Spiral cooks batches (they call them mezclas too),
 * RTE fills carts whose pouches are counted by the office (pouches per cart depend on the code), MFO fills bins and
 * writes the cases and the bin number, Packing builds pallets and writes the cases and the tag number.
 * qty: 'none' = only count the units; 'ask' = ask the quantity each time, proposing the usual one (pouches per
 * cart, boxes per pallet) so a short cart or pallet is typed on the spot; 'auto' = every unit carries the quantity
 * given at the start, with no question.
 */
export type DeptCfg = { lineWord: string; unit: string; plural: string; done: string; qty: 'none' | 'ask' | 'auto'; qtyQ: string; qtyUnit: string; perUnitLabel: string; refLabel: string; reasons: string[]; waste?: boolean }
export const CFG: Record<Dept, DeptCfg> = {
  Kitchen: { lineWord: 'Braiser', unit: 'Mezcla', plural: 'Mezclas', done: 'Mezcla lista', qty: 'none', qtyQ: '', qtyUnit: '', perUnitLabel: '', refLabel: '', reasons: ['Braiser apagado', 'Esperando ingredientes', 'Esperando que recojan producto', 'Máquina / mantenimiento', 'Limpieza', 'Falta de personal', 'Break', 'Calidad'] },
  Spiral: { lineWord: 'Línea', unit: 'Mezcla', plural: 'Mezclas', done: 'Mezcla lista', qty: 'none', qtyQ: '', qtyUnit: '', perUnitLabel: '', refLabel: '', reasons: ['Falta de producto de Kitchen', 'Horno (temperatura)', 'Temperatura interna baja', 'Esperando carros / RTE', 'Máquina / mantenimiento', 'Limpieza', 'Falta de personal', 'Break', 'Calidad'] },
  RTE: { lineWord: 'Línea', unit: 'Carro', plural: 'Carros', done: 'Carro listo', qty: 'ask', qtyQ: '¿Cuántos pouches lleva este carro?', qtyUnit: 'pouches', perUnitLabel: 'Pouches por carro', refLabel: '', waste: true, reasons: ['Falta de salsa (Kitchen)', 'Falta de arroz / arroz muy frío', 'Falta de carrito vacío', 'Cambio de rollo de plástico', 'Plástico atascado / no corta', 'Máquina corta o rompe paquetes (mecánico)', 'Impresora de sello no imprime', 'Peso fuera de rango (reempaque)', 'Aire en el paquete', 'Conteo / pesado de meatballs', 'Limpieza', 'Falta de personal', 'Break'] },
  MFO: { lineWord: 'Línea', unit: 'Bin', plural: 'Bins', done: 'Bin listo', qty: 'ask', qtyQ: '¿Cuántas cajas lleva este bin?', qtyUnit: 'cajas', perUnitLabel: '', refLabel: 'N° de bin', reasons: ['Armado de máquina', 'Pegado de labels / stickers', 'Esperando gas', 'Falta de producto del freezer', 'Preparación (picar pollo…)', 'Falta de material', 'Máquina / mantenimiento', 'Limpieza', 'Falta de personal', 'Break'] },
  Packing: { lineWord: 'Línea', unit: 'Pallet', plural: 'Pallets', done: 'Pallet listo', qty: 'ask', qtyQ: '¿Cuántas cajas lleva este pallet?', qtyUnit: 'cajas', perUnitLabel: 'Cajas por pallet', refLabel: 'N° de tag', reasons: ['Falta de producto que empacar', 'Esperando autorización de QC', 'Label equivocado (despegar labels)', 'Plástico / film', 'Falta de cajas / material de empaque', 'Personal pasó a otra línea', 'Etiquetadora / impresora', 'Montacargas / espacio', 'Máquina / mantenimiento', 'Limpieza', 'Falta de personal', 'Break'] },
}

export type Line = { id: string; dept: Dept; name: string; updatedAt: number; deleted?: boolean }
/** one finished unit of work (a cart, a mezcla, a pallet…), how much it carried, its tag / bin number and who tapped it */
export type Unit = { at: number; qty: number | null; ref: string; by: string }
/**
 * one product code run on one line: the clock starts at startedAt; perUnit = quantity per unit (boxes per pallet,
 * pouches per cart); waste = pounds thrown away while running it (the WASTE column of the office's RTE sheet)
 */
export type Run = { id: string; dept: Dept; lineId: string; line: string; code: string; lot: string; date: string; startedAt: number; endedAt: number | null; units: Unit[]; perUnit: number | null; waste: number; by: string; updatedAt: number; deleted?: boolean }
/** a stop with its reason; lineId null = the whole department */
export type Stop = { id: string; dept: Dept; lineId: string | null; reason: string; note: string; startedAt: number; endedAt: number | null; by: string; updatedAt: number; deleted?: boolean }
/**
 * The office's master table ("YIEL CALCULO" + cases per pallet + pouches per cart): with it, mezclas become expected
 * pouches, cases and pallets. The demo ships with made-up example products; the real ones are typed or imported.
 */
export type Product = { code: string; name: string; pouchesPerCase: number; casesPerMix: number; cratesPerCart: number; pouchesPerCrate: number; casesPerPallet: number; updatedAt: number; deleted?: boolean }
/** "12x10" in the office's RTE sheet: crates per cart × pouches per crate */
export const cartPouches = (p: Product) => p.cratesPerCart * p.pouchesPerCrate
/** mezclas scheduled per day and code ("SCHEDULE" in the office's AVANCE sheet) */
export type Schedule = Record<string, Record<string, number>>
/** one line of history: who changed what, when, from → to (corrections, the products table, the day's program, the lines) */
export type Change = { id: string; at: number; by: string; dept: Dept | null; what: string; before: string; after: string; refTable: string; refKey: string; updatedAt: number; deleted?: boolean }
export type State = { lines: Line[]; runs: Run[]; stops: Stop[]; products: Product[]; schedule: Schedule; changes: Change[] }

/** a cart has two columns of 12 crates (the office counts columns: "12x10" = 12 crates × 10 pouches) */
export const CRATES_PER_CART = 24
/** how long a device keeps the history (the server keeps all of it) */
const KEEP_CHANGES_MS = 120 * 86_400_000
const SAMPLE_PRODUCTS: Product[] = [
  { code: 'A100', name: 'Meatballs 2.4 oz · pouch 48 oz', pouchesPerCase: 8, casesPerMix: 18, cratesPerCart: 24, pouchesPerCrate: 10, casesPerPallet: 36, updatedAt: 0 },
  { code: 'B200', name: 'Stuffed peppers · pouch 60 oz', pouchesPerCase: 8, casesPerMix: 6, cratesPerCart: 24, pouchesPerCrate: 6, casesPerPallet: 40, updatedAt: 0 },
  { code: 'C300', name: 'Turkey meatballs 1.1 oz · pouch 16 oz', pouchesPerCase: 6, casesPerMix: 70, cratesPerCart: 24, pouchesPerCrate: 20, casesPerPallet: 105, updatedAt: 0 },
  { code: 'D400', name: 'Meatballs 2.4 oz · pouch 4.5 lb', pouchesPerCase: 2, casesPerMix: 50, cratesPerCart: 24, pouchesPerCrate: 6, casesPerPallet: 105, updatedAt: 0 },
  { code: 'E500', name: 'Rice · pouch 60 oz', pouchesPerCase: 5, casesPerMix: 20, cratesPerCart: 24, pouchesPerCrate: 6, casesPerPallet: 105, updatedAt: 0 },
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
/** the office writes 889, the ticket and the boxes say 0889: a numeric code is the same with or without leading zeros */
export const normCode = (c: string) => { const u = c.trim().toUpperCase(); return /^\d+$/.test(u) ? String(Number(u)) : u }

/** with a server the lines (and products) are shared and come from it; without one, each device starts with a line per room */
const SERVER = !!import.meta.env.VITE_SUPABASE_URL
function fresh(): State { return { lines: SERVER ? [] : DEPTS.map((d) => ({ id: uid(), dept: d, name: CFG[d].lineWord + ' 1', updatedAt: 0 })), runs: [], stops: [], products: SERVER ? [] : SAMPLE_PRODUCTS, schedule: {}, changes: [] } }
function load(): State {
  try {
    type Raw = { lines: Partial<Line>[]; stops: Partial<Stop>[]; runs: (Partial<Run> & { units?: Partial<Unit>[]; carts?: number[] })[]; products?: (Partial<Product> & { pouchesPerCart?: number })[]; schedule?: Schedule; changes?: Partial<Change>[] }
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as Raw | null
    // rows saved by earlier versions: carts as plain timestamps, units without a tag or a name, products with one
    // pouches-per-cart number, nothing with an update time
    if (s && s.lines && s.runs && s.stops) {
      const units = (r: Raw['runs'][number]): Unit[] => (r.units ? r.units.map((u) => ({ at: u.at ?? 0, qty: u.qty ?? null, ref: u.ref ?? '', by: u.by ?? '' })) : (r.carts ?? []).map((at) => ({ at, qty: null, ref: '', by: '' })))
      const sample = (code: string) => SAMPLE_PRODUCTS.some((x) => x.code === code)
      const products: Product[] = s.products ? s.products.map((p) => ({ code: p.code ?? '', name: p.name ?? '', pouchesPerCase: p.pouchesPerCase ?? 0, casesPerMix: p.casesPerMix ?? 0, cratesPerCart: (p.cratesPerCart ?? (p.pouchesPerCart ? 12 : 0)) === 12 && sample(p.code ?? '') ? CRATES_PER_CART : p.cratesPerCart ?? (p.pouchesPerCart ? 12 : 0), pouchesPerCrate: p.pouchesPerCrate ?? (p.pouchesPerCart ? Math.round(p.pouchesPerCart / 12) : 0), casesPerPallet: p.casesPerPallet ?? 0, updatedAt: p.updatedAt ?? 0 })) : SAMPLE_PRODUCTS
      return {
        lines: s.lines.map((l) => ({ id: l.id ?? uid(), dept: (l.dept ?? 'Kitchen') as Dept, name: l.name ?? 'Línea 1', updatedAt: l.updatedAt ?? 0 })),
        stops: s.stops.map((x) => ({ id: x.id ?? uid(), dept: (x.dept ?? 'Kitchen') as Dept, lineId: x.lineId ?? null, reason: x.reason ?? '', note: x.note ?? '', startedAt: x.startedAt ?? 0, endedAt: x.endedAt ?? null, by: x.by ?? '', updatedAt: x.updatedAt ?? 0 })),
        runs: s.runs.map((r) => ({ id: r.id ?? uid(), dept: (r.dept ?? 'Kitchen') as Dept, lineId: r.lineId ?? '', line: r.line ?? '', code: r.code ?? '', lot: r.lot ?? '', date: r.date ?? today(), startedAt: r.startedAt ?? 0, endedAt: r.endedAt ?? null, units: units(r), perUnit: r.perUnit ?? null, waste: r.waste ?? 0, by: r.by ?? '', updatedAt: r.updatedAt ?? 0 })),
        products, schedule: s.schedule ?? {},
        changes: (s.changes ?? []).filter((c) => (c.at ?? 0) > Date.now() - KEEP_CHANGES_MS).map((c) => ({ id: c.id ?? uid(), at: c.at ?? 0, by: c.by ?? '', dept: (c.dept ?? null) as Dept | null, what: c.what ?? '', before: c.before ?? '', after: c.after ?? '', refTable: c.refTable ?? '', refKey: c.refKey ?? '', updatedAt: c.updatedAt ?? 0 })),
      }
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
/** who is using this device, the department they picked when entering, and whether they are the manager */
export const user = pref('act_user')
export const myDept = pref('act_dept')
/** 'op' = supervisor / operator: only their department; 'mgr' = manager / office: every department, Avance and reports */
export const role = pref('act_role')
/** the manager's code for the demo without server (with a server the roles come from the employees table) */
const mgrPin = pref('act_mgr_pin')
export const managerPin = { get: () => mgrPin.get() || '1234', set: (v: string) => mgrPin.set(v) }

// ---- rows as the server stores them (see supabase/migrations) ----
const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString())
const fromIso = (s: unknown) => (typeof s === 'string' && s ? Date.parse(s) : null)
const rowOfLine = (l: Line) => ({ id: l.id, dept: l.dept, name: l.name, deleted: !!l.deleted, updated_at: iso(l.updatedAt), updated_by: user.get() })
const rowOfRun = (r: Run) => ({ id: r.id, dept: r.dept, line_id: r.lineId, line: r.line, code: r.code, lot: r.lot, date: r.date, started_at: iso(r.startedAt), ended_at: iso(r.endedAt), units: r.units, per_unit: r.perUnit, waste: r.waste, by_name: r.by, deleted: !!r.deleted, updated_at: iso(r.updatedAt), updated_by: user.get() })
const rowOfStop = (x: Stop) => ({ id: x.id, dept: x.dept, line_id: x.lineId, reason: x.reason, note: x.note, started_at: iso(x.startedAt), ended_at: iso(x.endedAt), by_name: x.by, deleted: !!x.deleted, updated_at: iso(x.updatedAt), updated_by: user.get() })
const rowOfProduct = (p: Product) => ({ code: normCode(p.code), name: p.name, pouches_per_case: p.pouchesPerCase, cases_per_mix: p.casesPerMix, crates_per_cart: p.cratesPerCart, pouches_per_crate: p.pouchesPerCrate, cases_per_pallet: p.casesPerPallet, deleted: !!p.deleted, updated_at: iso(p.updatedAt), updated_by: user.get() })
const rowOfSchedule = (date: string, code: string, mixes: number) => ({ date, code: normCode(code), mixes, updated_at: iso(Date.now()), updated_by: user.get() })
const rowOfChange = (c: Change) => ({ id: c.id, at: iso(c.at), by_name: c.by, dept: c.dept, what: c.what, before: c.before, after: c.after, ref_table: c.refTable, ref_key: c.refKey, deleted: !!c.deleted, updated_at: iso(c.updatedAt), updated_by: user.get() })

// ---- the mutations: each one saves on the device and queues the row for the server ----
const putLine = (l: Line) => { l = { ...l, updatedAt: Date.now() }; set({ ...state, lines: upsertIn(state.lines, l) }); push('act_lines', l.id, rowOfLine(l)) }
const putRun = (r: Run) => {
  // a line this device still holds only locally (from before the server) goes up first, so the run is seen on it everywhere
  const line = state.lines.find((l) => l.id === r.lineId)
  if (line && !line.updatedAt) putLine(line)
  r = { ...r, updatedAt: Date.now() }; set({ ...state, runs: upsertIn(state.runs, r) }); push('act_runs', r.id, rowOfRun(r))
}
/**
 * lines made before this device had a server: the ones of the rooms this person may write are shared once, so every
 * screen shows the same rooms; the rest (an operator's leftover lines of other rooms) are dropped from the device
 */
export function shareLocalLines(canWrite: (dept: Dept) => boolean) {
  const keep = state.lines.filter((l) => l.updatedAt || canWrite(l.dept))
  if (keep.length !== state.lines.length) set({ ...state, lines: keep })
  for (const l of keep) if (!l.updatedAt) putLine(l)
}
const putStop = (x: Stop) => { x = { ...x, updatedAt: Date.now() }; set({ ...state, stops: upsertIn(state.stops, x) }); push('act_stops', x.id, rowOfStop(x)) }
function upsertIn<T extends { id: string; deleted?: boolean }>(list: T[], item: T): T[] {
  const rest = list.filter((x) => x.id !== item.id)
  return item.deleted ? rest : [...rest, item]
}

// ---- the history: who changed what, when ----
const v = (x: unknown) => (x == null || x === '' || x === 0 ? '' : String(x))
const COALESCE_MS = 90_000
/**
 * one line of history. A value retyped by the same person within a minute and a half (keystrokes, a second thought)
 * updates the same line instead of adding one; typed back to what it was, the line is withdrawn.
 */
function logChange(dept: Dept | null, what: string, before: string, after: string, refTable: string, refKey: string) {
  if (before === after) return
  const now = Date.now(), by = user.get()
  const changes = state.changes
  let i = changes.length - 1
  while (i >= 0 && !(changes[i].by === by && changes[i].refTable === refTable && changes[i].what === what && now - changes[i].at < COALESCE_MS)) i--
  const c: Change = i >= 0 ? { ...changes[i], after, updatedAt: now } : { id: uid(), at: now, by, dept, what, before, after, refTable, refKey, updatedAt: now }
  if (c.before === c.after) c.deleted = true
  set({ ...state, changes: upsertIn(changes, c) })
  push('act_changes', c.id, rowOfChange(c))
}
const PRODUCT_FIELDS: [keyof Product, string][] = [['name', 'Producto'], ['pouchesPerCase', 'Pouches / caja'], ['casesPerMix', 'Cajas / mezcla'], ['cratesPerCart', 'Guacales / carro'], ['pouchesPerCrate', 'Pouches / guacal'], ['casesPerPallet', 'Cajas / pallet']]
function logProductDiff(old: Product | undefined, p: Product) {
  if (!old) { if (p.code.trim()) logChange(null, 'Producto nuevo', '', p.code, 'act_products', normCode(p.code)); return }
  if (normCode(old.code) !== normCode(p.code)) logChange(null, 'Producto · Código', old.code, p.code, 'act_products', normCode(p.code))
  for (const [k, label] of PRODUCT_FIELDS) if (v(old[k]) !== v(p[k])) logChange(null, 'Producto ' + (p.code || old.code) + ' · ' + label, v(old[k]), v(p[k]), 'act_products', normCode(p.code))
}
const stopLine = (x: Stop) => (x.lineId === null ? 'todo ' + x.dept : state.lines.find((l) => l.id === x.lineId)?.name ?? state.runs.find((r) => r.lineId === x.lineId)?.line ?? 'línea')
const endText = (ms: number | null) => (ms ? fmtTime(ms) : 'en curso')

export function addLine(dept: Dept) { const l: Line = { id: uid(), dept, name: CFG[dept].lineWord + ' ' + (state.lines.filter((x) => x.dept === dept).length + 1), updatedAt: 0 }; putLine(l); logChange(dept, 'Línea agregada en ' + dept, '', l.name, 'act_lines', l.id) }
export function removeLine(id: string) { const l = state.lines.find((x) => x.id === id); if (l) { putLine({ ...l, deleted: true }); logChange(l.dept, 'Línea quitada de ' + l.dept, l.name, '', 'act_lines', l.id) } }
export function startRun(line: Line, code: string, lot: string, date: string, perUnit: number | null) {
  putRun({ id: uid(), dept: line.dept, lineId: line.id, line: line.name, code, lot, date, startedAt: Date.now(), endedAt: null, units: [], perUnit, waste: 0, by: user.get(), updatedAt: 0 })
}
const run = (id: string) => state.runs.find((r) => r.id === id)
export function unitDone(runId: string, qty: number | null, ref = '') { const r = run(runId); if (r) putRun({ ...r, units: [...r.units, { at: Date.now(), qty, ref, by: user.get() }] }) }
export function endRun(runId: string) { const r = run(runId); if (r) putRun({ ...r, endedAt: Date.now() }) }
/** pounds thrown away, added to what the run already has */
export function addWaste(runId: string, lb: number) { const r = run(runId); if (r) putRun({ ...r, waste: Math.round((r.waste + lb) * 100) / 100 }) }
/** corrections: a wrong code, lot, quantity, tag or stop is fixed in place */
/** a correction from the editor: saved, and every field that differs goes to the history */
export function updateRun(id: string, patch: Partial<Pick<Run, 'code' | 'lot' | 'date' | 'perUnit' | 'waste' | 'endedAt' | 'units'>>) {
  const r = run(id)
  if (!r) return
  const n = { ...r, ...patch }
  putRun(n)
  const cfg = CFG[r.dept], pre = 'Corrida ' + r.code + ' del ' + r.date + ' (' + r.dept + ', ' + r.line + ') · '
  const log = (what: string, a: string, b: string) => logChange(r.dept, pre + what, a, b, 'act_runs', r.id)
  log('Código', r.code, n.code); log('Lote', r.lot, n.lot); log('Fecha', r.date, n.date)
  log(cfg.perUnitLabel || 'Por unidad', v(r.perUnit), v(n.perUnit)); log('Waste lb', v(r.waste), v(n.waste)); log('Fin', endText(r.endedAt), endText(n.endedAt))
  r.units.forEach((u, i) => {
    const w = n.units.find((x) => x.at === u.at)
    if (!w) log('Se quitó ' + cfg.unit.toLowerCase() + ' ' + (i + 1) + ' (' + fmtTime(u.at) + ')', [u.qty != null ? u.qty + ' ' + cfg.qtyUnit : '', u.ref].filter(Boolean).join(' · ') || '1', '')
    else { log(cfg.unit + ' ' + (i + 1) + ' · cantidad', v(u.qty), v(w.qty)); if (cfg.refLabel) log(cfg.unit + ' ' + (i + 1) + ' · ' + cfg.refLabel, u.ref, w.ref) }
  })
}
export function deleteRun(id: string) { const r = run(id); if (r) { putRun({ ...r, deleted: true }); logChange(r.dept, 'Se borró la corrida ' + r.code + ' del ' + r.date + ' (' + r.dept + ', ' + r.line + ')', r.units.length + ' ' + CFG[r.dept].plural.toLowerCase() + (r.waste ? ' · waste ' + r.waste + ' lb' : ''), '', 'act_runs', r.id) } }
export function startStop(dept: Dept, lineId: string | null, reason: string, note: string) {
  putStop({ id: uid(), dept, lineId, reason, note, startedAt: Date.now(), endedAt: null, by: user.get(), updatedAt: 0 })
}
const stop = (id: string) => state.stops.find((x) => x.id === id)
export function endStop(id: string) { const x = stop(id); if (x) putStop({ ...x, endedAt: Date.now() }) }
export function updateStop(id: string, patch: Partial<Pick<Stop, 'reason' | 'note' | 'startedAt' | 'endedAt'>>) {
  const x = stop(id)
  if (!x) return
  const n = { ...x, ...patch }
  putStop(n)
  const pre = 'Paro ' + x.dept + ' ' + dayOf(x.startedAt) + ' ' + fmtTime(x.startedAt) + ' (' + stopLine(x) + ') · '
  const log = (what: string, a: string, b: string) => logChange(x.dept, pre + what, a, b, 'act_stops', x.id)
  log('Motivo', x.reason, n.reason); log('Detalle', x.note, n.note); log('Inicio', fmtTime(x.startedAt), fmtTime(n.startedAt)); log('Fin', endText(x.endedAt), endText(n.endedAt))
}
export function deleteStop(id: string) { const x = stop(id); if (x) { putStop({ ...x, deleted: true }); logChange(x.dept, 'Se borró el paro ' + x.dept + ' ' + dayOf(x.startedAt) + ' ' + fmtTime(x.startedAt) + ' (' + stopLine(x) + ')', x.reason + (x.note ? ' · ' + x.note : '') + ' · ' + fmtTime(x.startedAt) + '–' + endText(x.endedAt), '', 'act_stops', x.id) } }
/** everyone who took part in a run: who started it and who tapped its units (a break cover shows up by name) */
export function whoText(r: Run) { return [...new Set([r.by, ...r.units.map((u) => u.by)].filter(Boolean))].join(', ') }

/** with a server: the device is emptied and everything comes down again (the server keeps the truth); the pull cursor is cleared so nothing is skipped */
const resync = () => { if (SERVER) { try { localStorage.removeItem('act_since2'); localStorage.removeItem('act_outbox') } catch { /* private */ } window.dispatchEvent(new Event('act-resync')) } }
export function reset() { set(fresh()); resync() }
/** a clean slate for the records only: runs, stops and the schedule go; the lines and the products table stay */
export function resetRecords() { set({ ...state, runs: [], stops: [], schedule: {}, changes: [] }); resync() }

export const productOf = (s: State, code: string) => s.products.find((p) => normCode(p.code) === normCode(code))
/** saves a product by its position in the list (a new one goes at the end); a code that changed retires the old row on the server */
export function saveProduct(i: number, p: Product) {
  const products = [...state.products]
  const old = products[i]
  p = { ...p, updatedAt: Date.now() }
  if (i >= products.length) products.push(p); else products[i] = p
  set({ ...state, products })
  if (old && old.code.trim() && normCode(old.code) !== normCode(p.code)) push('act_products', normCode(old.code), rowOfProduct({ ...old, deleted: true, updatedAt: Date.now() }))
  if (p.code.trim()) push('act_products', normCode(p.code), rowOfProduct(p))
  logProductDiff(old, p)
}
export function removeProduct(i: number) {
  const p = state.products[i]
  set({ ...state, products: state.products.filter((_, k) => k !== i) })
  if (p && p.code.trim()) push('act_products', normCode(p.code), rowOfProduct({ ...p, deleted: true, updatedAt: Date.now() }))
  if (p) logChange(null, 'Producto ' + (p.code || '(sin código)') + ' quitado', p.name || p.code, '', 'act_products', normCode(p.code))
}
/** products loaded from the office's file: an existing code is updated (blank numbers keep what was there), a new one is added */
export function mergeProducts(list: Product[]) {
  const products = [...state.products]
  let added = 0, changed = 0
  for (const p of list) {
    const i = products.findIndex((x) => normCode(x.code) === normCode(p.code))
    const merged: Product = i < 0 ? { ...p, updatedAt: Date.now() } : { ...products[i], name: p.name || products[i].name, pouchesPerCase: p.pouchesPerCase || products[i].pouchesPerCase, casesPerMix: p.casesPerMix || products[i].casesPerMix, cratesPerCart: p.cratesPerCart || products[i].cratesPerCart, pouchesPerCrate: p.pouchesPerCrate || products[i].pouchesPerCrate, casesPerPallet: p.casesPerPallet || products[i].casesPerPallet, updatedAt: Date.now() }
    if (i < 0) { products.push(merged); added++ } else { if (PRODUCT_FIELDS.some(([k]) => v(products[i][k]) !== v(merged[k]))) { changed++; logProductDiff(products[i], merged) } products[i] = merged }
    push('act_products', normCode(merged.code), rowOfProduct(merged))
  }
  set({ ...state, products })
  logChange(null, 'Importó el CSV de productos', '', list.length + ' productos · ' + added + ' nuevos · ' + changed + ' con cambios', 'act_products', '')
}
export function setSchedule(date: string, code: string, n: number) {
  const key = code.trim().toUpperCase(), before = state.schedule[date]?.[key] ?? 0
  set({ ...state, schedule: { ...state.schedule, [date]: { ...(state.schedule[date] ?? {}), [key]: n } } })
  push('act_schedule', date + '|' + normCode(code), rowOfSchedule(date, code, n))
  logChange(null, 'Programa ' + date + ' · ' + key + ' mezclas', v(before), v(n), 'act_schedule', date + '|' + normCode(code))
}

/** a row that arrived from the server (another tablet, the office): kept only if it is newer than what this device has */
export function applyRemote(table: string, row: Record<string, unknown>) {
  const at = fromIso(row.updated_at) ?? 0
  const newer = <T extends { updatedAt: number }>(cur: T | undefined) => !cur || at >= cur.updatedAt
  if (table === 'act_lines') {
    const cur = state.lines.find((l) => l.id === row.id)
    if (!newer(cur)) return
    const l: Line = { id: String(row.id), dept: row.dept as Dept, name: String(row.name ?? ''), updatedAt: at, deleted: !!row.deleted }
    set({ ...state, lines: upsertIn(state.lines, l) })
  } else if (table === 'act_runs') {
    const cur = state.runs.find((r) => r.id === row.id)
    if (!newer(cur)) return
    const units = Array.isArray(row.units) ? (row.units as Partial<Unit>[]).map((u) => ({ at: u.at ?? 0, qty: u.qty ?? null, ref: u.ref ?? '', by: u.by ?? '' })) : []
    const r: Run = { id: String(row.id), dept: row.dept as Dept, lineId: String(row.line_id ?? ''), line: String(row.line ?? ''), code: String(row.code ?? ''), lot: String(row.lot ?? ''), date: String(row.date ?? '').slice(0, 10), startedAt: fromIso(row.started_at) ?? 0, endedAt: fromIso(row.ended_at), units, perUnit: row.per_unit == null ? null : Number(row.per_unit), waste: Number(row.waste ?? 0), by: String(row.by_name ?? ''), updatedAt: at, deleted: !!row.deleted }
    set({ ...state, runs: upsertIn(state.runs, r) })
  } else if (table === 'act_stops') {
    const cur = state.stops.find((x) => x.id === row.id)
    if (!newer(cur)) return
    const x: Stop = { id: String(row.id), dept: row.dept as Dept, lineId: row.line_id == null ? null : String(row.line_id), reason: String(row.reason ?? ''), note: String(row.note ?? ''), startedAt: fromIso(row.started_at) ?? 0, endedAt: fromIso(row.ended_at), by: String(row.by_name ?? ''), updatedAt: at, deleted: !!row.deleted }
    set({ ...state, stops: upsertIn(state.stops, x) })
  } else if (table === 'act_products') {
    const code = String(row.code ?? '')
    const i = state.products.findIndex((p) => normCode(p.code) === normCode(code))
    const cur = i >= 0 ? state.products[i] : undefined
    if (!newer(cur)) return
    const p: Product = { code, name: String(row.name ?? ''), pouchesPerCase: Number(row.pouches_per_case ?? 0), casesPerMix: Number(row.cases_per_mix ?? 0), cratesPerCart: Number(row.crates_per_cart ?? 0), pouchesPerCrate: Number(row.pouches_per_crate ?? 0), casesPerPallet: Number(row.cases_per_pallet ?? 0), updatedAt: at }
    const products = state.products.filter((x) => normCode(x.code) !== normCode(code))
    set({ ...state, products: row.deleted ? products : [...products, p] })
  } else if (table === 'act_schedule') {
    const date = String(row.date ?? '').slice(0, 10), code = String(row.code ?? '')
    set({ ...state, schedule: { ...state.schedule, [date]: { ...(state.schedule[date] ?? {}), [code]: Number(row.mixes ?? 0) } } })
  } else if (table === 'act_changes') {
    const cur = state.changes.find((c) => c.id === row.id)
    if (!newer(cur)) return
    const c: Change = { id: String(row.id), at: fromIso(row.at) ?? 0, by: String(row.by_name ?? ''), dept: (row.dept ?? null) as Dept | null, what: String(row.what ?? ''), before: String(row.before ?? ''), after: String(row.after ?? ''), refTable: String(row.ref_table ?? ''), refKey: String(row.ref_key ?? ''), updatedAt: at, deleted: !!row.deleted }
    set({ ...state, changes: upsertIn(state.changes, c) })
  }
}
/** everything this device holds, queued for the server (the pilot's tablets bring their days along) */
export function uploadAll() {
  let n = 0
  for (const l of state.lines) { push('act_lines', l.id, rowOfLine({ ...l, updatedAt: l.updatedAt || Date.now() })); n++ }
  for (const r of state.runs) { push('act_runs', r.id, rowOfRun({ ...r, updatedAt: r.updatedAt || Date.now() })); n++ }
  for (const x of state.stops) { push('act_stops', x.id, rowOfStop({ ...x, updatedAt: x.updatedAt || Date.now() })); n++ }
  for (const p of state.products) if (p.code.trim()) { push('act_products', normCode(p.code), rowOfProduct({ ...p, updatedAt: p.updatedAt || Date.now() })); n++ }
  for (const [date, codes] of Object.entries(state.schedule)) for (const [code, mixes] of Object.entries(codes)) { push('act_schedule', date + '|' + normCode(code), rowOfSchedule(date, code, mixes)); n++ }
  for (const c of state.changes) { push('act_changes', c.id, rowOfChange(c)); n++ }
  return n
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
    out.push({ code, name: cName < 0 ? '' : String(r[cName] ?? '').trim(), pouchesPerCase: n(r, cPpc), casesPerMix: n(r, cYield), cratesPerCart: n(r, cCrates), pouchesPerCrate: n(r, cPerCrate), casesPerPallet: n(r, cPallet), updatedAt: 0 })
  }
  return out
}
export function productsCsv(products: Product[]) {
  const q = (v: string | number) => '"' + String(v).replace(/"/g, '""') + '"'
  const head = ['Código', 'Producto', 'Pouches por caja', 'Cajas por mezcla (yield)', 'Cajas por pallet', 'Guacales por carro', 'Pouches por guacal']
  return '﻿' + [head, ...products.map((p) => [p.code, p.name, p.pouchesPerCase, p.casesPerMix, p.casesPerPallet, p.cratesPerCart, p.pouchesPerCrate])].map((r) => r.map(q).join(',')).join('\r\n')
}

export const openRun = (s: State, lineId: string) => s.runs.find((r) => r.lineId === lineId && !r.endedAt)
/** the stop holding this line right now: its own, or one of the whole department */
export const openStop = (s: State, dept: Dept, lineId: string) => s.stops.find((x) => !x.endedAt && x.dept === dept && (x.lineId === lineId || x.lineId === null))
export const deptStop = (s: State, dept: Dept) => s.stops.find((x) => !x.endedAt && x.dept === dept && x.lineId === null)
export const stopsOf = (s: State, dept: Dept, lineId: string) => s.stops.filter((x) => x.dept === dept && (x.lineId === lineId || x.lineId === null))
/** the quantity per unit for this code: the last time this department ran it, or else the master table */
export function lastPerUnit(s: State, dept: Dept, code: string) {
  const last = [...s.runs].reverse().find((r) => r.dept === dept && normCode(r.code) === normCode(code) && r.perUnit != null)?.perUnit
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
