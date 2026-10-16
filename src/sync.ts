import { noSignal, passExpired, renewSession, supabase } from './supabase'
import { startClock } from './clock'
import { afterFlush, beforeFlush, flush, outbox, type Row, type Table } from './outbox'
import { applyRemote, awayDay, batch, closeDay, firstKeptDay, myDept, openDay, prune, role, shareLocalLines, store } from './store'
import { tr } from './i18n'

/**
 * Keeps this device and the server in step: what is queued goes up (outbox), what other tablets and the office
 * changed comes down (a pull of everything newer than the last one, plus live updates while the screen is open).
 */
export type SyncStatus = { state: 'local' | 'signedOut' | 'connecting' | 'online' | 'offline'; pending: number; lastSync: number; lastError: string }
/** a device that has gone this long without bringing the server's rows may show an old picture of the day: the screens say so */
export const STALE_MS = 10 * 60_000
// the hour of the last pull is kept on the device: when the app opens again it knows how old its copy is
const LAST_PULL = 'act_last_pull'
const lastPull = () => { try { return Number(localStorage.getItem(LAST_PULL)) || 0 } catch { return 0 } }
let status: SyncStatus = { state: supabase ? 'connecting' : 'local', pending: outbox.size(), lastSync: supabase ? lastPull() : 0, lastError: '' }
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

const TABLES: Table[] = ['act_lines', 'act_runs', 'act_stops', 'act_products', 'act_schedule', 'act_changes', 'act_targets', 'act_plan']
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
const ORDER: Record<Table, string[]> = { act_lines: ['id'], act_runs: ['id'], act_stops: ['id'], act_changes: ['id'], act_products: ['code'], act_schedule: ['date', 'code'], act_targets: ['dept'], act_plan: ['date', 'dept', 'code'] }
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
  act_plan: (q) => q.gte('date', day0),
})
/** what makes up one day: its runs, the stops around it (a run may cross midnight), its history and its program */
export const dayPull = (date: string): [Table, (q: Q) => Q][] => [
  ['act_runs', (q) => q.eq('date', date)],
  ['act_stops', (q) => q.gte('started_at', iso(midnight(date) - DAY)).lt('started_at', iso(midnight(date) + 2 * DAY))],
  ['act_changes', (q) => q.gte('at', iso(midnight(date))).lt('at', iso(midnight(date) + DAY))],
  ['act_schedule', (q) => q.eq('date', date)],
  ['act_plan', (q) => q.eq('date', date)],
]

/**
 * What the server holds of a day that is marked as taken away: its runs, the stops around it and their history.
 * Nothing is ever erased there, so what somebody "deleted" by mistake can be brought back (see restorePurged).
 * null = it could not be asked now (no signal, or no session).
 */
export async function fetchPurged(date: string): Promise<{ runs: Row[]; stops: Row[]; changes: Row[] } | null> {
  if (!supabase) return null
  const out = { runs: [] as Row[], stops: [] as Row[], changes: [] as Row[] }
  const into: Partial<Record<Table, Row[]>> = { act_runs: out.runs, act_stops: out.stops, act_changes: out.changes }
  try {
    for (const [t, narrow] of dayPull(date)) {
      const list = into[t]
      if (!list) continue
      const error = await pages(listing(t, (q) => narrow(q).eq('deleted', true)), (rows) => { for (const row of rows) if (row.deleted && !list.some((x) => x.id === row.id)) list.push(row) })
      if (error) return null
    }
    return out
  } catch { return null }
}

/** when each open order was last asked for its pallets; an order is asked again after a while, a new one at once */
const askedOrders = new Map<string, number>()
const ORDER_ASK_MS = 30 * 60_000
/**
 * An order is filled over days, more than this device keeps: the pallets it got on older days come from the server,
 * so "Hechas" and "pallet 7 de 7" are right on every device, new or old. Each open order is asked for the runs that
 * hold pallets given to it; what arrives is applied as any remote row and, being old, pruning keeps it apart (see
 * State.orderRuns). A failure here never fails the pull: the numbers are then those of the days the device holds.
 */
async function bringOrderRuns() {
  // (the containment is sent as a JSON string: given an array, the library would write a Postgres array instead)
  if (!supabase) return
  const now = Date.now()
  for (const o of store.get().orders.filter((x) => !x.closed)) {
    if (now - (askedOrders.get(o.id) ?? 0) < ORDER_ASK_MS) continue
    try {
      const error = await pages(listing('act_runs', (q) => q.eq('deleted', false).contains('units', JSON.stringify([{ po: o.id }]))), (rows) => batch(() => { for (const row of rows) applyRemote('act_runs', row) }))
      if (!error) askedOrders.set(o.id, now)
    } catch { /* asked again on the next pull */ }
  }
}
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
    await bringOrderRuns()
    prune() // the days this device no longer keeps (also when the date changes while the app stays open)
    const at = Date.now()
    try { localStorage.setItem(LAST_PULL, String(at)) } catch { /* the full-storage bar says it */ }
    setStatus({ state: 'online', lastSync: at, lastError: '' })
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
/**
 * Before a device sends a run it changed, it brings down the server's version of that run and merges the two (see
 * reconcile and mergeRun): a pallet another tablet recorded a moment ago, which this device had not received yet, is
 * never written over. A run is one row with all its units, so a stale row would erase what others added. (A device
 * away for over a minute brings down everything first, so that its other rows are merged too.) A failure here changes
 * nothing: the row goes as queued and the next pull merges.
 */
async function refreshQueuedRuns() {
  if (!supabase) return
  const ids = [...new Set(outbox.items().filter((i) => i.table === 'act_runs').map((i) => String(i.row.id ?? '')).filter(Boolean))]
  if (!ids.length) return
  try {
    const { data, error } = await supabase.from('act_runs').select('*').in('id', ids)
    if (!error && Array.isArray(data)) batch(() => { for (const row of data as Row[]) applyRemote('act_runs', row) })
  } catch { /* sent as queued */ }
}
beforeFlush(async () => { if (Date.now() - status.lastSync > 75_000) await pullAll(); await refreshQueuedRuns() })
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
  // the rooms' programs on a channel of their own: while their table's SQL has not been run, only this one fails to listen
  supabase.channel('act-live-plan')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'act_plan' }, (p) => applyRemote('act_plan', p.new as Record<string, unknown>))
    .subscribe()
  window.addEventListener('online', () => { void syncNow() })
  window.addEventListener('act-resync', () => { void syncNow() })
  window.addEventListener('offline', () => setStatus({ state: 'offline' }))
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncNow() })
  setInterval(() => { void flushNow() }, 20_000)
  setInterval(() => { void pullAll() }, 60_000)
}
