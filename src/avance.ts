import { apartOf, normCode, productOf, shiftAt, shiftsOf, unitQty, type PackRoom, type Product, type Run, type State, type Unit } from './store'
import { unitParts } from './report'

/**
 * The day's progress per product, with the same arithmetic as the office's AVANCE sheet and its daily summary:
 *   cases expected   = mezclas × YIELD (cases per mezcla)
 *   pouches expected = cases expected × pouches per case        (no rounding, as in their formula)
 *   pallets expected = cases expected ÷ cases per pallet
 *   pending          = expected − what the room reported        (negative = more than expected, their red cells)
 * "plan" takes the mezclas scheduled for the day; "exp" the mezclas made so far, in the room that makes that code.
 */
export type AvanceRow = {
  code: string; product: Product | undefined; scheduled: number
  /**
   * mixesDone = the mezclas (batches) made of the code, in the room that makes it: Kitchen, on its braisers, or Spiral.
   * The office's AVANCE sheet reads each product's batches from one room's sheet or the other. Here it is the room
   * that has registered the code; if both have, the one with more (the same batches are never counted twice).
   * mixRoom says which room that is; spiralDone is what Spiral registered, whoever makes the code.
   * mixesPending = scheduled − made (negative = more mezclas than the program, as in the office's sheet); 0 for a code that was not programmed
   */
  mixesDone: number; mixesPending: number; mixRoom: 'Kitchen' | 'Spiral'; spiralDone: number
  /** null = it cannot be worked out: the code is not in the products table, or its yield / pouches per case / cases per pallet is blank there */
  pouchesPlan: number | null; pouchesExp: number | null; pouchesDone: number
  casesPlan: number | null; casesExp: number | null; casesDone: number; mfoCases: number
  palletsPlan: number | null; palletsExp: number | null; palletsDone: number
  wasteLb: number
  /**
   * packRoom = the room that packs the code after its mezclas: RTE (pouches) or MFO (bins of cases), never both. The
   * other one has nothing to do with it: its expected and pending are null. packSaid = the products table says so;
   * otherwise it is the room that has registered the code (see packRoomOf).
   */
  packRoom: PackRoom; packSaid: boolean
  /** what MFO has to pack of a code it packs: the same cases (mezclas × yield). null for a code that RTE packs */
  mfoPlan: number | null; mfoExp: number | null
  /** the same made numbers, shift by shift (a unit counts on the shift of its hour) and lot by lot (a pallet with two lots gives each its cases and is a pallet of both) */
  byShift: [AvancePart, AvancePart]; lots: ({ lot: string } & AvancePart)[]
}
/** what a shift, a lot or a whole lot made of a code, in each room's unit */
export type AvancePart = { mixes: number; spiral: number; pouches: number; cases: number; mfo: number; pallets: number }
const part = (): AvancePart => ({ mixes: 0, spiral: 0, pouches: 0, cases: 0, mfo: 0, pallets: 0 })

/**
 * Which room packs a code: the products table's "Lo empaca"; when it is blank, the room that has registered the code
 * (the one with more of it, over the days this device holds); RTE when neither has.
 */
export function packRoomOf(s: State, code: string): { room: PackRoom; said: boolean } {
  const p = productOf(s, code)
  if (p?.room) return { room: p.room, said: true }
  const key = normCode(code)
  let rte = 0, mfo = 0
  for (const r of s.runs) if (normCode(r.code) === key) { if (r.dept === 'RTE') rte += Math.max(1, r.units.length); else if (r.dept === 'MFO') mfo += Math.max(1, r.units.length) }
  return { room: mfo > rte ? 'MFO' : 'RTE', said: false }
}

/** the lots a day's runs touched, to filter Avance by one (a pallet with two lots gives both) */
export function avanceLots(s: State, date: string): string[] {
  const out = new Set<string>()
  for (const r of s.runs) if (r.date === date) for (const l of r.units.length ? r.units.flatMap((u) => unitParts(s, r, u).map((p) => p.lot)) : [r.lot]) if (l) out.add(l)
  return [...out].sort()
}

/** two decimals: enough for a yield like 18.33 and free of the stray 0.0000001 that multiplying decimals leaves */
const r2 = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100)

/**
 * `keep`: codes (in their plain spelling) that stay on the list even with nothing programmed or made: the ones being
 * typed on the screen. `lot`: only what was made of that lot (a pallet with two lots counts the cases of that one); the
 * program is the whole day's, not a lot's, so with a lot there is no program and nothing is measured against it.
 */
export function avanceRows(s: State, date: string, keep?: Set<string>, lot = ''): AvanceRow[] {
  const has = (r: Run, u: Unit) => !lot || unitParts(s, r, u).some((p) => p.lot === lot)
  const ofLot = (r: Run, u: Unit) => (!lot ? unitQty(s, r, u) : unitParts(s, r, u).filter((p) => p.lot === lot).reduce((t, p) => t + (p.qty ?? 0), 0))
  const runs = s.runs.filter((r) => r.date === date && (!lot || r.lot === lot || r.units.some((u) => has(r, u))))
  // 100 and 0100 are one line; the program holds one entry per code (see setSchedule), the spellings are folded here for old data
  const sched: Record<string, number> = {}
  if (!lot) for (const [c, n] of Object.entries(s.schedule[date] ?? {})) sched[normCode(c)] = normCode(c) === c ? n : sched[normCode(c)] ?? n
  const keys = [...new Set([...Object.keys(sched), ...runs.map((r) => normCode(r.code))])].sort()
  // a code with nothing programmed and nothing made is not a row (setting a program to 0 takes it off the list)
  const idle = (r: AvanceRow) => !r.scheduled && !r.mixesDone && !r.spiralDone && !r.pouchesDone && !r.casesDone && !r.mfoCases && !r.palletsDone && !r.wasteLb
  return keys.map((key): AvanceRow & { key: string } => {
    const product = productOf(s, key)
    const code = product?.code ?? runs.find((r) => normCode(r.code) === key)?.code ?? key
    // a Packing line that fills bins makes no cases and no pallets; a Spiral line weighing its mezclas in pounds (or
    // counting cases) makes no mezclas of a product: what is counted apart stays apart
    const of = (dept: string) => runs.filter((r) => r.dept === dept && normCode(r.code) === key && !apartOf(r))
    const units = (dept: string) => of(dept).reduce((t, r) => t + r.units.filter((u) => has(r, u)).length, 0)
    const qty = (dept: string) => of(dept).reduce((t, r) => t + r.units.reduce((a, u) => a + (has(r, u) ? ofLot(r, u) : 0), 0), 0)
    const pack = packRoomOf(s, code), mfoRoute = pack.room === 'MFO'
    const scheduled = sched[key] ?? 0
    const kitchenDone = units('Kitchen'), spiralDone = units('Spiral')
    const mixRoom = spiralDone > kitchenDone ? 'Spiral' as const : 'Kitchen' as const, mixesDone = Math.max(kitchenDone, spiralDone)
    // a blank in the master table means "not known", never "zero expected"
    const cases = (mixes: number) => (product && product.casesPerMix ? mixes * product.casesPerMix : null)
    const pouches = (c: number | null) => (product && product.pouchesPerCase && c != null ? c * product.pouchesPerCase : null)
    const pallets = (c: number | null) => (product && product.casesPerPallet && c != null ? c / product.casesPerPallet : null)
    const casesExp = cases(mixesDone), casesPlan = scheduled ? cases(scheduled) : null
    // the same, shift by shift and lot by lot; the mezclas are the ones of the room that makes the code (mixRoom)
    const hours = shiftsOf(s, date)
    const byShift: [AvancePart, AvancePart] = [part(), part()], lotMap = new Map<string, AvancePart>()
    const lotPart = (l: string) => { let x = lotMap.get(l); if (!x) { x = part(); lotMap.set(l, x) } return x }
    const kitchenBy: [number, number] = [0, 0], kitchenLot = new Map<string, number>()
    const put = (dept: string, x: AvancePart, q: number) => { if (dept === 'Spiral') x.spiral++; else if (dept === 'RTE') x.pouches += q; else if (dept === 'Packing') { x.cases += q; x.pallets++ } else if (dept === 'MFO') x.mfo += q }
    for (const dept of ['Kitchen', 'Spiral', 'RTE', 'Packing', 'MFO'] as const) for (const r of of(dept)) for (const u of r.units) {
      if (!has(r, u)) continue
      const k = shiftAt(hours, u.at) - 1
      if (dept === 'Kitchen') kitchenBy[k]++; else put(dept, byShift[k], ofLot(r, u))
      for (const p of unitParts(s, r, u)) { if (lot && p.lot !== lot) continue; if (dept === 'Kitchen') kitchenLot.set(p.lot, (kitchenLot.get(p.lot) ?? 0) + 1); else put(dept, lotPart(p.lot), p.qty ?? 0) }
    }
    for (const k of [0, 1] as const) byShift[k].mixes = mixRoom === 'Spiral' ? byShift[k].spiral : kitchenBy[k]
    for (const l of kitchenLot.keys()) lotPart(l)
    for (const [l, x] of lotMap) x.mixes = mixRoom === 'Spiral' ? x.spiral : (kitchenLot.get(l) ?? 0)
    const lots = [...lotMap].map(([l, x]) => ({ lot: l, ...x })).sort((a, b) => a.lot.localeCompare(b.lot))
    return {
      key, code, product, scheduled, mixesDone, mixesPending: scheduled ? scheduled - mixesDone : 0, mixRoom, spiralDone,
      // RTE fills no pouches of a code MFO packs, and MFO no bins of one RTE packs: nothing is expected of the other room
      pouchesPlan: mfoRoute ? null : r2(pouches(casesPlan)), pouchesExp: mfoRoute ? null : r2(pouches(casesExp)), pouchesDone: qty('RTE'),
      casesPlan: r2(casesPlan), casesExp: r2(casesExp), casesDone: qty('Packing'), mfoCases: qty('MFO'),
      palletsPlan: r2(pallets(casesPlan)), palletsExp: r2(pallets(casesExp)), palletsDone: units('Packing'),
      wasteLb: Math.round(runs.filter((r) => normCode(r.code) === key).reduce((t, r) => t + (r.waste || 0), 0) * 100) / 100,
      packRoom: pack.room, packSaid: pack.said, mfoPlan: mfoRoute ? r2(casesPlan) : null, mfoExp: mfoRoute ? r2(casesExp) : null,
      byShift, lots,
    }
  }).filter((r) => !idle(r) || !!keep?.has(r.key)).map(({ key: _key, ...r }) => r)
}

/** "982" or "-10": what is still missing (negative = more than expected, like the red cells in the office's sheet) */
export const pending = (exp: number | null, done: number) => (exp == null ? null : Math.round((exp - done) * 10) / 10)
/** a number for the table: whole when it is whole, else one decimal ("714", "142.8"), "—" when it is not known */
export const n1 = (v: number | null) => { if (v == null) return '—'; const r = Math.round(v * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1) }
/**
 * What was made of one lot on every day this device holds (a lot goes on into the next day), code by code and in all:
 * the office asks for "the total of a lot". The mezclas of a code are the ones of the room that makes it.
 */
export function lotAcrossDays(s: State, lot: string): { days: string[]; codes: ({ code: string } & AvancePart)[]; total: AvancePart } {
  const days = new Set<string>(), byCode = new Map<string, { code: string; kitchen: number; x: AvancePart }>()
  for (const r of s.runs) {
    if (apartOf(r)) continue
    const key = normCode(r.code)
    for (const u of r.units) for (const p of unitParts(s, r, u)) {
      if (p.lot !== lot) continue
      days.add(r.date)
      let c = byCode.get(key)
      if (!c) { c = { code: productOf(s, key)?.code ?? r.code, kitchen: 0, x: part() }; byCode.set(key, c) }
      if (r.dept === 'Kitchen') c.kitchen++; else if (r.dept === 'Spiral') c.x.spiral++; else if (r.dept === 'RTE') c.x.pouches += p.qty ?? 0; else if (r.dept === 'Packing') { c.x.cases += p.qty ?? 0; c.x.pallets++ } else if (r.dept === 'MFO') c.x.mfo += p.qty ?? 0
    }
  }
  const codes = [...byCode.values()].map((c) => ({ code: c.code, ...c.x, mixes: Math.max(c.kitchen, c.x.spiral) })).sort((a, b) => a.code.localeCompare(b.code))
  const total = codes.reduce((t, c) => ({ mixes: t.mixes + c.mixes, spiral: t.spiral + c.spiral, pouches: t.pouches + c.pouches, cases: t.cases + c.cases, mfo: t.mfo + c.mfo, pallets: t.pallets + c.pallets }), part())
  return { days: [...days].sort(), codes, total }
}
