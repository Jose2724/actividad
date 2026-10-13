import { useEffect, useState } from 'react'
import { missingColumn, rowRights, supabase } from './supabase'
import { cleanPowers, defaultPowers, POWERS, type Power } from './powers'
import { DEPTS } from './store'
import { ConfirmDialog } from './App'
import { tr } from './i18n'
import { trx } from './trx'

type Emp = { id: string; user_id?: string | null; name: string; username: string | null; role: string; active: boolean; act_role: 'op' | 'mgr' | 'office' | null; act_dept: string | null; deleted?: boolean; act_powers?: string[] | null; act_shift?: number | null }
const ERRORS: Record<string, string> = {
  not_signed_in: tr('No hay sesión.'), not_manager: tr('Solo un manager puede hacer esto.'), bad_name: tr('Falta el nombre.'), bad_username: tr('Usuario: 3 a 30 letras, números, punto o guion, sin espacios.'),
  bad_pin: tr('PIN: de 6 a 12 números.'), bad_dept: tr('Un operador necesita departamento.'), username_taken: tr('Ese usuario ya existe.'), not_found: tr('No se encontró.'), owner_protected: tr('Esa cuenta no se puede tocar.'), not_self: tr('No puedes quitarte el acceso a ti mismo.'), owner_only: tr('Los poderes de un manager solo los cambia el dueño.'), no_columns: tr('Falta aplicar el cambio de poderes en la base de datos.'), unknown_action: tr('Falta actualizar la función de usuarios en el servidor.'),
}

const ROLE: Record<string, string> = { op: tr('Operador'), mgr: tr('Manager'), office: tr('Oficina') }

/**
 * The manager's people screen: who may use Actividad, with what role and department; new accounts with their PIN.
 * meId / admin = who is looking (their row in employees, and whether they are a Freezer RTE admin): a row only shows
 * what that person may really do to it (see rowRights).
 */
export function Employees({ meId, admin }: { meId: string; admin: boolean }) {
  const [list, setList] = useState<Emp[] | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ name: '', username: '', pin: '', act_role: 'op', act_dept: 'RTE' })
  const [pinFor, setPinFor] = useState<Emp | null>(null)
  const [newPin, setNewPin] = useState('')
  const [toggle, setToggle] = useState<Emp | null>(null)
  // powers and shift per person: there once the database has their columns (null = not known yet)
  const [hasPowers, setHasPowers] = useState<boolean | null>(null)
  const [powersFor, setPowersFor] = useState<Emp | null>(null)
  const [picked, setPicked] = useState<Power[]>([])
  const [shift, setShift] = useState(0)
  const load = async () => {
    const cols = 'id, user_id, name, username, role, active, act_role, act_dept, deleted'
    const ask = async (c: string) => { const r = await supabase!.from('employees').select(c).order('name'); return { data: r.data as unknown as Emp[] | null, error: r.error } }
    let { data, error } = await ask(cols + ', act_powers, act_shift')
    const fresh = !error
    // the powers columns come with a change in the database: without it the list is the one of always
    if (error && missingColumn(error)) ({ data, error } = await ask(cols))
    if (error) { setMsg(error.message); return }
    setHasPowers(fresh)
    setList((data ?? []).filter((e) => !e.deleted))
  }
  useEffect(() => { void load() }, [])
  const call = async (body: Record<string, unknown>) => {
    setBusy(true); setMsg('')
    const { data, error } = await supabase!.functions.invoke('act-users', { body })
    setBusy(false)
    const err = error ? (await errText(error)) : (data as { error?: string })?.error
    if (err) { setMsg(ERRORS[err] ?? err); return false }
    await load(); return true
  }
  return (
    <section className="report emps">
      <div className="rhead"><h2>{tr('Empleados')}</h2></div>
      <p className="hint">{trx('Los mismos usuarios y PIN que Freezer RTE. {0} solo ve su departamento; {1} ve todo y corrige; {2} ve todo y lleva productos y programa. Sin rol = no entra a Actividad.', <b>{tr('Operador')}</b>, <b>{tr('Manager')}</b>, <b>{tr('Oficina')}</b>)}</p>
      {msg && <p className="err">{msg}</p>}
      <form className="newemp" onSubmit={(e) => { e.preventDefault(); void call({ action: 'create', ...form }).then((ok) => { if (ok) setForm({ name: '', username: '', pin: '', act_role: 'op', act_dept: 'RTE' }) }) }}>
        <h3>{tr('Nuevo usuario')}</h3>
        <div className="egrid">
          <label>{tr('Nombre')}{' '}<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="off" /></label>
          <label>{tr('Usuario')}{' '}<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} autoCapitalize="none" autoComplete="off" placeholder={tr('ej. maria.rte')} /></label>
          <label>{tr('PIN (6–12 números)')}{' '}<input value={form.pin} inputMode="numeric" onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} autoComplete="off" /></label>
          <label>{tr('Rol')}{' '}<select value={form.act_role} onChange={(e) => setForm({ ...form, act_role: e.target.value })}><option value="op">{tr('Operador')}</option><option value="mgr">{tr('Manager')}</option><option value="office">{tr('Oficina')}</option></select></label>
          {form.act_role === 'op' && <label>{tr('Departamento')}{' '}<select value={form.act_dept} onChange={(e) => setForm({ ...form, act_dept: e.target.value })}>{DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>}
        </div>
        <button className="btn primary" type="submit" disabled={busy || !form.name.trim() || !form.username.trim() || form.pin.length < 6}>{tr('Crear usuario')}</button>
      </form>
      {list === null ? <p className="hint">{tr('Cargando…')}</p> : (
        <div className="twrap">
          <table>
            <thead><tr><th>{tr('Nombre')}</th><th>{tr('Usuario')}</th><th>{tr('Rol en Actividad')}</th><th>{tr('Departamento')}</th>{hasPowers && <><th>{tr('Turno')}</th><th>{tr('Poderes')}</th></>}<th>{tr('Activo')}</th><th></th></tr></thead>
            <tbody>{list.map((e) => {
              const can = rowRights(e, meId, admin)
              return (
                <tr key={e.id} className={e.active ? '' : 'off'}>
                  <td>{e.name}{e.role === 'admin' && <small> {' '}{tr('· admin freezer')}</small>}{can.mine && <small> {' '}{tr('· tú')}</small>}{can.locked && <small> {' '}{tr('· cuenta protegida')}</small>}</td>
                  <td>{e.username ?? '—'}</td>
                  <td>{can.role
                    ? <select value={e.act_role ?? ''} disabled={busy} onChange={(ev) => void call({ action: 'set_act', id: e.id, act_role: ev.target.value || null, act_dept: e.act_dept ?? (ev.target.value === 'op' ? 'RTE' : null) })}><option value="">{tr('Sin acceso')}</option><option value="op">{tr('Operador')}</option><option value="mgr">{tr('Manager')}</option><option value="office">{tr('Oficina')}</option></select>
                    : (e.act_role ? ROLE[e.act_role] ?? e.act_role : tr('Sin acceso'))}</td>
                  <td>{e.act_role !== 'op' ? '—' : can.role
                    ? <select value={e.act_dept ?? ''} disabled={busy} onChange={(ev) => void call({ action: 'set_act', id: e.id, act_role: 'op', act_dept: ev.target.value })}>{DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
                    : (e.act_dept ?? '—')}</td>
                  {hasPowers && <><td>{e.act_role ? (e.act_shift === 1 || e.act_shift === 2 ? tr('Turno {0}', e.act_shift) : tr('Los dos')) : '—'}</td><td>{!e.act_role ? '—' : e.role === 'admin' ? tr('Todos') : e.act_powers == null ? tr('Los de su rol') : tr('{0} de {1}', (cleanPowers(e.act_powers) ?? []).length, POWERS.length)}</td></>}
                  <td>{e.active ? tr('Sí') : tr('No')}</td>
                  <td className="btns">
                    {hasPowers && !!e.act_role && !can.locked && !can.mine && e.role !== 'admin' && (admin || e.act_role !== 'mgr') && <button type="button" className="lnk" disabled={busy} onClick={() => { setPicked(cleanPowers(e.act_powers) ?? defaultPowers(e.act_role)); setShift(e.act_shift === 1 || e.act_shift === 2 ? e.act_shift : 0); setPowersFor(e) }}>{tr('Poderes')}</button>}
                    {can.pin && <button type="button" className="lnk" disabled={busy} onClick={() => { setNewPin(''); setPinFor(e) }}>PIN</button>}
                    {can.active && <button type="button" className="lnk" disabled={busy} onClick={() => setToggle(e)}>{e.active ? tr('Desactivar') : tr('Activar')}</button>}
                  </td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      )}
      {pinFor && (
        <div className="veil" onClick={() => setPinFor(null)}>
          <div className="dlg" onClick={(ev) => ev.stopPropagation()}>
            <h3>{trx('Nuevo PIN para {0}', pinFor.name)}</h3>
            <form className="qform" onSubmit={(ev) => { ev.preventDefault(); void call({ action: 'set_pin', id: pinFor.id, pin: newPin }).then((ok) => { if (ok) setPinFor(null) }) }}>
              <label>{tr('PIN (6–12 números)')}{' '}<input autoFocus inputMode="numeric" value={newPin} onChange={(ev) => setNewPin(ev.target.value.replace(/\D/g, ''))} autoComplete="off" /></label>
              <div className="dbtns"><button type="button" className="btn" onClick={() => setPinFor(null)}>{tr('Cancelar')}</button><button type="submit" className="btn primary" disabled={busy || newPin.length < 6}>{tr('Guardar')}</button></div>
            </form>
          </div>
        </div>
      )}
      {hasPowers === false && <p className="hint">{tr('Los poderes y el turno de cada persona aparecen aquí cuando se aplique el cambio en la base de datos. Mientras tanto cada quien tiene los de su rol.')}</p>}
      {powersFor && (
        <div className="veil" onClick={() => setPowersFor(null)}>
          <div className="dlg" onClick={(ev) => ev.stopPropagation()}>
            <h3>{trx('Poderes de {0}', powersFor.name)}</h3>
            <p>{ROLE[powersFor.act_role ?? ''] ?? tr('Sin rol')}{powersFor.act_role === 'op' && powersFor.act_dept ? ' ' + tr('de {0}', powersFor.act_dept) : ''}{tr('. Marca lo que puede hacer además de trabajar su línea. Lo que no esté marcado no le sale en la pantalla.')}</p>
            <div className="powers">{POWERS.map((x) => <label key={x.key}><input type="checkbox" checked={picked.includes(x.key)} onChange={(ev) => setPicked(ev.target.checked ? [...picked, x.key] : picked.filter((k) => k !== x.key))} /> {x.label}</label>)}</div>
            <label>{tr('Turno')}{' '}<select value={shift} onChange={(ev) => setShift(Number(ev.target.value))}><option value={0}>{tr('Los dos turnos')}</option><option value={1}>{tr('Turno 1')}</option><option value={2}>{tr('Turno 2')}</option></select></label>
            <p className="hint">{tr('Con un turno, el Reporte le abre en ese turno y solo corrige lo de su turno, salvo que tenga "Corregir lo del otro turno". Tiene que cerrar y abrir la app para que tome los cambios.')}</p>
            <div className="dbtns spread">
              <div className="btns"><button type="button" className="lnk" disabled={busy} onClick={() => { const t = powersFor; void call({ action: 'set_powers', id: t.id, powers: null, shift: shift || null }).then((ok) => { if (ok) setPowersFor(null) }) }}>{tr('Volver a los de su rol')}</button></div>
              <div className="btns">
                <button type="button" className="btn" onClick={() => setPowersFor(null)}>{tr('Cancelar')}</button>
                <button type="button" className="btn primary" disabled={busy} onClick={() => { const t = powersFor; void call({ action: 'set_powers', id: t.id, powers: picked, shift: shift || null }).then((ok) => { if (ok) setPowersFor(null) }) }}>{tr('Guardar')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {toggle && <ConfirmDialog title={(toggle.active ? tr('¿Desactivar a') + ' ' : tr('¿Activar a') + ' ') + toggle.name + '?'} text={toggle.active ? tr('No podrá entrar a Actividad ni a Freezer RTE hasta que se active de nuevo.') : tr('Podrá entrar otra vez con su PIN.')} yes={toggle.active ? tr('Desactivar') : tr('Activar')} danger={toggle.active} onYes={() => { const t = toggle; setToggle(null); void call({ action: 'set_active', id: t.id, active: !t.active }) }} onNo={() => setToggle(null)} />}
    </section>
  )
}

async function errText(error: unknown): Promise<string> {
  // the function answers with a JSON body also on errors; supabase-js hands it over as a Response
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') { try { const b = await ctx.json(); if (b?.error) return String(b.error) } catch { /* no body */ } }
  return (error as Error).message ?? String(error)
}
