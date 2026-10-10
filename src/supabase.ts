import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
/** null = demo mode: everything stays on the device. With keys, the app shares the Freezer RTE project (tables act_*). */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null

/** the same people and PINs as Freezer RTE: a username becomes an address on a reserved domain */
export const USER_DOMAIN = 'freezer.example.com'
export const loginEmail = (username: string) => username.trim().toLowerCase() + '@' + USER_DOMAIN

export type Me = { id: string; name: string; username: string; role: 'op' | 'mgr' | 'office'; dept: string }

/** who is signed in on this device, as Actividad sees them: null = nobody; 'none' = signed in but without an Actividad role */
export async function fetchMe(): Promise<Me | null | 'none'> {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const { data, error } = await supabase.from('employees').select('id, name, username, act_role, act_dept, active').eq('user_id', session.user.id).maybeSingle()
  if (error) throw error
  if (!data || !data.active || !data.act_role) return 'none'
  return { id: data.id, name: data.name, username: data.username ?? '', role: data.act_role, dept: data.act_dept ?? '' }
}
