import { supabase } from './supabase'

/**
 * Every change is saved on the device first and queued here; the queue is sent whenever there is signal. One entry
 * per row (a later change to the same row replaces the earlier one), so a weak WiFi never duplicates anything.
 */
export type Table = 'act_lines' | 'act_runs' | 'act_stops' | 'act_products' | 'act_schedule'
type Item = { table: Table; key: string; row: Record<string, unknown> }
const KEY = 'act_outbox'

function read(): Item[] { try { return JSON.parse(localStorage.getItem(KEY) || '[]') as Item[] } catch { return [] } }
function write(items: Item[]) { try { localStorage.setItem(KEY, JSON.stringify(items)) } catch { /* full */ } }

const listeners = new Set<() => void>()
export const outbox = {
  size: () => read().length,
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
}
const emit = () => listeners.forEach((l) => l())

export function push(table: Table, key: string, row: Record<string, unknown>) {
  if (!supabase) return
  const items = read().filter((i) => !(i.table === table && i.key === key))
  items.push({ table, key, row })
  write(items); emit()
  void flush()
}

let flushing = false
export type FlushResult = { sent: number; left: number; error?: string }
/** sends what is queued, oldest first; a failure stops the pass (it is retried later) */
export async function flush(): Promise<FlushResult> {
  if (!supabase || flushing) return { sent: 0, left: read().length }
  flushing = true
  let sent = 0, error: string | undefined
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { sent: 0, left: read().length, error: 'signedOut' }
    while (true) {
      const items = read()
      if (!items.length) break
      const it = items[0]
      const { error: e } = await supabase.from(it.table).upsert(it.row, { onConflict: it.table === 'act_schedule' ? 'date,code' : it.table === 'act_products' ? 'code' : 'id' })
      if (e) { error = (e.code ? e.code + ' ' : '') + e.message + (e.details ? ' · ' + e.details : '') + ' [' + it.table + ']'; console.warn('actividad sync', it.table, e); break }
      write(read().filter((i) => !(i.table === it.table && i.key === it.key && JSON.stringify(i.row) === JSON.stringify(it.row))))
      sent++; emit()
    }
  } finally { flushing = false }
  return { sent, left: read().length, error }
}
