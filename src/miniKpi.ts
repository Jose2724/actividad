import { ASK_MANAGER, CFG, DEPTS, LUNCH, SETUP, consumesOf, dayOf, fmtDur, fmtTime, isMechanical, kpiGet, kpiPut, lineGoalKey, lineNameOf, lineShiftGoalOf, mechanicOf, measureOf, plainDay, shiftAt, shiftGoalOf, shiftsOf, slowCounts, slowUnitOf, wallOfDay, type Dept, type State } from './store'
import { reasonCodeOf } from './reasons'
import { reportOf } from './report'
import { weightsOf, wtBoard, wtRangeLong, wtRowsOfShift, type WtAvg } from './kpi'
import { X, xT, type Cell, type Sheet } from './xlsx'
import { locale, tr } from './i18n'

/**
 * The mini KPI (Santiago through Jose, 2026-10-31): a week of one shift, Sunday to Friday, room by room and day by day.
 * What can be read more than one way is chosen in Ajustes › Mini KPI (Jose: "que se pueda prender o apagar", "para
 * elegir la que necesitamos luego y así evitar programarlo de nuevo"), kept under 'mini:opts' with the KPI's records.
 * It adds nothing to what the floor records: it reads the report's own day, one day at a time
 */
export type MiniOpts = { from: 'code' | 'setup'; by: 'line' | 'room'; grace: number; limit: number; setup: boolean; clean: boolean; lunch: boolean; inUnit: 'lb' | 'kg' | 'oz'; outUnit: 'mezclas' | 'lb' | 'cajas' }
export const MINI_DEFAULT: MiniOpts = { from: 'code', by: 'line', grace: 10, limit: 15, setup: false, clean: true, lunch: false, inUnit: 'lb', outUnit: 'mezclas' }
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
/** the four the report tells apart; also with the Reason Codes on, by their category */
function downKind(reason: string): 'mech' | 'people' | 'clean' | 'lunch' | 'other' {
  const c = reasonCodeOf(reason)
  if (reason === LUNCH || c?.code === 'PLN-01') return 'lunch'
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
  const begin = wallOfDay(s, date, k === 1 ? plan.first : plan.second)
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
  let real = counted.reduce((t, x) => t + made(x), 0), target: number | null = null
  if (lineGoals.length) {
    const mine = counted.filter((x) => lineGoals.some((g) => g.id === x.r.lineId))
    real = mine.reduce((t, x) => t + made(x), 0)
    target = lineGoals.reduce((t, g) => t + (g.goal as number) * hours(mine.filter((x) => x.r.lineId === g.id).reduce((a, x) => a + x.st.working, 0)), 0)
  } else if (roomGoal && counted.length) target = roomGoal * hours(Math.max(...counted.map((x) => x.to)) - Math.min(...counted.map((x) => x.from)))
  const apart = [...rows.filter((x) => !slowCounts(x.r)).reduce((m, x) => { const c = x.r.dept === 'Spiral' ? x.r.extra?.measure ?? '' : x.r.extra?.bin ?? ''; return m.set(c, (m.get(c) ?? 0) + x.qty) }, new Map<string, number>())].map(([w, n]) => Math.round(n * 100) / 100 + ' ' + (w === 'lb' ? tr('lb') : w))
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
export type MiniTable = { title: string; head: string[]; rows: MiniCell[][]; note?: string }
const n0 = (x: number) => Math.round(x).toLocaleString('en-US')
const n2 = (x: number) => String(Math.round(x * 100) / 100)
const pctOf = (x: number) => Math.round(x * 1000) / 10 + '%'
const IN_UNIT = { lb: 1, kg: 0.45359237, oz: 16 } as const
const avgOf = (list: WtAvg[]) => { const has = list.filter((x) => x.avg != null); const n = has.reduce((t, x) => t + (x.n || 1), 0); return n ? has.reduce((t, x) => t + (x.avg as number) * (x.n || 1), 0) / n : null }
/** the week as tables, the same for the screen and the Excel */
export function miniTables(w: MiniWeek): MiniTable[] {
  const { o } = w, none: MiniCell = { t: '—' }, label = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short', day: 'numeric' })
  const head = (first: string) => [first, ...w.days.map(label), tr('Semana')]
  const roomRows = (rooms: typeof w.rooms, name: (d: Dept) => string, cell: (x: RoomDay) => MiniCell, all: (list: RoomDay[]) => MiniCell) => rooms.map((r) => { const had = r.days.filter((x): x is RoomDay => !!x); return [{ t: name(r.dept) }, ...r.days.map((x) => (x ? cell(x) : none)), had.length ? all(had) : none] })
  const dept = (d: Dept) => d
  const startCell = (x: RoomDay): MiniCell => (x.start ? { t: fmtTime(x.start.at) + (x.start.lateLines && o.by === 'line' ? ' · ' + x.start.lateLines + '/' + x.start.lines : ''), c: x.start.late ? 'bad' : 'ok' } : none)
  const startAll = (list: RoomDay[]): MiniCell => { const has = list.filter((x) => x.start); if (!has.length) return none; const off = has.reduce((t, x) => t + (x.start?.off ?? 0), 0) / has.length, last = has[has.length - 1].start; return { t: fmtTime((last?.at ?? 0) - (last?.off ?? 0) * 60_000 + off * 60_000), c: off > o.grace ? 'bad' : 'ok' } }
  const made = (real: number, target: number | null, apart: string[]): MiniCell => { const more = apart.length ? ' + ' + apart.join(', ') : ''; if (!real && !target && !apart.length) return none; if (!target) return { t: n0(real) + more }; const p = real / target; return { t: n0(real) + ' / ' + n0(target) + ' · ' + pctOf(p) + more, c: p >= 1 ? 'ok' : p >= 0.9 ? 'warn' : 'bad' } }
  const downCell = (down: number, time: number): MiniCell => (time ? { t: pctOf(down / time) + ' · ' + fmtDur(down), c: (down / time) * 100 > o.limit ? 'bad' : 'ok' } : none)
  const inOf = (lb: number) => n2(lb * IN_UNIT[o.inUnit]) + ' ' + tr(o.inUnit)
  const outOf = (n: number | null) => (n == null ? '—' : o.outUnit === 'mezclas' ? n0(n) + ' ' + tr('mezclas') : n2(n) + ' ' + (o.outUnit === 'lb' ? tr('lb') : tr('cajas')))
  const sum = (list: RoomDay[], f: (x: RoomDay) => number) => list.reduce((t, x) => t + f(x), 0)
  const cooks = w.rooms.filter((r) => r.dept === 'Kitchen' || r.dept === 'Spiral')
  const partName = { raw: tr('Crudo'), cooked: tr('Cocinado'), pouch: tr('Pouch') }
  const wtCell = (x: WtAvg | null): MiniCell => (x?.avg == null ? none : { t: x.avg.toFixed(2), c: x.ok === 'ok' ? 'ok' : x.ok === 'under' ? 'bad' : x.ok === 'over' ? 'warn' : undefined })
  return [
    { title: tr('Arranque'), head: head(tr('Departamento')), rows: roomRows(w.rooms, dept, startCell, startAll), note: tr('{0}, {1}. En rojo después de {2} minutos.', o.from === 'setup' ? tr('Desde el Set up') : tr('Desde que empieza el código'), o.by === 'room' ? tr('la primera línea del cuarto') : tr('promedio de sus líneas'), o.grace) },
    { title: tr('Producción: real, meta y % de éxito'), head: head(tr('Departamento')), rows: roomRows(w.rooms, (d) => d + ' (' + slowUnitOf(d) + ')', (x) => made(x.real, x.target, x.apart), (list) => made(sum(list, (x) => x.real), list.some((x) => x.target) ? sum(list, (x) => x.target ?? 0) : null, [])), note: tr('La meta de cada día × las horas que corrió, sin paros. Lo que se contó en otra medida va aparte y no entra en el %.') },
    { title: tr('Paros: % del tiempo trabajado'), head: head(tr('Departamento')), rows: roomRows(w.rooms, dept, (x) => downCell(x.down, x.time), (list) => downCell(sum(list, (x) => x.down), sum(list, (x) => x.time))), note: tr('En rojo sobre {0}%. Cuentan: mecánico, personal y otros{1}{2}{3}.', o.limit, o.clean ? ', ' + tr('limpieza') : '', o.lunch ? ', ' + tr('lunch') : '', o.setup ? ', ' + tr('Set up') : '') },
    { title: tr('Por qué se paró en la semana'), head: [tr('Departamento'), tr('Mecánico'), tr('No personal'), tr('Limpieza'), tr('Otros')], rows: w.rooms.map((r) => { const l = r.days.filter((x): x is RoomDay => !!x), t = (f: (x: RoomDay) => number) => ({ t: sum(l, f) ? fmtDur(sum(l, f)) : '—' }); return [{ t: r.dept }, t((x) => x.mech), t((x) => x.people), t((x) => x.clean), t((x) => x.other)] }) },
    { title: tr('Paros mecánicos'), head: [tr('Día'), tr('Departamento'), tr('Línea'), tr('Hora'), tr('Tiempo'), tr('Mecánico'), tr('Razón')], rows: w.mechanics.map((m) => [{ t: label(m.date) }, { t: m.dept }, { t: m.line }, { t: fmtTime(m.at) }, { t: fmtDur(m.ms) }, m.who ? { t: m.who } : { t: tr('Sin nombre'), c: 'warn' }, { t: tr(m.reason) }]) },
    { title: tr('Consumo: lo que entra y lo que sale'), head: head(tr('Departamento')), rows: roomRows(cooks, dept, (x) => (x.in || x.out != null ? { t: inOf(x.in) + ' → ' + outOf(x.out) } : none), (list) => ({ t: inOf(sum(list, (x) => x.in)) + ' → ' + outOf(list.some((x) => x.out != null) ? sum(list, (x) => x.out ?? 0) : null) })) },
    { title: tr('Waste (lb)'), head: head(tr('Departamento')), rows: roomRows(w.rooms, dept, (x) => ({ t: x.waste ? n2(x.waste) : '—' }), (list) => ({ t: sum(list, (x) => x.waste) ? n2(sum(list, (x) => x.waste)) : '—' })) },
    { title: tr('Pesos: promedio por día (oz)'), head: head(tr('Código')), rows: w.weights.map((x) => { const r = x.days.find((d) => d?.range)?.range; const all = x.days.filter((d): d is WtAvg => !!d), a = avgOf(all); return [{ t: x.code + ' · ' + partName[x.part] + (r ? ' (' + wtRangeLong(r) + ')' : '') }, ...x.days.map(wtCell), a == null ? none : { t: a.toFixed(2) }] }) },
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
