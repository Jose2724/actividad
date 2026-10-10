/**
 * A real Excel workbook (.xlsx) written here, without a spreadsheet library: one sheet per table, a bold frozen
 * header row, numbers as numbers, times and spans as Excel times (so the office can sort and add them). An .xlsx is a
 * zip of small XML files; the zip comes from fflate, loaded only when a file is made.
 */
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
/** a cell: text, a number, blank, or an Excel number with a style (2 span [h]:mm:ss, 3 time of day, 4 date) and its text for the CSV */
export type Cell = string | number | null | undefined | { v: number; s: 2 | 3 | 4; t: string }
export type Sheet = { name: string; rows: Cell[][] }

const DAY = 86_400_000
/** a span of time (shown as [h]:mm:ss, summable) */
export const xDur = (ms: number, text: string): Cell => ({ v: Math.max(0, ms) / DAY, s: 2, t: text })
/** a moment, as the local time of day on its date (sortable) */
export const xTime = (ms: number, text: string): Cell => { const d = new Date(ms); return { v: Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) / DAY + 25569, s: 3, t: text } }
/** a date written as YYYY-MM-DD */
export const xDay = (ymd: string): Cell => { const [y, m, d] = ymd.split('-').map(Number); return y && m && d ? { v: Date.UTC(y, m - 1, d) / DAY + 25569, s: 4, t: ymd } : ymd }
/** what a cell says, for the CSV */
export const cellText = (c: Cell) => (c == null ? '' : typeof c === 'object' ? c.t : String(c))

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
const colName = (n: number) => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
const sheetName = (s: string) => s.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Hoja'

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
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData></worksheet>`
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="[h]:mm:ss"/><numFmt numFmtId="165" formatCode="h:mm AM/PM"/><numFmt numFmtId="166" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

/** the workbook as bytes */
export async function xlsxBytes(sheets: Sheet[]): Promise<Uint8Array<ArrayBuffer>> {
  const { zipSync, strToU8 } = await import('fflate')
  const names = sheets.map((s, i) => { let n = sheetName(s.name); while (sheets.slice(0, i).some((o) => sheetName(o.name) === n)) n = (n + ' ' + (i + 1)).slice(0, 31); return n })
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(STYLES),
  }
  sheets.forEach((sh, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sh)) })
  return new Uint8Array(zipSync(files, { level: 6 }))
}
