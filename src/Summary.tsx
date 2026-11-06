import { attExpectedOf, attOf, DEPTS, deptStop, deptToday, fmtN, holdsOpen, openRun, openStop, SETUP, shiftGoalOf, stopsWaiting, turnOf, type Dept, type State } from './store'
import { DEPT_LOOK, deptVars } from './look'
import { tr } from './i18n'

/**
 * Resumen (the redesign, 2026-11-05): the plant on one page for the bosses and the CEO, stats first. Everything is
 * the shift in course, as on the floor (each shift starts from zero): what each room made against what its goal asks
 * by this hour, its lines, its time stopped and its people; and each room's last seven days in its own unit. Only
 * numbers the app already has: what it cannot know (yield, PPLH, the weights' summary) is one tap away in its own tab.
 */
const day = (date: string, n: number) => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

function roomNow(s: State, d: Dept, date: string, now: number) {
  const t = turnOf(s, date, now, d)
  const goal = t.shift ? shiftGoalOf(s, d, t.shift).total : 0
  const td = deptToday(s, d, date, now)
  // what the goal asks by now: the shift's goal spread over its hours (the shift is not over: a full goal at 9 AM would read as a failure)
  const span = Math.max(1, t.until - t.since), part = Math.min(1, Math.max(0, (now - t.since) / span))
  const due = goal ? goal * part : 0
  const lines = s.lines.filter((l) => l.dept === d)
  const run = lines.filter((l) => openRun(s, l.id) && !openStop(s, d, l.id)).length
  const stopped = lines.filter((l) => { const st = openStop(s, d, l.id); return !!st && st.reason !== SETUP && !!openRun(s, l.id) }).length
  const stopMin = s.stops.filter((x) => !x.deleted && x.dept === d && x.reason !== SETUP && x.startedAt < now && (x.endedAt ?? now) > t.since)
    .reduce((m, x) => m + (Math.min(x.endedAt ?? now, now) - Math.max(x.startedAt, t.since)) / 60_000, 0)
  const sh = (t.shift || 1) as 1 | 2
  const came = attOf(s, date, d, sh).filter((x) => !x.gone).length, expected = attExpectedOf(s, d, sh)
  const week = Array.from({ length: 7 }, (_, i) => day(date, i - 6)).map((x) => deptToday(s, d, x, now).qty)
  return { t, goal, due, made: td.shiftQty, unit: td.unitLabel, lines: lines.length, run, stopped, stopMin, came, expected, week, down: !!deptStop(s, d) }
}

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values), w = 112, h = 30, step = w / (values.length - 1)
  const pts = values.map((v, i) => [i * step, h - 3 - (v / max) * (h - 8)] as const)
  return (
    <svg className="rd-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={tr('Los últimos 7 días: {0}', values.map(fmtN).join(', '))}>
      <polyline points={pts.map((p) => p.join(',')).join(' ')} />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" />
    </svg>
  )
}

type Go = 'wt' | 'pplh' | 'mini' | 'dash' | 'act' | 'hold'
export function Summary({ s, now, date, onGo, has }: { s: State; now: number; date: string; onGo: (t: Go) => void; has: (t: Go) => boolean }) {
  const rooms = DEPTS.map((d) => ({ d, ...roomNow(s, d, date, now) }))
  const withGoal = rooms.filter((r) => r.due > 0)
  const vsGoal = withGoal.length ? Math.round(withGoal.reduce((t, r) => t + Math.min(2, r.made / r.due), 0) / withGoal.length * 100) : null
  const lines = rooms.reduce((t, r) => t + r.lines, 0), run = rooms.reduce((t, r) => t + r.run, 0), stopped = rooms.reduce((t, r) => t + r.stopped, 0)
  const stopMin = Math.round(rooms.reduce((t, r) => t + r.stopMin, 0))
  const came = rooms.reduce((t, r) => t + r.came, 0), expected = rooms.reduce((t, r) => t + r.expected, 0)
  const waiting = DEPTS.reduce((t, d) => t + stopsWaiting(s, d).length, 0), held = holdsOpen(s).length
  const state = (r: (typeof rooms)[number]) => (r.down || r.stopped ? 'stop' : r.run ? 'run' : 'free')
  return (
    <div className="rd-sum">
      <p className="rd-sum-note">{tr('El turno en curso de cada cuarto, en vivo. La meta se compara con lo que pide a esta hora.')}</p>
      <div className="rd-tiles six">
        <div className={'rd-tile' + (vsGoal == null ? '' : vsGoal >= 90 ? ' ok' : vsGoal < 70 ? ' bad' : ' warn')}><label>{tr('Producción vs meta')}</label><b>{vsGoal == null ? '—' : vsGoal + '%'}</b><small>{vsGoal == null ? tr('sin metas puestas') : tr('lo que pide la meta a esta hora')}</small></div>
        <div className="rd-tile"><label>{tr('Líneas trabajando')}</label><b>{run}<small> / {lines}</small></b><small>{stopped ? (stopped === 1 ? tr('1 parada ahora') : tr('{0} paradas ahora', stopped)) : tr('ninguna parada ahora')}</small></div>
        <div className={'rd-tile' + (stopMin >= 60 ? ' bad' : '')}><label>{tr('Paros del turno')}</label><b>{fmtN(stopMin)}<small> min</small></b><small>{tr('sin contar Set up')}</small></div>
        <div className="rd-tile"><label>{tr('Gente')}</label><b>{came}<small> / {expected}</small></b><small>{expected ? tr('{0}% de los esperados', Math.round((came / expected) * 100)) : ''}</small></div>
        <button type="button" className={'rd-tile link' + (waiting ? ' warn' : '')} onClick={() => onGo('act')} disabled={!has('act')}><label>{tr('Paros sin razón')}</label><b>{waiting}</b><small>{tr('Ver la planta ›')}</small></button>
        <button type="button" className={'rd-tile link' + (held ? ' warn' : '')} onClick={() => onGo('hold')} disabled={!has('hold')}><label>{tr('On hold')}</label><b>{held}</b><small>{tr('Ver las unidades ›')}</small></button>
      </div>
      <div className="rd-card">
        <h3>{tr('Por cuarto')}</h3>
        <div className="rd-twrap">
          <table className="rd-table">
            <thead><tr><th>{tr('Cuarto')}</th><th className="n">{tr('Hecho en el turno')}</th><th className="n">{tr('Pide la meta a esta hora')}</th><th className="n">%</th><th className="n">{tr('Líneas')}</th><th className="n">{tr('Paros')}</th><th className="n">{tr('Gente')}</th><th>{tr('Últimos 7 días')}</th><th>{tr('Ahora')}</th></tr></thead>
            <tbody>
              {rooms.map((r) => {
                const pct = r.due ? Math.round((r.made / r.due) * 100) : null
                const st = state(r)
                return (
                  <tr key={r.d} style={deptVars(r.d)}>
                    <td className="rd-roomcell"><i aria-hidden="true">{DEPT_LOOK[r.d].emoji}</i>{r.d}</td>
                    <td className="n"><b>{fmtN(r.made)}</b> {r.unit}</td>
                    <td className="n">{r.due ? fmtN(r.due) : '—'}</td>
                    <td className={'n ' + (pct == null ? '' : pct >= 90 ? 'ok-c' : pct < 70 ? 'bad-c' : 'wait-c')}>{pct == null ? '—' : pct + '%'}</td>
                    <td className="n">{r.run} / {r.lines}</td>
                    <td className="n">{Math.round(r.stopMin)} min</td>
                    <td className="n">{r.came} / {r.expected}</td>
                    <td><Spark values={r.week} /></td>
                    <td><span className={'rd-pill ' + st}>{st === 'stop' ? tr('Parado') : st === 'run' ? tr('Trabajando') : tr('Sin trabajar')}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rd-more">
        {has('wt') && <button type="button" className="rd-morecard" onClick={() => onGo('wt')}><b>⚖ {tr('Pesos')}</b><span>{tr('pruebas hechas, en rango, bajos y sobre')}</span></button>}
        {has('dash') && <button type="button" className="rd-morecard" onClick={() => onGo('dash')}><b>📊 Dashboard</b><span>{tr('yield, shorts y PPLH con su gráfica')}</span></button>}
        {has('mini') && <button type="button" className="rd-morecard" onClick={() => onGo('mini')}><b>📅 {tr('Mini KPI')}</b><span>{tr('la semana de cada turno contra la meta')}</span></button>}
        {has('pplh') && <button type="button" className="rd-morecard" onClick={() => onGo('pplh')}><b>📈 PPLH</b><span>{tr('libras por hora de trabajo y downtime')}</span></button>}
      </div>
    </div>
  )
}
