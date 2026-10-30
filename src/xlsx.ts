import { tr } from './i18n'
/**
 * A real Excel workbook (.xlsx) written here, without a spreadsheet library: one sheet per table, a bold frozen
 * header row, numbers as numbers, times and spans as Excel times (so the office can sort and add them). An .xlsx is a
 * zip of small XML files; the zip comes from fflate, loaded once (when the report opens, or in the background after
 * the app starts) so that a tap can make the file at once.
 *
 * Since 2026-10-27 (Jose: "el excel bonito con colores y gráficas") a cell may carry a look (see X: a purple header,
 * a title, thousands, red/green/amber by value, a wrapped note) and a sheet may carry a column chart with more than
 * one series, besides the horizontal bars of before.
 */
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
/** the looks a cell may have (indexes into STYLES' cellXfs) */
export const X = {
  bold: 1, dur: 2, time: 3, date: 4, pct: 5,
  head: 6, title: 7, n: 8, nBad: 9, nGood: 10, bad: 11, good: 12, warn: 13, pct1: 14, label: 15, dec: 16, nWarn: 17, nLabel: 18, note: 19,
  // the weights Excel (2026-10-30): a band, a line in words, tiles, boxed cells with green, red and amber, a room's colour
  wBand: 20, wSub: 21, wSec: 22, wHead: 23, wCell: 24, wLeft: 25, wN: 26, wD: 27, wNg: 28, wNr: 29, wNa: 30, wDg: 31, wDr: 32, wDa: 33, wPg: 34, wPr: 35, wPa: 36, wP: 37, wTileL: 38, wTileV: 39, wHide: 40, wKitchen: 41, wRTE: 42, wSpiral: 43, wSay: 44,
} as const
/** a cell: text, a number, blank, an Excel number with a style (2 span [h]:mm:ss, 3 time of day, 4 date, 5 percent, or any X) and its text for the CSV, or a text with a style */
export type Cell = string | number | null | undefined | { v: number; s: number; t: string } | { t: string; s: number }
/**
 * A sheet may carry one chart drawn by Excel itself from its own cells (Santiago's attendance, 2026-10-20: "también
 * con los gráficos en excel"): the categories in column cat and the values in column(s) val, rows from..to (counted
 * from 1, as Excel does), placed under the table from row at. kind 'bar' (the default): horizontal bars, one colour
 * each when a single series, the values as % labels when pct. kind 'col': vertical columns, one colour per series.
 */
export type Chart = { title: string; series: string | string[]; cat: number; val: number | number[]; from: number; to: number; at: number; pct?: boolean; kind?: 'bar' | 'col'; cols?: number; height?: number }
export type Sheet = { name: string; rows: Cell[][]; chart?: Chart; freeze?: number
  /** a report to read (the weights Excel, 2026-10-30): no grid, its own column widths, row heights (by row, from 0), merged cells ("A1:P1"), and printed lying down on one page wide */
  page?: { widths: number[]; heights: Record<number, number>; merges: string[] } }

const DAY = 86_400_000
/** a span of time (shown as [h]:mm:ss, summable) */
export const xDur = (ms: number, text: string): Cell => ({ v: Math.max(0, ms) / DAY, s: 2, t: text })
/** a moment, as the local time of day on its date (sortable) */
export const xTime = (ms: number, text: string): Cell => { const d = new Date(ms); return { v: Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) / DAY + 25569, s: 3, t: text } }
/** a date written as YYYY-MM-DD */
export const xDay = (ymd: string): Cell => { const [y, m, d] = ymd.split('-').map(Number); return y && m && d ? { v: Date.UTC(y, m - 1, d) / DAY + 25569, s: 4, t: ymd } : ymd }
/** a share (0.17 is 17%), shown as a percent */
export const xPct = (x: number): Cell => ({ v: Math.round(x * 10000) / 10000, s: 5, t: Math.round(x * 100) + '%' })
/** a number with a look (thousands by default) */
export const xN = (v: number, s: number = X.n): Cell => ({ v, s, t: String(v) })
/** a text with a look */
export const xT = (t: string, s: number): Cell => ({ t, s })
/** what a cell says, for the CSV */
export const cellText = (c: Cell) => (c == null ? '' : typeof c === 'object' ? c.t : String(c))
const isNum = (c: Cell): c is { v: number; s: number; t: string } => typeof c === 'object' && c != null && 'v' in c

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
const colName = (n: number) => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
const sheetName = (s: string) => s.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || tr('Hoja')

function sheetXml(sh: Sheet) {
  const widths: number[] = []
  const rows = sh.rows.map((r, i) => {
    const cells = r.map((c, j) => {
      const text = cellText(c)
      // a wrapped note takes a wide column, not one as long as its text
      const wide = typeof c === 'object' && c != null && !('v' in c) && c.s === X.note
      widths[j] = Math.max(widths[j] ?? 0, Math.min(60, wide ? 50 : isNum(c) ? 12 : text.length))
      if (c == null || c === '') return ''
      const ref = colName(j) + (i + 1)
      if (typeof c === 'number') return Number.isFinite(c) ? `<c r="${ref}"><v>${c}</v></c>` : ''
      if (isNum(c)) return Number.isFinite(c.v) ? `<c r="${ref}" s="${c.s}"><v>${c.v}</v></c>` : ''
      const s = typeof c === 'object' ? c.s : i === 0 ? 1 : 0
      return `<c r="${ref}"${s ? ` s="${s}"` : ''} t="inlineStr"><is><t xml:space="preserve">${esc(clean(text))}</t></is></c>`
    }).join('')
    const ht = sh.page?.heights[i]
    return `<row r="${i + 1}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells}</row>`
  }).join('')
  const shown = sh.page?.widths ?? widths.map((w) => Math.max(8, w + 2))
  const cols = shown.length ? `<cols>${shown.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : ''
  const merges = sh.page?.merges.length ? `<mergeCells count="${sh.page.merges.length}">${sh.page.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''
  const print = sh.page ? '<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>' : ''
  const fz = sh.freeze ?? 1
  const pane = fz > 0 ? `<pane ySplit="${fz}" topLeftCell="A${fz + 1}" activePane="bottomLeft" state="frozen"/>` : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${sh.page ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : ''}<sheetViews><sheetView workbookViewId="0" showGridLines="${fz > 1 || sh.page ? 0 : 1}">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${merges}${print}${sh.chart ? '<drawing r:id="rId1"/>' : ''}</worksheet>`
}

const SERIES_COLORS = ['581447', 'A3A3A3', 'D97706', '15803D']
/** the chart of a sheet: its drawing (where it sits) and the chart itself, with the cells' values cached as Excel does */
function chartXml(sh: Sheet, name: string): string {
  const c = sh.chart!, q = "'" + name.replace(/'/g, "''") + "'", col = c.kind === 'col'
  const ref = (column: number) => `${q}!$${colName(column)}$${c.from}:$${colName(column)}$${c.to}`
  const rows = sh.rows.slice(c.from - 1, c.to)
  const cats = rows.map((r, i) => `<c:pt idx="${i}"><c:v>${esc(cellText(r[c.cat]))}</c:v></c:pt>`).join('')
  const fmt = c.pct ? '0%' : '#,##0'
  const vals = Array.isArray(c.val) ? c.val : [c.val], names = Array.isArray(c.series) ? c.series : [c.series]
  const one = vals.length === 1 && !col
  const sers = vals.map((v, k) => {
    const pts = rows.map((r, i) => { const x = r[v]; const n = isNum(x) ? x.v : Number(x); return Number.isFinite(n) ? `<c:pt idx="${i}"><c:v>${n}</c:v></c:pt>` : '' }).join('')
    const fill = one ? '' : `<c:spPr><a:solidFill><a:srgbClr val="${SERIES_COLORS[k % SERIES_COLORS.length]}"/></a:solidFill></c:spPr>`
    return `<c:ser><c:idx val="${k}"/><c:order val="${k}"/><c:tx><c:v>${esc(names[k] ?? '')}</c:v></c:tx>${fill}<c:invertIfNegative val="0"/><c:dLbls><c:numFmt formatCode="${fmt}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls><c:cat><c:strRef><c:f>${esc(ref(c.cat))}</c:f><c:strCache><c:ptCount val="${rows.length}"/>${cats}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>${esc(ref(v))}</c:f><c:numCache><c:formatCode>${fmt}</c:formatCode><c:ptCount val="${rows.length}"/>${pts}</c:numCache></c:numRef></c:val></c:ser>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:rPr b="1"><a:solidFill><a:srgbClr val="581447"/></a:solidFill></a:rPr><a:t>${esc(c.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="${col ? 'col' : 'bar'}"/><c:grouping val="clustered"/><c:varyColors val="${one ? 1 : 0}"/>${sers}<c:gapWidth val="${vals.length > 1 ? 80 : 60}"/>${vals.length > 1 ? '<c:overlap val="-10"/>' : ''}<c:axId val="500000001"/><c:axId val="500000002"/></c:barChart><c:catAx><c:axId val="500000001"/><c:scaling><c:orientation val="${col ? 'minMax' : 'maxMin'}"/></c:scaling><c:delete val="0"/><c:axPos val="${col ? 'b' : 'l'}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="500000002"/><c:scaling><c:orientation val="minMax"/>${c.pct ? '<c:max val="1"/><c:min val="0"/>' : ''}</c:scaling><c:delete val="0"/><c:axPos val="${col ? 'l' : 'b'}"/><c:majorGridlines><c:spPr><a:ln><a:solidFill><a:srgbClr val="E5E7EB"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="${fmt}" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`
}
const drawingXml = (c: Chart) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${c.at - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${c.cols ?? 6}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${c.at - 1 + (c.height ?? 18)}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`
const REL = (type: string, target: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`

// fonts: 0 plain, 1 bold, 2 bold white, 3 title (bold 16 purple), 4 bold red, 5 bold green, 6 bold amber
// fills: 0 none, 1 (Excel's own), 2 purple, 3 light red, 4 light green, 5 light amber, 6 light purple
// cellXfs: the indexes of X above
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="6"><numFmt numFmtId="164" formatCode="[h]:mm:ss"/><numFmt numFmtId="165" formatCode="h:mm AM/PM"/><numFmt numFmtId="166" formatCode="yyyy-mm-dd"/><numFmt numFmtId="167" formatCode="#,##0"/><numFmt numFmtId="168" formatCode="0.0%"/><numFmt numFmtId="169" formatCode="0.00"/></numFmts><fonts count="16"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FF581447"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFB91C1C"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF15803D"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFB45309"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font><font><b/><sz val="18"/><color rgb="FF581447"/><name val="Calibri"/></font><font><b/><sz val="13"/><color rgb="FF581447"/><name val="Calibri"/></font><font><sz val="9"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF86198F"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF075985"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF4A2C6E"/><name val="Calibri"/></font><font><i/><sz val="11"/><color rgb="FF581447"/><name val="Calibri"/></font></fonts><fills count="11"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF581447"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFDE2E1"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1DFEC"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF8F1F6"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFAE8FF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE0F2FE"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFE9F7"/></patternFill></fill></fills><borders count="4"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border><border><left style="thin"><color rgb="FFE5E7EB"/></left><right style="thin"><color rgb="FFE5E7EB"/></right><top style="thin"><color rgb="FFE5E7EB"/></top><bottom style="thin"><color rgb="FFE5E7EB"/></bottom><diagonal/></border><border><left/><right/><top/><bottom style="medium"><color rgb="FF581447"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="45"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="167" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/><xf numFmtId="167" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/><xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="6" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="168" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="6" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="169" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="167" fontId="6" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/><xf numFmtId="167" fontId="1" fillId="6" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="7" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf><xf numFmtId="0" fontId="15" fillId="7" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf><xf numFmtId="0" fontId="10" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf><xf numFmtId="167" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="169" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="167" fontId="5" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="167" fontId="4" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="167" fontId="6" fillId="5" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="169" fontId="5" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="169" fontId="4" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="169" fontId="6" fillId="5" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="168" fontId="5" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="168" fontId="4" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="168" fontId="6" fillId="5" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="168" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="8" fillId="7" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="9" fillId="7" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="11" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="12" fillId="8" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="13" fillId="9" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="14" fillId="10" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1" indent="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

type Zip = typeof import('fflate')
let zip: Zip | null = null
/** brings the zip library; it rejects when it cannot be fetched (no signal and never loaded on this device) */
export const loadZip = (): Promise<Zip> => (zip ? Promise.resolve(zip) : import('fflate').then((m) => (zip = m)))
/** the workbook as bytes */
export async function xlsxBytes(sheets: Sheet[]): Promise<Uint8Array<ArrayBuffer>> { return build(sheets, await loadZip()) }
/** the workbook as bytes, at once; null while the zip library has not loaded (see loadZip) */
export function xlsxNow(sheets: Sheet[]): Uint8Array<ArrayBuffer> | null { return zip ? build(sheets, zip) : null }
function build(sheets: Sheet[], { zipSync, strToU8 }: Zip): Uint8Array<ArrayBuffer> {
  const names = sheets.map((s, i) => { let n = sheetName(s.name); while (sheets.slice(0, i).some((o) => sheetName(o.name) === n)) n = (n + ' ' + (i + 1)).slice(0, 31); return n })
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}${sheets.map((sh, i) => (sh.chart ? `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>` : '')).join('')}</Types>`),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(STYLES),
  }
  sheets.forEach((sh, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sh))
    if (!sh.chart) return
    files[`xl/worksheets/_rels/sheet${i + 1}.xml.rels`] = strToU8(REL('drawing', `../drawings/drawing${i + 1}.xml`))
    files[`xl/drawings/drawing${i + 1}.xml`] = strToU8(drawingXml(sh.chart))
    files[`xl/drawings/_rels/drawing${i + 1}.xml.rels`] = strToU8(REL('chart', `../charts/chart${i + 1}.xml`))
    files[`xl/charts/chart${i + 1}.xml`] = strToU8(chartXml(sh, names[i]))
  })
  return new Uint8Array(zipSync(files, { level: 6 }))
}
