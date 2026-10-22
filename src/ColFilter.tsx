import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { tr } from './i18n'

/**
 * Filters on the columns of the report's tables, as in Excel (the office, 2026-10-21: "que las columnas sean menú
 * desplegable para poder de ahí filtrar: si le dan un click a la columna código salgan los códigos que hay, o que
 * pueda escribir si hay muchos ... y luego el lote ... exacto como en Excel"). Each column with one has a ▾ in its
 * title: it opens the values the column has (with how many rows each), a box to search them, and a tick on each.
 * Untick what is not wanted; several columns add up (a code, then its lots). The values offered are those the rows
 * left by the OTHER columns' filters have, as Excel does. Kept per table while the app is open.
 * A row may hold several values in one column (a pallet of two lots): it stays when any of them is ticked.
 */
export type Col<T> = { key: string; label: string; get: (x: T) => string | string[]; show?: (v: string) => string }
const kept = new Map<string, Record<string, string[]>>()
const EMPTY = '\u0000'
const valuesOf = <T,>(c: Col<T>, x: T) => { const v = c.get(x); return (Array.isArray(v) ? v : [v]).map((y) => (y ?? '').trim() || EMPTY) }

export function useColFilters<T>(id: string, rows: T[], cols: Col<T>[]) {
  const [sel, setSel] = useState<Record<string, string[]>>(() => kept.get(id) ?? {})
  const put = (next: Record<string, string[]>) => { kept.set(id, next); setSel(next) }
  const passes = (x: T, skip?: string) => cols.every((c) => c.key === skip || !sel[c.key] || valuesOf(c, x).some((v) => sel[c.key].includes(v)))
  const shown = rows.filter((x) => passes(x))
  const active = cols.filter((c) => sel[c.key])
  const head = (key: string, label: ReactNode) => {
    const c = cols.find((y) => y.key === key)
    if (!c) return label
    const counts = new Map<string, number>()
    for (const x of rows) if (passes(x, key)) for (const v of new Set(valuesOf(c, x))) counts.set(v, (counts.get(v) ?? 0) + 1)
    const values = [...counts.keys()].sort((a, b) => (a === EMPTY ? 1 : b === EMPTY ? -1 : a.localeCompare(b, undefined, { numeric: true })))
    const pick = (list: string[] | null) => { const next = { ...sel }; if (list === null || list.length === values.length) delete next[key]; else next[key] = list; put(next) }
    return <span className="cf-head">{label}<ColMenu label={c.label} values={values} counts={counts} chosen={sel[key] ?? null} show={c.show ? (v) => (v === EMPTY ? show(v) : c.show!(v)) : undefined} onPick={pick} /></span>
  }
  const clear = () => put({})
  // (on a phone the tables are cards and their titles are hidden: the same menus in a row over the list)
  const tools = <div className="cf-tools"><span>{tr('Filtrar:')}</span>{cols.map((c) => <span key={c.key} className={'cf-tool' + (sel[c.key] ? ' on' : '')}>{head(c.key, c.label)}</span>)}</div>
  const bar = active.length > 0 && (
    <div className="cf-bar">
      <span>{tr('Filtrado por columna:')}</span>
      {active.map((c) => <button key={c.key} type="button" className="chip sm on" onClick={() => { const next = { ...sel }; delete next[c.key]; put(next) }}>{c.label}: {sel[c.key].map((v) => (c.show && v !== EMPTY ? c.show(v) : show(v))).slice(0, 3).join(', ')}{sel[c.key].length > 3 ? ' +' + (sel[c.key].length - 3) : ''} ✕</button>)}
      <button type="button" className="btn sm" onClick={clear}>{tr('✕ Quitar filtros de columna')}</button>
      <small>{tr('{0} de {1} renglones', shown.length, rows.length)}</small>
    </div>
  )
  return { shown, head, bar: <>{tools}{bar}</>, active: active.length, clear }
}
const show = (v: string) => (v === EMPTY ? tr('(vacío)') : v)

/** the ▾ of a column and its list: search, tick all, each value with its count */
/**
 * single = one value at a time (the report's own filters of code, lot and line: its numbers are worked out again for
 * it, and its files follow it): a tap picks it and closes; "Quitar filtro" shows everything again
 */
export function ColMenu({ label, values, counts, chosen, single, show: shown, onPick }: { label: string; values: string[]; counts?: Map<string, number>; chosen: string[] | null; single?: boolean; show?: (v: string) => string; onPick: (list: string[] | null) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const btn = useRef<HTMLButtonElement>(null), box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number }>({ top: 0, left: 0, maxHeight: 400 })
  useLayoutEffect(() => {
    if (!open || !btn.current) return
    // under its ▾, or over it when there is little room below (a table at the bottom of the screen)
    const r = btn.current.getBoundingClientRect(), w = Math.min(300, window.innerWidth - 16), below = window.innerHeight - r.bottom - 12, above = r.top - 12
    const up = below < 300 && above > below, maxHeight = Math.max(160, Math.min(440, up ? above : below))
    setPos({ top: up ? Math.max(8, r.top - 4 - maxHeight) : r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), maxHeight })
  }, [open])
  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent | TouchEvent) => { if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const away = () => setOpen(false)
    document.addEventListener('mousedown', out); document.addEventListener('touchstart', out); document.addEventListener('keydown', esc); window.addEventListener('scroll', away, true)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('touchstart', out); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', away, true) }
  }, [open])
  const on = (v: string) => !chosen || chosen.includes(v)
  const words = q.trim().toLowerCase()
  const name = (v: string) => (shown ? shown(v) : show(v))
  const list = words ? values.filter((v) => name(v).toLowerCase().includes(words)) : values
  const flip = (v: string) => { const cur = chosen ?? values; onPick(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]) }
  const all = list.every(on)
  return (
    <>
      <button ref={btn} type="button" className={'cf-btn' + (chosen ? ' on' : '')} aria-label={tr('Filtrar {0}', label)} aria-expanded={open} onClick={() => setOpen(!open)}>▾</button>
      {open && (
        <div ref={box} className="cf-menu" style={{ top: pos.top, left: pos.left, maxHeight: pos.maxHeight }} role="dialog" aria-label={tr('Filtrar {0}', label)}>
          <b>{label}</b>
          {values.length > 6 && <input autoFocus value={q} placeholder={tr('Buscar…')} aria-label={tr('Buscar…')} onChange={(e) => setQ(e.target.value)} />}
          {!single && <label className="cf-item all"><input type="checkbox" checked={all} onChange={() => { if (words) onPick(all ? (chosen ?? values).filter((v) => !list.includes(v)) : [...new Set([...(chosen ?? []), ...list])]); else onPick(all ? [] : null) }} /><span>{words ? tr('(Seleccionar lo que se encontró)') : tr('(Seleccionar todo)')}</span></label>}
          <div className="cf-list">
            {list.map((v) => single
              ? <button key={v} type="button" className={'cf-item one' + (chosen?.includes(v) ? ' on' : '')} onClick={() => { onPick([v]); setOpen(false); setQ('') }}><span>{name(v)}</span>{chosen?.includes(v) && <small>✓</small>}</button>
              : <label key={v} className="cf-item"><input type="checkbox" checked={on(v)} onChange={() => flip(v)} /><span>{name(v)}</span><small>{counts?.get(v)}</small></label>)}
            {!list.length && <small className="cf-none">{tr('Nada con eso.')}</small>}
          </div>
          <div className="cf-foot">
            {words && !single && <button type="button" className="btn sm soft" onClick={() => { onPick(list); setOpen(false) }}>{tr('Solo estos')}</button>}
            <button type="button" className="btn sm" onClick={() => { onPick(null); setQ('') }}>{tr('Quitar filtro')}</button>
            <button type="button" className="btn sm primary" onClick={() => setOpen(false)}>{tr('Listo')}</button>
          </div>
        </div>
      )}
    </>
  )
}
