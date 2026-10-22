import { useRef, useState } from 'react'
import { fmtTime, lineLabel, setWeightTarget, weightClass, weightNew, weightSave, weightTarget, type Run, type State } from './store'
import { useWho } from './App'
import { tr } from './i18n'

/**
 * A weight test on an RTE line (2026-10-22: "botones en RTE para que los operadores de tablet puedan registrar la que
 * está baja y subida de weight"; Jose: each pouch's weight typed, tests every hour or at each changeover). The operator
 * types one pouch's weight after another (Enter adds the next); each one is saved at once, and says whether it is under,
 * ok or over against the code's target. A manager or the office sets the target (pouch weight and tolerance) here.
 */
const lb = (w: number) => (Math.round(w * 1000) / 1000).toString()
const MARK = { bajo: '▼', ok: '✓', sobre: '▲', '': '' } as const

export function WeightButton({ s, run }: { s: State; run: Run }) {
  const [open, setOpen] = useState(false)
  const tests = (s.weights ?? []).filter((x) => !x.deleted && x.runId === run.id && x.weights.length > 0)
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>{tr('⚖ Peso')}{tests.length > 0 && <small> · {tests.length}</small>}</button>
      {open && <WeightDialog s={s} run={run} onClose={() => setOpen(false)} />}
    </>
  )
}

function WeightDialog({ s, run, onClose }: { s: State; run: Run; onClose: () => void }) {
  const who = useWho()
  const boss = !!who.admin || who.role === 'mgr' || who.role === 'office'
  const [test] = useState(() => weightNew(run))
  const saved = (s.weights ?? []).find((x) => x.id === test.id)
  const weights = saved && !saved.deleted ? saved.weights : []
  const [text, setText] = useState('')
  const [bad, setBad] = useState(false)
  const [targeting, setTargeting] = useState(false)
  const box = useRef<HTMLInputElement>(null)
  const t = weightTarget(s, run.code)
  const earlier = (s.weights ?? []).filter((x) => !x.deleted && x.runId === run.id && x.id !== test.id && x.weights.length > 0).sort((a, b) => b.at - a.at)
  const add = () => {
    const w = Number(text.replace(',', '.'))
    if (!(w > 0 && w < 100)) { setBad(true); return }
    weightSave(test, [...weights, w]); setText(''); setBad(false); box.current?.focus()
  }
  const avg = weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : 0
  const count = (k: 'bajo' | 'sobre') => weights.filter((w) => weightClass(w, t) === k).length
  return (
    <div className="veil rc-veil" onClick={onClose}>
      <div className="dlg wt-dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{tr('⚖ Peso · {0} · {1}', lineLabel(run.line), run.code)}{test.lot ? ' · ' + tr('lote {0}', test.lot) : ''}</h3>
        <p className="hint">{t ? tr('Objetivo: {0} lb por pouch (± {1} lb), con el plástico.', lb(t.pouch), lb(t.tol)) : tr('Este código todavía no tiene peso objetivo: se guardan los pesos igual.')}
          {boss && <> <button type="button" className="lnk sm" onClick={() => setTargeting(true)}>{tr('✎ Objetivo')}</button></>}</p>
        <form className="wt-add" onSubmit={(e) => { e.preventDefault(); add() }}>
          <input ref={box} autoFocus inputMode="decimal" value={text} placeholder={tr('Peso del pouch (lb)')} aria-label={tr('Peso del pouch (lb)')} onChange={(e) => { setText(e.target.value.replace(/[^\d.,]/g, '')); setBad(false) }} />
          <button type="submit" className="btn primary" disabled={!text}>{tr('+ Agregar')}</button>
        </form>
        {bad && <p className="hint red">{tr('Escribe el peso en libras, por ejemplo 3.15')}</p>}
        {weights.length > 0 ? (
          <>
            <ol className="wt-list">{weights.map((w, i) => { const k = weightClass(w, t); return <li key={i} className={k}>{lb(w)} <small>{MARK[k]} {k === 'bajo' ? tr('bajo') : k === 'sobre' ? tr('sobre') : ''}</small></li> })}</ol>
            <div className="wt-sum">
              <span>{tr('{0} pesados · promedio {1} lb', weights.length, lb(avg))}</span>
              {t && <span className={count('bajo') ? 'red' : ''}>{tr('▼ {0} bajos', count('bajo'))}</span>}
              {t && <span className={count('sobre') ? 'amber' : ''}>{tr('▲ {0} sobre', count('sobre'))}</span>}
              <button type="button" className="lnk sm" onClick={() => weightSave(test, weights.slice(0, -1))}>{tr('Quitar el último')}</button>
            </div>
            <p className="hint ok">{tr('Cada peso ya quedó guardado.')}</p>
          </>
        ) : <p className="hint">{tr('Pesa un pouch, escribe su peso y toca Agregar (o Enter). Repite con cada pouch de la prueba.')}</p>}
        {earlier.length > 0 && (
          <>
            <h4>{tr('Pruebas anteriores de este código')}</h4>
            <ul className="wt-earlier">{earlier.slice(0, 6).map((x) => <li key={x.id}>{fmtTime(x.at)} · {tr('{0} pesados · promedio {1} lb', x.weights.length, lb(x.weights.reduce((a, b) => a + b, 0) / x.weights.length))}{t ? ' · ' + tr('▼ {0} · ▲ {1}', x.weights.filter((w) => weightClass(w, t) === 'bajo').length, x.weights.filter((w) => weightClass(w, t) === 'sobre').length) : ''} <small>· {x.by}</small></li>)}</ul>
          </>
        )}
        <div className="dbtns"><button type="button" className="btn primary" onClick={onClose}>{tr('Listo')}</button></div>
        {targeting && <TargetDialog code={run.code} now={t} onClose={() => setTargeting(false)} />}
      </div>
    </div>
  )
}

function TargetDialog({ code, now, onClose }: { code: string; now: { pouch: number; tol: number } | null; onClose: () => void }) {
  const [pouch, setPouch] = useState(now ? lb(now.pouch) : '')
  const [tol, setTol] = useState(now ? lb(now.tol) : '')
  const p = Number(pouch.replace(',', '.')), d = Number((tol || '0').replace(',', '.'))
  return (
    <div className="veil rc-veil" onClick={onClose}>
      <form className="dlg" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (p > 0 && d >= 0) { setWeightTarget(code, p, d); onClose() } }}>
        <h3>{tr('Peso objetivo de {0}', code)}</h3>
        <label>{tr('Pouch terminado, con el plástico (lb)')}<input autoFocus inputMode="decimal" value={pouch} onChange={(e) => setPouch(e.target.value.replace(/[^\d.,]/g, ''))} /></label>
        <label>{tr('Cuánto puede variar, más o menos (lb)')}<input inputMode="decimal" value={tol} placeholder="0.05" onChange={(e) => setTol(e.target.value.replace(/[^\d.,]/g, ''))} /></label>
        <p className="hint">{tr('Lo dice QA. Con 3.01 y 0.05: menos de 2.96 es bajo, más de 3.06 es sobre.')}</p>
        <div className="dbtns"><button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button><button type="submit" className="btn primary" disabled={!(p > 0)}>{tr('Guardar')}</button></div>
      </form>
    </div>
  )
}
