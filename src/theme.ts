import { RD } from './rd'
/**
 * Light or dark (Jose, 2026-11-05: "me gusta también el theme negro ... que puedan seleccionar theme claro o oscuro"):
 * chosen on each device in the menu under one's name, kept in localStorage act_theme; dark until changed. "auto" follows the device. Only
 * the redesign has the dark colours (dark.css, made by tools/dark-css.py); the page is told its own colours, so the
 * browser does not darken it by its own guess (what made windows and the page the same grey, 2026-11-05).
 */
export type ThemePick = 'light' | 'dark' | 'auto'
const KEY = 'act_theme'
// dark unless the device chose otherwise (Jose, 2026-11-05: "que el theme oscuro sea el por defecto")
export const themePick = (): ThemePick => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'auto' ? v : 'dark' } catch { return 'dark' } }
const deviceDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
/** the theme in use on this page: read once, when the app opens (a change reloads it, as the language does) */
export const DARK: boolean = RD && (themePick() === 'dark' || (themePick() === 'auto' && deviceDark()))
export function saveTheme(t: ThemePick) { try { localStorage.setItem(KEY, t) } catch { /* private window */ } }

if (RD && typeof document !== 'undefined') {
  const scheme = DARK ? 'only dark' : 'only light'
  document.documentElement.dataset.theme = DARK ? 'dark' : 'light'
  document.documentElement.style.colorScheme = scheme
  for (const [name, content] of [['color-scheme', scheme], ['darkreader-lock', '']]) {
    const m = document.createElement('meta'); m.name = name; m.content = content; document.head.appendChild(m)
  }
}
