import { WT_ASKED_CODES, wtOfficial, wtPicksCode, wtRange, attExpectedOf, attOf, attSentAt, attShifts, attWriteOn, CFG, cookText, dayBefore, DEPTS, deptToday, entryClass, fmtTime, kpiGet, lbCaseOn, lbPerCaseOf, lunchOf, normCode, sameStep, shiftAt, shiftsOf, stepKey, stepText, weighedCodes, weighsCode, weightAllStepsOf, weightRuleFor, weightStepsFor, weightTarget, wtRangeText, type Cook, type WeightTest, type WtStep, type AttEntry, type Dept, type State } from './store'
import { reportOf } from './report'
import { colName, X, xDay, xN, xT, type Cell, type Sheet } from './xlsx'
import { locale, tr } from './i18n'

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
/** what a set of entries says against a target: how many checked and weighed, average, lightest, heaviest, under, over, in weight */
export function wtSum(entries: WeightTest['entries'], target: ReturnType<typeof weightTarget>) {
  const ws = entries.flatMap((e) => (e.w != null ? [e.w] : [])), avg = ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : null
  const under = entries.filter((e) => entryClass(e, target) === 'bajo').length, over = entries.filter((e) => entryClass(e, target) === 'sobre').length
  // (in weight said too, Jose 2026-10-29: "el que sale en el rango de bueno no se está apuntando")
  const good = entries.filter((e) => entryClass(e, target) === 'ok').length
  return { checked: entries.length, n: ws.length, avg: avg == null ? null : Math.round(avg * 1000) / 1000, min: ws.length ? Math.min(...ws) : null, max: ws.length ? Math.max(...ws) : null, good, under, over,
    okPct: target && entries.length ? (entries.length - under - over) / entries.length : null, avgPct: target && avg != null ? (avg - target.pouch) / target.pouch : null }
}
/**
 * the tests a step of a code was due that day (2026-10-29: "every hour ... siempre y cuando se está haciendo este código"):
 * one for each whole stretch of the room's time the code ran, run by run (a code of 2 h 40 min: 2); null = nothing due
 * (no rule, or a code the room does not weigh every hour)
 */
export function weightsDue(s: State, date: string, dept: Dept, code: string, now: number): number | null {
  const rule = weightRuleFor(s, dept, code)
  if (date < wtCountedFrom(s) || !rule.every || !weighsCode(s, dept, code)) return null
  const span = rule.every * 60_000
  return s.runs.filter((r) => !r.deleted && r.date === date && r.dept === dept && normCode(r.code) === normCode(code)).reduce((t, r) => t + Math.floor(Math.max(0, Math.min(r.endedAt ?? now, now) - r.startedAt) / span), 0)
}
/** complete = as many weights as the room's count (or more); short = a test left with fewer */
/**
 * the first work day the tests due are counted (2026-10-30, the first whole day with the hourly tests of 2026-10-29):
 * the days before had other rules (Spiral 8 balls, RTE no hourly test) and are not judged by these
 */
export const WT_COUNTED_FROM = '2026-10-30'
/** the day the count starts: WT_COUNTED_FROM, or another an admin keeps in the report's records ('wt-from') */
export const wtCountedFrom = (s: State) => { const d = String(kpiGet(s, 'wt-from')?.data.date ?? ''); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : WT_COUNTED_FROM }
export type WtRow = ReturnType<typeof wtSum> & { dept: Dept; code: string; kind: WeightTest['kind']; cook?: Cook; label: string; tests: WeightTest[]; skipped: WeightTest[]; complete: number; short: number; due: number | null; target: ReturnType<typeof weightTarget> }
/**
 * each room, code and what was weighed of a day (RTE's pouches; Spiral's balls raw and cooked, by cooker; Kitchen's raw
 * balls): the tests made against those due, the weights and what they say. 0889 and 889 are one code. A code a room
 * weighs every hour that ran with no test at all still has its row (0 of N): the report says what was missed
 */
export function weightsOf(s: State, date: string, now = Date.now()): WtRow[] {
  const all = (s.weights ?? []).filter((x) => !x.deleted && x.date === date && (x.entries.length > 0 || x.skip))
  const groups = new Map<string, { dept: Dept; code: string; step: WtStep }>()
  const key = (dept: Dept, code: string, st: WtStep) => dept + '|' + normCode(code) + '|' + stepKey(st)
  for (const t of [...all].sort((a, b) => a.at - b.at)) { const k = key(t.dept, t.code, t); if (!groups.has(k)) groups.set(k, { dept: t.dept, code: t.code, step: { kind: t.kind, ...(t.cook ? { cook: t.cook } : {}) } }) }
  for (const r of s.runs) {
    if (r.deleted || r.date !== date || !weighedCodes(s, r.dept) || !weighsCode(s, r.dept, r.code) || wtPicksCode(r.dept, r.code)) continue
    for (const st of weightStepsFor(s, r.dept, r.code)) { const k = key(r.dept, r.code, st); if (!groups.has(k)) groups.set(k, { dept: r.dept, code: r.code, step: st }) }
  }
  const order = (g: { dept: Dept; code: string; step: WtStep }) => [DEPTS.indexOf(g.dept), weightAllStepsOf(g.dept).findIndex((x) => sameStep(x, g.step))] as const
  return [...groups.values()].sort((a, b) => order(a)[0] - order(b)[0] || normCode(a.code).localeCompare(normCode(b.code), 'en', { numeric: true }) || order(a)[1] - order(b)[1]).map((g): WtRow => {
    const mine = all.filter((t) => t.dept === g.dept && normCode(t.code) === normCode(g.code) && sameStep(t, g.step)).sort((a, b) => a.at - b.at)
    const tests = mine.filter((t) => t.entries.length > 0), target = weightTarget(s, g.code, g.step.kind, g.step.cook), count = weightRuleFor(s, g.dept, g.code).count
    // (a test is complete with as many weights as were asked when it was made; one of before that kept no count, as it was)
    const complete = tests.filter((t) => t.entries.length >= (t.need ?? (t.date < wtCountedFrom(s) ? 1 : count))).length
    // (what was weighed although Ajustes no longer asks for it stays in the report, with nothing due)
    const asked = weightStepsFor(s, g.dept, g.code).some((x) => sameStep(x, g.step))
    return { ...wtSum(tests.flatMap((t) => t.entries), target), dept: g.dept, code: g.code, kind: g.step.kind, ...(g.step.cook ? { cook: g.step.cook } : {}), label: stepText(g.step), tests, skipped: mine.filter((t) => t.skip), complete, short: tests.length - complete, due: asked ? weightsDue(s, date, g.dept, g.code, now) : null, target }
  })
}
/** Spiral's cook yield by cooker (2026-10-29): the cooked balls' average over the raw ones' (cooked ÷ raw), and what was lost */
export function cookYields(rows: WtRow[]) {
  return rows.filter((r) => r.kind === 'ball' && r.cook && r.avg != null).flatMap((c) => {
    const raw = rows.find((r) => r.kind === 'raw' && r.cook === c.cook && r.dept === c.dept && normCode(r.code) === normCode(c.code))
    return raw?.avg ? [{ dept: c.dept, code: c.code, cook: c.cook as Cook, raw: raw.avg, cooked: c.avg as number, pct: (c.avg as number) / raw.avg }] : []
  })
}
/** the shift a test was made on */
export const wtShift = (s: State, t: WeightTest) => shiftAt(shiftsOf(s, t.date), t.at)
/** the tests done (complete, or a cooker said not used) out of those due, over every row that has a count */
export function wtCompliance(rows: WtRow[]) {
  const counted = rows.filter((r) => r.due != null && r.due > 0)
  const due = counted.reduce((t, r) => t + (r.due ?? 0), 0), done = counted.reduce((t, r) => t + Math.min(r.complete + r.skipped.length, r.due ?? 0), 0)
  return { due, done, pct: due ? done / due : null }
}
/** a row's tests as said: "3 de 4" (made of due), or how many were made when none is due */
export const wtDoneText = (r: WtRow) => (r.due != null && r.due > 0 ? tr('{0} de {1}', Math.min(r.complete + r.skipped.length, r.due), r.due) : String(r.complete + r.skipped.length))

/** each test of some rows (a cooker not used too), oldest first, with its row */
export const wtTests = (rows: WtRow[]) => rows.flatMap((w) => [...w.tests, ...w.skipped].map((t) => ({ w, t }))).sort((a, b) => a.t.at - b.t.at)
/**
 * the weights of the day's report as filtered (2026-10-29): the room and the code chosen choose the rows (each with the
 * whole day's tests, as the KPI), the line and the shift chosen the tests listed one by one
 */
export function wtOfReport(s: State, date: string, now: number, f: { dept?: Dept | ''; code?: string; line?: string; shift?: 0 | 1 | 2 }) {
  const rows = weightsOf(s, date, now).filter((r) => (!f.dept || r.dept === f.dept) && (!f.code || normCode(r.code) === normCode(f.code)))
  return { rows, tests: wtTests(rows).filter(({ t }) => (!f.line || t.lineId === f.line) && (!f.shift || wtShift(s, t) === f.shift)) }
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
 * The weights as a sheet (2026-10-29), for the KPI's Excel and the report's: each room, code and what was weighed against
 * what was due, Spiral's cook yield, then every test with each weight in its own column (red under, amber over)
 */
export function wtSheetRows(s: State, wts: WtRow[], detail: { w: WtRow; t: WeightTest }[]): Cell[][] {
  const okCell = (x: number | null): Cell => (x == null ? '' : { v: Math.round(x * 1000) / 1000, s: x < 0.9 ? X.nBad : x < 1 ? X.nWarn : X.nGood, t: pc(x) })
  const yields = cookYields(wts), most = Math.min(20, Math.max(0, ...detail.map((x) => x.t.entries.length)))
  const target = (w: WtRow) => wtRangeText(w.target)
  return [
    headRow(tr('Cuarto'), tr('Código'), tr('Qué se pesó'), tr('Pruebas hechas'), tr('Incompletas'), tr('Pesados'), tr('Promedio (oz)'), tr('Mínimo'), tr('Máximo'), tr('Objetivo (oz)'), tr('Bien'), tr('Bajos'), tr('Sobre'), tr('% en peso'), tr('Promedio vs objetivo')),
    ...wts.map((w): Cell[] => [w.dept, w.code, w.label, xT(wtDoneText(w), w.due && w.complete + w.skipped.length < w.due ? X.bad : X.label), xN(w.short, w.short ? X.nWarn : X.n), xN(w.n), w.avg == null ? '' : xN(w.avg, X.dec), w.min == null ? '' : xN(w.min, X.dec), w.max == null ? '' : xN(w.max, X.dec), target(w), xN(w.good, w.good ? X.nGood : X.n), xN(w.under, w.under ? X.nBad : X.n), xN(w.over, w.over ? X.nWarn : X.n), okCell(w.okPct), pct1(w.avgPct)]),
    ...(yields.length ? [[], headRow(tr('Rendimiento de cocción'), tr('Código'), tr('Crudo promedio (oz)'), tr('Cocinado promedio (oz)'), tr('Cocinado ÷ crudo'), tr('Se pierde')),
      ...yields.map((y): Cell[] => [cookText(y.cook), y.code, xN(y.raw, X.dec), xN(y.cooked, X.dec), pct1(y.pct), pct1(1 - y.pct)])] : []),
    [], headRow(tr('Hora'), tr('Turno'), tr('Cuarto'), tr('Línea'), tr('Código'), tr('Lote'), tr('Qué se pesó'), tr('Pesados'), tr('Promedio (oz)'), tr('Mínimo'), tr('Máximo'), tr('Objetivo (oz)'), tr('Bien'), tr('Bajos'), tr('Sobre'), tr('Anotó'), ...Array.from({ length: most }, (_, i) => '#' + (i + 1))),
    ...detail.map(({ w, t }): Cell[] => {
      if (t.skip) return [fmtTime(t.at), wtShift(s, t), t.dept, t.line, t.code, t.lot, w.label, xT(tr('No se usó esa hora'), X.label), '', '', '', '', '', '', '', t.by]
      const x = wtSum(t.entries, w.target)
      return [fmtTime(t.at), wtShift(s, t), t.dept, t.line, t.code, t.lot, w.label, xN(x.n), x.avg == null ? '' : xN(x.avg, X.dec), x.min == null ? '' : xN(x.min, X.dec), x.max == null ? '' : xN(x.max, X.dec), target(w), xN(x.good, x.good ? X.nGood : X.n), xN(x.under, x.under ? X.nBad : X.n), xN(x.over, x.over ? X.nWarn : X.n), t.by,
        ...t.entries.slice(0, most).map((e): Cell => { const k = entryClass(e, w.target); return e.w == null ? (e.k === 'sobre' ? '▲' : e.k === 'bajo' ? '▼' : '') : xN(e.w, k === 'bajo' ? X.nBad : k === 'sobre' ? X.nWarn : X.dec) })]
    }),
  ]
}
/** rows with only what one shift weighed, worked out again from its tests (nothing is due by shift) */
export function wtRowsOfShift(s: State, rows: WtRow[], k: 1 | 2): WtRow[] {
  return rows.flatMap((w) => {
    const tests = w.tests.filter((t) => wtShift(s, t) === k), skipped = w.skipped.filter((t) => wtShift(s, t) === k)
    if (!tests.length && !skipped.length) return []
    const complete = tests.filter((t) => t.entries.length >= (t.need ?? 1)).length
    return [{ ...w, ...wtSum(tests.flatMap((t) => t.entries), w.target), tests, skipped, complete, short: tests.length - complete, due: null }]
  })
}
/** what each column of those sheets says, for whoever receives them (Jose, 2026-10-30: "para que ellos sepan qué están leyendo") */
const wtLegendRows = (): Cell[][] => [
  [xT(tr('Qué significa cada columna'), X.title)],
  [],
  headRow(tr('Las hojas'), tr('Qué significa')),
  [tr('Turno {0}', 1), xT(tr('Solo lo que pesó ese turno. La de Turno 2 es igual.'), X.note)],
  [tr('Todos'), xT(tr('Los dos turnos juntos.'), X.note)],
  [],
  headRow(tr('Resumen de cada código'), tr('Qué significa')),
  [tr('Cuarto'), tr('El departamento que pesó.')],
  [tr('Código'), tr('El producto.')],
  [tr('Qué se pesó'), tr('Crudo, Cocinado o Pouch. En Spiral también dice el cocinador: Spiral o Racks.')],
  [tr('Pruebas hechas'), tr('Cuántas pruebas se completaron. "3 de 4" = 3 hechas de las 4 que tocaban; un número solo = las hechas, sin comparar con las que tocaban. Una prueba son varios pesos tomados en la misma hora.')],
  [tr('Incompletas'), tr('Pruebas empezadas con menos pesos de los que se pedían.')],
  [tr('Pesados'), tr('Cuántos pesos se tomaron en total.')],
  [tr('Promedio (oz)'), tr('La suma de los pesos ÷ cuántos son, en onzas.')],
  [tr('Mínimo'), tr('El peso más bajo que se tomó.')],
  [tr('Máximo'), tr('El peso más alto que se tomó.')],
  [tr('Objetivo (oz)'), tr('El rango de QA, en onzas: de lo mínimo a lo máximo permitido.')],
  [tr('Bien'), tr('Pesos dentro del rango de QA.')],
  [tr('Bajos'), tr('Pesos por debajo del mínimo de QA. Salen en rojo.')],
  [tr('Sobre'), tr('Pesos por encima del máximo de QA. Salen en ámbar.')],
  [tr('% en peso'), tr('Bien ÷ pesados. Verde = 100%, ámbar = menos de 100%, rojo = menos de 90%.')],
  [tr('Promedio vs objetivo'), tr('Cuánto se aleja el promedio del centro del rango. Positivo = más pesado, negativo = más liviano.')],
  headRow(tr('Rendimiento de cocción'), tr('Qué significa')),
  [tr('Rendimiento de cocción'), tr('El cocinador: Spiral o Racks.')],
  [tr('Crudo promedio (oz)'), tr('El promedio de las bolas crudas antes de ese cocinador.')],
  [tr('Cocinado promedio (oz)'), tr('El promedio de las bolas cocinadas al salir de ese cocinador.')],
  [tr('Cocinado ÷ crudo'), tr('Cuánto del peso queda después de cocinar.')],
  [tr('Se pierde'), tr('Cuánto del peso se va al cocinar: 100% − lo anterior.')],
  headRow(tr('Cada prueba'), tr('Qué significa')),
  [tr('Hora'), tr('La hora en que se tomó la prueba.')],
  [tr('Turno'), tr('El turno de esa hora.')],
  [tr('Línea'), tr('La línea donde se pesó.')],
  [tr('Lote'), tr('El lote que corría.')],
  [tr('Anotó'), tr('Quien anotó los pesos.')],
  ['#1, #2…', tr('Cada peso en onzas, en el orden en que se tomó. Rojo = bajo, ámbar = sobre.')],
].map((r) => (r.length === 2 && typeof r[1] === 'string' ? [r[0], xT(r[1], X.note)] : r))
/** an average of one thing of a code against QA's range; ok null = nothing weighed, or no range to judge it by */
export type WtAvg = { avg: number | null; n: number; range: string; ok: 'ok' | 'under' | 'over' | null }
export type WtSummaryRow = { code: string; dept: Dept | ''; where: string; times: number; okPct: number | null; raw: WtAvg; cooked: WtAvg; pouch: WtAvg; result: string; action: boolean; pending: boolean }
// (only WT_ASKED_CODES, Jose, 2026-10-30: "que solo sea de los códigos 0889 y 2234, nada más"; both always, weighed or not)
/**
 * What the plant's heads asked for (their whiteboard, 2026-10-30: "16 times · Raw Avg · Cooked Avg · Cooked pouch Avg",
 * QA's ranges, "Corrective action"; Jose: they do not want so much data, they want the summary and it has to explain
 * itself): by code, one line per room that weighed it (Jose: "quiero verlo por departamentos"), its cookers together. Pouch = the finished bag in ounces (the whiteboard's
 * 3.0 was pounds: 48 oz, as Santiago's sheet showed). Times = the most hours any of the three was checked, as his
 * sheet counts them: each hour's check weighs several things in several places. An average against the range decides
 * the colour and the corrective action; a bag under its minimum asks for one too, whatever the average (QA, 2026-10-29:
 * never under 48)
 */
export function wtSummary(s: State, rows: WtRow[]): WtSummaryRow[] {
  const mine = rows.filter((w) => w.tests.length)
  return WT_ASKED_CODES.flatMap((code) => {
    const all = mine.filter((w) => normCode(w.code) === normCode(code))
    // (Spiral's two cookers apart, Spiral first: Santiago's sheet, 2026-10-30)
    const rooms: { dept: Dept | ''; cook: string }[] = DEPTS.flatMap((d) => [...new Set(all.filter((w) => w.dept === d).map((w) => w.cook ?? ''))].sort().reverse().map((cook) => ({ dept: d, cook })))
    return (rooms.length ? rooms : [{ dept: '' as const, cook: '' }]).map(({ dept, cook }): WtSummaryRow => {
    const of = all.filter((w) => w.dept === dept && (w.cook ?? '') === cook)
    const part = (kind: WeightTest['kind']): WtAvg => {
      const ws = of.filter((w) => w.kind === kind).flatMap((w) => w.tests.flatMap((t) => t.entries.flatMap((e) => (e.w != null ? [e.w] : []))))
      // (a target nobody gave is not shown to the heads as QA's)
      const t = wtOfficial(s, code, kind) ? weightTarget(s, code, kind) : null, avg = ws.length ? Math.round((ws.reduce((a, b) => a + b, 0) / ws.length) * 100) / 100 : null
      const r = t ? wtRange(t) : null
      return { avg, n: ws.length, range: t ? wtRangeText(t) : '', ok: avg == null || !r ? null : avg < r.min ? 'under' : avg > r.max ? 'over' : 'ok' }
    }
    const raw = part('raw'), cooked = part('ball'), pouch = part('pouch')
    const light = pouch.range ? of.filter((w) => w.kind === 'pouch').reduce((t, w) => t + w.under, 0) : 0
    const say = (name: string, x: WtAvg) => (x.ok === 'under' ? [tr('{0} bajo el rango de QA', name)] : x.ok === 'over' ? [tr('{0} sobre el rango de QA', name)] : [])
    const out = [...say(tr('Crudo'), raw), ...say(tr('Cocinado'), cooked), ...say(tr('Pouch'), pouch), ...(light && pouch.ok !== 'under' ? [light === 1 ? tr('1 pouch bajo el mínimo') : tr('{0} pouches bajo el mínimo', light)] : [])]
    const judged = [raw, cooked, pouch].some((x) => x.ok != null)
    // (what was weighed with no target of QA is said, never read as fine)
    const open_ = ([[tr('Crudo'), raw], [tr('Cocinado'), cooked], [tr('Pouch'), pouch]] as [string, WtAvg][]).filter(([, x]) => x.avg != null && x.ok == null).map(([t]) => t)
    const hours = (kind: WeightTest['kind']) => new Set(of.filter((w) => w.kind === kind).flatMap((w) => w.tests.map((t) => Math.floor(t.at / 3_600_000)))).size
    const entries = of.flatMap((w) => w.tests.flatMap((t) => t.entries.map((e) => ({ e, target: w.target }))))
    const judgedW = entries.filter((x) => x.target), inW = judgedW.filter((x) => entryClass(x.e, x.target) === 'ok').length
    return { code, dept, where: dept + (cook ? ': ' + cookText(cook as Cook) : ''), times: Math.max(hours('raw'), hours('ball'), hours('pouch')), okPct: judgedW.length && of.every((w) => wtOfficial(s, code, w.kind)) ? inW / judgedW.length : null, raw, cooked, pouch, result: (out.length ? tr('Acción correctiva: {0}', out.join(' · ')) : !of.length ? tr('No se pesó este día') : !judged ? tr('Falta el target de QA') : tr('Dentro del rango de QA')) + (judged && open_.length ? ' · ' + tr('falta el target de: {0}', open_.join(', ')) : ''), action: out.length > 0, pending: open_.length > 0 }
    })
  })
}
/** the summary as one page: nothing else in the file, and it says how to read itself */
export function wtSummarySheet(s: State, rows: WtRow[], date: string): Sheet {
  const list = wtSummary(s, rows), out: Cell[][] = [], heights: Record<number, number> = {}, merges: string[] = []
  const row = (cells: Cell[], ht?: number) => { if (ht) heights[out.length] = ht; out.push(cells); return out.length }
  const across = (text: string, style: number, ht: number) => { const r = row([xT(text, style), ...Array.from({ length: 11 }, () => xT('', style))], ht); merges.push('A' + r + ':L' + r) }
  across(tr('Resumen de pesos'), X.wBand, 32)
  across(niceDay(date), X.wSub, 21)
  row([])
  const out_ = new Set(list.filter((x) => x.action).map((x) => x.code)).size, codes = new Set(list.map((x) => x.code)).size
  let chart: Sheet['chart']
  {
    across(out_ ? tr('{0} de {1} códigos necesitan acción correctiva.', out_, codes) : list.some((x) => x.pending) ? tr('Ningún promedio está fuera del rango de QA, pero a algunos todavía les falta su target.') : list.some((x) => x.times) ? tr('Todos los promedios están dentro del rango de QA.') : tr('Este día no hay pesos de bolas.'), X.wSay, 26)
    row([])
    row([tr('Código'), tr('Departamento'), tr('Veces revisado'), tr('% en peso'), tr('Crudo prom. (oz)'), tr('Rango QA'), tr('Cocinado prom. (oz)'), tr('Rango QA'), tr('Pouch prom. (oz)'), tr('Rango QA'), tr('Resultado'), tr('Acción tomada')].map((x) => xT(x, X.wHead)), 48)
    const avg = (x: WtAvg): Cell => (x.avg == null ? xT('—', X.wCell) : xN(x.avg, x.ok == null ? X.wD : x.ok === 'ok' ? X.wDg : x.ok === 'under' ? X.wDr : X.wDa))
    const range = (x: WtAvg): Cell => xT(x.avg == null ? '—' : x.range || tr('Pendiente'), X.wCell)
    // the chart reads a block of its own, in white, with only what can be judged: a code not weighed is not a 0% (Jose, 2026-10-30)
    const shown = list.filter((x) => x.okPct != null)
    list.forEach((x, i) => row([xT(x.code, X.wCell), xT(x.where || '—', x.dept ? wtRoom(x.dept) : X.wCell), xN(x.times, X.wN), wtPct(x.okPct), avg(x.raw), range(x.raw), avg(x.cooked), range(x.cooked), avg(x.pouch), range(x.pouch), xT(x.result, x.action ? X.wBadW : x.pending ? X.wWarnW : x.times ? X.wGoodW : X.wLeft), xT('', X.wCell), ...(shown[i] ? [xT(shown[i].where + ' ' + shown[i].code, X.wHide), xN(Math.round((shown[i].okPct as number) * 1000) / 1000, X.wHide)] : [])], 52))
    row([])
    // the chart, when some room can be judged: how much of each room's weights fell inside QA's range
    const from = out.length - 1 - list.length + 1, to = from + shown.length - 1, at = out.length + 1, tall = Math.max(9, shown.length * 2 + 3)
    if (shown.length) {
      for (let i = 0; i < tall; i++) row([])
      row([])
      chart = { title: tr('% de pesos dentro del rango de QA, por departamento'), series: tr('% en peso'), cat: 12, val: 13, from, to, at, pct: true, cols: 11, height: tall }
    }
    across(tr('Cómo leerlo: "Veces revisado" = cuántas horas se pesó ese código. "Prom." = el promedio de todos los pesos del día, en onzas. "% en peso" = de todos los pesos, cuántos cayeron dentro del rango. Pouch = la bolsa terminada. Rango QA = el mínimo y el máximo permitido.'), X.note, 34)
    across(tr('Verde = el promedio está dentro del rango. Rojo = bajo el rango. Ámbar = sobre el rango. Si está rojo o ámbar se necesita una acción correctiva: anótala en "Acción tomada".'), X.note, 34)
    const note = kpiNote(s, date, 'weights')
    if (note) { row([]); across(tr('Notas: {0}', note), X.note, 48) }
  }
  return { name: tr('Resumen'), rows: out, freeze: 0, page: { widths: [9, 17, 10, 9, 10, 11, 11, 11, 10, 11, 42, 24], heights, merges }, ...(chart ? { chart } : {}) }
}
/**
 * A code's day as the plant's own Weight Control sheet, the one Santiago keeps (Jose, 2026-10-30: "así como está en el
 * sheet de Santiago", and his update of the same day): Kitchen, whose cooked balls are the Racks', with RTE's pouches
 * on its right, then Spiral with its cooked and its raw, Spiral and Racks apart. Each hour in its block, TIME and its
 * weights, its AVG in yellow, a TOTAL AVG under each group; beside each AVG the target, the difference (how far the
 * average is outside QA's range, 0 inside it) and room for comments and corrective actions. A weight outside the range
 * keeps its red or amber
 */
export function wtControlSheet(s: State, rows: WtRow[], code: string, date: string): Sheet | null {
  const of = rows.filter((w) => normCode(w.code) === normCode(code) && w.tests.length)
  if (!of.length) return null
  // as many weights as Ajustes › KPI asks of each side (Jose, 2026-10-30: 5, 8 or 10, "no sabemos quién está correcto"), or
  // more if some test has them
  const widest = (list: WtRow[]) => Math.min(20, Math.max(1, ...list.flatMap((w) => [weightRuleFor(s, w.dept, w.code).count, ...w.tests.map((t) => t.entries.length)])))
  const nL = widest(of.filter((w) => w.kind !== 'pouch')), nR = widest(of.filter((w) => w.kind === 'pouch')), nAt = (c0: number) => (c0 === 0 ? nL : nR)
  const g: Cell[][] = [], heights: Record<number, number> = {}, merges: string[] = []
  const put = (r: number, c: number, v: Cell) => { (g[r] ??= [])[c] = v }
  const span = (r: number, c: number, r2: number, c2: number) => merges.push(colName(c) + (r + 1) + ':' + colName(c2) + (r2 + 1))
  const avgOf = (ws: number[]) => (ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : null)
  const word = (k: WeightTest['kind']) => (k === 'raw' ? tr('CRUDO') : k === 'ball' ? tr('COCINADO') : 'RTE ' + tr('POUCH'))
  const sides = (c0: number, r: number) => { const a = c0 + 2 + nAt(c0); put(r, a, xT(tr('PROM.'), X.wcBold)); put(r, a + 1, xT(tr('Objetivo'), X.wcBold)); put(r, a + 2, xT(tr('Diferencia'), X.wcBold)); put(r, a + 3, xT(tr('Comentarios / acciones correctivas'), X.wcBold)) }
  // the target and how far the average is from it, in the two cells after the average
  const judge = (r: number, c: number, avg: number | null, w: WtRow, rows2 = 1) => {
    const t = wtOfficial(s, w.code, w.kind) && w.target ? w.target : null, range = t ? wtRange(t) : null
    put(r, c, xT(t ? wtRangeText(t) : tr('Pendiente'), X.wcText))
    // (to two decimals, as QA writes its ranges and as the summary judges: both sheets say the same)
    const two = avg == null ? null : Math.round(avg * 100) / 100
    const d = two == null || !range ? null : Math.round((two < range.min ? two - range.min : two > range.max ? two - range.max : 0) * 100) / 100
    put(r, c + 1, d == null ? xT('—', X.wcText) : { v: d, s: d === 0 ? X.wDg : d < 0 ? X.wDr : X.wDa, t: String(d) })
    if (rows2 > 1) { put(r + 1, c, xT('', X.wcText)); put(r + 1, c + 1, xT('', X.wcText)); span(r, c, r + 1, c); span(r, c + 1, r + 1, c + 1) }
  }
  const group = (r0: number, c0: number, w: WtRow) => {
    let r = r0
    const most = nAt(c0)
    const label = word(w.kind)
    for (const t of [...w.tests].sort((a, b) => a.at - b.at)) {
      put(r, c0, xT(label, X.wcLabel)); put(r + 1, c0, xT('', X.wcLabel)); span(r, c0, r + 1, c0)
      put(r, c0 + 1, xT(tr('HORA'), X.wcHead)); put(r + 1, c0 + 1, xT(fmtTime(t.at), X.wcTime))
      const ws = t.entries.flatMap((e) => (e.w != null ? [e.w] : [])), avg = avgOf(ws)
      for (let i = 0; i < most; i++) {
        put(r, c0 + 2 + i, xT(tr('peso {0}', i + 1), X.wcHead))
        const e = t.entries[i], k = e ? entryClass(e, w.target) : ''
        put(r + 1, c0 + 2 + i, !e ? xT('', X.wcTime) : e.w == null ? xT(e.k === 'sobre' ? '▲' : '▼', X.wcTime) : xN(e.w, k === 'bajo' ? X.wDr : k === 'sobre' ? X.wDa : X.wcW))
      }
      const a = c0 + 2 + most
      put(r, a, avg == null ? xT('—', X.wcAvg) : xN(Math.round(avg * 10000) / 10000, X.wcAvg)); put(r + 1, a, xT('', X.wcAvg)); span(r, a, r + 1, a)
      judge(r, a + 1, avg, w, 2)
      put(r, a + 3, xT('', X.wcText)); put(r + 1, a + 3, xT('', X.wcText)); span(r, a + 3, r + 1, a + 3)
      r += 2
    }
    const all = w.tests.flatMap((t) => t.entries.flatMap((e) => (e.w != null ? [e.w] : []))), total = avgOf(all), a = c0 + 2 + most
    put(r, a - 1, xT(tr('PROM. TOTAL'), X.wcBold))
    put(r, a, total == null ? xT('—', X.wcTotal) : xN(Math.round(total * 10000) / 10000, X.wcTotal))
    judge(r, a + 1, total, w)
    return r + 1
  }
  const leftN = 2 + nL + 4, right = leftN + 1, lastC = right + 2 + nR + 3
  const band = (r: number, text: string) => { put(r, 0, xT(text, X.wcBand)); for (let c = 1; c < leftN; c++) put(r, c, xT('', X.wcBand)); span(r, 0, r, leftN - 1); heights[r] = 26 }
  // a group's own line: its place, its code, and the heads of its columns
  const head = (r: number, c0: number) => { put(r, c0 + 1, xT(tr('CÓDIGO'), X.wcBold)); put(r, c0 + 2, xT(code, X.wcBold)); sides(c0, r) }
  const order = (w: WtRow) => (w.kind === 'ball' ? 0 : 2) + (w.cook === 'racks' ? 1 : 0)
  const balls = of.filter((w) => w.kind !== 'pouch').sort((a, b) => order(a) - order(b)), bags = of.filter((w) => w.kind === 'pouch')
  // each with its title (Jose, 2026-10-30: Kitchen, RTE, "Spiral: Spiral" and "Spiral: Racks", the two inside the room of Spiral)
  const title = (name: string) => name + ' · ' + tr('CONTROL DE PESO · {0}', code) + ' · ' + niceDay(date)
  const sections: { name: string; list: WtRow[] }[] = [
    { name: 'Kitchen', list: balls.filter((w) => w.dept === 'Kitchen') },
    { name: 'Spiral: Spiral', list: balls.filter((w) => w.dept === 'Spiral' && w.cook !== 'racks') },
    { name: 'Spiral: Racks', list: balls.filter((w) => w.dept === 'Spiral' && w.cook === 'racks') },
  ]
  let rl = 0
  for (const x of sections) {
    if (!x.list.length && !(x.name === 'Kitchen' && bags.length)) continue
    band(rl, title(x.name)); rl++
    if (!x.list.length) rl += 2
    for (const w of x.list) { head(rl, 0); rl = group(rl + 1, 0, w) + 1 }
  }
  put(0, right, xT(title('RTE'), X.wcBand)); for (let c = right + 1; c <= lastC; c++) put(0, c, xT('', X.wcBand)); span(0, right, 0, lastC)
  let rr = 1
  for (const w of bags) { head(rr, right); rr = group(rr + 1, right, w) + 1 }
  const side = (n: number) => [10, 9, ...Array.from({ length: n }, () => 9.5), 9, 11, 10, 24]
  return { name: tr('Control de peso {0}', code), rows: Array.from({ length: g.length }, (_, i) => Array.from(g[i] ?? [])), freeze: 0, page: { widths: [...side(nL), 3, ...side(nR)], heights, merges } }
}
/** the file of the one-page button: the summary first, then each code as the plant's own sheet */
export const wtSummaryBook = (s: State, rows: WtRow[], date: string): Sheet[] => [wtSummarySheet(s, rows, date), ...WT_ASKED_CODES.flatMap((c) => { const x = wtControlSheet(s, rows, c, date); return x ? [x] : [] })]
const WT_LAST = 'P' // the band reaches the last column of the tables
const WT_WIDTHS = [11, 9, 19, 11, 11, 9, 10, 9, 9, 11, 8, 8, 8, 13, 12, 18]
const wtRoom = (d: Dept) => (d === 'Kitchen' ? X.wKitchen : d === 'RTE' ? X.wRTE : d === 'Spiral' ? X.wSpiral : X.wCell)
const wtPct = (x: number | null): Cell => (x == null ? xT('—', X.wCell) : { v: Math.round(x * 1000) / 1000, s: x < 0.9 ? X.wPr : x < 1 ? X.wPa : X.wPg, t: pc(x) })
const niceDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
/**
 * One sheet of the weights Excel, made to be read by whoever receives it (Jose, 2026-10-30: "más bonito ... con
 * gráficas, pero que se entienda"): a band with the day, one line in words, the totals as tiles, each code with its %
 * in weight and a chart of it, the cook yield, and every test under it, by code and hour, each weight in green, red or
 * amber. The columns of the tables line up, so the eye goes down one column. The chart's names are in a white column
 * (P of the summary): a chart reads its names from cells
 */
function wtReportSheet(s: State, name: string, rows: WtRow[], date: string): Sheet {
  const out: Cell[][] = [], heights: Record<number, number> = {}, merges: string[] = []
  const row = (cells: Cell[], ht?: number) => { if (ht) heights[out.length] = ht; out.push(cells); return out.length }
  const fill = (s0: number, n: number): Cell[] => Array.from({ length: n }, () => xT('', s0))
  const across = (text: string, style: number, ht: number) => { const r = row([xT(text, style), ...fill(style, 15)], ht); merges.push('A' + r + ':' + WT_LAST + r); return r }
  const sec = (text: string) => { row([]); row([xT(text, X.wSec), ...fill(X.wSec, 15)], 22) }
  across(tr('Reporte de pesos'), X.wBand, 30)
  across(niceDay(date) + ' · ' + name, X.wSub, 21)
  const n = rows.reduce((t, w) => t + w.checked, 0), good = rows.reduce((t, w) => t + w.good, 0), under = rows.reduce((t, w) => t + w.under, 0), over = rows.reduce((t, w) => t + w.over, 0)
  const tests = rows.reduce((t, w) => t + w.complete + w.skipped.length, 0)
  if (!n) { row([]); across(tr('Este turno no tiene pesos.'), X.wSay, 24); return { name, rows: out, freeze: 0, page: { widths: WT_WIDTHS, heights, merges } } }
  // in words, what anybody asks first
  const worst = rows.filter((w) => w.okPct != null && w.okPct < 1).sort((a, b) => (a.okPct as number) - (b.okPct as number))[0]
  const say = tr('De {0} pesos, {1} salieron bien ({2}). Bajos: {3}. Sobre: {4}.', n, good, pc(good / n), under, over) + (worst ? ' ' + tr('Lo que más se salió: {0} · {1} · {2}, con {3} en peso.', worst.dept, worst.code, worst.label, pc(worst.okPct)) : ' ' + tr('Todo dentro del rango de QA.'))
  row([]); across(say, X.wSay, 36); row([])
  // the tiles: each over the columns that give it room
  const tiles: [string, string, string, string][] = [[tr('Pruebas hechas'), String(tests), 'A', 'B'], [tr('Pesados'), String(n), 'C', 'C'], [tr('Bien'), String(good), 'D', 'E'], [tr('Bajos'), String(under), 'F', 'G'], [tr('Sobre'), String(over), 'H', 'I'], [tr('% en peso'), pc(good / n), 'J', 'K']]
  const cols = 'ABCDEFGHIJK'.split(''), tileRow = (i: 0 | 1, st: number): Cell[] => cols.map((c) => { const t = tiles.find((x) => x[2] === c); return xT(t ? t[i] : '', st) })
  const a = row(tileRow(0, X.wTileL), 18), b = row(tileRow(1, X.wTileV), 32)
  for (const t of tiles) if (t[2] !== t[3]) merges.push(t[2] + a + ':' + t[3] + a, t[2] + b + ':' + t[3] + b)
  sec(tr('Resumen de cada código'))
  const head = (...t: string[]) => row(t.map((x) => xT(x, X.wHead)), 48) // (three lines: "Cooked average (oz)" in a narrow column)
  head(tr('Cuarto'), tr('Código'), tr('Qué se pesó'), tr('Pruebas hechas'), tr('Incompletas'), tr('Pesados'), tr('Promedio (oz)'), tr('Mínimo'), tr('Máximo'), tr('Objetivo (oz)'), tr('Bien'), tr('Bajos'), tr('Sobre'), tr('% en peso'), tr('Promedio vs objetivo'))
  const from = out.length + 1
  for (const w of rows) row([xT(w.dept, wtRoom(w.dept)), xT(w.code, X.wCell), xT(w.label, X.wCell), xT(wtDoneText(w), w.due && w.complete + w.skipped.length < w.due ? X.bad : X.wCell), xN(w.short, w.short ? X.wNa : X.wN), xN(w.n, X.wN), w.avg == null ? xT('—', X.wCell) : xN(w.avg, X.wD), w.min == null ? xT('—', X.wCell) : xN(w.min, X.wD), w.max == null ? xT('—', X.wCell) : xN(w.max, X.wD), xT(wtRangeText(w.target) || '—', X.wCell), xN(w.good, w.good ? X.wNg : X.wN), xN(w.under, w.under ? X.wNr : X.wN), xN(w.over, w.over ? X.wNa : X.wN), wtPct(w.okPct), w.avgPct == null ? xT('—', X.wCell) : { v: Math.round(w.avgPct * 1000) / 1000, s: X.wP, t: pc(w.avgPct) }, xT(w.dept + ' ' + w.code + ' · ' + w.label, X.wHide)], 20)
  const to = out.length
  // the chart, in the rows left for it
  row([]); const at = out.length + 1, tall = Math.max(9, rows.length * 2 + 4)
  for (let i = 0; i < tall; i++) row([])
  const yields = cookYields(rows)
  if (yields.length) {
    sec(tr('Rendimiento de cocción'))
    head(tr('Rendimiento de cocción'), tr('Código'), tr('Crudo promedio (oz)'), tr('Cocinado promedio (oz)'), tr('Cocinado ÷ crudo'), tr('Se pierde'))
    for (const y of yields) row([xT(cookText(y.cook), X.wCell), xT(y.code, X.wCell), xN(y.raw, X.wD), xN(y.cooked, X.wD), { v: Math.round(y.pct * 1000) / 1000, s: X.wP, t: pc(y.pct) }, { v: Math.round((1 - y.pct) * 1000) / 1000, s: X.wP, t: pc(1 - y.pct) }], 20)
  }
  sec(tr('Cada prueba'))
  const most = Math.min(20, Math.max(0, ...rows.flatMap((w) => w.tests.map((t) => t.entries.length))))
  head(tr('Cuarto'), tr('Código'), tr('Qué se pesó'), tr('Hora'), tr('Turno'), tr('Pesados'), tr('Promedio (oz)'), tr('Mínimo'), tr('Máximo'), tr('Objetivo (oz)'), tr('Bien'), tr('Bajos'), tr('Sobre'), tr('Línea'), tr('Lote'), tr('Anotó'), ...Array.from({ length: most }, (_, i) => '#' + (i + 1)))
  for (const w of rows) for (const t of [...w.tests, ...w.skipped].sort((p, q) => p.at - q.at)) {
    const x = wtSum(t.entries, w.target), by: Cell[] = [xT(t.line, X.wCell), xT(t.lot, X.wCell), xT(t.by, X.wCell)]
    const first: Cell[] = [xT(w.dept, wtRoom(w.dept)), xT(t.code, X.wCell), xT(w.label, X.wCell), xT(fmtTime(t.at), X.wCell), xN(wtShift(s, t), X.wN)]
    if (t.skip) { row([...first, xT(tr('No se usó esa hora'), X.wCell), ...fill(X.wCell, 7), ...by], 20); merges.push('F' + out.length + ':M' + out.length); continue }
    row([...first, xN(x.n, X.wN), x.avg == null ? xT('—', X.wCell) : xN(x.avg, X.wD), x.min == null ? xT('—', X.wCell) : xN(x.min, X.wD), x.max == null ? xT('—', X.wCell) : xN(x.max, X.wD), xT(wtRangeText(w.target) || '—', X.wCell), xN(x.good, x.good ? X.wNg : X.wN), xN(x.under, x.under ? X.wNr : X.wN), xN(x.over, x.over ? X.wNa : X.wN), ...by,
      ...t.entries.slice(0, most).map((e): Cell => { const k = entryClass(e, w.target); return e.w == null ? xT(e.k === 'sobre' ? '▲' : e.k === 'bajo' ? '▼' : '', X.wCell) : xN(e.w, k === 'bajo' ? X.wDr : k === 'sobre' ? X.wDa : k === 'ok' ? X.wDg : X.wD) })], 20)
  }
  return { name, rows: out, freeze: 0, page: { widths: [...WT_WIDTHS, ...Array.from({ length: most }, () => 8)], heights, merges }, chart: { title: tr('% en peso de cada código: la parte de los pesos que salió dentro del rango de QA'), series: tr('% en peso'), cat: 15, val: 13, from, to, at, pct: true, cols: 14, height: tall } }
}
/**
 * The day's weights to send (Jose, 2026-10-30: "los del turno 1 todos los pesos, el turno 2 todos los pesos y una
 * combinación, así ellos eligen lo que necesitan"): a sheet per shift, one with the two together, and what each column means
 */
export const wtSheets = (s: State, rows: WtRow[], date: string): Sheet[] => [
  wtReportSheet(s, tr('Turno {0}', 1), wtRowsOfShift(s, rows, 1), date),
  wtReportSheet(s, tr('Turno {0}', 2), wtRowsOfShift(s, rows, 2), date),
  wtReportSheet(s, tr('Todos'), rows, date),
  { name: tr('Qué significa'), rows: wtLegendRows(), freeze: 1 },
]
/**
 * One sheet per part, a purple header row, the numbers as numbers with thousands, red / green / amber by what they say,
 * each part's note in a wrapped cell, and two charts Excel draws itself: Costco's planned vs made cases by day, and the
 * cases per person-hour by room.
 */
export function kpiSheets(s: State, date: string, now: number): Sheet[] {
  const notes = (p: KpiPart) => xT(kpiNote(s, date, p), X.note)
  const mo = costcoMonth(s, date, now), last = costcoLast(s, date, now, 7), lab = laborOf(s, date, now), day = last[last.length - 1], wts = weightsOf(s, date, now)
  const outW = wts.reduce((t, w) => t + w.under + w.over, 0), allW = wts.reduce((t, w) => t + w.checked, 0), cw = wtCompliance(wts)
  const goodW = wts.reduce((t, w) => t + w.good, 0), underW = wts.reduce((t, w) => t + w.under, 0), overW = wts.reduce((t, w) => t + w.over, 0)
  const head: Cell[][] = [[xT(tr('E.R. - Ops Summary'), X.title), xDay(date)], []]
  const wState = !allW && !cw.due ? X.label : (allW && outW / allW > 0.1) || (cw.pct != null && cw.pct < 0.9) ? X.bad : outW || (cw.pct != null && cw.pct < 1) ? X.warn : X.good
  const cState = day.pct == null ? X.label : day.pct < 0.9 ? X.bad : day.pct < 1 ? X.warn : X.good
  const resumen: Cell[][] = [...head, headRow(tr('Parte'), tr('Resultado'), tr('Qué vimos · causa · acción')),
    [xT(tr('1 · Pesos'), X.label), xT([allW ? tr('{0} pesados: {1} bien, {2} bajos, {3} sobre', allW, goodW, underW, overW) : tr('Sin pruebas de peso'), ...(cw.due ? [tr('{0} de {1} pruebas hechas', cw.done, cw.due)] : [])].join(' · '), wState), notes('weights')],
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
  const pesos: Cell[][] = [...head, ...wtSheetRows(s, wts, wtTests(wts)), [], [notes('weights')]]
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

