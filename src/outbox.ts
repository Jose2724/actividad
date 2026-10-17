import { storageFull } from './storage'
import { noSignal, supabase } from './supabase'
import { tr } from './i18n'

/**
 * Every change is saved on the device first and queued here; the queue is sent whenever there is signal. One entry
 * per row (a later change to the same row replaces the earlier one), so a weak WiFi never duplicates anything.
 * Nothing leaves the queue unless the server took it or will never take it from this person (a row of another room).
 */
export type Table = 'act_lines' | 'act_runs' | 'act_stops' | 'act_products' | 'act_schedule' | 'act_changes' | 'act_targets' | 'act_plan'
export type Row = Record<string, unknown>
/**
 * a queued change: the row as it should be on the server and, for rows another device may also be changing, what the
 * server had when this device started changing it (so what the other device did can be merged in, not overwritten)
 */
export type Item = { table: Table; key: string; row: Row; base?: Row | null; at?: number } // at = when it was first queued
const KEY = 'act_outbox'

/** the queue when it could not be written to the device (its storage was full): kept in memory, so it still goes up while the app stays open */
let unsaved: Item[] | null = null
function read(): Item[] { if (unsaved) return unsaved; try { return JSON.parse(localStorage.getItem(KEY) || '[]') as Item[] } catch { return [] } }
function write(items: Item[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); unsaved = null }
  catch { unsaved = items; storageFull.set(true) }
}

const listeners = new Set<() => void>()
/**
 * Rows of this device's own room (or of any room, for a manager) that the server refused for lack of permission: the
 * person signed in is no longer who the server thinks (the account closed, the PIN changed, the room changed). Such a
 * row is never dropped: it waits, and the screen says so until someone signs in again (see sync.ts, App.tsx).
 */
const refusedOwn = new Set<string>()
let ownRow: (row: Row) => boolean = () => true
/** says which rows are this device's own to write (sync.ts: the person's room, or every room for a manager) */
export const setOwnRow = (f: (row: Row) => boolean) => { ownRow = f }
export const outbox = {
  size: () => read().length,
  items: () => read(),
  /** when the oldest row still waiting was queued (0 = nothing waits) */
  oldest: () => read().reduce((t, i) => (i.at && (!t || i.at < t) ? i.at : t), 0),
  /** the rows of this device's own that the server refuses */
  refused: () => [...refusedOwn],
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
  write([...items.filter((i) => !is(table, key)(i)), { table, key, row, base: prev ? prev.base : base, at: prev?.at ?? Date.now() }]); emit()
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
  refusedOwn.delete(it.table + '|' + it.key)
  emit()
}

let before: (() => Promise<Table[] | unknown>) | null = null
/** something to do before a pass (sync.ts brings down what changed while this device was away, so the queue is merged with it first); it may name tables whose rows must wait for the next pass */
export const beforeFlush = (f: () => Promise<Table[] | unknown>) => { before = f }

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
export type FlushResult = { sent: number; left: number; error?: string; refused?: number }
let after: ((r: FlushResult) => void) | null = null
/**
 * told how every pass ended, whoever started it (a new record sends itself at once, without anyone waiting for the
 * answer): sync.ts keeps the dot at the top by it
 */
export const afterFlush = (f: (r: FlushResult) => void) => { after = f }
/** sends what is queued, oldest first; a failure of the connection stops the pass (it is retried later) */
export async function flush(): Promise<FlushResult> {
  if (!supabase || flushing) return { sent: 0, left: read().length, refused: refusedOwn.size }
  const r = await pass()
  try { after?.(r) } catch { /* what the dot says is not worth a failed pass */ }
  return r
}
async function pass(): Promise<FlushResult> {
  if (!supabase) return { sent: 0, left: read().length, refused: refusedOwn.size }
  flushing = true
  let sent = 0, error: string | undefined
  try {
    const { data: { session }, error: authError } = await supabase.auth.getSession()
    if (!session) return { sent: 0, left: read().length, error: noSignal(authError) ? 'offline' : 'signedOut', refused: refusedOwn.size }
    const held = before && read().length ? await before() : null
    const waiting = new Set<string>(Array.isArray(held) ? (held as string[]) : []) // tables the server does not have ready yet, or whose rows must wait for the next pass
    const skipped = new Set<string>() // rows the database rejects as they are: they stay queued, the rest goes on
    while (true) {
      const it = read().find((i) => !waiting.has(i.table) && !skipped.has(i.table + '|' + i.key))
      if (!it) break
      const { error: e } = await supabase.from(it.table).upsert(it.row, { onConflict: it.table === 'act_schedule' ? 'date,code' : it.table === 'act_plan' ? 'date,dept,code' : it.table === 'act_products' ? 'code' : it.table === 'act_targets' ? 'dept' : 'id' })
      if (e) {
        error = (e.code ? e.code + ' ' : '') + e.message + (e.details ? ' · ' + e.details : '') + ' [' + it.table + ']'
        console.warn('actividad sync', it.table, e)
        const v = verdict(String(e.code ?? ''), e.message ?? '')
        if (v === 'notReady') { waiting.add(it.table); error = tr('Falta ejecutar en Supabase el SQL de {0}', it.table); continue }
        if (v === 'refused') {
          // a row of this device's own that the server refuses: the person signed in is no longer who the server
          // thinks. It waits (nothing recorded is lost) and the screen says so; a row of another room is dropped
          if (ownRow(it.row)) { refusedOwn.add(it.table + '|' + it.key); skipped.add(it.table + '|' + it.key); error = tr('El servidor no acepta lo que registra esta sesión: sin permiso para {0}', String(it.row.dept ?? it.table)); continue }
          drop(it.table, it.key); error += ' ' + tr('· descartado'); continue
        }
        if (v === 'bad') { skipped.add(it.table + '|' + it.key); continue }
        break
      }
      markSent(it)
      sent++
    }
  } catch (e) {
    error = String(e)
  } finally { flushing = false }
  return { sent, left: read().length, error, refused: refusedOwn.size }
}
