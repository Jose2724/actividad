import { attExpectedOf, attOf, attShifts, CFG, dayBefore, DEPTS, kpiGet, shiftsOf, type AttEntry, type Dept, type State } from './store'
import { reportOf } from './report'

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
  const head = rows.findIndex((r) => r.filter((c) => monthOf(c) >= 0).length >= 2)
  if (head < 0 || !/^day$/i.test((rows[head + 1]?.[0] ?? '').trim())) return 'No se encontró la tabla de días (los meses y "Day, Mixes, Cases").'
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
/** the hours a person was in the room on a shift: from the shift's start (or when they came) to its end, when they left, or now */
function hoursOf(s: State, x: AttEntry, now: number) {
  const w = workSpan(s, x.date, x.dept, x.shift)
  const from = x.via || x.from ? Math.max(w.from, x.at) : w.from
  const to = Math.min(x.gone ? x.gone.at : w.to, now)
  return Math.max(0, to - from) / 3_600_000
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
    return { dept, scheduled, showed, present, temps, hours, made, unit, perHour: hours > 0 ? Math.round((made / hours) * 100) / 100 : null, written: people.length > 0 }
  })
  const hours = Math.round(rows.reduce((t, r) => t + r.hours, 0) * 10) / 10
  const cases = rows.find((r) => r.dept === 'Packing')?.made ?? 0
  return { rows, total: { scheduled: rows.reduce((t, r) => t + r.scheduled, 0), showed: rows.reduce((t, r) => t + r.showed, 0), temps: rows.reduce((t, r) => t + r.temps, 0), hours, cases, perHour: hours > 0 ? Math.round((cases / hours) * 100) / 100 : null, written: rows.some((r) => r.written) } }
}

// ---- the notes of a day ----
export const kpiNote = (s: State, date: string, part: KpiPart) => String(kpiGet(s, 'note:' + date + ':' + part)?.data.text ?? '')
