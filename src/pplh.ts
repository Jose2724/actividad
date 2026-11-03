import { DEPTS, kpiGet, kpiPut, type Dept, type State } from './store'
import { reportOf } from './report'
import { downKind } from './miniKpi'
import { X, colName, xN, xT, type Cell, type Chart, type ReadCell, type Sheet } from './xlsx'

/**
 * Mike's daily KPI (meeting of 2026-11-02, for his boss, by 11:30 AM): East Rutherford's pounds per labor hour of the
 * day before, over a range of dates, and the downtime of each room. The pounds are NetSuite's ingredients used, sent by
 * Melissa (the "MELISSA DATA" sheet of Mike's PPLH workbook); the hours are the people's, from HR. Neither is in the
 * app: the pounds are read from her file, kept by month with the KPI's records (one record per month, so a tablet
 * does not pull hundreds of rows), and the hours are typed for each day until HR's file is known. The downtime is the
 * app's own, counted as the Mini KPI counts it. Nothing is guessed: a day with no pounds or no hours stays empty.
 */
export const PPLH_SITE = 'East Rutherford'
/** who sees it (Jose, 2026-11-02: "solo para mí y luego yo le doy permisos a otras personas"): the admin, and the names he writes as their accounts show them */
const plainName = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
export const pplhNames = (s: State): string[] => { const v = kpiGet(s, 'pplh-access')?.data.names; return Array.isArray(v) ? v.map(String).filter(Boolean) : [] }
export const setPplhNames = (names: string[]) => kpiPut('pplh-access', { names })
export const seesPplh = (s: State, admin: boolean, name: string) => admin || pplhNames(s).some((n) => plainName(n) === plainName(name))
const LBS = 'pplh-lbs:', HRS = 'pplh-hrs:'
export type PplhLbs = { lbs: number; rows: number }
type LbsMonth = { days: Record<string, PplhLbs>; file?: string }
const monthOf = (s: State, ym: string) => (kpiGet(s, LBS + ym)?.data as LbsMonth | undefined)?.days ?? {}
export const pplhLbs = (s: State, date: string): PplhLbs | null => monthOf(s, date.slice(0, 7))[date] ?? null
export const pplhHours = (s: State, date: string): number | null => { const h = kpiGet(s, HRS + date)?.data.hours; return typeof h === 'number' && h > 0 ? h : null }
export const setPplhHours = (date: string, hours: number | null) => kpiPut(HRS + date, hours && hours > 0 ? { hours: Math.round(hours * 100) / 100 } : {}, !(hours && hours > 0))
/** the pounds of a file, kept: each day it brings replaces that day, the others of the month stay */
export function savePplhLbs(s: State, days: { date: string; lbs: number; rows: number }[], file: string) {
  const months = new Map<string, Record<string, PplhLbs>>()
  for (const d of days) { const m = months.get(d.date.slice(0, 7)) ?? { ...monthOf(s, d.date.slice(0, 7)) }; m[d.date] = { lbs: Math.round(d.lbs * 100) / 100, rows: d.rows }; months.set(d.date.slice(0, 7), m) }
  for (const [ym, m] of months) kpiPut(LBS + ym, { days: m, file: file.slice(0, 120) })
}

const norm = (x: ReadCell) => String(x ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const ymd = (y: number, m: number, d: number) => (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '')
/** a date as Excel or a CSV gives it: a serial number, "10/27/2026", "2026-10-27" */
function dateText(x: ReadCell): string {
  if (typeof x === 'number' && x > 20000 && x < 80000) { const d = new Date(Math.round((x - 25569) * 86_400_000)); return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) }
  const t = String(x ?? '').trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t)
  if (m) return ymd(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t)
  if (m) return ymd(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[1], +m[2])
  if (/^\d+(\.\d+)?$/.test(t)) return dateText(Number(t))
  return ''
}
export type NetsuiteRead = { days: { date: string; lbs: number; rows: number }[]; sites: string[]; other: number; totals: number; undated: number; bad: number; found: boolean }
/**
 * NetSuite's export, as Melissa's sheet has it: Subsidiary, Full item Name, Date - Year/Month/Day, Lbs Used, (Total
 * Cost), Transaction Date. Only East Rutherford's rows count. Left out, and told back: the other sites, the "Total"
 * lines and each item's subtotal line (it has no date: counting it would double the pounds), and a row whose pounds
 * are not a number
 */
export function readNetsuite(rows: ReadCell[][]): NetsuiteRead {
  const out: NetsuiteRead = { days: [], sites: [], other: 0, totals: 0, undated: 0, bad: 0, found: false }
  const h = rows.slice(0, 12).findIndex((r) => r.some((c) => norm(c) === 'subsidiary') && r.some((c) => norm(c) === 'lbs used'))
  if (h < 0) return out
  out.found = true
  const head = rows[h].map(norm), at = (name: string) => head.indexOf(name)
  const site = at('subsidiary'), lbs = at('lbs used'), item = head.findIndex((c) => c === 'full item name' || c === 'item'), tdate = at('transaction date')
  const year = at('date - year'), month = at('date - month'), day = at('date - day')
  const byDay = new Map<string, { lbs: number; rows: number }>(), sites = new Set<string>()
  for (const r of rows.slice(h + 1)) {
    const where = String(r[site] ?? '').trim()
    if (!where) continue
    sites.add(where)
    if (norm(where) !== norm(PPLH_SITE)) { out.other++; continue }
    if (item >= 0 && (!norm(r[item]) || norm(r[item]) === 'total')) { out.totals++; continue }
    let date = tdate >= 0 ? dateText(r[tdate]) : ''
    if (!date && year >= 0 && month >= 0 && day >= 0) { const mm = MONTHS.indexOf(norm(r[month])) + 1 || Number(r[month]); date = ymd(Number(r[year]), mm, Number(r[day])) }
    if (!date) { out.undated++; continue }
    const n = typeof r[lbs] === 'number' ? r[lbs] : Number(String(r[lbs] ?? '').replace(/,/g, ''))
    if (!Number.isFinite(n)) { out.bad++; continue }
    const e = byDay.get(date) ?? { lbs: 0, rows: 0 }
    e.lbs += n; e.rows++
    byDay.set(date, e)
  }
  out.sites = [...sites]
  out.days = [...byDay].map(([date, e]) => ({ date, lbs: Math.round(e.lbs * 100) / 100, rows: e.rows })).sort((a, b) => a.date.localeCompare(b.date))
  return out
}
/** of a workbook's sheets, the one that is NetSuite's */
export const netsuiteSheet = (sheets: { name: string; rows: ReadCell[][] }[]) => sheets.map((x) => ({ ...x, read: readNetsuite(x.rows) })).find((x) => x.read.found) ?? null

/** the days from one date to another, both included */
export function datesFrom(from: string, to: string) {
  const out: string[] = []
  for (let d = new Date(from + 'T12:00:00'); out.length < 400; d.setDate(d.getDate() + 1)) { const t = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; if (t > to) break; out.push(t) }
  return out
}
export type PplhRow = { date: string; lbs: number | null; rows: number; hours: number | null; pplh: number | null }
export const pplhRow = (s: State, date: string): PplhRow => { const l = pplhLbs(s, date), h = pplhHours(s, date); return { date, lbs: l?.lbs ?? null, rows: l?.rows ?? 0, hours: h, pplh: l && h ? l.lbs / h : null } }
/** a range's pounds per labor hour: its pounds over its hours, of the days that have both (never an average of the days' PPLH) */
export function pplhOfRange(list: PplhRow[]) {
  const both = list.filter((x) => x.lbs != null && x.hours != null), lbs = both.reduce((t, x) => t + (x.lbs ?? 0), 0), hours = both.reduce((t, x) => t + (x.hours ?? 0), 0)
  return { lbs, hours, days: both.length, pplh: hours ? lbs / hours : null }
}

// ---- by week and by month (Mike, 2026-11-02: "weekly, monthly"; his SUMMARY is one row per week, Monday to Sunday) ----
export type PplhBy = 'day' | 'week' | 'month'
const WHRS = 'pplh-whrs:'
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const plusDays = (date: string, n: number) => { const d = day(date); d.setDate(d.getDate() + n); return iso(d) }
/** the Monday of a date's week */
export const mondayOf = (date: string) => plusDays(date, -((day(date).getDay() + 6) % 7))
const monthEnd = (ym: string) => { const [y, m] = ym.split('-').map(Number); return iso(new Date(y, m, 0, 12)) }
export const monthName = (ym: string) => day(ym + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
/** the ranges one taps instead of typing: the day itself (chosen by default, Jose 2026-11-03), this week (Monday to Sunday), last week, this month, last month */
export function rangeShortcuts(today: string): { id: 'day' | 'week' | 'lastWeek' | 'month' | 'lastMonth'; from: string; to: string }[] {
  const mon = mondayOf(today), ym = today.slice(0, 7), [y, m] = ym.split('-').map(Number), prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`
  return [{ id: 'day', from: today, to: today }, { id: 'week', from: mon, to: plusDays(mon, 6) }, { id: 'lastWeek', from: plusDays(mon, -7), to: plusDays(mon, -1) }, { id: 'month', from: ym + '-01', to: monthEnd(ym) }, { id: 'lastMonth', from: prev + '-01', to: monthEnd(prev) }]
}
/** a week's labor hours when HR gives them by the week and not by the day (Mike's workbook has them so), kept by its Monday */
export const pplhWeekHours = (s: State, monday: string): number | null => { const h = kpiGet(s, WHRS + monday)?.data.hours; return typeof h === 'number' && h > 0 ? h : null }
export const setPplhWeekHours = (monday: string, hours: number | null) => kpiPut(WHRS + monday, hours && hours > 0 ? { hours: Math.round(hours * 100) / 100 } : {}, !(hours && hours > 0))
export type PplhGroup = { key: string; by: PplhBy; from: string; to: string; days: number; lbsDays: number; hoursDays: number; lbs: number | null; rows: number; hours: number | null; weekly: boolean; whole: boolean; pplh: number | null; inLbs: number; inHours: number }
/**
 * one week of a group (its days inside the range): with hours typed for any of its days, the days that have both pounds
 * and hours count, as the range does; with none, a whole week's hours typed for the week take all its pounds
 */
function weekPart(s: State, days: string[]) {
  const rows = days.map((d) => pplhRow(s, d))
  if (rows.some((r) => r.hours != null)) { const b = pplhOfRange(rows); return { lbs: b.lbs, hours: b.hours, weekly: false } }
  const wh = days.length === 7 ? pplhWeekHours(s, days[0]) : null
  return wh == null || !rows.some((r) => r.lbs != null) ? null : { lbs: rows.reduce((t, r) => t + (r.lbs ?? 0), 0), hours: wh, weekly: true }
}
/**
 * the range by day, by week (Monday to Sunday, as Mike's SUMMARY) or by month: each group's pounds are its days' added
 * up, its hours its days' (or its weeks', when HR gave them by the week), and its PPLH the pounds over the hours of
 * what has both. A group the range cuts says so (whole = false): a week's hours are only typed for a whole week
 */
export function pplhGroups(s: State, from: string, to: string, by: PplhBy): PplhGroup[] {
  const keyOf = (d: string) => (by === 'day' ? d : by === 'week' ? mondayOf(d) : d.slice(0, 7))
  const out: PplhGroup[] = []
  for (const d of datesFrom(from, to)) {
    const key = keyOf(d), r = pplhRow(s, d)
    let g = out[out.length - 1]
    if (!g || g.key !== key) { g = { key, by, from: d, to: d, days: 0, lbsDays: 0, hoursDays: 0, lbs: null, rows: 0, hours: null, weekly: false, whole: false, pplh: null, inLbs: 0, inHours: 0 }; out.push(g) }
    g.to = d; g.days++
    if (r.lbs != null) { g.lbs = (g.lbs ?? 0) + r.lbs; g.lbsDays++; g.rows += r.rows }
    if (r.hours != null) { g.hours = (g.hours ?? 0) + r.hours; g.hoursDays++ }
  }
  for (const g of out) {
    g.whole = by === 'day' || (g.from === (by === 'week' ? g.key : g.key + '-01') && g.to === (by === 'week' ? plusDays(g.key, 6) : monthEnd(g.key)))
    const weeks = new Map<string, string[]>()
    for (const d of datesFrom(g.from, g.to)) { const w = mondayOf(d); weeks.set(w, [...(weeks.get(w) ?? []), d]) }
    const parts = [...weeks.values()].map((days) => weekPart(s, days)).filter((x): x is NonNullable<typeof x> => x != null)
    const lbs = parts.reduce((t, x) => t + x.lbs, 0), hours = parts.reduce((t, x) => t + x.hours, 0)
    g.weekly = parts.some((x) => x.weekly)
    if (g.weekly) g.hours = (g.hours ?? 0) + parts.filter((x) => x.weekly).reduce((t, x) => t + x.hours, 0)
    g.inLbs = lbs; g.inHours = hours; g.pplh = hours > 0 ? lbs / hours : null
  }
  return out
}
/** a list of groups as one: the pounds and the hours that went into each PPLH, added up, then divided */
export function pplhOfGroups(list: PplhGroup[]) {
  const lbs = list.reduce((t, g) => t + (g.lbs ?? 0), 0), hours = list.reduce((t, g) => t + (g.hours ?? 0), 0), inL = list.reduce((t, g) => t + g.inLbs, 0), inH = list.reduce((t, g) => t + g.inHours, 0)
  return { lbs, hours, pplh: inH > 0 ? inL / inH : null }
}

export type RoomDown = { dept: Dept; worked: number; stopped: number; lunch: number; setup: number; mech: number; people: number; clean: number; other: number; time: number; causes: Map<string, number> }
/** each room's time on some days, both shifts, as the Mini KPI splits it: worked, stopped (mechanical, personnel, cleaning, other), Lunch and Break, Set up */
export function downtimeOf(s: State, dates: string[], now: number): RoomDown[] {
  return DEPTS.map((dept) => {
    const x: RoomDown = { dept, worked: 0, stopped: 0, lunch: 0, setup: 0, mech: 0, people: 0, clean: 0, other: 0, time: 0, causes: new Map() }
    for (const date of dates) for (const r of reportOf(s, date, now, { only: dept }).rows) {
      x.worked += r.st.working; x.setup += r.st.setup
      for (const [why, ms] of Object.entries(r.st.reasons)) {
        const k = downKind(why)
        if (k === 'lunch') { x.lunch += ms; continue }
        x[k] += ms; x.stopped += ms
        x.causes.set(why, (x.causes.get(why) ?? 0) + ms)
      }
    }
    x.time = x.worked + x.stopped + x.lunch + x.setup
    return x
  })
}

// ---- the workbook, in English and in the look of Mike's (his navy, orange, grey and gold) ----
const NAVY = '1F4E78', ORANGE = 'ED7D31', GREY = 'A5A5A5', GOLD = 'FFC000'
/** his charts' title (dark grey, bold) and dates on the bottom axis as m/d/yy, tilted */
export const MIKE_LOOK = { titleColor: '404040', dates: 'm/d/yy' } as const
const hrs = (ms: number) => Math.round(ms / 36_000) / 100
const day = (d: string) => new Date(d + 'T12:00:00')
export const longDay = (d: string) => day(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
export const shortDay = (d: string) => day(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
export const dateCell = (d: string): Cell => { const [y, m, dd] = d.split('-').map(Number); return { v: Date.UTC(y, m - 1, dd) / 86_400_000 + 25569, s: X.mDate, t: shortDay(d) } }
const empty = xT('', X.wCell), none = xT('—', X.wCell)
/** a report page in Mike's look: rows, merged bands, gaps, and the sheet at the end */
export function mikePage(widths: number[]) {
  const rows: Cell[][] = [], heights: Record<number, number> = {}, merges: string[] = [], last = colName(widths.length - 1)
  const row = (cells: Cell[], ht?: number) => { if (ht) heights[rows.length] = ht; rows.push(cells); return rows.length }
  const across = (text: string, style: number, ht: number) => { const r = row([xT(text, style), ...Array.from({ length: widths.length - 1 }, () => xT('', style))], ht); merges.push('A' + r + ':' + last + r) }
  const gap = (n = 1) => { const first = rows.length + 1; for (let i = 0; i < n; i++) row([]); return first }
  return { rows, heights, merges, row, across, gap, done: (name: string, charts: Chart[] = []): Sheet => ({ name, rows, charts, freeze: 0, page: { widths, heights, merges } }) }
}
const signed = (x: number, digits = 1) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(digits)

/** the workbook for Mike: the day before (date) on top, the days of the range, the downtime by room, the yield, and how each number is worked out */
export function pplhBook(s: State, from: string, to: string, date: string, now: number, by: PplhBy = 'day'): Sheet[] {
  const range = datesFrom(from, to), list = range.map((d) => pplhRow(s, d)), today = pplhRow(s, date)
  const prev = (() => { for (let i = 1; i <= 14; i++) { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() - i); const r = pplhRow(s, d.toISOString().slice(0, 10)); if (r.pplh != null) return r } return null })()
  const all = pplhOfRange(list)

  // ---- SUMMARY ----
  const a = mikePage([24, 18, 18, 20, 18, 18])
  a.across('East Rutherford — Daily Pounds per Labor Hour', X.mBand, 32)
  a.across(`Report for ${longDay(date)}. Pounds: NetSuite ingredients used (Lbs Used). Hours: labor hours from HR. Lbs/Labor Hr = pounds ÷ hours.`, X.mSub, 34)
  a.gap()
  a.row(['Date', 'East Rutherford Lbs', 'East Rutherford Hours', 'East Rutherford Lbs/Labor Hr', 'vs Prior Day', `vs ${shortDay(from)} – ${shortDay(to)}`].map((t) => xT(t, X.mHead)), 34)
  const vs = (x: number | null) => (today.pplh == null || x == null ? none : xT(signed(today.pplh - x), today.pplh >= x ? X.wPg : X.wPr))
  a.row([dateCell(date), today.lbs == null ? xT('No NetSuite file', X.wPa) : xN(Math.round(today.lbs), X.wN), today.hours == null ? xT('No HR hours', X.wPa) : xN(today.hours, X.mN1), today.pplh == null ? none : xN(today.pplh, X.mN1), vs(prev?.pplh ?? null), vs(all.pplh)], 24)
  a.gap()
  // (by week or by month when asked so: one row per week as his SUMMARY, or per month; the chart follows)
  const groups = by === 'day' ? null : pplhGroups(s, from, to, by), look = by === 'month' ? { titleColor: MIKE_LOOK.titleColor } : MIKE_LOOK
  a.across(`${by === 'week' ? 'Week by week (Monday to Sunday)' : by === 'month' ? 'Month by month' : 'Day by day'} · ${shortDay(from)} to ${shortDay(to)}`, X.wSec, 24)
  a.row([by === 'week' ? 'Week of' : by === 'month' ? 'Month' : 'Date', 'East Rutherford Lbs', 'East Rutherford Hours', 'East Rutherford Lbs/Labor Hr', groups ? 'Days' : 'NetSuite rows'].map((t) => xT(t, X.mHead)), 34)
  const from1 = a.rows.length + 1
  if (groups) for (const g of groups) a.row([by === 'week' ? dateCell(g.from) : xT(monthName(g.key), X.wLeft), g.lbs == null ? empty : xN(Math.round(g.lbs), X.wN), g.hours == null ? empty : xN(g.hours, X.mN1), g.pplh == null ? empty : xN(g.pplh, X.mN1), xT(`${g.lbsDays} of ${g.days} with pounds${g.weekly ? ' · weekly hours' : ''}${g.whole ? '' : ' · cut by the range'}`, X.wCell)], 20)
  else for (const r of list) a.row([dateCell(r.date), r.lbs == null ? empty : xN(Math.round(r.lbs), X.wN), r.hours == null ? empty : xN(r.hours, X.mN1), r.pplh == null ? empty : xN(r.pplh, X.mN1), r.rows ? xN(r.rows, X.wN) : empty], 20)
  const to1 = a.rows.length
  a.row([xT('Range', X.mHead), xN(Math.round(all.lbs), X.wN), xN(all.hours, X.mN1), all.pplh == null ? none : xN(all.pplh, X.mN1), xT(`${all.days} day(s) with both`, X.wCell)], 22)
  a.across('The range adds the pounds and the hours of the days that have both, then divides: it is not an average of the daily numbers. A day with no NetSuite file or no HR hours is left blank, never estimated.', X.note, 34)
  a.gap()
  const TALL = 17, at1 = a.gap(TALL), at2 = (a.gap(), a.gap(TALL))
  const summary = a.done('SUMMARY', [
    { title: 'East Rutherford — Productivity and Total Hours', series: ['East Rutherford Lbs/Labor Hr', 'East Rutherford Total Hours'], cat: 0, val: [3, 2], from: from1, to: to1, at: at1, kind: 'line', fmt: '0.0', fmt2: '#,##0', axis2: [1], colors: [NAVY, GREY], labels: 'none', left: 0, cols: 6, height: TALL, ...look, axisTitle: 'Lbs per Labor Hour', axis2Title: 'Total Labor Hours' },
    { title: 'Daily Pounds Used — East Rutherford', series: ['East Rutherford'], cat: 0, val: [1], from: from1, to: to1, at: at2, kind: 'line', fmt: '#,##0', colors: [ORANGE], labels: 'none', left: 0, cols: 6, height: TALL, ...look, axisTitle: 'Pounds' },
  ])

  // ---- DOWNTIME ----
  const b = mikePage([16, 12, 12, 14, 11, 12, 13, 13, 12, 11, 40])
  b.across('East Rutherford — Downtime by Room', X.mBand, 32)
  b.across(`${longDay(date)}, both shifts. Time with a code running on each line, lines added up. Stopped = mechanical, personnel, cleaning and other; Lunch & Break and Set up are apart.`, X.mSub, 34)
  b.gap()
  const head = ['Room', 'Worked (h)', 'Stopped (h)', 'Lunch & Break (h)', 'Set up (h)', '% Stopped', 'Mechanical (h)', 'No Personnel (h)', 'Cleaning (h)', 'Other (h)', 'Main causes']
  const table = (dates: string[]) => {
    const list2 = downtimeOf(s, dates, now)
    b.row(head.map((t) => xT(t, X.mHead)), 34)
    const first = b.rows.length + 1
    for (const x of list2) {
      const top = [...x.causes].sort((p, q) => q[1] - p[1]).slice(0, 3).map(([why, ms]) => `${why} ${hrs(ms)} h`).join(' · ')
      b.row([xT(x.dept, X.wLeft), ...[x.worked, x.stopped, x.lunch, x.setup].map((ms) => (x.time ? xN(hrs(ms), X.mN1) : empty)), x.time ? xN(x.stopped / x.time, x.stopped / x.time > 0.15 ? X.wPr : X.wPg) : empty, ...[x.mech, x.people, x.clean, x.other].map((ms) => (x.time ? xN(hrs(ms), X.mN1) : empty)), xT(top || '—', X.wLeft)], 22)
    }
    const last = b.rows.length, sum = (f: (x: RoomDown) => number) => list2.reduce((t, x) => t + f(x), 0), time = sum((x) => x.time)
    b.row([xT('Plant', X.mHead), ...[sum((x) => x.worked), sum((x) => x.stopped), sum((x) => x.lunch), sum((x) => x.setup)].map((ms) => xN(hrs(ms), X.mN1)), time ? xN(sum((x) => x.stopped) / time, X.wP) : none, ...[sum((x) => x.mech), sum((x) => x.people), sum((x) => x.clean), sum((x) => x.other)].map((ms) => xN(hrs(ms), X.mN1)), xT('', X.wCell)], 22)
    return { first, last }
  }
  const t1 = table([date])
  b.gap()
  b.across(`Range · ${shortDay(from)} to ${shortDay(to)}`, X.wSec, 24)
  table(range)
  b.across('% Stopped is the stopped hours over all the hours with a code. A room that did not run shows blank.', X.note, 22)
  b.gap()
  const at3 = b.gap(TALL), at4 = (b.gap(), b.gap(TALL))
  const downtime = b.done('DOWNTIME', [
    { title: `Hours by Room — ${shortDay(date)}`, series: ['Worked', 'Stopped', 'Lunch & Break', 'Set up'], cat: 0, val: [1, 2, 3, 4], from: t1.first, to: t1.last, at: at3, kind: 'col', fmt: '0', labelFmt: '0.0;;', colors: [NAVY, ORANGE, GREY, GOLD], left: 0, cols: 11, height: TALL },
    { title: `% of Time Stopped by Room — ${shortDay(date)}`, series: ['% Stopped'], cat: 0, val: [5], from: t1.first, to: t1.last, at: at4, kind: 'col', pct: true, labelFmt: '0.0%', colors: [NAVY], left: 0, cols: 11, height: TALL },
  ])

  // ---- YIELD ----
  const c = mikePage([14, 16, 16, 12, 12, 60])
  c.across('East Rutherford — Yield by Product', X.mBand, 32)
  c.across('Yield = pounds out ÷ pounds in, by product. The NetSuite file lists ingredients by item, not by product, so the pounds of each product need their own source.', X.mSub, 34)
  c.gap()
  c.row(['Product', 'Lbs In', 'Lbs Out', 'Yield %', 'Target', 'Status'].map((t) => xT(t, X.mHead)), 30)
  for (const code of ['0889', '2234']) c.row([xT(code, X.wLeft), none, none, none, none, xT('Pending: source of pounds by product to be defined', X.wPa)], 22)
  const yieldSheet = c.done('YIELD')

  // ---- HOW IT IS CALCULATED ----
  const d = mikePage([30, 90])
  d.across('How each number is worked out', X.mBand, 32)
  d.gap()
  for (const [k, v] of [
    ['East Rutherford Lbs', 'The sum of "Lbs Used" of East Rutherford for that date in the NetSuite export. Other sites, the Total line and each item\'s subtotal line are left out.'],
    ['East Rutherford Hours', 'The labor hours of that date, from HR.'],
    ['Lbs/Labor Hr', 'Pounds ÷ hours of the same date.'],
    ['Range', 'The pounds and the hours of the days that have both, added up, then divided. Not an average of the daily numbers.'],
    ['Week / Month', 'The same, week by week (Monday to Sunday) or month by month. When HR gives the hours by the week, a whole week\'s hours take all the pounds of that week.'],
    ['vs Prior Day', 'Today\'s Lbs/Labor Hr minus the last earlier day that had one (green = higher).'],
    ['Worked / Stopped (h)', 'From the plant\'s app: the time each line had a code running, both shifts, lines added up.'],
    ['% Stopped', 'Stopped hours ÷ all the hours with a code (worked + stopped + Lunch & Break + Set up). Red above 15%.'],
  ]) d.row([xT(k, X.wLeft), xT(v, X.note)], 34)
  return [summary, downtime, yieldSheet, d.done('HOW IT IS CALCULATED')]
}
