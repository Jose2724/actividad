import { useState, useSyncExternalStore } from 'react'
import { byLineName, CFG, dayShiftsText, DEPTS, lineLabel, lotFor, nightText, openRun, removedLines, removeLine, restoreLine, setDayShifts, shiftGoalOf, shiftHours, shiftsOf, turnOf, weekOf, type Dept, type Line, type State, type WorkDay } from './store'
import { ConfirmDialog, LangSwitch, LineNameDialog, longDate, NoticeDialog, Products, QrLink, ShiftsDialog, StartDayDialog, TargetDialog, useCan } from './App'
import { Employees } from './Employees'
import { Devices } from './DevicesView'
import { supabase } from './supabase'
import { syncStore } from './sync'
import { BUILD } from './update'
import { clockOffText, clockState } from './clock'
import { fmtTime } from './clock-fmt'
import { tr } from './i18n'
import { trx } from './trx'

/**
 * Ajustes: everything the plant sets once and reads later, in one place, each thing in its own section (Jose,
 * 2026-10-17: "una pestaña de ajustes diseñada profesionalmente"). The sections a person sees are the ones their
 * powers allow; the last one, this device, is everybody's. The dialogs that do the work are the same ones the floor
 * and the report already use, so one rule holds everywhere.
 */
export type SettingsKey = 'shifts' | 'day' | 'lines' | 'products' | 'goals' | 'people' | 'devices' | 'device'
const fmtN = (x: number) => Math.round(x).toLocaleString('en-US')

export function settingsSections(can: (p: 'shifts' | 'day' | 'products' | 'goals' | 'people') => boolean, mgr: boolean, viewOnly: boolean): { key: SettingsKey; title: string; sub: string }[] {
  return [
    ...(can('shifts') ? [{ key: 'shifts' as const, title: tr('Turnos y calendario'), sub: tr('horas, semana, días aparte') }] : []),
    ...(can('day') ? [{ key: 'day' as const, title: tr('Día de trabajo'), sub: tr('fecha, hora de inicio, lote') }] : []),
    ...(mgr && !viewOnly ? [{ key: 'lines' as const, title: tr('Líneas'), sub: tr('las líneas de cada cuarto') }] : []),
    ...(can('products') || viewOnly ? [{ key: 'products' as const, title: tr('Productos'), sub: tr('la tabla maestra') }] : []),
    ...(can('goals') ? [{ key: 'goals' as const, title: tr('Metas'), sub: tr('por turno y por cuarto') }] : []),
    ...(can('people') && supabase ? [{ key: 'people' as const, title: tr('Empleados'), sub: tr('cuentas, roles y permisos') }] : []),
    ...(mgr && !viewOnly && supabase ? [{ key: 'devices' as const, title: tr('Tablets'), sub: tr('qué aparato está en qué') }] : []),
    { key: 'device' as const, title: tr('Este aparato'), sub: tr('idioma, versión, salir') },
  ]
}

export function Settings({ s, now, day, name, home, mgr, admin, viewOnly, meId, section, onSection, onLeave }: { s: State; now: number; day: WorkDay; name: string; home: Dept; mgr: boolean; admin: boolean; viewOnly: boolean; meId: string; section: SettingsKey; onSection: (k: SettingsKey) => void; onLeave: () => void }) {
  const can = useCan()
  const items = settingsSections(can, mgr, viewOnly)
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
          <Fact label={tr('Turno 1')} value={shiftHours(plan, 1)} />
          <Fact label={tr('Turno 2')} value={shiftHours(plan, 2)} />
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
        <p className="hint">{tr('Un sábado en que solo vino un turno, o un día de dos turnos que no suele tenerlos. Con un solo turno, todo lo del día es de ese turno; nada se reescribe, se recalcula.')}</p>
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
      {open && <StartDayDialog s={s} now={now} day={day} onClose={() => setOpen(false)} onDone={setNotice} />}
      {notice && <NoticeDialog title={notice.title} text={notice.text} onClose={() => setNotice(null)} />}
    </>
  )
}

/** the lines of each room: their names, what runs on them, one more or one fewer */
function LinesSettings({ s }: { s: State }) {
  const [adding, setAdding] = useState<Dept | null>(null)
  const [renaming, setRenaming] = useState<Line | null>(null)
  const [removing, setRemoving] = useState<Line | null>(null)
  return (
    <>
      <p className="hint">{tr('Cada cuarto tiene sus líneas (en Kitchen, braisers). Una línea con un código corriendo no se quita; se puede volver a agregar cuando haga falta. Todo queda en el historial.')}</p>
      {DEPTS.map((d) => {
        const lines = s.lines.filter((l) => l.dept === d && !l.deleted).sort(byLineName), word = CFG[d].lineWord.toLowerCase()
        return (
          <div className="setcard" key={d}>
            <div className="sethead"><h3>{d}<small> · {lines.length === 1 ? trx('1 {0}', word) : trx('{0} {1}', lines.length, CFG[d].lineWord === 'Braiser' ? tr('braisers') : tr('líneas'))}</small></h3><button type="button" className="btn" onClick={() => setAdding(d)}>{trx('+ Agregar {0}', word)}</button></div>
            {lines.map((l) => {
              const run = openRun(s, l.id)
              return (
                <div className="setrow" key={l.id}>
                  <span><b>{lineLabel(l.name)}</b><small> · {run ? trx('corriendo {0}', run.code) : tr('libre')}</small></span>
                  <span className="btns"><button type="button" className="lnk" onClick={() => setRenaming(l)}>{tr('Cambiar nombre')}</button><button type="button" className="lnk" disabled={!!run} title={run ? tr('Tiene un código corriendo') : ''} onClick={() => setRemoving(l)}>{tr('Quitar')}</button></span>
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
  return (
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
  )
}
