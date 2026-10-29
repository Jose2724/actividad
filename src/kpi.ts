import { attExpectedOf, attOf, attSentAt, attShifts, attWriteOn, CFG, dayBefore, DEPTS, deptToday, entryClass, fmtTime, kpiGet, lbCaseOn, lbPerCaseOf, lunchOf, shiftsOf, weightTarget, weightTestsOf, type WeightTest, wtWeights, type AttEntry, type Dept, type State } from './store'
import { reportOf } from './report'
import { X, xDay, xN, xT, type Cell, type Sheet } from './xlsx'
import { tr } from './i18n'

/**
 * The Daily KPI Report (2026-10-22): the COO's "New Expectations - Daily KPI Reporting" for East Rutherford, built for
 * Jose and Edgar (Edgar: "Yes this is what I need · ER · ready 0700 · to Skip"). Five parts: item weights, cuts /
 * shorts, labor productivity, the Costco MVM tracker and grill & fryer. This file works out what Actividad already
 * knows: the Costco tracker (the plan from Yasbelth's planner, the actual from the 0889 runs) and the labor
 * productivity (the attendance and each room's production). Weights wait for QA's targets, cuts for Julio's orders.
 */
export const COSTCO_CODE = '0889'
export const KPI_PARTS = ['weights', 'cuts', 'labor', 'costco', 'grill'] as const
export type KpiPart = (typeof KPI_PARTS)[number]

// ---- who sees it ----
const plainName = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
/** the names (besides the admin) who see the report: the admin writes them (Edgar) */
export const kpiNames = (s: State): string[] => { const v = kpiGet(s, 'access')?.data.names; return Array.isArray(v) ? v.map(String).filter(Boolean) : [] }
export const seesKpi = (s: State, admin: boolean, name: string) => admin || kpiNames(s).some((n) => plainName(n) === plainName(name))
/**
 * who has the hour each person came and the lunch rule (Jose, 2026-10-29: "publicarlo solo para mí y después activárselo
 * a los demás o elegir a quién"): the admin always; everybody once 'all' is on; otherwise the names of the list (key
 * 'labor-access', as the report's own list)
 */
export const laborAccess = (s: State) => { const d = kpiGet(s, 'labor-access')?.data; return { all: d?.all === true, names: Array.isArray(d?.names) ? d.names.map(String).filter(Boolean) : [] } }
export const seesLabor = (s: State, admin: boolean, name: string) => { const a = laborAccess(s); return admin || a.all || a.names.some((n) => plainName(n) === plainName(name)) }

// ---- the Costco MVM plan (Yasbelth's "MVM Costco Planner", exported as CSV) ----
export type CostcoPlan = { code: string; perMix: number; days: Record<string, { mixes: number; cases: number }>; forecast: Record<string, number>; file: string }
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const monthOf = (t: string) => MONTHS.indexOf(t.trim().toLowerCase())
const num = (t: string | undefined) => { const x = Number(String(t ?? '').replace(/[,\s]/g, '')); return Number.isFinite(x) ? x : 0 }
const pad = (n: number) => String(n).padStart(2, '0')
/** a CSV as rows of cells (quotes, commas inside quotes, either line end) */
export function csvCells(text: string): string[][] {
  const src = text.replace(/^﻿/, ''), rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (q) { if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}
/**
 * Yasbelth's planner read from its CSV: a row of month names (August, September…) each over four columns (Day, Mixes,
 * Cases, Actual cs), the days under it until "Total", and a "Forecast" row with each month's cases. The year comes from
 * the title ("November 2026 - January 2027": the last year is the last month's, a month after a later one is the year
 * before). Only the planned days (mixes or cases) are kept; the actual is never read: Actividad has it.
 * A text = what is wrong with the file
 */
export function parsePlanner(text: string, file = ''): CostcoPlan | string {
  const rows = csvCells(text)
  // the months row right above "Day, Mixes, Cases" (the real planner has another months row higher up, over the
  // batches by weekday: 2026-10-26)
  const head = rows.findIndex((r, i) => r.filter((c) => monthOf(c) >= 0).length >= 2 && /^day$/i.test((rows[i + 1]?.[0] ?? '').trim()))
  if (head < 0) return 'No se encontró la tabla de días (los meses y "Day, Mixes, Cases").'
  const blocks = rows[head].map((c, col) => ({ m: monthOf(c), col })).filter((b) => b.m >= 0)
  const years = rows.slice(0, head).join(' ').match(/\b20\d\d\b/g)
  let y = years ? Number(years[years.length - 1]) : new Date().getFullYear()
  const yearOf: number[] = []
  for (let i = blocks.length - 1; i >= 0; i--) { if (i < blocks.length - 1 && blocks[i].m > blocks[i + 1].m) y--; yearOf[i] = y }
  const days: CostcoPlan['days'] = {}, forecast: CostcoPlan['forecast'] = {}
  let ratio = 0
  for (let r = head + 2; r < rows.length; r++) {
    const row = rows[r], first = (row[0] ?? '').trim().toLowerCase()
    if (first === 'forecast') { blocks.forEach((b, i) => { const v = num(row[b.col + 2]); if (v > 0) forecast[yearOf[i] + '-' + pad(b.m + 1)] = v }); break }
    if (first === 'total') continue
    blocks.forEach((b, i) => {
      const d = Math.round(num(row[b.col])), mixes = num(row[b.col + 1]), cases = num(row[b.col + 2])
      const last = new Date(yearOf[i], b.m + 1, 0).getDate()
      if (d < 1 || d > last || (mixes <= 0 && cases <= 0)) return
      days[yearOf[i] + '-' + pad(b.m + 1) + '-' + pad(d)] = { mixes, cases }
      if (!ratio && mixes > 0 && cases > 0) ratio = cases / mixes
    })
  }
  if (!Object.keys(days).length) return 'El archivo no tiene días con mezclas planeadas.'
  return { code: COSTCO_CODE, perMix: Math.round(ratio * 100) / 100 || 18, days, forecast, file }
}
export const costcoPlan = (s: State): (CostcoPlan & { by: string; at: number }) | null => {
  const r = kpiGet(s, 'plan:' + COSTCO_CODE)
  if (!r || typeof r.data.days !== 'object' || !r.data.days) return null
  return { ...(r.data as unknown as CostcoPlan), by: r.by, at: r.at }
}

// ---- the Costco tracker ----
/** one day of 0889: what was planned (mixes, cases) and what was made (Spiral's mixes, Packing's cases) */
export function costcoDay(s: State, date: string, now: number) {
  const plan = costcoPlan(s)?.days[date] ?? null
  const rep = reportOf(s, date, now, { code: COSTCO_CODE })
  const pack = rep.byDept.find((d) => d.dept === 'Packing'), spiral = rep.byDept.find((d) => d.dept === 'Spiral')
  const cases = pack ? pack.qty : 0, mixes = spiral ? spiral.units : 0
  return { date, planMixes: plan?.mixes ?? 0, planCases: plan?.cases ?? 0, mixes, cases, diff: cases - (plan?.cases ?? 0), pct: plan?.cases ? cases / plan.cases : null }
}
const datesFromTo = (a: string, b: string) => { const out: string[] = []; for (let d = b; d >= a; d = dayBefore(d)) out.unshift(d); return out }
/**
 * the month of a day for 0889: the plan and the actual up to that day, the plan of the whole month, and the cases a
 * day it needs from the next day on to still meet the month's plan (over the planned days left)
 */
export function costcoMonth(s: State, date: string, now: number) {
  const plan = costcoPlan(s), first = date.slice(0, 8) + '01'
  const sofar = datesFromTo(first, date).map((d) => costcoDay(s, d, now))
  const monthPlan = plan ? Object.entries(plan.days).filter(([d]) => d.slice(0, 7) === date.slice(0, 7)).reduce((t, [, v]) => t + v.cases, 0) : 0
  const left = plan ? Object.entries(plan.days).filter(([d, v]) => d.slice(0, 7) === date.slice(0, 7) && d > date && v.cases > 0).length : 0
  const planToDate = sofar.reduce((t, x) => t + x.planCases, 0), actualToDate = sofar.reduce((t, x) => t + x.cases, 0)
  const need = monthPlan - actualToDate
  return { days: sofar, monthPlan, planToDate, actualToDate, gap: actualToDate - planToDate, pct: planToDate ? actualToDate / planToDate : null, left, perDay: left > 0 ? Math.max(0, Math.ceil(need / left)) : null, forecast: plan?.forecast[date.slice(0, 7)] ?? null }
}
/** the last n days up to a day, for the chart */
export const costcoLast = (s: State, date: string, now: number, n = 7) => { const out = []; for (let d = date, i = 0; i < n; i++, d = dayBefore(d)) out.unshift(costcoDay(s, d, now)); return out }

// ---- labor productivity ----
/**
 * a shift's working hours on a day (its start to its end as Ajustes sets them, 6:00 AM to 3:00 PM), not the cut between
 * the shifts: what a person on it works. The 2nd shift's end after midnight is the next day
 */
export function workSpan(s: State, date: string, dept: Dept, k: 1 | 2) {
  const h = shiftsOf(s, date, dept), d0 = new Date(date + 'T00:00:00').getTime()
  const min = (t: string) => { const [a, b] = String(t).split(':').map(Number); return (a || 0) * 60 + (b || 0) }
  const [a, b] = k === 1 ? [h.first, h.firstEnd] : [h.second, h.secondEnd]
  let from = d0 + min(a) * 60_000, to = d0 + min(b) * 60_000
  if (k === 2 && min(h.second) < min(h.first)) { from += 86_400_000; to += 86_400_000 }
  if (to <= from) to += 86_400_000
  return { from, to }
}
/**
 * the hours a person worked in the room on a shift: from the shift's start, or from when they came (the hour the
 * supervisor wrote, when they were written if the plant says so, or when another room sent them), to its end, when they left, or now; the plant's lunch taken away
 * from whoever stayed long enough for it (Ajustes: lunchOf)
 */
export function hoursOf(s: State, x: AttEntry, now: number) {
  const w = workSpan(s, x.date, x.dept, x.shift)
  // sent from another room: from then (written here by hand too); the hour they came, or when written when that switch is on
  const from = Math.max(w.from, x.via || x.from ? x.at : attSentAt(s, x), x.came ?? (attWriteOn(s) ? x.at : 0))
  const to = Math.min(x.gone ? x.gone.at : w.to, now)
  const h = Math.max(0, to - from) / 3_600_000, l = lunchOf(s)
  return l.min > 0 && h >= l.after ? Math.max(0, h - l.min / 60) : h
}
/** an hour written as "6:45" on a person's shift, as a time: the one inside the shift (or nearest to it), on its day or the next */
export function hourOnShift(s: State, x: AttEntry, hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim())
  if (!m || +m[1] > 23 || +m[2] > 59) return null
  const w = workSpan(s, x.date, x.dept, x.shift), d0 = new Date(x.date + 'T00:00:00').getTime()
  const at = (days: number) => { const d = new Date(d0 + days * 86_400_000); d.setHours(+m[1], +m[2], 0, 0); return d.getTime() }
  const off = (t: number) => (t < w.from ? w.from - t : t > w.to ? t - w.to : 0)
  return [at(0), at(1)].sort((p, q) => off(p) - off(q))[0]
}
/**
 * Each room's people and production of a day: scheduled (the people expected), who showed up (written and still
 * there, or there until they left), the temps among them, the labor hours, what the room made (in its own unit) and
 * that per labor hour. The plant's line counts Packing's cases over every room's hours
 */
export function laborOf(s: State, date: string, now: number) {
  const rep = reportOf(s, date, now)
  const rows = DEPTS.map((dept: Dept) => {
    const shifts = attShifts(s, date), people = shifts.flatMap((k) => attOf(s, date, dept, k))
    const scheduled = shifts.reduce((t, k) => t + attExpectedOf(s, dept, k), 0)
    // who came: everyone written here, but one sent to another room counts there (their hours here still count here)
    const showed = people.filter((x) => x.gone?.why !== 'otro').length
    const present = people.filter((x) => !x.gone).length
    const temps = people.filter((x) => x.temp && x.gone?.why !== 'otro').length
    const hours = Math.round(people.reduce((t, x) => t + hoursOf(s, x, now), 0) * 10) / 10
    const d = rep.byDept.find((y) => y.dept === dept), cfg = CFG[dept], q = cfg.qty !== 'none'
    const made = d ? (q ? d.qty : d.units) : 0, unit = q ? cfg.qtyUnit : cfg.plural.toLowerCase()
    // Packing's cases in pounds too (QA's pounds per case; Jose, 2026-10-28), when the switch is on: the codes with no pounds are counted apart
    const byCode = dept === 'Packing' && lbCaseOn(s) ? deptToday(s, dept, date, now).byCode : null
    const lb = byCode ? Math.round(byCode.reduce((t, c) => t + c.qty * lbPerCaseOf(s, c.code), 0) * 10) / 10 : null
    const lbMissing = byCode ? byCode.filter((c) => c.qty > 0 && !lbPerCaseOf(s, c.code)).map((c) => c.code) : []
    return { dept, scheduled, showed, present, temps, hours, made, unit, perHour: hours > 0 ? Math.round((made / hours) * 100) / 100 : null, written: people.length > 0, lb, lbMissing }
  })
  const hours = Math.round(rows.reduce((t, r) => t + r.hours, 0) * 10) / 10
  const cases = rows.find((r) => r.dept === 'Packing')?.made ?? 0
  const lb = rows.find((r) => r.dept === 'Packing')?.lb ?? null, lbMissing = rows.find((r) => r.dept === 'Packing')?.lbMissing ?? []
  return { rows, total: { lb, lbMissing, lbPerHour: lb != null && hours > 0 ? Math.round((lb / hours) * 100) / 100 : null, scheduled: rows.reduce((t, r) => t + r.scheduled, 0), showed: rows.reduce((t, r) => t + r.showed, 0), temps: rows.reduce((t, r) => t + r.temps, 0), hours, cases, perHour: hours > 0 ? Math.round((cases / hours) * 100) / 100 : null, written: rows.some((r) => r.written) } }
}

// ---- item weights ----
/** each code's weight tests of a day: how many tests and pouches, average, lightest, heaviest, its target, under and over */
export function weightsOf(s: State, date: string) {
  // (each code and what was weighed: RTE's pouches, Spiral's meatballs, 2026-10-23)
  const tests = weightTestsOf(s, date), keys = [...new Set(tests.map((t) => t.code + '|' + t.kind))]
  return keys.map((k) => {
    const [code, kind] = k.split('|') as [string, WeightTest['kind']]
    // checked = every pouch (a weight, a call, or both); weighed = the ones with a weight (the average, min and max)
    const mine = tests.filter((t) => t.code === code && t.kind === kind), entries = mine.flatMap((t) => t.entries), all = mine.flatMap(wtWeights), target = weightTarget(s, code, kind)
    const avg = all.length ? all.reduce((a, b) => a + b, 0) / all.length : null
    return { code, kind, tests: mine, checked: entries.length, n: all.length, avg: avg == null ? null : Math.round(avg * 1000) / 1000, min: all.length ? Math.min(...all) : null, max: all.length ? Math.max(...all) : null, target, under: entries.filter((e) => entryClass(e, target) === 'bajo').length, over: entries.filter((e) => entryClass(e, target) === 'sobre').length, avgPct: target && avg != null ? (avg - target.pouch) / target.pouch : null }
  })
}

// ---- the notes of a day ----
export const kpiNote = (s: State, date: string, part: KpiPart) => String(kpiGet(s, 'note:' + date + ':' + part)?.data.text ?? '')

// ---- the Excel of the report (Jose, 2026-10-27: "el excel bonito con colores y gráficas") ----
const n0 = (x: number) => Math.round(x).toLocaleString('en-US')
const pc = (x: number | null) => (x == null ? '—' : Math.round(x * 1000) / 10 + '%')
const headRow = (...t: string[]): Cell[] => t.map((x) => xT(x, X.head))
const signed = (v: number): Cell => xN(v, v < 0 ? X.nBad : v > 0 ? X.nGood : X.n)
const pct1 = (x: number | null): Cell => (x == null ? '' : { v: Math.round(x * 1000) / 1000, s: X.pct1, t: pc(x) })
/**
 * One sheet per part, a purple header row, the numbers as numbers with thousands, red / green / amber by what they say,
 * each part's note in a wrapped cell, and two charts Excel draws itself: Costco's planned vs made cases by day, and the
 * cases per person-hour by room.
 */
export function kpiSheets(s: State, date: string, now: number): Sheet[] {
  const notes = (p: KpiPart) => xT(kpiNote(s, date, p), X.note)
  const mo = costcoMonth(s, date, now), last = costcoLast(s, date, now, 7), lab = laborOf(s, date, now), day = last[last.length - 1], wts = weightsOf(s, date)
  const outW = wts.reduce((t, w) => t + w.under + w.over, 0), allW = wts.reduce((t, w) => t + w.checked, 0)
  const head: Cell[][] = [[xT(tr('E.R. - Ops Summary'), X.title), xDay(date)], []]
  const wState = !allW ? X.label : outW / allW > 0.1 ? X.bad : outW ? X.warn : X.good
  const cState = day.pct == null ? X.label : day.pct < 0.9 ? X.bad : day.pct < 1 ? X.warn : X.good
  const resumen: Cell[][] = [...head, headRow(tr('Parte'), tr('Resultado'), tr('Qué vimos · causa · acción')),
    [xT(tr('1 · Pesos'), X.label), xT(allW ? tr('{0} de {1} pouches fuera de peso', outW, allW) : tr('Sin pruebas de peso'), wState), notes('weights')],
    [xT(tr('2 · Cortes'), X.label), xT(tr('Esperando los pedidos de Julio'), X.label), notes('cuts')],
    [xT(tr('3 · Productividad'), X.label), xT(lab.total.perHour == null ? '—' : tr('{0} cajas por hora-persona', lab.total.perHour) + (lab.total.lbPerHour != null ? ' · ' + tr('{0} lb por hora-persona', lab.total.lbPerHour) : ''), X.label), notes('labor')],
    [xT(tr('4 · Costco MVM'), X.label), xT(tr('{0} cajas de {1} planeadas ({2})', n0(day.cases), n0(day.planCases), pc(day.pct)), cState), notes('costco')],
    [xT(tr('5 · Grill y freidora'), X.label), xT(tr('Sus hojas de siempre'), X.label), notes('grill')]]
  const costco: Cell[][] = [...head, headRow(tr('Fecha'), tr('Mezclas planeadas'), tr('Mezclas (Spiral)'), tr('Cajas planeadas'), tr('Cajas (Packing)'), tr('Diferencia'), tr('% del plan')),
    ...last.map((x): Cell[] => [xDay(x.date), xN(x.planMixes), xN(x.mixes), xN(x.planCases), xN(x.cases), signed(x.diff), pct1(x.pct)]),
    [], [xT(tr('Plan del mes'), X.label), xN(mo.monthPlan, X.nLabel)], [xT(tr('Plan hasta este día'), X.label), xN(mo.planToDate, X.nLabel)], [xT(tr('Hecho hasta este día'), X.label), xN(mo.actualToDate, X.nLabel)],
    [xT(tr('Diferencia'), X.label), signed(mo.gap)], [xT(tr('Necesario por día para cumplir el mes'), X.label), mo.perDay == null ? '' : xN(mo.perDay, X.nLabel)], [xT(tr('Forecast de Costco del mes'), X.label), mo.forecast == null ? '' : xN(mo.forecast, X.nLabel)],
    [], [notes('costco')]]
  const lbCols = lab.total.lb != null
  const labor: Cell[][] = [...head, headRow(tr('Cuarto'), tr('Programados'), tr('Vinieron'), tr('Temporales'), tr('Horas-persona'), tr('Producción'), tr('Unidad'), tr('Por hora-persona'), ...(lbCols ? [tr('Libras'), tr('Lb por hora-persona')] : [])),
    ...lab.rows.map((r): Cell[] => [r.dept, xN(r.scheduled), xN(r.showed), xN(r.temps), xN(r.hours, X.dec), xN(r.made), r.unit, r.perHour == null ? '' : xN(r.perHour, X.dec), ...(lbCols ? [r.lb == null ? '' : xN(r.lb, X.dec), r.lb == null || r.hours <= 0 ? '' : xN(Math.round((r.lb / r.hours) * 100) / 100, X.dec)] : [])]),
    [xT(tr('TOTAL'), X.label), xN(lab.total.scheduled, X.nLabel), xN(lab.total.showed, X.nLabel), xN(lab.total.temps, X.nLabel), xN(lab.total.hours, X.nLabel), xN(lab.total.cases, X.nLabel), xT(tr('cajas'), X.label), lab.total.perHour == null ? '' : xN(lab.total.perHour, X.nLabel), ...(lbCols ? [xN(lab.total.lb ?? 0, X.nLabel), lab.total.lbPerHour == null ? '' : xN(lab.total.lbPerHour, X.nLabel)] : [])],
    [], [notes('labor')]]
  const pesos: Cell[][] = [...head, headRow(tr('Hora'), tr('Línea'), tr('Código'), tr('Lote'), tr('Revisados'), tr('Pesados'), tr('Promedio (oz)'), tr('Mínimo'), tr('Máximo'), tr('Objetivo (oz)'), tr('Bajos'), tr('Sobre'), tr('Anotó'), tr('Cada pouch')),
    ...wts.flatMap((w) => w.tests.map((t): Cell[] => {
      const ws = wtWeights(t), avg = ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : null
      const under = t.entries.filter((e) => entryClass(e, w.target) === 'bajo').length, over = t.entries.filter((e) => entryClass(e, w.target) === 'sobre').length
      return [fmtTime(t.at), t.line, t.code, t.lot, xN(t.entries.length), xN(ws.length), avg == null ? '' : xN(Math.round(avg * 1000) / 1000, X.dec), ws.length ? xN(Math.min(...ws), X.dec) : '', ws.length ? xN(Math.max(...ws), X.dec) : '', w.target ? w.target.pouch + ' ± ' + w.target.tol : '', xN(under, under ? X.nBad : X.n), xN(over, over ? X.nWarn : X.n), t.by, xT(t.entries.map((e) => (e.w != null ? String(e.w) : '') + (e.k === 'sobre' ? ' ▲' : e.k === 'bajo' ? ' ▼' : '')).join(', '), X.note)]
    })), [], [notes('weights')]]
  const n = last.length, nl = lab.rows.length
  return [
    { name: tr('Resumen'), rows: resumen, freeze: 3 },
    { name: tr('Pesos'), rows: pesos, freeze: 3 },
    { name: tr('Cortes'), rows: [...head, [xT(tr('Esperando los pedidos de Julio'), X.label)], [notes('cuts')]], freeze: 0 },
    { name: tr('Productividad'), rows: labor, freeze: 3, chart: nl ? { title: tr('Cajas por hora-persona'), series: tr('Por hora-persona'), cat: 0, val: 7, from: 4, to: 3 + nl, at: 3 + nl + 4, cols: 8 } : undefined },
    { name: 'Costco MVM', rows: costco, freeze: 3, chart: n ? { title: tr('Costco 0889 · cajas planeadas vs hechas'), series: [tr('Cajas planeadas'), tr('Cajas (Packing)')], cat: 0, val: [3, 4], from: 4, to: 3 + n, at: 3 + n + 10, kind: 'col', cols: 8 } : undefined },
    { name: tr('Grill y freidora'), rows: [...head, [notes('grill')]], freeze: 0 },
  ]
}

