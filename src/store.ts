// Everything is saved on this device first (localStorage). With a server configured (see supabase.ts) every change is
// also queued for upload (outbox.ts) and what other devices send arrives through sync.ts.
import { drop, justSent, outbox, push, queued, rebase, rekey, type Row, type Table } from './outbox'
import { storageFull } from './storage'
import { clockNow } from './clock'
import { lang, tr, trIn } from './i18n'
import { codeReason, codeText, OTHER_CODE, reasonCodeOf, SETUP_CODE, typedCode } from './reasons'

export type Dept = 'Kitchen' | 'RTE' | 'Spiral' | 'MFO' | 'Packing'
export const DEPTS: Dept[] = ['Kitchen', 'RTE', 'Spiral', 'MFO', 'Packing']

/**
 * How each department counts its work and why its lines stop — the words of the shift manager and of the office
 * sheets ("FORMATO POR CUARTO"): Kitchen cooks mezclas in braisers, Spiral cooks batches (they call them mezclas too),
 * RTE fills carts whose pouches are counted by the office (pouches per cart depend on the code), MFO fills bins and
 * writes the cases and the bin number, Packing builds pallets and writes the cases and the tag number.
 * qty: 'none' = only count the units; 'ask' = ask the quantity each time, proposing the usual one (pouches per
 * cart, boxes per pallet) so a short cart or pallet is typed on the spot; 'auto' = every unit carries the quantity
 * given at the start, with no question. saved = how the unit is said to be recorded ("guardada" for a mezcla).
 * lots = a unit can carry more than one lot of the product, each with its quantity (a pallet in Packing).
 * orders = its units go to customers' orders (see "the orders Packing fills").
 * quick = the three causes "Parar" offers (anything else is typed under "Otra"): the people on the line choose in one
 * tap. reasons = the department's complete list, quick ones first: the manager's, when a stop is corrected or divided.
 */
export type DeptCfg = { lineWord: string; unit: string; plural: string; done: string; saved: string; qty: 'none' | 'ask' | 'auto'; qtyQ: string; qtyUnit: string; perUnitLabel: string; refLabel: string; refWord?: string; quick: string[]; reasons: string[]; waste?: boolean; lots?: boolean; orders?: boolean }
export const CFG: Record<Dept, DeptCfg> = {
  Kitchen: { lineWord: tr('Braiser'), unit: tr('Mezcla'), plural: tr('Mezclas'), done: tr('Mezcla lista'), saved: tr('guardada'), waste: true, qty: 'none', qtyQ: '', qtyUnit: '', perUnitLabel: '', refLabel: '', quick: ['Problema mecánico', 'Esperando ingredientes', 'Break'], reasons: ['Problema mecánico', 'Esperando ingredientes', 'Break', 'Braiser apagado', 'Esperando que recojan producto', 'Limpieza', 'Falta de personal', 'Calidad', 'Set up'] },
  Spiral: { lineWord: tr('Línea'), unit: tr('Mezcla'), plural: tr('Mezclas'), done: tr('Mezcla lista'), saved: tr('guardada'), waste: true, qty: 'none', qtyQ: '', qtyUnit: '', perUnitLabel: '', refLabel: '', quick: ['Problema mecánico', 'Falta de producto de Kitchen', 'Break'], reasons: ['Problema mecánico', 'Falta de producto de Kitchen', 'Break', 'Horno (temperatura)', 'Temperatura interna baja', 'Esperando carros / RTE', 'Limpieza', 'Falta de personal', 'Calidad', 'Set up'] },
  RTE: { lineWord: tr('Línea'), unit: tr('Carro'), plural: tr('Carros'), done: tr('Carro listo'), saved: tr('guardado'), qty: 'ask', qtyQ: tr('¿Cuántos pouches lleva este carro?'), qtyUnit: tr('pouches'), perUnitLabel: tr('Pouches por carro'), refLabel: '', waste: true, quick: ['Problema mecánico', 'Sin plástico', 'Break'], reasons: ['Problema mecánico', 'Sin plástico', 'Break', 'Falta de salsa (Kitchen)', 'Falta de arroz / arroz muy frío', 'Falta de carrito vacío', 'Cambio de rollo de plástico', 'Plástico atascado / no corta', 'Máquina corta o rompe paquetes (mecánico)', 'Impresora de sello no imprime', 'Peso fuera de rango (reempaque)', 'Aire en el paquete', 'Conteo / pesado de meatballs', 'Limpieza', 'Falta de personal', 'Set up'] },
  MFO: { lineWord: tr('Línea'), unit: tr('Bin'), plural: tr('Bins'), done: tr('Bin listo'), saved: tr('guardado'), waste: true, qty: 'ask', qtyQ: tr('¿Cuántos platos lleva este bin?'), qtyUnit: tr('platos'), perUnitLabel: '', refLabel: tr('N° de bin'), refWord: 'bin', quick: ['Problema mecánico', 'Falta de producto del freezer', 'Break'], reasons: ['Problema mecánico', 'Falta de producto del freezer', 'Break', 'Armado de máquina', 'Pegado de labels / stickers', 'Esperando gas', 'Preparación (picar pollo…)', 'Falta de material', 'Limpieza', 'Falta de personal', 'Set up'] },
  Packing: { lineWord: tr('Línea'), unit: tr('Pallet'), plural: tr('Pallets'), done: tr('Pallet listo'), saved: tr('guardado'), waste: true, lots: true, orders: true, qty: 'ask', qtyQ: tr('¿Cuántas cajas lleva este pallet?'), qtyUnit: tr('cajas'), perUnitLabel: tr('Cajas por pallet'), refLabel: tr('N° de tag'), refWord: 'tag', quick: ['Problema mecánico', 'Falta de producto que empacar', 'Break'], reasons: ['Problema mecánico', 'Falta de producto que empacar', 'Break', 'Esperando autorización de QC', 'Label equivocado (despegar labels)', 'Plástico / film', 'Falta de cajas / material de empaque', 'Personal pasó a otra línea', 'Etiquetadora / impresora', 'Montacargas / espacio', 'Limpieza', 'Falta de personal', 'Set up'] },
}
/** the words of a run: its room's, or those of a bin when a Packing line fills bins */
export function cfgOf(r: Pick<Run, 'dept' | 'extra'>): DeptCfg {
  const m = measureOf(r)
  if (m) return { ...CFG.Spiral, qty: 'ask', qtyQ: m === 'lb' ? tr('¿Cuántas libras lleva esta mezcla?') : tr('¿Cuántas cajas lleva esta mezcla?'), qtyUnit: measureUnit(m), perUnitLabel: '' }
  // MFO: every line fills bins, and each bin says what it holds as the operators type it: platos (the room's usual),
  // copas, or pounds for the products that are weighed. Nothing is turned into cases (Jose, 2026-10-17). A run of
  // before that day has no word: its bins counted cases
  // (bags, 2026-10-22: the roaster chicken goes in bags of pounds: a "Bag lista" asks its pounds)
  if (r.dept === 'MFO' && r.extra?.pack === 'bag') return { ...CFG.MFO, unit: tr('Bag'), plural: tr('Bags'), done: tr('Bag lista'), saved: tr('guardada'), qtyQ: tr('¿Cuántas libras lleva esta bag?'), qtyUnit: tr('lb'), refLabel: tr('N° de bag'), refWord: 'bag' }
  if (r.dept === 'MFO') { const w = r.extra?.bin || 'cajas'; return w === 'platos' ? CFG.MFO : { ...CFG.MFO, qtyQ: binQ(w), qtyUnit: w === 'lb' ? tr('lb') : binWord(w) } }
  const word = binOf(r)
  if (!word) return CFG[r.dept]
  const shown = binWord(word)
  return { ...CFG[r.dept], unit: tr('Bin'), plural: tr('Bins'), done: tr('Bin listo'), saved: tr('guardado'), lots: false, orders: false, qty: 'ask', qtyQ: binQ(word), qtyUnit: shown, perUnitLabel: tr('{0} por bin', shown), refLabel: tr('N° de bin'), refWord: 'bin' }
}
/** what a line's "listo" button says for a moment once the unit is recorded: "Mezcla 5 guardada", "Carro 12 guardado" */
export const savedText = (dept: Dept, n: number, c: DeptCfg = CFG[dept]) => c.unit + ' ' + n + ' ' + c.saved

export type Line = { id: string; dept: Dept; name: string; updatedAt: number; deleted?: boolean; syncedAt?: number }
/**
 * one finished unit of work (a cart, a mezcla, a pallet…), how much it carried, its tag / bin number and who tapped it.
 * po = the order it goes to (Order.id). note = a comment on this one unit (Jose, 2026-10-18, on the lots of a pallet
 * in Corregir: "agregar también comentarios a cada registro con lotes combinados"): typed when the pallet is finished,
 * in its lots window, in "Agregar pallet" or in Corregir, beside the run's own comment (RunExtra.note), and only by a
 * person. Kept as that one is: '' = it had one and it was cleared on purpose (the key stays, so a merge tells it from
 * a version written by a build of before, which drops what it does not know: see unitOf, noteBack and mergeRun)
 */
/**
 * into (Jose, 2026-10-29, Packing's PO 117973674 read "3 de 2": the first shift left a pallet short at 32 and the second
 * put the 16 it lacked on that same pallet, registered as a new one): a short pallet that another one finished. Its
 * cases are still its own, with its shift and who made them; the pallet is the one that finished it ("el que terminó
 * la paleta, a ese se le da esa paleta"), which shows these parts with its own. Packing's pallets only
 */
export type Unit = { at: number; qty: number | null; ref: string; by: string; lots?: LotPart[]; po?: string; note?: string; into?: { run: string; at: number } }
/** the part of a unit that belongs to one lot: a pallet can carry cases of two lots of the same product */
export type LotPart = { lot: string; qty: number; tag?: string }
/** the lots written on a unit, as they are kept: only real ones (a lot, and a quantity above zero); none = the run's lot */
export const cleanLots = (x: unknown): LotPart[] | undefined => {
  if (!Array.isArray(x)) return undefined
  const out = x.map((l) => { const p = (l ?? {}) as Partial<LotPart>, tag = String(p.tag ?? '').trim().slice(0, 30); return { lot: String(p.lot ?? '').trim(), qty: Number(p.qty), ...(tag ? { tag } : {}) } }).filter((l) => l.lot && Number.isFinite(l.qty) && l.qty > 0)
  return out.length ? out : undefined
}
/** a unit as it is kept, whatever shape it arrives in (an older version of the app, the server) */
// (the comment last, also when it is '': the same unit read from the server and from this device is written the same)
const unitOf = (u: Partial<Unit>): Unit => { const lots = cleanLots(u.lots); return { at: u.at ?? 0, qty: u.qty ?? null, ref: u.ref ?? '', by: u.by ?? '', ...(lots ? { lots } : {}), ...(typeof u.po === 'string' && u.po ? { po: u.po } : {}), ...(typeof u.note === 'string' ? { note: cleanNote(u.note) } : {}), ...(u.into && typeof u.into === 'object' && typeof u.into.run === 'string' && u.into.run && Number(u.into.at) > 0 ? { into: { run: u.into.run, at: Number(u.into.at) } } : {}) } }
/** "6283: 20 + 6284: 16" */
export const lotsText = (lots: LotPart[] | undefined) => (lots?.length ? lots.map((l) => l.lot + ': ' + l.qty + (l.tag ? ' (tag ' + l.tag + ')' : '')).join(' + ') : '')
/**
 * one product code run on one line: the clock starts at startedAt; perUnit = quantity per unit (boxes per pallet,
 * pouches per cart); waste = pounds thrown away while running it (the WASTE column of the office's RTE sheet)
 */
export type Run = { id: string; dept: Dept; lineId: string; line: string; code: string; lot: string; date: string; startedAt: number; endedAt: number | null; units: Unit[]; perUnit: number | null; waste: number; by: string; updatedAt: number; deleted?: boolean; extra?: RunExtra; syncedAt?: number }
/**
 * What a Packing run carries besides the pallets it finished.
 *  - bin: the line fills bins instead of pallets, and this is the word for what a bin holds (platos, copas, pouches or
 *    the one they type). Its bins are counted apart: what they hold is not cases.
 *  - lotNow: the lot being packed now, once a lot ran out on a pallet and the next one came (absent = the run's lot).
 *  - open: the pallet being built: the lots it already holds, each with its cases and its tag (written when that lot
 *    ran out, or later), and the order it goes to (po: '' = they said none; absent = not said, and the app proposes
 *    one, see palletPo). Every pallet of an order carries the same PO: the next pallet keeps it while the order
 *    still lacks cases.
 *  - note: a comment on the record, typed by whoever added it after the fact or corrected it (Jose, 2026-10-18, on
 *    "Agregar un registro · Packing": "Puedes también poner aquí una casilla para poner comentarios por favor").
 *    Only a person writes it, when the record is added or in Corregir; the app never fills it in. '' = it had one
 *    and it was cleared: the key stays, so a merge tells a comment taken off on purpose from a version written by a
 *    build of before comments, which drops what it does not know (see cleanExtra in those builds, and mergeNote).
 * It travels in act_runs.extra (supabase/migrations/008_run_extra.sql).
 */
export type PalletPart = { lot: string; qty: number; tag: string; at: number; by: string }
export type RunExtra = { bin?: string; lotNow?: string; open?: { parts: PalletPart[]; po?: string }; measure?: Measure; removed?: number[]
  /** MFO filling bags instead of bins (Jose, 2026-10-22: the ROASTER chicken, "que en vez de bin diga bags"): bin is 'lb' then, so every sum counts pounds as before; only the words change */
  pack?: 'bag'; note?: string }
// removed = the moments of the units taken off this run on purpose (a cart recorded twice): kept on the row, so that no
// merge, on any device, brings one back (see updateRun, mergeRun)
/**
 * How Spiral counts a code: mezcla by mezcla (the usual, nothing kept), or each mezcla weighed in pounds or counted
 * in cases, as the office's SPIRAL sheets program some items ("3000 LB", "200 CS"). A run keeps the measure it was
 * started with; the products table says each code's usual one (spiralUnit).
 */
export type Measure = 'lb' | 'cajas'
export type SpiralUnit = 'mezclas' | Measure
export const SPIRAL_UNITS: SpiralUnit[] = ['mezclas', 'lb', 'cajas']
export const spiralUnitOfText = (t: unknown): SpiralUnit | undefined => { const u = String(t ?? '').trim().toUpperCase(); return !u ? undefined : /^(LB|LBS|LIBRA|LIBRAS|POUND|POUNDS)$/.test(u) ? 'lb' : /^(CAJA|CAJAS|CS|CJ|CASE|CASES)$/.test(u) ? 'cajas' : /^(MEZCLA|MEZCLAS|BATCH|BATCHES|MIX|MIXES)$/.test(u) ? 'mezclas' : undefined }
/** the words a bin can hold, offered as chips; any other can be typed (kept as typed, these in Spanish like all data) */
export const BIN_WORDS = ['platos', 'copas', 'pouches']
/** what MFO's bins hold: platos or copas, counted as typed, or pounds, each bin weighed; nothing is turned into cases */
export const MFO_WORDS = ['platos', 'copas', 'lb']
/** what an MFO line may fill, as chosen when a code starts: its bin words, and bags of pounds (2026-10-22) */
export const MFO_CHOICES = [...MFO_WORDS, 'bags']
/** the choice a run was started with */
export const mfoChoiceOf = (r: Pick<Run, 'dept' | 'extra'>) => (r.dept === 'MFO' && r.extra?.pack === 'bag' ? 'bags' : binOf(r))
/** the question a bin asks when it is done, with the word of what it holds in its place */
const binQ = (word: string) => (word === 'lb' ? tr('¿Cuántas libras lleva este bin?') : word === 'copas' ? tr('¿Cuántas copas lleva este bin?') : word === 'cajas' ? tr('¿Cuántas cajas lleva este bin?') : tr('¿Cuántos {0} lleva este bin?', binWord(word)))
const cleanPart = (x: unknown): PalletPart | null => {
  const p = (x ?? {}) as Partial<PalletPart>, lot = String(p.lot ?? '').trim(), qty = Number(p.qty)
  return lot && Number.isFinite(qty) && qty > 0 ? { lot, qty, tag: String(p.tag ?? '').trim().slice(0, 30), at: Number(p.at) || 0, by: String(p.by ?? '') } : null
}
/** the longest comment a record keeps (its box takes no more) */
export const NOTE_MAX = 300
/**
 * a comment as it is kept: on one line (a line break or a run of spaces is one space: it is shown in a row, a cell
 * of the Excel and a line of the history) and without spaces at its ends; never longer than NOTE_MAX
 */
export const cleanNote = (t: unknown) => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX) : '')
/** a run's comment, to show and to search ('' = none) */
export const noteOf = (r: Pick<Run, 'extra'>) => r.extra?.note ?? ''
/** the comment key of a unit being made: only when one was typed (a blank one leaves no key: see Unit) */
const noteKey = (note: string | undefined): Pick<Unit, 'note'> => { const said = cleanNote(note); return said ? { note: said } : {} }
/**
 * a unit with this comment on it (undefined = nothing said of it: as it was). Typed, it is kept cleaned; cleared on a
 * unit that had one, it stays as '' (see Unit); cleared on one that never had one, nothing is added
 */
const withUnitNote = (u: Unit, note: string | undefined): Unit => { if (note === undefined) return u; const said = cleanNote(note); return said === (u.note ?? '') ? u : { ...u, note: said } }
/** what arrives in a run's extra, kept only as far as it makes sense (undefined = nothing) */
export function cleanExtra(x: unknown): RunExtra | undefined {
  if (!x || typeof x !== 'object') return undefined
  const e = x as Record<string, unknown>, out: RunExtra = {}
  if (typeof e.bin === 'string' && e.bin.trim()) out.bin = e.bin.trim().slice(0, 30)
  if (typeof e.lotNow === 'string' && e.lotNow.trim()) out.lotNow = e.lotNow.trim().slice(0, 30)
  if (e.measure === 'lb' || e.measure === 'cajas') out.measure = e.measure
  if (e.pack === 'bag') out.pack = 'bag'
  if (Array.isArray(e.removed)) { const dead = [...new Set(e.removed.map(Number).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b); if (dead.length) out.removed = dead.slice(-500) }
  const o = e.open as { parts?: unknown; po?: unknown } | undefined
  if (o && typeof o === 'object') {
    const parts = Array.isArray(o.parts) ? o.parts.map(cleanPart).filter((p): p is PalletPart => !!p) : []
    if (parts.length || typeof o.po === 'string') out.open = { parts, ...(typeof o.po === 'string' ? { po: o.po } : {}) }
  }
  // the comment, also when it is '' (cleared on purpose: see RunExtra); always last, as withNote puts it, so the
  // same run read from the server and from this device is written the same
  if (typeof e.note === 'string') out.note = cleanNote(e.note)
  return Object.keys(out).length ? out : undefined
}
/** the extra with this comment in it (undefined = without the key, as a run that never had one) */
function withNote(extra: RunExtra | undefined, note: string | undefined): RunExtra | undefined {
  const { note: _was, ...rest } = extra ?? {}
  const out: RunExtra = note === undefined ? rest : { ...rest, note }
  return Object.keys(out).length ? out : undefined
}
/** the word for what a run's bins hold ('' = a Packing run that makes pallets, an MFO run of before that counted cases, another room) */
export const binOf = (r: Pick<Run, 'dept' | 'extra'>) => ((r.dept === 'Packing' || r.dept === 'MFO') && r.extra?.bin) || ''
/** the lot a run is packing now */
export const lotNowOf = (r: Pick<Run, 'lot' | 'extra'>) => r.extra?.lotNow || r.lot
/** the measure a Spiral run was started with ('' = mezcla by mezcla, or not Spiral) */
export const measureOf = (r: Pick<Run, 'dept' | 'extra'>): Measure | '' => (r.dept === 'Spiral' && r.extra?.measure) || ''
/**
 * The word of a run counted apart from its room's main count: what a Packing line's bins hold, the measure of a
 * Spiral line's mezclas, or what an MFO line's bins hold when it is not platos (copas, pounds, or the cases of a run
 * of before 2026-10-17). '' = counted as the room counts: pallets of cases, mezclas one by one, bins of platos
 */
export const apartOf = (r: Pick<Run, 'dept' | 'extra'>) => (r.dept === 'Packing' ? r.extra?.bin || '' : r.dept === 'MFO' ? ((w) => (w === 'platos' ? '' : w))(r.extra?.bin || 'cajas') : measureOf(r))
/** the word a run is counted under when it is not simply its room's: apart or not (MFO's platos are the room's, but they are said) */
export const kindOf = (r: Pick<Run, 'dept' | 'extra'>) => apartOf(r) || binOf(r)
/** a measure as a quantity's word ("lb", "cajas") and as a name ("libras", "cajas", "mezclas") */
export const measureUnit = (m: string) => (m === 'lb' ? tr('lb') : m === 'cajas' ? tr('cajas') : tr('mezclas'))
export const measureName = (m: string) => (m === 'lb' ? tr('libras') : m === 'cajas' ? tr('cajas') : tr('mezclas'))
/** what is apart, as the screen says it: "platos" / "lb" beside a number, and "en bins de platos" / "en libras" as a label */
export const apartWord = (dept: Dept, word: string) => (dept === 'Spiral' || word === 'lb' ? measureUnit(word) : binWord(word))
export const apartLabel = (dept: Dept, word: string) => (dept === 'Spiral' || word === 'lb' ? tr('en {0}', measureName(word)) : tr('en bins de {0}', binWord(word)))
/**
 * the colour each way of counting wears on the screen, as a class on the button that chooses it (and on a card's
 * mode): the room's usual (pallets, mezclas) in green, bins of platos in indigo, copas in rose, pounds in amber,
 * Spiral's cases in blue. Visible also when it is not the one chosen: with white faces the people did not notice
 * which side was on and put bins on the pallets side (Jose, 2026-10-17)
 */
export const kindClass = (dept: Dept, word: string) => (!word || word === 'mezclas' ? 'c-green' : word === 'lb' ? 'c-amber' : word === 'copas' ? 'c-rose' : dept === 'Spiral' && word === 'cajas' ? 'c-blue' : 'c-indigo')
/** the words of a room's runs counted apart under a word ('' = the room's own) */
export const cfgFor = (dept: Dept, word: string): DeptCfg => (word ? cfgOf({ dept, extra: dept === 'Spiral' ? { measure: word as Measure } : { bin: word } }) : CFG[dept])
/** a bin's word as the screen says it: the offered ones in the screen's language, a typed one as typed */
const BIN_SHOWN: Record<string, () => string> = { platos: () => tr('platos'), copas: () => tr('copas'), pouches: () => tr('pouches'), lb: () => tr('libras'), cajas: () => tr('cajas') }
// (only its own words: a word typed as "constructor" or "__proto__" found Object's and blanked the screen, audit 2026-10-17 H2)
export const binWord = (word: string) => (Object.prototype.hasOwnProperty.call(BIN_SHOWN, word) ? BIN_SHOWN[word]() : word)
/** a stop with its reason; lineId null = the whole department */
export type Stop = { id: string; dept: Dept; lineId: string | null; reason: string; note: string; startedAt: number; endedAt: number | null; by: string; updatedAt: number; deleted?: boolean; syncedAt?: number }
/**
 * The office's master table ("YIEL CALCULO" + cases per pallet + pouches per cart): with it, mezclas become expected
 * pouches, cases and pallets. The demo ships with made-up example products; the real ones are typed or imported.
 */
/** the room that packs a product after its mezclas: RTE fills pouches, MFO fills bins of cases (the office's sheets list each code under one of them) */
export type PackRoom = 'RTE' | 'MFO'
export const packRoomOfText = (t: unknown): PackRoom | undefined => { const u = String(t ?? '').toUpperCase(); return u.includes('MFO') ? 'MFO' : u.includes('RTE') ? 'RTE' : undefined }
export type Product = { code: string; name: string; pouchesPerCase: number; casesPerMix: number; cratesPerCart: number; pouchesPerCrate: number; casesPerPallet: number; room?: PackRoom; spiralUnit?: SpiralUnit; /** pounds per case (QA's sheet; migration 024) */ lbPerCase?: number; updatedAt: number; deleted?: boolean }
/** "12x10" in the office's RTE sheet: crates per cart × pouches per crate */
export const cartPouches = (p: Product) => p.cratesPerCart * p.pouchesPerCrate
/** mezclas scheduled per day and code ("SCHEDULE" in the office's AVANCE sheet) */
export type Schedule = Record<string, Record<string, number>>
/** one line of history: who changed what, when, from → to (corrections, the products table, the day's program, the lines) */
export type Change = { id: string; at: number; by: string; dept: Dept | null; what: string; before: string; after: string; refTable: string; refKey: string; updatedAt: number; deleted?: boolean }
/** the goal the manager set for a room: per hour and/or per shift, in the room's own quantity (pouches, cajas, mezclas) */
export type Target = { dept: Dept; perHour: number | null; perShift: number | null; updatedAt: number }
/**
 * the hours of the two shifts ("HH:MM"; the second may end after midnight). only = on a day of work with one shift,
 * which one (see shiftsOf): then every record of the day is that shift's, and the day has one hand-over, the night's
 */
export type ShiftHours = { first: string; firstEnd: string; second: string; secondEnd: string; only?: 1 | 2; cut2?: number }
/**
 * Each room hands over on its own (Jose, 2026-10-21: "RTE del primer turno se queda hasta las 3:30 pm pero los otros
 * departamentos se van y otro departamento del segundo turno empieza a trabajar a las 2:40 pm ... y eso tiene que
 * contar en el turno que se hizo"). The moment of a room's afternoon hand-over on a day, when the room said it: its
 * first shift tapped "Terminar turno" (how 'fin'), its second shift tapped "Empezar Turno 2" ('inicio'), or a manager
 * typed it ('manual'). Without one the room hands over when the plant does. cut2 on ShiftHours = that moment as a
 * minute of the day (shiftsOf with a room). Kept in act_changes (ref_table act_shiftcut, one row per room and day): the
 * people of the room write there, and the tablets of before this version leave it alone.
 */
export type ShiftMark = { date: string; dept: Dept; at: number; how: 'fin' | 'inicio' | 'manual'; by: string; deleted?: boolean; updatedAt: number }
function shiftMarkFrom(x: Partial<ShiftMark> | null | undefined): ShiftMark | null {
  if (!x || !isDay(String(x.date ?? '')) || !(DEPTS as unknown[]).includes(x.dept) || !(Number(x.at) > 0) || !['fin', 'inicio', 'manual'].includes(String(x.how))) return null
  return { date: String(x.date), dept: x.dept as Dept, at: Number(x.at), how: x.how as ShiftMark['how'], by: String(x.by ?? ''), ...(x.deleted ? { deleted: true } : {}), updatedAt: Number(x.updatedAt) || 0 }
}
/** those hours from a date on */
export type ShiftPlan = ShiftHours & { from: string; updatedAt: number }
/** which shifts work each day of the week, from a date on: seven digits Sunday to Saturday, 3 = both, 1 = only the first, 2 = only the second */
export type ShiftWeek = { from: string; week: string; updatedAt: number }
/** a day apart from its week: only one shift worked (1 or 2), or both (3) on a day whose week says one */
export type DayShifts = { date: string; only: 1 | 2 | 3; updatedAt: number }
/**
 * What an operator may do with the lines of their room, set by a manager in Ajustes (Jose, 2026-10-17, after Spiral's
 * lines were taken off at the end of every code): add = add a line (yes until said otherwise); remove = take a free
 * line off (no until said otherwise: a line is never "closed" by taking it off). Managers and the office always may.
 */
export type LineRules = { add: boolean; remove: boolean; updatedAt: number }
/**
 * the plant's Reason Codes (see reasons.ts): on = every stop takes one code of the list and only of it. A manager's
 * switch in Ajustes, for every device (Jose, 2026-10-20: "en ajuste yo pueda prender esta opción o apagarla"); off as
 * it starts, and off is everything as it always was
 */
export type ReasonCodesOpt = { on: boolean; updatedAt: number }
/** the goal of one line: so much per hour and/or in the whole day, in its room's quantity */
export type LineTarget = { lineId: string; perHour: number | null; perDay: number | null; updatedAt: number }
/**
 * The goal of one shift, of a room ("RTE@2") or of one line ("line:<id>@2"): each shift has its own, set by its
 * manager, and what counts against it is only what that shift makes. (Target and LineTarget above are the goals as
 * they were kept before, one for both shifts: only their pace per hour is still used, see shiftGoalOf.)
 */
export type TurnGoal = { key: string; perHour: number | null; total: number | null; updatedAt: number }
/**
 * The program of a room for a day: a code it has to make and how much of it, in the room's own quantity (mezclas,
 * pouches, cajas). The office types it, as it types the SCHEDULE of its AVANCE sheet and the #BATCH of each room's
 * sheet; every tablet of the room sees it, and what the room registers of that code is taken off it by itself.
 * A code set to 0 is off the program.
 * lot (Jose, 2026-10-19, from the floor: "cuando se vaya a hacer una programación para cualquier cuarto tenga una
 * opción también de poner el lote, que por defecto salga el lote del día, y que sea opcional"): which lot the code is
 * programmed for. The dialog offers the day's lot (lotFor) and the office may change it or leave it blank: '' = no
 * lot, a day's program as before. With a lot, "Flujo de datos" adds the program up per lot and says what is left.
 * (The only figure the app ever prefills that the person would otherwise type: office data, not a floor record.)
 * orderId (Jose and the office, 2026-10-19): the production order this day's program is a part of (see "the
 * production orders of each room"). Absent = a plain day's program, as every program typed before that day: nothing
 * old is turned into an order by itself (the office types its open orders once).
 */
/**
 * A row of a room's program: a day (date), a code and its lot, and how much. Since 2026-10-28 (the office, through
 * Jose: "que puedan programar también para días más adelante, y que se vaya descontando si es el mismo programa") a
 * row may run for several days: endDate = its last day (after date, at most PLAN_SPAN_MAX days later); then qty is
 * the total for all of them, and what the room makes of that code and lot on any of those days is taken off the same
 * row. Without endDate it is a day's program as before
 */
export type Plan = { date: string; dept: Dept; code: string; qty: number; lot: string; orderId?: string; endDate?: string
  /** the office's comment on the row (2026-10-28: "comentarios en programas de cada departamento en una columna"), act_plan.note (SQL 026) */
  note?: string; updatedAt: number }
export const PLAN_NOTE_MAX = 200
export const planNote = (x: unknown) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, PLAN_NOTE_MAX)
/** a lot as typed on a program: trimmed, at most this long (declared above load(): it is read there) */
export const PLAN_LOT_MAX = 30
// ---- the production orders: what load() needs of them is declared here (see "the production orders of each room") ----
/** the longest order number (WO#) kept */
export const WO_MAX = 30
/**
 * the units an order of each room is typed in: the room's own count (Kitchen and Spiral mezclas, RTE pouches, Packing
 * cases), and in Spiral and MFO also the words its codes are counted in (pounds or cases; copas or pounds)
 */
export const WO_UNITS: Record<Dept, string[]> = { Kitchen: ['mezclas'], Spiral: ['mezclas', 'lb', 'cajas'], RTE: ['pouches'], MFO: ['platos', 'copas', 'lb'], Packing: ['cajas'] }
/** the ref_table of an order's closed account in act_changes (see "the account of a finished order" below) */
export const WO_DONE_REF = 'act_work_orders:done'
/**
 * A production order (Jose and the office clerk, 2026-10-19): so much of one code for one room, in the room's unit,
 * from a day on. The office types it once; each day's program is a part of it (Plan.orderId), and what the room
 * registers of the code from its start day on is taken off it by the app. Never erased: closed by hand (closedAt,
 * closedBy) or marked deleted when it was typed by mistake (kept with its flag, gone from the screens).
 * code = the code as normCode writes it ("0889" and "889" are one); unit = the word it was typed in ('' from the server
 * = the room's own); createdAt = when it was typed, on the shared clock (two orders of one start day go in this order)
 */
export type WorkOrder = { id: string; dept: Dept; code: string; lot: string; wo: string; qty: number; unit: string; startDate: string; note: string; createdAt: number; createdBy: string; closedAt: number | null; closedBy: string; deleted?: boolean; updatedAt: number; syncedAt?: number }
/**
 * Attendance (Santiago, 2026-10-20: "que cada supervisor registre las personas ... y según la cantidad muestre" the
 * room's people expected, those who came and the % missing). A supervisor writes each person by name (or number) for
 * the room and shift; the count of those still there is the actual. A person who went to cover another room or went
 * home is taken out (gone), not erased: the % is worked out again and the list says when and why. A person written by
 * mistake is deleted. from = the room they came from (taken out of another room to cover this one).
 */
/**
 * Moving people (Jose, 2026-10-22: "que los supervisores de cuartos o departamentos puedan trasladar personal a otro
 * cuarto o líneas"): line = the line of the room the person works on ('' = the room, no line in particular); moves =
 * each change of line in the room (from, to, when, who). Sent to another room, the person leaves this room (gone, with
 * the line there) and shows up in that room by itself (attOf: "viene de"), without its supervisor writing them
 * (an operator writes only their own room's records): see attOf
 */
export type AttGone = { why: 'otro' | 'casa'; to: Dept | ''; at: number; by: string; line?: string }
export type AttMove = { from: string; to: string; at: number; by: string }
export type AttEntry = { id: string; date: string; dept: Dept; shift: 1 | 2; name: string; by: string; at: number; gone: AttGone | null; from: Dept | ''; line: string; moves: AttMove[]
  /** a temp (agency) worker (2026-10-22, the COO's Daily KPI: "who shows up ... especially TEMPS") */
  temp?: boolean; deleted?: boolean; updatedAt: number; syncedAt?: number
  /** the room's supervisor or leader on this shift, written as such (Jose, 2026-10-27: "que el líder o el supervisor se anote a sí mismo como supervisor") */
  sup?: boolean
  /** a person who came from another room and is not written here: shown from that room's record (never stored) */
  via?: string
  /**
   * the hour the person really came, as the supervisor wrote it (2026-10-29, the boss's input/output: the labor hours
   * are from when each one came, not from the shift's start). Never filled in by itself: none = the shift's start
   */
  came?: number }
/** the people a room expects on a shift (a fixed number the managers change: see ATT_DEFAULT) */
export type AttExpected = { dept: Dept; shift: 1 | 2; n: number; updatedAt: number }
function attFrom(x: Partial<AttEntry> | null | undefined): AttEntry | null {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id || !(DEPTS as unknown[]).includes(x.dept) || !isDay(String(x.date ?? '')) || (x.shift !== 1 && x.shift !== 2)) return null
  const name = String(x.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  if (!name) return null
  const g = x.gone && typeof x.gone === 'object' && (x.gone.why === 'otro' || x.gone.why === 'casa') ? { why: x.gone.why, to: (DEPTS as unknown[]).includes(x.gone.to) ? (x.gone.to as Dept) : ('' as const), at: Number(x.gone.at) || 0, by: String(x.gone.by ?? ''), ...(typeof x.gone.line === 'string' && x.gone.line ? { line: x.gone.line.slice(0, 64) } : {}) } : null
  const moves = Array.isArray(x.moves) ? x.moves.filter((m) => m && typeof m === 'object').map((m) => ({ from: String(m.from ?? '').slice(0, 64), to: String(m.to ?? '').slice(0, 64), at: Number(m.at) || 0, by: String(m.by ?? '') })).slice(-50) : []
  return { id: x.id, date: String(x.date), dept: x.dept as Dept, shift: x.shift, name, by: String(x.by ?? ''), at: Number(x.at) || 0, gone: g, from: (DEPTS as unknown[]).includes(x.from) ? (x.from as Dept) : '', line: typeof x.line === 'string' ? x.line.slice(0, 64) : '', moves, ...(x.temp === true ? { temp: true } : {}), ...(x.sup === true ? { sup: true } : {}), ...(Number(x.came) > 0 ? { came: Number(x.came) } : {}), ...(x.deleted ? { deleted: true } : {}), updatedAt: Number(x.updatedAt) || 0, ...(Number(x.syncedAt) > 0 ? { syncedAt: Number(x.syncedAt) } : {}) }
}
function attExpectedFrom(x: Partial<AttExpected> | null | undefined): AttExpected | null {
  if (!x || !(DEPTS as unknown[]).includes(x.dept) || (x.shift !== 1 && x.shift !== 2) || !(Number(x.n) >= 0)) return null
  return { dept: x.dept as Dept, shift: x.shift, n: Math.round(Number(x.n)), updatedAt: Number(x.updatedAt) || 0 }
}
/** one unit (a mezcla, a cart, a bin, a pallet) as it counted for an order: k = its place in its run (1, 2…), day = its run's work day */
export type OrderUnitRef = { runId: string; k: number; at: number; day: string; shift: 1 | 2; n: number; by: string; line: string }
/**
 * One day of an order, as the office does the sum (Jose, 2026-10-19): what was programmed of it that day, what each
 * shift made for it, what the day left pending (it goes back to the order), all made so far, what is still available
 * of the order after that day, and what of it was not yet programmed. programmed = every row of that day's program
 * that names the order, added up, and lot = their lots ("6290, 6292": a code may have a row per lot, 2026-10-20).
 */
export type OrderDay = { date: string; programmed: number; lot: string; made1: number; made2: number; made: number; pending: number; cumMade: number; disponible: number; sinProgramar: number; closed?: boolean }
/**
 * The closed account of a finished order (see "the account of a finished order"): its numbers frozen, so a device that
 * lets go of the days it was made in keeps saying the same. sig = a fingerprint of the orders of its queue as they were
 * when it was closed (any change to them voids it, see sealSig); upto = the last day its group of orders finished.
 * Its day by day is not kept (review of 2026-10-19: every account of a code carried it, on every device and in every
 * mark): the order's window brings it from the server's records (loadOrderRows) when it is opened.
 */
export type OrderSeal = { id: string; sig: string; upto: string; made: number; finishAt: number; finishDay: string; completed: OrderUnitRef | null; lots: string[]; updatedAt: number }
// (function declarations: load() uses them while this file is still being read, see the note at `let state = load()`)
/** a real UUID, as the server's columns take it */
function isUuid(x: unknown): x is string { return typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x) }
/** an order as it is kept on the device, whatever was saved (null = not one: no id, room, code, quantity or start day) */
function workOrderFrom(x: Partial<WorkOrder> | null | undefined): WorkOrder | null {
  if (!x || typeof x !== 'object' || !isUuid(x.id) || !(DEPTS as unknown[]).includes(x.dept) || !isDay(String(x.startDate ?? ''))) return null
  const code = normCode(String(x.code ?? '')), qty = Number(x.qty), closedAt = Number(x.closedAt)
  if (!code || !Number.isFinite(qty)) return null
  return { id: x.id, dept: x.dept as Dept, code, lot: String(x.lot ?? '').trim().slice(0, PLAN_LOT_MAX), wo: String(x.wo ?? '').trim().slice(0, WO_MAX), qty, unit: String(x.unit ?? ''), startDate: String(x.startDate), note: cleanNote(x.note), createdAt: Number(x.createdAt) || 0, createdBy: String(x.createdBy ?? ''), closedAt: x.closedAt != null && Number.isFinite(closedAt) && closedAt > 0 ? closedAt : null, closedBy: String(x.closedBy ?? ''), ...(x.deleted ? { deleted: true } : {}), updatedAt: Number(x.updatedAt) || 0, ...(Number(x.syncedAt) > 0 ? { syncedAt: Number(x.syncedAt) } : {}) }
}
/** a number as kept in an account (0 for anything that is not one) */
function numIn(x: unknown) { const n = Number(x); return Number.isFinite(n) ? n : 0 }
/** a closed account as it is kept, from the device or from its mark on the server (null = not one) */
function sealFrom(x: unknown): OrderSeal | null {
  if (!x || typeof x !== 'object') return null
  const e = x as Record<string, unknown>, made = Number(e.made)
  if (typeof e.id !== 'string' || !e.id || typeof e.sig !== 'string' || !Number.isFinite(made)) return null
  const c = e.completed as Record<string, unknown> | null | undefined
  const completed: OrderUnitRef | null = c && typeof c === 'object' && typeof c.runId === 'string' ? { runId: c.runId, k: numIn(c.k), at: numIn(c.at), day: String(c.day ?? ''), shift: Number(c.shift) === 2 ? 2 : 1, n: numIn(c.n), by: String(c.by ?? ''), line: String(c.line ?? '') } : null
  // (a day by day an account may still carry is not read: see OrderSeal)
  return { id: e.id, sig: e.sig, upto: String(e.upto ?? ''), made, finishAt: numIn(e.finishAt), finishDay: String(e.finishDay ?? ''), completed, lots: Array.isArray(e.lots) ? e.lots.map(String).slice(0, 30) : [], updatedAt: numIn(e.updatedAt) }
}
export type State = { lines: Line[]; runs: Run[]; stops: Stop[]; products: Product[]; schedule: Schedule; changes: Change[]; targets: Target[]; shifts: ShiftPlan[]; shiftWeeks: ShiftWeek[]; dayShifts: DayShifts[]; lineRules: LineRules; reasonCodes: ReasonCodesOpt; programView: ReasonCodesOpt; attView: ReasonCodesOpt; attGate: ReasonCodesOpt; cartCrates: { n: number; updatedAt: number }; lunch: Lunch; attWrite: ReasonCodesOpt; lbCase: ReasonCodesOpt; viewOpts: Record<ViewOpt, ReasonCodesOpt>; lineTargets: LineTarget[]; orders: Order[]; turnGoals: TurnGoal[]; plans: Plan[]
  /**
   * runs the device no longer keeps (older than its days) that hold pallets given to an order still open: an order's
   * "Hechas" counts every pallet it ever got, not only the days this device holds. They come from the server (see
   * sync's bringOrderRuns) or stay behind when a day is pruned, and go when their order closes. Since 2026-10-19 also
   * the runs of a code a production order still counts (see workNeeds): its "Disponible" adds up every day since it
   * started, also the ones older than the device's 14 days.
   */
  orderRuns: Run[]
  /** the production orders of every room (deleted ones kept with their flag), and the closed accounts of finished ones */
  workOrders: WorkOrder[]; orderSeals: OrderSeal[]; attendance: AttEntry[]; attExpected: AttExpected[]; shiftMarks: ShiftMark[]; kpi: KpiRec[]; weights: WeightTest[]; orderNotes: OrderNote[]; roomMsgs: RoomMsg[]; chat: ChatMsg[]; chatSeen: ChatSeen[]; weightRules: WeightRule[]; slowRules: SlowRule[]; slowLines: SlowLine[]; meats: MeatEntry[]; holds: HoldRec[]; consumes: ConsumeEntry[]; consumeOpts: ConsumeOpt[] }
/**
 * An order to fill in Packing: so many cases of one product for a customer, to ship by a date. Most carry the
 * customer's purchase order number (PO); some never do and some get it later. See "the orders Packing fills".
 */
export type Order = { id: string; customer: string; po: string; code: string; cases: number | null; shipBy: string; dest: string; closed: boolean; createdAt: number; by: string; updatedAt: number
  /** marked urgent by the office (2026-10-22: "ponerlo como urgente para que Packing pueda darle prioridad"): first in every list, and proposed first */
  urgent?: boolean }
/** an order as it is kept, whatever arrives (null = not one: it has no product code) */
function orderOf(id: string, x: Partial<Order> | null | undefined, by: string, updatedAt: number): Order | null {
  if (!id || !x || typeof x !== 'object') return null
  const code = String(x.code ?? '').trim().toUpperCase(), cases = Number(x.cases), ship = String(x.shipBy ?? '')
  if (!code) return null
  return { id, customer: String(x.customer ?? '').trim(), po: String(x.po ?? '').trim(), code, cases: x.cases != null && Number.isFinite(cases) && cases > 0 ? cases : null, shipBy: /^\d{4}-\d{2}-\d{2}$/.test(ship) ? ship : '', dest: String(x.dest ?? '').trim(), closed: !!x.closed, createdAt: Number(x.createdAt) || 0, by, updatedAt, ...(x.urgent === true ? { urgent: true } : {}) }
}
/** the hours the plant works while nobody has set others (see "the shifts" below; these few lines sit here because load() needs them) */
export const SHIFTS_DEFAULT: ShiftHours = { first: '06:00', firstEnd: '15:00', second: '15:30', secondEnd: '01:00' }
const hmOk = (t: unknown): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)
const mins = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
const DAY_MIN = 1440
/** minutes from one time of the clock forward to another */
const ahead = (from: number, to: number) => (((to - from) % DAY_MIN) + DAY_MIN) % DAY_MIN
/** '' when the hours make sense: going round the clock, the first shift starts and ends, then the second starts and ends, before the first starts again */
export function shiftsProblem(h: ShiftHours): string {
  if (![h.first, h.firstEnd, h.second, h.secondEnd].every(hmOk)) return tr('Falta una hora.')
  const a = mins(h.first), end1 = ahead(a, mins(h.firstEnd)), start2 = ahead(a, mins(h.second)), end2 = ahead(a, mins(h.secondEnd)) || DAY_MIN
  return end1 > 0 && end1 <= start2 && start2 < end2 ? '' : tr('Las horas tienen que ir en orden: el turno 1 empieza y termina, después el turno 2 empieza y termina, antes de que vuelva a empezar el turno 1.')
}

/** a cart has two columns of 12 crates (the office counts columns: "12x10" = 12 crates × 10 pouches) */
/** an RTE cart when the product does not say: two columns of 13 crates (Jose, 2026-10-28: "los dos turnos usan dos columnas de 13") */
export const CRATES_PER_CART = 26
/** how an RTE cart of this run is counted: its crates and the pouches each holds (the product's; the pouches from the run's own figure when the product has none); null when nothing is known */
export function cartSpecOf(s: State, r: Run): { crates: number; ppc: number } | null {
  const p = productOf(s, r.code)
  const crates = p?.cratesPerCart || cartCratesOf(s)
  const ppc = p?.pouchesPerCrate || (r.perUnit && r.perUnit % crates === 0 ? r.perUnit / crates : 0)
  return ppc > 0 && Number.isInteger(ppc) ? { crates, ppc } : null
}
/**
 * The pouches of an RTE cart from how it is seen (Jose, 2026-10-28: "una columna de 7 y otra de 3, pero esa 3 solo
 * tiene 3 pouches ... la app debe calcularlo, no ellas con la calculadora"): the crates in each column, counting the
 * last one even if it is not full, and the pouches in that last one (null = full). Null when it makes no sense
 */
export function cartPouchesOf(c1: number, c2: number, last: number | null, ppc: number): { crates: number; full: number; last: number; total: number } | null {
  if (![c1, c2, ppc].every((n) => Number.isInteger(n) && n >= 0) || ppc <= 0) return null
  const crates = c1 + c2
  if (crates <= 0) return null
  if (last != null && (!Number.isInteger(last) || last < 0 || last > ppc)) return null
  const short = last != null && last < ppc
  const full = short ? crates - 1 : crates, rest = short ? last : 0
  return { crates, full, last: rest, total: full * ppc + rest }
}
/** how long a device keeps the history (the server keeps all of it) */
const KEEP_CHANGES_MS = 120 * 86_400_000
const SAMPLE_PRODUCTS: Product[] = [
  { code: 'A100', name: 'Meatballs 2.4 oz · pouch 48 oz', pouchesPerCase: 8, casesPerMix: 18, cratesPerCart: 24, pouchesPerCrate: 10, casesPerPallet: 36, updatedAt: 0 },
  { code: 'B200', name: 'Stuffed peppers · pouch 60 oz', pouchesPerCase: 8, casesPerMix: 6, cratesPerCart: 24, pouchesPerCrate: 6, casesPerPallet: 40, updatedAt: 0 },
  { code: 'C300', name: 'Turkey meatballs 1.1 oz · pouch 16 oz', pouchesPerCase: 6, casesPerMix: 70, cratesPerCart: 24, pouchesPerCrate: 20, casesPerPallet: 105, updatedAt: 0 },
  { code: 'D400', name: 'Meatballs 2.4 oz · pouch 4.5 lb', pouchesPerCase: 2, casesPerMix: 50, cratesPerCart: 24, pouchesPerCrate: 6, casesPerPallet: 105, updatedAt: 0 },
  { code: 'E500', name: 'Rice · pouch 60 oz', pouchesPerCase: 5, casesPerMix: 20, cratesPerCart: 24, pouchesPerCrate: 6, casesPerPallet: 105, updatedAt: 0 },
]

const KEY = 'act_v1'
/**
 * A new id for a line, a run, a stop or a history row: always a real UUID (version 4), because the server's columns
 * are of that type. A browser without crypto.randomUUID (Chrome before 92, iOS before 15.4, or the app opened over
 * plain http) used to get a short random text instead: the server refused every row with it (22P02) and nothing that
 * tablet recorded ever went up (audit 2026-10-17, H5). getRandomValues is in every browser and needs no https.
 * (A function declaration: load() and fresh() use it, see the note at `let state = load()`)
 */
export function uid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 15) | 64 // version 4
  b[8] = (b[8] & 63) | 128 // the RFC 4122 variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20)
}
const pad = (n: number) => String(n).padStart(2, '0')
export const dayOf = (ms: number) => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) }
export const today = () => dayOf(clockNow())
// ---- the codes that go in a customer's order (PO), and their shelf life (2026-10-29) ----
/**
 * Jose, 2026-10-29 ("me comentan que solo estos códigos o productos se pueden ingresar en pedidos, lo demás en
 * programa"): the products a PO may be written for, each with its shelf life in days ("vigencia"), from which each lot's
 * expiry is shown. A manager or the office changes the list in Ajustes › Productos (key 'order-codes' of the report's
 * records); an empty list = any code, as before
 */
export const ORDER_CODES_DEFAULT: Record<string, number> = { '4911': 45, '4914': 45, '4928': 45, '4983': 45, '0685': 45, '1999': 45, '2010': 45, '3293': 45, '8660': 45, '0889': 50, '5000': 45, '4676': 45, '4614': 45, '5017': 45 }
export type OrderCode = { code: string; days: number }
export function orderCodesList(s: State): OrderCode[] {
  const d = kpiGet(s, 'order-codes')?.data
  if (d && Array.isArray(d.codes)) return d.codes.flatMap((x) => { const o = x as { code?: unknown; days?: unknown }, code = String(o?.code ?? '').trim().toUpperCase(), days = Math.round(Number(o?.days)); return code ? [{ code, days: days > 0 ? days : 0 }] : [] })
  return Object.entries(ORDER_CODES_DEFAULT).map(([code, days]) => ({ code, days }))
}
export const orderCodeOf = (s: State, code: string) => orderCodesList(s).find((x) => normCode(x.code) === normCode(code)) ?? null
/** whether a PO may be written for a code (any code when the list is empty) */
export const orderCodeOk = (s: State, code: string) => { const l = orderCodesList(s); return !l.length || l.some((x) => normCode(x.code) === normCode(code)) }
export const setOrderCodes = (rows: OrderCode[]) => { const seen = new Set<string>(); kpiPut('order-codes', { codes: rows.map((x) => ({ code: x.code.trim().toUpperCase(), days: Math.max(0, Math.round(x.days)) })).filter((x) => x.code && !seen.has(normCode(x.code)) && !!seen.add(normCode(x.code))) }) }
/**
 * a lot's day (YYYY-MM-DD): the plant's lot is the Julian date (6302 = the 302nd day of a year ending in 6), its year the
 * one ending in that digit nearest to the day it was made; '' = not a lot of that form (a "6168-6216", a word…)
 */
export function lotDay(lot: string, near: string): string {
  const m = /^(\d)(\d{3})$/.exec(lot.trim()), ny = Number(near.slice(0, 4))
  if (!m || !ny) return ''
  const y = [ny - 1, ny, ny + 1, ny - 2, ny + 2, ny - 3, ny + 3, ny - 4, ny + 4, ny - 5].find((x) => x % 10 === Number(m[1])) as number, day = Number(m[2])
  const len = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365
  if (day < 1 || day > len) return ''
  return new Date(Date.UTC(y, 0, day)).toISOString().slice(0, 10)
}
/** the day a lot of a code expires: its day + the code's shelf life; '' = no shelf life for the code, or no day for the lot */
export function expiryOf(s: State, code: string, lot: string, near: string): string {
  const c = orderCodeOf(s, code), d = lotDay(lot, near)
  if (!c?.days || !d) return ''
  const [y, mo, dd] = d.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, dd + c.days)).toISOString().slice(0, 10)
}
/** the plant's lot number is the Julian date: last digit of the year + day of the year (10/07/2026 → 6280) */
export function lotFor(ds: string) {
  const [y, m, d] = ds.split('-').map(Number)
  if (!y || !m || !d) return ''
  const day = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1
  return String(y % 10) + String(day).padStart(3, '0')
}
/** the office writes a code without its leading zero, the ticket and the boxes with it: a numeric code is the same either way */
export const normCode = (c: string) => { const u = c.trim().toUpperCase(); return /^\d+$/.test(u) ? String(Number(u)) : u }
/**
 * one entry per code and day in the program: "0100" and "100" are the same product. (Earlier versions kept what was
 * typed next to what came back from the server, and the two were added up.) The spelling as typed is the newer one
 * when it carries a number; otherwise the plain spelling stands.
 */
function tidySchedule(sch: Schedule): Schedule {
  const out: Schedule = {}
  for (const [date, codes] of Object.entries(sch)) {
    const day: Record<string, number> = {}
    for (const [c, n] of Object.entries(codes)) if (normCode(c) === c) day[c] = n
    for (const [c, n] of Object.entries(codes)) if (normCode(c) !== c && (n || !(normCode(c) in day))) day[normCode(c)] = n
    out[date] = day
  }
  return out
}

function isDay(text: string) { return /^\d{4}-\d{2}-\d{2}$/.test(text) }
/** with a server the lines (and products) are shared and come from it; without one, each device starts with a line per room */
const SERVER = !!import.meta.env.VITE_SUPABASE_URL
function fresh(): State { return { lines: SERVER ? [] : DEPTS.map((d) => ({ id: uid(), dept: d, name: lineWordKept(d) + ' 1', updatedAt: 0 })), runs: [], orderRuns: [], stops: [], products: SERVER ? [] : SAMPLE_PRODUCTS, schedule: {}, changes: [], targets: [], shifts: [], shiftWeeks: [], dayShifts: [], lineRules: { add: true, remove: false, updatedAt: 0 }, reasonCodes: { on: false, updatedAt: 0 }, programView: { on: false, updatedAt: 0 }, attView: { on: false, updatedAt: 0 }, attGate: { on: false, updatedAt: 0 }, cartCrates: { n: 0, updatedAt: 0 }, lunch: { min: 0, after: 0, updatedAt: 0 }, attWrite: { on: false, updatedAt: 0 }, lbCase: { on: false, updatedAt: 0 }, viewOpts: { lotes: { on: false, updatedAt: 0 }, flujo: { on: false, updatedAt: 0 } }, lineTargets: [], orders: [], turnGoals: [], plans: [], workOrders: [], orderSeals: [], attendance: [], attExpected: [], shiftMarks: [], kpi: [], weights: [], orderNotes: [], roomMsgs: [], chat: [], chatSeen: [], weightRules: [], slowRules: [], slowLines: [], meats: [], holds: [], consumes: [], consumeOpts: [] } }
function load(): State {
  try {
    type Raw = { lines: Partial<Line>[]; stops: Partial<Stop>[]; runs: (Partial<Run> & { units?: Partial<Unit>[]; carts?: number[] })[]; orderRuns?: (Partial<Run> & { units?: Partial<Unit>[]; carts?: number[] })[]; products?: (Partial<Product> & { pouchesPerCart?: number })[]; schedule?: Schedule; changes?: Partial<Change>[]; targets?: Partial<Target>[]; shifts?: Partial<ShiftPlan>[]; shiftWeeks?: Partial<ShiftWeek>[]; dayShifts?: Partial<DayShifts>[]; lineRules?: Partial<LineRules>; reasonCodes?: Partial<ReasonCodesOpt>; programView?: Partial<ReasonCodesOpt>; attView?: Partial<ReasonCodesOpt>; attGate?: Partial<ReasonCodesOpt>; cartCrates?: { n?: number; updatedAt?: number }; lunch?: Partial<Lunch>; attWrite?: Partial<ReasonCodesOpt>; lbCase?: Partial<ReasonCodesOpt>; viewOpts?: Partial<Record<ViewOpt, Partial<ReasonCodesOpt>>>; lineTargets?: Partial<LineTarget>[]; orders?: Partial<Order>[]; turnGoals?: Partial<TurnGoal>[]; plans?: Partial<Plan>[]; workOrders?: Partial<WorkOrder>[]; orderSeals?: unknown[]; attendance?: Partial<AttEntry>[]; attExpected?: Partial<AttExpected>[]; shiftMarks?: Partial<ShiftMark>[]; kpi?: Partial<KpiRec>[]; weights?: Partial<WeightTest>[]; orderNotes?: Partial<OrderNote>[]; roomMsgs?: Partial<RoomMsg>[]; chat?: Partial<ChatMsg>[]; chatSeen?: Partial<ChatSeen>[]; weightRules?: Partial<WeightRule>[]; slowRules?: Partial<SlowRule>[]; slowLines?: Partial<SlowLine>[]; meats?: Partial<MeatEntry>[]; holds?: Partial<HoldRec>[]; consumes?: Partial<ConsumeEntry>[]; consumeOpts?: Partial<ConsumeOpt>[] }
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as Raw | null
    // rows saved by earlier versions: carts as plain timestamps, units without a tag or a name, products with one
    // pouches-per-cart number, nothing with an update time
    if (s && s.lines && s.runs && s.stops) {
      const units = (r: Raw['runs'][number]): Unit[] => (r.units ? r.units.map(unitOf) : (r.carts ?? []).map((at) => ({ at, qty: null, ref: '', by: '' })))
      const sample = (code: string) => SAMPLE_PRODUCTS.some((x) => x.code === code)
      const products: Product[] = s.products ? s.products.map((p) => ({ code: p.code ?? '', name: p.name ?? '', pouchesPerCase: p.pouchesPerCase ?? 0, casesPerMix: p.casesPerMix ?? 0, cratesPerCart: (p.cratesPerCart ?? (p.pouchesPerCart ? 12 : 0)) === 12 && sample(p.code ?? '') ? CRATES_PER_CART : p.cratesPerCart ?? (p.pouchesPerCart ? 12 : 0), pouchesPerCrate: p.pouchesPerCrate ?? (p.pouchesPerCart ? Math.round(p.pouchesPerCart / 12) : 0), casesPerPallet: p.casesPerPallet ?? 0, ...((r) => (r ? { room: r } : {}))(packRoomOfText(p.room)), ...((u) => (u ? { spiralUnit: u } : {}))(spiralUnitOfText(p.spiralUnit)), ...(Number(p.lbPerCase) > 0 ? { lbPerCase: Number(p.lbPerCase) } : {}), updatedAt: p.updatedAt ?? 0 })) : SAMPLE_PRODUCTS
      // A line, run or stop keeps the server's stamp of the version it holds (syncedAt): it is what tells a late echo
      // of an older version from news (see reconcile). Lost on every reload until 2026-10-17 (audit S8): after one,
      // a page of a pull that came late could open again a code just ended. (Written inline: nothing declared below
      // `let state = load()` may be used in here)
      // A row of a room this version does not know (one a newer version added, such as QC) is not kept: every screen
      // looks its room up, and the Reporte went blank on it (audit 2026-10-17). It stays on the server, and a version
      // that knows the room brings it. (Written inline, as above)
      const known = (x: { dept?: unknown }) => x.dept == null || (DEPTS as unknown[]).includes(x.dept)
      const runFrom = (r: Raw['runs'][number]): Run => ({ id: r.id ?? uid(), dept: (r.dept ?? 'Kitchen') as Dept, lineId: r.lineId ?? '', line: r.line ?? '', code: r.code ?? '', lot: r.lot ?? '', date: r.date ?? today(), startedAt: r.startedAt ?? 0, endedAt: r.endedAt ?? null, units: units(r), perUnit: r.perUnit ?? null, waste: r.waste ?? 0, by: r.by ?? '', updatedAt: r.updatedAt ?? 0, ...((e) => (e ? { extra: e } : {}))(cleanExtra(r.extra)), ...(Number(r.syncedAt) > 0 ? { syncedAt: Number(r.syncedAt) } : {}) })
      return {
        lines: s.lines.filter(known).map((l) => ({ id: l.id ?? uid(), dept: (l.dept ?? 'Kitchen') as Dept, name: l.name ?? 'Línea 1', updatedAt: l.updatedAt ?? 0, ...(Number(l.syncedAt) > 0 ? { syncedAt: Number(l.syncedAt) } : {}) })),
        stops: s.stops.filter(known).map((x) => ({ id: x.id ?? uid(), dept: (x.dept ?? 'Kitchen') as Dept, lineId: x.lineId ?? null, reason: x.reason ?? '', note: x.note ?? '', startedAt: x.startedAt ?? 0, endedAt: x.endedAt ?? null, by: x.by ?? '', updatedAt: x.updatedAt ?? 0, ...(Number(x.syncedAt) > 0 ? { syncedAt: Number(x.syncedAt) } : {}) })),
        runs: s.runs.filter(known).map(runFrom),
        orderRuns: (s.orderRuns ?? []).filter(known).map(runFrom),
        products, schedule: tidySchedule(s.schedule ?? {}),
        changes: (s.changes ?? []).filter((c) => (c.at ?? 0) > clockNow() - KEEP_CHANGES_MS).map((c) => ({ id: c.id ?? uid(), at: c.at ?? 0, by: c.by ?? '', dept: (c.dept ?? null) as Dept | null, what: c.what ?? '', before: c.before ?? '', after: c.after ?? '', refTable: c.refTable ?? '', refKey: c.refKey ?? '', updatedAt: c.updatedAt ?? 0 })),
        targets: (s.targets ?? []).filter((t) => DEPTS.includes(t.dept as Dept)).map((t) => ({ dept: t.dept as Dept, perHour: t.perHour ?? null, perShift: t.perShift ?? null, updatedAt: t.updatedAt ?? 0 })),
        shifts: (s.shifts ?? []).filter((x): x is ShiftPlan => !!x && /^\d{4}-\d{2}-\d{2}$/.test(x.from ?? '') && !shiftsProblem(x as ShiftHours)).map((x) => ({ from: x.from, first: x.first, firstEnd: x.firstEnd, second: x.second, secondEnd: x.secondEnd, updatedAt: x.updatedAt ?? 0 })),
        shiftWeeks: (s.shiftWeeks ?? []).filter((x): x is ShiftWeek => !!x && isDay(String(x.from ?? '')) && weekOk(x.week)).map((x) => ({ from: x.from, week: x.week, updatedAt: x.updatedAt ?? 0 })),
        dayShifts: (s.dayShifts ?? []).filter((x): x is DayShifts => !!x && isDay(String(x.date ?? '')) && [1, 2, 3].includes(Number(x.only))).map((x) => ({ date: x.date, only: Number(x.only) as 1 | 2 | 3, updatedAt: x.updatedAt ?? 0 })),
        lineRules: { add: s.lineRules?.add !== false, remove: s.lineRules?.remove === true, updatedAt: Number(s.lineRules?.updatedAt) || 0 },
        // the Reason Codes switch (2026-10-20): a copy saved before it reads off, as the plant starts. (Written inline, as
        // above: nothing declared below `let state = load()` may be used in here)
        reasonCodes: { on: s.reasonCodes?.on === true, updatedAt: Number(s.reasonCodes?.updatedAt) || 0 },
        programView: { on: s.programView?.on === true, updatedAt: Number(s.programView?.updatedAt) || 0 },
        attView: { on: s.attView?.on === true, updatedAt: Number(s.attView?.updatedAt) || 0 },
        attGate: { on: s.attGate?.on === true, updatedAt: Number(s.attGate?.updatedAt) || 0 },
        cartCrates: { n: Number(s.cartCrates?.n) || 0, updatedAt: Number(s.cartCrates?.updatedAt) || 0 },
        lunch: { min: Math.max(0, Number(s.lunch?.min) || 0), after: Math.max(0, Number(s.lunch?.after) || 0), updatedAt: Number(s.lunch?.updatedAt) || 0 },
        lbCase: { on: s.lbCase?.on === true, updatedAt: Number(s.lbCase?.updatedAt) || 0 },
        attWrite: { on: s.attWrite?.on === true, updatedAt: Number(s.attWrite?.updatedAt) || 0 },
        // the tabs a switch turns on for everybody (2026-10-22: Lotes, and Flujo kept off): inline, as above
        viewOpts: { lotes: { on: s.viewOpts?.lotes?.on === true, updatedAt: Number(s.viewOpts?.lotes?.updatedAt) || 0 }, flujo: { on: s.viewOpts?.flujo?.on === true, updatedAt: Number(s.viewOpts?.flujo?.updatedAt) || 0 } },
        lineTargets: (s.lineTargets ?? []).filter((t) => !!t && !!t.lineId && !isTurnKey(String(t.lineId))).map((t) => ({ lineId: String(t.lineId), perHour: t.perHour ?? null, perDay: t.perDay ?? null, updatedAt: t.updatedAt ?? 0 })),
        orders: (s.orders ?? []).map((o) => (o ? orderOf(String(o.id ?? ''), o, String(o.by ?? ''), o.updatedAt ?? 0) : null)).filter((o): o is Order => !!o),
        // (lot since 2026-10-19: a program saved before it reads ''. Written inline, as above: nothing below load())
        // (orderId since 2026-10-19: kept only when it is a real id; a program saved before it is a plain day's program)
        plans: (s.plans ?? []).filter((p) => !!p && isDay(String(p.date ?? '')) && DEPTS.includes(p.dept as Dept) && !!normCode(String(p.code ?? ''))).map((p) => ({ date: String(p.date), dept: p.dept as Dept, code: String(p.code).trim().toUpperCase(), qty: Number(p.qty) > 0 ? Number(p.qty) : 0, lot: String(p.lot ?? '').trim().slice(0, PLAN_LOT_MAX), ...(isUuid(p.orderId) ? { orderId: p.orderId } : {}), ...(isDay(String(p.endDate ?? '')) && String(p.endDate) > String(p.date) ? { endDate: String(p.endDate) } : {}), ...(planNote(p.note) ? { note: planNote(p.note) } : {}), updatedAt: p.updatedAt ?? 0 })),
        // the production orders and their closed accounts (2026-10-19). Read with function declarations only (see the
        // note at `let state = load()`): a stored field nothing reads back is a field lost on every reload
        workOrders: (s.workOrders ?? []).map(workOrderFrom).filter((o): o is WorkOrder => !!o),
        orderSeals: (s.orderSeals ?? []).map(sealFrom).filter((x): x is OrderSeal => !!x),
        // attendance (2026-10-20): read with function declarations only, as the orders
        attendance: (s.attendance ?? []).map(attFrom).filter((x): x is AttEntry => !!x),
        // the Daily KPI Report's records (2026-10-22): read with a function declaration (see the TDZ rule above)
        kpi: (s.kpi ?? []).map(kpiFrom).filter((x): x is KpiRec => !!x),
        weights: (s.weights ?? []).map(wtFrom).filter((x): x is WeightTest => !!x),
        orderNotes: (s.orderNotes ?? []).map(orderNoteFrom).filter((x): x is OrderNote => !!x),
        roomMsgs: (s.roomMsgs ?? []).map(roomMsgFrom).filter((x): x is RoomMsg => !!x),
        chat: (s.chat ?? []).map(chatFrom).filter((x): x is ChatMsg => !!x),
        chatSeen: (s.chatSeen ?? []).map(chatSeenFrom).filter((x): x is ChatSeen => !!x),
        // (inline, as above: nothing declared below load() may be used in here)
        meats: (s.meats ?? []).map(meatFrom).filter((x): x is MeatEntry => !!x),
        holds: (s.holds ?? []).map(holdFrom).filter((x): x is HoldRec => !!x),
        consumes: (s.consumes ?? []).map(consumeFrom).filter((x): x is ConsumeEntry => !!x),
        consumeOpts: (s.consumeOpts ?? []).filter((x) => !!x && DEPTS.includes(x.dept as Dept)).map((x) => ({ dept: x.dept as Dept, on: x.on === true, updatedAt: Number(x.updatedAt) || 0 })),
        weightRules: (s.weightRules ?? []).filter((x) => !!x && DEPTS.includes(x.dept as Dept) && Number(x.every) >= 0 && Number(x.count) >= 0).map((x) => ({ dept: x.dept as Dept, every: Math.round(Number(x.every)), count: Math.round(Number(x.count)), updatedAt: Number(x.updatedAt) || 0 })),
        // the slow-line signal (2026-10-28): the room's minimum per hour, and the lines it is turned off for
        slowRules: (s.slowRules ?? []).filter((x) => !!x && DEPTS.includes(x.dept as Dept) && Number(x.perHour) >= 0).map((x) => ({ dept: x.dept as Dept, perHour: Math.round(Number(x.perHour)), updatedAt: Number(x.updatedAt) || 0 })),
        slowLines: (s.slowLines ?? []).filter((x) => !!x && typeof x.lineId === 'string' && x.lineId).map((x) => ({ lineId: String(x.lineId), off: x.off === true, updatedAt: Number(x.updatedAt) || 0 })),
        attExpected: (s.attExpected ?? []).map(attExpectedFrom).filter((x): x is AttExpected => !!x),
        // each room's hand-over of a day (2026-10-21): a function declaration, as above
        shiftMarks: (s.shiftMarks ?? []).map(shiftMarkFrom).filter((x): x is ShiftMark => !!x),
        turnGoals: (s.turnGoals ?? []).filter((g) => !!g && isTurnKey(String(g.key ?? ''))).map((g) => ({ key: String(g.key), perHour: g.perHour ?? null, total: g.total ?? null, updatedAt: g.updatedAt ?? 0 })),
      }
    }
  } catch (e) {
    // what is saved could not be read: said in the console, and the device starts over from the server (with a server,
    // a device without lines brings everything again, see sync.ts). Never silent: on 2026-10-17 a reading that failed
    // left every device that reloaded with an empty plant, and the screen said "Sincronizado"
    console.error('Actividad: lo guardado en este aparato no se pudo leer', e)
    try { localStorage.removeItem('act_since2') } catch { /* private */ } // the next pull starts over, as on the first day
  }
  return fresh()
}
// ---- what a device keeps when there is a server ----
/**
 * days of runs, stops, history and program a device keeps when there is a server. Older days stay on the server and
 * are brought when someone opens them (loadDay in sync.ts). Without a server the device is the only copy: it keeps
 * everything.
 */
export const KEEP_DAYS = 14
let keepDays = KEEP_DAYS // halved when the device's storage fills up
/** older days opened in this session (Reporte, Avance): they stay until the app is closed */
const opened = new Set<string>()
const dayBack = (n: number) => { const d = new Date(clockNow()); d.setDate(d.getDate() - n); return dayOf(d.getTime()) }
/** the oldest day this device keeps */
export const firstKeptDay = () => dayBack(keepDays - 1)
/** a day this device does not hold: the server has to be asked for it */
export const awayDay = (date: string) => SERVER && /^\d{4}-\d{2}-\d{2}$/.test(date) && date < firstKeptDay() && !opened.has(date)
export const openDay = (date: string) => { opened.add(date) }
export const closeDay = (date: string) => { opened.delete(date) }
/**
 * the state without the days the device no longer keeps. Never dropped: a run or a stop still open, anything still
 * waiting to go up, a day someone opened, and the stops of a run that stays. Nothing is ever deleted on the server.
 */
function pruned(s: State): State {
  if (!SERVER) return s
  const from = firstKeptDay(), fromMs = new Date(from + 'T00:00:00').getTime()
  const waiting = new Set(outbox.items().map((i) => i.table + '|' + i.key))
  const runs = s.runs.filter((r) => !r.endedAt || r.date >= from || r.startedAt >= fromMs || opened.has(r.date) || waiting.has('act_runs|' + r.id))
  const old = runs.filter((r) => r.startedAt < fromMs) // kept although old: their stops stay with them
  const beside = (x: Stop) => old.some((r) => r.dept === x.dept && (x.lineId === null || x.lineId === r.lineId) && x.startedAt < (r.endedAt ?? Infinity) && (x.endedAt ?? Infinity) > r.startedAt)
  const stops = s.stops.filter((x) => !x.endedAt || x.startedAt >= fromMs || opened.has(dayOf(x.startedAt)) || waiting.has('act_stops|' + x.id) || beside(x))
  const changes = s.changes.filter((c) => c.at >= fromMs || opened.has(dayOf(c.at)) || waiting.has('act_changes|' + c.id))
  const days = Object.keys(s.schedule).filter((d) => d >= from || opened.has(d))
  // A production order still in play (2026-10-19, see workNeeds) keeps what its numbers are made of: the runs of its
  // code in its room and unit, and the day programs that name it, from the day its queue starts. An order of 1000
  // mezclas at 80 a day lasts about 13 days, and a device keeps 14: without this, "Disponible" went up on the day its
  // first days were let go
  const needs = workNeeds(s), needFrom = new Map(needs.map((n) => [n.q, n.from]))
  const liveFrom = new Map<string, string>()
  for (const o of s.workOrders) { const f = needFrom.get(orderQueue(o)); if (f !== undefined && !o.deleted) liveFrom.set(o.id, f) }
  const needed = (r: Run) => { const f = r.deleted ? undefined : needFrom.get(woQueue(r.dept, r.code, apartOf(r))); return f !== undefined && r.date >= f }
  const forWork = (p: Plan) => { const f = p.orderId ? liveFrom.get(p.orderId) : undefined; return f !== undefined && p.date >= f }
  // (a program row by its code and its lot, as it waits in the queue: see planKey)
  const plans = s.plans.filter((p) => p.date >= from || (!!p.endDate && p.endDate >= from) || opened.has(p.date) || waiting.has('act_plan|' + planKey(p.date, p.dept, p.code, p.lot)) || forWork(p))
  // (attendance goes with its day, as everything else: kept while it waits to go up)
  const attendance = (s.attendance ?? []).filter((x) => x.date >= from || opened.has(x.date) || waiting.has('act_changes|att:' + x.id))
  const shiftMarks = (s.shiftMarks ?? []).filter((x) => x.date >= from || opened.has(x.date) || waiting.has('act_changes|cut:' + x.date + ':' + x.dept))
  // (messages go with their day too)
  const chat = (s.chat ?? []).filter((x) => dayOf(x.at) >= from || waiting.has('act_changes|chat:' + x.id))
  // a run that goes with its day keeps counting for the order its pallets went to, as long as that order is open
  const kept = new Set(runs.map((r) => r.id)), openIds = new Set(s.orders.filter((o) => !o.closed).map((o) => o.id))
  const forOrder = (r: Run) => r.units.some((u) => !!u.po && openIds.has(u.po)) || needed(r)
  const gone = s.runs.filter((r) => !kept.has(r.id) && forOrder(r))
  const orderRuns = [...(s.orderRuns ?? []).filter((r) => !kept.has(r.id) && !gone.some((g) => g.id === r.id) && forOrder(r)), ...gone]
  const sameOrderRuns = orderRuns.length === (s.orderRuns ?? []).length && orderRuns.every((r, k) => r === s.orderRuns[k])
  if (runs.length === s.runs.length && stops.length === s.stops.length && changes.length === s.changes.length && days.length === Object.keys(s.schedule).length && plans.length === s.plans.length && attendance.length === (s.attendance ?? []).length && shiftMarks.length === (s.shiftMarks ?? []).length && chat.length === (s.chat ?? []).length && sameOrderRuns) return s
  return { ...s, runs, orderRuns, stops, changes, schedule: Object.fromEntries(days.map((d) => [d, s.schedule[d]])), plans, attendance, shiftMarks, chat }
}
// ---- what this device holds of the days of each production order (2026-10-19) ----
/** this page has brought the plant from the server at least once (sync.ts says so after every pull that went well) */
let pulledOnce = false
export function markPulled() { pulledOnce = true }
/**
 * for each queue of orders (a room, a code and its unit: see woQueue), the first day whose runs and programs this page
 * brought from the server beyond the days it keeps (sync.ts, bringWorkOrderRuns). Kept in memory only: a page opened
 * again brings them again once, so an order's numbers are never made of an old copy
 */
const fetched = new Map<string, string>()
export function markFetched(q: string, from: string) { fetched.set(q, from) }
/**
 * Does this device hold every record of a queue from that day on? Without a server, always (the device is the only
 * copy). With one: once it has brought the plant, the days it keeps; and older days when it brought them for that
 * queue. Until then an order's numbers are said to be incomplete (OrderStatus.complete) and nothing is closed with them
 */
export function queueHeld(q: string, day: string): boolean {
  return !SERVER || (pulledOnce && (day >= firstKeptDay() || (fetched.get(q) ?? '9999-12-31') <= day))
}
/**
 * lets go of the days the device no longer keeps (see pruned). First, with the plant brought from the server, the
 * production orders finished before those days get their closed account (see sealFinished), so what they counted is
 * not lost with the days; and what this device says it holds of each order's days follows what it keeps (see queueHeld)
 */
export function prune() {
  if (SERVER && pulledOnce) sealFinished()
  const needs = workNeeds(state)
  for (const [q, f] of [...fetched]) { const n = needs.find((x) => x.q === q); if (!n) fetched.delete(q); else if (f < n.from) fetched.set(q, n.from) }
  const next = pruned(state); if (next !== state) set(next)
}

let state = load()
const subs = new Set<() => void>()
/**
 * writes the state to the device. When its storage is full: with a server, older days are let go (the server has
 * them) and it is tried again; when nothing more can go, or there is no server, the screen is told (storage.ts)
 */
function persist() {
  for (;;) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); storageFull.set(false); outbox.resave(); return }
    catch {
      if (!SERVER || keepDays <= 2) { storageFull.set(true); return }
      keepDays = Math.max(2, Math.floor(keepDays / 2))
      state = pruned(state)
    }
  }
}
let batching = 0, dirty = false
const commit = () => { persist(); subs.forEach((f) => f()) }
function set(next: State) { state = next; if (batching) dirty = true; else commit() }
/** many changes saved and shown once, at the end (a pull of hundreds of rows) */
export function batch<T>(fn: () => T): T {
  batching++
  try { return fn() } finally { if (--batching === 0 && dirty) { dirty = false; commit() } }
}
export const store = { get: () => state, subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f) } } }
const pref = (k: string) => ({
  get: () => { try { return localStorage.getItem(k) || '' } catch { return '' } },
  set: (v: string) => { try { localStorage.setItem(k, v) } catch { /* private */ } },
})
/** who is using this device, the department they picked when entering, and whether they are the manager */
export const user = pref('act_user')
export const myDept = pref('act_dept')
/** 'op' = supervisor / operator: only their department; 'mgr' = manager / office: every department, Avance and reports */
export const role = pref('act_role')
/**
 * '1' = the person signed in only looks ("Solo ver"): they see every room as a manager does (role 'mgr'), but the
 * server takes nothing from them. Such a device heals no Set up on its own (the server does, see migrations/016): it
 * used to try, the server refused, and the office's screen showed the red bar of a session the server does not take
 * (audit 2026-10-17). Units only it still holds are kept and wait for someone who may send them (see reconcile).
 * Kept apart from the role, so whatever reads the role (the Tablets tab) reads it as before
 */
export const viewOnly = pref('act_view_only')
/**
 * may the person signed in write this room's lines, codes, stops and history? The server's own rule
 * (migrations/001, act_can_write): a manager or the office every room, an operator only their own, somebody who only
 * looks none. The screens offer nothing more: an operator given "Ver todos los departamentos" (and "Corregir") could
 * start a code, correct a run or add a record in another room, the server refused it, and since rows are no longer
 * thrown away it waited on the tablet for ever, or went up under the next manager's session (review of 2026-10-18).
 * A function: nothing here may be read before the file has been (see load)
 */
export function writesRoom(d: string): boolean { return !viewOnly.get() && (role.get() !== 'op' || d === myDept.get()) }
/** the manager's code for the demo without server (with a server the roles come from the employees table) */
const mgrPin = pref('act_mgr_pin')
export const managerPin = { get: () => mgrPin.get() || '1234', set: (v: string) => mgrPin.set(v) }

// ---- rows as the server stores them (see supabase/migrations) ----
const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString())
const fromIso = (s: unknown) => (typeof s === 'string' && s ? Date.parse(s) : null)
const rowOfLine = (l: Line) => ({ id: l.id, dept: l.dept, name: l.name, deleted: !!l.deleted, updated_at: iso(l.updatedAt), updated_by: user.get(), ...(l.syncedAt ? { synced_at: iso(l.syncedAt) } : {}) })
const rowOfRun = (r: Run) => ({ id: r.id, dept: r.dept, line_id: r.lineId, line: r.line, code: r.code, lot: r.lot, date: r.date, started_at: iso(r.startedAt), ended_at: iso(r.endedAt), units: r.units, per_unit: r.perUnit, waste: r.waste, by_name: r.by, deleted: !!r.deleted, updated_at: iso(r.updatedAt), updated_by: user.get(), extra: r.extra ?? null, ...(r.syncedAt ? { synced_at: iso(r.syncedAt) } : {}) })
const rowOfStop = (x: Stop) => ({ id: x.id, dept: x.dept, line_id: x.lineId, reason: x.reason, note: x.note, started_at: iso(x.startedAt), ended_at: iso(x.endedAt), by_name: x.by, deleted: !!x.deleted, updated_at: iso(x.updatedAt), updated_by: user.get(), ...(x.syncedAt ? { synced_at: iso(x.syncedAt) } : {}) })
const rowOfProduct = (p: Product) => ({ code: normCode(p.code), name: p.name, pouches_per_case: p.pouchesPerCase, cases_per_mix: p.casesPerMix, crates_per_cart: p.cratesPerCart, pouches_per_crate: p.pouchesPerCrate, cases_per_pallet: p.casesPerPallet, room: p.room ?? null, spiral_unit: p.spiralUnit ?? null, lb_per_case: p.lbPerCase ?? null, deleted: !!p.deleted, updated_at: iso(p.updatedAt), updated_by: user.get() })
const rowOfSchedule = (date: string, code: string, mixes: number) => ({ date, code: normCode(code), mixes, updated_at: iso(clockNow()), updated_by: user.get() })
const rowOfChange = (c: Change) => ({ id: c.id, at: iso(c.at), by_name: c.by, dept: c.dept, what: c.what, before: c.before, after: c.after, ref_table: c.refTable, ref_key: c.refKey, deleted: !!c.deleted, updated_at: iso(c.updatedAt), updated_by: user.get() })

// ---- the mutations: each one saves on the device and queues the row for the server ----
/** a change is always stamped later than the version it was made from, even when this device's clock runs behind another's */
const stamp = (was: { updatedAt: number } | undefined) => Math.max(clockNow(), (was?.updatedAt ?? 0) + 1)
/** what the server last had of a row (nothing for one never sent): it travels with the queued change, see outbox.ts */
const baseOf = <T extends { updatedAt: number }>(was: T | undefined, row: (x: T) => Row) => (was && was.updatedAt ? row(was) : null)
/** `before` = the version this change starts from when the device no longer holds it (a line taken off, see restoreLine) */
const putLine = (l: Line, before?: Line) => {
  const was = state.lines.find((x) => x.id === l.id) ?? before
  l = { ...l, updatedAt: stamp(was) }; if (l.deleted) gone.set('act_lines|' + l.id, l.updatedAt)
  set({ ...state, lines: upsertIn(state.lines, l) }); push('act_lines', l.id, rowOfLine(l), baseOf(was, rowOfLine))
}
const putRun = (r: Run) => {
  // a line this device still holds only locally (from before the server) goes up first, so the run is seen on it everywhere
  const line = state.lines.find((l) => l.id === r.lineId)
  if (line && !line.updatedAt) putLine(line)
  const was = state.runs.find((x) => x.id === r.id)
  r = { ...r, line: line?.name ?? r.line, updatedAt: stamp(was) }; if (r.deleted) gone.set('act_runs|' + r.id, r.updatedAt)
  set({ ...state, runs: upsertIn(state.runs, r) }); push('act_runs', r.id, rowOfRun(r), baseOf(was, rowOfRun))
}
/**
 * lines made before this device had a server: the ones of the rooms this person may write are shared once, so every
 * screen shows the same rooms; the rest (an operator's leftover lines of other rooms) are dropped from the device
 */
export function shareLocalLines(canWrite: (dept: Dept) => boolean) {
  const keep = state.lines.filter((l) => l.updatedAt || canWrite(l.dept))
  if (keep.length !== state.lines.length) set({ ...state, lines: keep })
  for (const l of keep) if (!l.updatedAt) putLine(l)
}
const putStop = (x: Stop) => {
  const was = state.stops.find((y) => y.id === x.id)
  x = { ...x, updatedAt: stamp(was) }; if (x.deleted) gone.set('act_stops|' + x.id, x.updatedAt)
  set({ ...state, stops: upsertIn(state.stops, x) }); push('act_stops', x.id, rowOfStop(x), baseOf(was, rowOfStop))
}
/** a row put in its place: a changed one stays where it was (the lines keep their order on the screen), a new one goes last, a deleted one leaves */
function upsertIn<T extends { id: string; deleted?: boolean }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id)
  if (item.deleted) return i < 0 ? list : list.filter((x) => x.id !== item.id)
  return i < 0 ? [...list, item] : list.map((x, k) => (k === i ? item : x))
}

// ---- the history: who changed what, when ----
const v = (x: unknown) => (x == null || x === '' || x === 0 ? '' : String(x))
const COALESCE_MS = 90_000
/**
 * one line of history. The SAME value of the SAME record retyped by the same person within a minute and a half
 * (keystrokes, a second thought) updates its line instead of adding one; typed back to what it was, the line is
 * withdrawn. Another record never shares a line, even with the same wording.
 */
function logChange(dept: Dept | null, what: string, before: string, after: string, refTable: string, refKey: string, by = user.get()) {
  // (by = whose change the line tells: the person signed in, or the one who made a change this device kept for them)
  if (before === after) return
  const now = clockNow()
  const changes = state.changes
  let i = changes.length - 1
  while (i >= 0 && !(changes[i].by === by && changes[i].refTable === refTable && changes[i].refKey === refKey && changes[i].what === what && now - changes[i].at < COALESCE_MS)) i--
  const c: Change = i >= 0 ? { ...changes[i], after, updatedAt: now } : { id: uid(), at: now, by, dept, what, before, after, refTable, refKey, updatedAt: now }
  if (c.before === c.after) c.deleted = true
  set({ ...state, changes: upsertIn(changes, c) })
  push('act_changes', c.id, rowOfChange(c))
}
const PRODUCT_FIELDS: [keyof Product, string][] = [['name', 'Producto'], ['pouchesPerCase', 'Pouches / caja'], ['casesPerMix', 'Cajas / mezcla'], ['cratesPerCart', 'Guacales / carro'], ['pouchesPerCrate', 'Pouches / guacal'], ['casesPerPallet', 'Cajas / pallet'], ['lbPerCase', 'Lb / caja'], ['room', 'Lo empaca'], ['spiralUnit', 'Spiral cuenta en']]
function logProductDiff(old: Product | undefined, p: Product) {
  if (!old) { if (p.code.trim()) logChange(null, 'Producto nuevo', '', p.code, 'act_products', normCode(p.code)); return }
  if (normCode(old.code) !== normCode(p.code)) logChange(null, old.code.trim() ? 'Producto ' + old.code + ' · Código' : 'Producto nuevo', old.code, p.code, 'act_products', normCode(p.code))
  for (const [k, label] of PRODUCT_FIELDS) if (v(old[k]) !== v(p[k])) logChange(null, 'Producto ' + (p.code || old.code) + ' · ' + label, v(old[k]), v(p[k]), 'act_products', normCode(p.code))
}
const stopLine = (x: Stop) => (x.lineId === null ? 'todo ' + x.dept : state.lines.find((l) => l.id === x.lineId)?.name ?? state.runs.find((r) => r.lineId === x.lineId)?.line ?? 'línea')
const endText = (ms: number | null) => (ms ? fmtTime(ms) : 'en curso')

// ---- the lines of a room and their names ----
/**
 * the name a line has NOW: a renamed line shows its new name on everything recorded on it (the card, the reports,
 * the files). A line that was removed keeps the name its records carried.
 */
export const lineNameOf = (s: State, lineId: string | null, was = '') => lineLabel(s.lines.find((l) => l.id === lineId)?.name || was)
/** a line's name as the screen says it: the ones the app names itself ("Línea 3") read "Line 3" in English; a name somebody typed stays as typed */
export function lineLabel(name: string) { return lang === 'en' ? name.replace(/^Línea(?=\s|$)/, 'Line') : name }
/** the note the app writes on a set up ("Después de 0100", "De 0100 a 0215") as the screen says it; a note somebody typed stays as typed */
export function noteLabel(note: string) { const a = /^Después de (.+)$/.exec(note); if (a) return tr('Después de {0}', a[1]); const b = /^De (.+) a (.+)$/.exec(note); return b ? tr('De {0} a {1}', b[1], b[2]) : note }
/** "Línea 2" before "Línea 10" */
export const byLineName = (a: Line, b: Line) => a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' })
export const LINE_NAME_MAX = 24
/** the word a room's lines are named with when the app names them: the name that is KEPT, the same in any language */
// (a function, not a const: it is used while the very first state of a new device is being made, further up this file)
function lineWordKept(d: Dept) { return d === 'Kitchen' ? 'Braiser' : 'Línea' }
/** a name as it is kept: tidy, and with the app's own word for a line (somebody typing "Line 4" on an English screen means "Línea 4") */
export const tidyLineName = (t: string) => (lang === 'en' ? t.trim().replace(/^Line(?=\s|$)/i, 'Línea') : t).replace(/\s+/g, ' ').trim().slice(0, LINE_NAME_MAX).trim()
/** two names are the same line name whatever the capitals, accents or spaces: "linea  2" = "Línea 2" */
export const sameName = (a: string, b: string) => { const f = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); return f(a) === f(b) }
/**
 * the lines of a room that share a name, group by group (each group two or more lines, the one with more codes first):
 * one of them is nearly always a copy, added on a tablet that did not have its room's lines (2026-10-17, Packing)
 */
export function duplicateLines(s: State, dept: Dept): Line[][] {
  const lines = s.lines.filter((l) => l.dept === dept && !l.deleted), used = (l: Line) => s.runs.filter((r) => r.lineId === l.id).length
  const groups: Line[][] = []
  for (const l of lines) { const g = groups.find((x) => sameName(x[0].name, l.name)); if (g) g.push(l); else groups.push([l]) }
  return groups.filter((g) => g.length > 1).map((g) => g.sort((a, b) => used(b) - used(a)))
}
/** the line of that room that already has this name, other than `selfId` */
export const lineNamed = (s: State, dept: Dept, name: string, selfId?: string) => s.lines.find((l) => l.dept === dept && l.id !== selfId && sameName(l.name, name))
/** the standard names nobody has yet in a room ("Línea 1", "Línea 3"…), lowest first */
export function freeLineNames(s: State, dept: Dept, count = 4): string[] {
  const out: string[] = []
  for (let n = 1; out.length < count && n <= 99; n++) { const name = lineWordKept(dept) + ' ' + n; if (!lineNamed(s, dept, name)) out.push(name) }
  return out
}
/** adds a line; without a name it takes the lowest standard one that is free. false = blank after tidying, or the name is taken */
export function addLine(dept: Dept, name?: string): boolean {
  const final = tidyLineName(name ?? freeLineNames(state, dept, 1)[0] ?? '')
  if (!final || lineNamed(state, dept, final)) return false
  // a line of that name taken off before comes back as it was: the same line, so its records and goals are its own again
  const back = removedLines(state, dept).find((x) => sameName(x.name, final))
  if (back) return restoreLine(dept, back.id)
  const l: Line = { id: uid(), dept, name: final, updatedAt: 0 }
  putLine(l); logChange(dept, 'Línea agregada en ' + dept, '', l.name, 'act_lines', l.id)
  return true
}
/** the finished records of a line take its name too (the one running takes it by itself the next time it is touched) */
const renameRecords = (lineId: string, name: string) => { for (const r of state.runs.filter((x) => x.lineId === lineId && x.endedAt && x.line !== name)) putRun({ ...r, line: name }) }
/** gives a line another name. false = blank, or another line of the room has it (see swapLineNames) */
export function renameLine(id: string, name: string): boolean {
  const l = state.lines.find((x) => x.id === id), final = tidyLineName(name)
  if (!l || !final || lineNamed(state, l.dept, final, id)) return false
  if (final === l.name) return true
  batch(() => { putLine({ ...l, name: final }); renameRecords(id, final); logChange(l.dept, 'Línea renombrada en ' + l.dept, l.name, final, 'act_lines', id) })
  return true
}
/** two lines of a room trade names (the one called "Línea 1" was really line 2, and the other way round) */
export function swapLineNames(idA: string, idB: string): boolean {
  const a = state.lines.find((x) => x.id === idA), b = state.lines.find((x) => x.id === idB)
  if (!a || !b || a.id === b.id || a.dept !== b.dept) return false
  batch(() => {
    putLine({ ...a, name: b.name }); putLine({ ...b, name: a.name })
    renameRecords(a.id, b.name); renameRecords(b.id, a.name)
    logChange(a.dept, 'Línea renombrada en ' + a.dept, a.name, b.name, 'act_lines', a.id)
    logChange(b.dept, 'Línea renombrada en ' + b.dept, b.name, a.name, 'act_lines', b.id)
  })
  return true
}
export function removeLine(id: string) { const l = state.lines.find((x) => x.id === id); if (l) { putLine({ ...l, deleted: true }); logChange(l.dept, 'Línea quitada de ' + l.dept, l.name, '', 'act_lines', l.id) } }
/**
 * The lines of a room that were taken off, newest first, as the history keeps them (who, when, the line's own id),
 * one per name (the last one taken off with it), without the ones that are back or whose name another line has now.
 * Until 2026-10-17 anybody could take a free line off, and some lines were taken off after every code (Spiral: 28 in a
 * week); a manager can put one back as it was from Ajustes (see restoreLine), and adding a line of that name does it too
 */
export function removedLines(s: State, dept: Dept): { id: string; name: string; at: number; by: string }[] {
  const out = new Map<string, { id: string; name: string; at: number; by: string }>()
  for (const c of s.changes) if (c.refTable === 'act_lines' && c.what === 'Línea quitada de ' + dept && c.before && !c.deleted) { const was = out.get(c.refKey); if (!was || was.at < c.at) out.set(c.refKey, { id: c.refKey, name: c.before, at: c.at, by: c.by }) }
  const all = [...out.values()].filter((x) => !s.lines.some((l) => l.id === x.id) && !lineNamed(s, dept, x.name)).sort((a, b) => b.at - a.at)
  return all.filter((x, i) => all.findIndex((y) => sameName(y.name, x.name)) === i)
}
/** a line taken off comes back as it was: the same line, with its name (false = it is not one taken off, or its name is another line's now) */
export function restoreLine(dept: Dept, id: string): boolean {
  const x = removedLines(state, dept).find((y) => y.id === id)
  if (!x) return false
  // It starts from the line as it was taken off, as the history knows it: the device holds nothing of a line taken off,
  // and a change with nothing to start from loses to the server's copy. A pull of everything (the first one after
  // every new version) brought the line taken off before this went up, and the line was gone again while the history
  // said it was back (audit 2026-10-17)
  putLine({ id, dept, name: x.name, updatedAt: 0 }, { id, dept, name: x.name, deleted: true, updatedAt: x.at }); logChange(dept, 'Línea puesta de nuevo en ' + dept, '', x.name, 'act_lines', id)
  return true
}
/** the key of the operators' line rules in act_targets (add in per_hour, remove in per_shift: 1 = yes, 0 = no) */
const OPT_LINES = 'opt:oplines'
const linesText = (r: LineRules) => (r.add ? 'agregan líneas' : 'no agregan líneas') + ' · ' + (r.remove ? 'quitan líneas libres' : 'no quitan líneas')
/** a manager says what operators may do with their room's lines; every device sees it, and it goes to the history */
export function setLineRules(patch: Partial<Pick<LineRules, 'add' | 'remove'>>) {
  const was = state.lineRules, next: LineRules = { add: patch.add ?? was.add, remove: patch.remove ?? was.remove, updatedAt: stamp(was) }
  if (next.add === was.add && next.remove === was.remove) return
  set({ ...state, lineRules: next })
  push('act_targets', OPT_LINES, { dept: OPT_LINES, per_hour: next.add ? 1 : 0, per_shift: next.remove ? 1 : 0, updated_at: iso(next.updatedAt), updated_by: user.get() })
  logChange(null, 'Operadores y líneas', linesText(was), linesText(next), 'act_targets', OPT_LINES)
}
/**
 * The key of the Reason Codes switch in act_targets (per_hour: 1 = on, 0 = off). An 'opt:' key, as the line rules':
 * only the managers and the office write it (005's rules; 018 keeps it from the powers), and every version of the app
 * reads it as no goal of anybody: it is no room, ends in no "@1" / "@2" and starts with no "line:" or "shift…:" (see
 * applyRemote, where a key no branch knows falls into the room goals' branch and is let go there)
 */
const OPT_CODES = 'opt:reasoncodes'
const codesText = (on: boolean) => (on ? 'encendidos' : 'apagados')
/** a manager turns the Reason Codes on or off (Ajustes); every device sees it, and it goes to the history */
export function setReasonCodes(on: boolean) {
  const was = state.reasonCodes
  if (was.on === on) return
  const next: ReasonCodesOpt = { on, updatedAt: stamp(was) }
  set({ ...state, reasonCodes: next })
  push('act_targets', OPT_CODES, { dept: OPT_CODES, per_hour: on ? 1 : 0, per_shift: null, updated_at: iso(next.updatedAt), updated_by: user.get() })
  logChange(null, 'Códigos de paro', codesText(was.on), codesText(on), 'act_targets', OPT_CODES)
}
/**
 * The "Programa del día" tab for everybody (Jose, 2026-10-20: "que lo vea yo solamente y yo le muestro a ellos lo que
 * voy haciendo y cuando ellos digan está bien, entonces en ajuste lo prendo para que lo vean todos"). Off: only the
 * admin sees the tab. It travels in act_targets like the Reason Codes switch (an 'opt:' key: only managers and the
 * office write it, and no build reads it as a goal), and goes to the history.
 */
const OPT_PROGRAM = 'opt:programview'
const programText = (on: boolean) => (on ? 'para todos' : 'solo el admin')
export function setProgramView(on: boolean) {
  const was = state.programView
  if (was.on === on) return
  const next: ReasonCodesOpt = { on, updatedAt: stamp(was) }
  set({ ...state, programView: next })
  push('act_targets', OPT_PROGRAM, { dept: OPT_PROGRAM, per_hour: on ? 1 : 0, per_shift: null, updated_at: iso(next.updatedAt), updated_by: user.get() })
  logChange(null, 'Programa del día', programText(was.on), programText(on), 'act_targets', OPT_PROGRAM)
}
// ---- attendance (Santiago, 2026-10-20: see AttEntry) ----
/**
 * The people each room expects on a shift until a manager says otherwise (Santiago's sheet of 2026-10-20). Each room
 * and shift can be changed (setAttExpected): it travels in act_targets under 'opt:att:<room>:<shift>' (an 'opt:' key:
 * only managers and the office write it, and no build reads it as a goal)
 */
export const ATT_DEFAULT: Record<Dept, number> = { Kitchen: 6, Spiral: 11, RTE: 18, MFO: 10, Packing: 21 }
const ATT_KEY = 'opt:att:', ATT_ID = 'att:', ATT_REF = 'act_attendance'
export const attExpectedOf = (s: State, dept: Dept, shift: 1 | 2) => (s.attExpected ?? []).find((x) => x.dept === dept && x.shift === shift)?.n ?? ATT_DEFAULT[dept]
export function setAttExpected(dept: Dept, shift: 1 | 2, n: number) {
  const k = Math.round(n)
  if (!(k >= 0) || !roomKnown(dept)) return
  const was = (state.attExpected ?? []).find((x) => x.dept === dept && x.shift === shift), before = attExpectedOf(state, dept, shift)
  if (before === k && was) return
  const next: AttExpected = { dept, shift, n: k, updatedAt: stamp(was) }
  set({ ...state, attExpected: [...(state.attExpected ?? []).filter((x) => x !== was), next] })
  push('act_targets', ATT_KEY + dept + ':' + shift, { dept: ATT_KEY + dept + ':' + shift, per_hour: k, per_shift: null, updated_at: iso(next.updatedAt), updated_by: user.get() })
  logChange(dept, 'Asistencia · ' + dept + ' · Turno ' + shift + ' · personas esperadas', String(before), String(k), 'act_targets', ATT_KEY + dept + ':' + shift)
}
/** a name as two writings of it are compared ("juan  pérez" and "Juan Perez" are one person) */
const attKey = (x: string) => plain(x.replace(/\s+/g, ' ').trim())
const ATT_VIA = 'via:'
/**
 * the people of a room and shift of a day (the deleted ones out; the gone ones in, marked), and those another room sent
 * here (2026-10-22), shown from that room's record until somebody here writes them (then the written one counts alone)
 */
export function attOf(s: State, date: string, dept: Dept, shift: 1 | 2): AttEntry[] {
  const day = (s.attendance ?? []).filter((x) => !x.deleted && x.date === date && x.shift === shift)
  const mine = day.filter((x) => x.dept === dept), names = new Set(mine.map((x) => attKey(x.name)))
  const came = day.filter((x) => x.dept !== dept && x.gone?.why === 'otro' && x.gone.to === dept && !names.has(attKey(x.name)))
    .map((x): AttEntry => ({ ...x, id: ATT_VIA + x.id, dept, line: x.gone?.line ?? '', moves: [], from: x.dept, by: x.gone?.by ?? x.by, at: x.gone?.at ?? x.at, gone: null, via: x.id }))
  return [...mine, ...came].sort((a, b) => a.at - b.at)
}
/** a person shown here from another room's record is written here first (with the hour they came), to act on them */
function attHere(id: string): AttEntry | null {
  if (!id.startsWith(ATT_VIA)) return (state.attendance ?? []).find((y) => y.id === id) ?? null
  const src = (state.attendance ?? []).find((y) => y.id === id.slice(ATT_VIA.length))
  if (!src || src.deleted || src.gone?.why !== 'otro' || !src.gone.to) return null
  const there = attOf(state, src.date, src.gone.to, src.shift).find((y) => y.id === id)
  if (!there) return (state.attendance ?? []).find((y) => !y.deleted && y.date === src.date && y.shift === src.shift && y.dept === src.gone?.to && attKey(y.name) === attKey(src.name)) ?? null
  const x: AttEntry = { id: uid(), date: src.date, dept: src.gone.to, shift: src.shift, name: src.name, by: user.get(), at: there.at, gone: null, from: src.dept, line: there.line, moves: [], updatedAt: stamp(undefined) }
  putAtt(x)
  return x
}
const rowOfAtt = (x: AttEntry) => ({ id: ATT_ID + x.id, at: iso(x.at), by_name: x.by, dept: x.dept, what: 'Asistencia', before: '', after: JSON.stringify({ date: x.date, shift: x.shift, name: x.name, gone: x.gone, from: x.from, line: x.line, moves: x.moves, ...(x.temp ? { temp: true } : {}), ...(x.sup ? { sup: true } : {}), ...(x.came ? { came: x.came } : {}) }), ref_table: ATT_REF, ref_key: x.id, deleted: !!x.deleted, updated_at: iso(x.updatedAt), updated_by: user.get() })
function putAtt(x: AttEntry) {
  if (x.via) return
  set({ ...state, attendance: [...(state.attendance ?? []).filter((y) => y.id !== x.id), x] })
  push('act_changes', ATT_ID + x.id, rowOfAtt(x))
}
/** a person written for a room and shift; '' = not written (no name, or that name is already there and not gone) */
export function attAdd(date: string, dept: Dept, shift: 1 | 2, name: string, from: Dept | '' = '', line = '', temp = false, sup = false): string {
  const n = name.replace(/\s+/g, ' ').trim().slice(0, 60)
  if (!n || !isDay(date) || !roomKnown(dept) || (shift !== 1 && shift !== 2)) return ''
  if (attOf(state, date, dept, shift).some((x) => !x.gone && attKey(x.name) === attKey(n))) return ''
  const x: AttEntry = { id: uid(), date, dept, shift, name: n, by: user.get(), at: clockNow(), gone: null, from, line, moves: [], ...(temp ? { temp: true } : {}), ...(sup ? { sup: true } : {}), updatedAt: 0 }
  putAtt({ ...x, updatedAt: stamp(undefined) })
  return x.id
}
/**
 * a person taken out of the room: gone to cover another room (to), or gone home. Kept, marked, with when and who; the
 * % is worked out again. Gone to another room (on one of its lines, or none), they show up there by themselves (attOf);
 * with addThere they are written there too (the same shift), unless that room already has the name
 */
export function attRemove(id: string, why: 'otro' | 'casa', to: Dept | '' = '', addThere = false, toLine = ''): boolean {
  let ok = false
  batch(() => {
    const x = attHere(id)
    if (!x || x.deleted || x.gone || (why === 'otro' && to === x.dept)) return
    putAtt({ ...x, gone: { why, to: why === 'otro' ? to : '', at: clockNow(), by: user.get(), ...(why === 'otro' && toLine ? { line: toLine } : {}) }, updatedAt: stamp(x) })
    if (why === 'otro' && to && to !== x.dept && addThere) attAdd(x.date, to, x.shift, x.name, x.dept, toLine)
    ok = true
  })
  return ok
}
/** a person marked (or unmarked) as the room's supervisor or leader on the shift */
export function attSetSup(id: string, sup: boolean): boolean {
  let ok = false
  batch(() => {
    const x = attHere(id)
    if (!x || x.deleted || !!x.sup === sup) return
    const { sup: _was, ...rest } = x
    putAtt({ ...rest, ...(sup ? { sup: true } : {}), updatedAt: stamp(x) })
    ok = true
  })
  return ok
}
/** the supervisor or leader written for a room and shift (the first, when two) */
export const attSupOf = (s: State, date: string, dept: Dept, shift: 1 | 2) => attOf(s, date, dept, shift).find((x) => x.sup && !x.gone)
/** the hour a person really came, as written (null = they came at the shift's start: the hour is taken away) */
export function attSetCame(id: string, at: number | null): boolean {
  let ok = false
  batch(() => {
    const x = attHere(id)
    if (!x || x.deleted || (x.came ?? null) === (at && at > 0 ? at : null)) return
    const { came: _was, ...rest } = x
    putAtt({ ...rest, ...(at && at > 0 ? { came: at } : {}), updatedAt: stamp(x) })
    ok = true
  })
  return ok
}
/** a person marked (or unmarked) as a temp (agency) worker */
export function attSetTemp(id: string, temp: boolean): boolean {
  let ok = false
  batch(() => {
    const x = attHere(id)
    if (!x || x.deleted || !!x.temp === temp) return
    const { temp: _was, ...rest } = x
    putAtt({ ...rest, ...(temp ? { temp: true } : {}), updatedAt: stamp(x) })
    ok = true
  })
  return ok
}
/** a person moved to another line of the same room ('' = no line in particular): the line before is kept in moves */
export function attMoveLine(id: string, line: string): boolean {
  let ok = false
  batch(() => {
    const x = attHere(id)
    if (!x || x.deleted || x.gone || x.line === line) return
    putAtt({ ...x, line, moves: [...x.moves, { from: x.line, to: line, at: clockNow(), by: user.get() }], updatedAt: stamp(x) })
    ok = true
  })
  return ok
}
/**
 * A person who came from another room is taken in here (Jose, 2026-10-28: "a Packing le debe salir ese aceptar y lo
 * pone en una línea o sin línea"): written as this room's record, on the line chosen (none = ''). They already counted
 * here from the moment the other room sent them; accepting places them and takes the "llegó" notice away
 */
export function attAccept(id: string, line = ''): boolean {
  let ok = false
  batch(() => {
    const x = attHere(id)
    if (!x || x.deleted || x.gone) return
    if (x.line !== line) putAtt({ ...x, line, moves: [...x.moves, { from: x.line, to: line, at: clockNow(), by: user.get() }], updatedAt: stamp(x) })
    ok = true
  })
  return ok
}
/** a person taken out by mistake comes back (what was written in the other room for them stays: it is that room's) */
export function attBack(id: string): boolean {
  const x = (state.attendance ?? []).find((y) => y.id === id)
  if (!x || x.deleted || !x.gone) return false
  putAtt({ ...x, gone: null, updatedAt: stamp(x) })
  return true
}
/** a person written by mistake is taken away (kept on the server, marked, as everything) */
export function attDelete(id: string): boolean {
  const x = id.startsWith(ATT_VIA) ? null : (state.attendance ?? []).find((y) => y.id === id)
  if (!x || x.deleted) return false
  putAtt({ ...x, deleted: true, updatedAt: stamp(x) })
  return true
}
/** the line a person works on, as said ('' = none in particular) */
export const attLineText = (s: State, line: string | undefined) => (line ? lineNameOf(s, line, '') : '')
/** each move of a person, as said: "Línea 1 → Línea 2 · 10:30", then the move to another room */
export function attMovesText(s: State, x: AttEntry) {
  const name = (l: string) => attLineText(s, l) || tr('sin línea')
  const out = x.moves.map((m) => name(m.from) + ' → ' + name(m.to) + ' · ' + fmtTime(m.at))
  if (x.gone?.why === 'otro') out.push(x.dept + (x.line ? ' ' + name(x.line) : '') + ' → ' + (x.gone.to || tr('otro cuarto')) + (x.gone.line ? ' ' + name(x.gone.line) : '') + ' · ' + fmtTime(x.gone.at))
  return out.join(' · ')
}
/** what a person is doing, as said in the report and its files */
export const attStateText = (s: State, x: AttEntry) => (!x.gone ? tr('trabajando') : x.gone.why === 'casa' ? tr('se fue a su casa') : tr('pasó a {0}', (x.gone.to || tr('otro cuarto')) + (x.gone.line ? ' · ' + attLineText(s, x.gone.line) : '')))
// ---- the Daily KPI Report (2026-10-22: the COO's "New Expectations - Daily KPI Reporting", for Jose and Edgar) ----
/**
 * What the report keeps that is not production: who may see it (key 'access': names), the Costco MVM plan loaded from
 * Yasbelth's planner (key 'plan:<code>'), and each day's "what we saw · root cause · action" (key 'note:<date>:<part>').
 * In act_changes with their own ref_table, as the attendance: no SQL needed; the server never erases (deleted marks).
 */
export type KpiRec = { key: string; data: Record<string, unknown>; by: string; at: number; deleted?: boolean; updatedAt: number; syncedAt?: number }
const KPI_ID = 'kpi:'
export const KPI_REF = 'act_kpi'
function kpiFrom(x: Partial<KpiRec> | null | undefined): KpiRec | null {
  if (!x || typeof x !== 'object' || typeof x.key !== 'string' || !x.key || !x.data || typeof x.data !== 'object') return null
  return { key: x.key.slice(0, 120), data: x.data as Record<string, unknown>, by: String(x.by ?? ''), at: Number(x.at) || 0, ...(x.deleted ? { deleted: true } : {}), updatedAt: Number(x.updatedAt) || 0, ...(Number(x.syncedAt) > 0 ? { syncedAt: Number(x.syncedAt) } : {}) }
}
export const kpiGet = (s: State, key: string) => (s.kpi ?? []).find((x) => x.key === key && !x.deleted) ?? null
export function kpiPut(key: string, data: Record<string, unknown>, deleted = false) {
  const was = (state.kpi ?? []).find((x) => x.key === key)
  const x: KpiRec = { key, data, by: user.get(), at: clockNow(), ...(deleted ? { deleted: true } : {}), updatedAt: stamp(was) }
  set({ ...state, kpi: [...(state.kpi ?? []).filter((y) => y.key !== key), x] })
  push('act_changes', KPI_ID + key, { id: KPI_ID + key, at: iso(x.at), by_name: x.by, dept: null, what: 'KPI', before: '', after: JSON.stringify(data), ref_table: KPI_REF, ref_key: key, deleted, updated_at: iso(x.updatedAt), updated_by: user.get() })
}
// ---- weight tests (2026-10-22: "botones en RTE para que los operadores registren la que está baja y subida de weight") ----
/**
 * A weight test on a line: every hour or at each changeover the operator checks several finished pouches. Each pouch is
 * an entry: its weight typed (lb, gross with the plastic, as Joshua's sheet), and/or the operator's own call with the
 * two buttons, "▲ Sobre peso" or "▼ Bajo peso" (Jose, 2026-10-22: "dos botones, uno para arriba y otro para abajo, y que
 * el peso sea opcional"). A weight without a call is judged against the code's target (pouch ± tolerance, set by a
 * manager). Each entry is saved at once (the test is one record, written again with every entry), so nothing is lost.
 * In act_changes with the run's room (an RTE operator writes her room), apart from the history; the server never erases.
 * (The first build of the same day kept only weights: a record with "weights" and no "entries" reads as those weights.)
 */
export type WtEntry = { w?: number; k?: 'sobre' | 'bajo' }
export type WeightTest = { id: string; date: string; dept: Dept; lineId: string; line: string; code: string; lot: string; runId: string
  /** pouch: RTE's finished pouches; ball: Spiral's cooked meatballs, so many each hour (2026-10-23); raw: Kitchen's
   *  meatballs before the oven, the same way (Jose, 2026-10-28: "que Kitchen también pueda pesar las meatballs en oz") */
  kind: 'pouch' | 'ball' | 'raw' | 'pouched'; unit: 'oz'
  /** Spiral's two cookers (Jose, 2026-10-29: "Spiral y racks son los dos que cocinan diferente"): the balls are weighed
   *  raw before going into each one and cooked when they come out; none on the other rooms and on Spiral's first tests */
  cook?: Cook
  /** a cooker that did not cook that hour, said by the operator instead of weighing it (no entries) */
  skip?: true
  /** how many weights were asked when the test was made (2026-10-29): it is complete with that many; none = a test of before */
  need?: number
  /** in ounces (Jose, 2026-10-22: "aquí es oz, no lb"); the first builds of that day wrote pounds and no unit: read ×16 */
  entries: WtEntry[]; at: number; by: string; deleted?: boolean; updatedAt: number; syncedAt?: number }
export type Cook = 'spiral' | 'racks'
export const COOKS: Cook[] = ['spiral', 'racks']
const WT_ID = 'wt:'
export const WT_REF = 'act_weights'
// (a function declaration, as everything load() reaches: a const here is not there yet when the device opens, see the TDZ rule)
function okWeight(w: unknown) { return Number.isFinite(Number(w)) && Number(w) > 0 && Number(w) < 2000 }
function wtEntries(x: { entries?: unknown; weights?: unknown; unit?: unknown }): WtEntry[] {
  const raw = Array.isArray(x.entries) ? x.entries : Array.isArray(x.weights) ? x.weights.map((w) => ({ w })) : []
  const per = x.unit === 'oz' ? 1 : 16
  return raw.map((e): WtEntry | null => {
    if (!e || typeof e !== 'object') return null
    const o = e as { w?: unknown; k?: unknown }, w = okWeight(o.w) ? Math.round(Number(o.w) * per * 1000) / 1000 : undefined, k = o.k === 'sobre' || o.k === 'bajo' ? o.k : undefined
    return w == null && !k ? null : { ...(w != null ? { w } : {}), ...(k ? { k } : {}) }
  }).filter((e): e is WtEntry => !!e).slice(0, 300)
}
function wtFrom(x: (Partial<WeightTest> & { weights?: unknown; unit?: unknown }) | null | undefined): WeightTest | null {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id || !(DEPTS as unknown[]).includes(x.dept) || !isDay(String(x.date ?? '')) || !normCode(String(x.code ?? ''))) return null
  return { id: x.id, date: String(x.date), dept: x.dept as Dept, lineId: String(x.lineId ?? ''), line: String(x.line ?? ''), code: String(x.code).trim().toUpperCase(), lot: String(x.lot ?? ''), runId: String(x.runId ?? ''), kind: x.kind === 'ball' ? 'ball' : x.kind === 'raw' ? 'raw' : x.kind === 'pouched' ? 'pouched' : 'pouch', unit: 'oz', ...(x.dept === 'Spiral' && (x.cook === 'spiral' || x.cook === 'racks') ? { cook: x.cook } : {}), ...(x.skip === true ? { skip: true as const } : {}), ...(Number(x.need) > 0 ? { need: Math.round(Number(x.need)) } : {}), entries: wtEntries(x), at: Number(x.at) || 0, by: String(x.by ?? ''), ...(x.deleted ? { deleted: true } : {}), updatedAt: Number(x.updatedAt) || 0, ...(Number(x.syncedAt) > 0 ? { syncedAt: Number(x.syncedAt) } : {}) }
}
/** the weights typed in a test (the entries with a number) */
export const wtWeights = (t: WeightTest) => t.entries.flatMap((e) => (e.w != null ? [e.w] : []))
const rowOfWt = (x: WeightTest) => ({ id: WT_ID + x.id, at: iso(x.at), by_name: x.by, dept: x.dept, what: 'Peso', before: '', after: JSON.stringify({ date: x.date, lineId: x.lineId, line: x.line, code: x.code, lot: x.lot, runId: x.runId, kind: x.kind, ...(x.cook ? { cook: x.cook } : {}), ...(x.skip ? { skip: true } : {}), ...(x.need ? { need: x.need } : {}), unit: 'oz', entries: x.entries, weights: wtWeights(x) }), ref_table: WT_REF, ref_key: x.id, deleted: !!x.deleted, updated_at: iso(x.updatedAt), updated_by: user.get() })
/** a new test on a run, of one of its room's steps (the room's first one when none is said); nothing is saved until its first entry */
export const weightNew = (run: Run, step?: WtStep): WeightTest => { const st = step ?? weightStepsFor(state, run.dept, run.code)[0] ?? { kind: 'pouch' as const }; return { id: uid(), date: run.date, dept: run.dept, lineId: run.lineId, line: run.line, code: run.code, lot: lotNowOf(run), runId: run.id, kind: st.kind, ...(st.cook ? { cook: st.cook } : {}), unit: 'oz', entries: [], at: clockNow(), by: user.get(), updatedAt: 0 } }
/**
 * a test saved with the entries it has now (the first one saves it; each next one writes it again); none = taken away.
 * Its hour is the first entry's (2026-10-29: the window may stand open a while before anyone weighs)
 */
export function weightSave(t: WeightTest, entries: WtEntry[]) {
  const was = (state.weights ?? []).find((y) => y.id === t.id)
  const es = wtEntries({ entries, unit: 'oz' })
  if (!was && !es.length) return
  // (a test emptied and then checked again comes back: the deleted mark goes with the last entry only)
  const { deleted: _gone, skip: _skip, ...base } = was ?? t
  const at = was && !was.deleted && !was.skip ? was.at : clockNow()
  const x: WeightTest = { ...base, at, entries: es, ...(es.length ? {} : { deleted: true }), updatedAt: stamp(was) }
  set({ ...state, weights: [...(state.weights ?? []).filter((y) => y.id !== t.id), x] })
  push('act_changes', WT_ID + x.id, rowOfWt(x))
}
/** a cooker that did not cook this hour, said instead of weighing it (on = said; off = taken back) */
export function weightSkip(t: WeightTest, on: boolean) {
  const was = (state.weights ?? []).find((y) => y.id === t.id)
  if (on ? was && !was.deleted && (was.skip || was.entries.length) : !was?.skip || was.deleted) return
  const { deleted: _gone, ...base } = was ?? t
  const x: WeightTest = { ...base, entries: [], ...(on ? { skip: true as const, at: clockNow() } : { deleted: true }), updatedAt: stamp(was) }
  set({ ...state, weights: [...(state.weights ?? []).filter((y) => y.id !== t.id), x] })
  push('act_changes', WT_ID + x.id, rowOfWt(x))
}
/**
 * weights written under the wrong code or as the wrong thing, put right from the report (Jose, 2026-10-30: the floor
 * wrote 2286 for 0889, and the Kitchen's are cooked, not raw): the weights stay as typed, with their hour, line and who
 * took them; what changes is the code and what was weighed, so they are judged against that target. In the history
 */
export function weightsFix(ids: string[], code: string, kind: WeightTest['kind']): number {
  const c = code.trim().toUpperCase(), list = (state.weights ?? []).filter((x) => ids.includes(x.id) && !x.deleted && (x.code !== c || x.kind !== kind))
  if (!c || !list.length) return 0
  const fixed = list.map((x): WeightTest => ({ ...x, code: c, kind, updatedAt: stamp(x) }))
  batch(() => {
    set({ ...state, weights: [...(state.weights ?? []).filter((y) => !list.some((x) => x.id === y.id)), ...fixed] })
    for (const x of fixed) push('act_changes', WT_ID + x.id, rowOfWt(x))
  })
  const was = list[0]
  logChange(was.dept, 'Pesos del ' + was.date + ' · ' + list.length + (list.length === 1 ? ' prueba' : ' pruebas'), was.code + ' · ' + stepText({ kind: was.kind }), c + ' · ' + stepText({ kind }), WT_REF, was.id)
  return list.length
}
// ---- the meat Spiral uses (2026-10-23: "que ponga la cantidad de carne que usan para hacer esas mezclas, en libras, y su lote") ----
/**
 * Each time Spiral puts meat in, the line records how many pounds and the meat's lot (one kind of meat, one lot each
 * time), apart from the mezclas; the report adds it up by code with the pounds of meat per mezcla, which is what the
 * office wants to look at. Kept with the run it went to (code, lot) and the room, in act_changes apart from the
 * history (an operator of Spiral writes her room); taken away = marked deleted, never erased
 */
export type MeatEntry = { id: string; date: string; dept: Dept; lineId: string; line: string; code: string; lot: string; runId: string; lb: number; meatLot: string; at: number; by: string; deleted?: boolean; updatedAt: number; syncedAt?: number }
const MEAT_ID = 'meat:'
export const MEAT_REF = 'act_meat'
function meatFrom(x: Partial<MeatEntry> | null | undefined): MeatEntry | null {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id || !(DEPTS as unknown[]).includes(x.dept) || !isDay(String(x.date ?? '')) || !normCode(String(x.code ?? ''))) return null
  const lb = Number(x.lb)
  if (!(lb > 0 && lb < 100000)) return null
  return { id: x.id, date: String(x.date), dept: x.dept as Dept, lineId: String(x.lineId ?? ''), line: String(x.line ?? ''), code: String(x.code).trim().toUpperCase(), lot: String(x.lot ?? ''), runId: String(x.runId ?? ''), lb: Math.round(lb * 100) / 100, meatLot: String(x.meatLot ?? '').trim().slice(0, 40), at: Number(x.at) || 0, by: String(x.by ?? ''), ...(x.deleted ? { deleted: true } : {}), updatedAt: Number(x.updatedAt) || 0, ...(Number(x.syncedAt) > 0 ? { syncedAt: Number(x.syncedAt) } : {}) }
}
const putMeat = (x: MeatEntry) => {
  set({ ...state, meats: [...(state.meats ?? []).filter((y) => y.id !== x.id), x] })
  push('act_changes', MEAT_ID + x.id, { id: MEAT_ID + x.id, at: iso(x.at), by_name: x.by, dept: x.dept, what: 'Carne', before: '', after: JSON.stringify({ date: x.date, lineId: x.lineId, line: x.line, code: x.code, lot: x.lot, runId: x.runId, lb: x.lb, meatLot: x.meatLot }), ref_table: MEAT_REF, ref_key: x.id, deleted: !!x.deleted, updated_at: iso(x.updatedAt), updated_by: user.get() })
}
/** the meat put in on a run now: its pounds and its lot ('' = not written); '' when the pounds make no sense */
export function meatAdd(r: Run, lb: number, meatLot: string): string {
  if (!(lb > 0 && lb < 100000)) return ''
  const x: MeatEntry = { id: uid(), date: r.date, dept: r.dept, lineId: r.lineId, line: r.line, code: r.code, lot: lotNowOf(r), runId: r.id, lb: Math.round(lb * 100) / 100, meatLot: meatLot.trim().slice(0, 40), at: clockNow(), by: user.get(), updatedAt: stamp(undefined) }
  putMeat(x)
  return x.id
}
/** a meat entry written by mistake is taken away (kept on the server, marked) */
export function meatDelete(id: string) {
  const x = (state.meats ?? []).find((y) => y.id === id)
  if (!x || x.deleted) return
  putMeat({ ...x, deleted: true, updatedAt: stamp(x) })
}
// ---- what a room consumes (the office, 2026-10-27: "que Kitchen y Spiral pesen lo que consumen antes de comenzar, y lo que no se consumió quede en inventario") ----
/**
 * Before a code starts the line weighs what it is going to consume (what it is, its lot, the date on its label, the
 * pounds), mandatory where a manager turned it on in Ajustes (opt:consumo:<room>, off until then); when the code ends
 * it says whether all was consumed or how many pounds were left (left: null = not said yet), and what is left is the
 * room's inventory, offered when the next code starts (fromId = the entry it was taken from, which then leaves the
 * inventory). Each entry is one record in act_changes with the run's room (act_consumo), like the meat; the server
 * never erases.
 */
export type ConsumeEntry = { id: string; date: string; dept: Dept; lineId: string; line: string; code: string; lot: string; runId: string; product: string; prodLot: string; labelDate: string; lb: number; left: number | null; fromId: string; at: number; by: string; deleted?: boolean; updatedAt: number; syncedAt?: number }
export type ConsumeOpt = { dept: Dept; on: boolean; updatedAt: number }
const CONS_ID = 'consumo:'
export const CONS_REF = 'act_consumo'
const CONS_KEY = 'opt:consumo:'
function consumeFrom(x: Partial<ConsumeEntry> | null | undefined): ConsumeEntry | null {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id || !(DEPTS as unknown[]).includes(x.dept) || !isDay(String(x.date ?? '')) || !String(x.product ?? '').trim()) return null
  const lb = Number(x.lb)
  if (!(lb > 0 && lb < 100000)) return null
  const left = x.left == null || x.left === undefined ? null : Math.min(lb, Math.max(0, Math.round(Number(x.left) * 100) / 100))
  return { id: x.id, date: String(x.date), dept: x.dept as Dept, lineId: String(x.lineId ?? ''), line: String(x.line ?? ''), code: String(x.code ?? '').trim().toUpperCase(), lot: String(x.lot ?? ''), runId: String(x.runId ?? ''), product: String(x.product).trim().slice(0, 60), prodLot: String(x.prodLot ?? '').trim().slice(0, 40), labelDate: String(x.labelDate ?? '').slice(0, 10), lb: Math.round(lb * 100) / 100, left: Number.isFinite(left as number) ? left : null, fromId: String(x.fromId ?? ''), at: Number(x.at) || 0, by: String(x.by ?? ''), ...(x.deleted ? { deleted: true } : {}), updatedAt: Number(x.updatedAt) || 0, ...(Number(x.syncedAt) > 0 ? { syncedAt: Number(x.syncedAt) } : {}) }
}
const putConsume = (x: ConsumeEntry) => {
  set({ ...state, consumes: [...(state.consumes ?? []).filter((y) => y.id !== x.id), x] })
  push('act_changes', CONS_ID + x.id, { id: CONS_ID + x.id, at: iso(x.at), by_name: x.by, dept: x.dept, what: 'Consumo', before: '', after: JSON.stringify({ date: x.date, lineId: x.lineId, line: x.line, code: x.code, lot: x.lot, runId: x.runId, product: x.product, prodLot: x.prodLot, labelDate: x.labelDate, lb: x.lb, left: x.left, fromId: x.fromId }), ref_table: CONS_REF, ref_key: x.id, deleted: !!x.deleted, updated_at: iso(x.updatedAt), updated_by: user.get() })
}
/** something weighed into a code: what it is, its lot, its label's date, the pounds; fromId when it was what was left of an earlier entry. '' when it makes no sense */
export function consumeAdd(r: Run, product: string, prodLot: string, labelDate: string, lb: number, fromId = ''): string {
  if (!product.trim() || !(lb > 0 && lb < 100000)) return ''
  const x: ConsumeEntry = { id: uid(), date: r.date, dept: r.dept, lineId: r.lineId, line: r.line, code: r.code, lot: lotNowOf(r), runId: r.id, product: product.trim().slice(0, 60), prodLot: prodLot.trim().slice(0, 40), labelDate: labelDate.slice(0, 10), lb: Math.round(lb * 100) / 100, left: null, fromId, at: clockNow(), by: user.get(), updatedAt: stamp(undefined) }
  putConsume(x)
  logChange(r.dept, 'Consumo · ' + r.code, '', x.product + (x.prodLot ? ' · lote ' + x.prodLot : '') + ' · ' + x.lb + ' lb', CONS_REF, x.id)
  return x.id
}
/** what was left of an entry when its code ended (0 = all consumed); false when there is no such entry */
export function consumeLeft(id: string, left: number): boolean {
  const x = (state.consumes ?? []).find((y) => y.id === id)
  if (!x || x.deleted || !(left >= 0) || left > x.lb) return false
  const n = Math.round(left * 100) / 100
  if (x.left === n) return true
  putConsume({ ...x, left: n, updatedAt: stamp(x) })
  logChange(x.dept, 'Consumo · ' + x.code, x.product + ' · ' + x.lb + ' lb', n > 0 ? 'quedaron ' + n + ' lb' : 'se consumió todo', CONS_REF, x.id + ':l')
  return true
}
/** an entry written by mistake is taken away (kept on the server, marked) */
export function consumeDelete(id: string) {
  const x = (state.consumes ?? []).find((y) => y.id === id)
  if (!x || x.deleted) return
  putConsume({ ...x, deleted: true, updatedAt: stamp(x) })
}
/** what went in on a day (one room, or all), oldest first */
export const consumesOf = (s: State, date: string, dept?: Dept) => (s.consumes ?? []).filter((x) => !x.deleted && x.date === date && (!dept || x.dept === dept)).sort((a, b) => a.at - b.at)
export const consumesOfRun = (s: State, runId: string) => (s.consumes ?? []).filter((x) => !x.deleted && x.runId === runId).sort((a, b) => a.at - b.at)
/** the room's inventory now: what was left of entries nobody has taken since, oldest first */
export function inventoryOf(s: State, dept?: Dept): ConsumeEntry[] {
  const all = (s.consumes ?? []).filter((x) => !x.deleted)
  const taken = new Set(all.map((x) => x.fromId).filter(Boolean))
  return all.filter((x) => (x.left ?? 0) > 0 && !taken.has(x.id) && (!dept || x.dept === dept)).sort((a, b) => a.at - b.at)
}
/** entries of a line's ended codes whose leftover has not been said yet: the line answers before going on */
export const consumesPending = (s: State, lineId: string) => (s.consumes ?? []).filter((x) => !x.deleted && x.lineId === lineId && x.left == null && (() => { const r = s.runs.find((y) => y.id === x.runId); return !!r && !r.deleted && !!r.endedAt })()).sort((a, b) => a.at - b.at)
/** whether a room must weigh what it consumes before a code starts (a manager's switch in Ajustes) */
export const consumeOn = (s: State, dept: Dept) => !!(s.consumeOpts ?? []).find((x) => x.dept === dept)?.on
export function setConsumeOn(dept: Dept, on: boolean) {
  const was = (state.consumeOpts ?? []).find((x) => x.dept === dept)
  if (!!was?.on === on) return
  const x: ConsumeOpt = { dept, on, updatedAt: stamp(was) }
  set({ ...state, consumeOpts: [...(state.consumeOpts ?? []).filter((y) => y !== was), x] })
  push('act_targets', CONS_KEY + dept, { dept: CONS_KEY + dept, per_hour: on ? 1 : 0, per_shift: null, updated_at: iso(x.updatedAt), updated_by: user.get() })
  logChange(dept, 'Consumo · ' + dept, was?.on ? 'obligatorio' : 'apagado', on ? 'obligatorio' : 'apagado', 'act_targets', CONS_KEY + dept)
}

// ---- units on hold (2026-10-23: "que se pueda poner en hold registros y tener la opción de omitir el conteo") ----
/**
 * A mezcla, a pallet or any unit already recorded is put on hold while it is checked, by a manager or the office (Jose:
 * "solo managers y oficina"), who also says whether it still counts or is taken off the count meanwhile (a pallet of a
 * PO of 10/10 taken off leaves it 9/10, so another one can be made: "que sea decisión de la oficina"). Taken off, the
 * unit leaves its run as a unit taken off in Corregir does (so every total, the PO, Avance and the program's cap see it
 * at once), and the hold keeps a copy of it; released, it goes back on the run; rejected, it stays off (or is taken off
 * then). The hold is one record in act_changes with the run's room, apart from the history; the server never erases.
 */
export type HoldRec = { id: string; dept: Dept; date: string; runId: string; lineId: string; line: string; code: string; lot: string; unit: Unit; n: number; discount: boolean; state: 'hold' | 'released' | 'rejected'; note: string; at: number; by: string; doneAt: number; doneBy: string; deleted?: boolean; updatedAt: number; syncedAt?: number }
const HOLD_ID = 'hold:'
export const HOLD_REF = 'act_hold'
function holdFrom(x: Partial<HoldRec> | null | undefined): HoldRec | null {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id || !(DEPTS as unknown[]).includes(x.dept) || !isDay(String(x.date ?? '')) || !x.unit || typeof x.unit !== 'object') return null
  const st = x.state === 'released' || x.state === 'rejected' ? x.state : 'hold'
  return { id: x.id, dept: x.dept as Dept, date: String(x.date), runId: String(x.runId ?? ''), lineId: String(x.lineId ?? ''), line: String(x.line ?? ''), code: String(x.code ?? ''), lot: String(x.lot ?? ''), unit: unitOf(x.unit), n: Number(x.n) || 0, discount: !!x.discount, state: st, note: String(x.note ?? '').slice(0, 300), at: Number(x.at) || 0, by: String(x.by ?? ''), doneAt: Number(x.doneAt) || 0, doneBy: String(x.doneBy ?? ''), ...(x.deleted ? { deleted: true } : {}), updatedAt: Number(x.updatedAt) || 0, ...(Number(x.syncedAt) > 0 ? { syncedAt: Number(x.syncedAt) } : {}) }
}
const putHold = (x: HoldRec) => {
  set({ ...state, holds: [...(state.holds ?? []).filter((y) => y.id !== x.id), x] })
  const { id: _i, dept: _d, by: _b, at: _a, updatedAt: _u, syncedAt: _s, deleted: _x, ...rest } = x
  push('act_changes', HOLD_ID + x.id, { id: HOLD_ID + x.id, at: iso(x.at), by_name: x.by, dept: x.dept, what: 'Hold', before: '', after: JSON.stringify(rest), ref_table: HOLD_REF, ref_key: x.id, deleted: !!x.deleted, updated_at: iso(x.updatedAt), updated_by: user.get() })
}
/** the units on hold now (a room, or all), the oldest first */
export const holdsOpen = (s: State, dept?: Dept) => (s.holds ?? []).filter((x) => !x.deleted && x.state === 'hold' && (!dept || x.dept === dept)).sort((a, b) => a.at - b.at)
/** the hold a unit of a run is in now (a unit that still counts is still on its run) */
export const holdOf = (s: State, runId: string, at: number) => (s.holds ?? []).find((x) => !x.deleted && x.state === 'hold' && x.runId === runId && x.unit.at === at) ?? null
const takeOff = (runId: string, at: number) => { const r = run(runId); if (r && r.units.some((u) => u.at === at)) updateRun(runId, { units: r.units.filter((u) => u.at !== at) }) }
/** a unit held back on its run: with its PO when the PO still takes it, else without (the hold says so); its new moment */
function putBack(h: HoldRec): number {
  const u = h.unit, base = { at: u.at, qty: u.qty, ref: u.ref, ...(u.lots ? { lots: u.lots } : {}), ...(u.note ? { note: u.note } : {}) }
  return (u.po ? addUnit(h.runId, { ...base, po: u.po }) : 0) || addUnit(h.runId, base)
}
/** a unit put on hold: still counting, or taken off the count meanwhile; '' when it cannot (no such unit, or already on hold) */
export function holdUnit(runId: string, at: number, discount: boolean, note = ''): string {
  const r = run(runId), i = r ? r.units.findIndex((u) => u.at === at) : -1
  if (!r || i < 0 || holdOf(state, runId, at)) return ''
  const u = r.units[i], cfg = cfgOf(r)
  const h: HoldRec = { id: uid(), dept: r.dept, date: r.date, runId, lineId: r.lineId, line: r.line, code: r.code, lot: u.lots?.length ? [...new Set(u.lots.map((l) => l.lot))].join(', ') : r.lot, unit: u, n: i + 1, discount, state: 'hold', note: note.trim().slice(0, 300), at: clockNow(), by: user.get(), doneAt: 0, doneBy: '', updatedAt: stamp(undefined) }
  batch(() => {
    putHold(h)
    if (discount) takeOff(runId, at)
    logChange(r.dept, 'Hold · ' + r.code + ' · ' + cfg.unit.toLowerCase() + ' ' + (i + 1) + ' (' + fmtTime(at) + ')', '', (discount ? 'en hold, descontado' : 'en hold, sigue contando') + (h.note ? ' · ' + h.note : ''), HOLD_REF, h.id)
  })
  return h.id
}
/** the office changes its mind: the unit on hold counts again, or is taken off the count */
export function holdSetDiscount(id: string, discount: boolean): boolean {
  const h = (state.holds ?? []).find((x) => x.id === id)
  if (!h || h.deleted || h.state !== 'hold' || h.discount === discount) return false
  let ok = true
  batch(() => {
    if (discount) { takeOff(h.runId, h.unit.at); putHold({ ...h, discount, updatedAt: stamp(h) }) }
    else { const at = putBack(h); if (!at) { ok = false; return } putHold({ ...h, discount, unit: { ...h.unit, at }, updatedAt: stamp(h) }) }
    logChange(h.dept, 'Hold · ' + h.code, h.discount ? 'descontado' : 'sigue contando', discount ? 'descontado' : 'sigue contando', HOLD_REF, h.id + ':' + clockNow())
  })
  return ok
}
/** checked and good: it counts again (back on its run when it was taken off) */
export function holdRelease(id: string): boolean {
  const h = (state.holds ?? []).find((x) => x.id === id)
  if (!h || h.deleted || h.state !== 'hold') return false
  let ok = true
  batch(() => {
    const at = h.discount ? putBack(h) : h.unit.at
    if (!at) { ok = false; return }
    putHold({ ...h, unit: { ...h.unit, at }, state: 'released', doneAt: clockNow(), doneBy: user.get(), updatedAt: stamp(h) })
    logChange(h.dept, 'Hold · ' + h.code, 'en hold', 'liberado: cuenta', HOLD_REF, h.id + ':r')
  })
  return ok
}
/** checked and not good: it does not count (taken off now if it still counted); the hold keeps what it was */
export function holdReject(id: string): boolean {
  const h = (state.holds ?? []).find((x) => x.id === id)
  if (!h || h.deleted || h.state !== 'hold') return false
  batch(() => {
    if (!h.discount) takeOff(h.runId, h.unit.at)
    putHold({ ...h, state: 'rejected', doneAt: clockNow(), doneBy: user.get(), updatedAt: stamp(h) })
    logChange(h.dept, 'Hold · ' + h.code, 'en hold', 'rechazado: no cuenta', HOLD_REF, h.id + ':x')
  })
  return true
}
/** the meat of a day (one code, or all), oldest first */
export const meatsOf = (s: State, date: string, code = '') => (s.meats ?? []).filter((x) => !x.deleted && x.date === date && (!code || normCode(x.code) === normCode(code))).sort((a, b) => a.at - b.at)
/** the weight tests of a day (one code, or all), oldest first */
export const weightTestsOf = (s: State, date: string, code = '') => (s.weights ?? []).filter((x) => !x.deleted && x.date === date && x.entries.length > 0 && (!code || normCode(x.code) === normCode(code))).sort((a, b) => a.at - b.at)
/** a code's target: the finished pouch's weight and how much it may be off (oz), set by a manager or the office (one saved in pounds, before the change to ounces, reads ×16) */
export type WeightTarget = { pouch: number; tol: number }
const targetKey = (code: string, kind: WeightTest['kind'], cook?: Cook) => 'target:' + (kind === 'pouch' ? '' : kind + ':') + (cook ? cook + ':' : '') + normCode(code)
/**
 * QA's "Meatballs / Meatloaf target specifications" sheet (Jose, 2026-10-26), the target every code starts with until
 * a manager sets one with "Objetivo": pouch = oz per bag (the sheet gives no tolerance for the bag: 1 oz until QA says);
 * ball = one cooked meatball, the middle of the sheet's after-cooking range ± half of it (until 2026-10-29 it was 8 balls
 * together, while the window asks for them one by one: every ball read "bajo"). The Excel of the sheet
 * (same day) added 2234, 685, 5017, 4614, 4676, 3293 and 1999, and reads 7093 where the photo read 7053.
 * raw = one meatball before the oven (Kitchen, 2026-10-28), the middle of the sheet's before-cooking range, ± half of it
 */
const QA_TARGETS: Record<string, Partial<Record<WeightTest['kind'], WeightTarget>>> = {
  // 2.4 oz meatballs (Costco Jumbo and the like)
  // (0889 from Yas's Target Specifications, the sheet to follow, Jose 2026-10-30: raw 2.60–2.80 oz, cooked 2.30–2.40 oz a ball)
  // (and the pouch 48–52 oz, never under 48: Jose, 2026-10-29 "48 oz y máximo 52 oz en RTE", "no puede tener mínimo de tolerancia")
  // ('pouched' is not offered: the whiteboard's "pouch Avg 3.0" was the bag, 3 lb = 48 oz, as Santiago's sheet showed the same day)
  '0889': { pouch: { pouch: 50, tol: 2 }, ball: { pouch: 2.35, tol: 0.05 }, raw: { pouch: 2.7, tol: 0.1 } },
  '685': { pouch: { pouch: 48, tol: 1 }, ball: { pouch: 2.35, tol: 0.05 }, raw: { pouch: 2.7, tol: 0.1 } },
  '4139': { pouch: { pouch: 72, tol: 1 }, ball: { pouch: 2.35, tol: 0.05 }, raw: { pouch: 2.7, tol: 0.1 } },
  // 2.2 and 2.0 oz
  '2562': { pouch: { pouch: 72, tol: 1 }, ball: { pouch: 2.2, tol: 0.05 }, raw: { pouch: 2.45, tol: 0.05 } },
  '5000': { pouch: { pouch: 24, tol: 1 }, ball: { pouch: 2, tol: 0.05 }, raw: { pouch: 2.25, tol: 0.05 } },
  '5017': { pouch: { pouch: 24, tol: 1 }, ball: { pouch: 2, tol: 0.05 }, raw: { pouch: 2.25, tol: 0.05 } },
  // 1.1 oz (plain, neutral and stuffed)
  '4911': { pouch: { pouch: 16, tol: 1 }, ball: { pouch: 1.05, tol: 0.05 }, raw: { pouch: 1.25, tol: 0.05 } },
  '4917': { pouch: { pouch: 16, tol: 1 }, ball: { pouch: 1.05, tol: 0.05 }, raw: { pouch: 1.25, tol: 0.05 } },
  '4914': { pouch: { pouch: 16, tol: 1 }, ball: { pouch: 1.05, tol: 0.05 }, raw: { pouch: 1.25, tol: 0.05 } },
  '8441': { pouch: { pouch: 72, tol: 1 }, ball: { pouch: 1.05, tol: 0.05 }, raw: { pouch: 1.25, tol: 0.05 } },
  // (2234 from QA through Jose, 2026-10-29: raw 1.20–1.30, cooked "1.1 1.3 1.4" read as 1.10–1.40 and the pouch 72 oz, never
  // under, its maximum not said yet (76, as the 0889's +4): to be confirmed, and Yas's sheet of 2026-10-30 does not have it; Ajustes › KPI changes them)
  '2234': { pouch: { pouch: 74, tol: 2 }, ball: { pouch: 1.25, tol: 0.15 }, raw: { pouch: 1.25, tol: 0.05 } },
  '3293': { pouch: { pouch: 48, tol: 1 }, ball: { pouch: 1.05, tol: 0.05 }, raw: { pouch: 1.25, tol: 0.05 } },
  '3187': { pouch: { pouch: 72, tol: 1 }, ball: { pouch: 1.05, tol: 0.05 }, raw: { pouch: 1.25, tol: 0.05 } },
  '4955': { pouch: { pouch: 16, tol: 1 }, ball: { pouch: 1.05, tol: 0.05 }, raw: { pouch: 1.25, tol: 0.05 } },
  '3477': { pouch: { pouch: 38, tol: 1 }, ball: { pouch: 1.05, tol: 0.05 }, raw: { pouch: 1.25, tol: 0.05 } },
  // meatloaf and sausage: a bag target only (nobody weighs 8 of them)
  '7093': { pouch: { pouch: 16, tol: 1 } },
  '7130': { pouch: { pouch: 16, tol: 1 } },
  '4614': { pouch: { pouch: 14, tol: 1 } },
  '4676': { pouch: { pouch: 14, tol: 1 } },
  '1999': { pouch: { pouch: 48, tol: 1 } },
}
/**
 * Kitchen writes its mix codes, not the product's, so the sheet seldom knows the code: until a manager sets one, every
 * code there is weighed as the 0889's raw meatball (Jose, 2026-10-28: "ahora mismo vamos a poner que sean las 0889")
 */
const KITCHEN_RAW_DEFAULT: WeightTarget = { pouch: 2.7, tol: 0.1 }
/** the sheet's target of a code however it is written (0889 and 889 are the same code) */
function qaTarget(code: string, kind: WeightTest['kind']) {
  const n = normCode(code), k = Object.keys(QA_TARGETS).find((x) => normCode(x) === n)
  return k ? QA_TARGETS[k][kind] ?? null : null
}
/** a code's target: the one a manager set for this cooker, else for the code, else QA's sheet */
export function weightTarget(s: State, code: string, kind: WeightTest['kind'] = 'pouch', cook?: Cook): WeightTarget | null {
  const d = (cook ? kpiGet(s, targetKey(code, kind, cook))?.data : null) ?? kpiGet(s, targetKey(code, kind))?.data
  if (!d) return qaTarget(code, kind) ?? (kind === 'raw' ? KITCHEN_RAW_DEFAULT : null)
  const per = d?.unit === 'oz' ? 1 : 16, pouch = Number(d?.pouch) * per, tol = Number(d?.tol) * per
  return pouch > 0 ? { pouch: Math.round(pouch * 1000) / 1000, tol: tol >= 0 ? Math.round(tol * 1000) / 1000 : 0 } : null
}
export const setWeightTarget = (code: string, pouch: number, tol: number, kind: WeightTest['kind'] = 'pouch', cook?: Cook) => kpiPut(targetKey(code, kind, cook), { code: code.trim().toUpperCase(), pouch, tol, unit: 'oz', ...(cook ? { cook } : {}) })
/** a target set by a manager taken away: the code goes back to QA's sheet (or to none) */
export const clearWeightTarget = (code: string, kind: WeightTest['kind'] = 'pouch', cook?: Cook) => kpiPut(targetKey(code, kind, cook), { code: code.trim().toUpperCase() }, true)
/**
 * every target there is (Ajustes › KPI, 2026-10-29): QA's sheet, and over it what a manager set (by code, what is
 * weighed and cooker), each with where it comes from; sorted by code, then pouch, raw, cooked
 */
/**
 * whether a target of the table above is QA's own (Jose, 2026-10-29: "¿de dónde sacaste estos datos?"): the raw and cooked
 * ranges are the sheet's; a bag's range is not (the sheet says only its ounces: ±1 was put to have one), but the 0889's
 * 48–52 QA gave; the 2234's cooked range and its bag's maximum were read from words still to be confirmed
 */
export const qaSure = (code: string, kind: WeightTest['kind']) => { const n = normCode(code); return n === '2234' || kind === 'pouched' ? false : kind === 'pouch' ? n === '889' : true }
/**
 * a target the reports judge by: a sure one of the table, one a manager wrote, or the 2234's as Ajustes › KPI shows them
 * (Jose, 2026-10-30: Yas's sheet does not have it, "coge los datos que salen en el KPI y cuando se tenga que cambiar yo
 * lo cambio"; they stay marked to confirm there)
 */
export const wtOfficial = (s: State, code: string, kind: WeightTest['kind']) => qaSure(code, kind) || normCode(code) === '2234' || !!kpiGet(s, targetKey(code, kind))
/** sure: QA said it (always for one a manager set); false = an estimate of the table, to ask QA for */
export type WtTargetRow = { code: string; step: WtStep; target: WeightTarget; qa: WeightTarget | null; set: { by: string; at: number } | null; sure: boolean }
export function weightTargetsList(s: State): WtTargetRow[] {
  const rows = new Map<string, WtTargetRow>()
  const key = (code: string, st: WtStep) => normCode(code) + '|' + stepKey(st)
  for (const [code, kinds] of Object.entries(QA_TARGETS)) for (const [kind, t] of Object.entries(kinds) as [WeightTest['kind'], WeightTarget][]) rows.set(key(code, { kind }), { code, step: { kind }, target: t, qa: t, set: null, sure: qaSure(code, kind) })
  for (const x of s.kpi ?? []) {
    if (x.deleted || !x.key.startsWith('target:')) continue
    const parts = x.key.slice('target:'.length).split(':'), kind: WeightTest['kind'] = parts.length > 1 && (parts[0] === 'raw' || parts[0] === 'ball' || parts[0] === 'pouched') ? parts[0] : 'pouch'
    const cook = parts.length > 2 && (parts[1] === 'spiral' || parts[1] === 'racks') ? parts[1] : undefined, code = String(x.data.code ?? parts[parts.length - 1])
    const st: WtStep = { kind, ...(cook ? { cook } : {}) }, t = weightTarget(s, code, kind, cook)
    if (!t) continue
    const was = rows.get(key(code, st))
    rows.set(key(code, st), { code: was?.code ?? code, step: st, target: t, qa: was?.qa ?? null, set: { by: x.by, at: x.at }, sure: true })
  }
  const order = (st: WtStep) => ['pouch', 'pouched', 'raw', 'ball'].indexOf(st.kind) * 3 + (st.cook ? COOKS.indexOf(st.cook) + 1 : 0)
  return [...rows.values()].sort((a, b) => normCode(a.code).localeCompare(normCode(b.code), 'en', { numeric: true }) || order(a.step) - order(b.step))
}
/**
 * How often a room weighs, and how many each time (2026-10-23: Spiral, "que le salga cada hora que pesen 8 bolas", and
 * "que se pueda ajustar en Ajustes"): every = minutes between tests (0 = no reminder), count = how many per test. Under
 * 'opt:wt:<room>' in act_targets (per_hour = every, per_shift = count), as the other settings; Spiral is 60 and 8 until
 * a manager says otherwise
 */
export type WeightRule = { dept: Dept; every: number; count: number; updatedAt: number }
const WRULE_KEY = 'opt:wt:'
// (2026-10-29: Spiral and RTE weigh 10 every hour, Jose: "medir 10 bolas", "every hour pesar 10 pouches en RTE"; Kitchen as it was)
export const WEIGHT_RULE_DEFAULT: Partial<Record<Dept, { every: number; count: number }>> = { Spiral: { every: 60, count: 10 }, RTE: { every: 60, count: 10 }, Kitchen: { every: 60, count: 8 } }
export const weightRuleOf = (s: State, dept: Dept) => { const r = (s.weightRules ?? []).find((x) => x.dept === dept); return r ? { every: r.every, count: r.count } : WEIGHT_RULE_DEFAULT[dept] ?? { every: 0, count: 0 } }
export function setWeightRule(dept: Dept, every: number, count: number) {
  const e = Math.max(0, Math.round(every)), c = Math.max(0, Math.round(count)), was = (state.weightRules ?? []).find((x) => x.dept === dept), before = weightRuleOf(state, dept)
  if (was && before.every === e && before.count === c) return
  const x: WeightRule = { dept, every: e, count: c, updatedAt: stamp(was) }
  set({ ...state, weightRules: [...(state.weightRules ?? []).filter((y) => y !== was), x] })
  push('act_targets', WRULE_KEY + dept, { dept: WRULE_KEY + dept, per_hour: e, per_shift: c, updated_at: iso(x.updatedAt), updated_by: user.get() })
  logChange(dept, 'Pesos · ' + dept, before.every + ' min · ' + before.count, e + ' min · ' + c, 'act_targets', WRULE_KEY + dept)
}
/**
 * The codes a room's hourly test is for (Jose, 2026-10-29: Spiral "el 0889 ... siempre y cuando se está haciendo este
 * código", and "RTE también es 0889 solamente"): the reminder and the KPI's count of tests due follow them; the ⚖ Peso
 * button stays on every code. null = every code (Kitchen, as it was). A manager changes them in Ajustes › Pesos (key
 * 'wt-codes:<room>' of the report's records, which every tablet reads)
 */
// (2234 too, Jose 2026-10-29: "de este código también me pidieron")
export const WEIGHT_CODES_DEFAULT: Partial<Record<Dept, string[]>> = { Spiral: ['0889', '2234'], RTE: ['0889', '2234'] }
/**
 * each code a room weighs, with how often and how many (Jose, 2026-10-29: in Ajustes › KPI "agregar diferente código,
 * hora y cantidad ... y así no tener que venir aquí de nuevo"): its own minutes and count when a manager gave them,
 * else the room's rule. null = every code, with the room's rule (Kitchen). kinds (Jose, 2026-10-30: "poner o elegir si
 * es cocinada o cruda, para todos los departamentos"): what is weighed of it, raw and/or cooked (RTE also its pouches)
 */
export type WtKind = WeightTest['kind']
export type WtCodeRule = { code: string; every: number; count: number; kinds: WtKind[] }
/** what a room can be asked to weigh, in the order the screens say it */
export const wtKindsOf = (dept: Dept): WtKind[] => (dept === 'RTE' ? ['pouch', 'raw', 'ball'] : dept === 'Spiral' || dept === 'Kitchen' ? ['raw', 'ball'] : [])
// (Kitchen's are cooked, its manager through Jose, 2026-10-30)
const WT_KINDS_DEFAULT: Partial<Record<Dept, WtKind[]>> = { Spiral: ['raw', 'ball'], RTE: ['pouch'], Kitchen: ['ball'] }
/** the codes the plant's heads ask to see weighed (Jose, 2026-10-30: "ahora mismo solo nos están pidiendo dos códigos") */
export const WT_ASKED_CODES = ['0889', '2234']
export const wtAsked = (code: string) => WT_ASKED_CODES.some((c) => normCode(c) === normCode(code))
/**
 * Kitchen runs its mix codes (2286), not the product's, so what it weighs would fall under neither of those: its window
 * asks which of them the balls are (Jose, 2026-10-30: "tenemos que poner los códigos", "falta Kitchen"), and a mix code
 * takes the rule of the first of them. Never guessed: the operator picks it
 */
export const wtPicksCode = (dept: Dept, code: string) => dept === 'Kitchen' && !wtAsked(code)
const ruleCode = (dept: Dept, code: string) => (wtPicksCode(dept, code) ? WT_ASKED_CODES[0] : code)
const cleanKinds = (dept: Dept, v: unknown): WtKind[] => { const l = wtKindsOf(dept).filter((k) => Array.isArray(v) && v.includes(k)); return l.length ? l : WT_KINDS_DEFAULT[dept] ?? [] }
/** what a room weighs of a code it does not list one by one (of every code, where it weighs them all) */
export const weightRoomKinds = (s: State, dept: Dept) => cleanKinds(dept, kpiGet(s, 'wt-codes:' + dept)?.data.kinds)
export function weighedRules(s: State, dept: Dept): WtCodeRule[] | null {
  const d = kpiGet(s, 'wt-codes:' + dept)?.data, room = weightRuleOf(s, dept)
  const list = d && Array.isArray(d.codes) ? d.codes.map(String).filter(Boolean) : WEIGHT_CODES_DEFAULT[dept] ?? null
  if (!list || !list.length) return null
  const rules = (d?.rules && typeof d.rules === 'object' ? d.rules : {}) as Record<string, { every?: unknown; count?: unknown; kinds?: unknown }>
  const n = (v: unknown, or: number) => (Number.isInteger(Number(v)) && Number(v) >= 0 && v !== null && v !== '' ? Number(v) : or)
  // (a code weighed every hour always weighs some: a room's count of 0, from the old settings, reads as 10)
  return list.map((code) => { const r = rules[normCode(code)], count = n(r?.count, room.count); return { code, every: n(r?.every, room.every), count: count > 0 ? count : 10, kinds: r?.kinds ? cleanKinds(dept, r.kinds) : weightRoomKinds(s, dept) } })
}
export const weighedCodes = (s: State, dept: Dept): string[] | null => weighedRules(s, dept)?.map((x) => x.code) ?? null
export const weighsCode = (s: State, dept: Dept, code: string) => { const c = weighedCodes(s, dept), n = normCode(ruleCode(dept, code)); return !c || c.some((x) => normCode(x) === n) }
/** how often and how many a code is weighed: its own when its room lists it, else the room's */
export const weightRuleFor = (s: State, dept: Dept, code: string) => { const n = normCode(ruleCode(dept, code)), r = weighedRules(s, dept)?.find((x) => normCode(x.code) === n); return r ? { every: r.every, count: r.count } : weightRuleOf(s, dept) }
/** the codes a room weighs, each with its minutes and count (a plain code takes the room's); none = every code */
export function setWeighedCodes(dept: Dept, rows: (string | (Omit<WtCodeRule, 'kinds'> & { kinds?: WtKind[] }))[]) {
  const list = rows.map((x) => (typeof x === 'string' ? { code: x } : x)).map((x) => ({ ...x, code: x.code.trim().toUpperCase() })).filter((x) => x.code)
  const seen = new Set<string>(), codes: string[] = [], rules: Record<string, { every: number; count: number; kinds?: WtKind[] }> = {}
  for (const x of list) {
    if (seen.has(normCode(x.code))) continue
    seen.add(normCode(x.code)); codes.push(x.code)
    if ('every' in x) rules[normCode(x.code)] = { every: Math.max(0, Math.round(x.every)), count: Math.max(0, Math.round(x.count)), ...(x.kinds ? { kinds: cleanKinds(dept, x.kinds) } : {}) }
  }
  const was = kpiGet(state, 'wt-codes:' + dept)?.data.kinds
  kpiPut('wt-codes:' + dept, { ...(was ? { kinds: was } : {}), codes, rules })
}
/** what a room weighs of every code, where it does not list them (its list, if it has one, stays) */
export const setWeightRoomKinds = (dept: Dept, kinds: WtKind[]) => kpiPut('wt-codes:' + dept, { ...kpiGet(state, 'wt-codes:' + dept)?.data, kinds: cleanKinds(dept, kinds) })
/**
 * What a room weighs each time (2026-10-29): Spiral, the balls raw before each cooker and cooked out of it (Spiral and
 * Racks: four tests an hour); RTE its finished pouches; Kitchen its raw balls. Those are the defaults: Ajustes › KPI
 * says raw, cooked or both per code (2026-10-30), and Spiral weighs what was chosen at each cooker
 */
export type WtStep = { kind: WeightTest['kind']; cook?: Cook }
const stepsOfKinds = (dept: Dept, kinds: WtKind[]): WtStep[] => (dept === 'Spiral' ? COOKS.flatMap((cook) => kinds.map((kind) => ({ kind, cook }))) : kinds.map((kind) => ({ kind })))
/** a room's usual steps, as nobody chose otherwise */
export const weightStepsOf = (dept: Dept): WtStep[] => stepsOfKinds(dept, WT_KINDS_DEFAULT[dept] ?? [])
/** every step a room could weigh, in the order the report says them */
export const weightAllStepsOf = (dept: Dept) => stepsOfKinds(dept, wtKindsOf(dept))
/** the steps of a code in a room: what Ajustes says of it, or of the room */
export const weightStepsFor = (s: State, dept: Dept, code: string) => { const n = normCode(ruleCode(dept, code)); return stepsOfKinds(dept, weighedRules(s, dept)?.find((x) => normCode(x.code) === n)?.kinds ?? weightRoomKinds(s, dept)) }
export const stepKey = (x: WtStep) => x.kind + (x.cook ? ':' + x.cook : '')
export const sameStep = (x: WtStep, y: WtStep) => x.kind === y.kind && (x.cook ?? '') === (y.cook ?? '')
/** a cooker's name as the floor says it */
export const cookText = (c: Cook) => (c === 'racks' ? 'Racks' : 'Spiral')
/** what a step weighs, as the screens and the files say it: "Crudo · Racks", "Cocinado · Spiral", "Pouch" */
export const stepText = (x: WtStep) => (x.kind === 'pouch' ? tr('Pouch') : x.kind === 'pouched' ? tr('Bola en pouch') : (x.kind === 'raw' ? tr('Crudo') : tr('Cocinado')) + (x.cook ? ' · ' + cookText(x.cook) : ''))
// ---- the slow-line signal (Jose, 2026-10-28: "que parpadee la línea que no esté haciendo 1000 pouches por hora", "es algo más símbolo que un dato": the card goes red and back so the people know they have to move) ----
/**
 * A room's minimum per hour (0 = no signal), set in Ajustes for everybody; under 'opt:slow:<room>' in act_targets
 * (per_hour = the minimum), as the other switches. RTE starts at 1000 pouches an hour, Jose's number; the rest at 0
 * until a manager writes theirs (Jose, 2026-10-28: "para todos los departamentos, igual que se pueda apagar y editar,
 * y que hable el idioma de cada departamento": each room counts in its own word, slowUnitOf).
 * Each line can be left out ('opt:slowln:<line id>', per_hour 0 = off, 1 = on): "elegir las líneas que queramos".
 */
export type SlowRule = { dept: Dept; perHour: number; updatedAt: number }
export type SlowLine = { lineId: string; off: boolean; updatedAt: number }
const SLOW_KEY = 'opt:slow:', SLOWLN_KEY = 'opt:slowln:'
export const SLOW_DEFAULT: Partial<Record<Dept, number>> = { RTE: 1000 }
/** the word a room's minimum is counted in: what the room counts (mezclas, pouches, platos, cajas) */
export const slowUnitOf = (dept: Dept) => (CFG[dept].qty === 'none' ? CFG[dept].plural.toLowerCase() : CFG[dept].qtyUnit)
/** whether a code is counted in its room's own word (a Spiral mix in pounds, an MFO bin of copas or lb, a Packing bin are not: the room's number says nothing about them) */
export const slowCounts = (r: Pick<Run, 'dept' | 'extra'>) => { const c = cfgOf(r); return c.qty === CFG[r.dept].qty && c.qtyUnit === CFG[r.dept].qtyUnit }
/** the room's minimum per hour, 0 when the signal is off there */
export const slowRuleOf = (s: State, dept: Dept) => { const r = (s.slowRules ?? []).find((x) => x.dept === dept); return r ? r.perHour : SLOW_DEFAULT[dept] ?? 0 }
export function setSlowRule(dept: Dept, perHour: number) {
  const n = Math.max(0, Math.round(perHour)), was = (state.slowRules ?? []).find((x) => x.dept === dept), before = slowRuleOf(state, dept)
  if (was && before === n) return
  const x: SlowRule = { dept, perHour: n, updatedAt: stamp(was) }
  set({ ...state, slowRules: [...(state.slowRules ?? []).filter((y) => y !== was), x] })
  push('act_targets', SLOW_KEY + dept, { dept: SLOW_KEY + dept, per_hour: n, per_shift: null, updated_at: iso(x.updatedAt), updated_by: user.get() })
  logChange(dept, 'Ritmo mínimo · ' + dept, before ? before + ' por hora' : 'apagado', n ? n + ' por hora' : 'apagado', 'act_targets', SLOW_KEY + dept)
}
/** whether the signal is on for this line (on unless a manager turned it off) */
export const slowLineOn = (s: State, lineId: string) => !(s.slowLines ?? []).some((x) => x.lineId === lineId && x.off)
export function setSlowLineOn(line: Line, on: boolean) {
  const was = (state.slowLines ?? []).find((x) => x.lineId === line.id)
  if (slowLineOn(state, line.id) === on) return
  const x: SlowLine = { lineId: line.id, off: !on, updatedAt: stamp(was) }
  set({ ...state, slowLines: [...(state.slowLines ?? []).filter((y) => y !== was), x] })
  push('act_targets', SLOWLN_KEY + line.id, { dept: SLOWLN_KEY + line.id, per_hour: on ? 1 : 0, per_shift: null, updated_at: iso(x.updatedAt), updated_by: user.get() })
  logChange(line.dept, 'Ritmo mínimo · ' + line.name + ' (' + line.dept + ')', on ? 'apagado' : 'prendido', on ? 'prendido' : 'apagado', 'act_targets', SLOWLN_KEY + line.id)
}
/** a line's minimum per hour: the room's, when the signal is on for the line; 0 = none */
export const slowLimitOf = (s: State, line: Line) => (slowLineOn(s, line.id) ? slowRuleOf(s, line.dept) : 0)
const SLOW_WINDOW_MS = 3_600_000
/**
 * What the line made in its last hour of work, per hour: the quantity of the units recorded in the last 60 minutes
 * of running time (the line's stops, and the room's, are left out: the window reaches back past them). Null while
 * the code has less than an hour of work (nothing to judge yet: a mix or a pallet takes a while, and a 15-minute
 * guess called every code slow at its start), while the line is stopped or in a set up (it has its own colour), or
 * when the code is not running.
 */
export function slowRateOf(s: State, r: Run, now: number): number | null {
  if (r.endedAt || now - r.startedAt < SLOW_WINDOW_MS) return null
  const stops = s.stops.filter((x) => !x.deleted && (x.lineId === r.lineId || (x.lineId === null && x.dept === r.dept)) && x.startedAt < now && x.startedAt >= r.startedAt)
  if (stops.some((x) => x.endedAt == null)) return null
  const downFrom = (from: number) => stops.reduce((t, x) => t + Math.max(0, Math.min(now, x.endedAt ?? now) - Math.max(from, x.startedAt)), 0)
  // the window: 60 minutes of work, so it starts earlier by what was stopped inside it (settles in a few turns)
  let from = now - SLOW_WINDOW_MS
  for (let i = 0; i < 20; i++) { const next = Math.max(r.startedAt, now - SLOW_WINDOW_MS - downFrom(from)); if (next === from) break; from = next }
  const ms = now - from - downFrom(from)
  if (ms < SLOW_WINDOW_MS - 1000) return null
  const qty = r.units.filter((u) => u.at >= from && u.at <= now).reduce((t, u) => t + (CFG[r.dept].qty === 'none' ? 1 : unitQty(s, r, u)), 0)
  return qty / (ms / 3_600_000)
}
/** the signal: the line is running under its minimum (null = nothing to say) */
export function lineSlow(s: State, line: Line, r: Run, now: number): { rate: number; limit: number } | null {
  const limit = slowLimitOf(s, line)
  if (!limit || !slowCounts(r)) return null
  const rate = slowRateOf(s, r, now)
  return rate != null && rate < limit ? { rate, limit } : null
}
/**
 * when a step of a line's weighing is due next: the room's rule, from the code's start or the line's last test of that
 * step that day (one with weights, or a cooker said not used); null = no reminder (no rule, or a code the room does not
 * weigh every hour)
 */
export function stepDueAt(s: State, r: Run, step: WtStep): number | null {
  const rule = weightRuleFor(s, r.dept, r.code)
  if (!rule.every || !weighsCode(s, r.dept, r.code)) return null
  const last = (s.weights ?? []).filter((x) => !x.deleted && x.lineId === r.lineId && x.date === r.date && (x.entries.length > 0 || x.skip) && sameStep(x, step)).reduce((t, x) => Math.max(t, x.at), 0)
  return Math.max(r.startedAt, last) + rule.every * 60_000
}
/** when a line's next weight test is due (the first of its steps); null = no reminder */
export function weightDueAt(s: State, r: Run): number | null {
  const all = weightStepsFor(s, r.dept, r.code).map((x) => stepDueAt(s, r, x)).filter((x): x is number => x != null)
  return all.length ? Math.min(...all) : null
}
/** the steps of a line's weighing that are due now */
export const weightDueSteps = (s: State, r: Run, now: number) => weightStepsFor(s, r.dept, r.code).filter((x) => { const d = stepDueAt(s, r, x); return d != null && now >= d })
/** the test of a step done within the room's time on this line (complete, half-way, or a cooker not used); null = none yet */
export function weightThisHour(s: State, r: Run, step: WtStep, now: number): WeightTest | null {
  const rule = weightRuleFor(s, r.dept, r.code), span = (rule.every || 60) * 60_000
  return (s.weights ?? []).filter((y) => !y.deleted && y.lineId === r.lineId && y.date === r.date && sameStep(y, step) && (y.entries.length > 0 || y.skip) && now - y.at < span && y.at >= r.startedAt).sort((a, b) => b.at - a.at)[0] ?? null
}
/**
 * the test of a step a line is in the middle of: this hour's, when it has fewer weights than the room's count, so a
 * window closed half-way goes on with the same test (2026-10-29)
 */
export function weightOpen(s: State, r: Run, step: WtStep, now: number): WeightTest | null {
  const x = weightThisHour(s, r, step, now), count = weightRuleFor(s, r.dept, r.code).count
  return x && !x.skip && x.runId === r.id && count > 0 && x.entries.length < count ? x : null
}
/** a target as QA says it, its lightest and heaviest (2026-10-29: "48 oz y máximo 52 oz"): "48–52" */
export const wtRange = (t: WeightTarget) => ({ min: Math.round((t.pouch - t.tol) * 1000) / 1000, max: Math.round((t.pouch + t.tol) * 1000) / 1000 })
export const wtRangeText = (t: WeightTarget | null) => { if (!t) return ''; const r = wtRange(t); return r.min + '–' + r.max }
/** a weight against the target: under, ok or over ('' without a target) */
export const weightClass = (w: number, t: WeightTarget | null): '' | 'bajo' | 'ok' | 'sobre' => (!t ? '' : w < t.pouch - t.tol - 1e-9 ? 'bajo' : w > t.pouch + t.tol + 1e-9 ? 'sobre' : 'ok')
/** an entry: the operator's call when they made one, else its weight against the target */
// (a weight typed decides by itself against the target since 2026-10-29: in the first window RTE typed the weight and also
// tapped ▲/▼ by the old target, and the KPI read every pouch as under or over, "0% en peso" with an average of 48.5; the
// operator's mark counts only for a pouch with no weight, or with no target)
export const entryClass = (e: WtEntry, t: WeightTarget | null): '' | 'bajo' | 'ok' | 'sobre' => (e.w != null && t ? weightClass(e.w, t) : e.k ?? (e.w != null ? weightClass(e.w, t) : ''))
/** the shifts a day works (a day of one shift: that one alone) */
export const attShifts = (s: State, date: string): (1 | 2)[] => { const o = shiftsOf(s, date).only; return o === 1 || o === 2 ? [o] : [1, 2] }
/**
 * Each room's attendance of a day, for one shift (or the day's shifts added up: 0), as Santiago's sheet: expected,
 * actual (written and not gone), missing and its share (never below 0; more people than expected is 0% and said apart)
 */
/** pct = the share missing; att = the share that came (actual / expected, over 1 when more came than expected; Jose, 2026-10-27) */
export type AttRow = { dept: Dept; expected: number; actual: number; miss: number; pct: number; att: number; over: number; gone: number }
export function attendanceOf(s: State, date: string, shift: 0 | 1 | 2, rooms: Dept[] = DEPTS): { rows: AttRow[]; total: AttRow } {
  const shifts = shift ? [shift] : attShifts(s, date)
  const rows = rooms.map((dept) => {
    let expected = 0, actual = 0, gone = 0
    for (const k of shifts) { expected += attExpectedOf(s, dept, k); const l = attOf(s, date, dept, k); actual += l.filter((x) => !x.gone).length; gone += l.filter((x) => !!x.gone).length }
    const miss = Math.max(0, expected - actual)
    return { dept, expected, actual, miss, pct: expected ? miss / expected : 0, att: expected ? actual / expected : 0, over: Math.max(0, actual - expected), gone }
  })
  const e = rows.reduce((t, r) => t + r.expected, 0), a = rows.reduce((t, r) => t + r.actual, 0), m = rows.reduce((t, r) => t + r.miss, 0)
  return { rows, total: { dept: 'Kitchen', expected: e, actual: a, miss: m, pct: e ? m / e : 0, att: e ? a / e : 0, over: rows.reduce((t, r) => t + r.over, 0), gone: rows.reduce((t, r) => t + r.gone, 0) } }
}
/**
 * Attendance for everybody (Jose, 2026-10-21: "que la parte de attendance esté oculta por ahora, y que yo pueda
 * activarla más luego"). Off: only the admin sees it (the floor's card, the report's table, its files and its Ajustes),
 * to try it and show it; on: every room. Off or on, nothing written is lost. As the Programa del día switch.
 */
/**
 * Tabs turned on for everybody from Ajustes (Jose, 2026-10-22): Lotes (the new chain of each lot, the admin's alone
 * until then) and Flujo (the office's old sheet, which nobody used: off, the admin keeps it, and it comes back with a
 * tap). Under 'opt:view:<name>' in act_targets, as the other switches; in the history
 */
export type ViewOpt = 'lotes' | 'flujo'
const OPT_VIEW = 'opt:view:'
const VIEW_NAMES: Record<ViewOpt, string> = { lotes: 'Pestaña Lotes', flujo: 'Pestaña Flujo' }
export function setViewOpt(name: ViewOpt, on: boolean) {
  const was = state.viewOpts[name]
  if (was.on === on) return
  const next: ReasonCodesOpt = { on, updatedAt: stamp(was) }
  set({ ...state, viewOpts: { ...state.viewOpts, [name]: next } })
  push('act_targets', OPT_VIEW + name, { dept: OPT_VIEW + name, per_hour: on ? 1 : 0, per_shift: null, updated_at: iso(next.updatedAt), updated_by: user.get() })
  logChange(null, VIEW_NAMES[name], was.on ? 'para todos' : 'solo el admin', on ? 'para todos' : 'solo el admin', 'act_targets', OPT_VIEW + name)
}
const OPT_ATT = 'opt:attview'
const attText = (on: boolean) => (on ? 'para todos' : 'solo el admin')
export function setAttView(on: boolean) {
  const was = state.attView
  if (was.on === on) return
  const next: ReasonCodesOpt = { on, updatedAt: stamp(was) }
  set({ ...state, attView: next })
  push('act_targets', OPT_ATT, { dept: OPT_ATT, per_hour: on ? 1 : 0, per_shift: null, updated_at: iso(next.updatedAt), updated_by: user.get() })
  logChange(null, 'Asistencia', attText(was.on), attText(on), 'act_targets', OPT_ATT)
}
/**
 * Attendance before starting (Jose, 2026-10-27: "restricciones en todos los departamentos para que ingresen la
 * asistencia antes de que comiencen a iniciar las máquinas o líneas ... para los supervisores, no para las oficinas,
 * manager o solo ver"). On, a supervisor cannot start a code or a Set up on a line until the room's attendance of the
 * shift in course has at least one person written (each shift its own); the start opens the attendance window
 * instead. Under 'opt:attgate' in act_targets, as the other switches (only the managers and the office write it); it
 * asks nothing while the attendance is hidden (attView off: nobody could write it)
 */
/**
 * The crates an RTE cart holds, for the whole plant (Jose, 2026-10-28: "una opción en Ajustes de elegir 24 o 26 u otro
 * número ... así no tengo que venir aquí siempre"): what a code with no figure of its own uses, and what "Poner en
 * todos los códigos" writes into Productos. Under 'opt:crates' in act_targets (per_hour = the number), as the other
 * switches; 0 = never set (the app's own figure, CRATES_PER_CART)
 */
const OPT_CRATES = 'opt:crates'
export const cartCratesOf = (s: State) => s.cartCrates.n || CRATES_PER_CART
export function setCartCrates(n: number) {
  const k = Math.round(n)
  if (!(k >= 1 && k <= 200) || state.cartCrates.n === k) return
  const was = cartCratesOf(state)
  const next = { n: k, updatedAt: stamp(state.cartCrates) }
  set({ ...state, cartCrates: next })
  push('act_targets', OPT_CRATES, { dept: OPT_CRATES, per_hour: k, per_shift: null, updated_at: iso(next.updatedAt), updated_by: user.get() })
  logChange('RTE', 'Guacales por carro', String(was), String(k), 'act_targets', OPT_CRATES)
}
/** every code of Productos gets this many crates per cart (the ones that already say it are left alone); how many changed */
export function setAllCartCrates(n: number): number {
  const k = Math.round(n)
  if (!(k >= 1 && k <= 200)) return 0
  let changed = 0
  batch(() => {
    state.products.forEach((p, i) => { if (!p.deleted && p.cratesPerCart !== k && saveProduct(i, { ...p, cratesPerCart: k })) changed++ })
  })
  return changed
}
// ---- pounds per case (QA's sheet, photo 2026-10-26 and its Excel; Jose, 2026-10-28: "carga las libras por caja igual que los guacales, y que yo lo pueda prender y apagar") ----
/** QA's pounds per case by code, as its "target specifications" sheet says; Productos wins when it says its own */
export const QA_LB_PER_CASE: Record<string, number> = { '0889': 24, '4911': 6, '4917': 6, '4914': 6, '7093': 12.5, '5000': 9, '2562': 27, '8441': 9, '7130': 12.5, '3477': 4, '3187': 9, '4955': 6, '4139': 27, '2234': 27, '685': 24, '0685': 24, '5017': 9, '4614': 5.25, '4676': 5.25, '3293': 36, '1999': 24 }
export const lbPerCaseOf = (s: State, code: string) => productOf(s, code)?.lbPerCase || QA_LB_PER_CASE[normCode(code)] || QA_LB_PER_CASE[code.trim()] || 0
/** QA's pounds written into every code of Productos the sheet has (a code already saying the same is left alone); how many changed */
export function loadQaLbPerCase(): number {
  let changed = 0
  batch(() => {
    state.products.forEach((p, i) => { const lb = QA_LB_PER_CASE[normCode(p.code)] ?? QA_LB_PER_CASE[p.code.trim()]; if (!p.deleted && lb && p.lbPerCase !== lb && saveProduct(i, { ...p, lbPerCase: lb })) changed++ })
  })
  return changed
}
/** the switch: with it on, the KPI's productivity is also said in pounds per labor hour (opt:lbcase in act_targets, as the other switches) */
/**
 * The time each person takes off that is not worked (Jose, 2026-10-29, the boss's input/output: the labor hours with
 * the lunch taken away), for the whole plant: so many minutes, taken from each one who stayed at least so many hours
 * (after; 0 = everyone). Under 'opt:lunch' in act_targets (per_hour = the minutes, per_shift = the hours); 0 minutes =
 * nothing taken away, as at first
 */
export type Lunch = { min: number; after: number; updatedAt: number }
const OPT_LUNCH = 'opt:lunch'
export const lunchOf = (s: State) => s.lunch ?? { min: 0, after: 0, updatedAt: 0 }
export function setLunch(min: number, after: number) {
  const m = Math.round(min), a = Math.round(after * 10) / 10
  if (!(m >= 0 && m <= 240) || !(a >= 0 && a <= 24)) return
  const was = lunchOf(state)
  if (was.min === m && was.after === a) return
  const next = { min: m, after: a, updatedAt: stamp(state.lunch) }
  set({ ...state, lunch: next })
  push('act_targets', OPT_LUNCH, { dept: OPT_LUNCH, per_hour: m, per_shift: a, updated_at: iso(next.updatedAt), updated_by: user.get() })
  const said = (x: { min: number; after: number }) => (x.min ? x.min + ' min' + (x.after ? ' · ' + x.after + ' h' : '') : 'nada')
  logChange(null, 'Lunch que no se cuenta', said(was), said(next), 'act_targets', OPT_LUNCH)
}
/**
 * The hour a person is written is the hour they came (Jose, 2026-10-29: "el supervisor tomó la asistencia desde que lo
 * ve, lo anota; no lo anota si aún no lo ha visto"): on, each one's hours count from when they were written, unless the
 * supervisor wrote the hour they came; off (as at first), from the shift's start. Under 'opt:attwrite' in act_targets
 */
const OPT_ATTWRITE = 'opt:attwrite'
export const attWriteOn = (s: State) => !!s.attWrite?.on
export function setAttWriteOn(on: boolean) {
  const was = s0(state.attWrite)
  if (was.on === on) return
  const next = { on, updatedAt: stamp(state.attWrite) }
  set({ ...state, attWrite: next })
  push('act_targets', OPT_ATTWRITE, { dept: OPT_ATTWRITE, per_hour: on ? 1 : 0, per_shift: null, updated_at: iso(next.updatedAt), updated_by: user.get() })
  logChange(null, 'La hora en que se anota es la hora de llegada', was.on ? 'prendido' : 'apagado', on ? 'prendido' : 'apagado', 'act_targets', OPT_ATTWRITE)
}
const s0 = (x: ReasonCodesOpt | undefined) => x ?? { on: false, updatedAt: 0 }
/**
 * a person written by hand in a room another room had sent them to that shift (Jose, 2026-10-29): when they were sent
 * (0 = nobody sent them), so their hours here count from then and the hours before stay with the room they came from
 */
export function attSentAt(s: State, x: AttEntry): number {
  if (x.via || x.from) return 0
  const k = attKey(x.name)
  const src = (s.attendance ?? []).filter((y) => !y.deleted && y.id !== x.id && y.date === x.date && y.shift === x.shift && y.dept !== x.dept && y.gone?.why === 'otro' && y.gone.to === x.dept && attKey(y.name) === k)
  return src.length ? Math.min(...src.map((y) => y.gone?.at ?? 0)) : 0
}
const OPT_LB = 'opt:lbcase'
export const lbCaseOn = (s: State) => s.lbCase.on
export function setLbCaseOn(on: boolean) {
  const was = state.lbCase
  if (was.on === on) return
  const next: ReasonCodesOpt = { on, updatedAt: stamp(was) }
  set({ ...state, lbCase: next })
  push('act_targets', OPT_LB, { dept: OPT_LB, per_hour: on ? 1 : 0, per_shift: null, updated_at: iso(next.updatedAt), updated_by: user.get() })
  logChange(null, 'Libras por caja en el KPI', was.on ? 'prendido' : 'apagado', on ? 'prendido' : 'apagado', 'act_targets', OPT_LB)
}
const OPT_ATTGATE = 'opt:attgate'
const gateText = (on: boolean) => (on ? 'obligatoria para empezar' : 'no obligatoria')
export function setAttGate(on: boolean) {
  const was = state.attGate
  if (was.on === on) return
  const next: ReasonCodesOpt = { on, updatedAt: stamp(was) }
  set({ ...state, attGate: next })
  push('act_targets', OPT_ATTGATE, { dept: OPT_ATTGATE, per_hour: on ? 1 : 0, per_shift: null, updated_at: iso(next.updatedAt), updated_by: user.get() })
  logChange(null, 'Asistencia obligatoria para empezar', gateText(was.on), gateText(on), 'act_targets', OPT_ATTGATE)
}
/**
 * must the person on this device write the room's attendance of this shift before starting a code or a Set up there?
 * (a supervisor, and the room's supervisor or leader not written as such yet: "que el líder o el supervisor se anote a
 * sí mismo como supervisor", 2026-10-27)
 */
export function attGated(s: State, dept: Dept, date: string, shift: 1 | 2): boolean {
  if (!s.attGate.on || !s.attView.on || role.get() !== 'op' || !!viewOnly.get()) return false
  // the supervisor written as such, and at least one worker (Jose, 2026-10-28: "el supervisor se tiene que apuntar
  // pero él no cuenta para empezar, aunque sí cuenta para el attendance"); how many are needed is never said
  const here = attOf(s, date, dept, shift).filter((x) => !x.gone)
  return !here.some((x) => x.sup) || !here.some((x) => !x.sup)
}
/** the reason of the stop the app writes by itself when a line finishes a code and another one is coming */
export const SETUP = 'Set up'
/** a line left without a code for longer than this was not being set up: it was simply not in use */
export const SETUP_MAX_MS = 6 * 3_600_000
const AFTER = 'Después de '
/**
 * A line with no code on it is waiting for the next one. What was left open there when its last code ended (its set
 * up, or the cause a manager gave to part of that time) is a stop only once that next code starts: the tablet cannot
 * tell whether anybody is still at the line, and people go home without saying so. While it waits it is on the line's
 * card with its clock, and in no report and no total. If no code comes, it never counted.
 */
export const waitsForCode = (s: State, x: Stop) => !x.endedAt && x.lineId !== null && !s.runs.some((r) => r.lineId === x.lineId && !r.endedAt)
/** what waits on a line is of its day of work: the first code of the next morning does not close last night's set up, it drops it */
const fromOtherDay = (s: State, x: Stop, at: number) => plainDay(s, x.startedAt) !== plainDay(s, at)
/**
 * What a line between two codes is waiting with: the set up written when its last code ended (or the cause a manager
 * gave to part of that time), while it is still open, of the day of work in course and recent enough to be one.
 * undefined = it is not between codes.
 */
export const idleStop = (s: State, lineId: string, now: number) =>
  s.runs.some((r) => r.lineId === lineId && !r.endedAt) ? undefined : s.stops.find((x) => x.lineId === lineId && !x.endedAt && now - x.startedAt <= SETUP_MAX_MS && !fromOtherDay(s, x, now))
/**
 * A code starts on a line. Whatever the line was stopped for since its last code (its set up, or the causes that time
 * was divided into) ends at this moment, and from this moment it counts. A set up of seconds is not one, and neither
 * is what was left open for hours on a line nobody was using, or since the day before: those are dropped.
 */
export function startRun(line: Line, code: string, lot: string, date: string, perUnit: number | null, bin = '', measure: Measure | '' = '', pack: '' | 'bag' = '') {
  const at = clockNow()
  batch(() => {
    for (const x of state.stops.filter((y) => y.lineId === line.id && !y.endedAt)) {
      const age = at - x.startedAt
      if (age > SETUP_MAX_MS || fromOtherDay(state, x, at) || (x.reason === SETUP && age < 60_000)) putStop({ ...x, deleted: true })
      else putStop({ ...x, endedAt: Math.max(at, x.startedAt), note: x.reason === SETUP && x.note.startsWith(AFTER) ? 'De ' + x.note.slice(AFTER.length) + ' a ' + code : x.note })
    }
    putRun({ id: uid(), dept: line.dept, lineId: line.id, line: line.name, code, lot, date, startedAt: at, endedAt: null, units: [], perUnit, waste: 0, by: user.get(), updatedAt: 0, ...((line.dept === 'Packing' || line.dept === 'MFO') && bin.trim() ? { extra: { bin: bin.trim().slice(0, 30), ...(line.dept === 'MFO' && pack === 'bag' ? { pack } : {}) } } : line.dept === 'Spiral' && measure ? { extra: { measure } } : {}) })
  })
}
const run = (id: string) => state.runs.find((r) => r.id === id)
/** the last moment already on a run: nothing recorded after it may be stamped earlier (the clock can be corrected between two taps) */
const after = (r: Run) => Math.max(r.startedAt, r.units.length ? r.units[r.units.length - 1].at + 1 : 0, ...(r.extra?.removed ?? []).map((t) => t + 1))
/**
 * a unit finished on the line. `lots` = what it carries of each lot when it is not all of the run's lot; the quantity
 * is then their sum. `note` = a comment typed on this unit (see Unit)
 */
export function unitDone(runId: string, qty: number | null, ref = '', lots?: LotPart[], po?: string, note?: string) {
  const r = run(runId)
  if (!r) return
  const parts = cleanLots(lots)
  putRun({ ...r, units: [...r.units, { at: Math.max(clockNow(), after(r)), qty: parts ? parts.reduce((t, l) => t + l.qty, 0) : qty, ref, by: user.get(), ...(parts ? { lots: parts } : {}), ...(po ? { po } : {}), ...noteKey(note) }] })
}
/**
 * A code ends. `setup` = another code is coming on this line: the time until it starts is the line's set up, written
 * from this moment as a stop like any other, so it is in the report at once and a manager can divide it.
 */
export function endRun(runId: string, setup = false) {
  const r = run(runId)
  if (!r) return
  const at = Math.max(clockNow(), after(r))
  // the lots already put on the pallet being built (with their cases and tags) make a pallet of their own: a code that
  // ends leaves no pallet half-recorded
  const open = r.extra?.open?.parts.length ? r.extra.open : null
  const units = open ? [...r.units, palletUnit(open.parts, typeof open.po === 'string' ? open.po : nextOrderFor(state, r), at)] : r.units
  const extra = r.extra?.open ? ((({ open: _o, ...rest }) => (Object.keys(rest).length ? rest : undefined))(r.extra)) : r.extra
  batch(() => {
    putRun({ ...r, units, endedAt: at, ...(r.dept === 'Packing' || r.dept === 'Spiral' ? { extra } : {}) })
    if (setup && !state.stops.some((x) => x.lineId === r.lineId && !x.endedAt)) putStop({ id: uid(), dept: r.dept, lineId: r.lineId, reason: SETUP, note: AFTER + r.code, startedAt: at, endedAt: null, by: user.get(), updatedAt: 0 })
    // a set up begun while the code ran: with another code coming it goes on until that one starts; with nothing more
    // today it ends with the code, so nothing is left counting
    if (!setup) for (const x of state.stops.filter((y) => y.lineId === r.lineId && !y.endedAt && y.reason === SETUP)) putStop({ ...x, endedAt: Math.max(at, x.startedAt) })
  })
}
// ---- the pallet being built on a Packing line ----
/** a finished pallet: its lots with their cases and tags, its total, its order, and the comment typed on it (if any) */
function palletUnit(parts: { lot: string; qty: number; tag: string }[], po: string, at: number, note?: string): Unit {
  const lots = parts.map((p) => ({ lot: p.lot.trim(), qty: p.qty, ...(p.tag.trim() ? { tag: p.tag.trim().slice(0, 30) } : {}) })).filter((p) => p.lot && Number.isFinite(p.qty) && p.qty > 0)
  return { at, qty: lots.reduce((t, p) => t + p.qty, 0), ref: lots.map((p) => p.tag ?? '').filter(Boolean).join(', '), by: user.get(), lots, ...(po ? { po } : {}), ...noteKey(note) }
}
const withOpen = (r: Run, open: NonNullable<RunExtra['open']>, more: Partial<RunExtra> = {}): RunExtra => ({ ...r.extra, ...more, open })
/**
 * A lot ran out on the pallet being built: its cases, and its tag when they have it at hand (it can be written later),
 * stay on the pallet, and the next lot goes on. The pallet stays open. false = nothing changed.
 */
export function palletLotEnds(runId: string, qty: number, tag: string, next: string, po?: string): boolean {
  const r = run(runId), nextLot = next.trim()
  if (!r || r.endedAt || binOf(r) || r.dept !== 'Packing' || !(qty > 0) || !nextLot) return false
  const open = r.extra?.open ?? { parts: [] }
  const part: PalletPart = { lot: lotNowOf(r), qty, tag: tag.trim().slice(0, 30), at: Math.max(clockNow(), after(r)), by: user.get() }
  putRun({ ...r, extra: withOpen(r, { ...open, parts: [...open.parts, part], ...(po !== undefined ? { po } : {}) }, { lotNow: nextLot.slice(0, 30) }) })
  return true
}
/** a lot already on the pallet being built is corrected: its cases or its tag (the tag is often written afterwards) */
export function palletPartFix(runId: string, index: number, patch: { qty?: number; tag?: string }): boolean {
  const r = run(runId), open = r?.extra?.open
  if (!r || !open || !open.parts[index]) return false
  const parts = open.parts.map((p, k) => (k === index ? { ...p, ...(patch.qty != null && patch.qty > 0 ? { qty: patch.qty } : {}), ...(patch.tag != null ? { tag: patch.tag.trim().slice(0, 30) } : {}) } : p))
  putRun({ ...r, extra: withOpen(r, { ...open, parts }) })
  return true
}
/** the lot a Packing line packs now changed: a bin line, or a pallet line between two pallets */
export function setLotNow(runId: string, lot: string): boolean {
  const r = run(runId), l = lot.trim()
  if (!r || r.dept !== 'Packing' || !l) return false
  putRun({ ...r, extra: { ...r.extra, lotNow: l.slice(0, 30) } })
  return true
}
/** the order the pallet being built goes to ('' = none) */
export function palletOrder(runId: string, po: string): boolean {
  const r = run(runId)
  if (!r || binOf(r) || r.dept !== 'Packing') return false
  if (po && orderFull(state, po, r.perUnit)) return false
  const open = r.extra?.open ?? { parts: [] }
  putRun({ ...r, extra: withOpen(r, { ...open, po }) })
  return true
}
/**
 * The pallet is finished: the lots it holds (each with its cases and its tag) make one pallet, for its order. The next
 * pallet starts empty, with the lot being packed now. false = nothing to record.
 */
export function palletDone(runId: string, parts: { lot: string; qty: number; tag: string }[], po: string, note?: string): boolean {
  const r = run(runId)
  if (!r || binOf(r) || r.dept !== 'Packing') return false
  if (po && orderFull(state, po, r.perUnit)) return false
  const unit = palletUnit(parts, po, Math.max(clockNow(), after(r)), note)
  if (!unit.lots?.length) return false
  const rest: RunExtra = r.extra ? (({ open: _o, ...x }) => x)(r.extra) : {}
  // the last lot of the pallet, when it got cases there, is the one being packed now (they may have corrected it there)
  const last = parts[parts.length - 1], lastLot = last && last.qty > 0 ? last.lot.trim().slice(0, 30) : ''
  if (lastLot && lastLot !== lotNowOf(r)) rest.lotNow = lastLot
  // the next pallet goes to the same order while the order still lacks cases: its pallets 1/12, 2/12...
  const o = po ? state.orders.find((x) => x.id === po && !x.closed) : undefined
  const extra: RunExtra = o && (o.cases == null || o.cases - orderMade(state, o.id) - (unit.qty ?? 0) > 0) ? { ...rest, open: { parts: [], po } } : rest
  putRun({ ...r, units: [...r.units, unit], extra: Object.keys(extra).length ? extra : undefined })
  // (once complete, the next pallet is not proposed for it: see nextOrderFor)
  if (o && orderFull(state, o.id, r.perUnit) && state.runs.find((x) => x.id === runId)?.extra?.open?.po === o.id) { const now = run(runId)!; putRun({ ...now, extra: withOpen(now, { ...(now.extra?.open ?? { parts: [] }), po: '' }) }) }
  return true
}
/** the order the pallet being built goes to: the one they chose ('' = none), or else the one the app proposes */
export const palletPo = (s: State, r: Run) => (typeof r.extra?.open?.po === 'string' ? r.extra.open.po : nextOrderFor(s, r))
/** the pallets an order has, in the order they were finished, and how many it needs (its cases ÷ cases per pallet) */
export function orderPallets(s: State, orderId: string, perPallet?: number | null) {
  const o = s.orders.find((x) => x.id === orderId)
  const units = orderRunsOf(s, orderId).flatMap((r) => r.units.filter((u) => u.po === orderId && !u.into)).sort((a, b) => a.at - b.at)
  const done = units.map((u) => u.at)
  // the size of a pallet of this order: the line's; else the biggest of what its runs said at start, the biggest pallet
  // made for it, and Productos' — a pallet never holds more than its size, so the biggest seen is the real one
  // (Packing, 2026-10-22: PO 117953991 of 100 cases in pallets of 50 read "2 pallets de 13", from Productos' 8; Jose,
  // 2026-10-27: a PO of 150 in pallets of 50 read "de 19" because its runs had started with Productos' 8 kept in them)
  const runs = orderRunsOf(s, orderId).filter((r) => r.units.some((u) => u.po === orderId))
  const size = perPallet || Math.max(0, ...runs.map((r) => r.perUnit ?? 0), ...units.map((u) => u.qty ?? 0), productOf(s, o?.code ?? '')?.casesPerPallet ?? 0)
  const partial = size > 0 ? units.filter((u) => (u.qty ?? 0) < size).length : 0
  // what the order requires by its cases and that size: fixed, however many pallets end up made (the office, 2026-10-27:
  // "150 cajas deberían ser 3 paletas de 50; por los parciales son 5" — and Jose: a complete one read "4 de 4" when it
  // should read "de 3"). How many were made, complete and short, is said beside it. No size known: no "de N"
  const std = o?.cases != null && size > 0 ? Math.ceil(o.cases / size - 1e-9) : null
  return { done, need: std, size: size || null, std, partial }
}
/**
 * An order that takes no more pallets (the office, 2026-10-21: "que restrinja cuando están haciendo un PO en exceso:
 * el PO tiene 10 paletas y a partir de eso ya no permita aceptar una paleta número 11, y que alerte que ya completó el
 * PO"): it has as many pallets as it needs (its cases ÷ cases per pallet), or all its cases. One that does not say its
 * cases has no end. `but` = a pallet already given to it that is being corrected (it does not count against itself).
 * The pallet that completes it may carry a few cases more: that one is taken; the next one is not.
 */
export function orderFull(s: State, orderId: string, _perPallet?: number | null, but?: { runId: string; at: number }): boolean {
  const o = s.orders.find((x) => x.id === orderId)
  if (!o || o.cases == null) return false
  const mine = but ? orderRunsOf(s, orderId).find((r) => r.id === but.runId)?.units.find((u) => u.at === but.at && u.po === orderId) : undefined
  const r = but ? orderRunsOf(s, orderId).find((x) => x.id === but.runId) : undefined
  const made = orderMade(s, orderId) - (mine && r ? unitQty(s, r, mine) : 0)
  // by its cases: it takes pallets while cases are missing (Jose, 2026-10-29, after Packing could not give the cases a
  // PO still lacked: "sí, que permita completar"). From 2026-10-27 to then a PO of 3 pallets never took a 4th, short ones
  // or not; its "de N pallets" is still said, as what it requires
  return made >= o.cases
}
/**
 * the first order a list of pallets to give would go beyond ('' = none): a pallet after one that already completes its
 * cases (the pallet that completes it may carry a few more). For a record added after
 * the fact, and for what its window says
 */
export function orderOver(s: State, list: { po: string; qty: number | null }[], _perPallet?: number | null): string {
  const given = new Map<string, { n: number; cases: number }>()
  for (const u of list) {
    if (!u.po) continue
    const o = s.orders.find((x) => x.id === u.po)
    if (!o || o.cases == null) continue
    const g = given.get(u.po) ?? { n: 0, cases: 0 }
    if (orderMade(s, u.po) + g.cases >= o.cases) return u.po
    given.set(u.po, { n: g.n + 1, cases: g.cases + (u.qty ?? 0) })
  }
  return ''
}
/** how an order stands, said: "10 de 10 pallets", "480 de 480 cajas" */
/**
 * why an order takes no more pallets, said to whoever tried (Packing, 2026-10-29: "no me permite seleccionarlo ... un
 * mensajito que diga por qué"): it has all its cases
 */
export function orderFullWhy(s: State, orderId: string, perPallet?: number | null): string {
  const o = s.orders.find((x) => x.id === orderId)
  return o ? tr('{0} ya tiene todas sus cajas ({1}): no lleva más pallets.', orderLabel(o), orderFullText(s, orderId, perPallet)) : ''
}
export function orderFullText(s: State, orderId: string, perPallet?: number | null): string {
  const o = s.orders.find((x) => x.id === orderId)
  if (!o) return ''
  const seq = orderPallets(s, orderId, perPallet)
  return (seq.need != null ? tr('{0} de {1} pallets', seq.done.length, seq.need) + ' · ' : '') + tr('{0} de {1} cajas', fmtN(orderMade(s, orderId)), fmtN(o.cases ?? 0))
}
/**
 * The line is put in set up by hand, while it has no code running: the same stop that ending a code opens. It ends
 * with "Terminar", or when the next code starts. (With a code running, its "Set up" button opens one with startStop,
 * and so does "Set up" among the reasons of "Parar": the code goes on, and the set up is counted apart.)
 */
export function startSetup(line: Line, at = clockNow()) {
  if (state.runs.some((r) => r.lineId === line.id && !r.endedAt)) return
  // A stop left open on the line for hours, or since another day of work, is not on its card (see idleStop), which
  // shows the line free: it was not a set up, and it is dropped as the next code would drop it. Otherwise the button
  // did nothing at all (Jose saw it on the floor on some lines). One that is on the card goes on as it is.
  const left = state.stops.filter((x) => x.lineId === line.id && !x.endedAt)
  const stale = left.filter((x) => at - x.startedAt > SETUP_MAX_MS || fromOtherDay(state, x, at))
  if (left.length > stale.length) return
  const last = state.runs.filter((r) => r.lineId === line.id && !!r.endedAt && at - (r.endedAt ?? 0) <= SETUP_MAX_MS).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0]
  batch(() => {
    for (const x of stale) putStop({ ...x, deleted: true })
    putStop({ id: uid(), dept: line.dept, lineId: line.id, reason: SETUP, note: last ? AFTER + last.code : '', startedAt: at, endedAt: null, by: user.get(), updatedAt: 0 })
  })
}
/** the lines with nothing on their card: no code running, no set up or stop on them, and their room not stopped */
export const freeLines = (s: State, now: number): Line[] => s.lines.filter((l) => !openRun(s, l.id) && !idleStop(s, l.id, now) && !deptStop(s, l.dept))
/**
 * When the set ups of every line start: at the start of the shift in course, when the tap comes within hours of it
 * (Jose: the lines were being prepared since the shift began, whoever taps at 6:20 means 6:00); otherwise now.
 */
export function setupAllFrom(s: State, now: number): number {
  const since = turnOf(s, workDay(s, now).date, now).since
  return since <= now && now - since <= SETUP_MAX_MS ? since : now
}
/**
 * Every free line of every room goes into set up at once: a manager's or the office's tap when a shift starts and the
 * lines are being prepared, instead of a tap on each line. Each set up starts at the shift's start (see setupAllFrom),
 * never before the line's last code or stop ended, and waits for that line's next code, as any set up does (it never
 * counts with nobody working). Returns how many lines it put in set up.
 */
export function startSetupAll(): number {
  const now = clockNow(), base = setupAllFrom(state, now), free = freeLines(state, now)
  batch(() => {
    for (const l of free) {
      const lastEnd = Math.max(0, ...state.runs.filter((r) => r.lineId === l.id && r.endedAt).map((r) => r.endedAt ?? 0), ...state.stops.filter((x) => x.lineId === l.id && x.endedAt).map((x) => x.endedAt ?? 0))
      startSetup(l, Math.min(now, Math.max(base, lastEnd + 1000)))
    }
  })
  return free.length
}
/** what is still open in a room: the codes running, the set ups waiting for a code that has not come, and any other stop */
export function openIn(s: State, dept: Dept) {
  const runs = s.runs.filter((r) => r.dept === dept && !r.endedAt), busy = new Set(runs.map((r) => r.lineId))
  const open = s.stops.filter((x) => x.dept === dept && !x.endedAt)
  const setups = open.filter((x) => x.reason === SETUP && x.lineId !== null && !busy.has(x.lineId))
  return { runs, setups, stops: open.filter((x) => !setups.includes(x)) }
}
/**
 * The people of a room are leaving and nothing goes on: every code still running ends now, with no set up after it;
 * a set up that was waiting for another code is taken away (none came); any other stop ends now. It is theirs to say
 * when the shift ends: the hours of the shifts never end anything. (When the next shift goes on with the same codes
 * there is nothing to do: they are left running.) Returns how many of each it closed.
 */
export function endShift(dept: Dept, leaving?: 1 | 2) {
  const { runs, setups, stops } = openIn(state, dept), at = clockNow()
  // the first shift leaving near the afternoon hand-over: what the room made until now is the first shift's, and what
  // comes after the second's (see ShiftMark), unless the second shift already said when it began
  const today = workDay(state, at).date
  if (leaving === 1 && roomMark(state, today, dept)?.how !== 'inicio') setShiftMark(today, dept, at, 'fin')
  if (!runs.length && !setups.length && !stops.length) return { runs: 0, setups: 0, stops: 0 }
  batch(() => {
    for (const x of stops) putStop({ ...x, endedAt: Math.max(at, x.startedAt) })
    for (const x of setups) putStop({ ...x, deleted: true })
    for (const r of runs) putRun({ ...r, endedAt: Math.max(at, after(r)) })
  })
  const n = (k: number, one: string, many: string) => (k ? k + ' ' + (k === 1 ? one : many) : '')
  logChange(dept, 'Turno terminado en ' + dept, '', [n(runs.length, 'código terminado', 'códigos terminados'), n(setups.length, 'Set up quitado', 'Set up quitados'), n(stops.length, 'paro cerrado', 'paros cerrados')].filter(Boolean).join(' · '), 'act_shift_end', dept + ':' + at)
  return { runs: runs.length, setups: setups.length, stops: stops.length }
}
// ---- each room's own hand-over (2026-10-21, see ShiftMark) ----
const CUT_ID = 'cut:', CUT_REF = 'act_shiftcut'
/** how far from the plant's hand-over a room's own may be (a room that stays two hours more, or comes in early) */
export const CUT_WINDOW = 4 * 3_600_000
/** the plant's afternoon hand-over of a day of work, as a moment (null on a day of one shift: there is none) */
export function plantCut(s: State, date: string): number | null {
  const h = shiftsOf(s, date)
  if (h.only) return null
  return new Date(date + 'T00:00:00').getTime() + Math.round(shiftCuts(h).toSecond * 60_000)
}
/** a moment a room's hand-over of that day may be put at */
export const inCutWindow = (s: State, date: string, at: number) => { const p = plantCut(s, date); return p != null && Math.abs(at - p) <= CUT_WINDOW }
const howText = (h: ShiftMark['how']) => (h === 'fin' ? 'Terminar turno' : h === 'inicio' ? 'Empezar Turno 2' : 'a mano')
const rowOfMark = (x: ShiftMark) => ({ id: CUT_ID + x.date + ':' + x.dept, at: iso(x.at), by_name: x.by, dept: x.dept, what: 'Cambio de turno', before: '', after: JSON.stringify({ date: x.date, at: x.at, how: x.how }), ref_table: CUT_REF, ref_key: x.date + ':' + x.dept, deleted: !!x.deleted, updated_at: iso(x.updatedAt), updated_by: user.get() })
/**
 * A room says when its afternoon hand-over was on a day: from that moment what it records is the second shift's, and
 * before it the first's. Every report, card and order works it out again from there; nothing recorded is rewritten.
 * false = not taken (not a day of two shifts, or too far from the plant's hand-over)
 */
export function setShiftMark(date: string, dept: Dept, at: number, how: ShiftMark['how']): boolean {
  if (!isDay(date) || !roomKnown(dept) || !inCutWindow(state, date, at)) return false
  const old = (state.shiftMarks ?? []).find((x) => x.date === date && x.dept === dept), was = old && !old.deleted ? old : undefined
  const x: ShiftMark = { date, dept, at, how, by: user.get(), updatedAt: stamp(old) }
  batch(() => {
    set({ ...state, shiftMarks: [...(state.shiftMarks ?? []).filter((y) => y !== old), x] })
    push('act_changes', CUT_ID + date + ':' + dept, rowOfMark(x))
    logChange(dept, 'Cambio de turno de ' + dept + ' · ' + date, was ? fmtTime(was.at) : 'el de la planta', fmtTime(at) + ' (' + howText(how) + ')', 'act_changes', CUT_ID + date + ':' + dept)
  })
  return true
}
/** a room's hand-over of a day goes back to the plant's (a manager's correction) */
export function clearShiftMark(date: string, dept: Dept): boolean {
  const old = roomMark(state, date, dept)
  if (!old) return false
  const x: ShiftMark = { ...old, deleted: true, updatedAt: stamp(old) }
  batch(() => {
    set({ ...state, shiftMarks: [...(state.shiftMarks ?? []).filter((y) => y !== old), x] })
    push('act_changes', CUT_ID + date + ':' + dept, rowOfMark(x))
    logChange(dept, 'Cambio de turno de ' + dept + ' · ' + date, fmtTime(old.at), 'el de la planta', 'act_changes', CUT_ID + date + ':' + dept)
  })
  return true
}
/** the second shift of a room begins now, before the plant's hand-over (it came in early) */
export function startSecondShift(dept: Dept): boolean { const at = clockNow(); return setShiftMark(workDay(state, at).date, dept, at, 'inicio') }
/** no other code is coming after all: what was counting between codes is taken away (it was never a stop of the line) */
export function dropSetup(id: string) { const x = state.stops.find((y) => y.id === id); if (x && !x.endedAt) putStop({ ...x, deleted: true }) }
/**
 * A line that is running a code is not in set up. A set up still open from before that code started (the tablet that
 * started the code had not heard of it, or runs an older version of the app) ends where the code began; one left
 * from the day before, or open for hours, is dropped as startRun would have.
 */
function healSetup(lineId: string) {
  const r = state.runs.find((x) => x.lineId === lineId && !x.endedAt)
  if (!r) return
  // an operator's device only writes its own room: another room's line is healed by a manager's device or by that
  // room's own (2026-10-17: MFO's tablet tried to end an RTE set up and the server refused it). A device that only
  // looks writes nothing (the server heals it too, see migrations/016)
  if ((role.get() === 'op' && r.dept !== myDept.get()) || viewOnly.get()) return
  for (const x of state.stops.filter((y) => y.lineId === lineId && !y.endedAt && y.reason === SETUP && y.startedAt <= r.startedAt)) putStop(r.startedAt - x.startedAt > SETUP_MAX_MS || fromOtherDay(state, x, r.startedAt) ? { ...x, deleted: true } : { ...x, endedAt: r.startedAt })
}
/** pounds thrown away, added to what the run already has */
export function addWaste(runId: string, lb: number) { const r = run(runId); if (r) putRun({ ...r, waste: Math.round((r.waste + lb) * 100) / 100 }) }
/**
 * More product went on a unit that had been closed short: its quantity is raised (with its lots, where a unit carries
 * them), instead of counting another unit. It is a correction like any other: who and when go to the history.
 */
export function fillUnit(runId: string, at: number, qty: number, lots?: LotPart[], ref?: string, note?: string) {
  const r = run(runId)
  if (!r || !r.units.some((u) => u.at === at)) return
  const parts = cleanLots(lots)
  // (note: the comment typed in that window, when the window has the box; undefined leaves the unit's as it is)
  updateRun(runId, { units: r.units.map((u) => { if (u.at !== at) return u; const { lots: _was, ...bare } = u; return withUnitNote({ ...bare, ...(parts ? { lots: parts, qty: parts.reduce((t, l) => t + l.qty, 0) } : { qty }), ...(ref != null ? { ref } : {}) }, note) }) })
}
/**
 * A unit nobody recorded (a pallet found on the floor with its tags, a cart that was not tapped) is put on its run
 * after the fact, at the hour it was made: a correction, so who and when go to the history. Its moment is kept apart
 * from the others' (two units are never on the same instant) and never before the code started. Returns that moment,
 * or 0 when nothing was added.
 */
export function addUnit(runId: string, x: { at: number; qty: number | null; ref?: string; lots?: LotPart[]; po?: string; note?: string }): number {
  const r = run(runId)
  if (!r || !Number.isFinite(x.at)) return 0
  const lots = cleanLots(x.lots), qty = lots ? lots.reduce((t, l) => t + l.qty, 0) : x.qty
  const taken = new Set([...r.units.map((u) => u.at), ...(r.extra?.removed ?? [])])
  let at = Math.max(Math.floor(x.at), r.startedAt)
  while (taken.has(at)) at++
  const ref = (x.ref ?? '').trim() || (lots ? [...new Set(lots.map((l) => l.tag ?? '').filter(Boolean))].join(', ') : '')
  const o = orderOfId(state, x.po)
  if (o && orderFull(state, o.id, r.perUnit)) return 0
  // (its comment, typed in the window: on the unit, and said in the history line, as the run's is in addRunLater)
  const u: Unit = { at, qty, ref, by: user.get(), ...(lots ? { lots } : {}), ...(o ? { po: o.id } : {}), ...noteKey(x.note) }
  const units = [...r.units, u].sort((a, b) => a.at - b.at)
  putRun({ ...r, units })
  const cfg = cfgOf(r)
  logChange(r.dept, 'Corrida ' + r.code + ' del ' + r.date + ' (' + r.dept + ', ' + lineNameOf(state, r.lineId, r.line) + ') · Se agregó ' + cfg.unit.toLowerCase() + ' ' + (units.indexOf(u) + 1) + ' (' + fmtTime(at) + ')', '', [qty != null ? qty + ' ' + cfg.qtyUnit : '', lots ? lotsText(lots) : ref, o ? orderLabelKept(o) : '', u.note ? 'Comentario: ' + u.note : ''].filter(Boolean).join(' · ') || '1', 'act_runs', r.id)
  return at
}
/**
 * "Pallet completo" was tapped when a lot ran out, and the cases went on with the same pallet: the last pallet opens
 * again with its lots, cases, tags and PO, and the lot they say goes on it. Only while the pallet that followed is
 * still empty and the code still runs. It is a correction: the history says so. false = nothing to reopen.
 */
export function reopenPallet(runId: string, next = ''): boolean {
  const r = run(runId), last = r?.units[r.units.length - 1]
  if (!r || !last || r.endedAt || binOf(r) || r.dept !== 'Packing' || r.extra?.open?.parts.length) return false
  const lots = last.lots?.length ? last.lots : last.qty ? [{ lot: r.lot, qty: last.qty, ...(last.ref ? { tag: last.ref } : {}) }] : []
  // each lot gets a moment of its own, a few milliseconds apart and ending at the pallet's (so still older than
  // anything recorded after it): a merge of two versions of this pallet tells its lots apart by their moment. With
  // one moment for all of them, a manager's correction of one lot replaced the others and a lot was counted twice
  // (review of 2026-10-18)
  const kept = lots.filter((l) => l.qty > 0)
  const parts: PalletPart[] = kept.map((l, k) => ({ lot: l.lot, qty: l.qty, tag: l.tag ?? '', at: last.at - (kept.length - 1 - k), by: last.by }))
  if (!parts.length) return false
  const rest: RunExtra = r.extra ? (({ open: _o, ...x }) => x)(r.extra) : {}
  const lotNow = next.trim().slice(0, 30) || lotNowOf(r)
  putRun(withRemoved({ ...r, units: r.units.slice(0, -1), extra: { ...rest, lotNow, open: { parts, po: last.po ?? '' } } }, [last.at]))
  const o = orderOfId(state, last.po)
  logChange(r.dept, 'Corrida ' + r.code + ' del ' + r.date + ' (' + r.dept + ', ' + lineNameOf(state, r.lineId, r.line) + ') · Pallet ' + r.units.length + ' · se volvió a abrir', [last.qty != null ? last.qty + ' cajas' : '', lotsText(last.lots), o ? orderLabelKept(o) : ''].filter(Boolean).join(' · '), 'sigue con el lote ' + lotNow, 'act_runs', r.id)
  return true
}
/**
 * A code marked as finished too early goes on as if it had not ended (the set up that had started is taken away).
 * Not while its line runs another code: that one would have to end first.
 */
export function reopenRun(id: string): boolean {
  const r = run(id)
  if (!r || !r.endedAt || state.runs.some((x) => x.lineId === r.lineId && !x.endedAt)) return false
  updateRun(id, { endedAt: null })
  return true
}
/**
 * A run recorded on the wrong line's card goes to the line that made it, with the stops that began in its time (and
 * the set up that began when it ended). Not onto a line that had another code in that time, nor, while it is still
 * running, onto a line that is stopped: two things cannot be on one line at once.
 */
/**
 * A code that ran and nobody recorded (the office: "they did four and did not register them") is put on its line
 * after the fact, closed, with its units spread over its hours: a manager's or the office's record, so who added it
 * goes to the history. What is not known stays blank: the lot, the quantities, the tags, the waste, who made it.
 * Without an end hour the units go one per minute from the start and the code ends with the last one (the office
 * only knew the hour). Returns the new run's id, or '' when nothing was written: the line had another code in those
 * hours (nothing of it is touched), the line is not of that room, or there is no code.
 * Packing's pallets come one by one, each with its cases, its tag and its order (Jose, 2026-10-18: "que aparezca lo
 * de poner PO cuando estamos agregando registro en packing"), and each is kept exactly as a pallet finished on the
 * line (palletUnit): its lots with their cases and tags, its total, its tags as its number, and its order. So the
 * report, Avance, the orders and what they lack, a PO's pallets and the search count them like any other. An order
 * this device does not know, or one given to something that does not fill orders (a bin), is dropped: never invented.
 */
/**
 * What keeps a record added after the fact off a line (Jose, 2026-10-21: "me dice que la línea estaba ocupada a esa
 * hora ... sería bueno que la app diga la hora disponible y para qué turno la quiero agregar"): the runs of the line
 * in those hours. A run still going (one left open, even from another day) takes the line up to now and beyond.
 */
export const runsOnLine = (s: State, lineId: string, a: number, b: number) => s.runs.filter((r) => !r.deleted && r.lineId === lineId && clash(r, a, b)).sort((x, y) => x.startedAt - y.startedAt)
/**
 * a run in the way of [a, b): it overlaps, and not only by the seconds of the minute where one ends and the other
 * begins (Jose, 2026-10-21: 2286 ended at 2:27 and some seconds, the box says 2:27, and the free 2:27 PM was refused)
 */
function clash(r: Run, a: number, b: number) {
  const end = r.endedAt ?? Infinity
  if (!(r.startedAt < b && end > a)) return false
  if (r.startedAt <= a && end - a < 60_000) return false
  if (r.startedAt >= a && end >= b && b - r.startedAt < 60_000) return false
  return true
}
/** a shift's stretch of a day of work, by its room's own hours (its hand-over, see ShiftMark) */
export function shiftWindow(s: State, date: string, dept: Dept, k: 1 | 2): { from: number; to: number } {
  const h = shiftsOf(s, date, dept), { toFirst, toSecond } = shiftCuts(h), d0 = new Date(date + 'T00:00:00').getTime(), at = (m: number) => d0 + Math.round(m * 60_000)
  if (h.only) return { from: at(toFirst), to: at(toFirst) + 86_400_000 }
  return k === 1 ? { from: at(toFirst), to: at(toSecond) } : { from: at(toSecond), to: at(toFirst) + 86_400_000 }
}
/**
 * The stretches of a shift in which a line had no code (up to now: what has not happened yet is not free to add), and
 * the runs that filled the rest. A stretch shorter than a minute is left out
 */
export function lineTimes(s: State, lineId: string, date: string, dept: Dept, k: 1 | 2, now: number) {
  const w = shiftWindow(s, date, dept, k), end = Math.min(w.to, now), busy = runsOnLine(s, lineId, w.from, end)
  const free: { from: number; to: number }[] = []
  let cur = w.from
  for (const r of busy) { if (r.startedAt - cur >= 60_000) free.push({ from: cur, to: Math.min(r.startedAt, end) }); cur = Math.max(cur, r.endedAt ?? Infinity) }
  if (end - cur >= 60_000) free.push({ from: cur, to: end })
  return { window: w, free: free.filter((x) => x.to - x.from >= 60_000), busy }
}
export type LaterRun = { dept: Dept; lineId: string; code: string; lot?: string; date: string; startedAt: number; endedAt?: number | null; units?: { qty: number | null; ref?: string; lots?: LotPart[]; po?: string; note?: string }[]; perUnit?: number | null; waste?: number | string; bin?: string; measure?: Measure | ''; madeBy?: string; note?: string }
export function addRunLater(x: LaterRun): string {
  const line = state.lines.find((l) => l.id === x.lineId && !l.deleted), code = x.code.trim().toUpperCase(), list = x.units ?? []
  // the waste as typed in the box ("25,5" is 25.5, blank is none); one that is not a number adds nothing (the box says
  // why, see wasteProblem): it used to be saved as 0 (review of 2026-10-18)
  const waste = typeof x.waste === 'string' ? (wasteProblem(x.waste) ? NaN : typed(x.waste)) : Number(x.waste) || 0
  if (!line || line.dept !== x.dept || !code || !Number.isFinite(x.startedAt) || !/^\d{4}-\d{2}-\d{2}$/.test(x.date) || !Number.isFinite(waste)) return ''
  const start = Math.floor(x.startedAt), n = list.length
  const told = x.endedAt != null && Number.isFinite(x.endedAt) && x.endedAt >= start ? Math.floor(x.endedAt) : null
  const end = told ?? start + (n ? (n - 1) * 60_000 : 0)
  // each unit at its moment: spread over the hours told, else one per minute; never two on the same instant
  const atOf = (i: number) => (told == null ? start + i * 60_000 : end - start >= n * 1000 ? start + Math.round(((i + 1) * (end - start)) / n) : start + i)
  if (runsOnLine(state, line.id, start, Math.max(end, start + 1)).length) return ''
  const by = (x.madeBy ?? '').trim() || user.get()
  const kind: RunExtra | undefined = (line.dept === 'Packing' || line.dept === 'MFO') && x.bin?.trim() ? { bin: x.bin.trim().slice(0, 30) } : line.dept === 'Spiral' && x.measure ? { measure: x.measure } : undefined
  // the comment typed in the window (Jose, 2026-10-18: "una casilla para poner comentarios"), only when there is one
  const note = cleanNote(x.note)
  const extra: RunExtra | undefined = note ? { ...kind, note } : kind
  // only what fills orders carries one (Packing's pallets, not its bins), and only an order this device knows
  const fills = !!cfgOf({ dept: line.dept, extra: kind }).orders
  const units: Unit[] = list.map((u, i) => {
    const lots = cleanLots(u.lots), qty = lots ? lots.reduce((t, l) => t + l.qty, 0) : u.qty
    // its number as on the line: the one typed, else the tags of its lots (a pallet's tags are its number, see palletUnit)
    const ref = (u.ref ?? '').trim() || (lots ? [...new Set(lots.map((l) => l.tag ?? '').filter(Boolean))].join(', ') : '')
    const o = fills ? orderOfId(state, u.po) : undefined
    return { at: atOf(i), qty: typeof qty === 'number' && Number.isFinite(qty) ? qty : null, ref, by, ...(lots ? { lots } : {}), ...(o ? { po: o.id } : {}), ...noteKey(u.note) }
  })
  // (no order takes more pallets than it needs, nor cases beyond the pallet that completes it: 2026-10-21)
  if (fills && orderOver(state, units.map((u) => ({ po: u.po ?? '', qty: u.qty })), x.perUnit)) return ''
  const r: Run = { id: uid(), dept: line.dept, lineId: line.id, line: line.name, code, lot: (x.lot ?? '').trim(), date: x.date, startedAt: start, endedAt: end, units, perUnit: x.perUnit != null && Number.isFinite(x.perUnit) ? x.perUnit : null, waste: Math.round(waste * 100) / 100 || 0, by, updatedAt: 0, ...(extra ? { extra } : {}) }
  batch(() => {
    // a set up left open on the line before those hours ends where the code started, as when a code starts on the line
    for (const y of state.stops.filter((z) => z.lineId === line.id && !z.endedAt && z.reason === SETUP && z.startedAt < start)) putStop({ ...y, endedAt: start })
    putRun(r)
  })
  // the orders its pallets went to, named as addUnit names one: "Cliente Seis · PO 6001: 2 pallets"
  const given = [...units.reduce((m, u) => (u.po ? m.set(u.po, (m.get(u.po) ?? 0) + 1) : m), new Map<string, number>())].map(([id, k]) => { const o = orderOfId(state, id); return o ? ' · ' + orderLabelKept(o) + ': ' + k + (k === 1 ? ' pallet' : ' pallets') : '' }).join('')
  // the comment is in the history too, as it was typed: the record says it, and so does the line of who added it
  logChange(r.dept, 'Corrida ' + code + ' del ' + r.date + ' (' + r.dept + ', ' + lineNameOf(state, r.lineId, r.line) + ') · Se agregó después', '', madeText(r, runQty(state, r)) + ' · ' + fmtTime(start) + ' – ' + fmtTime(end) + (r.lot ? ' · lote ' + r.lot : '') + given + (note ? ' · Comentario: ' + note : ''), 'act_runs', r.id)
  return r.id
}
/**
 * The cases per pallet of a code added after the fact with its pallets one by one (Jose, 2026-10-18): what the line
 * starts the code with (the products table's, else the last run's: lastPerUnit), the run's full pallet, against which
 * one with fewer cases is a short one. Never the pallets' own number: one short pallet (or a few equally short) would
 * then count as complete in the report and set its place in its PO, and for a code the table lacks it would become
 * the line's proposal next time. Nobody types it in that window, so when the line would have none, it has none.
 */
export function laterPerPallet(s: State, code: string, cases: number[]): number | null {
  return cases.some((n) => Number.isFinite(n) && n > 0) ? lastPerUnit(s, 'Packing', code) : null
}
/** one pallet as it is typed in "Agregar un registro" (Packing): its cases, its tag, its order ('' = none) */
export type LaterPalletRow = { qty: string; tag: string; po: string }
/** the most units one record added after the fact brings (the limit its box "how many" always had) */
export const LATER_MAX = 500
const tagKey = (t: string) => t.trim().toUpperCase()
/**
 * What a list of pallets typed for a record says: each one's cases (NaN while they are not a whole number above 0),
 * the pallets that still lack them (by their number in the list), the tags written more than once (one tag is one
 * pallet), and whether it can be saved: at least one pallet, every one with its cases, no tag twice, at most LATER_MAX.
 */
export function checkLaterPallets(list: LaterPalletRow[]) {
  const cases = list.map((p) => (/^\d+$/.test(p.qty.trim()) && Number(p.qty) > 0 ? Number(p.qty) : NaN))
  const missing = list.flatMap((_, i) => (Number.isNaN(cases[i]) ? [i + 1] : []))
  const seen = list.reduce((m, p) => { const t = tagKey(p.tag); return t ? m.set(t, (m.get(t) ?? 0) + 1) : m }, new Map<string, number>())
  const twice = [...seen].filter(([, k]) => k > 1).map(([t]) => t)
  return { cases, missing, twice, ok: list.length > 0 && list.length <= LATER_MAX && !missing.length && !twice.length }
}
/** a tag written more than once in that list */
export const tagTwice = (twice: string[], tag: string) => twice.includes(tagKey(tag))
/**
 * That list as addRunLater takes it: each pallet as the line keeps one, the run's lot with its cases and its tag
 * (when the lot is not known, its cases and its tag alone, as a pallet of before lots were kept), and its order only
 * when it is one of the code's; and the run's cases per pallet (laterPerPallet). Only for a list that passes
 * checkLaterPallets.
 */
export function laterPalletUnits(s: State, code: string, lot: string, list: LaterPalletRow[]) {
  const { cases } = checkLaterPallets(list), lotNow = lot.trim(), key = normCode(code)
  const units = list.map((p, i) => {
    const qty = cases[i], tag = p.tag.trim().slice(0, 30), po = s.orders.some((o) => o.id === p.po && normCode(o.code) === key) ? p.po : ''
    return { qty, ref: tag, ...(lotNow ? { lots: [{ lot: lotNow, qty, ...(tag ? { tag } : {}) }] } : {}), ...(po ? { po } : {}) }
  })
  return { units, perUnit: laterPerPallet(s, code, cases) }
}
/**
 * How "Agregar un registro" opens. From an open order of Packing's Pedidos tab, with its "+ Pallets" (Jose, 2026-10-18:
 * "también de agregar registro de pallet desde packing tab pedidos, que también ahí se pueda agregar y que salga la
 * opción de agregar PO en los dos lados"): Packing, in pallets, that order's code, and that order in the quick bar's
 * Pedido, which then also gives it to each pallet "+ Un pallet" adds (one place says where the new pallets go). The
 * person chose the order by tapping its button, so it is their choice in sight, not a guess: nothing else is set (no
 * pallets, cases, tags, lot or hours) and all of it can be changed. Without an order, as from Terminados or the
 * report: the room it was opened in, nothing chosen, and "+ Un pallet" adds a pallet without an order, as always.
 */
export type LaterStart = { dept: Dept; kind: string | null; code: string; quickPo: string; oneTakesBar: boolean }
export function laterStart(dept: Dept | undefined, o?: Order): LaterStart {
  return o ? { dept: 'Packing', kind: '', code: o.code, quickPo: o.id, oneTakesBar: true } : { dept: dept ?? 'Kitchen', kind: null, code: '', quickPo: '', oneTakesBar: false }
}
/** an order is kept on a pallet of that list, or in its quick bar, only while it is one of the code's ('' always fits) */
export const laterPoFits = (s: State, po: string, code: string) => !po || s.orders.some((o) => o.id === po && normCode(o.code) === normCode(code))
/**
 * What goes to the order "Agregar un registro" was opened from, as the window stands: how many pallets of the list
 * will be saved with it (laterPalletUnits keeps an order only on Packing's pallets of that order's code), and whether
 * the ones added now go to it too (the quick bar and "+ Un pallet" both give the bar's Pedido). The line under the
 * title says it. Looking at the bar alone, it said nothing went to the order while pallets on the list carried it, and
 * someone could add them again (review, 2026-10-18).
 */
export function laterToOrder(s: State, po: string, x: { byPallet: boolean; code: string; quickPo: string; list: LaterPalletRow[] }) {
  const fits = x.byPallet && !!po && laterPoFits(s, po, x.code)
  return { listed: fits ? x.list.filter((p) => p.po === po).length : 0, next: fits && x.quickPo === po }
}
/**
 * The runs a pallet nobody recorded can be put on from an order's pallets window, with "+ Agregar pallet a este PO"
 * (Jose, 2026-10-18: "que cuando esté viendo los pedidos y los PO pueda también agregarle otro pallet"): the runs of
 * the order's code this device holds that fill orders (Packing's pallets, never its bins), not deleted, the newest
 * first, each with how many pallets it has and how many of them went to this order, so the person tells them apart
 * by what they see (day, line, lot, hours). The older runs kept apart for an order (orderRuns) are not on this
 * device to be corrected: they are left out. None = only a new record can be added.
 */
export type OrderAddRun = { r: Run; pallets: number; toOrder: number }
export function orderAddRuns(s: State, o: Pick<Order, 'id' | 'code'>): OrderAddRun[] {
  const key = normCode(o.code)
  return s.runs.filter((r) => !r.deleted && !!cfgOf(r).orders && normCode(r.code) === key)
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((r) => ({ r, pallets: r.units.length, toOrder: r.units.filter((u) => u.po === o.id).length }))
}
/**
 * The order "Agregar pallet" starts on, in its Pedido (opened from an order's pallets window: that order, which the
 * person tapped and sees chosen there, and can change): only when it is one the window offers, an order of the run's
 * code on a run that fills orders. Otherwise none, as it always opened (no order is ever guessed).
 */
export const unitStartPo = (s: State, r: Pick<Run, 'dept' | 'extra' | 'code'>, po?: string) => (po && cfgOf(r).orders && s.orders.some((o) => o.id === po && normCode(o.code) === normCode(r.code)) ? po : '')
export function moveRun(id: string, lineId: string): boolean {
  const r = run(id), to = state.lines.find((l) => l.id === lineId)
  if (!r || !to || to.dept !== r.dept || lineId === r.lineId) return false
  const end = r.endedAt ?? Infinity
  if (state.runs.some((x) => x.id !== r.id && x.lineId === lineId && x.startedAt < end && (x.endedAt ?? Infinity) > r.startedAt)) return false
  if (!r.endedAt && state.stops.some((x) => x.lineId === lineId && !x.endedAt)) return false
  const was = lineNameOf(state, r.lineId, r.line)
  batch(() => {
    for (const x of state.stops.filter((y) => y.lineId === r.lineId && y.startedAt >= r.startedAt && y.startedAt <= end)) putStop({ ...x, lineId })
    putRun({ ...r, lineId, line: to.name })
  })
  logChange(r.dept, 'Corrida ' + r.code + ' del ' + r.date + ' (' + r.dept + ') · Línea', was, to.name, 'act_runs', r.id)
  return true
}
/** corrections: a wrong code, lot, quantity, tag or stop is fixed in place */
/** a correction from the editor: saved, and every field that differs goes to the history */
export function updateRun(id: string, patch: Partial<Pick<Run, 'code' | 'lot' | 'date' | 'perUnit' | 'waste' | 'endedAt' | 'units'>> & { note?: string }) {
  const r = run(id)
  if (!r) return
  // the comment, corrected in Corregir (it lives in the run's extra, not beside its fields): cleared, it stays as ''
  // (see RunExtra); one that was never there is not added empty
  const { note: typed, ...fields } = patch, said = typed === undefined ? undefined : cleanNote(typed)
  const noted = said !== undefined && said !== noteOf(r) ? { ...r, extra: withNote(r.extra, said) } : r
  // a unit taken off stays off: its moment is kept on the row, so that no merge with another version brings it back
  const gone = fields.units ? r.units.filter((u) => !fields.units!.some((x) => x.at === u.at)).map((u) => u.at) : []
  const n = gone.length ? withRemoved({ ...noted, ...fields }, gone) : { ...noted, ...fields }
  putRun(n)
  // reopened: the code goes on, so what started counting when it "ended" was not a set up
  if (patch.endedAt === null && r.endedAt) for (const x of state.stops.filter((y) => y.lineId === r.lineId && !y.endedAt && y.startedAt >= (r.endedAt ?? 0))) putStop({ ...x, deleted: true })
  const cfg = cfgOf(r), pre = 'Corrida ' + r.code + ' del ' + r.date + ' (' + r.dept + ', ' + lineNameOf(state, r.lineId, r.line) + ') · '
  const log = (what: string, a: string, b: string) => logChange(r.dept, pre + what, a, b, 'act_runs', r.id)
  log('Código', r.code, n.code); log('Lote', r.lot, n.lot); log('Fecha', r.date, n.date)
  log(cfg.perUnitLabel || 'Por unidad', v(r.perUnit), v(n.perUnit)); log('Waste lb', v(r.waste), v(n.waste)); log('Fin', endText(r.endedAt), endText(n.endedAt))
  log('Comentario', noteOf(r), noteOf(n))
  r.units.forEach((u, i) => {
    const w = n.units.find((x) => x.at === u.at)
    if (!w) log('Se quitó ' + cfg.unit.toLowerCase() + ' ' + (i + 1) + ' (' + fmtTime(u.at) + ')', [u.qty != null ? u.qty + ' ' + cfg.qtyUnit : '', u.ref].filter(Boolean).join(' · ') || '1', '')
    else { log(cfg.unit + ' ' + (i + 1) + ' · cantidad', v(u.qty), v(w.qty)); if (cfg.refLabel) log(cfg.unit + ' ' + (i + 1) + ' · ' + cfg.refLabel, u.ref, w.ref); if (cfg.lots || r.dept === 'MFO') log(cfg.unit + ' ' + (i + 1) + ' · lotes', lotsText(u.lots), lotsText(w.lots)); log(cfg.unit + ' ' + (i + 1) + ' · Comentario', u.note ?? '', w.note ?? '') }
  })
}
export function deleteRun(id: string) { const r = run(id); if (r) { putRun({ ...r, deleted: true }); logChange(r.dept, 'Se borró la corrida ' + r.code + ' del ' + r.date + ' (' + r.dept + ', ' + lineNameOf(state, r.lineId, r.line) + ')', r.units.length + ' ' + cfgOf(r).plural.toLowerCase() + (r.waste ? ' · waste ' + r.waste + ' lb' : ''), '', 'act_runs', r.id) } }
/** letters and digits only, without accents or capitals: "Set-up", "setup" and "SET UP" are one cause */
const plain = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
/**
 * A cause typed by hand ("Otra") that is one of the department's own written another way is saved with the list's
 * spelling: the report must not count "break", "Break" and "BREAK" as three causes, nor miss a typed "setup".
 */
// A Reason Code written by hand ("eqp-01", "EQP-01 Mechanical failure") is kept as the code's own reason, and PLN-03 as
// the Set up it is (see reasons.ts, typedCode); a code followed by words of one's own is kept as typed
export const tidyReason = (dept: Dept, text: string) => { const t = text.replace(/\s+/g, ' ').trim(), k = plain(t), c = typedCode(t); return c ? codeReason(c) : (k && CFG[dept].reasons.find((r) => plain(r) === k || plain(trIn('en', r)) === k)) || t }
/**
 * What is wrong with the cause of a stop as it would be saved ('' = nothing). With the Reason Codes on (see reasons.ts)
 * it must be one of the list, and OTH-01 needs its detail ("explain in notes"); off, any cause that is not blank. The
 * screens offer only what is allowed; this is the same rule for whatever calls the store (a stop of before the codes
 * keeps its cause: only a cause being given is held to it, see updateStop)
 */
export function reasonProblem(s: State, dept: Dept, reason: string, note: string): string {
  const r = tidyReason(dept, reason)
  if (!r) return tr('Falta la razón del paro.')
  if (!s.reasonCodes.on) return ''
  // the code exactly as the list keeps it: a code followed by words of one's own ("EQP-01 se trabó la banda") is not one
  const c = reasonCodeOf(r)
  if (!c || r !== codeReason(c)) return tr('Con los códigos de paro encendidos, la razón tiene que ser uno de la lista.')
  return c.code === OTHER_CODE && !note.trim() ? tr('Con {0} hay que escribir el detalle.', OTHER_CODE) : ''
}
/**
 * a stop's cause as the screens say it: a coded one with its code ("EQP-01 · Falla mecánica"), the Set up with PLN-03
 * while the codes are on, any other as it was written (in the screen's language when it is one of the rooms' causes)
 */
// (a cause that only begins with a code, typed in "Otra" while the codes were off, "EQP-01 se trabó la banda", is said as it
// was typed: the operator's own words are not hidden behind the code's label; the report still counts it under its code)
export const reasonText = (s: State, reason: string) => { const c = reasonCodeOf(reason); return c && reason === codeReason(c) && (c.code !== SETUP_CODE || s.reasonCodes.on) ? codeText(c) : tr(reason) }
/** starts a stop; false = its cause is not one that may be given (see reasonProblem) */
export function startStop(dept: Dept, lineId: string | null, reason: string, note: string): boolean {
  if (reasonProblem(state, dept, reason, note)) return false
  putStop({ id: uid(), dept, lineId, reason: tidyReason(dept, reason), note: note.trim(), startedAt: clockNow(), endedAt: null, by: user.get(), updatedAt: 0 })
  return true
}
const stop = (id: string) => state.stops.find((x) => x.id === id)
export function endStop(id: string) { const x = stop(id); if (x) putStop({ ...x, endedAt: Math.max(clockNow(), x.startedAt) }) }
/** a line stopped for one cause goes on to its set up: the stop ends and the set up starts at the same moment */
export function switchToSetup(id: string) {
  const x = stop(id)
  if (!x || x.endedAt || x.lineId === null || x.reason === SETUP) return
  const at = Math.max(clockNow(), x.startedAt)
  batch(() => {
    putStop({ ...x, endedAt: at })
    putStop({ id: uid(), dept: x.dept, lineId: x.lineId, reason: SETUP, note: '', startedAt: at, endedAt: null, by: user.get(), updatedAt: 0 })
  })
}
/**
 * Corrects a stop; false = not done (no such stop, or a cause that may not be given). With the Reason Codes on, a cause
 * given here must be a code (and OTH-01 keeps its detail); a stop of before the codes, whose cause nobody changes here,
 * keeps it as it was: the history is not rewritten (Jose's list, 2026-10-20)
 */
export function updateStop(id: string, patch: Partial<Pick<Stop, 'reason' | 'note' | 'startedAt' | 'endedAt'>>): boolean {
  const x = stop(id)
  if (!x) return false
  const n = { ...x, ...patch, ...(patch.reason != null ? { reason: tidyReason(x.dept, patch.reason) } : {}) }
  const coded = reasonCodeOf(n.reason)
  if ((patch.reason != null || (patch.note != null && coded?.code === OTHER_CODE)) && reasonProblem(state, x.dept, n.reason, n.note)) return false
  putStop(n)
  const pre = 'Paro ' + x.dept + ' ' + dayOf(x.startedAt) + ' ' + fmtTime(x.startedAt) + ' (' + stopLine(x) + ') · '
  const log = (what: string, a: string, b: string) => logChange(x.dept, pre + what, a, b, 'act_stops', x.id)
  log('Motivo', x.reason, n.reason); log('Detalle', x.note, n.note); log('Inicio', fmtTime(x.startedAt), fmtTime(n.startedAt)); log('Fin', endText(x.endedAt), endText(n.endedAt))
  return true
}
/**
 * A stop that turned out to have two causes: the time up to `at` keeps its reason and the rest becomes another stop
 * with its own. The two cover the same time, so the stopped time of the line does not change. A stop still open stays
 * open in its second part. Returns the new stop's id, or '' when there is nothing to divide (`at` is not inside the
 * stop, or no reason was given). Dividing a part again gives three causes, and so on.
 */
export function splitStop(id: string, at: number, reason: string, note = ''): string {
  const x = stop(id)
  if (!x || x.deleted || !reason.trim()) return ''
  if (!(at > x.startedAt && at < (x.endedAt ?? clockNow()))) return ''
  if (reasonProblem(state, x.dept, reason, note)) return '' // (with the Reason Codes on, the rest takes a code too)
  const rest: Stop = { id: uid(), dept: x.dept, lineId: x.lineId, reason: tidyReason(x.dept, reason), note: note.trim(), startedAt: at, endedAt: x.endedAt, by: user.get(), updatedAt: 0 }
  batch(() => { putStop({ ...x, endedAt: at }); putStop(rest) })
  logChange(x.dept, 'Paro ' + x.dept + ' ' + dayOf(x.startedAt) + ' ' + fmtTime(x.startedAt) + ' (' + stopLine(x) + ') · Se dividió en dos causas',
    x.reason + ' ' + fmtTime(x.startedAt) + '–' + endText(x.endedAt), x.reason + ' ' + fmtTime(x.startedAt) + '–' + fmtTime(at) + ' + ' + rest.reason + ' ' + fmtTime(at) + '–' + endText(x.endedAt), 'act_stops', rest.id)
  return rest.id
}
export function deleteStop(id: string) { const x = stop(id); if (x) { putStop({ ...x, deleted: true }); logChange(x.dept, 'Se borró el paro ' + x.dept + ' ' + dayOf(x.startedAt) + ' ' + fmtTime(x.startedAt) + ' (' + stopLine(x) + ')', x.reason + (x.note ? ' · ' + x.note : '') + ' · ' + fmtTime(x.startedAt) + '–' + endText(x.endedAt), '', 'act_stops', x.id) } }
/** the form of a correction, as the text the person sees and types */
// (a unit's note: its comment as the form holds it; absent = the form says nothing of it, see applyDraft)
export type RunDraft = { code: string; lot: string; date: string; per: string; waste: string; units: { at: number; qty: string; ref: string; by: string; lots?: LotPart[]; note?: string }[]; note?: string }
export const draftOf = (r: Run): RunDraft => ({ code: r.code, lot: r.lot, date: r.date, per: r.perUnit != null ? String(r.perUnit) : '', waste: r.waste ? String(r.waste) : '', units: r.units.map(draftUnitOf), note: noteOf(r) })
/** a unit as Corregir holds it (its comment too, when it has one, so the form can show and change it) */
export const draftUnitOf = (u: Unit): RunDraft['units'][number] => ({ at: u.at, qty: u.qty != null ? String(u.qty) : '', ref: u.ref, by: u.by, ...(u.lots ? { lots: u.lots } : {}), ...(u.note !== undefined ? { note: u.note } : {}) })
const typed = (t: string) => { const n = Number(t.replace(',', '.')); return Number.isFinite(n) ? n : 0 }
/**
 * What is wrong with the waste typed in Corregir ('' = nothing: a number, or blank for none). The box takes digits,
 * dots and commas, so "25..5" or "1.234.5" could be typed, and they were saved as 0: 25 lb erased without a word
 * (audit 2026-10-17, H6). A comma is the decimal point, as everywhere in the app ("25,5" is 25.5).
 */
export const wasteProblem = (t: string) => (Number.isFinite(Number(t.trim().replace(',', '.'))) ? '' : tr('El waste "{0}" no es un número. Escríbelo así: 25.5', t.trim()))
/**
 * saves a correction on top of what the run is NOW: only what the person changed in the form (against how the form
 * opened) is applied, so a cart tapped on the line while the form was open is kept, not wiped by the form's old list.
 * Returns what is wrong ('' = saved): a waste that is not a number saves nothing at all, and the form says why and
 * stays open (it used to close as if saved, and the waste typed was lost without a word; review of 2026-10-18)
 */
export function applyDraft(id: string, opened: RunDraft, draft: RunDraft): string {
  const r = run(id)
  if (!r) return ''
  const cfg = cfgOf(r), patch: Parameters<typeof updateRun>[1] = {}
  const changed = (a: string, b: string) => a.trim() !== b.trim()
  if (cfg.waste && changed(draft.waste, opened.waste) && wasteProblem(draft.waste)) return wasteProblem(draft.waste)
  if (changed(draft.code.toUpperCase(), opened.code.toUpperCase()) && draft.code.trim()) patch.code = draft.code.trim().toUpperCase()
  if (changed(draft.lot, opened.lot)) patch.lot = draft.lot.trim()
  if (draft.date && draft.date !== opened.date) patch.date = draft.date
  if (cfg.perUnitLabel && changed(draft.per, opened.per)) patch.perUnit = draft.per.trim() ? typed(draft.per) : null
  // (a waste that is not a number was refused above: it used to become 0, see wasteProblem)
  if (cfg.waste && changed(draft.waste, opened.waste)) patch.waste = typed(draft.waste)
  // the comment (a form without it leaves it as it is)
  if (draft.note !== undefined && cleanNote(draft.note) !== cleanNote(opened.note ?? '')) patch.note = draft.note
  const was = new Map(opened.units.map((u) => [u.at, u])), now = new Map(draft.units.map((u) => [u.at, u]))
  const units = r.units.filter((u) => !(was.has(u.at) && !now.has(u.at))).map((u) => {
    const a = was.get(u.at), b = now.get(u.at)
    if (!a || !b) return u // tapped after the form opened: untouched
    const ref = changed(b.ref, a.ref) ? b.ref.trim() : u.ref
    // its comment, when the form changed it (typed, corrected or cleared in its window); a form that says nothing of
    // it (one of before, or untouched) leaves the unit's as it is
    const note = b.note !== undefined && cleanNote(b.note) !== cleanNote(a.note ?? '') ? b.note : undefined
    // the lots of a pallet were changed in the form: they stand, and its quantity is their sum
    if (JSON.stringify(a.lots ?? null) !== JSON.stringify(b.lots ?? null)) {
      const lots = cleanLots(b.lots), { lots: _was, ...bare } = u
      return withUnitNote(lots ? { ...bare, ref, lots, qty: lots.reduce((t, l) => t + l.qty, 0) } : { ...bare, ref, qty: cfg.qty !== 'none' && b.qty.trim() ? typed(b.qty) : u.qty }, note)
    }
    const qty = cfg.qty !== 'none' && changed(b.qty, a.qty) ? (b.qty.trim() ? typed(b.qty) : null) : u.qty
    return qty === u.qty && ref === u.ref && note === undefined ? u : withUnitNote({ ...u, qty, ref }, note)
  })
  if (units.length !== r.units.length || units.some((u, i) => u !== r.units[i])) patch.units = units
  if (Object.keys(patch).length) updateRun(id, patch)
  return ''
}
/** the moment with this clock time ("HH:MM") nearest to `base`: a correction is a small move, also across midnight */
export function nearDay(base: number, hm: string) {
  const [h, m] = hm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return base
  const at = (shift: number) => { const d = new Date(base); d.setDate(d.getDate() + shift); d.setHours(h, m, 0, 0); return d.getTime() }
  return [at(-1), at(0), at(1)].reduce((best, x) => (Math.abs(x - base) < Math.abs(best - base) ? x : best), at(0))
}
// ---- the orders Packing fills ----
/**
 * The office types the orders (a manager can too); Packing sees the open ones of the code it is packing and says,
 * pallet by pallet, which one each goes to, or none: not everything packed is for an order. An order is filled over
 * several days, and the app adds up what has been packed for it.
 * They travel in act_changes, the table with room for words, where a row without a room is written only by managers
 * and the office: id "po:<id>", ref_table "act_orders", the order in `after` as JSON. Their `at` is a fixed far date:
 * devices let go of history older than two weeks and fetch only the recent one when they sign in, and an order has to
 * be there for as long as it is open. They are kept apart from the history (state.orders), never among its lines.
 */
const ORDER_REF = 'act_orders', ORDER_ID = 'po:', ORDER_LOG = 'act_orders_log'
const ORDER_AT = Date.UTC(2099, 0, 1, 12)
const rowOfOrder = (o: Order, deleted = false) => ({ id: ORDER_ID + o.id, at: iso(ORDER_AT), by_name: o.by, dept: null, what: 'Pedido', before: '', after: JSON.stringify({ customer: o.customer, po: o.po, code: o.code, cases: o.cases, shipBy: o.shipBy, dest: o.dest, closed: o.closed, createdAt: o.createdAt, ...(o.urgent ? { urgent: true } : {}) }), ref_table: ORDER_REF, ref_key: o.id, deleted, updated_at: iso(o.updatedAt), updated_by: user.get() })
const putOrder = (o: Order) => { set({ ...state, orders: [...state.orders.filter((x) => x.id !== o.id), o] }); push('act_changes', ORDER_ID + o.id, rowOfOrder(o)) }
export const orderOfId = (s: State, id: string | undefined) => (id ? s.orders.find((o) => o.id === id) : undefined)
/** "Cliente · PO 123", or "Cliente · sin PO" while it has no number */
export const orderLabel = (o: Order) => [o.customer, o.po ? 'PO ' + o.po : tr('sin PO')].filter(Boolean).join(' · ')
/** an order as the history keeps it: always in the same words, whatever language the screen is in */
const orderLabelKept = (o: Order) => [o.customer, o.po ? 'PO ' + o.po : 'sin PO'].filter(Boolean).join(' · ')
const orderText = (o: Order) => [orderLabelKept(o), 'código ' + o.code, o.cases != null ? o.cases + ' cajas' : '', o.shipBy ? 'envío ' + o.shipBy : '', o.dest, o.urgent ? 'urgente' : '', o.closed ? 'completo' : ''].filter(Boolean).join(' · ')
/** the urgent ones first (2026-10-22), then the one that ships first; those without a date, last */
export const byShip = (a: Order, b: Order) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || (a.shipBy || '9999').localeCompare(b.shipBy || '9999') || a.createdAt - b.createdAt
/** the orders still open for a product */
export const openOrdersFor = (s: State, code: string) => s.orders.filter((o) => !o.closed && normCode(o.code) === normCode(code)).sort(byShip)
/**
 * The order the next unit of a run is proposed for: the one its last unit went to, while that one still lacks cases;
 * otherwise the first open order of the code that still lacks them (the one that ships first). When the person left
 * the last unit without an order, that choice stands, unless an order has been typed since: a new one is proposed.
 */
export function nextOrderFor(s: State, r: Run): string {
  const lacking = openOrdersFor(s, r.code).filter((o) => o.cases == null || (o.cases - orderMade(s, o.id) > 0 && !orderFull(s, o.id, r.perUnit)))
  const last = r.units[r.units.length - 1]
  if (last && !last.po) return lacking.find((o) => o.createdAt > last.at)?.id ?? ''
  return (lacking.find((o) => o.id === last?.po) ?? lacking[0])?.id ?? ''
}
/** the cases already packed for an order: every unit that was given to it, on the days this device holds */
/** the runs that gave pallets to an order: the ones on the device, and the older ones kept apart for it (never one twice) */
export function orderRunsOf(s: State, id: string): Run[] {
  const local = new Set(s.runs.map((r) => r.id))
  return [...s.runs, ...(s.orderRuns ?? []).filter((r) => !local.has(r.id))].filter((r) => r.units.some((u) => u.po === id))
}
export const orderMade = (s: State, id: string) => orderRunsOf(s, id).reduce((t, r) => t + r.units.filter((u) => u.po === id).reduce((a, u) => a + unitQty(s, r, u), 0), 0)
/** the product codes typed in one box, for a PO that covers several: "0100, 0200 0300" gives three (each one once) */
export const orderCodes = (text: string) => [...new Set(text.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean))]
/** a PO number as it is compared: case, spaces and dashes aside */
export const poKey = (po: string) => po.trim().toUpperCase().replace(/[\s-]/g, '')
/**
 * The orders (open or complete) that already carry a PO number, other than the one being written (the office via Jose,
 * 2026-10-27: the second shift's clerk writes the orders again without noticing they are in; the form warns, it does
 * not forbid). `code` narrows them to the ones with that product
 */
export function poMates(s: State, po: string, exceptId = '', code = ''): Order[] {
  const k = poKey(po), c = code ? normCode(code) : ''
  return k ? s.orders.filter((o) => o.id !== exceptId && poKey(o.po) === k && (!c || normCode(o.code) === c)) : []
}
/**
 * writes an order, or changes one (its PO number can come later). '' when it has no product code. The same PO number
 * can be on as many orders as the office wants (one per product, or the same product again): it is theirs to say.
 */
export function saveOrder(id: string | null, x: { customer: string; po: string; code: string; cases: number | null; shipBy: string; dest: string; urgent?: boolean }): string {
  const old = id ? state.orders.find((o) => o.id === id) : undefined
  const o = orderOf(old?.id ?? uid(), { ...x, urgent: x.urgent ?? old?.urgent ?? false, closed: old?.closed ?? false, createdAt: old?.createdAt ?? clockNow() }, old?.by ?? user.get(), stamp(old))
  if (!o) return ''
  putOrder(o)
  logChange(null, old ? 'Pedido cambiado' : 'Pedido nuevo', old ? orderText(old) : '', orderText(o), ORDER_LOG, o.id)
  return o.id
}
/** an order marked urgent (Packing gives it priority), or not any more */
export function setOrderUrgent(id: string, urgent: boolean) {
  const o = state.orders.find((x) => x.id === id)
  if (!o || !!o.urgent === urgent) return
  const { urgent: _was, ...rest } = o
  putOrder({ ...rest, ...(urgent ? { urgent: true } : {}), updatedAt: stamp(o) })
  logChange(null, urgent ? 'Pedido urgente' : 'Pedido ya no urgente', '', orderText({ ...rest }), ORDER_LOG, o.id + (urgent ? ':u' : ':n'))
}
// ---- Packing's comment on an order (2026-10-22: "un espacio para que dé comentario de por qué no se pueda hacer") ----
/**
 * One comment per order, written by Packing (its room: an operator of Packing writes it, the order itself is the
 * office's): why it cannot be done, or anything to say of it. Cleared = marked deleted. In act_changes, apart.
 */
export type OrderNote = { orderId: string; text: string; by: string; at: number; deleted?: boolean; updatedAt: number; syncedAt?: number }
const ONOTE_ID = 'ponote:'
export const ONOTE_REF = 'act_order_notes'
function orderNoteFrom(x: Partial<OrderNote> | null | undefined): OrderNote | null {
  if (!x || typeof x !== 'object' || typeof x.orderId !== 'string' || !x.orderId) return null
  return { orderId: x.orderId, text: String(x.text ?? '').trim().slice(0, 500), by: String(x.by ?? ''), at: Number(x.at) || 0, ...(x.deleted ? { deleted: true } : {}), updatedAt: Number(x.updatedAt) || 0, ...(Number(x.syncedAt) > 0 ? { syncedAt: Number(x.syncedAt) } : {}) }
}
export const orderNoteOf = (s: State, orderId: string) => (s.orderNotes ?? []).find((x) => x.orderId === orderId && !x.deleted && x.text) ?? null
export function setOrderNote(orderId: string, text: string) {
  const was = (state.orderNotes ?? []).find((x) => x.orderId === orderId), t = text.trim().slice(0, 500)
  if ((was && !was.deleted ? was.text : '') === t) return
  const x: OrderNote = { orderId, text: t, by: user.get(), at: clockNow(), ...(t ? {} : { deleted: true }), updatedAt: stamp(was) }
  set({ ...state, orderNotes: [...(state.orderNotes ?? []).filter((y) => y.orderId !== orderId), x] })
  push('act_changes', ONOTE_ID + orderId, { id: ONOTE_ID + orderId, at: iso(x.at), by_name: x.by, dept: 'Packing', what: 'Comentario del pedido', before: '', after: JSON.stringify({ text: t }), ref_table: ONOTE_REF, ref_key: orderId, deleted: !t, updated_at: iso(x.updatedAt), updated_by: user.get() })
}
// ---- the office's message to a room (2026-10-22: "añadir que le llegue mensaje, o cualquier parte de anuncio" to Packing) ----
/**
 * One message per room, written by the office or a manager, shown on top of that room's tablets (in every tab, "En
 * vivo" too) until it is taken away. Each tablet may set it aside once read ("Entendido": on that device only, until a
 * new message comes). In act_changes with the room, apart from the history; cleared = marked deleted.
 */
export type RoomMsg = { dept: Dept; text: string; by: string; at: number; deleted?: boolean; updatedAt: number; syncedAt?: number }
const RMSG_ID = 'msg:'
export const RMSG_REF = 'act_room_msg'
function roomMsgFrom(x: Partial<RoomMsg> | null | undefined): RoomMsg | null {
  if (!x || typeof x !== 'object' || !(DEPTS as unknown[]).includes(x.dept)) return null
  return { dept: x.dept as Dept, text: String(x.text ?? '').trim().slice(0, 600), by: String(x.by ?? ''), at: Number(x.at) || 0, ...(x.deleted ? { deleted: true } : {}), updatedAt: Number(x.updatedAt) || 0, ...(Number(x.syncedAt) > 0 ? { syncedAt: Number(x.syncedAt) } : {}) }
}
export const roomMsgOf = (s: State, dept: Dept) => (s.roomMsgs ?? []).find((x) => x.dept === dept && !x.deleted && x.text) ?? null
export function setRoomMsg(dept: Dept, text: string) {
  const was = (state.roomMsgs ?? []).find((x) => x.dept === dept), t = text.trim().slice(0, 600)
  if ((was && !was.deleted ? was.text : '') === t) return
  const x: RoomMsg = { dept, text: t, by: user.get(), at: clockNow(), ...(t ? {} : { deleted: true }), updatedAt: stamp(was) }
  set({ ...state, roomMsgs: [...(state.roomMsgs ?? []).filter((y) => y.dept !== dept), x] })
  push('act_changes', RMSG_ID + dept, { id: RMSG_ID + dept, at: iso(x.at), by_name: x.by, dept, what: 'Mensaje para ' + dept, before: '', after: JSON.stringify({ text: t }), ref_table: RMSG_REF, ref_key: dept, deleted: !t, updated_at: iso(x.updatedAt), updated_by: user.get() })
  logChange(dept, t ? 'Mensaje para ' + dept : 'Mensaje para ' + dept + ' quitado', was && !was.deleted ? was.text : '', t, RMSG_REF + ':log', dept + ':' + x.at)
}
// ---- messages between a room and the office (Jose, 2026-10-28: "que el operador de la tablet pueda escribir también para atrás, de todos los departamentos") ----
/**
 * A conversation per room: the room's tablets write to the office and the managers, who see one button per room and
 * answer in the same window. Each message is one record in act_changes with its room (act_chat): the room's operators
 * read their own room's, the office and the managers every room's (the server's reading rule, migrations/015); it
 * goes with its day, as everything else (14 days on a device). "Read" is each device's own: see src/Chat.tsx
 */
/** the rooms that talk with the office: the five, and the freezer (Jose, 2026-10-28: its people answer from Freezer RTE, see migrations/023) */
export type ChatRoom = Dept | 'Freezer'
export const CHAT_ROOMS: ChatRoom[] = [...DEPTS, 'Freezer']
// (a function, not a const: load() reads the chat through chatFrom before the file's consts exist, see the TDZ note above load)
export function chatRoomKnown(d: unknown): d is ChatRoom { return d === 'Freezer' || roomKnown(d) }
/** img = a photo with the message (2026-10-28): its path in the server's bucket act_chat ('<room>/<id>.jpg', SQL 027), or a data: URL on a device without a server (the demo) */
export type ChatMsg = { id: string; dept: ChatRoom; text: string; by: string; at: number; side: 'room' | 'office'; img?: string
  /** a voice note with the message (2026-10-29): its path in the bucket ('<room>/<id>.webm' or .mp4, SQL 028), or a data: URL without a server */
  audio?: string; deleted?: boolean; updatedAt: number; syncedAt?: number }
/** what a photo / a voice note says for whoever cannot show it (a build from before, the freezer's app): the message's text when none was typed */
export const CHAT_PHOTO_TEXT = '📷 Foto', CHAT_AUDIO_TEXT = '🎤 Nota de voz'
const CHAT_ID = 'chat:'
export const CHAT_REF = 'act_chat'
function chatFrom(x: Partial<ChatMsg> | null | undefined): ChatMsg | null {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id || !chatRoomKnown(x.dept)) return null
  const text = String(x.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 600), img = String(x.img ?? '').trim().slice(0, 400_000), audio = String(x.audio ?? '').trim().slice(0, 1_500_000)
  if (!text && !img && !audio) return null
  return { id: x.id, dept: x.dept, text, by: String(x.by ?? ''), at: Number(x.at) || 0, side: x.side === 'room' ? 'room' : 'office', ...(img ? { img } : {}), ...(audio ? { audio } : {}), ...(x.deleted ? { deleted: true } : {}), updatedAt: Number(x.updatedAt) || 0, ...(Number(x.syncedAt) > 0 ? { syncedAt: Number(x.syncedAt) } : {}) }
}
/** a room's conversation, oldest first */
export const chatOf = (s: State, dept: ChatRoom) => (s.chat ?? []).filter((x) => x.dept === dept && !x.deleted).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
/** which side this device writes from: a room's operator, or the office and the managers */
export const chatSide = (): ChatMsg['side'] => (role.get() === 'op' ? 'room' : 'office')
/** the messages from the other side later than the moment this device last looked (`seen`) */
export const chatUnread = (s: State, dept: ChatRoom, side: ChatMsg['side'], seen: number) => chatOf(s, dept).filter((x) => x.side !== side && x.at > seen).length
/**
 * How far each side of a room's conversation has looked (Jose, 2026-10-28: "si el supervisor de la plataforma vio el
 * mensaje o no"): one record per room and side, 'chat:seen:<room>:<side>' in act_changes with the room (act_chat, so
 * the rooms' reading and writing rules are the chat's; a build from before takes it for a message with no text and
 * drops it). at = the moment of the last message that side had on screen (its window open); seenAt = when, by = who was
 * on that device. The other side reads it under its own messages: "Visto · Juan · 3:12 PM" or "Sin ver todavía".
 * Each device still keeps its own "unread" (src/Chat.tsx): this is for the other side to know
 */
export type ChatSeen = { dept: ChatRoom; side: ChatMsg['side']; at: number; seenAt: number; by: string; updatedAt: number }
const CHAT_SEEN_ID = 'chat:seen:'
function chatSeenFrom(x: Partial<ChatSeen> | null | undefined): ChatSeen | null {
  if (!x || typeof x !== 'object' || !chatRoomKnown(x.dept) || !(Number(x.at) > 0)) return null
  return { dept: x.dept, side: x.side === 'room' ? 'room' : 'office', at: Number(x.at), seenAt: Number(x.seenAt) || Number(x.at), by: String(x.by ?? ''), updatedAt: Number(x.updatedAt) || 0 }
}
/** how far a side has looked at a room's conversation (undefined = never said) */
export const chatSeenOf = (s: State, dept: ChatRoom, side: ChatMsg['side']) => (s.chatSeen ?? []).find((x) => x.dept === dept && x.side === side)
/** this device had the room's conversation on screen up to its message of `upTo`: said to the other side (once per new message, never backwards) */
export function markChatSeen(dept: ChatRoom, upTo: number) {
  if (!(upTo > 0) || !chatRoomKnown(dept) || !writesRoom(dept) || role.get() === 'viewer') return
  const side = chatSide(), cur = chatSeenOf(state, dept, side)
  if (cur && cur.at >= upTo) return
  const x: ChatSeen = { dept, side, at: upTo, seenAt: clockNow(), by: user.get(), updatedAt: stamp(cur) }
  set({ ...state, chatSeen: [...(state.chatSeen ?? []).filter((y) => y !== cur), x] })
  push('act_changes', CHAT_SEEN_ID + dept + ':' + side, { id: CHAT_SEEN_ID + dept + ':' + side, at: iso(x.seenAt), by_name: x.by, dept, what: (side === 'room' ? 'Mensajes para ' : 'Mensajes de ') + dept + ' vistos', before: '', after: JSON.stringify({ seen: upTo, side }), ref_table: CHAT_REF, ref_key: 'seen:' + side, deleted: false, updated_at: iso(x.updatedAt), updated_by: user.get() })
}
/**
 * a message to (from the office) or from (an operator) a room, with a photo or not (img: see ChatMsg); '' when there
 * is nothing to say or this device may not write that room. A photo with no words goes up saying "📷 Foto" for whoever
 * cannot show it; here it is only the photo
 */
export function sendChat(dept: ChatRoom, text: string, img = '', audio = ''): string {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, 600), i = img.trim(), a = audio.trim()
  if ((!t && !i && !a) || !chatRoomKnown(dept) || !writesRoom(dept)) return ''
  const side = chatSide()
  const x: ChatMsg = { id: uid(), dept, text: t, by: user.get(), at: clockNow(), side, ...(i ? { img: i } : {}), ...(a ? { audio: a } : {}), updatedAt: stamp(undefined) }
  set({ ...state, chat: [...(state.chat ?? []), x] })
  push('act_changes', CHAT_ID + x.id, { id: CHAT_ID + x.id, at: iso(x.at), by_name: x.by, dept, what: side === 'room' ? 'Mensaje de ' + dept : 'Mensaje para ' + dept, before: '', after: JSON.stringify({ text: t || (i ? CHAT_PHOTO_TEXT : a ? CHAT_AUDIO_TEXT : ''), side, ...(i ? { img: i } : {}), ...(a ? { audio: a } : {}) }), ref_table: CHAT_REF, ref_key: x.id, deleted: false, updated_at: iso(x.updatedAt), updated_by: user.get() })
  return x.id
}
/** an order is complete (Packing is no longer offered it), or is opened again */
export function closeOrder(id: string, closed: boolean) {
  const o = state.orders.find((x) => x.id === id)
  if (!o || o.closed === closed) return
  putOrder({ ...o, closed, updatedAt: stamp(o) })
  logChange(null, closed ? 'Pedido completo' : 'Pedido abierto otra vez', '', orderText({ ...o, closed: false }), ORDER_LOG, o.id + (closed ? ':c' : ':o'))
}
/** an order written by mistake is taken away; the units that were given to it stay recorded, with no order */
export function deleteOrder(id: string) {
  const o = state.orders.find((x) => x.id === id)
  if (!o) return
  set({ ...state, orders: state.orders.filter((x) => x.id !== id) })
  push('act_changes', ORDER_ID + id, rowOfOrder({ ...o, updatedAt: stamp(o) }, true))
  logChange(null, 'Pedido borrado', orderText(o), '', ORDER_LOG, id + ':d')
}
/** which order a unit already recorded goes to ('' = none): a correction */
/**
 * Packing's pallets of a code that carry no order, or one that is gone (Jose, 2026-10-29: to give them to a PO from its
 * window), the newest first: the pallets of the runs on this device, not their bins
 */
export function loosePalletsOf(s: State, code: string) {
  return s.runs.filter((r) => !r.deleted && r.dept === 'Packing' && !binOf(r) && normCode(r.code) === normCode(code))
    .flatMap((r) => r.units.filter((u) => !orderOfId(s, u.po)).map((u) => ({ r, u }))).sort((a, b) => b.u.at - a.u.at)
}
// ---- a short pallet finished by another (2026-10-29) ----
/** the units that count as pallets (or carts, mezclas…): all but the short pallets another one finished */
export const countedUnits = (units: Unit[]) => units.filter((u) => !u.into)
/** the short pallets joined into a pallet, with their runs: its other parts */
export function joinedInto(s: State, runId: string, at: number): { r: Run; u: Unit }[] {
  return s.runs.flatMap((r) => (r.deleted ? [] : r.units.filter((u) => u.into?.run === runId && u.into.at === at).map((u) => ({ r, u }))))
}
/** what a pallet holds with the parts joined into it (its cases and theirs) */
export const palletTotal = (s: State, r: Run, u: Unit) => unitQty(s, r, u) + joinedInto(s, r.id, u.at).reduce((t, x) => t + unitQty(s, x.r, x.u), 0)
/** a pallet's size: its run's cases per pallet, else Productos' */
const palletSize = (s: State, r: Run) => r.perUnit || productOf(s, r.code)?.casesPerPallet || 0
/**
 * the short pallets a pallet of a run could have finished: Packing's pallets of the same code of the last three days,
 * not joined to another and with none joined to them, with fewer cases than a pallet holds and room for this one's
 * (when its cases are known), of the same PO (or both without), the newest first; never the pallet itself
 */
export function palletsToFinish(s: State, r: Run, po: string, qty: number | null, but?: number): { r: Run; u: Unit; size: number }[] {
  if (r.dept !== 'Packing' || binOf(r)) return []
  const from = dayBefore(dayBefore(r.date))
  return s.runs.filter((x) => !x.deleted && x.dept === 'Packing' && !binOf(x) && normCode(x.code) === normCode(r.code) && x.date >= from && x.date <= r.date)
    .flatMap((x) => x.units.map((u) => ({ r: x, u, size: palletSize(s, x) })))
    .filter(({ r: x, u, size }) => !(x.id === r.id && u.at === but) && !u.into && size > 0 && unitQty(s, x, u) < size && (qty == null || unitQty(s, x, u) + qty <= size) && (u.po ?? '') === (po ?? '') && !joinedInto(s, x.id, u.at).length)
    .sort((a, b) => b.u.at - a.u.at)
}
/**
 * a short pallet joined into the pallet that finished it: its cases stay its own (its shift, who made them), the
 * pallet goes to the one that finished it. The one that finishes takes the short one's PO when it has none. Not a
 * pallet already joined, nor one with others joined to it (no chains), nor of another code or another PO.
 */
export function joinPallet(shortRun: string, shortAt: number, finRun: string, finAt: number): boolean {
  const a = run(shortRun), b = run(finRun)
  const su = a?.units.find((u) => u.at === shortAt), fu = b?.units.find((u) => u.at === finAt)
  if (!a || !b || !su || !fu || (a.id === b.id && shortAt === finAt) || a.dept !== 'Packing' || b.dept !== 'Packing' || binOf(a) || binOf(b) || normCode(a.code) !== normCode(b.code)) return false
  if (su.into || fu.into || joinedInto(state, a.id, shortAt).length || (su.po && fu.po && su.po !== fu.po)) return false
  batch(() => {
    if (su.po && !fu.po) { const now = run(finRun)!; putRun({ ...now, units: now.units.map((u) => (u.at === finAt ? { ...u, po: su.po } : u)) }) }
    const now = run(shortRun)!
    putRun({ ...now, units: now.units.map((u) => (u.at === shortAt ? { ...u, into: { run: finRun, at: finAt } } : u)) })
  })
  const n = (x: Run, at: number) => x.units.findIndex((u) => u.at === at) + 1
  logChange(a.dept, 'Corrida ' + a.code + ' del ' + a.date + ' (' + a.dept + ', ' + lineNameOf(state, a.lineId, a.line) + ') · Pallet ' + n(a, shortAt) + ' · lo terminó otro pallet', '', tr('Pallet {0} de {1} ({2}, {3})', n(b, finAt), lineNameOf(state, b.lineId, b.line), b.date, fu.by || '—'), 'act_runs', a.id)
  return true
}
/** a short pallet taken back from the pallet it was joined to: a pallet of its own again */
export function unjoinPallet(shortRun: string, shortAt: number): boolean {
  const a = run(shortRun), su = a?.units.find((u) => u.at === shortAt)
  if (!a || !su?.into) return false
  putRun({ ...a, units: a.units.map((u) => { if (u.at !== shortAt) return u; const { into: _was, ...rest } = u; return rest }) })
  logChange(a.dept, 'Corrida ' + a.code + ' del ' + a.date + ' (' + a.dept + ', ' + lineNameOf(state, a.lineId, a.line) + ') · Pallet ' + (a.units.findIndex((u) => u.at === shortAt) + 1) + ' · otra vez pallet aparte', tr('lo terminó otro pallet'), '', 'act_runs', a.id)
  return true
}
export function setUnitOrder(runId: string, at: number, orderId: string): boolean {
  const r = run(runId), i = r ? r.units.findIndex((u) => u.at === at) : -1
  if (!r || i < 0) return false
  const was = orderOfId(state, r.units[i].po), to = orderOfId(state, orderId)
  if ((was?.id ?? '') === (to?.id ?? '') && !!r.units[i].po === !!to) return true
  if (to && orderFull(state, to.id, r.perUnit, { runId, at })) return false
  putRun({ ...r, units: r.units.map((u) => { if (u.at !== at) return u; const { po: _was, ...bare } = u; return to ? { ...bare, po: to.id } : bare }) })
  logChange(r.dept, 'Corrida ' + r.code + ' del ' + r.date + ' (' + r.dept + ', ' + lineNameOf(state, r.lineId, r.line) + ') · ' + CFG[r.dept].unit + ' ' + (i + 1) + ' · pedido', was ? orderLabelKept(was) : '', to ? orderLabelKept(to) : '', 'act_runs', r.id)
  return true
}
// ---- the shifts ----
/**
 * The plant works two shifts, and their hours have been moved more than once: the manager changes them in the app, and
 * each version is kept with the date it starts to count, so an earlier day is still split with the hours it had.
 * They travel in act_targets, the table of what the manager sets for everybody (only managers write it, and a device
 * keeps all of it): key "shifts:<date>", the first shift in per_hour and the second in per_shift, each as HHMM of its
 * start × 10000 + HHMM of its end (06:00 to 15:00 is 6001500).
 */
const SHIFTS_KEY = 'shifts:'
const hhmm = (hm: string) => Number(hm.slice(0, 2)) * 100 + Number(hm.slice(3, 5))
const hmOf = (n: number) => String(Math.floor(n / 100)).padStart(2, '0') + ':' + String(n % 100).padStart(2, '0')
const packShift = (start: string, end: string) => hhmm(start) * 10000 + hhmm(end)
const unpackShift = (n: unknown): [string, string] | null => {
  const x = Number(n)
  if (n == null || n === '' || !Number.isInteger(x) || x < 0) return null
  const a = hmOf(Math.floor(x / 10000)), b = hmOf(x % 10000)
  return hmOk(a) && hmOk(b) ? [a, b] : null
}
const rowOfShifts = (x: ShiftPlan) => ({ dept: SHIFTS_KEY + x.from, per_hour: packShift(x.first, x.firstEnd), per_shift: packShift(x.second, x.secondEnd), updated_at: iso(x.updatedAt), updated_by: user.get() })
/** the hours in force on a day: the last version that starts on or before it (the usual ones while nobody has set any) */
export function shiftsOf(s: State, date: string, dept?: Dept): ShiftHours & { from: string } {
  const hours = s.shifts.filter((x) => x.from <= date).sort((a, b) => (a.from < b.from ? 1 : -1))[0] ?? { ...SHIFTS_DEFAULT, from: '' }
  // the shifts of the day: the day apart from its week, else what its week says (see the calendar below)
  const code = s.dayShifts.find((x) => x.date === date)?.only ?? Number(weekOf(s, date).charAt(weekdayOf(date)) || 3)
  const { first, firstEnd, second, secondEnd, from } = hours
  const day = { first, firstEnd, second, secondEnd, from, ...(code === 1 || code === 2 ? { only: code as 1 | 2 } : {}) }
  // (a room's own hand-over of that day, when it said one: see ShiftMark; a day of one shift has none to move)
  const m = dept && !day.only ? roomMark(s, date, dept) : undefined
  return m ? { ...day, cut2: clockMin(m.at) } : day
}
/** a room's own hand-over of a day, when it said one */
export const roomMark = (s: State, date: string, dept: Dept) => (s.shiftMarks ?? []).find((x) => x.date === date && x.dept === dept && !x.deleted)
/** "6:00 AM" for "06:00" */
export const clockText = (hm: string) => fmtTime(new Date(2000, 0, 1, Number(hm.slice(0, 2)), Number(hm.slice(3, 5))).getTime())
/** "3:15 PM" for minute 915 of the day */
export const minuteText = (m: number) => fmtTime(new Date(2000, 0, 1, Math.floor(m / 60), Math.floor(m % 60)).getTime())
/** "6:00 AM a 3:00 PM": the hours of one shift */
/** when a shift starts and when it ends, as two texts: "6:00 AM", "3:00 PM" */
export const shiftSpan = (h: ShiftHours, shift: 1 | 2): [string, string] => (shift === 1 ? [clockText(h.first), clockText(h.firstEnd)] : [clockText(h.second), clockText(h.secondEnd)])
export const shiftHours = (h: ShiftHours, shift: 1 | 2) => (h.only ? tr('todo el día') : tr('{0} a {1}', ...shiftSpan(h, shift)))
export const shiftsText = (h: ShiftHours) => 'Turno 1 de ' + shiftSpan(h, 1).join(' a ') + ' · Turno 2 de ' + shiftSpan(h, 2).join(' a ')
/** the manager sets the hours of the shifts from a date on (the same date again replaces what was set for it) */
export function setShifts(from: string, h: ShiftHours): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || shiftsProblem(h)) return false
  const was = shiftsOf(state, from), old = state.shifts.find((x) => x.from === from)
  const x: ShiftPlan = { from, first: h.first, firstEnd: h.firstEnd, second: h.second, secondEnd: h.secondEnd, updatedAt: stamp(old) }
  set({ ...state, shifts: [...state.shifts.filter((y) => y.from !== from), x] })
  push('act_targets', SHIFTS_KEY + from, rowOfShifts(x))
  logChange(null, 'Horario de turnos desde el ' + from, shiftsText(was), shiftsText(x), 'act_targets', SHIFTS_KEY + from)
  return true
}
/**
 * The calendar of the plant (2026-10-17, the Saturday the second shift did not come and from 3:15 PM everything was
 * counted as its): which shifts work each day of the week, from a date on like the hours; and the days apart from
 * their week (a Saturday with one shift, a holiday worked by both). With one shift on a day of work, every record of
 * the day is that shift's: nothing is counted to a shift that did not come, and the day has one hand-over, the
 * night's. They travel in act_targets too: key "shiftweek:<date>" with the seven digits in per_hour, and
 * "shiftday:<date>" with 1, 2 or 3 in per_hour (null = the day is as its week says again). Everything is kept in
 * versions and in the history, so an earlier day is still read as it was.
 */
export const WEEK_BOTH = '3333333'
// (a function, not a const: the stored state is read before this line runs, see load)
export function weekOk(w: unknown): w is string { return typeof w === 'string' && /^[123]{7}$/.test(w) }
const WEEK_KEY = 'shiftweek:', DAY_KEY = 'shiftday:'
const weekdayOf = (date: string) => new Date(date + 'T12:00:00').getDay()
/** the week in force on a day: the last version that starts on or before it (both shifts every day while nobody has set any) */
export const weekOf = (s: State, date: string) => s.shiftWeeks.filter((x) => x.from <= date).sort((a, b) => (a.from < b.from ? 1 : -1))[0]?.week ?? WEEK_BOTH
/** "Turnos 1 y 2" / "Solo el turno 1": a day's shifts, as the history and the screen say them */
export const dayShiftsText = (only: 1 | 2 | 3 | undefined) => (only === 1 || only === 2 ? tr('Solo el turno {0}', only) : tr('Turnos 1 y 2'))
const WEEKDAY_NAMES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const weekText = (w: string) => (w === WEEK_BOTH ? 'Turnos 1 y 2 todos los días' : [...w].map((c, i) => WEEKDAY_NAMES[i] + ' ' + (c === '3' ? '1 y 2' : 'solo ' + c)).join(', '))
const rowOfWeek = (x: ShiftWeek) => ({ dept: WEEK_KEY + x.from, per_hour: Number(x.week), per_shift: null, updated_at: iso(x.updatedAt), updated_by: user.get() })
const rowOfDayShifts = (date: string, only: 1 | 2 | 3 | null, at: number) => ({ dept: DAY_KEY + date, per_hour: only, per_shift: null, updated_at: iso(at), updated_by: user.get() })
/** the manager says which shifts work each day of the week, from a date on (the same date again replaces what was set for it) */
export function setShiftWeek(from: string, week: string): boolean {
  if (!isDay(from) || !weekOk(week)) return false
  const was = weekOf(state, from), old = state.shiftWeeks.find((x) => x.from === from)
  const x: ShiftWeek = { from, week, updatedAt: stamp(old) }
  set({ ...state, shiftWeeks: [...state.shiftWeeks.filter((y) => y.from !== from), x] })
  push('act_targets', WEEK_KEY + from, rowOfWeek(x))
  logChange(null, 'Turnos de la semana desde el ' + from, weekText(was), weekText(week), 'act_targets', WEEK_KEY + from)
  return true
}
/** the manager says what a day apart has: only one shift (1 or 2), both (3), or (null) what its week says again */
export function setDayShifts(date: string, only: 1 | 2 | 3 | null): boolean {
  if (!isDay(date) || (only !== null && only !== 1 && only !== 2 && only !== 3)) return false
  const was = shiftsOf(state, date), old = state.dayShifts.find((x) => x.date === date), at = stamp(old)
  set({ ...state, dayShifts: [...state.dayShifts.filter((y) => y.date !== date), ...(only ? [{ date, only, updatedAt: at }] : [])] })
  push('act_targets', DAY_KEY + date, rowOfDayShifts(date, only, at))
  logChange(null, 'Turnos del ' + date, dayShiftsText(was.only), dayShiftsText(shiftsOf(state, date).only), 'act_targets', DAY_KEY + date)
  return true
}
/**
 * The two moments of the clock (in minutes) where one shift hands over to the other: halfway between the end of one
 * and the start of the next. So the last cart of people who stay a little late, and the first one of people who come
 * in a little early, are counted with their own shift. A day of work with one shift has one hand-over: the night's.
 */
export function shiftCuts(h: ShiftHours) {
  const mid = (from: string, to: string) => (mins(from) + ahead(mins(from), mins(to)) / 2) % DAY_MIN
  const toFirst = mid(h.secondEnd, h.first)
  return { toSecond: h.only ? toFirst : h.cut2 ?? mid(h.firstEnd, h.second), toFirst }
}
const clockMin = (at: number) => { const d = new Date(at); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60_000 }
/** the shift a moment belongs to, by the clock */
export function shiftAt(h: ShiftHours, at: number): 1 | 2 {
  if (h.only) return h.only
  const { toFirst, toSecond } = shiftCuts(h), m = clockMin(at)
  return (toFirst <= toSecond ? m >= toFirst && m < toSecond : m >= toFirst || m < toSecond) ? 1 : 2
}
/** the hand-overs of the calendar days around a moment, in order */
function cutsNear(h: ShiftHours, at: number) {
  const { toFirst, toSecond } = shiftCuts(h), d = new Date(at), cuts = h.only ? [toFirst] : [toFirst, toSecond]
  d.setHours(0, 0, 0, 0)
  return [-1, 0, 1].flatMap((day) => cuts.map((c) => d.getTime() + day * 86_400_000 + Math.round(c * 60_000))).sort((a, b) => a - b)
}
/** the first hand-over after a moment, and the last one at or before it */
const nextCut = (h: ShiftHours, at: number) => cutsNear(h, at).find((t) => t > at) ?? at + 86_400_000
export const lastCut = (h: ShiftHours, at: number) => cutsNear(h, at).filter((t) => t <= at).pop() ?? at - 86_400_000
/** the time between two moments, cut where the shifts hand over: each piece with its shift */
export function shiftPieces(h: ShiftHours, a: number, b: number) {
  const out: { from: number; to: number; shift: 1 | 2 }[] = []
  for (let cur = a, n = 0; cur < b && n < 2000; n++) { const to = Math.min(b, nextCut(h, cur)); out.push({ from: cur, to, shift: shiftAt(h, cur) }); cur = to }
  return out
}
/**
 * The shift in course on a day of work: which one it is and the two hand-overs it lies between. What the screens of
 * the floor count "in this shift" is what was recorded since the first of them: every shift starts from zero.
 */
export function turnOf(s: State, date: string, now: number, dept?: Dept) {
  const plan = shiftsOf(s, date, dept)
  return { shift: shiftAt(plan, now), since: lastCut(plan, now), until: nextCut(plan, now) }
}
type Span = { from: number; to: number }
/** what is left of a stretch of time once some stretches are taken out of it */
function without(a: number, b: number, out: Span[]): Span[] {
  let left: Span[] = b > a ? [{ from: a, to: b }] : []
  for (const o of out) left = left.flatMap((p) => (o.to <= p.from || o.from >= p.to ? [p] : [...(o.from > p.from ? [{ from: p.from, to: o.from }] : []), ...(o.to < p.to ? [{ from: o.to, to: p.to }] : [])]))
  return left
}
/**
 * The stretches around [a, b) in which no shift is on, by the hours set: between the first shift and the second, and
 * between the second and the next first. A day of work with one shift has no hand-over in it: only the night is
 * between shifts (2026-10-18, a Sunday of the second shift working from the morning: the half hour at 3:00 PM was not a
 * time when nobody was there)
 */
function gapsNear(h: ShiftHours, a: number, b: number) {
  const f = mins(h.first), len1 = ahead(f, mins(h.firstEnd)), gap1 = h.only ? 0 : ahead(mins(h.firstEnd), mins(h.second)), len2 = ahead(mins(h.second), mins(h.secondEnd)), gap2 = ahead(mins(h.secondEnd), f)
  const d = new Date(a)
  d.setHours(0, 0, 0, 0)
  const out: Span[] = []
  for (let day = d.getTime() - 86_400_000; day <= b; day += 86_400_000) {
    const g1 = day + (f + len1) * 60_000, g2 = g1 + (gap1 + len2) * 60_000
    // (a room that said its own hand-over was not away between the shifts: one went on until the other came)
    if (gap1 > 0 && h.cut2 == null) out.push({ from: g1, to: g1 + gap1 * 60_000 })
    if (gap2 > 0) out.push({ from: g2, to: g2 + gap2 * 60_000 })
  }
  return out.filter((g) => g.to > a && g.from < b)
}
const marksCache = new WeakMap<State, Map<string, number[]>>()
/** every moment something was recorded on a line: a code started or ended, a unit, a stop started or ended */
function marksOf(s: State, lineId: string) {
  let byLine = marksCache.get(s)
  if (!byLine) marksCache.set(s, (byLine = new Map()))
  let m = byLine.get(lineId)
  if (!m) byLine.set(lineId, (m = [...s.runs.filter((r) => r.lineId === lineId).flatMap((r) => [r.startedAt, ...(r.endedAt ? [r.endedAt] : []), ...r.units.map((u) => u.at)]), ...s.stops.filter((x) => x.lineId === lineId).flatMap((x) => [x.startedAt, ...(x.endedAt ? [x.endedAt] : [])])]))
  return m
}
/** how long a stretch between two shifts counts live with nothing recorded in it, before it is set aside (see awayOn) */
export const AWAY_GRACE_MS = 60 * 60_000
/**
 * The stretches of [a, b) that do not count on a line. Time never stops by itself while people are there: those who
 * stay after their hour or start before it are working, and it is theirs to say when they stop. A stretch between two
 * shifts (the time in which one shift leaves and the other comes in, or the night) in which nothing at all was
 * recorded on the line (no unit, no stop, no code started or ended) is taken out: nobody was there, so it was neither
 * worked nor a stop. One record in it and all of it counts. While the stretch is going on it counts for an hour, in
 * case the people are still there and about to record; after an hour with nothing recorded it is set aside from its
 * start, and the next record in it brings it all back. `own` = the records to go by when it is not one line's.
 */
export function awayOn(s: State, lineId: string | null, date: string, a: number, b: number, now: number, own: number[] = []): Span[] {
  if (!(b > a)) return []
  const marks = lineId ? marksOf(s, lineId) : own
  return gapsNear(shiftsOf(s, date, lineId ? deptOfLine(s, lineId) : undefined), a, b)
    .filter((g) => (g.to <= now || now - g.from >= AWAY_GRACE_MS) && !marks.some((m) => m >= g.from && m < Math.min(g.to, now)))
    .map((g) => ({ from: Math.max(g.from, a), to: Math.min(g.to, b, now) })).filter((x) => x.to > x.from)
}
/** the room of a line (by its runs when the line was taken away) */
const deptOfLine = (s: State, lineId: string): Dept | undefined => s.lines.find((l) => l.id === lineId)?.dept ?? s.runs.find((r) => r.lineId === lineId)?.dept
/** the moment a room's shift clock is paused at: the start of a stretch between shifts in which, for over an hour, none of its lines recorded anything (0 = running) */
export function pausedAt(s: State, date: string, lineIds: string[], now: number) {
  const g = gapsNear(shiftsOf(s, date, lineIds.length ? deptOfLine(s, lineIds[0]) : undefined), now - 1, now + 1).find((x) => x.from <= now && now < x.to)
  if (!g || now - g.from < AWAY_GRACE_MS || !lineIds.length) return 0
  return lineIds.some((id) => marksOf(s, id).some((m) => m >= g.from && m < now)) ? 0 : g.from
}
/** the time a run has counted since a moment (its last unit, or its start) */
export function workedSince(s: State, r: Run, from: number, now: number) {
  const stops = stopsOf(s, r.dept, r.lineId)
  return without(from, now, awayOn(s, r.lineId, r.date, from, now, now)).reduce((t, x) => t + activeBetween(x.from, x.to, stops, now), 0)
}
/** the stretches a stop counts (see awayOn) */
export function stopSpans(s: State, x: Stop, now: number): Span[] {
  const end = x.endedAt ?? now
  return without(x.startedAt, end, awayOn(s, x.lineId, plainDay(s, x.startedAt), x.startedAt, end, now, [x.startedAt, ...(x.endedAt ? [x.endedAt] : [])]))
}
/** how long a stop counts */
export const stopTime = (s: State, x: Stop, now: number) => stopSpans(s, x, now).reduce((t, p) => t + (p.to - p.from), 0)
/** a run's time within one shift: what it worked and what it was stopped in it, with the causes */
export function runInShift(s: State, r: Run, now: number, h: ShiftHours, shift: 1 | 2) {
  const stops = stopsOf(s, r.dept, r.lineId), end = r.endedAt ?? now, away = awayOn(s, r.lineId, r.date, r.startedAt, end, now)
  const mine = shiftPieces(h, r.startedAt, end).filter((x) => x.shift === shift).flatMap((x) => without(x.from, x.to, away))
  // keyed by the cause as it was typed ("Otra"): an object of nothing, so a cause such as "__proto__" or "constructor"
  // is a cause like any other, not something of every object (its time went missing, audit 2026-10-17 H2)
  const reasons: Record<string, number> = Object.create(null)
  let working = 0, down = 0, setup = 0
  for (const w of mine) {
    working += activeBetween(w.from, w.to, stops, now)
    for (const x of stoppedPieces(w.from, w.to, stops, now)) {
      if (x.reason === SETUP) setup += x.to - x.from
      else { down += x.to - x.from; reasons[x.reason] = (reasons[x.reason] ?? 0) + (x.to - x.from) }
    }
  }
  // from / to = the first and the last moment of the run that count in this shift (0 when none does)
  return { working, down, setup, reasons, total: mine.reduce((t, w) => t + (w.to - w.from), 0), touched: mine.length > 0, from: mine.length ? mine[0].from : 0, to: mine.length ? mine[mine.length - 1].to : 0 }
}
// ---- the day of work ----
const DAY_REF = 'act_days'
/** a line of history written as it is (logChange merges retyped values; these are events of their own) */
const putChange = (c: Change) => { set({ ...state, changes: upsertIn(state.changes, c) }); push('act_changes', c.id, rowOfChange(c)) }
/** how long after midnight a day of work still lasts: until the second shift hands over to the first (3:30 with the usual hours) */
const nightMs = (s: State, date: string) => { const c = shiftCuts(shiftsOf(s, date)).toFirst; return c <= 720 ? Math.round(c * 60_000) : 0 }
/**
 * a day of work lasts until the second shift hands over to the first: a shift that runs past midnight keeps its date
 * and its lot, and the morning shift is never handed yesterday's date, even when it starts a little before its hour
 */
const dayEnds = (s: State, date: string) => { const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() + 1); return d.getTime() + nightMs(s, dayOf(d.getTime())) }
export type WorkDay = { date: string; started: { at: number; by: string } | null }
/**
 * the day in course: the one somebody started ("Empezar el día") while it lasts; otherwise the calendar's, where the
 * hours after midnight still belong to the second shift of the day before
 */
export function workDay(s: State, now = clockNow()): WorkDay {
  const m = s.changes.filter((c) => c.refTable === DAY_REF && !c.deleted && c.at <= now && now < dayEnds(s, c.refKey)).sort((a, b) => b.at - a.at)[0]
  return m ? { date: m.refKey, started: { at: m.at, by: m.by } } : { date: plainDay(s, now), started: null }
}
/** the day of work a moment falls in while nobody has started one: the calendar's, with the night still on the day before */
export const plainDay = (s: State, at: number) => dayOf(at - nightMs(s, dayOf(at)))
/** "3:30 AM": the hour of the night at which a day of work gives way to the next */
export const nightText = (s: State, date: string) => minuteText(nightMs(s, date) / 60_000)
/** the last thing recorded on a run: its last unit, its start, or the moment its line was stopped and left */
const lastRecord = (s: State, r: Run) => Math.max(r.units.length ? r.units[r.units.length - 1].at : r.startedAt, ...s.stops.filter((x) => !x.endedAt && x.dept === r.dept && x.lineId === r.lineId).map((x) => x.startedAt))
const LEFT_AFTER_MS = 6 * 3_600_000
/**
 * runs nobody finished: still open, dated before the day, and with nothing recorded for six hours. (A line that is
 * really running across midnight, with a cart an hour ago, is not one of them.)
 */
export const leftOpen = (s: State, date: string, at = clockNow()) => s.runs.filter((r) => !r.endedAt && r.date < date && lastRecord(s, r) < at - LEFT_AFTER_MS)
/** what a day holds that began before a moment (all of it when no moment is given) */
export const dayRecords = (s: State, date: string, before = Infinity) => ({
  runs: s.runs.filter((r) => r.date === date && r.startedAt < before),
  stops: s.stops.filter((x) => dayOf(x.startedAt) === date && x.startedAt < before),
})
/**
 * everything recorded on a day (or only what began before a moment) is set aside: it leaves every screen and every
 * report on every device, with the history of its corrections. The rows stay on the server marked as deleted.
 * Returns how many.
 */
export function purgeDay(date: string, before = Infinity): { runs: number; stops: number } {
  const { runs, stops } = dayRecords(state, date, before)
  // the history of those records goes with them; what was set up that day (products, goals, lines, program) keeps its own
  const lines = state.changes.filter((c) => (c.refTable === 'act_runs' || c.refTable === 'act_stops') && dayOf(c.at) === date && c.at < before)
  if (!runs.length && !stops.length && !lines.length) return { runs: 0, stops: 0 }
  batch(() => {
    for (const r of runs) putRun({ ...r, deleted: true })
    for (const x of stops) putStop({ ...x, deleted: true })
    for (const c of lines) putChange({ ...c, deleted: true, updatedAt: stamp(c) })
    const now = clockNow()
    putChange({ id: uid(), at: now, by: user.get(), dept: null, what: 'Se borraron los registros del ' + date + (before < Infinity ? ' anteriores a las ' + fmtTime(before) : ''), before: runs.length + (runs.length === 1 ? ' corrida' : ' corridas') + ' · ' + stops.length + (stops.length === 1 ? ' paro' : ' paros'), after: '', refTable: PURGE_REF, refKey: date, updatedAt: now })
  })
  return { runs: runs.length, stops: stops.length }
}
// ---- what was taken away by mistake comes back ----
export const PURGE_REF = DAY_REF + ':purge'
const RESTORE_REF = DAY_REF + ':restore'
/** how long before the moment a purge is written its rows may have been marked (they are all marked in the same instant, just before) */
const PURGE_WINDOW_MS = 120_000
/** the times the records of a day were taken away and have not been brought back: when, by whom and how many (said in the report) */
export const purgesOf = (s: State, date: string) => s.changes.filter((c) => c.refTable === PURGE_REF && c.refKey === date && !c.deleted && !s.changes.some((r) => r.refTable === RESTORE_REF && r.refKey === c.id && !r.deleted)).sort((a, b) => a.at - b.at)
/**
 * The records a purge took away come back. Nothing is ever erased on the server: a record that is "deleted" is only
 * marked, whole, with its units, its lots and its hours. This takes the mark off, and every device shows it again.
 * `rows` = what the server holds of that day (see fetchPurged in sync.ts). Only what was marked at the moment of THAT
 * purge comes back, not a run a manager deleted on its own for its own reason. A code or a stop that was still
 * running then comes back ended at that moment: nothing was recorded on it afterwards (it was off every screen), and
 * its line may have started another code since. null = this device does not know that purge.
 */
export function restorePurged(purgeId: string, rows: { runs: Row[]; stops: Row[]; changes: Row[] }): { runs: number; stops: number } | null {
  const mark = state.changes.find((c) => c.id === purgeId && c.refTable === PURGE_REF)
  if (!mark) return null
  // marked at that moment or later (a tablet that was touching a row just then may have left its mark a little after),
  // and already there when it happened: what was deleted on its own before, or recorded afterwards, is not of that purge
  const taken = (x: { deleted?: boolean; updatedAt: number }, began: number) => !!x.deleted && x.updatedAt >= mark.at - PURGE_WINDOW_MS && began <= mark.at
  // (a room this version does not know is left as it is on the server, see applyRemote: a version that knows it can bring it back)
  const runs = rows.runs.map(runOfRow).filter((r) => roomKnown(r.dept) && taken(r, r.startedAt) && r.date === mark.refKey && !state.runs.some((x) => x.id === r.id))
  // (the listing of a day's stops reaches into the days around it; the purge only took the ones that began on that date)
  const stops = rows.stops.map(stopOfRow).filter((x) => roomKnown(x.dept) && taken(x, x.startedAt) && dayOf(x.startedAt) === mark.refKey && !state.stops.some((y) => y.id === x.id))
  const lines = rows.changes.map(changeOfRow).filter((c) => taken(c, c.at) && (c.refTable === 'act_runs' || c.refTable === 'act_stops'))
  batch(() => {
    for (const r of runs) putRun({ ...r, deleted: false, endedAt: r.endedAt ?? Math.max(mark.at, r.startedAt, ...r.units.map((u) => u.at + 1)) })
    for (const x of stops) putStop({ ...x, deleted: false, endedAt: x.endedAt ?? Math.max(mark.at, x.startedAt) })
    for (const c of lines) putChange({ ...c, deleted: false, updatedAt: stamp(c) })
    const now = clockNow()
    putChange({ id: uid(), at: now, by: user.get(), dept: null, what: 'Se recuperaron los registros del ' + mark.refKey + ' borrados a las ' + fmtTime(mark.at), before: '', after: runs.length + (runs.length === 1 ? ' corrida' : ' corridas') + ' · ' + stops.length + (stops.length === 1 ? ' paro' : ' paros'), refTable: RESTORE_REF, refKey: mark.id, updatedAt: now })
  })
  return { runs: runs.length, stops: stops.length }
}
/** a run nobody finished is closed at its last record (its last unit, or the moment it was stopped), not at "now" */
function finishLeft(r: Run) {
  const open = state.stops.filter((x) => !x.endedAt && x.dept === r.dept && x.lineId === r.lineId)
  const end = lastRecord(state, r)
  for (const x of open) updateStop(x.id, { endedAt: end })
  updateRun(r.id, { endedAt: end })
  return end
}
/**
 * starts the day of work (or moves its start): from then on "today" is that date for every tablet, until 6 the next
 * morning. On the way it can finish the runs left open from earlier days, and set aside what was recorded that day
 * before the start (tests).
 */
export function startDay(at: number, opts: { date?: string; finishLeft?: boolean; purge?: boolean } = {}) {
  const date = opts.date ?? dayOf(at)
  let ended = 0, gone = { runs: 0, stops: 0 }
  batch(() => {
    if (opts.finishLeft) {
      const last: Partial<Record<Dept, number>> = {}
      for (const r of leftOpen(state, date, at)) { const end = finishLeft(r); last[r.dept] = Math.max(last[r.dept] ?? 0, end); ended++ }
      // a whole department left "stopped" since an earlier day: closed with the last of its runs, or where it began
      for (const x of state.stops.filter((y) => !y.endedAt && y.lineId === null && dayOf(y.startedAt) < date)) updateStop(x.id, { endedAt: Math.max(x.startedAt, last[x.dept] ?? 0) })
    }
    if (opts.purge) gone = purgeDay(date, at)
    const was = state.changes.find((c) => c.id === 'day:' + date)
    putChange({ id: 'day:' + date, at, by: user.get(), dept: null, what: 'Día empezado', before: was && was.at !== at ? fmtTime(was.at) : '', after: fmtTime(at), refTable: DAY_REF, refKey: date, updatedAt: stamp(was) })
  })
  return { date, ended, ...gone }
}
/** the day goes back to being the calendar's */
export function cancelDay(date: string) { const c = state.changes.find((x) => x.id === 'day:' + date); if (c) putChange({ ...c, deleted: true, updatedAt: stamp(c) }) }

/** everyone who took part in a run: who started it and who tapped its units (a break cover shows up by name) */
export function whoText(r: Run) { return [...new Set([r.by, ...r.units.map((u) => u.by)].filter(Boolean))].join(', ') }

/** with a server: the device is emptied and everything comes down again (the server keeps the truth); the pull cursor is cleared so nothing is skipped */
const resync = () => { if (SERVER) { try { localStorage.removeItem('act_since2'); localStorage.removeItem('act_outbox') } catch { /* private */ } window.dispatchEvent(new Event('act-resync')) } }
export function reset() { set(fresh()); resync() }
/** a clean slate for the records only: runs, stops and the schedule go; the lines and the products table stay */
export function resetRecords() { set({ ...state, runs: [], orderRuns: [], stops: [], schedule: {}, changes: [], plans: [], workOrders: [], orderSeals: [] }); resync() }

export const productOf = (s: State, code: string) => s.products.find((p) => normCode(p.code) === normCode(code))
/**
 * Pouches told the way the floor needs them when a cart comes out short: full cases and the loose pouches left over,
 * by the product's pouches per case. null when the products table does not say how many go in a case.
 */
export function inCases(s: State, code: string, pouches: number | null | undefined): { cases: number; loose: number; perCase: number } | null {
  const per = productOf(s, code)?.pouchesPerCase ?? 0
  if (!(per > 0) || pouches == null || !Number.isFinite(pouches) || pouches < 0) return null
  const cases = Math.floor(pouches / per)
  return { cases, loose: Math.round((pouches - cases * per) * 100) / 100, perCase: per }
}
/** "10 cajas y 10 sueltos" */
export const casesText = (c: { cases: number; loose: number } | null) => {
  if (!c) return ''
  const n = c.cases.toLocaleString('en-US'), cases = c.cases === 1 ? tr('{0} caja', n) : tr('{0} cajas', n)
  return c.loose ? tr('{0} y {1}', cases, c.loose === 1 ? tr('{0} suelto', c.loose) : tr('{0} sueltos', c.loose)) : cases
}
/** a unit closed with less than the usual quantity of its run */
export type Short = { run: Run; index: number; unit: Unit; usual: number }
/** the last unit of a run, when it holds less than the usual */
const shortLast = (x: Run): Short | null => { const u = x.units[x.units.length - 1]; return x.perUnit != null && u && u.qty != null && u.qty < x.perUnit ? { run: x, index: x.units.length - 1, unit: u, usual: x.perUnit } : null }
/** the newest end first */
const byEnd = (a: Run, b: Run) => (b.endedAt ?? 0) - (a.endedAt ?? 0)
/**
 * The unit of a running code that was closed short and can still be filled: its last one, when it holds less than the
 * usual quantity; or, while it has none yet, the last one of an earlier run of the same code and lot that day (the
 * cart closed when the code seemed over, which gets more product when the code comes back).
 */
export function shortUnit(s: State, r: Run): Short | null {
  if (r.units.length) return shortLast(r)
  const before = s.runs.filter((x) => x.id !== r.id && x.dept === r.dept && x.date === r.date && !!x.endedAt && normCode(x.code) === normCode(r.code) && x.lot === r.lot && x.units.length > 0).sort(byEnd)[0]
  return before ? shortLast(before) : null
}
/** the code that ended last on a line that day */
export const lastEnded = (s: State, lineId: string, date: string): Run | undefined => s.runs.filter((r) => r.lineId === lineId && r.date === date && !!r.endedAt).sort(byEnd)[0]
/**
 * The codes already ended on a line that day whose last unit was closed short, the newest first: a code marked as
 * finished too early, or one that got more product on its last cart after the line had gone on to another code.
 */
export const shortEnded = (s: State, lineId: string, date: string): Short[] =>
  s.runs.filter((r) => r.lineId === lineId && r.date === date && !!r.endedAt).sort(byEnd).map(shortLast).filter((x): x is Short => !!x)
/** why a code cannot go on the product at position i: it is already another product's ('taken'), or it would leave an existing product without one ('blank') */
export function codeProblem(i: number, code: string): 'taken' | 'blank' | null {
  const key = normCode(code), old = state.products[i]
  if (key && state.products.some((x, k) => k !== i && normCode(x.code) === key)) return 'taken'
  if (old && old.code.trim() && !key) return 'blank'
  return null
}
/**
 * saves a product by its position in the list (a new one goes at the end); a code that changed retires the old row on
 * the server. Refused (false, nothing saved) when the code already belongs to another product, or when it would leave
 * an existing product without a code.
 */
export function saveProduct(i: number, p: Product): boolean {
  if (codeProblem(i, p.code)) return false
  const products = [...state.products]
  const old = products[i]
  const key = normCode(p.code)
  p = { ...p, updatedAt: stamp(old) }
  if (i >= products.length) products.push(p); else products[i] = p
  set({ ...state, products })
  if (old && old.code.trim() && normCode(old.code) !== key) push('act_products', normCode(old.code), rowOfProduct({ ...old, deleted: true, updatedAt: stamp(old) }))
  if (key) push('act_products', key, rowOfProduct(p))
  logProductDiff(old, p)
  return true
}
export function removeProduct(i: number) {
  const p = state.products[i]
  set({ ...state, products: state.products.filter((_, k) => k !== i) })
  if (p && p.code.trim()) push('act_products', normCode(p.code), rowOfProduct({ ...p, deleted: true, updatedAt: clockNow() }))
  if (p) logChange(null, 'Producto ' + (p.code || '(sin código)') + ' quitado', p.name || p.code, '', 'act_products', normCode(p.code))
}
/** products loaded from the office's file: an existing code is updated (blank numbers keep what was there), a new one is added */
/** how Spiral counts a code, said from its program: a product the table does not have yet is added with it */
/** which room packs a code (RTE or MFO), said from Avance: it goes to the products table, which adds the code when it is not there ('' = not said) */
export function setPackRoom(code: string, room: PackRoom | '') {
  const key = normCode(code)
  if (!key) return
  const i = state.products.findIndex((p) => normCode(p.code) === key)
  if ((i >= 0 ? state.products[i].room ?? '' : '') === room) return
  const was: Product = i >= 0 ? state.products[i] : { code: code.trim().toUpperCase(), name: '', pouchesPerCase: 0, casesPerMix: 0, cratesPerCart: 0, pouchesPerCrate: 0, casesPerPallet: 0, updatedAt: 0 }
  const { room: _was, ...bare } = was
  saveProduct(i >= 0 ? i : state.products.length, room ? { ...bare, room } : bare)
}
export function setSpiralUnit(code: string, unit: SpiralUnit) {
  const key = normCode(code)
  if (!key) return
  const i = state.products.findIndex((p) => normCode(p.code) === key)
  if (i >= 0 && (state.products[i].spiralUnit ?? 'mezclas') === unit) return
  saveProduct(i >= 0 ? i : state.products.length, i >= 0 ? { ...state.products[i], spiralUnit: unit } : { code: code.trim().toUpperCase(), name: '', pouchesPerCase: 0, casesPerMix: 0, cratesPerCart: 0, pouchesPerCrate: 0, casesPerPallet: 0, spiralUnit: unit, updatedAt: 0 })
}
export function mergeProducts(list: Product[]) {
  const products = [...state.products]
  let added = 0, changed = 0
  for (const p of list) {
    const i = products.findIndex((x) => normCode(x.code) === normCode(p.code))
    const merged: Product = i < 0 ? { ...p, updatedAt: clockNow() } : { ...products[i], name: p.name || products[i].name, pouchesPerCase: p.pouchesPerCase || products[i].pouchesPerCase, casesPerMix: p.casesPerMix || products[i].casesPerMix, cratesPerCart: p.cratesPerCart || products[i].cratesPerCart, pouchesPerCrate: p.pouchesPerCrate || products[i].pouchesPerCrate, casesPerPallet: p.casesPerPallet || products[i].casesPerPallet, ...((r) => (r ? { room: r } : {}))(p.room || products[i].room), ...((u) => (u ? { spiralUnit: u } : {}))(p.spiralUnit || products[i].spiralUnit), ...((l) => (l ? { lbPerCase: l } : {}))(p.lbPerCase || products[i].lbPerCase), updatedAt: clockNow() }
    if (i < 0) { products.push(merged); added++ } else { if (PRODUCT_FIELDS.some(([k]) => v(products[i][k]) !== v(merged[k]))) { changed++; logProductDiff(products[i], merged) } products[i] = merged }
    push('act_products', normCode(merged.code), rowOfProduct(merged))
  }
  set({ ...state, products })
  logChange(null, 'Importó el CSV de productos', '', list.length + ' productos · ' + added + ' nuevos · ' + changed + ' con cambios', 'act_products', '')
}
export function setSchedule(date: string, code: string, n: number) {
  const key = normCode(code)
  if (!key) return
  const day = { ...(state.schedule[date] ?? {}) }, before = day[key] ?? 0
  for (const c of Object.keys(day)) if (c !== key && normCode(c) === key) delete day[c]
  day[key] = n
  set({ ...state, schedule: { ...state.schedule, [date]: day } })
  push('act_schedule', date + '|' + key, rowOfSchedule(date, key, n))
  logChange(null, 'Programa ' + date + ' · ' + key + ' mezclas', v(before), v(n), 'act_schedule', date + '|' + key)
}
// ---- the program of each room ----
/**
 * The key of one row of a room's program: its day, its room, its code AND its lot. The office, 2026-10-20: RTE had
 * 889 of lot 6292 (15,688 pouches) and 889 of lot 6290 (2,482) to make the same day; the app took a code as one row,
 * so the dialog refused the second lot ("El código 889 está dos veces") and the card added both lots up under the
 * first ("hecho 25,244 · ✓ completo (+9,556)": "aquí me está sumando de varios lotes"). Jose's rule: "la clave está en
 * el lote: si los lotes son iguales que lo descuente; si el lote es diferente que sea otra programación aun si es el
 * mismo código". A row without a lot keeps the key every row had before (date|dept|code), so what waits in a queue or
 * is named in the history from before is still the same row; a row with a lot adds it (date|dept|code|lot).
 * (A function declaration that reads only what is declared above `let state = load()`: pruned() uses it, and so does
 * rekeyQueuedPlans when this file is read)
 */
function planKey(date: string, dept: Dept, code: string, lot: unknown = ''): string {
  const l = String(lot ?? '').trim().slice(0, PLAN_LOT_MAX)
  return date + '|' + dept + '|' + normCode(code) + (l ? '|' + l : '')
}
/** the lot of a program as it is kept and sent: trimmed, at most PLAN_LOT_MAX; '' = none (a row from before 019 has no column: it reads '') */
export const planLot = (x: unknown) => String(x ?? '').trim().slice(0, PLAN_LOT_MAX)
/** the key of a program row as the server sends it (sync.ts collects them on a whole pull: keepServerPlans) */
export const planKeyOfRow = (row: Row) => planKey(String(row.date ?? '').slice(0, 10), row.dept as Dept, String(row.code ?? ''), row.lot)
/**
 * the keys the history may name a program row by: its own, and, for a row with a lot, its code's key of before
 * 2026-10-20 (one row per code then, carrying its lot: those lines are of this code that day). The window of a
 * production order lists its programs' history by them (WorkOrders.tsx, sync.ts loadOrderRows)
 */
export function planRefKeys(p: Pick<Plan, 'date' | 'dept' | 'code' | 'lot'>): string[] {
  const own = planKey(p.date, p.dept, p.code, p.lot), old = planKey(p.date, p.dept, p.code)
  return own === old ? [own] : [own, old]
}
/**
 * Whether a line of the history is of one of these program rows (a production order's window lists the lines of the
 * rows that name it). A line under a row's own key is its. Under the key of its code alone, a row with a lot takes only
 * the lines that name its lot (" · lote 6292"): those are the ones of before 2026-10-20, when the code's one row
 * carried its lot; this build writes under that key the lines of the code's row WITHOUT a lot, which are not this
 * row's (review of 2026-10-20: an order of 889 lote 6292 listed the 1,000 of the 889 without a lot, not linked to it)
 */
export function planLinesOf(plans: Pick<Plan, 'date' | 'dept' | 'code' | 'lot'>[]): (c: Pick<Change, 'refTable' | 'refKey' | 'what'>) => boolean {
  const own = new Set<string>(), byLot = new Map<string, Set<string>>()
  for (const p of plans) {
    const [mine, old] = planRefKeys(p)
    own.add(mine)
    if (old) { const l = byLot.get(old) ?? new Set<string>(); l.add(planLot(p.lot)); byLot.set(old, l) }
  }
  return (c) => {
    if (c.refTable !== 'act_plan') return false
    if (own.has(c.refKey)) return true
    const lots = byLot.get(c.refKey)
    return !!lots && c.what.split(' · ').some((part) => part.startsWith('lote ') && lots.has(part.slice(5).trim()))
  }
}
/** two rows of a program in the order the screens list them: by code, then by lot (by number), the row without a lot last (it counts what the others leave) */
export const byPlanLot = (a: { lot: string }, b: { lot: string }) => Number(!planLot(a.lot)) - Number(!planLot(b.lot)) || planLot(a.lot).localeCompare(planLot(b.lot), undefined, { numeric: true })
/**
 * A program queued by a build of before 2026-10-20 waits under its code's key alone, whatever its lot. Once, when this
 * file is read, it is given the key this build gives it: otherwise a newer version of the server's row would not find
 * it (keepNewer), and the row of its code without a lot would take it for its own (and could drop it from the queue).
 * Nothing is sent or dropped here: the row goes up as it was, with the key of its lot
 */
export function rekeyQueuedPlans() {
  for (const it of outbox.items()) {
    if (it.table !== 'act_plan') continue
    const date = String(it.row.date ?? '').slice(0, 10), dept = it.row.dept
    if (!isDay(date) || !roomKnown(dept) || !normCode(String(it.row.code ?? ''))) continue
    const key = planKey(date, dept, String(it.row.code ?? ''), it.row.lot)
    if (key !== it.key) rekey('act_plan', it.key, key)
  }
}
rekeyQueuedPlans()
/** " · lote 6291" after a program's name in the history ('' without a lot) */
const lotNote = (lot: string) => (lot ? ' · lote ' + lot : '')
// (the lot goes up always, '' when none: until Jose runs 019 the server answers that the column is missing and the
// row waits in the queue, said on the screen; see outbox.ts. The production order too, null when none (Jose,
// 2026-10-19): the whole row stands, so a program unlinked on a device is unlinked on the server. Until 020 is run a
// program without one goes up without the column, and one with an order waits, said on the screen: see outbox.ts)
// (end_date goes up only when the row has or had one: a day's program keeps going up as before 025 was run)
// (note the same: only when the row has or had one, SQL 026)
const rowOfPlan = (p: Plan, withEnd = !!p.endDate, withNote = !!p.note) => ({ date: p.date, dept: p.dept, code: normCode(p.code), qty: p.qty, lot: planLot(p.lot), order_id: p.orderId ?? null, ...(withEnd ? { end_date: p.endDate ?? null } : {}), ...(withNote ? { note: p.note ?? null } : {}), updated_at: iso(p.updatedAt), updated_by: user.get() })
/** the most days a program may run for (the device keeps 14 days of records: every day of the program stays countable) */
export const PLAN_SPAN_MAX = 14
/** a row's last day: its endDate, or its day */
export const planEnd = (p: Pick<Plan, 'date' | 'endDate'>) => p.endDate ?? p.date
/** whether a row's program runs on a day */
export const planCovers = (p: Pick<Plan, 'date' | 'endDate'>, date: string) => p.date === date || (!!p.endDate && p.date <= date && date <= p.endDate)
/** every day of a row's program, first to last */
export function planDays(p: Pick<Plan, 'date' | 'endDate'>): string[] {
  const out = [p.date]
  for (let d = p.date, i = 0; p.endDate && d < p.endDate && i < PLAN_SPAN_MAX; i++) { d = dayAfter(d); out.push(d) }
  return out
}
/** the end day a program is given, or undefined: only a day after its first, at most PLAN_SPAN_MAX days later */
function planEndOf(date: string, end: string | undefined | null): string | undefined {
  if (!end || !isDay(end) || end <= date) return undefined
  return daysApart(date, end) <= PLAN_SPAN_MAX ? end : undefined
}
const daysApart = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86_400_000)
/** " · del 2026-10-27 al 2026-10-29" after a program's name in the history when it runs for several days */
const spanNote = (p: Pick<Plan, 'date' | 'endDate'>) => (p.endDate ? ' · del ' + p.date + ' al ' + p.endDate : '')
/**
 * " · pedido WO 4512" (or " · pedido 889 desde 2026-10-18" when it has no WO number) after a program's name in the
 * history; '' without an order. An order this device does not have is named by the start of its id
 */
function orderNote(id: string | null | undefined) {
  if (!id) return ''
  const o = state.workOrders.find((x) => x.id === id)
  return ' · pedido ' + (o ? (o.wo ? 'WO ' + o.wo : o.code + ' desde ' + o.startDate) : id.slice(0, 8))
}
/** what a room has on its program for a day */
/** the rows of a room's program running on a day: the day's own, and those of several days that include it */
export const planOf = (s: State, date: string, dept: Dept) => s.plans.filter((p) => p.dept === dept && p.qty > 0 && planCovers(p, date))
/**
 * the office sets how much of a code a room has to make on a day, for which lot (Jose, 2026-10-19; '' = no lot):
 * nothing = that row is taken off the program. A row is its code AND its lot (2026-10-20, see planKey): the same code
 * with another lot is another row, never a change of this one. The program dialog moves a row to another lot by
 * taking the old one off (0) and setting the new one, both said in the history.
 * orderId (Jose and the office, 2026-10-19): the production order this program is a part of. undefined = as it was
 * (a program changed without saying keeps its order), null or '' = none (a plain day's program). Another order, or
 * none, is a change too, said in the history
 */
/** endDate: undefined = as it was; '' = a day's program; a day = the program's last day (see Plan). note the same: undefined = as it was, '' = none */
export function setPlan(date: string, dept: Dept, code: string, qty: number, lot = '', orderId?: string | null, endDate?: string | null, note?: string | null) {
  const key = normCode(code)
  if (!key || !isDay(date) || !DEPTS.includes(dept)) return
  const n = Number.isFinite(qty) && qty > 0 ? Math.round(qty * 100) / 100 : 0
  const l = planLot(lot)
  const old = state.plans.find((p) => p.date === date && p.dept === dept && normCode(p.code) === key && planLot(p.lot) === l)
  const end = endDate === undefined ? old?.endDate : planEndOf(date, endDate)
  const nt = note === undefined ? old?.note : planNote(note) || undefined
  // a code with nothing programmed stays off the program: the dialog fills the day's lot into every row, so a code
  // typed with its quantity blank came with a lot and used to make a row of 0 with it, sent to the server and saying
  // nothing (review of 2026-10-19). Taking a row off (a quantity it had → 0) still goes through
  if (n === 0 && !(old && old.qty > 0)) return
  const link = orderId === undefined ? old?.orderId : isUuid(orderId) ? orderId : undefined
  if ((old?.qty ?? 0) === n && (old?.orderId ?? '') === (link ?? '') && (old?.endDate ?? '') === (end ?? '') && (old?.note ?? '') === (nt ?? '')) return
  const p: Plan = { date, dept, code: code.trim().toUpperCase(), qty: n, lot: l, ...(link ? { orderId: link } : {}), ...(end ? { endDate: end } : {}), ...(nt ? { note: nt } : {}), updatedAt: stamp(old) }
  set({ ...state, plans: [...state.plans.filter((x) => x !== old), p] })
  const k = planKey(date, dept, key, l)
  push('act_plan', k, rowOfPlan(p, !!end || !!old?.endDate, !!nt || !!old?.note))
  // the line names the row (its code and its lot, its days when it runs for several) and the order it is a part of
  // now; "before" is the quantity it had (nothing when it had none), with the order it had when that changed (or "sin
  // pedido") and its days when those changed
  const was0 = v(old?.qty), relinked = (old?.orderId ?? '') !== (link ?? ''), respanned = !!old && (old.endDate ?? '') !== (end ?? '')
  const was = was0 && (relinked || respanned) ? was0 + (relinked ? (old?.orderId ? orderNote(old.orderId) : ' · sin pedido') : '') + (respanned ? (old?.endDate ? spanNote(old) : ' · un día') : '') : was0
  // (the comment goes after the quantity, on both sides when it changed)
  const renoted = !!old && (old.note ?? '') !== (nt ?? '')
  logChange(dept, 'Programa ' + date + (end ? ' al ' + end : '') + ' · ' + dept + ' · ' + key + lotNote(l) + orderNote(link), renoted && old?.note ? was + ' · ' + old.note : was, nt && (renoted || !old) ? v(n) + ' · ' + nt : v(n), 'act_plan', k)
}
/**
 * One row of a room's day against its program: what was set, what the room has registered of it (in all, and by each
 * shift, as the office's sheet has its "1 TURNO" and "2 TURNO"), and what is left: programmed minus made, taken off by
 * itself with every unit registered (negative = more than the program, the red cells of that sheet).
 * planned 0 = a code the room made that was not on its program (one row for the code, whatever its lots).
 */
/**
 * unit = the word of the quantity: the room's, or in Spiral and MFO each code's (mezclas, lb, cajas; platos, copas,
 * lb); kind = that word as the runs carry it ('' = the room's own); other = what was registered of the code in another word
 */
/**
 * the word a code's MFO bins hold, as the newest bin of it among `runs` says ('' = platos; 'copas', 'lb'; 'cajas' when
 * a bin was typed so); undefined when none of them has a bin. MFO's program is read in this word (planRows), and so is
 * the lot's program in Flujo when the lot has no bin of the code yet (review of 2026-10-19: both must say the same)
 */
export const mfoBinWord = (runs: Run[], code: string): string | undefined => { const key = normCode(code); return runs.filter((r) => r.dept === 'MFO' && normCode(r.code) === key && !!binOf(r)).sort((a, b) => b.startedAt - a.startedAt).map(apartOf)[0] }
/**
 * What one unit gives each lot it carries, counted as a room's program counts it (planRows, madeOfLot): a unit that
 * says its lots (a pallet of two lots, a Packing bin of a lot that is not its run's) gives each lot its part; one that
 * says none belongs whole to its run's lot, as unitParts in report.ts reads a unit (written again here: report.ts reads
 * this file). Kitchen, RTE, Spiral and MFO record no change of lot inside a run (the line ends the code and starts it
 * again with the other lot, as RTE did with 889 on 2026-10-20): each of their units is its run's lot.
 * byCount = a room that counts units (Kitchen's and Spiral's mezclas one by one): a unit is one, and one that names
 * several lots goes whole to the lot with most of it (palletOwner's rule): two rows never count the same unit
 */
function lotShares(s: State, r: Run, u: Unit, byCount: boolean): { lot: string; n: number }[] {
  if (u.lots?.length) {
    if (!byCount) return u.lots.map((l) => ({ lot: planLot(l.lot), n: l.qty }))
    const top = u.lots.reduce((best, l) => (l.qty > best.qty ? l : best), u.lots[0])
    return [{ lot: planLot(top.lot), n: 1 }]
  }
  return [{ lot: planLot(r.lot), n: byCount ? 1 : unitQty(s, r, u) }]
}
/**
 * lot = the lot the row names ('' = none, a day's program as before 2026-10-19); orderId = the production order it is
 * a part of ('' = none, 2026-10-19). also = what the room made of the code that day in lots no row of it names, lot by
 * lot (said on the code's first row, never added into one: the office, 2026-10-20). Only when the code has no row
 * without a lot: that row counts them
 */
/**
 * from/to = the days the row's program runs (one day: both the day asked for); before = what its earlier days made of
 * it (in done; today = the day's own, which byShift splits). A program of several days is counted on every one of its
 * days against the same total (2026-10-28)
 */
export type PlanRow = { code: string; name: string; planned: number; done: number; byShift: [number, number]; left: number; running: boolean; lines: string[]; unit: string; kind: string; other: { word: string; n: number }[]; lot: string; orderId: string; also: { lot: string; n: number }[]; from: string; to: string; before: number; today: number; note: string }
/**
 * The rows of a room's program for a day, each against what was made OF ITS LOT (the office, 2026-10-20: 889 of lot
 * 6292 programmed 15,688 showed "hecho 25,244 · ✓ completo (+9,556)": the 9,556 of lot 6290 were added in). Each unit
 * goes to the row of its lot (lotShares); a row without a lot takes the code's units whose lot no row of that code
 * names; what is left (the code has no row without a lot, and a lot nobody programmed was made) is said apart (also).
 * Two rows never count the same unit. By shift the same. A code made that day and not on the program is one row of
 * planned 0, with all of it
 */
export function planRows(s: State, date: string, dept: Dept): PlanRow[] {
  const cfg = CFG[dept], hours = shiftsOf(s, date, dept)
  const all = s.runs.filter((r) => r.dept === dept && r.date === date), plan = planOf(s, date, dept)
  const keys = [...new Set([...plan.map((p) => normCode(p.code)), ...all.map((r) => normCode(r.code))])]
  const roomUnit = cfg.qty === 'none' ? cfg.plural.toLowerCase() : cfg.qtyUnit
  const out: PlanRow[] = []
  for (const key of keys) {
    const sets = plan.filter((p) => normCode(p.code) === key).sort(byPlanLot), product = productOf(s, key), ofCode = all.filter((r) => normCode(r.code) === key)
    // Spiral: the code's measure is the products table's; or else the one its mezclas were started with today. MFO:
    // what the code's bins hold (platos, copas, pounds): as today's bins of it say, else as it was counted last on this
    // device, else platos
    const mfoKind = () => mfoBinWord(ofCode, key) ?? mfoBinWord(s.runs, key) ?? ''
    const measure: string = dept === 'MFO' ? mfoKind() : dept !== 'Spiral' ? '' : product?.spiralUnit ? (product.spiralUnit === 'mezclas' ? '' : product.spiralUnit) : (ofCode.map(measureOf).find(Boolean) ?? '')
    // what counts for the program: the runs in the code's measure (bins, and mezclas in another measure, stay apart)
    const mine = ofCode.filter((r) => apartOf(r) === measure), byCount = cfg.qty === 'none' && !measure
    const wordOf = (w: string) => (dept === 'Spiral' ? measureUnit(w) : w ? apartWord(dept, w) : roomUnit)
    const other = [...ofCode.filter((r) => apartOf(r) !== measure && (dept === 'Spiral' || dept === 'MFO' || !!apartOf(r))).reduce((m, r) => { const w = apartOf(r), n = w || cfg.qty !== 'none' ? runQty(s, r) : r.units.length; return m.set(w, (m.get(w) ?? 0) + n) }, new Map<string, number>())].filter(([, n]) => n > 0).map(([word, n]) => ({ word: wordOf(word), n }))
    // the row a lot's units go to: the row of that lot; else the code's row without a lot; else none (-1: said apart).
    // A code off the program has one row, and every unit of it is its
    const loose = sets.findIndex((p) => !planLot(p.lot))
    const rowOf = (lot: string) => { if (!sets.length) return 0; const i = lot ? sets.findIndex((p) => planLot(p.lot) === lot) : -1; return i >= 0 ? i : loose }
    const made = (sets.length ? sets : [null]).map(() => [0, 0, 0])
    const also = new Map<string, number>()
    for (const r of mine) for (const u of r.units) {
      const k = shiftAt(hours, u.at)
      for (const x of lotShares(s, r, u, byCount)) {
        const i = rowOf(x.lot)
        if (i < 0) { also.set(x.lot, (also.get(x.lot) ?? 0) + x.n); continue }
        made[i][0] += x.n; made[i][k] += x.n
      }
    }
    // the lines running the code now, each on the row of the lot it is on now
    const open = mine.filter((r) => !r.endedAt)
    const code = product?.code ?? sets[0]?.code ?? mine[0]?.code ?? ofCode[0]?.code ?? key, unit = measure ? wordOf(measure) : roomUnit
    const alsoList = [...also].filter(([, n]) => n > 0).map(([lot, n]) => ({ lot, n: Math.round(n * 100) / 100 })).sort(byPlanLot)
    made.forEach(([today, one, two], i) => {
      const p = sets[i], planned = p?.qty ?? 0, lines = [...new Set(open.filter((r) => rowOf(planLot(lotNowOf(r))) === i).map((r) => lineNameOf(s, r.lineId, r.line)))]
      // a program of several days: what its earlier days made of it (its lot's units; a row without a lot takes the
      // units of lots no row of the code running that day names)
      const before = p && p.endDate && p.date < date ? planDays(p).filter((d) => d < date).reduce((t, d) => t + madeForRow(s, dept, key, planLot(p.lot), d, measure), 0) : 0
      const done = Math.round((before + today) * 100) / 100
      out.push({ code, name: product?.name ?? '', planned, done, byShift: [one, two], left: planned ? Math.round((planned - done) * 100) / 100 : 0, running: lines.length > 0, unit, kind: measure, other: i ? [] : other, lines, lot: p ? planLot(p.lot) : '', orderId: p?.orderId ?? '', also: i ? [] : alsoList, from: p?.date ?? date, to: p ? planEnd(p) : date, before: Math.round(before * 100) / 100, today: Math.round(today * 100) / 100, note: p?.note ?? '' })
    })
  }
  return out.sort((a, b) => Number(b.planned > 0) - Number(a.planned > 0) || a.code.localeCompare(b.code, undefined, { numeric: true }) || byPlanLot(a, b))
}
/**
 * A code's program of the day where the room counts mezclas one by one (Kitchen, and Spiral by the mezcla): what was
 * programmed for it (its lot's row, else its row without a lot), what was made and what is left; null when the code
 * has no program for that lot today (the office, 2026-10-23: a Spiral supervisor recorded more mezclas than the
 * program because he started the same code for another one: "si están programadas 5 o 10, que no se pueda hacer más
 * de esa cantidad; si hicieron de más, que vengan a hablar con la oficina")
 */
export function programCapOf(s: State, date: string, dept: Dept, code: string, lot: string) {
  if ((dept !== 'Kitchen' && dept !== 'Spiral') || !normCode(code)) return null
  const rows = planRows(s, date, dept).filter((r) => normCode(r.code) === normCode(code) && r.planned > 0 && !r.kind)
  const row = rows.find((r) => !!r.lot && r.lot === lot.trim()) ?? rows.find((r) => !r.lot) ?? null
  return row ? { planned: row.planned, done: row.done, left: row.left, unit: row.unit, code: row.code, lot: row.lot } : null
}
/** the program cap of a run's next mezcla (a run counted in pounds or cases is not capped) */
export const programCap = (s: State, r: Run) => (apartOf(r) ? null : programCapOf(s, r.date, r.dept, r.code, lotNowOf(r)))
// ---- a code and its lot that go on into the next day ----
/** the day after / before a date (YYYY-MM-DD) */
export const dayAfter = (d: string) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + 1); return dayOf(x.getTime()) }
export const dayBefore = (d: string) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() - 1); return dayOf(x.getTime()) }
/**
 * what a room's runs of a day made of a code with one lot, in the room's measure (a pallet with two lots gives the
 * cases of that one), unit by unit as the program counts them (lotShares: a unit without lots is its run's lot; until
 * 2026-10-20 it counted for the lot its run was packing at the end too, so one unit could count for two lots)
 */
/**
 * what a day made for a program row of a code and lot (lot '' = the row without one: the code's units in lots no row
 * of the code running that day names; see planRows, rowOf): for the earlier days of a program of several days
 */
function madeForRow(s: State, dept: Dept, code: string, lot: string, date: string, kind: string) {
  if (lot) return madeOfLot(s, dept, code, lot, date, kind)
  const named = new Set(planOf(s, date, dept).filter((p) => normCode(p.code) === normCode(code)).map((p) => planLot(p.lot)).filter(Boolean))
  const key = normCode(code), cfg = CFG[dept]
  return s.runs.filter((r) => r.dept === dept && r.date === date && normCode(r.code) === key && apartOf(r) === kind).reduce((t, r) => {
    const byCount = cfg.qty === 'none' && !apartOf(r)
    return t + r.units.reduce((a, u) => a + lotShares(s, r, u, byCount).reduce((q, x) => q + (named.has(x.lot) ? 0 : x.n), 0), 0)
  }, 0)
}
function madeOfLot(s: State, dept: Dept, code: string, lot: string, date: string, kind?: string) {
  const key = normCode(code), cfg = CFG[dept], l = planLot(lot)
  // (with a word, only the runs counted in it: a code's program is in one word, see planRows)
  return s.runs.filter((r) => r.dept === dept && r.date === date && normCode(r.code) === key && (kind === undefined || apartOf(r) === kind)).reduce((t, r) => {
    const byCount = cfg.qty === 'none' && !apartOf(r)
    return t + r.units.reduce((a, u) => a + lotShares(s, r, u, byCount).reduce((q, x) => q + (x.lot === l ? x.n : 0), 0), 0)
  }, 0)
}
/**
 * What each room left pending of its program on a day and went on with the next day: the next day's runs of that
 * code with that row's lot, or with that day's lot (see lotFor) for a row without one. Each in the room's own unit;
 * done = the next day finished it. lot = the row's ('' = none). Since 2026-10-20 a code may have a row per lot: each
 * goes on with its own lot, and a row without a lot never takes a lot one of its code's rows names (that row's units
 * are that row's: two rows never count the same unit)
 */
export type CarryRow = { dept: Dept; code: string; lot: string; unit: string; pending: number; made: number; next: string; done: boolean }
export function carriedOver(s: State, date: string): CarryRow[] {
  const next = dayAfter(date), dayLot = lotFor(date), out: CarryRow[] = []
  for (const dept of DEPTS) {
    const rows = planRows(s, date, dept)
    for (const row of rows) {
      if (!(row.planned > 0 && row.left > 0) || row.to > date) continue
      const named = !row.lot && rows.some((x) => x.planned > 0 && x.lot === dayLot && normCode(x.code) === normCode(row.code))
      const made = named ? 0 : madeOfLot(s, dept, row.code, row.lot || dayLot, next, row.kind)
      out.push({ dept, code: row.code, lot: row.lot, unit: row.unit, pending: row.left, made, next, done: made >= row.left })
    }
  }
  return out
}
/**
 * what a day's runs made of the day before's lot: codes that came on from the day before, in each room's unit (a code
 * with a row of its program per lot, 2026-10-20, counts in one word in all of them: the first row says it)
 */
export function cameFrom(s: State, date: string): { dept: Dept; code: string; unit: string; made: number; from: string }[] {
  const from = dayBefore(date), lot = lotFor(from), out: { dept: Dept; code: string; unit: string; made: number; from: string }[] = []
  for (const dept of DEPTS) {
    const rows = planRows(s, date, dept)
    for (const key of new Set(s.runs.filter((r) => r.dept === dept && r.date === date).map((r) => normCode(r.code)))) {
      const row = rows.find((x) => normCode(x.code) === key), made = madeOfLot(s, dept, key, lot, date, row?.kind)
      if (made > 0) { out.push({ dept, code: row?.code ?? key, unit: row?.unit ?? (CFG[dept].qty === 'none' ? CFG[dept].plural.toLowerCase() : CFG[dept].qtyUnit), made, from }) }
    }
  }
  return out
}
// ---- the production orders of each room ----
/**
 * The office clerk's correction of 2026-10-19, relayed by Jose: "No es una cantidad por lote, es una cantidad por
 * mezcla: el pedido es de 1000 mezclas; el día 1 se programa hacer 80: de las 1000 le quitas 80 → 920 sin programar,
 * aparte de las 80 del día 1. El día 1 hicieron 50 → quedan 30 pendientes; esos 30 vuelven: 920 + 30 = 950 disponibles
 * para el día 2. El día 2 se programan 80 de los 950 → 870; si el día 2 hacen 70 → 10 pendientes; 870 + 10 = 880
 * disponibles para el día 3."
 * So an order (WorkOrder) is so much of a code for one room, from a day on, typed once by the office; what is still
 * available of it ("Disponible") is its quantity minus everything the room made for it; each day's program is a part
 * of it (Plan.orderId); and what a day did not make goes back to the order: it is never carried over as a program (the
 * office programs every day again, and the room's card only says what yesterday left). Each room has its own orders in
 * its own unit; the lot stays on each day's program, optional, as before.
 *
 * What the room registers of the code counts for its open orders, oldest first (foldQueue): a unit for exactly one
 * order, whole (an RTE cart of 240 that completes an order of 1000 leaves it at 1200, it is never split); when one is
 * complete the next units go to the next one; nothing before an order's start day counts for it, and an order closed
 * by hand takes nothing from that moment on. A day's program that names an order takes that day's units first (of
 * its lot, when the code has a row per lot: 2026-10-20), up to its quantity: by default the program names the oldest open order, so this is the same thing; it differs only when
 * the office chose a later order for the day (without it, the order chosen would show "pending" while the room had
 * made the units).
 */
/** the queue of orders a run or an order belongs to: its room, its code and the word it is counted in ('' = the room's own) */
export const woQueue = (dept: Dept, code: string, kind: string) => dept + '|' + normCode(code) + '|' + kind
/**
 * the word an order counts in, as its room's runs carry it (apartOf): Spiral's pounds or cases; MFO's copas or pounds
 * (or the cases of the bins of before 2026-10-17). '' = the room's own count: mezclas, pouches, pallets of cases, bins
 * of platos. Runs counted in another word never count for it (a Packing line's bins do not count for an order of cases)
 */
export function orderKind(o: Pick<WorkOrder, 'dept' | 'unit'>): string {
  if (o.dept === 'Spiral') return o.unit === 'lb' || o.unit === 'cajas' ? o.unit : ''
  if (o.dept === 'MFO') return !o.unit || o.unit === 'platos' ? '' : o.unit
  return ''
}
/** the queue an order is in (see woQueue) */
export const orderQueue = (o: Pick<WorkOrder, 'dept' | 'code' | 'unit'>) => woQueue(o.dept, o.code, orderKind(o))
/**
 * the unit a new order of a code is offered in (shown, and changed with a tap): Spiral's as the products table counts
 * the code, MFO's as its last bins on this device said (platos when none did), the room's own elsewhere
 */
export function orderUnitDefault(s: State, dept: Dept, code: string): string {
  if (dept === 'Spiral') return productOf(s, code)?.spiralUnit ?? 'mezclas'
  if (dept === 'MFO') { const w = mfoBinWord(s.runs, code); return w && WO_UNITS.MFO.includes(w) ? w : 'platos' }
  return WO_UNITS[dept][0]
}
/** an order's unit as the screen says it: mezclas, lb, cajas, pouches, platos, copas */
export function orderUnitWord(o: Pick<WorkOrder, 'dept' | 'unit'>): string {
  const k = orderKind(o)
  if (o.dept === 'Kitchen') return tr('mezclas')
  if (o.dept === 'Spiral') return measureUnit(k)
  if (o.dept === 'RTE') return tr('pouches')
  if (o.dept === 'MFO') return k === 'lb' ? tr('lb') : binWord(k || 'platos')
  return tr('cajas')
}
/** an order's unit as the history keeps it: data, in Spanish ('' from the server is the room's own) */
const unitKept = (o: Pick<WorkOrder, 'dept' | 'unit'>) => o.unit || WO_UNITS[o.dept][0]
/** oldest first: by start day, then by when it was typed (the shared clock), then by its id (the same on every device) */
const fifo = (a: WorkOrder, b: WorkOrder) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
/** quantities as typed carry at most two decimals: sums stay so (pounds added up do not end in …0000001) */
const r2 = (x: number) => Math.round(x * 100) / 100
/** an order by its id (the deleted ones too) */
export const workOrderOf = (s: State, id: string | null | undefined) => (id ? s.workOrders.find((o) => o.id === id) : undefined)
/**
 * The product codes of a room are typed with and without their zeros ("0889", "889") and the server compares text:
 * the spellings of a code to ask it for. A numeric code with its zeros up to six digits; any other code as it is and in
 * small letters. What comes back is still checked with normCode
 */
export function codeVariants(code: string): string[] {
  const k = normCode(code)
  if (/^\d+$/.test(k)) { const out: string[] = []; for (let t = k; t.length <= 6; t = '0' + t) out.push(t); return out.length ? out : [k] }
  return [...new Set([k, k.toLowerCase()])]
}

// ---- the account of a finished order ----
/**
 * A device keeps 14 days and an order can last longer than that: the office's own example, 1000 mezclas at 80 a day,
 * lasts about 13. While an order is in play its device keeps (pruned) or brings (sync.ts, bringWorkOrderRuns) every
 * record of its code since it started. Once it and every order of its queue that overlaps it have finished (complete
 * or closed) before the days the device keeps, their account is closed (OrderSeal): their numbers are frozen and their
 * old records can go, without "Disponible" or "Completado" changing (a completed order whose records were let go would
 * otherwise read as open again). The account is shared as a mark in the history table (act_changes, ref_table
 * WO_DONE_REF), so a new device does not have to bring the plant's past to know it. It stands only while nothing of
 * its queue changed (sig): an order typed later with an earlier start day, or one of them changed, reopened or
 * deleted, voids it, and it is worked out again from the records.
 */
/**
 * The fingerprint an account keeps of its queue (review of 2026-10-19). Until then it kept the list itself, every order
 * of the code typed so far, so each account of a code was longer than the one before (a year of weekly orders of one
 * code: 200,000 letters on every device, and as much again in the marks) and checking every account took a moment on
 * each change. Now it keeps 16 letters worked out from that same list (cyrb53's mixing, two 32-bit lanes: the same on
 * every device) and how many orders it holds: an order typed later with an earlier start day, or one of them changed,
 * reopened or deleted, still gives other letters and voids the account. The list goes in start-day order (then by id),
 * so the fingerprints of every day of a queue come out of one pass over it (woIndex)
 */
type Fp = [number, number]
const FP0: Fp = [0xdeadbeef, 0x41c6ce57]
const fpAdd = (h: Fp, text: string): Fp => { let h1 = h[0], h2 = h[1]; for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677) } return [h1, h2] }
const fpEnd = (h: Fp) => { let h1 = Math.imul(h[0] ^ (h[0] >>> 16), 2246822507); h1 ^= Math.imul(h[1] ^ (h[1] >>> 13), 3266489909); let h2 = Math.imul(h[1] ^ (h[1] >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909); return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0') }
/** the orders by id and by queue (in the order they are kept), and each queue's fingerprints by start day: worked out once per list of orders, a new list only when an order changes */
type WoIndex = { byId: Map<string, WorkOrder>; byQ: Map<string, WorkOrder[]>; sigs: Map<string, { days: string[]; sigs: string[] }> }
const woIndexMemo = new WeakMap<WorkOrder[], WoIndex>()
function woIndex(list: WorkOrder[]): WoIndex {
  const hit = woIndexMemo.get(list)
  if (hit) return hit
  const byId = new Map<string, WorkOrder>(), byQ = new Map<string, WorkOrder[]>()
  for (const o of list) { if (!byId.has(o.id)) byId.set(o.id, o); const q = orderQueue(o), l = byQ.get(q); if (l) l.push(o); else byQ.set(q, [o]) }
  const out: WoIndex = { byId, byQ, sigs: new Map() }
  woIndexMemo.set(list, out)
  return out
}
/** the fingerprint of the orders of o's queue (deleted ones too) that start on or before upto */
function sealSig(s: State, o: WorkOrder, upto: string): string {
  const ix = woIndex(s.workOrders), q = orderQueue(o)
  let f = ix.sigs.get(q)
  if (!f) {
    const list = [...(ix.byQ.get(q) ?? [])].sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const g = { days: [] as string[], sigs: [] as string[] }
    let h = FP0
    list.forEach((x, k) => {
      h = fpAdd(h, JSON.stringify([x.id, x.startDate, x.createdAt, x.qty, x.closedAt, !!x.deleted, x.unit, x.code, ...(x.lot ? [x.lot] : [])]))
      if (k === list.length - 1 || list[k + 1].startDate !== x.startDate) { g.days.push(x.startDate); g.sigs.push(k + 1 + ':' + fpEnd(h)) }
    })
    f = g
    ix.sigs.set(q, f)
  }
  // the last start day on or before upto (the days are in order: halved until found)
  let lo = 0, hi = f.days.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (f.days[mid] <= upto) lo = mid + 1; else hi = mid }
  return lo ? f.sigs[lo - 1] : '0:' + fpEnd(FP0)
}
/** an order's closed account, if it has one (standing or not: see sealedIds); by id, once per list of accounts */
const sealIndexMemo = new WeakMap<OrderSeal[], Map<string, OrderSeal>>()
function sealOf(s: State, id: string): OrderSeal | undefined {
  let m = sealIndexMemo.get(s.orderSeals)
  if (!m) { m = new Map(); for (const x of s.orderSeals) if (!m.has(x.id)) m.set(x.id, x); sealIndexMemo.set(s.orderSeals, m) }
  return m.get(id)
}
/** the orders whose closed account still stands: worked out again only when the orders or the accounts change */
const sealMemo = new WeakMap<OrderSeal[], { orders: WorkOrder[]; ids: Set<string> }>()
function sealedIds(s: State): Set<string> {
  const hit = sealMemo.get(s.orderSeals)
  if (hit && hit.orders === s.workOrders) return hit.ids
  const ids = new Set<string>(), ix = woIndex(s.workOrders)
  for (const seal of s.orderSeals) { const o = ix.byId.get(seal.id); if (o && !o.deleted && seal.sig === sealSig(s, o, seal.upto)) ids.add(o.id) }
  sealMemo.set(s.orderSeals, { orders: s.workOrders, ids })
  return ids
}
/** the orders of a queue still worked out from their records (not deleted, no standing account), oldest first (once per state and queue) */
const liveMemo = new WeakMap<State, Map<string, WorkOrder[]>>()
function liveOrders(s: State, q: string): WorkOrder[] {
  let m = liveMemo.get(s)
  if (!m) { m = new Map(); liveMemo.set(s, m) }
  let list = m.get(q)
  if (!list) { const sealed = sealedIds(s); list = (woIndex(s.workOrders).byQ.get(q) ?? []).filter((o) => !o.deleted && !sealed.has(o.id)).sort(fifo); m.set(q, list) }
  return list
}
/** what a device has to keep (and bring) for its production orders: each queue with an order still worked out from its records, from its first start day */
export type WorkNeed = { q: string; dept: Dept; code: string; kind: string; from: string }
// (a function declaration: pruned() uses it, and pruned() sits above `let state = load()`)
export function workNeeds(s: State): WorkNeed[] {
  const out = new Map<string, WorkNeed>(), sealed = sealedIds(s)
  for (const o of s.workOrders) {
    if (o.deleted || sealed.has(o.id)) continue
    const q = orderQueue(o), was = out.get(q)
    if (!was || o.startDate < was.from) out.set(q, { q, dept: o.dept, code: o.code, kind: orderKind(o), from: o.startDate })
  }
  return [...out.values()]
}

// ---- what each order has made ----
export type OrderState = 'abierto' | 'completado' | 'cerrado' | 'borrado'
/** a run that counted for an order: how many of its units and how much they made for it */
export type OrderRunPart = { runId: string; day: string; units: number; n: number }
/**
 * An order's numbers, as the office keeps them (Jose, 2026-10-19).
 *  - made: everything made for it; disponible: its quantity minus that (never below 0; over: what was made beyond it).
 *  - pendingToday: what the programs of today and later still have pending of it; sinProgramar: what is available and
 *    not programmed yet (disponible − pendingToday).
 *  - byDay: the office's sum, day by day (OrderDay). completedAt / completedBy: the unit that completed it.
 *  - finishAt / finishDay: when it finished (completed, or closed by hand: whichever came first); '' while open.
 *  - state: abierto / completado / cerrado / borrado; waiting: it starts on a day still to come.
 *  - lots: the lots of what counted, and of its programs. runs: the runs that counted.
 *  - complete: this device holds every record it is made of (when not, the numbers can be short: the screens say so
 *    and ask the server). sealed: the numbers come from its closed account.
 */
export type OrderStatus = { id: string; made: number; disponible: number; over: number; pendingToday: number; sinProgramar: number; byDay: OrderDay[]; completedAt: number | null; completedBy: OrderUnitRef | null; finishAt: number | null; finishDay: string; state: OrderState; waiting: boolean; lots: string[]; runs: OrderRunPart[]; complete: boolean; sealed: boolean }
/** the runs of each queue (see woQueue) in a state: the device's own first, then the older ones kept for orders; never one twice, never a deleted one */
const runIndex = new WeakMap<State, Map<string, Run[]>>()
function runsOfQueue(s: State, q: string): Run[] {
  let idx = runIndex.get(s)
  if (!idx) {
    idx = new Map()
    const seen = new Set<string>()
    for (const r of [...s.runs, ...s.orderRuns]) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      if (r.deleted || !roomKnown(r.dept)) continue
      const k = woQueue(r.dept, r.code, apartOf(r)), list = idx.get(k)
      if (list) list.push(r); else idx.set(k, [r])
    }
    runIndex.set(s, idx)
  }
  return idx.get(q) ?? []
}
/** states made with the server's rows of an order's days (stateWith(…, whole)): they hold all of them */
const wholeStates = new WeakSet<State>()
const statusMemo = new WeakMap<State, Map<string, Map<string, OrderStatus>>>()
/**
 * the numbers of every order of a queue still worked out from its records, by id (worked out once per state, day and
 * whether the device holds every record of the queue: what it holds changes without the state changing, when the
 * server's old days arrive or the device's own days move on)
 */
export function queueStatuses(s: State, q: string, today: string): Map<string, OrderStatus> {
  const orders = liveOrders(s, q)
  const complete = orders.length > 0 && (queueHeld(q, orders[0].startDate) || wholeStates.has(s))
  let byQ = statusMemo.get(s)
  if (!byQ) { byQ = new Map(); statusMemo.set(s, byQ) }
  const key = q + '|' + today + '|' + complete, hit = byQ.get(key)
  if (hit) return hit
  const out = foldQueue(s, orders, today, complete)
  byQ.set(key, out)
  return out
}
type OrderAcc = { made: number; days: Map<string, [number, number]>; completedBy: OrderUnitRef | null; runs: Map<string, OrderRunPart>; lots: Set<string> }
/**
 * Every unit the room registered of the code in the queue's unit, from the first start day of its orders on, in the
 * order they were made, goes to one order: the one named by the day's program row of the unit's lot (2026-10-20: a
 * row per lot), while it is open and that row's quantity has not been made for it yet; else the oldest open one.
 * "Open" for a unit: it started on or before the
 * unit's day, it was not closed before the unit, and it is not complete yet. A unit's day is its run's work day, as
 * the room's card counts it (planRows), and its shift is by the hours of that day (a day of one shift gives all to it).
 * One unit counts as planRows counts it: a mezcla is one, a cart its pouches, a bin what it holds, a pallet its cases.
 */
function foldQueue(s: State, orders: WorkOrder[], today: string, complete: boolean): Map<string, OrderStatus> {
  const out = new Map<string, OrderStatus>()
  if (!orders.length) return out
  const q = orderQueue(orders[0])
  const { dept, code: key } = orders[0], kind = orderKind(orders[0]), from = orders[0].startDate, cfg = CFG[dept]
  const programs = s.plans.filter((p) => p.dept === dept && p.qty > 0 && normCode(p.code) === key).sort(byPlanLot)
  // A day may program the code in several rows, one per lot (2026-10-20), and each may name an order (the same one or
  // not). A unit tries first the order named by the row the room's card counts it on (planRows: the row of its lot,
  // else the code's row without a lot), up to that row's quantity; then the oldest open one. The office may well give
  // the two lots of 889 to two orders (6290 the end of an older one, 6292 a newer one): until the review of 2026-10-20
  // every unit tried the day's named orders in the lots' order, so the order of the 6290 row took the carts of 6292
  // and the order of 6292 stayed "pendiente" while its lot was being made. A unit of a lot no row of that day names
  // (and no row without a lot) is the card's "también": it goes by code, oldest first, as before
  const dayRows = new Map<string, Plan[]>()
  for (const p of programs) for (const d of planDays(p)) { const l = dayRows.get(d); if (l) l.push(p); else dayRows.set(d, [p]) }
  const rowOfUnit = (day: string, lot: string): Plan | undefined => { const rows = dayRows.get(day); return rows && ((lot ? rows.find((p) => planLot(p.lot) === lot) : undefined) ?? rows.find((p) => !planLot(p.lot))) }
  // what each row's order took of that row's lot that day (the row's quantity is how much it takes first)
  const tookOfRow = new Map<Plan, number>()
  const units: { u: OrderUnitRef; r: Run; unit: Unit }[] = []
  for (const r of runsOfQueue(s, q)) {
    if (r.date < from) continue
    const h = shiftsOf(s, r.date, r.dept), line = lineNameOf(s, r.lineId, r.line)
    r.units.forEach((unit, i) => {
      const n = cfg.qty === 'none' && !kind ? 1 : unitQty(s, r, unit)
      if (n > 0) units.push({ u: { runId: r.id, k: i + 1, at: unit.at, day: r.date, shift: shiftAt(h, unit.at), n, by: unit.by, line }, r, unit })
    })
  }
  units.sort((a, b) => a.u.at - b.u.at || (a.u.runId < b.u.runId ? -1 : a.u.runId > b.u.runId ? 1 : 0) || a.u.k - b.u.k)
  const acc = new Map<string, OrderAcc>(orders.map((o) => [o.id, { made: 0, days: new Map(), completedBy: null, runs: new Map(), lots: new Set() }]))
  // (an order with a lot, Jose 2026-10-20, takes only the units of that lot; one without a lot, any lot of the code)
  const open = (o: WorkOrder, u: OrderUnitRef, lot: string) => o.startDate <= u.day && (o.closedAt == null || u.at < o.closedAt) && acc.get(o.id)!.made < o.qty && (!o.lot || o.lot === lot)
  for (const { u, r, unit } of units) {
    // (the unit's lot as the card takes it: a pallet of two lots goes whole to the lot with most of it, since an order
    // takes a unit whole; a unit without lots is its run's lot)
    const lot = lotShares(s, r, unit, true)[0].lot
    const row = rowOfUnit(u.day, lot)
    const named = row?.orderId ? orders.find((o) => o.id === row.orderId) : undefined
    let target = named && row && open(named, u, lot) && (tookOfRow.get(row) ?? 0) < row.qty ? named : undefined
    target ??= orders.find((o) => open(o, u, lot))
    if (!target) continue
    if (row && row.orderId === target.id) tookOfRow.set(row, r2((tookOfRow.get(row) ?? 0) + u.n))
    const a = acc.get(target.id)!
    a.made = r2(a.made + u.n)
    const d = a.days.get(u.day) ?? [0, 0]
    d[u.shift - 1] = r2(d[u.shift - 1] + u.n)
    a.days.set(u.day, d)
    if (!a.completedBy && a.made >= target.qty) a.completedBy = u
    const part = a.runs.get(r.id) ?? { runId: r.id, day: r.date, units: 0, n: 0 }
    part.units++; part.n = r2(part.n + u.n)
    a.runs.set(r.id, part)
    for (const l of [r.lot, r.extra?.lotNow ?? '', ...(unit.lots ?? []).map((x) => x.lot)]) if (l) a.lots.add(l)
  }
  for (const o of orders) out.set(o.id, statusOf(s, o, acc.get(o.id)!, programs.filter((p) => p.orderId === o.id), today, complete))
  return out
}
/**
 * One order's numbers from what counted for it. Its days are the days it got units and the days of the programs that
 * name it. For each, as the office does it: before = what was available that morning; the day's pending is what its
 * program asked of what was available, minus what the day made (never below 0; no program, nothing pending); what is
 * made is taken off, and what was pending goes back: available after the day = quantity − all made so far. "Sin
 * programar" of a past day is what was available less that day's pending; of today and the days programmed ahead, what
 * is available less the pending of today up to that day (so a program typed for tomorrow is not counted twice).
 */
function statusOf(s: State, o: WorkOrder, a: OrderAcc, linked: Plan[], today: string, complete: boolean): OrderStatus {
  const days = [...new Set([...a.days.keys(), ...linked.map((p) => p.date)])].sort()
  // closed by hand: from the day it was closed on, what its program did not make does not go back to it (it takes
  // nothing more: what the room made after went to the next order). Until the review of 2026-10-19 it stayed pending
  // on it, and the next day's notice said it "went back" to an order that no longer takes anything
  const closeDay = o.closedAt != null ? plainDay(s, o.closedAt) : ''
  let cum = 0, ahead = 0
  const byDay = days.map((date): OrderDay => {
    // the day's program of it: every row of that day that names it (one per lot, 2026-10-20), added up
    const ps = linked.filter((x) => x.date === date), prog = r2(ps.reduce((t, x) => t + x.qty, 0)), before = Math.max(0, o.qty - cum)
    const [made1, made2] = a.days.get(date) ?? [0, 0], made = r2(made1 + made2), closed = !!closeDay && date >= closeDay
    const pending = prog > 0 && !closed ? r2(Math.max(0, Math.min(prog, before) - made)) : 0
    cum = r2(cum + made)
    return { date, programmed: prog, lot: [...new Set(ps.map((x) => planLot(x.lot)).filter(Boolean))].join(', '), made1, made2, made, pending, cumMade: cum, disponible: r2(Math.max(0, o.qty - cum)), sinProgramar: 0, ...(closed ? { closed: true } : {}) }
  })
  for (const row of byDay) {
    if (row.date < today) row.sinProgramar = r2(Math.max(0, row.disponible - row.pending))
    else { ahead = r2(ahead + row.pending); row.sinProgramar = r2(Math.max(0, row.disponible - ahead)) }
  }
  const made = a.made, disponible = r2(Math.max(0, o.qty - made)), pendingToday = r2(byDay.filter((x) => x.date >= today).reduce((t, x) => t + x.pending, 0))
  const completedBy = a.completedBy, completedAt = completedBy?.at ?? null
  const state: OrderState = completedAt != null && (o.closedAt == null || completedAt <= o.closedAt) ? 'completado' : o.closedAt != null ? 'cerrado' : 'abierto'
  const finishDay = state === 'completado' && completedBy ? completedBy.day : state === 'cerrado' && o.closedAt != null ? plainDay(s, o.closedAt) : ''
  const lots = [...new Set([...a.lots, ...linked.map((p) => p.lot).filter(Boolean)])].slice(0, 30)
  return { id: o.id, made, disponible, over: r2(Math.max(0, made - o.qty)), pendingToday, sinProgramar: r2(Math.max(0, disponible - pendingToday)), byDay, completedAt, completedBy, finishAt: completedAt ?? o.closedAt ?? null, finishDay, state, waiting: o.startDate > today, lots, runs: [...a.runs.values()], complete, sealed: false }
}
/** the numbers of an order from its closed account (frozen; its day by day is not kept: the order's window brings it from the server) */
function statusFromSeal(o: WorkOrder, seal: OrderSeal, today: string): OrderStatus {
  const made = seal.made, disponible = r2(Math.max(0, o.qty - made)), completedAt = seal.completed?.at ?? null
  const state: OrderState = completedAt != null && (o.closedAt == null || completedAt <= o.closedAt) ? 'completado' : o.closedAt != null ? 'cerrado' : 'abierto'
  return { id: o.id, made, disponible, over: r2(Math.max(0, made - o.qty)), pendingToday: 0, sinProgramar: disponible, byDay: [], completedAt, completedBy: seal.completed, finishAt: seal.finishAt || null, finishDay: seal.finishDay, state, waiting: o.startDate > today, lots: seal.lots, runs: [], complete: false, sealed: true }
}
/** an order with nothing worked out (a deleted one: its units went back to the others) */
const noStatus = (o: WorkOrder, state: OrderState, today: string): OrderStatus => ({ id: o.id, made: 0, disponible: 0, over: 0, pendingToday: 0, sinProgramar: 0, byDay: [], completedAt: null, completedBy: null, finishAt: null, finishDay: '', state, waiting: o.startDate > today, lots: [], runs: [], complete: false, sealed: false })
/** one order's numbers on a day (today = the work day the screen shows: what is "today" for its pending) */
export function orderStatus(s: State, o: WorkOrder, today: string): OrderStatus {
  if (o.deleted) return noStatus(o, 'borrado', today)
  const seal = sealedIds(s).has(o.id) ? sealOf(s, o.id) : undefined
  if (seal) return statusFromSeal(o, seal, today)
  return queueStatuses(s, orderQueue(o), today).get(o.id) ?? noStatus(o, 'abierto', today)
}
/**
 * The orders of a room (null = every room) with their numbers, without the deleted ones: the open ones first, oldest
 * first (the order they are filled in), then the finished ones, the last finished first
 */
export function ordersOf(s: State, dept: Dept | null, today: string): { order: WorkOrder; status: OrderStatus }[] {
  const list = s.workOrders.filter((o) => !o.deleted && (!dept || o.dept === dept)).map((order) => ({ order, status: orderStatus(s, order, today) }))
  const open = list.filter((x) => x.status.state === 'abierto').sort((a, b) => fifo(a.order, b.order))
  const done = list.filter((x) => x.status.state !== 'abierto').sort((a, b) => (b.status.finishAt ?? 0) - (a.status.finishAt ?? 0) || fifo(a.order, b.order))
  return [...open, ...done]
}
/**
 * the open orders a day's program of a code can be a part of (kind = the word the code is counted in that day: see
 * orderKind), oldest first: the program dialog offers them, the first one by default
 */
export function openWorkOrdersFor(s: State, dept: Dept, code: string, kind: string, date: string): WorkOrder[] {
  return (woIndex(s.workOrders).byQ.get(woQueue(dept, code, kind)) ?? []).filter((o) => !o.deleted && o.startDate <= date && orderStatus(s, o, date).state === 'abierto').sort(fifo)
}
/**
 * The open orders the program dialog offers for a code, the one a program goes with by default first. Spiral: those of
 * the unit the row says (mezclas, lb, cajas). MFO has no unit on the row: the orders of every word its bins are
 * counted in (platos, copas, lb), those of the word the code's last bins said first, else all oldest first. Until the
 * review of 2026-10-19 MFO offered only the word of the last bins on this device, so a new copas or lb order of a code
 * not binned in its 14 days (or binned in another word) could not be picked, and the office typed it a second time.
 * Elsewhere, the room's own count
 */
export function programOrderChoices(s: State, dept: Dept, code: string, date: string, spiralUnit = 'mezclas'): WorkOrder[] {
  if (!normCode(code)) return []
  if (dept === 'Spiral') return openWorkOrdersFor(s, dept, code, spiralUnit === 'lb' || spiralUnit === 'cajas' ? spiralUnit : '', date)
  if (dept !== 'MFO') return openWorkOrdersFor(s, dept, code, '', date)
  const kinds = [...new Set(WO_UNITS.MFO.map((u) => orderKind({ dept, unit: u })))], w = mfoBinWord(s.runs, code)
  const first = w !== undefined && kinds.includes(w) ? openWorkOrdersFor(s, dept, code, w, date) : []
  return [...first, ...kinds.flatMap((k) => (w !== undefined && k === w ? [] : openWorkOrdersFor(s, dept, code, k, date))).sort(fifo)]
}
/**
 * What the last day with a program of each code left pending (up to 7 days back, so Monday sees Saturday's): with an
 * order, that day's pending of it (it went back to the order); without one, what its program lacked. Only what is above
 * 0. The room's card says it as a notice (Jose, 2026-10-19: "ayer quedaron N pendientes"): nothing is prefilled from it.
 * Since 2026-10-20 a code may have a row per lot: each row says its own (lot = the row's, '' = none); an order named by
 * several rows of that day is said once, with what that day left of it in all and the lots of its rows
 */
export type PrevPending = { code: string; lot: string; n: number; unit: string; date: string; orderId: string; was: string }
export function prevPending(s: State, dept: Dept, date: string): PrevPending[] {
  const out: PrevPending[] = [], seen = new Set<string>()
  for (let d = dayBefore(date), i = 0; i < 7; i++, d = dayBefore(d)) {
    if (!planOf(s, d, dept).length) continue
    // (a program of several days is pending only once, after its last day: the days before, it goes on)
    const rows = planRows(s, d, dept).filter((x) => x.planned > 0 && x.to === d), codes = new Set<string>(), told = new Set<string>()
    for (const row of rows) {
      const key = normCode(row.code)
      if (seen.has(key)) continue
      codes.add(key)
      const o = row.orderId ? s.workOrders.find((x) => x.id === row.orderId && !x.deleted) : undefined
      const plain = Math.max(0, row.left)
      // (an order no longer open takes nothing back: then what the card said that day, and the order is only named, in
      // `was`; review of 2026-10-19, an order closed in the middle of the day was said to get back what went to the next)
      const live = !!o && orderStatus(s, o, date).state === 'abierto'
      if (o && live) { if (told.has(o.id)) continue; told.add(o.id) }
      const n = o && live ? orderStatus(s, o, date).byDay.find((x) => x.date === d)?.pending ?? plain : plain
      const lot = o && live ? [...new Set(rows.filter((x) => x.orderId === o.id && normCode(x.code) === key).map((x) => x.lot).filter(Boolean))].join(', ') : row.lot
      if (n > 0) out.push({ code: row.code, lot, n, unit: o ? orderUnitWord(o) : row.unit, date: d, orderId: o && live ? o.id : '', was: o && !live ? o.id : '' })
    }
    for (const k of codes) seen.add(k)
  }
  return out
}

// ---- closing the account of finished orders, and working it out again ----
const sealOfStatus = (s: State, o: WorkOrder, st: OrderStatus, upto: string): OrderSeal => ({ id: o.id, sig: sealSig(s, o, upto), upto, made: st.made, finishAt: st.finishAt ?? 0, finishDay: st.finishDay, completed: st.completedBy, lots: st.lots, updatedAt: clockNow() })
/**
 * The account goes to the server as a mark of the order's room in act_changes, kept apart from the history lines (see
 * applyRemote). Only by someone who may write that room's history (writesRoom: its operators, the managers, the
 * office): a device that only looks keeps its own, unsent. Nothing the app writes ever takes a mark away: one that no
 * longer stands is ignored, and written again when the order can be closed again
 */
function pushSeal(o: WorkOrder, seal: OrderSeal, gone = false) {
  if (!writesRoom(o.dept)) return
  const { id: _id, updatedAt: _at, ...body } = seal
  const c: Change = { id: 'wodone:' + o.id, at: seal.finishAt || clockNow(), by: user.get(), dept: o.dept, what: 'Pedido de producción terminado · ' + o.code + (o.wo ? ' · WO ' + o.wo : ''), before: '', after: JSON.stringify(body), refTable: WO_DONE_REF, refKey: o.id, updatedAt: seal.updatedAt, ...(gone ? { deleted: true } : {}) }
  push('act_changes', c.id, rowOfChange(c))
}
/**
 * The day an account is closed up to (OrderSeal.upto: the orders of the queue that start on or before it are in its
 * fingerprint): the last day its group finished, and never before a start day of the group. An order closed by hand
 * before its start day (cancelled) finished before it started: closed up to that day, its own row was not in its
 * fingerprint, and reopening it, or changing its total or its start day, left the account standing, counting nothing
 * for it for good (review of 2026-10-20)
 */
const sealUpto = (group: WorkOrder[], last: string) => [last, ...group.map((o) => o.startDate)].sort().at(-1) ?? last
/**
 * The orders whose account can be closed (see "the account of a finished order"): the orders of a queue are taken
 * oldest first in groups that overlap (an order joins the group while one of it is still open, or when it starts on
 * or before the day the group last finished); a group closes when every order of it has finished, before the days the
 * device keeps, and the device holds every record of its queue. All of a group close together, so an order whose
 * account stands never shares a day with one still worked out from its records. Only once the page has brought the
 * plant from the server (prune)
 */
function sealFinished() {
  const s = state, kept = firstKeptDay(), today = plainDay(s, clockNow())
  const made: { o: WorkOrder; seal: OrderSeal }[] = []
  for (const need of workNeeds(s)) {
    if (!queueHeld(need.q, need.from)) continue
    const st = queueStatuses(s, need.q, today)
    let group: WorkOrder[] = [], open = false, last = ''
    const close = () => { if (group.length && !open && last && last < kept) { const upto = sealUpto(group, last); for (const o of group) made.push({ o, seal: sealOfStatus(s, o, st.get(o.id)!, upto) }) } group = []; open = false; last = '' }
    for (const o of liveOrders(s, need.q)) {
      if (group.length && !open && o.startDate > last) close()
      group.push(o)
      const x = st.get(o.id)
      if (!x?.finishDay) open = true
      else if (x.finishDay > last) last = x.finishDay
    }
    close()
  }
  if (!made.length) return
  const ids = new Set(made.map((x) => x.o.id))
  set({ ...state, orderSeals: [...state.orderSeals.filter((x) => !ids.has(x.id)), ...made.map((x) => x.seal)] })
  for (const x of made) pushSeal(x.o, x.seal)
}
/**
 * The group an order's numbers are worked out with: for an order whose account stands, the orders closed with it
 * (ids) and the first day of them; for any other, the first start day of its queue's orders still worked out from
 * their records (ids empty). What to ask the server for, to work its numbers out again (sync.ts, loadOrderRows)
 */
export function orderGroup(s: State, o: WorkOrder): { q: string; from: string; ids: string[] } {
  const q = orderQueue(o), sealed = sealedIds(s), seal = sealed.has(o.id) ? sealOf(s, o.id) : undefined
  if (seal) {
    const group = (woIndex(s.workOrders).byQ.get(q) ?? []).filter((x) => sealed.has(x.id) && sealOf(s, x.id)?.upto === seal.upto)
    return { q, from: group.map((x) => x.startDate).sort()[0] ?? o.startDate, ids: group.map((x) => x.id) }
  }
  return { q, from: liveOrders(s, q).map((x) => x.startDate).sort()[0] ?? o.startDate, ids: [] }
}
/**
 * After a pull of every program of the days this device keeps (sync.ts: the first pull of a new version, of a new
 * device, or of one whose rooms changed), the programs it holds of those days and rooms that the server does not have
 * are let go: nothing on the server is ever erased, so such a row is a copy of one the server no longer has. Until
 * 2026-10-20 a row was its code alone, and changing its lot changed that same row; a device that missed such a change
 * kept the old lot, and now that a code has a row per lot it would show both, the old one counting units of its lot.
 * Never a row still waiting to go up (`waiting` = the queue when the pull began; and the queue now), nor one changed
 * here after the pull began, nor one heard from the server after it began (heardAfter = planHeardMark() when it began:
 * a row that came by realtime, or with a refresh before sending, while the listing was being read is on the server
 * although the listing did not have it; its updated_at is when it was typed, maybe before the pull: review of
 * 2026-10-20). rooms = the rooms the pull asked for (null = all). Returns how many went
 */
export function keepServerPlans(seen: Set<string>, from: string, rooms: Dept[] | null, waiting: Set<string>, since: number, heardAfter = Infinity): number {
  const gone = new Set(state.plans.filter((p) => {
    if (p.date < from || (rooms && !rooms.includes(p.dept)) || p.updatedAt >= since) return false
    const k = planKey(p.date, p.dept, p.code, p.lot)
    return !seen.has(k) && !waiting.has(k) && !queued('act_plan', k) && !((planHeard.get(k) ?? -1) > heardAfter)
  }))
  // (what was heard before this pull began is not needed any more: the next pull has a mark of its own)
  if (Number.isFinite(heardAfter)) for (const [k, n] of planHeard) if (n <= heardAfter) planHeard.delete(k)
  if (gone.size) set({ ...state, plans: state.plans.filter((p) => !gone.has(p)) })
  return gone.size
}
/**
 * The program rows heard from the server in this session (applyRemote: a pull, realtime, a refresh before sending),
 * each with the number of its hearing: keepServerPlans spares those heard after a pull began. (Read only by functions
 * called after this file is read: never by load())
 */
const planHeard = new Map<string, number>()
let planHeardN = 0
/** where the count of the program rows heard is now (sync.ts takes it when a whole pull begins) */
export const planHeardMark = () => planHeardN
/** a program as the server sends it (null = not one this version keeps) */
function planOfRow(row: Row, at: number): Plan | null {
  const date = String(row.date ?? '').slice(0, 10), dept = row.dept as Dept, key = normCode(String(row.code ?? ''))
  if (!isDay(date) || !roomKnown(dept) || !key) return null
  const end = planEndOf(date, String(row.end_date ?? '').slice(0, 10)), nt = planNote(row.note)
  return { date, dept, code: key, qty: Number(row.qty) > 0 ? Number(row.qty) : 0, lot: planLot(row.lot), ...(isUuid(row.order_id) ? { orderId: row.order_id } : {}), ...(end ? { endDate: end } : {}), ...(nt ? { note: nt } : {}), updatedAt: at }
}
/**
 * A copy of a state with rows brought from the server added (runs, programs, history lines; what the device already
 * holds stands), and the closed accounts of the orders named in `unseal` left out, so their numbers are worked out
 * again from the records. whole = the rows are every record of those orders' days the device does not keep (their
 * numbers are then complete). Nothing is saved: the screens use it to show an old order (Jose, 2026-10-19)
 */
export function stateWith(s: State, rows: { runs?: Row[]; plans?: Row[]; changes?: Row[] }, unseal: string[] = [], whole = false): State {
  const have = new Set([...s.runs, ...s.orderRuns].map((r) => r.id)), more: Run[] = []
  for (const row of rows.runs ?? []) { if (!roomKnown(row.dept) || have.has(String(row.id))) continue; const r = runOfRow(row); have.add(r.id); if (!r.deleted) more.push(r) }
  const plans = [...s.plans]
  // (a program row is its code and its lot, 2026-10-20: the server's rows of another lot of a code are rows of their own)
  for (const row of rows.plans ?? []) { const p = planOfRow(row, fromIso(row.updated_at) ?? 0); if (p && !plans.some((x) => x.date === p.date && x.dept === p.dept && normCode(x.code) === p.code && planLot(x.lot) === p.lot)) plans.push(p) }
  const changes = [...s.changes]
  for (const row of rows.changes ?? []) { if (row.ref_table === WO_DONE_REF || changes.some((c) => c.id === row.id)) continue; const c = changeOfRow(row); if (!c.deleted) changes.push(c) }
  const next: State = { ...s, orderRuns: [...s.orderRuns, ...more], plans, changes, orderSeals: s.orderSeals.filter((x) => !unseal.includes(x.id)) }
  if (whole) wholeStates.add(next)
  return next
}
/**
 * The account of a group of orders worked out again from the server's records (st = stateWith(…, ids, true): "Calcular
 * otra vez con el servidor"): where it differs from the one kept here (a correction of an old run), it is kept as it
 * comes out now and shared again. Only for a group finished before the days the device keeps (the others are worked out
 * from the records anyway). Returns how many accounts changed, or -1 when the records no longer close it: one of the
 * group is not finished any more (an old mezcla deleted in the Reporte), or it finished within the days the device
 * keeps. Then the accounts of the group are taken away, here and on every device (their marks go up deleted: see
 * applyRemote), and the orders are worked out from their records again. Until the review of 2026-10-20 they were left
 * as they were: the order stayed "Completado" on every list and every device, and the window said "coincide"
 */
export function resealGroup(st: State, ids: string[], today: string): number {
  const list = ids.map((id) => st.workOrders.find((o) => o.id === id && !o.deleted)).filter((o): o is WorkOrder => !!o).map((o) => ({ o, x: orderStatus(st, o, today) }))
  if (!list.length || list.some(({ x }) => x.sealed)) return 0
  const last = list.map(({ x }) => x.finishDay).sort().at(-1) ?? ''
  if (list.some(({ x }) => !x.finishDay) || last >= firstKeptDay()) return unsealOrders(ids) ? -1 : 0
  const upto = sealUpto(list.map(({ o }) => o), last)
  const fresh = list.map(({ o, x }) => ({ o, seal: sealOfStatus(state, o, x, upto) })).filter(({ seal }) => { const was = state.orderSeals.find((y) => y.id === seal.id); return !was || !same({ ...was, updatedAt: 0 }, { ...seal, updatedAt: 0 }) })
  if (!fresh.length) return 0
  const ids2 = new Set(fresh.map((x) => x.o.id))
  set({ ...state, orderSeals: [...state.orderSeals.filter((x) => !ids2.has(x.id)), ...fresh.map((x) => x.seal)] })
  for (const x of fresh) pushSeal(x.o, x.seal)
  return fresh.length
}
/** the closed accounts of these orders taken away, here and as marks for every device; whether there was any */
function unsealOrders(ids: string[]): boolean {
  const gone = state.orderSeals.filter((x) => ids.includes(x.id))
  if (!gone.length) return false
  batch(() => {
    set({ ...state, orderSeals: state.orderSeals.filter((x) => !ids.includes(x.id)) })
    for (const seal of gone) { const o = state.workOrders.find((w) => w.id === seal.id); if (o) pushSeal(o, { ...seal, updatedAt: Math.max(clockNow(), seal.updatedAt + 1) }, true) }
  })
  return true
}

// ---- typing, closing and taking away an order ----
const rowOfWorkOrder = (o: WorkOrder) => ({ id: o.id, dept: o.dept, code: normCode(o.code), lot: o.lot, wo: o.wo, qty: o.qty, unit: o.unit, start_date: o.startDate, note: o.note, created_at: iso(o.createdAt || o.updatedAt), created_by: o.createdBy, closed_at: iso(o.closedAt), closed_by: o.closedBy || null, deleted: !!o.deleted, updated_at: iso(o.updatedAt), updated_by: user.get() })
/** an order as the server sends it (null = not one this version keeps: no id, an unknown room, no code or start day) */
function workOrderOfRow(row: Row, at: number): WorkOrder | null {
  return workOrderFrom({ id: row.id as string, dept: row.dept as Dept, code: String(row.code ?? ''), lot: String(row.lot ?? ''), wo: String(row.wo ?? ''), qty: Number(row.qty), unit: String(row.unit ?? ''), startDate: String(row.start_date ?? '').slice(0, 10), note: String(row.note ?? ''), createdAt: fromIso(row.created_at) ?? 0, createdBy: String(row.created_by ?? ''), closedAt: fromIso(row.closed_at), closedBy: String(row.closed_by ?? ''), deleted: !!row.deleted, updatedAt: at, ...syncedOf(row) })
}
/**
 * an order put in its place in the list (a deleted one stays, with its flag), always written the same way (the shape
 * load() reads back: a reload gives the very same order)
 */
const withOrder = (list: WorkOrder[], o: WorkOrder) => { const x = workOrderFrom(o) ?? o, i = list.findIndex((y) => y.id === x.id); return i < 0 ? [...list, x] : list.map((y, k) => (k === i ? x : y)) }
function putWorkOrder(o: WorkOrder, was: WorkOrder | undefined) {
  set({ ...state, workOrders: withOrder(state.workOrders, o) })
  push('act_work_orders', o.id, rowOfWorkOrder(o), baseOf(was, rowOfWorkOrder))
}
/** an order as the history names it, in the same words whatever the screen's language */
const woKept = (o: WorkOrder) => 'Pedido de producción ' + o.code + (o.lot ? ' lote ' + o.lot : '') + (o.wo ? ' WO ' + o.wo : '') + ' (' + o.dept + ')'
const woAmount = (o: WorkOrder) => String(o.qty) + ' ' + unitKept(o)
/** what the office types for an order: its room, code, total in the room's unit, start day, and optionally its WO number and a note */
export type WorkOrderDraft = { dept: Dept; code: string; lot?: string; qty: number; unit: string; startDate: string; wo: string; note: string }
/**
 * The office types an order, or changes one (id). null = not saved: no room, no code, no quantity above 0, no start
 * day, or a unit the room does not count in. Its room, code and unit stay as typed (they decide what counts for it: to
 * fix one, delete the order and type it again); its total, start day, WO number and note can change. Every change goes
 * to the history. Returns its id
 */
export function saveWorkOrder(d: WorkOrderDraft, id?: string): string | null {
  const old = id ? state.workOrders.find((o) => o.id === id) : undefined
  if (id && !old) return null
  const dept = old ? old.dept : d.dept, code = old ? old.code : normCode(String(d.code ?? '')), unit = old ? old.unit : String(d.unit ?? '')
  const qty = Number.isFinite(d.qty) ? r2(d.qty) : NaN, start = String(d.startDate ?? '')
  if (!roomKnown(dept) || !code || !(qty > 0) || !isDay(start) || (!old && !WO_UNITS[dept].includes(unit))) return null
  const lot = d.lot === undefined ? old?.lot ?? '' : planLot(d.lot)
  const o: WorkOrder = { id: old?.id ?? uid(), dept, code, lot, wo: String(d.wo ?? '').trim().slice(0, WO_MAX), qty, unit, startDate: start, note: cleanNote(d.note), createdAt: old?.createdAt ?? clockNow(), createdBy: old?.createdBy ?? user.get(), closedAt: old?.closedAt ?? null, closedBy: old?.closedBy ?? '', ...(old?.deleted ? { deleted: true } : {}), updatedAt: stamp(old) }
  if (old && old.qty === o.qty && old.lot === o.lot && old.wo === o.wo && old.startDate === o.startDate && old.note === o.note) return old.id
  batch(() => {
    putWorkOrder(o, old)
    const log = (what: string, before: string, after: string) => logChange(o.dept, what, before, after, 'act_work_orders', o.id)
    if (!old) { log('Pedido de producción nuevo · ' + o.dept + ' · ' + o.code, '', woAmount(o) + (o.lot ? ' · lote ' + o.lot : '') + ' desde ' + o.startDate + (o.wo ? ' · WO ' + o.wo : '')); return }
    if (old.qty !== o.qty) log(woKept(o) + ' · Total', woAmount(old), woAmount(o))
    if (old.lot !== o.lot) log(woKept(o) + ' · Lote', old.lot, o.lot)
    if (old.wo !== o.wo) log(woKept(o) + ' · WO', old.wo, o.wo)
    if (old.startDate !== o.startDate) log(woKept(o) + ' · Empieza', old.startDate, o.startDate)
    if (old.note !== o.note) log(woKept(o) + ' · Nota', old.note, o.note)
  })
  return o.id
}
/** an order is closed by hand (a manager, the office, "Productos y programa"): from this moment on it takes nothing more */
export function closeWorkOrder(id: string): boolean {
  const old = state.workOrders.find((o) => o.id === id)
  if (!old || old.deleted || old.closedAt != null) return false
  const o: WorkOrder = { ...old, closedAt: clockNow(), closedBy: user.get(), updatedAt: stamp(old) }
  batch(() => { putWorkOrder(o, old); logChange(o.dept, woKept(o) + ' · Cerrado', '', 'cerrado', 'act_work_orders', o.id) })
  return true
}
/**
 * an order closed by mistake is opened again: it counts as if it had never been closed (what the room made of the code
 * meanwhile can come back to it from a later order: the confirmation says so)
 */
export function reopenWorkOrder(id: string): boolean {
  const old = state.workOrders.find((o) => o.id === id)
  if (!old || old.deleted || old.closedAt == null) return false
  const o: WorkOrder = { ...old, closedAt: null, closedBy: '', updatedAt: stamp(old) }
  batch(() => { putWorkOrder(o, old); logChange(o.dept, woKept(o) + ' · Reabierto', 'cerrado', 'abierto', 'act_work_orders', o.id) })
  return true
}
/**
 * an order typed by mistake is taken away: it stays on the server and on the device, marked, and leaves every screen;
 * what was made of its code counts for the other orders, and the programs that named it are plain day programs
 */
export function deleteWorkOrder(id: string): boolean {
  const old = state.workOrders.find((o) => o.id === id)
  if (!old || old.deleted) return false
  const o: WorkOrder = { ...old, deleted: true, updatedAt: stamp(old) }
  batch(() => { putWorkOrder(o, old); logChange(o.dept, woKept(o) + ' · Borrado', woAmount(old), '', 'act_work_orders', o.id) })
  return true
}
/**
 * An order's change waiting here meets the server's version of it (one made BEFORE it: a newer one already won, see
 * keepNewer). Each side keeps what it changed: what this change did not touch is taken from the server (another
 * tablet closed the order while this one changed its note: both stand). Returns the order to keep here (null = as it is)
 */
const WO_KEYS = ['dept', 'code', 'lot', 'wo', 'qty', 'unit', 'startDate', 'note', 'createdAt', 'createdBy', 'closedAt', 'closedBy'] as const
const woBody = (o: WorkOrder) => [...WO_KEYS.map((k) => o[k]), !!o.deleted]
function mergeQueuedOrder(pend: { row: Row; base?: Row | null; tried?: Row[] }, row: Row, theirs: WorkOrder): WorkOrder | null {
  const mine = workOrderOfRow(pend.row, fromIso(pend.row.updated_at) ?? 0)
  if (!mine) return null
  if (same(woBody(mine), woBody(theirs))) { drop('act_work_orders', theirs.id); return theirs }
  // A version this device itself sent whose answer never came back (the 25 s limit, a WiFi that dropped): the server
  // took it, and it is this change's own past, not another device's change (as reconcile does for the runs, lines and
  // stops). Merged field by field against the old base instead, a change undone before the next pass (a total put back
  // to 100 after 200 went up unanswered, an order reopened after its closing went up unanswered) took the server's
  // field back, and the undo was lost on the server and on the device (review of 2026-10-20)
  if (pend.tried?.some((t) => { const x = workOrderOfRow(t, fromIso(t.updated_at) ?? 0); return !!x && x.updatedAt === theirs.updatedAt && same(woBody(x), woBody(theirs)) })) { rebase('act_work_orders', theirs.id, pend.row, row); return null }
  const base = pend.base ? workOrderOfRow(pend.base, fromIso(pend.base.updated_at) ?? 0) : null
  // (no version to start from: an order typed here that went up and whose answer was lost; this change goes up as it is)
  if (!base) { rebase('act_work_orders', theirs.id, pend.row, row); return null }
  const pick = <K extends (typeof WO_KEYS)[number]>(k: K): WorkOrder[K] => (same(mine[k], base[k]) ? theirs[k] : mine[k])
  const gone = !!mine.deleted !== !!base.deleted ? !!mine.deleted : !!theirs.deleted
  const merged: WorkOrder = { id: theirs.id, dept: pick('dept'), code: pick('code'), lot: pick('lot'), wo: pick('wo'), qty: pick('qty'), unit: pick('unit'), startDate: pick('startDate'), note: pick('note'), createdAt: pick('createdAt'), createdBy: pick('createdBy'), closedAt: pick('closedAt'), closedBy: pick('closedBy'), ...(gone ? { deleted: true } : {}), updatedAt: Math.max(mine.updatedAt, theirs.updatedAt) }
  if (same(woBody(merged), woBody(theirs))) { drop('act_work_orders', theirs.id); return theirs }
  if (same(woBody(merged), woBody(mine))) { rebase('act_work_orders', theirs.id, pend.row, row); return null }
  rebase('act_work_orders', theirs.id, { ...rowOfWorkOrder(merged), updated_by: String(pend.row.updated_by ?? '') || user.get() }, row)
  return merged
}
export const targetOf = (s: State, dept: Dept) => s.targets.find((t) => t.dept === dept)
/**
 * Each line can have its own goal beside the room's (which is of all the lines together): it shows on the line's
 * card. It travels in act_targets like the room's, under the key "line:<id>".
 */
const LINE_KEY = 'line:'
export const lineTargetOf = (s: State, lineId: string) => s.lineTargets.find((t) => t.lineId === lineId)
// ---- the goals of each shift ----
/**
 * A goal belongs to a shift: its manager sets it for his people, and what counts against it is what that shift makes,
 * never what the other one made. It travels in act_targets under the room's (or the line's) key followed by "@1" or
 * "@2", with the shift's total in per_shift. A device with an older version of the app does not know these keys and
 * leaves them alone.
 */
// (a function, not a constant: load() uses it while this file is still being read, on every device that has something saved)
function isTurnKey(key: string) { return /@[12]$/.test(key) }
const rowOfTurnGoal = (g: TurnGoal) => ({ dept: g.key, per_hour: g.perHour, per_shift: g.total, updated_at: iso(g.updatedAt), updated_by: user.get() })
/** what a shift goes by: its goal per hour and for the whole shift; own = somebody set it for this very shift */
export type ShiftGoal = { perHour: number | null; total: number | null; own: boolean }
/**
 * While nobody has set a shift's own goal, the pace per hour that was set before (when a room had one goal for both
 * shifts) still stands: a pace is the same whoever is working. The total of before does not: it was the whole day's,
 * of both shifts together, and is no shift's goal.
 */
const turnGoal = (s: State, key: string, before: number | null | undefined): ShiftGoal => {
  const own = s.turnGoals.find((g) => g.key === key)
  return own ? { perHour: own.perHour, total: own.total, own: true } : { perHour: before ?? null, total: null, own: false }
}
/** the goal of a room in one shift */
export const shiftGoalOf = (s: State, dept: Dept, shift: 1 | 2) => turnGoal(s, dept + '@' + shift, targetOf(s, dept)?.perHour)
/** the goal of one line in one shift */
export const lineShiftGoalOf = (s: State, lineId: string, shift: 1 | 2) => turnGoal(s, LINE_KEY + lineId + '@' + shift, lineTargetOf(s, lineId)?.perHour)
function putTurnGoal(key: string, perHour: number | null, total: number | null) {
  const old = state.turnGoals.find((g) => g.key === key)
  const g: TurnGoal = { key, perHour, total, updatedAt: stamp(old) }
  set({ ...state, turnGoals: [...state.turnGoals.filter((x) => x.key !== key), g] })
  push('act_targets', key, rowOfTurnGoal(g))
}
/**
 * the room a goal's history line is filed under. A goal goes with the power "Poner metas", for any room (migrations/006),
 * but a history line of a room only that room's people or a manager may write: an operator who set another room's
 * goal had its two history lines refused, and they waited on the tablet for ever (review of 2026-10-18). Without a
 * room they go with the same power, and their text still names the room
 */
function goalRoom(dept: Dept): Dept | null { return writesRoom(dept) ? dept : null }
/** a manager's goal for a room in one shift (blank = none); it reaches every tablet of the room and the history */
export function setShiftGoal(dept: Dept, shift: 1 | 2, perHour: number | null, total: number | null) {
  const old = shiftGoalOf(state, dept, shift), key = dept + '@' + shift
  putTurnGoal(key, perHour, total)
  logChange(goalRoom(dept), 'Meta ' + dept + ' · Turno ' + shift + ' · por hora', v(old.perHour), v(perHour), 'act_targets', key)
  logChange(goalRoom(dept), 'Meta ' + dept + ' · Turno ' + shift + ' · del turno', v(old.total), v(total), 'act_targets', key)
}
/** a manager's goal for one line in one shift (blank = none) */
export function setLineShiftGoal(line: Line, shift: 1 | 2, perHour: number | null, total: number | null) {
  const old = lineShiftGoalOf(state, line.id, shift), key = LINE_KEY + line.id + '@' + shift
  putTurnGoal(key, perHour, total)
  logChange(goalRoom(line.dept), 'Meta ' + line.name + ' (' + line.dept + ') · Turno ' + shift + ' · por hora', v(old.perHour), v(perHour), 'act_targets', key)
  logChange(goalRoom(line.dept), 'Meta ' + line.name + ' (' + line.dept + ') · Turno ' + shift + ' · del turno', v(old.total), v(total), 'act_targets', key)
}
/**
 * what one unit counts for: its own quantity; without one (old records, a blank left in a correction), the run's
 * quantity per unit, or the master table's. One rule for the line, the report, the room's total and Avance.
 */
export function unitQty(s: State, r: Run, u: Unit): number {
  if (u.qty != null) return u.qty
  if (CFG[r.dept].qty === 'none') return 0
  if (r.perUnit != null) return r.perUnit
  const p = productOf(s, r.code)
  return p ? (r.dept === 'RTE' ? cartPouches(p) : r.dept === 'Packing' ? p.casesPerPallet : 0) : 0
}
/** what a run made, in its own quantity (pouches, cajas; platos, copas or lb in a bin) */
export const runQty = (s: State, r: Run) => r.units.reduce((t, u) => t + unitQty(s, r, u), 0)

/** what a room made on a day with all its lines together: in total, per code, and the pace (made ÷ hours since the first start of the day) */
/** the bins of some runs, word by word: how many bins and how much they hold (only the units that pass `keep`) */
function binTotals(s: State, runs: Run[], keep: (u: Unit) => boolean) {
  // (bags: MFO's bags of pounds, told apart in how many, 2026-10-22)
  const by = new Map<string, { word: string; units: number; qty: number; bags?: number }>()
  for (const r of runs) { const word = apartOf(r), e = by.get(word) ?? { word, units: 0, qty: 0 }, mine = r.units.filter(keep); e.units += mine.length; e.qty += mine.reduce((t, u) => t + unitQty(s, r, u), 0); if (r.extra?.pack === 'bag' && mine.length) e.bags = (e.bags ?? 0) + mine.length; by.set(word, e) }
  return [...by.values()].filter((b) => b.units > 0)
}

/** what a room has made on a day, with all its lines together; or, given a line, what that line alone has made */
export function deptToday(s: State, dept: Dept, date: string, now: number, lineId?: string) {
  const cfg = CFG[dept]
  const all = s.runs.filter((r) => r.dept === dept && r.date === date && (!lineId || r.lineId === lineId))
  // bins hold platos, copas or pouches, not cases: they are counted apart (see bins), never in the room's cases
  const runs = all.filter((r) => !apartOf(r)), binRuns = all.filter((r) => !!apartOf(r))
  const measure = (r: Run) => (cfg.qty === 'none' ? r.units.length : runQty(s, r))
  const codes = new Map<string, { code: string; units: number; qty: number; waste: number; lines: string[] }>()
  for (const r of runs) {
    const e = codes.get(normCode(r.code)) ?? { code: r.code, units: 0, qty: 0, waste: 0, lines: [] }
    e.units += countedUnits(r.units).length; e.qty += measure(r); e.waste = Math.round((e.waste + r.waste) * 100) / 100
    const ln = lineNameOf(s, r.lineId, r.line)
    if (!e.lines.includes(ln)) e.lines.push(ln)
    codes.set(normCode(r.code), e)
  }
  const units = runs.reduce((t, r) => t + countedUnits(r.units).length, 0), qty = runs.reduce((t, r) => t + measure(r), 0)
  const first = runs.length ? Math.min(...runs.map((r) => r.startedAt)) : 0
  const allEnded = all.length > 0 && all.every((r) => r.endedAt)
  const hours = first ? Math.max(0, (allEnded ? Math.max(...runs.map((r) => r.endedAt ?? 0)) : now) - first) / 3_600_000 : 0
  // The shift in course has its own pace, so a good morning does not hide a slow afternoon. Its clock starts with its
  // first code; a line that came running from the other shift counts from the hour this one starts.
  const plan = shiftsOf(s, date, dept), shift = shiftAt(plan, now), since = lastCut(plan, now)
  // (the only shift of a day of one shift starts in the morning, like the first one does: Jose, 2026-10-17)
  const opens = Math.min(now, since + ahead(clockMin(since), mins(shift === 1 || plan.only ? plan.first : plan.second)) * 60_000)
  const one = (r: Run, u: Unit) => (cfg.qty === 'none' ? 1 : unitQty(s, r, u))
  const made = (k: 1 | 2) => runs.reduce((t, r) => t + r.units.filter((u) => shiftAt(plan, u.at) === k).reduce((a, u) => a + one(r, u), 0), 0)
  // The shift in course is all that its people made in its hours, on every line: also on a code that came running from
  // the work day before (a work day changes at the hour between shifts; a code left running goes on). Its bins apart.
  const live = s.runs.filter((r) => r.dept === dept && (!lineId || r.lineId === lineId) && (r.date === date || (r.date < date && (!r.endedAt || r.endedAt > since))))
  const liveRuns = live.filter((r) => !apartOf(r)), liveBins = live.filter((r) => !!apartOf(r))
  const mine = live.filter((r) => !r.endedAt || r.endedAt > since)
  const shiftFirst = mine.length ? Math.min(...mine.map((r) => (r.startedAt >= since ? r.startedAt : opens))) : 0
  const until = nextCut(plan, now)
  const inTurn = (u: Unit) => u.at >= since && u.at < until
  const shiftQty = liveRuns.reduce((t, r) => t + r.units.filter(inTurn).reduce((a, u) => a + one(r, u), 0), 0)
  const shiftUnits = liveRuns.reduce((t, r) => t + countedUnits(r.units).filter(inTurn).length, 0)
  // what the shift in course has made of each code: one it has running is there from zero, before its first unit
  const turn = new Map<string, { code: string; units: number; qty: number; lines: string[] }>()
  for (const r of liveRuns) {
    const made = r.units.filter(inTurn)
    if (!made.length && !mine.includes(r)) continue
    const e = turn.get(normCode(r.code)) ?? { code: r.code, units: 0, qty: 0, lines: [] }
    e.units += countedUnits(made).length; e.qty += made.reduce((a, u) => a + one(r, u), 0)
    const ln = lineNameOf(s, r.lineId, r.line)
    if (!e.lines.includes(ln)) e.lines.push(ln)
    turn.set(normCode(r.code), e)
  }
  // The clock of the shift: it starts with the shift's first code (or, for a line that came running, at the hour the
  // shift starts), it runs while anything is running, it stops where the last code ended (the people said so: they
  // ended their codes or the shift), and the next shift starts again from zero when it starts working.
  const shiftUntil = mine.length > 0 && mine.every((r) => r.endedAt) ? Math.max(...mine.map((r) => r.endedAt ?? 0)) : 0
  // codes left running with nobody recording anything after the shift's hour: the clock waits at that hour (see awayOn)
  const paused = shiftUntil ? 0 : pausedAt(s, date, [...new Set(mine.filter((r) => !r.endedAt).map((r) => r.lineId))], now)
  const shiftMs = shiftFirst ? Math.max(0, (shiftUntil || paused || now) - shiftFirst) : 0
  const shiftHrs = shiftMs / 3_600_000
  return { runs, units, qty, unitLabel: cfg.qty === 'none' ? cfg.plural.toLowerCase() : cfg.qtyUnit, byCode: [...codes.values()].sort((a, b) => b.qty - a.qty), hours, rate: hours >= 1 / 6 ? qty / hours : null, allEnded,
    bins: binTotals(s, binRuns, () => true), shiftBins: binTotals(s, liveBins, (u) => u.at >= since && u.at < until), live: mine.length > 0,
    only: plan.only,
    shift, shiftQty, shiftUnits, shiftCodes: [...turn.values()].sort((a, b) => b.qty - a.qty), shiftRate: shiftHrs >= 1 / 6 ? shiftQty / shiftHrs : null, made: [made(1), made(2)] as [number, number], shiftSince: shiftFirst, shiftUntil, paused, shiftMs }
}

// ---- what arrives from the server (another tablet, the office) ----
const lineOfRow = (row: Row): Line => ({ id: String(row.id), dept: row.dept as Dept, name: String(row.name ?? ''), updatedAt: fromIso(row.updated_at) ?? 0, deleted: !!row.deleted, ...syncedOf(row) })
const runOfRow = (row: Row): Run => ({
  id: String(row.id), dept: row.dept as Dept, lineId: String(row.line_id ?? ''), line: String(row.line ?? ''), code: String(row.code ?? ''), lot: String(row.lot ?? ''), date: String(row.date ?? '').slice(0, 10),
  startedAt: fromIso(row.started_at) ?? 0, endedAt: fromIso(row.ended_at),
  units: (Array.isArray(row.units) ? (row.units as Partial<Unit>[]) : []).map(unitOf),
  perUnit: row.per_unit == null ? null : Number(row.per_unit), waste: Number(row.waste ?? 0), by: String(row.by_name ?? ''), updatedAt: fromIso(row.updated_at) ?? 0, deleted: !!row.deleted, ...syncedOf(row),
  ...((e) => (e ? { extra: e } : {}))(cleanExtra(row.extra)),
})
function changeOfRow(row: Row): Change { return { id: String(row.id), at: fromIso(row.at) ?? 0, by: String(row.by_name ?? ''), dept: (row.dept ?? null) as Dept | null, what: String(row.what ?? ''), before: String(row.before ?? ''), after: String(row.after ?? ''), refTable: String(row.ref_table ?? ''), refKey: String(row.ref_key ?? ''), updatedAt: fromIso(row.updated_at) ?? 0, deleted: !!row.deleted } }
const stopOfRow = (row: Row): Stop => ({ id: String(row.id), dept: row.dept as Dept, lineId: row.line_id == null ? null : String(row.line_id), reason: String(row.reason ?? ''), note: String(row.note ?? ''), startedAt: fromIso(row.started_at) ?? 0, endedAt: fromIso(row.ended_at), by: String(row.by_name ?? ''), updatedAt: fromIso(row.updated_at) ?? 0, deleted: !!row.deleted, ...syncedOf(row) })
/** when the server took this version of the row, by its own clock (nothing for a row that was never there) */
const syncedOf = (row: Row) => { const t = fromIso(row.synced_at); return t ? { syncedAt: t } : {} }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
/** this device's changes (whatever differs from the version it started from) laid over what the server has now */
function merge3<T extends object>(base: T, mine: T, theirs: T, keys: (keyof T)[]): T {
  const out = { ...theirs }
  for (const k of keys) if (!same(mine[k], base[k])) out[k] = mine[k]
  return out
}
const byAt = (a: Unit, b: Unit) => a.at - b.at
/** the moments of the units taken off on purpose, in any of these versions of a run */
const tombs = (...runs: (Run | undefined)[]) => new Set(runs.flatMap((r) => r?.extra?.removed ?? []))
const withTombs = (extra: RunExtra | undefined, dead: Set<number>): RunExtra | undefined => (dead.size ? { ...(extra ?? {}), removed: [...dead].sort((a, b) => a - b) } : extra)
/** the run without these units, which it remembers as taken off */
const withRemoved = (r: Run, ats: number[]): Run => { const dead = new Set([...(r.extra?.removed ?? []), ...ats]); return { ...r, units: r.units.filter((u) => !dead.has(u.at)), extra: withTombs(r.extra, dead) } }
/** every unit of the first, plus the ones only the second has; never one that either version took off on purpose */
const allUnits = (first: Run, second: Run) => { const have = new Set(first.units.map((u) => u.at)), dead = tombs(first, second); return [...first.units, ...second.units.filter((u) => !have.has(u.at))].filter((u) => !dead.has(u.at)).sort(byAt) }
const unionRun = (first: Run, second: Run): Run => ({ ...first, units: allUnits(first, second), extra: withTombs(first.extra, tombs(first, second)) })
/**
 * a unit as the other side has it, with its comment put back when that side says nothing of comments (no key: a
 * build of before pallet comments, which drops what it does not know) and the version it is merged with had one. ''
 * is a comment cleared on purpose, and stands. The rule of mergeNote, unit by unit (Jose, 2026-10-18)
 */
const noteBack = (u: Unit, known: Unit | undefined): Unit => (u.note === undefined && known?.note !== undefined ? { ...u, note: known.note } : u)
/** a unit without its comment: what the floor typed of it (its moment, count, tag, lots, PO) */
const bareUnit = ({ note: _said, ...rest }: Unit): Unit => rest
/** the same unit, read in canonically (unitOf): the order of the keys says nothing */
const sameUnit = (a: Unit, b: Unit) => same(unitOf(a), unitOf(b))
/** the same unit but for its comment */
const sameBare = (a: Unit, b: Unit) => same(bareUnit(unitOf(a)), bareUnit(unitOf(b)))
/**
 * One unit, three ways, its comment apart from the rest (the rule of mergeNote, unit by unit). The lots window invites
 * the line to leave a tag blank and put it later; meanwhile the office comments on that same pallet in Corregir. Before
 * (review of 2026-10-18) the corrected unit went whole and one side was lost in either order: the comment, or the tag
 * without a trace in the row while the line's history still said it was put. Now: I changed only the comment, theirs
 * stands with my comment; they changed only the comment and I left it alone, mine stands with theirs; both changed
 * more than the comment, my correction stands whole, as before. A version without the comment key was written by a
 * build of before and says nothing of it (noteBack).
 */
function mergeUnit(base: Unit, mine: Unit, theirs: Unit): Unit {
  if (sameUnit(mine, base)) return noteBack(theirs, base)
  if (sameBare(mine, base)) { const { note: _theirs, ...rest } = theirs; return mine.note === undefined ? rest : { ...rest, note: mine.note } }
  if (sameBare(theirs, base) && mine.note === base.note) return theirs.note === undefined ? mine : { ...mine, note: theirs.note }
  return mine
}
/**
 * A run's comment when two versions of it meet (Jose, 2026-10-18: comments on the records). It is merged on its own,
 * apart from the rest of the extra: a comment corrected on one device and the pallet being built on the line's tablet
 * are both kept, and neither makes the other's change lose. A version that has no comment key at all was written by
 * a build of before comments, which drops what it does not know: it says nothing about the comment, so the one that
 * was there stays (this build never writes a run without the key once it had one: a cleared comment is '').
 */
function mergeNote(base: string | undefined, mine: string | undefined, theirs: string | undefined) {
  if (mine !== undefined && mine !== base) return mine // this device typed or cleared it
  if (theirs !== undefined) return theirs // the other one's, changed or not
  return base ?? mine // nobody who knows comments changed it: as it was
}
/**
 * two devices changed the same run from the same version: each one's changes are kept. Units are matched by their
 * moment: the ones I added are added, the one I removed stays removed, the one I corrected keeps my correction; the
 * rest is theirs. Waste is an amount people add to, so both additions count.
 */
function mergeRun(base: Run, mine: Run, theirs: Run): Run {
  const out = merge3(base, mine, theirs, ['dept', 'lineId', 'line', 'code', 'lot', 'date', 'startedAt', 'endedAt', 'perUnit', 'by', 'deleted'])
  // what a Packing run carries besides its pallets is merged piece by piece: it used to go whole, so a manager's
  // correction (a pallet taken off) wiped the lot that had just run out on the pallet being built, its cases, its tag
  // and the lot packed now, on the server and on every screen (audit 2026-10-17, S7)
  out.extra = mergeExtra(base.extra, mine.extra, theirs.extra)
  const inBase = new Map(base.units.map((u) => [u.at, u])), inMine = new Map(mine.units.map((u) => [u.at, u])), inTheirs = new Set(theirs.units.map((u) => u.at))
  // what any version took off on purpose stays off, whoever took it
  const dead = tombs(base, mine, theirs)
  // Two NEW units of two tablets can carry the same moment: two people adding a missing pallet at the same typed
  // minute, or two clocks reading the same millisecond. A unit is known by its moment, so one used to swallow the
  // other and a pallet was lost (review of 2026-10-20). A unit of mine that is new on both sides, sits on a moment
  // the other side also filled with something new, and is not the same unit (its echo after a lost answer is), moves
  // to the next free millisecond: both stay. Units the base had are corrections and are matched as always.
  const theirsAt = new Map(theirs.units.map((u) => [u.at, u])), used = new Set([...theirs.units.map((u) => u.at), ...mine.units.map((u) => u.at), ...dead])
  const clash = (u: Unit) => { const t = theirsAt.get(u.at); return !!t && !inBase.has(u.at) && !sameUnit(t, u) }
  const moved = (u: Unit): Unit => { let at = u.at + 1; while (used.has(at)) at++; used.add(at); return { ...u, at } }
  out.units = [
    ...theirs.units.filter((u) => !(inBase.has(u.at) && !inMine.has(u.at))).map((u) => { const m = inMine.get(u.at), b = inBase.get(u.at); return m && b ? mergeUnit(b, m, u) : m && !b && clash(m) ? u : noteBack(u, b ?? m) }),
    ...mine.units.filter((u) => !inBase.has(u.at) && !inTheirs.has(u.at)),
    ...mine.units.filter((u) => clash(u)).map(moved),
  ].filter((u) => !dead.has(u.at)).sort(byAt)
  // (in the order a row is read in, see cleanExtra: the same content must read as the same row in reconcile). The
  // comment merges on its own (mergeNote): mergeExtra goes key by key for the rest
  out.extra = cleanExtra(withNote(withTombs(out.extra, dead), mergeNote(base.extra?.note, mine.extra?.note, theirs.extra?.note)))
  out.waste = mine.waste !== base.waste ? (theirs.waste !== base.waste ? Math.round((theirs.waste + mine.waste - base.waste) * 100) / 100 : mine.waste) : theirs.waste
  return out
}
/**
 * A run's extra, three ways: the bin word, the lot packed now and the measure are each this device's when it changed
 * them, the other's otherwise. The units taken off (removed) are joined by mergeRun, as before. The pallet being built
 * (open): when only one side changed it, that side's stands. When both did and one of them closed it (Pallet completo,
 * or the end of the code: its lots went into a pallet), the close stands as it was (Jose's rule: the lots it closed
 * must not be counted again on the next pallet). Otherwise both kept building it: the lots of both are kept.
 */
function mergeExtra(base: RunExtra | undefined, mine: RunExtra | undefined, theirs: RunExtra | undefined): RunExtra | undefined {
  const b = base ?? {}, m = mine ?? {}, out: RunExtra = { ...(theirs ?? {}) }
  for (const k of ['bin', 'lotNow', 'measure'] as const) {
    if (same(m[k], b[k])) continue
    if (m[k] === undefined) delete out[k]
    else (out as Record<string, unknown>)[k] = m[k]
  }
  if (!same(m.open, b.open)) {
    const closed = (x: RunExtra) => !!b.open && (!x.open || b.open.parts.some((p) => !x.open?.parts.some((q) => q.at === p.at)))
    if (same(out.open, b.open) || closed(m)) { if (m.open) out.open = m.open; else delete out.open }
    else if (!closed(out) && m.open && out.open) out.open = mergeOpen(b.open, m.open, out.open)
    // (the other side closed it: its close stands, see above)
  }
  delete out.removed
  return Object.keys(out).length ? out : undefined
}
/**
 * the lots of a pallet being built, each with what tells it apart: its moment, and its place among the lots that
 * share that moment. Lots only ever go on at the end or are corrected in place, so that place is the same in every
 * version that started from the same one. A moment alone is not enough: a pallet reopened by an older version of the
 * app gave all its lots the moment of the pallet, and a part with no moment reads as 0 (review of 2026-10-18: one lot
 * replaced the other and was counted twice)
 */
function partKeys(parts: PalletPart[]): [string, PalletPart][] {
  const seen = new Map<number, number>()
  return parts.map((p) => { const n = seen.get(p.at) ?? 0; seen.set(p.at, n + 1); return [p.at + '#' + n, p] })
}
/** the pallet being built, changed on both sides and closed on neither: each lot by its moment (see partKeys), each side's changes kept */
function mergeOpen(base: RunExtra['open'], mine: NonNullable<RunExtra['open']>, theirs: NonNullable<RunExtra['open']>): NonNullable<RunExtra['open']> {
  const ofMine = partKeys(mine.parts), ofTheirs = partKeys(theirs.parts)
  const inBase = new Map(partKeys(base?.parts ?? [])), inMine = new Map(ofMine), inTheirs = new Set(ofTheirs.map(([k]) => k))
  const parts = [
    // theirs, without what I took off, with what I corrected
    ...ofTheirs.filter(([k]) => !(inBase.has(k) && !inMine.has(k))).map(([k, p]) => { const x = inMine.get(k), y = inBase.get(k); return x && y && !same(x, y) ? x : p }),
    // and what only I added
    ...ofMine.filter(([k]) => !inBase.has(k) && !inTheirs.has(k)).map(([, p]) => p),
  ].sort((x, y) => x.at - y.at) // (a stable sort: lots that share a moment keep their order)
  const po = !same(mine.po, base?.po) ? mine.po : theirs.po
  return { parts, ...(typeof po === 'string' ? { po } : {}) }
}
type Synced = { id: string; updatedAt: number; deleted?: boolean; syncedAt?: number }
/**
 * How one kind of row is read, written and merged. `keep` is for a change of this device with no common version
 * known: the server's row stands, with what the device holds that only adds (a run's units). `grow` is for a row this
 * device did NOT change: what it holds that the server's version lacks and only adds (units nobody took off on
 * purpose) goes back up as a change of this device; nothing else of the device's copy is ever written over the server.
 */
type Kind<T> = { of: (r: Row) => T; row: (x: T) => Row; merge: (base: T, mine: T, theirs: T) => T; keep: (mine: T, theirs: T) => T; grow?: (theirs: T, mine: T) => T }
const LINE: Kind<Line> = { of: lineOfRow, row: rowOfLine, merge: (b, m, t) => merge3(b, m, t, ['dept', 'name', 'deleted']), keep: (_m, t) => t }
const STOP: Kind<Stop> = { of: stopOfRow, row: rowOfStop, merge: (b, m, t) => merge3(b, m, t, ['dept', 'lineId', 'reason', 'note', 'startedAt', 'endedAt', 'by', 'deleted']), keep: (_m, t) => t }
// (keep: a comment this device holds, the run's or a unit's, stays when the server's version says nothing of comments,
// see mergeNote and noteBack; grow leaves the comments as the server has them: a device that did not change the run
// never writes them back)
const RUN: Kind<Run> = { of: runOfRow, row: rowOfRun, merge: mergeRun, keep: (m, t) => { const u = unionRun(t, m), own = new Map(m.units.map((x) => [x.at, x])); return { ...u, units: u.units.map((x) => noteBack(x, own.get(x.at))), extra: withNote(u.extra, t.extra?.note ?? m.extra?.note) } }, grow: (t, m) => unionRun(t, m) }
const body = (x: Synced) => JSON.stringify({ ...x, updatedAt: 0, syncedAt: 0 })
/** rows deleted while this page is open, with when: a late echo of an earlier version must not bring one back */
const gone = new Map<string, number>()
/**
 * does this queued version of a run or a line change nothing of the version it started from (what the server had)
 * but taking it off? Then it waits for someone who may take it off (sync.ts, mayGo; Jose's decision of 2026-10-18)
 * instead of going up to be kept by the server. A version that also ends the code, or renames the line, is not one:
 * the server takes all of that and keeps only the run or the line (and the history says so, see sayKept). A run still
 * running is not held even so (mayGo): held, it ran on for days everywhere but here
 */
export function onlyTakesOff(table: Table, row: Row, base: Row): boolean {
  const k = (table === 'act_runs' ? RUN : table === 'act_lines' ? LINE : null) as Kind<Synced> | null
  if (!k) return false
  const b = k.of(base), was = k.of(row)
  // (a run's `line` is its line's name as it is now, which putRun writes in on every change: the line renamed since the
  // code started is nobody's change here. Counted, a manager's plain "Borrar corrida" went up under the next person
  // and was undone; review of 2026-10-18)
  const a = table === 'act_runs' ? ({ ...was, line: (b as unknown as Run).line } as Synced) : was
  // (each side as a list of its fields in one order: a version that never had the server's stamp lists it elsewhere)
  const flat = (x: Synced) => JSON.stringify(Object.entries({ ...x, deleted: false, updatedAt: 0, syncedAt: 0 }).sort(([p], [q]) => (p < q ? -1 : 1)))
  return !!a.deleted && !b.deleted && flat(a) === flat(b)
}
/** what this page already wrote in the history about a run or a line the server kept (once each) */
const keptSaid = new Set<string>()
/**
 * the history says that the server kept a run or a line this device took off: "Se borró la corrida…" (or "Línea
 * quitada…") is already there, and without this line the run on the screen would contradict it
 */
function sayKept(table: Table, x: Synced, by: string) {
  // (by = who took it off: the author of the version sent, not whoever is signed in now. A manager's deletion that went
  // up under an operator read as the operator's attempt; review of 2026-10-18)
  const key = table + '|' + x.id + '|' + x.updatedAt
  if (keptSaid.has(key)) return
  keptSaid.add(key)
  if (table === 'act_runs') {
    const r = x as unknown as Run
    logChange(r.dept, 'El servidor no dejó borrar la corrida ' + r.code + ' del ' + r.date + ' (' + r.dept + ', ' + lineNameOf(state, r.lineId, r.line) + ')', '', r.units.length + ' ' + cfgOf(r).plural.toLowerCase() + (r.waste ? ' · waste ' + r.waste + ' lb' : ''), 'act_runs', r.id, by)
  } else if (table === 'act_lines') {
    const l = x as unknown as Line
    logChange(l.dept, 'El servidor no dejó quitar una línea de ' + l.dept, '', l.name, 'act_lines', l.id, by)
  }
}
/** who wrote a queued or sent version of a row (its updated_by), or the person signed in when it does not say */
function authorOf(row: Row) { return String(row.updated_by ?? '') || user.get() }
/**
 * A row from the server meets what this device has; returns the row to keep here (null = no change).
 *
 * The server's order of versions is the truth: each version it takes carries its own clock (synced_at), and a version
 * it has already left behind (a late echo of an earlier one) brings nothing. The devices' clocks (updated_at) decide
 * nothing here: a device whose clock runs minutes ahead used to pass its own copy off as the newer one and write it
 * back over the server, undoing what another tablet had just recorded (a code ended that came back open, a cart
 * gone; seen on the floor on 2026-10-15 and 2026-10-16). Now:
 *  - a row this device did not change: the server's version stands. Only what the device holds that merely adds and
 *    the server lacks (a run's units nobody took off on purpose) goes back up, as a change of this device;
 *  - a change of this device still waiting to go up: it is merged with the server's version from the version both
 *    started from (three ways, each one's changes kept), and that version is the one it then starts from.
 */
function reconcile<T extends Synced>(table: Table, cur: T | undefined, row: Row, k: Kind<T>): T | null {
  const theirs = k.of(row)
  const pend = queued(table, theirs.id)
  const mine = pend ? k.of(pend.row) : cur ? k.of(k.row(cur)) : undefined
  if (theirs.deleted) gone.set(table + '|' + theirs.id, Math.max(theirs.updatedAt, gone.get(table + '|' + theirs.id) ?? 0))
  // Jose's decision of 2026-10-18 (migrations/018, 9 and 10): a run taken off by somebody without "Borrar corridas y
  // paros", or a line by somebody the managers' rule does not let, is kept by the server, and the rest of that write is
  // taken as sent, its stamp included. This device's version of it with deleted=false is that: the run or the line
  // comes back on the screen, and nothing is sent again (it would only be kept again)
  const kept = (x: T) => !!x.deleted && !theirs.deleted && x.updatedAt === theirs.updatedAt
  if (!mine) {
    // (taken off here and sent a moment ago: the answer came, and this is what the server did with it)
    const sent = justSent(table, theirs.id)
    if (sent && kept(k.of(sent.row))) sayKept(table, theirs, authorOf(sent.row))
    return !theirs.deleted && theirs.updatedAt < (gone.get(table + '|' + theirs.id) ?? 0) ? null : theirs
  }
  // a version the server took no later than the one this device already holds: an echo of what is known (or of a
  // version since replaced, together with a change of this device not yet echoed back)
  const known = cur?.syncedAt ?? 0
  const late = !!theirs.syncedAt && !!known && theirs.syncedAt <= known
  const tb = body(theirs), mb = body(mine)
  if (tb === mb) { if (pend) drop(table, theirs.id); return late ? null : theirs } // the same row (an echo of what was sent)
  if (late) return null
  if (!pend) {
    // this device changed nothing here: the server's version stands. What the device holds that only adds goes up as
    // its own change. Also on a device that only looks: the server will not take it from them, so it waits on the
    // device for someone who may send it (see outbox.ts). Left out there, those units were gone from the device for
    // good, and they may be the only copy (rows an older version dropped from its queue; review of 2026-10-18)
    const grown = k.grow ? k.grow(theirs, mine) : theirs
    if (body(grown) === tb) return theirs
    const next = { ...grown, updatedAt: Math.max(clockNow(), theirs.updatedAt + 1) }
    push(table, theirs.id, k.row(next), row)
    return next
  }
  const base = pend.base ? k.of(pend.base) : null
  // the server kept the very version waiting here (its answer was lost, or the live notice came before it): it leaves
  // the queue and the run or the line is shown again. Merged as another tablet's change instead, the version taken off
  // went up once more, to be kept once more
  if (kept(mine)) { drop(table, theirs.id); sayKept(table, theirs, authorOf(pend.row)); return theirs }
  // A version this device itself sent whose answer never came back (the 25 s limit, a WiFi that dropped at that
  // moment, or the live notice that came before the answer): the server took it all the same. It is this change's
  // own past, not another tablet's change: what was recorded after it stays and goes up, starting now from the
  // server's copy of it. Taken for another tablet's version, a stop ended meanwhile came back open, a deleted run came
  // back and waste counted twice (audit 2026-10-17, S1). Known by its stamp AND its content: a row the server changed
  // on the way in (a line renamed "(2)", see migrations/017) is the server's, and is merged as such
  if (pend.tried?.some((t) => { const x = k.of(t); return x.updatedAt === theirs.updatedAt && body(x) === tb })) {
    if (!base || (theirs.syncedAt ?? 0) > (base.syncedAt ?? 0)) rebase(table, theirs.id, pend.row, row)
    return null
  }
  // the server moved past the version this change started from: that one is merged three ways; the version it
  // started from itself (or a later echo of it) has nothing to add, and the change goes up as it is
  const forked = !!base && (theirs.syncedAt && base.syncedAt ? theirs.syncedAt > base.syncedAt : theirs.updatedAt > base.updatedAt || (theirs.updatedAt === base.updatedAt && tb !== body(base)))
  const merged = base ? (forked ? k.merge(base, mine, theirs) : mine) : k.keep(mine, theirs)
  const gb = body(merged)
  if (gb === tb) { drop(table, theirs.id); return theirs }
  if (gb === mb) { if (forked || !base) rebase(table, theirs.id, pend.row, row); return null } // nothing of theirs to take: mine goes up, from the server's version now
  const next = { ...merged, updatedAt: Math.max(clockNow(), mine.updatedAt + 1, theirs.updatedAt + 1) }
  // the server's version is the one this change starts from now. Rebuilt, the change is still its author's, not the
  // person signed in now: a manager's deletion waiting on an operator's tablet (sync.ts, mayGo) while another tablet added
  // a pallet went up named as the operator's, in the run's updated_by and act_runs_log (review of 2026-10-18)
  rebase(table, theirs.id, { ...k.row(next), updated_by: authorOf(pend.row) }, row)
  return next
}

/** one of the rooms this version of the app knows (DEPTS) */
export function roomKnown(dept: unknown): dept is Dept { return (DEPTS as unknown[]).includes(dept) }
/**
 * Jose's decision of 2026-10-18: a room's program (act_plan) and what is set for everybody (act_targets: each shift's
 * goals, the plant calendar, the operators' line rules) go whole, the last change standing, and are not merged. A
 * change waiting here to go up (for days, when the server would not take it from whoever signed in after its author:
 * audit S2) must not write over a change somebody made after it. "After" by the moment each change was made (updated_at,
 * the shared clock): the rule every screen already uses to choose between two versions of these rows (newer, in
 * applyRemote). Sent anyway, the server kept the older change while the screens that had the newer one went on showing
 * it. So when the server's version was made after the one waiting here, the server's stands: this one leaves the
 * queue, and the history says what was not sent, whose it was, and who changed it after (nothing vanishes without a
 * word). sync.ts brings the server's version of each one before it goes up (refreshQueued).
 */
// (the production orders too, Jose 2026-10-19: an order is the office's, kept whole like the program; key = its id)
function keepNewer(table: 'act_plan' | 'act_targets' | 'act_work_orders', row: Row, at: number) {
  const date = String(row.date ?? '').slice(0, 10), dept = row.dept as Dept, code = String(row.code ?? '')
  // (a program: its row is its code and its lot, 2026-10-20: the server's row of another lot of the code is another
  // row, and never takes the place of the one waiting here)
  const key = table === 'act_targets' ? String(row.dept ?? '') : table === 'act_work_orders' ? (isUuid(row.id) ? row.id : '') : isDay(date) && roomKnown(dept) && normCode(code) ? planKey(date, dept, code, row.lot) : ''
  const pend = key ? queued(table, key) : undefined
  if (!pend || !(at > (fromIso(pend.row.updated_at) ?? 0))) return
  drop(table, key)
  const mine = settingOf(table, pend.row), theirs = settingOf(table, row)
  logChange(mine.dept, mine.what + ' · no se subió: ' + (String(row.updated_by ?? '') || 'otra persona') + ' lo cambió después', mine.text, theirs.text, table, key, String(pend.row.updated_by ?? '') || user.get())
}
/** a program's, a setting's or a production order's row as the history says it: what it is, its value, and the room its line goes with */
function settingOf(table: 'act_plan' | 'act_targets' | 'act_work_orders', row: Row): { what: string; text: string; dept: Dept | null } {
  const num = (x: unknown) => (x == null || !(Number(x) > 0) ? '' : String(Number(x)))
  if (table === 'act_plan') { const dept = row.dept as Dept, e = planEndOf(String(row.date ?? '').slice(0, 10), String(row.end_date ?? '').slice(0, 10)); return { what: 'Programa ' + String(row.date ?? '').slice(0, 10) + (e ? ' al ' + e : '') + ' · ' + dept + ' · ' + normCode(String(row.code ?? '')) + lotNote(planLot(row.lot)) + orderNote(isUuid(row.order_id) ? row.order_id : ''), text: num(row.qty), dept: roomKnown(dept) ? dept : null } }
  if (table === 'act_work_orders') { const dept = row.dept as Dept, known = roomKnown(dept); return { what: 'Pedido de producción ' + normCode(String(row.code ?? '')) + (row.wo ? ' WO ' + String(row.wo) : '') + ' (' + String(row.dept ?? '') + ')', text: num(row.qty) + ' ' + (known ? unitKept({ dept, unit: String(row.unit ?? '') }) : String(row.unit ?? '')) + (row.closed_at ? ' · cerrado' : '') + (row.deleted ? ' · borrado' : ''), dept: known ? dept : null } }
  const key = String(row.dept ?? '')
  if (key === OPT_CODES) return { what: 'Códigos de paro', text: codesText(Number(row.per_hour) === 1), dept: null }
  if (key.startsWith(ATT_KEY)) return { what: 'Asistencia · personas esperadas · ' + key.slice(ATT_KEY.length).replace(':', ' · Turno '), text: num(row.per_hour), dept: null }
  if (key.startsWith(OPT_VIEW)) return { what: VIEW_NAMES[key.slice(OPT_VIEW.length) as ViewOpt] ?? key, text: Number(row.per_hour) === 1 ? 'para todos' : 'solo el admin', dept: null }
  if (key === OPT_ATT) return { what: 'Asistencia', text: attText(Number(row.per_hour) === 1), dept: null }
  if (key === OPT_PROGRAM) return { what: 'Programa del día', text: programText(Number(row.per_hour) === 1), dept: null }
  if (key === OPT_LINES) return { what: 'Operadores y líneas', text: linesText({ add: row.per_hour == null || Number(row.per_hour) !== 0, remove: Number(row.per_shift) === 1, updatedAt: 0 }), dept: null }
  if (key.startsWith(WEEK_KEY)) { const w = row.per_hour == null ? '' : String(row.per_hour); return { what: 'Turnos de la semana desde el ' + key.slice(WEEK_KEY.length), text: weekOk(w) ? weekText(w) : '', dept: null } }
  if (key.startsWith(DAY_KEY)) { const n = Number(row.per_hour); return { what: 'Turnos del ' + key.slice(DAY_KEY.length), text: row.per_hour == null ? 'como dice su semana' : dayShiftsText(n === 1 || n === 2 ? n : undefined), dept: null } }
  if (key.startsWith(SHIFTS_KEY)) { const a = unpackShift(row.per_hour), b = unpackShift(row.per_shift); return { what: 'Horario de turnos desde el ' + key.slice(SHIFTS_KEY.length), text: a && b ? shiftsText({ first: a[0], firstEnd: a[1], second: b[0], secondEnd: b[1] }) : '', dept: null } }
  // a goal: of a room or of a line, of one shift (key@1, key@2) or from before the goals were by shift
  const turn = /@([12])$/.exec(key), of = turn ? key.slice(0, -2) : key
  const line = of.startsWith(LINE_KEY) ? state.lines.find((l) => l.id === of.slice(LINE_KEY.length)) : undefined
  const room = line ? line.dept : roomKnown(of) ? of : null
  const name = line ? line.name + ' (' + line.dept + ')' : of.startsWith(LINE_KEY) ? 'de una línea' : of
  const text = [num(row.per_hour) && num(row.per_hour) + ' por hora', num(row.per_shift) && num(row.per_shift) + (turn ? ' del turno' : ' del día')].filter(Boolean).join(' · ')
  return { what: 'Meta ' + name + (turn ? ' · Turno ' + turn[1] : ''), text, dept: room ? goalRoom(room) : null }
}
/** a row that arrived from the server: see reconcile() for the lines, runs and stops; the tables only the office edits keep the newer row */
export function applyRemote(table: string, row: Record<string, unknown>) {
  if (!row || (row.id == null && row.code == null && row.dept == null)) return // the notice of a row removed by hand in the database carries nothing
  // A line, run or stop of a room this version does not know (QC is coming, Jose 2026-10-17): every screen looks its
  // room up, and the first such row left the Reporte blank on a device not yet on the version that knows it (audit
  // 2026-10-17). It is left out here and stays on the server untouched; the first pull of a version that knows the
  // room brings everything again (sync.ts), that row with it
  if ((table === 'act_lines' || table === 'act_runs' || table === 'act_stops') && !roomKnown(row.dept)) return
  const at = fromIso(row.updated_at) ?? 0
  const newer = <T extends { updatedAt: number }>(cur: T | undefined) => !cur || at >= cur.updatedAt
  if (table === 'act_plan' || table === 'act_targets' || table === 'act_work_orders') keepNewer(table, row, at)
  if (table === 'act_lines') {
    const next = reconcile('act_lines', state.lines.find((l) => l.id === row.id), row, LINE)
    if (next) set({ ...state, lines: upsertIn(state.lines, next) })
  } else if (table === 'act_runs') {
    const next = reconcile('act_runs', state.runs.find((r) => r.id === row.id), row, RUN)
    if (next) { set({ ...state, runs: upsertIn(state.runs, next), orderRuns: state.orderRuns.filter((r) => r.id !== next.id) }); healSetup(next.lineId) }
  } else if (table === 'act_stops') {
    const next = reconcile('act_stops', state.stops.find((x) => x.id === row.id), row, STOP)
    if (next) { set({ ...state, stops: upsertIn(state.stops, next) }); if (next.lineId) healSetup(next.lineId) }
  } else if (table === 'act_plan') {
    // a row of a room's program for a day: a code and its lot (2026-10-20, see planKey)
    const date = String(row.date ?? '').slice(0, 10), dept = row.dept as Dept, key = normCode(String(row.code ?? '')), lot = planLot(row.lot)
    if (!isDay(date) || !DEPTS.includes(dept) || !key) return
    // (the server has this row: a whole pull running now must not let it go, see keepServerPlans)
    planHeard.set(planKey(date, dept, key, lot), ++planHeardN)
    if (queued('act_plan', planKey(date, dept, key, lot))) return // what was typed here is newer and on its way
    const cur = state.plans.find((p) => p.date === date && p.dept === dept && normCode(p.code) === key && planLot(p.lot) === lot)
    if (!newer(cur)) return
    // (lot: '' from a server where 019 has not run yet, or a program typed without one; the production order: none
    // from a server where 020 has not run yet, or a plain day's program)
    const end = planEndOf(date, String(row.end_date ?? '').slice(0, 10)), nt = planNote(row.note)
    set({ ...state, plans: [...state.plans.filter((p) => p !== cur), { date, dept, code: cur?.code ?? key, qty: Number(row.qty) > 0 ? Number(row.qty) : 0, lot, ...(isUuid(row.order_id) ? { orderId: row.order_id } : {}), ...(end ? { endDate: end } : {}), ...(nt ? { note: nt } : {}), updatedAt: at }] })
  } else if (table === 'act_work_orders') {
    // a production order (2026-10-19): the newer version stands, as the program's (one of a room this version does not
    // know is left out); a change of it still waiting here keeps what it changed (mergeQueuedOrder)
    const theirs = workOrderOfRow(row, at)
    if (!theirs) return
    const pend = queued('act_work_orders', theirs.id)
    const next = pend ? mergeQueuedOrder(pend, row, theirs) : newer(state.workOrders.find((o) => o.id === theirs.id)) ? theirs : null
    if (next) set({ ...state, workOrders: withOrder(state.workOrders, next) })
  } else if (table === 'act_products') {
    const code = String(row.code ?? ''), key = normCode(code)
    const i = state.products.findIndex((p) => normCode(p.code) === key)
    const cur = i >= 0 ? state.products[i] : undefined
    if (!newer(cur)) return
    const p: Product = { code, name: String(row.name ?? ''), pouchesPerCase: Number(row.pouches_per_case ?? 0), casesPerMix: Number(row.cases_per_mix ?? 0), cratesPerCart: Number(row.crates_per_cart ?? 0), pouchesPerCrate: Number(row.pouches_per_crate ?? 0), casesPerPallet: Number(row.cases_per_pallet ?? 0), ...((r) => (r ? { room: r } : {}))(packRoomOfText(row.room)), ...((u) => (u ? { spiralUnit: u } : {}))(spiralUnitOfText(row.spiral_unit)), ...(Number(row.lb_per_case) > 0 ? { lbPerCase: Number(row.lb_per_case) } : {}), updatedAt: at }
    // the product stays in its place in the table (a changed row must not jump to the end while someone is editing)
    const others = (x: Product, k: number) => k === i || normCode(x.code) !== key
    const products = row.deleted ? state.products.filter((x) => normCode(x.code) !== key) : cur ? state.products.map((x, k) => (k === i ? p : x)).filter(others) : [...state.products, p]
    set({ ...state, products })
  } else if (table === 'act_schedule') {
    const date = String(row.date ?? '').slice(0, 10), code = normCode(String(row.code ?? ''))
    if (!code || queued('act_schedule', date + '|' + code)) return // what was typed here is newer and on its way
    const day = { ...(state.schedule[date] ?? {}) }
    for (const c of Object.keys(day)) if (c !== code && normCode(c) === code) delete day[c]
    day[code] = Number(row.mixes ?? 0)
    set({ ...state, schedule: { ...state.schedule, [date]: day } })
  } else if (table === 'act_changes' && row.ref_table === WO_DONE_REF) {
    // the closed account of a finished production order (see "the account of a finished order"): kept apart from the
    // history lines. The newer one stands, one waiting here to go up stands, and a mark taken away takes it away
    const id = String(row.ref_key ?? '')
    if (!id || queued('act_changes', String(row.id ?? ''))) return
    if (!newer(state.orderSeals.find((x) => x.id === id))) return
    let body: unknown = null
    try { body = JSON.parse(String(row.after ?? '')) } catch { /* not an account */ }
    const seal = row.deleted ? null : sealFrom({ ...(body && typeof body === 'object' ? body : {}), id, updatedAt: at })
    if (!seal && !row.deleted) return
    set({ ...state, orderSeals: [...state.orderSeals.filter((x) => x.id !== id), ...(seal ? [seal] : [])] })
  } else if (table === 'act_changes' && row.ref_table === CUT_REF && String(row.id ?? '').startsWith(CUT_ID)) {
    // a room's own hand-over of a day (2026-10-21): kept apart from the history
    let x: Partial<ShiftMark> = {}
    try { x = JSON.parse(String(row.after ?? '')) as Partial<ShiftMark> } catch { /* not one */ }
    const m = shiftMarkFrom({ ...x, dept: row.dept as Dept, by: String(row.by_name ?? ''), deleted: !!row.deleted, updatedAt: at })
    if (!m) return
    const cur = (state.shiftMarks ?? []).find((y) => y.date === m.date && y.dept === m.dept)
    if (!newer(cur)) return
    set({ ...state, shiftMarks: [...(state.shiftMarks ?? []).filter((y) => y !== cur), m] })
  } else if (table === 'act_changes' && row.ref_table === KPI_REF && String(row.id ?? '').startsWith(KPI_ID)) {
    // a record of the Daily KPI Report (2026-10-22): kept apart from the history. Only rows without a room count: the
    // server lets an operator write a row of her own room, never one without a room (managers and the office)
    if (row.dept != null) return
    const key = String(row.id).slice(KPI_ID.length), cur = (state.kpi ?? []).find((x) => x.key === key)
    if (!newer(cur)) return
    let data: Record<string, unknown> | null = null
    try { data = JSON.parse(String(row.after ?? '')) as Record<string, unknown> } catch { /* not one */ }
    const e = kpiFrom({ key, data: data ?? {}, by: String(row.by_name ?? ''), at: fromIso(row.at) ?? 0, deleted: !!row.deleted, updatedAt: at, ...syncedOf(row) })
    if (e) set({ ...state, kpi: [...(state.kpi ?? []).filter((y) => y.key !== key), e] })
  } else if (table === 'act_changes' && row.ref_table === CHAT_REF && String(row.id ?? '').startsWith(CHAT_SEEN_ID)) {
    // how far the other side has looked at a room's conversation (2026-10-28, see ChatSeen)
    const dept = row.dept as ChatRoom
    let x: { seen?: unknown; side?: unknown } = {}
    try { x = JSON.parse(String(row.after ?? '')) as typeof x } catch { /* not one */ }
    const side: ChatMsg['side'] = x.side === 'room' ? 'room' : 'office', cur = chatSeenOf(state, dept, side)
    if (!chatRoomKnown(dept) || row.deleted || !newer(cur)) return
    const e = chatSeenFrom({ dept, side, at: Number(x.seen), seenAt: fromIso(row.at) ?? 0, by: String(row.by_name ?? ''), updatedAt: at })
    if (e) set({ ...state, chatSeen: [...(state.chatSeen ?? []).filter((y) => y !== cur), e] })
  } else if (table === 'act_changes' && row.ref_table === CHAT_REF && String(row.id ?? '').startsWith(CHAT_ID)) {
    // a message between a room and the office (2026-10-28): kept apart from the history
    const id = String(row.id).slice(CHAT_ID.length), cur = (state.chat ?? []).find((x) => x.id === id)
    if (!newer(cur)) return
    let x: Partial<ChatMsg> = {}
    try { x = JSON.parse(String(row.after ?? '')) as Partial<ChatMsg> } catch { /* not one */ }
    const e = chatFrom({ ...x, id, dept: row.dept as ChatRoom, by: String(row.by_name ?? ''), at: fromIso(row.at) ?? 0, deleted: !!row.deleted, updatedAt: at, ...syncedOf(row) })
    if (e) set({ ...state, chat: [...(state.chat ?? []).filter((y) => y.id !== id), e] })
  } else if (table === 'act_changes' && row.ref_table === RMSG_REF && String(row.id ?? '').startsWith(RMSG_ID)) {
    // the office's message to a room (2026-10-22): kept apart from the history
    const dept = String(row.id).slice(RMSG_ID.length) as Dept, cur = (state.roomMsgs ?? []).find((x) => x.dept === dept)
    if (!(DEPTS as string[]).includes(dept) || !newer(cur)) return
    let x: Partial<RoomMsg> = {}
    try { x = JSON.parse(String(row.after ?? '')) as Partial<RoomMsg> } catch { /* not one */ }
    const e = roomMsgFrom({ ...x, dept, by: String(row.by_name ?? ''), at: fromIso(row.at) ?? 0, deleted: !!row.deleted, updatedAt: at, ...syncedOf(row) })
    if (e) set({ ...state, roomMsgs: [...(state.roomMsgs ?? []).filter((y) => y.dept !== dept), e] })
  } else if (table === 'act_changes' && row.ref_table === ONOTE_REF && String(row.id ?? '').startsWith(ONOTE_ID)) {
    // Packing's comment on an order (2026-10-22): kept apart from the history
    const orderId = String(row.id).slice(ONOTE_ID.length), cur = (state.orderNotes ?? []).find((x) => x.orderId === orderId)
    if (!newer(cur)) return
    let x: Partial<OrderNote> = {}
    try { x = JSON.parse(String(row.after ?? '')) as Partial<OrderNote> } catch { /* not one */ }
    const e = orderNoteFrom({ ...x, orderId, by: String(row.by_name ?? ''), at: fromIso(row.at) ?? 0, deleted: !!row.deleted, updatedAt: at, ...syncedOf(row) })
    if (e) set({ ...state, orderNotes: [...(state.orderNotes ?? []).filter((y) => y.orderId !== orderId), e] })
  } else if (table === 'act_changes' && row.ref_table === HOLD_REF && String(row.id ?? '').startsWith(HOLD_ID)) {
    // a unit on hold (2026-10-23): kept apart from the history
    const id = String(row.id).slice(HOLD_ID.length), cur = (state.holds ?? []).find((x) => x.id === id)
    if (!newer(cur)) return
    let x: Partial<HoldRec> = {}
    try { x = JSON.parse(String(row.after ?? '')) as Partial<HoldRec> } catch { /* not one */ }
    const e = holdFrom({ ...x, id, dept: row.dept as Dept, by: String(row.by_name ?? ''), at: fromIso(row.at) ?? 0, deleted: !!row.deleted, updatedAt: at, ...syncedOf(row) })
    if (e) set({ ...state, holds: [...(state.holds ?? []).filter((y) => y.id !== id), e] })
  } else if (table === 'act_changes' && row.ref_table === CONS_REF && String(row.id ?? '').startsWith(CONS_ID)) {
    // what a room consumed (2026-10-27): kept apart from the history
    const id = String(row.id).slice(CONS_ID.length), cur = (state.consumes ?? []).find((x) => x.id === id)
    if (!newer(cur)) return
    let x: Partial<ConsumeEntry> = {}
    try { x = JSON.parse(String(row.after ?? '')) as Partial<ConsumeEntry> } catch { /* not one */ }
    const e = consumeFrom({ ...x, id, dept: row.dept as Dept, by: String(row.by_name ?? ''), at: fromIso(row.at) ?? 0, deleted: !!row.deleted, updatedAt: at, ...syncedOf(row) })
    if (e) set({ ...state, consumes: [...(state.consumes ?? []).filter((y) => y.id !== id), e] })
  } else if (table === 'act_targets' && String(row.dept ?? '').startsWith(CONS_KEY)) {
    // whether a room weighs what it consumes (2026-10-27)
    const dept = String(row.dept).slice(CONS_KEY.length) as Dept
    if (!DEPTS.includes(dept)) return
    const cur = (state.consumeOpts ?? []).find((x) => x.dept === dept)
    if (!newer(cur)) return
    set({ ...state, consumeOpts: [...(state.consumeOpts ?? []).filter((x) => x !== cur), { dept, on: Number(row.per_hour) === 1, updatedAt: at }] })
  } else if (table === 'act_changes' && row.ref_table === MEAT_REF && String(row.id ?? '').startsWith(MEAT_ID)) {
    // Spiral's meat (2026-10-23): kept apart from the history
    const id = String(row.id).slice(MEAT_ID.length), cur = (state.meats ?? []).find((x) => x.id === id)
    if (!newer(cur)) return
    let x: Partial<MeatEntry> = {}
    try { x = JSON.parse(String(row.after ?? '')) as Partial<MeatEntry> } catch { /* not one */ }
    const e = meatFrom({ ...x, id, dept: row.dept as Dept, by: String(row.by_name ?? ''), at: fromIso(row.at) ?? 0, deleted: !!row.deleted, updatedAt: at, ...syncedOf(row) })
    if (e) set({ ...state, meats: [...(state.meats ?? []).filter((y) => y.id !== id), e] })
  } else if (table === 'act_changes' && row.ref_table === WT_REF && String(row.id ?? '').startsWith(WT_ID)) {
    // a weight test (2026-10-22): kept apart from the history
    const id = String(row.id).slice(WT_ID.length), cur = (state.weights ?? []).find((x) => x.id === id)
    if (!newer(cur)) return
    let x: Partial<WeightTest> = {}
    try { x = JSON.parse(String(row.after ?? '')) as Partial<WeightTest> } catch { /* not one */ }
    const e = wtFrom({ ...x, id, dept: row.dept as Dept, by: String(row.by_name ?? ''), at: fromIso(row.at) ?? 0, deleted: !!row.deleted, updatedAt: at, ...syncedOf(row) })
    if (e) set({ ...state, weights: [...(state.weights ?? []).filter((y) => y.id !== id), e] })
  } else if (table === 'act_changes' && row.ref_table === ATT_REF && String(row.id ?? '').startsWith(ATT_ID)) {
    // a person of a room's attendance (2026-10-20): kept apart from the history
    const id = String(row.id).slice(ATT_ID.length), cur = (state.attendance ?? []).find((x) => x.id === id)
    if (!newer(cur)) return
    let x: Partial<AttEntry> = {}
    try { x = JSON.parse(String(row.after ?? '')) as Partial<AttEntry> } catch { /* not one */ }
    const e = attFrom({ ...x, id, dept: row.dept as Dept, by: String(row.by_name ?? ''), at: fromIso(row.at) ?? 0, deleted: !!row.deleted, updatedAt: at, ...syncedOf(row) })
    if (e) set({ ...state, attendance: [...(state.attendance ?? []).filter((y) => y.id !== id), e] })
  } else if (table === 'act_targets' && String(row.dept ?? '').startsWith(WRULE_KEY)) {
    // how often a room weighs and how many (2026-10-23)
    const dept = String(row.dept).slice(WRULE_KEY.length) as Dept
    if (!DEPTS.includes(dept)) return
    const cur = (state.weightRules ?? []).find((x) => x.dept === dept)
    if (!newer(cur) || !(Number(row.per_hour) >= 0)) return
    set({ ...state, weightRules: [...(state.weightRules ?? []).filter((x) => x !== cur), { dept, every: Math.round(Number(row.per_hour)), count: Math.max(0, Math.round(Number(row.per_shift) || 0)), updatedAt: at }] })
  } else if (table === 'act_targets' && String(row.dept ?? '').startsWith(SLOWLN_KEY)) {
    // the slow-line signal turned off or on for one line (2026-10-28)
    const lineId = String(row.dept).slice(SLOWLN_KEY.length)
    const cur = (state.slowLines ?? []).find((x) => x.lineId === lineId)
    if (!lineId || !newer(cur)) return
    set({ ...state, slowLines: [...(state.slowLines ?? []).filter((x) => x !== cur), { lineId, off: Number(row.per_hour) === 0, updatedAt: at }] })
  } else if (table === 'act_targets' && String(row.dept ?? '').startsWith(SLOW_KEY)) {
    // a room's minimum per hour for the slow-line signal (2026-10-28)
    const dept = String(row.dept).slice(SLOW_KEY.length) as Dept
    if (!DEPTS.includes(dept)) return
    const cur = (state.slowRules ?? []).find((x) => x.dept === dept)
    if (!newer(cur) || !(Number(row.per_hour) >= 0)) return
    set({ ...state, slowRules: [...(state.slowRules ?? []).filter((x) => x !== cur), { dept, perHour: Math.round(Number(row.per_hour)), updatedAt: at }] })
  } else if (table === 'act_targets' && String(row.dept ?? '').startsWith(ATT_KEY)) {
    // a room's people expected on a shift (2026-10-20)
    const [dept, k] = String(row.dept).slice(ATT_KEY.length).split(':'), shift = Number(k)
    if (!roomKnown(dept as Dept) || (shift !== 1 && shift !== 2)) return
    const cur = (state.attExpected ?? []).find((x) => x.dept === dept && x.shift === shift)
    if (!newer(cur) || !(Number(row.per_hour) >= 0)) return
    set({ ...state, attExpected: [...(state.attExpected ?? []).filter((x) => x !== cur), { dept: dept as Dept, shift: shift as 1 | 2, n: Math.round(Number(row.per_hour)), updatedAt: at }] })
  } else if (table === 'act_changes' && row.ref_table === ORDER_REF && String(row.id ?? '').startsWith(ORDER_ID)) {
    // an order (see "the orders Packing fills"): kept apart from the history
    const id = String(row.id).slice(ORDER_ID.length)
    if (!newer(state.orders.find((o) => o.id === id))) return
    let x: Partial<Order> | null = null
    try { x = JSON.parse(String(row.after ?? '')) as Partial<Order> } catch { /* not an order */ }
    const o = row.deleted ? null : orderOf(id, x, String(row.by_name ?? ''), at)
    set({ ...state, orders: [...state.orders.filter((y) => y.id !== id), ...(o ? [o] : [])] })
  } else if (table === 'act_changes') {
    const cur = state.changes.find((c) => c.id === row.id)
    if (!newer(cur)) return
    const c = changeOfRow(row)
    set({ ...state, changes: upsertIn(state.changes, c) })
  } else if (table === 'act_targets' && String(row.dept ?? '') === OPT_LINES) {
    // what operators may do with their room's lines (a row without values: as at first, add yes, remove no)
    if (!newer(state.lineRules)) return
    set({ ...state, lineRules: { add: row.per_hour == null || Number(row.per_hour) !== 0, remove: Number(row.per_shift) === 1, updatedAt: at } })
  } else if (table === 'act_targets' && String(row.dept ?? '').startsWith(OPT_VIEW)) {
    const name = String(row.dept).slice(OPT_VIEW.length) as ViewOpt
    if (name !== 'lotes' && name !== 'flujo') return
    if (!newer(state.viewOpts[name])) return
    set({ ...state, viewOpts: { ...state.viewOpts, [name]: { on: Number(row.per_hour) === 1, updatedAt: at } } })
  } else if (table === 'act_targets' && String(row.dept ?? '') === OPT_ATT) {
    // the attendance switch (a row without its value: off, as at first)
    if (!newer(state.attView)) return
    set({ ...state, attView: { on: Number(row.per_hour) === 1, updatedAt: at } })
  } else if (table === 'act_targets' && String(row.dept ?? '') === OPT_LB) {
    // pounds per case in the KPI (2026-10-28)
    if (!newer(state.lbCase)) return
    set({ ...state, lbCase: { on: Number(row.per_hour) === 1, updatedAt: at } })
  } else if (table === 'act_targets' && String(row.dept ?? '') === OPT_ATTWRITE) {
    // the hour written is the hour they came (2026-10-29)
    if (!newer(state.attWrite)) return
    set({ ...state, attWrite: { on: Number(row.per_hour) === 1, updatedAt: at } })
  } else if (table === 'act_targets' && String(row.dept ?? '') === OPT_LUNCH) {
    // the lunch not counted in the labor hours (2026-10-29)
    if (!newer(state.lunch)) return
    set({ ...state, lunch: { min: Math.max(0, Math.round(Number(row.per_hour) || 0)), after: Math.max(0, Number(row.per_shift) || 0), updatedAt: at } })
  } else if (table === 'act_targets' && String(row.dept ?? '') === OPT_CRATES) {
    // the crates of an RTE cart, plant-wide (2026-10-28)
    if (!newer(state.cartCrates)) return
    set({ ...state, cartCrates: { n: Math.max(0, Math.round(Number(row.per_hour) || 0)), updatedAt: at } })
  } else if (table === 'act_targets' && String(row.dept ?? '') === OPT_ATTGATE) {
    // attendance before starting (2026-10-27)
    if (!newer(state.attGate)) return
    set({ ...state, attGate: { on: Number(row.per_hour) === 1, updatedAt: at } })
  } else if (table === 'act_targets' && String(row.dept ?? '') === OPT_PROGRAM) {
    // the Programa del día switch (a row without its value: off, as at first)
    if (!newer(state.programView)) return
    set({ ...state, programView: { on: Number(row.per_hour) === 1, updatedAt: at } })
  } else if (table === 'act_targets' && String(row.dept ?? '') === OPT_CODES) {
    // the Reason Codes switch (a row without its value: off, as at first)
    if (!newer(state.reasonCodes)) return
    set({ ...state, reasonCodes: { on: Number(row.per_hour) === 1, updatedAt: at } })
  } else if (table === 'act_targets' && String(row.dept ?? '').startsWith(WEEK_KEY)) {
    // which shifts work each day of the week, from a date on (a version without its digits was taken back)
    const from = String(row.dept).slice(WEEK_KEY.length), w = row.per_hour == null ? '' : String(row.per_hour)
    if (!isDay(from) || !newer(state.shiftWeeks.find((x) => x.from === from))) return
    set({ ...state, shiftWeeks: [...state.shiftWeeks.filter((y) => y.from !== from), ...(weekOk(w) ? [{ from, week: w, updatedAt: at }] : [])] })
  } else if (table === 'act_targets' && String(row.dept ?? '').startsWith(DAY_KEY)) {
    // a day apart from its week (null = as its week says again)
    const date = String(row.dept).slice(DAY_KEY.length), n = Number(row.per_hour)
    if (!isDay(date) || !newer(state.dayShifts.find((x) => x.date === date))) return
    set({ ...state, dayShifts: [...state.dayShifts.filter((y) => y.date !== date), ...(row.per_hour != null && (n === 1 || n === 2 || n === 3) ? [{ date, only: n as 1 | 2 | 3, updatedAt: at }] : [])] })
  } else if (table === 'act_targets' && String(row.dept ?? '').startsWith(SHIFTS_KEY)) {
    // the hours of the shifts from a date on (a version without its hours was taken back)
    const from = String(row.dept).slice(SHIFTS_KEY.length), a = unpackShift(row.per_hour), b = unpackShift(row.per_shift)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !newer(state.shifts.find((x) => x.from === from))) return
    const x: ShiftPlan | null = a && b ? { from, first: a[0], firstEnd: a[1], second: b[0], secondEnd: b[1], updatedAt: at } : null
    set({ ...state, shifts: [...state.shifts.filter((y) => y.from !== from), ...(x && !shiftsProblem(x) ? [x] : [])] })
  } else if (table === 'act_targets' && isTurnKey(String(row.dept ?? ''))) {
    // the goal of one shift, of a room or of a line
    const key = String(row.dept)
    if (!newer(state.turnGoals.find((g) => g.key === key))) return
    const num = (x: unknown) => (x == null || !(Number(x) > 0) ? null : Number(x))
    set({ ...state, turnGoals: [...state.turnGoals.filter((g) => g.key !== key), { key, perHour: num(row.per_hour), total: num(row.per_shift), updatedAt: at }] })
  } else if (table === 'act_targets' && String(row.dept ?? '').startsWith(LINE_KEY)) {
    // the goal of one line
    const lineId = String(row.dept).slice(LINE_KEY.length)
    if (!lineId || !newer(state.lineTargets.find((t) => t.lineId === lineId))) return
    const num = (x: unknown) => (x == null || !(Number(x) > 0) ? null : Number(x))
    set({ ...state, lineTargets: [...state.lineTargets.filter((t) => t.lineId !== lineId), { lineId, perHour: num(row.per_hour), perDay: num(row.per_shift), updatedAt: at }] })
  } else if (table === 'act_targets') {
    const dept = row.dept as Dept
    if (!DEPTS.includes(dept) || !newer(state.targets.find((t) => t.dept === dept))) return
    const t: Target = { dept, perHour: row.per_hour == null ? null : Number(row.per_hour), perShift: row.per_shift == null ? null : Number(row.per_shift), updatedAt: at }
    set({ ...state, targets: [...state.targets.filter((x) => x.dept !== dept), t] })
  }
}
/**
 * The lines, runs and stops of this device that the server never confirmed (no stamp of its own, syncedAt), queued
 * for it: the pilot's tablets bring their days along. Until 2026-10-17 it sent everything the device held, with no
 * version to merge from, and the server keeps no order for products, the program, goals, shift hours or orders: a
 * device that had not pulled for a while put its old copies of them back over the office's newer ones (audit H4).
 * What the server has is never sent from here; the rows sent are merged as any change is (reconcile, sync.ts).
 */
export function uploadAll() {
  let n = 0
  for (const l of state.lines) if (!l.syncedAt) { push('act_lines', l.id, rowOfLine({ ...l, updatedAt: l.updatedAt || clockNow() })); n++ }
  for (const r of state.runs) if (!r.syncedAt) { push('act_runs', r.id, rowOfRun({ ...r, updatedAt: r.updatedAt || clockNow() })); n++ }
  for (const x of state.stops) if (!x.syncedAt) { push('act_stops', x.id, rowOfStop({ ...x, updatedAt: x.updatedAt || clockNow() })); n++ }
  return n
}
/** "71.4", "71,4", "1.234,5" or "1,234.5" → a number (0 for a blank or something that is not one) */
export function numOf(text: string) {
  let x = String(text ?? '').replace(/\s/g, '')
  if (!x) return 0
  const dot = x.lastIndexOf('.'), comma = x.lastIndexOf(',')
  if (dot >= 0 && comma >= 0) x = dot > comma ? x.replace(/,/g, '') : x.replace(/\./g, '').replace(',', '.')
  else if (comma >= 0) x = x.replace(',', '.')
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}
/**
 * the office's CSV (columns found by their names, in Spanish or English) → products; returns what could be read.
 * The separator is whichever the header line uses (comma, semicolon or tab: Excel picks it by the PC's language), so a
 * decimal comma inside a semicolon file is a number, not a new column.
 */
export function parseProductsCsv(text: string): Product[] {
  const src = text.replace(/^\uFEFF/, '')
  const headLine = src.split(/\r?\n/, 1)[0] ?? ''
  const count = (ch: string) => { let n = 0, q = false; for (const c of headLine) { if (c === '"') q = !q; else if (!q && c === ch) n++ } return n }
  const sep = [',', ';', '\t'].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',')
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (q) { if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch }
    else if (ch === '"') q = true
    else if (ch === sep) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  // the ' that guards a text from Excel (see csvCell) is not part of it: one before = + - @ is taken off, so the
  // app's own file (or one the office saved again in Excel) reads back as it was; a ' before anything else stays
  for (const r of rows) for (let k = 0; k < r.length; k++) r[k] = r[k].replace(/^'(?=[=+\-@\t\r])/, '')
  const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase())
  const find = (...keys: string[]) => head.findIndex((h) => keys.some((k) => h.includes(k)))
  const cCode = find('código', 'codigo', 'code'), cName = find('producto rte', 'producto', 'r-t-e', 'item', 'name')
  const cPpc = find('pouches por caja', 'pouches/'), cYield = find('cajas por mezcla', 'yield x'), cPallet = find('cajas por pallet', 'palet')
  const cCrates = find('guacales'), cPerCrate = find('pouches por guacal'), cRoom = find('lo empaca', 'empaca', 'room'), cSpiral = find('spiral')
  const cLb = find('lb por caja', 'libras por caja', 'lb/case', 'lb per case', 'lb / caja')
  const n = (r: string[], c: number) => (c < 0 ? 0 : numOf(r[c] ?? ''))
  const out: Product[] = []
  for (const r of rows) {
    const code = cCode < 0 ? '' : String(r[cCode] ?? '').trim().toUpperCase()
    if (!code) continue
    const room = cRoom < 0 ? undefined : packRoomOfText(r[cRoom]), spiralUnit = cSpiral < 0 ? undefined : spiralUnitOfText(r[cSpiral])
    out.push({ code, name: cName < 0 ? '' : String(r[cName] ?? '').trim(), pouchesPerCase: n(r, cPpc), casesPerMix: n(r, cYield), cratesPerCart: n(r, cCrates), pouchesPerCrate: n(r, cPerCrate), casesPerPallet: n(r, cPallet), ...(n(r, cLb) > 0 ? { lbPerCase: n(r, cLb) } : {}), ...(room ? { room } : {}), ...(spiralUnit ? { spiralUnit } : {}), updatedAt: 0 })
  }
  return out
}
/**
 * One cell of a CSV the office opens in Excel. A text that begins with = + - @ (or a tab or a line break) is read by
 * Excel as a formula: a stop typed under "Otra", a lot, a tag or a product name such as =HYPERLINK(...) would run
 * when the file is opened (audit 2026-10-17, H1). Such a text gets a ' in front, Excel's own mark for "this is text".
 * Numbers go as they are (-5 is a number, not a formula). The app takes that ' off again when it reads its own
 * products CSV back (parseProductsCsv), so a code or a name comes back exactly as it was.
 */
export function csvCell(v: string | number | null | undefined): string {
  let t = v == null ? '' : String(v)
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = "'" + t
  return '"' + t.replace(/"/g, '""') + '"'
}
export function productsCsv(products: Product[]) {
  const q = csvCell
  const head = ['Código', 'Producto', 'Pouches por caja', 'Cajas por mezcla (yield)', 'Cajas por pallet', 'Guacales por carro', 'Pouches por guacal', 'Lo empaca', 'Spiral cuenta en', 'Lb por caja']
  return '﻿' + [head, ...products.map((p) => [p.code, p.name, p.pouchesPerCase, p.casesPerMix, p.casesPerPallet, p.cratesPerCart, p.pouchesPerCrate, p.room ?? '', p.spiralUnit ?? '', p.lbPerCase ?? ''])].map((r) => r.map(q).join(',')).join('\r\n')
}

/** the codes open on a line at once (one, except by a fault: two devices that could not see each other both started one), the newest first */
export const openRuns = (s: State, lineId: string) => s.runs.filter((r) => r.lineId === lineId && !r.endedAt).sort((a, b) => b.startedAt - a.startedAt)
/** the code running on a line: the newest one started, when by a fault there is more than one (see openRuns) */
export const openRun = (s: State, lineId: string) => openRuns(s, lineId)[0]
/**
 * A line with two codes open at once: the older ones end where the newest started (or at their own last unit, when
 * it came later), so the line's card and the day's numbers go by one code. What each one made stays as it is.
 */
export function endOlderRuns(lineId: string) {
  const open = openRuns(state, lineId)
  if (open.length < 2) return
  const newest = open[0]
  batch(() => {
    for (const r of open.slice(1)) {
      const at = Math.max(newest.startedAt, after(r))
      putRun({ ...r, endedAt: at })
      logChange(r.dept, 'Corrida ' + r.code + ' del ' + r.date + ' (' + r.dept + ', ' + lineNameOf(state, r.lineId, r.line) + ') · Fin', 'abierta a la vez que ' + newest.code + ' desde las ' + fmtTime(newest.startedAt), fmtTime(at), 'act_runs', r.id)
    }
  })
}
/** the stop holding this line right now: its own, or one of the whole department */
export const openStop = (s: State, dept: Dept, lineId: string) => s.stops.find((x) => !x.endedAt && x.dept === dept && (x.lineId === lineId || x.lineId === null))
export const deptStop = (s: State, dept: Dept) => s.stops.find((x) => !x.endedAt && x.dept === dept && x.lineId === null)
export const stopsOf = (s: State, dept: Dept, lineId: string) => s.stops.filter((x) => x.dept === dept && (x.lineId === lineId || x.lineId === null))
/**
 * the quantity per unit suggested for this code: the master table's (pouches per cart in RTE, cases per pallet in
 * Packing), so a number the office corrects reaches the line; without one, what this room used the last time
 */
export function lastPerUnit(s: State, dept: Dept, code: string) {
  const p = productOf(s, code)
  const table = p ? (dept === 'RTE' ? cartPouches(p) : dept === 'Packing' ? p.casesPerPallet : 0) : 0
  if (table) return table
  const key = normCode(code)
  const last = s.runs.filter((r) => r.dept === dept && normCode(r.code) === key && r.perUnit != null).sort((a, b) => b.startedAt - a.startedAt)[0]
  return last?.perUnit ?? null
}
// ---- "¿Seguro?": a quantity typed that is more than twice the usual ----
/**
 * A quantity that counts (the pouches of a cart, the cases of a pallet, what a bin holds, the quantity per unit a code
 * starts with), typed more than twice the usual for that product and room, is asked about before it is saved: a 2400
 * typed for 240 would count ten carts (Jose, 2026-10-18). The usual is only one the app already knows; with none,
 * nothing is asked (no figure is made up for it), and nothing is ever written in a box for the person (no guessed data).
 */
export function tooMuch(n: number, usual: number | null | undefined): boolean {
  return usual != null && Number.isFinite(usual) && usual > 0 && Number.isFinite(n) && n > 2 * usual
}
/**
 * The usual quantity per unit of a code in a room, counted the room's own way (`word` '' = carts of pouches in RTE,
 * pallets of cases in Packing): the products table's (pouches per cart, cases per pallet), else what the last run of
 * the code counted that way had (what the box proposes when a code starts, see lastPerUnit; a run of bins, or a deleted
 * one, does not count). null = the app knows none: Kitchen's and Spiral's mezclas, Spiral's pounds and cases, MFO's
 * platos, copas and pounds, Packing's bins have no column in the table and start with no quantity per unit.
 */
export function usualFor(s: State, dept: Dept, code: string, word = ''): number | null {
  if (word || (dept !== 'RTE' && dept !== 'Packing')) return null
  const p = productOf(s, code), table = p ? (dept === 'RTE' ? cartPouches(p) : p.casesPerPallet) : 0
  if (table > 0) return table
  const key = normCode(code)
  const last = s.runs.filter((r) => r.dept === dept && !r.deleted && !kindOf(r) && normCode(r.code) === key && r.perUnit != null && r.perUnit > 0).sort((a, b) => b.startedAt - a.startedAt)[0]
  return last?.perUnit ?? null
}
/** the usual quantity of one unit of a run: its own quantity per unit (pouches per cart, cases per pallet), else its code's (usualFor) */
export function usualOf(s: State, r: Run): number | null {
  return r.perUnit != null && r.perUnit > 0 ? r.perUnit : usualFor(s, r.dept, r.code, kindOf(r))
}
/** one box of a form as "¿Seguro?" sees it: the number it holds now and the usual it is held against */
export type QtyCheck = { key: string; n: number; usual: number | null | undefined }
/**
 * the box to ask about first: more than twice its usual, and not already answered "Sí" with this same number (`sure`:
 * box → the number confirmed). "Corregir" confirms nothing, so the same number is asked about again on the next save.
 */
export function askFirst<T extends QtyCheck>(boxes: T[], sure: Record<string, number>): T | null {
  return boxes.find((b) => tooMuch(b.n, b.usual) && sure[b.key] !== b.n) ?? null
}
/**
 * The boxes of a correction (Corregir) that "¿Seguro?" looks at: only what was changed against how the form opened, as
 * applyDraft saves it. The quantity per unit, held against the run's own (or its code's); and each unit whose quantity
 * or lots changed (a pallet's quantity is the sum of its lots), held against the quantity per unit now in the form.
 * index = the unit's place in the form (-1 = the quantity per unit); lots = how many lots make the number.
 */
export function draftChecks(s: State, r: Run, opened: RunDraft, draft: RunDraft): (QtyCheck & { index: number; lots: number })[] {
  const cfg = cfgOf(r), num = (t: string) => (t.trim() ? Number(t.trim().replace(',', '.')) : NaN), out: (QtyCheck & { index: number; lots: number })[] = []
  const perChanged = !!cfg.perUnitLabel && draft.per.trim() !== opened.per.trim()
  if (perChanged) out.push({ key: 'per', n: num(draft.per), usual: usualOf(s, r), index: -1, lots: 0 })
  const perNow = cfg.perUnitLabel && num(draft.per) > 0 ? num(draft.per) : usualOf(s, r)
  if (cfg.qty === 'none') return out
  const was = new Map(opened.units.map((u) => [u.at, u]))
  draft.units.forEach((u, index) => {
    const a = was.get(u.at), lotsChanged = !!a && JSON.stringify(a.lots ?? null) !== JSON.stringify(u.lots ?? null)
    if (!a || (!lotsChanged && u.qty.trim() === a.qty.trim())) return // added after the form opened, or untouched
    const parts = lotsChanged ? cleanLots(u.lots) : undefined
    out.push({ key: 'u' + u.at, n: parts ? parts.reduce((t, l) => t + l.qty, 0) : num(u.qty), usual: perNow, index, lots: parts?.length ?? 0 })
  })
  return out
}

/**
 * the stretches of [a, b] spent stopped, merged: a line's own stop inside a department stop counts once, and a
 * moment covered by two stops goes to the one that began first (so the reasons add up to the stopped time)
 */
function stoppedPieces(a: number, b: number, stops: Stop[], now: number) {
  const pieces: { from: number; to: number; reason: string }[] = []
  let cursor = a
  for (const x of [...stops].sort((p, q) => p.startedAt - q.startedAt)) {
    const s = Math.max(a, x.startedAt), e = Math.min(b, x.endedAt ?? now)
    if (e <= s) continue
    const from = Math.max(s, cursor)
    if (e > from) pieces.push({ from, to: e, reason: x.reason })
    cursor = Math.max(cursor, e)
  }
  return pieces
}
const stoppedBetween = (a: number, b: number, stops: Stop[], now: number) => stoppedPieces(a, b, stops, now).reduce((t, p) => t + (p.to - p.from), 0)
/** time between two moments without what was spent stopped */
export const activeBetween = (a: number, b: number, stops: Stop[], now: number) => Math.max(0, b - a - stoppedBetween(a, b, stops, now))

/** a run's numbers. A stretch between two shifts that the line went through without a single record does not count (see awayOn) */
export function runStats(s: State, r: Run, now: number) {
  const stops = stopsOf(s, r.dept, r.lineId), end = r.endedAt ?? now
  const away = awayOn(s, r.lineId, r.date, r.startedAt, end, now)
  const there = (a: number, b: number) => (away.length ? without(a, b, away) : b > a ? [{ from: a, to: b }] : [])
  const worked = (a: number, b: number) => there(a, b).reduce((t, x) => t + activeBetween(x.from, x.to, stops, now), 0)
  const working = worked(r.startedAt, end)
  // a set up while the code runs is not working and not stopped either: it is counted apart (setup), and the time
  // stopped (down) and its causes are the rest
  const pieces = there(r.startedAt, end).flatMap((x) => stoppedPieces(x.from, x.to, stops, now))
  const down = pieces.filter((p) => p.reason !== SETUP).reduce((t, p) => t + (p.to - p.from), 0)
  const setup = pieces.filter((p) => p.reason === SETUP).reduce((t, p) => t + (p.to - p.from), 0)
  const unitTimes = r.units.map((u, i) => worked(i ? r.units[i - 1].at : r.startedAt, u.at))
  const avg = unitTimes.length ? unitTimes.reduce((a, b) => a + b, 0) / unitTimes.length : 0
  const qty = runQty(s, r)
  const reasons: Record<string, number> = Object.create(null) // (keyed by typed causes: see runInShift)
  for (const p of pieces) if (p.reason !== SETUP) reasons[p.reason] = (reasons[p.reason] ?? 0) + (p.to - p.from)
  return { working, down, setup, unitTimes, avg, qty, reasons, total: end - r.startedAt }
}
/**
 * A run as the shift in course sees it. A code that came running from the shift before (`carried`) is not this
 * shift's from its start: what this shift has made of it, and the time it has worked and been stopped on it, count
 * from the hand-over (`since`), from zero; what it brought is in `before`. A code this shift started is all its own.
 * Nothing is cut in what is kept: the run is one, and the report still tells what each shift did of it.
 */
export function runSince(s: State, r: Run, since: number, now: number) {
  const whole = runStats(s, r, now)
  if (r.startedAt >= since) return { carried: false, units: r.units.length, qty: whole.qty, working: whole.working, down: whole.down, setup: whole.setup, avg: whole.avg, before: { units: 0, qty: 0 } }
  const stops = stopsOf(s, r.dept, r.lineId), end = r.endedAt ?? now, from = Math.min(since, end)
  const away = awayOn(s, r.lineId, r.date, from, end, now)
  const worked = (a: number, b: number) => without(a, b, away).reduce((t, x) => t + activeBetween(x.from, x.to, stops, now), 0)
  const pieces = without(from, end, away).flatMap((x) => stoppedPieces(x.from, x.to, stops, now))
  const down = pieces.filter((p) => p.reason !== SETUP).reduce((t, p) => t + (p.to - p.from), 0)
  const setup = pieces.filter((p) => p.reason === SETUP).reduce((t, p) => t + (p.to - p.from), 0)
  const mine = r.units.map((u, i) => ({ u, i })).filter((x) => x.u.at >= since)
  const qty = mine.reduce((t, x) => t + unitQty(s, r, x.u), 0)
  // its first unit of this shift is timed from the hand-over, not from the last unit of the shift before
  const times = mine.map((x) => worked(Math.max(x.i ? r.units[x.i - 1].at : r.startedAt, since), x.u.at))
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0
  return { carried: true, units: mine.length, qty, working: worked(from, end), down, setup, avg, before: { units: r.units.length - mine.length, qty: whole.qty - qty } }
}
/** "2 carros · 240 pouches": so many units and what they carry, in the department's own words */
export function unitsText(dept: Dept, units: number, qty: number, c: DeptCfg = CFG[dept]) {
  return units + ' ' + (units === 1 ? c.unit : c.plural).toLowerCase() + (c.qty !== 'none' ? ' · ' + qty.toLocaleString('en-US') + ' ' + c.qtyUnit : '')
}
/** what a run produced, said the same way (with the tag / bin numbers if asked) */
export function madeText(r: Run, qty: number, withRefs = false) {
  const refs = withRefs ? r.units.map((u) => u.ref).filter(Boolean) : []
  const c = cfgOf(r)
  return unitsText(r.dept, r.units.length, qty, c) + (refs.length ? ' (' + (c.refWord ?? '') + ' ' + refs.join(', ') + ')' : '')
}

export function fmtDur(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  return (h ? h + ':' : '') + pad(m) + ':' + pad(x)
}
// One formatter, made once: toLocaleTimeString with options builds a new one on every call, which made the report's
// search (a time for each of thousands of records) take most of a second. Same text; a time that is not one ("Invalid
// Date") still comes out as before instead of throwing.
const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
export const fmtTime = (ms: number) => (Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? TIME.format(ms) : new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
// (the next three are shared by the screens and the report's search, so a number, a lot and a word read the same everywhere)
/** "1,250": a count with a comma in the thousands */
export const fmtN = (x: number) => Math.round(x).toLocaleString('en-US')
/** "6168-6216", "6168/6216": two lots typed as one; a pallet with two lots is recorded lot by lot, each with its cases */
export const looksLikeTwoLots = (lot: string) => /^\s*\d{3,5}\s*[-/,+]\s*\d{3,5}\s*$/.test(lot)
/** without accents or capitals: what is typed in a search matches what was written */
export const plainText = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
