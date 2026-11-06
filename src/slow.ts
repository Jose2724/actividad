/**
 * The app's clock ticks every second for the floor's live timers. A big screen that does not show seconds (a report,
 * the indicators, a program) is drawn again only when its data change, and reads the clock every 15 s: drawing it each
 * second made scrolling and taps wait (Jose, 2026-11-06: "estoy haciendo scroll y tiene como delay ... a veces quiero
 * dar click y se nota un delay").
 */
export const slowClock = (now: number) => Math.floor(now / 15_000) * 15_000

/** props equal for drawing: the same data; a function is a new arrow each time that does the same thing; a list by its items */
export function sameData<P extends object>(a: P, b: P): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof P>
  for (const k of keys) {
    const x = a[k], y = b[k]
    if (x === y || (typeof x === 'function' && typeof y === 'function')) continue
    if (Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, i) => v === y[i])) continue
    return false
  }
  return true
}
