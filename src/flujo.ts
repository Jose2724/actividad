import { apartOf, fmtN, normCode, orderOfId, plainText, productOf, type PackRoom, type Product, type State } from './store'
import { avanceLots, datesBetween, lotAcrossDays, lotsKnown, mfoList, mfoText, mfoWord, packRoomOf, type LotDay, type MfoMade } from './avance'
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
/** the raw numbers of one code in one lot, in the sheet's words; null = blank in Productos (not known, never 0) */
export type FlujoIn = {
  route: PackRoom; inTable: boolean
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
  const hasAny = x.mixes > 0 || x.pouches > 0 || x.mfoUnits > 0 || x.mfoCases > 0 || x.mfoLb > 0 || x.cases > 0 || x.pallets > 0
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

export type FlujoRow = FlujoIn & FlujoCalc & {
  lot: string; code: string; product: Product | undefined; name: string
  routeSaid: boolean                 // false = packRoomOf guessed it ("?")
  mixRoom: 'Kitchen' | 'Spiral'
  days: LotDay[]                     // what each day made of it (lotAcrossDays), sorted
  mfo: MfoMade[]                     // word by word, the usual first (for display)
  mfoWordUsed: string                // the countable word MFO used ('' when none): platos, copas, or cajas for bins of before
  running: boolean                   // a run of this code touching the lot is still open
  otherRte: boolean                  // MFO route but RTE registered pouches of this lot (shown as a note, never computed)
  otherMfo: boolean                  // RTE route but MFO registered something of this lot
  unitWord: string                   // the word unitsMade/Used/Left count in: 'pouches', or MFO's word ('' when they are null)
}
/** what is left unpacked under one word (pouches, platos, copas…) over some rows, and in how many of them there is some */
export type FlujoLeft = { word: string; qty: number; rows: number }
export type FlujoSum = {
  codes: number; cases: number; pallets: number; projected: number | null; states: Record<FlujoState, number>; shortCs: number; overCs: number
  left: FlujoLeft[]           // CONSUMO: unpacked, word by word (a word is never added to another: pouches apart from platos apart from copas)
  casesFree: number; freeRows: number; casesOnPo: number; palletsOnPo: number
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
/** one row from one code of lotAcrossDays(s, lot); `onPo` = flujoOnPo(s, lot) when the caller has it (flujoLot does, once per lot) */
export function flujoRow(s: State, lot: string, c: ReturnType<typeof lotAcrossDays>['codes'][number], onPo?: Map<string, { cases: number; pallets: number }>): FlujoRow {
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
  const input: FlujoIn = { route, inTable: !!product, yieldCs, perCase, perPallet, mixes: c.mixes, pouches: c.pouches, mfoUnits, mfoCases, mfoLb, cases: c.cases, pallets: c.pallets, casesOnPo: po.cases, palletsOnPo: po.pallets }
  const calc = flujoCalc(input)
  return {
    ...input, ...calc,
    lot, code: c.code, product, name: product?.name ?? '', routeSaid, mixRoom: c.mixRoom, days: c.days, mfo, mfoWordUsed,
    running: s.runs.some((r) => !r.endedAt && normCode(r.code) === key && runLots(s, r).has(lot)),
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
  }
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
  const a = lotAcrossDays(s, lot)
  const onPo = flujoOnPo(s, lot)
  const rows = a.codes.map((c) => flujoRow(s, lot, c, onPo)).filter((r) => r.hasAny).sort((p, q) => p.code.localeCompare(q.code, undefined, { numeric: true }))
  if (!rows.length) return null
  const days = [...new Set(rows.flatMap((r) => r.days.map((d) => d.date)))].sort()
  return { lot, days, rows, sum: flujoSum(rows) }
}
/** the lots touched between two dates (both included; turned around if reversed), each over ALL its days, the newest lot first (lotsKnown's order) */
export function flujoLots(s: State, from: string, to: string): FlujoLot[] {
  const touched = new Set(datesBetween(from, to).flatMap((d) => avanceLots(s, d)))
  return lotsKnown(s).filter((l) => touched.has(l)).map((l) => flujoLot(s, l)).filter((l): l is FlujoLot => !!l)
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
  if (r.mixes > 0) {
    const days = r.days.filter((d) => d.mixes > 0)
    out.push({ key: 'prod', label: tr('Mezclas (PROD)'), text: days.length === 1 ? tr('{0} registradas por {1} el {2}', r.mixes, r.mixRoom, fmtDay(days[0].date)) : tr('{0} registradas por {1}: {2}', r.mixes, r.mixRoom, days.map((d) => fmtDay(d.date) + ': ' + d.mixes).join(' · ')) })
  }
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
 * word they count in under UNIDAD (pouches, platos, copas), so the office adds pouches to pouches and never to platos
 */
export function flujoSheet(lots: FlujoLot[]): Cell[][] {
  const head: Cell[] = [tr('Lote'), tr('Fechas del lote'), tr('COD'), tr('Producto'), tr('Lo empaca'), tr('YIEL'), tr('POUCH X CS'), tr('PROD'), tr('Cuarto de las mezclas'), tr('RTE'), tr('DIFERENCIAS / RTE'), tr('MFO'), tr('MFO en'), tr('MFO además'), tr('DIFERENCIAS / MFO'), tr('SEGÚN RTE (CS)'), tr('PACKING'), tr('Pallets'), tr('DIFERENCIAS / PACKING'), tr('CS PROYECTADO'), tr('Proyectado desde'), tr('Diferencia de proyectado'), tr('Pallets proyectados'), tr('ESTADO'), tr('En curso'), tr('Falta en Productos'),
    tr('CONSUMO: MEZCLAS USADAS'), tr('MEZCLAS QUE QUEDAN'), tr('UNIDAD'), tr('UNIDADES USADAS EN CAJAS'), tr('UNIDADES QUE QUEDAN'), tr('CAJAS EN PEDIDOS'), tr('CAJAS SIN PEDIDO'), tr('PALLETS EN PEDIDOS')]
  return [head, ...lots.flatMap((l) => l.rows.map((r): Cell[] => {
    const rte = r.route === 'RTE'
    const rest = r.mfo.filter((m) => m.word !== r.mfoWordUsed)
    return [
      l.lot, daysText(r.days), r.code, r.name, r.route + (r.routeSaid ? '' : ' ?'), cell(r.yieldCs), cell(r.perCase), r.mixes, r.mixes > 0 ? r.mixRoom : '',
      rte ? r.pouches : '', rte ? cell(r.diffRte) : '',
      !rte ? (r.mfoUnits > 0 ? r.mfoUnits : r.mfoCases > 0 ? r.mfoCases : r.mfoLb > 0 ? '' : 0) : '', !rte && r.mfoWordUsed ? mfoWord(r.mfoWordUsed) : '', !rte && rest.length ? mfoText(rest) : '', !rte ? cell(r.diffMfo) : '',
      cell(r.segun), r.cases, r.pallets, cell(r.diffPacking), cell(r.projected), r.projectedFrom === 'mfo' ? tr('MFO') : r.projectedFrom === 'mixes' ? tr('mezclas × yield') : '', cell(r.diffProjected), cell(r.palletsProjected),
      flujoStateText(r.state, r.diffPacking), r.running ? tr('sí') : '', missingWords(r.missing),
      cell(r.mixesUsed), cell(r.mixesLeft), unitWordText(r.unitWord), cell(r.unitsUsed), cell(r.unitsLeft), r.casesOnPo, r.casesFree, r.palletsOnPo,
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
    [tr('En curso'), tr('"sí" cuando un código del lote sigue corriendo en alguna línea: sus números todavía cambian.')],
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
