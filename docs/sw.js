// Keeps the app opening on the tablet when the WiFi drops: the page and its files are kept in a cache.
// The page and the app's manifest (its name and icon) are fetched from the network first, so a new build arrives as
// soon as there is signal, and served from the cache when there is none; the hashed files under assets/ never
// change, so they come from the cache.
const CACHE = 'actividad-v1'
const BASE = new URL(self.registration.scope).pathname
self.addEventListener('install', (e) => {
  // the page plus the files it names, so the app opens offline right after the first visit
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    const res = await fetch(BASE, { cache: 'no-cache' })
    // an error page is not the app: the install fails, and the worker before (with its good copy) stays
    if (!res.ok) throw new Error('shell ' + res.status)
    await c.put(BASE, res.clone())
    const html = await res.text()
    const files = [...new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => u.startsWith(BASE) && !u.endsWith('sw.js')))]
    await Promise.all(files.map((u) => c.add(u).catch(() => undefined)))
  }).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin || !url.pathname.startsWith(BASE)) return
  if (req.mode === 'navigate') {
    // Only the app's own page, as it came back whole, is kept as the copy that opens without WiFi. Any page opened on
    // this site used to replace it: a mistyped link's 404, version.json opened by hand, a server error; and the next
    // start without signal showed that instead of the app (audit 2026-10-17, H3)
    const shell = url.pathname === BASE || url.pathname === BASE + 'index.html'
    e.respondWith(fetch(req).then((res) => { if (shell && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(BASE, copy)) } return res }).catch(() => caches.match(BASE)))
    return
  }
  const keep = (res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) } return res }
  if (url.pathname.endsWith('version.json')) { e.respondWith(fetch(req, { cache: 'no-store' })); return } // which build is up: always asked of the network
  if (url.pathname.endsWith('.webmanifest')) { e.respondWith(fetch(req, { cache: 'no-cache' }).then(keep).catch(() => caches.match(req))); return }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(keep)))
})
