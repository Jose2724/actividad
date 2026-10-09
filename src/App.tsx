import { useEffect, useState, useSyncExternalStore } from 'react'
import { activeBetween, addLine, CFG, CRATES_PER_CART, dayOf, DEPTS, deptStop, endRun, endStop, fmtDur, fmtTime, lastPerUnit, lotFor, madeText, mergeProducts, myDept, openRun, openStop, parseProductsCsv, productOf, productsCsv, removeLine, removeProduct, reset, resetRecords, runStats, saveProduct, setSchedule, startRun, startStop, stopsOf, store, today, unitDone, user, type Dept, type Line, type Product, type State } from './store'
import { avanceRows, n1, pending, type AvanceRow } from './avance'
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
  const [tab, setTab] = useState<'act' | 'av' | 'rep'>('act')
  return (
    <div className="app">
      <header className="top">
        <div className="brand"><h1>Actividad</h1><small>{new Date(now).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}</small></div>
        <nav className="tabs">
          <button type="button" className={tab === 'act' ? 'on' : ''} onClick={() => setTab('act')}>Actividad</button>
          <button type="button" className={tab === 'av' ? 'on' : ''} onClick={() => setTab('av')}>Avance</button>
          <button type="button" className={tab === 'rep' ? 'on' : ''} onClick={() => setTab('rep')}>Reporte</button>
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
      ) : tab === 'av' ? <Avance s={s} /> : <Report s={s} now={now} />}
    </div>
  )
}

/** the office's AVANCE sheet, live: scheduled → done → pending per room, computed from the products table */
function Avance({ s }: { s: State }) {
  const [date, setDate] = useState(today())
  const [editing, setEditing] = useState(false)
  const [newCode, setNewCode] = useState('')
  const rows = avanceRows(s, date)
  const sum = (f: (r: AvanceRow) => number | null) => rows.reduce((t, r) => t + (f(r) ?? 0), 0)
  const cls = (v: number | null) => (v == null ? '' : v < 0 ? 'red' : v > 0 ? 'amber' : 'ok')
  return (
    <section className="report avance">
      <div className="rhead">
        <h2>Avance del día</h2>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <form className="addcode" onSubmit={(e) => { e.preventDefault(); if (newCode.trim()) { setSchedule(date, newCode, 0); setNewCode('') } }}>
          <input placeholder="Código a programar" value={newCode} onChange={(e) => setNewCode(e.target.value)} autoComplete="off" />
          <button className="btn" type="submit" disabled={!newCode.trim()}>+ Programar</button>
        </form>
        <button type="button" className="btn" onClick={() => setEditing(!editing)}>{editing ? 'Cerrar productos' : '⚙ Productos'}</button>
      </div>
      <p className="hint">Programado = mezclas planeadas. Lo esperado sale de las mezclas hechas en Kitchen × la tabla de productos (cajas por mezcla, pouches por caja, cajas por pallet). Pendiente en rojo = se hizo de más.</p>
      {editing && <Products s={s} />}
      {rows.length === 0 ? <p className="hint">Nada programado ni registrado en esta fecha. Escribe un código y toca "Programar".</p> : (
        <div className="twrap">
          <table>
            <thead>
              <tr><th rowSpan={2}>Código</th><th rowSpan={2}>Producto</th><th colSpan={3} className="grp g1">Mezclas (Kitchen)</th><th rowSpan={2} className="gs">Spiral</th><th colSpan={3} className="grp g2">Pouches (RTE)</th><th colSpan={3} className="grp g3">Cajas (Packing)</th><th rowSpan={2} className="gs">MFO cajas</th><th colSpan={2} className="grp g4">Pallets</th></tr>
              <tr><th className="g1 gs">Progr.</th><th className="g1">Hechas</th><th className="g1">Pend.</th><th className="g2 gs">Esper.</th><th className="g2">Hechos</th><th className="g2">Pend.</th><th className="g3 gs">Esper.</th><th className="g3">Hechas</th><th className="g3">Pend.</th><th className="g4 gs">Esper.</th><th className="g4">Hechos</th></tr>
            </thead>
            <tbody>{rows.map((r) => (
              <tr key={r.code}>
                <td><b>{r.code}</b></td><td>{r.product?.name ?? <i className="red">no está en Productos</i>}</td>
                <td><input className="num" inputMode="numeric" value={r.scheduled || ''} placeholder="0" onChange={(e) => setSchedule(date, r.code, Number(e.target.value.replace(/\D/g, '')) || 0)} /></td>
                <td>{r.mixesDone}</td><td className={r.mixesPending ? 'amber' : 'ok'}>{r.mixesPending}</td>
                <td>{r.spiralDone}</td>
                <td>{n1(r.pouchesExp)}</td><td>{r.pouchesDone}</td><td className={cls(pending(r.pouchesExp, r.pouchesDone))}>{n1(pending(r.pouchesExp, r.pouchesDone))}</td>
                <td>{n1(r.casesExp)}</td><td>{r.casesDone}</td><td className={cls(pending(r.casesExp, r.casesDone))}>{n1(pending(r.casesExp, r.casesDone))}</td>
                <td>{r.mfoCases}</td>
                <td>{n1(r.palletsExp)}</td><td>{r.palletsDone}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={2}>Total</td><td>{sum((r) => r.scheduled)}</td><td>{sum((r) => r.mixesDone)}</td><td>{sum((r) => r.mixesPending)}</td><td>{sum((r) => r.spiralDone)}</td><td>{n1(sum((r) => r.pouchesExp))}</td><td>{sum((r) => r.pouchesDone)}</td><td></td><td>{n1(sum((r) => r.casesExp))}</td><td>{sum((r) => r.casesDone)}</td><td></td><td>{sum((r) => r.mfoCases)}</td><td>{n1(sum((r) => r.palletsExp))}</td><td>{sum((r) => r.palletsDone)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </section>
  )
}

/** the master table, typed on the device (the examples are made up) */
function Products({ s }: { s: State }) {
  const num = (v: string) => Number(v.replace(',', '.')) || 0
  const upd = (i: number, p: Product, patch: Partial<Product>) => saveProduct(i, { ...p, ...patch })
  const [removeIdx, setRemoveIdx] = useState<number | null>(null)
  const [notice, setNotice] = useState<{ title: string; text?: string } | null>(null)
  return (
    <div className="products">
      {removeIdx != null && <ConfirmDialog title={'¿Quitar ' + (s.products[removeIdx]?.code || 'este producto') + ' de la tabla?'} yes="Quitar" danger onYes={() => { removeProduct(removeIdx); setRemoveIdx(null) }} onNo={() => setRemoveIdx(null)} />}
      {notice && <NoticeDialog title={notice.title} text={notice.text} onClose={() => setNotice(null)} />}
      <h3>Productos · la tabla maestra de la oficina</h3>
      <div className="twrap">
        <table>
          <thead><tr><th>Código</th><th>Producto</th><th>Pouches / caja</th><th>Cajas / mezcla (yield)</th><th>Guacales / carro</th><th>Pouches / guacal</th><th>Cajas / pallet</th><th></th></tr></thead>
          <tbody>{s.products.map((p, i) => (
            <tr key={s.products.length + ':' + i}>
              <td><input className="code" value={p.code} onChange={(e) => upd(i, p, { code: e.target.value.toUpperCase() })} autoComplete="off" /></td>
              <td><input className="name" value={p.name} onChange={(e) => upd(i, p, { name: e.target.value })} autoComplete="off" /></td>
              <td><input className="num" inputMode="decimal" defaultValue={p.pouchesPerCase || ''} onBlur={(e) => upd(i, p, { pouchesPerCase: num(e.target.value) })} /></td>
              <td><input className="num" inputMode="decimal" defaultValue={p.casesPerMix || ''} onBlur={(e) => upd(i, p, { casesPerMix: num(e.target.value) })} /></td>
              <td><input className="num" inputMode="decimal" defaultValue={p.cratesPerCart || ''} onBlur={(e) => upd(i, p, { cratesPerCart: num(e.target.value) })} /></td>
              <td><input className="num" inputMode="decimal" defaultValue={p.pouchesPerCrate || ''} onBlur={(e) => upd(i, p, { pouchesPerCrate: num(e.target.value) })} /></td>
              <td><input className="num" inputMode="decimal" defaultValue={p.casesPerPallet || ''} onBlur={(e) => upd(i, p, { casesPerPallet: num(e.target.value) })} /></td>
              <td><button type="button" className="lnk" onClick={() => setRemoveIdx(i)}>✕</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="btns">
        <button type="button" className="btn" onClick={() => saveProduct(s.products.length, { code: '', name: '', pouchesPerCase: 0, casesPerMix: 0, cratesPerCart: CRATES_PER_CART, pouchesPerCrate: 0, casesPerPallet: 0 })}>+ Agregar producto</button>
        <label className="btn file">⬆ Importar CSV de la oficina
          <input type="file" accept=".csv,text/csv" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (!f) return
            const list = parseProductsCsv(await f.text())
            if (!list.length) { setNotice({ title: 'No encontré productos en ese archivo', text: 'Debe tener una columna "Código" y una fila por producto.' }); return }
            mergeProducts(list); setNotice({ title: list.length + ' productos cargados', text: 'Los códigos que ya existían se actualizaron; los nuevos se agregaron.' })
          }} />
        </label>
        <button type="button" className="btn" onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([productsCsv(s.products)], { type: 'text/csv;charset=utf-8' })); a.download = 'productos.csv'; a.click() }}>⬇ Exportar CSV</button>
      </div>
      <p className="hint">Los productos de ejemplo son inventados. Escribe aquí los códigos y números reales de la planta, o importa el CSV sacado del Excel de la oficina (columnas: Código, Producto, Pouches por caja, Cajas por mezcla, Cajas por pallet, Guacales por carro, Pouches por guacal). Todo se guarda solo en este dispositivo.</p>
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
  const [crates, setCrates] = useState('')
  const [asking, setAsking] = useState(false)
  const [counting, setCounting] = useState(false)
  const [ending, setEnding] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [editQty, setEditQty] = useState(false)
  const [partial, setPartial] = useState(false)
  if (!run) {
    // the lot follows the date unless someone typed another one; the quantity per unit (boxes per pallet, pouches
    // per cart) comes from the products table or the last run of the code. RTE types it the office's way: crates
    // per cart × pouches per crate ("12x10")
    const needPer = !!cfg.perUnitLabel
    const isCart = cfg.unit === 'Carro'
    const prod = productOf(s, code)
    const suggested = needPer ? lastPerUnit(s, line.dept, code) : null
    const cratesN = crates.trim() ? Number(crates) : prod?.cratesPerCart || CRATES_PER_CART
    const perCrateN = per.trim() ? Number(per) : prod?.pouchesPerCrate || (suggested != null ? Math.round(suggested / cratesN) : null)
    const perUnit = isCart ? (perCrateN ? cratesN * perCrateN : null) : per.trim() ? Number(per) : suggested
    const ok = !!code.trim() && !!lot.trim() && (!needPer || (perUnit != null && perUnit > 0))
    return (
      <div className="line idle">
        <div className="lhead"><h3>{line.name}</h3><button type="button" className="lnk" onClick={() => setRemoving(true)}>Quitar {cfg.lineWord.toLowerCase()}</button></div>
        {removing && <ConfirmDialog title={'¿Quitar ' + line.name + ' de ' + line.dept + '?'} text="Se puede volver a agregar cuando haga falta." yes="Quitar" danger onYes={() => removeLine(line.id)} onNo={() => setRemoving(false)} />}
        <form className="start" onSubmit={(e) => { e.preventDefault(); if (ok) startRun(line, code.trim().toUpperCase(), lot.trim(), date, needPer ? perUnit : null) }}>
          <label>Código <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ej. 0889" autoComplete="off" /></label>
          <label>Lote <input value={lot} onChange={(e) => setLot(e.target.value)} inputMode="numeric" placeholder="ej. 6280" autoComplete="off" /></label>
          <label>Fecha <input type="date" value={date} onChange={(e) => { const v = e.target.value; if (!lot.trim() || lot.trim() === lotFor(date)) setLot(lotFor(v)); setDate(v) }} /></label>
          {/* a known product brings its numbers: shown as a line, the boxes only when they want to change them */}
          {needPer && !isCart && (suggested != null && !editQty
            ? <div className="known"><b>{suggested}</b> {cfg.qtyUnit} por {cfg.unit.toLowerCase()} <button type="button" className="lnk" onClick={() => setEditQty(true)}>Cambiar</button></div>
            : <label>{cfg.perUnitLabel} <input value={per} onChange={(e) => setPer(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder={suggested != null ? String(suggested) : 'ej. 36'} autoComplete="off" /></label>)}
          {isCart && (perCrateN && !editQty
            ? <div className="known"><b>{cratesN}</b> guacales × <b>{perCrateN}</b> pouches = <b>{perUnit}</b> pouches por carro <button type="button" className="lnk" onClick={() => setEditQty(true)}>Cambiar</button></div>
            : (
              <div className="cartrow">
                <label>Guacales por carro <small>(12 por columna)</small> <input value={crates} onChange={(e) => setCrates(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder={String(cratesN)} autoComplete="off" /></label>
                <label>Pouches por guacal <input value={per} onChange={(e) => setPer(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder={perCrateN ? String(perCrateN) : 'ej. 10'} autoComplete="off" /></label>
                <span className="eq">= <b>{perUnit ?? '—'}</b> pouches por carro</span>
              </div>
            ))}
          <button className="btn primary" type="submit" disabled={!ok}>▶ Empezar</button>
        </form>
      </div>
    )
  }
  const st = runStats(s, run, now)
  const last = run.units.length ? run.units[run.units.length - 1].at : run.startedAt
  const current = activeBetween(last, now, stopsOf(s, run.dept, run.lineId), now)
  const done = () => (cfg.qty === 'ask' ? setCounting(true) : unitDone(run.id, cfg.qty === 'auto' ? run.perUnit : null))
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
        {cfg.qty !== 'none' && <div className="stat"><label>{cfg.qtyUnit}</label><b>{st.qty}</b></div>}
        <div className="stat"><label>{cfg.unit} actual</label><b>{fmtDur(current)}</b></div>
        <div className="stat"><label>Promedio / {cfg.unit.toLowerCase()}</label><b>{run.units.length ? fmtDur(st.avg) : '—'}</b></div>
        <div className="stat"><label>Parado</label><b className={st.down ? 'red' : ''}>{fmtDur(st.down)}</b></div>
      </div>
      <div className="btns">
        <button type="button" className="btn primary huge" disabled={!!stop} onClick={done}>✓ {cfg.done}</button>
        {/* the last cart of a code is rarely full: the office's RTE sheet has a "PARCIAL" column for it */}
        {cfg.qty === 'auto' && <button type="button" className="btn" disabled={!!stop} onClick={() => setPartial(true)}>{cfg.unit} parcial…</button>}
        {stop
          ? (stop.lineId === line.id
            ? <button type="button" className="btn danger" onClick={() => endStop(stop.id)}>▶ Reanudar</button>
            : <button type="button" className="btn" disabled>Parado por el departamento</button>)
          : <button type="button" className="btn" onClick={() => setAsking(true)}>⏸ Parar</button>}
        <button type="button" className="btn" disabled={!!stop} onClick={() => setEnding(true)}>■ Terminar código</button>
      </div>
      {ending && <ConfirmDialog title={'¿Terminar el código ' + run.code + ' en ' + line.name + '?'} text={'Se cierra con ' + madeText(run, st.qty) + ' · trabajando ' + fmtDur(st.working) + (st.down ? ' · parado ' + fmtDur(st.down) : '') + '.'} yes="■ Terminar" onYes={() => { endRun(run.id); setEnding(false) }} onNo={() => setEnding(false)} />}
      {asking && <StopDialog title={'Parar ' + line.name + ' · ' + run.code} reasons={cfg.reasons} onClose={() => setAsking(false)} onPick={(reason, note) => { startStop(line.dept, line.id, reason, note); setAsking(false) }} />}
      {counting && <QtyDialog title={cfg.qtyQ} unit={cfg.qtyUnit} refLabel={cfg.refLabel} initial={run.perUnit} onClose={() => setCounting(false)} onPick={(q, ref) => { unitDone(run.id, q, ref); setCounting(false) }} />}
      {partial && <QtyDialog title={'¿Cuántos ' + cfg.qtyUnit + ' lleva este ' + cfg.unit.toLowerCase() + '?'} unit={cfg.qtyUnit} refLabel="" initial={run.perUnit} onClose={() => setPartial(false)} onPick={(q) => { unitDone(run.id, q); setPartial(false) }} />}
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

/** the app's own yes / no box (the browser's "confirm" names the site and looks foreign) */
function ConfirmDialog({ title, text, yes, danger, onYes, onNo }: { title: string; text?: string; yes: string; danger?: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <div className="veil" onClick={onNo}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {text && <p>{text}</p>}
        <div className="dbtns">
          <button type="button" className="btn" onClick={onNo}>Cancelar</button>
          <button type="button" className={'btn ' + (danger ? 'danger' : 'primary')} autoFocus onClick={onYes}>{yes}</button>
        </div>
      </div>
    </div>
  )
}

/** a message with one button */
function NoticeDialog({ title, text, onClose }: { title: string; text?: string; onClose: () => void }) {
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {text && <p>{text}</p>}
        <div className="dbtns"><button type="button" className="btn primary" autoFocus onClick={onClose}>Entendido</button></div>
      </div>
    </div>
  )
}

/** departments that type how much a unit carried (boxes on a pallet or in a bin) and its tag / bin number */
function QtyDialog({ title, unit, refLabel, initial, onClose, onPick }: { title: string; unit: string; refLabel: string; initial: number | null; onClose: () => void; onPick: (q: number, ref: string) => void }) {
  const [v, setV] = useState(initial != null ? String(initial) : '')
  const [ref, setRef] = useState('')
  const n = Number(v)
  const ok = v.trim() !== '' && Number.isFinite(n) && n >= 0
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <form onSubmit={(e) => { e.preventDefault(); if (ok) onPick(n, ref.trim()) }} className="qform">
          <label>{unit} <input autoFocus inputMode="numeric" placeholder={unit} value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} /></label>
          {refLabel && <label>{refLabel} <small>(opcional)</small> <input inputMode="numeric" placeholder="ej. 1749" value={ref} onChange={(e) => setRef(e.target.value)} autoComplete="off" /></label>}
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
  const [resetting, setResetting] = useState(false)
  const [clearing, setClearing] = useState(false)
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
    const head = ['Departamento', 'Línea', 'Código', 'Lote', 'Fecha', 'Inicio', 'Fin', 'Hecho', 'Cantidad', 'Tags / bins', 'Tiempo trabajando', 'Promedio por unidad', 'Tiempo parado', 'Razones de paro', 'Registró']
    const body = rows.map((x) => [x.r.dept, x.r.line, x.r.code, x.r.lot, x.r.date, fmtTime(x.r.startedAt), x.r.endedAt ? fmtTime(x.r.endedAt) : 'en curso', x.r.units.length + ' ' + CFG[x.r.dept].plural.toLowerCase(), CFG[x.r.dept].qty !== 'none' ? x.st.qty + ' ' + CFG[x.r.dept].qtyUnit : '', x.r.units.map((u) => u.ref).filter(Boolean).join(', '), fmtDur(x.st.working), x.r.units.length ? fmtDur(x.st.avg) : '', fmtDur(x.st.down), reasonsText(x), x.r.by])
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
                <td>{madeText(x.r, x.st.qty, true)}</td><td>{fmtDur(x.st.working)}</td><td>{x.r.units.length ? fmtDur(x.st.avg) : '—'}</td><td className={x.st.down ? 'red' : ''}>{fmtDur(x.st.down)}</td><td>{reasonsText(x) || '—'}</td><td>{x.r.by}</td>
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
      <div className="btns">
        <button type="button" className="lnk" onClick={() => setClearing(true)}>Reiniciar registros (conserva productos y líneas)</button>
        <button type="button" className="lnk" onClick={() => setResetting(true)}>Borrar todo</button>
      </div>
      {clearing && <ConfirmDialog title="¿Reiniciar los registros?" text="Se borran las corridas, los paros y lo programado de todos los días. La tabla de productos y las líneas se quedan. No se puede deshacer." yes="Reiniciar" danger onYes={() => { resetRecords(); setClearing(false) }} onNo={() => setClearing(false)} />}
      {resetting && <ConfirmDialog title="¿Borrar todos los datos de este dispositivo?" text="Se borran las líneas, los registros, los paros, lo programado y la tabla de productos. No se puede deshacer." yes="Borrar todo" danger onYes={() => { reset(); setResetting(false) }} onNo={() => setResetting(false)} />}
    </section>
  )
}
