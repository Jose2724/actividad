import { CFG, DEPTS, lineNameOf, normCode, orderLabel, orderOfId, plainDay, runInShift, runStats, SETUP, shiftAt, shiftPieces, shiftsOf, stopSpans, unitQty, waitsForCode, type Dept, type Run, type ShiftHours, type State, type Unit } from './store'

/**
 * The day's report, as the tables on screen and in every file made from them (Excel, CSV, PDF): one place decides
 * what is in it, so a filter by code, by lot or by shift gives the same answer everywhere.
 * shift: 0 = the whole day (with what each shift did under it); 1 or 2 = only what that shift did.
 */
export type ReportFilter = { only?: Dept; code?: string; lot?: string; shift?: 0 | 1 | 2 }

/** the lots a unit carries: the ones written on it (a pallet with cases of two lots), or the run's lot with all of it */
export function unitParts(s: State, r: Run, u: Unit): { lot: string; qty: number | null }[] {
  if (u.lots?.length) return u.lots.map((l) => ({ lot: l.lot, qty: l.qty }))
  return [{ lot: r.lot, qty: CFG[r.dept].qty === 'none' ? null : unitQty(s, r, u) }]
}
/** every lot a run has touched */
const runLots = (s: State, r: Run) => new Set(r.units.length ? r.units.flatMap((u) => unitParts(s, r, u).map((p) => p.lot)) : [r.lot])
const round2 = (x: number) => Math.round(x * 100) / 100
/** "1", "2" or "1 y 2": the shifts a stretch of time touched */
export function spanShifts(h: ShiftHours, a: number, b: number) {
  const k = new Set(b > a ? shiftPieces(h, a, b).map((p) => p.shift) : [shiftAt(h, a)])
  return k.has(1) && k.has(2) ? '1 y 2' : k.has(1) ? '1' : '2'
}

export function reportOf(s: State, date: string, now: number, f: ReportFilter = {}) {
  const plan = shiftsOf(s, date)
  const shift: 0 | 1 | 2 = f.shift === 1 || f.shift === 2 ? f.shift : 0
  const day = s.runs.filter((r) => r.date === date && (!f.only || r.dept === f.only)).sort((a, b) => a.startedAt - b.startedAt)
  // what this day offers to filter by
  const codes = [...new Map(day.map((r) => [normCode(r.code), r.code])).values()].sort()
  const lots = [...new Set(day.flatMap((r) => [...runLots(s, r)]))].filter(Boolean).sort()
  // a filter the day does not have (the date was changed) is no filter
  const code = f.code ? codes.find((c) => normCode(c) === normCode(f.code ?? '')) ?? '' : ''
  const lot = f.lot && lots.includes(f.lot) ? f.lot : ''
  const filtered = !!code || !!lot || !!shift
  const kept = day.filter((r) => (!code || normCode(r.code) === normCode(code)) && (!lot || runLots(s, r).has(lot)))
  /** one line of the report for a run: all of it (k = 0), or only what one shift did of it */
  const rowOf = (r: Run, k: 0 | 1 | 2) => {
    const whole = runStats(s, r, now)
    const inK = (u: Unit) => !k || shiftAt(plan, u.at) === k
    const mine = r.units.map((u, i) => ({ u, i })).filter((x) => inK(x.u))
    // with a lot chosen, only the units (and the part of each) that belong to it
    const parts = mine.map((x) => ({ ...x, all: unitParts(s, r, x.u) })).map((x) => ({ ...x, kept: x.all.filter((p) => !lot || p.lot === lot) })).filter((x) => x.kept.length)
    const view: Run = lot || k ? { ...r, units: parts.map((x) => x.u) } : r
    const qty = lot ? parts.reduce((t, x) => t + x.kept.reduce((a, p) => a + (p.qty ?? 0), 0), 0) : k ? mine.reduce((t, x) => t + unitQty(s, r, x.u), 0) : whole.qty
    // one shift: the time the run worked and was stopped in it, and the average of the units it recorded in it
    const sh = k ? runInShift(s, r, now, plan, k) : null
    const st = sh ? { ...whole, working: sh.working, down: sh.down, reasons: sh.reasons, total: sh.total, qty, avg: mine.length ? mine.reduce((t, x) => t + (whole.unitTimes[x.i] ?? 0), 0) / mine.length : 0 } : whole
    // waste has no hour of its own: a run that passes from one shift to the other splits it by what each one made
    // (by the time each one had it, while it has made nothing)
    const made = (list: Unit[]) => list.reduce((t, u) => t + (CFG[r.dept].qty === 'none' ? 1 : unitQty(s, r, u)), 0)
    const share1 = () => {
      const all = made(r.units)
      if (all > 0) return made(r.units.filter((u) => shiftAt(plan, u.at) === 1)) / all
      const t1 = runInShift(s, r, now, plan, 1).total, t2 = runInShift(s, r, now, plan, 2).total
      return t1 + t2 > 0 ? t1 / (t1 + t2) : shiftAt(plan, r.startedAt) === 1 ? 1 : 0
    }
    const first = k && r.waste ? round2(r.waste * share1()) : 0
    const waste = !k ? r.waste : k === 1 ? first : round2(r.waste - first)
    // the lots this line of the report is about: the one chosen, or every lot the run has touched
    return { r, st, view, units: view.units.length, timed: k ? mine.length : r.units.length, qty, waste, parts, lots: lot || [...runLots(s, r)].filter(Boolean).join(', '), shifts: spanShifts(plan, r.startedAt, r.endedAt ?? now), here: !sh || sh.touched || mine.length > 0 }
  }
  const rowsOf = (k: 0 | 1 | 2) => kept.map((r) => rowOf(r, k)).filter((x) => x.here)
  const rows = rowsOf(shift), runs = rows.map((x) => x.r)
  // one line per unit; a pallet with two lots gives two lines, each with its lot and its cases
  const unitRows = rows.flatMap((x) => x.parts.flatMap(({ u, i, all, kept: mine }) => mine.map((p) => ({ r: x.r, i, u, lot: p.lot, qty: p.qty, gap: x.st.unitTimes[i] ?? 0, mixed: all.length > 1, shift: shiftAt(plan, u.at), order: ((o) => (o ? orderLabel(o) : ''))(orderOfId(s, u.po)) })))).sort((a, b) => a.u.at - b.u.at)
  // A line between two codes: what is left counting there is a stop only once the next code starts (see waitsForCode),
  // so while it waits it is on the line's card and not here: nobody working, nothing counting. And one that the first
  // code of another day of work closed (a tablet with an older version of the app) was not a set up either: the people
  // had gone home in between.
  const between = (x: (typeof s.stops)[number]) => x.lineId !== null && !s.runs.some((r) => r.lineId === x.lineId && r.startedAt <= x.startedAt && (r.endedAt ?? Infinity) > x.startedAt)
  const notOne = (x: (typeof s.stops)[number]) => waitsForCode(s, x) || (!!x.endedAt && plainDay(s, x.endedAt) !== plainDay(s, x.startedAt) && between(x))
  // a stop belongs to the day of work it started in: one after midnight is still the second shift's, of the day before
  const dayStops = s.stops.filter((x) => plainDay(s, x.startedAt) === date && (!f.only || x.dept === f.only) && !notOne(x)).sort((a, b) => a.startedAt - b.startedAt)
  // with a code or a lot chosen, the stops that happened while those runs were on their lines
  const ofRuns = code || lot ? dayStops.filter((x) => kept.some((r) => x.dept === r.dept && (x.lineId === r.lineId || x.lineId === null) && x.startedAt < (r.endedAt ?? now) && (x.endedAt ?? now) > r.startedAt)) : dayStops
  /** how long a stop counts (only the time somebody was there: see awayOn), in one shift or in the whole day */
  const inShift = (x: (typeof s.stops)[number], k: 0 | 1 | 2) => stopSpans(s, x, now).reduce((t, p) => t + (!k ? p.to - p.from : shiftPieces(plan, p.from, p.to).filter((q) => q.shift === k).reduce((a, q) => a + (q.to - q.from), 0)), 0)
  // a stop is of a shift when it counts time in it (one that counts none at all, of the shift it started in)
  const touches = (x: (typeof s.stops)[number], k: 1 | 2) => inShift(x, k) > 0 || (inShift(x, 0) === 0 && shiftAt(plan, x.startedAt) === k)
  const stops = (shift ? ofRuns.filter((x) => touches(x, shift)) : ofRuns).map((x) => ({ ...x, ms: inShift(x, shift) }))
  // the time the lines spent between one code and the next
  const setupOf = (k: 0 | 1 | 2, dept?: Dept) => ofRuns.filter((x) => x.reason === SETUP && (!dept || x.dept === dept)).reduce((t, x) => t + inShift(x, k), 0)
  // the same code on several lines of a room, added up (with what each shift made of it, when the report is the whole day's)
  const each = shift ? null : ([rowsOf(1), rowsOf(2)] as const)
  const codeKey = (r: Run) => r.dept + '|' + normCode(r.code)
  const madeBy = (list: ReturnType<typeof rowsOf>, key: string) => list.filter((x) => codeKey(x.r) === key).reduce((t, x) => t + (CFG[x.r.dept].qty === 'none' ? x.units : x.qty), 0)
  const byCode = [...rows.reduce((m, x) => {
    const k = codeKey(x.r)
    const e = m.get(k) ?? { dept: x.r.dept, code: x.r.code, units: 0, qty: 0, waste: 0, lines: [] as string[], byShift: (each ? [madeBy(each[0], k), madeBy(each[1], k)] : null) as [number, number] | null }
    e.units += x.units; e.qty += x.qty; e.waste = round2(e.waste + x.waste)
    const line = lineNameOf(s, x.r.lineId, x.r.line)
    if (!e.lines.includes(line)) e.lines.push(line)
    return m.set(k, e)
  }, new Map<string, { dept: Dept; code: string; units: number; qty: number; waste: number; lines: string[]; byShift: [number, number] | null }>()).values()]
  // the whole day first and each shift under it, room by room (each room counts in its own unit)
  const sum = (list: ReturnType<typeof rowsOf>, k: 0 | 1 | 2, dept: Dept) => {
    const mine = list.filter((x) => x.r.dept === dept)
    return { shift: k, codes: mine.length, units: mine.reduce((t, x) => t + x.units, 0), qty: mine.reduce((t, x) => t + x.qty, 0), waste: round2(mine.reduce((t, x) => t + x.waste, 0)), working: mine.reduce((t, x) => t + x.st.working, 0), down: mine.reduce((t, x) => t + x.st.down, 0), setup: setupOf(k, dept) }
  }
  const byShift = each ? DEPTS.filter((d) => rows.some((x) => x.r.dept === d)).map((d) => ({ dept: d, day: sum(rows, 0, d), first: sum(each[0], 1, d), second: sum(each[1], 2, d) })) : []
  return { runs, rows, unitRows, stops, byCode, byShift, working: rows.reduce((t, x) => t + x.st.working, 0), down: rows.reduce((t, x) => t + x.st.down, 0), setup: setupOf(shift), codes, lots, code, lot, shift, plan, filtered }
}
/** the words a filtered report carries in its title and in the name of its files */
export const filterTitle = (code: string, lot: string, shift: 0 | 1 | 2 = 0) => (shift ? ' · Turno ' + shift : '') + (code ? ' · código ' + code : '') + (lot ? ' · lote ' + lot : '')
export const filterFile = (code: string, lot: string, shift: 0 | 1 | 2 = 0) => { const clean = (t: string) => t.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''); return (shift ? '-turno' + shift : '') + (code ? '-cod-' + clean(code) : '') + (lot ? '-lote-' + clean(lot) : '') }
