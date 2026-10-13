import { casesText, CFG, fmtDur, fmtTime, inCases, lineNameOf, madeText, shiftHours, whoText, type State } from './store'
import { filterTitle, reportOf, spanShifts, type ReportFilter } from './report'
import { avanceRows, n1, pending } from './avance'
import { tr } from './i18n'

type Libs = { jsPDF: typeof import('jspdf').jsPDF; autoTable: typeof import('jspdf-autotable').default }
let libs: Libs | null = null
/** the PDF libraries are big: they load when the report opens, so the tap that asks for the PDF can open it at once */
export const loadPdf = () => (libs ? Promise.resolve(libs) : Promise.all([import('jspdf'), import('jspdf-autotable')]).then(([a, b]) => (libs = { jsPDF: a.jsPDF, autoTable: b.default })))

const fmtDate = (d: string) => { const [y, m, dd] = d.split('-'); return m + '/' + dd + '/' + y }

/** the day's report as the tables on screen: codes first, then the stops. null until the libraries are loaded */
export function buildPdf(s: State, date: string, now: number, by: string, f: ReportFilter = {}) {
  if (!libs) return null
  const { jsPDF, autoTable } = libs
  const rep = reportOf(s, date, now, f), { rows, unitRows, stops, working, down } = rep, only = f.only
  const num = (x: number) => Math.round(x).toLocaleString('en-US')
  const unitsOf = (dept: keyof typeof CFG, n: number) => n + ' ' + (n === 1 ? CFG[dept].unit : CFG[dept].plural).toLowerCase()
  const qtyOf = (dept: keyof typeof CFG, q: number) => (CFG[dept].qty !== 'none' ? num(q) + ' ' + CFG[dept].qtyUnit : '—')
  const lineName = (x: { lineId: string | null; dept: string }) => (x.lineId === null ? tr('Todo {0}', x.dept) : s.lines.find((l) => l.id === x.lineId)?.name ?? s.runs.find((r) => r.lineId === x.lineId)?.line ?? tr('línea'))

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  const teal: [number, number, number] = [15, 118, 110]
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(22, 32, 42)
  doc.text(tr('Actividad · Reporte del día') + (only ? ' · ' + only : '') + filterTitle(rep.code, rep.lot, rep.shift), 40, 42)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(91, 107, 122)
  doc.text(tr('{0}   ·   {1}{2} en {3}{4}   ·   trabajando {5}   ·   parado {6}{7}   ({8}', fmtDate(date), rep.distinct, (rep.distinct === 1 ? ' ' + tr('código') : ' ' + tr('códigos')), rows.length, (rows.length === 1 ? ' ' + tr('corrida') : ' ' + tr('corridas')), fmtDur(working), fmtDur(down), (rep.setup ? '   ' + tr('·   set up {0}', fmtDur(rep.setup)) : ''), (rep.lines === 1 ? tr('una línea') : tr('suma de {0} líneas', rep.lines))) + ')', 40, 62)
  doc.text(tr('Turno 1: {0}   ·   Turno 2: {1}', shiftHours(rep.plan, 1), shiftHours(rep.plan, 2)), 40, 78)
  const after = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  let top = 94
  // what was made, room by room, said first and in bold: it is what the report is read for
  if (rep.byDept.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(15, 118, 110)
    const made = rep.byDept.map((d) => d.dept + ': ' + (CFG[d.dept].qty !== 'none' ? qtyOf(d.dept, d.qty) + ' (' + unitsOf(d.dept, d.units) + ')' : unitsOf(d.dept, d.units)))
    const lines = doc.splitTextToSize(tr('Hecho   {0}', made.join('   ·   ')), doc.internal.pageSize.getWidth() - 80) as string[]
    doc.text(lines, 40, top + 4)
    top += 4 + lines.length * 15 + 6
  }
  // the whole day first and each shift under it (not when the report is of one shift only)
  if (rep.byShift.length) {
    const made = (dept: keyof typeof CFG, x: { units: number; qty: number }) => x.units + ' ' + (x.units === 1 ? CFG[dept].unit : CFG[dept].plural).toLowerCase() + (CFG[dept].qty !== 'none' ? ' · ' + Math.round(x.qty).toLocaleString('en-US') + ' ' + CFG[dept].qtyUnit : '')
    autoTable(doc, {
      startY: top, theme: 'grid', styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: [22, 32, 42] }, headStyles: { fillColor: [22, 32, 42], textColor: 255, fontStyle: 'bold' },
      head: [[tr('Depto'), '', tr('Horario'), tr('Empezó'), tr('Terminó'), tr('Duración'), tr('Líneas'), tr('Códigos'), tr('Corridas'), tr('Hecho'), tr('Waste lb'), tr('Trabajando'), tr('Parado'), 'Set up']],
      body: rep.byShift.flatMap((d) => [d.day, d.first, d.second].map((x) => [x.shift ? '' : d.dept, x.shift ? tr('Turno {0}', x.shift) : tr('Total del día'), x.shift ? shiftHours(rep.plan, x.shift) : '', x.from ? fmtTime(x.from) : '—', !x.to ? '—' : x.open ? tr('en curso') : fmtTime(x.to), x.span ? fmtDur(x.span) : '—', String(x.lines), String(x.distinct), String(x.codes), made(d.dept, x), x.waste ? String(x.waste) : '—', fmtDur(x.working), fmtDur(x.down), x.setup ? fmtDur(x.setup) : '—'])),
      didParseCell: (c) => { if (c.section === 'body' && c.row.index % 3 === 0) { c.cell.styles.fontStyle = 'bold'; c.cell.styles.fillColor = [243, 246, 249] } },
    })
    top = after() + 18
  }
  const sh = !rep.shift // a column says the shift of each line when the report is the whole day's
  // each code with its lots under it, and the total of each room: what was made of what
  if (rep.byCode.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(22, 32, 42)
    doc.text(tr('Por código y lote'), 40, top + 6)
    const body: string[][] = [], kind: ('code' | 'lot' | 'total')[] = []
    const dashed = (x: number) => (x ? num(x) : '—')
    for (const d of rep.byDept) {
      const b = rep.byShift.find((x) => x.dept === d.dept), q = CFG[d.dept].qty !== 'none'
      const boxes = (code: string, qty: number) => (CFG[d.dept].qtyUnit === 'pouches' && casesText(inCases(s, code, qty))) || '—'
      for (const c of rep.byCode.filter((x) => x.dept === d.dept)) {
        body.push([c.dept, c.code, c.lots.length === 1 ? c.lots[0].lot || '—' : tr('{0} lotes', c.lots.length), unitsOf(c.dept, c.units), qtyOf(c.dept, c.qty), ...(c.byShift ? [dashed(c.byShift[0]), dashed(c.byShift[1])] : []), boxes(c.code, c.qty), c.waste ? String(c.waste) : '—', c.lines.join(', ')]); kind.push('code')
        if (c.lots.length > 1) for (const l of c.lots) { body.push(['', '', l.lot || '—', unitsOf(c.dept, l.units), qtyOf(c.dept, l.qty), ...(l.byShift ? [dashed(l.byShift[0]), dashed(l.byShift[1])] : []), boxes(c.code, l.qty), '', '']); kind.push('lot') }
      }
      body.push([tr('Total {0}', d.dept), '', '', unitsOf(d.dept, d.units), qtyOf(d.dept, d.qty), ...(b ? [dashed(q ? b.first.qty : b.first.units), dashed(q ? b.second.qty : b.second.units)] : []), '', d.waste ? String(d.waste) : '—', '']); kind.push('total')
    }
    autoTable(doc, {
      startY: top + 14, theme: 'grid', styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: [22, 32, 42] }, headStyles: { fillColor: teal, textColor: 255, fontStyle: 'bold' },
      head: [[tr('Depto'), tr('Código'), tr('Lote'), tr('Hechas'), tr('Cantidad'), ...(sh ? [tr('Turno 1'), tr('Turno 2')] : []), tr('En cajas'), tr('Waste lb'), tr('Líneas')]],
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
  autoTable(doc, {
    startY: top, theme: 'grid', styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: [22, 32, 42] }, headStyles: { fillColor: teal, textColor: 255, fontStyle: 'bold' },
    head: [[tr('Depto'), tr('Línea'), tr('Código'), tr('Lote'), ...(sh ? [tr('Turno')] : []), tr('Inicio'), tr('Fin'), tr('Hecho'), tr('Waste lb'), tr('Trabajando'), tr('Prom. / unidad'), tr('Parado'), tr('Razones de paro'), tr('Registró')]],
    body: rows.map((x) => [x.r.dept, lineNameOf(s, x.r.lineId, x.r.line), x.r.code, x.lots, ...(sh ? [x.shifts] : []), fmtTime(x.r.startedAt), x.r.endedAt ? fmtTime(x.r.endedAt) : tr('en curso'), madeText(x.view, x.qty, true), x.waste ? String(x.waste) : '—', fmtDur(x.st.working), x.timed ? fmtDur(x.st.avg) : '—', fmtDur(x.st.down), Object.entries(x.st.reasons).map(([k, v]) => k + ' ' + fmtDur(v)).join(', ') || '—', whoText(x.r)]),
    foot: [[tr('Total'), '', '', '', ...(sh ? [''] : []), '', '', '', String(Math.round(rows.reduce((t, x) => t + (x.waste || 0), 0) * 100) / 100), fmtDur(working), '', fmtDur(down), '', '']], footStyles: { fillColor: [243, 246, 249], textColor: [22, 32, 42], fontStyle: 'bold' },
  })
  // one line per cart, mezcla, bin or pallet with its time, as the office's sheets are filled (a pallet with two lots: two lines)
  if (unitRows.length) {
    const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 28
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(22, 32, 42)
    doc.text(tr('Detalle por unidad'), 40, y)
    autoTable(doc, {
      startY: y + 10, theme: 'grid', styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 4, textColor: [22, 32, 42] }, headStyles: { fillColor: [91, 107, 122], textColor: 255, fontStyle: 'bold' },
      head: [[tr('Hora'), ...(sh ? [tr('Turno')] : []), tr('Depto'), tr('Línea'), tr('Código'), tr('Lote'), '#', tr('Unidad'), tr('Cantidad'), tr('Tag / bin'), tr('Desde la anterior'), tr('Registró')]],
      body: unitRows.map((x) => [fmtTime(x.u.at), ...(sh ? [String(x.shift)] : []), x.r.dept, lineNameOf(s, x.r.lineId, x.r.line), x.r.code, x.lot, String(x.i + 1), CFG[x.r.dept].unit, x.qty != null ? x.qty + ' ' + CFG[x.r.dept].qtyUnit : '—', x.u.ref || '—', fmtDur(x.gap), x.u.by || '—']),
    })
  }
  if (stops.length) {
    const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 28
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(22, 32, 42)
    doc.text(tr('Paros'), 40, y)
    autoTable(doc, {
      startY: y + 10, theme: 'grid', styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: [22, 32, 42] }, headStyles: { fillColor: [179, 38, 30], textColor: 255, fontStyle: 'bold' },
      head: [[tr('Depto'), tr('Línea'), tr('Razón'), tr('Detalle'), ...(sh ? [tr('Turno')] : []), tr('Inicio'), tr('Fin'), tr('Duración'), tr('Registró')]],
      body: stops.map((x) => [x.dept, lineName(x), x.reason, x.note || '—', ...(sh ? [spanShifts(rep.plan, x.startedAt, x.endedAt ?? now)] : []), fmtTime(x.startedAt), x.endedAt ? fmtTime(x.endedAt) : tr('en curso'), fmtDur(x.ms), x.by]),
    })
  }
  // the day's progress, as the office's AVANCE sheet (the manager's report only)
  const av = only || rep.filtered ? [] : avanceRows(s, date)
  if (av.length) {
    doc.addPage()
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(22, 32, 42)
    doc.text(tr('Avance del día · {0}', fmtDate(date)), 40, 42)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(91, 107, 122)
    doc.text(tr('Progr. = del programa del día (mezclas programadas × tabla de productos). Esper. = de las mezclas ya hechas. Pend. = esperado − hecho (negativo = de más). Faltan = programado − hecho.'), 40, 58)
    autoTable(doc, {
      startY: 70, theme: 'grid', styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 3, textColor: [22, 32, 42] }, headStyles: { fillColor: teal, textColor: 255, fontStyle: 'bold' },
      head: [[tr('Código'), tr('Producto'), tr('Mezclas progr.'), tr('Hechas'), tr('Pend.'), 'Spiral', tr('Pouches progr.'), tr('Esper.'), tr('Hechos'), tr('Pend.'), tr('Faltan'), tr('Cajas progr.'), tr('Esper.'), tr('Hechas'), tr('Pend.'), tr('Faltan'), tr('MFO cajas'), tr('Pallets progr.'), tr('Esper.'), tr('Hechos'), tr('Waste lb')]],
      body: av.map((r) => [r.code, r.product?.name ?? tr('(no está en Productos)'), String(r.scheduled), String(r.mixesDone), String(r.mixesPending), String(r.spiralDone), n1(r.pouchesPlan), n1(r.pouchesExp), String(r.pouchesDone), n1(pending(r.pouchesExp, r.pouchesDone)), n1(pending(r.pouchesPlan, r.pouchesDone)), n1(r.casesPlan), n1(r.casesExp), String(r.casesDone), n1(pending(r.casesExp, r.casesDone)), n1(pending(r.casesPlan, r.casesDone)), String(r.mfoCases), n1(r.palletsPlan), n1(r.palletsExp), String(r.palletsDone), r.wasteLb ? String(r.wasteLb) : '—']),
    })
  }
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120)
    doc.text(tr('Generado {0} · {1} · página {2} de {3}', new Date(now).toLocaleString('en-US'), by, i, pages), 40, doc.internal.pageSize.getHeight() - 22)
  }
  return doc
}
