import { useEffect, useState, useSyncExternalStore } from 'react'
import { activeBetween, addLine, CFG, dayOf, DEPTS, deptStop, endRun, endStop, fmtDur, fmtTime, lastPerUnit, lotFor, madeText, myDept, openRun, openStop, removeLine, reset, runStats, startRun, startStop, stopsOf, store, today, unitDone, user, type Dept, type Line, type State } from './store'
import { buildPdf, loadPdf } from './pdf'

/** a clock that ticks every second, so every timer on screen moves */
function useNow() {
  const [n, setN] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setN(Date.now()), 1000); return () => clearInterval(t) }, [])
  return n
}

const isDept = (v: string): v is Dept => (DEPTS as string[]).includes(v)

export default function App() {
  const [name, setName] = useState(user.get())
  const [dept, setDept] = useState(myDept.get())
  if (!isDept(dept) || !name) return <Gate dept={isDept(dept) ? dept : null} onDept={(d) => { myDept.set(d); setDept(d) }} onName={(n) => { user.set(n); setName(n) }} />
  return <Main name={name} home={dept} onLogout={() => { user.set(''); myDept.set(''); setName(''); setDept('') }} />
}

/** entering: first the department this person works in, then their name */
function Gate({ dept, onDept, onName }: { dept: Dept | null; onDept: (d: Dept) => void; onName: (n: string) => void }) {
  const [v, setV] = useState('')
  return (
    <div className="gate">
      <h1>Actividad</h1>
      {!dept ? (
        <>
          <p>¿De qué departamento eres?</p>
          <div className="pick">{DEPTS.map((d) => <button key={d} type="button" className="btn" onClick={() => onDept(d)}>{d}</button>)}</div>
        </>
      ) : (
        <>
          <p><b>{dept}</b> · Ahora escribe tu nombre. Todo lo que registres lleva tu nombre.</p>
          <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) onName(v.trim()) }}>
            <input autoFocus placeholder="Tu nombre" value={v} onChange={(e) => setV(e.target.value)} />
            <button className="btn primary" type="submit" disabled={!v.trim()}>Entrar</button>
          </form>
          <button type="button" className="lnk" onClick={() => { myDept.set(''); location.reload() }}>Otro departamento</button>
        </>
      )}
      <small>Demo · los datos se guardan solo en este dispositivo</small>
    </div>
  )
}

function Main({ name, home, onLogout }: { name: string; home: Dept; onLogout: () => void }) {
  const s = useSyncExternalStore(store.subscribe, store.get)
  const now = useNow()
  const [dept, setDept] = useState<Dept>(home)
  const [tab, setTab] = useState<'act' | 'rep'>('act')
  return (
    <div className="app">
      <header className="top">
        <div className="brand"><h1>Actividad</h1><small>{new Date(now).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}</small></div>
        <nav className="tabs">
          <button type="button" className={tab === 'act' ? 'on' : ''} onClick={() => setTab('act')}>Actividad</button>
          <button type="button" className={tab === 'rep' ? 'on' : ''} onClick={() => setTab('rep')}>Reporte del día</button>
        </nav>
        <div className="me">{name} · {home} <button type="button" className="lnk" onClick={onLogout}>Cambiar</button></div>
      </header>
      {tab === 'act' ? (
        <div className="main">
          <aside className="side">
            {DEPTS.map((d) => {
              const lines = s.lines.filter((l) => l.dept === d)
              const running = lines.filter((l) => openRun(s, l.id) && !openStop(s, d, l.id)).length
              const stopped = lines.filter((l) => openRun(s, l.id) && openStop(s, d, l.id)).length
              return (
                <button key={d} type="button" className={'dept' + (dept === d ? ' on' : '')} onClick={() => setDept(d)}>
                  {d}
                  <span className="dots">{running > 0 && <i className="dot g">{running}</i>}{stopped > 0 && <i className="dot r">{stopped}</i>}</span>
                </button>
              )
            })}
          </aside>
          <DeptPanel key={dept} s={s} dept={dept} now={now} />
        </div>
      ) : <Report s={s} now={now} />}
    </div>
  )
}

function DeptPanel({ s, dept, now }: { s: State; dept: Dept; now: number }) {
  const lines = s.lines.filter((l) => l.dept === dept)
  const ds = deptStop(s, dept)
  const [stopAll, setStopAll] = useState(false)
  const anyRunning = lines.some((l) => openRun(s, l.id))
  const doneToday = s.runs.filter((r) => r.dept === dept && r.endedAt && r.date === today()).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  return (
    <section className="panel">
      <div className="phead">
        <h2>{dept}</h2>
        <div className="acts">
          {ds
            ? <button type="button" className="btn danger" onClick={() => endStop(ds.id)}>▶ Reanudar departamento · {fmtDur(now - ds.startedAt)}</button>
            : <button type="button" className="btn" disabled={!anyRunning} onClick={() => setStopAll(true)}>⏸ Parar departamento</button>}
          <button type="button" className="btn" onClick={() => addLine(dept)}>+ Agregar línea</button>
        </div>
      </div>
      {ds && <div className="deptstop">⏸ Todo {dept} parado · <b>{ds.reason}</b>{ds.note && ' · ' + ds.note} · desde {fmtTime(ds.startedAt)} · {ds.by}</div>}
      <div className="lines">{lines.map((l) => <LineCard key={l.id} s={s} line={l} now={now} />)}</div>
      {lines.length === 0 && <p className="hint">Este departamento no tiene líneas. Toca "Agregar línea".</p>}
      {doneToday.length > 0 && (
        <div className="done">
          <h3>Terminados hoy en {dept}</h3>
          {doneToday.map((r) => {
            const st = runStats(s, r, now)
            return (
              <div key={r.id} className="donerow">
                <b className="code">{r.code}</b> · lote {r.lot} · {r.line} · {fmtTime(r.startedAt)} – {fmtTime(r.endedAt ?? now)} · <b>{madeText(r, st.qty)}</b> · trabajando <b>{fmtDur(st.working)}</b> · parado <b className={st.down ? 'red' : ''}>{fmtDur(st.down)}</b> · {r.by}
              </div>
            )
          })}
        </div>
      )}
      {stopAll && <StopDialog title={'Parar todo ' + dept} reasons={CFG[dept].reasons} onClose={() => setStopAll(false)} onPick={(reason, note) => { startStop(dept, null, reason, note); setStopAll(false) }} />}
    </section>
  )
}

function LineCard({ s, line, now }: { s: State; line: Line; now: number }) {
  const cfg = CFG[line.dept]
  const run = openRun(s, line.id)
  const stop = run ? openStop(s, line.dept, line.id) : undefined
  const [code, setCode] = useState('')
  const [lot, setLot] = useState(lotFor(today()))
  const [date, setDate] = useState(today())
  const [per, setPer] = useState('')
  const [asking, setAsking] = useState(false)
  const [counting, setCounting] = useState(false)
  if (!run) {
    // the lot follows the date unless someone typed another one; boxes per pallet come back from the last run of the code
    const suggested = cfg.defaultQty ? lastPerUnit(s, line.dept, code) : null
    const perUnit = per.trim() ? Number(per) : suggested
    const ok = !!code.trim() && !!lot.trim() && (!cfg.defaultQty || (perUnit != null && perUnit > 0))
    return (
      <div className="line idle">
        <div className="lhead"><h3>{line.name}</h3><button type="button" className="lnk" onClick={() => { if (confirm('¿Quitar ' + line.name + ' de ' + line.dept + '?')) removeLine(line.id) }}>Quitar línea</button></div>
        <form className="start" onSubmit={(e) => { e.preventDefault(); if (ok) startRun(line, code.trim().toUpperCase(), lot.trim(), date, cfg.defaultQty ? perUnit : null) }}>
          <label>Código <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ej. 0889" autoComplete="off" /></label>
          <label>Lote <input value={lot} onChange={(e) => setLot(e.target.value)} inputMode="numeric" placeholder="ej. 6280" autoComplete="off" /></label>
          <label>Fecha <input type="date" value={date} onChange={(e) => { const v = e.target.value; if (!lot.trim() || lot.trim() === lotFor(date)) setLot(lotFor(v)); setDate(v) }} /></label>
          {cfg.defaultQty && <label>Cajas por pallet <input value={per} onChange={(e) => setPer(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder={suggested != null ? String(suggested) + ' (como la última vez)' : 'ej. 48'} autoComplete="off" /></label>}
          <button className="btn primary" type="submit" disabled={!ok}>▶ Empezar</button>
        </form>
      </div>
    )
  }
  const st = runStats(s, run, now)
  const last = run.units.length ? run.units[run.units.length - 1].at : run.startedAt
  const current = activeBetween(last, now, stopsOf(s, run.dept, run.lineId), now)
  const done = () => (cfg.askQty ? setCounting(true) : unitDone(run.id, null))
  return (
    <div className={'line ' + (stop ? 'stopped' : 'running')}>
      <div className="lhead">
        <h3>{line.name}</h3>
        <span className="meta"><b className="code">{run.code}</b> · lote {run.lot} · {run.date} · desde {fmtTime(run.startedAt)}{run.perUnit != null && ' · ' + run.perUnit + ' ' + cfg.qtyUnit + ' por ' + cfg.unit.toLowerCase()}</span>
      </div>
      {stop && <div className="stopbar">⏸ Parado · <b>{stop.reason}</b>{stop.note && ' · ' + stop.note} · <b>{fmtDur(now - stop.startedAt)}</b>{stop.lineId === null && ' · todo el departamento'}</div>}
      <div className="stats">
        <div className="stat big"><label>Trabajando</label><b>{fmtDur(st.working)}</b></div>
        <div className="stat"><label>{cfg.plural}</label><b>{run.units.length}</b></div>
        {cfg.askQty && <div className="stat"><label>{cfg.qtyUnit}</label><b>{st.qty}</b></div>}
        <div className="stat"><label>{cfg.unit} actual</label><b>{fmtDur(current)}</b></div>
        <div className="stat"><label>Promedio / {cfg.unit.toLowerCase()}</label><b>{run.units.length ? fmtDur(st.avg) : '—'}</b></div>
        <div className="stat"><label>Parado</label><b className={st.down ? 'red' : ''}>{fmtDur(st.down)}</b></div>
      </div>
      <div className="btns">
        <button type="button" className="btn primary huge" disabled={!!stop} onClick={done}>✓ {cfg.done}</button>
        {stop
          ? (stop.lineId === line.id
            ? <button type="button" className="btn danger" onClick={() => endStop(stop.id)}>▶ Reanudar</button>
            : <button type="button" className="btn" disabled>Parado por el departamento</button>)
          : <button type="button" className="btn" onClick={() => setAsking(true)}>⏸ Parar</button>}
        <button type="button" className="btn" disabled={!!stop} onClick={() => { if (confirm('¿Terminar el código ' + run.code + '? Se cierra con ' + madeText(run, st.qty) + '.')) endRun(run.id) }}>■ Terminar código</button>
      </div>
      {asking && <StopDialog title={'Parar ' + line.name + ' · ' + run.code} reasons={cfg.reasons} onClose={() => setAsking(false)} onPick={(reason, note) => { startStop(line.dept, line.id, reason, note); setAsking(false) }} />}
      {counting && <QtyDialog title={cfg.qtyQ} unit={cfg.qtyUnit} initial={run.perUnit} onClose={() => setCounting(false)} onPick={(q) => { unitDone(run.id, q); setCounting(false) }} />}
    </div>
  )
}

function StopDialog({ title, reasons, onClose, onPick }: { title: string; reasons: string[]; onClose: () => void; onPick: (reason: string, note: string) => void }) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const other = reason === 'Otra'
  const ok = other ? note.trim().length > 0 : !!reason
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>¿Por qué se para? La app cuenta el tiempo parado con esta razón.</p>
        <div className="chips">{[...reasons, 'Otra'].map((r) => <button key={r} type="button" className={'chip' + (reason === r ? ' on' : '')} onClick={() => setReason(r)}>{r}</button>)}</div>
        <input placeholder={other ? 'Escribe la razón' : 'Detalle (opcional)'} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="dbtns">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn danger" disabled={!ok} onClick={() => onPick(other ? note.trim() : reason, other ? '' : note.trim())}>⏸ Confirmar paro</button>
        </div>
      </div>
    </div>
  )
}

/** departments that type how much a unit carried (boxes on a pallet, quantity in a bill) */
function QtyDialog({ title, unit, initial, onClose, onPick }: { title: string; unit: string; initial: number | null; onClose: () => void; onPick: (q: number) => void }) {
  const [v, setV] = useState(initial != null ? String(initial) : '')
  const n = Number(v)
  const ok = v.trim() !== '' && Number.isFinite(n) && n >= 0
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <form onSubmit={(e) => { e.preventDefault(); if (ok) onPick(n) }}>
          <input autoFocus inputMode="numeric" placeholder={unit} value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} />
          <div className="dbtns">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn primary" disabled={!ok}>✓ Guardar</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Report({ s, now }: { s: State; now: number }) {
  const [date, setDate] = useState(today())
  useEffect(() => { void loadPdf() }, [])
  /** opens the PDF in a new tab (to look at, share or print); if the tab cannot open, it downloads */
  const pdf = async () => {
    const name = 'actividad-' + date + '.pdf'
    let doc = buildPdf(s, date, now, user.get())
    if (!doc) { await loadPdf(); doc = buildPdf(s, date, now, user.get()); doc?.save(name); return }
    const win = window.open(doc.output('bloburl'), '_blank')
    if (!win) doc.save(name)
  }
  const runs = s.runs.filter((r) => r.date === date).sort((a, b) => a.startedAt - b.startedAt)
  const stops = s.stops.filter((x) => dayOf(x.startedAt) === date).sort((a, b) => a.startedAt - b.startedAt)
  const rows = runs.map((r) => ({ r, st: runStats(s, r, now) }))
  const working = rows.reduce((t, x) => t + x.st.working, 0)
  const down = rows.reduce((t, x) => t + x.st.down, 0)
  const reasonsText = (x: (typeof rows)[number]) => Object.entries(x.st.reasons).map(([k, v]) => k + ' ' + fmtDur(v)).join(', ')
  const lineName = (x: { lineId: string | null; dept: Dept }) => (x.lineId === null ? 'Todo ' + x.dept : s.lines.find((l) => l.id === x.lineId)?.name ?? s.runs.find((r) => r.lineId === x.lineId)?.line ?? 'línea')
  const csv = () => {
    const q = (v: string | number) => '"' + String(v).replace(/"/g, '""') + '"'
    const head = ['Departamento', 'Línea', 'Código', 'Lote', 'Fecha', 'Inicio', 'Fin', 'Hecho', 'Cantidad', 'Tiempo trabajando', 'Promedio por unidad', 'Tiempo parado', 'Razones de paro', 'Registró']
    const body = rows.map((x) => [x.r.dept, x.r.line, x.r.code, x.r.lot, x.r.date, fmtTime(x.r.startedAt), x.r.endedAt ? fmtTime(x.r.endedAt) : 'en curso', x.r.units.length + ' ' + CFG[x.r.dept].plural.toLowerCase(), CFG[x.r.dept].askQty ? x.st.qty + ' ' + CFG[x.r.dept].qtyUnit : '', fmtDur(x.st.working), x.r.units.length ? fmtDur(x.st.avg) : '', fmtDur(x.st.down), reasonsText(x), x.r.by])
    const stopHead = ['', 'PAROS', 'Departamento', 'Línea', 'Razón', 'Detalle', 'Inicio', 'Fin', 'Duración', 'Registró']
    const stopBody = stops.map((x) => ['', '', x.dept, lineName(x), x.reason, x.note, fmtTime(x.startedAt), x.endedAt ? fmtTime(x.endedAt) : 'en curso', fmtDur((x.endedAt ?? now) - x.startedAt), x.by])
    const text = [head, ...body, [], stopHead, ...stopBody].map((r) => r.map(q).join(',')).join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
    a.download = 'actividad-' + date + '.csv'
    a.click()
  }
  return (
    <section className="report">
      <div className="rhead">
        <h2>Reporte del día</h2>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button type="button" className="btn" onClick={csv} disabled={!rows.length}>⬇ Excel (CSV)</button>
        <button type="button" className="btn primary" onClick={() => void pdf()} disabled={!rows.length}>📄 Ver PDF / imprimir</button>
      </div>
      <div className="totals">
        <div className="stat"><label>Códigos</label><b>{rows.length}</b></div>
        <div className="stat"><label>Trabajando</label><b>{fmtDur(working)}</b></div>
        <div className="stat"><label>Parado</label><b className={down ? 'red' : ''}>{fmtDur(down)}</b></div>
      </div>
      {rows.length === 0 ? <p className="hint">Nada registrado en esta fecha.</p> : (
        <div className="twrap">
          <table>
            <thead><tr><th>Depto</th><th>Línea</th><th>Código</th><th>Lote</th><th>Inicio</th><th>Fin</th><th>Hecho</th><th>Trabajando</th><th>Prom./unidad</th><th>Parado</th><th>Razones</th><th>Registró</th></tr></thead>
            <tbody>{rows.map((x) => (
              <tr key={x.r.id} className={x.r.endedAt ? '' : 'live'}>
                <td>{x.r.dept}</td><td>{x.r.line}</td><td><b>{x.r.code}</b></td><td>{x.r.lot}</td><td>{fmtTime(x.r.startedAt)}</td><td>{x.r.endedAt ? fmtTime(x.r.endedAt) : <i>en curso</i>}</td>
                <td>{madeText(x.r, x.st.qty)}</td><td>{fmtDur(x.st.working)}</td><td>{x.r.units.length ? fmtDur(x.st.avg) : '—'}</td><td className={x.st.down ? 'red' : ''}>{fmtDur(x.st.down)}</td><td>{reasonsText(x) || '—'}</td><td>{x.r.by}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {stops.length > 0 && (
        <>
          <h3>Paros</h3>
          <div className="twrap">
            <table>
              <thead><tr><th>Depto</th><th>Línea</th><th>Razón</th><th>Detalle</th><th>Inicio</th><th>Fin</th><th>Duración</th><th>Registró</th></tr></thead>
              <tbody>{stops.map((x) => (
                <tr key={x.id} className={x.endedAt ? '' : 'live'}>
                  <td>{x.dept}</td><td>{lineName(x)}</td><td><b>{x.reason}</b></td><td>{x.note || '—'}</td><td>{fmtTime(x.startedAt)}</td><td>{x.endedAt ? fmtTime(x.endedAt) : <i>en curso</i>}</td><td>{fmtDur((x.endedAt ?? now) - x.startedAt)}</td><td>{x.by}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      <p className="hint foot">Demo guardado en este dispositivo. La versión completa manda todo en vivo al manager (oficina, teléfono o PC) y exporta a Excel, PDF y Google Sheets como la Hoja de Freezer RTE.</p>
      <button type="button" className="lnk" onClick={() => { if (confirm('¿Borrar todos los datos de prueba de este dispositivo?')) reset() }}>Borrar datos de prueba</button>
    </section>
  )
}
