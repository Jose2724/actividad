// Everything is saved on this device first (localStorage). With a server configured (see supabase.ts) every change is
// also queued for upload (outbox.ts) and what other devices send arrives through sync.ts.
import { drop, justSent, outbox, push, queued, rebase, type Row, type Table } from './outbox'
import { storageFull } from './storage'
import { clockNow } from './clock'

export type Dept = 'Kitchen' | 'RTE' | 'Spiral' | 'MFO' | 'Packing'
export const DEPTS: Dept[] = ['Kitchen', 'RTE', 'Spiral', 'MFO', 'Packing']

/**
 * How each department counts its work and why its lines stop — the words of the shift manager and of the office
 * sheets ("FORMATO POR CUARTO"): Kitchen cooks mezclas in braisers, Spiral cooks batches (they call them mezclas too),
 * RTE fills carts whose pouches are counted by the office (pouches per cart depend on the code), MFO fills bins and
 * writes the cases and the bin number, Packing builds pallets and writes the cases and the tag number.
 * qty: 'none' = only count the units; 'ask' = ask the quantity each time, proposing the usual one (pouches per
 * cart, boxes per pallet) so a short cart or pallet is typed on the spot; 'auto' = every unit carries the quantity
 * given at the start, with no question. saved = how the unit is said to be recorded ("guardada" for a mezcla).
 * lots = a unit can carry more than one lot of the product, each with its quantity (a pallet in Packing).
 */
export type DeptCfg = { lineWord: string; unit: string; plural: string; done: string; saved: string; qty: 'none' | 'ask' | 'auto'; qtyQ: string; qtyUnit: string; perUnitLabel: string; refLabel: string; reasons: string[]; waste?: boolean; lots?: boolean }
export const CFG: Record<Dept, DeptCfg> = {
  Kitchen: { lineWord: 'Braiser', unit: 'Mezcla', plural: 'Mezclas', done: 'Mezcla lista', saved: 'guardada', qty: 'none', qtyQ: '', qtyUnit: '', perUnitLabel: '', refLabel: '', reasons: ['Braiser apagado', 'Esperando ingredientes', 'Esperando que recojan producto', 'Máquina / mantenimiento', 'Limpieza', 'Falta de personal', 'Break', 'Calidad', 'Set up'] },
  Spiral: { lineWord: 'Línea', unit: 'Mezcla', plural: 'Mezclas', done: 'Mezcla lista', saved: 'guardada', qty: 'none', qtyQ: '', qtyUnit: '', perUnitLabel: '', refLabel: '', reasons: ['Falta de producto de Kitchen', 'Horno (temperatura)', 'Temperatura interna baja', 'Esperando carros / RTE', 'Máquina / mantenimiento', 'Limpieza', 'Falta de personal', 'Break', 'Calidad', 'Set up'] },
  RTE: { lineWord: 'Línea', unit: 'Carro', plural: 'Carros', done: 'Carro listo', saved: 'guardado', qty: 'ask', qtyQ: '¿Cuántos pouches lleva este carro?', qtyUnit: 'pouches', perUnitLabel: 'Pouches por carro', refLabel: '', waste: true, reasons: ['Falta de salsa (Kitchen)', 'Falta de arroz / arroz muy frío', 'Falta de carrito vacío', 'Cambio de rollo de plástico', 'Plástico atascado / no corta', 'Máquina corta o rompe paquetes (mecánico)', 'Impresora de sello no imprime', 'Peso fuera de rango (reempaque)', 'Aire en el paquete', 'Conteo / pesado de meatballs', 'Limpieza', 'Falta de personal', 'Break', 'Set up'] },
  MFO: { lineWord: 'Línea', unit: 'Bin', plural: 'Bins', done: 'Bin listo', saved: 'guardado', qty: 'ask', qtyQ: '¿Cuántas cajas lleva este bin?', qtyUnit: 'cajas', perUnitLabel: '', refLabel: 'N° de bin', reasons: ['Armado de máquina', 'Pegado de labels / stickers', 'Esperando gas', 'Falta de producto del freezer', 'Preparación (picar pollo…)', 'Falta de material', 'Máquina / mantenimiento', 'Limpieza', 'Falta de personal', 'Break', 'Set up'] },
  Packing: { lineWord: 'Línea', unit: 'Pallet', plural: 'Pallets', done: 'Pallet listo', saved: 'guardado', lots: true, qty: 'ask', qtyQ: '¿Cuántas cajas lleva este pallet?', qtyUnit: 'cajas', perUnitLabel: 'Cajas por pallet', refLabel: 'N° de tag', reasons: ['Falta de producto que empacar', 'Esperando autorización de QC', 'Label equivocado (despegar labels)', 'Plástico / film', 'Falta de cajas / material de empaque', 'Personal pasó a otra línea', 'Etiquetadora / impresora', 'Montacargas / espacio', 'Máquina / mantenimiento', 'Limpieza', 'Falta de personal', 'Break', 'Set up'] },
}
/** what a line's "listo" button says for a moment once the unit is recorded: "Mezcla 5 guardada", "Carro 12 guardado" */
export const savedText = (dept: Dept, n: number) => CFG[dept].unit + ' ' + n + ' ' + CFG[dept].saved

export type Line = { id: string; dept: Dept; name: string; updatedAt: number; deleted?: boolean }
/** one finished unit of work (a cart, a mezcla, a pallet…), how much it carried, its tag / bin number and who tapped it */
export type Unit = { at: number; qty: number | null; ref: string; by: string; lots?: LotPart[] }
/** the part of a unit that belongs to one lot: a pallet can carry cases of two lots of the same product */
export type LotPart = { lot: string; qty: number }
/** the lots written on a unit, as they are kept: only real ones (a lot, and a quantity above zero); none = the run's lot */
export const cleanLots = (x: unknown): LotPart[] | undefined => {
  if (!Array.isArray(x)) return undefined
  const out = x.map((l) => ({ lot: String((l as Partial<LotPart> | null)?.lot ?? '').trim(), qty: Number((l as Partial<LotPart> | null)?.qty) })).filter((l) => l.lot && Number.isFinite(l.qty) && l.qty > 0)
  return out.length ? out : undefined
}
/** a unit as it is kept, whatever shape it arrives in (an older version of the app, the server) */
const unitOf = (u: Partial<Unit>): Unit => { const lots = cleanLots(u.lots); return { at: u.at ?? 0, qty: u.qty ?? null, ref: u.ref ?? '', by: u.by ?? '', ...(lots ? { lots } : {}) } }
/** "6283: 20 + 6284: 16" */
export const lotsText = (lots: LotPart[] | undefined) => (lots?.length ? lots.map((l) => l.lot + ': ' + l.qty).join(' + ') : '')
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
export const today = () => dayOf(clockNow())
/** the plant's lot number is the Julian date: last digit of the year + day of the year (10/07/2026 → 6280) */
export function lotFor(ds: string) {
  const [y, m, d] = ds.split('-').map(Number)
  if (!y || !m || !d) return ''
  const day = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1
  return String(y % 10) + String(day).padStart(3, '0')
}
/** the office writes a code without its leading zero, the ticket and the boxes with it: a numeric code is the same either way */
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
      const units = (r: Raw['runs'][number]): Unit[] => (r.units ? r.units.map(unitOf) : (r.carts ?? []).map((at) => ({ at, qty: null, ref: '', by: '' })))
      const sample = (code: string) => SAMPLE_PRODUCTS.some((x) => x.code === code)
      const products: Product[] = s.products ? s.products.map((p) => ({ code: p.code ?? '', name: p.name ?? '', pouchesPerCase: p.pouchesPerCase ?? 0, casesPerMix: p.casesPerMix ?? 0, cratesPerCart: (p.cratesPerCart ?? (p.pouchesPerCart ? 12 : 0)) === 12 && sample(p.code ?? '') ? CRATES_PER_CART : p.cratesPerCart ?? (p.pouchesPerCart ? 12 : 0), pouchesPerCrate: p.pouchesPerCrate ?? (p.pouchesPerCart ? Math.round(p.pouchesPerCart / 12) : 0), casesPerPallet: p.casesPerPallet ?? 0, updatedAt: p.updatedAt ?? 0 })) : SAMPLE_PRODUCTS
      return {
        lines: s.lines.map((l) => ({ id: l.id ?? uid(), dept: (l.dept ?? 'Kitchen') as Dept, name: l.name ?? 'Línea 1', updatedAt: l.updatedAt ?? 0 })),
        stops: s.stops.map((x) => ({ id: x.id ?? uid(), dept: (x.dept ?? 'Kitchen') as Dept, lineId: x.lineId ?? null, reason: x.reason ?? '', note: x.note ?? '', startedAt: x.startedAt ?? 0, endedAt: x.endedAt ?? null, by: x.by ?? '', updatedAt: x.updatedAt ?? 0 })),
        runs: s.runs.map((r) => ({ id: r.id ?? uid(), dept: (r.dept ?? 'Kitchen') as Dept, lineId: r.lineId ?? '', line: r.line ?? '', code: r.code ?? '', lot: r.lot ?? '', date: r.date ?? today(), startedAt: r.startedAt ?? 0, endedAt: r.endedAt ?? null, units: units(r), perUnit: r.perUnit ?? null, waste: r.waste ?? 0, by: r.by ?? '', updatedAt: r.updatedAt ?? 0 })),
        products, schedule: tidySchedule(s.schedule ?? {}),
        changes: (s.changes ?? []).filter((c) => (c.at ?? 0) > clockNow() - KEEP_CHANGES_MS).map((c) => ({ id: c.id ?? uid(), at: c.at ?? 0, by: c.by ?? '', dept: (c.dept ?? null) as Dept | null, what: c.what ?? '', before: c.before ?? '', after: c.after ?? '', refTable: c.refTable ?? '', refKey: c.refKey ?? '', updatedAt: c.updatedAt ?? 0 })),
        targets: (s.targets ?? []).filter((t) => DEPTS.includes(t.dept as Dept)).map((t) => ({ dept: t.dept as Dept, perHour: t.perHour ?? null, perShift: t.perShift ?? null, updatedAt: t.updatedAt ?? 0 })),
      }
    }
  } catch { /* empty */ }
  return fresh()
}
// ---- what a device keeps when there is a server ----
/**
 * days of runs, stops, history and program a device keeps when there is a server. Older days stay on the server and
 * are brought when someone opens them (loadDay in sync.ts). Without a server the device is the only copy: it keeps
 * everything.
 */
export const KEEP_DAYS = 14
let keepDays = KEEP_DAYS // halved when the device's storage fills up
/** older days opened in this session (Reporte, Avance): they stay until the app is closed */
const opened = new Set<string>()
const dayBack = (n: number) => { const d = new Date(clockNow()); d.setDate(d.getDate() - n); return dayOf(d.getTime()) }
/** the oldest day this device keeps */
export const firstKeptDay = () => dayBack(keepDays - 1)
/** a day this device does not hold: the server has to be asked for it */
export const awayDay = (date: string) => SERVER && /^\d{4}-\d{2}-\d{2}$/.test(date) && date < firstKeptDay() && !opened.has(date)
export const openDay = (date: string) => { opened.add(date) }
export const closeDay = (date: string) => { opened.delete(date) }
/**
 * the state without the days the device no longer keeps. Never dropped: a run or a stop still open, anything still
 * waiting to go up, a day someone opened, and the stops of a run that stays. Nothing is ever deleted on the server.
 */
function pruned(s: State): State {
  if (!SERVER) return s
  const from = firstKeptDay(), fromMs = new Date(from + 'T00:00:00').getTime()
  const waiting = new Set(outbox.items().map((i) => i.table + '|' + i.key))
  const runs = s.runs.filter((r) => !r.endedAt || r.date >= from || r.startedAt >= fromMs || opened.has(r.date) || waiting.has('act_runs|' + r.id))
  const old = runs.filter((r) => r.startedAt < fromMs) // kept although old: their stops stay with them
  const beside = (x: Stop) => old.some((r) => r.dept === x.dept && (x.lineId === null || x.lineId === r.lineId) && x.startedAt < (r.endedAt ?? Infinity) && (x.endedAt ?? Infinity) > r.startedAt)
  const stops = s.stops.filter((x) => !x.endedAt || x.startedAt >= fromMs || opened.has(dayOf(x.startedAt)) || waiting.has('act_stops|' + x.id) || beside(x))
  const changes = s.changes.filter((c) => c.at >= fromMs || opened.has(dayOf(c.at)) || waiting.has('act_changes|' + c.id))
  const days = Object.keys(s.schedule).filter((d) => d >= from || opened.has(d))
  if (runs.length === s.runs.length && stops.length === s.stops.length && changes.length === s.changes.length && days.length === Object.keys(s.schedule).length) return s
  return { ...s, runs, stops, changes, schedule: Object.fromEntries(days.map((d) => [d, s.schedule[d]])) }
}
/** lets go of the days the device no longer keeps (see pruned) */
export function prune() { const next = pruned(state); if (next !== state) set(next) }

let state = load()
const subs = new Set<() => void>()
/**
 * writes the state to the device. When its storage is full: with a server, older days are let go (the server has
 * them) and it is tried again; when nothing more can go, or there is no server, the screen is told (storage.ts)
 */
function persist() {
  for (;;) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); storageFull.set(false); outbox.resave(); return }
    catch {
      if (!SERVER || keepDays <= 2) { storageFull.set(true); return }
      keepDays = Math.max(2, Math.floor(keepDays / 2))
      state = pruned(state)
    }
  }
}
let batching = 0, dirty = false
const commit = () => { persist(); subs.forEach((f) => f()) }
function set(next: State) { state = next; if (batching) dirty = true; else commit() }
/** many changes saved and shown once, at the end (a pull of hundreds of rows) */
export function batch<T>(fn: () => T): T {
  batching++
  try { return fn() } finally { if (--batching === 0 && dirty) { dirty = false; commit() } }
}
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
const rowOfSchedule = (date: string, code: string, mixes: number) => ({ date, code: normCode(code), mixes, updated_at: iso(clockNow()), updated_by: user.get() })
const rowOfChange = (c: Change) => ({ id: c.id, at: iso(c.at), by_name: c.by, dept: c.dept, what: c.what, before: c.before, after: c.after, ref_table: c.refTable, ref_key: c.refKey, deleted: !!c.deleted, updated_at: iso(c.updatedAt), updated_by: user.get() })
const rowOfTarget = (t: Target) => ({ dept: t.dept, per_hour: t.perHour, per_shift: t.perShift, updated_at: iso(t.updatedAt), updated_by: user.get() })

// ---- the mutations: each one saves on the device and queues the row for the server ----
/** a change is always stamped later than the version it was made from, even when this device's clock runs behind another's */
const stamp = (was: { updatedAt: number } | undefined) => Math.max(clockNow(), (was?.updatedAt ?? 0) + 1)
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
  r = { ...r, line: line?.name ?? r.line, updatedAt: stamp(was) }; if (r.deleted) gone.set('act_runs|' + r.id, r.updatedAt)
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
 * one line of history. The SAME value of the SAME record retyped by the same person within a minute and a half
 * (keystrokes, a second thought) updates its line instead of adding one; typed back to what it was, the line is
 * withdrawn. Another record never shares a line, even with the same wording.
 */
function logChange(dept: Dept | null, what: string, before: string, after: string, refTable: string, refKey: string) {
  if (before === after) return
  const now = clockNow(), by = user.get()
  const changes = state.changes
  let i = changes.length - 1
  while (i >= 0 && !(changes[i].by === by && changes[i].refTable === refTable && changes[i].refKey === refKey && changes[i].what === what && now - changes[i].at < COALESCE_MS)) i--
  const c: Change = i >= 0 ? { ...changes[i], after, updatedAt: now } : { id: uid(), at: now, by, dept, what, before, after, refTable, refKey, updatedAt: now }
  if (c.before === c.after) c.deleted = true
  set({ ...state, changes: upsertIn(changes, c) })
  push('act_changes', c.id, rowOfChange(c))
}
const PRODUCT_FIELDS: [keyof Product, string][] = [['name', 'Producto'], ['pouchesPerCase', 'Pouches / caja'], ['casesPerMix', 'Cajas / mezcla'], ['cratesPerCart', 'Guacales / carro'], ['pouchesPerCrate', 'Pouches / guacal'], ['casesPerPallet', 'Cajas / pallet']]
function logProductDiff(old: Product | undefined, p: Product) {
  if (!old) { if (p.code.trim()) logChange(null, 'Producto nuevo', '', p.code, 'act_products', normCode(p.code)); return }
  if (normCode(old.code) !== normCode(p.code)) logChange(null, old.code.trim() ? 'Producto ' + old.code + ' · Código' : 'Producto nuevo', old.code, p.code, 'act_products', normCode(p.code))
  for (const [k, label] of PRODUCT_FIELDS) if (v(old[k]) !== v(p[k])) logChange(null, 'Producto ' + (p.code || old.code) + ' · ' + label, v(old[k]), v(p[k]), 'act_products', normCode(p.code))
}
const stopLine = (x: Stop) => (x.lineId === null ? 'todo ' + x.dept : state.lines.find((l) => l.id === x.lineId)?.name ?? state.runs.find((r) => r.lineId === x.lineId)?.line ?? 'línea')
const endText = (ms: number | null) => (ms ? fmtTime(ms) : 'en curso')

// ---- the lines of a room and their names ----
/**
 * the name a line has NOW: a renamed line shows its new name on everything recorded on it (the card, the reports,
 * the files). A line that was removed keeps the name its records carried.
 */
export const lineNameOf = (s: State, lineId: string | null, was = '') => s.lines.find((l) => l.id === lineId)?.name || was
/** "Línea 2" before "Línea 10" */
export const byLineName = (a: Line, b: Line) => a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' })
export const LINE_NAME_MAX = 24
export const tidyLineName = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, LINE_NAME_MAX).trim()
/** two names are the same line name whatever the capitals, accents or spaces: "linea  2" = "Línea 2" */
const sameName = (a: string, b: string) => { const f = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); return f(a) === f(b) }
/** the line of that room that already has this name, other than `selfId` */
export const lineNamed = (s: State, dept: Dept, name: string, selfId?: string) => s.lines.find((l) => l.dept === dept && l.id !== selfId && sameName(l.name, name))
/** the standard names nobody has yet in a room ("Línea 1", "Línea 3"…), lowest first */
export function freeLineNames(s: State, dept: Dept, count = 4): string[] {
  const out: string[] = []
  for (let n = 1; out.length < count && n <= 99; n++) { const name = CFG[dept].lineWord + ' ' + n; if (!lineNamed(s, dept, name)) out.push(name) }
  return out
}
/** adds a line; without a name it takes the lowest standard one that is free. false = blank after tidying, or the name is taken */
export function addLine(dept: Dept, name?: string): boolean {
  const final = tidyLineName(name ?? freeLineNames(state, dept, 1)[0] ?? '')
  if (!final || lineNamed(state, dept, final)) return false
  const l: Line = { id: uid(), dept, name: final, updatedAt: 0 }
  putLine(l); logChange(dept, 'Línea agregada en ' + dept, '', l.name, 'act_lines', l.id)
  return true
}
/** the finished records of a line take its name too (the one running takes it by itself the next time it is touched) */
const renameRecords = (lineId: string, name: string) => { for (const r of state.runs.filter((x) => x.lineId === lineId && x.endedAt && x.line !== name)) putRun({ ...r, line: name }) }
/** gives a line another name. false = blank, or another line of the room has it (see swapLineNames) */
export function renameLine(id: string, name: string): boolean {
  const l = state.lines.find((x) => x.id === id), final = tidyLineName(name)
  if (!l || !final || lineNamed(state, l.dept, final, id)) return false
  if (final === l.name) return true
  batch(() => { putLine({ ...l, name: final }); renameRecords(id, final); logChange(l.dept, 'Línea renombrada en ' + l.dept, l.name, final, 'act_lines', id) })
  return true
}
/** two lines of a room trade names (the one called "Línea 1" was really line 2, and the other way round) */
export function swapLineNames(idA: string, idB: string): boolean {
  const a = state.lines.find((x) => x.id === idA), b = state.lines.find((x) => x.id === idB)
  if (!a || !b || a.id === b.id || a.dept !== b.dept) return false
  batch(() => {
    putLine({ ...a, name: b.name }); putLine({ ...b, name: a.name })
    renameRecords(a.id, b.name); renameRecords(b.id, a.name)
    logChange(a.dept, 'Línea renombrada en ' + a.dept, a.name, b.name, 'act_lines', a.id)
    logChange(b.dept, 'Línea renombrada en ' + b.dept, b.name, a.name, 'act_lines', b.id)
  })
  return true
}
export function removeLine(id: string) { const l = state.lines.find((x) => x.id === id); if (l) { putLine({ ...l, deleted: true }); logChange(l.dept, 'Línea quitada de ' + l.dept, l.name, '', 'act_lines', l.id) } }
/** the reason of the stop the app writes by itself when a line finishes a code and another one is coming */
export const SETUP = 'Set up'
/** a line left without a code for longer than this was not being set up: it was simply not in use */
export const SETUP_MAX_MS = 6 * 3_600_000
const AFTER = 'Después de '
/**
 * What a line between two codes is stopped for: the set up written when its last code ended (or the cause a manager
 * gave to part of that time), while it is still open and recent enough to be one. undefined = it is not between codes.
 */
export const idleStop = (s: State, lineId: string, now: number) =>
  s.runs.some((r) => r.lineId === lineId && !r.endedAt) ? undefined : s.stops.find((x) => x.lineId === lineId && !x.endedAt && now - x.startedAt <= SETUP_MAX_MS)
/**
 * A code starts on a line. Whatever the line was stopped for since its last code (its set up, or the causes that time
 * was divided into) ends at this moment. A set up of seconds is not one, and neither is a stop left open for hours on
 * a line nobody was using: those are dropped.
 */
export function startRun(line: Line, code: string, lot: string, date: string, perUnit: number | null) {
  const at = clockNow()
  batch(() => {
    for (const x of state.stops.filter((y) => y.lineId === line.id && !y.endedAt)) {
      const age = at - x.startedAt
      if (age > SETUP_MAX_MS || (x.reason === SETUP && age < 60_000)) putStop({ ...x, deleted: true })
      else putStop({ ...x, endedAt: Math.max(at, x.startedAt), note: x.reason === SETUP && x.note.startsWith(AFTER) ? 'De ' + x.note.slice(AFTER.length) + ' a ' + code : x.note })
    }
    putRun({ id: uid(), dept: line.dept, lineId: line.id, line: line.name, code, lot, date, startedAt: at, endedAt: null, units: [], perUnit, waste: 0, by: user.get(), updatedAt: 0 })
  })
}
const run = (id: string) => state.runs.find((r) => r.id === id)
/** the last moment already on a run: nothing recorded after it may be stamped earlier (the clock can be corrected between two taps) */
const after = (r: Run) => Math.max(r.startedAt, r.units.length ? r.units[r.units.length - 1].at + 1 : 0)
/** a unit finished on the line. `lots` = what it carries of each lot when it is not all of the run's lot; the quantity is then their sum */
export function unitDone(runId: string, qty: number | null, ref = '', lots?: LotPart[]) {
  const r = run(runId)
  if (!r) return
  const parts = cleanLots(lots)
  putRun({ ...r, units: [...r.units, { at: Math.max(clockNow(), after(r)), qty: parts ? parts.reduce((t, l) => t + l.qty, 0) : qty, ref, by: user.get(), ...(parts ? { lots: parts } : {}) }] })
}
/**
 * A code ends. `setup` = another code is coming on this line: the time until it starts is the line's set up, written
 * from this moment as a stop like any other, so it is in the report at once and a manager can divide it.
 */
export function endRun(runId: string, setup = false) {
  const r = run(runId)
  if (!r) return
  const at = Math.max(clockNow(), after(r))
  batch(() => {
    putRun({ ...r, endedAt: at })
    if (setup && !state.stops.some((x) => x.lineId === r.lineId && !x.endedAt)) putStop({ id: uid(), dept: r.dept, lineId: r.lineId, reason: SETUP, note: AFTER + r.code, startedAt: at, endedAt: null, by: user.get(), updatedAt: 0 })
  })
}
/**
 * The line is put in set up by hand, while it has no code running: the same stop that ending a code opens. (With a
 * code running, "Set up" is one of the reasons of "Parar".) It ends with "Terminar", or when the next code starts.
 */
export function startSetup(line: Line) {
  const at = clockNow()
  if (state.runs.some((r) => r.lineId === line.id && !r.endedAt) || state.stops.some((x) => x.lineId === line.id && !x.endedAt)) return
  const last = state.runs.filter((r) => r.lineId === line.id && !!r.endedAt && at - (r.endedAt ?? 0) <= SETUP_MAX_MS).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0]
  putStop({ id: uid(), dept: line.dept, lineId: line.id, reason: SETUP, note: last ? AFTER + last.code : '', startedAt: at, endedAt: null, by: user.get(), updatedAt: 0 })
}
/** no other code is coming after all: what was counting between codes is taken away (it was never a stop of the line) */
export function dropSetup(id: string) { const x = state.stops.find((y) => y.id === id); if (x && !x.endedAt) putStop({ ...x, deleted: true }) }
/**
 * A line that is running a code is not in set up. A set up still open from before that code started (the tablet that
 * started the code had not heard of it, or runs an older version of the app) ends where the code began.
 */
function healSetup(lineId: string) {
  const r = state.runs.find((x) => x.lineId === lineId && !x.endedAt)
  if (!r) return
  for (const x of state.stops.filter((y) => y.lineId === lineId && !y.endedAt && y.reason === SETUP && y.startedAt <= r.startedAt)) putStop({ ...x, endedAt: r.startedAt })
}
/** pounds thrown away, added to what the run already has */
export function addWaste(runId: string, lb: number) { const r = run(runId); if (r) putRun({ ...r, waste: Math.round((r.waste + lb) * 100) / 100 }) }
/**
 * More product went on a unit that had been closed short: its quantity is raised (with its lots, where a unit carries
 * them), instead of counting another unit. It is a correction like any other: who and when go to the history.
 */
export function fillUnit(runId: string, at: number, qty: number, lots?: LotPart[], ref?: string) {
  const r = run(runId)
  if (!r || !r.units.some((u) => u.at === at)) return
  const parts = cleanLots(lots)
  updateRun(runId, { units: r.units.map((u) => { if (u.at !== at) return u; const { lots: _was, ...bare } = u; return { ...bare, ...(parts ? { lots: parts, qty: parts.reduce((t, l) => t + l.qty, 0) } : { qty }), ...(ref != null ? { ref } : {}) } }) })
}
/**
 * A code marked as finished too early goes on as if it had not ended (the set up that had started is taken away).
 * Not while its line runs another code: that one would have to end first.
 */
export function reopenRun(id: string): boolean {
  const r = run(id)
  if (!r || !r.endedAt || state.runs.some((x) => x.lineId === r.lineId && !x.endedAt)) return false
  updateRun(id, { endedAt: null })
  return true
}
/** corrections: a wrong code, lot, quantity, tag or stop is fixed in place */
/** a correction from the editor: saved, and every field that differs goes to the history */
export function updateRun(id: string, patch: Partial<Pick<Run, 'code' | 'lot' | 'date' | 'perUnit' | 'waste' | 'endedAt' | 'units'>>) {
  const r = run(id)
  if (!r) return
  const n = { ...r, ...patch }
  putRun(n)
  // reopened: the code goes on, so what started counting when it "ended" was not a set up
  if (patch.endedAt === null && r.endedAt) for (const x of state.stops.filter((y) => y.lineId === r.lineId && !y.endedAt && y.startedAt >= (r.endedAt ?? 0))) putStop({ ...x, deleted: true })
  const cfg = CFG[r.dept], pre = 'Corrida ' + r.code + ' del ' + r.date + ' (' + r.dept + ', ' + lineNameOf(state, r.lineId, r.line) + ') · '
  const log = (what: string, a: string, b: string) => logChange(r.dept, pre + what, a, b, 'act_runs', r.id)
  log('Código', r.code, n.code); log('Lote', r.lot, n.lot); log('Fecha', r.date, n.date)
  log(cfg.perUnitLabel || 'Por unidad', v(r.perUnit), v(n.perUnit)); log('Waste lb', v(r.waste), v(n.waste)); log('Fin', endText(r.endedAt), endText(n.endedAt))
  r.units.forEach((u, i) => {
    const w = n.units.find((x) => x.at === u.at)
    if (!w) log('Se quitó ' + cfg.unit.toLowerCase() + ' ' + (i + 1) + ' (' + fmtTime(u.at) + ')', [u.qty != null ? u.qty + ' ' + cfg.qtyUnit : '', u.ref].filter(Boolean).join(' · ') || '1', '')
    else { log(cfg.unit + ' ' + (i + 1) + ' · cantidad', v(u.qty), v(w.qty)); if (cfg.refLabel) log(cfg.unit + ' ' + (i + 1) + ' · ' + cfg.refLabel, u.ref, w.ref); if (cfg.lots) log(cfg.unit + ' ' + (i + 1) + ' · lotes', lotsText(u.lots), lotsText(w.lots)) }
  })
}
export function deleteRun(id: string) { const r = run(id); if (r) { putRun({ ...r, deleted: true }); logChange(r.dept, 'Se borró la corrida ' + r.code + ' del ' + r.date + ' (' + r.dept + ', ' + lineNameOf(state, r.lineId, r.line) + ')', r.units.length + ' ' + CFG[r.dept].plural.toLowerCase() + (r.waste ? ' · waste ' + r.waste + ' lb' : ''), '', 'act_runs', r.id) } }
export function startStop(dept: Dept, lineId: string | null, reason: string, note: string) {
  putStop({ id: uid(), dept, lineId, reason, note, startedAt: clockNow(), endedAt: null, by: user.get(), updatedAt: 0 })
}
const stop = (id: string) => state.stops.find((x) => x.id === id)
export function endStop(id: string) { const x = stop(id); if (x) putStop({ ...x, endedAt: Math.max(clockNow(), x.startedAt) }) }
export function updateStop(id: string, patch: Partial<Pick<Stop, 'reason' | 'note' | 'startedAt' | 'endedAt'>>) {
  const x = stop(id)
  if (!x) return
  const n = { ...x, ...patch }
  putStop(n)
  const pre = 'Paro ' + x.dept + ' ' + dayOf(x.startedAt) + ' ' + fmtTime(x.startedAt) + ' (' + stopLine(x) + ') · '
  const log = (what: string, a: string, b: string) => logChange(x.dept, pre + what, a, b, 'act_stops', x.id)
  log('Motivo', x.reason, n.reason); log('Detalle', x.note, n.note); log('Inicio', fmtTime(x.startedAt), fmtTime(n.startedAt)); log('Fin', endText(x.endedAt), endText(n.endedAt))
}
/**
 * A stop that turned out to have two causes: the time up to `at` keeps its reason and the rest becomes another stop
 * with its own. The two cover the same time, so the stopped time of the line does not change. A stop still open stays
 * open in its second part. Returns the new stop's id, or '' when there is nothing to divide (`at` is not inside the
 * stop, or no reason was given). Dividing a part again gives three causes, and so on.
 */
export function splitStop(id: string, at: number, reason: string, note = ''): string {
  const x = stop(id)
  if (!x || x.deleted || !reason.trim()) return ''
  if (!(at > x.startedAt && at < (x.endedAt ?? clockNow()))) return ''
  const rest: Stop = { id: uid(), dept: x.dept, lineId: x.lineId, reason: reason.trim(), note: note.trim(), startedAt: at, endedAt: x.endedAt, by: user.get(), updatedAt: 0 }
  batch(() => { putStop({ ...x, endedAt: at }); putStop(rest) })
  logChange(x.dept, 'Paro ' + x.dept + ' ' + dayOf(x.startedAt) + ' ' + fmtTime(x.startedAt) + ' (' + stopLine(x) + ') · Se dividió en dos causas',
    x.reason + ' ' + fmtTime(x.startedAt) + '–' + endText(x.endedAt), x.reason + ' ' + fmtTime(x.startedAt) + '–' + fmtTime(at) + ' + ' + rest.reason + ' ' + fmtTime(at) + '–' + endText(x.endedAt), 'act_stops', rest.id)
  return rest.id
}
export function deleteStop(id: string) { const x = stop(id); if (x) { putStop({ ...x, deleted: true }); logChange(x.dept, 'Se borró el paro ' + x.dept + ' ' + dayOf(x.startedAt) + ' ' + fmtTime(x.startedAt) + ' (' + stopLine(x) + ')', x.reason + (x.note ? ' · ' + x.note : '') + ' · ' + fmtTime(x.startedAt) + '–' + endText(x.endedAt), '', 'act_stops', x.id) } }
/** the form of a correction, as the text the person sees and types */
export type RunDraft = { code: string; lot: string; date: string; per: string; waste: string; units: { at: number; qty: string; ref: string; by: string; lots?: LotPart[] }[] }
export const draftOf = (r: Run): RunDraft => ({ code: r.code, lot: r.lot, date: r.date, per: r.perUnit != null ? String(r.perUnit) : '', waste: r.waste ? String(r.waste) : '', units: r.units.map((u) => ({ at: u.at, qty: u.qty != null ? String(u.qty) : '', ref: u.ref, by: u.by, ...(u.lots ? { lots: u.lots } : {}) })) })
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
    const ref = changed(b.ref, a.ref) ? b.ref.trim() : u.ref
    // the lots of a pallet were changed in the form: they stand, and its quantity is their sum
    if (JSON.stringify(a.lots ?? null) !== JSON.stringify(b.lots ?? null)) {
      const lots = cleanLots(b.lots), { lots: _was, ...bare } = u
      return lots ? { ...bare, ref, lots, qty: lots.reduce((t, l) => t + l.qty, 0) } : { ...bare, ref, qty: cfg.qty !== 'none' && b.qty.trim() ? typed(b.qty) : u.qty }
    }
    const qty = cfg.qty !== 'none' && changed(b.qty, a.qty) ? (b.qty.trim() ? typed(b.qty) : null) : u.qty
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
// ---- the day of work ----
const DAY_REF = 'act_days'
/** a line of history written as it is (logChange merges retyped values; these are events of their own) */
const putChange = (c: Change) => { set({ ...state, changes: upsertIn(state.changes, c) }); push('act_changes', c.id, rowOfChange(c)) }
/**
 * a day that was started stays the day of work until 6 in the morning of the next one: a shift that runs past
 * midnight keeps its date and its lot, and the morning shift is never handed yesterday's date
 */
const dayEnds = (date: string) => { const d = new Date(date + 'T06:00:00'); d.setDate(d.getDate() + 1); return d.getTime() }
export type WorkDay = { date: string; started: { at: number; by: string } | null }
/** the day in course: the one somebody started ("Empezar el día") while it lasts; otherwise the calendar's */
export function workDay(s: State, now = clockNow()): WorkDay {
  const m = s.changes.filter((c) => c.refTable === DAY_REF && !c.deleted && c.at <= now && now < dayEnds(c.refKey)).sort((a, b) => b.at - a.at)[0]
  return m ? { date: m.refKey, started: { at: m.at, by: m.by } } : { date: dayOf(now), started: null }
}
/** the last thing recorded on a run: its last unit, its start, or the moment its line was stopped and left */
const lastRecord = (s: State, r: Run) => Math.max(r.units.length ? r.units[r.units.length - 1].at : r.startedAt, ...s.stops.filter((x) => !x.endedAt && x.dept === r.dept && x.lineId === r.lineId).map((x) => x.startedAt))
const LEFT_AFTER_MS = 6 * 3_600_000
/**
 * runs nobody finished: still open, dated before the day, and with nothing recorded for six hours. (A line that is
 * really running across midnight, with a cart an hour ago, is not one of them.)
 */
export const leftOpen = (s: State, date: string, at = clockNow()) => s.runs.filter((r) => !r.endedAt && r.date < date && lastRecord(s, r) < at - LEFT_AFTER_MS)
/** what a day holds that began before a moment (all of it when no moment is given) */
export const dayRecords = (s: State, date: string, before = Infinity) => ({
  runs: s.runs.filter((r) => r.date === date && r.startedAt < before),
  stops: s.stops.filter((x) => dayOf(x.startedAt) === date && x.startedAt < before),
})
/**
 * everything recorded on a day (or only what began before a moment) is set aside: it leaves every screen and every
 * report on every device, with the history of its corrections. The rows stay on the server marked as deleted.
 * Returns how many.
 */
export function purgeDay(date: string, before = Infinity): { runs: number; stops: number } {
  const { runs, stops } = dayRecords(state, date, before)
  // the history of those records goes with them; what was set up that day (products, goals, lines, program) keeps its own
  const lines = state.changes.filter((c) => (c.refTable === 'act_runs' || c.refTable === 'act_stops') && dayOf(c.at) === date && c.at < before)
  if (!runs.length && !stops.length && !lines.length) return { runs: 0, stops: 0 }
  batch(() => {
    for (const r of runs) putRun({ ...r, deleted: true })
    for (const x of stops) putStop({ ...x, deleted: true })
    for (const c of lines) putChange({ ...c, deleted: true, updatedAt: stamp(c) })
    const now = clockNow()
    putChange({ id: uid(), at: now, by: user.get(), dept: null, what: 'Se borraron los registros del ' + date + (before < Infinity ? ' anteriores a las ' + fmtTime(before) : ''), before: runs.length + (runs.length === 1 ? ' corrida' : ' corridas') + ' · ' + stops.length + (stops.length === 1 ? ' paro' : ' paros'), after: '', refTable: DAY_REF + ':purge', refKey: date, updatedAt: now })
  })
  return { runs: runs.length, stops: stops.length }
}
/** a run nobody finished is closed at its last record (its last unit, or the moment it was stopped), not at "now" */
function finishLeft(r: Run) {
  const open = state.stops.filter((x) => !x.endedAt && x.dept === r.dept && x.lineId === r.lineId)
  const end = lastRecord(state, r)
  for (const x of open) updateStop(x.id, { endedAt: end })
  updateRun(r.id, { endedAt: end })
  return end
}
/**
 * starts the day of work (or moves its start): from then on "today" is that date for every tablet, until 6 the next
 * morning. On the way it can finish the runs left open from earlier days, and set aside what was recorded that day
 * before the start (tests).
 */
export function startDay(at: number, opts: { date?: string; finishLeft?: boolean; purge?: boolean } = {}) {
  const date = opts.date ?? dayOf(at)
  let ended = 0, gone = { runs: 0, stops: 0 }
  batch(() => {
    if (opts.finishLeft) {
      const last: Partial<Record<Dept, number>> = {}
      for (const r of leftOpen(state, date, at)) { const end = finishLeft(r); last[r.dept] = Math.max(last[r.dept] ?? 0, end); ended++ }
      // a whole department left "stopped" since an earlier day: closed with the last of its runs, or where it began
      for (const x of state.stops.filter((y) => !y.endedAt && y.lineId === null && dayOf(y.startedAt) < date)) updateStop(x.id, { endedAt: Math.max(x.startedAt, last[x.dept] ?? 0) })
    }
    if (opts.purge) gone = purgeDay(date, at)
    const was = state.changes.find((c) => c.id === 'day:' + date)
    putChange({ id: 'day:' + date, at, by: user.get(), dept: null, what: 'Día empezado', before: was && was.at !== at ? fmtTime(was.at) : '', after: fmtTime(at), refTable: DAY_REF, refKey: date, updatedAt: stamp(was) })
  })
  return { date, ended, ...gone }
}
/** the day goes back to being the calendar's */
export function cancelDay(date: string) { const c = state.changes.find((x) => x.id === 'day:' + date); if (c) putChange({ ...c, deleted: true, updatedAt: stamp(c) }) }

/** everyone who took part in a run: who started it and who tapped its units (a break cover shows up by name) */
export function whoText(r: Run) { return [...new Set([r.by, ...r.units.map((u) => u.by)].filter(Boolean))].join(', ') }

/** with a server: the device is emptied and everything comes down again (the server keeps the truth); the pull cursor is cleared so nothing is skipped */
const resync = () => { if (SERVER) { try { localStorage.removeItem('act_since2'); localStorage.removeItem('act_outbox') } catch { /* private */ } window.dispatchEvent(new Event('act-resync')) } }
export function reset() { set(fresh()); resync() }
/** a clean slate for the records only: runs, stops and the schedule go; the lines and the products table stay */
export function resetRecords() { set({ ...state, runs: [], stops: [], schedule: {}, changes: [] }); resync() }

export const productOf = (s: State, code: string) => s.products.find((p) => normCode(p.code) === normCode(code))
/**
 * Pouches told the way the floor needs them when a cart comes out short: full cases and the loose pouches left over,
 * by the product's pouches per case. null when the products table does not say how many go in a case.
 */
export function inCases(s: State, code: string, pouches: number | null | undefined): { cases: number; loose: number; perCase: number } | null {
  const per = productOf(s, code)?.pouchesPerCase ?? 0
  if (!(per > 0) || pouches == null || !Number.isFinite(pouches) || pouches < 0) return null
  const cases = Math.floor(pouches / per)
  return { cases, loose: Math.round((pouches - cases * per) * 100) / 100, perCase: per }
}
/** "10 cajas y 10 sueltos" */
export const casesText = (c: { cases: number; loose: number } | null) => (c ? c.cases + (c.cases === 1 ? ' caja' : ' cajas') + (c.loose ? ' y ' + c.loose + (c.loose === 1 ? ' suelto' : ' sueltos') : '') : '')
/** a unit closed with less than the usual quantity of its run */
export type Short = { run: Run; index: number; unit: Unit; usual: number }
/** the last unit of a run, when it holds less than the usual */
const shortLast = (x: Run): Short | null => { const u = x.units[x.units.length - 1]; return x.perUnit != null && u && u.qty != null && u.qty < x.perUnit ? { run: x, index: x.units.length - 1, unit: u, usual: x.perUnit } : null }
/** the newest end first */
const byEnd = (a: Run, b: Run) => (b.endedAt ?? 0) - (a.endedAt ?? 0)
/**
 * The unit of a running code that was closed short and can still be filled: its last one, when it holds less than the
 * usual quantity; or, while it has none yet, the last one of an earlier run of the same code and lot that day (the
 * cart closed when the code seemed over, which gets more product when the code comes back).
 */
export function shortUnit(s: State, r: Run): Short | null {
  if (r.units.length) return shortLast(r)
  const before = s.runs.filter((x) => x.id !== r.id && x.dept === r.dept && x.date === r.date && !!x.endedAt && normCode(x.code) === normCode(r.code) && x.lot === r.lot && x.units.length > 0).sort(byEnd)[0]
  return before ? shortLast(before) : null
}
/** the code that ended last on a line that day */
export const lastEnded = (s: State, lineId: string, date: string): Run | undefined => s.runs.filter((r) => r.lineId === lineId && r.date === date && !!r.endedAt).sort(byEnd)[0]
/**
 * The codes already ended on a line that day whose last unit was closed short, the newest first: a code marked as
 * finished too early, or one that got more product on its last cart after the line had gone on to another code.
 */
export const shortEnded = (s: State, lineId: string, date: string): Short[] =>
  s.runs.filter((r) => r.lineId === lineId && r.date === date && !!r.endedAt).sort(byEnd).map(shortLast).filter((x): x is Short => !!x)
/** why a code cannot go on the product at position i: it is already another product's ('taken'), or it would leave an existing product without one ('blank') */
export function codeProblem(i: number, code: string): 'taken' | 'blank' | null {
  const key = normCode(code), old = state.products[i]
  if (key && state.products.some((x, k) => k !== i && normCode(x.code) === key)) return 'taken'
  if (old && old.code.trim() && !key) return 'blank'
  return null
}
/**
 * saves a product by its position in the list (a new one goes at the end); a code that changed retires the old row on
 * the server. Refused (false, nothing saved) when the code already belongs to another product, or when it would leave
 * an existing product without a code.
 */
export function saveProduct(i: number, p: Product): boolean {
  if (codeProblem(i, p.code)) return false
  const products = [...state.products]
  const old = products[i]
  const key = normCode(p.code)
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
  if (p && p.code.trim()) push('act_products', normCode(p.code), rowOfProduct({ ...p, deleted: true, updatedAt: clockNow() }))
  if (p) logChange(null, 'Producto ' + (p.code || '(sin código)') + ' quitado', p.name || p.code, '', 'act_products', normCode(p.code))
}
/** products loaded from the office's file: an existing code is updated (blank numbers keep what was there), a new one is added */
export function mergeProducts(list: Product[]) {
  const products = [...state.products]
  let added = 0, changed = 0
  for (const p of list) {
    const i = products.findIndex((x) => normCode(x.code) === normCode(p.code))
    const merged: Product = i < 0 ? { ...p, updatedAt: clockNow() } : { ...products[i], name: p.name || products[i].name, pouchesPerCase: p.pouchesPerCase || products[i].pouchesPerCase, casesPerMix: p.casesPerMix || products[i].casesPerMix, cratesPerCart: p.cratesPerCart || products[i].cratesPerCart, pouchesPerCrate: p.pouchesPerCrate || products[i].pouchesPerCrate, casesPerPallet: p.casesPerPallet || products[i].casesPerPallet, updatedAt: clockNow() }
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
  const t: Target = { dept, perHour, perShift, updatedAt: clockNow() }
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
    const ln = lineNameOf(s, r.lineId, r.line)
    if (!e.lines.includes(ln)) e.lines.push(ln)
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
  units: (Array.isArray(row.units) ? (row.units as Partial<Unit>[]) : []).map(unitOf),
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
  const next = { ...merged, updatedAt: Math.max(clockNow(), mine.updatedAt + 1, theirs.updatedAt + 1) }
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
    if (next) { set({ ...state, runs: upsertIn(state.runs, next) }); healSetup(next.lineId) }
  } else if (table === 'act_stops') {
    const next = reconcile('act_stops', state.stops.find((x) => x.id === row.id), row, STOP)
    if (next) { set({ ...state, stops: upsertIn(state.stops, next) }); if (next.lineId) healSetup(next.lineId) }
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
  for (const l of state.lines) { push('act_lines', l.id, rowOfLine({ ...l, updatedAt: l.updatedAt || clockNow() })); n++ }
  for (const r of state.runs) { push('act_runs', r.id, rowOfRun({ ...r, updatedAt: r.updatedAt || clockNow() })); n++ }
  for (const x of state.stops) { push('act_stops', x.id, rowOfStop({ ...x, updatedAt: x.updatedAt || clockNow() })); n++ }
  for (const p of state.products) if (p.code.trim()) { push('act_products', normCode(p.code), rowOfProduct({ ...p, updatedAt: p.updatedAt || clockNow() })); n++ }
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
