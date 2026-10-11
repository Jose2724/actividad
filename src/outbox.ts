import { storageFull } from './storage'
import { noSignal, supabase } from './supabase'

/**
 * Every change is saved on the device first and queued here; the queue is sent whenever there is signal. One entry
 * per row (a later change to the same row replaces the earlier one), so a weak WiFi never duplicates anything.
 * Nothing leaves the queue unless the server took it or will never take it from this person (a row of another room).
 */
export type Table = 'act_lines' | 'act_runs' | 'act_stops' | 'act_products' | 'act_schedule' | 'act_changes' | 'act_targets'
export type Row = Record<string, unknown>
/**
 * a queued change: the row as it should be on the server and, for rows another device may also be changing, what the
 * server had when this device started changing it (so what the other device did can be merged in, not overwritten)
 */
export type Item = { table: Table; key: string; row: Row; base?: Row | null }
const KEY = 'act_outbox'

/** the queue when it could not be written to the device (its storage was full): kept in memory, so it still goes up while the app stays open */
let unsaved: Item[] | null = null
function read(): Item[] { if (unsaved) return unsaved; try { return JSON.parse(localStorage.getItem(KEY) || '[]') as Item[] } catch { return [] } }
function write(items: Item[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); unsaved = null }
  catch { unsaved = items; storageFull.set(true) }
}

const listeners = new Set<() => void>()
export const outbox = {
  size: () => read().length,
  items: () => read(),
  /** tries again to write a queue that is only in memory (the device has made room) */
  resave() { if (unsaved) write(unsaved) },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
}
const emit = () => listeners.forEach((l) => l())
const is = (table: Table, key: string) => (i: Item) => i.table === table && i.key === key

/** queues a row; `base` (what the server last had) is kept from the first change still waiting */
export function push(table: Table, key: string, row: Row, base?: Row | null) {
  if (!supabase) return
  const items = read(), prev = items.find(is(table, key))
  write([...items.filter((i) => !is(table, key)(i)), { table, key, row, base: prev ? prev.base : base }]); emit()
  void flush()
}
/** the change of this row still waiting to go up, if any */
export const queued = (table: Table, key: string) => (supabase ? read().find(is(table, key)) : undefined)
/** what is queued for this row now starts from `base`, the version the server just showed */
export function rebase(table: Table, key: string, row: Row, base: Row) {
  if (!supabase) return
  write([...read().filter((i) => !is(table, key)(i)), { table, key, row, base }]); emit()
  void flush()
}
/** the server already has everything this queued change wanted */
export function drop(table: Table, key: string) { write(read().filter((i) => !is(table, key)(i))); emit() }

/** rows that went up in the last minute, with the version they started from: a late row from another device can still be merged properly */
const recent = new Map<string, { base: Row | null | undefined; row: Row; at: number }>()
export const justSent = (table: Table, key: string) => { const r = recent.get(table + '|' + key); return r && Date.now() - r.at < 60_000 ? r : undefined }
/** the server took this row: it leaves the queue; a newer change of the same row queued meanwhile now starts from it */
export function markSent(it: Item) {
  if (recent.size > 300) for (const [k, r] of recent) if (Date.now() - r.at > 60_000) recent.delete(k)
  recent.set(it.table + '|' + it.key, { base: it.base, row: it.row, at: Date.now() })
  write(read().flatMap((i) => (!is(it.table, it.key)(i) ? [i] : JSON.stringify(i.row) === JSON.stringify(it.row) ? [] : [{ ...i, base: it.row }])))
  emit()
}

let before: (() => Promise<unknown>) | null = null
/** something to do before a pass (sync.ts brings down what changed while this device was away, so the queue is merged with it first) */
export const beforeFlush = (f: () => Promise<unknown>) => { before = f }

/** how the server answered a row it did not take */
export function verdict(code: string, message: string): 'notReady' | 'refused' | 'bad' | 'later' {
  // the table or a column is not there yet (its SQL still to run), or the table lacks its grants: the rows wait
  if (['42P01', 'PGRST205', 'PGRST204', '42703'].includes(code)) return 'notReady'
  if (code === '42501') return /row-level security/i.test(message) ? 'refused' : 'notReady'
  // a row the database rejects as it is (a missing value, a broken reference): kept, and the rest goes on
  if (['22P02', '23502', '23503', '23514'].includes(code)) return 'bad'
  return 'later' // no signal, an expired session, a server hiccup: tried again later
}

let flushing = false
export type FlushResult = { sent: number; left: number; error?: string }
/** sends what is queued, oldest first; a failure of the connection stops the pass (it is retried later) */
export async function flush(): Promise<FlushResult> {
  if (!supabase || flushing) return { sent: 0, left: read().length }
  flushing = true
  let sent = 0, error: string | undefined
  try {
    const { data: { session }, error: authError } = await supabase.auth.getSession()
    if (!session) return { sent: 0, left: read().length, error: noSignal(authError) ? 'offline' : 'signedOut' }
    if (before && read().length) await before()
    const waiting = new Set<string>() // tables the server does not have ready yet
    const skipped = new Set<string>() // rows the database rejects as they are: they stay queued, the rest goes on
    while (true) {
      const it = read().find((i) => !waiting.has(i.table) && !skipped.has(i.table + '|' + i.key))
      if (!it) break
      const { error: e } = await supabase.from(it.table).upsert(it.row, { onConflict: it.table === 'act_schedule' ? 'date,code' : it.table === 'act_products' ? 'code' : it.table === 'act_targets' ? 'dept' : 'id' })
      if (e) {
        error = (e.code ? e.code + ' ' : '') + e.message + (e.details ? ' · ' + e.details : '') + ' [' + it.table + ']'
        console.warn('actividad sync', it.table, e)
        const v = verdict(String(e.code ?? ''), e.message ?? '')
        if (v === 'notReady') { waiting.add(it.table); error = 'Falta ejecutar en Supabase el SQL de ' + it.table; continue }
        // a row of a room this person may not write will never be taken: it is dropped so it does not sit in the queue for ever
        if (v === 'refused') { drop(it.table, it.key); error += ' · descartado'; continue }
        if (v === 'bad') { skipped.add(it.table + '|' + it.key); continue }
        break
      }
      markSent(it)
      sent++
    }
  } catch (e) {
    error = String(e)
  } finally { flushing = false }
  return { sent, left: read().length, error }
}
