import { cartPouches, normCode, productOf, type Product, type State } from './store'

/**
 * The day's progress per product, the way the office's AVANCE sheet computes it by hand: the mezclas Kitchen made,
 * times the yield (cases per mezcla), give the cases expected; times the pouches per case, the pouches RTE must fill;
 * divided by the cases per pallet, the pallets Packing must build. What each room reported counts against that.
 */
export type AvanceRow = {
  code: string; product: Product | undefined; scheduled: number
  mixesDone: number; mixesPending: number; spiralDone: number
  pouchesExp: number | null; pouchesDone: number; casesExp: number | null; casesDone: number; mfoCases: number; palletsExp: number | null; palletsDone: number
}

export function avanceRows(s: State, date: string): AvanceRow[] {
  const runs = s.runs.filter((r) => r.date === date)
  // 889 and 0889 are one line: scheduled under either spelling, run under either spelling
  const sched: Record<string, number> = {}
  for (const [c, n] of Object.entries(s.schedule[date] ?? {})) sched[normCode(c)] = (sched[normCode(c)] ?? 0) + n
  // a code just programmed (still 0) stays on the list so its number can be typed
  const keys = [...new Set([...Object.keys(sched), ...runs.map((r) => normCode(r.code))])].sort()
  return keys.map((key) => {
    const product = productOf(s, key)
    const code = product?.code ?? runs.find((r) => normCode(r.code) === key)?.code ?? key
    const of = (dept: string) => runs.filter((r) => r.dept === dept && normCode(r.code) === key)
    const units = (dept: string) => of(dept).reduce((t, r) => t + r.units.length, 0)
    const qty = (dept: string, fallback: number) => of(dept).reduce((t, r) => t + r.units.reduce((u, x) => u + (x.qty ?? r.perUnit ?? fallback), 0), 0)
    const scheduled = sched[key] ?? 0
    const mixesDone = units('Kitchen')
    const casesExp = product ? mixesDone * product.casesPerMix : null
    const pouchesExp = product && casesExp != null ? casesExp * product.pouchesPerCase : null
    const palletsExp = product && casesExp != null && product.casesPerPallet ? casesExp / product.casesPerPallet : null
    return {
      code, product, scheduled, mixesDone, mixesPending: Math.max(0, scheduled - mixesDone), spiralDone: units('Spiral'),
      pouchesExp, pouchesDone: qty('RTE', product ? cartPouches(product) : 0), casesExp, casesDone: qty('Packing', product?.casesPerPallet ?? 0), mfoCases: qty('MFO', 0), palletsExp, palletsDone: units('Packing'),
    }
  })
}

/** "982" or "-10": what is still missing (negative = more than expected, like the red cells in the office's sheet) */
export const pending = (exp: number | null, done: number) => (exp == null ? null : Math.round((exp - done) * 10) / 10)
export const n1 = (v: number | null) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1))
