import { noSignal, supabase } from './supabase'
import { beforeFlush, flush, outbox, type Table } from './outbox'
import { applyRemote, myDept, role, shareLocalLines } from './store'

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

const TABLES: Table[] = ['act_lines', 'act_runs', 'act_stops', 'act_products', 'act_schedule', 'act_changes', 'act_targets']
const SINCE = 'act_since2' // the cursor is the server's synced_at (see migrations/003), not the tablets' clocks
const since = () => { try { return localStorage.getItem(SINCE) || '' } catch { return '' } }
const setSince = (v: string) => { try { localStorage.setItem(SINCE, v) } catch { /* full */ } }

/** a few seconds of overlap on every pull: a row committed a moment before the last one seen is never skipped (applying a row twice changes nothing) */
const OVERLAP_MS = 10_000
const missing = (code: unknown) => ['42P01', 'PGRST205'].includes(String(code ?? '')) // the table's SQL has not been run yet
let pull: Promise<boolean> | null = null
/** everything changed on the server since the last pull (the first time: everything); one pull at a time, whoever asks meanwhile waits for it */
export function pullAll(): Promise<boolean> {
  if (!supabase) return Promise.resolve(false)
  pull ??= pullNow().finally(() => { pull = null })
  return pull
}
async function pullNow(): Promise<boolean> {
  if (!supabase) return false
  try {
    const { data: { session }, error: authError } = await supabase.auth.getSession()
    if (!session) { setStatus({ state: noSignal(authError) ? 'offline' : 'signedOut' }); return false }
    const cursor = since()
    const from = cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : ''
    let newest = cursor
    for (const t of TABLES) {
      let q = supabase.from(t).select('*').order('synced_at', { ascending: true }).limit(5000)
      if (from) q = q.gt('synced_at', from)
      const { data, error } = await q
      if (error && missing(error.code)) continue
      if (error) { setStatus({ state: navigator.onLine ? 'online' : 'offline', lastError: error.message }); return false }
      for (const row of data ?? []) { applyRemote(t, row as Record<string, unknown>); const u = String((row as { synced_at?: string }).synced_at ?? ''); if (u && (!newest || Date.parse(u) > Date.parse(newest))) newest = u }
    }
    if (newest) setSince(newest)
    setStatus({ state: 'online', lastSync: Date.now(), lastError: '' })
    return true
  } catch (e) {
    setStatus({ state: navigator.onLine ? 'online' : 'offline', lastError: String(e) })
    return false
  }
}
/** a device that has been away (no good pull for over a minute) brings down what others did before it sends its own, so the two are merged */
beforeFlush(async () => { if (Date.now() - status.lastSync > 75_000) await pullAll() })
/** down first, then up: what is queued is merged with what the server has before it is sent */
export const syncNow = async () => { await pullAll(); await flushNow() }

export async function flushNow() {
  const r = await flush()
  const quiet = r.error === 'signedOut' || r.error === 'offline' // not errors to show: the dot already says it
  setStatus({ pending: r.left, lastError: quiet ? '' : r.error ?? '', state: r.error === 'signedOut' ? 'signedOut' : r.error === 'offline' ? 'offline' : r.error ? (navigator.onLine ? 'online' : 'offline') : 'online' })
  return r
}

let started = false
/** once per page: pull, send, listen live, and keep trying every so often and whenever the signal comes back */
export function startSync() {
  if (!supabase || started) return
  started = true
  void (async () => { await pullAll(); shareLocalLines((dept) => role.get() !== 'op' || dept === myDept.get()); await flushNow() })()
  supabase.channel('act-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'act_lines' }, (p) => applyRemote('act_lines', p.new as Record<string, unknown>))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'act_runs' }, (p) => applyRemote('act_runs', p.new as Record<string, unknown>))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'act_stops' }, (p) => applyRemote('act_stops', p.new as Record<string, unknown>))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'act_products' }, (p) => applyRemote('act_products', p.new as Record<string, unknown>))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'act_schedule' }, (p) => applyRemote('act_schedule', p.new as Record<string, unknown>))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'act_changes' }, (p) => applyRemote('act_changes', p.new as Record<string, unknown>))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'act_targets' }, (p) => applyRemote('act_targets', p.new as Record<string, unknown>))
    .subscribe()
  window.addEventListener('online', () => { void syncNow() })
  window.addEventListener('act-resync', () => { void syncNow() })
  window.addEventListener('offline', () => setStatus({ state: 'offline' }))
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncNow() })
  setInterval(() => { void flushNow() }, 20_000)
  setInterval(() => { void pullAll() }, 60_000)
}
