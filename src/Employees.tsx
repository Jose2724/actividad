import { useEffect, useState } from 'react'
import { missingColumn, rowRights, supabase } from './supabase'
import { cleanPowers, defaultPowers, POWERS, powersOf, rolesGiven, type Power, type Role } from './powers'
import { DEPTS } from './store'
import { ConfirmDialog, useWho } from './App'
import { tr } from './i18n'
import { trx } from './trx'

type Emp = { id: string; user_id?: string | null; name: string; username: string | null; role: string; active: boolean; act_role: 'op' | 'mgr' | 'office' | 'viewer' | null; act_dept: string | null; deleted?: boolean; act_powers?: string[] | null; act_shift?: number | null }
const ERRORS: Record<string, string> = {
  not_signed_in: tr('No hay sesión.'), not_manager: tr('No tienes permiso para hacer esto.'), bad_name: tr('Falta el nombre.'), bad_username: tr('Usuario: 3 a 30 letras, números, punto o guion, sin espacios.'),
  bad_pin: tr('PIN: de 6 a 12 números.'), bad_dept: tr('Un operador necesita departamento.'), username_taken: tr('Ese usuario ya existe.'), not_found: tr('No se encontró.'), owner_protected: tr('Esa cuenta no se puede tocar.'), not_self: tr('No puedes quitarte el acceso a ti mismo.'), owner_only: tr('Eso solo lo puede hacer el dueño.'), no_columns: tr('Falta aplicar el cambio de poderes en la base de datos.'), unknown_action: tr('Falta actualizar la función de usuarios en el servidor.'), view_only: tr('Un usuario de solo ver no tiene poderes: ve todo y no toca nada.'),
}

const ROLE: Record<string, string> = { op: tr('Operador'), mgr: tr('Manager'), office: tr('Oficina'), viewer: tr('Solo ver') }
/** for the search: no capitals and no accents ("José" is found typing "jose") */
const plain = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
/** the letters of the round badge: "Juan Pérez" gives "JP" */
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '?'
type RoleFilter = 'all' | 'op' | 'mgr' | 'office' | 'viewer' | 'none'

/**
 * The manager's people screen: who may use Actividad, with what role and department. Each person is one row; "Editar"
 * opens everything about them in one window: the name or the username typed wrong, a new PIN, the role and the
 * department, their powers and shift, and turning the account off. New accounts are made in a window too.
 * meId / admin = who is looking (their row in employees, and whether they are a Freezer RTE admin): a row only offers
 * what that person may really do to it (see rowRights; the server checks it again), and that depends on the powers
 * they hold too (only the ones they hold are handed out, Jose 2026-10-18).
 */
export function Employees({ meId, admin }: { meId: string; admin: boolean }) {
  const who = useWho()
  const me = { id: meId, admin, powers: powersOf({ ...who, admin }) }
  const [list, setList] = useState<Emp[] | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [roleF, setRoleF] = useState<RoleFilter>('all')
  const [deptF, setDeptF] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Emp | null>(null)
  // powers and shift per person: there once the database has their columns (null = not known yet)
  const [hasPowers, setHasPowers] = useState<boolean | null>(null)
  const [powersFor, setPowersFor] = useState<Emp | null>(null)
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
  /** one request to the server's people function; '' = done, else what went wrong in words */
  const call = async (body: Record<string, unknown>): Promise<string> => {
    setBusy(true)
    const { data, error } = await supabase!.functions.invoke('act-users', { body })
    setBusy(false)
    const err = error ? (await errText(error)) : (data as { error?: string })?.error
    return err ? ERRORS[err] ?? err : ''
  }
  const all = list ?? []
  const needle = plain(q.trim())
  const shown = all
    .filter((e) => !needle || plain(e.name).includes(needle) || plain(e.username ?? '').includes(needle))
    .filter((e) => roleF === 'all' || (roleF === 'none' ? !e.act_role : e.act_role === roleF))
    .filter((e) => !deptF || (e.act_role === 'op' && e.act_dept === deptF))
    // the people in use first, each group by name
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
  const count = (f: RoleFilter) => all.filter((e) => f === 'all' || (f === 'none' ? !e.act_role : e.act_role === f)).length
  const chips: [RoleFilter, string][] = [['all', tr('Todos')], ['op', tr('Operadores')], ['mgr', tr('Managers')], ['office', tr('Oficina')], ['viewer', tr('Solo ver')], ['none', tr('Sin acceso')]]
  const filtered = !!needle || roleF !== 'all' || !!deptF
  return (
    <section className="report emps">
      <div className="emphead">
        <div><h2>{tr('Empleados')}</h2><small>{list ? (filtered ? tr('Se ven {0} de {1}', shown.length, all.length) : all.length === 1 ? tr('1 persona') : tr('{0} personas', all.length)) : tr('Cargando…')}</small></div>
        <button type="button" className="btn primary" onClick={() => setCreating(true)}>{tr('+ Nuevo usuario')}</button>
      </div>
      <div className="emptools">
        <div className="empsearch">
          <input type="search" placeholder={tr('Buscar por nombre o usuario')} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" autoCapitalize="none" aria-label={tr('Buscar por nombre o usuario')} />
          {q && <button type="button" className="lnk" aria-label={tr('Borrar la búsqueda')} onClick={() => setQ('')}>✕</button>}
        </div>
        <div className="chips">{chips.map(([k, label]) => <button key={k} type="button" className={'chip sm' + (roleF === k ? ' on' : '')} aria-pressed={roleF === k} onClick={() => setRoleF(k)}>{label} <small>{count(k)}</small></button>)}</div>
        <label className="empdept"><span>{tr('Departamento')}</span><select value={deptF} onChange={(e) => setDeptF(e.target.value)}><option value="">{tr('Todos')}</option>{DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
      </div>
      {msg && <p className="err">{msg}</p>}
      <details className="how">
        <summary>{tr('¿Qué puede hacer cada rol?')}</summary>
        <p>{trx('Los mismos usuarios y PIN que Freezer RTE. {0} solo ve su departamento; {1} ve todo y corrige; {2} ve todo y lleva productos y programa; {3} ve todo, también Avance y el Reporte, y no puede tocar nada. Sin rol = no entra a Actividad.', <b>{tr('Operador')}</b>, <b>{tr('Manager')}</b>, <b>{tr('Oficina')}</b>, <b>{tr('Solo ver')}</b>)}</p>
        <p>{tr('Las cuentas de manager y de Oficina solo las crea y las cambia el dueño. A una cuenta de trabajador de Freezer RTE aquí se le dan su rol de Actividad, sus poderes y su turno: su PIN, su nombre y activarla los cambia el dueño. Cada quien da solo los poderes que tiene.')}</p>
      </details>
      {list !== null && shown.length === 0 && <p className="hint">{all.length ? tr('Nadie con esa búsqueda.') : tr('No hay usuarios todavía.')}</p>}
      <div className="emplist">
        {shown.map((e) => {
          const can = rowRights(e, me)
          const editable = !can.locked
          return (
            <div key={e.id} className={'emp' + (e.active ? '' : ' off')}>
              <span className={'avatar ' + (e.act_role ?? 'none')} aria-hidden="true">{initials(e.name)}</span>
              <div className="who">
                <b>{e.name}</b>
                <small><span className="mono">{e.username ?? '—'}</span>{e.role === 'admin' && ' · ' + tr('admin freezer')}{e.role === 'worker' && ' · ' + tr('trabajador freezer')}{can.mine && ' · ' + tr('tú')}{can.locked && ' · ' + tr('cuenta protegida')}</small>
              </div>
              <div className="tags">
                <span className={'badge ' + (e.act_role ?? 'none')}>{e.act_role ? ROLE[e.act_role] ?? e.act_role : tr('Sin acceso')}</span>
                {e.act_role === 'op' && e.act_dept && <span className="badge dept">{e.act_dept}</span>}
                {hasPowers && e.act_role && (e.act_shift === 1 || e.act_shift === 2) && <span className="badge plain">{tr('Turno {0}', e.act_shift)}</span>}
                {hasPowers && e.act_role && e.role !== 'admin' && e.act_powers != null && <span className="badge plain">{tr('{0} de {1} poderes', (cleanPowers(e.act_powers) ?? []).length, POWERS.length)}</span>}
                {!e.active && <span className="badge offb">{tr('Inactivo')}</span>}
              </div>
              {editable ? <button type="button" className="btn sm" disabled={busy} onClick={() => setEditing(e)}>{tr('✎ Editar')}</button> : <span className="nobtn">—</span>}
            </div>
          )
        })}
      </div>
      {hasPowers === false && <p className="hint">{tr('Los poderes y el turno de cada persona aparecen aquí cuando se aplique el cambio en la base de datos. Mientras tanto cada quien tiene los de su rol.')}</p>}
      {creating && <NewUserDialog roles={rolesGiven(admin)} busy={busy} call={call} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void load() }} />}
      {editing && <EditUserDialog emp={editing} can={rowRights(editing, me)} busy={busy} hasPowers={!!hasPowers} call={call} onPowers={() => { setPowersFor(editing); setEditing(null) }} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void load() }} />}
      {powersFor && <PowersDialog emp={powersFor} grant={rowRights(powersFor, me).grant} admin={admin} busy={busy} call={call} onClose={() => setPowersFor(null)} onDone={() => { setPowersFor(null); void load() }} />}
    </section>
  )
}

/**
 * a new account: name, username and PIN (the same ones Freezer RTE uses), role and department. roles = the ones this
 * person may give (rolesGiven: manager and office only the owner, Jose 2026-10-18)
 */
function NewUserDialog({ roles, busy, call, onClose, onDone }: { roles: Role[]; busy: boolean; call: (b: Record<string, unknown>) => Promise<string>; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: '', username: '', pin: '', act_role: 'op', act_dept: 'RTE' })
  const [err, setErr] = useState('')
  const ok = !!form.name.trim() && !!form.username.trim() && form.pin.length >= 6
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(ev) => ev.stopPropagation()}>
        <h3>{tr('Nuevo usuario')}</h3>
        <form className="qform" onSubmit={(ev) => { ev.preventDefault(); if (ok) void call({ action: 'create', ...form }).then((e) => (e ? setErr(e) : onDone())) }}>
          <div className="egrid">
            <label>{tr('Nombre')}{' '}<input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="off" /></label>
            <label>{tr('Usuario')}{' '}<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} autoCapitalize="none" autoComplete="off" placeholder={tr('ej. maria.rte')} /></label>
            <label>{tr('PIN (6–12 números)')}{' '}<input value={form.pin} inputMode="numeric" onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} autoComplete="off" /></label>
            <label>{tr('Rol')}{' '}<select value={form.act_role} onChange={(e) => setForm({ ...form, act_role: e.target.value })}>{roles.map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}</select></label>
            {form.act_role === 'op' && <label>{tr('Departamento')}{' '}<select value={form.act_dept} onChange={(e) => setForm({ ...form, act_dept: e.target.value })}>{DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>}
          </div>
          {err && <p className="err">{err}</p>}
          <div className="dbtns">
            <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
            <button type="submit" className="btn primary" disabled={busy || !ok}>{tr('Crear usuario')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * Everything about one person in one window. Only what changed is sent, each part to the action the server has for it
 * (the name and the username; the PIN; the role and the department), and the first refusal is said here, in words.
 * What the person looking may not do to this account is shown but cannot be changed (can = rowRights).
 */
function EditUserDialog({ emp, can, busy, hasPowers, call, onPowers, onClose, onDone }: { emp: Emp; can: ReturnType<typeof rowRights>; busy: boolean; hasPowers: boolean; call: (b: Record<string, unknown>) => Promise<string>; onPowers: () => void; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(emp.name)
  const [username, setUsername] = useState(emp.username ?? '')
  const [pin, setPin] = useState('')
  const [role, setRole] = useState<string>(emp.act_role ?? '')
  const [dept, setDept] = useState(emp.act_dept ?? 'RTE')
  const [err, setErr] = useState('')
  const [toggle, setToggle] = useState(false)
  const nameChanged = can.edit && name.trim().replace(/\s+/g, ' ') !== emp.name
  const userChanged = can.edit && !!emp.username && username.trim().toLowerCase() !== emp.username
  const roleChanged = can.role && (role !== (emp.act_role ?? '') || (role === 'op' && dept !== (emp.act_dept ?? '')))
  const pinTyped = can.pin && pin.length > 0
  const ok = !!name.trim() && (!emp.username || username.trim().length >= 3) && (!pinTyped || pin.length >= 6) && (nameChanged || userChanged || roleChanged || pinTyped)
  const powersOk = hasPowers && can.powers
  // the roles in the list: the ones this person may give, and the one the account has now (so it reads right)
  const roles = (['op', 'mgr', 'office', 'viewer'] as const).filter((r) => can.roles.includes(r) || r === emp.act_role)
  const save = async () => {
    setErr('')
    if (nameChanged || userChanged) { const e = await call({ action: 'edit', id: emp.id, ...(nameChanged ? { name } : {}), ...(userChanged ? { username } : {}) }); if (e) return setErr(e) }
    if (pinTyped) { const e = await call({ action: 'set_pin', id: emp.id, pin }); if (e) return setErr(e) }
    if (roleChanged) { const e = await call({ action: 'set_act', id: emp.id, act_role: role || null, act_dept: role === 'op' ? dept : emp.act_dept }); if (e) return setErr(e) }
    onDone()
  }
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg wide" onClick={(ev) => ev.stopPropagation()}>
        <h3>{trx('Editar a {0}', emp.name)}</h3>
        <form className="qform" onSubmit={(ev) => { ev.preventDefault(); if (ok) void save() }}>
          <div className="egrid">
            <label>{tr('Nombre')}{' '}<input value={name} disabled={!can.edit} onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>
            <label>{tr('Usuario')}{' '}<input value={username} disabled={!emp.username || !can.edit} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoCapitalize="none" autoComplete="off" /></label>
            {can.pin && <label>{trx('PIN nuevo {0}', <small>{tr('(vacío = no se cambia)')}</small>)} <input value={pin} inputMode="numeric" placeholder="••••••" onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoComplete="off" /></label>}
            <label>{tr('Rol')}{' '}<select value={role} disabled={!can.role} onChange={(e) => setRole(e.target.value)}><option value="">{tr('Sin acceso')}</option>{roles.map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}</select></label>
            {role === 'op' && <label>{tr('Departamento')}{' '}<select value={dept} disabled={!can.role} onChange={(e) => setDept(e.target.value)}>{DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>}
          </div>
          {!can.edit && <p className="hint">{tr('Es una cuenta de Freezer RTE: aquí se le dan o se le cambian el rol de Actividad, los poderes y el turno. Su PIN, su nombre y activarla los cambia el dueño.')}</p>}
          {userChanged && <p className="hint">{trx('Desde ahora entra con el usuario {0}, aquí y en Freezer RTE. Avísale.', <b>{username.trim().toLowerCase()}</b>)}</p>}
          {pinTyped && <p className="hint">{tr('Con el PIN nuevo entra la próxima vez; donde ya está dentro, sigue dentro.')}</p>}
          {err && <p className="err">{err}</p>}
          <div className="dbtns spread">
            <div className="btns">
              {powersOk && <button type="button" className="btn sm" disabled={busy} onClick={onPowers}>{tr('Poderes y turno…')}</button>}
              {can.active && <button type="button" className={'btn sm' + (emp.active ? ' stopbtn' : '')} disabled={busy} onClick={() => setToggle(true)}>{emp.active ? tr('Desactivar') : tr('Activar')}</button>}
            </div>
            <div className="btns">
              <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
              <button type="submit" className="btn primary" disabled={busy || !ok}>{busy ? tr('Guardando…') : tr('Guardar')}</button>
            </div>
          </div>
        </form>
        {toggle && <ConfirmDialog title={(emp.active ? tr('¿Desactivar a') + ' ' : tr('¿Activar a') + ' ') + emp.name + '?'} text={emp.active ? tr('No podrá entrar a Actividad ni a Freezer RTE hasta que se active de nuevo.') : tr('Podrá entrar otra vez con su PIN.')} yes={emp.active ? tr('Desactivar') : tr('Activar')} danger={emp.active}
          onYes={() => { setToggle(false); void call({ action: 'set_active', id: emp.id, active: !emp.active }).then((e) => (e ? setErr(e) : onDone())) }} onNo={() => setToggle(false)} />}
      </div>
    </div>
  )
}

/**
 * what a person may do besides working their line, and their shift. grant = the powers the person looking holds: only
 * those can be ticked (nobody but the owner hands out a power they do not have, Jose 2026-10-18); one the person
 * already has stays in the list, so it can be taken away or left as it is (the server takes both)
 */
function PowersDialog({ emp, grant, admin, busy, call, onClose, onDone }: { emp: Emp; grant: readonly string[]; admin: boolean; busy: boolean; call: (b: Record<string, unknown>) => Promise<string>; onClose: () => void; onDone: () => void }) {
  const [had] = useState<Power[]>(() => cleanPowers(emp.act_powers) ?? defaultPowers(emp.act_role))
  const [picked, setPicked] = useState<Power[]>(had)
  const offered = POWERS.filter((x) => grant.includes(x.key) || had.includes(x.key))
  const [shift, setShift] = useState(emp.act_shift === 1 || emp.act_shift === 2 ? emp.act_shift : 0)
  const [err, setErr] = useState('')
  const send = (powers: Power[] | null) => void call({ action: 'set_powers', id: emp.id, powers, shift: shift || null }).then((e) => (e ? setErr(e) : onDone()))
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(ev) => ev.stopPropagation()}>
        <h3>{trx('Poderes de {0}', emp.name)}</h3>
        <p>{ROLE[emp.act_role ?? ''] ?? tr('Sin rol')}{emp.act_role === 'op' && emp.act_dept ? ' ' + tr('de {0}', emp.act_dept) : ''}{tr('. Marca lo que puede hacer además de trabajar su línea. Lo que no esté marcado no le sale en la pantalla.')}</p>
        <div className="powers">{offered.map((x) => <label key={x.key}><input type="checkbox" checked={picked.includes(x.key)} onChange={(ev) => setPicked(ev.target.checked ? [...picked, x.key] : picked.filter((k) => k !== x.key))} /> {x.label}</label>)}</div>
        {!admin && <p className="hint">{tr('Solo puedes dar los poderes que tú tienes.')}</p>}
        <label>{tr('Turno')}{' '}<select value={shift} onChange={(ev) => setShift(Number(ev.target.value))}><option value={0}>{tr('Los dos turnos')}</option><option value={1}>{tr('Turno 1')}</option><option value={2}>{tr('Turno 2')}</option></select></label>
        <p className="hint">{tr('Con un turno, el Reporte le abre en ese turno y solo corrige lo de su turno, salvo que tenga "Corregir lo del otro turno". Tiene que cerrar y abrir la app para que tome los cambios.')}</p>
        {err && <p className="err">{err}</p>}
        <div className="dbtns spread">
          <div className="btns"><button type="button" className="lnk" disabled={busy} onClick={() => send(null)}>{tr('Volver a los de su rol')}</button></div>
          <div className="btns">
            <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => send(picked)}>{tr('Guardar')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

async function errText(error: unknown): Promise<string> {
  // the function answers with a JSON body also on errors; supabase-js hands it over as a Response
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') { try { const b = await ctx.json(); if (b?.error) return String(b.error) } catch { /* no body */ } }
  return (error as Error).message ?? String(error)
}
