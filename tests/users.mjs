// The act-users function (supabase/functions/act-users/index.ts, the one Jose pastes in Supabase > Edge Functions) run
// for real on this machine, with no build: Node strips its types, Deno.serve hands over the handler, and the service
// client it makes is a stand-in whose employees table is the server's database (pg.mjs: the shared project's schema
// and every Actividad migration) and whose accounts (e-mail, PIN, turned off) live in memory. It checks who may create,
// rename, re-PIN, re-role and turn off whom (the 2026-10-18 audit: E1 to E4, and Jose's decision of that day: manager
// and office accounts are his alone), that everything the Empleados screen does today still goes through, and that the
// screen (rowRights, from the app's own bundle that npm run check builds first) offers exactly what the function takes.
// Made-up people only. Run by: npm run check
// `node tests/users.mjs <file>` runs another copy of the function instead (an older one, to see what it let through).
import { registerHooks } from 'node:module'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { as, serverDb } from './pg.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const FN = process.argv[2] ? resolve(process.argv[2]) : resolve(here, '../supabase/functions/act-users/index.ts')
const DOMAIN = 'freezer.example.com'

let passed = 0
const failed = []
let where = ''
const section = (t) => { where = t; console.log('· ' + t) }
const eq = (what, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) passed++; else failed.push(`[${where}] ${what}\n      salió    ${a}\n      esperado ${b}`) }

// ---- the stand-in Supabase: the function imports 'npm:@supabase/supabase-js@2'; here that name gives it this client ----
const { db, applied } = await serverDb()
// without the Freezer repository beside this one, the stand-in employees table knows no 'requester' (Freezer's 009 adds it)
if (applied[0] !== 'freezer-control') await db.exec("alter table public.employees drop constraint if exists employees_role_check; alter table public.employees add constraint employees_role_check check (role in ('admin','worker','requester'))")
const accounts = new Map(), tokens = new Map()
const q = async (text, params) => { try { return { rows: (await db.query(text, params)).rows, error: null } } catch (e) { return { rows: null, error: { code: e.code, message: e.message } } } }
/** the few PostgREST calls the function makes (select / insert / update with eq / neq, maybeSingle), on the real table */
class Query {
  constructor(table) { this.table = table; this.w = []; this.op = 'select'; this.cols = '*' }
  select(c) { this.cols = c; return this }
  eq(c, v) { this.w.push([c, '=', v]); return this }
  neq(c, v) { this.w.push([c, '<>', v]); return this }
  insert(row) { this.op = 'insert'; this.row = row; return this }
  update(p) { this.op = 'update'; this.patch = p; return this }
  where(params) { return this.w.length ? ' where ' + this.w.map(([c, o, v]) => { params.push(v); return `${c}::text ${o} $${params.length}::text` }).join(' and ') : '' }
  async run() {
    const p = []
    if (this.op === 'insert') { const cols = Object.keys(this.row); const r = await q(`insert into public.${this.table} (${cols.join(', ')}) values (${cols.map((_, i) => '$' + (i + 1)).join(', ')})`, cols.map((c) => this.row[c])); return { data: null, error: r.error } }
    if (this.op === 'update') { const cols = Object.keys(this.patch); cols.forEach((c) => p.push(this.patch[c])); const r = await q(`update public.${this.table} set ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}${this.where(p)}`, p); return { data: null, error: r.error } }
    const r = await q(`select ${this.cols} from public.${this.table}${this.where(p)}`, p)
    return { data: r.rows, error: r.error }
  }
  async maybeSingle() { const r = await this.run(); if (r.error) return { data: null, error: r.error }; if (r.data.length > 1) return { data: null, error: { message: 'multiple rows' } }; return { data: r.data[0] ?? null, error: null } }
  then(ok, ko) { return this.run().then(ok, ko) }
}
const auth = {
  async getUser(token) { const a = accounts.get(tokens.get(token)); return a && !a.banned ? { data: { user: a }, error: null } : { data: { user: null }, error: { status: 401 } } },
  admin: {
    async getUserById(id) { const a = accounts.get(id); return a ? { data: { user: a }, error: null } : { data: { user: null }, error: { status: 404 } } },
    async createUser({ email, password, user_metadata }) {
      if ([...accounts.values()].some((a) => a.email === email)) return { data: { user: null }, error: { message: 'already registered' } }
      const id = randomUUID()
      await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email])
      const a = { id, email, password, user_metadata, banned: false }
      accounts.set(id, a)
      return { data: { user: a }, error: null }
    },
    async updateUserById(id, u) {
      const a = accounts.get(id)
      if (!a) return { data: { user: null }, error: { message: 'not found' } }
      if (u.password) a.password = u.password
      if (u.email) a.email = u.email
      if (u.user_metadata) a.user_metadata = u.user_metadata
      if (u.ban_duration) a.banned = u.ban_duration !== 'none'
      return { data: { user: a }, error: null }
    },
    async deleteUser(id) { accounts.delete(id); return { error: null } },
  },
}
globalThis.__actUsersService = { from: (t) => new Query(t), auth }
const STAND_IN = 'data:text/javascript,' + encodeURIComponent('export const createClient = () => globalThis.__actUsersService')
registerHooks({ resolve: (spec, ctx, next) => (spec.startsWith('npm:@supabase/supabase-js') ? { url: STAND_IN, shortCircuit: true } : next(spec, ctx)) })
let handler = null
globalThis.Deno = { serve: (h) => { handler = h }, env: { get: () => 'stand-in' } }
await import(pathToFileURL(FN).href)
if (!handler) throw new Error('the function did not call Deno.serve: ' + FN)

// ---- people, sign-in and calls, as the app does them ----
/** a sign-in: username@DOMAIN (or a real e-mail) + PIN. A token, or null when that PIN does not open the account */
const signIn = (login, pin) => {
  const email = login.includes('@') ? login : login + '@' + DOMAIN
  const a = [...accounts.values()].find((x) => x.email === email)
  if (!a || a.banned || a.password !== pin) return null
  const t = randomUUID()
  tokens.set(t, a.id)
  return t
}
const opens = (login, pin) => signIn(login, pin) !== null
/**
 * A person: the account and their employee row, as Freezer RTE or this function leaves them, already signed in on
 * their tablet. They keep that session (a new PIN counts from the next sign-in, as on the floor), so a change that
 * should have been refused shows where it happened and does not sign anybody out further down
 */
const mk = async ({ name, username = null, email = null, pin, role = 'requester', actRole = null, actDept = null, powers = null, shift = null }) => {
  const id = randomUUID(), mail = email ?? username + '@' + DOMAIN
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, mail])
  accounts.set(id, { id, email: mail, password: pin, user_metadata: { name, username }, banned: false })
  const r = await db.query('insert into public.employees (name, username, role, user_id, active, act_role, act_dept, act_powers, act_shift) values ($1, $2, $3, $4, true, $5, $6, $7, $8) returning id', [name, email ? null : username, role, id, actRole, actDept, powers, shift])
  return { emp: r.rows[0].id, token: signIn(mail, pin), claims: { sub: id, role: 'authenticated', aud: 'authenticated' } }
}
/** what the function answers that person: 'ok', or the HTTP status and the error the screen turns into words */
const call = async (who, body) => {
  const token = who.token
  const res = await handler(new Request('http://localhost/functions/v1/act-users', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  const j = await res.json()
  return j.ok ? 'ok' : `${res.status} ${j.error}`
}
const row = async (emp) => (await db.query('select name, username, role, active, act_role, act_dept, act_powers, act_shift from public.employees where id = $1', [emp])).rows[0]
const idOf = async (username) => (await db.query('select id from public.employees where username = $1', [username])).rows[0]?.id ?? null
const ALL = ['fix', 'del', 'goals', 'shifts', 'orders', 'day', 'depts', 'products', 'people', 'othershift']

const jose = await mk({ name: 'Jose', email: 'dueno@correo.prueba', pin: '999999', role: 'admin', actRole: 'mgr' }) // the owner: a real e-mail
const fadmin = await mk({ name: 'Admin Freezer', username: 'admin.fz', pin: '222222', role: 'admin' }) // a Freezer RTE admin with a user name
const fadmin2 = await mk({ name: 'Otra Admin Freezer', username: 'admin2.fz', pin: '232323', role: 'admin' })
const fworker = await mk({ name: 'Trabajador Freezer', username: 'trab.fz', pin: '333333', role: 'worker' })
const fworker2 = await mk({ name: 'Otro Trabajador', username: 'trab2.fz', pin: '343434', role: 'worker' })
const mgr = await mk({ name: 'Mario', username: 'mario.mgr', pin: '444444', actRole: 'mgr' })
const mgr2 = await mk({ name: 'Marta', username: 'marta.mgr', pin: '555555', actRole: 'mgr' })
const ofi = await mk({ name: 'Olga', username: 'olga.ofi', pin: '666666', actRole: 'office' })
const ofi2 = await mk({ name: 'Oscar', username: 'oscar.ofi', pin: '676767', actRole: 'office' })
const pedro = await mk({ name: 'Pedro', username: 'pedro.rte', pin: '777777', actRole: 'op', actDept: 'RTE', powers: ['people', 'fix'] }) // an operator given "Manejar empleados"
const ana = await mk({ name: 'Ana', username: 'ana.pack', pin: '888888', actRole: 'op', actDept: 'Packing' })
const vero = await mk({ name: 'Vero', username: 'vero.ver', pin: '121212', actRole: 'viewer' })
const lead = await mk({ name: 'Lucas', username: 'lucas.mfo', pin: '131313', actRole: 'op', actDept: 'MFO', powers: ['del'] }) // an operator Jose gave "borrar"

section('Lo que la pantalla de Empleados hace hoy sigue funcionando')
eq('un manager crea un operador y un "Solo ver"; el dueño, un manager y una Oficina', [
  await call(mgr, { action: 'create', name: 'Nora', username: 'nora.k', pin: '141414', act_role: 'op', act_dept: 'Kitchen' }),
  await call(mgr, { action: 'create', name: 'Vale', username: 'vale.ver', pin: '151515', act_role: 'viewer' }),
  await call(jose, { action: 'create', name: 'Memo', username: 'memo.mgr', pin: '161616', act_role: 'mgr' }),
  await call(jose, { action: 'create', name: 'Ofelia', username: 'ofelia.ofi', pin: '171717', act_role: 'office' }),
], ['ok', 'ok', 'ok', 'ok'])
eq('y cada cuenta nueva entra con su usuario y PIN', [opens('nora.k', '141414'), opens('vale.ver', '151515'), opens('memo.mgr', '161616'), opens('ofelia.ofi', '171717')], [true, true, true, true])
eq('cada una con el rol pedido y "requester" en Freezer RTE', [(await row(await idOf('nora.k'))).act_role, (await row(await idOf('ofelia.ofi'))).act_role, (await row(await idOf('memo.mgr'))).role, (await row(await idOf('vale.ver'))).role], ['op', 'office', 'requester', 'requester'])
eq('un manager cambia el PIN de un operador, y el operador entra con el nuevo', [await call(mgr, { action: 'set_pin', id: ana.emp, pin: '181818' }), opens('ana.pack', '181818'), opens('ana.pack', '888888')], ['ok', true, false])
eq('le corrige el nombre y el usuario', [await call(mgr, { action: 'edit', id: ana.emp, name: 'Ana María', username: 'anam.pack' }), (await row(ana.emp)).name, opens('anam.pack', '181818')], ['ok', 'Ana María', true])
eq('le cambia el departamento, le da poderes y turno', [await call(mgr, { action: 'set_act', id: ana.emp, act_role: 'op', act_dept: 'MFO' }), await call(mgr, { action: 'set_powers', id: ana.emp, powers: ['fix'], shift: 1 })], ['ok', 'ok'])
eq('y la desactiva y la activa', [await call(mgr, { action: 'set_active', id: ana.emp, active: false }), opens('anam.pack', '181818'), await call(mgr, { action: 'set_active', id: ana.emp, active: true }), opens('anam.pack', '181818')], ['ok', false, 'ok', true])
eq('un manager cambia su propio PIN y su nombre', [await call(mgr, { action: 'set_pin', id: mgr.emp, pin: '191919' }), await call(mgr, { action: 'edit', id: mgr.emp, name: 'Mario B' })], ['ok', 'ok'])
eq('un manager le da Actividad a un trabajador de Freezer RTE', [await call(mgr, { action: 'set_act', id: fworker.emp, act_role: 'op', act_dept: 'RTE' }), (await row(fworker.emp)).act_role], ['ok', 'op'])
// (the lead told Jose on 2026-10-18: a crew account's Actividad role, yes; its Freezer sign-in, no. See D1 below)
eq('y se lo cambia: otro cuarto, "Solo ver", y de vuelta a operador', [
  await call(mgr, { action: 'set_act', id: fworker.emp, act_role: 'op', act_dept: 'Packing' }),
  await call(mgr, { action: 'set_act', id: fworker.emp, act_role: 'viewer' }),
  await call(mgr, { action: 'set_act', id: fworker.emp, act_role: 'op', act_dept: 'RTE' }),
  (await row(fworker.emp)).act_dept,
], ['ok', 'ok', 'ok', 'RTE'])
eq('la Oficina crea un operador y un "Solo ver", y le da Actividad a un trabajador de Freezer RTE', [
  await call(ofi, { action: 'create', name: 'Omar', username: 'omar.mfo', pin: '212121', act_role: 'op', act_dept: 'MFO' }),
  await call(ofi, { action: 'create', name: 'Olivia', username: 'olivia.ver', pin: '212122', act_role: 'viewer' }),
  await call(ofi, { action: 'set_act', id: fworker2.emp, act_role: 'viewer' }),
  await call(ofi, { action: 'set_act', id: fworker2.emp, act_role: null }),
], ['ok', 'ok', 'ok', 'ok'])
const omar = { emp: await idOf('omar.mfo') }
eq('y a su operador le cambia el PIN, el nombre, el rol, le da poderes (también el del otro turno, que la Oficina tiene) y lo desactiva', [
  await call(ofi, { action: 'set_pin', id: omar.emp, pin: '212123' }),
  await call(ofi, { action: 'edit', id: omar.emp, name: 'Omar B', username: 'omarb.mfo' }),
  await call(ofi, { action: 'set_act', id: omar.emp, act_role: 'op', act_dept: 'Spiral' }),
  await call(ofi, { action: 'set_powers', id: omar.emp, powers: ['fix', 'othershift'], shift: 1 }),
  await call(ofi, { action: 'set_active', id: omar.emp, active: false }),
  await call(ofi, { action: 'set_active', id: omar.emp, active: true }),
  opens('omarb.mfo', '212123'),
], ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', true])
eq('la Oficina cambia su propio PIN y su nombre', [await call(ofi, { action: 'set_pin', id: ofi.emp, pin: '666667' }), await call(ofi, { action: 'edit', id: ofi.emp, name: 'Olga B' }), opens('olga.ofi', '666667')], ['ok', 'ok', true])
eq('el dueño lo hace todo con un manager', [
  await call(jose, { action: 'set_pin', id: mgr2.emp, pin: '242424' }),
  await call(jose, { action: 'edit', id: mgr2.emp, name: 'Marta B', username: 'martab.mgr' }),
  await call(jose, { action: 'set_act', id: mgr2.emp, act_role: 'mgr' }),
  await call(jose, { action: 'set_powers', id: mgr2.emp, powers: ['people', 'fix'] }),
  await call(jose, { action: 'set_powers', id: mgr2.emp, powers: null }),
  await call(jose, { action: 'set_active', id: mgr2.emp, active: false }),
  await call(jose, { action: 'set_active', id: mgr2.emp, active: true }),
  opens('martab.mgr', '242424'),
], ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', true])
eq('y con la Oficina, y sube a un operador a manager y a Oficina, y de vuelta', [
  await call(jose, { action: 'set_pin', id: ofi2.emp, pin: '686868' }),
  await call(jose, { action: 'set_powers', id: ofi2.emp, powers: ['depts'] }),
  await call(jose, { action: 'set_powers', id: ofi2.emp, powers: null }),
  await call(jose, { action: 'set_act', id: ana.emp, act_role: 'mgr' }),
  await call(jose, { action: 'set_act', id: ana.emp, act_role: 'office' }),
  await call(jose, { action: 'set_act', id: ana.emp, act_role: 'op', act_dept: 'MFO' }),
  (await row(ana.emp)).act_role,
], ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'op'])
eq('y con un trabajador de Freezer RTE: su PIN, su nombre, sus poderes, desactivarlo', [
  await call(jose, { action: 'set_pin', id: fworker.emp, pin: '343536' }),
  await call(jose, { action: 'edit', id: fworker.emp, name: 'Trabajador B' }),
  await call(jose, { action: 'set_powers', id: fworker.emp, powers: ['fix'] }),
  await call(jose, { action: 'set_active', id: fworker.emp, active: false }),
  await call(jose, { action: 'set_active', id: fworker.emp, active: true }),
  opens('trab.fz', '343536'),
], ['ok', 'ok', 'ok', 'ok', 'ok', true])
await db.query('update public.employees set act_powers = null where id = $1', [fworker.emp])
eq('y con un admin de Freezer RTE', [
  await call(jose, { action: 'set_pin', id: fadmin.emp, pin: '252525' }),
  await call(jose, { action: 'edit', id: fadmin.emp, name: 'Admin Freezer B' }),
  await call(jose, { action: 'set_act', id: fadmin.emp, act_role: 'office' }),
  await call(jose, { action: 'set_active', id: fadmin.emp, active: false }),
  await call(jose, { action: 'set_active', id: fadmin.emp, active: true }),
], ['ok', 'ok', 'ok', 'ok', 'ok'])
eq('el dueño crea con un rol de Freezer RTE', [await call(jose, { action: 'create', name: 'Fer', username: 'fer.fz', pin: '262626', act_role: 'op', act_dept: 'RTE', role: 'worker' }), (await row(await idOf('fer.fz'))).role], ['ok', 'worker'])
eq('el dueño cambia su propio rol, y lo regresa', [await call(jose, { action: 'set_act', id: jose.emp, act_role: 'office' }), await call(jose, { action: 'set_act', id: jose.emp, act_role: 'mgr' }), (await row(jose.emp)).act_role], ['ok', 'ok', 'mgr'])
eq('un operador con "Manejar empleados" crea un operador y un "Solo ver"', [
  await call(pedro, { action: 'create', name: 'Nico', username: 'nico.rte', pin: '272727', act_role: 'op', act_dept: 'RTE' }),
  await call(pedro, { action: 'create', name: 'Vivi', username: 'vivi.ver', pin: '282828', act_role: 'viewer' }),
], ['ok', 'ok'])
const nico = { emp: await idOf('nico.rte') }
eq('y a ese operador le cambia el PIN, el nombre, el cuarto, el rol a "Solo ver" y de vuelta', [
  await call(pedro, { action: 'set_pin', id: nico.emp, pin: '292929' }),
  await call(pedro, { action: 'edit', id: nico.emp, name: 'Nico B' }),
  await call(pedro, { action: 'set_act', id: nico.emp, act_role: 'op', act_dept: 'MFO' }),
  await call(pedro, { action: 'set_act', id: nico.emp, act_role: 'viewer' }),
  await call(pedro, { action: 'set_act', id: nico.emp, act_role: 'op', act_dept: 'RTE' }),
], ['ok', 'ok', 'ok', 'ok', 'ok'])
eq('le da un poder que él tiene, y lo regresa a los de su rol', [await call(pedro, { action: 'set_powers', id: nico.emp, powers: ['fix'], shift: 2 }), (await row(nico.emp)).act_powers, await call(pedro, { action: 'set_powers', id: nico.emp, powers: null })], ['ok', ['fix'], 'ok'])
eq('lo desactiva y lo activa, y le quita el acceso a Actividad', [await call(pedro, { action: 'set_active', id: nico.emp, active: false }), await call(pedro, { action: 'set_active', id: nico.emp, active: true }), await call(pedro, { action: 'set_act', id: nico.emp, act_role: null })], ['ok', 'ok', 'ok'])
eq('cambia su propio PIN y su nombre', [await call(pedro, { action: 'set_pin', id: pedro.emp, pin: '303030' }), await call(pedro, { action: 'edit', id: pedro.emp, name: 'Pedro B' })], ['ok', 'ok'])
eq('en los poderes de alguien que ya tenía uno que él no tiene, cambia el turno y lo deja, o se lo quita', [
  await call(pedro, { action: 'set_powers', id: lead.emp, powers: ['del'], shift: 2 }),
  (await row(lead.emp)).act_powers,
  await call(pedro, { action: 'set_powers', id: lead.emp, powers: [], shift: 2 }),
  (await row(lead.emp)).act_powers,
], ['ok', ['del'], 'ok', []])
await db.query("update public.employees set act_powers = '{del}', act_shift = null where id = $1", [lead.emp])

section('E1 · La cuenta de un admin de Freezer RTE solo la toca el dueño (u otro admin)')
eq('un manager no le cambia el PIN, y con ese PIN nadie entra', [await call(mgr, { action: 'set_pin', id: fadmin.emp, pin: '313131' }), opens('admin.fz', '313131'), opens('admin.fz', '252525')], ['403 owner_protected', false, true])
const before = await row(fadmin.emp)
eq('ni el nombre, ni el usuario, ni el rol de Actividad, ni lo desactiva', [
  await call(mgr, { action: 'edit', id: fadmin.emp, name: 'Otro' }),
  await call(mgr, { action: 'edit', id: fadmin.emp, username: 'admin.x' }),
  await call(mgr, { action: 'set_act', id: fadmin.emp, act_role: 'viewer' }),
  await call(mgr, { action: 'set_act', id: fadmin.emp, act_role: null }),
  await call(mgr, { action: 'set_active', id: fadmin.emp, active: false }),
], ['403 owner_protected', '403 owner_protected', '403 owner_protected', '403 owner_protected', '403 owner_protected'])
eq('y su cuenta queda como estaba, y sigue entrando', [await row(fadmin.emp), opens('admin.fz', '252525')], [before, true])
eq('sus poderes, como ya era, solo los cambia el dueño', await call(mgr, { action: 'set_powers', id: fadmin.emp, powers: [] }), '403 owner_only')
eq('la Oficina y un operador con "Manejar empleados" tampoco', [await call(ofi, { action: 'set_pin', id: fadmin.emp, pin: '323232' }), await call(ofi, { action: 'set_active', id: fadmin.emp, active: false }), await call(pedro, { action: 'set_pin', id: fadmin.emp, pin: '323232' })], ['403 owner_protected', '403 owner_protected', '403 owner_protected'])
eq('la cuenta del dueño (correo de verdad) sigue protegida', [await call(mgr, { action: 'set_pin', id: jose.emp, pin: '333444' }), await call(fadmin, { action: 'set_pin', id: jose.emp, pin: '333444' })], ['403 owner_protected', '403 owner_protected'])
eq('otro admin de Freezer RTE sí puede (ya es admin allá)', [await call(fadmin2, { action: 'set_pin', id: fadmin.emp, pin: '343535' }), opens('admin.fz', '343535')], ['ok', true])

// (until 2026-10-18 the refusals below said not_manager; since Jose's decision managers are refused the same, so they
// say whose these accounts are: owner_only for creating or giving a manager or the office, owner_protected for their accounts)
section('E2 · Un operador con "Manejar empleados" maneja operadores y "Solo ver", y da solo lo que tiene')
eq('no crea una Oficina ni un manager, y esas cuentas no existen', [
  await call(pedro, { action: 'create', name: 'Falsa Oficina', username: 'falsa.ofi', pin: '353535', act_role: 'office' }),
  await call(pedro, { action: 'create', name: 'Falso Manager', username: 'falso.mgr', pin: '363636', act_role: 'mgr' }),
  await idOf('falsa.ofi'), await idOf('falso.mgr'), opens('falsa.ofi', '353535'),
], ['403 owner_only', '403 owner_only', null, null, false])
eq('no le cambia el PIN a un manager ni a la Oficina, y siguen entrando con el suyo', [
  await call(pedro, { action: 'set_pin', id: mgr.emp, pin: '373737' }),
  await call(pedro, { action: 'set_pin', id: ofi.emp, pin: '373737' }),
  opens('mario.mgr', '191919'), opens('olga.ofi', '666667'), opens('mario.mgr', '373737'),
], ['403 owner_protected', '403 owner_protected', true, true, false])
const mgrBefore = await row(mgr.emp)
eq('ni su nombre, ni su rol, ni lo desactiva, ni toca los poderes de la Oficina', [
  await call(pedro, { action: 'edit', id: mgr.emp, name: 'Otro' }),
  await call(pedro, { action: 'set_act', id: mgr.emp, act_role: 'op', act_dept: 'RTE' }),
  await call(pedro, { action: 'set_active', id: mgr.emp, active: false }),
  await call(pedro, { action: 'set_powers', id: ofi.emp, powers: ['people'] }),
], ['403 owner_protected', '403 owner_protected', '403 owner_protected', '403 owner_only'])
eq('el manager queda como estaba', await row(mgr.emp), mgrBefore)
eq('no sube a un operador a manager ni a Oficina', [await call(pedro, { action: 'set_act', id: ana.emp, act_role: 'mgr' }), await call(pedro, { action: 'set_act', id: ana.emp, act_role: 'office' }), (await row(ana.emp)).act_role], ['403 owner_only', '403 owner_only', 'op'])
// until 2026-10-18 an operator could not give Actividad to somebody without a role; since the lead's word to Jose that
// day anybody who manages people may (operator or "Solo ver" only), but never touch that account's Freezer sign-in
eq('le da Actividad a alguien que no tiene rol (un trabajador de Freezer RTE), pero no le cambia el PIN', [
  await call(pedro, { action: 'set_act', id: fworker2.emp, act_role: 'op', act_dept: 'RTE' }), (await row(fworker2.emp)).act_role,
  await call(pedro, { action: 'set_pin', id: fworker2.emp, pin: '373838' }), opens('trab2.fz', '343434'),
], ['ok', 'op', '403 owner_protected', true])
const anaPowers = (await row(ana.emp)).act_powers
eq('no da poderes que él no tiene: ni todos, ni uno de más', [
  await call(pedro, { action: 'set_powers', id: ana.emp, powers: ALL }),
  await call(pedro, { action: 'set_powers', id: ana.emp, powers: ['people', 'fix', 'del'] }),
  (await row(ana.emp)).act_powers,
], ['403 not_manager', '403 not_manager', anaPowers])
eq('no le cambia el PIN a un operador que tiene un poder que él no tiene (entraría con ese poder)', [await call(pedro, { action: 'set_pin', id: lead.emp, pin: '383838' }), opens('lucas.mfo', '131313'), opens('lucas.mfo', '383838')], ['403 not_manager', true, false])
eq('un manager sigue pudiendo todo eso con un operador', [await call(mgr, { action: 'set_pin', id: lead.emp, pin: '393939' }), await call(mgr, { action: 'set_powers', id: ana.emp, powers: ['fix', 'del'] })], ['ok', 'ok'])

section('E3 · El rol propio solo lo cambia el dueño')
eq('un operador con "Manejar empleados" no se hace manager', [await call(pedro, { action: 'set_act', id: pedro.emp, act_role: 'mgr' }), (await row(pedro.emp)).act_role], ['400 not_self', 'op'])
eq('y el servidor no lo trata como manager', await as(db, pedro, async (tx) => (await tx.query('select public.act_is_mgr() as m')).rows[0].m), false)
eq('la Oficina no se hace manager; un manager no se cambia a operador, ni de departamento', [
  await call(ofi, { action: 'set_act', id: ofi.emp, act_role: 'mgr' }),
  await call(mgr, { action: 'set_act', id: mgr.emp, act_role: 'op', act_dept: 'RTE' }),
  await call(mgr, { action: 'set_act', id: mgr.emp, act_role: 'mgr', act_dept: 'RTE' }),
], ['400 not_self', '400 not_self', '400 not_self'])
eq('sus filas quedan como estaban', [(await row(ofi.emp)).act_role, (await row(mgr.emp)).act_role, (await row(mgr.emp)).act_dept], ['office', 'mgr', null])

section('E4 · Sin acceso a Actividad o "Solo ver": ningún poder, aunque su fila guarde alguno')
const gone = await mk({ name: 'Sin Acceso', username: 'sin.acceso', pin: '404040', powers: ['people'] }) // a row left like this before 2026-10-18
const veroP = await mk({ name: 'Ver Con Poder', username: 'ver.poder', pin: '414141', actRole: 'viewer', powers: ['people'] }) // only by editing the table
eq('quien no tiene rol de Actividad no maneja empleados', [await call(gone, { action: 'create', name: 'Fantasma', username: 'fantasma', pin: '424242', act_role: 'office' }), await call(gone, { action: 'set_pin', id: ana.emp, pin: '424242' }), await idOf('fantasma')], ['403 not_manager', '403 not_manager', null])
eq('un "Solo ver" tampoco, ni con "people" guardado', [await call(veroP, { action: 'create', name: 'V3', username: 'vtres', pin: '434343', act_role: 'op', act_dept: 'RTE' }), await call(vero, { action: 'create', name: 'V4', username: 'vcuatro', pin: '444445', act_role: 'op', act_dept: 'RTE' })], ['403 not_manager', '403 not_manager'])
eq('un admin de Freezer RTE sin rol de Actividad sí', await call(fadmin2, { action: 'create', name: 'Desde Freezer', username: 'desde.fz', pin: '454545', act_role: 'op', act_dept: 'Spiral' }), 'ok')
const keeper = await mk({ name: 'Supervisor', username: 'super.mfo', pin: '464646', actRole: 'op', actDept: 'MFO', powers: ['people', 'fix'], shift: 1 })
eq('quitarle el acceso a Actividad le quita sus poderes y su turno', [await call(jose, { action: 'set_act', id: keeper.emp, act_role: null }), (await row(keeper.emp)).act_powers, (await row(keeper.emp)).act_shift], ['ok', null, null])
eq('y ya no maneja empleados', await call(keeper, { action: 'create', name: 'X', username: 'xequis', pin: '474747', act_role: 'op', act_dept: 'RTE' }), '403 not_manager')
const keeper2 = await mk({ name: 'Supervisora', username: 'super2.mfo', pin: '484848', actRole: 'op', actDept: 'MFO', powers: ['fix'], shift: 2 })
eq('pasarlo a "Solo ver" también (como ya era)', [await call(mgr, { action: 'set_act', id: keeper2.emp, act_role: 'viewer' }), (await row(keeper2.emp)).act_powers, (await row(keeper2.emp)).act_shift], ['ok', null, null])
const keeper3 = await mk({ name: 'Supervisor 3', username: 'super3.mfo', pin: '494949', actRole: 'op', actDept: 'MFO', powers: ['fix'], shift: 2 })
eq('cambiarle solo el cuarto le deja sus poderes y su turno', [await call(mgr, { action: 'set_act', id: keeper3.emp, act_role: 'op', act_dept: 'RTE' }), (await row(keeper3.emp)).act_powers, (await row(keeper3.emp)).act_shift], ['ok', ['fix'], 2])

section('D1 · Las cuentas de manager y de Oficina solo las maneja el dueño (Jose, 2026-10-18)')
eq('un manager no crea un manager ni una Oficina, y esas cuentas no existen', [
  await call(mgr, { action: 'create', name: 'Otro Manager', username: 'otro.mgr', pin: '505050', act_role: 'mgr' }),
  await call(mgr, { action: 'create', name: 'Otra Oficina', username: 'otra.ofi', pin: '515151', act_role: 'office' }),
  await idOf('otro.mgr'), await idOf('otra.ofi'), opens('otro.mgr', '505050'),
], ['403 owner_only', '403 owner_only', null, null, false])
eq('la Oficina tampoco', [
  await call(ofi, { action: 'create', name: 'Mili', username: 'mili.mgr', pin: '222121', act_role: 'mgr' }),
  await call(ofi, { action: 'create', name: 'Ofi Tres', username: 'ofi3.ofi', pin: '525252', act_role: 'office' }),
  await idOf('mili.mgr'), await idOf('ofi3.ofi'),
], ['403 owner_only', '403 owner_only', null, null])
const m2Before = await row(mgr2.emp)
eq('un manager no le cambia a otro manager el PIN, el nombre, el usuario, el rol, los poderes, ni lo desactiva', [
  await call(mgr, { action: 'set_pin', id: mgr2.emp, pin: '535353' }),
  await call(mgr, { action: 'edit', id: mgr2.emp, name: 'Otra' }),
  await call(mgr, { action: 'edit', id: mgr2.emp, username: 'marta.x' }),
  await call(mgr, { action: 'set_act', id: mgr2.emp, act_role: 'op', act_dept: 'RTE' }),
  await call(mgr, { action: 'set_act', id: mgr2.emp, act_role: null }),
  await call(mgr, { action: 'set_powers', id: mgr2.emp, powers: [] }),
  await call(mgr, { action: 'set_active', id: mgr2.emp, active: false }),
], ['403 owner_protected', '403 owner_protected', '403 owner_protected', '403 owner_protected', '403 owner_protected', '403 owner_only', '403 owner_protected'])
eq('y esa cuenta queda como estaba: entra con su PIN, y con el que intentó ponerle nadie entra', [await row(mgr2.emp), opens('martab.mgr', '242424'), opens('martab.mgr', '535353')], [m2Before, true, false])
const o2Before = await row(ofi2.emp)
eq('ni a la Oficina', [
  await call(mgr, { action: 'set_pin', id: ofi2.emp, pin: '545454' }),
  await call(mgr, { action: 'edit', id: ofi2.emp, name: 'Otro' }),
  await call(mgr, { action: 'set_act', id: ofi2.emp, act_role: 'viewer' }),
  await call(mgr, { action: 'set_powers', id: ofi2.emp, powers: ['fix'] }),
  await call(mgr, { action: 'set_active', id: ofi2.emp, active: false }),
], ['403 owner_protected', '403 owner_protected', '403 owner_protected', '403 owner_only', '403 owner_protected'])
eq('la Oficina no toca a otra Oficina ni a un manager', [
  await call(ofi, { action: 'set_pin', id: ofi2.emp, pin: '555556' }),
  await call(ofi, { action: 'set_active', id: ofi2.emp, active: false }),
  await call(ofi, { action: 'set_powers', id: ofi2.emp, powers: ['depts'] }),
  await call(ofi, { action: 'edit', id: mgr.emp, name: 'Otro' }),
  await call(ofi, { action: 'set_pin', id: mgr.emp, pin: '555556' }),
  await call(ofi, { action: 'set_act', id: mgr.emp, act_role: 'viewer' }),
], ['403 owner_protected', '403 owner_protected', '403 owner_only', '403 owner_protected', '403 owner_protected', '403 owner_protected'])
eq('y las dos cuentas quedan como estaban', [await row(ofi2.emp), opens('oscar.ofi', '686868'), opens('mario.mgr', '191919')], [o2Before, true, true])
eq('no sube a un operador a manager ni a Oficina (ni a un trabajador de Freezer RTE)', [
  await call(mgr, { action: 'set_act', id: ana.emp, act_role: 'mgr' }),
  await call(ofi, { action: 'set_act', id: ana.emp, act_role: 'office' }),
  await call(mgr, { action: 'set_act', id: fworker.emp, act_role: 'mgr' }),
  (await row(ana.emp)).act_role, (await row(fworker.emp)).act_role,
], ['403 owner_only', '403 owner_only', '403 owner_only', 'op', 'op'])
eq('su propio rol, su propio poder y desactivarse, tampoco; su PIN y su nombre, sí', [
  await call(ofi, { action: 'set_powers', id: ofi.emp, powers: ALL }),
  await call(ofi, { action: 'set_active', id: ofi.emp, active: false }),
  await call(mgr, { action: 'set_powers', id: mgr.emp, powers: ALL }),
  await call(mgr, { action: 'edit', id: mgr.emp, name: 'Mario C' }),
  await call(mgr, { action: 'set_pin', id: mgr.emp, pin: '191919' }),
], ['403 owner_only', '400 not_self', '403 owner_only', 'ok', 'ok'])

section('D1 · Un trabajador de Freezer RTE: su rol de Actividad, sus poderes y su turno sí; su PIN, su nombre y desactivarlo, solo el dueño')
const fwBefore = await row(fworker.emp)
eq('un manager no le cambia el PIN, el nombre, el usuario, ni lo desactiva', [
  await call(mgr, { action: 'set_pin', id: fworker.emp, pin: '565656' }),
  await call(mgr, { action: 'edit', id: fworker.emp, name: 'Otro' }),
  await call(mgr, { action: 'edit', id: fworker.emp, username: 'trab.x' }),
  await call(mgr, { action: 'set_active', id: fworker.emp, active: false }),
], ['403 owner_protected', '403 owner_protected', '403 owner_protected', '403 owner_protected'])
eq('la Oficina y un operador con "Manejar empleados" tampoco', [
  await call(ofi, { action: 'set_pin', id: fworker.emp, pin: '565656' }),
  await call(ofi, { action: 'set_active', id: fworker.emp, active: false }),
  await call(pedro, { action: 'edit', id: fworker2.emp, name: 'Otro' }),
  await call(pedro, { action: 'set_active', id: fworker2.emp, active: false }),
], ['403 owner_protected', '403 owner_protected', '403 owner_protected', '403 owner_protected'])
eq('su cuenta queda como estaba y entra con su PIN (también en Freezer RTE)', [await row(fworker.emp), opens('trab.fz', '343536'), opens('trab.fz', '565656'), opens('trab2.fz', '343434')], [fwBefore, true, false, true])
// its powers and its shift are Actividad's alone, not its Freezer sign-in: whoever gives it its role sets them, within
// what they hold (a review of 2026-10-18 found the first version kept them for the owner: a manager made a crew worker
// an operator and could not put them on Turno 2)
const fw2Before = await row(fworker2.emp)
eq('sus poderes y su turno sí, los que tiene quien se los da', [
  await call(mgr, { action: 'set_powers', id: fworker.emp, powers: ['fix'], shift: 2 }),
  (await row(fworker.emp)).act_powers, (await row(fworker.emp)).act_shift,
  await call(mgr, { action: 'set_powers', id: fworker.emp, powers: ['fix', 'othershift'] }),
  await call(pedro, { action: 'set_powers', id: fworker2.emp, powers: ['fix'], shift: 1 }),
  await call(pedro, { action: 'set_powers', id: fworker2.emp, powers: ['del'] }),
  (await row(fworker2.emp)).act_powers, (await row(fworker2.emp)).act_shift,
  await call(ofi, { action: 'set_powers', id: fworker.emp, powers: null }),
  (await row(fworker.emp)).act_powers, (await row(fworker.emp)).act_shift,
], ['ok', ['fix'], 2, '403 not_manager', 'ok', '403 not_manager', ['fix'], 1, 'ok', null, null])
eq('y con eso su entrada (PIN, nombre, activa) sigue igual', [{ ...(await row(fworker.emp)), act_powers: fwBefore.act_powers, act_shift: fwBefore.act_shift }, (await row(fworker2.emp)).name, (await row(fworker2.emp)).active, opens('trab.fz', '343536'), opens('trab2.fz', '343434')], [fwBefore, fw2Before.name, true, true, true])
await db.query('update public.employees set act_powers = null, act_shift = null where id = $1', [fworker2.emp])
const fwMgr = await mk({ name: 'Trabajadora Manager', username: 'trab3.fz', pin: '575757', role: 'worker', actRole: 'mgr' })
eq('uno que el dueño hizo manager: ni su rol', [await call(mgr, { action: 'set_act', id: fwMgr.emp, act_role: 'op', act_dept: 'RTE' }), (await row(fwMgr.emp)).act_role], ['403 owner_protected', 'mgr'])
eq('y en su propia cuenta cambia su PIN y su nombre, como todos', [await call(fwMgr, { action: 'set_pin', id: fwMgr.emp, pin: '585858' }), await call(fwMgr, { action: 'edit', id: fwMgr.emp, name: 'Trabajadora M' }), opens('trab3.fz', '585858')], ['ok', 'ok', true])

section('D1 · Cada quien da solo los poderes que tiene')
eq('un manager no da "Corregir lo del otro turno" (su rol no lo tiene); la Oficina sí', [
  await call(mgr, { action: 'set_powers', id: nico.emp, powers: ['othershift'] }), (await row(nico.emp)).act_powers,
  await call(ofi, { action: 'set_powers', id: nico.emp, powers: ['othershift'] }), (await row(nico.emp)).act_powers,
], ['403 not_manager', null, 'ok', ['othershift']])
eq('ni le cambia el PIN a quien lo tiene (entraría con él); la Oficina sí', [await call(mgr, { action: 'set_pin', id: nico.emp, pin: '595959' }), await call(ofi, { action: 'set_pin', id: nico.emp, pin: '606060' }), opens('nico.rte', '606060')], ['403 not_manager', 'ok', true])
eq('pero se lo puede quitar, o dejarlo y cambiar el turno', [await call(mgr, { action: 'set_powers', id: nico.emp, powers: ['othershift', 'fix'], shift: 2 }), await call(mgr, { action: 'set_powers', id: nico.emp, powers: ['fix'] }), (await row(nico.emp)).act_powers], ['ok', 'ok', ['fix']])
const mgrP = await mk({ name: 'Manager Metas', username: 'metas.mgr', pin: '616161', actRole: 'mgr', powers: ['people', 'goals'] }) // a manager Jose left with two powers
eq('un manager con poderes guardados da solo esos', [
  await call(mgrP, { action: 'set_powers', id: nico.emp, powers: ['fix', 'goals'] }),
  await call(mgrP, { action: 'set_powers', id: ana.emp, powers: ['fix', 'del', 'orders'] }),
  (await row(ana.emp)).act_powers,
], ['ok', '403 not_manager', ['fix', 'del']])
// a person with no Actividad role holds no power, whatever the row kept (E4): being given a role again by somebody
// who is not the owner must not hand back a kept power that person does not hold
const stale = await mk({ name: 'Volvió', username: 'volvio.rte', pin: '626262', powers: ['othershift', 'fix'] })
const stale2 = await mk({ name: 'Volvió Dos', username: 'volvio2.rte', pin: '636363', powers: ['othershift', 'fix'] })
eq('a quien vuelve a Actividad, un manager le deja solo los poderes guardados que él tiene; el dueño, todos', [
  await call(mgr, { action: 'set_act', id: stale.emp, act_role: 'op', act_dept: 'RTE' }), (await row(stale.emp)).act_powers,
  await call(jose, { action: 'set_act', id: stale2.emp, act_role: 'op', act_dept: 'RTE' }), (await row(stale2.emp)).act_powers,
], ['ok', ['fix'], 'ok', ['othershift', 'fix']])

section('La pantalla de Empleados ofrece exactamente lo que la función acepta')
{
  // the app's own rowRights and rolesGiven, from the bundle npm run check builds (tests/device.ts)
  const storage = new Map()
  globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k), key: () => null, length: 0 }
  globalThis.window ??= { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true } }
  const app = await import(pathToFileURL(resolve(here, '../node_modules/.cache/act-check/device.js')).href + '?users')
  const all = async () => (await db.query('select id, user_id, name, username, role, active, act_role, act_dept, act_powers, act_shift, deleted from public.employees order by name')).rows.filter((e) => !e.deleted)
  const lookerOf = (e) => ({ id: e.id, admin: e.role === 'admin', powers: app.powersOf({ role: e.act_role, admin: e.role === 'admin', powers: app.cleanPowers(e.act_powers) }) })
  const lookers = { 'el dueño': jose, 'otra admin de Freezer': fadmin2, 'un manager': mgr, 'un manager con 2 poderes': mgrP, 'la Oficina': ofi, 'un operador con "Manejar empleados"': pedro }
  const yes = (r) => r === 'ok'
  for (const [label, who] of Object.entries(lookers)) {
    const offered = [], hidden = []
    let refused = 0
    for (const { id } of await all()) {
      const rows = await all(), t = rows.find((e) => e.id === id), me = lookerOf(rows.find((e) => e.id === who.emp))
      const can = app.rowRights(t, me)
      // each with what the row already has: the answer says whether it may, and nothing changes (but the PIN)
      const asks = {
        edit: { action: 'edit', id, name: t.name },
        pin: t.username ? { action: 'set_pin', id, pin: '646464' } : null, // an account without a user name signs in with its e-mail: no PIN here
        active: { action: 'set_active', id, active: t.active },
        role: { action: 'set_act', id, act_role: t.act_role, act_dept: t.act_dept },
        powers: { action: 'set_powers', id, powers: t.act_powers, shift: t.act_shift },
      }
      for (const [what, body] of Object.entries(asks)) {
        if (!body) { if (can[what]) offered.push(`${what} de ${t.name} (sin usuario)`); continue }
        const r = await call(who, body)
        if (can[what] && !yes(r)) offered.push(`${what} de ${t.name}: ${r}`)
        // what the function takes and the screen does not offer: only powers where they mean nothing or are all there
        // already (somebody with no Actividad role, one's own row, a Freezer admin's), never a PIN, a name, a role or on/off
        if (!can[what] && yes(r) && !(what === 'powers' && (!t.act_role || t.id === who.emp || t.role === 'admin'))) hidden.push(`${what} de ${t.name}`)
        if (!can[what] && !yes(r)) refused++
      }
    }
    eq(`${label}: nada de lo que la pantalla ofrece lo rechaza la función`, offered, [])
    eq(`${label}: y lo que la pantalla no ofrece, la función lo rechaza`, hidden, [])
    const admin = lookerOf((await all()).find((e) => e.id === who.emp)).admin
    // (the check looks for real: somebody who is not the owner has rows they may not touch, and the function said no)
    if (!admin) eq(`${label}: hay filas que no puede tocar, y la función se lo dijo`, refused > 10, true)
    // a new account: the roles the dialog offers are the ones the function creates
    const made = []
    for (const r of ['op', 'mgr', 'office', 'viewer']) {
      const u = `nuevo.${r}.${Object.keys(lookers).indexOf(label)}`
      made.push([r, app.rolesGiven(admin).includes(r), yes(await call(who, { action: 'create', name: 'Nuevo', username: u, pin: '656565', act_role: r, act_dept: 'RTE' }))])
    }
    eq(`${label}: los roles que ofrece "Nuevo usuario" son los que la función crea`, made.filter(([, offer, ok]) => offer !== ok), [])
  }
}

await db.close()
console.log(failed.length ? `\n✗ ${failed.length} de ${passed + failed.length} comprobaciones fallaron:\n\n  ${failed.join('\n\n  ')}\n` : `\n✓ ${passed} comprobaciones, todas correctas (la función act-users de verdad, con la base del servidor)\n`)
process.exit(failed.length ? 1 : 0)
