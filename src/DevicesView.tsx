import { useEffect, useState } from 'react'
import { tr } from './i18n'
import { fetchDevices, type DeviceRow } from './devices'
import { BUILD, updateStore } from './update'
import { clockNow, fmtTime } from './clock-fmt'

/**
 * Every device that has spoken to the server (see devices.ts): who is on it, how long since its last word, which
 * build it runs, what it has not sent and why, how its clock is. The office finds here, in one look, the tablet that
 * stopped recording and what is wrong with it.
 */
export function Devices({ now }: { now: number }) {
  const [rows, setRows] = useState<DeviceRow[] | null>(null)
  const [err, setErr] = useState('')
  const [at, setAt] = useState(0)
  const load = async () => { try { setRows(await fetchDevices()); setErr(''); setAt(clockNow()) } catch (e) { setErr(String((e as Error)?.message ?? e)) } }
  useEffect(() => { void load(); const t = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 30_000); return () => clearInterval(t) }, [])
  const latest = updateStore.get().build || BUILD // the newest build known to this screen
  const ago = (iso: string | null) => (iso ? now - Date.parse(iso) : null)
  const agoText = (ms: number) => (ms < 90_000 ? tr('hace un momento') : ms < 3_600_000 ? tr('hace {0} min', Math.round(ms / 60_000)) : ms < 86_400_000 ? tr('hace {0} h', Math.round(ms / 360_000) / 10) : tr('hace {0} días', Math.round(ms / 86_400_000)))
  const missing = /act_devices|schema cache|does not exist/i.test(err)
  return (
    <section className="report devices">
      <div className="rhead">
        <div className="rtitle"><h2>{tr('Tablets')}</h2><span>{rows ? tr('{0} aparatos han hablado con el servidor', rows.length) : tr('Cargando…')}{at ? ' · ' + tr('visto a las {0}', fmtTime(at)) : ''}</span></div>
        <div className="racts"><button type="button" className="btn" onClick={() => void load()}>{tr('↻ Actualizar lista')}</button></div>
      </div>
      <p className="hint">{tr('Cada aparato con la app abierta avisa cada minuto: quién está dentro, qué versión tiene, qué registró que todavía no ha subido y por qué, y cómo va su reloj. Uno que lleva más de 3 minutos sin avisar está sin señal, cerrado, o el servidor ya no lo reconoce.')}</p>
      {missing && <p className="hint red">{tr('Falta ejecutar en Supabase el SQL de la tabla de tablets (013_tablets.sql).')}</p>}
      {err && !missing && <p className="hint red">{err}</p>}
      {rows && rows.length === 0 && !err && <p className="hint">{tr('Ningún aparato ha avisado todavía. Avisan en cuanto abren esta versión de la app.')}</p>}
      {rows && rows.length > 0 && (
        <div className="twrap">
          <table className="devtable">
            <thead><tr><th>{tr('Aparato')}</th><th>{tr('Quién')}</th><th>{tr('Último aviso')}</th><th>{tr('Versión')}</th><th>{tr('Sin subir')}</th><th>{tr('Última bajada')}</th><th>{tr('Reloj')}</th></tr></thead>
            <tbody>{rows.map((d) => {
              const seen = ago(d.seen_at), silent = seen == null || seen > 3 * 60_000
              const stuck = d.pending > 0 && d.oldest_at && now - Date.parse(d.oldest_at) > 5 * 60_000
              const old = !!d.build && !!latest && d.build !== latest
              const bad = silent || stuck || !!d.error || d.clock === 'own'
              return (
                <tr key={d.id} className={bad ? 'dev-bad' : 'dev-ok'}>
                  <td><b>{d.ua || tr('Aparato')}</b><small className="pname">{d.id}</small></td>
                  <td><b>{d.name || '—'}</b><small className="pname">{[d.role === 'op' ? tr('operador') : d.role === 'mgr' ? 'manager' : d.role, d.dept].filter(Boolean).join(' · ')}</small></td>
                  <td className={silent ? 'red' : 'ok'}>{seen == null ? '—' : agoText(seen)}{silent && <small className="pname">{tr('sin avisar: sin señal, cerrado o sin sesión válida')}</small>}</td>
                  <td className={old ? 'amber' : ''}>{d.build ? d.build.slice(0, 6) : '—'}{old && <small className="pname">{tr('versión vieja: se actualiza sola cuando esté quieto')}</small>}</td>
                  <td className={d.pending > 0 ? (stuck ? 'red' : 'amber') : 'ok'}>{d.pending > 0 ? (d.pending === 1 ? tr('1 registro') : tr('{0} registros', d.pending)) + (d.oldest_at ? ' · ' + agoText(now - Date.parse(d.oldest_at)) : '') : tr('nada')}{d.error && <small className="pname red">{d.error}</small>}</td>
                  <td>{d.last_sync ? agoText(now - Date.parse(d.last_sync)) : '—'}</td>
                  <td className={d.clock === 'own' ? 'red' : d.clock === 'rough' ? 'amber' : 'ok'}>{d.clock === 'own' ? tr('el suyo (sin ajustar)') : d.clock === 'rough' ? tr('a ojo') : d.clock === 'fine' ? tr('en hora') : '—'}{Math.abs(d.offset_ms) >= 60_000 && <small className="pname">{tr('{0} min de diferencia', Math.round(Math.abs(d.offset_ms) / 60_000))}</small>}</td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}
