import { useEffect, useState, useSyncExternalStore } from 'react'
import { activeBetween, addLine, addWaste, CFG, CRATES_PER_CART, dayOf, DEPTS, deptStop, endRun, endStop, fmtDur, fmtTime, lastPerUnit, lotFor, madeText, managerPin, mergeProducts, myDept, openRun, openStop, parseProductsCsv, productOf, productsCsv, removeLine, removeProduct, reset, resetRecords, role, runStats, saveProduct, setSchedule, startRun, startStop, stopsOf, store, today, unitDone, user, type Dept, type Line, type Product, type State } from './store'
import { avanceRows, n1, pending, type AvanceRow } from './avance'
import { whoText } from './store'
import { buildPdf, loadPdf } from './pdf'
import { RunEditor, StopEditor } from './editors'
import { fetchMe, loginEmail, supabase, type Me } from './supabase'
import { startSync, syncStore, flushNow, pullAll } from './sync'
import { uploadAll } from './store'
import { Employees } from './Employees'

/** a clock that ticks every second, so every timer on screen moves */
function useNow() {
  const [n, setN] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setN(Date.now()), 1000); return () => clearInterval(t) }, [])
  return n
}

const isDept = (v: string): v is Dept => (DEPTS as string[]).includes(v)

export default function App() {
  return supabase ? <ServerApp /> : <DemoApp />
}

/** with a server: the same people and PINs as Freezer RTE; the role and department come from the employees table */
function ServerApp() {
  const [me, setMe] = useState<Me | null | 'none' | 'loading'>('loading')
  const [err, setErr] = useState('')
  const load = async () => {
    try { setMe(await fetchMe()); setErr('') } catch (e) { setMe(null); setErr(String((e as Error).message ?? e)) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (me && me !== 'none' && me !== 'loading') { user.set(me.name); role.set(me.role === 'op' ? 'op' : 'mgr'); myDept.set(me.dept); startSync() }
  }, [me])
  const out = async () => { await supabase!.auth.signOut(); user.set(''); setMe(null) }
  if (me === 'loading') return <div className="gate"><h1>Actividad</h1><p>Entrando…</p></div>
  if (me === null) return <LoginGate error={err} onDone={load} />
  if (me === 'none') return <NoRole onOut={out} onRetry={load} />
  const home = isDept(me.dept) ? me.dept : DEPTS[0]
  if (me.role === 'op' && !isDept(me.dept)) return <NoRole onOut={out} onRetry={load} text={'Tu usuario está en Actividad pero sin departamento. Pide al manager que te asigne uno.'} />
  return <Main name={me.name} home={home} mgr={me.role !== 'op'} onLogout={() => void out()} />
}

function LoginGate({ error, onDone }: { error: string; onDone: () => Promise<void> }) {
  const [u, setU] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(error)
  const go = async () => {
    setBusy(true); setMsg('')
    const { error: e } = await supabase!.auth.signInWithPassword({ email: loginEmail(u), password: pin })
    setBusy(false)
    if (e) { setMsg(/invalid/i.test(e.message) ? 'Usuario o PIN incorrectos.' : /fetch|network/i.test(e.message) ? 'Sin conexión. Revisa el WiFi e intenta otra vez.' : e.message); return }
    await onDone()
  }
  return (
    <div className="gate">
      <h1>Actividad</h1>
      <p>Entra con tu usuario y PIN (los mismos de Freezer RTE).</p>
      <form onSubmit={(e) => { e.preventDefault(); if (u.trim() && pin) void go() }}>
        <input autoFocus placeholder="Usuario (o tu correo)" autoCapitalize="none" autoCorrect="off" autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} />
        <input type="password" inputMode="numeric" placeholder="PIN" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} />
        {msg && <span className="err">{msg}</span>}
        <button className="btn primary" type="submit" disabled={busy || !u.trim() || !pin}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
      <small>Cada registro lleva el nombre de quien entró. Si no tienes usuario, pídelo al manager.</small>
    </div>
  )
}

function NoRole({ onOut, onRetry, text }: { onOut: () => void; onRetry: () => void; text?: string }) {
  return (
    <div className="gate">
      <h1>Actividad</h1>
      <p>{text ?? 'Tu usuario existe, pero todavía no tiene acceso a Actividad. Pide al manager que te lo active.'}</p>
      <div className="btns"><button type="button" className="btn" onClick={onRetry}>Reintentar</button><button type="button" className="lnk" onClick={onOut}>Cerrar sesión</button></div>
    </div>
  )
}

/** the dot next to the name: in step with the server, something waiting to go up, or no signal */
function SyncDot() {
  const st = useSyncExternalStore(syncStore.subscribe, syncStore.get)
  if (st.state === 'local') return null
  const text = st.pending ? 'Pendiente ' + st.pending : st.state === 'offline' ? 'Sin conexión' : st.state === 'signedOut' ? 'Sin sesión' : st.state === 'connecting' ? 'Conectando…' : 'Sincronizado'
  const cls = st.pending || st.state === 'offline' ? 'amber' : st.state === 'online' ? 'ok' : ''
  return <button type="button" className={'syncdot ' + cls} title={st.lastError || text} onClick={() => { void pullAll(); void flushNow() }}>● {text}{st.lastError && st.lastError !== 'signedOut' && <small className="syncerr"> · {st.lastError.slice(0, 140)}</small>}</button>
}

/** without a server (the public demo): a department and a name, or the manager with a code */
function DemoApp() {
  const [name, setName] = useState(user.get())
  const [dept, setDept] = useState(myDept.get())
  const [who, setWho] = useState(role.get())
  const mgr = who === 'mgr'
  const out = () => { user.set(''); myDept.set(''); role.set(''); setName(''); setDept(''); setWho('') }
  if (!(mgr || isDept(dept)) || !name) {
    return <Gate dept={isDept(dept) ? dept : null} mgr={mgr} onDept={(d) => { myDept.set(d); role.set('op'); setDept(d); setWho('op') }} onManager={() => { role.set('mgr'); myDept.set(''); setWho('mgr'); setDept('') }} onName={(n) => { user.set(n); setName(n) }} onBack={out} />
  }
  return <Main name={name} home={isDept(dept) ? dept : DEPTS[0]} mgr={mgr} onLogout={out} />
}

/** entering: a supervisor or operator picks their department (and sees only that); the manager enters with a code and sees every room */
function Gate({ dept, mgr, onDept, onManager, onName, onBack }: { dept: Dept | null; mgr: boolean; onDept: (d: Dept) => void; onManager: () => void; onName: (n: string) => void; onBack: () => void }) {
  const [v, setV] = useState('')
  const [pin, setPin] = useState('')
  const [asking, setAsking] = useState(false)
  const [bad, setBad] = useState(false)
  if (!dept && !mgr) {
    return (
      <div className="gate">
        <h1>Actividad</h1>
        <p>¿De qué departamento eres?</p>
        <div className="pick">{DEPTS.map((d) => <button key={d} type="button" className="btn" onClick={() => onDept(d)}>{d}</button>)}</div>
        {asking ? (
          <form onSubmit={(e) => { e.preventDefault(); if (pin === managerPin.get()) onManager(); else { setBad(true); setPin('') } }} className="mgrform">
            <label>Código de manager <input autoFocus type="password" inputMode="numeric" placeholder="código" value={pin} onChange={(e) => { setPin(e.target.value); setBad(false) }} autoComplete="off" /></label>
            {bad && <span className="err">Código incorrecto.</span>}
            <div className="dbtns"><button type="button" className="btn" onClick={() => { setAsking(false); setPin(''); setBad(false) }}>Cancelar</button><button type="submit" className="btn primary" disabled={!pin}>Entrar como manager</button></div>
          </form>
        ) : <button type="button" className="lnk" onClick={() => setAsking(true)}>Soy el manager / oficina (todos los departamentos)</button>}
        <small>Demo · los datos se guardan solo en este dispositivo</small>
      </div>
    )
  }
  return (
    <div className="gate">
      <h1>Actividad</h1>
      <p><b>{mgr ? 'Manager' : dept}</b> · Ahora escribe tu nombre. Todo lo que registres lleva tu nombre.</p>
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) onName(v.trim()) }}>
        <input autoFocus placeholder="Tu nombre" value={v} onChange={(e) => setV(e.target.value)} />
        <button className="btn primary" type="submit" disabled={!v.trim()}>Entrar</button>
      </form>
      <button type="button" className="lnk" onClick={onBack}>Volver</button>
      <small>Demo · los datos se guardan solo en este dispositivo</small>
    </div>
  )
}

function Main({ name, home, mgr, onLogout }: { name: string; home: Dept; mgr: boolean; onLogout: () => void }) {
  const s = useSyncExternalStore(store.subscribe, store.get)
  const now = useNow()
  const [dept, setDept] = useState<Dept>(home)
  const [tab, setTab] = useState<'act' | 'av' | 'rep' | 'emp'>('act')
  return (
    <div className="app">
      <header className="top">
        <div className="brand"><h1>Actividad</h1><small>{new Date(now).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}</small></div>
        <nav className="tabs">
          <button type="button" className={tab === 'act' ? 'on' : ''} onClick={() => setTab('act')}>Actividad</button>
          {mgr && <button type="button" className={tab === 'av' ? 'on' : ''} onClick={() => setTab('av')}>Avance</button>}
          <button type="button" className={tab === 'rep' ? 'on' : ''} onClick={() => setTab('rep')}>Reporte</button>
          {mgr && supabase && <button type="button" className={tab === 'emp' ? 'on' : ''} onClick={() => setTab('emp')}>Empleados</button>}
        </nav>
        <div className="me"><SyncDot /> {name} · {mgr ? 'Manager' : home} <button type="button" className="lnk" onClick={onLogout}>{supabase ? 'Salir' : 'Cambiar'}</button></div>
      </header>
      {tab === 'act' ? (
        <div className="main">
          {/* the manager moves between rooms; a supervisor or operator only has their own */}
          {mgr && (
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
          )}
          <DeptPanel key={dept} s={s} dept={mgr ? dept : home} now={now} mgr={mgr} />
        </div>
      ) : tab === 'av' && mgr ? <Avance s={s} /> : tab === 'emp' && mgr && supabase ? <Employees /> : <Report s={s} now={now} only={mgr ? undefined : home} mgr={mgr} />}
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
      <p className="hint"><b>Progr.</b> = lo que da el programa del día (mezclas programadas × tabla de productos). <b>Esper.</b> = lo que ya puede salir de las mezclas que Kitchen lleva hechas. <b>Pend.</b> = esperado − hecho (rojo = se hizo de más). <b>Faltan</b> = programado − hecho: lo que queda del día.</p>
      {editing && <Products s={s} />}
      {rows.length === 0 ? <p className="hint">Nada programado ni registrado en esta fecha. Escribe un código y toca "Programar".</p> : (
        <div className="twrap">
          <table>
            <thead>
              <tr><th rowSpan={2}>Código</th><th rowSpan={2}>Producto</th><th colSpan={3} className="grp g1">Mezclas (Kitchen)</th><th rowSpan={2} className="gs">Spiral</th><th colSpan={5} className="grp g2">Pouches (RTE)</th><th colSpan={5} className="grp g3">Cajas (Packing)</th><th rowSpan={2} className="gs">MFO cajas</th><th colSpan={3} className="grp g4">Pallets</th><th rowSpan={2} className="gs">Waste lb</th></tr>
              <tr><th className="g1 gs">Progr.</th><th className="g1">Hechas</th><th className="g1">Pend.</th><th className="g2 gs">Progr.</th><th className="g2">Esper.</th><th className="g2">Hechos</th><th className="g2">Pend.</th><th className="g2">Faltan</th><th className="g3 gs">Progr.</th><th className="g3">Esper.</th><th className="g3">Hechas</th><th className="g3">Pend.</th><th className="g3">Faltan</th><th className="g4 gs">Progr.</th><th className="g4">Esper.</th><th className="g4">Hechos</th></tr>
            </thead>
            <tbody>{rows.map((r) => (
              <tr key={r.code}>
                <td><b>{r.code}</b></td><td>{r.product?.name ?? <i className="red">no está en Productos</i>}</td>
                <td><input className="num" inputMode="numeric" value={r.scheduled || ''} placeholder="0" onChange={(e) => setSchedule(date, r.code, Number(e.target.value.replace(/\D/g, '')) || 0)} /></td>
                <td>{r.mixesDone}</td><td className={r.mixesPending ? 'amber' : 'ok'}>{r.mixesPending}</td>
                <td>{r.spiralDone}</td>
                <td>{n1(r.pouchesPlan)}</td><td>{n1(r.pouchesExp)}</td><td>{r.pouchesDone}</td><td className={cls(pending(r.pouchesExp, r.pouchesDone))}>{n1(pending(r.pouchesExp, r.pouchesDone))}</td><td className={cls(pending(r.pouchesPlan, r.pouchesDone))}>{n1(pending(r.pouchesPlan, r.pouchesDone))}</td>
                <td>{n1(r.casesPlan)}</td><td>{n1(r.casesExp)}</td><td>{r.casesDone}</td><td className={cls(pending(r.casesExp, r.casesDone))}>{n1(pending(r.casesExp, r.casesDone))}</td><td className={cls(pending(r.casesPlan, r.casesDone))}>{n1(pending(r.casesPlan, r.casesDone))}</td>
                <td>{r.mfoCases}</td>
                <td>{n1(r.palletsPlan)}</td><td>{n1(r.palletsExp)}</td><td>{r.palletsDone}</td>
                <td className={r.wasteLb ? 'red' : ''}>{r.wasteLb || '—'}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={2}>Total</td><td>{sum((r) => r.scheduled)}</td><td>{sum((r) => r.mixesDone)}</td><td>{sum((r) => r.mixesPending)}</td><td>{sum((r) => r.spiralDone)}</td><td>{n1(sum((r) => r.pouchesPlan))}</td><td>{n1(sum((r) => r.pouchesExp))}</td><td>{sum((r) => r.pouchesDone)}</td><td></td><td></td><td>{n1(sum((r) => r.casesPlan))}</td><td>{n1(sum((r) => r.casesExp))}</td><td>{sum((r) => r.casesDone)}</td><td></td><td></td><td>{sum((r) => r.mfoCases)}</td><td>{n1(sum((r) => r.palletsPlan))}</td><td>{n1(sum((r) => r.palletsExp))}</td><td>{sum((r) => r.palletsDone)}</td><td>{n1(Math.round(sum((r) => r.wasteLb) * 100) / 100)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </section>
  )
}

/** the master table: read-only until "Editar", so a stray tap on a tablet cannot change a yield; every change saves itself */
function Products({ s }: { s: State }) {
  const num = (v: string) => Number(v.replace(',', '.')) || 0
  const upd = (i: number, p: Product, patch: Partial<Product>) => saveProduct(i, { ...p, ...patch })
  const [unlocked, setUnlocked] = useState(false)
  const [removeIdx, setRemoveIdx] = useState<number | null>(null)
  const [notice, setNotice] = useState<{ title: string; text?: string } | null>(null)
  const show = (v: number) => (v ? String(v) : '—')
  const exportCsv = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([productsCsv(s.products)], { type: 'text/csv;charset=utf-8' })); a.download = 'productos.csv'; a.click() }
  return (
    <div className={'products' + (unlocked ? ' editing' : '')}>
      {removeIdx != null && <ConfirmDialog title={'¿Quitar ' + (s.products[removeIdx]?.code || 'este producto') + ' de la tabla?'} yes="Quitar" danger onYes={() => { removeProduct(removeIdx); setRemoveIdx(null) }} onNo={() => setRemoveIdx(null)} />}
      {notice && <NoticeDialog title={notice.title} text={notice.text} onClose={() => setNotice(null)} />}
      <div className="phead">
        <h3>{unlocked ? '✎ Editando productos' : '🔒 Productos · la tabla maestra de la oficina'}</h3>
        <button type="button" className={'btn' + (unlocked ? ' primary' : '')} onClick={() => setUnlocked(!unlocked)}>{unlocked ? '✓ Listo, bloquear' : '✎ Editar'}</button>
      </div>
      <div className="twrap">
        <table>
          <thead><tr><th>Código</th><th>Producto</th><th>Pouches / caja</th><th>Cajas / mezcla (yield)</th><th>Guacales / carro</th><th>Pouches / guacal</th><th>Cajas / pallet</th>{unlocked && <th></th>}</tr></thead>
          <tbody>
            {s.products.length === 0 && <tr><td colSpan={8}><i>No hay productos todavía.{!unlocked && ' Toca "Editar" para escribirlos o importar el CSV de la oficina.'}</i></td></tr>}
            {s.products.map((p, i) => unlocked ? (
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
            ) : (
              <tr key={p.code + ':' + i}>
                <td><b className="mono">{p.code}</b></td><td>{p.name}</td>
                <td className="r">{show(p.pouchesPerCase)}</td><td className="r">{show(p.casesPerMix)}</td><td className="r">{show(p.cratesPerCart)}</td><td className="r">{show(p.pouchesPerCrate)}</td><td className="r">{show(p.casesPerPallet)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="btns">
        {unlocked && <button type="button" className="btn" onClick={() => saveProduct(s.products.length, { code: '', name: '', pouchesPerCase: 0, casesPerMix: 0, cratesPerCart: CRATES_PER_CART, pouchesPerCrate: 0, casesPerPallet: 0, updatedAt: 0 })}>+ Agregar producto</button>}
        {unlocked && <label className="btn file">⬆ Importar CSV de la oficina
          <input type="file" accept=".csv,text/csv" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (!f) return
            const list = parseProductsCsv(await f.text())
            if (!list.length) { setNotice({ title: 'No encontré productos en ese archivo', text: 'Debe tener una columna "Código" y una fila por producto.' }); return }
            mergeProducts(list); setNotice({ title: list.length + ' productos cargados', text: 'Los códigos que ya existían se actualizaron; los nuevos se agregaron.' })
          }} />
        </label>}
        <button type="button" className="btn" onClick={exportCsv}>⬇ Exportar CSV</button>
      </div>
      <p className="hint">{unlocked
        ? 'Cada cambio se guarda solo al salir de la casilla' + (supabase ? ' y baja a todas las tablets' : '') + '. Columnas del CSV de la oficina: Código, Producto, Pouches por caja, Cajas por mezcla, Cajas por pallet, Guacales por carro, Pouches por guacal.'
        : supabase ? 'Con estos números se calculan el Avance y los pouches por carro en todas las tablets. Para cambiar algo, toca "Editar".' : 'Los productos de ejemplo son inventados; todo se guarda solo en este dispositivo. Para cambiar algo, toca "Editar".'}</p>
    </div>
  )
}

function DeptPanel({ s, dept, now, mgr }: { s: State; dept: Dept; now: number; mgr: boolean }) {
  const lines = s.lines.filter((l) => l.dept === dept)
  const ds = deptStop(s, dept)
  const [stopAll, setStopAll] = useState(false)
  const [editRun, setEditRun] = useState<string | null>(null)
  const [editStop, setEditStop] = useState(false)
  const editing = editRun ? s.runs.find((r) => r.id === editRun) : undefined
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
      {ds && <div className="deptstop">⏸ Todo {dept} parado · <b>{ds.reason}</b>{ds.note && ' · ' + ds.note} · desde {fmtTime(ds.startedAt)} · {ds.by} <button type="button" className="lnk" onClick={() => setEditStop(true)}>Corregir</button></div>}
      {editStop && ds && <StopEditor stop={ds} mgr={mgr} onClose={() => setEditStop(false)} />}
      <div className="lines">{lines.map((l) => <LineCard key={l.id} s={s} line={l} now={now} mgr={mgr} />)}</div>
      {lines.length === 0 && <p className="hint">Este departamento no tiene líneas. Toca "Agregar línea".</p>}
      {doneToday.length > 0 && (
        <div className="done">
          <h3>Terminados hoy en {dept}</h3>
          {doneToday.map((r) => {
            const st = runStats(s, r, now)
            return (
              <div key={r.id} className="donerow">
                <b className="code">{r.code}</b> · lote {r.lot} · {r.line} · {fmtTime(r.startedAt)} – {fmtTime(r.endedAt ?? now)} · <b>{madeText(r, st.qty)}</b> · trabajando <b>{fmtDur(st.working)}</b> · parado <b className={st.down ? 'red' : ''}>{fmtDur(st.down)}</b>{r.waste > 0 && <> · waste <b className="red">{r.waste} lb</b></>} · {whoText(r)} <button type="button" className="lnk" onClick={() => setEditRun(r.id)}>Corregir</button>
              </div>
            )
          })}
        </div>
      )}
      {editing && <RunEditor s={s} run={editing} mgr={mgr} onClose={() => setEditRun(null)} />}
      {stopAll && <StopDialog title={'Parar todo ' + dept} reasons={CFG[dept].reasons} onClose={() => setStopAll(false)} onPick={(reason, note) => { startStop(dept, null, reason, note); setStopAll(false) }} />}
    </section>
  )
}

function LineCard({ s, line, now, mgr }: { s: State; line: Line; now: number; mgr: boolean }) {
  const cfg = CFG[line.dept]
  const run = openRun(s, line.id)
  const stop = run ? openStop(s, line.dept, line.id) : undefined
  const [fixing, setFixing] = useState(false)
  const [fixingStop, setFixingStop] = useState(false)
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
  const [wasting, setWasting] = useState(false)
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
        <span className="meta"><b className="code">{run.code}</b> · lote {run.lot} · {run.date} · desde {fmtTime(run.startedAt)}{run.perUnit != null && ' · ' + run.perUnit + ' ' + cfg.qtyUnit + ' por ' + cfg.unit.toLowerCase()} <button type="button" className="lnk" onClick={() => setFixing(true)}>Corregir</button></span>
      </div>
      {stop && <div className="stopbar">⏸ Parado · <b>{stop.reason}</b>{stop.note && ' · ' + stop.note} · <b>{fmtDur(now - stop.startedAt)}</b>{stop.lineId === null && ' · todo el departamento'}{stop.lineId === line.id && <button type="button" className="lnk" onClick={() => setFixingStop(true)}>Corregir</button>}</div>}
      {fixing && <RunEditor s={s} run={run} mgr={mgr} onClose={() => setFixing(false)} />}
      {fixingStop && stop && <StopEditor stop={stop} mgr={mgr} onClose={() => setFixingStop(false)} />}
      <div className="stats">
        <div className="stat big"><label>Trabajando</label><b>{fmtDur(st.working)}</b></div>
        <div className="stat"><label>{cfg.plural}</label><b>{run.units.length}</b></div>
        {cfg.qty !== 'none' && <div className="stat"><label>{cfg.qtyUnit}</label><b>{st.qty}</b></div>}
        <div className="stat"><label>{cfg.unit} actual</label><b>{fmtDur(current)}</b></div>
        <div className="stat"><label>Promedio / {cfg.unit.toLowerCase()}</label><b>{run.units.length ? fmtDur(st.avg) : '—'}</b></div>
        <div className="stat"><label>Parado</label><b className={st.down ? 'red' : ''}>{fmtDur(st.down)}</b></div>
        {cfg.waste && <div className="stat"><label>Waste</label><b className={run.waste ? 'red' : ''}>{run.waste} lb</b></div>}
      </div>
      <div className="btns">
        <button type="button" className="btn primary huge" disabled={!!stop} onClick={done}>✓ {cfg.done}</button>
        {cfg.waste && <button type="button" className="btn" onClick={() => setWasting(true)}>Waste (lb)</button>}
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
      {wasting && <QtyDialog title={'Waste de ' + run.code + ' · ¿cuántas libras?'} unit="lb" refLabel="" initial={null} decimal onClose={() => setWasting(false)} onPick={(lb) => { if (lb > 0) addWaste(run.id, lb); setWasting(false) }} />}
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
export function ConfirmDialog({ title, text, yes, danger, onYes, onNo }: { title: string; text?: string; yes: string; danger?: boolean; onYes: () => void; onNo: () => void }) {
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
function QtyDialog({ title, unit, refLabel, initial, decimal, onClose, onPick }: { title: string; unit: string; refLabel: string; initial: number | null; decimal?: boolean; onClose: () => void; onPick: (q: number, ref: string) => void }) {
  const [v, setV] = useState(initial != null ? String(initial) : '')
  const [ref, setRef] = useState('')
  const n = Number(v.replace(',', '.'))
  const ok = v.trim() !== '' && Number.isFinite(n) && n >= 0
  const clean = (t: string) => (decimal ? t.replace(/[^\d.,]/g, '').replace(/([.,].*)[.,]/, '$1') : t.replace(/\D/g, ''))
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <form onSubmit={(e) => { e.preventDefault(); if (ok) onPick(n, ref.trim()) }} className="qform">
          <label>{unit} <input autoFocus inputMode={decimal ? 'decimal' : 'numeric'} placeholder={unit} value={v} onChange={(e) => setV(clean(e.target.value))} /></label>
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

function Report({ s, now, only, mgr }: { s: State; now: number; only?: Dept; mgr: boolean }) {
  const [date, setDate] = useState(today())
  const [resetting, setResetting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)
  const [newPin, setNewPin] = useState('')
  const [editRun, setEditRun] = useState<string | null>(null)
  const [editStop, setEditStop] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState<{ title: string; text?: string } | null>(null)
  const runToEdit = editRun ? s.runs.find((r) => r.id === editRun) : undefined
  const stopToEdit = editStop ? s.stops.find((x) => x.id === editStop) : undefined
  useEffect(() => { void loadPdf() }, [])
  /** opens the PDF in a new tab (to look at, share or print); if the tab cannot open, it downloads */
  const pdf = async () => {
    const name = 'actividad-' + (only ? only.toLowerCase() + '-' : '') + date + '.pdf'
    let doc = buildPdf(s, date, now, user.get(), only)
    if (!doc) { await loadPdf(); doc = buildPdf(s, date, now, user.get(), only); doc?.save(name); return }
    const win = window.open(doc.output('bloburl'), '_blank')
    if (!win) doc.save(name)
  }
  // (the "send" below builds the same PDF plus the CSV and hands them to the share sheet)
  const runs = s.runs.filter((r) => r.date === date && (!only || r.dept === only)).sort((a, b) => a.startedAt - b.startedAt)
  const stops = s.stops.filter((x) => dayOf(x.startedAt) === date && (!only || x.dept === only)).sort((a, b) => a.startedAt - b.startedAt)
  const rows = runs.map((r) => ({ r, st: runStats(s, r, now) }))
  // one line per cart, mezcla, bin or pallet, the way the office's sheets are filled (pallet by pallet, with the time)
  const unitRows = rows.flatMap((x) => x.r.units.map((u, i) => ({ r: x.r, i, u, gap: x.st.unitTimes[i] ?? 0 }))).sort((a, b) => a.u.at - b.u.at)
  const working = rows.reduce((t, x) => t + x.st.working, 0)
  const down = rows.reduce((t, x) => t + x.st.down, 0)
  const reasonsText = (x: (typeof rows)[number]) => Object.entries(x.st.reasons).map(([k, v]) => k + ' ' + fmtDur(v)).join(', ')
  const lineName = (x: { lineId: string | null; dept: Dept }) => (x.lineId === null ? 'Todo ' + x.dept : s.lines.find((l) => l.id === x.lineId)?.name ?? s.runs.find((r) => r.lineId === x.lineId)?.line ?? 'línea')
  const fileName = 'actividad-' + (only ? only.toLowerCase() + '-' : '') + date
  // the history of that day (corrections, products, program, lines): the manager's and the office's
  const changes = mgr ? s.changes.filter((c) => !c.deleted && dayOf(c.at) === date && (!only || c.dept === only)).sort((a, b) => a.at - b.at) : []
  /** the report as a PDF file and a CSV file, handed to the device's share sheet (Mail, Outlook, WhatsApp…);
   *  on a PC without one, the files download and the mail opens with the subject ready */
  const send = async () => {
    const files: File[] = []
    const doc = buildPdf(s, date, now, user.get(), only)
    if (doc) files.push(new File([doc.output('blob')], fileName + '.pdf', { type: 'application/pdf' }))
    files.push(new File([csvText()], fileName + '.csv', { type: 'text/csv' }))
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
    if (nav.share && nav.canShare?.({ files })) {
      try { await nav.share({ files, title: 'Actividad · Reporte ' + date, text: 'Reporte del día ' + date + (only ? ' · ' + only : '') }) } catch { /* the person closed the sheet */ }
      return
    }
    for (const f of files) { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click() }
    location.href = 'mailto:?subject=' + encodeURIComponent('Actividad · Reporte ' + date + (only ? ' · ' + only : '')) + '&body=' + encodeURIComponent('Adjunto el reporte del día (PDF y Excel), recién descargados en la carpeta de Descargas.')
  }
  const csv = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csvText()], { type: 'text/csv;charset=utf-8' }))
    a.download = fileName + '.csv'
    a.click()
  }
  const csvText = () => {
    const q = (v: string | number) => '"' + String(v).replace(/"/g, '""') + '"'
    const head = ['Departamento', 'Línea', 'Código', 'Lote', 'Fecha', 'Inicio', 'Fin', 'Hecho', 'Cantidad', 'Tags / bins', 'Waste (lb)', 'Tiempo trabajando', 'Promedio por unidad', 'Tiempo parado', 'Razones de paro', 'Registró']
    const body = rows.map((x) => [x.r.dept, x.r.line, x.r.code, x.r.lot, x.r.date, fmtTime(x.r.startedAt), x.r.endedAt ? fmtTime(x.r.endedAt) : 'en curso', x.r.units.length + ' ' + CFG[x.r.dept].plural.toLowerCase(), CFG[x.r.dept].qty !== 'none' ? x.st.qty + ' ' + CFG[x.r.dept].qtyUnit : '', x.r.units.map((u) => u.ref).filter(Boolean).join(', '), x.r.waste || '', fmtDur(x.st.working), x.r.units.length ? fmtDur(x.st.avg) : '', fmtDur(x.st.down), reasonsText(x), whoText(x.r)])
    const unitHead = ['', 'UNIDADES', 'Departamento', 'Línea', 'Código', 'Lote', '#', 'Hora', 'Unidad', 'Cantidad', 'Tag / bin', 'Desde la anterior', 'Registró']
    const unitBody = unitRows.map((x) => ['', '', x.r.dept, x.r.line, x.r.code, x.r.lot, x.i + 1, fmtTime(x.u.at), CFG[x.r.dept].unit, x.u.qty != null ? x.u.qty + ' ' + CFG[x.r.dept].qtyUnit : '', x.u.ref, fmtDur(x.gap), x.u.by])
    const stopHead = ['', 'PAROS', 'Departamento', 'Línea', 'Razón', 'Detalle', 'Inicio', 'Fin', 'Duración', 'Registró']
    const stopBody = stops.map((x) => ['', '', x.dept, lineName(x), x.reason, x.note, fmtTime(x.startedAt), x.endedAt ? fmtTime(x.endedAt) : 'en curso', fmtDur((x.endedAt ?? now) - x.startedAt), x.by])
    const chHead = ['', 'CAMBIOS', 'Hora', 'Quién', 'Departamento', 'Qué', 'Antes', 'Después']
    const chBody = changes.map((c) => ['', '', fmtTime(c.at), c.by, c.dept ?? '', c.what, c.before, c.after])
    return '﻿' + [head, ...body, [], unitHead, ...unitBody, [], stopHead, ...stopBody, ...(mgr ? [[], chHead, ...chBody] : [])].map((r) => r.map(q).join(',')).join('\r\n')
  }
  return (
    <section className="report">
      <div className="rhead">
        <h2>Reporte del día{only ? ' · ' + only : ''}</h2>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button type="button" className="btn" onClick={csv} disabled={!rows.length}>⬇ Excel (CSV)</button>
        <button type="button" className="btn" onClick={() => void pdf()} disabled={!rows.length}>📄 Ver PDF / imprimir</button>
        <button type="button" className="btn primary" onClick={() => void send()} disabled={!rows.length}>✉ Enviar reporte</button>
      </div>
      <div className="totals">
        <div className="stat"><label>Códigos</label><b>{rows.length}</b></div>
        <div className="stat"><label>Trabajando</label><b>{fmtDur(working)}</b></div>
        <div className="stat"><label>Parado</label><b className={down ? 'red' : ''}>{fmtDur(down)}</b></div>
      </div>
      {rows.length === 0 ? <p className="hint">Nada registrado en esta fecha.</p> : (
        <div className="twrap">
          <table>
            <thead><tr><th>Depto</th><th>Línea</th><th>Código</th><th>Lote</th><th>Inicio</th><th>Fin</th><th>Hecho</th><th>Waste</th><th>Trabajando</th><th>Prom./unidad</th><th>Parado</th><th>Razones</th><th>Registró</th><th></th></tr></thead>
            <tbody>{rows.map((x) => (
              <tr key={x.r.id} className={x.r.endedAt ? '' : 'live'}>
                <td>{x.r.dept}</td><td>{x.r.line}</td><td><b>{x.r.code}</b></td><td>{x.r.lot}</td><td>{fmtTime(x.r.startedAt)}</td><td>{x.r.endedAt ? fmtTime(x.r.endedAt) : <i>en curso</i>}</td>
                <td>{madeText(x.r, x.st.qty, true)}</td><td className={x.r.waste ? 'red' : ''}>{x.r.waste ? x.r.waste + ' lb' : '—'}</td><td>{fmtDur(x.st.working)}</td><td>{x.r.units.length ? fmtDur(x.st.avg) : '—'}</td><td className={x.st.down ? 'red' : ''}>{fmtDur(x.st.down)}</td><td>{reasonsText(x) || '—'}</td><td>{whoText(x.r)}</td>
                <td><button type="button" className="lnk" onClick={() => setEditRun(x.r.id)}>Corregir</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {unitRows.length > 0 && (
        <>
          <h3>Detalle por unidad · {unitRows.length}</h3>
          <div className="twrap">
            <table>
              <thead><tr><th>Hora</th><th>Depto</th><th>Línea</th><th>Código</th><th>Lote</th><th>#</th><th>Unidad</th><th>Cantidad</th><th>Tag / bin</th><th>Desde la anterior</th><th>Registró</th></tr></thead>
              <tbody>{unitRows.map((x) => (
                <tr key={x.r.id + ':' + x.i}>
                  <td>{fmtTime(x.u.at)}</td><td>{x.r.dept}</td><td>{x.r.line}</td><td><b>{x.r.code}</b></td><td>{x.r.lot}</td><td>{x.i + 1}</td><td>{CFG[x.r.dept].unit}</td>
                  <td>{x.u.qty != null ? x.u.qty + ' ' + CFG[x.r.dept].qtyUnit : '—'}</td><td>{x.u.ref || '—'}</td><td>{fmtDur(x.gap)}</td><td>{x.u.by || '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      {stops.length > 0 && (
        <>
          <h3>Paros</h3>
          <div className="twrap">
            <table>
              <thead><tr><th>Depto</th><th>Línea</th><th>Razón</th><th>Detalle</th><th>Inicio</th><th>Fin</th><th>Duración</th><th>Registró</th><th></th></tr></thead>
              <tbody>{stops.map((x) => (
                <tr key={x.id} className={x.endedAt ? '' : 'live'}>
                  <td>{x.dept}</td><td>{lineName(x)}</td><td><b>{x.reason}</b></td><td>{x.note || '—'}</td><td>{fmtTime(x.startedAt)}</td><td>{x.endedAt ? fmtTime(x.endedAt) : <i>en curso</i>}</td><td>{fmtDur((x.endedAt ?? now) - x.startedAt)}</td><td>{x.by}</td>
                  <td><button type="button" className="lnk" onClick={() => setEditStop(x.id)}>Corregir</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      {changes.length > 0 && (
        <>
          <h3>Cambios y correcciones · {changes.length}</h3>
          <div className="twrap">
            <table className="changes">
              <thead><tr><th>Hora</th><th>Quién</th><th>Depto</th><th>Qué</th><th>Antes</th><th>Después</th></tr></thead>
              <tbody>{changes.map((c) => (
                <tr key={c.id}><td>{fmtTime(c.at)}</td><td>{c.by}</td><td>{c.dept ?? '—'}</td><td>{c.what}</td><td className="was">{c.before || '—'}</td><td><b>{c.after || '—'}</b></td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="hint">Cada corrección, cambio en la tabla de productos, en el programa del día o en las líneas queda aquí con quién lo hizo y a qué hora. Lo normal del día (carros, mezclas, paros) no sale aquí: ya lleva el nombre de quien lo registró.</p>
        </>
      )}
      <p className="hint foot">{supabase ? 'Todo se guarda en el servidor y se ve en vivo desde la oficina, el teléfono o la PC.' : 'Demo guardado en este dispositivo. La versión completa manda todo en vivo al manager (oficina, teléfono o PC) y exporta a Excel, PDF y Google Sheets como la Hoja de Freezer RTE.'}</p>
      {runToEdit && <RunEditor s={s} run={runToEdit} mgr={mgr} onClose={() => setEditRun(null)} />}
      {stopToEdit && <StopEditor stop={stopToEdit} mgr={mgr} onClose={() => setEditStop(null)} />}
      {mgr && (
        <div className="btns">
          {!supabase && <button type="button" className="lnk" onClick={() => setClearing(true)}>Reiniciar registros (conserva productos y líneas)</button>}
          <button type="button" className="lnk" onClick={() => setResetting(true)}>{supabase ? 'Limpiar este aparato y volver a bajar del servidor' : 'Borrar todo'}</button>
          {!supabase && <button type="button" className="lnk" onClick={() => { setNewPin(''); setPinOpen(true) }}>Cambiar código de manager</button>}
          {supabase && <button type="button" className="lnk" onClick={() => setUploading(true)}>Subir al servidor los registros de este aparato</button>}
        </div>
      )}
      {uploading && <ConfirmDialog title="¿Subir al servidor todo lo que tiene este aparato?" text="Corridas, paros, líneas, productos y programado de este aparato se mandan al servidor (lo que ya estaba allá se conserva si es más nuevo). Útil una sola vez por tablet, para traer los días del piloto." yes="Subir" onYes={() => { const n = uploadAll(); setUploading(false); setNotice({ title: n + ' registros en cola', text: 'Se envían en cuanto hay señal. El punto junto a tu nombre dice "Sincronizado" cuando terminó.' }) }} onNo={() => setUploading(false)} />}
      {notice && <NoticeDialog title={notice.title} text={notice.text} onClose={() => setNotice(null)} />}
      {pinOpen && (
        <div className="veil" onClick={() => setPinOpen(false)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()}>
            <h3>Código de manager</h3>
            <p>Con este código se entra como manager en este dispositivo (ve todos los departamentos, el Avance y puede borrar datos).</p>
            <form className="qform" onSubmit={(e) => { e.preventDefault(); if (newPin.trim().length >= 4) { managerPin.set(newPin.trim()); setPinOpen(false) } }}>
              <label>Nuevo código (mínimo 4) <input autoFocus inputMode="numeric" value={newPin} onChange={(e) => setNewPin(e.target.value)} autoComplete="off" /></label>
              <div className="dbtns"><button type="button" className="btn" onClick={() => setPinOpen(false)}>Cancelar</button><button type="submit" className="btn primary" disabled={newPin.trim().length < 4}>Guardar</button></div>
            </form>
          </div>
        </div>
      )}
      {clearing && <ConfirmDialog title="¿Reiniciar los registros?" text="Se borran las corridas, los paros y lo programado de todos los días. La tabla de productos y las líneas se quedan. No se puede deshacer." yes="Reiniciar" danger onYes={() => { resetRecords(); setClearing(false) }} onNo={() => setClearing(false)} />}
      {resetting && <ConfirmDialog title={supabase ? '¿Limpiar este aparato?' : '¿Borrar todos los datos de este dispositivo?'} text={supabase ? 'Se vacía lo guardado en este aparato y se vuelve a bajar todo del servidor. Lo que esté en el servidor no se toca; lo que este aparato no haya subido todavía se pierde.' : 'Se borran las líneas, los registros, los paros, lo programado y la tabla de productos. No se puede deshacer.'} yes={supabase ? 'Limpiar y bajar' : 'Borrar todo'} danger onYes={() => { reset(); setResetting(false) }} onNo={() => setResetting(false)} />}
    </section>
  )
}
