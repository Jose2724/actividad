import { noSignal, passExpired, rememberedMe, renewSession, supabase } from './supabase'
import { clockNow, startClock } from './clock'
import { afterFlush, beforeFlush, flush, outbox, setMayGo, setOwnRow, type Item, type Row, type Table } from './outbox'
import { KPI_REF, ONOTE_REF, RMSG_REF, HOLD_REF, applyRemote, awayDay, batch, closeDay, codeVariants, DEPTS, firstKeptDay, keepServerPlans, markFetched, markPulled, myDept, onlyTakesOff, openDay, orderGroup, planHeardMark, planKeyOfRow, planRefKeys, prune, queueHeld, role, sameName, shareLocalLines, store, viewOnly, WO_DONE_REF, workNeeds, type Dept, type WorkOrder } from './store'
import { canDo } from './powers'
import { tr } from './i18n'
import { BUILD } from './update'

/**
 * Keeps this device and the server in step: what is queued goes up (outbox), what other tablets and the office
 * changed comes down (a pull of everything newer than the last one, plus live updates while the screen is open).
 */
export type SyncStatus = { state: 'local' | 'signedOut' | 'connecting' | 'online' | 'offline'; pending: number; lastSync: number; lastError: string; since: number; refused: number; other: number; otherRooms: string[]; pulled: boolean }
// pending = every row still waiting; since = when the oldest of them that this person may send was queued; refused =
// rows of this device's own the server refuses; other / otherRooms = rows waiting for someone else to sign in here
// (another room's, see outbox.ts) and their rooms; pulled = this device has brought the server's rows since the app
// was opened (what it holds is the plant's, not an old copy)
/** a device that has gone this long without bringing the server's rows may show an old picture of the day: the screens say so */
export const STALE_MS = 10 * 60_000
// the hour of the last pull is kept on the device: when the app opens again it knows how old its copy is
const LAST_PULL = 'act_last_pull'
const lastPull = () => { try { return Number(localStorage.getItem(LAST_PULL)) || 0 } catch { return 0 } }
let status: SyncStatus = { state: supabase ? 'connecting' : 'local', pending: outbox.size(), lastSync: supabase ? lastPull() : 0, lastError: '', since: outbox.oldest(true), refused: 0, other: 0, otherRooms: [], pulled: !supabase }
const subs = new Set<() => void>()
const setStatus = (patch: Partial<SyncStatus>) => { status = { ...status, ...patch }; subs.forEach((f) => f()) }
export const syncStore = { get: () => status, subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f) } } }
/**
 * May the person signed in take off the run or the line this queued row takes off? Jose's decision of 2026-10-18: a
 * run only with "Borrar corridas y paros" (the owner holds every power); a line only a manager, the office, someone
 * with "Corregir registros", or anyone while the managers' rule "quitar líneas libres" is on. The server keeps the run
 * or the line otherwise (migrations/018, 9 and 10), so a manager's "Borrar corrida" on a tablet with no signal that went
 * up after an operator signed in there was undone without a word. Such a row waits on the device, said apart, and
 * goes up when someone who may signs in. Only a row whose one change is taking it off (onlyTakesOff), of a run that
 * has ended: one that also ends the code goes up at once, its end with it, the server keeps the run, and the history
 * says so; one still running goes up too (see below). Who is signed in is the person the server last confirmed here
 * (App.tsx keeps it, rememberMe); while that is not known, it waits.
 */
const mayGo = (it: Item): boolean => {
  if ((it.table !== 'act_runs' && it.table !== 'act_lines') || !it.base || !onlyTakesOff(it.table, it.row, it.base)) return true
  // A code still running is not held either (review of 2026-10-18): held, it ran on the server and on every other tablet
  // for days while this one showed the line free, and the next code started here left two open on that line (what the
  // floor saw on 2026-10-16). It goes up: the server keeps it, it shows here again at once (lookBack), still running, so
  // the line can end it, and the history says the server did not let it be taken off
  if (it.table === 'act_runs' && it.row.ended_at == null) return true
  const me = rememberedMe()
  if (!me) return false
  const w = { role: me.role, admin: me.admin, powers: me.powers ?? null }
  return it.table === 'act_runs' ? canDo(w, 'del') : me.role === 'mgr' || me.role === 'office' || canDo(w, 'fix') || store.get().lineRules.remove
}
setMayGo(mayGo)
/**
 * the rows waiting for someone else (see outbox.ts) and the rooms they are of, as the screen says them. A run or a line
 * waiting for someone who may take it off (mayGo) names no room: someone of that room would not be enough
 */
const others = () => { const rows = outbox.otherRoom(); return { other: rows.length, otherRooms: [...new Set(rows.filter(mayGo).map((i) => String(i.row.dept ?? '')).filter((d) => (DEPTS as string[]).includes(d)))].sort() } }
outbox.subscribe(() => setStatus({ pending: outbox.size(), since: outbox.oldest(true), refused: outbox.refused().length, ...others() }))
/**
 * Which rows are this person's own to write: an operator's, those of their room; a manager's or the office's, every
 * room's. A row with no room (the start of the day, products) and an operator's own settings (the plant calendar, the
 * goals: kept by key, not by room) count as their own too: when the server refuses one, it waits with the red bar
 * instead of passing for another room's (an operator given the calendar lost the week they set, audit 2026-10-17 R2).
 * A device of somebody who only looks ("Solo ver") writes nothing of its own: anything waiting on it is somebody
 * else's. What is not the person's own waits for someone who may send it (see outbox.ts).
 */
setOwnRow((row) => {
  if (viewOnly.get()) return false
  if (role.get() !== 'op') return true
  const dept = String(row.dept ?? '')
  return !dept || dept === myDept.get() || !(DEPTS as string[]).includes(dept)
}, () => role.get() + ':' + myDept.get() + (viewOnly.get() ? ':ver' : '') + ':' + powersNow())
/** the powers of the person signed in, as the server last said them: a power given or taken tries the waiting rows again */
function powersNow() { const me = rememberedMe(); return !me ? '?' : me.admin ? 'admin' : me.powers ? me.powers.join(',') : 'rol' }
/** the page is asked to check with the server who is signed in (a session it no longer takes): at most once every two minutes */
let askedWho = 0
const askWho = () => { if (Date.now() - askedWho < 120_000) return; askedWho = Date.now(); try { window.dispatchEvent(new Event('act-verify')) } catch { /* no window */ } }

/**
 * What "Salir" asks before leaving. A stray tap must not leave a tablet at the sign-in screen, and the question says
 * what leaving costs right now: records still on their way to the server, or no signal to come back in with.
 * `online` = what the device itself says about its network (the app may not have noticed yet).
 */
export function leaveAsk(st: Pick<SyncStatus, 'state' | 'pending'> & Partial<Pick<SyncStatus, 'refused' | 'other'>>, online = true): { title: string; text: string; yes: string; danger: boolean } {
  if (st.state === 'local') return { title: tr('¿Cambiar de usuario?'), text: tr('Vuelves a la pantalla de entrada. Lo registrado se queda guardado en este aparato y lo que está corriendo sigue contando.'), yes: tr('Cambiar'), danger: false }
  const offline = st.state === 'offline' || !online
  const n = st.pending
  const waiting = n === 1 ? tr('Hay 1 registro que no ha llegado al servidor') : tr('Hay {0} registros que no han llegado al servidor', n)
  if (n > 0 && st.state === 'signedOut') return { title: tr('Todavía hay registros sin subir'), text: tr('{0} porque la sesión se cerró. Para que suban, vuelve a entrar en este aparato con tu usuario.', waiting), yes: tr('Salir'), danger: false }
  // Everything waiting is what the server will not take from this session (refused, or another room's): waiting for
  // "Sincronizado" would be waiting for ever, and leaving loses nothing (it stays here and goes up when someone who may
  // send it signs in). "Entrar de nuevo" on the red bar asks this same question (2026-10-17)
  if (n > 0 && !offline && (st.refused ?? 0) + (st.other ?? 0) >= n) return { title: tr('Todavía hay registros sin subir'), text: n === 1 ? tr('{0}: con esta sesión el servidor no lo acepta. Se queda guardado en este aparato y sube cuando entre aquí alguien que pueda subirlo. Si es tuyo, vuelve a entrar con tu usuario; si sigue, avisa al manager.', waiting) : tr('{0}: con esta sesión el servidor no los acepta. Se quedan guardados en este aparato y suben cuando entre aquí alguien que pueda subirlos. Si son tuyos, vuelve a entrar con tu usuario; si sigue, avisa al manager.', waiting), yes: tr('Salir'), danger: false }
  if (n > 0) return { title: tr('Todavía hay registros sin subir'), text: waiting + (offline ? ' ' + tr('y ahora no hay señal. No salgas hasta que vuelva la señal y arriba diga "Sincronizado".') : tr('. Espera a que arriba diga "Sincronizado" y sal después.')), yes: tr('Salir de todos modos'), danger: true }
  if (offline) return { title: tr('¿Salir sin señal?'), text: tr('Ahora no hay señal. Si sales, no vas a poder entrar otra vez hasta que vuelva el WiFi, y mientras tanto no se puede registrar nada en este aparato.'), yes: tr('Salir de todos modos'), danger: true }
  return { title: tr('¿Salir de E.R. - Ops Summary?'), text: tr('Para volver a entrar hay que poner el usuario y el PIN. Lo que está corriendo sigue contando.'), yes: tr('Salir'), danger: false }
}

// (the production orders last, 2026-10-19: while Jose has not run 020 their table is missing, and the pull goes on quietly)
const TABLES: Table[] = ['act_lines', 'act_runs', 'act_stops', 'act_products', 'act_schedule', 'act_changes', 'act_targets', 'act_plan', 'act_work_orders']
const SINCE = 'act_since2' // the cursor is the server's synced_at (see migrations/003), not the tablets' clocks
const PULLED_WITH = 'act_pulled_with' // the version of the app and whose rows last pulled everything: either one new pulls everything again
const pulledWith = () => { try { return localStorage.getItem(PULLED_WITH) || '' } catch { return '' } }
/**
 * Whose rows the cursor stands for: an operator's device brings only their room (see scoped), every other one the
 * whole plant. When it changes on a device (a manager or the office signs in on an operator's tablet, an operator of
 * another room, a manager moves the operator), the rows of the rooms it did not bring before are older than the cursor
 * and a pull of what changed since would never bring them: lines that looked free while they ran a code, and "Set up
 * en todas las líneas" wrote a false Set up on one (audit 2026-10-17, S3). So it brings everything once, as after a new version
 */
const pulledFor = () => (BUILD || 'dev') + '|' + (role.get() === 'op' ? 'op:' + myDept.get() : 'all')
const since = () => { try { return localStorage.getItem(SINCE) || '' } catch { return '' } }
const setSince = (v: string) => { try { localStorage.setItem(SINCE, v) } catch { /* full */ } }

/** a few seconds of overlap on every pull: a row committed a moment before the last one seen is never skipped (applying a row twice changes nothing) */
const OVERLAP_MS = 10_000
/**
 * How long the pull that set the cursor took (ms), and so how much further back the next one reaches. The eight
 * tables are read one after the other, and the cursor is the newest row of any of them: a row saved in a table already
 * read, while a later one was still being read, is older than that cursor. A pull takes a second or two, but a weak
 * WiFi (each failed read is tried again after 1, 2 and 4 s) or the full pull after a new version can take a minute;
 * a code ended meanwhile then stayed open on that tablet with "Sincronizado" (audit 2026-10-17, S5). A duration, not
 * an hour of the tablet's clock, which may be off. Kept apart from the cursor, so an older version still reads that
 */
const SPAN = 'act_since_span'
const span = () => { try { return Math.max(0, Number(localStorage.getItem(SPAN)) || 0) } catch { return 0 } }
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
const ORDER: Record<Table, string[]> = { act_lines: ['id'], act_runs: ['id'], act_stops: ['id'], act_changes: ['id'], act_products: ['code'], act_schedule: ['date', 'code'], act_targets: ['dept'], act_plan: ['date', 'dept', 'code', 'lot'], act_work_orders: ['id'] }
/**
 * An operator's device asks only for its own room (the server would give it nothing else anyway, see
 * migrations/015): the rooms' tables by their room, the history by its room or with none (the start of the day).
 * A manager's, the office's and a viewer's ask for every room.
 */
const scoped = (t: Table, q: Q): Q => {
  const dept = myDept.get()
  if (role.get() !== 'op' || !dept) return q
  if (t === 'act_lines' || t === 'act_runs' || t === 'act_stops' || t === 'act_plan' || t === 'act_work_orders') return q.eq('dept', dept)
  if (t === 'act_changes') return q.or(`dept.eq.${dept},dept.is.null`)
  return q
}
const listing = (t: Table, narrow: (q: Q) => Q) => (from: number, to: number) => {
  let q: Q = scoped(t, narrow(supabase!.from(t).select('*'))).order('synced_at', { ascending: true })
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
/**
 * The closed accounts of finished production orders (see "the account of a finished order" in store.ts) are history
 * lines of their own, dated when the order finished: a device's first pull brings only the last two weeks of history,
 * so on a pull of everything they are asked for apart. A failure here never fails the pull: without them the device
 * brings those orders' records instead (fetchWorkRuns)
 */
/** the Daily KPI Report's records (2026-10-22): the plan and who sees it are older than the days kept, so asked apart */
async function bringKpi() {
  // (and Packing's comments on the orders, 2026-10-22: an order lasts longer than the days kept)
  try { await pages(listing('act_changes', (q) => q.in('ref_table', [KPI_REF, ONOTE_REF, RMSG_REF, HOLD_REF])), (rows) => batch(() => { for (const row of rows) applyRemote('act_changes', row) })) } catch { /* the next full pull tries again */ }
}
async function bringSeals() {
  try { await pages(listing('act_changes', (q) => q.eq('ref_table', WO_DONE_REF)), (rows) => batch(() => { for (const row of rows) applyRemote('act_changes', row) })) } catch { /* the records are brought instead */ }
}
/**
 * what a production order is worked out with, older than the days this device keeps: the runs of its code and room, and
 * the programs of it, from a day to the first day the device keeps. The runs taken off too: a run of those days that
 * this device keeps for an order (State.orderRuns) and that was deleted on the server while it was away is only
 * dropped by its deleted row (applyRemote). Listed without them, a device whose next pull was a whole one (a new
 * version) kept counting it, and could close the order's account with it and share it (review of 2026-10-20)
 */
const oldRuns = (dept: Dept, code: string, from: string, until: string) => listing('act_runs', (q) => q.eq('dept', dept).gte('date', from).lt('date', until).in('code', codeVariants(code)))
const oldPlans = (dept: Dept, code: string, from: string, until: string) => listing('act_plan', (q) => q.eq('dept', dept).gte('date', from).lt('date', until).in('code', codeVariants(code)))
/**
 * A production order counts everything its room made of its code since its start day, and a device keeps 14 days
 * (Jose and the office, 2026-10-19: an order of 1000 mezclas at 80 a day lasts about 13). For each order still worked
 * out from its records (see workNeeds), the days older than the device keeps are brought once per page opened: its
 * runs and its programs, applied as any row from the server, and kept apart by pruning (State.orderRuns). Until they
 * are here its numbers say they are incomplete. A failure never fails the pull: it is asked again on the next one.
 * only = these queues alone (a screen that shows an old order). Returns whether everything asked for came
 */
async function fetchWorkRuns(only?: string[]): Promise<boolean> {
  if (!supabase) return true
  let ok = true
  for (const need of workNeeds(store.get())) {
    const until = firstKeptDay()
    if ((only && !only.includes(need.q)) || need.from >= until || queueHeld(need.q, need.from)) continue
    try {
      const e1 = await pages(oldRuns(need.dept, need.code, need.from, until), (rows) => batch(() => { for (const row of rows) applyRemote('act_runs', row) }))
      if (e1) { ok = false; continue }
      const e2 = await pages(oldPlans(need.dept, need.code, need.from, until), (rows) => batch(() => { for (const row of rows) applyRemote('act_plan', row) }))
      if (e2 && !missing(e2.code)) { ok = false; continue }
      markFetched(need.q, need.from)
    } catch { ok = false }
  }
  return ok
}
/** the old records of the production orders still worked out from them (all, or the queues named), brought now; then the device keeps what it needs of them */
export async function bringWorkOrderRuns(only?: string[]): Promise<boolean> {
  const ok = await fetchWorkRuns(only)
  prune()
  return ok
}
/**
 * Everything an order's numbers are made of, from the server: the runs and programs of its group of orders (see
 * orderGroup) from its first day to the first day this device keeps, and the history lines of the order and of the
 * programs that name it. The detail of an old order works its numbers out again with them (stateWith(s, rows, unseal,
 * true)). null = the server could not be asked now
 */
export async function loadOrderRows(o: WorkOrder): Promise<{ runs: Row[]; plans: Row[]; changes: Row[]; unseal: string[]; from: string } | null> {
  if (!supabase) return null
  const g = orderGroup(store.get(), o), until = firstKeptDay(), out = { runs: [] as Row[], plans: [] as Row[], changes: [] as Row[], unseal: g.ids, from: g.from }
  try {
    if (g.from < until) {
      if (await pages(oldRuns(o.dept, o.code, g.from, until), (rows) => { out.runs.push(...rows) })) return null
      const e = await pages(oldPlans(o.dept, o.code, g.from, until), (rows) => { out.plans.push(...rows) })
      if (e && !missing(e.code)) return null
    }
    // (each program by the keys its history lines carry: its code and lot, and its code alone from before 2026-10-20)
    const keys = new Set([o.id, ...store.get().plans.filter((p) => p.orderId === o.id).flatMap(planRefKeys), ...out.plans.filter((r) => r.order_id === o.id).flatMap((r) => planRefKeys({ date: String(r.date ?? '').slice(0, 10), dept: r.dept as Dept, code: String(r.code ?? ''), lot: String(r.lot ?? '') }))])
    const list = [...keys]
    for (let k = 0; k < list.length; k += 100) if (await pages(listing('act_changes', (q) => q.in('ref_key', list.slice(k, k + 100))), (rows) => { out.changes.push(...rows) })) return null
    return out
  } catch { return null }
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
    // A device brings everything again, as on its first day, instead of only what changed since: when it has no lines
    // (the lines are shared and never all gone: it lost its copy), once after every new version of the app, and when
    // whose rows it brings changes (see pulledFor). On 2026-10-17 a version that could not read what was saved left
    // devices with a few recent rows and "Sincronizado": a device that kept a cursor had no way back on its own.
    // (Whose rows: as they are when the pull starts, so a sign-in in the middle makes the next pull a whole one)
    const scope = pulledFor()
    const cursor = store.get().lines.length && pulledWith() === scope ? since() : ''
    const from = cursor ? iso(Date.parse(cursor) - OVERLAP_MS - span()) : ''
    const first: Partial<Record<Table, (q: Q) => Q>> = cursor ? {} : firstPull(firstKeptDay())
    let newest = cursor
    const began = performance.now(), beganAt = Date.now()
    // A whole pull brings every program of the days this device keeps: what it holds of them that the server does not
    // have is let go after (keepServerPlans; 2026-10-20, the program by lot). What waits in the queue now, and what is
    // changed here while the pull runs, stays. The rooms are the ones asked for (see scoped)
    const plansSeen = cursor ? null : new Set<string>(), plansFrom = firstKeptDay(), plansSince = clockNow(), plansHeard = planHeardMark()
    const plansWaiting = new Set(outbox.items().filter((i) => i.table === 'act_plan').map((i) => i.key))
    for (const t of TABLES) {
      const narrow = (q: Q) => { const x = first[t] ? first[t]!(q) : q; return from ? x.gt('synced_at', from) : x }
      const error = await pages(listing(t, narrow), (rows) => batch(() => {
        for (const row of rows) { applyRemote(t, row); if (plansSeen && t === 'act_plan') plansSeen.add(planKeyOfRow(row)); const u = String(row.synced_at ?? ''); if (u && (!newest || Date.parse(u) > Date.parse(newest))) newest = u }
      }))
      if (error && missing(error.code)) continue
      if (error) { setStatus(failed(error.message)); return false }
      // (only when whose rows were asked for did not change while they came: a sign-in in the middle could have narrowed
      // or widened the rooms, and a room not asked for must not lose its programs)
      if (plansSeen && t === 'act_plan' && pulledFor() === scope) keepServerPlans(plansSeen, plansFrom, role.get() === 'op' && myDept.get() ? [myDept.get() as Dept] : null, plansWaiting, plansSince, plansHeard)
    }
    // (the longer of the two watches: a tablet that sleeps in the middle of a pull may stop its stopwatch, and a clock
    // moved forward only makes the next pull read a little more again)
    if (newest) { setSince(newest); try { localStorage.setItem(SPAN, String(Math.round(Math.max(performance.now() - began, Date.now() - beganAt)))) } catch { /* full */ } }
    try { localStorage.setItem(PULLED_WITH, scope) } catch { /* private */ }
    if (!cursor) { await bringSeals(); await bringKpi() }
    await bringOrderRuns()
    await fetchWorkRuns()
    // the plant is on this device now: the accounts of finished orders can be closed with it (see prune in store.ts)
    markPulled()
    prune() // the days this device no longer keeps (also when the date changes while the app stays open)
    const at = Date.now()
    try { localStorage.setItem(LAST_PULL, String(at)) } catch { /* the full-storage bar says it */ }
    setStatus({ state: 'online', lastSync: at, lastError: '', pulled: true })
    return true
  } catch (e) {
    setStatus(failed(String(e)))
    return false
  }
}
/**
 * Before a line is added or renamed, the server is asked which lines its room has now: a line is the plant's, not a
 * tablet's. On 2026-10-17 a tablet that had opened without its room's lines let somebody add "Línea 2" again in
 * Packing. Not until this device has brought the plant since it was opened, and not without the server: adding a line
 * can wait, a copy of a line cannot be undone without help. What the server says is kept on the device at once.
 * '' = the name is free; 'wait' = still bringing the plant; 'offline' = the server cannot be asked; 'taken' = another
 * line of the room has it. (The server settles it too, see migrations/017: a copy that gets through is renamed "(2)".)
 */
export async function checkLineName(dept: Dept, name: string, selfId?: string): Promise<'' | 'wait' | 'offline' | 'taken'> {
  if (!supabase) return ''
  if (!status.pulled) return 'wait'
  try {
    const { data, error } = await supabase.from('act_lines').select('*').eq('dept', dept).eq('deleted', false)
    if (error || !Array.isArray(data)) return 'offline'
    batch(() => { for (const row of data as Row[]) applyRemote('act_lines', row) })
    return (data as Row[]).some((r) => String(r.id) !== selfId && sameName(String(r.name ?? ''), name)) ? 'taken' : ''
  } catch { return 'offline' }
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
 * Before a device sends a run, a stop or a line it changed, it brings down the server's version of that row and merges
 * the two (see reconcile): a pallet another tablet recorded a moment ago, which this device had not received yet, is
 * never written over; nor a stop a manager deleted or gave another cause, or a line renamed (a stop or a line went up
 * as this device last saw it, and brought those back: audit 2026-10-17, S4). Each row goes up whole, so a stale one
 * erases what others did. (A device away for over a minute brings down everything first, so its other rows are merged
 * too.) Runs first: hearing a code start can end a Set up, which queues a stop. A stop or a line with no version of
 * the server to start from is not asked for: merged with nothing in common, the server's copy would stand and the
 * change of this device would be lost. A hundred ids per question, so a tablet back after a long time offline asks
 * short ones. Returns the tables whose rows must wait for the next pass: the runs, when the server could not say what
 * it has of them (sent blind, a run would write over the pallets of others), and the program and the settings (see
 * BY_TIME). A stop or a line goes as queued then
 */
const REFRESHED: Table[] = ['act_runs', 'act_stops', 'act_lines']
/** the tables kept by the last change, whose queued rows are brought from the server before they go up (see below) */
const BY_TIME: Table[] = ['act_plan', 'act_targets', 'act_work_orders']
async function refreshQueued(): Promise<Table[]> {
  if (!supabase) return []
  const held: Table[] = []
  for (const t of REFRESHED) {
    const ids = [...new Set(outbox.items().filter((i) => i.table === t && (t === 'act_runs' || !!i.base)).map((i) => String(i.row.id ?? '')).filter(Boolean))]
    for (let k = 0; k < ids.length; k += 100) {
      try {
        const { data, error } = await supabase.from(t).select('*').in('id', ids.slice(k, k + 100))
        if (error || !Array.isArray(data)) throw error
        batch(() => { for (const row of data as Row[]) applyRemote(t, row) })
      } catch {
        if (t === 'act_runs') held.push(t)
        break
      }
    }
  }
  // A room's program and what is set for everybody go up whole, the last change standing (see keepNewer in store.ts):
  // one that waited here (days, for someone who may send it: audit S2) must not write over one made after it on the
  // server. So their server version is brought first, whatever this device heard meanwhile (an operator's tablet does
  // not even hear another room's program), and the newer one stands (Jose's decision of 2026-10-18). When the server
  // cannot say, they wait for the next pass: sent blind, one could write over a newer change
  for (const t of BY_TIME) {
    const rows = outbox.items().filter((i) => i.table === t).map((i) => i.row)
    for (let k = 0; k < rows.length; k += 100) {
      const part = rows.slice(k, k + 100), of = (c: string) => [...new Set(part.map((r) => String(r[c] ?? '')))]
      try {
        const q = supabase.from(t).select('*')
        const { data, error } = await (t === 'act_targets' ? q.in('dept', of('dept')) : t === 'act_work_orders' ? q.in('id', of('id')) : q.in('date', of('date')).in('dept', of('dept')))
        if (error && missing(error.code)) break // the table's SQL has not been run: the pass says so when it sends
        if (error || !Array.isArray(data)) throw error
        batch(() => { for (const row of data as Row[]) applyRemote(t, row) })
      } catch {
        held.push(t)
        break
      }
    }
  }
  return held
}
/**
 * The runs and lines a pass sent taken off are asked for again at once: the server keeps one taken off by somebody it
 * does not let (Jose's decision of 2026-10-18), and this device, which hid it, shows it again now (reconcile, in
 * store.ts), not a minute later with the next pull (the live notice of it may never come). A hundred ids per question
 */
async function lookBack(rows: { table: Table; key: string }[]) {
  if (!supabase) return
  for (const t of ['act_runs', 'act_lines'] as Table[]) {
    const ids = [...new Set(rows.filter((x) => x.table === t).map((x) => x.key))]
    for (let k = 0; k < ids.length; k += 100) {
      try {
        const { data, error } = await supabase.from(t).select('*').in('id', ids.slice(k, k + 100))
        if (!error && Array.isArray(data)) batch(() => { for (const row of data as Row[]) applyRemote(t, row) })
      } catch { /* the next pull brings it */ }
    }
  }
}
// a row is not sent without having brought the server's version of it first (see refreshQueued)
beforeFlush(async () => { if (Date.now() - status.lastSync > 75_000) await pullAll(); return refreshQueued() })
/** down first, then up: what is queued is merged with what the server has before it is sent */
export const syncNow = async () => { await pullAll(); await flushNow() }

/**
 * How a pass of the queue ended, whoever started it: the dot follows. A pass with nothing to send asked the server
 * nothing, so it knows nothing about the connection and the dot stays as the last pull left it. (It used to turn
 * "Sincronizado" on its own, also with the WiFi off.)
 */
afterFlush((r) => {
  if (r.tookOff?.length) void lookBack(r.tookOff)
  const more = { pending: r.left, since: outbox.oldest(true), refused: r.refused ?? 0, ...others() }
  if (r.error === 'signedOut') { setStatus({ ...more, state: 'signedOut', lastError: '' }); askWho() }
  else if (r.error === 'offline') setStatus({ ...more, state: 'offline', lastError: '' })
  else if (r.error) { setStatus({ ...more, ...failed(r.error) }); if (r.refused) askWho() }
  else if (r.sent > 0) setStatus({ ...more, state: 'online', lastError: '' })
  else setStatus(more)
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
  // and the production orders (2026-10-19): until Jose runs 020, only this one fails to listen
  supabase.channel('act-live-wo')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'act_work_orders' }, (p) => applyRemote('act_work_orders', p.new as Record<string, unknown>))
    .subscribe()
  window.addEventListener('online', () => { void syncNow() })
  window.addEventListener('act-resync', () => { void syncNow() })
  window.addEventListener('offline', () => setStatus({ state: 'offline' }))
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncNow() })
  setInterval(() => { void flushNow() }, 20_000)
  setInterval(() => { void pullAll() }, 60_000)
}
