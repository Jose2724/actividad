import { useEffect, useMemo, useState } from 'react'
import { awayDay, type State } from './store'
import { loadDay } from './sync'
import { datesFrom, downtimeOf, netsuiteSheet, pplhBook, pplhOfRange, pplhRow, readNetsuite, savePplhLbs, setPplhHours, PPLH_SITE, type NetsuiteRead } from './pplh'
import { loadZip, readCsv, readXlsx, xlsxNow, XLSX_TYPE } from './xlsx'
import { addDays, download } from './App'
import { tr } from './i18n'

const lb = (x: number) => Math.round(x).toLocaleString('en-US')
const one = (x: number) => x.toFixed(1)
const h = (ms: number) => (Math.round(ms / 36_000) / 100).toFixed(1)

/**
 * Mike's daily KPI in the report (2026-11-02): the NetSuite file Melissa sends is read here and its pounds kept, the
 * day's hours from HR are typed, and the pounds per labor hour of each day and of the range come out, with each room's
 * downtime of the report's day. The Excel, in English and in his look, is what goes to him by 11:30 AM
 */
export function PplhView({ s, date, now, edit }: { s: State; date: string; now: number; edit: boolean }) {
  const [from, setFrom] = useState(() => addDays(date, -6))
  const [to, setTo] = useState(date)
  useEffect(() => { setFrom(addDays(date, -6)); setTo(date) }, [date])
  const range = useMemo(() => (from && to && from <= to ? datesFrom(from, to) : []), [from, to])
  // (days older than the device keeps are brought, for their downtime)
  useEffect(() => { for (const d of new Set([date, ...range])) if (awayDay(d)) void loadDay(d) }, [date, from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = range.map((d) => pplhRow(s, d)), all = pplhOfRange(rows), today = pplhRow(s, date)
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
  const save = () => {
    if (!read) return
    savePplhLbs(s, read.r.days, read.file)
    setSaid(tr('Guardadas las libras de {0} días.', read.r.days.length)); setRead(null)
  }
  const excel = async () => {
    const make = () => xlsxNow(pplhBook(s, from, to, date, now))
    const bytes = make() ?? (await loadZip(), make())
    if (bytes) download(new File([bytes], 'PPLH-East-Rutherford-' + date + '.xlsx', { type: XLSX_TYPE }))
  }
  const saveHours = (d: string, text: string) => {
    const n = Number(text.replace(/,/g, ''))
    const was = pplhRow(s, d).hours
    if (!text.trim()) { if (was != null) setPplhHours(d, null); return }
    if (Number.isFinite(n) && n > 0 && n !== was) setPplhHours(d, n)
  }
  return (
    <>
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
      <article className="wt-rp">
        <h3>{tr('Día por día')}</h3>
        <div className="btns pplh-range"><label>{tr('Desde')} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>{tr('Hasta')} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></div>
        <div className="scroll"><table className="wt-rp-tbl mini">
          <thead><tr><th>{tr('Fecha')}</th><th>{tr('Libras (NetSuite)')}</th><th>{tr('Horas (RR. HH.)')}</th><th>PPLH</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} className={r.date === date ? 'on' : ''}>
                <td><b>{r.date}</b></td>
                <td>{r.lbs == null ? '—' : lb(r.lbs)}</td>
                <td>{edit ? <input key={r.date + ':' + (r.hours ?? '')} className="pplh-h" inputMode="decimal" defaultValue={r.hours ?? ''} aria-label={tr('Horas del {0}', r.date)} onBlur={(e) => saveHours(r.date, e.target.value)} /> : r.hours == null ? '—' : one(r.hours)}</td>
                <td>{r.pplh == null ? '—' : one(r.pplh)}</td>
              </tr>
            ))}
            <tr><td><b>{tr('Rango')}</b></td><td>{lb(all.lbs)}</td><td>{one(all.hours)}</td><td>{all.pplh == null ? '—' : one(all.pplh)}</td></tr>
          </tbody>
        </table></div>
        <p className="hint">{tr('El rango suma las libras y las horas de los días que tienen las dos, y luego divide: no es un promedio de los días. Un día sin archivo o sin horas queda vacío, nunca estimado.')}</p>
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
    </>
  )
}
