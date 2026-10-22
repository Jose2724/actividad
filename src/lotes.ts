import { normCode, type Dept, type State } from './store'
import { flujoLots, type FlujoRow } from './flujo'

/**
 * "Lotes" (Jose and the office, 2026-10-21/22: "según lo que hace Kitchen o Spiral, se calcule lo de cada cuarto
 * automáticamente ... y muestre cuánto le falta ... y la cantidad perdida, así los jefes saben si se está perdiendo
 * mucho o no en el transcurso de que ese producto va pasando por los cuartos"). One lot of one code followed down its
 * rooms: Kitchen or Spiral makes the mezclas; RTE (pouches) or MFO (platos, copas) is expected what those mezclas give;
 * Packing is expected what the room before it handed over (so each room answers for what it received: Jose, 2026-10-22,
 * the 4928 of 480 → 440 → 434), in cases and pallets. While a room still works the lot (a run of it open), what is
 * missing is "falta"; once it finished, it is "pérdida", in units and %. The lot's total loss is against what the
 * mezclas give. The arithmetic is Flujo's (flujo.ts, checked against the office's sheet); this file only says it as a
 * chain. Nothing is typed here.
 */
export type StepState = 'wait' | 'run' | 'ok' | 'loss' | 'over' | 'nocalc'
export type Step = {
  dept: Dept
  /** the unit it counts in: mezclas, pouches, platos / copas, cajas */
  unit: string
  /** what it should make (null = Productos lacks a number to work it out) */
  expected: number | null
  done: number
  /** expected − done (negative = more than expected); null when expected is */
  gap: number | null
  /** gap ÷ expected, as a share (0.033 = 3.3%) */
  pct: number | null
  state: StepState
  running: boolean
  /** Packing: its pallets, expected and made */
  pallets?: { expected: number | null; done: number }
}
export type LotStatus = 'run' | 'late' | 'done' | 'wait'
export type LotChain = {
  lot: string; code: string; name: string; route: 'RTE' | 'MFO'; mixRoom: 'Kitchen' | 'Spiral'
  /** the mezclas made, and the cases they give (null when Productos lacks the yield) */
  mixes: number; originCases: number | null
  steps: Step[]
  /** the cases lost from the mezclas to Packing, once every room finished the lot (null while it is on its way) */
  totalLoss: number | null; totalPct: number | null
  status: LotStatus
  /** what is missing in Productos to work the chain out */
  missing: string[]
  days: string[]
  row: FlujoRow
}

/** the share a loss is green, amber or red at (the limits can change: one place) */
export const LOSS_OK = 0.02, LOSS_BAD = 0.05
export const lossClass = (pct: number | null) => (pct == null ? '' : pct <= LOSS_OK ? 'ok' : pct <= LOSS_BAD ? 'warn' : 'bad')
const round = (x: number) => Math.round(x * 100) / 100

/** one room's step: what it should make, what it made, and whether what is missing is still to come or lost */
function stepOf(dept: Dept, unit: string, expected: number | null, done: number, running: boolean, before: StepState | null): Step {
  const gap = expected == null ? null : round(expected - done)
  const pct = expected == null || expected <= 0 || gap == null ? null : gap / expected
  // not started: nothing made and nobody on it (and the room before it is not still making it). Still on it, or the
  // room before still sends: what is missing is still to come. Finished: lost (or "de más")
  const upstreamRuns = before === 'run'
  const state: StepState = expected == null ? 'nocalc' : done <= 0 && !running ? 'wait' : running || upstreamRuns ? 'run' : gap != null && gap < 0 ? 'over' : pct != null && pct > 0.0005 ? 'loss' : 'ok'
  return { dept, unit, expected: expected == null ? null : round(expected), done: round(done), gap, pct, state, running }
}

export function chainOf(r: FlujoRow): LotChain {
  const missing: string[] = []
  if (!r.product) missing.push('el código en Productos')
  else {
    if (r.yieldCs == null) missing.push('cajas por mezcla (yield)')
    if (r.perCase == null) missing.push(r.route === 'RTE' ? 'pouches por caja' : 'platos por caja')
    if (r.perPallet == null) missing.push('cajas por pallet')
  }
  const originCases = r.yieldCs != null ? r.mixes * r.yieldCs : null
  const steps: Step[] = []
  const origin: Step = { dept: r.mixRoom, unit: 'mezclas', expected: null, done: r.mixes, gap: null, pct: null, state: r.openIn.includes(r.mixRoom) ? 'run' : r.mixes > 0 ? 'ok' : 'wait', running: r.openIn.includes(r.mixRoom) }
  steps.push(origin)
  // the pack room: RTE in pouches, or MFO in what its bins hold, expected from the mezclas
  const fromMixes = originCases != null && r.perCase != null ? originCases * r.perCase : null
  const packDone = r.route === 'RTE' ? r.pouches : r.mfoUnits + r.mfoCases * (r.perCase ?? 0)
  const pack = stepOf(r.route, r.route === 'RTE' ? 'pouches' : r.mfoWordUsed && r.mfoWordUsed !== 'cajas' ? r.mfoWordUsed : 'platos', r.route === 'MFO' && r.mfoOnlyLb ? null : fromMixes, packDone, r.openIn.includes(r.route), origin.state)
  steps.push(pack)
  // Packing: what the room before it handed over (segun, in cases), and its pallets
  const packing = stepOf('Packing', 'cajas', r.segun, r.cases, r.openIn.includes('Packing'), pack.state)
  packing.pallets = { expected: r.segun != null && r.perPallet ? Math.ceil(r.segun / r.perPallet - 1e-9) : null, done: r.pallets }
  steps.push(packing)
  const anyRunning = steps.some((x) => x.running)
  const finished = !anyRunning && r.cases > 0
  const totalLoss = finished && originCases != null ? round(originCases - r.cases) : null
  const totalPct = totalLoss != null && originCases ? totalLoss / originCases : null
  // done: Packing packed it and nobody is on it any more; on its way: some room is on it; waiting: nobody is on it now
  // and it has not reached Packing (a room finished and the next has not started: it "goes behind")
  const status: LotStatus = finished ? 'done' : anyRunning ? 'run' : r.mixes > 0 || packDone > 0 ? 'late' : 'wait'
  return { lot: r.lot, code: r.code, name: r.name, route: r.route, mixRoom: r.mixRoom, mixes: r.mixes, originCases, steps, totalLoss, totalPct, status, missing, days: r.days.map((d) => d.date), row: r }
}

/** every lot of every code touched between two days, as chains: the most lost first, then those on their way */
export function lotChains(s: State, from: string, to: string): LotChain[] {
  const out = flujoLots(s, from, to).flatMap((l) => l.rows.filter((r) => r.mixes > 0 || r.pouches > 0 || r.mfoUnits > 0 || r.cases > 0).map(chainOf))
  const rank = (c: LotChain) => (c.status === 'done' ? 0 : c.status === 'late' ? 1 : c.status === 'run' ? 2 : 3)
  return out.sort((a, b) => rank(a) - rank(b) || (b.totalPct ?? -1) - (a.totalPct ?? -1) || a.code.localeCompare(b.code, undefined, { numeric: true }))
}

/** the summary for the bosses: lots on their way and finished, the loss of the finished ones, the worst, room by room */
export function lotsSummary(list: LotChain[]) {
  const done = list.filter((c) => c.status === 'done' && c.originCases != null && c.totalLoss != null)
  const expected = done.reduce((t, c) => t + (c.originCases ?? 0), 0), lost = done.reduce((t, c) => t + Math.max(0, c.totalLoss ?? 0), 0)
  const worst = done.reduce<LotChain | null>((w, c) => (w == null || (c.totalPct ?? 0) > (w.totalPct ?? 0) ? c : w), null)
  // each room's loss: what it lost of what it was expected, over the lots it finished (each room in its own unit)
  const rooms = new Map<Dept, { expected: number; lost: number }>()
  for (const c of list) for (const st of c.steps) {
    if ((st.state !== 'loss' && st.state !== 'ok' && st.state !== 'over') || st.expected == null) continue
    const e = rooms.get(st.dept) ?? { expected: 0, lost: 0 }
    e.expected += st.expected; e.lost += Math.max(0, st.gap ?? 0); rooms.set(st.dept, e)
  }
  const byRoom = [...rooms].map(([dept, x]) => ({ dept, pct: x.expected ? x.lost / x.expected : 0 })).sort((a, b) => b.pct - a.pct)
  return { running: list.filter((c) => c.status === 'run' || c.status === 'late').length, done: list.filter((c) => c.status === 'done').length, lost: round(lost), expected: round(expected), pct: expected ? lost / expected : null, worst, byRoom }
}

/** a chain matches a search: its code, its lot or its product's name */
export const chainMatch = (c: LotChain, q: string) => { const t = q.trim().toLowerCase(); return !t || normCode(c.code).toLowerCase().includes(normCode(t).toLowerCase()) || c.lot.toLowerCase().includes(t) || c.name.toLowerCase().includes(t) }
