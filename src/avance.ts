import { apartOf, apartWord, binOf, normCode, productOf, shiftAt, shiftsOf, unitQty, type PackRoom, type Product, type Run, type State, type Unit } from './store'
import { palletOwner, runLots, unitParts } from './report'

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
  casesPlan: number | null; casesExp: number | null; casesDone: number
  palletsPlan: number | null; palletsExp: number | null; palletsDone: number
  wasteLb: number
  /**
   * packRoom = the room that packs the code after its mezclas: RTE (pouches) or MFO (bins of cases), never both. The
   * other one has nothing to do with it: its expected and pending are null. packSaid = the products table says so;
   * otherwise it is the room that has registered the code (see packRoomOf).
   */
  packRoom: PackRoom; packSaid: boolean
  /**
   * what MFO made of the code, in what its bins hold, as the operators typed it: platos, copas or pounds (nothing is
   * turned into cases: Jose, 2026-10-17), and "cajas" for its bins of before that day, which counted cases. The usual first.
   */
  mfo: MfoMade[]
  /** what MFO has to pack of a code it packs, in cases (mezclas × yield): only while its bins counted cases (before 2026-10-17); null otherwise */
  mfoPlan: number | null; mfoExp: number | null
  /** the same made numbers, shift by shift (a unit counts on the shift of its hour) and lot by lot (a pallet with two lots gives each its cases and is a pallet of both) */
  byShift: [AvancePart, AvancePart]; lots: ({ lot: string } & AvancePart)[]
  /** a row of one lot over all its days (lotRows): what each day made of it */
  days?: LotDay[]
}
/** what one day made of a lot */
export type LotDay = { date: string } & AvancePart
/** what a shift, a lot or a whole lot made of a code, in each room's unit */
export type AvancePart = { mixes: number; spiral: number; pouches: number; cases: number; mfo: Record<string, number>; pallets: number }
const part = (): AvancePart => ({ mixes: 0, spiral: 0, pouches: 0, cases: 0, mfo: {}, pallets: 0 })
/** what MFO made of a code under one word: platos, copas, lb, or cajas for its bins of before 2026-10-17 */
export type MfoMade = { word: string; qty: number }
/** the word an MFO run counts in: what its bins hold; cajas for a run of before 2026-10-17, which counted cases */
const mfoWordOf = (r: Pick<Run, 'dept' | 'extra'>) => binOf(r) || 'cajas'
const MFO_WORDS_FROM = '2026-10-17'
const MFO_ORDER = ['platos', 'copas', 'lb', 'cajas']
const rankOf = (w: string) => { const i = MFO_ORDER.indexOf(w); return i < 0 ? MFO_ORDER.length : i }
/** MFO's quantities word by word, the usual first: platos, copas, pounds, then the cases of before */
export const mfoList = (x: Record<string, number>): MfoMade[] => Object.entries(x).filter(([, q]) => q > 0).sort((a, b) => rankOf(a[0]) - rankOf(b[0]) || a[0].localeCompare(b[0])).map(([word, qty]) => ({ word, qty: Math.round(qty * 100) / 100 }))
const addWords = (a: Record<string, number>, b: Record<string, number>) => { const out = { ...a }; for (const [w, q] of Object.entries(b)) out[w] = (out[w] ?? 0) + q; return out }
const wordsOf = (l: MfoMade[]) => Object.fromEntries(l.map((x) => [x.word, x.qty])) as Record<string, number>
/** an MFO word as the screen says it: "platos", "copas", "lb", "cajas" */
export const mfoWord = (w: string) => apartWord('MFO', w)
const qtyText = (q: number) => (Math.round(q * 10) / 10).toLocaleString('en-US')
/** "88 platos · 239.5 lb": what MFO made, word by word */
export const mfoText = (x: Record<string, number> | MfoMade[]) => (Array.isArray(x) ? x : mfoList(x)).map((m) => qtyText(m.qty) + ' ' + mfoWord(m.word)).join(' · ')
/** MFO's bins of before 2026-10-17 counted cases: only then is there something to expect of them in cases */
const casesOnly = (l: MfoMade[]) => l.length > 0 && l.every((x) => x.word === 'cajas')

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
  // every room in its own unit, as it was recorded (MFO in what each bin holds)
  const ofLot = (r: Run, u: Unit) => (!lot ? unitQty(s, r, u) : unitParts(s, r, u).filter((p) => p.lot === lot).reduce((t, p) => t + (p.qty ?? 0), 0))
  const runs = s.runs.filter((r) => r.date === date && (!lot || r.lot === lot || r.units.some((u) => has(r, u))))
  // 100 and 0100 are one line; the program holds one entry per code (see setSchedule), the spellings are folded here for old data
  const sched: Record<string, number> = {}
  if (!lot) for (const [c, n] of Object.entries(s.schedule[date] ?? {})) sched[normCode(c)] = normCode(c) === c ? n : sched[normCode(c)] ?? n
  const keys = [...new Set([...Object.keys(sched), ...runs.map((r) => normCode(r.code))])].sort()
  // a code with nothing programmed and nothing made is not a row (setting a program to 0 takes it off the list)
  const idle = (r: AvanceRow) => !r.scheduled && !r.mixesDone && !r.spiralDone && !r.pouchesDone && !r.casesDone && !r.mfo.length && !r.palletsDone && !r.wasteLb
  return keys.map((key): AvanceRow & { key: string } => {
    const product = productOf(s, key)
    const code = product?.code ?? runs.find((r) => normCode(r.code) === key)?.code ?? key
    // a Packing line that fills bins makes no cases and no pallets; a Spiral line weighing its mezclas in pounds (or
    // counting cases) makes no mezclas of a product: what is counted apart stays apart. MFO's bins all count, each in
    // what it holds (platos, copas, pounds), word by word
    const of = (dept: string) => runs.filter((r) => r.dept === dept && normCode(r.code) === key && (dept === 'MFO' || !apartOf(r)))
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
    // without a mezcla made that day nothing can be expected of it: the cases packed then come from another day's
    // mezclas (the carry notes say so), and "0 expected" would call them "de más" and an empty room "complete"
    const casesExp = mixesDone > 0 ? cases(mixesDone) : null, casesPlan = scheduled ? cases(scheduled) : null
    // the same, shift by shift and lot by lot; the mezclas are the ones of the room that makes the code (mixRoom)
    const hours = shiftsOf(s, date)
    const byShift: [AvancePart, AvancePart] = [part(), part()], lotMap = new Map<string, AvancePart>()
    const lotPart = (l: string) => { let x = lotMap.get(l); if (!x) { x = part(); lotMap.set(l, x) } return x }
    const kitchenBy: [number, number] = [0, 0], kitchenLot = new Map<string, number>()
    // whole = this lot counts the unit itself: a pallet of two lots is a pallet of one of them only (palletOwner)
    const put = (dept: string, x: AvancePart, q: number, w = '', whole = true) => { if (dept === 'Spiral') x.spiral++; else if (dept === 'RTE') x.pouches += q; else if (dept === 'Packing') { x.cases += q; if (whole) x.pallets++ } else if (dept === 'MFO') x.mfo[w] = (x.mfo[w] ?? 0) + q }
    for (const dept of ['Kitchen', 'Spiral', 'RTE', 'Packing', 'MFO'] as const) for (const r of of(dept)) for (const u of r.units) {
      if (!has(r, u)) continue
      const k = shiftAt(hours, u.at) - 1
      if (dept === 'Kitchen') kitchenBy[k]++; else put(dept, byShift[k], ofLot(r, u), mfoWordOf(r))
      const parts = unitParts(s, r, u), owner = palletOwner(parts)
      for (const p of parts) { if (lot && p.lot !== lot) continue; if (dept === 'Kitchen') kitchenLot.set(p.lot, (kitchenLot.get(p.lot) ?? 0) + 1); else put(dept, lotPart(p.lot), p.qty ?? 0, mfoWordOf(r), !!lot || parts.length < 2 || p.lot === owner) }
    }
    for (const k of [0, 1] as const) byShift[k].mixes = mixRoom === 'Spiral' ? byShift[k].spiral : kitchenBy[k]
    for (const l of kitchenLot.keys()) lotPart(l)
    for (const [l, x] of lotMap) x.mixes = mixRoom === 'Spiral' ? x.spiral : (kitchenLot.get(l) ?? 0)
    const lots = [...lotMap].map(([l, x]) => ({ lot: l, ...x })).sort((a, b) => a.lot.localeCompare(b.lot))
    const mfo = mfoList(addWords(byShift[0].mfo, byShift[1].mfo)), old = mfoRoute && (casesOnly(mfo) || !mfo.length && date < MFO_WORDS_FROM)
    return {
      key, code, product, scheduled, mixesDone, mixesPending: scheduled ? scheduled - mixesDone : 0, mixRoom, spiralDone,
      // RTE fills no pouches of a code MFO packs, and MFO no bins of one RTE packs: nothing is expected of the other room
      pouchesPlan: mfoRoute ? null : r2(pouches(casesPlan)), pouchesExp: mfoRoute ? null : r2(pouches(casesExp)), pouchesDone: qty('RTE'),
      casesPlan: r2(casesPlan), casesExp: r2(casesExp), casesDone: qty('Packing'), mfo,
      palletsPlan: r2(pallets(casesPlan)), palletsExp: r2(pallets(casesExp)), palletsDone: units('Packing'),
      wasteLb: Math.round(runs.filter((r) => normCode(r.code) === key).reduce((t, r) => t + (r.waste || 0), 0) * 100) / 100,
      packRoom: pack.room, packSaid: pack.said, mfoPlan: old ? r2(casesPlan) : null, mfoExp: old ? r2(casesExp) : null,
      byShift, lots,
    }
  }).filter((r) => !idle(r) || !!keep?.has(r.key)).map(({ key: _key, ...r }) => r)
}

/** "982" or "-10": what is still missing (negative = more than expected, like the red cells in the office's sheet) */
export const pending = (exp: number | null, done: number) => (exp == null ? null : Math.round((exp - done) * 10) / 10)
/** a number for the table: whole when it is whole, else one decimal ("714", "142.8"), "—" when it is not known */
export const n1 = (v: number | null) => { if (v == null) return '—'; const r = Math.round(v * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1) }
/**
 * What was made of one lot on every day this device holds (a lot goes on into the next day), code by code, day by
 * day and in all: the office asks for "the total of a lot". The mezclas of a code are the ones of the room that makes it.
 */
export function lotAcrossDays(s: State, lot: string): { days: string[]; codes: ({ code: string; mixRoom: 'Kitchen' | 'Spiral'; days: LotDay[] } & AvancePart)[]; total: AvancePart } {
  const days = new Set<string>(), byCode = new Map<string, { code: string; dates: Map<string, { kitchen: number; x: AvancePart }> }>()
  for (const r of s.runs) {
    if (apartOf(r) && r.dept !== 'MFO') continue // (MFO's bins all count, word by word)
    const key = normCode(r.code)
    for (const u of r.units) for (const p of unitParts(s, r, u)) {
      if (p.lot !== lot) continue
      // a pallet of two lots is a pallet of one of them only (palletOwner): adding lots up never gives one more
      const parts = unitParts(s, r, u), whole = parts.length < 2 || p.lot === palletOwner(parts)
      days.add(r.date)
      let c = byCode.get(key)
      if (!c) { c = { code: productOf(s, key)?.code ?? r.code, dates: new Map() }; byCode.set(key, c) }
      let d = c.dates.get(r.date)
      if (!d) { d = { kitchen: 0, x: part() }; c.dates.set(r.date, d) }
      if (r.dept === 'Kitchen') d.kitchen++; else if (r.dept === 'Spiral') d.x.spiral++; else if (r.dept === 'RTE') d.x.pouches += p.qty ?? 0; else if (r.dept === 'Packing') { d.x.cases += p.qty ?? 0; if (whole) d.x.pallets++ } else if (r.dept === 'MFO') { const w = mfoWordOf(r); d.x.mfo[w] = (d.x.mfo[w] ?? 0) + (p.qty ?? 0) }
    }
  }
  const add = (t: AvancePart, x: AvancePart): AvancePart => ({ mixes: t.mixes + x.mixes, spiral: t.spiral + x.spiral, pouches: t.pouches + x.pouches, cases: t.cases + x.cases, mfo: addWords(t.mfo, x.mfo), pallets: t.pallets + x.pallets })
  const codes = [...byCode.values()].map((c) => {
    const kitchen = [...c.dates.values()].reduce((t, d) => t + d.kitchen, 0), spiral = [...c.dates.values()].reduce((t, d) => t + d.x.spiral, 0)
    const mixRoom = spiral > kitchen ? 'Spiral' as const : 'Kitchen' as const
    const dayRows: LotDay[] = [...c.dates].map(([date, d]) => ({ date, ...d.x, mixes: mixRoom === 'Spiral' ? d.x.spiral : d.kitchen })).sort((a, b) => a.date.localeCompare(b.date))
    return { code: c.code, mixRoom, days: dayRows, ...dayRows.reduce(add, part()) }
  }).sort((a, b) => a.code.localeCompare(b.code))
  return { days: [...days].sort(), codes, total: codes.reduce((t, c) => add(t, c), part()) }
}
/**
 * The rows of Avance for one lot over all its days: what each code made of it, against what its mezclas allow.
 * No program (a program is a day's, not a lot's), no shifts (they are a day's too: each day is said instead), no waste
 * (it is a run's, not a lot's).
 */
export function lotRows(s: State, lot: string): AvanceRow[] {
  return lotAcrossDays(s, lot).codes.map((c) => {
    const product = productOf(s, c.code), pack = packRoomOf(s, c.code), mfoRoute = pack.room === 'MFO'
    const casesExp = product && product.casesPerMix && c.mixes > 0 ? c.mixes * product.casesPerMix : null
    const pouchesExp = product && product.pouchesPerCase && casesExp != null ? casesExp * product.pouchesPerCase : null
    const palletsExp = product && product.casesPerPallet && casesExp != null ? casesExp / product.casesPerPallet : null
    const { days, mixRoom, code, ...made } = c
    const mfo = mfoList(made.mfo), old = mfoRoute && casesOnly(mfo)
    return {
      code, product, scheduled: 0, mixesDone: made.mixes, mixesPending: 0, mixRoom, spiralDone: made.spiral,
      pouchesPlan: null, pouchesExp: mfoRoute ? null : r2(pouchesExp), pouchesDone: made.pouches,
      casesPlan: null, casesExp: r2(casesExp), casesDone: made.cases, mfo,
      palletsPlan: null, palletsExp: r2(palletsExp), palletsDone: made.pallets,
      wasteLb: 0, packRoom: pack.room, packSaid: pack.said, mfoPlan: null, mfoExp: old ? r2(casesExp) : null,
      byShift: [part(), part()], lots: [{ lot, ...made }], days,
    }
  })
}
/**
 * every lot on the device's runs, the newest first: to look at one that is not of the date in view. A run still open
 * also gives the lot it packs now and the one on the pallet being built (runLots), with nothing of it counted yet:
 * the office looks for the lot being worked on (2026-10-19; for an ended run, runLots is its units' lots, or its own)
 */
export function lotsKnown(s: State): string[] {
  const out = new Set<string>()
  for (const r of s.runs) for (const l of runLots(s, r)) if (l) out.add(l)
  return [...out].sort(lotOrder)
}
/** the newest lot first: by number when the lots are numbers (the plant's Julian lots), else by text (Flujo lists its lots so too) */
export const lotOrder = (a: string, b: string) => (Number(b) || 0) - (Number(a) || 0) || b.localeCompare(a)
/** the days from one date to another, both included; a range upside down is turned around; at most 92 days */
export function datesBetween(from: string, to: string): string[] {
  const [a, b] = from <= to ? [from, to] : [to, from]
  const out: string[] = []
  const d = new Date(a + 'T12:00:00')
  for (let i = 0; i < 92; i++) {
    const ds = d.toISOString().slice(0, 10)
    if (ds > b) break
    out.push(ds); d.setDate(d.getDate() + 1)
  }
  return out
}
const addPart = (t: AvancePart, x: AvancePart): AvancePart => ({ mixes: t.mixes + x.mixes, spiral: t.spiral + x.spiral, pouches: t.pouches + x.pouches, cases: t.cases + x.cases, mfo: addWords(t.mfo, x.mfo), pallets: t.pallets + x.pallets })
const addN = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0))
/**
 * Avance over several days: each code with its days added up (the program and what was made alike), what each day
 * made of it, its lots over those days and its shifts added up. With a lot, only that lot's part of each day.
 */
export function avanceRange(s: State, from: string, to: string, lot = ''): AvanceRow[] {
  const byCode = new Map<string, AvanceRow & { lotMap: Map<string, AvancePart> }>()
  for (const date of datesBetween(from, to)) for (const r of avanceRows(s, date, undefined, lot)) {
    const key = normCode(r.code), dayRow: LotDay = { date, mixes: r.mixesDone, spiral: r.spiralDone, pouches: r.pouchesDone, cases: r.casesDone, mfo: wordsOf(r.mfo), pallets: r.palletsDone }
    const c = byCode.get(key)
    if (!c) { byCode.set(key, { ...r, days: [dayRow], lotMap: new Map(r.lots.map((l) => [l.lot, l])) }); continue }
    for (const l of r.lots) c.lotMap.set(l.lot, addPart(c.lotMap.get(l.lot) ?? part(), l))
    byCode.set(key, {
      ...c, days: [...(c.days ?? []), dayRow],
      scheduled: c.scheduled + r.scheduled, mixesDone: c.mixesDone + r.mixesDone, mixesPending: c.mixesPending + r.mixesPending, spiralDone: c.spiralDone + r.spiralDone,
      mixRoom: r.mixesDone > c.mixesDone ? r.mixRoom : c.mixRoom,
      pouchesPlan: addN(c.pouchesPlan, r.pouchesPlan), pouchesExp: addN(c.pouchesExp, r.pouchesExp), pouchesDone: c.pouchesDone + r.pouchesDone,
      casesPlan: addN(c.casesPlan, r.casesPlan), casesExp: addN(c.casesExp, r.casesExp), casesDone: c.casesDone + r.casesDone, mfo: mfoList(addWords(wordsOf(c.mfo), wordsOf(r.mfo))),
      palletsPlan: addN(c.palletsPlan, r.palletsPlan), palletsExp: addN(c.palletsExp, r.palletsExp), palletsDone: c.palletsDone + r.palletsDone,
      wasteLb: Math.round((c.wasteLb + r.wasteLb) * 100) / 100, mfoPlan: addN(c.mfoPlan, r.mfoPlan), mfoExp: addN(c.mfoExp, r.mfoExp),
      byShift: [addPart(c.byShift[0], r.byShift[0]), addPart(c.byShift[1], r.byShift[1])],
    })
  }
  return [...byCode.values()].map(({ lotMap, ...r }) => ({ ...r, lots: [...lotMap].map(([l, x]) => ({ lot: l, ...x })).sort((a, b) => a.lot.localeCompare(b.lot)) })).sort((a, b) => a.code.localeCompare(b.code))
}
