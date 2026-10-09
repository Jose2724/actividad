import { useState } from 'react'
import { CFG, deleteRun, deleteStop, fmtTime, openRun, updateRun, updateStop, type Run, type State, type Stop } from './store'
import { ConfirmDialog } from './App'

/** "HH:MM" of a moment, and that time put back on the same day */
const hm = (ms: number) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
const onDay = (base: number, v: string) => { const [h, m] = v.split(':').map(Number); const d = new Date(base); if (Number.isFinite(h) && Number.isFinite(m)) d.setHours(h, m, 0, 0); return d.getTime() }

/**
 * Fixing a run after the fact: the code, lot or date typed wrong, the pouches per cart, the waste, and every unit
 * registered (its quantity, its tag or bin number, or one tapped by mistake). A code finished too early can be
 * reopened; the manager can also drop the whole run.
 */
export function RunEditor({ s, run, mgr, onClose }: { s: State; run: Run; mgr: boolean; onClose: () => void }) {
  const cfg = CFG[run.dept]
  const [code, setCode] = useState(run.code)
  const [lot, setLot] = useState(run.lot)
  const [date, setDate] = useState(run.date)
  const [per, setPer] = useState(run.perUnit != null ? String(run.perUnit) : '')
  const [waste, setWaste] = useState(run.waste ? String(run.waste) : '')
  const [units, setUnits] = useState(run.units.map((u) => ({ at: u.at, qty: u.qty != null ? String(u.qty) : '', ref: u.ref, by: u.by })))
  const [dropping, setDropping] = useState(false)
  const num = (v: string) => { const n = Number(v.replace(',', '.')); return Number.isFinite(n) ? n : 0 }
  const lineBusy = !!run.endedAt && !!openRun(s, run.lineId)
  const save = () => {
    updateRun(run.id, {
      code: code.trim().toUpperCase() || run.code, lot: lot.trim(), date: date || run.date,
      perUnit: cfg.perUnitLabel ? (per.trim() ? num(per) : null) : run.perUnit, waste: cfg.waste ? num(waste) : run.waste,
      units: units.map((u) => ({ at: u.at, qty: cfg.qty === 'none' ? null : u.qty.trim() ? num(u.qty) : null, ref: u.ref.trim(), by: u.by })),
    })
    onClose()
  }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg wide" onClick={(e) => e.stopPropagation()}>
        <h3>Corregir · {run.code} · {run.line}</h3>
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
        <p className="hint">Quita con ✕ una unidad tocada de más. Los cambios quedan al tocar Guardar.</p>
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
  const [reason, setReason] = useState(known ? stop.reason : 'Otra')
  const [other, setOther] = useState(known ? '' : stop.reason)
  const [note, setNote] = useState(stop.note)
  const [start, setStart] = useState(hm(stop.startedAt))
  const [end, setEnd] = useState(stop.endedAt ? hm(stop.endedAt) : '')
  const [dropping, setDropping] = useState(false)
  const ok = reason === 'Otra' ? other.trim().length > 0 : !!reason
  const save = () => {
    // a time left as it was keeps its seconds; only a changed one is re-read from HH:MM
    const startedAt = start === hm(stop.startedAt) ? stop.startedAt : onDay(stop.startedAt, start)
    let endedAt = stop.endedAt == null ? null : !end ? null : end === hm(stop.endedAt) ? stop.endedAt : onDay(stop.endedAt, end)
    if (endedAt != null && endedAt < startedAt) endedAt = startedAt
    updateStop(stop.id, { reason: reason === 'Otra' ? other.trim() : reason, note: note.trim(), startedAt, endedAt })
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
