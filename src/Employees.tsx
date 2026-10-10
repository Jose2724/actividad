import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { DEPTS } from './store'
import { ConfirmDialog } from './App'

type Emp = { id: string; name: string; username: string | null; role: string; active: boolean; act_role: 'op' | 'mgr' | 'office' | null; act_dept: string | null; deleted?: boolean }
const ERRORS: Record<string, string> = {
  not_signed_in: 'No hay sesión.', not_manager: 'Solo un manager puede hacer esto.', bad_name: 'Falta el nombre.', bad_username: 'Usuario: 3 a 30 letras, números, punto o guion, sin espacios.',
  bad_pin: 'PIN: de 4 a 12 números.', bad_dept: 'Un operador necesita departamento.', username_taken: 'Ese usuario ya existe.', not_found: 'No se encontró.', owner_protected: 'Esa cuenta no se puede tocar.', not_self: 'No puedes quitarte el acceso a ti mismo.',
}

/** The manager's people screen: who may use Actividad, with what role and department; new accounts with their PIN. */
export function Employees() {
  const [list, setList] = useState<Emp[] | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ name: '', username: '', pin: '', act_role: 'op', act_dept: 'RTE' })
  const [pinFor, setPinFor] = useState<Emp | null>(null)
  const [newPin, setNewPin] = useState('')
  const [toggle, setToggle] = useState<Emp | null>(null)
  const load = async () => {
    const { data, error } = await supabase!.from('employees').select('id, name, username, role, active, act_role, act_dept, deleted').order('name')
    if (error) { setMsg(error.message); return }
    setList((data as Emp[]).filter((e) => !e.deleted))
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
      <div className="rhead"><h2>Empleados</h2></div>
      <p className="hint">Los mismos usuarios y PIN que Freezer RTE. <b>Operador</b> solo ve su departamento; <b>Manager</b> ve todo y corrige; <b>Oficina</b> ve todo y lleva productos y programa. Sin rol = no entra a Actividad.</p>
      {msg && <p className="err">{msg}</p>}
      <form className="newemp" onSubmit={(e) => { e.preventDefault(); void call({ action: 'create', ...form }).then((ok) => { if (ok) setForm({ name: '', username: '', pin: '', act_role: 'op', act_dept: 'RTE' }) }) }}>
        <h3>Nuevo usuario</h3>
        <div className="egrid">
          <label>Nombre <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="off" /></label>
          <label>Usuario <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} autoCapitalize="none" autoComplete="off" placeholder="ej. maria.rte" /></label>
          <label>PIN (4–12 números) <input value={form.pin} inputMode="numeric" onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} autoComplete="off" /></label>
          <label>Rol <select value={form.act_role} onChange={(e) => setForm({ ...form, act_role: e.target.value })}><option value="op">Operador</option><option value="mgr">Manager</option><option value="office">Oficina</option></select></label>
          {form.act_role === 'op' && <label>Departamento <select value={form.act_dept} onChange={(e) => setForm({ ...form, act_dept: e.target.value })}>{DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>}
        </div>
        <button className="btn primary" type="submit" disabled={busy || !form.name.trim() || !form.username.trim() || form.pin.length < 4}>Crear usuario</button>
      </form>
      {list === null ? <p className="hint">Cargando…</p> : (
        <div className="twrap">
          <table>
            <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol en Actividad</th><th>Departamento</th><th>Activo</th><th></th></tr></thead>
            <tbody>{list.map((e) => (
              <tr key={e.id} className={e.active ? '' : 'off'}>
                <td>{e.name}{e.role === 'admin' && <small> · admin freezer</small>}</td>
                <td>{e.username ?? '—'}</td>
                <td><select value={e.act_role ?? ''} disabled={busy} onChange={(ev) => void call({ action: 'set_act', id: e.id, act_role: ev.target.value || null, act_dept: e.act_dept ?? (ev.target.value === 'op' ? 'RTE' : null) })}><option value="">Sin acceso</option><option value="op">Operador</option><option value="mgr">Manager</option><option value="office">Oficina</option></select></td>
                <td>{e.act_role === 'op' ? <select value={e.act_dept ?? ''} disabled={busy} onChange={(ev) => void call({ action: 'set_act', id: e.id, act_role: 'op', act_dept: ev.target.value })}>{DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}</select> : '—'}</td>
                <td>{e.active ? 'Sí' : 'No'}</td>
                <td className="btns">
                  {e.username && <button type="button" className="lnk" disabled={busy} onClick={() => { setNewPin(''); setPinFor(e) }}>PIN</button>}
                  <button type="button" className="lnk" disabled={busy} onClick={() => setToggle(e)}>{e.active ? 'Desactivar' : 'Activar'}</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {pinFor && (
        <div className="veil" onClick={() => setPinFor(null)}>
          <div className="dlg" onClick={(ev) => ev.stopPropagation()}>
            <h3>Nuevo PIN para {pinFor.name}</h3>
            <form className="qform" onSubmit={(ev) => { ev.preventDefault(); void call({ action: 'set_pin', id: pinFor.id, pin: newPin }).then((ok) => { if (ok) setPinFor(null) }) }}>
              <label>PIN (4–12 números) <input autoFocus inputMode="numeric" value={newPin} onChange={(ev) => setNewPin(ev.target.value.replace(/\D/g, ''))} autoComplete="off" /></label>
              <div className="dbtns"><button type="button" className="btn" onClick={() => setPinFor(null)}>Cancelar</button><button type="submit" className="btn primary" disabled={busy || newPin.length < 4}>Guardar</button></div>
            </form>
          </div>
        </div>
      )}
      {toggle && <ConfirmDialog title={(toggle.active ? '¿Desactivar a ' : '¿Activar a ') + toggle.name + '?'} text={toggle.active ? 'No podrá entrar a Actividad ni a Freezer RTE hasta que se active de nuevo.' : 'Podrá entrar otra vez con su PIN.'} yes={toggle.active ? 'Desactivar' : 'Activar'} danger={toggle.active} onYes={() => { const t = toggle; setToggle(null); void call({ action: 'set_active', id: t.id, active: !t.active }) }} onNo={() => setToggle(null)} />}
    </section>
  )
}

async function errText(error: unknown): Promise<string> {
  // the function answers with a JSON body also on errors; supabase-js hands it over as a Response
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') { try { const b = await ctx.json(); if (b?.error) return String(b.error) } catch { /* no body */ } }
  return (error as Error).message ?? String(error)
}
