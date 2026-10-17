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
globalThis.fetch = restOver(db, { log: asked })
const m = await import(pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/.cache/act-check/device.js')).href + '?stack')
m.role.set('op'); m.myDept.set('Packing')
const st = () => m.store.get()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** until the queue has sent what it can: a new record starts a pass by itself, and asking again while it runs returns at once */
async function drain() { let r = { refused: 0 }; for (let i = 0; i < 60; i++) { await sleep(10); r = await m.flushNow(); if (!m.outbox.size() || r.refused) break } return r }
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
await db.close()
console.log(failed.length ? `\n✗ ${failed.length} de ${passed + failed.length} comprobaciones fallaron:\n\n  ${failed.join('\n\n  ')}\n` : `\n✓ ${passed} comprobaciones, todas correctas (la app contra Postgres de verdad)\n`)
process.exit(failed.length ? 1 : 0)
