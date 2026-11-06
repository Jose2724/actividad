import { useRef, useState } from 'react'
import { ATT_SPOTS, attSpotId, attAccept, attAdd, attBack, attDecline, attDelete, attPeople, attSetCame, attWriteOn, attendanceOf, attExpectedOf, attLineText, attMoveLine, attOf, attRemove, attSetSup, attSetTemp, attSupOf, user, byLineName, DEPTS, fmtTime, setAttExpected, type AttEntry, type Dept, type State } from './store'
import { useWho } from './App'
import { DEPT_LOOK, deptVars } from './look'
import { tr } from './i18n'
import { RD } from './rd'
import { hourOnShift, seesLabor, workSpan } from './kpi'

/**
 * A room's attendance on the floor (Santiago, 2026-10-20: "que cada supervisor registre las personas ... nombre o
 * números y según la cantidad muestre" expected, actual and % missing). The card says it at a glance; its window is
 * where the supervisor taps each person of the shift's list, or writes one who is not on it (a name or a number, Enter adds the next), takes one out who went to cover
 * another room or went home (the % is worked out again, and the person stays in the list, marked), or deletes one
 * written by mistake. The people expected are a fixed number per room and shift that the managers and the office
 * change here (store.ts, ATT_DEFAULT and setAttExpected).
 */
export const pctText = (x: number) => Math.round(x * 100) + '%'
/** a room's lines, in order (the removed ones out), and its places that are not a line (RTE's Runner, 2026-11-04) last */
export const roomLines = (s: State, dept: Dept) => [...s.lines.filter((l) => l.dept === dept && !l.deleted).sort(byLineName), ...(ATT_SPOTS[dept] ?? []).map((name) => ({ id: attSpotId(dept, name), dept, name, updatedAt: 0 }))]

export function AttendanceCard({ s, dept, date, shift, edit }: { s: State; dept: Dept; date: string; shift: 1 | 2; edit: boolean }) {
  const [open, setOpen] = useState(false)
  const r = attendanceOf(s, date, shift, [dept]).rows[0]
  return (
    <div className="att-card">
      <div className="att-line">
        <b>{tr('👥 Asistencia · Turno {0}', shift)}</b>
        <span className="att-n">{tr('{0} de {1}', r.actual, r.expected)}</span>
        <span className={'att-miss' + (r.pct >= 0.25 ? ' red' : r.miss ? ' amber' : ' ok')}>{r.miss ? (r.miss === 1 ? tr('falta 1 persona · {0}', pctText(r.pct)) : tr('faltan {0} personas · {1}', r.miss, pctText(r.pct))) : r.over ? tr('✓ completos (+{0})', r.over) : tr('✓ completos')}</span>
        {(() => { const n = attOf(s, date, dept, shift).filter((x) => !!x.via && !x.gone).length; return n > 0 ? <span className="att-arrive">{n === 1 ? tr('👋 1 llegó de otro cuarto · aceptar') : tr('👋 {0} llegaron de otro cuarto · aceptar', n)}</span> : null })()}
        <button type="button" className={'btn sm ' + (edit ? 'soft' : '')} onClick={() => setOpen(true)}>{edit ? tr('Anotar personas') : tr('Ver personas')}</button>
      </div>
      <div className="att-bar"><i style={{ width: Math.min(100, r.expected ? Math.round((r.actual / r.expected) * 100) : 0) + '%' }} /></div>
      {open && <AttendanceDialog s={s} dept={dept} date={date} shift={shift} edit={edit} onClose={() => setOpen(false)} />}
    </div>
  )
}

/**
 * Who another room sent here and nobody here took in yet (Jose, 2026-11-05: "hicieron un traslado pero ellos aún no lo
 * han confirmado. No es porque no quieren, es que no se han enterado ... un pop up card diciendo el nombre de la persona,
 * de dónde viene y que si lo quiere aceptar o cancelar y luego que le salga en qué línea ponerlo; esto último no es
 * mandatorio"). A card over the room's tablet, one person at a time: Aceptar takes them in (attAccept, on the line the
 * other room said, if any) and then offers the room's lines, which can be skipped; Cancelar asks once more and turns
 * them down (attDecline). It goes as soon as nobody is waiting, also when another tablet of the room answered
 */
export function ArrivalsDialog({ s, dept, date, shift }: { s: State; dept: Dept; date: string; shift: 1 | 2 }) {
  const [step, setStep] = useState<{ no: string } | { line: string } | null>(null)
  const here = attOf(s, date, dept, shift), lines = roomLines(s, dept)
  const pending = here.filter((x) => !!x.via && !x.gone)
  // just accepted: on which line (not mandatory)
  const placed = step && 'line' in step ? here.find((y) => !y.via && !y.gone && y.name === step.line) : undefined
  if (placed) {
    return (
      <div className="veil" role="dialog" aria-modal="true" aria-labelledby="arr-title">
        <div className="dlg attgate-dlg arr-dlg">
          <div className="attgate-ico" aria-hidden="true">✅</div>
          <h3 id="arr-title">{tr('{0} ya está en {1}', placed.name, dept)}</h3>
          <p>{tr('¿En qué línea lo pones?')} <small className="hint">{tr('No es obligatorio.')}</small></p>
          <div className="arr-lines">
            {lines.map((l) => placed.line === l.id
              ? <button key={l.id} type="button" className="btn primary" onClick={() => setStep(null)}>{'✓ ' + attLineText(s, l.id)}</button>
              : <button key={l.id} type="button" className="btn soft" onClick={() => { attMoveLine(placed.id, l.id); setStep(null) }}>{attLineText(s, l.id)}</button>)}
          </div>
          <button type="button" className="btn arr-skip" onClick={() => setStep(null)}>{placed.line ? tr('Dejarlo en {0}', attLineText(s, placed.line)) : tr('Sin línea por ahora')}</button>
        </div>
      </div>
    )
  }
  const asked = step && 'no' in step ? pending.find((x) => x.id === step.no) : undefined
  const x = asked ?? pending[0]
  if (!x) return null
  const src = (s.attendance ?? []).find((y) => y.id === x.via)
  const fromText = x.from + (src?.line ? ' · ' + attLineText(s, src.line) : '')
  return (
    <div className="veil" role="dialog" aria-modal="true" aria-labelledby="arr-title">
      <div className="dlg attgate-dlg arr-dlg">
        <div className="attgate-ico" aria-hidden="true">👋</div>
        <h3 id="arr-title">{asked ? tr('¿No aceptar a {0}?', x.name) : tr('Te mandaron a una persona')}</h3>
        {!asked && <div className="arr-name">{x.name}</div>}
        <p>{tr('Viene de {0}', fromText)}{x.line ? ' · ' + tr('lo mandaron a {0}', attLineText(s, x.line)) : ''}</p>
        <p className="arr-by">{tr('Lo mandó {0} a las {1}', x.by || '—', fmtTime(x.at))}</p>
        {asked
          ? <>
            <p className="att-pending">{tr('No va a contar en {0} y sale de su lista. En {1} sigue diciendo que lo mandaron aquí.', dept, x.from)}</p>
            <button type="button" className="btn stopbtn big" onClick={() => { attDecline(x.id); setStep(null) }}>{tr('✕ Sí, no aceptarlo')}</button>
            <button type="button" className="btn arr-skip" onClick={() => setStep(null)}>{tr('← Volver')}</button>
          </>
          : <>
            <p className="att-pending">{tr('No cuenta en este cuarto hasta que lo aceptes.')}</p>
            <button type="button" className="btn primary big" autoFocus onClick={() => { attAccept(x.id, x.line); setStep(lines.length ? { line: x.name } : null) }}>{tr('✓ Aceptar')}</button>
            <button type="button" className="btn arr-skip" onClick={() => setStep({ no: x.id })}>{tr('✕ Cancelar')}</button>
          </>}
        {pending.length > 1 && <small className="hint">{tr('{0} personas esperan que las acepten', pending.length)}</small>}
      </div>
    </div>
  )
}

type AttTab = 'list' | 'add' | 'wait' | 'gone'
/** a name as typed and as written, compared without accents, case or extra spaces ("juan  pérez" = "Juan Perez") */
const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * The room's attendance window (redesigned 2026-11-05, Jose: "esto es un caos y no se entiende nada ... que se vea
 * profesional, divisiones, quizás tab ... que se pueda buscar employee y diga si ya está agregado para que no agreguen
 * doble ... excelentemente responsive"). On top the shift and four tiles (expected, came, missing, supervisor); then
 * tabs: the people of the shift by line; writing people (one search box over the employee list and everybody already
 * written in any room, which says where a name already is); the people another room sent and nobody accepted yet; and
 * those who left. Each person's actions are behind one "Opciones" button. The same store functions as before.
 * `note` = why it opened by itself (the start of a code or a Set up, with the attendance still to write: 2026-10-27)
 */
export function AttendanceDialog({ s, dept, date, shift: inCourse, edit, note = '', onClose }: { s: State; dept: Dept; date: string; shift: 1 | 2; edit: boolean; note?: string; onClose: () => void }) {
  const who = useWho()
  const boss = !!who.admin || who.role === 'mgr' || who.role === 'office'
  const [shift, setShift] = useState<1 | 2>(inCourse)
  const [name, setName] = useState('')
  const [twice, setTwice] = useState('')
  // the person being acted on: their options open, taken out (home, by mistake), moved (to another line here, or another
  // room and its line), or the hour they really came written (2026-10-29: the labor hours count from it)
  const [out, setOut] = useState<{ id: string; mode: 'menu' | 'out' | 'move' | 'came'; to?: Dept } | null>(null)
  const [cameHm, setCameHm] = useState('')
  const lines = roomLines(s, dept)
  const [addLine, setAddLine] = useState('')
  // a temp (agency) worker (2026-10-22, the Daily KPI: "who shows up ... especially TEMPS"): kept for the next one written
  const [addTemp, setAddTemp] = useState(false)
  // the room's supervisor or leader, written as such (2026-10-27): a choice for whoever is typed, and one tap for oneself
  const [addSup, setAddSup] = useState(false)
  const sup = attSupOf(s, date, dept, shift), me = user.get().trim()
  const labor = seesLabor(s, !!who.admin, me)
  // the hour written counts as the hour they came (Ajustes): then "llegó a la hora del turno" is written as the shift's start
  const writeIsCame = attWriteOn(s)
  const [said, setSaid] = useState('')
  const [editingN, setEditingN] = useState<string | null>(null)
  const [find, setFind] = useState('') // a search over the people of the shift (tab "En el turno")
  const box = useRef<HTMLInputElement>(null)
  const list = attOf(s, date, dept, shift), here = list.filter((x) => !x.gone && !x.via), gone = list.filter((x) => !!x.gone)
  const waiting = list.filter((x) => !!x.via && !x.gone)
  const [tabWanted, setTab] = useState<AttTab>(() => (edit && (note || !here.length) ? 'add' : 'list'))
  const tab: AttTab = (tabWanted === 'add' && !edit) || (tabWanted === 'wait' && !waiting.length) || (tabWanted === 'gone' && !gone.length) ? 'list' : tabWanted
  const pickTab = (t: AttTab) => { setTab(t); setOut(null); setSaid(''); setTwice('') }
  const r = attendanceOf(s, date, shift, [dept]).rows[0]
  const meIn = !!me && list.some((x) => !x.gone && norm(x.name) === norm(me))
  const lineOk = (l: string) => (lines.some((y) => y.id === l) ? l : '')
  // where a name is already written this shift in another room (not gone): to be moved from there, not written twice
  const elsewhere = new Map<string, { d: Dept; name: string }>()
  for (const d of DEPTS) if (d !== dept) for (const x of attOf(s, date, d, shift)) if (!x.gone && !x.via) elsewhere.set(norm(x.name), { d, name: x.name })
  const done = (n: string, msg = '') => { setName(''); setTwice(''); setSaid(msg || tr('✓ {0} anotado.', n)); box.current?.focus() }
  const addMe = () => {
    if (!me || !attAdd(date, dept, shift, me, '', lineOk(addLine), false, true)) return
    done(me, tr('{0} quedó anotado como supervisor del turno.', me))
  }
  const add = () => {
    const n = name.trim()
    if (!n) return
    const there = elsewhere.get(norm(n))
    if (there) { setTwice(tr('{0} ya está anotado en {1}. Si vino aquí, trasládalo desde {1}.', n, there.d)); return }
    if (!attAdd(date, dept, shift, n, '', lineOk(addLine), addTemp, addSup)) { setTwice(tr('{0} ya está anotado en este turno.', n)); return }
    setAddSup(false)
    done(n)
  }
  // a name tapped from the shift's list (Santiago, 2026-11-01): a supervisor or lead of the list is written as such
  const pick = attPeople(s, date, dept, shift, name)
  const tap = (p: { name: string; lead?: boolean }) => {
    if (!attAdd(date, dept, shift, p.name, '', lineOk(addLine), addTemp, !!p.lead || addSup)) { setTwice(tr('{0} ya está anotado en este turno.', p.name)); return }
    setAddSup(false)
    done(p.name)
  }
  const onTime = (x: AttEntry) => {
    attSetCame(x.id, writeIsCame ? workSpan(s, x.date, x.dept, x.shift).from : null)
    setOut(null)
    setSaid(tr('{0}: llegó a la hora del turno.', x.name))
  }
  // gone to another room: they show up there by themselves ("viene de"), on the line chosen; nobody there has to write them
  const take = (x: AttEntry, why: 'otro' | 'casa', to: Dept | '' = '', toLine = '') => {
    attRemove(x.id, why, to, false, toLine)
    setOut(null)
    setSaid(why === 'casa' ? tr('{0} salió: se fue a su casa.', x.name) : tr('{0} pasó a {1}: ya aparece en la lista de {2}.', x.name, to + (toLine ? ' · ' + attLineText(s, toLine) : ''), to))
  }
  const move = (x: AttEntry, line: string) => {
    attMoveLine(x.id, line)
    setOut(null)
    setSaid(tr('{0} pasó a {1}.', x.name, attLineText(s, line) || tr('sin línea')))
  }
  const saveCame = (x: AttEntry) => {
    const at = hourOnShift(s, x, cameHm)
    if (at == null) return
    attSetCame(x.id, at)
    setOut(null)
    setSaid(tr('{0} llegó a las {1}: sus horas cuentan desde ahí.', x.name, fmtTime(at)))
  }
  const goneText = (x: AttEntry) => (x.gone?.why === 'casa' ? tr('se fue a su casa') : tr('pasó a {0}', (x.gone?.to || tr('otro cuarto')) + (x.gone?.line ? ' · ' + attLineText(s, x.gone.line) : ''))) + ' · ' + fmtTime(x.gone?.at ?? 0)
  // the people here, by line (the room's lines in order, then those on no line in particular), narrowed by the search
  const fk = norm(find)
  const shown = fk ? here.filter((x) => norm(x.name).includes(fk)) : here
  // the redesign: a person's options open with that person alone in view, the list one tap back (Jose, 2026-11-05:
  // "sería bueno solo ver a María y evitar hacer scroll")
  const focus = RD && out ? here.find((x) => x.id === out.id) : undefined
  const groups = [...lines.map((l) => ({ id: l.id, name: attLineText(s, l.id), people: (focus ? [focus] : shown).filter((x) => x.line === l.id) })), { id: '', name: tr('Sin línea'), people: (focus ? [focus] : shown).filter((x) => !lineOk(x.line)) }].filter((g) => g.people.length > 0)
  // what the search of "Anotar" finds: already here, already in another room, the employee list, or a new name to write
  const q = name.trim(), qk = norm(q)
  const foundHere = qk ? list.filter((x) => !x.gone && norm(x.name).includes(qk)) : []
  const rosterNames = new Set([...pick.mine, ...pick.others].map((p) => norm(p.name)))
  const foundThere = qk ? [...elsewhere].filter(([k]) => k.includes(qk) && !rosterNames.has(k)) : []
  const exactHere = !!qk && list.some((x) => !x.gone && norm(x.name) === qk), exactThere = elsewhere.has(qk)
  const tabs: { t: AttTab; label: string; n?: number; hot?: boolean }[] = [
    { t: 'list', label: tr('👥 En el turno'), n: here.length },
    ...(edit ? [{ t: 'add' as const, label: tr('➕ Anotar') }] : []),
    ...(waiting.length ? [{ t: 'wait' as const, label: tr('👋 Por aceptar'), n: waiting.length, hot: true }] : []),
    ...(gone.length ? [{ t: 'gone' as const, label: tr('↩ Salieron'), n: gone.length }] : []),
  ]
  const badges = (x: AttEntry) => (
    <span className="atw-badges">
      {x.sup && <span className="atw-badge sup">{tr('Supervisor')}</span>}
      {x.temp && <span className="atw-badge temp">{tr('Temporal')}</span>}
      {x.from && <span className="atw-badge from">{tr('viene de {0}', x.from)}</span>}
      {x.moves.length > 0 && <span className="atw-badge">{tr('antes en {0}', attLineText(s, x.moves[x.moves.length - 1].from) || tr('sin línea'))}</span>}
    </span>
  )
  const back = (x: AttEntry) => <button type="button" className="btn" onClick={() => setOut({ id: x.id, mode: 'menu' })}>{tr('← Atrás')}</button>
  return (
    <div className="veil atw-veil" onClick={onClose}>
      <div className={"dlg atw" + (focus ? " atw-focus" : "")} role="dialog" aria-modal="true" aria-labelledby="atw-title" onClick={(e) => e.stopPropagation()} style={deptVars(dept)}>
        <div className="atw-top">
          <div className="atw-head">
            <h3 id="atw-title">{tr('Asistencia · {0} {1}', DEPT_LOOK[dept].emoji, dept)}</h3>
            <div className="seg atw-shifts" role="group" aria-label={tr('Turno')}>{([1, 2] as const).map((k) => <button key={k} type="button" className={shift === k ? 'on' : ''} aria-pressed={shift === k} onClick={() => { setShift(k); setOut(null); setSaid(''); setTwice('') }}>{tr('Turno {0}', k)}{k === inCourse && <small>{tr('en curso')}</small>}</button>)}</div>
          </div>
          {note && <p className="atw-note">{note}</p>}
          <div className="atw-stats">
            <div className="atw-stat"><label>{tr('Esperados')}</label>{editingN != null ? (
              <form className="atw-exp" onSubmit={(e) => { e.preventDefault(); const n = Number(editingN); if (n >= 0) setAttExpected(dept, shift, n); setEditingN(null) }}>
                <input value={editingN} inputMode="numeric" autoFocus aria-label={tr('Esperados')} onChange={(e) => setEditingN(e.target.value.replace(/\D/g, ''))} /><button type="submit" className="btn sm primary">{tr('Guardar')}</button>
              </form>
            ) : <b>{r.expected}{boss && edit && <button type="button" className="btn xs atw-editn" aria-label={tr('Cambiar')} title={tr('Cambiar')} onClick={() => setEditingN(String(attExpectedOf(s, dept, shift)))}>✎<span> {tr('Cambiar')}</span></button>}</b>}</div>
            <div className="atw-stat"><label>{tr('Vinieron')}</label><b>{r.actual}</b></div>
            <div className={'atw-stat ' + (r.miss ? 'miss' : 'ok')}><label>{r.miss ? tr('Faltan') : tr('Completos')}</label><b>{r.miss ? r.miss : '✓'}<small>{r.miss ? pctText(r.pct) : r.over ? tr('+{0} de más', r.over) : ''}</small></b></div>
            {/* the shift's supervisor(s) (Jose, 2026-10-28: "que ponga en el lugar de supervisor los nombres"): taken off with ✕, another one picked from the people written */}
            <div className="atw-stat sup"><label>{tr('Supervisor')}</label>
              <div className="atw-supnames">{here.filter((x) => x.sup).map((x) => <span key={x.id} className="atw-supname">👤 {x.name}{edit && <button type="button" className="atw-unsup" onClick={() => attSetSup(x.id, false)} aria-label={tr('Quitar a {0} como supervisor', x.name)} title={tr('Quitar a {0} como supervisor', x.name)}>✕</button>}</span>)}{!sup && <span className="muted">{tr('nadie todavía')}</span>}</div>
              {edit && here.some((x) => !x.sup) && <select value="" aria-label={tr('Supervisor')} onChange={(e) => { if (e.target.value) attSetSup(e.target.value, true) }}><option value="">{sup ? tr('Otro supervisor…') : tr('Elegir de los anotados…')}</option>{here.filter((x) => !x.sup).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
            </div>
          </div>
          <div className="atw-tabs" role="tablist" aria-label={tr('Partes de la asistencia')}>
            {tabs.map((x) => <button key={x.t} type="button" role="tab" aria-selected={tab === x.t} className={'atw-tab' + (tab === x.t ? ' on' : '') + (x.hot ? ' hot' : '')} onClick={() => pickTab(x.t)}><span>{x.label}</span>{x.n != null && <span className="n">{x.n}</span>}</button>)}
          </div>
        </div>
        <div className="atw-body">
          {(said || twice) && <p className={'atw-msg' + (twice ? ' warn' : '')} role="status">{twice || said}</p>}
          {tab === 'list' && (
            <>
              {waiting.length > 0 && edit && <button type="button" className="atw-waitbar" onClick={() => pickTab('wait')}><span>{waiting.length === 1 ? tr('👋 1 persona de otro cuarto espera que la aceptes') : tr('👋 {0} personas de otro cuarto esperan que las aceptes', waiting.length)}</span><b>{tr('Ver ›')}</b></button>}
              {here.length > 6 && <input className="atw-find" type="search" value={find} placeholder={tr('🔍 Buscar en la lista del turno')} aria-label={tr('Buscar en la lista del turno')} onChange={(e) => setFind(e.target.value)} />}
              {!here.length ? (
                <div className="atw-empty"><p>{tr('Nadie anotado todavía en este turno.')}</p>{edit && <button type="button" className="btn primary" onClick={() => pickTab('add')}>{tr('➕ Anotar personas')}</button>}</div>
              ) : !groups.length ? <p className="hint">{tr('Nadie con ese nombre en la lista del turno.')}</p> : (
                <div className="atw-groups">
                  {focus && <button type="button" className="btn atw-backlist" onClick={() => setOut(null)}>{tr('‹ Volver a la lista')}</button>}
                  {groups.map((g) => (
                    <section key={g.id || '-'} className="atw-group">
                      <h4>{g.name}<span className="n">{g.people.length}</span></h4>
                      <ul>
                        {g.people.map((x) => (
                          <li key={x.id} className={'atw-person' + (out?.id === x.id ? ' open' : '')}>
                            <div className="atw-prow">
                              <div className="atw-pname"><b>{x.name}</b>{badges(x)}</div>
                              <div className="atw-ptime"><small>{fmtTime(x.at)}</small>{labor && x.came && <small className="atw-came">{tr('llegó {0}', fmtTime(x.came))}</small>}</div>
                              {edit && <button type="button" className={'btn sm atw-optbtn' + (out?.id === x.id ? ' primary' : '')} aria-expanded={out?.id === x.id} onClick={() => { setOut(out?.id === x.id ? null : { id: x.id, mode: 'menu' }); setSaid(''); setTwice('') }}>{out?.id === x.id ? tr('Cerrar') : tr('Opciones ▾')}</button>}
                            </div>
                            {out?.id === x.id && out.mode === 'menu' && (
                              <div className="atw-panel">
                                <div className="atw-grid">
                                  <button type="button" className="btn soft" onClick={() => setOut({ id: x.id, mode: 'move' })}>{tr('⇄ Trasladar')}</button>
                                  <button type="button" className="btn stopbtn" onClick={() => setOut({ id: x.id, mode: 'out' })}>{tr('✕ Sacar')}</button>
                                  {!x.sup && <button type="button" className="btn" onClick={() => { attSetSup(x.id, true); setOut(null); setSaid(tr('{0} es el supervisor del turno.', x.name)) }}>{tr('👤 Es supervisor')}</button>}
                                  {/* the company has no agency people (Jose, 2026-11-05): the redesign only undoes one marked before */}
                                  {(!RD || x.temp) && <button type="button" className="btn" onClick={() => { attSetTemp(x.id, !x.temp); setOut(null) }}>{x.temp ? tr('No es temporal') : tr('Es temporal')}</button>}
                                  {labor && <button type="button" className="btn" onClick={() => { setOut({ id: x.id, mode: 'came' }); setCameHm('') }}>{x.came || writeIsCame ? tr('🕐 Cambiar la hora de llegada') : tr('🕐 Llegó tarde')}</button>}
                                </div>
                              </div>
                            )}
                            {out?.id === x.id && out.mode === 'came' && (
                              <form className="atw-panel" onSubmit={(e) => { e.preventDefault(); saveCame(x) }}>
                                <p className="atw-q">{tr('¿A qué hora llegó {0}?', x.name)}</p>
                                <div className="atw-grid">
                                  <input type="time" value={cameHm} aria-label={tr('¿A qué hora llegó {0}?', x.name)} onChange={(e) => setCameHm(e.target.value)} />
                                  <button type="submit" className="btn primary" disabled={hourOnShift(s, x, cameHm) == null}>{tr('Guardar')}</button>
                                  {(x.came || writeIsCame) && <button type="button" className="btn soft" onClick={() => onTime(x)}>{tr('Llegó a la hora del turno')}</button>}
                                </div>
                                {back(x)}
                              </form>
                            )}
                            {out?.id === x.id && out.mode === 'out' && (
                              <div className="atw-panel">
                                <p className="atw-q">{tr('¿Por qué sale {0}?', x.name)}</p>
                                <div className="atw-grid">
                                  <button type="button" className="btn soft" onClick={() => take(x, 'casa')}>{tr('Se fue a su casa')}</button>
                                  <button type="button" className="btn danger" onClick={() => { attDelete(x.id); setOut(null); setSaid(tr('{0} se quitó: estaba anotado por error.', x.name)) }}>{tr('Anotado por error')}</button>
                                </div>
                                {back(x)}
                              </div>
                            )}
                            {out?.id === x.id && out.mode === 'move' && !out.to && (
                              <div className="atw-panel">
                                <p className="atw-q">{tr('¿A dónde pasa {0}?', x.name)}</p>
                                {lines.length > 0 && <><small className="atw-sub">{tr('Otra línea de {0}:', dept)}</small><div className="atw-grid">{[...lines.map((l) => l.id), ''].filter((l) => l !== lineOk(x.line)).map((l) => <button key={l || '-'} type="button" className="btn soft" onClick={() => move(x, l)}>{attLineText(s, l) || tr('Sin línea')}</button>)}</div></>}
                                <small className="atw-sub">{tr('Otro cuarto:')}</small>
                                <div className="atw-grid">{DEPTS.filter((d) => d !== dept).map((d) => <button key={d} type="button" className="btn soft" onClick={() => (roomLines(s, d).length ? setOut({ id: x.id, mode: 'move', to: d }) : take(x, 'otro', d))}>{DEPT_LOOK[d].emoji} {d}</button>)}</div>
                                {back(x)}
                              </div>
                            )}
                            {out?.id === x.id && out.mode === 'move' && out.to && (
                              <div className="atw-panel">
                                <p className="atw-q">{tr('¿A qué línea de {0} pasa {1}?', out.to, x.name)}</p>
                                <div className="atw-grid">
                                  {roomLines(s, out.to).map((l) => <button key={l.id} type="button" className="btn soft" onClick={() => take(x, 'otro', out.to, l.id)}>{attLineText(s, l.id)}</button>)}
                                  <button type="button" className="btn soft" onClick={() => take(x, 'otro', out.to)}>{tr('Sin línea / no sé')}</button>
                                </div>
                                <button type="button" className="btn" onClick={() => setOut({ id: x.id, mode: 'move' })}>{tr('← Atrás')}</button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
          {tab === 'add' && edit && (
            <div className="atw-add">
              {!sup && !meIn && !!me && <div className="atw-me"><span>{tr('El supervisor o líder del cuarto se anota primero, como supervisor.')}</span><button type="button" className="btn primary" onClick={addMe}>{tr('👤 Anotarme como supervisor: {0}', me)}</button></div>}
              <form className="atw-search" onSubmit={(e) => { e.preventDefault(); add() }}>
                <input ref={box} type="search" value={name} maxLength={60} placeholder={tr('🔍 Buscar o escribir el nombre o número')} autoComplete="off" aria-label={tr('Buscar o escribir el nombre o número')} onChange={(e) => { setName(e.target.value); setTwice(''); setSaid('') }} />
              </form>
              <div className="atw-opts">
                {lines.length > 0 && <label className="atw-opt"><span>{tr('Línea')}</span><select value={addLine} onChange={(e) => setAddLine(e.target.value)}><option value="">{tr('Sin línea')}</option>{lines.map((l) => <option key={l.id} value={l.id}>{attLineText(s, l.id)}</option>)}</select></label>}
                <div className="atw-opt kind"><span>{tr('Es')}</span><div className="seg atw-kind" role="group" aria-label={tr('Es')}>
                  <button type="button" className={!addTemp && !addSup ? 'on' : ''} aria-pressed={!addTemp && !addSup} onClick={() => { setAddTemp(false); setAddSup(false) }}>{tr('De la compañía')}</button>
                  {!RD && <button type="button" className={addTemp ? 'on' : ''} aria-pressed={addTemp} onClick={() => { setAddTemp(true); setAddSup(false) }}>{tr('Temporal (agencia)')}</button>}
                  <button type="button" className={addSup ? 'on' : ''} aria-pressed={addSup} onClick={() => { setAddSup(true); setAddTemp(false) }}>{tr('Supervisor o líder')}</button>
                </div></div>
              </div>
              {qk && (
                <div className="atw-found">
                  {foundHere.map((x) => <div key={x.id} className="atw-hit here"><b>{x.name}</b><span>{x.via ? tr('✓ Ya está en {0} · falta aceptarlo', dept) : tr('✓ Ya está anotado aquí') + (lineOk(x.line) ? ' · ' + attLineText(s, x.line) : '')}</span></div>)}
                  {foundThere.map(([k, x]) => <div key={k} className="atw-hit there"><b>{x.name}</b><span>{tr('Ya está anotado en {0}', x.d)}</span></div>)}
                </div>
              )}
              {pick.loaded && (
                <>
                  {(pick.mine.length > 0 || pick.others.length > 0) && <h4 className="atw-h">{qk ? tr('En la lista de empleados') : tr('Toca a quien vino · {0} en la lista', pick.mine.length)}</h4>}
                  {!qk && !pick.mine.length && <p className="hint ok">{tr('✓ Ya están anotados todos los de la lista.')}</p>}
                  <div className="atw-names">
                    {pick.mine.map((p) => <button key={p.name} type="button" className="btn soft" disabled={!!p.in} onClick={() => tap(p)}><span>{p.name}</span>{p.in && <small>{tr('ya en {0}', p.in)}</small>}</button>)}
                    {pick.others.map((p) => <button key={p.name} type="button" className="btn" disabled={!!p.in} onClick={() => tap(p)}><span>{p.name}</span><small>{p.in ? tr('ya en {0}', p.in) : tr('de otro cuarto')}</small></button>)}
                  </div>
                </>
              )}
              {/* a name that is not on the employee list (or the list is off): written as typed, last, so a few letters typed to search are not written by mistake */}
              {qk && !exactHere && !exactThere && <button type="button" className={'btn atw-addbtn ' + (pick.loaded && (pick.mine.length || pick.others.length) ? 'soft' : 'primary')} onClick={add}>{pick.loaded ? tr('+ Anotar “{0}” (no está en la lista)', q) : tr('+ Anotar “{0}”', q)}</button>}
              {!pick.loaded && !qk && <p className="hint">{tr('Escribe el nombre o número y toca Anotar (o Enter). Si ya está anotado, aquí te lo dice.')}</p>}
            </div>
          )}
          {/* people another room sent here, not yet taken in (2026-10-28): the room accepts them on a line or none, or not */}
          {tab === 'wait' && (
            <div className="atw-cards">
              {waiting.map((x) => {
                const src = (s.attendance ?? []).find((y) => y.id === x.via)
                return (
                  <div key={x.id} className="atw-wait">
                    <div className="atw-pname"><b>{x.name}</b><span className="atw-badges"><span className="atw-badge from">{tr('viene de {0}', x.from + (src?.line ? ' · ' + attLineText(s, src.line) : ''))}</span>{x.line && <span className="atw-badge">{tr('lo mandaron a {0}', attLineText(s, x.line))}</span>}</span></div>
                    <small>{tr('Lo mandó {0} a las {1}', x.by || '—', fmtTime(x.at))} · <span className="att-pending">{tr('No cuenta en este cuarto hasta que lo aceptes.')}</span></small>
                    {edit && <>
                      {lines.length > 0 && <small className="atw-sub">{tr('Aceptar en:')}</small>}
                      <div className="atw-grid">
                        {lines.map((l) => <button key={l.id} type="button" className={'btn ' + (x.line === l.id ? 'primary' : 'soft')} onClick={() => { attAccept(x.id, l.id); setSaid(tr('{0} aceptado en {1}.', x.name, attLineText(s, l.id))) }}>{attLineText(s, l.id)}</button>)}
                        <button type="button" className="btn soft" onClick={() => { attAccept(x.id, ''); setSaid(tr('{0} aceptado, sin línea.', x.name)) }}>{tr('Aceptar sin línea')}</button>
                      </div>
                      <button type="button" className="btn atw-no" onClick={() => { attDecline(x.id); setSaid(tr('{0} no fue aceptado: no cuenta en {1}.', x.name, dept)) }}>{tr('✕ No aceptar')}</button>
                    </>}
                  </div>
                )
              })}
            </div>
          )}
          {tab === 'gone' && (
            <>
              <p className="hint">{tr('Salieron del cuarto en este turno: no cuentan aquí.')}</p>
              <ul className="atw-gone">{gone.map((x) => <li key={x.id}><div className="atw-pname"><b>{x.name}</b><small>{goneText(x)}</small></div>{edit && <button type="button" className="btn sm" onClick={() => attBack(x.id)}>{tr('↶ Deshacer')}</button>}</li>)}</ul>
            </>
          )}
        </div>
        <div className="dbtns atw-foot"><button type="button" className="btn primary" onClick={onClose}>{tr('Listo')}</button></div>
      </div>
    </div>
  )
}
