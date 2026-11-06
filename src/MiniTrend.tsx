import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dept } from './store'
import { slowUnitOf } from './store'
import { DEPT_LOOK, deptVars } from './look'
import { locale, tr } from './i18n'
import type { MiniWeek } from './miniKpi'

/**
 * Santiago's week as lines (Jose, 2026-11-06: "una gráfica dinámica de líneas que indique que arriba va mejorando y
 * bajando va empeorando, que tenga cada departamento como línea"): one line per room over the days of the Mini KPI's
 * week, in a percentage where higher is always better, so the rooms share one axis: what was made against its goal,
 * the time without stops, the people against those expected. The dashed line is what the plant asks; above it is good.
 * The numbers are the Mini KPI's own (miniWeek), nothing is counted again; a day without data leaves a gap.
 */
type Metric = 'goal' | 'work' | 'att'
type Day = NonNullable<MiniWeek['rooms'][number]['days'][number]>
type Pt = { v: number; detail: string } | null

const n0 = (x: number) => Math.round(x).toLocaleString('en-US')
const heads = (x: Day) => x.att.avg || x.att.actual
const mins = (ms: number) => Math.round(ms / 60_000)

function pointOf(m: Metric, x: Day | null, dept: Dept): Pt {
  if (!x) return null
  if (m === 'goal') return x.target ? { v: (x.real / x.target) * 100, detail: tr('{0} de {1} {2}', n0(x.real), n0(x.target), slowUnitOf(dept)) } : null
  if (m === 'work') return x.time ? { v: 100 - (x.down / x.time) * 100, detail: tr('{0} min parado', mins(x.down)) } : null
  return x.att.expected ? { v: (heads(x) / x.att.expected) * 100, detail: tr('{0} de {1} personas', Math.round(heads(x) * 10) / 10, x.att.expected) } : null
}
function weekOf(m: Metric, days: (Day | null)[]): number | null {
  const list = days.filter((x): x is Day => !!x)
  const sum = (f: (x: Day) => number, l = list) => l.reduce((t, x) => t + f(x), 0)
  if (m === 'goal') { const l = list.filter((x) => x.target); return l.length ? (sum((x) => x.real, l) / sum((x) => x.target ?? 0, l)) * 100 : null }
  if (m === 'work') { const t = sum((x) => x.time); return t ? 100 - (sum((x) => x.down) / t) * 100 : null }
  const e = sum((x) => x.att.expected); return e ? (sum(heads) / e) * 100 : null
}

/** each room keeps its colour, and its own mark too, so a line is told apart without the colour alone */
const SHAPES = ['circle', 'square', 'diamond', 'triangle', 'ring'] as const
function Mark({ shape, x, y, r = 4.5 }: { shape: (typeof SHAPES)[number]; x: number; y: number; r?: number }) {
  if (shape === 'square') return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} rx={1.5} />
  if (shape === 'diamond') return <path d={`M${x} ${y - r * 1.3}L${x + r * 1.3} ${y}L${x} ${y + r * 1.3}L${x - r * 1.3} ${y}Z`} />
  if (shape === 'triangle') return <path d={`M${x} ${y - r * 1.3}L${x + r * 1.2} ${y + r}L${x - r * 1.2} ${y + r}Z`} />
  if (shape === 'ring') return <circle cx={x} cy={y} r={r} className="ring" />
  return <circle cx={x} cy={y} r={r} />
}

export function MiniTrend({ week }: { week: MiniWeek }) {
  const [metric, setMetric] = useState<Metric>('goal')
  const [off, setOff] = useState<Dept[]>([])
  const [hot, setHot] = useState<Dept | null>(null)
  const [at, setAt] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(900)
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const ref = metric === 'work' ? 100 - week.o.limit : 100
  const rooms = useMemo(() => week.rooms.map((r, i) => ({ dept: r.dept, shape: SHAPES[i % SHAPES.length], pts: r.days.map((x) => pointOf(metric, x, r.dept)), wk: weekOf(metric, r.days) })), [week, metric])
  const shown = rooms.filter((r) => !off.includes(r.dept))
  const vals = shown.flatMap((r) => r.pts.flatMap((p) => (p ? [p.v] : [])))
  const any = rooms.some((r) => r.pts.some(Boolean))
  // the scale: from 0 to a little over the highest day (and never under the goal line), at most 200 %
  // (it starts near the lowest day, not at 0, so a rise or a fall of a few points shows)
  const top = Math.min(200, Math.max(110, Math.ceil((Math.max(ref, ...vals) + 5) / 10) * 10))
  const bottom = Math.max(0, Math.floor((Math.min(ref, ...vals) - 10) / 10) * 10)
  const step = top - bottom <= 50 ? 10 : top - bottom <= 120 ? 25 : 50
  const ticks = Array.from({ length: Math.floor((top - bottom) / step) + 1 }, (_, i) => bottom + i * step)
  const phone = w < 560
  const H = phone ? 240 : 290, L = 44, R = phone ? 54 : 78, T = 14, B = 30
  const pw = w - L - R, ph = H - T - B
  const n = week.days.length
  const X = (i: number) => L + (n === 1 ? pw / 2 : (pw * i) / (n - 1))
  const Y = (v: number) => T + ph - ((Math.min(Math.max(v, bottom), top) - bottom) / (top - bottom)) * ph
  const paths = shown.map((r) => {
    let d = '', open = false
    r.pts.forEach((p, i) => { if (p) { d += (open ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.v).toFixed(1); open = true } else open = false })
    return { ...r, d }
  })
  // the names at the end of each line, pushed apart so they never sit on each other
  const ends = paths.map((r) => { const i = r.pts.map((p, j) => (p ? j : -1)).filter((j) => j >= 0).pop(); return i == null ? null : { dept: r.dept, x: X(i), y: Y((r.pts[i] as { v: number }).v), v: (r.pts[i] as { v: number }).v } }).filter((e): e is NonNullable<typeof e> => !!e).sort((a, b) => a.y - b.y)
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15
  const dayName = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short', day: 'numeric' })
  const pct = (v: number) => Math.round(v) + '%'
  const metrics: [Metric, string][] = [['goal', '🎯 ' + tr('Meta')], ['work', '⏱️ ' + tr('Sin paros')], ['att', '👥 ' + tr('Asistencia')]]
  const tip = at == null ? [] : shown.flatMap((r) => (r.pts[at] ? [{ dept: r.dept, shape: r.shape, p: r.pts[at] as { v: number; detail: string } }] : [])).sort((a, b) => b.p.v - a.p.v)
  const tipLeft = at == null ? 0 : Math.min(Math.max(X(at) - 110, 4), w - 224)
  return (
    <article className="rd-card rd-trend">
      <header className="rd-trend-h">
        <h3>📈 {tr('Cómo va cada cuarto')}</h3>
        <div className="seg rd-rangeseg" role="group" aria-label={tr('Qué se mide')}>
          {metrics.map(([k, label]) => <button key={k} type="button" className={metric === k ? 'on' : ''} aria-pressed={metric === k} onClick={() => { setMetric(k); setAt(null) }}>{label}</button>)}
        </div>
      </header>
      <div className="rd-trend-legend">
        {rooms.map((r) => {
          const hidden = off.includes(r.dept)
          return (
            <button key={r.dept} type="button" style={deptVars(r.dept)} className={'rd-trend-chip' + (hidden ? ' off' : '')} aria-pressed={!hidden} title={hidden ? tr('Mostrar') : tr('Ocultar')}
              onClick={() => setOff(hidden ? off.filter((d) => d !== r.dept) : [...off, r.dept])} onMouseEnter={() => setHot(r.dept)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(r.dept)} onBlur={() => setHot(null)}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="rd-trend-key"><Mark shape={r.shape} x={7} y={7} r={4.2} /></svg>
              <span>{DEPT_LOOK[r.dept].emoji} {r.dept}</span>
              <b className={r.wk == null ? '' : r.wk >= ref ? 'up' : 'down'}>{r.wk == null ? '—' : (r.wk >= ref ? '▲ ' : '▼ ') + pct(r.wk)}</b>
            </button>
          )
        })}
      </div>
      <div className="rd-trend-plot" ref={box} onMouseLeave={() => setAt(null)}>
        {!any ? <p className="hint st">{tr('Nada que dibujar esta semana con esto todavía.')}</p> : (
          <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={tr('Cómo va cada cuarto') + ' · ' + metrics.find((m) => m[0] === metric)?.[1]}>
            {/* above the plant's line is the good side */}
            <rect x={L} y={T} width={pw} height={Math.max(0, Y(ref) - T)} className="rd-trend-good" />
            {ticks.map((v) => (
              <g key={v} className="rd-trend-grid"><line x1={L} x2={L + pw} y1={Y(v)} y2={Y(v)} /><text x={L - 8} y={Y(v) + 4} textAnchor="end">{v}%</text></g>
            ))}
            <line x1={L} x2={L + pw} y1={Y(ref)} y2={Y(ref)} className="rd-trend-ref" />
            <text x={L + 8} y={T + 14} className="rd-trend-side up">▲ {tr('Mejor')}</text>
            <text x={L + 8} y={T + ph - 8} className="rd-trend-side">▼ {tr('Peor')}</text>
            {/* (on a phone the line's name would sit on the rooms' names at the end: the dashed line and ▲ Mejor say it) */}
            {!phone && <text x={L + pw - 6} y={Y(ref) - 6} textAnchor="end" className="rd-trend-reflab">{metric === 'att' ? tr('Todos 100%') : tr('Meta {0}%', ref)}</text>}
            {week.days.map((d, i) => <text key={d} x={X(i)} y={H - 8} textAnchor="middle" className={'rd-trend-day' + (at === i ? ' on' : '')}>{dayName(d)}</text>)}
            {at != null && <line x1={X(at)} x2={X(at)} y1={T} y2={T + ph} className="rd-trend-cross" />}
            {paths.map((r) => {
              const dim = hot && hot !== r.dept
              return (
                <g key={r.dept + metric + week.days[0]} style={deptVars(r.dept)} className={'rd-trend-line' + (dim ? ' dim' : '') + (hot === r.dept ? ' hot' : '')}>
                  {r.d && <path d={r.d} pathLength={1} />}
                  {r.pts.map((p, i) => (p ? <Mark key={i} shape={r.shape} x={X(i)} y={Y(p.v)} r={at === i ? 6 : 4.5} /> : null))}
                </g>
              )
            })}
            {ends.map((e) => <text key={e.dept} x={e.x + 10} y={e.y + 4} className={'rd-trend-end' + (hot && hot !== e.dept ? ' dim' : '')}>{DEPT_LOOK[e.dept].emoji} {pct(e.v)}</text>)}
            {week.days.map((d, i) => <rect key={d} x={X(i) - pw / Math.max(1, n - 1) / 2} y={T} width={pw / Math.max(1, n - 1)} height={ph + B} className="rd-trend-hit" onMouseEnter={() => setAt(i)} onClick={() => setAt(at === i ? null : i)} />)}
          </svg>
        )}
        {at != null && (
          <div className="rd-trend-tip" style={{ left: tipLeft }} role="status">
            <b>{dayName(week.days[at])}</b>
            {tip.length ? tip.map((t) => (
              <div key={t.dept} className="row" style={deptVars(t.dept)}>
                <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true" className="rd-trend-key"><Mark shape={t.shape} x={7} y={7} r={4.2} /></svg>
                <span>{t.dept}</span><b>{pct(t.p.v)}</b><small>{t.p.detail}</small>
              </div>
            )) : <small>{tr('Sin datos este día')}</small>}
          </div>
        )}
      </div>
    </article>
  )
}
