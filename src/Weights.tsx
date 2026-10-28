import { useRef, useState } from 'react'
import { entryClass, fmtTime, lineLabel, setWeightTarget, weightDueAt, weightNew, weightRuleOf, weightSave, weightTarget, wtWeights, type Run, type State, type WeightTest, type WtEntry } from './store'
import { useWho } from './App'
import { tr } from './i18n'

/**
 * A weight test on an RTE line (2026-10-22: "botones en RTE para que los operadores de tablet puedan registrar la que
 * está baja y subida de weight"). Two big buttons, "▲ Sobre peso" and "▼ Bajo peso", count a pouch off weight with one
 * tap (Jose: "dos botones, uno para arriba y otro para abajo, y que el peso sea opcional"); a weight typed before the tap
 * goes with it, and "+ Agregar" keeps a weight on its own (judged against the code's target). Each entry is saved at
 * once. A manager or the office sets the target (pouch weight and tolerance) here.
 */
const oz = (w: number) => (Math.round(w * 100) / 100).toString()
const MARK = { bajo: '▼', ok: '✓', sobre: '▲', '': '' } as const
/** "8 bolas", "1 pouch" */
const countText = (kind: WeightTest['kind'], n: number) => (kind !== 'pouch' ? (n === 1 ? tr('1 bola') : tr('{0} bolas', n)) : n === 1 ? tr('1 pouch') : tr('{0} pouches', n))
/** which rooms weigh meatballs rather than pouches (Spiral cooked, Kitchen raw since 2026-10-28) */
export const weighsBalls = (dept: Run['dept']) => dept === 'Spiral' || dept === 'Kitchen'
const avgOf = (ws: number[]) => (ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : null)

export function WeightButton({ s, run, now }: { s: State; run: Run; now: number }) {
  const [open, setOpen] = useState(false)
  const tests = (s.weights ?? []).filter((x) => !x.deleted && x.runId === run.id && x.entries.length > 0)
  const due = weightDueAt(s, run), late = due != null && now >= due
  return (
    <>
      <button type="button" className={'btn' + (late ? ' wt-due' : '')} onClick={() => setOpen(true)}>{tr('⚖ Peso')}{tests.length > 0 && <small> · {tests.length}</small>}</button>
      {open && <WeightDialog s={s} run={run} onClose={() => setOpen(false)} />}
    </>
  )
}
/**
 * The reminder on a line (2026-10-23, Spiral: "que le salga cada hora que pesen 8 bolas"): once the room's time since
 * the code started or the line's last test has passed, the line says so until a test is made; a tap opens the window
 */
export function WeightReminder({ s, run, now }: { s: State; run: Run; now: number }) {
  const [open, setOpen] = useState(false)
  const due = weightDueAt(s, run), rule = weightRuleOf(s, run.dept)
  // (the window stays open, the same test, once the first weight puts the reminder away: it closes with Listo)
  const late = due != null && now >= due
  if (!late && !open) return null
  const what = !late ? '' : weighsBalls(run.dept) ? (rule.count === 1 ? tr('1 bola') : tr('{0} bolas', rule.count)) : rule.count ? tr('{0} pouches', rule.count) : tr('los pouches')
  return (
    <>
      {late && <button type="button" className="wt-remind" onClick={() => setOpen(true)}>{rule.every === 60 ? tr('⚖ Ya pasó 1 hora: pesen {0} y escriban su peso', what) : tr('⚖ Ya pasaron {0} min: pesen {1} y escriban su peso', rule.every, what)}<b>{tr('Pesar ahora')}</b></button>}
      {open && <WeightDialog s={s} run={run} onClose={() => setOpen(false)} />}
    </>
  )
}

/** what a test says in one line: pouches checked, under and over, and the average of the weights typed */
function testText(x: WeightTest, t: ReturnType<typeof weightTarget>) {
  const ws = wtWeights(x), avg = avgOf(ws)
  const under = x.entries.filter((e) => entryClass(e, t) === 'bajo').length, over = x.entries.filter((e) => entryClass(e, t) === 'sobre').length
  return [countText(x.kind, x.entries.length), tr('▼ {0} · ▲ {1}', under, over), ...(avg != null ? [tr('promedio {0} oz', oz(avg))] : [])].join(' · ')
}

function WeightDialog({ s, run, onClose }: { s: State; run: Run; onClose: () => void }) {
  const who = useWho()
  const boss = !!who.admin || who.role === 'mgr' || who.role === 'office'
  const [test] = useState(() => weightNew(run))
  const saved = (s.weights ?? []).find((x) => x.id === test.id)
  const entries = saved && !saved.deleted ? saved.entries : []
  const [text, setText] = useState('')
  const [bad, setBad] = useState(false)
  const [targeting, setTargeting] = useState(false)
  const box = useRef<HTMLInputElement>(null)
  const ball = test.kind !== 'pouch', raw = test.kind === 'raw', rule = weightRuleOf(s, run.dept)
  const t = weightTarget(s, run.code, test.kind)
  const earlier = (s.weights ?? []).filter((x) => !x.deleted && x.runId === run.id && x.id !== test.id && x.entries.length > 0).sort((a, b) => b.at - a.at)
  // a weight typed is optional with the buttons, needed with "+ Agregar"
  const add = (k?: 'sobre' | 'bajo') => {
    const typed = text.trim(), w = Number(typed.replace(',', '.'))
    if (typed && !(w > 0 && w < 2000)) { setBad(true); return }
    if (!typed && !k) { setBad(true); return }
    const e: WtEntry = { ...(typed ? { w } : {}), ...(k ? { k } : {}) }
    weightSave(test, [...entries, e]); setText(''); setBad(false)
  }
  const ws = entries.flatMap((e) => (e.w != null ? [e.w] : [])), avg = avgOf(ws)
  const count = (k: 'bajo' | 'sobre') => entries.filter((e) => entryClass(e, t) === k).length
  return (
    <div className="veil rc-veil" onClick={onClose}>
      <div className="dlg wt-dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{tr('⚖ Peso · {0} · {1}', lineLabel(run.line), run.code)}{test.lot ? ' · ' + tr('lote {0}', test.lot) : ''}</h3>
        {ball ? <p className="hint">{raw ? (rule.count ? tr('Pesa {0} bolas crudas, una por una, y escribe el peso de cada una en onzas (oz).', rule.count) : tr('Pesa las bolas crudas, una por una, y escribe el peso de cada una en onzas (oz).')) : rule.count ? tr('Pesa {0} bolas, una por una, y escribe el peso de cada una en onzas (oz).', rule.count) : tr('Pesa las bolas, una por una, y escribe el peso de cada una en onzas (oz).')}</p> : <>
        <div className="wt-big">
          <button type="button" className="btn wt-over" onClick={() => add('sobre')}>{tr('▲ Sobre peso')}</button>
          <button type="button" className="btn wt-under" onClick={() => add('bajo')}>{tr('▼ Bajo peso')}</button>
        </div>
        <p className="hint">{tr('Toca el botón por cada pouch fuera de peso. El peso es opcional: si lo pesaste, escríbelo antes de tocar el botón.')}</p></>}
        {ball && rule.count > 0 && <div className="wt-count"><b>{tr('{0} de {1}', Math.min(entries.length, rule.count), rule.count)}</b>{entries.length >= rule.count ? <span className="ok">{tr('✓ Prueba completa')}</span> : <span>{tr('faltan {0}', rule.count - entries.length)}</span>}</div>}
        <form className="wt-add" onSubmit={(e) => { e.preventDefault(); add() }}>
          <input ref={box} autoFocus={ball} inputMode="decimal" value={text} placeholder={ball ? tr('Peso de la bola (oz)') : tr('Peso del pouch (oz), opcional')} aria-label={ball ? tr('Peso de la bola (oz)') : tr('Peso del pouch (oz), opcional')} onChange={(e) => { setText(e.target.value.replace(/[^\d.,]/g, '')); setBad(false) }} />
          <button type="submit" className={'btn ' + (ball ? 'primary' : 'soft')} disabled={!text}>{tr('+ Agregar')}</button>
        </form>
        <p className="hint">{t ? (raw ? tr('Objetivo: {0} oz por bola cruda (± {1} oz).', oz(t.pouch), oz(t.tol)) : ball ? tr('Objetivo: {0} oz por bola (± {1} oz).', oz(t.pouch), oz(t.tol)) : tr('Objetivo: {0} oz por pouch (± {1} oz), con el plástico.', oz(t.pouch), oz(t.tol))) : tr('Este código todavía no tiene peso objetivo: un peso escrito con "+ Agregar" se guarda sin decir bajo o sobre.')}
          {boss && <> <button type="button" className="lnk sm" onClick={() => setTargeting(true)}>{tr('✎ Objetivo')}</button></>}</p>
        {bad && <p className="hint red">{tr('Escribe el peso en onzas, por ejemplo 48.5')}</p>}
        {entries.length > 0 && (
          <>
            <ol className="wt-list">{entries.map((e, i) => { const k = entryClass(e, t); return <li key={i} className={k}>{e.w != null ? oz(e.w) : '—'} <small>{MARK[k]} {k === 'bajo' ? tr('bajo') : k === 'sobre' ? tr('sobre') : ''}</small></li> })}</ol>
            <div className="wt-sum">
              <span>{countText(test.kind, entries.length)}{avg != null ? ' · ' + tr('promedio {0} oz', oz(avg)) : ''}</span>
              <span className={count('bajo') ? 'red' : ''}>{tr('▼ {0} bajos', count('bajo'))}</span>
              <span className={count('sobre') ? 'amber' : ''}>{tr('▲ {0} sobre', count('sobre'))}</span>
              <button type="button" className="lnk sm" onClick={() => weightSave(test, entries.slice(0, -1))}>{tr('Quitar el último')}</button>
            </div>
            <p className="hint ok">{tr('Cada uno ya quedó guardado.')}</p>
          </>
        )}
        {earlier.length > 0 && (
          <>
            <h4>{tr('Antes en este código')}</h4>
            <ul className="wt-earlier">{earlier.slice(0, 6).map((x) => <li key={x.id}>{fmtTime(x.at)} · {testText(x, t)} <small>· {x.by}</small></li>)}</ul>
          </>
        )}
        <div className="dbtns"><button type="button" className="btn primary" onClick={onClose}>{tr('Listo')}</button></div>
        {targeting && <TargetDialog code={run.code} kind={test.kind} now={t} onClose={() => setTargeting(false)} />}
      </div>
    </div>
  )
}

function TargetDialog({ code, kind, now, onClose }: { code: string; kind: WeightTest['kind']; now: { pouch: number; tol: number } | null; onClose: () => void }) {
  const [pouch, setPouch] = useState(now ? oz(now.pouch) : '')
  const [tol, setTol] = useState(now ? oz(now.tol) : '')
  const p = Number(pouch.replace(',', '.')), d = Number((tol || '0').replace(',', '.'))
  return (
    <div className="veil rc-veil" onClick={onClose}>
      <form className="dlg" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (p > 0 && d >= 0) { setWeightTarget(code, p, d, kind); onClose() } }}>
        <h3>{tr('Peso objetivo de {0}', code)}</h3>
        <label>{kind === 'raw' ? tr('Cada bola cruda (oz)') : kind === 'ball' ? tr('Cada bola (oz)') : tr('Pouch terminado, con el plástico (oz)')}<input autoFocus inputMode="decimal" value={pouch} onChange={(e) => setPouch(e.target.value.replace(/[^\d.,]/g, ''))} /></label>
        <label>{tr('Cuánto puede variar, más o menos (oz)')}<input inputMode="decimal" value={tol} placeholder="1" onChange={(e) => setTol(e.target.value.replace(/[^\d.,]/g, ''))} /></label>
        <p className="hint">{kind === 'raw' ? tr('Lo dice QA. Con 2.7 y 0.1: menos de 2.6 es bajo, más de 2.8 es sobre.') : tr('Lo dice QA. Con 48 y 1: menos de 47 es bajo, más de 49 es sobre.')}</p>
        <div className="dbtns"><button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button><button type="submit" className="btn primary" disabled={!(p > 0)}>{tr('Guardar')}</button></div>
      </form>
    </div>
  )
}
