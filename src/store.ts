// Everything is saved on this device first (localStorage). With a server configured (see supabase.ts) every change is
// also queued for upload (outbox.ts) and what other devices send arrives through sync.ts.
import { drop, justSent, push, queued, rebase, type Row, type Table } from './outbox'

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
/** the goal the manager set for a room: per hour and/or per shift, in the room's own quantity (pouches, cajas, mezclas) */
export type Target = { dept: Dept; perHour: number | null; perShift: number | null; updatedAt: number }
export type State = { lines: Line[]; runs: Run[]; stops: Stop[]; products: Product[]; schedule: Schedule; changes: Change[]; targets: Target[] }

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
/**
 * one entry per code and day in the program: "0100" and "100" are the same product. (Earlier versions kept what was
 * typed next to what came back from the server, and the two were added up.) The spelling as typed is the newer one
 * when it carries a number; otherwise the plain spelling stands.
 */
function tidySchedule(sch: Schedule): Schedule {
  const out: Schedule = {}
  for (const [date, codes] of Object.entries(sch)) {
    const day: Record<string, number> = {}
    for (const [c, n] of Object.entries(codes)) if (normCode(c) === c) day[c] = n
    for (const [c, n] of Object.entries(codes)) if (normCode(c) !== c && (n || !(normCode(c) in day))) day[normCode(c)] = n
    out[date] = day
  }
  return out
}

/** with a server the lines (and products) are shared and come from it; without one, each device starts with a line per room */
const SERVER = !!import.meta.env.VITE_SUPABASE_URL
function fresh(): State { return { lines: SERVER ? [] : DEPTS.map((d) => ({ id: uid(), dept: d, name: CFG[d].lineWord + ' 1', updatedAt: 0 })), runs: [], stops: [], products: SERVER ? [] : SAMPLE_PRODUCTS, schedule: {}, changes: [], targets: [] } }
function load(): State {
  try {
    type Raw = { lines: Partial<Line>[]; stops: Partial<Stop>[]; runs: (Partial<Run> & { units?: Partial<Unit>[]; carts?: number[] })[]; products?: (Partial<Product> & { pouchesPerCart?: number })[]; schedule?: Schedule; changes?: Partial<Change>[]; targets?: Partial<Target>[] }
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
        products, schedule: tidySchedule(s.schedule ?? {}),
        changes: (s.changes ?? []).filter((c) => (c.at ?? 0) > Date.now() - KEEP_CHANGES_MS).map((c) => ({ id: c.id ?? uid(), at: c.at ?? 0, by: c.by ?? '', dept: (c.dept ?? null) as Dept | null, what: c.what ?? '', before: c.before ?? '', after: c.after ?? '', refTable: c.refTable ?? '', refKey: c.refKey ?? '', updatedAt: c.updatedAt ?? 0 })),
        targets: (s.targets ?? []).filter((t) => DEPTS.includes(t.dept as Dept)).map((t) => ({ dept: t.dept as Dept, perHour: t.perHour ?? null, perShift: t.perShift ?? null, updatedAt: t.updatedAt ?? 0 })),
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
const rowOfTarget = (t: Target) => ({ dept: t.dept, per_hour: t.perHour, per_shift: t.perShift, updated_at: iso(t.updatedAt), updated_by: user.get() })

// ---- the mutations: each one saves on the device and queues the row for the server ----
/** a change is always stamped later than the version it was made from, even when this device's clock runs behind another's */
const stamp = (was: { updatedAt: number } | undefined) => Math.max(Date.now(), (was?.updatedAt ?? 0) + 1)
/** what the server last had of a row (nothing for one never sent): it travels with the queued change, see outbox.ts */
const baseOf = <T extends { updatedAt: number }>(was: T | undefined, row: (x: T) => Row) => (was && was.updatedAt ? row(was) : null)
const putLine = (l: Line) => {
  const was = state.lines.find((x) => x.id === l.id)
  l = { ...l, updatedAt: stamp(was) }; if (l.deleted) gone.set('act_lines|' + l.id, l.updatedAt)
  set({ ...state, lines: upsertIn(state.lines, l) }); push('act_lines', l.id, rowOfLine(l), baseOf(was, rowOfLine))
}
const putRun = (r: Run) => {
  // a line this device still holds only locally (from before the server) goes up first, so the run is seen on it everywhere
  const line = state.lines.find((l) => l.id === r.lineId)
  if (line && !line.updatedAt) putLine(line)
  const was = state.runs.find((x) => x.id === r.id)
  r = { ...r, updatedAt: stamp(was) }; if (r.deleted) gone.set('act_runs|' + r.id, r.updatedAt)
  set({ ...state, runs: upsertIn(state.runs, r) }); push('act_runs', r.id, rowOfRun(r), baseOf(was, rowOfRun))
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
const putStop = (x: Stop) => {
  const was = state.stops.find((y) => y.id === x.id)
  x = { ...x, updatedAt: stamp(was) }; if (x.deleted) gone.set('act_stops|' + x.id, x.updatedAt)
  set({ ...state, stops: upsertIn(state.stops, x) }); push('act_stops', x.id, rowOfStop(x), baseOf(was, rowOfStop))
}
/** a row put in its place: a changed one stays where it was (the lines keep their order on the screen), a new one goes last, a deleted one leaves */
function upsertIn<T extends { id: string; deleted?: boolean }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id)
  if (item.deleted) return i < 0 ? list : list.filter((x) => x.id !== item.id)
  return i < 0 ? [...list, item] : list.map((x, k) => (k === i ? item : x))
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
/** the form of a correction, as the text the person sees and types */
export type RunDraft = { code: string; lot: string; date: string; per: string; waste: string; units: { at: number; qty: string; ref: string; by: string }[] }
export const draftOf = (r: Run): RunDraft => ({ code: r.code, lot: r.lot, date: r.date, per: r.perUnit != null ? String(r.perUnit) : '', waste: r.waste ? String(r.waste) : '', units: r.units.map((u) => ({ at: u.at, qty: u.qty != null ? String(u.qty) : '', ref: u.ref, by: u.by })) })
const typed = (t: string) => { const n = Number(t.replace(',', '.')); return Number.isFinite(n) ? n : 0 }
/**
 * saves a correction on top of what the run is NOW: only what the person changed in the form (against how the form
 * opened) is applied, so a cart tapped on the line while the form was open is kept, not wiped by the form's old list
 */
export function applyDraft(id: string, opened: RunDraft, draft: RunDraft) {
  const r = run(id)
  if (!r) return
  const cfg = CFG[r.dept], patch: Parameters<typeof updateRun>[1] = {}
  const changed = (a: string, b: string) => a.trim() !== b.trim()
  if (changed(draft.code.toUpperCase(), opened.code.toUpperCase()) && draft.code.trim()) patch.code = draft.code.trim().toUpperCase()
  if (changed(draft.lot, opened.lot)) patch.lot = draft.lot.trim()
  if (draft.date && draft.date !== opened.date) patch.date = draft.date
  if (cfg.perUnitLabel && changed(draft.per, opened.per)) patch.perUnit = draft.per.trim() ? typed(draft.per) : null
  if (cfg.waste && changed(draft.waste, opened.waste)) patch.waste = typed(draft.waste)
  const was = new Map(opened.units.map((u) => [u.at, u])), now = new Map(draft.units.map((u) => [u.at, u]))
  const units = r.units.filter((u) => !(was.has(u.at) && !now.has(u.at))).map((u) => {
    const a = was.get(u.at), b = now.get(u.at)
    if (!a || !b) return u // tapped after the form opened: untouched
    const qty = cfg.qty !== 'none' && changed(b.qty, a.qty) ? (b.qty.trim() ? typed(b.qty) : null) : u.qty
    const ref = changed(b.ref, a.ref) ? b.ref.trim() : u.ref
    return qty === u.qty && ref === u.ref ? u : { ...u, qty, ref }
  })
  if (units.length !== r.units.length || units.some((u, i) => u !== r.units[i])) patch.units = units
  if (Object.keys(patch).length) updateRun(id, patch)
}
/** the moment with this clock time ("HH:MM") nearest to `base`: a correction is a small move, also across midnight */
export function nearDay(base: number, hm: string) {
  const [h, m] = hm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return base
  const at = (shift: number) => { const d = new Date(base); d.setDate(d.getDate() + shift); d.setHours(h, m, 0, 0); return d.getTime() }
  return [at(-1), at(0), at(1)].reduce((best, x) => (Math.abs(x - base) < Math.abs(best - base) ? x : best), at(0))
}
/** everyone who took part in a run: who started it and who tapped its units (a break cover shows up by name) */
export function whoText(r: Run) { return [...new Set([r.by, ...r.units.map((u) => u.by)].filter(Boolean))].join(', ') }

/** with a server: the device is emptied and everything comes down again (the server keeps the truth); the pull cursor is cleared so nothing is skipped */
const resync = () => { if (SERVER) { try { localStorage.removeItem('act_since2'); localStorage.removeItem('act_outbox') } catch { /* private */ } window.dispatchEvent(new Event('act-resync')) } }
export function reset() { set(fresh()); resync() }
/** a clean slate for the records only: runs, stops and the schedule go; the lines and the products table stay */
export function resetRecords() { set({ ...state, runs: [], stops: [], schedule: {}, changes: [] }); resync() }

export const productOf = (s: State, code: string) => s.products.find((p) => normCode(p.code) === normCode(code))
/**
 * saves a product by its position in the list (a new one goes at the end); a code that changed retires the old row on
 * the server. Refused (false, nothing saved) when the code already belongs to another product, or when it would leave
 * an existing product without a code.
 */
export function saveProduct(i: number, p: Product): boolean {
  const products = [...state.products]
  const old = products[i]
  const key = normCode(p.code)
  if (key && products.some((x, k) => k !== i && normCode(x.code) === key)) return false
  if (old && old.code.trim() && !key) return false
  p = { ...p, updatedAt: stamp(old) }
  if (i >= products.length) products.push(p); else products[i] = p
  set({ ...state, products })
  if (old && old.code.trim() && normCode(old.code) !== key) push('act_products', normCode(old.code), rowOfProduct({ ...old, deleted: true, updatedAt: stamp(old) }))
  if (key) push('act_products', key, rowOfProduct(p))
  logProductDiff(old, p)
  return true
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
  const key = normCode(code)
  if (!key) return
  const day = { ...(state.schedule[date] ?? {}) }, before = day[key] ?? 0
  for (const c of Object.keys(day)) if (c !== key && normCode(c) === key) delete day[c]
  day[key] = n
  set({ ...state, schedule: { ...state.schedule, [date]: day } })
  push('act_schedule', date + '|' + key, rowOfSchedule(date, key, n))
  logChange(null, 'Programa ' + date + ' · ' + key + ' mezclas', v(before), v(n), 'act_schedule', date + '|' + key)
}
export const targetOf = (s: State, dept: Dept) => s.targets.find((t) => t.dept === dept)
/** the manager's goal for a room (blank = none); it reaches every tablet of the room and the history */
export function setTarget(dept: Dept, perHour: number | null, perShift: number | null) {
  const old = targetOf(state, dept)
  const t: Target = { dept, perHour, perShift, updatedAt: Date.now() }
  set({ ...state, targets: [...state.targets.filter((x) => x.dept !== dept), t] })
  push('act_targets', dept, rowOfTarget(t))
  logChange(dept, 'Meta ' + dept + ' · por hora', v(old?.perHour), v(perHour), 'act_targets', dept)
  logChange(dept, 'Meta ' + dept + ' · por turno', v(old?.perShift), v(perShift), 'act_targets', dept)
}
/**
 * what one unit counts for: its own quantity; without one (old records, a blank left in a correction), the run's
 * quantity per unit, or the master table's. One rule for the line, the report, the room's total and Avance.
 */
export function unitQty(s: State, r: Run, u: Unit): number {
  if (u.qty != null) return u.qty
  if (CFG[r.dept].qty === 'none') return 0
  if (r.perUnit != null) return r.perUnit
  const p = productOf(s, r.code)
  return p ? (r.dept === 'RTE' ? cartPouches(p) : r.dept === 'Packing' ? p.casesPerPallet : 0) : 0
}
/** what a run made, in its room's quantity (pouches, cajas) */
export const runQty = (s: State, r: Run) => r.units.reduce((t, u) => t + unitQty(s, r, u), 0)

/** what a room made on a day with all its lines together: in total, per code, and the pace (made ÷ hours since the first start of the day) */
export function deptToday(s: State, dept: Dept, date: string, now: number) {
  const cfg = CFG[dept]
  const runs = s.runs.filter((r) => r.dept === dept && r.date === date)
  const measure = (r: Run) => (cfg.qty === 'none' ? r.units.length : runQty(s, r))
  const codes = new Map<string, { code: string; units: number; qty: number; waste: number; lines: string[] }>()
  for (const r of runs) {
    const e = codes.get(normCode(r.code)) ?? { code: r.code, units: 0, qty: 0, waste: 0, lines: [] }
    e.units += r.units.length; e.qty += measure(r); e.waste = Math.round((e.waste + r.waste) * 100) / 100
    if (!e.lines.includes(r.line)) e.lines.push(r.line)
    codes.set(normCode(r.code), e)
  }
  const units = runs.reduce((t, r) => t + r.units.length, 0), qty = runs.reduce((t, r) => t + measure(r), 0)
  const first = runs.length ? Math.min(...runs.map((r) => r.startedAt)) : 0
  const allEnded = runs.length > 0 && runs.every((r) => r.endedAt)
  const hours = first ? Math.max(0, (allEnded ? Math.max(...runs.map((r) => r.endedAt ?? 0)) : now) - first) / 3_600_000 : 0
  return { runs, units, qty, unitLabel: cfg.qty === 'none' ? cfg.plural.toLowerCase() : cfg.qtyUnit, byCode: [...codes.values()].sort((a, b) => b.qty - a.qty), hours, rate: hours >= 1 / 6 ? qty / hours : null, allEnded }
}

// ---- what arrives from the server (another tablet, the office) ----
const lineOfRow = (row: Row): Line => ({ id: String(row.id), dept: row.dept as Dept, name: String(row.name ?? ''), updatedAt: fromIso(row.updated_at) ?? 0, deleted: !!row.deleted })
const runOfRow = (row: Row): Run => ({
  id: String(row.id), dept: row.dept as Dept, lineId: String(row.line_id ?? ''), line: String(row.line ?? ''), code: String(row.code ?? ''), lot: String(row.lot ?? ''), date: String(row.date ?? '').slice(0, 10),
  startedAt: fromIso(row.started_at) ?? 0, endedAt: fromIso(row.ended_at),
  units: (Array.isArray(row.units) ? (row.units as Partial<Unit>[]) : []).map((u) => ({ at: u.at ?? 0, qty: u.qty ?? null, ref: u.ref ?? '', by: u.by ?? '' })),
  perUnit: row.per_unit == null ? null : Number(row.per_unit), waste: Number(row.waste ?? 0), by: String(row.by_name ?? ''), updatedAt: fromIso(row.updated_at) ?? 0, deleted: !!row.deleted,
})
const stopOfRow = (row: Row): Stop => ({ id: String(row.id), dept: row.dept as Dept, lineId: row.line_id == null ? null : String(row.line_id), reason: String(row.reason ?? ''), note: String(row.note ?? ''), startedAt: fromIso(row.started_at) ?? 0, endedAt: fromIso(row.ended_at), by: String(row.by_name ?? ''), updatedAt: fromIso(row.updated_at) ?? 0, deleted: !!row.deleted })

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
/** this device's changes (whatever differs from the version it started from) laid over what the server has now */
function merge3<T extends object>(base: T, mine: T, theirs: T, keys: (keyof T)[]): T {
  const out = { ...theirs }
  for (const k of keys) if (!same(mine[k], base[k])) out[k] = mine[k]
  return out
}
const byAt = (a: Unit, b: Unit) => a.at - b.at
/** every unit of the first, plus the ones only the second has */
const allUnits = (first: Run, second: Run) => { const have = new Set(first.units.map((u) => u.at)); return [...first.units, ...second.units.filter((u) => !have.has(u.at))].sort(byAt) }
/**
 * two devices changed the same run from the same version: each one's changes are kept. Units are matched by their
 * moment: the ones I added are added, the one I removed stays removed, the one I corrected keeps my correction; the
 * rest is theirs. Waste is an amount people add to, so both additions count.
 */
function mergeRun(base: Run, mine: Run, theirs: Run): Run {
  const out = merge3(base, mine, theirs, ['dept', 'lineId', 'line', 'code', 'lot', 'date', 'startedAt', 'endedAt', 'perUnit', 'by', 'deleted'])
  const inBase = new Map(base.units.map((u) => [u.at, u])), inMine = new Map(mine.units.map((u) => [u.at, u])), inTheirs = new Set(theirs.units.map((u) => u.at))
  out.units = [
    ...theirs.units.filter((u) => !(inBase.has(u.at) && !inMine.has(u.at))).map((u) => { const m = inMine.get(u.at), b = inBase.get(u.at); return m && b && !same(m, b) ? m : u }),
    ...mine.units.filter((u) => !inBase.has(u.at) && !inTheirs.has(u.at)),
  ].sort(byAt)
  out.waste = mine.waste !== base.waste ? (theirs.waste !== base.waste ? Math.round((theirs.waste + mine.waste - base.waste) * 100) / 100 : mine.waste) : theirs.waste
  return out
}
type Synced = { id: string; updatedAt: number; deleted?: boolean }
/** how one kind of row is read, written and merged; `keep` is for when no common version is known: the newer one stands, and a run never loses a unit */
type Kind<T> = { of: (r: Row) => T; row: (x: T) => Row; merge: (base: T, mine: T, theirs: T) => T; keep: (mine: T, theirs: T, theirsNewer: boolean) => T }
const LINE: Kind<Line> = { of: lineOfRow, row: rowOfLine, merge: (b, m, t) => merge3(b, m, t, ['dept', 'name', 'deleted']), keep: (m, t, n) => (n ? t : m) }
const STOP: Kind<Stop> = { of: stopOfRow, row: rowOfStop, merge: (b, m, t) => merge3(b, m, t, ['dept', 'lineId', 'reason', 'note', 'startedAt', 'endedAt', 'by', 'deleted']), keep: (m, t, n) => (n ? t : m) }
const RUN: Kind<Run> = { of: runOfRow, row: rowOfRun, merge: mergeRun, keep: (m, t, n) => (n ? { ...t, units: allUnits(t, m) } : { ...m, units: allUnits(m, t) }) }
const body = (x: Synced) => JSON.stringify({ ...x, updatedAt: 0 })
/** rows deleted while this page is open, with when: a late echo of an earlier version must not bring one back */
const gone = new Map<string, number>()
/**
 * A row from the server meets what this device has; returns the row to keep here (null = no change).
 * Normally the newer one stands. Two cases put a change of this device at stake, and then nothing is thrown away:
 *  - a change here is still waiting to go up: it is merged with the server's row, from the version both started from;
 *  - the row that arrived is OLDER than what is here (a tablet that was offline, or one that wrote over a newer row):
 *    what is here stays, any unit only the other one has is added, and the server is told again.
 */
function reconcile<T extends Synced>(table: Table, cur: T | undefined, row: Row, k: Kind<T>): T | null {
  const theirs = k.of(row)
  const pend = queued(table, theirs.id)
  const mine = pend ? k.of(pend.row) : cur ? k.of(k.row(cur)) : undefined
  if (theirs.deleted) gone.set(table + '|' + theirs.id, Math.max(theirs.updatedAt, gone.get(table + '|' + theirs.id) ?? 0))
  if (!mine) return !theirs.deleted && theirs.updatedAt < (gone.get(table + '|' + theirs.id) ?? 0) ? null : theirs
  const tb = body(theirs), mb = body(mine)
  if (tb === mb) { if (pend) drop(table, theirs.id); return theirs.updatedAt >= mine.updatedAt ? theirs : null } // the same row (an echo of what was sent)
  const newer = theirs.updatedAt > mine.updatedAt || (theirs.updatedAt === mine.updatedAt && tb > mb)
  if (!pend && newer) return theirs
  const base = pend?.base ? k.of(pend.base) : null
  // a common version is only good for a row that came AFTER it; an older one (a late echo) would undo what lies between
  const forked = !!base && theirs.updatedAt > base.updatedAt
  const merged = base && forked ? k.merge(base, mine, theirs) : k.keep(mine, theirs, newer)
  const gb = body(merged)
  if (gb === tb) { if (pend) drop(table, theirs.id); return theirs }
  if (gb === mb) {
    // nothing of theirs to take. If mine is waiting to go up, it will; if it went up a moment ago this is just a late
    // echo; otherwise the server has fallen behind and is told again
    if (!pend && !justSent(table, theirs.id)) push(table, theirs.id, k.row(mine), row)
    return null
  }
  const next = { ...merged, updatedAt: Math.max(Date.now(), mine.updatedAt + 1, theirs.updatedAt + 1) }
  if (pend && forked) rebase(table, theirs.id, k.row(next), row) // the server's version is theirs now
  else push(table, theirs.id, k.row(next), pend ? undefined : row)
  return next
}

/** a row that arrived from the server: see reconcile() for the lines, runs and stops; the tables only the office edits keep the newer row */
export function applyRemote(table: string, row: Record<string, unknown>) {
  if (!row || (row.id == null && row.code == null && row.dept == null)) return // the notice of a row removed by hand in the database carries nothing
  const at = fromIso(row.updated_at) ?? 0
  const newer = <T extends { updatedAt: number }>(cur: T | undefined) => !cur || at >= cur.updatedAt
  if (table === 'act_lines') {
    const next = reconcile('act_lines', state.lines.find((l) => l.id === row.id), row, LINE)
    if (next) set({ ...state, lines: upsertIn(state.lines, next) })
  } else if (table === 'act_runs') {
    const next = reconcile('act_runs', state.runs.find((r) => r.id === row.id), row, RUN)
    if (next) set({ ...state, runs: upsertIn(state.runs, next) })
  } else if (table === 'act_stops') {
    const next = reconcile('act_stops', state.stops.find((x) => x.id === row.id), row, STOP)
    if (next) set({ ...state, stops: upsertIn(state.stops, next) })
  } else if (table === 'act_products') {
    const code = String(row.code ?? ''), key = normCode(code)
    const i = state.products.findIndex((p) => normCode(p.code) === key)
    const cur = i >= 0 ? state.products[i] : undefined
    if (!newer(cur)) return
    const p: Product = { code, name: String(row.name ?? ''), pouchesPerCase: Number(row.pouches_per_case ?? 0), casesPerMix: Number(row.cases_per_mix ?? 0), cratesPerCart: Number(row.crates_per_cart ?? 0), pouchesPerCrate: Number(row.pouches_per_crate ?? 0), casesPerPallet: Number(row.cases_per_pallet ?? 0), updatedAt: at }
    // the product stays in its place in the table (a changed row must not jump to the end while someone is editing)
    const others = (x: Product, k: number) => k === i || normCode(x.code) !== key
    const products = row.deleted ? state.products.filter((x) => normCode(x.code) !== key) : cur ? state.products.map((x, k) => (k === i ? p : x)).filter(others) : [...state.products, p]
    set({ ...state, products })
  } else if (table === 'act_schedule') {
    const date = String(row.date ?? '').slice(0, 10), code = normCode(String(row.code ?? ''))
    if (!code || queued('act_schedule', date + '|' + code)) return // what was typed here is newer and on its way
    const day = { ...(state.schedule[date] ?? {}) }
    for (const c of Object.keys(day)) if (c !== code && normCode(c) === code) delete day[c]
    day[code] = Number(row.mixes ?? 0)
    set({ ...state, schedule: { ...state.schedule, [date]: day } })
  } else if (table === 'act_changes') {
    const cur = state.changes.find((c) => c.id === row.id)
    if (!newer(cur)) return
    const c: Change = { id: String(row.id), at: fromIso(row.at) ?? 0, by: String(row.by_name ?? ''), dept: (row.dept ?? null) as Dept | null, what: String(row.what ?? ''), before: String(row.before ?? ''), after: String(row.after ?? ''), refTable: String(row.ref_table ?? ''), refKey: String(row.ref_key ?? ''), updatedAt: at, deleted: !!row.deleted }
    set({ ...state, changes: upsertIn(state.changes, c) })
  } else if (table === 'act_targets') {
    const dept = row.dept as Dept
    if (!DEPTS.includes(dept) || !newer(state.targets.find((t) => t.dept === dept))) return
    const t: Target = { dept, perHour: row.per_hour == null ? null : Number(row.per_hour), perShift: row.per_shift == null ? null : Number(row.per_shift), updatedAt: at }
    set({ ...state, targets: [...state.targets.filter((x) => x.dept !== dept), t] })
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
  for (const t of state.targets) { push('act_targets', t.dept, rowOfTarget(t)); n++ }
  return n
}
/** "71.4", "71,4", "1.234,5" or "1,234.5" → a number (0 for a blank or something that is not one) */
export function numOf(text: string) {
  let x = String(text ?? '').replace(/\s/g, '')
  if (!x) return 0
  const dot = x.lastIndexOf('.'), comma = x.lastIndexOf(',')
  if (dot >= 0 && comma >= 0) x = dot > comma ? x.replace(/,/g, '') : x.replace(/\./g, '').replace(',', '.')
  else if (comma >= 0) x = x.replace(',', '.')
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}
/**
 * the office's CSV (columns found by their names, in Spanish or English) → products; returns what could be read.
 * The separator is whichever the header line uses (comma, semicolon or tab: Excel picks it by the PC's language), so a
 * decimal comma inside a semicolon file is a number, not a new column.
 */
export function parseProductsCsv(text: string): Product[] {
  const src = text.replace(/^\uFEFF/, '')
  const headLine = src.split(/\r?\n/, 1)[0] ?? ''
  const count = (ch: string) => { let n = 0, q = false; for (const c of headLine) { if (c === '"') q = !q; else if (!q && c === ch) n++ } return n }
  const sep = [',', ';', '\t'].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',')
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (q) { if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch }
    else if (ch === '"') q = true
    else if (ch === sep) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase())
  const find = (...keys: string[]) => head.findIndex((h) => keys.some((k) => h.includes(k)))
  const cCode = find('código', 'codigo', 'code'), cName = find('producto rte', 'producto', 'r-t-e', 'item', 'name')
  const cPpc = find('pouches por caja', 'pouches/'), cYield = find('cajas por mezcla', 'yield x'), cPallet = find('cajas por pallet', 'palet')
  const cCrates = find('guacales'), cPerCrate = find('pouches por guacal')
  const n = (r: string[], c: number) => (c < 0 ? 0 : numOf(r[c] ?? ''))
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
/**
 * the quantity per unit suggested for this code: the master table's (pouches per cart in RTE, cases per pallet in
 * Packing), so a number the office corrects reaches the line; without one, what this room used the last time
 */
export function lastPerUnit(s: State, dept: Dept, code: string) {
  const p = productOf(s, code)
  const table = p ? (dept === 'RTE' ? cartPouches(p) : dept === 'Packing' ? p.casesPerPallet : 0) : 0
  if (table) return table
  const key = normCode(code)
  const last = s.runs.filter((r) => r.dept === dept && normCode(r.code) === key && r.perUnit != null).sort((a, b) => b.startedAt - a.startedAt)[0]
  return last?.perUnit ?? null
}

/**
 * the stretches of [a, b] spent stopped, merged: a line's own stop inside a department stop counts once, and a
 * moment covered by two stops goes to the one that began first (so the reasons add up to the stopped time)
 */
function stoppedPieces(a: number, b: number, stops: Stop[], now: number) {
  const pieces: { from: number; to: number; reason: string }[] = []
  let cursor = a
  for (const x of [...stops].sort((p, q) => p.startedAt - q.startedAt)) {
    const s = Math.max(a, x.startedAt), e = Math.min(b, x.endedAt ?? now)
    if (e <= s) continue
    const from = Math.max(s, cursor)
    if (e > from) pieces.push({ from, to: e, reason: x.reason })
    cursor = Math.max(cursor, e)
  }
  return pieces
}
const stoppedBetween = (a: number, b: number, stops: Stop[], now: number) => stoppedPieces(a, b, stops, now).reduce((t, p) => t + (p.to - p.from), 0)
/** time between two moments without what was spent stopped */
export const activeBetween = (a: number, b: number, stops: Stop[], now: number) => Math.max(0, b - a - stoppedBetween(a, b, stops, now))

export function runStats(s: State, r: Run, now: number) {
  const stops = stopsOf(s, r.dept, r.lineId), end = r.endedAt ?? now
  const working = activeBetween(r.startedAt, end, stops, now)
  const pieces = stoppedPieces(r.startedAt, end, stops, now)
  const down = pieces.reduce((t, p) => t + (p.to - p.from), 0)
  const unitTimes = r.units.map((u, i) => activeBetween(i ? r.units[i - 1].at : r.startedAt, u.at, stops, now))
  const avg = unitTimes.length ? unitTimes.reduce((a, b) => a + b, 0) / unitTimes.length : 0
  const qty = runQty(s, r)
  const reasons: Record<string, number> = {}
  for (const p of pieces) reasons[p.reason] = (reasons[p.reason] ?? 0) + (p.to - p.from)
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
