// The app against the server, end to end, on this machine: its own sync code (pull, the queue that sends, the line
// check) talks to the real Postgres of pg.mjs through pgrest.mjs, as a tablet talks to Supabase. What the database does
// by itself (its permissions, its triggers, its clock) reaches the screen as it would on the floor. Made-up people.
// Run by: npm run check
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { as, person, serverDb } from './pg.mjs'
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
const asked = []
// the network between the tablet and the server, with switches for the sections that need a bad one (off = as is):
// down = no connection; lose = the next write to that table reaches the server and its answer is lost; fail = the
// server answers every write to that table with an error; inFlight = something happens on the tablet while that
// table's next write is on its way (after the server took it, before the answer arrives); onGet = something happens
// before each read reaches the server (it may take its time: a slow WiFi); failGet = the server answers the reads of
// that table by id ("what do you have of these?") with an error. gets = every read asked, as table?query
const rest = restOver(db, { log: asked })
const net = { down: false, lose: null, fail: null, inFlight: null, onGet: null, failGet: null, gets: [], busy: 0, failed: 0 }
globalThis.fetch = async (input, init = {}) => {
  net.busy++
  try {
    if (net.down) { net.failed++; throw new TypeError('fetch failed') }
    const method = (init.method ?? 'GET').toUpperCase(), url = new URL(typeof input === 'string' ? input : input.url), table = url.pathname.split('/').pop()
    if (method === 'GET' && url.pathname.includes('/rest/v1/')) {
      net.gets.push(table + url.search)
      if (net.failGet === table && url.searchParams.has('id')) { net.failed++; return new Response(JSON.stringify({ code: 'XX000', message: 'server hiccup', details: null, hint: null }), { status: 500, headers: { 'Content-Type': 'application/json' } }) }
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
await sql(ana, "insert into public.act_stops (id, dept, line_id, reason, note, started_at, ended_at, by_name, deleted, updated_at) values ($1, 'Packing', $2, 'Set up', '', $3, null, 'Otra tablet', false, now())", [setupId, line3.id, iso(Date.now() - 20 * 60_000)])
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
  net.lose = 'act_runs'
  m.startRun(line2(), '0892', '6290', date(), 36); await lost()
  const rid = st().runs.find((r) => r.code === '0892').id
  await offline(() => m.deleteRun(rid))
  await m.syncNow(); await sent()
  eq('un código borrado sin señal queda borrado en el servidor y no vuelve a la tablet', [(await runSrv(rid)).deleted, !!runHere(rid), m.outbox.size()], [true, false, 0])
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
const signedInAs = (who, roleText, dept, look = false) => { disk.set('sb-127-auth-token', sessionOf(who)); disk.set('act_user', who.name); m.role.set(roleText); m.myDept.set(dept); disk.set('act_view_only', look ? '1' : '') }
/** "Salir" (or a session the server ended): the session leaves the tablet, the role and the room stay as they were */
const signedOut = () => disk.delete('sb-127-auth-token')
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
