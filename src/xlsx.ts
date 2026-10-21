import { tr } from './i18n'
/**
 * A real Excel workbook (.xlsx) written here, without a spreadsheet library: one sheet per table, a bold frozen
 * header row, numbers as numbers, times and spans as Excel times (so the office can sort and add them). An .xlsx is a
 * zip of small XML files; the zip comes from fflate, loaded once (when the report opens, or in the background after
 * the app starts) so that a tap can make the file at once.
 */
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
/** a cell: text, a number, blank, or an Excel number with a style (2 span [h]:mm:ss, 3 time of day, 4 date, 5 percent) and its text for the CSV */
export type Cell = string | number | null | undefined | { v: number; s: 2 | 3 | 4 | 5; t: string }
/**
 * A sheet may carry one bar chart drawn by Excel itself from its own cells (Santiago's attendance, 2026-10-20: "también
 * con los gráficos en excel"): the categories in column cat and the values in column val, rows from..to (counted from
 * 1, as Excel does), placed under the table from row at. Horizontal bars, one colour each, the values as % labels when
 * pct.
 */
export type Chart = { title: string; series: string; cat: number; val: number; from: number; to: number; at: number; pct?: boolean }
export type Sheet = { name: string; rows: Cell[][]; chart?: Chart }

const DAY = 86_400_000
/** a span of time (shown as [h]:mm:ss, summable) */
export const xDur = (ms: number, text: string): Cell => ({ v: Math.max(0, ms) / DAY, s: 2, t: text })
/** a moment, as the local time of day on its date (sortable) */
export const xTime = (ms: number, text: string): Cell => { const d = new Date(ms); return { v: Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) / DAY + 25569, s: 3, t: text } }
/** a date written as YYYY-MM-DD */
export const xDay = (ymd: string): Cell => { const [y, m, d] = ymd.split('-').map(Number); return y && m && d ? { v: Date.UTC(y, m - 1, d) / DAY + 25569, s: 4, t: ymd } : ymd }
/** a share (0.17 is 17%), shown as a percent */
export const xPct = (x: number): Cell => ({ v: Math.round(x * 10000) / 10000, s: 5, t: Math.round(x * 100) + '%' })
/** what a cell says, for the CSV */
export const cellText = (c: Cell) => (c == null ? '' : typeof c === 'object' ? c.t : String(c))

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
const colName = (n: number) => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
const sheetName = (s: string) => s.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || tr('Hoja')

function sheetXml(sh: Sheet) {
  const widths: number[] = []
  const rows = sh.rows.map((r, i) => {
    const cells = r.map((c, j) => {
      const text = cellText(c)
      widths[j] = Math.max(widths[j] ?? 0, Math.min(60, typeof c === 'object' && c ? 12 : text.length))
      if (c == null || c === '') return ''
      const ref = colName(j) + (i + 1)
      if (typeof c === 'number') return Number.isFinite(c) ? `<c r="${ref}"><v>${c}</v></c>` : ''
      if (typeof c === 'object') return `<c r="${ref}" s="${c.s}"><v>${c.v}</v></c>`
      return `<c r="${ref}"${i === 0 ? ' s="1"' : ''} t="inlineStr"><is><t xml:space="preserve">${esc(clean(c))}</t></is></c>`
    }).join('')
    return `<row r="${i + 1}">${cells}</row>`
  }).join('')
  const cols = widths.length ? `<cols>${widths.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${Math.max(8, w + 2)}" customWidth="1"/>`).join('')}</cols>` : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${sh.chart ? '<drawing r:id="rId1"/>' : ''}</worksheet>`
}

/** the chart of a sheet: its drawing (where it sits) and the chart itself, with the cells' values cached as Excel does */
function chartXml(sh: Sheet, name: string): string {
  const c = sh.chart!, q = "'" + name.replace(/'/g, "''") + "'"
  const ref = (col: number) => `${q}!$${colName(col)}$${c.from}:$${colName(col)}$${c.to}`
  const rows = sh.rows.slice(c.from - 1, c.to)
  const cats = rows.map((r, i) => `<c:pt idx="${i}"><c:v>${esc(cellText(r[c.cat]))}</c:v></c:pt>`).join('')
  const vals = rows.map((r, i) => { const x = r[c.val]; const v = typeof x === 'object' && x ? x.v : Number(x); return Number.isFinite(v) ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : '' }).join('')
  const fmt = c.pct ? '0%' : 'General'
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${esc(c.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${esc(c.series)}</c:v></c:tx><c:invertIfNegative val="0"/><c:dLbls><c:numFmt formatCode="${fmt}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls><c:cat><c:strRef><c:f>${esc(ref(c.cat))}</c:f><c:strCache><c:ptCount val="${rows.length}"/>${cats}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>${esc(ref(c.val))}</c:f><c:numCache><c:formatCode>${fmt}</c:formatCode><c:ptCount val="${rows.length}"/>${vals}</c:numCache></c:numRef></c:val></c:ser><c:gapWidth val="60"/><c:axId val="500000001"/><c:axId val="500000002"/></c:barChart><c:catAx><c:axId val="500000001"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="500000002"/><c:scaling><c:orientation val="minMax"/>${c.pct ? '<c:max val="1"/><c:min val="0"/>' : ''}</c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorGridlines/><c:numFmt formatCode="${fmt}" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`
}
const drawingXml = (c: Chart) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${c.at - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${c.at + 17}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`
const REL = (type: string, target: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="[h]:mm:ss"/><numFmt numFmtId="165" formatCode="h:mm AM/PM"/><numFmt numFmtId="166" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

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
