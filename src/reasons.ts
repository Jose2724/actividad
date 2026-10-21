import { phrase, tr } from './i18n'

/**
 * The plant's standard "Reason Codes" (Jose, 2026-10-20, the list of his new boss: "estas son las únicas razones por
 * la que pueden parar"). While the option is on (Ajustes › Códigos de paro, a manager's switch kept in act_targets
 * 'opt:reasoncodes', see setReasonCodes in store.ts) every stop takes ONE code of this list and only of it: no "Otra"
 * typed by hand; a detail is optional, except OTH-01, which needs one ("Use only when no standard code applies; explain
 * in notes"). Off (as it starts), the stops are as they always were: the room's three quick causes and "Otra".
 *
 * A coded stop is kept as its code and its Spanish label, "EQP-01 Falla mecánica": data in Spanish like every cause
 * (tr() shows the boss's English, en.ts), and the code is found back from the text (CODE_RE), so the report adds the
 * stops up code by code with no new column on the server. PLN-03 is the Set up: it is kept as 'Set up' as it always
 * was (SETUP in store.ts), so every rule of the set up (counted apart, amber, ended by the next code, the server's
 * trigger of 016_setup_trigger.sql that looks for reason = 'Set up') holds as it is; only the screens show it with
 * its code while the option is on.
 *
 * Each code: its label as it is kept (Spanish), its line of definition (Spanish, shown small under it), whether it is
 * a planned stop, its OEE family (Availability, Performance or Quality) and its category (the tiles of the stop box).
 * This file needs nothing of store.ts (store.ts reads it while it loads).
 */
export type OeeFamily = 'Availability' | 'Performance' | 'Quality'
export type ReasonCat = 'plan' | 'setup' | 'eqp' | 'mat' | 'lab' | 'sch' | 'qal' | 'per' | 'log' | 'ext' | 'oth'
export type ReasonCode = { code: string; label: string; def: string; planned: boolean; family: OeeFamily; cat: ReasonCat }
/** the reason of a set up, as it is kept (store.ts's SETUP: written here too, so this file needs nothing of store.ts) */
const SET_UP = 'Set up'
/** the code that is the set up */
export const SETUP_CODE = 'PLN-03'
/** the code that is only for what no other code says: it needs a detail */
export const OTHER_CODE = 'OTH-01'
const c = (code: string, label: string, def: string, cat: ReasonCat, family: OeeFamily = 'Availability'): ReasonCode => ({ code, label, def, planned: code.startsWith('PLN-'), family, cat })
export const REASON_CODES: ReasonCode[] = [
  c('PLN-01', 'Break / comida', 'Descanso o comida programada del turno', 'plan'),
  c('PLN-02', 'Mantenimiento planeado', 'Mantenimiento programado de antemano (preventivo)', 'plan'),
  c('PLN-03', 'Cambio de producto (Set up)', 'Cambio de un código a otro: preparar la línea para el siguiente producto', 'setup'),
  c('PLN-04', 'Limpieza / sanitación', 'Limpieza o sanitación programada de la línea', 'setup'),
  c('PLN-05', 'Junta / entrenamiento', 'Junta, plática de seguridad o entrenamiento programado', 'plan'),
  c('PLN-06', 'Sin producción programada', 'Línea disponible pero sin producción programada', 'plan'),
  c('EQP-01', 'Falla mecánica', 'Falla o atasco de una pieza mecánica', 'eqp'),
  c('EQP-02', 'Falla eléctrica', 'Falla de motor, sensor, cableado o tablero eléctrico', 'eqp'),
  c('EQP-03', 'Controles / software', 'Falla del PLC, la pantalla, la programación o el software', 'eqp'),
  c('EQP-04', 'Herramienta / molde', 'Herramienta, molde, cuchilla o pieza de cambio dañada o que falta', 'eqp'),
  c('EQP-05', 'Falla de servicios (aire, agua, gas, vapor, luz)', 'Se cortó o bajó el aire, el agua, el gas, el vapor o la luz', 'eqp'),
  c('EQP-06', 'Mantenimiento no planeado', 'Reparación o ajuste que no estaba programado', 'eqp'),
  c('MAT-01', 'Falta de material', 'No hay material, ingrediente o empaque para seguir', 'mat'),
  c('MAT-02', 'Material equivocado', 'Se surtió o llegó un material que no es el correcto', 'mat'),
  c('MAT-03', 'Material retenido por calidad', 'Material detenido por calidad: no se puede usar', 'mat'),
  c('MAT-04', 'Esperando que muevan / surtan material', 'Hay material, pero todavía no llega a la línea', 'mat'),
  c('LAB-01', 'Falta de personal', 'No hay suficientes personas para correr la línea', 'lab'),
  c('LAB-02', 'Operador no disponible', 'El operador asignado no está en la línea (otra tarea, ausente)', 'lab'),
  c('LAB-03', 'Falta de entrenamiento / certificación', 'Nadie presente está entrenado o certificado para la tarea', 'lab'),
  c('SCH-01', 'Sin orden de trabajo (WO)', 'No hay orden de producción o autorización', 'sch'),
  c('SCH-02', 'Cambio de programa', 'Se cambió el programa y la línea espera', 'sch'),
  c('SCH-03', 'Falta información (receta, especificación)', 'Falta la receta, la especificación o la instrucción para producir', 'sch'),
  c('SCH-04', 'Esperando aprobación / decisión', 'La línea espera que alguien apruebe o decida', 'sch'),
  c('QAL-01', 'Scrap (desperdicio)', 'Producto que se tira porque no cumple', 'qal', 'Quality'),
  c('QAL-02', 'Retrabajo / reparación', 'Se para para retrabajar o reparar producto', 'qal', 'Quality'),
  c('QAL-03', 'Esperando inspección / prueba', 'Esperando la inspección, la prueba o la liberación de calidad', 'qal', 'Quality'),
  c('QAL-04', 'Proceso fuera de control', 'Peso, temperatura u otro parámetro fuera de rango', 'qal', 'Quality'),
  c('PER-01', 'Velocidad reducida', 'La línea corre más lento de lo normal', 'per', 'Performance'),
  c('PER-02', 'Paros menores / micro-paros', 'Paros cortos y repetidos que se arreglan rápido', 'per', 'Performance'),
  c('PER-03', 'Arranque / calentamiento', 'Tiempo de arranque o calentamiento antes de la velocidad normal', 'per', 'Performance'),
  c('PER-04', 'Variación de ciclo', 'El tiempo de ciclo varía y no se sostiene el ritmo', 'per', 'Performance'),
  c('LOG-01', 'Montacargas / equipo de manejo no disponible', 'No hay montacargas, patín o equipo para mover', 'log'),
  c('LOG-02', 'Restricción de muelle / embarque', 'El muelle, el embarque o el espacio de salida está lleno o detenido', 'log'),
  c('EXT-01', 'Retraso del proveedor', 'El proveedor no entregó a tiempo', 'ext'),
  c('EXT-02', 'Cambio del cliente', 'El cliente cambió o canceló el pedido', 'ext'),
  c('EXT-03', 'Clima / emergencia', 'Clima, emergencia o evento de la planta fuera de nuestro control', 'ext'),
  c('OTH-01', 'Otro (explicar en el detalle)', 'Solo cuando ningún código aplica; explicar en el detalle', 'oth'),
]
/** the categories, in the order of the tiles, each with its Spanish name (data, shown with tr) and its colour */
export const REASON_CATS: { key: ReasonCat; label: string; tone: string }[] = [
  { key: 'plan', label: 'Paro planeado', tone: 'rc-plan' },
  { key: 'setup', label: 'Set up / cambio', tone: 'rc-setup' },
  { key: 'eqp', label: 'Equipo', tone: 'rc-eqp' },
  { key: 'mat', label: 'Material', tone: 'rc-mat' },
  { key: 'lab', label: 'Personal', tone: 'rc-lab' },
  { key: 'sch', label: 'Programa', tone: 'rc-sch' },
  { key: 'qal', label: 'Calidad', tone: 'rc-qal' },
  { key: 'per', label: 'Velocidad', tone: 'rc-per' },
  { key: 'log', label: 'Logística', tone: 'rc-log' },
  { key: 'ext', label: 'Externo', tone: 'rc-ext' },
  { key: 'oth', label: 'Otro', tone: 'rc-oth' },
]
export const catOf = (k: ReasonCat) => REASON_CATS.find((x) => x.key === k) ?? REASON_CATS[REASON_CATS.length - 1]
/** the OEE families as the screens say them (data in English, the boss's words; shown in the screen's language) */
export const FAMILY_SHOWN: Record<OeeFamily, () => string> = { Availability: () => tr('Disponibilidad'), Performance: () => tr('Rendimiento'), Quality: () => tr('Calidad') }
/** a code at the start of a stop's reason: "EQP-01 Falla mecánica" → EQP-01 */
export const CODE_RE = /^[A-Z]{3}-\d{2}\b/
/** the reason a stop is kept with when this code is chosen: "<CODE> <label>", and the Set up as it always was */
export const codeReason = (x: ReasonCode) => (x.code === SETUP_CODE ? SET_UP : x.code + ' ' + x.label)
const byCode = new Map(REASON_CODES.map((x) => [x.code, x]))
/** the code of a stop's reason (the Set up is PLN-03); undefined = a cause of before the codes, typed or of a room's list */
export const reasonCodeOf = (reason: string): ReasonCode | undefined => {
  if (reason === SET_UP) return byCode.get(SETUP_CODE)
  const m = CODE_RE.exec(reason)
  return m ? byCode.get(m[0]) : undefined
}
/** a code's label in the screen's language (the English is the boss's, in en.ts under the whole reason) */
export const codeLabel = (x: ReasonCode) => phrase(x.code + ' ' + x.label).slice(x.code.length + 1)
/** "EQP-01 · Falla mecánica" */
export const codeText = (x: ReasonCode) => x.code + ' · ' + codeLabel(x)
/** letters and digits only, without accents or capitals (as store.ts's plain) */
const plain = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
/**
 * A reason written by hand that is one of the codes: the code alone ("eqp-01", "EQP 01"), or the code with its label
 * in Spanish or in English ("EQP-01 Mechanical failure"), with or without accents, capitals or the dot: the code's own
 * reason. Anything else is not a code (undefined): a code followed by words of one's own is kept as typed.
 */
export function typedCode(text: string): ReasonCode | undefined {
  const k = plain(text)
  if (!k) return undefined
  return REASON_CODES.find((x) => { const p = plain(x.code); return k === p || k === plain(x.code + ' ' + x.label) || k === plain(phrase(x.code + ' ' + x.label, 'en')) })
}
