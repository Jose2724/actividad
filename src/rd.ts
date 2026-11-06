import { supabase } from './supabase'
/**
 * The redesign of 2026-11-05 (Jose: "rediseñar la web app completa, poner las cosas donde van ... que se vea todo
 * profesionalmente"; the catalogue he approved the same day): sections with a rail or a bottom bar, one status strip,
 * a menu under one's name, grouped settings, one search for everything and a summary for the bosses.
 *
 * It is on in the DEMO (no server) for Jose to show the bosses, and off on the live app until he says "Publícalo";
 * a device of the live app can try it with localStorage act_rd = "1" (and leave it with "0").
 */
const kept = (() => { try { return localStorage.getItem('act_rd') } catch { return null } })()
export const RD: boolean = kept === '1' ? true : kept === '0' ? false : !supabase

/**
 * The redesign keeps its own light colours (Jose, 2026-11-05: a window "sale casi del mismo color que el de abajo ... me
 * gustaría que tenga mejor colores para que se note mejor todo"): his browser darkens every page by itself, and its
 * guess turned the windows, the cards and the page all the same dark grey. "only light" asks the browser not to repaint
 * the page; darkreader-lock tells the Dark Reader extension the same
 */
if (RD && typeof document !== 'undefined') {
  document.documentElement.style.colorScheme = 'only light'
  for (const [name, content] of [['color-scheme', 'only light'], ['darkreader-lock', '']]) {
    const m = document.createElement('meta'); m.name = name; m.content = content; document.head.appendChild(m)
  }
}
