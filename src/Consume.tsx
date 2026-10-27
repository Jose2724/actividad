import { useState } from 'react'
import { consumeAdd, consumeDelete, consumeLeft, consumesOfRun, fmtTime, inventoryOf, lineLabel, type ConsumeEntry, type Dept, type Run, type State } from './store'
import { tr } from './i18n'

/**
 * What a room consumes (the office, 2026-10-27): before a code starts the line weighs what it is going to use (what it
 * is, its lot, the date on its label, the pounds), mandatory where a manager turned it on in Ajustes; when the code
 * ends it says whether all was consumed or how many pounds were left, and what is left is the room's inventory,
 * offered when the next code starts. Nothing is filled by itself: what is left is shown as a chip to tap, and the
 * pounds are typed again (they weigh it).
 */
const lbText = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-US')
export type ConsumeDraft = { product: string; prodLot: string; labelDate: string; lb: number; fromId: string }
const what = (x: { product: string; prodLot: string; labelDate: string }) => x.product + (x.prodLot ? ' · ' + tr('lote {0}', x.prodLot) : '') + (x.labelDate ? ' · ' + x.labelDate : '')

/** the form of one entry: the inventory to tap, what it is, its lot, its label's date and the pounds */
function ConsumeForm({ s, dept, onAdd }: { s: State; dept: Dept; onAdd: (d: ConsumeDraft) => void }) {
  const [product, setProduct] = useState(''), [prodLot, setProdLot] = useState(''), [labelDate, setLabelDate] = useState(''), [lb, setLb] = useState(''), [fromId, setFromId] = useState('')
  const [bad, setBad] = useState(false)
  const inv = inventoryOf(s, dept)
  const pick = (x: ConsumeEntry) => { setProduct(x.product); setProdLot(x.prodLot); setLabelDate(x.labelDate); setFromId(x.id); setLb('') }
  const add = () => {
    const n = Number(lb.replace(',', '.'))
    if (!product.trim() || !(n > 0 && n < 100000)) { setBad(true); return }
    onAdd({ product: product.trim(), prodLot: prodLot.trim(), labelDate, lb: Math.round(n * 100) / 100, fromId })
    setProduct(''); setProdLot(''); setLabelDate(''); setLb(''); setFromId(''); setBad(false)
  }
  return (
    <form className="cons-form" onSubmit={(e) => { e.preventDefault(); add() }}>
      {inv.length > 0 && (
        <div className="cons-inv">
          <small>{tr('Quedó de antes (toca para usarlo):')}</small>
          <div className="chips">{inv.map((x) => <button key={x.id} type="button" className={'chip sm' + (fromId === x.id ? ' on' : '')} onClick={() => pick(x)}>{what(x)} · <b>{lbText(x.left ?? 0)} lb</b></button>)}</div>
        </div>
      )}
      <label>{tr('Qué es (código o nombre)')}<input value={product} maxLength={60} placeholder={tr('ej. Carne 80/20, mezcla 2286')} autoComplete="off" onChange={(e) => { setProduct(e.target.value); setFromId(''); setBad(false) }} /></label>
      <div className="cons-two">
        <label>{tr('Lote')}<input value={prodLot} maxLength={40} placeholder={tr('ej. BF-1023')} autoComplete="off" onChange={(e) => { setProdLot(e.target.value); setFromId('') }} /></label>
        <label>{tr('Fecha de la etiqueta')}<input type="date" value={labelDate} onChange={(e) => { setLabelDate(e.target.value); setFromId('') }} /></label>
      </div>
      <label>{tr('Libras (pesadas)')}<input inputMode="decimal" value={lb} placeholder={tr('ej. 30')} onChange={(e) => { setLb(e.target.value.replace(/[^\d.,]/g, '')); setBad(false) }} /></label>
      {bad && <p className="hint red">{tr('Escribe qué es y las libras, por ejemplo 30')}</p>}
      <button type="submit" className="btn soft" disabled={!lb || !product.trim()}>{tr('+ Agregar')}</button>
    </form>
  )
}

/** before the code starts: at least one thing weighed, then it starts (the entries go with the new code) */
export function ConsumeStartDialog({ s, dept, line, code, onClose, onStart }: { s: State; dept: Dept; line: string; code: string; onClose: () => void; onStart: (list: ConsumeDraft[]) => void }) {
  const [list, setList] = useState<ConsumeDraft[]>([])
  const total = list.reduce((t, x) => t + x.lb, 0)
  return (
    <div className="veil rc-veil" onClick={onClose}>
      <div className="dlg cons-dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{tr('⚖ Pesar lo que van a consumir · {0} · {1}', lineLabel(line), code)}</h3>
        <p className="hint">{tr('Antes de empezar este código, pesa lo que va a entrar y anótalo. Es obligatorio en {0}.', dept)}</p>
        <ConsumeForm s={s} dept={dept} onAdd={(d) => setList([...list, d])} />
        {list.length > 0 && (
          <ul className="cons-list">{list.map((x, i) => <li key={i}><b>{lbText(x.lb)} lb</b> {what(x)} <button type="button" className="lnk sm" onClick={() => setList(list.filter((_, k) => k !== i))}>{tr('Quitar')}</button></li>)}</ul>
        )}
        <div className="dbtns">
          <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
          <button type="button" className="btn primary" disabled={!list.length} onClick={() => onStart(list)}>{tr('▶ Empezar')}{total > 0 && <small> · {lbText(total)} lb</small>}</button>
        </div>
      </div>
    </div>
  )
}

/** while the code runs: what went in so far, and more of it */
export function ConsumeButton({ s, run }: { s: State; run: Run }) {
  const [open, setOpen] = useState(false)
  const mine = consumesOfRun(s, run.id), total = mine.reduce((t, x) => t + x.lb, 0)
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>{tr('⚖ Consumo')}{total > 0 && <small> · {lbText(total)} lb</small>}</button>
      {open && (
        <div className="veil rc-veil" onClick={() => setOpen(false)}>
          <div className="dlg cons-dlg" onClick={(e) => e.stopPropagation()}>
            <h3>{tr('⚖ Consumo · {0} · {1}', lineLabel(run.line), run.code)}</h3>
            <p className="hint">{tr('Cada vez que entra algo más a este código: qué es, su lote, la fecha de su etiqueta y las libras.')}</p>
            <ConsumeForm s={s} dept={run.dept} onAdd={(d) => consumeAdd(run, d.product, d.prodLot, d.labelDate, d.lb, d.fromId)} />
            {mine.length > 0 && (
              <>
                <h4>{tr('En este código')}</h4>
                <ul className="cons-list">{mine.map((x) => <li key={x.id}><b>{lbText(x.lb)} lb</b> {what(x)} <small>{fmtTime(x.at)} · {x.by}</small> <button type="button" className="lnk sm" onClick={() => consumeDelete(x.id)}>{tr('Quitar')}</button></li>)}</ul>
                <p className="cons-sum">{tr('Total: {0} lb', lbText(total))}</p>
              </>
            )}
            <div className="dbtns"><button type="button" className="btn primary" onClick={() => setOpen(false)}>{tr('Listo')}</button></div>
          </div>
        </div>
      )}
    </>
  )
}

/** the code ended: of each thing weighed, was all of it consumed, or how much was left (it cannot be skipped) */
export function ConsumeEndDialog({ entries }: { entries: ConsumeEntry[] }) {
  const [left, setLeft] = useState<Record<string, string>>({})
  const [bad, setBad] = useState('')
  const keep = (x: ConsumeEntry) => {
    const n = Number((left[x.id] ?? '').replace(',', '.'))
    if (!(n > 0) || n > x.lb) { setBad(x.id); return }
    consumeLeft(x.id, Math.round(n * 100) / 100); setBad('')
  }
  return (
    <div className="veil rc-veil">
      <div className="dlg cons-dlg">
        <h3>{tr('⚖ ¿Qué quedó de lo que pesaron?')}</h3>
        <p className="hint">{tr('Terminó el código {0}. De cada cosa que entró, di si se consumió toda o cuántas libras quedaron: lo que queda pasa al inventario del cuarto.', entries[0]?.code ?? '')}</p>
        <ul className="cons-end">{entries.map((x) => (
          <li key={x.id}>
            <div><b>{lbText(x.lb)} lb</b> {what(x)}</div>
            <div className="cons-end-btns">
              <button type="button" className="btn sm primary" onClick={() => consumeLeft(x.id, 0)}>{tr('Se consumió todo')}</button>
              <label>{tr('Quedaron')} <input inputMode="decimal" value={left[x.id] ?? ''} placeholder="lb" onChange={(e) => { setLeft({ ...left, [x.id]: e.target.value.replace(/[^\d.,]/g, '') }); setBad('') }} /> lb</label>
              <button type="button" className="btn sm" disabled={!(left[x.id] ?? '')} onClick={() => keep(x)}>{tr('Guardar')}</button>
            </div>
            {bad === x.id && <p className="hint red">{tr('Escribe las libras que quedaron, menos de {0}', lbText(x.lb))}</p>}
          </li>
        ))}</ul>
      </div>
    </div>
  )
}
