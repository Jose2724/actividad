import { useState, useSyncExternalStore } from 'react'
import { type ViewOpt, byLineName, CFG, dayShiftsText, DEPTS, lineLabel, lotFor, managerPin, nightText, openRun, removedLines, removeLine, reset, resetRecords, restoreLine, setDayShifts, setLineRules, setProgramView, setReasonCodes, shiftGoalOf, shiftHours, shiftSpan, shiftsOf, turnOf, uploadAll, weekOf, type Dept, type Line, type State, type WorkDay, setViewOpt } from './store'
import { ConfirmDialog, LangSwitch, LineNameDialog, longDate, NoticeDialog, Products, QrLink, ShiftsDialog, StartDayDialog, StopDialog, TargetDialog, useCan, useWho } from './App'
import { Employees } from './Employees'
import { Devices } from './DevicesView'
import { supabase } from './supabase'
import { syncStore } from './sync'
import { consumeOn, setConsumeOn } from './store'
import { cartCratesOf, setAllCartCrates, setCartCrates } from './store'
import { ATT_DEFAULT, attExpectedOf, attShifts, clearShiftMark, plantCut, roomMark, setAttExpected, setAttGate, setAttView, setShiftMark, setWeightRule, weightRuleOf } from './store'
import { BUILD } from './update'
import { clockOffText, clockState } from './clock'
import { fmtTime } from './clock-fmt'
import { tr } from './i18n'
import { CodeList } from './CodePicker'
import { OTHER_CODE, REASON_CODES, SETUP_CODE } from './reasons'
import { trx } from './trx'

/**
 * Ajustes: everything the plant sets once and reads later, in one place, each thing in its own section (Jose,
 * 2026-10-17: "una pestaña de ajustes diseñada profesionalmente"). The sections a person sees are the ones their
 * powers allow; the last one, this device, is everybody's. The dialogs that do the work are the same ones the floor
 * and the report already use, so one rule holds everywhere.
 */
export type SettingsKey = 'shifts' | 'day' | 'lines' | 'stops' | 'program' | 'attendance' | 'weights' | 'consumo' | 'products' | 'goals' | 'people' | 'devices' | 'device'
const fmtN = (x: number) => Math.round(x).toLocaleString('en-US')

export function settingsSections(can: (p: 'shifts' | 'day' | 'products' | 'goals' | 'people') => boolean, mgr: boolean, viewOnly: boolean, admin = false, attOn = false): { key: SettingsKey; title: string; sub: string }[] {
  return [
    ...(can('shifts') ? [{ key: 'shifts' as const, title: tr('Turnos y calendario'), sub: tr('horas, semana, días aparte') }] : []),
    ...(can('day') ? [{ key: 'day' as const, title: tr('Día de trabajo'), sub: tr('fecha, hora de inicio, lote') }] : []),
    ...(mgr && !viewOnly ? [{ key: 'lines' as const, title: tr('Líneas'), sub: tr('las líneas de cada cuarto') }] : []),
    // (whoever only looks sees the list and whether it is on, without the switch)
    ...(mgr ? [{ key: 'stops' as const, title: tr('Códigos de paro'), sub: tr('Reason Codes: prender o apagar') }] : []),
    ...(mgr ? [{ key: 'weights' as const, title: tr('Pesos'), sub: tr('cada cuánto se pesa y cuántos') }] : []),
    ...(mgr ? [{ key: 'consumo' as const, title: tr('Consumo'), sub: tr('pesar lo que entra antes de empezar') }] : []),
    ...(mgr && (admin || attOn) ? [{ key: 'attendance' as const, title: tr('Asistencia'), sub: tr('personas esperadas por cuarto y turno') }] : []),
    ...(admin ? [{ key: 'program' as const, title: tr('Pestañas nuevas'), sub: tr('Programa, Lotes, Flujo: solo tú o todos') }] : []),
    ...(can('products') || viewOnly ? [{ key: 'products' as const, title: tr('Productos'), sub: tr('la tabla maestra') }] : []),
    ...(can('goals') ? [{ key: 'goals' as const, title: tr('Metas'), sub: tr('por turno y por cuarto') }] : []),
    ...(can('people') && supabase ? [{ key: 'people' as const, title: tr('Empleados'), sub: tr('cuentas, roles y permisos') }] : []),
    ...(mgr && !viewOnly && supabase ? [{ key: 'devices' as const, title: tr('Tablets'), sub: tr('qué aparato está en qué') }] : []),
    { key: 'device' as const, title: tr('Este aparato'), sub: tr('idioma, versión, salir') },
  ]
}

export function Settings({ s, now, day, name, home, mgr, admin, viewOnly, meId, section, onSection, onLeave }: { s: State; now: number; day: WorkDay; name: string; home: Dept; mgr: boolean; admin: boolean; viewOnly: boolean; meId: string; section: SettingsKey; onSection: (k: SettingsKey) => void; onLeave: () => void }) {
  const can = useCan()
  const items = settingsSections(can, mgr, viewOnly, admin, s.attView.on)
  const sec: SettingsKey = items.some((i) => i.key === section) ? section : items[0].key
  return (
    <div className="settings">
      <nav className="setnav" aria-label={tr('Ajustes')}>
        {items.map((it) => <button key={it.key} type="button" className={'setitem' + (sec === it.key ? ' on' : '')} aria-pressed={sec === it.key} onClick={() => onSection(it.key)}><b>{it.title}</b><small>{it.sub}</small></button>)}
      </nav>
      <section className="setpane">
        {sec === 'shifts' && <ShiftsSettings s={s} day={day} />}
        {sec === 'day' && <DaySettings s={s} now={now} day={day} />}
        {sec === 'lines' && <LinesSettings s={s} />}
        {sec === 'stops' && <StopCodesSettings s={s} viewOnly={viewOnly} />}
        {sec === 'program' && <><ProgramViewSettings s={s} /><ViewOptSettings s={s} name="lotes" /><ViewOptSettings s={s} name="flujo" /></>}
        {sec === 'weights' && <WeightSettings s={s} viewOnly={viewOnly} />}
        {sec === 'consumo' && <ConsumeSettings s={s} viewOnly={viewOnly} />}
        {sec === 'attendance' && <AttendanceSettings s={s} date={day.date} viewOnly={viewOnly} admin={admin} />}
        {sec === 'products' && <CartCratesSettings s={s} readOnly={!can('products')} />}
        {sec === 'products' && <div className="setcard wide"><div className="sethead"><h3>{tr('Productos')}</h3></div><p className="hint">{tr('La tabla maestra de la oficina: con ella las mezclas se vuelven pouches, cajas y pallets esperados, y cada cuarto sabe cuánto lleva un carro, un pallet o una caja.')}</p><Products s={s} readOnly={!can('products')} /></div>}
        {sec === 'goals' && <GoalsSettings s={s} now={now} day={day} />}
        {sec === 'people' && <Employees meId={meId} admin={admin} />}
        {sec === 'devices' && <Devices now={now} />}
        {sec === 'device' && <DeviceSettings now={now} name={name} home={home} mgr={mgr} viewOnly={viewOnly} onLeave={onLeave} />}
      </section>
    </div>
  )
}

/** a fact of the plant with its name, in a card's grid */
const Fact = ({ label, value, note }: { label: string; value: string; note?: string }) => <div className="setfact"><label>{label}</label><b>{value}</b>{note && <small>{note}</small>}</div>

/** the hours of the shifts, the week, the days apart from it, and the versions kept */
function ShiftsSettings({ s, day }: { s: State; day: WorkDay }) {
  const plan = shiftsOf(s, day.date), week = weekOf(s, day.date)
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState(day.date)
  const [said, setSaid] = useState('')
  const names = [tr('dom'), tr('lun'), tr('mar'), tr('mié'), tr('jue'), tr('vie'), tr('sáb')]
  const apart = [...s.dayShifts].sort((a, b) => (a.date < b.date ? 1 : -1))
  const mark = (only: 1 | 2 | 3) => { if (date && setDayShifts(date, only)) setSaid(tr('✓ {0}: {1}', longDate(date), dayShiftsText(only))) }
  return (
    <>
      <div className="setcard">
        <div className="sethead"><h3>{tr('Horario de los turnos')}</h3><button type="button" className="btn primary" onClick={() => setEditing(true)}>{tr('✎ Cambiar horario y semana')}</button></div>
        <p className="hint">{tr('Cada registro cuenta para el turno en cuyas horas se hizo; el corte es la mitad del rato entre un turno y el otro. Cada versión vale desde una fecha: los días anteriores se leen con el horario que tenían.')}</p>
        <div className="setfacts">
          <Fact label={tr('Turno 1')} value={tr('{0} a {1}', ...shiftSpan(plan, 1))} />
          <Fact label={tr('Turno 2')} value={tr('{0} a {1}', ...shiftSpan(plan, 2))} />
          <Fact label={tr('Corte de la noche')} value={nightText(s, day.date)} note={tr('ahí empieza el día de trabajo')} />
          <Fact label={tr('Vale desde')} value={plan.from ? longDate(plan.from) : tr('siempre')} />
        </div>
      </div>
      <div className="setcard">
        <div className="sethead"><h3>{tr('Qué turnos trabajan cada día de la semana')}</h3></div>
        <div className="weekview">{names.map((n, i) => <div key={i} className={'wkday' + (week.charAt(i) !== '3' ? ' one' : '')}><small>{n}</small><b>{week.charAt(i) === '3' ? tr('1 y 2') : tr('Solo {0}', week.charAt(i))}</b></div>)}</div>
      </div>
      <div className="setcard">
        <div className="sethead"><h3>{tr('Días aparte de su semana')}</h3></div>
        <p className="hint">{tr('Un sábado en que solo vino un turno, un domingo de un turno, o un día de dos turnos que no suele tenerlos. Con un solo turno, todo lo del día es de ese turno, empiece a la hora que empiece (no hace falta poner horas), y su tiempo no se corta entre turnos; nada se reescribe, se recalcula.')}</p>
        <div className="setrow add">
          <label>{tr('Día')}{' '}<input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSaid('') }} /></label>
          <div className="btns">
            <button type="button" className="btn" onClick={() => mark(1)}>{tr('Solo turno 1')}</button>
            <button type="button" className="btn" onClick={() => mark(2)}>{tr('Solo turno 2')}</button>
            <button type="button" className="btn" onClick={() => mark(3)}>{tr('Los dos')}</button>
          </div>
        </div>
        {said && <p className="hint ok">{said}</p>}
        {apart.length === 0 ? <p className="hint">{tr('Ningún día aparte: todos van como su semana.')}</p> : apart.map((x) => (
          <div key={x.date} className="setrow">
            <span><b>{longDate(x.date)}</b> · {dayShiftsText(x.only)}</span>
            <button type="button" className="lnk" onClick={() => { if (setDayShifts(x.date, null)) setSaid(tr('✓ {0}: {1}', longDate(x.date), tr('como su semana'))) }}>{tr('Quitar')}</button>
          </div>
        ))}
      </div>
      {s.shifts.length > 0 && (
        <div className="setcard">
          <div className="sethead"><h3>{tr('Versiones del horario')}</h3></div>
          {[...s.shifts].sort((a, b) => (a.from < b.from ? 1 : -1)).map((x) => <div key={x.from} className="setrow"><span><b>{trx('desde el {0}', longDate(x.from))}</b></span><span>{trx('Turno 1 {0} · Turno 2 {1}', shiftHours(x, 1), shiftHours(x, 2))}</span></div>)}
        </div>
      )}
      {editing && <ShiftsDialog s={s} date={day.date} onClose={() => setEditing(false)} />}
    </>
  )
}

/** the day of work: its date, when it was started and by whom, its lot, its shifts */
function DaySettings({ s, now, day }: { s: State; now: number; day: WorkDay }) {
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<{ title: string; text?: string } | null>(null)
  const plan = shiftsOf(s, day.date)
  return (
    <>
      <div className="setcard">
        <div className="sethead"><h3>{tr('Día de trabajo')}</h3><button type="button" className="btn primary" onClick={() => setOpen(true)}>{day.started ? tr('✎ Cambiar') : tr('▶ Empezar el día')}</button></div>
        <p className="hint">{tr('El día de trabajo va de un corte de la noche al siguiente: el turno 2 que pasa de medianoche sigue en su día. Empezarlo pone la fecha y el lote del día en todas las tablets.')}</p>
        <div className="setfacts">
          <Fact label={tr('Fecha')} value={longDate(day.date)} />
          <Fact label={tr('Empezó')} value={day.started ? fmtTime(day.started.at) : tr('todavía no')} note={day.started?.by || undefined} />
          <Fact label={tr('Lote del día')} value={lotFor(day.date)} />
          <Fact label={tr('Turnos de hoy')} value={dayShiftsText(plan.only)} note={tr('en curso: turno {0}', turnOf(s, day.date, now).shift)} />
        </div>
      </div>
      <RoomCuts s={s} day={day} />
      {open && <StartDayDialog s={s} now={now} day={day} onClose={() => setOpen(false)} onDone={setNotice} />}
      {notice && <NoticeDialog title={notice.title} text={notice.text} onClose={() => setNotice(null)} />}
    </>
  )
}

/**
 * Each room's hand-over today (Jose, 2026-10-21): the plant's, or the room's own when it tapped "Terminar turno" or
 * "Empezar Turno 2". A manager puts the right hour when a tap was forgotten or wrong, or takes it back to the plant's.
 * Up to four hours from the plant's hand-over (store.ts, CUT_WINDOW); what was recorded is counted again from there.
 */
function RoomCuts({ s, day }: { s: State; day: WorkDay }) {
  const who = useWho(), boss = !!who.admin || who.role === 'mgr' || who.role === 'office'
  const [typed, setTyped] = useState<Partial<Record<Dept, string>>>({})
  const [bad, setBad] = useState<Dept | null>(null)
  const pc = plantCut(s, day.date)
  if (pc == null) return null
  const hm = (at: number) => { const d = new Date(at); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
  const save = (d: Dept) => {
    const v = typed[d]; if (!v) return
    const [h, m] = v.split(':').map(Number), at = new Date(day.date + 'T00:00:00').getTime() + (h * 60 + m) * 60_000
    if (!setShiftMark(day.date, d, at, 'manual')) { setBad(d); return }
    setBad(null); setTyped({ ...typed, [d]: undefined })
  }
  return (
    <div className="setcard">
      <div className="sethead"><h3>{tr('Cambio de turno de hoy, por cuarto')}</h3></div>
      <p className="hint">{tr('Cada cuarto cambia de turno cuando su gente toca "Terminar turno" (se va el Turno 1) o "Empezar Turno 2" (llegó antes). Sin eso, cambia con la planta, a las {0}. Lo registrado cuenta para el turno de su cuarto.', fmtTime(pc))}</p>
      <div className="twrap">
        <table className="cut-set">
          <thead><tr><th>{tr('Cuarto')}</th><th>{tr('Cambio de turno')}</th>{boss && <th />}</tr></thead>
          <tbody>{DEPTS.map((d) => {
            const m = roomMark(s, day.date, d)
            return (
              <tr key={d}>
                <td><b>{d}</b></td>
                <td>{m ? <><b>{fmtTime(m.at)}</b> <small>{m.how === 'fin' ? tr('Terminar turno') : m.how === 'inicio' ? tr('Empezar Turno 2') : tr('puesto a mano')}{m.by ? ' · ' + m.by : ''}</small></> : <span>{fmtTime(pc)} <small>{tr('el de la planta')}</small></span>}</td>
                {boss && <td><div className="btns">
                  <input type="time" value={typed[d] ?? hm(m?.at ?? pc)} aria-label={tr('Cambio de turno') + ' · ' + d} onChange={(e) => setTyped({ ...typed, [d]: e.target.value })} />
                  <button type="button" className="btn sm primary" disabled={!typed[d]} onClick={() => save(d)}>{tr('Guardar')}</button>
                  {m && <button type="button" className="btn sm" onClick={() => clearShiftMark(day.date, d)}>{tr('El de la planta')}</button>}
                </div>{bad === d && <small className="red">{tr('Tiene que ser a menos de 4 horas del cambio de la planta.')}</small>}</td>}
              </tr>
            )
          })}</tbody>
        </table>
      </div>
    </div>
  )
}

/** the lines of each room: their names, what runs on them, one more or one fewer */
function LinesSettings({ s }: { s: State }) {
  const [adding, setAdding] = useState<Dept | null>(null)
  const [renaming, setRenaming] = useState<Line | null>(null)
  const [removing, setRemoving] = useState<Line | null>(null)
  return (
    <>
      <div className="setcard">
        <div className="sethead"><h3>{tr('Lo que pueden hacer los operadores')}</h3></div>
        <label className="switch"><span>{tr('Agregar líneas en su cuarto')}</span><input type="checkbox" role="switch" checked={s.lineRules.add} onChange={(e) => setLineRules({ add: e.target.checked })} /></label>
        <label className="switch"><span>{tr('Quitar una línea libre de su cuarto')}</span><input type="checkbox" role="switch" checked={s.lineRules.remove} onChange={(e) => setLineRules({ remove: e.target.checked })} /></label>
        <p className="hint">{tr('Los managers y la oficina siempre pueden. Una línea con un código corriendo, parada o en Set up nunca se puede quitar. Lo ven todas las tablets y queda en el historial.')}</p>
      </div>
      <p className="hint">{tr('Cada cuarto tiene sus líneas (en Kitchen, braisers). Una línea con un código corriendo no se quita; se puede volver a agregar cuando haga falta. Todo queda en el historial.')}</p>
      {DEPTS.map((d) => {
        const lines = s.lines.filter((l) => l.dept === d && !l.deleted).sort(byLineName), word = CFG[d].lineWord.toLowerCase()
        return (
          <div className="setcard" key={d}>
            <div className="sethead"><h3>{d}<small> · {lines.length === 1 ? trx('1 {0}', word) : trx('{0} {1}', lines.length, CFG[d].lineWord === 'Braiser' ? tr('braisers') : tr('líneas'))}</small></h3><button type="button" className="btn" onClick={() => setAdding(d)}>{trx('+ Agregar {0}', word)}</button></div>
            {lines.map((l) => {
              const run = openRun(s, l.id), busy = !!run || s.stops.some((x) => x.lineId === l.id && !x.endedAt)
              return (
                <div className="setrow" key={l.id}>
                  <span><b>{lineLabel(l.name)}</b><small> · {run ? trx('corriendo {0}', run.code) : tr('libre')}</small></span>
                  <span className="btns"><button type="button" className="lnk" onClick={() => setRenaming(l)}>{tr('Cambiar nombre')}</button><button type="button" className="lnk" disabled={busy} title={busy ? tr('Tiene un código corriendo, está parada o en Set up') : ''} onClick={() => setRemoving(l)}>{tr('Quitar')}</button></span>
                </div>
              )
            })}
            {(() => {
              // what was taken off before stays in the history: folded, for a manager who wants one of them back
              const gone = removedLines(s, d)
              return gone.length > 0 && (
                <details className="gonelist">
                  <summary>{gone.length === 1 ? tr('1 línea quitada antes') : tr('{0} líneas quitadas antes', gone.length)}</summary>
                  {gone.map((x) => (
                    <div className="setrow gone" key={x.id}>
                      <span><b>{lineLabel(x.name)}</b><small> · {trx('quitada por {0} el {1}', x.by || '—', longDate(new Date(x.at).toISOString().slice(0, 10)) + ' ' + fmtTime(x.at))}</small></span>
                      <button type="button" className="lnk" onClick={() => restoreLine(d, x.id)}>{tr('↩ Volver a ponerla')}</button>
                    </div>
                  ))}
                </details>
              )
            })()}
          </div>
        )
      })}
      {adding && <LineNameDialog s={s} dept={adding} onClose={() => setAdding(null)} />}
      {renaming && <LineNameDialog s={s} dept={renaming.dept} line={renaming} onClose={() => setRenaming(null)} />}
      {removing && <ConfirmDialog title={tr('¿Quitar {0} de {1}', lineLabel(removing.name), removing.dept) + '?'} text={tr('Se puede volver a agregar cuando haga falta.')} yes={tr('Quitar')} danger onYes={() => { removeLine(removing.id); setRemoving(null) }} onNo={() => setRemoving(null)} />}
    </>
  )
}

/**
 * The plant's Reason Codes (Jose, 2026-10-20: his new boss's list, "estas son las únicas razones por la que pueden
 * parar"; "en ajuste yo pueda prender esta opción o apagarla"). Off as it starts: every stop is as it always was. On:
 * every stop of every room takes one code of the list (see reasons.ts). The whole list can be seen here while it is
 * off, to show it before it is turned on. Only the managers and the office turn it on or off (the server's rule for
 * the 'opt:' keys); every device sees it, and it goes to the history.
 * Turning it on asks first (floor review, 2026-10-20): one tap changes the stop box of every tablet of every room on both
 * shifts at once. "Probar cómo se ve al parar" opens the very stop box the operators will get, tiles and codes, while it
 * is off too, and saves nothing: to show it to the boss without turning it on for the plant.
 */
/**
 * The people each room expects on each shift, all at once (Jose, 2026-10-21: "pon la tabla en Ajustes para cambiarlos
 * de una vez"): a box per room and shift with what it says now, Guardar saves the ones changed (each one to the
 * history, as from the attendance window on the floor). The managers and the office write it; "Solo ver" reads it.
 * The plant's number of the shift is the rooms' added up, as the attendance total.
 */
function AttendanceSettings({ s, date, viewOnly, admin }: { s: State; date: string; viewOnly: boolean; admin: boolean }) {
  const [asking, setAsking] = useState(false)
  const now = (d: Dept, k: 1 | 2) => String(attExpectedOf(s, d, k))
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const val = (d: Dept, k: 1 | 2) => typed[d + k] ?? now(d, k)
  const changed = DEPTS.flatMap((d) => ([1, 2] as const).filter((k) => typed[d + k] !== undefined && typed[d + k] !== '' && Number(typed[d + k]) !== attExpectedOf(s, d, k)).map((k) => ({ d, k, n: Number(typed[d + k]) })))
  const total = (k: 1 | 2) => DEPTS.reduce((t, d) => t + (Number(val(d, k)) || 0), 0)
  const save = () => { for (const x of changed) setAttExpected(x.d, x.k, x.n); setTyped({}); setSaved(true) }
  const one = attShifts(s, date).length === 1
  const on = s.attView.on
  // attendance before starting (Jose, 2026-10-27), offered once the attendance is everybody's
  const gate = s.attGate.on
  const [gateAsk, setGateAsk] = useState(false)
  return (
    <>
    {admin && (
      <div className="setcard">
        <div className="sethead"><h3>{tr('Asistencia')}</h3><span className={'rc-state' + (on ? ' on' : '')}>{on ? tr('Para todos') : tr('Solo tú')}</span></div>
        <label className="switch"><span>{tr('Que todos vean la asistencia')}</span><input type="checkbox" role="switch" checked={on} onChange={(e) => (e.target.checked ? setAsking(true) : setAttView(false))} /></label>
        <p className="hint">{tr('Apagado: solo tú ves la asistencia (la tarjeta del piso, el reporte, el Excel y esta tabla), para probarla y enseñarla. Lo anotado no se pierde.')}</p>
        <p className="hint">{tr('Prendido: cada supervisor anota a su gente en su cuarto, y el reporte la muestra a todos.')}</p>
      </div>
    )}
    {on && (
      <div className="setcard">
        <div className="sethead"><h3>{tr('Asistencia obligatoria para empezar')}</h3><span className={'rc-state' + (gate ? ' on' : '')}>{gate ? tr('Prendida') : tr('Apagada')}</span></div>
        <label className="switch"><span>{tr('Que anoten la asistencia antes de empezar')}</span><input type="checkbox" role="switch" checked={gate} disabled={viewOnly} onChange={(e) => (e.target.checked ? setGateAsk(true) : setAttGate(false))} /></label>
        <p className="hint">{tr('Prendida: en todos los cuartos, el supervisor o líder tiene que anotarse como supervisor del turno y anotar a su gente antes de poder empezar un código o un Set up; al tocar Empezar se abre la ventana de asistencia. Cada turno anota la suya. No aplica a managers, oficina ni "Solo ver".')}</p>
      </div>
    )}
    {gateAsk && <ConfirmDialog title={tr('¿Asistencia obligatoria para empezar?')} text={tr('Desde ahora, en todos los cuartos, ningún supervisor puede empezar un código ni un Set up sin haberse anotado como supervisor del turno en la asistencia. Se puede apagar aquí mismo cuando quieras.')} yes={tr('Prender')} onYes={() => { setAttGate(true); setGateAsk(false) }} onNo={() => setGateAsk(false)} />}
    {asking && <ConfirmDialog title={tr('¿Que todos vean la asistencia?')} text={tr('Desde ahora la tarjeta de asistencia sale en el piso de todos los cuartos, y en el reporte y sus archivos. Se puede apagar aquí mismo cuando quieras.')} yes={tr('Prender para todos')} onYes={() => { setAttView(true); setAsking(false) }} onNo={() => setAsking(false)} />}
    <div className="setcard">
      <div className="sethead"><h3>{tr('Asistencia · personas esperadas')}</h3></div>
      <p className="hint">{tr('Cuántas personas espera cada cuarto en cada turno. Con esto la tarjeta de asistencia del piso y el reporte sacan el % de faltas. Se quedan así hasta que alguien las cambie otra vez.')}</p>
      <div className="twrap">
        <table className="att-set">
          <thead><tr><th>{tr('Cuarto')}</th><th className="num">{tr('Turno 1')}</th><th className="num">{tr('Turno 2')}</th></tr></thead>
          <tbody>
            {DEPTS.map((d) => (
              <tr key={d}>
                <td><b>{d}</b><small> · {tr('al principio {0}', ATT_DEFAULT[d])}</small></td>
                {([1, 2] as const).map((k) => <td key={k} className="num"><input value={val(d, k)} inputMode="numeric" disabled={viewOnly} aria-label={d + ' · ' + tr('Turno {0}', k)} className={typed[d + k] !== undefined && Number(typed[d + k]) !== attExpectedOf(s, d, k) ? 'chg' : ''} onChange={(e) => { setTyped({ ...typed, [d + k]: e.target.value.replace(/\D/g, '').slice(0, 4) }); setSaved(false) }} /></td>)}
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td>{tr('TOTAL')}</td><td className="num">{total(1)}</td><td className="num">{total(2)}</td></tr></tfoot>
        </table>
      </div>
      {one && <p className="hint">{tr('Hoy trabaja un solo turno: cuenta el número de ese turno.')}</p>}
      {saved && !changed.length && <p className="hint ok">{tr('✓ Guardado: ya lo ven todas las tablets.')}</p>}
      {!viewOnly && <div className="btns"><button type="button" className="btn" disabled={!changed.length} onClick={() => setTyped({})}>{tr('Deshacer cambios')}</button><button type="button" className="btn primary" disabled={!changed.length} onClick={save}>{!changed.length ? tr('✓ Guardar') : changed.length === 1 ? tr('✓ Guardar 1 cambio') : tr('✓ Guardar {0} cambios', changed.length)}</button></div>}
    </div>
    </>
  )
}

/**
 * The Programa del día tab (Jose, 2026-10-20: "que lo vea yo solamente ... y cuando ellos digan está bien, entonces en
 * ajuste lo prendo para que lo vean todos"): only the admin sees this card. Off, the tab is the admin's alone (marked
 * 🔒); on, everybody has it, each with the rooms they see. Turning it on asks first, as the codes do.
 */
/**
 * The switches of the Lotes and Flujo tabs (Jose, 2026-10-22): Lotes is the new chain of each lot (the admin's until
 * turned on); Flujo, the office's old sheet nobody used, is off: only the admin sees it, and it comes back with a tap
 */
function ViewOptSettings({ s, name }: { s: State; name: ViewOpt }) {
  const [asking, setAsking] = useState(false)
  const on = s.viewOpts[name].on
  const title = name === 'lotes' ? tr('Pestaña Lotes') : tr('Pestaña Flujo')
  return (
    <>
      <div className="setcard">
        <div className="sethead"><h3>{title}</h3><span className={'rc-state' + (on ? ' on' : '')}>{on ? tr('Para todos') : tr('Solo tú')}</span></div>
        <label className="switch"><span>{name === 'lotes' ? tr('Que todos vean la pestaña Lotes') : tr('Que todos vean la pestaña Flujo')}</span><input type="checkbox" role="switch" checked={on} onChange={(e) => (e.target.checked ? setAsking(true) : setViewOpt(name, false))} /></label>
        <p className="hint">{name === 'lotes' ? tr('Lotes sigue cada lote de las mezclas a Packing: lo que cada cuarto debía hacer, lo que falta y lo que se perdió. Apagada, solo la ves tú (con 🔒).') : tr('Flujo es la hoja de la oficina (WO PENDIENTES), con todas sus columnas. La reemplaza Lotes: apagada, solo la ves tú (con 🔒). Nada se borra.')}</p>
      </div>
      {asking && <ConfirmDialog title={name === 'lotes' ? tr('¿Que todos vean la pestaña Lotes?') : tr('¿Que todos vean la pestaña Flujo?')} text={tr('La ven los managers, la oficina y "Solo ver". Se puede apagar aquí mismo cuando quieras.')} yes={tr('Prender para todos')} onYes={() => { setViewOpt(name, true); setAsking(false) }} onNo={() => setAsking(false)} />}
    </>
  )
}

function ProgramViewSettings({ s }: { s: State }) {
  const [asking, setAsking] = useState(false)
  const on = s.programView.on
  return (
    <>
      <div className="setcard">
        <div className="sethead"><h3>{tr('Programa del día')}</h3><span className={'rc-state' + (on ? ' on' : '')}>{on ? tr('Para todos') : tr('Solo tú')}</span></div>
        <label className="switch"><span>{tr('Que todos vean la pestaña Programa')}</span><input type="checkbox" role="switch" checked={on} onChange={(e) => (e.target.checked ? setAsking(true) : setProgramView(false))} /></label>
        <p className="hint">{tr('Apagado: la pestaña Programa la ves solo tú (sale con 🔒), para enseñarla y ajustarla antes.')}</p>
        <p className="hint">{tr('Prendido: la ven todos: los managers y la oficina con todos los cuartos, cada operador con el suyo.')}</p>
      </div>
      {asking && <ConfirmDialog title={tr('¿Que todos vean el Programa del día?')} text={tr('Desde ahora la pestaña Programa sale en todas las tablets y computadoras. Se puede apagar aquí mismo cuando quieras.')} yes={tr('Prender para todos')} onYes={() => { setProgramView(true); setAsking(false) }} onNo={() => setAsking(false)} />}
    </>
  )
}

function StopCodesSettings({ s, viewOnly }: { s: State; viewOnly: boolean }) {
  const [seeing, setSeeing] = useState(false)
  const [asking, setAsking] = useState(false)
  const [trying, setTrying] = useState<'' | 'box' | 'done'>('')
  const on = s.reasonCodes.on
  return (
    <>
      <div className="setcard">
        <div className="sethead"><h3>{tr('Códigos de paro (Reason Codes)')}</h3><span className={'rc-state' + (on ? ' on' : '')}>{on ? tr('Encendidos') : tr('Apagados')}</span></div>
        <label className="switch"><span>{tr('Pedir un código de la lista en cada paro')}</span><input type="checkbox" role="switch" checked={on} disabled={viewOnly} onChange={(e) => (e.target.checked ? setAsking(true) : setReasonCodes(false))} /></label>
        <p className="hint">{tr('Encendidos: cada paro (Parar, Parar todo, Corregir y Dividir) tiene que llevar uno de los {0} códigos de la lista, y solo de la lista: no hay "Otra". El detalle es opcional, menos con {1}, que lo pide. {2} es el Set up.', REASON_CODES.length, OTHER_CODE, SETUP_CODE)}</p>
        <p className="hint">{tr('Apagados: todo como siempre (las tres causas de cada cuarto y "Otra"). Los paros de antes se quedan con su causa; el reporte los cuenta como "Sin código".')}</p>
        <div className="btns"><button type="button" className="btn soft" onClick={() => setSeeing(true)}>{tr('📋 Ver la lista de códigos')}</button><button type="button" className="btn soft" onClick={() => setTrying('box')}>{tr('▶ Probar cómo se ve al parar')}</button></div>
      </div>
      {asking && <ConfirmDialog title={tr('¿Encender los códigos de paro?')} text={tr('Desde ahora todas las tablets de todos los cuartos, en los dos turnos, piden un código de la lista en cada paro. Se puede apagar aquí mismo cuando quieras.')} yes={tr('Encender')} onYes={() => { setReasonCodes(true); setAsking(false) }} onNo={() => setAsking(false)} />}
      {trying === 'box' && <StopDialog title={tr('Parar {0} · {1}', lineLabel('Línea 1'), tr('Prueba'))} intro={tr('Prueba: así se ve al parar con los códigos encendidos. No se guarda nada.')} reasons={[]} setup codes onClose={() => setTrying('')} onPick={() => setTrying('done')} />}
      {trying === 'done' && <NoticeDialog title={tr('Era una prueba')} text={tr('No se guardó ningún paro. Así lo eligen los operadores cuando los códigos están encendidos.')} onClose={() => setTrying('')} />}
      {seeing && (
        <div className="veil" onClick={() => setSeeing(false)}>
          <div className="dlg wide rc-dlg" onClick={(e) => e.stopPropagation()}>
            <h3>{tr('Códigos de paro · {0}', REASON_CODES.length)}</h3>
            <p>{on ? tr('Encendidos: así se eligen al parar.') : tr('Apagados: así se verían al parar cuando se enciendan.')}</p>
            <CodeList />
            <div className="dbtns"><button type="button" className="btn primary" onClick={() => setSeeing(false)}>{tr('Cerrar')}</button></div>
          </div>
        </div>
      )}
    </>
  )
}

/** each room's goal for each shift */
function GoalsSettings({ s, now, day }: { s: State; now: number; day: WorkDay }) {
  const [dept, setDept] = useState<Dept | null>(null)
  const unitOf = (d: Dept) => (CFG[d].qty === 'none' ? CFG[d].plural.toLowerCase() : CFG[d].qtyUnit)
  const text = (d: Dept, k: 1 | 2) => { const g = shiftGoalOf(s, d, k), u = unitOf(d); return [g.total ? fmtN(g.total) + ' ' + u : '', g.perHour ? fmtN(g.perHour) + ' ' + u + '/h' : ''].filter(Boolean).join(' · ') || '—' }
  return (
    <>
      <div className="setcard">
        <div className="sethead"><h3>{tr('Metas por turno')}</h3></div>
        <p className="hint">{tr('Cada turno tiene su meta, del turno entero y por hora, en la unidad del cuarto. Lo que cuenta contra ella es solo lo que ese turno hace. Las metas de cada línea se ponen desde su tarjeta.')}</p>
        <div className="twrap">
          <table className="goals">
            <thead><tr><th>{tr('Cuarto')}</th><th>{tr('Turno 1')}</th><th>{tr('Turno 2')}</th><th></th></tr></thead>
            <tbody>{DEPTS.map((d) => <tr key={d}><td><b>{d}</b></td><td>{text(d, 1)}</td><td>{text(d, 2)}</td><td><button type="button" className="lnk" onClick={() => setDept(d)}>{tr('Cambiar')}</button></td></tr>)}</tbody>
          </table>
        </div>
      </div>
      {dept && <TargetDialog s={s} dept={dept} unit={unitOf(dept)} inCourse={turnOf(s, day.date, now).shift} onClose={() => setDept(null)} />}
    </>
  )
}

/** this device: who is on it, its version, its clock, its language; and the way out */
function DeviceSettings({ now, name, home, mgr, viewOnly, onLeave }: { now: number; name: string; home: Dept; mgr: boolean; viewOnly: boolean; onLeave: () => void }) {
  const sync = useSyncExternalStore(syncStore.subscribe, syncStore.get)
  const off = supabase ? clockOffText() : '', clk = supabase ? clockState() : null
  // the tools of the device itself (they were at the bottom of the Reporte, which is about the day only since
  // 2026-10-17): for whoever sees every room, never for somebody who only looks
  const tools = useCan()('depts') && !viewOnly
  return (
    <>
      <div className="setcard">
        <div className="sethead"><h3>{tr('Este aparato')}</h3></div>
        <div className="setfacts">
          <Fact label={tr('Quién')} value={name} note={viewOnly ? tr('Solo ver') : mgr ? tr('Manager') : home} />
          <Fact label={tr('Versión')} value={BUILD || '—'} />
          {supabase && <Fact label={tr('Última bajada del servidor')} value={sync.lastSync ? fmtTime(sync.lastSync) : '—'} note={sync.pending > 0 ? tr('{0} sin subir', String(sync.pending)) : tr('todo subido')} />}
          {supabase && <Fact label={tr('Reloj')} value={off ? off : clk && clk.measured ? tr('ajustado con el servidor') : tr('el suyo, sin ajustar')} note={new Date(now).toLocaleTimeString()} />}
        </div>
        <div className="btns"><LangSwitch />{mgr && <QrLink label={tr('Abrir en otro aparato')} />}<button type="button" className="btn" onClick={onLeave}>{tr('Salir')}</button></div>
      </div>
      {tools && <DeviceTools />}
    </>
  )
}

/** cleaning this device and bringing everything back from the server, or sending up what it holds; in the demo, its own resets and the manager's code */
function DeviceTools() {
  const [resetting, setResetting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)
  const [newPin, setNewPin] = useState('')
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState<{ title: string; text?: string } | null>(null)
  return (
    <div className="setcard">
      <div className="sethead"><h3>{tr('Herramientas de este aparato')}</h3></div>
      <div className="btns">
        {supabase && <button type="button" className="btn" onClick={() => setUploading(true)}>{tr('Subir al servidor los registros de este aparato')}</button>}
        {!supabase && <button type="button" className="btn stopbtn" onClick={() => setClearing(true)}>{tr('Reiniciar registros (conserva productos y líneas)')}</button>}
        <button type="button" className="btn stopbtn" onClick={() => setResetting(true)}>{supabase ? tr('Limpiar este aparato y volver a bajar del servidor') : tr('Borrar todo')}</button>
        {!supabase && <button type="button" className="btn" onClick={() => { setNewPin(''); setPinOpen(true) }}>{tr('Cambiar código de manager')}</button>}
      </div>
      {/* what the button really does since 2026-10-17 (audit H4): only what the server never got, nothing it already has */}
      {uploading && <ConfirmDialog title={tr('¿Subir al servidor lo que este aparato todavía no ha subido?')} text={tr('Corridas, paros y líneas de este aparato que el servidor todavía no tiene se mandan al servidor. Lo que ya está en el servidor no se toca. Útil una sola vez por tablet, para traer los días del piloto.')} yes={tr('Subir')} onYes={() => { const n = uploadAll(); setUploading(false); setNotice(n ? { title: tr('{0} registros en cola', n), text: tr('Se envían en cuanto hay señal. El punto junto a tu nombre dice "Sincronizado" cuando terminó.') } : { title: tr('Nada que subir'), text: tr('El servidor ya tiene todo lo de este aparato.') }) }} onNo={() => setUploading(false)} />}
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
    </div>
  )
}

/**
 * How often a room weighs and how many each time (2026-10-23: Spiral, "cada hora que pesen 8 bolas ... que se pueda
 * ajustar en Ajustes"): minutes between tests (0 = no reminder) and how many per test, for Spiral and RTE
 */
/** which rooms weigh what they consume before a code starts (the office, 2026-10-27), off until a manager turns it on */
function ConsumeSettings({ s, viewOnly }: { s: State; viewOnly: boolean }) {
  return (
    <div className="setcard">
      <div className="sethead"><h3>{tr('Consumo')}</h3></div>
      <p className="hint">{tr('Donde está prendido, la línea tiene que pesar y anotar lo que va a consumir (qué es, lote, fecha de la etiqueta, libras) antes de poder empezar un código; al terminarlo dice qué quedó, y eso queda en el inventario del cuarto. Sale en el Reporte y en el Excel.')}</p>
      {DEPTS.map((d) => { const on = consumeOn(s, d); return (
        <div key={d} className="wt-rule"><b>{d}</b><span className={on ? 'ok' : 'muted'}>{on ? tr('obligatorio al empezar') : tr('apagado')}</span>{!viewOnly && <button type="button" className={'btn sm' + (on ? '' : ' primary')} onClick={() => setConsumeOn(d, !on)}>{on ? tr('Apagar') : tr('Prender')}</button>}</div>
      ) })}
    </div>
  )
}
function WeightSettings({ s, viewOnly }: { s: State; viewOnly: boolean }) {
  const rooms: { dept: Dept; what: string }[] = [{ dept: 'Spiral', what: tr('bolas') }, { dept: 'RTE', what: tr('pouches') }]
  return (
    <div className="setcard">
      <div className="sethead"><h3>{tr('Pesos')}</h3></div>
      <p className="hint">{tr('Cada cuánto le sale a la línea el aviso de pesar, y cuántos se pesan cada vez. Con 0 minutos no sale aviso (el botón ⚖ Peso sigue ahí).')}</p>
      {rooms.map((r) => <WeightRuleRow key={r.dept} s={s} dept={r.dept} what={r.what} viewOnly={viewOnly} />)}
    </div>
  )
}
function WeightRuleRow({ s, dept, what, viewOnly }: { s: State; dept: Dept; what: string; viewOnly: boolean }) {
  const now = weightRuleOf(s, dept)
  const [every, setEvery] = useState(String(now.every)), [count, setCount] = useState(String(now.count))
  const changed = Number(every) !== now.every || Number(count) !== now.count
  return (
    <form className="wt-rule" onSubmit={(e) => { e.preventDefault(); setWeightRule(dept, Number(every) || 0, Number(count) || 0) }}>
      <b>{dept}</b>
      <label>{tr('Aviso cada')} <input inputMode="numeric" value={every} disabled={viewOnly} onChange={(e) => setEvery(e.target.value.replace(/\D/g, ''))} /> {tr('min')}</label>
      <label>{tr('Pesar')} <input inputMode="numeric" value={count} disabled={viewOnly} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} /> {what}</label>
      {!viewOnly && <button type="submit" className="btn sm primary" disabled={!changed}>{tr('Guardar')}</button>}
      <small>{now.every ? tr('Ahora: cada {0} min, {1} {2}', now.every, now.count, what) : tr('Ahora: sin aviso')}</small>
    </form>
  )
}

/**
 * The crates an RTE cart holds, for the whole plant (Jose, 2026-10-28: "elegir 24 o 26 u otro número"): the number
 * the codes with no figure of their own use, and a button that writes it into every code of Productos
 */
function CartCratesSettings({ s, readOnly }: { s: State; readOnly: boolean }) {
  const now = cartCratesOf(s)
  const [typed, setTyped] = useState('')
  const [said, setSaid] = useState('')
  const n = typed.trim() === '' ? now : Number(typed)
  const ok = Number.isInteger(n) && n >= 1 && n <= 200
  const differ = s.products.filter((p) => !p.deleted && p.cratesPerCart !== n).length
  const apply = () => {
    if (!ok) return
    setCartCrates(n)
    const changed = setAllCartCrates(n)
    setTyped(''); setSaid(changed ? tr('✓ {0} guacales por carro: cambiados {1} códigos; ya lo ven todas las tablets.', n, changed) : tr('✓ {0} guacales por carro en todos los códigos.', n))
  }
  return (
    <div className="setcard">
      <div className="sethead"><h3>{tr('Guacales por carro (RTE)')}</h3><span className="rc-state on">{tr('{0} ahora', now)}</span></div>
      <p className="hint">{tr('Cuántos guacales lleva un carro de RTE (dos columnas: {0} por columna). Al aplicarlo se escribe en todos los códigos de Productos y es lo que usa "Carro listo" y el aviso al empezar un código. Un código se puede cambiar aparte en la tabla de abajo.', Math.ceil(now / 2))}</p>
      <div className="btns" style={{ alignItems: 'center' }}>
        <label>{tr('Guacales por carro')}{' '}<input inputMode="numeric" value={typed} placeholder={String(now)} disabled={readOnly} style={{ width: 80 }} onChange={(e) => { setTyped(e.target.value.replace(/\D/g, '').slice(0, 3)); setSaid('') }} /></label>
        {!readOnly && <button type="button" className="btn primary" disabled={!ok || (n === now && !differ)} onClick={apply}>{differ ? tr('Poner {0} en todos los códigos ({1})', n, differ) : tr('Poner {0} en todos los códigos', n)}</button>}
      </div>
      {said && <p className="hint ok">{said}</p>}
    </div>
  )
}
