// The app against the server, end to end, on this machine: its own sync code (pull, the queue that sends, the line
// check) talks to the real Postgres of pg.mjs through pgrest.mjs, as a tablet talks to Supabase. What the database does
// by itself (its permissions, its triggers, its clock) reaches the screen as it would on the floor. Made-up people.
// Run by: npm run check
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { as, person, runFile, serverDb } from './pg.mjs'
import { restOver } from './pgrest.mjs'

let passed = 0
const failed = []
let where = ''
const section = (t) => { where = t; console.log('· ' + t) }
const eq = (what, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) passed++; else failed.push(`[${where}] ${what}\n      salió    ${a}\n      esperado ${b}`) }
const iso = (ms) => new Date(ms).toISOString()
let n = 0
const uuid = () => '20000000-0000-4000-8000-' + String(++n).padStart(12, '0')

// ---- the server: its database with every migration, and the people of a made-up plant ----
const { db } = await serverDb()
const jose = await person(db, { name: 'Jose', actRole: 'mgr', role: 'admin' })
const ana = await person(db, { name: 'Ana', actRole: 'op', actDept: 'Packing' })
const sql = (who, text, params = []) => as(db, who, (tx) => tx.query(text, params))
const lineRow = (id, dept, name) => [id, dept, name]
const addLineSql = (who, id, dept, name) => sql(who, "insert into public.act_lines (id, dept, name, deleted, updated_at, updated_by) values ($1, $2, $3, false, now(), 'prueba')", lineRow(id, dept, name))
const P1 = uuid(), P2 = uuid(), R1 = uuid()
await addLineSql(jose, P1, 'Packing', 'Línea 1'); await addLineSql(jose, P2, 'Packing', 'Línea 2'); await addLineSql(jose, R1, 'RTE', 'Línea 1')
// people and rows of other rooms for the sections about who signs in on the tablet (made now: by then they are old)
const rita = await person(db, { name: 'Rita', actRole: 'op', actDept: 'RTE' })
const vera = await person(db, { name: 'Vera', actRole: 'viewer' })
const openRunSql = (who, id, dept, lineId, line = 'Línea 1') => sql(who, "insert into public.act_runs (id, dept, line_id, line, code, lot, date, started_at, ended_at, units, per_unit, waste, by_name, deleted, updated_at) values ($1, $2, $3, $4, '0100', '6290', $5, now() - interval '30 minutes', null, '[]'::jsonb, 36, 0, 'prueba', false, now())", [id, dept, lineId, line, new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10)])
const K1 = uuid(), RR = uuid(), KR = uuid()
await addLineSql(jose, K1, 'Kitchen', 'Línea 1'); await openRunSql(rita, RR, 'RTE', R1); await openRunSql(jose, KR, 'Kitchen', K1)

// ---- a tablet: enough of a browser for the library, signed in as Ana (operator of Packing) ----
const disk = new Map()
const storage = { getItem: (k) => (disk.has(k) ? disk.get(k) : null), setItem: (k, v) => { disk.set(k, String(v)) }, removeItem: (k) => { disk.delete(k) }, key: (i) => [...disk.keys()][i] ?? null, get length() { return disk.size } }
Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage })
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true }, localStorage: storage, location: new URL('http://localhost/') }
globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' }
Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { onLine: true, userAgent: 'node' } })
const exp = Math.floor(Date.now() / 1000) + 3600
const token = (who) => 'h.' + Buffer.from(JSON.stringify({ ...who.claims, exp })).toString('base64url') + '.s'
disk.set('sb-127-auth-token', JSON.stringify({ access_token: token(ana), refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: { id: ana.id, aud: 'authenticated', email: 'ana@prueba.local' } }))
disk.set('act_user', 'Ana')
/**
 * who the server said is signed in, as App.tsx keeps it when it asks (rememberMe): the queue reads the powers of the
 * person from it (a run taken off waits for someone holding "Borrar corridas y paros", see sync.ts, mayGo)
 */
const meOf = (who, role, dept = '', more = {}) => ({ id: who.id, name: who.name, username: who.name.toLowerCase(), role, dept, ...more })
const remember = (me) => disk.set('act_me', JSON.stringify(me))
remember(meOf(ana, 'op', 'Packing'))
const asked = []
// the network between the tablet and the server, with switches for the sections that need a bad one (off = as is):
// down = no connection; lose = the next write to that table reaches the server and its answer is lost; fail = the
// server answers every write to that table with an error; inFlight = something happens on the tablet while that
// table's next write is on its way (after the server took it, before the answer arrives); onGet = something happens
// before each read reaches the server (it may take its time: a slow WiFi); failGet = the server answers the reads of
// that table by id or by key ("what do you have of these?") with an error. gets = every read asked, as table?query
const rest = restOver(db, { log: asked })
const net = { down: false, lose: null, fail: null, inFlight: null, onGet: null, failGet: null, gets: [], busy: 0, failed: 0 }
globalThis.fetch = async (input, init = {}) => {
  net.busy++
  try {
    if (net.down) { net.failed++; throw new TypeError('fetch failed') }
    const method = (init.method ?? 'GET').toUpperCase(), url = new URL(typeof input === 'string' ? input : input.url), table = url.pathname.split('/').pop()
    if (method === 'GET' && url.pathname.includes('/rest/v1/')) {
      net.gets.push(table + url.search)
      // (by id, or by key: the goals and settings are asked for by theirs, "dept=in.(…)")
      if (net.failGet === table && (url.searchParams.has('id') || /^in\./.test(url.searchParams.get('dept') ?? ''))) { net.failed++; return new Response(JSON.stringify({ code: 'XX000', message: 'server hiccup', details: null, hint: null }), { status: 500, headers: { 'Content-Type': 'application/json' } }) }
      if (net.onGet) await net.onGet(table)
    }
    if (method === 'POST' && net.fail === table) { net.failed++; return new Response(JSON.stringify({ code: 'XX000', message: 'server hiccup', details: null, hint: null }), { status: 500, headers: { 'Content-Type': 'application/json' } }) }
    const res = await rest(input, init)
    if (method === 'POST' && net.inFlight?.table === table) { const f = net.inFlight.then; net.inFlight = null; await f() }
    if (method === 'POST' && net.lose === table) { net.lose = null; throw new DOMException('The operation was aborted.', 'AbortError') }
    return res
  } finally { net.busy-- }
}
const m = await import(pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/.cache/act-check/device.js')).href + '?stack')
m.role.set('op'); m.myDept.set('Packing')
const st = () => m.store.get()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** until the queue has sent what it can: a new record starts a pass by itself, and asking again while it runs returns at once */
async function drain() { let r = { refused: 0 }; for (let i = 0; i < 60; i++) { await sleep(10); r = await m.flushNow(); if (!m.outbox.size() || r.refused) break } return r }
/** until `done` holds and then nothing is on its way to the server for a moment (the pass that was started has finished, whatever it got) */
async function quiet(done = () => true) { for (let calm = 0, i = 0; calm < 4 && i < 1000; i++) { await sleep(10); calm = net.busy || !done() ? 0 : calm + 1 } }
/** a write whose answer will be lost has been made (the switch is spent), and its pass is over */
const lost = () => quiet(() => net.lose === null)
/**
 * until the queue is empty, with time to spare: a read that found no connection is tried again by the library a
 * second or more later (1, 2, 4 s), and the pass that made it waits for it
 */
async function sent() { for (let i = 0; i < 300 && m.outbox.size(); i++) { await sleep(50); await m.flushNow() } await quiet() }
/** with no connection: what is done now tries to go up and fails, and that pass is over */
async function offline(fn) { const n = net.failed; net.down = true; fn(); await quiet(() => net.failed > n); net.down = false }
const names = () => st().lines.filter((l) => l.dept === 'Packing').map((l) => l.name).sort()

section('Una tablet de Packing baja del servidor: solo su cuarto, por los permisos del servidor')
eq('antes de bajar no se agrega ninguna línea', await m.checkLineName('Packing', 'Línea 3'), 'wait')
eq('baja', await m.pullAll(), true)
eq('las líneas de Packing, y ninguna de otro cuarto', [names(), st().lines.some((l) => l.dept === 'RTE')], [['Línea 1', 'Línea 2'], false])

section('Agregar una línea: la tablet le pregunta al servidor, y el servidor guarda la que llega')
eq('un nombre que ya existe en el cuarto no se usa, aunque se escriba distinto', await m.checkLineName('Packing', ' línea 2'), 'taken')
eq('uno libre sí', await m.checkLineName('Packing', 'Línea 3'), '')
m.addLine('Packing', 'Línea 3'); await drain()
const onServer = async (dept) => (await sql(null, 'select name from public.act_lines where dept = $1 and not deleted order by name', [dept])).rows.map((r) => r.name)
eq('la línea llega al servidor', await onServer('Packing'), ['Línea 1', 'Línea 2', 'Línea 3'])
// two tablets at once: another one added "Línea 4" a moment ago, and this one has not brought it yet
await addLineSql(jose, uuid(), 'Packing', 'Línea 4')
m.addLine('Packing', 'Línea 4'); await drain()
eq('una copia que se cuela llega al servidor como "(2)", sin que nada se trabe', [await onServer('Packing'), m.outbox.size()], [['Línea 1', 'Línea 2', 'Línea 3', 'Línea 4', 'Línea 4 (2)'], 0])
await m.pullAll()
eq('y la tablet la ve con el nombre que le dio el servidor: ya no hay dos con un nombre', [names(), m.duplicateLines(st(), 'Packing')], [['Línea 1', 'Línea 2', 'Línea 3', 'Línea 4', 'Línea 4 (2)'], []])

section('Un Set up que llegó de otra tablet lo cierra el servidor cuando la línea empieza un código')
const setupId = uuid(), line3 = st().lines.find((l) => l.name === 'Línea 3')
// 20 minutes before the code, but never before this work day began (3:30 AM plant time, migrations/016): run between
// 3:30 and 3:50 AM, a Set up from 20 minutes before was of the day before, and 016 rightly dropped it instead of ending
// it (a failure that looked real; review of 2026-10-18)
const workDayStart = "((date_trunc('day', (now() at time zone 'America/New_York') - interval '3 hours 30 minutes') + interval '3 hours 30 minutes') at time zone 'America/New_York')"
await sql(ana, `insert into public.act_stops (id, dept, line_id, reason, note, started_at, ended_at, by_name, deleted, updated_at) values ($1, 'Packing', $2, 'Set up', '', greatest($3::timestamptz, ${workDayStart}), null, 'Otra tablet', false, now())`, [setupId, line3.id, iso(Date.now() - 20 * 60_000)])
m.startRun(line3, '0889', '6290', m.workDay(st()).date, 36); await drain()
const stopRow = (await sql(null, 'select ended_at, updated_by from public.act_stops where id = $1', [setupId])).rows[0]
const runRow = (await sql(null, "select started_at from public.act_runs where line_id = $1 and ended_at is null", [line3.id])).rows[0]
eq('en el servidor: el Set up termina donde empezó el código, y lo hizo el servidor', [stopRow.ended_at?.toISOString() === runRow.started_at?.toISOString(), stopRow.updated_by], [true, 'servidor'])
await m.pullAll()
const local = st().stops.find((x) => x.id === setupId)
eq('y la tablet lo ve así', [!!local?.endedAt, local?.endedAt === Date.parse(runRow.started_at.toISOString())], [true, true])

section('Lo que el manager fija llega a la tablet (reglas de líneas)')
await sql(jose, "insert into public.act_targets (dept, per_hour, per_shift, updated_at, updated_by) values ('opt:oplines', 0, 1, now(), 'Jose') on conflict (dept) do update set per_hour = excluded.per_hour, per_shift = excluded.per_shift, updated_at = excluded.updated_at")
await m.pullAll()
eq('los operadores no agregan, sí quitan', [st().lineRules.add, st().lineRules.remove], [false, true])

section('Los códigos de paro que prende el manager llegan a la tablet, y el paro sube con su código (2026-10-20)')
{
  const codes = (on) => sql(jose, "insert into public.act_targets (dept, per_hour, per_shift, updated_at, updated_by) values ('opt:reasoncodes', $1, null, now(), 'Jose') on conflict (dept) do update set per_hour = excluded.per_hour, updated_at = excluded.updated_at", [on ? 1 : 0])
  await codes(true); await m.pullAll()
  eq('encendidos en la tablet del operador', st().reasonCodes.on, true)
  const n = st().stops.length
  eq('una causa que no es de la lista no para la línea', [m.startStop('Packing', P2, 'Break', ''), st().stops.length], [false, n])
  eq('con un código sí', m.startStop('Packing', P2, 'MAT-01 Falta de material', 'cajas'), true)
  const sid = st().stops.find((x) => x.lineId === P2 && !x.endedAt).id
  m.endStop(sid); await drain()
  eq('en el servidor: el paro con su código, como se guardó', (await sql(null, 'select reason, note, ended_at is not null as ended from public.act_stops where id = $1', [sid])).rows.map((r) => [r.reason, r.note, r.ended]), [['MAT-01 Falta de material', 'cajas', true]])
  await codes(false); await m.pullAll()
  eq('apagados otra vez: la tablet vuelve a las causas de siempre', [st().reasonCodes.on, m.startStop('Packing', P2, 'Break', '')], [false, true])
  m.endStop(st().stops.find((x) => x.lineId === P2 && !x.endedAt).id); await drain()
  eq('nada se queda en la cola', m.outbox.size(), 0)
}

section('Una cuenta que el servidor ya no acepta: lo registrado se queda en la tablet y se dice')
await sql(null, 'update public.employees set active = false where user_id = $1', [ana.id])
m.addLine('Packing', 'Línea 6'); const r = await drain()
eq('el servidor rechaza la línea y su historial por permisos, y la tablet los guarda, sin perderlos', [r.refused, m.outbox.size(), (await onServer('Packing')).includes('Línea 6'), m.outbox.items().map((i) => i.table).sort()], [2, 2, false, ['act_changes', 'act_lines']])
await sql(null, 'update public.employees set active = true where user_id = $1', [ana.id])
const again = await drain()
eq('con la cuenta en orden otra vez, sube sola', [again.refused, m.outbox.size(), (await onServer('Packing')).includes('Línea 6')], [0, 0, true])

eq('la tablet nunca le preguntó al servidor por otro cuarto', asked.filter(([, t]) => t === 'act_lines' || t === 'act_runs').length > 0, true)

section('Una respuesta que se pierde: el servidor guardó, la tablet no lo supo, y lo que se registró después no se pierde (auditoría 2026-10-17, S1)')
// A write reaches the server but its answer does not come back (the 25 s limit, the WiFi drops at that moment). The
// row stays in the queue; the operator keeps working; the server's copy of that write comes down before the queue is
// sent again. It is the tablet's own past, not another tablet's change
const quietWarn = console.warn
console.warn = () => {} // (the lost answers are said in the console, as on a tablet)
const stopSrv = async (id) => (await sql(null, 'select ended_at, deleted from public.act_stops where id = $1', [id])).rows[0]
const runSrv = async (id) => { const r = (await sql(null, 'select ended_at, units, waste, deleted from public.act_runs where id = $1', [id])).rows[0]; return r && { ended: !!r.ended_at, units: r.units.length, waste: Number(r.waste), deleted: r.deleted } }
const runHere = (id) => { const r = st().runs.find((x) => x.id === id); return r && { ended: !!r.endedAt, units: r.units.length, waste: r.waste, deleted: !!r.deleted } }
const line2 = () => st().lines.find((l) => l.id === P2)
const date = () => m.workDay(st()).date
{
  net.lose = 'act_stops'
  m.startStop('Packing', P2, 'Break', ''); await lost()
  const sid = st().stops.find((x) => x.lineId === P2 && !x.endedAt).id
  eq('el paro llegó al servidor, abierto; la tablet no lo sabe y lo tiene en la cola', [await stopSrv(sid), m.outbox.items().some((i) => i.key === sid)], [{ ended_at: null, deleted: false }, true])
  await offline(() => m.endStop(sid))
  await m.syncNow(); await sent()
  eq('terminado sin señal y vuelve la señal: el paro queda terminado en el servidor y en la tablet, sin nada en la cola', [!!(await stopSrv(sid)).ended_at, !!st().stops.find((x) => x.id === sid)?.endedAt, m.outbox.size()], [true, true, 0])
}
{
  net.lose = 'act_runs'
  m.startRun(line2(), '0890', '6290', date(), 36); await lost()
  const rid = st().runs.find((r) => r.code === '0890').id
  eq('el código llegó al servidor sin que la tablet lo supiera', await runSrv(rid), { ended: false, units: 0, waste: 0, deleted: false })
  await offline(() => { m.unitDone(rid, 36, '1'); m.addWaste(rid, 2); m.endRun(rid) })
  await m.syncNow(); await sent()
  const want = { ended: true, units: 1, waste: 2, deleted: false }
  eq('un pallet, waste y terminar sin señal: todo llega, y la tablet lo sigue viendo así', [await runSrv(rid), runHere(rid), m.outbox.size()], [want, want, 0])
}
{
  m.startRun(line2(), '0891', '6290', date(), 36); await drain(); await m.pullAll()
  const rid = st().runs.find((r) => r.code === '0891').id
  net.lose = 'act_runs'
  m.addWaste(rid, 5); await lost()
  eq('5 lb de waste llegaron al servidor sin que la tablet lo supiera', (await runSrv(rid)).waste, 5)
  await offline(() => m.addWaste(rid, 3))
  await m.syncNow(); await sent()
  eq('3 lb más sin señal: son 8 en el servidor y en la tablet, no 13', [(await runSrv(rid)).waste, runHere(rid).waste, m.outbox.size()], [8, 8, 0])
  m.endRun(rid); await drain()
}
{
  // a run is taken off only by someone holding "Borrar corridas y paros" (Jose, 2026-10-18: migrations/018, 9): Ana
  // holds it for this check, on the server and as the tablet knows her
  await sql(null, "update public.employees set act_powers = '{del}' where user_id = $1", [ana.id]); remember(meOf(ana, 'op', 'Packing', { powers: ['del'] }))
  net.lose = 'act_runs'
  m.startRun(line2(), '0892', '6290', date(), 36); await lost()
  const rid = st().runs.find((r) => r.code === '0892').id
  await offline(() => m.deleteRun(rid))
  await m.syncNow(); await sent()
  eq('un código borrado sin señal queda borrado en el servidor y no vuelve a la tablet', [(await runSrv(rid)).deleted, !!runHere(rid), m.outbox.size()], [true, false, 0])
  await sql(null, 'update public.employees set act_powers = null where user_id = $1', [ana.id]); remember(meOf(ana, 'op', 'Packing'))
}
{
  // no answer lost at all: the stop is ended while its first write is still on its way, and the live notice of that
  // first write arrives before its answer
  const wire = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]))
  net.inFlight = { table: 'act_stops', then: async () => {
    const x = st().stops.find((y) => y.lineId === P1 && !y.endedAt)
    m.endStop(x.id)
    m.applyRemote('act_stops', wire((await sql(null, 'select * from public.act_stops where id = $1', [x.id])).rows[0]))
  } }
  m.startStop('Packing', P1, 'Break', ''); await quiet(() => net.inFlight === null); await drain()
  const x = st().stops.filter((y) => y.lineId === P1).at(-1)
  eq('el aviso en vivo llega antes que la respuesta: el paro queda terminado en el servidor y en la tablet', [!!(await stopSrv(x.id)).ended_at, !!x.endedAt, m.outbox.size()], [true, true, 0])
}
{
  // what the server changes on the way in is the server's: a copy of a line that got through is renamed "(2)"
  // (migrations/017), also when the tablet never heard the answer
  await addLineSql(jose, uuid(), 'Packing', 'Línea 7')
  net.lose = 'act_lines'
  m.addLine('Packing', 'Línea 7'); await lost()
  await m.syncNow(); await sent()
  eq('la copia se queda con el nombre que le dio el servidor, en el servidor y en la tablet', [(await onServer('Packing')).filter((x) => x.startsWith('Línea 7')), names().filter((x) => x.startsWith('Línea 7')), m.outbox.size()], [['Línea 7', 'Línea 7 (2)'], ['Línea 7', 'Línea 7 (2)'], 0])
}

section('Una fila que el servidor no toma sigue diciendo desde cuándo espera, aunque otra tablet la cambie (auditoría 2026-10-17, S6)')
{
  m.startRun(line2(), '0893', '6290', date(), 36); await drain(); await m.pullAll()
  const rid = st().runs.find((r) => r.code === '0893').id
  net.fail = 'act_runs' // the server keeps answering this row with an error (not a refusal)
  const n = net.failed
  m.unitDone(rid, 36, '1'); await quiet(() => net.failed > n)
  const at = m.outbox.items().find((i) => i.key === rid)?.at
  eq('la fila espera, con la hora en que se encoló', [typeof at, m.outbox.oldest() === at, m.syncStore.get().since === at], ['number', true, true])
  await sql(jose, "update public.act_runs set lot = '7777', updated_at = now() + interval '1 second', updated_by = 'Jose' where id = $1", [rid]) // another tablet corrects the lot
  await m.pullAll()
  const it = m.outbox.items().find((i) => i.key === rid)
  eq('después de juntarla con el cambio de la otra tablet sigue diciendo desde cuándo espera', [it?.at === at, m.outbox.oldest() === at, m.syncStore.get().since === at, it?.row.lot, it?.row.units.length], [true, true, true, '7777', 1])
  net.fail = null; await drain()
  eq('y cuando el servidor la toma, lleva el lote de la otra tablet y el pallet de esta', [await runSrv(rid), (await sql(null, 'select lot from public.act_runs where id = $1', [rid])).rows[0].lot, m.outbox.size()], [{ ended: false, units: 1, waste: 0, deleted: false }, '7777', 0])
  m.endRun(rid); await drain()
}

// ---- who is signed in on the tablet: the session the library keeps, and what the app sets when the server says who it is ----
const sessionOf = (who) => JSON.stringify({ access_token: token(who), refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: { id: who.id, aud: 'authenticated', email: who.name.toLowerCase() + '@prueba.local' } })
/** as App.tsx does when the server confirms who signed in (role 'mgr' for a manager and for somebody who only looks) */
const signedInAs = (who, roleText, dept, look = false) => { disk.set('sb-127-auth-token', sessionOf(who)); disk.set('act_user', who.name); m.role.set(roleText); m.myDept.set(dept); disk.set('act_view_only', look ? '1' : ''); remember(meOf(who, look ? 'viewer' : roleText === 'op' ? 'op' : 'mgr', dept, who === jose ? { admin: true } : {})) }
/** "Salir" (or a session the server ended): the session leaves the tablet, and who it was (App.tsx forgets it); the role and the room stay as they were */
const signedOut = () => { disk.delete('sb-127-auth-token'); disk.delete('act_me') }
const wireRow = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]))
const lineFromServer = async (id) => m.applyRemote('act_lines', wireRow((await sql(null, 'select * from public.act_lines where id = $1', [id])).rows[0]))
const runsOn = async (lineId) => (await sql(null, 'select count(*)::int n from public.act_runs where line_id = $1', [lineId])).rows[0].n
const cursorPast = () => Date.parse(disk.get('act_since2')) - 10_000 - (Number(disk.get('act_since_span')) || 0)

section('Cuando en la tablet entra alguien que ve otros cuartos, los baja enteros (auditoría 2026-10-17, S3)')
{
  // A tablet remembers where its last pull ended. An operator's brings only their room, so when someone who sees other
  // rooms signs in on it (an operator of another room, a manager), the rows of those rooms older than that point were
  // never asked for: lines that looked free while they ran a code, and "Set up en todas las líneas" wrote a false Set
  // up on one. The open codes of RTE and Kitchen were made when this test began, before everything Ana brought since
  const rr = (await sql(null, 'select synced_at from public.act_runs where id = $1', [RR])).rows[0].synced_at.getTime()
  for (let i = 0; i < 30; i++) {
    await sql(ana, "insert into public.act_changes (id, at, by_name, dept, what) values ($1, now(), 'Ana', 'Packing', 'algo de Packing')", [uuid()])
    await m.pullAll()
    if (cursorPast() > rr + 1000) break
    await sleep(1000)
  }
  eq('la tablet de Ana no tiene nada de RTE ni de Kitchen, y ya bajó más allá de sus códigos abiertos', [st().lines.some((l) => l.dept !== 'Packing'), st().runs.some((r) => r.dept !== 'Packing'), cursorPast() > rr], [false, false, true])
  signedInAs(rita, 'op', 'RTE')
  eq('entra Rita, de RTE: baja', await m.pullAll(), true)
  eq('ve la línea de su cuarto y el código que corre en ella', [st().lines.some((l) => l.id === R1), st().runs.some((r) => r.id === RR && !r.endedAt)], [true, true])
  signedInAs(jose, 'mgr', '')
  eq('entra el manager: baja', await m.pullAll(), true)
  eq('ve también Kitchen, con su línea y su código abierto, y esa línea no sale libre', [st().lines.some((l) => l.id === K1), st().runs.some((r) => r.id === KR && !r.endedAt), m.freeLines(st(), m.clockNow()).some((l) => l.id === K1)], [true, true, false])
}

section('Una bajada lenta no se salta lo que cambió mientras bajaba (auditoría 2026-10-17, S5)')
{
  // The eight tables are read one after the other, and the next pull starts from the newest row of any of them. On a
  // weak WiFi a pull takes long: a code ended right after its table was read, while a later table was still on its
  // way, was older than that point and never came down (the tablet showed it running, with "Sincronizado")
  const P21 = uuid(), PR = uuid()
  await addLineSql(jose, P21, 'Packing', 'Línea 21'); await openRunSql(ana, PR, 'Packing', P21, 'Línea 21')
  await m.pullAll()
  eq('la tablet tiene el código abierto', st().runs.some((r) => r.id === PR && !r.endedAt), true)
  let ended = false, later = false
  net.onGet = async (t) => {
    // right after the runs were read, the Packing tablet ends that code
    if (t === 'act_stops' && !ended) { ended = true; await sql(ana, 'update public.act_runs set ended_at = now(), updated_at = now() where id = $1', [PR]) }
    // and the history comes 11 seconds later (a slow WiFi), with something newer in it
    if (t === 'act_changes' && !later) { later = true; await sleep(11_000); await sql(ana, "insert into public.act_changes (id, at, by_name, dept, what) values ($1, now(), 'Ana', 'Packing', 'otra cosa de Packing')", [uuid()]) }
  }
  eq('la bajada lenta termina bien', [await m.pullAll(), ended, later], [true, true, true])
  net.onGet = null
  await m.pullAll(); await m.pullAll()
  eq('el código terminó en el servidor, y la tablet lo ve terminado en la bajada siguiente', [!!(await sql(null, 'select ended_at from public.act_runs where id = $1', [PR])).rows[0].ended_at, !!st().runs.find((r) => r.id === PR)?.endedAt], [true, true])
}

section('Antes de mandar un paro o una línea, la tablet trae lo que el servidor tiene de ellos (auditoría 2026-10-17, S4)')
{
  // A stop goes up whole. A tablet that had not heard what a manager did to a stop (deleted it, gave it another cause)
  // and then ended it brought back the deleted stop, or the old cause
  signedInAs(ana, 'op', 'Packing'); await m.pullAll()
  const P23 = uuid(), S1 = uuid(), S2 = uuid(), S3 = uuid()
  await addLineSql(jose, P23, 'Packing', 'Línea 23')
  const stopSql = (id, reason) => sql(ana, "insert into public.act_stops (id, dept, line_id, reason, note, started_at, ended_at, by_name, deleted, updated_at) values ($1, 'Packing', $2, $3, '', now() - interval '10 minutes', null, 'Ana', false, now())", [id, P23, reason])
  await stopSql(S1, 'Break'); await stopSql(S2, 'Mecánico'); await stopSql(S3, 'Break')
  await m.pullAll()
  eq('la tablet tiene los tres paros abiertos', [S1, S2, S3].map((id) => !!st().stops.find((x) => x.id === id && !x.endedAt)), [true, true, true])
  // the manager, from the office: the tablet does not hear it (no live updates here, and it pulled a moment ago)
  await sql(jose, "update public.act_stops set deleted = true, updated_at = now(), updated_by = 'Jose' where id = $1", [S1])
  await sql(jose, "update public.act_stops set reason = 'Falta de producto', updated_at = now(), updated_by = 'Jose' where id = $1", [S2])
  m.endStop(S1); m.endStop(S2); await sent()
  const stopNow = async (id) => (await sql(null, 'select deleted, reason, ended_at from public.act_stops where id = $1', [id])).rows[0]
  const [a, b] = [await stopNow(S1), await stopNow(S2)]
  eq('el paro que el manager borró sigue borrado, y el que cambió de causa la conserva; los dos terminados', [a.deleted, !!a.ended_at, b.reason, !!b.ended_at, m.outbox.size()], [true, true, 'Falta de producto', true, 0])
  eq('y la tablet los ve así', [st().stops.some((x) => x.id === S1), st().stops.find((x) => x.id === S2)?.reason], [false, 'Falta de producto'])
  net.failGet = 'act_stops'
  m.endStop(S3); await sent()
  net.failGet = null
  eq('si el servidor no dice qué tiene del paro, el paro sube igual y nada se queda esperando', [!!(await stopNow(S3)).ended_at, m.outbox.size()], [true, 0])
  // a tablet back after a long time offline asks a hundred at a time
  const many = Array.from({ length: 120 }, () => uuid())
  await sql(ana, "insert into public.act_stops (id, dept, line_id, reason, note, started_at, ended_at, by_name, deleted, updated_at) select x, 'Packing', $2, 'Break', '', now() - interval '5 minutes', null, 'Ana', false, now() from unnest($1::uuid[]) as x", [many, P23])
  await m.pullAll()
  net.gets = []
  for (const id of many) m.endStop(id)
  await sent()
  const asks = net.gets.filter((g) => g.startsWith('act_stops?') && /id=in\./.test(decodeURIComponent(g))).map((g) => decodeURIComponent(g).match(/id=in\.\(([^)]*)\)/)[1].split(','))
  eq('120 paros terminados: los pregunta de cien en cien, todos, y suben', [asks.map((x) => x.length), new Set(asks.flat()).size, (await sql(null, 'select count(*)::int n from public.act_stops where id = any($1::uuid[]) and ended_at is not null', [many])).rows[0].n, m.outbox.size()], [[100, 20], 120, 120, 0])
  // a line the manager took off while this tablet renamed it stays off (it came back, with the new name)
  signedInAs(jose, 'mgr', ''); await m.pullAll()
  const L22 = uuid(); await addLineSql(jose, L22, 'Packing', 'Línea 22'); await m.pullAll()
  await sql(jose, "update public.act_lines set deleted = true, updated_at = now(), updated_by = 'Jose' where id = $1", [L22])
  m.renameLine(L22, 'Línea 29'); await sent()
  eq('una línea que el manager quitó mientras esta tablet la renombraba sigue quitada', [(await sql(null, 'select deleted from public.act_lines where id = $1', [L22])).rows[0].deleted, st().lines.some((l) => l.id === L22), m.outbox.size()], [true, false, 0])
}

section('Un cambio del calendario que el servidor no acepta de un operador se queda en la tablet, no se tira (auditoría 2026-10-17, R2)')
{
  // The plant calendar is kept by key (shiftweek:…), not by room: an operator's change of it that the server refused
  // passed for another room's and was thrown away, while the history said the week had changed
  signedInAs(ana, 'op', 'Packing'); await m.pullAll()
  const from = '2026-11-02'
  m.setShiftWeek(from, '3333311'); await quiet()
  const r = await m.flushNow()
  eq('Ana no tiene ese permiso: el cambio y su historial esperan en la tablet, con la alerta', [r.refused, m.outbox.items().map((i) => i.table).sort(), m.syncStore.get().refused, m.syncStore.get().other], [2, ['act_changes', 'act_targets'], 2, 0])
  await sql(null, "update public.employees set act_powers = '{shifts,goals}' where user_id = $1", [ana.id])
  const again = await drain()
  eq('con el permiso dado, sube solo', [again.refused, m.outbox.size(), Number((await sql(null, 'select per_hour from public.act_targets where dept = $1', ['shiftweek:' + from])).rows[0]?.per_hour)], [0, 0, 3333311])
  await sql(null, 'update public.employees set act_powers = null where user_id = $1', [ana.id])
}

section('Un operador con "Poner metas" pone la meta de otro cuarto: la meta y su historial suben, nada se queda esperando (revisión 2026-10-18)')
{
  // Ajustes › Metas lists every room to whoever holds "Poner metas", and the server takes the goal of any room from
  // them; the two history lines carried the other room, were refused, and waited on the tablet for ever
  signedInAs(ana, 'op', 'Packing'); await m.pullAll()
  await sql(null, "update public.employees set act_powers = '{goals}' where user_id = $1", [ana.id])
  m.setShiftGoal('RTE', 1, 10, 80); await sent()
  const goal = (await sql(null, "select per_hour, per_shift from public.act_targets where dept = 'RTE@1'")).rows[0]
  const hist = (await sql(null, "select dept, what from public.act_changes where ref_table = 'act_targets' and ref_key = 'RTE@1' order by what")).rows.map((h) => [h.dept, h.what])
  eq('la meta de RTE y sus dos líneas de historial están en el servidor, y la tablet no tiene nada esperando', [Number(goal?.per_hour), Number(goal?.per_shift), hist, m.outbox.size(), m.syncStore.get().other, m.syncStore.get().refused], [10, 80, [[null, 'Meta RTE · Turno 1 · del turno'], [null, 'Meta RTE · Turno 1 · por hora']], 0, 0, 0])
  await sql(null, 'update public.employees set act_powers = null where user_id = $1', [ana.id])
}

section('Lo registrado en un cuarto no se pierde cuando entra en la tablet alguien de otro (auditoría 2026-10-17, S2)')
{
  // A row the server refuses to whoever is signed in, of a room that is not theirs, was thrown away: an operator who
  // left with rows still waiting, a manager's corrections of several rooms, an operator moved to another room. Now it
  // waits on the tablet, said apart, until someone who may send it signs in
  const [R20, P24, R24, R25, P25] = [uuid(), uuid(), uuid(), uuid(), uuid()]
  await addLineSql(jose, R20, 'RTE', 'Línea 20'); await addLineSql(jose, P24, 'Packing', 'Línea 24'); await addLineSql(jose, R24, 'RTE', 'Línea 24'); await addLineSql(jose, R25, 'RTE', 'Línea 25'); await addLineSql(jose, P25, 'Packing', 'Línea 25')
  const startOn = (id) => m.startRun(st().lines.find((l) => l.id === id), '0889', '6290', date(), 36)
  const posts = () => asked.filter(([method, t]) => method === 'POST' && t === 'act_runs').length
  // Rita (RTE) records with no session, and leaves; Ana (Packing) signs in on the same tablet
  signedInAs(rita, 'op', 'RTE'); await lineFromServer(R20)
  signedOut(); startOn(R20); await quiet()
  const rte = m.outbox.items().filter((i) => i.row.dept === 'RTE').map((i) => i.table).sort()
  eq('Rita registra sin sesión: lo suyo espera en la tablet', [rte.includes('act_runs'), m.syncStore.get().state], [true, 'signedOut'])
  signedInAs(ana, 'op', 'Packing'); await m.syncNow(); await quiet()
  eq('entra Ana, de Packing: lo de RTE no sube con ella, pero tampoco se tira; se dice aparte, sin error ni alerta roja', [m.outbox.items().filter((i) => i.row.dept === 'RTE').map((i) => i.table).sort(), m.syncStore.get().other, m.syncStore.get().otherRooms, m.syncStore.get().refused, m.syncStore.get().lastError, await runsOn(R20)], [rte, rte.length, ['RTE'], 0, '', 0])
  eq('salir no la deja en rojo: dice que lo que espera se queda guardado', [m.leaveAsk(m.syncStore.get()).danger, m.leaveAsk(m.syncStore.get()).yes], [false, 'Salir'])
  const sentBefore = posts()
  await m.flushNow(); await quiet()
  eq('mientras siga Ana no se vuelve a mandar en cada vuelta', posts() - sentBefore, 0)
  const realNow = Date.now
  Date.now = () => realNow() + 11 * 60_000
  try { await m.flushNow(); await quiet() } finally { Date.now = realNow }
  eq('cada diez minutos sí se vuelve a probar (un permiso devuelto en el servidor), y sigue esperando', [posts() - sentBefore > 0, m.syncStore.get().other], [true, rte.length])
  signedInAs(jose, 'mgr', ''); await m.syncNow(); await sent()
  eq('entra el manager: sube, y ya no queda nada esperando', [await runsOn(R20), m.outbox.size(), m.syncStore.get().other], [1, 0, 0])

  // the manager records in two rooms with no session; Rita (RTE) signs in, then Ana (Packing)
  signedOut(); startOn(P24); startOn(R24); await quiet()
  signedInAs(rita, 'op', 'RTE'); await m.syncNow(); await quiet()
  eq('el manager registró en RTE y en Packing; entra Rita: lo de RTE sube, lo de Packing espera aparte', [await runsOn(R24), await runsOn(P24), [...new Set(m.outbox.items().map((i) => i.row.dept))], m.syncStore.get().otherRooms, m.syncStore.get().refused], [1, 0, ['Packing'], ['Packing'], 0])
  signedInAs(ana, 'op', 'Packing'); await m.syncNow(); await sent()
  eq('entra Ana, de Packing: sube lo de Packing', [await runsOn(P24), m.outbox.size(), m.syncStore.get().other], [1, 0, 0])

  // Rita records with no session; meanwhile the manager moves her to Packing on the server
  signedInAs(rita, 'op', 'RTE'); await lineFromServer(R25)
  signedOut(); startOn(R25); await quiet()
  await sql(null, "update public.employees set act_dept = 'Packing' where user_id = $1", [rita.id])
  signedInAs(rita, 'op', 'RTE') // the tablet still believes she is of RTE
  const first = await m.flushNow(); await quiet()
  eq('el servidor ya no le acepta RTE: lo suyo espera, con la alerta roja', [first.refused > 0, m.syncStore.get().refused > 0, await runsOn(R25)], [true, true, 0])
  m.myDept.set('Packing') // the app asks the server who she is, and learns it
  await m.flushNow(); await quiet()
  eq('ya sabe que es de Packing: lo de RTE espera aparte, y la alerta roja se quita (no queda una cuenta sin nada detrás)', [m.syncStore.get().refused, m.outbox.refused().length, m.syncStore.get().other > 0, m.outbox.size() > 0, m.outbox.items().every((i) => i.row.dept === 'RTE')], [0, 0, true, true, true])
  await sql(null, "update public.employees set act_dept = 'RTE' where user_id = $1", [rita.id])
  m.myDept.set('RTE'); await m.syncNow(); await sent()
  eq('de vuelta en RTE, sube', [await runsOn(R25), m.outbox.size()], [1, 0])

  // somebody who only looks signs in after the manager recorded with no session: nothing of theirs is refused
  signedInAs(jose, 'mgr', ''); await m.pullAll()
  signedOut(); startOn(P25); await quiet()
  signedInAs(vera, 'mgr', '', true); await m.syncNow(); await quiet()
  eq('entra alguien de "Solo ver": lo del manager espera aparte, sin la alerta roja de una sesión rechazada', [m.syncStore.get().refused, m.syncStore.get().other > 0, m.syncStore.get().otherRooms, await runsOn(P25)], [0, true, ['Packing'], 0])
  signedInAs(jose, 'mgr', ''); await m.syncNow(); await sent()
  eq('y sube cuando entra el manager', [await runsOn(P25), m.outbox.size(), m.syncStore.get().other], [1, 0, 0])
  // the tablet is Ana's again for what follows
  signedInAs(ana, 'op', 'Packing'); await m.pullAll()
}

section('Borrar una corrida o quitar una línea: el servidor no se lo deja a quien no puede, y la tablet la vuelve a mostrar sin mandarla otra vez (Jose, 2026-10-18)')
{
  // migrations/018, 9 and 10: a run taken off by somebody without "Borrar corridas y paros", or a line by somebody the
  // managers' rule does not let, is kept by the server, with no error, and the rest of that write is taken as sent.
  // Here the tablet still believes Ana holds "Borrar" and "Corregir" (taken from her on the server a moment ago)
  const posts = (t) => asked.filter(([method, x]) => method === 'POST' && x === t).length
  const said = async (what) => (await sql(null, 'select by_name, before, after from public.act_changes where what = $1 order by at', [what])).rows.map((r) => [r.by_name, r.before, r.after])
  const lineGone = async (id) => (await sql(null, 'select deleted from public.act_lines where id = $1', [id])).rows[0].deleted
  const startOn = (id, code) => { m.startRun(st().lines.find((l) => l.id === id), code, '6290', date(), 36); return st().runs.find((r) => r.code === code && r.lineId === id).id }
  const [P26, P27] = [uuid(), uuid()]
  await addLineSql(jose, P26, 'Packing', 'Línea 26'); await addLineSql(jose, P27, 'Packing', 'Línea 27'); await m.pullAll()
  remember(meOf(ana, 'op', 'Packing', { powers: ['del', 'fix'] }))
  const r1 = startOn(P26, '0894'); await drain(); m.unitDone(r1, 36, '1'); await drain()
  let before = posts('act_runs')
  m.deleteRun(r1); await drain(); await quiet()
  eq('Ana borra la corrida: el servidor la deja, y la tablet la vuelve a mostrar enseguida, sin nada en la cola ni alerta', [(await runSrv(r1)).deleted, runHere(r1), m.outbox.size(), m.syncStore.get().refused], [false, { ended: false, units: 1, waste: 0, deleted: false }, 0, 0])
  eq('se mandó una vez, y el historial dice que el servidor no dejó borrarla', [posts('act_runs') - before, await said('El servidor no dejó borrar la corrida 0894 del ' + date() + ' (Packing, Línea 26)')], [1, [['Ana', '', '1 pallets']]])
  await m.syncNow(); await sent()
  eq('la vuelta siguiente no manda nada más, y la corrida sigue ahí', [posts('act_runs') - before, !!runHere(r1), m.outbox.size()], [1, true, 0])
  m.endRun(r1); await drain()
  // the answer of that write is lost: the server's copy comes down before the queue is sent again, and it is that same
  // version, kept. It leaves the queue: sent once more, it would only be kept once more
  const r2 = startOn(P26, '0895'); await drain()
  before = posts('act_runs')
  net.lose = 'act_runs'
  m.deleteRun(r2); await lost()
  eq('la respuesta se perdió: la corrida sigue en la cola', m.outbox.items().some((i) => i.key === r2), true)
  await m.syncNow(); await sent()
  eq('al bajar la copia del servidor sale de la cola sin mandarse otra vez, y la tablet la muestra', [(await runSrv(r2)).deleted, !!runHere(r2), m.outbox.size(), posts('act_runs') - before], [false, true, 0, 1])
  m.endRun(r2); await drain()
  // a line, with the managers' rule "quitar líneas libres" off
  await sql(jose, "update public.act_targets set per_shift = 0, updated_at = now() where dept = 'opt:oplines'"); await m.pullAll()
  before = posts('act_lines')
  m.removeLine(P27); await drain(); await quiet()
  eq('Ana quita una línea: el servidor la deja, y la tablet la vuelve a mostrar enseguida, sin nada en la cola', [await lineGone(P27), st().lines.some((l) => l.id === P27), m.outbox.size(), posts('act_lines') - before], [false, true, 0, 1])
  eq('y el historial lo dice', await said('El servidor no dejó quitar una línea de Packing'), [['Ana', '', 'Línea 27']])
  await sql(jose, "update public.act_targets set per_shift = 1, updated_at = now() where dept = 'opt:oplines'"); await m.pullAll()
  m.removeLine(P27); await drain(); await quiet()
  eq('con la regla encendida la quita, y no vuelve', [await lineGone(P27), st().lines.some((l) => l.id === P27), m.outbox.size()], [true, false, 0])
  remember(meOf(ana, 'op', 'Packing'))

  // A manager takes off a run on this tablet with no session, and leaves; Ana, who may not, signs in. Sent with her,
  // the server would keep the run and the manager's "Borrar corrida" would be undone without a word: it waits for
  // someone who may. One that also ended the code goes up with her: its end is taken, and the history says the rest
  signedInAs(jose, 'mgr', ''); await m.pullAll()
  const [P28, P29, P30, P31, P32] = [uuid(), uuid(), uuid(), uuid(), uuid()]
  for (const [id, name] of [[P28, 'Línea 28'], [P29, 'Línea 29'], [P30, 'Línea 30'], [P31, 'Línea 31'], [P32, 'Línea 32']]) await addLineSql(jose, id, 'Packing', name)
  await m.pullAll()
  const r3 = startOn(P28, '0896'), r4 = startOn(P29, '0897'), r5 = startOn(P31, '0898'), r6 = startOn(P32, '0899'); await drain()
  m.endRun(r3); m.endRun(r6); await drain()
  // another tablet renames Línea 32 after its code ended, and this one hears it: the app writes a line's name as it is
  // now into its run on every change (putRun), so taking that run off is still taking it off and nothing else (review of
  // 2026-10-18: counted as a change, the manager's deletion went up under Ana and was undone)
  await sql(ana, "update public.act_lines set name = 'Línea 32A', updated_at = now(), updated_by = 'Otra tablet' where id = $1", [P32]); await m.pullAll()
  signedOut(); m.deleteRun(r3); m.endRun(r4); m.deleteRun(r4); m.deleteRun(r5); m.deleteRun(r6); await quiet()
  const held6 = m.outbox.items().find((i) => i.key === r6)
  eq('quitar la corrida de una línea que cambió de nombre es solo quitarla', [held6.row.line, held6.base.line, m.onlyTakesOff('act_runs', held6.row, held6.base)], ['Línea 32A', 'Línea 32', true])
  signedInAs(ana, 'op', 'Packing'); before = posts('act_runs'); await m.syncNow(); await quiet()
  eq('entra Ana: el borrado del manager no sube con ella; espera, dicho aparte, sin alerta roja', [(await runSrv(r3)).deleted, (await runSrv(r6)).deleted, m.outbox.items().map((i) => i.key).sort(), posts('act_runs') - before, m.syncStore.get().other, m.syncStore.get().otherRooms, m.syncStore.get().refused, !!runHere(r3), !!runHere(r6)], [false, false, [r3, r6].sort(), 2, 2, [], 0, false, false])
  // the history line of a deletion the server kept is its author's (the manager's), not of whoever is signed in now
  eq('el que también terminó el código sube con ella: el fin queda, el servidor deja la corrida, y el historial lo dice a nombre del manager', [await runSrv(r4), runHere(r4), await said('El servidor no dejó borrar la corrida 0897 del ' + date() + ' (Packing, Línea 29)')], [{ ended: true, units: 0, waste: 0, deleted: false }, { ended: true, units: 0, waste: 0, deleted: false }, [['Jose', '', '0 pallets']]])
  // A code still running is not held (review of 2026-10-18): held, it went on running on the server and on every other
  // tablet while this one showed its line free, and the code Ana started there next left two open on that line
  eq('el que seguía corriendo sube también: el servidor lo deja, y aquí sigue corriendo en su línea', [await runSrv(r5), runHere(r5), m.openRun(st(), P31)?.id, await said('El servidor no dejó borrar la corrida 0898 del ' + date() + ' (Packing, Línea 31)')], [{ ended: false, units: 0, waste: 0, deleted: false }, { ended: false, units: 0, waste: 0, deleted: false }, r5, [['Jose', '', '0 pallets']]])
  m.endRun(r5); const r7 = startOn(P31, '0900'); await drain()
  eq('Ana lo termina y empieza el siguiente: un solo código abierto en esa línea', (await sql(null, 'select code from public.act_runs where line_id = $1 and ended_at is null and not deleted', [P31])).rows.map((r) => r.code), ['0900'])
  m.endRun(r7); await drain()
  // while the manager's deletion waits, another tablet adds a pallet to that run: the two are merged, it still waits,
  // and it is still the manager's (rebuilt, it was stamped as Ana's and went up named as hers; review of 2026-10-18)
  await sql(ana, "update public.act_runs set units = units || $2::jsonb, updated_at = now(), updated_by = 'Otra tablet' where id = $1", [r3, JSON.stringify([{ at: Date.now(), qty: 36, ref: '2', by: 'Otra' }])])
  before = posts('act_runs'); await m.syncNow(); await quiet()
  const held3 = m.outbox.items().find((i) => i.key === r3)
  eq('otra tablet le agrega un pallet mientras espera: sigue esperando, con el pallet, y a nombre del manager', [posts('act_runs') - before, held3?.row.units.length, held3?.row.updated_by, !!held3 && m.onlyTakesOff('act_runs', held3.row, held3.base), (await runSrv(r3)).deleted], [0, 1, 'Jose', true, false])
  await sql(null, "update public.employees set act_powers = '{del}' where user_id = $1", [ana.id]); remember(meOf(ana, 'op', 'Packing', { powers: ['del'] }))
  await m.flushNow(); await quiet()
  const by3 = (await sql(null, 'select updated_by from public.act_runs where id = $1', [r3])).rows[0].updated_by
  eq('le dan a Ana el poder: sube en la vuelta siguiente, y la corrida queda borrada, con su pallet y a nombre del manager', [await runSrv(r3), by3, (await runSrv(r6)).deleted, !!runHere(r3), m.outbox.size(), m.syncStore.get().other], [{ ended: true, units: 1, waste: 0, deleted: true }, 'Jose', true, false, 0, 0])
  await sql(null, 'update public.employees set act_powers = null where user_id = $1', [ana.id]); remember(meOf(ana, 'op', 'Packing'))
  // a line the manager took off with the rule off waits the same way, and goes up when the manager is back; while the
  // tablet does not know yet who signed in (the server has not said), it waits too
  await sql(jose, "update public.act_targets set per_shift = 0, updated_at = now() where dept = 'opt:oplines'"); await m.pullAll()
  signedOut(); m.removeLine(P30); await quiet()
  signedInAs(ana, 'op', 'Packing'); await m.syncNow(); await quiet()
  eq('entra Ana: la línea que quitó el manager espera', [await lineGone(P30), m.outbox.items().map((i) => i.key)], [false, [P30]])
  signedInAs(jose, 'mgr', ''); disk.delete('act_me'); await m.syncNow(); await quiet()
  eq('entra el manager, y el servidor todavía no ha dicho quién es: espera', [await lineGone(P30), m.outbox.items().map((i) => i.key)], [false, [P30]])
  remember(meOf(jose, 'mgr', '', { admin: true })); await m.flushNow(); await sent()
  eq('ya se sabe que es el manager: sube, y la línea queda quitada', [await lineGone(P30), st().lines.some((l) => l.id === P30), m.outbox.size()], [true, false, 0])
  await sql(jose, "update public.act_targets set per_shift = 1, updated_at = now() where dept = 'opt:oplines'")
  signedInAs(ana, 'op', 'Packing'); await m.pullAll()
}

section('Un cambio del programa o de una meta que esperó en la tablet no pisa otro más nuevo del servidor (Jose, 2026-10-18)')
{
  // A room's program and each shift's goal go whole, the last change standing. One that waited on this tablet (the
  // server would not take it from whoever signed in after its author, audit S2) must not write over one somebody made
  // after it: the newer one stands, by the moment each was made, and the history says what was not sent
  const edgar = await person(db, { name: 'Edgar', actRole: 'office' })
  const posts = (t) => asked.filter(([method, x]) => method === 'POST' && x === t).length
  const goalSrv = async (key) => { const r = (await sql(null, 'select per_hour, per_shift, updated_by from public.act_targets where dept = $1', [key])).rows[0]; return r ? [Number(r.per_hour), Number(r.per_shift), r.updated_by] : null }
  const goalHere = (dept, shift) => { const g = m.shiftGoalOf(st(), dept, shift); return [g.perHour, g.total] }
  const setGoalSql = (key, perHour, perShift, when = 'now()') => sql(edgar, `insert into public.act_targets (dept, per_hour, per_shift, updated_at, updated_by) values ($1, $2, $3, ${when}, 'Edgar') on conflict (dept) do update set per_hour = excluded.per_hour, per_shift = excluded.per_shift, updated_at = excluded.updated_at, updated_by = excluded.updated_by`, [key, perHour, perShift])
  const notSent = async (key) => (await sql(null, "select by_name, what, before, after from public.act_changes where ref_key = $1 and what like '%no se subió%' order by at", [key])).rows.map((r) => [r.by_name, r.what, r.before, r.after])
  const waiting = (t) => m.outbox.items().filter((i) => i.table === t).map((i) => i.key)
  // the manager sets the goal of RTE's second shift with no session and leaves; Ana, who may not set goals, signs in
  signedInAs(jose, 'mgr', ''); await m.pullAll()
  signedOut(); m.setShiftGoal('RTE', 2, 10, 80); await quiet()
  signedInAs(ana, 'op', 'Packing'); await m.syncNow(); await quiet()
  eq('entra Ana: la meta del manager espera en la tablet', [waiting('act_targets'), await goalSrv('RTE@2')], [['RTE@2'], null])
  // the office sets that same goal from its PC; then the manager comes back to this tablet
  await setGoalSql('RTE@2', 12, 96)
  signedInAs(jose, 'mgr', ''); await m.syncNow(); await sent()
  eq('entra el manager: queda la de la oficina, hecha después, en el servidor y en la tablet, y nada espera', [await goalSrv('RTE@2'), goalHere('RTE', 2), m.outbox.size()], [[12, 96, 'Edgar'], [12, 96], 0])
  eq('el historial dice lo que no se subió, de quién era y quién lo cambió después', await notSent('RTE@2'), [['Jose', 'Meta RTE · Turno 2 · no se subió: Edgar lo cambió después', '10 por hora · 80 del turno', '12 por hora · 96 del turno']])
  // the office's change lands after this tablet's last pull, while its own waits: the tablet asks the server for that
  // goal before sending its own (it had not heard of the office's)
  signedOut(); m.setShiftGoal('RTE', 1, 20, 160); await quiet()
  signedInAs(jose, 'mgr', ''); await m.pullAll()
  await setGoalSql('RTE@1', 22, 176)
  await m.flushNow(); await sent()
  eq('la tablet pregunta antes de mandar: queda la de la oficina', [await goalSrv('RTE@1'), goalHere('RTE', 1), m.outbox.size(), (await notSent('RTE@1')).map((x) => x[1])], [[22, 176, 'Edgar'], [22, 176], 0, ['Meta RTE · Turno 1 · no se subió: Edgar lo cambió después']])
  // the other way round: the office set it before the manager did here, and the manager's goes up
  await setGoalSql('Kitchen@1', 5, 40, "now() - interval '1 minute'")
  signedOut(); m.setShiftGoal('Kitchen', 1, 6, 48); await quiet()
  signedInAs(jose, 'mgr', ''); await m.syncNow(); await sent()
  eq('la de la oficina era de antes: sube la del manager', [await goalSrv('Kitchen@1'), goalHere('Kitchen', 1), await notSent('Kitchen@1')], [[6, 48, 'Jose'], [6, 48], []])
  // when the server cannot say what it has of that goal, the goal waits for the next pass instead of going blind
  signedOut(); m.setShiftGoal('Kitchen', 2, 7, 56); await quiet()
  signedInAs(jose, 'mgr', ''); await m.pullAll()
  net.failGet = 'act_targets'; const b = posts('act_targets')
  await m.flushNow(); await quiet()
  net.failGet = null
  eq('sin respuesta del servidor sobre esa meta, no se manda a ciegas: espera', [posts('act_targets') - b, waiting('act_targets')], [0, ['Kitchen@2']])
  await m.flushNow(); await sent()
  eq('y en la vuelta siguiente sube', [await goalSrv('Kitchen@2'), m.outbox.size()], [[7, 56, 'Jose'], 0])
  // a room's program: the manager types RTE's for today with no session and leaves; Ana (Packing) does not even hear
  // RTE's program. The office changes that code meanwhile; then the manager comes back
  // (a row of the program is its day, room, code AND lot since 021, the office's 889 of two lots on 2026-10-20)
  const day = date(), planSrv = async (lot = '') => { const r = (await sql(null, "select qty, updated_by from public.act_plan where date = $1 and dept = 'RTE' and code = '100' and lot = $2", [day, lot])).rows[0]; return r ? [Number(r.qty), r.updated_by] : null }
  const lotsSrv = async () => (await sql(null, "select lot, qty from public.act_plan where date = $1 and dept = 'RTE' and code = '100' order by lot", [day])).rows.map((r) => [r.lot, Number(r.qty)])
  signedOut(); m.setPlan(day, 'RTE', '0100', 500); await quiet()
  signedInAs(ana, 'op', 'Packing'); await m.syncNow(); await quiet()
  eq('entra Ana: el programa de RTE espera aparte', [waiting('act_plan'), m.syncStore.get().otherRooms.includes('RTE'), await planSrv()], [[day + '|RTE|100'], true, null])
  await sql(edgar, "insert into public.act_plan (date, dept, code, qty, updated_at, updated_by) values ($1, 'RTE', '100', 650, now(), 'Edgar') on conflict (date, dept, code, lot) do update set qty = excluded.qty, updated_at = excluded.updated_at, updated_by = excluded.updated_by", [day])
  signedInAs(jose, 'mgr', ''); await m.syncNow(); await sent()
  eq('entra el manager: queda el 650 de la oficina, y el historial dice que el 500 no se subió', [await planSrv(), m.planOf(st(), day, 'RTE').map((p) => [p.code, p.qty]), m.outbox.size(), await notSent(day + '|RTE|100')], [[650, 'Edgar'], [['0100', 650]], 0, [['Jose', 'Programa ' + day + ' · RTE · 100 · no se subió: Edgar lo cambió después', '500', '650']]])
  // the program's lot (Jose, 2026-10-19): a row the office wrote without the column came down with the lot empty
  eq('lo que bajó sin lote se lee vacío', m.planOf(st(), day, 'RTE').map((p) => p.lot), [''])
  // The server as it was before 019: no lot column, its key (date, dept, code). The program waits in the queue (nothing
  // is lost) and the screen names the SQL that is missing; with 019 run and 021 not yet (the server as it is on
  // 2026-10-20, before Jose runs 021) it still waits: its key (date, dept, code, lot) is not there (42P10), said too;
  // once 021 is run, it goes up on the next pass
  await sql(null, 'alter table public.act_plan drop column lot') // (the key of 021 goes with the column)
  await sql(null, 'alter table public.act_plan add primary key (date, dept, code)')
  m.setPlan(day, 'RTE', '0100', 700); await m.flushNow(); await quiet()
  eq('sin la columna del 019 el programa espera en la cola y la pantalla dice qué SQL falta', [waiting('act_plan'), m.syncStore.get().lastError, await sql(null, "select qty::int as q from public.act_plan where date = $1 and dept = 'RTE' and code = '100'", [day]).then((r) => r.rows.map((x) => x.q))], [[day + '|RTE|100'], 'Falta ejecutar en Supabase el SQL 019 (el lote del programa): el programa espera', [650]])
  await runFile(db, '019_plan_lot.sql'); await m.flushNow(); await quiet()
  eq('corrido el 019 y no el 021: el programa por lote no encuentra su llave (42P10), sigue esperando, nunca se tira, y la pantalla dice el 021', [waiting('act_plan'), m.syncStore.get().lastError, await planSrv()], [[day + '|RTE|100'], 'Falta ejecutar en Supabase el SQL 021 (el programa por lote): el programa espera', [650, 'Edgar']])
  await runFile(db, '021_plan_by_lot.sql'); await m.flushNow(); await sent()
  eq('corrido el 021, sube en la vuelta siguiente, y la pantalla ya no dice nada', [await planSrv(), m.outbox.size(), m.syncStore.get().lastError], [[700, 'Jose'], 0, ''])
  // the office moves the row to lot 6300 in its dialog: the row without a lot is taken off, the one of 6300 is set,
  // and the server keeps both rows (another lot of the code is another row)
  m.setPlan(day, 'RTE', '0100', 0); m.setPlan(day, 'RTE', '0100', 650, '6300'); await m.syncNow(); await sent()
  eq('el lote sube con su fila y el servidor la guarda aparte de la de sin lote (019 y 021)', [await lotsSrv(), m.outbox.size()], [[['', 0], ['6300', 650]], 0])
  // A tablet still on the build of before, once 021 is run, sends a program by (date, dept, code): the server has no
  // such key (42P10) and takes nothing of it (that build stops its pass there and tries again every 20 s; the row stays
  // in its queue). The new build calls that answer "not ready": it waits, never dropped. When that tablet opens the
  // new build, the row it left queued under its code alone takes its lot's key and goes up
  const oldRow = { date: day, dept: 'RTE', code: '100', qty: 800, lot: '6300', order_id: null, updated_at: new Date().toISOString(), updated_by: 'Jose' }
  const { error: oldErr } = await m.supabase.from('act_plan').upsert(oldRow, { onConflict: 'date,dept,code' })
  eq('la versión de antes, después del 021: el servidor no tiene esa llave (42P10) y no cambia nada; esta versión lo llama "esperar"', [oldErr?.code, m.verdict(String(oldErr?.code ?? ''), oldErr?.message ?? ''), await lotsSrv()], ['42P10', 'notReady', [['', 0], ['6300', 650]]])
  disk.set('act_outbox', JSON.stringify([...JSON.parse(disk.get('act_outbox') || '[]'), { table: 'act_plan', key: day + '|RTE|100', row: oldRow, at: Date.now() }]))
  m.rekeyQueuedPlans() // what the new build does when it opens
  eq('lo que esa versión dejó en la cola con la llave del código solo toma la de su lote', waiting('act_plan'), [day + '|RTE|100|6300'])
  await m.flushNow(); await sent()
  eq('y sube con la llave nueva: el renglón del 6300 queda en 800, el de sin lote como estaba', [await lotsSrv(), m.outbox.size(), m.syncStore.get().lastError], [[['', 0], ['6300', 800]], 0, ''])
  // A copy of before 2026-10-20 that the server no longer has: one row per code then, and its lot was changed in
  // place; a tablet that missed that change kept the old lot (6299 here). The first whole pull of the new build (every
  // new version pulls everything once) lets it go: the server's rows stay, and nothing waiting in the queue goes
  m.applyRemote('act_plan', { date: day, dept: 'RTE', code: '100', qty: 640, lot: '6299', order_id: null, updated_at: new Date(Date.now() - 3600e3).toISOString(), updated_by: 'Jose' })
  const lotsHere = () => m.store.get().plans.filter((p) => p.date === day && p.dept === 'RTE' && m.normCode(p.code) === '100').map((p) => [p.lot, p.qty]).sort()
  const staleBefore = lotsHere()
  disk.delete('act_pulled_with'); await m.pullAll()
  // (the 800 the queue of before sent was not on this screen yet: it comes with the pull)
  eq('una copia vieja que el servidor ya no tiene se suelta en la primera bajada entera; las del servidor quedan', [staleBefore, lotsHere()], [[['', 0], ['6299', 640], ['6300', 650]], [['', 0], ['6300', 800]]])
  // the tablet is Ana's again for what follows
  signedInAs(ana, 'op', 'Packing'); await m.pullAll()
}

// ---- the production orders (Jose and the office, 2026-10-19) ----
const elsa = await person(db, { name: 'Elsa', actRole: 'office' })
/** an order typed by the office on its PC (Elsa), straight to the server */
const orderSql = (id, dept, c, wo, qty, unitWord, start, created = 'now()') => sql(elsa, `insert into public.act_work_orders (id, dept, code, wo, qty, unit, start_date, created_at, created_by, updated_at, updated_by) values ($1, $2, $3, $4, $5, $6, $7, ${created}, 'Elsa', now(), 'Elsa')`, [id, dept, c, wo, qty, unitWord, start])

section('Antes de que Jose corra el 020: un programa sin pedido sube; un pedido y el programa que lo nombra esperan, dicho en la pantalla (2026-10-19)')
{
  signedInAs(jose, 'mgr', ''); await m.pullAll()
  // the server as it is until Jose runs 020: no table of orders, no column for a program's order
  await sql(null, 'drop table public.act_work_orders')
  await sql(null, 'alter table public.act_plan drop column order_id')
  const day = date(), posts = (t) => asked.filter(([method, x]) => method === 'POST' && x === t).length
  const planSrv = async (c) => { const r = (await sql(null, "select * from public.act_plan where date = $1 and dept = 'Kitchen' and code = $2", [day, c])).rows[0]; return r ? [Number(r.qty), r.order_id === undefined ? 'sin columna' : r.order_id] : null }
  const p0 = posts('act_plan')
  m.setPlan(day, 'Kitchen', 'S100', 5); await sent()
  eq('un programa sin pedido sube igual: el servidor no conoce order_id (PGRST204) y la fila se manda otra vez sin la columna', [await planSrv('S100'), posts('act_plan') - p0, m.outbox.size(), m.syncStore.get().lastError], [[5, 'sin columna'], 2, 0, ''])
  const O = m.saveWorkOrder({ dept: 'Kitchen', code: 'S200', qty: 100, unit: 'mezclas', startDate: day, wo: 'S-1', note: '' })
  m.setPlan(day, 'Kitchen', 'S200', 10, '', O)
  m.setPlan(day, 'Kitchen', 'S300', 7)
  await m.flushNow(); await quiet()
  const waits = () => m.outbox.items().filter((i) => i.table === 'act_work_orders' || i.table === 'act_plan').map((i) => i.table + '|' + i.key).sort()
  eq('el pedido y el programa que lo nombra esperan en la tablet; el programa sin pedido escrito después sube; la pantalla nombra el SQL que falta', [waits(), await planSrv('S300'), await planSrv('S200'), m.syncStore.get().lastError], [['act_plan|' + day + '|Kitchen|S200', 'act_work_orders|' + O], [7, 'sin columna'], null, 'Falta ejecutar en Supabase el SQL 020 (pedidos de producción): un programa con pedido espera'])
  eq('bajar del servidor sigue igual (la tabla que falta no se nota), y la tablet guarda el pedido con su programa', [await m.pullAll(), m.workOrderOf(st(), O)?.wo, m.planRows(st(), day, 'Kitchen').find((r) => r.code === 'S200')?.orderId], [true, 'S-1', O])
  await runFile(db, '020_work_orders.sql'); await m.flushNow(); await sent()
  const woSrv = async (id) => (await sql(null, 'select dept, code, wo, qty::float as qty, unit, start_date::text as start, created_by from public.act_work_orders where id = $1', [id])).rows[0] ?? null
  eq('corrido el 020: el pedido y su programa suben solos en la vuelta siguiente, y la pantalla ya no dice nada', [await woSrv(O), await planSrv('S200'), m.outbox.size(), m.syncStore.get().lastError], [{ dept: 'Kitchen', code: 'S200', wo: 'S-1', qty: 100, unit: 'mezclas', start: day, created_by: 'Jose' }, [10, O], 0, ''])
}

section('Dos pedidos del mismo código escritos a la vez, uno en una tablet sin señal: quedan los dos, y el más viejo va primero (2026-10-19)')
{
  const day = date()
  let mine = ''
  await offline(() => { mine = m.saveWorkOrder({ dept: 'Kitchen', code: 'S400', qty: 80, unit: 'mezclas', startDate: day, wo: 'T-1', note: '' }) })
  await orderSql(uuid(), 'Kitchen', 'S400', 'E-1', 50, 'mezclas', day, "now() - interval '1 minute'")
  await m.syncNow(); await sent()
  eq('el servidor guarda los dos; la tablet tiene los dos, el que se escribió antes primero', [(await sql(null, "select wo from public.act_work_orders where dept = 'Kitchen' and code = 'S400' order by wo")).rows.map((r) => r.wo), m.openWorkOrdersFor(st(), 'Kitchen', 'S400', '', day).map((o) => o.wo), !!m.workOrderOf(st(), mine)], [['E-1', 'T-1'], ['E-1', 'T-1'], true])
}

section('Un pedido y el programa que lo nombra, escritos en la PC de la oficina: la tablet los baja y cuenta lo que ella registra (2026-10-19)')
{
  const day = date(), O3 = uuid()
  await orderSql(O3, 'Kitchen', 'S500', 'E-5', 40, 'mezclas', day)
  await sql(elsa, "insert into public.act_plan (date, dept, code, qty, lot, order_id, updated_at, updated_by) values ($1, 'Kitchen', 'S500', 12, '', $2, now(), 'Elsa')", [day, O3])
  m.addLine('Kitchen', 'Braiser 7')
  const b7 = st().lines.find((l) => l.dept === 'Kitchen' && l.name === 'Braiser 7')
  m.startRun(b7, 'S500', '6300', day, null)
  const run = st().runs.find((r) => r.lineId === b7.id && !r.endedAt)
  for (let i = 0; i < 3; i++) m.unitDone(run.id, null)
  m.endRun(run.id); await m.syncNow(); await sent()
  const row = m.planRows(st(), day, 'Kitchen').find((r) => r.code === 'S500'), x = m.orderStatus(st(), m.workOrderOf(st(), O3), day)
  eq('el programa es de su pedido; el pedido cuenta las 3 mezclas de esta tablet: 37 disponibles, 9 pendientes del día, 28 sin programar', [row?.orderId, row?.planned, row?.done, x.made, x.disponible, x.pendingToday, x.sinProgramar, x.byDay.map((d) => [d.programmed, d.made, d.pending])], [O3, 12, 3, 3, 37, 9, 28, [[12, 3, 9]]])
}

section('La tablet de un operador baja solo los pedidos de su cuarto (2026-10-19)')
{
  const day = date(), PK = uuid(), KX = uuid()
  signedInAs(ana, 'op', 'Packing'); await m.pullAll()
  await orderSql(PK, 'Packing', 'S800', '', 360, 'cajas', day)
  await orderSql(KX, 'Kitchen', 'S900', '', 20, 'mezclas', day)
  const g0 = net.gets.length
  await m.pullAll()
  const ask = net.gets.slice(g0).filter((g) => g.startsWith('act_work_orders?'))
  eq('baja el de Packing y no el de Kitchen, y los pide por su cuarto', [!!m.workOrderOf(st(), PK), !!m.workOrderOf(st(), KX), ask.length > 0 && ask.every((g) => g.includes('dept=eq.Packing'))], [true, false, true])
}

section('Un pedido que empezó hace 20 días: sus días viejos se traen del servidor y se guardan; terminado, su cuenta se cierra y otra tablet no los vuelve a pedir (2026-10-19)')
{
  signedInAs(jose, 'mgr', ''); await m.pullAll()
  const day = date(), back = (n) => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() - n); return m.dayOf(d.getTime()) }
  const at = (d, h, mi) => new Date(d + 'T' + String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0') + ':00').getTime()
  const OPEN = uuid(), DONE = uuid(), LINE = uuid()
  await orderSql(OPEN, 'Kitchen', 'S610', 'V-1', 100, 'mezclas', back(20), "now() - interval '20 days'")
  await orderSql(DONE, 'Kitchen', 'S710', 'V-2', 30, 'mezclas', back(20), "now() - interval '20 days'")
  // runs of 20 days ago as the server holds them: stamped then (a pull of what changed lately does not bring them)
  await sql(null, 'alter table public.act_runs disable trigger act_runs_touch')
  const oldRun = (c, d, n) => sql(null, "insert into public.act_runs (id, dept, line_id, line, code, lot, date, started_at, ended_at, units, per_unit, waste, by_name, deleted, updated_at, synced_at) values ($1, 'Kitchen', $2, 'Braiser 8', $3, '6280', $4, $5, $6, $7::jsonb, null, 0, 'prueba', false, $5, now() - interval '20 days')", [uuid(), LINE, c, d, iso(at(d, 7, 59)), iso(at(d, 9, 0)), JSON.stringify(Array.from({ length: n }, (_, i) => ({ at: at(d, 8, i), qty: null, ref: '', by: 'Luis' })))])
  await oldRun('S610', back(20), 20); await oldRun('S610', back(18), 10)
  await oldRun('S710', back(20), 20); await oldRun('S710', back(19), 15)
  await sql(null, 'alter table public.act_runs enable trigger act_runs_touch')
  const g0 = net.gets.length
  await m.pullAll()
  const old = (from) => net.gets.slice(from).filter((g) => g.startsWith('act_runs?') && g.includes('date=gte.' + back(20))).map((g) => (/S710/.test(g) ? 'S710' : /S610/.test(g) ? 'S610' : '?')).sort()
  eq('los días viejos de los dos pedidos se le piden al servidor, por su código y desde que empezaron', old(g0), ['S610', 'S710'])
  const open = m.orderStatus(st(), m.workOrderOf(st(), OPEN), day), done = m.orderStatus(st(), m.workOrderOf(st(), DONE), day)
  eq('el abierto guarda aparte sus corridas viejas y cuenta todo lo hecho desde que empezó', [open.made, open.disponible, open.complete, open.state, st().orderRuns.filter((r) => r.code === 'S610').length, st().runs.some((r) => r.code === 'S610')], [30, 70, true, 'abierto', 2, false])
  eq('el que terminó antes de los días que guarda: su cuenta se cierra, y sus corridas viejas no se quedan', [done.sealed, done.state, done.made, done.finishDay, st().orderRuns.some((r) => r.code === 'S710')], [true, 'completado', 30, back(19), false])
  await sent()
  eq('su marca sube al servidor, con su cuarto', (await sql(null, 'select dept, ref_table, ref_key from public.act_changes where id = $1', ['wodone:' + DONE])).rows[0], { dept: 'Kitchen', ref_table: 'act_work_orders:done', ref_key: DONE })
  // its detail asks the server for what it is made of, and works it out again with it (nothing is saved)
  const rows = await m.loadOrderRows(m.workOrderOf(st(), DONE))
  const again = m.stateWith(st(), rows, rows.unseal, true), dx = m.orderStatus(again, m.workOrderOf(again, DONE), day)
  eq('el detalle trae del servidor sus corridas y su historia, y lo cuenta otra vez igual, sin tocar lo guardado', [rows.from, rows.unseal, rows.runs.length, rows.changes.some((c) => c.id === 'wodone:' + DONE), dx.sealed, dx.complete, dx.made, dx.finishDay, dx.byDay.map((d) => [d.date, d.made]), m.orderStatus(st(), m.workOrderOf(st(), DONE), day).sealed], [back(20), [DONE], 2, true, false, true, 30, back(19), [[back(20), 20], [back(19), 10]], true])
  // a new tablet (or one that lost its copy): the mark gives it that account; it asks the server only for the open one
  const snap = new Map(disk)
  for (const k of ['act_v1', 'act_since2', 'act_since_span', 'act_outbox', 'act_pulled_with', 'act_last_pull']) disk.delete(k)
  const fresh = await import(pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/.cache/act-check/device.js')).href + '?stack2')
  fresh.role.set('mgr'); fresh.myDept.set('')
  const g1 = net.gets.length
  const pulled = await fresh.pullAll()
  const fs = () => fresh.store.get(), fd = fresh.orderStatus(fs(), fresh.workOrderOf(fs(), DONE), day), fo = fresh.orderStatus(fs(), fresh.workOrderOf(fs(), OPEN), day)
  eq('otra tablet, nueva: con la marca tiene la cuenta del terminado sin pedir sus días viejos; los del abierto sí los pide', [pulled, fd.sealed, fd.state, fd.made, fo.made, fo.complete, old(g1)], [true, true, 'completado', 30, 30, true, ['S610']])
  await quiet()
  for (const k of [...disk.keys()]) disk.delete(k)
  for (const [k, v] of snap) disk.set(k, v)
  signedInAs(ana, 'op', 'Packing'); await m.pullAll()
}

section('Un cambio de un pedido de producción cuya respuesta se pierde, deshecho antes de la vuelta siguiente: queda lo último que se escribió (revisión 2026-10-20)')
{
  signedInAs(jose, 'mgr', ''); await m.pullAll()
  const day = date()
  const woSrv = async (id) => (await sql(null, 'select qty::float as qty, closed_at is not null as closed from public.act_work_orders where id = $1', [id])).rows[0]
  const O = m.saveWorkOrder({ dept: 'Kitchen', code: 'S950', qty: 100, unit: 'mezclas', startDate: day, wo: 'U-1', note: '' }); await sent()
  // 100 → 200: the server takes it and the answer never comes back (the 25 s limit, a WiFi that drops)
  net.lose = 'act_work_orders'
  m.saveWorkOrder({ dept: 'Kitchen', code: 'S950', qty: 200, unit: 'mezclas', startDate: day, wo: 'U-1', note: '' }, O); await lost()
  eq('el servidor tiene 200 y la tablet no lo supo', [(await woSrv(O)).qty, m.outbox.items().some((i) => i.table === 'act_work_orders' && i.key === O)], [200, true])
  // the office puts it back to 100 before the next pass. Until the review it was taken for another device's change:
  // the server's 200 was kept, on the server and on the tablet
  await offline(() => m.saveWorkOrder({ dept: 'Kitchen', code: 'S950', qty: 100, unit: 'mezclas', startDate: day, wo: 'U-1', note: '' }, O))
  await m.syncNow(); await sent()
  eq('vuelto a 100: 100 en el servidor y en la tablet, nada esperando', [(await woSrv(O)).qty, m.workOrderOf(st(), O).qty, m.outbox.size()], [100, 100, 0])
  // the same with closing (its answer lost) and reopening
  net.lose = 'act_work_orders'
  m.closeWorkOrder(O); await lost()
  eq('cerrado en el servidor sin que la tablet lo supiera', (await woSrv(O)).closed, true)
  await offline(() => m.reopenWorkOrder(O))
  await m.syncNow(); await sent()
  eq('reabierto: abierto en el servidor y en la tablet (quedaba cerrado mientras la historia decía "Reabierto")', [(await woSrv(O)).closed, m.workOrderOf(st(), O).closedAt], [false, null])
}

section('Una corrida vieja que un pedido sigue contando, borrada en el servidor mientras la tablet estaba cerrada: la versión nueva la suelta (revisión 2026-10-20)')
{
  signedInAs(jose, 'mgr', ''); await m.pullAll()
  const day = date(), back = (n) => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() - n); return m.dayOf(d.getTime()) }
  const at = (d, h, mi) => new Date(d + 'T' + String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0') + ':00').getTime()
  const OLD = uuid(), LINE = uuid(), runs = [uuid(), uuid()]
  await orderSql(OLD, 'Kitchen', 'S960', 'D-1', 100, 'mezclas', back(20), "now() - interval '20 days'")
  // two runs of those days, as the server holds them: stamped then (a pull of what changed lately does not bring them)
  await sql(null, 'alter table public.act_runs disable trigger act_runs_touch')
  const oldRun = (id, d, n) => sql(null, "insert into public.act_runs (id, dept, line_id, line, code, lot, date, started_at, ended_at, units, per_unit, waste, by_name, deleted, updated_at, synced_at) values ($1, 'Kitchen', $2, 'Braiser 9', 'S960', '6280', $3, $4, $5, $6::jsonb, null, 0, 'prueba', false, $4, now() - interval '20 days')", [id, LINE, d, iso(at(d, 7, 59)), iso(at(d, 9, 0)), JSON.stringify(Array.from({ length: n }, (_, i) => ({ at: at(d, 8, i), qty: null, ref: '', by: 'Luis' })))])
  await oldRun(runs[0], back(20), 30); await oldRun(runs[1], back(19), 20)
  await sql(null, 'alter table public.act_runs enable trigger act_runs_touch')
  await m.pullAll()
  const made = (x) => x.orderStatus(x.store.get(), x.workOrderOf(x.store.get(), OLD), day).made
  eq('la tablet guarda aparte las dos corridas viejas y cuenta 50', [made(m), st().orderRuns.filter((r) => r.code === 'S960').length], [50, 2])
  // the office takes the second one away on the server while this tablet is closed; then a new version is published
  await sql(null, 'update public.act_runs set deleted = true, updated_at = now() where id = $1', [runs[1]])
  await quiet()
  const snap = new Map(disk)
  disk.delete('act_pulled_with') // a new version (or whose rows it brings changed): the next pull brings everything again
  const opened = await import(pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/.cache/act-check/device.js')).href + '?stack-newver')
  opened.role.set('mgr'); opened.myDept.set('')
  await opened.pullAll()
  // (a whole pull lists only the days a device keeps and what is still open: the deleted run came only with its order's
  // old days, which were asked for without the runs taken off; the tablet kept counting it, and could close the order's
  // account with it and share it)
  eq('la versión nueva baja todo: la corrida borrada se va y el pedido cuenta 30', [made(opened), opened.store.get().orderRuns.filter((r) => r.code === 'S960').map((r) => r.id)], [30, [runs[0]]])
  await quiet()
  for (const k of [...disk.keys()]) disk.delete(k)
  for (const [k, v] of snap) disk.set(k, v)
  signedInAs(ana, 'op', 'Packing'); await m.pullAll()
}

section('Una respuesta que se pierde y la app se vuelve a abrir antes de saberlo: lo que se mandó se recuerda (auditoría 2026-10-17, S1)')
{
  // what was sent is written down before it goes, so a reload in the middle (a new version, a reload by hand) does
  // not forget it. (Last section: from here on this tablet is the app opened again)
  net.lose = 'act_stops'
  m.startStop('Packing', P2, 'Break', ''); await lost()
  const sid = st().stops.find((x) => x.lineId === P2 && !x.endedAt).id
  const again = await import(pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/.cache/act-check/device.js')).href + '?stack-again')
  again.role.set('op'); again.myDept.set('Packing')
  eq('al volver a abrir, el paro sigue en la cola', again.outbox.items().some((i) => i.key === sid), true)
  await offline(() => again.endStop(sid))
  await again.syncNow()
  for (let i = 0; i < 300 && again.outbox.size(); i++) { await sleep(50); await again.flushNow() }
  await quiet()
  eq('terminado sin señal después de volver a abrir: terminado en el servidor y en la tablet, sin nada en la cola', [!!(await stopSrv(sid)).ended_at, !!again.store.get().stops.find((x) => x.id === sid)?.endedAt, again.outbox.size()], [true, true, 0])
}
console.warn = quietWarn
await db.close()
console.log(failed.length ? `\n✗ ${failed.length} de ${passed + failed.length} comprobaciones fallaron:\n\n  ${failed.join('\n\n  ')}\n` : `\n✓ ${passed} comprobaciones, todas correctas (la app contra Postgres de verdad)\n`)
process.exit(failed.length ? 1 : 0)
