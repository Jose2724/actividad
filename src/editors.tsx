import { useState } from 'react'
import { applyDraft, CFG, deleteRun, deleteStop, draftOf, fmtTime, lineNameOf, nearDay, openRun, updateRun, updateStop, type Run, type State, type Stop } from './store'
import { ConfirmDialog } from './App'

/** "HH:MM" of a moment */
const hm = (ms: number) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }

/**
 * Fixing a run after the fact: the code, lot or date typed wrong, the pouches per cart, the waste, and every unit
 * registered (its quantity, its tag or bin number, or one tapped by mistake). A code finished too early can be
 * reopened; the manager can also drop the whole run.
 */
export function RunEditor({ s, run, mgr, onClose }: { s: State; run: Run; mgr: boolean; onClose: () => void }) {
  const cfg = CFG[run.dept]
  // how the form opened: saving applies only what was changed since, on top of what the run is by then
  const [opened] = useState(() => draftOf(run))
  const [code, setCode] = useState(opened.code)
  const [lot, setLot] = useState(opened.lot)
  const [date, setDate] = useState(opened.date)
  const [per, setPer] = useState(opened.per)
  const [waste, setWaste] = useState(opened.waste)
  const [units, setUnits] = useState(opened.units)
  const [dropping, setDropping] = useState(false)
  const lineBusy = !!run.endedAt && !!openRun(s, run.lineId)
  // units tapped on the line while this form is open: they are kept as they are
  const later = run.units.filter((u) => !opened.units.some((o) => o.at === u.at)).length
  const save = () => { applyDraft(run.id, opened, { code, lot, date, per, waste, units }); onClose() }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg wide" onClick={(e) => e.stopPropagation()}>
        <h3>Corregir · {run.code} · {lineNameOf(s, run.lineId, run.line)}</h3>
        <div className="egrid">
          <label>Código <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" /></label>
          <label>Lote <input value={lot} onChange={(e) => setLot(e.target.value)} inputMode="numeric" autoComplete="off" /></label>
          <label>Fecha <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          {cfg.perUnitLabel && <label>{cfg.perUnitLabel} <input value={per} onChange={(e) => setPer(e.target.value.replace(/\D/g, ''))} inputMode="numeric" autoComplete="off" /></label>}
          {cfg.waste && <label>Waste (lb) <input value={waste} onChange={(e) => setWaste(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" autoComplete="off" /></label>}
        </div>
        {units.length > 0 && (
          <div className="twrap">
            <table>
              <thead><tr><th>#</th><th>Hora</th>{cfg.qty !== 'none' && <th>{cfg.qtyUnit}</th>}{cfg.refLabel && <th>{cfg.refLabel}</th>}<th>Por</th><th></th></tr></thead>
              <tbody>{units.map((u, i) => (
                <tr key={u.at + ':' + i}>
                  <td>{i + 1}</td><td>{fmtTime(u.at)}</td>
                  {cfg.qty !== 'none' && <td><input className="num" inputMode="numeric" value={u.qty} onChange={(e) => setUnits(units.map((x, k) => (k === i ? { ...x, qty: e.target.value.replace(/\D/g, '') } : x)))} /></td>}
                  {cfg.refLabel && <td><input className="num" value={u.ref} onChange={(e) => setUnits(units.map((x, k) => (k === i ? { ...x, ref: e.target.value } : x)))} autoComplete="off" /></td>}
                  <td>{u.by || '—'}</td>
                  <td><button type="button" className="lnk" title="Quitar esta unidad" onClick={() => setUnits(units.filter((_, k) => k !== i))}>✕</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="hint">Quita con ✕ una unidad tocada de más. Los cambios quedan al tocar Guardar.{later > 0 && ' Mientras corregías se ' + (later === 1 ? 'registró 1 ' + cfg.unit.toLowerCase() + ' más: se conserva.' : 'registraron ' + later + ' ' + cfg.plural.toLowerCase() + ' más: se conservan.')}</p>
        <div className="dbtns spread">
          <div className="btns">
            {run.endedAt && <button type="button" className="btn" disabled={lineBusy} title={lineBusy ? 'La línea ya corre otro código' : ''} onClick={() => { updateRun(run.id, { endedAt: null }); onClose() }}>Reabrir código</button>}
            {mgr && <button type="button" className="lnk" onClick={() => setDropping(true)}>Borrar corrida</button>}
          </div>
          <div className="btns">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="button" className="btn primary" onClick={save}>Guardar</button>
          </div>
        </div>
        {dropping && <ConfirmDialog title={'¿Borrar la corrida de ' + run.code + '?'} text="Se borran sus unidades y su waste. No se puede deshacer." yes="Borrar" danger onYes={() => { deleteRun(run.id); onClose() }} onNo={() => setDropping(false)} />}
      </div>
    </div>
  )
}

/** Fixing a stop: its reason, its note, when it started and ended; or dropping one that was never real. */
export function StopEditor({ stop, mgr, onClose }: { stop: Stop; mgr: boolean; onClose: () => void }) {
  const reasons = CFG[stop.dept].reasons
  const known = reasons.includes(stop.reason)
  // how the form opened: saving applies only what was changed since (a stop ended on the line meanwhile stays ended)
  const [opened] = useState(() => ({ reason: known ? stop.reason : 'Otra', other: known ? '' : stop.reason, note: stop.note, start: hm(stop.startedAt), end: stop.endedAt ? hm(stop.endedAt) : '' }))
  const [reason, setReason] = useState(opened.reason)
  const [other, setOther] = useState(opened.other)
  const [note, setNote] = useState(opened.note)
  const [start, setStart] = useState(opened.start)
  const [end, setEnd] = useState(opened.end)
  const [dropping, setDropping] = useState(false)
  const ok = reason === 'Otra' ? other.trim().length > 0 : !!reason
  const save = () => {
    const patch: Parameters<typeof updateStop>[1] = {}
    const text = (r: string, o: string) => (r === 'Otra' ? o.trim() : r)
    if (text(reason, other) !== text(opened.reason, opened.other)) patch.reason = text(reason, other)
    if (note.trim() !== opened.note.trim()) patch.note = note.trim()
    // a time left as it was keeps its seconds; a changed one is read from HH:MM on the day nearest to the old moment
    const startedAt = start !== opened.start ? nearDay(stop.startedAt, start) : stop.startedAt
    if (startedAt !== stop.startedAt) patch.startedAt = startedAt
    // the end: a new time, or cleared to reopen the stop
    if (stop.endedAt != null && end !== opened.end) patch.endedAt = end ? Math.max(startedAt, nearDay(stop.endedAt, end)) : null
    else if (stop.endedAt != null && stop.endedAt < startedAt) patch.endedAt = startedAt
    if (Object.keys(patch).length) updateStop(stop.id, patch)
    onClose()
  }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>Corregir paro · {stop.dept}</h3>
        <div className="chips">{[...reasons, 'Otra'].map((r) => <button key={r} type="button" className={'chip' + (reason === r ? ' on' : '')} onClick={() => setReason(r)}>{r}</button>)}</div>
        {reason === 'Otra' && <input placeholder="Escribe la razón" value={other} onChange={(e) => setOther(e.target.value)} />}
        <input placeholder="Detalle (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="egrid">
          <label>Inicio <input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          {stop.endedAt != null && <label>Fin <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></label>}
        </div>
        <div className="dbtns spread">
          <div className="btns">{mgr && <button type="button" className="lnk" onClick={() => setDropping(true)}>Borrar paro</button>}</div>
          <div className="btns">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="button" className="btn primary" disabled={!ok} onClick={save}>Guardar</button>
          </div>
        </div>
        {dropping && <ConfirmDialog title="¿Borrar este paro?" text="Deja de contar como tiempo parado. No se puede deshacer." yes="Borrar" danger onYes={() => { deleteStop(stop.id); onClose() }} onNo={() => setDropping(false)} />}
      </div>
    </div>
  )
}
