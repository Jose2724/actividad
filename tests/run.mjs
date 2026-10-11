// Checks of the numbers and of what happens when two devices change the same thing. Run with: npm run check
// It loads the app's own code (tests/device.ts, bundled for Node) once per "device". Every product, code and
// quantity here is made up.
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const bundle = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/.cache/act-check/device.js')).href

// ---- a tiny browser: every device has its own storage, and the clock is ours ----
const disks = new Map()
let on = 'main'
const disk = () => { if (!disks.has(on)) disks.set(on, new Map()); return disks.get(on) }
const quota = new Map() // device → how many characters its storage takes (none = no limit)
const used = (but) => [...disk()].reduce((t, [k, v]) => t + (k === but ? 0 : k.length + v.length), 0)
Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: {
  getItem: (k) => (disk().has(k) ? disk().get(k) : null),
  setItem: (k, v) => { if (quota.has(on) && used(k) + k.length + String(v).length > quota.get(on)) throw new Error('QuotaExceededError'); disk().set(k, String(v)) },
  removeItem: (k) => { disk().delete(k) },
} })
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true } }
const M = 60_000
const T0 = new Date(2026, 9, 10, 15, 0, 0).getTime() // Saturday 10 October 2026, 3:00 PM on this PC's clock
const DAY = '2026-10-10'
let clock = T0
Date.now = () => clock

async function device(name, { seed, user = name } = {}) {
  on = name
  if (seed) localStorage.setItem('act_v1', JSON.stringify(seed))
  localStorage.setItem('act_user', user)
  const m = await import(bundle + '?' + name)
  return { name, use: (fn) => { on = name; return fn(m) } }
}

// ---- telling right from wrong ----
let passed = 0
const failed = []
let where = ''
const section = (t) => { where = t; console.log('· ' + t) }
const eq = (what, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) passed++; else failed.push(`[${where}] ${what}\n      salió    ${a}\n      esperado ${b}`) }
const near = (what, got, want, tol = 1e-6) => { if (typeof got === 'number' && Math.abs(got - want) <= tol) passed++; else failed.push(`[${where}] ${what}\n      salió    ${got}\n      esperado ${want}`) }

// ---- rows as the server holds them ----
const iso = (ms) => new Date(ms).toISOString()
const unit = (at, qty = null, ref = '', by = 'Ana') => ({ at, qty, ref, by })
const runRow = (o) => ({ id: o.id, dept: o.dept ?? 'RTE', line_id: o.lineId ?? 'L1', line: o.line ?? 'Línea 1', code: o.code ?? 'A100', lot: o.lot ?? '6283', date: o.date ?? DAY, started_at: iso(o.startedAt), ended_at: o.endedAt ? iso(o.endedAt) : null, units: o.units ?? [], per_unit: o.perUnit ?? null, waste: o.waste ?? 0, by_name: o.by ?? 'Ana', deleted: !!o.deleted, updated_at: iso(o.updatedAt ?? o.startedAt), updated_by: 'x' })
const stopRow = (o) => ({ id: o.id, dept: o.dept ?? 'RTE', line_id: o.lineId === undefined ? 'L1' : o.lineId, reason: o.reason ?? 'Break', note: o.note ?? '', started_at: iso(o.startedAt), ended_at: o.endedAt ? iso(o.endedAt) : null, by_name: 'Ana', deleted: false, updated_at: iso(o.updatedAt ?? o.startedAt), updated_by: 'x' })
const productRow = (code, name, ppc, yieldCases, crates, perCrate, perPallet, at = T0) => ({ code, name, pouches_per_case: ppc, cases_per_mix: yieldCases, crates_per_cart: crates, pouches_per_crate: perCrate, cases_per_pallet: perPallet, deleted: false, updated_at: iso(at), updated_by: 'x' })

// =====================================================================================================================
//  1. The numbers
// =====================================================================================================================
const calc = await device('calc')

section('Número de lote (fecha juliana)')
calc.use((m) => {
  eq('8 de octubre de 2026 (el lote que trae la hoja de la oficina)', m.lotFor('2026-10-08'), '6281')
  eq('10 de octubre de 2026', m.lotFor('2026-10-10'), '6283')
  eq('1 de enero', m.lotFor('2026-01-01'), '6001')
  eq('31 de diciembre', m.lotFor('2026-12-31'), '6365')
  eq('1 de marzo, año normal', m.lotFor('2027-03-01'), '7060')
  eq('31 de diciembre, año bisiesto', m.lotFor('2028-12-31'), '8366')
  eq('fecha vacía', m.lotFor(''), '')
})

section('Códigos: 0100 y 100 son el mismo')
calc.use((m) => {
  eq('ceros a la izquierda', m.normCode('0100'), '100')
  eq('con letras no se toca', m.normCode(' zx01-020 '), 'ZX01-020')
  eq('solo ceros', m.normCode('000'), '0')
})

section('Tiempos como se muestran')
calc.use((m) => {
  eq('1 h 2 min 3 s', m.fmtDur(3_723_000), '1:02:03')
  eq('menos de un minuto', m.fmtDur(59_999), '00:59')
  eq('nunca negativo', m.fmtDur(-5000), '00:00')
  eq('entero se muestra entero', m.n1(714), '714')
  eq('un decimal', m.n1(142.8), '142.8')
  eq('sin restos de decimales', m.n1(714.0000000000001), '714')
  eq('desconocido', m.n1(null), '—')
  eq('pendiente negativo = se hizo de más', m.pending(592, 680), -88)
  eq('pendiente sin dato', m.pending(null, 5), null)
})

section('Trabajando, parado y promedio por unidad')
calc.use((m) => {
  // a run of 2 hours with 3 carts; two stops that overlap (the line's own inside the department's); stops of
  // another line, another room and from before the run, which must not count
  m.applyRemote('act_runs', runRow({ id: 'rA', code: '0100', startedAt: T0, endedAt: T0 + 120 * M, units: [unit(T0 + 30 * M, 240), unit(T0 + 50 * M, 240), unit(T0 + 100 * M, 200)], perUnit: 240, waste: 1.5 }))
  m.applyRemote('act_stops', stopRow({ id: 's0', startedAt: T0 - 20 * M, endedAt: T0 - 10 * M, reason: 'Antes de empezar' }))
  m.applyRemote('act_stops', stopRow({ id: 's1', startedAt: T0 + 60 * M, endedAt: T0 + 70 * M, reason: 'Falta de salsa' }))
  m.applyRemote('act_stops', stopRow({ id: 's2', lineId: null, startedAt: T0 + 65 * M, endedAt: T0 + 80 * M, reason: 'Break' }))
  m.applyRemote('act_stops', stopRow({ id: 's3', lineId: 'L2', startedAt: T0 + 10 * M, endedAt: T0 + 40 * M, reason: 'Otra línea' }))
  m.applyRemote('act_stops', stopRow({ id: 's4', dept: 'Packing', lineId: null, startedAt: T0 + 10 * M, endedAt: T0 + 40 * M, reason: 'Otro departamento' }))
  const s = m.store.get(), st = m.runStats(s, s.runs.find((r) => r.id === 'rA'), T0 + 200 * M)
  eq('duración total', st.total, 120 * M)
  eq('parado: 60–70 y 65–80 son 20 minutos, no 25', st.down, 20 * M)
  eq('trabajando = total − parado', st.working, 100 * M)
  eq('tiempo de cada carro, sin lo parado', st.unitTimes, [30 * M, 20 * M, 30 * M])
  near('promedio por carro', st.avg, (80 * M) / 3)
  eq('pouches', st.qty, 680)
  eq('razones suman lo parado; el rato doble va al paro que empezó primero', st.reasons, { 'Falta de salsa': 10 * M, Break: 10 * M })
})
calc.use((m) => {
  // still running, stopped right now, and a cart marked while stopped (the machine had already filled it)
  m.applyRemote('act_runs', runRow({ id: 'rOpen', lineId: 'L7', line: 'Línea 7', date: '2026-10-09', startedAt: T0, units: [unit(T0 + 50 * M, 240), unit(T0 + 70 * M, 240)], perUnit: 240 }))
  m.applyRemote('act_stops', stopRow({ id: 's7', lineId: 'L7', startedAt: T0 + 60 * M, endedAt: null, reason: 'Máquina' }))
  const s = m.store.get(), r = s.runs.find((x) => x.id === 'rOpen')
  const st = m.runStats(s, r, T0 + 90 * M)
  eq('en curso y parada: parado sigue subiendo', st.down, 30 * M)
  eq('en curso y parada: trabajando se queda quieto', st.working, 60 * M)
  eq('carro marcado durante el paro: solo cuenta el rato antes de parar', st.unitTimes, [50 * M, 10 * M])
  eq('unos minutos después, trabajando sigue igual', m.runStats(s, r, T0 + 95 * M).working, 60 * M)
  eq('el carro en curso no avanza estando parada', m.activeBetween(T0 + 70 * M, T0 + 95 * M, m.stopsOf(s, 'RTE', 'L7'), T0 + 95 * M), 0)
})

section('Cantidad de una unidad: una sola regla en todas las pantallas')
calc.use((m) => {
  m.applyRemote('act_products', productRow('100', 'Producto de prueba', 8, 18.5, 24, 10, 36))
  m.applyRemote('act_products', productRow('B200', 'Sin yield en la tabla', 8, 0, 24, 6, 0))
  // an old record: carts without their own quantity count the run's pouches per cart; with neither, the master table's
  m.applyRemote('act_runs', runRow({ id: 'rOld', date: '2026-10-01', code: '100', startedAt: T0, endedAt: T0 + 60 * M, units: [unit(T0 + 20 * M), unit(T0 + 40 * M, 200)], perUnit: 240 }))
  m.applyRemote('act_runs', runRow({ id: 'rOlder', date: '2026-10-01', code: '0100', lineId: 'L2', startedAt: T0, endedAt: T0 + 60 * M, units: [unit(T0 + 30 * M)], perUnit: null }))
  m.applyRemote('act_runs', runRow({ id: 'rMix', dept: 'Kitchen', date: '2026-10-01', code: '100', lineId: 'K1', line: 'Braiser 1', startedAt: T0, endedAt: T0 + 60 * M, units: [unit(T0 + 30 * M), unit(T0 + 55 * M)] }))
  const s = m.store.get(), run = (id) => s.runs.find((r) => r.id === id)
  eq('reporte: 240 del carro sin cantidad + 200', m.runStats(s, run('rOld'), T0 + M).qty, 440)
  eq('reporte: sin cantidad ni por carro, la tabla (24 × 10)', m.runStats(s, run('rOlder'), T0 + M).qty, 240)
  eq('una mezcla no lleva cantidad', m.runStats(s, run('rMix'), T0 + M).qty, 0)
  eq('total del departamento ese día: lo mismo', m.deptToday(s, 'RTE', '2026-10-01', T0 + 90 * M).qty, 680)
  eq('Avance ese día: lo mismo', m.avanceRows(s, '2026-10-01').find((r) => r.code === '100').pouchesDone, 680)
  eq('Kitchen cuenta mezclas', m.deptToday(s, 'Kitchen', '2026-10-01', T0 + 90 * M).qty, 2)
})

section('Total del departamento con todas las líneas, por código y ritmo')
calc.use((m) => {
  m.applyRemote('act_runs', runRow({ id: 'rB', lineId: 'L2', line: 'Línea 2', code: '100', startedAt: T0 + 15 * M, units: [unit(T0 + 45 * M, 240), unit(T0 + 110 * M, 200)], perUnit: 240, waste: 0.75 }))
  m.applyRemote('act_runs', runRow({ id: 'rC', lineId: 'L2', line: 'Línea 2', code: 'B200', startedAt: T0 - 60 * M, endedAt: T0 - 5 * M, units: [unit(T0 - 40 * M, 144), unit(T0 - 10 * M, 144)], perUnit: 144 }))
  const s = m.store.get(), t = m.deptToday(s, 'RTE', DAY, T0 + 120 * M)
  eq('pouches de todas las líneas', t.qty, 680 + 440 + 288)
  eq('carros de todas las líneas', t.units, 7)
  eq('el mismo código en dos líneas se suma (0100 y 100)', t.byCode.map((c) => [c.code, c.units, c.qty, c.waste, c.lines]), [['0100', 5, 1120, 2.25, ['Línea 1', 'Línea 2']], ['B200', 2, 288, 0, ['Línea 2']]])
  eq('horas desde el primer inicio del día', t.hours, 3)
  near('ritmo = pouches ÷ horas', t.rate, 1408 / 3)
  eq('todavía hay una línea corriendo', t.allEnded, false)
  eq('antes de 10 minutos no se da ritmo', m.deptToday(s, 'RTE', DAY, T0 - 55 * M).rate, null)
})

section('Avance: la misma cuenta que la hoja AVANCE de la oficina')
calc.use((m) => {
  m.setSchedule(DAY, '0100', 10)
  m.setSchedule(DAY, 'c300', 3)
  m.applyRemote('act_products', productRow('C300', 'Yield con decimales', 2, 71.4, 24, 20, 105))
  m.applyRemote('act_runs', runRow({ id: 'k1', dept: 'Kitchen', lineId: 'K1', line: 'Braiser 1', code: '0100', startedAt: T0, units: [unit(T0 + 10 * M), unit(T0 + 20 * M), unit(T0 + 30 * M), unit(T0 + 40 * M)] }))
  m.applyRemote('act_runs', runRow({ id: 'k2', dept: 'Kitchen', lineId: 'K2', line: 'Braiser 2', code: 'C300', startedAt: T0, units: [unit(T0 + 10 * M), unit(T0 + 20 * M), unit(T0 + 30 * M), unit(T0 + 40 * M), unit(T0 + 50 * M)] }))
  m.applyRemote('act_runs', runRow({ id: 'sp', dept: 'Spiral', lineId: 'S1', code: '100', startedAt: T0, units: [unit(T0 + 10 * M), unit(T0 + 20 * M), unit(T0 + 30 * M)] }))
  m.applyRemote('act_runs', runRow({ id: 'pk', dept: 'Packing', lineId: 'P1', code: '100', startedAt: T0, units: [unit(T0 + 10 * M, 36, '1749'), unit(T0 + 20 * M, 36, '1750')], perUnit: 36 }))
  m.applyRemote('act_runs', runRow({ id: 'mf', dept: 'MFO', lineId: 'M1', code: '100', startedAt: T0, units: [unit(T0 + 10 * M, 30, '7')] }))
  const rows = m.avanceRows(m.store.get(), DAY)
  eq('una fila por código (0100 y 100 juntos)', rows.map((r) => r.code), ['100', 'B200', 'C300'])
  const a = rows[0]
  eq('programadas, hechas, pendientes', [a.scheduled, a.mixesDone, a.mixesPending, a.spiralDone], [10, 4, 6, 3])
  eq('cajas programadas = 10 mezclas × 18.5', a.casesPlan, 185)
  eq('pouches programados = 185 cajas × 8', a.pouchesPlan, 1480)
  eq('pallets programados = 185 ÷ 36', a.palletsPlan, 5.14)
  eq('cajas esperadas = 4 mezclas hechas × 18.5', a.casesExp, 74)
  eq('pouches esperados = 74 × 8', a.pouchesExp, 592)
  eq('pallets esperados = 74 ÷ 36', a.palletsExp, 2.06)
  eq('pouches hechos (RTE, las dos líneas)', a.pouchesDone, 1120)
  eq('cajas hechas (Packing), MFO y pallets', [a.casesDone, a.mfoCases, a.palletsDone], [72, 30, 2])
  eq('waste del código', a.wasteLb, 2.25)
  eq('Pend. pouches = esperado − hecho', m.pending(a.pouchesExp, a.pouchesDone), -528)
  eq('Faltan pouches = programado − hecho', m.pending(a.pouchesPlan, a.pouchesDone), 360)
  eq('Pend. y Faltan de cajas', [m.pending(a.casesExp, a.casesDone), m.pending(a.casesPlan, a.casesDone)], [2, 113])
  const b = rows[1]
  eq('sin yield en la tabla: no se inventa un esperado de 0', [b.casesExp, b.pouchesExp, b.palletsExp, b.pouchesDone], [null, null, null, 288])
  const c = rows[2]
  eq('se hicieron 5 de 3 programadas: pendiente −2, como en la hoja de la oficina', [c.scheduled, c.mixesDone, c.mixesPending], [3, 5, -2])
  eq('71.4 × 2 × 5 da 714 exacto, sin restos', [c.casesExp, c.pouchesExp], [357, 714])
  eq('pallets: 357 ÷ 105', c.palletsExp, 3.4)
})

section('Programa del día: un código escrito con y sin cero no se cuenta dos veces')
calc.use((m) => {
  // what comes back from the server for the code typed as "0100" is stored as "100"
  for (const it of m.outbox.items().filter((i) => i.table === 'act_schedule')) { m.markSent(it); m.applyRemote('act_schedule', it.row) }
  eq('una sola entrada por código', m.store.get().schedule[DAY], { 100: 10, C300: 3 })
  eq('siguen siendo 10 mezclas, no 20', m.avanceRows(m.store.get(), DAY)[0].scheduled, 10)
  m.setSchedule(DAY, '0100', 12)
  eq('cambiarlo con el cero delante pisa el mismo', m.store.get().schedule[DAY], { 100: 12, C300: 3 })
  m.applyRemote('act_schedule', { date: DAY, code: '100', mixes: 10, updated_at: iso(T0) })
  eq('lo recién escrito aquí no lo pisa una fila vieja del servidor', m.store.get().schedule[DAY]['100'], 12)
})
const legacy = await device('legacy', { seed: { lines: [], runs: [], stops: [], products: [], schedule: { [DAY]: { '0100': 10, 100: 10, '0200': 0, 200: 7, '0300': 4, '0400': 9, 400: 5 } } } })
legacy.use((m) => {
  eq('datos guardados por la versión anterior se ordenan al abrir', m.store.get().schedule[DAY], { 100: 10, 200: 7, 300: 4, 400: 9 })
})

section('Tabla de productos')
calc.use((m) => {
  for (const it of m.outbox.items()) m.markSent(it)
  const codes = () => m.store.get().products.map((p) => p.code)
  eq('orden inicial', codes(), ['100', 'B200', 'C300'])
  m.applyRemote('act_products', productRow('100', 'Producto de prueba', 8, 19.5, 24, 10, 36, T0 + M))
  eq('un producto cambiado en otro aparato se queda en su sitio', codes(), ['100', 'B200', 'C300'])
  eq('y trae el número nuevo', m.store.get().products[0].casesPerMix, 19.5)
  m.applyRemote('act_products', productRow('100', 'Producto de prueba', 8, 18.5, 24, 10, 36, T0 + 2 * M))
  // a new row whose code is typed as one that exists: refused, and the other product is not touched
  eq('se agrega una fila en blanco', m.saveProduct(3, { code: '', name: '', pouchesPerCase: 0, casesPerMix: 0, cratesPerCart: 24, pouchesPerCrate: 0, casesPerPallet: 0, updatedAt: 0 }), true)
  eq('ponerle el código de otro producto se rechaza (también 0100 = 100)', [m.saveProduct(3, { ...m.store.get().products[3], code: '0100' }), m.saveProduct(3, { ...m.store.get().products[3], code: 'b200' })], [false, false])
  eq('el producto que ya existía queda intacto', m.store.get().products[0], { code: '100', name: 'Producto de prueba', pouchesPerCase: 8, casesPerMix: 18.5, cratesPerCart: 24, pouchesPerCrate: 10, casesPerPallet: 36, updatedAt: T0 + 2 * M })
  eq('nada sale hacia el servidor por el intento', m.outbox.items().filter((i) => i.table === 'act_products'), [])
  eq('el motivo: código de otro, en blanco, o ninguno', [m.codeProblem(3, '0100'), m.codeProblem(1, ' '), m.codeProblem(3, 'D400'), m.codeProblem(0, '0100'), m.codeProblem(3, '')], ['taken', 'blank', null, null, null])
  eq('un código libre sí se guarda', m.saveProduct(3, { ...m.store.get().products[3], code: 'D400', name: 'Nuevo' }), true)
  eq('dejar en blanco el código de un producto se rechaza', m.saveProduct(1, { ...m.store.get().products[1], code: ' ' }), false)
  clock += M
  eq('cambiar un código retira el viejo en el servidor', [m.saveProduct(3, { ...m.store.get().products[3], code: 'D401' }), m.outbox.items().filter((i) => i.table === 'act_products').map((i) => [i.key, i.row.deleted])], [true, [['D400', true], ['D401', false]]])
  clock = T0
})

section('Historial: cada cambio en su línea, con su antes y su después')
calc.use((m) => {
  const lines = (from) => m.store.get().changes.slice(from).map((c) => [c.what, c.before, c.after])
  let n = m.store.get().changes.length
  clock = T0 + 30 * M
  // two different products change their code one after the other: two lines, not one glued together
  m.saveProduct(3, { ...m.store.get().products[3], code: 'D402' })
  m.saveProduct(1, { ...m.store.get().products[1], code: 'B201' })
  eq('dos productos distintos, dos líneas', lines(n), [['Producto D401 · Código', 'D401', 'D402'], ['Producto B200 · Código', 'B200', 'B201']])
  m.saveProduct(1, { ...m.store.get().products[1], code: 'B200' })
  // the same number retyped within a minute and a half is one line; put back as it was, the line goes away
  n = m.store.get().changes.length
  m.saveProduct(0, { ...m.store.get().products[0], casesPerMix: 19 })
  clock += 20_000; m.saveProduct(0, { ...m.store.get().products[0], casesPerMix: 19.5 })
  eq('un mismo número corregido enseguida: una línea con el primer antes y el último después', lines(n), [['Producto 100 · Cajas / mezcla', '18.5', '19.5']])
  clock += 20_000; m.saveProduct(0, { ...m.store.get().products[0], casesPerMix: 18.5 })
  eq('si vuelve a como estaba, no queda línea', lines(n), [])
  clock += 5 * M; m.saveProduct(0, { ...m.store.get().products[0], casesPerMix: 20 })
  clock += 5 * M; m.saveProduct(0, { ...m.store.get().products[0], casesPerMix: 18.5 })
  eq('pasado ese rato, cada cambio es su propia línea', lines(n), [['Producto 100 · Cajas / mezcla', '18.5', '20'], ['Producto 100 · Cajas / mezcla', '20', '18.5']])
  // two runs of the same code, line and day corrected one after the other
  const row = (id, start) => runRow({ id, code: 'H1', date: '2026-10-03', lineId: 'L5', line: 'Línea 5', startedAt: start, endedAt: start + 30 * M, units: [unit(start + 10 * M, 240)], perUnit: 240 })
  m.applyRemote('act_runs', row('h1', T0)); m.applyRemote('act_runs', row('h2', T0 + 60 * M))
  n = m.store.get().changes.length
  m.updateRun('h1', { lot: '7001' }); m.updateRun('h2', { lot: '7002' })
  eq('dos corridas del mismo código y línea: cada una su línea', lines(n).map((l) => [l[1], l[2]]), [['6283', '7001'], ['6283', '7002']])
  clock = T0
  for (const it of m.outbox.items()) m.markSent(it)
})

section('Archivo CSV de la oficina: coma, punto y coma o tabulador')
calc.use((m) => {
  const want = [{ code: '0100', name: 'Albóndigas, bolsa 48 oz', pouchesPerCase: 8, casesPerMix: 18.5, cratesPerCart: 24, pouchesPerCrate: 10, casesPerPallet: 36, updatedAt: 0 }, { code: 'M1-2', name: 'Arroz', pouchesPerCase: 5, casesPerMix: 71.42, cratesPerCart: 24, pouchesPerCrate: 0, casesPerPallet: 0, updatedAt: 0 }]
  const head = ['Código', 'Producto RTE', 'Mezcla (production item)', 'Piezas por pouch', 'Pouches por caja', 'Pouches por mezcla (RTE yield)', 'Cajas por mezcla (yield)', 'Cajas por pallet', 'Guacales por carro', 'Pouches por guacal']
  const comma = '﻿' + head.join(',') + '\r\n0100,"Albóndigas, bolsa 48 oz",MIX A,12,8,148,18.5,36,24,10\r\nm1-2,Arroz,MIX R,1,5,358,71.42,,24,\r\n,sin código,,,,,,,,\r\n'
  const semi = head.join(';') + '\n0100;Albóndigas, bolsa 48 oz;MIX A;12;8;148;18,5;36;24;10\nm1-2;Arroz;MIX R;1;5;358;71,42;;24;\n'
  const tab = head.join('\t') + '\n0100\tAlbóndigas, bolsa 48 oz\tMIX A\t12\t8\t148\t18.5\t36\t24\t10\nm1-2\tArroz\tMIX R\t1\t5\t358\t71.42\t\t24\t\n'
  eq('separado por comas (Excel en inglés)', m.parseProductsCsv(comma), want)
  eq('separado por punto y coma, decimales con coma (Excel en español)', m.parseProductsCsv(semi), want)
  eq('separado por tabulador', m.parseProductsCsv(tab), want)
  eq('lo que la app exporta se vuelve a leer igual', m.parseProductsCsv(m.productsCsv(want)), want)
  eq('números escritos de varias formas', ['71.4', '71,4', ' 1.234,5 ', '1,234.5', '', '11..6', 'abc'].map(m.numOf), [71.4, 71.4, 1234.5, 1234.5, 0, 0, 0])
})

section('Cantidad sugerida al empezar un código')
calc.use((m) => {
  const s = m.store.get()
  eq('RTE: la tabla manda (24 guacales × 10 pouches)', m.lastPerUnit(s, 'RTE', '0100'), 240)
  eq('Packing: cajas por pallet de la tabla', m.lastPerUnit(s, 'Packing', '100'), 36)
  eq('si la tabla no lo tiene, lo último que usó ese departamento (por hora de inicio)', m.lastPerUnit(s, 'RTE', 'ZZ9'), null)
  m.applyRemote('act_runs', runRow({ id: 'z1', code: 'ZZ9', date: '2026-10-02', startedAt: T0 + 5 * M, endedAt: T0 + 6 * M, perUnit: 180 }))
  m.applyRemote('act_runs', runRow({ id: 'z2', code: 'ZZ9', date: '2026-10-02', startedAt: T0 + 1 * M, endedAt: T0 + 2 * M, perUnit: 120 }))
  eq('el más reciente, aunque haya llegado antes', m.lastPerUnit(m.store.get(), 'RTE', 'zz9'), 180)
  eq('MFO no tiene cantidad fija', m.lastPerUnit(m.store.get(), 'MFO', '100'), null)
})

section('Corregir una hora cerca de la medianoche')
calc.use((m) => {
  const at = (d, h, mi) => new Date(2026, 9, d, h, mi, 0).getTime()
  eq('11:55 PM corregido a 12:05 AM pasa al día siguiente', m.nearDay(at(10, 23, 55), '00:05'), at(11, 0, 5))
  eq('12:10 AM corregido a 11:50 PM vuelve al día anterior', m.nearDay(at(11, 0, 10), '23:50'), at(10, 23, 50))
  eq('un cambio normal se queda en el día', m.nearDay(at(10, 15, 30), '15:10'), at(10, 15, 10))
  eq('una hora mal escrita no mueve nada', m.nearDay(at(10, 15, 30), ''), at(10, 15, 30))
})

section('Excel: horas y tiempos como valores de Excel')
calc.use((m) => {
  near('1:02:03 como fracción de día', m.xDur(3_723_000, '1:02:03').v, 3723 / 86400)
  eq('10 de octubre de 2026 es el día 46305 de Excel', m.xDay('2026-10-10').v, 46305)
  near('3:00 PM de ese día', m.xTime(T0, '3:00 PM').v, 46305 + 15 / 24)
  eq('texto para el CSV', [m.cellText(m.xDur(3_723_000, '1:02:03')), m.cellText(12), m.cellText(null)], ['1:02:03', '12', ''])
})

// =====================================================================================================================
//  2. Two devices, one run: nothing that was tapped may get lost
// =====================================================================================================================
const server = new Map() // 'table|key' → the row the server holds
const tab = await device('tab', { user: 'Nino' })
const mgr = await device('mgr', { user: 'Santiago' })
const all = [tab, mgr]
const first = (d) => d.use((m) => m.outbox.items()[0])
const land = (it) => server.set(it.table + '|' + it.key, it.row)
const ack = (d, it) => d.use((m) => m.markSent(it))
const hear = (to, it) => { for (const o of to) o.use((m) => m.applyRemote(it.table, it.row)) }
/** the device sends its whole queue: each row lands on the server, is acknowledged, and every device listed hears it live */
function send(d, to = all) {
  for (let n = 0; n < 60; n++) { const it = first(d); if (!it) return; land(it); ack(d, it); hear(to, it) }
  throw new Error('la cola de ' + d.name + ' no se vacía')
}
/** a device that was away comes back: it brings down what the server has, then sends its own */
function comeBack(d) { for (const [k, row] of [...server]) d.use((m) => m.applyRemote(k.split('|')[0], row)); settle() }
/** everyone keeps sending until nobody has anything left (a merge may answer with a row of its own) */
function settle() { for (let n = 0; n < 20; n++) { if (!all.some((d) => first(d))) return; for (const d of all) send(d) } throw new Error('los aparatos no terminan de ponerse de acuerdo') }
const runOn = (d, id) => d.use((m) => m.store.get().runs.find((r) => r.id === id))
const stopOn = (d, id) => d.use((m) => m.store.get().stops.find((x) => x.id === id))
const show = (r) => r && { units: r.units.map((u) => [Math.round((u.at - T0) / M), u.qty]), waste: r.waste, code: r.code, ended: !!r.endedAt }
/** both screens and the server show the same, and nothing is left to send */
function agreed(what, id, want) {
  eq(what + ' · tablet', show(runOn(tab, id)), want)
  eq(what + ' · manager', show(runOn(mgr, id)), want)
  const sv = server.get('act_runs|' + id)
  eq(what + ' · servidor', show({ units: sv.units, waste: sv.waste, code: sv.code, endedAt: sv.ended_at }), want)
  eq(what + ' · nada pendiente', all.map((d) => d.use((m) => m.outbox.size())), [0, 0])
}
/** a fresh run of the tablet with carts at minutes 10, 20, 30… everyone in step */
function newRun(carts = 4) {
  clock += 10 * M
  const base = clock
  tab.use((m) => { if (!m.store.get().lines.length) m.addLine('RTE'); m.startRun(m.store.get().lines[0], 'A100', '6283', DAY, 240) })
  const id = tab.use((m) => m.store.get().runs.at(-1).id)
  for (let i = 1; i <= carts; i++) { clock = base + i * 10 * M; tab.use((m) => m.unitDone(id, 240)) }
  settle()
  return { id, base, min: (at) => Math.round((at - T0) / M) }
}
const cartsAt = (base, mins, qty = 240) => mins.map((x) => [Math.round((base - T0) / M) + x, qty])

section('Dos aparatos: lo normal, con señal')
{
  const { id, base } = newRun(2)
  agreed('dos carros marcados en la tablet se ven en el manager', id, { units: cartsAt(base, [10, 20]), waste: 0, code: 'A100', ended: false })
}

section('Dos aparatos: toques seguidos y avisos que llegan tarde o antes de tiempo')
{
  const { id, base } = newRun(1)
  // three quick taps: the first is still travelling when the second is tapped; the echoes arrive late, in any order
  clock = base + 21 * M; tab.use((m) => m.unitDone(id, 240)); const v2 = first(tab)
  clock = base + 22 * M; tab.use((m) => m.unitDone(id, 240))
  land(v2); ack(tab, v2)
  const v3 = first(tab); land(v3); ack(tab, v3)
  clock = base + 23 * M; tab.use((m) => m.unitDone(id, 240)); const v4 = first(tab); land(v4); ack(tab, v4)
  hear(all, v2); hear(all, v3); hear([tab], v2); hear(all, v4); hear([tab], v3)
  settle()
  agreed('ningún carro se pierde ni se repite', id, { units: cartsAt(base, [10, 21, 22, 23]), waste: 0, code: 'A100', ended: false })
  // the echo arrives before the acknowledgement
  clock = base + 30 * M; tab.use((m) => m.unitDone(id, 200)); const v5 = first(tab); land(v5); hear(all, v5); ack(tab, v5); settle()
  agreed('el aviso llega antes que la confirmación', id, { units: [...cartsAt(base, [10, 21, 22, 23]), ...cartsAt(base, [30], 200)], waste: 0, code: 'A100', ended: false })
}

section('Tablet sin señal: sigue marcando mientras el manager corrige la misma corrida')
{
  const { id, base } = newRun(4)
  // the tablet loses the WiFi and marks carts 5 and 6
  clock = base + 50 * M; tab.use((m) => m.unitDone(id, 240))
  clock = base + 60 * M; tab.use((m) => m.unitDone(id, 240))
  // later the manager, who cannot see those two, corrects cart 2 (240 → 200) and writes the waste
  clock = base + 70 * M
  mgr.use((m) => { const r = m.store.get().runs.find((x) => x.id === id), o = m.draftOf(r); m.applyDraft(id, o, { ...o, waste: '3', units: o.units.map((u, i) => (i === 1 ? { ...u, qty: '200' } : u)) }) })
  send(mgr, [mgr])
  clock = base + 75 * M
  comeBack(tab)
  agreed('vuelve la señal: están los 6 carros y la corrección', id, { units: [[Math.round((base - T0) / M) + 10, 240], [Math.round((base - T0) / M) + 20, 200], ...cartsAt(base, [30, 40, 50, 60])], waste: 3, code: 'A100', ended: false })
}
{
  const { id, base } = newRun(4)
  // the other order: the manager corrects first, the tablet (already offline) marks its carts afterwards
  clock = base + 45 * M
  mgr.use((m) => { const r = m.store.get().runs.find((x) => x.id === id), o = m.draftOf(r); m.applyDraft(id, o, { ...o, code: 'a101', units: o.units.filter((_, i) => i !== 0) }) })
  send(mgr, [mgr])
  clock = base + 50 * M; tab.use((m) => m.unitDone(id, 240))
  clock = base + 60 * M; tab.use((m) => { m.unitDone(id, 240); m.addWaste(id, 1.25) })
  clock = base + 65 * M
  comeBack(tab)
  agreed('el carro que el manager quitó sigue quitado, el código corregido queda, y están los carros nuevos y el waste', id, { units: cartsAt(base, [20, 30, 40, 50, 60]), waste: 1.25, code: 'A101', ended: false })
}

section('Los dos suman waste a la vez')
{
  const { id, base } = newRun(1)
  clock = base + 20 * M; tab.use((m) => m.addWaste(id, 1)); settle()
  clock = base + 30 * M; tab.use((m) => m.addWaste(id, 2))         // offline: 1 → 3
  clock = base + 31 * M; mgr.use((m) => m.addWaste(id, 0.5)); send(mgr, [mgr]) // 1 → 1.5
  clock = base + 40 * M; comeBack(tab)
  agreed('cuentan las dos sumas: 1 + 2 + 0.5', id, { units: cartsAt(base, [10]), waste: 3.5, code: 'A100', ended: false })
}

section('Corregir con el formulario abierto mientras la línea sigue marcando')
{
  const { id, base } = newRun(3)
  const opened = mgr.use((m) => m.draftOf(m.store.get().runs.find((x) => x.id === id)))
  clock = base + 40 * M; tab.use((m) => m.unitDone(id, 240)); settle() // the line taps cart 4 while the manager's form is open
  clock = base + 41 * M
  mgr.use((m) => m.applyDraft(id, opened, { ...opened, lot: '6284', units: opened.units.map((u, i) => (i === 2 ? { ...u, qty: '120' } : u)) })); settle()
  agreed('el carro marcado mientras tanto no lo borra el formulario', id, { units: [...cartsAt(base, [10, 20]), ...cartsAt(base, [30], 120), ...cartsAt(base, [40])], waste: 0, code: 'A100', ended: false })
  eq('y el lote corregido quedó', runOn(tab, id).lot, '6284')
  const before = runOn(mgr, id).updatedAt
  mgr.use((m) => { const o = m.draftOf(m.store.get().runs.find((x) => x.id === id)); m.applyDraft(id, o, o) })
  eq('guardar sin cambiar nada no toca la corrida', [runOn(mgr, id).updatedAt, mgr.use((m) => m.outbox.size())], [before, 0])
}

section('Una fila vieja no puede borrar lo que ya está')
{
  const { id, base } = newRun(3)
  clock = base + 5 * 60 * M // long after anything was sent
  // a tablet that was away writes its old copy over the server: it lacks cart 3 but has a cart of its own
  const stale = { ...server.get('act_runs|' + id), units: [...server.get('act_runs|' + id).units.slice(0, 2), unit(base + 25 * M, 100, '', 'Otro')], updated_at: iso(base + 25 * M) }
  land({ table: 'act_runs', key: id, row: stale }); hear([mgr], { table: 'act_runs', row: stale })
  eq('el manager conserva sus carros y suma el que no tenía', show(runOn(mgr, id)).units, [...cartsAt(base, [10, 20]), ...cartsAt(base, [25], 100), ...cartsAt(base, [30])])
  settle()
  agreed('y el servidor y la tablet quedan igual', id, { units: [...cartsAt(base, [10, 20]), ...cartsAt(base, [25], 100), ...cartsAt(base, [30])], waste: 0, code: 'A100', ended: false })
  // an old copy that brings nothing new: the server is simply told again
  clock += 5 * 60 * M
  const older = { ...server.get('act_runs|' + id), units: server.get('act_runs|' + id).units.slice(0, 1), updated_at: iso(base + 11 * M) }
  land({ table: 'act_runs', key: id, row: older }); hear([mgr], { table: 'act_runs', row: older })
  eq('el manager no pierde nada', show(runOn(mgr, id)).units.length, 4)
  settle()
  agreed('el servidor vuelve a tener todo', id, { units: [...cartsAt(base, [10, 20]), ...cartsAt(base, [25], 100), ...cartsAt(base, [30])], waste: 0, code: 'A100', ended: false })
}

section('Relojes distintos entre aparatos')
{
  const { id, base } = newRun(1)
  // the manager's phone runs 7 minutes fast; the tablet's change, made after it, must still be the newer one
  clock = base + 27 * M; mgr.use((m) => m.addWaste(id, 2)); settle()
  clock = base + 21 * M; tab.use((m) => m.unitDone(id, 240)); settle()
  agreed('el carro marcado después se ve en el teléfono adelantado', id, { units: cartsAt(base, [10, 21]), waste: 2, code: 'A100', ended: false })
}

section('Paros: terminar en la línea y corregir la razón desde la oficina')
{
  clock += 10 * M
  const start = clock
  tab.use((m) => m.startStop('RTE', m.store.get().lines[0].id, 'Máquina / mantenimiento', ''))
  const sid = tab.use((m) => m.store.get().stops.at(-1).id); settle()
  clock = start + 8 * M; tab.use((m) => m.endStop(sid))                                   // offline
  clock = start + 9 * M; mgr.use((m) => m.updateStop(sid, { reason: 'Limpieza', note: 'derrame' })); send(mgr, [mgr])
  clock = start + 12 * M; comeBack(tab)
  const want = { reason: 'Limpieza', note: 'derrame', min: 8 }
  eq('quedó terminado y con la razón corregida · tablet', (({ reason, note, endedAt, startedAt }) => ({ reason, note, min: (endedAt - startedAt) / M }))(stopOn(tab, sid)), want)
  eq('quedó terminado y con la razón corregida · manager', (({ reason, note, endedAt, startedAt }) => ({ reason, note, min: (endedAt - startedAt) / M }))(stopOn(mgr, sid)), want)
  eq('nada pendiente', all.map((d) => d.use((m) => m.outbox.size())), [0, 0])
}

section('Borrados: lo que se quita no vuelve por un aviso atrasado')
{
  clock += 10 * M
  tab.use((m) => m.addLine('RTE'))
  const lid = tab.use((m) => m.store.get().lines.at(-1).id), created = first(tab)
  settle()
  clock += M; tab.use((m) => m.removeLine(lid)); settle()
  hear(all, created) // the notice of its creation arrives again, late
  eq('la línea quitada no reaparece', all.map((d) => d.use((m) => m.store.get().lines.some((l) => l.id === lid))), [false, false])
  const { id } = newRun(2)
  const old = server.get('act_runs|' + id)
  clock += M; mgr.use((m) => m.deleteRun(id)); settle()
  hear(all, { table: 'act_runs', row: old })
  eq('la corrida borrada tampoco', all.map((d) => !!runOn(d, id)), [false, false])
  const n = mgr.use((m) => { m.applyRemote('act_runs', {}); return m.store.get().runs.length })
  eq('una fila vacía (borrada a mano en la base de datos) no crea nada', n, mgr.use((m) => m.store.get().runs.length))
  eq('nada pendiente', all.map((d) => d.use((m) => m.outbox.size())), [0, 0])
}

section('Qué hace la cola con cada respuesta del servidor')
calc.use((m) => {
  eq('tabla o columna que falta: los registros esperan', ['42P01', 'PGRST205', 'PGRST204', '42703'].map((c) => m.verdict(c, '')), ['notReady', 'notReady', 'notReady', 'notReady'])
  eq('tabla sin permisos todavía: esperan', m.verdict('42501', 'permission denied for table act_x'), 'notReady')
  eq('fila de otro departamento: se descarta (nunca la va a aceptar)', m.verdict('42501', 'new row violates row-level security policy for table "act_lines"'), 'refused')
  eq('fila mal formada: se queda en la cola y las demás siguen', m.verdict('23502', 'null value'), 'bad')
  eq('sesión vencida o sin señal: se reintenta, nunca se descarta', ['PGRST301', '', '500'].map((c) => m.verdict(c, 'JWT expired')), ['later', 'later', 'later'])
})

// =====================================================================================================================
//  3. What a device keeps when there is a server
// =====================================================================================================================
clock = T0
const sep = (d, h = 12, mi = 0) => new Date(2026, 8, d, h, mi, 0).getTime() // a day of September 2026
section('Con servidor, el aparato guarda los últimos 14 días')
const keep = await device('keep', { user: 'Santiago' })
keep.use((m) => {
  eq('hoy es 10 de octubre: el día más viejo que guarda es el 27 de septiembre', [m.KEEP_DAYS, m.firstKeptDay()], [14, '2026-09-27'])
  const run = (id, date, start, o = {}) => m.applyRemote('act_runs', runRow({ id, date, startedAt: start, endedAt: start + 60 * M, lineId: 'LK', line: 'Línea K', units: [unit(start + 30 * M, 240)], perUnit: 240, ...o }))
  run('viejo', '2026-09-01', sep(1))
  run('borde-fuera', '2026-09-26', sep(26))
  run('borde-dentro', '2026-09-27', sep(27))
  run('fecha-mal-escrita', '2026-08-01', T0 - 2 * 24 * 60 * M) // typed with an old date, but made two days ago
  run('abierto', '2026-09-05', sep(5), { endedAt: null, lineId: 'LX', line: 'Línea X' }) // still open: someone has to close it
  run('con-cambio-sin-subir', '2026-09-02', sep(2))
  run('hoy', DAY, T0 - 120 * M)
  m.applyRemote('act_stops', stopRow({ id: 'paro-del-abierto', lineId: 'LX', startedAt: sep(5, 13), endedAt: sep(5, 13, 10) }))
  m.applyRemote('act_stops', stopRow({ id: 'paro-viejo', lineId: 'LZ', startedAt: sep(6), endedAt: sep(6, 12, 10) }))
  m.applyRemote('act_stops', stopRow({ id: 'paro-viejo-abierto', lineId: 'LZ', startedAt: sep(7), endedAt: null }))
  m.applyRemote('act_stops', stopRow({ id: 'paro-reciente', lineId: 'LK', startedAt: T0 - 90 * M, endedAt: T0 - 80 * M }))
  const change = (id, when, key) => m.applyRemote('act_changes', { id, at: iso(when), by_name: 'x', dept: 'RTE', what: 'w', before: 'a', after: 'b', ref_table: 't', ref_key: key, deleted: false, updated_at: iso(when) })
  change('cambio-viejo', sep(1), 'k1'); change('cambio-reciente', T0 - M, 'k2')
  m.applyRemote('act_schedule', { date: '2026-09-01', code: 'A100', mixes: 4, updated_at: iso(sep(1)) })
  m.applyRemote('act_schedule', { date: DAY, code: 'A100', mixes: 6, updated_at: iso(T0) })
  m.applyRemote('act_products', productRow('A100', 'Producto', 8, 18.5, 24, 10, 36, sep(1)))
  m.applyRemote('act_lines', { id: 'LK', dept: 'RTE', name: 'Línea K', deleted: false, updated_at: iso(sep(1)) })
  m.updateRun('con-cambio-sin-subir', { lot: '6245' }) // a correction that has not gone up yet
  const queued = m.outbox.items().map((i) => i.table + '|' + i.key).sort()
  m.prune()
  const s = m.store.get()
  eq('corridas que se quedan: las recientes, la abierta y la que tiene un cambio sin subir', s.runs.map((r) => r.id).sort(), ['abierto', 'borde-dentro', 'con-cambio-sin-subir', 'fecha-mal-escrita', 'hoy'])
  eq('paros que se quedan: el reciente, el abierto y el de la corrida abierta', s.stops.map((x) => x.id).sort(), ['paro-del-abierto', 'paro-reciente', 'paro-viejo-abierto'])
  eq('historial: el reciente y el del cambio sin subir', s.changes.map((c) => c.refKey).sort(), ['con-cambio-sin-subir', 'k2'])
  eq('programa: solo los días que guarda', Object.keys(s.schedule), [DAY])
  eq('productos y líneas se quedan siempre', [s.products.length, s.lines.length], [1, 1])
  eq('soltar días viejos no manda nada al servidor', m.outbox.items().map((i) => i.table + '|' + i.key).sort(), queued)
  eq('días que hay que pedir al servidor', ['2026-09-01', '2026-09-26', '2026-09-27', DAY, '2027-01-01', '', 'ayer'].map((d) => m.awayDay(d)), [true, true, false, false, false, false, false])
  // someone opens 1 September in Reporte: its rows come from the server and stay while the app is open
  m.openDay('2026-09-01')
  eq('un día abierto ya no hay que pedirlo otra vez', m.awayDay('2026-09-01'), false)
  run('viejo', '2026-09-01', sep(1))
  m.applyRemote('act_schedule', { date: '2026-09-01', code: 'A100', mixes: 4, updated_at: iso(sep(1)) })
  m.prune()
  eq('y se queda mientras la app esté abierta', [m.store.get().runs.some((r) => r.id === 'viejo'), Object.keys(m.store.get().schedule).sort()], [true, ['2026-09-01', DAY]])
  m.closeDay('2026-09-01'); m.prune()
  eq('hasta que se cierra', m.store.get().runs.some((r) => r.id === 'viejo'), false)
  // the day changes with the app open: 27 September leaves
  clock = T0 + 24 * 60 * M; m.prune(); clock = T0
  eq('al pasar el día, el más viejo sale', m.store.get().runs.some((r) => r.id === 'borde-dentro'), false)
  // many rows arriving together are saved once
  let saves = 0
  const stop = m.store.subscribe(() => { saves++ })
  m.batch(() => { for (let i = 0; i < 50; i++) run('lote' + i, DAY, T0 - (i + 1) * M) })
  stop()
  eq('50 filas que llegan juntas se guardan una vez, no 50', [saves, m.store.get().runs.filter((r) => r.id.startsWith('lote')).length], [1, 50])
})

section('Memoria del aparato llena')
const small = await device('small', { user: 'Nino' })
small.use((m) => {
  // twelve recent days with 30 runs each
  m.batch(() => { for (let d = 0; d < 12; d++) for (let i = 0; i < 30; i++) { const start = T0 - d * 24 * 60 * M - (i + 1) * 5 * M; m.applyRemote('act_runs', runRow({ id: 'r' + d + '-' + i, date: m.dayOf(start), startedAt: start, endedAt: start + 4 * M, units: [unit(start + M, 240), unit(start + 2 * M, 240), unit(start + 3 * M, 240)], perUnit: 240 })) } })
  const size = () => localStorage.getItem('act_v1').length
  const days = () => new Set(m.store.get().runs.map((r) => r.date)).size
  eq('caben los 12 días', [days(), m.storageFull.get()], [12, false])
  // the device only has room for about half of that
  quota.set('small', Math.round(size() * 0.55) + 2000)
  m.applyRemote('act_runs', runRow({ id: 'nuevo', date: DAY, startedAt: T0 - M, units: [unit(T0, 240)], perUnit: 240 }))
  eq('se sueltan los días más viejos (están en el servidor) y lo nuevo sí se guarda', [days() < 12, m.storageFull.get(), JSON.parse(localStorage.getItem('act_v1')).runs.some((r) => r.id === 'nuevo')], [true, false, true])
  eq('lo que queda son los días más recientes, completos', [m.store.get().runs.filter((r) => r.date === DAY).length >= 30, size() <= quota.get('small')], [true, true])
  // no room even for two days: it is said on the screen, and what is being sent is not lost
  quota.set('small', 3000)
  m.addLine('RTE'); m.startRun(m.store.get().lines[0], 'A100', '6283', DAY, 240)
  const id = m.store.get().runs.at(-1).id
  eq('sin espacio ni para dos días: aviso en pantalla', m.storageFull.get(), true)
  eq('lo que se registra sigue en pantalla y en la cola de envío mientras la app esté abierta', [!!m.store.get().runs.find((r) => r.id === id), m.outbox.items().some((i) => i.key === id)], [true, true])
  quota.delete('small')
  m.unitDone(id, 240)
  eq('al haber espacio otra vez: se guarda todo y el aviso se quita', [m.storageFull.get(), JSON.parse(localStorage.getItem('act_v1')).runs.find((r) => r.id === id).units.length, JSON.parse(localStorage.getItem('act_outbox')).some((i) => i.key === id)], [false, 1, true])
})

section('Bajar del servidor por páginas, sin saltarse filas')
await calc.use(async (m) => {
  const table = Array.from({ length: 2350 }, (_, i) => ({ id: 'f' + String(i).padStart(4, '0') }))
  const read = async (rows, cap = 1000, onPage) => {
    const seen = new Set()
    let calls = 0
    const get = (from, to) => { const page = rows.slice(from, Math.min(to + 1, from + cap)); calls++; onPage?.(calls, rows); return Promise.resolve({ data: page, error: null }) }
    const err = await m.pages(get, (rs) => { for (const r of rs) seen.add(r.id) })
    return { seen: seen.size, calls, err }
  }
  eq('2,350 filas de mil en mil: llegan todas', await read(table).then((r) => [r.seen, r.err]), [2350, null])
  eq('aunque el servidor dé solo 500 por vez', (await read(table, 500)).seen, 2350)
  eq('una lista corta: una sola pregunta', await read(table.slice(0, 40)).then((r) => [r.seen, r.calls]), [40, 1])
  eq('una lista vacía', await read([]).then((r) => [r.seen, r.calls, r.err]), [0, 1, null])
  // while the listing is being read someone saves: that row moves to the end and the rest shift by one
  eq('una fila que se mueve mientras se lee no hace perder otra', (await read(table.map((x) => ({ ...x })), 1000, (n, rows) => { if (n === 1) rows.push(rows.splice(5, 1)[0]) })).seen, 2350)
  eq('un error se devuelve, no se disimula', await m.pages(() => Promise.resolve({ data: null, error: { code: 'X', message: 'sin señal' } }), () => {}), { code: 'X', message: 'sin señal' })
})

section('Qué se le pide al servidor')
calc.use((m) => {
  const ask = (table, narrow) => decodeURIComponent(narrow(m.supabase.from(table).select('*')).url.search)
  const first = m.firstPull('2026-09-27')
  const day = (d, plus = 0) => new Date(new Date(d + 'T00:00:00').getTime() + plus * 24 * 60 * M).toISOString()
  eq('primera vez: corridas de los días que guarda, o todavía abiertas', ask('act_runs', first.act_runs), '?select=*&or=(date.gte.2026-09-27,ended_at.is.null)')
  eq('primera vez: paros desde un día antes, o todavía abiertos', ask('act_stops', first.act_stops), '?select=*&or=(started_at.gte."' + day('2026-09-27', -1) + '",ended_at.is.null)')
  eq('primera vez: historial y programa de esos días', [ask('act_changes', first.act_changes), ask('act_schedule', first.act_schedule)], ['?select=*&at=gte.' + day('2026-09-27', -1), '?select=*&date=gte.2026-09-27'])
  eq('primera vez: líneas, productos y metas, completos', [first.act_lines, first.act_products, first.act_targets].map((f) => f === undefined), [true, true, true])
  eq('un día viejo: sus corridas, los paros de alrededor, su historial y su programa', Object.fromEntries(m.dayPull('2026-09-01').map(([t, narrow]) => [t, ask(t, narrow)])), {
    act_runs: '?select=*&date=eq.2026-09-01',
    act_stops: '?select=*&started_at=gte.' + day('2026-09-01', -1) + '&started_at=lt.' + day('2026-09-01', 2),
    act_changes: '?select=*&at=gte.' + day('2026-09-01') + '&at=lt.' + day('2026-09-01', 1),
    act_schedule: '?select=*&date=eq.2026-09-01',
  })
})

// =====================================================================================================================
console.log('')
if (failed.length) { console.log(failed.length + ' FALLARON de ' + (passed + failed.length) + ':\n'); for (const f of failed) console.log('  ✗ ' + f + '\n'); process.exit(1) }
console.log('✓ ' + passed + ' comprobaciones, todas correctas')
process.exit(0)
