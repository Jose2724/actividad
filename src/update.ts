import { tr } from './i18n'
import { storageFull } from './storage'

/**
 * The tablets run the app in the browser and keep it open for days: a new build published on the server would go on
 * unseen until someone closed and opened the page (Jose, 2026-10-16: every tablet had to be told to). Each build
 * carries its id in the page (<meta name="act-build">, see vite.config.ts) and publishes it in version.json. The page
 * asks for that file every few minutes, when it comes back to the screen and when the signal comes back; a different
 * id means a new version is up. Then a bar says so with a button, and the page reloads by itself as soon as nobody is
 * in the middle of something: a minute without a tap, no window open, nothing being typed. What the app holds is on
 * the device (and the queue of what has not gone up yet), so a reload loses nothing; except when the device's storage
 * is full, and then nothing reloads it (see quietToReload).
 */
export const BUILD = typeof document !== 'undefined' && typeof document.querySelector === 'function' ? document.querySelector('meta[name="act-build"]')?.getAttribute('content') ?? '' : ''
const real = (b: string) => !!b && b !== 'dev' && b !== '__BUILD__'

type UpdateState = { ready: boolean; build: string }
let state: UpdateState = { ready: false, build: '' }
const subs = new Set<() => void>()
export const updateStore = { get: () => state, subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f) } } }

/**
 * true when the page can be reloaded without losing what someone is doing. `held` = the device's storage is full: what
 * was recorded lately, and maybe the queue of what has not gone up, is only in the page's memory, and a reload throws
 * it away without a word (audit 2026-10-17, S9). Then nothing reloads the page, by itself or by a tap (see reloadHeld),
 * until there is room again.
 */
export const quietToReload = (now: number, lastTouchAt: number, dialogOpen: boolean, typing: boolean, held: boolean = storageFull.get()) => now - lastTouchAt > 60_000 && !dialogOpen && !typing && !held
/** a reload now would lose what is only in memory (see quietToReload): the buttons that reload ("Actualizar", the language, "Recargar") say so instead */
export const reloadHeld = () => storageFull.get()

async function check() {
  if (!real(BUILD)) return
  try {
    const res = await fetch(import.meta.env.BASE_URL + 'version.json?t=' + Date.now(), { cache: 'no-store' })
    if (!res.ok) return
    const got = (await res.json()) as { build?: unknown }
    const build = typeof got.build === 'string' ? got.build : ''
    if (real(build) && build !== BUILD && build !== state.build) { state = { ready: true, build }; subs.forEach((f) => f()) }
  } catch { /* no signal: asked again later */ }
}

const VIEW = 'act_view' // where the person was (room and tab), so the page comes back to it after the reload
export function keepView(view: unknown) { try { sessionStorage.setItem(VIEW, JSON.stringify(view)) } catch { /* private */ } }
export function viewKept<T>(): T | null { try { const v = sessionStorage.getItem(VIEW); return v ? (JSON.parse(v) as T) : null } catch { return null } }

/** reloads the page, unless that would lose what is only in memory (false: nothing was done) */
export function reloadNow(): boolean { if (reloadHeld()) return false; location.reload(); return true }

let lastTouch = Date.now()
const typingNow = () => { const el = document.activeElement; return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && (el as HTMLInputElement).type !== 'date' }
export function startUpdateWatch() {
  if (typeof window === 'undefined' || !real(BUILD)) return
  const touch = () => { lastTouch = Date.now() }
  window.addEventListener('pointerdown', touch, { passive: true })
  window.addEventListener('keydown', touch)
  void check()
  setInterval(() => { void check() }, 3 * 60_000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check() })
  window.addEventListener('online', () => { void check() })
  setInterval(() => { if (state.ready && quietToReload(Date.now(), lastTouch, !!document.querySelector('.veil'), typingNow(), reloadHeld())) reloadNow() }, 10_000)
}
/** the words of the bar (`held`: the storage is full, and the new version waits for room, see quietToReload) */
export const updateText = (held = false) => (held ? tr('⬆ Hay una versión nueva de la app. Se pone cuando la memoria de este aparato tenga espacio otra vez: recargar ahora perdería lo que no se ha podido guardar aquí.') : tr('⬆ Hay una versión nueva de la app. Se pone sola en un momento, cuando nadie esté tocando la pantalla; o toca Actualizar ahora.'))
