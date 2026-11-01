import { ASK_MANAGER, CFG, DEPTS, LUNCH, SETUP, awayDay, consumesOf, dayOf, fmtDur, fmtTime, isMechanical, kpiGet, kpiPut, lineGoalKey, lineNameOf, lineShiftGoalOf, mechanicOf, measureOf, plainDay, shiftAt, shiftGoalOf, shiftsOf, slowCounts, slowUnitOf, wallOfDay, type Dept, type State } from './store'
import { reasonCodeOf } from './reasons'
import { reportOf } from './report'
import { weightsOf, wtBoard, wtRangeLong, wtRowsOfShift, type WtAvg } from './kpi'
import { X, xN, xT, type Cell, type Chart, type Sheet } from './xlsx'
import { locale, tr } from './i18n'
import type { NumberId } from './Numbers'

/**
 * The mini KPI (Santiago through Jose, 2026-10-31): a week of one shift, Sunday to Friday, room by room and day by day.
 * What can be read more than one way is chosen in Ajustes › Mini KPI (Jose: "que se pueda prender o apagar", "para
 * elegir la que necesitamos luego y así evitar programarlo de nuevo"), kept under 'mini:opts' with the KPI's records.
 * It adds nothing to what the floor records: it reads the report's own day, one day at a time
 */
export type MiniOpts = { start2: string; startOne: string; from: 'code' | 'setup'; by: 'line' | 'room'; grace: number; limit: number; setup: boolean; clean: boolean; lunch: boolean; inUnit: 'lb' | 'kg' | 'oz'; outUnit: 'mezclas' | 'lb' | 'cajas' }
export const MINI_DEFAULT: MiniOpts = { start2: '15:30', startOne: '06:00', from: 'code', by: 'line', grace: 10, limit: 15, setup: false, clean: true, lunch: false, inUnit: 'lb', outUnit: 'mezclas' }
export const miniOpts = (s: State): MiniOpts => ({ ...MINI_DEFAULT, ...(kpiGet(s, 'mini:opts')?.data as Partial<MiniOpts> | undefined) })
export const setMiniOpts = (o: MiniOpts) => kpiPut('mini:opts', o)

/** the week of a date, Sunday to Friday (the plant's Saturday is not in it) */
export function miniDays(date: string) {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() - d.getDay())
  return Array.from({ length: 6 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return dayOf(x.getTime()) })
}
/**
 * A goal as it stood on a day: it changes from one day to another (Jose: "un día pone estas metas y otro día otras"),
 * and the app keeps only the one in force, so a past day reads its own from the history of that goal: the last change
 * up to that day, or what the first change after it found. With no change in the history, the one in force
 */
function goalOn(s: State, key: string, date: string, now: number | null) {
  const list = s.changes.filter((c) => c.refTable === 'act_targets' && c.refKey === key && c.what.endsWith('· por hora')).sort((a, b) => a.at - b.at)
  const said = (t: string) => Number(t) || null
  const upTo = list.filter((c) => plainDay(s, c.at) <= date), last = upTo[upTo.length - 1]
  return last ? said(last.after) : list.length ? said(list[0].before) : now
}
const CLEAN = 'Limpieza', PEOPLE = 'Falta de personal'
/** a pause the plant plans, however it was written; "Break" is the list's own word when the shift's stop rules are off */
const PAUSE = /\b(lunch|break|comida|almuerzo|descanso)\b/i
/** the four the report tells apart; also with the Reason Codes on, by their category */
function downKind(reason: string): 'mech' | 'people' | 'clean' | 'lunch' | 'other' {
  const c = reasonCodeOf(reason)
  if (reason === LUNCH || c?.code === 'PLN-01' || PAUSE.test(reason)) return 'lunch'
  if (reason === CLEAN || c?.code === 'PLN-04') return 'clean'
  if (reason === PEOPLE || c?.cat === 'lab') return 'people'
  return isMechanical(reason) || c?.cat === 'eqp' ? 'mech' : 'other'
}
type RoomDay = {
  /** when it started (the average of its lines, or the room's first), how far from the shift's start, in minutes */
  start: { at: number; off: number; late: boolean; lines: number; lateLines: number } | null
  real: number; target: number | null; apart: string[]
  time: number; down: number; mech: number; people: number; clean: number; other: number
  in: number; out: number | null; waste: number
}
function roomDay(s: State, date: string, dept: Dept, k: 1 | 2, o: MiniOpts, now: number): RoomDay {
  const rep = reportOf(s, date, now, { only: dept, shift: k }), plan = shiftsOf(s, date, dept), rows = rep.rows
  // (the hour the floor is expected, Santiago's 3:30 and not the hand-over the app counts by; a day of one shift starts in the morning: 2026-11-01, a Sunday at 6:07 AM read as 9 hours early)
  const begin = wallOfDay(s, date, k === 1 ? plan.first : plan.only ? o.startOne : o.start2)
  // ---- the start: each line's first code of the shift, or its first Set up; one already running came on time ----
  const firsts = new Map<string, number>()
  const seen = (line: string, at: number) => firsts.set(line, Math.min(firsts.get(line) ?? Infinity, at))
  for (const x of rows) seen(x.r.lineId, x.r.date === date && shiftAt(plan, x.r.startedAt) === k ? x.r.startedAt : begin)
  if (o.from === 'setup') for (const y of s.stops) if (!y.deleted && y.dept === dept && y.reason === SETUP && y.lineId && plainDay(s, y.startedAt) === date && shiftAt(plan, y.startedAt) === k) seen(y.lineId, y.startedAt)
  const times = [...firsts.values()], limit = begin + o.grace * 60_000
  const at = !times.length ? 0 : o.by === 'room' ? Math.min(...times) : times.reduce((a, b) => a + b, 0) / times.length
  const start = times.length ? { at, off: (at - begin) / 60_000, late: at > limit, lines: times.length, lateLines: times.filter((t) => t > limit).length } : null
  // ---- what was made against the goal: a line's own goal, else the room's; what is counted in another word is told apart ----
  const counted = rows.filter((x) => slowCounts(x.r)), made = (x: (typeof rows)[number]) => (CFG[dept].qty === 'none' ? x.units : x.qty), hours = (ms: number) => ms / 3_600_000
  const lineGoals = [...new Set(counted.map((x) => x.r.lineId))].map((id) => ({ id, goal: goalOn(s, lineGoalKey(id, k), date, lineShiftGoalOf(s, id, k).perHour) })).filter((g) => g.goal)
  const roomGoal = goalOn(s, dept + '@' + k, date, shiftGoalOf(s, dept, k).perHour)
  let real = counted.reduce((t, x) => t + made(x), 0), target: number | null = null, noGoal = 0
  if (lineGoals.length) {
    const mine = counted.filter((x) => lineGoals.some((g) => g.id === x.r.lineId))
    noGoal = real - mine.reduce((t, x) => t + made(x), 0)
    real -= noGoal
    target = lineGoals.reduce((t, g) => t + (g.goal as number) * hours(mine.filter((x) => x.r.lineId === g.id).reduce((a, x) => a + x.st.working, 0)), 0)
  } else if (roomGoal && counted.length) target = roomGoal * hours(Math.max(...counted.map((x) => x.to)) - Math.min(...counted.map((x) => x.from)))
  const apart = [...rows.filter((x) => !slowCounts(x.r)).reduce((m, x) => { const c = x.r.dept === 'Spiral' ? x.r.extra?.measure ?? '' : x.r.extra?.bin ?? ''; return m.set(c, (m.get(c) ?? 0) + x.qty) }, new Map<string, number>())].map(([w, n]) => Math.round(n * 100) / 100 + ' ' + (w === 'lb' ? tr('lb') : w))
  if (noGoal) apart.push(tr('{0} sin meta', Math.round(noGoal * 100) / 100))
  // ---- stops: over all the time the lines had a code; what counts as a stop is chosen in Ajustes ----
  const ms = { mech: 0, people: 0, clean: 0, lunch: 0, other: 0 }
  for (const x of rows) for (const [r, t] of Object.entries(x.st.reasons)) if (r !== SETUP) ms[downKind(r)] += t
  const setup = rows.reduce((t, x) => t + x.st.setup, 0), time = rows.reduce((t, x) => t + x.st.working + x.st.down + x.st.setup, 0)
  const down = ms.mech + ms.people + ms.other + (o.clean ? ms.clean : 0) + (o.lunch ? ms.lunch : 0) + (o.setup ? setup : 0)
  // ---- what goes in and comes out, and what was thrown away ----
  const consumed = consumesOf(s, date, dept).filter((x) => shiftAt(plan, x.at) === k).reduce((t, x) => t + Math.max(0, x.lb - (x.left ?? 0)), 0)
  const out = o.outUnit === 'mezclas' ? rows.filter((x) => !measureOf(x.r)).reduce((t, x) => t + x.units, 0) : rows.filter((x) => measureOf(x.r) === o.outUnit).reduce((t, x) => t + x.qty, 0)
  return { start, real, target, apart, time, down, mech: ms.mech, people: ms.people, clean: ms.clean, other: ms.other, in: consumed, out: rows.length ? out : null, waste: rows.reduce((t, x) => t + (x.waste ?? 0), 0) }
}
export function miniWeek(s: State, date: string, k: 1 | 2, now: number) {
  const o = miniOpts(s), days = miniDays(date), today = plainDay(s, now), shown = days.filter((d) => d <= today)
  const rooms = DEPTS.map((dept) => ({ dept, days: days.map((d) => (d <= today ? roomDay(s, d, dept, k, o, now) : null)) }))
  // the stops the mechanics came to, one by one, with who came (asked on the floor under the shift's rules)
  const mechanics = shown.flatMap((d) => reportOf(s, d, now, { shift: k }).stops.filter((x) => downKind(x.reason) === 'mech' && x.reason !== ASK_MANAGER).map((x) => ({ date: d, dept: x.dept, line: x.lineId ? lineNameOf(s, x.lineId) : tr('Todo {0}', x.dept), at: x.startedAt, ms: x.ms, reason: x.reason, who: mechanicOf(x.note) })))
  const boards = days.map((d) => (d <= today ? wtBoard(s, wtRowsOfShift(s, weightsOf(s, d, now), k)) : []))
  const weights = (boards.find((b) => b.length) ?? []).flatMap((b, i) => (['raw', 'cooked', 'pouch'] as const).map((part) => ({ code: b.code, part, days: boards.map((x) => x[i]?.[part] ?? null) })))
  return { o, days, rooms, mechanics, weights, shift: k }
}
export type MiniWeek = ReturnType<typeof miniWeek>
export type MiniCell = { t: string; c?: 'ok' | 'bad' | 'warn' }
export type MiniTable = { id: NumberId; title: string; head: string[]; rows: MiniCell[][]; note?: string }
const n0 = (x: number) => Math.round(x).toLocaleString('en-US')
const n2 = (x: number) => String(Math.round(x * 100) / 100)
const pctOf = (x: number) => Math.round(x * 1000) / 10 + '%'
const IN_UNIT = { lb: 1, kg: 0.45359237, oz: 16 } as const
const dayLabel = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short', day: 'numeric' })
const avgOf = (list: WtAvg[]) => { const has = list.filter((x) => x.avg != null); const n = has.reduce((t, x) => t + (x.n || 1), 0); return n ? has.reduce((t, x) => t + (x.avg as number) * (x.n || 1), 0) / n : null }
/** the week as tables, the same for the screen and the Excel */
export function miniTables(w: MiniWeek): MiniTable[] {
  const { o } = w, none: MiniCell = { t: '—' }
  const head = (first: string) => [first, ...w.days.map(dayLabel), tr('Semana')]
  const roomRows = (rooms: typeof w.rooms, name: (d: Dept) => string, cell: (x: RoomDay) => MiniCell, all: (list: RoomDay[]) => MiniCell) => rooms.map((r) => { const had = r.days.filter((x): x is RoomDay => !!x); return [{ t: name(r.dept) }, ...r.days.map((x) => (x ? cell(x) : none)), had.length ? all(had) : none] })
  const dept = (d: Dept) => d
  const startCell = (x: RoomDay): MiniCell => (x.start ? { t: fmtTime(x.start.at) + (x.start.lateLines && o.by === 'line' ? ' · ' + x.start.lateLines + '/' + x.start.lines : ''), c: x.start.late ? 'bad' : 'ok' } : none)
  // (the week in minutes: an hour of the day cannot average a Sunday morning with the afternoons)
  const startAll = (list: RoomDay[]): MiniCell => { const has = list.filter((x) => x.start); if (!has.length) return none; const off = has.reduce((t, x) => t + Math.max(0, x.start?.off ?? 0), 0) / has.length; return { t: tr('{0} min tarde', Math.round(off)), c: off > o.grace ? 'bad' : 'ok' } }
  const made = (real: number, target: number | null, apart: string[]): MiniCell => { const more = apart.length ? ' + ' + apart.join(', ') : ''; if (!real && !target && !apart.length) return none; if (!target) return { t: n0(real) + more }; const p = real / target; return { t: n0(real) + ' / ' + n0(target) + ' · ' + pctOf(p) + more, c: p >= 1 ? 'ok' : p >= 0.9 ? 'warn' : 'bad' } }
  const downCell = (down: number, time: number): MiniCell => (time ? { t: pctOf(down / time) + ' · ' + fmtDur(down), c: (down / time) * 100 > o.limit ? 'bad' : 'ok' } : none)
  const inText = (lb: number) => (lb ? n2(lb * IN_UNIT[o.inUnit]) + ' ' + tr(o.inUnit) : tr('Sin pesar'))
  const outOf = (n: number | null) => (n == null ? '—' : o.outUnit === 'mezclas' ? n0(n) + ' ' + tr('mezclas') : n2(n) + ' ' + (o.outUnit === 'lb' ? tr('lb') : tr('cajas')))
  const sum = (list: RoomDay[], f: (x: RoomDay) => number) => list.reduce((t, x) => t + f(x), 0)
  const cooks = w.rooms.filter((r) => r.dept === 'Kitchen' || r.dept === 'Spiral')
  const partName = { raw: tr('Crudo'), cooked: tr('Cocinado'), pouch: tr('Pouch') }
  const wtCell = (x: WtAvg | null): MiniCell => (x?.avg == null ? none : { t: x.avg.toFixed(2), c: x.ok === 'ok' ? 'ok' : x.ok === 'under' ? 'bad' : x.ok === 'over' ? 'warn' : undefined })
  return [
    { id: 'mini-arranque', title: tr('Arranque'), head: head(tr('Departamento')), rows: roomRows(w.rooms, dept, startCell, startAll), note: tr('{0}, {1}. En rojo {2} minutos después de la hora de arranque. La semana dice cuántos minutos tarde en promedio, contando a tiempo como 0.', o.from === 'setup' ? tr('Desde el Set up') : tr('Desde que empieza el código'), o.by === 'room' ? tr('la primera línea del cuarto') : tr('promedio de sus líneas'), o.grace) },
    { id: 'mini-prod', title: tr('Producción: real, meta y % de éxito'), head: head(tr('Departamento')), rows: roomRows(w.rooms, (d) => d + ' (' + slowUnitOf(d) + ')', (x) => made(x.real, x.target, x.apart), (list) => { const goal = list.filter((x) => x.target); return goal.length ? made(sum(goal, (x) => x.real), sum(goal, (x) => x.target ?? 0), []) : made(sum(list, (x) => x.real), null, []) }), note: tr('Hecho / meta · % de éxito. La meta de cada día × sus horas: las que trabajó la línea, o con meta del cuarto, de su primer código al último. Lo contado en otra medida o sin meta va aparte y no entra en el %. La semana solo suma los días con meta.') },
    { id: 'mini-paros', title: tr('Paros: % del tiempo trabajado'), head: head(tr('Departamento')), rows: roomRows(w.rooms, dept, (x) => downCell(x.down, x.time), (list) => downCell(sum(list, (x) => x.down), sum(list, (x) => x.time))), note: tr('En rojo sobre {0}%. Cuentan: mecánico, personal y otros{1}{2}{3}.', o.limit, o.clean ? ', ' + tr('limpieza') : '', o.lunch ? ', ' + tr('lunch') : '', o.setup ? ', ' + tr('Set up') : '') },
    { id: 'mini-causas', title: tr('Por qué se paró en la semana'), head: [tr('Departamento'), tr('Mecánico'), tr('No personal'), tr('Limpieza'), tr('Otros')], rows: w.rooms.map((r) => { const l = r.days.filter((x): x is RoomDay => !!x), t = (f: (x: RoomDay) => number) => ({ t: sum(l, f) ? fmtDur(sum(l, f)) : '—' }); return [{ t: r.dept }, t((x) => x.mech), t((x) => x.people), t((x) => x.clean), t((x) => x.other)] }) },
    { id: 'mini-mec', title: tr('Paros mecánicos'), head: [tr('Día'), tr('Departamento'), tr('Línea'), tr('Hora'), tr('Tiempo'), tr('Mecánico'), tr('Razón')], rows: w.mechanics.map((m) => [{ t: dayLabel(m.date) }, { t: m.dept }, { t: m.line }, { t: fmtTime(m.at) }, { t: fmtDur(m.ms) }, m.who ? { t: m.who } : { t: tr('Sin nombre'), c: 'warn' }, { t: tr(m.reason) }]) },
    { id: 'mini-consumo', title: tr('Consumo: lo que entra y lo que sale'), head: head(tr('Departamento')), rows: roomRows(cooks, dept, (x) => (x.in || x.out != null ? { t: inText(x.in) + ' → ' + outOf(x.out) } : none), (list) => ({ t: inText(sum(list, (x) => x.in)) + ' → ' + outOf(list.some((x) => x.out != null) ? sum(list, (x) => x.out ?? 0) : null) })), note: tr('Sin pesar quiere decir que nadie pesó lo que entró: Consumo está apagado en ese cuarto.') },
    { id: 'mini-waste', title: tr('Waste (lb)'), head: head(tr('Departamento')), rows: roomRows(w.rooms, dept, (x) => ({ t: x.waste ? n2(x.waste) : '—' }), (list) => ({ t: sum(list, (x) => x.waste) ? n2(sum(list, (x) => x.waste)) : '—' })) },
    { id: 'mini-pesos', title: tr('Pesos: promedio por día (oz)'), head: head(tr('Código')), rows: w.weights.map((x) => { const r = x.days.find((d) => d?.range)?.range; const all = x.days.filter((d): d is WtAvg => !!d), a = avgOf(all); return [{ t: x.code + ' · ' + partName[x.part] + (r ? ' (' + wtRangeLong(r) + ')' : '') }, ...x.days.map(wtCell), a == null ? none : { t: a.toFixed(2) }] }) },
  ]
}
/** the same tables, one under the other, on one sheet */
export function miniSheet(w: MiniWeek): Sheet {
  const style = (c: MiniCell): Cell => xT(c.t, c.c === 'ok' ? X.good : c.c === 'bad' ? X.bad : c.c === 'warn' ? X.warn : X.label)
  const rows: Cell[][] = [[xT(tr('Mini KPI · Turno {0} · {1} a {2}', w.shift, w.days[0], w.days[5]), X.title)], []]
  for (const t of miniTables(w)) {
    rows.push([xT(t.title, X.title)], t.head.map((h) => xT(h, X.head)), ...(t.rows.length ? t.rows.map((r) => r.map(style)) : [[xT(tr('Nada esta semana'), X.label)]]))
    if (t.note) rows.push([xT(t.note, X.note)])
    rows.push([])
  }
  return { name: tr('Mini KPI'), rows }
}

/** how many weeks the summary compares, the report's week being the last */
export const MINI_WEEKS = 4
/** the Sundays of those weeks, the oldest first */
export const miniSundays = (date: string) => Array.from({ length: MINI_WEEKS }, (_, i) => { const x = new Date(miniDays(date)[0] + 'T12:00:00'); x.setDate(x.getDate() - 7 * (MINI_WEEKS - 1 - i)); return dayOf(x.getTime()) })
/** every day those weeks hold: older ones have to be brought from the server before they can be compared */
export const miniSpan = (date: string) => miniSundays(date).flatMap(miniDays)

/** what the charts and the summary's table compare: a room over some days, as numbers */
function numsOf(list: (RoomDay | null)[]) {
  const days = list.filter((x): x is RoomDay => !!x && x.time > 0), sum = (l: RoomDay[], f: (x: RoomDay) => number) => l.reduce((t, x) => t + f(x), 0)
  const goal = days.filter((x) => x.target), target = sum(goal, (x) => x.target ?? 0), time = sum(days, (x) => x.time), starts = days.filter((x) => x.start)
  return {
    days: days.length, real: sum(days, (x) => x.real),
    pct: target ? sum(goal, (x) => x.real) / target : null,
    down: time ? sum(days, (x) => x.down) / time : null,
    late: starts.length ? sum(starts, (x) => Math.max(0, x.start?.off ?? 0)) / starts.length : null,
    waste: days.length ? sum(days, (x) => x.waste) / days.length : null,
  }
}
/** the rooms' colours in the charts: one fixed for each room, the plant's order; the rooms' own colours of the screens cannot be told apart on a line */
const ROOM_COLORS = ['2A78D6', 'EB6834', '1BAF7A', 'EDA100', 'E87BA4'], REF_COLOR = '898781'
/** the weeks, the oldest lightest and the week of the report the darkest */
const WEEK_COLORS = ['C79FBB', 'A8789A', '804070', '581447']
const shortDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' })

/**
 * The one sheet to read (Santiago through Jose, 2026-11-01: "summary sheet ... con gráfica que comparan días o semanas"):
 * the week against the one before it, room by room, in numbers; charts of its days and of the last weeks, drawn by Excel
 * from the tables at the foot of the sheet. What is not known stays empty, never a zero: a line then shows a gap.
 * A week that could not be brought whole from the server is left out rather than compared by halves
 */
export function miniSummary(weeks: MiniWeek[]): Sheet {
  const w = weeks[weeks.length - 1], before = weeks[weeks.length - 2], { o } = w, COLS = 10
  const out: Cell[][] = [], heights: Record<number, number> = {}, merges: string[] = [], charts: Chart[] = []
  const row = (cells: Cell[], ht?: number) => { if (ht) heights[out.length] = ht; out.push(cells); return out.length }
  const across = (text: string, style: number, ht: number) => { const r = row([xT(text, style), ...Array.from({ length: COLS - 1 }, () => xT('', style))], ht); merges.push('A' + r + ':J' + r) }
  const gap = (n = 1) => { const at = out.length + 1; for (let i = 0; i < n; i++) row([]); return at }
  const empty = xT('', X.wCell), none = xT('—', X.wCell)
  const whole = (x: MiniWeek) => !x.days.some(awayDay)
  const numsAt = (x: MiniWeek, i: number) => (whole(x) ? numsOf(x.rooms[i].days) : null)
  const delta = (now: number | null | undefined, then: number | null | undefined, up: boolean, unit: string, scale = 1): Cell => {
    if (now == null || then == null) return none
    const d = Math.round((now - then) * scale * 10) / 10
    return !d ? xT(tr('Igual'), X.wCell) : xT((d > 0 ? '▲ +' : '▼ −') + Math.abs(d) + ' ' + unit, d > 0 === up ? X.wPg : X.wPr)
  }
  const pctCell = (x: number | null) => (x == null ? none : xN(x, x >= 1 ? X.wPg : x >= 0.9 ? X.wPa : X.wPr))
  const downCell = (x: number | null) => (x == null ? none : xN(x, x * 100 > o.limit ? X.wPr : X.wPg))
  const lateCell = (x: number | null) => (x == null ? none : xN(Math.round(x), x > o.grace ? X.wNr : X.wNg))
  const round1 = (x: number) => Math.round(x * 10) / 10

  across(tr('Mini KPI · Resumen · Turno {0}', w.shift), X.wBand, 34)
  across(tr('Semana del {0} al {1}, contra la semana del {2}', w.days[0], w.days[5], before.days[0]), X.wSub, 22)
  const now = w.rooms.map((_, i) => numsAt(w, i)), then = before.rooms.map((_, i) => numsAt(before, i))
  const said = (test: (x: NonNullable<(typeof now)[number]>) => boolean) => w.rooms.filter((_, i) => { const x = now[i]; return !!x && test(x) }).map((r) => r.dept).join(', ')
  const met = said((x) => x.pct != null && x.pct >= 1), short = said((x) => x.pct != null && x.pct < 1), over = said((x) => x.down != null && x.down * 100 > o.limit), late = said((x) => x.late != null && x.late > o.grace)
  const lines = [met && tr('Cumplió la meta: {0}.', met), short && tr('No llegó a la meta: {0}.', short), over && tr('Paros sobre {0}%: {1}.', o.limit, over), late && tr('Arrancó tarde: {0}.', late)].filter(Boolean)
  across(lines.length ? lines.join(' ') : tr('Esta semana todavía no tiene nada que juzgar: faltan metas o trabajo registrado.'), X.wSay, 34)
  gap()

  // ---- the week, room by room ----
  across(tr('La semana, cuarto por cuarto'), X.wSec, 24)
  row([tr('Departamento'), tr('Hecho'), tr('% de la meta'), tr('Contra la pasada'), tr('Paros'), tr('Contra la pasada'), tr('Arranque (minutos tarde)'), tr('Contra la pasada'), tr('Waste por día (lb)'), tr('Contra la pasada')].map((t) => xT(t, X.wHead)), 46)
  w.rooms.forEach((r, i) => {
    const a = now[i], b = then[i]
    row([xT(r.dept, X.wLeft), a?.real ? xT(Math.round(a.real).toLocaleString('en-US') + ' ' + slowUnitOf(r.dept), X.wCell) : none, pctCell(a?.pct ?? null), delta(a?.pct, b?.pct, true, tr('pts'), 100), downCell(a?.down ?? null), delta(a?.down, b?.down, false, tr('pts'), 100), lateCell(a?.late ?? null), delta(a?.late, b?.late, false, tr('min')), a?.waste == null ? none : xN(round1(a.waste), X.wD), delta(a?.waste, b?.waste, false, tr('lb'))], 22)
  })
  across(tr('▲ subió y ▼ bajó contra la semana pasada; el color dice si eso es bueno (verde) o malo (rojo). En Paros, Arranque y Waste, bajar es lo bueno.'), X.note, 32)
  gap()

  // ---- the charts: a place for them now, their numbers at the foot of the sheet ----
  const TALL = 16, left = { left: 0, cols: 5, height: TALL }, right = { left: 5, cols: 10, height: TALL }
  across(tr('Día por día'), X.wSec, 24)
  const dayAt = gap(TALL)
  gap()
  across(tr('Semana contra semana'), X.wSec, 24)
  const weekAt = gap(TALL)
  gap()
  const weekAt2 = gap(TALL)
  gap()

  // ---- the weights ----
  across(tr('Pesos: promedio de la semana (oz)'), X.wSec, 24)
  row([tr('Código'), tr('Rango de QA'), tr('Esta semana'), tr('La pasada'), tr('Diferencia')].map((t) => xT(t, X.wHead)), 30)
  const partName = { raw: tr('Crudo'), cooked: tr('Cocinado'), pouch: tr('Pouch') }
  const avgs = (x: MiniWeek | undefined, code: string, part: string) => { const l = x?.weights.find((y) => y.code === code && y.part === part)?.days.filter((d): d is WtAvg => !!d); return l ? avgOf(l) : null }
  const shown = (whole(w) ? w.weights : []).filter((x) => avgs(w, x.code, x.part) != null || avgs(before, x.code, x.part) != null)
  for (const x of shown) {
    const a = avgs(w, x.code, x.part), b = whole(before) ? avgs(before, x.code, x.part) : null, range = x.days.find((d) => d?.range)?.range ?? ''
    const [lo, hi] = range.split('–').map(Number), off = a == null || !range ? null : a < lo ? 'under' : a > hi ? 'over' : 'ok'
    const diff = a == null || b == null ? null : Math.round((a - b) * 100) / 100
    row([xT(x.code + ' · ' + partName[x.part], X.wLeft), range ? xT(wtRangeLong(range), X.wCell) : none, a == null ? none : xN(Math.round(a * 100) / 100, off === 'ok' ? X.wDg : off === 'under' ? X.wDr : off === 'over' ? X.wDa : X.wD), b == null ? none : xN(Math.round(b * 100) / 100, X.wD), diff == null ? none : xT((diff > 0 ? '+' : diff < 0 ? '−' : '') + Math.abs(diff).toFixed(2), X.wCell)], 22)
  }
  if (!shown.length) row([xT(tr('Nada esta semana'), X.wLeft)], 22)
  gap()

  // ---- the numbers of the charts ----
  across(tr('Los números de las gráficas'), X.wSec, 24)
  const dayTable = (title: string, value: (x: ReturnType<typeof numsOf>) => number | null, target: number, refName: string, fmt: string): Chart => {
    row([title, ...w.rooms.map((r) => r.dept), refName].map((t) => xT(t, X.wHead)), 30)
    const from = out.length + 1
    w.days.forEach((d, i) => { row([xT(dayLabel(d), X.wLeft), ...w.rooms.map((r) => { const v = awayDay(d) ? null : value(numsOf([r.days[i]])); return v == null ? empty : xN(v, X.wP) }), xN(target, X.wP)]) })
    const to = out.length
    gap()
    return { title, series: [...w.rooms.map((r) => r.dept), refName], cat: 0, val: [...w.rooms.map((_, i) => i + 1), w.rooms.length + 1], from, to, at: 0, kind: 'line', fmt, colors: [...ROOM_COLORS, REF_COLOR], labels: 'none', refs: [w.rooms.length] }
  }
  const weekTable = (title: string, value: (x: ReturnType<typeof numsOf>) => number | null, style: number, fmt: string): Chart => {
    const names = weeks.map((x) => tr('Sem. {0}', shortDay(x.days[0])))
    row([title, ...names].map((t) => xT(t, X.wHead)), 30)
    const from = out.length + 1
    w.rooms.forEach((r, i) => { row([xT(r.dept, X.wLeft), ...weeks.map((x) => { const n = numsAt(x, i), v = n && value(n); return v == null ? empty : xN(v, style) })]) })
    const to = out.length
    gap()
    return { title, series: names, cat: 0, val: weeks.map((_, i) => i + 1), from, to, at: 0, kind: 'col', fmt, colors: WEEK_COLORS, labels: 'last' }
  }
  charts.push({ ...dayTable(tr('% de la meta por día'), (x) => x.pct, 1, tr('Meta (100%)'), '0%'), at: dayAt, ...left })
  charts.push({ ...dayTable(tr('% de paros por día'), (x) => x.down, o.limit / 100, tr('Límite ({0}%)', o.limit), '0%'), at: dayAt, ...right })
  charts.push({ ...weekTable(tr('% de la meta por semana'), (x) => x.pct, X.wP, '0%'), at: weekAt, ...left })
  charts.push({ ...weekTable(tr('% de paros por semana'), (x) => x.down, X.wP, '0%'), at: weekAt, ...right })
  charts.push({ ...weekTable(tr('Arranque: minutos tarde por semana'), (x) => (x.late == null ? null : Math.round(x.late)), X.wN, '0'), at: weekAt2, ...left })
  charts.push({ ...weekTable(tr('Waste por día (lb) por semana'), (x) => (x.waste == null ? null : round1(x.waste)), X.wD, '0.0'), at: weekAt2, ...right })
  if (!weeks.every(whole)) across(tr('Las semanas que no se pudieron traer completas del servidor salen vacías.'), X.note, 22)
  return { name: tr('Resumen'), rows: out, charts, freeze: 0, page: { widths: [17, 14, 12, 13, 12, 13, 13, 13, 13, 13], heights, merges } }
}
/** what each table says, for the Excel and for the window of what each number means */
export const miniGuide = (): { id: NumberId; title: string; means: string; math: string; eg: string }[] => [
  { id: 'mini-arranque', title: tr('Arranque'),
    means: tr('A qué hora empezó a trabajar cada cuarto en ese turno.'),
    math: tr('La hora en que cada línea empezó su primer código del turno (o su Set up, si Ajustes lo dice), y el promedio de las líneas (o solo la primera). Una línea que ya venía corriendo cuenta a tiempo. Sale en rojo pasados los minutos de gracia después de la hora de arranque de Ajustes. Si dice 1/3, 1 de sus 3 líneas llegó tarde. La semana dice los minutos tarde en promedio.'),
    eg: tr('Turno a las 3:30 y 10 minutos de gracia: 3:38 PM va en verde; 3:52 PM · 2/3 va en rojo, y 2 de 3 líneas llegaron tarde.') },
  { id: 'mini-prod', title: tr('Producción: real, meta y % de éxito'),
    means: tr('Lo que se hizo contra lo que se debió hacer con la meta de ese día.'),
    math: tr('Cada celda dice hecho / meta · %. Con meta por línea, la meta × las horas que esa línea trabajó, sin paros; las líneas sin meta se dicen aparte y no entran en el %. Con meta del cuarto, la meta × las horas desde el primer código hasta el último, paros incluidos. Verde desde 100%, amarillo desde 90%, rojo menos. Cambiar la meta hoy no cambia los días pasados.'),
    eg: tr('Meta 12 por hora y 1 hora trabajando: se esperan 12. Con 6 hechas dice 6 / 12 · 50%.') },
  { id: 'mini-paros', title: tr('Paros: % del tiempo trabajado'),
    means: tr('Qué parte del tiempo las líneas estuvieron paradas.'),
    math: tr('El tiempo parado que cuenta ÷ todo el tiempo que las líneas tuvieron un código, sumando las líneas. Siempre cuentan Mecánico, No personal y las demás razones; Limpieza, Set up y Lunch (o Break) solo si Ajustes lo dice. Sale en rojo sobre el límite de Ajustes.'),
    eg: tr('2 líneas de 8 horas son 16 horas. Con 2 horas de paros dice 12.5% · 2 h.') },
  { id: 'mini-causas', title: tr('Por qué se paró en la semana'),
    means: tr('El tiempo parado de toda la semana, separado por la causa.'),
    math: tr('La suma de los paros de cada cuarto en Mecánico, No personal, Limpieza y Otros. Lunch, Break y Set up no salen aquí.'),
    eg: tr('Mecánico 3 h 20 min en RTE: entre todas sus líneas estuvieron 3 h 20 min paradas por mecánico.') },
  { id: 'mini-mec', title: tr('Paros mecánicos'),
    means: tr('Cada paro mecánico, uno por uno, con quién lo atendió.'),
    math: tr('Día, cuarto, línea, hora, cuánto duró y el mecánico. Sin nombre quiere decir que nadie escribió al mecánico: el nombre se pide solo con las reglas de paros prendidas en ese turno.'),
    eg: tr('Mar 27 · RTE · Línea 2 · 4:10 PM · 25 min · Carlos.') },
  { id: 'mini-consumo', title: tr('Consumo: lo que entra y lo que sale'),
    means: tr('Cuánto entró a Kitchen y Spiral y cuánto salió de ahí.'),
    math: tr('Entra = lo pesado antes de empezar menos lo que sobró; sale vacío si el Consumo no está prendido en ese cuarto. Sale = las mezclas hechas, o las libras o cajas si Ajustes lo dice.'),
    eg: tr('900 lb → 18 mezclas: entraron 900 libras y salieron 18 mezclas.') },
  { id: 'mini-waste', title: tr('Waste (lb)'),
    means: tr('Las libras de desperdicio que se registraron.'),
    math: tr('La suma del waste escrito en los códigos del cuarto ese día. La semana es la suma; en el Resumen va por día con trabajo, para comparar bien una semana corta.'),
    eg: tr('12.5 lb el martes y 7.5 lb el miércoles: 20 lb en la semana, 10 lb por día.') },
  { id: 'mini-pesos', title: tr('Pesos: promedio por día (oz)'),
    means: tr('El peso promedio de cada código, día por día, en ese turno.'),
    math: tr('El promedio de todo lo pesado ese día, por código y parte (crudo, cocinado o pouch). Verde dentro del rango de QA, rojo por debajo, amarillo por encima. Semana es el promedio de todo lo pesado.'),
    eg: tr('0889 · Cocinado (2.30–2.40): 2.34 va en verde; 2.21 va en rojo.') },
]
/** the guide as a sheet, for whoever receives the Excel */
export function miniGuideSheet(): Sheet {
  const widths = [24, 38, 64, 40], heights: Record<number, number> = {}
  const rows: Cell[][] = [[xT(tr('Qué significa cada número del Mini KPI'), X.title)], [], [tr('Tabla'), tr('Qué dice'), tr('Cómo se saca'), tr('Ejemplo')].map((t) => xT(t, X.head))]
  for (const g of miniGuide()) {
    const texts = [g.title, g.means, g.math, g.eg]
    heights[rows.length] = 15 * Math.max(...texts.map((t, i) => Math.ceil((t.length * 1.15) / widths[i]))) + 6
    rows.push(texts.map((t) => xT(t, X.note)))
  }
  return { name: tr('Qué significa'), rows, freeze: 3, page: { widths, heights, merges: [] } }
}
/** the workbook: first the page to read, then the week's tables and what each one means */
export function miniBook(s: State, date: string, k: 1 | 2, now: number): Sheet[] {
  const weeks = miniSundays(date).map((d) => miniWeek(s, d, k, now))
  return [miniSummary(weeks), miniSheet(weeks[weeks.length - 1]), miniGuideSheet()]
}
