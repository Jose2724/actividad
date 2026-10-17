import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { InputHTMLAttributes, ReactNode, Ref } from 'react'
import { addLine, addWaste, apartLabel, apartWord, awayDay, cameFrom, carriedOver, dayAfter, BIN_WORDS, binOf, binWord, cfgFor, dayShiftsText, kindClass, setDayShifts, setShiftWeek, weekOf, MFO_WORDS, measureName, measureOf, measureUnit, setSpiralUnit, SPIRAL_UNITS, type SpiralUnit, byLineName, byShip, casesText, cancelDay, CFG, cfgOf, closeOrder, codeProblem, CRATES_PER_CART, dayOf, dayRecords, DEPTS, deptStop, deleteOrder, deptToday, dropSetup, endOlderRuns, endRun, endShift, endStop, fillUnit, fmtDur, fmtTime, freeLineNames, freeLines, idleStop, inCases, KEEP_DAYS, lastEnded, lastPerUnit, leftOpen, LINE_NAME_MAX, lineLabel, lineNamed, lineNameOf, lineShiftGoalOf, lineTargetOf, lotFor, lotNowOf, lotsText, madeText, minuteText, managerPin, mergeProducts, myDept, nextOrderFor, nightText, nearDay, normCode, noteLabel, numOf, openIn, openOrdersFor, openRun, openRuns, openStop, orderCodes, orderLabel, orderOfId, orderPallets, orderRunsOf, unitQty, palletDone, palletLotEnds, reopenPallet, palletOrder, palletPartFix, palletPo, SETUP, switchToSetup, orderMade, parseProductsCsv, plainDay, planOf, planRows, productOf, productsCsv, purgeDay, purgesOf, removeLine, removeProduct, renameLine, reopenRun, reset, restorePurged, resetRecords, role, runQty, runSince, runStats, saveOrder, saveProduct, setLineShiftGoal, setLotNow, setPackRoom, setPlan, setSchedule, setShiftGoal, setShifts, shiftGoalOf, startDay, startRun, startSetup, startSetupAll, setupAllFrom, startStop, stopTime, store, swapLineNames, targetOf, tidyLineName, turnOf, unitsText, savedText, shiftAt, shiftCuts, shiftHours, shiftSpan, shiftsOf, shiftsProblem, shortEnded, shortUnit, unitDone, user, workDay, workedSince, type Dept, type DeptCfg, type Line, type Product, type LotPart, type Run, type Order, type PackRoom, type ShiftHours, type Short, type State, type WorkDay } from './store'
import { avanceLots, avanceRange, avanceRows, datesBetween, lotAcrossDays, lotRows, lotsKnown, mfoList, mfoText, mfoWord, n1, pending, type AvancePart, type AvanceRow, type MfoMade } from './avance'
import { cellText, loadZip, xDay, xDur, xTime, xlsxNow, XLSX_TYPE, type Cell, type Sheet } from './xlsx'

const fmtN = (x: number) => Math.round(x).toLocaleString('en-US')
import { whoText } from './store'
import { buildPdf, loadPdf } from './pdf'
import { homeScreenApple, sharePick, shareProblem, type Kind } from './send'
import { filterFile, filterTitle, reportOf, spanShifts, unitParts, type ReportFilter } from './report'
import { canDo, canShift, type Power, type Who } from './powers'
import { AddRunDialog, RunEditor, StopEditor } from './editors'
import { fetchMe, finishSignOut, loginEmail, rememberedMe, rememberedUser, rememberMe, rememberUser, signedOut, signOutHere, supabase, type Me } from './supabase'
import { leaveAsk, loadDay, STALE_MS, startSync, syncStore, syncNow, unreachable, fetchPurged } from './sync'
import { storageFull } from './storage'
import { clockNow, clockOffText, clockState, otherZone, startClock, syncClock } from './clock'
import { BUILD, keepView, reloadNow, updateStore, updateText, viewKept } from './update'
import { startHello } from './devices'
import { keepAwake } from './awake'
import { Settings, type SettingsKey } from './Settings'
import { appUrl, qrPath } from './qr'
import { uploadAll } from './store'
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
export function LangSwitch() {
  const pick = (l: 'es' | 'en') => { if (l !== lang) { saveLang(l); location.reload() } }
  return (
    <span className="langsw" role="group" aria-label="Idioma / Language">
      <span className="globe" aria-hidden="true">🌐</span>
      <button type="button" className={lang === 'es' ? 'on' : ''} aria-pressed={lang === 'es'} title="Español" onClick={() => pick('es')}>ES</button>
      <button type="button" className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} title="English" onClick={() => pick('en')}>EN</button>
    </span>
  )
}
export function QrLink({ label }: { label: string }) {
  const [open, setOpen] = useState(false)
  return <><button type="button" className="lnk" onClick={() => setOpen(true)}>{label}</button>{open && <QrDialog onClose={() => setOpen(false)} />}</>
}

/**
 * The name of a line: asked when one is added (which line of the plant is it?) and changed when it was wrong. A name
 * that another line of the room already has can be traded with it in one tap.
 */
export function LineNameDialog({ s, dept, line, onClose }: { s: State; dept: Dept; line?: Line; onClose: () => void }) {
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
    window.addEventListener('online', again); document.addEventListener('visibilitychange', seen); window.addEventListener('act-verify', again) // the queue found the server no longer takes this session
    // and every ten minutes while on the screen: an account closed or a PIN changed takes the session off the server, and a tablet left open all day must find out
    const t = setInterval(() => { if (!confirmed.current || (document.visibilityState === 'visible' && Date.now() - confirmed.current > 600_000)) void verify() }, 60_000)
    return () => { clearTimeout(slow); clearInterval(t); window.removeEventListener('online', again); document.removeEventListener('visibilitychange', seen); window.removeEventListener('act-verify', again) }
  }, [verify])
  useEffect(() => {
    if (me && me !== 'none' && me !== 'loading') { user.set(me.name); role.set(me.role === 'op' ? 'op' : 'mgr'); myDept.set(me.dept); startSync(); startHello(me.id) }
  }, [me])
  const out = async () => { leaving.current = true; rememberMe(null); user.set(''); confirmed.current = 0; setErr(''); setMe(null); await signOutHere() }
  /** the PIN was accepted: the server is asked who that is */
  const entered = async () => { leaving.current = false; await verify() }
  if (me === 'loading') return <div className="gate"><LangSwitch /><h1>Actividad</h1><p>{tr('Entrando…')}</p></div>
  if (me === null) return <LoginGate error={err} onDone={entered} />
  if (me === 'none') return <NoRole onOut={out} onRetry={verify} />
  const home = isDept(me.dept) ? me.dept : DEPTS[0]
  if (me.role === 'op' && !isDept(me.dept)) return <NoRole onOut={out} onRetry={verify} text={tr('Tu usuario está en Actividad pero sin departamento. Pide al manager que te asigne uno.')} />
  return <WhoCtx.Provider value={{ role: me.role, admin: !!me.admin, powers: me.powers ?? null, shift: me.shift ?? 0 }}><Main name={me.name} home={home} mgr={me.role !== 'op'} admin={!!me.admin} wholeDay={!!me.admin || me.role === 'office' || me.role === 'viewer'} meId={me.id} onLogout={() => void out()} /></WhoCtx.Provider>
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
/** somebody who only looks: the screens show everything and offer nothing to press (the server refuses their writes too) */
export const useViewOnly = () => useWho().role === 'viewer'
export const useCan = () => { const w = useContext(WhoCtx); return (p: Power) => canDo(w, p) }

function Main({ name, home, mgr, admin, wholeDay, meId, onLogout }: { name: string; home: Dept; mgr: boolean; admin: boolean; wholeDay?: boolean; meId?: string; onLogout: () => void }) {
  const s = useSyncExternalStore(store.subscribe, store.get)
  const now = useNow()
  const can = useCan(), viewOnly = useViewOnly()
  const day = workDay(s, now)
  // the room and the tab come back after the reload a new version brings (see update.ts)
  const kept = viewKept<{ dept?: string; tab?: string; sec?: string }>()
  const [dept, setDept] = useState<Dept>(kept?.dept && isDept(kept.dept) ? kept.dept : home)
  // Empleados and Tablets live in Ajustes now: a view kept from before opens there, on its section
  const [tab, setTab] = useState<'act' | 'av' | 'rep' | 'set'>(kept?.tab === 'av' || kept?.tab === 'rep' ? kept.tab : kept?.tab === 'set' || kept?.tab === 'emp' || kept?.tab === 'dev' ? 'set' : 'act')
  const [sec, setSec] = useState<SettingsKey>(kept?.tab === 'emp' ? 'people' : kept?.tab === 'dev' ? 'devices' : ((kept?.sec as SettingsKey | undefined) ?? 'shifts'))
  useEffect(() => { keepView({ dept, tab, sec }) }, [dept, tab, sec])
  const upd = useSyncExternalStore(updateStore.subscribe, updateStore.get)
  useEffect(() => keepAwake(), []) // a tablet on the floor must not go to sleep in the middle of a shift
  // every free line of every room into set up with one tap (a manager's or the office's, when a shift starts)
  const [setupAll, setSetupAll] = useState(false)
  const free = mgr && !viewOnly ? freeLines(s, now) : []
  const setupFrom = free.length ? setupAllFrom(s, now) : now
  const full = useSyncExternalStore(storageFull.subscribe, storageFull.get)
  // a device that has not brought the server's rows for a while shows an old picture of the day (what Jose saw on an
  // RTE tablet on 2026-10-15: the code before, and the pouches of hours earlier): said loud, and each line asks before recording
  const sync = useSyncExternalStore(syncStore.subscribe, syncStore.get)
  const staleMs = supabase ? now - sync.lastSync : 0
  const stale = !!supabase && staleMs > STALE_MS
  const why = sync.state === 'signedOut' ? tr('sin sesión') : sync.state === 'offline' ? tr('sin señal') : tr('sin alcanzar el servidor')
  const [leaving, setLeaving] = useState(false)
  // only with a server is there a time to share; on its own, a device simply shows its own clock
  const away = !!supabase && otherZone(now), off = supabase ? clockOffText() : ''
  // a device whose clock the server could not set goes by its own, which nobody has checked: the hours it records
  // and the timers it shows can be minutes off from every other screen (what the office saw on 2026-10-16: "esta
  // mezcla" that would not go back to zero). Said after a minute and a half of trying, with the live time above to compare
  const clk = supabase ? clockState() : null, clockUnset = !!clk && !clk.measured && performance.now() > 90_000
  // what was recorded here and has not reached the server: said loud after five minutes, or at once when the server no
  // longer takes this session (an account closed, a PIN changed, the person is not of this room). Nothing is lost: it
  // waits on the device and goes up as soon as someone the server accepts signs in (what the floor lived on 2026-10-16:
  // a whole shift of mezclas "that never got recorded")
  const stuckMs = sync.pending > 0 && sync.since ? now - sync.since : 0
  const unsent = !!supabase && (sync.state === 'signedOut' || sync.refused > 0 || stuckMs > 5 * 60_000)
  const mustSignIn = sync.state === 'signedOut' || sync.refused > 0
  const unsentWhy = sync.state === 'signedOut' ? tr('este aparato ya no tiene sesión en el servidor') : sync.refused > 0 ? tr('el servidor no acepta lo que registra esta sesión ({0})', name) : sync.lastError || (sync.state === 'offline' ? tr('sin señal') : tr('sin alcanzar el servidor'))
  return (
    <div className="app">
      {away ? <div className="zonebar">{tr('⚠ Este aparato está puesto en otra zona horaria que la planta: las horas y la fecha saldrán corridas. En los ajustes del aparato, activa la zona horaria automática.')}</div>
        : off && <div className="zonebar">{trx('⚠ El reloj de este aparato está {0}. La app usa la hora correcta, la del servidor. Para arreglarlo, activa la hora automática en los ajustes del aparato.', off)}</div>}
      {clockUnset && clk && <div className="stalebar top"><span>{trx('⚠ Este aparato no ha podido ajustar su reloj con el del servidor ({0}). Si su hora está mal, los tiempos de las mezclas y del turno salen corridos aquí, y las horas que registre también. Compara la hora de arriba con un teléfono.', clk.savedAt ? tr('usa la medida de hace {0}', agoText(now - clk.savedAt)) : tr('usa su propio reloj'))}</span><button type="button" className="btn sm" onClick={() => void syncClock()}>{tr('Reintentar')}</button></div>}
      {upd.ready && <div className="updatebar"><span>{updateText()}</span><button type="button" className="btn sm" onClick={reloadNow}>{tr('Actualizar')}</button></div>}
      {unsent && <div className="stalebar top unsent"><span>{trx('⚠ {0} sin subir desde hace {1}: {2}. Se guardan en este aparato y suben en cuanto se pueda.', sync.pending === 1 ? tr('1 registro') : tr('{0} registros', sync.pending), agoText(Math.max(60_000, stuckMs)), unsentWhy)}{mustSignIn && ' ' + tr('Sal y entra de nuevo con tu usuario; si sigue, avisa al manager.')}</span>{mustSignIn ? <button type="button" className="btn sm" onClick={() => void onLogout()}>{tr('Entrar de nuevo')}</button> : <button type="button" className="btn sm" onClick={() => window.dispatchEvent(new Event('act-resync'))}>{tr('Reintentar')}</button>}</div>}
      {full && <div className="fullbar">{trx('⚠ La memoria de este aparato está llena y lo nuevo no se está guardando aquí. {0}', supabase ? tr('Lo que ya subió al servidor está a salvo. Avisa al manager y no cierres la app hasta que diga "Sincronizado".') : tr('Manda el reporte del día y avisa al manager antes de cerrar la app: hay que hacer espacio con "Reiniciar registros".'))}</div>}
      {stale && <div className="stalebar top"><span>{sync.lastSync ? trx('⚠ Este aparato muestra lo de las {0}: lleva {1} sin bajar del servidor ({2}). Si en otra tablet cambió algo, aquí todavía no se ve.', fmtTime(sync.lastSync), agoText(staleMs), why) : trx('⚠ Este aparato no ha bajado nada del servidor todavía ({0}).', why)}</span><button type="button" className="btn sm" onClick={() => window.dispatchEvent(new Event('act-resync'))}>{tr('Reintentar')}</button></div>}
      <header className="top">
        <div className="brand"><h1>Actividad{!supabase && <span className="demotag">DEMO</span>}</h1><small>{new Date(now).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })} · <b className="livetime" title={supabase ? tr('La hora de la app: la del servidor, la misma en todos los aparatos') : ''}>{new Date(now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</b>{BUILD && BUILD !== 'dev' && <span className="buildtag" title={tr('La versión de la app en este aparato')}>v {BUILD.slice(0, 6)}</span>}</small></div>
        <nav className="tabs">
          <button type="button" className={tab === 'act' ? 'on' : ''} onClick={() => setTab('act')}>{tr('Actividad')}</button>
          {(can('products') || viewOnly) && <button type="button" className={tab === 'av' ? 'on' : ''} onClick={() => setTab('av')}>{tr('Avance')}</button>}
          <button type="button" className={tab === 'rep' ? 'on' : ''} onClick={() => setTab('rep')}>{tr('Reporte')}</button>
          <button type="button" className={'settab' + (tab === 'set' ? ' on' : '')} onClick={() => setTab('set')} aria-label={tr('Ajustes')}><span className="gear">⚙</span><span className="word">{tr('Ajustes')}</span></button>
        </nav>
        <div className="me"><SyncDot /> <span className="who">{name}</span><span className="where">{viewOnly ? tr('Solo ver') : mgr ? tr('Manager') : home}</span> {mgr && <QrLink label="QR" />}<LangSwitch /><button type="button" className="lnk" onClick={() => setLeaving(true)}>{supabase ? tr('Salir') : tr('Cambiar')}</button></div>
      </header>
      {leaving && <LeaveDialog onYes={() => { setLeaving(false); onLogout() }} onNo={() => setLeaving(false)} />}
      {tab === 'act' ? (
        <>
        <DayBar s={s} now={now} day={day} mgr={can('day')} calendar={can('shifts')} />
        <div className="main">
          {/* the manager moves between rooms; a supervisor or operator only has their own */}
          {can('depts') && (
            <aside className="side">
              {DEPTS.map((d) => {
                const lines = s.lines.filter((l) => l.dept === d)
                const running = lines.filter((l) => openRun(s, l.id) && !openStop(s, d, l.id)).length
                const stopped = lines.filter((l) => openRun(s, l.id) && openStop(s, d, l.id)).length
                const goal = shiftGoalOf(s, d, turnOf(s, day.date, now).shift).total, td = goal ? deptToday(s, d, day.date, now) : null
                return (
                  <button key={d} type="button" className={'dept' + (dept === d ? ' on' : '')} onClick={() => setDept(d)}>
                    <span className="dname">{d}{td && goal && <small className="goalmini">{fmtN(td.shiftQty)} / {fmtN(goal)} {td.unitLabel}</small>}</span>
                    <span className="dots">{running > 0 && <i className="dot g">{running}</i>}{stopped > 0 && <i className="dot r">{stopped}</i>}</span>
                  </button>
                )
              })}
              {free.length > 0 && <button type="button" className="btn sm setupbtn setupall" onClick={() => setSetupAll(true)}>{tr('⏱ Set up en todas las líneas')}<small>{free.length === 1 ? tr('1 línea libre') : tr('{0} líneas libres', free.length)}</small></button>}
              {setupAll && <ConfirmDialog title={tr('¿Poner en Set up todas las líneas libres?')} text={DEPTS.filter((d) => free.some((l) => l.dept === d)).map((d) => d + ': ' + free.filter((l) => l.dept === d).map((l) => lineLabel(l.name)).join(', ')).join(' · ') + '. ' + (now - setupFrom > 60_000 ? tr('El Set up cuenta desde las {0}, el inicio del turno.', fmtTime(setupFrom)) : tr('El Set up cuenta desde ahora.')) + ' ' + tr('Cuenta cuando empiece el código de cada línea; con nadie trabajando no cuenta. Las líneas que ya tienen código o Set up siguen como están.')} yes={tr('⏱ Empezar Set up')} onYes={() => { startSetupAll(); setSetupAll(false) }} onNo={() => setSetupAll(false)} />}
            </aside>
          )}
          <DeptPanel key={dept} s={s} dept={can('depts') ? dept : home} now={now} mgr={mgr} day={day} />
        </div>
        </>
      ) : tab === 'av' && (can('products') || viewOnly) ? <Avance s={s} /> : tab === 'set' ? <Settings s={s} now={now} day={day} name={name} home={home} mgr={mgr} admin={admin} viewOnly={viewOnly} meId={meId ?? ''} section={sec} onSection={setSec} onLeave={() => setLeaving(true)} /> : <Report s={s} now={now} only={can('depts') ? undefined : home} mgr={can('depts')} admin={admin} wholeDay={!!wholeDay} />}
    </div>
  )
}

/** the office's AVANCE sheet, live: scheduled → done → pending per room, computed from the products table */
/**
 * One room's cell of the Avance table: what the room registered, big; against what the mezclas already made allow
 * (expected), with a bar and what is still lacking in colour; and, under it, what the day's program still lacks when
 * that is another number. With a lot chosen there is no program: a program is the day's, not a lot's.
 */
function AvStat({ made, exp, plan, unit, lot, note }: { made: number; exp: number | null; plan: number | null; unit: string; lot: boolean; note?: string }) {
  if (exp == null && !made) return <div className="avstat none">—</div>
  const pend = pending(exp, made), left = lot || plan == null ? null : pending(plan, made)
  const pct = exp ? Math.max(0, Math.min(100, Math.round((made / exp) * 100))) : 0
  const cls = pend == null ? '' : pend < 0 ? 'over' : pend > 0 ? 'left' : 'ok'
  return (
    <div className={'avstat ' + cls}>
      <div className="avs-top"><b>{(Math.round(made * 10) / 10).toLocaleString('en-US')}</b><small>{exp != null ? trx('de {0} {1}', n1(exp), unit) : unit}</small>{note && <small className="avs-note">{note}</small>}</div>
      {exp != null && <div className="bar"><i className={cls} style={{ width: pct + '%' }} /></div>}
      {pend != null && <small className="avs-pend">{pend > 0 ? trx('faltan {0}', n1(pend)) : pend < 0 ? trx('{0} de más', n1(-pend)) : tr('✓ completo')}</small>}
      {left != null && plan !== exp && <small className="avs-plan">{trx('programa {0} · faltan {1}', n1(plan), n1(Math.max(0, left)))}</small>}
    </div>
  )
}

/**
 * Which room packs a code, beside it: RTE or MFO, the one in force filled. When the products table does not say it,
 * the app supposes it from what each room has registered and draws the switch dashed with a "?": one tap fixes it,
 * in the products table, for every day.
 */
function RouteSwitch({ room, said, readOnly, onPick }: { room: PackRoom; said: boolean; readOnly: boolean; onPick: (r: PackRoom) => void }) {
  const why = said ? tr('Lo dice la tabla de Productos. Toca el otro para cambiarlo.') : tr('La app lo supone por lo que ha registrado cada cuarto. Toca RTE o MFO para fijarlo.')
  if (readOnly) return <small className={'packroom ' + room.toLowerCase()} title={why}>{room}{said ? '' : ' ?'}</small>
  return (
    <span className={'route' + (said ? '' : ' guess')} role="group" aria-label={tr('Lo empaca')} title={why}>
      {(['RTE', 'MFO'] as const).map((k) => <button key={k} type="button" className={k === room ? 'on ' + k.toLowerCase() : ''} aria-pressed={k === room} onClick={() => onPick(k)}>{k}</button>)}
      {!said && <small>?</small>}
    </span>
  )
}

/**
 * The day's progress, with the office's AVANCE arithmetic but readable at a glance: the day's totals on top, then one
 * row per code with one cell per room (what the room registered, big; against what the mezclas made allow; what the
 * program still lacks). A code opens into its lots and its shifts. One lot of the day can be chosen with a tap, and
 * a lot's total across its days is said, since a lot goes on into the next day.
 */
function Avance({ s }: { s: State }) {
  const viewOnly = useViewOnly()
  const today = workDay(s).date
  const [date, setDate] = useState(today)
  const [editing, setEditing] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  // codes being worked on in this screen stay listed while their number is typed, also at 0; a code left at 0 is gone the next time
  const typing = useRef({ date, codes: new Set<string>() })
  if (typing.current.date !== date) typing.current = { date, codes: new Set() }
  for (const [c, n] of Object.entries(s.schedule[date] ?? {})) if (n > 0) typing.current.codes.add(normCode(c))
  // one lot of the day: what was made of it, without the day's program (that is per code, not per lot)
  const [lot, setLot] = useState('')
  // the lot can be looked at on this date only, or over every day it was worked (a lot goes on into the next day)
  const [scope, setScope] = useState<'date' | 'all'>('date')
  // or several days added up: from one date to another (the days the device does not hold are brought from the server)
  const [range, setRange] = useState(false)
  const [from, setFrom] = useState(addDays(today, -6))
  const [to, setTo] = useState(today)
  const span = range ? datesBetween(from, to) : [date]
  const preset = (n: number) => from === addDays(today, -(n - 1)) && to === today
  const lots = range ? [...new Set(span.flatMap((d) => avanceLots(s, d)))].sort() : avanceLots(s, date), known = lotsKnown(s), lotNow = lot && (lots.includes(lot) || known.includes(lot)) ? lot : ''
  const isAll = !range && !!lotNow && scope === 'all'
  const all = range ? avanceRange(s, from, to, lotNow) : isAll ? lotRows(s, lotNow) : avanceRows(s, date, lotNow ? undefined : typing.current.codes, lotNow)
  const away = span.filter((d) => awayDay(d)).length
  useEffect(() => { for (const d of span) if (awayDay(d)) void loadDay(d) }, [range, from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  const needle = plainText(q)
  const rows = needle ? all.filter((r) => plainText(r.code).includes(needle) || plainText(r.product?.name ?? '').includes(needle)) : all
  const sum = (f: (r: AvanceRow) => number | null) => rows.reduce((t, r) => t + (f(r) ?? 0), 0)
  // a sum of expected numbers is only known when some row knows it (a blank in the products table is "not known")
  const sumOr = (f: (r: AvanceRow) => number | null) => (rows.some((r) => f(r) != null) ? sum(f) : null)
  const day = useDay(date)
  // a code and its lot that went on into the next day, and one that came on from the day before (the next day's
  // records are brought too, when they are not on this device)
  useDay(dayAfter(date))
  const carry = carriedOver(s, date).filter((x) => x.next <= today), came = cameFrom(s, date)
  const carryNotes = (code: string) => [
    ...carry.filter((x) => normCode(x.code) === normCode(code)).map((x) => x.done ? { cls: 'ok', text: tr('{0}: ✓ completado el {1}', x.dept, shortDay(x.next)) } : x.made > 0 ? { cls: 'amber', text: tr('{0}: pendiente {1} {2} · siguió el {3}', x.dept, fmtN(x.pending - x.made), x.unit, shortDay(x.next)) } : { cls: 'amber', text: tr('{0}: pendiente {1} {2} al día siguiente', x.dept, fmtN(x.pending), x.unit) }),
    ...came.filter((x) => normCode(x.code) === normCode(code)).map((x) => ({ cls: '', text: tr('↪ {0}: {1} {2} del lote del {3}', x.dept, fmtN(x.made), x.unit, shortDay(x.from)) })),
  ]
  const across = lotNow ? lotAcrossDays(s, lotNow) : null
  const toggle = (code: string) => setOpen({ ...open, [code]: !open[code] })
  const isLot = !!lotNow
  // MFO in what its bins hold, word by word (platos, copas, pounds), as the operators typed it: the usual first
  const mfoAll = mfoList(rows.reduce((t, r) => { const out = { ...t }; for (const x of r.mfo) out[x.word] = (out[x.word] ?? 0) + x.qty; return out }, {} as Record<string, number>))
  const mfoRest = (l: MfoMade[]) => (l.length > 1 ? tr('y {0}', mfoText(l.slice(1))) : undefined)
  /** one of the day's totals on top: what was made, against what is expected, and what is lacking */
  const tile = (label: string, made: number, exp: number | null, expWord: string) => {
    const pend = pending(exp, made)
    return (
      <div className="made" key={label}>
        <label>{label}</label>
        <b>{fmtN(Math.round(made * 100) / 100)}</b>
        <small>{exp != null ? trx('de {0} {1}', n1(exp), expWord) : '\u00a0'}{pend != null && pend !== 0 ? ' · ' + (pend > 0 ? tr('faltan {0}', n1(pend)) : tr('{0} de más', n1(-pend))) : ''}</small>
      </div>
    )
  }
  const miniHead = <thead><tr><th></th><th>{tr('Mezclas')}</th><th>Spiral</th><th>Pouches</th><th>{tr('Cajas')}</th><th>MFO</th><th>Pallets</th></tr></thead>
  const miniRow = (key: string, label: ReactNode, x: AvancePart) => <tr key={key}><td>{label}</td><td>{x.mixes || '—'}</td><td>{x.spiral || '—'}</td><td>{x.pouches ? fmtN(x.pouches) : '—'}</td><td>{x.cases ? fmtN(x.cases) : '—'}</td><td>{mfoText(x.mfo) || '—'}</td><td>{x.pallets || '—'}</td></tr>
  const acrossText = (x: AvancePart) => [x.mixes ? x.mixes + ' ' + tr('mezclas') : '', x.pouches ? fmtN(x.pouches) + ' pouches' : '', x.cases ? fmtN(x.cases) + ' ' + tr('cajas') : '', mfoText(x.mfo) ? 'MFO ' + mfoText(x.mfo) : '', x.pallets ? x.pallets + ' pallets' : ''].filter(Boolean).join(' · ') || tr('nada')
  return (
    <section className="report avance av2">
      <div className="rhead">
        <div className="rtitle"><h2>{range ? tr('Avance de varios días') : tr('Avance del día')}</h2><span>{range ? trx('del {0} al {1} · {2} días', shortDay(from <= to ? from : to), shortDay(from <= to ? to : from), span.length) : longDate(date)}</span></div>
        <div className="racts">
          <button type="button" className="btn" onClick={() => setEditing(!editing)}>{editing ? tr('Cerrar productos') : tr('⚙ Productos')}</button>
        </div>
      </div>
      {/* what to look at: the day, one of its lots, a code; and the program typed from here */}
      <div className="rfilters">
        <div className="rf-row">
          <div className="rf">
            <span className="lab">{tr('Fecha')}<button type="button" className="lnk sm" onClick={() => setRange(!range)}>{range ? tr('Un día') : tr('Rango de fechas')}</button></span>
            {range ? (
              <div className="rangepick">
                <label>{tr('Desde')} <input type="date" value={from} onChange={(e) => { if (e.target.value) setFrom(e.target.value) }} /></label>
                <label>{tr('Hasta')} <input type="date" value={to} onChange={(e) => { if (e.target.value) setTo(e.target.value) }} /></label>
                <button type="button" className={'chip sm' + (preset(7) ? ' on' : '')} aria-pressed={preset(7)} onClick={() => { setFrom(addDays(today, -6)); setTo(today) }}>{tr('7 días')}</button>
                <button type="button" className={'chip sm' + (preset(30) ? ' on' : '')} aria-pressed={preset(30)} onClick={() => { setFrom(addDays(today, -29)); setTo(today) }}>{tr('30 días')}</button>
              </div>
            ) : (
              <div className="daynav">
                <button type="button" className="btn" aria-label={tr('Día anterior')} onClick={() => setDate(addDays(date, -1))}>‹</button>
                <input type="date" aria-label={tr('Fecha')} value={date} onChange={(e) => { if (e.target.value) setDate(e.target.value) }} />
                <button type="button" className="btn" aria-label={tr('Día siguiente')} onClick={() => setDate(addDays(date, 1))}>›</button>
                {date !== today && <button type="button" className="btn" onClick={() => setDate(today)}>{tr('Hoy')}</button>}
              </div>
            )}
          </div>
          <div className="rf grow">
            <span className="lab">{tr('Lote')}</span>
            {lots.length > 6 ? (
              <div className="chips lotpick">
                <select className={'lotsel wide' + (lotNow ? ' on' : '')} value={lotNow} aria-label={tr('Lote')} onChange={(e) => { const l = e.target.value; setLot(l); if (l && !lots.includes(l)) setScope('all') }}>
                  <option value="">{tr('Todos · {0} lotes', lots.length)}</option>
                  {lots.map((l) => <option key={l} value={l}>{l}</option>)}
                  {known.some((l) => !lots.includes(l)) && <optgroup label={tr('De otros días')}>{known.filter((l) => !lots.includes(l)).map((l) => <option key={l} value={l}>{l}</option>)}</optgroup>}
                </select>
              </div>
            ) : (
              <div className="chips lotpick">
                <button type="button" className={'chip' + (!lotNow ? ' on' : '')} aria-pressed={!lotNow} onClick={() => setLot('')}>{tr('Todos')}</button>
                {lots.map((l) => <button key={l} type="button" className={'chip' + (lotNow === l ? ' on' : '')} aria-pressed={lotNow === l} onClick={() => setLot(l)}>{l}</button>)}
                {lotNow && !lots.includes(lotNow) && <button type="button" className="chip on" aria-pressed>{lotNow}</button>}
                {known.some((l) => !lots.includes(l)) && (
                  <select className="lotsel" value="" aria-label={tr('Otro lote')} onChange={(e) => { const l = e.target.value; if (!l) return; setLot(l); if (!lots.includes(l)) setScope('all') }}>
                    <option value="">{tr('Otro lote…')}</option>
                    {known.filter((l) => !lots.includes(l)).map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                )}
              </div>
            )}
            {lotNow && !range && (
              <div className="seg lotscope" role="group" aria-label={tr('De cuándo')}>
                <button type="button" className={scope === 'date' ? 'on' : ''} aria-pressed={scope === 'date'} onClick={() => setScope('date')}>{tr('Solo esta fecha')}</button>
                <button type="button" className={scope === 'all' ? 'on' : ''} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>{tr('Todos los días')}</button>
              </div>
            )}
          </div>
          <label className="rf avsearch"><span className="lab">{tr('Buscar')}</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Código o producto')} autoComplete="off" /></label>
          {!viewOnly && !isAll && !range && (
            <form className="rf avadd" onSubmit={(e) => { e.preventDefault(); if (newCode.trim()) { typing.current.codes.add(normCode(newCode)); setSchedule(date, newCode, 0); setNewCode('') } }}>
              <span className="lab">{tr('Programar')}</span>
              <div className="addcode"><input placeholder={tr('Código a programar')} value={newCode} onChange={(e) => setNewCode(e.target.value)} autoComplete="off" /><button className="btn" type="submit" disabled={!newCode.trim()}>{tr('+ Programar')}</button></div>
            </form>
          )}
        </div>
      </div>
      {range ? (away > 0 && <p className="avlotnote">{trx('Trayendo del servidor {0} de los {1} días…', away, span.length)}</p>) : <DayNote day={day} />}
      {lotNow && across && (
        <p className="avlotnote">
          {range
            ? <><b>{trx('Viendo el lote {0} del {1} al {2}', lotNow, shortDay(from <= to ? from : to), shortDay(from <= to ? to : from))}</b> {tr('· el programa es de cada día, por eso aquí no sale.')}</>
            : isAll
            ? <><b>{trx('Viendo el lote {0} en todos sus días', lotNow)}</b>{across.days.length > 0 && ' (' + across.days.map(shortDay).join(', ') + ')'} {tr('· el programa es de cada día, por eso aquí no sale.')}</>
            : <><b>{trx('Viendo el lote {0}', lotNow)}</b> {tr('· lo que se hizo de ese lote en esta fecha. El programa es del día completo, por eso aquí no sale.')} {trx('Total del lote en todos sus días ({0}): {1}.', across.days.map(shortDay).join(', ') || '—', <b>{acrossText(across.total)}</b>)}</>}
          {!isAll && !lots.includes(lotNow) && <> {tr('Ese lote no se trabajó en esta fecha.')} <button type="button" className="lnk sm" onClick={() => setScope('all')}>{tr('Ver todos los días')}</button></>}
          {' '}<button type="button" className="lnk sm" onClick={() => setLot('')}>{tr('Ver todos los lotes')}</button>
        </p>
      )}
      {editing && <Products s={s} readOnly={viewOnly} />}
      {all.length === 0 ? <p className="hint">{viewOnly ? tr('Nada programado ni registrado en esta fecha.') : tr('Nada programado ni registrado en esta fecha. Escribe un código y toca "Programar".')}</p> : (
        <>
          <div className="heads">
            {tile(tr('Mezclas'), sum((r) => r.mixesDone), isLot ? null : sumOr((r) => r.scheduled || null), tr('programadas'))}
            {tile(tr('Pouches · RTE'), sum((r) => r.pouchesDone), sumOr((r) => r.pouchesExp), tr('esperados'))}
            {tile(tr('Cajas · Packing'), sum((r) => r.casesDone), sumOr((r) => r.casesExp), tr('esperadas'))}
            {mfoAll[0]?.word === 'cajas' || !mfoAll.length ? tile('MFO', mfoAll[0]?.qty ?? 0, sumOr((r) => r.mfoExp), tr('cajas esperadas')) : (
              <div className="made" key="MFO"><label>MFO</label><b>{(Math.round(mfoAll[0].qty * 10) / 10).toLocaleString('en-US')} <span>{mfoWord(mfoAll[0].word)}</span></b><small>{mfoRest(mfoAll) ?? '\u00a0'}</small></div>
            )}
            {tile('Pallets', sum((r) => r.palletsDone), sumOr((r) => r.palletsExp), tr('esperados'))}
            {!isAll && tile('Waste', sum((r) => r.wasteLb), null, 'lb')}
          </div>
          <p className="hint">{trx('{0} en grande = lo que cada cuarto registró. {1} = lo que ya puede salir de las mezclas hechas (mezclas × tabla de productos). {2} = programado − hecho: lo que queda del día. Toca ▸ para ver un código por lote y por turno.', <b>{tr('Hecho')}</b>, <b>{tr('Esperado')}</b>, <b>{tr('Programa')}</b>)}</p>
          <div className="twrap">
            <table className="avtable">
              <thead><tr><th>{tr('Código')}</th><th>{tr('Mezclas')}</th><th>Spiral</th><th>{tr('Pouches · RTE')}</th><th>{tr('Cajas · Packing')}</th><th>MFO</th><th>Pallets</th><th>Waste</th></tr></thead>
              <tbody>{rows.map((r) => {
                const notes = carryNotes(r.code), isOpen = !!open[r.code]
                return (
                  <Fragment key={r.code}>
                    <tr className={isOpen ? 'avopen' : ''}>
                      <td className="avcode" data-label={tr('Código')}>
                        <div className="avc-top">
                          <button type="button" className="avfold" aria-expanded={isOpen} aria-label={tr('Ver por lote y por turno')} onClick={() => toggle(r.code)}>{isOpen ? '▾' : '▸'}</button>
                          <b className="code">{r.code}</b>
                          <RouteSwitch room={r.packRoom} said={r.packSaid} readOnly={viewOnly} onPick={(k) => setPackRoom(r.code, k)} />
                        </div>
                        <small className="pname">{r.product?.name ?? <i className="red">{tr('no está en Productos')}</i>}</small>
                        {notes.map((n, i) => <small key={i} className={'carry ' + n.cls}>{n.text}</small>)}
                      </td>
                      <td data-label={tr('Mezclas')}>
                        <AvStat made={r.mixesDone} exp={isLot ? null : r.scheduled || null} plan={null} unit={tr('mezclas')} lot={isLot} note={r.mixesDone > 0 ? r.mixRoom : undefined} />
                        {!viewOnly && !isLot && !range && <label className="avprog">{tr('Progr.')} <input className="num" inputMode="numeric" value={r.scheduled || ''} placeholder="0" onChange={(e) => setSchedule(date, r.code, Number(e.target.value.replace(/\D/g, '')) || 0)} /></label>}
                      </td>
                      <td className="slim" data-label="Spiral">{r.spiralDone || '—'}</td>
                      <td data-label={tr('Pouches · RTE')}><AvStat made={r.pouchesDone} exp={r.pouchesExp} plan={r.pouchesPlan} unit="pouches" lot={isLot} /></td>
                      <td data-label={tr('Cajas · Packing')}><AvStat made={r.casesDone} exp={r.casesExp} plan={r.casesPlan} unit={tr('cajas')} lot={isLot} /></td>
                      <td data-label="MFO"><AvStat made={r.mfo[0]?.qty ?? 0} exp={r.mfoExp} plan={r.mfoPlan} unit={r.mfo[0] ? mfoWord(r.mfo[0].word) : tr('cajas')} lot={isLot} note={mfoRest(r.mfo)} /></td>
                      <td data-label="Pallets"><AvStat made={r.palletsDone} exp={r.palletsExp} plan={r.palletsPlan} unit="pallets" lot={isLot} /></td>
                      <td className={'slim' + (r.wasteLb ? ' red' : '')} data-label="Waste">{r.wasteLb ? r.wasteLb + ' lb' : '—'}</td>
                    </tr>
                    {isOpen && (
                      <tr className="avdetail"><td colSpan={8}>
                        <div className="avd">
                          {(isAll || range) && (
                            <div className="avd-block">
                              <h4>{tr('Por día')}</h4>
                              <table className="avmini">{miniHead}<tbody>{(r.days ?? []).map((d) => miniRow(d.date, <button type="button" className="drill" title={tr('Ver ese día')} onClick={() => { setDate(d.date); setScope('date'); setRange(false) }}>{shortDay(d.date)}</button>, d))}</tbody></table>
                            </div>
                          )}
                          {!isAll && (
                            <>
                              <div className="avd-block">
                                <h4>{tr('Por lote')}</h4>
                                {r.lots.length ? <table className="avmini">{miniHead}<tbody>{r.lots.map((l) => miniRow(l.lot, isLot ? <b>{l.lot}</b> : <button type="button" className="drill" title={tr('Ver solo este lote')} onClick={() => setLot(l.lot)}>{l.lot}</button>, l))}</tbody></table> : <p>{tr('Nada registrado de este código en esta fecha.')}</p>}
                              </div>
                              <div className="avd-block">
                                <h4>{tr('Por turno')}</h4>
                                <table className="avmini">{miniHead}<tbody>{miniRow('1', tr('Turno 1'), r.byShift[0])}{miniRow('2', tr('Turno 2'), r.byShift[1])}</tbody></table>
                              </div>
                            </>
                          )}
                          <div className="avd-block">
                            <h4>{tr('Lo empaca')}</h4>
                            <p>{r.packSaid ? trx('{0}, según la tabla de Productos. Toca el otro botón junto al código para cambiarlo.', <b>{r.packRoom}</b>) : trx('{0}, supuesto por lo que ha registrado cada cuarto: por eso lleva un "?". Toca RTE o MFO junto al código para fijarlo.', <b>{r.packRoom}</b>)}</p>
                          </div>
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                )
              })}</tbody>
              <tfoot><tr>
                <td className="avcode">{tr('Total')}{needle && <small className="pname">{trx('de lo que coincide con "{0}"', q.trim())}</small>}</td>
                <td data-label={tr('Mezclas')}><AvStat made={sum((r) => r.mixesDone)} exp={isLot ? null : sumOr((r) => r.scheduled || null)} plan={null} unit={tr('mezclas')} lot={isLot} /></td>
                <td className="slim" data-label="Spiral">{sum((r) => r.spiralDone) || '—'}</td>
                <td data-label={tr('Pouches · RTE')}><AvStat made={sum((r) => r.pouchesDone)} exp={sumOr((r) => r.pouchesExp)} plan={sumOr((r) => r.pouchesPlan)} unit="pouches" lot={isLot} /></td>
                <td data-label={tr('Cajas · Packing')}><AvStat made={sum((r) => r.casesDone)} exp={sumOr((r) => r.casesExp)} plan={sumOr((r) => r.casesPlan)} unit={tr('cajas')} lot={isLot} /></td>
                <td data-label="MFO"><AvStat made={mfoAll[0]?.qty ?? 0} exp={mfoAll.length > 1 ? null : sumOr((r) => r.mfoExp)} plan={mfoAll.length > 1 ? null : sumOr((r) => r.mfoPlan)} unit={mfoAll[0] ? mfoWord(mfoAll[0].word) : tr('cajas')} lot={isLot} note={mfoRest(mfoAll)} /></td>
                <td data-label="Pallets"><AvStat made={sum((r) => r.palletsDone)} exp={sumOr((r) => r.palletsExp)} plan={sumOr((r) => r.palletsPlan)} unit="pallets" lot={isLot} /></td>
                <td className={'slim' + (sum((r) => r.wasteLb) ? ' red' : '')} data-label="Waste">{sum((r) => r.wasteLb) ? Math.round(sum((r) => r.wasteLb) * 100) / 100 + ' lb' : '—'}</td>
              </tr></tfoot>
            </table>
          </div>
          {rows.length === 0 && <p className="hint">{trx('Ningún código coincide con "{0}".', q.trim())}</p>}
        </>
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
export function Products({ s, readOnly }: { s: State; readOnly?: boolean }) {
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
        {!readOnly && <button type="button" className={'btn' + (unlocked ? ' primary' : '')} onClick={() => setUnlocked(!unlocked)}>{unlocked ? tr('✓ Listo, bloquear') : tr('✎ Editar')}</button>}
      </div>
      <div className="twrap">
        <table>
          <thead><tr><th>{tr('Código')}</th><th>{tr('Producto')}</th><th>{tr('Pouches / caja')}</th><th>{tr('Cajas / mezcla (yield)')}</th><th>{tr('Guacales / carro')}</th><th>{tr('Pouches / guacal')}</th><th>{tr('Cajas / pallet')}</th><th>{tr('Lo empaca')}</th><th>{tr('Spiral cuenta en')}</th>{unlocked && <th></th>}</tr></thead>
          <tbody>
            {s.products.length === 0 && <tr><td colSpan={10}><i>{tr('No hay productos todavía.')}{!unlocked && ' ' + tr('Toca "Editar" para escribirlos o importar el CSV de la oficina.')}</i></td></tr>}
            {s.products.length > 0 && shown.length === 0 && <tr><td colSpan={10}><i>{trx('Ningún producto con "{0}".', q.trim())}</i></td></tr>}
            {shown.map(({ p, i }) => unlocked ? (
              <tr key={(p.code || '·') + ':' + i}>
                <td><Cell className="code" value={p.code} onCommit={(t) => upd(i, { code: t.trim().toUpperCase() })} /></td>
                <td><Cell className="name" value={p.name} onCommit={(t) => upd(i, { name: t.trim() })} /></td>
                <td><Cell className="num" numeric value={text(p.pouchesPerCase)} onCommit={(t) => upd(i, { pouchesPerCase: numOf(t) })} /></td>
                <td><Cell className="num" numeric value={text(p.casesPerMix)} onCommit={(t) => upd(i, { casesPerMix: numOf(t) })} /></td>
                <td><Cell className="num" numeric value={text(p.cratesPerCart)} onCommit={(t) => upd(i, { cratesPerCart: numOf(t) })} /></td>
                <td><Cell className="num" numeric value={text(p.pouchesPerCrate)} onCommit={(t) => upd(i, { pouchesPerCrate: numOf(t) })} /></td>
                <td><Cell className="num" numeric value={text(p.casesPerPallet)} onCommit={(t) => upd(i, { casesPerPallet: numOf(t) })} /></td>
                <td><select className="room" value={p.room ?? ''} aria-label={tr('Lo empaca')} onChange={(e) => upd(i, { room: (e.target.value || undefined) as Product['room'] })}><option value="">—</option><option value="RTE">RTE</option><option value="MFO">MFO</option></select></td>
                <td><select className="room" value={p.spiralUnit ?? ''} aria-label={tr('Spiral cuenta en')} onChange={(e) => upd(i, { spiralUnit: (e.target.value || undefined) as Product['spiralUnit'] })}><option value="">—</option>{SPIRAL_UNITS.map((u) => <option key={u} value={u}>{measureUnit(u)}</option>)}</select></td>
                <td><button type="button" className="lnk" onClick={() => setRemoveIdx(i)}>✕</button></td>
              </tr>
            ) : (
              <tr key={p.code + ':' + i}>
                <td><b className="mono">{p.code}</b></td><td>{p.name}</td>
                <td className="r">{show(p.pouchesPerCase)}</td><td className="r">{show(p.casesPerMix)}</td><td className="r">{show(p.cratesPerCart)}</td><td className="r">{show(p.pouchesPerCrate)}</td><td className="r">{show(p.casesPerPallet)}</td><td>{p.room ?? '—'}</td><td>{p.spiralUnit ? measureUnit(p.spiralUnit) : '—'}</td>
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

export const longDate = (date: string) => new Date(date + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
const hhmm = (ms: number) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
/** the word to type before records are wiped: always a deliberate act, never a stray tap */
const WIPE_WORD = 'BORRAR'
const wipeOk = (typed: string) => typed.trim().toUpperCase() === WIPE_WORD
/** "1 corrida y 0 paros", "12 corridas y 1 paro" */
const howMany = (runs: number, stops: number) => tr('{0} y {1}', runs + ' ' + (runs === 1 ? tr('corrida') : tr('corridas')), stops + ' ' + (stops === 1 ? tr('paro') : tr('paros')))

/** which day of work it is, for everyone; the manager starts it here */
function DayBar({ s, now, day, mgr, calendar }: { s: State; now: number; day: WorkDay; mgr: boolean; calendar: boolean }) {
  const [open, setOpen] = useState(false)
  const [cal, setCal] = useState(false) // the calendar of the plant: the day's shifts, the week, the hours
  const [notice, setNotice] = useState<{ title: string; text?: string } | null>(null)
  const plan = shiftsOf(s, day.date)
  if (!day.started && !mgr) return null
  return (
    <div className={'daybar' + (day.started ? ' on' : '')}>
      {day.started
        ? <span>{trx('Día de trabajo: {0} · empezó a las {1}', <b>{longDate(day.date)}</b>, <b>{fmtTime(day.started.at)}</b>)}{day.started.by ? ' · ' + day.started.by : ''}</span>
        : <span>{tr('El día de hoy todavía no se ha empezado.')}</span>}
      {mgr && <button type="button" className={day.started ? 'lnk' : 'btn primary'} onClick={() => setOpen(true)}>{day.started ? tr('Cambiar') : tr('▶ Empezar el día')}</button>}
      {day.started && <span className={'dayshifts' + (plan.only ? ' one' : '')}>{plan.only ? trx('Hoy solo trabaja el turno {0}', <b>{plan.only}</b>) : tr('Hoy trabajan los turnos 1 y 2')}{calendar && <button type="button" className="lnk sm" onClick={() => setCal(true)}>{tr('Cambiar')}</button>}</span>}
      {cal && <ShiftsDialog s={s} date={day.date} onClose={() => setCal(false)} />}
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
export function StartDayDialog({ s, now, day, onClose, onDone }: { s: State; now: number; day: WorkDay; onClose: () => void; onDone: (n: { title: string; text?: string }) => void }) {
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
/** "12 min", "2.5 h": how long ago */
const agoText = (ms: number) => (ms < 3_600_000 ? tr('{0} min', Math.round(ms / 60_000)) : tr('{0} h', Math.round(ms / 360_000) / 10))
/** "6168-6216", "6168/6216": two lots typed as one; a pallet with two lots is recorded lot by lot, each with its cases */
const looksLikeTwoLots = (lot: string) => /^\s*\d{3,5}\s*[-/,+]\s*\d{3,5}\s*$/.test(lot)
/** the pallets of the report, by their state */
type PalletFilter = '' | 'notag' | 'nopo' | 'po' | 'full' | 'short' | 'open'
/** without accents or capitals: what is typed in a search matches what was written */
const plainText = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const shortDay = (date: string) => new Date(date + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
/** when a goal is reached at the pace in course: the hour, and the day with it when that is not today (an hour alone would read as today's) */
const etaText = (eta: number, now: number) => (dayOf(eta) === dayOf(now)
  ? trx('· a este ritmo se llega a las {0}', <b>{fmtTime(eta)}</b>)
  : trx('· a este ritmo se llega el {0} a las {1}', <b>{shortDay(dayOf(eta))}</b>, <b>{fmtTime(eta)}</b>))
/** "15 oct" */
const shipText = (date: string) => new Date(date + 'T12:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' })
/** " · faltan 52 de 72 cajas", " · completo", or nothing when the order does not say how many cases it is for */
const leftText = (s: State, o: Order) => { if (o.cases == null) return ''; const left = o.cases - orderMade(s, o.id); return left > 0 ? ' ' + tr('· faltan {0} de {1} cajas', fmtN(left), fmtN(o.cases)) : ' ' + tr('· completo') }

/**
 * The orders Packing fills: the office (or a manager) types them, with or without a PO number, and everybody in the
 * room sees the open ones with what has been packed for each. The pallets are given to them one by one, on the line.
 */
type OrderState = 'todo' | 'going' | 'done' | 'open'
/** the orders are listed ten at a time: the list only grows */
const ORDERS_PAGE = 10
function OrdersCard({ s, mgr }: { s: State; mgr: boolean }) {
  const [editing, setEditing] = useState<string | null>(null) // an order's id, or 'new'
  const [viewing, setViewing] = useState<string | null>(null) // an order whose pallets are being looked at
  const [showClosed, setShowClosed] = useState(false)
  // the office looks for orders by what is written on them and by their state, and the filters combine (asked
  // 2026-10-16: "PO + código, sin empezar y las que faltan"): what is seen is added up at the foot of the table
  const [only, setOnly] = useState<'' | OrderState | 'left'>('')
  const [q, setQ] = useState('')
  const [fCode, setFCode] = useState('')
  const [shown, setShown] = useState(ORDERS_PAGE)
  if (!s.orders.length && !mgr) return null
  const open = s.orders.filter((o) => !o.closed).sort(byShip), closed = s.orders.filter((o) => o.closed).sort(byShip)
  // each order with what has been packed for it, and its state: not started, started, complete (or no cases said)
  const rowOf = (o: Order) => { const made = orderMade(s, o.id), left = o.cases != null ? o.cases - made : null; return { o, made, left, seq: orderPallets(s, o.id), st: (left == null ? 'open' : left <= 0 ? 'done' : made > 0 ? 'going' : 'todo') as OrderState } }
  const needle = plainText(q)
  const hits = (o: Order) => !needle || [o.po, o.customer, o.dest, o.code, productOf(s, o.code)?.name ?? ''].some((t) => plainText(String(t ?? '')).includes(needle))
  const isState = (x: ReturnType<typeof rowOf>, k: '' | OrderState | 'left') => (!k ? true : k === 'left' ? x.st === 'todo' || x.st === 'going' : x.st === k)
  const rows = open.map(rowOf).filter((x) => hits(x.o))
  const codes = [...new Map(rows.map((x) => [normCode(x.o.code), x.o.code])).entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
  const codeNow = codes.some(([k]) => k === fCode) ? fCode : ''
  const ofCode = rows.filter((x) => !codeNow || normCode(x.o.code) === codeNow)
  const count = (k: OrderState | 'left') => ofCode.filter((x) => isState(x, k)).length
  const list = ofCode.filter((x) => isState(x, only))
  const stateText = (k: OrderState | 'left') => (k === 'todo' ? tr('Sin empezar') : k === 'going' ? tr('Empezados') : k === 'done' ? tr('Completos') : k === 'left' ? tr('Faltan') : tr('Sin cantidad'))
  const closedHits = needle ? closed.filter(hits).length : 0
  const active = [needle ? '"' + q.trim() + '"' : '', codeNow ? tr('Código {0}', codes.find(([k]) => k === codeNow)?.[1] ?? codeNow) : '', only ? stateText(only) : ''].filter(Boolean)
  const clear = () => { setQ(''); setFCode(''); setOnly(''); setShown(ORDERS_PAGE) }
  /** what is seen, added up: the foot of the table */
  const sums = (list: ReturnType<typeof rowOf>[]) => ({ asked: list.reduce((t, x) => t + (x.o.cases ?? 0), 0), made: list.reduce((t, x) => t + x.made, 0), left: list.reduce((t, x) => t + Math.max(0, x.left ?? 0), 0), pallets: list.reduce((t, x) => t + x.seq.done.length, 0), need: list.reduce((t, x) => t + (x.seq.need ?? 0), 0), unknown: list.some((x) => x.o.cases == null) })
  const table = (list: ReturnType<typeof rowOf>[]) => (
    <div className="twrap">
      <table className="otable">
        <thead><tr><th>PO</th><th>{tr('Código')}</th><th>{tr('Cliente')}</th><th>{tr('Envío')}</th><th className="num">{tr('Pedidas')}</th><th className="num">{tr('Hechas')}</th><th className="num">{tr('Faltan')}</th><th>{tr('Pallets')}</th><th>{tr('Destino')}</th>{mgr && <th></th>}</tr></thead>
        <tbody>{list.map(({ o, made, left, seq, st }) => {
          const name = productOf(s, o.code)?.name
          return (
            <tr key={o.id} className={'o-' + st}>
              <td><button type="button" className="drill" title={tr('Ver sus pallets')} onClick={() => setViewing(o.id)}>{o.po || <i>{tr('sin PO')}</i>}</button></td>
              <td><b className="code">{o.code}</b>{name && <small className="pname">{name}</small>}</td>
              <td>{o.customer || '—'}</td><td>{o.shipBy ? shipText(o.shipBy) : '—'}</td>
              <td className="num">{o.cases != null ? fmtN(o.cases) : '—'}</td><td className="num"><b>{fmtN(made)}</b></td>
              <td className="num">{left == null ? '—' : left > 0 ? <span className={'ost st-' + st}>{trx('faltan {0}', fmtN(left))}</span> : <span className="ost st-done">{tr('✓ completo')}{left < 0 ? ' (+' + fmtN(-left) + ')' : ''}</span>}</td>
              <td className="obar">{o.cases != null && o.cases > 0 && <div className="bar"><i className={'st-' + st} style={{ width: Math.min(100, Math.round((made / o.cases) * 100)) + '%' }} /></div>}<small>{seq.need ? trx('{0} de {1}', seq.done.length, seq.need) : seq.done.length ? (seq.done.length === 1 ? tr('1 pallet') : trx('{0} pallets', seq.done.length)) : ''}</small></td>
              <td className="dest">{o.dest || '—'}</td>
              {mgr && <td><button type="button" className="lnk" onClick={() => setEditing(o.id)}>{tr('Editar')}</button></td>}
            </tr>
          )
        })}</tbody>
        {list.length > 1 && (() => { const t = sums(list); return (
          <tfoot><tr>
            <td colSpan={4}>{trx('Total de {0} pedidos', list.length)}{active.length > 0 && <small className="pname">{tr('de lo que se ve')}</small>}</td>
            <td className="num">{fmtN(t.asked)}{t.unknown && <small title={tr('Sin cantidad')}> +?</small>}</td><td className="num"><b>{fmtN(t.made)}</b></td>
            <td className="num">{t.left > 0 ? <span className="ost st-going">{trx('faltan {0}', fmtN(t.left))}</span> : <span className="ost st-done">{tr('✓ completo')}</span>}</td>
            <td className="obar"><small>{t.need ? trx('{0} de {1}', t.pallets, t.need) : t.pallets ? trx('{0} pallets', t.pallets) : ''}</small></td>
            <td className="dest"></td>{mgr && <td></td>}
          </tr></tfoot>
        ) })()}
      </table>
    </div>
  )
  const order = viewing ? s.orders.find((o) => o.id === viewing) : undefined
  return (
    <div className="orders">
      <div className="tc-head">
        <h3>{tr('Pedidos · PO')}</h3>
        {mgr && <button type="button" className="lnk" onClick={() => setEditing('new')}>{tr('+ Agregar pedido')}</button>}
      </div>
      {open.length > 0 && (
        <>
          <div className="ofilters otop">
            <label className="osearch"><input value={q} onChange={(e) => { setQ(e.target.value); setShown(ORDERS_PAGE) }} placeholder={tr('Buscar PO, cliente o destino')} aria-label={tr('Buscar pedido')} autoComplete="off" />{q && <button type="button" className="lnk sm" aria-label={tr('Quitar la búsqueda')} onClick={() => setQ('')}>✕</button>}</label>
            <select className="ocode" value={codeNow} aria-label={tr('Código')} onChange={(e) => { setFCode(e.target.value); setShown(ORDERS_PAGE) }}>
              <option value="">{tr('Todos los códigos')}</option>
              {codes.map(([k, c]) => <option key={k} value={k}>{c} · {rows.filter((x) => normCode(x.o.code) === k).length}</option>)}
            </select>
          </div>
          <div className="ofilters">
            <button type="button" className={'chip sm' + (!only ? ' on' : '')} aria-pressed={!only} onClick={() => { setOnly(''); setShown(ORDERS_PAGE) }}>{tr('Todos')}<small>{ofCode.length}</small></button>
            {(['todo', 'going', 'left', 'done', 'open'] as const).filter((k) => count(k) > 0 && (k !== 'left' || (count('todo') > 0 && count('going') > 0))).map((k) => <button key={k} type="button" className={'chip sm st-' + (k === 'left' ? 'going' : k) + (only === k ? ' on' : '')} aria-pressed={only === k} onClick={() => { setOnly(k); setShown(ORDERS_PAGE) }}><i className="dotst" />{stateText(k)}<small>{count(k)}</small></button>)}
          </div>
          {active.length > 0 && (
            <div className="rf-now">
              <span>{tr('Viendo')}</span>{active.map((t) => <b key={t} className="tag">{t}</b>)}
              <button type="button" className="btn sm" onClick={clear}>{tr('✕ Quitar filtros')}</button>
            </div>
          )}
        </>
      )}
      {open.length ? (list.length ? table(list.slice(0, shown)) : <p className="hint">{tr('Ningún pedido abierto coincide con esos filtros.')}{closedHits > 0 && <> {trx('{0} de los marcados completos sí.', closedHits)} <button type="button" className="lnk sm" onClick={() => setShowClosed(true)}>{tr('Verlos')}</button></>}</p>) : <p className="hint">{mgr ? tr('No hay pedidos abiertos. Los que se agreguen aquí los ve Packing al registrar cada pallet de ese código.') : tr('No hay pedidos abiertos.')}</p>}
      {list.length > ORDERS_PAGE && (
        <div className="morebar">
          <span>{trx('Se ven {0} de {1}', Math.min(shown, list.length), list.length)}</span>
          {shown < list.length && <button type="button" className="btn" onClick={() => setShown(shown + ORDERS_PAGE)}>{trx('Mostrar {0} más', Math.min(ORDERS_PAGE, list.length - shown))}</button>}
          {shown < list.length && <button type="button" className="lnk" onClick={() => setShown(Number.MAX_SAFE_INTEGER)}>{tr('Mostrar todo')}</button>}
          {shown > ORDERS_PAGE && <button type="button" className="lnk" onClick={() => setShown(ORDERS_PAGE)}>{tr('Mostrar menos')}</button>}
        </div>
      )}
      {open.length > 0 && <p className="hint">{tr('"Hechas" suma todos los pallets que se le dieron a cada pedido, de cualquier día.')} {tr('Toca un PO para ver sus pallets, con sus lotes, tags y cajas.')}</p>}
      {closed.length > 0 && <button type="button" className="lnk" onClick={() => setShowClosed(!showClosed)}>{trx('{0} los marcados completos ({1})', showClosed ? tr('Ocultar') : tr('Ver'), closed.length)}</button>}
      {showClosed && closed.length > 0 && table(closed.filter(hits).map(rowOf))}
      {editing && <OrderDialog key={editing} s={s} order={s.orders.find((o) => o.id === editing)} onClose={() => setEditing(null)} />}
      {order && <OrderPalletsDialog s={s} order={order} onClose={() => setViewing(null)} />}
    </div>
  )
}

/**
 * Everything packed for an order, pallet by pallet: the day, the line, each lot with its cases and its tag, the
 * total, the hour and who. A manager corrects the run from here. The pallets of days this device no longer holds are
 * there too (they come from the server for every open order): seen, but corrected from that day's report.
 */
function OrderPalletsDialog({ s, order, onClose }: { s: State; order: Order; onClose: () => void }) {
  const can = useCan()
  const [editRun, setEditRun] = useState<string | null>(null)
  const list = orderRunsOf(s, order.id).flatMap((r) => r.units.filter((u) => u.po === order.id).map((u) => ({ r, u, parts: unitParts(s, r, u), here: s.runs.some((x) => x.id === r.id) }))).sort((a, b) => a.u.at - b.u.at)
  const made = orderMade(s, order.id), seq = orderPallets(s, order.id), left = order.cases != null ? order.cases - made : null
  const run = editRun ? s.runs.find((r) => r.id === editRun) : undefined
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg wide" onClick={(e) => e.stopPropagation()}>
        <h3>{orderLabel(order)} · <span className="code">{order.code}</span></h3>
        <p className="osum">
          <b>{list.length === 1 ? tr('1 pallet') : trx('{0} pallets', list.length)}</b>{seq.need ? ' ' + tr('de {0}', seq.need) : ''} · <b>{fmtN(made)} {tr('cajas')}</b>
          {left != null && (left > 0 ? <span className="ost st-going"> · {trx('faltan {0}', fmtN(left))}</span> : <span className="ost st-done"> · {tr('✓ completo')}</span>)}
          {order.shipBy && <> · {trx('envío {0}', shipText(order.shipBy))}</>}
        </p>
        {list.length === 0 ? <p className="hint">{tr('Todavía no se le ha dado ningún pallet.')}</p> : (
          <div className="twrap">
            <table className="pallets">
              <thead><tr><th>#</th><th>{tr('Fecha')}</th><th>{tr('Línea')}</th><th>{tr('Lote')}</th><th className="num">{tr('Cajas')}</th><th>{tr('Tag')}</th><th className="num">{tr('Total')}</th><th>{tr('Hora')}</th><th>{tr('Por')}</th><th></th></tr></thead>
              {list.map((x, k) => {
                const parts = x.parts.length ? x.parts : [{ lot: x.r.lot, qty: x.u.qty, tag: x.u.ref }], span = parts.length
                return (
                  <tbody key={x.r.id + ':' + x.u.at}>
                    {parts.map((p, i) => (
                      <tr key={i}>
                        {i === 0 && <td rowSpan={span}><b>{k + 1}</b>{seq.need ? <small className="ofn">/{seq.need}</small> : null}</td>}
                        {i === 0 && <td rowSpan={span}>{shortDay(x.r.date)}</td>}
                        {i === 0 && <td rowSpan={span}>{lineNameOf(s, x.r.lineId, x.r.line)}</td>}
                        <td>{p.lot || '—'}</td><td className="num">{p.qty != null ? fmtN(p.qty) : '—'}</td><td>{p.tag || <span className="notag">{tr('sin tag')}</span>}</td>
                        {i === 0 && <td rowSpan={span} className="num"><b>{fmtN(unitQty(s, x.r, x.u))}</b></td>}
                        {i === 0 && <td rowSpan={span}>{fmtTime(x.u.at)}</td>}
                        {i === 0 && <td rowSpan={span}>{x.u.by || '—'}</td>}
                        {i === 0 && <td rowSpan={span}>{x.here && can('fix') && <button type="button" className="lnk" onClick={() => setEditRun(x.r.id)}>{tr('Corregir')}</button>}</td>}
                      </tr>
                    ))}
                  </tbody>
                )
              })}
            </table>
          </div>
        )}
        {list.some((x) => !x.here) && <p className="hint">{tr('Los pallets de días que este aparato ya no guarda se traen del servidor: se ven aquí y se corrigen abriendo ese día en el Reporte.')}</p>}
        <div className="dbtns"><button type="button" className="btn" onClick={onClose}>{tr('Cerrar')}</button></div>
        {run && <RunEditor s={s} run={run} mgr={can('fix')} onClose={() => setEditRun(null)} />}
      </div>
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
  // The goal is the shift's: its manager sets it for his people, and only what this shift makes counts against it
  const goal = shiftGoalOf(s, dept, t.shift)
  const [editing, setEditing] = useState(false)
  const hasGoal = !!(goal.perHour || goal.total)
  if (!t.runs.length && !t.bins.length && !t.live && !hasGoal && !mgr) return null
  const pct = goal.total ? Math.min(100, Math.floor((t.shiftQty / goal.total) * 100)) : 0
  const pace = goal.perHour && t.shiftRate != null ? t.shiftRate / goal.perHour : null
  const paceCls = pace == null ? '' : pace >= 1 ? 'ok' : 'red'
  const paceText = pace == null ? '' : pace >= 1 ? tr('al ritmo de la meta') : tr('por debajo de la meta')
  const left = goal.total ? goal.total - t.shiftQty : 0
  // (the pace is the shift's own, and nothing is foretold once every code of the shift has ended)
  const eta = left > 0 && t.shiftRate && !t.shiftUntil ? now + (left / t.shiftRate) * 3_600_000 : null
  // The card is the shift in course's, all of it: when a shift takes over it starts from zero, with its own goal.
  // The whole day and what the other shift made are in the report, not here.
  const many = t.shiftCodes.length > 1 || (t.shiftCodes[0]?.lines.length ?? 0) > 1
  const unitWord = (n: number) => (n === 1 ? cfg.unit : cfg.plural).toLowerCase()
  // a room that counts its units themselves says one of them in the singular ("1 mezcla")
  const label = (n: number) => (cfg.qty === 'none' ? unitWord(n) : t.unitLabel)
  const paceArrow = pace == null ? '' : pace >= 1 ? '▲ ' : '▼ '
  /** "Braiser 1, 2, 3" when the lines share their word; "Línea 1, Línea 2" otherwise */
  const linesText = (lines: string[]) => { const m = lines.map((l) => /^(.*?)\s*(\d+)$/.exec(l)); const w = m[0]?.[1]; return lines.length > 1 && w && m.every((x) => x && x[1] === w) ? w + ' ' + m.map((x) => x![2]).join(', ') : lines.join(', ') }
  return (
    <div className="todaycard tc2">
      <div className="tc-head">
        <h3>{trx('Turno {0} · {1}', t.shift, dept)}<small>{t.only ? tr('único de hoy · todas las líneas juntas') : tr('todas las líneas juntas')}</small></h3>
        {mgr && <button type="button" className="lnk" onClick={() => setEditing(true)}>{hasGoal ? tr('✎ Cambiar meta') : tr('+ Poner meta')}</button>}
      </div>
      {/* four tiles: what the shift has made, its goal, its pace, its clock (from zero again with the next shift) */}
      <div className="tc-tiles">
        <div className="tct made">
          <label>{tr('Hecho en el turno')}</label>
          <b>{fmtN(t.shiftQty)} <span>{label(t.shiftQty)}</span></b>
          <small>{cfg.qty !== 'none' ? t.shiftUnits + ' ' + unitWord(t.shiftUnits) : t.shiftCodes.length === 1 ? tr('1 código') : t.shiftCodes.length ? tr('{0} códigos', t.shiftCodes.length) : '\u00a0'}</small>
          {t.shiftBins.length > 0 && <small className="tc-bins">{dept === 'Spiral' ? tr('Además: {0}', t.shiftBins.map((b) => unitsText(dept, b.units, b.qty, cfgFor(dept, b.word))).join(' · ')) : tr('Además, en bins: {0}', t.shiftBins.map((b) => tr('{0} con {1} {2}', b.units === 1 ? tr('1 bin') : tr('{0} bins', b.units), fmtN(b.qty), binWord(b.word))).join(' · '))}</small>}
        </div>
        <div className={'tct goal' + (goal.total ? (pct >= 100 ? ' ok' : '') : ' none')}>
          <label>{tr('Meta del turno')}</label>
          {goal.total ? (
            <>
              <b>{fmtN(t.shiftQty)} <span>/ {fmtN(goal.total)} {t.unitLabel}</span></b>
              <div className="bar"><i className={pct >= 100 ? 'ok' : ''} style={{ width: pct + '%' }} /></div>
              <small>{left > 0 ? <>{trx('faltan {0}', fmtN(left))}{eta && <> · {etaText(eta, now)}</>}</> : <span className="ok">{tr('✓ cumplida')}</span>}</small>
            </>
          ) : <><b>—</b><small>{mgr ? tr('sin meta del turno') : '\u00a0'}</small></>}
        </div>
        <div className={'tct pace ' + paceCls}>
          <label>{tr('Ritmo')}</label>
          <b>{t.shiftRate != null ? fmtN(t.shiftRate) : '—'} <span>{t.unitLabel}/h</span></b>
          <small>{goal.perHour ? <>{trx('meta {0}/h', fmtN(goal.perHour))}{pace != null && <> · <span className={paceCls}>{paceArrow}{paceText}</span></>}</> : t.shiftRate == null ? tr('desde el primer inicio del turno') : tr('sin meta por hora')}</small>
        </div>
        <div className={'tct clock' + (t.shiftUntil ? ' over' : t.paused ? ' paused' : '')}>
          <label>{tr('Reloj del turno')}</label>
          <b>{t.shiftSince > 0 ? fmtDur(t.shiftMs) : '—'}</b>
          <small>{t.shiftSince > 0 ? (t.shiftUntil ? tr('de {0} a {1} · terminó', fmtTime(t.shiftSince), fmtTime(t.shiftUntil)) : t.paused ? tr('desde las {0} · ⏸ en pausa desde la {1}', fmtTime(t.shiftSince), fmtTime(t.paused)) : tr('desde las {0}', fmtTime(t.shiftSince))) : tr('nada empezado todavía')}</small>
        </div>
      </div>
      {t.paused > 0 && <p className="tc-paused">{tr('Ese rato no cuenta. Si siguen trabajando, al registrar lo siguiente cuenta todo; si ya se fueron, toca "Terminar turno".')}</p>}
      {many && <div className="tc-codes">{t.shiftCodes.map((c) => <span key={c.code} className="tc-code"><b>{c.code}</b> {fmtN(c.qty)} {t.unitLabel}{cfg.qty !== 'none' && <> · {c.units} {unitWord(c.units)}</>} · {linesText(c.lines)}</span>)}</div>}
      {editing && <TargetDialog s={s} dept={dept} unit={t.unitLabel} inCourse={t.shift} onClose={() => setEditing(false)} />}
    </div>
  )
}

/** the shift a goal is for: each shift has its own, and a person of one shift does not touch the other's */
function ShiftPick({ value, onPick }: { value: 1 | 2; onPick: (k: 1 | 2) => void }) {
  const who = useWho()
  return (
    <div className="chips shiftpick">
      {([1, 2] as const).map((k) => <button key={k} type="button" className={'chip' + (value === k ? ' on' : '')} aria-pressed={value === k} disabled={!canShift(who, String(k))} onClick={() => onPick(k)}>{tr('Turno {0}', k)}</button>)}
    </div>
  )
}
/** the shift whose goal a person opens: their own; with none of their own (the owner, the office), the one in course */
const goalShift = (who: Who, inCourse: 1 | 2): 1 | 2 => (who.shift === 1 || who.shift === 2 ? who.shift : inCourse)
const goalNum = (t: string) => { const x = Number(t); return x > 0 ? x : null }

/**
 * A manager types the goal of a room for one shift: so many pouches (cajas, mezclas) per hour and/or in the whole
 * shift. Each shift has its own, and only what that shift makes counts against it.
 */
export function TargetDialog({ s, dept, unit, inCourse, onClose }: { s: State; dept: Dept; unit: string; inCourse: 1 | 2; onClose: () => void }) {
  const who = useWho()
  const [shift, setShift] = useState<1 | 2>(() => goalShift(who, inCourse))
  const goal = shiftGoalOf(s, dept, shift)
  const [hour, setHour] = useState(goal.perHour ? String(goal.perHour) : '')
  const [whole, setWhole] = useState(goal.total ? String(goal.total) : '')
  const pick = (k: 1 | 2) => { const g = shiftGoalOf(s, dept, k); setShift(k); setHour(g.perHour ? String(g.perHour) : ''); setWhole(g.total ? String(g.total) : '') }
  // what was set before, when a room had one goal for the whole day: said once, so nobody wonders where it went
  const before = targetOf(s, dept)?.perShift
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{trx('Meta de {0} · Turno {1}', dept, shift)}</h3>
        <ShiftPick value={shift} onPick={pick} />
        <p>{trx('Cada turno tiene su meta: la pone su manager y solo cuenta lo que hace ese turno. La ven todas las tablets de {0} y queda en el historial. Deja en blanco la que no aplique. El ritmo sale en rojo cuando baja de la meta por hora.', dept)}</p>
        {!goal.own && before ? <p className="hint">{trx('La meta que había, {0} {1}, era del día completo, de los dos turnos juntos: ya no se usa. Pon aquí la de este turno.', <b>{fmtN(before)}</b>, unit)}</p> : null}
        <form onSubmit={(e) => { e.preventDefault(); setShiftGoal(dept, shift, goalNum(hour), goalNum(whole)); onClose() }} className="qform">
          <label>{tr('Por hora')}{' '}<input autoFocus={!goal.perHour && !goal.total} inputMode="numeric" placeholder={tr('ej. 400 {0}', unit)} value={hour} onChange={(e) => setHour(e.target.value.replace(/\D/g, ''))} /></label>
          <label>{tr('En todo el turno')}{' '}<input inputMode="numeric" placeholder={tr('ej. 6400 {0}', unit)} value={whole} onChange={(e) => setWhole(e.target.value.replace(/\D/g, ''))} /></label>
          <div className="dbtns spread">
            <div className="btns">{(goal.perHour || goal.total) ? <button type="button" className="lnk" onClick={() => { setShiftGoal(dept, shift, null, null); onClose() }}>{tr('Quitar meta')}</button> : null}</div>
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
 * The room's program for the day: the codes the office set for it and how much of each, with what the room has
 * registered taken off by itself. It is the office's AVANCE sheet seen from one room: SCHEDULE, 1 TURNO, 2 TURNO,
 * PENDING. The program is the day's (both shifts work it down); each shift's part is told apart.
 */
function PlanCard({ s, dept, date, mgr }: { s: State; dept: Dept; date: string; mgr: boolean }) {
  const [editing, setEditing] = useState(false)
  const rows = planRows(s, date, dept)
  const planned = rows.filter((r) => r.planned > 0), extra = rows.filter((r) => !r.planned && r.done > 0)
  if (!planned.length && !mgr) return null
  const cfg = CFG[dept], byCode = dept === 'Spiral' || dept === 'MFO', unit = byCode ? tr('la unidad de cada código') : cfg.qty === 'none' ? cfg.plural.toLowerCase() : cfg.qtyUnit
  return (
    <div className="plan">
      <div className="tc-head">
        <h3>{trx('Programa del día en {0} · en {1}', dept, unit)}</h3>
        {mgr && <button type="button" className="lnk" onClick={() => setEditing(true)}>{planned.length ? tr('✎ Cambiar programa') : tr('+ Poner programa')}</button>}
      </div>
      {planned.length ? (
        <div className="twrap">
          <table>
            <thead><tr><th>{tr('Código')}</th><th className="num">{tr('Programado')}</th><th className="num turn">{tr('Turno 1')}</th><th className="num turn">{tr('Turno 2')}</th><th className="num">{tr('Hecho')}</th><th className="num">{tr('Pendiente')}</th><th className="planbar"></th></tr></thead>
            <tbody>{planned.map((r) => {
              const pct = Math.max(0, Math.min(100, Math.floor((r.done / r.planned) * 100)))
              return (
                <tr key={r.code}>
                  <td><b className="code">{r.code}</b>{r.name && <small className="pname">{r.name}</small>}{r.other.length > 0 && <small className="pname">{tr('también {0}', r.other.map((o) => fmtN(o.n) + ' ' + o.word).join(' · '))}</small>}{r.running && <span className="pill run">● {r.lines.map(lineLabel).join(', ')}</span>}</td>
                  <td className="num">{fmtN(r.planned)}{byCode && <small className="punit"> {r.unit}</small>}</td><td className="num turn">{fmtN(r.byShift[0])}</td><td className="num turn">{fmtN(r.byShift[1])}</td><td className="num"><b>{fmtN(r.done)}</b></td>
                  <td className={'num ' + (r.left <= 0 ? 'ok' : 'left')}>{r.left > 0 ? fmtN(r.left) : tr('✓ completo') + (r.left < 0 ? ' (+' + fmtN(-r.left) + ')' : '')}</td>
                  <td className="planbar"><div className="bar"><i className={pct >= 100 ? 'ok' : 'pend'} style={{ width: pct + '%' }} /></div><small>{pct}%</small></td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      ) : <p className="hint">{trx('{0} no tiene programa para hoy. Pon aquí los códigos que le tocan y cuánto de cada uno: lo que registren se descuenta solo.', dept)}</p>}
      {planned.length > 0 && <p className="hint">{tr('Cada vez que se registra uno de estos códigos, baja solo lo pendiente.')}{extra.length > 0 && ' ' + tr('Fuera del programa: {0}.', extra.map((r) => r.code + ' (' + fmtN(r.done) + ')').join(', '))}</p>}
      {editing && <PlanDialog s={s} dept={dept} today={date} unit={unit} onClose={() => setEditing(false)} />}
    </div>
  )
}

/**
 * The office types a room's program for a day: each code and how much of it, in the room's own quantity. A code left
 * without a quantity is taken off. Nothing is saved until "Guardar".
 */
function PlanDialog({ s, dept, today, unit, onClose }: { s: State; dept: Dept; today: string; unit: string; onClose: () => void }) {
  type Line = { code: string; qty: string; unit: SpiralUnit }
  const blank = (): Line => ({ code: '', qty: '', unit: 'mezclas' })
  const draftOf = (date: string): Line[] => [...planOf(s, date, dept).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })).map((p) => ({ code: productOf(s, p.code)?.code ?? p.code, qty: String(p.qty), unit: productOf(s, p.code)?.spiralUnit ?? 'mezclas' })), blank()]
  const [date, setDate] = useState(today)
  const [lines, setLines] = useState<Line[]>(() => draftOf(today))
  const pickDate = (d: string) => { if (d) { setDate(d); setLines(draftOf(d)) } }
  // (in Spiral a code the products table knows brings how it is counted)
  const change = (i: number, patch: Partial<Line>) => setLines((cur) => { const next = cur.map((l, k) => (k === i ? { ...l, ...patch, ...(patch.code != null && productOf(s, patch.code)?.spiralUnit ? { unit: productOf(s, patch.code)!.spiralUnit! } : {}) } : l)); return next[next.length - 1].code.trim() ? [...next, blank()] : next })
  const twice = lines.map((l) => normCode(l.code)).filter((k, i, all) => k && all.indexOf(k) !== i)
  const save = () => {
    const typed = new Map(lines.filter((l) => normCode(l.code)).map((l) => [normCode(l.code), l]))
    // a code that was on the program and is not typed any more is taken off; the rest are set to what was typed
    for (const p of planOf(s, date, dept)) if (!typed.has(normCode(p.code))) setPlan(date, dept, p.code, 0)
    for (const l of typed.values()) { setPlan(date, dept, l.code, numOf(l.qty)); if (dept === 'Spiral') setSpiralUnit(l.code, l.unit) }
    onClose()
  }
  const listId = 'plan-codes-' + dept
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{trx('Programa de {0}', dept)}</h3>
        <p>{trx('Los códigos que {0} tiene que hacer ese día y cuánto de cada uno, en {1}. Lo ven todas sus tablets, y cada vez que registran uno de esos códigos se descuenta solo. Para quitar un código, deja su cantidad en blanco.', dept, unit)}</p>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); if (!twice.length) save() }}>
          <label>{tr('Día')}{' '}<input type="date" value={date} onChange={(e) => pickDate(e.target.value)} /></label>
          <div className="planrows">
            <div className={'planrow head' + (dept === 'Spiral' ? ' spiral' : '')}><span>{tr('Código')}</span><span>{dept === 'Spiral' || dept === 'MFO' ? tr('Cantidad') : trx('Cantidad ({0})', unit)}</span>{dept === 'Spiral' && <span>{tr('Unidad')}</span>}</div>
            {lines.map((l, i) => (
              <div key={i} className={'planrow' + (dept === 'Spiral' ? ' spiral' : '')}>
                <input list={listId} value={l.code} placeholder={tr('ej. 0100')} autoComplete="off" aria-label={tr('Código')} onChange={(e) => change(i, { code: e.target.value })} />
                <input value={l.qty} inputMode="decimal" placeholder="0" autoComplete="off" aria-label={tr('Cantidad ({0})', unit)} onChange={(e) => change(i, { qty: e.target.value.replace(/[^\d.,]/g, '') })} />
                {dept === 'Spiral' && <select value={l.unit} aria-label={tr('Unidad')} onChange={(e) => change(i, { unit: e.target.value as SpiralUnit })}>{SPIRAL_UNITS.map((u) => <option key={u} value={u}>{measureUnit(u)}</option>)}</select>}
              </div>
            ))}
            <datalist id={listId}>{s.products.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</datalist>
          </div>
          {twice.length > 0 && <p className="hint red">{trx('El código {0} está dos veces: déjalo en un solo renglón.', twice[0])}</p>}
          <div className="dbtns">
            <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
            <button type="submit" className="btn primary" disabled={twice.length > 0}>{tr('✓ Guardar')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DeptPanel({ s, dept, now, day }: { s: State; dept: Dept; now: number; mgr: boolean; day: WorkDay }) {
  const lines = s.lines.filter((l) => l.dept === dept).sort(byLineName)
  const ds = deptStop(s, dept)
  const can = useCan(), who = useWho(), viewOnly = who.role === 'viewer'
  const [stopAll, setStopAll] = useState(false)
  const [adding, setAdding] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [editRun, setEditRun] = useState<string | null>(null)
  const [addingRun, setAddingRun] = useState(false) // a code that ran and nobody recorded, put on its line after the fact
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
        {!viewOnly && <div className="acts">
          {ds
            ? <button type="button" className="btn danger" onClick={() => endStop(ds.id)}>{trx('▶ Reanudar departamento · {0}', fmtDur(now - ds.startedAt))}</button>
            : <button type="button" className="btn stopbtn" disabled={!anyRunning} onClick={() => setStopAll(true)}>{tr('⏸ Parar departamento')}</button>}
          <button type="button" className="btn" disabled={!left.runs.length && !left.setups.length && !left.stops.length} onClick={() => setLeaving(true)}>{tr('🏁 Terminar turno')}</button>
          <button type="button" className="btn soft" onClick={() => setAdding(true)}>{trx('+ Agregar {0}', CFG[dept].lineWord.toLowerCase())}</button>
        </div>}
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
      <div className="lines">{lines.map((l) => <LineCard key={l.id} s={s} line={l} now={now} mgr={can('fix')} day={day} />)}</div>
      {lines.length === 0 && <p className="hint">{viewOnly ? tr('Este departamento no tiene líneas todavía.') : trx('Este departamento no tiene líneas. Toca "Agregar {0}".', CFG[dept].lineWord.toLowerCase())}</p>}
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
      {can('fix') && !viewOnly && <p className="addlater"><button type="button" className="lnk sm" onClick={() => setAddingRun(true)}>{tr('+ Agregar un registro que nadie registró')}</button></p>}
      {/* what the office sets for the room, under what the room is doing: the day's program and the orders being filled */}
      <PlanCard s={s} dept={dept} date={day.date} mgr={can('products')} />
      {CFG[dept].orders && <OrdersCard s={s} mgr={can('orders')} />}
      {editing && <RunEditor s={s} run={editing} mgr={can('fix')} onClose={() => setEditRun(null)} />}
      {addingRun && <AddRunDialog s={s} date={day.date} dept={dept} onClose={() => setAddingRun(false)} onAdded={() => setAddingRun(false)} />}
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
/**
 * The pallet being built on a Packing line, always in sight, as a table: each lot already on it with its cases and
 * its tag, the lot going on now, and the total. Two things to do, side by side and in plain words: the lot ran out
 * and the pallet goes on with another one (➕), or the pallet is finished (✓). When ✓ was tapped by mistake at a
 * change of lot, the last pallet is opened again from here.
 */
function PalletPanel({ s, run, saved, readOnly, canReopen, onDone, onLot, onLotNow, onPart, onOrder, onReopen }: { s: State; run: Run; saved: string; readOnly?: boolean; canReopen: boolean; onDone: () => void; onLot: () => void; onLotNow: () => void; onPart: (i: number) => void; onOrder: () => void; onReopen: () => void }) {
  const open = run.extra?.open, parts = open?.parts ?? []
  const onIt = parts.reduce((t, p) => t + p.qty, 0), per = run.perUnit ?? 0, lotNow = lotNowOf(run)
  const order = orderOfId(s, palletPo(s, run)), seq = order ? orderPallets(s, order.id, run.perUnit) : null
  const offered = openOrdersFor(s, run.code).length > 0, said = typeof open?.po === 'string'
  return (
    <div className="pallet">
      <div className="pal-head">
        <b>{trx('Pallet {0}', run.units.length + 1)} <span className="pal-state">{tr('en armado')}</span></b>
        {per > 0 && <span>{trx('{0} de {1} cajas', fmtN(onIt), fmtN(per))}</span>}
      </div>
      {per > 0 && <div className="bar"><i style={{ width: Math.min(100, Math.round((onIt / per) * 100)) + '%' }} /></div>}
      {(order || offered) && (
        <div className="pal-po">
          <span>{order ? trx('Va para {0}{1}', <b>{orderLabel(order)}</b>, seq?.need ? <> · <b className="pof">{tr('pallet {0} de {1}', seq.done.length + 1, seq.need)}</b></> : '') : said ? tr('Este pallet va sin PO') : tr('Todavía sin PO')}</span>
          {!readOnly && <button type="button" className="lnk sm" onClick={onOrder}>{order ? tr('Cambiar') : tr('Escoger PO')}</button>}
        </div>
      )}
      <table className="pal-lots">
        <thead><tr><th>{tr('Lote')}</th><th className="num">{tr('Cajas')}</th><th>{tr('Tag')}</th><th></th></tr></thead>
        <tbody>
          {parts.map((p, i) => (
            <tr key={i}>
              <td><b>{p.lot}</b></td><td className="num">{fmtN(p.qty)}</td>
              <td>{p.tag ? <b className="tagno">{p.tag}</b> : <span className="notag">{tr('sin tag')}</span>}</td>
              <td>{!readOnly && <button type="button" className={'lnk sm' + (p.tag ? '' : ' notag')} title={tr('Cambiar las cajas o el tag de este lote')} onClick={() => onPart(i)}>{p.tag ? '✎' : tr('ponerlo')}</button>}</td>
            </tr>
          ))}
          <tr className="now">
            <td><b>{lotNow}</b> <small>{tr('va ahora')}</small></td><td className="num"><small>…</small></td><td></td>
            <td>{!readOnly && <button type="button" className="lnk sm" title={tr('El lote que va ahora se escribió mal')} onClick={onLotNow}>{tr('Cambiar')}</button>}</td>
          </tr>
        </tbody>
        {parts.length > 0 && <tfoot><tr><td>{tr('Total')}</td><td className="num">{fmtN(onIt)}</td><td colSpan={2}>{tr('{0} lotes', parts.length + 1)}</td></tr></tfoot>}
      </table>
      {!readOnly && (
        <div className="pal-acts">
          <button type="button" className="btn soft" onClick={onLot}>➕ {tr('Otro lote en este pallet')}<small>{trx('se acabó el {0} y siguen con otro', lotNow)}</small></button>
          <button type="button" className={'btn primary' + (saved ? ' saved' : '')} disabled={!!saved} onClick={onDone}>✓ {saved || tr('Pallet completo')}{!saved && <small>{tr('ya no le ponen más cajas')}</small>}</button>
        </div>
      )}
      {!readOnly && canReopen && <button type="button" className="lnk sm pal-reopen" onClick={onReopen}>{trx('↩ ¿"Pallet completo" por error? Seguir en el pallet {0}', run.units.length)}</button>}
    </div>
  )
}

/**
 * The POs open for a pallet's code, each with the place the pallet would have among its pallets: "Cliente Uno · PO
 * 1001 · pallet 4 de 5". A PO counts only the pallets given to it: one that goes to another PO, or to none, is not added.
 */
function poChoices(s: State, run: Run) {
  return openOrdersFor(s, run.code).map((o) => {
    const seq = orderPallets(s, o.id, run.perUnit), n = seq.done.length + 1, left = o.cases != null ? o.cases - orderMade(s, o.id) : null
    return { id: o.id, n, need: seq.need, label: orderLabel(o) + ' · ' + (left != null && left <= 0 ? tr('completo') : seq.need ? tr('pallet {0} de {1}', n, seq.need) : tr('pallet {0}', n)) }
  })
}

/**
 * The pallet is finished: every lot on it with its cases and its tag (the ones written when a lot ran out can be fixed
 * here, and a missing tag added), the cases of the lot going on now, and its PO. Nothing is put for them: a pallet can
 * end short (no more product, or the order is done), so those cases are typed, or filled up to a full pallet with one tap.
 */
function PalletDoneDialog({ s, run, onClose, onSaved }: { s: State; run: Run; onClose: () => void; onSaved: () => void }) {
  const open = run.extra?.open, parts = open?.parts ?? []
  const per = run.perUnit ?? 0, onIt = parts.reduce((t, p) => t + p.qty, 0)
  const [rows, setRows] = useState(() => [...parts.map((p) => ({ lot: p.lot, qty: String(p.qty), tag: p.tag })), { lot: lotNowOf(run), qty: '', tag: '' }])
  const [added, setAdded] = useState(false) // a lot they forgot to say when it ran out: typed here
  // only an open PO can take the pallet: the one it was going to, unless the office closed it meanwhile
  const choices = poChoices(s, run)
  const [po, setPo] = useState(() => { const p = palletPo(s, run); return choices.some((x) => x.id === p) ? p : '' })
  const pick = choices.find((x) => x.id === po)
  const change = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const nums = rows.map((r) => Number(r.qty || 0))
  const total = nums.reduce((t, n) => t + (Number.isFinite(n) && n > 0 ? n : 0), 0)
  // the last lot may have nothing (the pallet was full when a lot ran out); every other one has its cases
  // a lot typed here without cases is left out when saving (the pallet was full when a lot ran out)
  const ok = total > 0 && rows.every((r, i) => !!r.lot.trim() && Number.isFinite(nums[i]) && (nums[i] > 0 || i >= parts.length))
  const missing = rows.filter((r, i) => nums[i] > 0 && !r.tag.trim()).length
  const lastRow = rows[rows.length - 1], fill = per > onIt && !lastRow.qty && lastRow.lot.trim() ? per - onIt : 0
  const save = () => { if (ok && palletDone(run.id, rows.map((r, i) => ({ lot: r.lot, qty: nums[i], tag: r.tag })), po)) onSaved() }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{trx('Pallet listo · {0}', run.code)}</h3>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); save() }}>
          <div className="palrows">
            <div className="palrow head"><span>{tr('Lote')}</span><span>{tr('Cajas')}</span><span>{tr('Tag')}</span></div>
            {rows.map((r, i) => (
              <div key={i} className="palrow">
                {i < parts.length ? <b>{r.lot}</b> : <input value={r.lot} inputMode="numeric" aria-label={tr('Lote')} autoFocus={added && i === rows.length - 1} onChange={(e) => change(i, { lot: e.target.value })} autoComplete="off" />}
                <input value={r.qty} inputMode="numeric" placeholder="0" aria-label={tr('Cajas')} autoFocus={!added && i === rows.length - 1 && !r.qty} onChange={(e) => change(i, { qty: e.target.value.replace(/\D/g, '') })} />
                <input value={r.tag} inputMode="numeric" placeholder={tr('ej. 1749')} aria-label={tr('Tag')} onChange={(e) => change(i, { tag: e.target.value })} autoComplete="off" />
                {i > parts.length ? <button type="button" className="lnk" title={tr('Quitar este lote')} onClick={() => setRows(rows.filter((_, k) => k !== i))}>✕</button> : <span />}
              </div>
            ))}
          </div>
          <button type="button" className="lnk addlot" onClick={() => { setAdded(true); setRows([...rows, { lot: '', qty: '', tag: '' }]) }}>{tr('+ Este pallet lleva otro lote más')}</button>
          <p className="lottotal">{total > 0 ? trx('Total del pallet: {0} en {1}', <b>{fmtN(total)} {tr('cajas')}</b>, rows.filter((_, i) => nums[i] > 0).length === 1 ? tr('1 lote') : tr('{0} lotes', rows.filter((_, i) => nums[i] > 0).length)) : tr('Escriban cuántas cajas lleva.')}{per > 0 && total !== per && <span className="muted"> {' '}{tr('· un pallet lleno lleva {0}', fmtN(per))}</span>}</p>
          {fill > 0 && <button type="button" className="chip sm fillchip" onClick={() => change(rows.length - 1, { qty: String(fill) })}>{tr('Llenar el pallet: {0} cajas del lote {1}', fmtN(fill), lastRow.lot.trim())}</button>}
          {choices.length > 0 && (
            <div className="pochoice" role="group" aria-label={tr('¿Para qué PO es este pallet?')}>
              <span className="lab">{tr('¿Para qué PO es este pallet?')}</span>
              {choices.map((o) => <button key={o.id} type="button" className={'btn' + (po === o.id ? ' on' : '')} aria-pressed={po === o.id} onClick={() => setPo(o.id)}>{po === o.id ? '✓ ' : ''}{o.label}</button>)}
              <button type="button" className={'btn' + (!po ? ' on' : '')} aria-pressed={!po} onClick={() => setPo('')}>{!po ? '✓ ' : ''}{tr('Sin PO')}</button>
            </div>
          )}
          {missing > 0 && <p className="hint">{tr('Si todavía no tienen el tag, déjenlo en blanco: la tarjeta de la línea les recuerda ponerlo.')}</p>}
          <div className="dbtns">
            <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
            <button type="submit" className="btn primary" disabled={!ok}>{pick?.need ? tr('✓ Guardar pallet {0} de {1}', pick.n, pick.need) : tr('✓ Guardar pallet')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * a lot ran out on the pallet being built: its cases (and its tag, if they have it) stay on it, and the next lot goes
 * on. Only what it needs is asked: the PO is on the panel, and at "Pallet listo".
 */
function LotEndDialog({ run, onClose }: { run: Run; onClose: () => void }) {
  const lot = lotNowOf(run)
  const [qty, setQty] = useState('')
  const [tag, setTag] = useState('')
  const [next, setNext] = useState('') // typed by them: the app does not guess the next lot
  const ok = Number(qty) > 0 && !!next.trim() && next.trim() !== lot
  const save = () => { if (ok && palletLotEnds(run.id, Number(qty), tag, next)) onClose() }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{trx('Se acabó el lote {0} en este pallet', lot)}</h3>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); save() }}>
          <label>{tr('Cajas de ese lote en este pallet')}{' '}<input autoFocus value={qty} inputMode="numeric" placeholder="0" onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} /></label>
          <label>{trx('Tag de ese lote {0}', <small>{tr('(si ya lo tienen; si no, después)')}</small>)} <input value={tag} inputMode="numeric" placeholder={tr('ej. 1749')} onChange={(e) => setTag(e.target.value)} autoComplete="off" /></label>
          <label>{tr('Lote que sigue en el mismo pallet')}{' '}<input value={next} inputMode="numeric" onChange={(e) => setNext(e.target.value)} autoComplete="off" /></label>
          {looksLikeTwoLots(next) && <span className="err">{tr('Parece que son dos lotes escritos juntos: pon solo el que sigue ahora.')}</span>}
          <p className="hint">{tr('El pallet sigue abierto con el lote que sigue. Cuando esté completo, toquen "Pallet listo".')}</p>
          <div className="dbtns">
            <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
            <button type="submit" className="btn primary" disabled={!ok}>{tr('✓ Guardar')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * "Pallet completo" was tapped when a lot ran out, and the cases went on with the same pallet: the last pallet opens
 * again, with its lots, cases, tags and PO, and goes on with the lot they say (the same one, or the next).
 */
function ReopenPalletDialog({ run, onClose }: { run: Run; onClose: () => void }) {
  const last = run.units[run.units.length - 1], n = run.units.length, lot = lotNowOf(run)
  const [other, setOther] = useState(false)
  const [next, setNext] = useState('')
  if (!last) return null
  const ok = !other || (!!next.trim() && next.trim() !== lot)
  const save = () => { if (ok && reopenPallet(run.id, other ? next : '')) onClose() }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{trx('¿Seguir en el pallet {0}?', n)}</h3>
        <p>{trx('Se vuelve a abrir con lo que ya tiene: {0}. Es para cuando tocaron "Pallet completo" por error y las cajas siguen en ese mismo pallet.', <b>{last.qty != null ? fmtN(last.qty) + ' ' + tr('cajas') : ''}{last.lots?.length ? ' · ' + lotsText(last.lots) : ''}</b>)}</p>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); save() }}>
          <span className="lab">{tr('¿Qué lote va ahora en ese pallet?')}</span>
          <div className="chips">
            <button type="button" className={'chip' + (!other ? ' on' : '')} aria-pressed={!other} onClick={() => setOther(false)}>{trx('El mismo: {0}', lot)}</button>
            <button type="button" className={'chip' + (other ? ' on' : '')} aria-pressed={other} onClick={() => setOther(true)}>{tr('Otro lote')}</button>
          </div>
          {other && <label>{tr('Lote que va ahora')}{' '}<input autoFocus value={next} inputMode="numeric" onChange={(e) => setNext(e.target.value)} autoComplete="off" /></label>}
          <div className="dbtns">
            <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
            <button type="submit" className="btn primary" disabled={!ok}>{trx('↩ Seguir en el pallet {0}', n)}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** a lot already on the pallet being built: its cases or its tag corrected (the tag often comes later) */
function PartDialog({ run, index, onClose }: { run: Run; index: number; onClose: () => void }) {
  const p = run.extra?.open?.parts[index]
  const [qty, setQty] = useState(String(p?.qty ?? ''))
  const [tag, setTag] = useState(p?.tag ?? '')
  if (!p) return null
  const ok = Number(qty) > 0
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{trx('Lote {0} en este pallet', p.lot)}</h3>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); if (ok && palletPartFix(run.id, index, { qty: Number(qty), tag })) onClose() }}>
          <label>{tr('Cajas')}{' '}<input value={qty} inputMode="numeric" onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} /></label>
          <label>{tr('Tag')}{' '}<input autoFocus={!p.tag} value={tag} inputMode="numeric" placeholder={tr('ej. 1749')} onChange={(e) => setTag(e.target.value)} autoComplete="off" /></label>
          <div className="dbtns">
            <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
            <button type="submit" className="btn primary" disabled={!ok}>{tr('✓ Guardar')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** the PO the pallet being built goes to: every pallet of an order carries it */
function PalletOrderDialog({ s, run, onClose }: { s: State; run: Run; onClose: () => void }) {
  const now = palletPo(s, run)
  const choices = poChoices(s, run)
  const pick = (id: string) => { palletOrder(run.id, id); onClose() }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{tr('¿Para qué PO es este pallet?')}</h3>
        <div className="endchoices">
          {choices.map((o) => <button key={o.id} type="button" className={'btn' + (o.id === now ? ' primary' : '')} onClick={() => pick(o.id)}>{o.id === now ? '✓ ' : ''}{o.label}</button>)}
          <button type="button" className={'btn' + (!now ? ' primary' : '')} onClick={() => pick('')}>{!now ? '✓ ' : ''}{tr('Sin PO')}</button>
        </div>
        <p className="hint">{tr('Cada PO cuenta solo los pallets que se le dan. Un pallet que va para otro PO, o sin PO, no se le suma.')}</p>
        <div className="dbtns"><button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button></div>
      </div>
    </div>
  )
}

/** the lot a Packing line packs now changed, or was written wrong: what is made from now on carries the one they type */
function LotNowDialog({ run, onClose }: { run: Run; onClose: () => void }) {
  const lot = lotNowOf(run)
  const [next, setNext] = useState('')
  const ok = !!next.trim() && next.trim() !== lot
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{tr('Cambió el lote (iba el {0})', lot)}</h3>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); if (ok && setLotNow(run.id, next)) onClose() }}>
          <label>{tr('Lote que va ahora')}{' '}<input autoFocus value={next} inputMode="numeric" onChange={(e) => setNext(e.target.value)} autoComplete="off" /></label>
          {looksLikeTwoLots(next) && <span className="err">{tr('Parece que son dos lotes escritos juntos: pon solo el que va ahora.')}</span>}
          <div className="dbtns">
            <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
            <button type="submit" className="btn primary" disabled={!ok}>{tr('✓ Guardar')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function LineCard({ s, line, now, mgr, day }: { s: State; line: Line; now: number; mgr: boolean; day: WorkDay }) {
  const cfg = CFG[line.dept]
  const canGoal = useCan()('goals'), viewOnly = useViewOnly()
  // a device that has not brought the server's rows for a while may show this line with an old code or lot (another
  // tablet changed it): the card says so and asks once before anything is recorded on it
  const sync = useSyncExternalStore(syncStore.subscribe, syncStore.get)
  const [unlockedUntil, setUnlockedUntil] = useState(0)
  const locked = !!supabase && !viewOnly && now - sync.lastSync > STALE_MS && now > unlockedUntil
  const quiet = viewOnly || locked
  const staleBar = locked && (
    <div className="stalebar">
      <span>{sync.lastSync ? trx('⚠ Sin servidor desde las {0}. Si en otra tablet ya cambió el código o el lote de esta línea, aquí se vería lo viejo.', fmtTime(sync.lastSync)) : tr('⚠ Este aparato no ha bajado nada del servidor todavía.')}</span>
      <button type="button" className="btn sm" onClick={() => setUnlockedUntil(now + 10 * 60_000)}>{tr('Entiendo, registrar igual')}</button>
    </div>
  )
  const run = openRun(s, line.id)
  const stop = run ? openStop(s, line.dept, line.id) : undefined
  // two codes open on the line at once (two devices that could not see each other both started one): the card goes by
  // the newest, says so, and a manager ends the others with one tap (what each one made stays)
  const twice = openRuns(s, line.id)
  const [closingOld, setClosingOld] = useState(false)
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
  // Packing: what the line is going to make (pallets, or bins and what they hold), and the windows of the pallet being built
  const [making, setMaking] = useState<'pallet' | 'bin' | null>(null)
  const [binText, setBinText] = useState('')
  const [packing, setPacking] = useState<null | 'done' | 'lot' | 'po' | 'binlot' | 'reopen' | number>(null)
  // Spiral: how the code about to start is counted (null = as the products table says, or as it was started last)
  const [measure, setMeasure] = useState<SpiralUnit | null>(null)
  const [tagging, setTagging] = useState<number | null>(null)
  const nameIt = !quiet && <button type="button" className="lnk pen" title={tr('Cambiar el nombre')} aria-label={tr('Cambiar el nombre de {0}', lineLabel(line.name))} onClick={() => setRenaming(true)}>✎</button>
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
  // (on a Packing line making pallets, the pallet being built is where cases go: the short pallet of before is offered
  // only while nothing is on it yet, when the code came back and they go on with that same pallet)
  const own = run && cfg.qty === 'ask' && !binOf(run) && !(run.dept === 'Packing' && (run.units.length > 0 || !!run.extra?.open?.parts.length)) ? shortUnit(s, run) : null
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
  // The line's own goal, set by the manager of each shift (the room's goal is of all its lines together): what the
  // line has made in the shift in course against it, and its pace, red as soon as it falls under the goal per hour.
  const goal = lineShiftGoalOf(s, line.id, turn.shift), hasGoal = !!(goal.perHour || goal.total)
  const mine = hasGoal ? deptToday(s, line.dept, day.date, now, line.id) : null
  const goalPct = mine && goal.total ? Math.min(100, Math.floor((mine.shiftQty / goal.total) * 100)) : 0
  // drawn like the room's goal: what is left of it, when the line gets there at its own pace, and how that pace stands
  const goalLeft = mine && goal.total ? goal.total - mine.shiftQty : 0
  const goalEta = mine && goalLeft > 0 && mine.shiftRate && !mine.shiftUntil ? now + (goalLeft / mine.shiftRate) * 3_600_000 : null
  const linePace = mine && goal.perHour && mine.shiftRate != null ? mine.shiftRate / goal.perHour : null
  const linePaceCls = linePace == null ? '' : linePace >= 1 ? 'ok' : 'red'
  const goalUnit = cfg.qty === 'none' ? cfg.plural.toLowerCase() : cfg.qtyUnit
  const goalBtn = canGoal && <button type="button" className="lnk sm" onClick={() => setGoalOpen(true)}>{hasGoal ? tr('✎ Meta') : tr('+ Meta')}</button>
  const goalStrip = (
    <>
      {mine && hasGoal && (
        <div className="linegoal">
          {goal.total ? (
            <div className="lg-goal">
              <div className="lg-row"><span>{trx('Meta del turno {0} / {1}', <b>{fmtN(mine.shiftQty)}</b>, <b>{fmtN(goal.total)}</b>)} {goalUnit}</span><b className={goalPct >= 100 ? 'ok' : ''}>{goalPct}%</b></div>
              <div className="bar"><i className={goalPct >= 100 ? 'ok' : ''} style={{ width: goalPct + '%' }} /></div>
              <div className="lg-sub">{goalLeft > 0 ? <>{trx('Faltan {0}', <b>{fmtN(goalLeft)}</b>)}{goalEta && <> {' '}{etaText(goalEta, now)}</>}</> : <b className="ok">{tr('✓ Meta del turno cumplida')}</b>}</div>
            </div>
          ) : null}
          {goal.perHour ? <div className="lg-pace">{trx('Ritmo {0} {1}/h · meta {2}', <b className={linePaceCls}>{mine.shiftRate != null ? fmtN(mine.shiftRate) : '—'}</b>, goalUnit, <b>{fmtN(goal.perHour)}</b>)}{linePace != null && <> · <span className={linePaceCls}>{linePace >= 1 ? tr('al ritmo de la meta') : tr('por debajo de la meta')}</span></>}</div> : null}
        </div>
      )}
      {goalOpen && <LineTargetDialog s={s} line={line} unit={goalUnit} inCourse={turn.shift} onClose={() => setGoalOpen(false)} />}
    </>
  )
  if (!run) {
    // the lot follows the date unless someone typed another one; the quantity per unit (boxes per pallet, pouches
    // per cart) comes from the products table or the last run of the code. RTE types it the office's way: crates
    // per cart × pouches per crate ("12x10")
    // a Packing line makes pallets (cases with their tags) or fills bins (platos, copas, pouches...): as it did last, unless they say
    const isPack = line.dept === 'Packing', isMfo = line.dept === 'MFO'
    const lastRun = isPack || isMfo ? s.runs.filter((r) => r.lineId === line.id).sort((a, b) => b.startedAt - a.startedAt)[0] : undefined
    const makes = making ?? (lastRun && binOf(lastRun) ? 'bin' : 'pallet')
    const word = binText.trim() || (lastRun ? binOf(lastRun) : '') || BIN_WORDS[0]
    const needPer = !!cfg.perUnitLabel && !(isPack && makes === 'bin')
    const isCart = line.dept === 'RTE'
    const prod = productOf(s, code)
    // MFO: its bins hold platos or copas (so many to a case) or are weighed in pounds: as tapped; else as this code was
    // counted last (on this device); else as this line did last; else platos
    const mfoLast = isMfo && code.trim() ? s.runs.filter((r) => r.dept === 'MFO' && normCode(r.code) === normCode(code) && !!binOf(r)).sort((a, b) => b.startedAt - a.startedAt)[0] : undefined
    const mfoWord = !isMfo ? '' : (MFO_WORDS.includes(binText) ? binText : '') || (mfoLast ? binOf(mfoLast) : '') || (lastRun ? binOf(lastRun) : '') || MFO_WORDS[0]
    const suggested = needPer ? lastPerUnit(s, line.dept, code) : null
    // Spiral: mezcla by mezcla, or each mezcla weighed in pounds or counted in cases: the products table's word for the
    // code, else the way it was started last on this device, else mezcla by mezcla
    const isSpiral = line.dept === 'Spiral'
    const spiralLast = isSpiral && code.trim() ? s.runs.filter((r) => r.dept === 'Spiral' && normCode(r.code) === normCode(code)).sort((a, b) => b.startedAt - a.startedAt)[0] : undefined
    const spiralNow: SpiralUnit = measure ?? prod?.spiralUnit ?? (spiralLast ? measureOf(spiralLast) || 'mezclas' : 'mezclas')
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
    // the codes of the room's program that are still pending: one tap writes the code, so nobody types it wrong
    const todo = planRows(s, day.date, line.dept).filter((r) => r.planned > 0 && r.left > 0)
    return (
      <div className="line idle">
        <div className="lhead">
          <h3>{lineLabel(line.name)} {nameIt}</h3>
          <span className={'pill ' + (idle ? 'setup' : 'free')}>{idle ? '⏱ ' + tr(idle.reason) + ' · ' + fmtDur(stopTime(s, idle, now)) : tr('Libre')}</span>
          <span className="lacts">{goalBtn}</span>
        </div>
        {goalStrip}
      {staleBar}
        {idle && (
          <div className="setupbar">
            <small>{trx('Esperando el código siguiente desde las {0}. Si no viene otro, no cuenta.', fmtTime(idle.startedAt))}</small>
            {!quiet && <><span className="btns two">
              <button type="button" className="btn sm" onClick={() => endStop(idle.id)}>{trx('■ Terminar {0}', tr(idle.reason))}</button>
              <button type="button" className="btn sm" onClick={() => dropSetup(idle.id)}>{tr('No viene otro código: quitarlo')}</button>
            </span>
            <button type="button" className="lnk sm" onClick={() => setFixingStop(true)}>{mgr ? tr('Corregir o dividir') : tr('Corregir')}</button></>}
          </div>
        )}
        {prev && (
          <div className="lastcode">
            <span>{(prev.endedAt ?? 0) > turn.since
              ? trx('Último: {0} · lote {1} · terminó {2} · {3}', <b className="code">{prev.code}</b>, prev.lot, fmtTime(prev.endedAt ?? 0), madeText(prev, runQty(s, prev)))
              : trx('Último, del turno anterior: {0} · lote {1} · terminó {2} · {3}', <b className="code">{prev.code}</b>, prev.lot, fmtTime(prev.endedAt ?? 0), madeText(prev, runQty(s, prev)))}</span>
            {!quiet && <span className="btns">
              <button type="button" className="lnk sm" onClick={() => setReopening(prev.id)}>{trx('↩ No había terminado: seguir con {0}', prev.code)}</button>
              {fillLink}
              <button type="button" className="lnk sm" onClick={() => setFixingId(prev.id)}>{tr('Corregir')}</button>
            </span>}
          </div>
        )}
        {prev && reopening === prev.id && <ConfirmDialog title={tr('¿Seguir con {0} en {1}', prev.code, line.name) + '?'}
          text={tr('Se marcó terminado a las {0}. Vuelve a correr como si no se hubiera terminado: el tiempo desde entonces cuenta como trabajando y el Set up que empezó se quita. Si la línea estuvo parada y el código vuelve ahora, es mejor empezarlo de nuevo abajo.', fmtTime(prev.endedAt ?? 0))}
          yes={tr('Seguir con {0}', prev.code)} onYes={() => { reopenRun(prev.id); setReopening(null) }} onNo={() => setReopening(null)} />}
        {fillUi}
        {fixingStop && idle && <StopEditor stop={idle} mgr={mgr} onClose={() => setFixingStop(false)} />}
        {naming}
        {removing && <ConfirmDialog title={tr('¿Quitar {0} de {1}', lineLabel(line.name), line.dept) + '?'} text={tr('Se puede volver a agregar cuando haga falta.')} yes={tr('Quitar')} danger onYes={() => removeLine(line.id)} onNo={() => setRemoving(false)} />}
        {!quiet && <form className="start" onSubmit={(e) => { e.preventDefault(); if (ok) { startRun(line, code.trim().toUpperCase(), lot.trim(), date, needPer ? perUnit : null, isPack && makes === 'bin' ? word : mfoWord, isSpiral && spiralNow !== 'mezclas' ? spiralNow : ''); setDateText(null); setLotText(null); setEditDate(false); setMaking(null); setBinText(''); setMeasure(null) } }}>
          {isSpiral && (
            <div className="makes">
              <span className="lab">{tr('¿En qué se cuenta este código?')}</span>
              <div className="seg" role="group" aria-label={tr('¿En qué se cuenta este código?')}>
                {SPIRAL_UNITS.map((u) => <button key={u} type="button" className={kindClass('Spiral', u === 'mezclas' ? '' : u) + (spiralNow === u ? ' on' : '')} aria-pressed={spiralNow === u} onClick={() => setMeasure(u)}>{u === 'mezclas' ? tr('Mezclas') : u === 'lb' ? tr('Libras') : tr('Cajas')}<small>{u === 'mezclas' ? tr('una por una') : u === 'lb' ? tr('cada mezcla dice sus libras') : tr('cada mezcla dice sus cajas')}</small></button>)}
              </div>
            </div>
          )}
          {isPack && (
            <div className="makes">
              <span className="lab">{tr('¿Qué van a hacer?')}</span>
              <div className="seg" role="group" aria-label={tr('¿Qué van a hacer?')}>
                <button type="button" className={'c-green' + (makes === 'pallet' ? ' on' : '')} aria-pressed={makes === 'pallet'} onClick={() => setMaking('pallet')}>{tr('Pallets')}<small>{tr('cajas con su tag')}</small></button>
                <button type="button" className={'c-indigo' + (makes === 'bin' ? ' on' : '')} aria-pressed={makes === 'bin'} onClick={() => setMaking('bin')}>{tr('Bins')}<small>{tr('platos, copas, pouches…')}</small></button>
              </div>
              {makes === 'bin' && (
                <div className="binwords">
                  <span>{tr('Cada bin lleva:')}</span>
                  {BIN_WORDS.map((w) => <button key={w} type="button" className={'chip sm' + (word === w ? ' on' : '')} aria-pressed={word === w} onClick={() => setBinText(w)}>{binWord(w)}</button>)}
                  <input value={BIN_WORDS.includes(word) ? '' : binText} placeholder={tr('Otra cosa')} aria-label={tr('Otra cosa')} onChange={(e) => setBinText(e.target.value)} autoComplete="off" />
                </div>
              )}
            </div>
          )}
          {isMfo && (
            <div className="makes">
              <span className="lab">{tr('¿Qué llevan los bins?')}</span>
              <div className="seg" role="group" aria-label={tr('¿Qué llevan los bins?')}>
                {MFO_WORDS.map((w) => <button key={w} type="button" className={kindClass('MFO', w) + (mfoWord === w ? ' on' : '')} aria-pressed={mfoWord === w} onClick={() => setBinText(w)}>{w === 'lb' ? tr('Libras') : w === 'copas' ? tr('Copas') : tr('Platos')}<small>{w === 'lb' ? tr('cada bin se pesa') : w === 'copas' ? tr('cada bin dice cuántas') : tr('cada bin dice cuántos')}</small></button>)}
              </div>
            </div>
          )}
          {todo.length > 0 && (
            <div className="todo wide">
              <small>{tr('Del programa de hoy:')}</small>
              {todo.map((r) => <button key={r.code} type="button" className={'chip sm' + (normCode(code) === normCode(r.code) ? ' on' : '')} onClick={() => setCode(r.code)}><b>{r.code}</b> {trx('faltan {0}', fmtN(r.left) + (line.dept === 'Spiral' ? ' ' + r.unit : ''))}</button>)}
            </div>
          )}
          <label>{tr('Código')}{' '}<input value={code} onChange={(e) => setCode(e.target.value)} placeholder={tr('ej. 0100')} autoComplete="off" /></label>
          <label>{tr('Lote')}{' '}<input value={lot} onChange={(e) => setLotText(e.target.value)} inputMode="numeric" placeholder={tr('ej. 6280')} autoComplete="off" /></label>
          {looksLikeTwoLots(lot) && <p className="hint twolots">{isPack ? tr('Parece que son dos lotes escritos juntos. Empieza con el primero; cuando se acabe, toca "➕ Otro lote en este pallet" y el pallet lleva los dos, cada uno con sus cajas y su tag.') : tr('Parece que son dos lotes escritos juntos. Empieza con el primero; cuando cambie, toca "Cambió el lote".')}</p>}
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
        </form>}
        {!quiet && <div className="tools">
          {!idle ? <button type="button" className="btn sm setupbtn" onClick={() => startSetup(line)}>{tr('⏱ Empezar Set up')}</button> : <span />}
          {mgr && <button type="button" className="lnk sm muted" onClick={() => setRemoving(true)}>{trx('Quitar {0}', cfg.lineWord.toLowerCase())}</button>}
        </div>}
        {viewOnly && !idle && <p className="hint">{tr('Libre: sin código.')}</p>}
      </div>
    )
  }
  const st = runStats(s, run, now)
  // a Packing line that fills bins speaks of bins; one that makes pallets builds each one lot by lot (see PalletPanel)
  const rc = cfgOf(run), pallets = run.dept === 'Packing' && !binOf(run), packBins = run.dept === 'Packing' && !!binOf(run), runWord = rc.unit.toLowerCase()
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
  const openOrders = rc.orders ? openOrdersFor(s, run.code) : []
  const nextOrder = rc.orders ? nextOrderFor(s, run) : ''
  const orderOptions = openOrders.map((o) => ({ id: o.id, label: orderLabel(o) + leftText(s, o) + (o.shipBy ? ' ' + tr('· envío {0}', shipText(o.shipBy)) : '') }))
  const done = () => {
    if (just) return
    if (pallets) setPacking('done')
    else if (rc.qty === 'ask') setCounting(true)
    else record(rc.qty === 'auto' ? run.perUnit : null)
  }
  // the pallets of this code already finished without the tag of some lot (the tag often comes later), the last two:
  // one tap away. A pallet of before, with one tag for all of it, has its tag.
  const untagged = pallets ? run.units.map((u, i) => ({ u, i, lots: u.lots?.length ? (u.lots.some((l) => !!l.tag) || !u.ref ? u.lots.filter((l) => !l.tag).map((l) => l.lot) : []) : u.ref ? [] : [run.lot] })).filter((x) => x.lots.length).slice(-2) : []
  const tagUnit = tagging != null ? run.units[tagging] : undefined
  // a bin carries the lot being packed now, when it is not the run's own
  const binLots = (q: number) => (packBins && lotNowOf(run) !== run.lot ? [{ lot: lotNowOf(run), qty: q }] : undefined)
  const lit = just ? ' bumped' : ''
  // pouches are also told as full cases and loose pouches, where the products table says how many go in a case
  const perCase = perCaseOf(run.code)
  const cases = perCase && mineNow.qty > 0 ? inCases(s, run.code, mineNow.qty) : null
  // a set up on this line while its code runs: amber like every set up, never the red of a stop
  const inSetup = !!stop && stop.lineId === line.id && stop.reason === SETUP
  return (
    <div className={'line ' + (inSetup ? 'insetup' : stop ? 'stopped' : 'running') + (just ? ' justdone' : '') + (packBins ? ' mode-bin' : pallets ? ' mode-pal' : '')}>
      {naming}
      <div className="lhead">
        <h3>{lineLabel(line.name)} {nameIt}</h3>
        <span className={'pill ' + (inSetup ? 'setup' : stop ? 'stop' : 'run')}>{inSetup ? tr('⏱ Set up') : stop ? tr('⏸ Parado') : tr('● Corriendo')}</span>
        <span className="lacts">{goalBtn}{!quiet && <button type="button" className="lnk sm" onClick={() => setFixing(true)}>{tr('Corregir')}</button>}</span>
      </div>
      {/* what runs here, big: the code and the lot going on now; a Packing line says first whether it makes pallets or fills bins */}
      <div className={'hero' + (packBins ? ' bin' : pallets ? ' pal' : '')}>
        {run.dept === 'Packing' && <span className="mode">{binOf(run) ? trx('BINS · {0}', binWord(binOf(run))) : tr('PALLETS')}</span>}
        {run.dept === 'MFO' && binOf(run) && <span className={'mode ' + kindClass('MFO', binOf(run))}>{trx('BINS · {0}', binWord(binOf(run)))}</span>}
        <div className="hero-main"><b className="code">{run.code}</b><span className="lot">{trx('lote {0}', <b>{lotNowOf(run)}</b>)}</span></div>
        {productOf(s, run.code)?.name && <div className="hero-name">{productOf(s, run.code)?.name}</div>}
        {/* the facts of the run, each with its name: when it started, what a unit carries, and what is not the usual */}
        <div className="hero-facts">
          <span className="fact"><small>{tr('Desde')}</small><b>{fmtTime(run.startedAt)}</b></span>
          {run.date !== day.date && <span className="fact"><small>{tr('Fecha')}</small><b>{shortDay(run.date)}</b></span>}
          {run.perUnit != null && <span className="fact"><small>{tr('Por {0}', runWord)}</small><b>{fmtN(run.perUnit)} {rc.qtyUnit}</b></span>}
          {packBins && <span className="fact"><small>{tr('Turno')}</small><b>{turn.shift}</b></span>}
          {measureOf(run) && <span className="fact"><small>{tr('Se cuenta en')}</small><b>{measureName(measureOf(run))}</b></span>}
        </div>
      </div>
      {mineNow.carried && (
        <div className="carried">
          {run.date === day.date && cameFrom !== turn.shift
            ? trx('↪ Viene del turno {0}: empezó a las {1} y traía {2}.', cameFrom, <b>{fmtTime(run.startedAt)}</b>, <b>{unitsText(line.dept, mineNow.before.units, mineNow.before.qty, rc)}</b>)
            : trx('↪ Viene de antes: empezó el {0} a las {1} y traía {2}.', <b>{shortDay(run.date)}</b>, <b>{fmtTime(run.startedAt)}</b>, <b>{unitsText(line.dept, mineNow.before.units, mineNow.before.qty, rc)}</b>)}
          {' '}{trx('Abajo cuenta este turno, desde cero. Total del código: {0}.', <b>{madeText(run, st.qty)}</b>)}
        </div>
      )}
      {goalStrip}
      {staleBar}
      {run && twice.length > 1 && (
        <div className="stalebar twice">
          <span>{trx('⚠ Esta línea tiene {0} códigos abiertos a la vez. Aquí va el más nuevo, {1} desde las {2}; también sigue abierto {3}. Cuenta y tiempos se ven partidos hasta cerrar el que sobra.', twice.length, <b>{run.code}</b>, fmtTime(run.startedAt), twice.slice(1).map((r) => r.code + ' ' + tr('desde las {0}', fmtTime(r.startedAt)) + ' (' + unitsText(r.dept, r.units.length, runQty(s, r), cfgOf(r)) + ')').join(', '))}</span>
          {mgr && !quiet && <button type="button" className="btn sm" onClick={() => setClosingOld(true)}>{tr('Terminar el que sobra')}</button>}
        </div>
      )}
      {closingOld && run && <ConfirmDialog title={tr('¿Terminar {0} en {1}', twice.slice(1).map((r) => r.code + ' ' + tr('desde las {0}', fmtTime(r.startedAt))).join(', '), lineLabel(line.name)) + '?'} text={tr('Termina a la hora en que empezó {0} (o en su última unidad, si fue después). Lo que registró queda tal cual, y queda en el historial. Si el que sobra es el nuevo, termínalo desde Reporte › Corregir.', run.code + ' ' + fmtTime(run.startedAt))} yes={tr('Terminar')} onYes={() => { endOlderRuns(line.id); setClosingOld(false) }} onNo={() => setClosingOld(false)} />}
      {openOrders.length > 0 && (
        <div className="orderstrip">
          <span>{trx('📦 {0} de {1}:', openOrders.length === 1 ? tr('Pedido') : tr('Pedidos'), run.code)}</span>
          {openOrders.slice(0, 2).map((o) => <span key={o.id} className={o.id === nextOrder ? 'next' : ''}><b>{orderLabel(o)}</b>{leftText(s, o)}{o.shipBy && ' ' + tr('· envío {0}', shipText(o.shipBy))}</span>)}
          {openOrders.length > 2 && <span>{trx('y {0} más', openOrders.length - 2)}</span>}
        </div>
      )}
      {inSetup && stop && <div className="setupbar running">⏱ <b>{tr(stop.reason)}</b>{stop.note && ' · ' + noteLabel(stop.note)} · <b>{fmtDur(stopTime(s, stop, now))}</b> <small>{trx('desde las {0}', fmtTime(stop.startedAt))}</small>{!quiet && <button type="button" className="lnk sm" onClick={() => setFixingStop(true)}>{tr('Corregir')}</button>}</div>}
      {stop && !inSetup && <div className="stopbar">⏸ <b>{tr(stop.reason)}</b>{stop.note && ' · ' + noteLabel(stop.note)} · <b>{fmtDur(stopTime(s, stop, now))}</b>{stop.lineId === null && ' ' + tr('· todo el departamento')}{!quiet && stop.lineId === line.id && <button type="button" className="lnk sm" onClick={() => setFixingStop(true)}>{tr('Corregir')}</button>}</div>}
      {fixing && <RunEditor s={s} run={run} mgr={mgr} onClose={() => setFixing(false)} />}
      {fixingStop && stop && <StopEditor stop={stop} mgr={mgr} onClose={() => setFixingStop(false)} />}
      {/* what is made, big: how many units and how much they carry (with its cases, where pouches are counted); then the
          unit in hand with its average, and the time worked with the time stopped */}
      <div className={'tiles' + (rc.qty !== 'none' ? ' four' : '')}>
        <div key={'n' + (just?.at ?? 0)} className={'tile main' + lit}><label>{rc.plural}</label><b>{mineNow.units}</b></div>
        {rc.qty !== 'none' && <div key={'q' + (just?.at ?? 0)} className={'tile main' + lit}><label>{rc.qtyUnit}</label><b>{fmtN(mineNow.qty)}</b>{cases && <small>{casesText(cases)}</small>}</div>}
        <div className="tile"><label>{(rc.saved.endsWith('a') ? tr('Esta') + ' ' : tr('Este') + ' ') + runWord}</label><b>{fmtDur(current)}</b><small>{trx('prom. {0}', mineNow.units ? fmtDur(mineNow.avg) : '—')}</small></div>
        <div className="tile"><label>{tr('Trabajando')}</label><b>{fmtDur(mineNow.working)}</b><small className={mineNow.setup ? 'both' : ''}><span className={mineNow.down ? 'red' : ''}>{trx('parado {0}', fmtDur(mineNow.down))}</span>{mineNow.setup > 0 && <span className="amber"> · {tr('set up {0}', fmtDur(mineNow.setup))}</span>}</small></div>
      </div>
      {pallets
        ? <PalletPanel s={s} run={run} readOnly={quiet} saved={just ? savedText(line.dept, just.n - brought, rc) : ''} onDone={done} onLot={() => setPacking('lot')} onLotNow={() => setPacking('binlot')} onPart={(i) => setPacking(i)} onOrder={() => setPacking('po')} onReopen={() => setPacking('reopen')} canReopen={run.units.length > brought && !run.extra?.open?.parts.length} />
        : !quiet && <button type="button" className={'btn primary huge' + (just ? ' saved' : '')} disabled={!!just} onClick={done}>✓ {just ? savedText(line.dept, just.n - brought, rc) : rc.done}</button>}
      {!quiet && packBins && <button type="button" className="lnk sm binlot" onClick={() => setPacking('binlot')}>{tr('¿Cambió el lote?')}</button>}
      {!quiet && untagged.map((x) => <button key={x.u.at} type="button" className="lnk sm notag tagmiss" onClick={() => setTagging(x.i)}>{tr('Al pallet {0} le falta el tag: lote {1} · ponerlo', x.i + 1, x.lots.join(', '))}</button>)}
      {!quiet && own && <button type="button" className="btn slim" onClick={() => setFilling(own)}>{trx('➕ Completar {0} · tiene {1} de {2}', runWord + (own.run.id === run.id && own.index >= brought ? ' ' + noOf(own) : ' ' + tr('de antes')), own.unit.qty, own.usual)}</button>}
      {!quiet && (
      <div className="acts2">
        {inSetup && stop
          ? <button type="button" className="btn setupgo" onClick={() => endStop(stop.id)}>{tr('✓ Set up listo')}</button>
          : stop
            ? (stop.lineId === line.id
              ? <button type="button" className="btn danger" onClick={() => endStop(stop.id)}>{tr('▶ Reanudar')}</button>
              : <button type="button" className="btn" disabled>{tr('Parado por el departamento')}</button>)
            : <button type="button" className="btn stopbtn" onClick={() => setAsking(true)}>{tr('⏸ Parar')}</button>}
        {/* the set up is one tap away at any moment: from running, or from a stop that turns out to be a set up */}
        {!inSetup && (!stop || stop.lineId === line.id) && <button type="button" className="btn setupbtn" onClick={() => (stop ? switchToSetup(stop.id) : startStop(line.dept, line.id, SETUP, ''))}>{tr('⏱ Set up')}</button>}
        {cfg.waste && <button type="button" className="btn" onClick={() => setWasting(true)}>Waste{run.waste ? <b className="red"> {run.waste} lb</b> : ' (lb)'}</button>}
        <button type="button" className="btn" disabled={!!stop && !inSetup} onClick={() => setEnding(true)}>{tr('■ Terminar')}<span className="opt"> {' '}{tr('código')}</span></button>
      </div>
      )}
      {!quiet && fillLink && <div className="fillmore">{fillLink}</div>}
      {ending && <EndDialog cfg={rc} code={run.code} line={lineLabel(line.name)} now={now} lastAt={run.units.length ? run.units[run.units.length - 1].at : null}
        summary={tr('Lleva {0} · trabajando {1}{2}', madeText(run, st.qty), fmtDur(st.working), (st.down ? ' ' + tr('· parado {0}', fmtDur(st.down)) : '')) + '.'}
        onClose={() => setEnding(false)} onDone={(next) => { endRun(run.id, next); setEnding(false) }}
        onMissing={(next) => { setEnding(false); if (pallets) { setEndAfter(next); setPacking('done') } else if (rc.qty === 'ask') { setEndAfter(next); setCounting(true) } else { record(rc.qty === 'auto' ? run.perUnit : null); endRun(run.id, next) } }} />}
      {asking && <StopDialog title={tr('Parar {0} · {1}', lineLabel(line.name), run.code)} reasons={cfg.quick} setup onClose={() => setAsking(false)} onPick={(reason, note) => { startStop(line.dept, line.id, reason, note); setAsking(false) }} />}
      {fillUi}
      {counting && (rc.lots
        ? <LotsDialog title={rc.qtyQ} unit={rc.qtyUnit} refLabel={rc.refLabel} lot={run.lot} qty={run.perUnit} orders={orderOptions} order={nextOrder} onClose={() => { setCounting(false); setEndAfter(null) }} onPick={(q, ref, lots, po) => { record(q, ref, lots, po); setCounting(false); if (endAfter !== null) { setEndAfter(null); endRun(run.id, endAfter) } }} />
        : <QtyDialog title={rc.qtyQ} unit={rc.qtyUnit} refLabel={rc.refLabel} initial={run.perUnit} perCase={perCase} decimal={measureOf(run) === 'lb' || binOf(run) === 'lb'} onClose={() => { setCounting(false); setEndAfter(null) }} onPick={(q, ref) => { record(q, ref, binLots(q)); setCounting(false); if (endAfter !== null) { setEndAfter(null); endRun(run.id, endAfter) } }} />)}
      {packing === 'done' && <PalletDoneDialog s={s} run={run} onClose={() => { setPacking(null); setEndAfter(null) }} onSaved={() => { setPacking(null); buzz(); if (endAfter !== null) { const next = endAfter; setEndAfter(null); endRun(run.id, next) } }} />}
      {packing === 'lot' && <LotEndDialog run={run} onClose={() => setPacking(null)} />}
      {packing === 'reopen' && <ReopenPalletDialog run={run} onClose={() => setPacking(null)} />}
      {packing === 'po' && <PalletOrderDialog s={s} run={run} onClose={() => setPacking(null)} />}
      {packing === 'binlot' && <LotNowDialog run={run} onClose={() => setPacking(null)} />}
      {tagUnit && <LotsDialog key={'tag:' + tagUnit.at} title={tr('Tags del pallet {0}', (tagging ?? 0) + 1)} unit={rc.qtyUnit} refLabel={rc.refLabel} lot={run.lot} qty={tagUnit.qty} start={tagUnit.lots ?? [{ lot: run.lot, qty: tagUnit.qty ?? 0 }]} startRef={tagUnit.ref} onClose={() => setTagging(null)} onPick={(total, ref, lots) => { fillUnit(run.id, tagUnit.at, total, lots, ref); setTagging(null) }} />}
      {typeof packing === 'number' && run.extra?.open?.parts[packing] && <PartDialog run={run} index={packing} onClose={() => setPacking(null)} />}
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
function StopDialog({ title, reasons, setup, onClose, onPick }: { title: string; reasons: string[]; setup?: boolean; onClose: () => void; onPick: (reason: string, note: string) => void }) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const other = reason === 'Otra', isSetup = reason === SETUP
  const ok = other ? note.trim().length > 0 : !!reason
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{tr('¿Por qué se para? La app cuenta el tiempo parado con esta razón.')}</p>
        <div className="chips big">
          {reasons.map((r) => <button key={r} type="button" className={'chip' + (reason === r ? ' on' : '')} onClick={() => setReason(r)}>{tr(r)}</button>)}
          {setup && <button type="button" className={'chip setupchip' + (isSetup ? ' on' : '')} onClick={() => setReason(SETUP)}>{tr('⏱ Set up')}</button>}
          <button type="button" className={'chip' + (other ? ' on' : '')} onClick={() => setReason('Otra')}>{tr('Otra')}</button>
        </div>
        {isSetup && <p className="setuphint">{tr('El Set up no cuenta como parado: se ve en amarillo y en el reporte sale aparte.')}</p>}
        <input placeholder={other ? tr('Escribe la razón') : tr('Detalle (opcional)')} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="dbtns">
          <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
          <button type="button" className={'btn ' + (isSetup ? 'setupgo' : 'danger')} disabled={!ok} onClick={() => onPick(other ? note.trim() : reason, other ? '' : note.trim())}>{isSetup ? tr('⏱ Empezar Set up') : tr('⏸ Confirmar paro')}</button>
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
export function NoticeDialog({ title, text, onClose }: { title: string; text?: string; onClose: () => void }) {
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
 * A unit that can carry more than one lot of the product (a pallet in Packing): each lot with its quantity and its own
 * tag. One lot is the usual case: the box opens with the run's lot and the usual quantity, and one tap on "Guardar"
 * takes it. The unit's tag number (ref) is the tags of its lots together.
 * `start` / `startRef` = what the unit already has, when it is being corrected (a pallet of before, with one tag for
 * all of it, gives that tag to each of its lots).
 * `orders` / `order` = the orders open for the product and the one proposed: the unit is given to one of them, or to none.
 */
export function LotsDialog({ title, unit, refLabel, lot, qty, start, startRef, orders, order, onClose, onPick }: { title: string; unit: string; refLabel: string; lot: string; qty: number | null; start?: LotPart[]; startRef?: string; orders?: { id: string; label: string }[]; order?: string; onClose: () => void; onPick: (total: number, ref: string, lots: LotPart[] | undefined, po?: string) => void }) {
  const tags = !!refLabel, own = !!start?.some((l) => !!l.tag)
  const [rows, setRows] = useState(() => (start?.length ? start.map((l) => ({ lot: l.lot, qty: String(l.qty), tag: l.tag ?? (own ? '' : startRef ?? '') })) : [{ lot, qty: qty != null ? String(qty) : '', tag: startRef ?? '' }]))
  const [added, setAdded] = useState(false)
  const [po, setPo] = useState(order ?? '')
  const change = (i: number, patch: Partial<{ lot: string; qty: string; tag: string }>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const nums = rows.map((r) => Number(r.qty))
  const repeated = rows.some((r, i) => !!r.lot.trim() && rows.findIndex((o) => o.lot.trim() === r.lot.trim()) !== i)
  const ok = !repeated && rows.every((r, i) => !!r.lot.trim() && r.qty.trim() !== '' && Number.isFinite(nums[i]) && nums[i] > 0)
  const total = nums.reduce((t, n) => t + (Number.isFinite(n) ? n : 0), 0)
  const save = () => {
    if (!ok) return
    const parts = rows.map((r, i) => ({ lot: r.lot.trim(), qty: nums[i], ...(r.tag.trim() ? { tag: r.tag.trim() } : {}) }))
    // the unit's tag number is its lots' tags together; all of it of the run's own lot is the plain case: nothing to
    // write beside the quantity and its tag
    const ref = [...new Set(parts.map((p) => p.tag ?? '').filter(Boolean))].join(', ')
    onPick(total, ref, parts.length === 1 && parts[0].lot === lot ? undefined : parts, orders?.length ? po || undefined : undefined)
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
              {tags && <label>{tr('Tag')}{' '}<input inputMode="numeric" placeholder={tr('ej. 1749')} value={r.tag} onChange={(e) => change(i, { tag: e.target.value })} autoComplete="off" /></label>}
              {rows.length > 1 && <button type="button" className="lnk" title={tr('Quitar este lote')} onClick={() => setRows(rows.filter((_, k) => k !== i))}>✕</button>}
            </div>
          ))}
          <button type="button" className="lnk addlot" onClick={() => { setAdded(true); setRows([...rows, { lot: '', qty: '', tag: '' }]) }}>{trx('+ Otro lote en este {0}', unit === tr('cajas') ? 'pallet' : tr('mismo'))}</button>
          {rows.length > 1 && <p className="lottotal">{trx('Total: {0} en {1} lotes', <b>{total} {unit}</b>, rows.length)}</p>}
          {repeated && <span className="err">{trx('Ese lote ya está en la lista: suma sus {0} en una sola línea.', unit)}</span>}
          {tags && <p className="hint">{tr('Cada lote lleva su tag. Si todavía no lo tienen, déjenlo en blanco y se pone después.')}</p>}
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

/** a manager types the goal of one line for one shift: so much per hour and/or in the whole shift. It shows on that line's card */
function LineTargetDialog({ s, line, unit, inCourse, onClose }: { s: State; line: Line; unit: string; inCourse: 1 | 2; onClose: () => void }) {
  const who = useWho()
  const [shift, setShift] = useState<1 | 2>(() => goalShift(who, inCourse))
  const goal = lineShiftGoalOf(s, line.id, shift)
  const [hour, setHour] = useState(goal.perHour ? String(goal.perHour) : '')
  const [whole, setWhole] = useState(goal.total ? String(goal.total) : '')
  const pick = (k: 1 | 2) => { const g = lineShiftGoalOf(s, line.id, k); setShift(k); setHour(g.perHour ? String(g.perHour) : ''); setWhole(g.total ? String(g.total) : '') }
  const before = lineTargetOf(s, line.id)?.perDay
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{trx('Meta de {0} · {1} · Turno {2}', lineLabel(line.name), line.dept, shift)}</h3>
        <ShiftPick value={shift} onPick={pick} />
        <p>{trx('Es la meta de esta línea en un turno: solo cuenta lo que la línea hace en ese turno. Sale en su tarjeta, en todas las tablets, y queda en el historial. Deja en blanco la que no aplique. El ritmo de la línea sale en rojo cuando baja de su meta por hora. La meta de todo {0} junto se pone arriba, en la tarjeta del turno.', line.dept)}</p>
        {!goal.own && before ? <p className="hint">{trx('La meta que había, {0} {1}, era del día completo, de los dos turnos juntos: ya no se usa. Pon aquí la de este turno.', <b>{fmtN(before)}</b>, unit)}</p> : null}
        <form onSubmit={(e) => { e.preventDefault(); setLineShiftGoal(line, shift, goalNum(hour), goalNum(whole)); onClose() }} className="qform">
          <label>{tr('Por hora')}{' '}<input inputMode="numeric" placeholder={tr('ej. 150 {0}', unit)} value={hour} onChange={(e) => setHour(e.target.value.replace(/\D/g, ''))} /></label>
          <label>{tr('En todo el turno')}{' '}<input inputMode="numeric" placeholder={tr('ej. 2400 {0}', unit)} value={whole} onChange={(e) => setWhole(e.target.value.replace(/\D/g, ''))} /></label>
          <div className="dbtns spread">
            <div className="btns">{goal.perHour || goal.total ? <button type="button" className="lnk" onClick={() => { setLineShiftGoal(line, shift, null, null); onClose() }}>{tr('Quitar meta')}</button> : null}</div>
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

export function ShiftsDialog({ s, date, onClose }: { s: State; date: string; onClose: () => void }) {
  const cur = shiftsOf(s, date)
  const [from, setFrom] = useState(date)
  const [h, setH] = useState<ShiftHours>({ first: cur.first, firstEnd: cur.firstEnd, second: cur.second, secondEnd: cur.secondEnd })
  const problem = shiftsProblem(h), cuts = problem ? null : shiftCuts(h)
  const field = (key: 'first' | 'firstEnd' | 'second' | 'secondEnd', label: string) => <label>{label} <input type="time" value={h[key]} onChange={(e) => setH({ ...h, [key]: e.target.value })} /></label>
  // the calendar: which shifts work each day of the week (from the same date on), and this day apart from its week
  const [week, setWeek] = useState(weekOf(s, date))
  const names = [tr('dom'), tr('lun'), tr('mar'), tr('mié'), tr('jue'), tr('vie'), tr('sáb')]
  const apart = s.dayShifts.find((x) => x.date === date)
  const weekSays = Number(weekOf(s, date).charAt(new Date(date + 'T12:00:00').getDay()))
  const [said, setSaid] = useState('')
  const pick = (only: 1 | 2 | 3 | null) => { if (setDayShifts(date, only)) setSaid(tr('✓ Guardado para el {0}. Lo ven todos los aparatos, todo lo de ese día se cuenta así, y queda en el historial.', longDate(date))) }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg wide" onClick={(e) => e.stopPropagation()}>
        <h3>{tr('Horario de los turnos')}</h3>
        <p>{tr('Lo ven todos los aparatos y queda en el historial. Los días anteriores a la fecha que pongas siguen con el horario que tenían.')}</p>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); if (!problem && from && setShifts(from, h)) { setShiftWeek(from, week); onClose() } }}>
          <div className="egrid">{field('first', tr('Turno 1 empieza'))}{field('firstEnd', tr('Turno 1 termina'))}{field('second', tr('Turno 2 empieza'))}{field('secondEnd', tr('Turno 2 termina'))}</div>
          <div className="week">
            <span className="lab">{tr('Qué turnos trabajan cada día de la semana')}</span>
            <div className="wk">
              {names.map((n, i) => <label key={i}>{n}<select value={week.charAt(i)} onChange={(e) => setWeek(week.slice(0, i) + e.target.value + week.slice(i + 1))}><option value="3">{tr('1 y 2')}</option><option value="1">{tr('Solo 1')}</option><option value="2">{tr('Solo 2')}</option></select></label>)}
            </div>
          </div>
          <label>{tr('Vale desde el día')}{' '}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          {cuts
            ? <p className="hint">{trx('Cada registro cuenta para un turno por su hora: hasta las {0} es del turno 1 y después del turno 2. Pasada la medianoche sigue siendo del turno 2 hasta las {1}. El corte es la mitad del rato entre un turno y el otro, para que quien se queda un poco o llega un poco antes cuente con su turno. El tiempo nunca se detiene solo: quien sigue trabajando después de su hora, o empieza antes, sigue contando. Solo cuando ya pasó el rato entre un turno y el otro, si en una línea nadie registró nada en todo ese rato, ese rato se descuenta.', <b>{minuteText(cuts.toSecond)}</b>, <b>{minuteText(cuts.toFirst)}</b>)}</p>
            : <span className="err">{problem}</span>}
          <div className="dbtns">
            <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
            <button type="submit" className="btn primary" disabled={!!problem || !from}>{tr('✓ Guardar')}</button>
          </div>
        </form>
        <div className="dayapart">
          <h4>{trx('Solo el {0}', longDate(date))}</h4>
          <p className="hint">{tr('Para un día distinto de los demás: un sábado en que solo vino un turno, o un día de dos turnos que no suele tenerlos. No cambia el horario ni la semana. Con un solo turno, todo lo del día es de ese turno.')}</p>
          <div className="seg" role="group" aria-label={tr('Turnos de este día')}>
            <button type="button" className={!apart ? 'on' : ''} aria-pressed={!apart} onClick={() => pick(null)}>{tr('Como su semana')}<small>{dayShiftsText(weekSays === 1 || weekSays === 2 ? weekSays : undefined)}</small></button>
            <button type="button" className={apart?.only === 1 ? 'on' : ''} aria-pressed={apart?.only === 1} onClick={() => pick(1)}>{tr('Solo turno 1')}</button>
            <button type="button" className={apart?.only === 2 ? 'on' : ''} aria-pressed={apart?.only === 2} onClick={() => pick(2)}>{tr('Solo turno 2')}</button>
            <button type="button" className={apart?.only === 3 ? 'on' : ''} aria-pressed={apart?.only === 3} onClick={() => pick(3)}>{tr('Los dos')}</button>
          </div>
          {said && <p className="hint ok">{said}</p>}
        </div>
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
  const can = useCan(), who = useWho(), viewOnly = who.role === 'viewer'
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
  const [fLine, setFLine] = useState('') // one line of the day alone (its id)
  const [fLot, setFLot] = useState('')
  // the room a manager looks at (the people of one room see only theirs)
  const [fDept, setDeptPick] = useState<Dept | ''>(only ? '' : deptChosen)
  const [addingRun, setAddingRun] = useState(false) // a code that ran and nobody recorded, put on its line after the fact
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
  const [palQ, setPalQ] = useState('') // the pallets of the day, found by what is written on them: a code, a lot, a tag, a PO, a line
  const [palF, setPalF] = useState<PalletFilter>('') // ...or by their state: without a tag, without or with a PO, full, short, being built
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
  const filter: ReportFilter = { only: dept, code: fCode, lot: fLot, shift: fShift, line: fLine }
  const rep = reportOf(s, date, now, filter)
  const { runs, stops, rows, unitRows, working, down, byCode, setup } = rep
  const withOrders = unitRows.some((x) => x.order) // a column says the order of each pallet when any has one
  const unitsText = (dept: Dept, n: number) => n + ' ' + (n === 1 ? CFG[dept].unit : CFG[dept].plural).toLowerCase()
  /** "1 bin", "3 bins" */
  const binsN = (n: number) => (n === 1 ? tr('1 bin') : tr('{0} bins', n))
  /** a pallet's place among its order's pallets: "2/12" (or "2" when the order does not say how many cases it is) */
  const ofText = (of: [number, number | null]) => (of[1] ? of[0] + '/' + of[1] : String(of[0]))
  const palK = plainText(palQ)
  const palletIs = (p: (typeof rep.pallets)[number], f: PalletFilter) => (f === '' ? true : f === 'notag' ? p.parts.some((x) => !x.tag) : f === 'nopo' ? !p.order : f === 'po' ? !!p.order : f === 'open' ? p.open : p.r.perUnit != null && !p.open && (f === 'full' ? p.total >= p.r.perUnit : p.total < p.r.perUnit))
  const palletsFound = palK ? rep.pallets.filter((p) => [p.r.code, p.order, lineNameOf(s, p.r.lineId, p.r.line), ...p.parts.flatMap((x) => [x.lot, x.tag])].some((t) => plainText(String(t ?? '')).includes(palK))) : rep.pallets
  const palletsShown = palletsFound.filter((p) => palletIs(p, palF))
  const palCount = (f: PalletFilter) => palletsFound.filter((p) => palletIs(p, f)).length
  /** the words of a line of "por código": a code filled in bins speaks of bins */
  const cw = (c: { dept: Dept; bin: string }) => cfgFor(c.dept, c.bin)
  const reasonsText = (x: (typeof rows)[number]) => Object.entries(x.st.reasons).map(([k, v]) => tr(k) + ' ' + fmtDur(v)).join(', ')
  const lineName = (x: { lineId: string | null; dept: Dept }) => (x.lineId === null ? tr('Todo {0}', x.dept) : lineLabel(s.lines.find((l) => l.id === x.lineId)?.name ?? s.runs.find((r) => r.lineId === x.lineId)?.line ?? tr('línea')))
  const lineChosen = rep.line ? rep.lineChoices.find((l) => l.id === rep.line)?.name ?? '' : ''
  const fileName = 'actividad-' + (dept ? dept.toLowerCase() + '-' : '') + date + filterFile(rep.code, rep.lot, rep.shift, lineChosen)
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
  // the shifts of the day, side by side: both, or the only one that worked
  const shiftCols = ([1, 2] as const).filter((k) => !rep.plan.only || rep.plan.only === k)
  const blocks = () => {
    const T = (ms: number) => xTime(ms, fmtTime(ms)), D = (ms: number) => xDur(ms, fmtDur(ms))
    const resumen: Cell[][] = [[tr('Departamento'), tr('Línea'), tr('Código'), tr('Lote'), tr('Fecha'), tr('Inicio'), tr('Fin'), tr('Unidad'), tr('Hechas'), tr('Cantidad'), tr('Unidad de cantidad'), tr('Tags / bins'), tr('Waste (lb)'), tr('Tiempo trabajando'), tr('Promedio por unidad'), tr('Tiempo parado'), 'Set up', tr('Razones de paro'), tr('Registró'), tr('Turno')],
      ...rows.map((x): Cell[] => [x.r.dept, lineNameOf(s, x.r.lineId, x.r.line), x.r.code, x.lots, xDay(x.r.date), T(x.r.startedAt), x.r.endedAt ? T(x.r.endedAt) : tr('en curso'), cfgOf(x.r).unit, x.units, CFG[x.r.dept].qty !== 'none' ? x.qty : '', CFG[x.r.dept].qty !== 'none' ? cfgOf(x.r).qtyUnit : '', x.view.units.map((u) => u.ref).filter(Boolean).join(', '), x.waste || '', D(x.st.working), x.timed ? D(x.st.avg) : '', D(x.st.down), x.st.setup ? D(x.st.setup) : '', reasonsText(x), whoText(x.r), rep.shift ? String(rep.shift) : x.shifts])]
    const boxes = (c: (typeof byCode)[number]) => (!c.bin && CFG[c.dept].qtyUnit === 'pouches' ? inCases(s, c.code, c.qty) : null)
    const porCodigo: Cell[][] = [[tr('Departamento'), tr('Código'), tr('Unidad'), tr('Hechas'), tr('Cantidad'), tr('Unidad de cantidad'), tr('Waste (lb)'), tr('Líneas'), tr('Cajas completas'), tr('Pouches sueltos'), ...(rep.shift ? [] : shiftCols.map((k) => tr('Turno {0}', k)))],
      ...byCode.map((c): Cell[] => [c.dept, c.code, cw(c).unit, c.units, CFG[c.dept].qty !== 'none' ? c.qty : '', CFG[c.dept].qty !== 'none' ? cw(c).qtyUnit : '', c.waste || '', c.lines.join(', '), boxes(c)?.cases ?? '', boxes(c)?.loose ?? '', ...(c.byShift ? shiftCols.map((k) => (c.byShift as [number, number])[k - 1]) : [])])]
    const porLote: Cell[][] = [[tr('Departamento'), tr('Código'), tr('Lote'), tr('Unidad'), tr('Hechas'), tr('Cantidad'), tr('Unidad de cantidad'), ...(rep.shift ? [] : shiftCols.map((k) => tr('Turno {0}', k)))],
      ...byCode.flatMap((c) => c.lots.map((l): Cell[] => [c.dept, c.code, l.lot, cw(c).unit, l.units, CFG[c.dept].qty !== 'none' ? l.qty : '', CFG[c.dept].qty !== 'none' ? cw(c).qtyUnit : '', ...(l.byShift ? shiftCols.map((k) => (l.byShift as [number, number])[k - 1]) : [])]))]
    const unidades: Cell[][] = [[tr('Departamento'), tr('Línea'), tr('Código'), tr('Lote'), '#', tr('Hora'), tr('Unidad'), tr('Cantidad'), tr('Unidad de cantidad'), tr('Tag / bin'), tr('Desde la anterior'), tr('Registró'), tr('Turno'), tr('Pedido')],
      ...unitRows.map((x): Cell[] => [x.r.dept, lineNameOf(s, x.r.lineId, x.r.line), x.r.code, x.lot, x.i + 1, T(x.u.at), cfgOf(x.r).unit, x.qty ?? '', x.qty != null ? cfgOf(x.r).qtyUnit : '', x.tag, D(x.gap), x.u.by, x.shift, x.order])]
    const paros: Cell[][] = [[tr('Departamento'), tr('Línea'), tr('Razón'), tr('Detalle'), tr('Inicio'), tr('Fin'), tr('Duración'), tr('Registró'), tr('Turno')],
      ...stops.map((x): Cell[] => [x.dept, lineName(x), tr(x.reason), noteLabel(x.note), T(x.startedAt), x.endedAt ? T(x.endedAt) : tr('en curso'), D(x.ms), x.by, spanShifts(rep.plan, x.startedAt, x.endedAt ?? now)])]
    // the whole day first and each shift under it (not when the report is of one shift only); what a room filled in bins
    // goes under it, word by word: its bins and what they hold
    const binRows = (d: (typeof rep.byShift)[number]) => [...new Set(d.day.bins.map((y) => y.word))].flatMap((w) => [d.day, ...shiftCols.map((k) => (k === 1 ? d.first : d.second))].map((x): Cell[] => { const y = x.bins.find((z) => z.word === w); return [d.dept, x.shift ? tr('Turno {0}', x.shift) : tr('Total del día'), '', '', '', '', '', '', '', y?.units ?? 0, cfgFor(d.dept, w).unit, y?.qty ?? 0, apartWord(d.dept, w), '', '', '', ''] }))
    const porTurno: Cell[][] = [[tr('Departamento'), tr('Turno'), tr('Horario'), tr('Empezó'), tr('Terminó'), tr('Duración'), tr('Líneas'), tr('Códigos'), tr('Corridas'), tr('Hechas'), tr('Unidad'), tr('Cantidad'), tr('Unidad de cantidad'), tr('Waste (lb)'), tr('Tiempo trabajando'), tr('Tiempo parado'), 'Set up'],
      ...rep.byShift.flatMap((d) => [...[d.day, ...shiftCols.map((k) => (k === 1 ? d.first : d.second))].map((x): Cell[] => [d.dept, x.shift ? tr('Turno {0}', x.shift) : tr('Total del día'), x.shift ? shiftHours(rep.plan, x.shift) : '', x.from ? T(x.from) : '', !x.to ? '' : x.open ? tr('en curso') : T(x.to), x.span ? D(x.span) : '', x.lines, x.distinct, x.codes, x.units, CFG[d.dept].unit, CFG[d.dept].qty !== 'none' ? x.qty : '', CFG[d.dept].qty !== 'none' ? CFG[d.dept].qtyUnit : '', x.waste || '', D(x.working), D(x.down), x.setup ? D(x.setup) : '']), ...binRows(d)])]
    const cambios: Cell[][] = [[tr('Hora'), tr('Quién'), tr('Departamento'), tr('Qué'), tr('Antes'), tr('Después')], ...changes.map((c): Cell[] => [T(c.at), c.by, c.dept ?? '', c.what, c.before, c.after])]
    const av = mgr && !dept && !rep.filtered ? avanceRows(s, date) : []
    const carry = av.length ? carriedOver(s, date).filter((x) => x.next <= today) : [], came = av.length ? cameFrom(s, date) : []
    const carryText = (code: string) => [...carry.filter((x) => normCode(x.code) === normCode(code)).map((x) => x.done ? tr('{0}: ✓ completado el {1}', x.dept, shortDay(x.next)) : x.made > 0 ? tr('{0}: pendiente {1} {2} · siguió el {3}', x.dept, fmtN(x.pending - x.made), x.unit, shortDay(x.next)) : tr('{0}: pendiente {1} {2} al día siguiente', x.dept, fmtN(x.pending), x.unit)), ...came.filter((x) => normCode(x.code) === normCode(code)).map((x) => tr('↪ {0}: {1} {2} del lote del {3}', x.dept, fmtN(x.made), x.unit, shortDay(x.from)))].join(' · ')
    const avance: Cell[][] = [[tr('Código'), tr('Producto'), tr('Al día siguiente'), tr('Lo empaca'), tr('Mezclas progr.'), tr('Mezclas hechas'), tr('Mezclas pend.'), 'Spiral', tr('Pouches progr.'), tr('Pouches esper.'), tr('Pouches hechos'), tr('Pouches pend.'), tr('Pouches faltan'), tr('Cajas progr.'), tr('Cajas esper.'), tr('Cajas hechas'), tr('Cajas pend.'), tr('Cajas faltan'), tr('MFO progr.'), tr('MFO esper.'), tr('MFO hecho'), tr('MFO en'), tr('MFO además'), tr('MFO pend.'), tr('Pallets progr.'), tr('Pallets esper.'), tr('Pallets hechos'), tr('Waste lb')],
      ...av.map((r): Cell[] => [r.code, r.product?.name ?? '', carryText(r.code), r.packRoom, r.scheduled, r.mixesDone, r.mixesPending, r.spiralDone, r.pouchesPlan, r.pouchesExp, r.pouchesDone, pending(r.pouchesExp, r.pouchesDone), pending(r.pouchesPlan, r.pouchesDone), r.casesPlan, r.casesExp, r.casesDone, pending(r.casesExp, r.casesDone), pending(r.casesPlan, r.casesDone), r.mfoPlan, r.mfoExp, r.mfo[0]?.qty ?? 0, r.mfo[0] ? mfoWord(r.mfo[0].word) : '', mfoText(r.mfo.slice(1)), pending(r.mfoExp, r.mfo[0]?.qty ?? 0), r.palletsPlan, r.palletsExp, r.palletsDone, r.wasteLb])]
    const pallets: Cell[][] = [[tr('Pallet'), tr('Línea'), tr('Código'), tr('Lote'), tr('Cajas'), tr('Tag'), tr('Total del pallet'), 'PO', tr('Pallet del PO'), tr('Hora'), tr('Turno'), tr('Registró')],
      ...rep.pallets.flatMap((p) => p.parts.map((x, i): Cell[] => [p.n, lineNameOf(s, p.r.lineId, p.r.line), p.r.code, x.lot, x.qty ?? '', x.tag, i === 0 ? p.total : '', p.order, p.of ? (p.of[1] ? tr('pallet {0} de {1}', p.of[0], p.of[1]) : String(p.of[0])) : '', p.open ? tr('en armado') : T(p.at), p.shift, p.by]))]
    const bins: Cell[][] = [[tr('Bin'), tr('Línea'), tr('Código'), tr('Lote'), tr('Cantidad'), tr('Unidad de cantidad'), tr('N° de bin'), tr('Hora'), tr('Turno'), tr('Registró')],
      ...rep.bins.map((b): Cell[] => [b.n, lineNameOf(s, b.r.lineId, b.r.line), b.r.code, b.lot, b.qty ?? '', binWord(b.word), b.ref, T(b.at), b.shift, b.by])]
    return { resumen, porTurno, porCodigo, porLote, pallets, bins, unidades, paros, cambios, avance }
  }
  /** the Excel file's sheets: one per table (Cambios and Avance only for the manager and the office) */
  const sheets = (): Sheet[] => {
    const b = blocks()
    return [{ name: tr('Resumen'), rows: b.resumen }, ...(b.porTurno.length > 1 ? [{ name: tr('Por turno'), rows: b.porTurno }] : []), { name: tr('Por código'), rows: b.porCodigo }, { name: tr('Por lote'), rows: b.porLote }, ...(b.pallets.length > 1 ? [{ name: tr('Pallets'), rows: b.pallets }] : []), ...(b.bins.length > 1 ? [{ name: tr('Bins'), rows: b.bins }] : []), { name: tr('Unidades'), rows: b.unidades }, { name: tr('Paros'), rows: b.paros }, ...(mgr ? [{ name: tr('Cambios'), rows: b.cambios }] : []), ...(b.avance.length > 1 ? [{ name: tr('Avance'), rows: b.avance }] : [])]
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
    const all: Cell[][] = [...b.resumen, ...(b.porTurno.length > 1 ? [[], ...tag(tr('POR TURNO'), b.porTurno)] : []), [], ...tag(tr('POR CÓDIGO'), b.porCodigo), [], ...tag(tr('POR LOTE'), b.porLote), ...(b.pallets.length > 1 ? [[], ...tag('PALLETS', b.pallets)] : []), [], ...tag('UNIDADES', b.unidades), [], ...tag(tr('PAROS'), b.paros), ...(mgr ? [[], ...tag('CAMBIOS', b.cambios)] : []), ...(b.avance.length > 1 ? [[], ...tag('AVANCE', b.avance)] : [])]
    return '\ufeff' + all.map((r) => r.map(q).join(',')).join('\r\n')
  }
  // ---- what the screen needs besides the report itself ----
  const today = workDay(s, now).date
  // the rooms a manager can choose among: the ones with something recorded that day
  const depts = only ? [] : DEPTS.filter((d) => d === fDept || s.runs.some((r) => r.date === date && r.dept === d))
  // what is chosen, said in words (the filters add up: any of them with any other)
  const active = [!only && dept ? dept : '', rep.shift ? tr('Turno {0}', rep.shift) + (shiftPick === null ? (who.shift ? ' (tu turno)' : ' ' + tr('(en curso)')) : '') : '', lineChosen, rep.code ? tr('Código {0}', rep.code) : '', rep.lot ? tr('Lote {0}', rep.lot) : ''].filter(Boolean)
  const clear = () => { setFCode(''); setFLot(''); setFShift(0); setFDept(''); setFLine('') }
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
  /** a shift's hours in two pieces that never break inside: "6:00 AM" and "a 3:00 PM" */
  const hrs = (k: 1 | 2) => { const [from, to] = shiftSpan(rep.plan, k); return <><span>{from}</span> <span>{tr('a {0}', to)}</span></> }
  const dash = (v: number) => (v ? fmtN(v) : '—')
  /** what a time that adds up the lines is the sum of: "suma de 3 líneas" */
  const linesText = (n: number) => (n === 1 ? tr('una línea') : tr('suma de {0} líneas', n))
  /** the title of a list that opens and closes */
  const secHead = (key: string, title: string, count: number, extra?: ReactNode) => (
    <div className="sechead">
      <h3>{title} · {count}</h3>
      {extra}
      <button type="button" className="lnk sm" aria-expanded={!shut[key]} onClick={() => setShut({ ...shut, [key]: !shut[key] })}>{shut[key] ? tr('Mostrar ▾') : tr('Ocultar ▴')}</button>
    </div>
  )
  const colsN = 7 + (rep.shift ? 0 : shiftCols.length)
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
      {sending && <SendDialog files={sending} subject={tr('Actividad · Reporte {0}', date) + (dept ? ' · ' + dept : '') + filterTitle(rep.code, rep.lot, rep.shift, lineChosen)} onClose={() => setSending(null)} />}
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
              {([0, 1, 2] as const).filter((k) => !k || !rep.plan.only || rep.plan.only === k).map((k) => (
                <button key={k} type="button" className={rep.shift === k ? 'on' : ''} aria-pressed={rep.shift === k} onClick={() => setFShift(k)}>{k ? tr('Turno {0}', k) : tr('Día completo')}<small className="hrs">{k ? hrs(k) : rep.plan.only ? tr('un solo turno') : tr('los dos turnos')}</small></button>
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
          <div className="rf-two rf-three">
            <label className="rf"><span className="lab">{tr('Línea')}</span>
              <select value={rep.line} disabled={!rep.lineChoices.length} onChange={(e) => setFLine(e.target.value)}><option value="">{tr('Todas')}</option>{rep.lineChoices.map((l) => <option key={l.id} value={l.id}>{dept ? l.name : l.dept + ' · ' + l.name}</option>)}</select>
            </label>
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
      {rows.length === 0 ? <><p className="hint">{day.state === 'here' ? (rep.code || rep.lot || (!only && dept) ? tr('Nada registrado con estos filtros.') : rep.shift ? tr('Nada registrado en este turno.') : tr('Nada registrado en esta fecha.')) : ''}</p>{day.state === 'here' && can('fix') && <p><button type="button" className="btn soft" onClick={() => setAddingRun(true)}>{tr('+ Agregar registro')}</button></p>}</> : (
        <>
          {/* what was made, big: each room counts in its own unit */}
          <div className="heads">
            {rep.byDept.map((d) => {
              const cfg = CFG[d.dept], q = cfg.qty !== 'none'
              const boxes = q && rep.code && cfg.qtyUnit === 'pouches' ? casesText(inCases(s, rep.code, d.qty)) : ''
              const where = d.dept + (rep.code ? ' ' + tr('· código {0}', rep.code) : '') + (rep.lot ? ' ' + tr('· lote {0}', rep.lot) : '')
              return (
                <Fragment key={d.dept}>
                  {/* a room that only filled bins has no pallets to show: its bins say what it made */}
                  {(d.units > 0 || !d.bins.length) && (
                    <div className="made">
                      <label>{where}</label>
                      <b>{fmtN(q ? d.qty : d.units)} <span>{q ? cfg.qtyUnit : (d.units === 1 ? cfg.unit : cfg.plural).toLowerCase()}</span></b>
                      <small>{[q ? unitsText(d.dept, d.units) : '', boxes, d.waste ? 'waste ' + d.waste + ' lb' : ''].filter(Boolean).join(' · ') || '\u00a0'}</small>
                    </div>
                  )}
                  {d.bins.map((y) => (
                    <div key={y.word} className="made bins">
                      <label>{where} · {d.dept === 'Packing' ? tr('en bins') : apartLabel(d.dept, y.word)}</label>
                      <b>{fmtN(y.qty)} <span>{apartWord(d.dept, y.word)}</span></b>
                      <small>{d.dept === 'Spiral' ? unitsText(d.dept, y.units) : binsN(y.units)}</small>
                    </div>
                  ))}
                </Fragment>
              )
            })}
          </div>
          <div className="totals">
            {rep.byDept.length === 1 && <div className="stat"><label>{rep.shift ? tr('Duración del turno {0}', rep.shift) : tr('Duración del día')}</label><b>{fmtDur(rep.byDept[0].span)}</b><small>{fmtTime(rep.byDept[0].from)} a {rep.byDept[0].open ? tr('ahora') : fmtTime(rep.byDept[0].to)}</small></div>}
            <div className="stat"><label>{tr('Códigos')}</label><b>{rep.distinct}</b><small>{rows.length} {rows.length === 1 ? tr('corrida') : tr('corridas')}</small></div>
            <div className="stat"><label>{tr('Trabajando')}</label><b>{fmtDur(working)}</b><small>{linesText(rep.lines)}</small></div>
            <div className="stat"><label>{tr('Parado')}</label><b className={down ? 'red' : ''}>{fmtDur(down)}</b><small>{linesText(rep.lines)}</small></div>
            <div className="stat"><label>Set up</label><b className={setup ? 'amber' : ''}>{setup ? fmtDur(setup) : '—'}</b><small>{tr('preparando las líneas')}</small></div>
          </div>
          {/* the whole day and each shift side by side, room by room (with one shift chosen, that shift alone) */}
          {(rep.byShift.length > 0 || rep.byDept.length > 1) && (
            <>
              <h3>{rep.shift ? tr('Por departamento · Turno {0}', rep.shift) : tr('Total del día y cada turno')}</h3>
              <div className="deptgrid">
                {rep.byDept.map((d) => {
                  const b = rep.byShift.find((x) => x.dept === d.dept), cols = b ? [b.day, ...shiftCols.map((k) => (k === 1 ? b.first : b.second))] : [d]
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
                            {[...new Set(cols.flatMap((x) => x.bins.map((y) => y.word)))].map((w) => <tr key={'bin:' + w}><td>{d.dept === 'Spiral' || w === 'lb' ? tr('En {0}', measureName(w)) : tr('Bins de {0}', binWord(w))}</td>{cols.map((x) => { const y = x.bins.find((z) => z.word === w); return cell(x, y ? (d.dept === 'Spiral' ? fmtN(y.qty) + ' ' + measureUnit(w) + ' · ' + unitsText(d.dept, y.units) : tr('{0} con {1}', binsN(y.units), fmtN(y.qty) + (w === 'lb' ? ' lb' : ''))) : '—') })}</tr>)}
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
              <thead><tr><th>{tr('Código')}</th><th>{tr('Lote')}</th><th className="num">{tr('Hechas')}</th><th className="num">{tr('Cantidad')}</th>{!rep.shift && shiftCols.map((k) => <th key={k} className="num">{tr('Turno {0}', k)}</th>)}<th>{tr('En cajas')}</th><th className="num">Waste</th><th>{tr('Líneas')}</th></tr></thead>
              <tbody>
                {rep.byDept.map((d) => {
                  const cfg = CFG[d.dept], q = cfg.qty !== 'none', b = rep.byShift.find((x) => x.dept === d.dept)
                  const boxes = (code: string, qty: number, bin = '') => (!bin && cfg.qtyUnit === 'pouches' && casesText(inCases(s, code, qty))) || '—'
                  const lotBtn = (l: string) => (!l ? '—' : <>{rep.lot ? l : <button type="button" className="drill" onClick={() => setFLot(l)}>{l}</button>}{looksLikeTwoLots(l) && <small className="twolots-mark" title={tr('Parece dos lotes escritos juntos: se separan desde Corregir, con ✎ en el pallet, poniendo las cajas de cada lote.')}>{tr('¿dos lotes juntos?')}</small>}</>)
                  // a code filled in bins speaks of bins and of what they hold (platos, copas…), not of pallets and cases
                  const cc = (bin: string) => cfgFor(d.dept, bin)
                  const qtyText = (v: number, bin = '') => (q ? fmtN(v) + ' ' + cc(bin).qtyUnit : '—')
                  const madeN = (n: number, bin = '') => n + ' ' + (n === 1 ? cc(bin).unit : cc(bin).plural).toLowerCase()
                  return (
                    <Fragment key={d.dept}>
                      {rep.byDept.length > 1 && <tr className="drow"><td colSpan={colsN}>{d.dept}</td></tr>}
                      {byCode.filter((c) => c.dept === d.dept).map((c) => (
                        <Fragment key={c.code + '|' + c.bin}>
                          <tr className="crow">
                            <td>{rep.code ? <b className="code">{c.code}</b> : <button type="button" className="drill code" onClick={() => setFCode(c.code)}>{c.code}</button>}{c.bin && <small className="binkind">{apartLabel(c.dept, c.bin)}</small>}</td>
                            <td>{c.lots.length === 1 ? lotBtn(c.lots[0].lot) : tr('{0} lotes', c.lots.length)}</td>
                            <td className="num">{madeN(c.units, c.bin)}</td>
                            <td className="num">{qtyText(c.qty, c.bin)}</td>
                            {c.byShift && shiftCols.map((k) => <td key={k} className="num">{dash((c.byShift as [number, number])[k - 1])}</td>)}
                            <td>{boxes(c.code, c.qty, c.bin)}</td><td className={'num' + (c.waste ? ' red' : '')}>{c.waste ? c.waste + ' lb' : '—'}</td><td>{c.lines.join(', ')}</td>
                          </tr>
                          {c.lots.length > 1 && c.lots.map((l) => (
                            <tr key={l.lot} className="lrow">
                              <td></td><td>{lotBtn(l.lot)}</td><td className="num">{madeN(l.units, c.bin)}</td><td className="num">{qtyText(l.qty, c.bin)}</td>
                              {l.byShift && shiftCols.map((k) => <td key={k} className="num">{dash((l.byShift as [number, number])[k - 1])}</td>)}
                              <td>{boxes(c.code, l.qty, c.bin)}</td><td></td><td></td>
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                      <tr className="trow">
                        <td colSpan={2}>{trx('Total {0}', d.dept)}</td><td className="num">{unitsText(d.dept, d.units)}</td><td className="num">{qtyText(d.qty)}</td>
                        {b && shiftCols.map((k) => { const x = k === 1 ? b.first : b.second; return <td key={k} className="num">{dash(q ? x.qty : x.units)}</td> })}
                        <td></td><td className={'num' + (d.waste ? ' red' : '')}>{d.waste ? d.waste + ' lb' : '—'}</td><td></td>
                      </tr>
                      {d.bins.map((y) => (
                        <tr key={'bin:' + y.word} className="trow bins">
                          <td colSpan={2}>{tr('Además, {0}', apartLabel(d.dept, y.word))}</td><td className="num">{madeN(y.units, y.word)}</td><td className="num">{qtyText(y.qty, y.word)}</td>
                          {b && shiftCols.map((k) => { const x = k === 1 ? b.first : b.second; return <td key={k} className="num">{dash(x.bins.find((z) => z.word === y.word)?.qty ?? 0)}</td> })}
                          <td></td><td></td><td></td>
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* Packing's pallets one by one: the lots each one holds with their cases and tags, its total and its PO (2/12) */}
          {rep.pallets.length > 0 && (
            <>
              <div className="sechead">
                <h3>{tr('Pallets')} · {palletsShown.length}{palK && palletsShown.length !== rep.pallets.length ? <small> / {rep.pallets.length}</small> : null}</h3>
                <span className="palsearch"><input value={palQ} onChange={(e) => setPalQ(e.target.value)} placeholder={tr('Buscar código, lote, tag o PO')} aria-label={tr('Buscar pallet')} autoComplete="off" />{palQ && <button type="button" className="lnk sm" aria-label={tr('Quitar la búsqueda')} onClick={() => setPalQ('')}>✕</button>}</span>
                <button type="button" className="lnk sm" aria-expanded={!shut.pallets} onClick={() => setShut({ ...shut, pallets: !shut.pallets })}>{shut.pallets ? tr('Mostrar ▾') : tr('Ocultar ▴')}</button>
              </div>
              {!shut.pallets && (
                <>
                  <div className="chips palfilters">
                    {(['', 'notag', 'nopo', 'po', 'full', 'short', 'open'] as const).filter((f) => f === '' || palCount(f) > 0 || palF === f).map((f) => (
                      <button key={f} type="button" className={'chip sm' + (palF === f ? ' on' : '')} aria-pressed={palF === f} onClick={() => setPalF(f)}>{f === '' ? tr('Todos') : f === 'notag' ? tr('Sin tag') : f === 'nopo' ? tr('Sin PO') : f === 'po' ? tr('Con PO') : f === 'full' ? tr('Completos') : f === 'short' ? tr('Incompletos') : tr('En armado')}<small>{palCount(f)}</small></button>
                    ))}
                  </div>
                  <div className="twrap">
                    <table className="pallets">
                      <thead><tr><th>{tr('Pallet')}</th><th>{tr('Código')}</th><th>{tr('Lote')}</th><th className="num">{tr('Cajas')}</th><th>{tr('Tag')}</th><th className="num">{tr('Total')}</th><th>PO</th><th>{tr('Línea')}</th><th>{tr('Hora')}</th>{!rep.shift && <th>{tr('Turno')}</th>}<th></th></tr></thead>
                      {cut('pallets', palletsShown).map((p) => {
                        const span = p.parts.length
                        return (
                          <tbody key={p.r.id + ':' + p.n} className={(p.open ? 'live' : '') + (span > 1 ? ' multi' : '')}>
                            {p.parts.map((x, i) => (
                              <tr key={i}>
                                {i === 0 && <td rowSpan={span}><b>{p.n}</b>{p.open && <small className="building">{tr('en armado')}</small>}{span > 1 && <small className="manylots">{trx('{0} lotes', span)}</small>}</td>}
                                {i === 0 && <td rowSpan={span}><b className="code">{p.r.code}</b></td>}
                                <td className={(rep.lot && x.lot === rep.lot ? 'hit' : '') + (span > 1 ? ' part' : '')}>{span > 1 && <small className="lotno">{tr('lote {0} de {1}', i + 1, span)}</small>}{x.lot}{looksLikeTwoLots(x.lot) && <small className="twolots-mark" title={tr('Parece dos lotes escritos juntos: se separan desde Corregir, con ✎ en el pallet, poniendo las cajas de cada lote.')}>{tr('¿dos lotes juntos?')}</small>}</td>
                                <td className="num">{x.qty != null ? fmtN(x.qty) : '—'}</td>
                                <td>{x.tag || <span className="notag">{tr('sin tag')}</span>}</td>
                                {i === 0 && <td rowSpan={span} className="num"><b>{fmtN(p.total)}</b></td>}
                                {i === 0 && <td rowSpan={span}>{p.order ? <>{p.order}{p.of && <b className="pof">{ofText(p.of)}</b>}</> : '—'}</td>}
                                {i === 0 && <td rowSpan={span}>{lineNameOf(s, p.r.lineId, p.r.line)}</td>}
                                {i === 0 && <td rowSpan={span}>{p.open ? '—' : fmtTime(p.at)}</td>}
                                {i === 0 && !rep.shift && <td rowSpan={span}>{p.shift}</td>}
                                {i === 0 && <td rowSpan={span}>{can('fix') && canShift(who, spanShifts(rep.plan, p.r.startedAt, p.r.endedAt ?? now)) && <button type="button" className="lnk" onClick={() => setEditRun(p.r.id)}>{tr('Corregir')}</button>}</td>}
                              </tr>
                            ))}
                          </tbody>
                        )
                      })}
                    </table>
                  </div>
                  {palletsShown.length === 0 && <p className="hint">{palK ? tr('Ningún pallet de este día tiene eso escrito.') : tr('Ningún pallet de este día está así.')}</p>}
                  {palletsShown.some((p) => p.parts.some((x) => looksLikeTwoLots(x.lot))) && <p className="hint">{tr('Un lote escrito como "6168-6216" parece dos lotes en uno, y así sus cajas no se pueden repartir entre los dos. Se separa desde Corregir, con ✎ en ese pallet, poniendo las cajas de cada lote. En la línea, un pallet con dos lotes se registra con "➕ Otro lote en este pallet".')}</p>}
                  {moreBar('pallets', palletsShown.length)}
                </>
              )}
            </>
          )}
          {/* Packing's bins one by one, apart from its pallets and in the colour of the bin cards: each with its lot, what it holds and its number */}
          {rep.bins.length > 0 && (
            <>
              <div className="sechead bins">
                <h3>{tr('Bins')} · {rep.bins.length}</h3>
                <button type="button" className="lnk sm" aria-expanded={!shut.bins} onClick={() => setShut({ ...shut, bins: !shut.bins })}>{shut.bins ? tr('Mostrar ▾') : tr('Ocultar ▴')}</button>
              </div>
              {!shut.bins && (
                <>
                  <div className="twrap">
                    <table className="pallets binlist">
                      <thead><tr><th>{tr('Bin')}</th><th>{tr('Código')}</th><th>{tr('Lote')}</th><th className="num">{tr('Cantidad')}</th><th>{tr('N° de bin')}</th><th>{tr('Línea')}</th><th>{tr('Hora')}</th>{!rep.shift && <th>{tr('Turno')}</th>}<th>{tr('Registró')}</th><th></th></tr></thead>
                      <tbody>
                        {cut('bins', rep.bins).map((b) => (
                          <tr key={b.r.id + ':' + b.n}>
                            <td><b>{b.n}</b></td>
                            <td><b className="code">{b.r.code}</b><small className="binkind">{binWord(b.word)}</small></td>
                            <td className={rep.lot && b.lot === rep.lot ? 'hit' : ''}>{b.lot || '—'}</td>
                            <td className="num"><b>{b.qty != null ? fmtN(b.qty) : '—'}</b> {binWord(b.word)}</td>
                            <td>{b.ref || '—'}</td>
                            <td>{lineNameOf(s, b.r.lineId, b.r.line)}</td>
                            <td>{fmtTime(b.at)}</td>
                            {!rep.shift && <td>{b.shift}</td>}
                            <td>{b.by || '—'}</td>
                            <td>{can('fix') && canShift(who, spanShifts(rep.plan, b.r.startedAt, b.r.endedAt ?? now)) && <button type="button" className="lnk" onClick={() => setEditRun(b.r.id)}>{tr('Corregir')}</button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {moreBar('bins', rep.bins.length)}
                </>
              )}
            </>
          )}
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
          {secHead('runs', tr('Corridas'), rows.length, day.state === 'here' && can('fix') ? <button type="button" className="lnk sm" onClick={() => setAddingRun(true)}>{tr('+ Agregar registro')}</button> : null)}
          {!shut.runs && (
            <>
        <div className="twrap">
          <table>
            <thead><tr><th>{tr('Depto')}</th><th>{tr('Línea')}</th><th>{tr('Código')}</th><th>{tr('Lote')}</th>{!rep.shift && <th>{tr('Turno')}</th>}<th>{tr('Inicio')}</th><th>{tr('Fin')}</th><th>{tr('Hecho')}</th><th>Waste</th><th>{tr('Trabajando')}</th><th>{tr('Prom./unidad')}</th><th>{tr('Parado')}</th><th>Set up</th><th>{tr('Razones')}</th><th>{tr('Registró')}</th><th></th></tr></thead>
            <tbody>{cut('runs', rows).map((x) => (
              <tr key={x.r.id} className={x.r.endedAt ? '' : 'live'}>
                <td>{x.r.dept}</td><td>{lineNameOf(s, x.r.lineId, x.r.line)}</td><td><b>{x.r.code}</b></td><td>{x.lots}</td>{!rep.shift && <td>{x.shifts}</td>}<td>{fmtTime(x.r.startedAt)}</td><td>{x.r.endedAt ? fmtTime(x.r.endedAt) : <i>{tr('en curso')}</i>}</td>
                <td>{madeText(x.view, x.qty, true)}</td><td className={x.waste ? 'red' : ''}>{x.waste ? x.waste + ' lb' : '—'}</td><td>{fmtDur(x.st.working)}</td><td>{x.timed ? fmtDur(x.st.avg) : '—'}</td><td className={x.st.down ? 'red' : ''}>{fmtDur(x.st.down)}</td><td className={x.st.setup ? 'amber' : ''}>{x.st.setup ? fmtDur(x.st.setup) : '—'}</td><td>{reasonsText(x) || '—'}</td><td>{whoText(x.r)}</td>
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
                  <td>{fmtTime(x.u.at)}</td>{!rep.shift && <td>{x.shift}</td>}<td>{x.r.dept}</td><td>{lineNameOf(s, x.r.lineId, x.r.line)}</td><td><b>{x.r.code}</b></td><td>{x.lot}</td><td>{x.i + 1}</td><td>{cfgOf(x.r).unit}</td>
                  <td>{x.qty != null ? x.qty + ' ' + cfgOf(x.r).qtyUnit : '—'}{x.qty != null && CFG[x.r.dept].qtyUnit === 'pouches' && x.r.perUnit != null && x.qty < x.r.perUnit && !!inCases(s, x.r.code, x.qty) && <small> · {casesText(inCases(s, x.r.code, x.qty))}</small>}</td><td>{x.tag || '—'}</td>{withOrders && <td>{x.order || '—'}</td>}<td>{fmtDur(x.gap)}</td><td>{x.u.by || '—'}</td>
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
      {addingRun && <AddRunDialog s={s} date={date} dept={dept} onClose={() => setAddingRun(false)} onAdded={() => setAddingRun(false)} />}
      {stopToEdit && <StopEditor stop={stopToEdit} mgr={can('fix')} onClose={() => setEditStop(null)} />}
      {mgr && !viewOnly && (
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
