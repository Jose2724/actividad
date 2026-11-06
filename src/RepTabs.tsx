import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ASK_MANAGER, DEPTS, SETUP, attCounts, attLineText, attOf, attShifts, attendanceOf, awayDay, awayOn, dayBefore, fmtTime, lineNameOf, plainDay, shiftWindow, stopSpans, type AttEntry, type Dept, type State } from './store'
import { reportOf, type Report } from './report'
import { downKind } from './miniKpi'
import { plusDays } from './pplh'
import { loadDay } from './sync'
import { DEPT_LOOK, deptVars } from './look'
import { locale, tr } from './i18n'

/**
 * Reportes, the parts the plant's heads asked to see apart (Jose, 2026-11-06: "que ponga aparte parado por causa,
 * asistencia, que muestre los traslados el tiempo que duró ... donde vas a poner los tiempos parados poner los tiempos
 * trabajados y cómo funciona todo eso ... los jefes jefes ... quieren entender perfectamente todo esto ... y ponerle
 * hasta gráfica"). Three tabs on one day, one shift and one room chosen once for the three:
 * - Tiempo: each line's time as a picture (working, stopped, set up, lunch and break) and how it is counted;
 * - Paros: the time stopped cause by cause, room by room, and every stop;
 * - Asistencia: who came against who was expected, the people sent to another room or line and how long it lasted.
 * The numbers are the report's own (reportOf, attendanceOf): the same as the day's report and its files.
 */

// ---- the day, shift and room in view: one choice for the three tabs (kept while the app is open) ----
type Pick = { date: string; shift: 0 | 1 | 2; room: Dept | '' }
let keptPick: Pick | null = null
function usePick(today: string, only?: Dept) {
  const [p, setP] = useState<Pick>(() => (keptPick && keptPick.date <= today ? keptPick : { date: today, shift: 0, room: '' }))
  useEffect(() => { keptPick = p }, [p])
  // a day older than the device keeps comes from the server
  useEffect(() => { if (awayDay(p.date)) void loadDay(p.date) }, [p.date])
  return { date: p.date, shift: p.shift, room: (only ?? p.room) as Dept | '', set: (x: Partial<Pick>) => setP((o) => ({ ...o, ...x })) }
}
type PickKit = ReturnType<typeof usePick>

const hm = (ms: number) => { const m = Math.round(Math.max(0, ms) / 60_000), h = Math.floor(m / 60); return h ? h + ' h ' + String(m % 60).padStart(2, '0') : m + ' min' }
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
const dayText = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })

function PickBar({ icon, title, k, today, only, children }: { icon: string; title: string; k: PickKit; today: string; only?: Dept; children?: ReactNode }) {
  const pickRef = useRef<HTMLInputElement>(null)
  return (
    <div className="rd-wtbar rd-rpbar">
      <h2 className="rd-wttitle">{icon} {title}</h2>
      <div className="rd-daynav">
        <button type="button" className="btn sm" aria-label={tr('Día anterior')} title={tr('Día anterior')} onClick={() => k.set({ date: dayBefore(k.date) })}>‹</button>
        <button type="button" className="btn sm rd-datesbtn" onClick={() => { const i = pickRef.current; if (i) { try { i.showPicker() } catch { i.focus() } } }}>📅 {dayText(k.date)}</button>
        <input ref={pickRef} className="rd-daypick" type="date" value={k.date} max={today} tabIndex={-1} aria-label={tr('Escoger día')} onChange={(e) => e.target.value && k.set({ date: e.target.value })} />
        <button type="button" className="btn sm" aria-label={tr('Día siguiente')} title={tr('Día siguiente')} disabled={k.date >= today} onClick={() => k.set({ date: plusDays(k.date, 1) })}>›</button>
        {k.date !== today && <button type="button" className="btn sm soft" onClick={() => k.set({ date: today })}>{tr('Hoy')}</button>}
      </div>
      <div className="seg rd-rangeseg" role="group" aria-label={tr('Turno')}>
        {([0, 1, 2] as const).map((x) => <button key={x} type="button" className={k.shift === x ? 'on' : ''} aria-pressed={k.shift === x} onClick={() => k.set({ shift: x })}>{x ? tr('Turno {0}', x) : tr('Día completo')}</button>)}
      </div>
      {!only && (
        <div className="seg rd-rangeseg rd-roomseg" role="group" aria-label={tr('Departamento')}>
          <button type="button" className={!k.room ? 'on' : ''} aria-pressed={!k.room} onClick={() => k.set({ room: '' })}>{tr('Todos')}</button>
          {DEPTS.map((d) => <button key={d} type="button" className={k.room === d ? 'on' : ''} aria-pressed={k.room === d} onClick={() => k.set({ room: d })}><span aria-hidden="true">{DEPT_LOOK[d].emoji}</span> {d}</button>)}
        </div>
      )}
      {children && <div className="rd-wtacts">{children}</div>}
    </div>
  )
}

// ---- time: what a report's lines did with their time ----
type Kind = 'work' | 'stop' | 'setup' | 'lunch'
const KINDS: { k: Kind; icon: string; name: () => string; what: () => string }[] = [
  { k: 'work', icon: '✅', name: () => tr('Trabajando'), what: () => tr('La línea tiene un código y nadie la paró.') },
  { k: 'stop', icon: '⏸️', name: () => tr('Parado'), what: () => tr('Un paro con su razón mientras corre un código.') },
  { k: 'setup', icon: '🔧', name: () => tr('Set up'), what: () => tr('Preparando la línea para el siguiente código.') },
  { k: 'lunch', icon: '🍽️', name: () => tr('Lunch y break'), what: () => tr('Se cuenta aparte: no es un paro.') },
]
const kindOfReason = (why: string): Kind => (why === SETUP ? 'setup' : downKind(why) === 'lunch' ? 'lunch' : 'stop')
function timeOf(rep: Report) {
  const lunch = rep.reasons.filter((x) => kindOfReason(x.reason) === 'lunch').reduce((t, x) => t + x.ms, 0)
  const t = { work: rep.working, stop: Math.max(0, rep.down - lunch), setup: rep.setup, lunch }
  return { ...t, all: t.work + t.stop + t.setup + t.lunch }
}

type Span = { from: number; to: number }
const minus = (a: Span[], b: Span[]) => a.flatMap((p) => {
  let parts = [p]
  for (const q of b) parts = parts.flatMap((x) => (q.to <= x.from || q.from >= x.to ? [x] : [...(q.from > x.from ? [{ from: x.from, to: q.from }] : []), ...(q.to < x.to ? [{ from: q.to, to: x.to }] : [])]))
  return parts
}).filter((x) => x.to > x.from)
const meet = (a: Span[], b: Span[]) => a.flatMap((x) => b.map((y) => ({ from: Math.max(x.from, y.from), to: Math.min(x.to, y.to) }))).filter((x) => x.to > x.from)
type Seg = Span & { kind: Kind; why: string }
/** a line's stretch of time as pieces: its codes working, its stops (the first one begun wins a minute two cover), its set ups */
function lineSegs(s: State, date: string, dept: Dept, lineId: string, A: number, B: number, now: number): Seg[] {
  const end = Math.min(B, now), clip = (x: Span) => ({ from: Math.max(x.from, A), to: Math.min(x.to, end) })
  const base = s.runs.filter((r) => !r.deleted && r.date === date && r.lineId === lineId)
    .flatMap((r) => { const p = clip({ from: r.startedAt, to: r.endedAt ?? now }); return p.to > p.from ? minus([p], awayOn(s, lineId, date, p.from, p.to, now)) : [] })
  const stops = s.stops.filter((x) => !x.deleted && x.dept === dept && (x.lineId === lineId || x.lineId === null) && plainDay(s, x.startedAt) === date).sort((a, b) => a.startedAt - b.startedAt)
  const segs: Seg[] = [], covered: Span[] = []
  for (const x of stops) {
    const kind = kindOfReason(x.reason)
    let pieces = stopSpans(s, x, now).map(clip).filter((p) => p.to > p.from)
    if (kind !== 'setup') pieces = meet(pieces, base) // (a stop counts while a code runs; a set up is between codes)
    pieces = minus(pieces, covered)
    covered.push(...pieces)
    segs.push(...pieces.map((p) => ({ ...p, kind, why: x.reason })))
  }
  segs.push(...minus(base, covered).map((p) => ({ ...p, kind: 'work' as const, why: '' })))
  return segs.sort((a, b) => a.from - b.from)
}

function SplitBar({ t }: { t: ReturnType<typeof timeOf> }) {
  return <div className="rd-tbar" role="img" aria-label={KINDS.map((x) => x.name() + ' ' + pct(t[x.k], t.all) + '%').join(', ')}>{KINDS.map((x) => t[x.k] > 0 && <i key={x.k} className={'k-' + x.k} style={{ width: (t[x.k] / t.all) * 100 + '%' }} title={x.name() + ' · ' + hm(t[x.k])} />)}</div>
}

function HowCounted() {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('act_rp_how') !== '0' } catch { return true } })
  const flip = () => { setOpen(!open); try { localStorage.setItem('act_rp_how', open ? '0' : '1') } catch { /* nothing */ } }
  // a made-up line, 6:00 to 3:00: 20 min of set up, a stop, lunch, a break
  const sample: [Kind, number][] = [['setup', 20], ['work', 170], ['stop', 35], ['work', 95], ['lunch', 30], ['work', 120], ['lunch', 15], ['work', 55]]
  const all = sample.reduce((t, x) => t + x[1], 0)
  return (
    <article className="rd-card rd-how">
      <h3>💡 {tr('¿Cómo se cuenta el tiempo?')}<button type="button" className="btn sm soft rd-howbtn" aria-expanded={open} onClick={flip}>{open ? tr('Ocultar') : tr('Ver')}</button></h3>
      {open && (
        <>
          <div className="rd-howline">
            <span className="rd-howlab">{tr('Una línea de 6:00 AM a 3:00 PM')}</span>
            <div className="rd-tbar big">{sample.map(([k, m], i) => <i key={i} className={'k-' + k} style={{ width: (m / all) * 100 + '%' }} />)}</div>
            <div className="rd-howticks"><span>6:00</span><span>9:00</span><span>12:00</span><span>3:00</span></div>
          </div>
          <div className="rd-howkinds">{KINDS.map((x) => <div key={x.k} className="rd-howkind"><i className={'k-' + x.k} /><b>{x.icon} {x.name()}</b><span>{x.what()}</span></div>)}</div>
          <div className="rd-hownotes">
            <span>➕ {tr('Se suman todas las líneas: 2 líneas de 8 h = 16 h de línea.')}</span>
            <span>⏹️ {tr('Una línea sin código no cuenta: no estaba produciendo.')}</span>
            <span>🧮 {tr('Cada % es sobre el tiempo de línea.')}</span>
          </div>
        </>
      )}
    </article>
  )
}

function Timeline({ s, date, dept, shift, now }: { s: State; date: string; dept: Dept; shift: 0 | 1 | 2; now: number }) {
  const [tip, setTip] = useState('')
  const lines = useMemo(() => reportOf(s, date, now, { only: dept }).lineChoices, [s, date, dept, now])
  const wins = (shift ? [shift] : attShifts(s, date)).map((k) => shiftWindow(s, date, dept, k))
  const A = Math.min(...wins.map((w) => w.from)), B = Math.max(...wins.map((w) => w.to)), span = B - A
  const X = (t: number) => ((Math.min(Math.max(t, A), B) - A) / span) * 100
  const step = span > 12 * 3_600_000 ? 3 : span > 6 * 3_600_000 ? 2 : 1
  const ticks: number[] = []
  const first = new Date(A); first.setMinutes(0, 0, 0)
  for (let t = first.getTime() + (first.getTime() < A ? 3_600_000 : 0); t <= B; t += 3_600_000) if (new Date(t).getHours() % step === 0) ticks.push(t)
  const gaps = wins.length > 1 ? [{ from: wins[0].to, to: wins[1].from }].filter((g) => g.to > g.from) : []
  if (!lines.length) return null
  const hour = (t: number) => fmtTime(t).replace(':00', '').replace(/\s?([AP])M/i, (_, x: string) => x.toLowerCase())
  return (
    <div className="rd-tlroom" style={deptVars(dept)}>
      <div className="rd-tlhead"><b>{DEPT_LOOK[dept].emoji} {dept}</b></div>
      <div className="rd-tl">
        <div className="rd-tlrow axis"><span className="rd-tlname" /><div className="rd-tltrack">{ticks.map((t) => <span key={t} className="rd-tltick" style={{ left: X(t) + '%' }}>{hour(t)}</span>)}</div></div>
        {lines.map((l) => {
          const segs = lineSegs(s, date, dept, l.id, A, B, now)
          return (
            <div key={l.id} className="rd-tlrow">
              <span className="rd-tlname">{l.name}</span>
              <div className="rd-tltrack">
                {ticks.map((t) => <span key={t} className="rd-tlgrid" style={{ left: X(t) + '%' }} />)}
                {gaps.map((g, i) => <span key={i} className="rd-tlgap" style={{ left: X(g.from) + '%', width: X(g.to) - X(g.from) + '%' }} title={tr('Entre turnos')} />)}
                {segs.map((g, i) => {
                  const k = KINDS.find((x) => x.k === g.kind)!
                  const text = k.icon + ' ' + l.name + ' · ' + (g.why ? tr(g.why) : k.name()) + ' · ' + fmtTime(g.from) + ' – ' + fmtTime(g.to) + ' · ' + hm(g.to - g.from)
                  return <button key={i} type="button" className={'rd-tlseg k-' + g.kind} style={{ left: X(g.from) + '%', width: Math.max(0.25, X(g.to) - X(g.from)) + '%' }} title={text} aria-label={text} onClick={() => setTip(text)} />
                })}
                {now > A && now < B && <span className="rd-tlnow" style={{ left: X(now) + '%' }} title={tr('Ahora')} />}
              </div>
            </div>
          )
        })}
      </div>
      {tip && <p className="rd-tltip">{tip}<button type="button" className="lnk sm" onClick={() => setTip('')}>✕</button></p>}
    </div>
  )
}

export function TimeTab({ s, now, today, only }: { s: State; now: number; today: string; only?: Dept }) {
  const k = usePick(today, only)
  const rooms = k.room ? [k.room] : DEPTS
  const per = useMemo(() => rooms.map((d) => ({ dept: d, rep: reportOf(s, k.date, now, { only: d, shift: k.shift }) })).map((x) => ({ ...x, t: timeOf(x.rep) })), [s, k.date, k.shift, now, rooms.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const t = per.reduce((a, x) => ({ work: a.work + x.t.work, stop: a.stop + x.t.stop, setup: a.setup + x.t.setup, lunch: a.lunch + x.t.lunch, all: a.all + x.t.all }), { work: 0, stop: 0, setup: 0, lunch: 0, all: 0 })
  const lines = per.reduce((n, x) => n + x.rep.lines, 0)
  const worked = per.filter((x) => x.t.all > 0)
  const [tlPick, setTlPick] = useState<Dept | ''>('')
  const tlRoom = worked.find((x) => x.dept === tlPick)?.dept ?? worked[0]?.dept
  return (
    <section className="rd-rp">
      <PickBar icon="⏱️" title={tr('Tiempo')} k={k} today={today} only={only} />
      <div className="rd-tiles rd-rptiles">
        <div className="rd-tile"><label>🕐 {tr('Tiempo de línea')}</label><b>{hm(t.all)}</b><small>{lines === 1 ? tr('1 línea') : tr('{0} líneas', lines)}</small></div>
        {KINDS.map((x) => <div key={x.k} className={'rd-tile rd-ktile k-' + x.k}><label>{x.icon} {x.name()}</label><b>{hm(t[x.k])}</b><small>{t.all ? pct(t[x.k], t.all) + '% ' + tr('del tiempo') : '—'}</small></div>)}
      </div>
      <HowCounted />
      {worked.length === 0 ? <p className="rd-calm">{tr('Ninguna línea trabajó en lo que estás viendo.')}</p> : (
        <>
          <article className="rd-card">
            <h3>🏭 {tr('Por cuarto')}</h3>
            <div className="rd-tsplits">
              {worked.map((x) => (
                <div key={x.dept} className="rd-tsplit" style={deptVars(x.dept)}>
                  <span className="rd-tsname">{DEPT_LOOK[x.dept].emoji} {x.dept}</span>
                  <SplitBar t={x.t} />
                  <span className="rd-tsnums"><b>{pct(x.t.work, x.t.all)}%</b> {tr('trabajando')} · {hm(x.t.all)}</span>
                </div>
              ))}
            </div>
            <div className="rd-legend">{KINDS.map((x) => <span key={x.k}><i className={'k-' + x.k} />{x.name()}</span>)}</div>
          </article>
          <article className="rd-card">
            <h3>📈 {tr('Línea por línea')}<small className="rd-cardsub">{tr('toca un color para ver qué fue')}</small>
              {worked.length > 1 && <span className="seg rd-rangeseg rd-segsm rd-roomseg" role="group" aria-label={tr('Departamento')}>{worked.map((x) => <button key={x.dept} type="button" className={tlRoom === x.dept ? 'on' : ''} aria-pressed={tlRoom === x.dept} onClick={() => setTlPick(x.dept)}><span aria-hidden="true">{DEPT_LOOK[x.dept].emoji}</span> {x.dept}</button>)}</span>}
            </h3>
            {tlRoom && <Timeline key={tlRoom} s={s} date={k.date} dept={tlRoom} shift={k.shift} now={now} />}
            <div className="rd-legend">{KINDS.map((x) => <span key={x.k}><i className={'k-' + x.k} />{x.name()}</span>)}</div>
          </article>
        </>
      )}
    </section>
  )
}

// ---- stops by cause ----
const CAUSE_ICON: Record<string, string> = { mech: '⚙️', people: '👥', clean: '🧽', lunch: '🍽️', other: '⏸️' }
const causeIcon = (why: string) => (why === SETUP ? '🔧' : CAUSE_ICON[downKind(why)] ?? '⏸️')
const noReason = (why: string) => !why || why === ASK_MANAGER

export function StopsTab({ s, now, today, only }: { s: State; now: number; today: string; only?: Dept }) {
  const k = usePick(today, only)
  const [all, setAll] = useState(false)
  const [more, setMore] = useState(false)
  const [allCauses, setAllCauses] = useState(false)
  const rooms = k.room ? [k.room] : DEPTS
  const per = useMemo(() => rooms.map((d) => ({ dept: d, rep: reportOf(s, k.date, now, { only: d, shift: k.shift }) })), [s, k.date, k.shift, now, rooms.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const causes = useMemo(() => {
    const m = new Map<string, { why: string; ms: number; n: number }>()
    const at = (why: string) => { let e = m.get(why); if (!e) m.set(why, (e = { why, ms: 0, n: 0 })); return e }
    for (const { rep } of per) {
      for (const r of rep.reasons) at(r.reason).ms += r.ms
      if (rep.setup) at(SETUP).ms += rep.setup
      for (const x of rep.stops) at(x.reason).n++
    }
    return [...m.values()].filter((x) => x.ms > 0 || x.n > 0).sort((a, b) => b.ms - a.ms || b.n - a.n)
  }, [per])
  const real = causes.filter((x) => kindOfReason(x.why) === 'stop')
  const shown = all ? causes : real
  const top = Math.max(1, ...shown.map((x) => x.ms))
  const stopMs = real.reduce((t, x) => t + x.ms, 0), stopN = real.reduce((t, x) => t + x.n, 0)
  const lunch = causes.filter((x) => kindOfReason(x.why) === 'lunch').reduce((t, x) => t + x.ms, 0), setup = causes.find((x) => x.why === SETUP)?.ms ?? 0
  const missing = per.reduce((t, x) => t + x.rep.stops.filter((y) => noReason(y.reason)).length, 0)
  const list = per.flatMap((x) => x.rep.stops).sort((a, b) => a.startedAt - b.startedAt)
  const LIST = 12, CAUSES = 8
  const roomTop = per.map((x) => {
    const mine = x.rep.reasons.filter((r) => kindOfReason(r.reason) === 'stop')
    return { dept: x.dept, ms: mine.reduce((t, r) => t + r.ms, 0), n: x.rep.stops.filter((y) => kindOfReason(y.reason) === 'stop').length, top: mine.slice(0, 3) }
  }).filter((x) => x.ms > 0 || x.n > 0)
  const roomMax = Math.max(1, ...roomTop.map((x) => x.ms))
  return (
    <section className="rd-rp">
      <PickBar icon="⏸️" title={tr('Paros por causa')} k={k} today={today} only={only} />
      <div className="rd-tiles rd-rptiles">
        <div className="rd-tile rd-ktile k-stop"><label>⏸️ {tr('Tiempo parado')}</label><b>{hm(stopMs)}</b><small>{tr('sin lunch ni set up')}</small></div>
        <div className="rd-tile"><label>🔢 {tr('Paros')}</label><b>{stopN}</b><small>{tr('veces que se paró')}</small></div>
        <div className="rd-tile"><label>🥇 {tr('Causa principal')}</label><b className="txt">{real[0] ? causeIcon(real[0].why) + ' ' + tr(real[0].why) : '—'}</b><small>{real[0] ? hm(real[0].ms) + ' · ' + pct(real[0].ms, stopMs) + '%' : ''}</small></div>
        <div className="rd-tile rd-ktile k-setup"><label>🔧 {tr('Set up')}</label><b>{hm(setup)}</b><small>{tr('entre códigos')}</small></div>
        <div className="rd-tile rd-ktile k-lunch"><label>🍽️ {tr('Lunch y break')}</label><b>{hm(lunch)}</b><small>{tr('aparte')}</small></div>
        <div className={'rd-tile' + (missing ? ' warn' : ' ok')}><label>❓ {tr('Sin razón')}</label><b>{missing}</b><small>{missing ? tr('falta escribir por qué') : tr('todos con razón')}</small></div>
      </div>
      {!causes.length ? <p className="rd-calm">✓ {tr('Ningún paro en lo que estás viendo.')}</p> : (
        <>
          <article className="rd-card">
            <h3>📊 {tr('Tiempo por causa')}
              <span className="seg rd-rangeseg rd-segsm" role="group"><button type="button" className={!all ? 'on' : ''} aria-pressed={!all} onClick={() => setAll(false)}>{tr('Solo paros')}</button><button type="button" className={all ? 'on' : ''} aria-pressed={all} onClick={() => setAll(true)}>{tr('Con lunch y set up')}</button></span>
            </h3>
            <div className="rd-causes">
              {(allCauses ? shown : shown.slice(0, CAUSES)).map((x) => (
                <div key={x.why} className="rd-cause">
                  <span className="rd-causename">{causeIcon(x.why)} {noReason(x.why) ? tr('Sin razón') : tr(x.why)}</span>
                  <span className="rd-causebar"><i className={'k-' + kindOfReason(x.why)} style={{ width: (x.ms / top) * 100 + '%' }} /></span>
                  <span className="rd-causenums"><b>{hm(x.ms)}</b><small>{x.n === 1 ? tr('1 vez') : tr('{0} veces', x.n)}{kindOfReason(x.why) === 'stop' && stopMs ? ' · ' + pct(x.ms, stopMs) + '%' : ''}</small></span>
                </div>
              ))}
            </div>
            {shown.length > CAUSES && <button type="button" className="btn soft sm rd-morebtn" onClick={() => setAllCauses(!allCauses)}>{allCauses ? tr('Ver menos') : tr('Ver las {0} causas', shown.length)}</button>}
          </article>
          {roomTop.length > 1 && (
            <article className="rd-card">
              <h3>🏭 {tr('Por cuarto')}</h3>
              <div className="rd-stoprooms">
                {roomTop.map((x) => (
                  <div key={x.dept} className="rd-stoproom" style={deptVars(x.dept)}>
                    <div className="rd-stoproomhead"><b>{DEPT_LOOK[x.dept].emoji} {x.dept}</b><span><b>{hm(x.ms)}</b> · {x.n === 1 ? tr('1 paro') : tr('{0} paros', x.n)}</span></div>
                    <span className="rd-causebar"><i className="k-stop" style={{ width: (x.ms / roomMax) * 100 + '%' }} /></span>
                    <div className="rd-stopchips">{x.top.map((r) => <span key={r.reason}>{causeIcon(r.reason)} {tr(r.reason)} · <b>{hm(r.ms)}</b></span>)}</div>
                  </div>
                ))}
              </div>
            </article>
          )}
          <article className="rd-card">
            <h3>📋 {tr('Cada paro')}<small className="rd-cardsub">{list.length === 1 ? tr('1 paro') : tr('{0} paros', list.length)}</small></h3>
            <div className="scroll"><table className="rd-tbl">
              <thead><tr><th>{tr('Hora')}</th>{!k.room && <th>{tr('Cuarto')}</th>}<th>{tr('Línea')}</th><th>{tr('Causa')}</th><th className="n">{tr('Duró')}</th><th>{tr('Nota')}</th><th>{tr('Quién')}</th></tr></thead>
              <tbody>{(more ? list : list.slice(0, LIST)).map((x) => (
                <tr key={x.id}>
                  <td className="nw">{fmtTime(x.startedAt)} – {x.endedAt ? fmtTime(x.endedAt) : tr('sigue')}</td>
                  {!k.room && <td className="nw">{DEPT_LOOK[x.dept].emoji} {x.dept}</td>}
                  <td>{x.lineId ? lineNameOf(s, x.lineId) : tr('Todo el cuarto')}</td>
                  <td><span className={'rd-causechip k-' + kindOfReason(x.reason)}>{causeIcon(x.reason)} {noReason(x.reason) ? tr('Sin razón') : tr(x.reason)}</span></td>
                  <td className="n"><b>{hm(x.ms)}</b></td>
                  <td className="rd-tdnote">{x.note || ''}</td>
                  <td>{x.by}</td>
                </tr>
              ))}</tbody>
            </table></div>
            {list.length > LIST && <button type="button" className="btn soft sm rd-morebtn" onClick={() => setMore(!more)}>{more ? tr('Ver menos') : tr('Ver los {0}', list.length)}</button>}
          </article>
        </>
      )}
    </section>
  )
}

// ---- attendance, with who moved where and for how long ----
const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase()
type Move = { key: string; kind: 'room' | 'line'; name: string; at: number; from: string; to: string; ms: number; ok: boolean | null; shift: 1 | 2; dept: Dept }

export function AttTab({ s, now, today, only }: { s: State; now: number; today: string; only?: Dept }) {
  const k = usePick(today, only)
  const rooms = k.room ? [k.room] : DEPTS
  const shifts = k.shift ? [k.shift] : attShifts(s, k.date)
  const att = attendanceOf(s, k.date, k.shift, rooms)
  const win = (d: Dept, sh: 1 | 2) => shiftWindow(s, k.date, d, sh)
  const endOf = (d: Dept, sh: 1 | 2) => Math.min(win(d, sh).to, now)
  const people = rooms.flatMap((d) => shifts.flatMap((sh) => attOf(s, k.date, d, sh).map((x) => ({ x, d, sh }))))
  const lineText = (d: Dept, l: string) => attLineText(s, l) || d
  const startOf = (x: AttEntry, d: Dept, sh: 1 | 2) => x.came ?? (x.from ? Math.max(x.at, win(d, sh).from) : win(d, sh).from)
  const hoursOf = (x: AttEntry, d: Dept, sh: 1 | 2) => Math.max(0, (x.gone?.at ?? endOf(d, sh)) - startOf(x, d, sh))
  // sent to another room: from the hour they were sent until they left that room (or the shift ended)
  const all = (s.attendance ?? []).filter((x) => !x.deleted && x.date === k.date && shifts.includes(x.shift))
  const moves: Move[] = [
    ...all.filter((x) => x.gone?.why === 'otro' && x.gone.to && (rooms.includes(x.dept) || rooms.includes(x.gone.to as Dept))).map((x) => {
      const to = x.gone!.to as Dept
      const there = attOf(s, k.date, to, x.shift).find((y) => same(y.name, x.name) && (y.via === x.id || y.from === x.dept))
      const end = there && !there.via && there.gone ? there.gone.at : endOf(to, x.shift)
      return { key: 'r' + x.id, kind: 'room' as const, name: x.name, at: x.gone!.at, from: x.dept + (x.line ? ' · ' + lineText(x.dept, x.line) : ''), to: to + (x.gone!.line ? ' · ' + lineText(to, x.gone!.line) : ''), ms: end - x.gone!.at, ok: there ? !there.via : null, shift: x.shift, dept: x.dept }
    }),
    ...people.filter(({ x }) => !x.via).flatMap(({ x, d, sh }) => x.moves.map((m, i) => {
      const end = x.moves[i + 1]?.at ?? x.gone?.at ?? endOf(d, sh)
      return { key: 'l' + x.id + i, kind: 'line' as const, name: x.name, at: m.at, from: d + ' · ' + lineText(d, m.from), to: lineText(d, m.to), ms: end - m.at, ok: null, shift: sh, dept: d }
    })),
  ].sort((a, b) => a.at - b.at)
  const home = people.filter(({ x }) => x.gone?.why === 'casa' && attCounts(x))
  const counted = people.filter(({ x }) => attCounts(x))
  const hours = counted.reduce((t, p) => t + hoursOf(p.x, p.d, p.sh), 0)
  const maxN = Math.max(1, ...att.rows.map((r) => Math.max(r.expected, r.actual)))
  const [openRoom, setOpenRoom] = useState<string>('')
  return (
    <section className="rd-rp">
      <PickBar icon="👥" title={tr('Asistencia')} k={k} today={today} only={only} />
      <div className="rd-tiles rd-rptiles">
        <div className={'rd-tile' + (!att.total.expected ? '' : att.total.att >= 0.95 ? ' ok' : att.total.att < 0.85 ? ' bad' : ' warn')}><label>👥 {tr('Vinieron')}</label><b>{att.total.actual}<small> / {att.total.expected}</small></b><small>{att.total.expected ? pct(att.total.actual, att.total.expected) + '% ' + tr('de los esperados') : '—'}</small></div>
        <div className="rd-tile"><label>❌ {tr('Faltaron')}</label><b>{att.total.miss}</b><small>{att.total.expected ? pct(att.total.miss, att.total.expected) + '%' : '—'}</small></div>
        <div className="rd-tile"><label>🔀 {tr('Traslados')}</label><b>{moves.filter((m) => m.kind === 'room').length}</b><small>{tr('a otro cuarto')}</small></div>
        <div className="rd-tile"><label>↔️ {tr('Cambios de línea')}</label><b>{moves.filter((m) => m.kind === 'line').length}</b><small>{tr('dentro del cuarto')}</small></div>
        <div className="rd-tile"><label>🏠 {tr('Se fueron')}</label><b>{home.length}</b><small>{tr('a su casa antes')}</small></div>
        <div className="rd-tile"><label>⏱️ {tr('Horas-persona')}</label><b>{Math.round(hours / 360_000) / 10}</b><small>{tr('de llegada a salida')}</small></div>
      </div>
      {!people.length ? <p className="rd-calm warn">👥 {tr('Nadie anotado en lo que estás viendo.')}</p> : (
        <>
          <article className="rd-card">
            <h3>🏭 {tr('Por cuarto')}</h3>
            <div className="rd-attbars">
              {att.rows.filter((r) => r.expected || r.actual).map((r) => (
                <div key={r.dept} className="rd-attbar" style={deptVars(r.dept)}>
                  <span className="rd-tsname">{DEPT_LOOK[r.dept].emoji} {r.dept}</span>
                  <span className="rd-atttrack"><i className="exp" style={{ width: (r.expected / maxN) * 100 + '%' }} /><i className={'got ' + (r.att >= 0.95 ? 'ok' : r.att < 0.85 ? 'bad' : 'warn')} style={{ width: (r.actual / maxN) * 100 + '%' }} /></span>
                  <span className="rd-tsnums"><b>{r.actual}</b> / {r.expected} · <b>{pct(r.actual, r.expected)}%</b></span>
                </div>
              ))}
            </div>
            <div className="rd-legend"><span><i className="got ok" />{tr('Vinieron')}</span><span><i className="exp" />{tr('Esperados')}</span></div>
          </article>
          <article className="rd-card">
            <h3>🔀 {tr('Traslados')}<small className="rd-cardsub">{tr('de dónde a dónde y cuánto duró')}</small></h3>
            {!moves.length ? <p className="rd-calm">{tr('Nadie se movió de cuarto ni de línea.')}</p> : (
              <div className="rd-moves">
                {moves.map((m) => (
                  <div key={m.key} className={'rd-move ' + (m.kind === 'room' ? 'mroom' : 'mline')}>
                    <span className="rd-movehour">{fmtTime(m.at)}</span>
                    <span className="rd-movewho"><b>{m.name}</b>{k.shift === 0 && <small> · {tr('T{0}', m.shift)}</small>}</span>
                    <span className="rd-movepath">{m.kind === 'room' ? '🔀' : '↔️'} {m.from} <b>→</b> {m.to}</span>
                    <span className="rd-movedur">⏱️ <b>{hm(m.ms)}</b></span>
                    {m.kind === 'room' && <span className={'rd-pill ' + (m.ok ? 'run' : 'su')}>{m.ok ? '✓ ' + tr('Aceptado') : '⏳ ' + tr('Sin aceptar')}</span>}
                  </div>
                ))}
              </div>
            )}
          </article>
          <article className="rd-card">
            <h3>🧑‍🏭 {tr('Personas')}</h3>
            <div className="rd-attrooms">
              {rooms.map((d) => {
                const mine = people.filter((p) => p.d === d)
                if (!mine.length) return null
                const open = rooms.length === 1 || openRoom === d
                return (
                  <div key={d} className="rd-attroom" style={deptVars(d)}>
                    <button type="button" className="rd-attroomhead" aria-expanded={open} onClick={() => setOpenRoom(open ? '' : d)}><b>{DEPT_LOOK[d].emoji} {d}</b><span>{mine.filter((p) => attCounts(p.x) && !p.x.gone).length} {tr('trabajando')} · {mine.length} {tr('anotados')}</span><i aria-hidden="true">{open ? '▴' : '▾'}</i></button>
                    {open && <div className="scroll"><table className="rd-tbl">
                      <thead><tr><th>{tr('Nombre')}</th>{k.shift === 0 && <th>{tr('Turno')}</th>}<th>{tr('Línea')}</th><th>{tr('Llegó')}</th><th>{tr('Salió')}</th><th className="n">{tr('Horas')}</th></tr></thead>
                      <tbody>{mine.map(({ x, sh }) => (
                        <tr key={x.id} className={x.gone || !attCounts(x) ? 'dim' : ''}>
                          <td><b>{x.name}</b>{x.sup && <span className="rd-tag">⭐ {tr('Supervisor')}</span>}{x.temp && <span className="rd-tag">{tr('Temporal')}</span>}{x.from && <span className="rd-tag">{tr('de {0}', x.from)}</span>}</td>
                          {k.shift === 0 && <td>{sh}</td>}
                          <td>{x.line ? lineText(d, x.line) : '—'}</td>
                          <td className="nw">{fmtTime(startOf(x, d, sh))}</td>
                          <td className="nw">{x.via ? '⏳ ' + tr('sin aceptar') : !x.gone ? '—' : (x.gone.why === 'casa' ? '🏠 ' : '🔀 ' + (x.gone.to || '') + ' · ') + fmtTime(x.gone.at)}</td>
                          <td className="n">{attCounts(x) ? hm(hoursOf(x, d, sh)) : '—'}</td>
                        </tr>
                      ))}</tbody>
                    </table></div>}
                  </div>
                )
              })}
            </div>
          </article>
        </>
      )}
    </section>
  )
}
