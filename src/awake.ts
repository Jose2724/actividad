/**
 * A tablet on the floor must not go to sleep in the middle of a shift: a dark screen stops the app from talking to
 * the server (its word to the office, its downloads) and makes the person wake it up before each tap. While the app
 * is open and on the screen it asks the device to keep the screen on (where the browser allows it: Chrome, Edge and
 * Safari of recent years); when the page is hidden the request is let go and taken again on coming back.
 * The device's own settings still rule: this only asks.
 */
type WakeLock = { release: () => Promise<void>; addEventListener: (t: 'release', f: () => void) => void }
let lock: WakeLock | null = null
async function take() {
  if (lock || typeof document === 'undefined' || document.visibilityState !== 'visible') return
  const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLock> } }
  if (!nav.wakeLock) return
  try { const l = await nav.wakeLock.request('screen'); lock = l; l.addEventListener('release', () => { if (lock === l) lock = null }) } catch { /* not allowed here (low battery, a setting): nothing to do */ }
}
/** keeps the screen on while the app is open; returns what undoes it */
export function keepAwake(): () => void {
  void take()
  const back = () => { if (document.visibilityState === 'visible') void take() }
  document.addEventListener('visibilitychange', back)
  return () => { document.removeEventListener('visibilitychange', back); void lock?.release(); lock = null }
}
