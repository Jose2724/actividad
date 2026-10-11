import { createClient, isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
/** null = demo mode: everything stays on the device. With keys, the app shares the Freezer RTE project (tables act_*). */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null

/** the same people and PINs as Freezer RTE: a username becomes an address on a reserved domain */
export const USER_DOMAIN = 'freezer.example.com'
/** a username becomes an address on the reserved domain; the owner (a real e-mail, like in Freezer RTE) is used as typed */
export const loginEmail = (user: string) => (user.includes('@') ? user.trim().toLowerCase() : user.trim().toLowerCase() + '@' + USER_DOMAIN)

export type Me = { id: string; name: string; username: string; role: 'op' | 'mgr' | 'office'; dept: string }

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
  const { data, error } = await supabase.from('employees').select('id, name, username, act_role, act_dept, active').eq('user_id', session.user.id).maybeSingle()
  if (error) throw error
  if (!data || !data.active || !data.act_role) return 'none'
  return { id: data.id, name: data.name, username: data.username ?? '', role: data.act_role, dept: data.act_dept ?? '' }
}

// ---- the last person the server confirmed on this device: with it the app opens at once, with or without signal ----
const ME_KEY = 'act_me'
export function rememberMe(m: Me | null) { try { if (m) localStorage.setItem(ME_KEY, JSON.stringify(m)); else localStorage.removeItem(ME_KEY) } catch { /* private */ } }
export function rememberedMe(): Me | null {
  try {
    const m = JSON.parse(localStorage.getItem(ME_KEY) || 'null') as Me | null
    return m && typeof m.name === 'string' && m.name && ['op', 'mgr', 'office'].includes(m.role) ? m : null
  } catch { return null }
}
/**
 * signs out of THIS device only (the same user on another tablet stays in). The server is told if it can be reached,
 * but the session kept on the device goes either way, so "Salir" always leaves the device signed out, also without
 * signal and also if the app is closed before it finishes (it is finished at the next start).
 */
const OUT_KEY = 'act_out'
export async function signOutHere() {
  if (!supabase) return
  try { localStorage.setItem(OUT_KEY, '1') } catch { /* private */ }
  try { await Promise.race([supabase.auth.signOut({ scope: 'local' }), new Promise((r) => setTimeout(r, 4000))]) } catch { /* no signal */ }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && /^sb-.+-auth-token/.test(k)) localStorage.removeItem(k) }
    localStorage.removeItem(OUT_KEY)
  } catch { /* private */ }
}
/** "Salir" was tapped and the app closed before it finished */
export async function finishSignOut() {
  let half = false
  try { half = !!localStorage.getItem(OUT_KEY) } catch { /* private */ }
  if (half) await signOutHere()
}
