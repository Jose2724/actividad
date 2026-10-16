import { createClient, isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js'
import { cleanPowers, cleanShift, type Power } from './powers'
import { tr } from './i18n'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// ---- staying signed in: nobody is signed out unless they, a manager or the sign-in server itself say so ----
/** the page's own stopwatch: it only goes forward, whatever is done to the device's clock */
const stopwatch = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const isTokenUrl = (u: string) => /\/auth\/v1\/token(\?|$)/.test(u)
/**
 * The sign-in server itself says this session cannot be renewed (closed, revoked, unknown): a 4xx answer with its own
 * error body. A busy server (429), a timeout, a proxy's block page or anything else without that body is NOT that.
 */
export function sessionIsOver(status: number, body: string): boolean {
  if (status < 400 || status >= 500 || status === 408 || status === 425 || status === 429) return false
  try {
    const b = JSON.parse(body) as Record<string, unknown> | null
    return !!b && typeof b === 'object' && ['error_code', 'error', 'code'].some((k) => typeof b[k] === 'string' && b[k] !== '')
  } catch { return false }
}
/** no renewal is asked of the server before this moment (by the stopwatch) */
let holdUntil = 0
/**
 * How long a request waits for the server to start answering. On a WiFi that is "connected" but dead (the tablet
 * walked away from its antenna) a request can hang for minutes, and everything behind it waits: what is to go up,
 * what is to come down. After this long it counts as "no answer", and the next round tries again.
 */
export const patience = { ms: 25_000 }
function patient(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (init?.signal) return fetch(input, init) // whoever asked keeps their own patience
  const stop = new AbortController(), late = setTimeout(() => stop.abort(), patience.ms)
  return fetch(input, { ...init, signal: stop.signal }).finally(() => clearTimeout(late))
}
const notNow = (why: string) => new Response(JSON.stringify({ message: tr('La sesión no se pudo renovar ahora ({0}', why) + ')' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
/**
 * Every request of the library goes through here. None waits for ever (see patience), and it touches the two answers
 * that decide whether a person stays signed in:
 *  - A new or renewed session says when it expires by the SERVER's clock ("expires_at"), and the library compares
 *    that with the DEVICE's clock. On a tablet whose clock is behind, the pass is renewed late and the server refuses
 *    everything meanwhile; on one whose clock is far ahead, it is renewed on every single request until the server
 *    stops answering. Without that field the library counts the time left ("expires_in") on the device's own clock,
 *    which is right whatever hour the device is set to.
 *  - A renewal the server could not attend to right now is not "this session is over". Told as "try again later",
 *    the library keeps the session instead of signing the person out, and the server is left alone for a minute.
 *    Only the sign-in server saying so in its own words ends a session (see sessionIsOver).
 * Anything unexpected in here hands the server's answer over untouched.
 */
export async function sessionFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const token = isTokenUrl(u), renewal = token && u.includes('grant_type=refresh_token')
  if (renewal && stopwatch() < holdUntil) return notNow(tr('en espera'))
  const res = await patient(input, init)
  if (!token) return res
  try {
    if (res.ok) {
      const body = (await res.clone().json()) as Record<string, unknown> | null
      if (!body || typeof body !== 'object' || !('expires_at' in body) || !(Number(body.expires_in) > 0)) return res
      delete body.expires_at
      return new Response(JSON.stringify(body), { status: res.status, statusText: res.statusText, headers: { 'Content-Type': 'application/json' } })
    }
    if (!renewal || sessionIsOver(res.status, await res.clone().text())) return res
    const asked = Number(res.headers.get('retry-after'))
    holdUntil = stopwatch() + Math.min(300, asked > 0 ? asked : 60) * 1000
    return notNow(String(res.status))
  } catch { return res }
}

/** null = demo mode: everything stays on the device. With keys, the app shares the Freezer RTE project (tables act_*). */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true }, global: { fetch: sessionFetch } }) : null

/** the server said the pass is too old, while the device believed it still had time (its clock was moved backwards) */
export const passExpired = (message: unknown) => /jwt expired|PGRST301|PGRST303|token is expired/i.test(String(message ?? ''))
let renewedAt = -Infinity
/** asks for a new pass now, at most once a minute. true = renewed */
export async function renewSession(): Promise<boolean> {
  if (!supabase || stopwatch() - renewedAt < 60_000) return false
  renewedAt = stopwatch()
  try { const { error } = await supabase.auth.refreshSession(); return !error } catch { return false }
}

/**
 * Asks the browser not to clear what the app keeps on this device (who is signed in, what is waiting to go up) when
 * the device runs short of space. Chrome and Safari decide by themselves, without asking the person; Firefox would
 * show a question, so it is left alone there.
 */
export function keepStorage() {
  try { if (!/firefox/i.test(navigator.userAgent) && navigator.storage?.persist) void navigator.storage.persist().catch(() => false) } catch { /* not offered here */ }
}

/** the same people and PINs as Freezer RTE: a username becomes an address on a reserved domain */
export const USER_DOMAIN = 'freezer.example.com'
/** a username becomes an address on the reserved domain; the owner (a real e-mail, like in Freezer RTE) is used as typed */
export const loginEmail = (user: string) => (user.includes('@') ? user.trim().toLowerCase() : user.trim().toLowerCase() + '@' + USER_DOMAIN)

/** admin = an administrator of Freezer RTE (the owner): the only one who may wipe a whole day of tests */
export type Me = { id: string; name: string; username: string; role: 'op' | 'mgr' | 'office' | 'viewer'; dept: string; admin?: boolean; powers?: Power[] | null; shift?: 0 | 1 | 2 }
/** the database does not have a column the app asks for (a change that has not been applied there yet) */
export const missingColumn = (e: { code?: string; message?: string } | null | undefined) => !!e && (e.code === '42703' || e.code === 'PGRST204' || /does not exist|could not find the .* column|act_powers|act_shift/i.test(e.message ?? ''))

/** a session that is on the device but could not be renewed for lack of signal (not the same as nobody signed in) */
export const noSignal = (e: unknown) => !!e && isAuthRetryableFetchError(e)

/**
 * who is signed in on this device, as the server sees them: null = nobody; 'none' = signed in but without an
 * Actividad role. THROWS when that cannot be known right now (no signal, the server does not answer): whoever was
 * using the device is not thrown out for that (see ServerApp).
 */
export async function fetchMe(): Promise<Me | null | 'none'> {
  if (!supabase) return null
  const { data: { session }, error: authError } = await supabase.auth.getSession()
  if (!session) { if (noSignal(authError)) throw authError; return null }
  type Row = { id: string; name: string; username: string | null; role: string; act_role: Me['role'] | null; act_dept: string | null; active: boolean; act_powers?: unknown; act_shift?: unknown }
  const ask = async (cols: string) => { const r = await supabase!.from('employees').select(cols).eq('user_id', session.user.id).maybeSingle(); return { data: r.data as unknown as Row | null, error: r.error } }
  let { data, error } = await ask('id, name, username, role, act_role, act_dept, active, act_powers, act_shift')
  // the powers and the shift came with a change in the database: until it is applied there, the roles decide as before
  if (error && missingColumn(error)) ({ data, error } = await ask('id, name, username, role, act_role, act_dept, active'))
  if (error) throw error
  if (!data || !data.active || !data.act_role) return 'none'
  return { id: data.id, name: data.name, username: data.username ?? '', role: data.act_role, dept: data.act_dept ?? '', admin: data.role === 'admin', powers: cleanPowers(data.act_powers), shift: cleanShift(data.act_shift) }
}

// ---- the last person the server confirmed on this device: with it the app opens at once, with or without signal ----
const ME_KEY = 'act_me'
export function rememberMe(m: Me | null) { try { if (m) localStorage.setItem(ME_KEY, JSON.stringify(m)); else localStorage.removeItem(ME_KEY) } catch { /* private */ } }
export function rememberedMe(): Me | null {
  try {
    const m = JSON.parse(localStorage.getItem(ME_KEY) || 'null') as Me | null
    return m && typeof m.name === 'string' && m.name && ['op', 'mgr', 'office', 'viewer'].includes(m.role) ? m : null
  } catch { return null }
}
/**
 * What the person looking at Empleados may do to one row: the same rules the server applies (the act-users function),
 * so the screen does not draw a button the server would refuse. The owner's account (the one that signs in with an
 * e-mail instead of a user name) is off limits to everyone else; nobody turns their own account off; and only a
 * Freezer RTE admin may change their own role. A row without a user name has no PIN to change.
 */
export function rowRights(row: { id: string; user_id?: string | null; username?: string | null }, meId: string, meAdmin: boolean) {
  const mine = row.id === meId
  const locked = !mine && !!row.user_id && !row.username
  return { mine, locked, role: !locked && (!mine || meAdmin), pin: !locked && !!row.username, active: !locked && !mine }
}

// ---- the user name last used to sign in on this device: written once, offered from then on. Never the PIN: that is
// for the device's own password store to keep, if the person lets it (see LoginGate). An e-mail is not kept either:
// on a shared tablet it would be shown to whoever opens the sign-in screen ----
const LAST_KEY = 'act_last_user'
export function rememberUser(u: string) { const v = u.trim().toLowerCase(); try { if (v && !v.includes('@')) localStorage.setItem(LAST_KEY, v) } catch { /* private */ } }
export const rememberedUser = (): string => { try { return localStorage.getItem(LAST_KEY) || '' } catch { return '' } }

// ---- "Salir" ----
const OUT_KEY = 'act_out'
/** where the library keeps the session on this device */
const sessionKeys = () => {
  const found: string[] = []
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && /^sb-.+-auth-token/.test(k)) found.push(k) } } catch { /* private */ }
  return found
}
let leaving: Promise<void> | null = null
/** done once a "Salir" in progress has completely finished. A sign-in waits for it: nothing of the old session is left that could clear the new one */
export const signedOut = (): Promise<void> => leaving ?? Promise.resolve()
/**
 * Signs out of THIS device only (the same user on another tablet stays in), at once and with or without signal: the
 * session is taken off the device first, and only then are the library and the server told. Done in that order the
 * library has nothing left to ask the server, so no late answer of a slow network can clear the session of whoever
 * signs in next. If the app is closed before it finishes, it is finished at the next start (finishSignOut).
 */
export function signOutHere(): Promise<void> {
  if (!supabase) return Promise.resolve()
  leaving ??= leave(supabase).finally(() => { leaving = null })
  return leaving
}
async function leave(client: SupabaseClient) {
  // the pass the server knows this session by, read before it goes, to tell the server afterwards
  let pass = ''
  const keys = sessionKeys()
  try { for (const k of keys) { const s = JSON.parse(localStorage.getItem(k) || 'null') as { access_token?: string } | null; if (s?.access_token) pass = s.access_token } } catch { /* unreadable: nothing to tell */ }
  try { localStorage.setItem(OUT_KEY, '1') } catch { /* private */ }
  try { for (const k of keys) localStorage.removeItem(k) } catch { /* private */ }
  // with no session left to read, the library only clears its own state: nothing goes over the network
  const told = client.auth.signOut({ scope: 'local' }).then(() => undefined, () => undefined)
  await Promise.race([told, wait(1500)])
  try { for (const k of sessionKeys()) localStorage.removeItem(k); localStorage.removeItem(OUT_KEY) } catch { /* private */ }
  // the server forgets this session, if it can be reached; nobody waits for that
  if (pass && url && key) {
    try {
      const stop = new AbortController()
      setTimeout(() => stop.abort(), 8000)
      void fetch(url + '/auth/v1/logout?scope=local', { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + pass }, keepalive: true, signal: stop.signal }).catch(() => undefined)
    } catch { /* out of reach: the session is off this device anyway */ }
  }
  // (it only takes longer than a moment when the app was opened without signal seconds ago and is still starting up)
  await told
}
/** "Salir" was tapped and the app closed before it finished */
export async function finishSignOut() {
  let half = false
  try { half = !!localStorage.getItem(OUT_KEY) } catch { /* private */ }
  if (half) await signOutHere()
}
