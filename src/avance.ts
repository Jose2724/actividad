import { normCode, productOf, unitQty, type Product, type State } from './store'

/**
 * The day's progress per product, with the same arithmetic as the office's AVANCE sheet and its daily summary:
 *   cases expected   = mezclas × YIELD (cases per mezcla)
 *   pouches expected = cases expected × pouches per case        (no rounding, as in their formula)
 *   pallets expected = cases expected ÷ cases per pallet
 *   pending          = expected − what the room reported        (negative = more than expected, their red cells)
 * "plan" takes the mezclas scheduled for the day; "exp" the mezclas Kitchen has made so far.
 */
export type AvanceRow = {
  code: string; product: Product | undefined; scheduled: number
  /** mixesPending = scheduled − made (negative = more mezclas than the program, as in the office's sheet); 0 for a code that was not programmed */
  mixesDone: number; mixesPending: number; spiralDone: number
  /** null = it cannot be worked out: the code is not in the products table, or its yield / pouches per case / cases per pallet is blank there */
  pouchesPlan: number | null; pouchesExp: number | null; pouchesDone: number
  casesPlan: number | null; casesExp: number | null; casesDone: number; mfoCases: number
  palletsPlan: number | null; palletsExp: number | null; palletsDone: number
  wasteLb: number
}

/** two decimals: enough for a yield like 18.33 and free of the stray 0.0000001 that multiplying decimals leaves */
const r2 = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100)

/** `keep`: codes (in their plain spelling) that stay on the list even with nothing programmed or made: the ones being typed on the screen */
export function avanceRows(s: State, date: string, keep?: Set<string>): AvanceRow[] {
  const runs = s.runs.filter((r) => r.date === date)
  // 100 and 0100 are one line; the program holds one entry per code (see setSchedule), the spellings are folded here for old data
  const sched: Record<string, number> = {}
  for (const [c, n] of Object.entries(s.schedule[date] ?? {})) sched[normCode(c)] = normCode(c) === c ? n : sched[normCode(c)] ?? n
  const keys = [...new Set([...Object.keys(sched), ...runs.map((r) => normCode(r.code))])].sort()
  // a code with nothing programmed and nothing made is not a row (setting a program to 0 takes it off the list)
  const idle = (r: AvanceRow) => !r.scheduled && !r.mixesDone && !r.spiralDone && !r.pouchesDone && !r.casesDone && !r.mfoCases && !r.palletsDone && !r.wasteLb
  return keys.map((key): AvanceRow & { key: string } => {
    const product = productOf(s, key)
    const code = product?.code ?? runs.find((r) => normCode(r.code) === key)?.code ?? key
    const of = (dept: string) => runs.filter((r) => r.dept === dept && normCode(r.code) === key)
    const units = (dept: string) => of(dept).reduce((t, r) => t + r.units.length, 0)
    const qty = (dept: string) => of(dept).reduce((t, r) => t + r.units.reduce((u, x) => u + unitQty(s, r, x), 0), 0)
    const scheduled = sched[key] ?? 0
    const mixesDone = units('Kitchen')
    // a blank in the master table means "not known", never "zero expected"
    const cases = (mixes: number) => (product && product.casesPerMix ? mixes * product.casesPerMix : null)
    const pouches = (c: number | null) => (product && product.pouchesPerCase && c != null ? c * product.pouchesPerCase : null)
    const pallets = (c: number | null) => (product && product.casesPerPallet && c != null ? c / product.casesPerPallet : null)
    const casesExp = cases(mixesDone), casesPlan = scheduled ? cases(scheduled) : null
    return {
      key, code, product, scheduled, mixesDone, mixesPending: scheduled ? scheduled - mixesDone : 0, spiralDone: units('Spiral'),
      pouchesPlan: r2(pouches(casesPlan)), pouchesExp: r2(pouches(casesExp)), pouchesDone: qty('RTE'),
      casesPlan: r2(casesPlan), casesExp: r2(casesExp), casesDone: qty('Packing'), mfoCases: qty('MFO'),
      palletsPlan: r2(pallets(casesPlan)), palletsExp: r2(pallets(casesExp)), palletsDone: units('Packing'),
      wasteLb: Math.round(runs.filter((r) => normCode(r.code) === key).reduce((t, r) => t + (r.waste || 0), 0) * 100) / 100,
    }
  }).filter((r) => !idle(r) || !!keep?.has(r.key)).map(({ key: _key, ...r }) => r)
}

/** "982" or "-10": what is still missing (negative = more than expected, like the red cells in the office's sheet) */
export const pending = (exp: number | null, done: number) => (exp == null ? null : Math.round((exp - done) * 10) / 10)
/** a number for the table: whole when it is whole, else one decimal ("714", "142.8"), "—" when it is not known */
export const n1 = (v: number | null) => { if (v == null) return '—'; const r = Math.round(v * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1) }
