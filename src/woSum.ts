import { tr } from './i18n'
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
 * what was available of an order on the morning of a day (the office's "880 disponible para el día 3"): its quantity
 * less everything made for it before that day. The program dialog offers the orders with it
 */
export function availOn(o: Pick<WorkOrder, 'qty'>, st: Pick<OrderStatus, 'byDay'>, day: string) {
  let cum = 0
  for (const x of st.byDay) if (x.date < day) cum = x.cumMade
  return Math.max(0, Math.round((o.qty - cum) * 100) / 100)
}

/**
 * One day of an order in the office's words. What was available that morning is the total less what was made BEFORE
 * the day (never "available after + made": the available after a day is never below 0, so on the day an order was
 * completed with some over, that sum said too much). Of it the day's program is taken ("sin programar"); what the day
 * made is taken off; what it left pending goes back to the order: sin programar + pending = available after the day.
 * A day still to come says only its program; today says what is made so far; a day with no program, or one that made
 * more than its program (or completed the order), says so. dayText = how the screen writes a date
 */
export function orderDayLine(day: Pick<OrderDay, 'date' | 'programmed' | 'made' | 'pending' | 'cumMade' | 'disponible' | 'closed'>, qty: number, today: string, dayText: (date: string) => string): string {
  const r = (x: number) => woN(Math.round(x * 100) / 100)
  const before = Math.max(0, qty - (day.cumMade - day.made)), prog = day.programmed, a = Math.max(0, before - prog), d = dayText(day.date)
  // the day it was closed by hand, and any after: what the program did not make does not go back to it (review of
  // 2026-10-19: the sum "920 + 0 = 970" would not add up). A day that completed it is said as such (nothing was left)
  if (day.closed && day.disponible > 0) return day.made <= 0
    ? tr('{0}: el pedido estaba cerrado: no se le cuenta nada.', d)
    : prog > 0
      ? tr('{0}: de {1} disponibles se programaron {2}. Se hicieron {3} para el pedido hasta que se cerró: lo que faltaba ya no vuelve a él (quedan {4} sin hacer).', d, r(before), r(prog), r(day.made), r(day.disponible))
      : tr('{0}: sin programa. Se hicieron {1} para el pedido hasta que se cerró (quedan {2} sin hacer).', d, r(day.made), r(day.disponible))
  if (day.date > today) return tr('{0}: de {1} disponibles se programaron {2} → quedan {3} sin programar.', d, r(before), r(prog), r(a))
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
