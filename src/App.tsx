import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { InputHTMLAttributes, ReactNode, Ref } from 'react'
import { addLine, addWaste, awayDay, byLineName, byShip, casesText, cancelDay, CFG, closeOrder, codeProblem, CRATES_PER_CART, dayOf, dayRecords, DEPTS, deptStop, deleteOrder, deptToday, dropSetup, endRun, endShift, endStop, fillUnit, fmtDur, fmtTime, freeLineNames, idleStop, inCases, KEEP_DAYS, lastEnded, lastPerUnit, leftOpen, LINE_NAME_MAX, lineLabel, lineNamed, lineNameOf, lineTargetOf, lotFor, madeText, minuteText, managerPin, mergeProducts, myDept, nextOrderFor, nightText, nearDay, normCode, noteLabel, numOf, openIn, openOrdersFor, openRun, openStop, orderCodes, orderLabel, orderMade, parseProductsCsv, plainDay, productOf, productsCsv, purgeDay, purgesOf, removeLine, removeProduct, renameLine, reopenRun, reset, restorePurged, resetRecords, role, runQty, runSince, runStats, saveOrder, saveProduct, setLineTarget, setSchedule, setShifts, setTarget, startDay, startRun, startSetup, startStop, stopTime, store, swapLineNames, targetOf, tidyLineName, turnOf, unitsText, savedText, shiftAt, shiftCuts, shiftHours, shiftSpan, shiftsOf, shiftsProblem, shortEnded, shortUnit, unitDone, user, workDay, workedSince, type Dept, type DeptCfg, type Line, type LineTarget, type Product, type LotPart, type Run, type Order, type ShiftHours, type Short, type State, type Target, type WorkDay } from './store'
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
import { leaveAsk, loadDay, startSync, syncStore, syncNow, unreachable, fetchPurged } from './sync'
import { storageFull } from './storage'
import { clockNow, clockOffText, otherZone, startClock } from './clock'
import { appUrl, qrPath } from './qr'
import { uploadAll } from './store'
import { Employees } from './Employees'
import { lang, locale, saveLang, tr } from './i18n'
import { trx } from './trx'

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
        <h3>{supabase ? tr('Abrir Actividad en otro aparato') : tr('Abrir el DEMO en otro aparato')}</h3>
        <p>{tr('Apunta la cámara del otro teléfono o tablet a este código y toca el enlace que sale.')}</p>
        <div className="qrbox">{qr ? <svg viewBox={'0 0 ' + qr.size + ' ' + qr.size} shapeRendering="crispEdges" role="img" aria-label={tr('Código QR de {0}', url)}><rect width={qr.size} height={qr.size} fill="#fff" /><path d={qr.d} fill="#000" /></svg> : <span>…</span>}</div>
        <code className="qrurl">{url}</code>
        <div className="btns">
          <button type="button" className="btn" onClick={() => void copy()}>{copied ? tr('✓ Copiado') : tr('Copiar enlace')}</button>
          {'share' in navigator && <button type="button" className="btn" onClick={() => { void navigator.share({ title: document.title, url }).catch(() => undefined) }}>{tr('Compartir enlace')}</button>}
        </div>
        <p className="hint">{trx('Para dejarla como app: en Android, los tres puntos de Chrome y "Instalar app" o "Agregar a pantalla principal". En iPhone o iPad, botón Compartir de Safari y "Agregar a inicio". {0}', supabase ? tr('La primera vez se entra con usuario y PIN, con WiFi.') : tr('Este es el DEMO: lo que se registre queda guardado solo en ese aparato.'))}</p>
        <div className="dbtns"><button type="button" className="btn primary" onClick={onClose}>{tr('Cerrar')}</button></div>
      </div>
    </div>
  )
}
/** a link that opens the QR code (on the entry screens, and for the manager beside their name) */
/** the app in the other language: the choice is of this device, it is kept, and the app loads again in it */
function LangSwitch() {
  const pick = (l: 'es' | 'en') => { if (l !== lang) { saveLang(l); location.reload() } }
  return (
    <span className="langsw" role="group" aria-label="Idioma / Language">
      <span className="globe" aria-hidden="true">🌐</span>
      <button type="button" className={lang === 'es' ? 'on' : ''} aria-pressed={lang === 'es'} title="Español" onClick={() => pick('es')}>ES</button>
      <button type="button" className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} title="English" onClick={() => pick('en')}>EN</button>
    </span>
  )
}
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
  const [name, setName] = useState(lineLabel(line ? line.name : freeLineNames(s, dept, 1)[0] ?? ''))
  const tidy = tidyLineName(name)
  const taken = tidy ? lineNamed(s, dept, tidy, line?.id) : undefined
  const same = !!line && tidy === line.name
  const others = line ? s.lines.filter((l) => l.dept === dept && l.id !== line.id).sort(byLineName) : []
  const save = () => { if (tidy && !taken && !same && (line ? renameLine(line.id, tidy) : addLine(dept, tidy))) onClose() }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{line ? tr('Nombre de {0}', lineLabel(line.name)) : tr('Agregar {0} en {1}', word, dept)}</h3>
        <p>{line ? tr('El nombre nuevo sale en todo lo registrado en ella: la pantalla, el reporte y los archivos. Los tiempos no cambian.') : tr('¿Cuál es? Ponle el nombre que tiene en la planta.')}</p>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); save() }}>
          <div className="chips">
            {freeLineNames(s, dept, 4).map((n) => <button key={n} type="button" className={'chip' + (tidy === n ? ' on' : '')} onClick={() => setName(lineLabel(n))}>{lineLabel(n)}</button>)}
            {others.map((o) => <button key={o.id} type="button" className={'chip swap' + (taken?.id === o.id ? ' on' : '')} title={tr('Intercambiar con {0}', lineLabel(o.name))} onClick={() => setName(lineLabel(o.name))}>⇄ {lineLabel(o.name)}</button>)}
          </div>
          <label>{tr('Nombre')}{' '}<input value={name} maxLength={LINE_NAME_MAX} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder={tr('ej. {0}', cfg.lineWord) + ' 2'} /></label>
          {taken && line && (
            <div className="swapbox">
              <span>{trx('Ya hay una {0} en {1}. Se pueden intercambiar: esta pasa a llamarse {2} y la otra {3}.', <b>{lineLabel(taken.name)}</b>, dept, <b>{lineLabel(taken.name)}</b>, <b>{lineLabel(line.name)}</b>)}</span>
              <button type="button" className="btn primary" onClick={() => { if (swapLineNames(line.id, taken.id)) onClose() }}>{tr('⇄ Intercambiar nombres')}</button>
            </div>
          )}
          {taken && !line && <span className="err">{trx('Ya hay una {0} en {1}. Elige otro nombre.', lineLabel(taken.name), dept)}</span>}
          <div className="dbtns">
            <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
            <button type="submit" className="btn primary" disabled={!tidy || !!taken || same}>{line ? tr('✓ Guardar') : tr('+ Agregar')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DayNote({ day }: { day: ReturnType<typeof useDay> }) {
  if (day.state === 'loading') return <p className="daynote">{tr('Trayendo ese día del servidor…')}</p>
  if (day.state === 'failed') return <p className="daynote warn">{trx('Este aparato guarda los últimos {0} días. Ese día está en el servidor y ahora no se pudo traer (sin señal).', KEEP_DAYS)}{' '}<button type="button" className="lnk" onClick={day.retry}>{tr('Reintentar')}</button></p>
  return null
}

export default function App() {
  return supabase ? <ServerApp /> : <DemoApp />
}

/** a device that was signed in before the last person was kept apart: what the app already had of them */
const previousMe = (): Me | null => { const name = user.get(), r = role.get(); return name && (r === 'op' || r === 'mgr') ? { id: '', name, username: '', role: r, dept: myDept.get() } : null }
const NO_SIGNAL = tr('Sin conexión con el servidor. La primera vez en este aparato hay que entrar con WiFi.')
/** said when the server itself ended the session of someone who was inside (a manager changed their PIN, the account was closed): never for lack of signal */
const CLOSED = tr('La sesión de este aparato se cerró. Pasa, por ejemplo, cuando te cambian el PIN. Entra otra vez.')

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
  if (me === 'loading') return <div className="gate"><LangSwitch /><h1>Actividad</h1><p>{tr('Entrando…')}</p></div>
  if (me === null) return <LoginGate error={err} onDone={entered} />
  if (me === 'none') return <NoRole onOut={out} onRetry={verify} />
  const home = isDept(me.dept) ? me.dept : DEPTS[0]
  if (me.role === 'op' && !isDept(me.dept)) return <NoRole onOut={out} onRetry={verify} text={tr('Tu usuario está en Actividad pero sin departamento. Pide al manager que te asigne uno.')} />
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
  const label = (show ? tr('Ocultar') + ' ' : tr('Ver') + ' ') + what
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
    if (!user || !secret) { setMsg(tr('Escribe tu usuario y tu PIN.')); return }
    setBusy(true); setMsg('')
    await signedOut() // a "Salir" still finishing must be over first, or it could clear the session about to be made
    const { error: e } = await supabase!.auth.signInWithPassword({ email: loginEmail(user), password: secret })
    setBusy(false)
    if (e) { setMsg(/invalid/i.test(e.message) ? tr('Usuario o PIN incorrectos.') : /fetch|network/i.test(e.message) || unreachable(e.message) ? tr('Sin conexión. Revisa el WiFi e intenta otra vez.') : e.message); return }
    rememberUser(user)
    offerToSave(user.toLowerCase(), secret)
    await onDone()
  }
  const mail = u.includes('@')
  return (
    <div className="gate"><LangSwitch />
      <h1>Actividad</h1>
      <p>{tr('Entra con tu usuario y PIN (los mismos de Freezer RTE).')}</p>
      <form onSubmit={(e) => { e.preventDefault(); if (!busy) void go() }}>
        <input ref={userBox} autoFocus={!known} name="username" id="act-user" placeholder={tr('Usuario (o tu correo)')} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} />
        {/* a department user has a numeric PIN (number pad); an account typed as an e-mail has a real password, so the full keyboard */}
        <SecretInput inputRef={pinBox} autoFocus={known} name="password" id="act-pin" what={mail ? tr('la contraseña') : tr('el PIN')} hide={busy} inputMode={mail ? 'text' : 'numeric'} placeholder={mail ? tr('Contraseña') : 'PIN'} autoComplete="current-password" value={pin} onChange={setPin} />
        {msg && <span className="err">{msg}</span>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? tr('Entrando…') : tr('Entrar')}</button>
      </form>
      <small>{tr('Cada registro lleva el nombre de quien entró. Si no tienes usuario, pídelo al manager. Entras una vez y este aparato te recuerda hasta que toques "Salir".')}</small>
      <QrLink label={tr('Abrir en otro aparato (código QR)')} />
    </div>
  )
}

function NoRole({ onOut, onRetry, text }: { onOut: () => void; onRetry: () => void; text?: string }) {
  return (
    <div className="gate"><LangSwitch />
      <h1>Actividad</h1>
      <p>{text ?? tr('Tu usuario existe, pero todavía no tiene acceso a Actividad. Pide al manager que te lo active.')}</p>
      <div className="btns"><button type="button" className="btn" onClick={onRetry}>{tr('Reintentar')}</button><button type="button" className="lnk" onClick={onOut}>{tr('Cerrar sesión')}</button></div>
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
  const text = st.pending ? tr('Pendiente {0}', st.pending) : st.state === 'offline' ? tr('Sin conexión') : st.state === 'signedOut' ? tr('Sin sesión') : st.state === 'connecting' ? tr('Conectando…') : wrong ? tr('Con error') : tr('Sincronizado')
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
      <div className="gate"><LangSwitch />
        <h1>Actividad<span className="demotag">DEMO</span></h1>
        <p>{tr('¿De qué departamento eres?')}</p>
        <div className="pick">{DEPTS.map((d) => <button key={d} type="button" className="btn" onClick={() => onDept(d)}>{d}</button>)}</div>
        <QrLink label={tr('Abrir el demo en otro aparato (código QR)')} />
        {asking ? (
          <form onSubmit={(e) => { e.preventDefault(); if (pin === managerPin.get()) onManager(); else { setBad(true); setPin('') } }} className="mgrform">
            <label>{tr('Código de manager')}{' '}<SecretInput autoFocus what={tr('el código')} inputMode="numeric" placeholder={tr('código')} autoComplete="off" value={pin} onChange={(t) => { setPin(t); setBad(false) }} /></label>
            {bad && <span className="err">{tr('Código incorrecto.')}</span>}
            <div className="dbtns"><button type="button" className="btn" onClick={() => { setAsking(false); setPin(''); setBad(false) }}>{tr('Cancelar')}</button><button type="submit" className="btn primary" disabled={!pin}>{tr('Entrar como manager')}</button></div>
          </form>
        ) : <button type="button" className="lnk" onClick={() => setAsking(true)}>{tr('Soy el manager / oficina (todos los departamentos)')}</button>}
        <small>{tr('Demo · los datos se guardan solo en este dispositivo')}</small>
      </div>
    )
  }
  return (
    <div className="gate"><LangSwitch />
      <h1>Actividad<span className="demotag">DEMO</span></h1>
      <p>{trx('{0} · Ahora escribe tu nombre. Todo lo que registres lleva tu nombre.', <b>{mgr ? tr('Manager') : dept}</b>)}</p>
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) onName(v.trim()) }}>
        <input autoFocus placeholder={tr('Tu nombre')} value={v} onChange={(e) => setV(e.target.value)} />
        <button className="btn primary" type="submit" disabled={!v.trim()}>{tr('Entrar')}</button>
      </form>
      <button type="button" className="lnk" onClick={onBack}>{tr('Volver')}</button>
      <small>{tr('Demo · los datos se guardan solo en este dispositivo')}</small>
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
      {away ? <div className="zonebar">{tr('⚠ Este aparato está puesto en otra zona horaria que la planta: las horas y la fecha saldrán corridas. En los ajustes del aparato, activa la zona horaria automática.')}</div>
        : off && <div className="zonebar">{trx('⚠ El reloj de este aparato está {0}. La app usa la hora correcta, la del servidor. Para arreglarlo, activa la hora automática en los ajustes del aparato.', off)}</div>}
      {full && <div className="fullbar">{trx('⚠ La memoria de este aparato está llena y lo nuevo no se está guardando aquí. {0}', supabase ? tr('Lo que ya subió al servidor está a salvo. Avisa al manager y no cierres la app hasta que diga "Sincronizado".') : tr('Manda el reporte del día y avisa al manager antes de cerrar la app: hay que hacer espacio con "Reiniciar registros".'))}</div>}
      <header className="top">
        <div className="brand"><h1>Actividad{!supabase && <span className="demotag">DEMO</span>}</h1><small>{new Date(now).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</small></div>
        <nav className="tabs">
          <button type="button" className={tab === 'act' ? 'on' : ''} onClick={() => setTab('act')}>{tr('Actividad')}</button>
          {can('products') && <button type="button" className={tab === 'av' ? 'on' : ''} onClick={() => setTab('av')}>{tr('Avance')}</button>}
          <button type="button" className={tab === 'rep' ? 'on' : ''} onClick={() => setTab('rep')}>{tr('Reporte')}</button>
          {can('people') && supabase && <button type="button" className={tab === 'emp' ? 'on' : ''} onClick={() => setTab('emp')}>{tr('Empleados')}</button>}
        </nav>
        <div className="me"><SyncDot /> <span className="who">{name}</span><span className="where">{mgr ? tr('Manager') : home}</span> {mgr && <QrLink label="QR" />}<LangSwitch /><button type="button" className="lnk" onClick={() => setLeaving(true)}>{supabase ? tr('Salir') : tr('Cambiar')}</button></div>
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
        <h2>{tr('Avance del día')}</h2>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <form className="addcode" onSubmit={(e) => { e.preventDefault(); if (newCode.trim()) { typing.current.codes.add(normCode(newCode)); setSchedule(date, newCode, 0); setNewCode('') } }}>
          <input placeholder={tr('Código a programar')} value={newCode} onChange={(e) => setNewCode(e.target.value)} autoComplete="off" />
          <button className="btn" type="submit" disabled={!newCode.trim()}>{tr('+ Programar')}</button>
        </form>
        <button type="button" className="btn" onClick={() => setEditing(!editing)}>{editing ? tr('Cerrar productos') : tr('⚙ Productos')}</button>
      </div>
      <DayNote day={day} />
      <p className="hint">{trx('{0} = lo que da el programa del día (mezclas programadas × tabla de productos). {1} = lo que ya puede salir de las mezclas que Kitchen lleva hechas. {2} = esperado − hecho (rojo = se hizo de más). {3} = programado − hecho: lo que queda del día.', <b>{tr('Progr.')}</b>, <b>{tr('Esper.')}</b>, <b>{tr('Pend.')}</b>, <b>{tr('Faltan')}</b>)}</p>
      {editing && <Products s={s} />}
      {rows.length === 0 ? <p className="hint">{tr('Nada programado ni registrado en esta fecha. Escribe un código y toca "Programar".')}</p> : (
        <div className="twrap">
          <table>
            <thead>
              <tr><th rowSpan={2}>{tr('Código')}</th><th rowSpan={2}>{tr('Producto')}</th><th colSpan={3} className="grp g1">{tr('Mezclas (Kitchen)')}</th><th rowSpan={2} className="gs">Spiral</th><th colSpan={5} className="grp g2">{tr('Pouches (RTE)')}</th><th colSpan={5} className="grp g3">{tr('Cajas (Packing)')}</th><th rowSpan={2} className="gs">{tr('MFO cajas')}</th><th colSpan={3} className="grp g4">{tr('Pallets')}</th><th rowSpan={2} className="gs">{tr('Waste lb')}</th></tr>
              <tr><th className="g1 gs">{tr('Progr.')}</th><th className="g1">{tr('Hechas')}</th><th className="g1">{tr('Pend.')}</th><th className="g2 gs">{tr('Progr.')}</th><th className="g2">{tr('Esper.')}</th><th className="g2">{tr('Hechos')}</th><th className="g2">{tr('Pend.')}</th><th className="g2">{tr('Faltan')}</th><th className="g3 gs">{tr('Progr.')}</th><th className="g3">{tr('Esper.')}</th><th className="g3">{tr('Hechas')}</th><th className="g3">{tr('Pend.')}</th><th className="g3">{tr('Faltan')}</th><th className="g4 gs">{tr('Progr.')}</th><th className="g4">{tr('Esper.')}</th><th className="g4">{tr('Hechos')}</th></tr>
            </thead>
            <tbody>{rows.map((r) => (
              <tr key={r.code}>
                <td><b>{r.code}</b></td><td>{r.product?.name ?? <i className="red">{tr('no está en Productos')}</i>}</td>
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
            <tfoot><tr><td colSpan={2}>{tr('Total')}</td><td>{sum((r) => r.scheduled)}</td><td>{sum((r) => r.mixesDone)}</td><td>{sum((r) => r.mixesPending)}</td><td>{sum((r) => r.spiralDone)}</td><td>{n1(sum((r) => r.pouchesPlan))}</td><td>{n1(sum((r) => r.pouchesExp))}</td><td>{sum((r) => r.pouchesDone)}</td><td></td><td></td><td>{n1(sum((r) => r.casesPlan))}</td><td>{n1(sum((r) => r.casesExp))}</td><td>{sum((r) => r.casesDone)}</td><td></td><td></td><td>{sum((r) => r.mfoCases)}</td><td>{n1(sum((r) => r.palletsPlan))}</td><td>{n1(sum((r) => r.palletsExp))}</td><td>{sum((r) => r.palletsDone)}</td><td>{n1(Math.round(sum((r) => r.wasteLb) * 100) / 100)}</td></tr></tfoot>
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
  const refused = (why: 'taken' | 'blank', code: string) => setNotice(why === 'taken' ? { title: tr('Ya hay un producto con el código {0}', code.trim().toUpperCase()), text: tr('Cada código va una sola vez en la tabla. Corrige ese producto en su fila.') } : { title: tr('El código no puede quedar en blanco'), text: tr('Para sacar un producto de la tabla usa la ✕ de su fila.') })
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
      {removeIdx != null && <ConfirmDialog title={tr('¿Quitar {0} de la tabla?', (s.products[removeIdx]?.code || tr('este producto')))} yes={tr('Quitar')} danger onYes={() => { removeProduct(removeIdx); setRemoveIdx(null) }} onNo={() => setRemoveIdx(null)} />}
      {notice && <NoticeDialog title={notice.title} text={notice.text} onClose={() => setNotice(null)} />}
      {rename && <ConfirmDialog title={tr('¿Cambiar el código {0} por {1}', rename.from, rename.to) + '?'} text={tr('El producto {0}pasa a ser el {1}{2} y el código {3} sale de la tabla. Lo que ya se registró con {4} se queda con {5}. Si fue sin querer, toca Cancelar.', (rename.name ? '"' + rename.name + '" ' : ''), rename.to, (supabase ? ' ' + tr('en todas las tablets') : ''), rename.from, rename.from, rename.from)} yes={tr('Cambiar código')} onYes={doRename} onNo={() => setRename(null)} />}
      <div className="phead">
        <h3>{unlocked ? tr('✎ Editando productos') : tr('🔒 Productos · la tabla maestra de la oficina')}</h3>
        <div className="psearch">
          <input type="search" placeholder={tr('Buscar código o producto')} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" autoCapitalize="none" />
          {q && <button type="button" className="lnk" onClick={() => setQ('')}>✕</button>}
          <small>{needle ? tr('{0} de', shown.length) + ' ' : ''}{s.products.length}</small>
        </div>
        <button type="button" className={'btn' + (unlocked ? ' primary' : '')} onClick={() => setUnlocked(!unlocked)}>{unlocked ? tr('✓ Listo, bloquear') : tr('✎ Editar')}</button>
      </div>
      <div className="twrap">
        <table>
          <thead><tr><th>{tr('Código')}</th><th>{tr('Producto')}</th><th>{tr('Pouches / caja')}</th><th>{tr('Cajas / mezcla (yield)')}</th><th>{tr('Guacales / carro')}</th><th>{tr('Pouches / guacal')}</th><th>{tr('Cajas / pallet')}</th>{unlocked && <th></th>}</tr></thead>
          <tbody>
            {s.products.length === 0 && <tr><td colSpan={8}><i>{tr('No hay productos todavía.')}{!unlocked && ' ' + tr('Toca "Editar" para escribirlos o importar el CSV de la oficina.')}</i></td></tr>}
            {s.products.length > 0 && shown.length === 0 && <tr><td colSpan={8}><i>{trx('Ningún producto con "{0}".', q.trim())}</i></td></tr>}
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
        {unlocked && <button type="button" className="btn" onClick={() => { setQ(''); saveProduct(s.products.length, { code: '', name: '', pouchesPerCase: 0, casesPerMix: 0, cratesPerCart: CRATES_PER_CART, pouchesPerCrate: 0, casesPerPallet: 0, updatedAt: 0 }) }}>{tr('+ Agregar producto')}</button>}
        {unlocked && <label className="btn file">{tr('⬆ Importar CSV de la oficina')}
          <input type="file" accept=".csv,text/csv" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (!f) return
            const list = parseProductsCsv(await f.text())
            if (!list.length) { setNotice({ title: tr('No encontré productos en ese archivo'), text: tr('Debe tener una columna "Código" y una fila por producto.') }); return }
            mergeProducts(list); setNotice({ title: list.length + ' productos cargados', text: tr('Los códigos que ya existían se actualizaron; los nuevos se agregaron.') })
          }} />
        </label>}
        <button type="button" className="btn" onClick={exportCsv}>{tr('⬇ Exportar CSV')}</button>
      </div>
      <p className="hint">{unlocked
        ? tr('Cada cambio se guarda al salir de la casilla{0}. Columnas del CSV de la oficina: Código, Producto, Pouches por caja, Cajas por mezcla, Cajas por pallet, Guacales por carro, Pouches por guacal.', (supabase ? ' ' + tr('y baja a todas las tablets') : ''))
        : tr('{0} Para cambiar algo o importar el CSV de la oficina, toca "Editar".', (supabase ? tr('Con estos números se calculan el Avance y los pouches por carro en todas las tablets.') : tr('Los productos de ejemplo son inventados; todo se guarda solo en este dispositivo.')))}</p>
    </div>
  )
}

const longDate = (date: string) => new Date(date + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
const hhmm = (ms: number) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
/** the word to type before records are wiped: always a deliberate act, never a stray tap */
const WIPE_WORD = 'BORRAR'
const wipeOk = (typed: string) => typed.trim().toUpperCase() === WIPE_WORD
/** "1 corrida y 0 paros", "12 corridas y 1 paro" */
const howMany = (runs: number, stops: number) => tr('{0} y {1}', runs + ' ' + (runs === 1 ? tr('corrida') : tr('corridas')), stops + ' ' + (stops === 1 ? tr('paro') : tr('paros')))

/** which day of work it is, for everyone; the manager starts it here */
function DayBar({ s, now, day, mgr }: { s: State; now: number; day: WorkDay; mgr: boolean }) {
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<{ title: string; text?: string } | null>(null)
  if (!day.started && !mgr) return null
  return (
    <div className={'daybar' + (day.started ? ' on' : '')}>
      {day.started
        ? <span>{trx('Día de trabajo: {0} · empezó a las {1}', <b>{longDate(day.date)}</b>, <b>{fmtTime(day.started.at)}</b>)}{day.started.by ? ' · ' + day.started.by : ''}</span>
        : <span>{tr('El día de hoy todavía no se ha empezado.')}</span>}
      {mgr && <button type="button" className={day.started ? 'lnk' : 'btn primary'} onClick={() => setOpen(true)}>{day.started ? tr('Cambiar') : tr('▶ Empezar el día')}</button>}
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
  // taking away what is already recorded is the owner's alone: on 2026-10-13 a morning of work went that way by mistake
  const mayWipe = !!useWho().admin
  // an hour left as it came means "this very moment" (or the start it already had); a typed one is that hour, on the nearest day
  const at = time === opened ? (was ? was.at : now) : nearDay(was ? was.at : now, time)
  const date = was ? day.date : plainDay(s, at) // after midnight the second shift is still on its own day
  const lefts = leftOpen(s, date, at)
  const had = dayRecords(s, date, at)
  const some = had.runs.length + had.stops.length > 0
  const wipe = some && mayWipe && mine === 'wipe'
  const ok = !!time && (!wipe || wipeOk(word))
  const go = () => {
    if (!ok) return
    const r = startDay(time === opened && !was ? clockNow() : at, { date, finishLeft: lefts.length > 0 && left === 'finish', purge: wipe })
    onClose()
    const did = [r.ended ? (r.ended === 1 ? tr('Se terminó 1 línea que había quedado corriendo.') : tr('Se terminaron {0} líneas que habían quedado corriendo.', r.ended)) : '', r.runs + r.stops ? (r.runs + r.stops === 1 ? tr('De las pruebas se borró {0}', howMany(r.runs, r.stops)) : tr('De las pruebas se borraron {0}', howMany(r.runs, r.stops))) + '.' : ''].filter(Boolean)
    onDone({ title: was ? tr('Día actualizado') : tr('Día empezado'), text: did.join(' ') || tr('Los totales, la meta y la fecha de hoy ya siguen este día') + (supabase ? ' ' + tr('en todas las tablets.') : ' ' + tr('en este aparato.')) })
  }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{was ? tr('Día de trabajo') : tr('Empezar el día')}</h3>
        <p>{trx('Desde esa hora, "hoy" es el {0}{1}, hasta las {2} de la madrugada siguiente, cuando el turno 2 le entrega al turno 1. Un turno que pasa de la medianoche conserva su fecha y su lote.', <b>{longDate(date)}</b>, supabase ? ' ' + tr('en todas las tablets') : '', nightText(s, date))}</p>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); go() }}>
          <label>{tr('Hora en que empieza')}{' '}<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          {lefts.length > 0 && (
            <div className="tidybox">
              <b>{lefts.length === 1 ? tr('Quedó 1 línea corriendo de un día anterior') : tr('Quedaron {0} líneas corriendo de días anteriores', lefts.length)}</b>
              <ul>{lefts.slice(0, 6).map((r) => <li key={r.id}>{trx('{0} · {1} · {2} · desde el {3}', r.dept, lineNameOf(s, r.lineId, r.line), r.code, longDate(r.date))}</li>)}{lefts.length > 6 && <li>{trx('y {0} más', lefts.length - 6)}</li>}</ul>
              <div className="chips">
                <button type="button" className={'chip' + (left === 'finish' ? ' on' : '')} onClick={() => setLeft('finish')}>{tr('Terminarlas en su último registro')}</button>
                <button type="button" className={'chip' + (left === 'keep' ? ' on' : '')} onClick={() => setLeft('keep')}>{tr('Dejarlas corriendo')}</button>
              </div>
            </div>
          )}
          {some && (
            <div className={'tidybox' + (wipe ? ' hot' : '')}>
              <b>{trx('Ya hay registrado ese día antes de esa hora: {0} {1}{2} y {3}', had.runs.length, had.runs.length === 1 ? tr('corrida') : tr('corridas'), had.runs.some((r) => !r.endedAt) ? ' (' + tr('{0} en curso)', had.runs.filter((r) => !r.endedAt).length) : '', had.stops.length)} {had.stops.length === 1 ? tr('paro') : tr('paros')}</b>
              {mayWipe ? (
                <div className="chips">
                  <button type="button" className={'chip' + (mine === 'keep' ? ' on' : '')} onClick={() => setMine('keep')}>{tr('Son de hoy: se quedan')}</button>
                  <button type="button" className={'chip' + (mine === 'wipe' ? ' on' : '')} onClick={() => setMine('wipe')}>{tr('Eran pruebas: borrarlas')}</button>
                </div>
              ) : <span>{tr('Se quedan como están: empezar el día no borra nada.')}</span>}
              {wipe && <>
                <span>{supabase ? tr('Se quitan de todas las pantallas y del reporte, en todos los aparatos. Si fue un error, se recuperan desde el Reporte de ese día.') : tr('Se quitan de todas las pantallas y del reporte. En el demo no se pueden recuperar.')}</span>
                <label>{trx('Escribe {0} para confirmar', WIPE_WORD)}{' '}<input value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" autoCapitalize="characters" placeholder={WIPE_WORD} /></label>
              </>}
            </div>
          )}
          <div className="dbtns spread">
            <div className="btns">{was && <button type="button" className="lnk" onClick={() => { cancelDay(day.date); onClose() }}>{tr('Quitar el inicio del día')}</button>}</div>
            <div className="btns">
              <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
              <button type="submit" className={'btn ' + (wipe ? 'danger' : 'primary')} disabled={!ok}>{was ? tr('✓ Guardar') : tr('▶ Empezar el día')}</button>
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
        <h3>{trx('¿Borrar todo lo registrado el {0}?', longDate(date))}</h3>
        <p>{had.runs.length + had.stops.length === 1 ? tr('Es') + ' ' : tr('Son') + ' '}{howMany(had.runs.length, had.stops.length)}{supabase ? tr('. Se quitan de todas las pantallas y reportes, en todos los aparatos. Sirve para limpiar un día de pruebas. Si fue un error, se recuperan desde este mismo reporte.') : tr('. Se quitan de todas las pantallas y reportes. Sirve para limpiar un día de pruebas; en el demo no se puede recuperar.')}</p>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); if (!wipeOk(word)) return; const r = purgeDay(date); onClose(); onDone({ title: tr('Día borrado'), text: (r.runs + r.stops === 1 ? tr('Del {0} se borró {1}', longDate(date), howMany(r.runs, r.stops)) : tr('Del {0} se borraron {1}', longDate(date), howMany(r.runs, r.stops))) + '.' }) }}>
          <label>{trx('Escribe {0} para confirmar', WIPE_WORD)}{' '}<input value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" autoCapitalize="characters" placeholder={WIPE_WORD} /></label>
          <div className="dbtns">
            <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
            <button type="submit" className="btn danger" disabled={!wipeOk(word)}>{tr('Borrar el día')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** "lun, 12 oct": a date said short */
/** the date some days before or after another */
const addDays = (date: string, n: number) => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return dayOf(d.getTime()) }
const shortDay = (date: string) => new Date(date + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
/** "15 oct" */
const shipText = (date: string) => new Date(date + 'T12:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' })
/** " · faltan 52 de 72 cajas", " · completo", or nothing when the order does not say how many cases it is for */
const leftText = (s: State, o: Order) => { if (o.cases == null) return ''; const left = o.cases - orderMade(s, o.id); return left > 0 ? ' ' + tr('· faltan {0} de {1} cajas', fmtN(left), fmtN(o.cases)) : ' ' + tr('· completo') }

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
        <thead><tr><th>PO</th><th>{tr('Código')}</th><th>{tr('Pedidas')}</th><th>{tr('Hechas')}</th><th>{tr('Faltan')}</th><th>{tr('Cliente')}</th><th>{tr('Envío')}</th><th>{tr('Destino')}</th>{mgr && <th></th>}</tr></thead>
        <tbody>{list.map((o) => {
          const made = orderMade(s, o.id), left = o.cases != null ? o.cases - made : null
          return (
            <tr key={o.id}>
              <td>{o.po ? <b>{o.po}</b> : <i>{tr('sin PO')}</i>}</td><td><b>{o.code}</b></td><td>{o.cases != null ? fmtN(o.cases) : '—'}</td><td>{fmtN(made)}</td>
              <td className={left != null && left <= 0 ? 'ok' : ''}>{left == null ? '—' : left > 0 ? fmtN(left) : tr('✓ completo') + (left < 0 ? ' (+' + fmtN(-left) + ')' : '')}</td>
              <td>{o.customer || '—'}</td><td>{o.shipBy ? shipText(o.shipBy) : '—'}</td><td>{o.dest || '—'}</td>
              {mgr && <td><button type="button" className="lnk" onClick={() => setEditing(o.id)}>{tr('Editar')}</button></td>}
            </tr>
          )
        })}</tbody>
      </table>
    </div>
  )
  return (
    <div className="orders">
      <div className="tc-head">
        <h3>{tr('Pedidos · PO')}</h3>
        {mgr && <button type="button" className="lnk" onClick={() => setEditing('new')}>{tr('+ Agregar pedido')}</button>}
      </div>
      {open.length ? table(open) : <p className="hint">{mgr ? tr('No hay pedidos abiertos. Los que se agreguen aquí los ve Packing al registrar cada pallet de ese código.') : tr('No hay pedidos abiertos.')}</p>}
      {open.length > 0 && <p className="hint">{tr('"Hechas" suma los pallets que se le dieron a cada pedido en los días que guarda este aparato.')}</p>}
      {closed.length > 0 && <button type="button" className="lnk" onClick={() => setShowClosed(!showClosed)}>{trx('{0} los completos ({1})', showClosed ? tr('Ocultar') : tr('Ver'), closed.length)}</button>}
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
        <h3>{order ? tr('Pedido · {0}', orderLabel(order)) : tr('Pedido nuevo')}</h3>
        <p>{tr('Pon el PO y el producto. Packing lo ve al registrar cada pallet de ese código. Lo demás es opcional, y el PO también se puede dejar en blanco y ponerlo después. El mismo PO se puede repetir las veces que haga falta.')}</p>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); save() }}>
          <label>{tr('N° de PO')}{' '}<input value={po} onChange={(e) => setPo(e.target.value)} placeholder={tr('ej. 4500012345')} autoComplete="off" /></label>
          <label>{trx('Código del producto {0}', !order && <small>{tr('(si el PO es de varios, sepáralos con coma)')}</small>)} <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={order ? tr('ej. 0100') : tr('ej. 0100, 0200')} autoComplete="off" />{prod && <small> {prod.name}</small>}</label>
          {many && !order && <p className="hint">{trx('Se crean {0} pedidos con este PO, uno por producto: {1}. Las cajas de cada uno se ponen después, con "Editar".', codes.length, codes.join(', '))}</p>}
          {many && order && <span className="err">{tr('Este pedido es de un solo producto. Para otro producto, agrega otro pedido con el mismo PO.')}</span>}
          <label>{trx('Cajas pedidas {0}', <small>{tr('(opcional)')}</small>)} <input inputMode="numeric" value={many ? '' : cases} disabled={many} onChange={(e) => setCases(e.target.value.replace(/\D/g, ''))} placeholder={tr('ej. 288')} />{pallets != null && <small> {' '}{trx('= {0} {1} de {2}', Math.round(pallets * 100) / 100, pallets === 1 ? 'pallet' : 'pallets', prod?.casesPerPallet)}</small>}</label>
          <label>{trx('Cliente {0}', <small>{tr('(opcional)')}</small>)} <input list="order-customers" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder={tr('ej. Cliente A')} autoComplete="off" /></label>
          <datalist id="order-customers">{customers.map((c) => <option key={c} value={c} />)}</datalist>
          <label>{trx('Fecha de envío {0}', <small>{tr('(opcional)')}</small>)} <input type="date" value={shipBy} onChange={(e) => setShipBy(e.target.value)} /></label>
          <label>{trx('Destino {0}', <small>{tr('(opcional)')}</small>)} <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder={tr('ej. Almacén Norte')} autoComplete="off" /></label>
          <div className="dbtns spread">
            <div className="btns">
              {order && <button type="button" className="btn" onClick={() => { closeOrder(order.id, !order.closed); onClose() }}>{order.closed ? tr('Abrir otra vez') : tr('✓ Marcar completo')}</button>}
              {order && <button type="button" className="btn danger" onClick={() => setDropping(true)}>{tr('🗑 Borrar')}</button>}
            </div>
            <div className="btns">
              <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
              <button type="submit" className="btn primary" disabled={!ok}>{tr('✓ Guardar')}</button>
            </div>
          </div>
        </form>
        {dropping && order && <ConfirmDialog title={tr('¿Borrar el pedido {0}', orderLabel(order)) + '?'} text={tr('Los pallets que ya se le dieron quedan registrados, pero sin pedido. Si el pedido ya se completó, mejor márcalo completo.')} yes={tr('Borrar')} danger onYes={() => { deleteOrder(order.id); onClose() }} onNo={() => setDropping(false)} />}
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
  const paceText = pace == null ? '' : pace >= 1 ? tr('al ritmo de la meta') : tr('por debajo de la meta')
  const left = goal?.perShift ? goal.perShift - t.qty : 0
  const speed = t.shiftRate ?? t.rate
  const eta = left > 0 && speed && !t.allEnded ? now + (left / speed) * 3_600_000 : null
  // The card is the shift in course's: when a shift takes over it starts from zero. The whole day (the goal is the
  // day's) and what the other shift made stay under it, smaller.
  const many = t.shiftCodes.length > 1 || (t.shiftCodes[0]?.lines.length ?? 0) > 1
  const other = t.shift === 1 ? 2 : 1, otherMade = t.made[other - 1]
  const unitWord = (n: number) => (n === 1 ? cfg.unit : cfg.plural).toLowerCase()
  // a room that counts its units themselves says one of them in the singular ("1 mezcla")
  const label = (n: number) => (cfg.qty === 'none' ? unitWord(n) : t.unitLabel)
  return (
    <div className="todaycard">
      <div className="tc-head">
        <h3>{trx('Turno {0} en {1} · todas las líneas juntas', t.shift, dept)}</h3>
        {mgr && <button type="button" className="lnk" onClick={() => setEditing(true)}>{hasGoal ? tr('✎ Cambiar meta') : tr('+ Poner meta')}</button>}
      </div>
      {/* the clock of the shift: from its first code until the last one ends, and from zero again with the next shift */}
      {t.shiftSince > 0 && (
        <div className={'tc-clock' + (t.shiftUntil ? ' over' : '')}>
          <span>{trx('⏱ Turno {0}', t.shift)}</span>
          <b>{fmtDur(t.shiftMs)}</b>
          <small>{t.shiftUntil ? tr('de {0} a {1} · terminó', fmtTime(t.shiftSince), fmtTime(t.shiftUntil)) : tr('desde las {0}', fmtTime(t.shiftSince))}</small>
        </div>
      )}
      <div className="tc-main">
        <div className="tc-total"><b>{fmtN(t.shiftQty)}</b> <span>{label(t.shiftQty)}</span>{cfg.qty !== 'none' && <small>{t.shiftUnits} {unitWord(t.shiftUnits)}</small>}</div>
        {otherMade > 0 && <div className="tc-day">{trx('Día completo: {0} {1} · Turno {2}: {3}', <b>{fmtN(t.qty)}</b>, label(t.qty), other, <b>{fmtN(otherMade)}</b>)}</div>}
        {goal?.perShift ? (
          <div className="tc-goal">
            <div className="tc-goalrow"><span>{trx('Meta del día {0} / {1}', <b>{fmtN(t.qty)}</b>, <b>{fmtN(goal.perShift)}</b>)} {t.unitLabel}</span><b className={pct >= 100 ? 'ok' : ''}>{pct}%</b></div>
            <div className="bar"><i className={pct >= 100 ? 'ok' : ''} style={{ width: pct + '%' }} /></div>
            <div className="tc-sub">{left > 0 ? <>{trx('Faltan {0}', <b>{fmtN(left)}</b>)}{eta && <> {' '}{trx('· a este ritmo se llega a las {0}', <b>{fmtTime(eta)}</b>)}</>}</> : <b className="ok">{tr('✓ Meta del día cumplida')}</b>}</div>
          </div>
        ) : <div className="tc-goal tc-none">{mgr ? tr('Sin meta del día todavía.') : ''}</div>}
        <div className="tc-rate">
          <label>{trx('Ritmo del turno {0}', t.shift)}</label>
          <b className={paceCls}>{t.shiftRate != null ? fmtN(t.shiftRate) : '—'}</b> <span>{t.unitLabel}/h</span>
          {goal?.perHour ? <small>{trx('meta {0}/h', <b>{fmtN(goal.perHour)}</b>)}{pace != null && <> · <span className={paceCls}>{paceText}</span></>}</small> : <small>{t.shiftRate == null ? tr('desde el primer inicio del turno') : tr('sin meta por hora')}</small>}
        </div>
      </div>
      {many && <div className="tc-codes">{t.shiftCodes.map((c) => <span key={c.code} className="tc-code"><b>{c.code}</b> {fmtN(c.qty)} {t.unitLabel}{cfg.qty !== 'none' && <> · {c.units} {unitWord(c.units)}</>} · {c.lines.join(', ')}</span>)}</div>}
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
        <h3>{trx('Meta de {0}', dept)}</h3>
        <p>{trx('La ven todas las tablets de {0} y queda en el historial. Deja en blanco la que no aplique. El ritmo sale en rojo cuando baja de la meta por hora. Para dejar el departamento sin meta, "Quitar meta".', dept)}</p>
        <form onSubmit={(e) => { e.preventDefault(); setTarget(dept, num(hour), num(whole)); onClose() }} className="qform">
          <label>{tr('Por hora')}{' '}<input autoFocus={!goal?.perHour && !goal?.perShift} inputMode="numeric" placeholder={tr('ej. 400 {0}', unit)} value={hour} onChange={(e) => setHour(e.target.value.replace(/\D/g, ''))} /></label>
          <label>{trx('En el día completo {0}', <small>{tr('(los dos turnos)')}</small>)} <input inputMode="numeric" placeholder={tr('ej. 6400 {0}', unit)} value={whole} onChange={(e) => setWhole(e.target.value.replace(/\D/g, ''))} /></label>
          <div className="dbtns spread">
            <div className="btns">{(goal?.perHour || goal?.perShift) ? <button type="button" className="lnk" onClick={() => { setTarget(dept, null, null); onClose() }}>{tr('Quitar meta')}</button> : null}</div>
            <div className="btns">
              <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
              <button type="submit" className="btn primary">{tr('✓ Guardar')}</button>
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
  // what ended in the shift in course is its list; what the shift before ended is one line, opened by whoever wants it
  const turn = turnOf(s, day.date, now)
  const doneNow = doneToday.filter((r) => (r.endedAt ?? 0) > turn.since), doneBefore = doneToday.filter((r) => (r.endedAt ?? 0) <= turn.since)
  const [showBefore, setShowBefore] = useState(false)
  const doneRow = (r: Run) => {
    const st = runStats(s, r, now), mine = runSince(s, r, turn.since, now)
    return (
      <div key={r.id} className="donerow">
        {trx('{0} · lote {1} · {2} · {3} – {4} · {5} · trabajando {6} · parado {7}{8} · {9}', <b className="code">{r.code}</b>, r.lot, lineNameOf(s, r.lineId, r.line), fmtTime(r.startedAt), fmtTime(r.endedAt ?? now), <b>{madeText(r, st.qty)}</b>, <b>{fmtDur(st.working)}</b>, <b className={st.down ? 'red' : ''}>{fmtDur(st.down)}</b>, r.waste > 0 && <> {' '}{trx('· waste {0}', <b className="red">{r.waste} lb</b>)}</>, whoText(r))}{mine.carried && (r.endedAt ?? 0) > turn.since && <> {' '}{trx('· de eso, en este turno: {0}', <b>{unitsText(r.dept, mine.units, mine.qty)}</b>)}</>} {can('fix') && canShift(who, spanShifts(shiftsOf(s, r.date), r.startedAt, r.endedAt ?? now)) && <button type="button" className="lnk" onClick={() => setEditRun(r.id)}>{tr('Corregir')}</button>}
      </div>
    )
  }
  return (
    <section className="panel">
      <div className="phead">
        <h2>{dept}</h2>
        <div className="acts">
          {ds
            ? <button type="button" className="btn danger" onClick={() => endStop(ds.id)}>{trx('▶ Reanudar departamento · {0}', fmtDur(now - ds.startedAt))}</button>
            : <button type="button" className="btn" disabled={!anyRunning} onClick={() => setStopAll(true)}>{tr('⏸ Parar departamento')}</button>}
          <button type="button" className="btn" disabled={!left.runs.length && !left.setups.length && !left.stops.length} onClick={() => setLeaving(true)}>{tr('🏁 Terminar turno')}</button>
          <button type="button" className="btn" onClick={() => setAdding(true)}>{trx('+ Agregar {0}', CFG[dept].lineWord.toLowerCase())}</button>
        </div>
      </div>
      {leaving && (
        <div className="veil" onClick={() => setLeaving(false)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()}>
            <h3>{trx('¿Terminar el turno en {0}?', dept)}</h3>
            <p>{tr('Es para cuando ya se van y nada sigue. La app nunca termina nada sola, aunque pase la hora del turno: lo deciden ustedes. Se cierra ahora:')}</p>
            <ul className="leavelist">
              {left.runs.map((r) => <li key={r.id}>{trx('{0} · código {1} · {2} · {3}', <b>{lineNameOf(s, r.lineId, r.line)}</b>, <b>{r.code}</b>, madeText(r, runQty(s, r)), <i>{tr('se termina')}</i>)}</li>)}
              {left.setups.map((x) => <li key={x.id}>{trx('{0} · Set up desde {1} · {2}', <b>{lineNameOf(s, x.lineId)}</b>, fmtTime(x.startedAt), <i>{tr('se quita: no vino otro código')}</i>)}</li>)}
              {left.stops.map((x) => <li key={x.id}>{trx('{0} · parado por {1} desde {2} · {3}', <b>{x.lineId === null ? tr('Todo {0}', dept) : lineNameOf(s, x.lineId)}</b>, tr(x.reason), fmtTime(x.startedAt), <i>{tr('se cierra')}</i>)}</li>)}
            </ul>
            <p className="hint">{trx('Si falta registrar {0}{1} de alguna línea, regístral{2} antes. Si el otro turno va a seguir con estos mismos códigos, no hace falta terminar: déjalos corriendo.', CFG[dept].saved.endsWith('a') ? tr('la última') + ' ' : tr('el último') + ' ', CFG[dept].unit.toLowerCase(), CFG[dept].saved.endsWith('a') ? 'a' : 'o')}</p>
            <div className="dbtns">
              <button type="button" className="btn" onClick={() => setLeaving(false)}>{tr('Cancelar')}</button>
              <button type="button" className="btn primary" onClick={() => { endShift(dept); setLeaving(false) }}>{tr('🏁 Terminar turno')}</button>
            </div>
          </div>
        </div>
      )}
      {ds && <div className="deptstop">{trx('⏸ Todo {0} parado · {1}{2} · desde {3} · {4}', dept, <b>{tr(ds.reason)}</b>, ds.note && ' · ' + noteLabel(ds.note), fmtTime(ds.startedAt), ds.by)} {can('fix') && <button type="button" className="lnk" onClick={() => setEditStop(true)}>{tr('Corregir')}</button>}</div>}
      {editStop && ds && <StopEditor stop={ds} mgr={can('fix')} onClose={() => setEditStop(false)} />}
      <TodayCard s={s} dept={dept} now={now} mgr={can('goals')} date={day.date} />
      {CFG[dept].orders && <OrdersCard s={s} mgr={can('orders')} />}
      <div className="lines">{lines.map((l) => <LineCard key={l.id} s={s} line={l} now={now} mgr={can('fix')} day={day} />)}</div>
      {lines.length === 0 && <p className="hint">{trx('Este departamento no tiene líneas. Toca "Agregar {0}".', CFG[dept].lineWord.toLowerCase())}</p>}
      {adding && <LineNameDialog s={s} dept={dept} onClose={() => setAdding(false)} />}
      {doneNow.length > 0 && (
        <div className="done">
          <h3>{trx('Terminados en el turno {0} en {1}', turn.shift, dept)}</h3>
          {doneNow.map(doneRow)}
        </div>
      )}
      {doneBefore.length > 0 && (
        <div className="done">
          <button type="button" className="donefold" aria-expanded={showBefore} onClick={() => setShowBefore(!showBefore)}>
            <span>{showBefore ? '▾' : '▸'} {turn.shift === 2
              ? (doneBefore.length === 1 ? tr('Turno 1: 1 código terminado') : tr('Turno 1: {0} códigos terminados', doneBefore.length))
              : (doneBefore.length === 1 ? tr('Antes de este turno: 1 código terminado') : tr('Antes de este turno: {0} códigos terminados', doneBefore.length))}</span>
            <small>{showBefore ? tr('Ocultar') : tr('Ver')}</small>
          </button>
          {showBefore && doneBefore.map(doneRow)}
        </div>
      )}
      {editing && <RunEditor s={s} run={editing} mgr={can('fix')} onClose={() => setEditRun(null)} />}
      {stopAll && <StopDialog title={tr('Parar todo {0}', dept)} reasons={CFG[dept].quick} onClose={() => setStopAll(false)} onPick={(reason, note) => { startStop(dept, null, reason, note); setStopAll(false) }} />}
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
  const turn = turnOf(s, day.date, now) // the shift in course: its numbers start from zero at the hand-over
  // the units the shift before made of the code that is running: this shift numbers its own from one
  const brought = run && run.startedAt < turn.since ? run.units.filter((u) => u.at < turn.since).length : 0
  const noOf = (x: Short) => (run && x.run.id === run.id && x.index >= brought ? x.index + 1 - brought : x.index + 1)
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
  const nameIt = <button type="button" className="lnk pen" title={tr('Cambiar el nombre')} aria-label={tr('Cambiar el nombre de {0}', lineLabel(line.name))} onClick={() => setRenaming(true)}>✎</button>
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
  const shortText = (x: Short) => tr('{0} {1} de {2} ({3} de {4}', unitWord, (x.index + 1), x.run.code, x.unit.qty, x.usual) + ')'
  const fillLink = ended.length > 0 && (
    <button type="button" className="lnk" onClick={() => (ended.length === 1 ? setFilling(ended[0]) : setChoosing(true))}>
      
      {trx('➕ Completar {0}', ended.length === 1 ? shortText(ended[0]) : (cfg.saved.endsWith('a') ? tr('una {0} de un código ya terminado', unitWord) : tr('un {0} de un código ya terminado', unitWord)))}
    </button>
  )
  const fixingRun = fixingId ? s.runs.find((r) => r.id === fixingId) : undefined
  const fillUi = (
    <>
      {fixingRun && <RunEditor key={'fix:' + fixingRun.id} s={s} run={fixingRun} mgr={mgr} onClose={() => setFixingId(null)} />}
      {choosing && (
        <div className="veil" onClick={() => setChoosing(false)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()}>
            <h3>{tr('¿Cuál quieres completar?')}</h3>
            <p>{trx('Códigos ya terminados hoy en {0} que cerraron con menos de lo usual.', line.name)}</p>
            <div className="endchoices">
              {ended.map((x) => <button key={x.run.id} type="button" className="btn" onClick={() => { setChoosing(false); setFilling(x) }}>{trx('{0} · lote {1} · {2} {3} · tiene {4} de {5} {6} · terminó {7}', <b>{x.run.code}</b>, x.run.lot, unitWord, x.index + 1, x.unit.qty, x.usual, cfg.qtyUnit, fmtTime(x.run.endedAt ?? 0))}</button>)}
            </div>
            <div className="dbtns"><button type="button" className="btn" onClick={() => setChoosing(false)}>{tr('Cancelar')}</button></div>
          </div>
        </div>
      )}
      {filling && (cfg.lots
        ? <LotsDialog key={'fill:' + filling.run.id} title={tr('Completar {0} {1} de {2} · ¿qué lleva ahora en total?', unitWord, noOf(filling), filling.run.code)} unit={cfg.qtyUnit} refLabel={cfg.refLabel} lot={filling.run.lot} qty={filling.usual} start={filling.unit.lots ?? [{ lot: filling.run.lot, qty: filling.usual }]} startRef={filling.unit.ref} onClose={() => setFilling(null)} onPick={(total, ref, lots) => { fillUnit(filling.run.id, filling.unit.at, total, lots, ref); setFilling(null) }} />
        : <QtyDialog key={'fill:' + filling.run.id} title={tr('Completar {0} {1} de {2} · tiene {3} {4}. ¿Cuántos tiene ahora en total?', unitWord, noOf(filling), filling.run.code, filling.unit.qty, cfg.qtyUnit)} unit={cfg.qtyUnit} refLabel="" initial={filling.usual} perCase={perCaseOf(filling.run.code)} onClose={() => setFilling(null)} onPick={(q) => { fillUnit(filling.run.id, filling.unit.at, q); setFilling(null) }} />)}
    </>
  )
  // The line's own goal, set by the manager (the room's goal is of all its lines together): what the line has made
  // today against it, and its pace in the shift in course, red as soon as it falls under the goal per hour.
  const goal = lineTargetOf(s, line.id), hasGoal = !!(goal && (goal.perHour || goal.perDay))
  const mine = hasGoal ? deptToday(s, line.dept, day.date, now, line.id) : null
  const goalPct = mine && goal?.perDay ? Math.min(100, Math.floor((mine.qty / goal.perDay) * 100)) : 0
  const goalUnit = cfg.qty === 'none' ? cfg.plural.toLowerCase() : cfg.qtyUnit
  const goalBtn = canGoal && <button type="button" className="lnk sm" onClick={() => setGoalOpen(true)}>{hasGoal ? tr('✎ Meta') : tr('+ Meta')}</button>
  const goalStrip = (
    <>
      {mine && hasGoal && (
        <div className="linegoal">
          {goal?.perDay ? <span>{trx('Meta de hoy {0} / {1} {2} · {3}', <b>{fmtN(mine.qty)}</b>, fmtN(goal.perDay), goalUnit, <b className={goalPct >= 100 ? 'ok' : ''}>{goalPct}%</b>)}</span> : null}
          {goal?.perHour ? <span>{trx('Ritmo {0} {1}/h · meta {2}', <b className={mine.shiftRate == null ? '' : mine.shiftRate >= goal.perHour ? 'ok' : 'red'}>{mine.shiftRate != null ? fmtN(mine.shiftRate) : '—'}</b>, goalUnit, fmtN(goal.perHour))}</span> : null}
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
    const isCart = line.dept === 'RTE'
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
          <h3>{lineLabel(line.name)} {nameIt}</h3>
          <span className={'pill ' + (idle ? 'setup' : 'free')}>{idle ? '⏱ ' + tr(idle.reason) + ' · ' + fmtDur(stopTime(s, idle, now)) : tr('Libre')}</span>
          <span className="lacts">{goalBtn}</span>
        </div>
        {goalStrip}
        {idle && (
          <div className="setupbar">
            <small>{trx('Esperando el código siguiente desde las {0}. Si no viene otro, no cuenta.', fmtTime(idle.startedAt))}</small>
            <span className="btns two">
              <button type="button" className="btn sm" onClick={() => endStop(idle.id)}>{trx('■ Terminar {0}', tr(idle.reason))}</button>
              <button type="button" className="btn sm" onClick={() => dropSetup(idle.id)}>{tr('No viene otro código: quitarlo')}</button>
            </span>
            <button type="button" className="lnk sm" onClick={() => setFixingStop(true)}>{mgr ? tr('Corregir o dividir') : tr('Corregir')}</button>
          </div>
        )}
        {prev && (
          <div className="lastcode">
            <span>{(prev.endedAt ?? 0) > turn.since
              ? trx('Último: {0} · lote {1} · terminó {2} · {3}', <b className="code">{prev.code}</b>, prev.lot, fmtTime(prev.endedAt ?? 0), madeText(prev, runQty(s, prev)))
              : trx('Último, del turno anterior: {0} · lote {1} · terminó {2} · {3}', <b className="code">{prev.code}</b>, prev.lot, fmtTime(prev.endedAt ?? 0), madeText(prev, runQty(s, prev)))}</span>
            <span className="btns">
              <button type="button" className="lnk sm" onClick={() => setReopening(prev.id)}>{trx('↩ No había terminado: seguir con {0}', prev.code)}</button>
              {fillLink}
              <button type="button" className="lnk sm" onClick={() => setFixingId(prev.id)}>{tr('Corregir')}</button>
            </span>
          </div>
        )}
        {prev && reopening === prev.id && <ConfirmDialog title={tr('¿Seguir con {0} en {1}', prev.code, line.name) + '?'}
          text={tr('Se marcó terminado a las {0}. Vuelve a correr como si no se hubiera terminado: el tiempo desde entonces cuenta como trabajando y el Set up que empezó se quita. Si la línea estuvo parada y el código vuelve ahora, es mejor empezarlo de nuevo abajo.', fmtTime(prev.endedAt ?? 0))}
          yes={tr('Seguir con {0}', prev.code)} onYes={() => { reopenRun(prev.id); setReopening(null) }} onNo={() => setReopening(null)} />}
        {fillUi}
        {fixingStop && idle && <StopEditor stop={idle} mgr={mgr} onClose={() => setFixingStop(false)} />}
        {naming}
        {removing && <ConfirmDialog title={tr('¿Quitar {0} de {1}', lineLabel(line.name), line.dept) + '?'} text={tr('Se puede volver a agregar cuando haga falta.')} yes={tr('Quitar')} danger onYes={() => removeLine(line.id)} onNo={() => setRemoving(false)} />}
        <form className="start" onSubmit={(e) => { e.preventDefault(); if (ok) { startRun(line, code.trim().toUpperCase(), lot.trim(), date, needPer ? perUnit : null); setDateText(null); setLotText(null); setEditDate(false) } }}>
          <label>{tr('Código')}{' '}<input value={code} onChange={(e) => setCode(e.target.value)} placeholder={tr('ej. 0100')} autoComplete="off" /></label>
          <label>{tr('Lote')}{' '}<input value={lot} onChange={(e) => setLotText(e.target.value)} inputMode="numeric" placeholder={tr('ej. 6280')} autoComplete="off" /></label>
          {showDate
            ? <label className="wide">{tr('Fecha')}{' '}<input type="date" value={date} onChange={(e) => { if (!lot.trim() || lot.trim() === lotFor(date)) setLotText(null); setDateText(e.target.value || null) }} /></label>
            : <div className="dateline">{trx('Fecha {0}', <b>{shortDay(date)}</b>)} <button type="button" className="lnk sm" onClick={() => setEditDate(true)}>{tr('Cambiar')}</button></div>}
          {/* a known product brings its numbers: shown as a line, the boxes only when they want to change them */}
          {needPer && !isCart && (suggested != null && !editQty
            ? <div className="known"><b>{suggested}</b> {trx('{0} por {1}', cfg.qtyUnit, cfg.unit.toLowerCase())} <button type="button" className="lnk" onClick={() => setEditQty(true)}>{tr('Cambiar')}</button></div>
            : <label className="wide">{cfg.perUnitLabel} <input value={per} onChange={(e) => setPer(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder={suggested != null ? String(suggested) : tr('ej. 36')} autoComplete="off" /></label>)}
          {isCart && (perCrateN && !editQty
            ? <div className="known">{trx('{0} guacales × {1} pouches = {2} pouches por carro', <b>{cratesN}</b>, <b>{perCrateN}</b>, <b>{perUnit}</b>)}{' '}<button type="button" className="lnk" onClick={() => setEditQty(true)}>{tr('Cambiar')}</button></div>
            : (
              <div className="cartrow">
                <label>{tr('Guacales por carro')}{' '}<input value={crates} onChange={(e) => setCrates(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder={String(cratesN)} autoComplete="off" /></label>
                <label>{tr('Pouches por guacal')}{' '}<input value={per} onChange={(e) => setPer(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder={perCrateN ? String(perCrateN) : tr('ej. 10')} autoComplete="off" /></label>
                <span className="eq">{trx('= {0} pouches por carro {1}', <b>{perUnit ?? '—'}</b>, <small>{tr('(12 guacales por columna)')}</small>)}</span>
              </div>
            ))}
          <button className="btn primary" type="submit" disabled={!ok}>{tr('▶ Empezar')}</button>
        </form>
        <div className="tools">
          {!idle ? <button type="button" className="lnk sm" onClick={() => startSetup(line)}>{tr('⏱ Empezar Set up')}</button> : <span />}
          <button type="button" className="lnk sm muted" onClick={() => setRemoving(true)}>{trx('Quitar {0}', cfg.lineWord.toLowerCase())}</button>
        </div>
      </div>
    )
  }
  const st = runStats(s, run, now)
  // A code that came running from the shift before: what this shift sees of it starts from zero at the hand-over (its
  // units, its quantity, its time), and one line says what it brought. A code this shift started is shown whole.
  const mineNow = runSince(s, run, turn.since, now)
  const cameFrom = shiftAt(shiftsOf(s, run.date), run.startedAt)
  const last = Math.max(run.units.length ? run.units[run.units.length - 1].at : run.startedAt, mineNow.carried ? turn.since : 0)
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
  const orderOptions = openOrders.map((o) => ({ id: o.id, label: orderLabel(o) + leftText(s, o) + (o.shipBy ? ' ' + tr('· envío {0}', shipText(o.shipBy)) : '') }))
  const done = () => {
    if (just) return
    if (cfg.qty === 'ask') setCounting(true)
    else record(cfg.qty === 'auto' ? run.perUnit : null)
  }
  const lit = just ? ' bumped' : ''
  // pouches are also told as full cases and loose pouches, where the products table says how many go in a case
  const perCase = perCaseOf(run.code)
  const cases = perCase && mineNow.qty > 0 ? inCases(s, run.code, mineNow.qty) : null
  return (
    <div className={'line ' + (stop ? 'stopped' : 'running') + (just ? ' justdone' : '')}>
      {naming}
      <div className="lhead">
        <h3>{lineLabel(line.name)} {nameIt}</h3>
        <span className={'pill ' + (stop ? 'stop' : 'run')}>{stop ? tr('⏸ Parado') : tr('● Corriendo')}</span>
        <span className="lacts">{goalBtn}<button type="button" className="lnk sm" onClick={() => setFixing(true)}>{tr('Corregir')}</button></span>
      </div>
      <div className="coderow"><b className="code">{run.code}</b><span>{trx('lote {0}{1} · desde {2}', run.lot, run.date !== day.date && ' · ' + shortDay(run.date), fmtTime(run.startedAt))}{run.perUnit != null && ' · ' + tr('{0} {1} por {2}', run.perUnit, cfg.qtyUnit, unitWord)}</span></div>
      {mineNow.carried && (
        <div className="carried">
          {run.date === day.date && cameFrom !== turn.shift
            ? trx('↪ Viene del turno {0}: empezó a las {1} y traía {2}.', cameFrom, <b>{fmtTime(run.startedAt)}</b>, <b>{unitsText(line.dept, mineNow.before.units, mineNow.before.qty)}</b>)
            : trx('↪ Viene de antes: empezó el {0} a las {1} y traía {2}.', <b>{shortDay(run.date)}</b>, <b>{fmtTime(run.startedAt)}</b>, <b>{unitsText(line.dept, mineNow.before.units, mineNow.before.qty)}</b>)}
          {' '}{trx('Abajo cuenta este turno, desde cero. Total del código: {0}.', <b>{madeText(run, st.qty)}</b>)}
        </div>
      )}
      {goalStrip}
      {openOrders.length > 0 && (
        <div className="orderstrip">
          <span>{trx('📦 {0} de {1}:', openOrders.length === 1 ? tr('Pedido') : tr('Pedidos'), run.code)}</span>
          {openOrders.slice(0, 3).map((o) => <span key={o.id} className={o.id === nextOrder ? 'next' : ''}><b>{orderLabel(o)}</b>{leftText(s, o)}{o.shipBy && ' ' + tr('· envío {0}', shipText(o.shipBy))}</span>)}
          {openOrders.length > 3 && <span>{trx('y {0} más', openOrders.length - 3)}</span>}
        </div>
      )}
      {stop && <div className="stopbar">⏸ <b>{tr(stop.reason)}</b>{stop.note && ' · ' + noteLabel(stop.note)} · <b>{fmtDur(stopTime(s, stop, now))}</b>{stop.lineId === null && ' ' + tr('· todo el departamento')}{stop.lineId === line.id && <button type="button" className="lnk sm" onClick={() => setFixingStop(true)}>{tr('Corregir')}</button>}</div>}
      {fixing && <RunEditor s={s} run={run} mgr={mgr} onClose={() => setFixing(false)} />}
      {fixingStop && stop && <StopEditor stop={stop} mgr={mgr} onClose={() => setFixingStop(false)} />}
      {/* what is made, big: how many units and how much they carry (with its cases, where pouches are counted); then the
          unit in hand with its average, and the time worked with the time stopped */}
      <div className={'tiles' + (cfg.qty !== 'none' ? ' four' : '')}>
        <div key={'n' + (just?.at ?? 0)} className={'tile main' + lit}><label>{cfg.plural}</label><b>{mineNow.units}</b></div>
        {cfg.qty !== 'none' && <div key={'q' + (just?.at ?? 0)} className={'tile main' + lit}><label>{cfg.qtyUnit}</label><b>{fmtN(mineNow.qty)}</b>{cases && <small>{casesText(cases)}</small>}</div>}
        <div className="tile"><label>{(cfg.saved.endsWith('a') ? tr('Esta') + ' ' : tr('Este') + ' ') + unitWord}</label><b>{fmtDur(current)}</b><small>{trx('prom. {0}', mineNow.units ? fmtDur(mineNow.avg) : '—')}</small></div>
        <div className="tile"><label>{tr('Trabajando')}</label><b>{fmtDur(mineNow.working)}</b><small className={mineNow.down ? 'red' : ''}>{trx('parado {0}', fmtDur(mineNow.down))}</small></div>
      </div>
      <button type="button" className={'btn primary huge' + (just ? ' saved' : '')} disabled={!!just} onClick={done}>✓ {just ? savedText(line.dept, just.n - brought) : cfg.done}</button>
      {own && <button type="button" className="btn slim" onClick={() => setFilling(own)}>{trx('➕ Completar {0} · tiene {1} de {2}', unitWord + (own.run.id === run.id && own.index >= brought ? ' ' + noOf(own) : ' ' + tr('de antes')), own.unit.qty, own.usual)}</button>}
      <div className="acts2">
        {stop
          ? (stop.lineId === line.id
            ? <button type="button" className="btn danger" onClick={() => endStop(stop.id)}>{tr('▶ Reanudar')}</button>
            : <button type="button" className="btn" disabled>{tr('Parado por el departamento')}</button>)
          : <button type="button" className="btn" onClick={() => setAsking(true)}>{tr('⏸ Parar')}</button>}
        {cfg.waste && <button type="button" className="btn" onClick={() => setWasting(true)}>Waste{run.waste ? <b className="red"> {run.waste} lb</b> : ' (lb)'}</button>}
        <button type="button" className="btn" disabled={!!stop} onClick={() => setEnding(true)}>{tr('■ Terminar')}<span className="opt"> {' '}{tr('código')}</span></button>
      </div>
      {fillLink && <div className="fillmore">{fillLink}</div>}
      {ending && <EndDialog cfg={cfg} code={run.code} line={lineLabel(line.name)} now={now} lastAt={run.units.length ? run.units[run.units.length - 1].at : null}
        summary={tr('Lleva {0} · trabajando {1}{2}', madeText(run, st.qty), fmtDur(st.working), (st.down ? ' ' + tr('· parado {0}', fmtDur(st.down)) : '')) + '.'}
        onClose={() => setEnding(false)} onDone={(next) => { endRun(run.id, next); setEnding(false) }}
        onMissing={(next) => { setEnding(false); if (cfg.qty === 'ask') { setEndAfter(next); setCounting(true) } else { record(cfg.qty === 'auto' ? run.perUnit : null); endRun(run.id, next) } }} />}
      {asking && <StopDialog title={tr('Parar {0} · {1}', lineLabel(line.name), run.code)} reasons={cfg.quick} onClose={() => setAsking(false)} onPick={(reason, note) => { startStop(line.dept, line.id, reason, note); setAsking(false) }} />}
      {fillUi}
      {counting && (cfg.lots
        ? <LotsDialog title={cfg.qtyQ} unit={cfg.qtyUnit} refLabel={cfg.refLabel} lot={run.lot} qty={run.perUnit} orders={orderOptions} order={nextOrder} onClose={() => { setCounting(false); setEndAfter(null) }} onPick={(q, ref, lots, po) => { record(q, ref, lots, po); setCounting(false); if (endAfter !== null) { setEndAfter(null); endRun(run.id, endAfter) } }} />
        : <QtyDialog title={cfg.qtyQ} unit={cfg.qtyUnit} refLabel={cfg.refLabel} initial={run.perUnit} perCase={perCase} onClose={() => { setCounting(false); setEndAfter(null) }} onPick={(q, ref) => { record(q, ref); setCounting(false); if (endAfter !== null) { setEndAfter(null); endRun(run.id, endAfter) } }} />)}
      {wasting && <QtyDialog title={tr('Waste de {0} · ¿cuántas libras?', run.code)} unit="lb" refLabel="" initial={null} decimal onClose={() => setWasting(false)} onPick={(lb) => { if (lb > 0) addWaste(run.id, lb); setWasting(false) }} />}
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
  const last = (fem ? tr('la última') + ' ' : tr('el último') + ' ') + unit
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{trx('Terminar {0} · {1}', code, line)}</h3>
        <p>{summary}{lastAt ? ' ' + (fem ? tr('Última') + ' ' : tr('Último') + ' ') + unit + ': ' + fmtTime(lastAt) + '.' : ''}</p>
        <p className="endask">{tr('¿Qué sigue en esta línea?')}</p>
        <div className="chips big">
          <button type="button" className={'chip' + (next === true ? ' on' : '')} onClick={() => setNext(true)}>{tr('Viene otro código')}<small>{tr('empieza el Set up')}</small></button>
          <button type="button" className={'chip' + (next === false ? ' on' : '')} onClick={() => setNext(false)}>{tr('Nada más por hoy')}<small>{tr('no queda nada contando')}</small></button>
        </div>
        <p className="endask">{trx('¿Ya registraste {0}?', last)}</p>
        <div className="endyes">
          <button type="button" className="btn primary" disabled={next === null} onClick={() => next !== null && onDone(next)}>{tr('✓ Sí, terminar')}</button>
          <button type="button" className="btn" disabled={next === null} onClick={() => next !== null && onMissing(next)}>{fem ? tr('＋ Falta: registrarla') : tr('＋ Falta: registrarlo')}</button>
        </div>
        <div className="dbtns"><button type="button" className="lnk" onClick={onClose}>{tr('Cancelar')}</button></div>
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
        <p>{tr('¿Por qué se para? La app cuenta el tiempo parado con esta razón.')}</p>
        <div className="chips big">{[...reasons, 'Otra'].map((r) => <button key={r} type="button" className={'chip' + (reason === r ? ' on' : '')} onClick={() => setReason(r)}>{tr(r)}</button>)}</div>
        <input placeholder={other ? tr('Escribe la razón') : tr('Detalle (opcional)')} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="dbtns">
          <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
          <button type="button" className="btn danger" disabled={!ok} onClick={() => onPick(other ? note.trim() : reason, other ? '' : note.trim())}>{tr('⏸ Confirmar paro')}</button>
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
          <button type="button" className="btn" onClick={onNo}>{tr('Cancelar')}</button>
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
        <div className="dbtns"><button type="button" className="btn primary" autoFocus onClick={onClose}>{tr('Entendido')}</button></div>
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
              <label>{tr('Lote')}{' '}<input inputMode="numeric" placeholder={tr('ej. 6280')} value={r.lot} autoFocus={added && i === rows.length - 1} onChange={(e) => change(i, { lot: e.target.value })} autoComplete="off" /></label>
              <label>{unit} <input inputMode="numeric" placeholder={unit} value={r.qty} autoFocus={!added && i === 0 && qty == null && !start} onChange={(e) => change(i, { qty: e.target.value.replace(/\D/g, '') })} /></label>
              {rows.length > 1 && <button type="button" className="lnk" title={tr('Quitar este lote')} onClick={() => setRows(rows.filter((_, k) => k !== i))}>✕</button>}
            </div>
          ))}
          <button type="button" className="lnk addlot" onClick={() => { setAdded(true); setRows([...rows, { lot: '', qty: '' }]) }}>{trx('+ Otro lote en este {0}', unit === tr('cajas') ? 'pallet' : tr('mismo'))}</button>
          {rows.length > 1 && <p className="lottotal">{trx('Total: {0} en {1} lotes', <b>{total} {unit}</b>, rows.length)}</p>}
          {repeated && <span className="err">{trx('Ese lote ya está en la lista: suma sus {0} en una sola línea.', unit)}</span>}
          {refLabel && <label>{refLabel} <small>{tr('(opcional)')}</small> <input inputMode="numeric" placeholder={tr('ej. 1749')} value={ref} onChange={(e) => setRef(e.target.value)} autoComplete="off" /></label>}
          {orders && orders.length > 0 && (
            <label>{trx('Pedido {0}', <small>{tr('(a cuál va)')}</small>)}
              <select value={po} onChange={(e) => setPo(e.target.value)}>
                <option value="">{tr('Sin pedido')}</option>
                {orders.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
          )}
          <div className="dbtns">
            <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
            <button type="submit" className="btn primary" disabled={!ok}>{tr('✓ Guardar')}</button>
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
          {perCase && ok ? <p className="incases">= {casesText({ cases: Math.floor(n / perCase), loose: Math.round((n - Math.floor(n / perCase) * perCase) * 100) / 100 })} <small>{trx('({0} por caja)', perCase)}</small></p> : null}
          {refLabel && <label>{refLabel} <small>{tr('(opcional)')}</small> <input inputMode="numeric" placeholder={tr('ej. 1749')} value={ref} onChange={(e) => setRef(e.target.value)} autoComplete="off" /></label>}
          <div className="dbtns">
            <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
            <button type="submit" className="btn primary" disabled={!ok}>{tr('✓ Guardar')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** what makes the report's PDF and Excel files; it rejects when they cannot be fetched (no signal, and never loaded on this device) */
const libraries = () => Promise.all([loadPdf(), loadZip()])
const MISSING = tr('Faltan partes de la app que se bajan con WiFi la primera vez. Conéctate, abre la app y vuelve a intentarlo. Si sigue pasando, avísale a quien lleva la app.')
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
        <h3>{trx('Meta de {0} · {1}', lineLabel(line.name), line.dept)}</h3>
        <p>{trx('Sale en la tarjeta de esta línea, en todas las tablets, y queda en el historial. Deja en blanco la que no aplique. El ritmo de la línea sale en rojo cuando baja de su meta por hora. La meta de todo {0} junto se pone arriba, en "Hoy en {1}".', line.dept, line.dept)}</p>
        <form onSubmit={(e) => { e.preventDefault(); setLineTarget(line, num(hour), num(whole)); onClose() }} className="qform">
          <label>{tr('Por hora')}{' '}<input inputMode="numeric" placeholder={tr('ej. 150 {0}', unit)} value={hour} onChange={(e) => setHour(e.target.value.replace(/\D/g, ''))} /></label>
          <label>{trx('En el día completo {0}', <small>{tr('(los dos turnos)')}</small>)} <input inputMode="numeric" placeholder={tr('ej. 2400 {0}', unit)} value={whole} onChange={(e) => setWhole(e.target.value.replace(/\D/g, ''))} /></label>
          <div className="dbtns spread">
            <div className="btns">{goal?.perHour || goal?.perDay ? <button type="button" className="lnk" onClick={() => { setLineTarget(line, null, null); onClose() }}>{tr('Quitar meta')}</button> : null}</div>
            <div className="btns">
              <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
              <button type="submit" className="btn primary">{tr('✓ Guardar')}</button>
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
        <h3>{tr('Horario de los turnos')}</h3>
        <p>{tr('Lo ven todos los aparatos y queda en el historial. Los días anteriores a la fecha que pongas siguen con el horario que tenían.')}</p>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); if (!problem && from && setShifts(from, h)) onClose() }}>
          <div className="egrid">{field('first', tr('Turno 1 empieza'))}{field('firstEnd', tr('Turno 1 termina'))}{field('second', tr('Turno 2 empieza'))}{field('secondEnd', tr('Turno 2 termina'))}</div>
          <label>{tr('Vale desde el día')}{' '}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          {cuts
            ? <p className="hint">{trx('Cada registro cuenta para un turno por su hora: hasta las {0} es del turno 1 y después del turno 2. Pasada la medianoche sigue siendo del turno 2 hasta las {1}. El corte es la mitad del rato entre un turno y el otro, para que quien se queda un poco o llega un poco antes cuente con su turno. El tiempo nunca se detiene solo: quien sigue trabajando después de su hora, o empieza antes, sigue contando. Solo cuando ya pasó el rato entre un turno y el otro, si en una línea nadie registró nada en todo ese rato, ese rato se descuenta.', <b>{minuteText(cuts.toSecond)}</b>, <b>{minuteText(cuts.toFirst)}</b>)}</p>
            : <span className="err">{problem}</span>}
          <div className="dbtns">
            <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
            <button type="submit" className="btn primary" disabled={!!problem || !from}>{tr('✓ Guardar')}</button>
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
    nav.share({ files: pick.files.map((k) => files[k]), title: subject, text: subject }).then(() => setSaid(tr('Listo.')), (e: unknown) => setSaid(shareProblem(e)))
  }
  const save = (k: Kind) => { download(files[k]); setSaid(tr('Descargado: {0}. Queda en la carpeta de Descargas de este aparato.', files[k].name)) }
  const mail = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(tr('Adjunto el reporte del día (PDF y Excel).'))
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg send" onClick={(e) => e.stopPropagation()}>
        <h3>{tr('Enviar el reporte')}</h3>
        <p>{pick ? tr('Toca "Compartir" y elige el correo o WhatsApp. También puedes descargar los archivos y adjuntarlos tú.') : tr('Descarga los dos archivos y adjúntalos al correo o al mensaje.')}</p>
        {pick && <button type="button" className="btn primary" onClick={share}>↗ {pick.label}</button>}
        {pick?.note && <small>{pick.note}</small>}
        <div className="btns">
          <button type="button" className="btn" onClick={() => save('pdf')}>{tr('⬇ PDF')}</button>
          <button type="button" className="btn" onClick={() => save('xlsx')}>{tr('⬇ Excel')}</button>
          <a className="btn" href={mail}>{tr('✉ Abrir un correo')}</a>
        </div>
        {said && <p className="said" role="status">{said}</p>}
        <div className="dbtns"><button type="button" className="btn" onClick={onClose}>{tr('Cerrar')}</button></div>
      </div>
    </div>
  )
}

/** the shift somebody chose to look at in the report, kept while the app stays open (null = none chosen: the report decides) */
let shiftChosen: 0 | 1 | 2 | null = null
/** the room a manager chose to look at in the report, kept the same way ('' = all of them) */
let deptChosen: Dept | '' = ''

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
  // the room a manager looks at (the people of one room see only theirs)
  const [fDept, setDeptPick] = useState<Dept | ''>(only ? '' : deptChosen)
  const setFDept = (d: Dept | '') => { deptChosen = d; setDeptPick(d) }
  // the long lists at the bottom open with a tap
  const [shut, setShut] = useState<Record<string, boolean>>({ units: true, changes: true })
  // The people of a shift open the report on their own shift: the one saved for them, or else the one in course on the
  // day in course. The other shift
  // and the whole day are one choice away, and what they choose stays while the app is open. The office and the owner
  // open it on the whole day, and so does anybody looking at another date.
  const [shiftPick, setShiftPick] = useState<0 | 1 | 2 | null>(shiftChosen)
  const ownShift: 0 | 1 | 2 = who.shift ? who.shift : !wholeDay && date === workDay(s, now).date ? shiftAt(shiftsOf(s, date), now) : 0
  const fShift = shiftPick ?? ownShift
  const setFShift = (k: 0 | 1 | 2) => { shiftChosen = k; setShiftPick(k) }
  const [shiftsOpen, setShiftsOpen] = useState(false)
  // Records of this day that somebody took away ("eran pruebas"). The server never erases: they are there, marked, and
  // come back whole with one tap.
  const purges = supabase ? purgesOf(s, date) : []
  const [recovering, setRecovering] = useState(false)
  const recover = async (id: string) => {
    setRecovering(true)
    try {
      const held = await fetchPurged(date)
      const r = held && restorePurged(id, held)
      setNotice(r
        ? { title: tr('Registros recuperados'), text: tr('Volvieron {0}. Lo que seguía corriendo cuando se quitaron quedó terminado a esa hora: nada se registró en ello después. Revisa el reporte.', howMany(r.runs, r.stops)) }
        : { title: tr('No se pudo recuperar ahora'), text: tr('Hace falta señal para traerlos del servidor. Inténtalo otra vez cuando arriba diga "Sincronizado".') })
    } finally { setRecovering(false) }
  }
  /** "12 corridas · 5 paros", as the history wrote it, in the words of the screen */
  const tookText = (t: string) => { const m = /^(\d+) corridas? · (\d+) paros?$/.exec(t); return m ? howMany(Number(m[1]), Number(m[2])) : t }
  // long lists show ten lines at a time (the files always carry everything)
  const [more, setMore] = useState<Record<string, number>>({})
  useEffect(() => { setMore({}) }, [date, fCode, fLot, fShift, fDept])
  const PAGE = 10
  const cut = <T,>(key: string, list: T[]) => list.slice(0, more[key] ?? PAGE)
  const moreBar = (key: string, total: number) => {
    const shown = Math.min(more[key] ?? PAGE, total)
    if (total <= PAGE) return null
    return (
      <div className="morebar">
        <span>{trx('Se ven {0} de {1}', shown, total)}</span>
        {shown < total && <button type="button" className="btn" onClick={() => setMore({ ...more, [key]: shown + PAGE })}>{trx('Mostrar {0} más', Math.min(PAGE, total - shown))}</button>}
        {shown < total && <button type="button" className="lnk" onClick={() => setMore({ ...more, [key]: Number.MAX_SAFE_INTEGER })}>{tr('Mostrar todo')}</button>}
        {shown > PAGE && <button type="button" className="lnk" onClick={() => setMore({ ...more, [key]: PAGE })}>{tr('Mostrar menos')}</button>}
      </div>
    )
  }
  const day = useDay(date)
  const runToEdit = editRun ? s.runs.find((r) => r.id === editRun) : undefined
  const stopToEdit = editStop ? s.stops.find((x) => x.id === editStop) : undefined
  // what makes the PDF and the Excel comes down when the report opens, so the tap that asks for a file finds it ready
  useEffect(() => { void libraries().catch(() => undefined) }, [])
  /** no button of the report fails without a word: what went wrong, and what to do */
  const failed = (what: string, e?: unknown) => { console.warn('actividad report', what, e); setNotice({ title: tr('No se pudo {0}', what), text: MISSING }) }
  /** opens the PDF in a new tab (to look at, share or print); where a tab cannot show it, it downloads */
  const pdf = async () => {
    try {
      const name = fileName + '.pdf'
      let doc = buildPdf(s, date, now, user.get(), filter)
      if (!doc) { await loadPdf(); doc = buildPdf(s, date, now, user.get(), filter); if (!doc) throw new Error('pdf'); doc.save(name); return }
      if (homeScreenApple(navigator as Parameters<typeof homeScreenApple>[0])) { doc.save(name); return }
      const win = window.open(doc.output('bloburl'), '_blank')
      if (!win) doc.save(name)
    } catch (e) { failed(tr('abrir el PDF'), e) }
  }
  // what the report holds, with the filter by code, by lot and by shift when one is chosen (the same for the screen and every file)
  const dept: Dept | undefined = only ?? (fDept || undefined)
  const filter: ReportFilter = { only: dept, code: fCode, lot: fLot, shift: fShift }
  const rep = reportOf(s, date, now, filter)
  const { runs, stops, rows, unitRows, working, down, byCode, setup } = rep
  const withOrders = unitRows.some((x) => x.order) // a column says the order of each pallet when any has one
  const unitsText = (dept: Dept, n: number) => n + ' ' + (n === 1 ? CFG[dept].unit : CFG[dept].plural).toLowerCase()
  const reasonsText = (x: (typeof rows)[number]) => Object.entries(x.st.reasons).map(([k, v]) => tr(k) + ' ' + fmtDur(v)).join(', ')
  const lineName = (x: { lineId: string | null; dept: Dept }) => (x.lineId === null ? tr('Todo {0}', x.dept) : lineLabel(s.lines.find((l) => l.id === x.lineId)?.name ?? s.runs.find((r) => r.lineId === x.lineId)?.line ?? tr('línea')))
  const fileName = 'actividad-' + (dept ? dept.toLowerCase() + '-' : '') + date + filterFile(rep.code, rep.lot, rep.shift)
  // the history of that day (corrections, products, program, lines): the manager's and the office's
  const changes = mgr && !rep.filtered ? s.changes.filter((c) => !c.deleted && plainDay(s, c.at) === date && (!dept || c.dept === dept)).sort((a, b) => a.at - b.at) : []
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
    } catch (e) { failed(tr('preparar el reporte'), e) }
  }
  /** the day's tables, typed (numbers, times, spans) so Excel can sort and add them; the CSV takes the same as text */
  const blocks = () => {
    const T = (ms: number) => xTime(ms, fmtTime(ms)), D = (ms: number) => xDur(ms, fmtDur(ms))
    const resumen: Cell[][] = [[tr('Departamento'), tr('Línea'), tr('Código'), tr('Lote'), tr('Fecha'), tr('Inicio'), tr('Fin'), tr('Unidad'), tr('Hechas'), tr('Cantidad'), tr('Unidad de cantidad'), tr('Tags / bins'), tr('Waste (lb)'), tr('Tiempo trabajando'), tr('Promedio por unidad'), tr('Tiempo parado'), tr('Razones de paro'), tr('Registró'), tr('Turno')],
      ...rows.map((x): Cell[] => [x.r.dept, lineNameOf(s, x.r.lineId, x.r.line), x.r.code, x.lots, xDay(x.r.date), T(x.r.startedAt), x.r.endedAt ? T(x.r.endedAt) : tr('en curso'), CFG[x.r.dept].unit, x.units, CFG[x.r.dept].qty !== 'none' ? x.qty : '', CFG[x.r.dept].qty !== 'none' ? CFG[x.r.dept].qtyUnit : '', x.view.units.map((u) => u.ref).filter(Boolean).join(', '), x.waste || '', D(x.st.working), x.timed ? D(x.st.avg) : '', D(x.st.down), reasonsText(x), whoText(x.r), rep.shift ? String(rep.shift) : x.shifts])]
    const boxes = (c: (typeof byCode)[number]) => (CFG[c.dept].qtyUnit === 'pouches' ? inCases(s, c.code, c.qty) : null)
    const porCodigo: Cell[][] = [[tr('Departamento'), tr('Código'), tr('Unidad'), tr('Hechas'), tr('Cantidad'), tr('Unidad de cantidad'), tr('Waste (lb)'), tr('Líneas'), tr('Cajas completas'), tr('Pouches sueltos'), ...(rep.shift ? [] : [tr('Turno 1'), tr('Turno 2')])],
      ...byCode.map((c): Cell[] => [c.dept, c.code, CFG[c.dept].unit, c.units, CFG[c.dept].qty !== 'none' ? c.qty : '', CFG[c.dept].qty !== 'none' ? CFG[c.dept].qtyUnit : '', c.waste || '', c.lines.join(', '), boxes(c)?.cases ?? '', boxes(c)?.loose ?? '', ...(c.byShift ?? [])])]
    const porLote: Cell[][] = [[tr('Departamento'), tr('Código'), tr('Lote'), tr('Unidad'), tr('Hechas'), tr('Cantidad'), tr('Unidad de cantidad'), ...(rep.shift ? [] : [tr('Turno 1'), tr('Turno 2')])],
      ...byCode.flatMap((c) => c.lots.map((l): Cell[] => [c.dept, c.code, l.lot, CFG[c.dept].unit, l.units, CFG[c.dept].qty !== 'none' ? l.qty : '', CFG[c.dept].qty !== 'none' ? CFG[c.dept].qtyUnit : '', ...(l.byShift ?? [])]))]
    const unidades: Cell[][] = [[tr('Departamento'), tr('Línea'), tr('Código'), tr('Lote'), '#', tr('Hora'), tr('Unidad'), tr('Cantidad'), tr('Unidad de cantidad'), tr('Tag / bin'), tr('Desde la anterior'), tr('Registró'), tr('Turno'), tr('Pedido')],
      ...unitRows.map((x): Cell[] => [x.r.dept, lineNameOf(s, x.r.lineId, x.r.line), x.r.code, x.lot, x.i + 1, T(x.u.at), CFG[x.r.dept].unit, x.qty ?? '', x.qty != null ? CFG[x.r.dept].qtyUnit : '', x.u.ref, D(x.gap), x.u.by, x.shift, x.order])]
    const paros: Cell[][] = [[tr('Departamento'), tr('Línea'), tr('Razón'), tr('Detalle'), tr('Inicio'), tr('Fin'), tr('Duración'), tr('Registró'), tr('Turno')],
      ...stops.map((x): Cell[] => [x.dept, lineName(x), tr(x.reason), noteLabel(x.note), T(x.startedAt), x.endedAt ? T(x.endedAt) : tr('en curso'), D(x.ms), x.by, spanShifts(rep.plan, x.startedAt, x.endedAt ?? now)])]
    // the whole day first and each shift under it (not when the report is of one shift only)
    const porTurno: Cell[][] = [[tr('Departamento'), tr('Turno'), tr('Horario'), tr('Empezó'), tr('Terminó'), tr('Duración'), tr('Líneas'), tr('Códigos'), tr('Corridas'), tr('Hechas'), tr('Unidad'), tr('Cantidad'), tr('Unidad de cantidad'), tr('Waste (lb)'), tr('Tiempo trabajando'), tr('Tiempo parado'), 'Set up'],
      ...rep.byShift.flatMap((d) => [d.day, d.first, d.second].map((x): Cell[] => [d.dept, x.shift ? tr('Turno {0}', x.shift) : tr('Total del día'), x.shift ? shiftHours(rep.plan, x.shift) : '', x.from ? T(x.from) : '', !x.to ? '' : x.open ? tr('en curso') : T(x.to), x.span ? D(x.span) : '', x.lines, x.distinct, x.codes, x.units, CFG[d.dept].unit, CFG[d.dept].qty !== 'none' ? x.qty : '', CFG[d.dept].qty !== 'none' ? CFG[d.dept].qtyUnit : '', x.waste || '', D(x.working), D(x.down), x.setup ? D(x.setup) : '']))]
    const cambios: Cell[][] = [[tr('Hora'), tr('Quién'), tr('Departamento'), tr('Qué'), tr('Antes'), tr('Después')], ...changes.map((c): Cell[] => [T(c.at), c.by, c.dept ?? '', c.what, c.before, c.after])]
    const av = mgr && !dept && !rep.filtered ? avanceRows(s, date) : []
    const avance: Cell[][] = [[tr('Código'), tr('Producto'), tr('Mezclas progr.'), tr('Mezclas hechas'), tr('Mezclas pend.'), 'Spiral', tr('Pouches progr.'), tr('Pouches esper.'), tr('Pouches hechos'), tr('Pouches pend.'), tr('Pouches faltan'), tr('Cajas progr.'), tr('Cajas esper.'), tr('Cajas hechas'), tr('Cajas pend.'), tr('Cajas faltan'), tr('MFO cajas'), tr('Pallets progr.'), tr('Pallets esper.'), tr('Pallets hechos'), tr('Waste lb')],
      ...av.map((r): Cell[] => [r.code, r.product?.name ?? '', r.scheduled, r.mixesDone, r.mixesPending, r.spiralDone, r.pouchesPlan, r.pouchesExp, r.pouchesDone, pending(r.pouchesExp, r.pouchesDone), pending(r.pouchesPlan, r.pouchesDone), r.casesPlan, r.casesExp, r.casesDone, pending(r.casesExp, r.casesDone), pending(r.casesPlan, r.casesDone), r.mfoCases, r.palletsPlan, r.palletsExp, r.palletsDone, r.wasteLb])]
    return { resumen, porTurno, porCodigo, porLote, unidades, paros, cambios, avance }
  }
  /** the Excel file's sheets: one per table (Cambios and Avance only for the manager and the office) */
  const sheets = (): Sheet[] => {
    const b = blocks()
    return [{ name: tr('Resumen'), rows: b.resumen }, ...(b.porTurno.length > 1 ? [{ name: tr('Por turno'), rows: b.porTurno }] : []), { name: tr('Por código'), rows: b.porCodigo }, { name: tr('Por lote'), rows: b.porLote }, { name: tr('Unidades'), rows: b.unidades }, { name: tr('Paros'), rows: b.paros }, ...(mgr ? [{ name: tr('Cambios'), rows: b.cambios }] : []), ...(b.avance.length > 1 ? [{ name: tr('Avance'), rows: b.avance }] : [])]
  }
  const excel = async () => {
    try {
      const bytes = xlsxNow(sheets()) ?? (await loadZip(), xlsxNow(sheets()))
      if (!bytes) throw new Error('xlsx')
      download(new File([bytes], fileName + '.xlsx', { type: XLSX_TYPE }))
    } catch (e) { failed(tr('hacer el Excel'), e) }
  }
  const csv = () => download(new File([csvText()], fileName + '.csv', { type: 'text/csv;charset=utf-8' }))
  const csvText = () => {
    const q = (c: Cell) => '"' + cellText(c).replace(/"/g, '""') + '"'
    const b = blocks()
    const tag = (title: string, t: Cell[][]) => t.map((r, i): Cell[] => (i === 0 ? ['', title, ...r] : ['', '', ...r]))
    const all: Cell[][] = [...b.resumen, ...(b.porTurno.length > 1 ? [[], ...tag(tr('POR TURNO'), b.porTurno)] : []), [], ...tag(tr('POR CÓDIGO'), b.porCodigo), [], ...tag(tr('POR LOTE'), b.porLote), [], ...tag('UNIDADES', b.unidades), [], ...tag(tr('PAROS'), b.paros), ...(mgr ? [[], ...tag('CAMBIOS', b.cambios)] : []), ...(b.avance.length > 1 ? [[], ...tag('AVANCE', b.avance)] : [])]
    return '\ufeff' + all.map((r) => r.map(q).join(',')).join('\r\n')
  }
  // ---- what the screen needs besides the report itself ----
  const today = workDay(s, now).date
  // the rooms a manager can choose among: the ones with something recorded that day
  const depts = only ? [] : DEPTS.filter((d) => d === fDept || s.runs.some((r) => r.date === date && r.dept === d))
  // what is chosen, said in words (the filters add up: any of them with any other)
  const active = [!only && dept ? dept : '', rep.shift ? tr('Turno {0}', rep.shift) + (shiftPick === null ? (who.shift ? ' (tu turno)' : ' ' + tr('(en curso)')) : '') : '', rep.code ? tr('Código {0}', rep.code) : '', rep.lot ? tr('Lote {0}', rep.lot) : ''].filter(Boolean)
  const clear = () => { setFCode(''); setFLot(''); setFShift(0); setFDept('') }
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
  /** a shift's hours in two pieces that never break inside: "6:00 AM" and "a 3:00 PM" */
  const hrs = (k: 1 | 2) => { const [from, to] = shiftSpan(rep.plan, k); return <><span>{from}</span> <span>{tr('a {0}', to)}</span></> }
  const dash = (v: number) => (v ? fmtN(v) : '—')
  /** what a time that adds up the lines is the sum of: "suma de 3 líneas" */
  const linesText = (n: number) => (n === 1 ? tr('una línea') : tr('suma de {0} líneas', n))
  /** the title of a list that opens and closes */
  const secHead = (key: string, title: string, count: number) => (
    <div className="sechead">
      <h3>{title} · {count}</h3>
      <button type="button" className="lnk sm" aria-expanded={!shut[key]} onClick={() => setShut({ ...shut, [key]: !shut[key] })}>{shut[key] ? tr('Mostrar ▾') : tr('Ocultar ▴')}</button>
    </div>
  )
  const colsN = 7 + (rep.shift ? 0 : 2)
  return (
    <section className="report">
      <div className="rhead">
        <div className="rtitle"><h2>{tr('Reporte del día')}{only ? ' · ' + only : ''}</h2><span>{longDate(date)}</span></div>
        <div className="racts">
          <button type="button" className="btn primary" onClick={() => void send()} disabled={!rows.length || preparing}>{preparing ? tr('Preparando…') : <>{tr('✉ Enviar')}<span className="opt"> {' '}{tr('reporte')}</span></>}</button>
          <button type="button" className="btn" onClick={() => void pdf()} disabled={!rows.length}>{tr('📄 PDF')}<span className="opt"> {' '}{tr('/ imprimir')}</span></button>
          <button type="button" className="btn" onClick={() => void excel()} disabled={!rows.length}>{tr('⬇ Excel')}</button>
          <button type="button" className="lnk" onClick={csv} disabled={!rows.length}>CSV</button>
        </div>
      </div>
      {sending && <SendDialog files={sending} subject={tr('Actividad · Reporte {0}', date) + (dept ? ' · ' + dept : '') + filterTitle(rep.code, rep.lot, rep.shift)} onClose={() => setSending(null)} />}
      {/* what to look at: the day, the shift, the room, the code and the lot. They add up, any of them with any other */}
      <div className="rfilters">
        <div className="rf-row">
          <div className="rf">
            <span className="lab">{tr('Fecha')}</span>
            <div className="daynav">
              <button type="button" className="btn" aria-label={tr('Día anterior')} onClick={() => setDate(addDays(date, -1))}>‹</button>
              <input type="date" aria-label={tr('Fecha del reporte')} value={date} onChange={(e) => { if (e.target.value) setDate(e.target.value) }} />
              <button type="button" className="btn" aria-label={tr('Día siguiente')} disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>›</button>
              {date !== today && <button type="button" className="btn" onClick={() => setDate(today)}>{tr('Hoy')}</button>}
            </div>
          </div>
          <div className="rf grow">
            <span className="lab">{tr('Turno')}{can('shifts') && <button type="button" className="lnk sm" onClick={() => setShiftsOpen(true)}>{tr('Cambiar horario')}</button>}</span>
            <div className="seg" role="group" aria-label={tr('Turno')}>
              {([0, 1, 2] as const).map((k) => (
                <button key={k} type="button" className={rep.shift === k ? 'on' : ''} aria-pressed={rep.shift === k} onClick={() => setFShift(k)}>{k ? tr('Turno {0}', k) : tr('Día completo')}<small className="hrs">{k ? hrs(k) : tr('los dos turnos')}</small></button>
              ))}
            </div>
          </div>
        </div>
        <div className="rf-row">
          {depts.length > 1 && (
            <div className="rf wide">
              <span className="lab">{tr('Departamento')}</span>
              <div className="chips">
                <button type="button" className={'chip' + (!dept ? ' on' : '')} aria-pressed={!dept} onClick={() => setFDept('')}>{tr('Todos')}</button>
                {depts.map((d) => <button key={d} type="button" className={'chip' + (dept === d ? ' on' : '')} aria-pressed={dept === d} onClick={() => setFDept(d)}>{d}</button>)}
              </div>
            </div>
          )}
          <div className="rf-two">
            <label className="rf"><span className="lab">{tr('Código')}</span>
              <select value={rep.code} disabled={!rep.codes.length} onChange={(e) => setFCode(e.target.value)}><option value="">{tr('Todos')}</option>{rep.codes.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            </label>
            <label className="rf"><span className="lab">{tr('Lote')}</span>
              <select value={rep.lot} disabled={!rep.lots.length} onChange={(e) => setFLot(e.target.value)}><option value="">{tr('Todos')}</option>{rep.lots.map((l) => <option key={l} value={l}>{l}</option>)}</select>
            </label>
          </div>
        </div>
        {active.length > 0 && (
          <div className="rf-now">
            <span>{tr('Viendo')}</span>{active.map((t) => <b key={t} className="tag">{t}</b>)}
            <button type="button" className="btn sm" onClick={clear}>{tr('✕ Quitar filtros')}</button>
          </div>
        )}
        {active.length > 0 && <p className="rf-foot">{tr('Los archivos salen con lo que estás viendo.')}{rep.lot && !rep.shift && ' ' + tr('Con un lote, los tiempos y el waste son los de las corridas completas.')}</p>}
      </div>
      <DayNote day={day} />
      {purges.map((c) => (
        <div key={c.id} className="purged">
          <span>{trx('⚠ A las {0}, {1} quitó de este día {2}. No se perdieron: siguen guardados en el servidor.', <b>{fmtTime(c.at)}</b>, <b>{c.by}</b>, <b>{tookText(c.before)}</b>)}</span>
          {admin || can('del')
            ? <button type="button" className="btn primary" disabled={recovering} onClick={() => void recover(c.id)}>{recovering ? tr('Recuperando…') : tr('↩ Recuperarlos')}</button>
            : <small>{tr('Un manager puede recuperarlos desde aquí.')}</small>}
        </div>
      ))}
      {shiftsOpen && <ShiftsDialog s={s} date={date} onClose={() => setShiftsOpen(false)} />}
      {rows.length === 0 ? <p className="hint">{day.state === 'here' ? (rep.code || rep.lot || (!only && dept) ? tr('Nada registrado con estos filtros.') : rep.shift ? tr('Nada registrado en este turno.') : tr('Nada registrado en esta fecha.')) : ''}</p> : (
        <>
          {/* what was made, big: each room counts in its own unit */}
          <div className="heads">
            {rep.byDept.map((d) => {
              const cfg = CFG[d.dept], q = cfg.qty !== 'none'
              const boxes = q && rep.code && cfg.qtyUnit === 'pouches' ? casesText(inCases(s, rep.code, d.qty)) : ''
              return (
                <div key={d.dept} className="made">
                  <label>{d.dept}{rep.code ? ' ' + tr('· código {0}', rep.code) : ''}{rep.lot ? ' ' + tr('· lote {0}', rep.lot) : ''}</label>
                  <b>{fmtN(q ? d.qty : d.units)} <span>{q ? cfg.qtyUnit : (d.units === 1 ? cfg.unit : cfg.plural).toLowerCase()}</span></b>
                  <small>{[q ? unitsText(d.dept, d.units) : '', boxes, d.waste ? 'waste ' + d.waste + ' lb' : ''].filter(Boolean).join(' · ') || '\u00a0'}</small>
                </div>
              )
            })}
          </div>
          <div className="totals">
            {rep.byDept.length === 1 && <div className="stat"><label>{rep.shift ? tr('Duración del turno {0}', rep.shift) : tr('Duración del día')}</label><b>{fmtDur(rep.byDept[0].span)}</b><small>{fmtTime(rep.byDept[0].from)} a {rep.byDept[0].open ? tr('ahora') : fmtTime(rep.byDept[0].to)}</small></div>}
            <div className="stat"><label>{tr('Códigos')}</label><b>{rep.distinct}</b><small>{rows.length} {rows.length === 1 ? tr('corrida') : tr('corridas')}</small></div>
            <div className="stat"><label>{tr('Trabajando')}</label><b>{fmtDur(working)}</b><small>{linesText(rep.lines)}</small></div>
            <div className="stat"><label>{tr('Parado')}</label><b className={down ? 'red' : ''}>{fmtDur(down)}</b><small>{linesText(rep.lines)}</small></div>
            <div className="stat"><label>Set up</label><b>{setup ? fmtDur(setup) : '—'}</b><small>{tr('entre un código y otro')}</small></div>
          </div>
          {/* the whole day and each shift side by side, room by room (with one shift chosen, that shift alone) */}
          {(rep.byShift.length > 0 || rep.byDept.length > 1) && (
            <>
              <h3>{rep.shift ? tr('Por departamento · Turno {0}', rep.shift) : tr('Total del día y cada turno')}</h3>
              <div className="deptgrid">
                {rep.byDept.map((d) => {
                  const b = rep.byShift.find((x) => x.dept === d.dept), cols = b ? [b.day, b.first, b.second] : [d]
                  const cfg = CFG[d.dept], q = cfg.qty !== 'none'
                  const mark = (x: (typeof cols)[number]) => (b && !x.shift ? 'day' : '')
                  const cell = (x: (typeof cols)[number], v: ReactNode, red = false) => <td key={x.shift} className={mark(x) + (red ? ' red' : '')}>{v}</td>
                  return (
                    <div key={d.dept} className="deptcard">
                      <h4>{d.dept}</h4>
                      <div className="scroll">
                        <table className="shiftgrid">
                          <thead><tr><th></th>{cols.map((x) => <th key={x.shift} className={mark(x)}>{x.shift ? <>{trx('Turno {0}', x.shift)}<small className="hrs">{hrs(x.shift)}</small></> : tr('Total del día')}</th>)}</tr></thead>
                          <tbody>
                            {q && <tr className="q"><td>{cap(cfg.qtyUnit)}</td>{cols.map((x) => cell(x, fmtN(x.qty)))}</tr>}
                            <tr className={q ? '' : 'q'}><td>{cfg.plural}</td>{cols.map((x) => cell(x, fmtN(x.units)))}</tr>
                            {cols.some((x) => x.waste > 0) && <tr><td>Waste</td>{cols.map((x) => cell(x, x.waste ? x.waste + ' lb' : '—', x.waste > 0))}</tr>}
                            <tr><td>{tr('Códigos')}</td>{cols.map((x) => cell(x, x.distinct))}</tr>
                            <tr><td>{tr('Corridas')}</td>{cols.map((x) => cell(x, x.codes))}</tr>
                            <tr><td>{tr('Líneas')}</td>{cols.map((x) => cell(x, x.lines))}</tr>
                            <tr className="sep"><td colSpan={cols.length + 1}>{tr('Reloj del turno')}</td></tr>
                            <tr><td>{tr('Empezó')}</td>{cols.map((x) => cell(x, x.from ? fmtTime(x.from) : '—'))}</tr>
                            <tr><td>{tr('Terminó')}</td>{cols.map((x) => cell(x, !x.to ? '—' : x.open ? tr('en curso') : fmtTime(x.to)))}</tr>
                            <tr><td>{tr('Duración')}</td>{cols.map((x) => cell(x, x.span ? fmtDur(x.span) : '—'))}</tr>
                            <tr className="sep"><td colSpan={cols.length + 1}>{tr('Suma de las líneas')}</td></tr>
                            <tr><td>{tr('Trabajando')}</td>{cols.map((x) => cell(x, fmtDur(x.working)))}</tr>
                            <tr><td>{tr('Parado')}</td>{cols.map((x) => cell(x, fmtDur(x.down), x.down > 0))}</tr>
                            <tr><td>Set up</td>{cols.map((x) => cell(x, x.setup ? fmtDur(x.setup) : '—'))}</tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}
              </div>
              {!rep.shift && (
                <details className="how">
                  <summary>{tr('¿Cómo se reparte entre los turnos?')}</summary>
                  <p>{tr('Cada registro cuenta en el turno de su hora. Un código que pasó de un turno al otro cuenta en los dos, cada uno con lo suyo; su waste se reparte según lo hecho en cada turno. El tiempo nunca se detiene solo. Cuando ya pasó el rato entre un turno y el otro, si en una línea nadie registró nada en todo ese rato, ese rato no cuenta.')}</p>
                </details>
              )}
              <details className="how">
                <summary>{tr('¿Qué es cada número?')}</summary>
                <p>{trx('{0} es el reloj: desde que empezó el primer código hasta que terminó el último. {1} y {2} son la suma de todas las líneas: tres líneas trabajando cinco horas cada una son quince horas. {3} son los productos distintos. Una {4} es un código en una línea, desde que empieza hasta que termina: el mismo código en dos líneas son dos corridas. {5} es el tiempo entre un código y el siguiente en la misma línea.', <b>{tr('Duración')}</b>, <b>{tr('Trabajando')}</b>, <b>{tr('Parado')}</b>, <b>{tr('Códigos')}</b>, <b>{tr('corrida')}</b>, <b>Set up</b>)}</p>
              </details>
            </>
          )}
          {/* each code with its lots, the total of the code and the total of the room */}
          <div className="sechead"><h3>{tr('Por código y lote')}</h3>{!(rep.code && rep.lot) && <small>{tr('Toca un código o un lote para ver solo eso.')}</small>}</div>
          <div className="twrap">
            <table className="bycode">
              <thead><tr><th>{tr('Código')}</th><th>{tr('Lote')}</th><th className="num">{tr('Hechas')}</th><th className="num">{tr('Cantidad')}</th>{!rep.shift && <><th className="num">{tr('Turno 1')}</th><th className="num">{tr('Turno 2')}</th></>}<th>{tr('En cajas')}</th><th className="num">Waste</th><th>{tr('Líneas')}</th></tr></thead>
              <tbody>
                {rep.byDept.map((d) => {
                  const cfg = CFG[d.dept], q = cfg.qty !== 'none', b = rep.byShift.find((x) => x.dept === d.dept)
                  const boxes = (code: string, qty: number) => (cfg.qtyUnit === 'pouches' && casesText(inCases(s, code, qty))) || '—'
                  const lotBtn = (l: string) => (!l ? '—' : rep.lot ? l : <button type="button" className="drill" onClick={() => setFLot(l)}>{l}</button>)
                  const qtyText = (v: number) => (q ? fmtN(v) + ' ' + cfg.qtyUnit : '—')
                  return (
                    <Fragment key={d.dept}>
                      {rep.byDept.length > 1 && <tr className="drow"><td colSpan={colsN}>{d.dept}</td></tr>}
                      {byCode.filter((c) => c.dept === d.dept).map((c) => (
                        <Fragment key={c.code}>
                          <tr className="crow">
                            <td>{rep.code ? <b className="code">{c.code}</b> : <button type="button" className="drill code" onClick={() => setFCode(c.code)}>{c.code}</button>}</td>
                            <td>{c.lots.length === 1 ? lotBtn(c.lots[0].lot) : tr('{0} lotes', c.lots.length)}</td>
                            <td className="num">{unitsText(c.dept, c.units)}</td>
                            <td className="num">{qtyText(c.qty)}</td>
                            {c.byShift && <><td className="num">{dash(c.byShift[0])}</td><td className="num">{dash(c.byShift[1])}</td></>}
                            <td>{boxes(c.code, c.qty)}</td><td className={'num' + (c.waste ? ' red' : '')}>{c.waste ? c.waste + ' lb' : '—'}</td><td>{c.lines.join(', ')}</td>
                          </tr>
                          {c.lots.length > 1 && c.lots.map((l) => (
                            <tr key={l.lot} className="lrow">
                              <td></td><td>{lotBtn(l.lot)}</td><td className="num">{unitsText(c.dept, l.units)}</td><td className="num">{qtyText(l.qty)}</td>
                              {l.byShift && <><td className="num">{dash(l.byShift[0])}</td><td className="num">{dash(l.byShift[1])}</td></>}
                              <td>{boxes(c.code, l.qty)}</td><td></td><td></td>
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                      <tr className="trow">
                        <td colSpan={2}>{trx('Total {0}', d.dept)}</td><td className="num">{unitsText(d.dept, d.units)}</td><td className="num">{qtyText(d.qty)}</td>
                        {b && <><td className="num">{dash(q ? b.first.qty : b.first.units)}</td><td className="num">{dash(q ? b.second.qty : b.second.units)}</td></>}
                        <td></td><td className={'num' + (d.waste ? ' red' : '')}>{d.waste ? d.waste + ' lb' : '—'}</td><td></td>
                      </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* what the "Parado" total is made of */}
          {rep.reasons.length > 0 && (
            <>
              <h3>{tr('Parado por causa')}</h3>
              <div className="reasons">
                {rep.reasons.map((x) => (
                  <div key={x.reason} className="reason">
                    <b>{tr(x.reason)}</b><span>{fmtDur(x.ms)}</span><span className="pct">{down > 0 ? Math.round((x.ms / down) * 100) + '%' : ''}</span>
                    <div className="rbar"><i style={{ width: Math.max(2, Math.round((x.ms / rep.reasons[0].ms) * 100)) + '%' }} /></div>
                  </div>
                ))}
              </div>
            </>
          )}
          {secHead('runs', tr('Corridas'), rows.length)}
          {!shut.runs && (
            <>
        <div className="twrap">
          <table>
            <thead><tr><th>{tr('Depto')}</th><th>{tr('Línea')}</th><th>{tr('Código')}</th><th>{tr('Lote')}</th>{!rep.shift && <th>{tr('Turno')}</th>}<th>{tr('Inicio')}</th><th>{tr('Fin')}</th><th>{tr('Hecho')}</th><th>Waste</th><th>{tr('Trabajando')}</th><th>{tr('Prom./unidad')}</th><th>{tr('Parado')}</th><th>{tr('Razones')}</th><th>{tr('Registró')}</th><th></th></tr></thead>
            <tbody>{cut('runs', rows).map((x) => (
              <tr key={x.r.id} className={x.r.endedAt ? '' : 'live'}>
                <td>{x.r.dept}</td><td>{lineNameOf(s, x.r.lineId, x.r.line)}</td><td><b>{x.r.code}</b></td><td>{x.lots}</td>{!rep.shift && <td>{x.shifts}</td>}<td>{fmtTime(x.r.startedAt)}</td><td>{x.r.endedAt ? fmtTime(x.r.endedAt) : <i>{tr('en curso')}</i>}</td>
                <td>{madeText(x.view, x.qty, true)}</td><td className={x.waste ? 'red' : ''}>{x.waste ? x.waste + ' lb' : '—'}</td><td>{fmtDur(x.st.working)}</td><td>{x.timed ? fmtDur(x.st.avg) : '—'}</td><td className={x.st.down ? 'red' : ''}>{fmtDur(x.st.down)}</td><td>{reasonsText(x) || '—'}</td><td>{whoText(x.r)}</td>
                <td>{can('fix') && canShift(who, x.shifts) && <button type="button" className="lnk" onClick={() => setEditRun(x.r.id)}>{tr('Corregir')}</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {moreBar('runs', rows.length)}
            </>
          )}
        </>
      )}
      {unitRows.length > 0 && (
        <>
          {secHead('units', tr('Detalle por unidad'), unitRows.length)}
          {!shut.units && (
            <>
          <div className="twrap">
            <table>
              <thead><tr><th>{tr('Hora')}</th>{!rep.shift && <th>{tr('Turno')}</th>}<th>{tr('Depto')}</th><th>{tr('Línea')}</th><th>{tr('Código')}</th><th>{tr('Lote')}</th><th>#</th><th>{tr('Unidad')}</th><th>{tr('Cantidad')}</th><th>{tr('Tag / bin')}</th>{withOrders && <th>{tr('Pedido')}</th>}<th>{tr('Desde la anterior')}</th><th>{tr('Registró')}</th></tr></thead>
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
        </>
      )}
      {stops.length > 0 && (
        <>
          {secHead('stops', tr('Paros'), stops.length)}
          {!shut.stops && (
            <>
          <div className="twrap">
            <table>
              <thead><tr><th>{tr('Depto')}</th><th>{tr('Línea')}</th><th>{tr('Razón')}</th><th>{tr('Detalle')}</th>{!rep.shift && <th>{tr('Turno')}</th>}<th>{tr('Inicio')}</th><th>{tr('Fin')}</th><th>{tr('Duración')}</th><th>{tr('Registró')}</th><th></th></tr></thead>
              <tbody>{cut('stops', stops).map((x) => (
                <tr key={x.id} className={x.endedAt ? '' : 'live'}>
                  <td>{x.dept}</td><td>{lineName(x)}</td><td><b>{tr(x.reason)}</b></td><td>{noteLabel(x.note) || '—'}</td>{!rep.shift && <td>{spanShifts(rep.plan, x.startedAt, x.endedAt ?? now)}</td>}<td>{fmtTime(x.startedAt)}</td><td>{x.endedAt ? fmtTime(x.endedAt) : <i>{tr('en curso')}</i>}</td><td>{fmtDur(x.ms)}</td><td>{x.by}</td>
                  <td>{can('fix') && canShift(who, spanShifts(rep.plan, x.startedAt, x.endedAt ?? now)) && <button type="button" className="lnk" onClick={() => setEditStop(x.id)}>{tr('Corregir')}</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {moreBar('stops', stops.length)}
            </>
          )}
        </>
      )}
      {changes.length > 0 && (
        <>
          {secHead('changes', tr('Cambios y correcciones'), changes.length)}
          {!shut.changes && (
            <>
          <div className="twrap">
            <table className="changes">
              <thead><tr><th>{tr('Hora')}</th><th>{tr('Quién')}</th><th>{tr('Depto')}</th><th>{tr('Qué')}</th><th>{tr('Antes')}</th><th>{tr('Después')}</th></tr></thead>
              <tbody>{cut('changes', changes).map((c) => (
                <tr key={c.id}><td>{fmtTime(c.at)}</td><td>{c.by}</td><td>{c.dept ?? '—'}</td><td>{c.what}</td><td className={c.before ? 'was' : ''}>{c.before || '—'}</td><td><b>{c.after || '—'}</b></td></tr>
              ))}</tbody>
            </table>
          </div>
          {moreBar('changes', changes.length)}
          <p className="hint">{tr('Cada corrección, cambio en la tabla de productos, en el programa del día o en las líneas queda aquí con quién lo hizo y a qué hora. Lo normal del día (carros, mezclas, paros) no sale aquí: ya lleva el nombre de quien lo registró.')}</p>
            </>
          )}
        </>
      )}
      <p className="hint foot">{supabase ? tr('Todo se guarda en el servidor y se ve en vivo desde la oficina, el teléfono o la PC.') : tr('Demo guardado en este dispositivo. La versión completa manda todo en vivo al manager (oficina, teléfono o PC) y exporta a Excel, PDF y Google Sheets como la Hoja de Freezer RTE.')}</p>
      {runToEdit && <RunEditor s={s} run={runToEdit} mgr={can('fix')} onClose={() => setEditRun(null)} />}
      {stopToEdit && <StopEditor stop={stopToEdit} mgr={can('fix')} onClose={() => setEditStop(null)} />}
      {mgr && (
        <div className="btns">
          {!supabase && <button type="button" className="lnk" onClick={() => setClearing(true)}>{tr('Reiniciar registros (conserva productos y líneas)')}</button>}
          <button type="button" className="lnk" onClick={() => setResetting(true)}>{supabase ? tr('Limpiar este aparato y volver a bajar del servidor') : tr('Borrar todo')}</button>
          {!supabase && <button type="button" className="lnk" onClick={() => { setNewPin(''); setPinOpen(true) }}>{tr('Cambiar código de manager')}</button>}
          {supabase && <button type="button" className="lnk" onClick={() => setUploading(true)}>{tr('Subir al servidor los registros de este aparato')}</button>}
          {admin && runs.length + stops.length > 0 && <button type="button" className="lnk" onClick={() => setWiping(true)}>{tr('Borrar todo lo registrado este día (pruebas)')}</button>}
        </div>
      )}
      {wiping && <WipeDayDialog s={s} date={date} onClose={() => setWiping(false)} onDone={setNotice} />}
      {uploading && <ConfirmDialog title={tr('¿Subir al servidor todo lo que tiene este aparato?')} text={tr('Corridas, paros, líneas, productos y programado de este aparato se mandan al servidor (lo que ya estaba allá se conserva si es más nuevo). Útil una sola vez por tablet, para traer los días del piloto.')} yes={tr('Subir')} onYes={() => { const n = uploadAll(); setUploading(false); setNotice({ title: tr('{0} registros en cola', n), text: tr('Se envían en cuanto hay señal. El punto junto a tu nombre dice "Sincronizado" cuando terminó.') }) }} onNo={() => setUploading(false)} />}
      {notice && <NoticeDialog title={notice.title} text={notice.text} onClose={() => setNotice(null)} />}
      {pinOpen && (
        <div className="veil" onClick={() => setPinOpen(false)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()}>
            <h3>{tr('Código de manager')}</h3>
            <p>{tr('Con este código se entra como manager en este dispositivo (ve todos los departamentos, el Avance y puede borrar datos).')}</p>
            <form className="qform" onSubmit={(e) => { e.preventDefault(); if (newPin.trim().length >= 4) { managerPin.set(newPin.trim()); setPinOpen(false) } }}>
              <label>{tr('Nuevo código (mínimo 4)')}{' '}<input autoFocus inputMode="numeric" value={newPin} onChange={(e) => setNewPin(e.target.value)} autoComplete="off" /></label>
              <div className="dbtns"><button type="button" className="btn" onClick={() => setPinOpen(false)}>{tr('Cancelar')}</button><button type="submit" className="btn primary" disabled={newPin.trim().length < 4}>{tr('Guardar')}</button></div>
            </form>
          </div>
        </div>
      )}
      {clearing && <ConfirmDialog title={tr('¿Reiniciar los registros?')} text={tr('Se borran las corridas, los paros y lo programado de todos los días. La tabla de productos y las líneas se quedan. No se puede deshacer.')} yes={tr('Reiniciar')} danger onYes={() => { resetRecords(); setClearing(false) }} onNo={() => setClearing(false)} />}
      {resetting && <ConfirmDialog title={supabase ? tr('¿Limpiar este aparato?') : tr('¿Borrar todos los datos de este dispositivo?')} text={supabase ? tr('Se vacía lo guardado en este aparato y se vuelve a bajar todo del servidor. Lo que esté en el servidor no se toca; lo que este aparato no haya subido todavía se pierde.') : tr('Se borran las líneas, los registros, los paros, lo programado y la tabla de productos. No se puede deshacer.')} yes={supabase ? tr('Limpiar y bajar') : tr('Borrar todo')} danger onYes={() => { reset(); setResetting(false) }} onNo={() => setResetting(false)} />}
    </section>
  )
}
