import { dayOf, fmtDur, fmtTime, runStats, type State } from './store'

type Libs = { jsPDF: typeof import('jspdf').jsPDF; autoTable: typeof import('jspdf-autotable').default }
let libs: Libs | null = null
/** the PDF libraries are big: they load when the report opens, so the tap that asks for the PDF can open it at once */
export const loadPdf = () => (libs ? Promise.resolve(libs) : Promise.all([import('jspdf'), import('jspdf-autotable')]).then(([a, b]) => (libs = { jsPDF: a.jsPDF, autoTable: b.default })))

const fmtDate = (d: string) => { const [y, m, dd] = d.split('-'); return m + '/' + dd + '/' + y }

/** the day's report as the tables on screen: codes first, then the stops. null until the libraries are loaded */
export function buildPdf(s: State, date: string, now: number, by: string) {
  if (!libs) return null
  const { jsPDF, autoTable } = libs
  const runs = s.runs.filter((r) => r.date === date).sort((a, b) => a.startedAt - b.startedAt)
  const stops = s.stops.filter((x) => dayOf(x.startedAt) === date).sort((a, b) => a.startedAt - b.startedAt)
  const rows = runs.map((r) => ({ r, st: runStats(s, r, now) }))
  const carts = rows.reduce((t, x) => t + x.r.carts.length, 0)
  const working = rows.reduce((t, x) => t + x.st.working, 0)
  const down = rows.reduce((t, x) => t + x.st.down, 0)
  const lineName = (x: { lineId: string | null; dept: string }) => (x.lineId === null ? 'Todo ' + x.dept : s.lines.find((l) => l.id === x.lineId)?.name ?? s.runs.find((r) => r.lineId === x.lineId)?.line ?? 'línea')

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  const teal: [number, number, number] = [15, 118, 110]
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(22, 32, 42)
  doc.text('Actividad · Reporte del día', 40, 42)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(91, 107, 122)
  doc.text(fmtDate(date) + '   ·   ' + rows.length + ' códigos   ·   ' + carts + ' carros   ·   trabajando ' + fmtDur(working) + '   ·   parado ' + fmtDur(down), 40, 62)
  autoTable(doc, {
    startY: 78, theme: 'grid', styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: [22, 32, 42] }, headStyles: { fillColor: teal, textColor: 255, fontStyle: 'bold' },
    head: [['Depto', 'Línea', 'Código', 'Lote', 'Inicio', 'Fin', 'Carros', 'Trabajando', 'Prom. / carro', 'Parado', 'Razones de paro', 'Registró']],
    body: rows.map((x) => [x.r.dept, x.r.line, x.r.code, x.r.lot, fmtTime(x.r.startedAt), x.r.endedAt ? fmtTime(x.r.endedAt) : 'en curso', String(x.r.carts.length), fmtDur(x.st.working), x.r.carts.length ? fmtDur(x.st.avg) : '—', fmtDur(x.st.down), Object.entries(x.st.reasons).map(([k, v]) => k + ' ' + fmtDur(v)).join(', ') || '—', x.r.by]),
    foot: [['Total', '', '', '', '', '', String(carts), fmtDur(working), '', fmtDur(down), '', '']], footStyles: { fillColor: [243, 246, 249], textColor: [22, 32, 42], fontStyle: 'bold' },
  })
  if (stops.length) {
    const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 28
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(22, 32, 42)
    doc.text('Paros', 40, y)
    autoTable(doc, {
      startY: y + 10, theme: 'grid', styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: [22, 32, 42] }, headStyles: { fillColor: [179, 38, 30], textColor: 255, fontStyle: 'bold' },
      head: [['Depto', 'Línea', 'Razón', 'Detalle', 'Inicio', 'Fin', 'Duración', 'Registró']],
      body: stops.map((x) => [x.dept, lineName(x), x.reason, x.note || '—', fmtTime(x.startedAt), x.endedAt ? fmtTime(x.endedAt) : 'en curso', fmtDur((x.endedAt ?? now) - x.startedAt), x.by]),
    })
  }
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120)
    doc.text('Generado ' + new Date(now).toLocaleString('en-US') + ' · ' + by + ' · página ' + i + ' de ' + pages, 40, doc.internal.pageSize.getHeight() - 22)
  }
  return doc
}
