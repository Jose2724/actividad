import { useEffect, useMemo, useRef, useState } from 'react'
import { awayDay, dayBefore, rosterOf, type State } from './store'
import { loadDay } from './sync'
import { datesFrom, downtimeOf, HOURS_FLAG, hoursWho, SHIFT_CHECKER, keepRange, plusDays, rangeKept, netsuiteSheet, pplhBook, pplhLbsByHand, readHours, setPplhLbsHand, type HoursRead, pplhGroups, pplhNames, pplhOfGroups, pplhOfRange, pplhRow, pplhWeekHours, rangeShortcuts, readNetsuite, savePplhLbs, setPplhHours, setPplhNames, setPplhWeekHours, PPLH_SITE, type NetsuiteRead, type PplhBy } from './pplh'
import { loadZip, readCsv, readXlsx, xlsxNow, XLSX_TYPE } from './xlsx'
import { download } from './App'
import { locale, tr } from './i18n'
import { RD } from './rd'

const lb = (x: number) => Math.round(x).toLocaleString('en-US')
const one = (x: number) => x.toFixed(1)
const h = (ms: number) => (Math.round(ms / 36_000) / 100).toFixed(1)
const monthLabel = (ym: string) => new Date(ym + '-01T12:00:00').toLocaleDateString(locale, { month: 'long', year: 'numeric' })

/**
 * Mike's daily KPI in the report (2026-11-02): the NetSuite file Melissa sends is read here and its pounds kept, the
 * day's hours from HR are typed, and the pounds per labor hour of each day and of the range come out, with each room's
 * downtime of the report's day. The Excel, in English and in his look, is what goes to him by 11:30 AM
 */
export function PplhView({ s, date, today, now, edit, admin }: { s: State; date: string; today: string; now: number; edit: boolean; admin: boolean }) {
  // the report is of the day before (Jose, 2026-11-03: it runs once the day is over): yesterday while the date above is today's; another date above is taken as it is
  const day0 = date === today ? dayBefore(date) : date
  // (the report's day alone until a range is tapped, Jose 2026-11-03)
  // (the range comes back after a reload; the report's day changing resets it)
  const [from, setFrom] = useState(() => rangeKept('pplh')?.from ?? day0)
  const [to, setTo] = useState(() => rangeKept('pplh')?.to ?? day0)
  const day0Was = useRef(day0)
  useEffect(() => { if (day0Was.current !== day0) { day0Was.current = day0; setFrom(day0); setTo(day0) } }, [day0])
  useEffect(() => { keepRange('pplh', from, to) }, [from, to])
  const range = useMemo(() => (from && to && from <= to ? datesFrom(from, to) : []), [from, to])
  // (days older than the device keeps are brought, for their downtime)
  useEffect(() => { for (const d of new Set([day0, ...range])) if (awayDay(d)) void loadDay(d) }, [day0, from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = range.map((d) => pplhRow(s, d)), all = pplhOfRange(rows), rep = pplhRow(s, day0)
  // (by week or by month, as Mike looks at it: one row per week, Monday to Sunday, or per month)
  const [by, setBy] = useState<PplhBy>('day')
  // the table opens locked, with its numbers; Editar shows the boxes (Jose, 2026-11-03: a button to edit and to lock, so nothing changes by a stray tap)
  const [unlocked, setUnlocked] = useState(false)
  const open = edit && unlocked
  const [why, setWhy] = useState(false)
  const groups = useMemo(() => (by === 'day' || !range.length ? [] : pplhGroups(s, from, to, by)), [s, from, to, by, range.length]), allG = pplhOfGroups(groups)
  const down = useMemo(() => downtimeOf(s, [day0], now), [s, day0, now])
  const [read, setRead] = useState<{ file: string; r: NetsuiteRead } | null>(null)
  const [err, setErr] = useState('')
  const [said, setSaid] = useState('')
  const pick = async (f: File) => {
    setErr(''); setRead(null); setSaid('')
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      const r = /\.(csv|txt)$/i.test(f.name) ? readNetsuite(readCsv(new TextDecoder().decode(bytes))) : netsuiteSheet(readXlsx(bytes, await loadZip()))?.read ?? null
      if (!r?.found) return setErr(tr('Este archivo no trae las columnas de NetSuite (Subsidiary y Lbs Used).'))
      if (!r.days.length) return setErr(tr('El archivo no trae libras de {0}.', PPLH_SITE))
      setRead({ file: f.name, r })
    } catch { setErr(tr('No se pudo leer el archivo. Si es de Excel, guárdalo como .xlsx y vuelve a subirlo.')) }
  }
  const replaced = read ? read.r.days.filter((d) => pplhRow(s, d.date).lbs != null).length : 0
  // Will's hours file (2026-11-03): each day's total typed by the app instead of by hand; nothing of the people is kept
  const [hrs, setHrs] = useState<{ file: string; r: HoursRead } | null>(null)
  const [hErr, setHErr] = useState('')
  const [hSaid, setHSaid] = useState('')
  const pickHours = async (f: File) => {
    setHErr(''); setHrs(null); setHSaid('')
    try {
      const r = readHours(readXlsx(new Uint8Array(await f.arrayBuffer()), await loadZip()))
      if (!r.found) return setHErr(tr('Este archivo no trae las columnas del reporte de horas (Employee, Date y Total).'))
      if (!r.days.length) return setHErr(tr('El archivo no trae horas de ningún día.'))
      setHrs({ file: f.name, r })
    } catch { setHErr(tr('No se pudo leer el archivo. Si es de Excel, guárdalo como .xlsx y vuelve a subirlo.')) }
  }
  const saveHrs = () => {
    if (!hrs) return
    for (const d of hrs.r.days) setPplhHours(d.date, d.hours)
    setHSaid(tr('Guardadas las horas de {0} días.', hrs.r.days.length)); setHrs(null)
  }
  const save = () => {
    if (!read) return
    savePplhLbs(s, read.r.days, read.file)
    setSaid(tr('Guardadas las libras de {0} días.', read.r.days.length)); setRead(null)
  }
  const excel = async () => {
    const make = () => xlsxNow(pplhBook(s, from, to, day0, now, by))
    const bytes = make() ?? (await loadZip(), make())
    if (bytes) download(new File([bytes], 'PPLH-East-Rutherford-' + day0 + '.xlsx', { type: XLSX_TYPE }))
  }
  const saveHours = (d: string, text: string) => {
    const n = Number(text.replace(/,/g, ''))
    const was = pplhRow(s, d).hours
    if (!text.trim()) { if (was != null) setPplhHours(d, null); return }
    if (Number.isFinite(n) && n > 0 && n !== was) setPplhHours(d, n)
  }
  // a day's pounds typed by hand when Melissa's file does not come (Mike dictates them, 2026-11-03); a file's day can be written over too (10/27 came in the file half done)
  const saveLbs = (d: string, text: string) => {
    const n = Number(text.replace(/,/g, ''))
    const was = pplhRow(s, d).lbs
    if (!text.trim()) { if (was != null) setPplhLbsHand(s, d, null); return }
    if (Number.isFinite(n) && n > 0 && n !== was) setPplhLbsHand(s, d, n)
  }
  const saveWeekHours = (monday: string, text: string) => {
    const n = Number(text.replace(/,/g, ''))
    const was = pplhWeekHours(s, monday)
    if (!text.trim()) { if (was != null) setPplhWeekHours(monday, null); return }
    if (Number.isFinite(n) && n > 0 && n !== was) setPplhWeekHours(monday, n)
  }
  // (trimmed to a readable width as the dashboard, Jose 2026-11-03: "darle algo de diseño y trim it")
  return (
    <div className={'pplh' + (RD ? ' rd-pplh' : '')}>
      {RD && (
        <>
          <div className="rd-wtbar">
            <h2 className="rd-wttitle">📈 PPLH</h2>
            <RangePick compact from={from} to={to} today={day0} dayLabel={day0 !== date ? tr('Ayer') : undefined} onChange={(a, b) => { setFrom(a); setTo(b) }} />
            <div className="seg rd-rangeseg" role="group" aria-label={tr('Ver')}>{(['day', 'week', 'month'] as PplhBy[]).map((b) => <button key={b} type="button" className={by === b ? 'on' : ''} aria-pressed={by === b} onClick={() => setBy(b)}>{b === 'day' ? tr('Por día') : b === 'week' ? tr('Por semana') : tr('Por mes')}</button>)}</div>
            <div className="rd-wtacts"><button type="button" className="btn primary" onClick={() => void excel()}>{tr('⬇ Excel para Mike')}</button></div>
          </div>
          <div className="rd-tiles rd-pplhtiles">
            <div className={'rd-tile' + (rep.lbs == null ? ' pend' : '')}><label>⚖️ {tr('Libras')} · {day0}</label><b>{rep.lbs == null ? '—' : lb(rep.lbs)}</b><small>{rep.lbs == null ? tr('Falta el archivo') : 'NetSuite'}</small></div>
            <div className={'rd-tile' + (rep.hours == null ? ' pend' : '')}><label>⏱️ {tr('Horas')} · {day0}</label><b>{rep.hours == null ? '—' : one(rep.hours)}</b><small>{rep.hours == null ? tr('Falta el archivo') : tr('Recursos Humanos')}</small></div>
            <div className={'rd-tile' + (rep.pplh == null ? ' pend' : ' ok')}><label>📈 PPLH · {day0}</label><b>{rep.pplh == null ? '—' : one(rep.pplh)}</b><small>{tr('lb por hora de trabajo')}</small></div>
            <div className={'rd-tile' + (all.pplh == null ? ' pend' : '')}><label>📊 {tr('PPLH del rango')}</label><b>{all.pplh == null ? '—' : one(all.pplh)}</b><small>{range.length === 1 ? tr('1 día') : tr('{0} días', range.length)}</small></div>
          </div>
          {range.length > 1 && rows.some((r) => r.pplh != null) && <article className="rd-card"><h3>📊 {tr('PPLH por día')}</h3><PplhChart rows={rows} avg={all.pplh} /></article>}
        </>
      )}
      {!RD && <p className="hint">{tr('Libras por hora de trabajo de {0}: las libras de NetSuite (el archivo de Melissa) ÷ las horas de Recursos Humanos. El día del reporte es ayer; si cambias la fecha de arriba, es esa.', PPLH_SITE)}</p>}
      {!RD && <article className="wt-rp">
        <h3>{tr('Día del reporte')} · {day0}</h3>
        <div className="pplh-tiles">
          <div><small>{tr('Libras')}</small><b>{rep.lbs == null ? '—' : lb(rep.lbs)}</b></div>
          <div><small>{tr('Horas')}</small><b>{rep.hours == null ? '—' : one(rep.hours)}</b></div>
          <div><small>PPLH</small><b>{rep.pplh == null ? '—' : one(rep.pplh)}</b></div>
        </div>
        {rep.lbs == null && <p className="hint amber">{tr('Falta el archivo de NetSuite de este día.')}</p>}
        {rep.hours == null && <p className="hint amber">{tr('Faltan las horas de Recursos Humanos de este día.')}</p>}
        <div className="btns"><button type="button" className="btn primary" onClick={() => void excel()}>{tr('⬇ Excel para Mike')}</button></div>
      </article>}
      {edit && RD && (
        <div className="rd-pplhup">
          <label className={'rd-upbtn' + (rep.lbs == null ? ' miss' : ' has')}><i aria-hidden="true">⚖️</i><span><b>{tr('Subir libras')}</b><small>NetSuite · .xlsx .csv</small></span><em>{rep.lbs == null ? tr('Falta {0}', day0) : '✓ ' + day0}</em><input type="file" accept=".xlsx,.csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f) }} /></label>
          <label className={'rd-upbtn' + (rep.hours == null ? ' miss' : ' has')}><i aria-hidden="true">⏱️</i><span><b>{tr('Subir horas')}</b><small>{tr('Will · .xlsx')}</small></span><em>{rep.hours == null ? tr('Falta {0}', day0) : '✓ ' + day0}</em><input type="file" accept=".xlsx" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickHours(f) }} /></label>
        </div>
      )}
      {edit && <div className={'pplh-uploads' + (RD ? ' rd-pplhread' : '')}>
        <article className={'wt-rp' + (RD && !err && !said && !read ? ' rd-hide' : '')}>
          {!RD && <h3>{tr('Subir el archivo de NetSuite')}</h3>}
          {!RD && <label className="btn soft pplh-file">{tr('📄 Elegir el archivo (.xlsx o .csv)')}<input type="file" accept=".xlsx,.csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f) }} /></label>}
          {err && <p className="hint red">{err}</p>}
          {said && <p className="hint ok">{said}</p>}
          {read && (
            <div className="pplh-read">
              <p>{tr('{0}: {1} días de {2}, del {3} al {4}, {5} lb en total.', read.file, read.r.days.length, PPLH_SITE, read.r.days[0].date, read.r.days[read.r.days.length - 1].date, lb(read.r.days.reduce((t, d) => t + d.lbs, 0)))}</p>
              {!RD && <p className="hint">{tr('No se cuentan: {0} filas de otras plantas, {1} líneas de total y {2} subtotales sin fecha.', read.r.other, read.r.totals, read.r.undated)}{read.r.bad ? ' ' + tr('{0} filas sin libras.', read.r.bad) : ''}</p>}
              {replaced > 0 && <p className="hint amber">{tr('Reemplaza las libras de {0} días que ya estaban.', replaced)}</p>}
              <div className="btns"><button type="button" className="btn" onClick={() => setRead(null)}>{tr('Cancelar')}</button><button type="button" className="btn primary" onClick={save}>{tr('✓ Guardar las libras')}</button></div>
            </div>
          )}
        </article>
        <article className={'wt-rp' + (RD && !hErr && !hSaid ? ' rd-hide' : '')}>
          {!RD && <h3>{tr('Subir el archivo de horas de Will')}</h3>}
          {!RD && <p className="hint">{tr('El reporte diario de horas de Recursos Humanos (Timesheet Entries): la app suma las horas de cada día de toda la planta y las escribe en la tabla. No guarda nombres.')}</p>}
          {!RD && <label className="btn soft pplh-file">{tr('📄 Elegir el archivo de horas (.xlsx)')}<input type="file" accept=".xlsx" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickHours(f) }} /></label>}
          {hErr && <p className="hint red">{hErr}</p>}
          {hSaid && <p className="hint ok">{hSaid}</p>}
          {hrs && <p className="hint">{tr('Revisa el archivo abajo y guárdalo.')}</p>}
        </article>
      </div>}
      {edit && hrs && <HoursReview s={s} file={hrs.file} r={hrs.r} onCancel={() => setHrs(null)} onSave={saveHrs} />}
      <article className="wt-rp">
        <h3>{RD && '📋 '}{by === 'week' ? tr('Semana por semana') : by === 'month' ? tr('Mes por mes') : tr('Día por día')}{RD && <button type="button" className={'rd-why' + (why ? ' on' : '')} aria-expanded={why} aria-label={tr('Cómo se calcula')} onClick={() => setWhy((x) => !x)}>ⓘ</button>}{edit && <button type="button" className={'btn sm ' + (unlocked ? 'primary' : 'soft')} onClick={() => setUnlocked((x) => !x)}>{unlocked ? tr('🔒 Bloquear') : tr('✏️ Editar')}</button>}</h3>
        {!RD && <RangePick from={from} to={to} today={day0} dayLabel={day0 !== date ? tr('Ayer') : undefined} onChange={(a, b) => { setFrom(a); setTo(b) }} />}
        {!RD && <div className="btns pplh-by">{(['day', 'week', 'month'] as PplhBy[]).map((b) => <button key={b} type="button" className={'btn sm ' + (by === b ? 'primary' : 'soft')} onClick={() => setBy(b)}>{b === 'day' ? tr('Por día') : b === 'week' ? tr('Por semana') : tr('Por mes')}</button>)}</div>}
        <div className="scroll"><table className="wt-rp-tbl mini">
          <thead><tr><th>{by === 'week' ? tr('Semana') : by === 'month' ? tr('Mes') : tr('Fecha')}</th><th>{tr('Libras (NetSuite)')}</th><th>{tr('Horas (RR. HH.)')}</th><th>PPLH</th>{by !== 'day' && <th>{tr('Días con libras')}</th>}</tr></thead>
          <tbody>
            {by === 'day' ? rows.map((r) => (
              <tr key={r.date} className={r.date === date ? 'on' : ''}>
                <td><b>{r.date}</b></td>
                <td>{open ? <><input key={r.date + ':' + (r.lbs ?? '')} className="pplh-h lbs" inputMode="decimal" defaultValue={r.lbs ?? ''} placeholder={tr('a mano')} aria-label={tr('Libras del {0}', r.date)} onBlur={(e) => saveLbs(r.date, e.target.value)} />{r.lbs != null && <small> {pplhLbsByHand(s, r.date) ? tr('a mano') : tr('archivo')}</small>}</> : r.lbs == null ? '—' : <>{lb(r.lbs)}{pplhLbsByHand(s, r.date) && <small> {tr('a mano')}</small>}</>}</td>
                <td>{open ? <input key={r.date + ':' + (r.hours ?? '')} className="pplh-h" inputMode="decimal" defaultValue={r.hours ?? ''} aria-label={tr('Horas del {0}', r.date)} onBlur={(e) => saveHours(r.date, e.target.value)} /> : r.hours == null ? '—' : one(r.hours)}</td>
                <td>{r.pplh == null ? '—' : one(r.pplh)}</td>
              </tr>
            )) : groups.map((g) => (
              <tr key={g.key} className={g.from <= date && date <= g.to ? 'on' : ''}>
                <td><b>{by === 'week' ? tr('Semana del {0}', g.from) : monthLabel(g.key)}</b>{!g.whole && <small> · {tr('cortada por el rango')}</small>}</td>
                <td>{g.lbs == null ? '—' : lb(g.lbs)}</td>
                <td>{open && by === 'week' && g.whole && !g.hoursDays ? <input key={g.key + ':' + (g.hours ?? '')} className="pplh-h" inputMode="decimal" defaultValue={g.hours ?? ''} placeholder={tr('semana')} aria-label={tr('Horas de la semana del {0}', g.from)} onBlur={(e) => saveWeekHours(g.key, e.target.value)} /> : g.hours == null ? '—' : <>{one(g.hours)}{g.weekly ? <small> {tr('por semana')}</small> : g.hoursDays < g.days ? <small> {tr('{0} de {1} días', g.hoursDays, g.days)}</small> : null}</>}</td>
                <td>{g.pplh == null ? '—' : one(g.pplh)}</td>
                <td>{g.lbsDays} / {g.days}</td>
              </tr>
            ))}
            {by === 'day' ? <tr><td><b>{tr('Rango')}</b></td><td>{lb(all.lbs)}</td><td>{one(all.hours)}</td><td>{all.pplh == null ? '—' : one(all.pplh)}</td></tr>
              : <tr><td><b>{tr('Rango')}</b></td><td>{lb(allG.lbs)}</td><td>{one(allG.hours)}</td><td>{allG.pplh == null ? '—' : one(allG.pplh)}</td><td>{groups.reduce((t, g) => t + g.lbsDays, 0)} / {range.length}</td></tr>}
          </tbody>
        </table></div>
        {(!RD || why) && <p className="hint">{tr('El rango suma las libras y las horas de los días que tienen las dos, y luego divide: no es un promedio de los días. Un día sin archivo o sin horas queda vacío, nunca estimado.')}{edit && ' ' + tr('Toca Editar para escribir libras u horas; cada casilla se guarda al salir de ella, y Bloquear vuelve a dejar los números fijos. Si Mike dicta las libras de un día, escríbelas en su casilla; el archivo de NetSuite, cuando llegue, las reemplaza.')}{by !== 'day' && ' ' + tr('Las semanas van de lunes a domingo, como el SUMMARY de Mike. Si Recursos Humanos da las horas por semana y no por día, se escriben en la fila de la semana completa (Por semana) y toman todas las libras de esa semana.')}</p>}
      </article>
      <article className="wt-rp">
        <h3>{RD ? '⏸️ ' + tr('Downtime por cuarto') + ' · ' + day0 : tr('Downtime por cuarto · día del reporte')}</h3>
        <div className="scroll"><table className="wt-rp-tbl mini">
          <thead><tr><th>{tr('Departamento')}</th><th>{tr('Trabajado (h)')}</th><th>{tr('Parado (h)')}</th><th>{tr('% Paros')}</th><th>{tr('Lunch y Break (h)')}</th><th>{tr('Set up (h)')}</th><th>{tr('Causa principal')}</th></tr></thead>
          <tbody>{down.map((x) => { const top = [...x.causes].sort((a, b) => b[1] - a[1])[0]; return (
            <tr key={x.dept}><td><b>{x.dept}</b></td><td>{x.time ? h(x.worked) : '—'}</td><td>{x.time ? h(x.stopped) : '—'}</td><td className={x.time && x.stopped / x.time > 0.15 ? 'red' : ''}>{x.time ? one((x.stopped / x.time) * 100) + '%' : '—'}</td><td>{x.time ? h(x.lunch) : '—'}</td><td>{x.time ? h(x.setup) : '—'}</td><td>{top ? tr(top[0]) + ' · ' + h(top[1]) + ' h' : '—'}</td></tr>
          ) })}</tbody>
        </table></div>
      </article>
      {RD ? <article className="wt-rp rd-pplhyield"><h3>🎯 {tr('Yield de 0889 y 2234')}<span className="rd-pill su">{tr('Pendiente')}</span></h3><small>{tr('Falta saber de dónde salen las libras de cada producto.')}</small></article> : <article className="wt-rp">
        <h3>{tr('Yield de 0889 y 2234')}</h3>
        <p className="hint amber">{tr('Falta la fuente de las libras de cada producto: el archivo de NetSuite trae ingredientes, no dice a qué producto fueron. Sale vacío en el Excel hasta que se defina.')}</p>
      </article>}
      {admin && <PplhAccess s={s} />}
    </div>
  )
}

/** From / To, and the ranges one taps instead of typing: this week (Monday to Sunday), last week, this month, last month */
/**
 * Will's hours file before it is saved (Jose, 2026-11-06, on the first real file: the list was squeezed in half the
 * screen; "que se vea profesional y robusto"): the whole width, what each day brings against what the table has, then
 * the people with too many hours side by side, one column for whoever confirms them, and the two buttons at the top
 * and at the bottom. Saving writes each day's hours in the table, as before
 */
function HoursReview({ s, file, r, onCancel, onSave }: { s: State; file: string; r: HoursRead; onCancel: () => void; onSave: () => void }) {
  const box = useRef<HTMLElement>(null)
  useEffect(() => { box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [file, r])
  const was = (date: string) => pplhRow(s, date).hours
  const over = r.days.reduce((n, d) => n + d.over.length, 0)
  const acts = <div className="hrv-acts"><button type="button" className="btn" onClick={onCancel}>{tr('Cancelar')}</button><button type="button" className="btn primary" onClick={onSave}>{tr('✓ Guardar las horas')}</button></div>
  return (
    <article ref={box} className="wt-rp hrv">
      <header className="hrv-top">
        <div><h3>⏱️ {tr('Revisar las horas antes de guardar')}</h3><small>{file}</small></div>
        {acts}
      </header>
      <div className="scroll"><table className="wt-rp-tbl mini hrv-days">
        <thead><tr><th>{tr('Fecha')}</th><th>{tr('Horas del archivo')}</th><th>{tr('En la tabla ahora')}</th><th>{tr('Personas')}</th><th>{tr('Entradas de reloj')}</th><th>{tr('Sin horas')}</th><th>{tr('{0} h o más', HOURS_FLAG)}</th></tr></thead>
        <tbody>{r.days.map((d) => { const w = was(d.date); return (
          <tr key={d.date}>
            <td><b>{d.date}</b></td>
            <td><b>{one(d.hours)}</b></td>
            <td>{w == null ? <span className="hrv-new">{tr('Nuevo')}</span> : w === d.hours ? <span className="hrv-same">{tr('Igual')}</span> : <span className="hrv-chg">{one(w)} → {one(d.hours)}</span>}</td>
            <td>{d.people}</td>
            <td>{d.entries}</td>
            <td>{d.blank || '—'}</td>
            <td>{d.over.length ? <b className="hrv-bad">{d.over.length}</b> : <span className="hrv-ok">0</span>}</td>
          </tr>) })}</tbody>
      </table></div>
      {over > 0 ? <HoursOverList s={s} days={r.days} /> : <p className="hrv-allok">✓ {tr('Nadie tiene {0} horas o más en un día.', HOURS_FLAG)}</p>}
      {r.divisions.length > 0 && <details className="hrv-div"><summary>{tr('Divisiones del archivo ({0})', r.divisions.length)}</summary><p>{r.divisions.join(' · ')}</p></details>}
      <footer className="hrv-foot"><small>{tr('Al guardar, las horas de cada día van a la tabla de abajo. La app no guarda nombres.')}</small>{acts}</footer>
    </article>
  )
}

/**
 * The people with too many hours in one day, each in the list of whoever confirms them (Jose, 2026-11-06: "lo que sean
 * del turno 1 que diga Josh y los del turno 2 Santiago, así cada uno con su lista y si no se sabe que le salga a los dos"),
 * side by side. A shift whose Employee List is not in Ajustes says so in its column, since its people fall to both
 */
function HoursOverList({ s, days }: { s: State; days: HoursRead['days'] }) {
  const all = days.flatMap((d) => d.over.map((x) => ({ ...x, date: d.date, ...hoursWho(s, x) })))
  const mine = all.filter((x) => !x.other), others = all.filter((x) => x.other)
  const depts = [...new Set(others.map((x) => x.other))].sort()
  const groups = [
    { k: 1, who: SHIFT_CHECKER[1], sub: tr('Turno 1'), list: mine.filter((x) => x.shift === 1), noList: !rosterOf(s, 1).people.length },
    { k: 2, who: SHIFT_CHECKER[2], sub: tr('Turno 2'), list: mine.filter((x) => x.shift === 2), noList: !rosterOf(s, 2).people.length },
    { k: 0, who: tr('{0} y {1}', SHIFT_CHECKER[1], SHIFT_CHECKER[2]), sub: tr('No se sabe el turno'), list: mine.filter((x) => x.shift == null), noList: false },
    // people of another department (Sanitation, Warehouse, QC...): their own supervisor checks them, not Josh nor Santiago (2026-11-06)
    { k: 3, who: tr('Otros departamentos'), sub: depts.join(' · '), list: others.sort((a, b) => a.other.localeCompare(b.other) || b.hours - a.hours), noList: false },
  ].filter((g) => (g.k !== 0 && g.k !== 3) || g.list.length)
  const multi = days.filter((d) => d.over.length).length > 1
  return (
    <div className="hov">
      <div className="hov-head">
        <span className="hov-warn" aria-hidden="true">⚠</span>
        <div><b>{all.length === 1 ? tr('1 persona con {0} horas o más en un día', HOURS_FLAG) : tr('{0} personas con {1} horas o más en un día', all.length, HOURS_FLAG)}</b>
          <small>{tr('Cada supervisor revisa su lista. Si las horas no son reales, se corrigen en Bamboo.')}</small></div>
      </div>
      <div className="hov-cols">
        {groups.map((g) => (
          <section key={g.k} className={'hov-g s' + g.k}>
            <header>
              <span className="hov-av" aria-hidden="true">{g.k === 3 ? '🏢' : g.k ? '👤' : '👥'}</span>
              <div><b>{g.who}</b><small>{g.sub}</small></div>
              <span className="hov-n">{g.list.length}</span>
            </header>
            {g.k === 0 && <p className="hov-why">{tr('No están en la lista de empleados de Ajustes, o el nombre se escribe distinto. Si son de otro departamento, agrégalos a la lista con su departamento. Mientras, les toca a los dos.')}</p>}
            {g.k === 3 && <p className="hov-why">{tr('No son de producción: los revisa el supervisor de su departamento.')}</p>}
            {g.noList && <p className="hov-why">{tr('Falta la lista de empleados del {0} en Ajustes › Asistencia: su gente sale con los dos.', g.sub)}</p>}
            {g.list.length ? <ul>{g.list.map((x) => (
              <li key={x.date + x.name}>
                <div className="hov-top"><b>{x.name}{x.other && <small className="hov-dept">{x.other}{x.shift ? ' · ' + tr('Turno {0}', x.shift) : ''}</small>}</b><span className="hov-h">{tr('{0} h', x.hours.toFixed(2))}</span></div>
                {multi && <small className="hov-date">{x.date}</small>}
                <div className="hov-p">{x.punches.map((p, i) => <span key={i}>{p}</span>)}</div>
              </li>
            ))}</ul> : !g.noList && <p className="hov-none">✓ {tr('Nadie')}</p>}
          </section>
        ))}
      </div>
      <p className="hint">{tr('Horas de más que no son reales suben el total de la planta y bajan el PPLH. Esta lista solo se ve aquí y ahora: la app no guarda nombres.')}</p>
    </div>
  )
}

export function RangePick({ from, to, today, dayLabel, onChange, compact }: { from: string; to: string; today: string; dayLabel?: string; onChange: (from: string, to: string) => void; compact?: boolean }) {
  const label = { day: dayLabel ?? tr('Hoy'), week: tr('Esta semana'), lastWeek: tr('Semana pasada'), month: tr('Este mes'), lastMonth: tr('Mes pasado') }
  const [open, setOpen] = useState(false)
  // the redesign: the ranges one taps in one row, the exact dates behind one button (Jose, 2026-11-05: Pesos in one screen)
  if (compact) {
    const short = (d: string) => (d ? new Date(d + 'T12:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : '')
    return (
      <div className="rd-range">
        <div className="seg rd-rangeseg" role="group" aria-label={tr('Fechas')}>{rangeShortcuts(today).map((q) => <button key={q.id} type="button" className={from === q.from && to === q.to ? 'on' : ''} aria-pressed={from === q.from && to === q.to} onClick={() => onChange(q.from, q.to)}>{label[q.id]}</button>)}</div>
        <div className="rd-menuwrap">
          <button type="button" className="btn sm rd-datesbtn" aria-expanded={open} onClick={() => setOpen((x) => !x)}>📅 {short(from)}{to && to !== from ? ' – ' + short(to) : ''} ▾</button>
          {open && <div className="rd-dropdown rd-dates">
            <label>{tr('Desde')} <input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} /></label>
            <label>{tr('Hasta')} <input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} /></label>
            <button type="button" className="btn sm primary" onClick={() => setOpen(false)}>{tr('Listo')}</button>
          </div>}
        </div>
      </div>
    )
  }
  return (
    <div className="btns pplh-range">
      <div className="pplh-dates">
        <button type="button" className="btn sm soft nav" aria-label={tr('Desde: un día atrás')} title={tr('Un día atrás')} onClick={() => from && onChange(plusDays(from, -1), to)}>‹</button>
        <label>{tr('Desde')} <input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} /></label>
        <button type="button" className="btn sm soft nav" aria-label={tr('Desde: un día adelante')} title={tr('Un día adelante')} onClick={() => from && onChange(plusDays(from, 1), to)}>›</button>
      </div>
      <div className="pplh-dates">
        <button type="button" className="btn sm soft nav" aria-label={tr('Hasta: un día atrás')} title={tr('Un día atrás')} onClick={() => to && onChange(from, plusDays(to, -1))}>‹</button>
        <label>{tr('Hasta')} <input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} /></label>
        <button type="button" className="btn sm soft nav" aria-label={tr('Hasta: un día adelante')} title={tr('Un día adelante')} onClick={() => to && onChange(from, plusDays(to, 1))}>›</button>
      </div>
      {rangeShortcuts(today).map((q) => <button key={q.id} type="button" className={'btn sm ' + (from === q.from && to === q.to ? 'primary' : 'soft')} onClick={() => onChange(q.from, q.to)}>{label[q.id]}</button>)}
    </div>
  )
}

/** who besides the admin sees this tab: the name exactly as their account shows it */
function PplhAccess({ s }: { s: State }) {
  const names = pplhNames(s)
  const [name, setName] = useState('')
  return (
    <article className="wt-rp kpi-access">
      <h3>{tr('🔒 Quién ve esta pestaña')}</h3>
      {RD ? <p className="hint">{tr('Tú y estos nombres (como salen en su cuenta).')}</p> : <p className="hint">{tr('Tú siempre. Además, los nombres de esta lista, escritos como sale su nombre en su cuenta (Ajustes › Empleados). Nadie más la ve.')}</p>}
      <ul>{names.map((n) => <li key={n}>{n} <button type="button" className="lnk sm" onClick={() => setPplhNames(names.filter((x) => x !== n))}>{tr('Quitar')}</button></li>)}</ul>
      <form className="btns" onSubmit={(e) => { e.preventDefault(); const t = name.trim(); if (t && !names.includes(t)) setPplhNames([...names, t]); setName('') }}>
        <input value={name} maxLength={60} placeholder={tr('Nombre, por ejemplo Ana Torres')} onChange={(e) => setName(e.target.value)} aria-label={tr('Nombre')} />
        <button type="submit" className="btn sm primary" disabled={!name.trim()}>{tr('Agregar')}</button>
      </form>
    </article>
  )
}

/** each day's PPLH as a bar, the range's as a dashed line (the redesign, 2026-11-06) */
function PplhChart({ rows, avg }: { rows: { date: string; pplh: number | null }[]; avg: number | null }) {
  const W = 640, H = 170, L = 40, B = 24, T = 16, vals = rows.map((r) => r.pplh ?? 0), top = Math.max(1, ...vals, avg ?? 0) * 1.15
  const Y = (v: number) => T + (1 - v / top) * (H - T - B), bw = (W - L - 8) / rows.length
  const every = Math.max(1, Math.ceil(rows.length / 14))
  return (
    <svg className="rd-pplhchart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr('PPLH por día')}>
      <line className="axis" x1={L} x2={W - 4} y1={Y(0)} y2={Y(0)} />
      {avg != null && <><line className="avg" x1={L} x2={W - 4} y1={Y(avg)} y2={Y(avg)} /><text className="lab avgl" x={W - 6} y={Y(avg) - 5} textAnchor="end">{tr('rango {0}', avg.toFixed(1))}</text></>}
      {rows.map((r, i) => {
        const x = L + i * bw + bw * 0.15, w = bw * 0.7
        return (
          <g key={r.date}>
            {r.pplh != null && <rect className="pbar" x={x} y={Y(r.pplh)} width={w} height={Math.max(1, Y(0) - Y(r.pplh))} rx="3" />}
            {r.pplh != null && rows.length <= 16 && <text className="val" x={x + w / 2} y={Y(r.pplh) - 4} textAnchor="middle">{r.pplh.toFixed(1)}</text>}
            {(i % every === 0 || i === rows.length - 1) && <text className="lab" x={x + w / 2} y={H - 7} textAnchor="middle">{r.date.slice(5).replace('-', '/')}</text>}
          </g>
        )
      })}
    </svg>
  )
}
