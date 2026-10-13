import { tr } from './i18n'
/**
 * Handing the day's report to another app (mail, WhatsApp…). Each browser lets a page share different kinds of file:
 * Safari on the iPhone takes the PDF and the Excel; Chrome (Android tablets, PCs) refuses Excel files but takes the
 * PDF and a CSV; some browsers share nothing at all. So the app asks the browser what it takes and offers that, and
 * the two files can always be downloaded one by one.
 */
export type Kind = 'pdf' | 'xlsx' | 'csv'
export type SharePick = { files: Kind[]; label: string; note: string }

/** what to offer on this browser, the fullest first; null = this browser shares no files (only the downloads are offered) */
export function sharePick(can: (files: Kind[]) => boolean): SharePick | null {
  const ask = (files: Kind[]) => { try { return can(files) } catch { return false } }
  if (ask(['pdf', 'xlsx'])) return { files: ['pdf', 'xlsx'], label: tr('Compartir PDF y Excel'), note: '' }
  if (ask(['pdf', 'csv'])) return { files: ['pdf', 'csv'], label: tr('Compartir PDF y CSV'), note: tr('Este navegador no deja compartir archivos de Excel. Va el CSV, que también se abre con Excel. El Excel se descarga con el botón de abajo.') }
  if (ask(['pdf'])) return { files: ['pdf'], label: tr('Compartir PDF'), note: tr('Este navegador solo deja compartir el PDF. El Excel se descarga con el botón de abajo.') }
  return null
}

/** what to tell the person when the share sheet did not open; '' when they simply closed it */
export function shareProblem(error: unknown): string {
  const name = String((error as { name?: string } | null)?.name ?? '')
  if (name === 'AbortError') return ''
  return tr('No se pudo abrir la hoja de compartir en este aparato. Descarga los archivos con los botones de abajo y adjúntalos al correo o al mensaje.')
}

/** an iPhone or iPad running the app from its home-screen icon: there a PDF cannot be opened in a new tab, so it is downloaded */
export function homeScreenApple(nav: { userAgent?: string; platform?: string; maxTouchPoints?: number; standalone?: boolean }): boolean {
  const apple = /iPad|iPhone|iPod/.test(nav.userAgent ?? '') || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1)
  return apple && nav.standalone === true
}
