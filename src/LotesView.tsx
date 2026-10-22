import { useMemo, useState } from 'react'
import { fmtN, type Dept, type State } from './store'
import { chainMatch, lossClass, lotChains, lotsSummary, type LotChain, type Step } from './lotes'
import { DEPT_LOOK } from './look'
import type { ReportAt } from './ReportView'
import { tr } from './i18n'
import { trx } from './trx'

/**
 * The "Lotes" tab (Jose and the office, 2026-10-21/22; the mockup he showed): each lot of each code followed down its
 * rooms, what each one should make of what the one before made, what is still missing while it works, and what was
 * lost once it finished; a summary for the bosses and the rooms that lose the most. See lotes.ts for the arithmetic.
 * It replaces Flujo, which stays in Ajustes, off. A tap on a lot opens its chain; a tap on a number, its records.
 */
type Range = 'today' | 'yesterday' | 'week' | 'pick'
type Show = '' | 'run' | 'late' | 'done' | 'bad'
let keptRange: Range = 'week', keptQ = '', keptShow: Show = ''

const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }
const pctText = (x: number | null) => (x == null ? '—' : (Math.round(x * 1000) / 10).toLocaleString('en-US') + '%')
const unitText = (u: string) => (u === 'mezclas' ? tr('mezclas') : u === 'pouches' ? tr('pouches') : u === 'cajas' ? tr('cajas') : u)

export function LotesView({ s, today, onReport }: { s: State; today: string; onReport: (x: ReportAt) => void }) {
  const [range, setRange] = useState<Range>(keptRange)
  const [from, setFrom] = useState(addDays(today, -6)), [to, setTo] = useState(today)
  const [q, setQ] = useState(keptQ)
  const [show, setShow] = useState<Show>(keptShow)
  const [open, setOpen] = useState<string | null>(null)
  const [how, setHow] = useState(false)
  const span = range === 'today' ? [today, today] : range === 'yesterday' ? [addDays(today, -1), addDays(today, -1)] : range === 'week' ? [addDays(today, -6), today] : [from <= to ? from : to, from <= to ? to : from]
  const all = useMemo(() => lotChains(s, span[0], span[1]), [s, span[0], span[1]]) // eslint-disable-line react-hooks/exhaustive-deps
  const found = all.filter((c) => chainMatch(c, q))
  const isShow = (c: LotChain, k: Show) => (!k ? true : k === 'bad' ? lossClass(c.totalPct) === 'bad' || c.steps.some((x) => x.state === 'loss' && lossClass(x.pct) === 'bad') : c.status === k)
  const list = found.filter((c) => isShow(c, show))
  const sum = lotsSummary(found)
  const key = (c: LotChain) => c.code + '|' + c.lot
  const openKey = open ?? (list[0] ? key(list[0]) : null)
  const pickRange = (r: Range) => { keptRange = r; setRange(r); setOpen(null) }
  const go = (c: LotChain, dept: Dept) => onReport({ date: c.days[c.days.length - 1] ?? today, dept, shift: 0, code: c.code, lot: c.lot, view: 'code' })
  const count = (k: Show) => found.filter((c) => isShow(c, k)).length
  return (
    <div className="lt">
      <div className="lt-head"><h2>{tr('🔗 Lotes')}</h2><small>{tr('Lo que hizo Kitchen o Spiral, lo que debería salir en cada cuarto, lo que falta y lo que se perdió en el camino.')}</small></div>
      <div className="chips">
        {(['today', 'yesterday', 'week', 'pick'] as const).map((r) => <button key={r} type="button" className={'chip' + (range === r ? ' on' : '')} aria-pressed={range === r} onClick={() => pickRange(r)}>{r === 'today' ? tr('Hoy') : r === 'yesterday' ? tr('Ayer') : r === 'week' ? tr('Esta semana') : tr('Escoger días')}</button>)}
        {range === 'pick' && <span className="lt-days"><input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label={tr('Desde')} /> – <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label={tr('Hasta')} /></span>}
        <input className="lt-q" value={q} placeholder={tr('Buscar código, lote o producto…')} aria-label={tr('Buscar código, lote o producto…')} onChange={(e) => { keptQ = e.target.value; setQ(e.target.value) }} />
      </div>
      <div className="lt-tiles">
        <div className="lt-tile"><label>{tr('Lotes en camino')}</label><b>{sum.running}</b><small>{tr('todavía los está trabajando algún cuarto, o van atrás')}</small></div>
        <div className="lt-tile ok"><label>{tr('Lotes terminados')}</label><b>{sum.done}</b><small>{tr('ya salieron de Packing')}</small></div>
        <div className={'lt-tile ' + lossClass(sum.pct)}><label>{tr('Pérdida de lo terminado')}</label><b>{pctText(sum.pct)}</b><small>{sum.pct == null ? tr('ningún lote terminado todavía') : tr('{0} cajas de {1} esperadas', fmtN(sum.lost), fmtN(sum.expected))}</small></div>
        <div className="lt-tile"><label>{tr('El que más perdió')}</label><b>{sum.worst ? sum.worst.code + ' · ' + sum.worst.lot : '—'}</b><small>{sum.worst ? pctText(sum.worst.totalPct) + ' · ' + tr('{0} cajas', fmtN(sum.worst.totalLoss ?? 0)) : ''}</small></div>
      </div>
      <div className="chips lt-show">
        {([['', tr('Todos')], ['run', tr('En camino')], ['late', tr('Van atrás')], ['done', tr('Terminados')], ['bad', tr('Pérdida alta')]] as const).map(([k, label]) => (count(k) > 0 || show === k || !k) && <button key={k} type="button" className={'chip sm' + (show === k ? ' on' : '') + (k === 'bad' ? ' warnc' : '')} aria-pressed={show === k} onClick={() => { keptShow = k; setShow(k); setOpen(null) }}>{label}<small>{count(k)}</small></button>)}
      </div>
      {!list.length ? <p className="hint">{all.length ? tr('Ningún lote con esos filtros.') : tr('Ningún lote en esos días.')}</p> : list.map((c) => key(c) === openKey
        ? <LotDetail key={key(c)} c={c} onClose={() => setOpen('')} onGo={(d) => go(c, d)} />
        : <LotRow key={key(c)} c={c} onOpen={() => setOpen(key(c))} />)}
      {sum.byRoom.length > 0 && (
        <>
          <h3 className="lt-h">{tr('¿Dónde se pierde más?')}</h3>
          <div className="lt-rank">{sum.byRoom.map((x) => <div key={x.dept} className="lt-rrow"><b>{DEPT_LOOK[x.dept].emoji} {x.dept}</b><div className="lt-rbar"><i className={lossClass(x.pct)} style={{ width: Math.min(100, Math.round(x.pct * 1000)) + '%' }} /></div><b>{pctText(x.pct)}</b></div>)}</div>
        </>
      )}
      <button type="button" className="lnk lt-howbtn" onClick={() => setHow(!how)}>{how ? tr('Ocultar cómo se calcula ▴') : tr('¿Cómo se calcula? ▾')}</button>
      {how && (
        <div className="lt-how">
          <p>{trx('{0}: sale de lo que de verdad hizo el cuarto anterior, con la tabla de Productos. Mezclas × cajas por mezcla = cajas; × pouches por caja = pouches (RTE) o × platos por caja = platos (MFO); lo que hizo RTE o MFO ÷ por caja = las cajas que le tocan a Packing; ÷ cajas por pallet = pallets.', <b>{tr('Esperado')}</b>)}</p>
          <p>{trx('{0}: mientras el cuarto sigue trabajando el lote. {1}: lo que no llegó cuando el cuarto ya lo terminó. El % es lo perdido ÷ lo esperado. Cada cuarto responde por lo que recibió; la pérdida total del lote va contra lo que dieron las mezclas.', <b>{tr('Falta')}</b>, <b>{tr('Pérdida')}</b>)}</p>
          <p>{tr('Colores: verde = completo o pérdida de 2% o menos · azul = en camino · amarillo = va atrás o pérdida de 2% a 5% · rojo = pérdida de más de 5%.')}</p>
        </div>
      )}
    </div>
  )
}

const statusText = (c: LotChain) => (c.status === 'done' ? (c.totalPct != null && c.totalPct < 0 ? tr('Terminado · {0} de más', pctText(-c.totalPct)) : c.totalPct != null ? tr('Terminado · pérdida {0}', pctText(c.totalPct)) : tr('Terminado')) : c.status === 'run' ? tr('En camino') : c.status === 'late' ? tr('Va atrás · nadie lo trabaja ahora') : tr('Sin empezar'))
const statusClass = (c: LotChain) => (c.status === 'done' ? lossClass(c.totalPct) || 'ok' : c.status === 'run' ? 'go' : 'warn')
const route = (c: LotChain) => c.steps.map((x) => x.dept).join(' → ')

/** what a step says under its numbers: lost, still missing, not started, complete, more than expected */
function gapText(st: Step): { text: string; cls: string } {
  const g = st.gap != null ? fmtN(Math.abs(st.gap)) : ''
  if (st.state === 'nocalc') return { text: tr('falta un dato en Productos'), cls: '' }
  if (st.state === 'wait') return { text: tr('no ha empezado'), cls: '' }
  if (st.state === 'run') return { text: st.gap != null && st.gap > 0 ? tr('faltan {0}', g) + (st.running ? ' · ' + tr('trabajando') : '') : tr('trabajando'), cls: 'go' }
  if (st.state === 'over') return { text: tr('{0} de más', g), cls: 'ok' }
  if (st.state === 'ok') return { text: tr('✓ completo'), cls: 'ok' }
  return { text: tr('pérdida {0} · {1}', g, pctText(st.pct)), cls: lossClass(st.pct) }
}
const barWidth = (st: Step) => (st.expected ? Math.max(0, Math.min(100, Math.round((st.done / st.expected) * 1000) / 10)) : 0)

function LotRow({ c, onOpen }: { c: LotChain; onOpen: () => void }) {
  return (
    <button type="button" className={'lt-lot ' + statusClass(c)} onClick={onOpen}>
      <div className="lt-ltop"><b className="lt-code">{c.code}</b><span className="lt-lotn">{tr('lote')} <b>{c.lot}</b></span><span className={'lt-st ' + statusClass(c)}>{statusText(c)}</span><span className="lt-pname">{(c.name ? c.name + ' · ' : '') + route(c)}</span></div>
      <div className="lt-chain">{c.steps.map((st, i) => {
        const gt = gapText(st)
        return (
          <div key={st.dept} className="lt-step">
            <label>{DEPT_LOOK[st.dept].emoji} {st.dept}</label>
            {i === 0 ? <><b>{fmtN(st.done)} {unitText(st.unit)}</b><small>{c.originCases != null ? tr('se esperan {0} cajas', fmtN(c.originCases)) : tr('falta un dato en Productos')}</small></>
              : <><b>{fmtN(st.done)}{st.expected != null ? ' ' + tr('de {0}', fmtN(st.expected)) : ''}</b><small>{unitText(st.unit)}{st.pallets ? ' · ' + tr('{0} pallets', st.pallets.done) : ''}</small><div className="lt-bar"><i className={gt.cls} style={{ width: barWidth(st) + '%' }} /></div><span className={'lt-gap ' + gt.cls}>{gt.text}</span></>}
          </div>
        )
      })}</div>
    </button>
  )
}

function LotDetail({ c, onClose, onGo }: { c: LotChain; onClose: () => void; onGo: (d: Dept) => void }) {
  const r = c.row
  return (
    <div className={'lt-detail ' + statusClass(c)}>
      <div className="lt-ltop"><b className="lt-code">{c.code}</b><span className="lt-lotn">{tr('lote')} <b>{c.lot}</b></span><span className="lt-pname">{c.name}</span><span className={'lt-st ' + statusClass(c)}>{statusText(c)}</span><button type="button" className="btn xs" onClick={onClose}>{tr('Cerrar')}</button></div>
      {c.missing.length > 0 && <p className="hint red">{tr('Para calcularlo falta en Productos: {0}.', c.missing.map((m) => tr(m)).join(', '))}</p>}
      <div className="lt-vchain">
        {c.steps.map((st, i) => {
          const gt = gapText(st), prog = r.prog.find((p) => p.dept === st.dept)
          const next = c.steps[i + 1]
          const down = i === 0 && c.originCases != null && next?.expected != null ? trx('{0} mezclas × {1} cajas por mezcla = {2} cajas = {3} {4}', fmtN(c.mixes), fmtN(r.yieldCs ?? 0), <b>{fmtN(c.originCases)}</b>, <b>{fmtN(next.expected)}</b>, unitText(next.unit) + (r.perCase ? ' (' + tr('{0} por caja', fmtN(r.perCase)) + ')' : ''))
            : i === 1 && next?.expected != null ? trx('{0} {1} ÷ {2} = {3} cajas esperadas en Packing{4}', fmtN(st.done), unitText(st.unit), fmtN(r.perCase ?? 0), <b>{fmtN(next.expected)}</b>, next.pallets?.expected != null ? ' = ' + tr('{0} pallets', next.pallets.expected) + (r.perPallet ? ' (' + tr('{0} por pallet', fmtN(r.perPallet)) + ')' : '') : '') : null
          return (
            <div key={st.dept}>
              <div className="lt-vstep"><div className="lt-vroom">{DEPT_LOOK[st.dept].emoji} {st.dept}</div>
                <div className="lt-vbox">
                  <div className="lt-vnums">
                    {i === 0 ? <div><label>{tr('Programado')}</label><b>{prog ? fmtN(prog.qty) : '—'}</b> <small>{unitText(st.unit)}</small></div> : <div><label>{tr('Esperado')}</label><b>{st.expected != null ? fmtN(st.expected) : '—'}</b> <small>{unitText(st.unit)}{st.pallets?.expected != null ? ' · ' + tr('{0} pallets', st.pallets.expected) : ''}</small></div>}
                    <div><label>{tr('Hecho')}</label><button type="button" className="drill" onClick={() => onGo(st.dept)}><b>{fmtN(st.done)}</b></button> <small>{unitText(st.unit)}{st.pallets ? ' · ' + tr('{0} pallets', st.pallets.done) : ''}</small></div>
                    {i > 0 && <div><label>{st.state === 'loss' ? tr('Pérdida') : st.state === 'over' ? tr('De más') : tr('Falta')}</label><b className={gt.cls}>{st.gap != null && st.state !== 'wait' && st.state !== 'nocalc' ? fmtN(Math.abs(st.gap)) : '—'}</b> <small>{st.state === 'loss' ? pctText(st.pct) : ''}</small></div>}
                    <div><label>{tr('Estado')}</label><small className={'lt-gap ' + gt.cls}>{i === 0 ? (st.running ? tr('trabajando') : st.done > 0 ? tr('✓ hecho') : tr('no ha empezado')) : gt.text}</small></div>
                  </div>
                  {i > 0 && st.expected != null && <div className="lt-bar"><i className={gt.cls} style={{ width: barWidth(st) + '%' }} /></div>}
                </div>
              </div>
              {down && <div className="lt-vdown">↓ {down}</div>}
            </div>
          )
        })}
      </div>
      {c.totalLoss != null && <div className={'lt-lossbox ' + lossClass(c.totalPct)}>{c.totalLoss < 0 ? tr('Del lote salieron {0} cajas más de las {1} esperadas · {2} de más', fmtN(-c.totalLoss), fmtN(c.originCases ?? 0), pctText(-(c.totalPct ?? 0))) : tr('Pérdida total del lote: {0} cajas de {1} esperadas · {2}', fmtN(c.totalLoss), fmtN(c.originCases ?? 0), pctText(c.totalPct))}<small>{tr('Contra lo que dieron las mezclas. Toca un número de "Hecho" para ver sus registros en el Reporte.')}</small></div>}
      {c.totalLoss == null && c.status !== 'done' && <p className="hint">{tr('La pérdida total sale cuando todos los cuartos terminen el lote. Toca un número de "Hecho" para ver sus registros en el Reporte.')}</p>}
    </div>
  )
}
