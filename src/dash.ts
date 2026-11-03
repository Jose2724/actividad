import { WT_ASKED_CODES, type State } from './store'
import { weightsOf, wtBoard, wtRangeLong, type WtAvg, type WtBoardRow } from './kpi'
import { dateCell, mikePage, MIKE_LOOK, pplhOfRange, pplhRow, shortDay } from './pplh'
import { colName, X, xN, xT, type Cell, type Chart } from './xlsx'

/**
 * Mike's dashboard (his whiteboard, 2026-11-03): on top Yield, Shorts and PPLH; then "Yield + Weight Summary", one
 * block per product (0889 and 2234) with three rows, Raw, Cooked and Pouch, their QA target and one column per day;
 * and a chart with the three lines. Yield and Shorts wait for their source and their meaning (asked of Mike); the
 * weights come from the hourly tests the rooms already take, each day's average over the whole plant as the weights
 * board (Reporte › Pesos) works it out
 */
export type DashKind = 'raw' | 'cooked' | 'pouch'
export const DASH_KINDS: DashKind[] = ['raw', 'cooked', 'pouch']
export type DashDay = { date: string; times: number; raw: WtAvg; cooked: WtAvg; pouch: WtAvg }
export type DashCode = { code: string; days: DashDay[]; all: WtBoardRow; target: Record<DashKind, string> }
/** each asked code over the dates: the board of each day, the board of all of them together, and QA's ranges */
export function dashOf(s: State, dates: string[], now = Date.now()): DashCode[] {
  const byDay = dates.map((date) => ({ date, rows: weightsOf(s, date, now) }))
  const boards = byDay.map((x) => ({ date: x.date, board: wtBoard(s, x.rows) }))
  const all = wtBoard(s, byDay.flatMap((x) => x.rows))
  return WT_ASKED_CODES.map((code) => {
    const a = all.find((b) => b.code === code) as WtBoardRow
    const days = boards.map((b): DashDay => { const x = b.board.find((y) => y.code === code) as WtBoardRow; return { date: b.date, times: x.weighed ? x.times : 0, raw: x.raw, cooked: x.cooked, pouch: x.pouch } })
    return { code, days, all: a, target: { raw: a.raw.range, cooked: a.cooked.range, pouch: a.pouch.range } }
  })
}
/** the range's PPLH for the tile on top (the days that have pounds and hours, added up) */
export const dashPplh = (s: State, dates: string[]) => pplhOfRange(dates.map((d) => pplhRow(s, d)))

const KIND_NAME: Record<DashKind, string> = { raw: 'Raw', cooked: 'Cooked', pouch: 'Pouch' }
/** the chart colours: raw, cooked, pouch (a validated categorical triple; the same on the screen) */
export const DASH_COLORS: Record<DashKind, string> = { raw: 'EB6834', cooked: '2A78D6', pouch: '1BAF7A' }
const md = (d: string) => { const [, m, dd] = d.split('-').map(Number); return m + '/' + dd }
const avgCell = (x: WtAvg): Cell => (x.avg == null ? xT('', X.wCell) : xN(x.avg, x.ok === 'ok' ? X.wDg : x.ok === 'under' ? X.wDr : x.ok === 'over' ? X.wDa : X.wD))
const target = (r: string) => (r ? wtRangeLong(r) + ' oz' : '—')
/**
 * the dashboard as a sheet, in English and in Mike's look: the three tiles, the summary with one column per day, and
 * per product its days down with the two charts (raw and cooked together, the pouch on its own: ounces of a ball and
 * of a bag cannot share an axis)
 */
export function dashBook(s: State, from: string, to: string, dates: string[], now: number) {
  const data = dashOf(s, dates, now), pplh = dashPplh(s, dates)
  const n = dates.length, widths = [11, 9, 13, ...dates.map(() => 8), 9]
  const a = mikePage(widths), charts: Chart[] = []
  a.across('E.R. - Ops Summary · Yield + Weight Summary', X.wBand, 34)
  a.across(from === to ? shortDay(from) : `${shortDay(from)} to ${shortDay(to)} · ${n} days`, X.wSub, 22)
  a.gap()
  // the three tiles, as his whiteboard's first line
  a.row([xT('Yield', X.wTileL), xT('', X.wTileL), xT('Shorts', X.wTileL), xT('', X.wTileL), xT('PPLH', X.wTileL)], 22)
  const tileRow = a.row([xT('—', X.wTileV), xT('', X.wTileV), xT('—', X.wTileV), xT('', X.wTileV), pplh.pplh == null ? xT('—', X.wTileV) : xN(Math.round(pplh.pplh * 10) / 10, X.wTileV)], 40)
  a.row([xT('pending: pounds per product', X.note), xT('', X.note), xT('pending: to be defined', X.note), xT('', X.note), xT(pplh.pplh == null ? 'pending: pounds and hours' : `lbs per labor hour · ${pplh.days} day(s)`, X.note)], 22)
  for (const r of [tileRow - 1, tileRow, tileRow + 1]) a.merges.push(`A${r}:B${r}`, `C${r}:D${r}`, `E${r}:F${r}`)
  a.gap()
  a.across('Yield + Weight Summary', X.wSec, 24)
  a.row(['Product', '', 'Target', ...dates.map(md), 'Range'].map((t) => xT(t, X.mHead)), 30)
  for (const c of data) {
    const first = a.rows.length + 1
    for (const k of DASH_KINDS) a.row([xT(k === 'raw' ? c.code : '', X.wBigN), xT(KIND_NAME[k], X.wLeft), xT(target(c.target[k]), X.wTarget), ...c.days.map((d) => avgCell(d[k])), avgCell(c.all[k])], 24)
    a.merges.push(`A${first}:A${first + 2}`)
  }
  a.across('Each number is the average of every weight taken that day over the whole plant, in ounces, against QA\'s range: green inside, red under, amber over. Blank = nothing weighed. Range = all the days together.', X.note, 34)
  a.gap()
  // each product's days down, and its charts beside
  for (const c of data) {
    a.across(`${c.code} by day`, X.wSec, 24)
    a.row(['Date', 'Raw', 'Cooked', 'Pouch'].map((t) => xT(t, X.mHead)), 30)
    const from1 = a.rows.length + 1
    for (const d of c.days) a.row([dateCell(d.date), avgCell(d.raw), avgCell(d.cooked), avgCell(d.pouch)], 20)
    const to1 = a.rows.length
    a.gap()
    const TALL = 15, at1 = a.gap(TALL), at2 = (a.gap(), a.gap(TALL))
    charts.push({ title: `${c.code} — Raw and Cooked (oz)`, series: ['Raw', 'Cooked'], cat: 0, val: [1, 2], from: from1, to: to1, at: at1, kind: 'line', fmt: '0.00', colors: [DASH_COLORS.raw, DASH_COLORS.cooked], labels: 'none', left: 0, cols: 7, height: TALL, ...MIKE_LOOK, axisTitle: 'Ounces' })
    charts.push({ title: `${c.code} — Pouch (oz)`, series: ['Pouch'], cat: 0, val: [3], from: from1, to: to1, at: at2, kind: 'line', fmt: '0.00', colors: [DASH_COLORS.pouch], labels: 'none', left: 0, cols: 7, height: TALL, ...MIKE_LOOK, axisTitle: 'Ounces' })
    a.gap()
  }
  a.across('HOW IT IS CALCULATED', X.wSec, 24)
  for (const [k, v] of [
    ['Raw / Cooked / Pouch', 'The average of all the weights of that kind taken that day, every room together (Kitchen\'s raw balls, Spiral\'s raw and cooked balls, RTE\'s pouches), in ounces.'],
    ['Target', 'QA\'s range for the code (or the one set in the app\'s Settings › KPI). A day\'s colour says where its average fell.'],
    ['Range', 'The same average over every day of the range together, not an average of the daily averages.'],
    ['PPLH', 'Pounds per labor hour over the range: the pounds (NetSuite) and the hours (HR) of the days that have both, added up, then divided.'],
    ['Yield / Shorts', 'Pending: the pounds per product and what counts as a short are being defined with Mike.'],
  ]) { const r = a.row([xT(k, X.wcBold), xT(v, X.note)], 30); a.merges.push(`B${r}:${colName(widths.length - 1)}${r}`) }
  return [a.done('Dashboard', charts)]
}
