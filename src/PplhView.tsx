import { useEffect, useMemo, useState } from 'react'
import { awayDay, type State } from './store'
import { loadDay } from './sync'
import { datesFrom, downtimeOf, netsuiteSheet, pplhBook, pplhLbsByHand, readHours, setPplhLbsHand, type HoursRead, pplhGroups, pplhNames, pplhOfGroups, pplhOfRange, pplhRow, pplhWeekHours, rangeShortcuts, readNetsuite, savePplhLbs, setPplhHours, setPplhNames, setPplhWeekHours, PPLH_SITE, type NetsuiteRead, type PplhBy } from './pplh'
import { loadZip, readCsv, readXlsx, xlsxNow, XLSX_TYPE } from './xlsx'
import { download } from './App'
import { locale, tr } from './i18n'

const lb = (x: number) => Math.round(x).toLocaleString('en-US')
const one = (x: number) => x.toFixed(1)
const h = (ms: number) => (Math.round(ms / 36_000) / 100).toFixed(1)
const monthLabel = (ym: string) => new Date(ym + '-01T12:00:00').toLocaleDateString(locale, { month: 'long', year: 'numeric' })

/**
 * Mike's daily KPI in the report (2026-11-02): the NetSuite file Melissa sends is read here and its pounds kept, the
 * day's hours from HR are typed, and the pounds per labor hour of each day and of the range come out, with each room's
 * downtime of the report's day. The Excel, in English and in his look, is what goes to him by 11:30 AM
 */
export function PplhView({ s, date, now, edit, admin }: { s: State; date: string; now: number; edit: boolean; admin: boolean }) {
  // (the report's day alone until a range is tapped, Jose 2026-11-03)
  const [from, setFrom] = useState(date)
  const [to, setTo] = useState(date)
  useEffect(() => { setFrom(date); setTo(date) }, [date])
  const range = useMemo(() => (from && to && from <= to ? datesFrom(from, to) : []), [from, to])
  // (days older than the device keeps are brought, for their downtime)
  useEffect(() => { for (const d of new Set([date, ...range])) if (awayDay(d)) void loadDay(d) }, [date, from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = range.map((d) => pplhRow(s, d)), all = pplhOfRange(rows), today = pplhRow(s, date)
  // (by week or by month, as Mike looks at it: one row per week, Monday to Sunday, or per month)
  const [by, setBy] = useState<PplhBy>('day')
  // the table opens locked, with its numbers; Editar shows the boxes (Jose, 2026-11-03: a button to edit and to lock, so nothing changes by a stray tap)
  const [unlocked, setUnlocked] = useState(false)
  const open = edit && unlocked
  const groups = useMemo(() => (by === 'day' || !range.length ? [] : pplhGroups(s, from, to, by)), [s, from, to, by, range.length]), allG = pplhOfGroups(groups)
  const down = useMemo(() => downtimeOf(s, [date], now), [s, date, now])
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
  const hReplaced = hrs ? hrs.r.days.filter((d) => pplhRow(s, d.date).hours != null).length : 0
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
    const make = () => xlsxNow(pplhBook(s, from, to, date, now, by))
    const bytes = make() ?? (await loadZip(), make())
    if (bytes) download(new File([bytes], 'PPLH-East-Rutherford-' + date + '.xlsx', { type: XLSX_TYPE }))
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
    <div className="pplh">
      <p className="hint">{tr('Libras por hora de trabajo de {0}: las libras de NetSuite (el archivo de Melissa) ÷ las horas de Recursos Humanos. El día del reporte es la fecha de arriba: para el reporte de las 11:30, elige ayer.', PPLH_SITE)}</p>
      <article className="wt-rp">
        <h3>{tr('Día del reporte')}</h3>
        <div className="pplh-tiles">
          <div><small>{tr('Libras')}</small><b>{today.lbs == null ? '—' : lb(today.lbs)}</b></div>
          <div><small>{tr('Horas')}</small><b>{today.hours == null ? '—' : one(today.hours)}</b></div>
          <div><small>PPLH</small><b>{today.pplh == null ? '—' : one(today.pplh)}</b></div>
        </div>
        {today.lbs == null && <p className="hint amber">{tr('Falta el archivo de NetSuite de este día.')}</p>}
        {today.hours == null && <p className="hint amber">{tr('Faltan las horas de Recursos Humanos de este día.')}</p>}
        <div className="btns"><button type="button" className="btn primary" onClick={() => void excel()}>{tr('⬇ Excel para Mike')}</button></div>
      </article>
      {edit && (
        <article className="wt-rp">
          <h3>{tr('Subir el archivo de NetSuite')}</h3>
          <label className="btn soft pplh-file">{tr('📄 Elegir el archivo (.xlsx o .csv)')}<input type="file" accept=".xlsx,.csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f) }} /></label>
          {err && <p className="hint red">{err}</p>}
          {said && <p className="hint ok">{said}</p>}
          {read && (
            <div className="pplh-read">
              <p>{tr('{0}: {1} días de {2}, del {3} al {4}, {5} lb en total.', read.file, read.r.days.length, PPLH_SITE, read.r.days[0].date, read.r.days[read.r.days.length - 1].date, lb(read.r.days.reduce((t, d) => t + d.lbs, 0)))}</p>
              <p className="hint">{tr('No se cuentan: {0} filas de otras plantas, {1} líneas de total y {2} subtotales sin fecha.', read.r.other, read.r.totals, read.r.undated)}{read.r.bad ? ' ' + tr('{0} filas sin libras.', read.r.bad) : ''}</p>
              {replaced > 0 && <p className="hint amber">{tr('Reemplaza las libras de {0} días que ya estaban.', replaced)}</p>}
              <div className="btns"><button type="button" className="btn" onClick={() => setRead(null)}>{tr('Cancelar')}</button><button type="button" className="btn primary" onClick={save}>{tr('✓ Guardar las libras')}</button></div>
            </div>
          )}
        </article>
      )}
      {edit && (
        <article className="wt-rp">
          <h3>{tr('Subir el archivo de horas de Will')}</h3>
          <p className="hint">{tr('El reporte diario de horas de Recursos Humanos (Timesheet Entries): la app suma las horas de cada día de toda la planta y las escribe en la tabla. No guarda nombres.')}</p>
          <label className="btn soft pplh-file">{tr('📄 Elegir el archivo de horas (.xlsx)')}<input type="file" accept=".xlsx" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickHours(f) }} /></label>
          {hErr && <p className="hint red">{hErr}</p>}
          {hSaid && <p className="hint ok">{hSaid}</p>}
          {hrs && (
            <div className="pplh-read">
              {hrs.r.days.map((d) => <p key={d.date}>{tr('{0}: {1} horas, {2} personas, {3} entradas de reloj.', d.date, one(d.hours), d.people, d.entries)}{d.blank ? ' ' + tr('{0} entradas sin horas ("--").', d.blank) : ''}</p>)}
              {hrs.r.divisions.length > 0 && <p className="hint">{tr('Divisiones: {0}.', hrs.r.divisions.join(', '))}</p>}
              {hReplaced > 0 && <p className="hint amber">{tr('Reemplaza las horas de {0} días que ya estaban.', hReplaced)}</p>}
              <div className="btns"><button type="button" className="btn" onClick={() => setHrs(null)}>{tr('Cancelar')}</button><button type="button" className="btn primary" onClick={saveHrs}>{tr('✓ Guardar las horas')}</button></div>
            </div>
          )}
        </article>
      )}
      <article className="wt-rp">
        <h3>{by === 'week' ? tr('Semana por semana') : by === 'month' ? tr('Mes por mes') : tr('Día por día')}{edit && <button type="button" className={'btn sm ' + (unlocked ? 'primary' : 'soft')} onClick={() => setUnlocked((x) => !x)}>{unlocked ? tr('🔒 Bloquear') : tr('✏️ Editar')}</button>}</h3>
        <RangePick from={from} to={to} today={date} onChange={(a, b) => { setFrom(a); setTo(b) }} />
        <div className="btns pplh-by">{(['day', 'week', 'month'] as PplhBy[]).map((b) => <button key={b} type="button" className={'btn sm ' + (by === b ? 'primary' : 'soft')} onClick={() => setBy(b)}>{b === 'day' ? tr('Por día') : b === 'week' ? tr('Por semana') : tr('Por mes')}</button>)}</div>
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
        <p className="hint">{tr('El rango suma las libras y las horas de los días que tienen las dos, y luego divide: no es un promedio de los días. Un día sin archivo o sin horas queda vacío, nunca estimado.')}{edit && ' ' + tr('Toca Editar para escribir libras u horas; cada casilla se guarda al salir de ella, y Bloquear vuelve a dejar los números fijos. Si Mike dicta las libras de un día, escríbelas en su casilla; el archivo de NetSuite, cuando llegue, las reemplaza.')}{by !== 'day' && ' ' + tr('Las semanas van de lunes a domingo, como el SUMMARY de Mike. Si Recursos Humanos da las horas por semana y no por día, se escriben en la fila de la semana completa (Por semana) y toman todas las libras de esa semana.')}</p>
      </article>
      <article className="wt-rp">
        <h3>{tr('Downtime por cuarto · día del reporte')}</h3>
        <div className="scroll"><table className="wt-rp-tbl mini">
          <thead><tr><th>{tr('Departamento')}</th><th>{tr('Trabajado (h)')}</th><th>{tr('Parado (h)')}</th><th>{tr('% Paros')}</th><th>{tr('Lunch y Break (h)')}</th><th>{tr('Set up (h)')}</th><th>{tr('Causa principal')}</th></tr></thead>
          <tbody>{down.map((x) => { const top = [...x.causes].sort((a, b) => b[1] - a[1])[0]; return (
            <tr key={x.dept}><td><b>{x.dept}</b></td><td>{x.time ? h(x.worked) : '—'}</td><td>{x.time ? h(x.stopped) : '—'}</td><td className={x.time && x.stopped / x.time > 0.15 ? 'red' : ''}>{x.time ? one((x.stopped / x.time) * 100) + '%' : '—'}</td><td>{x.time ? h(x.lunch) : '—'}</td><td>{x.time ? h(x.setup) : '—'}</td><td>{top ? tr(top[0]) + ' · ' + h(top[1]) + ' h' : '—'}</td></tr>
          ) })}</tbody>
        </table></div>
      </article>
      <article className="wt-rp">
        <h3>{tr('Yield de 0889 y 2234')}</h3>
        <p className="hint amber">{tr('Falta la fuente de las libras de cada producto: el archivo de NetSuite trae ingredientes, no dice a qué producto fueron. Sale vacío en el Excel hasta que se defina.')}</p>
      </article>
      {admin && <PplhAccess s={s} />}
    </div>
  )
}

/** From / To, and the ranges one taps instead of typing: this week (Monday to Sunday), last week, this month, last month */
export function RangePick({ from, to, today, onChange }: { from: string; to: string; today: string; onChange: (from: string, to: string) => void }) {
  const label = { day: tr('Hoy'), week: tr('Esta semana'), lastWeek: tr('Semana pasada'), month: tr('Este mes'), lastMonth: tr('Mes pasado') }
  return (
    <div className="btns pplh-range">
      <label>{tr('Desde')} <input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} /></label>
      <label>{tr('Hasta')} <input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} /></label>
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
      <p className="hint">{tr('Tú siempre. Además, los nombres de esta lista, escritos como sale su nombre en su cuenta (Ajustes › Empleados). Nadie más la ve.')}</p>
      <ul>{names.map((n) => <li key={n}>{n} <button type="button" className="lnk sm" onClick={() => setPplhNames(names.filter((x) => x !== n))}>{tr('Quitar')}</button></li>)}</ul>
      <form className="btns" onSubmit={(e) => { e.preventDefault(); const t = name.trim(); if (t && !names.includes(t)) setPplhNames([...names, t]); setName('') }}>
        <input value={name} maxLength={60} placeholder={tr('Nombre, por ejemplo Edgar Carhuapoma')} onChange={(e) => setName(e.target.value)} aria-label={tr('Nombre')} />
        <button type="submit" className="btn sm primary" disabled={!name.trim()}>{tr('Agregar')}</button>
      </form>
    </article>
  )
}
