// Supabase Edge Function "act-users": lets an Actividad manager (or a Freezer RTE admin) create accounts for the
// departments (username + PIN), give them their Actividad role and department, change a PIN and turn an account
// on/off. Runs with the service key, which never reaches the tablets. Same people and PINs as Freezer RTE:
// a person created here can also use Freezer RTE as a "requester" (orders empty carts) unless a freezer admin
// gives them more.
import { createClient } from 'npm:@supabase/supabase-js@2'

const DOMAIN = 'freezer.example.com'
const DEPTS = ['Kitchen', 'RTE', 'Spiral', 'MFO', 'Packing']
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: { user } } = await admin.auth.getUser(token)
    if (!user) return json({ error: 'not_signed_in' }, 401)
    const { data: me } = await admin.from('employees').select('id, role, active, act_role').eq('user_id', user.id).maybeSingle()
    if (!me || !me.active || !(me.role === 'admin' || me.act_role === 'mgr')) return json({ error: 'not_manager' }, 403)
    const freezerAdmin = me.role === 'admin'

    const body = await req.json()
    const actRoleOf = (r: unknown) => (['op', 'mgr', 'office'].includes(String(r)) ? String(r) : 'op')
    const deptOf = (d: unknown) => (DEPTS.includes(String(d)) ? String(d) : null)
    const pinOk = (p: unknown) => /^\d{6,12}$/.test(String(p ?? ''))  // Supabase Auth wants at least 6
    const target = async () => {
      const { data } = await admin.from('employees').select('id, user_id, role, active, act_role').eq('id', String(body.id ?? '')).maybeSingle()
      return data
    }
    // the owner's account (a real e-mail) is off limits to everyone else
    const ownerLocked = async (t: { id: string; user_id: string | null }) => {
      if (t.id === me.id || !t.user_id) return false
      const { data, error } = await admin.auth.admin.getUserById(t.user_id)
      if (error || !data.user) return (error as { status?: number } | null)?.status !== 404
      return !(data.user.email ?? '').toLowerCase().endsWith('@' + DOMAIN)
    }

    if (body.action === 'create') {
      const username = String(body.username ?? '').trim().toLowerCase()
      const name = String(body.name ?? '').trim().replace(/\s+/g, ' ')
      const actRole = actRoleOf(body.act_role), actDept = deptOf(body.act_dept)
      if (!name) return json({ error: 'bad_name' }, 400)
      if (!/^[a-z0-9._-]{3,30}$/.test(username)) return json({ error: 'bad_username' }, 400)
      if (!pinOk(body.pin)) return json({ error: 'bad_pin' }, 400)
      if (actRole === 'op' && !actDept) return json({ error: 'bad_dept' }, 400)
      const { data: taken } = await admin.from('employees').select('id').eq('username', username).maybeSingle()
      if (taken) return json({ error: 'username_taken' }, 400)
      const { data, error } = await admin.auth.admin.createUser({ email: `${username}@${DOMAIN}`, password: String(body.pin), email_confirm: true, user_metadata: { name, username } })
      if (error || !data.user) return json({ error: /already|registered|exists/i.test(error?.message ?? '') ? 'username_taken' : (error?.message ?? 'create_failed') }, 400)
      // in Freezer RTE this person only orders empty carts, unless a freezer admin says otherwise
      const role = freezerAdmin && ['admin', 'worker', 'requester'].includes(String(body.role)) ? String(body.role) : 'requester'
      const { error: e2 } = await admin.from('employees').insert({ name, username, role, user_id: data.user.id, active: true, act_role: actRole, act_dept: actDept })
      if (e2) { await admin.auth.admin.deleteUser(data.user.id); return json({ error: e2.code === '23505' ? 'username_taken' : e2.message }, 400) }
      return json({ ok: true })
    }

    if (body.action === 'set_act') {
      const t = await target()
      if (!t) return json({ error: 'not_found' }, 404)
      if (await ownerLocked(t)) return json({ error: 'owner_protected' }, 403)
      const actRole = body.act_role == null || body.act_role === '' ? null : actRoleOf(body.act_role)
      const actDept = deptOf(body.act_dept)
      if (actRole === 'op' && !actDept) return json({ error: 'bad_dept' }, 400)
      if (t.id === me.id && actRole !== 'mgr' && !freezerAdmin) return json({ error: 'not_self' }, 400)
      await admin.from('employees').update({ act_role: actRole, act_dept: actDept }).eq('id', t.id)
      return json({ ok: true })
    }

    if (body.action === 'set_pin') {
      const t = await target()
      if (!t?.user_id) return json({ error: 'not_found' }, 404)
      if (await ownerLocked(t)) return json({ error: 'owner_protected' }, 403)
      if (!pinOk(body.pin)) return json({ error: 'bad_pin' }, 400)
      const { error } = await admin.auth.admin.updateUserById(t.user_id, { password: String(body.pin) })
      return error ? json({ error: error.message }, 400) : json({ ok: true })
    }

    if (body.action === 'set_active') {
      const t = await target()
      if (!t) return json({ error: 'not_found' }, 404)
      if (t.id === me.id) return json({ error: 'not_self' }, 400)
      if (await ownerLocked(t)) return json({ error: 'owner_protected' }, 403)
      const active = !!body.active
      await admin.from('employees').update({ active }).eq('id', t.id)
      if (t.user_id) await admin.auth.admin.updateUserById(t.user_id, { ban_duration: active ? 'none' : '876000h' })
      return json({ ok: true })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
