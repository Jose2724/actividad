import { Fragment, memo, useCallback, useEffect, useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { awayDay, cfgOf, dayAfter, dayBefore, fmtN, fmtTime, KEEP_DAYS, lineNameOf, shiftsOf, unitsText, type Dept, type PackRoom, type State } from './store'
import { datesBetween, mfoText, mfoWord, type AvancePart } from './avance'
import { loadDay } from './sync'
import { loadZip, xlsxNow, XLSX_TYPE, type Sheet } from './xlsx'
import { DEPT_LOOK, deptVars } from './look'
import { addDays, download, MISSING, NoticeDialog, Products, shortDay, useCan, useViewOnly } from './App'
import { clockNow } from './clock'
import { spanShifts } from './report'
import { RunEditor, StopEditor } from './editors'
// (a cycle: FlujoView → ReportView → App → FlujoView. Harmless, as editors.tsx's and Settings.tsx's imports of App are:
// nothing of ReportView is used at this module's top level, only inside components drawn long after every module loaded)
import { DeptBadge, RunDetail, useFixers } from './ReportView'
import { diffText, diffWord, FLUJO_STATES, flujoConsumo, flujoExplain, flujoFile, flujoFilter, flujoHasInventory, flujoHecho, flujoLeftMain, flujoLegend, flujoLots, flujoProgLines, flujoRecords, flujoSheet, flujoSheetRow, flujoStateLabel, flujoStateText, flujoSum, missingText, n2, progLine, progSumText, progText, spiralApartText, unitWordText, type FlujoLeft, type FlujoLot, type FlujoRow, type FlujoRun, type FlujoState, type SpiralApart } from './flujo'
import { tr } from './i18n'
import { trx } from './trx'

/**
 * The "Flujo de datos" tab: the office clerk's WO PENDIENTES sheet, lot by lot, computed from what each room records
 * (src/flujo.ts has the arithmetic and the Excel). A tab apart from Avance on purpose: Jose said "yo pensé que esto es
 * lo mismo que tenemos en Avance, pero bueno" (2026-10-18), and it is not: Avance is a day's progress against its
 * program, code by code; this is the clerk's reconciliation per lot between one room and the next, with the sheet's
 * own columns and signs, so he closes work orders without typing the four counts. Nobody types here.
 *
 * COMPACT TABLE + DETAIL WINDOW (Jose, 2026-10-19, from the floor: "sería bueno que si le damos click a algo podamos
 * ver más detalles sin tener que verlo todo en una pantalla, que puede ser confuso"): the table shows six columns per
 * code (Código, Programado, Hecho, Packing, Dif. Packing, Estado) and tapping a row opens its window (FlujoDetail) with
 * the sheet's whole row and its signs, how each number was worked out, the consumo, the lot's program, each day, and
 * every record of the code touching the lot with its pallets, each a tap from the report's own sheet and correction.
 * The fold ▸ of before is gone (the window replaces it). "Ver todas las columnas" puts the sheet's fifteen columns back
 * for the office to compare with its Excel.
 *
 * The filters live at module level (not in sessionStorage): tapping a code opens that lot in Avance, and coming back
 * to this tab finds the same range, lot, chips and search. The range follows the day: a preset (7 / 14 / 30 días) is
 * "back from today", so a device left open on this tab (the office PC) wakes up on the new day's days and not on the
 * days of the day it was first opened (review of 2026-10-18: a lot of today was not listed); dates typed by hand are
 * absolute and stay. The files follow the filters and never the search, as the report's files do (the "rf-foot" line
 * says so). No tfoot: different products do not add up; the tiles carry the case totals of what is in view.
 *
 * CONSUMO (Jose, 2026-10-19: "eso hay que reportarlo para que sepan qué hay y qué no hay en el inventario, para saber
 * qué y cuánto ordenar"): two more columns at the right of the full table (what is left unpacked, the cases without a
 * PO), two tiles "En inventario" over what is in view, a "Consumo" block in the window with the whole detail, and the
 * chip "Con inventario". All of it from the same numbers: nobody types the consumo either.
 */
let kept = { today: '', from: '', to: '', days: KEEP_DAYS, byHand: false, lot: '', q: '', route: '' as PackRoom | '', state: '' as FlujoState | '', inv: false, full: false }
/**
 * Flujo opened on a code from somewhere else: the detail of a production order (Jose, 2026-10-19: "soy partidario de
 * bases de datos relacionadas, para hacer links que llevan a otra información"). The search is the code and the range
 * the order's days, typed as by hand (a preset would move with the day); the chips are let go so the code is in sight.
 * Read when the tab is drawn, so the caller switches to it right after
 */
export function flujoOpenAt(q: string, from: string, to: string, today: string) {
  kept = { ...kept, today, from: from <= to ? from : to, to, byHand: true, lot: '', q, route: '', state: '', inv: false }
}

/**
 * A memo: Main draws itself every second for its clock and this tab shows no clock; drawing ~200 rows took 100-140 ms
 * each second on a PC and several times more on a tablet (review of 2026-10-18). Each row is a memo too (FlujoRowView):
 * a keystroke in the search box draws the list again, not every row's arithmetic in words. The detail window reads
 * its row from the same memoised lots and is mounted only while open, so the clock never draws it either.
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
  const [inv, setInv] = useState(kept.inv)
  // "Ver todas las columnas" (2026-10-19): kept like the other filters, so an office PC that chose the sheet's layout keeps it
  const [full, setFull] = useState(kept.full)
  useEffect(() => { kept = { today, from, to, days, byHand, lot, q, route, state, inv, full } }, [today, from, to, days, byHand, lot, q, route, state, inv, full])
  // a preset moves with the day while the tab stays open (the office PC left on it overnight)
  useEffect(() => { if (!byHand) { const r = spanOf(days); setFrom(r.from); setTo(r.to) } }, [today]) // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (n: number) => { setDays(n); setByHand(false); const r = spanOf(n); setFrom(r.from); setTo(r.to) }
  const [editing, setEditing] = useState(false)
  const [help, setHelp] = useState(false)
  // the detail window (Jose, 2026-10-19): which lot × code is open. Not in `kept`: coming back to the tab must not
  // reopen a window
  const [detail, setDetail] = useState<{ lot: string; code: string } | null>(null)
  const openRow = useCallback((lot: string, code: string) => setDetail({ lot, code }), [])
  const [notice, setNotice] = useState<{ title: string; text?: string } | null>(null)
  const [a, b] = from <= to ? [from, to] : [to, from]
  const span = datesBetween(from, to)
  const preset = (n: number) => from === addDays(today, -(n - 1)) && to === today
  // (s.orders is a dependency since 2026-10-19: "cajas en pedidos" counts the pallets whose PO the orders still know;
  // s.plans too: a program may name its lot, and the lot's rows say what was programmed. Neither moves on the clock)
  const lots = useMemo(() => flujoLots(s, from, to), [s.runs, s.products, s.orders, s.plans, from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  // what the chips count: the route chips over everything of the lot and the search; the state chips over the route
  // chosen; the chip "Con inventario" over the route and the state chosen
  const base = flujoFilter(lots, { q, lot, route: '', state: '' })
  const found = flujoFilter(lots, { q, lot, route, state: '' })
  const staged = flujoFilter(lots, { q, lot, route, state })
  const shown = inv ? flujoFilter(lots, { q, lot, route, state, inv }) : staged
  const forFiles = flujoFilter(lots, { q, lot, route, state, inv }, false)
  const rows = shown.flatMap((l) => l.rows), baseRows = base.flatMap((l) => l.rows), foundRows = found.flatMap((l) => l.rows)
  const routeN = (k: PackRoom) => baseRows.filter((r) => r.route === k).length
  const stateN = (k: FlujoState) => foundRows.filter((r) => r.state === k).length
  const invN = staged.reduce((t, l) => t + l.rows.filter(flujoHasInventory).length, 0)
  const sum = flujoSum(rows)
  // the inventory tiles: big, the first word in view with something left (pouches before MFO's words; "0 pouches" only
  // when nothing is left in any word: review of 2026-10-19), the other words small; and in how many codes and lots
  const { main: leftMain, rest: leftRest } = flujoLeftMain(sum.left)
  const leftRows = sum.left.reduce((t, x) => t + x.rows, 0)
  const lotsWith = (has: (r: FlujoRow) => boolean) => shown.filter((l) => l.rows.some(has)).length
  const unpackedLots = lotsWith((r) => (r.unitsLeft ?? 0) > 0), freeLots = lotsWith((r) => r.casesFree > 0)
  const leftText = (x: FlujoLeft) => fmtN(x.qty) + ' ' + unitWordText(x.word)
  const inText = (codes: number, inLots: number) => (codes === 1 ? tr('1 código') : tr('{0} códigos', codes)) + ' · ' + (inLots === 1 ? tr('1 lote') : tr('{0} lotes', inLots))
  // the lot of the first day in view may have started the day before, and the lot of the last day runs into the day
  // after: both are brought from the server with the range (a lot is counted whole, over every day the device holds)
  useEffect(() => { for (const d of [dayBefore(a), ...span, dayAfter(b)]) if (awayDay(d)) void loadDay(d) }, [from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadZip().catch(() => undefined) }, []) // the Excel's zip library, ahead of the tap
  const away = span.filter((d) => awayDay(d)).length
  const filtering = !!(lot || q.trim() || route || state || inv)
  const clear = () => { setLot(''); setQ(''); setRoute(''); setState(''); setInv(false) }
  const lotList = lots.map((l) => l.lot)
  const cols = full ? 15 : 6
  // the window's row, from the UNFILTERED memo (a chip tapped while it is open does not close it); a row that left the
  // range closes its window (RunDetail's own rule for a run that is gone)
  const detailRow = detail ? lots.find((l) => l.lot === detail.lot)?.rows.find((r) => r.code === detail.code) : undefined
  useEffect(() => { if (detail && !detailRow) setDetail(null) }, [detail, detailRow])
  const viewingOf = (list: FlujoLot[], withQ: boolean) => {
    const n = list.reduce((t, l) => t + l.rows.length, 0)
    return [tr('del {0} al {1}', shortDay(a), shortDay(b)), lot ? tr('lote {0}', lot) : tr('todos los lotes'), route || tr('RTE y MFO'), state ? flujoStateLabel(state) : '', inv ? tr('con inventario') : '', withQ && q.trim() ? '«' + q.trim() + '»' : '', list.length === 1 ? tr('1 lote') : tr('{0} lotes', list.length), n === 1 ? tr('1 código') : tr('{0} códigos', n)].filter(Boolean).join(' · ')
  }
  const viewing = viewingOf(shown, true)
  // ---- the Excel: the sheet's columns, flat, with a Leyenda for the signs; what the filters hold (never the search) ----
  const sheets = (): Sheet[] => [{ name: tr('Flujo de datos'), rows: flujoSheet(forFiles) }, { name: tr('Leyenda'), rows: flujoLegend(viewingOf(forFiles, false)) }]
  const excel = async () => {
    try {
      const bytes = xlsxNow(sheets()) ?? (await loadZip(), xlsxNow(sheets()))
      if (!bytes) throw new Error('xlsx')
      download(new File([bytes], flujoFile(a, b, { lot, route, state, inv }) + '.xlsx', { type: XLSX_TYPE }))
    } catch (e) { console.warn('actividad flujo', e); setNotice({ title: tr('No se pudo {0}', tr('hacer el Excel')), text: MISSING }) }
  }
  // ---- the lot's band: its pieces apart (the "·" between them is drawn by the style, never left alone at a line's end) ----
  // (a lot only programmed, 2026-10-19, has no worked day yet: said, instead of an invalid date)
  const daysOf = (days: string[]) => (days.length ? shortDay(days[0]) + (days.length > 1 ? ' ' + tr('(y {0})', days.slice(1).map(shortDay).join(', ')) : '') : tr('nada registrado todavía'))
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
            {/* EN INVENTARIO (Jose, 2026-10-19): what is left to pack, word by word (pouches never added to platos), and the cases no PO has.
                "por empacar", never "sin empacar": that is the STATE of a code with records and no case at all (chip, badge, band), another thing */}
            <div className="made fl-tile-inv" title={tr('Hecho por el cuarto que empaca y todavía sin meter en cajas, de lo que estás viendo')}>
              <label>{tr('En inventario · por empacar')}</label>
              <b>{fmtN(leftMain.qty)} <span>{unitWordText(leftMain.word)}</span></b>
              <small>{[...leftRest.map(leftText), unpackedLots ? inText(leftRows, unpackedLots) : tr('nada por empacar')].join(' · ')}</small>
            </div>
            <div className="made fl-tile-inv" title={tr('Cajas empacadas que no van en ningún pedido, de lo que estás viendo')}>
              <label>{tr('En inventario · cajas sin pedido')}</label>
              <b>{fmtN(sum.casesFree)} <span>{tr('cs')}</span></b>
              <small>{[tr('{0} cs en pedidos', fmtN(sum.casesOnPo)), freeLots ? inText(sum.freeRows, freeLots) : ''].filter(Boolean).join(' · ')}</small>
            </div>
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
            {/* one more chip, on its own: a row with inventory can be in any state (a "cuadra" row still has cases without a PO) */}
            <div className="chips avstages flinv" role="group" aria-label={tr('Inventario')}>
              <button type="button" className={'chip' + (inv ? ' on' : '')} aria-pressed={inv} title={tr('Solo los códigos con algo por empacar o con cajas sin pedido')} onClick={() => setInv(!inv)}>📦 {tr('Con inventario')} <small>{invN}</small></button>
            </div>
            {/* the office compares the tab with its Excel: the sheet's own fifteen columns, one chip away (Jose, 2026-10-19: the
                compact table is the default because "verlo todo en una pantalla … puede ser confuso") */}
            <div className="chips avstages flcols" role="group" aria-label={tr('Columnas')}>
              <button type="button" className={'chip' + (full ? ' on' : '')} aria-pressed={full} title={tr('La tabla con todas las columnas de la hoja de la oficina, para compararla con el Excel')} onClick={() => setFull(!full)}>⊞ {tr('Ver todas las columnas')}</button>
            </div>
            <button type="button" className="btn sm" onClick={() => setHelp(true)}>{tr('ⓘ Cómo leer Flujo')}</button>
          </div>
          {help && <FlujoHelp onClose={() => setHelp(false)} />}
          {rows.length === 0 ? (
            <p className="hint">{q.trim() ? trx('Ningún código coincide con "{0}".', q.trim()) : tr('Ningún código está así.')} <button type="button" className="lnk sm" onClick={clear}>{tr('Ver todo')}</button></p>
          ) : (
            <div className="twrap">
              <table className={'avtable fltable' + (full ? '' : ' fl-compact')}>
                <thead><tr>
                  <th>{tr('Código')}</th>
                  {full ? (
                    <>
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
                      {/* (short words that wrap under the small CONSUMO caption: fifteen columns must fit a 1280 px screen, review of 2026-10-19) */}
                      <th className="fl-cons"><small>{tr('Consumo')}</small>{tr('Quedan')}<small>{tr('por empacar')}</small></th>
                      <th className="fl-cons"><small>{tr('Consumo')}</small>{tr('Cajas')}<small>{tr('sin pedido')}</small></th>
                    </>
                  ) : (
                    <>
                      {/* the six columns (Jose, 2026-10-19): what was programmed, what the pack room made, what Packing boxed, the difference, the state */}
                      <th className="fl-progcol">{tr('Programado')}<small>{tr('del lote')}</small></th>
                      <th className="fl-hecho">{tr('Hecho')}<small>{tr('por RTE o MFO')}</small></th>
                      {roomTh('Packing', <>{tr('Packing')}<small>{tr('cs')}</small></>)}
                      {roomTh('Packing', tr('Dif. Packing'))}
                      <th className="fl-state">{tr('Estado')}</th>
                    </>
                  )}
                </tr></thead>
                <tbody>{shown.map((l) => (
                  <Fragment key={l.lot}>
                    <tr className="fl-lot"><td colSpan={cols}><div>
                      <b>{trx('Lote {0}', l.lot)}</b>
                      <span>{daysOf(l.days)}</span>
                      <span>{l.rows.length === 1 ? tr('1 código') : tr('{0} códigos', l.rows.length)}</span>
                      <small>{fmtN(l.sum.cases)} {tr('cajas')}</small>
                      <small>{l.sum.pallets} pallets</small>
                      {l.sum.projected != null && <small>{tr('proyectado {0} cs', n2(l.sum.projected))}</small>}
                      {/* the lot's program (2026-10-19): what the office programmed for this lot, each room's word once */}
                      {l.sum.prog.length > 0 && <small className="fl-lotprog">{tr('programado {0}', progSumText(l.sum.prog))}</small>}
                      {statesOf(l).map((t) => <small key={t} className="fl-lotstates">{t}</small>)}
                      {/* the lot's inventory (2026-10-19): each word on its own, and the cases without a PO (with those in POs beside them when there are any) */}
                      {l.sum.left.filter((x) => x.qty > 0).map((x) => <small key={x.word} className="fl-lotinv">{tr('{0} por empacar', leftText(x))}</small>)}
                      <small className="fl-lotinv">{tr('{0} cs sin pedido', fmtN(l.sum.casesFree))}{l.sum.casesOnPo > 0 && ' · ' + tr('{0} en pedidos', fmtN(l.sum.casesOnPo))}</small>
                      <span><button type="button" className="drill" onClick={() => onLot(l.lot)}>{tr('Ver en Avance')}</button></span>
                    </div></td></tr>
                    {l.rows.map((r) => <FlujoRowView key={l.lot + '|' + r.code} r={r} full={full} onOpen={openRow} />)}
                  </Fragment>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
      {detailRow && <FlujoDetail s={s} r={detailRow} onLot={onLot} onSearch={setQ} onPickLot={setLot} onClose={() => setDetail(null)} />}
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
/**
 * "prog. 80 mezclas" under a room's cell: the lot's program of the code in that room (2026-10-19); the window has it against
 * what was made. With two rooms under one cell (PROD: Kitchen and Spiral both programmed) each line names its room
 */
const progOf = (r: FlujoRow, depts: Dept[], title: string) => { const list = r.prog.filter((p) => depts.includes(p.dept)); return list.map((p) => <small key={p.dept} className="fl-prog" title={title}>{progText(p, list.length > 1)}</small>) }
const miniHead = () => <thead><tr><th>{tr('Día')}</th><th>{tr('Mezclas')}</th><th>Spiral</th><th>Pouches</th><th>{tr('Cajas')}</th><th>MFO</th><th>Pallets</th></tr></thead>
// (the Spiral column: its mezclas, and beside them what it weighed or counted apart that day, "1,200 lb": 2026-10-19)
const miniRow = (key: string, label: ReactNode, x: AvancePart & { spiralApart?: SpiralApart[] }) => <tr key={key}><td>{label}</td><td>{x.mixes || '—'}</td><td>{[x.spiral ? String(x.spiral) : '', spiralApartText(x.spiralApart ?? [])].filter(Boolean).join(' · ') || '—'}</td><td>{x.pouches ? fmtN(x.pouches) : '—'}</td><td>{x.cases ? fmtN(x.cases) : '—'}</td><td>{mfoText(x.mfo) || '—'}</td><td>{x.pallets || '—'}</td></tr>
const notesOf = (r: FlujoRow) => [
  ...(r.inTable && r.missing.length ? [missingText(r.missing)] : []),
  ...(r.mfoOnlyLb ? [tr('MFO lo registró en libras: no se pasa a cajas')] : []),
  ...(r.otherRte ? [tr('RTE registró {0} pouches de un código que empaca MFO', fmtN(r.pouches))] : []),
  ...(r.otherMfo ? [tr('MFO registró {0} de un código que empaca RTE', mfoText(r.mfo))] : []),
]
/** the route badge of a row, as the table and the window show it: the room's colour, a "?" when the app supposed it */
const routeBadge = (r: FlujoRow) => <small className={'packroom ' + r.route.toLowerCase()} style={deptVars(r.route)} title={r.routeSaid ? tr('Lo dice la tabla de Productos.') : tr('La app lo supone por lo que ha registrado cada cuarto. Se fija en Avance.')}>{DEPT_LOOK[r.route].emoji} {r.route}{r.routeSaid ? '' : ' ?'}</small>

/**
 * one code of one lot: its six cells (or the sheet's fifteen with "Ver todas las columnas"). The whole row is a tap to
 * its detail window (Jose, 2026-10-19), the code being the visible link and the keyboard's way in. A memo: drawn again
 * only when its row (a new picture of the runs) or the view changes, not on each keystroke of the search box
 */
const FlujoRowView = memo(function FlujoRowView({ r, full, onOpen }: { r: FlujoRow; full: boolean; onOpen: (lot: string, code: string) => void }) {
  const rte = r.route === 'RTE'
  const ex = flujoExplain(r, shortDay), titleOf = (k: string) => ex.find((x) => x.key === k)?.text ?? ''
  const cons = flujoConsumo(r), consOf = (k: string) => cons.find((x) => x.key === k)?.text ?? ''
  const word = r.mfoWordUsed ? mfoWord(r.mfoWordUsed) : ''
  const first = r.mfo.find((m) => m.word === r.mfoWordUsed), rest = r.mfo.filter((m) => m.word !== r.mfoWordUsed)
  const lbTitle = tr('MFO lo registró en libras: no se pasa a cajas')
  // the compact HECHO cell: what the pack room made, with its word, and the mezclas small under it ("80 mezclas · 1,200 lb Spiral")
  const h = flujoHecho(r), pl = flujoProgLines(r.prog)
  const mixLine = [r.mixes ? r.mixes + ' ' + tr('mezclas') : '', r.spiralApart.length ? spiralApartText(r.spiralApart) + ' Spiral' : ''].filter(Boolean).join(' · ')
  return (
    // (a tap on a button of the row, "Ver en Avance" or the code itself, is that button's; anywhere else opens the window.
    // A drag that selects text is not a tap: the office copies names and numbers from here to compare with its Excel, 2026-10-19)
    <tr className="fl-row" onClick={(e) => { if ((e.target as HTMLElement).closest('button')) return; if (window.getSelection()?.toString()) return; onOpen(r.lot, r.code) }}>
      <td className="avcode" data-label={tr('Código')}>
        <div className="avc-top">
          <button type="button" className="drill code" title={tr('Ver el detalle de este código en el lote')} onClick={() => onOpen(r.lot, r.code)}>{r.code}</button>
          {routeBadge(r)}
          {r.running && <span className="pill run" title={titleOf('open')}>{tr('en curso')}</span>}
        </div>
        <small className="pname">{r.name || <i className="red">{tr('no está en Productos')}</i>}</small>
        {full && <span className={'avstage flst st-' + r.state}>{flujoStateText(r.state, r.diffPacking)}</span>}
        {notesOf(r).map((t, i) => <small key={i} className="carry amber">{t}</small>)}
      </td>
      {full ? (
        <>
          <td className="slim fl-yield" data-label={tr('Yield')} title={tr('Cajas por mezcla, de la tabla de Productos (YIEL)')}>{n2(r.yieldCs)}</td>
          <td className="slim fl-percase" data-label={tr('Pouch × cs')} title={tr('Unidades por caja, de la tabla de Productos (POUCH X CS)')}>{n2(r.perCase)}{!rte && word && r.mfoWordUsed !== 'cajas' && <small>{word}</small>}</td>
          {/* PROD: the mezclas with their room; under them what Spiral weighed or counted apart ("1,200 lb Spiral": a fact
              of the lot, never cases nor mezclas; alone when there is no mezcla, so a code Spiral only weighs has its cell: 2026-10-19) */}
          {/* under each room's cell, what the office programmed of the code for this lot in that room ("prog. 80 mezclas", 2026-10-19) */}
          <td className="slim fl-prod" data-label={lab('Kitchen', tr('PROD'))} title={titleOf('prod') || titleOf('spiral') || titleOf('program')}>
            {r.mixes ? <><b>{r.mixes}</b><small>{r.mixRoom}</small></> : r.spiralApart.length ? <b>{spiralApartText(r.spiralApart)}</b> : '—'}
            {r.spiralApart.length > 0 && <small className="fl-spiral" style={deptVars('Spiral')}>{r.mixes ? spiralApartText(r.spiralApart) + ' ' : ''}Spiral</small>}
            {progOf(r, ['Kitchen', 'Spiral'], titleOf('program'))}
          </td>
          {rte
            ? <td className="slim fl-room" data-label={lab('RTE', 'RTE')} title={r.pouches ? tr('{0} pouches registrados por RTE', fmtN(r.pouches)) : tr('RTE no ha registrado nada de este lote')}>{r.pouches ? fmtN(r.pouches) : '—'}{progOf(r, ['RTE'], titleOf('program'))}</td>
            : offCell('fl-room', lab('RTE', 'RTE'), tr('Lo empaca MFO: RTE no entra en la cuenta'))}
          {rte ? difCell('room', r.diffRte, 'pouches', 'fl-difroom', lab('RTE', tr('Dif. RTE')), titleOf('diffRoom') || titleOf('segun')) : offCell('fl-difroom', lab('RTE', tr('Dif. RTE')), tr('Lo empaca MFO: RTE no entra en la cuenta'))}
          {!rte
            ? <td className="slim fl-room" data-label={lab('MFO', 'MFO')} title={r.mfo.length ? mfoText(r.mfo) : tr('MFO no ha registrado nada de este lote')}>{first ? <>{fmtN(first.qty)} {word}{rest.length > 0 && <small>{tr('y {0}', mfoText(rest))}</small>}</> : r.mfo.length ? <>{mfoText(r.mfo)}</> : '—'}{progOf(r, ['MFO'], titleOf('program'))}</td>
            : offCell('fl-room', lab('MFO', 'MFO'), tr('Lo empaca RTE: MFO no entra en la cuenta'))}
          {!rte ? difCell('room', r.diffMfo, word || mfoWord('cajas'), 'fl-difroom', lab('MFO', tr('Dif. MFO')), r.mfoOnlyLb ? lbTitle : titleOf('diffRoom') || titleOf('segun')) : offCell('fl-difroom', lab('MFO', tr('Dif. MFO')), tr('Lo empaca RTE: MFO no entra en la cuenta'))}
          <td className="slim fl-segun" data-label={lab('Packing', tr('Según cuarto (cs)'))} title={titleOf('segun')}>{r.segun == null || (r.segun === 0 && r.cases === 0) ? '—' : <>{n2(r.segun)}<small>{tr('según {0}', r.route)}</small></>}</td>
          <td className="slim fl-pack" data-label={lab('Packing', tr('Packing'))} title={tr('Cajas en pallets que llevan este lote')}><b>{fmtN(r.cases)}</b><small>{r.pallets} pallets</small>{progOf(r, ['Packing'], titleOf('program'))}</td>
          {difCell('cases', r.diffPacking, 'cs', 'fl-difpack', lab('Packing', tr('Dif. Packing')), titleOf('diffPacking'))}
          <td className="slim fl-proj" data-label={tr('CS proyectado')} title={titleOf('proj')}>{n2(r.projected)}{r.projected != null && <small>{r.projectedFrom === 'mfo' ? tr('de MFO') : tr('mezclas × yield')}</small>}{r.palletsProjected != null && <small>{n2(r.palletsProjected)} pallets</small>}</td>
          {difCell('cases', r.diffProjected, 'cs', 'fl-difproj', tr('Dif. de proyectado'), titleOf('diffProj') || titleOf('proj'))}
          {/* CONSUMO (2026-10-19): what is left unpacked, in the room's word, and the cases no PO has; the arithmetic as the title */}
          <td className={'slim fl-cons' + ((r.unitsLeft ?? 0) > 0 ? ' fl-inv' : '')} data-label={tr('Quedan por empacar')} title={consOf('units')}>{r.unitsLeft == null ? '—' : <><b>{fmtN(r.unitsLeft)}</b><small>{unitWordText(r.unitWord)}</small></>}</td>
          <td className={'slim fl-cons' + (r.casesFree > 0 ? ' fl-inv' : '')} data-label={tr('Cajas sin pedido')} title={consOf('cases')}><b>{fmtN(r.casesFree)}</b><small>{tr('{0} en pedidos', fmtN(r.casesOnPo))}</small></td>
        </>
      ) : (
        <>
          {/* PROGRAMADO: the lot's program of this code, each room in its word (named only when the band would name it) */}
          <td className="slim fl-progcol" data-label={tr('Programado')} title={titleOf('program') || tr('Ningún programa nombra este lote')}>
            {pl.length ? pl.map((x) => <span key={x.dept + x.word} className="fl-pl"><b>{fmtN(x.qty)}</b><small>{x.word}</small></span>) : '—'}
          </td>
          {/* HECHO: what the room that packs the code registered of the lot (RTE's pouches, MFO's platos / copas / lb as
              typed), the other MFO word apart, and the mezclas small under it ("80 mezclas · 1,200 lb Spiral") */}
          <td className="slim fl-hecho" data-label={tr('Hecho')} title={rte ? (r.pouches ? tr('{0} pouches registrados por RTE', fmtN(r.pouches)) : tr('RTE no ha registrado nada de este lote')) : (r.mfo.length ? mfoText(r.mfo) : tr('MFO no ha registrado nada de este lote'))}>
            {h.qty === '—' ? '—' : <><b>{h.qty}</b><small>{h.word}</small></>}
            {h.also && <small>{h.also}</small>}
            {mixLine && <small className="fl-mix">{mixLine}</small>}
          </td>
          <td className="slim fl-pack" data-label={lab('Packing', tr('Packing'))} title={tr('Cajas en pallets que llevan este lote')}><b>{fmtN(r.cases)}</b><small>{r.pallets} pallets</small></td>
          {difCell('cases', r.diffPacking, 'cs', 'fl-difpack', lab('Packing', tr('Dif. Packing')), titleOf('diffPacking'))}
          <td className="fl-state" data-label={tr('Estado')}><span className={'avstage flst st-' + r.state}>{flujoStateText(r.state, r.diffPacking)}</span></td>
        </>
      )}
    </tr>
  )
})

/**
 * one code of one lot, whole (Jose, 2026-10-19: "si le damos click a algo podamos ver más detalles sin tener que verlo
 * todo en una pantalla"): the sheet's row with its signs explained, how each number was worked out, the consumo, the
 * lot's program, each day, and every record of the lot with its pallets, each a tap from the report's own sheet and
 * correction (RunDetail and RunEditor, as the Report opens them). Reads the memoised row; mounted only while open, so
 * the clock never draws it. No autofocus, no scrollIntoView, no Escape handler: as every other window here
 */
function FlujoDetail({ s, r, onLot, onSearch, onPickLot, onClose }: { s: State; r: FlujoRow; onLot: (lot: string) => void; onSearch: (code: string) => void; onPickLot: (lot: string) => void; onClose: () => void }) {
  const can = useCan(), { fixable, fix, seeBtn, fixBtn } = useFixers(), id = useId()
  // a snapshot per draw: the window draws only when the store changes, never on the clock's tick, so an open run's
  // "Trabajando" in its RunDetail stands still while the window stays (a reconciliation screen, not the floor's card).
  // A live clock there would need `now` passed from Main through a non-memo wrapper, never into Flujo's memo
  const now = clockNow()
  const [see, setSee] = useState<{ runId: string; at?: number } | null>(null)
  const [edit, setEdit] = useState<{ id: string; at?: number } | null>(null)
  const [stop, setStop] = useState<string | null>(null)
  const ex = useMemo(() => flujoExplain(r, shortDay), [r])
  const cons = useMemo(() => flujoConsumo(r), [r])
  const sheet = useMemo(() => flujoSheetRow(r, shortDay), [r])
  const rec = useMemo(() => flujoRecords(s, r.lot, r.code), [s, r.lot, r.code])
  const runToEdit = edit ? s.runs.find((x) => x.id === edit.id) : undefined
  const stopToEdit = stop ? s.stops.find((x) => x.id === stop) : undefined
  const shiftsOfRun = (x: FlujoRun) => spanShifts(shiftsOf(s, x.run.date), x.run.startedAt, x.run.endedAt ?? now)
  // (a Comentario column only when one record has it: the report's rule, Jose 2026-10-18)
  const runNotes = rec.runs.some((x) => !!x.note), palNotes = rec.pallets.some((p) => !!p.note)
  return (
    <div className="veil fl-veil" onClick={onClose}>
      <div className="dlg wide fl-detail" role="dialog" aria-modal="true" aria-labelledby={id} onClick={(e) => e.stopPropagation()}>
        <h3 id={id}>
          <span className="fl-dt">{trx('Lote {0}', r.lot)} · <span className="code">{r.code}</span></span>
          {r.name ? <small> · {r.name}</small> : <small className="red"> · {tr('no está en Productos')}</small>}
          <span className="fl-dtags">
            {routeBadge(r)}
            <span className={'avstage st-' + r.state}>{flujoStateText(r.state, r.diffPacking)}</span>
            {r.running && <span className="pill run">{tr('en curso')}</span>}
          </span>
          <small className="rp-dsub">{r.days.length ? r.days.map((d) => shortDay(d.date)).join(' · ') : tr('nada registrado todavía')}</small>
        </h3>
        {notesOf(r).map((t, i) => <p key={i} className="fl-dnote amber">{t}</p>)}
        {/* (1) the sheet's row: every WO PENDIENTES column of this code in this lot, each with one line under it */}
        <section className="fl-dsec">
          <h4>{tr('La hoja')}</h4>
          <dl className="fl-sheet">{sheet.map((c) => (
            <div key={c.key} className={'fl-cell' + (c.dept ? ' dth' : '')} style={c.dept ? deptVars(c.dept) : undefined}>
              <dt>{c.dept && <i className="demoji" aria-hidden="true">{DEPT_LOOK[c.dept].emoji}</i>}{c.label}</dt>
              <dd className={c.cls}>
                {c.key === 'state' ? <span className={'avstage st-' + r.state}>{c.value}</span> : <><b>{c.value}</b>{c.word && <small>{c.word}</small>}</>}
                {c.note && <small className="fl-note">{c.note}</small>}
              </dd>
            </div>
          ))}</dl>
        </section>
        {/* (2) and (3): the arithmetic in words, and the consumo */}
        <div className="fl-dcols">
          <section className="fl-dsec"><h4>{tr('Cómo se calculó')}</h4><ul className="flhow">{ex.map((x) => <li key={x.key}><b>{x.label}</b> {x.text}</li>)}</ul></section>
          <section className="fl-dsec"><h4>{tr('Consumo')}</h4><ul className="flhow">{cons.map((x) => <li key={x.key}><b>{x.label}</b> {x.text}</li>)}</ul></section>
        </div>
        {/* (4) the lot's program, room by room, against what the lot has */}
        {r.prog.length > 0 && <section className="fl-dsec"><h4>{tr('Programa del lote')}</h4><ul className="flhow">{r.prog.map((p) => <li key={p.dept}>{progLine(p)}</li>)}</ul></section>}
        {/* (5) each day of the lot */}
        <section className="fl-dsec"><h4>{tr('Por día')}</h4><div className="twrap"><table className="avmini">{miniHead()}<tbody>{r.days.map((d) => miniRow(d.date, shortDay(d.date), d))}</tbody></table></div></section>
        {/* (6) the records: every run of the code touching the lot, each in its room's colour, and the lot's pallets;
            each a tap to the report's sheet ("Ver") and, with the power, to its correction ("Corregir"). On a phone each
            record is a card, as the Report shows the same records (rp-cardlist: its room or pallet on top, each fact with
            its name, the buttons at the foot), so nothing starts off-screen (2026-10-19) */}
        <section className="fl-dsec">
          <h4>{tr('Registros de este lote')}</h4>
          {rec.runs.length === 0 ? <p className="hint">{tr('Ningún cuarto ha registrado este código en este lote.')}</p> : (
            <div className="twrap rp-cardlist"><table className="fl-records">
              <thead><tr><th className="rp-act"></th><th>{tr('Cuarto')}</th><th>{tr('Fecha')}</th><th>{tr('Línea')}</th><th>{tr('Lote')}</th><th>{tr('Hecho')}</th><th>{tr('Horario')}</th><th>{tr('Registró')}</th>{runNotes && <th>{tr('Comentario')}</th>}</tr></thead>
              <tbody>{rec.runs.map((x) => (
                <tr key={x.run.id} className={x.open ? 'live' : undefined} style={deptVars(x.dept)}>
                  <td className="rp-act"><div className="btns">{seeBtn(() => setSee({ runId: x.run.id }))}{fixBtn(shiftsOfRun(x), x.dept, () => setEdit({ id: x.run.id }))}</div></td>
                  <td className="c-head"><DeptBadge d={x.dept} /></td>
                  <td data-label={tr('Fecha')}>{shortDay(x.date)}</td>
                  <td data-label={tr('Línea')}>{x.line}</td>
                  <td data-label={tr('Lote')} className="fl-wrap">{x.lots.join(' · ')}</td>
                  <td data-label={tr('Hecho')} className="fl-wrap"><b>{unitsText(x.dept, x.units, x.qty ?? 0, cfgOf(x.run))}</b>{x.open && <small className="building">{tr('en curso')}</small>}</td>
                  <td data-label={tr('Horario')} className="fl-wrap"><span className="fl-t">{fmtTime(x.startedAt)}</span> – <span className="fl-t">{x.endedAt ? fmtTime(x.endedAt) : tr('en curso')}</span></td>
                  <td data-label={tr('Registró')} className="fl-wrap">{x.who || '—'}</td>
                  {runNotes && <td data-label={tr('Comentario')} className={'rp-note unote' + (x.note ? '' : ' c-none')}>{x.note ? '💬 ' + x.note : '—'}</td>}
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {rec.pallets.length > 0 && (
            <>
              <h5>{rec.pallets.length === 1 ? tr('1 pallet con este lote') : tr('{0} pallets con este lote', rec.pallets.length)}</h5>
              <div className="twrap rp-cardlist"><table className="pallets fl-pallets">
                <thead><tr><th className="rp-act"></th><th>{tr('Pallet')}</th><th>{tr('Fecha')}</th><th>{tr('Línea')}</th><th className="num">{tr('Cajas')}<small>{tr('de este lote')}</small></th><th>{tr('Tag')}</th><th className="num">{tr('Total')}</th><th>PO</th><th>{tr('Hora')}</th><th>{tr('Registró')}</th>{palNotes && <th>{tr('Comentario')}</th>}</tr></thead>
                <tbody>{rec.pallets.map((p) => {
                  // (the pallet being built has no unit yet: its sheet and its correction open on the run, not on a unit)
                  const at = p.open ? undefined : p.at
                  return (
                    <tr key={p.run.id + ':' + p.at} className={p.open ? 'live' : undefined} style={deptVars('Packing')}>
                      <td className="rp-act"><div className="btns">{seeBtn(() => setSee({ runId: p.run.id, at }))}{fixBtn(spanShifts(shiftsOf(s, p.run.date), p.run.startedAt, p.run.endedAt ?? now), 'Packing', () => setEdit({ id: p.run.id, at }))}</div></td>
                      <td className="c-head"><span className="fl-ponly">{tr('Pallet')}</span><b>{p.n}</b>{p.open && <small className="building">{tr('en armado')}</small>}{p.parts.length > 1 && <small className="manylots">{trx('{0} lotes', p.parts.length)}</small>}</td>
                      <td data-label={tr('Fecha')}>{shortDay(p.run.date)}</td>
                      <td data-label={tr('Línea')}>{lineNameOf(s, p.run.lineId, p.run.line)}</td>
                      <td data-label={tr('Cajas de este lote')} className="num"><b>{p.lotQty != null ? fmtN(p.lotQty) : '—'}</b></td>
                      <td data-label={tr('Tag')}>{p.lotTag || <span className="notag">{tr('sin tag')}</span>}</td>
                      <td data-label={tr('Total')} className="num">{fmtN(p.total)}</td>
                      <td data-label="PO" className="fl-wrap">{p.po ? <>{p.poLabel}{p.of && <b className="pof">{p.of[1] ? trx('{0} de {1}', p.of[0], p.of[1]) : p.of[0]}</b>}</> : '—'}</td>
                      <td data-label={tr('Hora')}>{p.open ? '—' : fmtTime(p.at)}</td>
                      <td data-label={tr('Registró')} className="fl-wrap">{p.by || '—'}</td>
                      {palNotes && <td data-label={tr('Comentario')} className={'rp-note unote' + (p.note ? '' : ' c-none')}>{p.note ? '💬 ' + p.note : '—'}</td>}
                    </tr>
                  )
                })}</tbody>
              </table></div>
            </>
          )}
        </section>
        {/* (7) who packs it */}
        <section className="fl-dsec">
          <h4>{tr('Lo empaca')}</h4>
          <p>{r.routeSaid ? trx('{0}, según la tabla de Productos. Se cambia en Avance, junto al código.', <b>{r.route}</b>) : trx('{0}, supuesto por lo que ha registrado cada cuarto: por eso lleva un "?". Se fija en Avance, junto al código.', <b>{r.route}</b>)}</p>
        </section>
        <div className="dbtns spread">
          <button type="button" className="btn soft" onClick={() => onLot(r.lot)}>{trx('Ver el lote {0} en Avance', r.lot)}</button>
          <button type="button" className="btn" onClick={onClose}>{tr('Cerrar')}</button>
        </div>
        {see && <RunDetail s={s} runId={see.runId} at={see.at} now={now} mgr={can('depts')} fix={fix} fixable={fixable} onFix={(at) => setEdit({ id: see.runId, at })} onFixStop={setStop} onCode={(c) => { setSee(null); onClose(); onSearch(c) }} onLot={(l) => { setSee(null); onClose(); onPickLot(l) }} onClose={() => setSee(null)} />}
        {edit && runToEdit && <RunEditor s={s} run={runToEdit} mgr={can('fix')} focusAt={edit.at} onClose={() => setEdit(null)} />}
        {stop && stopToEdit && <StopEditor stop={stopToEdit} mgr={can('fix')} onClose={() => setStop(null)} />}
      </div>
    </div>
  )
}

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
          <li>{tr('El estado se calcula con los números: Sin empacar (hay registros y ninguna caja), Faltan N cs, N cs de más, Cuadra, o Sin comparar (falta un dato en Productos, o MFO solo registró libras). El estado del ERP no está aquí: se calcula con los números. La condición (refrigerado) tampoco está en la tabla de Productos.')}</li>
          <li>{tr('Consumo: lo que el lote gastó y lo que queda, con los mismos números (nadie lo escribe), para reportar qué hay y qué falta por ordenar. Mezclas usadas = lo que reportó el cuarto que empaca, en cajas, ÷ yield; quedan = hechas − usadas. Queda en inventario lo hecho y todavía por empacar (pouches de RTE, o platos y copas de MFO, menos las cajas de Packing × unidades por caja; nunca menos de 0) y las cajas empacadas que no van en ningún pedido (un pallet con PO cuenta como en pedido, esté el pedido completo o no). Los pouches se suman con pouches, nunca con platos. El chip "Con inventario" deja solo los códigos con algo de eso. ("Sin empacar", el estado, es otra cosa: un código con registros y ninguna caja.)')}</li>
          <li>{tr('Un pallet con dos lotes da a cada lote sus cajas, pero cuenta como un solo pallet: en el lote que lleva más cajas de él (si empatan, en el que se escribió primero), para que sumar los lotes nunca dé un pallet de más. En el detalle de un lote, la lista de pallets los muestra todos, también el que cuenta en el otro lote. Lo que se registra mientras un código sigue corriendo ya cuenta ("en curso"); el pallet que se está armando cuenta cuando se marca listo. Un código que comparte mezcla con otro sale en dos filas por ahora.')}</li>
          <li>{tr('Lo que Spiral pesa en libras o cuenta en cajas ("Spiral cuenta en", en la tabla de Productos) sale en PROD debajo de las mezclas, tal cual: no se pasa a cajas ni cuenta como mezclas, porque el yield es por mezcla. Un código que acaba de empezar en cualquier cuarto ya tiene su fila, en ceros y "en curso", y su lote ya está en la lista.')}</li>
          <li>{tr('El programa de un cuarto puede llevar su lote (al programar, sale el lote del día y se puede cambiar o dejar en blanco). Lo programado de un código para un lote sale debajo de la celda de ese cuarto ("prog. 80 mezclas"), en la banda del lote y en el Excel, y al abrir la fila se compara con lo hecho de ese lote. Un código programado para un lote que nadie ha empezado ya tiene su fila, en ceros. Un programa sin lote es del día, como lo muestra Avance, y aquí no se cuenta.')}</li>
          <li>{tr('Toca una fila, o su código, para abrir su detalle: la hoja completa con sus signos, cómo se calculó cada número, el consumo, lo programado del lote, lo hecho por día y los registros del lote con sus pallets; desde ahí se ve y se corrige cada corrida, como en el Reporte. "Ver todas las columnas" pone la tabla como la hoja de la oficina, para compararla con el Excel. "Ver en Avance", en la banda del lote o en el detalle, abre ese lote en Avance en todos sus días. El Excel sale con las fechas, el lote y los chips que tengas puestos (no con la búsqueda) y trae una hoja Leyenda con los signos de la hoja de la oficina.')}</li>
        </ul>
        <div className="dbtns"><button type="button" className="btn primary" onClick={onClose}>{tr('Entendido')}</button></div>
      </div>
    </div>
  )
}
