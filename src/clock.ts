import { supabase } from './supabase'
import { tr } from './i18n'

/**
 * One clock for every device.
 *
 * A device's own clock can be a second or two off (a PC), or minutes off when someone set it by hand. Then the same
 * line shows different times on two screens, and what two devices record on the same run does not line up. So the
 * app does not tell time by the device: it asks the server what moment it is and remembers how far the device's
 * clock is from it. "Now" is the device's clock plus that difference, the same on every screen.
 *
 * This is about the MOMENT, which is the same everywhere in the world; it has nothing to do with where the server
 * is. Hours and dates are still shown in the device's own time zone (see otherZone below).
 *
 * Without a server (the demo) each device is on its own and keeps its own clock.
 */
const KEY = 'act_clock'
const saved = (): number => { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null') as { offset?: number } | null; return s && Number.isFinite(s.offset) ? Number(s.offset) : 0 } catch { return 0 } }
/** server − device, in milliseconds. What was measured last time is used until a new measure arrives (also without signal) */
let offset = supabase ? saved() : 0
/** when the measure in use was taken, by the device's clock (0 = never: the device goes by its own clock) */
let savedAt = supabase ? ((): number => { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null') as { at?: number } | null; return s && Number.isFinite(s.at) ? Number(s.at) : 0 } catch { return 0 } })() : 0
/** the moment it is now, by the shared clock */
export const clockNow = () => Date.now() + offset
export const clockOffset = () => offset

export type Sample = { server: number; mid: number; rtt: number }
/**
 * How far the device's clock is from the server's, from answers the server stamped with its time to the second.
 * Each answer says "my second was S" at about the middle of its round trip, so the difference lies between
 * S − mid and S + 1 s − mid, give or take half the round trip. Answers taken at different moments within a second
 * narrow it down to about a tenth of a second. null when there are too few or they contradict each other (the
 * device's clock was moved while measuring).
 */
export function estimate(samples: Sample[]): { offset: number; within: number } | null {
  if (samples.length < 3) return null
  let lo = -Infinity, hi = Infinity
  for (const s of samples) { lo = Math.max(lo, s.server - s.mid - s.rtt / 2); hi = Math.min(hi, s.server + 1000 - s.mid + s.rtt / 2) }
  return lo <= hi ? { offset: Math.round((lo + hi) / 2), within: Math.round((hi - lo) / 2) } : null
}
/** takes a new measure of the difference; a change smaller than the measure's own precision is not worth a jump of the timers */
export function setOffset(ms: number) {
  if (!Number.isFinite(ms) || Math.abs(ms - offset) < 150) return
  offset = Math.round(ms)
  savedAt = Date.now()
  try { localStorage.setItem(KEY, JSON.stringify({ offset, at: savedAt })) } catch { /* private */ }
}
/**
 * What the screen can say about this device's clock: whether it was set by the server since the page opened, and
 * when the measure in use was taken (0 = never: the hours this device records and the timers it shows go by its own
 * clock, which nobody has checked).
 */
export const clockState = () => ({ measured: measuredAt > 0, rough: measuredAt > 0 && rough, savedAt })

/** the page's own stopwatch: it only goes forward and nobody can set it, unlike the device's clock */
const stopwatch = () => performance.now()
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
let measuring = false
/** when the clock was last set, by the stopwatch; 0 = not since the page opened */
let measuredAt = 0
/**
 * A measure good to within a tenth of a second needs quick answers. On a slow WiFi (the tablets on the floor) the
 * answers take a second or more and the measure is only good to a few seconds: still far better than a device's own
 * clock, which can be minutes off (what the office saw on 2026-10-16: a timer that never went back to zero). A rough
 * measure is used, and a better one is looked for every minute until it comes.
 */
export const PRECISE_MS = 700, ROUGH_MS = 5000
let rough = false
/** the measure in use may no longer hold: none was taken since the page opened, or the device's clock was set after it */
let stale = true

/** asks the server the time a few times and sets the shared clock by it. false = it could not be measured now */
export async function syncClock(): Promise<boolean> {
  if (!supabase || measuring) return false
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  measuring = true
  try {
    // Every answer of the server carries its time, also the one that turns away a device where nobody has signed in
    // yet. This is the lightest question there is: no rows come back.
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string
    const url = (import.meta.env.VITE_SUPABASE_URL as string) + '/rest/v1/act_targets?select=dept&limit=1'
    const session = await Promise.race([supabase.auth.getSession().then((r) => r.data.session, () => null), wait(3000).then(() => null)])
    const headers = { apikey: key, Authorization: 'Bearer ' + (session?.access_token ?? key) }
    const samples: Sample[] = []
    // two answers lost in a row: there is no signal worth measuring with now
    for (let i = 0, lost = 0; i < 8 && lost < 2; i++) {
      const stop = new AbortController(), late = setTimeout(() => stop.abort(), 4000)
      try {
        const wall = Date.now(), t0 = stopwatch()
        const res = await fetch(url, { method: 'HEAD', headers, cache: 'no-store', signal: stop.signal })
        const rtt = stopwatch() - t0, server = Date.parse(res.headers.get('date') ?? '')
        if (Number.isFinite(server)) { samples.push({ server, mid: wall + rtt / 2, rtt }); lost = 0 } else lost++
      } catch { lost++ } finally { clearTimeout(late) }
      await wait(137) // not a round number: each answer catches the server at another point of its second
    }
    const e = estimate(samples)
    if (!e || e.within > ROUGH_MS) return false
    // a rough measure (slow answers) is not taken over a precise one already in use since the page opened
    if (e.within > PRECISE_MS && measuredAt > 0 && !rough && !stale) return false
    setOffset(e.offset)
    measuredAt = Math.max(1, stopwatch())
    rough = e.within > PRECISE_MS
    stale = rough // a rough measure keeps looking for a better one
    return true
  } catch { return false } finally { measuring = false }
}

// ---- keeping it set ----
let wall0 = 0, watch0 = 0
/**
 * true when the device's clock was set since the last look: it moved and the stopwatch did not. (On some devices the
 * stopwatch pauses while they sleep, which looks the same; a new measure is right then too.)
 */
function moved() {
  const wall = Date.now(), watch = stopwatch(), jump = Math.abs((wall - wall0) - (watch - watch0))
  wall0 = wall; watch0 = watch
  return jump > 500
}
/** measures again when the one in use may no longer hold (the device's clock was moved, or the measure is rough), or is a quarter of an hour old */
export function lookAtClock(): Promise<boolean> {
  if (moved()) stale = true
  return stale || stopwatch() - measuredAt > 900_000 ? syncClock() : Promise.resolve(false)
}
let started = false
/**
 * Sets the clock now and keeps it set: whenever the signal comes back, whenever the app returns to the screen or a
 * minute passes and the device's clock was touched meanwhile, and every quarter of an hour. Calling it again (after
 * signing in) only measures if the first try, at the sign-in screen, did not get through.
 */
export function startClock() {
  if (!supabase) return
  if (stale) void syncClock()
  if (started) return
  started = true
  wall0 = Date.now(); watch0 = stopwatch()
  window.addEventListener('online', () => { void syncClock() })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void lookAtClock() })
  setInterval(() => { void lookAtClock() }, 60_000)
}

/**
 * How far the device's own clock is from the real time, in words ("5 min adelantado"). '' when it is under a minute,
 * which nobody would notice. Worth telling: the hours the app shows are then not the ones on the device's own clock.
 */
export function clockOffText(off = offset): string {
  const s = Math.abs(off) / 1000
  if (s < 60) return ''
  const much = s < 5400 ? Math.round(s / 60) + ' min' : s < 172_800 ? String(Math.round(s / 360) / 10).replace('.', ',') + ' h' : tr('{0} días', Math.round(s / 86_400))
  return much + (off < 0 ? ' ' + tr('adelantado') : ' ' + tr('atrasado'))
}

// ---- the time zone: every hour and date on the screen is the device's own ----
/** the plant's time zone (New Jersey) */
export const PLANT_ZONE = (import.meta.env.VITE_PLANT_ZONE as string | undefined) || 'America/New_York'
const formats = new Map<string, Intl.DateTimeFormat>()
const formatOf = (zone: string) => {
  let f = formats.get(zone)
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); formats.set(zone, f) }
  return f
}
/** how many minutes a zone is ahead of universal time at a moment (−240 for the plant in summer, −300 in winter) */
export function zoneMinutes(zone: string, at: number): number {
  const p = Object.fromEntries(formatOf(zone).formatToParts(new Date(at)).map((x) => [x.type, x.value]))
  return Math.round((Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(at / 1000) * 1000) / 60_000)
}
/** true when this device is set to another time zone than the plant's: its hours and dates would come out shifted */
export function otherZone(at = clockNow()): boolean {
  try { return zoneMinutes(PLANT_ZONE, at) !== -new Date(at).getTimezoneOffset() } catch { return false }
}
