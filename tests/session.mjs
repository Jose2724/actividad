// Staying signed in: the real Supabase library, the app's own code, and a stand-in for the sign-in server whose clock
// is the true time. The device's clock and the page's stopwatch are ours to move. Nothing leaves the machine; every
// person and password here is made up. Run by: npm run check
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

// ---- the device: its storage, its clock (true time + skew) and its stopwatch ----
const disk = new Map()
const storage = { getItem: (k) => (disk.has(k) ? disk.get(k) : null), setItem: (k, v) => { disk.set(k, String(v)) }, removeItem: (k) => { disk.delete(k) }, key: (i) => [...disk.keys()][i] ?? null, get length() { return disk.size } }
Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage })
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true }, localStorage: storage, location: new URL('http://localhost/') }
globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' }
const kept = { asked: 0 }
Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { onLine: true, userAgent: 'node', storage: { persist: async () => { kept.asked++; return true } } } })
const realNow = Date.now.bind(Date), realWatch = performance.now.bind(performance)
let passed_ms = 0 // time gone by since the test began, for everyone
let skew = 0 // how far the DEVICE's clock is from the true time (ms): + ahead, − behind
let watch = 0 // extra time on the page's stopwatch
const trueNow = () => realNow() + passed_ms
Date.now = () => trueNow() + skew
Object.defineProperty(globalThis, 'performance', { configurable: true, writable: true, value: { now: () => realWatch() + passed_ms + watch } })
/** lets time go by for the server, the device and the stopwatch alike */
const later = (seconds) => { passed_ms += seconds * 1000 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const H = 3600

// ---- the stand-in sign-in server ----
const server = { n: 0, passes: new Map(), renewals: 0, renewal: 'ok', retryAfter: '', logouts: [], logout: 'ok', held: [], rejected: 0, rest: 0 }
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const issue = (email) => {
  const n = ++server.n, access_token = 'pase.' + n + '.x'
  server.passes.set(access_token, trueNow())
  // like the real one, it says when the pass expires by ITS clock
  return { access_token, token_type: 'bearer', expires_in: H, expires_at: Math.floor(trueNow() / 1000) + H, refresh_token: 'renueva-' + n, user: { id: 'u1', aud: 'authenticated', email } }
}
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url), h = new Headers(init.headers)
  if (url.pathname.endsWith('/auth/v1/token')) {
    const body = JSON.parse(init.body || '{}')
    if (url.searchParams.get('grant_type') === 'password') return body.password === 'mal' ? json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }) : json(200, issue(body.email))
    server.renewals++
    if (server.renewal === 'down') throw new TypeError('fetch failed')
    if (server.renewal === 'busy') { later(31); return json(429, { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' }, server.retryAfter ? { 'Retry-After': server.retryAfter } : {}) }
    if (server.renewal === 'gone') return json(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' })
    return json(200, issue('quien@sea'))
  }
  if (url.pathname.endsWith('/auth/v1/logout')) {
    server.logouts.push(h.get('authorization'))
    if (server.logout === 'hang') await new Promise((r) => server.held.push(r))
    return new Response(null, { status: 204 })
  }
  if (url.pathname.includes('/rest/v1/')) {
    if (init.method === 'HEAD') return new Response(null, { status: 200, headers: { Date: new Date(Math.floor(trueNow() / 1000) * 1000).toUTCString() } })
    server.rest++
    const issued = server.passes.get((h.get('authorization') || '').replace(/^Bearer /, ''))
    if (issued === undefined) return json(401, { code: '42501', message: 'permission denied' })
    if (trueNow() - issued > H * 1000) { server.rejected++; return json(401, { code: 'PGRST301', message: 'JWT expired' }) }
    return json(200, url.pathname.endsWith('/employees') ? [{ id: 'e1', name: 'Prueba', username: 'prueba.rte', role: 'requester', act_role: 'op', act_dept: 'RTE', active: true }] : [])
  }
  return json(404, {})
}

const m = await import(pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/.cache/act-check/device.js')).href)
m.supabase.auth.stopAutoRefresh() // every renewal in here is one the test asked for: the counts are exact

const KEY = 'sb-127-auth-token'
const stored = () => JSON.parse(disk.get(KEY) || 'null')
const enter = async (email = 'prueba@freezer.example.com') => { const { error } = await m.supabase.auth.signInWithPassword({ email, password: 'inventada' }); return error ? error.message : 'dentro' }
/** 'nobody' = the app would show the sign-in screen; 'someone' = confirmed; 'unknown' = cannot tell now, the person stays in */
const who = async () => { try { const r = await m.fetchMe(); return r === null ? 'nobody' : r === 'none' ? 'no role' : 'someone' } catch { return 'unknown' } }
const fresh = async () => { await m.signOutHere(); disk.clear(); skew = 0; later(120); Object.assign(server, { renewals: 0, renewal: 'ok', retryAfter: '', logouts: [], logout: 'ok', held: [], rejected: 0, rest: 0 }) }
const left = () => Math.round(stored().expires_at - Date.now() / 1000) // seconds the device believes the pass still has
let passed = 0
const failed = []
const eq = (what, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) passed++; else failed.push(`${what}\n      salió    ${JSON.stringify(got)}\n      esperado ${JSON.stringify(want)}`) }
const about = (n, want, by = 5) => Math.abs(n - want) <= by

console.log('· El reloj del aparato no decide cuándo se renueva la sesión')
eq('entra', await enter(), 'dentro')
eq('reloj en hora: el aparato cuenta una hora de pase', about(left(), H), true)
for (let i = 0; i < 20; i++) await m.supabase.auth.getSession()
eq('y no pide renovarlo mientras dura', [server.renewals, await who()], [0, 'someone'])

await fresh(); skew = 2 * H * 1000 // a tablet set two hours ahead
eq('tablet 2 horas adelantada: entra', await enter(), 'dentro')
eq('según el servidor ese pase "venció hace una hora" en el reloj de la tablet', server.passes.size > 0 && Math.floor(trueNow() / 1000) + H < Date.now() / 1000, true)
eq('pero la tablet cuenta su hora completa', about(left(), H), true)
for (let i = 0; i < 20; i++) await m.supabase.auth.getSession()
eq('y no renueva en cada petición (antes: 20 de 20)', [server.renewals, await who(), server.rejected], [0, 'someone', 0])

await fresh(); skew = -2 * H * 1000 // a tablet set two hours behind
eq('tablet 2 horas atrasada: entra', await enter(), 'dentro')
eq('cuenta una hora, no tres', about(left(), H), true)
later(H - 60) // one minute before the pass really expires
eq('renueva a tiempo, antes de que el servidor lo rechace', [await who(), server.renewals, server.rejected], ['someone', 1, 0])
later(H - 60)
eq('y otra vez a la hora siguiente', [await who(), server.renewals, server.rejected], ['someone', 2, 0])

console.log('· Un servidor ocupado no saca a nadie')
await fresh()
await enter()
later(2 * H) // the tablet slept two hours: its pass has expired
server.renewal = 'busy'
eq('servidor ocupado al despertar: no se sabe, la persona se queda dentro', await who(), 'unknown')
eq('su sesión sigue en el aparato', !!stored()?.refresh_token, true)
const asked = server.renewals
for (let i = 0; i < 5; i++) await who()
eq('y no se insiste mientras tanto', server.renewals, asked)
server.renewal = 'ok'; later(61)
eq('cuando el servidor vuelve a atender, sigue dentro sin hacer nada', [await who(), server.renewals], ['someone', asked + 1])

console.log('· Sin señal tampoco')
await fresh()
await enter()
later(2 * H)
server.renewal = 'down'
const t0 = realNow()
eq('pase vencido y sin señal: la persona se queda dentro', await who(), 'unknown')
eq('y su sesión sigue en el aparato', !!stored()?.refresh_token, true)
later(Math.ceil((realNow() - t0) / 1000)) // (the library kept trying for a while: that time went by for the server too)
server.renewal = 'ok'; later(61)
eq('al volver la señal sigue dentro', await who(), 'someone')

console.log('· Solo el servidor de sesiones, con sus propias palabras, termina una sesión')
await fresh()
await enter()
later(2 * H)
server.renewal = 'gone' // the PIN was changed, or the account closed
eq('sesión cerrada por el servidor: pantalla de entrar', [await who(), stored()], ['nobody', null])
{
  const renew = 'http://127.0.0.1:9/auth/v1/token?grant_type=refresh_token', signIn = 'http://127.0.0.1:9/auth/v1/token?grant_type=password'
  const answer = (status, body, headers = {}) => { globalThis.fetch = async () => new Response(body, { status, headers }); return m.sessionFetch(renew, { method: 'POST', body: '{}' }).then((r) => r.status) }
  const real = globalThis.fetch
  later(400) // past any wait left by the tests above
  const J = { 'Content-Type': 'application/json' }
  eq('"token desconocido", "ya usado", "usuario bloqueado": se entregan tal cual', [
    await answer(400, '{"code":400,"error_code":"refresh_token_not_found","msg":"Invalid Refresh Token: Refresh Token Not Found"}', J),
    await answer(400, '{"error":"invalid_grant","error_description":"Invalid Refresh Token: Already Used"}', J),
    await answer(403, '{"code":403,"error_code":"user_banned","msg":"User is banned"}', J),
    await answer(400, '{"code":400,"error_code":"validation_failed","msg":"Refresh token is not valid"}', J),
  ], [400, 400, 403, 400])
  const temporary = []
  for (const [status, body, headers] of [[429, '{"code":429,"error_code":"over_request_rate_limit","msg":"Request rate limit reached"}', J], [403, '<html><body>Blocked by the network administrator</body></html>', { 'Content-Type': 'text/html' }], [540, 'project paused', {}], [401, '{"message":"Invalid API key","hint":"Double check your API key."}', J], [408, '', {}], [404, 'Not Found', {}]]) {
    later(400) // each one starts with no wait pending
    temporary.push(await answer(status, body, headers))
  }
  eq('servidor ocupado, página de bloqueo de la red, proyecto en pausa, llave inválida, sin respuesta: "inténtalo luego"', temporary, [503, 503, 503, 503, 503, 503])
  later(400)
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response('{"code":429,"error_code":"over_request_rate_limit"}', { status: 429, headers: { ...J, 'Retry-After': '120' } }) }
  const first = (await m.sessionFetch(renew, { method: 'POST', body: '{}' })).status
  const again = (await m.sessionFetch(renew, { method: 'POST', body: '{}' })).status
  later(61)
  const stillWaiting = (await m.sessionFetch(renew, { method: 'POST', body: '{}' })).status
  later(60)
  await m.sessionFetch(renew, { method: 'POST', body: '{}' })
  eq('si el servidor pide esperar 2 minutos, se le deja en paz 2 minutos', [first, again, stillWaiting, calls], [503, 503, 503, 2])
  later(400)
  globalThis.fetch = async () => new Response('{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}', { status: 400, headers: J })
  eq('un PIN equivocado al entrar se dice tal cual', (await m.sessionFetch(signIn, { method: 'POST', body: '{}' })).status, 400)
  globalThis.fetch = async () => new Response('{"code":429,"error_code":"over_request_rate_limit"}', { status: 429, headers: J })
  eq('y demasiados intentos de entrar, también', (await m.sessionFetch(signIn, { method: 'POST', body: '{}' })).status, 429)
  globalThis.fetch = async () => new Response('esto no es lo que se esperaba', { status: 200 })
  eq('una respuesta rara se entrega sin tocar', await (await m.sessionFetch(signIn, { method: 'POST', body: '{}' })).text(), 'esto no es lo que se esperaba')
  globalThis.fetch = async () => new Response('[{"id":1}]', { status: 200, headers: J })
  eq('lo que no es de sesiones pasa igual que llegó', await (await m.sessionFetch('http://127.0.0.1:9/rest/v1/act_runs?select=*', {})).text(), '[{"id":1}]')
  globalThis.fetch = real
  eq('palabras del servidor de sesiones, sí; lo demás, no', [m.sessionIsOver(400, '{"error_code":"refresh_token_not_found"}'), m.sessionIsOver(429, '{"error_code":"over_request_rate_limit"}'), m.sessionIsOver(403, '<html>'), m.sessionIsOver(500, '{"error":"x"}'), m.sessionIsOver(400, '{"code":400}'), m.sessionIsOver(200, '{}')], [true, false, false, false, false, false])
}

console.log('· Si alguien atrasa el reloj con la app abierta, el pase se renueva al primer rechazo')
await fresh()
await enter()
await m.pullAll()
eq('recién entrado, todo baja', [m.syncStore.get().state, server.rejected], ['online', 0])
skew = -2 * H * 1000 // someone sets the tablet's clock two hours back: the tablet now thinks its pass lasts three hours
later(H + 100) // and the pass really expires
const before = server.renewals
eq('el servidor rechaza el pase vencido', [await m.pullAll(), server.rejected > 0], [false, true])
await sleep(300)
eq('se pidió uno nuevo una sola vez y todo volvió a bajar', [server.renewals - before, m.syncStore.get().state, await who()], [1, 'online', 'someone'])

console.log('· "Salir" con mala señal, y otra persona entra enseguida')
await fresh()
await enter('ana@freezer.example.com')
const passOfAna = stored().access_token
server.logout = 'hang' // the server does not answer the good-bye
const t1 = realNow()
const leaving = m.signOutHere()
eq('el aparato queda sin sesión al instante', disk.has(KEY), false)
await m.signedOut()
eq('y "Salir" termina sin esperar al servidor', [realNow() - t1 < 1000, disk.has(KEY), disk.has('act_out')], [true, false, false])
await leaving
eq('la otra persona entra enseguida', await enter('beto@freezer.example.com'), 'dentro')
const passOfBeto = stored().access_token
eq('al servidor solo se le pidió cerrar la sesión de quien salió', server.logouts, ['Bearer ' + passOfAna])
for (const answer of server.held) answer() // the good-bye of the first person finally gets its answer
await sleep(200)
eq('y esa respuesta tardía no saca a quien acaba de entrar', [stored()?.access_token === passOfBeto, await who()], [true, 'someone'])
server.logout = 'ok'
await m.signOutHere(); await m.signOutHere()
eq('salir dos veces seguidas no rompe nada', [disk.has(KEY), await who()], [false, 'nobody'])
eq('un PIN equivocado no deja a nadie dentro', [(await m.supabase.auth.signInWithPassword({ email: 'x@freezer.example.com', password: 'mal' })).error?.message, disk.has(KEY)], ['Invalid login credentials', false])

console.log('· Una petición colgada no deja todo esperando')
await fresh()
await enter()
await m.pullAll()
{
  const real = globalThis.fetch
  let hung = 0
  // the WiFi says "connected" but nothing comes back: the request just hangs, until whoever asked gives up
  globalThis.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url
    if (!url.includes('/rest/v1/act_')) return real(input, init)
    hung++
    return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError'))))
  }
  m.patience.ms = 250
  const t2 = realNow()
  eq('una bajada colgada se deja de esperar y se dice que no hay conexión', [await m.pullAll(), realNow() - t2 < 3000, m.syncStore.get().state, m.syncStore.get().lastError, hung > 0], [false, true, 'offline', '', true])
  eq('la persona sigue dentro', await who(), 'someone')
  m.addLine('RTE', 'Línea 7')
  await sleep(900)
  eq('lo que se registra mientras tanto queda pendiente, no perdido', [m.outbox.size() > 0, m.syncStore.get().pending > 0, m.syncStore.get().state], [true, true, 'offline'])
  globalThis.fetch = real
  m.patience.ms = 25_000
  await m.syncNow()
  eq('y cuando la red vuelve a responder, sube y queda sincronizado', [m.outbox.size(), m.syncStore.get().state], [0, 'online'])
}

console.log('· Lo que guarda el aparato')
m.keepStorage()
eq('se pide al navegador que no lo borre si falta espacio', kept.asked, 1)
navigator.userAgent = 'Mozilla/5.0 Firefox/130.0'
m.keepStorage()
eq('en Firefox no, porque le haría una pregunta a la persona', kept.asked, 1)

console.log('')
if (failed.length) { console.log(failed.length + ' FALLARON de ' + (passed + failed.length) + ':\n'); for (const f of failed) console.log('  ✗ ' + f + '\n'); process.exit(1) }
console.log('✓ ' + passed + ' comprobaciones, todas correctas')
process.exit(0)
