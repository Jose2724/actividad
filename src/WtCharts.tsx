import { normCode, weightTarget, wtOfficial, wtRange, WT_ASKED_CODES, type State, type WeightTest } from './store'
import type { WtRow } from './kpi'
import { fmtTime } from './clock-fmt'
import { tr } from './i18n'

/**
 * The weights in pictures (Jose, 2026-11-05: "las gráficas ... nítidas y bien puestas, que se entienda qué se está
 * viendo sin tener que estar leyendo"): for 0889 and 2234, one small chart for each thing weighed (raw, cooked, pouch)
 * with QA's range as a green band. Over several days each point is a day's average; over one day each point is a test.
 * A point under the range is red, over it amber, inside it the app's colour. Only what QA gave a range for is drawn.
 */
export type WtDay = { date: string; rows: WtRow[] }
const KINDS: { kind: WeightTest['kind']; icon: string; name: () => string }[] = [
  { kind: 'raw', icon: '🥩', name: () => tr('Crudo') },
  { kind: 'ball', icon: '🔥', name: () => tr('Cocinado') },
  { kind: 'pouch', icon: '🛒', name: () => tr('Pouch') },
]
const avgOf = (ws: number[]) => (ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : null)
const weightsIn = (rows: WtRow[], code: string, kind: WeightTest['kind']) => rows.filter((r) => r.kind === kind && normCode(r.code) === normCode(code))

function Chart({ points, min, max, label }: { points: { x: string; y: number }[]; min: number; max: number; label: string }) {
  const W = 320, H = 150, L = 40, R = 10, T = 12, B = 26
  const ys = points.map((p) => p.y), lo = Math.min(min, ...ys), hi = Math.max(max, ...ys), pad = (hi - lo) * 0.25 || max * 0.02 || 1
  const y0 = lo - pad, y1 = hi + pad, Y = (v: number) => T + ((y1 - v) / (y1 - y0)) * (H - T - B)
  const n = points.length, X = (i: number) => (n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1))
  const dec = max < 10 ? 2 : 1, f = (v: number) => v.toFixed(dec)
  const every = Math.max(1, Math.ceil(n / 7))
  return (
    <svg className="rd-wtchart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <rect className="band" x={L} y={Y(max)} width={W - L - R} height={Math.max(1, Y(min) - Y(max))} rx="3" />
      <line className="edge" x1={L} x2={W - R} y1={Y(max)} y2={Y(max)} /><line className="edge" x1={L} x2={W - R} y1={Y(min)} y2={Y(min)} />
      <text className="lab" x={L - 5} y={Y(max) + 4} textAnchor="end">{f(max)}</text>
      <text className="lab" x={L - 5} y={Y(min) + 4} textAnchor="end">{f(min)}</text>
      {n > 1 && <polyline className="line" points={points.map((p, i) => X(i) + ',' + Y(p.y)).join(' ')} />}
      {points.map((p, i) => {
        const c = p.y < min ? 'bad' : p.y > max ? 'warn' : 'ok'
        return (
          <g key={i}>
            <circle className={'dot ' + c} cx={X(i)} cy={Y(p.y)} r={i === n - 1 ? 5 : 4} />
            {(c !== 'ok' || i === n - 1) && <text className={'val ' + c} x={X(i)} y={c === 'bad' ? Y(p.y) + 15 : Y(p.y) - 8} textAnchor="middle">{f(p.y)}</text>}
            {i % every === 0 || i === n - 1 ? <text className="lab" x={X(i)} y={H - 8} textAnchor="middle">{p.x}</text> : null}
          </g>
        )
      })}
    </svg>
  )
}

export function WtCharts({ s, days }: { s: State; days: WtDay[] }) {
  const many = days.length > 1
  const dayLabel = (d: string) => { const t = new Date(d + 'T12:00:00'); return many && days.length > 7 ? String(t.getDate()) : t.toLocaleDateString(undefined, { weekday: 'short' }).replace('.', '') }
  const charts = WT_ASKED_CODES.flatMap((code) => KINDS.flatMap(({ kind, icon, name }) => {
    const t = wtOfficial(s, code, kind) ? weightTarget(s, code, kind) : null
    if (!t) return []
    const r = wtRange(t)
    const points = many
      ? days.flatMap((d) => { const a = avgOf(weightsIn(d.rows, code, kind).flatMap((w) => w.tests.flatMap((x) => x.entries.flatMap((e) => (e.w != null ? [e.w] : []))))); return a == null ? [] : [{ x: dayLabel(d.date), y: Math.round(a * 1000) / 1000 }] })
      : weightsIn(days[0]?.rows ?? [], code, kind).flatMap((w) => w.tests).sort((a, b) => a.at - b.at).flatMap((x) => { const a = avgOf(x.entries.flatMap((e) => (e.w != null ? [e.w] : []))); return a == null ? [] : [{ x: fmtTime(x.at).replace(/:00\b/, '').replace(/\s?[AP]M/i, (m) => m.trim().toLowerCase()[0]), y: Math.round(a * 1000) / 1000 }] })
    const all = points.map((p) => p.y), avg = avgOf(all), out = all.filter((v) => v < r.min || v > r.max).length
    return [{ key: code + kind, code, icon, name: name(), r, points, avg, out }]
  }))
  if (!charts.length) return null
  // (what was not weighed in the range is one line, not empty charts)
  const drawn = charts.filter((c) => c.points.length), none = charts.filter((c) => !c.points.length)
  return (
    <>
    {drawn.length > 0 && <div className="rd-wtcharts">
      {drawn.map((c) => (
        <article key={c.key} className={'rd-wtcard' + (!c.points.length ? ' empty' : c.out ? ' bad' : ' ok')}>
          <header>
            <b>{c.icon} {c.code} · {c.name}</b>
            <span className="rd-wtstate">{!c.points.length ? tr('Sin pesos') : c.out ? (c.out === 1 ? tr('1 fuera del rango') : tr('{0} fuera del rango', c.out)) : tr('✓ En rango')}</span>
          </header>
          <div className="rd-wtsub"><span>{tr('Rango QA')} <b>{c.r.min}–{c.r.max}</b> oz</span>{c.avg != null && <span>{tr('Promedio')} <b>{c.avg.toFixed(c.r.max < 10 ? 2 : 1)}</b></span>}<span>{many ? tr('por día') : tr('cada prueba')}</span></div>
          {c.points.length ? <Chart points={c.points} min={c.r.min} max={c.r.max} label={tr('{0} {1}: promedio contra el rango de QA', c.code, c.name)} /> : <p className="rd-wtnone">{tr('No se pesó en estas fechas.')}</p>}
        </article>
      ))}
    </div>}
    {none.length > 0 && <p className="rd-wtmissing">{tr('Sin pesos en estas fechas:')} {none.map((c) => <span key={c.key}>{c.icon} {c.code} {c.name}</span>)}</p>}
    </>
  )
}
