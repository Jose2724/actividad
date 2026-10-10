// Keeps the app opening on the tablet when the WiFi drops: the page and its files are kept in a cache.
// The page is fetched from the network first (so a new build arrives as soon as there is signal) and served
// from the cache when there is none; the hashed files under assets/ never change, so they come from the cache.
const CACHE = 'actividad-v1'
const BASE = new URL(self.registration.scope).pathname
self.addEventListener('install', (e) => {
  // the page plus the files it names, so the app opens offline right after the first visit
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    const res = await fetch(BASE, { cache: 'no-cache' })
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
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(BASE, copy)); return res }).catch(() => caches.match(BASE)))
    return
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) } return res })))
})
