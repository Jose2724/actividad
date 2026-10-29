import { storageFull } from './storage'
import { missingColumn, noSignal, supabase } from './supabase'
import { tr } from './i18n'

/**
 * Every change is saved on the device first and queued here; the queue is sent whenever there is signal. One entry
 * per row (a later change to the same row replaces the earlier one), so a weak WiFi never duplicates anything.
 * Nothing leaves the queue unless the server took it, or already has everything it wanted. A row the server will not
 * take from the person signed in now (another room's) waits on the device for someone who may send it.
 */
export type Table = 'act_lines' | 'act_runs' | 'act_stops' | 'act_products' | 'act_schedule' | 'act_changes' | 'act_targets' | 'act_plan' | 'act_work_orders'
export type Row = Record<string, unknown>
/**
 * a queued change: the row as it should be on the server and, for rows another device may also be changing, what the
 * server had when this device started changing it (so what the other device did can be merged in, not overwritten)
 */
export type Item = { table: Table; key: string; row: Row; base?: Row | null; at?: number; tried?: Row[] } // at = when it was first queued
// tried = the last versions of this row sent without an answer yet: the server may hold any of them (see pass and
// reconcile in store.ts). Items saved by older versions have none and behave as before
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
/**
 * Rows the server refuses to the person signed in now that are not theirs to write: another room's, recorded on this
 * tablet by someone else (an operator who left with rows still waiting, a manager's corrections of several rooms), or
 * before a manager moved this person to another room. Until 2026-10-17 such a row was thrown away at once, and real
 * records never reached the server (audit S2). Now it waits on the device, the screen says so, and it goes up as soon
 * as someone who may write it signs in here (someone of that room, a manager). It is not sent again while the same
 * person stays (a refused request every 20 s on a weak WiFi helps nobody): only when the person, their role or their
 * room changes, or every ten minutes (a permission given back on the server). `who` = for whom it was refused. A row
 * this person may not send at all waits here too, never sent (see mayGo below, Jose's decision of 2026-10-18).
 */
const parked = new Map<string, { who: string; at: number }>()
const PARK_MS = 10 * 60_000
let ownRow: (row: Row) => boolean = () => true
let whoNow: () => string = () => ''
/**
 * says which rows are this device's own to write (sync.ts: the person's room, or every room for a manager) and, with
 * `who`, what tells the person signed in apart (their role and room): a row parked for one person is tried for the next
 */
export const setOwnRow = (f: (row: Row) => boolean, who?: () => string) => { ownRow = f; if (who) whoNow = who }
/**
 * may this row go up from the person signed in now? A row the server would take but not do (a run taken off by
 * somebody without "Borrar corridas y paros": the server keeps the run, Jose's decision of 2026-10-18) is not sent
 * at all: it waits, parked like another room's row, for someone who may (see sync.ts, mayGo). Nothing is asked of the
 * server for it meanwhile
 */
let mayGo: (it: Item) => boolean = () => true
export const setMayGo = (f: (it: Item) => boolean) => { mayGo = f }
const keyOf = (i: Item) => i.table + '|' + i.key
/** the keys of `marks` whose row is still queued: a mark left behind by a row that left is never counted */
const stillQueued = (marks: Set<string> | Map<string, unknown>) => { if (!marks.size) return []; const q = new Set(read().map(keyOf)); return [...marks.keys()].filter((k) => q.has(k)) }
export const outbox = {
  size: () => read().length,
  items: () => read(),
  /**
   * when the oldest row still waiting was queued (0 = nothing waits); `own` = only the rows the person signed in may
   * send, not the ones parked for someone else (the screen says those apart)
   */
  oldest: (own = false) => read().reduce((t, i) => (i.at && (!t || i.at < t) && !(own && parked.has(keyOf(i))) ? i.at : t), 0),
  /** the rows of this device's own that the server refuses */
  refused: () => stillQueued(refusedOwn),
  /** the rows waiting for someone else to sign in here (see parked) */
  otherRoom: (): Item[] => (parked.size ? read().filter((i) => parked.has(keyOf(i))) : []),
  /** tries again to write a queue that is only in memory (the device has made room) */
  resave() { if (unsaved) write(unsaved) },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
}
const emit = () => listeners.forEach((l) => l())
const is = (table: Table, key: string) => (i: Item) => i.table === table && i.key === key

/** queues a row; `base` (what the server last had), when it was first queued and what was already tried are kept from the change still waiting */
export function push(table: Table, key: string, row: Row, base?: Row | null) {
  if (!supabase) return
  const items = read(), prev = items.find(is(table, key))
  write([...items.filter((i) => !is(table, key)(i)), { table, key, row, base: prev ? prev.base : base, at: prev?.at ?? Date.now(), ...(prev?.tried ? { tried: prev.tried } : {}) }]); emit()
  void flush()
}
/** the change of this row still waiting to go up, if any */
export const queued = (table: Table, key: string) => (supabase ? read().find(is(table, key)) : undefined)
/**
 * what is queued for this row now starts from `base`, the version the server just showed. It keeps when it was first
 * queued: a row the server keeps refusing still says how long it has waited (the red bar, the Tablets tab), however
 * often another tablet changes it meanwhile (audit 2026-10-17, S6); and the versions already tried (see pass)
 */
export function rebase(table: Table, key: string, row: Row, base: Row) {
  if (!supabase) return
  const items = read(), prev = items.find(is(table, key))
  write([...items.filter((i) => !is(table, key)(i)), { table, key, row, base, at: prev?.at ?? Date.now(), ...(prev?.tried ? { tried: prev.tried } : {}) }])
  forget(table, key) // a new version: nobody has refused it yet (if the server still does, the pass says so again)
  emit()
  void flush()
}
/**
 * a queued row is known by another key from now on: a day's program queued by a build of before 2026-10-20 waited
 * under its code alone, and its key now carries its lot (store.ts, planKey and rekeyQueuedPlans). It keeps its place,
 * when it was first queued and what was tried. When a change of the row under the new key is already waiting, that
 * one was made after (by this build), and the old one leaves: they are the same row of the server
 */
export function rekey(table: Table, from: string, to: string) {
  if (from === to) return
  const items = read()
  if (!items.some(is(table, from))) return
  write(items.some(is(table, to)) ? items.filter((i) => !is(table, from)(i)) : items.map((i) => (is(table, from)(i) ? { ...i, key: to } : i)))
  forget(table, from)
  emit()
}
/** the server already has everything this queued change wanted */
export function drop(table: Table, key: string) { write(read().filter((i) => !is(table, key)(i))); forget(table, key); emit() }
/**
 * what the server said of a row that leaves the queue or changes is forgotten with it: a refusal kept after its row
 * had left kept the red bar and "Entrar de nuevo" up with nothing waiting, until the page was reloaded (audit 2026-10-17)
 */
function forget(table: Table, key: string) { refusedOwn.delete(table + '|' + key); parked.delete(table + '|' + key) }

/** rows that went up in the last minute, with the version they started from: a late row from another device can still be merged properly */
const recent = new Map<string, { base: Row | null | undefined; row: Row; at: number }>()
export const justSent = (table: Table, key: string) => { const r = recent.get(table + '|' + key); return r && Date.now() - r.at < 60_000 ? r : undefined }
/** the server took this row: it leaves the queue; a newer change of the same row queued meanwhile now starts from it */
export function markSent(it: Item) {
  if (recent.size > 300) for (const [k, r] of recent) if (Date.now() - r.at > 60_000) recent.delete(k)
  recent.set(it.table + '|' + it.key, { base: it.base, row: it.row, at: Date.now() })
  // (the versions tried before are behind it now: what the server took is the base of what comes next)
  write(read().flatMap((i) => (!is(it.table, it.key)(i) ? [i] : JSON.stringify(i.row) === JSON.stringify(it.row) ? [] : [{ ...i, base: it.row, tried: undefined }])))
  forget(it.table, it.key)
  emit()
}

let before: (() => Promise<Table[] | unknown>) | null = null
/** something to do before a pass (sync.ts brings down what changed while this device was away, so the queue is merged with it first); it may name tables whose rows must wait for the next pass */
export const beforeFlush = (f: () => Promise<Table[] | unknown>) => { before = f }

/**
 * the server has no key like the one a row goes up by (on_conflict): Postgres's 42P10, "there is no unique or exclusion
 * constraint matching the ON CONFLICT specification" (told by its words too, whatever code a server puts on them)
 */
export const noSuchKey = (code: string, message: string) => code === '42P10' || /no unique or exclusion constraint matching the on conflict/i.test(message)
/** how the server answered a row it did not take */
export function verdict(code: string, message: string): 'notReady' | 'refused' | 'bad' | 'later' {
  // the table or a column is not there yet (its SQL still to run), or the table lacks its grants: the rows wait.
  // 42P10 = the key the row goes up by (on_conflict) is not one the table has: a program by its lot before Jose runs
  // 021, or a build of before 021 sending it by its code alone after (2026-10-20). The row waits, never dropped
  if (['42P01', 'PGRST205', 'PGRST204', '42703'].includes(code) || noSuchKey(code, message)) return 'notReady'
  if (code === '42501') return /row-level security/i.test(message) ? 'refused' : 'notReady'
  // a row the database rejects as it is (a missing value, a broken reference): kept, and the rest goes on
  if (['22P02', '23502', '23503', '23514'].includes(code)) return 'bad'
  return 'later' // no signal, an expired session, a server hiccup: tried again later
}

/**
 * remembers that this version of the row is going up (see pass). Only for the rows that are merged when they come
 * down (lines, runs, stops, production orders); only the last three, since each one is a whole row, and they leave
 * with the server's answer
 */
function tryOf(it: Item) {
  if (it.table !== 'act_lines' && it.table !== 'act_runs' && it.table !== 'act_stops' && it.table !== 'act_work_orders') return
  const was = JSON.stringify(it.row)
  write(read().map((i) => (is(it.table, it.key)(i) ? { ...i, tried: [...(i.tried ?? []).filter((t) => JSON.stringify(t) !== was), it.row].slice(-3) } : i)))
}

/**
 * the key each table's rows go up by (PostgREST's on_conflict): the table's primary key. A day's program: its day,
 * room, code and lot (021, the office's 889 of two lots on 2026-10-20)
 */
export const conflictOf = (table: Table) => (table === 'act_schedule' ? 'date,code' : table === 'act_plan' ? 'date,dept,code,lot' : table === 'act_products' ? 'code' : table === 'act_targets' ? 'dept' : 'id')

let flushing = false
/** how many queued rows the server refuses to this session, and how many wait for someone else */
const marks = () => ({ refused: stillQueued(refusedOwn).length, other: stillQueued(parked).length })
export type FlushResult = { sent: number; left: number; error?: string; refused?: number; other?: number; tookOff?: { table: Table; key: string }[] } // other = rows parked for someone else
// tookOff = the runs and lines this pass sent taken off: the server may have kept one (see sync.ts, lookBack)
let after: ((r: FlushResult) => void) | null = null
/**
 * told how every pass ended, whoever started it (a new record sends itself at once, without anyone waiting for the
 * answer): sync.ts keeps the dot at the top by it
 */
export const afterFlush = (f: (r: FlushResult) => void) => { after = f }
/** sends what is queued, oldest first; a failure of the connection stops the pass (it is retried later) */
export async function flush(): Promise<FlushResult> {
  if (!supabase || flushing) return { sent: 0, left: read().length, ...marks() }
  const r = await pass()
  try { after?.(r) } catch { /* what the dot says is not worth a failed pass */ }
  return r
}
async function pass(): Promise<FlushResult> {
  if (!supabase) return { sent: 0, left: read().length, ...marks() }
  flushing = true
  let sent = 0, error: string | undefined
  const tookOff: { table: Table; key: string }[] = []
  try {
    const { data: { session }, error: authError } = await supabase.auth.getSession()
    if (!session) return { sent: 0, left: read().length, error: noSignal(authError) ? 'offline' : 'signedOut', ...marks() }
    const held = before && read().length ? await before() : null
    const waiting = new Set<string>(Array.isArray(held) ? (held as string[]) : []) // tables the server does not have ready yet, or whose rows must wait for the next pass
    const skipped = new Set<string>() // rows the database rejects as they are: they stay queued, the rest goes on
    // who is signed in now: a row parked for this same person is not sent again until that changes, or for a while
    const me = session.user.id + '|' + whoNow()
    const resting = (k: string) => { const p = parked.get(k); return !!p && p.who === me && Date.now() - p.at < PARK_MS }
    while (true) {
      const it = read().find((i) => !waiting.has(i.table) && !skipped.has(keyOf(i)) && !resting(keyOf(i)))
      if (!it) break
      // a row the person signed in may not send (see mayGo): it waits for someone who may, said apart, unsent
      if (!mayGo(it)) { const k = keyOf(it); skipped.add(k); refusedOwn.delete(k); parked.set(k, { who: me, at: Date.now() }); emit(); continue }
      // The version about to go up is remembered with the row until the server says it took it. When the answer is
      // lost (the 25 s limit, a WiFi that drops at that moment) the server may have it all the same, and when it
      // comes down it is this device's own past, not another tablet's change (see reconcile in store.ts). Written
      // before sending, so a reload in the middle of the request is covered too (audit 2026-10-17, S1)
      tryOf(it)
      // (a day's program by its day, room, code AND lot since 2026-10-20: the primary key 021 gives act_plan. Until Jose
      // runs 021 the server has no such key (42P10) and the programs wait, said on the screen; see verdict)
      const onConflict = conflictOf(it.table)
      let { error: e } = await supabase.from(it.table).upsert(it.row, { onConflict })
      // A day's program carries its production order (order_id, null when none: Jose and the office, 2026-10-19), and
      // until Jose runs 020 the server has no such column: PostgREST refuses the whole row (PGRST204, "Could not find
      // the 'order_id' column of 'act_plan'"; Postgres itself says 42703). A program with no order loses nothing
      // without the column: it goes again at once without it, and the room's program never waits for 020. One that
      // names an order waits on its own, said on the screen, and the other programs go on up
      if (e && it.table === 'act_plan' && missingColumn(e) && /order_id/.test(e.message ?? '')) {
        if (it.row.order_id == null) { const { order_id: _none, ...bare } = it.row; ({ error: e } = await supabase.from(it.table).upsert(bare, { onConflict })) }
        else { skipped.add(keyOf(it)); error = tr('Falta ejecutar en Supabase el SQL 020 (pedidos de producción): un programa con pedido espera'); continue }
      }
      // A production order carries its lot (2026-10-20) and until Jose runs 022 the server has no such column: an order
      // with no lot loses nothing without it and goes again at once without it; one with a lot waits on its own, said
      // on the screen (as a program's order above)
      if (e && it.table === 'act_work_orders' && missingColumn(e) && /\blot\b/.test(e.message ?? '')) {
        if (!it.row.lot) { const { lot: _none, ...bare } = it.row; ({ error: e } = await supabase.from(it.table).upsert(bare, { onConflict })) }
        else { skipped.add(keyOf(it)); error = tr('Falta ejecutar en Supabase el SQL 022 (el lote del pedido): un pedido con lote espera'); continue }
      }
      if (e) {
        console.warn('actividad sync', it.table, e)
        const v = verdict(String(e.code ?? ''), e.message ?? ''), k = keyOf(it)
        // (a program with its lot column while 019 has not been run: the server says the column is missing, PGRST204 /
        // 42703; named by its file so Jose knows what to paste, 2026-10-19. Every program waits until then, with or
        // without a lot typed: the row always carries the column)
        // (the production orders while 020 has not been run: their table is not there; named by its file too, 2026-10-19)
        // (a program by its lot while 021 has not been run: the server has no key of day, room, code and lot, 42P10;
        // named by its file, 2026-10-20)
        if (v === 'notReady') { waiting.add(it.table); error = it.table === 'act_plan' && noSuchKey(String(e.code ?? ''), e.message ?? '') ? tr('Falta ejecutar en Supabase el SQL 021 (el programa por lote): el programa espera') : it.table === 'act_plan' && ['PGRST204', '42703'].includes(String(e.code ?? '')) ? (/end_date/.test(e.message ?? '') ? tr('Falta ejecutar en Supabase el SQL 025 (programa de varios días): el programa espera') : /\bnote\b/.test(e.message ?? '') ? tr('Falta ejecutar en Supabase el SQL 026 (comentarios del programa): el programa espera') : tr('Falta ejecutar en Supabase el SQL 019 (el lote del programa): el programa espera')) : it.table === 'act_work_orders' ? tr('Falta ejecutar en Supabase el SQL 020 (pedidos de producción): los pedidos esperan') : tr('Falta ejecutar en Supabase el SQL de {0}', it.table); continue }
        if (v === 'refused') {
          skipped.add(k)
          // a row of this device's own that the server refuses: the person signed in is no longer who the server
          // thinks. It waits (nothing recorded is lost) and the screen says so
          if (ownRow(it.row)) { parked.delete(k); refusedOwn.add(k); error = tr('El servidor no acepta lo que registra esta sesión: sin permiso para {0}', String(it.row.dept ?? it.table)); continue }
          // a row that is not this person's to write (another room's): it waits for someone who may send it, and the
          // screen says so apart. No error of this session (see parked)
          refusedOwn.delete(k); parked.set(k, { who: me, at: Date.now() }); emit(); continue
        }
        error = (e.code ? e.code + ' ' : '') + e.message + (e.details ? ' · ' + e.details : '') + ' [' + it.table + ']'
        if (v === 'bad') { skipped.add(k); continue }
        break
      }
      markSent(it)
      sent++
      if ((it.table === 'act_runs' || it.table === 'act_lines') && it.row.deleted && !it.base?.deleted) tookOff.push({ table: it.table, key: it.key })
    }
  } catch (e) {
    error = String(e)
  } finally { flushing = false }
  return { sent, left: read().length, error, ...marks(), ...(tookOff.length ? { tookOff } : {}) }
}
