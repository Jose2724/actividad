import { EN } from './en'

/**
 * The language of the screens: Spanish as the plant speaks it (with the English words everybody there uses: Set up,
 * Break, Waste, pouches, pallets…), or English.
 *
 * The texts are written in Spanish where they are used, inside tr(): that is the key. In English the same text is
 * looked up in en.ts; one that is not there yet shows in Spanish, so nothing ever comes out blank. The choice is of
 * the device (a tablet at the line and the office PC need not agree) and is read once, when the app loads: changing
 * it reloads the app, so every text, also the ones written at the top of a file, comes out in the new language.
 *
 * What is DATA stays as it was written, in any language: the causes of the stops and the names of the lines are kept
 * in Spanish and only shown translated (tr(reason)); the history keeps the words of whoever made the change.
 */
export type Lang = 'es' | 'en'
const KEY = 'act_lang'
const read = (): Lang => { try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'es' } catch { return 'es' } }
export const lang: Lang = read()
/** the choice for the next time the app loads (the caller reloads it) */
export function saveLang(l: Lang) { try { localStorage.setItem(KEY, l) } catch { /* a device that cannot keep it stays in Spanish */ } }
/** the locale for dates: "lunes, 12 de octubre" or "Monday, October 12" */
export const locale = lang === 'en' ? 'en-US' : 'es'

/**
 * the text of a key in the language in use, before its pieces are put in. Only en.ts's own texts: a cause typed under
 * "Otra" is shown through here too, and one typed as "__proto__" or "constructor" found what every object has and
 * left the screen blank in English (audit 2026-10-17, H2). (hasOwnProperty.call, not Object.hasOwn: older tablet
 * browsers lack that one)
 */
export const phrase = (key: string, l: Lang = lang): string => (l === 'en' && Object.prototype.hasOwnProperty.call(EN, key) ? EN[key] ?? key : key)
/** a text of the screen: tr('Se ven {0} de {1}', shown, total). {0}, {1}… are the pieces, in the order they are given */
export function tr(key: string, ...pieces: unknown[]): string {
  const out = phrase(key)
  return pieces.length ? out.replace(/\{(\d+)\}/g, (_, i: string) => String(pieces[Number(i)] ?? '')) : out
}
/** the same in a given language, whatever the device shows (the checks, and a file made for somebody else) */
export function trIn(l: Lang, key: string, ...pieces: unknown[]): string {
  const out = phrase(key, l)
  return pieces.length ? out.replace(/\{(\d+)\}/g, (_, i: string) => String(pieces[Number(i)] ?? '')) : out
}
