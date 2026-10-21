import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { apartLabel, apartWord, binWord, cameFrom, carriedOver, casesText, CFG, cfgFor, cfgOf, csvCell, DEPTS, fmtDur, roomKnown, fmtN, fmtTime, inCases, kindClass, lineLabel, lineNameOf, looksLikeTwoLots, madeText, measureName, measureUnit, normCode, noteLabel, noteOf, orderLabel, orderOfId, plainDay, plainText, productOf, purgesOf, reasonText, restorePurged, runStats, SETUP, shiftAt, shiftHours, shiftSpan, shiftsOf, stopTime, unitQty, user, whoText, workDay, type Dept, type State } from './store'
import { avanceRows, mfoText, mfoWord, pending } from './avance'
import { codeLabel, FAMILY_SHOWN, reasonCodeOf } from './reasons'
import { cellText, loadZip, xDur, xPct, xTime, xlsxNow, XLSX_TYPE, type Cell, type Sheet } from './xlsx'
import { attendanceOf, attOf, attShifts } from './store'
import { pctText } from './Attendance'
import { buildPdf, loadPdf, type Part } from './pdf'
import { homeScreenApple, type Kind } from './send'
import { CODE_HEADS, codeCells, hasCodedStops, paretoOf, filterFile, filterTitle, hitKey, palletsSheet, reportOf, runLots, runsSheet, searchReport, spanShifts, unitParts, unitsSheet, type Hit, type HitKind, type Report as ReportData, type ReportFilter, type Scope as SearchScope } from './report'
import { canShift, writesIn } from './powers'
import { AddRunDialog, AddUnitDialog, RunEditor, StopEditor } from './editors'
import { supabase } from './supabase'
import { fetchPurged } from './sync'
import { addDays, DayNote, download, howMany, libraries, longDate, MISSING, NoticeDialog, SendDialog, shortDay, ShiftsDialog, useCan, useDay, useWho, WipeDayDialog } from './App'
import { DEPT_LOOK, deptVars } from './look'
import { tr } from './i18n'
import { trx } from './trx'

/*
 * The day's report, redesigned (Jose, 2026-10-17: "es muy larga y no sé lo que estoy viendo"). One header, one card of
 * filters with the search on top, and the report in six parts (tabs named after the office's Excel sheets), one at a
 * time; a line that always says in words what is in view; each room with its emoji and its colour; every summary
 * number a link to the records behind it; every record a tap away from being seen, corrected, or added when missing.
 * The numbers and the files are the same as before: reportOf() decides what is in them, and the files follow the
 * filters, never the search.
 *
 * App imports this file and this file imports App (as editors.tsx and Settings.tsx do): nothing from App is used at
 * the top level of this file, only inside functions, so the order the two load in never matters.
 */

/** the parts of the report, one tab each */
type View = 'gen' | 'code' | 'shift' | 'pal' | 'rec' | 'chg'
/** the three lists of Registros, and the two of Pallets */
type RecSub = 'runs' | 'units' | 'stops'
type PalSub = 'pallets' | 'bins'
/** the pallets of the report, by their state */
type PalletFilter = '' | 'notag' | 'nopo' | 'po' | 'full' | 'short' | 'open'
/** where a drill came from: "‹ Volver" puts all of it back (the shift as it was chosen: null = the report decides) */
type Snap = { view: View; rec: RecSub; pal: PalSub; dept: Dept | ''; shift: 0 | 1 | 2 | null; line: string; code: string; lot: string; cause: string; runChip: '' | 'live' | 'waste'; palF: PalletFilter }
type ReportProps = { s: State; now: number; only?: Dept; mgr: boolean; admin: boolean; wholeDay: boolean }

/** the shift somebody chose to look at in the report, kept while the app stays open (null = none chosen: the report decides) */
let shiftChosen: 0 | 1 | 2 | null = null
/** the room a manager chose to look at in the report, kept the same way ('' = all of them) */
let deptChosen: Dept | '' = ''
/** the part of the report, the list of Registros and of Pallets, and the search: kept the same way, so going to the floor and back finds them as they were */
let viewChosen: View = 'gen', recChosen: RecSub = 'runs', palChosen: PalSub = 'pallets', searchKept = ''
/**
 * Where another tab sends the report (the Programa del día, the floor's numbers: Jose, 2026-10-20 "que tengan link
 * todo"): the day, room, shift, line, code, lot, part and list to open on. Read once when the report opens.
 */
export type ReportAt = { date?: string; dept?: Dept; shift?: 0 | 1 | 2; line?: string; code?: string; lot?: string; view?: View; rec?: RecSub; cause?: string }
let openAt: ReportAt | null = null
export function reportOpenAt(x: ReportAt) {
  openAt = x
  if (x.dept !== undefined) deptChosen = x.dept
  if (x.shift !== undefined) shiftChosen = x.shift
  if (x.view) viewChosen = x.view
  if (x.rec) recChosen = x.rec
  searchKept = ''
}
/** a long list shows this many rows a page: the report redraws every second for its live clocks, and 50 rows a second is light on a phone (the files always carry everything) */
const PAGE = 50

/** a room as it is shown everywhere in the report: its emoji and its name on its own tint (files keep the plain name) */
export function DeptBadge({ d }: { d: Dept }) {
  // a room this version does not know (a history line of one a newer version added, such as QC): its name alone, plain
  if (!roomKnown(d)) return <span className="rp-badge">{String(d)}</span>
  return <span className="rp-badge" style={deptVars(d)}><i aria-hidden="true">{DEPT_LOOK[d].emoji}</i>{d}</span>
}

/** the words searched, marked where they are in a text (found on its copy without accents; a text whose copy is not as long is left unmarked) */
function hl(text: string | number | null | undefined, toks: string[]): ReactNode {
  const t = text == null ? '' : String(text)
  if (!toks.length || !t) return t
  const low = plainText(t)
  if (low.length !== t.length) return t
  const on = new Array<boolean>(t.length).fill(false)
  const inWord = (c: string | undefined) => !!c && /[a-z0-9]/.test(c)
  for (const tok of toks) {
    // a number of one or two digits is found as a whole word, as the search finds it
    const whole = /^\d{1,2}$/.test(tok)
    for (let i = low.indexOf(tok); i >= 0; i = low.indexOf(tok, i + 1)) {
      if (whole && (inWord(low[i - 1]) || inWord(low[i + tok.length]))) continue
      for (let j = i; j < i + tok.length; j++) on[j] = true
    }
  }
  if (!on.includes(true)) return t
  const out: ReactNode[] = []
  for (let i = 0; i < t.length;) {
    let j = i
    while (j < t.length && on[j] === on[i]) j++
    out.push(on[i] ? <mark key={i}>{t.slice(i, j)}</mark> : <Fragment key={i}>{t.slice(i, j)}</Fragment>)
    i = j
  }
  return out
}
/** pieces of a line one after the other, with a separator between them (the empty ones left out) */
const joined = (parts: ReactNode[], sep = ' · ') => parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '').map((p, i) => <Fragment key={i}>{i > 0 && sep}{p}</Fragment>)
/**
 * What the search found as the screen shows it, each record once: a unit of Packing is one of its pallets or bins,
 * found on their own (their fields hold the unit's), so its unit is not counted again in "N resultados".
 */
const onScreen = (hits: Hit[]) => hits.filter((h) => !(h.kind === 'unit' && h.dept === 'Packing'))
/** a cell that holds nothing ("—") is left out of a record's card on a phone */
const none = (v: unknown) => (v === '—' ? 'c-none' : undefined)

/** what each part of the report is called, and what it holds (said under the tabs and in the help) */
const viewLabel = (v: View) => (v === 'gen' ? tr('General') : v === 'code' ? tr('Por código') : v === 'shift' ? tr('Por turno') : v === 'pal' ? '📦 ' + tr('Pallets') : v === 'rec' ? tr('Registros') : tr('Cambios'))
const viewSub = (v: View) => (v === 'gen' ? tr('Lo hecho por cada departamento, cada turno y por qué se paró.')
  : v === 'code' ? tr('Cada código con sus lotes, como en el Excel. Toca un código o un lote para ver solo eso; toca lo hecho para ver cada unidad.')
    : v === 'shift' ? tr('Cada departamento con el día completo y cada turno: lo hecho, el reloj y la suma de sus líneas.')
      : v === 'pal' ? tr('Los pallets de Packing uno por uno, con sus lotes, tags y PO, y sus bins aparte.')
        : v === 'rec' ? tr('Cada corrida, cada unidad y cada paro: para buscar, ver, corregir o agregar.')
          : tr('Quién corrigió o cambió qué, y a qué hora.'))
const STOPS_NOTE = () => tr('El Parado de las tarjetas cuenta solo el tiempo parado mientras la línea tenía un código; en Registros › Paros sale cada paro completo.')

/**
 * Everything the report holds and can do: the day and its filters, the report itself and its files (made exactly as
 * before), the search, the part in view, and the boxes it opens. The parts below read it; the files never follow the
 * search, only the filters.
 */
/**
 * who may see and correct a record, and the two buttons ("Ver", "✎ Corregir" or the other shift's lock): the report's
 * own rule, shared with the Flujo tab's detail window since 2026-10-19 (Jose: "si le damos click a algo podamos ver más
 * detalles"), so a run is corrected from there exactly as from the report. Only in a room the server lets this person
 * write: an operator who may look at every room corrects and adds only in their own (the rest was refused, and waited
 * on the tablet for ever; review of 2026-10-18)
 */
export function useFixers() {
  const can = useCan(), who = useWho()
  const fixable = (room: string) => can('fix') && writesIn(who, room)
  const fix = (shifts: string, room: string) => fixable(room) && canShift(who, shifts)
  const seeBtn = (onSee: () => void) => <button type="button" className="btn xs" onClick={onSee}>{tr('Ver')}</button>
  const fixBtn = (shifts: string, room: string, onFix: () => void) => (fix(shifts, room)
    ? <button type="button" className="btn xs soft" aria-label={tr('Corregir')} onClick={onFix}>✎<span className="opt"> {tr('Corregir')}</span></button>
    : fixable(room) ? <small className="rp-lock" title={tr('Lo corrige el turno {0} o quien tenga el permiso "Corregir lo del otro turno".', shifts)}>🔒 {tr('Otro turno')}</small> : null)
  return { fixable, fix, seeBtn, fixBtn }
}

function useReport({ s, now, only, mgr, admin, wholeDay }: ReportProps) {
  const can = useCan(), who = useWho(), viewOnly = who.role === 'viewer'
  // (what another tab asked for, taken once: see reportOpenAt)
  const [at] = useState(() => { const x = openAt; openAt = null; return x })
  const [date, setDate] = useState(() => at?.date ?? workDay(s).date)
  const [wiping, setWiping] = useState(false)
  // a run opened to correct it, at the unit the person came from (a pallet, a cart); and a stop
  const [editRun, setEditRun] = useState<{ id: string; at?: number } | null>(null)
  const [editStop, setEditStop] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ title: string; text?: string } | null>(null)
  const [sending, setSending] = useState<Record<Kind, File> | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [fCode, setFCode] = useState(at?.code ?? '')
  const [fLine, setFLine] = useState(at?.line ?? '') // one line of the day alone (its id)
  const [fLot, setFLot] = useState(at?.lot ?? '')
  // the room a manager looks at (the people of one room see only theirs)
  const [fDept, setDeptPick] = useState<Dept | ''>(only ? '' : deptChosen)
  // a code that ran and nobody recorded, put on its line after the fact: only the room tapped comes preset, nothing is guessed
  const [addFor, setAddFor] = useState<{ dept?: Dept } | null>(null)
  const setFDept = (d: Dept | '') => { deptChosen = d; setDeptPick(d) }
  // The people of a shift open the report on their own shift: the one saved for them, or else the one in course on the
  // day in course. The other shift
  // and the whole day are one choice away, and what they choose stays while the app is open. The office and the owner
  // open it on the whole day, and so does anybody looking at another date.
  const [shiftPick, setShiftPick] = useState<0 | 1 | 2 | null>(shiftChosen)
  const ownShift: 0 | 1 | 2 = who.shift ? who.shift : !wholeDay && date === workDay(s, now).date ? shiftAt(shiftsOf(s, date), now) : 0
  const fShift = shiftPick ?? ownShift
  const setFShift = (k: 0 | 1 | 2) => { shiftChosen = k; setShiftPick(k) }
  const [shiftsOpen, setShiftsOpen] = useState(false)
  // Records of this day that somebody took away ("eran pruebas"). The server never erases: they are there, marked, and
  // come back whole with one tap.
  const purges = supabase ? purgesOf(s, date) : []
  const [recovering, setRecovering] = useState(false)
  const recover = async (id: string) => {
    setRecovering(true)
    try {
      const held = await fetchPurged(date)
      const r = held && restorePurged(id, held)
      setNotice(r
        ? { title: tr('Registros recuperados'), text: tr('Volvieron {0}. Lo que seguía corriendo cuando se quitaron quedó terminado a esa hora: nada se registró en ello después. Revisa el reporte.', howMany(r.runs, r.stops)) }
        : { title: tr('No se pudo recuperar ahora'), text: tr('Hace falta señal para traerlos del servidor. Inténtalo otra vez cuando arriba diga "Sincronizado".') })
    } finally { setRecovering(false) }
  }
  /** "12 corridas · 5 paros", as the history wrote it, in the words of the screen */
  const tookText = (t: string) => { const m = /^(\d+) corridas? · (\d+) paros?$/.exec(t); return m ? howMany(Number(m[1]), Number(m[2])) : t }
  // the part of the report in view, the list of Registros and of Pallets, and the search (kept like the shift and the room)
  const [view, setViewPick] = useState<View>(viewChosen)
  const setView = (v: View) => { viewChosen = v; setViewPick(v) }
  const [recSub, setRecPick] = useState<RecSub>(recChosen)
  const setRecSub = (x: RecSub) => { recChosen = x; setRecPick(x) }
  const [palSub, setPalPick] = useState<PalSub>(palChosen)
  const setPalSub = (x: PalSub) => { palChosen = x; setPalPick(x) }
  const [q, setQPick] = useState(searchKept)
  const setQ = (t: string) => { searchKept = t; setQPick(t) }
  // What the report is searched with: the words in the box, a moment behind while they are typed, so a big day's
  // search never holds the typing up (the box itself always shows what is typed).
  const qs = useDeferredValue(q)
  // the quick chips of Registros: a cause of stop (or every stop but Set up: '!setup'), and the runs still going or with waste
  const [cause, setCause] = useState(at?.cause ?? '')
  const [runChip, setRunChip] = useState<'' | 'live' | 'waste'>('')
  const [palF, setPalF] = useState<PalletFilter>('') // the pallets by their state: without a tag, without or with a PO, full, short, being built
  const [back, setBack] = useState<Snap | null>(null)
  const [shows, setShows] = useState(0) // how many drills and tabs tapped so far: each one brings what it opened into view (below)
  const [page, setPage] = useState<Record<string, number>>({})
  const [detail, setDetail] = useState<{ runId: string; at?: number } | null>(null)
  // "¿Qué incluir?" open for a file (Jose, 2026-10-21): the Excel, the PDF, or what is sent
  const [picking, setPicking] = useState<'xlsx' | 'pdf' | 'send' | null>(null)
  // the sheet of one stop (Jose, 2026-10-20: "para ellos es importante investigar sobre los paros"): its id
  const [stopSheet, setStopSheet] = useState<string | null>(null)
  const [help, setHelp] = useState(false)
  const scopeRef = useRef<HTMLDivElement>(null) // the "Viendo" line, just above the part in view
  const day = useDay(date)
  const runToEdit = editRun ? s.runs.find((r) => r.id === editRun.id) : undefined
  const stopToEdit = editStop ? s.stops.find((x) => x.id === editStop) : undefined
  // what makes the PDF and the Excel comes down when the report opens, so the tap that asks for a file finds it ready
  useEffect(() => { void libraries().catch(() => undefined) }, [])
  /** no button of the report fails without a word: what went wrong, and what to do */
  const failed = (what: string, e?: unknown) => { console.warn('actividad report', what, e); setNotice({ title: tr('No se pudo {0}', what), text: MISSING }) }
  /** opens the PDF in a new tab (to look at, share or print); where a tab cannot show it, it downloads */
  const pdf = async (parts?: Set<Part>) => {
    try {
      const name = fileName + '.pdf'
      let doc = buildPdf(s, date, now, user.get(), filter, parts)
      if (!doc) { await loadPdf(); doc = buildPdf(s, date, now, user.get(), filter, parts); if (!doc) throw new Error('pdf'); doc.save(name); return }
      if (homeScreenApple(navigator as Parameters<typeof homeScreenApple>[0])) { doc.save(name); return }
      const win = window.open(doc.output('bloburl'), '_blank')
      if (!win) doc.save(name)
    } catch (e) { failed(tr('abrir el PDF'), e) }
  }
  // what the report holds, with the filter by code, by lot and by shift when one is chosen (the same for the screen and every file)
  const dept: Dept | undefined = only ?? (fDept || undefined)
  const filter: ReportFilter = { only: dept, code: fCode, lot: fLot, shift: fShift, line: fLine }
  const rep = reportOf(s, date, now, filter)
  const { runs, stops, rows, unitRows, working, down, byCode, setup } = rep
  const withOrders = unitRows.some((x) => x.order) // a column says the order of each pallet when any has one
  const unitsText = (dept: Dept, n: number) => n + ' ' + (n === 1 ? CFG[dept].unit : CFG[dept].plural).toLowerCase()
  /** "1 bin", "3 bins" */
  const binsN = (n: number) => (n === 1 ? tr('1 bin') : tr('{0} bins', n))
  /** a pallet's place among its order's pallets: "2/12" (or "2" when the order does not say how many cases it is) */
  const ofText = (of: [number, number | null]) => (of[1] ? of[0] + '/' + of[1] : String(of[0]))
  const palletIs = (p: (typeof rep.pallets)[number], f: PalletFilter) => (f === '' ? true : f === 'notag' ? p.parts.some((x) => !x.tag) : f === 'nopo' ? !p.order : f === 'po' ? !!p.order : f === 'open' ? p.open : p.r.perUnit != null && !p.open && (f === 'full' ? p.total >= p.r.perUnit : p.total < p.r.perUnit))
  /** the words of a line of "por código": a code filled in bins speaks of bins */
  const cw = (c: { dept: Dept; bin: string }) => cfgFor(c.dept, c.bin)
  const reasonsText = (x: (typeof rows)[number]) => Object.entries(x.st.reasons).map(([k, v]) => tr(k) + ' ' + fmtDur(v)).join(', ')
  const lineName = (x: { lineId: string | null; dept: Dept }) => (x.lineId === null ? tr('Todo {0}', x.dept) : lineLabel(s.lines.find((l) => l.id === x.lineId)?.name ?? s.runs.find((r) => r.lineId === x.lineId)?.line ?? tr('línea')))
  // there is something to put in a file: a code, a stop, or somebody written in the attendance (a day of only that)
  const any = rows.length > 0 || rep.stops.length > 0 || ((s.attView.on || admin) && (s.attendance ?? []).some((x) => !x.deleted && x.date === date && (!dept || x.dept === dept)))
  const lineChosen = rep.line ? rep.lineChoices.find((l) => l.id === rep.line)?.name ?? '' : ''
  const fileName = 'actividad-' + (dept ? dept.toLowerCase() + '-' : '') + date + filterFile(rep.code, rep.lot, rep.shift, lineChosen)
  // the history of that day (corrections, products, program, lines): the manager's and the office's
  const changes = mgr && !rep.filtered ? s.changes.filter((c) => !c.deleted && plainDay(s, c.at) === date && (!dept || c.dept === dept)).sort((a, b) => a.at - b.at) : []
  /** the report's three files, made at once; null while what makes them has not come down yet */
  const filesNow = (parts?: Set<Part>): Record<Kind, File> | null => {
    const doc = buildPdf(s, date, now, user.get(), filter, parts), bytes = xlsxNow(sheets(parts))
    if (!doc || !bytes) return null
    return { pdf: new File([doc.output('blob')], fileName + '.pdf', { type: 'application/pdf' }), xlsx: new File([bytes], fileName + '.xlsx', { type: XLSX_TYPE }), csv: new File([csvText()], fileName + '.csv', { type: 'text/csv' }) }
  }
  /**
   * "Enviar reporte" makes the files and opens a box with what this device can do with them (share them, download
   * them, open a mail). The sharing itself is a button of that box: a browser only opens its share sheet for a tap,
   * and by then the files are ready. Nothing here happens without the person seeing it.
   */
  const send = async (parts?: Set<Part>) => {
    try {
      let files = filesNow(parts)
      if (!files) { setPreparing(true); try { await libraries() } finally { setPreparing(false) } files = filesNow(parts) }
      if (!files) throw new Error('files')
      setSending(files)
    } catch (e) { failed(tr('preparar el reporte'), e) }
  }
  /** the day's tables, typed (numbers, times, spans) so Excel can sort and add them; the CSV takes the same as text */
  // the shifts of the day, side by side: both, or the only one that worked
  const shiftCols = ([1, 2] as const).filter((k) => !rep.plan.only || rep.plan.only === k)
  const blocks = () => {
    const T = (ms: number) => xTime(ms, fmtTime(ms)), D = (ms: number) => xDur(ms, fmtDur(ms))
    // the runs, one per line, with their comments: made in report.ts (runsSheet), where the checks read them too
    const resumen = runsSheet(s, rep)
    const boxes = (c: (typeof byCode)[number]) => (!c.bin && CFG[c.dept].qtyUnit === 'pouches' ? inCases(s, c.code, c.qty) : null)
    const porCodigo: Cell[][] = [[tr('Departamento'), tr('Código'), tr('Unidad'), tr('Hechas'), tr('Cantidad'), tr('Unidad de cantidad'), tr('Waste (lb)'), tr('Líneas'), tr('Cajas completas'), tr('Pouches sueltos'), ...(rep.shift ? [] : shiftCols.map((k) => tr('Turno {0}', k)))],
      ...byCode.map((c): Cell[] => [c.dept, c.code, cw(c).unit, c.units, CFG[c.dept].qty !== 'none' ? c.qty : '', CFG[c.dept].qty !== 'none' ? cw(c).qtyUnit : '', c.waste || '', c.lines.join(', '), boxes(c)?.cases ?? '', boxes(c)?.loose ?? '', ...(c.byShift ? shiftCols.map((k) => (c.byShift as [number, number])[k - 1]) : [])])]
    const porLote: Cell[][] = [[tr('Departamento'), tr('Código'), tr('Lote'), tr('Unidad'), tr('Hechas'), tr('Cantidad'), tr('Unidad de cantidad'), ...(rep.shift ? [] : shiftCols.map((k) => tr('Turno {0}', k)))],
      ...byCode.flatMap((c) => c.lots.map((l): Cell[] => [c.dept, c.code, l.lot, cw(c).unit, l.units, CFG[c.dept].qty !== 'none' ? l.qty : '', CFG[c.dept].qty !== 'none' ? cw(c).qtyUnit : '', ...(l.byShift ? shiftCols.map((k) => (l.byShift as [number, number])[k - 1]) : [])]))]
    // the units and the pallets, each with its comment last: made in report.ts, where the checks read them too
    const unidades = unitsSheet(s, rep)
    // (each stop's Reason Code, planned or not, its OEE family and its category last, 2026-10-20: the columns the office
    // already reads keep their places; a stop of before the codes says "Sin código". The Set up is PLN-03). Only when the
    // Reporte shows its Pareto too (the codes on, or coded stops in view): with the codes off the sheet is as it always
    // was, with no code the floor never chose (review, 2026-10-20)
    const coded = s.reasonCodes.on || hasCodedStops(rep)
    const paros: Cell[][] = [[tr('Departamento'), tr('Línea'), tr('Razón'), tr('Detalle'), tr('Inicio'), tr('Fin'), tr('Duración'), tr('Registró'), tr('Turno'), ...(coded ? CODE_HEADS() : [])],
      ...stops.map((x): Cell[] => [x.dept, lineName(x), tr(x.reason), noteLabel(x.note), T(x.startedAt), x.endedAt ? T(x.endedAt) : tr('en curso'), D(x.ms), x.by, spanShifts(rep.plan, x.startedAt, x.endedAt ?? now), ...(coded ? codeCells(x.reason) : [])])]
    // the whole day first and each shift under it (not when the report is of one shift only); what a room filled in bins
    // goes under it, word by word: its bins and what they hold
    const binRows = (d: (typeof rep.byShift)[number]) => [...new Set(d.day.bins.map((y) => y.word))].flatMap((w) => [d.day, ...shiftCols.map((k) => (k === 1 ? d.first : d.second))].map((x): Cell[] => { const y = x.bins.find((z) => z.word === w); return [d.dept, x.shift ? tr('Turno {0}', x.shift) : tr('Total del día'), '', '', '', '', '', '', '', y?.units ?? 0, cfgFor(d.dept, w).unit, y?.qty ?? 0, apartWord(d.dept, w), '', '', '', ''] }))
    const porTurno: Cell[][] = [[tr('Departamento'), tr('Turno'), tr('Horario'), tr('Empezó'), tr('Terminó'), tr('Duración'), tr('Líneas'), tr('Códigos'), tr('Corridas'), tr('Hechas'), tr('Unidad'), tr('Cantidad'), tr('Unidad de cantidad'), tr('Waste (lb)'), tr('Tiempo trabajando'), tr('Tiempo parado'), 'Set up'],
      ...rep.byShift.flatMap((d) => [...[d.day, ...shiftCols.map((k) => (k === 1 ? d.first : d.second))].map((x): Cell[] => [d.dept, x.shift ? tr('Turno {0}', x.shift) : tr('Total del día'), x.shift ? shiftHours(rep.plan, x.shift) : '', x.from ? T(x.from) : '', !x.to ? '' : x.open ? tr('en curso') : T(x.to), x.span ? D(x.span) : '', x.lines, x.distinct, x.codes, x.units, CFG[d.dept].unit, CFG[d.dept].qty !== 'none' ? x.qty : '', CFG[d.dept].qty !== 'none' ? CFG[d.dept].qtyUnit : '', x.waste || '', D(x.working), D(x.down), x.setup ? D(x.setup) : '']), ...binRows(d)])]
    const cambios: Cell[][] = [[tr('Hora'), tr('Quién'), tr('Departamento'), tr('Qué'), tr('Antes'), tr('Después')], ...changes.map((c): Cell[] => [T(c.at), c.by, c.dept ?? '', c.what, c.before, c.after])]
    const av = mgr && !dept && !rep.filtered ? avanceRows(s, date) : []
    const carry = av.length ? carriedOver(s, date).filter((x) => x.next <= today) : [], came = av.length ? cameFrom(s, date) : []
    // (a row of the program with a lot names it beside its room: a code may have a row per lot, 2026-10-20)
    const carryWho = (x: { dept: Dept; lot: string }) => (x.lot ? x.dept + ' · ' + tr('lote {0}', x.lot) : x.dept)
    const carryText = (code: string) => [...carry.filter((x) => normCode(x.code) === normCode(code)).map((x) => x.done ? tr('{0}: ✓ completado el {1}', carryWho(x), shortDay(x.next)) : x.made > 0 ? tr('{0}: pendiente {1} {2} · siguió el {3}', carryWho(x), fmtN(x.pending - x.made), x.unit, shortDay(x.next)) : tr('{0}: pendiente {1} {2} al día siguiente', carryWho(x), fmtN(x.pending), x.unit)), ...came.filter((x) => normCode(x.code) === normCode(code)).map((x) => tr('↪ {0}: {1} {2} del lote del {3}', x.dept, fmtN(x.made), x.unit, shortDay(x.from)))].join(' · ')
    const avance: Cell[][] = [[tr('Código'), tr('Producto'), tr('Al día siguiente'), tr('Lo empaca'), tr('Mezclas progr.'), tr('Mezclas hechas'), tr('Mezclas pend.'), 'Spiral', tr('Pouches progr.'), tr('Pouches esper.'), tr('Pouches hechos'), tr('Pouches pend.'), tr('Pouches faltan'), tr('Cajas progr.'), tr('Cajas esper.'), tr('Cajas hechas'), tr('Cajas pend.'), tr('Cajas faltan'), tr('MFO progr.'), tr('MFO esper.'), tr('MFO hecho'), tr('MFO en'), tr('MFO además'), tr('MFO pend.'), tr('Pallets progr.'), tr('Pallets esper.'), tr('Pallets hechos'), tr('Waste lb')],
      ...av.map((r): Cell[] => [r.code, r.product?.name ?? '', carryText(r.code), r.packRoom, r.scheduled, r.mixesDone, r.mixesPending, r.spiralDone, r.pouchesPlan, r.pouchesExp, r.pouchesDone, pending(r.pouchesExp, r.pouchesDone), pending(r.pouchesPlan, r.pouchesDone), r.casesPlan, r.casesExp, r.casesDone, pending(r.casesExp, r.casesDone), pending(r.casesPlan, r.casesDone), r.mfoPlan, r.mfoExp, r.mfo[0]?.qty ?? 0, r.mfo[0] ? mfoWord(r.mfo[0].word) : '', mfoText(r.mfo.slice(1)), pending(r.mfoExp, r.mfo[0]?.qty ?? 0), r.palletsPlan, r.palletsExp, r.palletsDone, r.wasteLb])]
    const pallets = palletsSheet(s, rep)
    const bins: Cell[][] = [[tr('Bin'), tr('Línea'), tr('Código'), tr('Lote'), tr('Cantidad'), tr('Unidad de cantidad'), tr('N° de bin'), tr('Hora'), tr('Turno'), tr('Registró')],
      ...rep.bins.map((b): Cell[] => [b.n, lineNameOf(s, b.r.lineId, b.r.line), b.r.code, b.lot, b.qty ?? '', binWord(b.word), b.ref, T(b.at), b.shift, b.by])]
    return { resumen, porTurno, porCodigo, porLote, pallets, bins, unidades, paros, cambios, avance }
  }
  /**
   * Asistencia (Santiago, 2026-10-20), as his own sheet: each room's people expected, those who came, the % missing and
   * the total, with Excel's own bar chart of the % under it; then every person written, with who wrote them and when,
   * and who left, why and when. The room in view, or every room; the shift in view, or the day's shifts added up
   */
  const attSheets = (): Sheet[] => {
    const rooms = dept ? [dept] : only ? [only] : DEPTS, a = attendanceOf(s, date, rep.shift, rooms)
    const rows: Cell[][] = [[tr('Cuarto'), tr('Esperados'), tr('Vinieron'), tr('% Falta'), tr('Faltan')], ...a.rows.map((r): Cell[] => [r.dept, r.expected, r.actual, xPct(r.pct), r.miss]), [tr('TOTAL'), a.total.expected, a.total.actual, xPct(a.total.pct), a.total.miss]]
    const people = (rep.shift ? [rep.shift] : attShifts(s, date)).flatMap((k) => rooms.flatMap((d) => attOf(s, date, d, k)))
    const T = (ms: number) => xTime(ms, fmtTime(ms))
    const names: Cell[][] = [[tr('Fecha'), tr('Turno'), tr('Cuarto'), tr('Persona'), tr('Anotó'), tr('Hora'), tr('Estado'), tr('Pasó a'), tr('Hora de salida'), tr('Viene de')],
      ...people.map((x): Cell[] => [date, x.shift, x.dept, x.name, x.by, T(x.at), !x.gone ? tr('trabajando') : x.gone.why === 'casa' ? tr('se fue a su casa') : tr('pasó a otro cuarto'), x.gone?.to ?? '', x.gone ? T(x.gone.at) : '', x.from])]
    return [{ name: tr('Asistencia'), rows, chart: { title: tr('% de faltas por cuarto'), series: tr('% Falta'), cat: 0, val: 3, from: 2, to: 1 + a.rows.length, at: a.rows.length + 4, pct: true } }, ...(people.length ? [{ name: tr('Asistencia · personas'), rows: names }] : [])]
  }
  /** the Excel file's sheets: one per table (Cambios and Avance only for the manager and the office) */
  const sheets = (parts?: Set<Part>): Sheet[] => {
    const b = blocks()
    // (the parts chosen in "¿Qué incluir?", 2026-10-21: each sheet goes with its part; none chosen = all of them)
    const part: Record<string, Part> = { [tr('Resumen')]: 'resumen', [tr('Por turno')]: 'resumen', [tr('Por código')]: 'codigo', [tr('Por lote')]: 'codigo', [tr('Pallets')]: 'pallets', [tr('Bins')]: 'bins', [tr('Unidades')]: 'unidades', [tr('Paros')]: 'paros', [tr('Cambios')]: 'cambios', [tr('Avance')]: 'avance', [tr('Asistencia')]: 'asistencia', [tr('Asistencia · personas')]: 'asistencia' }
    const all: Sheet[] = [{ name: tr('Resumen'), rows: b.resumen }, ...attSheets(), ...(b.porTurno.length > 1 ? [{ name: tr('Por turno'), rows: b.porTurno }] : []), { name: tr('Por código'), rows: b.porCodigo }, { name: tr('Por lote'), rows: b.porLote }, ...(b.pallets.length > 1 ? [{ name: tr('Pallets'), rows: b.pallets }] : []), ...(b.bins.length > 1 ? [{ name: tr('Bins'), rows: b.bins }] : []), { name: tr('Unidades'), rows: b.unidades }, { name: tr('Paros'), rows: b.paros }, ...(mgr ? [{ name: tr('Cambios'), rows: b.cambios }] : []), ...(b.avance.length > 1 ? [{ name: tr('Avance'), rows: b.avance }] : [])]
    return parts ? all.filter((x) => parts.has(part[x.name] ?? 'resumen')) : all
  }

  const excel = async (parts?: Set<Part>) => {
    try {
      const bytes = xlsxNow(sheets(parts)) ?? (await loadZip(), xlsxNow(sheets(parts)))
      if (!bytes) throw new Error('xlsx')
      download(new File([bytes], fileName + '.xlsx', { type: XLSX_TYPE }))
    } catch (e) { failed(tr('hacer el Excel'), e) }
  }
  const csv = () => download(new File([csvText()], fileName + '.csv', { type: 'text/csv;charset=utf-8' }))
  const csvText = () => {
    // (a text Excel would take for a formula is guarded, see csvCell; a time keeps its text, a number stays a number)
    const q = (c: Cell) => csvCell(c != null && typeof c === 'object' ? cellText(c) : c)
    const b = blocks()
    const tag = (title: string, t: Cell[][]) => t.map((r, i): Cell[] => (i === 0 ? ['', title, ...r] : ['', '', ...r]))
    const all: Cell[][] = [...b.resumen, ...(b.porTurno.length > 1 ? [[], ...tag(tr('POR TURNO'), b.porTurno)] : []), [], ...tag(tr('POR CÓDIGO'), b.porCodigo), [], ...tag(tr('POR LOTE'), b.porLote), ...(b.pallets.length > 1 ? [[], ...tag('PALLETS', b.pallets)] : []), [], ...tag('UNIDADES', b.unidades), [], ...tag(tr('PAROS'), b.paros), ...(mgr ? [[], ...tag('CAMBIOS', b.cambios)] : []), ...(b.avance.length > 1 ? [[], ...tag('AVANCE', b.avance)] : [])]
    return '\ufeff' + all.map((r) => r.map(q).join(',')).join('\r\n')
  }
  // ---- what the screen needs besides the report itself ----
  const today = workDay(s, now).date
  // what is chosen, said in words (the filters add up: any of them with any other)
  const active = [!only && dept ? dept : '', rep.shift ? tr('Turno {0}', rep.shift) + (shiftPick === null ? ' ' + (who.shift ? tr('(tu turno)') : tr('(en curso)')) : '') : '', lineChosen, rep.code ? tr('Código {0}', rep.code) : '', rep.lot ? tr('Lote {0}', rep.lot) : ''].filter(Boolean)
  const clear = () => { setFCode(''); setFLot(''); setFShift(0); setFDept(''); setFLine('') }
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
  /** a shift's hours in two pieces that never break inside: "6:00 AM" and "a 3:00 PM" */
  const hrs = (k: 1 | 2) => { if (rep.plan.only) return <span>{tr('todo el día')}</span>; const [from, to] = shiftSpan(rep.plan, k); return <><span>{from}</span> <span>{tr('a {0}', to)}</span></> }
  const dash = (v: number) => (v ? fmtN(v) : '—')
  /** what a time that adds up the lines is the sum of: "suma de 3 líneas" */
  const linesText = (n: number) => (n === 1 ? tr('una línea') : tr('suma de {0} líneas', n))
  // ---- the search: what the report in view holds that answers it (the files never follow it) ----
  const toks = plainText(qs).split(/\s+/).filter(Boolean), searching = toks.length > 0
  // Searched again only when what it looks in changes: the day, the filters, the records, the words. The report redraws
  // every second for its live clocks; the search follows the clock once a minute (a stop still going, a time "en curso").
  const minute = Math.floor(now / 60_000)
  const found = useMemo(() => searchReport(s, rep, qs, changes, now), [s, date, dept, fCode, fLot, fShift, fLine, qs, mgr, minute]) // eslint-disable-line react-hooks/exhaustive-deps
  const keys = found.keys
  // what the search found, each record once as the screen shows it: a unit of Packing is its pallet or its bin, which
  // are found on their own (the Registros tab still counts it: Unidades lists it)
  const shownN = useMemo(() => onScreen(found.hits).length, [found])
  const hitsOf = (...kinds: HitKind[]) => found.hits.filter((h) => kinds.includes(h.kind))
  // the scopes a whole query names: a room only for whoever can choose rooms, and not the one already chosen
  const scopes = found.scopes.filter((x) => x.kind !== 'dept' || (!only && x.value !== dept))
  const applyScope = (x: SearchScope) => {
    if (x.kind === 'code') setFCode(x.value)
    else if (x.kind === 'lot') setFLot(x.value)
    else if (x.kind === 'line') setFLine(x.value)
    else setFDept(x.value as Dept)
    setQ('')
  }
  const scopeText = (x: SearchScope) => (x.kind === 'code' ? tr('Ver solo el código {0}', x.value) : x.kind === 'lot' ? tr('Ver solo el lote {0}', x.value) : tr('Ver solo {0}', x.kind === 'line' ? lineChoiceText(x.value) : x.value))
  /** a line of the day as the filters say it: with its room's emoji and name when no room is chosen */
  const lineChoiceText = (id: string) => { const l = rep.lineChoices.find((x) => x.id === id); return !l ? '' : dept ? l.name : DEPT_LOOK[l.dept].emoji + ' ' + l.dept + ' · ' + l.name }
  // nothing found with filters on: is it somewhere else in the day? (asked only then: it is the whole day's report again)
  const narrowed = !!(rep.shift || (!only && dept) || rep.line || rep.code || rep.lot)
  const askWhole = searching && !found.hits.length && narrowed
  const wholeN = useMemo(() => (askWhole ? onScreen(searchReport(s, reportOf(s, date, now, { only }), qs, mgr ? s.changes.filter((c) => !c.deleted && plainDay(s, c.at) === date && (!only || c.dept === only)) : [], now).hits).length : 0), [askWhole, s, date, only, qs, mgr, minute]) // eslint-disable-line react-hooks/exhaustive-deps
  const searchWholeDay = () => { setFShift(0); if (!only) setFDept(''); setFLine(''); setFCode(''); setFLot('') }
  // ---- each list, as the search leaves it, then as its chips leave it ----
  const codesShown = searching ? byCode.filter((c) => keys.has(hitKey.code(c.dept, c.code, c.bin))) : byCode
  const palletsFound = rep.pallets.filter((p) => !searching || keys.has(hitKey.pallet(p.r.id, p.n)))
  const palletsShown = palletsFound.filter((p) => palletIs(p, palF))
  const palCount = (f: PalletFilter) => palletsFound.filter((p) => palletIs(p, f)).length
  const binsShown = rep.bins.filter((b) => !searching || keys.has(hitKey.bin(b.r.id, b.n)))
  const runIs = (x: (typeof rows)[number], c: '' | 'live' | 'waste') => (c === '' ? true : c === 'live' ? !x.r.endedAt : x.waste > 0)
  const runsFound = rows.filter((x) => !searching || keys.has(hitKey.run(x.r.id)))
  const runsShown = runsFound.filter((x) => runIs(x, runChip))
  const unitsShown = unitRows.filter((x) => !searching || keys.has(hitKey.unit(x.r.id, x.i, x.lot)))
  const stopIs = (x: (typeof stops)[number], c: string) => (c === '' ? true : c === '!setup' ? x.reason !== SETUP : x.reason === c)
  const stopsFound = stops.filter((x) => !searching || keys.has(hitKey.stop(x.id)))
  const stopsShown = stopsFound.filter((x) => stopIs(x, cause))
  const changesShown = changes.filter((c) => !searching || keys.has(hitKey.change(c.id)))
  // a room's column in the lists only when more than one room is in view
  const manyRooms = !dept
  // ---- the parts: which ones this person has, and how many things each holds (or how many the search found in it) ----
  const views: View[] = ['gen', 'code', 'shift', ...(!only || only === 'Packing' ? ['pal' as const] : []), 'rec', ...(mgr ? ['chg' as const] : [])]
  const v: View = views.includes(view) ? view : 'gen'
  const hitCount = (x: View) => (x === 'code' ? hitsOf('code').length : x === 'pal' ? hitsOf('pallet', 'bin').length : x === 'rec' ? hitsOf('unit', 'run', 'stop').length : x === 'chg' ? hitsOf('change').length : null)
  const tabs = views.map((x) => {
    const hits = hitCount(x)
    // (Registros says how many stops there are when they are all the day has: no code ran, and only it holds them)
    const n = searching ? hits : x === 'code' ? byCode.length : x === 'pal' ? rep.pallets.length + rep.bins.length : x === 'chg' ? changes.length : x === 'rec' && !rows.length ? stops.length || null : null
    return { v: x, label: viewLabel(x), n, zero: searching && hits === 0 }
  })
  // ---- drills: a number tapped takes to the records behind it, and "‹ Volver" brings back what was in view ----
  const putShift = (k: 0 | 1 | 2 | null) => { shiftChosen = k; setShiftPick(k) }
  const go = (to: View, patch: Partial<Snap> = {}) => {
    setBack({ view: v, rec: recSub, pal: palSub, dept: fDept, shift: shiftPick, line: fLine, code: fCode, lot: fLot, cause, runChip, palF })
    if (patch.dept !== undefined && !only) setFDept(patch.dept)
    if (patch.shift !== undefined) putShift(patch.shift)
    if (patch.line !== undefined) setFLine(patch.line)
    if (patch.code !== undefined) setFCode(patch.code)
    if (patch.lot !== undefined) setFLot(patch.lot)
    setCause(patch.cause ?? '')
    setRunChip(patch.runChip ?? '')
    setPalF(patch.palF ?? '')
    if (patch.rec) setRecSub(patch.rec)
    if (patch.pal) setPalSub(patch.pal)
    setView(to)
    setShows((n) => n + 1)
  }
  /** the phone's layout (styles.css): the tabs first, then the filters, then the part in view */
  const phone = () => !!window.matchMedia?.('(max-width:720px)').matches
  /** a tab tapped: its part (on a phone, where the filters stand between the tabs and the part, brought into view like a drill's) */
  const pickView = (x: View) => { setView(x); if (phone()) setShows((n) => n + 1) }
  // ---- the only scrolls of the page the report makes ----
  /** how far down the screen the app's bar covers (nothing once it has scrolled away with the page) */
  const coveredTo = () => Math.max(0, document.querySelector('header.top')?.getBoundingClientRect().bottom ?? 0)
  /** a piece of the report brought to the top of the screen when it is hidden above (or, asked, when it is below the screen) */
  const reveal = (el: Element | null | undefined, below = false) => {
    if (!el) return
    const gap = () => el.getBoundingClientRect().top - coveredTo() - 8
    const g = gap()
    if (g >= -8 && !(below && el.getBoundingClientRect().top > window.innerHeight - 80)) return
    window.scrollBy(0, g)
    // the app's bar scrolls away with the page too: when it has gone, the piece goes up to the very top
    const again = gap()
    if (again > 0) window.scrollBy(0, again)
  }
  // Once a drill's part (or a tab's, on a phone) is drawn, what the tap opened is seen with what is in view said above
  // it: the "Viendo" line ("‹ Volver" is there), then the part. On a PC or a tablet, where the tabs sit just above the
  // part, this only happens when that line had scrolled away above; on a phone it also comes up from below.
  useEffect(() => {
    if (!shows) return
    reveal(scopeRef.current, phone())
  }, [shows]) // eslint-disable-line react-hooks/exhaustive-deps
  const goBack = () => {
    if (!back) return
    if (!only) setFDept(back.dept)
    putShift(back.shift)
    setFLine(back.line); setFCode(back.code); setFLot(back.lot); setCause(back.cause); setRunChip(back.runChip); setPalF(back.palF)
    setRecSub(back.rec); setPalSub(back.pal); setView(back.view)
    setBack(null)
  }
  // another date: the drill and the quick chips were about the other day; the search and the part in view stay (the same lot, another day)
  const pickDate = (d: string) => { setDate(d); setBack(null); setCause(''); setRunChip('') }
  // ---- long lists, fifty rows a page; any change of what is in view goes back to the first page ----
  useEffect(() => { setPage({}) }, [date, dept, fCode, fLot, fShift, fLine, qs, v, recSub, palSub, cause, runChip, palF])
  const pageNo = (key: string, total: number) => Math.min(page[key] ?? 0, Math.max(0, Math.ceil(total / PAGE) - 1))
  const pageOf = <T,>(key: string, list: T[]) => { const p = pageNo(key, list.length); return list.slice(p * PAGE, p * PAGE + PAGE) }
  const turnPage = (key: string, p: number, from: HTMLElement) => {
    setPage({ ...page, [key]: p })
    // the list starts again at its top: inside its frame, and (on a phone, where the list is cards with no frame of
    // its own) its toolbar comes back into view when it had scrolled away above
    const list = from.closest('.rp-list'), wrap = list?.querySelector('.twrap')
    if (wrap) wrap.scrollTop = 0
    reveal(list)
  }
  const pageBar = (key: string, total: number) => <Pager total={total} page={pageNo(key, total)} onPage={(p, el) => turnPage(key, p, el)} />
  // ---- who may correct or add (a viewer never): the report's rule, shared with Flujo's detail window (see useFixers) ----
  const { fixable, fix, seeBtn, fixBtn } = useFixers()
  const canAdd = can('fix') && day.state === 'here'
  /** a "+ Agregar" of one room (none = whatever room the box opens on: the person's own, see AddRunDialog) */
  const addIn = (room?: string) => canAdd && (!room || writesIn(who, room))
  /** the shifts a run or a stop touched ("1", "2" or "1 y 2"): who may correct it */
  const spanOf = (x: { startedAt: number; endedAt: number | null }) => spanShifts(rep.plan, x.startedAt, x.endedAt ?? now)
  /** the first cell of a record's row: see it, and correct it (or why not) */
  const acts = (shifts: string, room: string, onSee: (() => void) | null, onFix: () => void, rowSpan?: number) => <td className="rp-act" rowSpan={rowSpan}><div className="btns">{onSee && seeBtn(onSee)}{fixBtn(shifts, room, onFix)}</div></td>
  // a run that is gone (deleted from its correction) closes its sheet
  useEffect(() => { if (detail && !s.runs.some((r) => r.id === detail.runId)) setDetail(null) }, [detail, s.runs])
  return {
    s, now, only, mgr, admin, viewOnly, can, who, date, pickDate, today, day, rep, rows, unitRows, stops, byCode, runs, working, down, setup,
    dept, fDept, setFDept, fShift, shiftPick, setFShift, fCode, setFCode, fLot, setFLot, setFLine, lineChosen, lineChoiceText, active, clear,
    purges, recovering, recover, tookText, sending, setSending, preparing, send, pdf, excel, csv, shiftsOpen, setShiftsOpen, wiping, setWiping,
    notice, setNotice, editRun, setEditRun, runToEdit, stopToEdit, setEditStop, addFor, setAddFor, detail, setDetail, stopSheet, setStopSheet, picking, setPicking, any, help, setHelp,
    q, qs, setQ, toks, searching, found, shownN, hitsOf, scopes, applyScope, scopeText, wholeN, searchWholeDay,
    views, v, tabs, setView, pickView, scopeRef, recSub, setRecSub, palSub, setPalSub, cause, setCause, runChip, setRunChip, palF, setPalF, back, go, goBack,
    codesShown, palletsFound, palletsShown, palCount, binsShown, runsFound, runsShown, runIs, unitsShown, stopsFound, stopsShown, stopIs, changes, changesShown,
    manyRooms, canAdd, addIn, fixable, fix, spanOf, seeBtn, fixBtn, acts, pageOf, pageBar, withOrders, unitsText, binsN, ofText, cw, reasonsText, lineName, cap, hrs, dash, linesText, shiftCols,
  }
}
type Kit = ReturnType<typeof useReport>

export function Report(props: ReportProps) {
  const k = useReport(props)
  const { s, now, only, mgr, admin, can, date, pickDate, today, day, rep, rows, dept, lineChosen, purges, recovering, recover, tookText, sending, setSending, preparing, send, pdf, excel, csv, shiftsOpen, setShiftsOpen, wiping, setWiping, notice, setNotice, editRun, setEditRun, runToEdit, stopToEdit, setEditStop, addFor, setAddFor, detail, setDetail, stopSheet, setStopSheet, picking, setPicking, any, help, setHelp, v, tabs, pickView, setFShift, hrs, setFCode, setFLot, fix, fixable } = k
  return (
    <section className="report">
      <div className="rhead">
        <div className="rtitle"><h2>{tr('Reporte del día')}{only && <> <DeptBadge d={only} /></>}</h2><span>{longDate(date)}</span></div>
        <div className="racts">
          <button type="button" className="btn primary" onClick={() => setPicking('send')} disabled={!any || preparing}>{preparing ? tr('Preparando…') : <>{tr('✉ Enviar')}<span className="opt"> {' '}{tr('reporte')}</span></>}</button>
          <button type="button" className="btn" onClick={() => setPicking('pdf')} disabled={!any}>{tr('📄 PDF')}<span className="opt"> {' '}{tr('/ imprimir')}</span></button>
          <button type="button" className="btn" onClick={() => setPicking('xlsx')} disabled={!any}>{tr('⬇ Excel')}</button>
          <button type="button" className="btn" onClick={csv} disabled={!rows.length}>CSV</button>
        </div>
      </div>
      {picking && <PartsDialog k={k} mode={picking} onClose={() => setPicking(null)} onGo={(parts) => { const m = picking; setPicking(null); if (m === 'xlsx') void excel(parts); else if (m === 'pdf') void pdf(parts); else void send(parts) }} />}
      {sending && <SendDialog files={sending} subject={tr('Actividad · Reporte {0}', date) + (dept ? ' · ' + dept : '') + filterTitle(rep.code, rep.lot, rep.shift, lineChosen)} onClose={() => setSending(null)} />}
      {/* what to look at: the search first, then the day, the shift, the room, the line, the code and the lot. They add up.
          (On a phone the captions marked rf-cap are left out: the box, the date and the rooms already say what they are) */}
      <div className="rp-filters">
        <SearchBox k={k} />
        <div className="rf-row">
          <div className="rf">
            <span className="lab rf-cap">{tr('Fecha')}</span>
            <div className="daynav">
              <button type="button" className="btn" aria-label={tr('Día anterior')} onClick={() => pickDate(addDays(date, -1))}>‹</button>
              <input type="date" aria-label={tr('Fecha del reporte')} value={date} onChange={(e) => { if (e.target.value) pickDate(e.target.value) }} />
              <button type="button" className="btn" aria-label={tr('Día siguiente')} disabled={date >= today} onClick={() => pickDate(addDays(date, 1))}>›</button>
              {date !== today && <button type="button" className="btn" onClick={() => pickDate(today)}>{tr('Hoy')}</button>}
            </div>
          </div>
          <div className="rf grow">
            <span className="lab">{tr('Turno')}{can('shifts') && <button type="button" className="btn sm" onClick={() => setShiftsOpen(true)}>{tr('Cambiar horario')}</button>}</span>
            <div className="seg" role="group" aria-label={tr('Turno')}>
              {([0, 1, 2] as const).filter((k) => !k || !rep.plan.only || rep.plan.only === k).map((k) => (
                <button key={k} type="button" className={rep.shift === k ? 'on' : ''} aria-pressed={rep.shift === k} onClick={() => setFShift(k)}>{k ? tr('Turno {0}', k) : tr('Día completo')}<small className="hrs">{k ? hrs(k) : rep.plan.only ? tr('un solo turno') : tr('los dos turnos')}</small></button>
              ))}
            </div>
          </div>
        </div>
        {!only && (
          <div className="rf">
            <span className="lab rf-cap">{tr('Departamento')}</span>
            <DeptChips s={s} date={date} dept={dept} onPick={k.setFDept} />
          </div>
        )}
        <div className="rf-two rf-three">
          <label className="rf"><span className="lab">{tr('Línea')}</span>
            <select value={rep.line} disabled={!rep.lineChoices.length} onChange={(e) => k.setFLine(e.target.value)}><option value="">{tr('Todas')}</option>{rep.lineChoices.map((l) => <option key={l.id} value={l.id}>{k.lineChoiceText(l.id)}</option>)}</select>
          </label>
          <label className="rf"><span className="lab">{tr('Código')}</span>
            <select value={rep.code} disabled={!rep.codes.length} onChange={(e) => setFCode(e.target.value)}><option value="">{tr('Todos')}</option>{rep.codes.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </label>
          <label className="rf"><span className="lab">{tr('Lote')}</span>
            <select value={rep.lot} disabled={!rep.lots.length} onChange={(e) => setFLot(e.target.value)}><option value="">{tr('Todos')}</option>{rep.lots.map((l) => <option key={l} value={l}>{l}</option>)}</select>
          </label>
        </div>
        <Scope k={k} />
      </div>
      <DayNote day={day} />
      {purges.map((c) => (
        <div key={c.id} className="purged">
          <span>{trx('⚠ A las {0}, {1} quitó de este día {2}. No se perdieron: siguen guardados en el servidor.', <b>{fmtTime(c.at)}</b>, <b>{c.by}</b>, <b>{tookText(c.before)}</b>)}</span>
          {admin || can('del')
            ? <button type="button" className="btn primary" disabled={recovering} onClick={() => void recover(c.id)}>{recovering ? tr('Recuperando…') : tr('↩ Recuperarlos')}</button>
            : <small>{tr('Un manager puede recuperarlos desde aquí.')}</small>}
        </div>
      ))}
      {shiftsOpen && <ShiftsDialog s={s} date={date} onClose={() => setShiftsOpen(false)} />}
      <ViewTabs tabs={tabs} on={v} onPick={pickView} />
      <div className="rp-sub"><span>{viewSub(v)}</span><button type="button" className="btn sm" onClick={() => setHelp(true)}>ⓘ {tr('Cómo leer este reporte')}</button></div>
      <div id="rp-panel" role="tabpanel" aria-labelledby={'rp-tab-' + v} className="rp-panel">
        {/* (a day, or a filter, with no code but with stops: every part says so and Registros opens on them) */}
        {v === 'chg' ? <ChangesView k={k} /> : k.searching && (v === 'gen' || v === 'shift') ? <SearchResults k={k} />
          : rows.length === 0 ? (v === 'rec' && k.stops.length > 0 ? <RecordsView k={k} /> : <EmptyDay k={k} />)
            : v === 'gen' ? <GeneralView k={k} /> : v === 'code' ? <CodesView k={k} /> : v === 'shift' ? <ShiftsView k={k} /> : v === 'pal' ? <PalletsView k={k} /> : <RecordsView k={k} />}
      </div>
      <p className="hint foot">{supabase ? tr('Todo se guarda en el servidor y se ve en vivo desde la oficina, el teléfono o la PC.') : tr('Demo guardado en este dispositivo. La versión completa manda todo en vivo al manager (oficina, teléfono o PC) y exporta a Excel, PDF y Google Sheets como la Hoja de Freezer RTE.')}</p>
      {detail && <RunDetail s={s} runId={detail.runId} at={detail.at} now={now} mgr={mgr} fix={fix} fixable={fixable} onFix={(at) => setEditRun({ id: detail.runId, at })} onFixStop={setEditStop} onCode={(c) => { setFCode(c); setDetail(null) }} onLot={(l) => { setFLot(l); setDetail(null) }} onClose={() => setDetail(null)} />}
      {runToEdit && <RunEditor s={s} run={runToEdit} mgr={can('fix')} focusAt={editRun?.at} onClose={() => setEditRun(null)} />}
      {stopSheet && <StopSheet k={k} id={stopSheet} onClose={() => setStopSheet(null)} />}
      {addFor && <AddRunDialog s={s} date={date} dept={addFor.dept ?? dept} onClose={() => setAddFor(null)} onAdded={(id) => { setAddFor(null); setDetail({ runId: id }) }} />}
      {stopToEdit && <StopEditor stop={stopToEdit} mgr={can('fix')} onClose={() => setEditStop(null)} />}
      {wiping && <WipeDayDialog s={s} date={date} onClose={() => setWiping(false)} onDone={setNotice} />}
      {notice && <NoticeDialog title={notice.title} text={notice.text} onClose={() => setNotice(null)} />}
      {help && <HelpDialog views={k.views} plan={rep.plan} onClose={() => setHelp(false)} />}
    </section>
  )
}

/** the search: one box for every room (with a room chosen, it is that room's search), first in the filter card */
function SearchBox({ k }: { k: Kit }) {
  const { q, qs, setQ, shownN: n, scopes, applyScope, scopeText } = k
  return (
    <div className="rf rp-searchrow">
      <span className="lab rf-cap">{tr('Buscar en este día')}</span>
      <div className="rp-search" role="search">
        <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="M15.5 15.5 21 21" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
        <input type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
          aria-label={tr('Buscar en este día')} placeholder={tr('Código, producto, lote, tag, PO, bin, línea o persona')}
          value={q} onChange={(e) => setQ(e.target.value)} />
        {q && <button type="button" className="btn rp-clear" aria-label={tr('Quitar la búsqueda')} onClick={() => setQ('')}>✕</button>}
      </div>
      {qs.trim() && <p className="rp-searchnote">{n === 1 ? tr('1 resultado') : tr('{0} resultados', n)} · {tr('La búsqueda no cambia los archivos: salen con los filtros.')}</p>}
      {scopes.length > 0 && <div className="rp-scopes">{scopes.map((x) => <button key={x.kind + x.value} type="button" className="btn sm soft" onClick={() => applyScope(x)}>{scopeText(x)}</button>)}</div>}
    </div>
  )
}

/** the rooms to choose from: all five always, in the plant's order, so their places and colours never move */
function DeptChips({ s, date, dept, onPick }: { s: State; date: string; dept: Dept | undefined; onPick: (d: Dept | '') => void }) {
  return (
    <div className="rp-chips" role="group" aria-label={tr('Departamento')}>
      <button type="button" className={'rp-chip' + (!dept ? ' on' : '')} aria-pressed={!dept} onClick={() => onPick('')}>{!dept && <span className="tick">✓ </span>}<span className="em" aria-hidden="true">🏭</span><span>{tr('Todos')}</span></button>
      {DEPTS.map((d) => {
        // a room with nothing that day stays (dimmed): its missing record can still be added from it
        const empty = !s.runs.some((r) => r.date === date && r.dept === d)
        return <button key={d} type="button" className={'rp-chip' + (dept === d ? ' on' : '') + (empty ? ' none' : '')} style={deptVars(d)} aria-pressed={dept === d} title={empty ? tr('Nada registrado este día') : undefined} onClick={() => onPick(d)}>{dept === d && <span className="tick">✓ </span>}<span className="em" aria-hidden="true">{DEPT_LOOK[d].emoji}</span><span>{d}</span></button>
      })}
    </div>
  )
}

/** "Viendo …": always on screen, it says in words the shift and the room in view, and every filter on, each with its ✕ */
function Scope({ k }: { k: Kit }) {
  const { rep, only, dept, who, shiftPick, setFShift, setFDept, setFLine, setFCode, setFLot, lineChosen, lineChoiceText, q, setQ, active, clear, back, goBack, scopeRef } = k
  const chip = (key: string, label: ReactNode, name: string, off: () => void) => <button key={key} type="button" className="btn sm rp-on" aria-label={tr('Quitar {0}', name)} onClick={off}>{label}<span className="x" aria-hidden="true">✕</span></button>
  const shiftName = rep.shift ? tr('Turno {0}', rep.shift) + (shiftPick === null ? ' ' + (who.shift ? tr('(tu turno)') : tr('(en curso)')) : '') : ''
  return (
    <div className="rp-scopebox" ref={scopeRef}>
      <div className="rp-scope">
        {back && <button type="button" className="btn sm" onClick={goBack}>{'‹ ' + tr('Volver')}</button>}
        <span>{tr('Viendo')}</span>
        {rep.shift ? chip('shift', shiftName, shiftName, () => setFShift(0)) : <b>{tr('Día completo')}{rep.plan.only ? ' · ' + tr('un solo turno') : ''}</b>}
        {only ? <DeptBadge d={only} /> : dept ? chip('dept', <DeptBadge d={dept} />, dept, () => setFDept('')) : <b>{tr('Todos los departamentos')}</b>}
        {rep.line && chip('line', lineChoiceText(rep.line) || lineChosen, lineChosen, () => setFLine(''))}
        {rep.code && chip('code', tr('Código {0}', rep.code), tr('Código {0}', rep.code), () => setFCode(''))}
        {rep.lot && chip('lot', tr('Lote {0}', rep.lot), tr('Lote {0}', rep.lot), () => setFLot(''))}
        {q.trim() && chip('q', '🔍 «' + q.trim() + '»', '«' + q.trim() + '»', () => setQ(''))}
        {active.length > 0 && <button type="button" className="btn sm" onClick={clear}>{tr('✕ Quitar filtros')}</button>}
      </div>
      {active.length > 0 && <p className="rf-foot">{tr('Los archivos salen con lo que estás viendo.')}{rep.lot && !rep.shift && ' ' + tr('Con un lote, los tiempos y el waste son los de las corridas completas.')}</p>}
    </div>
  )
}

/** the six parts of the report, one at a time; each says how many things it holds (or how many the search found in it) */
function ViewTabs({ tabs, on, onPick }: { tabs: { v: View; label: string; n: number | null; zero: boolean }[]; on: View; onPick: (v: View) => void }) {
  return (
    <div className="rp-tabs" role="tablist" aria-label={tr('Partes del reporte')}>
      {tabs.map((t) => (
        <button key={t.v} id={'rp-tab-' + t.v} type="button" role="tab" aria-selected={on === t.v} aria-controls="rp-panel" className={'rp-tab' + (on === t.v ? ' on' : '') + (t.zero ? ' zero' : '')} onClick={() => onPick(t.v)}>
          <span>{t.label}</span>{t.n != null && <span className="n">{t.n}</span>}
        </button>
      ))}
    </div>
  )
}

/** a long list a page at a time: where it is, and the way to the page before and after */
function Pager({ total, page, onPage }: { total: number; page: number; onPage: (p: number, from: HTMLElement) => void }) {
  if (total <= PAGE) return null
  const from = page * PAGE + 1, to = Math.min(total, (page + 1) * PAGE)
  return (
    <div className="rp-pager">
      <span>{tr('{0}–{1} de {2}', from, to, total)}</span>
      <div className="btns">
        <button type="button" className="btn sm" disabled={page === 0} onClick={(e) => onPage(page - 1, e.currentTarget)}>{tr('‹ Anterior')}</button>
        <button type="button" className="btn sm" disabled={to >= total} onClick={(e) => onPage(page + 1, e.currentTarget)}>{tr('Siguiente ›')}</button>
      </div>
    </div>
  )
}

/**
 * A day (or a filter) with no code recorded: said, with the way to add what is missing and to see more. Stops can be
 * there without any code (a meeting of the whole room before the first one, a line stopped all along): then it says
 * so, and takes to them.
 */
function EmptyDay({ k }: { k: Kit }) {
  const { rep, only, dept, day, stops, go, canAdd, setAddFor, active, clear } = k
  return (
    <div className="rp-empty">
      <p className="hint">{day.state !== 'here' ? '' : stops.length ? tr('Ningún código registrado en lo que estás viendo, pero sí paros.') : rep.code || rep.lot || (!only && dept) ? tr('Nada registrado con estos filtros.') : rep.shift ? tr('Nada registrado en este turno.') : tr('Nada registrado en esta fecha.')}</p>
      <div className="btns">
        {stops.length > 0 && <button type="button" className="btn" onClick={() => go('rec', { rec: 'stops' })}>{tr('Paros') + ' ' + stops.length + ' ›'}</button>}
        {canAdd && <button type="button" className="btn soft" onClick={() => setAddFor({})}>{tr('+ Agregar registro')}</button>}
        {active.length > 0 && <button type="button" className="btn" onClick={clear}>{tr('✕ Quitar filtros')}</button>}
      </div>
    </div>
  )
}

/** nothing found with the search: where else it is (another part, the whole day), and the way to add it if it was never recorded */
function Nothing({ k, subs = [] }: { k: Kit; subs?: { label: string; n: number; open: () => void }[] }) {
  const { qs: q, found, tabs, v, setView, wholeN, searchWholeDay, canAdd, setAddFor } = k
  const elsewhere = tabs.filter((t) => t.v !== v && (t.v === 'code' || t.v === 'pal' || t.v === 'rec' || t.v === 'chg') && (t.n ?? 0) > 0)
  if (found.hits.length > 0) {
    return (
      <div className="rp-nothing">
        <p>{tr('Nada con «{0}» aquí. Está en:', q.trim())}</p>
        <div className="btns">
          {subs.filter((x) => x.n > 0).map((x) => <button key={x.label} type="button" className="btn sm" onClick={x.open}>{x.label + ' ' + x.n + ' ›'}</button>)}
          {elsewhere.map((t) => <button key={t.v} type="button" className="btn sm" onClick={() => setView(t.v)}>{t.label + ' ' + t.n + ' ›'}</button>)}
        </div>
      </div>
    )
  }
  return (
    <div className="rp-nothing">
      <p>{tr('Nada con «{0}» en lo que estás viendo.', q.trim())}</p>
      {wholeN > 0 && <p>{tr('En todo el día hay {0}.', wholeN === 1 ? tr('1 resultado') : tr('{0} resultados', wholeN))} <button type="button" className="btn sm soft" onClick={searchWholeDay}>{tr('Buscar en todo el día')}</button></p>}
      {canAdd && <p>{tr('¿No está? Si se hizo y nadie lo registró:')} <button type="button" className="btn sm soft" onClick={() => setAddFor({})}>{tr('+ Agregar registro')}</button></p>}
    </div>
  )
}

/** with a search typed on General or Por turno: what it found, kind by kind, five of each, each with what opens it */
function SearchResults({ k }: { k: Kit }) {
  const { qs: q, shownN, hitsOf, setQ, go, dept } = k
  // the units of Packing are its pallets and bins, which have their own groups
  const units = hitsOf('unit').filter((h) => h.dept !== 'Packing')
  const rooms = [...new Set(units.map((h) => h.dept))]
  // Unidades lists Packing's units too: with the units found all of one room, that room is chosen on the way, so the
  // list holds exactly the ones counted here; with several rooms (and Packing's among them) the button gives no number
  const mixed = units.length !== hitsOf('unit').length
  const oneRoom = mixed && !dept && rooms.length === 1 && rooms[0] ? rooms[0] : null
  const toUnits = () => go('rec', { rec: 'units', ...(oneRoom ? { dept: oneRoom } : {}) })
  const unitsCount = !mixed || !!oneRoom
  const groups: { kind: HitKind; title: string; hits: Hit[]; tab: View; open: () => void }[] = [
    { kind: 'code' as const, title: tr('Códigos'), hits: hitsOf('code'), tab: 'code' as const, open: () => go('code') },
    { kind: 'pallet' as const, title: tr('Pallets'), hits: hitsOf('pallet'), tab: 'pal' as const, open: () => go('pal', { pal: 'pallets' }) },
    { kind: 'bin' as const, title: tr('Bins'), hits: hitsOf('bin'), tab: 'pal' as const, open: () => go('pal', { pal: 'bins' }) },
    { kind: 'unit' as const, title: rooms.length === 1 && rooms[0] ? CFG[rooms[0]].plural : tr('Unidades'), hits: units, tab: 'rec' as const, open: toUnits },
    { kind: 'run' as const, title: tr('Corridas'), hits: hitsOf('run'), tab: 'rec' as const, open: () => go('rec', { rec: 'runs' }) },
    { kind: 'stop' as const, title: tr('Paros'), hits: hitsOf('stop'), tab: 'rec' as const, open: () => go('rec', { rec: 'stops' }) },
    { kind: 'change' as const, title: tr('Cambios'), hits: hitsOf('change'), tab: 'chg' as const, open: () => go('chg') },
  ].filter((g) => g.hits.length > 0)
  return (
    <div className="rp-results">
      <div className="rp-reshead"><h3>{tr('Resultados de «{0}»', q.trim())} · {shownN}</h3><button type="button" className="btn sm" onClick={() => setQ('')}>✕ {tr('Quitar la búsqueda')}</button></div>
      {shownN === 0 ? <Nothing k={k} /> : groups.map((g) => (
        <section key={g.kind} className="rp-group">
          <div className="rp-grouphead"><h4>{g.title} · {g.hits.length}</h4>{g.hits.length > 5 && <button type="button" className="btn sm" onClick={g.open}>{(g.kind !== 'unit' || unitsCount ? tr('Ver los {0} en {1}', g.hits.length, viewLabel(g.tab)) : tr('Ver todos en {0}', viewLabel(g.tab))) + ' ›'}</button>}</div>
          {g.hits.slice(0, 5).map((h) => <HitCard key={h.key} k={k} h={h} />)}
        </section>
      ))}
    </div>
  )
}

/** one thing the search found, as a card: its room, what it is, its facts, and what opens it */
function HitCard({ k, h }: { k: Kit; h: Hit }) {
  const { s, rep, rows, unitRows, stops, changes, toks, now, fix, seeBtn, fixBtn, spanOf, setDetail, setEditRun, setEditStop, setQ, go, ofText, cw, lineName } = k
  const at = (ms: number) => hl(fmtTime(ms), toks)
  const turn = (n: number | string) => tr('Turno {0}', n)
  const by = (name: string) => (name ? trx('registró {0}', hl(name, toks)) : null)
  const product = (code: string) => { const p = productOf(s, code)?.name; return p ? <small> · {hl(p, toks)}</small> : null }
  let title: ReactNode = null, sub: ReactNode = null, btns: ReactNode = null
  if (h.kind === 'code') {
    const c = rep.byCode.find((x) => hitKey.code(x.dept, x.code, x.bin) === h.key)
    if (!c) return null
    const w = cw(c)
    title = <><span className="code">{hl(c.code, toks)}</span>{c.bin && <small> · {apartLabel(c.dept, c.bin)}</small>}{product(c.code)}</>
    sub = joined([c.units + ' ' + (c.units === 1 ? w.unit : w.plural).toLowerCase(), CFG[c.dept].qty !== 'none' ? fmtN(c.qty) + ' ' + w.qtyUnit : null, c.lots.some((l) => l.lot) ? <>{tr('Lote')} {joined(c.lots.map((l) => hl(l.lot, toks)), ', ')}</> : null])
    btns = <button type="button" className="btn xs" onClick={() => { setQ(''); go('code', { code: c.code }) }}>{tr('Ver solo el código {0}', c.code)}</button>
  } else if (h.kind === 'pallet') {
    const p = rep.pallets.find((x) => hitKey.pallet(x.r.id, x.n) === h.key)
    if (!p) return null
    const unitAt = p.open ? undefined : p.at
    title = <>{tr('Pallet {0}', p.n)} · <span className="code">{hl(p.r.code, toks)}</span>{p.open && <> <span className="pill run">{tr('en armado')}</span></>}</>
    sub = <>
      {p.parts.map((x, i) => <span key={i} className="ln">{joined([<>{tr('Lote')} {hl(x.lot, toks)}</>, (x.qty != null ? fmtN(x.qty) : '—') + ' ' + CFG.Packing.qtyUnit, x.tag ? <>{tr('Tag')} {hl(x.tag, toks)}</> : tr('sin tag')])}</span>)}
      <span className="ln">{joined([p.order ? <>{hl(p.order, toks)}{p.of && ' ' + ofText(p.of)}</> : null, hl(lineNameOf(s, p.r.lineId, p.r.line), toks), p.open ? null : at(p.at), turn(p.shift), by(p.by), p.note ? <>💬 {hl(p.note, toks)}</> : null])}</span>
    </>
    btns = <>{seeBtn(() => setDetail({ runId: p.r.id, at: unitAt }))}{fixBtn(spanOf(p.r), p.r.dept, () => setEditRun({ id: p.r.id, at: unitAt }))}</>
  } else if (h.kind === 'bin') {
    const b = rep.bins.find((x) => hitKey.bin(x.r.id, x.n) === h.key)
    if (!b) return null
    title = <>{cfgOf(b.r).unit + ' ' + b.n} · <span className="code">{hl(b.r.code, toks)}</span> · {trx('Lote {0}', hl(b.lot, toks))}</>
    sub = joined([(b.qty != null ? fmtN(b.qty) : '—') + ' ' + binWord(b.word), b.ref ? <>{tr('N° de bin')} {hl(b.ref, toks)}</> : null, hl(lineNameOf(s, b.r.lineId, b.r.line), toks), at(b.at), turn(b.shift), by(b.by)])
    btns = <>{seeBtn(() => setDetail({ runId: b.r.id, at: b.at }))}{fixBtn(spanOf(b.r), b.r.dept, () => setEditRun({ id: b.r.id, at: b.at }))}</>
  } else if (h.kind === 'unit') {
    const x = unitRows.find((y) => hitKey.unit(y.r.id, y.i, y.lot) === h.key)
    if (!x) return null
    const c = cfgOf(x.r)
    title = <>{c.unit + ' ' + (x.i + 1)} · <span className="code">{hl(x.r.code, toks)}</span>{x.lot && <> · {trx('Lote {0}', hl(x.lot, toks))}</>}</>
    sub = joined([x.qty != null ? x.qty.toLocaleString('en-US') + ' ' + c.qtyUnit : null, x.tag ? <>{c.refLabel ? c.refLabel + ' ' : ''}{hl(x.tag, toks)}</> : null, x.order ? hl(x.order, toks) : null, hl(lineNameOf(s, x.r.lineId, x.r.line), toks), at(x.u.at), turn(x.shift), by(x.u.by), x.u.note ? <>💬 {hl(x.u.note, toks)}</> : null])
    btns = <>{seeBtn(() => setDetail({ runId: x.r.id, at: x.u.at }))}{fixBtn(spanOf(x.r), x.r.dept, () => setEditRun({ id: x.r.id, at: x.u.at }))}</>
  } else if (h.kind === 'run') {
    const x = rows.find((y) => hitKey.run(y.r.id) === h.key)
    if (!x) return null
    title = <><span className="code">{hl(x.r.code, toks)}</span> · {hl(lineNameOf(s, x.r.lineId, x.r.line), toks)}{product(x.r.code)}</>
    sub = joined([x.lots ? <>{tr('Lote')} {hl(x.lots, toks)}</> : null, <>{at(x.r.startedAt)} – {x.r.endedAt ? fmtTime(x.r.endedAt) : tr('en curso')}</>, madeText(x.view, x.qty, true), x.waste ? <span className="red">{'waste ' + x.waste + ' lb'}</span> : null, x.shifts ? turn(x.shifts) : null, by(whoText(x.r)), noteOf(x.r) ? <>💬 {hl(noteOf(x.r), toks)}</> : null])
    btns = <>{seeBtn(() => setDetail({ runId: x.r.id }))}{fixBtn(x.shifts, x.r.dept, () => setEditRun({ id: x.r.id }))}</>
  } else if (h.kind === 'stop') {
    const x = stops.find((y) => hitKey.stop(y.id) === h.key)
    if (!x) return null
    title = <>{hl(reasonText(s, x.reason), toks)} · {hl(lineName(x), toks)}</>
    sub = joined([x.note ? hl(noteLabel(x.note), toks) : null, <>{at(x.startedAt)} – {x.endedAt ? fmtTime(x.endedAt) : tr('en curso')}</>, fmtDur(x.ms), turn(spanOf(x)), by(x.by)])
    btns = fixBtn(spanOf(x), x.dept, () => setEditStop(x.id))
  } else {
    const c = changes.find((y) => hitKey.change(y.id) === h.key)
    if (!c) return null
    title = hl(c.what, toks)
    sub = joined([hl(c.by, toks), at(c.at), c.before || c.after ? <>{c.before ? <s>{hl(c.before, toks)}</s> : '—'} → {hl(c.after || '—', toks)}</> : null])
    // the record a change was made to, while it is there: a run opens its sheet; a stop, its correction (for whoever may correct)
    const stop = c.refTable === 'act_stops' ? s.stops.find((x) => x.id === c.refKey && !x.deleted) : undefined
    btns = c.refTable === 'act_runs' && s.runs.some((r) => r.id === c.refKey) ? seeBtn(() => setDetail({ runId: c.refKey }))
      : stop && fix(spanShifts(rep.plan, stop.startedAt, stop.endedAt ?? now), stop.dept) ? seeBtn(() => setEditStop(stop.id)) : null
  }
  return (
    <div className="rp-hit" style={roomKnown(h.dept) ? deptVars(h.dept) : undefined}>
      <div className="rp-hit-main">
        <div className="t">{h.dept && <DeptBadge d={h.dept} />} {title}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {btns && <div className="btns">{btns}</div>}
    </div>
  )
}

/** General: the plant's four numbers, then each room's card, then what the lines were stopped for */
function GeneralView({ k }: { k: Kit }) {
  const { s, rep, rows, working, down, setup, linesText, go, mgr, dept, only, day, canAdd, setAddFor } = k
  // the rooms with lines that recorded nothing that day (the whole day, no filter): one line saying so, to add what was missed
  const idle = mgr && !dept && !only && !rep.shift && !rep.code && !rep.lot && !rep.line && day.state === 'here' ? DEPTS.filter((d) => s.lines.some((l) => l.dept === d && !l.deleted) && !rep.byDept.some((x) => x.dept === d)) : []
  return (
    <>
      {rep.byDept.length > 1 && (
        <>
          <h3>{tr('Todos los departamentos')}</h3>
          <div className="rp-plant">
            <button type="button" className="rp-tile" onClick={() => go('code')}><span className="lab">{tr('Códigos')}</span><b>{rep.distinct}</b><small>{rows.length} {rows.length === 1 ? tr('corrida') : tr('corridas')}</small></button>
            <button type="button" className="rp-tile" onClick={() => go('rec', { rec: 'runs' })}><span className="lab">{tr('Trabajando')}</span><b>{fmtDur(working)}</b><small>{linesText(rep.lines)}</small></button>
            <button type="button" className="rp-tile" onClick={() => go('rec', { rec: 'stops', cause: '!setup' })}><span className="lab">{tr('Parado')}</span><b className={down ? 'red' : ''}>{fmtDur(down)}</b><small>{linesText(rep.lines)}</small></button>
            <button type="button" className="rp-tile" onClick={() => go('rec', { rec: 'stops', cause: SETUP })}><span className="lab">Set up</span><b className={setup ? 'amber' : ''}>{setup ? fmtDur(setup) : '—'}</b><small>{tr('preparando las líneas')}</small></button>
          </div>
        </>
      )}
      <div className={'rp-cards' + (rep.byDept.length === 1 ? ' one' : '')}>
        {rep.byDept.map((d) => <RoomCard key={d.dept} k={k} d={d} />)}
      </div>
      {idle.length > 0 && <p className="hint rp-idle">{tr('Sin registros este día: {0}', idle.map((d) => DEPT_LOOK[d].emoji + ' ' + d).join(' · '))}{canAdd && <> <button type="button" className="btn sm soft" onClick={() => setAddFor({})}>{tr('+ Agregar registro')}</button></>}</p>}
      {/* what the "Parado" total is made of: each cause opens its stops */}
      {rep.reasons.length > 0 && (
        <>
          <h3>{tr('Parado por causa')}</h3>
          <div className="reasons">
            {rep.reasons.map((x) => (
              <div key={x.reason} className="reason">
                <button type="button" className="drill" onClick={() => go('rec', { rec: 'stops', cause: x.reason })}>{reasonText(s, x.reason)}</button><span>{fmtDur(x.ms)}</span><span className="pct">{down > 0 ? Math.round((x.ms / down) * 100) + '%' : ''}</span>
                <div className="rbar"><i style={{ width: Math.max(2, Math.round((x.ms / rep.reasons[0].ms) * 100)) + '%' }} /></div>
              </div>
            ))}
          </div>
        </>
      )}
      {(s.attView.on || k.admin) && <AttendanceWhere k={k} />}
      <StopsWhere k={k} />
      {(s.reasonCodes.on || hasCodedStops(rep)) && <CodePareto k={k} />}
    </>
  )
}

/**
 * "¿Qué incluir?" (Jose, 2026-10-21: "escoger si quiero solo descargar la asistencia o otra cosa en específica y no
 * todo de una vez ... si solo quieren datos específicos para mandar por excel o imprimir"): before the Excel, the PDF
 * or what is sent is made, each part of the report with a box, ticked as the last time (all of them the first time).
 * Only the parts the day has are offered; the quick chips choose all, or only the attendance, or only the stops. The
 * filters of the report (day, shift, room, line, code, lot) still decide what each part holds.
 */
let partsKept: Part[] | null = null
function PartsDialog({ k, mode, onClose, onGo }: { k: Kit; mode: 'xlsx' | 'pdf' | 'send'; onClose: () => void; onGo: (parts: Set<Part>) => void }) {
  const { rep, mgr, only } = k
  const offered: { p: Part; label: string; sub: string }[] = [
    { p: 'resumen', label: tr('Resumen y corridas'), sub: tr('lo hecho por cuarto y turno, cada código en su línea') },
    ...(rep.byCode.length ? [{ p: 'codigo' as const, label: tr('Por código y lote'), sub: tr('cuánto de cada código y lote') }] : []),
    ...(k.s.attView.on || k.admin ? [{ p: 'asistencia' as const, label: tr('Asistencia'), sub: tr('esperados, vinieron y % de faltas (en Excel, con su gráfica y los nombres)') }] : []),
    ...(rep.stops.length ? [{ p: 'paros' as const, label: tr('Paros'), sub: tr('cada paro con su razón y duración') }] : []),
    ...(rep.unitRows.length ? [{ p: 'unidades' as const, label: tr('Detalle por unidad'), sub: tr('cada carro, mezcla, bin o pallet con su hora') }] : []),
    ...(rep.pallets.length ? [{ p: 'pallets' as const, label: tr('Pallets'), sub: tr('cada pallet con sus lotes, tags y PO') }] : []),
    ...(rep.bins.length ? [{ p: 'bins' as const, label: tr('Bins'), sub: tr('cada bin de Packing') }] : []),
    ...(mgr && !only && !rep.filtered ? [{ p: 'avance' as const, label: tr('Avance'), sub: tr('el avance del día, como la hoja de la oficina') }] : []),
    ...(mgr && mode !== 'pdf' ? [{ p: 'cambios' as const, label: tr('Cambios'), sub: tr('correcciones y cambios del día') }] : []),
  ]
  const [on, setOn] = useState<Set<Part>>(() => new Set((partsKept ?? offered.map((x) => x.p)).filter((p) => offered.some((x) => x.p === p))))
  const flip = (p: Part) => setOn((cur) => { const n = new Set(cur); if (n.has(p)) n.delete(p); else n.add(p); return n })
  const only1 = (p: Part) => setOn(new Set([p]))
  const go = () => { partsKept = [...on]; onGo(on) }
  return (
    <div className="veil rc-veil" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{mode === 'xlsx' ? tr('¿Qué incluir en el Excel?') : mode === 'pdf' ? tr('¿Qué incluir en el PDF?') : tr('¿Qué incluir en lo que se envía?')}</h3>
        <div className="chips">
          <button type="button" className="chip" onClick={() => setOn(new Set(offered.map((x) => x.p)))}>{tr('Todo')}</button>
          {(k.s.attView.on || k.admin) && <button type="button" className="chip" onClick={() => only1('asistencia')}>{tr('Solo asistencia')}</button>}
          {rep.stops.length > 0 && <button type="button" className="chip" onClick={() => only1('paros')}>{tr('Solo paros')}</button>}
          <button type="button" className="chip" onClick={() => setOn(new Set())}>{tr('Nada')}</button>
        </div>
        <div className="parts">
          {offered.map((x) => (
            <label key={x.p} className={'part' + (on.has(x.p) ? ' on' : '')}>
              <input type="checkbox" checked={on.has(x.p)} onChange={() => flip(x.p)} />
              <span><b>{x.label}</b><small>{x.sub}</small></span>
            </label>
          ))}
        </div>
        <p className="hint">{tr('Lo que salga sigue los filtros de arriba: el día, el turno, el cuarto, la línea, el código y el lote.')}</p>
        <div className="dbtns">
          <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
          <button type="button" className="btn primary" disabled={!on.size} onClick={go}>{mode === 'xlsx' ? tr('⬇ Descargar Excel') : mode === 'pdf' ? tr('📄 Hacer el PDF') : tr('✉ Preparar para enviar')}</button>
        </div>
      </div>
    </div>
  )
}

/**
 * Asistencia (Santiago, 2026-10-20): each room's people expected, those who came and the % missing, as his sheet, with
 * a bar of the % for each room (red from a quarter up), the total, and each room's names a tap away. The shift in
 * view, or the day's shifts added up; the room in view, or every room
 */
function AttendanceWhere({ k }: { k: Kit }) {
  const { s, rep, date, dept, only } = k
  const [names, setNames] = useState<Dept | ''>('')
  const rooms = dept ? [dept] : only ? [only] : DEPTS, a = attendanceOf(s, date, rep.shift, rooms)
  const people = (d: Dept) => (rep.shift ? [rep.shift] : attShifts(s, date)).flatMap((x) => attOf(s, date, d, x))
  return (
    <>
      <h3>{tr('Asistencia')}{rep.shift ? ' · ' + tr('Turno {0}', rep.shift) : ''}</h3>
      <div className="att-rep">
        <div className="att-row head"><span>{tr('Cuarto')}</span><span>{tr('Esperados')}</span><span>{tr('Vinieron')}</span><span>{tr('% Falta')}</span><span className="att-barcol" /></div>
        {a.rows.map((r) => (
          <Fragment key={r.dept}>
            <div className="att-row" style={deptVars(r.dept)}>
              <span><button type="button" className="drill" onClick={() => setNames(names === r.dept ? '' : r.dept)}>{DEPT_LOOK[r.dept].emoji} {r.dept}</button></span>
              <span>{r.expected}</span><span>{r.actual}</span><b className={r.pct >= 0.25 ? 'red' : r.miss ? 'amber' : 'ok'}>{pctText(r.pct)}</b>
              <span className="att-barcol"><i className={r.pct >= 0.25 ? 'red' : ''} style={{ width: Math.round(r.pct * 100) + '%' }} /></span>
            </div>
            {names === r.dept && <div className="att-names">{people(r.dept).length ? people(r.dept).map((x) => <span key={x.id} className={x.gone ? 'gone' : ''}>{x.name}{x.gone && <small> · {x.gone.why === 'casa' ? tr('se fue a su casa') : tr('pasó a {0}', x.gone.to || tr('otro cuarto'))}</small>}</span>) : <i>{tr('Nadie anotado.')}</i>}</div>}
          </Fragment>
        ))}
        <div className="att-row total"><b>{tr('TOTAL')}</b><b>{a.total.expected}</b><b>{a.total.actual}</b><b>{pctText(a.total.pct)}</b><span className="att-barcol"><i style={{ width: Math.round(a.total.pct * 100) + '%' }} /></span></div>
      </div>
      <p className="hint">{tr('Toca un cuarto para ver sus nombres. En el Excel va esta tabla con su gráfica y la lista de personas.')}</p>
    </>
  )
}

/**
 * "¿Dónde están los paros?" (Jose, 2026-10-20: "que sea sencillo de ver dónde están los paros de cada departamento y
 * líneas ... dar click ahí para que nos dé más detalle"): each room with its stops (Set up apart, as in Parado), and
 * under it each line, the longest first, with its two longest causes. Every number opens the stops behind it in
 * Registros › Paros (the room's, the line's, or the line's of that cause), and each stop there has "Ver", its sheet.
 * It sums the stops as Registros lists them (the whole stop), not the Parado of the cards (only while a code was on).
 */
function StopsWhere({ k }: { k: Kit }) {
  const { s, stops, go, lineName } = k
  const down = stops.filter((x) => x.reason !== SETUP && x.ms > 0)
  if (!down.length) return null
  type Line = { lineId: string | null; name: string; ms: number; n: number; causes: Map<string, number> }
  const rooms = DEPTS.map((d) => {
    const mine = down.filter((x) => x.dept === d), lines = new Map<string, Line>()
    for (const x of mine) {
      const key = x.lineId ?? '*', e = lines.get(key) ?? { lineId: x.lineId, name: lineName(x), ms: 0, n: 0, causes: new Map<string, number>() }
      e.ms += x.ms; e.n++; e.causes.set(x.reason, (e.causes.get(x.reason) ?? 0) + x.ms); lines.set(key, e)
    }
    return { dept: d, ms: mine.reduce((t, x) => t + x.ms, 0), n: mine.length, lines: [...lines.values()].sort((a, b) => b.ms - a.ms) }
  }).filter((r) => r.n > 0).sort((a, b) => b.ms - a.ms)
  const nText = (n: number) => (n === 1 ? tr('1 paro') : tr('{0} paros', n))
  // (a stop of the whole room has no line to filter by: it opens the room's stops)
  const toLine = (d: Dept, l: Line, cause = '!setup') => go('rec', { rec: 'stops', dept: d, line: l.lineId ?? '', cause })
  return (
    <>
      <h3>{tr('¿Dónde están los paros?')}</h3>
      <div className="rp-where">
        {rooms.map((r) => (
          <div key={r.dept} className="rp-where-room" style={deptVars(r.dept)}>
            <div className="rp-where-head"><DeptBadge d={r.dept} /><button type="button" className="drill red" onClick={() => go('rec', { rec: 'stops', dept: r.dept, cause: '!setup' })}>{fmtDur(r.ms)}</button><small>{nText(r.n)}</small></div>
            {r.lines.map((l) => (
              <div key={l.lineId ?? '*'} className="rp-where-line">
                <button type="button" className="drill" onClick={() => toLine(r.dept, l)}>{l.name}</button>
                <b className="red">{fmtDur(l.ms)}</b><small>{nText(l.n)}</small>
                <div className="rp-where-causes">{[...l.causes].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c, ms]) => <button key={c} type="button" className="drill" onClick={() => toLine(r.dept, l, c)}>{reasonText(s, c)} · {fmtDur(ms)}</button>)}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="hint">{tr('Toca un número para ver esos paros; en cada paro, "Ver" da todo su detalle.')}</p>
    </>
  )
}

/**
 * The sheet of one stop, to investigate it (Jose, 2026-10-20: "saber qué es lo que hay que solucionar según el paro"):
 * where and when, its cause with its code (what the code means, planned or not), the detail typed, who registered it,
 * what the line was making then (its code and lot, which opens that run), every change made to it, and the other
 * stops of that line the same day (each opens its own sheet). Read from the store, as the run's sheet.
 */
function StopSheet({ k, id, onClose }: { k: Kit; id: string; onClose: () => void }) {
  const { s, now, stops, lineName, spanOf, fix, setEditStop, setDetail, can } = k
  const x = s.stops.find((y) => y.id === id && !y.deleted)
  if (!x) return null
  const ms = stops.find((y) => y.id === id)?.ms ?? (x.endedAt ?? now) - x.startedAt
  const c = x.reason === SETUP ? undefined : reasonCodeOf(x.reason)
  const run = x.lineId === null ? undefined : s.runs.find((r) => !r.deleted && r.lineId === x.lineId && r.startedAt <= x.startedAt && (r.endedAt ?? now) > x.startedAt)
  const changes = s.changes.filter((y) => !y.deleted && y.refTable === 'act_stops' && y.refKey === x.id).sort((a, b) => a.at - b.at)
  const others = stops.filter((y) => y.id !== x.id && y.dept === x.dept && y.lineId === x.lineId)
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg wide" onClick={(e) => e.stopPropagation()}>
        <h3>{tr('Detalle del paro')}</h3>
        <p><DeptBadge d={x.dept} /> <b>{lineName(x)}</b></p>
        <div className="setfacts">
          <Fact label={tr('Razón')} value={reasonText(s, x.reason)} cls={x.reason === SETUP ? 'amber' : 'red'} />
          <Fact label={tr('Duración')} value={fmtDur(ms)} />
          <Fact label={tr('Inicio')} value={fmtTime(x.startedAt)} />
          <Fact label={tr('Fin')} value={x.endedAt ? fmtTime(x.endedAt) : tr('en curso')} />
          <Fact label={tr('Turno')} value={spanOf(x)} />
          <Fact label={tr('Registró')} value={x.by || '—'} />
        </div>
        {c && <p className="rc-chosen"><b>{c.code}</b>{' · ' + codeLabel(c)} <small>{(c.planned ? tr('Planeado') : tr('No planeado')) + ' · ' + FAMILY_SHOWN[c.family]()}</small><br /><small>{tr(c.def)}</small></p>}
        <p><b>{tr('Detalle')}:</b> {noteLabel(x.note) || <i>{tr('sin detalle')}</i>}</p>
        {run && <p>{tr('La línea estaba haciendo')} <button type="button" className="drill code" onClick={() => { onClose(); setDetail({ runId: run.id }) }}>{run.code}{run.lot ? ' · ' + tr('lote {0}', run.lot) : ''}</button></p>}
        {changes.length > 0 && (
          <>
            <h4>{tr('Cambios a este paro')}</h4>
            <ul className="rp-stop-changes">{changes.map((y) => <li key={y.id}>{fmtTime(y.at)} · {y.by}: {y.what}{y.before ? ' · ' + y.before : ''}{' → '}<b>{y.after || '—'}</b></li>)}</ul>
          </>
        )}
        {others.length > 0 && (
          <>
            <h4>{tr('Otros paros de esta línea este día')}</h4>
            <ul className="rp-stop-others">{others.map((y) => <li key={y.id}><button type="button" className="drill" onClick={() => k.setStopSheet(y.id)}>{fmtTime(y.startedAt)} · {reasonText(s, y.reason)}</button> <span>{fmtDur(y.ms)}</span></li>)}</ul>
          </>
        )}
        <div className="dbtns">
          {can('fix') && fix(spanOf(x), x.dept) && <button type="button" className="btn soft" onClick={() => { onClose(); setEditStop(x.id) }}>{tr('✎ Corregir')}</button>}
          <button type="button" className="btn primary" onClick={onClose}>{tr('Cerrar')}</button>
        </div>
      </div>
    </div>
  )
}

/**
 * The stops by Reason Code (Jose, 2026-10-20): while the codes are on, or when the day in view has coded stops. A
 * Pareto, the most time first: each code with its reason, how many stops and how long (the Parado by cause and the Set
 * up, PLN-03); then planned against not planned and each OEE family. A stop of before the codes is "Sin código". Each
 * code opens its stops. On a phone the time and its % go under the reason (the table would hide them past the edge,
 * and the time is what it is sorted by).
 */
function CodePareto({ k }: { k: Kit }) {
  const { rep, go } = k
  const p = paretoOf(rep)
  if (!p.rows.length) return null
  const top = p.rows[0].ms || 1, pct = (ms: number) => (p.total > 0 ? Math.round((ms / p.total) * 100) + '%' : '')
  return (
    <>
      <h3>{tr('Paros por código (Reason Codes)')}</h3>
      <div className="rc-totals">
        <span className="rc-tot rc-planned"><small>{tr('Planeado')}</small><b>{fmtDur(p.planned)}</b><i>{pct(p.planned)}</i></span>
        <span className="rc-tot rc-unplanned"><small>{tr('No planeado')}</small><b>{fmtDur(p.unplanned)}</b><i>{pct(p.unplanned)}</i></span>
        {p.uncoded > 0 && <span className="rc-tot none"><small>{tr('Sin código')}</small><b>{fmtDur(p.uncoded)}</b><i>{pct(p.uncoded)}</i></span>}
        {p.families.map((f) => <span key={f.family} className="rc-tot fam"><small>{FAMILY_SHOWN[f.family]()}</small><b>{fmtDur(f.ms)}</b><i>{pct(f.ms)}</i></span>)}
      </div>
      <div className="twrap">
        <table className="rc-pareto">
          <thead><tr><th>{tr('Código')}</th><th>{tr('Razón')}</th><th>{tr('Veces')}</th><th className="rc-wide">{tr('Tiempo')}</th><th className="rc-wide">%</th></tr></thead>
          <tbody>{p.rows.map((r) => {
            const c = r.code ? reasonCodeOf(r.reason) : undefined
            const bar = <i style={{ width: Math.max(2, Math.round((r.ms / top) * 100)) + '%' }} />
            return (
              <tr key={r.code || '-'} className={r.planned ? 'planned' : ''}>
                <td><b>{r.code || '—'}</b>{r.planned && <span className="rc-tag rc-planned">{tr('Planeado')}</span>}</td>
                <td>{c ? <button type="button" className="drill" onClick={() => go('rec', { rec: 'stops', cause: r.reason })}>{codeLabel(c)}</button> : tr('Sin código')}<small className="rc-narrow">{fmtDur(r.ms) + (pct(r.ms) && ' · ' + pct(r.ms))}</small><div className="rbar rc-narrow">{bar}</div></td>
                <td>{r.times}</td>
                <td className="rc-wide">{fmtDur(r.ms)}<div className="rbar">{bar}</div></td>
                <td className="rc-wide">{pct(r.ms)}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
    </>
  )
}

/** one room on General: what it made, big, in its own unit, and every number a way to the records behind it */
function RoomCard({ k, d }: { k: Kit; d: ReportData['byDept'][number] }) {
  const { s, rep, go, dept, only, addIn, setAddFor, unitsText, binsN, shiftCols } = k
  const cfg = CFG[d.dept], q = cfg.qty !== 'none', b = rep.byShift.find((x) => x.dept === d.dept)
  // a room that only filled bins (no pallets, no carts): its first kind is its big number, the others are tags
  const first = d.units === 0 && d.bins.length ? d.bins[0] : null
  const kinds = first ? d.bins.slice(1) : d.bins
  const kc = (word: string) => (d.dept === 'Packing' ? 'c-indigo' : kindClass(d.dept, word))
  const kindLabel = (word: string) => (d.dept === 'Packing' ? tr('en bins') : apartLabel(d.dept, word))
  const kindCount = (n: number) => (d.dept === 'Spiral' ? unitsText(d.dept, n) : binsN(n))
  const toUnits = () => go('rec', { rec: 'units', dept: d.dept })
  const toRuns = () => go('rec', { rec: 'runs', dept: d.dept })
  const toKind = () => (d.dept === 'Packing' ? go('pal', { pal: 'bins', dept: 'Packing' }) : toUnits())
  return (
    <article className="rp-card" style={deptVars(d.dept)}>
      <div className="rp-card-head">
        <span className="rp-emoji" aria-hidden="true">{DEPT_LOOK[d.dept].emoji}</span>
        <div>
          <h4>{d.dept}</h4>
          <small>{rep.shift ? tr('Duración del turno {0}', rep.shift) : tr('Duración del día')} {fmtDur(d.span)}{d.from ? ' · ' + fmtTime(d.from) + ' ' + tr('a {0}', d.open ? tr('ahora') : fmtTime(d.to)) : ''} · {d.lines === 1 ? tr('1 línea') : tr('{0} líneas', d.lines)}</small>
        </div>
        {d.open && <span className="pill run">● {tr('en curso')}</span>}
      </div>
      <div className="rp-card-body">
        <button type="button" className="rp-big" onClick={first ? toKind : toUnits}>
          {first ? <>{fmtN(first.qty)} <span className={'k ' + kc(first.word)}>{apartWord(d.dept, first.word)}</span></> : <>{fmtN(q ? d.qty : d.units)} <span>{q ? cfg.qtyUnit : (d.units === 1 ? cfg.unit : cfg.plural).toLowerCase()}</span></>}
        </button>
        <div className="rp-links">
          {first && <span>{kindLabel(first.word)} · {kindCount(first.units)}</span>}
          {q && !first && <button type="button" className="drill" onClick={toUnits}>{unitsText(d.dept, d.units)}</button>}
          {q && !first && rep.code && cfg.qtyUnit === 'pouches' && casesText(inCases(s, rep.code, d.qty)) && <span>{casesText(inCases(s, rep.code, d.qty))}</span>}
          {d.waste > 0 && <button type="button" className="drill red" onClick={() => go('rec', { rec: 'runs', dept: d.dept, runChip: 'waste' })}>{'waste ' + d.waste + ' lb'}</button>}
          <button type="button" className="drill" onClick={() => go('code', { dept: d.dept })}>{d.distinct === 1 ? tr('1 código') : tr('{0} códigos', d.distinct)}</button>
          <span>{d.codes} {d.codes === 1 ? tr('corrida') : tr('corridas')}</span>
        </div>
        {kinds.length > 0 && (
          <div className="rp-kinds">
            {kinds.map((y) => <button key={y.word} type="button" className={'rp-ktag ' + kc(y.word)} onClick={toKind}><span>{kindLabel(y.word)}</span> <b>{fmtN(y.qty)} {apartWord(d.dept, y.word)}</b> <small>{kindCount(y.units)}</small></button>)}
          </div>
        )}
        {!rep.shift && b && shiftCols.length === 2 && (
          <div className="rp-shifts">
            {shiftCols.map((n) => {
              const x = n === 1 ? b.first : b.second, fb = first ? x.bins.find((z) => z.word === first.word) : null
              const val = x.codes === 0 ? '—' : first ? (fb ? fmtN(fb.qty) : '—') : fmtN(q ? x.qty : x.units)
              return (
                <button key={n} type="button" className="rp-tile" onClick={() => go('gen', { shift: n })}>
                  <span className="lab">{tr('Turno {0}', n)}</span><b>{val}</b>
                  <small>{q && !first && x.codes > 0 ? unitsText(d.dept, x.units) : ''}{x.down > 0 && <span className="red">{(q && !first && x.codes > 0 ? ' · ' : '') + '⏸ ' + fmtDur(x.down)}</span>}</small>
                </button>
              )
            })}
          </div>
        )}
        <div className="rp-times">
          <span>{tr('Trabajando')} <button type="button" className="drill" onClick={toRuns}>{fmtDur(d.working)}</button></span>
          <span>{tr('Parado')} <button type="button" className={'drill' + (d.down > 0 ? ' red' : '')} onClick={() => go('rec', { rec: 'stops', dept: d.dept, cause: '!setup' })}>{fmtDur(d.down)}</button></span>
          <span>Set up {d.setup ? <button type="button" className="drill amber" onClick={() => go('rec', { rec: 'stops', dept: d.dept, cause: SETUP })}>{fmtDur(d.setup)}</button> : '—'}</span>
        </div>
      </div>
      <div className="rp-card-foot">
        <div className="btns">
          {!dept && !only && <button type="button" className="btn sm" onClick={() => go('gen', { dept: d.dept })}>{tr('Ver solo {0}', d.dept)}</button>}
          <button type="button" className="btn sm" onClick={toRuns}>{tr('Registros') + ' ›'}</button>
        </div>
        {addIn(d.dept) && <button type="button" className="btn sm soft" onClick={() => setAddFor({ dept: d.dept })}>{tr('+ Agregar')}</button>}
      </div>
    </article>
  )
}

/** Por código: each code with its lots, the total of the code and the total of the room, as the office's Excel */
function CodesView({ k }: { k: Kit }) {
  const { s, rep, codesShown, searching, toks, shiftCols, unitsText, dash, go, setFCode, setFLot, canAdd, setAddFor, dept } = k
  const colsN = 7 + (rep.shift ? 0 : shiftCols.length)
  // with a search, a room none of whose codes answers it is left out whole
  const rooms = rep.byDept.filter((d) => !searching || codesShown.some((c) => c.dept === d.dept))
  return (
    <div className="rp-list">
      {canAdd && <div className="rp-tools"><span /><button type="button" className="btn sm soft" onClick={() => setAddFor({ dept })}>{tr('+ Agregar registro')}</button></div>}
      {searching && !codesShown.length ? <Nothing k={k} /> : (
        <div className="twrap">
          <table className="bycode">
            <thead><tr><th className="rp-code">{tr('Código')}</th><th>{tr('Lote')}</th><th className="num">{tr('Hechas')}</th><th className="num">{tr('Cantidad')}</th>{!rep.shift && shiftCols.map((n) => <th key={n} className="num">{tr('Turno {0}', n)}</th>)}<th>{tr('En cajas')}</th><th className="num">Waste</th><th>{tr('Líneas')}</th></tr></thead>
            <tbody>
              {rooms.map((d) => {
                const cfg = CFG[d.dept], q = cfg.qty !== 'none', b = rep.byShift.find((x) => x.dept === d.dept)
                const mine = codesShown.filter((c) => c.dept === d.dept)
                const boxes = (code: string, qty: number, bin = '') => (!bin && cfg.qtyUnit === 'pouches' && casesText(inCases(s, code, qty))) || '—'
                const lotBtn = (l: string) => (!l ? '—' : <>{rep.lot ? hl(l, toks) : <button type="button" className="drill" onClick={() => setFLot(l)}>{hl(l, toks)}</button>}{looksLikeTwoLots(l) && <small className="twolots-mark" title={tr('Parece dos lotes escritos juntos: se separan desde Corregir, con ✎ en el pallet, poniendo las cajas de cada lote.')}>{tr('¿dos lotes juntos?')}</small>}</>)
                // a code filled in bins speaks of bins and of what they hold (platos, copas…), not of pallets and cases
                const cc = (bin: string) => cfgFor(d.dept, bin)
                const qtyText = (v: number, bin = '') => (q ? fmtN(v) + ' ' + cc(bin).qtyUnit : '—')
                const madeN = (n: number, bin = '') => n + ' ' + (n === 1 ? cc(bin).unit : cc(bin).plural).toLowerCase()
                // What was made, tapped: exactly the records behind that number. Packing's are its pallets (or, for a code
                // filled in bins, its bins) one by one; another room's, its units in Registros, with this room chosen when
                // none is (the same code goes through several rooms in a day: Kitchen's mezclas, RTE's carts…)
                const toMade = (code: string, bin: string, lot?: string) => (d.dept === 'Packing'
                  ? go('pal', { pal: bin ? 'bins' : 'pallets', code, ...(lot ? { lot } : {}) })
                  : go('rec', { rec: 'units', code, ...(lot ? { lot } : {}), ...(!dept ? { dept: d.dept } : {}) }))
                const made = (n: number, code: string, bin: string, lot?: string) => <button type="button" className="drill" onClick={() => toMade(code, bin, lot)}>{madeN(n, bin)}</button>
                return (
                  <Fragment key={d.dept}>
                    {rep.byDept.length > 1 && <tr className="rp-dband" style={deptVars(d.dept)}><td colSpan={colsN}><DeptBadge d={d.dept} /> · {mine.length === 1 ? tr('1 código') : tr('{0} códigos', mine.length)}</td></tr>}
                    {mine.map((c) => (
                      <Fragment key={c.code + '|' + c.bin}>
                        <tr className="crow" style={deptVars(c.dept)}>
                          <td className="rp-code">{rep.code ? <b className="code">{hl(c.code, toks)}</b> : <button type="button" className="drill code" onClick={() => setFCode(c.code)}>{hl(c.code, toks)}</button>}{c.bin && <small className="binkind">{apartLabel(c.dept, c.bin)}</small>}{productOf(s, c.code) && <small className="rp-pname">{hl(productOf(s, c.code)?.name, toks)}</small>}</td>
                          <td>{c.lots.length === 1 ? lotBtn(c.lots[0].lot) : tr('{0} lotes', c.lots.length)}</td>
                          <td className="num">{made(c.units, c.code, c.bin)}</td>
                          <td className="num">{qtyText(c.qty, c.bin)}</td>
                          {c.byShift && shiftCols.map((n) => <td key={n} className="num">{dash((c.byShift as [number, number])[n - 1])}</td>)}
                          <td>{boxes(c.code, c.qty, c.bin)}</td><td className={'num' + (c.waste ? ' red' : '')}>{c.waste ? c.waste + ' lb' : '—'}</td><td>{c.lines.join(', ')}</td>
                        </tr>
                        {c.lots.length > 1 && c.lots.map((l) => (
                          <tr key={l.lot} className="lrow" style={deptVars(c.dept)}>
                            <td className="rp-code"></td><td>{lotBtn(l.lot)}</td><td className="num">{l.lot ? made(l.units, c.code, c.bin, l.lot) : madeN(l.units, c.bin)}</td><td className="num">{qtyText(l.qty, c.bin)}</td>
                            {l.byShift && shiftCols.map((n) => <td key={n} className="num">{dash((l.byShift as [number, number])[n - 1])}</td>)}
                            <td>{boxes(c.code, l.qty, c.bin)}</td><td></td><td></td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                    <tr className="trow rp-dtotal" style={deptVars(d.dept)}>
                      <td colSpan={2}>{trx('Total {0}', d.dept)}</td><td className="num">{unitsText(d.dept, d.units)}</td><td className="num">{qtyText(d.qty)}</td>
                      {b && shiftCols.map((n) => { const x = n === 1 ? b.first : b.second; return <td key={n} className="num">{dash(q ? x.qty : x.units)}</td> })}
                      <td></td><td className={'num' + (d.waste ? ' red' : '')}>{d.waste ? d.waste + ' lb' : '—'}</td><td></td>
                    </tr>
                    {d.bins.map((y) => (
                      <tr key={'bin:' + y.word} className="trow bins">
                        <td colSpan={2}><span className={'rp-ktag ' + (d.dept === 'Packing' ? 'c-indigo' : kindClass(d.dept, y.word))}>{tr('Además, {0}', apartLabel(d.dept, y.word))}</span></td><td className="num">{madeN(y.units, y.word)}</td><td className="num">{qtyText(y.qty, y.word)}</td>
                        {b && shiftCols.map((n) => { const x = n === 1 ? b.first : b.second; return <td key={n} className="num">{dash(x.bins.find((z) => z.word === y.word)?.qty ?? 0)}</td> })}
                        <td></td><td></td><td></td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Por turno: each room with the whole day and each shift side by side (with one shift chosen, that shift alone) */
function ShiftsView({ k }: { k: Kit }) {
  const { rep, shiftCols, unitsText, binsN, hrs, cap, setFShift } = k
  return (
    <>
      <h3>{rep.shift ? tr('Por departamento · Turno {0}', rep.shift) : tr('Total del día y cada turno')}</h3>
      {rep.shift > 0 && <p className="hint rp-oneshift">{tr('Con un turno elegido se ve ese turno solo.')} <button type="button" className="btn sm" onClick={() => setFShift(0)}>{tr('Ver los dos turnos')}</button></p>}
      <div className="deptgrid">
        {rep.byDept.map((d) => {
          const b = rep.byShift.find((x) => x.dept === d.dept), cols = b ? [b.day, ...shiftCols.map((n) => (n === 1 ? b.first : b.second))] : [d]
          const cfg = CFG[d.dept], q = cfg.qty !== 'none'
          const mark = (x: (typeof cols)[number]) => (b && !x.shift ? 'day' : '')
          const cell = (x: (typeof cols)[number], v: ReactNode, red = false) => <td key={x.shift} className={mark(x) + (red ? ' red' : '')}>{v}</td>
          return (
            <div key={d.dept} className="deptcard rp-d" style={deptVars(d.dept)}>
              <h4><span aria-hidden="true">{DEPT_LOOK[d.dept].emoji}</span> {d.dept}</h4>
              <div className="scroll">
                <table className="shiftgrid">
                  <thead><tr><th></th>{cols.map((x) => <th key={x.shift} className={mark(x)}>{x.shift ? <>{trx('Turno {0}', x.shift)}<small className="hrs">{hrs(x.shift)}</small></> : tr('Total del día')}</th>)}</tr></thead>
                  <tbody>
                    {q && <tr className="q"><td>{cap(cfg.qtyUnit)}</td>{cols.map((x) => cell(x, fmtN(x.qty)))}</tr>}
                    <tr className={q ? '' : 'q'}><td>{cfg.plural}</td>{cols.map((x) => cell(x, fmtN(x.units)))}</tr>
                    {[...new Set(cols.flatMap((x) => x.bins.map((y) => y.word)))].map((w) => <tr key={'bin:' + w}><td>{d.dept === 'Spiral' || w === 'lb' ? tr('En {0}', measureName(w)) : tr('Bins de {0}', binWord(w))}</td>{cols.map((x) => { const y = x.bins.find((z) => z.word === w); return cell(x, y ? (d.dept === 'Spiral' ? fmtN(y.qty) + ' ' + measureUnit(w) + ' · ' + unitsText(d.dept, y.units) : tr('{0} con {1}', binsN(y.units), fmtN(y.qty) + (w === 'lb' ? ' lb' : ''))) : '—') })}</tr>)}
                    {cols.some((x) => x.waste > 0) && <tr><td>Waste</td>{cols.map((x) => cell(x, x.waste ? x.waste + ' lb' : '—', x.waste > 0))}</tr>}
                    <tr><td>{tr('Códigos')}</td>{cols.map((x) => cell(x, x.distinct))}</tr>
                    <tr><td>{tr('Corridas')}</td>{cols.map((x) => cell(x, x.codes))}</tr>
                    <tr><td>{tr('Líneas')}</td>{cols.map((x) => cell(x, x.lines))}</tr>
                    <tr className="sep"><td colSpan={cols.length + 1}>{tr('Reloj del turno')}</td></tr>
                    <tr><td>{tr('Empezó')}</td>{cols.map((x) => cell(x, x.from ? fmtTime(x.from) : '—'))}</tr>
                    <tr><td>{tr('Terminó')}</td>{cols.map((x) => cell(x, !x.to ? '—' : x.open ? tr('en curso') : fmtTime(x.to)))}</tr>
                    <tr><td>{tr('Duración')}</td>{cols.map((x) => cell(x, x.span ? fmtDur(x.span) : '—'))}</tr>
                    <tr className="sep"><td colSpan={cols.length + 1}>{tr('Suma de las líneas')}</td></tr>
                    <tr><td>{tr('Trabajando')}</td>{cols.map((x) => cell(x, fmtDur(x.working)))}</tr>
                    <tr><td>{tr('Parado')}</td>{cols.map((x) => cell(x, fmtDur(x.down), x.down > 0))}</tr>
                    <tr><td>Set up</td>{cols.map((x) => cell(x, x.setup ? fmtDur(x.setup) : '—'))}</tr>
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

/** 📦 Pallets: Packing's pallets one by one (each with its lots, cases and tags, its total and its PO), and its bins apart */
function PalletsView({ k }: { k: Kit }) {
  const { s, rep, dept, go, searching, palletsFound, palletsShown, palCount, palF, setPalF, binsShown, palSub, setPalSub, addIn, setAddFor, acts, spanOf, setDetail, setEditRun, pageOf, pageBar, ofText, toks } = k
  if (dept && dept !== 'Packing') return <p className="hint rp-elsewhere">{tr('Los pallets y los bins son de Packing.')} <button type="button" className="btn sm" onClick={() => go('pal', { dept: 'Packing' })}>📦 {tr('Ver solo {0}', 'Packing')}</button></p>
  if (!rep.pallets.length && !rep.bins.length) return <div className="rp-list"><p className="hint">{tr('Ningún pallet ni bin en lo que estás viendo.')}</p>{addIn('Packing') && <p><button type="button" className="btn sm soft" onClick={() => setAddFor({ dept: 'Packing' })}>{tr('+ Agregar registro')}</button></p>}</div>
  // the list chosen, or the other one when it has nothing
  const sub: PalSub = palSub === 'pallets' ? (rep.pallets.length ? 'pallets' : 'bins') : rep.bins.length ? 'bins' : 'pallets'
  const subs = [{ label: tr('Pallets'), n: palletsFound.length, open: () => setPalSub('pallets') }, { label: tr('Bins'), n: binsShown.length, open: () => setPalSub('bins') }]
  const lost = searching && (sub === 'pallets' ? !palletsFound.length : !binsShown.length)
  // the comment of each pallet, in a column of its own only when one in view has it (Jose, 2026-10-18)
  const notes = palletsShown.some((p) => !!p.note)
  return (
    <div className="rp-list">
      <div className="rp-tools">
        {rep.pallets.length > 0 && rep.bins.length > 0 ? (
          <div className="seg rp-subs" role="group" aria-label={tr('Pallets')}>
            <button type="button" className={'c-green' + (sub === 'pallets' ? ' on' : '')} aria-pressed={sub === 'pallets'} onClick={() => setPalSub('pallets')}>{tr('Pallets')}<small>{palletsFound.length}</small></button>
            <button type="button" className={'c-indigo' + (sub === 'bins' ? ' on' : '')} aria-pressed={sub === 'bins'} onClick={() => setPalSub('bins')}>{tr('Bins')}<small>{binsShown.length}</small></button>
          </div>
        ) : <span />}
        {addIn('Packing') && <button type="button" className="btn sm soft" onClick={() => setAddFor({ dept: 'Packing' })}>{tr('+ Agregar registro')}</button>}
      </div>
      {lost ? <Nothing k={k} subs={subs.filter((x) => x.label !== (sub === 'pallets' ? tr('Pallets') : tr('Bins')))} /> : sub === 'pallets' ? (
        <>
          <div className="chips palfilters">
            {(['', 'notag', 'nopo', 'po', 'full', 'short', 'open'] as const).filter((f) => f === '' || palCount(f) > 0 || palF === f).map((f) => (
              <button key={f} type="button" className={'chip sm' + (palF === f ? ' on' : '')} aria-pressed={palF === f} onClick={() => setPalF(f)}>{f === '' ? tr('Todos') : f === 'notag' ? tr('Sin tag') : f === 'nopo' ? tr('Sin PO') : f === 'po' ? tr('Con PO') : f === 'full' ? tr('Completos') : f === 'short' ? tr('Incompletos') : tr('En armado')}<small>{palCount(f)}</small></button>
            ))}
          </div>
          <div className="twrap">
            <table className="pallets">
              <thead><tr><th className="rp-act"></th><th>{tr('Pallet')}</th><th>{tr('Código')}</th><th>{tr('Lote')}</th><th className="num">{tr('Cajas')}</th><th>{tr('Tag')}</th><th className="num">{tr('Total')}</th><th>PO</th><th>{tr('Línea')}</th><th>{tr('Hora')}</th>{!rep.shift && <th>{tr('Turno')}</th>}<th>{tr('Registró')}</th>{notes && <th>{tr('Comentario')}</th>}</tr></thead>
              {pageOf('pallets', palletsShown).map((p) => {
                const span = p.parts.length, unitAt = p.open ? undefined : p.at
                return (
                  <tbody key={p.r.id + ':' + p.n} className={(p.open ? 'live' : '') + (span > 1 ? ' multi' : '')}>
                    {p.parts.map((x, i) => (
                      <tr key={i}>
                        {i === 0 && acts(spanOf(p.r), p.r.dept, () => setDetail({ runId: p.r.id, at: unitAt }), () => setEditRun({ id: p.r.id, at: unitAt }), span)}
                        {i === 0 && <td rowSpan={span}><b>{hl(p.n, toks)}</b>{p.open && <small className="building">{tr('en armado')}</small>}{span > 1 && <small className="manylots">{trx('{0} lotes', span)}</small>}</td>}
                        {i === 0 && <td rowSpan={span}><b className="code">{hl(p.r.code, toks)}</b></td>}
                        <td className={(rep.lot && x.lot === rep.lot ? 'hit' : '') + (span > 1 ? ' part' : '')}>{span > 1 && <small className="lotno">{tr('lote {0} de {1}', i + 1, span)}</small>}{hl(x.lot, toks)}{looksLikeTwoLots(x.lot) && <small className="twolots-mark" title={tr('Parece dos lotes escritos juntos: se separan desde Corregir, con ✎ en el pallet, poniendo las cajas de cada lote.')}>{tr('¿dos lotes juntos?')}</small>}</td>
                        <td className="num">{x.qty != null ? fmtN(x.qty) : '—'}</td>
                        <td>{x.tag ? hl(x.tag, toks) : <span className="notag">{tr('sin tag')}</span>}</td>
                        {i === 0 && <td rowSpan={span} className="num"><b>{fmtN(p.total)}</b></td>}
                        {i === 0 && <td rowSpan={span}>{p.order ? <>{hl(p.order, toks)}{p.of && <b className="pof">{ofText(p.of)}</b>}</> : '—'}</td>}
                        {i === 0 && <td rowSpan={span}>{hl(lineNameOf(s, p.r.lineId, p.r.line), toks)}</td>}
                        {i === 0 && <td rowSpan={span}>{p.open ? '—' : hl(fmtTime(p.at), toks)}</td>}
                        {i === 0 && !rep.shift && <td rowSpan={span}>{p.shift}</td>}
                        {i === 0 && <td rowSpan={span}>{p.by ? hl(p.by, toks) : '—'}</td>}
                        {i === 0 && notes && <td rowSpan={span} className="rp-note unote">{p.note ? <>💬 {hl(p.note, toks)}</> : '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                )
              })}
            </table>
          </div>
          {palletsShown.length === 0 && <p className="hint">{tr('Ningún pallet de este día está así.')}</p>}
          {palletsShown.some((p) => p.parts.some((x) => looksLikeTwoLots(x.lot))) && <p className="hint">{tr('Un lote escrito como "6168-6216" parece dos lotes en uno, y así sus cajas no se pueden repartir entre los dos. Se separa desde Corregir, con ✎ en ese pallet, poniendo las cajas de cada lote. En la línea, un pallet con dos lotes se registra con "➕ Otro lote en este pallet".')}</p>}
          {pageBar('pallets', palletsShown.length)}
        </>
      ) : (
        <>
          {/* Packing's bins one by one, apart from its pallets and in the colour of the bin cards */}
          <div className="twrap">
            <table className="pallets binlist">
              <thead><tr><th className="rp-act"></th><th>{tr('Bin')}</th><th>{tr('Código')}</th><th>{tr('Lote')}</th><th className="num">{tr('Cantidad')}</th><th>{tr('N° de bin')}</th><th>{tr('Línea')}</th><th>{tr('Hora')}</th>{!rep.shift && <th>{tr('Turno')}</th>}<th>{tr('Registró')}</th></tr></thead>
              <tbody>
                {pageOf('bins', binsShown).map((b) => (
                  <tr key={b.r.id + ':' + b.n}>
                    {acts(spanOf(b.r), b.r.dept, () => setDetail({ runId: b.r.id, at: b.at }), () => setEditRun({ id: b.r.id, at: b.at }))}
                    <td><b>{hl(b.n, toks)}</b></td>
                    <td><b className="code">{hl(b.r.code, toks)}</b><small className="binkind">{binWord(b.word)}</small></td>
                    <td className={rep.lot && b.lot === rep.lot ? 'hit' : ''}>{b.lot ? hl(b.lot, toks) : '—'}</td>
                    <td className="num"><b>{b.qty != null ? fmtN(b.qty) : '—'}</b> {binWord(b.word)}</td>
                    <td>{b.ref ? hl(b.ref, toks) : '—'}</td>
                    <td>{hl(lineNameOf(s, b.r.lineId, b.r.line), toks)}</td>
                    <td>{hl(fmtTime(b.at), toks)}</td>
                    {!rep.shift && <td>{b.shift}</td>}
                    <td>{b.by ? hl(b.by, toks) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pageBar('bins', binsShown.length)}
        </>
      )}
    </div>
  )
}

/** Registros: every run, every unit and every stop, each with what sees it and corrects it, and the way to add one */
function RecordsView({ k }: { k: Kit }) {
  const { only, dept, rows, recSub, setRecSub, runsFound, unitsShown, stopsFound, searching, canAdd, setAddFor } = k
  const unitsWord = dept ? CFG[dept].plural : tr('Unidades')
  const subs: { key: RecSub; label: string; n: number }[] = [{ key: 'runs', label: tr('Corridas'), n: runsFound.length }, { key: 'units', label: unitsWord, n: unitsShown.length }, { key: 'stops', label: tr('Paros'), n: stopsFound.length }]
  // with no code in view there are no runs nor units: the stops are all there is, and the list opens on them
  const sub: RecSub = rows.length ? recSub : 'stops'
  const lost = searching && (subs.find((x) => x.key === sub)?.n ?? 0) === 0
  return (
    <div className="rp-list">
      <div className="rp-tools">
        <div className="seg rp-subs" role="group" aria-label={tr('Registros')}>
          {subs.map((x) => <button key={x.key} type="button" className={sub === x.key ? 'on' : ''} aria-pressed={sub === x.key} disabled={!rows.length && x.key !== 'stops'} onClick={() => setRecSub(x.key)}>{x.label}<small>{x.n}</small></button>)}
        </div>
        {canAdd && <button type="button" className="btn sm soft" onClick={() => setAddFor({ dept: only ?? dept })}>{tr('+ Agregar registro')}</button>}
      </div>
      {lost ? <Nothing k={k} subs={subs.filter((x) => x.key !== sub).map((x) => ({ label: x.label, n: x.n, open: () => setRecSub(x.key) }))} />
        : sub === 'runs' ? <RunsTable k={k} /> : sub === 'units' ? <UnitsTable k={k} /> : <StopsTable k={k} />}
    </div>
  )
}

/** the quick chips over a list: each with its count; one with nothing is hidden unless it is the one chosen */
function QuickChips<T extends string>({ items, on, onPick }: { items: { key: T; label: string; n: number; cls?: string }[]; on: T; onPick: (x: T) => void }) {
  return (
    <div className="chips palfilters">
      {items.filter((x, i) => i === 0 || x.n > 0 || x.key === on).map((x) => <button key={x.key} type="button" className={'chip sm' + (x.cls ? ' ' + x.cls : '') + (on === x.key ? ' on' : '')} aria-pressed={on === x.key} onClick={() => onPick(x.key)}>{x.label}<small>{x.n}</small></button>)}
    </div>
  )
}

/** Registros › Corridas: a code on a line from its start to its end */
function RunsTable({ k }: { k: Kit }) {
  const { s, rep, runsFound, runsShown, runIs, runChip, setRunChip, manyRooms, acts, setDetail, setEditRun, pageOf, pageBar, reasonsText, toks } = k
  const c = (x: '' | 'live' | 'waste') => runsFound.filter((y) => runIs(y, x)).length
  // the comments of the records (Jose, 2026-10-18): a column of their own, last, while a run in view has one
  const notes = runsShown.some((x) => !!noteOf(x.r))
  return (
    <>
      <QuickChips items={[{ key: '' as const, label: tr('Todas'), n: c('') }, { key: 'live' as const, label: tr('En curso'), n: c('live') }, { key: 'waste' as const, label: tr('Con waste'), n: c('waste') }]} on={runChip} onPick={setRunChip} />
      {!runsShown.length ? <p className="hint">{tr('Nada registrado con estos filtros.')}</p> : <div className="twrap rp-cardlist">
        <table>
          <thead><tr><th className="rp-act"></th>{manyRooms && <th>{tr('Depto')}</th>}<th>{tr('Línea')}</th><th>{tr('Código')}</th><th>{tr('Lote')}</th>{!rep.shift && <th>{tr('Turno')}</th>}<th>{tr('Inicio')}</th><th>{tr('Fin')}</th><th>{tr('Hecho')}</th><th>Waste</th><th>{tr('Trabajando')}</th><th>{tr('Prom./unidad')}</th><th>{tr('Parado')}</th><th>Set up</th><th>{tr('Razones')}</th><th>{tr('Registró')}</th>{notes && <th>{tr('Comentario')}</th>}</tr></thead>
          <tbody>{pageOf('runs', runsShown).map((x) => {
            const product = productOf(s, x.r.code)?.name, waste = x.waste ? x.waste + ' lb' : '—', avg = x.timed ? fmtDur(x.st.avg) : '—', set = x.st.setup ? fmtDur(x.st.setup) : '—', why = reasonsText(x) || '—'
            return (
              <tr key={x.r.id} className={x.r.endedAt ? '' : 'live'} style={deptVars(x.r.dept)}>
                {acts(x.shifts, x.r.dept, () => setDetail({ runId: x.r.id }), () => setEditRun({ id: x.r.id }))}
                {manyRooms && <td className="c-head"><DeptBadge d={x.r.dept} /></td>}
                <td data-label={tr('Línea')}>{hl(lineNameOf(s, x.r.lineId, x.r.line), toks)}</td>
                <td data-label={tr('Código')} className={manyRooms ? undefined : 'c-head'}><b>{hl(x.r.code, toks)}</b>{product && <small className="rp-pname">{hl(product, toks)}</small>}</td>
                <td data-label={tr('Lote')} className={none(x.lots || '—')}>{x.lots ? hl(x.lots, toks) : '—'}</td>
                {!rep.shift && <td data-label={tr('Turno')}>{x.shifts}</td>}
                <td data-label={tr('Inicio')}>{hl(fmtTime(x.r.startedAt), toks)}</td>
                <td data-label={tr('Fin')}>{x.r.endedAt ? fmtTime(x.r.endedAt) : <i>{tr('en curso')}</i>}</td>
                <td data-label={tr('Hecho')}>{madeText(x.view, x.qty, true)}</td>
                <td data-label="Waste" className={(x.waste ? 'red' : '') + (none(waste) ? ' c-none' : '')}>{waste}</td>
                <td data-label={tr('Trabajando')}>{fmtDur(x.st.working)}</td>
                <td data-label={tr('Prom./unidad')} className={none(avg)}>{avg}</td>
                <td data-label={tr('Parado')} className={x.st.down ? 'red' : ''}>{fmtDur(x.st.down)}</td>
                <td data-label="Set up" className={(x.st.setup ? 'amber' : '') + (none(set) ? ' c-none' : '')}>{set}</td>
                <td data-label={tr('Razones')} className={none(why)}>{why === '—' ? why : hl(why, toks)}</td>
                <td data-label={tr('Registró')}>{hl(whoText(x.r), toks)}</td>
                {notes && <td data-label={tr('Comentario')} className={'rp-note' + (noteOf(x.r) ? '' : ' c-none')}>{noteOf(x.r) ? hl(noteOf(x.r), toks) : '—'}</td>}
              </tr>
            )
          })}</tbody>
        </table>
      </div>}
      {pageBar('runs', runsShown.length)}
    </>
  )
}

/** Registros › Unidades: every unit recorded (a pallet with two lots, one row for each lot) */
function UnitsTable({ k }: { k: Kit }) {
  const { s, rep, unitsShown, withOrders, manyRooms, acts, spanOf, setDetail, setEditRun, pageOf, pageBar, toks } = k
  const notes = unitsShown.some((x) => !!x.u.note) // (a unit's comment, Jose 2026-10-18: a column only when one has it)
  return (
    <>
      {!unitsShown.length ? <p className="hint">{tr('Nada registrado con estos filtros.')}</p> : <div className="twrap rp-cardlist">
        <table>
          <thead><tr><th className="rp-act"></th><th>{tr('Hora')}</th>{!rep.shift && <th>{tr('Turno')}</th>}{manyRooms && <th>{tr('Depto')}</th>}<th>{tr('Línea')}</th><th>{tr('Código')}</th><th>{tr('Lote')}</th><th>#</th><th>{tr('Unidad')}</th><th>{tr('Cantidad')}</th><th>{tr('Tag / bin')}</th>{withOrders && <th>{tr('Pedido')}</th>}<th>{tr('Desde la anterior')}</th><th>{tr('Registró')}</th>{notes && <th>{tr('Comentario')}</th>}</tr></thead>
          <tbody>{pageOf('units', unitsShown).map((x) => (
            <tr key={x.r.id + ':' + x.i + ':' + x.lot} style={deptVars(x.r.dept)}>
              {acts(spanOf(x.r), x.r.dept, () => setDetail({ runId: x.r.id, at: x.u.at }), () => setEditRun({ id: x.r.id, at: x.u.at }))}
              <td data-label={tr('Hora')}>{hl(fmtTime(x.u.at), toks)}</td>{!rep.shift && <td data-label={tr('Turno')}>{x.shift}</td>}
              {manyRooms && <td className="c-head"><DeptBadge d={x.r.dept} /></td>}
              <td data-label={tr('Línea')}>{hl(lineNameOf(s, x.r.lineId, x.r.line), toks)}</td>
              <td data-label={tr('Código')} className={manyRooms ? undefined : 'c-head'}><b>{hl(x.r.code, toks)}</b></td>
              <td data-label={tr('Lote')} className={none(x.lot || '—')}>{x.lot ? hl(x.lot, toks) : '—'}</td>
              <td data-label="#">{x.i + 1}</td>
              <td data-label={tr('Unidad')}>{cfgOf(x.r).unit}</td>
              <td data-label={tr('Cantidad')} className={none(x.qty != null ? '' : '—')}>{x.qty != null ? x.qty + ' ' + cfgOf(x.r).qtyUnit : '—'}{x.qty != null && CFG[x.r.dept].qtyUnit === 'pouches' && x.r.perUnit != null && x.qty < x.r.perUnit && !!inCases(s, x.r.code, x.qty) && <small> · {casesText(inCases(s, x.r.code, x.qty))}</small>}</td>
              <td data-label={tr('Tag / bin')} className={none(x.tag || '—')}>{x.tag ? hl(x.tag, toks) : '—'}</td>
              {withOrders && <td data-label={tr('Pedido')} className={none(x.order || '—')}>{x.order ? hl(x.order, toks) : '—'}</td>}
              <td data-label={tr('Desde la anterior')}>{fmtDur(x.gap)}</td>
              <td data-label={tr('Registró')} className={none(x.u.by || '—')}>{x.u.by ? hl(x.u.by, toks) : '—'}</td>
              {notes && <td data-label={tr('Comentario')} className={'rp-note unote' + (x.u.note ? '' : ' c-none')}>{x.u.note ? <>💬 {hl(x.u.note, toks)}</> : '—'}</td>}
            </tr>
          ))}</tbody>
        </table>
      </div>}
      {pageBar('units', unitsShown.length)}
    </>
  )
}

/** Registros › Paros: each stop whole, with its cause chips (every stop, the stopped time but Set up, Set up, each cause) */
function StopsTable({ k }: { k: Kit }) {
  const { can, stops, stopsFound, stopsShown, stopIs, cause, setCause, manyRooms, fixBtn, spanOf, setEditStop, pageOf, pageBar, lineName, toks } = k
  const c = (x: string) => stopsFound.filter((y) => stopIs(y, x)).length
  // the causes of the stops in view, the longest first (and the one chosen, when a drill brought one that has none here)
  const causes = [...stops.filter((x) => x.reason !== SETUP).reduce((m, x) => m.set(x.reason, (m.get(x.reason) ?? 0) + x.ms), new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([r]) => r)
  const chosen = cause && cause !== '!setup' && cause !== SETUP && !causes.includes(cause) ? [cause] : []
  return (
    <>
      <QuickChips items={[{ key: '', label: tr('Todos'), n: c('') }, { key: '!setup', label: tr('Parado'), n: c('!setup') }, { key: SETUP, label: 'Set up', n: c(SETUP), cls: 'setupchip' }, ...[...causes, ...chosen].map((r) => ({ key: r, label: reasonText(k.s, r), n: c(r) }))]} on={cause} onPick={setCause} />
      {!stopsShown.length ? <p className="hint">{tr('Nada registrado con estos filtros.')}</p> : <div className="twrap rp-cardlist">
        <table>
          <thead><tr><th className="rp-act"></th>{manyRooms && <th>{tr('Depto')}</th>}<th>{tr('Línea')}</th><th>{tr('Razón')}</th><th>{tr('Detalle')}</th><th>{tr('Turno')}</th><th>{tr('Inicio')}</th><th>{tr('Fin')}</th><th>{tr('Duración')}</th><th>{tr('Registró')}</th></tr></thead>
          <tbody>{pageOf('stops', stopsShown).map((x) => {
            const note = noteLabel(x.note) || '—'
            return (
              <tr key={x.id} className={x.endedAt ? '' : 'live'} style={deptVars(x.dept)}>
                <td className="rp-act"><div className="btns">{k.seeBtn(() => k.setStopSheet(x.id))}{can('fix') && fixBtn(spanOf(x), x.dept, () => setEditStop(x.id))}</div></td>
                {manyRooms && <td className="c-head"><DeptBadge d={x.dept} /></td>}
                <td data-label={tr('Línea')}>{hl(lineName(x), toks)}</td>
                <td data-label={tr('Razón')} className={manyRooms ? undefined : 'c-head'}><b>{hl(reasonText(k.s, x.reason), toks)}</b></td>
                <td data-label={tr('Detalle')} className={none(note)}>{note === '—' ? note : hl(note, toks)}</td>
                <td data-label={tr('Turno')}>{spanOf(x)}</td>
                <td data-label={tr('Inicio')}>{hl(fmtTime(x.startedAt), toks)}</td>
                <td data-label={tr('Fin')}>{x.endedAt ? fmtTime(x.endedAt) : <i>{tr('en curso')}</i>}</td>
                <td data-label={tr('Duración')}>{fmtDur(x.ms)}</td>
                <td data-label={tr('Registró')}>{hl(x.by, toks)}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>}
      <p className="hint">{STOPS_NOTE()}</p>
      {pageBar('stops', stopsShown.length)}
    </>
  )
}

/** Cambios: who corrected or changed what, and when (the manager's and the office's), with the admin's day tools */
function ChangesView({ k }: { k: Kit }) {
  const { s, rep, now, admin, viewOnly, runs, stops, changes, changesShown, searching, go, setDetail, setEditStop, fix, pageOf, pageBar, toks, setWiping } = k
  return (
    <div className="rp-list">
      <h3>{tr('Cambios y correcciones')} · {changes.length}</h3>
      {rep.filtered ? (
        // the screen follows the same rule as the files: changes are the whole day's (of the room in view)
        <p className="hint rp-oneshift">{tr('Los cambios se ven con el día completo, sin línea, código ni lote.')} <button type="button" className="btn sm" onClick={() => go('chg', { shift: 0, line: '', code: '', lot: '' })}>{tr('Ver el día completo')}</button></p>
      ) : searching && !changesShown.length && changes.length ? <Nothing k={k} /> : !changes.length ? <p className="hint">{tr('Nada cambiado ni corregido este día.')}</p> : (
        <>
          <div className="twrap rp-cardlist">
            <table className="changes">
              <thead><tr><th>{tr('Hora')}</th><th>{tr('Quién')}</th><th>{tr('Depto')}</th><th>{tr('Qué')}</th><th>{tr('Antes')}</th><th>{tr('Después')}</th><th className="rp-act"></th></tr></thead>
              <tbody>{pageOf('changes', changesShown).map((c) => {
                const stop = c.refTable === 'act_stops' ? s.stops.find((x) => x.id === c.refKey && !x.deleted) : undefined
                const see = c.refTable === 'act_runs' && s.runs.some((r) => r.id === c.refKey) ? () => setDetail({ runId: c.refKey }) : stop && fix(spanShifts(rep.plan, stop.startedAt, stop.endedAt ?? now), stop.dept) ? () => setEditStop(stop.id) : null
                return (
                  <tr key={c.id} style={roomKnown(c.dept) ? deptVars(c.dept) : undefined}>
                    <td data-label={tr('Hora')}>{hl(fmtTime(c.at), toks)}</td><td data-label={tr('Quién')}>{hl(c.by, toks)}</td>
                    <td data-label={tr('Depto')} className={c.dept ? 'c-head' : 'c-none'}>{c.dept ? <DeptBadge d={c.dept} /> : '—'}</td>
                    <td data-label={tr('Qué')}>{hl(c.what, toks)}</td>
                    <td data-label={tr('Antes')} className={c.before ? 'was' : 'c-none'}>{c.before ? hl(c.before, toks) : '—'}</td><td data-label={tr('Después')}><b>{c.after ? hl(c.after, toks) : '—'}</b></td>
                    <td className="rp-act">{see && <div className="btns"><button type="button" className="btn xs" onClick={see}>{tr('Ver')}</button></div>}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
          {pageBar('changes', changesShown.length)}
          <p className="hint">{tr('Cada corrección, cambio en la tabla de productos, en el programa del día o en las líneas queda aquí con quién lo hizo y a qué hora. Lo normal del día (carros, mezclas, paros) no sale aquí: ya lleva el nombre de quien lo registró.')}</p>
        </>
      )}
      {admin && runs.length + stops.length > 0 && (
        <>
          <h3>{tr('Herramientas de este día')}</h3>
          <p><button type="button" className="btn stopbtn" onClick={() => setWiping(true)}>{tr('Borrar todo lo registrado este día (pruebas)')}</button></p>
        </>
      )}
      {!viewOnly && <p className="hint">{tr('Limpiar este aparato o subir sus registros: en Ajustes › Este aparato.')}</p>}
    </div>
  )
}

/** a fact of a run with its name, as in Ajustes */
const Fact = ({ label, value, cls }: { label: string; value: ReactNode; cls?: string }) => <div className="setfact"><label>{label}</label><b className={cls}>{value}</b></div>

/**
 * "Detalle de la corrida": one run whole, to read (also for whoever only looks): its facts, every unit with its hour,
 * its shift, its lots and its order, the stops of its line while it ran, and its changes. From here it is corrected
 * (the correction opens above this sheet and closes back to it, updated), a missing unit is added, or the report is
 * narrowed to its code or its lot. It is read from the store, so a run of another date (one just added) shows too.
 */
export function RunDetail({ s, runId, at, now, mgr, fix, fixable, onFix, onFixStop, onCode, onLot, onClose }: { s: State; runId: string; at?: number; now: number; mgr: boolean; fix: (shifts: string, room: string) => boolean; fixable: (room: string) => boolean; onFix: (at?: number) => void; onFixStop: (id: string) => void; onCode: (c: string) => void; onLot: (l: string) => void; onClose: () => void }) {
  const [adding, setAdding] = useState(false)
  const [focus, setFocus] = useState(at)
  const r = s.runs.find((x) => x.id === runId)
  if (!r) return null
  const st = runStats(s, r, now), plan = shiftsOf(s, r.date), shifts = spanShifts(plan, r.startedAt, r.endedAt ?? now)
  const canFixAny = fixable(r.dept) // (a run of a room this person does not write shows no correction at all)
  const cfg = cfgOf(r), lots = [...runLots(s, r)].filter(Boolean), product = productOf(s, r.code)?.name
  const reasons = Object.entries(st.reasons).map(([key, v]) => tr(key) + ' ' + fmtDur(v)).join(', ')
  const orders = r.units.some((u) => orderOfId(s, u.po))
  const unitNotes = r.units.some((u) => !!u.note) // (a unit's own comment, Jose 2026-10-18: a column when one has it)
  // the stops of its line (and of the whole room) while it ran: the same rule as the report's
  const stopsOf = s.stops.filter((x) => !x.deleted && x.dept === r.dept && (x.lineId === r.lineId || x.lineId === null) && x.startedAt < (r.endedAt ?? now) && (x.endedAt ?? now) > r.startedAt).sort((a, b) => a.startedAt - b.startedAt)
  const changes = mgr ? s.changes.filter((c) => !c.deleted && c.refTable === 'act_runs' && c.refKey === r.id).sort((a, b) => a.at - b.at) : []
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg wide rp-detail" onClick={(e) => e.stopPropagation()}>
        <h3><DeptBadge d={r.dept} /> {r.code} · {lineNameOf(s, r.lineId, r.line)}{product && <small> · {product}</small>}<small className="rp-dsub">{tr('Detalle de la corrida')}</small></h3>
        <div className="setfacts">
          <Fact label={tr('Lote')} value={lots.join(', ') || '—'} />
          <Fact label={tr('Horario')} value={fmtTime(r.startedAt) + ' – ' + (r.endedAt ? fmtTime(r.endedAt) : tr('en curso'))} />
          <Fact label={tr('Turno')} value={shifts} />
          <Fact label={tr('Hecho')} value={madeText(r, st.qty, true)} />
          {cfg.waste && <Fact label="Waste" value={r.waste ? r.waste + ' lb' : '—'} cls={r.waste ? 'red' : undefined} />}
          <Fact label={tr('Trabajando')} value={fmtDur(st.working)} />
          {r.units.length > 0 && <Fact label={tr('Prom./unidad')} value={fmtDur(st.avg)} />}
          <Fact label={tr('Parado')} value={fmtDur(st.down)} cls={st.down ? 'red' : undefined} />
          <Fact label="Set up" value={st.setup ? fmtDur(st.setup) : '—'} cls={st.setup ? 'amber' : undefined} />
          {reasons && <Fact label={tr('Razones')} value={reasons} />}
          <Fact label={tr('Registró')} value={whoText(r) || '—'} />
          {/* its comment, the whole width (Jose, 2026-10-18: comments on the records) */}
          {noteOf(r) && <div className="setfact rp-dnote"><label>{tr('Comentario')}</label><span>{noteOf(r)}</span></div>}
        </div>
        {r.units.length > 0 && (
          <div className="twrap">
            <table>
              <thead><tr><th>#</th><th>{tr('Hora')}</th><th>{tr('Turno')}</th>{cfg.qty !== 'none' && <th className="num">{cfg.qtyUnit}</th>}<th>{tr('Lote / tag')}</th>{orders && <th>{tr('Pedido')}</th>}<th>{tr('Registró')}</th>{unitNotes && <th>{tr('Comentario')}</th>}</tr></thead>
              <tbody>{r.units.map((u, i) => {
                const parts = unitParts(s, r, u), o = orderOfId(s, u.po)
                return (
                  <tr key={u.at + ':' + i} className={u.at === focus ? 'rp-focus' : undefined}>
                    <td>{i + 1}</td><td>{fmtTime(u.at)}</td><td>{shiftAt(plan, u.at)}</td>
                    {cfg.qty !== 'none' && <td className="num">{unitQty(s, r, u).toLocaleString('en-US')}</td>}
                    <td>{parts.map((p) => [p.lot, p.tag].filter(Boolean).join(' · ')).filter(Boolean).join(' / ') || '—'}</td>
                    {orders && <td>{o ? orderLabel(o) : '—'}</td>}
                    <td>{u.by || '—'}</td>
                    {unitNotes && <td className="rp-note unote">{u.note ? '💬 ' + u.note : '—'}</td>}
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
        {stopsOf.length > 0 && (
          <>
            <h4>{tr('Paros de esta corrida')}</h4>
            <div className="twrap">
              <table>
                <thead><tr><th>{tr('Razón')}</th><th>{tr('Horario')}</th><th>{tr('Duración')}</th>{canFixAny && <th></th>}</tr></thead>
                <tbody>{stopsOf.map((x) => {
                  const sh = spanShifts(plan, x.startedAt, x.endedAt ?? now)
                  return (
                    <tr key={x.id} className={x.endedAt ? undefined : 'live'}>
                      <td><b>{reasonText(s, x.reason)}</b>{x.note && <small> · {noteLabel(x.note)}</small>}</td><td>{fmtTime(x.startedAt)} – {x.endedAt ? fmtTime(x.endedAt) : tr('en curso')}</td><td>{fmtDur(stopTime(s, x, now))}</td>
                      {canFixAny && <td>{fix(sh, x.dept) ? <button type="button" className="btn xs soft" aria-label={tr('Corregir')} onClick={() => onFixStop(x.id)}>✎</button> : <small className="rp-lock">🔒 {tr('Otro turno')}</small>}</td>}
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          </>
        )}
        {changes.length > 0 && (
          <>
            <h4>{tr('Cambios de esta corrida')}</h4>
            <div className="twrap">
              <table className="changes">
                <thead><tr><th>{tr('Hora')}</th><th>{tr('Quién')}</th><th>{tr('Qué')}</th><th>{tr('Antes')}</th><th>{tr('Después')}</th></tr></thead>
                <tbody>{changes.map((c) => <tr key={c.id}><td>{fmtTime(c.at)}</td><td>{c.by}</td><td>{c.what}</td><td className={c.before ? 'was' : ''}>{c.before || '—'}</td><td><b>{c.after || '—'}</b></td></tr>)}</tbody>
              </table>
            </div>
          </>
        )}
        <div className="dbtns spread">
          <div className="btns">
            <button type="button" className="btn" onClick={onClose}>{tr('Cerrar')}</button>
            <button type="button" className="btn" onClick={() => onCode(r.code)}>{tr('Ver solo el código {0}', r.code)}</button>
            {lots.length === 1 && <button type="button" className="btn" onClick={() => onLot(lots[0])}>{tr('Ver solo el lote {0}', lots[0])}</button>}
          </div>
          <div className="btns">
            {fix(shifts, r.dept) ? (
              <>
                <button type="button" className="btn soft" onClick={() => setAdding(true)}>{tr('+ Agregar {0}', cfg.unit.toLowerCase())}</button>
                <button type="button" className="btn primary" onClick={() => onFix(focus)}>✎ {tr('Corregir')}</button>
              </>
            ) : canFixAny && <small className="rp-lock" title={tr('Lo corrige el turno {0} o quien tenga el permiso "Corregir lo del otro turno".', shifts)}>🔒 {tr('Otro turno')}</small>}
          </div>
        </div>
        {/* "Agregar y otro" (Jose, 2026-10-18) leaves the window open for the next one; this sheet reads the run from
            the store, so each one added shows in it while the window stays */}
        {adding && <AddUnitDialog s={s} run={r} onClose={() => setAdding(false)} onAdded={(added, more) => { if (!more) setAdding(false); setFocus(added) }} />}
      </div>
    </div>
  )
}

/** "Cómo leer este reporte": the colours, the parts, and what each number is (what used to fold under the tables) */
function HelpDialog({ views, plan, onClose }: { views: View[]; plan: ReportData['plan']; onClose: () => void }) {
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg wide rp-help" onClick={(e) => e.stopPropagation()}>
        <h3>{tr('Cómo leer este reporte')}</h3>
        <div className="rp-badges">{DEPTS.map((d) => <DeptBadge key={d} d={d} />)}</div>
        <p>{tr('Cada departamento tiene su color y su dibujo. Los verás en sus tarjetas, en sus filas y en lo que encuentres al buscar.')}</p>
        <p>{tr('Los otros colores dicen cómo está algo: rojo es parado, ámbar es Set up, verde es lo que corre y el botón principal; índigo son bins, rosa son copas, naranja son libras y azul son las cajas de Spiral.')}</p>
        <h4>{tr('Las partes del reporte')}</h4>
        <dl className="rp-parts">{views.map((v) => <Fragment key={v}><dt>{viewLabel(v)}</dt><dd>{viewSub(v)}</dd></Fragment>)}</dl>
        <h4>{tr('¿Qué es cada número?')}</h4>
        <p>{trx('{0} es el reloj: desde que empezó el primer código hasta que terminó el último. {1} y {2} son la suma de todas las líneas: tres líneas trabajando cinco horas cada una son quince horas. {3} son los productos distintos. Una {4} es un código en una línea, desde que empieza hasta que termina: el mismo código en dos líneas son dos corridas. {5} es el tiempo entre un código y el siguiente en la misma línea.', <b>{tr('Duración')}</b>, <b>{tr('Trabajando')}</b>, <b>{tr('Parado')}</b>, <b>{tr('Códigos')}</b>, <b>{tr('corrida')}</b>, <b>Set up</b>)}</p>
        {!plan.only && (
          <>
            <h4>{tr('¿Cómo se reparte entre los turnos?')}</h4>
            <p>{tr('Cada registro cuenta en el turno de su hora. Un código que pasó de un turno al otro cuenta en los dos, cada uno con lo suyo; su waste se reparte según lo hecho en cada turno. El tiempo nunca se detiene solo. Cuando ya pasó el rato entre un turno y el otro, si en una línea nadie registró nada en todo ese rato, ese rato no cuenta.')}</p>
          </>
        )}
        <p>{STOPS_NOTE()}</p>
        <div className="dbtns"><button type="button" className="btn primary" onClick={onClose}>{tr('Cerrar')}</button></div>
      </div>
    </div>
  )
}
