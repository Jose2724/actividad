// Demo: everything is kept on this device (localStorage). The real version syncs to a server so the manager sees it live.
export type Dept = 'Kitchen' | 'RTE' | 'Spiral' | 'MFO' | 'Packing'
export const DEPTS: Dept[] = ['Kitchen', 'RTE', 'Spiral', 'MFO', 'Packing']
export const REASONS = ['Falta de material', 'Cambio de producto', 'Máquina / mantenimiento', 'Limpieza', 'Falta de personal', 'Break / lunch', 'Calidad', 'Esperando freezer / espacio']

export type Line = { id: string; dept: Dept; name: string }
/** one product code run on one line: the clock starts at startedAt, each finished cart is a timestamp */
export type Run = { id: string; dept: Dept; lineId: string; line: string; code: string; lot: string; date: string; startedAt: number; endedAt: number | null; carts: number[]; by: string }
/** a stop with its reason; lineId null = the whole department */
export type Stop = { id: string; dept: Dept; lineId: string | null; reason: string; note: string; startedAt: number; endedAt: number | null; by: string }
export type State = { lines: Line[]; runs: Run[]; stops: Stop[] }

const KEY = 'act_v1'
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))
const pad = (n: number) => String(n).padStart(2, '0')
export const dayOf = (ms: number) => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) }
export const today = () => dayOf(Date.now())

function fresh(): State { return { lines: DEPTS.map((d) => ({ id: uid(), dept: d, name: 'Línea 1' })), runs: [], stops: [] } }
function load(): State {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null') as State | null; if (s && s.lines && s.runs && s.stops) return s } catch { /* empty */ }
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

export function addLine(dept: Dept) { const n = state.lines.filter((l) => l.dept === dept).length + 1; set({ ...state, lines: [...state.lines, { id: uid(), dept, name: 'Línea ' + n }] }) }
export function removeLine(id: string) { set({ ...state, lines: state.lines.filter((l) => l.id !== id) }) }
export function startRun(line: Line, code: string, lot: string, date: string) {
  set({ ...state, runs: [...state.runs, { id: uid(), dept: line.dept, lineId: line.id, line: line.name, code, lot, date, startedAt: Date.now(), endedAt: null, carts: [], by: user.get() }] })
}
export function cartDone(runId: string) { set({ ...state, runs: state.runs.map((r) => (r.id === runId ? { ...r, carts: [...r.carts, Date.now()] } : r)) }) }
export function endRun(runId: string) { set({ ...state, runs: state.runs.map((r) => (r.id === runId ? { ...r, endedAt: Date.now() } : r)) }) }
export function startStop(dept: Dept, lineId: string | null, reason: string, note: string) {
  set({ ...state, stops: [...state.stops, { id: uid(), dept, lineId, reason, note, startedAt: Date.now(), endedAt: null, by: user.get() }] })
}
export function endStop(id: string) { set({ ...state, stops: state.stops.map((x) => (x.id === id ? { ...x, endedAt: Date.now() } : x)) }) }
export function reset() { set(fresh()) }

export const openRun = (s: State, lineId: string) => s.runs.find((r) => r.lineId === lineId && !r.endedAt)
/** the stop holding this line right now: its own, or one of the whole department */
export const openStop = (s: State, dept: Dept, lineId: string) => s.stops.find((x) => !x.endedAt && x.dept === dept && (x.lineId === lineId || x.lineId === null))
export const deptStop = (s: State, dept: Dept) => s.stops.find((x) => !x.endedAt && x.dept === dept && x.lineId === null)
export const stopsOf = (s: State, dept: Dept, lineId: string) => s.stops.filter((x) => x.dept === dept && (x.lineId === lineId || x.lineId === null))

const overlap = (a: number, b: number, x: Stop, now: number) => Math.max(0, Math.min(b, x.endedAt ?? now) - Math.max(a, x.startedAt))
/** time between two moments without what was spent stopped */
export const activeBetween = (a: number, b: number, stops: Stop[], now: number) => Math.max(0, b - a - stops.reduce((t, x) => t + overlap(a, b, x, now), 0))

export function runStats(s: State, r: Run, now: number) {
  const stops = stopsOf(s, r.dept, r.lineId), end = r.endedAt ?? now
  const working = activeBetween(r.startedAt, end, stops, now)
  const down = stops.reduce((t, x) => t + overlap(r.startedAt, end, x, now), 0)
  const cartTimes = r.carts.map((c, i) => activeBetween(i ? r.carts[i - 1] : r.startedAt, c, stops, now))
  const avg = cartTimes.length ? cartTimes.reduce((a, b) => a + b, 0) / cartTimes.length : 0
  const reasons: Record<string, number> = {}
  for (const x of stops) { const o = overlap(r.startedAt, end, x, now); if (o > 0) reasons[x.reason] = (reasons[x.reason] ?? 0) + o }
  return { working, down, cartTimes, avg, reasons, total: end - r.startedAt }
}

export function fmtDur(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  return (h ? h + ':' : '') + pad(m) + ':' + pad(x)
}
export const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
