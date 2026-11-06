import { attExpectedOf, attOf, attendanceOf, DEPTS, deptStop, deptToday, fmtN, holdsOpen, lineLabel, openRun, openStop, SETUP, shiftGoalOf, shiftsOf, stopsWaiting, turnOf, type Dept, type State } from './store'
import { DEPT_LOOK, deptVars } from './look'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { awayDay } from './store'
import { loadDay } from './sync'
import { RangePick } from './PplhView'
import { datesFrom, keepRange, rangeKept } from './pplh'
import { reportOf } from './report'
import { fmtTime } from './clock-fmt'
import { locale, tr } from './i18n'

/**
 * Resumen (the redesign; rebuilt 2026-11-06 at Jose's word, "Resumen", after Pesos): the plant on one page for the
 * bosses and the CEO. The shift in course of each room, live, as on the floor (each shift starts from zero): what it
 * made against what its goal asks by this hour, its lines, its stops and its people; each room's last seven days in its
 * own unit; the plant's last seven days against its goals; and what needs attention now. Only numbers the app already
 * has; what it cannot know is one tap away in its own tab.
 */
const day = (date: string, n: number) => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const short = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short' }).replace('.', '')

function roomNow(s: State, d: Dept, date: string, now: number) {
  const t = turnOf(s, date, now, d)
  const goal = t.shift ? shiftGoalOf(s, d, t.shift).total : 0
  const td = deptToday(s, d, date, now)
  // what the goal asks by now: the shift's goal spread over its hours (a full goal at 9 AM would read as a failure)
  const span = Math.max(1, t.until - t.since), part = Math.min(1, Math.max(0, (now - t.since) / span))
  const due = goal ? goal * part : 0
  const lines = s.lines.filter((l) => l.dept === d)
  const run = lines.filter((l) => openRun(s, l.id) && !openStop(s, d, l.id)).length
  const stopped = lines.filter((l) => { const st = openStop(s, d, l.id); return !!st && st.reason !== SETUP && !!openRun(s, l.id) })
  const stopMin = s.stops.filter((x) => !x.deleted && x.dept === d && x.reason !== SETUP && x.startedAt < now && (x.endedAt ?? now) > t.since)
    .reduce((m, x) => m + (Math.min(x.endedAt ?? now, now) - Math.max(x.startedAt, t.since)) / 60_000, 0)
  const sh = (t.shift || 1) as 1 | 2
  const att = attendanceOf(s, date, sh, [d]).rows[0]
  const came = att ? att.actual : attOf(s, date, d, sh).filter((x) => !x.gone).length, expected = att ? att.expected : attExpectedOf(s, d, sh)
  const week = Array.from({ length: 7 }, (_, i) => day(date, i - 6)).map((x) => ({ date: x, qty: deptToday(s, d, x, now).qty }))
  return { t, goal, due, made: td.shiftQty, unit: td.unitLabel, lines: lines.length, run, stopped, stopMin, came, expected, week, down: !!deptStop(s, d) }
}
/** a day's production against the goals of its shifts (today's goals: the app keeps no history of goals) */
function plantDay(s: State, date: string, now: number) {
  const pcts = DEPTS.flatMap((d) => {
    const plan = shiftsOf(s, date, d), shifts: (1 | 2)[] = plan.only ? [plan.only] : [1, 2]
    const goal = shifts.reduce((t, k) => t + (shiftGoalOf(s, d, k)?.total ?? 0), 0)
    return goal ? [Math.min(2, deptToday(s, d, date, now).qty / goal)] : []
  })
  // (a day nobody produced is not a 0%: the plant did not work it)
  const worked = DEPTS.some((d) => deptToday(s, d, date, now).qty > 0)
  return pcts.length && worked ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null
}

function Bars({ values }: { values: { date: string; pct: number | null; today: boolean }[] }) {
  const W = 360, H = 160, L = 34, B = 24, T = 14, top = Math.max(1.2, ...values.map((v) => v.pct ?? 0))
  const Y = (p: number) => T + (1 - p / top) * (H - T - B), bw = (W - L - 10) / values.length
  return (
    <svg className="rd-sumbars" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr('Producción contra la meta, los últimos 7 días')}>
      <line className="goal" x1={L} x2={W - 6} y1={Y(1)} y2={Y(1)} /><text className="lab" x={L - 5} y={Y(1) + 4} textAnchor="end">100%</text>
      <line className="axis" x1={L} x2={W - 6} y1={Y(0)} y2={Y(0)} /><text className="lab" x={L - 5} y={Y(0) + 4} textAnchor="end">0</text>
      {values.map((v, i) => {
        const x = L + i * bw + bw * 0.18, w = bw * 0.64, p = v.pct ?? 0, c = v.pct == null ? 'none' : p >= 0.9 ? 'ok' : p >= 0.7 ? 'warn' : 'bad'
        return (
          <g key={v.date}>
            {v.pct != null && <rect className={'bar ' + c + (v.today ? ' today' : '')} x={x} y={Y(p)} width={w} height={Math.max(1, Y(0) - Y(p))} rx="4" />}
            <text className={'val ' + c} x={x + w / 2} y={v.pct == null ? Y(0) - 6 : Y(p) - 5} textAnchor="middle">{v.pct == null ? '—' : Math.round(p * 100) + '%'}</text>
            <text className={'lab' + (v.today ? ' strong' : '')} x={x + w / 2} y={H - 7} textAnchor="middle">{v.today ? tr('hoy') : short(v.date)}</text>
          </g>
        )
      })}
    </svg>
  )
}

function Spark({ values, unit }: { values: { date: string; qty: number }[]; unit: string }) {
  const max = Math.max(1, ...values.map((v) => v.qty)), w = 120, h = 34, bw = w / values.length
  return (
    <svg className="rd-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={tr('Los últimos 7 días: {0}', values.map((v) => fmtN(v.qty) + ' ' + unit).join(', '))}>
      {values.map((v, i) => <rect key={v.date} x={i * bw + 2} y={h - 2 - (v.qty / max) * (h - 6)} width={bw - 4} height={Math.max(1, (v.qty / max) * (h - 6))} rx="2" opacity={i === values.length - 1 ? 1 : 0.55} />)}
    </svg>
  )
}

type Go = 'wt' | 'pplh' | 'mini' | 'dash' | 'act' | 'hold'
function SummaryNow({ s, now, date, onGo, has, picker }: { s: State; now: number; date: string; onGo: (t: Go) => void; has: (t: Go) => boolean; picker: ReactNode }) {
  const rooms = DEPTS.map((d) => ({ d, ...roomNow(s, d, date, now) }))
  const withGoal = rooms.filter((r) => r.due > 0)
  const vsGoal = withGoal.length ? Math.round(withGoal.reduce((t, r) => t + Math.min(2, r.made / r.due), 0) / withGoal.length * 100) : null
  const lines = rooms.reduce((t, r) => t + r.lines, 0), run = rooms.reduce((t, r) => t + r.run, 0), stopped = rooms.reduce((t, r) => t + r.stopped.length, 0)
  const stopMin = Math.round(rooms.reduce((t, r) => t + r.stopMin, 0))
  const came = rooms.reduce((t, r) => t + r.came, 0), expected = rooms.reduce((t, r) => t + r.expected, 0)
  const waiting = DEPTS.reduce((t, d) => t + stopsWaiting(s, d).length, 0), held = holdsOpen(s).length
  const week = Array.from({ length: 7 }, (_, i) => day(date, i - 6)).map((x) => ({ date: x, pct: plantDay(s, x, now), today: x === date }))
  const anyGoal = week.some((w) => w.pct != null)
  const state = (r: (typeof rooms)[number]) => (r.down || r.stopped.length ? 'stop' : r.run ? 'run' : 'free')
  // what needs attention now, the worst first
  const attn: { k: string; lvl: 'r' | 'w' | 'i'; text: string; sub: string; go?: Go }[] = []
  for (const r of rooms) {
    if (r.down) attn.push({ k: 'down' + r.d, lvl: 'r', text: tr('Todo {0} parado', r.d), sub: tr('parado todo el cuarto'), go: 'act' })
    for (const l of r.stopped) { const st = openStop(s, r.d, l.id); attn.push({ k: 'st' + l.id, lvl: 'r', text: tr('{0} · {1} parada {2} min', r.d, lineLabel(l.name), Math.max(1, Math.round((now - (st?.startedAt ?? now)) / 60_000))), sub: st ? st.reason + ' · ' + tr('desde las {0}', fmtTime(st.startedAt)) : '', go: 'act' }) }
    if (r.due > 0 && r.made / r.due < 0.7) attn.push({ k: 'low' + r.d, lvl: 'w', text: tr('{0} va al {1}% de lo que pide la meta', r.d, Math.round((r.made / r.due) * 100)), sub: tr('{0} de {1} {2} a esta hora', fmtN(r.made), fmtN(r.due), r.unit) })
  }
  if (waiting) attn.push({ k: 'wait', lvl: 'w', text: waiting === 1 ? tr('1 paro sin razón') : tr('{0} paros sin razón', waiting), sub: tr('esperan que un manager ponga la razón'), go: 'act' })
  if (held) attn.push({ k: 'hold', lvl: 'i', text: held === 1 ? tr('1 unidad en On hold') : tr('{0} unidades en On hold', held), sub: tr('en revisión'), go: 'hold' })
  return (
    <div className="rd-sum">
      <div className="rd-sumbar">
        <h2>📊 {tr('Resumen de la planta')}</h2>
        {picker}
        <span className="rd-sumwhen">{tr('Turno en curso · en vivo · {0}', fmtTime(now))}</span>
      </div>
      <div className="rd-tiles six">
        <div className={'rd-tile' + (vsGoal == null ? '' : vsGoal >= 90 ? ' ok' : vsGoal < 70 ? ' bad' : ' warn')}><label>🎯 {tr('Producción vs meta')}</label><b>{vsGoal == null ? '—' : vsGoal + '%'}</b><small>{vsGoal == null ? tr('sin metas puestas') : tr('lo que pide la meta a esta hora')}</small></div>
        <div className="rd-tile"><label>🏭 {tr('Líneas trabajando')}</label><b>{run}<small> / {lines}</small></b><small>{stopped ? (stopped === 1 ? tr('1 parada ahora') : tr('{0} paradas ahora', stopped)) : tr('ninguna parada ahora')}</small></div>
        <div className={'rd-tile' + (stopMin >= 60 ? ' bad' : stopMin >= 20 ? ' warn' : '')}><label>⏸️ {tr('Paros del turno')}</label><b>{fmtN(stopMin)}<small> min</small></b><small>{tr('sin contar Set up')}</small></div>
        <div className={'rd-tile' + (expected && came < expected ? ' warn' : '')}><label>👥 {tr('Gente')}</label><b>{came}<small> / {expected}</small></b><small>{expected ? tr('{0}% de los esperados', Math.round((came / expected) * 100)) : ''}</small></div>
        <button type="button" className={'rd-tile link' + (waiting ? ' warn' : '')} onClick={() => onGo('act')} disabled={!has('act')}><label>❓ {tr('Paros sin razón')}</label><b>{waiting}</b><small>{tr('Ver la planta ›')}</small></button>
        <button type="button" className={'rd-tile link' + (held ? ' warn' : '')} onClick={() => onGo('hold')} disabled={!has('hold')}><label>🔍 {tr('On hold')}</label><b>{held}</b><small>{tr('Ver las unidades ›')}</small></button>
      </div>
      <div className="rd-sumgrid">
        <div className="rd-sumrooms">
          {rooms.map((r) => {
            const pct = r.due ? Math.round((r.made / r.due) * 100) : null, st = state(r)
            return (
              <article key={r.d} className="rd-sumroom" style={deptVars(r.d)}>
                <header><b><i aria-hidden="true">{DEPT_LOOK[r.d].emoji}</i>{r.d}</b><span className={'rd-pill ' + st}>{st === 'stop' ? tr('Parado') : st === 'run' ? tr('Trabajando') : tr('Sin trabajar')}</span></header>
                <div className="rd-sumroom-main">
                  <div><b className={'rd-sumpct ' + (pct == null ? '' : pct >= 90 ? 'ok-c' : pct < 70 ? 'bad-c' : 'wait-c')}>{pct == null ? '—' : pct + '%'}</b><small>{pct == null ? tr('sin meta') : tr('de lo que pide la meta')}</small></div>
                  <Spark values={r.week} unit={r.unit} />
                </div>
                <span className="rd-bar"><i style={{ width: Math.min(100, pct ?? 0) + '%' }} /></span>
                <div className="rd-sumroom-nums">
                  <span><b>{fmtN(r.made)}</b> {r.unit}{r.due ? <small> / {fmtN(r.due)}</small> : null}</span>
                  <span>🏭 <b>{r.run}</b>/{r.lines}</span>
                  <span>⏸️ <b>{Math.round(r.stopMin)}</b> min</span>
                  <span>👥 <b>{r.came}</b>/{r.expected}</span>
                </div>
              </article>
            )
          })}
        </div>
        <div className="rd-sumside">
          <article className="rd-card">
            <h3>📈 {tr('Producción vs meta · últimos 7 días')}</h3>
            {anyGoal ? <Bars values={week} /> : <p className="rd-calm warn">{tr('Pon las metas de cada cuarto (Planeación › Metas) para ver aquí el % de cada día.')}</p>}
            <small className="rd-sumnote">{tr('Lo hecho cada día contra la meta de sus turnos, promedio de los cuartos con meta.')}</small>
          </article>
          <article className="rd-card">
            <h3>🔔 {tr('Lo que necesita atención')}{attn.length > 0 && <span className="rd-pill stop">{attn.length}</span>}</h3>
            {attn.length ? attn.slice(0, 6).map((a) => (
              <button key={a.k} type="button" className={'rd-alert ' + a.lvl} disabled={!a.go || !has(a.go)} onClick={() => a.go && onGo(a.go)}><b>{a.text}</b>{a.sub && <span>{a.sub}</span>}</button>
            )) : <p className="rd-calm">{tr('Todo en orden: ninguna línea parada, ningún paro sin razón.')}</p>}
          </article>
        </div>
      </div>
      <div className="rd-more">
        {has('wt') && <button type="button" className="rd-morecard" onClick={() => onGo('wt')}><b>⚖️ {tr('Pesos')}</b><span>{tr('pruebas hechas, en rango, bajos y sobre')}</span></button>}
        {has('dash') && <button type="button" className="rd-morecard" onClick={() => onGo('dash')}><b>📊 Dashboard</b><span>{tr('yield, shorts y PPLH con su gráfica')}</span></button>}
        {has('mini') && <button type="button" className="rd-morecard" onClick={() => onGo('mini')}><b>📅 {tr('Mini KPI')}</b><span>{tr('la semana de cada turno contra la meta')}</span></button>}
        {has('pplh') && <button type="button" className="rd-morecard" onClick={() => onGo('pplh')}><b>📈 PPLH</b><span>{tr('libras por hora de trabajo y downtime')}</span></button>}
      </div>
    </div>
  )
}


/**
 * Resumen over days (Jose, 2026-11-06: the same dates as Pesos and Dashboard): "Hoy" is the shift in course, live; a
 * week or a month is each room's production against the goals of the days' shifts, its time stopped, its people
 * against those expected, and a bar a day. Days older than the device keeps are brought from the server.
 */
export function Summary(props: { s: State; now: number; date: string; onGo: (t: Go) => void; has: (t: Go) => boolean }) {
  const { date } = props
  const [from, setFrom] = useState(() => rangeKept('sum')?.from ?? date)
  const [to, setTo] = useState(() => rangeKept('sum')?.to ?? date)
  useEffect(() => { keepRange('sum', from, to) }, [from, to])
  const picker = <RangePick compact from={from} to={to} today={date} onChange={(a, b) => { setFrom(a); setTo(b) }} />
  const live = from === date && to === date
  const days = useMemo(() => (from && to && from <= to ? datesFrom(from, to) : [date]), [from, to, date])
  useEffect(() => { if (!live) for (const d of days) if (awayDay(d)) void loadDay(d) }, [days, live])
  if (live) return <SummaryNow {...props} picker={picker} />
  return <SummaryRange {...props} days={days} picker={picker} />
}

function SummaryRange({ s, now, date, onGo, has, days, picker }: { s: State; now: number; date: string; onGo: (t: Go) => void; has: (t: Go) => boolean; days: string[]; picker: ReactNode }) {
  const reps = useMemo(() => days.map((d) => ({ d, rep: reportOf(s, d, now) })), [s, days]) // eslint-disable-line react-hooks/exhaustive-deps
  const rooms = DEPTS.map((dept) => {
    let made = 0, goal = 0, down = 0, came = 0, expected = 0
    const bars = reps.map(({ d, rep }) => {
      const qty = deptToday(s, dept, d, now).qty, plan = shiftsOf(s, d, dept), shifts: (1 | 2)[] = plan.only ? [plan.only] : [1, 2]
      const g = qty > 0 ? shifts.reduce((t, k) => t + (shiftGoalOf(s, dept, k)?.total ?? 0), 0) : 0
      made += qty; goal += g
      down += (rep.byShift.find((x) => x.dept === dept)?.day.down ?? 0) / 60_000
      for (const k of shifts) { const a = attendanceOf(s, d, k, [dept]).rows[0]; if (a && a.actual) { came += a.actual; expected += a.expected } }
      return { date: d, qty }
    })
    return { dept, made, goal, down, came, expected, bars, unit: deptToday(s, dept, date, now).unitLabel, worked: bars.filter((b) => b.qty > 0).length }
  })
  const withGoal = rooms.filter((r) => r.goal > 0)
  const vsGoal = withGoal.length ? Math.round(withGoal.reduce((t, r) => t + Math.min(2, r.made / r.goal), 0) / withGoal.length * 100) : null
  const worked = new Set(rooms.flatMap((r) => r.bars.filter((b) => b.qty > 0).map((b) => b.date))).size
  const downMin = Math.round(rooms.reduce((t, r) => t + r.down, 0)), came = rooms.reduce((t, r) => t + r.came, 0), expected = rooms.reduce((t, r) => t + r.expected, 0)
  const week = days.map((d) => ({ date: d, pct: plantDay(s, d, now), today: d === date }))
  const waiting = DEPTS.reduce((t, d) => t + stopsWaiting(s, d).length, 0), held = holdsOpen(s).length
  const hm = (m: number) => (m >= 60 ? Math.floor(m / 60) + ' h ' + String(Math.round(m % 60)).padStart(2, '0') : Math.round(m) + ' min')
  const low = rooms.filter((r) => r.goal > 0 && r.made / r.goal < 0.9)
  return (
    <div className="rd-sum">
      <div className="rd-sumbar">
        <h2>📊 {tr('Resumen de la planta')}</h2>
        {picker}
        <span className="rd-sumwhen">{tr('{0} días · {1} con producción', days.length, worked)}</span>
      </div>
      <div className="rd-tiles six">
        <div className={'rd-tile' + (vsGoal == null ? '' : vsGoal >= 90 ? ' ok' : vsGoal < 70 ? ' bad' : ' warn')}><label>🎯 {tr('Producción vs meta')}</label><b>{vsGoal == null ? '—' : vsGoal + '%'}</b><small>{vsGoal == null ? tr('sin metas puestas') : tr('de la meta de esos días')}</small></div>
        <div className="rd-tile"><label>📅 {tr('Días con producción')}</label><b>{worked}<small> / {days.length}</small></b><small>{tr('días del periodo')}</small></div>
        <div className={'rd-tile' + (worked && downMin >= 60 * worked ? ' warn' : '')}><label>⏸️ {tr('Tiempo parado')}</label><b>{hm(downMin)}</b><small>{tr('todas las líneas, sin contar Set up')}</small></div>
        <div className={'rd-tile' + (expected && came / expected < 0.9 ? ' warn' : '')}><label>👥 {tr('Asistencia')}</label><b>{expected ? Math.round((came / expected) * 100) + '%' : '—'}</b><small>{expected ? tr('{0} de {1} esperados', came, expected) : tr('sin asistencia anotada')}</small></div>
        <button type="button" className={'rd-tile link' + (waiting ? ' warn' : '')} onClick={() => onGo('act')} disabled={!has('act')}><label>❓ {tr('Paros sin razón')}</label><b>{waiting}</b><small>{tr('ahora · Ver la planta ›')}</small></button>
        <button type="button" className={'rd-tile link' + (held ? ' warn' : '')} onClick={() => onGo('hold')} disabled={!has('hold')}><label>🔍 {tr('On hold')}</label><b>{held}</b><small>{tr('ahora · Ver las unidades ›')}</small></button>
      </div>
      <div className="rd-sumgrid">
        <div className="rd-sumrooms">
          {rooms.map((r) => {
            const pct = r.goal ? Math.round((r.made / r.goal) * 100) : null
            return (
              <article key={r.dept} className="rd-sumroom" style={deptVars(r.dept)}>
                <header><b><i aria-hidden="true">{DEPT_LOOK[r.dept].emoji}</i>{r.dept}</b><span className="rd-sumdays">{r.worked === 1 ? tr('1 día') : tr('{0} días', r.worked)}</span></header>
                <div className="rd-sumroom-main">
                  <div><b className={'rd-sumpct ' + (pct == null ? '' : pct >= 90 ? 'ok-c' : pct < 70 ? 'bad-c' : 'wait-c')}>{pct == null ? '—' : pct + '%'}</b><small>{pct == null ? tr('sin meta') : tr('de la meta')}</small></div>
                  <Spark values={r.bars} unit={r.unit} />
                </div>
                <span className="rd-bar"><i style={{ width: Math.min(100, pct ?? 0) + '%' }} /></span>
                <div className="rd-sumroom-nums">
                  <span><b>{fmtN(r.made)}</b> {r.unit}{r.goal ? <small> / {fmtN(r.goal)}</small> : null}</span>
                  <span>⏸️ <b>{hm(r.down)}</b></span>
                  <span>👥 <b>{r.expected ? Math.round((r.came / r.expected) * 100) + '%' : '—'}</b></span>
                </div>
              </article>
            )
          })}
        </div>
        <div className="rd-sumside">
          <article className="rd-card">
            <h3>📈 {tr('Producción vs meta por día')}</h3>
            {week.some((w) => w.pct != null) ? <Bars values={week} /> : <p className="rd-calm warn">{tr('Pon las metas de cada cuarto (Planeación › Metas) para ver aquí el % de cada día.')}</p>}
            <small className="rd-sumnote">{tr('Lo hecho cada día contra la meta de sus turnos, promedio de los cuartos con meta.')}</small>
          </article>
          <article className="rd-card">
            <h3>🔔 {tr('Lo que necesita atención')}{low.length > 0 && <span className="rd-pill stop">{low.length}</span>}</h3>
            {low.length ? low.map((r) => <div key={r.dept} className="rd-alert w"><b>{tr('{0} hizo el {1}% de su meta', r.dept, Math.round((r.made / r.goal) * 100))}</b><span>{tr('{0} de {1} {2} en el periodo', fmtN(r.made), fmtN(r.goal), r.unit)}</span></div>)
              : <p className="rd-calm">{withGoal.length ? tr('Todos los cuartos con meta llegaron al 90% o más.') : tr('Sin metas puestas: no hay contra qué comparar.')}</p>}
          </article>
        </div>
      </div>
    </div>
  )
}
