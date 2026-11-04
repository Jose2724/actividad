import { ASK_MANAGER, CFG, DEPTS, LUNCH, SETUP, attendanceOf, awayDay, consumesOf, dayOf, fmtDur, fmtTime, isMechanical, kpiGet, kpiPut, lineGoalKey, lineNameOf, lineShiftGoalOf, mechanicOf, measureOf, plainDay, shiftAt, shiftGoalOf, shiftsOf, slowCounts, slowUnitOf, wallOfDay, type Dept, type State } from './store'
import { reasonCodeOf } from './reasons'
import { reportOf } from './report'
import { weightsOf, wtBoard, wtRangeLong, wtRowsOfShift, type WtAvg, type WtRow } from './kpi'
import { X, colName, xN, xT, type Cell, type Chart, type Sheet } from './xlsx'
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
export function downKind(reason: string): 'mech' | 'people' | 'clean' | 'lunch' | 'other' {
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
  time: number; down: number; mech: number; people: number; clean: number; other: number; lunch: number; worked: number; setup: number
  in: number; out: number | null; waste: number
  /** when the shift's last record was made (Santiago's "End time"), and the people written in the attendance against those expected */
  end: number | null; att: { expected: number; actual: number }; wt: number | null
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
  const att = attendanceOf(s, date, k, [dept]).rows[0]
  return { end: rows.length ? Math.max(...rows.map((x) => x.to)) : null, att: { expected: att?.expected ?? 0, actual: att?.actual ?? 0 }, wt: null, start, real, target, apart, time, down, mech: ms.mech, people: ms.people, clean: ms.clean, other: ms.other, lunch: ms.lunch, worked: rows.reduce((t, x) => t + x.st.working, 0), setup, in: consumed, out: rows.length ? out : null, waste: rows.reduce((t, x) => t + (x.waste ?? 0), 0) }
}
export function miniWeek(s: State, date: string, k: 1 | 2, now: number) {
  // (this KPI is one shift's and nothing of the other may mix in, Jose 2026-11-01: a day of one shift is that shift's alone; asked for the other, the report would give the whole day)
  const counts = (d: string) => { const only = shiftsOf(s, d).only; return d <= plainDay(s, now) && (!only || only === k) }
  const o = miniOpts(s), days = miniDays(date), shown = days.filter(counts), today = plainDay(s, now)
  const weighed = days.map((d) => (d <= plainDay(s, now) ? wtRowsOfShift(s, weightsOf(s, d, now), k) : []))
  // the room's weight of the day (Santiago's "Weight" row): Kitchen's raw balls, Spiral's cooked balls, RTE's pouches, in ounces
  const wtOf = (i: number, dept: Dept): number | null => { const kind = dept === 'Kitchen' ? 'raw' : dept === 'Spiral' ? 'ball' : dept === 'RTE' ? 'pouch' : ''; if (!kind) return null; const ws = weighed[i].filter((x) => x.dept === dept && x.kind === kind).flatMap((x) => x.tests.flatMap((y) => y.entries.flatMap((e) => (e.w != null ? [e.w] : [])))); return ws.length ? Math.round((ws.reduce((a, b) => a + b, 0) / ws.length) * 100) / 100 : null }
  const rooms = DEPTS.map((dept) => ({ dept, days: days.map((d, i) => (counts(d) ? { ...roomDay(s, d, dept, k, o, now), wt: wtOf(i, dept) } : null)) }))
  // the stops the mechanics came to, one by one, with who came (asked on the floor under the shift's rules)
  const mechanics = shown.flatMap((d) => reportOf(s, d, now, { shift: k }).stops.filter((x) => downKind(x.reason) === 'mech' && x.reason !== ASK_MANAGER).map((x) => ({ date: d, dept: x.dept, line: x.lineId ? lineNameOf(s, x.lineId) : tr('Todo {0}', x.dept), at: x.startedAt, ms: x.ms, reason: x.reason, who: mechanicOf(x.note) })))
  const table = (list: WtRow[][]) => { const boards = list.map((r, i) => (days[i] <= today ? wtBoard(s, r) : [])); return (boards.find((b) => b.length) ?? []).flatMap((b, i) => (['raw', 'cooked', 'pouch'] as const).map((part) => ({ code: b.code, part, days: boards.map((x) => x[i]?.[part] ?? null) }))) }
  const roomWeights = new Map(DEPTS.map((dept) => [dept, table(weighed.map((r) => r.filter((x) => x.dept === dept)))]))
  return { o, days, rooms, mechanics, weights: table(weighed), roomWeights, shift: k }
}
export type MiniWeek = ReturnType<typeof miniWeek>
export type MiniCell = { t: string; c?: 'ok' | 'bad' | 'warn' }
export type MiniTable = { id: NumberId; title: string; head: string[]; rows: MiniCell[][]; note?: string }
const n0 = (x: number) => Math.round(x).toLocaleString('en-US')
const n2 = (x: number) => String(Math.round(x * 100) / 100)
const pctOf = (x: number) => Math.round(x * 1000) / 10 + '%'
const IN_UNIT = { lb: 1, kg: 0.45359237, oz: 16 } as const
const dayLabel = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short', day: 'numeric' })
const inTextOf = (o: MiniOpts, lb: number) => (lb ? n2(lb * IN_UNIT[o.inUnit]) + ' ' + tr(o.inUnit) : tr('Sin pesar'))
const outTextOf = (o: MiniOpts, n: number | null) => (n == null ? '—' : o.outUnit === 'mezclas' ? n0(n) + ' ' + tr('mezclas') : n2(n) + ' ' + (o.outUnit === 'lb' ? tr('lb') : tr('cajas')))
/** ms as hours, the Excel's way: a number that can be added and charted */
const hoursOf = (ms: number) => Math.round(ms / 36_000) / 100
const stoppedOf = (x: RoomDay) => x.mech + x.people + x.clean + x.other
const partNames = () => ({ raw: tr('Crudo'), cooked: tr('Cocinado'), pouch: tr('Pouch') })
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
  const hoursCell = (worked: number, stopped: number, time: number): MiniCell => (time ? { t: tr('{0} h · {1} h parado', hoursOf(worked), hoursOf(stopped)) } : none)
  const lunchCell = (lunch: number, time: number): MiniCell => (time ? { t: pctOf(lunch / time) + ' · ' + fmtDur(lunch) } : none)
  const downCell = (down: number, time: number): MiniCell => (time ? { t: pctOf(down / time) + ' · ' + fmtDur(down), c: (down / time) * 100 > o.limit ? 'bad' : 'ok' } : none)
  const inText = (lb: number) => inTextOf(o, lb), outOf = (n: number | null) => outTextOf(o, n)
  const sum = (list: RoomDay[], f: (x: RoomDay) => number) => list.reduce((t, x) => t + f(x), 0)
  const cooks = w.rooms.filter((r) => r.dept === 'Kitchen' || r.dept === 'Spiral')
  const partName = partNames()
  const wtCell = (x: WtAvg | null): MiniCell => (x?.avg == null ? none : { t: x.avg.toFixed(2), c: x.ok === 'ok' ? 'ok' : x.ok === 'under' ? 'bad' : x.ok === 'over' ? 'warn' : undefined })
  return [
    { id: 'mini-arranque', title: tr('Arranque'), head: head(tr('Departamento')), rows: roomRows(w.rooms, dept, startCell, startAll), note: tr('{0}, {1}. En rojo {2} minutos después de la hora de arranque. La semana dice cuántos minutos tarde en promedio, contando a tiempo como 0.', o.from === 'setup' ? tr('Desde el Set up') : tr('Desde que empieza el código'), o.by === 'room' ? tr('la primera línea del cuarto') : tr('promedio de sus líneas'), o.grace) },
    { id: 'mini-prod', title: tr('Producción: real, meta y % de éxito'), head: head(tr('Departamento')), rows: roomRows(w.rooms, (d) => d + ' (' + slowUnitOf(d) + ')', (x) => made(x.real, x.target, x.apart), (list) => { const goal = list.filter((x) => x.target); return goal.length ? made(sum(goal, (x) => x.real), sum(goal, (x) => x.target ?? 0), []) : made(sum(list, (x) => x.real), null, []) }), note: tr('Hecho / meta · % de éxito. La meta de cada día × sus horas: las que trabajó la línea, o con meta del cuarto, de su primer código al último. Lo contado en otra medida o sin meta va aparte y no entra en el %. La semana solo suma los días con meta.') },
    { id: 'mini-paros', title: tr('Paros: % del tiempo trabajado'), head: head(tr('Departamento')), rows: roomRows(w.rooms, dept, (x) => downCell(x.down, x.time), (list) => downCell(sum(list, (x) => x.down), sum(list, (x) => x.time))), note: tr('En rojo sobre {0}%. Cuentan: mecánico, personal y otros{1}{2}{3}.', o.limit, o.clean ? ', ' + tr('limpieza') : '', o.lunch ? ', ' + tr('lunch') : '', o.setup ? ', ' + tr('Set up') : '') },
    { id: 'mini-horas', title: tr('Horas: trabajado y parado'), head: head(tr('Departamento')), rows: roomRows(w.rooms, dept, (x) => hoursCell(x.worked, stoppedOf(x), x.time), (list) => hoursCell(sum(list, (x) => x.worked), sum(list, stoppedOf), sum(list, (x) => x.time))), note: tr('Horas trabajadas · horas paradas. Suman las líneas: 3 líneas de 8 horas son 24 horas. Lunch, Break y Set up no entran en ninguna de las dos.') },
    { id: 'mini-lunch', title: tr('Lunch y Break: % del tiempo trabajado'), head: head(tr('Departamento')), rows: roomRows(w.rooms, dept, (x) => lunchCell(x.lunch, x.time), (list) => lunchCell(sum(list, (x) => x.lunch), sum(list, (x) => x.time))), note: tr('Van aparte de los paros: no suben el % de arriba, salvo que Ajustes diga que cuentan.') },
    { id: 'mini-causas', title: tr('Por qué se paró en la semana'), head: [tr('Departamento'), tr('Mecánico'), tr('No personal'), tr('Limpieza'), tr('Otros'), tr('Lunch y Break')], rows: w.rooms.map((r) => { const l = r.days.filter((x): x is RoomDay => !!x), all = sum(l, (x) => x.time), t = (f: (x: RoomDay) => number) => ({ t: sum(l, f) ? fmtDur(sum(l, f)) + ' · ' + pctOf(sum(l, f) / all) : '—' }); return [{ t: r.dept }, t((x) => x.mech), t((x) => x.people), t((x) => x.clean), t((x) => x.other), t((x) => x.lunch)] }), note: tr('Tiempo de la semana y su % del tiempo trabajado.') },
    { id: 'mini-mec', title: tr('Paros mecánicos'), head: [tr('Día'), tr('Departamento'), tr('Línea'), tr('Hora'), tr('Tiempo'), tr('Mecánico'), tr('Razón')], rows: w.mechanics.map((m) => [{ t: dayLabel(m.date) }, { t: m.dept }, { t: m.line }, { t: fmtTime(m.at) }, { t: fmtDur(m.ms) }, m.who ? { t: m.who } : { t: tr('Sin nombre'), c: 'warn' }, { t: tr(m.reason) }]) },
    { id: 'mini-consumo', title: tr('Consumo: lo que entra y lo que sale'), head: head(tr('Departamento')), rows: roomRows(cooks, dept, (x) => (x.in || x.out != null ? { t: inText(x.in) + ' → ' + outOf(x.out) } : none), (list) => ({ t: inText(sum(list, (x) => x.in)) + ' → ' + outOf(list.some((x) => x.out != null) ? sum(list, (x) => x.out ?? 0) : null) })), note: tr('Sin pesar quiere decir que nadie pesó lo que entró: Consumo está apagado en ese cuarto.') },
    { id: 'mini-waste', title: tr('Waste (lb)'), head: head(tr('Departamento')), rows: roomRows(w.rooms, dept, (x) => ({ t: x.waste ? n2(x.waste) : '—' }), (list) => ({ t: sum(list, (x) => x.waste) ? n2(sum(list, (x) => x.waste)) : '—' })) },
    { id: 'mini-pesos', title: tr('Pesos: promedio por día (oz)'), head: head(tr('Código')), rows: w.weights.map((x) => { const r = x.days.find((d) => d?.range)?.range; const all = x.days.filter((d): d is WtAvg => !!d), a = avgOf(all); return [{ t: x.code + ' · ' + partName[x.part] + (r ? ' (' + wtRangeLong(r) + ')' : '') }, ...x.days.map(wtCell), a == null ? none : { t: a.toFixed(2) }] }) },
  ]
}
/**
 * Santiago's Mini KPI as he drew it (his Excel, 2026-11-04: "ellos solo quieren ver lo importante"): one block per
 * room, a row per number and a column per day, with the target first and the week last: attendance, start and end
 * time, what was made and per person, the weight, hours, downtime, consumption and waste
 */
export type SimpleRow = { id: string; label: string; target: MiniCell; days: MiniCell[]; week: MiniCell }
export type SimpleBlock = { dept: Dept; rows: SimpleRow[] }
export function miniSimple(w: MiniWeek): SimpleBlock[] {
  const { o } = w, none: MiniCell = { t: '—' }
  type Day = (typeof w.rooms)[number]['days'][number]
  const had = (r: (typeof w.rooms)[number]) => r.days.filter((x): x is NonNullable<Day> => !!x)
  const sum = (list: NonNullable<Day>[], f: (x: NonNullable<Day>) => number) => list.reduce((t, x) => t + f(x), 0)
  const n1 = (x: number) => String(Math.round(x * 10) / 10)
  return w.rooms.map((r) => {
    const list = had(r), unit = slowUnitOf(r.dept), goal = list.find((x) => x.target)?.target ?? null, expected = Math.max(0, ...list.map((x) => x.att.expected))
    const perDay = (f: (x: NonNullable<Day>) => MiniCell) => r.days.map((x) => (x ? f(x) : none))
    const madeOf = (x: NonNullable<Day>): MiniCell => (!x.real && !x.target ? none : { t: n0(x.real), c: x.target ? (x.real / x.target >= 1 ? 'ok' : x.real / x.target >= 0.9 ? 'warn' : 'bad') : undefined })
    const perPerson = (real: number, people: number): MiniCell => (people && real ? { t: n1(real / people) } : none)
    const pplSum = sum(list, (x) => x.att.actual), madeSum = sum(list, (x) => x.real), tgtDays = list.filter((x) => x.target)
    const rows: SimpleRow[] = [
      { id: 'att', label: tr('Asistencia'), target: expected ? { t: n0(expected) } : none, days: perDay((x) => (x.att.expected || x.att.actual ? { t: n0(x.att.actual), c: x.att.actual >= x.att.expected ? 'ok' : 'bad' } : none)), week: list.length && pplSum ? { t: n1(pplSum / list.filter((x) => x.att.actual).length || 0) + ' ' + tr('prom.') } : none },
      { id: 'start', label: tr('Hora de arranque'), target: { t: w.shift === 1 ? '' : o.start2 }, days: perDay((x) => (x.start ? { t: fmtTime(x.start.at), c: x.start.late ? 'bad' : 'ok' } : none)), week: (() => { const has = list.filter((x) => x.start); return has.length ? { t: tr('{0} min tarde', Math.round(has.reduce((a, x) => a + Math.max(0, x.start?.off ?? 0), 0) / has.length)) } : none })() },
      { id: 'end', label: tr('Hora de fin'), target: none, days: perDay((x) => (x.end ? { t: fmtTime(x.end) } : none)), week: none },
      { id: 'made', label: unit.charAt(0).toUpperCase() + unit.slice(1), target: goal ? { t: n0(goal) } : none, days: perDay(madeOf), week: madeSum ? { t: n0(madeSum), c: tgtDays.length ? (sum(tgtDays, (x) => x.real) / sum(tgtDays, (x) => x.target ?? 0) >= 1 ? 'ok' : 'bad') : undefined } : none },
      { id: 'pp', label: tr('{0} por persona', unit.charAt(0).toUpperCase() + unit.slice(1)), target: goal && expected ? { t: n1(goal / expected) } : none, days: perDay((x) => perPerson(x.real, x.att.actual)), week: perPerson(madeSum, pplSum) },
      { id: 'wt', label: tr('Peso (oz)'), target: none, days: perDay((x) => (x.wt == null ? none : { t: x.wt.toFixed(2) })), week: (() => { const has = list.filter((x) => x.wt != null); return has.length ? { t: (sum(has, (x) => x.wt as number) / has.length).toFixed(2) } : none })() },
      { id: 'hours', label: tr('Horas trabajadas'), target: none, days: perDay((x) => (x.time ? { t: n1(hoursOf(x.worked)) } : none)), week: list.some((x) => x.time) ? { t: n1(hoursOf(sum(list, (x) => x.worked))) } : none },
      { id: 'down', label: tr('Downtime'), target: { t: '≤ ' + o.limit + '%' }, days: perDay((x) => (x.time ? { t: fmtDur(x.down) + ' · ' + pctOf(x.down / x.time), c: (x.down / x.time) * 100 > o.limit ? 'bad' : 'ok' } : none)), week: list.some((x) => x.time) ? { t: fmtDur(sum(list, (x) => x.down)) + ' · ' + pctOf(sum(list, (x) => x.down) / sum(list, (x) => x.time)) } : none },
      { id: 'in', label: tr('Consumo (lb)'), target: none, days: perDay((x) => (x.in ? { t: n0(x.in) } : none)), week: sum(list, (x) => x.in) ? { t: n0(sum(list, (x) => x.in)) } : none },
      { id: 'waste', label: tr('Waste (lb)'), target: none, days: perDay((x) => (x.waste ? { t: n2(x.waste) } : none)), week: sum(list, (x) => x.waste) ? { t: n2(sum(list, (x) => x.waste)) } : none },
    ]
    return { dept: r.dept, rows }
  })
}
/** Santiago's layout as a sheet: one block per room, the target first, a column per day, the week last */
export function miniSimpleSheet(w: MiniWeek): Sheet {
  const out: Cell[][] = [], heights: Record<number, number> = {}, merges: string[] = []
  const row = (cells: Cell[], ht?: number) => { if (ht) heights[out.length] = ht; out.push(cells); return out.length }
  const cols = 3 + w.days.length
  const across = (text: string, style: number, ht: number) => { const r = row([xT(text, style), ...Array.from({ length: cols - 1 }, () => xT('', style))], ht); merges.push('A' + r + ':' + colName(cols - 1) + r) }
  const colour = (c: MiniCell): Cell => (c.t === '—' ? xT('', X.wCell) : xT(c.t, c.c === 'ok' ? X.wGoodW : c.c === 'bad' ? X.wBadW : c.c === 'warn' ? X.wWarnW : X.wCell))
  across(tr('Mini KPI · Turno {0}', w.shift) + ' · ' + w.days[0] + ' → ' + w.days[w.days.length - 1], X.wBand, 30)
  row([], 8)
  for (const b of miniSimple(w)) {
    across(b.dept, X.wSec, 24)
    row(['', tr('Target'), ...w.days.map(dayLabel), tr('Semana')].map((x) => xT(x, X.mHead)), 26)
    for (const r of b.rows) row([xT(r.label, X.wLeft), colour(r.target), ...r.days.map(colour), colour(r.week)], 20)
    row([], 10)
  }
  across(tr('Asistencia = personas anotadas en el turno contra las esperadas. Hora de arranque = el primer código de las líneas; de fin = el último registro. Por persona = lo hecho ÷ las personas anotadas. Peso = el promedio del día de lo que pesa el cuarto (crudo, cocinado, pouch). Downtime = los paros que cuentan en Ajustes › Mini KPI.'), X.note, 40)
  return { name: tr('Mini KPI'), rows: out, freeze: 0, page: { widths: [22, 10, ...w.days.map(() => 14), 16], heights, merges } }
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
    days: days.length, real: sum(days, (x) => x.real), lunch: time ? sum(days, (x) => x.lunch) / time : null,
    worked: sum(days, (x) => x.worked), stopped: sum(days, stoppedOf), pause: sum(days, (x) => x.lunch), setup: sum(days, (x) => x.setup),
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
/** the parts of a room's time, the same in every chart: worked, stopped, Lunch and Break, Set up */
const WORK_COLORS = ['2A78D6', 'E34948', '6250D6', 'EDA100']
const workParts = () => [tr('Trabajado'), tr('Parado'), tr('Lunch y Break'), tr('Set up')]
const shortDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' })
const wholeWeek = (x: MiniWeek) => !x.days.some(awayDay)
/** the numbers of the sheets, as cells that say good or bad; what is not known is empty for a chart, a dash to read */
const cellsOf = (o: MiniOpts) => ({
  none: xT('—', X.wCell), empty: xT('', X.wCell),
  pct: (x: number) => xN(x, x >= 1 ? X.wPg : x >= 0.9 ? X.wPa : X.wPr),
  down: (x: number) => xN(x, x * 100 > o.limit ? X.wPr : X.wPg),
  late: (x: number) => xN(Math.round(x), x > o.grace ? X.wNr : X.wNg),
})

/**
 * The one sheet to read (Santiago through Jose, 2026-11-01: "summary sheet ... con gráfica que comparan días o semanas"):
 * the week against the one before it, room by room, in numbers; charts of its days and of the last weeks, drawn by Excel
 * from the tables at the foot of the sheet. What is not known stays empty, never a zero: a line then shows a gap.
 * A week that could not be brought whole from the server is left out rather than compared by halves
 */
export function miniSummary(weeks: MiniWeek[]): Sheet {
  const w = weeks[weeks.length - 1], before = weeks[weeks.length - 2], { o } = w, COLS = 11
  const out: Cell[][] = [], heights: Record<number, number> = {}, merges: string[] = [], charts: Chart[] = []
  const row = (cells: Cell[], ht?: number) => { if (ht) heights[out.length] = ht; out.push(cells); return out.length }
  const across = (text: string, style: number, ht: number) => { const r = row([xT(text, style), ...Array.from({ length: COLS - 1 }, () => xT('', style))], ht); merges.push('A' + r + ':K' + r) }
  const gap = (n = 1) => { const at = out.length + 1; for (let i = 0; i < n; i++) row([]); return at }
  const cells = cellsOf(o), { empty, none } = cells, whole = wholeWeek
  const numsAt = (x: MiniWeek, i: number) => (whole(x) ? numsOf(x.rooms[i].days) : null)
  const delta = (now: number | null | undefined, then: number | null | undefined, up: boolean, unit: string, scale = 1): Cell => {
    if (now == null || then == null) return none
    const d = Math.round((now - then) * scale * 10) / 10
    return !d ? xT(tr('Igual'), X.wCell) : xT((d > 0 ? '▲ +' : '▼ −') + Math.abs(d) + ' ' + unit, d > 0 === up ? X.wPg : X.wPr)
  }
  const pctCell = (x: number | null) => (x == null ? none : cells.pct(x)), downCell = (x: number | null) => (x == null ? none : cells.down(x)), lateCell = (x: number | null) => (x == null ? none : cells.late(x))
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
  row([tr('Departamento'), tr('Hecho'), tr('% de la meta'), tr('Contra la pasada'), tr('Paros'), tr('Contra la pasada'), tr('Lunch y Break'), tr('Arranque (minutos tarde)'), tr('Contra la pasada'), tr('Waste por día (lb)'), tr('Contra la pasada')].map((t) => xT(t, X.wHead)), 46)
  w.rooms.forEach((r, i) => {
    const a = now[i], b = then[i]
    row([xT(r.dept, X.wLeft), a?.real ? xT(Math.round(a.real).toLocaleString('en-US') + ' ' + slowUnitOf(r.dept), X.wCell) : none, pctCell(a?.pct ?? null), delta(a?.pct, b?.pct, true, tr('pts'), 100), downCell(a?.down ?? null), delta(a?.down, b?.down, false, tr('pts'), 100), a?.lunch == null ? none : xN(a.lunch, X.wP), lateCell(a?.late ?? null), delta(a?.late, b?.late, false, tr('min')), a?.waste == null ? none : xN(round1(a.waste), X.wD), delta(a?.waste, b?.waste, false, tr('lb'))], 22)
  })
  across(tr('▲ subió y ▼ bajó contra la semana pasada; el color dice si eso es bueno (verde) o malo (rojo). En Paros, Arranque y Waste, bajar es lo bueno.'), X.note, 32)
  gap()

  // ---- worked against stopped, room against room (Santiago, 2026-11-01): in hours, and in % because the rooms have different numbers of lines ----
  const TALL = 16, left = { left: 0, cols: 5, height: TALL }, right = { left: 5, cols: 11, height: TALL }
  across(tr('Trabajado y parado, cuarto por cuarto'), X.wSec, 24)
  row([tr('Departamento'), ...workParts().map((t) => t + ' (h)'), tr('Total (h)'), ...workParts().map((t) => '% ' + t)].map((t) => xT(t, X.wHead)), 46)
  const workFrom = out.length + 1
  w.rooms.forEach((r, i) => {
    const a = now[i], parts = a ? [a.worked, a.stopped, a.pause, a.setup] : [0, 0, 0, 0], all = parts.reduce((t, x) => t + x, 0)
    row([xT(r.dept, X.wLeft), ...parts.map((x) => (all ? xN(hoursOf(x), X.wD) : empty)), all ? xN(hoursOf(all), X.wD) : empty, ...parts.map((x) => (all ? xN(x / all, X.wP) : empty))], 22)
  })
  const workTo = out.length
  across(tr('Las horas suman las líneas: 3 líneas de 8 horas son 24 horas. Por eso un cuarto con más líneas tiene más horas: para comparar cuartos, mira el %.'), X.note, 32)
  gap()
  const wide = { left: 0, cols: 11, height: TALL }, workAt = gap(TALL)
  gap()
  const workAt2 = gap(TALL)
  gap()

  // ---- the charts: a place for them now, their numbers at the foot of the sheet ----
  across(tr('Día por día'), X.wSec, 24)
  const dayAt = gap(TALL)
  gap()
  across(tr('Semana contra semana'), X.wSec, 24)
  const weekAt = gap(TALL)
  gap()
  const weekAt2 = gap(TALL)
  gap()
  const weekAt3 = gap(TALL)
  gap()

  // ---- the weights ----
  across(tr('Pesos: promedio de la semana (oz)'), X.wSec, 24)
  row([tr('Código'), tr('Rango de QA'), tr('Esta semana'), tr('La pasada'), tr('Diferencia')].map((t) => xT(t, X.wHead)), 30)
  const partName = partNames()
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
  charts.push({ ...weekTable(tr('Horas trabajadas por semana'), (x) => (x.days ? hoursOf(x.worked) : null), X.wD, '0'), at: weekAt3, ...left })
  charts.push({ ...weekTable(tr('Horas paradas por semana'), (x) => (x.days ? hoursOf(x.stopped) : null), X.wD, '0'), at: weekAt3, ...right })
  charts.push({ title: tr('Horas de cada cuarto: trabajado y parado'), series: workParts(), cat: 0, val: [1, 2, 3, 4], from: workFrom, to: workTo, at: workAt, kind: 'col', fmt: '0', labelFmt: '0.0;;', colors: WORK_COLORS, ...wide })
  charts.push({ title: tr('% del tiempo de cada cuarto'), series: workParts(), cat: 0, val: [6, 7, 8, 9], from: workFrom, to: workTo, at: workAt2, kind: 'col', pct: true, labelFmt: '0.0%;;', colors: WORK_COLORS, ...wide })
  if (!weeks.every(whole)) across(tr('Las semanas que no se pudieron traer completas del servidor salen vacías.'), X.note, 22)
  return { name: tr('Resumen'), rows: out, charts, freeze: 0, page: { widths: [17, 14, 12, 13, 12, 13, 11, 13, 13, 13, 13], heights, merges } }
}

/** the sheets in the order the product goes through the plant, the order Santiago says them */
const MINI_ROOMS: Dept[] = ['Kitchen', 'Spiral', 'RTE', 'MFO', 'Packing']
/**
 * One room's week on its own sheet (Santiago through Jose, 2026-11-01: "un sheet en excel aparte de cada quien"): its
 * days as rows so each number can be sorted and charted, why it stopped, its last weeks, its charts, its mechanics and
 * what it weighed. Lunch and Break have their own columns (Santiago: "los porcientos de los lunch también"): they stay
 * apart from the stops, whose 15% is judged without them unless Ajustes says otherwise
 */
export function miniRoomSheet(weeks: MiniWeek[], dept: Dept): Sheet {
  const w = weeks[weeks.length - 1], { o } = w, at = w.rooms.findIndex((r) => r.dept === dept), days = w.rooms[at].days
  const cooks = dept === 'Kitchen' || dept === 'Spiral', COLS = cooks ? 15 : 14, HIDE_GOAL = 16, HIDE_LIMIT = 17, end = colName(COLS - 1), color = ROOM_COLORS[at]
  const out: Cell[][] = [], heights: Record<number, number> = {}, merges: string[] = [], charts: Chart[] = []
  const row = (cells: Cell[], ht?: number) => { if (ht) heights[out.length] = ht; out.push(cells); return out.length }
  const across = (text: string, style: number, ht: number) => { const r = row([xT(text, style), ...Array.from({ length: COLS - 1 }, () => xT('', style))], ht); merges.push('A' + r + ':' + end + r) }
  const gap = (n = 1) => { const first = out.length + 1; for (let i = 0; i < n; i++) row([]); return first }
  const { none, empty, pct, down, late } = cellsOf(o), sumOf = (l: RoomDay[], f: (x: RoomDay) => number) => l.reduce((t, x) => t + f(x), 0)
  const round1 = (x: number) => Math.round(x * 10) / 10
  const startOf = (x: RoomDay | null): Cell => (x?.start ? xT(fmtTime(x.start.at) + (x.start.lateLines && o.by === 'line' ? ' · ' + x.start.lateLines + '/' + x.start.lines : ''), x.start.late ? X.wPr : X.wPg) : none)
  const line = (label: string, list: (RoomDay | null)[], start: Cell, apart: Cell): Cell[] => {
    const n = numsOf(list), has = list.filter((x): x is RoomDay => !!x && x.time > 0), goal = sumOf(has, (x) => x.target ?? 0), waste = sumOf(has, (x) => x.waste)
    return [xT(label, X.wLeft), start, n.late == null ? none : late(n.late), n.days ? xN(Math.round(n.real), X.wN) : none, goal ? xN(Math.round(goal), X.wN) : none,
      n.pct == null ? empty : pct(n.pct), ...[n.worked, n.stopped, n.pause, n.setup].map((x) => (n.days ? xN(hoursOf(x), X.wD) : empty)),
      n.down == null ? empty : down(n.down), n.lunch == null ? empty : xN(n.lunch, X.wP), waste ? xN(round1(waste), X.wD) : none, apart,
      ...(cooks ? [n.days ? xT(inTextOf(o, sumOf(has, (x) => x.in)) + ' → ' + outTextOf(o, sumOf(has, (x) => x.out ?? 0)), X.wCell) : none] : [])]
  }
  across(tr('{0} · Turno {1}', dept, w.shift), X.wBand, 34)
  across(tr('Semana del {0} al {1}', w.days[0], w.days[5]), X.wSub, 22)
  gap()

  // ---- each day, and the week ----
  across(tr('Día por día'), X.wSec, 24)
  row([tr('Día'), tr('Arranque'), tr('Minutos tarde'), tr('Hecho') + ' (' + slowUnitOf(dept) + ')', tr('Meta'), tr('% de la meta'), ...workParts().map((t) => t + ' (h)'), tr('% Paros'), tr('% Lunch y Break'), tr('Waste (lb)'), tr('Aparte'), ...(cooks ? [tr('Consumo')] : [])].map((t) => xT(t, X.wHead)), 46)
  const from = out.length + 1
  w.days.forEach((d, i) => {
    const cells = line(dayLabel(d), [days[i]], awayDay(d) ? none : startOf(days[i]), days[i]?.apart.length ? xT(days[i]?.apart.join(', ') ?? '', X.wCell) : none)
    while (cells.length < HIDE_GOAL) cells.push(null)
    row([...cells, xN(1, X.wHide), xN(o.limit / 100, X.wHide)], 20)
  })
  const to = out.length, nums = numsOf(days)
  row(line(tr('Semana'), days, nums.late == null ? none : xT(tr('{0} min tarde', Math.round(nums.late)), nums.late > o.grace ? X.wPr : X.wPg), none), 22)
  gap()

  // ---- why it stopped ----
  across(tr('Por qué se paró: tiempo y % del tiempo trabajado'), X.wSec, 24)
  row([tr('Día'), tr('Mecánico'), tr('No personal'), tr('Limpieza'), tr('Otros'), tr('Lunch y Break')].map((t) => xT(t, X.wHead)), 30)
  const causes = (label: string, list: (RoomDay | null)[]) => {
    const has = list.filter((x): x is RoomDay => !!x && x.time > 0), time = sumOf(has, (x) => x.time)
    const cell = (f: (x: RoomDay) => number) => { const ms = sumOf(has, f); return ms ? xT(fmtDur(ms) + ' · ' + pctOf(ms / time), X.wCell) : none }
    row([xT(label, X.wLeft), cell((x) => x.mech), cell((x) => x.people), cell((x) => x.clean), cell((x) => x.other), cell((x) => x.lunch)], 20)
  }
  w.days.forEach((d, i) => causes(dayLabel(d), [days[i]]))
  causes(tr('Semana'), days)
  gap()

  // ---- its last weeks ----
  across(tr('Semana contra semana'), X.wSec, 24)
  row([tr('Semana'), tr('% de la meta'), tr('Paros'), tr('Lunch y Break'), tr('Minutos tarde'), tr('Waste por día (lb)'), ...workParts().map((t) => t + ' (h)')].map((t) => xT(t, X.wHead)), 46)
  const weekFrom = out.length + 1
  for (const x of weeks) {
    const n = wholeWeek(x) ? numsOf(x.rooms[at].days) : null
    row([xT(tr('Sem. {0}', shortDay(x.days[0])), X.wLeft), n?.pct == null ? empty : pct(n.pct), n?.down == null ? empty : down(n.down), n?.lunch == null ? empty : xN(n.lunch, X.wP), n?.late == null ? empty : late(n.late), n?.waste == null ? empty : xN(round1(n.waste), X.wD), ...(n ? [n.worked, n.stopped, n.pause, n.setup] : [0, 0, 0, 0]).map((v) => (n?.days ? xN(hoursOf(v), X.wD) : empty))], 20)
  }
  const weekTo = out.length
  gap()

  // ---- the charts ----
  const TALL = 15, left = { left: 0, cols: 6, height: TALL }, right = { left: 6, cols: COLS, height: TALL }, wide = { left: 0, cols: COLS, height: TALL }, stops = [tr('Paros'), tr('Lunch y Break')]
  const workAt = gap(TALL)
  gap()
  const workAt2 = gap(TALL)
  gap()
  const dayAt = gap(TALL)
  gap()
  const weekAt = gap(TALL)
  gap()
  charts.push({ title: tr('% de la meta por día'), series: [tr('Meta (100%)'), tr('% de la meta')], cat: 0, val: [HIDE_GOAL, 5], from, to, at: dayAt, kind: 'line', fmt: '0%', colors: [REF_COLOR, color], labels: 'last', refs: [0], ...left })
  charts.push({ title: tr('Paros y Lunch por día'), series: [tr('Límite ({0}%)', o.limit), ...stops], cat: 0, val: [HIDE_LIMIT, 10, 11], from, to, at: dayAt, kind: 'line', fmt: '0%', colors: [REF_COLOR, color, WEEK_COLORS[3]], labels: 'none', refs: [0], ...right })
  charts.push({ title: tr('% de la meta por semana'), series: [tr('% de la meta')], cat: 0, val: [1], from: weekFrom, to: weekTo, at: weekAt, kind: 'col', fmt: '0%', colors: [color], ...left })
  charts.push({ title: tr('Paros y Lunch por semana'), series: stops, cat: 0, val: [2, 3], from: weekFrom, to: weekTo, at: weekAt, kind: 'col', fmt: '0%', colors: [color, WEEK_COLORS[3]], ...right })
  charts.push({ title: tr('Horas trabajadas y paradas por día'), series: workParts(), cat: 0, val: [6, 7, 8, 9], from, to, at: workAt, kind: 'col', fmt: '0', labelFmt: '0.0;;', colors: WORK_COLORS, ...wide })
  charts.push({ title: tr('Horas trabajadas y paradas por semana'), series: workParts(), cat: 0, val: [6, 7, 8, 9], from: weekFrom, to: weekTo, at: workAt2, kind: 'col', fmt: '0', labelFmt: '0.0;;', colors: WORK_COLORS, ...wide })

  // ---- who came to its mechanical stops ----
  across(tr('Paros mecánicos'), X.wSec, 24)
  const mech = w.mechanics.filter((m) => m.dept === dept)
  row([tr('Día'), tr('Línea'), tr('Hora'), tr('Tiempo'), tr('Mecánico'), tr('Razón')].map((t) => xT(t, X.wHead)), 30)
  for (const m of mech) row([xT(dayLabel(m.date), X.wLeft), xT(m.line, X.wCell), xT(fmtTime(m.at), X.wCell), xT(fmtDur(m.ms), X.wCell), m.who ? xT(m.who, X.wCell) : xT(tr('Sin nombre'), X.wPa), xT(tr(m.reason), X.wCell)], 20)
  if (!mech.length) row([xT(tr('Nada esta semana'), X.wLeft)], 20)
  gap()

  // ---- what it weighed ----
  const weighed = (w.roomWeights.get(dept) ?? []).filter((x) => x.days.some((d) => d?.avg != null))
  across(tr('Pesos: promedio por día (oz)'), X.wSec, 24)
  row([tr('Código'), tr('Rango de QA'), ...w.days.map(dayLabel), tr('Semana')].map((t) => xT(t, X.wHead)), 30)
  for (const x of weighed) {
    const range = x.days.find((d) => d?.range)?.range ?? '', a = avgOf(x.days.filter((d): d is WtAvg => !!d))
    row([xT(x.code + ' · ' + partNames()[x.part], X.wLeft), range ? xT(wtRangeLong(range), X.wCell) : none, ...x.days.map((d) => (d?.avg == null ? none : xN(Math.round(d.avg * 100) / 100, d.ok === 'ok' ? X.wDg : d.ok === 'under' ? X.wDr : d.ok === 'over' ? X.wDa : X.wD))), a == null ? none : xN(Math.round(a * 100) / 100, X.wD)], 20)
  }
  if (!weighed.length) row([xT(tr('Nada esta semana'), X.wLeft)], 20)
  return { name: dept, rows: out, charts, freeze: 0, page: { widths: [14, 17, 9, 11, 10, 10, 11, 10, 11, 9, 10, 11, 9, 18, 26, 2, 2, 2], heights, merges } }
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
  { id: 'mini-horas', title: tr('Horas: trabajado y parado'),
    means: tr('Cuántas horas estuvo cada cuarto trabajando y cuántas parado.'),
    math: tr('Todo el tiempo que las líneas tuvieron un código se reparte en cuatro: Trabajado, Parado (mecánico, personal, limpieza y otros), Lunch y Break, y Set up. Las horas suman las líneas: 3 líneas de 8 horas son 24 horas. Por eso, para comparar cuartos de distinto tamaño, sirve el %.'),
    eg: tr('24 horas de línea con 2 horas paradas, 1 h 30 min de Lunch y 30 min de Set up: 20 horas trabajadas, 83.3%.') },
  { id: 'mini-lunch', title: tr('Lunch y Break: % del tiempo trabajado'),
    means: tr('Qué parte del tiempo se fue en Lunch y Break.'),
    math: tr('El tiempo en Lunch o Break (como se haya escrito: lunch, break, comida, almuerzo, descanso) ÷ todo el tiempo que las líneas tuvieron un código, sumando las líneas. Va aparte de los paros: no suben su % ni su rojo, salvo que Ajustes diga que cuentan.'),
    eg: tr('3 líneas de 8 horas son 24 horas. Con 30 minutos cada una son 1 h 30 min: 6.3%.') },
  { id: 'mini-causas', title: tr('Por qué se paró en la semana'),
    means: tr('El tiempo parado de toda la semana, separado por la causa.'),
    math: tr('La suma de los paros de cada cuarto en Mecánico, No personal, Limpieza, Otros y Lunch y Break, con su % del tiempo trabajado. Set up no sale aquí.'),
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
/** the workbook: first the page to read, then each room on its own sheet and what each number means */
export function miniBook(s: State, date: string, k: 1 | 2, now: number): Sheet[] {
  // (the weeks still on their way from the server are left out, so the file is had at once: Jose, 2026-11-04; the report's week always goes)
  const weeks = miniSundays(date).filter((d, i, all) => i === all.length - 1 || !miniDays(d).some((x) => awayDay(x))).map((d) => miniWeek(s, d, k, now))
  return [miniSimpleSheet(weeks[weeks.length - 1]), miniSummary(weeks), ...MINI_ROOMS.map((d) => miniRoomSheet(weeks, d)), miniGuideSheet()]
}
