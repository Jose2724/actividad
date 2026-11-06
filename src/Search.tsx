import { useEffect, useMemo, useRef, useState } from 'react'
import { DEPTS, fmtN, lineNameOf, normCode, runQty, type Dept, type State } from './store'
import { DEPT_LOOK } from './look'
import type { ReportAt } from './ReportView'
import type { RdTab } from './Shell'
import { tabLabel } from './Shell'
import { tr } from './i18n'

/**
 * One search for everything (the redesign, 2026-11-05: "que las informaciones sean fáciles de buscar"): codes, lots,
 * POs, pallets and tags, the records of the days this device keeps, the people written in attendance (only for whoever
 * manages it) and the screens of the app. Each result leads to its place; nobody finds what they could not open.
 * Older days are asked from the server in Reportes, as before ("Buscar en varios días").
 */
export type SearchGo = { tab: RdTab; report?: ReportAt; lot?: string; dept?: Dept }
type Hit = { key: string; group: string; icon: string; title: string; sub: string; where: string; go: SearchGo; rank: number }
const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

function find(s: State, q: string, sees: (t: RdTab) => boolean, people: boolean, only?: Dept): Hit[] {
  const n = norm(q)
  if (n.length < 2) return []
  const hits: Hit[] = []
  const has = (x: string | null | undefined) => !!x && norm(x).includes(n)
  const exact = (x: string | null | undefined) => !!x && norm(x) === n
  const rooms = only ? [only] : DEPTS
  // screens and settings first when the words match a name (Jose types "pesos", "programa")
  for (const t of ['act', 'pt', 'wo', 'po', 'prod', 'goals', 'av', 'lt', 'pal', 'hold', 'fl', 'home', 'kpi', 'wt', 'dash', 'mini', 'pplh', 'rep', 'msg', 'set'] as RdTab[]) {
    if (sees(t) && has(tabLabel(t))) hits.push({ key: 'tab' + t, group: tr('Pantallas'), icon: '🧭', title: tabLabel(t), sub: tr('Abrir esta pantalla'), where: '', go: { tab: t }, rank: exact(tabLabel(t)) ? 0 : 5 })
  }
  // codes: the products table
  for (const p of s.products) {
    if (has(p.code) || has(p.name)) hits.push({ key: 'p' + p.code, group: tr('Códigos'), icon: '🏷', title: p.code + (p.name ? ' · ' + p.name : ''), sub: tr('Ver lo hecho de este código en el Reporte'), where: tr('Reportes'), go: { tab: 'rep', report: { code: p.code, view: 'code' } }, rank: exact(p.code) ? 1 : 6 })
  }
  // lots and the records of the days kept on this device, newest first
  const runs = s.runs.filter((r) => !r.deleted && rooms.includes(r.dept)).sort((a, b) => b.startedAt - a.startedAt)
  const lots = new Map<string, { code: string; rooms: Set<Dept>; days: Set<string> }>()
  for (const r of runs) {
    for (const lot of [r.lot, ...r.units.flatMap((u) => (u.lots ?? []).map((x) => x.lot))]) {
      if (!lot || !has(lot)) continue
      const e = lots.get(lot) ?? { code: r.code, rooms: new Set(), days: new Set() }
      e.rooms.add(r.dept); e.days.add(r.date); lots.set(lot, e)
    }
  }
  for (const [lot, e] of lots) {
    const tab: RdTab = sees('av') ? 'av' : sees('lt') ? 'lt' : 'rep'
    hits.push({ key: 'lot' + lot, group: tr('Lotes'), icon: '🔎', title: tr('Lote {0} · {1}', lot, e.code), sub: [...e.rooms].join(' → ') + ' · ' + (e.days.size === 1 ? tr('1 día') : tr('{0} días', e.days.size)), where: tabLabel(tab), go: tab === 'rep' ? { tab, report: { lot } } : { tab, lot }, rank: exact(lot) ? 1 : 4 })
  }
  let recs = 0
  for (const r of runs) {
    if (recs >= 8) break
    if (!(has(r.code) || has(r.lot) || has(lineNameOf(s, r.lineId, r.line)))) continue
    recs++
    hits.push({ key: 'run' + r.id, group: tr('Registros'), icon: DEPT_LOOK[r.dept].emoji, title: r.dept + ' · ' + lineNameOf(s, r.lineId, r.line) + ' · ' + r.code + ' · ' + tr('lote {0}', r.lot), sub: r.date + ' · ' + fmtN(runQty(s, r)) + (r.endedAt ? '' : ' · ' + tr('trabajando')), where: tr('Reportes › Registros'), go: { tab: 'rep', report: { date: r.date, dept: r.dept, code: r.code, lot: r.lot, view: 'rec' } }, rank: 7 })
  }
  // pallets and tags (Packing's units), and the orders with PO
  let pals = 0
  for (const r of runs.filter((x) => x.dept === 'Packing')) {
    for (const u of r.units) {
      if (pals >= 8) break
      if (!(has(u.ref) || has(u.po))) continue
      pals++
      hits.push({ key: 'u' + r.id + u.at, group: tr('Pallets y tags'), icon: '📦', title: [u.ref && tr('tag {0}', u.ref), u.po && 'PO ' + u.po].filter(Boolean).join(' · '), sub: r.date + ' · ' + r.code + ' · ' + tr('lote {0}', r.lot), where: tabLabel(sees('pal') ? 'pal' : 'rep'), go: { tab: sees('pal') ? 'pal' : 'rep', report: { date: r.date, dept: 'Packing', view: 'pal' } }, rank: exact(u.ref) || exact(u.po) ? 1 : 6 })
    }
  }
  if (sees('po')) for (const o of s.orders) {
    if (!(has(o.po) || has(o.customer) || has(o.code))) continue
    hits.push({ key: 'o' + o.id, group: tr('Pedidos con PO'), icon: '🧾', title: 'PO ' + o.po + ' · ' + o.code + (o.customer ? ' · ' + o.customer : ''), sub: (o.closed ? tr('cerrado') : tr('abierto')) + (o.shipBy ? ' · ' + tr('sale {0}', o.shipBy) : ''), where: tabLabel('po'), go: { tab: 'po' }, rank: exact(o.po) ? 1 : 5 })
  }
  if (sees('wo')) for (const w of (s.workOrders ?? []).filter((x) => !x.deleted && rooms.includes(x.dept))) {
    if (!(has(w.wo) || has(w.lot) || normCode(w.code) === normCode(q))) continue
    hits.push({ key: 'wo' + w.id, group: tr('Pedidos de producción'), icon: '📋', title: (w.wo ? w.wo + ' · ' : '') + w.dept + ' · ' + w.code + (w.lot ? ' · ' + tr('lote {0}', w.lot) : ''), sub: fmtN(w.qty) + ' ' + w.unit + ' · ' + (w.closedAt ? tr('cerrado') : tr('abierto')), where: tabLabel('wo'), go: { tab: 'wo' }, rank: 5 })
  }
  // people written in attendance (whoever manages it): where they are today
  if (people) {
    const seen = new Set<string>()
    for (const a of [...(s.attendance ?? [])].sort((x, y) => y.at - x.at)) {
      if (seen.size >= 6) break
      if (seen.has(a.name) || !has(a.name)) continue
      seen.add(a.name)
      hits.push({ key: 'a' + a.id, group: tr('Personas'), icon: '👤', title: a.name, sub: a.date + ' · ' + a.dept + ' · ' + tr('Turno {0}', a.shift) + (a.gone ? ' · ' + tr('salió') : ''), where: tr('Planta'), go: { tab: 'act', dept: a.dept }, rank: 6 })
    }
  }
  return hits.sort((a, b) => a.rank - b.rank).slice(0, 40)
}

export function GlobalSearch({ s, sees, people, only, onGo, onClose }: { s: State; sees: (t: RdTab) => boolean; people: boolean; only?: Dept; onGo: (g: SearchGo) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const box = useRef<HTMLInputElement>(null)
  useEffect(() => { box.current?.focus() }, [])
  const hits = useMemo(() => find(s, q, sees, people, only), [s, q, sees, people, only])
  useEffect(() => setI(0), [q])
  const groups: { g: string; list: Hit[] }[] = []
  for (const h of hits) { const g = groups.find((x) => x.g === h.group); if (g) g.list.push(h); else groups.push({ g: h.group, list: [h] }) }
  const flat = groups.flatMap((g) => g.list)
  const pick = (h: Hit | undefined) => { if (h) { onGo(h.go); onClose() } }
  return (
    <div className="veil rd-search-veil" onClick={onClose}>
      <div className="rd-search" role="dialog" aria-modal="true" aria-label={tr('Buscar')} onClick={(e) => e.stopPropagation()}>
        <div className="rd-search-q">
          <span aria-hidden="true">🔍</span>
          <input ref={box} id="rd-search-q" type="search" value={q} placeholder={tr('Código, lote, PO, tag, persona o pantalla…')} aria-label={tr('Buscar')}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              else if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(flat.length - 1, x + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)) }
              else if (e.key === 'Enter') pick(flat[i])
            }} />
          <button type="button" className="rd-x" aria-label={tr('Cerrar')} onClick={onClose}>✕</button>
        </div>
        <div className="rd-search-res">
          {q.trim().length < 2 ? <p className="rd-search-hint">{tr('Escribe al menos 2 letras o números. Busca en los días que guarda este aparato.')}</p>
            : !hits.length ? <p className="rd-search-hint">{tr('Nada con "{0}" en los días que guarda este aparato. Para días más viejos: Reportes › Buscar en varios días.', q.trim())}</p>
              : groups.map((g) => (
                <div key={g.g}>
                  <div className="rd-search-g">{g.g}</div>
                  {g.list.map((h) => {
                    const on = flat[i] === h
                    return (
                      <button key={h.key} type="button" className={'rd-hit' + (on ? ' on' : '')} onMouseEnter={() => setI(flat.indexOf(h))} onClick={() => pick(h)}>
                        <span className="rd-hit-ic" aria-hidden="true">{h.icon}</span>
                        <span className="rd-hit-t"><b>{h.title}</b><small>{h.sub}</small></span>
                        {h.where && <em>{h.where}</em>}
                      </button>
                    )
                  })}
                </div>
              ))}
        </div>
        <div className="rd-search-ft">{tr('↑ ↓ para moverte · Enter para abrir · Esc para cerrar')}</div>
      </div>
    </div>
  )
}
