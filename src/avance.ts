import { productOf, type Product, type State } from './store'

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
  const sched = s.schedule[date] ?? {}
  const codes = [...new Set([...Object.keys(sched).filter((c) => sched[c] > 0), ...runs.map((r) => r.code)])].sort()
  return codes.map((code) => {
    const product = productOf(s, code)
    const of = (dept: string) => runs.filter((r) => r.dept === dept && r.code === code)
    const units = (dept: string) => of(dept).reduce((t, r) => t + r.units.length, 0)
    const qty = (dept: string, fallback: number) => of(dept).reduce((t, r) => t + r.units.reduce((u, x) => u + (x.qty ?? r.perUnit ?? fallback), 0), 0)
    const scheduled = sched[code] ?? 0
    const mixesDone = units('Kitchen')
    const casesExp = product ? mixesDone * product.casesPerMix : null
    const pouchesExp = product && casesExp != null ? casesExp * product.pouchesPerCase : null
    const palletsExp = product && casesExp != null && product.casesPerPallet ? casesExp / product.casesPerPallet : null
    return {
      code, product, scheduled, mixesDone, mixesPending: Math.max(0, scheduled - mixesDone), spiralDone: units('Spiral'),
      pouchesExp, pouchesDone: qty('RTE', product?.pouchesPerCart ?? 0), casesExp, casesDone: qty('Packing', product?.casesPerPallet ?? 0), mfoCases: qty('MFO', 0), palletsExp, palletsDone: units('Packing'),
    }
  })
}

/** "982" or "-10": what is still missing (negative = more than expected, like the red cells in the office's sheet) */
export const pending = (exp: number | null, done: number) => (exp == null ? null : Math.round((exp - done) * 10) / 10)
export const n1 = (v: number | null) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1))
