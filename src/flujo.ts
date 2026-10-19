import { apartOf, DEPTS, fmtN, measureOf, measureUnit, mfoBinWord, normCode, orderOfId, plainText, planLot, productOf, unitQty, type Dept, type Measure, type PackRoom, type Product, type State } from './store'
import { avanceLots, datesBetween, lotAcrossDays, lotOrder, mfoList, mfoText, mfoWord, packRoomOf, type AvancePart, type LotDay, type MfoMade } from './avance'
import { runLots, unitParts } from './report'
import type { Cell } from './xlsx'
import { tr } from './i18n'

/**
 * "Flujo de datos": the office clerk's WO PENDIENTES sheet, computed live and typed by nobody. For every LOT (over all
 * its days: a lot runs into the next day) and every CODE made of it: what the products table says (YIEL = cases per
 * mezcla, POUCH X CS = units per case), what each room registered (PROD = mezclas, RTE = pouches, MFO = what its bins
 * hold, PACKING = cases on pallets) and the sheet's own columns between them: SEGÚN RTE (CS), the DIFERENCIAS with the
 * sheet's signs, CS PROYECTADO, and the "Diferencia de proyectado" the sheet leaves blank.
 *
 * Jose, 2026-10-18 evening, with the clerk's sheet in hand: "otra tab que se llame Flujo de Datos, que va calculando
 * qué le toca a cada departamento según el yield y lo que esos departamentos ya tienen… si no es para MFO entonces no
 * calcula MFO… nadie tiene que introducir datos aquí"; and "yo pensé que esto es lo mismo que tenemos en Avance, pero
 * bueno": Avance is a DAY's progress against its program, per code; this is the clerk's reconciliation per LOT between
 * one room and the next, so he closes work orders without typing the four counts by hand.
 *
 * ESTADO is typed in his sheet after closing the WO in the ERP, and "condición" (refrigerado) is not in the products
 * table: neither is app data, so ESTADO is computed from the numbers and the condition is left out (the help says so).
 * Every formula below was verified from the sheet's own numbers (row 2286 / LOTE 6222: 3487 ÷ 8 = 435.88,
 * 442 × 8 − 3487 = 49, 80 × 5.5 = 440, 442 − 435.875 = 6.13; row 4433 / LOTE 6224: 1658 ÷ 6 = 276.33 preferred over
 * 3 × 129 = 387).
 *
 * CONSUMO (Jose, 2026-10-19 ~03:00: "es bueno que nos dé el consumo porque eso hay que reportarlo para que sepan qué
 * hay y qué no hay en el inventario, para saber qué y cuánto ordenar"): the sheet's consumo column is typed after the
 * ERP; here it is computed from the same numbers, typed by nobody: what each lot used up (mezclas, pouches) and what
 * is left. Jose chose what "queda en inventario" means: the pouches (or MFO's platos/copas) made and not yet put in
 * cases, and the cases packed on pallets that carry no PO (whether the PO is closed does not matter).
 *
 * SPIRAL and the runs just started (Jose, 2026-10-19 morning, from the floor: "en la nueva pestaña Flujo creo que
 * falta poner Spiral; Spiral está trabajando y no sale en Flujo ese código con el que están trabajando"): two of
 * Avance's rules hid Spiral here. A Spiral run weighing its mezclas in pounds or counting them in cases is "counted
 * apart" and makes no mezclas of a product, so lotAcrossDays leaves it out and a code Spiral only weighs had no row;
 * and a run still open with no unit yet counts nothing, so its lot and code had no row until the first mezcla. Both
 * are gathered here (flujoCodes), Avance's own numbers untouched: Spiral's pounds or cases are said as they are
 * (never turned into cases: the yield is per mezcla) and a run just started gives its lot a row in zeros, "en curso".
 *
 * THE LOT'S PROGRAM (Jose, 2026-10-19 morning, from the floor: a room's program may now name its lot, see
 * store.ts Plan.lot): what the office programmed of a code FOR THIS LOT, in any room and on any day, is added up here
 * and set against what the lot has of it (flujoProgram, FlujoProg): "prog. 80 mezclas" under PROD, the same under
 * RTE, MFO and Packing for their programs, a line of the fold, the lot's band and two columns of the Excel. A code
 * programmed for a lot that nobody has started yet has its row too, in zeros: the clerk's sheet is of pending work
 * orders, and a programmed lot is one. A program without a lot stays a day's program (Avance's business) and is
 * attributed to no lot.
 *
 * Pure: no React, no DOM, nothing of App (so the checks read the very numbers the screen and the Excel get).
 */

/** half a case: the clerk's own tolerance (a 0.33 of a 6-per-case code is rounding, not a missing case) */
export const CUADRA_CS = 0.5
/**
 * two decimals, from unrounded inputs, half away from zero on both sides (so −2.675 reads −2.68 as 2.675 reads 2.68),
 * and never −0 (a −0.004 would print "-0"). Rounding happens only on each final number: the sheet keeps 435.875
 * unrounded in its cell and shows 442 − 435.875 = 6.13, which 442 − 435.88 would not give
 */
export const r2 = (x: number) => { const v = (Math.sign(x) * Math.round((Math.abs(x) + 1e-9) * 100)) / 100; return v === 0 ? 0 : v }
/** "1,376", "435.88", "227.5", "42"; "—" when not known. Two decimals at most, whole numbers plain (fmtN style) */
const NF2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }) // (made once: toLocaleString makes one per call, most of a draw's time at 200 rows)
export const n2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : NF2.format(r2(v)))

/** where a code of a lot stands, from its numbers alone (see flujoState) */
export type FlujoState = 'none' | 'unpacked' | 'nocompare' | 'short' | 'over' | 'ok'
/** the order of the chips: what needs a look first */
export const FLUJO_STATES: FlujoState[] = ['short', 'over', 'ok', 'unpacked', 'nocompare', 'none']
export type FlujoMissing = 'product' | 'yield' | 'perCase' | 'perPallet'
/**
 * what Spiral registered of a code APART from its mezclas: each mezcla weighed in pounds or counted in cases (the
 * products table's "Spiral cuenta en", or the measure the run was started with: run.extra.measure). Said as it is,
 * never turned into cases nor counted as mezclas: the yield is per mezcla (Jose, 2026-10-19)
 */
export type SpiralApart = { word: Measure; qty: number }
/** what one day made of a lot (LotDay), with what Spiral weighed or counted apart that day */
export type FlujoDay = LotDay & { spiralApart: SpiralApart[] }
/** the raw numbers of one code in one lot, in the sheet's words; null = blank in Productos (not known, never 0) */
export type FlujoIn = {
  route: PackRoom; inTable: boolean
  spiralApart?: SpiralApart[]  // what Spiral weighed or counted apart (lb, cajas): only says the row has something; no column is computed from it (optional: the checks feed flujoCalc the sheet's numbers alone)
  yieldCs: number | null      // YIEL = casesPerMix
  perCase: number | null      // POUCH X CS = pouchesPerCase (an MFO code: platos/copas per case)
  perPallet: number | null    // casesPerPallet
  mixes: number               // PROD (mixRoom's mezclas)
  pouches: number             // RTE
  mfoUnits: number            // MFO, in the word it counts in (platos, copas, a typed word: see flujoRow; never 'lb' nor 'cajas')
  mfoCases: number            // MFO's 'cajas' (bins of before 2026-10-17): already cases
  mfoLb: number               // MFO's pounds: shown, never turned into cases
  cases: number               // PACKING = cases on pallets that carry the lot
  pallets: number             // pallets that carry the lot
  casesOnPo: number           // of PACKING, the cases on pallets that carry a PO (flujoOnPo: the same per-lot parts)
  palletsOnPo: number         // of those pallets, the ones with a PO
}
export type FlujoCalc = {
  segun: number | null        // SEGÚN RTE (CS): what the room before Packing reported, in cases (RTE ÷ perCase; on the MFO route MFO ÷ perCase + cajas)
  diffRte: number | null      // DIFERENCIAS / RTE = PACKING × perCase − RTE          (RTE route only; − = sobra, + = falta)
  diffMfo: number | null      // DIFERENCIAS / MFO = PACKING × perCase − MFO (in MFO's units; in cajas for bins of before alone)   (MFO route only)
  diffPacking: number | null  // DIFERENCIAS / PACKING = PACKING − segun                (− = faltan cs, + = cs de más)
  projected: number | null    // CS PROYECTADO
  projectedFrom: 'mfo' | 'mixes' | null
  diffProjected: number | null   // Diferencia de proyectado = PACKING − projected (blank in the sheet; computed here)
  palletsProjected: number | null // projected ÷ perPallet
  state: FlujoState; missing: FlujoMissing[]; mfoOnlyLb: boolean; hasAny: boolean
  // ---- CONSUMO (2026-10-19): what the lot used up and what is left, from the same numbers ----
  mixesUsed: number | null    // mezclas usadas según yield = what the pack room reported, in cases (segun) ÷ YIEL: RTE ÷ (YIEL × POUCH X CS)
  mixesLeft: number | null    // max(0, PROD − usadas), two decimals
  madeOver: boolean           // the pack room reported more than the mezclas give (usadas > hechas; the DIF columns say it too)
  unitsMade: number | null    // pouches (RTE route) or MFO's platos/copas; null on the MFO route with nothing countable (pounds, bins of before, nothing)
  unitsUsed: number | null    // PACKING × POUCH X CS (on the MFO route the cases beyond its bins of before, which were cases already)
  unitsLeft: number | null    // max(0, hechos − usados): made and not yet put in cases
  packedOver: boolean         // Packing packed more than the room reported (usados > hechos; DIF. RTE/MFO "faltan")
  casesFree: number           // PACKING − casesOnPo: cases packed that no PO has ("cajas sin pedido", Jose's inventory)
}

/**
 * ESTADO, from the numbers (the clerk types "CERRADO" after the ERP; the app has no ERP): nothing of the code in the
 * lot / made but nothing packed / short by more than half a case / over by more than half / within half a case /
 * nothing to compare (a blank in Productos, or MFO only in pounds)
 */
export function flujoState(x: Pick<FlujoIn, 'cases'> & { hasAny?: boolean }, diffPacking: number | null): FlujoState {
  if (x.hasAny === false) return 'none'
  if (x.cases === 0) return 'unpacked'
  if (diffPacking == null) return 'nocompare'
  return diffPacking < -CUADRA_CS ? 'short' : diffPacking > CUADRA_CS ? 'over' : 'ok'
}

/** the sheet's arithmetic on the raw numbers of one code in one lot: every column it computes, with its signs */
export function flujoCalc(x: FlujoIn): FlujoCalc {
  const rte = x.route === 'RTE'
  const k = x.perCase && x.perCase > 0 ? x.perCase : null
  const countable = x.mfoUnits > 0 || x.mfoCases > 0
  // (what Spiral weighed or counted apart is a record of the lot too: the row exists and is not "Sin registros")
  const hasAny = x.mixes > 0 || x.pouches > 0 || x.mfoUnits > 0 || x.mfoCases > 0 || x.mfoLb > 0 || x.cases > 0 || x.pallets > 0 || (x.spiralApart ?? []).some((a) => a.qty > 0)
  // SEGÚN RTE (CS): what the room that packs the code reported, in cases. RTE's pouches ÷ pouches per case; MFO's
  // platos/copas ÷ units per case, plus the bins of before that already counted cases. MFO in pounds only: no case
  // arithmetic (Jose, 2026-10-17: nothing of MFO is turned into cases). MFO with nothing registered: zero reported,
  // as RTE with zero pouches, so cases packed with nothing reported read "de más" (the sheet's own sign reading)
  const segunRaw = rte ? (k ? x.pouches / k : null)
    : x.mfoUnits > 0 ? (k ? x.mfoUnits / k + x.mfoCases : null)
    : x.mfoCases > 0 ? x.mfoCases
    : x.mfoLb > 0 ? null
    : 0
  const segun = segunRaw == null ? null : r2(segunRaw)
  // The other room's columns stay blank, not 0 ("si no es para MFO entonces no calcula MFO"): a 0 would read as a
  // count. What that room did register is still said beside the code (otherRte/otherMfo): a fact is never hidden.
  // A difference between two zeros says nothing: "✓ 0" on a row where Packing and RTE both registered nothing would
  // tell the clerk the lot squares when nobody has touched it
  const diffRte = rte && k && (x.pouches > 0 || x.cases > 0) ? r2(x.cases * k - x.pouches) : null
  // MFO's bins of before 2026-10-17 counted cases: a lot with only those is compared in cases (25 cs − 30 cajas = −5,
  // never −30 "cajas", which was the gap in units: review of 2026-10-18); with units of now beside them, in units
  const diffMfo = !rte && countable ? (x.mfoUnits > 0 ? (k ? r2(x.cases * k - x.mfoUnits - x.mfoCases * k) : null) : r2(x.cases - x.mfoCases)) : null
  // CS PROYECTADO = mezclas × yield (no mezcla registered → nothing projected, as Avance: the cases then come from
  // another lot's mezclas). On the MFO route the sheet prefers what MFO registered, in cases: its row 4433 / LOTE 6224
  // had 3 × 129 = 387 and the clerk still wrote 276 = 1658 ÷ 6; MFO's own count is nearer the cases than the yield
  const fromMixesRaw = x.yieldCs && x.mixes > 0 ? x.mixes * x.yieldCs : null
  const fromMfo = !rte && countable && segunRaw != null
  const projectedRaw = fromMfo ? segunRaw : fromMixesRaw
  const projectedFrom = fromMfo ? 'mfo' as const : fromMixesRaw != null ? 'mixes' as const : null
  const projected = projectedRaw == null ? null : r2(projectedRaw)
  const diffPacking = segunRaw != null && (x.cases > 0 || segunRaw > 0) ? r2(x.cases - segunRaw) : null
  const diffProjected = projectedRaw != null ? r2(x.cases - projectedRaw) : null
  const palletsProjected = projectedRaw != null && x.perPallet ? r2(projectedRaw / x.perPallet) : null
  const mfoOnlyLb = !rte && !countable && x.mfoLb > 0
  const state = flujoState({ cases: x.cases, hasAny }, diffPacking)
  // a blank in Productos is "not known", never zero (Avance's rule): the cell shows "—" and the row says what is
  // missing, only what blocked a cell
  const missing: FlujoMissing[] = []
  if (!x.inTable) missing.push('product')
  else {
    if (x.yieldCs == null && x.mixes > 0 && projectedFrom !== 'mfo') missing.push('yield')
    if (k == null && (rte ? x.pouches > 0 || x.cases > 0 : x.mfoUnits > 0)) missing.push('perCase')
    if (x.perPallet == null && projected != null) missing.push('perPallet')
  }
  // ---- CONSUMO (Jose, 2026-10-19: "para que sepan qué hay y qué no hay en el inventario, para saber qué y cuánto
  // ordenar"). Mezclas usadas = what the pack room reported, in cases (segunRaw, unrounded) ÷ yield: on the RTE route
  // pouches ÷ (yield × pouches per case); on the MFO route its units ÷ (yield × units per case) plus the bins of
  // before, which were cases. Null when yield is blank or there is nothing in cases to divide (pouches per case blank,
  // MFO only in pounds). Quedan never goes below 0: a pack room that reported more than the mezclas give is already
  // the DIF columns' business; madeOver lets the explain say it
  const mixesUsedRaw = x.yieldCs && segunRaw != null ? segunRaw / x.yieldCs : null
  const mixesUsed = mixesUsedRaw == null ? null : r2(mixesUsedRaw)
  const mixesLeft = mixesUsedRaw == null ? null : r2(Math.max(0, x.mixes - mixesUsedRaw))
  const madeOver = mixesUsedRaw != null && mixesUsedRaw > x.mixes + 1e-9
  // Pouches (RTE) or MFO's units: made by the pack room, used by Packing (cases × units per case; on the MFO route the
  // cases beyond its bins of before, which already were cases: the same reading as diffMfo), left = made − used, never
  // below 0 (Packing packing more than reported is DIF's "faltan"; packedOver lets the explain say it). On the MFO
  // route only in a countable word: pounds are never units, bins of before were cases, and nothing registered has no
  // word to count in
  const unitsMade = rte ? x.pouches : x.mfoUnits > 0 ? x.mfoUnits : null
  const unitsUsedRaw = unitsMade != null && k ? Math.max(0, x.cases - (rte ? 0 : x.mfoCases)) * k : null
  const unitsUsed = unitsUsedRaw == null ? null : r2(unitsUsedRaw)
  const unitsLeft = unitsMade == null || unitsUsedRaw == null ? null : r2(Math.max(0, unitsMade - unitsUsedRaw))
  const packedOver = unitsMade != null && unitsUsedRaw != null && unitsUsedRaw > unitsMade
  // the cases no PO has: Jose's "cajas sin pedido" (a closed PO still has its cases: they are not inventory)
  const casesFree = Math.max(0, x.cases - x.casesOnPo)
  return { segun, diffRte, diffMfo, diffPacking, projected, projectedFrom, diffProjected, palletsProjected, state, missing, mfoOnlyLb, hasAny, mixesUsed, mixesLeft, madeOver, unitsMade, unitsUsed, unitsLeft, packedOver, casesFree }
}

/**
 * what the office programmed of a code for THIS lot in one room (2026-10-19), against what the lot has of it: word =
 * the room's quantity as data ('mezclas'; in Spiral 'lb' or 'cajas' when Productos says Spiral counts the code so;
 * 'pouches'; MFO's word; 'cajas' in Packing), made = what the lot's rows count of it in that word, left = qty − made
 * (negative = more than programmed, the PlanCard's "+"). Two decimals, as the quantities typed
 */
export type FlujoProg = { dept: Dept; word: string; qty: number; made: number; left: number }
export type FlujoRow = FlujoIn & FlujoCalc & {
  lot: string; code: string; product: Product | undefined; name: string
  routeSaid: boolean                 // false = packRoomOf guessed it ("?")
  mixRoom: 'Kitchen' | 'Spiral'
  days: FlujoDay[]                   // what each day made of it (lotAcrossDays, plus Spiral's apart measures), sorted
  mfo: MfoMade[]                     // word by word, the usual first (for display)
  mfoWordUsed: string                // the countable word MFO used ('' when none): platos, copas, or cajas for bins of before
  spiralApart: SpiralApart[]         // what Spiral weighed (lb) or counted (cajas) of this lot apart from its mezclas, lb first ([] = nothing)
  running: boolean                   // a run of this code touching the lot is still open (openIn says where)
  openIn: Dept[]                     // the rooms where such a run is still open ([] when none)
  prog: FlujoProg[]                  // the lot's program of this code, room by room in DEPTS order ([] = none named this lot)
  otherRte: boolean                  // MFO route but RTE registered pouches of this lot (shown as a note, never computed)
  otherMfo: boolean                  // RTE route but MFO registered something of this lot
  unitWord: string                   // the word unitsMade/Used/Left count in: 'pouches', or MFO's word ('' when they are null)
}
/** what is left unpacked under one word (pouches, platos, copas…) over some rows, and in how many of them there is some */
export type FlujoLeft = { word: string; qty: number; rows: number }
/** what was programmed for the lot under one room's word, over some rows (the band: "programado 80 mezclas · 440 cajas") */
export type FlujoProgSum = { dept: Dept; word: string; qty: number }
export type FlujoSum = {
  codes: number; cases: number; pallets: number; projected: number | null; states: Record<FlujoState, number>; shortCs: number; overCs: number
  left: FlujoLeft[]           // CONSUMO: unpacked, word by word (a word is never added to another: pouches apart from platos apart from copas)
  casesFree: number; freeRows: number; casesOnPo: number; palletsOnPo: number
  prog: FlujoProgSum[]        // the lot's program (2026-10-19), room and word by room and word, DEPTS order ([] = none)
}
export type FlujoLot = { lot: string; days: string[]; rows: FlujoRow[]; sum: FlujoSum }

/** the order the unit words are said in: the plant's pouches first, then MFO's usual words, then any typed one */
const UNIT_ORDER = ['pouches', 'platos', 'copas']
const unitRank = (w: string) => { const i = UNIT_ORDER.indexOf(w); return i < 0 ? UNIT_ORDER.length : i }
/** the word on the screen and in the Excel: the plant's "pouches" as it is, MFO's words as MFO writes them */
export const unitWordText = (w: string) => (w === 'pouches' ? tr('pouches') : w ? mfoWord(w) : '')
/**
 * CONSUMO's "cajas en pedidos": per code of a lot, the cases Packing put on pallets that carry a PO (one orderOfId
 * still knows: a PO written by mistake and taken away leaves its pallets without one), and those pallets. The same
 * parts PACKING counts (lotAcrossDays: a Packing line filling bins makes no cases; a pallet with two lots gives each
 * lot its own cases and counts as a pallet of both). Whether the PO is closed does not matter (Jose, 2026-10-19: the
 * inventory is the cases without a PO). Once per lot: every code of it at one pass over the runs
 */
export function flujoOnPo(s: State, lot: string): Map<string, { cases: number; pallets: number }> {
  const out = new Map<string, { cases: number; pallets: number }>()
  for (const r of s.runs) {
    if (r.dept !== 'Packing' || apartOf(r)) continue
    for (const u of r.units) {
      if (!orderOfId(s, u.po)) continue
      for (const p of unitParts(s, r, u)) {
        if (p.lot !== lot) continue
        const key = normCode(r.code)
        let x = out.get(key)
        if (!x) { x = { cases: 0, pallets: 0 }; out.set(key, x) }
        x.cases += p.qty ?? 0; x.pallets++
      }
    }
  }
  return out
}
/**
 * a lot's entry of one code: lotAcrossDays' (mezclas, pouches, cases, MFO, pallets, day by day) plus what Flujo needs
 * and Avance's day view does not (see flujoCodes). kitchen = Kitchen's own mezclas of the lot (mixes is the mix room's:
 * when Spiral made more of the code, Kitchen's count is only here, for Kitchen's program); prog = what the office
 * programmed of the code for this lot, room by room
 */
export type FlujoCode = { code: string; mixRoom: 'Kitchen' | 'Spiral'; days: FlujoDay[]; spiralApart: SpiralApart[]; openIn: Dept[]; kitchen: number; prog: { dept: Dept; qty: number }[] } & AvancePart
const zeroPart = (): AvancePart => ({ mixes: 0, spiral: 0, pouches: 0, cases: 0, mfo: {}, pallets: 0 })
/**
 * what the office programmed for one lot (2026-10-19): per code (normCode) and room, the quantities of every program
 * that names this lot, on any day (a lot runs into the next day, and the office may program it on the day before),
 * added up. Only programs with a lot: one without stays a day's program, attributed to no lot. The spelling of the
 * code is the products table's, else the program's
 */
export function flujoProgram(s: State, lot: string): Map<string, { code: string; prog: { dept: Dept; qty: number }[] }> {
  const out = new Map<string, { code: string; prog: { dept: Dept; qty: number }[] }>()
  if (!lot) return out
  for (const p of s.plans) {
    if (!(p.qty > 0) || planLot(p.lot) !== lot) continue
    const key = normCode(p.code)
    let c = out.get(key)
    if (!c) { c = { code: productOf(s, key)?.code ?? p.code, prog: [] }; out.set(key, c) }
    const x = c.prog.find((q) => q.dept === p.dept)
    if (x) x.qty = Math.round((x.qty + p.qty) * 100) / 100; else c.prog.push({ dept: p.dept, qty: p.qty })
  }
  for (const c of out.values()) c.prog.sort((a, b) => DEPTS.indexOf(a.dept) - DEPTS.indexOf(b.dept))
  return out
}
/** "1,200 lb", "80 cajas", or "1,200 lb · 80 cajas" when Spiral used both measures in one lot (both said, never added) */
export const spiralApartText = (l: SpiralApart[]) => l.map((a) => fmtN(a.qty) + ' ' + measureUnit(a.word)).join(' · ')
const addApart = (l: SpiralApart[], word: Measure, qty: number) => { const x = l.find((a) => a.word === word); if (x) x.qty += qty; else l.push({ word, qty }) }
const APART_ORDER: Measure[] = ['lb', 'cajas']
/**
 * The codes of a lot as Flujo lists them (Jose, 2026-10-19, from the floor: "Spiral está trabajando y no sale en Flujo
 * ese código con el que están trabajando"). lotAcrossDays gives what each room counted of the lot with Avance's two
 * rules, which left Spiral out here: (1) a Spiral run weighing its mezclas in pounds or counting them in cases is
 * "counted apart" and makes no mezclas (apartOf), so a code Spiral only weighs had no row at all: here its pounds (or
 * cases) are gathered per lot and per day as spiralApart, said as they are, never turned into cases; (2) a run still
 * open with no unit yet counts nothing, so its lot and code had no row until the first mezcla, cart or pallet: here
 * every run still open gives each lot it touches (runLots: its own lot, the one it packs now, the pallet being built)
 * a row of its code, in zeros, "en curso", so the office sees the code is on from its first minute. Avance's own
 * numbers are not touched: lotAcrossDays is used as it is.
 */
export function flujoCodes(s: State, lot: string): FlujoCode[] {
  const byKey = new Map<string, FlujoCode>()
  for (const c of lotAcrossDays(s, lot).codes) byKey.set(normCode(c.code), { ...c, days: c.days.map((d) => ({ ...d, spiralApart: [] })), spiralApart: [], openIn: [], kitchen: 0, prog: [] })
  const entry = (code: string, dept: Dept) => {
    const key = normCode(code)
    let c = byKey.get(key)
    if (!c) { c = { code: productOf(s, key)?.code ?? code, mixRoom: dept === 'Spiral' ? 'Spiral' : 'Kitchen', days: [], spiralApart: [], openIn: [], kitchen: 0, prog: [], ...zeroPart() }; byKey.set(key, c) }
    return c
  }
  const dayOf = (c: FlujoCode, date: string) => { let d = c.days.find((x) => x.date === date); if (!d) { d = { date, ...zeroPart(), spiralApart: [] }; c.days.push(d) } return d }
  for (const r of s.runs) {
    // Spiral apart: the lot of each mezcla from unitParts (the run's lot, or the lots written on the unit, each with
    // its share), its figure from the unit itself when the part has none (unitParts says null for Spiral: CFG.Spiral
    // counts mezclas, not quantities; the pounds or cases typed are the unit's own)
    const m = measureOf(r)
    if (m) for (const u of r.units) for (const p of unitParts(s, r, u)) {
      if (p.lot !== lot) continue
      const c = entry(r.code, r.dept), q = p.qty ?? unitQty(s, r, u)
      addApart(c.spiralApart, m, q); addApart(dayOf(c, r.date).spiralApart, m, q)
    }
    // Kitchen's own mezclas of the lot (as lotAcrossDays counts them), kept apart from the mix room's for Kitchen's program
    if (r.dept === 'Kitchen' && !apartOf(r)) for (const u of r.units) for (const p of unitParts(s, r, u)) if (p.lot === lot) entry(r.code, r.dept).kitchen++
    if (!r.endedAt && runLots(s, r).has(lot)) { const c = entry(r.code, r.dept); if (!c.openIn.includes(r.dept)) c.openIn.push(r.dept); dayOf(c, r.date) }
  }
  // the lot's program (2026-10-19): a code programmed for this lot has its row even before anybody starts it
  for (const [key, p] of flujoProgram(s, lot)) { const c = byKey.get(key) ?? entry(p.code, p.prog[0].dept); c.prog = p.prog }
  const tidy = (l: SpiralApart[]) => l.filter((a) => a.qty > 0).map((a) => ({ ...a, qty: Math.round(a.qty * 100) / 100 })).sort((a, b) => APART_ORDER.indexOf(a.word) - APART_ORDER.indexOf(b.word))
  return [...byKey.values()].map((c) => ({
    ...c,
    // a code with no mezcla that Spiral weighed: Spiral is the room making it (lotAcrossDays says Kitchen at 0 to 0)
    mixRoom: !c.mixes && c.spiralApart.some((a) => a.qty > 0) ? 'Spiral' as const : c.mixRoom,
    spiralApart: tidy(c.spiralApart),
    days: c.days.map((d) => ({ ...d, spiralApart: tidy(d.spiralApart) })).sort((a, b) => a.date.localeCompare(b.date)),
    // the rooms in their usual order (the explain and the badge name them), not in the order the runs were met
    openIn: [...c.openIn].sort((a, b) => DEPTS.indexOf(a) - DEPTS.indexOf(b)),
  })).sort((a, b) => a.code.localeCompare(b.code))
}
/** one row from one code of flujoCodes(s, lot); `onPo` = flujoOnPo(s, lot) when the caller has it (flujoLot does, once per lot) */
export function flujoRow(s: State, lot: string, c: FlujoCode, onPo?: Map<string, { cases: number; pallets: number }>): FlujoRow {
  const product = productOf(s, c.code)
  const { room: route, said: routeSaid } = packRoomOf(s, c.code)
  // Productos stores a blank as 0 (numOf): a 0 here is "not known"
  const yieldCs = product?.casesPerMix || null, perCase = product?.pouchesPerCase || null, perPallet = product?.casesPerPallet || null
  const mfoCases = c.mfo.cajas ?? 0, mfoLb = c.mfo.lb ?? 0
  const mfo = mfoList(c.mfo)
  // MFO counts in ONE word per code: the units per case of Productos are of what its bins hold. Two words in one lot
  // (platos on one line, copas on another): the one with the most of it counts and the other is shown apart, never
  // added to it (review of 2026-10-18: a sum read "660 platos" when 60 of them were copas). Ties: the usual word first
  const used = mfo.filter((m) => m.word !== 'cajas' && m.word !== 'lb').reduce<MfoMade | null>((best, m) => (best == null || m.qty > best.qty ? m : best), null)
  const mfoUnits = used?.qty ?? 0
  const mfoWordUsed = used ? used.word : mfoCases > 0 ? 'cajas' : ''
  const key = normCode(c.code)
  const po = (onPo ?? flujoOnPo(s, lot)).get(key) ?? { cases: 0, pallets: 0 }
  const input: FlujoIn = { route, inTable: !!product, yieldCs, perCase, perPallet, mixes: c.mixes, pouches: c.pouches, mfoUnits, mfoCases, mfoLb, cases: c.cases, pallets: c.pallets, casesOnPo: po.cases, palletsOnPo: po.pallets, spiralApart: c.spiralApart }
  const calc = flujoCalc(input)
  // The lot's program, room by room, against what the lot has of the code in that room's word (2026-10-19), read as
  // the PlanCard reads it (planRows) so both say the same figure (review of 2026-10-19). Kitchen: its own mezclas.
  // Spiral: its mezclas, or its pounds / cases when Productos says Spiral counts the code so (the program is typed in
  // that unit); with nothing said in Productos, what Spiral registered of the lot apart, else mezclas. RTE: pouches.
  // MFO: the word its bins of the lot hold, pounds included (a code MFO weighs has its program in pounds: "240 of 300
  // lb", never "0 of 300 platos"); with no bin of the lot yet, the word of the code's newest bin on this device, else
  // platos. Packing: cases on pallets
  const spiralWord: string = product?.spiralUnit ? product.spiralUnit : c.spiralApart[0]?.word ?? 'mezclas'
  const mfoWordProg = mfoWordUsed || (mfoLb > 0 ? 'lb' : mfoBinWord(s.runs, c.code) || 'platos')
  const madeOf = (dept: Dept, word: string) => (dept === 'Kitchen' ? c.kitchen : dept === 'Spiral' ? (word === 'mezclas' ? c.spiral : c.spiralApart.find((a) => a.word === word)?.qty ?? 0) : dept === 'RTE' ? c.pouches : dept === 'MFO' ? c.mfo[word] ?? 0 : c.cases)
  const prog: FlujoProg[] = c.prog.map((p) => { const word = p.dept === 'Spiral' ? spiralWord : p.dept === 'RTE' ? 'pouches' : p.dept === 'MFO' ? mfoWordProg : p.dept === 'Packing' ? 'cajas' : 'mezclas'; const made = madeOf(p.dept, word); return { dept: p.dept, word, qty: p.qty, made: r2(made), left: r2(p.qty - made) } })
  return {
    ...input, ...calc,
    lot, code: c.code, product, name: product?.name ?? '', routeSaid, mixRoom: c.mixRoom, days: c.days, mfo, mfoWordUsed, spiralApart: c.spiralApart, openIn: c.openIn, prog,
    // a run of this code still open on a lot it touches (flujoCodes gathered them once per lot, over runLots)
    running: c.openIn.length > 0,
    otherRte: route === 'MFO' && c.pouches > 0,
    otherMfo: route === 'RTE' && mfo.length > 0,
    unitWord: calc.unitsMade == null ? '' : route === 'RTE' ? 'pouches' : mfoWordUsed,
  }
}
/**
 * the totals of a lot's rows in view: cases and pallets add up; projected only when some row knows it (Avance's sumOr).
 * CONSUMO: what is left unpacked is added only between rows of the same word (pouches apart from platos apart from
 * copas: Jose, 2026-10-19), each word with the rows that have some; the cases without a PO and with one add up
 */
export function flujoSum(rows: FlujoRow[]): FlujoSum {
  const states = { none: 0, unpacked: 0, nocompare: 0, short: 0, over: 0, ok: 0 } as Record<FlujoState, number>
  for (const r of rows) states[r.state]++
  const left = new Map<string, FlujoLeft>()
  for (const r of rows) {
    if (r.unitsLeft == null || !r.unitWord) continue
    let x = left.get(r.unitWord)
    if (!x) { x = { word: r.unitWord, qty: 0, rows: 0 }; left.set(r.unitWord, x) }
    x.qty = r2(x.qty + r.unitsLeft); if (r.unitsLeft > 0) x.rows++
  }
  // the lot's program (2026-10-19), added only between rows of the same room and word (Kitchen's mezclas with Kitchen's)
  const prog = new Map<string, FlujoProgSum>()
  for (const r of rows) for (const p of r.prog) {
    const k = p.dept + '|' + p.word
    let x = prog.get(k)
    if (!x) { x = { dept: p.dept, word: p.word, qty: 0 }; prog.set(k, x) }
    x.qty = r2(x.qty + p.qty)
  }
  return {
    codes: rows.length,
    cases: rows.reduce((t, r) => t + r.cases, 0), pallets: rows.reduce((t, r) => t + r.pallets, 0),
    projected: rows.some((r) => r.projected != null) ? r2(rows.reduce((t, r) => t + (r.projected ?? 0), 0)) : null,
    states,
    shortCs: r2(rows.filter((r) => r.state === 'short').reduce((t, r) => t - (r.diffPacking ?? 0), 0)),
    overCs: r2(rows.filter((r) => r.state === 'over').reduce((t, r) => t + (r.diffPacking ?? 0), 0)),
    left: [...left.values()].sort((a, b) => unitRank(a.word) - unitRank(b.word) || a.word.localeCompare(b.word)),
    casesFree: rows.reduce((t, r) => t + r.casesFree, 0), freeRows: rows.filter((r) => r.casesFree > 0).length,
    casesOnPo: rows.reduce((t, r) => t + r.casesOnPo, 0), palletsOnPo: rows.reduce((t, r) => t + r.palletsOnPo, 0),
    prog: [...prog.values()].sort((a, b) => DEPTS.indexOf(a.dept) - DEPTS.indexOf(b.dept) || a.word.localeCompare(b.word)),
  }
}
/** the word of a program as the screen says it: mezclas / lb / cajas (Kitchen, Spiral, Packing), pouches, MFO's word */
export const progWord = (p: Pick<FlujoProg, 'dept' | 'word'>) => (p.dept === 'RTE' ? tr('pouches') : p.dept === 'MFO' ? mfoWord(p.word) : measureUnit(p.word))
/**
 * "prog. 80 mezclas": the small line under a room's cell; `named` adds the room ("prog. 80 mezclas Kitchen"), for the PROD cell
 * when Kitchen and Spiral both have the code programmed for the lot (two lines reading the same said nothing, 2026-10-19)
 */
export const progText = (p: FlujoProg, named = false) => tr('prog. {0} {1}', fmtN(p.qty), progWord(p) + (named ? ' ' + p.dept : ''))
/**
 * "80 mezclas · 3,500 pouches · 1,500 lb Spiral · 440 cajas": the lot's program for the band, each room's figure in
 * its word (the list is already one entry per room and word: flujoSum). Nothing is added across rooms: Kitchen's and
 * Spiral's mezclas are the same mezclas passing from one room to the other, and PROD counts one room's (review of
 * 2026-10-19: 80 programmed in Kitchen and 80 in Spiral read "programado 160 mezclas" against a PROD of 60). A figure
 * is named with its room when its word is not the room's own (Spiral's pounds or cases, MFO in pounds or in cases)
 * or when another room in the band has the same word ("80 mezclas Kitchen · 80 mezclas Spiral"); otherwise plain
 */
export function progSumText(list: FlujoProgSum[]): string {
  const own = (p: FlujoProgSum) => p.dept === 'RTE' || p.dept === 'Packing' || (p.word === 'mezclas' ? p.dept === 'Kitchen' || p.dept === 'Spiral' : p.dept === 'MFO' && p.word !== 'lb' && p.word !== 'cajas')
  const named = (p: FlujoProgSum) => !own(p) || list.some((q) => q.dept !== p.dept && q.word === p.word)
  return list.filter((p) => p.qty > 0).map((p) => fmtN(p.qty) + ' ' + progWord(p) + (named(p) ? ' ' + p.dept : '')).join(' · ')
}
/** "80 mezclas (Kitchen) · hechas 60 · faltan 20": one program of a lot against what the lot has (the fold) */
export function progLine(p: FlujoProg): string {
  const m = p.word === 'pouches' || p.word === 'platos' // (hechos / hechas: the word's gender)
  const rest = p.left > 0 ? tr('faltan {0}', n2(p.left)) : p.left < 0 ? tr('completo (+{0})', n2(-p.left)) : tr('completo')
  return fmtN(p.qty) + ' ' + progWord(p) + ' (' + p.dept + ') · ' + (m ? tr('hechos {0}', n2(p.made)) : tr('hechas {0}', n2(p.made))) + ' · ' + rest
}
/** a row "with inventory" (the chip "Con inventario"): something made and not packed, or cases without a PO */
export const flujoHasInventory = (r: Pick<FlujoRow, 'unitsLeft' | 'casesFree'>) => (r.unitsLeft ?? 0) > 0 || r.casesFree > 0
/**
 * the tile "En inventario · por empacar": its big number is the first word in view that has something left (sum.left
 * is in UNIT_ORDER: pouches, then MFO's words), and the other words with some go in its small line. Pouches with 0 only
 * when nothing is left in any word: with the MFO chip on, the office read "0 pouches" big and the real inventory,
 * "54 platos", in the small print (review of 2026-10-19)
 */
export function flujoLeftMain(left: FlujoLeft[]): { main: FlujoLeft; rest: FlujoLeft[] } {
  const main = left.find((x) => x.qty > 0) ?? left.find((x) => x.word === 'pouches') ?? { word: 'pouches', qty: 0, rows: 0 }
  return { main, rest: left.filter((x) => x !== main && x.qty > 0) }
}
/**
 * one lot over ALL the days this device holds (also days outside the range in view: the office wants a lot's total,
 * and a lot of the first day in view began the day before); null when nothing of it was counted
 */
export function flujoLot(s: State, lot: string): FlujoLot | null {
  const onPo = flujoOnPo(s, lot)
  // a row with nothing counted yet stays while a run of it is open, or while the office has it programmed for this
  // lot: the office sees the code is on, or still to start (2026-10-19)
  const rows = flujoCodes(s, lot).map((c) => flujoRow(s, lot, c, onPo)).filter((r) => r.hasAny || r.running || r.prog.length > 0).sort((p, q) => p.code.localeCompare(q.code, undefined, { numeric: true }))
  if (!rows.length) return null
  const days = [...new Set(rows.flatMap((r) => r.days.map((d) => d.date)))].sort()
  return { lot, days, rows, sum: flujoSum(rows) }
}
/**
 * the lots touched between two dates (both included; turned around if reversed), each over ALL its days, the newest
 * lot first (lotsKnown's order). A lot a run still open is on (runLots: its own lot, the one it packs now, the pallet
 * being built) counts as touched on the run's day even with nothing registered of it yet (2026-10-19): the lot of a
 * run just started is in the list from its first minute, as its row is. So does a lot the office programmed on one of
 * those days (a program may name its lot, 2026-10-19): the lot is listed with its codes to make before anybody starts
 */
export function flujoLots(s: State, from: string, to: string): FlujoLot[] {
  const dates = datesBetween(from, to), inRange = new Set(dates)
  const touched = new Set(dates.flatMap((d) => avanceLots(s, d)))
  for (const r of s.runs) if (!r.endedAt && inRange.has(r.date)) for (const l of runLots(s, r)) if (l) touched.add(l)
  for (const p of s.plans) if (p.qty > 0 && inRange.has(p.date) && planLot(p.lot)) touched.add(planLot(p.lot))
  return [...touched].sort(lotOrder).map((l) => flujoLot(s, l)).filter((l): l is FlujoLot => !!l)
}

/** `inv`: only the rows with inventory (the chip "Con inventario", 2026-10-19: something unpacked or cases without a PO) */
export type FlujoFilter = { q: string; lot: string; route: PackRoom | ''; state: FlujoState | ''; inv?: boolean }
/** every word typed must match the code (plainText, or normCode equality for a numeric word), the product name or the lot */
export function flujoMatch(r: FlujoRow, q: string): boolean {
  const toks = plainText(q).split(/\s+/).filter(Boolean)
  if (!toks.length) return true
  const code = plainText(r.code), name = plainText(r.name), lot = plainText(r.lot), key = normCode(r.code)
  return toks.every((t) => code.includes(t) || (/^\d+$/.test(t) && normCode(t) === key) || name.includes(t) || lot.includes(t))
}
/**
 * the lots in view after the search and the chips; a lot left without rows is dropped and the totals of the others are
 * of the rows left. `search` false = the files' view (range, lot, chips; never the search: the report's rule)
 */
export function flujoFilter(lots: FlujoLot[], f: FlujoFilter, search = true): FlujoLot[] {
  const out: FlujoLot[] = []
  for (const l of lots) {
    if (f.lot && l.lot !== f.lot) continue
    const rows = l.rows.filter((r) => (!f.route || r.route === f.route) && (!f.state || r.state === f.state) && (!f.inv || flujoHasInventory(r)) && (!search || flujoMatch(r, f.q)))
    if (!rows.length) continue
    out.push(rows.length === l.rows.length ? l : { ...l, rows, sum: flujoSum(rows) })
  }
  return out
}

export type DiffClass = 'fl-sobra' | 'fl-falta' | 'fl-ok' | 'fl-none'
/**
 * a difference in words, with the sheet's signs. kind 'room' (Dif. RTE / Dif. MFO, in the room's units): negative =
 * made and not yet packed (sobran), positive = Packing packed more than the room reported (faltan). kind 'cases'
 * (Dif. Packing / Dif. proyectado): negative = cases short, positive = cases over, within half a case = cuadra
 */
export function diffText(kind: 'room' | 'cases', v: number | null, unit: string): { text: string; cls: DiffClass } {
  if (v == null) return { text: '—', cls: 'fl-none' }
  if (kind === 'room') return v < 0 ? { text: tr('sobran {0} {1}', n2(-v), unit), cls: 'fl-sobra' } : v > 0 ? { text: tr('faltan {0} {1}', n2(v), unit), cls: 'fl-falta' } : { text: '✓ 0', cls: 'fl-ok' }
  return v < -CUADRA_CS ? { text: tr('faltan {0} cs', n2(-v)), cls: 'fl-sobra' } : v > CUADRA_CS ? { text: tr('{0} cs de más', n2(v)), cls: 'fl-falta' } : { text: tr('✓ cuadra'), cls: 'fl-ok' }
}
/** the word of a difference without its number (the cell shows the number big and the word under it): "sobran pouches", "faltan cs", "✓ cuadra" */
export function diffWord(kind: 'room' | 'cases', v: number | null, unit: string): string {
  if (v == null) return ''
  if (kind === 'room') return v < 0 ? tr('sobran {0}', unit) : v > 0 ? tr('faltan {0}', unit) : '✓'
  return v < -CUADRA_CS ? tr('faltan cs') : v > CUADRA_CS ? tr('cs de más') : tr('✓ cuadra')
}
/** "Faltan 9 cs", "6.13 cs de más", "✓ Cuadra", "Sin empacar", "Sin comparar", "Sin registros" */
export function flujoStateText(k: FlujoState, diffPacking: number | null): string {
  return k === 'short' ? tr('Faltan {0} cs', n2(-(diffPacking ?? 0))) : k === 'over' ? tr('{0} cs de más', n2(diffPacking ?? 0)) : flujoStateLabel(k)
}
/** the chip's word: Faltan cs / cs de más / Cuadra / Sin empacar / Sin comparar / Sin registros */
export function flujoStateLabel(k: FlujoState): string {
  return k === 'short' ? tr('Faltan cs') : k === 'over' ? tr('cs de más') : k === 'ok' ? tr('✓ Cuadra') : k === 'unpacked' ? tr('Sin empacar') : k === 'nocompare' ? tr('Sin comparar') : tr('Sin registros')
}
/** the words of what Productos lacks for this row: "yield, pouches por caja" ('' when nothing; 'no está en Productos' for a missing product) */
export function missingWords(m: FlujoMissing[]): string {
  if (m.includes('product')) return tr('no está en Productos')
  return m.map((k) => (k === 'yield' ? tr('yield') : k === 'perCase' ? tr('pouches por caja') : tr('cajas por pallet'))).join(', ')
}
/** "Falta en Productos: yield, pouches por caja" ('' when nothing; 'no está en Productos' for a missing product) */
export function missingText(m: FlujoMissing[]): string {
  if (!m.length) return ''
  return m.includes('product') ? tr('no está en Productos') : tr('Falta en Productos: {0}', missingWords(m))
}
/**
 * the arithmetic of one row with its real numbers, line by line (the fold, and the title of each computed cell).
 * `fmtDay` writes a date as the screen does ("sáb, 17 oct"); the checks leave it ISO
 */
export function flujoExplain(r: FlujoRow, fmtDay: (date: string) => string = (d) => d): { key: string; label: string; text: string }[] {
  const out: { key: string; label: string; text: string }[] = []
  const word = r.mfoWordUsed ? mfoWord(r.mfoWordUsed) : ''
  const rte = r.route === 'RTE'
  // a run still open (2026-10-19): said first, in the rooms' own names (plant words, kept as data), because every
  // number under it still changes; a run just started says so instead of leaving "Sin registros" unexplained
  if (r.running) out.push({ key: 'open', label: tr('En curso'), text: r.hasAny ? tr('sigue corriendo en {0}: estos números todavía cambian', r.openIn.join(', ')) : tr('acaba de empezar en {0}: todavía no hay nada registrado de este lote', r.openIn.join(', ')) })
  if (r.mixes > 0) {
    const days = r.days.filter((d) => d.mixes > 0)
    out.push({ key: 'prod', label: tr('Mezclas (PROD)'), text: days.length === 1 ? tr('{0} registradas por {1} el {2}', r.mixes, r.mixRoom, fmtDay(days[0].date)) : tr('{0} registradas por {1}: {2}', r.mixes, r.mixRoom, days.map((d) => fmtDay(d.date) + ': ' + d.mixes).join(' · ')) })
  }
  // Spiral's pounds or cases (2026-10-19): a fact of the lot, said beside the mezclas and used in no formula
  if (r.spiralApart.length) out.push({ key: 'spiral', label: tr('Spiral aparte'), text: tr('Spiral registró {0} de este lote: no se pasa a cajas; el yield es por mezcla', spiralApartText(r.spiralApart)) })
  // the lot's program (2026-10-19): each room's, against what the lot has of the code in that room's word
  if (r.prog.length) out.push({ key: 'program', label: tr('Programa del lote'), text: r.prog.map(progLine).join('; ') })
  if (rte) {
    if (r.perCase == null) out.push({ key: 'segun', label: tr('Según RTE (cs)'), text: tr('nada que comparar: {0}', missingText(['perCase'])) })
    else {
      out.push({ key: 'segun', label: tr('Según RTE (cs)'), text: tr('{0} pouches ÷ {1} por caja = {2}', fmtN(r.pouches), n2(r.perCase), n2(r.segun)) })
      if (r.diffRte != null) out.push({ key: 'diffRoom', label: tr('Dif. RTE'), text: tr('{0} cs × {1} − {2} pouches = {3} ({4})', fmtN(r.cases), n2(r.perCase), fmtN(r.pouches), n2(r.diffRte), diffText('room', r.diffRte, 'pouches').text) })
    }
  } else if (r.mfoUnits > 0 || r.mfoCases > 0) {
    if (r.perCase == null && r.mfoUnits > 0) out.push({ key: 'segun', label: tr('Según MFO (cs)'), text: tr('nada que comparar: {0}', missingText(['perCase'])) })
    else {
      out.push({ key: 'segun', label: tr('Según MFO (cs)'), text: r.mfoUnits > 0 ? tr('{0} {1} ÷ {2} por caja{3} = {4}', fmtN(r.mfoUnits), word, n2(r.perCase), r.mfoCases ? tr(' + {0} cajas de antes', fmtN(r.mfoCases)) : '', n2(r.segun)) : tr('{0} cajas de antes, ya en cajas = {1}', fmtN(r.mfoCases), n2(r.segun)) })
      // bins of before (cases) beside units of now: taken off in units (× units per case); alone: compared in cases
      if (r.diffMfo != null) out.push({ key: 'diffRoom', label: tr('Dif. MFO'), text: r.mfoUnits > 0
        ? tr('{0} cs × {1} − {2} {3} = {4} ({5})', fmtN(r.cases), n2(r.perCase), fmtN(r.mfoUnits) + (r.mfoCases ? ' − ' + fmtN(r.mfoCases) + ' × ' + n2(r.perCase) : ''), word, n2(r.diffMfo), diffText('room', r.diffMfo, word).text)
        : tr('{0} cs − {1} cajas de antes = {2} ({3})', fmtN(r.cases), fmtN(r.mfoCases), n2(r.diffMfo), diffText('room', r.diffMfo, mfoWord('cajas')).text) })
    }
  } else if (r.mfoLb > 0) out.push({ key: 'segun', label: tr('Según MFO (cs)'), text: tr('MFO registró {0}: no se compara en cajas', mfoText(r.mfo)) })
  else out.push({ key: 'segun', label: tr('Según MFO (cs)'), text: tr('MFO no ha registrado nada de este lote') })
  const fromMixes = r.yieldCs && r.mixes > 0 ? n2(r.mixes * r.yieldCs) : '—'
  out.push({ key: 'proj', label: tr('CS proyectado'), text: r.projectedFrom === 'mfo' ? tr('lo que registró MFO, en cajas = {0} (se prefiere a mezclas × yield: {1})', n2(r.projected), fromMixes) : r.projectedFrom === 'mixes' ? tr('{0} mezclas × {1} yield = {2}', r.mixes, n2(r.yieldCs), n2(r.projected)) : tr('sin mezclas de este lote, o sin yield en Productos') })
  out.push({ key: 'diffPacking', label: tr('Dif. Packing'), text: r.diffPacking != null ? tr('{0} − {1} = {2} ({3})', fmtN(r.cases), n2(r.segun), n2(r.diffPacking), diffText('cases', r.diffPacking, 'cs').text) : tr('nada que comparar: {0}', r.mfoOnlyLb ? tr('MFO lo registró en libras: no se pasa a cajas') : r.missing.length ? missingText(r.missing) : r.state === 'none' ? tr('Sin registros') : tr('ningún cuarto ha registrado nada que comparar')) })
  if (r.projected != null) out.push({ key: 'diffProj', label: tr('Dif. de proyectado'), text: tr('{0} − {1} = {2}', fmtN(r.cases), n2(r.projected), n2(r.diffProjected)) })
  if (r.pallets > 0 || r.palletsProjected != null) out.push({ key: 'pallets', label: 'Pallets', text: r.palletsProjected != null ? tr('{0} hechos · proyectados {1} ÷ {2} por pallet = {3}', r.pallets, n2(r.projected), n2(r.perPallet), n2(r.palletsProjected)) : tr('{0} hechos', r.pallets) })
  return out
}
/**
 * CONSUMO of one row with its real numbers, line by line (the fold's "Consumo" block, and the title of its two cells):
 * mezclas hechas / usadas / quedan, pouches (or MFO's units) hechos / usados / quedan, cajas hechas / en pedidos /
 * sin pedido, pallets hechos / en pedidos. A number that cannot be computed says why (Jose, 2026-10-19: nothing here
 * is typed, so every number must say where it came from)
 */
export function flujoConsumo(r: FlujoRow): { key: string; label: string; text: string }[] {
  const out: { key: string; label: string; text: string }[] = []
  const rte = r.route === 'RTE', word = unitWordText(r.unitWord)
  const why = (m: FlujoMissing) => (!r.inTable ? missingText(['product']) : r.mfoOnlyLb ? tr('MFO lo registró en libras: no se pasa a cajas') : missingText([m]))
  // mezclas: usadas = what the pack room reported, in cases, ÷ yield. Said with the room's own count when it is one
  // count (pouches, or MFO's units alone); with the bins of before beside the units, by way of Según MFO (cs)
  if (r.mixesUsed == null) out.push({ key: 'mixes', label: tr('Mezclas'), text: tr('{0} hechas · usadas: nada que calcular ({1})', r.mixes, r.yieldCs == null ? why('yield') : why('perCase')) })
  else {
    const how = rte ? tr('{0} pouches ÷ ({1} yield × {2} por caja) = {3}', fmtN(r.pouches), n2(r.yieldCs), n2(r.perCase), n2(r.mixesUsed))
      : r.mfoUnits > 0 && !r.mfoCases ? tr('{0} {1} ÷ ({2} yield × {3} por caja) = {4}', fmtN(r.mfoUnits), word, n2(r.yieldCs), n2(r.perCase), n2(r.mixesUsed))
      : tr('{0} cs según MFO ÷ {1} yield = {2}', n2(r.segun), n2(r.yieldCs), n2(r.mixesUsed))
    out.push({ key: 'mixes', label: tr('Mezclas'), text: tr('{0} hechas · usadas {1} · quedan {2}', r.mixes, how, n2(r.mixesLeft)) + (r.madeOver ? ' · ' + tr('{0} hizo más de lo que dan las mezclas', r.route) : '') })
  }
  // pouches / units: hechos by the pack room, usados by Packing (cases × units per case), quedan
  const label = rte ? tr('Pouches') : tr('Unidades')
  if (r.unitsMade == null) out.push({ key: 'units', label, text: r.mfoOnlyLb ? tr('MFO lo registró en libras: no se pasa a cajas') : r.mfoCases > 0 ? tr('bins de antes de 2026-10-17, que ya contaban cajas: ver Cajas') : tr('MFO no ha registrado nada de este lote') })
  else if (r.unitsUsed == null) out.push({ key: 'units', label, text: tr('{0} {1} hechos · usados: nada que calcular ({2})', fmtN(r.unitsMade), word, why('perCase')) })
  else {
    const cs = !rte && r.mfoCases > 0 ? '(' + fmtN(r.cases) + ' − ' + fmtN(r.mfoCases) + ' ' + tr('cajas de antes') + ')' : fmtN(r.cases)
    out.push({ key: 'units', label, text: tr('{0} {1} hechos · usados en cajas {2} cs × {3} por caja = {4} · quedan {5}', fmtN(r.unitsMade), word, cs, n2(r.perCase), n2(r.unitsUsed), n2(r.unitsLeft)) + (r.packedOver ? ' · ' + tr('Packing empacó más de lo que reportó {0}', r.route) : '') })
  }
  out.push({ key: 'cases', label: tr('Cajas'), text: r.cases > 0 ? tr('{0} hechas · {1} en pedidos ({2}) · {3} sin pedido', fmtN(r.cases), fmtN(r.casesOnPo), r.palletsOnPo === 1 ? tr('1 pallet') : tr('{0} pallets', r.palletsOnPo), fmtN(r.casesFree)) : tr('ninguna empacada todavía') })
  if (r.pallets > 0) out.push({ key: 'pallets', label: 'Pallets', text: tr('{0} hechos · {1} en pedidos', r.pallets, r.palletsOnPo) })
  return out
}

/** the days of a lot as the sheet writes them: ISO, joined */
const daysText = (days: LotDay[]) => days.map((d) => d.date).join(', ')
/** a number for the Excel: a known number as it is (r2), '' for not known or for the other route's cell */
const cell = (v: number | null | undefined): Cell => (v == null ? '' : r2(v))
/**
 * The Excel's sheet: the office's own column names (YIEL, POUCH X CS, COD, SEGÚN RTE (CS), DIFERENCIAS / …), FLAT, the
 * lot on every row, one row per lot × code in screen order, so Excel sorts and filters it like the clerk's sheet. The
 * signs go in the Leyenda sheet (flujoLegend) instead of in the headers. Made numbers go as 0 when 0 (the office adds
 * them up); a blank in Productos and the other route's cells go blank, as on the screen. MFO's cell goes blank, not
 * 0, when MFO registered only pounds (they are under "MFO además": a 0 read as "MFO registered nothing", review of
 * 2026-10-18). The CONSUMO columns come last (2026-10-19): one pair of UNIDADES columns for both routes, with the
 * word they count in under UNIDAD (pouches, platos, copas), so the office adds pouches to pouches and never to platos.
 * Then (2026-10-19), SPIRAL APARTE with its SPIRAL EN: what Spiral weighed or counted apart, a number with its
 * word (blank where Spiral weighed nothing: a 0 would read "Spiral registered nothing", as MFO's); with both measures
 * in one lot, in text with each word, never added. Last of all (2026-10-19 too), PROGRAMADO with its PROG. CUARTO:
 * what the office programmed of the code for this lot, a number with the room and its word ("Kitchen · mezclas");
 * programmed in more than one room, in text with each room's figure, the room blank (as Spiral's two measures); blank
 * where nothing names the lot
 */
export function flujoSheet(lots: FlujoLot[]): Cell[][] {
  const head: Cell[] = [tr('Lote'), tr('Fechas del lote'), tr('COD'), tr('Producto'), tr('Lo empaca'), tr('YIEL'), tr('POUCH X CS'), tr('PROD'), tr('Cuarto de las mezclas'), tr('RTE'), tr('DIFERENCIAS / RTE'), tr('MFO'), tr('MFO en'), tr('MFO además'), tr('DIFERENCIAS / MFO'), tr('SEGÚN RTE (CS)'), tr('PACKING'), tr('Pallets'), tr('DIFERENCIAS / PACKING'), tr('CS PROYECTADO'), tr('Proyectado desde'), tr('Diferencia de proyectado'), tr('Pallets proyectados'), tr('ESTADO'), tr('En curso'), tr('Falta en Productos'),
    tr('CONSUMO: MEZCLAS USADAS'), tr('MEZCLAS QUE QUEDAN'), tr('UNIDAD'), tr('UNIDADES USADAS EN CAJAS'), tr('UNIDADES QUE QUEDAN'), tr('CAJAS EN PEDIDOS'), tr('CAJAS SIN PEDIDO'), tr('PALLETS EN PEDIDOS'),
    tr('SPIRAL APARTE'), tr('SPIRAL EN'), tr('PROGRAMADO'), tr('PROG. CUARTO')]
  return [head, ...lots.flatMap((l) => l.rows.map((r): Cell[] => {
    const rte = r.route === 'RTE'
    const rest = r.mfo.filter((m) => m.word !== r.mfoWordUsed)
    const apart = r.spiralApart, prog = r.prog
    return [
      l.lot, daysText(r.days), r.code, r.name, r.route + (r.routeSaid ? '' : ' ?'), cell(r.yieldCs), cell(r.perCase), r.mixes, r.mixes > 0 ? r.mixRoom : '',
      rte ? r.pouches : '', rte ? cell(r.diffRte) : '',
      !rte ? (r.mfoUnits > 0 ? r.mfoUnits : r.mfoCases > 0 ? r.mfoCases : r.mfoLb > 0 ? '' : 0) : '', !rte && r.mfoWordUsed ? mfoWord(r.mfoWordUsed) : '', !rte && rest.length ? mfoText(rest) : '', !rte ? cell(r.diffMfo) : '',
      cell(r.segun), r.cases, r.pallets, cell(r.diffPacking), cell(r.projected), r.projectedFrom === 'mfo' ? tr('MFO') : r.projectedFrom === 'mixes' ? tr('mezclas × yield') : '', cell(r.diffProjected), cell(r.palletsProjected),
      flujoStateText(r.state, r.diffPacking), r.running ? tr('sí') : '', missingWords(r.missing),
      cell(r.mixesUsed), cell(r.mixesLeft), unitWordText(r.unitWord), cell(r.unitsUsed), cell(r.unitsLeft), r.casesOnPo, r.casesFree, r.palletsOnPo,
      apart.length === 1 ? apart[0].qty : apart.length ? spiralApartText(apart) : '', apart.length === 1 ? measureUnit(apart[0].word) : '',
      prog.length === 1 ? prog[0].qty : prog.length ? prog.map((p) => fmtN(p.qty) + ' ' + progWord(p) + ' ' + p.dept).join(' · ') : '', prog.length === 1 ? prog[0].dept + ' · ' + progWord(prog[0]) : '',
    ]
  }))]
}
/** the Leyenda sheet: [Columna, Qué es] with each formula in words and the sheet's sign rules; a last row 'Generado' with what was in view */
export function flujoLegend(viewing: string): Cell[][] {
  return [
    [tr('Columna'), tr('Qué es')],
    [tr('Lote'), tr('El lote, con todos sus días (un lote sigue al día siguiente). Una fila por código del lote.')],
    [tr('Lo empaca'), tr('RTE o MFO, de la tabla de Productos; con "?" la app lo supone por lo que ha registrado cada cuarto. Solo se calcula ese cuarto; las columnas del otro quedan en blanco.')],
    [tr('YIEL'), tr('Cajas por mezcla, de la tabla de Productos.')],
    [tr('POUCH X CS'), tr('Pouches por caja (en un código de MFO: platos o copas por caja), de la tabla de Productos.')],
    [tr('PROD'), tr('Mezclas registradas del lote por Kitchen o Spiral (el cuarto que hace el código).')],
    [tr('RTE'), tr('Pouches registrados por RTE de ese lote.')],
    [tr('DIFERENCIAS / RTE'), tr('PACKING × POUCH X CS − RTE. Negativo: sobra (pouches hechos sin empacar). Positivo: falta (Packing empacó más de lo que RTE reportó).')],
    [tr('MFO'), tr('Lo que registró MFO del lote en la palabra que cuenta ("MFO en": platos o copas; con dos palabras en un lote, la que más tiene). "MFO además" trae las libras y lo registrado con otra palabra, que no se pasan a cajas.')],
    [tr('DIFERENCIAS / MFO'), tr('PACKING × POUCH X CS − MFO, en lo que llenan sus bins (en cajas si son bins de antes de 2026-10-17, que contaban cajas). Negativo: sobra (hecho sin empacar). Positivo: falta (Packing empacó más de lo que MFO reportó).')],
    [tr('SEGÚN RTE (CS)'), tr('Lo reportado por el cuarto que empaca, en cajas: RTE ÷ POUCH X CS, o MFO ÷ unidades por caja (más las cajas de bins de antes).')],
    [tr('PACKING'), tr('Cajas en pallets que llevan ese lote (un pallet con dos lotes da a cada uno sus cajas). Los bins de Packing no son cajas.')],
    [tr('DIFERENCIAS / PACKING'), tr('PACKING − SEGÚN RTE (CS). Negativo: faltan cajas. Positivo: cajas de más. Cuadra entre −0.5 y 0.5.')],
    [tr('CS PROYECTADO'), tr('PROD × YIEL. Si lo empaca MFO y MFO ya registró, lo de MFO ÷ unidades por caja (como en la hoja de la oficina).')],
    [tr('Diferencia de proyectado'), tr('PACKING − CS PROYECTADO (la hoja lo deja en blanco; aquí se calcula).')],
    [tr('Pallets proyectados'), tr('CS PROYECTADO ÷ cajas por pallet.')],
    [tr('ESTADO'), tr('Calculado con los números: Sin registros, Sin empacar, Faltan N cs, N cs de más, Cuadra, Sin comparar. El ESTADO del ERP no está en la app.')],
    [tr('En curso'), tr('"sí" cuando un código del lote sigue corriendo en alguna línea: sus números todavía cambian. Una corrida recién empezada ya tiene su fila, en ceros.')],
    [tr('Falta en Productos'), tr('Lo que la tabla de Productos no tiene de ese código y hace falta para calcular: la celda sale en blanco, nunca en 0.')],
    [tr('CONSUMO'), tr('Lo que el lote gastó y lo que queda, con los mismos números (nadie lo escribe). Queda en inventario lo hecho y todavía por empacar y las cajas que no van en ningún pedido.')],
    [tr('CONSUMO: MEZCLAS USADAS'), tr('SEGÚN RTE (CS) ÷ YIEL: las mezclas que dan lo que reportó el cuarto que empaca (RTE ÷ (YIEL × POUCH X CS), o lo de MFO ÷ (YIEL × unidades por caja)). En blanco sin YIEL o sin nada en cajas.')],
    [tr('MEZCLAS QUE QUEDAN'), tr('PROD − MEZCLAS USADAS, nunca menos de 0 (si el cuarto hizo más de lo que dan las mezclas, lo dicen las DIFERENCIAS).')],
    [tr('UNIDAD'), tr('En qué se cuentan las dos columnas que siguen: pouches (RTE) o lo que llenan los bins de MFO (platos, copas). Se suman pouches con pouches, nunca con platos.')],
    [tr('UNIDADES USADAS EN CAJAS'), tr('PACKING × POUCH X CS: lo que Packing metió en cajas (en MFO, las cajas aparte de los bins de antes de 2026-10-17, que ya eran cajas).')],
    [tr('UNIDADES QUE QUEDAN'), tr('RTE (o MFO) − UNIDADES USADAS EN CAJAS, nunca menos de 0: hecho y todavía por empacar. En blanco si MFO solo registró libras o nada.')],
    [tr('CAJAS EN PEDIDOS'), tr('De PACKING, las cajas en pallets que llevan un PO (un pallet con dos lotes da a cada lote sus cajas). Da igual si el pedido ya se marcó completo.')],
    [tr('CAJAS SIN PEDIDO'), tr('PACKING − CAJAS EN PEDIDOS: cajas empacadas que no van en ningún pedido.')],
    [tr('PALLETS EN PEDIDOS'), tr('De los pallets que llevan el lote, los que llevan un PO.')],
    [tr('SPIRAL APARTE'), tr('Lo que Spiral registró del lote pesando cada mezcla en libras o contándola en cajas ("Spiral cuenta en", en Productos): tal cual, no se pasa a cajas ni cuenta como mezclas, porque el yield es por mezcla. En blanco si Spiral no pesó nada del lote; con las dos medidas en un lote, las dos en texto, sin sumarlas.')],
    [tr('SPIRAL EN'), tr('En qué lo registró Spiral: lb o cajas.')],
    [tr('PROGRAMADO'), tr('Lo que la oficina programó de ese código para ese lote (el programa de un cuarto puede llevar su lote desde 2026-10-19), sumando todos los días que lo nombran, en la unidad del cuarto: mezclas en Kitchen y Spiral (o lb / cajas si Spiral cuenta así el código), pouches en RTE, lo que llenan los bins en MFO, cajas en Packing. En blanco si ningún programa nombra el lote; programado en más de un cuarto, cada cifra con su cuarto, en texto. Un programa sin lote es del día (Avance) y no se cuenta aquí.')],
    [tr('PROG. CUARTO'), tr('El cuarto que lo tiene programado y su unidad ("Kitchen · mezclas"). En blanco con más de un cuarto.')],
    [tr('Generado'), viewing],
  ]
}
/** 'actividad-flujo-2026-10-05-a-2026-10-18[-lote-6222][-rte|-mfo][-faltan|-demas|-cuadra|-sinempacar|-sincomparar][-inventario]' (ASCII only, as filterFile) */
export function flujoFile(from: string, to: string, f: Omit<FlujoFilter, 'q'>): string {
  const clean = (t: string) => t.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const state = f.state === 'short' ? 'faltan' : f.state === 'over' ? 'demas' : f.state === 'ok' ? 'cuadra' : f.state === 'unpacked' ? 'sinempacar' : f.state === 'nocompare' ? 'sincomparar' : f.state === 'none' ? 'sinregistros' : ''
  const [a, b] = from <= to ? [from, to] : [to, from]
  return 'actividad-flujo-' + a + '-a-' + b + (f.lot ? '-lote-' + clean(f.lot) : '') + (f.route ? '-' + f.route.toLowerCase() : '') + (state ? '-' + state : '') + (f.inv ? '-inventario' : '')
}
