import { CFG, dayOf, lineNameOf, normCode, runStats, SETUP_MAX_MS, unitQty, type Dept, type Run, type State, type Unit } from './store'

/**
 * The day's report, as the tables on screen and in every file made from them (Excel, CSV, PDF): one place decides
 * what is in it, so a filter by code or by lot gives the same answer everywhere.
 */
export type ReportFilter = { only?: Dept; code?: string; lot?: string }

/** the lots a unit carries: the ones written on it (a pallet with cases of two lots), or the run's lot with all of it */
export function unitParts(s: State, r: Run, u: Unit): { lot: string; qty: number | null }[] {
  if (u.lots?.length) return u.lots.map((l) => ({ lot: l.lot, qty: l.qty }))
  return [{ lot: r.lot, qty: CFG[r.dept].qty === 'none' ? null : unitQty(s, r, u) }]
}
/** every lot a run has touched */
const runLots = (s: State, r: Run) => new Set(r.units.length ? r.units.flatMap((u) => unitParts(s, r, u).map((p) => p.lot)) : [r.lot])

export function reportOf(s: State, date: string, now: number, f: ReportFilter = {}) {
  const day = s.runs.filter((r) => r.date === date && (!f.only || r.dept === f.only)).sort((a, b) => a.startedAt - b.startedAt)
  // what this day offers to filter by
  const codes = [...new Map(day.map((r) => [normCode(r.code), r.code])).values()].sort()
  const lots = [...new Set(day.flatMap((r) => [...runLots(s, r)]))].filter(Boolean).sort()
  // a filter the day does not have (the date was changed) is no filter
  const code = f.code ? codes.find((c) => normCode(c) === normCode(f.code ?? '')) ?? '' : ''
  const lot = f.lot && lots.includes(f.lot) ? f.lot : ''
  const filtered = !!code || !!lot
  const runs = day.filter((r) => (!code || normCode(r.code) === normCode(code)) && (!lot || runLots(s, r).has(lot)))
  const rows = runs.map((r) => {
    const st = runStats(s, r, now)
    // with a lot chosen, only the units (and the part of each) that belong to it
    const parts = r.units.map((u, i) => ({ u, i, all: unitParts(s, r, u) })).map((x) => ({ ...x, kept: x.all.filter((p) => !lot || p.lot === lot) })).filter((x) => x.kept.length)
    const view: Run = lot ? { ...r, units: parts.map((x) => x.u) } : r
    const qty = lot ? parts.reduce((t, x) => t + x.kept.reduce((a, p) => a + (p.qty ?? 0), 0), 0) : st.qty
    // the lots this line of the report is about: the one chosen, or every lot the run has touched
    return { r, st, view, units: view.units.length, qty, parts, lots: lot || [...runLots(s, r)].filter(Boolean).join(', ') }
  })
  // one line per unit; a pallet with two lots gives two lines, each with its lot and its cases
  const unitRows = rows.flatMap((x) => x.parts.flatMap(({ u, i, all, kept }) => kept.map((p) => ({ r: x.r, i, u, lot: p.lot, qty: p.qty, gap: x.st.unitTimes[i] ?? 0, mixed: all.length > 1 })))).sort((a, b) => a.u.at - b.u.at)
  // (a set up nobody closed, on a line that never started another code, stops being one after some hours)
  const stale = (x: (typeof s.stops)[number]) => !x.endedAt && x.lineId !== null && now - x.startedAt > SETUP_MAX_MS && !s.runs.some((r) => r.lineId === x.lineId && !r.endedAt)
  const dayStops = s.stops.filter((x) => dayOf(x.startedAt) === date && (!f.only || x.dept === f.only) && !stale(x)).sort((a, b) => a.startedAt - b.startedAt)
  // with a filter, the stops that happened while those runs were on their lines
  const stops = filtered ? dayStops.filter((x) => runs.some((r) => x.dept === r.dept && (x.lineId === r.lineId || x.lineId === null) && x.startedAt < (r.endedAt ?? now) && (x.endedAt ?? now) > r.startedAt)) : dayStops
  // the same code on several lines of a room, added up
  const byCode = [...rows.reduce((m, x) => {
    const k = x.r.dept + '|' + normCode(x.r.code)
    const e = m.get(k) ?? { dept: x.r.dept, code: x.r.code, units: 0, qty: 0, waste: 0, lines: [] as string[] }
    e.units += x.units; e.qty += x.qty; e.waste += x.r.waste
    const line = lineNameOf(s, x.r.lineId, x.r.line)
    if (!e.lines.includes(line)) e.lines.push(line)
    return m.set(k, e)
  }, new Map<string, { dept: Dept; code: string; units: number; qty: number; waste: number; lines: string[] }>()).values()]
  return { runs, rows, unitRows, stops, byCode, working: rows.reduce((t, x) => t + x.st.working, 0), down: rows.reduce((t, x) => t + x.st.down, 0), codes, lots, code, lot, filtered }
}
/** the words a filtered report carries in its title and in the name of its files */
export const filterTitle = (code: string, lot: string) => (code ? ' · código ' + code : '') + (lot ? ' · lote ' + lot : '')
export const filterFile = (code: string, lot: string) => { const clean = (t: string) => t.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''); return (code ? '-cod-' + clean(code) : '') + (lot ? '-lote-' + clean(lot) : '') }
