import { apartOf, binOf, binWord, CFG, cfgOf, DEPTS, fmtDur, fmtTime, kindOf, lineLabel, lineNameOf, normCode, noteLabel, noteOf, orderLabel, orderOfId, orderPallets, palletPo, plainDay, plainText, runInShift, runStats, SETUP, shiftAt, shiftPieces, shiftsOf, stopSpans, unitQty, waitsForCode, whoText, type Change, type Dept, type Run, type ShiftHours, type State, type Unit } from './store'
import { clockNow } from './clock'
import { xDay, xDur, xTime, type Cell } from './xlsx'
import { phrase, tr } from './i18n'

/**
 * The day's report, as the tables on screen and in every file made from them (Excel, CSV, PDF): one place decides
 * what is in it, so a filter by code, by lot or by shift gives the same answer everywhere.
 * shift: 0 = the whole day (with what each shift did under it); 1 or 2 = only what that shift did.
 */
export type ReportFilter = { only?: Dept; code?: string; lot?: string; shift?: 0 | 1 | 2; line?: string }

/**
 * the lots a unit carries, each with its tag: the ones written on it (a pallet with cases of two lots, each lot with
 * its own tag), or the run's lot with all of it. A unit of before, with one tag for all of it, gives that tag.
 */
export function unitParts(s: State, r: Run, u: Unit): { lot: string; qty: number | null; tag: string }[] {
  if (u.lots?.length) { const own = u.lots.some((l) => !!l.tag); return u.lots.map((l) => ({ lot: l.lot, qty: l.qty, tag: l.tag ?? (own ? '' : u.ref) })) }
  return [{ lot: r.lot, qty: CFG[r.dept].qty === 'none' ? null : unitQty(s, r, u), tag: u.ref }]
}
/** every lot a run has touched: on its units, and while it runs, on the pallet being built and the lot being packed now */
export const runLots = (s: State, r: Run) => new Set([...(r.units.length ? r.units.flatMap((u) => unitParts(s, r, u).map((p) => p.lot)) : [r.lot]), ...(r.endedAt ? [] : [...(r.extra?.open?.parts.map((p) => p.lot) ?? []), ...(r.extra?.lotNow ? [r.extra.lotNow] : [])])])
/**
 * The lot a pallet added from an order's pallets window starts with (AddUnitDialog with startPo): the run's lot only
 * when it is the one lot the run has touched, a fact; a run that went through two lots (a lot ran out, or the line
 * moved on to the next while it runs) starts with none, to be typed: its first lot is not the one the pallet carried
 * any more than the last (review, 2026-10-18; Jose's rule: the app puts in nothing the person did not type)
 */
export const unitStartLot = (s: State, r: Run) => { const lots = [...runLots(s, r)].filter(Boolean); return lots.length === 1 ? lots[0] : '' }
const round2 = (x: number) => Math.round(x * 100) / 100
/** one lot of a code in the report: how many units carry it, how much, and what each shift made of it (the whole day's report) */
export type LotLine = { lot: string; units: number; qty: number; byShift: [number, number] | null }
/** "1", "2" or "1 y 2": the shifts a stretch of time touched */
export function spanShifts(h: ShiftHours, a: number, b: number) {
  const k = new Set(b > a ? shiftPieces(h, a, b).map((p) => p.shift) : [shiftAt(h, a)])
  return k.has(1) && k.has(2) ? '1 y 2' : k.has(1) ? '1' : '2'
}

export function reportOf(s: State, date: string, now: number, f: ReportFilter = {}) {
  const plan = shiftsOf(s, date)
  // a day with one shift has no other shift to look at: asking for it gives the whole day
  const shift: 0 | 1 | 2 = (f.shift === 1 || f.shift === 2) && !(plan.only && plan.only !== f.shift) ? f.shift : 0
  const day = s.runs.filter((r) => r.date === date && (!f.only || r.dept === f.only)).sort((a, b) => a.startedAt - b.startedAt)
  // what this day offers to filter by
  const codes = [...new Map(day.map((r) => [normCode(r.code), r.code])).values()].sort()
  const lots = [...new Set(day.flatMap((r) => [...runLots(s, r)]))].filter(Boolean).sort()
  // the lines that worked that day, to look at one alone ("cuánto hizo la línea 2 de RTE")
  const lineChoices = [...new Map(day.map((r) => [r.lineId, { id: r.lineId, dept: r.dept, name: lineNameOf(s, r.lineId, r.line) }])).values()].sort((a, b) => DEPTS.indexOf(a.dept) - DEPTS.indexOf(b.dept) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  const line = f.line && lineChoices.some((l) => l.id === f.line) ? f.line : ''
  // a filter the day does not have (the date was changed) is no filter
  const code = f.code ? codes.find((c) => normCode(c) === normCode(f.code ?? '')) ?? '' : ''
  const lot = f.lot && lots.includes(f.lot) ? f.lot : ''
  const filtered = !!code || !!lot || !!shift || !!line
  const kept = day.filter((r) => (!code || normCode(r.code) === normCode(code)) && (!lot || runLots(s, r).has(lot)) && (!line || r.lineId === line))
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
    const st = sh ? { ...whole, working: sh.working, down: sh.down, setup: sh.setup, reasons: sh.reasons, total: sh.total, qty, avg: mine.length ? mine.reduce((t, x) => t + (whole.unitTimes[x.i] ?? 0), 0) / mine.length : 0 } : whole
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
    // the first and the last moment of the run that count in what is in view (all of it, or its part in one shift)
    const from = sh ? sh.from : r.startedAt, to = sh ? sh.to : r.endedAt ?? now
    return { r, st, view, from, to, units: view.units.length, timed: k ? mine.length : r.units.length, qty, waste, parts, lots: lot || [...runLots(s, r)].filter(Boolean).join(', '), shifts: spanShifts(plan, r.startedAt, r.endedAt ?? now), here: !sh || sh.touched || mine.length > 0 }
  }
  const rowsOf = (k: 0 | 1 | 2) => kept.map((r) => rowOf(r, k)).filter((x) => x.here)
  const rows = rowsOf(shift), runs = rows.map((x) => x.r)
  // one line per unit; a pallet with two lots gives two lines, each with its lot and its cases
  const unitRows = rows.flatMap((x) => x.parts.flatMap(({ u, i, all, kept: mine }) => mine.map((p) => ({ r: x.r, i, u, lot: p.lot, qty: p.qty, tag: p.tag, gap: x.st.unitTimes[i] ?? 0, mixed: all.length > 1, shift: shiftAt(plan, u.at), order: ((o) => (o ? orderLabel(o) : ''))(orderOfId(s, u.po)) })))).sort((a, b) => a.u.at - b.u.at)
  // A line between two codes: what is left counting there is a stop only once the next code starts (see waitsForCode),
  // so while it waits it is on the line's card and not here: nobody working, nothing counting. And one that the first
  // code of another day of work closed (a tablet with an older version of the app) was not a set up either: the people
  // had gone home in between.
  const between = (x: (typeof s.stops)[number]) => x.lineId !== null && !s.runs.some((r) => r.lineId === x.lineId && r.startedAt <= x.startedAt && (r.endedAt ?? Infinity) > x.startedAt)
  const notOne = (x: (typeof s.stops)[number]) => waitsForCode(s, x) || (!!x.endedAt && plainDay(s, x.endedAt) !== plainDay(s, x.startedAt) && between(x))
  // a stop belongs to the day of work it started in: one after midnight is still the second shift's, of the day before
  const dayStops = s.stops.filter((x) => plainDay(s, x.startedAt) === date && (!f.only || x.dept === f.only) && !notOne(x)).sort((a, b) => a.startedAt - b.startedAt)
  // with a code or a lot chosen, the stops that happened while those runs were on their lines
  // (with a line chosen, that line's stops and the room's, whether or not a code was on the line)
  const ofRuns = code || lot || line ? dayStops.filter((x) => (!line || x.lineId === line || (x.lineId === null && kept.some((r) => r.dept === x.dept))) && (!(code || lot) || kept.some((r) => x.dept === r.dept && (x.lineId === r.lineId || x.lineId === null) && x.startedAt < (r.endedAt ?? now) && (x.endedAt ?? now) > r.startedAt))) : dayStops
  /** how long a stop counts (only the time somebody was there: see awayOn), in one shift or in the whole day */
  const inShift = (x: (typeof s.stops)[number], k: 0 | 1 | 2) => stopSpans(s, x, now).reduce((t, p) => t + (!k ? p.to - p.from : shiftPieces(plan, p.from, p.to).filter((q) => q.shift === k).reduce((a, q) => a + (q.to - q.from), 0)), 0)
  // a stop is of a shift when it counts time in it (one that counts none at all, of the shift it started in)
  const touches = (x: (typeof s.stops)[number], k: 1 | 2) => inShift(x, k) > 0 || (inShift(x, 0) === 0 && shiftAt(plan, x.startedAt) === k)
  const stops = (shift ? ofRuns.filter((x) => touches(x, shift)) : ofRuns).map((x) => ({ ...x, ms: inShift(x, shift) }))
  // The time the lines spent between one code and the next. Two set ups open at once on one line (two tablets that had
  // not yet seen each other's, both later closed by the next code) are one stretch of time, not two: the minutes of a
  // line are counted once, as "Parado" counts them (stoppedPieces). The Paros list keeps both records (audit
  // 2026-10-17, H7: the day's Set up came out doubled)
  const setupOf = (k: 0 | 1 | 2, dept?: Dept) => {
    const byLine = new Map<string, { from: number; to: number }[]>()
    for (const x of ofRuns) {
      if (x.reason !== SETUP || (dept && x.dept !== dept)) continue
      const pieces = stopSpans(s, x, now).flatMap((p) => (!k ? [p] : shiftPieces(plan, p.from, p.to).filter((q) => q.shift === k)))
      const key = x.dept + '|' + (x.lineId ?? '*'), list = byLine.get(key) ?? []
      list.push(...pieces.map((p) => ({ from: p.from, to: p.to })))
      byLine.set(key, list)
    }
    let total = 0
    for (const list of byLine.values()) {
      let end = -Infinity
      for (const p of list.sort((a, b) => a.from - b.from)) { const from = Math.max(p.from, end); if (p.to > from) total += p.to - from; end = Math.max(end, p.to) }
    }
    return total
  }
  // the same code on several lines of a room, added up (with what each shift made of it, when the report is the whole day's)
  const each = shift ? null : ([rowsOf(1), rowsOf(2)] as const)
  const codeKey = (r: Run) => r.dept + '|' + normCode(r.code) + (kindOf(r) ? '|bin|' + kindOf(r) : '')
  const madeBy = (list: ReturnType<typeof rowsOf>, key: string) => list.filter((x) => codeKey(x.r) === key).reduce((t, x) => t + (CFG[x.r.dept].qty === 'none' ? x.units : x.qty), 0)
  const byCode = [...rows.reduce((m, x) => {
    const k = codeKey(x.r)
    const e = m.get(k) ?? { dept: x.r.dept, code: x.r.code, bin: kindOf(x.r), units: 0, qty: 0, waste: 0, lines: [] as string[], byShift: (each ? [madeBy(each[0], k), madeBy(each[1], k)] : null) as [number, number] | null, lots: [] as LotLine[] }
    e.units += x.units; e.qty += x.qty; e.waste = round2(e.waste + x.waste)
    const line = lineNameOf(s, x.r.lineId, x.r.line)
    if (!e.lines.includes(line)) e.lines.push(line)
    // each lot of the code with what it carries: its units, its quantity and what each shift made of it. (A pallet
    // with cases of two lots is one pallet of the code, and is counted as a unit of both its lots.)
    const none = CFG[x.r.dept].qty === 'none'
    const lotLine = (name: string) => { let l = e.lots.find((y) => y.lot === name); if (!l) e.lots.push((l = { lot: name, units: 0, qty: 0, byShift: shift ? null : [0, 0] })); return l }
    if (!x.parts.length && (!lot || x.r.lot === lot)) lotLine(x.r.lot)
    for (const p of x.parts) for (const piece of p.kept) {
      const l = lotLine(piece.lot), n = none ? 1 : piece.qty ?? 0
      l.units++
      if (!none) l.qty += n
      if (l.byShift) l.byShift[shiftAt(plan, p.u.at) - 1] += n
    }
    return m.set(k, e)
  }, new Map<string, { dept: Dept; code: string; bin: string; units: number; qty: number; waste: number; lines: string[]; byShift: [number, number] | null; lots: LotLine[] }>()).values()].map((c) => ({ ...c, lots: c.lots.sort((a, b) => a.lot.localeCompare(b.lot)) }))
    // room by room in the order of the plant, and within a room code by code: the same on the screen and in every file
    .sort((a, b) => DEPTS.indexOf(a.dept) - DEPTS.indexOf(b.dept) || a.code.localeCompare(b.code, undefined, { numeric: true }))
  // the whole day first and each shift under it, room by room (each room counts in its own unit)
  const sum = (list: ReturnType<typeof rowsOf>, k: 0 | 1 | 2, dept: Dept) => {
    const mine = list.filter((x) => x.r.dept === dept)
    // what a line made filling bins (platos, copas, pouches) is not cases nor pallets: told apart, word by word
    const counted = mine.filter((x) => !apartOf(x.r)), bins = [...mine.filter((x) => !!apartOf(x.r)).reduce((m, x) => { const w = apartOf(x.r), e = m.get(w) ?? { word: w, units: 0, qty: 0 }; e.units += x.units; e.qty += x.qty; return m.set(w, e) }, new Map<string, { word: string; units: number; qty: number }>()).values()].filter((b) => b.units > 0)
    // The clock time of the room: from its first code's start to its last code's end (in this shift, when it is one).
    // "working" and "down" are another thing: the sum of every line's time, so three lines for five hours are fifteen.
    const timed = mine.filter((x) => x.to > x.from)
    const from = timed.length ? Math.min(...timed.map((x) => x.from)) : 0, to = timed.length ? Math.max(...timed.map((x) => x.to)) : 0
    return { shift: k, from, to, span: to - from, open: timed.some((x) => !x.r.endedAt && x.to >= now), distinct: new Set(mine.map((x) => normCode(x.r.code))).size, lines: new Set(mine.map((x) => x.r.lineId)).size, codes: mine.length, units: counted.reduce((t, x) => t + x.units, 0), qty: counted.reduce((t, x) => t + x.qty, 0), bins, waste: round2(mine.reduce((t, x) => t + x.waste, 0)), working: mine.reduce((t, x) => t + x.st.working, 0), down: mine.reduce((t, x) => t + x.st.down, 0), setup: setupOf(k, dept) }
  }
  const here = DEPTS.filter((d) => rows.some((x) => x.r.dept === d))
  // (the day lasted what its two shifts lasted: the hours between one shift and the next are nobody's)
  const byShift = each ? here.map((d) => { const first = sum(each[0], 1, d), second = sum(each[1], 2, d); return { dept: d, day: { ...sum(rows, 0, d), span: first.span + second.span }, first, second } }) : []
  // what each room has made of what is in view (the day, or the shift chosen; the code and the lot chosen): the big numbers
  const byDept = here.map((d) => ({ dept: d, ...(byShift.find((x) => x.dept === d)?.day ?? sum(rows, shift, d)) }))
  // what the lines were stopped for while they had a code, cause by cause: together they are the "Parado" total
  const reasons = [...rows.reduce((m, x) => { for (const [k, v] of Object.entries(x.st.reasons)) m.set(k, (m.get(k) ?? 0) + v); return m }, new Map<string, number>())].map(([reason, ms]) => ({ reason, ms })).filter((x) => x.ms > 0).sort((a, b) => b.ms - a.ms)
  // Packing's pallets one by one: every lot each one holds with its cases and its tag, its total, and its order with its
  // place among that order's pallets (3/12). The pallet a line is building is there too, while it is built (open).
  // With a lot chosen, the pallets that hold it, whole.
  // (note: the comment typed on the pallet, '' = none; the pallet being built has none yet)
  const palletOf = (r: Run, n: number, at: number, parts: { lot: string; qty: number | null; tag: string }[], po: string | undefined, by: string, open: boolean, note = '') => {
    const o = orderOfId(s, po), seq = o ? orderPallets(s, o.id, r.perUnit) : null
    const of: [number, number | null] | null = seq ? [open ? seq.done.length + 1 : seq.done.indexOf(at) + 1, seq.need] : null
    return { r, n, at, parts, total: parts.reduce((t, p) => t + (p.qty ?? 0), 0), order: o ? orderLabel(o) : '', of, shift: shiftAt(plan, at), by, open, note }
  }
  const pallets = rows.filter((x) => x.r.dept === 'Packing' && !binOf(x.r)).flatMap((x) => {
    const done = x.view.units.map((u) => palletOf(x.r, x.r.units.indexOf(u) + 1, u.at, unitParts(s, x.r, u), u.po, u.by, false, u.note ?? ''))
    const o = x.r.endedAt ? null : x.r.extra?.open, last = o?.parts.length ? o.parts[o.parts.length - 1] : null
    const building = o && last && (!lot || o.parts.some((p) => p.lot === lot)) && (!shift || o.parts.some((p) => shiftAt(plan, p.at) === shift)) ? [palletOf(x.r, x.r.units.length + 1, last.at, o.parts, palletPo(s, x.r), last.by, true)] : []
    return [...done, ...building]
  }).sort((a, b) => a.at - b.at)
  // Packing's bins one by one, apart from its pallets (the office asked for them in their own list, 2026-10-17):
  // each with its lot, what it holds (platos, copas…) and the number written on it. With a lot chosen, the bins of that lot.
  const bins = rows.filter((x) => x.r.dept === 'Packing' && !!binOf(x.r)).flatMap((x) => x.view.units.map((u) => {
    const part = unitParts(s, x.r, u)[0]
    return { r: x.r, n: x.r.units.indexOf(u) + 1, at: u.at, word: binOf(x.r), qty: part?.qty ?? null, lot: part?.lot ?? x.r.lot, ref: u.ref, by: u.by, shift: shiftAt(plan, u.at) }
  })).sort((a, b) => a.at - b.at)
  // a code is a product; a run is a code on a line from its start to its end (the same code on two lines is two runs)
  const distinct = new Set(rows.map((x) => normCode(x.r.code))).size, lines = new Set(rows.map((x) => x.r.lineId)).size
  return { runs, rows, unitRows, pallets, bins, stops, byCode, byShift, byDept, reasons, distinct, lines, working: rows.reduce((t, x) => t + x.st.working, 0), down: rows.reduce((t, x) => t + x.st.down, 0), setup: setupOf(shift), codes, lots, code, lot, shift, plan, filtered, line, lineChoices }
}
/**
 * The Excel's (and the CSV's) first sheet, Resumen: one line per run of the report in view, typed (numbers, times,
 * spans) so Excel can sort and add them, and the run's comment in the last column, as it was typed (Jose, 2026-10-18:
 * comments on the records; last, so the columns the office already reads keep their places). It is made here and not
 * in the report's screen so that the checks read the very lines the file gets.
 */
export function runsSheet(s: State, rep: Report): Cell[][] {
  const T = (ms: number) => xTime(ms, fmtTime(ms)), D = (ms: number) => xDur(ms, fmtDur(ms))
  const reasons = (x: Report['rows'][number]) => Object.entries(x.st.reasons).map(([k, v]) => tr(k) + ' ' + fmtDur(v)).join(', ')
  return [[tr('Departamento'), tr('Línea'), tr('Código'), tr('Lote'), tr('Fecha'), tr('Inicio'), tr('Fin'), tr('Unidad'), tr('Hechas'), tr('Cantidad'), tr('Unidad de cantidad'), tr('Tags / bins'), tr('Waste (lb)'), tr('Tiempo trabajando'), tr('Promedio por unidad'), tr('Tiempo parado'), 'Set up', tr('Razones de paro'), tr('Registró'), tr('Turno'), tr('Comentario')],
    ...rep.rows.map((x): Cell[] => [x.r.dept, lineNameOf(s, x.r.lineId, x.r.line), x.r.code, x.lots, xDay(x.r.date), T(x.r.startedAt), x.r.endedAt ? T(x.r.endedAt) : tr('en curso'), cfgOf(x.r).unit, x.units, CFG[x.r.dept].qty !== 'none' ? x.qty : '', CFG[x.r.dept].qty !== 'none' ? cfgOf(x.r).qtyUnit : '', x.view.units.map((u) => u.ref).filter(Boolean).join(', '), x.waste || '', D(x.st.working), x.timed ? D(x.st.avg) : '', D(x.st.down), x.st.setup ? D(x.st.setup) : '', reasons(x), whoText(x.r), rep.shift ? String(rep.shift) : x.shifts, noteOf(x.r)])]
}
/**
 * The Excel's Pallets sheet: every lot of every pallet in view, the pallet's total, its PO and its place in it, and
 * last its comment (Jose, 2026-10-18: a comment on each pallet), on its first line; and the Unidades sheet, one line
 * per unit (a pallet with two lots, one per lot), each with the unit's comment last. Made here, as Resumen is, so
 * the checks read the very lines the file gets.
 */
export function palletsSheet(s: State, rep: Report): Cell[][] {
  const T = (ms: number) => xTime(ms, fmtTime(ms))
  return [[tr('Pallet'), tr('Línea'), tr('Código'), tr('Lote'), tr('Cajas'), tr('Tag'), tr('Total del pallet'), 'PO', tr('Pallet del PO'), tr('Hora'), tr('Turno'), tr('Registró'), tr('Comentario')],
    ...rep.pallets.flatMap((p) => p.parts.map((x, i): Cell[] => [p.n, lineNameOf(s, p.r.lineId, p.r.line), p.r.code, x.lot, x.qty ?? '', x.tag, i === 0 ? p.total : '', p.order, p.of ? (p.of[1] ? tr('pallet {0} de {1}', p.of[0], p.of[1]) : String(p.of[0])) : '', p.open ? tr('en armado') : T(p.at), p.shift, p.by, i === 0 ? p.note : '']))]
}
export function unitsSheet(s: State, rep: Report): Cell[][] {
  const T = (ms: number) => xTime(ms, fmtTime(ms)), D = (ms: number) => xDur(ms, fmtDur(ms))
  return [[tr('Departamento'), tr('Línea'), tr('Código'), tr('Lote'), '#', tr('Hora'), tr('Unidad'), tr('Cantidad'), tr('Unidad de cantidad'), tr('Tag / bin'), tr('Desde la anterior'), tr('Registró'), tr('Turno'), tr('Pedido'), tr('Comentario')],
    ...rep.unitRows.map((x): Cell[] => [x.r.dept, lineNameOf(s, x.r.lineId, x.r.line), x.r.code, x.lot, x.i + 1, T(x.u.at), cfgOf(x.r).unit, x.qty ?? '', x.qty != null ? cfgOf(x.r).qtyUnit : '', x.tag, D(x.gap), x.u.by, x.shift, x.order, x.u.note ?? ''])]
}
/** the words a filtered report carries in its title and in the name of its files */
export const filterTitle = (code: string, lot: string, shift: 0 | 1 | 2 = 0, line = '') => (shift ? ' ' + tr('· Turno {0}', shift) : '') + (line ? ' · ' + line : '') + (code ? ' ' + tr('· código {0}', code) : '') + (lot ? ' ' + tr('· lote {0}', lot) : '')
export const filterFile = (code: string, lot: string, shift: 0 | 1 | 2 = 0, line = '') => { const clean = (t: string) => t.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''); return (shift ? '-turno' + shift : '') + (line ? '-' + clean(line) : '') + (code ? '-cod-' + clean(code) : '') + (lot ? '-lote-' + clean(lot) : '') }

// ---- the report's search (2026-10-17: "un search bar para buscar algo en específico", one box for every room) ----
export type Report = ReturnType<typeof reportOf>
export type HitKind = 'code' | 'pallet' | 'bin' | 'unit' | 'run' | 'stop' | 'change'
/** one record the search found: what it is, its key in the tables, its room, its moment and what opens it */
export type Hit = { kind: HitKind; key: string; dept: Dept | null; at: number; runId?: string; unitAt?: number; stopId?: string; changeId?: string }
/** a whole query that names something the filters can hold: offered as a real filter, so the files follow it */
export type Scope = { kind: 'code' | 'lot' | 'line' | 'dept'; value: string }
/** the keys the report's tables and its search share, so a table keeps exactly the rows the search found */
export const hitKey = {
  code: (dept: Dept, code: string, bin: string) => 'code:' + dept + '|' + normCode(code) + '|' + bin,
  pallet: (runId: string, n: number) => 'pallet:' + runId + ':' + n,
  bin: (runId: string, n: number) => 'bin:' + runId + ':' + n,
  unit: (runId: string, i: number, lot: string) => 'unit:' + runId + ':' + i + ':' + lot,
  run: (id: string) => 'run:' + id,
  stop: (id: string) => 'stop:' + id,
  change: (id: string) => 'change:' + id,
}
/** the words of a text, without accents or capitals: "Línea 12" → ["linea", "12"] */
const wordsOf = (t: string) => plainText(t).split(/[^a-z0-9]+/).filter(Boolean)
/** "Turno 1", or "Turno 1" and "Turno 2" for something that touched both ("1 y 2") */
const shiftWords = (shifts: string | number) => [...String(shifts).matchAll(/[12]/g)].map((m) => tr('Turno {0}', m[0]))

/**
 * What the report in view holds that answers the query: every word typed must be in the record (in any field), so
 * "A100 6284" finds what carries both. A number of one or two digits is read as a whole word ("12" is pallet 12 or a
 * time at 12, never lot 6123), and a code typed with or without its zeros is the same code. Accents and capitals do
 * not matter, and a stop's cause is found in Spanish and in English on any device (the causes are data in Spanish).
 * The files never follow the search: only the filters, which a scope sets for real.
 */
export function searchReport(s: State, rep: Report, q: string, changes: Change[] = [], now: number = clockNow()): { hits: Hit[]; keys: Set<string>; scopes: Scope[] } {
  const toks = plainText(q).split(/\s+/).filter(Boolean)
  if (!toks.length) return { hits: [], keys: new Set(), scopes: [] }
  const codeToks = toks.map(normCode)
  const fits = (fields: unknown[], codes: string[] = []) => {
    const mine = codes.map(normCode)
    // the record's texts are made only when a word typed is not its code
    let texts: string[] | null = null
    const textsOf = () => (texts ??= fields.map((f) => plainText(String(f ?? ''))).filter(Boolean))
    return toks.every((t, i) => mine.includes(codeToks[i]) || (/^\d{1,2}$/.test(t) ? textsOf().some((x) => x.split(/[^a-z0-9]+/).includes(t)) : textsOf().some((x) => x.includes(t))))
  }
  // The product and line names, looked up once per search (as productOf and lineNameOf find them: the first one with
  // that code or id). Walking the product table and the lines for each record made a big day's search slow.
  const names = new Map<string, string>(), lineNames = new Map<string, string>()
  for (const p of s.products) { const k = normCode(p.code); if (!names.has(k)) names.set(k, p.name ?? '') }
  for (const l of s.lines) if (!lineNames.has(l.id)) lineNames.set(l.id, l.name)
  const product = (code: string) => names.get(normCode(code)) ?? ''
  const lineOf = (id: string | null, was = '') => lineLabel((id !== null ? lineNames.get(id) : '') || was)
  const line = (r: Run) => lineOf(r.lineId, r.line)
  const byAt = (a: Hit, b: Hit) => a.at - b.at
  const codes = rep.byCode.filter((c) => fits([c.code, product(c.code), c.dept, ...c.lots.map((l) => l.lot), ...c.lines], [c.code]))
    .map((c): Hit => ({ kind: 'code', key: hitKey.code(c.dept, c.code, c.bin), dept: c.dept, at: 0 }))
  const pallets = rep.pallets.filter((p) => fits([String(p.n), p.r.code, product(p.r.code), ...p.parts.flatMap((x) => [x.lot, x.tag]), p.order, line(p.r), p.by, p.open ? '' : fmtTime(p.at), ...shiftWords(p.shift), cfgOf(p.r).unit, p.r.dept, p.note], [p.r.code]))
    .map((p): Hit => ({ kind: 'pallet', key: hitKey.pallet(p.r.id, p.n), dept: p.r.dept, at: p.at, runId: p.r.id, unitAt: p.open ? undefined : p.at })).sort(byAt)
  const bins = rep.bins.filter((b) => fits([String(b.n), b.r.code, product(b.r.code), b.lot, b.ref, binWord(b.word), line(b.r), b.by, fmtTime(b.at), ...shiftWords(b.shift), cfgOf(b.r).unit, b.r.dept], [b.r.code]))
    .map((b): Hit => ({ kind: 'bin', key: hitKey.bin(b.r.id, b.n), dept: b.r.dept, at: b.at, runId: b.r.id, unitAt: b.at })).sort(byAt)
  const units = rep.unitRows.filter((x) => fits([String(x.i + 1), x.r.code, product(x.r.code), x.lot, x.tag, x.order, line(x.r), x.u.by, fmtTime(x.u.at), ...shiftWords(x.shift), cfgOf(x.r).unit, x.r.dept, x.u.note], [x.r.code]))
    .map((x): Hit => ({ kind: 'unit', key: hitKey.unit(x.r.id, x.i, x.lot), dept: x.r.dept, at: x.u.at, runId: x.r.id, unitAt: x.u.at })).sort(byAt)
  // (a run is found by its comment too: Jose, 2026-10-18)
  const runs = rep.rows.filter((x) => fits([x.r.code, product(x.r.code), x.lots, line(x.r), whoText(x.r), fmtTime(x.r.startedAt), ...Object.keys(x.st.reasons).flatMap((k) => [k, phrase(k, 'en')]), ...shiftWords(x.shifts), x.r.dept, noteOf(x.r)], [x.r.code]))
    .map((x): Hit => ({ kind: 'run', key: hitKey.run(x.r.id), dept: x.r.dept, at: x.r.startedAt, runId: x.r.id })).sort(byAt)
  const stops = rep.stops.filter((x) => fits([x.reason, phrase(x.reason, 'en'), noteLabel(x.note), x.note, x.lineId === null ? tr('Todo {0}', x.dept) : lineOf(x.lineId), x.by, fmtTime(x.startedAt), ...shiftWords(spanShifts(rep.plan, x.startedAt, x.endedAt ?? now)), x.dept]))
    .map((x): Hit => ({ kind: 'stop', key: hitKey.stop(x.id), dept: x.dept, at: x.startedAt, stopId: x.id })).sort(byAt)
  const done = changes.filter((c) => fits([c.what, c.by, c.before, c.after, c.dept, fmtTime(c.at)]))
    .map((c): Hit => ({ kind: 'change', key: hitKey.change(c.id), dept: c.dept, at: c.at, changeId: c.id })).sort(byAt)
  const hits = [...codes, ...pallets, ...bins, ...units, ...runs, ...stops, ...done]
  // the whole query, when it names a code, a lot, a line or a room of the day that is not the filter already
  const whole = q.trim(), said = wordsOf(whole).join(' ')
  const code = rep.codes.find((c) => normCode(c) === normCode(whole))
  const lot = rep.lots.find((l) => l === whole)
  const ln = rep.lineChoices.find((l) => wordsOf(l.name).join(' ') === said || wordsOf(l.dept + ' ' + l.name).join(' ') === said)
  const room = DEPTS.find((d) => plainText(d) === plainText(whole))
  const scopes: Scope[] = [
    ...(code && normCode(code) !== normCode(rep.code) ? [{ kind: 'code' as const, value: code }] : []),
    ...(lot && lot !== rep.lot ? [{ kind: 'lot' as const, value: lot }] : []),
    ...(ln && ln.id !== rep.line ? [{ kind: 'line' as const, value: ln.id }] : []),
    ...(room && !(rep.byDept.length === 1 && rep.byDept[0].dept === room) ? [{ kind: 'dept' as const, value: room }] : []),
  ].slice(0, 3)
  return { hits, keys: new Set(hits.map((h) => h.key)), scopes }
}
