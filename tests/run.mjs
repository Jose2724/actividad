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

// The suite's clock starts at 3:00 PM, the very minute the first shift ends with the usual hours, and the time between
// two shifts does not count. So its devices work with hours that leave no minute between the shifts (with the same
// hand-overs, 3:15 PM and 3:30 AM): what each test measures is not touched by the change of shift. The tests of the
// shifts themselves ask for the usual hours ({ usual: true }).
const NO_GAP = { from: '2000-01-01', first: '03:30', firstEnd: '15:15', second: '15:15', secondEnd: '03:30', updatedAt: 0 }
async function device(name, { seed, user = name, usual = false } = {}) {
  on = name
  if (!seed && !usual) seed = { lines: [], runs: [], stops: [], products: [], schedule: {}, changes: [], targets: [], shifts: [NO_GAP] }
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
  m.setSchedule('2026-10-04', 'Z9', 0)
  eq('un código en 0 y sin nada hecho no es una fila; mientras se escribe su número, sí', [m.avanceRows(m.store.get(), '2026-10-04').length, m.avanceRows(m.store.get(), '2026-10-04', new Set(['Z9'])).map((r) => [r.code, r.scheduled])], [0, [['Z9', 0]]])
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
//  4. The names of the lines, and the QR code
// =====================================================================================================================
clock = T0
section('Nombres de las líneas')
const names = await device('names', { user: 'Santiago' })
names.use((m) => {
  const st = () => m.store.get()
  const list = (dept = 'RTE') => st().lines.filter((l) => l.dept === dept).sort(m.byLineName).map((l) => l.name)
  const idOf = (name, dept = 'RTE') => st().lines.find((l) => l.dept === dept && l.name === name).id
  eq('sin decir nombre toma el primero libre', [m.addLine('RTE'), m.addLine('RTE'), list()], [true, true, ['Línea 1', 'Línea 2']])
  m.removeLine(idOf('Línea 1')); m.addLine('RTE')
  eq('al quitar la 1 y agregar otra, es la 1 de nuevo y no una segunda "Línea 2"', list(), ['Línea 1', 'Línea 2'])
  eq('nombres libres que se ofrecen', [m.freeLineNames(st(), 'RTE', 3), m.freeLineNames(st(), 'Kitchen', 2)], [['Línea 3', 'Línea 4', 'Línea 5'], ['Braiser 1', 'Braiser 2']])
  eq('con el nombre elegido, limpio de espacios', [m.addLine('RTE', '  Línea   4 '), list()], [true, ['Línea 1', 'Línea 2', 'Línea 4']])
  eq('un nombre repetido se rechaza aunque cambien mayúsculas, acentos o espacios; uno en blanco también', [m.addLine('RTE', 'LINEA  2'), m.addLine('RTE', '   '), list().length], [false, false, 3])
  eq('el mismo nombre en otro departamento sí vale', [m.addLine('Packing', 'Línea 2'), list('Packing')], [true, ['Línea 2']])
  eq('"Línea 10" va después de "Línea 2"', [m.addLine('RTE', 'Línea 10'), list()], [true, ['Línea 1', 'Línea 2', 'Línea 4', 'Línea 10']])
  eq('un nombre larguísimo se corta', m.tidyLineName('x'.repeat(40)).length, m.LINE_NAME_MAX)

  // line "Línea 1" is really the plant's line 2, and the other way round (what happened on Friday)
  const A = idOf('Línea 1'), B = idOf('Línea 2')
  const line = (id) => st().lines.find((l) => l.id === id)
  clock = T0 + 10 * M; m.startRun(line(A), 'A100', '6283', DAY, 240); const done = st().runs.at(-1).id
  clock = T0 + 20 * M; m.unitDone(done, 240); clock = T0 + 30 * M; m.endRun(done)
  clock = T0 + 40 * M; m.startRun(line(A), 'B200', '6283', DAY, 144); const open = st().runs.at(-1).id
  clock = T0 + 50 * M; m.unitDone(open, 144)
  const before = (({ startedAt, endedAt, units }) => ({ startedAt, endedAt, units }))(st().runs.find((r) => r.id === done))
  clock = T0 + 60 * M
  eq('renombrar a un nombre que tiene otra línea se rechaza', [m.renameLine(A, 'linea 2'), m.renameLine(A, ' '), line(A).name], [false, false, 'Línea 1'])
  eq('la línea que ya tiene ese nombre', m.lineNamed(st(), 'RTE', 'línea 2', A)?.id, B)
  eq('intercambiar nombres', [m.swapLineNames(A, B), line(A).name, line(B).name], [true, 'Línea 2', 'Línea 1'])
  const run = (id) => st().runs.find((r) => r.id === id)
  eq('lo ya terminado en esa línea lleva el nombre nuevo', [run(done).line, m.lineNameOf(st(), run(done).lineId, run(done).line)], ['Línea 2', 'Línea 2'])
  eq('lo que está corriendo lo muestra ya, y lo guarda en cuanto se toca', [m.lineNameOf(st(), run(open).lineId, run(open).line), run(open).line], ['Línea 2', 'Línea 1'])
  clock = T0 + 61 * M; m.unitDone(open, 144)
  eq('al marcar el siguiente carro queda guardado', run(open).line, 'Línea 2')
  eq('los tiempos y carros de lo registrado no cambian', (({ startedAt, endedAt, units }) => ({ startedAt, endedAt, units }))(run(done)), before)
  eq('el total del departamento nombra la línea como se llama ahora', m.deptToday(st(), 'RTE', DAY, clock).byCode.map((c) => [c.code, c.lines]), [['B200', ['Línea 2']], ['A100', ['Línea 2']]])
  eq('queda en el historial quién cambió qué', st().changes.filter((c) => c.what === 'Línea renombrada en RTE').map((c) => [c.before, c.after, c.by]), [['Línea 1', 'Línea 2', 'Santiago'], ['Línea 2', 'Línea 1', 'Santiago']])
  clock = T0 + 5 * 60 * M
  eq('renombrar con un nombre libre', [m.renameLine(B, 'Línea de sándwich'), list()], [true, ['Línea 2', 'Línea 4', 'Línea 10', 'Línea de sándwich']])
  eq('guardar el mismo nombre no hace nada', [m.renameLine(B, 'Línea de sándwich'), st().changes.filter((c) => c.what === 'Línea renombrada en RTE').length], [true, 3])
  // a line that is removed: its records keep the name they had
  m.endRun(open); m.removeLine(A)
  eq('si luego se quita la línea, lo registrado conserva su nombre', [run(done), run(open)].map((r) => m.lineNameOf(st(), r.lineId, r.line)), ['Línea 2', 'Línea 2'])
})
clock = T0 + 6 * 60 * M
{
  // on another device: the manager renames the tablet's line, with a finished run and one running on it
  const { id, base } = newRun(2)
  tab.use((m) => m.endRun(id)); settle()
  const { id: running } = newRun(1)
  const lineId = runOn(tab, id).lineId
  clock += M; mgr.use((m) => m.renameLine(lineId, 'Línea 7')); settle()
  eq('el nombre nuevo llega a la tablet: la línea, lo terminado y lo que corre', tab.use((m) => { const s = m.store.get(); return [s.lines.find((l) => l.id === lineId).name, runOn(tab, id).line, m.lineNameOf(s, lineId, runOn(tab, running).line)] }), ['Línea 7', 'Línea 7', 'Línea 7'])
  clock += M; tab.use((m) => m.unitDone(running, 240)); settle()
  agreed('y la tablet sigue marcando sin perder nada', running, { units: [...cartsAt(runOn(tab, running).startedAt, [10]), [Math.round((clock - T0) / M), 240]], waste: 0, code: 'A100', ended: false })
  eq('con el nombre nuevo guardado en la corrida', [runOn(tab, running).line, runOn(mgr, running).line, server.get('act_runs|' + running).line], ['Línea 7', 'Línea 7', 'Línea 7'])
  void base
}

section('Código QR')
await calc.use(async (m) => {
  // the 15 "format" bits beside the top-left corner only make a valid word when the code is the right way round
  const valid = (q, flip) => {
    const dark = new Set([...q.d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((x) => (Number(x[1]) - 4) + ',' + (Number(x[2]) - 4)))
    const at = (x, y) => dark.has(flip ? y + ',' + x : x + ',' + y)
    const bits = [...[0, 1, 2, 3, 4, 5].map((x) => at(x, 8)), at(7, 8), at(8, 8), at(8, 7), ...[5, 4, 3, 2, 1, 0].map((y) => at(8, y))]
    let v = parseInt(bits.map((b) => (b ? 1 : 0)).join(''), 2) ^ 0x5412
    const level = v >> 13
    for (let i = 14; i >= 10; i--) if ((v >> i) & 1) v ^= 0x537 << (i - 10)
    return v === 0 && level === 0 // 0 = medium error correction, the one asked for
  }
  for (const url of ['https://ejemplo.test/', 'https://ejemplo.test/actividad/']) {
    const q = await m.qrPath(url)
    const xs = [...q.d.matchAll(/M(\d+) (\d+)h/g)].flatMap((x) => [Number(x[1]), Number(x[2])])
    eq('código de ' + url + ': derecho, no volteado', [valid(q, false), valid(q, true)], [true, false])
    eq('con su margen blanco de 4 módulos alrededor', [Math.min(...xs), Math.max(...xs)], [4, q.size - 5])
  }
})

// =====================================================================================================================
//  5. The day of work: starting it, tidying what was left open, wiping tests
// =====================================================================================================================
section('Empezar el día')
const oct = (d, h, mi = 0) => new Date(2026, 9, d, h, mi, 0).getTime() // a moment of October 2026
const dayDev = await device('day', { user: 'Santiago' })
dayDev.use((m) => {
  const st = () => m.store.get()
  const run = (id) => st().runs.find((x) => x.id === id), stop = (id) => st().stops.find((x) => x.id === id)
  clock = T0
  eq('sin empezarlo, el día es el del calendario', m.workDay(st()), { date: DAY, started: null })
  for (const n of [1, 2, 3]) m.applyRemote('act_lines', { id: 'L' + n, dept: 'RTE', name: 'Línea ' + n, deleted: false, updated_at: iso(oct(1, 8)) })
  // left from earlier days: a line stopped and abandoned on the 8th, one started on the 9th and never used, and the whole room "stopped" since the 9th
  m.applyRemote('act_runs', runRow({ id: 'quedo-parada', lineId: 'L1', date: '2026-10-08', startedAt: oct(8, 15), units: [unit(oct(8, 16), 240), unit(oct(8, 17, 30), 240)], perUnit: 240 }))
  m.applyRemote('act_stops', stopRow({ id: 'su-paro', lineId: 'L1', startedAt: oct(8, 18), endedAt: null, reason: 'Limpieza' }))
  m.applyRemote('act_runs', runRow({ id: 'quedo-sin-uso', lineId: 'L2', line: 'Línea 2', date: '2026-10-09', startedAt: oct(9, 15), units: [], perUnit: 240 }))
  m.applyRemote('act_stops', stopRow({ id: 'paro-de-todos', lineId: null, startedAt: oct(9, 20), endedAt: null }))
  // today, before the real start: tests (one still running), with a correction; and a real change to a product
  m.applyRemote('act_runs', runRow({ id: 'prueba-1', lineId: 'L3', line: 'Línea 3', date: DAY, startedAt: oct(10, 9), endedAt: oct(10, 10), units: [unit(oct(10, 9, 30), 240)], perUnit: 240 }))
  m.applyRemote('act_runs', runRow({ id: 'prueba-2', lineId: 'L3', line: 'Línea 3', date: DAY, startedAt: oct(10, 14), units: [unit(oct(10, 14, 30), 240)], perUnit: 240 }))
  m.applyRemote('act_stops', stopRow({ id: 'paro-de-prueba', lineId: 'L3', startedAt: oct(10, 9, 40), endedAt: oct(10, 9, 50) }))
  m.applyRemote('act_products', productRow('A100', 'Producto', 8, 18.5, 24, 10, 36, oct(1, 8)))
  clock = oct(10, 14, 40)
  m.updateRun('prueba-1', { lot: '9999' })
  m.saveProduct(0, { ...st().products[0], casesPerMix: 19 })
  clock = T0
  // a line of yesterday's date that had a cart an hour ago is really running: it is not "left"
  m.applyRemote('act_runs', runRow({ id: 'sigue-de-verdad', lineId: 'L3', line: 'Línea 3', date: '2026-10-09', startedAt: oct(9, 22), units: [unit(oct(10, 14, 10), 240)], perUnit: 240 }))
  eq('lo que quedó corriendo de días anteriores, sin nada registrado en seis horas', m.leftOpen(st(), DAY, clock).map((r) => r.id).sort(), ['quedo-parada', 'quedo-sin-uso'])
  eq('lo registrado hoy antes de empezar', (({ runs, stops }) => [runs.map((r) => r.id).sort(), stops.map((x) => x.id)])(m.dayRecords(st(), DAY, clock)), [['prueba-1', 'prueba-2'], ['paro-de-prueba']])
  eq('lo que hace al empezar', m.startDay(clock, { finishLeft: true, purge: true }), { date: DAY, ended: 2, runs: 2, stops: 1 })
  eq('la línea que quedó parada se termina cuando la pararon, no "ahora"', [run('quedo-parada').endedAt, stop('su-paro').endedAt], [oct(8, 18), oct(8, 18)])
  eq('la que no llegó a usarse se termina donde empezó', run('quedo-sin-uso').endedAt, oct(9, 15))
  eq('la que sigue de verdad no se toca', run('sigue-de-verdad').endedAt, null)
  eq('el paro de todo el departamento se cierra sin sumar horas', stop('paro-de-todos').endedAt, oct(9, 20))
  eq('las pruebas de hoy ya no están', [run('prueba-1'), run('prueba-2'), stop('paro-de-prueba')].map((x) => !!x), [false, false, false])
  eq('se van con sus correcciones; lo que se configuró hoy conserva su historial', st().changes.filter((c) => m.dayOf(c.at) === DAY).map((c) => c.refTable).sort(), ['act_days', 'act_days:purge', 'act_products', 'act_runs', 'act_runs', 'act_stops', 'act_stops'])
  eq('queda escrito qué se borró y quién', st().changes.filter((c) => c.refTable === 'act_days:purge').map((c) => [c.before, c.by]), [['2 corridas · 1 paro', 'Santiago']])
  eq('el día queda empezado', m.workDay(st()), { date: DAY, started: { at: T0, by: 'Santiago' } })
  eq('y hoy arranca en cero', m.deptToday(st(), 'RTE', m.workDay(st()).date, clock).qty, 0)
  clock = oct(11, 0, 30); eq('pasada la medianoche sigue siendo el mismo día', m.workDay(st()).date, DAY)
  clock = oct(11, 3, 29); eq('hasta que el segundo turno entrega al primero (3:30 de la mañana)', m.workDay(st()).date, DAY)
  clock = oct(11, 5, 50); eq('el primer turno que entra un poco antes de su hora ya tiene su fecha', m.workDay(st()), { date: '2026-10-11', started: null })
  clock = oct(11, 6, 0); eq('a las 6 vuelve a ser el día del calendario', m.workDay(st()), { date: '2026-10-11', started: null })
  clock = oct(11, 14, 45)
  eq('empezar el día siguiente, sin nada que ordenar', m.startDay(clock), { date: '2026-10-11', ended: 0, runs: 0, stops: 0 })
  m.startDay(oct(11, 14, 0), { date: '2026-10-11' })
  eq('cambiar la hora de inicio no crea otro día', [st().changes.filter((c) => c.refTable === 'act_days').map((c) => c.id).sort(), m.workDay(st()).started.at, st().changes.find((c) => c.id === 'day:2026-10-11').before], [['day:2026-10-10', 'day:2026-10-11'], oct(11, 14, 0), m.fmtTime(oct(11, 14, 45))])
  clock = oct(11, 13, 0); eq('una hora de inicio que todavía no llega, todavía no cuenta', m.workDay(st()), { date: '2026-10-11', started: null })
  clock = oct(11, 15, 0); m.cancelDay('2026-10-11')
  eq('quitar el inicio devuelve el día del calendario', m.workDay(st()), { date: '2026-10-11', started: null })
  // wiping a whole day of tests
  m.applyRemote('act_runs', runRow({ id: 'p5a', lineId: 'L1', date: '2026-10-05', startedAt: oct(5, 9), endedAt: oct(5, 10) }))
  m.applyRemote('act_runs', runRow({ id: 'p5b', lineId: 'L2', date: '2026-10-05', startedAt: oct(5, 11), endedAt: oct(5, 12) }))
  m.applyRemote('act_stops', stopRow({ id: 'p5s', lineId: 'L1', startedAt: oct(5, 9, 10), endedAt: oct(5, 9, 20) }))
  const others = st().runs.length - 2
  eq('borrar un día entero de pruebas', [m.purgeDay('2026-10-05'), st().runs.length, m.dayRecords(st(), '2026-10-05')], [{ runs: 2, stops: 1 }, others, { runs: [], stops: [] }])
  const lines = st().changes.length
  eq('un día sin nada no borra ni escribe nada', [m.purgeDay('2026-01-01'), st().changes.length], [{ runs: 0, stops: 0 }, lines])
})
{
  // the manager starts the day and wipes a test: every tablet follows
  clock = oct(10, 22, 0)
  const { id } = newRun(1)
  const at = clock
  mgr.use((m) => m.startDay(at)); settle()
  eq('la tablet sigue el día que empezó el manager', tab.use((m) => m.workDay(m.store.get())), { date: DAY, started: { at, by: 'Santiago' } })
  clock += M
  mgr.use((m) => m.purgeDay(DAY)); settle()
  eq('lo que el manager borra desaparece también de la tablet y no vuelve', [!!runOn(tab, id), !!runOn(mgr, id), tab.use((m) => m.store.get().runs.filter((r) => r.date === DAY).length), all.map((d) => d.use((m) => m.outbox.size()))], [false, false, 0, [0, 0]])
}

// =====================================================================================================================
//  Words of each department
// =====================================================================================================================
section('Lo que dice el botón al guardar')
calc.use((m) => {
  eq('cada departamento lo dice con su palabra', m.DEPTS.map((d) => m.savedText(d, 12)), ['Mezcla 12 guardada', 'Carro 12 guardado', 'Mezcla 12 guardada', 'Bin 12 guardado', 'Pallet 12 guardado'])
  eq('y ninguno se queda sin ella', m.DEPTS.filter((d) => !m.CFG[d].saved || !m.CFG[d].done || !m.CFG[d].unit), [])
})

// =====================================================================================================================
//  6. One clock for every device: the server's
// =====================================================================================================================
section('La hora del servidor')
calc.use((m) => {
  // a device asks the server the time eight times. The server stamps each answer with its own time, to the second.
  // `truth` is how far the device's clock is from the server's (server − device, ms); the trips up and down take
  // different, uneven times, as on a real network
  const ask = (truth, n = 8, seed = 7) => {
    let x = seed
    const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648 }
    const out = []
    let device = 1_791_700_000_333
    for (let i = 0; i < n; i++) {
      const up = 30 + rnd() * 90, down = 30 + rnd() * 90
      out.push({ server: Math.floor((device + up + truth) / 1000) * 1000, mid: device + (up + down) / 2, rtt: up + down })
      device += up + down + 137
    }
    return out
  }
  for (const [what, truth] of [['1.1 segundos adelantado, como tu PC', -1102], ['en hora', 0], ['4 segundos atrasado', 4321], ['5 minutos adelantado, puesto a mano', -305_000], ['un día entero corrido', 86_400_017]]) {
    for (const seed of [7, 11, 23]) {
      const e = m.estimate(ask(truth, 8, seed))
      eq('un aparato ' + what + ': se mide bien, con menos de un cuarto de segundo de margen', [e !== null && Math.abs(e.offset - truth) <= e.within + 1, e !== null && e.within <= 250], [true, true])
    }
  }
  eq('con muy pocas respuestas no se decide nada', m.estimate(ask(-1102, 2)), null)
  const jumped = [...ask(-1102, 4), ...ask(6000, 4, 9)]
  eq('si el reloj del aparato cambió mientras se medía, tampoco', m.estimate(jumped), null)
  eq('la zona de la planta va 4 horas detrás de la hora universal en verano y 5 en invierno', [m.zoneMinutes('America/New_York', Date.UTC(2026, 9, 11, 12)), m.zoneMinutes('America/New_York', Date.UTC(2026, 0, 15, 12))], [-240, -300])
  eq('otras zonas se distinguen', [m.zoneMinutes('UTC', Date.UTC(2026, 9, 11, 12)), m.zoneMinutes('America/Los_Angeles', Date.UTC(2026, 9, 11, 12)), m.zoneMinutes('America/Santo_Domingo', Date.UTC(2026, 0, 15, 12))], [0, -420, -240])
  eq('la misma zona preguntada muchas veces da siempre lo mismo', [1, 2, 3].map(() => m.zoneMinutes('America/New_York', Date.UTC(2026, 9, 11, 12))), [-240, -240, -240])
  eq('el cambio de hora de noviembre se nota a la hora justa', [m.zoneMinutes('America/New_York', Date.UTC(2026, 10, 1, 5, 59)), m.zoneMinutes('America/New_York', Date.UTC(2026, 10, 1, 6, 0))], [-240, -300])
  eq('un reloj corrido menos de un minuto no se menciona', [m.clockOffText(0), m.clockOffText(-1102), m.clockOffText(59_000)], ['', '', ''])
  eq('uno corrido más, sí: cuánto y hacia dónde', [m.clockOffText(-305_000), m.clockOffText(240_000), m.clockOffText(-3 * 3_600_000), m.clockOffText(9_000_000), m.clockOffText(3 * 86_400_017)], ['5 min adelantado', '4 min atrasado', '3 h adelantado', '2,5 h atrasado', '3 días atrasado'])
})
const clk = await device('clk', { user: 'Nino' })
clk.use((m) => {
  clock = T0
  eq('sin medir todavía, vale el reloj del aparato', [m.clockOffset(), m.clockNow()], [0, T0])
  m.setOffset(-1102)
  eq('medido: la hora es la del aparato más la diferencia', [m.clockOffset(), m.clockNow()], [-1102, T0 - 1102])
  m.setOffset(-1150)
  eq('una diferencia menor que la precisión de la medida no mueve los contadores', m.clockOffset(), -1102)
  eq('se recuerda para la próxima vez que se abra la app, también sin señal', JSON.parse(localStorage.getItem('act_clock')).offset, -1102)
  // everything recorded carries the shared time, not the device's
  m.addLine('RTE'); m.startRun(m.store.get().lines[0], 'A100', '6283', DAY, 240)
  const id = m.store.get().runs[0].id, run = () => m.store.get().runs[0]
  clock = T0 + 10 * M; m.unitDone(id, 240)
  eq('el inicio y el carro llevan la hora del servidor', [run().startedAt, run().units[0].at, run().updatedAt], [T0 - 1102, T0 + 10 * M - 1102, T0 + 10 * M - 1102])
  eq('el día de trabajo también se decide con ella', m.workDay(m.store.get()).date, DAY)
  // the clock is corrected 9 seconds back between two taps: what is recorded still goes forward
  m.setOffset(-10_102)
  clock = T0 + 10 * M + 2000; m.unitDone(id, 240)
  eq('si la hora se corrige hacia atrás entre dos toques, lo registrado no retrocede', run().units[1].at > run().units[0].at, true)
  m.endRun(id)
  eq('y el fin nunca queda antes del último carro', run().endedAt >= run().units[1].at, true)
  m.startStop('RTE', null, 'Break', ''); m.setOffset(-30_000); m.endStop(m.store.get().stops[0].id)
  eq('ni el fin de un paro antes de su inicio', m.store.get().stops[0].endedAt >= m.store.get().stops[0].startedAt, true)
})
clock = T0

// =====================================================================================================================
//  Leaving, and coming back
// =====================================================================================================================
section('Salir pide confirmación')
calc.use((m) => {
  const ask = (state, pending, online = true) => m.leaveAsk({ state, pending }, online)
  eq('normal: pregunta, y dice que hay que volver a entrar', [ask('online', 0).title, /usuario y el PIN/.test(ask('online', 0).text), ask('online', 0).yes, ask('online', 0).danger], ['¿Salir de Actividad?', true, 'Salir', false])
  eq('con registros sin subir: dice cuántos y que espere', [ask('online', 3).title, /Hay 3 registros que no han llegado/.test(ask('online', 3).text), /Sincronizado/.test(ask('online', 3).text), ask('online', 3).yes, ask('online', 3).danger], ['Todavía hay registros sin subir', true, true, 'Salir de todos modos', true])
  eq('uno solo, en singular', /Hay 1 registro que no ha llegado/.test(ask('online', 1).text), true)
  eq('sin señal y con registros: que no salga hasta que vuelva', [/no hay señal/.test(ask('offline', 2).text), /No salgas/.test(ask('offline', 2).text), ask('offline', 2).danger], [true, true, true])
  eq('sin señal y sin nada pendiente: avisa que no podrá volver a entrar', [ask('offline', 0).title, /no vas a poder entrar otra vez/.test(ask('offline', 0).text), ask('offline', 0).yes, ask('offline', 0).danger], ['¿Salir sin señal?', true, 'Salir de todos modos', true])
  eq('el aparato dice que no hay red aunque la app todavía no lo notó', [ask('online', 0, false).title, /No salgas/.test(ask('connecting', 4, false).text)], ['¿Salir sin señal?', true])
  eq('sesión cerrada con registros: que vuelva a entrar para que suban', [/la sesión se cerró/.test(ask('signedOut', 2).text), ask('signedOut', 2).yes, ask('signedOut', 2).danger], [true, 'Salir', false])
  eq('en el demo pregunta por cambiar de usuario, haya lo que haya', [ask('local', 0).title, ask('local', 0).yes, ask('local', 5, false).title, ask('local', 5, false).danger], ['¿Cambiar de usuario?', 'Cambiar', '¿Cambiar de usuario?', false])
})
section('El usuario queda escrito para la próxima vez; el PIN no lo guarda la app')
const mem = await device('mem')
mem.use((m) => {
  eq('al principio no hay ninguno', m.rememberedUser(), '')
  m.rememberUser('  Maria.RTE ')
  eq('queda el usuario, limpio', m.rememberedUser(), 'maria.rte')
  m.rememberUser('alguien@correo.example')
  eq('un correo no se deja escrito en un aparato que puede ser compartido', m.rememberedUser(), 'maria.rte')
  m.rememberUser('   ')
  eq('uno vacío no borra el que había', m.rememberedUser(), 'maria.rte')
  m.rememberUser('pedro.packing')
  eq('quien entra después pasa a ser el recordado', m.rememberedUser(), 'pedro.packing')
  eq('y en el aparato solo queda eso: un nombre de usuario', [...disk()].filter(([k]) => /last_user/.test(k)), [['act_last_user', 'pedro.packing']])
})

// =====================================================================================================================
//  Empleados: a row only shows what the person looking may really do to it
// =====================================================================================================================
section('Empleados: no se dibuja lo que el servidor rechaza')
calc.use((m) => {
  const owner = { id: 'o', user_id: 'uo', username: null } // the owner signs in with an e-mail, not a user name
  const boss = { id: 'b', user_id: 'ub', username: 'jefe.turno' } // another manager
  const oper = { id: 'p', user_id: 'up', username: 'maria.rte' }
  const noAccount = { id: 'n', user_id: null, username: null }
  // answers in this order: change the role, change the PIN, turn on / off
  const can = (row, me, admin = false) => { const r = m.rowRights(row, me, admin); return [r.role, r.pin, r.active].map((x) => (x ? 'sí' : 'no')).join(' ') + (r.locked ? ' protegida' : '') + (r.mine ? ' mía' : '') }
  eq('otro manager no puede hacer nada con la cuenta del dueño', can(owner, 'b'), 'no no no protegida')
  eq('el dueño en su propia fila: puede cambiar su rol, no desactivarse', can(owner, 'o', true), 'sí no no mía')
  eq('un manager en su propia fila: su PIN sí; su rol y desactivarse, no', can(boss, 'b'), 'no sí no mía')
  eq('con la fila de otro manager o de un operador: todo', [can(boss, 'x'), can(oper, 'b'), can(boss, 'o', true)], ['sí sí sí', 'sí sí sí', 'sí sí sí'])
  eq('una persona sin cuenta: rol y activar; no hay PIN que cambiar', can(noAccount, 'b'), 'sí no sí')
  eq('si no se sabe quién mira, la cuenta del dueño sigue protegida', can(owner, ''), 'no no no protegida')
})

// =====================================================================================================================
//  When is it "no connection"
// =====================================================================================================================
section('Sin conexión: cómo lo dice cada navegador')
calc.use((m) => {
  eq('una petición que no llegó a ninguna parte', ['TypeError: Failed to fetch', 'TypeError: Load failed', 'TypeError: NetworkError when attempting to fetch resource.', 'TypeError: fetch failed', 'TypeError: Failed to fetch [act_runs]'].map((t) => m.unreachable(t)), [true, true, true, true, true])
  eq('una petición que se dejó de esperar', ['AbortError: signal is aborted without reason', 'AbortError: The operation was aborted.', 'AbortError: Fetch is aborted [act_runs]', 'The user aborted a request.'].map((t) => m.unreachable(t)), [true, true, true, true])
  eq('una respuesta del servidor con un error no es falta de conexión', ['42501 new row violates row-level security policy for table "act_runs" [act_runs]', 'Falta ejecutar en Supabase el SQL de act_targets', 'JWT expired', '', null, undefined].map((t) => m.unreachable(t)), [false, false, false, false, false, false])
})

// =====================================================================================================================
//  Sending the report
// =====================================================================================================================
section('Enviar reporte: qué deja compartir cada navegador')
calc.use((m) => {
  const takes = (...ok) => (files) => files.every((f) => ok.includes(f)) // a browser that shares only these kinds of file
  eq('iPhone (Safari): PDF y Excel juntos', [m.sharePick(takes('pdf', 'xlsx', 'csv')).files, m.sharePick(takes('pdf', 'xlsx', 'csv')).label, m.sharePick(takes('pdf', 'xlsx', 'csv')).note], [['pdf', 'xlsx'], 'Compartir PDF y Excel', ''])
  eq('Chrome (tablet Android, PC): no acepta Excel; van PDF y CSV, y se dice', [m.sharePick(takes('pdf', 'csv')).files, m.sharePick(takes('pdf', 'csv')).label, /también se abre con Excel/.test(m.sharePick(takes('pdf', 'csv')).note)], [['pdf', 'csv'], 'Compartir PDF y CSV', true])
  eq('un navegador que solo acepta el PDF', [m.sharePick(takes('pdf')).files, m.sharePick(takes('pdf')).label], [['pdf'], 'Compartir PDF'])
  eq('uno que no comparte archivos: solo se ofrecen las descargas', m.sharePick(() => false), null)
  eq('si preguntarle al navegador da error, tampoco se ofrece', m.sharePick(() => { throw new Error('x') }), null)
  eq('cerrar la hoja de compartir no es un problema', m.shareProblem({ name: 'AbortError' }), '')
  eq('que el aparato no la abra, sí: se dice qué hacer', [/Descarga los archivos/.test(m.shareProblem({ name: 'NotAllowedError' })), /Descarga los archivos/.test(m.shareProblem(new Error('x'))), /Descarga los archivos/.test(m.shareProblem(null))], [true, true, true])
  eq('iPhone con la app en la pantalla de inicio: el PDF se descarga en vez de abrir pestaña', [m.homeScreenApple({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', standalone: true }), m.homeScreenApple({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', standalone: false }), m.homeScreenApple({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5, standalone: true }), m.homeScreenApple({ userAgent: 'Mozilla/5.0 (Linux; Android 14)', standalone: undefined }), m.homeScreenApple({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)' })], [true, false, true, false, false])
})
section('El Excel se hace al instante cuando su librería ya bajó')
{
  const sheets = [{ name: 'Resumen', rows: [['Código', 'Hechas'], ['A100', 12]] }]
  const before = calc.use((m) => m.xlsxNow(sheets))
  const bytes = await calc.use(async (m) => { await m.loadZip(); return m.xlsxNow(sheets) })
  eq('antes de bajar la librería no hay archivo; después sale al instante y es un zip de verdad', [before, bytes instanceof Uint8Array, bytes[0], bytes[1]], [null, true, 0x50, 0x4b])
  const same = await calc.use((m) => m.xlsxBytes(sheets))
  eq('y es el mismo archivo que hace el botón de Excel', [same.length === bytes.length, same.length > 500], [true, true])
}

// =====================================================================================================================
//  A stop with two causes
// =====================================================================================================================
section('Dividir un paro en dos causas')
const cut = await device('cut', { user: 'Santiago' })
cut.use((m) => {
  const st = () => m.store.get()
  clock = T0
  m.addLine('RTE', 'Línea 1')
  const line = st().lines[0]
  m.startRun(line, 'A100', '6283', DAY, 240)
  const run = () => st().runs[0]
  clock = T0 + 10 * M; m.startStop('RTE', line.id, 'Limpieza', '')
  const first = () => st().stops.find((x) => x.reason === 'Limpieza')
  clock = T0 + 70 * M; m.endStop(first().id)
  clock = T0 + 90 * M
  const before = m.runStats(st(), run(), clock)
  eq('antes: una hora parada por limpieza', [before.down / M, before.reasons], [60, { Limpieza: 60 * M }])
  const id = m.splitStop(first().id, T0 + 30 * M, 'Máquina / mantenimiento', 'banda rota')
  const second = () => st().stops.find((x) => x.id === id)
  eq('quedan dos paros seguidos, sin hueco ni cruce', [st().stops.length, first().startedAt, first().endedAt, second().startedAt, second().endedAt], [2, T0 + 10 * M, T0 + 30 * M, T0 + 30 * M, T0 + 70 * M])
  eq('el segundo lleva su causa, su detalle y quién lo dividió', [second().reason, second().note, second().by, second().lineId === line.id, second().dept], ['Máquina / mantenimiento', 'banda rota', 'Santiago', true, 'RTE'])
  const after = m.runStats(st(), run(), clock)
  eq('el tiempo parado de la línea no cambia; solo se reparte', [after.down / M, after.working === before.working, after.reasons], [60, true, { Limpieza: 20 * M, 'Máquina / mantenimiento': 40 * M }])
  eq('queda escrito en el historial', st().changes.filter((c) => /Se dividió/.test(c.what)).map((c) => [c.by, c.before, c.after]), [['Santiago', 'Limpieza ' + m.fmtTime(T0 + 10 * M) + '–' + m.fmtTime(T0 + 70 * M), 'Limpieza ' + m.fmtTime(T0 + 10 * M) + '–' + m.fmtTime(T0 + 30 * M) + ' + Máquina / mantenimiento ' + m.fmtTime(T0 + 30 * M) + '–' + m.fmtTime(T0 + 70 * M)]])
  eq('una parte se puede volver a dividir: tres causas', [!!m.splitStop(id, T0 + 50 * M, 'Break'), st().stops.length, m.runStats(st(), run(), clock).reasons], [true, 3, { Limpieza: 20 * M, 'Máquina / mantenimiento': 20 * M, Break: 20 * M }])
  eq('una hora fuera del paro, o sin causa, no divide nada', [m.splitStop(first().id, T0 + 5 * M, 'Break'), m.splitStop(first().id, T0 + 30 * M, 'Break'), m.splitStop(first().id, T0 + 10 * M, 'Break'), m.splitStop(first().id, T0 + 20 * M, '  '), m.splitStop('no-existe', T0 + 20 * M, 'Break'), st().stops.length], ['', '', '', '', '', 3])
  // a stop still running: the cause changed a while ago, and the line is still stopped
  clock = T0 + 100 * M; m.startStop('RTE', line.id, 'Falta de carrito vacío', '')
  const open = () => st().stops.find((x) => x.reason === 'Falta de carrito vacío')
  clock = T0 + 130 * M
  const rest = m.splitStop(open().id, T0 + 110 * M, 'Falta de personal')
  eq('un paro en curso se divide y la línea sigue parada, ahora por la segunda causa', [open().endedAt, st().stops.find((x) => x.id === rest).endedAt, m.openStop(st(), 'RTE', line.id)?.reason], [T0 + 110 * M, null, 'Falta de personal'])
  eq('y no se puede cortar en un momento que todavía no llega', m.splitStop(rest, T0 + 200 * M, 'Break'), '')
  clock = T0 + 140 * M; m.endStop(rest)
  eq('al reanudar se cierra la segunda parte', [st().stops.find((x) => x.id === rest).endedAt, m.openStop(st(), 'RTE', line.id)], [T0 + 140 * M, undefined])
})
{
  // the manager divides a stop from the office: the tablet on the line sees both parts
  clock = T0 + 300 * M
  const lineId = tab.use((m) => m.store.get().lines.find((l) => l.dept === 'RTE')?.id)
  tab.use((m) => m.startStop('RTE', lineId, 'Limpieza', '')); settle()
  const sid = tab.use((m) => m.store.get().stops.find((x) => !x.endedAt && x.reason === 'Limpieza').id)
  clock += 40 * M
  tab.use((m) => m.endStop(sid)); settle()
  const at = clock - 15 * M
  const newId = mgr.use((m) => m.splitStop(sid, at, 'Break')); settle()
  eq('la tablet recibe las dos partes del paro que dividió el manager', tab.use((m) => { const st = m.store.get().stops; const a = st.find((x) => x.id === sid), b = st.find((x) => x.id === newId); return [a.endedAt, b.startedAt, b.endedAt, b.reason] }), [at, at, clock, 'Break'])
  eq('y nada queda pendiente de subir', all.map((d) => d.use((m) => m.outbox.size())), [0, 0])
}

// =====================================================================================================================
//  A pallet with more than one lot; the report filtered by code and by lot
// =====================================================================================================================
section('Un pallet con más de un lote')
const pal = await device('pal', { user: 'Nino' })
pal.use((m) => {
  const st = () => m.store.get(), run = () => st().runs[0]
  clock = T0
  m.addLine('Packing', 'Línea 1')
  m.startRun(st().lines[0], 'A100', '6283', DAY, 36)
  clock = T0 + 10 * M; m.unitDone(run().id, 36, '1749') // all of it of the run's lot
  clock = T0 + 20 * M; m.unitDone(run().id, 0, '1750', [{ lot: '6283', qty: 20 }, { lot: '6284', qty: 16 }])
  clock = T0 + 30 * M; m.unitDone(run().id, 30, '1751', [{ lot: ' 6284 ', qty: 30 }, { lot: '', qty: 5 }, { lot: '6285', qty: 0 }])
  eq('Packing es el departamento que lleva lotes por pallet', m.DEPTS.filter((d) => m.CFG[d].lots), ['Packing'])
  eq('el pallet de un solo lote no lleva lista de lotes', [run().units[0].qty, run().units[0].lots], [36, undefined])
  eq('el de dos lotes guarda cada uno, y su cantidad es la suma', [run().units[1].qty, run().units[1].lots], [36, [{ lot: '6283', qty: 20 }, { lot: '6284', qty: 16 }]])
  eq('solo se guardan lotes de verdad (con número y con cajas)', [run().units[2].qty, run().units[2].lots], [30, [{ lot: '6284', qty: 30 }]])
  eq('el total de la corrida se cuenta igual que siempre', [m.runQty(st(), run()), m.runStats(st(), run(), clock).qty], [102, 102])
  eq('va al servidor con sus lotes', m.outbox.items().filter((i) => i.table === 'act_runs').pop().row.units.map((u) => u.lots ?? null), [null, [{ lot: '6283', qty: 20 }, { lot: '6284', qty: 16 }], [{ lot: '6284', qty: 30 }]])
  const rep = m.reportOf(st(), DAY, clock)
  eq('el reporte ofrece los códigos y los lotes del día para filtrar', [rep.codes, rep.lots, rep.filtered], [['A100'], ['6283', '6284'], false])
  eq('sin filtro: una línea por cada lote de cada pallet', rep.unitRows.map((x) => [x.i + 1, x.lot, x.qty, x.mixed]), [[1, '6283', 36, false], [2, '6283', 20, true], [2, '6284', 16, true], [3, '6284', 30, false]])
  eq('y los totales de siempre', [rep.rows[0].units, rep.rows[0].qty, rep.byCode[0].units, rep.byCode[0].qty], [3, 102, 3, 102])
  eq('la corrida dice todos los lotes que tocó; filtrada, el lote elegido', [rep.rows[0].lots, m.reportOf(st(), DAY, clock, { lot: '6284' }).rows[0].lots], ['6283, 6284', '6284'])
  const a = m.reportOf(st(), DAY, clock, { lot: '6283' }), b = m.reportOf(st(), DAY, clock, { lot: '6284' })
  eq('filtrado por el lote 6283: sus pallets, y de cada uno solo sus cajas', [a.filtered, a.lot, a.rows[0].units, a.rows[0].qty, a.unitRows.map((x) => [x.i + 1, x.qty])], [true, '6283', 2, 56, [[1, 36], [2, 20]]])
  eq('filtrado por el lote 6284', [b.rows[0].units, b.rows[0].qty, b.unitRows.map((x) => [x.i + 1, x.qty]), b.byCode[0].qty, m.madeText(b.rows[0].view, b.rows[0].qty, true)], [2, 46, [[2, 16], [3, 30]], 46, '2 pallets · 46 cajas (tag 1750, 1751)'])
  eq('lo de un lote más lo del otro da el total', a.rows[0].qty + b.rows[0].qty, 102)
  const none = m.reportOf(st(), DAY, clock, { lot: '9999', code: 'ZZZ' })
  eq('un lote o un código que ese día no tiene es como no filtrar', [none.filtered, none.lot, none.code, none.rows.length], [false, '', '', 1])
  // the lots of a pallet corrected from the form
  const opened = m.draftOf(run())
  const draft = { ...opened, units: opened.units.map((u, i) => (i === 0 ? { ...u, lots: [{ lot: '6283', qty: 30 }, { lot: '6282', qty: 6 }] } : i === 1 ? { at: u.at, qty: '40', ref: u.ref, by: u.by } : u)) }
  clock = T0 + 40 * M
  m.applyDraft(run().id, opened, draft)
  eq('corregir: al primero se le ponen dos lotes; al segundo se le quitan y vuelve al lote de la corrida', [run().units[0].lots, run().units[0].qty, 'lots' in run().units[1], run().units[1].qty, run().units[2].lots], [[{ lot: '6283', qty: 30 }, { lot: '6282', qty: 6 }], 36, false, 40, [{ lot: '6284', qty: 30 }]])
  eq('y queda en el historial', st().changes.filter((c) => /lotes/.test(c.what)).map((c) => [c.before, c.after]).sort(), [['', '6283: 30 + 6282: 6'], ['6283: 20 + 6284: 16', '']])
  eq('abrir y guardar el formulario sin tocar nada no cambia los lotes', (() => { const o = m.draftOf(run()); const was = JSON.stringify(run().units); m.applyDraft(run().id, o, o); return JSON.stringify(run().units) === was })(), true)
})
{
  // a pallet with two lots recorded on a tablet: the manager sees its lots, corrects them, and the tablet follows
  clock = T0 + 400 * M
  tab.use((m) => { m.addLine('Packing', 'Línea 1') }); settle()
  const pline = tab.use((m) => m.store.get().lines.find((l) => l.dept === 'Packing'))
  tab.use((m) => m.startRun(pline, 'B200', '6283', DAY, 36)); settle()
  const rid = tab.use((m) => m.store.get().runs.find((r) => r.code === 'B200').id)
  clock += M
  tab.use((m) => m.unitDone(rid, 0, '900', [{ lot: '6283', qty: 10 }, { lot: '6284', qty: 26 }])); settle()
  const unitOn = (d) => d.use((m) => m.store.get().runs.find((r) => r.id === rid).units[0])
  eq('el manager ve los lotes del pallet que registró la tablet', [unitOn(mgr).lots, unitOn(mgr).qty], [[{ lot: '6283', qty: 10 }, { lot: '6284', qty: 26 }], 36])
  clock += M
  mgr.use((m) => { const r = m.store.get().runs.find((x) => x.id === rid), o = m.draftOf(r); m.applyDraft(rid, o, { ...o, units: o.units.map((u) => ({ ...u, lots: [{ lot: '6283', qty: 12 }, { lot: '6284', qty: 24 }] })) }) }); settle()
  eq('lo que corrige el manager llega a la tablet', [unitOn(tab).lots, unitOn(tab).qty, all.map((d) => d.use((m) => m.outbox.size()))], [[{ lot: '6283', qty: 12 }, { lot: '6284', qty: 24 }], 36, [0, 0]])
  clock += M
  tab.use((m) => m.unitDone(rid, 36, '901')); settle()
  eq('otro pallet tocado después no borra los lotes del anterior', [unitOn(mgr).lots, mgr.use((m) => m.store.get().runs.find((r) => r.id === rid).units.length)], [[{ lot: '6283', qty: 12 }, { lot: '6284', qty: 24 }], 2])
}
section('Reporte filtrado por código')
const fil = await device('fil', { user: 'Santiago' })
fil.use((m) => {
  const st = () => m.store.get()
  clock = T0
  m.addLine('RTE', 'Línea 1'); m.addLine('RTE', 'Línea 2')
  const [l1, l2] = st().lines.slice().sort((a, b) => a.name.localeCompare(b.name))
  m.startRun(l1, 'A100', '6283', DAY, 240); m.startRun(l2, '0200', '6284', DAY, 240)
  const r1 = st().runs.find((r) => r.code === 'A100'), r2 = st().runs.find((r) => r.code === '0200')
  clock = T0 + 10 * M; m.unitDone(r1.id, 240); m.unitDone(r2.id, 240)
  clock = T0 + 20 * M; m.unitDone(r1.id, 200)
  clock = T0 + 25 * M; m.startStop('RTE', l1.id, 'Limpieza', ''); clock = T0 + 35 * M; m.endStop(st().stops.find((x) => x.reason === 'Limpieza').id)
  clock = T0 + 40 * M; m.startStop('RTE', l2.id, 'Break', ''); clock = T0 + 45 * M; m.endStop(st().stops.find((x) => x.reason === 'Break').id)
  clock = T0 + 50 * M; m.endRun(r1.id)
  clock = T0 + 55 * M; m.startStop('RTE', l1.id, 'Falta de personal', ''); clock = T0 + 58 * M; m.endStop(st().stops.find((x) => x.reason === 'Falta de personal').id)
  clock = T0 + 60 * M
  const full = m.reportOf(st(), DAY, clock)
  eq('el día completo: dos códigos, tres paros', [full.rows.map((x) => x.r.code), full.stops.map((x) => x.reason), full.codes, full.lots], [['A100', '0200'], ['Limpieza', 'Break', 'Falta de personal'], ['0200', 'A100'], ['6283', '6284']])
  const a = m.reportOf(st(), DAY, clock, { code: 'A100' })
  eq('filtrado por A100: solo su corrida, sus carros y su total', [a.filtered, a.code, a.rows.map((x) => [x.r.code, x.units, x.qty]), a.byCode.map((c) => [c.code, c.qty]), a.unitRows.length], [true, 'A100', [['A100', 2, 440]], [['A100', 440]], 2])
  eq('y solo los paros que pasaron mientras ese código corría en su línea', a.stops.map((x) => x.reason), ['Limpieza'])
  eq('trabajando y parado son los de ese código', [a.working === a.rows[0].st.working, a.down / M], [true, 10])
  const b = m.reportOf(st(), DAY, clock, { code: '200' })
  eq('0200 y 200 son el mismo código también al filtrar', [b.code, b.rows.map((x) => x.r.code), b.stops.map((x) => x.reason)], ['0200', ['0200'], ['Break']])
  const both = m.reportOf(st(), DAY, clock, { code: 'A100', lot: '6284' })
  eq('código y lote a la vez: tienen que cumplirse los dos', [both.filtered, both.rows.length, both.unitRows.length, both.stops.length], [true, 0, 0, 0])
  eq('solo un departamento, como lo ve su operador', [m.reportOf(st(), DAY, clock, { only: 'Packing' }).rows.length, m.reportOf(st(), DAY, clock, { only: 'RTE', code: 'A100' }).rows.length], [0, 1])
  eq('el nombre de los archivos y el título dicen el filtro', [m.filterFile('A100', '6283'), m.filterTitle('A100', '6283'), m.filterFile('', ''), m.filterTitle('', '6284'), m.filterFile('zx 01/2', '')], ['-cod-A100-lote-6283', ' · código A100 · lote 6283', '', ' · lote 6284', '-cod-zx-01-2'])
})

// =====================================================================================================================
//  The set up between two codes: a stop that starts when a code ends
// =====================================================================================================================
section('Set up: un paro que empieza al terminar un código')
const sup = await device('sup', { user: 'Nino' })
sup.use((m) => {
  const st = () => m.store.get()
  clock = T0
  m.addLine('RTE', 'Línea 1'); m.addLine('RTE', 'Línea 2')
  const [l1, l2] = st().lines.slice().sort((a, b) => a.name.localeCompare(b.name))
  const runOf = (code) => st().runs.find((r) => r.code === code)
  const open = () => st().stops.filter((x) => !x.endedAt)
  m.startRun(l1, 'A100', '6283', DAY, 240)
  clock = T0 + 30 * M; m.unitDone(runOf('A100').id, 240)
  clock = T0 + 60 * M; m.endRun(runOf('A100').id, true)
  eq('al terminar el código empieza un paro de Set up, abierto', open().map((x) => [x.reason, x.lineId === l1.id, x.dept, x.startedAt, x.note, x.by]), [['Set up', true, 'RTE', T0 + 60 * M, 'Después de A100', 'Nino']])
  clock = T0 + 70 * M
  eq('la línea, sin código, está parada por Set up; la otra línea no', [m.idleStop(st(), l1.id, clock)?.reason, m.idleStop(st(), l2.id, clock)], ['Set up', undefined])
  eq('mientras espera el código siguiente está en la tarjeta y no en el reporte: con la línea vacía no corre nada', [m.reportOf(st(), DAY, clock).stops.length, m.reportOf(st(), DAY, clock).setup, m.reportOf(st(), DAY, clock + 30 * M).setup], [0, 0, 0])
  // the manager divides it while it is still counting: the last minutes were a break
  const id = open()[0].id
  const rest = m.splitStop(id, T0 + 64 * M, 'Break')
  eq('se puede dividir en curso: el Set up se cierra y la otra causa sigue contando', [st().stops.find((x) => x.id === id).endedAt, st().stops.find((x) => x.id === rest).reason, m.idleStop(st(), l1.id, clock)?.reason], [T0 + 64 * M, 'Break', 'Break'])
  eq('lo que el manager cerró al dividir ya cuenta (lo dijo una persona); el resto sigue esperando', m.reportOf(st(), DAY, clock).stops.map((x) => [x.reason, (x.endedAt - x.startedAt) / M]), [['Set up', 4]])
  clock = T0 + 75 * M; m.startRun(l1, '0200', '6283', DAY, 240)
  eq('al empezar el código siguiente entra al reporte todo lo que esperaba', [m.reportOf(st(), DAY, clock).stops.map((x) => [x.reason, x.ms / M]).sort(), m.reportOf(st(), DAY, clock).setup / M], [[['Break', 11], ['Set up', 4]], 4])
  eq('al empezar el siguiente código se cierra lo que estaba contando', [open().length, st().stops.map((x) => [x.reason, (x.endedAt - x.startedAt) / M]).sort()], [0, [['Break', 11], ['Set up', 4]]])
  eq('ese tiempo no cuenta como parado de ninguno de los dos códigos', st().runs.map((r) => m.runStats(st(), r, clock).down), [0, 0])
  // without dividing: the detail says from which code to which
  clock = T0 + 100 * M; m.endRun(runOf('0200').id, true)
  clock = T0 + 112 * M; m.startRun(l1, '0300', '6283', DAY, 240)
  eq('sin dividir: un Set up del fin de uno al inicio del otro, con los dos códigos en el detalle', st().stops.filter((x) => x.note === 'De 0200 a 0300').map((x) => [x.reason, x.startedAt, x.endedAt]), [['Set up', T0 + 100 * M, T0 + 112 * M]])
  // seconds are not a set up
  clock = T0 + 120 * M; m.endRun(runOf('0300').id, true)
  clock = T0 + 120 * M + 20_000; m.startRun(l1, '0400', '6283', DAY, 240)
  eq('menos de un minuto entre dos códigos no deja un Set up', st().stops.filter((x) => x.reason === 'Set up').length, 2)
  // the last code of the shift
  clock = T0 + 150 * M; m.endRun(runOf('0400').id, false)
  eq('el último código del turno, sin Set up: nada queda abierto', [open().length, m.idleStop(st(), l1.id, clock)], [0, undefined])
  // "another code is coming" was said and none came
  m.startRun(l2, 'B100', '6283', DAY, 240); clock = T0 + 160 * M; m.endRun(runOf('B100').id, true)
  const before = open().length
  m.dropSetup(open()[0].id)
  eq('si al final no viene otro código, se quita', [before, open().length, st().changes.filter((c) => /Set up|borr/i.test(c.what)).length], [1, 0, 0])
  m.startRun(l2, 'B200', '6283', DAY, 240); clock = T0 + 170 * M; m.endRun(runOf('B200').id, true)
  clock = T0 + 170 * M + 7 * 60 * M
  eq('uno olvidado deja de contar a las horas: ni en la línea ni en el reporte', [m.idleStop(st(), l2.id, clock), m.reportOf(st(), DAY, clock).stops.filter((x) => !x.endedAt).length], [undefined, 0])
  m.startRun(l2, 'B300', '6283', DAY, 240)
  eq('y empezar un código entonces lo descarta, no lo cierra con siete horas', [open().length, st().stops.filter((x) => x.reason === 'Set up' && x.lineId === l2.id).length], [0, 0])
  // a code ended by mistake and reopened
  clock += 10 * M; m.endRun(runOf('B300').id, true)
  const counting = open().length
  m.updateRun(runOf('B300').id, { endedAt: null })
  eq('reabrir un código quita el Set up que había empezado', [counting, open().length, runOf('B300').endedAt], [1, 0, null])
  // the last unit registered at the end
  clock += 9 * M; m.unitDone(runOf('B300').id, 180); m.endRun(runOf('B300').id, true)
  eq('registrar la última unidad y terminar: la unidad queda dentro, el fin después de ella, y el Set up desde ese fin', [runOf('B300').units.length, runOf('B300').endedAt > runOf('B300').units[0].at, open()[0].startedAt === runOf('B300').endedAt], [1, true, true])
  m.endRun(runOf('B300').id, true)
  eq('terminar dos veces no abre dos Set up', open().length, 1)
})
const hl = await device('hl', { user: 'Nino' })
hl.use((m) => {
  // the tablet that starts the next code had not heard of the set up yet (no signal, or an older version of the app)
  clock = T0
  m.addLine('RTE', 'Línea 1')
  const l = m.store.get().lines[0]
  clock = T0 + 20 * M; m.startRun(l, 'A100', '6283', DAY, 240)
  m.applyRemote('act_stops', stopRow({ id: 'tardio', lineId: l.id, startedAt: T0 + 5 * M, endedAt: null, reason: 'Set up', note: 'Después de Z900' }))
  eq('un Set up abierto que llega tarde a una línea que ya corre se cierra donde empezó el código', [m.store.get().stops.find((x) => x.id === 'tardio')?.endedAt, m.openStop(m.store.get(), 'RTE', l.id)], [T0 + 20 * M, undefined])
  clock = T0 + 40 * M; m.startStop('RTE', l.id, 'Limpieza', '')
  eq('un paro normal de la línea, puesto mientras corre, no se toca', m.openStop(m.store.get(), 'RTE', l.id)?.reason, 'Limpieza')
})
{
  // one tablet ends the code, another starts the next one: both see the set up, and both see it end
  clock = T0 + 600 * M
  const rte = tab.use((m) => m.store.get().lines.find((l) => l.dept === 'RTE'))
  const running = tab.use((m) => m.store.get().runs.find((r) => r.lineId === rte.id && !r.endedAt))
  if (running) { tab.use((m) => m.endRun(running.id)); settle() }
  clock += M
  tab.use((m) => m.startRun(rte, 'C300', '6283', DAY, 240)); settle()
  const cid = tab.use((m) => m.store.get().runs.find((r) => r.code === 'C300').id)
  clock += 20 * M
  tab.use((m) => m.endRun(cid, true)); settle()
  eq('el manager ve en curso el Set up que empezó en la tablet', mgr.use((m) => m.store.get().stops.filter((x) => x.reason === m.SETUP && !x.endedAt).map((x) => x.note)), ['Después de C300'])
  clock += 12 * M
  mgr.use((m) => m.startRun(rte, 'C400', '6283', DAY, 240)); settle()
  const seen = (d) => d.use((m) => m.store.get().stops.filter((x) => x.reason === m.SETUP && x.note === 'De C300 a C400').map((x) => (x.endedAt - x.startedAt) / M))
  eq('una tablet termina y otra empieza: el Set up se cierra una sola vez y lo ven las dos', [seen(tab), seen(mgr), all.map((d) => d.use((m) => m.store.get().stops.filter((x) => !x.endedAt && x.lineId === rte.id).length)), all.map((d) => d.use((m) => m.outbox.size()))], [[12], [12], [0, 0], [0, 0]])
}

// =====================================================================================================================
//  A cart that came out short; the set up by hand
// =====================================================================================================================
section('Carro incompleto: cajas y sueltos, y completarlo después')
const sho = await device('sho', { user: 'Nino' })
sho.use((m) => {
  const st = () => m.store.get(), runOf = (code, n = 0) => st().runs.filter((r) => r.code === code)[n]
  clock = T0
  m.saveProduct(st().products.length, { code: 'A100', name: 'Producto de prueba', pouchesPerCase: 12, casesPerMix: 18.5, cratesPerCart: 24, pouchesPerCrate: 10, casesPerPallet: 36, updatedAt: 0 })
  eq('pouches en cajas completas y sueltos, por los pouches por caja de la tabla', [m.casesText(m.inCases(st(), 'A100', 130)), m.casesText(m.inCases(st(), 'A100', 240)), m.casesText(m.inCases(st(), 'A100', 13)), m.casesText(m.inCases(st(), 'A100', 5)), m.casesText(m.inCases(st(), 'A100', 0))], ['10 cajas y 10 sueltos', '20 cajas', '1 caja y 1 suelto', '0 cajas y 5 sueltos', '0 cajas'])
  eq('si la tabla no dice cuántos van por caja, no se inventa', [m.inCases(st(), 'NO-ESTA', 130), m.casesText(null), m.inCases(st(), 'A100', null)], [null, '', null])
  m.addLine('RTE', 'Línea 1')
  const line = st().lines[0]
  m.startRun(line, 'A100', '6283', DAY, 240)
  eq('sin carros todavía no hay nada que completar', m.shortUnit(st(), runOf('A100')), null)
  clock = T0 + 20 * M; m.unitDone(runOf('A100').id, 240)
  eq('un carro completo no se ofrece para completar', m.shortUnit(st(), runOf('A100')), null)
  clock = T0 + 35 * M; m.unitDone(runOf('A100').id, 130) // closed short: they thought the code was over
  const sh = m.shortUnit(st(), runOf('A100'))
  eq('el último carro, cerrado con menos de lo usual, se puede completar', [sh.index + 1, sh.unit.qty, sh.usual, sh.run.id === runOf('A100').id], [2, 130, 240, true])
  clock = T0 + 50 * M
  m.fillUnit(sh.run.id, sh.unit.at, 240)
  eq('completarlo sube su cantidad: sigue siendo el mismo carro, no uno más', [runOf('A100').units.length, runOf('A100').units[1].qty, runOf('A100').units[1].at, m.runQty(st(), runOf('A100'))], [2, 240, T0 + 35 * M, 480])
  eq('queda en el historial quién y cuánto', st().changes.filter((c) => /Carro 2 · cantidad/.test(c.what)).map((c) => [c.by, c.before, c.after]), [['Nino', '130', '240']])
  eq('ya completo, deja de ofrecerse', m.shortUnit(st(), runOf('A100')), null)
  // the code ends with a short cart; later the same code and lot comes back and goes on top of that cart
  clock = T0 + 60 * M; m.unitDone(runOf('A100').id, 100); m.endRun(runOf('A100').id, true)
  clock = T0 + 90 * M; m.startRun(line, 'A100', '6283', DAY, 240)
  const again = m.shortUnit(st(), runOf('A100', 1))
  eq('vuelve el mismo código y lote: se ofrece completar el carro que quedó corto antes', [again.run.id === runOf('A100', 0).id, again.index + 1, again.unit.qty], [true, 3, 100])
  m.fillUnit(again.run.id, again.unit.at, 180)
  eq('se completa en la corrida de antes', [runOf('A100', 0).units[2].qty, runOf('A100', 1).units.length], [180, 0])
  clock = T0 + 95 * M; m.unitDone(runOf('A100', 1).id, 240)
  eq('con un carro nuevo ya registrado, el de antes no se ofrece más', m.shortUnit(st(), runOf('A100', 1)), null)
  m.endRun(runOf('A100', 1).id); m.startRun(line, 'A100', '6284', DAY, 240)
  eq('otro lote del mismo código no mezcla carros', m.shortUnit(st(), st().runs.find((r) => r.lot === '6284')), null)
})
section('Carro incompleto de un código ya terminado, y código terminado por error')
const fin = await device('fin', { user: 'Nino' })
fin.use((m) => {
  const st = () => m.store.get(), runOf = (code) => st().runs.find((r) => r.code === code)
  const open = () => st().stops.filter((x) => !x.endedAt)
  clock = T0
  m.addLine('RTE', 'Línea 1'); m.addLine('RTE', 'Línea 2')
  const [l1, l2] = st().lines.slice().sort((a, b) => a.name.localeCompare(b.name))
  eq('una línea sin nada terminado hoy no ofrece nada', [m.lastEnded(st(), l1.id, DAY), m.shortEnded(st(), l1.id, DAY)], [undefined, []])
  m.startRun(l1, 'A100', '6283', DAY, 240)
  clock = T0 + 20 * M; m.unitDone(runOf('A100').id, 240)
  clock = T0 + 35 * M; m.unitDone(runOf('A100').id, 100)
  eq('mientras el código corre, su carro corto no sale entre los terminados', m.shortEnded(st(), l1.id, DAY), [])
  clock = T0 + 40 * M; m.endRun(runOf('A100').id, true)
  eq('terminado el código con el último carro corto: es el último código de la línea y se puede completar', [m.lastEnded(st(), l1.id, DAY).code, m.shortEnded(st(), l1.id, DAY).map((x) => [x.run.code, x.index + 1, x.unit.qty, x.usual])], ['A100', [['A100', 2, 100, 240]]])
  eq('la otra línea no lo ofrece', [m.lastEnded(st(), l2.id, DAY), m.shortEnded(st(), l2.id, DAY)], [undefined, []])
  // the line goes on to another code, and then more of the first one turns up for its last cart
  clock = T0 + 50 * M; m.startRun(l1, 'B200', '6283', DAY, 240)
  eq('el código nuevo no tiene carro propio que completar', m.shortUnit(st(), runOf('B200')), null)
  const old = m.shortEnded(st(), l1.id, DAY)[0]
  clock = T0 + 55 * M; m.fillUnit(old.run.id, old.unit.at, 180)
  eq('con otro código ya corriendo, se completa el carro del código terminado: mismo carro, el código sigue terminado y su fin no se mueve', [runOf('A100').units.map((u) => u.qty), runOf('A100').endedAt, runOf('B200').units.length, m.runQty(st(), runOf('A100'))], [[240, 180], T0 + 40 * M, 0, 420])
  eq('queda en el historial con el código y la línea', st().changes.filter((c) => /Corrida A100 .*Línea 1.*Carro 2 · cantidad/.test(c.what)).map((c) => [c.by, c.before, c.after]), [['Nino', '100', '180']])
  eq('sigue corto: se puede volver a completar', m.shortEnded(st(), l1.id, DAY).map((x) => x.unit.qty), [180])
  m.fillUnit(old.run.id, old.unit.at, 240)
  eq('lleno, deja de ofrecerse', m.shortEnded(st(), l1.id, DAY), [])
  // two codes ended short on the same line: both are offered, the newest first
  clock = T0 + 70 * M; m.unitDone(runOf('B200').id, 60); m.endRun(runOf('B200').id, true)
  m.updateRun(runOf('A100').id, { units: runOf('A100').units.map((u, i) => (i === 1 ? { ...u, qty: 100 } : u)) })
  eq('dos códigos terminados con carro corto: salen los dos, el más reciente primero', m.shortEnded(st(), l1.id, DAY).map((x) => x.run.code), ['B200', 'A100'])
  eq('de otro día no sale ninguno', [m.shortEnded(st(), l1.id, '2099-01-01'), m.lastEnded(st(), l1.id, '2099-01-01')], [[], undefined])
  // marked as finished by mistake: it goes on
  clock = T0 + 75 * M
  eq('el código se marcó terminado y empezó a contar el Set up', [m.lastEnded(st(), l1.id, DAY).code, open().map((x) => x.reason)], ['B200', ['Set up']])
  eq('se sigue con él: vuelve a correr y el Set up que había empezado se quita', [m.reopenRun(runOf('B200').id), runOf('B200').endedAt, open().length, m.openRun(st(), l1.id).code], [true, null, 0, 'B200'])
  eq('ya corriendo, su carro corto se completa con el botón de la línea', [m.shortUnit(st(), runOf('B200')).unit.qty, m.shortEnded(st(), l1.id, DAY).map((x) => x.run.code)], [60, ['A100']])
  eq('reabrirlo queda en el historial', st().changes.filter((c) => /Corrida B200 .*Fin/.test(c.what)).map((c) => c.after), ['en curso'])
  eq('con otro código corriendo en la línea, el anterior no se reabre', [m.reopenRun(runOf('A100').id), !!runOf('A100').endedAt], [false, true])
  eq('un código que no está terminado no se "reabre"', m.reopenRun(runOf('B200').id), false)
})
{
  // Packing: the pallet closed short carries its lots; filling it can change them and its tag
  const pk = await device('pk', { user: 'Nino' })
  pk.use((m) => {
    const st = () => m.store.get()
    clock = T0
    m.addLine('Packing', 'Línea 1')
    const l = st().lines[0]
    m.startRun(l, 'A100', '6283', DAY, 36)
    clock = T0 + 10 * M; m.unitDone(st().runs[0].id, 20, '1749')
    clock = T0 + 15 * M; m.endRun(st().runs[0].id)
    const sh = m.shortEnded(st(), l.id, DAY)[0]
    m.fillUnit(sh.run.id, sh.unit.at, 0, [{ lot: '6283', qty: 20 }, { lot: '6284', qty: 16 }], '1750')
    eq('un pallet corto de un código terminado se completa con otro lote: la cantidad es la suma y el tag se puede cambiar', [st().runs[0].units[0].qty, m.lotsText(st().runs[0].units[0].lots), st().runs[0].units[0].ref, m.shortEnded(st(), l.id, DAY)], [36, '6283: 20 + 6284: 16', '1750', []])
  })
}
section('Parar: tres causas y "Otra"')
const qk = await device('qk', { user: 'Nino' })
qk.use((m) => {
  const st = () => m.store.get()
  eq('"Parar" ofrece tres causas en cada departamento', m.DEPTS.map((d) => m.CFG[d].quick.length), [3, 3, 3, 3, 3])
  eq('las de RTE: lo mecánico, el plástico y el break', m.CFG.RTE.quick, ['Problema mecánico', 'Sin plástico', 'Break'])
  eq('las tres están también en la lista completa, al principio, y "Otra" no es una causa guardada', m.DEPTS.map((d) => [m.CFG[d].reasons.slice(0, 3).join() === m.CFG[d].quick.join(), m.CFG[d].reasons.includes('Otra'), new Set(m.CFG[d].reasons).size === m.CFG[d].reasons.length]), m.DEPTS.map(() => [true, false, true]))
  eq('una causa escrita a mano que ya es del departamento se guarda con su nombre de siempre', [m.tidyReason('RTE', 'break'), m.tidyReason('RTE', ' SET-UP '), m.tidyReason('RTE', 'setup'), m.tidyReason('RTE', 'sin plastico'), m.tidyReason('RTE', 'LIMPIEZA')], ['Break', 'Set up', 'Set up', 'Sin plástico', 'Limpieza'])
  eq('una que no está en la lista queda como se escribió, sin espacios de más', [m.tidyReason('RTE', '  Se rompió   la banda '), m.tidyReason('RTE', 'Falta de salsa'), m.tidyReason('RTE', ''), m.tidyReason('Kitchen', 'sin plastico')], ['Se rompió la banda', 'Falta de salsa', '', 'sin plastico'])
  clock = T0
  m.addLine('RTE', 'Línea 1')
  const line = st().lines[0]
  m.startRun(line, 'A100', '6283', DAY, 240)
  clock = T0 + 10 * M; m.startStop('RTE', line.id, 'setup', '')
  clock = T0 + 15 * M; m.endStop(st().stops[0].id)
  eq('"setup" escrito en "Otra" se guarda como Set up: cuenta donde cuenta el Set up', st().stops.map((x) => [x.reason, (x.endedAt - x.startedAt) / M]), [['Set up', 5]])
  clock = T0 + 20 * M; m.startStop('RTE', line.id, 'Se rompió la banda', '')
  clock = T0 + 50 * M; m.endStop(st().stops[1].id)
  const rest = m.splitStop(st().stops[1].id, T0 + 30 * M, 'break')
  m.updateStop(st().stops[1].id, { reason: 'problema mecanico' })
  eq('y lo mismo al dividir y al corregir un paro', [st().stops.find((x) => x.id === rest).reason, st().stops[1].reason], ['Break', 'Problema mecánico'])
})
section('Set up a mano')
const man = await device('man', { user: 'Santiago' })
man.use((m) => {
  const st = () => m.store.get(), open = () => st().stops.filter((x) => !x.endedAt)
  eq('"Set up" está en la lista completa de causas de todos los departamentos (la de corregir y dividir)', m.DEPTS.map((d) => m.CFG[d].reasons.includes('Set up')), [true, true, true, true, true])
  clock = T0
  m.addLine('RTE', 'Línea 1')
  const line = st().lines[0]
  m.startSetup(line)
  eq('se puede poner el Set up a mano en una línea sin código', open().map((x) => [x.reason, x.lineId === line.id, x.startedAt, x.by]), [['Set up', true, T0, 'Santiago']])
  m.startSetup(line)
  eq('ponerlo dos veces no abre dos', open().length, 1)
  clock = T0 + 15 * M; m.endStop(open()[0].id)
  eq('y pararlo a mano: queda como un paro de 15 minutos', [open().length, st().stops.map((x) => [x.reason, (x.endedAt - x.startedAt) / M])], [0, [['Set up', 15]]])
  clock = T0 + 20 * M; m.startRun(line, 'A100', '6283', DAY, 240)
  m.startSetup(line)
  eq('con un código corriendo no se pone así (para eso está "Parar" con la razón Set up)', open().length, 0)
  clock = T0 + 30 * M; m.startStop('RTE', line.id, 'Set up', '')
  clock = T0 + 40 * M; m.endStop(open()[0].id)
  eq('un Set up puesto con "Parar" mientras corre cuenta como parado de ese código', [m.runStats(st(), st().runs[0], clock).down / M, m.runStats(st(), st().runs[0], clock).reasons], [10, { 'Set up': 10 * M }])
  clock = T0 + 50 * M; m.endRun(st().runs[0].id, false)
  m.startSetup(line)
  eq('puesto a mano después de un código, dice después de cuál', open().map((x) => x.note), ['Después de A100'])
})

// =====================================================================================================================
//  The two shifts
// =====================================================================================================================
section('Turnos: el horario')
const USUAL = { first: '06:00', firstEnd: '15:00', second: '15:30', secondEnd: '01:00' }
const hrs = (x) => [x.first, x.firstEnd, x.second, x.secondEnd]
const sh1 = await device('sh1', { user: 'Santiago', usual: true })
sh1.use((m) => {
  const st = () => m.store.get()
  clock = T0
  eq('mientras nadie lo cambie: turno 1 de 6:00 a 3:00 y turno 2 de 3:30 a 1:00', [hrs(m.shiftsOf(st(), DAY)), m.shiftsText(m.shiftsOf(st(), DAY))], [['06:00', '15:00', '15:30', '01:00'], 'Turno 1 de 6:00 AM a 3:00 PM · Turno 2 de 3:30 PM a 1:00 AM'])
  eq('el corte entre turnos es la mitad del rato entre uno y otro: 3:15 PM y 3:30 AM', [m.shiftCuts(USUAL), m.minuteText(m.shiftCuts(USUAL).toSecond), m.minuteText(m.shiftCuts(USUAL).toFirst)], [{ toSecond: 915, toFirst: 210 }, '3:15 PM', '3:30 AM'])
  eq('a qué turno cuenta cada momento, por su hora', [[10, 6, 0], [10, 15, 14], [10, 15, 15], [10, 23, 59], [11, 0, 30], [11, 3, 29], [11, 3, 30], [11, 5, 50]].map(([d, h, mi]) => m.shiftAt(USUAL, oct(d, h, mi))), [1, 1, 2, 2, 2, 2, 1, 1])
  eq('un rato que pasa de un turno al otro se parte en el corte', m.shiftPieces(USUAL, oct(10, 14, 0), oct(10, 17, 0)).map((x) => [x.shift, (x.to - x.from) / M]), [[1, 75], [2, 105]])
  eq('y de noche, donde el turno 2 entrega al turno 1', m.shiftPieces(USUAL, oct(10, 23, 0), oct(11, 7, 0)).map((x) => [x.shift, (x.to - x.from) / M]), [[2, 270], [1, 210]])
  eq('un rato dentro de un solo turno no se parte; uno vacío no da nada', [m.shiftPieces(USUAL, oct(10, 8, 0), oct(10, 9, 0)).length, m.shiftPieces(USUAL, oct(10, 9, 0), oct(10, 9, 0)).length], [1, 0])
  eq('horas que no tienen sentido no se aceptan', [m.shiftsProblem(USUAL), m.shiftsProblem({ ...USUAL, firstEnd: '16:00' }) !== '', m.shiftsProblem({ ...USUAL, second: '' }), m.shiftsProblem({ first: '06:00', firstEnd: '18:00', second: '18:00', secondEnd: '06:00' }), m.shiftsProblem({ ...USUAL, secondEnd: '07:00' }) !== ''], ['', true, 'Falta una hora.', '', true])
  // the plant moves its shifts: from a date on
  const NEW = { first: '05:00', firstEnd: '13:30', second: '14:00', secondEnd: '22:30' }
  eq('el manager cambia el horario desde una fecha', m.setShifts('2026-10-20', NEW), true)
  eq('los días de antes siguen con el horario que tenían; desde esa fecha, el nuevo', [hrs(m.shiftsOf(st(), DAY)), hrs(m.shiftsOf(st(), '2026-10-19')), hrs(m.shiftsOf(st(), '2026-10-20')), hrs(m.shiftsOf(st(), '2026-11-05'))], [hrs(USUAL), hrs(USUAL), hrs(NEW), hrs(NEW)])
  eq('queda en el historial quién, y de qué a qué', st().changes.filter((c) => c.what === 'Horario de turnos desde el 2026-10-20').map((c) => [c.by, c.dept, c.before, c.after]), [['Santiago', null, 'Turno 1 de 6:00 AM a 3:00 PM · Turno 2 de 3:30 PM a 1:00 AM', 'Turno 1 de 5:00 AM a 1:30 PM · Turno 2 de 2:00 PM a 10:30 PM']])
  eq('sube al servidor con las metas del manager (act_targets), en números', m.outbox.items().filter((i) => i.table === 'act_targets').map((i) => [i.key, i.row.dept, i.row.per_hour, i.row.per_shift]), [['shifts:2026-10-20', 'shifts:2026-10-20', 5001330, 14002230]])
  eq('un horario sin sentido no se guarda', [m.setShifts('2026-10-21', { ...NEW, firstEnd: '15:00' }), m.setShifts('mañana', NEW), st().shifts.length], [false, false, 1])
  eq('la misma fecha otra vez reemplaza lo puesto', [m.setShifts('2026-10-20', { ...NEW, secondEnd: '23:00' }), st().shifts.length, m.shiftsOf(st(), '2026-10-20').secondEnd], [true, 1, '23:00'])
  // what comes from the server
  m.applyRemote('act_targets', { dept: 'shifts:2026-10-25', per_hour: 7001530, per_shift: 16000030, updated_at: iso(T0 + 5 * M) })
  eq('un horario puesto en otro aparato llega y vale desde su fecha', [hrs(m.shiftsOf(st(), '2026-10-26')), hrs(m.shiftsOf(st(), '2026-10-24')).slice(0, 1)], [['07:00', '15:30', '16:00', '00:30'], ['05:00']])
  m.applyRemote('act_targets', { dept: 'shifts:2026-10-25', per_hour: 8001630, per_shift: 17000130, updated_at: iso(T0 + 2 * M) })
  eq('uno más viejo no pisa al más nuevo', m.shiftsOf(st(), '2026-10-26').first, '07:00')
  m.applyRemote('act_targets', { dept: 'shifts:2026-10-27', per_hour: 99999999, per_shift: 16000030, updated_at: iso(T0 + 6 * M) })
  m.applyRemote('act_targets', { dept: 'shifts:nada', per_hour: 7001530, per_shift: 16000030, updated_at: iso(T0 + 6 * M) })
  eq('filas que no son un horario no rompen nada ni cuentan', [st().shifts.length, m.shiftsOf(st(), '2026-10-28').first, st().targets.length], [2, '07:00', 0])
  m.applyRemote('act_targets', { dept: 'RTE', per_hour: 500, per_shift: 9000, updated_at: iso(T0) })
  eq('las metas de departamento siguen llegando como antes', st().targets.map((t) => [t.dept, t.perHour, t.perShift]), [['RTE', 500, 9000]])
})
{
  // the hours a device saved are there when the app opens again (and hours that make no sense are let go, not the rest)
  const seed = (shifts) => ({ lines: [{ id: 'L1', dept: 'RTE', name: 'Línea 1', updatedAt: 1 }], runs: [], stops: [], products: [], schedule: {}, changes: [], targets: [], shifts })
  const kept = await device('sh-kept', { seed: seed([{ from: '2026-10-01', first: '05:00', firstEnd: '13:00', second: '13:30', secondEnd: '22:00', updatedAt: 5 }]) })
  eq('al abrir la app otra vez, el horario guardado sigue ahí (y todo lo demás)', kept.use((m) => [hrs(m.shiftsOf(m.store.get(), DAY)), m.store.get().lines.length]), [['05:00', '13:00', '13:30', '22:00'], 1])
  const bad = await device('sh-bad', { seed: seed([{ from: '2026-10-01', first: '25:00', firstEnd: '13:00', second: '13:30', secondEnd: '22:00', updatedAt: 5 }, { from: 'x' }]) })
  eq('un horario guardado que no tiene sentido se suelta, sin perder lo demás', bad.use((m) => [hrs(m.shiftsOf(m.store.get(), DAY)), m.store.get().lines.length, m.store.get().shifts.length]), [hrs(USUAL), 1, 0])
  const old = await device('sh-old', { seed: { lines: [{ id: 'L1', dept: 'RTE', name: 'Línea 1', updatedAt: 1 }], runs: [], stops: [] } })
  eq('lo guardado por una versión anterior, sin turnos, abre con el horario de siempre', old.use((m) => [hrs(m.shiftsOf(m.store.get(), DAY)), m.store.get().lines.length]), [hrs(USUAL), 1])
}
section('Turnos: el día de trabajo')
const sh0 = await device('sh0', { user: 'Santiago', usual: true })
sh0.use((m) => {
  const st = () => m.store.get()
  clock = oct(10, 23, 30); eq('antes de medianoche, el día del calendario', m.workDay(st()), { date: DAY, started: null })
  clock = oct(11, 0, 30); eq('pasada la medianoche el turno 2 sigue en su día, sin que nadie toque nada', m.workDay(st()), { date: DAY, started: null })
  clock = oct(11, 3, 29); eq('hasta el corte con el turno 1', m.workDay(st()).date, DAY)
  clock = oct(11, 3, 30); eq('desde ahí es el día nuevo', m.workDay(st()).date, '2026-10-11')
  clock = oct(11, 5, 50); eq('el turno 1 que empieza unos minutos antes de las 6 ya tiene su fecha y su lote', [m.workDay(st()).date, m.lotFor(m.workDay(st()).date)], ['2026-10-11', '6284'])
  // other hours, another cut: second shift until 11 PM, first from 5 AM (the cut is 2:00 AM)
  m.setShifts('2026-10-11', { first: '05:00', firstEnd: '13:30', second: '14:00', secondEnd: '23:00' })
  clock = oct(12, 1, 59); eq('con otro horario, el corte de la noche se mueve con él', m.workDay(st()).date, '2026-10-11')
  clock = oct(12, 2, 0); eq('(2:00 AM con ese horario)', m.workDay(st()).date, '2026-10-12')
})
section('Turnos: el reporte del día con cada turno, y el de un turno solo')
const sh2 = await device('sh2', { user: 'Nino', usual: true })
sh2.use((m) => {
  const st = () => m.store.get(), runOf = (code) => st().runs.find((r) => r.code === code), lastStop = () => st().stops[st().stops.length - 1]
  const min = (x) => Math.round(x / M)
  clock = oct(10, 13, 0)
  m.addLine('RTE', 'Línea 1')
  const line = st().lines[0]
  m.startRun(line, 'A100', '6283', DAY, 240)
  const a = runOf('A100').id
  clock = oct(10, 13, 30); m.unitDone(a, 240)
  clock = oct(10, 14, 30); m.unitDone(a, 240)
  clock = oct(10, 14, 40); m.startStop('RTE', line.id, 'Break', ''); clock = oct(10, 14, 50); m.endStop(lastStop().id)
  clock = oct(10, 15, 5); m.unitDone(a, 100) // the first shift's last cart, a little after its hour
  clock = oct(10, 15, 10); m.startStop('RTE', line.id, 'Problema mecánico', ''); clock = oct(10, 15, 40); m.endStop(lastStop().id) // a stop that passes from one shift to the other
  clock = oct(10, 16, 0); m.unitDone(a, 240)
  clock = oct(10, 17, 0); m.unitDone(a, 240); m.addWaste(a, 6)
  clock = oct(10, 17, 30); m.endRun(a, true)
  clock = oct(10, 18, 0); m.startRun(line, 'B200', '6283', DAY, 144)
  clock = oct(10, 18, 30); m.unitDone(runOf('B200').id, 144)
  clock = oct(10, 19, 0)
  const day = m.reportOf(st(), DAY, clock)
  const line3 = (x) => [x.shift, x.codes, x.units, x.qty, x.waste, min(x.working), min(x.down), min(x.setup)]
  eq('el día completo, como siempre', [day.rows.map((x) => [x.r.code, x.units, x.qty, x.waste, min(x.st.working), min(x.st.down)]), min(day.working), min(day.down), min(day.setup), day.filtered], [[['A100', 5, 1060, 6, 230, 40], ['B200', 1, 144, 0, 60, 0]], 290, 40, 30, false])
  eq('arriba el total del día y debajo cada turno', day.byShift.map((d) => [d.dept, line3(d.day), line3(d.first), line3(d.second)]), [['RTE', [0, 2, 6, 1204, 6, 290, 40, 30], [1, 1, 3, 580, 3.28, 120, 15, 0], [2, 2, 3, 624, 2.72, 170, 25, 30]]])
  const d = day.byShift[0]
  eq('los dos turnos suman el día: unidades, cantidad, waste, trabajando, parado y set up', [d.first.units + d.second.units, d.first.qty + d.second.qty, Math.round((d.first.waste + d.second.waste) * 100) / 100, min(d.first.working + d.second.working), min(d.first.down + d.second.down), min(d.first.setup + d.second.setup)], [6, 1204, 6, 290, 40, 30])
  eq('cada línea del día dice su turno: el código que pasó de uno a otro, los dos', [day.rows.map((x) => x.shifts), day.unitRows.map((x) => x.shift), day.stops.map((x) => [x.reason, m.spanShifts(day.plan, x.startedAt, x.endedAt ?? clock)])], [['1 y 2', '2'], [1, 1, 1, 2, 2, 2], [['Break', '1'], ['Problema mecánico', '1 y 2'], ['Set up', '2']]])
  eq('por código, lo que hizo cada turno', day.byCode.map((c) => [c.code, c.qty, c.byShift]), [['A100', 1060, [580, 480]], ['B200', 144, [0, 144]]])
  // the report of one shift only
  const one = m.reportOf(st(), DAY, clock, { shift: 1 })
  eq('turno 1 solo: lo que hizo del código que siguió en el turno 2, con su tiempo y sus paros', [one.rows.map((x) => [x.r.code, x.units, x.qty, x.waste, min(x.st.working), min(x.st.down), Object.fromEntries(Object.entries(x.st.reasons).map(([k, v]) => [k, min(v)])), x.timed]), one.filtered, one.byShift, one.shift], [[['A100', 3, 580, 3.28, 120, 15, { Break: 10, 'Problema mecánico': 5 }, 3]], true, [], 1])
  near('su promedio por carro es el de sus carros (30, 60 y 25 minutos)', one.rows[0].st.avg / M, 115 / 3)
  eq('sus unidades, sus paros (del que pasa de un turno al otro, lo que le toca a este) y sin set up', [one.unitRows.map((x) => x.qty), one.stops.map((x) => [x.reason, min(x.ms)]), min(one.setup), min(one.working), min(one.down)], [[240, 240, 100], [['Break', 10], ['Problema mecánico', 5]], 0, 120, 15])
  const two = m.reportOf(st(), DAY, clock, { shift: 2 })
  eq('turno 2 solo', [two.rows.map((x) => [x.r.code, x.units, x.qty, x.waste, min(x.st.working), min(x.st.down)]), two.stops.map((x) => x.reason), min(two.setup), two.byCode.map((c) => [c.code, c.qty, c.byShift])], [[['A100', 2, 480, 2.72, 110, 25], ['B200', 1, 144, 0, 60, 0]], ['Problema mecánico', 'Set up'], 30, [['A100', 480, null], ['B200', 144, null]]])
  eq('con código y turno a la vez', m.reportOf(st(), DAY, clock, { shift: 2, code: 'B200' }).rows.map((x) => [x.r.code, x.qty]), [['B200', 144]])
  eq('el título y el nombre del archivo dicen el turno', [m.filterTitle('', '', 2), m.filterTitle('A100', '6283', 1), m.filterFile('A100', '', 1), m.filterTitle('', ''), m.filterFile('', '')], [' · Turno 2', ' · Turno 1 · código A100 · lote 6283', '-turno1-cod-A100', '', ''])
  // today's card
  const t = m.deptToday(st(), 'RTE', DAY, clock)
  eq('la tarjeta de hoy: el total del día, lo de cada turno y el turno en curso', [t.qty, t.made, t.shift, t.shiftQty], [1204, [580, 624], 2, 624])
  near('el ritmo es el del turno en curso: desde su hora (3:30 PM), porque la línea venía corriendo', t.shiftRate, 624 / 3.5)
  near('el ritmo del día completo sigue disponible', t.rate, 1204 / 6)
  eq('antes de que empiece la hora del turno no se da ritmo', m.deptToday(st(), 'RTE', DAY, oct(10, 15, 20)).shiftRate, null)
  const early = m.deptToday(st(), 'RTE', DAY, oct(10, 14, 0))
  eq('en el turno 1, su ritmo cuenta desde su primer código', [early.shift, early.shiftQty], [1, 1204 - 624])
  // a run that has made nothing: its waste is split by the time each shift had it
  clock = oct(10, 14, 45)
  m.addLine('RTE', 'Línea 2')
  const l2 = st().lines.find((l) => l.name === 'Línea 2')
  m.startRun(l2, 'C300', '6283', DAY, 480); m.addWaste(runOf('C300').id, 2)
  clock = oct(10, 15, 45)
  eq('un código que todavía no ha hecho nada reparte su waste por el tiempo de cada turno', [1, 2].map((k) => m.reportOf(st(), DAY, clock, { shift: k, code: 'C300' }).rows.map((x) => x.waste)), [[1], [1]])
  // other hours for a later day: that day is split with them, this one keeps its own
  m.setShifts('2026-10-11', { first: '05:00', firstEnd: '13:00', second: '13:20', secondEnd: '22:00' })
  eq('cambiar el horario desde mañana no mueve el reporte de hoy', m.reportOf(st(), DAY, oct(10, 19, 0), { code: 'A100' }).byShift.map((d) => [d.first.qty, d.second.qty]), [[580, 480]])
  m.setShifts(DAY, { first: '05:00', firstEnd: '13:00', second: '13:20', secondEnd: '22:00' })
  eq('cambiarlo para hoy sí: el corte pasa a la 1:10 PM y los carros se reparten con él', m.reportOf(st(), DAY, oct(10, 19, 0), { code: 'A100' }).byShift.map((d) => [d.first.units, d.second.units]), [[0, 5]])
})
section('Pedidos (PO) de Packing')
const ord = await device('ord', { user: 'Oficina' })
ord.use((m) => {
  const st = () => m.store.get(), order = (id) => st().orders.find((o) => o.id === id)
  clock = T0
  eq('sin pedidos no hay nada que ofrecer', [st().orders, m.openOrdersFor(st(), 'A100')], [[], []])
  const a = m.saveOrder(null, { customer: 'Cliente A', po: '4500011', code: 'a100', cases: 72, shipBy: '2026-10-15', dest: 'Almacén Norte' })
  eq('la oficina escribe un pedido con su PO', [order(a).customer, order(a).po, order(a).code, order(a).cases, order(a).shipBy, order(a).dest, order(a).closed, order(a).by, m.orderLabel(order(a))], ['Cliente A', '4500011', 'A100', 72, '2026-10-15', 'Almacén Norte', false, 'Oficina', 'Cliente A · PO 4500011'])
  clock = T0 + M
  const b = m.saveOrder(null, { customer: 'Cliente B', po: '', code: 'A100', cases: 36, shipBy: '2026-10-13', dest: '' })
  eq('un pedido puede no llevar PO', [order(b).po, m.orderLabel(order(b))], ['', 'Cliente B · sin PO'])
  eq('sin código de producto no hay pedido', [m.saveOrder(null, { customer: 'Cliente C', po: '1', code: ' ', cases: 5, shipBy: '', dest: '' }), st().orders.length], ['', 2])
  eq('Packing ve los pedidos abiertos de su código, primero el que se envía antes', [m.openOrdersFor(st(), '0a100').length, m.openOrdersFor(st(), 'A100').map((o) => o.customer), m.openOrdersFor(st(), 'B200')], [0, ['Cliente B', 'Cliente A'], []])
  const sent = m.outbox.items().filter((i) => i.table === 'act_changes' && i.key.startsWith('po:'))
  eq('suben al servidor por la tabla del historial, sin departamento (solo managers y oficina), con fecha lejana para que los aparatos no los suelten', sent.map((i) => [i.key === 'po:' + i.row.ref_key, i.row.dept, i.row.ref_table, i.row.what, i.row.at.slice(0, 4), i.row.deleted, JSON.parse(i.row.after).code]), [[true, null, 'act_orders', 'Pedido', '2099', false, 'A100'], [true, null, 'act_orders', 'Pedido', '2099', false, 'A100']])
  eq('en el historial queda que se crearon, y los pedidos no se mezclan con sus líneas', [st().changes.map((c) => [c.what, c.by, c.after]), st().changes.some((c) => c.refTable === 'act_orders')], [[['Pedido nuevo', 'Oficina', 'Cliente A · PO 4500011 · código A100 · 72 cajas · envío 2026-10-15 · Almacén Norte'], ['Pedido nuevo', 'Oficina', 'Cliente B · sin PO · código A100 · 36 cajas · envío 2026-10-13']], false])
  eq('un PO para varios productos: los códigos de una caja, cada uno una vez', [m.orderCodes('0100, 0200 0300;a100,0100'), m.orderCodes('  b200 '), m.orderCodes(' , ')], [['0100', '0200', '0300', 'A100'], ['B200'], []])
  {
    // the same PO on several products, and on the same product twice: the office's to say
    const before = st().changes.length
    const ids = ['C300', 'D400', 'C300'].map((c) => m.saveOrder(null, { customer: '', po: '9001', code: c, cases: null, shipBy: '', dest: '' }))
    eq('el mismo PO se puede poner en varios productos, y repetir en el mismo', [new Set(ids).size, m.openOrdersFor(st(), 'C300').map((o) => [m.orderLabel(o), o.cases]), m.openOrdersFor(st(), 'D400').map((o) => m.orderLabel(o)), st().changes.length - before], [3, [['PO 9001', null], ['PO 9001', null]], ['PO 9001'], 3])
    ids.forEach((id) => m.deleteOrder(id))
  }
  // Packing gives each pallet to an order, or to none
  clock = T0 + 5 * M
  m.addLine('Packing', 'Línea 1')
  const line = st().lines[0]
  m.startRun(line, 'A100', '6283', DAY, 36)
  const run = () => st().runs[0]
  clock = T0 + 10 * M; m.unitDone(run().id, 36, '1001', undefined, b)
  clock = T0 + 20 * M; m.unitDone(run().id, 0, '1002', [{ lot: '6283', qty: 12 }, { lot: '6284', qty: 8 }], a)
  clock = T0 + 30 * M; m.unitDone(run().id, 36, '1003')
  eq('cada pallet guarda a qué pedido va (o a ninguno)', run().units.map((u) => [u.qty, u.ref, u.po === a ? 'A' : u.po === b ? 'B' : u.po ?? null]), [[36, '1001', 'B'], [20, '1002', 'A'], [36, '1003', null]])
  eq('la app suma lo empacado para cada pedido', [m.orderMade(st(), b), m.orderMade(st(), a), order(a).cases - m.orderMade(st(), a)], [36, 20, 52])
  eq('en el reporte cada pallet dice su pedido', m.reportOf(st(), DAY, clock).unitRows.map((x) => [x.u.ref, x.lot, x.order]), [['1001', '6283', 'Cliente B · sin PO'], ['1002', '6283', 'Cliente A · PO 4500011'], ['1002', '6284', 'Cliente A · PO 4500011'], ['1003', '6283', '']])
  eq('el siguiente pallet se propone para el pedido del anterior; sin pedido en el anterior, para ninguno', m.nextOrderFor(st(), run()), '')
  m.setUnitOrder(run().id, run().units[2].at, a)
  eq('si el anterior fue para un pedido que aún no está completo, para ese', m.nextOrderFor(st(), run()) === a, true)
  m.setUnitOrder(run().id, run().units[2].at, b)
  eq('si ese ya se completó, para el siguiente que todavía pide cajas', [m.orderMade(st(), b) >= 36, m.nextOrderFor(st(), run()) === a], [true, true])
  m.setUnitOrder(run().id, run().units[2].at, '')
  eq('una corrida sin pallets: el que se envía primero y aún pide cajas', (() => { m.addLine('Packing', 'Línea 2'); const l2 = st().lines.find((l) => l.name === 'Línea 2'); m.startRun(l2, 'A100', '6283', DAY, 36); const r2 = st().runs.find((r) => r.lineId === l2.id); const next = m.nextOrderFor(st(), r2); m.deleteRun(r2.id); return next === a })(), true)
  clock = T0 + 35 * M
  const late = m.saveOrder(null, { customer: 'Cliente N', po: '', code: 'A100', cases: 10, shipBy: '2026-10-12', dest: '' })
  eq('un pedido escrito después del último pallet sí se propone, aunque ese pallet quedó sin pedido', m.nextOrderFor(st(), run()) === late, true)
  m.deleteOrder(late)
  eq('(quitado ese pedido, vuelve a no proponerse ninguno)', m.nextOrderFor(st(), run()), '')
  // the number comes later
  clock = T0 + 40 * M
  eq('el PO que faltaba se pone después, en el mismo pedido', [m.saveOrder(b, { customer: 'Cliente B', po: '777', code: 'A100', cases: 36, shipBy: '2026-10-13', dest: '' }) === b, st().orders.length, m.orderLabel(order(b)), m.orderMade(st(), b), order(b).by], [true, 2, 'Cliente B · PO 777', 36, 'Oficina'])
  eq('y queda en el historial de qué a qué', st().changes.filter((c) => c.what === 'Pedido cambiado').map((c) => [c.before, c.after]), [['Cliente B · sin PO · código A100 · 36 cajas · envío 2026-10-13', 'Cliente B · PO 777 · código A100 · 36 cajas · envío 2026-10-13']])
  m.closeOrder(b, true)
  eq('un pedido completo ya no se ofrece a Packing, pero sigue ahí con lo suyo', [m.openOrdersFor(st(), 'A100').map((o) => o.customer), order(b).closed, m.orderMade(st(), b)], [['Cliente A'], true, 36])
  m.closeOrder(b, false)
  eq('y se puede abrir otra vez', m.openOrdersFor(st(), 'A100').length, 2)
  // a pallet given to the wrong order (a manager's correction)
  m.setUnitOrder(run().id, run().units[2].at, a)
  eq('el manager corrige a qué pedido va un pallet', [m.orderMade(st(), a), run().units[2].po === a, st().changes.filter((c) => / · pedido$/.test(c.what)).map((c) => [c.before, c.after])], [56, true, [['', 'Cliente A · PO 4500011']]])
  m.setUnitOrder(run().id, run().units[0].at, '')
  eq('o lo deja sin pedido', [m.orderMade(st(), b), 'po' in run().units[0]], [0, false])
  m.deleteOrder(a)
  eq('un pedido borrado desaparece; sus pallets quedan registrados, sin pedido', [st().orders.map((o) => o.customer), run().units.length, m.reportOf(st(), DAY, clock).unitRows.map((x) => x.order).filter(Boolean), m.outbox.items().filter((i) => i.key === 'po:' + a).map((i) => i.row.deleted)], [['Cliente B'], 3, [], [true]])
  // from another device
  m.applyRemote('act_changes', { id: 'po:r1', at: iso(Date.UTC(2099, 0, 1, 12)), by_name: 'Ana', dept: null, what: 'Pedido', before: '', after: JSON.stringify({ customer: 'Cliente D', po: '', code: 'b200', cases: 40, shipBy: '2026-10-20', dest: '', closed: false, createdAt: T0 }), ref_table: 'act_orders', ref_key: 'r1', deleted: false, updated_at: iso(T0 + 50 * M) })
  eq('un pedido puesto en otro aparato llega', [m.openOrdersFor(st(), 'B200').map((o) => [o.id, o.customer, o.cases, o.by]), st().changes.some((c) => c.id === 'po:r1')], [[['r1', 'Cliente D', 40, 'Ana']], false])
  m.applyRemote('act_changes', { id: 'po:r1', at: iso(Date.UTC(2099, 0, 1, 12)), by_name: 'Ana', dept: null, what: 'Pedido', before: '', after: JSON.stringify({ customer: 'Viejo', code: 'B200' }), ref_table: 'act_orders', ref_key: 'r1', deleted: false, updated_at: iso(T0 + 45 * M) })
  eq('uno más viejo no pisa al más nuevo', order('r1').customer, 'Cliente D')
  m.applyRemote('act_changes', { id: 'po:r2', at: iso(T0), by_name: 'Ana', dept: null, what: 'Pedido', before: '', after: 'esto no es un pedido', ref_table: 'act_orders', ref_key: 'r2', deleted: false, updated_at: iso(T0 + 50 * M) })
  eq('algo que no es un pedido no rompe nada', [st().orders.length, st().changes.some((c) => c.id === 'po:r2')], [2, false])
  m.applyRemote('act_changes', { id: 'h1', at: iso(T0 + 51 * M), by_name: 'Ana', dept: null, what: 'Pedido nuevo', before: '', after: 'Cliente D · sin PO', ref_table: 'act_orders_log', ref_key: 'r1', deleted: false, updated_at: iso(T0 + 51 * M) })
  eq('la línea de historial de un pedido sí va al historial', [st().changes.some((c) => c.id === 'h1'), st().orders.length], [true, 2])
  m.applyRemote('act_changes', { id: 'po:r1', at: iso(Date.UTC(2099, 0, 1, 12)), by_name: 'Ana', dept: null, what: 'Pedido', before: '', after: '{}', ref_table: 'act_orders', ref_key: 'r1', deleted: true, updated_at: iso(T0 + 55 * M) })
  eq('borrado en otro aparato, se va de este', st().orders.map((o) => o.id), [b])
  m.applyRemote('act_runs', { id: 'rr', dept: 'Packing', line_id: line.id, line: 'Línea 1', code: 'B200', lot: '6283', date: DAY, started_at: iso(T0 + 60 * M), ended_at: iso(T0 + 70 * M), units: [{ at: T0 + 65 * M, qty: 40, ref: '2001', by: 'Ana', po: b }, { at: T0 + 66 * M, qty: 40, ref: '2002', by: 'Ana', po: '' }], per_unit: 40, waste: 0, by_name: 'Ana', deleted: false, updated_at: iso(T0 + 70 * M) })
  eq('un pallet que llega del servidor conserva su pedido', st().runs.find((r) => r.id === 'rr').units.map((u) => u.po ?? null), [b, null])
})
{
  const kept = await device('ord-kept', { seed: { lines: [], runs: [], stops: [], products: [], orders: [{ id: 'k1', customer: 'Cliente A', po: '', code: 'a100', cases: 10, shipBy: '2026-10-15', dest: '', closed: false, createdAt: 5, by: 'Ana', updatedAt: 7 }, { id: 'k2', code: '' }, null] } })
  eq('al abrir la app otra vez, los pedidos siguen ahí (y uno sin código se suelta)', kept.use((m) => m.store.get().orders.map((o) => [o.id, o.code, o.cases, o.by, o.updatedAt])), [['k1', 'A100', 10, 'Ana', 7]])
  // the office writes it, Packing's tablet sees it and packs for it, the office sees the cases add up
  const id = mgr.use((m) => m.saveOrder(null, { customer: 'Cliente Z', po: '', code: 'Z900', cases: 80, shipBy: '', dest: '' })); settle()
  eq('el pedido que escribe la oficina llega a la tablet', tab.use((m) => m.openOrdersFor(m.store.get(), 'Z900').map((o) => m.orderLabel(o))), ['Cliente Z · sin PO'])
  clock += M
  tab.use((m) => { m.addLine('Packing', 'Línea 9'); const l = m.store.get().lines.find((x) => x.name === 'Línea 9'); m.startRun(l, 'Z900', '6283', DAY, 40); const r = m.store.get().runs.find((x) => x.code === 'Z900'); m.unitDone(r.id, 40, '', undefined, id) }); settle()
  eq('y lo que empaca la tablet para ese pedido lo ve la oficina', [mgr.use((m) => m.orderMade(m.store.get(), id)), all.map((d) => d.use((m) => m.outbox.size()))], [40, [0, 0]])
}
section('La meta de cada línea')
const lg = await device('lg', { user: 'Santiago' })
lg.use((m) => {
  const st = () => m.store.get()
  clock = T0
  m.addLine('RTE', 'Línea 1'); m.addLine('RTE', 'Línea 2')
  const [l1, l2] = st().lines.slice().sort((a, b) => a.name.localeCompare(b.name))
  eq('una línea sin meta no tiene ninguna', m.lineTargetOf(st(), l1.id), undefined)
  m.setLineTarget(l1, 300, 2400)
  eq('el manager le pone meta a una línea: por hora y del día', [m.lineTargetOf(st(), l1.id).perHour, m.lineTargetOf(st(), l1.id).perDay, m.lineTargetOf(st(), l2.id)], [300, 2400, undefined])
  eq('queda en el historial, con el nombre de la línea', st().changes.filter((c) => /^Meta Línea 1 \(RTE\)/.test(c.what)).map((c) => [c.what.split(' · ')[1], c.by, c.before, c.after]), [['por hora', 'Santiago', '', '300'], ['del día', 'Santiago', '', '2400']])
  eq('sube al servidor con las metas (act_targets), con la llave de la línea', m.outbox.items().filter((i) => i.table === 'act_targets').map((i) => [i.key === 'line:' + l1.id, i.row.dept === 'line:' + l1.id, i.row.per_hour, i.row.per_shift]), [[true, true, 300, 2400]])
  eq('la meta del departamento es otra cosa: no se toca', [st().targets.length, m.targetOf(st(), 'RTE')], [0, undefined])
  // what each line has made, apart from the room's total
  m.startRun(l1, 'A100', '6283', DAY, 240); m.startRun(l2, 'B200', '6283', DAY, 144)
  const run = (code) => st().runs.find((r) => r.code === code)
  clock = T0 + 30 * M; m.unitDone(run('A100').id, 240); m.unitDone(run('B200').id, 144)
  clock = T0 + 60 * M; m.unitDone(run('A100').id, 240)
  const all = m.deptToday(st(), 'RTE', DAY, clock), one = m.deptToday(st(), 'RTE', DAY, clock, l1.id), two = m.deptToday(st(), 'RTE', DAY, clock, l2.id)
  eq('lo de cada línea aparte, y el departamento con todas juntas', [one.qty, two.qty, all.qty, one.units, two.units], [480, 144, 624, 2, 1])
  near('el ritmo de la línea es el suyo', one.shiftRate, 480 / 0.75) // the shift in course took over at 3:15 PM
  near('y no el del departamento', all.shiftRate, 624 / 0.75)
  // from another device, and taken away
  m.applyRemote('act_targets', { dept: 'line:' + l2.id, per_hour: 120, per_shift: null, updated_at: iso(T0 + 5 * M) })
  eq('una meta puesta en otro aparato llega', [m.lineTargetOf(st(), l2.id).perHour, m.lineTargetOf(st(), l2.id).perDay, st().targets.length], [120, null, 0])
  m.applyRemote('act_targets', { dept: 'line:' + l2.id, per_hour: 999, per_shift: 999, updated_at: iso(T0 + 2 * M) })
  eq('una más vieja no pisa a la más nueva', m.lineTargetOf(st(), l2.id).perHour, 120)
  m.setLineTarget(l1, null, null)
  eq('quitarla la deja en blanco, y también queda en el historial', [m.lineTargetOf(st(), l1.id).perHour, m.lineTargetOf(st(), l1.id).perDay, st().changes.filter((c) => /^Meta Línea 1/.test(c.what)).length], [null, null, 4])
})
{
  const kept = await device('lg-kept', { seed: { lines: [{ id: 'L1', dept: 'RTE', name: 'Línea 1', updatedAt: 1 }], runs: [], stops: [], products: [], lineTargets: [{ lineId: 'L1', perHour: 250, perDay: 2000, updatedAt: 3 }, { perHour: 1 }] } })
  eq('al abrir la app otra vez, la meta de la línea sigue ahí', kept.use((m) => [m.lineTargetOf(m.store.get(), 'L1').perHour, m.lineTargetOf(m.store.get(), 'L1').perDay, m.store.get().lineTargets.length, m.store.get().lines.length]), [250, 2000, 1, 1])
}
section('Una corrida registrada en la línea equivocada')
const mov = await device('mov', { user: 'Santiago' })
mov.use((m) => {
  const st = () => m.store.get(), runOf = (code) => st().runs.find((r) => r.code === code), min = (x) => Math.round(x / M)
  clock = T0
  for (const n of [1, 2, 3]) m.addLine('RTE', 'Línea ' + n)
  m.addLine('Kitchen', 'Braiser 1')
  const L = (name) => st().lines.find((l) => l.name === name)
  m.startRun(L('Línea 1'), 'A100', '6283', DAY, 240)
  clock = T0 + 20 * M; m.startStop('RTE', L('Línea 1').id, 'Break', '')
  clock = T0 + 30 * M; m.endStop(st().stops[0].id)
  clock = T0 + 40 * M; m.unitDone(runOf('A100').id, 240)
  clock = T0 + 60 * M; m.endRun(runOf('A100').id, true)
  const before = m.runStats(st(), runOf('A100'), clock)
  eq('el manager la pasa a la línea que la hizo', m.moveRun(runOf('A100').id, L('Línea 2').id), true)
  eq('la corrida queda en esa línea, con su nombre', [runOf('A100').lineId === L('Línea 2').id, runOf('A100').line, m.lineNameOf(st(), runOf('A100').lineId)], [true, 'Línea 2', 'Línea 2'])
  eq('sus paros y el Set up que empezó al terminar van con ella; la otra línea queda limpia', [st().stops.map((x) => [x.reason, x.lineId === L('Línea 2').id]), st().stops.filter((x) => x.lineId === L('Línea 1').id).length], [[['Break', true], ['Set up', true]], 0])
  const after = m.runStats(st(), runOf('A100'), clock)
  eq('sus números no cambian: mismas unidades, mismo tiempo, mismo paro', [after.qty, min(after.working), min(after.down)], [before.qty, min(before.working), min(before.down)])
  eq('queda en el historial quién la pasó, y de cuál a cuál', st().changes.filter((c) => /Corrida A100 .*· Línea$/.test(c.what)).map((c) => [c.by, c.before, c.after]), [['Santiago', 'Línea 1', 'Línea 2']])
  eq('sube al servidor con su línea nueva, y sus paros también', [m.outbox.items().filter((i) => i.table === 'act_runs').map((i) => [i.row.line_id === L('Línea 2').id, i.row.line]), m.outbox.items().filter((i) => i.table === 'act_stops').every((i) => i.row.line_id === L('Línea 2').id)], [[[true, 'Línea 2']], true])
  eq('en el reporte sale en su línea', m.reportOf(st(), DAY, clock).rows.map((x) => m.lineNameOf(st(), x.r.lineId, x.r.line)), ['Línea 2'])
  eq('no se pasa a la misma línea, a una de otro departamento ni a una que no existe', [m.moveRun(runOf('A100').id, L('Línea 2').id), m.moveRun(runOf('A100').id, L('Braiser 1').id), m.moveRun(runOf('A100').id, 'no-existe'), runOf('A100').line], [false, false, false, 'Línea 2'])
  // a line that had another code in that time
  clock = T0 + 30 * M
  m.applyRemote('act_runs', runRow({ id: 'otra', lineId: L('Línea 3').id, line: 'Línea 3', code: 'B200', startedAt: T0 + 30 * M, endedAt: T0 + 90 * M, units: [], perUnit: 144 }))
  clock = T0 + 95 * M
  eq('no se pasa a una línea que tenía otro código a esa hora', [m.moveRun(runOf('A100').id, L('Línea 3').id), runOf('A100').line], [false, 'Línea 2'])
  // a code still running does not go onto a line that is stopped
  clock = T0 + 100 * M; m.startRun(L('Línea 1'), 'C300', '6283', DAY, 480)
  eq('un código que sigue corriendo no se pasa a una línea que está en Set up', [m.moveRun(runOf('C300').id, L('Línea 2').id), runOf('C300').line], [false, 'Línea 1'])
  m.endStop(st().stops.find((x) => x.reason === 'Set up').id)
  eq('terminado ese Set up, sí', [m.moveRun(runOf('C300').id, L('Línea 2').id), runOf('C300').line, m.openRun(st(), L('Línea 2').id)?.code, m.openRun(st(), L('Línea 1').id)], [true, 'Línea 2', 'C300', undefined])
})
section('Poderes y turno de cada persona')
calc.use((m) => {
  const keys = m.POWERS.map((p) => p.key)
  eq('la lista de poderes', keys, ['fix', 'del', 'goals', 'shifts', 'orders', 'day', 'depts', 'products', 'people', 'othershift'])
  eq('lo que trae cada rol: la oficina todos, el manager todos menos corregir lo del otro turno, el operador ninguno', [m.defaultPowers('office').length, m.defaultPowers('mgr').length, m.defaultPowers('mgr').includes('othershift'), m.defaultPowers('op'), m.defaultPowers(null)], [10, 9, false, [], []])
  eq('el dueño puede todo, tenga lo que tenga guardado', keys.every((p) => m.canDo({ role: 'op', admin: true, powers: [] }, p)), true)
  eq('sin poderes guardados, cada quien tiene los de su rol', [m.canDo({ role: 'mgr' }, 'fix'), m.canDo({ role: 'mgr', powers: null }, 'people'), m.canDo({ role: 'op' }, 'fix'), m.canDo({ role: 'office' }, 'othershift')], [true, true, false, true])
  eq('con poderes guardados, exactamente esos: a un operador se le da uno, a un manager se le quita otro', [m.canDo({ role: 'op', powers: ['fix'] }, 'fix'), m.canDo({ role: 'op', powers: ['fix'] }, 'del'), m.canDo({ role: 'mgr', powers: ['fix', 'goals'] }, 'del'), m.canDo({ role: 'mgr', powers: [] }, 'fix')], [true, false, false, false])
  eq('lo que llega de la base de datos se limpia: solo poderes de verdad, una vez cada uno', [m.cleanPowers(['fix', 'volar', 'fix', 'del']), m.cleanPowers(null), m.cleanPowers('fix'), m.cleanPowers([]), [m.cleanShift(1), m.cleanShift('2'), m.cleanShift(null), m.cleanShift(7)]], [['fix', 'del'], null, null, [], [1, 2, 0, 0]])
  eq('quien tiene turno corrige lo de su turno; lo del otro, solo con el poder', [m.canShift({ role: 'mgr', shift: 1 }, '1'), m.canShift({ role: 'mgr', shift: 1 }, '1 y 2'), m.canShift({ role: 'mgr', shift: 1 }, '2'), m.canShift({ role: 'mgr', shift: 1, powers: ['fix', 'othershift'] }, '2'), m.canShift({ role: 'mgr' }, '2'), m.canShift({ role: 'mgr', shift: 2, admin: true }, '1')], [true, true, false, true, true, true])
  eq('si a la base de datos todavía le falta la columna, se reconoce para seguir como antes', [m.missingColumn({ code: '42703', message: 'column employees.act_powers does not exist' }), m.missingColumn({ message: "Could not find the 'act_shift' column of 'employees' in the schema cache", code: 'PGRST204' }), m.missingColumn({ message: 'JWT expired' }), m.missingColumn(null)], [true, true, false, false])
})
section('Terminar el turno en un departamento')
const lea = await device('lea', { user: 'Santiago' })
lea.use((m) => {
  const st = () => m.store.get(), runOf = (code) => st().runs.find((r) => r.code === code)
  clock = T0
  for (const n of [1, 2, 3, 4]) m.addLine('RTE', 'Línea ' + n)
  m.addLine('Packing', 'Línea 1')
  const L = (name, dept = 'RTE') => st().lines.find((l) => l.name === name && l.dept === dept)
  const quiet = st().changes.length
  eq('sin nada abierto no hay nada que terminar, ni queda nada en el historial', [m.openIn(st(), 'RTE'), m.endShift('RTE'), st().changes.length - quiet], [{ runs: [], setups: [], stops: [] }, { runs: 0, setups: 0, stops: 0 }, 0])
  // line 1 ended its code saying another was coming (set up counting); line 2 runs; line 3 runs and is stopped; line 4 was stopped by hand with nothing running
  m.startRun(L('Línea 1'), 'A100', '6283', DAY, 240); m.startRun(L('Línea 2'), 'B200', '6283', DAY, 144); m.startRun(L('Línea 3'), 'C300', '6283', DAY, 480)
  m.startRun(L('Línea 1', 'Packing'), 'P900', '6283', DAY, 36)
  clock = T0 + 20 * M; m.unitDone(runOf('B200').id, 144); m.endRun(runOf('A100').id, true)
  clock = T0 + 30 * M; m.startStop('RTE', L('Línea 3').id, 'Break', '')
  clock = T0 + 40 * M; m.startSetup(L('Línea 4'))
  const open = m.openIn(st(), 'RTE')
  eq('lo que está abierto: códigos corriendo, Set up esperando otro código y otros paros', [open.runs.map((r) => r.code).sort(), open.setups.map((x) => m.lineNameOf(st(), x.lineId)).sort(), open.stops.map((x) => x.reason)], [['B200', 'C300'], ['Línea 1', 'Línea 4'], ['Break']])
  clock = T0 + 50 * M
  eq('terminar el turno cierra todo lo del departamento', m.endShift('RTE'), { runs: 2, setups: 2, stops: 1 })
  eq('los códigos terminan en ese momento, sin Set up detrás', [runOf('B200').endedAt, runOf('C300').endedAt, st().stops.filter((x) => !x.endedAt).length], [T0 + 50 * M, T0 + 50 * M, 0])
  eq('el Set up que esperaba otro código se quita (no vino); el otro paro se cierra con su tiempo', st().stops.map((x) => [x.reason, (x.endedAt - x.startedAt) / M]), [['Break', 20]])
  eq('no queda nada abierto ni contando en ese departamento', [m.openIn(st(), 'RTE'), st().lines.filter((l) => l.dept === 'RTE').map((l) => m.idleStop(st(), l.id, clock)).filter(Boolean).length], [{ runs: [], setups: [], stops: [] }, 0])
  eq('el otro departamento no se toca', [runOf('P900').endedAt, m.openIn(st(), 'Packing').runs.length], [null, 1])
  eq('queda en el historial quién terminó el turno y qué se cerró', st().changes.filter((c) => /^Turno terminado/.test(c.what)).map((c) => [c.what, c.by, c.dept, c.after]), [['Turno terminado en RTE', 'Santiago', 'RTE', '2 códigos terminados · 2 Set up quitados · 1 paro cerrado']])
  eq('la corrida que tenía un paro abierto cuenta su paro hasta el final', [Math.round(m.runStats(st(), runOf('C300'), clock).working / M), Math.round(m.runStats(st(), runOf('C300'), clock).down / M)], [30, 20])
  // a stop of the whole room
  clock = T0 + 60 * M; m.startRun(L('Línea 1'), 'D400', '6283', DAY, 144); m.startStop('RTE', null, 'Limpieza', '')
  clock = T0 + 75 * M
  eq('un paro de todo el departamento también se cierra', [m.endShift('RTE'), st().stops.filter((x) => x.reason === 'Limpieza').map((x) => (x.endedAt - x.startedAt) / M), runOf('D400').endedAt], [{ runs: 1, setups: 0, stops: 1 }, [15], T0 + 75 * M])
})
section('Turnos: el tiempo no se detiene solo; un rato entre turnos sin ningún registro no cuenta')
const gap = await device('gap', { user: 'Nino', usual: true })
gap.use((m) => {
  const st = () => m.store.get(), min = (x) => Math.round(x / M), runOf = (code) => st().runs.find((r) => r.code === code), lastStop = () => st().stops[st().stops.length - 1]
  const lineOf = (n) => { m.addLine('RTE', 'Línea ' + n); return st().lines.find((l) => l.name === 'Línea ' + n) }
  const stats = (code, at) => { const x = m.runStats(st(), runOf(code), at); return [min(x.working), min(x.down)] }
  // 1. a code left running through the change of shift, with nobody tapping anything in that half hour
  clock = oct(10, 14, 0)
  m.startRun(lineOf(1), 'A100', '6283', DAY, 240)
  clock = oct(10, 14, 40); m.unitDone(runOf('A100').id, 240)
  eq('mientras pasa el cambio de turno el tiempo NO se detiene: quien sigue trabajando sigue contando', [stats('A100', oct(10, 15, 10)), stats('A100', oct(10, 15, 29))], [[70, 0], [89, 0]])
  eq('pasado el cambio (3:30 PM), si en la línea nadie registró nada en esa media hora, esa media hora no cuenta', stats('A100', oct(10, 15, 31)), [61, 0])
  clock = oct(10, 16, 0); m.unitDone(runOf('A100').id, 240)
  clock = oct(10, 16, 30)
  const a = m.runStats(st(), runOf('A100'), clock)
  eq('dos horas y media en el reloj son dos de trabajo', [min(a.working), min(a.down), a.unitTimes.map(min), min(a.total)], [120, 0, [40, 50], 150])
  eq('el carro en curso tampoco cuenta esa media hora, una vez pasada', [min(m.workedSince(st(), runOf('A100'), oct(10, 14, 40), oct(10, 15, 45))), min(m.workedSince(st(), runOf('A100'), oct(10, 14, 40), oct(10, 15, 20))), min(m.workedSince(st(), runOf('A100'), oct(10, 16, 0), clock))], [35, 40, 30])
  const day = m.reportOf(st(), DAY, clock).byShift[0]
  eq('cada turno con su hora de trabajo, y los dos suman el día', [min(day.first.working), min(day.second.working), min(day.day.working), day.first.units, day.second.units], [60, 60, 120, 1, 1])
  // 2. the shift that leaves stays a few minutes and records a cart: somebody was there, so all of it counts
  clock = oct(10, 14, 0); m.startRun(lineOf(2), 'B200', '6283', DAY, 144)
  clock = oct(10, 15, 6); m.unitDone(runOf('B200').id, 144)
  eq('si alguien registró algo en ese rato (un carro a las 3:06), hubo gente: cuenta todo', [stats('B200', oct(10, 15, 20)), stats('B200', oct(10, 16, 0))], [[80, 0], [120, 0]])
  // 3. the shift that comes in starts a few minutes early: it started, so it counts from there
  clock = oct(10, 15, 20); m.startRun(lineOf(3), 'C300', '6283', DAY, 480)
  eq('el turno que entra empieza un código a las 3:20: cuenta desde que empezó', [stats('C300', oct(10, 15, 25)), stats('C300', oct(10, 16, 0))], [[5, 0], [40, 0]])
  // 4. a stop left open through the change, nobody tapping
  clock = oct(10, 14, 0); m.startRun(lineOf(4), 'D400', '6283', DAY, 144)
  clock = oct(10, 14, 50); m.startStop('RTE', runOf('D400').lineId, 'Break', '')
  const brk = lastStop().id
  eq('un paro abierto sigue contando mientras pasa el cambio', [stats('D400', oct(10, 15, 20)), min(m.stopTime(st(), st().stops.find((x) => x.id === brk), oct(10, 15, 20)))], [[50, 30], 30])
  clock = oct(10, 15, 40); m.endStop(brk)
  clock = oct(10, 16, 0)
  eq('pasado el cambio sin ningún registro en la línea, esa media hora sale del paro: 10 minutos de un lado y 10 del otro', [stats('D400', clock), min(m.stopTime(st(), st().stops.find((x) => x.id === brk), clock)), m.reportOf(st(), DAY, clock, { code: 'D400' }).stops.map((x) => [x.reason, min(x.ms)]), [1, 2].map((k) => min(m.reportOf(st(), DAY, clock, { code: 'D400', shift: k }).down))], [[70, 20], 20, [['Break', 20]], [10, 10]])
  // 5. the set up between two codes, with the change of shift in the middle
  clock = oct(10, 14, 0); m.startRun(lineOf(5), 'E500', '6283', DAY, 144)
  clock = oct(10, 14, 50); m.endRun(runOf('E500').id, true)
  const setup = lastStop().id
  eq('el reloj del Set up en la tarjeta sigue mientras pasa el cambio', min(m.stopTime(st(), st().stops.find((x) => x.id === setup), oct(10, 15, 25))), 35)
  clock = oct(10, 15, 40); m.startRun(st().lines.find((l) => l.name === 'Línea 5'), 'F600', '6283', DAY, 144)
  clock = oct(10, 16, 0)
  eq('50 minutos en el reloj; pasado el cambio sin registros, 20 de Set up', [st().stops.filter((x) => x.id === setup).map((x) => [x.note, min(x.endedAt - x.startedAt)]), min(m.stopTime(st(), st().stops.find((x) => x.id === setup), clock)), min(m.reportOf(st(), DAY, clock).setup)], [[['De E500 a F600', 50]], 20, 20])
  // 6. the night
  clock = oct(10, 23, 0); m.startRun(lineOf(6), 'G700', '6283', DAY, 240)
  clock = oct(11, 0, 40); m.unitDone(runOf('G700').id, 240)
  eq('de noche tampoco se detiene solo: pasada la 1:00 AM, un código que sigue corriendo sigue contando', [stats('G700', oct(11, 1, 30)), stats('G700', oct(11, 2, 0))], [[150, 0], [180, 0]])
  eq('llegada la hora del turno 1 (6:00 AM), una línea que pasó toda la noche sin un solo registro no cuenta esa noche', [stats('G700', oct(11, 6, 0)), stats('G700', oct(11, 7, 0))], [[120, 0], [180, 0]])
  clock = oct(11, 1, 20); m.unitDone(runOf('G700').id, 240)
  eq('si el turno 2 siguió y registró un carro a la 1:20, hubo gente: esa noche cuenta hasta que ellos terminen el código', stats('G700', oct(11, 7, 0)), [480, 0])
  clock = oct(11, 5, 52); m.startRun(lineOf(7), 'H800', '6284', '2026-10-11', 240)
  eq('el turno 1 que empieza a las 5:52 cuenta desde las 5:52: si le dieron es porque empezaron', stats('H800', oct(11, 6, 10)), [18, 0])
  // 7. a stop of the whole room goes by its own start and end
  clock = oct(10, 14, 55); m.startStop('RTE', null, 'Limpieza', '')
  const all = lastStop().id
  clock = oct(10, 15, 45); m.endStop(all)
  eq('un paro de todo el departamento que cruza el cambio sin tocarse en ese rato: 5 minutos antes y 15 después', min(m.stopTime(st(), st().stops.find((x) => x.id === all), oct(10, 16, 0))), 20)
  eq('y a la línea 1, que tampoco registró nada en ese rato, le cuenta esos 20 minutos', stats('A100', oct(10, 16, 30)), [100, 20])
  // other hours: no minute between the shifts, nothing to take out
  m.setShifts(DAY, { first: '06:00', firstEnd: '15:00', second: '15:00', secondEnd: '01:00' })
  eq('con un horario sin hueco entre turnos, todo ese tiempo cuenta: los 50 minutos del paro', [stats('A100', oct(10, 16, 30)), min(m.stopTime(st(), st().stops.find((x) => x.id === all), oct(10, 16, 30)))], [[100, 50], 50])
})
{
  // the second shift past midnight: its stops and its set up are still of its day
  const ngt = await device('ngt', { user: 'Santiago', usual: true })
  ngt.use((m) => {
    const st = () => m.store.get()
    clock = oct(10, 22, 0)
    m.addLine('RTE', 'Línea 1')
    const line = st().lines[0]
    m.startRun(line, 'A100', '6283', m.workDay(st()).date, 240)
    clock = oct(11, 0, 20); m.startStop('RTE', line.id, 'Break', '')
    clock = oct(11, 0, 35); m.endStop(st().stops[0].id); m.unitDone(st().runs[0].id, 240)
    clock = oct(11, 0, 50); m.endRun(st().runs[0].id, true)
    clock = oct(11, 0, 55); m.startRun(line, 'B200', '6283', m.workDay(st()).date, 240)
    eq('pasada la medianoche, lo del turno 2 sigue en el reporte de su día: carros, paros y set up', [m.workDay(st()).date, m.reportOf(st(), DAY, clock).stops.map((x) => x.reason), m.reportOf(st(), DAY, clock, { shift: 2 }).rows.map((x) => [x.units, Math.round(x.st.down / M)]), Math.round(m.reportOf(st(), DAY, clock).setup / M), m.reportOf(st(), '2026-10-11', clock).stops.length], [DAY, ['Break', 'Set up'], [[1, 15]], 5, 0])
  })
}
section('Lo que se borró por error se recupera: en el servidor nada se borra de verdad')
{
  // what happened on 2026-10-13: the first shift had been working since six, and somebody starting the day at half
  // past eight answered "eran pruebas: borrarlas". Every screen lost the morning. The server still had all of it.
  const D20 = '2026-10-20'
  const rte = tab.use((m) => m.store.get().lines.find((l) => l.dept === 'RTE'))
  const ofDay = (d) => d.use((m) => m.store.get().runs.filter((r) => r.date === D20).sort((a, b) => a.startedAt - b.startedAt).map((r) => [r.code, r.units.map((u) => u.qty), r.endedAt ? new Date(r.endedAt).getHours() + ':' + String(new Date(r.endedAt).getMinutes()).padStart(2, '0') : 'corriendo']))
  const stopsOfDay = (d) => d.use((m) => m.store.get().stops.filter((x) => m.dayOf(x.startedAt) === D20).map((x) => [x.reason, Math.round((x.endedAt - x.startedAt) / M)]))
  const idOf = (code) => tab.use((m) => m.store.get().runs.find((r) => r.date === D20 && r.code === code && !r.deleted)?.id)
  // a test run the manager made and deleted by itself, long before: that one must stay deleted
  clock = oct(20, 5, 30); mgr.use((m) => m.startRun(rte, 'PRUEBA', '6293', D20, 240)); settle()
  clock = oct(20, 5, 40); mgr.use((m) => { m.endRun(m.store.get().runs.find((r) => r.code === 'PRUEBA').id); m.deleteRun(m.store.get().runs.find((r) => r.code === 'PRUEBA').id) }); settle()
  // the morning of the first shift, on the tablet
  clock = oct(20, 6, 0); tab.use((m) => m.startRun(rte, 'P100', '6293', D20, 240)); settle()
  clock = oct(20, 6, 20); tab.use((m) => m.unitDone(idOf('P100'), 240))
  clock = oct(20, 6, 40); tab.use((m) => m.unitDone(idOf('P100'), 240))
  clock = oct(20, 6, 45); tab.use((m) => m.startStop('RTE', rte.id, 'Break', ''))
  clock = oct(20, 6, 55); tab.use((m) => m.endStop(m.store.get().stops.find((x) => !x.endedAt && x.lineId === rte.id).id))
  clock = oct(20, 7, 30); tab.use((m) => m.endRun(idOf('P100'), false))
  clock = oct(20, 7, 35); tab.use((m) => m.startRun(rte, 'P200', '6293', D20, 240))
  clock = oct(20, 8, 0); tab.use((m) => m.unitDone(idOf('P200'), 240)); settle()
  const morning = [['P100', [240, 240], '7:30'], ['P200', [240], 'corriendo']]
  eq('la mañana del primer turno, en los dos aparatos', [ofDay(tab), ofDay(mgr), stopsOfDay(mgr)], [morning, morning, [['Break', 10]]])
  // 8:30: somebody starts the day and takes "the tests" away
  clock = oct(20, 8, 30)
  const took = mgr.use((m) => m.startDay(clock, { date: D20, purge: true })); settle()
  eq('al empezar el día se quitaron de todas las pantallas', [[took.runs, took.stops], ofDay(tab), ofDay(mgr), stopsOfDay(tab)], [[2, 1], [], [], []])
  const kept = [...server].filter(([k, row]) => k.startsWith('act_runs|') && String(row.date) === D20).map(([, row]) => [row.code, row.deleted, row.units.length]).sort()
  eq('pero el servidor los conserva enteros, solo marcados', kept, [['P100', true, 2], ['P200', true, 1], ['PRUEBA', true, 0]])
  eq('el reporte de ese día dice a los dos que se quitaron, cuándo y quién', [tab, mgr].map((d) => d.use((m) => m.purgesOf(m.store.get(), D20).map((c) => [c.by, c.before, new Date(c.at).getHours() + ':' + new Date(c.at).getMinutes()]))), [[['Santiago', '2 corridas · 1 paro', '8:30']], [['Santiago', '2 corridas · 1 paro', '8:30']]])
  // the line looks free, so the operator starts the code again and goes on
  clock = oct(20, 8, 40); tab.use((m) => m.startRun(rte, 'P200', '6293', D20, 240))
  clock = oct(20, 9, 0); tab.use((m) => m.unitDone(m.store.get().runs.find((r) => r.date === D20 && !r.endedAt).id, 240)); settle()
  // 9:10: the manager brings the morning back, with what the server holds of that day
  clock = oct(20, 9, 10)
  const held = (table) => [...server].filter(([k]) => k.startsWith(table + '|')).map(([, row]) => row)
  const purge = mgr.use((m) => m.purgesOf(m.store.get(), D20)[0].id)
  const back = mgr.use((m) => m.restorePurged(purge, { runs: held('act_runs'), stops: held('act_stops'), changes: held('act_changes') })); settle()
  const whole = [['P100', [240, 240], '7:30'], ['P200', [240], '8:30'], ['P200', [240], 'corriendo']]
  eq('recuperado: vuelve la mañana entera; lo que seguía corriendo queda terminado a la hora en que se quitó', [back, ofDay(mgr), ofDay(tab), stopsOfDay(tab)], [{ runs: 2, stops: 1 }, whole, whole, [['Break', 10]]])
  eq('la corrida de prueba que el manager había borrado por su cuenta sigue borrada', [...server].filter(([k, row]) => k.startsWith('act_runs|') && row.code === 'PRUEBA').map(([, row]) => row.deleted), [true])
  eq('una sola corrida de ese día abierta en la línea, y nada pendiente de enviar', [[tab, mgr].map((d) => d.use((m) => m.store.get().runs.filter((r) => r.date === D20 && r.lineId === rte.id && !r.endedAt).length)), all.map((d) => d.use((m) => m.outbox.size()))], [[1, 1], [0, 0]])
  eq('el reporte vuelve a sumar todo el turno', mgr.use((m) => { const r = m.reportOf(m.store.get(), D20, clock, { only: 'RTE' }); return [r.rows.length, r.byDept[0].units, r.byDept[0].qty] }), [3, 4, 960])
  eq('ya no hay nada por recuperar, y queda escrito quién lo recuperó', [tab.use((m) => m.purgesOf(m.store.get(), D20).length), mgr.use((m) => m.purgesOf(m.store.get(), D20).length), tab.use((m) => m.store.get().changes.filter((c) => c.what.startsWith('Se recuperaron')).map((c) => [c.by, c.after]))], [0, 0, [['Santiago', '2 corridas · 1 paro']]])
  eq('recuperar otra vez no trae nada de más', [mgr.use((m) => m.restorePurged(purge, { runs: held('act_runs'), stops: held('act_stops'), changes: held('act_changes') })), ofDay(mgr).length], [{ runs: 0, stops: 0 }, 3])
  settle()
}
section('Set up: espera al código siguiente; con las líneas vacías no corre nada')
{
  const wai = await device('wai', { user: 'Santiago', usual: true })
  wai.use((m) => {
    const st = () => m.store.get(), min = (x) => Math.round(x / M), runOf = (code) => st().runs.find((r) => r.code === code)
    const lineOf = (n) => { m.addLine('RTE', 'Línea ' + n); return st().lines.find((l) => l.name === 'Línea ' + n) }
    const rep = (date = DAY) => m.reportOf(st(), date, clock)
    const setups = (lineId) => st().stops.filter((x) => x.lineId === lineId && x.reason === 'Set up')
    // 1. the last code of the night ends saying another one is coming, and everybody goes home without a word
    clock = oct(10, 22, 0); const l1 = lineOf(1); m.startRun(l1, 'A100', '6283', DAY, 240)
    clock = oct(10, 23, 0); m.unitDone(runOf('A100').id, 240)
    clock = oct(11, 0, 40); m.endRun(runOf('A100').id, true)
    const look = (line, h, mi) => { clock = oct(11, h, mi); const r = rep(); return [min(r.setup), r.stops.length, min(r.byShift[0].second.setup), m.idleStop(st(), line.id, clock)?.reason ?? null] }
    eq('a las 12:50, 1:30 y 3:00 AM el Set up espera en la tarjeta y no suma nada al reporte', [look(l1, 0, 50), look(l1, 1, 30), look(l1, 3, 0)], [[0, 0, 0, 'Set up'], [0, 0, 0, 'Set up'], [0, 0, 0, 'Set up']])
    eq('el reloj de la tarjeta sí corre mientras espera', min(m.stopTime(st(), setups(l1.id)[0], oct(11, 0, 55))), 15)
    eq('terminado el día de trabajo (3:30 AM) la tarjeta ya no lo muestra: la línea amanece libre', look(l1, 3, 31), [0, 0, 0, null])
    clock = oct(11, 6, 5); m.startRun(l1, 'B200', '6284', '2026-10-11', 240)
    eq('el primer código de la mañana no lo cierra con cinco horas: lo quita', [setups(l1.id).length, min(rep().setup), min(rep('2026-10-11').setup), st().stops.filter((x) => !x.endedAt).length], [0, 0, 0, 0])
    // 2. the same with some overtime: the last code ends at 1:10 AM, past the hour of the shift
    clock = oct(10, 22, 0); const l2 = lineOf(2); m.startRun(l2, 'C300', '6283', DAY, 240)
    clock = oct(11, 1, 10); m.endRun(runOf('C300').id, true)
    const night = [look(l2, 2, 0), look(l2, 3, 0)]
    clock = oct(11, 6, 10); m.startRun(l2, 'D400', '6284', '2026-10-11', 240)
    clock = oct(11, 7, 0)
    eq('con overtime (terminó a la 1:10 AM) tampoco corre de madrugada, y a las 6:10 se quita en vez de cerrarse con cinco horas', [night, setups(l2.id).length, min(rep().setup), rep().stops.length, rep('2026-10-11').stops.length], [[[0, 0, 0, 'Set up'], [0, 0, 0, 'Set up']], 0, 0, 0, 0])
    // 3. a tablet with the older version of the app closes last night's set up with the morning's first code
    const l3 = lineOf(3)
    m.applyRemote('act_runs', runRow({ id: 'r-n', lineId: l3.id, line: 'Línea 3', code: 'E500', startedAt: oct(10, 22, 0), endedAt: oct(11, 1, 10), units: [unit(oct(10, 23, 0), 240)] }))
    m.applyRemote('act_stops', stopRow({ id: 's-old', lineId: l3.id, reason: 'Set up', note: 'De E500 a F600', startedAt: oct(11, 1, 10), endedAt: oct(11, 6, 10) }))
    m.applyRemote('act_runs', runRow({ id: 'r-m', lineId: l3.id, line: 'Línea 3', code: 'F600', date: '2026-10-11', startedAt: oct(11, 6, 10), endedAt: null }))
    eq('cerrado así por una tablet con la versión vieja: no entra al reporte de ningún día', [st().stops.some((x) => x.id === 's-old'), rep().stops.some((x) => x.id === 's-old'), min(rep().setup), rep('2026-10-11').stops.length], [true, false, 0, 0])
    // 4. the set up is open here and the morning's code was started on another tablet
    const l4 = lineOf(4)
    m.applyRemote('act_stops', stopRow({ id: 's-open', lineId: l4.id, reason: 'Set up', note: 'Después de G700', startedAt: oct(11, 0, 45), endedAt: null }))
    m.applyRemote('act_runs', runRow({ id: 'r-4', lineId: l4.id, line: 'Línea 4', code: 'H800', date: '2026-10-11', startedAt: oct(11, 6, 2), endedAt: null }))
    eq('si el código de la mañana lo empezó otra tablet, aquí también se quita en vez de cerrarse', [st().stops.some((x) => x.id === 's-open'), rep().stops.length, rep('2026-10-11').stops.length], [false, 0, 0])
    // 5. within the day: it waits, and the next code brings it in whole
    clock = oct(10, 17, 0); const l5 = lineOf(5); m.startRun(l5, 'J900', '6283', DAY, 240)
    clock = oct(10, 18, 0); m.endRun(runOf('J900').id, true)
    clock = oct(10, 18, 30)
    const waits = [min(rep().setup), rep().stops.filter((x) => x.lineId === l5.id).length, m.idleStop(st(), l5.id, clock)?.reason]
    clock = oct(10, 18, 40); m.startRun(l5, 'K100', '6283', DAY, 240)
    eq('el mismo día: mientras espera no suma; al empezar el código siguiente entra completo', [waits, rep().stops.filter((x) => x.lineId === l5.id).map((x) => [x.reason, x.note, min(x.ms)]), min(rep().setup)], [[0, 0, 'Set up'], [['Set up', 'De J900 a K100', 40]], 40])
    // 6. ended by hand ("Terminar Set up"): somebody said it was over, so it counts
    clock = oct(10, 19, 0); m.endRun(runOf('K100').id, true)
    clock = oct(10, 19, 25); m.endStop(st().stops.find((x) => x.lineId === l5.id && !x.endedAt).id)
    clock = oct(10, 20, 0)
    eq('terminado a mano ("Terminar Set up"): alguien dijo que acabó, así que cuenta', [min(rep().setup), m.idleStop(st(), l5.id, clock)], [65, undefined])
    // 7. a stop while a code runs is somebody's word that the line is stopped: it counts as it happens, as always
    clock = oct(10, 20, 0); const l6 = lineOf(6); m.startRun(l6, 'L200', '6283', DAY, 240)
    clock = oct(10, 20, 10); m.startStop('RTE', l6.id, 'Break', '')
    clock = oct(10, 20, 25)
    eq('un paro con el código corriendo sí cuenta mientras pasa, como siempre', [rep().stops.filter((x) => x.lineId === l6.id).map((x) => [x.reason, x.endedAt, min(x.ms)]), min(m.runStats(st(), runOf('L200'), clock).down)], [[['Break', null, 15]], 15])
  })
}
section('Reporte: lo hecho por departamento, por código y lote, y por causa de paro')
{
  const tot = await device('tot', { user: 'Santiago', usual: true })
  tot.use((m) => {
    const st = () => m.store.get(), min = (x) => Math.round(x / M)
    const lineOf = (dept, n) => { m.addLine(dept, 'Línea ' + n); return st().lines.find((l) => l.dept === dept && l.name === 'Línea ' + n) }
    const open = (line) => st().runs.find((r) => r.lineId === line.id && !r.endedAt)
    // RTE, line 1: A100 of lot 6283 through the change of shift (two carts in the first, one in the second), a break and some waste
    clock = oct(10, 13, 0); const l1 = lineOf('RTE', 1); m.startRun(l1, 'A100', '6283', DAY, 240)
    clock = oct(10, 13, 30); m.unitDone(open(l1).id, 240)
    clock = oct(10, 13, 40); m.startStop('RTE', l1.id, 'Break', '')
    clock = oct(10, 13, 50); m.endStop(st().stops.find((x) => !x.endedAt).id)
    clock = oct(10, 14, 20); m.unitDone(open(l1).id, 240)
    clock = oct(10, 16, 0); m.unitDone(open(l1).id, 240); m.addWaste(open(l1).id, 2)
    clock = oct(10, 16, 30); m.endRun(open(l1).id, false)
    // RTE, line 2: the same code with another lot (a short cart), then B200 after a set up, with a mechanical stop
    clock = oct(10, 16, 0); const l2 = lineOf('RTE', 2); m.startRun(l2, 'A100', '6284', DAY, 240)
    clock = oct(10, 16, 40); m.unitDone(open(l2).id, 200)
    clock = oct(10, 17, 0); m.endRun(open(l2).id, true)
    clock = oct(10, 17, 10); m.startRun(l2, 'B200', '6283', DAY, 144)
    clock = oct(10, 17, 40); m.unitDone(open(l2).id, 144)
    clock = oct(10, 17, 45); m.startStop('RTE', l2.id, 'Problema mecánico', '')
    clock = oct(10, 18, 5); m.endStop(st().stops.find((x) => !x.endedAt).id)
    clock = oct(10, 18, 30); m.unitDone(open(l2).id, 144)
    clock = oct(10, 18, 40); m.endRun(open(l2).id, false)
    // Packing: two pallets of A100, the second one with cases of two lots
    clock = oct(10, 14, 0); const pk = lineOf('Packing', 1); m.startRun(pk, 'A100', '6283', DAY, 50)
    clock = oct(10, 14, 30); m.unitDone(open(pk).id, 50, 'T1')
    clock = oct(10, 16, 10); m.unitDone(open(pk).id, null, 'T2', [{ lot: '6283', qty: 30 }, { lot: '6284', qty: 20 }])
    clock = oct(10, 16, 20); m.endRun(open(pk).id, false)
    clock = oct(10, 19, 0)
    const dept = (x) => [x.dept, x.codes, x.units, x.qty]
    const codeLots = (c) => [c.dept, c.code, c.units, c.qty, c.lots.map((l) => [l.lot, l.units, l.qty, l.byShift])]
    const day = m.reportOf(st(), DAY, clock)
    eq('lo hecho por departamento, cada uno en su unidad (los números grandes de arriba)', [day.byDept.map(dept), day.byDept.map((x) => [x.waste, min(x.down), min(x.setup)])], [[['RTE', 3, 6, 1208], ['Packing', 1, 2, 100]], [[2, 30, 10], [0, 0, 0]]])
    eq('cada código con sus lotes, y de cada lote lo que hizo cada turno', day.byCode.map(codeLots), [
      ['RTE', 'A100', 4, 920, [['6283', 3, 720, [480, 240]], ['6284', 1, 200, [0, 200]]]],
      ['RTE', 'B200', 2, 288, [['6283', 2, 288, [0, 288]]]],
      ['Packing', 'A100', 2, 100, [['6283', 2, 80, [50, 30]], ['6284', 1, 20, [0, 20]]]]])
    eq('los lotes de un código suman el código, y los códigos suman el departamento', [day.byCode.map((c) => c.lots.reduce((t, l) => t + l.qty, 0) === c.qty), day.byDept.map((d) => day.byCode.filter((c) => c.dept === d.dept).reduce((t, c) => t + c.qty, 0) === d.qty), day.byDept.map((d) => { const b = day.byShift.find((x) => x.dept === d.dept); return b.first.qty + b.second.qty === d.qty && b.day.qty === d.qty })], [[true, true, true], [true, true], [true, true]])
    eq('el parado, causa por causa, de mayor a menor: juntas son el total de Parado', [day.reasons.map((x) => [x.reason, min(x.ms)]), day.reasons.reduce((t, x) => t + x.ms, 0) === day.down], [[['Problema mecánico', 20], ['Break', 10]], true])
    const two = m.reportOf(st(), DAY, clock, { shift: 2 })
    eq('con el turno 2: lo de ese turno solo, en los números grandes, en los lotes y en las causas', [two.byDept.map(dept), two.byCode.map(codeLots), two.reasons.map((x) => [x.reason, min(x.ms)]), two.byShift.length], [[['RTE', 3, 4, 728], ['Packing', 1, 1, 50]], [
      ['RTE', 'A100', 2, 440, [['6283', 1, 240, null], ['6284', 1, 200, null]]],
      ['RTE', 'B200', 2, 288, [['6283', 2, 288, null]]],
      ['Packing', 'A100', 1, 50, [['6283', 1, 30, null], ['6284', 1, 20, null]]]], [['Problema mecánico', 20]], 0])
    const lot = m.reportOf(st(), DAY, clock, { lot: '6284' })
    eq('con el lote 6284: lo que lleva ese lote, también del pallet que lo comparte con otro', [lot.byDept.map(dept), lot.byCode.map(codeLots)], [[['RTE', 1, 1, 200], ['Packing', 1, 1, 20]], [['RTE', 'A100', 1, 200, [['6284', 1, 200, [0, 200]]]], ['Packing', 'A100', 1, 20, [['6284', 1, 20, [0, 20]]]]]])
    const both = m.reportOf(st(), DAY, clock, { code: 'A100', shift: 1 })
    eq('los filtros se combinan: el código A100 en el turno 1', [both.byDept.map(dept), both.byCode.map((c) => [c.dept, c.code, c.qty])], [[['RTE', 1, 2, 480], ['Packing', 1, 1, 50]], [['RTE', 'A100', 480], ['Packing', 'A100', 50]]])
    const all3 = m.reportOf(st(), DAY, clock, { only: 'RTE', code: 'A100', lot: '6283', shift: 2 })
    eq('y los cuatro juntos: RTE, código A100, lote 6283, turno 2', [all3.byDept.map(dept), all3.byCode.map(codeLots), all3.codes, all3.lots], [[['RTE', 1, 1, 240]], [['RTE', 'A100', 1, 240, [['6283', 1, 240, null]]]], ['A100', 'B200'], ['6283', '6284']])
    eq('un departamento solo', [m.reportOf(st(), DAY, clock, { only: 'Packing' }).byDept.map(dept), m.reportOf(st(), DAY, clock, { only: 'Packing' }).codes], [[['Packing', 1, 2, 100]], ['A100']])
    // a code that has just started: it is in the report with its lot and nothing made yet
    clock = oct(10, 19, 0); const sp = lineOf('Spiral', 1); m.startRun(sp, 'C300', '6283', DAY, null)
    clock = oct(10, 19, 20)
    const late = m.reportOf(st(), DAY, clock)
    eq('un código recién empezado sale con su lote y cero hechas; sin cantidad, el departamento cuenta sus unidades', [late.byDept.map(dept), late.byCode.filter((c) => c.dept === 'Spiral').map(codeLots)], [[['RTE', 3, 6, 1208], ['Spiral', 1, 0, 0], ['Packing', 1, 2, 100]], [['Spiral', 'C300', 0, 0, [['6283', 0, 0, [0, 0]]]]]])
    clock = oct(10, 19, 30); m.unitDone(open(sp).id, null)
    clock = oct(10, 19, 40)
    eq('en el orden de la planta (RTE antes que Spiral y Packing) y, dentro de cada departamento, por código', late.byCode.map((c) => c.dept + ' ' + c.code), ['RTE A100', 'RTE B200', 'Spiral C300', 'Packing A100'])
    eq('las cajas, con coma en los miles como los demás números', [m.casesText({ cases: 1188, loose: 0 }), m.casesText({ cases: 1, loose: 3 }), m.casesText({ cases: 12, loose: 1 })], ['1,188 cajas', '1 caja y 3 sueltos', '12 cajas y 1 suelto'])
    eq('lo hecho por una corrida, también con coma en los miles', [m.madeText(st().runs.find((r) => r.lineId === l1.id), 3360), m.madeText(st().runs.find((r) => r.lineId === l1.id), 720)], ['3 carros · 3,360 pouches', '3 carros · 720 pouches'])
    eq('una mezcla (sin cantidad) cuenta como unidad de su lote y de su turno', m.reportOf(st(), DAY, clock).byCode.filter((c) => c.dept === 'Spiral').map(codeLots), [['Spiral', 'C300', 1, 0, [['6283', 1, 0, [0, 1]]]]])
    // the clock of each shift, and codes told apart from runs
    const hm = (ms) => (ms ? new Date(ms).getHours() + ':' + String(new Date(ms).getMinutes()).padStart(2, '0') : '')
    const clockOf = (x) => [hm(x.from), hm(x.to), min(x.span), x.open, x.lines, x.distinct, x.codes]
    const rte = m.reportOf(st(), DAY, oct(10, 19, 0), { only: 'RTE' }), pkg = m.reportOf(st(), DAY, oct(10, 19, 0), { only: 'Packing' })
    eq('RTE, turno 1: de la 1:00 a las 3:00 PM (la media hora del cambio, sin registros, no cuenta), una línea, un código, una corrida', clockOf(rte.byShift[0].first), ['13:00', '15:00', 120, false, 1, 1, 1])
    eq('RTE, turno 2: de las 3:30 a las 6:40 PM, dos líneas, dos códigos distintos en tres corridas', clockOf(rte.byShift[0].second), ['15:30', '18:40', 190, false, 2, 2, 3])
    eq('RTE, el día: empezó a la 1:00, terminó a las 6:40, y duró lo que duraron sus dos turnos (no las horas entre uno y otro)', [clockOf(rte.byShift[0].day), clockOf(rte.byDept[0])], [['13:00', '18:40', 310, false, 2, 2, 3], ['13:00', '18:40', 310, false, 2, 2, 3]])
    eq('trabajando es otra cosa: la suma de las líneas, que puede pasar de la duración', [min(rte.working) + min(rte.down), min(rte.byShift[0].second.working + rte.byShift[0].second.down) > min(rte.byShift[0].second.span)], [330, true])
    eq('Packing: una hora en el turno 1 y cincuenta minutos en el turno 2', [clockOf(pkg.byShift[0].first), clockOf(pkg.byShift[0].second), min(pkg.byDept[0].span)], [['14:00', '15:00', 60, false, 1, 1, 1], ['15:30', '16:20', 50, false, 1, 1, 1], 110])
    eq('con un turno escogido, la duración es la de ese turno', clockOf(m.reportOf(st(), DAY, oct(10, 19, 0), { only: 'RTE', shift: 2 }).byDept[0]), ['15:30', '18:40', 190, false, 2, 2, 3])
    eq('en todo el reporte: dos códigos distintos (A100 es el mismo en RTE y en Packing), cuatro corridas, tres líneas', [day.distinct, day.rows.length, day.lines], [2, 4, 3])
    eq('un código que sigue corriendo: su turno está en curso y su duración sigue', clockOf(m.reportOf(st(), DAY, oct(10, 19, 40), { only: 'Spiral' }).byDept[0]), ['19:00', '19:40', 40, true, 1, 1, 1])
    // the clock of the shift in course, on the room's card
    const tick = (dept, date, at) => { const t = m.deptToday(st(), dept, date, at); return [t.shift, hm(t.shiftSince), hm(t.shiftUntil), min(t.shiftMs)] }
    eq('el reloj del turno 2 en RTE: empezó a las 3:30 (una línea venía corriendo) y se paró a las 6:40, cuando terminó el último código', [tick('RTE', DAY, oct(10, 19, 0)), tick('RTE', DAY, oct(10, 22, 0))], [[2, '15:30', '18:40', 190], [2, '15:30', '18:40', 190]])
    eq('en Spiral, que empezó a las 7:00 PM y sigue: cuenta mientras algo corre', [tick('Spiral', DAY, oct(10, 19, 40)), tick('Spiral', DAY, oct(10, 21, 0))], [[2, '19:00', '', 40], [2, '19:00', '', 120]])
    eq('un departamento que no ha empezado en este turno no tiene reloj', tick('Kitchen', DAY, oct(10, 19, 40)), [2, '', '', 0])
    clock = oct(11, 6, 10); m.startRun(l1, 'D900', '6284', '2026-10-11', 240)
    eq('al otro día el reloj vuelve a empezar de cero con el primer código del turno 1', [tick('RTE', '2026-10-11', oct(11, 6, 10)), tick('RTE', '2026-10-11', oct(11, 6, 40))], [[1, '6:10', '', 0], [1, '6:10', '', 30]])
  })
}
{
  // the hours set by the manager reach the other devices
  mgr.use((m) => m.setShifts('2027-01-01', { first: '07:00', firstEnd: '15:00', second: '15:30', secondEnd: '23:30' })); settle()
  eq('el horario que pone el manager llega a la tablet', [tab.use((m) => hrs(m.shiftsOf(m.store.get(), '2027-01-02'))), tab.use((m) => hrs(m.shiftsOf(m.store.get(), DAY))), all.map((d) => d.use((m) => m.outbox.size()))], [['07:00', '15:00', '15:30', '23:30'], hrs(NO_GAP), [0, 0]])
}

// =====================================================================================================================
console.log('')
if (failed.length) { console.log(failed.length + ' FALLARON de ' + (passed + failed.length) + ':\n'); for (const f of failed) console.log('  ✗ ' + f + '\n'); process.exit(1) }
console.log('✓ ' + passed + ' comprobaciones, todas correctas')
process.exit(0)
