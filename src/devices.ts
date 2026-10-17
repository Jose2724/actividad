import { supabase } from './supabase'
import { clockNow, clockOffset, clockState } from './clock'
import { myDept, role, user } from './store'
import { outbox } from './outbox'
import { syncStore } from './sync'
import { BUILD } from './update'

/**
 * Every device tells the server how it is doing (table act_devices, migrations/013): who is signed in on it, which
 * build it runs, what it has recorded that has not gone up and why, when it last brought the server's rows, and how
 * its clock is set. The manager's screen lists them (tab Tablets), so a tablet that stopped sending is found from the
 * office. The word goes straight to the server, never through the queue: a device that cannot send it is one the
 * server does not take, and its silence is the signal.
 */
const KEY = 'act_device'
/** this device's own id, kept on it: the person signed in changes, the device does not */
export function deviceId(): string {
  try {
    const have = localStorage.getItem(KEY)
    if (have) return have
    const id = 'd-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)
    localStorage.setItem(KEY, id)
    return id
  } catch { return 'd-privado' }
}
/** "Android · Chrome", "Windows · Edge": what kind of device and browser, from what the browser says of itself */
export function deviceKind(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  const os = /Android/i.test(ua) ? 'Android' : /iPad|iPhone/i.test(ua) ? 'iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /CrOS/i.test(ua) ? 'Chromebook' : ''
  const br = /Edg\//i.test(ua) ? 'Edge' : /SamsungBrowser/i.test(ua) ? 'Samsung' : /Chrome\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : /Firefox\//i.test(ua) ? 'Firefox' : ''
  return [os, br].filter(Boolean).join(' · ')
}
export type DeviceRow = { id: string; name: string; user_id: string; role: string; dept: string; build: string; seen_at: string | null; last_sync: string | null; pending: number; oldest_at: string | null; error: string; clock: string; offset_ms: number; ua: string; updated_at: string; updated_by: string }
const iso = (ms: number) => (ms > 0 ? new Date(ms).toISOString() : null)
/** what this device says of itself right now */
export function deviceWord(meId: string): Omit<DeviceRow, 'updated_at'> {
  const st = syncStore.get(), clk = clockState()
  return {
    id: deviceId(), name: user.get(), user_id: meId, role: role.get(), dept: myDept.get(), build: BUILD,
    seen_at: iso(clockNow()), last_sync: iso(st.lastSync), pending: st.pending, oldest_at: iso(outbox.oldest()),
    error: st.state === 'signedOut' ? 'sin sesión' : st.state === 'offline' ? 'sin señal' : st.lastError.slice(0, 200), clock: !clk.measured ? 'own' : clk.rough ? 'rough' : 'fine', offset_ms: Math.round(clockOffset()),
    ua: deviceKind(), updated_by: user.get(),
  }
}
let timer: ReturnType<typeof setInterval> | null = null
let quietUntil = 0 // after the server said the table is not there (its SQL not run yet): asked again later, not every minute
export async function sayHello(meId: string): Promise<boolean> {
  if (!supabase || Date.now() < quietUntil || !user.get()) return false
  try {
    const { error } = await supabase.from('act_devices').upsert({ ...deviceWord(meId), updated_at: new Date().toISOString() }, { onConflict: 'id' })
    if (error) { if (/act_devices|schema cache/i.test(error.message ?? '') || error.code === '42P01' || error.code === 'PGRST205') quietUntil = Date.now() + 10 * 60_000; return false }
    return true
  } catch { return false }
}
let lastHello = 0
let unsub: (() => void) | null = null
/**
 * Says hello a few seconds after signing in (once the first download and the clock's measure have had their chance:
 * a word sent at once said "last download 2 hours ago" and "its own clock" of a device that was fine), then every
 * minute while the page is open, when it comes back to the screen, and when what it has to say changes (a download
 * done, a row that will not go up), at most every fifteen seconds.
 */
export function startHello(meId: string) {
  if (!supabase) return
  if (timer) clearInterval(timer)
  if (unsub) unsub()
  const soon = () => { lastHello = Date.now(); void sayHello(meId) }
  const throttled = () => { if (Date.now() - lastHello >= 15_000) soon() }
  setTimeout(soon, 6000)
  timer = setInterval(() => { if (document.visibilityState === 'visible') soon() }, 60_000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') throttled() })
  let was = syncStore.get()
  unsub = syncStore.subscribe(() => { const st = syncStore.get(); if (st.lastSync !== was.lastSync || st.pending !== was.pending || st.state !== was.state || st.refused !== was.refused) { was = st; setTimeout(throttled, 1500) } })
}
/** the devices as the server has them, the most recently heard first */
export async function fetchDevices(): Promise<DeviceRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('act_devices').select('*').order('seen_at', { ascending: false, nullsFirst: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as DeviceRow[]
}
