import { Fragment, memo, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { awayDay, dayAfter, dayBefore, fmtN, KEEP_DAYS, type Dept, type PackRoom, type State } from './store'
import { datesBetween, mfoText, mfoWord, type AvancePart } from './avance'
import { loadDay } from './sync'
import { loadZip, xlsxNow, XLSX_TYPE, type Sheet } from './xlsx'
import { DEPT_LOOK, deptVars } from './look'
import { addDays, download, MISSING, NoticeDialog, Products, shortDay, useViewOnly } from './App'
import { diffText, diffWord, FLUJO_STATES, flujoExplain, flujoFile, flujoFilter, flujoLegend, flujoLots, flujoSheet, flujoStateLabel, flujoStateText, flujoSum, missingText, n2, type FlujoLot, type FlujoRow, type FlujoState } from './flujo'
import { tr } from './i18n'
import { trx } from './trx'

/**
 * The "Flujo de datos" tab: the office clerk's WO PENDIENTES sheet, lot by lot, computed from what each room records
 * (src/flujo.ts has the arithmetic and the Excel). A tab apart from Avance on purpose: Jose said "yo pensé que esto es
 * lo mismo que tenemos en Avance, pero bueno" (2026-10-18), and it is not: Avance is a day's progress against its
 * program, code by code; this is the clerk's reconciliation per lot between one room and the next, with the sheet's
 * own columns and signs, so he closes work orders without typing the four counts. Nobody types here.
 *
 * The filters live at module level (not in sessionStorage): tapping a code opens that lot in Avance, and coming back
 * to this tab finds the same range, lot, chips and search. The range follows the day: a preset (7 / 14 / 30 días) is
 * "back from today", so a device left open on this tab (the office PC) wakes up on the new day's days and not on the
 * days of the day it was first opened (review of 2026-10-18: a lot of today was not listed); dates typed by hand are
 * absolute and stay. The files follow the filters and never the search, as the report's files do (the "rf-foot" line
 * says so). No tfoot: different products do not add up; the tiles carry the case totals of what is in view.
 */
let kept = { today: '', from: '', to: '', days: KEEP_DAYS, byHand: false, lot: '', q: '', route: '' as PackRoom | '', state: '' as FlujoState | '' }
const COLS = 13

/**
 * A memo: Main draws itself every second for its clock and this tab shows no clock; drawing ~200 rows took 100-140 ms
 * each second on a PC and several times more on a tablet (review of 2026-10-18). Each row is a memo too (FlujoRowView):
 * a keystroke in the search box draws the list again, not every row's arithmetic in words.
 */
export const Flujo = memo(function Flujo({ s, today, onLot }: { s: State; today: string; onLot: (lot: string) => void }) {
  const viewOnly = useViewOnly()
  // (`today` comes from Main's clock, as a prop: a memo draws itself again when the plant day turns, with nothing else)
  const spanOf = (n: number) => ({ from: addDays(today, -(n - 1)), to: today })
  // the range: the one kept from an earlier visit this day, or dates typed by hand; else the preset back from today
  // (the days this device holds, KEEP_DAYS, by default; older days are brought from the server)
  const start = kept.today === today || kept.byHand ? { from: kept.from, to: kept.to } : spanOf(kept.days)
  const [from, setFrom] = useState(start.from)
  const [to, setTo] = useState(start.to)
  const [days, setDays] = useState(kept.days)
  const [byHand, setByHand] = useState(kept.byHand)
  const [lot, setLot] = useState(kept.lot)
  const [q, setQ] = useState(kept.q)
  const [route, setRoute] = useState<PackRoom | ''>(kept.route)
  const [state, setState] = useState<FlujoState | ''>(kept.state)
  useEffect(() => { kept = { today, from, to, days, byHand, lot, q, route, state } }, [today, from, to, days, byHand, lot, q, route, state])
  // a preset moves with the day while the tab stays open (the office PC left on it overnight)
  useEffect(() => { if (!byHand) { const r = spanOf(days); setFrom(r.from); setTo(r.to) } }, [today]) // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (n: number) => { setDays(n); setByHand(false); const r = spanOf(n); setFrom(r.from); setTo(r.to) }
  const [editing, setEditing] = useState(false)
  const [help, setHelp] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [notice, setNotice] = useState<{ title: string; text?: string } | null>(null)
  const [a, b] = from <= to ? [from, to] : [to, from]
  const span = datesBetween(from, to)
  const preset = (n: number) => from === addDays(today, -(n - 1)) && to === today
  const lots = useMemo(() => flujoLots(s, from, to), [s.runs, s.products, from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  // what the chips count: the route chips over everything of the lot and the search; the state chips over the route chosen
  const base = flujoFilter(lots, { q, lot, route: '', state: '' })
  const found = flujoFilter(lots, { q, lot, route, state: '' })
  const shown = flujoFilter(lots, { q, lot, route, state })
  const forFiles = flujoFilter(lots, { q, lot, route, state }, false)
  const rows = shown.flatMap((l) => l.rows), baseRows = base.flatMap((l) => l.rows), foundRows = found.flatMap((l) => l.rows)
  const routeN = (k: PackRoom) => baseRows.filter((r) => r.route === k).length
  const stateN = (k: FlujoState) => foundRows.filter((r) => r.state === k).length
  const sum = flujoSum(rows)
  // the lot of the first day in view may have started the day before, and the lot of the last day runs into the day
  // after: both are brought from the server with the range (a lot is counted whole, over every day the device holds)
  useEffect(() => { for (const d of [dayBefore(a), ...span, dayAfter(b)]) if (awayDay(d)) void loadDay(d) }, [from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadZip().catch(() => undefined) }, []) // the Excel's zip library, ahead of the tap
  const away = span.filter((d) => awayDay(d)).length
  const filtering = !!(lot || q.trim() || route || state)
  const clear = () => { setLot(''); setQ(''); setRoute(''); setState('') }
  const toggle = useCallback((k: string) => setOpen((o) => ({ ...o, [k]: !o[k] })), [])
  const lotList = lots.map((l) => l.lot)
  const viewingOf = (list: FlujoLot[], withQ: boolean) => {
    const n = list.reduce((t, l) => t + l.rows.length, 0)
    return [tr('del {0} al {1}', shortDay(a), shortDay(b)), lot ? tr('lote {0}', lot) : tr('todos los lotes'), route || tr('RTE y MFO'), state ? flujoStateLabel(state) : '', withQ && q.trim() ? '«' + q.trim() + '»' : '', list.length === 1 ? tr('1 lote') : tr('{0} lotes', list.length), n === 1 ? tr('1 código') : tr('{0} códigos', n)].filter(Boolean).join(' · ')
  }
  const viewing = viewingOf(shown, true)
  // ---- the Excel: the sheet's columns, flat, with a Leyenda for the signs; what the filters hold (never the search) ----
  const sheets = (): Sheet[] => [{ name: tr('Flujo de datos'), rows: flujoSheet(forFiles) }, { name: tr('Leyenda'), rows: flujoLegend(viewingOf(forFiles, false)) }]
  const excel = async () => {
    try {
      const bytes = xlsxNow(sheets()) ?? (await loadZip(), xlsxNow(sheets()))
      if (!bytes) throw new Error('xlsx')
      download(new File([bytes], flujoFile(a, b, { lot, route, state }) + '.xlsx', { type: XLSX_TYPE }))
    } catch (e) { console.warn('actividad flujo', e); setNotice({ title: tr('No se pudo {0}', tr('hacer el Excel')), text: MISSING }) }
  }
  // ---- the lot's band: its pieces apart (the "·" between them is drawn by the style, never left alone at a line's end) ----
  const daysOf = (days: string[]) => shortDay(days[0]) + (days.length > 1 ? ' ' + tr('(y {0})', days.slice(1).map(shortDay).join(', ')) : '')
  const statesOf = (l: FlujoLot) => [l.sum.states.ok ? tr('{0} cuadran', l.sum.states.ok) : '', l.sum.states.short ? tr('{0} faltan', l.sum.states.short) : '', l.sum.states.over ? tr('{0} de más', l.sum.states.over) : '', l.sum.states.unpacked ? tr('{0} sin empacar', l.sum.states.unpacked) : '', l.sum.states.nocompare ? tr('{0} sin comparar', l.sum.states.nocompare) : ''].filter(Boolean)
  const roomTh = (d: Dept, text: ReactNode, cls = '') => <th className={'dth ' + cls} style={deptVars(d)}><i className="demoji" aria-hidden="true">{DEPT_LOOK[d].emoji}</i>{text}</th>
  return (
    <section className="report avance av2 flujo">
      <div className="rhead">
        <div className="rtitle"><h2>{tr('Flujo de datos')}</h2><span>{trx('del {0} al {1} · {2} días', shortDay(a), shortDay(b), span.length)}</span></div>
        <div className="racts">
          <button type="button" className="btn" onClick={() => setEditing(!editing)}>{editing ? tr('Cerrar productos') : tr('⚙ Productos')}</button>
          {/* (the file is of the filters' view, never of the search: a search that finds nothing still lets it out) */}
          <button type="button" className="btn" onClick={() => void excel()} disabled={!forFiles.length}>{tr('⬇ Excel')}</button>
        </div>
      </div>
      {/* what to look at: the days, one lot, a code or a product */}
      <div className="rfilters">
        <div className="rf-row">
          <div className="rf">
            <span className="lab">{tr('Fecha')}</span>
            <div className="rangepick">
              <label>{tr('Desde')} <input type="date" value={from} onChange={(e) => { if (e.target.value) { setFrom(e.target.value); setByHand(true) } }} /></label>
              <label>{tr('Hasta')} <input type="date" value={to} onChange={(e) => { if (e.target.value) { setTo(e.target.value); setByHand(true) } }} /></label>
              <button type="button" className={'chip sm' + (preset(7) ? ' on' : '')} aria-pressed={preset(7)} onClick={() => pick(7)}>{tr('7 días')}</button>
              <button type="button" className={'chip sm' + (preset(14) ? ' on' : '')} aria-pressed={preset(14)} title={tr('lo que guarda este aparato')} onClick={() => pick(14)}>{tr('14 días')}</button>
              <button type="button" className={'chip sm' + (preset(30) ? ' on' : '')} aria-pressed={preset(30)} onClick={() => pick(30)}>{tr('30 días')}</button>
            </div>
          </div>
          <div className="rf grow">
            <span className="lab">{tr('Lote')}</span>
            <div className="chips lotpick">
              <select className={'lotsel wide' + (lot ? ' on' : '')} value={lot} aria-label={tr('Lote')} onChange={(e) => setLot(e.target.value)}>
                <option value="">{tr('Todos · {0} lotes', lots.length)}</option>
                {lotList.map((l) => <option key={l} value={l}>{l}</option>)}
                {lot && !lotList.includes(lot) && <option value={lot}>{lot}</option>}
              </select>
            </div>
          </div>
          <label className="rf avsearch"><span className="lab">{tr('Buscar')}</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Código, producto o lote')} autoComplete="off" /></label>
        </div>
        {filtering && <p className="rf-foot">{tr('Los archivos salen con lo que estás viendo.')} {tr('La búsqueda no entra en el Excel.')}</p>}
      </div>
      {away > 0 && <p className="avlotnote">{trx('Trayendo del servidor {0} de los {1} días…', away, span.length)}</p>}
      {editing && <Products s={s} readOnly={viewOnly} />}
      {lots.length === 0 ? <p className="hint">{trx('Nada registrado del {0} al {1}.', shortDay(a), shortDay(b))}</p> : (
        <>
          <div className="heads">
            <div className="made"><label>{tr('Lotes')}</label><b>{shown.length}</b><small>{rows.length === 1 ? tr('1 código') : tr('{0} códigos', rows.length)}</small></div>
            <div className="made dtile" style={deptVars('Packing')}><label><i className="demoji" aria-hidden="true">{DEPT_LOOK.Packing.emoji}</i>{tr('Cajas empacadas')}</label><b>{fmtN(sum.cases)}</b><small>{sum.pallets} pallets</small></div>
            <div className="made fl-tile-short"><label>{tr('Faltan cs')}</label><b>{sum.states.short}</b><small>{tr('{0} cs en total', n2(sum.shortCs))}</small></div>
            <div className="made fl-tile-over"><label>{tr('cs de más')}</label><b>{sum.states.over}</b><small>{tr('{0} cs en total', n2(sum.overCs))}</small></div>
          </div>
          <div className="avhow">
            <p className="avview">{trx('Viendo: {0}', <b>{viewing}</b>)}</p>
            <div className="chips avstages" role="group" aria-label={tr('Lo empaca')}>
              {(['', 'RTE', 'MFO'] as const).map((k) => (
                <button key={k} type="button" className={'chip' + (route === k ? ' on' : '')} aria-pressed={route === k} onClick={() => setRoute(k)}>
                  {k ? DEPT_LOOK[k].emoji + ' ' + k : tr('Todos')} <small>{k ? routeN(k) : baseRows.length}</small>
                </button>
              ))}
            </div>
            <div className="chips avstages flstates" role="group" aria-label={tr('Estado')}>
              <button type="button" className={'chip' + (state === '' ? ' on' : '')} aria-pressed={state === ''} onClick={() => setState('')}>{tr('Todos')} <small>{foundRows.length}</small></button>
              {FLUJO_STATES.filter((k) => stateN(k) > 0 || state === k).map((k) => (
                <button key={k} type="button" className={'chip st-' + k + (state === k ? ' on' : '')} aria-pressed={state === k} onClick={() => setState(k)}>
                  <i className="dotst" aria-hidden="true" />{flujoStateLabel(k)} <small>{stateN(k)}</small>
                </button>
              ))}
            </div>
            <button type="button" className="btn sm" onClick={() => setHelp(true)}>{tr('ⓘ Cómo leer Flujo')}</button>
          </div>
          {help && <FlujoHelp onClose={() => setHelp(false)} />}
          {rows.length === 0 ? (
            <p className="hint">{q.trim() ? trx('Ningún código coincide con "{0}".', q.trim()) : tr('Ningún código está así.')} <button type="button" className="lnk sm" onClick={clear}>{tr('Ver todo')}</button></p>
          ) : (
            <div className="twrap">
              <table className="avtable fltable">
                <thead><tr>
                  <th>{tr('Código')}</th>
                  <th>{tr('Yield')}<small>{tr('cs / mezcla')}</small></th>
                  <th>{tr('Pouch × cs')}</th>
                  {roomTh('Kitchen', <>{tr('PROD')}<small>{tr('mezclas')}</small></>)}
                  {roomTh('RTE', <>RTE<small>{tr('pouches')}</small></>)}
                  {roomTh('RTE', tr('Dif. RTE'))}
                  {roomTh('MFO', 'MFO')}
                  {roomTh('MFO', tr('Dif. MFO'))}
                  {roomTh('Packing', tr('Según cuarto (cs)'))}
                  {roomTh('Packing', <>{tr('Packing')}<small>{tr('cs')}</small></>)}
                  {roomTh('Packing', tr('Dif. Packing'))}
                  <th className="fl-proj">{tr('CS proyectado')}</th>
                  <th className="fl-proj">{tr('Dif. de proyectado')}</th>
                </tr></thead>
                <tbody>{shown.map((l) => (
                  <Fragment key={l.lot}>
                    <tr className="fl-lot"><td colSpan={COLS}><div>
                      <b>{trx('Lote {0}', l.lot)}</b>
                      <span>{daysOf(l.days)}</span>
                      <span>{l.rows.length === 1 ? tr('1 código') : tr('{0} códigos', l.rows.length)}</span>
                      <small>{fmtN(l.sum.cases)} {tr('cajas')}</small>
                      <small>{l.sum.pallets} pallets</small>
                      {l.sum.projected != null && <small>{tr('proyectado {0} cs', n2(l.sum.projected))}</small>}
                      {statesOf(l).map((t) => <small key={t} className="fl-lotstates">{t}</small>)}
                      <span><button type="button" className="drill" onClick={() => onLot(l.lot)}>{tr('Ver en Avance')}</button></span>
                    </div></td></tr>
                    {l.rows.map((r) => { const key = l.lot + '|' + r.code; return <FlujoRowView key={key} r={r} rowKey={key} isOpen={!!open[key]} onToggle={toggle} onLot={onLot} /> })}
                  </Fragment>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
      {notice && <NoticeDialog title={notice.title} text={notice.text} onClose={() => setNotice(null)} />}
    </section>
  )
})

// ---- pieces of a row (outside the components: they depend on nothing of the state) ----
const lab = (d: Dept | null, t: string) => (d ? DEPT_LOOK[d].emoji + ' ' + t : t)
/** a difference cell: the number big, its word under it, the sheet's sign in colour, and the arithmetic as its title */
const difCell = (kind: 'room' | 'cases', v: number | null, unit: string, cls: string, label: string, title: string) => {
  const d = diffText(kind, v, unit)
  return <td className={'slim dif ' + cls + ' ' + d.cls} data-label={label} title={title}>{v == null ? '—' : <><b>{n2(Math.abs(v))}</b><small>{diffWord(kind, v, unit)}</small></>}</td>
}
const offCell = (cls: string, label: string, title: string) => <td className={'slim off ' + cls} data-label={label} title={title}>—</td>
const miniHead = () => <thead><tr><th>{tr('Día')}</th><th>{tr('Mezclas')}</th><th>Spiral</th><th>Pouches</th><th>{tr('Cajas')}</th><th>MFO</th><th>Pallets</th></tr></thead>
const miniRow = (key: string, label: ReactNode, x: AvancePart) => <tr key={key}><td>{label}</td><td>{x.mixes || '—'}</td><td>{x.spiral || '—'}</td><td>{x.pouches ? fmtN(x.pouches) : '—'}</td><td>{x.cases ? fmtN(x.cases) : '—'}</td><td>{mfoText(x.mfo) || '—'}</td><td>{x.pallets || '—'}</td></tr>
const notesOf = (r: FlujoRow) => [
  ...(r.inTable && r.missing.length ? [missingText(r.missing)] : []),
  ...(r.mfoOnlyLb ? [tr('MFO lo registró en libras: no se pasa a cajas')] : []),
  ...(r.otherRte ? [tr('RTE registró {0} pouches de un código que empaca MFO', fmtN(r.pouches))] : []),
  ...(r.otherMfo ? [tr('MFO registró {0} de un código que empaca RTE', mfoText(r.mfo))] : []),
]

/**
 * one code of one lot: its cells, and its fold when open. A memo: drawn again only when its row (a new picture of the
 * runs), its fold or a callback changes, not on each keystroke of the search box
 */
const FlujoRowView = memo(function FlujoRowView({ r, rowKey, isOpen, onToggle, onLot }: { r: FlujoRow; rowKey: string; isOpen: boolean; onToggle: (key: string) => void; onLot: (lot: string) => void }) {
  const rte = r.route === 'RTE'
  const ex = flujoExplain(r, shortDay), titleOf = (k: string) => ex.find((x) => x.key === k)?.text ?? ''
  const word = r.mfoWordUsed ? mfoWord(r.mfoWordUsed) : ''
  const first = r.mfo.find((m) => m.word === r.mfoWordUsed), rest = r.mfo.filter((m) => m.word !== r.mfoWordUsed)
  const lbTitle = tr('MFO lo registró en libras: no se pasa a cajas')
  return (
    <Fragment>
      <tr className={isOpen ? 'avopen' : ''}>
        <td className="avcode" data-label={tr('Código')}>
          <div className="avc-top">
            <button type="button" className="avfold" aria-expanded={isOpen} aria-label={tr('Ver cómo se calculó')} onClick={() => onToggle(rowKey)}>{isOpen ? '▾' : '▸'}</button>
            <button type="button" className="drill code" title={tr('Ver este lote en Avance, en todos sus días')} onClick={() => onLot(r.lot)}>{r.code}</button>
            <small className={'packroom ' + r.route.toLowerCase()} style={deptVars(r.route)} title={r.routeSaid ? tr('Lo dice la tabla de Productos.') : tr('La app lo supone por lo que ha registrado cada cuarto. Se fija en Avance.')}>{DEPT_LOOK[r.route].emoji} {r.route}{r.routeSaid ? '' : ' ?'}</small>
            {r.running && <span className="pill run">{tr('en curso')}</span>}
          </div>
          <small className="pname">{r.name || <i className="red">{tr('no está en Productos')}</i>}</small>
          <span className={'avstage flst st-' + r.state}>{flujoStateText(r.state, r.diffPacking)}</span>
          {notesOf(r).map((t, i) => <small key={i} className="carry amber">{t}</small>)}
        </td>
        <td className="slim fl-yield" data-label={tr('Yield')} title={tr('Cajas por mezcla, de la tabla de Productos (YIEL)')}>{n2(r.yieldCs)}</td>
        <td className="slim fl-percase" data-label={tr('Pouch × cs')} title={tr('Unidades por caja, de la tabla de Productos (POUCH X CS)')}>{n2(r.perCase)}{!rte && word && r.mfoWordUsed !== 'cajas' && <small>{word}</small>}</td>
        <td className="slim fl-prod" data-label={lab('Kitchen', tr('PROD'))} title={titleOf('prod')}>{r.mixes ? <><b>{r.mixes}</b><small>{r.mixRoom}</small></> : '—'}</td>
        {rte
          ? <td className="slim fl-room" data-label={lab('RTE', 'RTE')} title={r.pouches ? tr('{0} pouches registrados por RTE', fmtN(r.pouches)) : tr('RTE no ha registrado nada de este lote')}>{r.pouches ? fmtN(r.pouches) : '—'}</td>
          : offCell('fl-room', lab('RTE', 'RTE'), tr('Lo empaca MFO: RTE no entra en la cuenta'))}
        {rte ? difCell('room', r.diffRte, 'pouches', 'fl-difroom', lab('RTE', tr('Dif. RTE')), titleOf('diffRoom') || titleOf('segun')) : offCell('fl-difroom', lab('RTE', tr('Dif. RTE')), tr('Lo empaca MFO: RTE no entra en la cuenta'))}
        {!rte
          ? <td className="slim fl-room" data-label={lab('MFO', 'MFO')} title={r.mfo.length ? mfoText(r.mfo) : tr('MFO no ha registrado nada de este lote')}>{first ? <>{fmtN(first.qty)} {word}{rest.length > 0 && <small>{tr('y {0}', mfoText(rest))}</small>}</> : r.mfo.length ? <>{mfoText(r.mfo)}</> : '—'}</td>
          : offCell('fl-room', lab('MFO', 'MFO'), tr('Lo empaca RTE: MFO no entra en la cuenta'))}
        {!rte ? difCell('room', r.diffMfo, word || mfoWord('cajas'), 'fl-difroom', lab('MFO', tr('Dif. MFO')), r.mfoOnlyLb ? lbTitle : titleOf('diffRoom') || titleOf('segun')) : offCell('fl-difroom', lab('MFO', tr('Dif. MFO')), tr('Lo empaca RTE: MFO no entra en la cuenta'))}
        <td className="slim fl-segun" data-label={lab('Packing', tr('Según cuarto (cs)'))} title={titleOf('segun')}>{r.segun == null || (r.segun === 0 && r.cases === 0) ? '—' : <>{n2(r.segun)}<small>{tr('según {0}', r.route)}</small></>}</td>
        <td className="slim fl-pack" data-label={lab('Packing', tr('Packing'))} title={tr('Cajas en pallets que llevan este lote')}><b>{fmtN(r.cases)}</b><small>{r.pallets} pallets</small></td>
        {difCell('cases', r.diffPacking, 'cs', 'fl-difpack', lab('Packing', tr('Dif. Packing')), titleOf('diffPacking'))}
        <td className="slim fl-proj" data-label={tr('CS proyectado')} title={titleOf('proj')}>{n2(r.projected)}{r.projected != null && <small>{r.projectedFrom === 'mfo' ? tr('de MFO') : tr('mezclas × yield')}</small>}{r.palletsProjected != null && <small>{n2(r.palletsProjected)} pallets</small>}</td>
        {difCell('cases', r.diffProjected, 'cs', 'fl-difproj', tr('Dif. de proyectado'), titleOf('diffProj') || titleOf('proj'))}
      </tr>
      {isOpen && (
        <tr className="avdetail"><td colSpan={COLS}>
          <div className="avd">
            <div className="avd-block">
              <h4>{tr('Cómo se calculó')}</h4>
              <ul className="flhow">{ex.map((x) => <li key={x.key}><b>{x.label}</b> {x.text}</li>)}</ul>
            </div>
            <div className="avd-block">
              <h4>{tr('Por día')}</h4>
              <table className="avmini">{miniHead()}<tbody>{r.days.map((d) => miniRow(d.date, shortDay(d.date), d))}</tbody></table>
            </div>
            <div className="avd-block">
              <h4>{tr('Lo empaca')}</h4>
              <p>{r.routeSaid ? trx('{0}, según la tabla de Productos. Se cambia en Avance, junto al código.', <b>{r.route}</b>) : trx('{0}, supuesto por lo que ha registrado cada cuarto: por eso lleva un "?". Se fija en Avance, junto al código.', <b>{r.route}</b>)}</p>
              <button type="button" className="drill" onClick={() => onLot(r.lot)}>{trx('Ver el lote {0} en Avance', r.lot)}</button>
            </div>
          </div>
        </td></tr>
      )}
    </Fragment>
  )
})

/** how to read Flujo de datos, in plain words, one tap away (as AvanceHelp) */
function FlujoHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{tr('Cómo leer Flujo de datos')}</h3>
        <ul className="avhelp">
          <li>{tr('Cada fila es un código dentro de un lote. Un lote junta todos sus días (un lote sigue al día siguiente); los más nuevos van primero. Nadie escribe aquí: todo sale de lo que registra cada cuarto y de la tabla de Productos.')}</li>
          <li>{tr('Yield = cajas por mezcla y Pouch × cs = pouches por caja (en un código de MFO, platos o copas por caja), los dos de la tabla de Productos. Una casilla vacía en la tabla no es 0: la celda sale con — y la fila dice qué falta.')}</li>
          <li>{tr('PROD son las mezclas del lote (Kitchen o Spiral, el cuarto que lo hace). RTE son los pouches que registró RTE. MFO es lo que registró MFO tal cual (platos, copas; las libras se muestran pero no se pasan a cajas). Si MFO registró un código con dos palabras en un lote, cuenta la que más tiene y la otra se muestra aparte. Packing son las cajas de los pallets que llevan ese lote (los bins de Packing no son cajas).')}</li>
          <li>{tr('Cada código lo empaca RTE o MFO, nunca los dos: solo se calcula el cuarto que lo empaca y las columnas del otro quedan en blanco. Lo dice la tabla de Productos; con "?" la app lo supone, y se fija en Avance. Si el otro cuarto registró algo, la fila lo avisa.')}</li>
          <li>{tr('Según cuarto (cs) = pouches de RTE ÷ pouches por caja (o lo de MFO ÷ unidades por caja). Dif. RTE = cajas de Packing × pouches por caja − pouches de RTE: "sobran" es lo hecho que todavía no se empacó; "faltan" es que Packing empacó más de lo que RTE reportó. Dif. MFO, igual, en lo que llenan sus bins.')}</li>
          <li>{tr('Dif. Packing = cajas de Packing − Según cuarto: "faltan" en ámbar, "de más" en rojo, "cuadra" en verde cuando la diferencia es de media caja o menos.')}</li>
          <li>{tr('CS proyectado = mezclas × yield. En un código de MFO que ya registró, se prefiere lo de MFO ÷ unidades por caja, como en la hoja de la oficina. Dif. de proyectado = Packing − proyectado. Pallets proyectados = proyectado ÷ cajas por pallet.')}</li>
          <li>{tr('El estado se calcula con los números: Sin empacar (hay registros y ninguna caja), Faltan N cs, N cs de más, Cuadra, o Sin comparar (falta un dato en Productos, o MFO solo registró libras). Estado y consumo del ERP no están aquí: se calcula el estado con los números. La condición (refrigerado) tampoco está en la tabla de Productos.')}</li>
          <li>{tr('Un pallet con dos lotes da a cada lote sus cajas y cuenta como pallet de los dos. Lo que se registra mientras un código sigue corriendo ya cuenta ("en curso"); el pallet que se está armando cuenta cuando se marca listo. Un código que comparte mezcla con otro sale en dos filas por ahora.')}</li>
          <li>{tr('Toca ▸ junto al código para ver cómo se calculó cada número y lo hecho por día. Toca el código, o "Ver en Avance", para abrir ese lote en Avance en todos sus días. El Excel sale con las fechas, el lote y los chips que tengas puestos (no con la búsqueda) y trae una hoja Leyenda con los signos de la hoja de la oficina.')}</li>
        </ul>
        <div className="dbtns"><button type="button" className="btn primary" onClick={onClose}>{tr('Entendido')}</button></div>
      </div>
    </div>
  )
}
