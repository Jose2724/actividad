import { useRef, useState } from 'react'
import { cookText, entryClass, fmtTime, lineLabel, sameStep, setWeightTarget, stepKey, stepText, weighsCode, weightDueSteps, weightNew, weightOpen, weightRuleOf, weightSave, weightSkip, weightStepsOf, weightTarget, weightThisHour, wtWeights, type Cook, type Run, type State, type WeightTest, type WtEntry, type WtStep } from './store'
import { useWho } from './App'
import { tr } from './i18n'

/**
 * A weight test on a line (2026-10-22: "botones en RTE para que los operadores de tablet puedan registrar la que está
 * baja y subida de weight"). Since 2026-10-29 (Jose: "esto va para el KPI que se manda todos los días"), on a code the
 * room weighs every hour (0889 in Spiral and RTE): every weight is typed, one by one, 10 of them; Spiral weighs the balls
 * raw before each cooker (Spiral and Racks) and cooked out of it, four tests an hour shown together, and says when a
 * cooker did not cook that hour. A window closed half-way goes on with the same test. On the other codes RTE keeps its
 * two buttons, "▲ Sobre peso" and "▼ Bajo peso", with the weight optional. Each entry is saved at once. A manager or
 * the office sets the target (weight and tolerance) here.
 */
const oz = (w: number) => (Math.round(w * 100) / 100).toString()
const MARK = { bajo: '▼', ok: '✓', sobre: '▲', '': '' } as const
/** "10 bolas", "1 pouch" */
const countText = (kind: WeightTest['kind'], n: number) => (kind !== 'pouch' ? (n === 1 ? tr('1 bola') : tr('{0} bolas', n)) : n === 1 ? tr('1 pouch') : tr('{0} pouches', n))
/** which rooms weigh meatballs rather than pouches (Spiral raw and cooked, Kitchen raw since 2026-10-28) */
export const weighsBalls = (dept: Run['dept']) => dept === 'Spiral' || dept === 'Kitchen'
const avgOf = (ws: number[]) => (ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : null)

export function WeightButton({ s, run, now }: { s: State; run: Run; now: number }) {
  const [open, setOpen] = useState(false)
  const tests = (s.weights ?? []).filter((x) => !x.deleted && x.runId === run.id && x.entries.length > 0)
  const late = weightDueSteps(s, run, now).length > 0
  return (
    <>
      <button type="button" className={'btn' + (late ? ' wt-due' : '')} onClick={() => setOpen(true)}>{tr('⚖ Peso')}{tests.length > 0 && <small> · {tests.length}</small>}</button>
      {open && <WeightDialog s={s} run={run} now={now} onClose={() => setOpen(false)} />}
    </>
  )
}
/**
 * The reminder on a line (2026-10-23, Spiral: "que le salga cada hora que pesen 8 bolas"): once the room's time since
 * the code started or the line's last test of a step has passed, the line says what is due until it is weighed; a tap
 * opens the window
 */
export function WeightReminder({ s, run, now }: { s: State; run: Run; now: number }) {
  const [open, setOpen] = useState(false)
  const due = weightDueSteps(s, run, now), rule = weightRuleOf(s, run.dept), many = weightStepsOf(run.dept).length > 1
  // (the window stays open, the same test, once the first weight puts the reminder away: it closes with Listo)
  if (!due.length && !open) return null
  const n = weighsBalls(run.dept) ? (rule.count === 1 ? tr('1 bola') : tr('{0} bolas', rule.count)) : rule.count ? tr('{0} pouches', rule.count) : tr('los pouches')
  const what = many ? n + ' · ' + due.map(stepText).join(', ') : n
  return (
    <>
      {due.length > 0 && <button type="button" className="wt-remind" onClick={() => setOpen(true)}>{rule.every === 60 ? tr('⚖ Ya pasó 1 hora: pesen {0} y escriban su peso', what) : tr('⚖ Ya pasaron {0} min: pesen {1} y escriban su peso', rule.every, what)}<b>{tr('Pesar ahora')}</b></button>}
      {open && <WeightDialog s={s} run={run} now={now} onClose={() => setOpen(false)} />}
    </>
  )
}

/** what a test says in one line: what was weighed, how many, under and over, and the average of the weights typed */
function testText(x: WeightTest, t: ReturnType<typeof weightTarget>, many: boolean) {
  if (x.skip) return stepText(x) + ' · ' + tr('no se usó esa hora')
  const ws = wtWeights(x), avg = avgOf(ws)
  const under = x.entries.filter((e) => entryClass(e, t) === 'bajo').length, over = x.entries.filter((e) => entryClass(e, t) === 'sobre').length
  return [...(many ? [stepText(x)] : []), countText(x.kind, x.entries.length), tr('▼ {0} · ▲ {1}', under, over), ...(avg != null ? [tr('promedio {0} oz', oz(avg))] : [])].join(' · ')
}

function WeightDialog({ s, run, now, onClose }: { s: State; run: Run; now: number; onClose: () => void }) {
  const who = useWho()
  const boss = !!who.admin || who.role === 'mgr' || who.role === 'office'
  const steps = weightStepsOf(run.dept), many = steps.length > 1, rule = weightRuleOf(s, run.dept)
  // a code the room weighs every hour: each weight typed (Jose, 2026-10-29: "tiene que poner el peso, no solo over o under")
  const strict = weighsCode(s, run.dept, run.code) && rule.every > 0
  const due = weightDueSteps(s, run, now)
  // the tests begun in this window (by step), and the steps asked to be weighed again although done this hour
  const fresh = useRef<Record<string, WeightTest>>({})
  const [started, setStarted] = useState<Record<string, string>>({})
  const [again, setAgain] = useState<Record<string, boolean>>({})
  const testOf = (st: WtStep): WeightTest | null => {
    const id = started[stepKey(st)]
    if (id) return (s.weights ?? []).find((x) => x.id === id && !x.deleted) ?? null
    return again[stepKey(st)] ? null : weightOpen(s, run, st, now)
  }
  /** a step's state this hour: its test in the works, or done (complete or not used), or nothing yet */
  const stateOf = (st: WtStep) => {
    const t = testOf(st), done = weightThisHour(s, run, st, now)
    return { t, done: !t && !again[stepKey(st)] && done && (done.skip || done.entries.length >= rule.count) ? done : null }
  }
  const firstToDo = (but?: WtStep) => steps.find((x) => !(but && sameStep(x, but)) && !stateOf(x).done && !(testOf(x) && rule.count && (testOf(x)?.entries.length ?? 0) >= rule.count))
  const [pick, setPick] = useState<WtStep>(() => due[0] ?? firstToDo() ?? steps[0] ?? { kind: 'pouch' })
  const { t: test, done } = stateOf(pick)
  const entries = test?.entries ?? []
  const [text, setText] = useState('')
  const [bad, setBad] = useState(false)
  const [targeting, setTargeting] = useState(false)
  const box = useRef<HTMLInputElement>(null)
  const ball = pick.kind !== 'pouch'
  const t = weightTarget(s, run.code, pick.kind, pick.cook)
  const earlier = (s.weights ?? []).filter((x) => !x.deleted && x.runId === run.id && x.id !== test?.id && (x.entries.length > 0 || x.skip)).sort((a, b) => b.at - a.at)
  const save = (list: WtEntry[]) => {
    const k = stepKey(pick)
    if (test) { weightSave(test, list); return }
    const x = fresh.current[k] ?? (fresh.current[k] = weightNew(run, pick))
    setStarted((m) => ({ ...m, [k]: x.id }))
    weightSave(x, list)
  }
  // a weight typed is needed with "+ Agregar" (and always on a code weighed every hour), optional with the buttons
  const add = (k?: 'sobre' | 'bajo') => {
    const typed = text.trim(), w = Number(typed.replace(',', '.'))
    if (typed && !(w > 0 && w < 2000)) { setBad(true); return }
    if (!typed && !k) { setBad(true); return }
    const e: WtEntry = { ...(typed ? { w } : {}), ...(k ? { k } : {}) }
    save([...entries, e]); setText(''); setBad(false)
    // (Spiral: the tenth ball moves on to the next test still to do this hour)
    if (many && rule.count && entries.length + 1 === rule.count) { const next = firstToDo(pick); if (next) setPick(next) }
    box.current?.focus()
  }
  const choose = (st: WtStep) => { setPick(st); setText(''); setBad(false) }
  /** a cooker that did not cook this hour: its raw and cooked tests not done are said so */
  const skipCook = (c: Cook) => {
    for (const st of steps.filter((x) => x.cook === c)) { const z = stateOf(st); if (!z.done && !z.t?.entries.length) weightSkip(z.t ?? weightNew(run, st), true) }
    const next = firstToDo(); if (next) setPick(next)
  }
  const ws = entries.flatMap((e) => (e.w != null ? [e.w] : [])), avg = avgOf(ws)
  const count = (k: 'bajo' | 'sobre') => entries.filter((e) => entryClass(e, t) === k).length
  const cookFree = (c: Cook) => steps.filter((x) => x.cook === c).every((x) => { const z = stateOf(x); return !z.done && !z.t?.entries.length })
  return (
    <div className="veil rc-veil" onClick={onClose}>
      <div className="dlg wt-dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{tr('⚖ Peso · {0} · {1}', lineLabel(run.line), run.code)}{run.lot ? ' · ' + tr('lote {0}', test?.lot || run.lot) : ''}</h3>
        {many && (
          <div className="wt-steps">
            {steps.map((st) => {
              const z = stateOf(st), n = z.t?.entries.length ?? 0, late = due.some((x) => sameStep(x, st))
              // (a test completed in this window shows as done too, though it stays open to see its weights)
              const full = z.done ?? (z.t && rule.count > 0 && n >= rule.count ? z.t : null)
              const say = full ? (full.skip ? tr('no se usó') : tr('✓ {0} a las {1}', full.entries.length, fmtTime(full.at))) : n ? tr('{0} de {1}', n, rule.count) : late ? tr('toca ahora') : '—'
              return <button key={stepKey(st)} type="button" className={'wt-step' + (sameStep(st, pick) ? ' on' : '') + (full ? ' done' : late ? ' late' : '')} onClick={() => choose(st)}><b>{stepText(st)}</b><small>{say}</small></button>
            })}
          </div>
        )}
        {done ? (
          <div className="wt-done">
            <p>{done.skip ? tr('{0}: no se usó esta hora.', stepText(pick)) : tr('{0}: ya se pesó esta hora ({1} a las {2}).', stepText(pick), countText(pick.kind, done.entries.length), fmtTime(done.at))}</p>
            <div className="btns">
              {done.skip && <button type="button" className="btn soft" onClick={() => weightSkip(done, false)}>{tr('Deshacer')}</button>}
              <button type="button" className="btn soft" onClick={() => setAgain((m) => ({ ...m, [stepKey(pick)]: true }))}>{tr('+ Pesar otra vez')}</button>
            </div>
          </div>
        ) : <>
          {ball ? <p className="hint">{pick.kind === 'raw' ? (pick.cook ? tr('Pesa {0} bolas crudas, una por una, antes de que entren a {1}, y escribe el peso de cada una en onzas (oz).', rule.count || 10, cookText(pick.cook)) : rule.count ? tr('Pesa {0} bolas crudas, una por una, y escribe el peso de cada una en onzas (oz).', rule.count) : tr('Pesa las bolas crudas, una por una, y escribe el peso de cada una en onzas (oz).')) : pick.cook ? tr('Pesa {0} bolas cocinadas, una por una, al salir de {1}, y escribe el peso de cada una en onzas (oz).', rule.count || 10, cookText(pick.cook)) : rule.count ? tr('Pesa {0} bolas, una por una, y escribe el peso de cada una en onzas (oz).', rule.count) : tr('Pesa las bolas, una por una, y escribe el peso de cada una en onzas (oz).')}</p>
            : strict ? <p className="hint">{tr('Pesa {0} pouches, uno por uno, y escribe el peso de cada uno en onzas (oz). La app dice si está bajo o sobre.', rule.count || 10)}</p> : <>
            <div className="wt-big">
              <button type="button" className="btn wt-over" onClick={() => add('sobre')}>{tr('▲ Sobre peso')}</button>
              <button type="button" className="btn wt-under" onClick={() => add('bajo')}>{tr('▼ Bajo peso')}</button>
            </div>
            <p className="hint">{tr('Toca el botón por cada pouch fuera de peso. El peso es opcional: si lo pesaste, escríbelo antes de tocar el botón.')}</p></>}
          {(ball || strict) && rule.count > 0 && <div className="wt-count"><b>{tr('{0} de {1}', Math.min(entries.length, rule.count), rule.count)}</b>{entries.length >= rule.count ? <span className="ok">{tr('✓ Prueba completa')}</span> : <span>{tr('faltan {0}', rule.count - entries.length)}</span>}</div>}
          <form className="wt-add" onSubmit={(e) => { e.preventDefault(); add() }}>
            <input ref={box} autoFocus={ball || strict} inputMode="decimal" value={text} placeholder={ball ? tr('Peso de la bola (oz)') : strict ? tr('Peso del pouch (oz)') : tr('Peso del pouch (oz), opcional')} aria-label={ball ? tr('Peso de la bola (oz)') : strict ? tr('Peso del pouch (oz)') : tr('Peso del pouch (oz), opcional')} onChange={(e) => { setText(e.target.value.replace(/[^\d.,]/g, '')); setBad(false) }} />
            <button type="submit" className={'btn ' + (ball || strict ? 'primary' : 'soft')} disabled={!text}>{tr('+ Agregar')}</button>
          </form>
          {many && pick.cook && cookFree(pick.cook) && <p className="hint"><button type="button" className="lnk sm" onClick={() => skipCook(pick.cook as Cook)}>{tr('{0} no cocinó esta hora', cookText(pick.cook))}</button></p>}
        </>}
        <p className="hint">{t ? (pick.kind === 'raw' ? tr('Objetivo: {0} oz por bola cruda (± {1} oz).', oz(t.pouch), oz(t.tol)) : ball ? tr('Objetivo: {0} oz por bola cocinada (± {1} oz).', oz(t.pouch), oz(t.tol)) : tr('Objetivo: {0} oz por pouch (± {1} oz), con el plástico.', oz(t.pouch), oz(t.tol))) : tr('Este código todavía no tiene peso objetivo: un peso escrito con "+ Agregar" se guarda sin decir bajo o sobre.')}
          {boss && <> <button type="button" className="lnk sm" onClick={() => setTargeting(true)}>{tr('✎ Objetivo')}</button></>}</p>
        {bad && <p className="hint red">{tr('Escribe el peso en onzas, por ejemplo 48.5')}</p>}
        {entries.length > 0 && (
          <>
            <ol className="wt-list">{entries.map((e, i) => { const k = entryClass(e, t); return <li key={i} className={k}>{e.w != null ? oz(e.w) : '—'} <small>{MARK[k]} {k === 'bajo' ? tr('bajo') : k === 'sobre' ? tr('sobre') : ''}</small></li> })}</ol>
            <div className="wt-sum">
              <span>{countText(pick.kind, entries.length)}{avg != null ? ' · ' + tr('promedio {0} oz', oz(avg)) : ''}</span>
              <span className={count('bajo') ? 'red' : ''}>{tr('▼ {0} bajos', count('bajo'))}</span>
              <span className={count('sobre') ? 'amber' : ''}>{tr('▲ {0} sobre', count('sobre'))}</span>
              <button type="button" className="lnk sm" onClick={() => save(entries.slice(0, -1))}>{tr('Quitar el último')}</button>
            </div>
            <p className="hint ok">{tr('Cada uno ya quedó guardado.')}</p>
          </>
        )}
        {earlier.length > 0 && (
          <>
            <h4>{tr('Antes en este código')}</h4>
            <ul className="wt-earlier">{earlier.slice(0, 8).map((x) => <li key={x.id}>{fmtTime(x.at)} · {testText(x, weightTarget(s, run.code, x.kind, x.cook), many)} <small>· {x.by}</small></li>)}</ul>
          </>
        )}
        <div className="dbtns"><button type="button" className="btn primary" onClick={onClose}>{tr('Listo')}</button></div>
        {targeting && <TargetDialog code={run.code} step={pick} now={t} onClose={() => setTargeting(false)} />}
      </div>
    </div>
  )
}

function TargetDialog({ code, step, now, onClose }: { code: string; step: WtStep; now: { pouch: number; tol: number } | null; onClose: () => void }) {
  const [pouch, setPouch] = useState(now ? oz(now.pouch) : '')
  const [tol, setTol] = useState(now ? oz(now.tol) : '')
  const p = Number(pouch.replace(',', '.')), d = Number((tol || '0').replace(',', '.'))
  const kind = step.kind
  return (
    <div className="veil rc-veil" onClick={onClose}>
      <form className="dlg" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (p > 0 && d >= 0) { setWeightTarget(code, p, d, kind, step.cook); onClose() } }}>
        <h3>{tr('Peso objetivo de {0}', code)}{step.cook ? ' · ' + stepText(step) : ''}</h3>
        <label>{kind === 'raw' ? tr('Cada bola cruda (oz)') : kind === 'ball' ? tr('Cada bola cocinada (oz)') : tr('Pouch terminado, con el plástico (oz)')}<input autoFocus inputMode="decimal" value={pouch} onChange={(e) => setPouch(e.target.value.replace(/[^\d.,]/g, ''))} /></label>
        <label>{tr('Cuánto puede variar, más o menos (oz)')}<input inputMode="decimal" value={tol} placeholder="1" onChange={(e) => setTol(e.target.value.replace(/[^\d.,]/g, ''))} /></label>
        <p className="hint">{kind === 'raw' ? tr('Lo dice QA. Con 2.7 y 0.1: menos de 2.6 es bajo, más de 2.8 es sobre.') : kind === 'ball' ? tr('Lo dice QA. Con 2.25 y 0.15: menos de 2.1 es bajo, más de 2.4 es sobre.') : tr('Lo dice QA. Con 48 y 1: menos de 47 es bajo, más de 49 es sobre.')}</p>
        <div className="dbtns"><button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button><button type="submit" className="btn primary" disabled={!(p > 0)}>{tr('Guardar')}</button></div>
      </form>
    </div>
  )
}
