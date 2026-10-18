import { useEffect, useId, useRef, useState } from 'react'
import { addRunLater, addUnit, applyDraft, BIN_WORDS, binOf, binWord, byLineName, cfgFor, checkLaterPallets, DEPTS, fmtN, kindClass, LATER_MAX, laterPalletUnits, laterPoFits, laterStart, laterToOrder, MFO_WORDS, tagTwice, type LaterPalletRow, plainDay, planRows, SPIRAL_UNITS, type Dept, byShip, CFG, cfgOf, deleteRun, deleteStop, draftOf, fmtDur, fmtTime, lineNameOf, lotsText, moveRun, nearDay, normCode, openRun, orderLabel, setUnitOrder, splitStop, store, updateRun, updateStop, type Order, type Run, type State, type Stop, lineLabel } from './store'
import { clockNow } from './clock'
import { ConfirmDialog, LotsDialog, useCan } from './App'
import { tr } from './i18n'
import { trx } from './trx'

/** "HH:MM" of a moment */
const hm = (ms: number) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }

/**
 * Fixing a run after the fact (a manager's job): the code, lot or date typed wrong, the pouches per cart, the waste, and
 * every unit registered (its quantity, its tag or bin number, or one tapped by mistake). A run recorded on the wrong
 * line's card is passed to the right one; one tapped on a line that was not working is dropped. A code finished too
 * early can be reopened.
 */
export function RunEditor({ s, run, mgr, focusAt, onClose }: { s: State; run: Run; mgr: boolean; focusAt?: number; onClose: () => void }) {
  const can = useCan()
  // opened from a unit of the report (a pallet, a cart): that unit is marked and brought into view inside the box
  const focusRow = useRef<HTMLTableRowElement>(null)
  useEffect(() => { focusRow.current?.scrollIntoView({ block: 'nearest' }) }, []) // (braces: in new browsers scrollIntoView returns a promise, which an effect must not return)
  // a Packing line that filled bins is corrected in a bin's words; a pallet carries a tag for each of its lots
  const cfg = cfgOf(run), tagsInLots = !!cfg.lots
  // how the form opened: saving applies only what was changed since, on top of what the run is by then
  const [opened] = useState(() => draftOf(run))
  const [code, setCode] = useState(opened.code)
  const [lot, setLot] = useState(opened.lot)
  const [date, setDate] = useState(opened.date)
  const [per, setPer] = useState(opened.per)
  const [waste, setWaste] = useState(opened.waste)
  const [units, setUnits] = useState(opened.units)
  const [dropping, setDropping] = useState(false)
  const [adding, setAdding] = useState(false) // a unit that was never recorded, added now
  const [lotsOf, setLotsOf] = useState<number | null>(null)
  const lineBusy = !!run.endedAt && !!openRun(s, run.lineId)
  // units tapped on the line while this form is open: they are kept as they are (one added from here is in the form)
  const later = run.units.filter((u) => !opened.units.some((o) => o.at === u.at) && !units.some((o) => o.at === u.at)).length
  // the order each unit goes to can be corrected, where the room fills orders and there is any (applied at once)
  const withOrders = !!cfg.orders && mgr && s.orders.length > 0
  const ordersFor = (po: string | undefined) => s.orders.filter((o) => normCode(o.code) === normCode(run.code) || o.id === po).sort(byShip)
  // the lines of the room, to pass the run to the one that really made it
  const lines = s.lines.filter((l) => l.dept === run.dept).sort(byLineName)
  const [lineId, setLineId] = useState(run.lineId)
  const [problem, setProblem] = useState('')
  const save = () => {
    if (lineId !== run.lineId && !moveRun(run.id, lineId)) { setProblem(tr('No se pudo pasar a esa línea: a esa hora tenía otro código, o ahora mismo está parada o en Set up.')); return }
    applyDraft(run.id, opened, { code, lot, date, per, waste, units })
    onClose()
  }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg wide" onClick={(e) => e.stopPropagation()}>
        <h3>{trx('Corregir · {0} · {1}', run.code, lineNameOf(s, run.lineId, run.line))}</h3>
        <div className="egrid">
          <label>{tr('Código')}{' '}<input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" /></label>
          <label>{tr('Lote')}{' '}<input value={lot} onChange={(e) => setLot(e.target.value)} inputMode="numeric" autoComplete="off" /></label>
          <label>{tr('Fecha')}{' '}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          {mgr && lines.length > 1 && (
            <label>{cfg.lineWord} <small>{tr('(si se registró en otra)')}</small>
              <select value={lineId} onChange={(e) => { setLineId(e.target.value); setProblem('') }}>
                {!lines.some((l) => l.id === run.lineId) && <option value={run.lineId}>{lineLabel(run.line)}</option>}
                {lines.map((l) => <option key={l.id} value={l.id}>{lineLabel(l.name)}</option>)}
              </select>
            </label>
          )}
          {cfg.perUnitLabel && <label>{cfg.perUnitLabel} <input value={per} onChange={(e) => setPer(e.target.value.replace(/\D/g, ''))} inputMode="numeric" autoComplete="off" /></label>}
          {cfg.waste && <label>{tr('Waste (lb)')}{' '}<input value={waste} onChange={(e) => setWaste(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" autoComplete="off" /></label>}
        </div>
        {units.length > 0 && (
          <div className="twrap">
            <table>
              <thead><tr><th>#</th><th>{tr('Hora')}</th>{cfg.qty !== 'none' && <th>{cfg.qtyUnit}</th>}{cfg.lots && <th>{tr('Lotes y tags')}</th>}{cfg.refLabel && !tagsInLots && <th>{cfg.refLabel}</th>}{withOrders && <th>{tr('Pedido')}</th>}<th>{tr('Por')}</th><th></th></tr></thead>
              <tbody>{units.map((u, i) => (
                <tr key={u.at + ':' + i} ref={focusAt != null && u.at === focusAt ? focusRow : undefined} className={focusAt != null && u.at === focusAt ? 'rp-focus' : undefined}>
                  <td>{i + 1}</td><td>{fmtTime(u.at)}</td>
                  {cfg.qty !== 'none' && <td><input className="num" inputMode="numeric" value={u.qty} disabled={!!u.lots?.length} title={u.lots?.length ? tr('Es la suma de sus lotes') : ''} onChange={(e) => setUnits(units.map((x, k) => (k === i ? { ...x, qty: e.target.value.replace(/\D/g, '') } : x)))} /></td>}
                  {cfg.lots && <td>{u.lots?.length ? lotsText(u.lots) : <small>{(lot || '—') + (u.ref ? ' (tag ' + u.ref + ')' : '')}</small>} <button type="button" className="lnk" title={tr('Cambiar los lotes y los tags de esta unidad')} onClick={() => setLotsOf(i)}>✎</button></td>}
                  {cfg.refLabel && !tagsInLots && <td><input className="num" value={u.ref} onChange={(e) => setUnits(units.map((x, k) => (k === i ? { ...x, ref: e.target.value } : x)))} autoComplete="off" /></td>}
                  {withOrders && (() => {
                    const po = run.units.find((x) => x.at === u.at)?.po, known = po && s.orders.some((o) => o.id === po) ? po : ''
                    return <td><select value={known} onChange={(e) => setUnitOrder(run.id, u.at, e.target.value)}><option value="">{tr('Sin pedido')}</option>{ordersFor(po).map((o) => <option key={o.id} value={o.id}>{orderLabel(o)}</option>)}</select></td>
                  })()}
                  <td>{u.by || '—'}</td>
                  <td><button type="button" className="lnk" title={tr('Quitar esta unidad')} onClick={() => setUnits(units.filter((_, k) => k !== i))}>✕</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="hint">{tr('Quita con ✕ una unidad tocada de más. Los cambios quedan al tocar Guardar.')}{later > 0 && ' ' + tr('Mientras corregías se {0}', (later === 1 ? tr('registró 1 {0} más: se conserva.', cfg.unit.toLowerCase()) : tr('registraron {0} {1} más: se conservan.', later, cfg.plural.toLowerCase())))}</p>
        {can('del') && <p className="hint">{tr('Si la línea no estaba trabajando y se tocó por error, "Borrar corrida" la saca del reporte. Todo cambio queda en el historial con tu nombre.')}</p>}
        {problem && <span className="err">{problem}</span>}
        <div className="dbtns spread">
          <div className="btns">
            {mgr && <button type="button" className="btn soft" onClick={() => setAdding(true)}>{trx('+ Agregar {0}', cfg.unit.toLowerCase())}</button>}
            {run.endedAt && <button type="button" className="btn" disabled={lineBusy} title={lineBusy ? tr('La línea ya corre otro código') : ''} onClick={() => { updateRun(run.id, { endedAt: null }); onClose() }}>{tr('Reabrir código')}</button>}
            {can('del') && <button type="button" className="btn danger" onClick={() => setDropping(true)}>{tr('🗑 Borrar corrida')}</button>}
          </div>
          <div className="btns">
            <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
            <button type="button" className="btn primary" onClick={save}>{tr('Guardar')}</button>
          </div>
        </div>
        {lotsOf != null && units[lotsOf] && <LotsDialog title={tr('Lotes de {0} {1}', cfg.unit.toLowerCase(), (lotsOf + 1))} unit={cfg.qtyUnit} refLabel={cfg.refLabel} lot={lot.trim()} qty={units[lotsOf].qty.trim() ? Number(units[lotsOf].qty) : null} start={units[lotsOf].lots} startRef={units[lotsOf].ref} onClose={() => setLotsOf(null)}
          onPick={(total, ref, lots) => { setUnits(units.map((x, k) => { if (k !== lotsOf) return x; const { lots: _was, ...bare } = x; return { ...bare, qty: String(total), ref, ...(lots ? { lots } : {}) } })); setLotsOf(null) }} />}
        {adding && <AddUnitDialog s={s} run={run} onClose={() => setAdding(false)} onAdded={(at, more) => {
          // the unit is on the run now; the form shows it among the others, and saving leaves it as it is. "Agregar y
          // otro" leaves the window open for the next one, so the list is added to as it goes
          if (!more) setAdding(false)
          const u = store.get().runs.find((r) => r.id === run.id)?.units.find((x) => x.at === at)
          if (u) setUnits((list) => [...list, { at: u.at, qty: u.qty != null ? String(u.qty) : '', ref: u.ref, by: u.by, ...(u.lots ? { lots: u.lots } : {}) }].sort((a, b) => a.at - b.at))
        }} />}
        {dropping && <ConfirmDialog title={tr('¿Borrar la corrida de {0}', run.code) + '?'} text={tr('Se borran sus unidades y su waste. No se puede deshacer.')} yes={tr('Borrar')} danger onYes={() => { deleteRun(run.id); onClose() }} onNo={() => setDropping(false)} />}
      </div>
    </div>
  )
}

/**
 * A unit nobody recorded is put on its run after the fact (a manager's job): the hour it was made, what it carried
 * (a pallet: each lot with its cases and its tag; a cart or a bin: its quantity and its number) and, where the room
 * fills orders, the order it went to. It lands among the others by its hour, and the history says who added it.
 * Several found together are added one after the other with "Agregar y otro" (Jose, 2026-10-18: "que podamos agregar
 * múltiples pallets más rápido"): each is saved as it is added, and the window stays open with its cases and tags (or
 * its quantity and number) blank again for the next; the hour and the order they chose stay, to be changed or not.
 * Nothing new is put in by the app. `more` = the window stays open. After one is added that way, nothing more is
 * added until something is typed or chosen again: a mezcla has nothing of its own to type, so its window stayed as it
 * was and a second tap (or a bouncing finger) added it twice at the same hour (seen in review); the next one asks
 * for another hour, or what it carries.
 */
export function AddUnitDialog({ s, run, onClose, onAdded }: { s: State; run: Run; onClose: () => void; onAdded: (at: number, more?: boolean) => void }) {
  const cfg = cfgOf(run), word = cfg.unit.toLowerCase(), tags = !!cfg.lots, fem = cfg.saved.endsWith('a')
  const [added, setAdded] = useState(0) // how many went on the run from this window, with "Agregar y otro"
  // held: one was just added with "Agregar y otro", and nothing has been typed or chosen since. The ref answers at
  // once, for a tap that comes before the screen has redrawn its buttons
  const [held, setHeld] = useState(false)
  const holding = useRef(false)
  const hold = (on: boolean) => { if (holding.current !== on) { holding.current = on; setHeld(on) } }
  // what has nothing of its own to type (a Kitchen or Spiral mezcla): the hour is what tells the next one apart
  const bare = !tags && cfg.qty === 'none'
  const [hm, setHm] = useState('')
  const [qty, setQty] = useState('')
  const [ref, setRef] = useState('')
  const [rows, setRows] = useState([{ lot: run.lot, qty: '', tag: '' }])
  const [po, setPo] = useState('')
  const orders = cfg.orders ? s.orders.filter((o) => normCode(o.code) === normCode(run.code)).sort(byShip) : []
  const end = run.endedAt ?? clockNow()
  // the hour is one of the run's day (a run that goes past midnight: the nearest to its start)
  const at = hm ? nearDay(run.startedAt, hm) : NaN
  const inside = Number.isFinite(at) && at >= run.startedAt && at <= end
  const nums = rows.map((r) => Number(r.qty))
  const repeated = rows.some((r, i) => !!r.lot.trim() && rows.findIndex((o) => o.lot.trim() === r.lot.trim()) !== i)
  const lotsOk = !tags || (!repeated && rows.every((r, i) => !!r.lot.trim() && Number.isFinite(nums[i]) && nums[i] > 0))
  const n = Number(qty.replace(',', '.'))
  const qtyOk = cfg.qty === 'none' || tags || (Number.isFinite(n) && n > 0)
  const ready = inside && lotsOk && qtyOk, ok = ready && !held
  const change = (i: number, patch: Partial<{ lot: string; qty: string; tag: string }>) => { hold(false); setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r))) }
  const save = (more = false) => {
    if (!ok || holding.current) return
    const lots = tags ? rows.map((r, i) => ({ lot: r.lot.trim(), qty: nums[i], ...(r.tag.trim() ? { tag: r.tag.trim() } : {}) })) : undefined
    const done = addUnit(run.id, { at, qty: cfg.qty === 'none' || tags ? null : n, ref: tags ? '' : ref, lots, po })
    if (!done) return
    if (more) {
      // the next one starts with what is its own blank (its cases and tags, its quantity and number); its lots, hour
      // and order stay as they chose them, in sight, so nothing is saved that they did not see
      setRows(rows.map((r) => ({ ...r, qty: '', tag: '' }))); setQty(''); setRef('')
      setAdded((k) => k + 1)
      hold(true)
    }
    onAdded(done, more)
  }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{trx('Agregar {0} · {1}', word, run.code)}</h3>
        <p>{trx('Para {0} que se hizo y nadie registró. La corrida va de {1} a {2}.', (cfg.saved.endsWith('a') ? tr('una') : tr('un')) + ' ' + word, fmtTime(run.startedAt), run.endedAt ? fmtTime(run.endedAt) : tr('ahora'))}</p>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); save() }}>
          <label>{tr('Hora en que salió')}{' '}<input type="time" value={hm} onChange={(e) => { hold(false); setHm(e.target.value) }} autoFocus /></label>
          {hm && !inside && <span className="err">{tr('Esa hora queda fuera de la corrida.')}</span>}
          {tags ? (
            <>
              {rows.map((r, i) => (
                <div className="lotrow" key={i}>
                  <label>{tr('Lote')}{' '}<input inputMode="numeric" placeholder={tr('ej. 6280')} value={r.lot} onChange={(e) => change(i, { lot: e.target.value })} autoComplete="off" /></label>
                  <label>{cfg.qtyUnit} <input inputMode="numeric" placeholder={cfg.qtyUnit} value={r.qty} onChange={(e) => change(i, { qty: e.target.value.replace(/\D/g, '') })} /></label>
                  <label>{tr('Tag')}{' '}<input inputMode="numeric" placeholder={tr('ej. 1749')} value={r.tag} onChange={(e) => change(i, { tag: e.target.value })} autoComplete="off" /></label>
                  {rows.length > 1 && <button type="button" className="lnk" title={tr('Quitar este lote')} onClick={() => { hold(false); setRows(rows.filter((_, k) => k !== i)) }}>✕</button>}
                </div>
              ))}
              <button type="button" className="lnk addlot" onClick={() => { hold(false); setRows([...rows, { lot: '', qty: '', tag: '' }]) }}>{tr('+ Otro lote en este pallet')}</button>
              {repeated && <span className="err">{trx('Ese lote ya está en la lista: suma sus {0} en una sola línea.', cfg.qtyUnit)}</span>}
            </>
          ) : (
            <>
              {cfg.qty !== 'none' && <label>{cfg.qtyUnit} <input inputMode={run.dept === 'Spiral' || binOf(run) === 'lb' ? 'decimal' : 'numeric'} value={qty} onChange={(e) => { hold(false); setQty(e.target.value.replace(/[^\d.,]/g, '')) }} /></label>}
              {cfg.refLabel && <label>{cfg.refLabel} <input value={ref} onChange={(e) => { hold(false); setRef(e.target.value) }} autoComplete="off" /></label>}
            </>
          )}
          {orders.length > 0 && (
            <label>{tr('Pedido')}{' '}<select value={po} onChange={(e) => { hold(false); setPo(e.target.value) }}><option value="">{tr('Sin pedido')}</option>{orders.map((o) => <option key={o.id} value={o.id}>{orderLabel(o)}</option>)}</select></label>
          )}
          {/* how many were added from this window: its place is kept from the start (empty until then), so the
              window does not grow under the finger and the buttons stay where they were. A mezcla's keeps a second
              line for what lets the next one be added */}
          <p className="addednote" role="status">
            <b>{added === 0 ? '' : added === 1 ? (fem ? tr('✓ 1 {0} agregada', word) : tr('✓ 1 {0} agregado', word)) : fem ? tr('✓ {0} {1} agregadas', added, cfg.plural.toLowerCase()) : tr('✓ {0} {1} agregados', added, cfg.plural.toLowerCase())}</b>
            {bare && <small>{held && ready ? tr('Para la siguiente, cambia la hora.') : ''}</small>}
          </p>
          <div className="dbtns more">
            {/* once one is added, closing keeps it: the button says so */}
            <button type="button" className="btn" onClick={onClose}>{added ? tr('Cerrar') : tr('Cancelar')}</button>
            <button type="button" className="btn soft" disabled={!ok} onClick={() => save(true)}>{tr('✓ Agregar y otro')}</button>
            <button type="submit" className="btn primary" disabled={!ok}>{trx('✓ Agregar {0}', word)}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Fixing a stop: its reason, its note, when it started and ended; or dropping one that was never real. */
export function StopEditor({ stop, mgr, onClose }: { stop: Stop; mgr: boolean; onClose: () => void }) {
  const can = useCan()
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
  const [dividing, setDividing] = useState(false)
  const ok = reason === 'Otra' ? other.trim().length > 0 : !!reason
  if (dividing) return <StopSplitter stop={stop} onBack={() => setDividing(false)} onClose={onClose} />
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
        <h3>{trx('Corregir paro · {0}', stop.dept)}</h3>
        <div className="chips">{[...reasons, 'Otra'].map((r) => <button key={r} type="button" className={'chip' + (reason === r ? ' on' : '')} onClick={() => setReason(r)}>{tr(r)}</button>)}</div>
        {reason === 'Otra' && <input placeholder={tr('Escribe la razón')} value={other} onChange={(e) => setOther(e.target.value)} />}
        <input placeholder={tr('Detalle (opcional)')} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="egrid">
          <label>{tr('Inicio')}{' '}<input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          {stop.endedAt != null && <label>{tr('Fin')}{' '}<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></label>}
        </div>
        <div className="dbtns spread">
          <div className="btns">
            {mgr && <button type="button" className="lnk" onClick={() => setDividing(true)}>{tr('✂ Dividir en dos causas')}</button>}
            {can('del') && <button type="button" className="btn danger" onClick={() => setDropping(true)}>{tr('🗑 Borrar paro')}</button>}
          </div>
          <div className="btns">
            <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
            <button type="button" className="btn primary" disabled={!ok} onClick={save}>{tr('Guardar')}</button>
          </div>
        </div>
        {dropping && <ConfirmDialog title={tr('¿Borrar este paro?')} text={tr('Deja de contar como tiempo parado. No se puede deshacer.')} yes={tr('Borrar')} danger onYes={() => { deleteStop(stop.id); onClose() }} onNo={() => setDropping(false)} />}
      </div>
    </div>
  )
}

/**
 * One stop, two causes: the manager says how many minutes belong to the reason it has, and which reason the rest was
 * for. The stopped time of the line stays the same; it is only told apart. A part can be divided again.
 */
function StopSplitter({ stop, onBack, onClose }: { stop: Stop; onBack: () => void; onClose: () => void }) {
  const reasons = CFG[stop.dept].reasons.filter((r) => r !== stop.reason)
  // the moment the box opened stands in for "now" on a stop still open: the numbers do not move while they are read
  const [end] = useState(() => stop.endedAt ?? clockNow())
  const total = Math.floor((end - stop.startedAt) / 60_000)
  const [mins, setMins] = useState(() => String(Math.max(1, Math.floor(total / 2))))
  const [reason, setReason] = useState('')
  const [other, setOther] = useState('')
  const [note, setNote] = useState('')
  const first = Number(mins)
  const cut = stop.startedAt + first * 60_000
  const second = reason === 'Otra' ? other.trim() : reason
  const fits = Number.isInteger(first) && first >= 1 && cut < end
  const ok = fits && !!second
  const go = () => { if (ok && splitStop(stop.id, cut, second, note)) onClose() }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{trx('Dividir paro · {0}', stop.dept)}</h3>
        {total < 2 ? <p>{tr('Este paro dura menos de dos minutos: no hay tiempo que dividir.')}</p> : (
          <>
            <p><b>{tr(stop.reason)}</b> · {fmtTime(stop.startedAt)} – {stop.endedAt ? fmtTime(stop.endedAt) : tr('en curso')} · {fmtDur(end - stop.startedAt)}</p>
            <label className="splitmins">{trx('¿Cuántos minutos fueron por {0}?', <b>{tr(stop.reason)}</b>)}{' '}<input className="num" inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value.replace(/\D/g, ''))} /> <small>{trx('de {0}', total)}</small></label>
            <p>{tr('El resto fue por:')}</p>
            <div className="chips">{[...reasons, 'Otra'].map((r) => <button key={r} type="button" className={'chip' + (reason === r ? ' on' : '')} onClick={() => setReason(r)}>{tr(r)}</button>)}</div>
            {reason === 'Otra' && <input placeholder={tr('Escribe la razón')} value={other} onChange={(e) => setOther(e.target.value)} />}
            <input placeholder={tr('Detalle (opcional)')} value={note} onChange={(e) => setNote(e.target.value)} />
            {fits
              ? <p className="splitsum">{trx('Queda así: {0} {1} – {2} ({3} min) · {4} {5} – {6} ({7})', <b>{tr(stop.reason)}</b>, fmtTime(stop.startedAt), fmtTime(cut), first, <b>{second || '…'}</b>, fmtTime(cut), stop.endedAt ? fmtTime(stop.endedAt) : tr('en curso'), stop.endedAt ? total - first + ' min' : tr('sigue'))}</p>
              : <p className="err">{trx('Escribe un número entre 1 y {0}.', total - 1)}</p>}
          </>
        )}
        <div className="dbtns">
          <button type="button" className="btn" onClick={onBack}>{tr('Volver')}</button>
          <button type="button" className="btn primary" disabled={!ok || total < 2} onClick={go}>{tr('✂ Dividir')}</button>
        </div>
      </div>
    </div>
  )
}

/**
 * A code that ran and nobody recorded (the office: "they did four and did not register them"), put on its line after
 * the fact: the room, the line, the code, the day and the hours; how many units and what each carried; a lot, tags or
 * bin numbers, waste and who made it when they are known. What is not known stays blank. The run lands closed, with
 * its units spread over its hours, and the history says who added it (see addRunLater).
 * Packing's pallets are written one by one in a list, each with its cases, its tag and its order (Jose, 2026-10-18:
 * "que aparezca lo de poner PO cuando estamos agregando registro en packing y también que podamos agregar múltiples
 * pallets más rápido"): see LaterPallets.
 * Opened from an order of Packing's Pedidos tab (its "+ Pallets"), it starts on that order: see laterStart. Without
 * one it opens as it always did.
 */
export function AddRunDialog({ s, date, dept: first, order, onClose, onAdded }: { s: State; date: string; dept?: Dept; order?: Order; onClose: () => void; onAdded: (id: string) => void }) {
  // how it opens, taken once: an order that changes while the window is open does not reset what is being typed
  const [start] = useState(() => laterStart(first, order))
  const [dept, setDept] = useState<Dept>(start.dept)
  const lines = s.lines.filter((l) => l.dept === dept && !l.deleted).sort(byLineName)
  const [linePick, setLinePick] = useState('')
  const line = lines.find((l) => l.id === linePick) ?? lines[0]
  const [code, setCode] = useState(start.code)
  const [lot, setLot] = useState('')
  const [day, setDay] = useState(date)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [count, setCount] = useState('')
  const [each, setEach] = useState('')
  const [refs, setRefs] = useState('')
  const [waste, setWaste] = useState('')
  const [madeBy, setMadeBy] = useState('')
  const [problem, setProblem] = useState('')
  const formId = useId()
  // Packing's pallets one by one, and the order its quick bar gives to the ones it adds (see LaterPallets). Their
  // keys are counted here, with the list, and not in LaterPallets: the list stays when Bins (or another room) is
  // tapped and Pallets again, and LaterPallets then starts anew; a count of its own went back to 0 and gave a new
  // pallet the key of one on the list, so typing in one changed the other and ✕ took both off (seen in review)
  const [pallets, setPallets] = useState<LaterPallet[]>([])
  const [quickPo, setQuickPo] = useState(start.quickPo)
  const palletKeys = useRef(0)
  // how the code is counted, chosen with the same coloured buttons as on the line: Packing in pallets or in bins of
  // a word, MFO in bins of platos, copas or pounds, Spiral in mezclas, pounds or cases; the words of the form follow
  const [kindPick, setKindPick] = useState<string | null>(start.kind)
  const [binText, setBinText] = useState('')
  const kinds: { word: string; label: string; hint: string }[] = dept === 'Packing' ? [{ word: '', label: tr('Pallets'), hint: tr('cajas con su tag') }, { word: 'bin', label: tr('Bins'), hint: tr('platos, copas, pouches…') }]
    : dept === 'MFO' ? MFO_WORDS.map((w) => ({ word: w, label: w === 'lb' ? tr('Libras') : w === 'copas' ? tr('Copas') : tr('Platos'), hint: w === 'lb' ? tr('cada bin se pesa') : w === 'copas' ? tr('cada bin dice cuántas') : tr('cada bin dice cuántos') }))
    : dept === 'Spiral' ? SPIRAL_UNITS.map((u) => ({ word: u === 'mezclas' ? '' : u, label: u === 'mezclas' ? tr('Mezclas') : u === 'lb' ? tr('Libras') : tr('Cajas'), hint: u === 'mezclas' ? tr('una por una') : u === 'lb' ? tr('cada mezcla dice sus libras') : tr('cada mezcla dice sus cajas') }))
    : []
  const kind = kinds.some((k) => k.word === kindPick) ? (kindPick as string) : (kinds[0]?.word ?? '')
  // Packing's bins: the word for what they hold, one of the usual or typed
  const binWordNow = binText.trim() || BIN_WORDS[0]
  const word = dept === 'Packing' ? (kind === 'bin' ? binWordNow : '') : kind
  const cfg = cfgFor(dept, word), unit = cfg.unit.toLowerCase(), plural = cfg.plural.toLowerCase()
  // the hours are of that day of work: a night shift's 1:00 AM is the next calendar day (a day of work runs from one
  // night to the next, so the hour nearest the day's afternoon is the one meant)
  const base = new Date(day + 'T15:30:00').getTime()
  const startAt = from && day ? nearDay(base, from) : NaN
  const endAt = to && day ? nearDay(base, to) : null
  const startOk = Number.isFinite(startAt) && plainDay(s, startAt) === day
  const endOk = endAt == null || (endAt >= startAt && plainDay(s, endAt) === day)
  const n = count.trim() ? Number(count) : 0
  // a quantity per unit typed with no units is a record of nothing: on 2026-10-18 Packing typed 36 cases and left
  // "Cuántos pallets" blank, and the record showed 0 cases and 0 pallets. It is not saved until the units are said
  const countMissing = n === 0 && !!each.trim()
  const per = each.trim() ? Number(each.replace(',', '.')) : null
  // Packing's pallets: the list of them takes the place of how many, cases per pallet and the tags in a row. Only
  // what was typed or chosen is in it; the orders offered are the code's, as when a pallet is added to a run
  const byPallet = dept === 'Packing' && kind === ''
  const orders = byPallet && code.trim() ? s.orders.filter((o) => normCode(o.code) === normCode(code)).sort(byShip) : []
  const listed = checkLaterPallets(pallets)
  const ok = !!line && !!code.trim() && !!day && startOk && endOk && (byPallet ? listed.ok : Number.isInteger(n) && n >= 0 && n <= LATER_MAX && (per == null || (Number.isFinite(per) && per >= 0)) && !countMissing)
  const program = planRows(s, day, dept).filter((r) => r.planned > 0).map((r) => r.code)
  // another code: an order chosen for the one typed before is not this one's, and the pallets that had it go back to
  // "Sin pedido" (never moved to another order on their own)
  const changeCode = (c: string) => {
    setCode(c)
    const fits = (po: string) => laterPoFits(s, po, c)
    setPallets((list) => (list.every((p) => fits(p.po)) ? list : list.map((p) => (fits(p.po) ? p : { ...p, po: '' }))))
    if (!fits(quickPo)) setQuickPo('')
  }
  const save = () => {
    if (!ok || !line) return
    const refList = refs.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean)
    // the pallets, each as the line keeps one (see laterPalletUnits); the other units, as many as they said
    const { units, perUnit } = byPallet ? laterPalletUnits(s, code, lot, pallets)
      : { units: Array.from({ length: n }, (_, i) => ({ qty: cfg.qty === 'none' ? null : per, ref: refList[i] ?? '' })), perUnit: cfg.perUnitLabel && per != null ? per : null }
    const id = addRunLater({ dept, lineId: line.id, code, lot, date: day, startedAt: startAt, endedAt: endAt, units, perUnit, waste: cfg.waste && waste.trim() ? Number(waste.replace(',', '.')) || 0 : 0, bin: dept === 'Spiral' ? '' : word, measure: dept === 'Spiral' && (word === 'lb' || word === 'cajas') ? word : '', madeBy })
    if (!id) { setProblem(tr('A esas horas la línea tenía otro código. Cambia la línea o las horas.')); return }
    onAdded(id)
  }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg wide" onClick={(e) => e.stopPropagation()}>
        <h3>{trx('Agregar un registro · {0}', dept)}</h3>
        {/* opened from an order: which one, how many pallets of the list go to it, and whether the ones added now go
            to it too (they take the quick bar's Pedido: with another order or "Sin pedido" there, another code, the
            bins or another room, they do not), so nobody believes pallets went, or did not go, to it (see laterToOrder:
            from the bar alone it said nothing went while pallets on the list carried the order, and they could be
            added twice) */}
        {order && (() => {
          const to = laterToOrder(s, order.id, { byPallet, code, quickPo, list: pallets })
          const name = <b>{orderLabel(order)}</b>, c = <b className="code">{order.code}</b>, k = <b>{to.listed === 1 ? tr('1 pallet') : tr('{0} pallets', to.listed)}</b>
          if (to.next) return <p className="fromorder">{to.listed ? trx('Para el pedido {0} · código {1}: {2} de la lista y los que agregues van a ese pedido; se puede cambiar en la barra y en cada pallet.', name, c, k) : trx('Para el pedido {0} · código {1}. Los pallets que agregues van a ese pedido; se puede cambiar en la barra y en cada pallet.', name, c)}</p>
          if (to.listed) return <p className="fromorder">{to.listed === 1 ? trx('Para el pedido {0} · código {1}: {2} de la lista va a ese pedido. Los que agregues ahora no, porque la barra no tiene ese pedido.', name, c, k) : trx('Para el pedido {0} · código {1}: {2} de la lista van a ese pedido. Los que agregues ahora no, porque la barra no tiene ese pedido.', name, c, k)}</p>
          return <p className="fromorder off">{trx('Abierto desde el pedido {0} · código {1}. Así como está ahora, lo que agregues no va a ese pedido.', name, c)}</p>
        })()}
        <p>{tr('Para un código que se hizo y nadie registró. Pon lo que sepas; lo demás se deja en blanco. Queda en el historial con tu nombre.')}</p>
        {/* the list of pallets has a little form of its own (its quick bar), so it sits beside this one, not inside
            it: its Enter adds to the list, and the record is saved only with "✓ Agregar" (tied to this form by its id) */}
        <form id={formId} className="qform" onSubmit={(e) => { e.preventDefault(); save() }}>
          <div className="egrid">
            <label>{tr('Departamento')}{' '}<select value={dept} onChange={(e) => { setDept(e.target.value as Dept); setLinePick(''); setKindPick(null); setBinText(''); setProblem('') }}>{DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
            <label>{cfg.lineWord}{' '}<select value={line?.id ?? ''} onChange={(e) => { setLinePick(e.target.value); setProblem('') }}>{lines.map((l) => <option key={l.id} value={l.id}>{lineLabel(l.name)}</option>)}</select></label>
          </div>
          {kinds.length > 0 && (
            <div className="makes">
              <span className="lab">{dept === 'Packing' ? tr('¿Qué hicieron?') : dept === 'MFO' ? tr('¿Qué llevan los bins?') : tr('¿En qué se cuenta este código?')}</span>
              <div className="seg" role="group" aria-label={dept === 'Packing' ? tr('¿Qué hicieron?') : dept === 'MFO' ? tr('¿Qué llevan los bins?') : tr('¿En qué se cuenta este código?')}>
                {kinds.map((k) => <button key={k.word} type="button" className={kindClass(dept, k.word === 'bin' ? 'platos' : k.word) + (kind === k.word ? ' on' : '')} aria-pressed={kind === k.word} onClick={() => setKindPick(k.word)}>{k.label}<small>{k.hint}</small></button>)}
              </div>
              {dept === 'Packing' && kind === 'bin' && (
                <div className="binwords">
                  <span>{tr('Cada bin lleva:')}</span>
                  {BIN_WORDS.map((w) => <button key={w} type="button" className={'chip sm' + (binWordNow === w ? ' on' : '')} aria-pressed={binWordNow === w} onClick={() => setBinText(w)}>{binWord(w)}</button>)}
                  <input value={BIN_WORDS.includes(binWordNow) ? '' : binText} placeholder={tr('Otra cosa')} aria-label={tr('Otra cosa')} onChange={(e) => setBinText(e.target.value)} autoComplete="off" />
                </div>
              )}
            </div>
          )}
          <div className="egrid">
            <label>{tr('Código')}{' '}<input value={code} onChange={(e) => changeCode(e.target.value)} placeholder={tr('ej. 0100')} autoComplete="off" autoFocus /></label>
            <label>{tr('Lote')} <small>{tr('(si se sabe)')}</small><input value={lot} onChange={(e) => setLot(e.target.value)} inputMode="numeric" placeholder={tr('ej. 6280')} autoComplete="off" /></label>
            <label>{tr('Fecha')}{' '}<input type="date" value={day} onChange={(e) => { setDay(e.target.value); setProblem('') }} /></label>
            <label>{tr('Empezó')}{' '}<input type="time" value={from} onChange={(e) => { setFrom(e.target.value); setProblem('') }} /></label>
            <label>{tr('Terminó')} <small>{tr('(si no, con la última unidad)')}</small><input type="time" value={to} onChange={(e) => { setTo(e.target.value); setProblem('') }} /></label>
            {!byPallet && <label>{cfg.saved.endsWith('a') ? tr('Cuántas {0}', plural) : tr('Cuántos {0}', plural)}{' '}<input value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder={tr('ej. 6')} autoComplete="off" /></label>}
            {!byPallet && cfg.qty !== 'none' && <label>{tr('{0} por {1}', cfg.qtyUnit, unit)} <small>{tr('(si se sabe)')}</small><input value={each} onChange={(e) => setEach(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" autoComplete="off" /></label>}
            {!byPallet && cfg.refLabel && <label>{cfg.refLabel} <small>{tr('(en orden, separados por coma)')}</small><input value={refs} onChange={(e) => setRefs(e.target.value)} placeholder={tr('ej. 1741, 1742')} autoComplete="off" /></label>}
            {cfg.waste && <label>{tr('Waste (lb)')}{' '}<input value={waste} onChange={(e) => setWaste(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" autoComplete="off" /></label>}
            <label>{tr('Quién lo hizo')} <small>{tr('(si se sabe)')}</small><input value={madeBy} onChange={(e) => setMadeBy(e.target.value)} autoComplete="off" /></label>
          </div>
          {program.length > 0 && <div className="chips">{program.map((c) => <button key={c} type="button" className={'chip sm' + (normCode(code) === normCode(c) ? ' on' : '')} onClick={() => changeCode(c)}>{c}</button>)}</div>}
        </form>
        {byPallet && <LaterPallets orders={orders} list={pallets} setList={setPallets} nextKey={() => ++palletKeys.current} quickPo={quickPo} setQuickPo={setQuickPo} oneTakesBar={start.oneTakesBar} />}
        {!byPallet && countMissing && <span className="err">{cfg.saved.endsWith('a') ? tr('Escribe cuántas {0} se hicieron: sin eso el registro queda en 0.', plural) : tr('Escribe cuántos {0} se hicieron: sin eso el registro queda en 0.', plural)}</span>}
        {from && !startOk && <span className="err">{tr('Esa hora cae en otro día de trabajo.')}</span>}
        {to && !endOk && <span className="err">{tr('Termina antes de empezar, o en otro día de trabajo.')}</span>}
        {problem && <span className="err">{problem}</span>}
        <div className="dbtns">
          <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
          <button type="submit" form={formId} className="btn primary" disabled={!ok}>{tr('✓ Agregar')}</button>
        </div>
      </div>
    </div>
  )
}

/** one pallet of the list in "Agregar un registro", as it was typed (key: React's, for the pallets taken off) */
type LaterPallet = LaterPalletRow & { key: number }

/**
 * Packing's pallets of a record added after the fact, one by one (Jose, 2026-10-18: "que aparezca lo de poner PO
 * cuando estamos agregando registro en packing y también que podamos agregar múltiples pallets más rápido"): each with
 * its cases, its tag and its order, as a pallet finished on the line has them. The quick bar adds so many pallets of so
 * many cases for an order at once (their tags blank, to be written one by one), "+ Un pallet" adds one blank, and ✕
 * takes one off. The list starts empty and holds only what was typed or chosen: the app fills nothing in on its own
 * (Jose's rule: no guessed data). Under it, what it adds up to, in all and order by order.
 * Opened from an order (oneTakesBar), "+ Un pallet" gives the order the quick bar's Pedido has, which starts on the
 * one tapped: that order is in sight, chosen by the person, and stays editable on the pallet's row.
 */
function LaterPallets({ orders, list, setList, nextKey, quickPo, setQuickPo, oneTakesBar }: { orders: Order[]; list: LaterPallet[]; setList: (l: LaterPallet[]) => void; nextKey: () => number; quickPo: string; setQuickPo: (po: string) => void; oneTakesBar: boolean }) {
  const [many, setMany] = useState('')
  const [each, setEach] = useState('')
  const check = checkLaterPallets(list)
  // an order is shown and given only while it is one of the code's (the code can change after it was chosen)
  const poOf = (po: string) => (orders.some((o) => o.id === po) ? po : '')
  const k = many ? Number(many) : 0, c = each ? Number(each) : 0, room = LATER_MAX - list.length
  const quickOk = k > 0 && k <= room && c > 0
  const blank = (qty: string, po: string): LaterPallet => ({ key: nextKey(), qty, tag: '', po })
  // the count is cleared once they are on the list (a second tap does not add them twice); the cases and the order stay
  const addMany = () => { if (!quickOk) return; const po = poOf(quickPo); setList([...list, ...Array.from({ length: k }, () => blank(String(c), po))]); setMany('') }
  const change = (key: number, patch: Partial<LaterPallet>) => setList(list.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  const sum = (rows: LaterPallet[]) => { const n = rows.length, cases = rows.reduce((t, p) => t + (Number(p.qty) > 0 ? Number(p.qty) : 0), 0); return (n === 1 ? tr('1 pallet') : tr('{0} pallets', n)) + ' · ' + tr('{0} cajas', fmtN(cases)) }
  const byOrder = orders.map((o) => ({ o, rows: list.filter((p) => p.po === o.id) })).filter((x) => x.rows.length > 0)
  const noOrder = list.filter((p) => !poOf(p.po))
  const withPo = orders.length > 0
  const options = <><option value="">{tr('Sin pedido')}</option>{orders.map((o) => <option key={o.id} value={o.id}>{orderLabel(o)}</option>)}</>
  return (
    <div className="lp">
      <span className="lab">{tr('Los pallets, uno por uno')}</span>
      <form className="lp-quick" onSubmit={(e) => { e.preventDefault(); addMany() }}>
        <span className="lp-say">{trx('Agregar {0} pallets de {1} cajas', <input key="k" className="num" inputMode="numeric" value={many} onChange={(e) => setMany(e.target.value.replace(/\D/g, ''))} aria-label={tr('Cuántos pallets')} autoComplete="off" />, <input key="c" className="num" inputMode="numeric" value={each} onChange={(e) => setEach(e.target.value.replace(/\D/g, ''))} aria-label={tr('Cajas de cada pallet')} autoComplete="off" />)}</span>
        {withPo && <label className="lp-po">{tr('Pedido')}{' '}<select value={poOf(quickPo)} onChange={(e) => setQuickPo(e.target.value)}>{options}</select></label>}
        <button type="submit" className="btn soft" disabled={!quickOk}>{tr('+ Agregar a la lista')}</button>
      </form>
      {k > room && <span className="err">{tr('Un registro lleva hasta {0} pallets: caben {1} más.', LATER_MAX, room)}</span>}
      {list.length > 0 ? (
        <div className={'lp-rows' + (withPo ? ' po' : '')}>
          <div className="lp-row head" aria-hidden="true"><span>#</span><span>{tr('Cajas')}</span><span>{tr('Tag')}</span>{withPo && <span>{tr('Pedido')}</span>}<span /></div>
          {list.map((p, i) => {
            const twice = tagTwice(check.twice, p.tag), short = p.qty !== '' && Number.isNaN(check.cases[i])
            return (
              <div key={p.key} className="lp-row">
                <b className="lp-n">{i + 1}</b>
                <label className="lp-c"><span>{tr('Cajas')}</span><input className={short ? 'bad' : ''} aria-invalid={short || undefined} inputMode="numeric" value={p.qty} onChange={(e) => change(p.key, { qty: e.target.value.replace(/\D/g, '') })} aria-label={tr('Cajas del pallet {0}', i + 1)} autoComplete="off" /></label>
                <label className="lp-t"><span>{tr('Tag')}</span><input className={twice ? 'bad' : ''} aria-invalid={twice || undefined} inputMode="numeric" maxLength={30} value={p.tag} onChange={(e) => change(p.key, { tag: e.target.value })} aria-label={tr('Tag del pallet {0}', i + 1)} autoComplete="off" /></label>
                {withPo && <label className="lp-p"><span>{tr('Pedido')}</span><select value={poOf(p.po)} onChange={(e) => change(p.key, { po: e.target.value })} aria-label={tr('Pedido del pallet {0}', i + 1)}>{options}</select></label>}
                <button type="button" className="btn xs lp-x" title={tr('Quitar este pallet')} aria-label={tr('Quitar el pallet {0}', i + 1)} onClick={() => setList(list.filter((x) => x.key !== p.key))}>✕</button>
              </div>
            )
          })}
        </div>
      ) : <p className="hint">{tr('Todavía no hay pallets en la lista: agrégalos con la barra de arriba, o de uno en uno.')}</p>}
      <button type="button" className="btn soft sm lp-one" disabled={list.length >= LATER_MAX} onClick={() => setList([...list, blank('', oneTakesBar ? poOf(quickPo) : '')])}>{tr('+ Un pallet')}</button>
      {list.length > 0 && (
        <div className="lp-total">
          <b>{sum(list)}</b>
          {byOrder.map(({ o, rows }) => <span key={o.id}>{orderLabel(o)}: {sum(rows)}</span>)}
          {byOrder.length > 0 && noOrder.length > 0 && <span>{tr('Sin pedido')}: {sum(noOrder)}</span>}
        </div>
      )}
      {check.missing.length > 0 && <span className="hint red">{check.missing.length === 1 ? tr('Falta escribir las cajas del pallet {0}.', check.missing[0]) : tr('Falta escribir las cajas de los pallets {0}.', check.missing.slice(0, 12).join(', ') + (check.missing.length > 12 ? '…' : ''))}</span>}
      {check.twice.length > 0 && <span className="err">{check.twice.length === 1 ? tr('El tag {0} está más de una vez en la lista.', check.twice[0]) : tr('Los tags {0} están más de una vez en la lista.', check.twice.join(', '))}</span>}
    </div>
  )
}
