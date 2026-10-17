// The SQL the server runs, tested on a real Postgres before it reaches Supabase (see pg.mjs): every migration applies
// on a new database and can be run again, each role reads and writes what it should, and the triggers do what their
// files say. Made-up people and rows. Run by: npm run check
import { actMigrations, as, code, runFile, serverDb, person } from './pg.mjs'

let passed = 0
const failed = []
let where = ''
const section = (t) => { where = t; console.log('· ' + t) }
const eq = (what, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) passed++; else failed.push(`[${where}] ${what}\n      salió    ${a}\n      esperado ${b}`) }
const iso = (ms) => new Date(ms).toISOString()
const H = 3_600_000, NOW = Date.now()
let n = 0
const uuid = () => '10000000-0000-4000-8000-' + String(++n).padStart(12, '0')
/** a row written as the app writes it: PostgREST's upsert (insert, or on the same id update every column sent) */
async function upsert(tx, table, row, key = 'id') {
  const cols = Object.keys(row), vals = cols.map((c) => (row[c] !== null && typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c]))
  const set = cols.filter((c) => !key.split(',').includes(c)).map((c) => `${c} = excluded.${c}`).join(', ')
  await tx.query(`insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) on conflict (${key}) do update set ${set}`, vals)
}
const line = (id, dept, name, o = {}) => ({ id, dept, name, deleted: false, updated_at: iso(NOW), updated_by: 'prueba', ...o })
const run = (id, dept, lineId, startedAt, o = {}) => ({ id, dept, line_id: lineId, line: 'Línea 1', code: '0889', lot: '6290', date: new Date(startedAt).toISOString().slice(0, 10), started_at: iso(startedAt), ended_at: null, units: [], per_unit: null, waste: 0, by_name: 'prueba', deleted: false, updated_at: iso(startedAt), ...o })
const stop = (id, dept, lineId, startedAt, o = {}) => ({ id, dept, line_id: lineId, reason: 'Set up', note: '', started_at: iso(startedAt), ended_at: null, by_name: 'prueba', deleted: false, updated_at: iso(startedAt), ...o })

section('Las migraciones se aplican en orden sobre una base nueva, y cada una se puede correr otra vez')
const { db, applied } = await serverDb()
eq('todas, en orden, sobre el esquema del proyecto compartido', applied.slice(1), actMigrations())
const again = []
for (const f of actMigrations()) { try { await runFile(db, f) } catch (e) { again.push(String(e.message).slice(0, 160)) } }
eq('ninguna falla al correrla de nuevo ("Safe to run again")', again, [])

section('Cada persona lee y escribe lo que le toca (los permisos del servidor)')
const jose = await person(db, { name: 'Jose', actRole: 'mgr', role: 'admin' })
const ana = await person(db, { name: 'Ana', actRole: 'op', actDept: 'Packing' })
const noe = await person(db, { name: 'Noelia', actRole: 'op', actDept: 'Kitchen' })
const edgar = await person(db, { name: 'Edgar', actRole: 'office' })
const mike = await person(db, { name: 'Mike', actRole: 'viewer' })
const gone = await person(db, { name: 'Antes', actRole: 'op', actDept: 'Packing', active: false })
const P1 = uuid(), R1 = uuid(), K1 = uuid()
await as(db, jose, async (tx) => { await upsert(tx, 'act_lines', line(P1, 'Packing', 'Línea 1')); await upsert(tx, 'act_lines', line(R1, 'RTE', 'Línea 1')); await upsert(tx, 'act_lines', line(K1, 'Kitchen', 'Braiser 1')) })
await as(db, jose, async (tx) => { await upsert(tx, 'act_runs', run(uuid(), 'Packing', P1, NOW - 3 * H)); await upsert(tx, 'act_runs', run(uuid(), 'RTE', R1, NOW - 3 * H)) })
const count = (who, table) => as(db, who, async (tx) => (await tx.query(`select dept, count(*)::int as n from public.${table} group by dept order by dept`)).rows.map((r) => [r.dept, r.n]))
eq('un operador de Packing lee solo Packing', await count(ana, 'act_runs'), [['Packing', 1]])
eq('la oficina y "Solo ver" leen todos los cuartos', [await count(edgar, 'act_runs'), await count(mike, 'act_runs')], [[['Packing', 1], ['RTE', 1]], [['Packing', 1], ['RTE', 1]]])
eq('una cuenta desactivada no lee nada', await count(gone, 'act_runs'), [])
eq('un operador escribe en su cuarto y no en otro', [await code(as(db, ana, (tx) => upsert(tx, 'act_lines', line(uuid(), 'Packing', 'Línea 9')))), await code(as(db, ana, (tx) => upsert(tx, 'act_lines', line(uuid(), 'RTE', 'Línea 9'))))], ['', '42501'])
eq('"Solo ver" no escribe en ningún cuarto', await code(as(db, mike, (tx) => upsert(tx, 'act_lines', line(uuid(), 'Packing', 'Línea 8')))), '42501')
eq('la oficina escribe en cualquiera', await code(as(db, edgar, (tx) => upsert(tx, 'act_lines', line(uuid(), 'RTE', 'Línea 7')))), '')
const target = (key) => ({ dept: key, per_hour: 1, per_shift: 0, updated_at: iso(NOW), updated_by: 'prueba' })
eq('lo que fija el manager (turnos, metas, reglas de líneas): lo escribe el manager, no un operador', [await code(as(db, ana, (tx) => upsert(tx, 'act_targets', target('opt:oplines'), 'dept'))), await code(as(db, jose, (tx) => upsert(tx, 'act_targets', target('opt:oplines'), 'dept')))], ['42501', ''])
eq('y lo leen todos', await as(db, noe, async (tx) => (await tx.query("select per_hour from public.act_targets where dept = 'opt:oplines'")).rows.map((r) => Number(r.per_hour))), [1])

section('El servidor pone su hora a cada fila que llega (el orden de las versiones)')
const L = uuid()
await as(db, ana, (tx) => upsert(tx, 'act_lines', line(L, 'Packing', 'Línea 5')))
const s1 = (await db.query('select synced_at from public.act_lines where id = $1', [L])).rows[0].synced_at
await new Promise((r) => setTimeout(r, 20))
await as(db, ana, (tx) => upsert(tx, 'act_lines', line(L, 'Packing', 'Línea 5', { updated_at: iso(NOW - 1000) })))
const s2 = (await db.query('select synced_at from public.act_lines where id = $1', [L])).rows[0].synced_at
eq('cada versión que llega lleva una hora del servidor más nueva, diga lo que diga el reloj de la tablet', [!!s1, s2 > s1], [true, true])

section('017: dos líneas de un cuarto nunca tienen el mismo nombre')
const PL2 = uuid()
await as(db, jose, (tx) => upsert(tx, 'act_lines', line(PL2, 'Packing', 'Línea 2')))
const copy = uuid(), copy2 = uuid()
await as(db, ana, (tx) => upsert(tx, 'act_lines', line(copy, 'Packing', 'Línea 2')))
await as(db, ana, (tx) => upsert(tx, 'act_lines', line(copy2, 'Packing', '  línea   2 ')))
const nameOf = async (id) => (await db.query('select name from public.act_lines where id = $1', [id])).rows[0]?.name
eq('una línea nueva con el nombre de otra se guarda con "(2)", "(3)"…, aunque se escriba distinto; nunca se rechaza', [await nameOf(PL2), await nameOf(copy), await nameOf(copy2)], ['Línea 2', 'Línea 2 (2)', 'línea   2 (3)'])
eq('en otro cuarto el mismo nombre es otro', [await code(as(db, jose, (tx) => upsert(tx, 'act_lines', line(uuid(), 'RTE', 'Línea 2'))))], [''])
const qa = uuid(), qb = uuid()
await as(db, jose, async (tx) => { await upsert(tx, 'act_lines', line(qa, 'MFO', 'Línea 1')); await upsert(tx, 'act_lines', line(qb, 'MFO', 'Línea 3')) })
await as(db, jose, (tx) => upsert(tx, 'act_lines', line(qa, 'MFO', 'Línea 3')))
await as(db, jose, (tx) => upsert(tx, 'act_lines', line(qb, 'MFO', 'Línea 1')))
eq('dos líneas que intercambian nombres pasan (el momento con un nombre dos veces es de la app)', [await nameOf(qa), await nameOf(qb)], ['Línea 3', 'Línea 1'])
const ra = uuid(), rb = uuid()
await as(db, jose, async (tx) => { await upsert(tx, 'act_lines', line(ra, 'Spiral', 'Racks', { deleted: true })); await upsert(tx, 'act_lines', line(rb, 'Spiral', 'Racks')) })
await as(db, jose, (tx) => upsert(tx, 'act_lines', line(ra, 'Spiral', 'Racks')))
eq('una línea quitada que vuelve con un nombre ya usado vuelve con "(2)"', [await nameOf(ra), await nameOf(rb)], ['Racks (2)', 'Racks'])
eq('una línea quitada no cuenta para el nombre', [await code(as(db, jose, (tx) => upsert(tx, 'act_lines', line(uuid(), 'Spiral', 'Stuffed', { deleted: true }))))], [''])
// the copies there were before 017: the line with more codes keeps its name, the others are renamed once
await db.exec('alter table public.act_lines disable trigger act_lines_unique_name')
const keep = uuid(), extra = uuid()
await db.query("insert into public.act_lines (id, dept, name, deleted, updated_at, updated_by) values ($1, 'Kitchen', 'Braiser 4', false, now(), 'prueba'), ($2, 'Kitchen', 'braiser 4', false, now(), 'prueba')", [extra, keep])
await db.exec('alter table public.act_lines enable trigger act_lines_unique_name')
await as(db, jose, async (tx) => { await upsert(tx, 'act_runs', run(uuid(), 'Kitchen', keep, NOW - 2 * H)); await upsert(tx, 'act_runs', run(uuid(), 'Kitchen', keep, NOW - H)) })
await runFile(db, '017_line_names.sql')
eq('correr el 017 renombra las copias que ya había: la de más códigos se queda con el nombre', [await nameOf(keep), await nameOf(extra)], ['braiser 4', 'Braiser 4 (2)'])
eq('y lo que ya estaba bien no se toca', [await nameOf(PL2), await nameOf(copy), await nameOf(copy2), await nameOf(qa), await nameOf(qb)], ['Línea 2', 'Línea 2 (2)', 'línea   2 (3)', 'Línea 3', 'Línea 1'])

section('016: un código que empieza termina o quita el Set up que quedó abierto en su línea')
const PL3 = uuid(), st1 = uuid(), st2 = uuid(), PL4 = uuid()
await as(db, jose, async (tx) => { await upsert(tx, 'act_lines', line(PL3, 'Packing', 'Línea 3')); await upsert(tx, 'act_lines', line(PL4, 'Packing', 'Línea 4')) })
const t0 = Date.parse(new Date(NOW).toISOString().slice(0, 10) + 'T15:00:00Z') // 11:00 AM in the plant
await as(db, ana, (tx) => upsert(tx, 'act_stops', stop(st1, 'Packing', PL3, t0)))
await as(db, ana, (tx) => upsert(tx, 'act_runs', run(uuid(), 'Packing', PL3, t0 + 20 * 60_000)))
const stopNow = async (id) => (await db.query('select ended_at, deleted, updated_by from public.act_stops where id = $1', [id])).rows[0]
const a = await stopNow(st1)
eq('el Set up de 20 minutos termina donde empezó el código, y lo hizo el servidor', [a.ended_at?.toISOString(), a.deleted, a.updated_by], [iso(t0 + 20 * 60_000), false, 'servidor'])
await as(db, ana, (tx) => upsert(tx, 'act_stops', stop(st2, 'Packing', PL4, t0 - 7 * H)))
await as(db, ana, (tx) => upsert(tx, 'act_runs', run(uuid(), 'Packing', PL4, t0)))
eq('uno de hace más de seis horas no era un Set up: se quita', (await stopNow(st2)).deleted, true)

await db.close()
console.log(failed.length ? `\n✗ ${failed.length} de ${passed + failed.length} comprobaciones fallaron:\n\n  ${failed.join('\n\n  ')}\n` : `\n✓ ${passed} comprobaciones, todas correctas (Postgres de verdad, con las migraciones del servidor)\n`)
process.exit(failed.length ? 1 : 0)
