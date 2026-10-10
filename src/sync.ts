import { supabase } from './supabase'
import { flush, outbox, type Table } from './outbox'
import { applyRemote } from './store'

/**
 * Keeps this device and the server in step: what is queued goes up (outbox), what other tablets and the office
 * changed comes down (a pull of everything newer than the last one, plus live updates while the screen is open).
 */
export type SyncStatus = { state: 'local' | 'signedOut' | 'connecting' | 'online' | 'offline'; pending: number; lastSync: number; lastError: string }
let status: SyncStatus = { state: supabase ? 'connecting' : 'local', pending: outbox.size(), lastSync: 0, lastError: '' }
const subs = new Set<() => void>()
const setStatus = (patch: Partial<SyncStatus>) => { status = { ...status, ...patch }; subs.forEach((f) => f()) }
export const syncStore = { get: () => status, subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f) } } }
outbox.subscribe(() => setStatus({ pending: outbox.size() }))

const TABLES: Table[] = ['act_lines', 'act_runs', 'act_stops', 'act_products', 'act_schedule']
const SINCE = 'act_since'
const since = () => { try { return localStorage.getItem(SINCE) || '' } catch { return '' } }
const setSince = (v: string) => { try { localStorage.setItem(SINCE, v) } catch { /* full */ } }

let pulling = false
/** everything changed on the server since the last pull (the first time: everything) */
export async function pullAll(): Promise<boolean> {
  if (!supabase || pulling) return false
  pulling = true
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setStatus({ state: 'signedOut' }); return false }
    const from = since()
    let newest = from
    for (const t of TABLES) {
      let q = supabase.from(t).select('*').order('updated_at', { ascending: true }).limit(5000)
      if (from) q = q.gt('updated_at', from)
      const { data, error } = await q
      if (error) { setStatus({ state: navigator.onLine ? 'online' : 'offline', lastError: error.message }); return false }
      for (const row of data ?? []) { applyRemote(t, row as Record<string, unknown>); const u = String((row as { updated_at?: string }).updated_at ?? ''); if (u > newest) newest = u }
    }
    if (newest) setSince(newest)
    setStatus({ state: 'online', lastSync: Date.now(), lastError: '' })
    return true
  } catch (e) {
    setStatus({ state: navigator.onLine ? 'online' : 'offline', lastError: String(e) })
    return false
  } finally { pulling = false }
}

export async function flushNow() {
  const r = await flush()
  setStatus({ pending: r.left, lastError: r.error ?? '', state: r.error === 'signedOut' ? 'signedOut' : r.error ? (navigator.onLine ? 'online' : 'offline') : 'online' })
  return r
}

let started = false
/** once per page: pull, send, listen live, and keep trying every so often and whenever the signal comes back */
export function startSync() {
  if (!supabase || started) return
  started = true
  void (async () => { await pullAll(); await flushNow() })()
  supabase.channel('act-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'act_lines' }, (p) => applyRemote('act_lines', p.new as Record<string, unknown>))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'act_runs' }, (p) => applyRemote('act_runs', p.new as Record<string, unknown>))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'act_stops' }, (p) => applyRemote('act_stops', p.new as Record<string, unknown>))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'act_products' }, (p) => applyRemote('act_products', p.new as Record<string, unknown>))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'act_schedule' }, (p) => applyRemote('act_schedule', p.new as Record<string, unknown>))
    .subscribe()
  window.addEventListener('online', () => { void pullAll(); void flushNow() })
  window.addEventListener('offline', () => setStatus({ state: 'offline' }))
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { void pullAll(); void flushNow() } })
  setInterval(() => { void flushNow() }, 20_000)
  setInterval(() => { void pullAll() }, 3 * 60_000)
}
