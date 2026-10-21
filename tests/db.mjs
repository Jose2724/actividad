// The SQL the server runs, tested on a real Postgres before it reaches Supabase (see pg.mjs): every migration applies
// on a new database and can be run again, each role reads and writes what it should, and the triggers do what their
// files say. Made-up people and rows. Run by: npm run check
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ACT_DIR, actMigrations, as, code, runFile, serverDb, person } from './pg.mjs'

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

// the Reason Codes switch (2026-10-20, Ajustes): an 'opt:' key as the line rules', no migration of its own
const codesRow = (on, who) => ({ dept: 'opt:reasoncodes', per_hour: on ? 1 : 0, per_shift: null, updated_at: iso(NOW), updated_by: who })
eq('los códigos de paro: los prenden o apagan el manager y la oficina; ni un operador ni "Solo ver"', [await code(as(db, ana, (tx) => upsert(tx, 'act_targets', codesRow(true, 'Ana'), 'dept'))), await code(as(db, mike, (tx) => upsert(tx, 'act_targets', codesRow(true, 'Mike'), 'dept'))), await code(as(db, edgar, (tx) => upsert(tx, 'act_targets', codesRow(false, 'Edgar'), 'dept'))), await code(as(db, jose, (tx) => upsert(tx, 'act_targets', codesRow(true, 'Jose'), 'dept')))], ['42501', '42501', '', ''])
eq('y lo leen todos, también un operador de otro cuarto y "Solo ver"', [await as(db, noe, async (tx) => (await tx.query("select per_hour from public.act_targets where dept = 'opt:reasoncodes'")).rows.map((r) => Number(r.per_hour))), await as(db, mike, async (tx) => (await tx.query("select per_hour from public.act_targets where dept = 'opt:reasoncodes'")).rows.length)], [[1], 1])
eq('su línea del historial la escribe el manager', await code(as(db, jose, (tx) => upsert(tx, 'act_changes', { id: uuid(), at: iso(NOW), by_name: 'Jose', dept: null, what: 'Códigos de paro', before: 'apagados', after: 'encendidos', ref_table: 'act_targets', ref_key: 'opt:reasoncodes', deleted: false, updated_at: iso(NOW), updated_by: 'Jose' }))), '')

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

// ---- 018 (the security review of 2026-10-17/18): what it closes, and that nothing the app sends today is refused ----
// a refused write stays stuck in a tablet's queue, so first every write today's app makes, by every role and power
// (src/store.ts: logChange/putChange refs, the order and day ids, every act_targets key), must still be taken
const empId = async (name) => (await db.query('select id::text from public.employees where name = $1', [name])).rows[0].id
const chg = (id, dept, ref, key, o = {}) => ({ id, at: iso(NOW), by_name: 'prueba', dept, what: 'prueba', before: '', after: '', ref_table: ref, ref_key: key, deleted: false, updated_at: iso(NOW), updated_by: 'prueba', ...o })
const device = (id, name, userId, o = {}) => ({ id, name, user_id: userId, role: 'op', dept: 'Packing', build: 'b', pending: 0, error: '', updated_at: iso(NOW), updated_by: name, ...o })
/** a production order as the app sends it (020, Jose 2026-10-19) */
const woRow = (id, dept, codeV, qty, o = {}) => ({ id, dept, code: codeV, wo: '', qty, unit: '', start_date: '2026-10-19', note: '', created_at: iso(NOW), created_by: 'prueba', closed_at: null, closed_by: null, deleted: false, updated_at: iso(NOW), updated_by: 'prueba', ...o })
/** the write as the app sends it, then the same row again changed (a coalesced history line, a cancel, a delete mark) */
const twice = async (who, table, row, key = 'id', patch = {}) => (await code(as(db, who, (tx) => upsert(tx, table, row, key)))) + '|' + (await code(as(db, who, (tx) => upsert(tx, table, { ...row, ...patch }, key))))
/** one after the other (one request at a time, as the server takes them) */
const each = async (list, f) => { const out = []; for (const x of list) out.push(await f(x)); return out }
/** a statement that is always undone afterwards (a TRUNCATE that went through must not empty the copy): its SQLSTATE, or 'tomado' */
async function undone(who, sql, params = []) {
  try { await db.transaction(async (tx) => { await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(who.claims)]); await tx.exec('set local role authenticated'); await tx.query(sql, params); throw Object.assign(new Error('deshacer'), { undo: true }) }) } catch (e) { return e?.undo ? 'tomado' : String(e?.code ?? e?.message ?? e) }
}
const gina = await person(db, { name: 'Gina', actRole: 'op', actDept: 'Packing' }) // shifts
const olga = await person(db, { name: 'Olga', actRole: 'op', actDept: 'Packing' }) // goals
const dora = await person(db, { name: 'Dora', actRole: 'op', actDept: 'RTE' }) // day, del
const oscar = await person(db, { name: 'Oscar', actRole: 'op', actDept: 'RTE' }) // orders
const pia = await person(db, { name: 'Pia', actRole: 'op', actDept: 'RTE' }) // products
const mara = await person(db, { name: 'Mara', actRole: 'mgr' }) // a manager whose powers were cut down to "fix"
const frank = await person(db, { name: 'Frank', actRole: null }) // a Freezer RTE worker, no Actividad role
for (const [name, powers] of [['Gina', '{shifts}'], ['Olga', '{goals}'], ['Dora', '{day,del}'], ['Oscar', '{orders}'], ['Pia', '{products}'], ['Mara', '{fix}']]) await db.query('update public.employees set act_powers = $1 where name = $2', [powers, name])

section('018: cada persona sigue escribiendo todo lo que la app escribe hoy (nada se rechaza)')
const today = {}
let k = 0
// an operator in her own room, no powers: the history of what she does, her lines, runs, stops, and her tablet's word
for (const ref of ['act_runs', 'act_stops', 'act_lines', 'act_shift_end', 'act_plan', 'act_targets']) today['Ana, historia de su cuarto ' + ref] = await twice(ana, 'act_changes', chg(uuid(), 'Packing', ref, 'k'), 'id', { after: 'luego', deleted: true })
today['Ana agrega y renombra una línea'] = await twice(ana, 'act_lines', line(uuid(), 'Packing', 'Línea 20'), 'id', { name: 'Línea 21' })
const anaLine = uuid()
today['Ana quita una línea y la pone de nuevo'] = await twice(ana, 'act_lines', line(anaLine, 'Packing', 'Línea 22', { deleted: true }), 'id', { deleted: false })
today['Ana empieza un código, registra y termina'] = await twice(ana, 'act_runs', run(uuid(), 'Packing', P1, NOW - 9 * H, { extra: null }), 'id', { units: [{ at: NOW - 8 * H, qty: 36, ref: '', by: 'Ana' }], ended_at: iso(NOW - 7 * H) })
today['Ana abre un paro y lo quita (lo que arregla la app sola)'] = await twice(ana, 'act_stops', stop(uuid(), 'Packing', P1, NOW - 6 * H, { reason: 'Mecánico' }), 'id', { deleted: true })
today['la tablet de Ana dice cómo está'] = await twice(ana, 'act_devices', device('d-ana', 'Ana', await empId('Ana')), 'id', { pending: 2 })
today['la tablet de "Solo ver" dice cómo está'] = await twice(mike, 'act_devices', device('d-mike', 'Mike', await empId('Mike'), { role: 'mgr', dept: '' }), 'id', { pending: 0 })
// the manager (the owner), the office, and a manager whose powers were taken down to one: everything, every room
for (const [nm, who] of [['Jose', jose], ['Edgar (oficina)', edgar], ['Mara (manager solo con fix)', mara]]) {
  k++
  const date = '2026-11-' + String(k).padStart(2, '0')
  today[nm + ': empieza el día y lo cancela'] = await twice(who, 'act_changes', chg('day:' + date, null, 'act_days', date), 'id', { deleted: true })
  today[nm + ': marca de registros borrados'] = await twice(who, 'act_changes', chg(uuid(), null, 'act_days:purge', date), 'id', { deleted: true })
  today[nm + ': marca de registros recuperados'] = await twice(who, 'act_changes', chg(uuid(), null, 'act_days:restore', 'x'), 'id', { after: 'b' })
  today[nm + ': un pedido y lo borra'] = await twice(who, 'act_changes', chg('po:o' + k, null, 'act_orders', 'o' + k), 'id', { deleted: true })
  for (const ref of ['act_orders_log', 'act_products', 'act_schedule', 'act_targets']) today[nm + ': historia sin cuarto ' + ref] = await twice(who, 'act_changes', chg(uuid(), null, ref, 'k'), 'id', { after: 'b' })
  for (const d of ['Packing', 'Kitchen']) for (const ref of ['act_runs', 'act_plan', 'act_targets']) today[nm + ': historia de ' + d + ' ' + ref + ' (y borrarla, como el borrado de un día)'] = await twice(who, 'act_changes', chg(uuid(), d, ref, 'k'), 'id', { deleted: true })
  for (const key of ['shifts:' + date, 'shiftweek:' + date, 'shiftday:' + date, 'opt:oplines', 'Packing@1', 'line:' + K1 + '@2', 'line:' + K1, 'Kitchen']) today[nm + ': act_targets ' + key.replace(date, '<fecha>')] = await twice(who, 'act_targets', target(key), 'dept', { per_hour: 2 })
  // (the program goes up by its day, room, code and lot since 021, 2026-10-20: two lots of one code are two rows)
  today[nm + ': programa de Kitchen'] = await twice(who, 'act_plan', { date, dept: 'Kitchen', code: '0889', qty: 3, lot: '', updated_at: iso(NOW), updated_by: nm }, 'date,dept,code,lot', { qty: 4 })
  today[nm + ': programa de Kitchen, el mismo código con dos lotes (021)'] = (await twice(who, 'act_plan', { date, dept: 'Kitchen', code: '0889', qty: 3, lot: '6292', updated_at: iso(NOW), updated_by: nm }, 'date,dept,code,lot', { qty: 0 })) + (await twice(who, 'act_plan', { date, dept: 'Kitchen', code: '0889', qty: 2, lot: '6290', updated_at: iso(NOW), updated_by: nm }, 'date,dept,code,lot', { qty: 5 }))
  // the production orders (020, 2026-10-19): a program that names its order and then none; an order typed and
  // closed; its history line; the closed account of a finished one
  const order = uuid()
  today[nm + ': programa de Kitchen con su pedido de producción, y luego sin él (020)'] = await twice(who, 'act_plan', { date, dept: 'Kitchen', code: '0890', qty: 3, lot: '', order_id: order, updated_at: iso(NOW), updated_by: nm }, 'date,dept,code,lot', { order_id: null })
  today[nm + ': un pedido de producción de Packing, y lo cierra (020)'] = await twice(who, 'act_work_orders', woRow(order, 'Packing', '890', 360, { unit: 'cajas' }), 'id', { closed_at: iso(NOW), closed_by: nm })
  today[nm + ': la historia del pedido de producción (020)'] = await twice(who, 'act_changes', chg(uuid(), 'Packing', 'act_work_orders', order), 'id', { after: 'b' })
  today[nm + ': la cuenta cerrada de un pedido terminado (020)'] = await twice(who, 'act_changes', chg('wodone:' + order, 'Packing', 'act_work_orders:done', order), 'id', { after: 'b' })
  today[nm + ': un producto'] = await twice(who, 'act_products', { code: 'T' + k, name: 'prueba', updated_at: iso(NOW), updated_by: nm }, 'code', { name: 'otro' })
  today[nm + ': mezclas del día'] = await twice(who, 'act_schedule', { date, code: '0889', mixes: 2, updated_at: iso(NOW), updated_by: nm }, 'date,code', { mixes: 3 })
  today[nm + ': una línea de Kitchen'] = await twice(who, 'act_lines', line(uuid(), 'Kitchen', 'Braiser ' + (10 + k)), 'id', { deleted: true })
}
// operators holding a power: what that power's screens write
today['Dora (day): empieza el día y lo cancela'] = await twice(dora, 'act_changes', chg('day:2026-12-01', null, 'act_days', '2026-12-01'), 'id', { deleted: true })
today['Dora (del): borra una corrida de su cuarto'] = await twice(dora, 'act_runs', run(uuid(), 'RTE', R1, NOW - 5 * H, { ended_at: iso(NOW - 4 * H) }), 'id', { deleted: true })
today['Oscar (orders): un pedido y lo borra'] = await twice(oscar, 'act_changes', chg('po:q1', null, 'act_orders', 'q1'), 'id', { deleted: true })
today['Oscar (orders): la historia del pedido'] = await twice(oscar, 'act_changes', chg(uuid(), null, 'act_orders_log', 'q1'), 'id', { after: 'b' })
for (const ref of ['act_products', 'act_schedule']) today['Pia (products): historia ' + ref] = await twice(pia, 'act_changes', chg(uuid(), null, ref, 'k'), 'id', { after: 'b' })
today['Pia (products): un producto'] = await twice(pia, 'act_products', { code: 'P1', name: 'prueba', updated_at: iso(NOW), updated_by: 'Pia' }, 'code', { name: 'otro' })
today['Pia (products): mezclas del día'] = await twice(pia, 'act_schedule', { date: '2026-12-02', code: '0889', mixes: 2, updated_at: iso(NOW), updated_by: 'Pia' }, 'date,code', { mixes: 3 })
today['Pia (products): el programa de su cuarto'] = await twice(pia, 'act_plan', { date: '2026-12-02', dept: 'RTE', code: '0889', qty: 3, lot: '', updated_at: iso(NOW), updated_by: 'Pia' }, 'date,dept,code,lot', { qty: 4 })
today['Pia (products): el programa de su cuarto con otro lote del mismo código (021)'] = await twice(pia, 'act_plan', { date: '2026-12-02', dept: 'RTE', code: '0889', qty: 3, lot: '6336', updated_at: iso(NOW), updated_by: 'Pia' }, 'date,dept,code,lot', { qty: 4 })
today['Pia (products): la historia del programa de su cuarto'] = await twice(pia, 'act_changes', chg(uuid(), 'RTE', 'act_plan', 'k'), 'id', { after: 'b' })
{
  // (020, 2026-10-19) an operator with "Productos y programa": the orders of her own room, and her room's programs with their order
  const order = uuid()
  today['Pia (products): un pedido de producción de su cuarto, y lo cambia (020)'] = await twice(pia, 'act_work_orders', woRow(order, 'RTE', '889', 24000, { unit: 'pouches' }), 'id', { qty: 25000 })
  today['Pia (products): su historia (020)'] = await twice(pia, 'act_changes', chg(uuid(), 'RTE', 'act_work_orders', order), 'id', { after: 'b' })
  today['Pia (products): el programa de su cuarto con su pedido (020)'] = await twice(pia, 'act_plan', { date: '2026-12-07', dept: 'RTE', code: '0889', qty: 3, lot: '', order_id: order, updated_at: iso(NOW), updated_by: 'Pia' }, 'date,dept,code,lot', { qty: 4 })
  // (2026-10-20) the attendance of her room: each person a row of the history, apart (act_attendance)
  today['Ana (op): una persona de la asistencia de su cuarto'] = await twice(ana, 'act_changes', chg('att:' + uuid(), 'Packing', 'act_attendance', 'k'), 'id', { after: 'b' })
  today['Ana (op): la cuenta cerrada de un pedido terminado de su cuarto (020)'] = await twice(ana, 'act_changes', chg('wodone:' + uuid(), 'Packing', 'act_work_orders:done', 'k'), 'id', { after: 'b' })
}
for (const key of ['shifts:2026-12-03', 'shiftweek:2026-12-03', 'shiftday:2026-12-04']) today['Gina (shifts): act_targets ' + key] = await twice(gina, 'act_targets', target(key), 'dept', { per_hour: 3 })
today['Gina (shifts): la historia del calendario'] = await twice(gina, 'act_changes', chg(uuid(), null, 'act_targets', 'shiftweek:2026-12-03'), 'id', { after: 'b' })
for (const key of ['Packing@2', 'line:' + P1 + '@1', 'line:' + P1, 'Packing']) today['Olga (goals): act_targets ' + key.replace(P1, '<línea>')] = await twice(olga, 'act_targets', target(key), 'dept', { per_hour: 4 })
today['Olga (goals): la historia de la meta de su cuarto'] = await twice(olga, 'act_changes', chg(uuid(), 'Packing', 'act_targets', 'Packing@2'), 'id', { after: 'b' })
// (the goal of another room: the app files its history without a room, see goalRoom in store.ts, 2026-10-18)
today['Olga (goals): la meta de otro cuarto y su historia, sin cuarto'] = (await twice(olga, 'act_targets', target('RTE@1'), 'dept', { per_hour: 5 })) + '|' + (await twice(olga, 'act_changes', chg(uuid(), null, 'act_targets', 'RTE@1'), 'id', { after: 'b' }))
eq(Object.keys(today).length + ' escrituras de hoy, por cada papel y poder: ninguna se rechaza', Object.entries(today).filter(([, got]) => got.replace(/\|/g, '') !== ''), [])

section('018: una fila de un cuarto no se hace pasar por una marca de la planta (el día, un borrado, un pedido)')
const mine = uuid()
await as(db, ana, (tx) => upsert(tx, 'act_changes', chg(mine, 'Packing', 'act_runs', 'r')))
const patch = (who, set) => code(as(db, who, (tx) => tx.query(`update public.act_changes set ${set} where id = $1`, [mine])))
eq('Ana no convierte una fila de su cuarto en "Día empezado", en un pedido ni en historia sin cuarto', [
  await patch(ana, "dept = null, ref_table = 'act_days', ref_key = '2026-10-19'"),
  await patch(ana, "dept = null, ref_table = 'act_orders', id = 'po:falso1'"),
  await patch(ana, "dept = null, ref_table = 'act_products'"),
  await patch(ana, "ref_table = 'act_days'"),
  await patch(olga, "dept = null, ref_table = 'act_days'"), // a power of her own (goals) is not the day's
], ['42501', '42501', '42501', '42501', '42501'])
eq('ni por la vía de guardar la fila otra vez (upsert)', await code(as(db, ana, (tx) => upsert(tx, 'act_changes', chg(mine, null, 'act_days', '2026-10-19')))), '42501')
eq('ni escribe filas de su cuarto con las marcas de la planta', await each(['act_days', 'act_days:purge', 'act_days:restore', 'act_orders', 'act_orders_log'], (ref) => code(as(db, ana, (tx) => upsert(tx, 'act_changes', chg(uuid(), 'Packing', ref, '2026-10-19'))))), ['42501', '42501', '42501', '42501', '42501'])
eq('ni con el nombre de una (day:…, po:…)', [await code(as(db, ana, (tx) => upsert(tx, 'act_changes', chg('day:2026-10-30', 'Packing', 'act_runs', 'x')))), await code(as(db, ana, (tx) => upsert(tx, 'act_changes', chg('po:falso2', 'Packing', 'act_runs', 'x'))))], ['42501', '42501'])
eq('su fila sigue como era, y en el servidor no hay ninguna marca con cuarto', [(await db.query('select dept, ref_table from public.act_changes where id = $1', [mine])).rows[0], (await db.query("select count(*)::int as n from public.act_changes where dept is not null and (ref_table in ('act_days', 'act_days:purge', 'act_days:restore', 'act_orders', 'act_orders_log') or id like 'day:%' or id like 'po:%')")).rows[0].n], [{ dept: 'Packing', ref_table: 'act_runs' }, 0])

section('018: el nombre de una marca de la planta (day:…, po:…) va solo con esa marca, también en una fila sin cuarto')
// review of 2026-10-18: with a power of her own (goals) Olga could take a day's id for a row without a room; Dora's start
// of that day ("Empezar el día") then landed on it and was refused, and that day's start never reached the other tablets
eq('Olga no pone el nombre del inicio de un día ni de un pedido a una fila suya', [
  await code(as(db, olga, (tx) => upsert(tx, 'act_changes', chg('day:2026-12-20', null, 'act_targets', 'Packing@1')))),
  await code(as(db, olga, (tx) => upsert(tx, 'act_changes', chg('po:x9', null, 'act_targets', 'Packing@1')))),
  await code(as(db, oscar, (tx) => upsert(tx, 'act_changes', chg('po:x10', null, 'act_orders_log', 'x10')))),
], ['42501', '42501', '42501'])
const olgas = uuid()
await as(db, olga, (tx) => upsert(tx, 'act_changes', chg(olgas, null, 'act_targets', 'Packing@1')))
eq('ni se lo cambia después', await code(as(db, olga, (tx) => tx.query("update public.act_changes set id = 'day:2026-12-21' where id = $1", [olgas]))), '42501')
eq('así Dora empieza esos días como siempre, y un manager también', [await code(as(db, dora, (tx) => upsert(tx, 'act_changes', chg('day:2026-12-20', null, 'act_days', '2026-12-20')))), await code(as(db, jose, (tx) => upsert(tx, 'act_changes', chg('day:2026-12-21', null, 'act_days', '2026-12-21'))))], ['', ''])
eq('en el servidor no hay ninguna fila con el nombre de una marca que no sea esa marca', (await db.query("select count(*)::int as n from public.act_changes where (id like 'day:%' and ref_table <> 'act_days') or (id like 'po:%' and ref_table <> 'act_orders')")).rows[0].n, 0)

section('018: el calendario va con el poder de los turnos; las reglas de las líneas, solo el manager y la oficina')
eq('quien tiene "turnos" guarda la semana y los días aparte (antes se rechazaban y se perdían)', await each(['shifts:2026-12-10', 'shiftweek:2026-12-10', 'shiftday:2026-12-11'], (key) => code(as(db, gina, (tx) => upsert(tx, 'act_targets', target(key), 'dept')))), ['', '', ''])
eq('quien tiene solo "metas" no toca el calendario ni las reglas de las líneas', await each(['shifts:2026-12-12', 'shiftweek:2026-12-12', 'shiftday:2026-12-13', 'opt:oplines'], (key) => code(as(db, olga, (tx) => upsert(tx, 'act_targets', target(key), 'dept')))), ['42501', '42501', '42501', '42501'])
eq('ni los códigos de paro, ni quien tiene "turnos"', [await code(as(db, olga, (tx) => upsert(tx, 'act_targets', target('opt:reasoncodes'), 'dept'))), await code(as(db, gina, (tx) => upsert(tx, 'act_targets', target('opt:reasoncodes'), 'dept')))], ['42501', '42501'])
eq('y sí sus metas; quien tiene solo "turnos" no pone metas', [await code(as(db, olga, (tx) => upsert(tx, 'act_targets', target('Packing@1'), 'dept'))), await code(as(db, olga, (tx) => upsert(tx, 'act_targets', target('line:' + P1 + '@2'), 'dept'))), await code(as(db, gina, (tx) => upsert(tx, 'act_targets', target('Packing@1'), 'dept')))], ['', '', '42501'])

section('018: la historia sin cuarto (pedidos, días, productos) la lee solo quien tiene un papel en Actividad')
await as(db, jose, (tx) => upsert(tx, 'act_changes', chg('po:cliente', null, 'act_orders', 'cliente', { after: '{"customer":"Cliente","po":"123"}' })))
const sees = (who) => as(db, who, async (tx) => (await tx.query("select count(*)::int as n from public.act_changes where id = 'po:cliente'")).rows[0].n)
eq('una cuenta de Freezer RTE sin papel en Actividad no la lee', await sees(frank), 0)
eq('el operador, "Solo ver", la oficina y el manager sí', [await sees(ana), await sees(mike), await sees(edgar), await sees(jose)], [1, 1, 1, 1])
eq('y cada operador sigue leyendo la historia de su cuarto y no la de otro', await as(db, ana, async (tx) => { const r = (await tx.query("select count(*) filter (where dept = 'Packing')::int as mine, count(*) filter (where dept is not null and dept <> 'Packing')::int as other from public.act_changes")).rows[0]; return [r.mine > 0, r.other] }), [true, 0])

section('018: nadie borra ni vacía una tabla de Actividad desde la app')
// every act_ table there is (a new one must be added to 018's list, or this says so), as Supabase leaves new tables:
// ALL to anon and authenticated (pg.mjs gives the copy the same default)
const actTables = "from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'act\\_%'"
const tableCount = (await db.query('select count(*)::int as n ' + actTables)).rows[0].n
const canErase = (await db.query(`select c.relname ${actTables} and exists (select 1 from unnest(array['anon', 'authenticated']::name[]) g, unnest(array['DELETE', 'TRUNCATE']) p where has_table_privilege(g, c.oid, p)) order by 1`)).rows.map((r) => r.relname)
eq('ninguna de las ' + tableCount + ' tablas act_ deja DELETE ni TRUNCATE a anon ni a authenticated', canErase, [])
eq('(Supabase las da a toda tabla nueva: la copia del servidor también)', (await db.query("select has_table_privilege('authenticated', 'public.act_runs', 'REFERENCES') as r")).rows[0].r, true)
eq('un operador que lo intenta: rechazado (antes TRUNCATE las vaciaba aun con las reglas por fila)', [await undone(ana, 'truncate public.act_runs'), await undone(ana, 'delete from public.act_runs')], ['42501', '42501'])
eq('lo demás sigue: escribir en Actividad, y borrar empleados en Freezer RTE', (await db.query("select has_table_privilege('authenticated', 'public.act_runs', 'INSERT') as i, has_table_privilege('authenticated', 'public.act_runs', 'UPDATE') as u, has_table_privilege('authenticated', 'public.employees', 'DELETE') as e")).rows[0], { i: true, u: true, e: true })

section('018: cada aparato dice quién está en él según el servidor, no según lo que manda')
const hello = (who, row) => code(as(db, who, (tx) => upsert(tx, 'act_devices', row)))
const deviceNow = async (id) => (await db.query('select name, user_id, updated_by, pending from public.act_devices where id = $1', [id])).rows[0]
eq('el manager dice su palabra como siempre', [await hello(jose, device('d-1', 'Jose', await empId('Jose'), { pending: 3 })), await deviceNow('d-1')], ['', { name: 'Jose', user_id: await empId('Jose'), updated_by: 'Jose', pending: 3 }])
eq('Noelia escribe sobre ese aparato diciendo ser Ana: queda su nombre y su id', [await hello(noe, device('d-1', 'Ana', await empId('Ana'))), await deviceNow('d-1')], ['', { name: 'Noelia', user_id: await empId('Noelia'), updated_by: 'Noelia', pending: 0 }])
eq('Ana entra en esa misma tablet: el aparato pasa a ser de Ana', [await hello(ana, device('d-1', 'Ana', await empId('Ana'))), (await deviceNow('d-1')).name], ['', 'Ana'])
eq('una tablet que recordaba a la persona sin su id: el servidor lo pone', [await hello(ana, device('d-2', 'Ana', '')), (await deviceNow('d-2')).user_id], ['', await empId('Ana')])
await db.query("update public.act_devices set name = 'a mano' where id = 'd-2'")
eq('desde el SQL Editor queda lo que se escribe', (await deviceNow('d-2')).name, 'a mano')

section('018: el servidor anota quién mandó cada versión (act_runs_log.uid)')
// (the uid read through to_jsonb: without 018's column the check says so instead of stopping the whole file)
const lastLog = async (id) => (await db.query("select table_name, by_name, to_jsonb(l) ->> 'uid' as uid from public.act_runs_log l where row_id = $1 order by n desc limit 1", [id])).rows[0]
const RL = uuid(), LL = uuid()
await as(db, jose, (tx) => upsert(tx, 'act_runs', run(RL, 'Packing', P1, NOW - 12 * H, { ended_at: iso(NOW - 11 * H), updated_by: 'Jose' })))
await as(db, ana, (tx) => upsert(tx, 'act_runs', run(RL, 'Packing', P1, NOW - 12 * H, { ended_at: iso(NOW - 11 * H), waste: 3, updated_by: 'Jose' })))
eq('Ana cambia una corrida firmando como Jose: el registro dice "Jose" y la cuenta de Ana', await lastLog(RL), { table_name: 'act_runs', by_name: 'Jose', uid: ana.id })
await db.query('update public.act_runs set waste = 4 where id = $1', [RL])
eq('un cambio desde el SQL Editor: sin cuenta, sin error', (await lastLog(RL)).uid, null)
await runFile(db, '011_runs_history.sql')
await as(db, ana, (tx) => upsert(tx, 'act_runs', run(RL, 'Packing', P1, NOW - 12 * H, { ended_at: iso(NOW - 11 * H), waste: 5, updated_by: 'Ana' })))
eq('correr el 011 otra vez no lo quita', (await lastLog(RL)).uid, ana.id)
await as(db, jose, (tx) => upsert(tx, 'act_lines', line(LL, 'Packing', 'Línea 40')))
await as(db, ana, (tx) => upsert(tx, 'act_lines', line(LL, 'Packing', 'Línea 41', { updated_by: 'Jose' })))
eq('las líneas también: un cambio de nombre queda con la versión de antes y la cuenta de quien lo mandó', [await lastLog(LL), (await db.query("select was ->> 'name' as name from public.act_runs_log where row_id = $1 order by n desc limit 1", [LL])).rows[0]?.name], [{ table_name: 'act_lines', by_name: 'Jose', uid: ana.id }, 'Línea 40'])
const SU = uuid()
await as(db, ana, (tx) => upsert(tx, 'act_stops', stop(SU, 'Packing', LL, NOW - 30 * 60_000)))
await as(db, ana, (tx) => upsert(tx, 'act_runs', run(uuid(), 'Packing', LL, NOW - 10 * 60_000)))
eq('el Set up que cierra el servidor (016) queda como "servidor", pedido por la cuenta de Ana', await lastLog(SU), { table_name: 'act_stops', by_name: 'servidor', uid: ana.id })

section('018: una unidad que el servidor tenía no se pierde por una copia vieja de otra tablet')
const UL = uuid(), UR = uuid(), A = NOW - 50 * 60_000, B = NOW - 40 * 60_000, C = NOW - 30 * 60_000
const unit = (at, qty = 36) => ({ at, qty, ref: '', by: 'prueba' })
const packRun = (o) => run(UR, 'Packing', UL, NOW - H, { extra: null, ...o })
const letters = async (id = UR) => (await db.query('select units from public.act_runs where id = $1', [id])).rows[0].units.map((x) => (x.at === A ? 'A' : x.at === B ? 'B' : x.at === C ? 'C' : String(x.at)) + (x.qty !== 36 ? ':' + x.qty : ''))
await as(db, jose, (tx) => upsert(tx, 'act_lines', line(UL, 'Packing', 'Línea 50')))
await as(db, jose, (tx) => upsert(tx, 'act_runs', packRun({ units: [unit(A)] })))
await as(db, jose, (tx) => upsert(tx, 'act_runs', packRun({ units: [unit(A), unit(B)] })))
await as(db, ana, (tx) => upsert(tx, 'act_runs', packRun({ units: [unit(A), unit(C)] }))) // a tablet that had not seen B
eq('una copia vieja [A, C] sobre [A, B]: el servidor se queda con las tres, en orden', await letters(), ['A', 'B', 'C'])
await as(db, jose, (tx) => upsert(tx, 'act_runs', packRun({ units: [unit(A), unit(C)], extra: { removed: [B] } })))
eq('Corregir quita B con su marca: B se queda fuera', await letters(), ['A', 'C'])
await as(db, ana, (tx) => upsert(tx, 'act_runs', packRun({ units: [unit(A, 40), unit(C)], extra: { removed: [B] } })))
eq('una corrección de A (el mismo momento): se toma', await letters(), ['A:40', 'C'])
await as(db, ana, (tx) => upsert(tx, 'act_runs', packRun({ units: [unit(A, 40)], extra: { removed: [B, C], lotNow: '6291', open: { parts: [{ lot: '6290', qty: 36, tag: '', at: C, by: 'prueba' }], po: '' } } })))
eq('"se volvió a abrir" el último pallet (fuera, con su marca): se toma', await letters(), ['A:40'])
await as(db, ana, (tx) => upsert(tx, 'act_runs', packRun({ units: [], extra: null })))
eq('unas unidades vacías sin marca no borran lo que había', await letters(), ['A:40'])
// (by Jose: since 2026-10-18 a run is deleted only by someone holding "Borrar corridas y paros", see 018 part 9)
await as(db, jose, (tx) => upsert(tx, 'act_runs', packRun({ units: [unit(A, 40)], deleted: true, extra: { removed: [B, C] } })))
eq('borrar la corrida deja sus unidades como estaban', [await letters(), (await db.query('select deleted from public.act_runs where id = $1', [UR])).rows[0].deleted], [['A:40'], true])
await db.query(`update public.act_runs set units = '[{"at":"x","qty":1},{"qty":2}]'::jsonb, deleted = false where id = $1`, [UR])
eq('unidades sin un momento de número: ni error ni nada que agregar', [await code(as(db, ana, (tx) => upsert(tx, 'act_runs', packRun({ units: [unit(A)] })))), await letters()], ['', ['A']])
const UN = uuid()
eq('una corrida nueva se guarda como llega', [await code(as(db, ana, (tx) => upsert(tx, 'act_runs', run(UN, 'Packing', UL, NOW - 3 * H, { units: [unit(C), unit(A)], ended_at: iso(NOW - 2 * H) })))), await letters(UN)], ['', ['C', 'A']])

section('018: lo abierto de una línea se busca por índice (el 016 en cada toque)')
eq('los dos índices están', (await db.query("select indexname from pg_indexes where schemaname = 'public' and indexname in ('act_stops_open_line', 'act_runs_open_line') order by 1")).rows.map((r) => r.indexname), ['act_runs_open_line', 'act_stops_open_line'])
const plan = await db.transaction(async (tx) => {
  await tx.exec('set local enable_seqscan = off')
  const of = async (q) => (await tx.query('explain ' + q)).rows.map((r) => r['QUERY PLAN']).join(' ')
  return [
    /act_stops_open_line/.test(await of(`update public.act_stops s set ended_at = now() where s.line_id = '${UL}' and s.dept = 'Packing' and s.reason = 'Set up' and s.ended_at is null and coalesce(s.deleted, false) = false and s.started_at <= now()`)),
    /act_runs_open_line/.test(await of(`select r.started_at from public.act_runs r where r.line_id = '${UL}' and r.dept = 'Packing' and r.ended_at is null and coalesce(r.deleted, false) = false and r.started_at >= now() order by r.started_at limit 1`)),
  ]
})
eq('las dos preguntas del 016 pueden ir por ellos', plan, [true, true])

// ---- 018 parts 9 and 10 (Jose's decision of 2026-10-18): deleting a run and taking a line off, by the server too ----
section('018 (Jose, 2026-10-18): una corrida la borra solo quien tiene "Borrar corridas y paros"; de otro, el servidor la deja como estaba')
// a Freezer RTE admin (the owner's kind of account) with an operator's role and another power saved: holds them all
const alba = await person(db, { name: 'Alba', actRole: 'op', actDept: 'Packing', role: 'admin' })
await db.query("update public.employees set act_powers = '{goals}' where name = 'Alba'")
const DL = uuid(), DR = uuid()
await as(db, null, async (tx) => { await upsert(tx, 'act_lines', line(DL, 'Packing', 'Línea 70')); await upsert(tx, 'act_lines', line(DR, 'RTE', 'Línea 70')) })
const delOf = async (id, table = 'act_runs') => (await db.query(`select deleted from public.${table} where id = $1`, [id])).rows[0].deleted
const finished = (dept, lineId, o = {}) => run(uuid(), dept, lineId, NOW - 20 * H, { ended_at: iso(NOW - 19 * H), units: [unit(NOW - 19.5 * H)], extra: null, ...o })
/** a run on the server, then `who` deletes it as the app does (the whole row again, marked) or by hand (only the mark): [what the server answered, deleted there] */
async function deleting(who, dept, lineId, byHand = false) {
  const r = finished(dept, lineId)
  await as(db, null, (tx) => upsert(tx, 'act_runs', r))
  const answer = await code(as(db, who, (tx) => (byHand ? tx.query('update public.act_runs set deleted = true where id = $1', [r.id]) : upsert(tx, 'act_runs', { ...r, deleted: true, updated_at: iso(NOW - H), updated_by: who?.name ?? 'SQL Editor' }))))
  return [answer, await delOf(r.id)]
}
eq('Ana (operadora, sin ese poder) la borra como la app: el servidor no dice que no, y la corrida se queda', await deleting(ana, 'Packing', DL), ['', false])
eq('ni a mano, con una petición de solo "deleted"', await deleting(ana, 'Packing', DL, true), ['', false])
eq('un manager a quien se le quitó ese poder (Mara, solo "Corregir"): se queda', await deleting(mara, 'Packing', DL), ['', false])
eq('la borran quien tiene el poder (Dora), la oficina, Jose, un administrador de Freezer RTE con otro poder guardado (Alba) y el SQL Editor',
  await each([[dora, 'RTE', DR], [edgar, 'Packing', DL], [jose, 'Packing', DL], [alba, 'Packing', DL], [null, 'Packing', DL]], ([who, d, l]) => deleting(who, d, l)),
  [['', true], ['', true], ['', true], ['', true], ['', true]])
const KR = uuid(), kept0 = run(KR, 'Packing', DL, NOW - 18 * H, { extra: null, units: [unit(NOW - 17.5 * H)] }), T = NOW - 17 * H
await as(db, null, (tx) => upsert(tx, 'act_runs', kept0))
await as(db, ana, (tx) => upsert(tx, 'act_runs', { ...kept0, deleted: true, ended_at: iso(T), waste: 7, units: [unit(NOW - 17.5 * H), unit(NOW - 17.2 * H)], updated_at: iso(T), updated_by: 'Jose' }))
const kr = (await db.query('select deleted, ended_at, waste::int as waste, jsonb_array_length(units) as units, updated_at from public.act_runs where id = $1', [KR])).rows[0]
// (updated_at as the tablet sent it: that is how the tablet takes the server's answer and shows the run again)
eq('lo demás de esa misma escritura se toma tal cual (el fin, el waste, un pallet más, la hora de la tablet): solo "borrada" no', [kr.deleted, kr.ended_at.toISOString(), kr.waste, kr.units, kr.updated_at.toISOString()], [false, iso(T), 7, 2, iso(T)])
eq('y esa versión queda en act_runs_log con la cuenta de Ana (y el nombre que mandó)', await lastLog(KR), { table_name: 'act_runs', by_name: 'Jose', uid: ana.id })
/** a run Jose deleted, that `who` puts back (Recuperarlos, a delete undone), then a tablet that still had it deleted sends its copy: deleted after each step */
async function restoring(who) {
  const r = finished('Packing', DL)
  await as(db, null, (tx) => upsert(tx, 'act_runs', r))
  await as(db, jose, (tx) => upsert(tx, 'act_runs', { ...r, deleted: true, updated_at: iso(NOW - 3 * H) }))
  const out = [await delOf(r.id), await code(as(db, who, (tx) => upsert(tx, 'act_runs', { ...r, deleted: false, updated_at: iso(NOW - 2 * H) })))]
  await as(db, ana, (tx) => upsert(tx, 'act_runs', { ...r, deleted: true, updated_at: iso(NOW - 3 * H) }))
  return [...out, await delOf(r.id)]
}
eq('volver a ponerla lo hace cualquiera que escribe en el cuarto (Ana, Mara), y una copia vieja que aún la tenía borrada no la borra otra vez', [await restoring(ana), await restoring(mara)], [[true, '', false], [true, '', false]])
const LR = uuid()
let lr = run(LR, 'Packing', DL, NOW - 16 * H, { extra: null, per_unit: 36 })
const day = [await code(as(db, ana, (tx) => upsert(tx, 'act_runs', lr)))]
for (const step of [{ units: [unit(NOW - 15.8 * H)] }, { units: [unit(NOW - 15.8 * H), unit(NOW - 15.6 * H, 30)], waste: 2 }, { code: '0890', lot: '6291' }, { ended_at: iso(NOW - 15 * H) }]) {
  lr = { ...lr, ...step, updated_at: iso(Date.parse(lr.updated_at) + 60_000) }
  day.push(await code(as(db, ana, (tx) => upsert(tx, 'act_runs', lr))))
}
const lrNow = (await db.query("select code, lot, waste::int as waste, units -> 1 ->> 'qty' as second, ended_at is not null as ended, deleted from public.act_runs where id = $1", [LR])).rows[0]
eq('lo de cada día de Ana no cambia: empezar, registrar, waste, corregir código y lote, terminar', [day, lrNow], [['', '', '', '', ''], { code: '0890', lot: '6291', waste: 2, second: '30', ended: true, deleted: false }])
const made = finished('Packing', DL, { deleted: true })
eq('una corrida que llega ya borrada (hecha y borrada en una tablet antes de subir) se guarda como llega: en el servidor no había nada que dejar', [await code(as(db, ana, (tx) => upsert(tx, 'act_runs', made))), await delOf(made.id)], ['', true])
const DS = uuid(), SX = uuid()
await as(db, null, (tx) => upsert(tx, 'act_lines', line(DS, 'Packing', 'Línea 71')))
await as(db, ana, (tx) => upsert(tx, 'act_stops', stop(SX, 'Packing', DS, NOW - 2 * H)))
eq('los paros no: Ana quita un Set up que quedó abierto ("No viene otro código: quitarlo", lo que la app hace sola)', [await code(as(db, ana, (tx) => upsert(tx, 'act_stops', stop(SX, 'Packing', DS, NOW - 2 * H, { deleted: true })))), await delOf(SX, 'act_stops')], ['', true])

section('018 (2026-10-18): esa guarda, el Set up del 016 y las unidades que no se pierden, juntos')
const t1 = t0 + 60 * 60_000, tS = t0 + 30 * 60_000 // (t0: 11:00 AM in the plant, the 016 section)
const GA = uuid(), GB = uuid(), GU = uuid(), RA = uuid(), RB = uuid(), RU = uuid(), SA = uuid(), SB = uuid()
await as(db, null, async (tx) => { await upsert(tx, 'act_lines', line(GA, 'Packing', 'Línea 72')); await upsert(tx, 'act_lines', line(GB, 'RTE', 'Línea 72')); await upsert(tx, 'act_lines', line(GU, 'Packing', 'Línea 73')) })
await as(db, jose, (tx) => upsert(tx, 'act_runs', run(RA, 'Packing', GA, t1, { extra: null })))
await as(db, ana, (tx) => upsert(tx, 'act_runs', run(RA, 'Packing', GA, t1, { extra: null, deleted: true })))
await as(db, ana, (tx) => upsert(tx, 'act_stops', stop(SA, 'Packing', GA, tS)))
const sa = await stopNow(SA)
eq('la corrida que el servidor dejó sigue corriendo para el 016: un Set up de antes en su línea termina donde ella empezó', [await delOf(RA), sa.ended_at?.toISOString(), sa.updated_by], [false, iso(t1), 'servidor'])
await as(db, null, (tx) => upsert(tx, 'act_runs', run(RB, 'RTE', GB, t1, { extra: null })))
await as(db, dora, (tx) => upsert(tx, 'act_runs', run(RB, 'RTE', GB, t1, { extra: null, deleted: true })))
await as(db, dora, (tx) => upsert(tx, 'act_stops', stop(SB, 'RTE', GB, tS)))
eq('borrada por quien puede (Dora) ya no corre: un Set up de antes queda abierto', [await delOf(RB), (await stopNow(SB)).ended_at], [true, null])
await as(db, oscar, (tx) => upsert(tx, 'act_runs', run(RB, 'RTE', GB, t1, { extra: null })))
const sb = await stopNow(SB)
eq('puesta de nuevo por alguien sin ese poder (Oscar) corre otra vez, y el 016 cierra ese Set up donde ella empezó', [await delOf(RB), sb.ended_at?.toISOString(), sb.updated_by], [false, iso(t1), 'servidor'])
await as(db, jose, (tx) => upsert(tx, 'act_runs', run(RU, 'Packing', GU, NOW - H, { extra: null, units: [unit(A), unit(B)] })))
await as(db, ana, (tx) => upsert(tx, 'act_runs', run(RU, 'Packing', GU, NOW - H, { extra: null, units: [unit(A), unit(C)], deleted: true })))
eq('una copia vieja de Ana, [A, C] y marcada borrada, sobre [A, B]: la corrida se queda, con las tres unidades en orden', [await delOf(RU), await letters(RU)], [false, ['A', 'B', 'C']])

section('018 (Jose, 2026-10-18): una línea la quitan el manager, la oficina, quien tiene "Corregir", o el operador si la regla lo deja')
const fede = await person(db, { name: 'Fede', actRole: 'op', actDept: 'Packing' }) // holds "Corregir registros"
const memo = await person(db, { name: 'Memo', actRole: 'mgr' }) // a manager whose powers were cut down to goals
await db.query("update public.employees set act_powers = '{fix}' where name = 'Fede'")
await db.query("update public.employees set act_powers = '{goals}' where name = 'Memo'")
/** the managers' rule "quitar líneas libres" (Ajustes: act_targets opt:oplines, remove in per_shift) */
const rule = (remove) => as(db, jose, (tx) => upsert(tx, 'act_targets', { dept: 'opt:oplines', per_hour: 1, per_shift: remove ? 1 : 0, updated_at: iso(NOW), updated_by: 'Jose' }, 'dept'))
await rule(false)
let ln = 90
/** a line of Packing on the server, then `who` takes it off as the app does (the row again, marked): [answer, deleted there, its id] */
async function takingOff(who) {
  const l = line(uuid(), 'Packing', 'Línea ' + ++ln)
  await as(db, null, (tx) => upsert(tx, 'act_lines', l))
  const answer = await code(as(db, who, (tx) => upsert(tx, 'act_lines', { ...l, deleted: true, updated_at: iso(NOW - H), updated_by: who?.name ?? 'SQL Editor' })))
  return [answer, await delOf(l.id, 'act_lines'), l.id]
}
const keptLine = await takingOff(ana)
eq('Ana (operadora sin "Corregir", regla apagada) la quita: el servidor no dice que no, y la línea se queda', keptLine.slice(0, 2), ['', false])
eq('y esa versión queda con su cuenta', await lastLog(keptLine[2]), { table_name: 'act_lines', by_name: 'Ana', uid: ana.id })
eq('la quitan quien tiene "Corregir" (Fede), un manager sin ese poder (Memo), la oficina y el SQL Editor', (await each([fede, memo, edgar, null], (who) => takingOff(who))).map((x) => x.slice(0, 2)), [['', true], ['', true], ['', true], ['', true]])
await rule(true)
eq('con la regla "quitar líneas libres" encendida, Ana la quita', (await takingOff(ana)).slice(0, 2), ['', true])
await rule(false)
eq('apagada otra vez, ya no', (await takingOff(ana)).slice(0, 2), ['', false])
const RN = uuid()
await as(db, null, (tx) => upsert(tx, 'act_lines', line(RN, 'Packing', 'Línea 120')))
eq('cambiarle el nombre sigue siendo de todo operador', [await code(as(db, ana, (tx) => upsert(tx, 'act_lines', line(RN, 'Packing', 'Línea 121')))), await nameOf(RN)], ['', 'Línea 121'])
await as(db, ana, (tx) => upsert(tx, 'act_lines', line(RN, 'Packing', 'Línea 122', { deleted: true })))
eq('quitarla y renombrarla a la vez: el nombre se toma, la línea se queda', [await nameOf(RN), await delOf(RN, 'act_lines')], ['Línea 122', false])
const PB = uuid(), PB2 = uuid()
await as(db, null, (tx) => upsert(tx, 'act_lines', line(PB, 'Packing', 'Línea 130')))
await as(db, edgar, (tx) => upsert(tx, 'act_lines', line(PB, 'Packing', 'Línea 130', { deleted: true })))
await as(db, jose, (tx) => upsert(tx, 'act_lines', line(PB2, 'Packing', 'Línea 130'))) // meanwhile a new line with its name
eq('ponerla de nuevo (Ana, sin poder) se toma, y el 017 le pone "(2)": su nombre ya lo tiene otra', [await code(as(db, ana, (tx) => upsert(tx, 'act_lines', line(PB, 'Packing', 'Línea 130')))), await delOf(PB, 'act_lines'), await nameOf(PB), await nameOf(PB2)], ['', false, 'Línea 130 (2)', 'Línea 130'])
const keptName = await nameOf(keptLine[2]), twin = uuid()
await as(db, jose, (tx) => upsert(tx, 'act_lines', line(twin, 'Packing', keptName)))
eq('la línea que el servidor dejó sigue contando para el 017: otra nueva con su nombre se guarda con "(2)"', await nameOf(twin), keptName + ' (2)')
eq('y correr el 017 otra vez con esta guarda puesta: sin error, cada una con su nombre', [await code(runFile(db, '017_line_names.sql')), await nameOf(keptLine[2]), await nameOf(twin)], ['', keptName, keptName + ' (2)'])

section('018 corrido dos veces más: cada guarda está una sola vez y hace lo mismo')
const again018 = [await code(runFile(db, '018_security.sql')), await code(runFile(db, '018_security.sql'))]
eq('sin error, una vez cada una', [again018, (await db.query("select tgname from pg_trigger where tgname in ('act_runs_keep', 'act_lines_keep') order by 1")).rows.map((r) => r.tgname)], [['', ''], ['act_lines_keep', 'act_runs_keep']])
eq('y siguen: Ana no borra una corrida ni quita una línea; Dora borra, la oficina quita', [await deleting(ana, 'Packing', DL), (await takingOff(ana)).slice(0, 2), await deleting(dora, 'RTE', DR), (await takingOff(edgar)).slice(0, 2)], [['', false], ['', false], ['', true], ['', true]])

section('018: el archivo toma las tablas en el orden de una escritura de tablet (act_runs, act_stops, act_lines antes que act_runs_log)')
// Pasted whole, the file is one transaction: each table it locks stays locked to its end. A tablet's write takes its
// row's table, then act_runs_log (the history triggers). A trigger made on act_runs after act_runs_log is locked would
// wait for a tablet that waits for the file, and Postgres would cancel one of the two: why 9 and 10 sit before 3
const text018 = readFileSync(resolve(ACT_DIR, '018_security.sql'), 'utf8').replace(/--[^\n]*/g, '')
const firstLog = text018.search(/\btable\s+public\.act_runs_log\b/i)
const before018 = (what) => text018.indexOf(what) >= 0 && text018.indexOf(what) < firstLog
const floorLocks = [...text018.matchAll(/\bon\s+public\.act_(runs|stops|lines)\b/gi)].map((x) => x.index)
eq('todo lo que toma act_runs, act_stops o act_lines (las guardas 9 y 10 también) va antes que act_runs_log', [firstLog > 0, floorLocks.length >= 6, floorLocks.filter((i) => i > firstLog).length, before018('create trigger act_runs_keep '), before018('create trigger act_lines_keep ')], [true, true, 0, true, true])

// ---- 019 (Jose, 2026-10-19): a room's program may name its lot, optional ----
section('019: el programa de un cuarto lleva su lote, opcional (Jose, 2026-10-19)')
{
  const lotOf = async (date, dept, code) => (await db.query('select lot from public.act_plan where date = $1 and dept = $2 and code = $3', [date, dept, code])).rows[0]?.lot ?? null
  const planRow = (date, dept, code, qty, more = {}) => ({ date, dept, code, qty, updated_at: iso(NOW), updated_by: 'prueba', ...more })
  const colLot = async () => (await db.query("select column_default, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'act_plan' and column_name = 'lot'")).rows.map((r) => [r.column_default, r.is_nullable])
  eq('el 019 corre dos veces más sin error y deja la columna como la pone: texto, nunca nula, vacía por omisión', [await code(runFile(db, '019_plan_lot.sql')), await code(runFile(db, '019_plan_lot.sql')), await colLot()], ['', '', [["''::text", 'NO']]])
  eq('el manager sube un programa con su lote, como lo manda la app, y el servidor lo guarda', [await code(as(db, jose, (tx) => upsert(tx, 'act_plan', planRow('2026-12-05', 'Spiral', '889', 3, { lot: '6339' }), 'date,dept,code,lot'))), await lotOf('2026-12-05', 'Spiral', '889')], ['', '6339'])
  eq('la oficina también, con el lote en blanco (programa del día); un operador sin el poder, no', [await code(as(db, edgar, (tx) => upsert(tx, 'act_plan', planRow('2026-12-05', 'RTE', '889', 1000, { lot: '' }), 'date,dept,code,lot'))), await lotOf('2026-12-05', 'RTE', '889'), await code(as(db, ana, (tx) => upsert(tx, 'act_plan', planRow('2026-12-05', 'Packing', '889', 10, { lot: '6339' }), 'date,dept,code,lot')))], ['', '', '42501'])
  eq('una fila escrita sin la columna (una versión de antes del lote) se lee con el lote vacío', [await code(as(db, jose, (tx) => upsert(tx, 'act_plan', planRow('2026-12-06', 'Kitchen', '889', 4), 'date,dept,code,lot'))), await lotOf('2026-12-06', 'Kitchen', '889')], ['', ''])
  // (until 021 another lot of the same code was another version of that row; since 021, 2026-10-20, it is another row)
  eq('otro lote del mismo código es otra fila (021); el mismo lote, otra versión de la misma', [await code(as(db, jose, (tx) => upsert(tx, 'act_plan', planRow('2026-12-05', 'Spiral', '889', 3, { lot: '6340' }), 'date,dept,code,lot'))), await code(as(db, jose, (tx) => upsert(tx, 'act_plan', planRow('2026-12-05', 'Spiral', '889', 4, { lot: '6340' }), 'date,dept,code,lot'))), (await db.query("select lot, qty::int from public.act_plan where date = '2026-12-05' and dept = 'Spiral' order by lot")).rows], ['', '', [{ lot: '6339', qty: 3 }, { lot: '6340', qty: 4 }]])
}

// ---- 020 (Jose, 2026-10-19): the production orders of each room, and the order of each day's program ----
section('020: los pedidos de producción de cada cuarto y el pedido del programa de cada día (Jose, 2026-10-19)')
{
  // before it is run: what a tablet of this version meets (a server with every file up to 019)
  {
    const { db: old, applied: before020 } = await serverDb({ upTo: '020' })
    const j = await person(old, { name: 'Jose', actRole: 'mgr', role: 'admin' })
    eq('una base con todo hasta el 019', before020.at(-1), '019_plan_lot.sql')
    eq('antes del 020 la tabla de pedidos no está (42P01; PostgREST dice PGRST205 y la app la espera callada)', await code(as(old, j, (tx) => tx.query('select * from public.act_work_orders'))), '42P01')
    eq('un programa con order_id se rechaza entero (42703; PostgREST dice PGRST204)', await code(as(old, j, (tx) => upsert(tx, 'act_plan', { date: '2026-10-19', dept: 'Kitchen', code: '889', qty: 80, lot: '', order_id: uuid(), updated_at: iso(NOW), updated_by: 'Jose' }, 'date,dept,code'))), '42703')
    eq('el mismo programa sin la columna, como la app lo vuelve a mandar cuando no tiene pedido: entra', await code(as(old, j, (tx) => upsert(tx, 'act_plan', { date: '2026-10-19', dept: 'Kitchen', code: '889', qty: 80, lot: '', updated_at: iso(NOW), updated_by: 'Jose' }, 'date,dept,code'))), '')
    await old.close()
  }
  const run020 = () => runFile(db, '020_work_orders.sql')
  eq('el 020 corre dos veces más sin error ("Safe to run again")', [await code(run020()), await code(run020())], ['', ''])
  const cols = (await db.query("select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'act_work_orders' order by ordinal_position")).rows.map((r) => [r.column_name, r.data_type, r.is_nullable])
  eq('las columnas de act_work_orders (con el lote del 022)', cols, [['id', 'uuid', 'NO'], ['dept', 'text', 'NO'], ['code', 'text', 'NO'], ['wo', 'text', 'NO'], ['qty', 'numeric', 'NO'], ['unit', 'text', 'NO'], ['start_date', 'date', 'NO'], ['note', 'text', 'NO'], ['created_at', 'timestamp with time zone', 'NO'], ['created_by', 'text', 'NO'], ['closed_at', 'timestamp with time zone', 'YES'], ['closed_by', 'text', 'YES'], ['deleted', 'boolean', 'NO'], ['updated_at', 'timestamp with time zone', 'NO'], ['updated_by', 'text', 'YES'], ['synced_at', 'timestamp with time zone', 'NO'], ['lot', 'text', 'NO']])
  eq('act_plan.order_id: uuid, vacía por omisión, y act_plan sin ninguna llave foránea (un programa puede llegar antes que su pedido)', [(await db.query("select data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'act_plan' and column_name = 'order_id'")).rows[0], (await db.query("select count(*)::int as n from pg_constraint where conrelid in ('public.act_plan'::regclass, 'public.act_work_orders'::regclass) and contype in ('f', 'u')")).rows[0].n], [{ data_type: 'uuid', is_nullable: 'YES', column_default: null }, 0])
  eq('cada trigger una vez, la tabla en la publicación de realtime, sus índices', [(await db.query("select tgname from pg_trigger where tgrelid = 'public.act_work_orders'::regclass and not tgisinternal order by 1")).rows.map((r) => r.tgname), (await db.query("select count(*)::int as n from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'act_work_orders'")).rows[0].n, (await db.query("select indexname from pg_indexes where schemaname = 'public' and indexname in ('act_work_orders_synced', 'act_plan_order') order by 1")).rows.map((r) => r.indexname)], [['act_work_orders_history', 'act_work_orders_touch'], 1, ['act_plan_order', 'act_work_orders_synced']])
  eq('sin índice único: dos pedidos del mismo cuarto y código nunca se rechazan', (await db.query("select count(*)::int as n from pg_index where indrelid = 'public.act_work_orders'::regclass and indisunique and not indisprimary")).rows[0].n, 0)

  // who writes an order: as the program (act_plan): managers, the office, and "Productos y programa"
  const K1 = uuid(), K2 = uuid(), R1 = uuid(), PK = uuid(), S1 = uuid()
  eq('el manager lo escribe y lo cierra (dos versiones)', await twice(jose, 'act_work_orders', woRow(K1, 'Kitchen', '889', 1000, { unit: 'mezclas', wo: 'WO-1' }), 'id', { closed_at: iso(NOW + 1000), closed_by: 'Jose', updated_at: iso(NOW + 1000) }), '|')
  eq('la oficina escribe uno de RTE y lo cambia', await twice(edgar, 'act_work_orders', woRow(R1, 'RTE', '889', 24000, { unit: 'pouches' }), 'id', { qty: 25000 }), '|')
  eq('un manager con solo "Corregir" (sigue siendo manager)', await twice(mara, 'act_work_orders', woRow(S1, 'Spiral', '1200', 3000, { unit: 'lb' }), 'id', { note: 'x' }), '|')
  eq('Pia (operadora de RTE con "Productos y programa") en su cuarto: sí', await twice(pia, 'act_work_orders', woRow(uuid(), 'RTE', '100', 5000, { unit: 'pouches' }), 'id', { qty: 5100 }), '|')
  eq('Pia en otro cuarto: no (la app escribe con INSERT … ON CONFLICT, que pide poder leer la fila, y el 015 le deja leer solo su cuarto); act_plan ya era así', [await twice(pia, 'act_work_orders', woRow(uuid(), 'MFO', '300', 900, { unit: 'platos' }), 'id', { qty: 950 }), await twice(pia, 'act_plan', { date: '2026-12-09', dept: 'MFO', code: '300', qty: 3, updated_at: iso(NOW), updated_by: 'Pia' }, 'date,dept,code,lot', { qty: 4 })], ['42501|42501', '42501|42501'])
  eq('una operadora sin el poder, "Solo ver", una cuenta sin papel en Actividad, una desactivada: no', await each([noe, mike, frank, gone], (who) => code(as(db, who, (tx) => upsert(tx, 'act_work_orders', woRow(uuid(), 'Kitchen', '889', 5))))), ['42501', '42501', '42501', '42501'])
  eq('dos pedidos del mismo cuarto y código, de dos tablets (dos WO): se guardan los dos', [await code(as(db, jose, (tx) => upsert(tx, 'act_work_orders', woRow(K2, 'Kitchen', '889', 500, { wo: 'WO-2', unit: 'mezclas' })))), await code(as(db, edgar, (tx) => upsert(tx, 'act_work_orders', woRow(uuid(), 'Kitchen', '889', 500, { wo: 'WO-2', unit: 'mezclas' })))), (await db.query("select count(*)::int as n from public.act_work_orders where dept = 'Kitchen' and code = '889'")).rows[0].n], ['', '', 3])
  eq('uno marcado borrado y puesto otra vez', await twice(jose, 'act_work_orders', woRow(PK, 'Packing', '889', 360, { unit: 'cajas', deleted: true }), 'id', { deleted: false }), '|')
  eq('una fila con lo mínimo: lo demás lo ponen sus valores de omisión', [await code(as(db, jose, (tx) => upsert(tx, 'act_work_orders', { id: uuid(), dept: 'Kitchen', code: '777', qty: 10, start_date: '2026-10-19', updated_at: iso(NOW), updated_by: 'Jose' }))), (await db.query("select wo, unit, note, created_by, deleted from public.act_work_orders where code = '777'")).rows[0]], ['', { wo: '', unit: '', note: '', created_by: '', deleted: false }])

  // who reads them: the rule of 015 (an operator, her own room)
  const seen = (who) => as(db, who, async (tx) => (await tx.query('select dept, count(*)::int as n from public.act_work_orders group by dept order by dept')).rows.map((r) => [r.dept, r.n]))
  // (with the ones the section of 018 wrote: three of Packing, one of RTE)
  const everything = [['Kitchen', 4], ['Packing', 4], ['RTE', 3], ['Spiral', 1]]
  eq('Noelia (Kitchen) lee los de Kitchen; Ana (Packing), los de Packing', [await seen(noe), await seen(ana)], [[['Kitchen', 4]], [['Packing', 4]]])
  eq('la oficina, "Solo ver" y el manager: todos', [await seen(edgar), await seen(mike), await seen(jose)], [everything, everything, everything])
  eq('una cuenta sin papel, o desactivada: nada', [await seen(frank), await seen(gone)], [[], []])
  // (review of 2026-10-20) a request made by hand, not by the app: a plain INSERT, as PostgREST makes a POST without its
  // upsert. Without the room in the write rule it went in, and an MFO order planted with an earlier start day would take
  // MFO's production first on every MFO tablet. The same row moved to another room by an UPDATE, refused too
  const plain = (who, row) => code(as(db, who, (tx) => { const cols = Object.keys(row); return tx.query(`insert into public.act_work_orders (${cols.join(', ')}) values (${cols.map((_, i) => '$' + (i + 1)).join(', ')})`, cols.map((c) => row[c])) }))
  const PIA = uuid()
  eq('Pia con un INSERT a mano: en su cuarto sí; en otro (MFO) no; ni pasarlo a otro cuarto después', [await plain(pia, woRow(PIA, 'RTE', '101', 50, { unit: 'pouches' })), await plain(pia, woRow(uuid(), 'MFO', '301', 900, { unit: 'platos', start_date: '2026-01-01' })), await code(as(db, pia, (tx) => tx.query("update public.act_work_orders set dept = 'MFO' where id = $1", [PIA])))], ['', '42501', '42501'])
  eq('el manager y la oficina con un INSERT a mano, en cualquier cuarto', [await plain(jose, woRow(uuid(), 'MFO', '302', 10, { unit: 'platos' })), await plain(edgar, woRow(uuid(), 'Spiral', '303', 10, { unit: 'lb' }))], ['', ''])

  // nobody erases; the server stamps every version and keeps the one before
  eq('DELETE y TRUNCATE, ni el manager', [await undone(jose, 'delete from public.act_work_orders'), await undone(jose, 'truncate public.act_work_orders')], ['42501', '42501'])
  const stampOf = async () => (await db.query('select synced_at from public.act_work_orders where id = $1', [R1])).rows[0].synced_at
  const s1 = await stampOf()
  await new Promise((r) => setTimeout(r, 15))
  await as(db, edgar, (tx) => upsert(tx, 'act_work_orders', woRow(R1, 'RTE', '889', 26000, { unit: 'pouches', updated_at: iso(NOW - 99_000) })))
  eq('cada versión que llega lleva una hora del servidor más nueva (aunque la de la tablet sea vieja)', (await stampOf()) > s1, true)
  const log = (await db.query("select by_name, (was ->> 'qty')::numeric as was_qty, uid::text from public.act_runs_log where table_name = 'act_work_orders' and row_id = $1 order by n", [R1])).rows.map((r) => [r.by_name, Number(r.was_qty), r.uid])
  eq('act_runs_log guarda cada versión de antes, con la cuenta que mandó el cambio', log, [['prueba', 24000, edgar.id], ['prueba', 25000, edgar.id]])

  // act_plan.order_id: the order a day's program is a part of
  const planRow = (date, dept, c, qty, o = {}) => ({ date, dept, code: c, qty, lot: '', updated_at: iso(NOW), updated_by: 'prueba', ...o })
  const orderOf = async (date, dept, c) => { const r = (await db.query('select order_id::text from public.act_plan where date = $1 and dept = $2 and code = $3', [date, dept, c])).rows[0]; return r ? r.order_id : 'sin fila' }
  eq('la oficina programa 80 del pedido K1', [await code(as(db, edgar, (tx) => upsert(tx, 'act_plan', planRow('2026-10-19', 'Kitchen', '889', 80, { order_id: K1 }), 'date,dept,code,lot'))), await orderOf('2026-10-19', 'Kitchen', '889')], ['', K1])
  eq('lo pasa a otro pedido, y luego a ninguno (null)', [await code(as(db, edgar, (tx) => upsert(tx, 'act_plan', planRow('2026-10-19', 'Kitchen', '889', 80, { order_id: K2 }), 'date,dept,code,lot'))), await orderOf('2026-10-19', 'Kitchen', '889'), await code(as(db, edgar, (tx) => upsert(tx, 'act_plan', planRow('2026-10-19', 'Kitchen', '889', 80, { order_id: null }), 'date,dept,code,lot'))), await orderOf('2026-10-19', 'Kitchen', '889')], ['', K2, '', null])
  eq('una tablet de antes del 020 (no manda la columna) cambia la cantidad y el pedido del programa se queda', [await code(as(db, edgar, (tx) => upsert(tx, 'act_plan', planRow('2026-10-20', 'Kitchen', '889', 80, { order_id: K1 }), 'date,dept,code,lot'))), await code(as(db, edgar, (tx) => upsert(tx, 'act_plan', planRow('2026-10-20', 'Kitchen', '889', 90), 'date,dept,code,lot'))), await orderOf('2026-10-20', 'Kitchen', '889')], ['', '', K1])
  eq('un programa cuyo pedido todavía no llegó al servidor entra igual (sin llave foránea: la app cuida la relación)', await code(as(db, jose, (tx) => upsert(tx, 'act_plan', planRow('2026-10-21', 'Spiral', '1200', 400, { order_id: uuid() }), 'date,dept,code,lot'))), '')
  eq('una operadora sin el poder sigue sin escribir el programa, con o sin pedido', [await code(as(db, noe, (tx) => upsert(tx, 'act_plan', planRow('2026-10-21', 'Kitchen', '889', 1, { order_id: K1 }), 'date,dept,code,lot'))), await code(as(db, noe, (tx) => upsert(tx, 'act_plan', planRow('2026-10-21', 'Kitchen', '889', 1), 'date,dept,code,lot')))], ['42501', '42501'])

  // the history of an order goes with its room, under the rules of always (001/018): nothing new was needed
  eq('el manager, la oficina y Pia (su cuarto) escriben la historia de un pedido con su cuarto', [await twice(jose, 'act_changes', chg(uuid(), 'Kitchen', 'act_work_orders', K1), 'id', { after: 'b' }), await twice(edgar, 'act_changes', chg(uuid(), 'RTE', 'act_work_orders', R1), 'id', { after: 'b' }), await twice(pia, 'act_changes', chg(uuid(), 'RTE', 'act_work_orders', R1), 'id', { after: 'b', deleted: true })], ['|', '|', '|'])
  eq('la cuenta cerrada de un pedido: la escribe quien escribe su cuarto (Noelia en Kitchen); no Ana (Packing) ni "Solo ver"', [await twice(noe, 'act_changes', chg('wodone:' + K1, 'Kitchen', 'act_work_orders:done', K1), 'id', { after: 'c' }), await code(as(db, ana, (tx) => upsert(tx, 'act_changes', chg('wodone:' + K2, 'Kitchen', 'act_work_orders:done', K2)))), await code(as(db, mike, (tx) => upsert(tx, 'act_changes', chg('wodone:' + K2, 'Kitchen', 'act_work_orders:done', K2))))], ['|', '42501', '42501'])
  eq('una línea sin cuarto de un pedido no entra para una operadora (la app nunca la manda)', [await code(as(db, pia, (tx) => upsert(tx, 'act_changes', chg(uuid(), null, 'act_work_orders', R1)))), await code(as(db, noe, (tx) => upsert(tx, 'act_changes', chg(uuid(), null, 'act_work_orders:done', K1))))], ['42501', '42501'])
  eq('Noelia lee la historia y las cuentas de los pedidos de su cuarto; Ana no', [await as(db, noe, async (tx) => (await tx.query("select count(*)::int as n from public.act_changes where ref_table like 'act_work_orders%' and dept = 'Kitchen'")).rows[0].n), await as(db, ana, async (tx) => (await tx.query("select count(*)::int as n from public.act_changes where ref_table like 'act_work_orders%' and dept = 'Kitchen'")).rows[0].n)], [2, 0])
}

// ---- 021 (the office and Jose, 2026-10-20): a room's program by lot ----
section('021: el programa de un cuarto por lote: el mismo código con otro lote es otra fila (la oficina, 2026-10-20)')
{
  // The office typed RTE's 889 of lot 6292 and of lot 6290 for the same day and the app refused the second: one row per
  // day, room and code. Jose: "si el lote es diferente que sea otra programación aun si es el mismo código"
  const pkCols = async (d) => (await d.query("select array_agg(a.attname::text order by k.n) as cols from pg_constraint c cross join lateral unnest(c.conkey) with ordinality as k(attnum, n) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum where c.conrelid = 'public.act_plan'::regclass and c.contype = 'p'")).rows[0].cols
  const rowsOf = async (d, c) => (await d.query("select lot, qty::int as qty from public.act_plan where date = '2026-10-19' and dept = 'RTE' and code = $1 order by lot", [c])).rows
  // the server as it is today: every file up to 020, and the programs typed by the build of before
  const { db: old, applied } = await serverDb({ upTo: '021' })
  const j = await person(old, { name: 'Jose', actRole: 'mgr', role: 'admin' })
  const noe2 = await person(old, { name: 'Noelia', actRole: 'op', actDept: 'Kitchen' })
  const row = (c, qty, lot, o = {}) => ({ date: '2026-10-19', dept: 'RTE', code: c, qty, lot, order_id: null, updated_at: iso(NOW), updated_by: 'Jose', ...o })
  eq('una base con todo hasta el 020: la llave del programa es (día, cuarto, código)', [applied.at(-1), await pkCols(old)], ['020_work_orders.sql', ['date', 'dept', 'code']])
  await as(old, j, (tx) => upsert(tx, 'act_plan', row('889', 15688, '6292'), 'date,dept,code'))
  await as(old, j, (tx) => upsert(tx, 'act_plan', row('2010', 3360, ''), 'date,dept,code'))
  await as(old, j, (tx) => upsert(tx, 'act_plan', { ...row('889', 80, '6292'), dept: 'Kitchen', order_id: uuid() }, 'date,dept,code'))
  eq('antes del 021 el programa nuevo, que sube por (día, cuarto, código, lote), no encuentra su llave (42P10): espera en la tablet, nada cambia aquí', [await code(as(old, j, (tx) => upsert(tx, 'act_plan', row('889', 2482, '6290'), 'date,dept,code,lot'))), await rowsOf(old, '889')], ['42P10', [{ lot: '6292', qty: 15688 }]])
  const all = async (d) => (await d.query('select date::text, dept, code, lot, qty::int as qty, order_id::text, updated_by from public.act_plan order by dept, code, lot')).rows
  const before = await all(old)
  eq('el 021 corre sobre filas que ya están, y otra vez, y otra vez: sin error, con la llave nueva', [await code(runFile(old, '021_plan_by_lot.sql')), await pkCols(old), await code(runFile(old, '021_plan_by_lot.sql')), await code(runFile(old, '021_plan_by_lot.sql')), await pkCols(old)], ['', ['date', 'dept', 'code', 'lot'], '', '', ['date', 'dept', 'code', 'lot']])
  eq('las filas que había quedan como estaban, cada una con su lote y su pedido', await all(old), before)
  eq('ahora el 889 del lote 6290 entra como otra fila, y la del 6292 sigue (lo que pidió la oficina)', [await code(as(old, j, (tx) => upsert(tx, 'act_plan', row('889', 2482, '6290'), 'date,dept,code,lot'))), await rowsOf(old, '889')], ['', [{ lot: '6290', qty: 2482 }, { lot: '6292', qty: 15688 }]])
  eq('el mismo código con el mismo lote es la misma fila: otra versión, nunca otra fila', [await code(as(old, j, (tx) => upsert(tx, 'act_plan', row('889', 15700, '6292'), 'date,dept,code,lot'))), await rowsOf(old, '889')], ['', [{ lot: '6290', qty: 2482 }, { lot: '6292', qty: 15700 }]])
  eq('y uno escrito a mano con un lote que ya está se rechaza (23505): la llave no deja dos', await code(as(old, j, (tx) => tx.query("insert into public.act_plan (date, dept, code, qty, lot) values ('2026-10-19', 'RTE', '889', 5, '6290')"))), '23505')
  eq('el mismo código sin lote es su propia fila, al lado de las de lote', [await code(as(old, j, (tx) => upsert(tx, 'act_plan', row('889', 1000, ''), 'date,dept,code,lot'))), await rowsOf(old, '889')], ['', [{ lot: '', qty: 1000 }, { lot: '6290', qty: 2482 }, { lot: '6292', qty: 15700 }]])
  eq('una tablet de antes, que sube por (día, cuarto, código), ya no tiene esa llave (42P10): su programa espera en ella y aquí nada cambia', [await code(as(old, j, (tx) => upsert(tx, 'act_plan', row('889', 1, '6290'), 'date,dept,code'))), await rowsOf(old, '889')], ['42P10', [{ lot: '', qty: 1000 }, { lot: '6290', qty: 2482 }, { lot: '6292', qty: 15700 }]])
  eq('quien no escribe el programa sigue sin escribirlo, con lote o sin él', [await code(as(old, noe2, (tx) => upsert(tx, 'act_plan', { ...row('889', 1, '6290'), dept: 'Kitchen' }, 'date,dept,code,lot'))), await code(as(old, noe2, (tx) => upsert(tx, 'act_plan', { ...row('889', 1, ''), dept: 'Kitchen' }, 'date,dept,code,lot')))], ['42501', '42501'])
  eq('el programa sigue en la publicación de realtime, con su índice por hora del servidor y el de su pedido', [(await old.query("select count(*)::int as n from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'act_plan'")).rows[0].n, (await old.query("select indexname from pg_indexes where schemaname = 'public' and tablename = 'act_plan' order by 1")).rows.map((r) => r.indexname)], [1, ['act_plan_order', 'act_plan_pkey', 'act_plan_synced']])
  await old.close()
  // the copy with every file: the sections above already wrote its programs by lot
  eq('en la base con todos los archivos la llave es (día, cuarto, código, lote), una sola vez', [await pkCols(db), (await db.query("select count(*)::int as n from pg_constraint where conrelid = 'public.act_plan'::regclass and contype in ('p', 'u')")).rows[0].n], [['date', 'dept', 'code', 'lot'], 1])
}

section('Correr otra vez un archivo viejo, solo, no afloja ni cambia ninguna regla')
// each file says "safe to run again" and Jose pastes them by hand: a rule a later file tightened must stay tight
const rules = async () => new Map((await db.query(`
  select 'policy ' || tablename || '.' || policyname as k, cmd || ' ' || roles::text || ' USING ' || coalesce(qual, '') || ' CHECK ' || coalesce(with_check, '') as v from pg_policies where schemaname = 'public' and tablename like 'act\\_%'
  union all select 'grant ' || table_name || ' ' || grantee || ' ' || privilege_type, '' from information_schema.role_table_grants where table_schema = 'public' and table_name like 'act\\_%' and grantee in ('anon', 'authenticated')
  union all select 'function ' || p.oid::regprocedure::text, pg_get_functiondef(p.oid) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'act\\_%'
  union all select 'trigger ' || c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relname like 'act\\_%' and not t.tgisinternal
  union all select 'default ' || table_name || '.' || column_name, coalesce(column_default, '') from information_schema.columns where table_schema = 'public' and table_name like 'act\\_%'
  union all select 'index ' || indexname, indexdef from pg_indexes where schemaname = 'public' and tablename like 'act\\_%'`)).rows.map((r) => [r.k, r.v]))
const before = await rules()
// and nothing of the people: an administrator of Freezer RTE the owner set to "Sin acceso" stays so (001 gave them
// manager back on every run until 2026-10-18)
const adela = await person(db, { name: 'Adela', actRole: null, role: 'admin' })
const staff = async () => (await db.query('select user_id::text, act_role, act_dept, act_powers, act_shift from public.employees order by user_id')).rows
const people0 = await staff()
const loosened = []
for (const f of actMigrations()) {
  await runFile(db, f)
  const now = await rules(), d = []
  for (const [key, v] of now) if (before.get(key) !== v) d.push(key + (before.has(key) ? ' cambió' : ' apareció'))
  for (const key of before.keys()) if (!now.has(key)) d.push(key + ' desapareció')
  if (d.length) { loosened.push(f + ': ' + d.join('; ')); for (const g of actMigrations()) await runFile(db, g) } // back to the real state
}
eq('cada archivo, corrido solo después de todos, deja las reglas como estaban', loosened, [])
eq('y a la gente como estaba (un administrador de Freezer RTE en "Sin acceso" sigue así)', [await staff(), (await db.query('select act_role from public.employees where user_id = $1', [adela.id])).rows[0].act_role], [people0, null])
await runFile(db, '001_actividad.sql')
eq('después de correr el 001 otra vez, un operador de Packing sigue sin leer RTE', await count(ana, 'act_runs').then((rows) => rows.map(([d]) => d)), ['Packing'])
await runFile(db, '013_devices.sql')
eq('y después del 013, la tablet de un operador sigue escribiendo su palabra', await hello(ana, device('d-ana', 'Ana', await empId('Ana'), { pending: 5 })), '')

await db.close()
console.log(failed.length ? `\n✗ ${failed.length} de ${passed + failed.length} comprobaciones fallaron:\n\n  ${failed.join('\n\n  ')}\n` : `\n✓ ${passed} comprobaciones, todas correctas (Postgres de verdad, con las migraciones del servidor)\n`)
process.exit(failed.length ? 1 : 0)
