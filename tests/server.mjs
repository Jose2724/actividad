// What a device brings down from the server, end to end: the app's own pull and "bring an older day" run against a
// stand-in for the server that answers like the real one (filters, order, pages of at most 1000 rows).
// Real clock; made-up data. Run by: npm run check
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

// ---- the stand-in server: tables in memory, asked through fetch like the real one ----
const db = { act_lines: [], act_runs: [], act_stops: [], act_products: [], act_schedule: [], act_changes: [], act_targets: [] }
let asked = [] // every question the app asked: [table, offset]
const MAX_ROWS = 1000
const unquote = (v) => v.replace(/^"|"$/g, '')
const test = (row, col, op, value) => {
  const have = row[col]
  if (op === 'is') return value === 'null' ? have == null : false
  if (have == null) return false
  const a = String(have), b = unquote(value)
  // timestamps are compared as moments, the rest as text (dates written YYYY-MM-DD sort the same either way)
  const [x, y] = /T\d\d:/.test(b) ? [Date.parse(a), Date.parse(b)] : [a, b]
  return op === 'eq' ? x === y : op === 'gt' ? x > y : op === 'gte' ? x >= y : op === 'lt' ? x < y : false
}
// The stand-in tells the time like the real one: in every answer, to the second. `ahead` is how far its clock runs
// from this machine's (as if the tablet's clock were wrong); `mode` breaks it on purpose
const clockServer = { ahead: 0, mode: 'ok', asked: [] }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  if (init?.method === 'HEAD') {
    clockServer.asked.push(init.headers.Authorization)
    if (clockServer.mode === 'down') throw new TypeError('fetch failed')
    await sleep(15 + Math.random() * 30) // the way up
    const stamp = Date.now() + clockServer.ahead
    await sleep(15 + Math.random() * 30) // the way down
    return new Response(null, { status: 200, headers: clockServer.mode === 'mute' ? {} : { Date: new Date(Math.floor(stamp / 1000) * 1000).toUTCString() } })
  }
  const table = url.pathname.split('/').pop()
  if (!url.pathname.includes('/rest/v1/') || !db[table]) return new Response('{}', { status: 404 })
  let rows = db[table]
  let offset = 0, limit = MAX_ROWS
  const order = []
  for (const [k, v] of url.searchParams) {
    if (k === 'select') continue
    else if (k === 'offset') offset = Number(v)
    else if (k === 'limit') limit = Math.min(MAX_ROWS, Number(v))
    else if (k === 'order') order.push(...v.split(',').map((o) => o.split('.')[0]))
    else if (k === 'or') { const parts = v.slice(1, -1).split(',').map((p) => { const [col, op, ...rest] = p.split('.'); return [col, op, rest.join('.')] }); rows = rows.filter((r) => parts.some(([c, o, val]) => test(r, c, o, val))) }
    else { const [op, ...rest] = v.split('.'); rows = rows.filter((r) => test(r, k, op, rest.join('.'))) }
  }
  rows = [...rows].sort((a, b) => { for (const c of order) { const x = c === 'synced_at' ? Date.parse(a[c]) : String(a[c]), y = c === 'synced_at' ? Date.parse(b[c]) : String(b[c]); if (x !== y) return x < y ? -1 : 1 } return 0 })
  asked.push([table, offset])
  return new Response(JSON.stringify(rows.slice(offset, offset + limit)), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

// ---- enough of a browser for the library to keep its session where the app keeps its data ----
const disk = new Map()
const storage = { getItem: (k) => (disk.has(k) ? disk.get(k) : null), setItem: (k, v) => { disk.set(k, String(v)) }, removeItem: (k) => { disk.delete(k) }, key: (i) => [...disk.keys()][i] ?? null, get length() { return disk.size } }
Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage })
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true }, localStorage: storage, location: new URL('http://localhost/') }
globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' }
disk.set('sb-127-auth-token', JSON.stringify({ access_token: 'x.y.z', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3000, user: { id: 'u1', aud: 'authenticated', email: 'a@b.c' } }))
disk.set('act_user', 'Santiago')
const m = await import(pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/.cache/act-check/device.js')).href)

let passed = 0
const failed = []
const eq = (what, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) passed++; else failed.push(`${what}\n      salió    ${JSON.stringify(got)}\n      esperado ${JSON.stringify(want)}`) }

// ---- the plant has been using the app for 60 days: 100 runs a day, 1,200 products ----
const DAYMS = 86_400_000, now = Date.now()
const iso = (ms) => new Date(ms).toISOString()
const dayOf = m.dayOf
let tick = now - 70 * DAYMS
const synced = () => iso((tick += 1000)) // every row reached the server at its own moment, in order
for (let i = 0; i < 1200; i++) db.act_products.push({ code: 'P' + String(i).padStart(4, '0'), name: 'Producto ' + i, pouches_per_case: 8, cases_per_mix: 18.5, crates_per_cart: 24, pouches_per_crate: 10, cases_per_pallet: 36, deleted: false, updated_at: iso(now - 70 * DAYMS), synced_at: synced() })
db.act_lines.push({ id: 'L1', dept: 'RTE', name: 'Línea 1', deleted: false, updated_at: iso(now - 70 * DAYMS), synced_at: synced() })
const runRow = (id, start, o = {}) => ({ id, dept: 'RTE', line_id: 'L1', line: 'Línea 1', code: 'P0001', lot: '6283', date: dayOf(start), started_at: iso(start), ended_at: iso(start + 300_000), units: [{ at: start + 60_000, qty: 240, ref: '', by: 'Nino' }], per_unit: 240, waste: 0, by_name: 'Nino', deleted: false, updated_at: iso(start + 300_000), synced_at: synced(), ...o })
for (let d = 59; d >= 0; d--) for (let i = 0; i < 100; i++) db.act_runs.push(runRow('r' + d + '-' + i, now - d * DAYMS - (i + 1) * 600_000))
db.act_runs.push(runRow('olvidada-abierta', now - 40 * DAYMS, { ended_at: null }))
for (let d = 59; d >= 0; d--) db.act_stops.push({ id: 's' + d, dept: 'RTE', line_id: 'L1', reason: 'Break', note: '', started_at: iso(now - d * DAYMS - 3_600_000), ended_at: iso(now - d * DAYMS - 3_000_000), by_name: 'Nino', deleted: false, updated_at: iso(now - d * DAYMS), synced_at: synced() })
for (let d = 59; d >= 0; d--) db.act_schedule.push({ date: dayOf(now - d * DAYMS), code: 'P0001', mixes: 10, updated_at: iso(now - d * DAYMS), synced_at: synced() })

console.log('· Una tablet nueva baja del servidor (60 días de planta: 6,001 corridas, 1,200 productos)')
const first = m.firstKeptDay()
eq('se pudo bajar', await m.pullAll(), true)
let s = m.store.get()
const inWindow = db.act_runs.filter((r) => r.date >= first).length
eq('trae las corridas de los últimos 14 días, ni una menos, aunque sean más de mil', [s.runs.filter((r) => r.date >= first).length, inWindow > 1000], [inWindow, true])
eq('no trae las de días más viejos, salvo la que quedó abierta', s.runs.filter((r) => r.date < first).map((r) => r.id), ['olvidada-abierta'])
eq('están las más recientes (lo último que se hizo hoy)', s.runs.some((r) => r.id === 'r0-0'), true)
eq('los 1,200 productos llegan completos', s.products.length, 1200)
eq('paros y programa: solo los días que guarda', [s.stops.every((x) => x.startedAt >= Date.parse(first + 'T00:00:00') - DAYMS), Object.keys(s.schedule).every((d) => d >= first), Object.keys(s.schedule).length], [true, true, 14])
eq('preguntó por páginas', asked.filter(([t]) => t === 'act_products').map(([, o]) => o), [0, 900, 1100])

console.log('· Después solo baja lo que cambió')
asked = []
eq('se pudo bajar', await m.pullAll(), true)
eq('nada nuevo: una pregunta corta por tabla', [asked.length, m.store.get().runs.length], [7, s.runs.length])
tick = Date.now() + 5000 // later than anything the tablet has seen
db.act_runs.push(runRow('recien-hecha', now - 60_000, { synced_at: synced() }))
const old = db.act_runs.find((r) => r.id === 'r50-3'); old.waste = 4; old.updated_at = iso(Date.now()); old.synced_at = synced()
await m.pullAll()
s = m.store.get()
eq('llega la corrida nueva', s.runs.some((r) => r.id === 'recien-hecha'), true)
eq('una corrección a un día viejo no se queda ocupando sitio', s.runs.some((r) => r.id === 'r50-3'), false)

console.log('· Abrir un día viejo en Reporte')
const longAgo = db.act_runs.find((r) => r.id === 'r50-3').date // 50 days ago
eq('ese día no está en la tablet', [m.awayDay(longAgo), s.runs.filter((r) => r.date === longAgo).length], [true, 0])
eq('se pudo traer', await m.loadDay(longAgo), true)
s = m.store.get()
eq('ahora están sus 100 corridas, con la corrección', [s.runs.filter((r) => r.date === longAgo).length, s.runs.find((r) => r.id === 'r50-3')?.waste], [db.act_runs.filter((r) => r.date === longAgo).length, 4])
eq('y su programa y su paro', [s.schedule[longAgo], s.stops.some((x) => x.id === 's50')], [{ P0001: 10 }, true])
await m.pullAll()
eq('se queda mientras la app esté abierta, aunque se vuelva a bajar', [m.store.get().runs.filter((r) => r.date === longAgo).length > 0, m.awayDay(longAgo)], [true, false])
eq('Avance de ese día sale de la tablet', m.avanceRows(m.store.get(), longAgo).map((r) => [r.code, r.scheduled, r.pouchesDone]), [['P0001', 10, db.act_runs.filter((r) => r.date === longAgo).length * 240]])

console.log('· Sin señal')
const before = m.store.get().runs.length
const other = dayOf(now - 30 * DAYMS)
delete db.act_runs // the stand-in stops answering for the runs
eq('no se pudo bajar: se dice, y la tablet conserva lo que tenía', [await m.pullAll(), m.store.get().runs.length], [false, before])
eq('un día viejo no se pudo traer, y se puede volver a pedir', [await m.loadDay(other), m.awayDay(other)], [false, true])

console.log('· La hora: el aparato se pone en hora con el servidor')
{
  const near = (got, want) => Math.abs(got - want) <= 500
  clockServer.ahead = 5000 // the tablet's clock is 5 seconds behind
  eq('se pudo medir', await m.syncClock(), true)
  eq('una tablet 5 segundos atrasada queda en hora, a menos de medio segundo', [near(m.clockOffset(), 5000), near(m.clockNow(), Date.now() + 5000)], [true, true])
  eq('pregunta 8 veces, con la sesión de quien entró', [clockServer.asked.length, [...new Set(clockServer.asked)]], [8, ['Bearer x.y.z']])
  eq('la medida queda guardada en el aparato', JSON.parse(disk.get('act_clock')).offset, m.clockOffset())
  clockServer.ahead = -305_000 // someone set the tablet 5 minutes fast while the app was open
  await m.syncClock()
  eq('si adelantan el reloj del aparato 5 minutos, la app sigue en la hora correcta y lo dice', [near(m.clockOffset(), -305_000), m.clockOffText()], [true, '5 min adelantado'])
  const had = m.clockOffset()
  clockServer.asked = []; clockServer.mode = 'down'
  eq('sin señal no se mide: se queda con la última medida, y no insiste', [await m.syncClock(), m.clockOffset(), clockServer.asked.length], [false, had, 2])
  clockServer.mode = 'mute'
  eq('si el servidor no dice la hora, no se inventa', [await m.syncClock(), m.clockOffset()], [false, had])
  clockServer.mode = 'ok'; clockServer.ahead = 0
  await m.syncClock()
  eq('con el reloj del aparato otra vez bien, la diferencia vuelve a cero', [near(m.clockOffset(), 0), m.clockOffText()], [true, ''])
}

console.log('')
if (failed.length) { console.log(failed.length + ' FALLARON de ' + (passed + failed.length) + ':\n'); for (const f of failed) console.log('  ✗ ' + f + '\n'); process.exit(1) }
console.log('✓ ' + passed + ' comprobaciones, todas correctas')
process.exit(0)
