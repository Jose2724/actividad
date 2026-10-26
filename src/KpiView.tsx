import { useEffect, useMemo, useRef, useState } from 'react'
import { awayDay, dayBefore, entryClass, fmtTime, kpiGet, kpiPut, wtWeights, type Dept, type State } from './store'
import { loadDay } from './sync'
import { COSTCO_CODE, costcoLast, costcoMonth, costcoPlan, kpiNames, kpiNote, laborOf, parsePlanner, weightsOf, type KpiPart } from './kpi'
import { download, useViewOnly } from './App'
import { xlsxBytes, XLSX_TYPE, type Cell } from './xlsx'
import { DEPT_LOOK } from './look'
import { locale, tr } from './i18n'

/**
 * The Daily KPI Report (2026-10-22), for Jose and Edgar: the COO's five daily KPIs for East Rutherford on one screen,
 * the previous day by default (ready at 7:00 AM for Skip), and an Excel with a tab per part. What Actividad knows is
 * worked out by itself (kpi.ts): the Costco MVM tracker (0889, plan from Yasbelth's planner) and the labor
 * productivity (attendance and production). Weights wait for QA's targets and cuts for Julio's orders. Each part has
 * its "what we saw · root cause · action", which is what Skip asks for most.
 */
const n0 = (x: number) => Math.round(x).toLocaleString('en-US')
const pc = (x: number | null) => (x == null ? '—' : Math.round(x * 1000) / 10 + '%')
const nice = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })

export function KpiView({ s, now, today, admin }: { s: State; now: number; today: string; admin: boolean }) {
  const viewOnly = useViewOnly()
  const [date, setDate] = useState(() => dayBefore(today))
  // the days the report reads that this device no longer keeps come from the server (the month of the day, its last week)
  useEffect(() => {
    const first = date.slice(0, 8) + '01'
    for (let d = date, i = 0; d >= first || i < 7; d = dayBefore(d), i++) if (awayDay(d)) void loadDay(d)
  }, [date])
  const plan = costcoPlan(s)
  const mo = useMemo(() => costcoMonth(s, date, now), [s, date, now])
  const last = useMemo(() => costcoLast(s, date, now, 7), [s, date, now])
  const lab = useMemo(() => laborOf(s, date, now), [s, date, now])
  const day = last[last.length - 1]
  const wts = useMemo(() => weightsOf(s, date), [s, date])
  const outW = wts.reduce((t, w) => t + w.under + w.over, 0), allW = wts.reduce((t, w) => t + w.checked, 0)
  const nTests = wts.reduce((t, w) => t + w.tests.length, 0)
  const excel = async () => {
    const notes = (p: KpiPart) => kpiNote(s, date, p)
    const head: Cell[][] = [[tr('E.R. - Ops Summary'), date], []]
    const resumen: Cell[][] = [...head, [tr('Parte'), tr('Resultado'), tr('Qué vimos · causa · acción')],
      [tr('1 · Pesos'), allW ? tr('{0} de {1} pouches fuera de peso', outW, allW) : tr('Sin pruebas de peso'), notes('weights')],
      [tr('2 · Cortes'), tr('Esperando los pedidos de Julio'), notes('cuts')],
      [tr('3 · Productividad'), lab.total.perHour == null ? '—' : tr('{0} cajas por hora-persona', lab.total.perHour), notes('labor')],
      [tr('4 · Costco MVM'), tr('{0} cajas de {1} planeadas ({2})', n0(day.cases), n0(day.planCases), pc(day.pct)), notes('costco')],
      [tr('5 · Grill y freidora'), tr('Sus hojas de siempre'), notes('grill')]]
    const costco: Cell[][] = [...head, [tr('Fecha'), tr('Mezclas planeadas'), tr('Mezclas (Spiral)'), tr('Cajas planeadas'), tr('Cajas (Packing)'), tr('Diferencia'), tr('% del plan')],
      ...last.map((x): Cell[] => [x.date, x.planMixes, x.mixes, x.planCases, x.cases, x.diff, x.pct == null ? '' : Math.round(x.pct * 1000) / 10]),
      [], [tr('Plan del mes'), mo.monthPlan], [tr('Plan hasta este día'), mo.planToDate], [tr('Hecho hasta este día'), mo.actualToDate], [tr('Diferencia'), mo.gap], [tr('Necesario por día para cumplir el mes'), mo.perDay ?? ''], [tr('Forecast de Costco del mes'), mo.forecast ?? '']]
    const labor: Cell[][] = [...head, [tr('Cuarto'), tr('Programados'), tr('Vinieron'), tr('Temporales'), tr('Horas-persona'), tr('Producción'), tr('Unidad'), tr('Por hora-persona')],
      ...lab.rows.map((r): Cell[] => [r.dept, r.scheduled, r.showed, r.temps, r.hours, r.made, r.unit, r.perHour ?? '']),
      [tr('TOTAL'), lab.total.scheduled, lab.total.showed, lab.total.temps, lab.total.hours, lab.total.cases, tr('cajas'), lab.total.perHour ?? '']]
    const bytes = await xlsxBytes([{ name: tr('Resumen'), rows: resumen }, { name: tr('Pesos'), rows: [...head, [tr('Hora'), tr('Línea'), tr('Código'), tr('Lote'), tr('Revisados'), tr('Pesados'), tr('Promedio (oz)'), tr('Mínimo'), tr('Máximo'), tr('Objetivo (oz)'), tr('Bajos'), tr('Sobre'), tr('Anotó'), tr('Cada pouch')], ...wts.flatMap((w) => w.tests.map((t): Cell[] => { const ws = wtWeights(t), avg = ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : null; return [fmtTime(t.at), t.line, t.code, t.lot, t.entries.length, ws.length, avg == null ? '' : Math.round(avg * 1000) / 1000, ws.length ? Math.min(...ws) : '', ws.length ? Math.max(...ws) : '', w.target ? w.target.pouch + ' ± ' + w.target.tol : '', t.entries.filter((e) => entryClass(e, w.target) === 'bajo').length, t.entries.filter((e) => entryClass(e, w.target) === 'sobre').length, t.by, t.entries.map((e) => (e.w != null ? String(e.w) : '') + (e.k === 'sobre' ? ' ▲' : e.k === 'bajo' ? ' ▼' : '')).join(', ')] })), [], [notes('weights')]] }, { name: tr('Cortes'), rows: [...head, [tr('Esperando los pedidos de Julio')], [notes('cuts')]] }, { name: tr('Productividad'), rows: labor }, { name: 'Costco MVM', rows: costco }, { name: tr('Grill y freidora'), rows: [...head, [notes('grill')]] }])
    download(new File([bytes], 'ER-Ops-Summary-' + date + '.xlsx', { type: XLSX_TYPE }))
  }
  const tiles: { part: string; cls: string; big: string; small: string }[] = [
    { part: tr('1 · Pesos'), cls: !allW ? 'grey' : outW / allW > 0.1 ? 'bad' : outW ? 'warn' : 'ok', big: allW ? tr('{0} de {1} fuera', outW, allW) : tr('sin pruebas'), small: allW ? (nTests === 1 ? tr('1 prueba') : tr('{0} pruebas', nTests)) + ' · ' + (wts.length === 1 ? tr('1 código') : tr('{0} códigos', wts.length)) : tr('RTE anota los pesos con ⚖ Peso') },
    { part: tr('2 · Cortes'), cls: 'grey', big: tr('pendiente'), small: tr('esperando los pedidos de Julio') },
    { part: tr('3 · Productividad'), cls: lab.total.written ? 'go' : 'grey', big: lab.total.perHour == null ? '—' : tr('{0} cajas/h-p', lab.total.perHour), small: lab.total.written ? tr('{0} de {1} vinieron · {2} temporales', lab.total.showed, lab.total.scheduled, lab.total.temps) : tr('nadie anotado en la asistencia') },
    { part: tr('4 · Costco MVM'), cls: !plan ? 'grey' : day.pct == null ? 'grey' : day.pct >= 1 ? 'ok' : day.pct >= 0.9 ? 'warn' : 'bad', big: tr('{0} cajas', n0(day.cases)), small: plan ? tr('plan {0} · {1}', n0(day.planCases), pc(day.pct)) : tr('falta cargar el planner') },
    { part: tr('5 · Grill y freidora'), cls: 'grey', big: tr('sus hojas'), small: tr('se siguen llevando como hoy') },
  ]
  return (
    <section className="kpi">
      <div className="kpi-top">
        <div><h2>{tr('📋 E.R. - Ops Summary')}</h2><small>{nice(date)} · <span className="kpi-lock">{tr('🔒 Solo tú y quien pusiste en la lista')}</span></small></div>
        <div className="btns"><button type="button" className="btn primary" onClick={() => void excel()}>{tr('⬇ Excel')}</button></div>
      </div>
      <div className="chips">
        <button type="button" className="chip" onClick={() => setDate(dayBefore(date))}>{tr('‹ Día anterior')}</button>
        <button type="button" className={'chip' + (date === dayBefore(today) ? ' on' : '')} onClick={() => setDate(dayBefore(today))}>{tr('Ayer')}</button>
        <button type="button" className={'chip' + (date === today ? ' on' : '')} onClick={() => setDate(today)}>{tr('Hoy (hasta ahora)')}</button>
        <input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label={tr('Escoger día')} />
      </div>
      <div className="kpi-tiles">{tiles.map((t) => <div key={t.part} className={'kpi-tile ' + t.cls}><label>{t.part}</label><b>{t.big}</b><small>{t.small}</small></div>)}</div>

      <article className="kpi-sec">
        <h3>{tr('1 · Pesos y rendimiento')}</h3>
        <p className="hint">{tr('Lo que RTE anota con el botón ⚖ Peso de cada línea: los pouches sobre o bajo de peso, y los pesos que escribieron contra el objetivo de cada código (lo pone un manager con el peso que diga QA). Crudo y cocido se agregan cuando QA mande sus objetivos.')}</p>
        {wts.length > 0 ? <div className="scroll"><table className="kpi-tbl">
          <thead><tr><th>{tr('Código')}</th><th className="n">{tr('Pruebas')}</th><th className="n">{tr('Revisados')}</th><th className="n">{tr('Pesados')}</th><th className="n">{tr('Promedio (oz)')}</th><th className="n">{tr('Mín · Máx')}</th><th className="n">{tr('Objetivo (oz)')}</th><th className="n">{tr('Bajos')}</th><th className="n">{tr('Sobre')}</th></tr></thead>
          <tbody>{wts.map((w) => <tr key={w.code}><td>{w.code}</td><td className="n">{w.tests.length}</td><td className="n">{w.checked}</td><td className="n">{w.n}</td><td className="n">{w.avg ?? '—'}{w.avgPct != null && <small className={Math.abs(w.avgPct) > 0.02 ? 'red' : ''}> ({(w.avgPct > 0 ? '+' : '') + Math.round(w.avgPct * 1000) / 10}%)</small>}</td><td className="n">{w.min == null ? '—' : w.min + ' · ' + w.max}</td><td className="n">{w.target ? w.target.pouch + ' ± ' + w.target.tol : '—'}</td><td className={'n' + (w.under ? ' red' : '')}>{w.under}</td><td className={'n' + (w.over ? ' red' : '')}>{w.over}</td></tr>)}</tbody>
        </table></div> : <p className="hint">{tr('No hay pruebas de peso este día.')}</p>}
        <Note s={s} date={date} part="weights" ro={viewOnly} />
      </article>

      <article className="kpi-sec">
        <h3>{tr('2 · Servicio al cliente: cortes y faltantes')}</h3>
        <p className="hint">{tr('Cada pedido incompleto con su razón y el plan para reponer. Se construye cuando Julio diga de dónde sale lo pedido por PO; mientras, escribe aquí los cortes del día.')}</p>
        <Note s={s} date={date} part="cuts" ro={viewOnly} />
      </article>

      <article className="kpi-sec">
        <h3>{tr('3 · Productividad laboral')}</h3>
        <p className="hint">{tr('Programados = las personas esperadas de cada cuarto; vinieron, los temporales y las horas salen de la Asistencia que anotan los supervisores; la producción, de Actividad.')}</p>
        {!s.attView.on && <p className="hint amber">{tr('La Asistencia todavía solo la ves tú: para que los supervisores anoten a su gente, préndela para todos en Ajustes › Asistencia.')}</p>}
        <div className="scroll"><table className="kpi-tbl">
          <thead><tr><th>{tr('Cuarto')}</th><th className="n">{tr('Programados')}</th><th className="n">{tr('Vinieron')}</th><th className="n">{tr('Temporales')}</th><th className="n">{tr('Horas-persona')}</th><th className="n">{tr('Producción')}</th><th className="n">{tr('Por hora-persona')}</th></tr></thead>
          <tbody>
            {lab.rows.map((r) => <tr key={r.dept}><td>{DEPT_LOOK[r.dept as Dept].emoji} {r.dept}</td><td className="n">{r.scheduled}</td><td className="n">{r.written ? r.showed : '—'}</td><td className="n">{r.written ? r.temps : '—'}</td><td className="n">{r.written ? r.hours : '—'}</td><td className="n">{n0(r.made)} {r.unit}</td><td className="n">{r.perHour == null ? '—' : r.perHour + ' ' + r.unit}</td></tr>)}
            <tr className="tot"><td>{tr('Total')}</td><td className="n">{lab.total.scheduled}</td><td className="n">{lab.total.written ? lab.total.showed : '—'}</td><td className="n">{lab.total.written ? lab.total.temps : '—'}</td><td className="n">{lab.total.written ? lab.total.hours : '—'}</td><td className="n">{n0(lab.total.cases)} {tr('cajas')}</td><td className="n">{lab.total.perHour == null ? '—' : lab.total.perHour + ' ' + tr('cajas')}</td></tr>
          </tbody>
        </table></div>
        <Note s={s} date={date} part="labor" ro={viewOnly} />
      </article>

      <article className="kpi-sec">
        <h3>{tr('4 · Costco MVM tracker ({0})', COSTCO_CODE)}</h3>
        <p className="hint">{tr('Lo planeado sale del planner de Yasbelth; lo hecho, de Actividad: las mezclas de Spiral y las cajas de Packing del {0}. Nadie tiene que escribirlo.', COSTCO_CODE)}</p>
        <PlanLoader s={s} ro={viewOnly} />
        {plan && (
          <>
            <div className="kpi-chart" aria-hidden="true">
              {last.map((x) => { const top = Math.max(1, ...last.map((y) => Math.max(y.planCases, y.cases))); return <div key={x.date} className="kpi-col"><i className="p" style={{ height: (x.planCases / top) * 100 + '%' }} /><i className="a" style={{ height: (x.cases / top) * 100 + '%' }} /><span>{Number(x.date.slice(8))}</span></div> })}
            </div>
            <div className="kpi-legend"><span><i className="p" />{tr('Plan')}</span><span><i className="a" />{tr('Hecho')}</span></div>
            <div className="scroll"><table className="kpi-tbl">
              <thead><tr><th>{tr('Fecha')}</th><th className="n">{tr('Mezclas plan')}</th><th className="n">{tr('Mezclas')}</th><th className="n">{tr('Cajas plan')}</th><th className="n">{tr('Cajas')}</th><th className="n">{tr('Diferencia')}</th><th className="n">%</th></tr></thead>
              <tbody>{last.map((x) => <tr key={x.date} className={x.date === date ? 'on' : ''}><td>{x.date.slice(5)}</td><td className="n">{n0(x.planMixes)}</td><td className="n">{n0(x.mixes)}</td><td className="n">{n0(x.planCases)}</td><td className="n">{n0(x.cases)}</td><td className={'n ' + (x.diff < 0 ? 'red' : 'ok')}>{(x.diff > 0 ? '+' : '') + n0(x.diff)}</td><td className="n">{pc(x.pct)}</td></tr>)}</tbody>
            </table></div>
            <div className="kpi-month">
              <div><label>{tr('Plan del mes')}</label><b>{n0(mo.monthPlan)}</b></div>
              <div><label>{tr('Hecho en el mes')}</label><b>{n0(mo.actualToDate)}</b><small>{tr('de {0} planeadas hasta este día · {1}', n0(mo.planToDate), pc(mo.pct))}</small></div>
              <div><label>{tr('Necesario por día')}</label><b className={mo.perDay != null && mo.perDay > (plan.perMix * 100) ? 'red' : ''}>{mo.perDay == null ? '—' : n0(mo.perDay)}</b><small>{tr('para cumplir el plan del mes · {0} días planeados quedan', mo.left)}</small></div>
              <div><label>{tr('Forecast de Costco')}</label><b>{mo.forecast == null ? '—' : n0(mo.forecast)}</b><small>{tr('del mes, según el planner')}</small></div>
            </div>
          </>
        )}
        <Note s={s} date={date} part="costco" ro={viewOnly} />
      </article>

      <article className="kpi-sec">
        <h3>{tr('5 · Grill y freidora')}</h3>
        <p className="hint">{tr('Skip: "ya lo hacen perfecto, solo que se mantenga al día". Siguen sus hojas (Grill Cook total, Bs grill chicken, Panko Chicken Production Tracking); aquí solo lo que haya que decir.')}</p>
        <Note s={s} date={date} part="grill" ro={viewOnly} />
      </article>

      {admin && <Access s={s} />}
    </section>
  )
}

/** "what we saw · root cause · action" of a part on a day: written here, saved for whoever sees the report */
function Note({ s, date, part, ro }: { s: State; date: string; part: KpiPart; ro: boolean }) {
  const saved = kpiNote(s, date, part), rec = kpiGet(s, 'note:' + date + ':' + part)
  const [text, setText] = useState(saved)
  useEffect(() => setText(saved), [saved, date])
  const dirty = text.trim() !== saved.trim()
  return (
    <div className="kpi-note">
      <label>{tr('Qué vimos · causa raíz · acción')}</label>
      {ro ? <p>{saved || '—'}</p> : <textarea rows={3} value={text} maxLength={2000} placeholder={tr('Qué pasó, por qué (pregunta "¿por qué?" hasta la causa raíz) y qué se va a hacer')} onChange={(e) => setText(e.target.value)} />}
      <div className="kpi-nfoot">
        {rec && <small>{tr('{0} · {1}', rec.by, fmtTime(rec.at))}</small>}
        {!ro && <button type="button" className="btn sm primary" disabled={!dirty} onClick={() => kpiPut('note:' + date + ':' + part, { text: text.trim() })}>{tr('Guardar')}</button>}
      </div>
    </div>
  )
}

/** loading Yasbelth's planner (her Excel saved as CSV): it replaces the plan the report reads */
function PlanLoader({ s, ro }: { s: State; ro: boolean }) {
  const plan = costcoPlan(s), box = useRef<HTMLInputElement>(null)
  const [said, setSaid] = useState('')
  const pick = async (f: File | undefined) => {
    if (!f) return
    const p = parsePlanner(await f.text(), f.name)
    if (typeof p === 'string') { setSaid(tr(p)); return }
    kpiPut('plan:' + COSTCO_CODE, p as unknown as Record<string, unknown>)
    const days = Object.keys(p.days).sort()
    setSaid(tr('Plan cargado: {0} días, del {1} al {2}, {3} cajas por mezcla.', days.length, days[0], days[days.length - 1], p.perMix))
  }
  return (
    <div className="kpi-plan">
      {plan ? <span>{tr('Planner: {0} · cargado por {1} el {2}', plan.file || 'CSV', plan.by, new Date(plan.at).toLocaleDateString(locale))}</span> : <span className="amber">{tr('Falta cargar el planner de Costco de Yasbelth (en Excel: Archivo › Guardar como › CSV).')}</span>}
      {!ro && <><button type="button" className="btn sm soft" onClick={() => box.current?.click()}>{plan ? tr('Cargar uno nuevo') : tr('Cargar el planner (CSV)')}</button><input ref={box} type="file" accept=".csv,text/csv" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} /></>}
      {said && <p className="hint ok">{said}</p>}
    </div>
  )
}

/** who besides the admin sees the report (Edgar): the name exactly as their account shows it */
function Access({ s }: { s: State }) {
  const names = kpiNames(s)
  const [name, setName] = useState('')
  const save = (list: string[]) => kpiPut('access', { names: list })
  return (
    <article className="kpi-sec kpi-access">
      <h3>{tr('🔒 Quién ve este reporte')}</h3>
      <p className="hint">{tr('Tú siempre. Además, los nombres de esta lista, escritos como sale su nombre en su cuenta (Ajustes › Empleados). Tienen que ser manager u oficina para poder guardar notas.')}</p>
      <ul>{names.map((n) => <li key={n}>{n} <button type="button" className="lnk sm" onClick={() => save(names.filter((x) => x !== n))}>{tr('Quitar')}</button></li>)}</ul>
      <form onSubmit={(e) => { e.preventDefault(); const t = name.trim(); if (t && !names.includes(t)) save([...names, t]); setName('') }}>
        <input value={name} maxLength={60} placeholder={tr('Nombre, por ejemplo Edgar Carhuapoma')} onChange={(e) => setName(e.target.value)} aria-label={tr('Nombre')} />
        <button type="submit" className="btn sm primary" disabled={!name.trim()}>{tr('Agregar')}</button>
      </form>
    </article>
  )
}
