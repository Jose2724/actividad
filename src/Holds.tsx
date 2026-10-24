import { useState } from 'react'
import { createPortal } from 'react-dom'
import { cfgOf, fmtTime, holdOf, holdRelease, holdReject, holdSetDiscount, holdsOpen, holdUnit, lineNameOf, orderLabel, orderOfId, type Dept, type HoldRec, type State } from './store'
import { useCan, useViewOnly } from './App'
import { tr } from './i18n'

/**
 * Units on hold (2026-10-23: "que se pueda poner en hold registros y tener la opción de omitir el conteo"; Packing the
 * same, "si se cuenta como un pallet o se descuenta y se va a la lista de on hold"). Only managers and the office put a
 * unit on hold, choose whether it still counts, and release or reject it (Jose: "solo managers y oficina"). The list
 * shows each room's units on hold to everybody, with what they are and why.
 */

/** "⏸ Hold" on a unit already recorded: opens the question; a unit on hold says so instead */
export function HoldButton({ s, runId, at, dept }: { s: State; runId: string; at: number; dept: Dept }) {
  const can = useCan(), viewOnly = useViewOnly()
  const [open, setOpen] = useState(false)
  const h = holdOf(s, runId, at)
  if (h) return <span className="hold-tag" title={h.note}>{tr('⏸ en hold')}</span>
  if (!can('fix') || viewOnly) return null
  return (
    <>
      <button type="button" className="btn xs hold-btn" onClick={() => setOpen(true)}>{tr('⏸ Hold')}</button>
      {/* over everything: it is also opened from inside other windows (a PO's pallets, Corregir), whose
          backdrop must not get its taps (React passes them up through the portal) */}
      {open && createPortal(<div onClick={(e) => e.stopPropagation()}><HoldDialog s={s} runId={runId} at={at} dept={dept} onClose={() => setOpen(false)} /></div>, document.body)}
    </>
  )
}

function HoldDialog({ s, runId, at, dept, onClose }: { s: State; runId: string; at: number; dept: Dept; onClose: () => void }) {
  const r = s.runs.find((x) => x.id === runId), u = r?.units.find((x) => x.at === at)
  const [discount, setDiscount] = useState<boolean | null>(null)
  const [note, setNote] = useState('')
  if (!r || !u) return null
  const cfg = cfgOf(r), n = r.units.indexOf(u) + 1, po = orderOfId(s, u.po)
  return (
    <div className="veil rc-veil" onClick={onClose}>
      <form className="dlg hold-dlg" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (discount != null && holdUnit(runId, at, discount, note)) onClose() }}>
        <h3>{tr('⏸ Poner en hold · {0} {1}', cfg.unit, n)}</h3>
        <p className="hint">{dept} · {lineNameOf(s, r.lineId, r.line)} · <b>{r.code}</b> {tr('lote {0}', r.lot)} · {fmtTime(at)}{u.qty != null ? ' · ' + u.qty + ' ' + cfg.qtyUnit : ''}{u.ref ? ' · ' + u.ref : ''}{po ? ' · ' + orderLabel(po) : ''}</p>
        <div className="hold-choice">
          <button type="button" className={'hold-opt' + (discount === true ? ' on' : '')} onClick={() => setDiscount(true)}><b>{tr('Se descuenta')}</b><small>{po ? tr('Deja de contar en el total y en su PO: al PO le vuelve a faltar y Packing puede hacer otro.') : tr('Deja de contar en el total hasta que se libere.')}</small></button>
          <button type="button" className={'hold-opt' + (discount === false ? ' on' : '')} onClick={() => setDiscount(false)}><b>{tr('Sigue contando')}</b><small>{tr('Cuenta como siempre; solo queda marcado en la lista de on hold.')}</small></button>
        </div>
        <label>{tr('¿Por qué? (opcional)')}<textarea rows={2} maxLength={300} value={note} placeholder={tr('ej. revisar temperatura / peso / etiqueta')} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="dbtns"><button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button><button type="submit" className="btn primary" disabled={discount == null}>{tr('⏸ Poner en hold')}</button></div>
      </form>
    </div>
  )
}

/** a room's units on hold now, each with what it is, why, and (for managers and the office) what to do with it */
export function HoldList({ s, dept }: { s: State; dept: Dept }) {
  const can = useCan(), viewOnly = useViewOnly()
  const list = holdsOpen(s, dept)
  const [said, setSaid] = useState('')
  const act = !viewOnly && can('fix')
  if (!list.length) return <p className="hint">{tr('No hay nada en hold en {0}.', dept)}</p>
  const unitWord = (h: HoldRec) => { const r = s.runs.find((x) => x.id === h.runId); return r ? cfgOf(r).unit : '' }
  return (
    <div className="hold-list">
      <p className="hint">{tr('Lo puesto en hold mientras se revisa. Liberar: vuelve a contar. Rechazar: no cuenta (si hicieron otro, ese es el que cuenta).')}</p>
      {said && <p className="hint amber">{said}</p>}
      {list.map((h) => { const po = orderOfId(s, h.unit.po); return (
        <div key={h.id} className={'hold-row' + (h.discount ? ' off' : '')}>
          <div className="hold-what"><b className="code">{h.code}</b> <span>{tr('lote {0}', h.lot)}</span> · {unitWord(h)} {h.n} · {h.line}{h.unit.qty != null ? ' · ' + h.unit.qty : ''}{h.unit.ref ? ' · ' + h.unit.ref : ''}{po ? ' · ' + orderLabel(po) : ''}</div>
          <div className="hold-state">{h.discount ? <b className="red">{tr('descontado')}</b> : <b>{tr('sigue contando')}</b>} · {tr('desde {0} · {1}', fmtTime(h.at), h.by)} · {h.date}</div>
          {h.note && <div className="hold-note">💬 {h.note}</div>}
          {act && <div className="btns">
            <button type="button" className="btn sm primary" onClick={() => { if (!holdRelease(h.id)) setSaid(tr('No se pudo volver a poner: la corrida ya no está en este aparato.')) }}>{tr('✓ Liberar')}</button>
            <button type="button" className="btn sm" onClick={() => { if (!holdSetDiscount(h.id, !h.discount)) setSaid(tr('No se pudo volver a poner: la corrida ya no está en este aparato.')) }}>{h.discount ? tr('Que siga contando') : tr('Descontarlo')}</button>
            <button type="button" className="btn sm danger" onClick={() => holdReject(h.id)}>{tr('✕ Rechazar')}</button>
          </div>}
        </div>
      ) })}
    </div>
  )
}
