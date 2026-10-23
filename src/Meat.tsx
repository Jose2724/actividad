import { useState } from 'react'
import { fmtTime, lineLabel, meatAdd, meatDelete, meatsOf, normCode, type Run, type State } from './store'
import { tr } from './i18n'

/**
 * The meat Spiral puts in (2026-10-23: "que ponga la cantidad de carne que usan para hacer esas mezclas, en libras, y
 * su lote"; Jose: a button apart, each time they put meat in, one kind and one lot). The window takes the pounds and
 * the meat's lot, saves at once, and lists what this code had today on this line with its pounds per mezcla. The lot is
 * never filled by itself (no guessed data): the lots already used today are offered to tap.
 */
const lbText = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-US')

export function MeatButton({ s, run }: { s: State; run: Run }) {
  const [open, setOpen] = useState(false)
  const mine = meatsOf(s, run.date, run.code).filter((x) => x.lineId === run.lineId)
  const total = mine.reduce((t, x) => t + x.lb, 0)
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>{tr('🥩 Carne')}{total > 0 && <small> · {lbText(total)} lb</small>}</button>
      {open && <MeatDialog s={s} run={run} onClose={() => setOpen(false)} />}
    </>
  )
}

function MeatDialog({ s, run, onClose }: { s: State; run: Run; onClose: () => void }) {
  const [lb, setLb] = useState('')
  const [lot, setLot] = useState('')
  const [bad, setBad] = useState(false)
  const [said, setSaid] = useState('')
  const mine = meatsOf(s, run.date, run.code).filter((x) => x.lineId === run.lineId)
  const total = mine.reduce((t, x) => t + x.lb, 0)
  // the mezclas this code has today on this line (the run's own units, every run of the code on the line)
  const mixes = s.runs.filter((r) => !r.deleted && r.lineId === run.lineId && r.date === run.date && normCode(r.code) === normCode(run.code)).reduce((t, r) => t + r.units.length, 0)
  const lots = [...new Set(meatsOf(s, run.date).filter((x) => x.lineId === run.lineId && x.meatLot).map((x) => x.meatLot))].slice(-4)
  const save = () => {
    const n = Number(lb.replace(',', '.'))
    if (!(n > 0 && n < 100000)) { setBad(true); return }
    if (meatAdd(run, n, lot)) { setSaid(tr('Guardado: {0} lb{1}.', lbText(n), lot.trim() ? ' · ' + tr('lote {0}', lot.trim()) : '')); setLb(''); setBad(false) }
  }
  return (
    <div className="veil rc-veil" onClick={onClose}>
      <div className="dlg meat-dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{tr('🥩 Carne · {0} · {1}', lineLabel(run.line), run.code)}</h3>
        <p className="hint">{tr('Cada vez que echan carne: las libras y el lote de la carne.')}</p>
        <form className="meat-form" onSubmit={(e) => { e.preventDefault(); save() }}>
          <label>{tr('Libras de carne')}<input autoFocus inputMode="decimal" value={lb} placeholder={tr('ej. 450')} onChange={(e) => { setLb(e.target.value.replace(/[^\d.,]/g, '')); setBad(false); setSaid('') }} /></label>
          <label>{tr('Lote de la carne')}<input value={lot} maxLength={40} placeholder={tr('ej. BF-1023')} autoComplete="off" onChange={(e) => { setLot(e.target.value); setSaid('') }} /></label>
          {lots.length > 0 && <div className="chips">{lots.map((l) => <button key={l} type="button" className={'chip sm' + (lot.trim() === l ? ' on' : '')} onClick={() => setLot(l)}>{l}</button>)}</div>}
          <button type="submit" className="btn primary" disabled={!lb}>{tr('+ Guardar')}</button>
        </form>
        {bad && <p className="hint red">{tr('Escribe las libras, por ejemplo 450')}</p>}
        {said && <p className="hint ok">{said}</p>}
        {mine.length > 0 && (
          <>
            <h4>{tr('Hoy en este código (esta línea)')}</h4>
            <ul className="meat-list">{mine.map((x) => <li key={x.id}><b>{lbText(x.lb)} lb</b> {x.meatLot && <span>{tr('lote {0}', x.meatLot)}</span>} <small>{fmtTime(x.at)} · {x.by}</small> <button type="button" className="lnk sm" onClick={() => meatDelete(x.id)}>{tr('Quitar')}</button></li>)}</ul>
            <p className="meat-sum">{tr('Total: {0} lb', lbText(total))}{mixes > 0 && <> · {tr('{0} mezclas · {1} lb por mezcla', mixes, lbText(total / mixes))}</>}</p>
          </>
        )}
        <div className="dbtns"><button type="button" className="btn primary" onClick={onClose}>{tr('Listo')}</button></div>
      </div>
    </div>
  )
}
