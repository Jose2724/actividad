import { noSignal, passExpired, renewSession, supabase } from './supabase'
import { startClock } from './clock'
import { afterFlush, beforeFlush, flush, outbox, type Row, type Table } from './outbox'
import { applyRemote, awayDay, batch, closeDay, firstKeptDay, myDept, openDay, prune, role, shareLocalLines } from './store'
import { tr } from './i18n'

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

/**
 * What "Salir" asks before leaving. A stray tap must not leave a tablet at the sign-in screen, and the question says
 * what leaving costs right now: records still on their way to the server, or no signal to come back in with.
 * `online` = what the device itself says about its network (the app may not have noticed yet).
 */
export function leaveAsk(st: Pick<SyncStatus, 'state' | 'pending'>, online = true): { title: string; text: string; yes: string; danger: boolean } {
  if (st.state === 'local') return { title: tr('¿Cambiar de usuario?'), text: tr('Vuelves a la pantalla de entrada. Lo registrado se queda guardado en este aparato y lo que está corriendo sigue contando.'), yes: tr('Cambiar'), danger: false }
  const offline = st.state === 'offline' || !online
  const n = st.pending
  const waiting = n === 1 ? tr('Hay 1 registro que no ha llegado al servidor') : tr('Hay {0} registros que no han llegado al servidor', n)
  if (n > 0 && st.state === 'signedOut') return { title: tr('Todavía hay registros sin subir'), text: tr('{0} porque la sesión se cerró. Para que suban, vuelve a entrar en este aparato con tu usuario.', waiting), yes: tr('Salir'), danger: false }
  if (n > 0) return { title: tr('Todavía hay registros sin subir'), text: waiting + (offline ? ' ' + tr('y ahora no hay señal. No salgas hasta que vuelva la señal y arriba diga "Sincronizado".') : tr('. Espera a que arriba diga "Sincronizado" y sal después.')), yes: tr('Salir de todos modos'), danger: true }
  if (offline) return { title: tr('¿Salir sin señal?'), text: tr('Ahora no hay señal. Si sales, no vas a poder entrar otra vez hasta que vuelva el WiFi, y mientras tanto no se puede registrar nada en este aparato.'), yes: tr('Salir de todos modos'), danger: true }
  return { title: tr('¿Salir de Actividad?'), text: tr('Para volver a entrar hay que poner el usuario y el PIN. Lo que está corriendo sigue contando.'), yes: tr('Salir'), danger: false }
}

const TABLES: Table[] = ['act_lines', 'act_runs', 'act_stops', 'act_products', 'act_schedule', 'act_changes', 'act_targets']
const SINCE = 'act_since2' // the cursor is the server's synced_at (see migrations/003), not the tablets' clocks
const since = () => { try { return localStorage.getItem(SINCE) || '' } catch { return '' } }
const setSince = (v: string) => { try { localStorage.setItem(SINCE, v) } catch { /* full */ } }

/** a few seconds of overlap on every pull: a row committed a moment before the last one seen is never skipped (applying a row twice changes nothing) */
const OVERLAP_MS = 10_000
/**
 * the request never got an answer: no network, or a network that does not reach the server (a WiFi without internet).
 * Each browser says it its own way. For the app that is "no connection", whatever the device says about its WiFi.
 */
export const unreachable = (message: unknown) => /failed to fetch|load failed|networkerror|network request failed|fetch failed|err_internet|err_network|aborted|aborterror|timed? ?out/i.test(String(message ?? ''))
/**
 * what the dot shows after a request that failed: no connection (said by the dot itself, no technical text), or an
 * error worth reading. A pass the server calls expired is neither: the device believed it still had time (its clock
 * was moved back), so a new one is asked for at once and everything is tried again.
 */
const failed = (message: string): Partial<SyncStatus> => {
  if (passExpired(message)) { void renewSession().then((ok) => { if (ok) void syncNow() }); return { state: 'connecting', lastError: '' } }
  return navigator.onLine === false || unreachable(message) ? { state: 'offline', lastError: '' } : { state: 'online', lastError: message }
}
const missing = (code: unknown) => ['42P01', 'PGRST205'].includes(String(code ?? '')) // the table's SQL has not been run yet
type Page = { data: Row[] | null; error: { code?: string; message: string } | null }
/**
 * every row of a listing, read in pages (the server gives at most a thousand rows at a time). The pages overlap, so a
 * row that moves in the listing while it is being read (someone saved at that moment) is not skipped; a row read
 * twice is applied twice, which changes nothing. Returns the error that stopped it, if any.
 */
export async function pages(get: (from: number, to: number) => PromiseLike<Page>, each: (rows: Row[]) => void, size = 1000, overlap = 100): Promise<Page['error']> {
  for (let at = 0; ;) {
    const { data, error } = await get(at, at + size - 1)
    if (error) return error
    const rows = data ?? []
    if (rows.length) each(rows)
    if (rows.length <= overlap) return null
    at += rows.length - overlap
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any // a query to the server while it is being put together
/** the columns that tell two rows with the same synced_at apart, so the listing always comes in the same order */
const ORDER: Record<Table, string[]> = { act_lines: ['id'], act_runs: ['id'], act_stops: ['id'], act_changes: ['id'], act_products: ['code'], act_schedule: ['date', 'code'], act_targets: ['dept'] }
const listing = (t: Table, narrow: (q: Q) => Q) => (from: number, to: number) => {
  let q: Q = narrow(supabase!.from(t).select('*')).order('synced_at', { ascending: true })
  for (const k of ORDER[t]) q = q.order(k, { ascending: true })
  return q.range(from, to) as PromiseLike<Page>
}
const DAY = 86_400_000
const midnight = (date: string) => new Date(date + 'T00:00:00').getTime()
const iso = (ms: number) => new Date(ms).toISOString()
/**
 * what a device asks for the first time (or after it was emptied): only the days it keeps, plus whatever is still
 * open. Lines, products and goals always come whole.
 */
export const firstPull = (day0: string): Partial<Record<Table, (q: Q) => Q>> => ({
  act_runs: (q) => q.or(`date.gte.${day0},ended_at.is.null`),
  act_stops: (q) => q.or(`started_at.gte."${iso(midnight(day0) - DAY)}",ended_at.is.null`),
  act_changes: (q) => q.gte('at', iso(midnight(day0) - DAY)),
  act_schedule: (q) => q.gte('date', day0),
})
/** what makes up one day: its runs, the stops around it (a run may cross midnight), its history and its program */
export const dayPull = (date: string): [Table, (q: Q) => Q][] => [
  ['act_runs', (q) => q.eq('date', date)],
  ['act_stops', (q) => q.gte('started_at', iso(midnight(date) - DAY)).lt('started_at', iso(midnight(date) + 2 * DAY))],
  ['act_changes', (q) => q.gte('at', iso(midnight(date))).lt('at', iso(midnight(date) + DAY))],
  ['act_schedule', (q) => q.eq('date', date)],
]

let pull: Promise<boolean> | null = null
/** everything changed on the server since the last pull; one pull at a time, whoever asks meanwhile waits for it */
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
    const from = cursor ? iso(Date.parse(cursor) - OVERLAP_MS) : ''
    const first: Partial<Record<Table, (q: Q) => Q>> = cursor ? {} : firstPull(firstKeptDay())
    let newest = cursor
    for (const t of TABLES) {
      const narrow = (q: Q) => { const x = first[t] ? first[t]!(q) : q; return from ? x.gt('synced_at', from) : x }
      const error = await pages(listing(t, narrow), (rows) => batch(() => {
        for (const row of rows) { applyRemote(t, row); const u = String(row.synced_at ?? ''); if (u && (!newest || Date.parse(u) > Date.parse(newest))) newest = u }
      }))
      if (error && missing(error.code)) continue
      if (error) { setStatus(failed(error.message)); return false }
    }
    if (newest) setSince(newest)
    prune() // the days this device no longer keeps (also when the date changes while the app stays open)
    setStatus({ state: 'online', lastSync: Date.now(), lastError: '' })
    return true
  } catch (e) {
    setStatus(failed(String(e)))
    return false
  }
}
/**
 * an older day, brought from the server because someone opened it in Reporte or Avance. It stays on the device while
 * the app is open. false = it could not be brought now (no signal): asking again tries again.
 */
export async function loadDay(date: string): Promise<boolean> {
  if (!supabase || !awayDay(date)) return true
  openDay(date) // from now on its rows are kept as they arrive
  try {
    for (const [t, narrow] of dayPull(date)) {
      const error = await pages(listing(t, narrow), (rows) => batch(() => { for (const row of rows) applyRemote(t, row) }))
      if (error && !missing(error.code)) { closeDay(date); return false }
    }
    return true
  } catch { closeDay(date); return false }
}
/** a device that has been away (no good pull for over a minute) brings down what others did before it sends its own, so the two are merged */
beforeFlush(async () => { if (Date.now() - status.lastSync > 75_000) await pullAll() })
/** down first, then up: what is queued is merged with what the server has before it is sent */
export const syncNow = async () => { await pullAll(); await flushNow() }

/**
 * How a pass of the queue ended, whoever started it: the dot follows. A pass with nothing to send asked the server
 * nothing, so it knows nothing about the connection and the dot stays as the last pull left it. (It used to turn
 * "Sincronizado" on its own, also with the WiFi off.)
 */
afterFlush((r) => {
  if (r.error === 'signedOut') setStatus({ pending: r.left, state: 'signedOut', lastError: '' })
  else if (r.error === 'offline') setStatus({ pending: r.left, state: 'offline', lastError: '' })
  else if (r.error) setStatus({ pending: r.left, ...failed(r.error) })
  else if (r.sent > 0) setStatus({ pending: r.left, state: 'online', lastError: '' })
  else setStatus({ pending: r.left })
})
export const flushNow = () => flush()

let started = false
/** once per page: pull, send, listen live, and keep trying every so often and whenever the signal comes back */
export function startSync() {
  if (!supabase) return
  // someone signed in again on a page that was already running: the dot must not keep saying "Sin sesión" until the next round
  if (started) { void syncNow(); return }
  started = true
  prune()
  startClock()
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
