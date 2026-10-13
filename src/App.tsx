import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { InputHTMLAttributes, Ref } from 'react'
import { addLine, addWaste, awayDay, byLineName, byShip, casesText, cancelDay, CFG, closeOrder, codeProblem, CRATES_PER_CART, dayRecords, DEPTS, deptStop, deleteOrder, deptToday, dropSetup, endRun, endShift, endStop, fillUnit, fmtDur, fmtTime, freeLineNames, idleStop, inCases, KEEP_DAYS, lastEnded, lastPerUnit, leftOpen, LINE_NAME_MAX, lineNamed, lineNameOf, lineTargetOf, lotFor, madeText, minuteText, managerPin, mergeProducts, myDept, nextOrderFor, nightText, nearDay, normCode, numOf, openIn, openOrdersFor, openRun, openStop, orderCodes, orderLabel, orderMade, parseProductsCsv, plainDay, productOf, productsCsv, purgeDay, removeLine, removeProduct, renameLine, reopenRun, reset, resetRecords, role, runQty, runStats, saveOrder, saveProduct, setLineTarget, setSchedule, setShifts, setTarget, startDay, startRun, startSetup, startStop, stopTime, store, swapLineNames, targetOf, tidyLineName, savedText, shiftAt, shiftCuts, shiftHours, shiftsOf, shiftsProblem, shortEnded, shortUnit, unitDone, user, workDay, workedSince, type Dept, type DeptCfg, type Line, type LineTarget, type Product, type LotPart, type Order, type ShiftHours, type Short, type State, type Target, type WorkDay } from './store'
import { avanceRows, n1, pending, type AvanceRow } from './avance'
import { cellText, loadZip, xDay, xDur, xTime, xlsxNow, XLSX_TYPE, type Cell, type Sheet } from './xlsx'

const fmtN = (x: number) => Math.round(x).toLocaleString('en-US')
import { whoText } from './store'
import { buildPdf, loadPdf } from './pdf'
import { homeScreenApple, sharePick, shareProblem, type Kind } from './send'
import { filterFile, filterTitle, reportOf, spanShifts, type ReportFilter } from './report'
import { canDo, canShift, type Power, type Who } from './powers'
import { RunEditor, StopEditor } from './editors'
import { fetchMe, finishSignOut, loginEmail, rememberedMe, rememberedUser, rememberMe, rememberUser, signedOut, signOutHere, supabase, type Me } from './supabase'
import { leaveAsk, loadDay, startSync, syncStore, syncNow, unreachable } from './sync'
import { storageFull } from './storage'
import { clockNow, clockOffText, otherZone, startClock } from './clock'
import { appUrl, qrPath } from './qr'
import { uploadAll } from './store'
import { Employees } from './Employees'

/** a clock that ticks every second, so every timer on screen moves */
function useNow() {
  const [n, setN] = useState(clockNow())
  useEffect(() => {
    // the tick lands just after each second of the shared clock (see clock.ts), so two screens change at the same moment
    let t: ReturnType<typeof setTimeout>
    const tick = () => { setN(clockNow()); t = setTimeout(tick, 1000 - (clockNow() % 1000) + 8) }
    tick()
    return () => clearTimeout(t)
  }, [])
  return n
}

const isDept = (v: string): v is Dept => (DEPTS as string[]).includes(v)

/** with a server the device keeps the last days; an older one is brought from the server when someone opens it */
function useDay(date: string) {
  const [state, setState] = useState<'here' | 'loading' | 'failed'>('here')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    if (!awayDay(date)) { setState('here'); return }
    let current = true
    setState('loading')
    void loadDay(date).then((ok) => { if (current) setState(ok ? 'here' : 'failed') })
    return () => { current = false }
  }, [date, tries])
  return { state, retry: () => setTries((n) => n + 1) }
}
/**
 * This app's own address as a QR code: another phone or tablet points its camera at it and opens the same app (the
 * demo shows the demo's, the one with a server shows its own), without typing the address.
 */
function QrDialog({ onClose }: { onClose: () => void }) {
  const url = appUrl()
  const [qr, setQr] = useState<{ size: number; d: string } | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => { void qrPath(url).then(setQr).catch(() => setQr(null)) }, [url])
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true) } catch { /* the address is on the screen to be typed */ } }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg qrdlg" onClick={(e) => e.stopPropagation()}>
        <h3>{supabase ? 'Abrir Actividad en otro aparato' : 'Abrir el DEMO en otro aparato'}</h3>
        <p>Apunta la cámara del otro teléfono o tablet a este código y toca el enlace que sale.</p>
        <div className="qrbox">{qr ? <svg viewBox={'0 0 ' + qr.size + ' ' + qr.size} shapeRendering="crispEdges" role="img" aria-label={'Código QR de ' + url}><rect width={qr.size} height={qr.size} fill="#fff" /><path d={qr.d} fill="#000" /></svg> : <span>…</span>}</div>
        <code className="qrurl">{url}</code>
        <div className="btns">
          <button type="button" className="btn" onClick={() => void copy()}>{copied ? '✓ Copiado' : 'Copiar enlace'}</button>
          {'share' in navigator && <button type="button" className="btn" onClick={() => { void navigator.share({ title: document.title, url }).catch(() => undefined) }}>Compartir enlace</button>}
        </div>
        <p className="hint">Para dejarla como app: en Android, los tres puntos de Chrome y "Instalar app" o "Agregar a pantalla principal". En iPhone o iPad, botón Compartir de Safari y "Agregar a inicio". {supabase ? 'La primera vez se entra con usuario y PIN, con WiFi.' : 'Este es el DEMO: lo que se registre queda guardado solo en ese aparato.'}</p>
        <div className="dbtns"><button type="button" className="btn primary" onClick={onClose}>Cerrar</button></div>
      </div>
    </div>
  )
}
/** a link that opens the QR code (on the entry screens, and for the manager beside their name) */
function QrLink({ label }: { label: string }) {
  const [open, setOpen] = useState(false)
  return <><button type="button" className="lnk" onClick={() => setOpen(true)}>{label}</button>{open && <QrDialog onClose={() => setOpen(false)} />}</>
}

/**
 * The name of a line: asked when one is added (which line of the plant is it?) and changed when it was wrong. A name
 * that another line of the room already has can be traded with it in one tap.
 */
function LineNameDialog({ s, dept, line, onClose }: { s: State; dept: Dept; line?: Line; onClose: () => void }) {
  const cfg = CFG[dept], word = cfg.lineWord.toLowerCase()
  const [name, setName] = useState(line ? line.name : freeLineNames(s, dept, 1)[0] ?? '')
  const tidy = tidyLineName(name)
  const taken = tidy ? lineNamed(s, dept, tidy, line?.id) : undefined
  const same = !!line && tidy === line.name
  const others = line ? s.lines.filter((l) => l.dept === dept && l.id !== line.id).sort(byLineName) : []
  const save = () => { if (tidy && !taken && !same && (line ? renameLine(line.id, tidy) : addLine(dept, tidy))) onClose() }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{line ? 'Nombre de ' + line.name : 'Agregar ' + word + ' en ' + dept}</h3>
        <p>{line ? 'El nombre nuevo sale en todo lo registrado en ella: la pantalla, el reporte y los archivos. Los tiempos no cambian.' : '¿Cuál es? Ponle el nombre que tiene en la planta.'}</p>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); save() }}>
          <div className="chips">
            {freeLineNames(s, dept, 4).map((n) => <button key={n} type="button" className={'chip' + (tidy === n ? ' on' : '')} onClick={() => setName(n)}>{n}</button>)}
            {others.map((o) => <button key={o.id} type="button" className={'chip swap' + (taken?.id === o.id ? ' on' : '')} title={'Intercambiar con ' + o.name} onClick={() => setName(o.name)}>⇄ {o.name}</button>)}
          </div>
          <label>Nombre <input value={name} maxLength={LINE_NAME_MAX} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder={'ej. ' + cfg.lineWord + ' 2'} /></label>
          {taken && line && (
            <div className="swapbox">
              <span>Ya hay una <b>{taken.name}</b> en {dept}. Se pueden intercambiar: esta pasa a llamarse <b>{taken.name}</b> y la otra <b>{line.name}</b>.</span>
              <button type="button" className="btn primary" onClick={() => { if (swapLineNames(line.id, taken.id)) onClose() }}>⇄ Intercambiar nombres</button>
            </div>
          )}
          {taken && !line && <span className="err">Ya hay una {taken.name} en {dept}. Elige otro nombre.</span>}
          <div className="dbtns">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn primary" disabled={!tidy || !!taken || same}>{line ? '✓ Guardar' : '+ Agregar'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DayNote({ day }: { day: ReturnType<typeof useDay> }) {
  if (day.state === 'loading') return <p className="daynote">Trayendo ese día del servidor…</p>
  if (day.state === 'failed') return <p className="daynote warn">Este aparato guarda los últimos {KEEP_DAYS} días. Ese día está en el servidor y ahora no se pudo traer (sin señal). <button type="button" className="lnk" onClick={day.retry}>Reintentar</button></p>
  return null
}

export default function App() {
  return supabase ? <ServerApp /> : <DemoApp />
}

/** a device that was signed in before the last person was kept apart: what the app already had of them */
const previousMe = (): Me | null => { const name = user.get(), r = role.get(); return name && (r === 'op' || r === 'mgr') ? { id: '', name, username: '', role: r, dept: myDept.get() } : null }
const NO_SIGNAL = 'Sin conexión con el servidor. La primera vez en este aparato hay que entrar con WiFi.'
/** said when the server itself ended the session of someone who was inside (a manager changed their PIN, the account was closed): never for lack of signal */
const CLOSED = 'La sesión de este aparato se cerró. Pasa, por ejemplo, cuando te cambian el PIN. Entra otra vez.'

/**
 * with a server: the same people and PINs as Freezer RTE; the role and department come from the employees table.
 * Whoever the server confirmed on this device last time comes straight in, with or without signal, and the server is
 * asked again in the background: it can change their role, or send them to the sign-in screen if the account was
 * closed, but a lack of signal never throws anyone out.
 */
function ServerApp() {
  const [me, setMe] = useState<Me | null | 'none' | 'loading'>(() => rememberedMe() ?? previousMe() ?? 'loading')
  const [err, setErr] = useState('')
  const now = useRef(me); now.current = me
  // asking: one question to the server at a time; confirmed: it answered; leaving: "Salir" was tapped and nobody has signed in since
  const asking = useRef(false), confirmed = useRef(0), leaving = useRef(false)
  const verify = useCallback(async () => {
    if (asking.current || leaving.current) return
    asking.current = true
    try {
      const who = await fetchMe()
      if (leaving.current) return
      confirmed.current = Date.now()
      const inside = who && who !== 'none' ? who : null
      const wasIn = !!now.current && now.current !== 'none' && now.current !== 'loading'
      rememberMe(inside)
      if (!inside) user.set('')
      setMe(who); setErr(wasIn && who === null ? CLOSED : '')
    } catch (e) {
      // no signal, or the server did not answer: whoever is in stays in; with nobody remembered, the sign-in screen says why
      confirmed.current = 0
      const text = String((e as Error)?.message ?? e)
      setErr(/fetch|network|load failed/i.test(text) || !navigator.onLine ? NO_SIGNAL : text)
      setMe((cur) => (cur === 'loading' ? null : cur))
    } finally { asking.current = false }
  }, [])
  useEffect(() => {
    startClock() // the shared clock is set while the person signs in, so the first thing they record already carries it
    void finishSignOut().then(verify)
    // with nobody remembered there is nothing to show until the server answers, but not for ever
    const slow = setTimeout(() => { if (now.current === 'loading') { setErr(NO_SIGNAL); setMe(null) } }, 8000)
    const again = () => { void verify() }
    // back on the screen: asked again if the server has not answered yet, or not for the last ten minutes (a role changed, an account closed)
    const seen = () => { if (document.visibilityState === 'visible' && Date.now() - confirmed.current > 600_000) void verify() }
    window.addEventListener('online', again); document.addEventListener('visibilitychange', seen)
    const t = setInterval(() => { if (!confirmed.current) void verify() }, 60_000)
    return () => { clearTimeout(slow); clearInterval(t); window.removeEventListener('online', again); document.removeEventListener('visibilitychange', seen) }
  }, [verify])
  useEffect(() => {
    if (me && me !== 'none' && me !== 'loading') { user.set(me.name); role.set(me.role === 'op' ? 'op' : 'mgr'); myDept.set(me.dept); startSync() }
  }, [me])
  const out = async () => { leaving.current = true; rememberMe(null); user.set(''); confirmed.current = 0; setErr(''); setMe(null); await signOutHere() }
  /** the PIN was accepted: the server is asked who that is */
  const entered = async () => { leaving.current = false; await verify() }
  if (me === 'loading') return <div className="gate"><h1>Actividad</h1><p>Entrando…</p></div>
  if (me === null) return <LoginGate error={err} onDone={entered} />
  if (me === 'none') return <NoRole onOut={out} onRetry={verify} />
  const home = isDept(me.dept) ? me.dept : DEPTS[0]
  if (me.role === 'op' && !isDept(me.dept)) return <NoRole onOut={out} onRetry={verify} text={'Tu usuario está en Actividad pero sin departamento. Pide al manager que te asigne uno.'} />
  return <WhoCtx.Provider value={{ role: me.role, admin: !!me.admin, powers: me.powers ?? null, shift: me.shift ?? 0 }}><Main name={me.name} home={home} mgr={me.role !== 'op'} admin={!!me.admin} wholeDay={!!me.admin || me.role === 'office'} meId={me.id} onLogout={() => void out()} /></WhoCtx.Provider>
}

/**
 * Asks the browser to keep the user and the PIN in its own password store (the phone's, the tablet's or the PC's),
 * where a page is allowed to ask; elsewhere the browser offers it by itself when it sees the form. The app itself
 * never keeps a PIN.
 */
function offerToSave(id: string, password: string) {
  try {
    const Kept = (window as unknown as { PasswordCredential?: new (d: { id: string; password: string }) => Credential }).PasswordCredential
    if (Kept && navigator.credentials?.store) void navigator.credentials.store(new Kept({ id, password })).catch(() => undefined)
  } catch { /* this browser offers it on its own, or not at all */ }
}

/** a PIN or password box with an eye: what is typed stays hidden unless the person asks to see it */
function SecretInput({ value, onChange, what, hide, inputRef, ...box }: { value: string; onChange: (text: string) => void; what: string; hide?: boolean; inputRef?: Ref<HTMLInputElement> } & Pick<InputHTMLAttributes<HTMLInputElement>, 'placeholder' | 'inputMode' | 'autoComplete' | 'autoFocus' | 'name' | 'id'>) {
  const [seen, setSeen] = useState(false)
  const show = seen && !hide
  // the eye does not take the cursor out of the box, so the keyboard stays as it is
  const stay = (e: { preventDefault: () => void }) => e.preventDefault()
  const label = (show ? 'Ocultar ' : 'Ver ') + what
  return (
    <span className="secret">
      <input {...box} ref={inputRef} type={show ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="eye" aria-label={label} title={label} aria-pressed={show} onPointerDown={stay} onMouseDown={stay} onClick={() => setSeen(!show)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{show && <path d="M4 4l16 16" />}</svg>
      </button>
    </span>
  )
}

function LoginGate({ error, onDone }: { error: string; onDone: () => Promise<void> }) {
  // the user name last used on this device is already written: only the PIN is left (or the browser fills it in)
  const [u, setU] = useState(rememberedUser)
  const [known] = useState(() => !!rememberedUser())
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(error)
  const userBox = useRef<HTMLInputElement>(null), pinBox = useRef<HTMLInputElement>(null)
  useEffect(() => { if (error) setMsg(error) }, [error])
  const go = async () => {
    // what the boxes hold, not only what was typed: a browser that fills them in by itself does not always say so
    const user = (userBox.current?.value ?? u).trim(), secret = pinBox.current?.value ?? pin
    if (user !== u) setU(user)
    if (secret !== pin) setPin(secret)
    if (!user || !secret) { setMsg('Escribe tu usuario y tu PIN.'); return }
    setBusy(true); setMsg('')
    await signedOut() // a "Salir" still finishing must be over first, or it could clear the session about to be made
    const { error: e } = await supabase!.auth.signInWithPassword({ email: loginEmail(user), password: secret })
    setBusy(false)
    if (e) { setMsg(/invalid/i.test(e.message) ? 'Usuario o PIN incorrectos.' : /fetch|network/i.test(e.message) || unreachable(e.message) ? 'Sin conexión. Revisa el WiFi e intenta otra vez.' : e.message); return }
    rememberUser(user)
    offerToSave(user.toLowerCase(), secret)
    await onDone()
  }
  const mail = u.includes('@')
  return (
    <div className="gate">
      <h1>Actividad</h1>
      <p>Entra con tu usuario y PIN (los mismos de Freezer RTE).</p>
      <form onSubmit={(e) => { e.preventDefault(); if (!busy) void go() }}>
        <input ref={userBox} autoFocus={!known} name="username" id="act-user" placeholder="Usuario (o tu correo)" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} />
        {/* a department user has a numeric PIN (number pad); an account typed as an e-mail has a real password, so the full keyboard */}
        <SecretInput inputRef={pinBox} autoFocus={known} name="password" id="act-pin" what={mail ? 'la contraseña' : 'el PIN'} hide={busy} inputMode={mail ? 'text' : 'numeric'} placeholder={mail ? 'Contraseña' : 'PIN'} autoComplete="current-password" value={pin} onChange={setPin} />
        {msg && <span className="err">{msg}</span>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
      <small>Cada registro lleva el nombre de quien entró. Si no tienes usuario, pídelo al manager. Entras una vez y este aparato te recuerda hasta que toques "Salir".</small>
      <QrLink label="Abrir en otro aparato (código QR)" />
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

/** "Salir" asks first, and says what leaving costs right now (see leaveAsk); the answer follows the sync while the box is open */
function LeaveDialog({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  const st = useSyncExternalStore(syncStore.subscribe, syncStore.get)
  const ask = leaveAsk(st, navigator.onLine !== false)
  return <ConfirmDialog title={ask.title} text={ask.text} yes={ask.yes} danger={ask.danger} onYes={onYes} onNo={onNo} />
}

/** the dot next to the name: in step with the server, something waiting to go up, or no signal */
function SyncDot() {
  const st = useSyncExternalStore(syncStore.subscribe, syncStore.get)
  if (st.state === 'local') return null
  // an error of the server (not of the connection) is not "Sincronizado": the last try did not go through
  const wrong = !!st.lastError && st.lastError !== 'signedOut'
  const text = st.pending ? 'Pendiente ' + st.pending : st.state === 'offline' ? 'Sin conexión' : st.state === 'signedOut' ? 'Sin sesión' : st.state === 'connecting' ? 'Conectando…' : wrong ? 'Con error' : 'Sincronizado'
  const cls = st.pending || st.state === 'offline' || wrong ? 'amber' : st.state === 'online' ? 'ok' : ''
  return <button type="button" className={'syncdot ' + cls} title={st.lastError || text} onClick={() => { void syncNow() }}>● {text}{st.lastError && st.lastError !== 'signedOut' && <small className="syncerr"> · {st.lastError.slice(0, 140)}</small>}</button>
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
  return <WhoCtx.Provider value={{ role: mgr ? 'mgr' : 'op', admin: mgr }}><Main name={name} home={isDept(dept) ? dept : DEPTS[0]} mgr={mgr} admin={mgr} onLogout={out} /></WhoCtx.Provider>
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
        <h1>Actividad<span className="demotag">DEMO</span></h1>
        <p>¿De qué departamento eres?</p>
        <div className="pick">{DEPTS.map((d) => <button key={d} type="button" className="btn" onClick={() => onDept(d)}>{d}</button>)}</div>
        <QrLink label="Abrir el demo en otro aparato (código QR)" />
        {asking ? (
          <form onSubmit={(e) => { e.preventDefault(); if (pin === managerPin.get()) onManager(); else { setBad(true); setPin('') } }} className="mgrform">
            <label>Código de manager <SecretInput autoFocus what="el código" inputMode="numeric" placeholder="código" autoComplete="off" value={pin} onChange={(t) => { setPin(t); setBad(false) }} /></label>
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
      <h1>Actividad<span className="demotag">DEMO</span></h1>
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

/** who is using the app, for every screen that asks what they may do (see powers.ts) */
const WhoCtx = createContext<Who>({ role: 'op' })
export const useWho = () => useContext(WhoCtx)
export const useCan = () => { const w = useContext(WhoCtx); return (p: Power) => canDo(w, p) }

function Main({ name, home, mgr, admin, wholeDay, meId, onLogout }: { name: string; home: Dept; mgr: boolean; admin: boolean; wholeDay?: boolean; meId?: string; onLogout: () => void }) {
  const s = useSyncExternalStore(store.subscribe, store.get)
  const now = useNow()
  const can = useCan()
  const day = workDay(s, now)
  const [dept, setDept] = useState<Dept>(home)
  const [tab, setTab] = useState<'act' | 'av' | 'rep' | 'emp'>('act')
  const full = useSyncExternalStore(storageFull.subscribe, storageFull.get)
  const [leaving, setLeaving] = useState(false)
  // only with a server is there a time to share; on its own, a device simply shows its own clock
  const away = !!supabase && otherZone(now), off = supabase ? clockOffText() : ''
  return (
    <div className="app">
      {away ? <div className="zonebar">⚠ Este aparato está puesto en otra zona horaria que la planta: las horas y la fecha saldrán corridas. En los ajustes del aparato, activa la zona horaria automática.</div>
        : off && <div className="zonebar">⚠ El reloj de este aparato está {off}. La app usa la hora correcta, la del servidor. Para arreglarlo, activa la hora automática en los ajustes del aparato.</div>}
      {full && <div className="fullbar">⚠ La memoria de este aparato está llena y lo nuevo no se está guardando aquí. {supabase ? 'Lo que ya subió al servidor está a salvo. Avisa al manager y no cierres la app hasta que diga "Sincronizado".' : 'Manda el reporte del día y avisa al manager antes de cerrar la app: hay que hacer espacio con "Reiniciar registros".'}</div>}
      <header className="top">
        <div className="brand"><h1>Actividad{!supabase && <span className="demotag">DEMO</span>}</h1><small>{new Date(now).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}</small></div>
        <nav className="tabs">
          <button type="button" className={tab === 'act' ? 'on' : ''} onClick={() => setTab('act')}>Actividad</button>
          {can('products') && <button type="button" className={tab === 'av' ? 'on' : ''} onClick={() => setTab('av')}>Avance</button>}
          <button type="button" className={tab === 'rep' ? 'on' : ''} onClick={() => setTab('rep')}>Reporte</button>
          {can('people') && supabase && <button type="button" className={tab === 'emp' ? 'on' : ''} onClick={() => setTab('emp')}>Empleados</button>}
        </nav>
        <div className="me"><SyncDot /> {name} · {mgr ? 'Manager' : home} {mgr && <QrLink label="QR" />}<button type="button" className="lnk" onClick={() => setLeaving(true)}>{supabase ? 'Salir' : 'Cambiar'}</button></div>
      </header>
      {leaving && <LeaveDialog onYes={() => { setLeaving(false); onLogout() }} onNo={() => setLeaving(false)} />}
      {tab === 'act' ? (
        <>
        <DayBar s={s} now={now} day={day} mgr={can('day')} />
        <div className="main">
          {/* the manager moves between rooms; a supervisor or operator only has their own */}
          {can('depts') && (
            <aside className="side">
              {DEPTS.map((d) => {
                const lines = s.lines.filter((l) => l.dept === d)
                const running = lines.filter((l) => openRun(s, l.id) && !openStop(s, d, l.id)).length
                const stopped = lines.filter((l) => openRun(s, l.id) && openStop(s, d, l.id)).length
                const goal = targetOf(s, d)?.perShift, td = goal ? deptToday(s, d, day.date, now) : null
                return (
                  <button key={d} type="button" className={'dept' + (dept === d ? ' on' : '')} onClick={() => setDept(d)}>
                    <span className="dname">{d}{td && goal && <small className="goalmini">{fmtN(td.qty)} / {fmtN(goal)} {td.unitLabel}</small>}</span>
                    <span className="dots">{running > 0 && <i className="dot g">{running}</i>}{stopped > 0 && <i className="dot r">{stopped}</i>}</span>
                  </button>
                )
              })}
            </aside>
          )}
          <DeptPanel key={dept} s={s} dept={can('depts') ? dept : home} now={now} mgr={mgr} day={day} />
        </div>
        </>
      ) : tab === 'av' && can('products') ? <Avance s={s} /> : tab === 'emp' && can('people') && supabase ? <Employees meId={meId ?? ''} admin={admin} /> : <Report s={s} now={now} only={can('depts') ? undefined : home} mgr={can('depts')} admin={admin} wholeDay={!!wholeDay} />}
    </div>
  )
}

/** the office's AVANCE sheet, live: scheduled → done → pending per room, computed from the products table */
function Avance({ s }: { s: State }) {
  const [date, setDate] = useState(() => workDay(s).date)
  const [editing, setEditing] = useState(false)
  const [newCode, setNewCode] = useState('')
  // codes being worked on in this screen stay listed while their number is typed, also at 0; a code left at 0 is gone the next time
  const typing = useRef({ date, codes: new Set<string>() })
  if (typing.current.date !== date) typing.current = { date, codes: new Set() }
  for (const [c, n] of Object.entries(s.schedule[date] ?? {})) if (n > 0) typing.current.codes.add(normCode(c))
  const rows = avanceRows(s, date, typing.current.codes)
  const sum = (f: (r: AvanceRow) => number | null) => rows.reduce((t, r) => t + (f(r) ?? 0), 0)
  const cls = (v: number | null) => (v == null ? '' : v < 0 ? 'red' : v > 0 ? 'amber' : 'ok')
  const day = useDay(date)
  return (
    <section className="report avance">
      <div className="rhead">
        <h2>Avance del día</h2>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <form className="addcode" onSubmit={(e) => { e.preventDefault(); if (newCode.trim()) { typing.current.codes.add(normCode(newCode)); setSchedule(date, newCode, 0); setNewCode('') } }}>
          <input placeholder="Código a programar" value={newCode} onChange={(e) => setNewCode(e.target.value)} autoComplete="off" />
          <button className="btn" type="submit" disabled={!newCode.trim()}>+ Programar</button>
        </form>
        <button type="button" className="btn" onClick={() => setEditing(!editing)}>{editing ? 'Cerrar productos' : '⚙ Productos'}</button>
      </div>
      <DayNote day={day} />
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
                <td>{r.mixesDone}</td><td className={cls(r.mixesPending)}>{r.mixesPending}</td>
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

/** a cell of the products table: it shows the saved value, keeps what is being typed, and saves when the person leaves it (or presses Enter) */
function Cell({ value, onCommit, className, numeric }: { value: string; onCommit: (text: string) => boolean; className: string; numeric?: boolean }) {
  const [text, setText] = useState(value)
  const [typing, setTyping] = useState(false)
  // the saved value changed from outside (another device, an import, the row now holds another product): show it
  useEffect(() => { if (!typing) setText(value) }, [value, typing])
  return (
    <input className={className} inputMode={numeric ? 'decimal' : undefined} value={text} autoComplete="off"
      onFocus={() => setTyping(true)} onChange={(e) => setText(e.target.value)}
      onBlur={() => { setTyping(false); if (text.trim() !== value.trim() && !onCommit(text)) setText(value) }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
  )
}

/** the master table: read-only until "Editar", so a stray tap on a tablet cannot change a yield; every change saves itself */
function Products({ s }: { s: State }) {
  const [unlocked, setUnlocked] = useState(false)
  const [q, setQ] = useState('')
  const [removeIdx, setRemoveIdx] = useState<number | null>(null)
  const [notice, setNotice] = useState<{ title: string; text?: string } | null>(null)
  const show = (v: number) => (v ? String(v) : '—')
  const text = (v: number) => (v ? String(v) : '')
  /** saves one field of the product at position i; a code that is another product's is refused with a notice */
  const [rename, setRename] = useState<{ i: number; from: string; to: string; name: string } | null>(null)
  const refused = (why: 'taken' | 'blank', code: string) => setNotice(why === 'taken' ? { title: 'Ya hay un producto con el código ' + code.trim().toUpperCase(), text: 'Cada código va una sola vez en la tabla. Corrige ese producto en su fila.' } : { title: 'El código no puede quedar en blanco', text: 'Para sacar un producto de la tabla usa la ✕ de su fila.' })
  /** saves one field of the product at position i; false = not saved (the cell goes back to what it showed) */
  const upd = (i: number, patch: Partial<Product>) => {
    const p = store.get().products[i]
    if (!p) return false
    if (patch.code !== undefined) {
      const why = codeProblem(i, patch.code)
      if (why) { refused(why, patch.code); return false }
      // another code on a product that already has one is a rename every tablet will see: asked first
      if (p.code.trim() && normCode(p.code) !== normCode(patch.code)) { setRename({ i, from: p.code, to: patch.code, name: p.name }); return false }
    }
    return saveProduct(i, { ...p, ...patch })
  }
  const doRename = () => {
    if (!rename) return
    const p = store.get().products[rename.i]
    // the row must still hold the product the question was about
    if (p && normCode(p.code) === normCode(rename.from) && !saveProduct(rename.i, { ...p, code: rename.to })) refused(codeProblem(rename.i, rename.to) ?? 'taken', rename.to)
    setRename(null)
  }
  // the search keeps each product's place in the full list, so an edit or a removal lands on the right row
  const needle = q.trim().toUpperCase()
  const shown = s.products.map((p, i) => ({ p, i })).filter(({ p }) => !needle || p.code.toUpperCase().includes(needle) || normCode(p.code).includes(normCode(needle)) || p.name.toUpperCase().includes(needle))
  const exportCsv = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([productsCsv(s.products)], { type: 'text/csv;charset=utf-8' })); a.download = 'productos.csv'; a.click() }
  return (
    <div className={'products' + (unlocked ? ' editing' : '')}>
      {removeIdx != null && <ConfirmDialog title={'¿Quitar ' + (s.products[removeIdx]?.code || 'este producto') + ' de la tabla?'} yes="Quitar" danger onYes={() => { removeProduct(removeIdx); setRemoveIdx(null) }} onNo={() => setRemoveIdx(null)} />}
      {notice && <NoticeDialog title={notice.title} text={notice.text} onClose={() => setNotice(null)} />}
      {rename && <ConfirmDialog title={'¿Cambiar el código ' + rename.from + ' por ' + rename.to + '?'} text={'El producto ' + (rename.name ? '"' + rename.name + '" ' : '') + 'pasa a ser el ' + rename.to + (supabase ? ' en todas las tablets' : '') + ' y el código ' + rename.from + ' sale de la tabla. Lo que ya se registró con ' + rename.from + ' se queda con ' + rename.from + '. Si fue sin querer, toca Cancelar.'} yes="Cambiar código" onYes={doRename} onNo={() => setRename(null)} />}
      <div className="phead">
        <h3>{unlocked ? '✎ Editando productos' : '🔒 Productos · la tabla maestra de la oficina'}</h3>
        <div className="psearch">
          <input type="search" placeholder="Buscar código o producto" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" autoCapitalize="none" />
          {q && <button type="button" className="lnk" onClick={() => setQ('')}>✕</button>}
          <small>{needle ? shown.length + ' de ' : ''}{s.products.length}</small>
        </div>
        <button type="button" className={'btn' + (unlocked ? ' primary' : '')} onClick={() => setUnlocked(!unlocked)}>{unlocked ? '✓ Listo, bloquear' : '✎ Editar'}</button>
      </div>
      <div className="twrap">
        <table>
          <thead><tr><th>Código</th><th>Producto</th><th>Pouches / caja</th><th>Cajas / mezcla (yield)</th><th>Guacales / carro</th><th>Pouches / guacal</th><th>Cajas / pallet</th>{unlocked && <th></th>}</tr></thead>
          <tbody>
            {s.products.length === 0 && <tr><td colSpan={8}><i>No hay productos todavía.{!unlocked && ' Toca "Editar" para escribirlos o importar el CSV de la oficina.'}</i></td></tr>}
            {s.products.length > 0 && shown.length === 0 && <tr><td colSpan={8}><i>Ningún producto con "{q.trim()}".</i></td></tr>}
            {shown.map(({ p, i }) => unlocked ? (
              <tr key={(p.code || '·') + ':' + i}>
                <td><Cell className="code" value={p.code} onCommit={(t) => upd(i, { code: t.trim().toUpperCase() })} /></td>
                <td><Cell className="name" value={p.name} onCommit={(t) => upd(i, { name: t.trim() })} /></td>
                <td><Cell className="num" numeric value={text(p.pouchesPerCase)} onCommit={(t) => upd(i, { pouchesPerCase: numOf(t) })} /></td>
                <td><Cell className="num" numeric value={text(p.casesPerMix)} onCommit={(t) => upd(i, { casesPerMix: numOf(t) })} /></td>
                <td><Cell className="num" numeric value={text(p.cratesPerCart)} onCommit={(t) => upd(i, { cratesPerCart: numOf(t) })} /></td>
                <td><Cell className="num" numeric value={text(p.pouchesPerCrate)} onCommit={(t) => upd(i, { pouchesPerCrate: numOf(t) })} /></td>
                <td><Cell className="num" numeric value={text(p.casesPerPallet)} onCommit={(t) => upd(i, { casesPerPallet: numOf(t) })} /></td>
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
        {unlocked && <button type="button" className="btn" onClick={() => { setQ(''); saveProduct(s.products.length, { code: '', name: '', pouchesPerCase: 0, casesPerMix: 0, cratesPerCart: CRATES_PER_CART, pouchesPerCrate: 0, casesPerPallet: 0, updatedAt: 0 }) }}>+ Agregar producto</button>}
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
        ? 'Cada cambio se guarda al salir de la casilla' + (supabase ? ' y baja a todas las tablets' : '') + '. Columnas del CSV de la oficina: Código, Producto, Pouches por caja, Cajas por mezcla, Cajas por pallet, Guacales por carro, Pouches por guacal.'
        : (supabase ? 'Con estos números se calculan el Avance y los pouches por carro en todas las tablets.' : 'Los productos de ejemplo son inventados; todo se guarda solo en este dispositivo.') + ' Para cambiar algo o importar el CSV de la oficina, toca "Editar".'}</p>
    </div>
  )
}

const longDate = (date: string) => new Date(date + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })
const hhmm = (ms: number) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
/** the word to type before records are wiped: always a deliberate act, never a stray tap */
const WIPE_WORD = 'BORRAR'
const wipeOk = (typed: string) => typed.trim().toUpperCase() === WIPE_WORD
/** "1 corrida y 0 paros", "12 corridas y 1 paro" */
const howMany = (runs: number, stops: number) => runs + (runs === 1 ? ' corrida' : ' corridas') + ' y ' + stops + (stops === 1 ? ' paro' : ' paros')

/** which day of work it is, for everyone; the manager starts it here */
function DayBar({ s, now, day, mgr }: { s: State; now: number; day: WorkDay; mgr: boolean }) {
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<{ title: string; text?: string } | null>(null)
  if (!day.started && !mgr) return null
  return (
    <div className={'daybar' + (day.started ? ' on' : '')}>
      {day.started
        ? <span>Día de trabajo: <b>{longDate(day.date)}</b> · empezó a las <b>{fmtTime(day.started.at)}</b>{day.started.by ? ' · ' + day.started.by : ''}</span>
        : <span>El día de hoy todavía no se ha empezado.</span>}
      {mgr && <button type="button" className={day.started ? 'lnk' : 'btn primary'} onClick={() => setOpen(true)}>{day.started ? 'Cambiar' : '▶ Empezar el día'}</button>}
      {open && <StartDayDialog s={s} now={now} day={day} onClose={() => setOpen(false)} onDone={setNotice} />}
      {notice && <NoticeDialog title={notice.title} text={notice.text} onClose={() => setNotice(null)} />}
    </div>
  )
}

/**
 * Starting the day of work: from that hour "today" is that date on every tablet, until 6 the next morning. It tidies
 * up on the way: runs nobody finished on earlier days, and (only if asked, and confirmed by typing a word) what was
 * recorded today before the start, when it was tests.
 */
function StartDayDialog({ s, now, day, onClose, onDone }: { s: State; now: number; day: WorkDay; onClose: () => void; onDone: (n: { title: string; text?: string }) => void }) {
  const was = day.started
  const [opened] = useState(() => hhmm(was ? was.at : now))
  const [time, setTime] = useState(opened)
  const [left, setLeft] = useState<'finish' | 'keep'>('finish')
  const [mine, setMine] = useState<'keep' | 'wipe'>('keep')
  const [word, setWord] = useState('')
  // an hour left as it came means "this very moment" (or the start it already had); a typed one is that hour, on the nearest day
  const at = time === opened ? (was ? was.at : now) : nearDay(was ? was.at : now, time)
  const date = was ? day.date : plainDay(s, at) // after midnight the second shift is still on its own day
  const lefts = leftOpen(s, date, at)
  const had = dayRecords(s, date, at)
  const some = had.runs.length + had.stops.length > 0
  const wipe = some && mine === 'wipe'
  const ok = !!time && (!wipe || wipeOk(word))
  const go = () => {
    if (!ok) return
    const r = startDay(time === opened && !was ? clockNow() : at, { date, finishLeft: lefts.length > 0 && left === 'finish', purge: wipe })
    onClose()
    const did = [r.ended ? (r.ended === 1 ? 'Se terminó 1 línea que había quedado corriendo.' : 'Se terminaron ' + r.ended + ' líneas que habían quedado corriendo.') : '', r.runs + r.stops ? 'De las pruebas se ' + (r.runs + r.stops === 1 ? 'borró ' : 'borraron ') + howMany(r.runs, r.stops) + '.' : ''].filter(Boolean)
    onDone({ title: was ? 'Día actualizado' : 'Día empezado', text: did.join(' ') || 'Los totales, la meta y la fecha de hoy ya siguen este día' + (supabase ? ' en todas las tablets.' : ' en este aparato.') })
  }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{was ? 'Día de trabajo' : 'Empezar el día'}</h3>
        <p>Desde esa hora, "hoy" es el <b>{longDate(date)}</b>{supabase ? ' en todas las tablets' : ''}, hasta las {nightText(s, date)} de la madrugada siguiente, cuando el turno 2 le entrega al turno 1. Un turno que pasa de la medianoche conserva su fecha y su lote.</p>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); go() }}>
          <label>Hora en que empieza <input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          {lefts.length > 0 && (
            <div className="tidybox">
              <b>{lefts.length === 1 ? 'Quedó 1 línea corriendo de un día anterior' : 'Quedaron ' + lefts.length + ' líneas corriendo de días anteriores'}</b>
              <ul>{lefts.slice(0, 6).map((r) => <li key={r.id}>{r.dept} · {lineNameOf(s, r.lineId, r.line)} · {r.code} · desde el {longDate(r.date)}</li>)}{lefts.length > 6 && <li>y {lefts.length - 6} más</li>}</ul>
              <div className="chips">
                <button type="button" className={'chip' + (left === 'finish' ? ' on' : '')} onClick={() => setLeft('finish')}>Terminarlas en su último registro</button>
                <button type="button" className={'chip' + (left === 'keep' ? ' on' : '')} onClick={() => setLeft('keep')}>Dejarlas corriendo</button>
              </div>
            </div>
          )}
          {some && (
            <div className={'tidybox' + (wipe ? ' hot' : '')}>
              <b>Ya hay registrado ese día antes de esa hora: {had.runs.length} {had.runs.length === 1 ? 'corrida' : 'corridas'}{had.runs.some((r) => !r.endedAt) ? ' (' + had.runs.filter((r) => !r.endedAt).length + ' en curso)' : ''} y {had.stops.length} {had.stops.length === 1 ? 'paro' : 'paros'}</b>
              <div className="chips">
                <button type="button" className={'chip' + (mine === 'keep' ? ' on' : '')} onClick={() => setMine('keep')}>Son de hoy: se quedan</button>
                <button type="button" className={'chip' + (mine === 'wipe' ? ' on' : '')} onClick={() => setMine('wipe')}>Eran pruebas: borrarlas</button>
              </div>
              {wipe && <>
                <span>Se quitan de todas las pantallas y del reporte{supabase ? ', en todos los aparatos' : ''}. Desde la app no se pueden recuperar.</span>
                <label>Escribe {WIPE_WORD} para confirmar <input value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" autoCapitalize="characters" placeholder={WIPE_WORD} /></label>
              </>}
            </div>
          )}
          <div className="dbtns spread">
            <div className="btns">{was && <button type="button" className="lnk" onClick={() => { cancelDay(day.date); onClose() }}>Quitar el inicio del día</button>}</div>
            <div className="btns">
              <button type="button" className="btn" onClick={onClose}>Cancelar</button>
              <button type="submit" className={'btn ' + (wipe ? 'danger' : 'primary')} disabled={!ok}>{was ? '✓ Guardar' : '▶ Empezar el día'}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

/** wiping everything recorded on a day: for days of tests, and only for the owner */
function WipeDayDialog({ s, date, onClose, onDone }: { s: State; date: string; onClose: () => void; onDone: (n: { title: string; text?: string }) => void }) {
  const had = dayRecords(s, date)
  const [word, setWord] = useState('')
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>¿Borrar todo lo registrado el {longDate(date)}?</h3>
        <p>{had.runs.length + had.stops.length === 1 ? 'Es ' : 'Son '}{howMany(had.runs.length, had.stops.length)}. Se quitan de todas las pantallas y reportes{supabase ? ', en todos los aparatos' : ''}. Sirve para limpiar un día de pruebas; desde la app no se puede recuperar.</p>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); if (!wipeOk(word)) return; const r = purgeDay(date); onClose(); onDone({ title: 'Día borrado', text: 'Del ' + longDate(date) + ' se ' + (r.runs + r.stops === 1 ? 'borró ' : 'borraron ') + howMany(r.runs, r.stops) + '.' }) }}>
          <label>Escribe {WIPE_WORD} para confirmar <input value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" autoCapitalize="characters" placeholder={WIPE_WORD} /></label>
          <div className="dbtns">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn danger" disabled={!wipeOk(word)}>Borrar el día</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** "lun, 12 oct": a date said short */
const shortDay = (date: string) => new Date(date + 'T12:00:00').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })
/** "15 oct" */
const shipText = (date: string) => new Date(date + 'T12:00:00').toLocaleDateString('es', { day: 'numeric', month: 'short' })
/** " · faltan 52 de 72 cajas", " · completo", or nothing when the order does not say how many cases it is for */
const leftText = (s: State, o: Order) => { if (o.cases == null) return ''; const left = o.cases - orderMade(s, o.id); return left > 0 ? ' · faltan ' + fmtN(left) + ' de ' + fmtN(o.cases) + ' cajas' : ' · completo' }

/**
 * The orders Packing fills: the office (or a manager) types them, with or without a PO number, and everybody in the
 * room sees the open ones with what has been packed for each. The pallets are given to them one by one, on the line.
 */
function OrdersCard({ s, mgr }: { s: State; mgr: boolean }) {
  const [editing, setEditing] = useState<string | null>(null) // an order's id, or 'new'
  const [showClosed, setShowClosed] = useState(false)
  if (!s.orders.length && !mgr) return null
  const open = s.orders.filter((o) => !o.closed).sort(byShip), closed = s.orders.filter((o) => o.closed).sort(byShip)
  const table = (list: Order[]) => (
    <div className="twrap">
      <table>
        <thead><tr><th>PO</th><th>Código</th><th>Pedidas</th><th>Hechas</th><th>Faltan</th><th>Cliente</th><th>Envío</th><th>Destino</th>{mgr && <th></th>}</tr></thead>
        <tbody>{list.map((o) => {
          const made = orderMade(s, o.id), left = o.cases != null ? o.cases - made : null
          return (
            <tr key={o.id}>
              <td>{o.po ? <b>{o.po}</b> : <i>sin PO</i>}</td><td><b>{o.code}</b></td><td>{o.cases != null ? fmtN(o.cases) : '—'}</td><td>{fmtN(made)}</td>
              <td className={left != null && left <= 0 ? 'ok' : ''}>{left == null ? '—' : left > 0 ? fmtN(left) : '✓ completo' + (left < 0 ? ' (+' + fmtN(-left) + ')' : '')}</td>
              <td>{o.customer || '—'}</td><td>{o.shipBy ? shipText(o.shipBy) : '—'}</td><td>{o.dest || '—'}</td>
              {mgr && <td><button type="button" className="lnk" onClick={() => setEditing(o.id)}>Editar</button></td>}
            </tr>
          )
        })}</tbody>
      </table>
    </div>
  )
  return (
    <div className="orders">
      <div className="tc-head">
        <h3>Pedidos · PO</h3>
        {mgr && <button type="button" className="lnk" onClick={() => setEditing('new')}>+ Agregar pedido</button>}
      </div>
      {open.length ? table(open) : <p className="hint">{mgr ? 'No hay pedidos abiertos. Los que se agreguen aquí los ve Packing al registrar cada pallet de ese código.' : 'No hay pedidos abiertos.'}</p>}
      {open.length > 0 && <p className="hint">"Hechas" suma los pallets que se le dieron a cada pedido en los días que guarda este aparato.</p>}
      {closed.length > 0 && <button type="button" className="lnk" onClick={() => setShowClosed(!showClosed)}>{showClosed ? 'Ocultar' : 'Ver'} los completos ({closed.length})</button>}
      {showClosed && closed.length > 0 && table(closed)}
      {editing && <OrderDialog key={editing} s={s} order={s.orders.find((o) => o.id === editing)} onClose={() => setEditing(null)} />}
    </div>
  )
}

/**
 * An order is written or changed. What matters is the PO number and the product it is for; a new one can name several
 * products at once (one order each, with the same PO). Everything else is optional, the PO too: it can come later.
 */
function OrderDialog({ s, order, onClose }: { s: State; order: Order | undefined; onClose: () => void }) {
  const [customer, setCustomer] = useState(order?.customer ?? '')
  const [po, setPo] = useState(order?.po ?? '')
  const [code, setCode] = useState(order?.code ?? '')
  const [cases, setCases] = useState(order?.cases != null ? String(order.cases) : '')
  const [shipBy, setShipBy] = useState(order?.shipBy ?? '')
  const [dest, setDest] = useState(order?.dest ?? '')
  const [dropping, setDropping] = useState(false)
  const customers = [...new Set(s.orders.map((o) => o.customer).filter(Boolean))].sort()
  const codes = orderCodes(code), many = codes.length > 1
  const prod = codes.length === 1 ? productOf(s, codes[0]) : undefined
  const pallets = prod?.casesPerPallet && Number(cases) > 0 ? Number(cases) / prod.casesPerPallet : null
  // an order already written is of one product; a new one can be of several
  const ok = codes.length > 0 && !(order && many)
  const save = () => {
    if (!ok) return
    const rest = { customer, po, shipBy, dest }
    if (order) saveOrder(order.id, { ...rest, code: codes[0], cases: Number(cases) > 0 ? Number(cases) : null })
    else for (const c of codes) saveOrder(null, { ...rest, code: c, cases: !many && Number(cases) > 0 ? Number(cases) : null })
    onClose()
  }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{order ? 'Pedido · ' + orderLabel(order) : 'Pedido nuevo'}</h3>
        <p>Pon el PO y el producto. Packing lo ve al registrar cada pallet de ese código. Lo demás es opcional, y el PO también se puede dejar en blanco y ponerlo después. El mismo PO se puede repetir las veces que haga falta.</p>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); save() }}>
          <label>N° de PO <input value={po} onChange={(e) => setPo(e.target.value)} placeholder="ej. 4500012345" autoComplete="off" /></label>
          <label>Código del producto {!order && <small>(si el PO es de varios, sepáralos con coma)</small>} <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={order ? 'ej. 0100' : 'ej. 0100, 0200'} autoComplete="off" />{prod && <small> {prod.name}</small>}</label>
          {many && !order && <p className="hint">Se crean {codes.length} pedidos con este PO, uno por producto: {codes.join(', ')}. Las cajas de cada uno se ponen después, con "Editar".</p>}
          {many && order && <span className="err">Este pedido es de un solo producto. Para otro producto, agrega otro pedido con el mismo PO.</span>}
          <label>Cajas pedidas <small>(opcional)</small> <input inputMode="numeric" value={many ? '' : cases} disabled={many} onChange={(e) => setCases(e.target.value.replace(/\D/g, ''))} placeholder="ej. 288" />{pallets != null && <small> = {Math.round(pallets * 100) / 100} {pallets === 1 ? 'pallet' : 'pallets'} de {prod?.casesPerPallet}</small>}</label>
          <label>Cliente <small>(opcional)</small> <input list="order-customers" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="ej. Cliente A" autoComplete="off" /></label>
          <datalist id="order-customers">{customers.map((c) => <option key={c} value={c} />)}</datalist>
          <label>Fecha de envío <small>(opcional)</small> <input type="date" value={shipBy} onChange={(e) => setShipBy(e.target.value)} /></label>
          <label>Destino <small>(opcional)</small> <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="ej. Almacén Norte" autoComplete="off" /></label>
          <div className="dbtns spread">
            <div className="btns">
              {order && <button type="button" className="btn" onClick={() => { closeOrder(order.id, !order.closed); onClose() }}>{order.closed ? 'Abrir otra vez' : '✓ Marcar completo'}</button>}
              {order && <button type="button" className="btn danger" onClick={() => setDropping(true)}>🗑 Borrar</button>}
            </div>
            <div className="btns">
              <button type="button" className="btn" onClick={onClose}>Cancelar</button>
              <button type="submit" className="btn primary" disabled={!ok}>✓ Guardar</button>
            </div>
          </div>
        </form>
        {dropping && order && <ConfirmDialog title={'¿Borrar el pedido ' + orderLabel(order) + '?'} text="Los pallets que ya se le dieron quedan registrados, pero sin pedido. Si el pedido ya se completó, mejor márcalo completo." yes="Borrar" danger onYes={() => { deleteOrder(order.id); onClose() }} onNo={() => setDropping(false)} />}
      </div>
    </div>
  )
}

/**
 * the room today with all its lines together: the total (and what each shift made of it), each code added up across
 * lines, and the manager's goal: so much in the whole day, and so much per hour (the pace is the shift's in course,
 * and it is red as soon as it falls under the goal)
 */
function TodayCard({ s, dept, now, mgr, date }: { s: State; dept: Dept; now: number; mgr: boolean; date: string }) {
  const cfg = CFG[dept]
  const t = deptToday(s, dept, date, now)
  const goal = targetOf(s, dept)
  const [editing, setEditing] = useState(false)
  const hasGoal = !!(goal && (goal.perHour || goal.perShift))
  if (!t.runs.length && !hasGoal && !mgr) return null
  const pct = goal?.perShift ? Math.min(100, Math.floor((t.qty / goal.perShift) * 100)) : 0
  const pace = goal?.perHour && t.shiftRate != null ? t.shiftRate / goal.perHour : null
  const paceCls = pace == null ? '' : pace >= 1 ? 'ok' : 'red'
  const paceText = pace == null ? '' : pace >= 1 ? 'al ritmo de la meta' : 'por debajo de la meta'
  const left = goal?.perShift ? goal.perShift - t.qty : 0
  const speed = t.shiftRate ?? t.rate
  const eta = left > 0 && speed && !t.allEnded ? now + (left / speed) * 3_600_000 : null
  const many = t.byCode.length > 1 || (t.byCode[0]?.lines.length ?? 0) > 1
  const unitWord = (n: number) => (n === 1 ? cfg.unit : cfg.plural).toLowerCase()
  return (
    <div className="todaycard">
      <div className="tc-head">
        <h3>Hoy en {dept} · todas las líneas juntas</h3>
        {mgr && <button type="button" className="lnk" onClick={() => setEditing(true)}>{hasGoal ? '✎ Cambiar meta' : '+ Poner meta'}</button>}
      </div>
      <div className="tc-main">
        <div className="tc-total"><b>{fmtN(t.qty)}</b> <span>{t.unitLabel}</span>{cfg.qty !== 'none' && <small>{t.units} {unitWord(t.units)}</small>}{t.made[0] > 0 && t.made[1] > 0 && <small className="tc-shifts">Turno 1: <b>{fmtN(t.made[0])}</b> · Turno 2: <b>{fmtN(t.made[1])}</b></small>}</div>
        {goal?.perShift ? (
          <div className="tc-goal">
            <div className="tc-goalrow"><span>Meta del día <b>{fmtN(goal.perShift)}</b> {t.unitLabel}</span><b className={pct >= 100 ? 'ok' : ''}>{pct}%</b></div>
            <div className="bar"><i className={pct >= 100 ? 'ok' : ''} style={{ width: pct + '%' }} /></div>
            <div className="tc-sub">{left > 0 ? <>Faltan <b>{fmtN(left)}</b>{eta && <> · a este ritmo se llega a las <b>{fmtTime(eta)}</b></>}</> : <b className="ok">✓ Meta del día cumplida</b>}</div>
          </div>
        ) : <div className="tc-goal tc-none">{mgr ? 'Sin meta del día todavía.' : ''}</div>}
        <div className="tc-rate">
          <label>Ritmo del turno {t.shift}</label>
          <b className={paceCls}>{t.shiftRate != null ? fmtN(t.shiftRate) : '—'}</b> <span>{t.unitLabel}/h</span>
          {goal?.perHour ? <small>meta <b>{fmtN(goal.perHour)}</b>/h{pace != null && <> · <span className={paceCls}>{paceText}</span></>}</small> : <small>{t.shiftRate == null ? 'desde el primer inicio del turno' : 'sin meta por hora'}</small>}
        </div>
      </div>
      {many && <div className="tc-codes">{t.byCode.map((c) => <span key={c.code} className="tc-code"><b>{c.code}</b> {fmtN(c.qty)} {t.unitLabel}{cfg.qty !== 'none' && <> · {c.units} {unitWord(c.units)}</>} · {c.lines.join(', ')}</span>)}</div>}
      {editing && <TargetDialog dept={dept} unit={t.unitLabel} goal={goal} onClose={() => setEditing(false)} />}
    </div>
  )
}

/** the manager types the goal for a room: so many pouches (cajas, mezclas) per hour and/or in the whole day (both shifts) */
function TargetDialog({ dept, unit, goal, onClose }: { dept: Dept; unit: string; goal: Target | undefined; onClose: () => void }) {
  const [hour, setHour] = useState(goal?.perHour ? String(goal.perHour) : '')
  const [whole, setWhole] = useState(goal?.perShift ? String(goal.perShift) : '')
  const num = (t: string) => { const x = Number(t); return x > 0 ? x : null }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>Meta de {dept}</h3>
        <p>La ven todas las tablets de {dept} y queda en el historial. Deja en blanco la que no aplique. El ritmo sale en rojo cuando baja de la meta por hora. Para dejar el departamento sin meta, "Quitar meta".</p>
        <form onSubmit={(e) => { e.preventDefault(); setTarget(dept, num(hour), num(whole)); onClose() }} className="qform">
          <label>Por hora <input autoFocus={!goal?.perHour && !goal?.perShift} inputMode="numeric" placeholder={'ej. 400 ' + unit} value={hour} onChange={(e) => setHour(e.target.value.replace(/\D/g, ''))} /></label>
          <label>En el día completo <small>(los dos turnos)</small> <input inputMode="numeric" placeholder={'ej. 6400 ' + unit} value={whole} onChange={(e) => setWhole(e.target.value.replace(/\D/g, ''))} /></label>
          <div className="dbtns spread">
            <div className="btns">{(goal?.perHour || goal?.perShift) ? <button type="button" className="lnk" onClick={() => { setTarget(dept, null, null); onClose() }}>Quitar meta</button> : null}</div>
            <div className="btns">
              <button type="button" className="btn" onClick={onClose}>Cancelar</button>
              <button type="submit" className="btn primary">✓ Guardar</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function DeptPanel({ s, dept, now, day }: { s: State; dept: Dept; now: number; mgr: boolean; day: WorkDay }) {
  const lines = s.lines.filter((l) => l.dept === dept).sort(byLineName)
  const ds = deptStop(s, dept)
  const can = useCan(), who = useWho()
  const [stopAll, setStopAll] = useState(false)
  const [adding, setAdding] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [editRun, setEditRun] = useState<string | null>(null)
  const [editStop, setEditStop] = useState(false)
  const left = openIn(s, dept) // what is still open in the room: what "Terminar turno" would close
  const editing = editRun ? s.runs.find((r) => r.id === editRun) : undefined
  const anyRunning = lines.some((l) => openRun(s, l.id))
  const doneToday = s.runs.filter((r) => r.dept === dept && r.endedAt && r.date === day.date).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  return (
    <section className="panel">
      <div className="phead">
        <h2>{dept}</h2>
        <div className="acts">
          {ds
            ? <button type="button" className="btn danger" onClick={() => endStop(ds.id)}>▶ Reanudar departamento · {fmtDur(now - ds.startedAt)}</button>
            : <button type="button" className="btn" disabled={!anyRunning} onClick={() => setStopAll(true)}>⏸ Parar departamento</button>}
          <button type="button" className="btn" disabled={!left.runs.length && !left.setups.length && !left.stops.length} onClick={() => setLeaving(true)}>🏁 Terminar turno</button>
          <button type="button" className="btn" onClick={() => setAdding(true)}>+ Agregar {CFG[dept].lineWord.toLowerCase()}</button>
        </div>
      </div>
      {leaving && (
        <div className="veil" onClick={() => setLeaving(false)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()}>
            <h3>¿Terminar el turno en {dept}?</h3>
            <p>Es para cuando ya se van y nada sigue. La app nunca termina nada sola, aunque pase la hora del turno: lo deciden ustedes. Se cierra ahora:</p>
            <ul className="leavelist">
              {left.runs.map((r) => <li key={r.id}><b>{lineNameOf(s, r.lineId, r.line)}</b> · código <b>{r.code}</b> · {madeText(r, runQty(s, r))} · <i>se termina</i></li>)}
              {left.setups.map((x) => <li key={x.id}><b>{lineNameOf(s, x.lineId)}</b> · Set up desde {fmtTime(x.startedAt)} · <i>se quita: no vino otro código</i></li>)}
              {left.stops.map((x) => <li key={x.id}><b>{x.lineId === null ? 'Todo ' + dept : lineNameOf(s, x.lineId)}</b> · parado por {x.reason} desde {fmtTime(x.startedAt)} · <i>se cierra</i></li>)}
            </ul>
            <p className="hint">Si falta registrar {CFG[dept].saved.endsWith('a') ? 'la última ' : 'el último '}{CFG[dept].unit.toLowerCase()} de alguna línea, regístral{CFG[dept].saved.endsWith('a') ? 'a' : 'o'} antes. Si el otro turno va a seguir con estos mismos códigos, no hace falta terminar: déjalos corriendo.</p>
            <div className="dbtns">
              <button type="button" className="btn" onClick={() => setLeaving(false)}>Cancelar</button>
              <button type="button" className="btn primary" onClick={() => { endShift(dept); setLeaving(false) }}>🏁 Terminar turno</button>
            </div>
          </div>
        </div>
      )}
      {ds && <div className="deptstop">⏸ Todo {dept} parado · <b>{ds.reason}</b>{ds.note && ' · ' + ds.note} · desde {fmtTime(ds.startedAt)} · {ds.by} {can('fix') && <button type="button" className="lnk" onClick={() => setEditStop(true)}>Corregir</button>}</div>}
      {editStop && ds && <StopEditor stop={ds} mgr={can('fix')} onClose={() => setEditStop(false)} />}
      <TodayCard s={s} dept={dept} now={now} mgr={can('goals')} date={day.date} />
      {CFG[dept].orders && <OrdersCard s={s} mgr={can('orders')} />}
      <div className="lines">{lines.map((l) => <LineCard key={l.id} s={s} line={l} now={now} mgr={can('fix')} day={day} />)}</div>
      {lines.length === 0 && <p className="hint">Este departamento no tiene líneas. Toca "Agregar {CFG[dept].lineWord.toLowerCase()}".</p>}
      {adding && <LineNameDialog s={s} dept={dept} onClose={() => setAdding(false)} />}
      {doneToday.length > 0 && (
        <div className="done">
          <h3>Terminados hoy en {dept}</h3>
          {doneToday.map((r) => {
            const st = runStats(s, r, now)
            return (
              <div key={r.id} className="donerow">
                <b className="code">{r.code}</b> · lote {r.lot} · {lineNameOf(s, r.lineId, r.line)} · {fmtTime(r.startedAt)} – {fmtTime(r.endedAt ?? now)} · <b>{madeText(r, st.qty)}</b> · trabajando <b>{fmtDur(st.working)}</b> · parado <b className={st.down ? 'red' : ''}>{fmtDur(st.down)}</b>{r.waste > 0 && <> · waste <b className="red">{r.waste} lb</b></>} · {whoText(r)} {can('fix') && canShift(who, spanShifts(shiftsOf(s, r.date), r.startedAt, r.endedAt ?? now)) && <button type="button" className="lnk" onClick={() => setEditRun(r.id)}>Corregir</button>}
              </div>
            )
          })}
        </div>
      )}
      {editing && <RunEditor s={s} run={editing} mgr={can('fix')} onClose={() => setEditRun(null)} />}
      {stopAll && <StopDialog title={'Parar todo ' + dept} reasons={CFG[dept].quick} onClose={() => setStopAll(false)} onPick={(reason, note) => { startStop(dept, null, reason, note); setStopAll(false) }} />}
    </section>
  )
}

/** how long a line's card says that a unit was just recorded */
const SAVED_MS = 2000
/** a short tick on devices that can vibrate (Android phones, some tablets): the tap is felt as well as seen */
const buzz = () => { try { (navigator as Navigator & { vibrate?: (ms: number) => boolean }).vibrate?.(35) } catch { /* not on this device */ } }

// The people on a line correct what is on their own line's card (the code running, its stop, the code that ended last):
// that is where a wrong lot or a cart tapped twice is noticed, and every change carries their name. The day's record
// (the report, the list of codes ended today) is corrected by whoever holds the power for it, a manager by default;
// so is dividing a stop, passing a run to another line or deleting one.
function LineCard({ s, line, now, mgr, day }: { s: State; line: Line; now: number; mgr: boolean; day: WorkDay }) {
  const cfg = CFG[line.dept]
  const canGoal = useCan()('goals')
  const run = openRun(s, line.id)
  const stop = run ? openStop(s, line.dept, line.id) : undefined
  const [fixing, setFixing] = useState(false)
  const [fixingStop, setFixingStop] = useState(false)
  const [code, setCode] = useState('')
  // null = not typed: the date is the day of work and the lot is that date's (they move with the day by themselves)
  const [dateText, setDateText] = useState<string | null>(null)
  const [lotText, setLotText] = useState<string | null>(null)
  const date = dateText ?? day.date
  const lot = lotText ?? lotFor(date)
  const [per, setPer] = useState('')
  const [crates, setCrates] = useState('')
  const [asking, setAsking] = useState(false)
  const [counting, setCounting] = useState(false)
  const [ending, setEnding] = useState(false)
  // the unit being counted is the last one of the code: once it is saved, the code ends
  const [filling, setFilling] = useState<Short | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [goalOpen, setGoalOpen] = useState(false)
  const [editDate, setEditDate] = useState(false)
  const [reopening, setReopening] = useState<string | null>(null) // the code (its run) the question is about
  const [fixingId, setFixingId] = useState<string | null>(null)
  const [endAfter, setEndAfter] = useState<null | boolean>(null) // not null = waiting for that unit; the value says whether a set up follows
  const [removing, setRemoving] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [editQty, setEditQty] = useState(false)
  const nameIt = <button type="button" className="lnk pen" title="Cambiar el nombre" aria-label={'Cambiar el nombre de ' + line.name} onClick={() => setRenaming(true)}>✎</button>
  const naming = renaming && <LineNameDialog s={s} dept={line.dept} line={line} onClose={() => setRenaming(false)} />
  const [wasting, setWasting] = useState(false)
  // A unit was just recorded on this run, here or on another tablet: for a moment the button says which one, the
  // counters light up and the card gets a green ring. So a tap is seen to have landed, on the line it landed on, and
  // nobody taps twice for the same cart (the button rests while it says so).
  const units = run ? run.units.length : 0
  const seen = useRef({ id: run?.id, n: units })
  const [just, setJust] = useState<{ n: number; at: number } | null>(null)
  const tapped = useRef(0)
  useEffect(() => {
    const was = seen.current
    seen.current = { id: run?.id, n: units }
    if (run && was.id === run.id && units > was.n) setJust({ n: units, at: Date.now() })
  }, [run?.id, units])
  useEffect(() => {
    if (!just) return
    const t = setTimeout(() => setJust(null), SAVED_MS)
    return () => clearTimeout(t)
  }, [just])
  const unitWord = cfg.unit.toLowerCase()
  const perCaseOf = (c: string) => (cfg.qtyUnit === 'pouches' ? productOf(s, c)?.pouchesPerCase || undefined : undefined)
  // Units closed with less than the usual can still be filled, instead of counting another one: the running code's
  // own (a button beside "listo"), and the last one of every code already ended on this line today (a link: the code
  // was marked as finished too early, or more of it turned up after the line had gone on to another code).
  const own = run && cfg.qty === 'ask' ? shortUnit(s, run) : null
  const ended = cfg.qty === 'ask' ? shortEnded(s, line.id, day.date).filter((x) => x.run.id !== own?.run.id) : []
  const shortText = (x: Short) => unitWord + ' ' + (x.index + 1) + ' de ' + x.run.code + ' (' + x.unit.qty + ' de ' + x.usual + ')'
  const fillLink = ended.length > 0 && (
    <button type="button" className="lnk" onClick={() => (ended.length === 1 ? setFilling(ended[0]) : setChoosing(true))}>
      ➕ Completar {ended.length === 1 ? shortText(ended[0]) : (cfg.saved.endsWith('a') ? 'una ' : 'un ') + unitWord + ' de un código ya terminado'}
    </button>
  )
  const fixingRun = fixingId ? s.runs.find((r) => r.id === fixingId) : undefined
  const fillUi = (
    <>
      {fixingRun && <RunEditor key={'fix:' + fixingRun.id} s={s} run={fixingRun} mgr={mgr} onClose={() => setFixingId(null)} />}
      {choosing && (
        <div className="veil" onClick={() => setChoosing(false)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()}>
            <h3>¿Cuál quieres completar?</h3>
            <p>Códigos ya terminados hoy en {line.name} que cerraron con menos de lo usual.</p>
            <div className="endchoices">
              {ended.map((x) => <button key={x.run.id} type="button" className="btn" onClick={() => { setChoosing(false); setFilling(x) }}><b>{x.run.code}</b> · lote {x.run.lot} · {unitWord} {x.index + 1} · tiene {x.unit.qty} de {x.usual} {cfg.qtyUnit} · terminó {fmtTime(x.run.endedAt ?? 0)}</button>)}
            </div>
            <div className="dbtns"><button type="button" className="btn" onClick={() => setChoosing(false)}>Cancelar</button></div>
          </div>
        </div>
      )}
      {filling && (cfg.lots
        ? <LotsDialog key={'fill:' + filling.run.id} title={'Completar ' + unitWord + ' ' + (filling.index + 1) + ' de ' + filling.run.code + ' · ¿qué lleva ahora en total?'} unit={cfg.qtyUnit} refLabel={cfg.refLabel} lot={filling.run.lot} qty={filling.usual} start={filling.unit.lots ?? [{ lot: filling.run.lot, qty: filling.usual }]} startRef={filling.unit.ref} onClose={() => setFilling(null)} onPick={(total, ref, lots) => { fillUnit(filling.run.id, filling.unit.at, total, lots, ref); setFilling(null) }} />
        : <QtyDialog key={'fill:' + filling.run.id} title={'Completar ' + unitWord + ' ' + (filling.index + 1) + ' de ' + filling.run.code + ' · tiene ' + filling.unit.qty + ' ' + cfg.qtyUnit + '. ¿Cuántos tiene ahora en total?'} unit={cfg.qtyUnit} refLabel="" initial={filling.usual} perCase={perCaseOf(filling.run.code)} onClose={() => setFilling(null)} onPick={(q) => { fillUnit(filling.run.id, filling.unit.at, q); setFilling(null) }} />)}
    </>
  )
  // The line's own goal, set by the manager (the room's goal is of all its lines together): what the line has made
  // today against it, and its pace in the shift in course, red as soon as it falls under the goal per hour.
  const goal = lineTargetOf(s, line.id), hasGoal = !!(goal && (goal.perHour || goal.perDay))
  const mine = hasGoal ? deptToday(s, line.dept, day.date, now, line.id) : null
  const goalPct = mine && goal?.perDay ? Math.min(100, Math.floor((mine.qty / goal.perDay) * 100)) : 0
  const goalUnit = cfg.qty === 'none' ? cfg.plural.toLowerCase() : cfg.qtyUnit
  const goalBtn = canGoal && <button type="button" className="lnk sm" onClick={() => setGoalOpen(true)}>{hasGoal ? '✎ Meta' : '+ Meta'}</button>
  const goalStrip = (
    <>
      {mine && hasGoal && (
        <div className="linegoal">
          {goal?.perDay ? <span>Meta de hoy <b>{fmtN(mine.qty)}</b> / {fmtN(goal.perDay)} {goalUnit} · <b className={goalPct >= 100 ? 'ok' : ''}>{goalPct}%</b></span> : null}
          {goal?.perHour ? <span>Ritmo <b className={mine.shiftRate == null ? '' : mine.shiftRate >= goal.perHour ? 'ok' : 'red'}>{mine.shiftRate != null ? fmtN(mine.shiftRate) : '—'}</b> {goalUnit}/h · meta {fmtN(goal.perHour)}</span> : null}
        </div>
      )}
      {goalOpen && <LineTargetDialog line={line} unit={goalUnit} goal={goal} onClose={() => setGoalOpen(false)} />}
    </>
  )
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
    // between two codes: what the line is stopped for since its last one ended (its set up)
    const idle = idleStop(s, line.id, now)
    // the code that ended last here today: marked as finished too early, it goes on; short on its last unit, it is filled
    const prev = lastEnded(s, line.id, day.date)
    // the date is the day of work: said in one line, with its box only when somebody wants another one
    const showDate = editDate || dateText !== null
    return (
      <div className="line idle">
        <div className="lhead">
          <h3>{line.name} {nameIt}</h3>
          <span className={'pill ' + (idle ? 'setup' : 'free')}>{idle ? '⏱ ' + idle.reason + ' · ' + fmtDur(stopTime(s, idle, now)) : 'Libre'}</span>
          <span className="lacts">{goalBtn}</span>
        </div>
        {goalStrip}
        {idle && (
          <div className="setupbar">
            <small>Esperando el código siguiente desde las {fmtTime(idle.startedAt)}. Si no viene otro, no cuenta.</small>
            <span className="btns two">
              <button type="button" className="btn sm" onClick={() => endStop(idle.id)}>■ Terminar {idle.reason}</button>
              <button type="button" className="btn sm" onClick={() => dropSetup(idle.id)}>No viene otro código: quitarlo</button>
            </span>
            <button type="button" className="lnk sm" onClick={() => setFixingStop(true)}>{mgr ? 'Corregir o dividir' : 'Corregir'}</button>
          </div>
        )}
        {prev && (
          <div className="lastcode">
            <span>Último: <b className="code">{prev.code}</b> · lote {prev.lot} · terminó {fmtTime(prev.endedAt ?? 0)} · {madeText(prev, runQty(s, prev))}</span>
            <span className="btns">
              <button type="button" className="lnk sm" onClick={() => setReopening(prev.id)}>↩ No había terminado: seguir con {prev.code}</button>
              {fillLink}
              <button type="button" className="lnk sm" onClick={() => setFixingId(prev.id)}>Corregir</button>
            </span>
          </div>
        )}
        {prev && reopening === prev.id && <ConfirmDialog title={'¿Seguir con ' + prev.code + ' en ' + line.name + '?'}
          text={'Se marcó terminado a las ' + fmtTime(prev.endedAt ?? 0) + '. Vuelve a correr como si no se hubiera terminado: el tiempo desde entonces cuenta como trabajando y el Set up que empezó se quita. Si la línea estuvo parada y el código vuelve ahora, es mejor empezarlo de nuevo abajo.'}
          yes={'Seguir con ' + prev.code} onYes={() => { reopenRun(prev.id); setReopening(null) }} onNo={() => setReopening(null)} />}
        {fillUi}
        {fixingStop && idle && <StopEditor stop={idle} mgr={mgr} onClose={() => setFixingStop(false)} />}
        {naming}
        {removing && <ConfirmDialog title={'¿Quitar ' + line.name + ' de ' + line.dept + '?'} text="Se puede volver a agregar cuando haga falta." yes="Quitar" danger onYes={() => removeLine(line.id)} onNo={() => setRemoving(false)} />}
        <form className="start" onSubmit={(e) => { e.preventDefault(); if (ok) { startRun(line, code.trim().toUpperCase(), lot.trim(), date, needPer ? perUnit : null); setDateText(null); setLotText(null); setEditDate(false) } }}>
          <label>Código <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ej. 0100" autoComplete="off" /></label>
          <label>Lote <input value={lot} onChange={(e) => setLotText(e.target.value)} inputMode="numeric" placeholder="ej. 6280" autoComplete="off" /></label>
          {showDate
            ? <label className="wide">Fecha <input type="date" value={date} onChange={(e) => { if (!lot.trim() || lot.trim() === lotFor(date)) setLotText(null); setDateText(e.target.value || null) }} /></label>
            : <div className="dateline">Fecha <b>{shortDay(date)}</b> <button type="button" className="lnk sm" onClick={() => setEditDate(true)}>Cambiar</button></div>}
          {/* a known product brings its numbers: shown as a line, the boxes only when they want to change them */}
          {needPer && !isCart && (suggested != null && !editQty
            ? <div className="known"><b>{suggested}</b> {cfg.qtyUnit} por {cfg.unit.toLowerCase()} <button type="button" className="lnk" onClick={() => setEditQty(true)}>Cambiar</button></div>
            : <label className="wide">{cfg.perUnitLabel} <input value={per} onChange={(e) => setPer(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder={suggested != null ? String(suggested) : 'ej. 36'} autoComplete="off" /></label>)}
          {isCart && (perCrateN && !editQty
            ? <div className="known"><b>{cratesN}</b> guacales × <b>{perCrateN}</b> pouches = <b>{perUnit}</b> pouches por carro <button type="button" className="lnk" onClick={() => setEditQty(true)}>Cambiar</button></div>
            : (
              <div className="cartrow">
                <label>Guacales por carro <input value={crates} onChange={(e) => setCrates(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder={String(cratesN)} autoComplete="off" /></label>
                <label>Pouches por guacal <input value={per} onChange={(e) => setPer(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder={perCrateN ? String(perCrateN) : 'ej. 10'} autoComplete="off" /></label>
                <span className="eq">= <b>{perUnit ?? '—'}</b> pouches por carro <small>(12 guacales por columna)</small></span>
              </div>
            ))}
          <button className="btn primary" type="submit" disabled={!ok}>▶ Empezar</button>
        </form>
        <div className="tools">
          {!idle ? <button type="button" className="lnk sm" onClick={() => startSetup(line)}>⏱ Empezar Set up</button> : <span />}
          <button type="button" className="lnk sm muted" onClick={() => setRemoving(true)}>Quitar {cfg.lineWord.toLowerCase()}</button>
        </div>
      </div>
    )
  }
  const st = runStats(s, run, now)
  const last = run.units.length ? run.units[run.units.length - 1].at : run.startedAt
  const current = workedSince(s, run, last, now)
  /** records a unit from this screen. A second tap in the same instant (a finger that bounces) is not another unit */
  const record = (qty: number | null, ref = '', lots?: LotPart[], po?: string) => {
    if (performance.now() - tapped.current < 800) return
    tapped.current = performance.now()
    unitDone(run.id, qty, ref, lots, po); buzz()
  }
  // The orders open for this code (the office types them). The unit about to be recorded is proposed for one of them
  // (see nextOrderFor); the person can always say another, or none.
  const openOrders = cfg.orders ? openOrdersFor(s, run.code) : []
  const nextOrder = cfg.orders ? nextOrderFor(s, run) : ''
  const orderOptions = openOrders.map((o) => ({ id: o.id, label: orderLabel(o) + leftText(s, o) + (o.shipBy ? ' · envío ' + shipText(o.shipBy) : '') }))
  const done = () => {
    if (just) return
    if (cfg.qty === 'ask') setCounting(true)
    else record(cfg.qty === 'auto' ? run.perUnit : null)
  }
  const lit = just ? ' bumped' : ''
  // pouches are also told as full cases and loose pouches, where the products table says how many go in a case
  const perCase = perCaseOf(run.code)
  const cases = perCase && st.qty > 0 ? inCases(s, run.code, st.qty) : null
  return (
    <div className={'line ' + (stop ? 'stopped' : 'running') + (just ? ' justdone' : '')}>
      {naming}
      <div className="lhead">
        <h3>{line.name} {nameIt}</h3>
        <span className={'pill ' + (stop ? 'stop' : 'run')}>{stop ? '⏸ Parado' : '● Corriendo'}</span>
        <span className="lacts">{goalBtn}<button type="button" className="lnk sm" onClick={() => setFixing(true)}>Corregir</button></span>
      </div>
      <div className="coderow"><b className="code">{run.code}</b><span>lote {run.lot}{run.date !== day.date && ' · ' + shortDay(run.date)} · desde {fmtTime(run.startedAt)}{run.perUnit != null && ' · ' + run.perUnit + ' ' + cfg.qtyUnit + ' por ' + unitWord}</span></div>
      {goalStrip}
      {openOrders.length > 0 && (
        <div className="orderstrip">
          <span>📦 {openOrders.length === 1 ? 'Pedido' : 'Pedidos'} de {run.code}:</span>
          {openOrders.slice(0, 3).map((o) => <span key={o.id} className={o.id === nextOrder ? 'next' : ''}><b>{orderLabel(o)}</b>{leftText(s, o)}{o.shipBy && ' · envío ' + shipText(o.shipBy)}</span>)}
          {openOrders.length > 3 && <span>y {openOrders.length - 3} más</span>}
        </div>
      )}
      {stop && <div className="stopbar">⏸ <b>{stop.reason}</b>{stop.note && ' · ' + stop.note} · <b>{fmtDur(stopTime(s, stop, now))}</b>{stop.lineId === null && ' · todo el departamento'}{stop.lineId === line.id && <button type="button" className="lnk sm" onClick={() => setFixingStop(true)}>Corregir</button>}</div>}
      {fixing && <RunEditor s={s} run={run} mgr={mgr} onClose={() => setFixing(false)} />}
      {fixingStop && stop && <StopEditor stop={stop} mgr={mgr} onClose={() => setFixingStop(false)} />}
      {/* what is made, big: how many units and how much they carry (with its cases, where pouches are counted); then the
          unit in hand with its average, and the time worked with the time stopped */}
      <div className={'tiles' + (cfg.qty !== 'none' ? ' four' : '')}>
        <div key={'n' + (just?.at ?? 0)} className={'tile main' + lit}><label>{cfg.plural}</label><b>{run.units.length}</b></div>
        {cfg.qty !== 'none' && <div key={'q' + (just?.at ?? 0)} className={'tile main' + lit}><label>{cfg.qtyUnit}</label><b>{fmtN(st.qty)}</b>{cases && <small>{casesText(cases)}</small>}</div>}
        <div className="tile"><label>{(cfg.saved.endsWith('a') ? 'Esta ' : 'Este ') + unitWord}</label><b>{fmtDur(current)}</b><small>prom. {run.units.length ? fmtDur(st.avg) : '—'}</small></div>
        <div className="tile"><label>Trabajando</label><b>{fmtDur(st.working)}</b><small className={st.down ? 'red' : ''}>parado {fmtDur(st.down)}</small></div>
      </div>
      <button type="button" className={'btn primary huge' + (just ? ' saved' : '')} disabled={!!just} onClick={done}>✓ {just ? savedText(line.dept, just.n) : cfg.done}</button>
      {own && <button type="button" className="btn slim" onClick={() => setFilling(own)}>➕ Completar {unitWord + (own.run.id === run.id ? ' ' + (own.index + 1) : ' de antes')} · tiene {own.unit.qty} de {own.usual}</button>}
      <div className="acts2">
        {stop
          ? (stop.lineId === line.id
            ? <button type="button" className="btn danger" onClick={() => endStop(stop.id)}>▶ Reanudar</button>
            : <button type="button" className="btn" disabled>Parado por el departamento</button>)
          : <button type="button" className="btn" onClick={() => setAsking(true)}>⏸ Parar</button>}
        {cfg.waste && <button type="button" className="btn" onClick={() => setWasting(true)}>Waste{run.waste ? <b className="red"> {run.waste} lb</b> : ' (lb)'}</button>}
        <button type="button" className="btn" disabled={!!stop} onClick={() => setEnding(true)}>■ Terminar<span className="opt"> código</span></button>
      </div>
      {fillLink && <div className="fillmore">{fillLink}</div>}
      {ending && <EndDialog cfg={cfg} code={run.code} line={line.name} now={now} lastAt={run.units.length ? run.units[run.units.length - 1].at : null}
        summary={'Lleva ' + madeText(run, st.qty) + ' · trabajando ' + fmtDur(st.working) + (st.down ? ' · parado ' + fmtDur(st.down) : '') + '.'}
        onClose={() => setEnding(false)} onDone={(next) => { endRun(run.id, next); setEnding(false) }}
        onMissing={(next) => { setEnding(false); if (cfg.qty === 'ask') { setEndAfter(next); setCounting(true) } else { record(cfg.qty === 'auto' ? run.perUnit : null); endRun(run.id, next) } }} />}
      {asking && <StopDialog title={'Parar ' + line.name + ' · ' + run.code} reasons={cfg.quick} onClose={() => setAsking(false)} onPick={(reason, note) => { startStop(line.dept, line.id, reason, note); setAsking(false) }} />}
      {fillUi}
      {counting && (cfg.lots
        ? <LotsDialog title={cfg.qtyQ} unit={cfg.qtyUnit} refLabel={cfg.refLabel} lot={run.lot} qty={run.perUnit} orders={orderOptions} order={nextOrder} onClose={() => { setCounting(false); setEndAfter(null) }} onPick={(q, ref, lots, po) => { record(q, ref, lots, po); setCounting(false); if (endAfter !== null) { setEndAfter(null); endRun(run.id, endAfter) } }} />
        : <QtyDialog title={cfg.qtyQ} unit={cfg.qtyUnit} refLabel={cfg.refLabel} initial={run.perUnit} perCase={perCase} onClose={() => { setCounting(false); setEndAfter(null) }} onPick={(q, ref) => { record(q, ref); setCounting(false); if (endAfter !== null) { setEndAfter(null); endRun(run.id, endAfter) } }} />)}
      {wasting && <QtyDialog title={'Waste de ' + run.code + ' · ¿cuántas libras?'} unit="lb" refLabel="" initial={null} decimal onClose={() => setWasting(false)} onPick={(lb) => { if (lb > 0) addWaste(run.id, lb); setWasting(false) }} />}
    </div>
  )
}

/**
 * Ending a code asks about its last unit first: the cart, pallet, bin or mezcla that came out last is the one people
 * forget to register. If it is missing, it is registered right there and then the code ends. Neither answer is the
 * big button: a tap out of habit must not add a unit that does not exist, nor leave out one that does. Before that it
 * asks what comes next on the line, with no answer given beforehand: a set up left counting on a line whose people
 * had gone home was the price of a box that came ticked.
 */
function EndDialog({ cfg, code, line, summary, lastAt, onMissing, onDone, onClose }: { cfg: DeptCfg; code: string; line: string; summary: string; lastAt: number | null; now: number; onMissing: (next: boolean) => void; onDone: (next: boolean) => void; onClose: () => void }) {
  const fem = cfg.saved.endsWith('a'), unit = cfg.unit.toLowerCase()
  // what comes next on this line is asked, never assumed: with another code coming, the time until it starts counts
  // as its set up; with nothing more today, nothing is left counting when the people go
  const [next, setNext] = useState<boolean | null>(null)
  const last = (fem ? 'la última ' : 'el último ') + unit
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>Terminar {code} · {line}</h3>
        <p>{summary}{lastAt ? ' ' + (fem ? 'Última ' : 'Último ') + unit + ': ' + fmtTime(lastAt) + '.' : ''}</p>
        <p className="endask">¿Qué sigue en esta línea?</p>
        <div className="chips big">
          <button type="button" className={'chip' + (next === true ? ' on' : '')} onClick={() => setNext(true)}>Viene otro código<small>empieza el Set up</small></button>
          <button type="button" className={'chip' + (next === false ? ' on' : '')} onClick={() => setNext(false)}>Nada más por hoy<small>no queda nada contando</small></button>
        </div>
        <p className="endask">¿Ya registraste {last}?</p>
        <div className="endyes">
          <button type="button" className="btn primary" disabled={next === null} onClick={() => next !== null && onDone(next)}>✓ Sí, terminar</button>
          <button type="button" className="btn" disabled={next === null} onClick={() => next !== null && onMissing(next)}>＋ Falta: registrar{fem ? 'la' : 'lo'}</button>
        </div>
        <div className="dbtns"><button type="button" className="lnk" onClick={onClose}>Cancelar</button></div>
      </div>
    </div>
  )
}

/** stopping a line or the department: its three usual causes and "Otra", where any other one is typed */
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
        <div className="chips big">{[...reasons, 'Otra'].map((r) => <button key={r} type="button" className={'chip' + (reason === r ? ' on' : '')} onClick={() => setReason(r)}>{r}</button>)}</div>
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

/**
 * A unit that can carry more than one lot of the product (a pallet in Packing): each lot with its quantity. One lot
 * is the usual case: the box opens with the run's lot and the usual quantity, and one tap on "Guardar" takes it.
 * `start` / `startRef` = what the unit already has, when it is being corrected.
 * `orders` / `order` = the orders open for the product and the one proposed: the unit is given to one of them, or to none.
 */
export function LotsDialog({ title, unit, refLabel, lot, qty, start, startRef, orders, order, onClose, onPick }: { title: string; unit: string; refLabel: string; lot: string; qty: number | null; start?: LotPart[]; startRef?: string; orders?: { id: string; label: string }[]; order?: string; onClose: () => void; onPick: (total: number, ref: string, lots: LotPart[] | undefined, po?: string) => void }) {
  const [rows, setRows] = useState(() => (start?.length ? start.map((l) => ({ lot: l.lot, qty: String(l.qty) })) : [{ lot, qty: qty != null ? String(qty) : '' }]))
  const [ref, setRef] = useState(startRef ?? '')
  const [added, setAdded] = useState(false)
  const [po, setPo] = useState(order ?? '')
  const change = (i: number, patch: Partial<{ lot: string; qty: string }>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const nums = rows.map((r) => Number(r.qty))
  const repeated = rows.some((r, i) => !!r.lot.trim() && rows.findIndex((o) => o.lot.trim() === r.lot.trim()) !== i)
  const ok = !repeated && rows.every((r, i) => !!r.lot.trim() && r.qty.trim() !== '' && Number.isFinite(nums[i]) && nums[i] > 0)
  const total = nums.reduce((t, n) => t + (Number.isFinite(n) ? n : 0), 0)
  const save = () => {
    if (!ok) return
    const parts = rows.map((r, i) => ({ lot: r.lot.trim(), qty: nums[i] }))
    // all of it of the run's own lot is the plain case: nothing to write beside the quantity
    onPick(total, ref.trim(), parts.length === 1 && parts[0].lot === lot ? undefined : parts, orders?.length ? po || undefined : undefined)
  }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <form onSubmit={(e) => { e.preventDefault(); save() }} className="qform">
          {rows.map((r, i) => (
            <div className="lotrow" key={i}>
              <label>Lote <input inputMode="numeric" placeholder="ej. 6280" value={r.lot} autoFocus={added && i === rows.length - 1} onChange={(e) => change(i, { lot: e.target.value })} autoComplete="off" /></label>
              <label>{unit} <input inputMode="numeric" placeholder={unit} value={r.qty} autoFocus={!added && i === 0 && qty == null && !start} onChange={(e) => change(i, { qty: e.target.value.replace(/\D/g, '') })} /></label>
              {rows.length > 1 && <button type="button" className="lnk" title="Quitar este lote" onClick={() => setRows(rows.filter((_, k) => k !== i))}>✕</button>}
            </div>
          ))}
          <button type="button" className="lnk addlot" onClick={() => { setAdded(true); setRows([...rows, { lot: '', qty: '' }]) }}>+ Otro lote en este {unit === 'cajas' ? 'pallet' : 'mismo'}</button>
          {rows.length > 1 && <p className="lottotal">Total: <b>{total} {unit}</b> en {rows.length} lotes</p>}
          {repeated && <span className="err">Ese lote ya está en la lista: suma sus {unit} en una sola línea.</span>}
          {refLabel && <label>{refLabel} <small>(opcional)</small> <input inputMode="numeric" placeholder="ej. 1749" value={ref} onChange={(e) => setRef(e.target.value)} autoComplete="off" /></label>}
          {orders && orders.length > 0 && (
            <label>Pedido <small>(a cuál va)</small>
              <select value={po} onChange={(e) => setPo(e.target.value)}>
                <option value="">Sin pedido</option>
                {orders.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
          )}
          <div className="dbtns">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn primary" disabled={!ok}>✓ Guardar</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** departments that type how much a unit carried (boxes on a pallet or in a bin) and its tag / bin number */
/** a quantity already suggested (pouches per cart, cases per pallet) opens without the keyboard: a tap on "Guardar" takes it, a tap on the box changes it */
function QtyDialog({ title, unit, refLabel, initial, decimal, perCase, onClose, onPick }: { title: string; unit: string; refLabel: string; initial: number | null; decimal?: boolean; perCase?: number; onClose: () => void; onPick: (q: number, ref: string) => void }) {
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
          <label>{unit} <input autoFocus={initial == null} inputMode={decimal ? 'decimal' : 'numeric'} placeholder={unit} value={v} onChange={(e) => setV(clean(e.target.value))} /></label>
          {perCase && ok ? <p className="incases">= {casesText({ cases: Math.floor(n / perCase), loose: Math.round((n - Math.floor(n / perCase) * perCase) * 100) / 100 })} <small>({perCase} por caja)</small></p> : null}
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

/** what makes the report's PDF and Excel files; it rejects when they cannot be fetched (no signal, and never loaded on this device) */
const libraries = () => Promise.all([loadPdf(), loadZip()])
const MISSING = 'Faltan partes de la app que se bajan con WiFi la primera vez. Conéctate, abre la app y vuelve a intentarlo. Si sigue pasando, avísale a quien lleva la app.'
/** saves a file made by the app to the device, the way the browser saves any download */
function download(f: File) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(f); a.download = f.name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
}

/** the manager types the goal of one line: so much per hour and/or in the whole day. It shows on that line's card */
function LineTargetDialog({ line, unit, goal, onClose }: { line: Line; unit: string; goal: LineTarget | undefined; onClose: () => void }) {
  const [hour, setHour] = useState(goal?.perHour ? String(goal.perHour) : '')
  const [whole, setWhole] = useState(goal?.perDay ? String(goal.perDay) : '')
  const num = (t: string) => { const x = Number(t); return x > 0 ? x : null }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>Meta de {line.name} · {line.dept}</h3>
        <p>Sale en la tarjeta de esta línea, en todas las tablets, y queda en el historial. Deja en blanco la que no aplique. El ritmo de la línea sale en rojo cuando baja de su meta por hora. La meta de todo {line.dept} junto se pone arriba, en "Hoy en {line.dept}".</p>
        <form onSubmit={(e) => { e.preventDefault(); setLineTarget(line, num(hour), num(whole)); onClose() }} className="qform">
          <label>Por hora <input inputMode="numeric" placeholder={'ej. 150 ' + unit} value={hour} onChange={(e) => setHour(e.target.value.replace(/\D/g, ''))} /></label>
          <label>En el día completo <small>(los dos turnos)</small> <input inputMode="numeric" placeholder={'ej. 2400 ' + unit} value={whole} onChange={(e) => setWhole(e.target.value.replace(/\D/g, ''))} /></label>
          <div className="dbtns spread">
            <div className="btns">{goal?.perHour || goal?.perDay ? <button type="button" className="lnk" onClick={() => { setLineTarget(line, null, null); onClose() }}>Quitar meta</button> : null}</div>
            <div className="btns">
              <button type="button" className="btn" onClick={onClose}>Cancelar</button>
              <button type="submit" className="btn primary">✓ Guardar</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * The manager moves the hours of the shifts (the plant has changed them more than once). They count from a date on, so
 * the days before it are still split with the hours they had.
 */
function ShiftsDialog({ s, date, onClose }: { s: State; date: string; onClose: () => void }) {
  const cur = shiftsOf(s, date)
  const [from, setFrom] = useState(date)
  const [h, setH] = useState<ShiftHours>({ first: cur.first, firstEnd: cur.firstEnd, second: cur.second, secondEnd: cur.secondEnd })
  const problem = shiftsProblem(h), cuts = problem ? null : shiftCuts(h)
  const field = (key: keyof ShiftHours, label: string) => <label>{label} <input type="time" value={h[key]} onChange={(e) => setH({ ...h, [key]: e.target.value })} /></label>
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>Horario de los turnos</h3>
        <p>Lo ven todos los aparatos y queda en el historial. Los días anteriores a la fecha que pongas siguen con el horario que tenían.</p>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); if (!problem && from && setShifts(from, h)) onClose() }}>
          <div className="egrid">{field('first', 'Turno 1 empieza')}{field('firstEnd', 'Turno 1 termina')}{field('second', 'Turno 2 empieza')}{field('secondEnd', 'Turno 2 termina')}</div>
          <label>Vale desde el día <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          {cuts
            ? <p className="hint">Cada registro cuenta para un turno por su hora: hasta las <b>{minuteText(cuts.toSecond)}</b> es del turno 1 y después del turno 2. Pasada la medianoche sigue siendo del turno 2 hasta las <b>{minuteText(cuts.toFirst)}</b>. El corte es la mitad del rato entre un turno y el otro, para que quien se queda un poco o llega un poco antes cuente con su turno. El tiempo nunca se detiene solo: quien sigue trabajando después de su hora, o empieza antes, sigue contando. Solo cuando ya pasó el rato entre un turno y el otro, si en una línea nadie registró nada en todo ese rato, ese rato se descuenta.</p>
            : <span className="err">{problem}</span>}
          <div className="dbtns">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn primary" disabled={!!problem || !from}>✓ Guardar</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** the report, ready to leave the app: share it with what this browser allows, download each file, or open a mail */
function SendDialog({ files, subject, onClose }: { files: Record<Kind, File>; subject: string; onClose: () => void }) {
  const [said, setSaid] = useState('')
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  const pick = sharePick((kinds) => !!nav.share && !!nav.canShare?.({ files: kinds.map((k) => files[k]) }))
  const share = () => {
    if (!pick) return
    setSaid('')
    // asked in the tap itself, with the files already made: a browser only opens its share sheet for a tap
    nav.share({ files: pick.files.map((k) => files[k]), title: subject, text: subject }).then(() => setSaid('Listo.'), (e: unknown) => setSaid(shareProblem(e)))
  }
  const save = (k: Kind) => { download(files[k]); setSaid('Descargado: ' + files[k].name + '. Queda en la carpeta de Descargas de este aparato.') }
  const mail = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent('Adjunto el reporte del día (PDF y Excel).')
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg send" onClick={(e) => e.stopPropagation()}>
        <h3>Enviar el reporte</h3>
        <p>{pick ? 'Toca "Compartir" y elige el correo o WhatsApp. También puedes descargar los archivos y adjuntarlos tú.' : 'Descarga los dos archivos y adjúntalos al correo o al mensaje.'}</p>
        {pick && <button type="button" className="btn primary" onClick={share}>↗ {pick.label}</button>}
        {pick?.note && <small>{pick.note}</small>}
        <div className="btns">
          <button type="button" className="btn" onClick={() => save('pdf')}>⬇ PDF</button>
          <button type="button" className="btn" onClick={() => save('xlsx')}>⬇ Excel</button>
          <a className="btn" href={mail}>✉ Abrir un correo</a>
        </div>
        {said && <p className="said" role="status">{said}</p>}
        <div className="dbtns"><button type="button" className="btn" onClick={onClose}>Cerrar</button></div>
      </div>
    </div>
  )
}

/** the shift somebody chose to look at in the report, kept while the app stays open (null = none chosen: the report decides) */
let shiftChosen: 0 | 1 | 2 | null = null

function Report({ s, now, only, mgr, admin, wholeDay }: { s: State; now: number; only?: Dept; mgr: boolean; admin: boolean; wholeDay: boolean }) {
  const can = useCan(), who = useWho()
  const [date, setDate] = useState(() => workDay(s).date)
  const [wiping, setWiping] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)
  const [newPin, setNewPin] = useState('')
  const [editRun, setEditRun] = useState<string | null>(null)
  const [editStop, setEditStop] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState<{ title: string; text?: string } | null>(null)
  const [sending, setSending] = useState<Record<Kind, File> | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [fCode, setFCode] = useState('')
  const [fLot, setFLot] = useState('')
  // The people of a shift open the report on their own shift: the one saved for them, or else the one in course on the
  // day in course. The other shift
  // and the whole day are one choice away, and what they choose stays while the app is open. The office and the owner
  // open it on the whole day, and so does anybody looking at another date.
  const [shiftPick, setShiftPick] = useState<0 | 1 | 2 | null>(shiftChosen)
  const ownShift: 0 | 1 | 2 = who.shift ? who.shift : !wholeDay && date === workDay(s, now).date ? shiftAt(shiftsOf(s, date), now) : 0
  const fShift = shiftPick ?? ownShift
  const setFShift = (k: 0 | 1 | 2) => { shiftChosen = k; setShiftPick(k) }
  const [shiftsOpen, setShiftsOpen] = useState(false)
  // long lists show ten lines at a time (the files always carry everything)
  const [more, setMore] = useState<Record<string, number>>({})
  useEffect(() => { setMore({}) }, [date, fCode, fLot, fShift])
  const PAGE = 10
  const cut = <T,>(key: string, list: T[]) => list.slice(0, more[key] ?? PAGE)
  const moreBar = (key: string, total: number) => {
    const shown = Math.min(more[key] ?? PAGE, total)
    if (total <= PAGE) return null
    return (
      <div className="morebar">
        <span>Se ven {shown} de {total}</span>
        {shown < total && <button type="button" className="btn" onClick={() => setMore({ ...more, [key]: shown + PAGE })}>Mostrar {Math.min(PAGE, total - shown)} más</button>}
        {shown < total && <button type="button" className="lnk" onClick={() => setMore({ ...more, [key]: Number.MAX_SAFE_INTEGER })}>Mostrar todo</button>}
        {shown > PAGE && <button type="button" className="lnk" onClick={() => setMore({ ...more, [key]: PAGE })}>Mostrar menos</button>}
      </div>
    )
  }
  const day = useDay(date)
  const runToEdit = editRun ? s.runs.find((r) => r.id === editRun) : undefined
  const stopToEdit = editStop ? s.stops.find((x) => x.id === editStop) : undefined
  // what makes the PDF and the Excel comes down when the report opens, so the tap that asks for a file finds it ready
  useEffect(() => { void libraries().catch(() => undefined) }, [])
  /** no button of the report fails without a word: what went wrong, and what to do */
  const failed = (what: string, e?: unknown) => { console.warn('actividad report', what, e); setNotice({ title: 'No se pudo ' + what, text: MISSING }) }
  /** opens the PDF in a new tab (to look at, share or print); where a tab cannot show it, it downloads */
  const pdf = async () => {
    try {
      const name = fileName + '.pdf'
      let doc = buildPdf(s, date, now, user.get(), filter)
      if (!doc) { await loadPdf(); doc = buildPdf(s, date, now, user.get(), filter); if (!doc) throw new Error('pdf'); doc.save(name); return }
      if (homeScreenApple(navigator as Parameters<typeof homeScreenApple>[0])) { doc.save(name); return }
      const win = window.open(doc.output('bloburl'), '_blank')
      if (!win) doc.save(name)
    } catch (e) { failed('abrir el PDF', e) }
  }
  // what the report holds, with the filter by code, by lot and by shift when one is chosen (the same for the screen and every file)
  const filter: ReportFilter = { only, code: fCode, lot: fLot, shift: fShift }
  const rep = reportOf(s, date, now, filter)
  const { runs, stops, rows, unitRows, working, down, byCode, setup } = rep
  const withOrders = unitRows.some((x) => x.order) // a column says the order of each pallet when any has one
  const unitsText = (dept: Dept, n: number) => n + ' ' + (n === 1 ? CFG[dept].unit : CFG[dept].plural).toLowerCase()
  const reasonsText = (x: (typeof rows)[number]) => Object.entries(x.st.reasons).map(([k, v]) => k + ' ' + fmtDur(v)).join(', ')
  const lineName = (x: { lineId: string | null; dept: Dept }) => (x.lineId === null ? 'Todo ' + x.dept : s.lines.find((l) => l.id === x.lineId)?.name ?? s.runs.find((r) => r.lineId === x.lineId)?.line ?? 'línea')
  const fileName = 'actividad-' + (only ? only.toLowerCase() + '-' : '') + date + filterFile(rep.code, rep.lot, rep.shift)
  // the history of that day (corrections, products, program, lines): the manager's and the office's
  const changes = mgr && !rep.filtered ? s.changes.filter((c) => !c.deleted && plainDay(s, c.at) === date && (!only || c.dept === only)).sort((a, b) => a.at - b.at) : []
  /** the report's three files, made at once; null while what makes them has not come down yet */
  const filesNow = (): Record<Kind, File> | null => {
    const doc = buildPdf(s, date, now, user.get(), filter), bytes = xlsxNow(sheets())
    if (!doc || !bytes) return null
    return { pdf: new File([doc.output('blob')], fileName + '.pdf', { type: 'application/pdf' }), xlsx: new File([bytes], fileName + '.xlsx', { type: XLSX_TYPE }), csv: new File([csvText()], fileName + '.csv', { type: 'text/csv' }) }
  }
  /**
   * "Enviar reporte" makes the files and opens a box with what this device can do with them (share them, download
   * them, open a mail). The sharing itself is a button of that box: a browser only opens its share sheet for a tap,
   * and by then the files are ready. Nothing here happens without the person seeing it.
   */
  const send = async () => {
    try {
      let files = filesNow()
      if (!files) { setPreparing(true); try { await libraries() } finally { setPreparing(false) } files = filesNow() }
      if (!files) throw new Error('files')
      setSending(files)
    } catch (e) { failed('preparar el reporte', e) }
  }
  /** the day's tables, typed (numbers, times, spans) so Excel can sort and add them; the CSV takes the same as text */
  const blocks = () => {
    const T = (ms: number) => xTime(ms, fmtTime(ms)), D = (ms: number) => xDur(ms, fmtDur(ms))
    const resumen: Cell[][] = [['Departamento', 'Línea', 'Código', 'Lote', 'Fecha', 'Inicio', 'Fin', 'Unidad', 'Hechas', 'Cantidad', 'Unidad de cantidad', 'Tags / bins', 'Waste (lb)', 'Tiempo trabajando', 'Promedio por unidad', 'Tiempo parado', 'Razones de paro', 'Registró', 'Turno'],
      ...rows.map((x): Cell[] => [x.r.dept, lineNameOf(s, x.r.lineId, x.r.line), x.r.code, x.lots, xDay(x.r.date), T(x.r.startedAt), x.r.endedAt ? T(x.r.endedAt) : 'en curso', CFG[x.r.dept].unit, x.units, CFG[x.r.dept].qty !== 'none' ? x.qty : '', CFG[x.r.dept].qty !== 'none' ? CFG[x.r.dept].qtyUnit : '', x.view.units.map((u) => u.ref).filter(Boolean).join(', '), x.waste || '', D(x.st.working), x.timed ? D(x.st.avg) : '', D(x.st.down), reasonsText(x), whoText(x.r), rep.shift ? String(rep.shift) : x.shifts])]
    const boxes = (c: (typeof byCode)[number]) => (CFG[c.dept].qtyUnit === 'pouches' ? inCases(s, c.code, c.qty) : null)
    const porCodigo: Cell[][] = [['Departamento', 'Código', 'Unidad', 'Hechas', 'Cantidad', 'Unidad de cantidad', 'Waste (lb)', 'Líneas', 'Cajas completas', 'Pouches sueltos', ...(rep.shift ? [] : ['Turno 1', 'Turno 2'])],
      ...byCode.map((c): Cell[] => [c.dept, c.code, CFG[c.dept].unit, c.units, CFG[c.dept].qty !== 'none' ? c.qty : '', CFG[c.dept].qty !== 'none' ? CFG[c.dept].qtyUnit : '', c.waste || '', c.lines.join(', '), boxes(c)?.cases ?? '', boxes(c)?.loose ?? '', ...(c.byShift ?? [])])]
    const unidades: Cell[][] = [['Departamento', 'Línea', 'Código', 'Lote', '#', 'Hora', 'Unidad', 'Cantidad', 'Unidad de cantidad', 'Tag / bin', 'Desde la anterior', 'Registró', 'Turno', 'Pedido'],
      ...unitRows.map((x): Cell[] => [x.r.dept, lineNameOf(s, x.r.lineId, x.r.line), x.r.code, x.lot, x.i + 1, T(x.u.at), CFG[x.r.dept].unit, x.qty ?? '', x.qty != null ? CFG[x.r.dept].qtyUnit : '', x.u.ref, D(x.gap), x.u.by, x.shift, x.order])]
    const paros: Cell[][] = [['Departamento', 'Línea', 'Razón', 'Detalle', 'Inicio', 'Fin', 'Duración', 'Registró', 'Turno'],
      ...stops.map((x): Cell[] => [x.dept, lineName(x), x.reason, x.note, T(x.startedAt), x.endedAt ? T(x.endedAt) : 'en curso', D(x.ms), x.by, spanShifts(rep.plan, x.startedAt, x.endedAt ?? now)])]
    // the whole day first and each shift under it (not when the report is of one shift only)
    const porTurno: Cell[][] = [['Departamento', 'Turno', 'Horario', 'Códigos', 'Hechas', 'Unidad', 'Cantidad', 'Unidad de cantidad', 'Waste (lb)', 'Tiempo trabajando', 'Tiempo parado', 'Set up'],
      ...rep.byShift.flatMap((d) => [d.day, d.first, d.second].map((x): Cell[] => [d.dept, x.shift ? 'Turno ' + x.shift : 'Total del día', x.shift ? shiftHours(rep.plan, x.shift) : '', x.codes, x.units, CFG[d.dept].unit, CFG[d.dept].qty !== 'none' ? x.qty : '', CFG[d.dept].qty !== 'none' ? CFG[d.dept].qtyUnit : '', x.waste || '', D(x.working), D(x.down), x.setup ? D(x.setup) : '']))]
    const cambios: Cell[][] = [['Hora', 'Quién', 'Departamento', 'Qué', 'Antes', 'Después'], ...changes.map((c): Cell[] => [T(c.at), c.by, c.dept ?? '', c.what, c.before, c.after])]
    const av = mgr && !only && !rep.filtered ? avanceRows(s, date) : []
    const avance: Cell[][] = [['Código', 'Producto', 'Mezclas progr.', 'Mezclas hechas', 'Mezclas pend.', 'Spiral', 'Pouches progr.', 'Pouches esper.', 'Pouches hechos', 'Pouches pend.', 'Pouches faltan', 'Cajas progr.', 'Cajas esper.', 'Cajas hechas', 'Cajas pend.', 'Cajas faltan', 'MFO cajas', 'Pallets progr.', 'Pallets esper.', 'Pallets hechos', 'Waste lb'],
      ...av.map((r): Cell[] => [r.code, r.product?.name ?? '', r.scheduled, r.mixesDone, r.mixesPending, r.spiralDone, r.pouchesPlan, r.pouchesExp, r.pouchesDone, pending(r.pouchesExp, r.pouchesDone), pending(r.pouchesPlan, r.pouchesDone), r.casesPlan, r.casesExp, r.casesDone, pending(r.casesExp, r.casesDone), pending(r.casesPlan, r.casesDone), r.mfoCases, r.palletsPlan, r.palletsExp, r.palletsDone, r.wasteLb])]
    return { resumen, porTurno, porCodigo, unidades, paros, cambios, avance }
  }
  /** the Excel file's sheets: one per table (Cambios and Avance only for the manager and the office) */
  const sheets = (): Sheet[] => {
    const b = blocks()
    return [{ name: 'Resumen', rows: b.resumen }, ...(b.porTurno.length > 1 ? [{ name: 'Por turno', rows: b.porTurno }] : []), { name: 'Por código', rows: b.porCodigo }, { name: 'Unidades', rows: b.unidades }, { name: 'Paros', rows: b.paros }, ...(mgr ? [{ name: 'Cambios', rows: b.cambios }] : []), ...(b.avance.length > 1 ? [{ name: 'Avance', rows: b.avance }] : [])]
  }
  const excel = async () => {
    try {
      const bytes = xlsxNow(sheets()) ?? (await loadZip(), xlsxNow(sheets()))
      if (!bytes) throw new Error('xlsx')
      download(new File([bytes], fileName + '.xlsx', { type: XLSX_TYPE }))
    } catch (e) { failed('hacer el Excel', e) }
  }
  const csv = () => download(new File([csvText()], fileName + '.csv', { type: 'text/csv;charset=utf-8' }))
  const csvText = () => {
    const q = (c: Cell) => '"' + cellText(c).replace(/"/g, '""') + '"'
    const b = blocks()
    const tag = (title: string, t: Cell[][]) => t.map((r, i): Cell[] => (i === 0 ? ['', title, ...r] : ['', '', ...r]))
    const all: Cell[][] = [...b.resumen, ...(b.porTurno.length > 1 ? [[], ...tag('POR TURNO', b.porTurno)] : []), [], ...tag('POR CÓDIGO', b.porCodigo), [], ...tag('UNIDADES', b.unidades), [], ...tag('PAROS', b.paros), ...(mgr ? [[], ...tag('CAMBIOS', b.cambios)] : []), ...(b.avance.length > 1 ? [[], ...tag('AVANCE', b.avance)] : [])]
    return '\ufeff' + all.map((r) => r.map(q).join(',')).join('\r\n')
  }
  return (
    <section className="report">
      <div className="rhead">
        <h2>Reporte del día{only ? ' · ' + only : ''}</h2>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        {rep.codes.length > 0 && <select className="rfilter" value={rep.code} onChange={(e) => setFCode(e.target.value)} aria-label="Filtrar por código"><option value="">Todos los códigos</option>{rep.codes.map((c) => <option key={c} value={c}>Código {c}</option>)}</select>}
        {rep.lots.length > 0 && <select className="rfilter" value={rep.lot} onChange={(e) => setFLot(e.target.value)} aria-label="Filtrar por lote"><option value="">Todos los lotes</option>{rep.lots.map((l) => <option key={l} value={l}>Lote {l}</option>)}</select>}
        <select className="rfilter" value={rep.shift} onChange={(e) => setFShift(Number(e.target.value) as 0 | 1 | 2)} aria-label="Filtrar por turno"><option value={0}>Los dos turnos</option><option value={1}>Turno 1</option><option value={2}>Turno 2</option></select>
        <button type="button" className="btn" onClick={() => void excel()} disabled={!rows.length}>⬇ Excel</button>
        <button type="button" className="lnk" onClick={csv} disabled={!rows.length}>CSV</button>
        <button type="button" className="btn" onClick={() => void pdf()} disabled={!rows.length}>📄 Ver PDF / imprimir</button>
        <button type="button" className="btn primary" onClick={() => void send()} disabled={!rows.length || preparing}>{preparing ? 'Preparando…' : '✉ Enviar reporte'}</button>
      </div>
      {sending && <SendDialog files={sending} subject={'Actividad · Reporte ' + date + (only ? ' · ' + only : '') + filterTitle(rep.code, rep.lot, rep.shift)} onClose={() => setSending(null)} />}
      <DayNote day={day} />
      <p className="shiftnote">Turno 1: <b>{shiftHours(rep.plan, 1)}</b> · Turno 2: <b>{shiftHours(rep.plan, 2)}</b>{can('shifts') && <> <button type="button" className="lnk" onClick={() => setShiftsOpen(true)}>Cambiar horario</button></>}</p>
      {shiftsOpen && <ShiftsDialog s={s} date={date} onClose={() => setShiftsOpen(false)} />}
      {!!rep.shift && shiftPick === null && !rep.code && !rep.lot && <p className="filternote">Estás viendo tu turno, el <b>Turno {rep.shift}</b>. Para ver el otro turno o el día completo, cámbialo arriba donde dice "Turno {rep.shift}". Los archivos salen con lo que estés viendo. <button type="button" className="lnk" onClick={() => setFShift(0)}>Ver los dos turnos</button></p>}
      {rep.filtered && !(shiftPick === null && !rep.code && !rep.lot) && <p className="filternote">Reporte filtrado{filterTitle(rep.code, rep.lot, rep.shift)}. El Excel, el CSV, el PDF y "Enviar reporte" salen con este filtro.{rep.lot && !rep.shift && ' Los tiempos y el waste son los de las corridas completas.'}{!!rep.shift && ' Un código que pasó de un turno al otro sale aquí con lo que hizo en este turno; su waste se reparte según lo hecho en cada uno.'} <button type="button" className="lnk" onClick={() => { setFCode(''); setFLot(''); setFShift(0) }}>Quitar filtros</button></p>}
      <div className="totals">
        <div className="stat"><label>Códigos</label><b>{rows.length}</b></div>
        <div className="stat"><label>Trabajando</label><b>{fmtDur(working)}</b></div>
        <div className="stat"><label>Parado</label><b className={down ? 'red' : ''}>{fmtDur(down)}</b></div>
        {setup > 0 && <div className="stat"><label>Set up</label><b>{fmtDur(setup)}</b></div>}
      </div>
      {rep.byShift.length > 0 && (
        <>
          <h3>Total del día y cada turno</h3>
          <div className="twrap">
            <table className="byshift">
              <thead><tr><th>Depto</th><th></th><th>Códigos</th><th>Hechas</th><th>Cantidad</th><th>Waste</th><th>Trabajando</th><th>Parado</th><th>Set up</th></tr></thead>
              <tbody>{rep.byShift.flatMap((d) => [d.day, d.first, d.second].map((x) => (
                <tr key={d.dept + x.shift} className={x.shift ? '' : 'daytotal'}>
                  <td>{x.shift ? '' : d.dept}</td><td>{x.shift ? <>Turno {x.shift} <small>{shiftHours(rep.plan, x.shift)}</small></> : 'Total del día'}</td><td>{x.codes}</td><td>{unitsText(d.dept, x.units)}</td>
                  <td>{CFG[d.dept].qty !== 'none' ? fmtN(x.qty) + ' ' + CFG[d.dept].qtyUnit : '—'}</td><td className={x.waste ? 'red' : ''}>{x.waste ? x.waste + ' lb' : '—'}</td><td>{fmtDur(x.working)}</td><td className={x.down ? 'red' : ''}>{fmtDur(x.down)}</td><td>{x.setup ? fmtDur(x.setup) : '—'}</td>
                </tr>
              )))}</tbody>
            </table>
          </div>
          <p className="hint">Se reparte por la hora de cada registro. Un código que pasó de un turno al otro cuenta en los dos, cada uno con lo suyo; su waste se reparte según lo hecho en cada turno. El tiempo nunca se detiene solo. Cuando ya pasó el rato entre un turno y el otro, si en una línea nadie registró nada en todo ese rato, ese rato no cuenta.</p>
        </>
      )}
      {rows.length === 0 ? <p className="hint">{day.state === 'here' ? (rep.shift ? 'Nada registrado en este turno.' : 'Nada registrado en esta fecha.') : ''}</p> : (
        <>
        <div className="twrap">
          <table>
            <thead><tr><th>Depto</th><th>Línea</th><th>Código</th><th>Lote</th>{!rep.shift && <th>Turno</th>}<th>Inicio</th><th>Fin</th><th>Hecho</th><th>Waste</th><th>Trabajando</th><th>Prom./unidad</th><th>Parado</th><th>Razones</th><th>Registró</th><th></th></tr></thead>
            <tbody>{cut('runs', rows).map((x) => (
              <tr key={x.r.id} className={x.r.endedAt ? '' : 'live'}>
                <td>{x.r.dept}</td><td>{lineNameOf(s, x.r.lineId, x.r.line)}</td><td><b>{x.r.code}</b></td><td>{x.lots}</td>{!rep.shift && <td>{x.shifts}</td>}<td>{fmtTime(x.r.startedAt)}</td><td>{x.r.endedAt ? fmtTime(x.r.endedAt) : <i>en curso</i>}</td>
                <td>{madeText(x.view, x.qty, true)}</td><td className={x.waste ? 'red' : ''}>{x.waste ? x.waste + ' lb' : '—'}</td><td>{fmtDur(x.st.working)}</td><td>{x.timed ? fmtDur(x.st.avg) : '—'}</td><td className={x.st.down ? 'red' : ''}>{fmtDur(x.st.down)}</td><td>{reasonsText(x) || '—'}</td><td>{whoText(x.r)}</td>
                <td>{can('fix') && canShift(who, x.shifts) && <button type="button" className="lnk" onClick={() => setEditRun(x.r.id)}>Corregir</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {moreBar('runs', rows.length)}
        </>
      )}
      {byCode.length > 0 && (
        <>
          <h3>Por código · todas las líneas juntas</h3>
          <div className="twrap">
            <table>
              <thead><tr><th>Depto</th><th>Código</th><th>Hechas</th><th>Cantidad</th>{!rep.shift && <><th>Turno 1</th><th>Turno 2</th></>}<th>En cajas</th><th>Waste</th><th>Líneas</th></tr></thead>
              <tbody>{cut('codes', byCode).map((c) => (
                <tr key={c.dept + c.code}><td>{c.dept}</td><td><b>{c.code}</b></td><td>{c.units} {(c.units === 1 ? CFG[c.dept].unit : CFG[c.dept].plural).toLowerCase()}</td><td>{CFG[c.dept].qty !== 'none' ? <b>{fmtN(c.qty)} {CFG[c.dept].qtyUnit}</b> : '—'}</td>{c.byShift && <><td>{c.byShift[0] ? fmtN(c.byShift[0]) : '—'}</td><td>{c.byShift[1] ? fmtN(c.byShift[1]) : '—'}</td></>}<td>{(CFG[c.dept].qtyUnit === 'pouches' && casesText(inCases(s, c.code, c.qty))) || '—'}</td><td className={c.waste ? 'red' : ''}>{c.waste ? c.waste + ' lb' : '—'}</td><td>{c.lines.join(', ')}</td></tr>
              ))}</tbody>
            </table>
          </div>
          {moreBar('codes', byCode.length)}
        </>
      )}
      {unitRows.length > 0 && (
        <>
          <h3>Detalle por unidad · {unitRows.length}</h3>
          <div className="twrap">
            <table>
              <thead><tr><th>Hora</th>{!rep.shift && <th>Turno</th>}<th>Depto</th><th>Línea</th><th>Código</th><th>Lote</th><th>#</th><th>Unidad</th><th>Cantidad</th><th>Tag / bin</th>{withOrders && <th>Pedido</th>}<th>Desde la anterior</th><th>Registró</th></tr></thead>
              <tbody>{cut('units', unitRows).map((x) => (
                <tr key={x.r.id + ':' + x.i + ':' + x.lot}>
                  <td>{fmtTime(x.u.at)}</td>{!rep.shift && <td>{x.shift}</td>}<td>{x.r.dept}</td><td>{lineNameOf(s, x.r.lineId, x.r.line)}</td><td><b>{x.r.code}</b></td><td>{x.lot}</td><td>{x.i + 1}</td><td>{CFG[x.r.dept].unit}</td>
                  <td>{x.qty != null ? x.qty + ' ' + CFG[x.r.dept].qtyUnit : '—'}{x.qty != null && CFG[x.r.dept].qtyUnit === 'pouches' && x.r.perUnit != null && x.qty < x.r.perUnit && !!inCases(s, x.r.code, x.qty) && <small> · {casesText(inCases(s, x.r.code, x.qty))}</small>}</td><td>{x.u.ref || '—'}</td>{withOrders && <td>{x.order || '—'}</td>}<td>{fmtDur(x.gap)}</td><td>{x.u.by || '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {moreBar('units', unitRows.length)}
        </>
      )}
      {stops.length > 0 && (
        <>
          <h3>Paros</h3>
          <div className="twrap">
            <table>
              <thead><tr><th>Depto</th><th>Línea</th><th>Razón</th><th>Detalle</th>{!rep.shift && <th>Turno</th>}<th>Inicio</th><th>Fin</th><th>Duración</th><th>Registró</th><th></th></tr></thead>
              <tbody>{cut('stops', stops).map((x) => (
                <tr key={x.id} className={x.endedAt ? '' : 'live'}>
                  <td>{x.dept}</td><td>{lineName(x)}</td><td><b>{x.reason}</b></td><td>{x.note || '—'}</td>{!rep.shift && <td>{spanShifts(rep.plan, x.startedAt, x.endedAt ?? now)}</td>}<td>{fmtTime(x.startedAt)}</td><td>{x.endedAt ? fmtTime(x.endedAt) : <i>en curso</i>}</td><td>{fmtDur(x.ms)}</td><td>{x.by}</td>
                  <td>{can('fix') && canShift(who, spanShifts(rep.plan, x.startedAt, x.endedAt ?? now)) && <button type="button" className="lnk" onClick={() => setEditStop(x.id)}>Corregir</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {moreBar('stops', stops.length)}
        </>
      )}
      {changes.length > 0 && (
        <>
          <h3>Cambios y correcciones · {changes.length}</h3>
          <div className="twrap">
            <table className="changes">
              <thead><tr><th>Hora</th><th>Quién</th><th>Depto</th><th>Qué</th><th>Antes</th><th>Después</th></tr></thead>
              <tbody>{cut('changes', changes).map((c) => (
                <tr key={c.id}><td>{fmtTime(c.at)}</td><td>{c.by}</td><td>{c.dept ?? '—'}</td><td>{c.what}</td><td className={c.before ? 'was' : ''}>{c.before || '—'}</td><td><b>{c.after || '—'}</b></td></tr>
              ))}</tbody>
            </table>
          </div>
          {moreBar('changes', changes.length)}
          <p className="hint">Cada corrección, cambio en la tabla de productos, en el programa del día o en las líneas queda aquí con quién lo hizo y a qué hora. Lo normal del día (carros, mezclas, paros) no sale aquí: ya lleva el nombre de quien lo registró.</p>
        </>
      )}
      <p className="hint foot">{supabase ? 'Todo se guarda en el servidor y se ve en vivo desde la oficina, el teléfono o la PC.' : 'Demo guardado en este dispositivo. La versión completa manda todo en vivo al manager (oficina, teléfono o PC) y exporta a Excel, PDF y Google Sheets como la Hoja de Freezer RTE.'}</p>
      {runToEdit && <RunEditor s={s} run={runToEdit} mgr={can('fix')} onClose={() => setEditRun(null)} />}
      {stopToEdit && <StopEditor stop={stopToEdit} mgr={can('fix')} onClose={() => setEditStop(null)} />}
      {mgr && (
        <div className="btns">
          {!supabase && <button type="button" className="lnk" onClick={() => setClearing(true)}>Reiniciar registros (conserva productos y líneas)</button>}
          <button type="button" className="lnk" onClick={() => setResetting(true)}>{supabase ? 'Limpiar este aparato y volver a bajar del servidor' : 'Borrar todo'}</button>
          {!supabase && <button type="button" className="lnk" onClick={() => { setNewPin(''); setPinOpen(true) }}>Cambiar código de manager</button>}
          {supabase && <button type="button" className="lnk" onClick={() => setUploading(true)}>Subir al servidor los registros de este aparato</button>}
          {admin && runs.length + stops.length > 0 && <button type="button" className="lnk" onClick={() => setWiping(true)}>Borrar todo lo registrado este día (pruebas)</button>}
        </div>
      )}
      {wiping && <WipeDayDialog s={s} date={date} onClose={() => setWiping(false)} onDone={setNotice} />}
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
