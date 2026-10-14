// Everything is saved on this device first (localStorage). With a server configured (see supabase.ts) every change is
// also queued for upload (outbox.ts) and what other devices send arrives through sync.ts.
import { drop, justSent, outbox, push, queued, rebase, type Row, type Table } from './outbox'
import { storageFull } from './storage'
import { clockNow } from './clock'
import { lang, tr, trIn } from './i18n'

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
 * orders = its units go to customers' orders (see "the orders Packing fills").
 * quick = the three causes "Parar" offers (anything else is typed under "Otra"): the people on the line choose in one
 * tap. reasons = the department's complete list, quick ones first: the manager's, when a stop is corrected or divided.
 */
export type DeptCfg = { lineWord: string; unit: string; plural: string; done: string; saved: string; qty: 'none' | 'ask' | 'auto'; qtyQ: string; qtyUnit: string; perUnitLabel: string; refLabel: string; refWord?: string; quick: string[]; reasons: string[]; waste?: boolean; lots?: boolean; orders?: boolean }
export const CFG: Record<Dept, DeptCfg> = {
  Kitchen: { lineWord: tr('Braiser'), unit: tr('Mezcla'), plural: tr('Mezclas'), done: tr('Mezcla lista'), saved: tr('guardada'), qty: 'none', qtyQ: '', qtyUnit: '', perUnitLabel: '', refLabel: '', quick: ['Problema mecánico', 'Esperando ingredientes', 'Break'], reasons: ['Problema mecánico', 'Esperando ingredientes', 'Break', 'Braiser apagado', 'Esperando que recojan producto', 'Limpieza', 'Falta de personal', 'Calidad', 'Set up'] },
  Spiral: { lineWord: tr('Línea'), unit: tr('Mezcla'), plural: tr('Mezclas'), done: tr('Mezcla lista'), saved: tr('guardada'), qty: 'none', qtyQ: '', qtyUnit: '', perUnitLabel: '', refLabel: '', quick: ['Problema mecánico', 'Falta de producto de Kitchen', 'Break'], reasons: ['Problema mecánico', 'Falta de producto de Kitchen', 'Break', 'Horno (temperatura)', 'Temperatura interna baja', 'Esperando carros / RTE', 'Limpieza', 'Falta de personal', 'Calidad', 'Set up'] },
  RTE: { lineWord: tr('Línea'), unit: tr('Carro'), plural: tr('Carros'), done: tr('Carro listo'), saved: tr('guardado'), qty: 'ask', qtyQ: tr('¿Cuántos pouches lleva este carro?'), qtyUnit: tr('pouches'), perUnitLabel: tr('Pouches por carro'), refLabel: '', waste: true, quick: ['Problema mecánico', 'Sin plástico', 'Break'], reasons: ['Problema mecánico', 'Sin plástico', 'Break', 'Falta de salsa (Kitchen)', 'Falta de arroz / arroz muy frío', 'Falta de carrito vacío', 'Cambio de rollo de plástico', 'Plástico atascado / no corta', 'Máquina corta o rompe paquetes (mecánico)', 'Impresora de sello no imprime', 'Peso fuera de rango (reempaque)', 'Aire en el paquete', 'Conteo / pesado de meatballs', 'Limpieza', 'Falta de personal', 'Set up'] },
  MFO: { lineWord: tr('Línea'), unit: tr('Bin'), plural: tr('Bins'), done: tr('Bin listo'), saved: tr('guardado'), qty: 'ask', qtyQ: tr('¿Cuántas cajas lleva este bin?'), qtyUnit: tr('cajas'), perUnitLabel: '', refLabel: tr('N° de bin'), refWord: 'bin', quick: ['Problema mecánico', 'Falta de producto del freezer', 'Break'], reasons: ['Problema mecánico', 'Falta de producto del freezer', 'Break', 'Armado de máquina', 'Pegado de labels / stickers', 'Esperando gas', 'Preparación (picar pollo…)', 'Falta de material', 'Limpieza', 'Falta de personal', 'Set up'] },
  Packing: { lineWord: tr('Línea'), unit: tr('Pallet'), plural: tr('Pallets'), done: tr('Pallet listo'), saved: tr('guardado'), lots: true, orders: true, qty: 'ask', qtyQ: tr('¿Cuántas cajas lleva este pallet?'), qtyUnit: tr('cajas'), perUnitLabel: tr('Cajas por pallet'), refLabel: tr('N° de tag'), refWord: 'tag', quick: ['Problema mecánico', 'Falta de producto que empacar', 'Break'], reasons: ['Problema mecánico', 'Falta de producto que empacar', 'Break', 'Esperando autorización de QC', 'Label equivocado (despegar labels)', 'Plástico / film', 'Falta de cajas / material de empaque', 'Personal pasó a otra línea', 'Etiquetadora / impresora', 'Montacargas / espacio', 'Limpieza', 'Falta de personal', 'Set up'] },
}
/** what a line's "listo" button says for a moment once the unit is recorded: "Mezcla 5 guardada", "Carro 12 guardado" */
export const savedText = (dept: Dept, n: number) => CFG[dept].unit + ' ' + n + ' ' + CFG[dept].saved

export type Line = { id: string; dept: Dept; name: string; updatedAt: number; deleted?: boolean }
/** one finished unit of work (a cart, a mezcla, a pallet…), how much it carried, its tag / bin number and who tapped it */
export type Unit = { at: number; qty: number | null; ref: string; by: string; lots?: LotPart[]; po?: string } // po = the order it goes to (Order.id)
/** the part of a unit that belongs to one lot: a pallet can carry cases of two lots of the same product */
export type LotPart = { lot: string; qty: number }
/** the lots written on a unit, as they are kept: only real ones (a lot, and a quantity above zero); none = the run's lot */
export const cleanLots = (x: unknown): LotPart[] | undefined => {
  if (!Array.isArray(x)) return undefined
  const out = x.map((l) => ({ lot: String((l as Partial<LotPart> | null)?.lot ?? '').trim(), qty: Number((l as Partial<LotPart> | null)?.qty) })).filter((l) => l.lot && Number.isFinite(l.qty) && l.qty > 0)
  return out.length ? out : undefined
}
/** a unit as it is kept, whatever shape it arrives in (an older version of the app, the server) */
const unitOf = (u: Partial<Unit>): Unit => { const lots = cleanLots(u.lots); return { at: u.at ?? 0, qty: u.qty ?? null, ref: u.ref ?? '', by: u.by ?? '', ...(lots ? { lots } : {}), ...(typeof u.po === 'string' && u.po ? { po: u.po } : {}) } }
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
/** the hours of the two shifts ("HH:MM"; the second may end after midnight) */
export type ShiftHours = { first: string; firstEnd: string; second: string; secondEnd: string }
/** those hours from a date on */
export type ShiftPlan = ShiftHours & { from: string; updatedAt: number }
/** the goal of one line: so much per hour and/or in the whole day, in its room's quantity */
export type LineTarget = { lineId: string; perHour: number | null; perDay: number | null; updatedAt: number }
/**
 * The goal of one shift, of a room ("RTE@2") or of one line ("line:<id>@2"): each shift has its own, set by its
 * manager, and what counts against it is only what that shift makes. (Target and LineTarget above are the goals as
 * they were kept before, one for both shifts: only their pace per hour is still used, see shiftGoalOf.)
 */
export type TurnGoal = { key: string; perHour: number | null; total: number | null; updatedAt: number }
/**
 * The program of a room for a day: a code it has to make and how much of it, in the room's own quantity (mezclas,
 * pouches, cajas). The office types it, as it types the SCHEDULE of its AVANCE sheet and the #BATCH of each room's
 * sheet; every tablet of the room sees it, and what the room registers of that code is taken off it by itself.
 * A code set to 0 is off the program.
 */
export type Plan = { date: string; dept: Dept; code: string; qty: number; updatedAt: number }
export type State = { lines: Line[]; runs: Run[]; stops: Stop[]; products: Product[]; schedule: Schedule; changes: Change[]; targets: Target[]; shifts: ShiftPlan[]; lineTargets: LineTarget[]; orders: Order[]; turnGoals: TurnGoal[]; plans: Plan[] }
/**
 * An order to fill in Packing: so many cases of one product for a customer, to ship by a date. Most carry the
 * customer's purchase order number (PO); some never do and some get it later. See "the orders Packing fills".
 */
export type Order = { id: string; customer: string; po: string; code: string; cases: number | null; shipBy: string; dest: string; closed: boolean; createdAt: number; by: string; updatedAt: number }
/** an order as it is kept, whatever arrives (null = not one: it has no product code) */
function orderOf(id: string, x: Partial<Order> | null | undefined, by: string, updatedAt: number): Order | null {
  if (!id || !x || typeof x !== 'object') return null
  const code = String(x.code ?? '').trim().toUpperCase(), cases = Number(x.cases), ship = String(x.shipBy ?? '')
  if (!code) return null
  return { id, customer: String(x.customer ?? '').trim(), po: String(x.po ?? '').trim(), code, cases: x.cases != null && Number.isFinite(cases) && cases > 0 ? cases : null, shipBy: /^\d{4}-\d{2}-\d{2}$/.test(ship) ? ship : '', dest: String(x.dest ?? '').trim(), closed: !!x.closed, createdAt: Number(x.createdAt) || 0, by, updatedAt }
}
/** the hours the plant works while nobody has set others (see "the shifts" below; these few lines sit here because load() needs them) */
export const SHIFTS_DEFAULT: ShiftHours = { first: '06:00', firstEnd: '15:00', second: '15:30', secondEnd: '01:00' }
const hmOk = (t: unknown): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)
const mins = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
const DAY_MIN = 1440
/** minutes from one time of the clock forward to another */
const ahead = (from: number, to: number) => (((to - from) % DAY_MIN) + DAY_MIN) % DAY_MIN
/** '' when the hours make sense: going round the clock, the first shift starts and ends, then the second starts and ends, before the first starts again */
export function shiftsProblem(h: ShiftHours): string {
  if (![h.first, h.firstEnd, h.second, h.secondEnd].every(hmOk)) return tr('Falta una hora.')
  const a = mins(h.first), end1 = ahead(a, mins(h.firstEnd)), start2 = ahead(a, mins(h.second)), end2 = ahead(a, mins(h.secondEnd)) || DAY_MIN
  return end1 > 0 && end1 <= start2 && start2 < end2 ? '' : tr('Las horas tienen que ir en orden: el turno 1 empieza y termina, después el turno 2 empieza y termina, antes de que vuelva a empezar el turno 1.')
}

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

function isDay(text: string) { return /^\d{4}-\d{2}-\d{2}$/.test(text) }
/** with a server the lines (and products) are shared and come from it; without one, each device starts with a line per room */
const SERVER = !!import.meta.env.VITE_SUPABASE_URL
function fresh(): State { return { lines: SERVER ? [] : DEPTS.map((d) => ({ id: uid(), dept: d, name: lineWordKept(d) + ' 1', updatedAt: 0 })), runs: [], stops: [], products: SERVER ? [] : SAMPLE_PRODUCTS, schedule: {}, changes: [], targets: [], shifts: [], lineTargets: [], orders: [], turnGoals: [], plans: [] } }
function load(): State {
  try {
    type Raw = { lines: Partial<Line>[]; stops: Partial<Stop>[]; runs: (Partial<Run> & { units?: Partial<Unit>[]; carts?: number[] })[]; products?: (Partial<Product> & { pouchesPerCart?: number })[]; schedule?: Schedule; changes?: Partial<Change>[]; targets?: Partial<Target>[]; shifts?: Partial<ShiftPlan>[]; lineTargets?: Partial<LineTarget>[]; orders?: Partial<Order>[]; turnGoals?: Partial<TurnGoal>[]; plans?: Partial<Plan>[] }
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
        shifts: (s.shifts ?? []).filter((x): x is ShiftPlan => !!x && /^\d{4}-\d{2}-\d{2}$/.test(x.from ?? '') && !shiftsProblem(x as ShiftHours)).map((x) => ({ from: x.from, first: x.first, firstEnd: x.firstEnd, second: x.second, secondEnd: x.secondEnd, updatedAt: x.updatedAt ?? 0 })),
        lineTargets: (s.lineTargets ?? []).filter((t) => !!t && !!t.lineId && !isTurnKey(String(t.lineId))).map((t) => ({ lineId: String(t.lineId), perHour: t.perHour ?? null, perDay: t.perDay ?? null, updatedAt: t.updatedAt ?? 0 })),
        orders: (s.orders ?? []).map((o) => (o ? orderOf(String(o.id ?? ''), o, String(o.by ?? ''), o.updatedAt ?? 0) : null)).filter((o): o is Order => !!o),
        plans: (s.plans ?? []).filter((p) => !!p && isDay(String(p.date ?? '')) && DEPTS.includes(p.dept as Dept) && !!normCode(String(p.code ?? ''))).map((p) => ({ date: String(p.date), dept: p.dept as Dept, code: String(p.code).trim().toUpperCase(), qty: Number(p.qty) > 0 ? Number(p.qty) : 0, updatedAt: p.updatedAt ?? 0 })),
        turnGoals: (s.turnGoals ?? []).filter((g) => !!g && isTurnKey(String(g.key ?? ''))).map((g) => ({ key: String(g.key), perHour: g.perHour ?? null, total: g.total ?? null, updatedAt: g.updatedAt ?? 0 })),
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
  const plans = s.plans.filter((p) => p.date >= from || opened.has(p.date) || waiting.has('act_plan|' + planKey(p.date, p.dept, p.code)))
  if (runs.length === s.runs.length && stops.length === s.stops.length && changes.length === s.changes.length && days.length === Object.keys(s.schedule).length && plans.length === s.plans.length) return s
  return { ...s, runs, stops, changes, schedule: Object.fromEntries(days.map((d) => [d, s.schedule[d]])), plans }
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
export const lineNameOf = (s: State, lineId: string | null, was = '') => lineLabel(s.lines.find((l) => l.id === lineId)?.name || was)
/** a line's name as the screen says it: the ones the app names itself ("Línea 3") read "Line 3" in English; a name somebody typed stays as typed */
export function lineLabel(name: string) { return lang === 'en' ? name.replace(/^Línea(?=\s|$)/, 'Line') : name }
/** the note the app writes on a set up ("Después de 0100", "De 0100 a 0215") as the screen says it; a note somebody typed stays as typed */
export function noteLabel(note: string) { const a = /^Después de (.+)$/.exec(note); if (a) return tr('Después de {0}', a[1]); const b = /^De (.+) a (.+)$/.exec(note); return b ? tr('De {0} a {1}', b[1], b[2]) : note }
/** "Línea 2" before "Línea 10" */
export const byLineName = (a: Line, b: Line) => a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' })
export const LINE_NAME_MAX = 24
/** the word a room's lines are named with when the app names them: the name that is KEPT, the same in any language */
// (a function, not a const: it is used while the very first state of a new device is being made, further up this file)
function lineWordKept(d: Dept) { return d === 'Kitchen' ? 'Braiser' : 'Línea' }
/** a name as it is kept: tidy, and with the app's own word for a line (somebody typing "Line 4" on an English screen means "Línea 4") */
export const tidyLineName = (t: string) => (lang === 'en' ? t.trim().replace(/^Line(?=\s|$)/i, 'Línea') : t).replace(/\s+/g, ' ').trim().slice(0, LINE_NAME_MAX).trim()
/** two names are the same line name whatever the capitals, accents or spaces: "linea  2" = "Línea 2" */
const sameName = (a: string, b: string) => { const f = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); return f(a) === f(b) }
/** the line of that room that already has this name, other than `selfId` */
export const lineNamed = (s: State, dept: Dept, name: string, selfId?: string) => s.lines.find((l) => l.dept === dept && l.id !== selfId && sameName(l.name, name))
/** the standard names nobody has yet in a room ("Línea 1", "Línea 3"…), lowest first */
export function freeLineNames(s: State, dept: Dept, count = 4): string[] {
  const out: string[] = []
  for (let n = 1; out.length < count && n <= 99; n++) { const name = lineWordKept(dept) + ' ' + n; if (!lineNamed(s, dept, name)) out.push(name) }
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
 * A line with no code on it is waiting for the next one. What was left open there when its last code ended (its set
 * up, or the cause a manager gave to part of that time) is a stop only once that next code starts: the tablet cannot
 * tell whether anybody is still at the line, and people go home without saying so. While it waits it is on the line's
 * card with its clock, and in no report and no total. If no code comes, it never counted.
 */
export const waitsForCode = (s: State, x: Stop) => !x.endedAt && x.lineId !== null && !s.runs.some((r) => r.lineId === x.lineId && !r.endedAt)
/** what waits on a line is of its day of work: the first code of the next morning does not close last night's set up, it drops it */
const fromOtherDay = (s: State, x: Stop, at: number) => plainDay(s, x.startedAt) !== plainDay(s, at)
/**
 * What a line between two codes is waiting with: the set up written when its last code ended (or the cause a manager
 * gave to part of that time), while it is still open, of the day of work in course and recent enough to be one.
 * undefined = it is not between codes.
 */
export const idleStop = (s: State, lineId: string, now: number) =>
  s.runs.some((r) => r.lineId === lineId && !r.endedAt) ? undefined : s.stops.find((x) => x.lineId === lineId && !x.endedAt && now - x.startedAt <= SETUP_MAX_MS && !fromOtherDay(s, x, now))
/**
 * A code starts on a line. Whatever the line was stopped for since its last code (its set up, or the causes that time
 * was divided into) ends at this moment, and from this moment it counts. A set up of seconds is not one, and neither
 * is what was left open for hours on a line nobody was using, or since the day before: those are dropped.
 */
export function startRun(line: Line, code: string, lot: string, date: string, perUnit: number | null) {
  const at = clockNow()
  batch(() => {
    for (const x of state.stops.filter((y) => y.lineId === line.id && !y.endedAt)) {
      const age = at - x.startedAt
      if (age > SETUP_MAX_MS || fromOtherDay(state, x, at) || (x.reason === SETUP && age < 60_000)) putStop({ ...x, deleted: true })
      else putStop({ ...x, endedAt: Math.max(at, x.startedAt), note: x.reason === SETUP && x.note.startsWith(AFTER) ? 'De ' + x.note.slice(AFTER.length) + ' a ' + code : x.note })
    }
    putRun({ id: uid(), dept: line.dept, lineId: line.id, line: line.name, code, lot, date, startedAt: at, endedAt: null, units: [], perUnit, waste: 0, by: user.get(), updatedAt: 0 })
  })
}
const run = (id: string) => state.runs.find((r) => r.id === id)
/** the last moment already on a run: nothing recorded after it may be stamped earlier (the clock can be corrected between two taps) */
const after = (r: Run) => Math.max(r.startedAt, r.units.length ? r.units[r.units.length - 1].at + 1 : 0)
/** a unit finished on the line. `lots` = what it carries of each lot when it is not all of the run's lot; the quantity is then their sum */
export function unitDone(runId: string, qty: number | null, ref = '', lots?: LotPart[], po?: string) {
  const r = run(runId)
  if (!r) return
  const parts = cleanLots(lots)
  putRun({ ...r, units: [...r.units, { at: Math.max(clockNow(), after(r)), qty: parts ? parts.reduce((t, l) => t + l.qty, 0) : qty, ref, by: user.get(), ...(parts ? { lots: parts } : {}), ...(po ? { po } : {}) }] })
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
/** what is still open in a room: the codes running, the set ups waiting for a code that has not come, and any other stop */
export function openIn(s: State, dept: Dept) {
  const runs = s.runs.filter((r) => r.dept === dept && !r.endedAt), busy = new Set(runs.map((r) => r.lineId))
  const open = s.stops.filter((x) => x.dept === dept && !x.endedAt)
  const setups = open.filter((x) => x.reason === SETUP && x.lineId !== null && !busy.has(x.lineId))
  return { runs, setups, stops: open.filter((x) => !setups.includes(x)) }
}
/**
 * The people of a room are leaving and nothing goes on: every code still running ends now, with no set up after it;
 * a set up that was waiting for another code is taken away (none came); any other stop ends now. It is theirs to say
 * when the shift ends: the hours of the shifts never end anything. (When the next shift goes on with the same codes
 * there is nothing to do: they are left running.) Returns how many of each it closed.
 */
export function endShift(dept: Dept) {
  const { runs, setups, stops } = openIn(state, dept), at = clockNow()
  if (!runs.length && !setups.length && !stops.length) return { runs: 0, setups: 0, stops: 0 }
  batch(() => {
    for (const x of stops) putStop({ ...x, endedAt: Math.max(at, x.startedAt) })
    for (const x of setups) putStop({ ...x, deleted: true })
    for (const r of runs) putRun({ ...r, endedAt: Math.max(at, after(r)) })
  })
  const n = (k: number, one: string, many: string) => (k ? k + ' ' + (k === 1 ? one : many) : '')
  logChange(dept, 'Turno terminado en ' + dept, '', [n(runs.length, 'código terminado', 'códigos terminados'), n(setups.length, 'Set up quitado', 'Set up quitados'), n(stops.length, 'paro cerrado', 'paros cerrados')].filter(Boolean).join(' · '), 'act_shift_end', dept + ':' + at)
  return { runs: runs.length, setups: setups.length, stops: stops.length }
}
/** no other code is coming after all: what was counting between codes is taken away (it was never a stop of the line) */
export function dropSetup(id: string) { const x = state.stops.find((y) => y.id === id); if (x && !x.endedAt) putStop({ ...x, deleted: true }) }
/**
 * A line that is running a code is not in set up. A set up still open from before that code started (the tablet that
 * started the code had not heard of it, or runs an older version of the app) ends where the code began; one left
 * from the day before, or open for hours, is dropped as startRun would have.
 */
function healSetup(lineId: string) {
  const r = state.runs.find((x) => x.lineId === lineId && !x.endedAt)
  if (!r) return
  for (const x of state.stops.filter((y) => y.lineId === lineId && !y.endedAt && y.reason === SETUP && y.startedAt <= r.startedAt)) putStop(r.startedAt - x.startedAt > SETUP_MAX_MS || fromOtherDay(state, x, r.startedAt) ? { ...x, deleted: true } : { ...x, endedAt: r.startedAt })
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
/**
 * A run recorded on the wrong line's card goes to the line that made it, with the stops that began in its time (and
 * the set up that began when it ended). Not onto a line that had another code in that time, nor, while it is still
 * running, onto a line that is stopped: two things cannot be on one line at once.
 */
export function moveRun(id: string, lineId: string): boolean {
  const r = run(id), to = state.lines.find((l) => l.id === lineId)
  if (!r || !to || to.dept !== r.dept || lineId === r.lineId) return false
  const end = r.endedAt ?? Infinity
  if (state.runs.some((x) => x.id !== r.id && x.lineId === lineId && x.startedAt < end && (x.endedAt ?? Infinity) > r.startedAt)) return false
  if (!r.endedAt && state.stops.some((x) => x.lineId === lineId && !x.endedAt)) return false
  const was = lineNameOf(state, r.lineId, r.line)
  batch(() => {
    for (const x of state.stops.filter((y) => y.lineId === r.lineId && y.startedAt >= r.startedAt && y.startedAt <= end)) putStop({ ...x, lineId })
    putRun({ ...r, lineId, line: to.name })
  })
  logChange(r.dept, 'Corrida ' + r.code + ' del ' + r.date + ' (' + r.dept + ') · Línea', was, to.name, 'act_runs', r.id)
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
/** letters and digits only, without accents or capitals: "Set-up", "setup" and "SET UP" are one cause */
const plain = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
/**
 * A cause typed by hand ("Otra") that is one of the department's own written another way is saved with the list's
 * spelling: the report must not count "break", "Break" and "BREAK" as three causes, nor miss a typed "setup".
 */
export const tidyReason = (dept: Dept, text: string) => { const t = text.replace(/\s+/g, ' ').trim(), k = plain(t); return (k && CFG[dept].reasons.find((r) => plain(r) === k || plain(trIn('en', r)) === k)) || t }
export function startStop(dept: Dept, lineId: string | null, reason: string, note: string) {
  putStop({ id: uid(), dept, lineId, reason: tidyReason(dept, reason), note, startedAt: clockNow(), endedAt: null, by: user.get(), updatedAt: 0 })
}
const stop = (id: string) => state.stops.find((x) => x.id === id)
export function endStop(id: string) { const x = stop(id); if (x) putStop({ ...x, endedAt: Math.max(clockNow(), x.startedAt) }) }
export function updateStop(id: string, patch: Partial<Pick<Stop, 'reason' | 'note' | 'startedAt' | 'endedAt'>>) {
  const x = stop(id)
  if (!x) return
  const n = { ...x, ...patch, ...(patch.reason != null ? { reason: tidyReason(x.dept, patch.reason) } : {}) }
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
  const rest: Stop = { id: uid(), dept: x.dept, lineId: x.lineId, reason: tidyReason(x.dept, reason), note: note.trim(), startedAt: at, endedAt: x.endedAt, by: user.get(), updatedAt: 0 }
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
// ---- the orders Packing fills ----
/**
 * The office types the orders (a manager can too); Packing sees the open ones of the code it is packing and says,
 * pallet by pallet, which one each goes to, or none: not everything packed is for an order. An order is filled over
 * several days, and the app adds up what has been packed for it.
 * They travel in act_changes, the table with room for words, where a row without a room is written only by managers
 * and the office: id "po:<id>", ref_table "act_orders", the order in `after` as JSON. Their `at` is a fixed far date:
 * devices let go of history older than two weeks and fetch only the recent one when they sign in, and an order has to
 * be there for as long as it is open. They are kept apart from the history (state.orders), never among its lines.
 */
const ORDER_REF = 'act_orders', ORDER_ID = 'po:', ORDER_LOG = 'act_orders_log'
const ORDER_AT = Date.UTC(2099, 0, 1, 12)
const rowOfOrder = (o: Order, deleted = false) => ({ id: ORDER_ID + o.id, at: iso(ORDER_AT), by_name: o.by, dept: null, what: 'Pedido', before: '', after: JSON.stringify({ customer: o.customer, po: o.po, code: o.code, cases: o.cases, shipBy: o.shipBy, dest: o.dest, closed: o.closed, createdAt: o.createdAt }), ref_table: ORDER_REF, ref_key: o.id, deleted, updated_at: iso(o.updatedAt), updated_by: user.get() })
const putOrder = (o: Order) => { set({ ...state, orders: [...state.orders.filter((x) => x.id !== o.id), o] }); push('act_changes', ORDER_ID + o.id, rowOfOrder(o)) }
export const orderOfId = (s: State, id: string | undefined) => (id ? s.orders.find((o) => o.id === id) : undefined)
/** "Cliente · PO 123", or "Cliente · sin PO" while it has no number */
export const orderLabel = (o: Order) => [o.customer, o.po ? 'PO ' + o.po : tr('sin PO')].filter(Boolean).join(' · ')
/** an order as the history keeps it: always in the same words, whatever language the screen is in */
const orderLabelKept = (o: Order) => [o.customer, o.po ? 'PO ' + o.po : 'sin PO'].filter(Boolean).join(' · ')
const orderText = (o: Order) => [orderLabelKept(o), 'código ' + o.code, o.cases != null ? o.cases + ' cajas' : '', o.shipBy ? 'envío ' + o.shipBy : '', o.dest, o.closed ? 'completo' : ''].filter(Boolean).join(' · ')
/** the one that ships first on top; those without a date, last */
export const byShip = (a: Order, b: Order) => (a.shipBy || '9999').localeCompare(b.shipBy || '9999') || a.createdAt - b.createdAt
/** the orders still open for a product */
export const openOrdersFor = (s: State, code: string) => s.orders.filter((o) => !o.closed && normCode(o.code) === normCode(code)).sort(byShip)
/**
 * The order the next unit of a run is proposed for: the one its last unit went to, while that one still lacks cases;
 * otherwise the first open order of the code that still lacks them (the one that ships first). When the person left
 * the last unit without an order, that choice stands, unless an order has been typed since: a new one is proposed.
 */
export function nextOrderFor(s: State, r: Run): string {
  const lacking = openOrdersFor(s, r.code).filter((o) => o.cases == null || o.cases - orderMade(s, o.id) > 0)
  const last = r.units[r.units.length - 1]
  if (last && !last.po) return lacking.find((o) => o.createdAt > last.at)?.id ?? ''
  return (lacking.find((o) => o.id === last?.po) ?? lacking[0])?.id ?? ''
}
/** the cases already packed for an order: every unit that was given to it, on the days this device holds */
export const orderMade = (s: State, id: string) => s.runs.reduce((t, r) => t + r.units.filter((u) => u.po === id).reduce((a, u) => a + unitQty(s, r, u), 0), 0)
/** the product codes typed in one box, for a PO that covers several: "0100, 0200 0300" gives three (each one once) */
export const orderCodes = (text: string) => [...new Set(text.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean))]
/**
 * writes an order, or changes one (its PO number can come later). '' when it has no product code. The same PO number
 * can be on as many orders as the office wants (one per product, or the same product again): it is theirs to say.
 */
export function saveOrder(id: string | null, x: { customer: string; po: string; code: string; cases: number | null; shipBy: string; dest: string }): string {
  const old = id ? state.orders.find((o) => o.id === id) : undefined
  const o = orderOf(old?.id ?? uid(), { ...x, closed: old?.closed ?? false, createdAt: old?.createdAt ?? clockNow() }, old?.by ?? user.get(), stamp(old))
  if (!o) return ''
  putOrder(o)
  logChange(null, old ? 'Pedido cambiado' : 'Pedido nuevo', old ? orderText(old) : '', orderText(o), ORDER_LOG, o.id)
  return o.id
}
/** an order is complete (Packing is no longer offered it), or is opened again */
export function closeOrder(id: string, closed: boolean) {
  const o = state.orders.find((x) => x.id === id)
  if (!o || o.closed === closed) return
  putOrder({ ...o, closed, updatedAt: stamp(o) })
  logChange(null, closed ? 'Pedido completo' : 'Pedido abierto otra vez', '', orderText({ ...o, closed: false }), ORDER_LOG, o.id + (closed ? ':c' : ':o'))
}
/** an order written by mistake is taken away; the units that were given to it stay recorded, with no order */
export function deleteOrder(id: string) {
  const o = state.orders.find((x) => x.id === id)
  if (!o) return
  set({ ...state, orders: state.orders.filter((x) => x.id !== id) })
  push('act_changes', ORDER_ID + id, rowOfOrder({ ...o, updatedAt: stamp(o) }, true))
  logChange(null, 'Pedido borrado', orderText(o), '', ORDER_LOG, id + ':d')
}
/** which order a unit already recorded goes to ('' = none): a correction */
export function setUnitOrder(runId: string, at: number, orderId: string) {
  const r = run(runId), i = r ? r.units.findIndex((u) => u.at === at) : -1
  if (!r || i < 0) return
  const was = orderOfId(state, r.units[i].po), to = orderOfId(state, orderId)
  if ((was?.id ?? '') === (to?.id ?? '') && !!r.units[i].po === !!to) return
  putRun({ ...r, units: r.units.map((u) => { if (u.at !== at) return u; const { po: _was, ...bare } = u; return to ? { ...bare, po: to.id } : bare }) })
  logChange(r.dept, 'Corrida ' + r.code + ' del ' + r.date + ' (' + r.dept + ', ' + lineNameOf(state, r.lineId, r.line) + ') · ' + CFG[r.dept].unit + ' ' + (i + 1) + ' · pedido', was ? orderLabelKept(was) : '', to ? orderLabelKept(to) : '', 'act_runs', r.id)
}
// ---- the shifts ----
/**
 * The plant works two shifts, and their hours have been moved more than once: the manager changes them in the app, and
 * each version is kept with the date it starts to count, so an earlier day is still split with the hours it had.
 * They travel in act_targets, the table of what the manager sets for everybody (only managers write it, and a device
 * keeps all of it): key "shifts:<date>", the first shift in per_hour and the second in per_shift, each as HHMM of its
 * start × 10000 + HHMM of its end (06:00 to 15:00 is 6001500).
 */
const SHIFTS_KEY = 'shifts:'
const hhmm = (hm: string) => Number(hm.slice(0, 2)) * 100 + Number(hm.slice(3, 5))
const hmOf = (n: number) => String(Math.floor(n / 100)).padStart(2, '0') + ':' + String(n % 100).padStart(2, '0')
const packShift = (start: string, end: string) => hhmm(start) * 10000 + hhmm(end)
const unpackShift = (n: unknown): [string, string] | null => {
  const x = Number(n)
  if (n == null || n === '' || !Number.isInteger(x) || x < 0) return null
  const a = hmOf(Math.floor(x / 10000)), b = hmOf(x % 10000)
  return hmOk(a) && hmOk(b) ? [a, b] : null
}
const rowOfShifts = (x: ShiftPlan) => ({ dept: SHIFTS_KEY + x.from, per_hour: packShift(x.first, x.firstEnd), per_shift: packShift(x.second, x.secondEnd), updated_at: iso(x.updatedAt), updated_by: user.get() })
/** the hours in force on a day: the last version that starts on or before it (the usual ones while nobody has set any) */
export function shiftsOf(s: State, date: string): ShiftHours & { from: string } {
  return s.shifts.filter((x) => x.from <= date).sort((a, b) => (a.from < b.from ? 1 : -1))[0] ?? { ...SHIFTS_DEFAULT, from: '' }
}
/** "6:00 AM" for "06:00" */
export const clockText = (hm: string) => fmtTime(new Date(2000, 0, 1, Number(hm.slice(0, 2)), Number(hm.slice(3, 5))).getTime())
/** "3:15 PM" for minute 915 of the day */
export const minuteText = (m: number) => fmtTime(new Date(2000, 0, 1, Math.floor(m / 60), Math.floor(m % 60)).getTime())
/** "6:00 AM a 3:00 PM": the hours of one shift */
/** when a shift starts and when it ends, as two texts: "6:00 AM", "3:00 PM" */
export const shiftSpan = (h: ShiftHours, shift: 1 | 2): [string, string] => (shift === 1 ? [clockText(h.first), clockText(h.firstEnd)] : [clockText(h.second), clockText(h.secondEnd)])
export const shiftHours = (h: ShiftHours, shift: 1 | 2) => tr('{0} a {1}', ...shiftSpan(h, shift))
export const shiftsText = (h: ShiftHours) => 'Turno 1 de ' + shiftSpan(h, 1).join(' a ') + ' · Turno 2 de ' + shiftSpan(h, 2).join(' a ')
/** the manager sets the hours of the shifts from a date on (the same date again replaces what was set for it) */
export function setShifts(from: string, h: ShiftHours): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || shiftsProblem(h)) return false
  const was = shiftsOf(state, from), old = state.shifts.find((x) => x.from === from)
  const x: ShiftPlan = { from, first: h.first, firstEnd: h.firstEnd, second: h.second, secondEnd: h.secondEnd, updatedAt: stamp(old) }
  set({ ...state, shifts: [...state.shifts.filter((y) => y.from !== from), x] })
  push('act_targets', SHIFTS_KEY + from, rowOfShifts(x))
  logChange(null, 'Horario de turnos desde el ' + from, shiftsText(was), shiftsText(x), 'act_targets', SHIFTS_KEY + from)
  return true
}
/**
 * The two moments of the clock (in minutes) where one shift hands over to the other: halfway between the end of one
 * and the start of the next. So the last cart of people who stay a little late, and the first one of people who come
 * in a little early, are counted with their own shift.
 */
export function shiftCuts(h: ShiftHours) {
  const mid = (from: string, to: string) => (mins(from) + ahead(mins(from), mins(to)) / 2) % DAY_MIN
  return { toSecond: mid(h.firstEnd, h.second), toFirst: mid(h.secondEnd, h.first) }
}
const clockMin = (at: number) => { const d = new Date(at); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60_000 }
/** the shift a moment belongs to, by the clock */
export function shiftAt(h: ShiftHours, at: number): 1 | 2 {
  const { toFirst, toSecond } = shiftCuts(h), m = clockMin(at)
  return (toFirst <= toSecond ? m >= toFirst && m < toSecond : m >= toFirst || m < toSecond) ? 1 : 2
}
/** the hand-overs of the calendar days around a moment, in order */
function cutsNear(h: ShiftHours, at: number) {
  const { toFirst, toSecond } = shiftCuts(h), d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return [-1, 0, 1].flatMap((day) => [toFirst, toSecond].map((c) => d.getTime() + day * 86_400_000 + Math.round(c * 60_000))).sort((a, b) => a - b)
}
/** the first hand-over after a moment, and the last one at or before it */
const nextCut = (h: ShiftHours, at: number) => cutsNear(h, at).find((t) => t > at) ?? at + 86_400_000
export const lastCut = (h: ShiftHours, at: number) => cutsNear(h, at).filter((t) => t <= at).pop() ?? at - 86_400_000
/** the time between two moments, cut where the shifts hand over: each piece with its shift */
export function shiftPieces(h: ShiftHours, a: number, b: number) {
  const out: { from: number; to: number; shift: 1 | 2 }[] = []
  for (let cur = a, n = 0; cur < b && n < 2000; n++) { const to = Math.min(b, nextCut(h, cur)); out.push({ from: cur, to, shift: shiftAt(h, cur) }); cur = to }
  return out
}
/**
 * The shift in course on a day of work: which one it is and the two hand-overs it lies between. What the screens of
 * the floor count "in this shift" is what was recorded since the first of them: every shift starts from zero.
 */
export function turnOf(s: State, date: string, now: number) {
  const plan = shiftsOf(s, date)
  return { shift: shiftAt(plan, now), since: lastCut(plan, now), until: nextCut(plan, now) }
}
type Span = { from: number; to: number }
/** what is left of a stretch of time once some stretches are taken out of it */
function without(a: number, b: number, out: Span[]): Span[] {
  let left: Span[] = b > a ? [{ from: a, to: b }] : []
  for (const o of out) left = left.flatMap((p) => (o.to <= p.from || o.from >= p.to ? [p] : [...(o.from > p.from ? [{ from: p.from, to: o.from }] : []), ...(o.to < p.to ? [{ from: o.to, to: p.to }] : [])]))
  return left
}
/**
 * The stretches around [a, b) in which no shift is on, by the hours set: between the first shift and the second, and
 * between the second and the next first.
 */
function gapsNear(h: ShiftHours, a: number, b: number) {
  const f = mins(h.first), len1 = ahead(f, mins(h.firstEnd)), gap1 = ahead(mins(h.firstEnd), mins(h.second)), len2 = ahead(mins(h.second), mins(h.secondEnd)), gap2 = ahead(mins(h.secondEnd), f)
  const d = new Date(a)
  d.setHours(0, 0, 0, 0)
  const out: Span[] = []
  for (let day = d.getTime() - 86_400_000; day <= b; day += 86_400_000) {
    const g1 = day + (f + len1) * 60_000, g2 = g1 + (gap1 + len2) * 60_000
    if (gap1 > 0) out.push({ from: g1, to: g1 + gap1 * 60_000 })
    if (gap2 > 0) out.push({ from: g2, to: g2 + gap2 * 60_000 })
  }
  return out.filter((g) => g.to > a && g.from < b)
}
const marksCache = new WeakMap<State, Map<string, number[]>>()
/** every moment something was recorded on a line: a code started or ended, a unit, a stop started or ended */
function marksOf(s: State, lineId: string) {
  let byLine = marksCache.get(s)
  if (!byLine) marksCache.set(s, (byLine = new Map()))
  let m = byLine.get(lineId)
  if (!m) byLine.set(lineId, (m = [...s.runs.filter((r) => r.lineId === lineId).flatMap((r) => [r.startedAt, ...(r.endedAt ? [r.endedAt] : []), ...r.units.map((u) => u.at)]), ...s.stops.filter((x) => x.lineId === lineId).flatMap((x) => [x.startedAt, ...(x.endedAt ? [x.endedAt] : [])])]))
  return m
}
/**
 * The stretches of [a, b) that do not count on a line. Time never stops by itself while it is happening: people who
 * stay after their hour or start before it are working, and it is theirs to say when they stop. Only afterwards, once
 * a whole stretch between two shifts is over (the time in which one shift leaves and the other comes in, or the
 * night), and only when nothing at all was recorded on the line in it (no unit, no stop, no code started or ended), is
 * that stretch taken out: nobody was there, so it was neither worked nor a stop. One record in it and all of it
 * counts. `own` = the records to go by when it is not one line's (a stop of the whole room).
 */
export function awayOn(s: State, lineId: string | null, date: string, a: number, b: number, now: number, own: number[] = []): Span[] {
  if (!(b > a)) return []
  const marks = lineId ? marksOf(s, lineId) : own
  return gapsNear(shiftsOf(s, date), a, b)
    .filter((g) => g.to <= now && !marks.some((m) => m >= g.from && m < g.to))
    .map((g) => ({ from: Math.max(g.from, a), to: Math.min(g.to, b) })).filter((x) => x.to > x.from)
}
/** the time a run has counted since a moment (its last unit, or its start) */
export function workedSince(s: State, r: Run, from: number, now: number) {
  const stops = stopsOf(s, r.dept, r.lineId)
  return without(from, now, awayOn(s, r.lineId, r.date, from, now, now)).reduce((t, x) => t + activeBetween(x.from, x.to, stops, now), 0)
}
/** the stretches a stop counts (see awayOn) */
export function stopSpans(s: State, x: Stop, now: number): Span[] {
  const end = x.endedAt ?? now
  return without(x.startedAt, end, awayOn(s, x.lineId, plainDay(s, x.startedAt), x.startedAt, end, now, [x.startedAt, ...(x.endedAt ? [x.endedAt] : [])]))
}
/** how long a stop counts */
export const stopTime = (s: State, x: Stop, now: number) => stopSpans(s, x, now).reduce((t, p) => t + (p.to - p.from), 0)
/** a run's time within one shift: what it worked and what it was stopped in it, with the causes */
export function runInShift(s: State, r: Run, now: number, h: ShiftHours, shift: 1 | 2) {
  const stops = stopsOf(s, r.dept, r.lineId), end = r.endedAt ?? now, away = awayOn(s, r.lineId, r.date, r.startedAt, end, now)
  const mine = shiftPieces(h, r.startedAt, end).filter((x) => x.shift === shift).flatMap((x) => without(x.from, x.to, away))
  const reasons: Record<string, number> = {}
  let working = 0, down = 0
  for (const w of mine) {
    working += activeBetween(w.from, w.to, stops, now)
    for (const x of stoppedPieces(w.from, w.to, stops, now)) { down += x.to - x.from; reasons[x.reason] = (reasons[x.reason] ?? 0) + (x.to - x.from) }
  }
  // from / to = the first and the last moment of the run that count in this shift (0 when none does)
  return { working, down, reasons, total: mine.reduce((t, w) => t + (w.to - w.from), 0), touched: mine.length > 0, from: mine.length ? mine[0].from : 0, to: mine.length ? mine[mine.length - 1].to : 0 }
}
// ---- the day of work ----
const DAY_REF = 'act_days'
/** a line of history written as it is (logChange merges retyped values; these are events of their own) */
const putChange = (c: Change) => { set({ ...state, changes: upsertIn(state.changes, c) }); push('act_changes', c.id, rowOfChange(c)) }
/** how long after midnight a day of work still lasts: until the second shift hands over to the first (3:30 with the usual hours) */
const nightMs = (s: State, date: string) => { const c = shiftCuts(shiftsOf(s, date)).toFirst; return c <= 720 ? Math.round(c * 60_000) : 0 }
/**
 * a day of work lasts until the second shift hands over to the first: a shift that runs past midnight keeps its date
 * and its lot, and the morning shift is never handed yesterday's date, even when it starts a little before its hour
 */
const dayEnds = (s: State, date: string) => { const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() + 1); return d.getTime() + nightMs(s, dayOf(d.getTime())) }
export type WorkDay = { date: string; started: { at: number; by: string } | null }
/**
 * the day in course: the one somebody started ("Empezar el día") while it lasts; otherwise the calendar's, where the
 * hours after midnight still belong to the second shift of the day before
 */
export function workDay(s: State, now = clockNow()): WorkDay {
  const m = s.changes.filter((c) => c.refTable === DAY_REF && !c.deleted && c.at <= now && now < dayEnds(s, c.refKey)).sort((a, b) => b.at - a.at)[0]
  return m ? { date: m.refKey, started: { at: m.at, by: m.by } } : { date: plainDay(s, now), started: null }
}
/** the day of work a moment falls in while nobody has started one: the calendar's, with the night still on the day before */
export const plainDay = (s: State, at: number) => dayOf(at - nightMs(s, dayOf(at)))
/** "3:30 AM": the hour of the night at which a day of work gives way to the next */
export const nightText = (s: State, date: string) => minuteText(nightMs(s, date) / 60_000)
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
    putChange({ id: uid(), at: now, by: user.get(), dept: null, what: 'Se borraron los registros del ' + date + (before < Infinity ? ' anteriores a las ' + fmtTime(before) : ''), before: runs.length + (runs.length === 1 ? ' corrida' : ' corridas') + ' · ' + stops.length + (stops.length === 1 ? ' paro' : ' paros'), after: '', refTable: PURGE_REF, refKey: date, updatedAt: now })
  })
  return { runs: runs.length, stops: stops.length }
}
// ---- what was taken away by mistake comes back ----
export const PURGE_REF = DAY_REF + ':purge'
const RESTORE_REF = DAY_REF + ':restore'
/** how long before the moment a purge is written its rows may have been marked (they are all marked in the same instant, just before) */
const PURGE_WINDOW_MS = 120_000
/** the times the records of a day were taken away and have not been brought back: when, by whom and how many (said in the report) */
export const purgesOf = (s: State, date: string) => s.changes.filter((c) => c.refTable === PURGE_REF && c.refKey === date && !c.deleted && !s.changes.some((r) => r.refTable === RESTORE_REF && r.refKey === c.id && !r.deleted)).sort((a, b) => a.at - b.at)
/**
 * The records a purge took away come back. Nothing is ever erased on the server: a record that is "deleted" is only
 * marked, whole, with its units, its lots and its hours. This takes the mark off, and every device shows it again.
 * `rows` = what the server holds of that day (see fetchPurged in sync.ts). Only what was marked at the moment of THAT
 * purge comes back, not a run a manager deleted on its own for its own reason. A code or a stop that was still
 * running then comes back ended at that moment: nothing was recorded on it afterwards (it was off every screen), and
 * its line may have started another code since. null = this device does not know that purge.
 */
export function restorePurged(purgeId: string, rows: { runs: Row[]; stops: Row[]; changes: Row[] }): { runs: number; stops: number } | null {
  const mark = state.changes.find((c) => c.id === purgeId && c.refTable === PURGE_REF)
  if (!mark) return null
  // marked at that moment or later (a tablet that was touching a row just then may have left its mark a little after),
  // and already there when it happened: what was deleted on its own before, or recorded afterwards, is not of that purge
  const taken = (x: { deleted?: boolean; updatedAt: number }, began: number) => !!x.deleted && x.updatedAt >= mark.at - PURGE_WINDOW_MS && began <= mark.at
  const runs = rows.runs.map(runOfRow).filter((r) => taken(r, r.startedAt) && r.date === mark.refKey && !state.runs.some((x) => x.id === r.id))
  // (the listing of a day's stops reaches into the days around it; the purge only took the ones that began on that date)
  const stops = rows.stops.map(stopOfRow).filter((x) => taken(x, x.startedAt) && dayOf(x.startedAt) === mark.refKey && !state.stops.some((y) => y.id === x.id))
  const lines = rows.changes.map(changeOfRow).filter((c) => taken(c, c.at) && (c.refTable === 'act_runs' || c.refTable === 'act_stops'))
  batch(() => {
    for (const r of runs) putRun({ ...r, deleted: false, endedAt: r.endedAt ?? Math.max(mark.at, r.startedAt, ...r.units.map((u) => u.at + 1)) })
    for (const x of stops) putStop({ ...x, deleted: false, endedAt: x.endedAt ?? Math.max(mark.at, x.startedAt) })
    for (const c of lines) putChange({ ...c, deleted: false, updatedAt: stamp(c) })
    const now = clockNow()
    putChange({ id: uid(), at: now, by: user.get(), dept: null, what: 'Se recuperaron los registros del ' + mark.refKey + ' borrados a las ' + fmtTime(mark.at), before: '', after: runs.length + (runs.length === 1 ? ' corrida' : ' corridas') + ' · ' + stops.length + (stops.length === 1 ? ' paro' : ' paros'), refTable: RESTORE_REF, refKey: mark.id, updatedAt: now })
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
export function resetRecords() { set({ ...state, runs: [], stops: [], schedule: {}, changes: [], plans: [] }); resync() }

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
export const casesText = (c: { cases: number; loose: number } | null) => {
  if (!c) return ''
  const n = c.cases.toLocaleString('en-US'), cases = c.cases === 1 ? tr('{0} caja', n) : tr('{0} cajas', n)
  return c.loose ? tr('{0} y {1}', cases, c.loose === 1 ? tr('{0} suelto', c.loose) : tr('{0} sueltos', c.loose)) : cases
}
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
// ---- the program of each room ----
/** (a function: pruned() uses it while this file is still being read) */
function planKey(date: string, dept: Dept, code: string) { return date + '|' + dept + '|' + normCode(code) }
const rowOfPlan = (p: Plan) => ({ date: p.date, dept: p.dept, code: normCode(p.code), qty: p.qty, updated_at: iso(p.updatedAt), updated_by: user.get() })
/** what a room has on its program for a day */
export const planOf = (s: State, date: string, dept: Dept) => s.plans.filter((p) => p.date === date && p.dept === dept && p.qty > 0)
/** the office sets how much of a code a room has to make on a day (nothing = the code is taken off its program) */
export function setPlan(date: string, dept: Dept, code: string, qty: number) {
  const key = normCode(code)
  if (!key || !isDay(date) || !DEPTS.includes(dept)) return
  const n = Number.isFinite(qty) && qty > 0 ? Math.round(qty * 100) / 100 : 0
  const old = state.plans.find((p) => p.date === date && p.dept === dept && normCode(p.code) === key)
  if ((old?.qty ?? 0) === n) return
  const p: Plan = { date, dept, code: code.trim().toUpperCase(), qty: n, updatedAt: stamp(old) }
  set({ ...state, plans: [...state.plans.filter((x) => x !== old), p] })
  push('act_plan', planKey(date, dept, key), rowOfPlan(p))
  logChange(dept, 'Programa ' + date + ' · ' + dept + ' · ' + key, v(old?.qty), v(n), 'act_plan', planKey(date, dept, key))
}
/**
 * One code of a room's day against its program: what was set, what the room has registered of it (in all, and by
 * each shift, as the office's sheet has its "1 TURNO" and "2 TURNO"), and what is left: programmed minus made, taken
 * off by itself with every unit registered (negative = more than the program, the red cells of that sheet).
 * planned 0 = a code the room made that was not on its program.
 */
export type PlanRow = { code: string; name: string; planned: number; done: number; byShift: [number, number]; left: number; running: boolean; lines: string[] }
export function planRows(s: State, date: string, dept: Dept): PlanRow[] {
  const cfg = CFG[dept], hours = shiftsOf(s, date)
  const runs = s.runs.filter((r) => r.dept === dept && r.date === date), plan = planOf(s, date, dept)
  const one = (r: Run, u: Unit) => (cfg.qty === 'none' ? 1 : unitQty(s, r, u))
  const keys = [...new Set([...plan.map((p) => normCode(p.code)), ...runs.map((r) => normCode(r.code))])]
  return keys.map((key): PlanRow => {
    const mine = runs.filter((r) => normCode(r.code) === key), set = plan.find((p) => normCode(p.code) === key), product = productOf(s, key)
    const made = (k: 0 | 1 | 2) => mine.reduce((t, r) => t + r.units.filter((u) => !k || shiftAt(hours, u.at) === k).reduce((a, u) => a + one(r, u), 0), 0)
    const done = made(0), planned = set?.qty ?? 0, open = mine.filter((r) => !r.endedAt)
    return { code: product?.code ?? set?.code ?? mine[0]?.code ?? key, name: product?.name ?? '', planned, done, byShift: [made(1), made(2)], left: planned ? Math.round((planned - done) * 100) / 100 : 0, running: open.length > 0, lines: [...new Set(open.map((r) => lineNameOf(s, r.lineId, r.line)))] }
  }).sort((a, b) => Number(b.planned > 0) - Number(a.planned > 0) || a.code.localeCompare(b.code, undefined, { numeric: true }))
}
export const targetOf = (s: State, dept: Dept) => s.targets.find((t) => t.dept === dept)
/**
 * Each line can have its own goal beside the room's (which is of all the lines together): it shows on the line's
 * card. It travels in act_targets like the room's, under the key "line:<id>".
 */
const LINE_KEY = 'line:'
const rowOfLineTarget = (t: LineTarget) => ({ dept: LINE_KEY + t.lineId, per_hour: t.perHour, per_shift: t.perDay, updated_at: iso(t.updatedAt), updated_by: user.get() })
export const lineTargetOf = (s: State, lineId: string) => s.lineTargets.find((t) => t.lineId === lineId)
// ---- the goals of each shift ----
/**
 * A goal belongs to a shift: its manager sets it for his people, and what counts against it is what that shift makes,
 * never what the other one made. It travels in act_targets under the room's (or the line's) key followed by "@1" or
 * "@2", with the shift's total in per_shift. A device with an older version of the app does not know these keys and
 * leaves them alone.
 */
// (a function, not a constant: load() uses it while this file is still being read, on every device that has something saved)
function isTurnKey(key: string) { return /@[12]$/.test(key) }
const rowOfTurnGoal = (g: TurnGoal) => ({ dept: g.key, per_hour: g.perHour, per_shift: g.total, updated_at: iso(g.updatedAt), updated_by: user.get() })
/** what a shift goes by: its goal per hour and for the whole shift; own = somebody set it for this very shift */
export type ShiftGoal = { perHour: number | null; total: number | null; own: boolean }
/**
 * While nobody has set a shift's own goal, the pace per hour that was set before (when a room had one goal for both
 * shifts) still stands: a pace is the same whoever is working. The total of before does not: it was the whole day's,
 * of both shifts together, and is no shift's goal.
 */
const turnGoal = (s: State, key: string, before: number | null | undefined): ShiftGoal => {
  const own = s.turnGoals.find((g) => g.key === key)
  return own ? { perHour: own.perHour, total: own.total, own: true } : { perHour: before ?? null, total: null, own: false }
}
/** the goal of a room in one shift */
export const shiftGoalOf = (s: State, dept: Dept, shift: 1 | 2) => turnGoal(s, dept + '@' + shift, targetOf(s, dept)?.perHour)
/** the goal of one line in one shift */
export const lineShiftGoalOf = (s: State, lineId: string, shift: 1 | 2) => turnGoal(s, LINE_KEY + lineId + '@' + shift, lineTargetOf(s, lineId)?.perHour)
function putTurnGoal(key: string, perHour: number | null, total: number | null) {
  const old = state.turnGoals.find((g) => g.key === key)
  const g: TurnGoal = { key, perHour, total, updatedAt: stamp(old) }
  set({ ...state, turnGoals: [...state.turnGoals.filter((x) => x.key !== key), g] })
  push('act_targets', key, rowOfTurnGoal(g))
}
/** a manager's goal for a room in one shift (blank = none); it reaches every tablet of the room and the history */
export function setShiftGoal(dept: Dept, shift: 1 | 2, perHour: number | null, total: number | null) {
  const old = shiftGoalOf(state, dept, shift), key = dept + '@' + shift
  putTurnGoal(key, perHour, total)
  logChange(dept, 'Meta ' + dept + ' · Turno ' + shift + ' · por hora', v(old.perHour), v(perHour), 'act_targets', key)
  logChange(dept, 'Meta ' + dept + ' · Turno ' + shift + ' · del turno', v(old.total), v(total), 'act_targets', key)
}
/** a manager's goal for one line in one shift (blank = none) */
export function setLineShiftGoal(line: Line, shift: 1 | 2, perHour: number | null, total: number | null) {
  const old = lineShiftGoalOf(state, line.id, shift), key = LINE_KEY + line.id + '@' + shift
  putTurnGoal(key, perHour, total)
  logChange(line.dept, 'Meta ' + line.name + ' (' + line.dept + ') · Turno ' + shift + ' · por hora', v(old.perHour), v(perHour), 'act_targets', key)
  logChange(line.dept, 'Meta ' + line.name + ' (' + line.dept + ') · Turno ' + shift + ' · del turno', v(old.total), v(total), 'act_targets', key)
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
/** what a room has made on a day, with all its lines together; or, given a line, what that line alone has made */
export function deptToday(s: State, dept: Dept, date: string, now: number, lineId?: string) {
  const cfg = CFG[dept]
  const runs = s.runs.filter((r) => r.dept === dept && r.date === date && (!lineId || r.lineId === lineId))
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
  // The shift in course has its own pace, so a good morning does not hide a slow afternoon. Its clock starts with its
  // first code; a line that came running from the other shift counts from the hour this one starts.
  const plan = shiftsOf(s, date), shift = shiftAt(plan, now), since = lastCut(plan, now), cuts = shiftCuts(plan)
  const opens = Math.min(now, since + ahead(shift === 1 ? cuts.toFirst : cuts.toSecond, mins(shift === 1 ? plan.first : plan.second)) * 60_000)
  const one = (r: Run, u: Unit) => (cfg.qty === 'none' ? 1 : unitQty(s, r, u))
  const made = (k: 1 | 2) => runs.reduce((t, r) => t + r.units.filter((u) => shiftAt(plan, u.at) === k).reduce((a, u) => a + one(r, u), 0), 0)
  const mine = runs.filter((r) => !r.endedAt || r.endedAt > since)
  const shiftFirst = mine.length ? Math.min(...mine.map((r) => (r.startedAt >= since ? r.startedAt : opens))) : 0
  const until = nextCut(plan, now)
  const inTurn = (u: Unit) => u.at >= since && u.at < until
  const shiftQty = runs.reduce((t, r) => t + r.units.filter(inTurn).reduce((a, u) => a + one(r, u), 0), 0)
  const shiftUnits = runs.reduce((t, r) => t + r.units.filter(inTurn).length, 0)
  // what the shift in course has made of each code: one it has running is there from zero, before its first unit
  const turn = new Map<string, { code: string; units: number; qty: number; lines: string[] }>()
  for (const r of runs) {
    const made = r.units.filter(inTurn)
    if (!made.length && !mine.includes(r)) continue
    const e = turn.get(normCode(r.code)) ?? { code: r.code, units: 0, qty: 0, lines: [] }
    e.units += made.length; e.qty += made.reduce((a, u) => a + one(r, u), 0)
    const ln = lineNameOf(s, r.lineId, r.line)
    if (!e.lines.includes(ln)) e.lines.push(ln)
    turn.set(normCode(r.code), e)
  }
  // The clock of the shift: it starts with the shift's first code (or, for a line that came running, at the hour the
  // shift starts), it runs while anything is running, it stops where the last code ended (the people said so: they
  // ended their codes or the shift), and the next shift starts again from zero when it starts working.
  const shiftUntil = mine.length > 0 && mine.every((r) => r.endedAt) ? Math.max(...mine.map((r) => r.endedAt ?? 0)) : 0
  const shiftMs = shiftFirst ? Math.max(0, (shiftUntil || now) - shiftFirst) : 0
  const shiftHrs = shiftMs / 3_600_000
  return { runs, units, qty, unitLabel: cfg.qty === 'none' ? cfg.plural.toLowerCase() : cfg.qtyUnit, byCode: [...codes.values()].sort((a, b) => b.qty - a.qty), hours, rate: hours >= 1 / 6 ? qty / hours : null, allEnded,
    shift, shiftQty, shiftUnits, shiftCodes: [...turn.values()].sort((a, b) => b.qty - a.qty), shiftRate: shiftHrs >= 1 / 6 ? shiftQty / shiftHrs : null, made: [made(1), made(2)] as [number, number], shiftSince: shiftFirst, shiftUntil, shiftMs }
}

// ---- what arrives from the server (another tablet, the office) ----
const lineOfRow = (row: Row): Line => ({ id: String(row.id), dept: row.dept as Dept, name: String(row.name ?? ''), updatedAt: fromIso(row.updated_at) ?? 0, deleted: !!row.deleted })
const runOfRow = (row: Row): Run => ({
  id: String(row.id), dept: row.dept as Dept, lineId: String(row.line_id ?? ''), line: String(row.line ?? ''), code: String(row.code ?? ''), lot: String(row.lot ?? ''), date: String(row.date ?? '').slice(0, 10),
  startedAt: fromIso(row.started_at) ?? 0, endedAt: fromIso(row.ended_at),
  units: (Array.isArray(row.units) ? (row.units as Partial<Unit>[]) : []).map(unitOf),
  perUnit: row.per_unit == null ? null : Number(row.per_unit), waste: Number(row.waste ?? 0), by: String(row.by_name ?? ''), updatedAt: fromIso(row.updated_at) ?? 0, deleted: !!row.deleted,
})
function changeOfRow(row: Row): Change { return { id: String(row.id), at: fromIso(row.at) ?? 0, by: String(row.by_name ?? ''), dept: (row.dept ?? null) as Dept | null, what: String(row.what ?? ''), before: String(row.before ?? ''), after: String(row.after ?? ''), refTable: String(row.ref_table ?? ''), refKey: String(row.ref_key ?? ''), updatedAt: fromIso(row.updated_at) ?? 0, deleted: !!row.deleted } }
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
  } else if (table === 'act_plan') {
    // a code of a room's program for a day
    const date = String(row.date ?? '').slice(0, 10), dept = row.dept as Dept, key = normCode(String(row.code ?? ''))
    if (!isDay(date) || !DEPTS.includes(dept) || !key || queued('act_plan', planKey(date, dept, key))) return // what was typed here is newer and on its way
    const cur = state.plans.find((p) => p.date === date && p.dept === dept && normCode(p.code) === key)
    if (!newer(cur)) return
    set({ ...state, plans: [...state.plans.filter((p) => p !== cur), { date, dept, code: cur?.code ?? key, qty: Number(row.qty) > 0 ? Number(row.qty) : 0, updatedAt: at }] })
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
  } else if (table === 'act_changes' && row.ref_table === ORDER_REF && String(row.id ?? '').startsWith(ORDER_ID)) {
    // an order (see "the orders Packing fills"): kept apart from the history
    const id = String(row.id).slice(ORDER_ID.length)
    if (!newer(state.orders.find((o) => o.id === id))) return
    let x: Partial<Order> | null = null
    try { x = JSON.parse(String(row.after ?? '')) as Partial<Order> } catch { /* not an order */ }
    const o = row.deleted ? null : orderOf(id, x, String(row.by_name ?? ''), at)
    set({ ...state, orders: [...state.orders.filter((y) => y.id !== id), ...(o ? [o] : [])] })
  } else if (table === 'act_changes') {
    const cur = state.changes.find((c) => c.id === row.id)
    if (!newer(cur)) return
    const c = changeOfRow(row)
    set({ ...state, changes: upsertIn(state.changes, c) })
  } else if (table === 'act_targets' && String(row.dept ?? '').startsWith(SHIFTS_KEY)) {
    // the hours of the shifts from a date on (a version without its hours was taken back)
    const from = String(row.dept).slice(SHIFTS_KEY.length), a = unpackShift(row.per_hour), b = unpackShift(row.per_shift)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !newer(state.shifts.find((x) => x.from === from))) return
    const x: ShiftPlan | null = a && b ? { from, first: a[0], firstEnd: a[1], second: b[0], secondEnd: b[1], updatedAt: at } : null
    set({ ...state, shifts: [...state.shifts.filter((y) => y.from !== from), ...(x && !shiftsProblem(x) ? [x] : [])] })
  } else if (table === 'act_targets' && isTurnKey(String(row.dept ?? ''))) {
    // the goal of one shift, of a room or of a line
    const key = String(row.dept)
    if (!newer(state.turnGoals.find((g) => g.key === key))) return
    const num = (x: unknown) => (x == null || !(Number(x) > 0) ? null : Number(x))
    set({ ...state, turnGoals: [...state.turnGoals.filter((g) => g.key !== key), { key, perHour: num(row.per_hour), total: num(row.per_shift), updatedAt: at }] })
  } else if (table === 'act_targets' && String(row.dept ?? '').startsWith(LINE_KEY)) {
    // the goal of one line
    const lineId = String(row.dept).slice(LINE_KEY.length)
    if (!lineId || !newer(state.lineTargets.find((t) => t.lineId === lineId))) return
    const num = (x: unknown) => (x == null || !(Number(x) > 0) ? null : Number(x))
    set({ ...state, lineTargets: [...state.lineTargets.filter((t) => t.lineId !== lineId), { lineId, perHour: num(row.per_hour), perDay: num(row.per_shift), updatedAt: at }] })
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
  for (const x of state.shifts) { push('act_targets', SHIFTS_KEY + x.from, rowOfShifts(x)); n++ }
  for (const t of state.lineTargets) { push('act_targets', LINE_KEY + t.lineId, rowOfLineTarget(t)); n++ }
  for (const g of state.turnGoals) { push('act_targets', g.key, rowOfTurnGoal(g)); n++ }
  for (const p of state.plans) { push('act_plan', planKey(p.date, p.dept, p.code), rowOfPlan(p)); n++ }
  for (const o of state.orders) { push('act_changes', ORDER_ID + o.id, rowOfOrder(o)); n++ }
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

/** a run's numbers. A stretch between two shifts that the line went through without a single record does not count (see awayOn) */
export function runStats(s: State, r: Run, now: number) {
  const stops = stopsOf(s, r.dept, r.lineId), end = r.endedAt ?? now
  const away = awayOn(s, r.lineId, r.date, r.startedAt, end, now)
  const there = (a: number, b: number) => (away.length ? without(a, b, away) : b > a ? [{ from: a, to: b }] : [])
  const worked = (a: number, b: number) => there(a, b).reduce((t, x) => t + activeBetween(x.from, x.to, stops, now), 0)
  const working = worked(r.startedAt, end)
  const pieces = there(r.startedAt, end).flatMap((x) => stoppedPieces(x.from, x.to, stops, now))
  const down = pieces.reduce((t, p) => t + (p.to - p.from), 0)
  const unitTimes = r.units.map((u, i) => worked(i ? r.units[i - 1].at : r.startedAt, u.at))
  const avg = unitTimes.length ? unitTimes.reduce((a, b) => a + b, 0) / unitTimes.length : 0
  const qty = runQty(s, r)
  const reasons: Record<string, number> = {}
  for (const p of pieces) reasons[p.reason] = (reasons[p.reason] ?? 0) + (p.to - p.from)
  return { working, down, unitTimes, avg, qty, reasons, total: end - r.startedAt }
}
/**
 * A run as the shift in course sees it. A code that came running from the shift before (`carried`) is not this
 * shift's from its start: what this shift has made of it, and the time it has worked and been stopped on it, count
 * from the hand-over (`since`), from zero; what it brought is in `before`. A code this shift started is all its own.
 * Nothing is cut in what is kept: the run is one, and the report still tells what each shift did of it.
 */
export function runSince(s: State, r: Run, since: number, now: number) {
  const whole = runStats(s, r, now)
  if (r.startedAt >= since) return { carried: false, units: r.units.length, qty: whole.qty, working: whole.working, down: whole.down, avg: whole.avg, before: { units: 0, qty: 0 } }
  const stops = stopsOf(s, r.dept, r.lineId), end = r.endedAt ?? now, from = Math.min(since, end)
  const away = awayOn(s, r.lineId, r.date, from, end, now)
  const worked = (a: number, b: number) => without(a, b, away).reduce((t, x) => t + activeBetween(x.from, x.to, stops, now), 0)
  const down = without(from, end, away).flatMap((x) => stoppedPieces(x.from, x.to, stops, now)).reduce((t, p) => t + (p.to - p.from), 0)
  const mine = r.units.map((u, i) => ({ u, i })).filter((x) => x.u.at >= since)
  const qty = mine.reduce((t, x) => t + unitQty(s, r, x.u), 0)
  // its first unit of this shift is timed from the hand-over, not from the last unit of the shift before
  const times = mine.map((x) => worked(Math.max(x.i ? r.units[x.i - 1].at : r.startedAt, since), x.u.at))
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0
  return { carried: true, units: mine.length, qty, working: worked(from, end), down, avg, before: { units: r.units.length - mine.length, qty: whole.qty - qty } }
}
/** "2 carros · 240 pouches": so many units and what they carry, in the department's own words */
export function unitsText(dept: Dept, units: number, qty: number) {
  const c = CFG[dept]
  return units + ' ' + (units === 1 ? c.unit : c.plural).toLowerCase() + (c.qty !== 'none' ? ' · ' + qty.toLocaleString('en-US') + ' ' + c.qtyUnit : '')
}
/** what a run produced, said the same way (with the tag / bin numbers if asked) */
export function madeText(r: Run, qty: number, withRefs = false) {
  const refs = withRefs ? r.units.map((u) => u.ref).filter(Boolean) : []
  return unitsText(r.dept, r.units.length, qty) + (refs.length ? ' (' + (CFG[r.dept].refWord ?? '') + ' ' + refs.join(', ') + ')' : '')
}

export function fmtDur(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  return (h ? h + ':' : '') + pad(m) + ':' + pad(x)
}
export const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
