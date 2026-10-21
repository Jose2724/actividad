import { createContext, memo, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { CFG, closeWorkOrder, PLAN_LOT_MAX, dayOf, deleteWorkOrder, DEPTS, fmtTime, lineNameOf, NOTE_MAX, normCode, numOf, orderKind, orderQueue, ordersOf, orderStatus, orderUnitDefault, orderUnitWord, planLinesOf, productOf, reopenWorkOrder, resealGroup, saveWorkOrder, shiftsOf, stateWith, whoText, woQueue, workOrderOf, writesRoom, WO_MAX, WO_UNITS, type Change, type Dept, type OrderStatus, type Run, type State, type WorkOrder } from './store'
import { bringWorkOrderRuns, loadOrderRows, syncStore } from './sync'
import { supabase } from './supabase'
import { clockNow } from './clock'
import { addDays, ConfirmDialog, shortDay, useCan, useWho } from './App'
// (a cycle: WorkOrders → ReportView → App → WorkOrders, harmless as FlujoView's: nothing of these modules is used at
// this module's top level, only inside components drawn long after every module loaded)
import { DeptBadge, RunDetail, useFixers } from './ReportView'
import { RunEditor, StopEditor } from './editors'
import { runLots, spanShifts } from './report'
import { DEPT_LOOK, deptVars } from './look'
import { writesIn } from './powers'
import { tr } from './i18n'
import { trx } from './trx'
import { orderDayLine, recountOffer, woMatch, woN, woTokens } from './woSum'

/**
 * THE PRODUCTION ORDERS ON SCREEN (Jose and the office clerk, 2026-10-19). The clerk's correction, as Jose relayed it:
 * "No es una cantidad por lote, es una cantidad por mezcla: el pedido es de 1000 mezclas; el día 1 se programa hacer
 * 80 ... el día 1 hicieron 50, le quedan pendientes 30 ... de los 920 se sumaría 30 ... 950 ... 880 disponible para el
 * día 3". An order is typed once (a room, a code, the total in the room's unit, a start day, optionally its WO number
 * and a note); each day's program is a part of it; what the day did not make goes back to the order (never carried as
 * a program: the office programs every day again, and the card only says what yesterday left). The numbers are the
 * store's (orderStatus, see "the production orders of each room" in store.ts): this file only shows them.
 *
 * Where each piece is (Jose: "soy partidario de bases de datos relacionadas, para hacer links que llevan a otra
 * información"): the room's Programa tab has two parts, "Hoy" (the day's program, PlanCard in App.tsx, and the room's
 * open orders, OpenOrders) and "Pedidos de producción" (every order, OrderHistory, with search and filters; for whoever
 * reads every room it is also the all-rooms view, with the room chips). Every order opens its window (OrderDetail): the
 * office's sum day by day, when and with which record it was completed, who typed, changed or closed it, the records
 * that counted (each a tap from the report's own sheet and correction), and links to Flujo and Avance.
 * No autofocus, no scrollIntoView, as every other window of the app.
 */

/** an order by its number: "WO 4512", or "sin WO" (the number is optional) */
export const woName = (o: Pick<WorkOrder, 'wo'>) => (o.wo ? 'WO ' + o.wo : tr('sin WO'))
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)
/** whole days from one date to another (noon to noon: a change of the clocks does not make 23 or 25 hours a day less or more) */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86_400_000)
export const daysText = (n: number) => (n === 1 ? tr('1 día') : tr('{0} días', n))
/** the start day of an order as a cell says it: "hoy", or the day (with how long ago when older: Jose's "desde" mark) */
export const startText = (o: WorkOrder, today: string) => (o.startDate === today ? tr('hoy') : shortDay(o.startDate))
/** the numbers can be short: with a server, the device does not hold every record of the order's days yet */
export const shortOf = (st: OrderStatus) => !!supabase && !st.complete && !st.sealed
const SHORT_TITLE = () => tr('Faltan días viejos de este pedido en este aparato: los números pueden cambiar cuando lleguen del servidor.')

/**
 * A part of the screen brought back into view when it is hidden above, after what a tap changes is drawn: the history's
 * pager and "Ver todos los pedidos de producción ›" make the page shorter or start a new page, and the browser left the
 * person at the foot of it with the search, the filters and the first orders far above (review of 2026-10-20). The
 * Report's own rule (ReportView, reveal): never a scroll when the part is in view, below the app's bar
 */
export function revealAbove(el: Element | null | undefined) {
  requestAnimationFrame(() => {
    if (!el) return
    const bar = Math.max(0, document.querySelector('header.top')?.getBoundingClientRect().bottom ?? 0)
    const gap = el.getBoundingClientRect().top - bar - 8
    if (gap < -8) window.scrollBy(0, gap)
  })
}

/** an order's state as a tag: open (or waiting for its start day), completed or closed on a day, deleted */
export function WoStateTag({ o, st }: { o: WorkOrder; st: OrderStatus }) {
  if (st.state === 'completado') return <span className="wost st-done">{st.finishDay ? tr('✓ Completado el {0}', shortDay(st.finishDay)) : tr('✓ Completado')}</span>
  if (st.state === 'cerrado') return <span className="wost st-closed">{st.finishDay ? tr('Cerrado el {0}', shortDay(st.finishDay)) : tr('Cerrado')}</span>
  if (st.state === 'borrado') return <span className="wost st-gone">{tr('Borrado')}</span>
  if (st.waiting) return <span className="wost st-wait">{tr('Empieza el {0}', shortDay(o.startDate))}</span>
  return <span className="wost st-open">{tr('Abierto')}</span>
}
/** made against the total: a bar and its percent */
function WoBar({ o, st }: { o: WorkOrder; st: OrderStatus }) {
  const pct = o.qty > 0 ? Math.max(0, Math.min(100, Math.floor((st.made / o.qty) * 100))) : 0
  return <><div className="bar"><i className={pct >= 100 ? 'ok' : 'pend'} style={{ width: pct + '%' }} /></div><small>{pct}%</small></>
}

/**
 * Where the order's window leads beyond the room (Main gives them, for whoever has those tabs): Flujo de datos on the
 * code over the order's days, Avance on one of its lots
 */
export type WoNav = { openFlujo?: (code: string, from: string, to: string) => void; openLot?: (lot: string) => void }
export const WoNavCtx = createContext<WoNav>({})

/**
 * Closing, reopening or deleting an order, each asked first with what it does (the texts are Jose's model of
 * 2026-10-19: a closed order takes nothing more and what comes counts for the next open one; reopening counts it as if
 * it had never been closed; deleting is for an order typed by mistake). Red only for deleting
 */
export type WoAskKind = 'close' | 'reopen' | 'delete'
export function WoAsk({ s, o, what, today, onDone, onNo }: { s: State; o: WorkOrder; what: WoAskKind; today: string; onDone: () => void; onNo: () => void }) {
  const st = orderStatus(s, o, today), unit = orderUnitWord(o), name = woName(o) + ' · ' + o.code
  if (what === 'close') return <ConfirmDialog title={tr('¿Cerrar el pedido {0}?', name)} text={tr('Lleva {0} de {1} {2}. Desde ahora, lo que {3} registre de {4} ya no cuenta para este pedido (cuenta para el siguiente abierto, si hay). Se puede reabrir.', woN(st.made), woN(o.qty), unit, o.dept, o.code)} yes={tr('🔒 Cerrar pedido')} onYes={() => { closeWorkOrder(o.id); onDone() }} onNo={onNo} />
  if (what === 'reopen') return <ConfirmDialog title={tr('¿Reabrir el pedido {0}?', name)} text={tr('Vuelve a contar todo lo que {0} registró de {1} desde el {2}, también lo de mientras estuvo cerrado.', o.dept, o.code, shortDay(o.startDate))} yes={tr('Reabrir')} onYes={() => { reopenWorkOrder(o.id); onDone() }} onNo={onNo} />
  return <ConfirmDialog title={tr('¿Borrar el pedido {0}?', name)} text={tr('Es para un pedido puesto por error. Sale de todas las pantallas (el servidor lo guarda) y lo hecho cuenta para los otros pedidos del código. Los programas que lo nombraban quedan sin pedido.')} yes={tr('🗑 Borrar pedido')} danger onYes={() => { deleteWorkOrder(o.id); onDone() }} onNo={onNo} />
}

// a made-up id for the order being typed, to show what it would count before it is saved (never saved with it)
const DRAFT_ID = '00000000-0000-4000-8000-000000000000'
/**
 * The office types an order (new), or changes one (order). Its room, code and unit decide what counts for it, so they
 * stay as typed (store.ts, saveWorkOrder: to fix one, delete the order and type it again); its total, start day, WO
 * number and note can change. A new order may come from the program dialog ("+ Crear pedido"): its room, code, unit and
 * day come with it, and the total is left EMPTY (Jose's rule: nothing the person would type is guessed). With a start
 * day already past, it says what the room already made of the code since then (it counts at once)
 */
export function WorkOrderDialog({ s, dept, today, order, start, onClose, onSaved }: { s: State; dept: Dept; today: string; order?: WorkOrder; start?: { code?: string; lot?: string; unit?: string; startDate?: string }; onClose: () => void; onSaved?: (id: string) => void }) {
  const room = order?.dept ?? dept
  const [code, setCode] = useState(order?.code ?? start?.code ?? '')
  const [qty, setQty] = useState(order ? String(order.qty) : '')
  // the lot (Jose, 2026-10-20: "falta poner el lote"): optional; with one, only that lot counts for the order
  const [lot, setLot] = useState(order?.lot ?? start?.lot ?? '')
  // the unit tapped ('' = the code's own: the products table's in Spiral, the last bins' in MFO)
  const [picked, setPicked] = useState(order ? '' : start?.unit && WO_UNITS[room].includes(start.unit) ? start.unit : '')
  const [startDate, setStartDate] = useState(order?.startDate ?? start?.startDate ?? today)
  const [wo, setWo] = useState(order?.wo ?? '')
  const [note, setNote] = useState(order?.note ?? '')
  const [tried, setTried] = useState(false)
  const [failed, setFailed] = useState(false)
  const [ask, setAsk] = useState<WoAskKind | null>(null)
  const key = normCode(code), n = numOf(qty)
  const unit = order ? order.unit || WO_UNITS[room][0] : picked || (key ? orderUnitDefault(s, room, key) : WO_UNITS[room][0])
  const unitWord = orderUnitWord({ dept: room, unit })
  const product = key ? productOf(s, key) : undefined
  const choose = WO_UNITS[room].length > 1 && !order
  const st = order ? orderStatus(s, order, today) : null
  // the other open orders of the code in that unit: what is made counts first for the oldest (or the day's program's)
  const others = useMemo(() => (key ? s.workOrders.filter((x) => !x.deleted && x.id !== order?.id && orderQueue(x) === woQueue(room, key, orderKind({ dept: room, unit })) && orderStatus(s, x, today).state === 'abierto') : []), [s, key, room, unit, today, order?.id])
  // what it would count with a start day already past (worked out on a copy of the state with this order in it)
  const preview = useMemo(() => {
    if (!key || !(n > 0) || !isDate(startDate) || startDate >= today) return null
    const draft: WorkOrder = order ? { ...order, lot: lot.trim(), qty: n, startDate } : { id: DRAFT_ID, dept: room, code: key, lot: lot.trim(), wo: '', qty: n, unit, startDate, note: '', createdAt: clockNow(), createdBy: '', closedAt: null, closedBy: '', updatedAt: 0 }
    return orderStatus({ ...s, workOrders: [...s.workOrders.filter((x) => x.id !== draft.id), draft] }, draft, today)
  }, [s, key, lot, n, startDate, unit, today, order, room])
  const save = () => {
    setTried(true)
    if (!key || !(n > 0) || !isDate(startDate)) return
    const id = saveWorkOrder({ dept: room, code: key, lot, qty: n, unit, startDate, wo, note }, order?.id)
    if (!id) { setFailed(true); return }
    onSaved?.(id)
    onClose()
  }
  const listId = 'wo-codes-' + room
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg wo-dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{order ? tr('Pedido de producción {0} · {1}', order.code, room) : tr('Nuevo pedido de producción · {0}', room)}</h3>
        <p>{tr('Un pedido es cuánto hay que hacer de un código en este cuarto, en total. Cada día se programa una parte de él; lo que el día no hace vuelve al pedido.')}</p>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); save() }}>
          {order ? (
            <div className="wo-locked">
              <span><DeptBadge d={room} /> <b className="code">{order.code}</b>{product && <small> · {product.name}</small>} · {unitWord}</span>
              <small>{tr('No se cambia: si está mal, bórralo y créalo de nuevo.')}</small>
            </div>
          ) : (
            <label>{tr('Código')}{' '}
              <input list={listId} value={code} placeholder={tr('ej. 0100')} autoComplete="off" aria-label={tr('Código')} onChange={(e) => { setCode(e.target.value); setFailed(false) }} />
              {product && <small>{product.name}</small>}
              {tried && !key && <span className="err">{tr('Pon el código.')}</span>}
            </label>
          )}
          <label>{tr('Lote')}{' '}<input value={lot} maxLength={PLAN_LOT_MAX} placeholder={tr('opcional')} autoComplete="off" aria-label={tr('Lote')} onChange={(e) => { setLot(e.target.value); setFailed(false) }} />
            <small>{tr('Con lote, solo ese lote cuenta para el pedido. Si el pedido lleva varios lotes, déjalo vacío.')}</small>
          </label>
          {!order && <datalist id={listId}>{s.products.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</datalist>}
          <label>{tr('Cantidad total')}{' '}
            <span className="wo-qty"><input value={qty} inputMode="decimal" placeholder="0" autoComplete="off" aria-label={tr('Cantidad total')} onChange={(e) => { setQty(e.target.value.replace(/[^\d.,]/g, '')); setFailed(false) }} /><b>{unitWord}</b></span>
            {tried && !(n > 0) && <span className="err">{tr('Pon cuánto en total.')}</span>}
          </label>
          {/* the unit: chosen only in Spiral (mezclas, or the pounds / cases its codes are counted in) and MFO (platos, copas, pounds) */}
          {choose && (
            <div className="wo-units">
              <span className="lab">{tr('Unidad')}</span>
              <div className="chips">{WO_UNITS[room].map((u) => <button key={u} type="button" className={'chip' + (unit === u ? ' on' : '')} aria-pressed={unit === u} onClick={() => setPicked(u)}>{orderUnitWord({ dept: room, unit: u })}</button>)}</div>
            </div>
          )}
          <label>{tr('Empieza el')}{' '}<input type="date" value={startDate} aria-label={tr('Empieza el')} onChange={(e) => { if (e.target.value) setStartDate(e.target.value) }} /></label>
          <label>{tr('N° de pedido (WO)')}{' '}<input value={wo} maxLength={WO_MAX} placeholder={tr('opcional')} autoComplete="off" aria-label={tr('N° de pedido (WO)')} onChange={(e) => setWo(e.target.value)} /></label>
          <label>{tr('Nota')}{' '}<input value={note} maxLength={NOTE_MAX} placeholder={tr('opcional')} autoComplete="off" aria-label={tr('Nota')} onChange={(e) => setNote(e.target.value)} /></label>
          <p className="hint">{trx('Lo que {0} registre de {1} desde el {2} cuenta para este pedido, en {3}.', room, <b className="code">{(key || '…') + (lot.trim() ? ' · ' + tr('lote {0}', lot.trim()) : '')}</b>, isDate(startDate) ? shortDay(startDate) : '…', unitWord)}</p>
          {preview && <p className="hint ok">{tr('Con lo ya registrado desde ese día, a este pedido le tocan {0}: quedan {1} disponibles.', woN(preview.made), woN(preview.disponible))}{shortOf(preview) && ' ' + tr('(con los días que tiene este aparato)')}</p>}
          {others.length > 0 && <p className="hint amber">{others.length === 1 ? tr('Ya hay 1 pedido abierto de {0} en {1}: lo hecho cuenta primero para el más viejo, o para el que diga el programa del día.', key, room) : tr('Ya hay {0} pedidos abiertos de {1} en {2}: lo hecho cuenta primero para el más viejo, o para el que diga el programa del día.', others.length, key, room)}</p>}
          {failed && <p className="hint red">{tr('No se pudo guardar: revisa el código, la cantidad y el día.')}</p>}
          <div className={'dbtns' + (order ? ' spread' : '')}>
            {order && st && (
              <div className="btns">
                {order.closedAt != null ? <button type="button" className="btn soft" onClick={() => setAsk('reopen')}>{tr('Reabrir')}</button> : st.state === 'abierto' && <button type="button" className="btn" onClick={() => setAsk('close')}>{tr('🔒 Cerrar pedido')}</button>}
                <button type="button" className="btn danger" onClick={() => setAsk('delete')}>{tr('🗑 Borrar pedido')}</button>
              </div>
            )}
            <div className="btns">
              <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
              <button type="submit" className="btn primary">{tr('✓ Guardar pedido')}</button>
            </div>
          </div>
        </form>
        {ask && order && <WoAsk s={s} o={order} what={ask} today={today} onNo={() => setAsk(null)} onDone={() => { setAsk(null); onClose() }} />}
      </div>
    </div>
  )
}

/**
 * The room's open production orders, under its day's program ("Hoy"): each with its total, since when, what is made,
 * what is available (Disponible: the total less everything made), what is not programmed yet, its bar, and its window.
 * Whoever holds "Productos y programa" in this room types a new one and closes one from here. A memo: Main draws itself
 * every second for its clock, and this list only changes with the store or the day
 */
export const OpenOrders = memo(function OpenOrders({ s, dept, today, edit, onAll }: { s: State; dept: Dept; today: string; edit: boolean; onAll: () => void }) {
  const [detail, setDetail] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [closing, setClosing] = useState<string | null>(null)
  const closeDetail = useCallback(() => setDetail(null), [])
  const list = useMemo(() => ordersOf(s, dept, today).filter((x) => x.status.state === 'abierto'), [s, dept, today])
  if (!list.length && !edit) return null
  const closingO = closing ? workOrderOf(s, closing) : undefined
  // (its windows beside the card, not inside it: the card's table rules restyled theirs; review of 2026-10-20)
  return (
    <>
    <div className="plan woopen">
      <div className="tc-head">
        <h3>{trx('Pedidos de producción abiertos en {0}', dept)}<small> · {list.length}</small></h3>
        {edit && <button type="button" className="btn soft sm" onClick={() => setAdding(true)}>{tr('+ Nuevo pedido')}</button>}
      </div>
      {list.length ? (
        <div className="twrap rp-cardlist wo-cards">
          <table className="wotable">
            <thead><tr><th>{tr('Código')}</th><th>WO</th><th className="num">{tr('Total')}</th><th>{tr('Desde')}</th><th className="num">{tr('Hecho')}</th><th className="num">{tr('Disponible')}</th><th className="num">{tr('Sin programar')}</th><th className="wo-barcol"></th><th className="rp-act"></th></tr></thead>
            <tbody>{list.map(({ order: o, status: st }) => {
              const name = productOf(s, o.code)?.name, unit = orderUnitWord(o), old = o.startDate < today ? daysBetween(o.startDate, today) : 0
              return (
                <tr key={o.id} style={deptVars(o.dept)}>
                  <td className="c-head"><button type="button" className="drill code" title={tr('Ver el pedido')} onClick={() => setDetail(o.id)}>{o.code}</button>{o.lot && <small className="wo-lot"> {tr('lote {0}', o.lot)}</small>}{name && <small className="pname">{name}</small>}{st.waiting && <WoStateTag o={o} st={st} />}</td>
                  <td data-label="WO">{o.wo || <span className="wo-none">{tr('sin WO')}</span>}</td>
                  <td className="num" data-label={tr('Total')}>{woN(o.qty)} <small>{unit}</small></td>
                  <td data-label={tr('Desde')} className={old ? 'old' : undefined}>{st.waiting ? tr('empieza el {0}', shortDay(o.startDate)) : startText(o, today)}{old > 0 && <small className="wo-age"> 🕒 {daysText(old)}</small>}</td>
                  <td className="num" data-label={tr('Hecho')} title={shortOf(st) ? SHORT_TITLE() : undefined}>{woN(st.made)}{shortOf(st) && <small className="wo-short"> …</small>}</td>
                  <td className="num" data-label={tr('Disponible')}><b>{woN(st.disponible)}</b></td>
                  <td className="num" data-label={tr('Sin programar')}>{woN(st.sinProgramar)}{st.pendingToday > 0 && <small className="wo-sub">{tr('{0} pendientes en programas', woN(st.pendingToday))}</small>}</td>
                  <td className="wo-barcol" data-label={tr('Hecho del total')}><WoBar o={o} st={st} /></td>
                  <td className="rp-act"><div className="btns">
                    <button type="button" className="btn xs" onClick={() => setDetail(o.id)}>{tr('Ver')}</button>
                    {edit && <button type="button" className="btn xs" onClick={() => setClosing(o.id)}>{tr('🔒 Cerrar')}</button>}
                  </div></td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      ) : (
        <div className="woempty">
          <p className="hint">{trx('{0} no tiene pedidos de producción abiertos.', dept)}</p>
          <p className="hint">{tr('Con un pedido, el programa de cada día es una parte de él: lo que el día no hace vuelve al pedido.')}</p>
        </div>
      )}
      {list.length > 0 && <p className="hint">{tr('Disponible = el total menos todo lo hecho para el pedido. Sin programar = lo disponible que todavía no está en un programa.')}</p>}
      <div className="wofoot"><button type="button" className="btn sm" onClick={onAll}>{tr('Ver todos los pedidos de producción ›')}</button></div>
    </div>
    {detail && <OrderDetail s={s} id={detail} today={today} edit={edit} onClose={closeDetail} />}
    {adding && <WorkOrderDialog s={s} dept={dept} today={today} onClose={() => setAdding(false)} />}
    {closingO && <WoAsk s={s} o={closingO} what="close" today={today} onNo={() => setClosing(null)} onDone={() => setClosing(null)} />}
    </>
  )
})

type HistState = '' | 'abierto' | 'completado' | 'cerrado'
const HIST_PAGE = 50
/**
 * The history's choices, kept while the page stays open, as Flujo keeps its own (review of 2026-10-20: the office's
 * "pendiente total" of every open order of every room was 3-4 taps away every time, and lost on the next room or tab).
 * One view for whoever reads every room (its room chip is part of it), one per room for the others
 */
type HistView = { room: Dept | ''; q: string; only: HistState; from: string; to: string; by: 'start' | 'finish' }
const histKept = new Map<string, HistView>()
/**
 * Every production order (Jose, 2026-10-19): the room's, or with the room chips every room's for whoever reads them all
 * (managers, the office, "Solo ver": the all-rooms view lives here, one tap from every room, rather than as a sixth tab
 * on a phone or in the Reporte, which is one day). Searched by code, WO number, lot or note; filtered by state and by
 * dates, of their start or of when they finished; fifty a page. Each opens its window. Orders whose old days this
 * device does not hold yet are asked from the server once, and the screen says so while they come
 */
export const OrderHistory = memo(function OrderHistory({ s, dept, today, edit, readsAll }: { s: State; dept: Dept; today: string; edit: boolean; readsAll: boolean }) {
  const who = useWho()
  // whoever reads every room starts on all of them (the office's view of every open order, Jose 2026-10-19); the
  // others on their room. What was chosen last stays
  const home: Dept | '' = readsAll ? '' : dept, keyOf = readsAll ? '*' : dept
  const was = histKept.get(keyOf) ?? { room: home, q: '', only: '' as HistState, from: '', to: '', by: 'start' as const }
  const [room, setRoom] = useState<Dept | ''>(readsAll ? was.room : dept)
  const [q, setQ] = useState(was.q)
  const [only, setOnly] = useState<HistState>(was.only)
  const [from, setFrom] = useState(was.from)
  const [to, setTo] = useState(was.to)
  const [by, setBy] = useState<'start' | 'finish'>(was.by)
  useEffect(() => { histKept.set(keyOf, { room, q, only, from, to, by }) }, [keyOf, room, q, only, from, to, by])
  const [page, setPage] = useState(0)
  const topRef = useRef<HTMLDivElement>(null)
  const turn = (p: number) => { setPage(p); revealAbove(topRef.current) }
  const [detail, setDetail] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const closeDetail = useCallback(() => setDetail(null), [])
  const all = useMemo(() => ordersOf(s, null, today), [s, today])
  const rooms: Dept[] = readsAll ? DEPTS : [dept]
  // every word typed, in the code, WO, note, product or lots ("0889", "WO 4512", "A100 6290": woMatch in woSum.ts)
  const toks = woTokens(q)
  const hits = (x: (typeof all)[number]) => { const p = productOf(s, x.order.code); return woMatch({ code: x.order.code, productCode: p?.code, wo: x.order.wo, note: x.order.note, name: p?.name, lots: x.status.lots }, toks) }
  const inDates = (x: (typeof all)[number]) => {
    if (!from && !to) return true
    const d = by === 'start' ? x.order.startDate : x.status.finishDay
    return !!d && (!from || d >= from) && (!to || d <= to)
  }
  const found = all.filter((x) => rooms.includes(x.order.dept) && hits(x) && inDates(x))
  const inRoom = found.filter((x) => !room || x.order.dept === room)
  const count = (k: HistState) => (k ? inRoom.filter((x) => x.status.state === k).length : inRoom.length)
  const list = only ? inRoom.filter((x) => x.status.state === only) : inRoom
  const pages = Math.max(1, Math.ceil(list.length / HIST_PAGE)), at = Math.min(page, pages - 1)
  const shown = list.slice(at * HIST_PAGE, (at + 1) * HIST_PAGE)
  const preset = (n: number) => from === addDays(today, -(n - 1)) && to === today
  const pick = (n: number) => { setFrom(addDays(today, -(n - 1))); setTo(today); setPage(0) }
  const filtering = !!(toks.length || only || from || to || room !== home)
  const clear = () => { setQ(''); setOnly(''); setFrom(''); setTo(''); setRoom(home); setPage(0) }
  // the old days of the orders in view that this device does not hold yet: asked once per queue while the view is open
  const sync = useSyncStatus()
  const asked = useRef(new Set<string>())
  const [asking, setAsking] = useState<'' | 'busy' | 'failed'>('')
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const want = [...new Set(list.filter((x) => shortOf(x.status)).map((x) => orderQueue(x.order)))].filter((x) => !asked.current.has(x)).join(',')
  useEffect(() => {
    if (!supabase || !want) return
    const qs = want.split(',')
    for (const x of qs) asked.current.add(x)
    setAsking('busy')
    void bringWorkOrderRuns(qs).then((ok) => { if (live.current) setAsking(ok ? '' : 'failed') })
  }, [want])
  const stillShort = list.some((x) => shortOf(x.status))
  const canEdit = (o: WorkOrder) => edit && writesIn(who, o.dept)
  return (
    <>
    <div className="plan wohist" ref={topRef}>
      <div className="tc-head">
        <h3>{readsAll && !room ? tr('Pedidos de producción · todos los cuartos') : trx('Pedidos de producción de {0}', room || dept)}<small> · {list.length}</small></h3>
        {edit && <button type="button" className="btn soft sm" onClick={() => setAdding(true)}>{tr('+ Nuevo pedido')}</button>}
      </div>
      <div className="rfilters wofilters">
        <div className="rf-row">
          <label className="rf grow"><span className="lab">{tr('Buscar')}</span><input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder={tr('Código, WO, lote o nota')} autoComplete="off" /></label>
          <div className="rf"><span className="lab">{tr('Estado')}</span>
            <div className="chips wostates" role="group" aria-label={tr('Estado')}>
              {(['', 'abierto', 'completado', 'cerrado'] as const).map((k) => (
                <button key={k} type="button" className={'chip sm st-' + (k || 'all') + (only === k ? ' on' : '')} aria-pressed={only === k} onClick={() => { setOnly(k); setPage(0) }}>
                  {k === '' ? tr('Todos') : k === 'abierto' ? tr('Abiertos') : k === 'completado' ? tr('Completados') : tr('Cerrados')}<small>{count(k)}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
        {readsAll && (
          <div className="rp-chips" role="group" aria-label={tr('Cuarto')}>
            <button type="button" className={'rp-chip' + (!room ? ' on' : '')} aria-pressed={!room} onClick={() => { setRoom(''); setPage(0) }}><span className="em" aria-hidden="true">🏭</span><span>{tr('Todos')}</span></button>
            {DEPTS.map((d) => {
              const n = found.filter((x) => x.order.dept === d).length
              return <button key={d} type="button" className={'rp-chip' + (room === d ? ' on' : '') + (n ? '' : ' none')} style={deptVars(d)} aria-pressed={room === d} onClick={() => { setRoom(d); setPage(0) }}><span className="em" aria-hidden="true">{DEPT_LOOK[d].emoji}</span><span>{d}</span></button>
            })}
          </div>
        )}
        <div className="rf">
          <span className="lab">{tr('Fechas')}</span>
          <div className="wo-dates">
          <div className="seg wo-by">
            <button type="button" className={by === 'start' ? 'on' : ''} aria-pressed={by === 'start'} onClick={() => { setBy('start'); setPage(0) }}>{tr('Por inicio')}</button>
            <button type="button" className={by === 'finish' ? 'on' : ''} aria-pressed={by === 'finish'} onClick={() => { setBy('finish'); setPage(0) }}>{tr('Por terminado')}</button>
          </div>
          <div className="rangepick">
            <label>{tr('Desde')} <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0) }} /></label>
            <label>{tr('Hasta')} <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0) }} /></label>
            {[7, 30, 90].map((n) => <button key={n} type="button" className={'chip sm' + (preset(n) ? ' on' : '')} aria-pressed={preset(n)} onClick={() => pick(n)}>{tr('{0} días', n)}</button>)}
            {(from || to) && <button type="button" className="chip sm" onClick={() => { setFrom(''); setTo(''); setPage(0) }}>{tr('Todas las fechas')}</button>}
          </div>
          </div>
        </div>
        {filtering && <div className="rf-now"><button type="button" className="btn sm" onClick={clear}>{tr('✕ Quitar filtros')}</button></div>}
      </div>
      {stillShort && supabase && <p className="avlotnote">{asking === 'busy' ? tr('Trayendo del servidor los días que faltan…') : sync.state === 'offline' ? tr('Sin señal: los números de los pedidos viejos salen cuando vuelva.') : asking === 'failed' ? tr('No se pudieron traer del servidor los días viejos de algunos pedidos: sus números pueden quedarse cortos.') : tr('Trayendo del servidor los días que faltan…')}{asking === 'failed' && <> {' '}<button type="button" className="btn sm" onClick={() => { asked.current.clear(); setAsking('') }}>{tr('Reintentar')}</button></>}</p>}
      {list.length === 0 ? (
        <div className="woempty">
          <p className="hint">{all.some((x) => rooms.includes(x.order.dept)) ? tr('Ningún pedido con estos filtros.') : tr('Todavía no hay pedidos de producción.')}</p>
          {filtering && <div className="btns"><button type="button" className="btn" onClick={clear}>{tr('✕ Quitar filtros')}</button></div>}
        </div>
      ) : (
        <div className="twrap rp-cardlist wo-cards">
          <table className="wotable">
            <thead><tr><th>{tr('Cuarto')}</th><th>{tr('Código')}</th><th>WO</th><th className="num">{tr('Total')}</th><th>{tr('Desde')}</th><th className="num">{tr('Hecho')}</th><th className="num">{tr('Disponible')}</th><th className="num">{tr('Sin programar')}</th><th>{tr('Estado')}</th><th className="rp-act"></th></tr></thead>
            <tbody>{shown.map(({ order: o, status: st }) => {
              const name = productOf(s, o.code)?.name
              return (
                <tr key={o.id} style={deptVars(o.dept)}>
                  <td data-label={tr('Cuarto')}><DeptBadge d={o.dept} /></td>
                  <td className="c-head"><button type="button" className="drill code" title={tr('Ver el pedido')} onClick={() => setDetail(o.id)}>{o.code}</button>{o.lot && <small className="wo-lot"> {tr('lote {0}', o.lot)}</small>}{name && <small className="pname">{name}</small>}</td>
                  <td data-label="WO">{o.wo || <span className="wo-none">{tr('sin WO')}</span>}</td>
                  <td className="num" data-label={tr('Total')}>{woN(o.qty)} <small>{orderUnitWord(o)}</small></td>
                  <td data-label={tr('Desde')}>{startText(o, today)}</td>
                  <td className="num" data-label={tr('Hecho')} title={shortOf(st) ? SHORT_TITLE() : undefined}>{woN(st.made)}{shortOf(st) && <small className="wo-short"> …</small>}{st.over > 0 && <small className="wo-sub">{tr('+{0} de más', woN(st.over))}</small>}</td>
                  <td className="num" data-label={tr('Disponible')}><b>{woN(st.disponible)}</b></td>
                  {/* what the office still has to program of each open order (Jose, 2026-10-19: "para saber cuánto nos queda y poner luego la programación") */}
                  <td className={'num' + (st.state === 'abierto' ? '' : ' c-none')} data-label={tr('Sin programar')}>{st.state === 'abierto' ? <>{woN(st.sinProgramar)}{st.pendingToday > 0 && <small className="wo-sub">{tr('{0} pendientes en programas', woN(st.pendingToday))}</small>}</> : '—'}</td>
                  <td data-label={tr('Estado')}><WoStateTag o={o} st={st} /></td>
                  <td className="rp-act"><div className="btns"><button type="button" className="btn xs" onClick={() => setDetail(o.id)}>{tr('Ver')}</button></div></td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      )}
      {list.length > HIST_PAGE && (
        <div className="rp-pager">
          <span>{tr('{0}–{1} de {2}', at * HIST_PAGE + 1, Math.min(list.length, (at + 1) * HIST_PAGE), list.length)}</span>
          <div className="btns">
            <button type="button" className="btn sm" disabled={at === 0} onClick={() => turn(at - 1)}>{tr('‹ Anterior')}</button>
            <button type="button" className="btn sm" disabled={at >= pages - 1} onClick={() => turn(at + 1)}>{tr('Siguiente ›')}</button>
          </div>
        </div>
      )}
    </div>
    {detail && <OrderDetail s={s} id={detail} today={today} edit={!!workOrderOf(s, detail) && canEdit(workOrderOf(s, detail)!)} onClose={closeDetail} />}
    {adding && <WorkOrderDialog s={s} dept={room || dept} today={today} onClose={() => setAdding(false)} />}
    </>
  )
})
/** the sync's state (offline or not), for the lines that say why the old days are not here */
const useSyncStatus = () => useSyncExternalStore(syncStore.subscribe, syncStore.get)

/**
 * One production order whole (Jose, 2026-10-19): its numbers (total, made, available, not programmed), the office's
 * sum day by day as a table and in its own words, when it was completed and by which record, the records that counted
 * (each with the report's "Ver" and "Corregir", as Flujo's window), its history (who typed, changed, closed or reopened
 * it, and the programs that named it), and the links to Flujo and Avance. An order whose numbers this device cannot
 * make alone (its account closed, or old days it does not hold) is worked out again with the server's records, said
 * so. A memo, mounted only while open: the clock never draws it (an open run's times stand still while it stays)
 */
export const OrderDetail = memo(function OrderDetail({ s, id, today, edit, onClose }: { s: State; id: string; today: string; edit: boolean; onClose: () => void }) {
  const nav = useContext(WoNavCtx), can = useCan(), { fixable, fix, seeBtn, fixBtn } = useFixers(), hid = useId()
  const now = clockNow()
  const o = workOrderOf(s, id)
  const [rows, setRows] = useState<Awaited<ReturnType<typeof loadOrderRows>>>(null)
  const [loading, setLoading] = useState<'' | 'busy' | 'failed'>('')
  const [see, setSee] = useState<{ runId: string; at?: number } | null>(null)
  const [fixing, setFixing] = useState<{ id: string; at?: number } | null>(null)
  const [stop, setStop] = useState<string | null>(null)
  const [changing, setChanging] = useState(false)
  const [ask, setAsk] = useState<WoAskKind | null>(null)
  const [recount, setRecount] = useState('')
  const [allRuns, setAllRuns] = useState(false)
  const base = o ? orderStatus(s, o, today) : null
  const needServer = !!supabase && !!o && !o.deleted && !!base && (base.sealed || !base.complete)
  const sync = useSyncStatus()
  const [tries, setTries] = useState(0)
  useEffect(() => {
    if (!needServer || !o) return
    let current = true
    setLoading('busy')
    void loadOrderRows(o).then((r) => { if (!current) return; setRows(r); setLoading(r ? '' : 'failed') })
    return () => { current = false }
  }, [id, needServer, tries]) // eslint-disable-line react-hooks/exhaustive-deps
  // an order deleted (here or on another device) leaves every screen, this window too
  useEffect(() => { if (!o || o.deleted) onClose() }, [o, onClose])
  const view = useMemo(() => (rows ? stateWith(s, rows, rows.unseal, true) : s), [s, rows])
  if (!o || o.deleted) return null
  const st = orderStatus(view, o, today)
  const unit = orderUnitWord(o), name = productOf(s, o.code)?.name, cfg = CFG[o.dept]
  const fromServer = !!rows && view !== s
  // its closed account worked out again with the server's records: offered by the device's own numbers (base), never
  // by the window's (worked out without the account, they never say "sealed": review of 2026-10-20)
  // (only for who may write the room's history, where the account goes as a mark: "Solo ver" keeps its own)
  const offer = writesRoom(o.dept) ? recountOffer(base, st, fromServer) : ''
  // the records that counted, oldest first: the device's own (each with "Ver" and "Corregir") and older ones (seen here)
  const runOf = (runId: string): Run | undefined => view.runs.find((r) => r.id === runId) ?? view.orderRuns.find((r) => r.id === runId)
  const counted = st.runs.map((p) => ({ p, r: runOf(p.runId) })).filter((x): x is { p: typeof x.p; r: Run } => !!x.r).sort((a, b) => a.r.startedAt - b.r.startedAt)
  const here = (runId: string) => s.runs.some((r) => r.id === runId)
  const runsShown = allRuns ? counted : counted.slice(-50)
  // its history: the order's own lines and those of the programs that named it (each program by its keys, as store.ts
  // keeps them: its code and lot, and its code alone in the lines of before 2026-10-20 that name its lot: planLinesOf)
  const ofPlans = planLinesOf(view.plans.filter((p) => p.orderId === o.id))
  const history: Change[] = view.changes.filter((c) => !c.deleted && ((c.refTable === 'act_work_orders' && c.refKey === o.id) || ofPlans(c))).sort((a, b) => a.at - b.at)
  const done = st.completedBy, closed = o.closedAt != null
  const runToFix = fixing ? s.runs.find((r) => r.id === fixing.id) : undefined
  const stopToFix = stop ? s.stops.find((x) => x.id === stop) : undefined
  const shiftsOfRun = (r: Run) => spanShifts(shiftsOf(s, r.date), r.startedAt, r.endedAt ?? now)
  const lots = st.lots
  const toFlujo = nav.openFlujo ? () => nav.openFlujo!(o.code, o.startDate, st.finishDay && st.finishDay < today ? st.finishDay : today) : undefined
  const tile = (label: string, value: ReactNode, sub: ReactNode, cls: string) => <div className={'wotile ' + cls}><label>{label}</label><b>{value}</b><small>{sub}</small></div>
  return (
    <div className="veil fl-veil" onClick={onClose}>
      <div className="dlg wide fl-detail wo-detail" role="dialog" aria-modal="true" aria-labelledby={hid} onClick={(e) => e.stopPropagation()}>
        <h3 id={hid}>
          <span className="fl-dt">{trx('Pedido {0} · {1}', woName(o), <span className="code">{o.code}</span>)}</span>
          {name && <small> · {name}</small>}
          <span className="fl-dtags"><DeptBadge d={o.dept} /><WoStateTag o={o} st={st} /></span>
          <small className="rp-dsub">{tr('desde {0} · {1} {2}', shortDay(o.startDate), woN(o.qty), unit)}{o.createdBy && ' · ' + tr('lo puso {0} el {1}', o.createdBy, shortDay(dayOf(o.createdAt || o.updatedAt)))}</small>
        </h3>
        {o.note && <p className="wo-note">💬 {o.note}</p>}
        {loading === 'busy' && <p className="avlotnote">{tr('Trayendo del servidor los días que faltan…')}</p>}
        {loading === 'failed' && <p className="fl-dnote">{sync.state === 'offline' ? tr('Sin señal: los números de los pedidos viejos salen cuando vuelva.') : tr('No se pudieron traer del servidor los días viejos de este pedido: sus números pueden quedarse cortos.')} <button type="button" className="btn sm" onClick={() => setTries((n) => n + 1)}>{tr('Reintentar')}</button></p>}
        {fromServer && <p className="hint ok">{tr('Calculado con los registros del servidor.')}</p>}
        {!fromServer && st.sealed && <p className="hint">{tr('Cuenta cerrada: estos números quedaron guardados cuando el pedido terminó.')}</p>}
        {!fromServer && shortOf(st) && loading !== 'busy' && <p className="fl-dnote">{SHORT_TITLE()}</p>}
        {/* (1) the four numbers */}
        <div className="wotiles">
          {tile(tr('Total'), woN(o.qty), unit, 't-total')}
          {tile(tr('Hecho'), woN(st.made), st.over > 0 ? tr('{0} de más', woN(st.over)) : o.qty > 0 ? tr('{0}% del total', Math.min(100, Math.floor((st.made / o.qty) * 100))) : '', 't-made')}
          {tile(tr('Disponible'), woN(st.disponible), tr('el total menos lo hecho'), 't-disp')}
          {tile(tr('Sin programar'), woN(st.sinProgramar), st.pendingToday > 0 ? tr('{0} pendientes en programas', woN(st.pendingToday)) : tr('nada programado de hoy en adelante'), 't-sinprog')}
        </div>
        <div className="wo-barline"><WoBar o={o} st={st} /></div>
        {/* (2) the office's sum, day by day: the table as their example, and each day in their words */}
        <section className="fl-dsec">
          <h4>{tr('Día por día')}</h4>
          {st.byDay.length === 0 ? <p className="hint">{st.sealed ? tr('El día por día de una cuenta cerrada se trae del servidor: sale aquí cuando haya señal.') : tr('Nada programado ni hecho de este pedido todavía.')}</p> : (
            <div className="twrap rp-cardlist wo-days">
              <table className="wotable">
                <thead><tr><th>{tr('Día')}</th><th className="num">{tr('Programado')}</th><th>{tr('Lote')}</th><th className="num">{tr('Turno 1')}</th><th className="num">{tr('Turno 2')}</th><th className="num">{tr('Hecho')}</th><th className="num">{tr('Pendiente')}</th><th className="num">{tr('Total hecho')}</th><th className="num">{tr('Disponible')}</th><th className="num">{tr('Sin programar')}</th></tr></thead>
                <tbody>
                  <tr className="wo-start">
                    <td className="c-head">{tr('Pedido')} · {shortDay(o.startDate)}</td>
                    <td className="num c-none">—</td><td className="c-none">—</td><td className="num c-none">—</td><td className="num c-none">—</td><td className="num c-none">—</td><td className="num c-none">—</td><td className="num c-none">—</td>
                    <td className="num" data-label={tr('Disponible')}><b>{woN(o.qty)}</b></td><td className="num" data-label={tr('Sin programar')}>{woN(o.qty)}</td>
                  </tr>
                  {st.byDay.map((d) => (
                    <tr key={d.date} className={d.date === today ? 'live' : d.date > today ? 'wo-ahead' : undefined}>
                      <td className="c-head">{shortDay(d.date)}{d.date === today && <small className="wo-sub">{tr('hoy, en curso')}</small>}</td>
                      <td className="num" data-label={tr('Programado')}>{d.programmed ? woN(d.programmed) : '—'}</td>
                      <td className={d.lot ? '' : 'c-none'} data-label={tr('Lote')}>{d.lot || '—'}</td>
                      <td className="num" data-label={tr('Turno 1')}>{woN(d.made1)}</td>
                      <td className="num" data-label={tr('Turno 2')}>{woN(d.made2)}</td>
                      <td className="num" data-label={tr('Hecho')}><b>{woN(d.made)}</b></td>
                      <td className={'num' + (d.pending > 0 ? ' wo-pend' : '')} data-label={tr('Pendiente')}>{d.programmed ? woN(d.pending) : '—'}</td>
                      <td className="num" data-label={tr('Total hecho')}>{woN(d.cumMade)}</td>
                      <td className="num" data-label={tr('Disponible')}><b>{woN(d.disponible)}</b></td>
                      <td className="num" data-label={tr('Sin programar')}>{woN(d.sinProgramar)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {st.byDay.length > 0 && (
            <>
              <h5>{tr('La cuenta, como la hace la oficina')}</h5>
              <ul className="flhow wo-sum">{st.byDay.map((d, i) => <li key={d.date}>{orderDayLine(d, o.qty, today, shortDay, st.byDay[i - 1])}</li>)}</ul>
              <p className="hint">{tr('Disponible = el total menos todo lo hecho para el pedido: lo que un día no hizo vuelve al pedido y se programa otra vez.')}</p>
            </>
          )}
        </section>
        {/* (3) when it was completed, and by which record; or what it lacks; and its closing by hand */}
        <section className="fl-dsec">
          <h4>{tr('Cuándo se completó')}</h4>
          {done ? (
            <div className="wo-done">
              <b>{tr('✓ Completado el {0} a las {1}', shortDay(done.day), fmtTime(done.at))}</b>
              <span>{tr('{0} n.º {1} de la corrida en {2} · turno {3} · {4}', cfg.unit, done.k, done.line, done.shift, done.by || '—')}</span>
              {here(done.runId) && <div className="btns">{seeBtn(() => setSee({ runId: done.runId, at: done.at }))}{(() => { const r = s.runs.find((x) => x.id === done.runId); return r ? fixBtn(shiftsOfRun(r), r.dept, () => setFixing({ id: r.id, at: done.at })) : null })()}</div>}
            </div>
          ) : <p>{closed ? tr('No se completó.') : tr('Todavía no: faltan {0} {1}.', woN(st.disponible), unit)}</p>}
          {closed && <p>{tr('Cerrado el {0} a las {1} por {2}.', shortDay(dayOf(o.closedAt!)), fmtTime(o.closedAt!), o.closedBy || '—')}{!done && st.disponible > 0 && ' ' + tr('Le faltaban {0} {1}.', woN(st.disponible), unit)}</p>}
        </section>
        {/* (4) its lots: each a link to Avance over every day of the lot */}
        {lots.length > 0 && (
          <section className="fl-dsec">
            <h4>{tr('Lotes')}</h4>
            <div className="btns wo-lots">{lots.map((l) => nav.openLot ? <button key={l} type="button" className="btn soft sm" onClick={() => nav.openLot!(l)}>{tr('Lote {0} en Avance', l)}</button> : <span key={l} className="wo-lot">{tr('lote {0}', l)}</span>)}</div>
          </section>
        )}
        {/* (5) the records that counted: as Flujo's window, each in its room's stripe, "Ver" and "Corregir" for the device's own days */}
        <section className="fl-dsec">
          <h4>{tr('Registros que contaron')}<small> · {counted.length}</small></h4>
          {st.sealed && !fromServer ? <p className="hint">{tr('Los registros de una cuenta cerrada están en el servidor.')}</p> : counted.length === 0 ? <p className="hint">{trx('Nada de {0} ha contado todavía para este pedido.', o.code)}</p> : (
            <div className="twrap rp-cardlist">
              <table className="fl-records">
                <thead><tr><th className="rp-act"></th><th>{tr('Fecha')}</th><th>{tr('Turno')}</th><th>{tr('Línea')}</th><th>{tr('Lote')}</th><th>{tr('Contó')}</th><th>{tr('Horario')}</th><th>{tr('Registró')}</th></tr></thead>
                <tbody>{runsShown.map(({ p, r }) => (
                  <tr key={r.id} className={r.endedAt ? undefined : 'live'} style={deptVars(r.dept)}>
                    <td className="rp-act"><div className="btns">{here(r.id) ? <>{seeBtn(() => setSee({ runId: r.id }))}{fixBtn(shiftsOfRun(r), r.dept, () => setFixing({ id: r.id }))}</> : <small className="rp-lock" title={tr('Este aparato ya no guarda ese día: se corrige abriendo ese día en el Reporte.')}>{tr('Día viejo')}</small>}</div></td>
                    <td className="c-head">{shortDay(r.date)}</td>
                    <td data-label={tr('Turno')}>{shiftsOfRun(r)}</td>
                    <td data-label={tr('Línea')}>{lineNameOf(view, r.lineId, r.line)}</td>
                    <td data-label={tr('Lote')} className="fl-wrap">{[...runLots(view, r)].filter(Boolean).join(' · ') || '—'}</td>
                    <td data-label={tr('Contó')} className="fl-wrap"><b>{woN(p.n)} {unit}</b>{(p.units !== r.units.length || cfg.qty !== 'none') && <small className="wo-sub">{p.units === r.units.length ? tr('{0} {1}', p.units, cfg.plural.toLowerCase()) : tr('{0} de sus {1} {2}', p.units, r.units.length, cfg.plural.toLowerCase())}</small>}{!r.endedAt && <small className="building">{tr('en curso')}</small>}</td>
                    <td data-label={tr('Horario')} className="fl-wrap"><span className="fl-t">{fmtTime(r.startedAt)}</span> – <span className="fl-t">{r.endedAt ? fmtTime(r.endedAt) : tr('en curso')}</span></td>
                    <td data-label={tr('Registró')} className="fl-wrap">{whoText(r) || '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {counted.length > runsShown.length && <button type="button" className="btn sm" onClick={() => setAllRuns(true)}>{tr('Ver los {0} registros', counted.length)}</button>}
          {counted.some((x) => !here(x.r.id)) && <p className="hint">{tr('Los registros de días que este aparato ya no guarda se ven aquí y se corrigen abriendo ese día en el Reporte.')}</p>}
        </section>
        {/* (6) who typed, changed, closed or reopened it, and the programs that named it */}
        <section className="fl-dsec">
          <h4>{tr('Historia')}</h4>
          {history.length === 0 ? <p className="hint">{tr('Este aparato no tiene cambios de este pedido en los días que guarda.')}</p> : (
            <div className="twrap rp-cardlist">
              <table className="changes">
                <thead><tr><th>{tr('Fecha')}</th><th>{tr('Quién')}</th><th>{tr('Qué')}</th><th>{tr('Antes')}</th><th>{tr('Después')}</th></tr></thead>
                <tbody>{history.map((c) => (
                  <tr key={c.id} style={deptVars(o.dept)}>
                    <td className="c-head">{shortDay(dayOf(c.at))} · {fmtTime(c.at)}</td>
                    <td data-label={tr('Quién')}>{c.by || '—'}</td>
                    <td data-label={tr('Qué')}>{c.what}</td>
                    <td data-label={tr('Antes')} className={c.before ? 'was' : 'c-none'}>{c.before || '—'}</td>
                    <td data-label={tr('Después')}><b>{c.after || '—'}</b></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
        {(offer || recount) && (
          <section className="fl-dsec">
            {offer === 'differs' && base && <p className="hint amber">{tr('La cuenta guardada de este pedido dice otra cosa ({0} hechas): los registros del servidor cambiaron después de cerrarla. Las listas siguen con la cuenta guardada hasta que se calcule otra vez.', woN(base.made))}</p>}
            {offer && rows && <div className="btns"><button type="button" className="btn soft sm" onClick={() => { const n = resealGroup(view, rows.unseal, today); setRecount(n < 0 ? tr('Con los registros del servidor el pedido ya no está terminado: su cuenta guardada se quitó en todos los aparatos y se cuenta otra vez con los registros.') : n ? tr('La cuenta cambió con los registros del servidor y quedó guardada.') : tr('La cuenta guardada coincide con los registros del servidor.')) }}>{tr('Calcular otra vez con el servidor')}</button></div>}
            {recount && <p className="hint ok">{recount}</p>}
          </section>
        )}
        <div className="dbtns spread">
          <div className="btns">
            {edit && <button type="button" className="btn soft" onClick={() => setChanging(true)}>{tr('✎ Cambiar')}</button>}
            {edit && (closed ? <button type="button" className="btn soft" onClick={() => setAsk('reopen')}>{tr('Reabrir')}</button> : st.state === 'abierto' && <button type="button" className="btn" onClick={() => setAsk('close')}>{tr('🔒 Cerrar pedido')}</button>)}
            {toFlujo && <button type="button" className="btn soft" onClick={toFlujo}>{tr('Ver {0} en Flujo', o.code)}</button>}
          </div>
          <button type="button" className="btn" onClick={onClose}>{tr('Volver')}</button>
        </div>
        {see && <RunDetail s={s} runId={see.runId} at={see.at} now={now} mgr={can('depts')} fix={fix} fixable={fixable} onFix={(at) => setFixing({ id: see.runId, at })} onFixStop={setStop} onCode={(c) => { setSee(null); if (nav.openFlujo) nav.openFlujo(c, o.startDate, today) }} onLot={(l) => { setSee(null); if (nav.openLot) nav.openLot(l) }} onClose={() => setSee(null)} />}
        {fixing && runToFix && <RunEditor s={s} run={runToFix} mgr={can('fix')} focusAt={fixing.at} onClose={() => setFixing(null)} />}
        {stop && stopToFix && <StopEditor stop={stopToFix} mgr={can('fix')} onClose={() => setStop(null)} />}
        {changing && <WorkOrderDialog s={s} dept={o.dept} today={today} order={o} onClose={() => setChanging(false)} />}
        {ask && <WoAsk s={s} o={o} what={ask} today={today} onNo={() => setAsk(null)} onDone={() => setAsk(null)} />}
      </div>
    </div>
  )
})
