import { useMemo } from 'react'
import { CFG, DEPTS, fmtDur, lineNameOf, normCode, orderStatus, orderUnitWord, planRows, prevPending, reasonText, SETUP, shiftAt, shiftsOf, workOrderOf, type Dept, type PlanRow, type State } from './store'
import { woName } from './WorkOrders'
import { woN } from './woSum'
import { DeptBadge, type ReportAt } from './ReportView'
import { DEPT_LOOK, deptVars } from './look'
import { tr } from './i18n'

/**
 * "Programa del día" (Jose and the office, 2026-10-20: "que ellos vean su programación ... lo que hizo cada turno y lo
 * que le toca al otro turno por hacer y lo que sigue disponible ... de una forma muy intuitiva, que no lo haga pensar").
 * One card per room with the day's program: each code with its lot is a row with four boxes, Programado · Turno 1 ·
 * Turno 2 · Falta, a bar of the two shifts, and what it is doing now (stopped, running, waiting, complete). What
 * yesterday left of it and its production order are said under it. On top, each room's share done, to go to its card.
 * It reads what the room's card reads (planRows: each unit to the row of its lot), so both always say the same. Every
 * number opens its records in the Reporte (onReport). Until the admin turns it on for everybody in Ajustes, only the
 * admin sees the tab (store.ts, setProgramView).
 */
type Look = { kind: 'stop' | 'setup' | 'run' | 'done' | 'started' | 'wait'; text: string; at?: ReportAt }
type Row = PlanRow & { look: Look; carry: number; order: string }

export function ProgramToday({ s, date, now, rooms, onReport }: { s: State; date: string; now: number; rooms: Dept[]; onReport: (x: ReportAt) => void }) {
  // the rows change with the store; what each line is doing now is looked at every second (its stop's minutes)
  const base = useMemo(() => rooms.map((d) => ({ dept: d, rows: planRows(s, date, d), carried: prevPending(s, d, date) })), [s, date, rooms.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const shiftNow = shiftAt(shiftsOf(s, date), now)
  const cards = base.map(({ dept, rows, carried }) => {
    const planned = rows.filter((r) => r.planned > 0)
    const also = rows.filter((r) => r.planned <= 0 && r.done > 0)
    const list: Row[] = planned.map((r) => {
      const carry = carried.filter((c) => normCode(c.code) === normCode(r.code) && c.lot === r.lot).reduce((t, c) => t + c.n, 0)
      const o = r.orderId ? workOrderOf(s, r.orderId) : undefined
      const st = o && !o.deleted ? orderStatus(s, o, date) : null
      const order = o && st ? tr('Pedido {0}: quedan {1} de {2} {3}', woName(o), woN(st.disponible), woN(o.qty), orderUnitWord(o)) : ''
      return { ...r, look: lookOf(s, dept, date, r, now), carry, order }
    }).sort((a, b) => RANK[a.look.kind] - RANK[b.look.kind] || a.code.localeCompare(b.code, undefined, { numeric: true }))
    const share = planned.length ? planned.reduce((t, r) => t + Math.min(1, r.done / r.planned), 0) / planned.length : 0
    const complete = planned.filter((r) => r.done >= r.planned).length
    const stopped = new Set(list.filter((r) => r.look.kind === 'stop').flatMap((r) => r.lines)).size
    return { dept, list, also, share, complete, stopped }
  })
  const shown = cards.filter((c) => c.list.length || c.also.length), none = cards.filter((c) => !c.list.length && !c.also.length)
  const toCard = (d: Dept) => document.getElementById('pt-' + d)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const pct = (x: number) => Math.round(x * 100) + '%'
  return (
    <div className="pt">
      <div className="pt-head">
        <div><h2>{tr('📋 Programa del día')}</h2><small>{tr('lo que programó la oficina, lo que hizo cada turno y lo que falta')}</small></div>
        {shiftNow > 0 && <span className="pt-live"><i />{tr('Turno {0} en curso · al momento', shiftNow)}</span>}
      </div>
      {!shown.length ? <p className="hint">{tr('Todavía no hay programa para hoy.')}</p> : (
        <>
          <div className="pt-strip">
            {shown.map((c) => (
              <button key={c.dept} type="button" className="pt-tile" style={deptVars(c.dept)} onClick={() => toCard(c.dept)}>
                <span>{DEPT_LOOK[c.dept].emoji} {c.dept}</span><b>{c.list.length ? pct(c.share) : '—'}</b>
                <small>{c.list.length ? tr('{0} de {1} completos', c.complete, c.list.length) : tr('sin programa')}{c.stopped > 0 && ' · ' + (c.stopped === 1 ? tr('1 línea parada') : tr('{0} líneas paradas', c.stopped))}</small>
              </button>
            ))}
          </div>
          <div className="pt-legend"><span className="t1">{tr('Turno 1')}</span><span className="t2">{tr('Turno 2')}</span><span className="left">{tr('Falta')}</span><span>{tr('Toca un número para ver sus registros')}</span></div>
          <div className="pt-cards">
            {shown.map((c) => <Card key={c.dept} {...c} date={date} shiftNow={shiftAt(shiftsOf(s, date, c.dept), now)} onReport={onReport} />)}
          </div>
        </>
      )}
      {none.length > 0 && shown.length > 0 && <p className="hint">{tr('Sin programa hoy: {0}', none.map((c) => DEPT_LOOK[c.dept].emoji + ' ' + c.dept).join(' · '))}</p>}
      <p className="hint">{tr('"Falta" es lo que le toca al siguiente turno. Lo que el día no termina vuelve a su pedido, y mañana sale como "viene de ayer".')}</p>
    </div>
  )
}

/** first what needs a look: stopped, then in set up, running, started and left, not started, and complete last */
const RANK: Record<Look['kind'], number> = { stop: 0, setup: 1, run: 2, started: 3, wait: 4, done: 5 }

/** what a program row is doing now: a line of it stopped (the longest), in set up, running, or else how far it is */
function lookOf(s: State, dept: Dept, date: string, r: PlanRow, now: number): Look {
  if (r.planned > 0 && r.done >= r.planned) return { kind: 'done', text: tr('✓ Completo') }
  const open = s.runs.filter((x) => !x.deleted && !x.endedAt && x.dept === dept && x.date === date && normCode(x.code) === normCode(r.code) && r.lines.includes(lineNameOf(s, x.lineId, x.line)))
  const stops = open.flatMap((x) => s.stops.filter((y) => !y.deleted && !y.endedAt && y.dept === dept && (y.lineId === x.lineId || y.lineId === null)).map((y) => ({ y, x }))).sort((a, b) => a.y.startedAt - b.y.startedAt)
  const down = stops.find((p) => p.y.reason !== SETUP)
  if (down) return { kind: 'stop', text: tr('⏸ {0} parada · {1}', lineNameOf(s, down.x.lineId, down.x.line), fmtDur(now - down.y.startedAt)) + ' · ' + reasonText(s, down.y.reason), at: { date, dept, shift: 0, line: down.x.lineId, view: 'rec', rec: 'stops', cause: '!setup' } }
  const setup = stops.find((p) => p.y.reason === SETUP)
  if (setup) return { kind: 'setup', text: tr('⏱ Set up en {0}', lineNameOf(s, setup.x.lineId, setup.x.line)) }
  if (r.running) return { kind: 'run', text: tr('● Corriendo en {0}', r.lines.join(', ')) }
  if (r.done > 0) return { kind: 'started', text: tr('◐ Empezado · ninguna línea lo corre ahora') }
  return { kind: 'wait', text: tr('◌ Pendiente · no ha empezado') }
}

function Card({ dept, list, also, share, complete, date, shiftNow, onReport }: { dept: Dept; list: Row[]; also: PlanRow[]; share: number; complete: number; date: string; shiftNow: number; onReport: (x: ReportAt) => void }) {
  const unitOf = (r: PlanRow) => r.unit || CFG[dept].plural.toLowerCase()
  const planned = list.reduce((t, r) => t + r.planned, 0), done = list.reduce((t, r) => t + Math.min(r.done, r.planned), 0)
  // (one unit for the whole room only when every row counts in it: Spiral mixes mezclas and pounds)
  const oneUnit = list.length > 0 && list.every((r) => unitOf(r) === unitOf(list[0]))
  const go = (r: PlanRow, x: Partial<ReportAt> = {}) => onReport({ date, dept, shift: 0, code: r.code, lot: r.lot, view: 'code', ...x })
  return (
    <section id={'pt-' + dept} className="pt-card" style={deptVars(dept)}>
      <div className="pt-chead">
        <DeptBadge d={dept} />
        <span className="pt-sum">{oneUnit ? tr('{0} de {1} {2} · faltan {3}', woN(done), woN(planned), unitOf(list[0]), woN(Math.max(0, planned - done))) : tr('{0} de {1} códigos completos', complete, list.length)}</span>
        <button type="button" className="btn xs soft" onClick={() => onReport({ date, dept, shift: 0, view: 'gen' })}>{tr('Reporte de {0}', dept)}</button>
      </div>
      {list.length > 0 && <div className="pt-bar" title={Math.round(share * 100) + '%'}><i className="t1" style={{ width: Math.round(share * 100) + '%' }} /></div>}
      {list.map((r) => {
        const one = r.byShift[0], two = r.byShift[1], left = Math.max(0, r.left)
        const w = (n: number) => Math.max(0, Math.min(100, Math.round((n / r.planned) * 100))) + '%'
        return (
          <div key={r.code + '|' + r.lot} className="pt-row">
            <div className="pt-rtop">
              <button type="button" className="drill pt-code" onClick={() => go(r)}>{r.code}</button>
              {r.lot && <span className="pt-lot">{tr('lote')} <b>{r.lot}</b></span>}
              {r.look.at ? <button type="button" className={'pt-st ' + r.look.kind} onClick={() => onReport(r.look.at!)}>{r.look.text}</button> : <span className={'pt-st ' + r.look.kind}>{r.look.text}</span>}
              {r.name && <span className="pt-pname">{r.name}</span>}
            </div>
            <div className="pt-nums">
              <button type="button" className="pt-n" onClick={() => go(r)}><label>{tr('Programado')}</label><b>{woN(r.planned)}</b> <small>{unitOf(r)}</small></button>
              <button type="button" className={'pt-n' + (shiftNow === 1 ? ' now' : '')} onClick={() => go(r, { shift: 1, view: 'rec', rec: 'runs' })}><label>{tr('Turno 1')}</label><b>{one ? woN(one) : '—'}</b></button>
              <button type="button" className={'pt-n' + (shiftNow === 2 ? ' now' : '')} onClick={() => go(r, { shift: 2, view: 'rec', rec: 'runs' })}><label>{tr('Turno 2')}</label><b>{two ? woN(two) : '—'}</b></button>
              <button type="button" className={'pt-n ' + (left > 0 ? 'left' : 'ok')} onClick={() => go(r)}><label>{tr('Falta')}</label><b>{woN(left)}</b> <small>{left > 0 ? unitOf(r) : '✓'}</small></button>
            </div>
            <div className="pt-bar"><i className="t1" style={{ width: w(one) }} /><i className="t2" style={{ width: w(Math.min(two, Math.max(0, r.planned - one))) }} /></div>
            {(r.carry > 0 || r.order || r.done > r.planned || r.also.length > 0) && (
              <div className="pt-tags">
                {r.carry > 0 && <span className="pt-tag carry">{tr('↩ ayer quedaron {0} {1}', woN(r.carry), unitOf(r))}</span>}
                {r.order && <span className="pt-tag order">{r.order}</span>}
                {r.done > r.planned && <span className="pt-tag">{tr('+{0} de más', woN(Math.round((r.done - r.planned) * 100) / 100))}</span>}
                {r.also.map((x) => <span key={x.lot} className="pt-tag">{tr('también lote {0}: {1}', x.lot, woN(x.n))}</span>)}
              </div>
            )}
          </div>
        )
      })}
      {also.length > 0 && <div className="pt-tags">{also.map((r) => <button key={r.code + '|' + r.lot} type="button" className="pt-tag drill" onClick={() => go(r)}>{tr('Sin programa: {0} · {1} {2}', r.code, woN(r.done), unitOf(r))}</button>)}</div>}
    </section>
  )
}

/** the rooms the tab shows: every one for whoever sees all rooms, else their own */
export const programRooms = (all: boolean, home: Dept): Dept[] => (all ? [...DEPTS] : [home])
