import { tr } from './i18n'
import { normCode, plainText } from './store'
import type { OrderDay, OrderStatus, WorkOrder } from './store'

/**
 * The production orders' numbers in words, as the office clerk does the sum (Jose, 2026-10-19: "el pedido es de 1000
 * mezclas, entonces el día 1 se programa hacer 80, entonces de las 1000 le quitas 80, entonces quedaría 920 ... como al
 * día 1 hicieron 50, le quedan pendiente 30, entonces de los 920 se sumaría 30 para el día 2 ... 950"). Pure, apart
 * from the screens (src/WorkOrders.tsx), so the checks (tests/run.mjs) read the very lines the order's window shows.
 */

/** quantities of an order as they were typed (pounds carry decimals): "1,543.4" */
export const woN = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: 2 })

/**
 * what is available of an order to program on a day (the office's "880 disponible para el día 3"): its quantity less
 * everything made for it before that day. For a day after today (the screen's work day) also less what the programs
 * of today and of the days before that one still have pending of it: it is programmed already, and it only goes back
 * to the order once its day is over (the office's own sum: of the 920, 50 still pending today, so 870 to program
 * tomorrow, and 790 the day after). Until the review of 2026-10-20 a day ahead was offered the quantity less what was
 * made, as if nothing were programmed before it, and programming more than there was went unsaid. The program dialog
 * offers the orders with it
 */
export function availOn(o: Pick<WorkOrder, 'qty'>, st: Pick<OrderStatus, 'byDay'>, day: string, today: string) {
  let cum = 0, ahead = 0
  for (const x of st.byDay) {
    if (x.date < day) cum = x.cumMade
    if (day > today && x.date >= today && x.date < day) ahead += x.pending
  }
  return Math.max(0, Math.round((o.qty - cum - ahead) * 100) / 100)
}

/**
 * One day of an order in the office's words. What was available that morning is the total less what was made BEFORE
 * the day (never "available after + made": the available after a day is never below 0, so on the day an order was
 * completed with some over, that sum said too much). Of it the day's program is taken ("sin programar"); what the day
 * made is taken off; what it left pending goes back to the order: sin programar + pending = available after the day.
 * A day still to come says only its program, from what was not programmed yet the day before it (prev = the row
 * before it in the order's day by day: what today and the days ahead before it still have pending is programmed
 * already), so it says the very numbers of its row in the table (review of 2026-10-20: the 20th and the 21st both
 * said "de 920 disponibles ... quedan 840" under rows that said 790 and 710); today says what is made so far; a day
 * with no program, or one that made more than its program (or completed the order), says so. dayText = how the screen
 * writes a date
 */
type DayLine = Pick<OrderDay, 'date' | 'programmed' | 'made' | 'pending' | 'cumMade' | 'disponible' | 'closed'> & Partial<Pick<OrderDay, 'sinProgramar'>>
export function orderDayLine(day: DayLine, qty: number, today: string, dayText: (date: string) => string, prev?: DayLine): string {
  const r = (x: number) => woN(Math.round(x * 100) / 100)
  const before = Math.max(0, qty - (day.cumMade - day.made)), prog = day.programmed, a = Math.max(0, before - prog), d = dayText(day.date)
  // the day it was closed by hand, and any after: what the program did not make does not go back to it (review of
  // 2026-10-19: the sum "920 + 0 = 970" would not add up). A day that completed it is said as such (nothing was left)
  if (day.closed && day.disponible > 0) return day.made <= 0
    ? tr('{0}: el pedido estaba cerrado: no se le cuenta nada.', d)
    : prog > 0
      ? tr('{0}: de {1} disponibles se programaron {2}. Se hicieron {3} para el pedido hasta que se cerró: lo que faltaba ya no vuelve a él (quedan {4} sin hacer).', d, r(before), r(prog), r(day.made), r(day.disponible))
      : tr('{0}: sin programa. Se hicieron {1} para el pedido hasta que se cerró (quedan {2} sin hacer).', d, r(day.made), r(day.disponible))
  if (day.date > today) {
    const free = prev && prev.date >= today && prev.sinProgramar != null ? prev.sinProgramar : day.disponible
    return tr('{0}: de {1} disponibles se programaron {2} → quedan {3} sin programar.', d, r(free), r(prog), r(day.sinProgramar ?? Math.max(0, free - prog)))
  }
  if (day.date === today) return prog > 0
    ? tr('{0} (hoy): de {1} disponibles se programaron {2} → quedan {3} sin programar. Van {4}, faltan {5}; lo que no se haga hoy vuelve al pedido.', d, r(before), r(prog), r(a), r(day.made), r(day.pending))
    : tr('{0} (hoy): sin programa. Van {1}: quedan {2} disponibles.', d, r(day.made), r(day.disponible))
  if (day.made > before) return prog > 0
    ? tr('{0}: de {1} disponibles se programaron {2} y se hicieron {3}: el pedido se completó ({4} de más).', d, r(before), r(prog), r(day.made), r(day.made - before))
    : tr('{0}: sin programa ese día. Se hicieron {1}: el pedido se completó ({2} de más).', d, r(day.made), r(day.made - before))
  if (prog <= 0) return tr('{0}: sin programa ese día. Se hicieron {1}: quedan {2} − {1} = {3} disponibles.', d, r(day.made), r(before), r(day.disponible))
  if (day.made > Math.min(prog, before)) return tr('{0}: de {1} disponibles se programaron {2} y se hicieron {3}, más de lo programado: quedan {1} − {3} = {4} disponibles.', d, r(before), r(prog), r(day.made), r(day.disponible))
  return tr('{0}: de {1} disponibles se programaron {2} → quedan {3} sin programar. Se hicieron {4} → quedaron {5} pendientes, que vuelven al pedido: {3} + {5} = {6} disponibles.', d, r(before), r(prog), r(a), r(day.made), r(day.pending), r(day.disponible))
}

/**
 * The search of the orders' history (Jose, 2026-10-19: by code, WO number and lot): every word typed must be found in
 * the order's code (also as the products table writes it, and a numeric word by its value: "0889" finds the order of
 * 889, as the app keeps it), its WO number, its note, its product's name or one of its lots. "WO" alone is left out
 * and "WO4512" is read as 4512, the way the screens name an order ("WO 4512"). Until the review of 2026-10-20 the
 * whole text had to be inside one field, so "0889", "WO 4512" and "A100 6290" found nothing
 */
export type WoFields = { code: string; productCode?: string; wo: string; note: string; name?: string; lots: string[] }
export const woTokens = (q: string) => plainText(q).split(/\s+/).map((t) => t.replace(/^wo(?=\d)/, '')).filter((t) => t && t !== 'wo')
export function woMatch(x: WoFields, toks: string[]): boolean {
  if (!toks.length) return true
  const key = normCode(x.code), hay = [x.code, x.productCode ?? '', x.wo, x.note, x.name ?? '', ...x.lots].map(plainText)
  return toks.every((t) => hay.some((h) => h.includes(t)) || (/^\d+$/.test(t) && normCode(t) === key))
}

/**
 * What the order's window says of a closed account it has just worked out again with the server's records (base = the
 * device's own numbers, from the account; st = the numbers from the server's records): '' = nothing to offer (no
 * account here, or the records are not here); 'same' or 'differs'. "Calcular otra vez con el servidor" goes by the
 * device's own numbers: the window's are worked out without the account (that is the point), so going by them it
 * never showed (review of 2026-10-20)
 */
type Recount = Pick<OrderStatus, 'sealed' | 'made' | 'finishDay' | 'state' | 'completedBy'>
export function recountOffer(base: Recount | null, st: Recount, fromServer: boolean): '' | 'same' | 'differs' {
  if (!base?.sealed || !fromServer) return ''
  const same = base.made === st.made && base.finishDay === st.finishDay && base.state === st.state && JSON.stringify(base.completedBy) === JSON.stringify(st.completedBy)
  return same ? 'same' : 'differs'
}
