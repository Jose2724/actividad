/**
 * Saving on the device can fail: a browser gives each app a few megabytes and no more. That must never happen in
 * silence, because what is not saved is lost when the app is closed. Whoever saves (the store, the upload queue)
 * raises this flag when a save fails and lowers it when one works again; the screen shows a warning while it is up.
 */
let full = false
const subs = new Set<() => void>()
export const storageFull = {
  get: () => full,
  set(v: boolean) { if (v !== full) { full = v; subs.forEach((f) => f()) } },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f) } },
}
