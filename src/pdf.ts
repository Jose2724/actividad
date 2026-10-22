import { apartLabel, apartWord, binWord, casesText, CFG, cfgFor, cfgOf, fmtDur, fmtTime, inCases, lineLabel, lineNameOf, madeText, noteLabel, shiftHours, whoText, type DeptCfg, type State, attendanceOf, attLineText, attOf, attShifts, attStateText, DEPTS } from './store'
import { filterTitle, reportOf, spanShifts, type ReportFilter } from './report'
import { avanceRows, n1, pending, mfoText } from './avance'
import { tr } from './i18n'

type Libs = { jsPDF: typeof import('jspdf').jsPDF; autoTable: typeof import('jspdf-autotable').default }
let libs: Libs | null = null
/** the PDF libraries are big: they load when the report opens, so the tap that asks for the PDF can open it at once */
export const loadPdf = () => (libs ? Promise.resolve(libs) : Promise.all([import('jspdf'), import('jspdf-autotable')]).then(([a, b]) => (libs = { jsPDF: a.jsPDF, autoTable: b.default })))

const fmtDate = (d: string) => { const [y, m, dd] = d.split('-'); return m + '/' + dd + '/' + y }

/** the day's report as the tables on screen: codes first, then the stops. null until the libraries are loaded */
/**
 * The parts of the report a file may carry (Jose, 2026-10-21: "escoger si quiero solo descargar la asistencia o otra
 * cosa en específica y no todo de una vez"): every part by default
 */
export type Part = 'resumen' | 'codigo' | 'pallets' | 'bins' | 'unidades' | 'paros' | 'asistencia' | 'avance' | 'cambios'
export function buildPdf(s: State, date: string, now: number, by: string, f: ReportFilter = {}, parts?: Set<Part>) {
  const has = (p: Part) => !parts || parts.has(p)
  if (!libs) return null
  const { jsPDF, autoTable } = libs
  const rep = reportOf(s, date, now, f), { rows, unitRows, stops, working, down } = rep, only = f.only
  const num = (x: number) => Math.round(x).toLocaleString('en-US')
  const unitsOf = (dept: keyof typeof CFG, n: number, c: DeptCfg = CFG[dept]) => n + ' ' + (n === 1 ? c.unit : c.plural).toLowerCase()
  const qtyOf = (dept: keyof typeof CFG, q: number, c: DeptCfg = CFG[dept]) => (c.qty !== 'none' ? num(q) + ' ' + c.qtyUnit : '—')
  // what is counted apart is said in its own words: "2 bins con 98 platos", "3 mezclas · 3,000 lb"
  const binsOf = (dept: keyof typeof CFG, bins: { word: string; units: number; qty: number }[]) => bins.map((b) => (dept === 'Spiral' ? unitsOf(dept, b.units, cfgFor(dept, b.word)) + ' · ' + num(b.qty) + ' ' + apartWord(dept, b.word) : tr('{0} con {1} {2}', b.units === 1 ? tr('1 bin') : tr('{0} bins', b.units), num(b.qty), apartWord(dept, b.word)))).join(', ')
  const binCfg = (dept: keyof typeof CFG, bin: string) => cfgFor(dept, bin)
  const lineName = (x: { lineId: string | null; dept: string }) => (x.lineId === null ? tr('Todo {0}', x.dept) : lineLabel(s.lines.find((l) => l.id === x.lineId)?.name ?? s.runs.find((r) => r.lineId === x.lineId)?.line ?? tr('línea')))

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  const teal: [number, number, number] = [15, 118, 110]
  const indigo: [number, number, number] = [67, 56, 202] // the colour of the bin cards
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(22, 32, 42)
  doc.text(tr('Actividad · Reporte del día') + (only ? ' · ' + only : '') + filterTitle(rep.code, rep.lot, rep.shift, rep.line ? rep.lineChoices.find((l) => l.id === rep.line)?.name ?? '' : ''), 40, 42)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(91, 107, 122)
  doc.text(tr('{0}   ·   {1}{2} en {3}{4}   ·   trabajando {5}   ·   parado {6}{7}   ({8}', fmtDate(date), rep.distinct, (rep.distinct === 1 ? ' ' + tr('código') : ' ' + tr('códigos')), rows.length, (rows.length === 1 ? ' ' + tr('corrida') : ' ' + tr('corridas')), fmtDur(working), fmtDur(down), (rep.setup ? '   ' + tr('·   set up {0}', fmtDur(rep.setup)) : ''), (rep.lines === 1 ? tr('una línea') : tr('suma de {0} líneas', rep.lines))) + ')', 40, 62)
  doc.text(rep.plan.only ? tr('Turno {0}   ·   el único del día', rep.plan.only) : tr('Turno 1: {0}   ·   Turno 2: {1}', shiftHours(rep.plan, 1), shiftHours(rep.plan, 2)), 40, 78)
  // (where the last table ended; with the first parts left out, where the page's heading ends)
  const after = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 80
  let top = 94
  // what was made, room by room, said first and in bold: it is what the report is read for
  if (rep.byDept.length && has('resumen')) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(15, 118, 110)
    const made = rep.byDept.map((d) => d.dept + ': ' + (CFG[d.dept].qty !== 'none' ? qtyOf(d.dept, d.qty) + ' (' + unitsOf(d.dept, d.units) + ')' : unitsOf(d.dept, d.units)) + (d.bins.length ? ' + ' + (d.dept === 'Spiral' ? tr('aparte: {0}', binsOf(d.dept, d.bins)) : tr('en bins: {0}', binsOf(d.dept, d.bins))) : ''))
    const lines = doc.splitTextToSize(tr('Hecho   {0}', made.join('   ·   ')), doc.internal.pageSize.getWidth() - 80) as string[]
    doc.text(lines, 40, top + 4)
    top += 4 + lines.length * 15 + 6
  }
  // the whole day first and each shift under it (not when the report is of one shift only)
  if (rep.byShift.length && has('resumen')) {
    const made = (dept: keyof typeof CFG, x: { units: number; qty: number; bins: { word: string; units: number; qty: number }[] }) => x.units + ' ' + (x.units === 1 ? CFG[dept].unit : CFG[dept].plural).toLowerCase() + (CFG[dept].qty !== 'none' ? ' · ' + Math.round(x.qty).toLocaleString('en-US') + ' ' + CFG[dept].qtyUnit : '') + (x.bins.length ? ' + ' + binsOf(dept, x.bins) : '')
    autoTable(doc, {
      startY: top, theme: 'grid', styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: [22, 32, 42] }, headStyles: { fillColor: [22, 32, 42], textColor: 255, fontStyle: 'bold' },
      head: [[tr('Depto'), '', tr('Horario'), tr('Empezó'), tr('Terminó'), tr('Duración'), tr('Líneas'), tr('Códigos'), tr('Corridas'), tr('Hecho'), tr('Waste lb'), tr('Trabajando'), tr('Parado'), 'Set up']],
      body: rep.byShift.flatMap((d) => [d.day, ...shiftCols.map((k) => (k === 1 ? d.first : d.second))].map((x) => [x.shift ? '' : d.dept, x.shift ? tr('Turno {0}', x.shift) : tr('Total del día'), x.shift ? shiftHours(rep.plan, x.shift) : '', x.from ? fmtTime(x.from) : '—', !x.to ? '—' : x.open ? tr('en curso') : fmtTime(x.to), x.span ? fmtDur(x.span) : '—', String(x.lines), String(x.distinct), String(x.codes), made(d.dept, x), x.waste ? String(x.waste) : '—', fmtDur(x.working), fmtDur(x.down), x.setup ? fmtDur(x.setup) : '—'])),
      didParseCell: (c) => { if (c.section === 'body' && c.row.index % (shiftCols.length + 1) === 0) { c.cell.styles.fontStyle = 'bold'; c.cell.styles.fillColor = [243, 246, 249] } },
    })
    top = after() + 18
  }
  const sh = !rep.shift // a column says the shift of each line when the report is the whole day's
  const shiftCols = ([1, 2] as const).filter((k) => !rep.plan.only || rep.plan.only === k) // the shifts of the day, side by side: both, or the only one
  // each code with its lots under it, and the total of each room: what was made of what
  if (rep.byCode.length && has('codigo')) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(22, 32, 42)
    doc.text(tr('Por código y lote'), 40, top + 6)
    const body: string[][] = [], kind: ('code' | 'lot' | 'total')[] = []
    const dashed = (x: number) => (x ? num(x) : '—')
    for (const d of rep.byDept) {
      const b = rep.byShift.find((x) => x.dept === d.dept), q = CFG[d.dept].qty !== 'none'
      const boxes = (code: string, qty: number) => (CFG[d.dept].qtyUnit === 'pouches' && casesText(inCases(s, code, qty))) || '—'
      for (const c of rep.byCode.filter((x) => x.dept === d.dept)) {
        const cc = binCfg(c.dept, c.bin), box = (code: string, qty: number) => (c.bin ? '—' : boxes(code, qty))
        body.push([c.dept, c.code + (c.bin ? ' (' + apartLabel(c.dept, c.bin) + ')' : ''), c.lots.length === 1 ? c.lots[0].lot || '—' : tr('{0} lotes', c.lots.length), unitsOf(c.dept, c.units, cc), qtyOf(c.dept, c.qty, cc), ...(c.byShift ? shiftCols.map((k) => dashed((c.byShift as [number, number])[k - 1])) : []), box(c.code, c.qty), c.waste ? String(c.waste) : '—', c.lines.join(', ')]); kind.push('code')
        if (c.lots.length > 1) for (const l of c.lots) { body.push(['', '', l.lot || '—', unitsOf(c.dept, l.units, cc), qtyOf(c.dept, l.qty, cc), ...(l.byShift ? shiftCols.map((k) => dashed((l.byShift as [number, number])[k - 1])) : []), box(c.code, l.qty), '', '']); kind.push('lot') }
      }
      body.push([tr('Total {0}', d.dept), '', '', unitsOf(d.dept, d.units), qtyOf(d.dept, d.qty), ...(b ? shiftCols.map((k) => { const x = k === 1 ? b.first : b.second; return dashed(q ? x.qty : x.units) }) : []), '', d.waste ? String(d.waste) : '—', '']); kind.push('total')
      for (const y of d.bins) { const cc = binCfg(d.dept, y.word); body.push([tr('Además, {0}', apartLabel(d.dept, y.word)), '', '', unitsOf(d.dept, y.units, cc), qtyOf(d.dept, y.qty, cc), ...(b ? shiftCols.map((k) => (k === 1 ? b.first : b.second)).map((x) => dashed(x.bins.find((z) => z.word === y.word)?.qty ?? 0)) : []), '', '', '']); kind.push('total') }
    }
    autoTable(doc, {
      startY: top + 14, theme: 'grid', styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: [22, 32, 42] }, headStyles: { fillColor: teal, textColor: 255, fontStyle: 'bold' },
      head: [[tr('Depto'), tr('Código'), tr('Lote'), tr('Hechas'), tr('Cantidad'), ...(sh ? shiftCols.map((k) => tr('Turno {0}', k)) : []), tr('En cajas'), tr('Waste lb'), tr('Líneas')]],
      body,
      didParseCell: (c) => {
        if (c.section !== 'body') return
        const k = kind[c.row.index]
        if (k === 'total') { c.cell.styles.fontStyle = 'bold'; c.cell.styles.fillColor = [230, 243, 241] }
        else if (k === 'lot') { c.cell.styles.textColor = [91, 107, 122]; c.cell.styles.fontSize = 8.5 }
        else if (c.column.index === 1 || c.column.index === 4) c.cell.styles.fontStyle = 'bold'
      },
    })
    top = after() + 18
  }
  // Asistencia (Santiago, 2026-10-20): each room's people expected, those who came and the % missing
  if (has('asistencia')) {
    const rooms = only ? [only] : DEPTS, a = attendanceOf(s, date, rep.shift ?? 0, rooms), pc = (x: number) => Math.round(x * 100) + '%'
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(22, 32, 42)
    doc.text(tr('Asistencia') + (rep.shift ? ' · ' + tr('Turno {0}', rep.shift) : ''), 40, top + 6)
    autoTable(doc, {
      startY: top + 14, theme: 'grid', styles: { font: 'helvetica', fontSize: 10, cellPadding: 5, textColor: [22, 32, 42] }, headStyles: { fillColor: teal, textColor: 255, fontStyle: 'bold' }, tableWidth: 420,
      head: [[tr('Cuarto'), tr('Esperados'), tr('Vinieron'), tr('% Falta'), tr('Faltan')]],
      body: a.rows.map((r) => [r.dept, String(r.expected), String(r.actual), pc(r.pct), String(r.miss)]),
      foot: [[tr('TOTAL'), String(a.total.expected), String(a.total.actual), pc(a.total.pct), String(a.total.miss)]],
    })
    top = after() + 18
    // the people, by room and line (Jose, 2026-10-22: the names in the report)
    const people = (rep.shift ? [rep.shift] : attShifts(s, date)).flatMap((k) => rooms.flatMap((d) => attOf(s, date, d, k)))
    if (people.length) {
      autoTable(doc, {
        startY: top, theme: 'grid', styles: { font: 'helvetica', fontSize: 9, cellPadding: 4, textColor: [22, 32, 42] }, headStyles: { fillColor: teal, textColor: 255, fontStyle: 'bold' },
        head: [[tr('Cuarto'), tr('Turno'), tr('Línea'), tr('Persona'), tr('Hora'), tr('Estado'), tr('Viene de')]],
        body: people.map((x) => [x.dept, String(x.shift), attLineText(s, x.line), x.name, fmtTime(x.at), attStateText(s, x) + (x.gone ? ' · ' + fmtTime(x.gone.at) : ''), x.from]),
      })
      top = after() + 18
    }
  }
  if (has('resumen')) autoTable(doc, {
    startY: top, theme: 'grid', styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: [22, 32, 42] }, headStyles: { fillColor: teal, textColor: 255, fontStyle: 'bold' },
    head: [[tr('Depto'), tr('Línea'), tr('Código'), tr('Lote'), ...(sh ? [tr('Turno')] : []), tr('Inicio'), tr('Fin'), tr('Hecho'), tr('Waste lb'), tr('Trabajando'), tr('Prom. / unidad'), tr('Parado'), 'Set up', tr('Razones de paro'), tr('Registró')]],
    body: rows.map((x) => [x.r.dept, lineNameOf(s, x.r.lineId, x.r.line), x.r.code, x.lots, ...(sh ? [x.shifts] : []), fmtTime(x.r.startedAt), x.r.endedAt ? fmtTime(x.r.endedAt) : tr('en curso'), madeText(x.view, x.qty, true), x.waste ? String(x.waste) : '—', fmtDur(x.st.working), x.timed ? fmtDur(x.st.avg) : '—', fmtDur(x.st.down), x.st.setup ? fmtDur(x.st.setup) : '—', Object.entries(x.st.reasons).map(([k, v]) => tr(k) + ' ' + fmtDur(v)).join(', ') || '—', whoText(x.r)]),
    foot: [[tr('Total'), '', '', '', ...(sh ? [''] : []), '', '', '', String(Math.round(rows.reduce((t, x) => t + (x.waste || 0), 0) * 100) / 100), fmtDur(working), '', fmtDur(down), rep.setup ? fmtDur(rep.setup) : '—', '', '']], footStyles: { fillColor: [243, 246, 249], textColor: [22, 32, 42], fontStyle: 'bold' },
  })
  // Packing's pallets one by one: the lots each one holds with their cases and their tag, its total and its PO (2/12)
  if (rep.pallets.length && has('pallets')) {
    const y = after() + 28
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(22, 32, 42)
    doc.text(tr('Pallets'), 40, y)
    const span = (p: (typeof rep.pallets)[number], content: string) => ({ content, rowSpan: p.parts.length })
    const ofText = (of: [number, number | null]) => (of[1] ? of[0] + '/' + of[1] : String(of[0]))
    autoTable(doc, {
      startY: y + 10, theme: 'grid', styles: { font: 'helvetica', fontSize: 9, cellPadding: 4, textColor: [22, 32, 42], valign: 'middle' }, headStyles: { fillColor: teal, textColor: 255, fontStyle: 'bold' },
      head: [[tr('Pallet'), tr('Código'), tr('Lote'), tr('Cajas'), tr('Tag'), tr('Total'), 'PO', tr('Línea'), tr('Hora'), ...(sh ? [tr('Turno')] : [])]],
      body: rep.pallets.flatMap((p) => p.parts.map((x, i) => [
        ...(i === 0 ? [span(p, String(p.n) + (p.open ? ' ' + tr('en armado') : '')), span(p, p.r.code)] : []),
        x.lot, x.qty != null ? num(x.qty) : '—', x.tag || tr('sin tag'),
        ...(i === 0 ? [span(p, num(p.total)), span(p, p.order ? p.order + (p.of ? '  ·  ' + ofText(p.of) : '') : '—'), span(p, lineNameOf(s, p.r.lineId, p.r.line)), span(p, p.open ? '—' : fmtTime(p.at)), ...(sh ? [span(p, String(p.shift))] : [])] : []),
      ])),
    })
  }
  // Packing's bins one by one, apart from its pallets
  if (rep.bins.length && has('bins')) {
    const y = after() + 28
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(22, 32, 42)
    doc.text(tr('Bins'), 40, y)
    autoTable(doc, {
      startY: y + 10, theme: 'grid', styles: { font: 'helvetica', fontSize: 9, cellPadding: 4, textColor: [22, 32, 42], valign: 'middle' }, headStyles: { fillColor: indigo, textColor: 255, fontStyle: 'bold' },
      head: [[tr('Bin'), tr('Código'), tr('Lote'), tr('Cantidad'), tr('N° de bin'), tr('Línea'), tr('Hora'), ...(sh ? [tr('Turno')] : []), tr('Registró')]],
      body: rep.bins.map((b) => [String(b.n), b.r.code, b.lot || '—', b.qty != null ? num(b.qty) + ' ' + binWord(b.word) : '—', b.ref || '—', lineNameOf(s, b.r.lineId, b.r.line), fmtTime(b.at), ...(sh ? [String(b.shift)] : []), b.by || '—']),
    })
  }
  // one line per cart, mezcla, bin or pallet with its time, as the office's sheets are filled (a pallet with two lots: two lines)
  if (unitRows.length && has('unidades')) {
    const y = after() + 28
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(22, 32, 42)
    doc.text(tr('Detalle por unidad'), 40, y)
    autoTable(doc, {
      startY: y + 10, theme: 'grid', styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 4, textColor: [22, 32, 42] }, headStyles: { fillColor: [91, 107, 122], textColor: 255, fontStyle: 'bold' },
      head: [[tr('Hora'), ...(sh ? [tr('Turno')] : []), tr('Depto'), tr('Línea'), tr('Código'), tr('Lote'), '#', tr('Unidad'), tr('Cantidad'), tr('Tag / bin'), tr('Desde la anterior'), tr('Registró')]],
      body: unitRows.map((x) => [fmtTime(x.u.at), ...(sh ? [String(x.shift)] : []), x.r.dept, lineNameOf(s, x.r.lineId, x.r.line), x.r.code, x.lot, String(x.i + 1), cfgOf(x.r).unit, x.qty != null ? x.qty + ' ' + cfgOf(x.r).qtyUnit : '—', x.tag || '—', fmtDur(x.gap), x.u.by || '—']),
    })
  }
  if (stops.length && has('paros')) {
    const y = after() + 28
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(22, 32, 42)
    doc.text(tr('Paros'), 40, y)
    autoTable(doc, {
      startY: y + 10, theme: 'grid', styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: [22, 32, 42] }, headStyles: { fillColor: [179, 38, 30], textColor: 255, fontStyle: 'bold' },
      head: [[tr('Depto'), tr('Línea'), tr('Razón'), tr('Detalle'), ...(sh ? [tr('Turno')] : []), tr('Inicio'), tr('Fin'), tr('Duración'), tr('Registró')]],
      body: stops.map((x) => [x.dept, lineName(x), tr(x.reason), noteLabel(x.note) || '—', ...(sh ? [spanShifts(rep.plan, x.startedAt, x.endedAt ?? now)] : []), fmtTime(x.startedAt), x.endedAt ? fmtTime(x.endedAt) : tr('en curso'), fmtDur(x.ms), x.by]),
    })
  }
  // the day's progress, as the office's AVANCE sheet (the manager's report only)
  const av = only || rep.filtered || !has('avance') ? [] : avanceRows(s, date)
  if (av.length) {
    doc.addPage()
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(22, 32, 42)
    doc.text(tr('Avance del día · {0}', fmtDate(date)), 40, 42)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(91, 107, 122)
    doc.text(tr('Progr. = del programa del día (mezclas programadas × tabla de productos). Esper. = de las mezclas ya hechas. Pend. = esperado − hecho (negativo = de más). Faltan = programado − hecho.'), 40, 58)
    autoTable(doc, {
      startY: 70, theme: 'grid', styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 3, textColor: [22, 32, 42] }, headStyles: { fillColor: teal, textColor: 255, fontStyle: 'bold' },
      head: [[tr('Código'), tr('Producto'), tr('Mezclas progr.'), tr('Hechas'), tr('Pend.'), 'Spiral', tr('Pouches progr.'), tr('Esper.'), tr('Hechos'), tr('Pend.'), tr('Faltan'), tr('Cajas progr.'), tr('Esper.'), tr('Hechas'), tr('Pend.'), tr('Faltan'), tr('MFO esper.'), 'MFO', tr('MFO pend.'), tr('Pallets progr.'), tr('Esper.'), tr('Hechos'), tr('Waste lb')]],
      body: av.map((r) => [r.code + ' · ' + r.packRoom, r.product?.name ?? tr('(no está en Productos)'), String(r.scheduled), r.mixesDone ? r.mixesDone + ' ' + r.mixRoom : '0', String(r.mixesPending), String(r.spiralDone), n1(r.pouchesPlan), n1(r.pouchesExp), String(r.pouchesDone), n1(pending(r.pouchesExp, r.pouchesDone)), n1(pending(r.pouchesPlan, r.pouchesDone)), n1(r.casesPlan), n1(r.casesExp), String(r.casesDone), n1(pending(r.casesExp, r.casesDone)), n1(pending(r.casesPlan, r.casesDone)), n1(r.mfoExp), mfoText(r.mfo) || '0', n1(pending(r.mfoExp, r.mfo[0]?.qty ?? 0)), n1(r.palletsPlan), n1(r.palletsExp), String(r.palletsDone), r.wasteLb ? String(r.wasteLb) : '—']),
    })
  }
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120)
    doc.text(tr('Generado {0} · {1} · página {2} de {3}', new Date(now).toLocaleString('en-US'), by, i, pages), 40, doc.internal.pageSize.getHeight() - 22)
  }
  return doc
}
