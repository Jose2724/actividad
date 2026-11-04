import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { awayDay, type State } from './store'
import { loadDay } from './sync'
import { wtRangeLong, type WtAvg } from './kpi'
import { DASH_COLORS, DASH_KINDS, dashBook, dashOf, dashPplh, type DashCode, type DashKind } from './dash'
import { datesFrom, keepRange, rangeKept, rangeShortcuts } from './pplh'
import { RangePick } from './PplhView'
import { loadZip, xlsxNow, XLSX_TYPE } from './xlsx'
import { download } from './App'
import { locale, tr } from './i18n'
import { WhatIs } from './Numbers'

const kindName = (k: DashKind) => (k === 'raw' ? tr('Crudo') : k === 'cooked' ? tr('Cocinado') : tr('Pouch'))
const md = (d: string) => { const [, m, dd] = d.split('-').map(Number); return m + '/' + dd }
const wd = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short' })
const okClass = (x: WtAvg) => (x.ok === 'ok' ? ' ok' : x.ok === 'under' ? ' red' : x.ok === 'over' ? ' amber' : '')

/**
 * Mike's dashboard (his whiteboard, 2026-11-03): Yield, Shorts and PPLH on top; the "Yield + Weight Summary" with one
 * column per day; and per product the chart with the three lines. It opens on this week (Monday to Sunday), as his
 * board shows a week of columns; the ranges one taps are the same as PPLH's. Yield and Shorts wait for Mike's answers
 */
export function DashView({ s, date, now, pplh }: { s: State; date: string; now: number; pplh: boolean }) {
  const week = rangeShortcuts(date).find((q) => q.id === 'week') ?? { from: date, to: date }
  // (the range comes back after a reload; the report's day changing resets it)
  const [from, setFrom] = useState(() => rangeKept('dash')?.from ?? week.from)
  const [to, setTo] = useState(() => rangeKept('dash')?.to ?? week.to)
  const dateWas = useRef(date)
  useEffect(() => { if (dateWas.current === date) return; dateWas.current = date; const w = rangeShortcuts(date).find((q) => q.id === 'week'); if (w) { setFrom(w.from); setTo(w.to) } }, [date])
  useEffect(() => { keepRange('dash', from, to) }, [from, to])
  const dates = useMemo(() => (from && to && from <= to ? datesFrom(from, to) : [date]), [from, to, date])
  // (days older than the device keeps are brought from the server)
  useEffect(() => { for (const d of dates) if (awayDay(d)) void loadDay(d) }, [dates])
  const data = useMemo(() => dashOf(s, dates, now), [s, dates]) // eslint-disable-line react-hooks/exhaustive-deps
  const p = useMemo(() => dashPplh(s, dates), [s, dates])
  const weighed = data.some((c) => c.days.some((d) => d.times > 0))
  // the week's average beside the days (Mike, 2026-11-03), one per week the range touches; the range's own only when it spans more than a week
  const weeks = data[0]?.weeks ?? [], manyWeeks = weeks.length > 1, showWeeks = dates.length > 1
  const cell = (x: WtAvg, key: string, cls = '') => <td key={key} className={'n' + okClass(x) + cls}>{x.avg == null ? <span className="muted">—</span> : <><b>{x.avg.toFixed(2)}</b>{x.tests ? <small>{x.tests === 1 ? tr('1 prueba') : tr('{0} pruebas', x.tests)}<br />{x.n === 1 ? tr('1 peso') : tr('{0} pesos', x.n)}</small> : null}</>}</td>
  const excel = async () => {
    const make = () => xlsxNow(dashBook(s, dates[0], dates[dates.length - 1], dates, now))
    const bytes = make() ?? (await loadZip(), make())
    if (bytes) download(new File([bytes], 'Dashboard-' + dates[0] + (dates.length > 1 ? '_' + dates[dates.length - 1] : '') + '.xlsx', { type: XLSX_TYPE }))
  }
  // (trimmed to a readable width, Mike 2026-11-03: "too big, too many spaces, trim it": nothing stretches over a wide screen)
  return (
    <div className="dash">
      <RangePick from={from} to={to} today={date} onChange={(a, b) => { setFrom(a); setTo(b) }} />
      <div className="pplh-tiles dash-tiles">
        <div className="pend"><small>Yield</small><b>—</b><em>{tr('Pendiente: falta la fuente de las libras por producto')}</em></div>
        <div className="pend"><small>Shorts</small><b>—</b><em>{tr('Pendiente: por definir con Mike')}</em></div>
        {pplh ? <div className={p.pplh == null ? 'pend' : ''}><small>PPLH</small><b>{p.pplh == null ? '—' : p.pplh.toFixed(1)}</b><em>{p.pplh == null ? tr('Faltan las libras (NetSuite) o las horas (RR. HH.) de estos días') : tr('lb por hora de trabajo · {0} días con las dos', p.days)}</em></div>
          : <div className="pend"><small>PPLH</small><b>—</b><em>{tr('Solo lo ve quien tiene permiso en PPLH')}</em></div>}
      </div>
      <article className="wt-rp">
        <h3>{tr('Resumen de yield y pesos')} <WhatIs id="dash" /></h3>
        <div className="btns"><button type="button" className="btn primary" onClick={() => void excel()}>{tr('⬇ Excel del Dashboard')}</button></div>
        <div className="scroll"><table className="wt-rp-tbl dash-tbl">
          <thead><tr><th>{tr('Producto')}</th><th></th><th>Target</th>{dates.map((d) => <th key={d} className="n"><span>{md(d)}</span><small>{wd(d)}</small></th>)}{showWeeks && weeks.map((w) => <th key={w.monday} className="n dash-week"><span>{manyWeeks || w.days < 7 ? tr('Semana del {0}', md(w.monday)) : tr('Semana')}</span><small>{w.days === 7 ? tr('promedio') : tr('{0} de 7 días', w.days)}</small></th>)}{manyWeeks && <th className="n dash-week"><span>{tr('Rango')}</span><small>{tr('{0} días', dates.length)}</small></th>}</tr></thead>
          <tbody>{data.map((c) => DASH_KINDS.map((k, i) => (
            <tr key={c.code + k}>
              {i === 0 && <td rowSpan={3} className="dash-code"><b>{c.code}</b></td>}
              <td className={'dash-k dash-k-' + k}>{kindName(k)}</td>
              <td className="dash-target">{c.target[k] ? wtRangeLong(c.target[k]) : '—'}</td>
              {c.days.map((d) => cell(d[k], d.date))}
              {showWeeks && c.weeks.map((w) => cell(w[k], 'w' + w.monday, ' dash-week'))}
              {manyWeeks && cell(c.all[k], 'all', ' dash-week')}
            </tr>
          )))}</tbody>
        </table></div>
        <div className="wt-legend"><span className="ok">{tr('✓ Dentro del objetivo')}</span><span className="bad">{tr('✗ Bajo el objetivo')}</span><span className="warn">{tr('✗ Sobre el objetivo')}</span></div>
        <p className="hint">{tr('Cada número es el promedio de todos los pesos de ese día en toda la planta, en onzas, contra el rango de QA; debajo, de cuántas pruebas sale y cuántos pesos tienen. Vacío = no se pesó. Semana = todos los pesos de esa semana juntos (lunes a domingo, los días del rango); Rango = todos los días juntos.')}</p>
        {!weighed && <p className="hint amber">{tr('No hay pesos en estos días.')}</p>}
      </article>
      {data.map((c) => (
        <article key={c.code} className="wt-rp">
          <h3>{tr('Gráfica de {0}', c.code)}</h3>
          <DashChart c={c} />
        </article>
      ))}
    </div>
  )
}

const parseRange = (r: string): [number, number] | null => { const [a, b] = r.split('–').map(Number); return r && Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null }
/** round ticks that cover [lo, hi]: 3 to 5 of them */
function ticks(lo: number, hi: number) {
  const span = hi - lo || 1, raw = span / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= raw) ?? p * 10
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000)
  return out
}
/**
 * the three lines Mike asked for, one figure with two panels on the same days: raw and cooked balls above (ounces of
 * a ball), the pouch below (ounces of a bag; the two cannot share an axis). QA's range of each as a soft band in its
 * colour, a dot per day, the last value written beside its line, and a tap or hover on a day says its three numbers
 */
function DashChart({ c }: { c: DashCode }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setWidth(Math.max(300, Math.floor(el.clientWidth)))
    fit()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])
  const [on, setOn] = useState<number | null>(null)
  const n = c.days.length, L = 46, R = 16, T = 30, PH = 150, GAP = 34, XL = 26
  const H = T + PH + GAP + PH + XL
  const x = (i: number) => (n === 1 ? L + (width - L - R) / 2 : L + ((width - L - R) * i) / (n - 1))
  const panels: { kinds: DashKind[]; top: number; title: string }[] = [{ kinds: ['raw', 'cooked'], top: T, title: tr('Crudo y cocinado (oz)') }, { kinds: ['pouch'], top: T + PH + GAP, title: tr('Pouch (oz)') }]
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((width - L - R) / 48))))
  const hex = (k: DashKind) => '#' + DASH_COLORS[k]
  return (
    <div ref={box} className="dash-chart">
      <div className="dash-legend">{DASH_KINDS.map((k) => <span key={k}><i style={{ background: hex(k) }} />{kindName(k)}</span>)}</div>
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={tr('Gráfica de {0}', c.code)} onMouseLeave={() => setOn(null)}>
        {panels.map((p) => {
          const vals = p.kinds.flatMap((k) => c.days.flatMap((d) => (d[k].avg == null ? [] : [d[k].avg]))), bands = p.kinds.flatMap((k) => { const r = parseRange(c.target[k]); return r ? [{ k, r }] : [] })
          const all = [...vals, ...bands.flatMap((b) => b.r)]
          if (!all.length) return <g key={p.title}><text x={L} y={p.top + 14} className="dash-ptitle">{p.title}</text><text x={L + (width - L - R) / 2} y={p.top + PH / 2} textAnchor="middle" className="dash-empty">{tr('Sin pesos')}</text></g>
          let lo = Math.min(...all), hi = Math.max(...all)
          const pad = Math.max((hi - lo) * 0.25, hi * 0.02 || 0.1); lo -= pad; hi += pad
          const y = (v: number) => p.top + PH - ((v - lo) / (hi - lo)) * (PH - 18)
          return (
            <g key={p.title}>
              <text x={L} y={p.top + 12} className="dash-ptitle">{p.title}</text>
              {ticks(lo, hi).map((t) => <g key={t}><line x1={L} x2={width - R} y1={y(t)} y2={y(t)} className="dash-grid" /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="dash-tick">{t.toFixed(t % 1 ? 2 : 0)}</text></g>)}
              {bands.map((b) => <g key={b.k}><rect x={L} width={width - L - R} y={y(b.r[1])} height={Math.max(2, y(b.r[0]) - y(b.r[1]))} fill={hex(b.k)} opacity={0.13} /><text x={L + 4} y={y(b.r[1]) - 3} className="dash-band">{tr('QA {0}', wtRangeLong(c.target[b.k]))}</text></g>)}
              {p.kinds.map((k) => {
                const pts = c.days.map((d, i) => ({ i, v: d[k].avg, ok: d[k].ok }))
                let d = '', prev = false
                for (const q of pts) { if (q.v == null) { prev = false; continue } d += (prev ? ' L' : ' M') + x(q.i).toFixed(1) + ' ' + y(q.v).toFixed(1); prev = true }
                const last = [...pts].reverse().find((q) => q.v != null)
                return (
                  <g key={k}>
                    <path d={d.trim()} fill="none" stroke={hex(k)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    {pts.map((q) => (q.v == null ? null : <circle key={q.i} cx={x(q.i)} cy={y(q.v)} r={on === q.i ? 6 : 4.5} fill={hex(k)} stroke="#fff" strokeWidth={2} />))}
                    {last && last.v != null && <text x={x(last.i) + (last.i === n - 1 ? -8 : 8)} y={y(last.v) - 9} textAnchor={last.i === n - 1 ? 'end' : 'start'} className="dash-last">{kindName(k)} {last.v.toFixed(2)}</text>}
                  </g>
                )
              })}
            </g>
          )
        })}
        {c.days.map((d, i) => (i % every === 0 || i === n - 1) && <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" className="dash-tick">{md(d.date)}</text>)}
        {on != null && <line x1={x(on)} x2={x(on)} y1={T} y2={H - XL} className="dash-cross" />}
        {c.days.map((d, i) => { const w = n === 1 ? width - L - R : (width - L - R) / (n - 1); return <rect key={d.date} x={x(i) - w / 2} width={w} y={0} height={H} fill="transparent" onMouseEnter={() => setOn(i)} onClick={() => setOn(on === i ? null : i)} /> })}
        {on != null && (() => {
          const d = c.days[on], left = x(on) > width / 2, bx = left ? x(on) - 10 - 190 : x(on) + 10
          return (
            <g className="dash-tip" transform={`translate(${bx} ${T + 18})`}>
              <rect width={190} height={78} rx={8} />
              <text x={10} y={18} className="dash-tipdate">{md(d.date)} {wd(d.date)}{d.times ? ' · ' + tr('{0} horas', d.times) : ''}</text>
              {DASH_KINDS.map((k, j) => <text key={k} x={10} y={38 + j * 17}><tspan fill={hex(k)}>●</tspan> {kindName(k)}: {d[k].avg == null ? '—' : d[k].avg.toFixed(2)}{d[k].tests ? <tspan className="dash-tipn"> · {d[k].tests}/{d[k].n}</tspan> : null}</text>)}
            </g>
          )
        })()}
      </svg>
    </div>
  )
}
