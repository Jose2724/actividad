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
  eq('lo registraron los dos cuartos: cuentan las mezclas del que más lleva (Kitchen), no la suma de los dos', [a.mixRoom, a.mixesDone], ['Kitchen', 4])
  eq('cajas programadas = 10 mezclas × 18.5', a.casesPlan, 185)
  eq('pouches programados = 185 cajas × 8', a.pouchesPlan, 1480)
  eq('pallets programados = 185 ÷ 36', a.palletsPlan, 5.14)
  eq('cajas esperadas = 4 mezclas hechas × 18.5', a.casesExp, 74)
  eq('pouches esperados = 74 × 8', a.pouchesExp, 592)
  eq('pallets esperados = 74 ÷ 36', a.palletsExp, 2.06)
  eq('pouches hechos (RTE, las dos líneas)', a.pouchesDone, 1120)
  eq('cajas hechas (Packing), MFO y pallets', [a.casesDone, a.mfo, a.palletsDone], [72, [{ word: 'cajas', qty: 30 }], 2])
  eq('waste del código', a.wasteLb, 2.25)
  eq('Pend. pouches = esperado − hecho', m.pending(a.pouchesExp, a.pouchesDone), -528)
  eq('Faltan pouches = programado − hecho', m.pending(a.pouchesPlan, a.pouchesDone), 360)
  eq('Pend. y Faltan de cajas', [m.pending(a.casesExp, a.casesDone), m.pending(a.casesPlan, a.casesDone)], [2, 113])
  const b = rows[1]
  eq('sin yield en la tabla: no se inventa un esperado de 0', [b.casesExp, b.pouchesExp, b.palletsExp, b.pouchesDone], [null, null, null, 288])
  const c = rows[2]
  eq('se hicieron 5 de 3 programadas: pendiente −2, como en la hoja de la oficina', [c.scheduled, c.mixesDone, c.mixesPending], [3, 5, -2])
  eq('71.4 × 2 × 5 da 714 exacto, sin restos', [c.casesExp, c.pouchesExp], [357, 714])
  // a code whose mezclas are made in Spiral, as the office's sheet reads them from the Spiral sheet
  m.setSchedule('2026-10-05', 'C300', 6)
  m.applyRemote('act_runs', runRow({ id: 'sp5', dept: 'Spiral', lineId: 'S1', code: 'C300', date: '2026-10-05', startedAt: T0, units: [unit(T0 + 10 * M), unit(T0 + 20 * M), unit(T0 + 30 * M), unit(T0 + 40 * M)] }))
  const sp = m.avanceRows(m.store.get(), '2026-10-05')[0]
  eq('un código que solo registra Spiral: sus mezclas hechas son las de Spiral, y con ellas baja lo pendiente', [sp.code, sp.mixRoom, sp.scheduled, sp.mixesDone, sp.mixesPending, sp.spiralDone], ['C300', 'Spiral', 6, 4, 2, 4])
  eq('y lo esperado sale de esas mezclas: 4 × 71.4 cajas, × 2 pouches', [sp.casesExp, sp.pouchesExp], [285.6, 571.2])
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
// the server's own clock: each version it takes is stamped after the one before (migrations/003), and whoever hears a
// version hears it with its stamp. A version is known by its content, so a late echo of it carries the stamp it got
let landed = T0
const stamps = new Map()
const contentOf = (row) => JSON.stringify({ ...row, synced_at: 0 })
const land = (it) => { landed += 1000; const row = { ...it.row, synced_at: iso(landed) }; stamps.set(contentOf(it.row), row.synced_at); server.set(it.table + '|' + it.key, row) }
const ack = (d, it) => d.use((m) => m.markSent(it))
// (a row a device sends carries the stamp of the version it started from; the server stamps it anew, as the trigger does)
const hear = (to, it) => { const row = { ...it.row, synced_at: stamps.get(contentOf(it.row)) ?? it.row.synced_at ?? iso(landed + 1) }; for (const o of to) o.use((m) => m.applyRemote(it.table, row)) }
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

section('El servidor manda: una copia vieja con el reloj adelantado no vuelve a abrir lo que otro terminó')
{
  // 2026-10-16: on RTE's Línea 1 a code ended by the tablet came back open, and two codes were open at once. A
  // device whose clock ran ahead held a copy stamped later than the real end, took the server's version for the
  // older one and wrote its own back. Now the server's order of versions is the truth, whatever the clocks say
  const { id, base } = newRun(2)
  // the manager's phone runs 30 minutes fast and writes the waste; the tablet has not heard of it yet
  clock = base + 50 * M; mgr.use((m) => m.addWaste(id, 2)); send(mgr, [mgr])
  // the tablet, with the right clock, ends the code: it brings the server's version first, merges and sends
  clock = base + 25 * M; tab.use((m) => m.endRun(id)); comeBack(tab)
  agreed('el código terminado queda terminado también en el teléfono adelantado, con su waste', id, { units: cartsAt(base, [10, 20]), waste: 2, code: 'A100', ended: true })
  // a copy that differs but brings nothing new (an echo of a version the server already left behind) changes nothing
  const old = { ...server.get('act_runs|' + id), ended_at: null, synced_at: iso(T0) }
  hear(all, { table: 'act_runs', row: old })
  eq('un eco de una versión vieja no reabre el código ni manda nada', [all.map((d) => !!runOn(d, id).endedAt), all.map((d) => d.use((m) => m.outbox.size()))], [[true, true], [0, 0]])
}

section('Dos códigos abiertos a la vez en una línea: la tarjeta va con el más nuevo y un manager termina el que sobra')
{
  // the fault seen on 2026-10-16: two devices that could not see each other each started a code on the same line
  clock += 10 * M
  const base = clock
  tab.use((m) => m.addLine('RTE', 'Línea Z')); settle()
  const line = tab.use((m) => m.store.get().lines.find((l) => l.name === 'Línea Z')), lid = line.id
  tab.use((m) => m.startRun(line, 'A100', '6283', DAY, 240))
  clock = base + 10 * M; const id = tab.use((m) => m.store.get().runs.at(-1).id); tab.use((m) => m.unitDone(id, 240)); settle()
  clock = base + 15 * M
  mgr.use((m) => m.startRun(m.store.get().lines.find((l) => l.id === lid), 'A101', '6283', DAY, 240)); settle()
  const bid = mgr.use((m) => m.store.get().runs.at(-1).id)
  eq('los dos aparatos ven dos códigos abiertos en la línea, y la tarjeta va con el más nuevo', all.map((d) => d.use((m) => [m.openRuns(m.store.get(), lid).length, m.openRun(m.store.get(), lid).id === bid])), [[2, true], [2, true]])
  clock = base + 18 * M; tab.use((m) => m.unitDone(id, 240)); settle() // a cart still lands on the old one, from a device that showed it
  clock = base + 20 * M; mgr.use((m) => m.endOlderRuns(lid)); settle()
  eq('el viejo termina en su última unidad (vino después de que empezó el nuevo), el nuevo sigue, y queda en el historial', [all.map((d) => [Math.round((runOn(d, id).endedAt - base) / M), !!runOn(d, bid).endedAt]), mgr.use((m) => m.store.get().changes.some((c) => /abierta a la vez que A101/.test(c.before)))], [[[18, false], [18, false]], true])
  eq('con un solo código abierto no hay nada que terminar', mgr.use((m) => { m.endOlderRuns(lid); return m.openRuns(m.store.get(), lid).length }), 1)
  eq('nada pendiente', all.map((d) => d.use((m) => m.outbox.size())), [0, 0])
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
  eq('fila que el servidor no acepta de quien entró (de otro cuarto, o una sesión que ya no vale): nunca se tira, espera a quien pueda subirla', m.verdict('42501', 'new row violates row-level security policy for table "act_lines"'), 'refused')
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
  // what is only in memory would be lost by a reload: a new version does not come in by itself (audit 2026-10-17, S9)
  eq('con la memoria llena, una versión nueva no recarga la app sola aunque nadie toque nada', m.quietToReload(clock, clock - 61_000, false, false), false)
  quota.delete('small')
  m.unitDone(id, 240)
  eq('al haber espacio otra vez: se guarda todo y el aviso se quita', [m.storageFull.get(), JSON.parse(localStorage.getItem('act_v1')).runs.find((r) => r.id === id).units.length, JSON.parse(localStorage.getItem('act_outbox')).some((i) => i.key === id)], [false, 1, true])
  eq('y la versión nueva ya puede entrar', m.quietToReload(clock, clock - 61_000, false, false), true)
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
  eq('primera vez: el programa de cada cuarto, de esos días', ask('act_plan', first.act_plan), '?select=*&date=gte.2026-09-27')
  eq('primera vez: líneas, productos y metas, completos', [first.act_lines, first.act_products, first.act_targets].map((f) => f === undefined), [true, true, true])
  eq('un día viejo: sus corridas, los paros de alrededor, su historial y su programa', Object.fromEntries(m.dayPull('2026-09-01').map(([t, narrow]) => [t, ask(t, narrow)])), {
    act_runs: '?select=*&date=eq.2026-09-01',
    act_stops: '?select=*&started_at=gte.' + day('2026-09-01', -1) + '&started_at=lt.' + day('2026-09-01', 2),
    act_changes: '?select=*&at=gte.' + day('2026-09-01') + '&at=lt.' + day('2026-09-01', 1),
    act_schedule: '?select=*&date=eq.2026-09-01',
    act_plan: '?select=*&date=eq.2026-09-01',
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
  // 2026-10-17: what waits is only what the server will not take from this session (refused, or another room's, see
  // outbox.ts). Waiting for "Sincronizado" would be for ever, and leaving loses nothing: "Entrar de nuevo" on the red
  // bar asks this same question, and it must not send the person back to wait
  const held = (pending, refused, other, state = 'online') => m.leaveAsk({ state, pending, refused, other }, true)
  eq('lo que espera es solo lo que el servidor no acepta de esta sesión: salir no pierde nada, y no dice que espere', [held(2, 2, 0).title, held(2, 2, 0).danger, held(2, 2, 0).yes, /Hay 2 registros/.test(held(2, 2, 0).text), /no los acepta/.test(held(2, 2, 0).text), /Sincronizado/.test(held(2, 2, 0).text)], ['Todavía hay registros sin subir', false, 'Salir', true, true, false])
  eq('igual con registros de otro cuarto que esperan a alguien de ese cuarto, y en singular', [held(1, 0, 1).danger, /Hay 1 registro/.test(held(1, 0, 1).text), /no lo acepta/.test(held(1, 0, 1).text), held(3, 1, 2).danger], [false, true, true, false])
  eq('si además hay algo que sí puede subir, sigue pidiendo que espere', [held(3, 1, 1).danger, /Sincronizado/.test(held(3, 1, 1).text)], [true, true])
  eq('sin señal sigue diciendo que no salga', [held(2, 2, 0, 'offline').danger, /No salgas/.test(held(2, 2, 0, 'offline').text)], [true, true])
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
  const owner = { id: 'o', user_id: 'uo', username: null, role: 'admin', act_role: 'mgr' } // the owner signs in with an e-mail, not a user name
  const boss = { id: 'b', user_id: 'ub', username: 'jefe.turno', act_role: 'mgr' } // another manager
  const office = { id: 'f', user_id: 'uf', username: 'olga.ofi', act_role: 'office' }
  const oper = { id: 'p', user_id: 'up', username: 'maria.rte', act_role: 'op' }
  const noAccount = { id: 'n', user_id: null, username: null }
  // who is looking: their row, whether they are the owner (a Freezer RTE admin), and the powers they hold
  const looker = (id, role, admin = false, powers = null) => ({ id, admin, powers: m.powersOf({ role, admin, powers: m.cleanPowers(powers) }) })
  const MGR = looker('b', 'mgr'), OTHER_MGR = looker('x', 'mgr'), OWNER = looker('o', 'mgr', true), OFFICE = looker('f', 'office'), PEDRO = looker('pp', 'op', false, ['people', 'fix'])
  // answers in this order: change the role, change the PIN, turn on / off, change the name, powers
  const can = (row, me) => { const r = m.rowRights(row, me); return [r.role, r.pin, r.active, r.edit, r.powers].map((x) => (x ? 'sí' : 'no')).join(' ') + (r.locked ? ' protegida' : '') + (r.mine ? ' mía' : '') }
  eq('otro manager no puede hacer nada con la cuenta del dueño', can(owner, MGR), 'no no no no no protegida')
  eq('el dueño en su propia fila: su rol y su nombre; desactivarse, no', can(owner, OWNER), 'sí no no sí no mía')
  eq('un manager en su propia fila: su PIN y su nombre sí; su rol, sus poderes y desactivarse, no', can(boss, MGR), 'no sí no sí no mía')
  // until 2026-10-18 a manager could do everything with another manager's row; Jose decided that day that manager and
  // office accounts are his alone: to anybody else they are as protected as his own
  eq('con la fila de otro manager o de la Oficina: nada (Jose, 2026-10-18)', [can(boss, OTHER_MGR), can(office, MGR), can(boss, OFFICE), can(office, PEDRO)], ['no no no no no protegida', 'no no no no no protegida', 'no no no no no protegida', 'no no no no no protegida'])
  eq('la Oficina en su propia fila, como un manager', can(office, OFFICE), 'no sí no sí no mía')
  eq('con la de un operador: todo', [can(oper, MGR), can(oper, OFFICE), can(oper, PEDRO)], ['sí sí sí sí sí', 'sí sí sí sí sí', 'sí sí sí sí sí'])
  eq('el dueño, con la de un manager y la de la Oficina: todo', [can(boss, OWNER), can(office, OWNER)], ['sí sí sí sí sí', 'sí sí sí sí sí'])
  eq('una persona sin cuenta: rol, activar y nombre; no hay PIN que cambiar ni poderes sin rol', can(noAccount, MGR), 'sí no sí sí no')
  eq('si no se sabe quién mira, la cuenta del dueño sigue protegida', can(owner, looker('', 'mgr')), 'no no no no no protegida')
  // another Freezer RTE admin (signs in with a user name): the owner's alone, as the act-users function says since
  // 2026-10-18 (audit E1: a manager changed that admin's PIN and signed in as them)
  const fzAdmin = { id: 'fa', user_id: 'ufa', username: 'admin.freezer', role: 'admin' }
  eq('un manager no puede tocar la cuenta de un admin de Freezer RTE', can(fzAdmin, MGR), 'no no no no no protegida')
  eq('el dueño sí (sus poderes ya son todos), y ese admin en su propia fila lo de siempre', [can(fzAdmin, OWNER), can(fzAdmin, looker('fa', null, true))], ['sí sí sí sí no', 'sí sí no sí no mía'])
  // a Freezer RTE crew account: its Actividad role, powers and shift, yes; its PIN, name and on/off (its Freezer sign-in),
  // the owner (the lead, 2026-10-18). Its powers and shift are Actividad's alone: a review of that day found the first
  // version kept them from everybody but the owner, so a manager made a crew worker an operator with no way to set a shift
  const crew = { ...fzAdmin, id: 'w', role: 'worker', act_role: 'op' }
  eq('un trabajador de Freezer RTE: un manager le da o le cambia el rol, los poderes y el turno; el dueño todo', [can(crew, MGR), can(crew, PEDRO), can(crew, OWNER), can({ ...crew, act_role: null }, MGR), can({ ...crew, act_role: 'viewer' }, MGR)], ['sí no no no sí', 'sí no no no sí', 'sí sí sí sí sí', 'sí no no no no', 'sí no no no no'])
  eq('uno que el dueño hizo manager: protegido para los demás', can({ ...crew, act_role: 'mgr' }, MGR), 'no no no no no protegida')
  // a new PIN hands the account over: nobody but the owner re-PINs one that holds a power they do not hold
  const lead = { ...oper, id: 'l', act_powers: ['othershift'] }
  eq('el PIN de un operador con un poder que quien mira no tiene, no; lo demás sí', [can(lead, MGR), can(lead, OFFICE), can(lead, OWNER), can({ ...oper, act_powers: ['del'] }, PEDRO)], ['sí no sí sí sí', 'sí sí sí sí sí', 'sí sí sí sí sí', 'sí no sí sí sí'])
  eq('los roles que se dan: el dueño todos, los demás operador y "Solo ver"', [m.rowRights(oper, OWNER).roles, m.rowRights(oper, MGR).roles, m.rolesGiven(false), m.rolesGiven(true)], [['op', 'mgr', 'office', 'viewer'], ['op', 'viewer'], ['op', 'viewer'], ['op', 'mgr', 'office', 'viewer']])
  eq('y los poderes que se pueden marcar, los de quien mira', [m.rowRights(oper, MGR).grant.includes('othershift'), m.rowRights(oper, OFFICE).grant.includes('othershift'), m.rowRights(oper, PEDRO).grant, m.rowRights(oper, OWNER).grant.length], [false, true, ['fix', 'people'], 10])
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
  eq('con un código corriendo no se pone así (para eso está su botón "Set up", y la razón Set up de "Parar")', open().length, 0)
  clock = T0 + 30 * M; m.startStop('RTE', line.id, 'Set up', '')
  clock = T0 + 40 * M; m.endStop(open()[0].id)
  // what Jose asked on 2026-10-15: a set up is never shown as a stop. While the code runs it is not working time and
  // not stopped time either: it is counted apart, as the set up of that code
  const sx = () => m.runStats(st(), st().runs[0], clock)
  eq('un Set up puesto mientras corre el código no es parado: cuenta aparte, como Set up de ese código', [sx().down / M, sx().setup / M, sx().reasons, sx().working / M], [0, 10, {}, 10])
  // a stop that turns out to be a set up goes on as a set up, from that moment
  clock = T0 + 42 * M; m.startStop('RTE', line.id, 'Problema mecánico', '')
  clock = T0 + 45 * M; m.switchToSetup(open()[0].id)
  eq('un paro que resulta ser Set up se pasa a Set up en un toque: el paro termina y el Set up empieza ahí', open().map((x) => [x.reason, (x.startedAt - T0) / M]), [['Set up', 45]])
  clock = T0 + 48 * M
  eq('y cada tiempo queda en lo suyo: 3 minutos parado por problema mecánico, 13 de Set up', [sx().down / M, sx().setup / M, sx().reasons], [3, 13, { 'Problema mecánico': 3 * M }])
  const inShift = m.runInShift(st(), st().runs[0], clock, m.shiftsOf(st(), DAY), 2) // 3:20 PM on: the second shift
  eq('igual en el turno', [inShift.down / M, inShift.setup / M, inShift.reasons], [3, 13, { 'Problema mecánico': 3 * M }])
  // the code ends with nothing more today: the set up begun while it ran ends with it, nothing is left counting
  clock = T0 + 50 * M; m.endRun(st().runs[0].id, false)
  eq('si el código termina sin nada más por hoy, el Set up que corría termina con él', [open().length, st().stops.filter((x) => x.reason === 'Set up').map((x) => (x.endedAt - T0) / M)], [0, [15, 40, 50]])
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
  const of = (l, k) => { const g = m.lineShiftGoalOf(st(), l.id, k); return [g.perHour, g.total, g.own] }
  eq('una línea sin meta no tiene ninguna, en ningún turno', [of(l1, 1), of(l1, 2)], [[null, null, false], [null, null, false]])
  m.setLineShiftGoal(l1, 2, 300, 2400)
  eq('el manager del turno 2 le pone meta a una línea, por hora y del turno: es de ese turno y de esa línea', [of(l1, 2), of(l1, 1), of(l2, 2)], [[300, 2400, true], [null, null, false], [null, null, false]])
  eq('queda en el historial, con el nombre de la línea y el turno', st().changes.filter((c) => /^Meta Línea 1 \(RTE\)/.test(c.what)).map((c) => [c.what.split(' · ').slice(1).join(' · '), c.by, c.before, c.after]), [['Turno 2 · por hora', 'Santiago', '', '300'], ['Turno 2 · del turno', 'Santiago', '', '2400']])
  eq('sube al servidor con las metas (act_targets), con la llave de la línea y su turno', m.outbox.items().filter((i) => i.table === 'act_targets').map((i) => [i.key === 'line:' + l1.id + '@2', i.row.dept === 'line:' + l1.id + '@2', i.row.per_hour, i.row.per_shift]), [[true, true, 300, 2400]])
  eq('la meta del departamento es otra cosa: no se toca', [st().targets.length, m.shiftGoalOf(st(), 'RTE', 2)], [0, { perHour: null, total: null, own: false }])
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
  m.applyRemote('act_targets', { dept: 'line:' + l2.id + '@2', per_hour: 120, per_shift: null, updated_at: iso(T0 + 5 * M) })
  eq('una meta puesta en otro aparato llega (y no se confunde con una meta de línea de las de antes)', [of(l2, 2), st().targets.length, st().lineTargets.length], [[120, null, true], 0, 0])
  m.applyRemote('act_targets', { dept: 'line:' + l2.id + '@2', per_hour: 999, per_shift: 999, updated_at: iso(T0 + 2 * M) })
  eq('una más vieja no pisa a la más nueva', of(l2, 2)[0], 120)
  // the goal a line had before, one for both shifts (a tablet with an older version of the app still writes it)
  m.applyRemote('act_targets', { dept: 'line:' + l1.id, per_hour: 250, per_shift: 5000, updated_at: iso(T0) })
  eq('la meta de antes, una para los dos turnos: su ritmo sigue valiendo para el turno que no ha puesto la suya; su total era del día y no es de ningún turno', [of(l1, 1), of(l1, 2)], [[250, null, false], [300, 2400, true]])
  m.setLineShiftGoal(l1, 2, null, null)
  eq('quitarla la deja en blanco para ese turno (ya no hereda el ritmo de antes), sin tocar el otro, y queda en el historial', [of(l1, 2), of(l1, 1), st().changes.filter((c) => /^Meta Línea 1/.test(c.what)).length], [[null, null, true], [250, null, false], 4])
})
{
  const kept = await device('lg-kept', { seed: { lines: [{ id: 'L1', dept: 'RTE', name: 'Línea 1', updatedAt: 1 }], runs: [], stops: [], products: [], lineTargets: [{ lineId: 'L1', perHour: 250, perDay: 2000, updatedAt: 3 }, { perHour: 1 }, { lineId: 'L1@2', perHour: 9, updatedAt: 4 }], turnGoals: [{ key: 'line:L1@1', perHour: 200, total: 1500, updatedAt: 5 }, { key: 'RTE@2', perHour: 1500, total: 9000, updatedAt: 6 }, { key: 'nada', perHour: 1 }, { perHour: 2 }] } })
  eq('al abrir la app otra vez, las metas siguen ahí: la de la línea en su turno, la del departamento en el suyo, y lo que no es una meta no entra', kept.use((m) => { const st = m.store.get(), g = (x) => [x.perHour, x.total, x.own]; return [g(m.lineShiftGoalOf(st, 'L1', 1)), g(m.lineShiftGoalOf(st, 'L1', 2)), g(m.shiftGoalOf(st, 'RTE', 2)), g(m.shiftGoalOf(st, 'RTE', 1)), st.turnGoals.length, st.lineTargets.length, st.lines.length] }), [[200, 1500, true], [250, null, false], [1500, 9000, true], [null, null, false], 2, 1, 1])
  // a device that kept things from before this version opens without trouble (it had no goals of a shift)
  const old = await device('lg-old', { seed: { lines: [{ id: 'L1', dept: 'RTE', name: 'Línea 1', updatedAt: 1 }], runs: [], stops: [], products: [], targets: [{ dept: 'RTE', perHour: 500, perShift: 9000, updatedAt: 2 }] } })
  eq('un aparato con lo guardado por la versión anterior abre bien: su ritmo por hora sigue, su meta del día ya no es de ningún turno', old.use((m) => [m.shiftGoalOf(m.store.get(), 'RTE', 1), m.shiftGoalOf(m.store.get(), 'RTE', 2), m.store.get().turnGoals]), [{ perHour: 500, total: null, own: false }, { perHour: 500, total: null, own: false }, []])
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
section('Lo guardado con una semana de turnos y un día aparte se vuelve a leer entero (2026-10-17: los aparatos abrían vacíos)')
{
  // the version of 2026-10-17 ~15:00 read the saved week with a const declared further down the module: a device that
  // had saved one (any device that pulled the row) opened with an empty plant and "Sincronizado" on the screen
  const wk = await device('wk', { seed: { lines: [{ id: 'k1', dept: 'Kitchen', name: 'Braiser 1', updatedAt: 1 }, { id: 'r1', dept: 'RTE', name: 'Línea 1', updatedAt: 1 }], runs: [], stops: [], products: [], schedule: {}, changes: [], targets: [], shifts: [NO_GAP], shiftWeeks: [{ from: '2026-10-17', week: '3333331', updatedAt: 1 }], dayShifts: [{ date: '2026-10-17', only: 1, updatedAt: 1 }], lineRules: { add: false, remove: true, updatedAt: 5 } } })
  wk.use((m) => eq('las líneas, la semana, el día aparte y lo que pueden los operadores siguen ahí al volver a abrir', [m.store.get().lines.map((l) => l.name), m.weekOf(m.store.get(), '2026-10-17'), m.shiftsOf(m.store.get(), '2026-10-17').only, m.store.get().lineRules], [['Braiser 1', 'Línea 1'], '3333331', 1, { add: false, remove: true, updatedAt: 5 }]))
}
section('Lo guardado que no se puede leer: el aparato lo dice y olvida su cursor, para volver a bajar todo')
{
  // the stored state is broken (here: lines that are not a list); the app must not go on with a cursor as if it still held the plant
  on = 'broken'; localStorage.setItem('act_since2', '2026-10-17T12:00:00.000Z')
  const broken = await device('broken', { seed: { lines: 5, runs: [], stops: [] } })
  broken.use((m) => eq('arranca de cero y sin cursor: la siguiente bajada trae todo', [m.store.get().lines.length, localStorage.getItem('act_since2')], [0, null]))
}
section('Calendario de planta: días de un solo turno (la semana, y un día aparte)')
{
  // Saturday 2026-10-17: the second shift did not come, and from the hand-over at 3:15 PM everything the first shift
  // made was counted as the second's (Jose: "ahora sale como que es el turno 2 que está registrando"). A day of work
  // with one shift gives all of its records to that shift, and the plant's week says which days are like that.
  const cal = await device('cal', { user: 'Jose', usual: true })
  cal.use((m) => {
    const st = () => m.store.get()
    const SAT = '2026-10-17', FRI = '2026-10-16', SUN = '2026-10-18'
    clock = oct(17, 16, 0)
    eq('mientras nadie lo diga, los dos turnos trabajan todos los días', [m.weekOf(st(), SAT), m.shiftsOf(st(), SAT).only, m.shiftAt(m.shiftsOf(st(), SAT), oct(17, 16, 0))], ['3333333', undefined, 2])
    eq('un día aparte: solo el turno 1, todo el día de trabajo', [m.setDayShifts(SAT, 1), m.shiftsOf(st(), SAT).only, m.shiftAt(m.shiftsOf(st(), SAT), oct(17, 16, 0)), m.shiftAt(m.shiftsOf(st(), SAT), oct(18, 2, 0)), m.shiftsOf(st(), FRI).only], [true, 1, 1, 1, undefined])
    const t = m.turnOf(st(), SAT, oct(17, 16, 0))
    eq('el turno en curso es el 1, entre el corte de la noche y el siguiente', [t.shift, t.since, t.until], [1, oct(17, 3, 30), oct(18, 3, 30)])
    eq('el día de trabajo no cambia por eso', [m.plainDay(st(), oct(17, 23, 0)), m.plainDay(st(), oct(18, 3, 0)), m.plainDay(st(), oct(18, 3, 30))], [SAT, SAT, SUN])
    // what the first shift made that afternoon is its own, on the room's card and in the report
    m.addLine('RTE', 'Línea 1'); const l = st().lines.find((x) => x.dept === 'RTE')
    clock = oct(17, 15, 40); m.startRun(l, 'A100', '6287', SAT, 240)
    clock = oct(17, 16, 0); m.unitDone(st().runs[0].id, 240)
    const td = m.deptToday(st(), 'RTE', SAT, oct(17, 16, 10))
    eq('la tarjeta del cuarto: turno 1, único de hoy, con lo hecho a las 4 PM', [td.shift, td.only, td.shiftQty, td.made], [1, 1, 240, [240, 0]])
    const rep = m.reportOf(st(), SAT, oct(17, 16, 10), { only: 'RTE' })
    eq('el reporte: todo del turno 1; pedir el turno 2 da el día entero', [rep.byShift[0].first.qty, rep.byShift[0].second.qty, rep.plan.only, m.reportOf(st(), SAT, oct(17, 16, 10), { only: 'RTE', shift: 2 }).shift, m.reportOf(st(), SAT, oct(17, 16, 10), { only: 'RTE', shift: 1 }).shift], [240, 0, 1, 0, 1])
    eq('sube al servidor con lo que fija el manager, y queda en el historial', [m.outbox.items().filter((i) => i.table === 'act_targets').map((i) => [i.key, i.row.per_hour]), st().changes.filter((c) => c.refKey === 'shiftday:' + SAT).map((c) => [c.before, c.after])], [[['shiftday:2026-10-17', 1]], [['Turnos 1 y 2', 'Solo el turno 1']]])
    // the week: Saturdays with one shift from a date on; a day apart beats the week; "as its week" takes the day back
    eq('la semana: los sábados solo el turno 1 desde el 2026-10-24', [m.setShiftWeek('2026-10-24', '3333331'), m.shiftsOf(st(), '2026-10-31').only, m.shiftsOf(st(), '2026-10-30').only, m.shiftsOf(st(), '2026-10-24').only, m.shiftsOf(st(), '2026-10-10').only], [true, 1, undefined, 1, undefined])
    eq('un día aparte manda sobre la semana, y "como su semana" lo quita', [m.setDayShifts('2026-10-31', 3), m.shiftsOf(st(), '2026-10-31').only, m.setDayShifts('2026-10-31', null), m.shiftsOf(st(), '2026-10-31').only, st().dayShifts.length], [true, undefined, true, 1, 1])
    eq('lo que no es no se guarda', [m.setShiftWeek('2026-10-24', '333333'), m.setShiftWeek('hoy', '3333333'), m.setDayShifts('ayer', 1), m.setDayShifts(SAT, 5)], [false, false, false, false])
    eq('la semana queda en el historial con sus días', st().changes.filter((c) => c.refKey === 'shiftweek:2026-10-24').map((c) => [c.before, c.after]), [['Turnos 1 y 2 todos los días', 'dom 1 y 2, lun 1 y 2, mar 1 y 2, mié 1 y 2, jue 1 y 2, vie 1 y 2, sáb solo 1']])
    // what arrives from another device (or the office)
    m.applyRemote('act_targets', { dept: 'shiftday:2026-10-18', per_hour: 2, per_shift: null, updated_at: new Date(oct(17, 17, 0)).toISOString() })
    m.applyRemote('act_targets', { dept: 'shiftweek:2026-11-01', per_hour: 3333333, per_shift: null, updated_at: new Date(oct(17, 17, 0)).toISOString() })
    eq('lo que llega: un domingo solo del turno 2, y la semana de siempre desde noviembre', [m.shiftsOf(st(), SUN).only, m.shiftAt(m.shiftsOf(st(), SUN), oct(18, 8, 0)), m.turnOf(st(), SUN, oct(18, 8, 0)).shift, m.shiftsOf(st(), '2026-11-07').only], [2, 2, 2, undefined])
    m.applyRemote('act_targets', { dept: 'shiftday:2026-10-18', per_hour: null, per_shift: null, updated_at: new Date(oct(17, 17, 1)).toISOString() })
    eq('un día aparte retirado desde otro aparato', m.shiftsOf(st(), SUN).only, undefined)
    eq('lo que llega sin sentido no entra', [(m.applyRemote('act_targets', { dept: 'shiftweek:2026-12-01', per_hour: 4444444, per_shift: null, updated_at: new Date(oct(17, 17, 2)).toISOString() }), st().shiftWeeks.some((x) => x.from === '2026-12-01')), (m.applyRemote('act_targets', { dept: 'shiftday:2026-12-01', per_hour: 7, per_shift: null, updated_at: new Date(oct(17, 17, 2)).toISOString() }), st().dayShifts.some((x) => x.date === '2026-12-01'))], [false, false])
  })
}
section('Un día de un solo turno que trabaja desde la mañana: todo es de ese turno, y el tiempo no se corta a las 3')
{
  // Jose, 2026-10-17: on Sunday the second shift works from 6 AM to 6 PM or more, and all of it is the second shift's,
  // "incluso los tiempos"
  const sun = await device('sun', { user: 'Jose', usual: true })
  sun.use((m) => {
    const st = () => m.store.get(), SUN = '2026-10-18'
    clock = oct(17, 22, 0); m.setDayShifts(SUN, 2)
    m.addLine('RTE', 'Línea 1'); const l = st().lines.find((x) => x.dept === 'RTE')
    clock = oct(18, 6, 0); m.startRun(l, 'A100', '6291', SUN, 240)
    const id = st().runs.at(-1).id
    clock = oct(18, 14, 50); m.unitDone(id, 240) // then nothing recorded from 2:50 to 4:00 PM: a long cart
    clock = oct(18, 16, 0); m.unitDone(id, 240)
    clock = oct(18, 18, 0); m.endRun(id, false)
    const r = st().runs.find((x) => x.id === id), stt = m.runStats(st(), r, clock)
    eq('las doce horas cuentan trabajando: la media hora de las 3 no se aparta en un día de un solo turno', Math.round(stt.working / 60_000), 12 * 60)
    const rep = m.reportOf(st(), SUN, clock, { only: 'RTE' })
    eq('el reporte: todo del turno 2, nada del 1', [rep.byShift[0].second.qty, rep.byShift[0].first.qty, rep.plan.only], [480, 0, 2])
    eq('y las horas del turno se dicen "todo el día"', m.shiftHours(rep.plan, 2), 'todo el día')
    const td = m.deptToday(st(), 'RTE', SUN, oct(18, 10, 0))
    eq('a las 10 AM la tarjeta del cuarto es del turno 2', td.shift, 2)
  })
  // a normal day keeps its hand-over: the half hour between shifts with nothing recorded is still set aside
  const nor = await device('nor', { user: 'Jose', usual: true })
  nor.use((m) => {
    const st = () => m.store.get()
    m.addLine('RTE', 'Línea 1'); const l = st().lines.find((x) => x.dept === 'RTE')
    clock = oct(14, 13, 0); m.startRun(l, 'A100', '6287', '2026-10-14', 240)
    const id = st().runs.at(-1).id
    clock = oct(14, 14, 50); m.unitDone(id, 240)
    clock = oct(14, 16, 0); m.unitDone(id, 240); m.endRun(id, false)
    eq('un día normal sigue apartando la media hora entre turnos sin registros', Math.round(m.runStats(st(), st().runs.find((x) => x.id === id), clock).working / 60_000), 180 - 30)
  })
}
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
  eq('de noche, pasada la 1:00 AM, un código que sigue corriendo cuenta la primera hora; con una hora sin registros, ese rato espera (nada se termina solo)', [stats('G700', oct(11, 1, 30)), stats('G700', oct(11, 2, 0)), runOf('G700').endedAt], [[150, 0], [120, 0], null])
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
  // a stop of the evening before, which the manager deletes on his own after the purge: it is not of that purge either
  clock = oct(19, 22, 0); mgr.use((m) => m.startStop('RTE', null, 'Limpieza', 'de la noche anterior')); settle()
  const evening = mgr.use((m) => m.store.get().stops.find((x) => x.note === 'de la noche anterior').id)
  clock = oct(19, 22, 20); mgr.use((m) => m.endStop(evening)); settle()
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
  clock = oct(20, 8, 35); mgr.use((m) => m.deleteStop(evening)); settle()
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
  eq('un paro de la noche anterior que el manager borró por su cuenta después no vuelve: no era de ese borrado', [[...server].filter(([k]) => k === 'act_stops|' + evening).map(([, row]) => row.deleted), [tab, mgr].map((d) => d.use((m) => m.store.get().stops.some((x) => x.id === evening)))], [[true], [false, false]])
  eq('una sola corrida de ese día abierta en la línea, y nada pendiente de enviar', [[tab, mgr].map((d) => d.use((m) => m.store.get().runs.filter((r) => r.date === D20 && r.lineId === rte.id && !r.endedAt).length)), all.map((d) => d.use((m) => m.outbox.size()))], [[1, 1], [0, 0]])
  eq('el reporte vuelve a sumar todo el turno', mgr.use((m) => { const r = m.reportOf(m.store.get(), D20, clock, { only: 'RTE' }); return [r.rows.length, r.byDept[0].units, r.byDept[0].qty] }), [3, 4, 960])
  eq('ya no hay nada por recuperar, y queda escrito quién lo recuperó', [tab.use((m) => m.purgesOf(m.store.get(), D20).length), mgr.use((m) => m.purgesOf(m.store.get(), D20).length), tab.use((m) => m.store.get().changes.filter((c) => c.what.startsWith('Se recuperaron')).map((c) => [c.by, c.after]))], [0, 0, [['Santiago', '2 corridas · 1 paro']]])
  eq('recuperar otra vez no trae nada de más', [mgr.use((m) => m.restorePurged(purge, { runs: held('act_runs'), stops: held('act_stops'), changes: held('act_changes') })), ofDay(mgr).length], [{ runs: 0, stops: 0 }, 3])
  settle()
}
section('Cambio de turno: el turno que entra empieza de cero, sin cortar nada de lo guardado')
{
  // what the second shift's manager saw on 2026-10-13: the room's card adding the whole day, and the lines the first
  // shift left running with the first shift's carts and hours on them
  const hand = await device('hand', { user: 'Santiago', usual: true })
  hand.use((m) => {
    const st = () => m.store.get(), min = (x) => Math.round(x / M), hm = (ms) => new Date(ms).getHours() + ':' + String(new Date(ms).getMinutes()).padStart(2, '0')
    const lineOf = (dept, name) => { m.addLine(dept, name); return st().lines.find((l) => l.dept === dept && l.name === name) }
    const open = (line) => st().runs.find((r) => r.lineId === line.id && !r.endedAt), runOf = (code) => st().runs.find((r) => r.code === code)
    const seen = (code, since, at) => { const x = m.runSince(st(), runOf(code), since, at); return [x.carried, x.units, x.qty, min(x.working), min(x.down), min(x.avg), [x.before.units, x.before.qty]] }
    // the first shift: three lines of RTE and a braiser
    clock = oct(10, 11, 0); const l3 = lineOf('RTE', 'Línea 3'); m.startRun(l3, 'D400', '6283', DAY, 240)
    clock = oct(10, 11, 30); m.unitDone(open(l3).id, 240)
    clock = oct(10, 11, 44); const b1 = lineOf('Kitchen', 'Braiser 1'); m.startRun(b1, 'K10', '6283', DAY, null)
    clock = oct(10, 12, 0); const l2 = lineOf('RTE', 'Línea 2'); m.startRun(l2, 'B200', '6283', DAY, 144)
    clock = oct(10, 12, 30); m.unitDone(open(l3).id, 240); m.unitDone(open(b1).id, null)
    clock = oct(10, 12, 40); m.unitDone(open(l2).id, 144)
    clock = oct(10, 13, 0); const l1 = lineOf('RTE', 'Línea 1'); m.startRun(l1, 'A100', '6283', DAY, 240)
    clock = oct(10, 13, 30); m.unitDone(open(l1).id, 240)
    clock = oct(10, 13, 40); m.unitDone(open(b1).id, null)
    clock = oct(10, 14, 0); m.endRun(open(l2).id, false)
    clock = oct(10, 14, 30); m.unitDone(open(l1).id, 240)
    const first = m.turnOf(st(), DAY, oct(10, 14, 45)), early = m.deptToday(st(), 'RTE', DAY, oct(10, 14, 45))
    eq('en el turno 1 nada viene de otro turno: cada código se ve entero, y la tarjeta es la del turno 1', [first.shift, hm(first.since), seen('A100', first.since, oct(10, 14, 45)).slice(0, 3), [early.shift, early.shiftQty, early.shiftUnits, early.qty]], [1, '3:30', [false, 2, 480], [1, 1104, 5, 1104]])
    // the second shift: goes on with A100 on line 1, ends D400 with its last cart, and starts C300 on line 2
    clock = oct(10, 15, 40); m.startRun(l2, 'C300', '6283', DAY, 240)
    clock = oct(10, 15, 45); m.unitDone(open(l3).id, 100)
    clock = oct(10, 15, 50); m.endRun(open(l3).id, false)
    clock = oct(10, 16, 0); m.unitDone(open(l1).id, 240)
    clock = oct(10, 16, 10); m.startStop('RTE', l1.id, 'Break', '')
    clock = oct(10, 16, 20); m.endStop(st().stops.find((x) => !x.endedAt).id); m.unitDone(open(l2).id, 240)
    clock = oct(10, 16, 40); m.unitDone(open(l1).id, 200)
    clock = oct(10, 17, 0)
    const turn = m.turnOf(st(), DAY, clock), t = m.deptToday(st(), 'RTE', DAY, clock)
    eq('a las 5:00 PM el turno en curso es el 2, desde el cambio de las 3:15 PM', [turn.shift, hm(turn.since)], [2, '15:15'])
    eq('la tarjeta de RTE: lo del turno 2 desde cero (4 carros, 780 pouches); el día completo y lo del turno 1 siguen ahí', [t.shift, t.shiftQty, t.shiftUnits, t.qty, t.units, t.made], [2, 780, 4, 1884, 9, [1104, 780]])
    eq('sus códigos son los de este turno: el que sigue, el que empezó y el que terminó; el que acabó en el turno 1 no', t.shiftCodes.map((c) => [c.code, c.units, c.qty, c.lines]), [['A100', 2, 440, ['Línea 1']], ['C300', 1, 240, ['Línea 2']], ['D400', 1, 100, ['Línea 3']]])
    eq('el reloj y el ritmo son los del turno 2: desde su hora (venían líneas corriendo), 780 en hora y media', [hm(t.shiftSince), min(t.shiftMs), Math.round(t.shiftRate)], ['15:30', 90, 520])
    eq('el código que venía del turno 1: este turno lleva 2 carros y 440 pouches, 80 minutos trabajando y 10 parado; traía 2 carros y 480', seen('A100', turn.since, clock), [true, 2, 440, 80, 10, 30, [2, 480]])
    eq('el código que empezó este turno se ve entero, como siempre', seen('C300', turn.since, clock), [false, 1, 240, 80, 0, 40, [0, 0]])
    eq('el que venía y este turno terminó: de sus 3 carros, 1 es de este turno', seen('D400', turn.since, clock), [true, 1, 100, 20, 0, 15, [2, 480]])
    eq('lo terminado se reparte igual: de este turno, D400; del turno 1, B200', [st().runs.filter((r) => r.dept === 'RTE' && r.endedAt > turn.since).map((r) => r.code), st().runs.filter((r) => r.dept === 'RTE' && r.endedAt && r.endedAt <= turn.since).map((r) => r.code)], [['D400'], ['B200']])
    // Kitchen: the braiser of 11:44 AM is still running and the second shift has not made a mix yet
    const k = m.deptToday(st(), 'Kitchen', DAY, clock)
    eq('Kitchen: el braiser de las 11:44 AM viene del turno 1 con 2 mezclas; el turno 2 va en cero, con hora y media', seen('K10', turn.since, clock), [true, 0, 0, 90, 0, 0, [2, 0]])
    eq('su tarjeta: 0 mezclas en el turno 2, 2 en el día, y el código está en la lista del turno aunque no lleve nada', [k.shiftQty, k.shiftUnits, k.qty, k.made, k.shiftCodes.map((c) => [c.code, c.units, c.lines]), hm(k.shiftSince), min(k.shiftMs)], [0, 0, 2, [2, 0], [['K10', 0, ['Braiser 1']]], '15:30', 90])
    eq('lo hecho, dicho con las palabras de cada departamento', [m.unitsText('RTE', 2, 480), m.unitsText('RTE', 1, 1200), m.unitsText('Kitchen', 2, 0), m.unitsText('Kitchen', 1, 0), m.madeText(runOf('A100'), 920)], ['2 carros · 480 pouches', '1 carro · 1,200 pouches', '2 mezclas', '1 mezcla', '4 carros · 920 pouches'])
    // the goal is each shift's: the manager of the second shift sets his, and only what his shift makes counts
    m.applyRemote('act_targets', { dept: 'RTE', per_hour: 500, per_shift: 9000, updated_at: iso(oct(10, 6, 0)) }) // the goal of before: one for the whole day
    eq('la meta de antes era del día completo, de los dos turnos: a cada turno solo le deja el ritmo por hora', [m.shiftGoalOf(st(), 'RTE', 1), m.shiftGoalOf(st(), 'RTE', 2)], [{ perHour: 500, total: null, own: false }, { perHour: 500, total: null, own: false }])
    m.setShiftGoal('RTE', 2, 600, 1560)
    const goal = m.shiftGoalOf(st(), 'RTE', t.shift)
    eq('el manager del turno 2 pone la meta de su turno: es suya y la del turno 1 no se toca', [goal, m.shiftGoalOf(st(), 'RTE', 1)], [{ perHour: 600, total: 1560, own: true }, { perHour: 500, total: null, own: false }])
    eq('contra su meta cuenta solo lo de su turno: 780 de 1,560 es el 50%, aunque el día ya lleve 1,884', [t.shiftQty / goal.total, t.qty], [0.5, 1884])
    eq('queda en el historial con su turno (de qué a qué), y sube con la llave del departamento y el turno', [st().changes.filter((c) => /^Meta RTE · Turno 2/.test(c.what)).map((c) => [c.what, c.by, c.before, c.after]), m.outbox.items().filter((i) => i.table === 'act_targets').map((i) => [i.key, i.row.dept, i.row.per_hour, i.row.per_shift])], [[['Meta RTE · Turno 2 · por hora', 'Santiago', '500', '600'], ['Meta RTE · Turno 2 · del turno', 'Santiago', '', '1560']], [['RTE@2', 'RTE@2', 600, 1560]]])
    m.setShiftGoal('RTE', 1, null, 2000)
    eq('el turno 1 pone la suya sin ritmo por hora: ya no hereda el de antes, y la del turno 2 sigue igual', [m.shiftGoalOf(st(), 'RTE', 1), m.shiftGoalOf(st(), 'RTE', 2), m.shiftGoalOf(st(), 'Kitchen', 2)], [{ perHour: null, total: 2000, own: true }, { perHour: 600, total: 1560, own: true }, { perHour: null, total: null, own: false }])
    eq('lo que hizo el turno 1 se mide contra la meta del turno 1, y nada del turno 2 se le suma', [t.made[0], t.made[0] / m.shiftGoalOf(st(), 'RTE', 1).total], [1104, 0.552])
    // nothing of what is kept was cut: the run is one, and the report still says what each shift did of it
    const rep = m.reportOf(st(), DAY, clock, { only: 'RTE' })
    eq('lo guardado no se cortó: A100 sigue siendo una corrida con sus 4 carros, y el reporte dice lo de cada turno', [st().runs.filter((r) => r.code === 'A100').map((r) => [r.units.length, r.endedAt]), rep.byCode.filter((c) => c.code === 'A100').map((c) => [c.qty, c.byShift]), m.reportOf(st(), DAY, clock, { only: 'RTE', shift: 2 }).byDept[0].qty], [[[4, null]], [[920, [480, 440]]], 780])
    // the next morning, the first shift of another day starts from zero too
    const next = m.turnOf(st(), '2026-10-11', oct(11, 6, 10))
    eq('al otro día el turno 1 también empieza de cero: lo que quedó corriendo viene de antes', [next.shift, hm(next.since), seen('A100', next.since, oct(11, 6, 10)).slice(0, 3), m.deptToday(st(), 'RTE', '2026-10-11', oct(11, 6, 10)).shiftQty], [1, '3:30', [true, 0, 0], 0])
  })
}
section('El programa de cada cuarto: lo que se registra se descuenta solo')
{
  // what the office keeps in its AVANCE sheet and in each room's sheet (SCHEDULE / #BATCH, 1 TURNO, 2 TURNO, PENDING),
  // typed once in the app: which codes each room has to make that day and how much of each
  const pl = await device('plan', { user: 'Oficina', usual: true })
  pl.use((m) => {
    const st = () => m.store.get()
    const lineOf = (dept, name) => { m.addLine(dept, name); return st().lines.find((l) => l.dept === dept && l.name === name) }
    const open = (line) => st().runs.find((r) => r.lineId === line.id && !r.endedAt)
    const rows = (dept) => m.planRows(st(), DAY, dept).map((r) => [r.code, r.planned, r.done, r.byShift, r.left, r.running, r.lines])
    clock = oct(10, 5, 50)
    eq('sin programa no hay nada que mostrar', [m.planOf(st(), DAY, 'RTE'), rows('RTE')], [[], []])
    m.setPlan(DAY, 'RTE', '0100', 1000); m.setPlan(DAY, 'RTE', 'b200 ', 480); m.setPlan(DAY, 'Kitchen', '0100', 6); m.setPlan('2026-10-11', 'RTE', 'C300', 500)
    eq('la oficina pone el programa de cada cuarto en su unidad (pouches en RTE, mezclas en Kitchen); el de otro día no es de hoy', [rows('RTE'), rows('Kitchen'), rows('Packing')], [[['0100', 1000, 0, [0, 0], 1000, false, []], ['B200', 480, 0, [0, 0], 480, false, []]], [['0100', 6, 0, [0, 0], 6, false, []]], []])
    eq('queda en el historial quién puso qué, y sube con la llave del día, el cuarto y el código', [st().changes.filter((c) => c.refTable === 'act_plan').map((c) => [c.what, c.by, c.dept, c.before, c.after]).slice(0, 2), m.outbox.items().filter((i) => i.table === 'act_plan').map((i) => [i.key, i.row.date, i.row.dept, i.row.code, i.row.qty])],
      [[['Programa 2026-10-10 · RTE · 100', 'Oficina', 'RTE', '', '1000'], ['Programa 2026-10-10 · RTE · B200', 'Oficina', 'RTE', '', '480']], [['2026-10-10|RTE|100', '2026-10-10', 'RTE', '100', 1000], ['2026-10-10|RTE|B200', '2026-10-10', 'RTE', 'B200', 480], ['2026-10-10|Kitchen|100', '2026-10-10', 'Kitchen', '100', 6], ['2026-10-11|RTE|C300', '2026-10-11', 'RTE', 'C300', 500]]])
    // the first shift registers: every cart of a programmed code is taken off by itself
    clock = oct(10, 13, 0); const l1 = lineOf('RTE', 'Línea 1'); m.startRun(l1, '100', '6283', DAY, 240) // typed "100": the same code as the program's "0100"
    clock = oct(10, 13, 30); m.unitDone(open(l1).id, 240)
    clock = oct(10, 14, 30); m.unitDone(open(l1).id, 240)
    eq('lo que registra el turno 1 se descuenta solo, y dice en qué línea está corriendo (100 y 0100 son el mismo código)', rows('RTE'), [['0100', 1000, 480, [480, 0], 520, true, ['Línea 1']], ['B200', 480, 0, [0, 0], 480, false, []]])
    // the second shift goes on with the same program
    clock = oct(10, 16, 0); m.unitDone(open(l1).id, 240)
    clock = oct(10, 16, 30); m.unitDone(open(l1).id, 360); m.endRun(open(l1).id, false)
    clock = oct(10, 16, 40); m.startRun(l1, 'Z900', '6283', DAY, 240)
    clock = oct(10, 17, 0); m.unitDone(open(l1).id, 240)
    eq('el turno 2 sigue bajando el mismo programa, cada turno con lo suyo: completo con 80 de más; lo que no estaba programado va aparte', rows('RTE'), [['0100', 1000, 1080, [480, 600], -80, false, []], ['B200', 480, 0, [0, 0], 480, false, []], ['Z900', 0, 240, [0, 240], 0, true, ['Línea 1']]])
    // Kitchen counts mezclas
    clock = oct(10, 17, 10); const b1 = lineOf('Kitchen', 'Braiser 1'); m.startRun(b1, '0100', '6283', DAY, null)
    clock = oct(10, 17, 40); m.unitDone(open(b1).id, null)
    clock = oct(10, 18, 10); m.unitDone(open(b1).id, null)
    eq('en Kitchen el programa es en mezclas: cada "Mezcla lista" descuenta una, y lo de RTE no se mezcla con lo suyo', rows('Kitchen'), [['0100', 6, 2, [0, 2], 4, true, ['Braiser 1']]])
    // changing and taking off
    m.setPlan(DAY, 'RTE', 'B200', 0); m.setPlan(DAY, 'RTE', '100', 1200); m.setPlan(DAY, 'RTE', '100', 1200)
    eq('quitar un código lo saca del programa; cambiar la cantidad cambia lo pendiente (el mismo código escrito de otra forma no hace otro renglón, y repetir lo mismo no escribe nada)', [rows('RTE').map((r) => r.slice(0, 5)), m.planOf(st(), DAY, 'RTE').length, st().changes.filter((c) => c.refTable === 'act_plan' && c.dept === 'RTE' && c.what.endsWith('· 100')).map((c) => [c.before, c.after])], [[['100', 1200, 1080, [480, 600], 120], ['Z900', 0, 240, [0, 240], 0]], 1, [['', '1000'], ['1000', '1200']]])
    eq('una cantidad que no es un número, o un cuarto que no existe, no entra', [m.setPlan(DAY, 'RTE', 'Q1', NaN), m.setPlan(DAY, 'Nada', 'Q1', 5), m.setPlan('mañana', 'RTE', 'Q1', 5), m.setPlan(DAY, 'RTE', ' ', 5), m.planOf(st(), DAY, 'RTE').length], [undefined, undefined, undefined, undefined, 1])
    // a day this device no longer keeps lets go of its program too
    m.applyRemote('act_plan', { date: '2026-08-01', dept: 'RTE', code: 'OLD1', qty: 5, updated_at: iso(oct(1, 0, 0)) })
    const before = st().plans.some((p) => p.date === '2026-08-01'); m.prune()
    eq('el programa de un día que el aparato ya no guarda se suelta con ese día', [before, st().plans.some((p) => p.date === '2026-08-01'), st().plans.some((p) => p.date === DAY)], [true, false, true])
    // ---- the program's lot (Jose, 2026-10-19: "que por defecto salga el lote del día, y que sea opcional") ----
    // (a row of the program is its code AND its lot since 2026-10-20: `lot` undefined = whichever row of the code)
    const plan = (dept, code, lot) => st().plans.find((p) => p.date === DAY && p.dept === dept && m.normCode(p.code) === m.normCode(code) && (lot === undefined || p.lot === lot))
    const sentRow = (dept, code, lot = '') => m.outbox.items().find((i) => i.table === 'act_plan' && i.key === DAY + '|' + dept + '|' + m.normCode(code) + (lot ? '|' + lot : ''))?.row
    const lines = () => st().changes.filter((c) => c.refTable === 'act_plan' && c.dept === 'Spiral').map((c) => [c.what, c.before, c.after])
    clock = oct(10, 6, 0); m.setPlan(DAY, 'Spiral', '0889', 3, ' 6291 ')
    eq('un programa con lote: se guarda recortado, sube en la fila (con la llave de su lote) y el historial lo nombra', [plan('Spiral', '889').lot, sentRow('Spiral', '889', '6291').lot, lines(), m.planRows(st(), DAY, 'Spiral').map((r) => [r.code, r.lot])], ['6291', '6291', [['Programa 2026-10-10 · Spiral · 889 · lote 6291', '', '3']], [['0889', '6291']]])
    eq('los de antes, sin lote, llevan la columna vacía y suben igual (el servidor los toma en cuanto el 019 esté corrido)', [plan('RTE', '100').lot, sentRow('RTE', '100').lot, m.planRows(st(), DAY, 'RTE').map((r) => r.lot)], ['', '', ['', '']])
    // the same code with another lot is another row of the program, never a change of this one (2026-10-20: "si el
    // lote es diferente que sea otra programación aun si es el mismo código")
    clock = oct(10, 6, 1); m.setPlan(DAY, 'Spiral', '0889', 3, '6292')
    eq('el mismo código con otro lote es otro renglón: los dos quedan, cada uno sube con su llave y su línea del historial', [plan('Spiral', '889', '6291').qty, plan('Spiral', '889', '6292').qty, sentRow('Spiral', '889', '6292').lot, lines().at(-1), m.planRows(st(), DAY, 'Spiral').map((r) => [r.code, r.lot, r.planned])], [3, 3, '6292', ['Programa 2026-10-10 · Spiral · 889 · lote 6292', '', '3'], [['0889', '6291', 3], ['0889', '6292', 3]]])
    // moving a row to another lot, as the dialog does it: the old one taken off, the new one set, both in the history
    // (two minutes after: the same line retyped within 90 s folds into one, see logChange)
    clock = oct(10, 6, 3); m.setPlan(DAY, 'Spiral', '0889', 3, '6292'); m.setPlan(DAY, 'Spiral', '0889', 0, '6292'); m.setPlan(DAY, 'Spiral', '0889', 3, '')
    eq('repetir lo mismo no escribe nada; pasar el renglón a sin lote es quitar el de 6292 y poner el del día, los dos en el historial', [lines().length, plan('Spiral', '889', '').qty, plan('Spiral', '889', '6292').qty, lines().slice(-2), m.planRows(st(), DAY, 'Spiral').map((r) => [r.lot, r.planned])], [4, 3, 0, [['Programa 2026-10-10 · Spiral · 889 · lote 6292', '3', ''], ['Programa 2026-10-10 · Spiral · 889', '', '3']], [['6291', 3], ['', 3]]])
    clock = oct(10, 6, 3); m.setPlan(DAY, 'Spiral', 'L1', 2, 'x'.repeat(40))
    eq('un lote muy largo se recorta', plan('Spiral', 'L1').lot, 'x'.repeat(m.PLAN_LOT_MAX))
    // from the server: a row with its lot, and one from before 019 (no column at all)
    m.applyRemote('act_plan', { date: DAY, dept: 'MFO', code: 'M5', qty: 50, lot: '6291', updated_at: iso(oct(10, 6, 4)) })
    m.applyRemote('act_plan', { date: DAY, dept: 'MFO', code: 'M6', qty: 60, updated_at: iso(oct(10, 6, 4)) })
    eq('del servidor: el lote llega; una fila sin la columna (antes del 019) se lee sin lote', [plan('MFO', 'M5').lot, plan('MFO', 'M6').lot], ['6291', ''])
    // a code taken off keeps its lot; put back with another lot, "before" says nothing (it had no quantity): the line
    // used to read " · lote 6292" alone (review of 2026-10-19)
    const kl = () => st().changes.filter((c) => c.refTable === 'act_plan' && c.dept === 'Kitchen' && c.what.includes('A100')).map((c) => [c.what, c.before, c.after])
    // (two minutes apart: the same line retyped within 90 s folds into one, and typed back it is withdrawn: logChange)
    clock = oct(10, 6, 5); m.setPlan(DAY, 'Kitchen', 'A100', 8, '6292')
    clock = oct(10, 6, 7); m.setPlan(DAY, 'Kitchen', 'A100', 0, '6292')
    clock = oct(10, 6, 9); m.setPlan(DAY, 'Kitchen', 'A100', 5, '')
    eq('quitado y vuelto a poner con otro lote: "antes" queda en blanco, no " · lote 6292" suelto', kl(), [['Programa 2026-10-10 · Kitchen · A100 · lote 6292', '', '8'], ['Programa 2026-10-10 · Kitchen · A100 · lote 6292', '8', ''], ['Programa 2026-10-10 · Kitchen · A100', '', '5']])
    // a code typed with its quantity blank (the dialog fills the day's lot into every row) makes no row: nothing was
    // programmed, nothing goes up (review of 2026-10-19); one that had a quantity is still taken off, its lot kept
    const counts = () => [st().plans.length, m.outbox.items().filter((i) => i.table === 'act_plan').length, st().changes.filter((c) => c.refTable === 'act_plan').length]
    const b0 = counts()
    clock = oct(10, 6, 11); m.setPlan(DAY, 'RTE', 'Z9', 0, '6292'); m.setPlan(DAY, 'RTE', 'Z9', 0, '')
    eq('un código sin cantidad, con el lote del día prellenado, no hace fila, no sube y no deja renglón', [counts(), plan('RTE', 'Z9')], [b0, undefined])
    clock = oct(10, 6, 13); m.setPlan(DAY, 'RTE', 'Z9', 4, '6292'); clock = oct(10, 6, 15); m.setPlan(DAY, 'RTE', 'Z9', 0, '6292'); clock = oct(10, 6, 17); m.setPlan(DAY, 'RTE', 'Z9', 0, '6299')
    eq('quitar uno que tenía cantidad sí pasa (y deja su lote); volver a quitarlo con otro lote no escribe nada', [plan('RTE', 'Z9').qty, plan('RTE', 'Z9').lot, counts()[2] - b0[2]], [0, '6292', 2])
  })
  // the lot is a stored field (2026-10-19): read back on every reload (the rule of 2026-10-17: a new stored field
  // gets its reload check), and a copy saved before it reads ''
  const plt = await device('plan-lote', { seed: { lines: [], runs: [], stops: [], products: [], schedule: {}, changes: [], targets: [], shifts: [NO_GAP], plans: [{ date: DAY, dept: 'Kitchen', code: '0889', qty: 3, lot: ' 6291 ', updatedAt: T0 }, { date: DAY, dept: 'RTE', code: 'A100', qty: 500, updatedAt: T0 }] } })
  eq('al volver a abrir, cada programa tiene su lote (recortado) y el guardado antes del lote se lee sin él', plt.use((m) => m.store.get().plans.map((p) => [p.dept, p.code, p.qty, p.lot])), [['Kitchen', '0889', 3, '6291'], ['RTE', 'A100', 500, '']])
  // from the office's PC to the room's tablet, and back
  const DP = '2026-10-21'
  clock = oct(21, 5, 0); mgr.use((m) => { m.addLine('RTE', 'Línea 19'); m.setPlan(DP, 'RTE', 'P100', 960) }); settle()
  eq('el programa que pone la oficina llega a la tablet del cuarto', [tab, mgr].map((d) => d.use((m) => m.planOf(m.store.get(), DP, 'RTE').map((p) => [p.code, p.qty]))), [[['P100', 960]], [['P100', 960]]])
  const l9 = tab.use((m) => m.store.get().lines.find((l) => l.dept === 'RTE' && l.name === 'Línea 19'))
  const running = (d) => d.use((m) => m.store.get().runs.find((r) => r.lineId === l9.id && !r.endedAt))
  clock = oct(21, 6, 0); tab.use((m) => m.startRun(l9, 'P100', '6294', DP, 240)); settle()
  clock = oct(21, 6, 30); tab.use((m) => m.unitDone(running(tab).id, 240)); settle()
  eq('y lo que registra la tablet baja lo pendiente en la pantalla de la oficina', mgr.use((m) => m.planRows(m.store.get(), DP, 'RTE').map((r) => [r.code, r.planned, r.done, r.left, r.lines])), [['P100', 960, 240, 720, ['Línea 19']]])
  mgr.use((m) => { m.applyRemote('act_plan', { date: DP, dept: 'RTE', code: 'P100', qty: 5, updated_at: iso(oct(21, 4, 0)) }); m.applyRemote('act_plan', { date: DP, dept: 'Nada', code: 'P100', qty: 5, updated_at: iso(oct(21, 9, 0)) }); m.applyRemote('act_plan', { date: 'x', dept: 'RTE', code: 'P100', qty: 5, updated_at: iso(oct(21, 9, 0)) }) })
  eq('una fila más vieja no pisa a la más nueva, y una que no es de un cuarto o de un día no entra', mgr.use((m) => [m.planOf(m.store.get(), DP, 'RTE').map((p) => p.qty), m.store.get().plans.filter((p) => p.date === DP).length]), [[960], 1])
  clock = oct(21, 7, 0); tab.use((m) => m.endRun(running(tab).id, false)); settle()
  eq('nada queda pendiente de enviar', all.map((d) => d.use((m) => m.outbox.size())), [0, 0])
}
section('El programa por lote: el 889 de RTE con dos lotes el mismo día, como lo mandó la oficina (2026-10-20)')
{
  // The office, 2026-10-20: RTE's program had 889 · lote 6292 · 15,688 pouches and 889 · lote 6290 · 2,482. The dialog
  // refused the second ("El código 889 está dos veces: déjalo en un solo renglón") and the card showed 889 · lote 6292 ·
  // hecho 25,244 · "✓ completo (+9,556)": "aquí me está sumando de varios lotes, es por eso que sale mucha cantidad
  // adicional". Jose's rule: "la clave está en el lote: si los lotes son iguales que lo descuente; si el lote es
  // diferente que sea otra programación aun si es el mismo código". Every run and number here is made up
  const pl = await device('plan-lot', { user: 'Oficina', usual: true })
  const D = '2026-10-19', NEXT = '2026-10-20'
  const keyOf = (p) => p.date + '|' + p.dept + '|' + p.code + (p.lot ? '|' + p.lot : '')
  pl.use((m) => {
    const st = () => m.store.get()
    const lineOf = (dept, name) => { m.addLine(dept, name); return st().lines.find((l) => l.dept === dept && l.name === name) }
    const open = (line) => st().runs.find((r) => r.lineId === line.id && !r.endedAt)
    const rows = (dept, date = D) => m.planRows(st(), date, dept).map((r) => [r.code, r.lot, r.planned, r.done, r.byShift, r.left])
    const done = (line, ats, qty) => { for (const at of ats) { clock = at; m.unitDone(open(line).id, qty) } }
    // ---- the office's program, as typed in its dialog ----
    clock = oct(19, 5, 0)
    m.setPlan(D, 'RTE', '889', 15688, '6292'); m.setPlan(D, 'RTE', '889', 2482, '6290'); m.setPlan(D, 'RTE', '2010', 3360, '6292')
    eq('el 889 dos veces, con los lotes 6292 y 6290: son dos renglones del programa, cada uno sube con su llave', [m.planOf(st(), D, 'RTE').map((p) => [p.code, p.lot, p.qty]), m.outbox.items().filter((i) => i.table === 'act_plan').map((i) => [i.key, i.row.lot, i.row.qty])], [[['889', '6292', 15688], ['889', '6290', 2482], ['2010', '6292', 3360]], [[D + '|RTE|889|6292', '6292', 15688], [D + '|RTE|889|6290', '6290', 2482], [D + '|RTE|2010|6292', '6292', 3360]]])
    const n0 = st().plans.length
    clock = oct(19, 5, 3); m.setPlan(D, 'RTE', '0889', 15688, '6292')
    clock = oct(19, 5, 5); m.setPlan(D, 'RTE', '889', 15700, ' 6292 ')
    eq('el mismo código con el mismo lote es el mismo renglón (también escrito 0889 o con espacios): no hace otro, lo cambia', [st().plans.length - n0, m.planRows(st(), D, 'RTE').map((r) => [r.code, r.lot, r.planned])], [0, [['889', '6290', 2482], ['889', '6292', 15700], ['2010', '6292', 3360]]])
    clock = oct(19, 5, 7); m.setPlan(D, 'RTE', '889', 15688, '6292')
    // ---- the floor: Línea 1 runs 889 of lot 6292 in both shifts; Línea 2 runs 889 of lot 6290 in shift 2; Línea 3
    // runs 889 of a lot nobody programmed (6293) ----
    const l1 = lineOf('RTE', 'Línea 1'), l2 = lineOf('RTE', 'Línea 2'), l3 = lineOf('RTE', 'Línea 3')
    clock = oct(19, 6, 30); m.startRun(l1, '889', '6292', D, 2000)
    done(l1, [oct(19, 7, 0), oct(19, 8, 0), oct(19, 9, 0), oct(19, 10, 0), oct(19, 11, 0), oct(19, 12, 0), oct(19, 13, 0)], 2000)
    done(l1, [oct(19, 14, 0)], 204)
    clock = oct(19, 15, 40); m.startRun(l2, '889', '6290', D, 1241)
    done(l1, [oct(19, 16, 0)], 1000)
    done(l2, [oct(19, 17, 0), oct(19, 18, 0)], 1241)
    clock = oct(19, 18, 30); m.startRun(l3, '0889', '6293', D, 480)
    done(l3, [oct(19, 19, 0), oct(19, 20, 0)], 480)
    const row889 = (lot) => m.planRows(st(), D, 'RTE').find((r) => r.code === '889' && r.lot === lot)
    eq('cada renglón cuenta solo lo de su lote, por turno: 6290 completo con sus 2,482; 6292 lleva 15,204 (14,204 y 1,000) y le faltan 484', rows('RTE'), [['889', '6290', 2482, 2482, [0, 2482], 0], ['889', '6292', 15688, 15204, [14204, 1000], 484], ['2010', '6292', 3360, 0, [0, 0], 3360]])
    eq('lo del lote que nadie programó (6293) no entra en ningún renglón: se dice aparte, en el primero del código', [row889('6290').also, row889('6292').also], [[{ lot: '6293', n: 960 }], []])
    const made889 = st().runs.filter((r) => m.normCode(r.code) === '889').reduce((t, r) => t + m.runQty(st(), r), 0)
    eq('nunca un renglón con todo el código (antes: 18,646 en el 6292, "completo (+2,958)"); los renglones y lo de aparte suman lo hecho, sin contar nada dos veces', [made889, m.planRows(st(), D, 'RTE').filter((r) => r.code === '889').reduce((t, r) => t + r.done + r.also.reduce((a, x) => a + x.n, 0), 0)], [18646, 18646])
    eq('cada línea corriendo sale en el renglón del lote que corre (la del 6293 en ninguno)', [row889('6290').lines, row889('6292').lines, row889('6290').running], [['Línea 2'], ['Línea 1'], true])
    // a row without a lot counts what no row of a lot of its code claims
    clock = oct(19, 20, 30); m.setPlan(D, 'RTE', '889', 1000, '')
    eq('un renglón sin lote cuenta solo lo que ningún renglón de lote del código reclama (el 6293), por turno; ya no queda nada aparte', [rows('RTE').filter((r) => r[0] === '889'), m.planRows(st(), D, 'RTE').filter((r) => r.code === '889').map((r) => r.also)], [[['889', '6290', 2482, 2482, [0, 2482], 0], ['889', '6292', 15688, 15204, [14204, 1000], 484], ['889', '', 1000, 960, [0, 960], 40]], [[], [], []]])
    eq('los chips de una línea libre y del registro de después leen los mismos renglones (uno por código y lote)', m.planRows(st(), D, 'RTE').filter((r) => r.planned > 0 && r.left > 0).map((r) => [r.code, r.lot, r.left]), [['889', '6292', 484], ['889', '', 40], ['2010', '6292', 3360]])
    eq('Flujo suma el programa de cada lote: el 6292 tiene 15,688 de 889 y el 6290 tiene 2,482', [m.flujoProgram(st(), '6292').get('889').prog, m.flujoProgram(st(), '6290').get('889').prog, m.flujoProgram(st(), '6293').get('889')], [[{ dept: 'RTE', qty: 15688 }], [{ dept: 'RTE', qty: 2482 }], undefined])

    // ---- Packing: a pallet of two lots gives each programmed lot its cases ----
    m.setPlan(D, 'Packing', 'A100', 40, '6292'); m.setPlan(D, 'Packing', 'A100', 30, '6290')
    const pk = lineOf('Packing', 'Línea 1')
    clock = oct(19, 7, 0); m.startRun(pk, 'A100', '6290', D, 36)
    clock = oct(19, 8, 0); m.palletDone(open(pk).id, [{ lot: '6290', qty: 20, tag: '501' }, { lot: '6292', qty: 16, tag: '502' }], '')
    clock = oct(19, 9, 0); m.palletDone(open(pk).id, [{ lot: '6292', qty: 36, tag: '503' }], '')
    clock = oct(19, 10, 0); m.palletDone(open(pk).id, [{ lot: '6294', qty: 12, tag: '504' }], '')
    const pr = m.planRows(st(), D, 'Packing')
    eq('Packing: el pallet de dos lotes da a cada renglón sus cajas (20 al 6290, 16 al 6292); el lote sin programa (6294) se dice aparte', [rows('Packing'), pr[0].also, pr[0].unit], [[['A100', '6290', 30, 20, [20, 0], 10], ['A100', '6292', 40, 52, [52, 0], -12]], [{ lot: '6294', n: 12 }], 'cajas'])

    // ---- MFO: platos counted as typed, by lot; copas apart ----
    m.setPlan(D, 'MFO', 'M1', 100, '6292'); m.setPlan(D, 'MFO', 'M1', 50, '6290')
    const mf = lineOf('MFO', 'Línea 1'), mf2 = lineOf('MFO', 'Línea 2')
    clock = oct(19, 8, 0); m.startRun(mf2, 'M1', '6290', D, null, 'copas'); clock = oct(19, 9, 0); m.unitDone(open(mf2).id, 12)
    clock = oct(19, 7, 0); m.startRun(mf, 'M1', '6292', D, null, 'platos')
    clock = oct(19, 7, 30); m.unitDone(open(mf).id, 60)
    clock = oct(19, 16, 0); m.unitDone(open(mf).id, 25)
    clock = oct(19, 16, 10); m.endRun(open(mf).id)
    clock = oct(19, 16, 20); m.startRun(mf, 'M1', '6290', D, null, 'platos')
    clock = oct(19, 17, 0); m.unitDone(open(mf).id, 30)
    const mr = m.planRows(st(), D, 'MFO')
    eq('MFO: cada lote con sus platos, por turno; las copas van aparte una sola vez, en el primer renglón del código', [rows('MFO'), mr.map((r) => r.unit), mr.map((r) => r.other)], [[['M1', '6290', 50, 30, [0, 30], 20], ['M1', '6292', 100, 85, [60, 25], 15]], ['platos', 'platos'], [[{ word: 'copas', n: 12 }], []]])

    // ---- Spiral: pounds by lot; mezclas one by one, a lot nobody named going to the row without a lot ----
    m.setSpiralUnit('S1', 'lb')
    m.setPlan(D, 'Spiral', 'S1', 3000, '6292'); m.setPlan(D, 'Spiral', 'S1', 1000, '6290'); m.setPlan(D, 'Spiral', 'S2', 5, '6292'); m.setPlan(D, 'Spiral', 'S2', 3, '')
    const sp = lineOf('Spiral', 'Línea 1'), sp2 = lineOf('Spiral', 'Línea 2')
    clock = oct(19, 7, 0); m.startRun(sp, 'S1', '6292', D, null, '', 'lb')
    clock = oct(19, 8, 0); m.unitDone(open(sp).id, 1200.5); clock = oct(19, 9, 0); m.unitDone(open(sp).id, 800)
    clock = oct(19, 9, 30); m.endRun(open(sp).id); clock = oct(19, 9, 40); m.startRun(sp, 'S1', '6290', D, null, '', 'lb')
    clock = oct(19, 10, 0); m.unitDone(open(sp).id, 640.25)
    clock = oct(19, 7, 5); m.startRun(sp2, 'S2', '6292', D, null)
    for (let i = 1; i <= 4; i++) { clock = oct(19, 7, 5 + i * 5); m.unitDone(open(sp2).id, null) }
    clock = oct(19, 8, 0); m.endRun(open(sp2).id); clock = oct(19, 8, 5); m.startRun(sp2, 'S2', '6299', D, null)
    for (let i = 1; i <= 2; i++) { clock = oct(19, 8, 5 + i * 5); m.unitDone(open(sp2).id, null) }
    const sr = m.planRows(st(), D, 'Spiral')
    eq('Spiral: S1 en libras por lote; S2 en mezclas: 4 del 6292, y las 2 del 6299 (sin renglón) al renglón sin lote', [rows('Spiral'), sr.map((r) => r.unit)], [[['S1', '6290', 1000, 640.25, [640.25, 0], 359.75], ['S1', '6292', 3000, 2000.5, [2000.5, 0], 999.5], ['S2', '6292', 5, 4, [4, 0], 1], ['S2', '', 3, 2, [2, 0], 1]], ['lb', 'lb', 'mezclas', 'mezclas']])

    // ---- the next day: each row goes on with its own lot ----
    clock = oct(19, 23, 0); m.endRun(open(l1).id)
    clock = oct(20, 7, 0); m.startRun(l1, '889', '6292', NEXT, 484)
    clock = oct(20, 7, 30); m.unitDone(open(l1).id, 484)
    eq('lo pendiente de cada renglón sigue con su lote; el renglón sin lote no se lleva el lote del día (6292) si otro renglón del código lo nombra', m.carriedOver(st(), D).filter((x) => x.dept === 'RTE').map((x) => [x.code, x.lot, x.pending, x.made, x.done]), [['889', '6292', 484, 484, true], ['889', '', 40, 0, false], ['2010', '6292', 3360, 0, false]])

    // ---- a production order with two lot rows of one code (2026-10-19's orders, 2026-10-20's rows) ----
    clock = oct(20, 9, 0)
    const W = m.saveWorkOrder({ dept: 'RTE', code: '889', qty: 30000, unit: 'pouches', startDate: D, wo: 'R-889', note: '' })
    m.setPlan(D, 'RTE', '889', 15688, '6292', W); m.setPlan(D, 'RTE', '889', 5000, '6290', W)
    const ws = m.orderStatus(st(), m.workOrderOf(st(), W), NEXT)
    eq('el pedido: lo programado del día es la suma de sus renglones (15,688 + 5,000), con sus lotes; lo hecho sigue por código, el más viejo primero', [ws.byDay.map((x) => [x.date, x.programmed, x.lot, x.made1, x.made2, x.made, x.pending]), ws.made, ws.disponible], [[[D, 20688, '6290, 6292', 14204, 4442, 18646, 2042], [NEXT, 0, '', 484, 0, 484, 0]], 19130, 10870])
    eq('la tarjeta: cada renglón dice su pedido (los dos del mismo), el de sin lote ninguno', m.planRows(st(), D, 'RTE').filter((r) => r.code === '889').map((r) => [r.lot, r.orderId === W]), [['6290', true], ['6292', true], ['', false]])
    eq('el aviso del día siguiente: el pedido una sola vez, con lo que quedó de sus dos renglones; el renglón sin lote y el 2010, cada uno lo suyo', m.prevPending(st(), 'RTE', NEXT), [{ code: '889', lot: '6290, 6292', n: 2042, unit: 'pouches', date: D, orderId: W, was: '' }, { code: '889', lot: '', n: 40, unit: 'pouches', date: D, orderId: '', was: '' }, { code: '2010', lot: '6292', n: 3360, unit: 'pouches', date: D, orderId: '', was: '' }])
    eq('el historial del pedido encuentra cada renglón por su llave (y por la del código sola, la de antes)', [m.planRefKeys({ date: D, dept: 'RTE', code: '0889', lot: '6292' }), m.planRefKeys({ date: D, dept: 'RTE', code: '889', lot: '' })], [[D + '|RTE|889|6292', D + '|RTE|889'], [D + '|RTE|889']])
    // (review of 2026-10-20: the key of the code alone is also the key of the code's row WITHOUT a lot: the order's
    // window listed the 1,000 of the 889 without a lot, which is not its)
    const ofW = m.planLinesOf(st().plans.filter((p) => p.orderId === W)), linesW = st().changes.filter(ofW)
    eq('el historial del pedido: las líneas de sus dos renglones, no las del 889 sin lote (que no es suyo)', [linesW.length > 0, linesW.every((c) => c.refKey === D + '|RTE|889|6292' || c.refKey === D + '|RTE|889|6290'), st().changes.some((c) => c.refTable === 'act_plan' && c.refKey === D + '|RTE|889')], [true, true, true])
    const of6292 = m.planLinesOf([{ date: D, dept: 'RTE', code: '889', lot: '6292' }]), line = (refKey, what, refTable = 'act_plan') => of6292({ refTable, refKey, what })
    eq('con la llave del código solo, el renglón de un lote toma las líneas de antes que nombran su lote; las del renglón sin lote, otro lote (62921) u otra tabla no', [line(D + '|RTE|889|6292', 'Programa ' + D + ' · RTE · 889 · lote 6292'), line(D + '|RTE|889', 'Programa ' + D + ' · RTE · 889 · lote 6292 · pedido WO R-889'), line(D + '|RTE|889', 'Programa ' + D + ' · RTE · 889'), line(D + '|RTE|889', 'Programa ' + D + ' · RTE · 889 · lote 62921'), line(D + '|RTE|889|6292', 'x', 'act_work_orders')], [true, true, false, false, false])

    // ---- from the server: two lots of one code are two rows; an older version of one does not overwrite it ----
    m.applyRemote('act_plan', { date: D, dept: 'Kitchen', code: '889', qty: 80, lot: '6292', updated_at: iso(oct(19, 4, 0)) })
    m.applyRemote('act_plan', { date: D, dept: 'Kitchen', code: '889', qty: 20, lot: '6290', updated_at: iso(oct(19, 4, 0)) })
    m.applyRemote('act_plan', { date: D, dept: 'Kitchen', code: '889', qty: 99, lot: '6290', updated_at: iso(oct(19, 3, 0)) })
    eq('del servidor: dos lotes del mismo código son dos renglones; una versión más vieja de uno no lo pisa', m.planOf(st(), D, 'Kitchen').map((p) => [p.lot, p.qty]), [['6292', 80], ['6290', 20]])
    const sw = m.stateWith(st(), { plans: [{ date: '2026-09-01', dept: 'RTE', code: '889', qty: 5, lot: '6244', updated_at: iso(oct(1, 0, 0)) }, { date: '2026-09-01', dept: 'RTE', code: '889', qty: 7, lot: '6245', updated_at: iso(oct(1, 0, 0)) }] })
    eq('los renglones de días viejos que trae un pedido: los dos lotes', sw.plans.filter((p) => p.date === '2026-09-01').map((p) => [p.lot, p.qty]), [['6244', 5], ['6245', 7]])

    // ---- what waits in the queue keeps its day, by its lot ----
    m.setPlan('2026-08-02', 'RTE', '889', 10, '6214')
    m.prune()
    const old = () => st().plans.some((p) => p.date === '2026-08-02' && p.lot === '6214')
    const waitedOld = old()
    m.drop('act_plan', '2026-08-02|RTE|889|6214'); m.prune()
    eq('un renglón con lote de un día que el aparato ya no guarda se queda mientras espera subir, y se suelta después', [waitedOld, old()], [true, false])

    // ---- a whole pull: a copy the server no longer has (the lot of before, changed in place) goes ----
    m.applyRemote('act_plan', { date: D, dept: 'Kitchen', code: '889', qty: 80, lot: '6291', updated_at: iso(oct(19, 2, 0)) })
    const seen = new Set(st().plans.filter((p) => !(p.dept === 'Kitchen' && p.lot === '6291')).map((p) => keyOf({ ...p, code: m.normCode(p.code) })))
    const kept = (lot) => st().plans.some((p) => p.date === D && p.dept === 'Kitchen' && p.lot === lot)
    const onlyRte = m.keepServerPlans(seen, m.firstKeptDay(), ['RTE'], new Set(), m.clockNow())
    const both = m.keepServerPlans(seen, m.firstKeptDay(), null, new Set(), m.clockNow())
    eq('después de bajar todo: lo que el servidor ya no tiene se suelta (solo de los cuartos que se bajaron); lo demás queda', [onlyRte, both, kept('6291'), kept('6292'), kept('6290'), m.planOf(st(), D, 'RTE').length], [0, 1, false, true, true, 4])
    // (review of 2026-10-20) a row that comes from the server while the listing is being read (realtime, a refresh
    // before sending), typed on another device before the pull began, is on the server although the listing missed it
    m.applyRemote('act_plan', { date: D, dept: 'Kitchen', code: '889', qty: 60, lot: '6296', updated_at: iso(oct(19, 1, 0)) })
    const mark = m.planHeardMark()
    m.applyRemote('act_plan', { date: D, dept: 'Kitchen', code: '889', qty: 70, lot: '6295', updated_at: iso(oct(19, 1, 0)) })
    const seen2 = new Set(st().plans.filter((p) => !(p.dept === 'Kitchen' && (p.lot === '6295' || p.lot === '6296'))).map((p) => keyOf({ ...p, code: m.normCode(p.code) })))
    eq('lo que llegó del servidor mientras se bajaba todo se queda; una copia de antes que la lista no trajo, no', [m.keepServerPlans(seen2, m.firstKeptDay(), null, new Set(), m.clockNow(), mark), kept('6295'), kept('6296')], [1, true, false])

    // ---- the queue: the key of each row, and the server's answer when it has no such key ----
    eq('la llave con que sube el programa es la de 021: día, cuarto, código y lote', m.conflictOf('act_plan'), 'date,dept,code,lot')
    eq('"no hay llave así" (42P10, o dicho en palabras): el programa espera, nunca se tira', [m.verdict('42P10', 'there is no unique or exclusion constraint matching the ON CONFLICT specification'), m.verdict('XX000', 'there is no unique or exclusion constraint matching the ON CONFLICT specification'), m.noSuchKey('23505', 'duplicate key')], ['notReady', 'notReady', false])
  })
  // a program saved on the device with two lots of one code reads back whole (a new stored shape gets its reload check)
  const plr = await device('plan-lot-reload', { seed: { lines: [], runs: [], stops: [], products: [], schedule: {}, changes: [], targets: [], shifts: [NO_GAP], plans: [{ date: D, dept: 'RTE', code: '889', qty: 15688, lot: '6292', updatedAt: T0 }, { date: D, dept: 'RTE', code: '889', qty: 2482, lot: '6290', updatedAt: T0 }] } })
  eq('al volver a abrir, los dos renglones del 889 siguen, cada uno con su lote', plr.use((m) => m.planOf(m.store.get(), D, 'RTE').map((p) => [p.code, p.lot, p.qty])), [['889', '6292', 15688], ['889', '6290', 2482]])
  // a program queued by the build of before 2026-10-20 waits under its code alone: this build gives it its lot's key
  on = 'plan-oldq'
  const oldRow = (code, qty, lot) => ({ date: D, dept: 'RTE', code, qty, lot, order_id: null, updated_at: iso(oct(19, 5, 0)), updated_by: 'Oficina' })
  localStorage.setItem('act_outbox', JSON.stringify([{ table: 'act_plan', key: D + '|RTE|889', row: oldRow('889', 2482, '6290'), at: oct(19, 5, 0) }, { table: 'act_plan', key: D + '|RTE|2010', row: oldRow('2010', 3360, ''), at: oct(19, 5, 0) }]))
  const oq = await device('plan-oldq', { user: 'Oficina' })
  oq.use((m) => {
    eq('lo que esperaba con la llave del código solo toma la de su lote (y el que no tiene lote se queda como estaba)', m.outbox.items().map((i) => [i.key, i.row.lot, i.row.qty]), [[D + '|RTE|889|6290', '6290', 2482], [D + '|RTE|2010', '', 3360]])
    m.applyRemote('act_plan', { date: D, dept: 'RTE', code: '889', qty: 500, lot: '', updated_at: iso(oct(19, 6, 0)), updated_by: 'Edgar' })
    eq('una versión más nueva del 889 sin lote no lo saca de la cola: es otro renglón', m.outbox.items().filter((i) => i.table === 'act_plan').map((i) => i.key), [D + '|RTE|889|6290', D + '|RTE|2010'])
    m.applyRemote('act_plan', { date: D, dept: 'RTE', code: '889', qty: 2600, lot: '6290', updated_at: iso(oct(19, 6, 5)), updated_by: 'Edgar' })
    eq('una más nueva de su mismo lote sí: queda la del servidor y el historial lo dice', [m.outbox.items().filter((i) => i.table === 'act_plan').map((i) => i.key), m.store.get().changes.filter((c) => c.what.includes('no se subió')).map((c) => [c.what, c.before, c.after])], [[D + '|RTE|2010'], [['Programa ' + D + ' · RTE · 889 · lote 6290 · no se subió: Edgar lo cambió después', '2482', '2600']]])
  })
  // ---- two lots of one code, each row naming an order of its own (review of 2026-10-20): the 6290 row may be the end of
  // an older order and the 6292 row a newer one. Each order takes the units of its own lot; until that review every
  // unit tried the day's orders in the lots' order, and the order of 6290 took the carts of 6292 ----
  const two = await device('plan-lot-orders', { user: 'Oficina' })
  two.use((m) => {
    const st = () => m.store.get()
    const lineOf = (name) => { m.addLine('RTE', name); return st().lines.find((l) => l.dept === 'RTE' && l.name === name) }
    const open = (line) => st().runs.find((r) => r.lineId === line.id && !r.endedAt)
    clock = oct(18, 9, 0)
    const OLD = m.saveWorkOrder({ dept: 'RTE', code: '889', qty: 5000, unit: 'pouches', startDate: '2026-10-18', wo: 'R-OLD', note: '' })
    clock = oct(19, 5, 0)
    const NEW = m.saveWorkOrder({ dept: 'RTE', code: '889', qty: 20000, unit: 'pouches', startDate: D, wo: 'R-NEW', note: '' })
    m.setPlan(D, 'RTE', '889', 2482, '6290', OLD); m.setPlan(D, 'RTE', '889', 15688, '6292', NEW)
    const of = (id) => { const x = m.orderStatus(st(), m.workOrderOf(st(), id), D), d = x.byDay.find((y) => y.date === D); return [x.made, d?.programmed ?? 0, d?.pending ?? 0, x.lots] }
    const l1 = lineOf('Línea 1'), l2 = lineOf('Línea 2'), l3 = lineOf('Línea 3')
    // Línea 1 makes two carts of 6292; nothing of 6290 has run yet
    clock = oct(19, 6, 0); m.startRun(l1, '889', '6292', D, 2000)
    clock = oct(19, 7, 0); m.unitDone(open(l1).id, 2000); clock = oct(19, 8, 0); m.unitDone(open(l1).id, 2000)
    eq('dos pedidos en dos lotes del 889: los carritos del 6292 van al pedido del 6292; el del 6290 (más viejo) sigue con su lote pendiente', [of(OLD), of(NEW)], [[0, 2482, 2482, ['6290']], [4000, 15688, 11688, ['6292']]])
    // then Línea 2 makes 6290, and Línea 1 goes on with 6292
    clock = oct(19, 9, 0); m.startRun(l2, '889', '6290', D, 1241)
    clock = oct(19, 10, 0); m.unitDone(open(l2).id, 1241); clock = oct(19, 11, 0); m.unitDone(open(l2).id, 1241)
    clock = oct(19, 12, 0); m.unitDone(open(l1).id, 2000)
    eq('y los del 6290 al pedido del 6290: cada pedido solo con su lote, como la tarjeta los cuenta', [of(OLD), of(NEW), m.planRows(st(), D, 'RTE').map((r) => [r.lot, r.done, r.orderId === OLD ? 'OLD' : r.orderId === NEW ? 'NEW' : ''])], [[2482, 2482, 0, ['6290']], [6000, 15688, 9688, ['6292']], [['6290', 2482, 'OLD'], ['6292', 6000, 'NEW']]])
    // a lot nobody programmed: no row names it, so it goes by code, the oldest open order first (as before)
    clock = oct(19, 13, 0); m.startRun(l3, '889', '6293', D, 480)
    clock = oct(19, 14, 0); m.unitDone(open(l3).id, 480)
    eq('un lote que ningún renglón nombra va por código, al pedido más viejo abierto (y la tarjeta lo dice aparte)', [of(OLD)[0], of(NEW)[0], m.planRows(st(), D, 'RTE')[0].also], [2962, 6000, [{ lot: '6293', n: 480 }]])
    // with a row without a lot that names an order, that row's order takes what the lot rows leave
    clock = oct(19, 15, 0); m.setPlan(D, 'RTE', '889', 1000, '', NEW)
    eq('un renglón sin lote con su pedido: lo de los lotes sin renglón va a ese pedido', [of(OLD)[0], of(NEW)[0], of(NEW)[1]], [2482, 6480, 16688])
    // the row's quantity is what its order takes first; past it, the oldest open order (as the order rule always was)
    clock = oct(19, 15, 30); m.setPlan(D, 'RTE', '889', 4000, '6292', NEW)
    eq('pasada la cantidad del renglón, lo demás de su lote va al pedido más viejo abierto', [of(OLD)[0], of(NEW)[0]], [4482, 4480])
  })
}
section('Packing: un pallet con varios lotes, cada lote con su tag; y las líneas que hacen bins')
{
  // what Jose saw in Packing on 2026-10-15: a pallet is one code; when a lot runs out on it, its cases get their own
  // tag and the pallet goes on with the next lot. Every pallet of an order carries its PO (1/12, 2/12...). A line can
  // also fill bins (platos, copas, pouches), which are not cases.
  const pk = await device('pack', { user: 'Luis', usual: true })
  pk.use((m) => {
    const st = () => m.store.get(), run = (code) => st().runs.find((r) => r.code === code && !r.endedAt) ?? st().runs.find((r) => r.code === code)
    const lineOf = (name) => { m.addLine('Packing', name); return st().lines.find((l) => l.dept === 'Packing' && l.name === name) }
    const open = (code) => { const o = run(code).extra?.open; return o ? [o.parts.map((x) => [x.lot, x.qty, x.tag]), o.po ?? ''] : null }
    clock = oct(10, 6, 0)
    const order = m.saveOrder(null, { customer: 'Cliente Uno', po: '1001', code: 'A100', cases: 360, shipBy: '', dest: '' })
    const l1 = lineOf('Línea 1'), l2 = lineOf('Línea 2')
    m.startRun(l1, 'A100', '6285', DAY, 36)
    eq('un pallet nuevo no tiene nada todavía, y el lote que va es el de la corrida', [open('A100'), m.lotNowOf(run('A100')), m.binOf(run('A100'))], [null, '6285', ''])
    // 6:40: lot 6285 runs out with 20 cases on the pallet; its tag is at hand; the next lot is 6286; the pallet is for PO 1001
    clock = oct(10, 6, 40)
    eq('se acaba un lote a mitad del pallet: sus cajas y su tag quedan en el pallet, que sigue abierto con el lote siguiente', [m.palletLotEnds(run('A100').id, 20, ' 1828 ', '6286', order), open('A100'), m.lotNowOf(run('A100')), run('A100').units.length], [true, [[['6285', 20, '1828']], order], '6286', 0])
    eq('sin cajas o sin el lote que sigue no se guarda nada', [m.palletLotEnds(run('A100').id, 0, '', '6287'), m.palletLotEnds(run('A100').id, 5, '', ' '), open('A100')[0].length], [false, false, 1])
    // 7:00: the pallet is full: 16 cases of 6286, whose tag they will write later
    clock = oct(10, 7, 0)
    eq('pallet listo: queda un pallet con sus dos lotes, cada uno con sus cajas y su tag, el total y su PO; el pallet que sigue va para el mismo PO', [m.palletDone(run('A100').id, [{ lot: '6285', qty: 20, tag: '1828' }, { lot: '6286', qty: 16, tag: '' }], order), run('A100').units.map((u) => [u.qty, u.lots, u.ref, u.po === order]), open('A100'), m.lotNowOf(run('A100')), m.palletPo(st(), run('A100'))], [true, [[36, [{ lot: '6285', qty: 20, tag: '1828' }, { lot: '6286', qty: 16 }], '1828', true]], [[], order], '6286', order])
    // the tag of a lot written afterwards, on the pallet being built
    clock = oct(10, 7, 20); m.palletLotEnds(run('A100').id, 10, '', '6287')
    eq('el tag de un lote se puede poner después, mientras el pallet sigue abierto', [m.palletPartFix(run('A100').id, 0, { tag: '1830' }), m.palletPartFix(run('A100').id, 0, { qty: 12 }), open('A100')[0]], [true, true, [['6286', 12, '1830']]])
    m.palletOrder(run('A100').id, order)
    clock = oct(10, 7, 40); m.palletDone(run('A100').id, [...run('A100').extra.open.parts, { lot: '6287', qty: 24, tag: '1831' }], run('A100').extra.open.po)
    const seq = m.orderPallets(st(), order, 36)
    eq('el PO cuenta sus pallets: van 2 de los 10 que pide (360 cajas ÷ 36), en el orden en que se terminaron', [seq.done.length, seq.need, m.orderMade(st(), order)], [2, 10, 72])
    // the report: each pallet with its tags, lots and cases, its total and its place in the order
    const rep = m.reportOf(st(), DAY, clock, { only: 'Packing' })
    eq('en el reporte cada pallet dice sus tags, sus lotes con sus cajas, el total y si es el 1/10 o el 2/10 de su PO', rep.pallets.map((x) => [x.n, x.parts.map((p) => [p.tag, p.lot, p.qty]), x.total, x.order, x.of]), [[1, [['1828', '6285', 20], ['', '6286', 16]], 36, 'Cliente Uno · PO 1001', [1, 10]], [2, [['1830', '6286', 12], ['1831', '6287', 24]], 36, 'Cliente Uno · PO 1001', [2, 10]]])
    eq('y en la lista de unidades, cada lote en su renglón con su tag', rep.unitRows.map((x) => [x.lot, x.qty, x.tag]), [['6285', 20, '1828'], ['6286', 16, ''], ['6286', 12, '1830'], ['6287', 24, '1831']])
    // a code that ends with lots on the pallet being built does not lose them
    clock = oct(10, 8, 0); m.palletLotEnds(run('A100').id, 8, '1832', '6288')
    const rb = m.reportOf(st(), DAY, clock, { only: 'Packing' })
    eq('el pallet que se arma también sale en el reporte, marcado en armado; y el lote que va se puede escoger en el filtro', [rb.pallets.map((x) => [x.n, x.open, x.parts.map((p) => [p.lot, p.qty, p.tag]), x.total]), rb.lots.includes('6288')], [[[1, false, [['6285', 20, '1828'], ['6286', 16, '']], 36], [2, false, [['6286', 12, '1830'], ['6287', 24, '1831']], 36], [3, true, [['6287', 8, '1832']], 8]], true])
    eq('con un lote escogido salen los pallets que lo llevan, enteros', m.reportOf(st(), DAY, clock, { only: 'Packing', lot: '6286' }).pallets.map((x) => [x.n, x.parts.map((p) => p.lot)]), [[1, ['6285', '6286']], [2, ['6286', '6287']]])
    clock = oct(10, 8, 10); m.endRun(run('A100').id, false)
    eq('si el código se termina con lotes en el pallet que se armaba, quedan como un pallet con sus tags y su PO', [run('A100').endedAt > 0, run('A100').units.length, run('A100').units[2].lots, run('A100').units[2].qty, run('A100').units[2].po === order, run('A100').extra], [true, 3, [{ lot: '6287', qty: 8, tag: '1832' }], 8, true, { lotNow: '6288' }])
    // an order of one pallet: once it is complete, the next pallet has no PO said (and none is proposed: nothing lacks)
    const small = m.saveOrder(null, { customer: 'Cliente Dos', po: '2002', code: 'A101', cases: 36, shipBy: '', dest: '' })
    clock = oct(10, 8, 12); m.startRun(l1, 'A101', '6290', DAY, 36)
    eq('un código con un PO abierto: el primer pallet ya dice para cuál va (lo propone la app)', [m.palletPo(st(), run('A101')), run('A101').extra], [small, undefined])
    m.palletOrder(run('A101').id, '')
    eq('si dicen que este pallet no lleva PO, no se propone otro', m.palletPo(st(), run('A101')), '')
    m.palletOrder(run('A101').id, small)
    clock = oct(10, 8, 14); m.palletDone(run('A101').id, [{ lot: '6290', qty: 36, tag: '1900' }], small)
    eq('con el PO completo, el pallet que sigue ya no va para ese PO', [run('A101').extra, m.palletPo(st(), run('A101')), m.orderMade(st(), small)], [undefined, '', 36])
    clock = oct(10, 8, 16); m.endRun(run('A101').id, false); m.deleteRun(run('A101').id)
    // what Jose asked on 2026-10-15: a PO of 5 pallets counts 1/5, 2/5...; if they go on with another PO, or with no
    // PO, that pallet is not added to the first one, which goes on where it was when they come back to it
    const five = m.saveOrder(null, { customer: 'Cliente Tres', po: '3001', code: 'A102', cases: 180, shipBy: '', dest: '' })
    const three = m.saveOrder(null, { customer: 'Cliente Tres', po: '3002', code: 'A102', cases: 108, shipBy: '', dest: '' })
    const done = (id) => { const q = m.orderPallets(st(), id, 36); return q.done.length + '/' + q.need }
    clock = oct(10, 8, 18); m.startRun(l1, 'A102', '6291', DAY, 36)
    const full = (po, tag) => { clock += 60_000; return m.palletDone(run('A102').id, [{ lot: '6291', qty: 36, tag }], po) }
    full(five, '2001')
    eq('el primer pallet del PO de 5 es el 1/5, y el siguiente se propone para el mismo PO', [done(five), done(three), m.palletPo(st(), run('A102'))], ['1/5', '0/3', five])
    m.palletOrder(run('A102').id, three); full(three, '2002')
    eq('si ponen el siguiente para otro PO, cuenta en ese otro y no en el primero', [done(five), done(three), m.palletPo(st(), run('A102'))], ['1/5', '1/3', three])
    m.palletOrder(run('A102').id, ''); full('', '2003')
    eq('un pallet sin PO no se suma a ninguno, y el que sigue tampoco se va solo para un PO', [done(five), done(three), m.palletPo(st(), run('A102'))], ['1/5', '1/3', ''])
    m.palletOrder(run('A102').id, five); full(five, '2004')
    eq('y al volver al primer PO, sigue donde iba: 2/5', [done(five), done(three), run('A102').units.map((u) => u.po === five ? 'five' : u.po === three ? 'three' : 'none')], ['2/5', '1/3', ['five', 'three', 'none', 'five']])
    // at "Pallet listo" the lot that was going on can be written otherwise: that one is the lot going on from then
    clock += 60_000; m.palletDone(run('A102').id, [{ lot: '6295', qty: 30, tag: '2005' }], '')
    eq('el lote del último renglón del pallet es el que sigue', m.lotNowOf(run('A102')), '6295')
    clock += 60_000; m.palletLotEnds(run('A102').id, 10, '', '6296'); m.palletDone(run('A102').id, [...run('A102').extra.open.parts, { lot: '6296', qty: 0, tag: '' }], '')
    eq('un pallet que termina con lo que ya tenía (sin cajas del lote nuevo) se guarda así, y el lote nuevo sigue', [run('A102').units.at(-1).lots, run('A102').units.at(-1).qty, m.lotNowOf(run('A102'))], [[{ lot: '6295', qty: 10 }], 10, '6296'])
    clock += 60_000; m.endRun(run('A102').id, false)
    eq('un código que termina no deja pallet a medias', run('A102').extra, { lotNow: '6296' })
    m.deleteRun(run('A102').id)
    eq('terminado el código, el lote que iba a seguir ya no sale en el filtro', m.reportOf(st(), DAY, clock, { only: 'Packing' }).lots.includes('6288'), false)
    // the tag of 6286 on the first pallet, written once the pallet was finished: it goes on that lot, and to the history
    clock = oct(10, 8, 20)
    m.fillUnit(run('A100').id, run('A100').units[0].at, 36, [{ lot: '6285', qty: 20, tag: '1828' }, { lot: '6286', qty: 16, tag: '1829' }], '1828, 1829')
    eq('el tag que faltaba se pone después en el pallet ya terminado, y queda en el historial', [run('A100').units[0].lots, run('A100').units[0].ref, st().changes.filter((c) => c.what.endsWith('Pallet 1 · lotes')).map((c) => [c.before, c.after])], [[{ lot: '6285', qty: 20, tag: '1828' }, { lot: '6286', qty: 16, tag: '1829' }], '1828, 1829', [['6285: 20 (tag 1828) + 6286: 16', '6285: 20 (tag 1828) + 6286: 16 (tag 1829)']]])
    // a line filling bins of platos
    clock = oct(10, 8, 30); m.startRun(l2, 'B200', '6285', DAY, null, 'platos')
    const b = run('B200')
    eq('una línea que hace bins: sus palabras son las de un bin, y lo que lleva en platos', [m.binOf(b), m.cfgOf(b).unit, m.cfgOf(b).plural, m.cfgOf(b).qtyUnit, m.cfgOf(b).lots, m.cfgOf(b).orders, m.cfgOf(b).refLabel], ['platos', 'Bin', 'Bins', 'platos', false, false, 'N° de bin'])
    clock = oct(10, 9, 0); m.unitDone(b.id, 50, '7')
    clock = oct(10, 9, 30); m.unitDone(b.id, 48, '8')
    eq('lo hecho de una corrida de bins se dice en bins y platos', [m.madeText(run('B200'), m.runQty(st(), run('B200'))), m.savedText('Packing', 2, m.cfgOf(run('B200')))], ['2 bins · 98 platos', 'Bin 2 guardado'])
    m.updateRun(run('B200').id, { units: run('B200').units.map((u, i) => (i === 1 ? { ...u, qty: 49 } : u)) })
    eq('y una corrección de un bin queda en el historial con palabras de bin', st().changes.filter((c) => c.refKey === run('B200').id).map((c) => [c.what.split(' · ').slice(-2).join(' · '), c.before, c.after]), [['Bin 2 · cantidad', '48', '49']])
    m.updateRun(run('B200').id, { units: run('B200').units.map((u, i) => (i === 1 ? { ...u, qty: 48 } : u)) })
    // the lot changes on a bin line: the bins from then on carry it
    clock = oct(10, 9, 40); m.setLotNow(run('B200').id, '6286'); m.unitDone(run('B200').id, 30, '9', [{ lot: '6286', qty: 30 }])
    eq('cuando cambia el lote en una línea de bins, los bins que siguen llevan el lote nuevo', [m.lotNowOf(run('B200')), m.reportOf(st(), DAY, clock, { only: 'Packing', code: 'B200' }).unitRows.map((x) => [x.lot, x.qty, x.tag])], ['6286', [['6285', 50, '7'], ['6285', 48, '8'], ['6286', 30, '9']]])
    eq('los bins de Packing van en su propia lista, cada uno con su lote, lo que lleva y su número; los pallets en la suya', (({ bins, pallets }) => [bins.map((b) => [b.r.code, b.n, b.lot, b.qty, b.word, b.ref, b.shift]), pallets.length])(m.reportOf(st(), DAY, clock, { only: 'Packing' })), [[['B200', 1, '6285', 50, 'platos', '7', 1], ['B200', 2, '6285', 48, 'platos', '8', 1], ['B200', 3, '6286', 30, 'platos', '9', 1]], 3])
    eq('con un lote elegido, solo los bins de ese lote', m.reportOf(st(), DAY, clock, { only: 'Packing', lot: '6286' }).bins.map((b) => [b.n, b.lot, b.qty]), [[3, '6286', 30]])
    m.updateRun(run('B200').id, { units: run('B200').units.slice(0, 2) })
    const t = m.deptToday(st(), 'Packing', DAY, clock)
    eq('la tarjeta de Packing no mezcla los bins con las cajas: van aparte, en platos', [t.qty, t.units, t.bins, t.byCode.map((c) => c.code)], [80, 3, [{ word: 'platos', units: 2, qty: 98 }], ['A100']])
    const r2 = m.reportOf(st(), DAY, clock, { only: 'Packing' })
    eq('en el reporte tampoco: Packing hizo 3 pallets y 80 cajas, y aparte 2 bins con 98 platos', [r2.byDept.map((d) => [d.dept, d.units, d.qty, d.bins]), r2.byCode.map((c) => [c.code, c.bin, c.units, c.qty])], [[['Packing', 3, 80, [{ word: 'platos', units: 2, qty: 98 }]]], [['A100', '', 3, 80], ['B200', 'platos', 2, 98]]])
    // asked 2026-10-16: what one line of a room made ("cuánto hizo la línea 2"), with the day's lines to choose from
    const rl = m.reportOf(st(), DAY, clock, { only: 'Packing', line: l2.id })
    eq('el reporte de una sola línea: lo que hizo esa línea, y las líneas del día para escoger', [rl.rows.map((x) => x.r.code), rl.line === l2.id, rl.filtered, rl.lineChoices.map((l) => l.name), rl.byDept.map((d) => [d.dept, d.units, d.bins.map((b) => b.qty)])], [['B200'], true, true, ['Línea 1', 'Línea 2'], [['Packing', 0, [98]]]])
    eq('una línea que ese día no trabajó no filtra nada', m.reportOf(st(), DAY, clock, { only: 'Packing', line: 'nadie' }).line, '')
    eq('Avance no cuenta los bins como cajas ni como pallets: un código que solo se hizo en bins no tiene renglón ahí', m.avanceRows(st(), DAY).filter((r) => r.code === 'B200').map((r) => [r.casesDone, r.palletsDone]), [])
    m.setPlan(DAY, 'Packing', 'B200', 100)
    eq('ni el programa de Packing, que es en cajas', m.planRows(st(), DAY, 'Packing').filter((r) => r.code === 'B200').map((r) => [r.planned, r.done, r.left]), [[100, 0, 100]])
    // what is kept and what travels
    const row = m.outbox.items().filter((i) => i.table === 'act_runs').map((i) => i.row).find((x) => x.code === 'B200')
    eq('la corrida de bins sube con lo que lleva (extra): su palabra, su lote de ahora y la marca de la unidad que se le quitó', { ...row.extra, removed: row.extra.removed.length }, { bin: 'platos', lotNow: '6286', removed: 1 })
    const back = m.cleanExtra({ bin: '  copas ', lotNow: 6290, open: { parts: [{ lot: '6285', qty: '20', tag: 1828 }, { lot: '', qty: 5 }, { lot: '6286', qty: -1 }], po: 'x1' }, junk: 1 })
    eq('lo que llega en extra se limpia: solo lo que tiene sentido', back, { bin: 'copas', open: { parts: [{ lot: '6285', qty: 20, tag: '1828', at: 0, by: '' }], po: 'x1' } })
    eq('y lo vacío no es nada', [m.cleanExtra(null), m.cleanExtra({}), m.cleanExtra({ open: { parts: [] } }), m.cleanExtra('x')], [undefined, undefined, undefined, undefined])
  })
  // the pallet being built is seen on every tablet of the room
  clock = oct(22, 6, 0)
  const pl = mgr.use((m) => { m.addLine('Packing', 'Línea 7'); return m.store.get().lines.find((l) => l.dept === 'Packing' && l.name === 'Línea 7') }); settle()
  tab.use((m) => m.startRun(pl, 'C300', '6295', '2026-10-22', 40)); settle()
  const c3 = () => tab.use((m) => m.store.get().runs.find((r) => r.lineId === pl.id && !r.endedAt))
  clock = oct(22, 6, 30); tab.use((m) => m.palletLotEnds(c3().id, 22, '2001', '6296')); settle()
  eq('el pallet que se arma en una tablet se ve en la otra, con su lote y su tag', mgr.use((m) => { const r = m.store.get().runs.find((x) => x.lineId === pl.id && !x.endedAt); return [r.extra.open.parts.map((x) => [x.lot, x.qty, x.tag]), r.extra.lotNow] }), [[['6295', 22, '2001']], '6296'])
  clock = oct(22, 6, 50); mgr.use((m) => m.palletPartFix(m.store.get().runs.find((x) => x.lineId === pl.id && !x.endedAt).id, 0, { tag: '2002' })); settle()
  eq('y un tag corregido desde la oficina llega a la tablet', tab.use((m) => c3().extra.open.parts[0].tag), '2002')
  clock = oct(22, 7, 0); tab.use((m) => m.endRun(c3().id, false)); settle()
  eq('nada queda pendiente de enviar', all.map((d) => d.use((m) => m.outbox.size())), [0, 0])
}
section('Agregar un pallet que nadie registró, y volver a abrir el último pallet')
{
  // what Jose asked on 2026-10-16: a pallet found on the floor with its tags goes on its run after the fact; and
  // "Pallet completo" tapped by mistake when a lot changed must not leave the cases as a pallet of their own
  const fx = await device('fix', { user: 'Mara', usual: true })
  fx.use((m) => {
    const st = () => m.store.get(), run = () => st().runs.find((r) => r.code === 'D400')
    m.addLine('Packing', 'Línea 1')
    const l1 = st().lines.find((l) => l.dept === 'Packing' && l.name === 'Línea 1')
    const po = m.saveOrder(null, { customer: 'Cliente Seis', po: '6001', code: 'D400', cases: 108, shipBy: '', dest: '' })
    clock = oct(10, 6, 0); m.startRun(l1, 'D400', '6283', DAY, 36)
    const full = (tag) => { clock += 20 * M; return m.palletDone(run().id, [{ lot: '6283', qty: 36, tag }], po) }
    full('3001'); full('3002')
    eq('dos pallets en el PO; el tercero no se registró', [m.orderMade(st(), po), run().units.length], [72, 2])
    // the third pallet turns up later with its tags: it is added at the hour it was made, and lands among the others by it
    clock = oct(10, 9, 0); m.endRun(run().id, false)
    const at = m.addUnit(run().id, { at: oct(10, 6, 30), qty: null, lots: [{ lot: '6283', qty: 20, tag: '3003' }, { lot: '6284', qty: 16, tag: '3004' }], po })
    eq('el pallet agregado queda en su hora, con sus lotes, tags, cajas y PO, y el PO se completa', [at, run().units.map((u) => [new Date(u.at).getMinutes(), u.qty, u.ref, u.po === po]), m.orderMade(st(), po)], [oct(10, 6, 30), [[20, 36, '3001', true], [30, 36, '3003, 3004', true], [40, 36, '3002', true]], 108])
    eq('queda en el historial con quién y qué', st().changes.filter((c) => c.refKey === run().id && c.what.includes('Se agregó pallet')).map((c) => [c.by, c.what.split(' · ').pop(), c.after]), [['Mara', 'Se agregó pallet 2 (6:30 AM)', '36 cajas · 6283: 20 (tag 3003) + 6284: 16 (tag 3004) · Cliente Seis · PO 6001']])
    eq('a la misma hora exacta no caben dos: el segundo se corre un instante', [m.addUnit(run().id, { at: oct(10, 6, 30), qty: 36 }), run().units.length], [oct(10, 6, 30) + 1, 4])
    eq('antes de que empezara la corrida no: se pone al inicio', m.addUnit(run().id, { at: oct(10, 5, 0), qty: 36, ref: '9' }), oct(10, 6, 0))
    eq('sin una hora no se agrega nada', [m.addUnit(run().id, { at: NaN, qty: 36 }), run().units.length], [0, 5])
    // "Pallet completo" tapped when lot 6285 ran out: the cases went on with the same pallet, with lot 6286
    clock = oct(10, 10, 0); m.startRun(l1, 'D401', '6285', DAY, 36)
    const r2 = () => st().runs.find((r) => r.code === 'D401')
    clock = oct(10, 10, 30); m.palletDone(r2().id, [{ lot: '6285', qty: 20, tag: '3100' }], '')
    eq('se guardó un pallet de 20 cajas por error', r2().units.length, 1)
    eq('se vuelve a abrir con sus cajas y su tag, y sigue con el lote que dicen', [m.reopenPallet(r2().id, '6286'), r2().units.length, r2().extra.open.parts.map((p) => [p.lot, p.qty, p.tag]), m.lotNowOf(r2())], [true, 0, [['6285', 20, '3100']], '6286'])
    eq('y queda en el historial', st().changes.filter((c) => c.refKey === r2().id).map((c) => [c.what.split(' · ').slice(-2).join(' · '), c.before, c.after]), [['Pallet 1 · se volvió a abrir', '20 cajas · 6285: 20 (tag 3100)', 'sigue con el lote 6286']])
    eq('sin pallets no hay nada que reabrir', m.reopenPallet(r2().id), false)
    clock += M; m.palletDone(r2().id, [...r2().extra.open.parts, { lot: '6286', qty: 16, tag: '3101' }], '')
    clock += M; m.palletLotEnds(r2().id, 5, '', '6287')
    eq('con el pallet que sigue ya empezado tampoco', m.reopenPallet(r2().id), false)
    eq('el pallet quedó con sus dos lotes', r2().units.map((u) => [u.qty, u.lots.map((l) => [l.lot, l.qty, l.tag])]), [[36, [['6285', 20, '3100'], ['6286', 16, '3101']]]])
  })
}
section('La tarjeta del turno sigue con un código que viene del día de trabajo anterior, y con una línea que solo hace bins')
{
  // what Jose saw on 2026-10-15 at 3:30 AM: codes started at 3:28 (still the second shift of the 14th) went on into the
  // first shift of the 15th; the room's card went away, and what the shift made on them would not have counted in it
  const cr = await device('carry', { user: 'Luis', usual: true })
  cr.use((m) => {
    const st = () => m.store.get(), run = (code) => st().runs.find((r) => r.code === code)
    const lineOf = (name) => { m.addLine('Packing', name); return st().lines.find((l) => l.dept === 'Packing' && l.name === name) }
    const l1 = lineOf('Línea 1'), l2 = lineOf('Línea 2')
    clock = oct(23, 3, 28)
    m.startRun(l1, 'A100', '6295', '2026-10-22', 36)
    m.startRun(l2, 'B200', '6295', '2026-10-22', null, 'platos')
    clock = oct(23, 3, 40)
    const before = m.deptToday(st(), 'Packing', '2026-10-23', clock)
    eq('a las 3:40 ya es el turno 1 del día nuevo: la tarjeta sigue, desde cero, con los códigos que vienen corriendo', [before.shift, before.live, before.shiftQty, before.shiftCodes.map((c) => c.code), before.runs.length], [1, true, 0, ['A100'], 0])
    clock = oct(23, 4, 0)
    m.palletDone(run('A100').id, [{ lot: '6295', qty: 36, tag: '1900' }], '')
    m.unitDone(run('B200').id, 50, '7')
    const t = m.deptToday(st(), 'Packing', '2026-10-23', clock)
    eq('lo que el turno hace en ellos cuenta en el turno: el pallet en cajas, y el bin aparte', [t.shiftQty, t.shiftUnits, t.shiftBins], [36, 1, [{ word: 'platos', units: 1, qty: 50 }]])
    m.endRun(run('A100').id, false)
    const b = m.deptToday(st(), 'Packing', '2026-10-23', clock)
    eq('una sala que solo tiene una línea de bins corriendo también tiene su tarjeta', [b.live, b.runs.length], [true, 0])
  })
}
section('Empezar Set up nunca se queda sin hacer nada')
{
  // what Jose saw on the floor: on some lines "Empezar Set up" did nothing. A stop left open there the day before is
  // not on the free line's card, and it stopped the button
  const su = await device('su', { user: 'Luis', usual: true })
  su.use((m) => {
    const st = () => m.store.get(), open = (id) => st().stops.filter((x) => x.lineId === id && !x.endedAt)
    m.addLine('Packing', 'Línea 3')
    const l = st().lines.find((x) => x.dept === 'Packing' && x.name === 'Línea 3')
    clock = oct(12, 22, 0); m.startStop('Packing', l.id, 'Problema mecánico', '')
    clock = oct(13, 7, 0)
    eq('un paro que quedó abierto desde otro día no está en la tarjeta de la línea libre', m.idleStop(st(), l.id, clock), undefined)
    m.startSetup(l)
    eq('y "Empezar Set up" empieza el Set up igual: el paro viejo se quita', open(l.id).map((x) => [x.reason, x.startedAt === clock]), [['Set up', true]])
    m.startSetup(l)
    eq('el que está en la tarjeta sigue: tocarlo otra vez no abre otro', open(l.id).length, 1)
    // asked 2026-10-16: one tap puts every free line of every room in set up (the office, when a shift starts)
    m.addLine('RTE', 'Línea 9'); m.addLine('Kitchen', 'Braiser 9')
    const l9 = st().lines.find((x) => x.dept === 'RTE' && x.name === 'Línea 9'), b9 = st().lines.find((x) => x.dept === 'Kitchen' && x.name === 'Braiser 9')
    clock = oct(13, 7, 5); m.startRun(b9, 'K100', '6286', '2026-10-13', null)
    eq('las líneas libres son las que no tienen código ni Set up ni paro', m.freeLines(st(), clock).map((x) => x.name), ['Línea 9'])
    eq('"Set up en todas": las libres entran en Set up a la vez; la que ya lo estaba y la que corre siguen como están', [m.startSetupAll(), open(l9.id).map((x) => x.reason), open(l.id).length, m.openRun(st(), b9.id) ? 'corre' : '', m.freeLines(st(), clock).length], [1, ['Set up'], 1, 'corre', 0])
    eq('el Set up de todas cuenta desde el inicio del turno en curso (Jose: "el de la 2"), nunca antes de que la línea quedara libre', [open(l9.id)[0].startedAt, m.setupAllFrom(st(), clock)], [m.turnOf(st(), '2026-10-13', clock).since, m.turnOf(st(), '2026-10-13', clock).since])
    eq('con ninguna libre no hace nada', m.startSetupAll(), 0)
  })
}
section('Avance: cada código lo empaca RTE o MFO, nunca los dos; y se puede ver un solo lote')
{
  // what Jose was told on 2026-10-15: some codes only MFO makes and others only RTE ("el 30094 lo hace MFO"), and the
  // office's daily sheets list each code under the RTE ROOM or under the MFO SUMMARY. A code MFO packs cannot show
  // RTE pouches to make; it shows MFO's cases. And Avance can be looked at for one lot.
  const av = await device('av', { user: 'Oficina', usual: true })
  av.use((m) => {
    const st = () => m.store.get(), row = (code, lot) => m.avanceRows(st(), '2026-10-20', undefined, lot).find((r) => r.code === code)
    m.mergeProducts([{ code: 'M500', name: 'Pollo asado', pouchesPerCase: 8, casesPerMix: 25, cratesPerCart: 0, pouchesPerCrate: 0, casesPerPallet: 40, room: 'MFO', updatedAt: 0 }, { code: 'R600', name: 'Albóndigas', pouchesPerCase: 8, casesPerMix: 18.5, cratesPerCart: 24, pouchesPerCrate: 10, casesPerPallet: 36, updatedAt: 0 }])
    m.setSchedule('2026-10-20', 'M500', 4); m.setSchedule('2026-10-20', 'R600', 2)
    const add = (id, dept, code, lot, units, extra = {}) => m.applyRemote('act_runs', { id, dept, line_id: dept + '1', line: 'Línea 1', code, lot, date: '2026-10-20', started_at: new Date(oct(20, 7, 0)).toISOString(), ended_at: new Date(oct(20, 12, 0)).toISOString(), units, per_unit: null, waste: 0, by_name: 'Luis', deleted: false, updated_at: new Date(oct(20, 12, 0)).toISOString(), ...extra })
    const u = (h, qty, ref = '', lots) => ({ at: oct(20, h, 0), qty, ref, by: 'Luis', ...(lots ? { lots } : {}) })
    add('k1', 'Kitchen', 'M500', '6293', [u(8, null), u(9, null)])
    add('k2', 'Kitchen', 'R600', '6293', [u(8, null), u(9, null)])
    add('mf', 'MFO', 'M500', '6293', [u(10, 30, '1')])
    add('rt', 'RTE', 'R600', '6293', [u(10, 240)])
    add('pk', 'Packing', 'M500', '6292', [u(11, 40, '1900', [{ lot: '6292', qty: 15 }, { lot: '6293', qty: 25 }])], { per_unit: 40 })
    const a = row('M500'), b = row('R600')
    eq('un código que la tabla dice que empaca MFO: RTE no tiene nada que hacer con él, y MFO espera las cajas de sus mezclas', [a.packRoom, a.packSaid, a.pouchesPlan, a.pouchesExp, a.mfoPlan, a.mfoExp, a.mfo, m.pending(a.mfoExp, a.mfo[0].qty)], ['MFO', true, null, null, 100, 50, [{ word: 'cajas', qty: 30 }], 20])
    eq('y uno de RTE, al revés: MFO no espera nada de él', [b.packRoom, b.pouchesPlan, b.pouchesExp, b.mfoPlan, b.mfoExp], ['RTE', 296, 296, null, null])
    // with nothing in the table, the room that has registered the code says it
    m.applyRemote('act_runs', { id: 'mf2', dept: 'MFO', line_id: 'MFO1', line: 'Línea 1', code: 'Q700', lot: '6293', date: '2026-10-20', started_at: new Date(oct(20, 7, 0)).toISOString(), ended_at: null, units: [u(9, 20, '2')], per_unit: null, waste: 0, by_name: 'Luis', deleted: false, updated_at: new Date(oct(20, 9, 0)).toISOString() })
    eq('un código sin "Lo empaca" en la tabla: lo decide el cuarto que lo ha registrado', [m.packRoomOf(st(), 'Q700'), m.packRoomOf(st(), 'Z999')], [{ room: 'MFO', said: false }, { room: 'RTE', said: false }])
    // one lot: the mezclas, bins and cases of that lot; a pallet with two lots gives the cases of the one chosen
    eq('los lotes del día, también los de un pallet con dos', m.avanceLots(st(), '2026-10-20'), ['6292', '6293'])
    const l3 = row('M500', '6293'), l2 = row('M500', '6292')
    eq('con un lote: lo hecho de ese lote, sin el programa del día (que no es por lote)', [l3.scheduled, l3.mixesDone, l3.mfo, l3.casesDone, l3.palletsDone, l3.mfoPlan, l3.mfoExp], [0, 2, [{ word: 'cajas', qty: 30 }], 25, 1, null, 50])
    eq('y el otro lote del mismo pallet: sus 15 cajas, y ninguna mezcla de ese día', [l2.mixesDone, l2.casesDone, l2.palletsDone, l2.mfo], [0, 15, 1, []])
    eq('un código que no tocó ese lote no sale', m.avanceRows(st(), '2026-10-20', undefined, '6292').map((r) => r.code), ['M500'])
    // the office's file can say which room packs each code; one that does not say it leaves what the table had
    const csv = 'Código,Producto,Lo empaca\nR600,Albóndigas,RTE\nM500,Pollo asado,mfo\nX1,Otro,\n'
    eq('el CSV de productos lee "Lo empaca"', m.parseProductsCsv(csv).map((p) => [p.code, p.room ?? '']), [['R600', 'RTE'], ['M500', 'MFO'], ['X1', '']])
    m.mergeProducts([{ code: 'M500', name: '', pouchesPerCase: 0, casesPerMix: 0, cratesPerCart: 0, pouchesPerCrate: 0, casesPerPallet: 0, updatedAt: 0 }])
    eq('un archivo sin esa columna no le quita a un producto ni su cuarto ni sus números', [m.productOf(st(), 'M500').room, m.productOf(st(), 'M500').casesPerMix], ['MFO', 25])
    eq('y lo que la app exporta se vuelve a leer con su cuarto', m.parseProductsCsv(m.productsCsv(st().products)).filter((p) => p.code === 'M500').map((p) => p.room), ['MFO'])
    const sent = m.outbox.items().filter((i) => i.table === 'act_products').map((i) => i.row).find((x) => x.code === 'M500')
    eq('sube al servidor con su cuarto', sent.room, 'MFO')
    // waste: every room has it now (it was RTE's only)
    eq('el waste está en todos los departamentos', m.DEPTS.map((d) => !!m.CFG[d].waste), [true, true, true, true, true])
    // what Jose asked on 2026-10-16 for the office: each code opens into its lots and its shifts, the total of a lot
    // across its days, and "Lo empaca" fixed from Avance itself
    const m5 = row('M500')
    eq('cada código dice lo hecho por lote (el pallet de dos lotes da a cada uno sus cajas y cuenta como pallet solo del lote con más cajas: la oficina, 2026-10-19)', m5.lots.map((l) => [l.lot, l.mixes, l.mfo, l.cases, l.pallets]), [['6292', 0, {}, 15, 0], ['6293', 2, { cajas: 30 }, 25, 1]])
    eq('y por turno: todo fue en el turno 1', [m5.byShift[0].mixes, m5.byShift[0].mfo, m5.byShift[0].cases, m5.byShift[0].pallets, m5.byShift[1].cases, m5.byShift[1].mixes], [2, { cajas: 30 }, 40, 1, 0, 0])
    eq('con un lote escogido, por turno solo va lo de ese lote', row('M500', '6292').byShift[0].cases, 15)
    const across = m.lotAcrossDays(st(), '6293')
    eq('el total de un lote en todos sus días, código por código y en todo', [across.days, across.codes.map((c) => [c.code, c.mixes, c.pouches, c.mfo, c.cases, c.pallets]), across.total.mixes, across.total.pouches, across.total.cases, across.total.pallets], [['2026-10-20'], [['M500', 2, 0, { cajas: 30 }, 25, 1], ['Q700', 0, 0, { cajas: 20 }, 0, 0], ['R600', 2, 240, {}, 0, 0]], 4, 240, 25, 1])
    m.setPackRoom('Q700', 'MFO')
    eq('fijar desde Avance quién empaca un código lo escribe en Productos, aunque el código no estuviera', [m.productOf(st(), 'Q700').room, m.packRoomOf(st(), 'Q700')], ['MFO', { room: 'MFO', said: true }])
    m.setPackRoom('M500', 'RTE')
    eq('y cambia el de uno que ya estaba, con su historial', [m.productOf(st(), 'M500').room, row('M500').packRoom, st().changes.filter((c) => c.what === 'Producto M500 · Lo empaca').map((c) => [c.before, c.after])], ['RTE', 'RTE', [['MFO', 'RTE']]])
    m.setPackRoom('M500', 'MFO')
    eq('decir lo que ya está no cambia nada', [m.setPackRoom('M500', 'MFO'), m.productOf(st(), 'M500').room], [undefined, 'MFO'])
    // the office asked (2026-10-16): the total of a lot over all its days, day by day; a lot of another day chosen from a list
    const ad = m.lotAcrossDays(st(), '6293')
    eq('el lote por código dice cada día que se trabajó', ad.codes.find((c) => c.code === 'M500').days.map((d) => [d.date, d.mixes, d.mfo, d.cases, d.pallets]), [['2026-10-20', 2, { cajas: 30 }, 25, 1]])
    eq('las filas de Avance de un lote en todos sus días: lo hecho contra lo que sus mezclas permiten, sin programa', m.lotRows(st(), '6293').map((r) => [r.code, r.mixesDone, r.casesExp, r.mfoExp, r.pouchesExp, r.casesDone, r.scheduled, r.pouchesPlan, r.days.length]), [['M500', 2, 50, 50, null, 25, 0, null, 1], ['Q700', 0, null, null, null, 0, 0, null, 1], ['R600', 2, 37, null, 296, 0, 0, null, 1]])
    eq('los lotes que el aparato conoce, el más nuevo primero', m.lotsKnown(st()), ['6293', '6292'])
    // several days added up (asked 2026-10-16): the next day has more of M500, and the range says both days
    add('k3', 'Kitchen', 'M500', '6294', [{ at: oct(21, 8, 0), qty: null, ref: '', by: 'Luis' }], { date: '2026-10-21', started_at: new Date(oct(21, 7, 0)).toISOString(), ended_at: new Date(oct(21, 12, 0)).toISOString() })
    add('mf3', 'MFO', 'M500', '6294', [{ at: oct(21, 10, 0), qty: 20, ref: '3', by: 'Luis' }], { date: '2026-10-21', started_at: new Date(oct(21, 7, 0)).toISOString(), ended_at: new Date(oct(21, 12, 0)).toISOString() })
    m.setSchedule('2026-10-21', 'M500', 1)
    eq('los días de un rango, los dos incluidos, también al revés', [m.datesBetween('2026-10-20', '2026-10-22'), m.datesBetween('2026-10-22', '2026-10-20').length, m.datesBetween('2026-10-20', '2026-10-20')], [['2026-10-20', '2026-10-21', '2026-10-22'], 3, ['2026-10-20']])
    const rg = m.avanceRange(st(), '2026-10-20', '2026-10-22').find((r) => r.code === 'M500')
    eq('un código en el rango suma sus días: programa, mezclas, cajas de MFO, y dice cada día', [rg.scheduled, rg.mixesDone, rg.mfo, rg.mfoPlan, rg.mfoExp, rg.casesDone, rg.palletsDone, rg.days.map((d) => [d.date, d.mixes, d.mfo])], [5, 3, [{ word: 'cajas', qty: 50 }], 125, 75, 40, 1, [['2026-10-20', 2, { cajas: 30 }], ['2026-10-21', 1, { cajas: 20 }]]])
    eq('sus lotes del rango, y sus turnos sumados', [rg.lots.map((l) => [l.lot, l.mixes, l.mfo, l.cases]), rg.byShift[0].mixes, rg.byShift[0].mfo], [[['6292', 0, {}, 15], ['6293', 2, { cajas: 30 }, 25], ['6294', 1, { cajas: 20 }, 0]], 3, { cajas: 50 }])
    eq('con un lote, el rango solo trae lo de ese lote', m.avanceRange(st(), '2026-10-20', '2026-10-22', '6294').map((r) => [r.code, r.mixesDone, r.mfo, r.days.length]), [['M500', 1, [{ word: 'cajas', qty: 20 }], 1]])
  })
}
section('Una unidad quitada a propósito no vuelve por ninguna mezcla, venga de donde venga la otra versión')
{
  // 2026-10-16: a cart taken off in Corregir came back by itself (see tests/server.mjs). The unit taken off leaves
  // its moment on the row; every merge, on every device, respects the marks of every version
  const fx = await device('fx', { user: 'Manager', usual: true })
  fx.use((m) => {
    const st = () => m.store.get(), run = () => st().runs.find((r) => r.id === 'rx')
    const row = (units, extra, at) => ({ id: 'rx', dept: 'RTE', line_id: 'RTE1', line: 'Línea 1', code: 'R900', lot: '6290', date: '2026-10-16', started_at: new Date(oct(16, 6, 0)).toISOString(), ended_at: null, units, per_unit: 240, waste: 0, by_name: 'Luis', deleted: false, extra, updated_at: new Date(at).toISOString(), synced_at: new Date(at + 1).toISOString() })
    const u = (h, mi, ref) => ({ at: oct(16, h, mi), qty: 240, ref, by: 'Luis' })
    m.applyRemote('act_runs', row([u(7, 0, '1'), u(8, 0, '2')], null, oct(16, 8, 1)))
    clock = oct(16, 9, 0)
    m.updateRun('rx', { units: run().units.filter((x) => x.ref !== '2') })
    eq('quitar un carro deja su marca en la corrida', [run().units.map((x) => x.ref), run().extra.removed], [['1'], [oct(16, 8, 0)]])
    // an older picture of the run from a tablet that was offline, with the cart still on it and a new one
    m.applyRemote('act_runs', row([u(7, 0, '1'), u(8, 0, '2'), u(8, 30, '4')], null, oct(16, 8, 30)))
    eq('la foto vieja de otra tablet trae su carro nuevo, pero no revive el quitado', run().units.map((x) => x.ref), ['1', '4'])
    // another device took a cart off on purpose (its row carries the mark): it goes here too, and the marks join
    m.applyRemote('act_runs', row([u(8, 30, '4')], { removed: [oct(16, 7, 0)] }, oct(16, 8, 40)))
    eq('lo que otra tablet quitó a propósito también se quita aquí, y las marcas se juntan', [run().units.map((x) => x.ref), run().extra.removed], [['4'], [oct(16, 7, 0), oct(16, 8, 0)]])
    // a unit added after the fact never lands on a mark
    const at = m.addUnit('rx', { at: oct(16, 8, 0), qty: 240, ref: '9' })
    eq('una unidad agregada a la hora de una quitada se corre un instante, y sale', [at, run().units.map((x) => x.ref)], [oct(16, 8, 0) + 1, ['9', '4']])
  })
}
section('Una versión nueva entra sola cuando nadie está en medio de algo')
calc.use((m) => {
  const t = 10_000_000
  eq('un minuto sin tocar, sin ventana abierta y sin escribir: se recarga', m.quietToReload(t, t - 61_000, false, false), true)
  eq('tocado hace poco, una ventana abierta o alguien escribiendo: espera', [m.quietToReload(t, t - 30_000, false, false), m.quietToReload(t, t - 61_000, true, false), m.quietToReload(t, t - 61_000, false, true)], [false, false, false])
  eq('con la memoria del aparato llena no se recarga nunca; con espacio, sí (auditoría 2026-10-17, S9)', [m.quietToReload(t, t - 61_000, false, false, true), m.quietToReload(t, t - 61_000, false, false, false)], [false, true])
})

section('La tablet de un operador no escribe nada de otro cuarto')
{
  // 2026-10-17: MFO's tablet, hearing an RTE code start, tried to end an RTE set up left open and the server refused
  // it (the row was of another room). An operator's device only heals its own room's lines; a manager's heals all
  const op = await device('op', { user: 'Yaima', usual: true })
  op.use((m) => {
    const st = () => m.store.get()
    m.role.set('op'); m.myDept.set('MFO')
    const at = oct(17, 9, 0)
    m.applyRemote('act_stops', { id: 'su-rte', dept: 'RTE', line_id: 'RTE1', reason: 'Set up', note: '', started_at: new Date(at - 600_000).toISOString(), ended_at: null, by_name: 'Alma', deleted: false, updated_at: new Date(at - 600_000).toISOString(), synced_at: new Date(at - 599_000).toISOString() })
    m.applyRemote('act_runs', { id: 'r-rte', dept: 'RTE', line_id: 'RTE1', line: 'Línea 1', code: '0889', lot: '6290', date: '2026-10-17', started_at: new Date(at).toISOString(), ended_at: null, units: [], per_unit: 240, waste: 0, by_name: 'Alma', deleted: false, updated_at: new Date(at).toISOString(), synced_at: new Date(at + 1000).toISOString() })
    eq('oye el código de RTE y el Set up abierto de esa línea, pero no manda nada: no es su cuarto', [st().stops.find((x) => x.id === 'su-rte').endedAt, m.outbox.size()], [null, 0])
    m.role.set('mgr')
    m.applyRemote('act_runs', { id: 'r-rte', dept: 'RTE', line_id: 'RTE1', line: 'Línea 1', code: '0889', lot: '6290', date: '2026-10-17', started_at: new Date(at).toISOString(), ended_at: null, units: [{ at: at + 60_000, qty: 240, ref: '', by: 'Alma' }], per_unit: 240, waste: 0, by_name: 'Alma', deleted: false, updated_at: new Date(at + 60_000).toISOString(), synced_at: new Date(at + 61_000).toISOString() })
    eq('un manager sí cierra ese Set up donde empezó el código, y lo manda', [st().stops.find((x) => x.id === 'su-rte').endedAt, m.outbox.items().map((i) => i.table)], [at, ['act_stops']])
  })
}

section('Un operador que puede mirar todos los cuartos escribe solo en el suyo, como dice el servidor (revisión 2026-10-18)')
{
  // "Ver todos los departamentos" let an operator start codes, correct runs and add records in other rooms; the server
  // refused them (act_can_write), and since refused rows are no longer thrown away they waited on the tablet for ever,
  // or went up under the next manager's session. The screens now ask the server's own rule
  calc.use((m) => {
    const op = { role: 'op', dept: 'Packing', powers: ['depts', 'fix', 'goals'] }
    eq('las pantallas: el manager y la oficina en todos los cuartos, un operador solo en el suyo, quien solo mira en ninguno', [m.writesIn({ role: 'mgr' }, 'RTE'), m.writesIn({ role: 'office' }, 'MFO'), m.writesIn(op, 'Packing'), m.writesIn(op, 'RTE'), m.writesIn({ role: 'viewer' }, 'RTE'), m.writesIn({ role: 'op' }, '')], [true, true, true, false, false, false])
  })
  const og = await device('og', { user: 'Olga', usual: true })
  og.use((m) => {
    m.role.set('op'); m.myDept.set('Packing')
    eq('la tablet dice lo mismo', [m.writesRoom('Packing'), m.writesRoom('RTE')], [true, false])
    m.setShiftGoal('RTE', 1, 10, 80); m.setShiftGoal('Packing', 1, 12, 90)
    const log = () => m.outbox.items().filter((i) => i.table === 'act_changes').map((i) => [i.row.what, i.row.dept])
    // the goal goes with the power "Poner metas", for any room; the history line of another room had its room and was
    // refused to her: without a room it goes with that same power (tests/stack.mjs sees the server take it)
    eq('una meta de otro cuarto: la meta se guarda, y su historial va sin cuarto; la de su cuarto, con su cuarto', [m.outbox.items().filter((i) => i.table === 'act_targets').map((i) => i.key).sort(), log()], [['Packing@1', 'RTE@1'], [['Meta RTE · Turno 1 · por hora', null], ['Meta RTE · Turno 1 · del turno', null], ['Meta Packing · Turno 1 · por hora', 'Packing'], ['Meta Packing · Turno 1 · del turno', 'Packing']]])
    m.role.set('mgr'); m.myDept.set('')
    m.setShiftGoal('RTE', 2, 5, 40)
    eq('un manager la guarda con su cuarto', log().slice(-2), [['Meta RTE · Turno 2 · por hora', 'RTE'], ['Meta RTE · Turno 2 · del turno', 'RTE']])
  })
}

section('Un aparato de "Solo ver" no cierra un Set up por su cuenta, y no pierde lo que solo él tiene (auditoría 2026-10-17)')
{
  // Somebody who only looks enters as a manager for what they see (role 'mgr'), and the server takes nothing from
  // them. Their device used to write on its own all the same: hearing a code start it ended the Set up left open on
  // that line. The server refused it, and the office's screen showed the red bar of a session the server does not take
  const ver = await device('ver', { user: 'Vera', usual: true })
  ver.use((m) => {
    const st = () => m.store.get()
    m.role.set('mgr'); localStorage.setItem('act_view_only', '1') // what App.tsx keeps for a viewer
    const at = oct(17, 9, 0), t = (ms) => new Date(ms).toISOString()
    m.applyRemote('act_stops', { id: 'su-v', dept: 'RTE', line_id: 'RTE1', reason: 'Set up', note: '', started_at: t(at - 600_000), ended_at: null, by_name: 'Alma', deleted: false, updated_at: t(at - 600_000), synced_at: t(at - 599_000) })
    m.applyRemote('act_runs', { id: 'r-v', dept: 'RTE', line_id: 'RTE1', line: 'Línea 1', code: '0889', lot: '6290', date: '2026-10-17', started_at: t(at), ended_at: null, units: [{ at: at + 60_000, qty: 240, ref: '1', by: 'Alma' }, { at: at + 120_000, qty: 240, ref: '2', by: 'Alma' }], per_unit: 240, waste: 0, by_name: 'Alma', deleted: false, updated_at: t(at + 120_000), synced_at: t(at + 121_000) })
    eq('oye el código y el Set up abierto de su línea, y no manda nada: el servidor lo cierra solo', [st().stops.find((x) => x.id === 'su-v').endedAt, m.outbox.size()], [null, 0])
    // A version of the run without one of the units, and no mark that it was taken off on purpose: this device may hold
    // the only copy of that unit (a row an older version dropped from its queue). It is kept, and waits on the device
    // for someone who may send it (review of 2026-10-18: it used to be dropped from the device for good). The server
    // will not take it from a viewer, so outbox.ts keeps it for someone else (tests/stack.mjs, S2 case d)
    m.applyRemote('act_runs', { id: 'r-v', dept: 'RTE', line_id: 'RTE1', line: 'Línea 1', code: '0889', lot: '6290', date: '2026-10-17', started_at: t(at), ended_at: null, units: [{ at: at + 60_000, qty: 240, ref: '1', by: 'Alma' }], per_unit: 240, waste: 0, by_name: 'Alma', deleted: false, updated_at: t(at + 180_000), synced_at: t(at + 181_000) })
    eq('una corrida que llega con una unidad menos y sin marca de quitada: el aparato la conserva y la deja esperando, sin el Set up', [st().runs.find((r) => r.id === 'r-v').units.map((u) => u.ref), m.outbox.items().map((i) => [i.table, i.row.units?.map((u) => u.ref)])], [['1', '2'], [['act_runs', ['1', '2']]]])
    localStorage.setItem('act_view_only', '')
  })
}

section('Solo ver: un usuario de la oficina que mira todo y no toca nada')
{
  // asked on 2026-10-15: people from the office who only want to look at the app and its data (Actividad, Avance, the
  // report), without a button to press. The role holds one power, looking at every room, and nothing can add to it.
  calc.use((m) => {
  eq('sus poderes son solo ver todos los departamentos, y no se le pueden dar más', [m.defaultPowers('viewer'), m.powersOf({ role: 'viewer', powers: ['fix', 'del', 'goals'] }), m.powersOf({ role: 'viewer', powers: [] })], [['depts'], ['depts'], ['depts']])
  eq('no corrige, no borra, no pone metas ni programa, no maneja empleados', ['fix', 'del', 'goals', 'shifts', 'orders', 'day', 'products', 'people', 'othershift'].map((p) => m.canDo({ role: 'viewer' }, p)), [false, false, false, false, false, false, false, false, false])
  eq('el reporte le abre en los dos turnos y puede mirar lo de cualquiera', [m.canDo({ role: 'viewer' }, 'depts'), m.canShift({ role: 'viewer', shift: 0 }, '1 y 2')], [true, true])
  eq('los demás roles siguen igual', [m.defaultPowers('office').length, m.defaultPowers('mgr').includes('othershift'), m.defaultPowers('op')], [10, false, []])
  })
}
section('Pedidos: todos los pallets que se le dieron a un pedido cuentan, también los de días que el aparato ya no guarda')
{
  // what the office saw on 2026-10-15: an order of 7 pallets said complete, and the next day it said 6 pallets and
  // 36 cases missing. A pallet given to it two weeks earlier had left the device (it keeps 14 days) and "Hechas" only
  // added what the device held. Now a run that gave pallets to an open order stays, apart, while the order is open.
  const od = await device('od', { user: 'Oficina', usual: true })
  od.use((m) => {
    const st = () => m.store.get()
    clock = oct(16, 8, 0)
    const po = m.saveOrder(null, { customer: 'Cliente Siete', po: '7007', code: 'A700', cases: 252, shipBy: '', dest: '' })
    const pallet = (at, qty, order) => ({ at, qty, ref: 't', by: 'Luis', po: order })
    const long = oct(16, 8, 0) - 20 * 86_400_000 // twenty days ago: out of what the device keeps
    m.applyRemote('act_runs', runRow({ id: 'old-run', dept: 'Packing', lineId: 'P1', code: 'A700', date: m.dayOf(long), startedAt: long, endedAt: long + 3_600_000, units: [pallet(long + 600_000, 36, po)], perUnit: 36 }))
    m.prune()
    eq('el pallet viejo ya no está entre las corridas del aparato, pero queda guardado aparte para su pedido', [st().runs.some((r) => r.id === 'old-run'), st().orderRuns.map((r) => r.id)], [false, ['old-run']])
    m.applyRemote('act_runs', runRow({ id: 'new-run', dept: 'Packing', lineId: 'P1', code: 'A700', date: '2026-10-16', startedAt: oct(16, 6, 0), units: [1, 2, 3, 4, 5, 6].map((i) => pallet(oct(16, 6, i * 10), 36, po)), perUnit: 36 }))
    eq('"Hechas" suma los 7 pallets: 252 cajas, completo, y el último es el 7 de 7', [m.orderMade(st(), po), m.orderPallets(st(), po, 36).done.length, m.orderPallets(st(), po, 36).need], [252, 7, 7])
    const rep = m.reportOf(st(), '2026-10-16', clock, { only: 'Packing' })
    eq('y en el reporte de hoy sus pallets son del 2 al 7 de 7', rep.pallets.map((p) => p.of), [[2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7]])
    m.prune()
    eq('una poda más no lo cuenta dos veces ni lo suelta', [m.orderMade(st(), po), st().orderRuns.length], [252, 1])
    m.closeOrder(po, true); m.prune()
    eq('cerrado el pedido, el aparato suelta lo que guardaba aparte', st().orderRuns.length, 0)
  })
}
section('Spiral: un código se cuenta en mezclas, en libras o en cajas, y el programa lo dice')
{
  // what Jose learned on 2026-10-15: Spiral programs some items in pounds ("3492 libras de CHICKEN HERB"); the office's
  // SPIRAL sheets write "3000 LB" or "200 CS" in the #BATCH cell, and each rack below carries its pounds or cases
  const sp = await device('spi', { user: 'Luis', usual: true })
  sp.use((m) => {
    const st = () => m.store.get(), run = (code) => st().runs.find((r) => r.code === code && !r.endedAt) ?? st().runs.find((r) => r.code === code)
    const lineOf = (name) => { m.addLine('Spiral', name); return st().lines.find((l) => l.dept === 'Spiral' && l.name === name) }
    clock = oct(10, 6, 0)
    const l1 = lineOf('Línea 1'), l2 = lineOf('Línea 2')
    // the office programs chicken herb in pounds: the products table learns how Spiral counts it
    m.setPlan(DAY, 'Spiral', 'CHICKEN HERB', 3492); m.setSpiralUnit('CHICKEN HERB', 'lb')
    m.setPlan(DAY, 'Spiral', '0100', 10)
    eq('la tabla de productos dice cómo cuenta Spiral cada código', [m.productOf(st(), 'CHICKEN HERB')?.spiralUnit, m.productOf(st(), '0100')?.spiralUnit], ['lb', undefined])
    eq('el programa de Spiral: cada código en su unidad', m.planRows(st(), DAY, 'Spiral').map((r) => [r.code, r.planned, r.unit]), [['0100', 10, 'mezclas'], ['CHICKEN HERB', 3492, 'lb']])
    // the line starts the code in pounds: each mezcla says its pounds
    m.startRun(l1, 'CHICKEN HERB', '6287', DAY, null, '', 'lb')
    const ch = run('CHICKEN HERB'), cfg = m.cfgOf(ch)
    eq('una corrida en libras: sus palabras', [m.measureOf(ch), m.apartOf(ch), cfg.unit, cfg.qty, cfg.qtyUnit, cfg.qtyQ], ['lb', 'lb', 'Mezcla', 'ask', 'lb', '¿Cuántas libras lleva esta mezcla?'])
    clock = oct(10, 7, 0); m.unitDone(ch.id, 1543)
    clock = oct(10, 8, 0); m.unitDone(ch.id, 1407)
    eq('lo hecho se dice en mezclas y libras', m.madeText(run('CHICKEN HERB'), m.runQty(st(), run('CHICKEN HERB'))), '2 mezclas · 2,950 lb')
    const row = m.planRows(st(), DAY, 'Spiral').find((r) => r.code === 'CHICKEN HERB')
    eq('el programa descuenta las libras: 3,492 − 2,950', [row.done, row.left, row.unit, row.other], [2950, 542, 'lb', []])
    // a mezcla of 0100 the usual way
    m.startRun(l2, '0100', '6287', DAY, null)
    clock = oct(10, 8, 30); m.unitDone(run('0100').id, null)
    const t = m.deptToday(st(), 'Spiral', DAY, clock)
    eq('la tarjeta de Spiral cuenta las mezclas de siempre, y las libras aparte', [t.qty, t.units, t.bins], [1, 1, [{ word: 'lb', units: 2, qty: 2950 }]])
    const rep = m.reportOf(st(), DAY, clock, { only: 'Spiral' })
    eq('en el reporte igual: 1 mezcla, y aparte 2 mezclas con 2,950 lb', [rep.byDept.map((d) => [d.units, d.bins]), rep.byCode.map((c) => [c.code, c.bin, c.units, c.qty])], [[[1, [{ word: 'lb', units: 2, qty: 2950 }]]], [['0100', '', 1, 0], ['CHICKEN HERB', 'lb', 2, 2950]]])
    eq('Avance no toma las libras como mezclas de un producto', m.avanceRows(st(), DAY).filter((r) => r.code === 'CHICKEN HERB').length, 0)
    // what travels, and what the office's file says
    const sent = m.outbox.items().filter((i) => i.table === 'act_runs').map((i) => i.row).find((x) => x.code === 'CHICKEN HERB')
    eq('la corrida sube con su medida', sent.extra, { measure: 'lb' })
    eq('el CSV de productos lee "Spiral cuenta en"', m.parseProductsCsv('Código,Producto,Spiral cuenta en\nCHICKEN HERB,,libras\n0200,Veggies,CS\n0300,Otro,\n').map((p) => [p.code, p.spiralUnit ?? '']), [['CHICKEN HERB', 'lb'], ['0200', 'cajas'], ['0300', '']])
    eq('y lo que la app exporta se vuelve a leer igual', m.parseProductsCsv(m.productsCsv(st().products)).find((p) => p.code === 'CHICKEN HERB').spiralUnit, 'lb')
    eq('lo que llega en extra se limpia', [m.cleanExtra({ measure: 'lb' }), m.cleanExtra({ measure: 'kg' })], [{ measure: 'lb' }, undefined])
  })
}
section('MFO: cada bin guarda lo que escriben, en platos, copas o libras; nada se pasa a cajas')
{
  // Jose, 2026-10-17: "en MFO no va nada de 20 por cajas, es solo poner la cantidad que le toca poner, o sea la que
  // hicieron por bin, libras, etc., y sí poner platos en Avance o libras si ese producto es libra"
  const mf = await device('mfo', { user: 'Luis', usual: true })
  mf.use((m) => {
    const st = () => m.store.get(), run = (code) => st().runs.find((r) => r.code === code && !r.endedAt) ?? st().runs.find((r) => r.code === code)
    const lineOf = (name) => { m.addLine('MFO', name); return st().lines.find((l) => l.dept === 'MFO' && l.name === name) }
    clock = oct(10, 6, 0)
    const l1 = lineOf('Línea 1'), l2 = lineOf('Línea 2'), l3 = lineOf('Línea 3')
    m.setPlan(DAY, 'MFO', 'M100', 100) // the office programs 100 platos
    m.startRun(l1, 'M100', '6287', DAY, null, 'platos')
    const a = run('M100'), ca = m.cfgOf(a)
    eq('una corrida de bins de platos: sus palabras, y es lo que cuenta el cuarto', [m.binOf(a), m.apartOf(a), m.kindOf(a), ca.unit, ca.qtyUnit, ca.qtyQ, m.CFG.MFO.qtyUnit], ['platos', '', 'platos', 'Bin', 'platos', '¿Cuántos platos lleva este bin?', 'platos'])
    clock = oct(10, 7, 0); m.unitDone(a.id, 30, '1')
    clock = oct(10, 8, 0); m.unitDone(a.id, 57, '2')
    eq('cada bin guarda lo que escribieron, y lo hecho se dice en bins y platos', [run('M100').units.map((u) => u.qty), m.madeText(run('M100'), m.runQty(st(), run('M100')))], [[30, 57], '2 bins · 87 platos'])
    eq('el programa descuenta en platos, tal cual', (({ done, left, unit, other }) => [done, left, unit, other])(m.planRows(st(), DAY, 'MFO').find((r) => r.code === 'M100')), [87, 13, 'platos', []])
    clock = oct(10, 8, 10); m.startRun(l2, 'M200', '6287', DAY, null, 'copas')
    const b = run('M200')
    eq('las copas preguntan por copas', [m.cfgOf(b).qtyQ, m.cfgOf(b).qtyUnit, m.apartOf(b)], ['¿Cuántas copas lleva este bin?', 'copas', 'copas'])
    clock = oct(10, 8, 30); m.unitDone(b.id, 37, '1')
    clock = oct(10, 8, 40); m.startRun(l3, 'M300', '6287', DAY, null, 'lb')
    const c = run('M300'), cc = m.cfgOf(c)
    eq('una corrida en libras: sus palabras', [m.binOf(c), m.apartOf(c), cc.unit, cc.qtyUnit, cc.qtyQ], ['lb', 'lb', 'Bin', 'lb', '¿Cuántas libras lleva este bin?'])
    clock = oct(10, 9, 0); m.unitDone(c.id, 120.5, '1')
    eq('lo hecho en libras, con su decimal', m.madeText(run('M300'), m.runQty(st(), run('M300'))), '1 bin · 120.5 lb')
    // an MFO run from before 2026-10-17 (no word) counted cases, and stays so
    m.applyRemote('act_runs', { id: 'old', dept: 'MFO', line_id: l1.id, line: 'Línea 1', code: 'M100', lot: '6286', date: DAY, started_at: new Date(oct(10, 5, 0)).toISOString(), ended_at: new Date(oct(10, 5, 50)).toISOString(), units: [{ at: oct(10, 5, 40), qty: 3, ref: '9', by: 'Ana' }], per_unit: null, waste: 0, by_name: 'Ana', deleted: false, updated_at: new Date(oct(10, 5, 50)).toISOString() })
    const old = st().runs.find((r) => r.id === 'old')
    eq('una corrida de MFO de antes sigue en cajas, como estaba', [m.binOf(old), m.apartOf(old), m.cfgOf(old).qtyUnit, m.cfgOf(old).qtyQ, m.madeText(old, m.runQty(st(), old))], ['', 'cajas', 'cajas', '¿Cuántas cajas lleva este bin?', '1 bin · 3 cajas'])
    const t = m.deptToday(st(), 'MFO', DAY, clock)
    eq('la tarjeta del cuarto: los platos, y aparte las copas, las libras y las cajas de antes', [t.qty, t.units, t.unitLabel, t.bins], [87, 2, 'platos', [{ word: 'copas', units: 1, qty: 37 }, { word: 'lb', units: 1, qty: 120.5 }, { word: 'cajas', units: 1, qty: 3 }]])
    eq('el programa: cada código en lo suyo; M100 dice también sus cajas de antes', m.planRows(st(), DAY, 'MFO').map((r) => [r.code, r.planned, r.done, r.unit, r.other]), [['M100', 100, 87, 'platos', [{ word: 'cajas', n: 3 }]], ['M200', 0, 37, 'copas', []], ['M300', 0, 120.5, 'lb', []]])
    const rep = m.reportOf(st(), DAY, clock, { only: 'MFO' })
    eq('el reporte: el cuarto en platos, cada código con su palabra, lo demás aparte', [rep.byDept.map((d) => [d.units, d.qty, d.bins]), rep.byCode.map((x) => [x.code, x.bin, x.units, x.qty])], [[[2, 87, [{ word: 'cajas', units: 1, qty: 3 }, { word: 'copas', units: 1, qty: 37 }, { word: 'lb', units: 1, qty: 120.5 }]]], [['M100', 'cajas', 1, 3], ['M100', 'platos', 2, 87], ['M200', 'copas', 1, 37], ['M300', 'lb', 1, 120.5]]])
    eq('Avance: MFO en lo que escribieron, platos primero, y nada esperado en cajas', m.avanceRows(st(), DAY).filter((r) => ['M100', 'M200', 'M300'].includes(r.code)).map((r) => [r.code, r.mfo, r.mfoExp]), [['M100', [{ word: 'platos', qty: 87 }, { word: 'cajas', qty: 3 }], null], ['M200', [{ word: 'copas', qty: 37 }], null], ['M300', [{ word: 'lb', qty: 120.5 }], null]])
    eq('y en texto, como lo dice la pantalla', [m.mfoText([{ word: 'platos', qty: 87 }, { word: 'lb', qty: 120.5 }]), m.mfoText({ copas: 37 })], ['87 platos · 120.5 lb', '37 copas'])
    eq('la corrida sube con su palabra', m.outbox.items().filter((i) => i.table === 'act_runs').map((i) => i.row).find((x) => x.code === 'M300').extra, { bin: 'lb' })
    eq('los bins de MFO no van en la lista de bins de Packing', rep.bins.length, 0)
  })
}
section('Flujo de datos: las fórmulas de la hoja WO PENDIENTES, con sus propios números (2026-10-18)')
calc.use((m) => {
  // Jose, 2026-10-18 evening, with the office clerk's "WO PENDIENTES" sheet: "otra tab que se llame Flujo de Datos, que
  // va calculando qué le toca a cada departamento según el yield y lo que esos departamentos ya tienen". Every row
  // below is a row of that sheet, with the numbers its own cells show; the last ones are cases the sheet has no row for
  const calcOf = (route, yieldCs, perCase, perPallet, mixes, pouches, mfoUnits, mfoCases, mfoLb, cases, inTable = true, casesOnPo = 0, palletsOnPo = 0) => m.flujoCalc({ route, inTable, yieldCs, perCase, perPallet, mixes, pouches, mfoUnits, mfoCases, mfoLb, cases, pallets: cases ? 1 : 0, casesOnPo, palletsOnPo })
  const out = (c) => [c.segun, c.diffRte, c.diffMfo, c.diffPacking, c.projected, c.projectedFrom, c.diffProjected, c.state]
  const row = (what, args, want) => eq(what, out(calcOf(...args)), want)
  row('2286 · LOTE 6222: 3487 ÷ 8 = 435.88, 442 × 8 − 3487 = 49, 442 − 435.875 = 6.13, 80 × 5.5 = 440', ['RTE', 5.5, 8, 36, 80, 3487, 0, 0, 0, 442], [435.88, 49, null, 6.13, 440, 'mixes', 2, 'over'])
  eq('… y sus pallets proyectados: 440 ÷ 36', calcOf('RTE', 5.5, 8, 36, 80, 3487, 0, 0, 0, 442).palletsProjected, 12.22)
  row('2234 · LOTE 6218: nada empacado todavía', ['RTE', 6.5, 6, null, 35, 1376, 0, 0, 0, 0], [229.33, -1376, null, -229.33, 227.5, 'mixes', -227.5, 'unpacked'])
  row('4924 · LOTE 6218', ['RTE', 72.9, 6, null, 6, 1687, 0, 0, 0, 30], [281.17, -1507, null, -251.17, 437.4, 'mixes', -407.4, 'short'])
  row('3293 · LOTE 6218', ['RTE', 10, 6, null, 14, 1274, 0, 0, 0, 22], [212.33, -1142, null, -190.33, 140, 'mixes', -118, 'short'])
  row('4614 · LOTE 6222', ['RTE', 47, 6, null, 8, 2068, 0, 0, 0, 0], [344.67, -2068, null, -344.67, 376, 'mixes', -376, 'unpacked'])
  row('4139 · LOTE 6222: cuadra', ['RTE', 17, 6, null, 20, 2076, 0, 0, 0, 346], [346, 0, null, 0, 340, 'mixes', 6, 'ok'])
  row('8137 · LOTE 6222', ['RTE', 16.5, 6, null, 40, 3895, 0, 0, 0, 674], [649.17, 149, null, 24.83, 660, 'mixes', 14, 'over'])
  row('8165 · LOTE 6222', ['RTE', 16.5, 6, null, 10, 1020, 0, 0, 0, 168], [170, -12, null, -2, 165, 'mixes', 3, 'short'])
  row('2234 · LOTE 6222', ['RTE', 6.5, 6, null, 26, 927, 0, 0, 0, 153], [154.5, -9, null, -1.5, 169, 'mixes', -16, 'short'])
  row('4917 · LOTE 6222', ['RTE', 74.3, 6, null, 10, 4288, 0, 0, 0, 22], [714.67, -4156, null, -692.67, 743, 'mixes', -721, 'short'])
  row('5017 · LOTE 6222', ['RTE', 63, 6, null, 1, 380, 0, 0, 0, 56], [63.33, -44, null, -7.33, 63, 'mixes', -7, 'short'])
  const mfo = calcOf('MFO', null, 6, 40, 0, 0, 1506, 0, 0, 242)
  eq('4419 · LOTE 6222 (lo empaca MFO): 1506 ÷ 6 = 251, 242 × 6 − 1506 = −54, 242 − 251 = −9; RTE en blanco; sin yield en la tabla y no hace falta', [out(mfo), mfo.palletsProjected, mfo.missing], [[251, null, -54, -9, 251, 'mfo', -9, 'short'], 6.28, []])
  row('2286 · LOTE 6223', ['RTE', 5.5, 8, null, 50, 2163, 0, 0, 0, 277], [270.38, 53, null, 6.63, 275, 'mixes', 2, 'over'])
  row('0889 · LOTE 6223', ['RTE', 18.5, 8, null, 120, 17026, 0, 0, 0, 2027], [2128.25, -810, null, -101.25, 2220, 'mixes', -193, 'short'])
  row('4955 · LOTE 6223: cuadra, con la proyección por encima', ['RTE', 85.6, 6, null, 8, 3456, 0, 0, 0, 576], [576, 0, null, 0, 684.8, 'mixes', -108.8, 'ok'])
  row('4419 · LOTE 6223 (MFO): −0.83 es más de media caja', ['MFO', null, 6, null, 0, 0, 251, 0, 0, 41], [41.83, null, -5, -0.83, 41.83, 'mfo', -0.83, 'short'])
  row('2286 · LOTE 6224: todo cuadra', ['RTE', 5.5, 8, null, 80, 3520, 0, 0, 0, 440], [440, 0, null, 0, 440, 'mixes', 0, 'ok'])
  row('7130 · LOTE 6224 (la hoja escribe 20 por caja y calcula con 10: se sigue el cálculo)', ['RTE', 18, 10, null, 20, 3481, 0, 0, 0, 347], [348.1, -11, null, -1.1, 360, 'mixes', -13, 'short'])
  row('0889 · LOTE 6224', ['RTE', 18.5, 8, null, 50, 6978, 0, 0, 0, 904], [872.25, 254, null, 31.75, 925, 'mixes', -21, 'over'])
  row('2234 · LOTE 6224', ['RTE', 6.5, 6, null, 52, 1377, 0, 0, 0, 231], [229.5, 9, null, 1.5, 338, 'mixes', -107, 'over'])
  row('4918 · LOTE 6224', ['RTE', 74.3, 6, null, 2, 868, 0, 0, 0, 0], [144.67, -868, null, -144.67, 148.6, 'mixes', -148.6, 'unpacked'])
  row('4433 · LOTE 6224 (MFO): se prefiere 1658 ÷ 6 = 276.33 a 3 × 129 = 387, como hizo la oficina', ['MFO', 129, 6, 50, 3, 0, 1658, 0, 0, 273], [276.33, null, -20, -3.33, 276.33, 'mfo', -3.33, 'short'])
  // what the sheet has no row for
  const none = calcOf('MFO', 129, 6, 40, 3, 0, 0, 0, 0, 0)
  eq('MFO sin registrar nada todavía: proyectado por mezclas × yield, y dos ceros no se comparan', [out(none), none.palletsProjected], [[0, null, null, null, 387, 'mixes', -387, 'unpacked'], 9.68])
  row('MFO sin registrar nada y Packing ya empacó: cajas de más (así lo lee la hoja)', ['MFO', 129, 6, 40, 3, 0, 0, 0, 0, 100], [0, null, null, 100, 387, 'mixes', -287, 'over'])
  const lb = calcOf('MFO', 20, 6, 40, 2, 0, 0, 0, 240, 30)
  eq('MFO solo en libras: nada se pasa a cajas, sin comparar; la proyección sigue por mezclas', [out(lb), lb.mfoOnlyLb, lb.missing], [[null, null, null, null, 40, 'mixes', -10, 'nocompare'], true, []])
  // (review of 2026-10-18: it came out −30, the gap in units, under the word "cajas"; the gap is 5 cajas)
  row('bins de MFO de antes (contaban cajas): la diferencia en cajas, no en unidades', ['MFO', 25, 6, null, 2, 0, 0, 30, 0, 25], [30, null, -5, -5, 30, 'mfo', -5, 'short'])
  eq('… y así se dice', m.diffText('room', calcOf('MFO', 25, 6, null, 2, 0, 0, 30, 0, 25).diffMfo, m.mfoWord('cajas')).text, 'sobran 5 cajas')
  row('bins de antes sin pouches por caja en Productos: igual se comparan, ya son cajas', ['MFO', 25, null, null, 2, 0, 0, 30, 0, 25], [30, null, -5, -5, 30, 'mfo', -5, 'short'])
  row('bins de antes y de ahora juntos', ['MFO', 25, 6, null, 2, 0, 60, 10, 0, 20], [20, null, 0, 0, 20, 'mfo', 0, 'ok'])
  const noY = calcOf('RTE', null, 8, 36, 10, 800, 0, 0, 0, 100)
  eq('sin yield en Productos: nada proyectado (nunca 0), y la fila dice qué falta', [out(noY), noY.missing], [[100, 0, null, 0, null, null, null, 'ok'], ['yield']])
  const noK = calcOf('RTE', 5, null, 36, 10, 800, 0, 0, 0, 40)
  eq('sin pouches por caja: nada en cajas según RTE, sin comparar', [out(noK), noK.missing], [[null, null, null, null, 50, 'mixes', -10, 'nocompare'], ['perCase']])
  const noP = calcOf('RTE', null, null, null, 0, 100, 0, 0, 0, 0, false)
  eq('un código que no está en Productos', [out(noP), noP.missing], [[null, null, null, null, null, null, null, 'unpacked'], ['product']])
  row('solo Packing registró: cajas que RTE nunca reportó, de más', ['RTE', 5, 8, null, 0, 0, 0, 0, 0, 20], [0, 160, null, 20, null, null, null, 'over'])
  const nothing = calcOf('RTE', 5, 8, null, 0, 0, 0, 0, 0, 0)
  eq('nada registrado', [out(nothing), nothing.hasAny], [[0, null, null, null, null, null, null, 'none'], false])
  eq('cuadra hasta media caja, en los dos sentidos', [-0.5, -0.51, 0.5, 0.51].map((d) => m.flujoState({ cases: 10, hasAny: true }, d)), ['ok', 'short', 'ok', 'over'])
  eq('los números como se muestran', [m.n2(435.875), m.n2(440), m.n2(2128.25), m.n2(227.5), m.n2(-1376), m.n2(null), m.n2(0)], ['435.88', '440', '2,128.25', '227.5', '-1,376', '—', '0'])
  eq('redondeo: nunca −0, y el medio hacia afuera por los dos lados', [Object.is(m.r2(-0.004), 0), m.r2(2.675), m.r2(-2.675), m.r2(6.125), m.r2(251 / 40)], [true, 2.68, -2.68, 6.13, 6.28])
  eq('las diferencias en palabras, con los signos de la hoja', [m.diffText('cases', -0.33, 'cs').text, m.diffText('cases', -9, 'cs').text, m.diffText('cases', 6.13, 'cs').text, m.diffText('room', -1376, 'pouches').text, m.diffText('room', 49, 'pouches').text, m.diffText('room', -54, 'platos').text, m.diffText('room', null, 'platos').text], ['✓ cuadra', 'faltan 9 cs', '6.13 cs de más', 'sobran 1,376 pouches', 'faltan 49 pouches', 'sobran 54 platos', '—'])
  eq('el estado en palabras', [m.flujoStateText('short', -9), m.flujoStateText('over', 6.13), m.flujoStateText('ok', 0), m.flujoStateText('unpacked', null), m.flujoStateText('nocompare', null), m.flujoStateText('none', null)], ['Faltan 9 cs', '6.13 cs de más', '✓ Cuadra', 'Sin empacar', 'Sin comparar', 'Sin registros'])
  eq('el nombre del archivo', [m.flujoFile('2026-10-05', '2026-10-18', { lot: '6222', route: 'MFO', state: 'short' }), m.flujoFile('2026-10-18', '2026-10-05', { lot: '', route: '', state: '' })], ['actividad-flujo-2026-10-05-a-2026-10-18-lote-6222-mfo-faltan', 'actividad-flujo-2026-10-05-a-2026-10-18'])
  // ---- CONSUMO (Jose, 2026-10-19 ~03:00: "eso hay que reportarlo para que sepan qué hay y qué no hay en el inventario,
  // para saber qué y cuánto ordenar"): what the lot used up and what is left, from the same numbers. Jose's choice:
  // what is left in inventory = made and not yet put in cases, and cases packed on pallets without a PO ----
  const cons = (c) => [c.mixesUsed, c.mixesLeft, c.madeOver, c.unitsMade, c.unitsUsed, c.unitsLeft, c.packedOver, c.casesFree]
  eq('2286 / 6222 con 2 pallets (72 cs) en un PO: 3487 ÷ (5.5 × 8) = 79.25 mezclas usadas, quedan 0.75; 442 × 8 = 3,536 > 3,487 pouches: quedan 0 y Packing empacó de más; 72 en pedidos, 370 sin pedido', cons(calcOf('RTE', 5.5, 8, 36, 80, 3487, 0, 0, 0, 442, true, 72, 2)), [79.25, 0.75, false, 3487, 3536, 0, true, 370])
  eq('4433 / 6224 en platos, 150 cs en pedidos: 1658 ÷ (129 × 6) = 2.14 mezclas usadas, quedan 0.86; 273 × 6 = 1,638 platos usados, quedan 20; 123 cajas sin pedido', cons(calcOf('MFO', 129, 6, 50, 3, 0, 1658, 0, 0, 273, true, 150, 3)), [2.14, 0.86, false, 1658, 1638, 20, false, 123])
  eq('MFO solo en libras: nada en mezclas ni en unidades (nunca 0); las cajas sí', cons(calcOf('MFO', 20, 6, 40, 2, 0, 0, 0, 240, 30)), [null, null, false, null, null, null, false, 30])
  eq('sin yield en Productos: nada en mezclas; los pouches igual se calculan', cons(calcOf('RTE', null, 8, 36, 10, 800, 0, 0, 0, 100)), [null, null, false, 800, 800, 0, false, 100])
  eq('sin pouches por caja: ni mezclas usadas ni pouches usados; los hechos sí', cons(calcOf('RTE', 5, null, 36, 10, 800, 0, 0, 0, 40)), [null, null, false, 800, null, null, false, 40])
  eq('RTE hizo más de lo que dan las mezclas (500 ÷ 40 = 12.5 > 10): quedan 0 y se dice; nada empacado: quedan los 500 pouches', cons(calcOf('RTE', 5, 8, null, 10, 500, 0, 0, 0, 0)), [12.5, 0, true, 500, 0, 500, false, 0])
  eq('MFO sin registrar nada y Packing ya empacó: 0 mezclas usadas (quedan las 3), sin unidades que contar, 100 cajas sin pedido', cons(calcOf('MFO', 129, 6, 40, 3, 0, 0, 0, 0, 100)), [0, 3, false, null, null, null, false, 100])
  eq('bins de antes solos: las mezclas por Según MFO ÷ yield (30 ÷ 25 = 1.2); sin unidades (ya eran cajas)', cons(calcOf('MFO', 25, 6, null, 2, 0, 0, 30, 0, 25)), [1.2, 0.8, false, null, null, null, false, 25])
  eq('bins de antes y de ahora: los usados en unidades son las cajas aparte de los bins de antes ((20 − 10) × 6 = 60)', cons(calcOf('MFO', 25, 6, null, 2, 0, 60, 10, 0, 20)), [0.8, 1.2, false, 60, 60, 0, false, 20])
  eq('nada registrado: ceros, nunca de más', cons(calcOf('RTE', 5, 8, null, 0, 0, 0, 0, 0, 0)), [0, 0, false, 0, 0, 0, false, 0])
  eq('el nombre del archivo con el chip "Con inventario"', m.flujoFile('2026-10-05', '2026-10-18', { lot: '', route: 'RTE', state: '', inv: true }), 'actividad-flujo-2026-10-05-a-2026-10-18-rte-inventario')
  // the tile "En inventario · por empacar": the big number is the first word with something left, never "0 pouches" over
  // "54 platos" in the small print (review of 2026-10-19, with the MFO chip on)
  const L = (word, qty, rows) => ({ word, qty, rows })
  eq('la tile: el primer renglón con algo va en grande y los demás en chico; pouches en 0 solo cuando no queda nada', [
    m.flujoLeftMain([L('pouches', 0, 0), L('platos', 54, 1)]), m.flujoLeftMain([L('pouches', 0, 0), L('platos', 325, 3), L('copas', 60, 1)]),
    m.flujoLeftMain([L('pouches', 120, 2), L('platos', 54, 1), L('copas', 0, 0)]), m.flujoLeftMain([L('pouches', 0, 0)]), m.flujoLeftMain([]),
  ], [
    { main: L('platos', 54, 1), rest: [] }, { main: L('platos', 325, 3), rest: [L('copas', 60, 1)] },
    { main: L('pouches', 120, 2), rest: [L('platos', 54, 1)] }, { main: L('pouches', 0, 0), rest: [] }, { main: L('pouches', 0, 0), rest: [] },
  ])
})
section('Flujo de datos: cada lote en todos sus días, con lo que registró cada cuarto')
{
  // the same numbers of the sheet, now made on a device the way the floor makes them: each room on its line, the lot
  // running into the next day, a pallet with two lots, bins and pounds that are not cases, a code written with and
  // without its zero, a code without yield and one that is not in the table
  const fl = await device('flujo', { user: 'Oficina', usual: true })
  const got = fl.use((m) => {
    const st = () => m.store.get()
    m.role.set('office')
    m.mergeProducts([
      { code: '2286', name: 'Pollo con arroz', pouchesPerCase: 8, casesPerMix: 5.5, cratesPerCart: 24, pouchesPerCrate: 10, casesPerPallet: 50, room: 'RTE', updatedAt: 0 },
      { code: '4419', name: 'Platos de carne', pouchesPerCase: 6, casesPerMix: 0, cratesPerCart: 0, pouchesPerCrate: 0, casesPerPallet: 40, room: 'MFO', updatedAt: 0 },
      { code: '4433', name: 'Copas de res', pouchesPerCase: 6, casesPerMix: 129, cratesPerCart: 0, pouchesPerCrate: 0, casesPerPallet: 50, room: 'MFO', updatedAt: 0 },
      { code: 'E9', name: 'Sin yield', pouchesPerCase: 8, casesPerMix: 0, cratesPerCart: 24, pouchesPerCrate: 10, casesPerPallet: 0, updatedAt: 0 },
    ])
    for (const [d, n] of [['Kitchen', 'Braiser 1'], ['RTE', 'Línea 1'], ['Packing', 'Línea 1'], ['Packing', 'Línea 2'], ['Packing', 'Línea 3'], ['MFO', 'Línea 1'], ['Spiral', 'Línea 1']]) m.addLine(d, n)
    const line = (d, n) => st().lines.find((l) => l.dept === d && l.name === n)
    const kitchen = line('Kitchen', 'Braiser 1'), rte = line('RTE', 'Línea 1'), p1 = line('Packing', 'Línea 1'), p2 = line('Packing', 'Línea 2'), p3 = line('Packing', 'Línea 3'), mfo = line('MFO', 'Línea 1'), spiral = line('Spiral', 'Línea 1')
    const D8 = '2026-10-08', D9 = '2026-10-09'
    clock = oct(8, 5, 0)
    const tick = () => { clock += M }
    const openOn = (l) => st().runs.find((r) => r.lineId === l.id && !r.endedAt)
    /** a run on a line with its units ([qty, ref] or a pallet), ended unless `open`; gives its id */
    const run = (l, code, lot, date, per, units, { bin = '', measure = '', open = false } = {}) => {
      tick(); m.startRun(l, code, lot, date, per, bin, measure)
      const id = openOn(l).id
      for (const u of units) { tick(); if (typeof u === 'function') u(id); else m.unitDone(id, u[0], u[1] ?? '') }
      if (!open) { tick(); m.endRun(id, false) }
      return id
    }
    const pallet = (lots, po = '') => (id) => m.palletDone(id, lots, po)
    const many = (n, u) => Array.from({ length: n }, () => u)
    // Kitchen: 60 mezclas of 2286 / 6222 on the 8th and 20 more on the 9th (the lot ran into the next day)
    run(kitchen, '2286', '6222', D8, null, many(60, [null]))
    run(kitchen, '2286', '6222', D9, null, many(20, [null]))
    // RTE: 14 carts of 240 and one of 127 = 3,487 pouches
    run(rte, '2286', '6222', D8, 240, [...many(14, [240]), [127]])
    // Packing: 8 pallets of 50, one of 12, and one with two lots (30 of 6222 + 20 of 6223) = 442 cases of 6222 on 10 pallets
    run(p1, '2286', '6222', D8, 50, [...many(8, pallet([{ lot: '6222', qty: 50, tag: '1' }])), pallet([{ lot: '6222', qty: 12, tag: '9' }]), pallet([{ lot: '6222', qty: 30, tag: '10' }, { lot: '6223', qty: 20, tag: '11' }])])
    // a Packing line filling bins of platos, and Spiral weighing the code in pounds: neither is cases nor mezclas
    run(p2, '2286', '6222', D8, null, [[100, '1']], { bin: 'platos' })
    run(spiral, '2286', '6222', D8, null, many(3, [500]), { measure: 'lb' })
    // Packing still running on the 9th, with a pallet being built (a lot ran out on it): nothing of it counts yet
    const p3id = run(p3, '2286', '6222', D9, 50, [], { open: true })
    tick(); m.palletLotEnds(p3id, 25, '1', '6223')
    // MFO 4419 / 6222: 1,506 platos in three bins; Packing two pallets of 121; and RTE registered 50 pouches of it by mistake
    run(mfo, '4419', '6222', D8, null, [[500, '1'], [500, '2'], [506, '3']], { bin: 'platos' })
    run(p1, '4419', '6222', D8, 121, many(2, pallet([{ lot: '6222', qty: 121, tag: '2' }])))
    run(rte, '4419', '6222', D8, 50, [[50]])
    // 4419 / 6223 (the 9th): 251 platos, 41 cases
    run(mfo, '4419', '6223', D9, null, [[251, '4']], { bin: 'platos' })
    const p4419 = run(p1, '4419', '6223', D9, 41, [pallet([{ lot: '6223', qty: 41, tag: '3' }])])
    // 4433 / 6224: 3 mezclas, 1,658 platos, 273 cases
    run(kitchen, '4433', '6224', D9, null, many(3, [null]))
    run(mfo, '4433', '6224', D9, null, [[500, '5'], [500, '6'], [658, '7']], { bin: 'platos' })
    run(p1, '4433', '6224', D9, 50, [...many(5, pallet([{ lot: '6224', qty: 50, tag: '4' }])), pallet([{ lot: '6224', qty: 23, tag: '5' }])])
    // 4433 / 6225: MFO weighed it in pounds; 2 mezclas; 30 cases
    run(mfo, '4433', '6225', D9, null, [[240, '8']], { bin: 'lb' })
    run(kitchen, '4433', '6225', D9, null, many(2, [null]))
    run(p1, '4433', '6225', D9, 30, [pallet([{ lot: '6225', qty: 30, tag: '6' }])])
    // 4419 / 6226: an MFO run of before 2026-10-17 (no word: its bins counted cases), and 25 cases
    m.applyRemote('act_runs', runRow({ id: 'old-mfo', dept: 'MFO', lineId: mfo.id, code: '4419', lot: '6226', date: D9, startedAt: oct(9, 5, 0), endedAt: oct(9, 6, 0), units: [unit(oct(9, 5, 30), 30, '9')] }))
    run(p1, '4419', '6226', D9, 25, [pallet([{ lot: '6226', qty: 25, tag: '7' }])])
    // 4419 / 6228 and 6229: MFO registered the code under two words in one lot (platos on one bin, copas on another):
    // the word with the most of it counts, the other is shown apart and never added (review of 2026-10-18)
    run(mfo, '4419', '6228', D9, null, [[600, '10']], { bin: 'platos' })
    run(mfo, '4419', '6228', D9, null, [[60, '11']], { bin: 'copas' })
    run(p1, '4419', '6228', D9, 100, [pallet([{ lot: '6228', qty: 100, tag: '12' }])])
    run(mfo, '4419', '6229', D9, null, [[60, '13']], { bin: 'platos' })
    run(mfo, '4419', '6229', D9, null, [[600, '14']], { bin: 'copas' })
    run(p1, '4419', '6229', D9, 90, [pallet([{ lot: '6229', qty: 90, tag: '15' }])])
    // lot 6227: a code written with and without its zero is one row; a code without yield; a code not in the table
    run(kitchen, '100', '6227', D9, null, many(2, [null]))
    run(rte, '0100', '6227', D9, 240, [[240]])
    run(kitchen, 'E9', '6227', D9, null, many(10, [null]))
    run(rte, 'E9', '6227', D9, 200, many(4, [200]))
    run(p1, 'E9', '6227', D9, 50, many(2, pallet([{ lot: '6227', qty: 50, tag: '8' }])))
    run(rte, 'ZZ', '6227', D9, 100, [[100]])
    const lots = m.flujoLots(st(), D8, D9)
    const row = (lot, code) => lots.find((l) => l.lot === lot).rows.find((r) => m.normCode(r.code) === m.normCode(code))
    eq('los lotes de esos dos días, el más nuevo primero, cada uno con todos sus días', lots.map((l) => [l.lot, l.days]), [['6229', [D9]], ['6228', [D9]], ['6227', [D9]], ['6226', [D9]], ['6225', [D9]], ['6224', [D9]], ['6223', [D8, D9]], ['6222', [D8, D9]]])
    const a = row('6222', '2286')
    eq('2286 / 6222: la fila de la hoja, con sus mismos números', [a.route, a.routeSaid, a.mixes, a.mixRoom, a.pouches, a.cases, a.pallets, a.yieldCs, a.perCase, a.segun, a.diffRte, a.diffMfo, a.diffPacking, a.projected, a.projectedFrom, a.diffProjected, a.palletsProjected, a.state, a.running, a.missing], ['RTE', true, 80, 'Kitchen', 3487, 442, 10, 5.5, 8, 435.88, 49, null, 6.13, 440, 'mixes', 2, 8.8, 'over', true, []])
    eq('… y lo que hizo cada día (el lote siguió al día siguiente)', a.days.map((d) => [d.date, d.mixes, d.pouches, d.cases]), [[D8, 60, 3487, 442], [D9, 20, 0, 0]])
    eq('los bins de Packing no entran; las libras de Spiral no son cajas ni mezclas, pero se dicen aparte (2026-10-19)', [a.otherMfo, a.mfo, a.mixes, a.mixRoom, a.spiralApart], [false, [], 80, 'Kitchen', [{ word: 'lb', qty: 1500 }]])
    // ---- the detail window's records (Jose, 2026-10-19): every run of the code touching the lot, what it made OF THIS lot ----
    const rec = m.flujoRecords(st(), '6222', '2286')
    eq('los registros del lote 6222 de 2286: cada corrida que lo toca, por cuarto y hora, con lo hecho de ese lote y sus lotes (este primero)', rec.runs.map((x) => [x.dept, x.date, x.line, x.units, x.qty, x.word, x.open, x.lots]), [
      ['Kitchen', D8, 'Braiser 1', 60, null, '', false, ['6222']], ['Kitchen', D9, 'Braiser 1', 20, null, '', false, ['6222']],
      ['RTE', D8, 'Línea 1', 15, 3487, 'pouches', false, ['6222']], ['Spiral', D8, 'Línea 1', 3, 1500, 'lb', false, ['6222']],
      ['Packing', D8, 'Línea 1', 10, 442, 'cajas', false, ['6222', '6223']], ['Packing', D8, 'Línea 2', 1, 100, 'platos', false, ['6222']], ['Packing', D9, 'Línea 3', 0, 0, 'cajas', true, ['6222', '6223']]])
    eq('sus pallets: los diez listos de la Línea 1 (el de dos lotes con sus 30 de este lote y 50 en total) y el que se arma en la Línea 3, al final; ninguno con PO', [rec.pallets.length, rec.pallets.slice(7).map((p) => [p.n, p.lotQty, p.lotTag, p.total, p.open, p.poLabel]), rec.pallets.map((p) => p.by).every(Boolean)], [11, [[8, 50, '1', 50, false, ''], [9, 12, '9', 12, false, ''], [10, 30, '10', 50, false, ''], [1, 25, '1', 25, true, '']], true])
    eq('otro código del mismo lote tiene los suyos; un lote que nadie tocó, ninguno', [m.flujoRecords(st(), '6222', '4419').runs.map((x) => [x.dept, x.units, x.qty, x.word]), m.flujoRecords(st(), '9999', '2286').runs.length], [[['RTE', 1, 50, 'pouches'], ['MFO', 3, 1506, 'platos'], ['Packing', 2, 242, 'cajas']], 0])
    const b = row('6223', '2286')
    eq('2286 / 6223: las 20 cajas del pallet de dos lotes, que RTE nunca reportó de ese lote: cajas de más', [b.cases, b.pallets, b.pouches, b.mixes, b.segun, b.diffRte, b.diffPacking, b.projected, b.state, b.running], [20, 0, 0, 0, 0, 160, 20, null, 'over', true])
    const c = row('6222', '4419')
    eq('4419 / 6222 (lo empaca MFO): platos ÷ 6, RTE en blanco y avisado aparte', [c.route, c.routeSaid, c.mfoUnits, c.mfo, c.mfoWordUsed, c.segun, c.diffRte, c.diffMfo, c.diffPacking, c.projected, c.projectedFrom, c.diffProjected, c.palletsProjected, c.state, c.otherRte, c.pouches, c.missing], ['MFO', true, 1506, [{ word: 'platos', qty: 1506 }], 'platos', 251, null, -54, -9, 251, 'mfo', -9, 6.28, 'short', true, 50, []])
    const d = row('6223', '4419'), e = row('6224', '4433'), f = row('6225', '4433'), g = row('6226', '4419')
    eq('4419 / 6223', [d.segun, d.diffMfo, d.diffPacking, d.state], [41.83, -5, -0.83, 'short'])
    eq('4433 / 6224: se prefiere lo de MFO (276.33) a 3 × 129', [e.mixes, e.segun, e.diffMfo, e.diffPacking, e.projected, e.projectedFrom, e.diffProjected, e.state], [3, 276.33, -20, -3.33, 276.33, 'mfo', -3.33, 'short'])
    eq('4433 / 6225: MFO solo en libras, sin comparar; proyectado por mezclas', [f.mfoLb, f.mfoOnlyLb, f.mfo, f.segun, f.diffMfo, f.diffPacking, f.projected, f.projectedFrom, f.state], [240, true, [{ word: 'lb', qty: 240 }], null, null, null, 258, 'mixes', 'nocompare'])
    eq('4419 / 6226: los bins de antes ya eran cajas, y la diferencia va en cajas', [g.mfoCases, g.mfoWordUsed, g.segun, g.diffMfo, g.diffPacking, g.state], [30, 'cajas', 30, -5, -5, 'short'])
    const h = row('6228', '4419'), i = row('6229', '4419')
    eq('4419 / 6228: 600 platos y 60 copas: cuentan los platos, las copas se muestran aparte', [h.mfoUnits, h.mfoWordUsed, h.mfo, h.segun, h.diffMfo, h.diffPacking, h.state, h.otherRte], [600, 'platos', [{ word: 'platos', qty: 600 }, { word: 'copas', qty: 60 }], 100, 0, 0, 'ok', false])
    eq('4419 / 6229: 60 platos y 600 copas: cuentan las copas', [i.mfoUnits, i.mfoWordUsed, i.segun, i.diffMfo, i.diffPacking, i.state], [600, 'copas', 100, -60, -10, 'short'])
    eq('100 y 0100 son una fila; sin yield se dice; un código que no está en Productos también', lots.find((l) => l.lot === '6227').rows.map((r) => [m.normCode(r.code), r.inTable, r.routeSaid, r.mixes, r.pouches, r.cases, r.segun, r.diffRte, r.diffPacking, r.projected, r.state, r.missing]), [['100', false, false, 2, 240, 0, null, null, null, null, 'unpacked', ['product']], ['E9', true, false, 10, 800, 100, 100, 0, 0, null, 'ok', ['yield']], ['ZZ', false, false, 0, 100, 0, null, null, null, null, 'unpacked', ['product']]])
    eq('los mismos números que Avance da para el lote', (({ mixesDone, pouchesDone, casesDone, palletsDone }) => [mixesDone, pouchesDone, casesDone, palletsDone])(m.lotRows(st(), '6222').find((r) => r.code === '2286')), [80, 3487, 442, 10])
    const s6222 = lots.find((l) => l.lot === '6222').sum
    eq('el total del lote: cajas, pallets, proyectado y estados', [s6222.codes, s6222.cases, s6222.pallets, s6222.projected, s6222.states, s6222.shortCs, s6222.overCs], [2, 684, 12, 691, { none: 0, unpacked: 0, nocompare: 0, short: 1, over: 1, ok: 0 }, 9, 6.13])
    eq('un lote es entero: mirando solo el 9, el 6222 trae también lo del 8', (({ mixes, days }) => [mixes, days.length])(m.flujoLots(st(), D9, D9).find((l) => l.lot === '6222').rows.find((r) => r.code === '2286')), [80, 2])
    eq('días sin nada, y un rango al revés', [m.flujoLots(st(), '2026-10-01', '2026-10-07'), m.flujoLots(st(), D9, D8).map((l) => l.lot)], [[], lots.map((l) => l.lot)])
    // a Kitchen run of the lot dated before the range: the lot keeps every day the device holds
    run(kitchen, '2286', '6222', '2026-10-07', null, many(5, [null]))
    const a2 = m.flujoLots(st(), D8, D9).find((l) => l.lot === '6222').rows.find((r) => r.code === '2286')
    eq('un día del lote fuera del rango cuenta igual: 85 mezclas en 3 días, y el lote sigue en la vista del 8 al 9', [a2.mixes, a2.days.length, a2.projected, a2.diffProjected], [85, 3, 467.5, -25.5])
    // the search and the chips; the files follow the chips and never the search
    const flt = (f, search) => m.flujoFilter(lots, { q: '', lot: '', route: '', state: '', ...f }, search)
    eq('buscar: código y lote juntos; el nombre del producto; un lote', [flt({ q: '2286 6222' }).map((l) => [l.lot, l.rows.map((r) => r.code)]), flt({ q: 'pollo' }).flatMap((l) => l.rows.map((r) => l.lot + '/' + r.code)), flt({ q: '6223' }).map((l) => l.lot)], [[['6222', ['2286']]], ['6223/2286', '6222/2286'], ['6223']])
    eq('un lote escogido; un cuarto; un estado; y los archivos no siguen la búsqueda', [flt({ lot: '6224' }).map((l) => l.lot), flt({ route: 'MFO' }).flatMap((l) => l.rows.map((r) => l.lot + '/' + r.code)), flt({ state: 'short' }).flatMap((l) => l.rows.map((r) => l.lot + '/' + r.code)), flt({ q: 'zzzz' }).length, flt({ q: 'zzzz' }, false).length], [['6224'], ['6229/4419', '6228/4419', '6226/4419', '6225/4433', '6224/4433', '6223/4419', '6222/4419'], ['6229/4419', '6226/4419', '6224/4433', '6223/4419', '6222/4419'], 0, lots.length])
    eq('con un cuarto escogido, el total del lote es de las filas que quedan', flt({ route: 'MFO' }).find((l) => l.lot === '6222').sum.cases, 242)
    // the Excel: the office's columns, flat, one row per lot × code
    const sheet = m.flujoSheet(lots)
    eq('la hoja de Excel: las columnas de la oficina, plana, el lote en cada fila, las de CONSUMO después, las de Spiral y las del programa al final', [sheet[0].length, sheet[0][2], sheet[0][15], sheet[0][25], sheet[0][33], sheet[0][35], sheet[0].at(-1), sheet.length], [38, 'COD', 'SEGÚN RTE (CS)', 'Falta en Productos', 'PALLETS EN PEDIDOS', 'SPIRAL EN', 'PROG. CUARTO', 1 + lots.reduce((t, l) => t + l.rows.length, 0)])
    eq('la fila 2286 / 6222', sheet.find((r) => r[0] === '6222' && r[2] === '2286'), ['6222', D8 + ', ' + D9, '2286', 'Pollo con arroz', 'RTE', 5.5, 8, 80, 'Kitchen', 3487, 49, '', '', '', '', 435.88, 442, 10, 6.13, 440, 'mezclas × yield', 2, 8.8, '6.13 cs de más', 'sí', '', 79.25, 0.75, 'pouches', 3536, 0, 0, 442, 0, 1500, 'lb', '', ''])
    eq('la fila 4419 / 6222: RTE en blanco (lo empaca MFO), MFO en platos', sheet.find((r) => r[0] === '6222' && r[2] === '4419').slice(9, 16), ['', '', 1506, 'platos', '', -54, 251])
    eq('la fila 4433 / 6225: las libras aparte, nunca en cajas, y MFO en blanco (no 0: sí registró)', sheet.find((r) => r[0] === '6225' && r[2] === '4433').slice(11, 16), ['', '', '240 lb', '', ''])
    eq('la fila 4419 / 6228: la palabra que cuenta y la otra aparte, sin sumarlas', sheet.find((r) => r[0] === '6228' && r[2] === '4419').slice(11, 16), [600, 'platos', '60 copas', 0, 100])
    eq('la fila 4419 / 6226: los bins de antes, en cajas', sheet.find((r) => r[0] === '6226' && r[2] === '4419').slice(11, 16), [30, 'cajas', '', -5, 30])
    eq('una fila sin yield lo dice en su columna', sheet.find((r) => r[0] === '6227' && r[2] === 'E9')[25], 'yield')
    eq('la leyenda', [m.flujoLegend('x')[0], m.flujoLegend('x').at(-1)], [['Columna', 'Qué es'], ['Generado', 'x']])
    const ex = (r, k) => m.flujoExplain(r).find((x) => x.key === k)?.text
    eq('cómo se calculó, en palabras con los números reales', [ex(a, 'segun'), ex(a, 'proj'), ex(a, 'diffRoom'), ex(a, 'diffPacking'), ex(a, 'pallets')], ['3,487 pouches ÷ 8 por caja = 435.88', '80 mezclas × 5.5 yield = 440', '442 cs × 8 − 3,487 pouches = 49 (faltan 49 pouches)', '442 − 435.88 = 6.13 (6.13 cs de más)', '10 hechos · proyectados 440 ÷ 50 por pallet = 8.8'])
    eq('y para un código de MFO', [ex(c, 'segun'), ex(c, 'diffRoom'), ex(c, 'proj'), ex(c, 'diffPacking')], ['1,506 platos ÷ 6 por caja = 251', '242 cs × 6 − 1,506 platos = -54 (sobran 54 platos)', 'lo que registró MFO, en cajas = 251 (se prefiere a mezclas × yield: —)', '242 − 251 = -9 (faltan 9 cs)'])
    // ---- the compact HECHO cell and the window's "La hoja" (2026-10-19) ----
    eq('HECHO: lo del cuarto que empaca, con su palabra; MFO con dos palabras dice la otra aparte; solo libras, en libras; sin nada, —', [m.flujoHecho(a), m.flujoHecho(c), m.flujoHecho(h), m.flujoHecho(f), m.flujoHecho(g), m.flujoHecho(b)], [{ qty: '3,487', word: 'pouches', also: '' }, { qty: '1,506', word: 'platos', also: '' }, { qty: '600', word: 'platos', also: 'y 60 copas' }, { qty: '240', word: 'lb', also: '' }, { qty: '30', word: 'cajas', also: '' }, { qty: '—', word: '', also: '' }])
    const sh = (r) => m.flujoSheetRow(r), vals = (r) => sh(r).map((x) => x.value)
    eq('la hoja de 2286 / 6222: las catorce celdas en el orden de la hoja', [sh(a).map((x) => x.key), vals(a)], [['yield', 'perCase', 'prod', 'rte', 'diffRte', 'mfo', 'diffMfo', 'segun', 'packing', 'diffPacking', 'projected', 'diffProjected', 'pallets', 'state'], ['5.5', '8', '80', '3,487', '49', '—', '—', '435.88', '442', '6.13', '440', '2', '10', '6.13 cs de más']])
    eq('… cada diferencia con su palabra y su color, y la línea de abajo: el signo, la cuenta, o por qué está en blanco', sh(a).filter((x) => ['diffRte', 'mfo', 'segun', 'diffPacking', 'pallets', 'prod'].includes(x.key)).map((x) => [x.word, x.cls, x.note]), [['mezclas Kitchen', '', 'Spiral aparte: 1,500 lb'], ['faltan pouches', 'fl-falta', 'cajas × pouches por caja − pouches: − sobran (hechos sin empacar), + faltan (Packing empacó más de lo que reportó RTE)'], ['', '', 'Lo empaca RTE: MFO no entra en la cuenta'], ['según RTE', '', '3,487 pouches ÷ 8 por caja = 435.88'], ['cs de más', 'fl-falta', 'cajas de Packing − según cuarto: − faltan cajas, + cajas de más; cuadra hasta media caja'], ['proyectados 8.8', '', '50 cajas por pallet']])
    eq('la hoja de 4419 / 6222 (MFO): RTE en blanco y avisado, MFO en platos, sobran 54 platos, faltan 9 cs', [vals(c), sh(c).find((x) => x.key === 'rte').note, sh(c).find((x) => x.key === 'diffMfo').word, sh(c).find((x) => x.key === 'diffMfo').cls, sh(c).find((x) => x.key === 'yield').note], [['—', '6', '—', '—', '—', '1,506', '54', '251', '242', '9', '251', '9', '2', 'Faltan 9 cs'], 'RTE registró 50 pouches de un código que empaca MFO', 'sobran platos', 'fl-sobra', 'en blanco en Productos'])
    eq('los bins de antes se explican en cajas; con dos palabras, solo la que cuenta', [ex(g, 'segun'), ex(g, 'diffRoom'), ex(h, 'segun'), ex(i, 'diffRoom')], ['30 cajas de antes, ya en cajas = 30', '25 cs − 30 cajas de antes = -5 (sobran 5 cajas)', '600 platos ÷ 6 por caja = 100', '90 cs × 6 − 600 copas = -60 (sobran 60 copas)'])
    eq('las mezclas por día, con las fechas como las escriba la pantalla', [ex(a, 'prod'), ex(e, 'prod'), m.flujoExplain(a, (d) => 'día ' + d.slice(-2)).find((x) => x.key === 'prod').text], ['80 registradas por Kitchen: 2026-10-08: 60 · 2026-10-09: 20', '3 registradas por Kitchen el 2026-10-09', '80 registradas por Kitchen: día 08: 60 · día 09: 20'])
    m.deleteRun(p4419)
    eq('borrada la corrida de Packing de 4419 / 6223: sus cajas se van de la fila', (({ cases, pallets, state }) => [cases, pallets, state])(m.flujoLots(st(), D8, D9).find((l) => l.lot === '6223').rows.find((r) => r.code === '4419')), [0, 0, 'unpacked'])
    // ---- CONSUMO (2026-10-19): a PO on two pallets of 2286, one of them with two lots: each lot gets its own cases in
    // the PO, and the pallet counts "en pedido" for both ----
    const po = m.saveOrder(null, { customer: 'Cliente', po: '4471', code: '2286', cases: 100, shipBy: '', dest: '' })
    run(p2, '2286', '6222', D9, 36, [pallet([{ lot: '6222', qty: 36, tag: '20' }], po), pallet([{ lot: '6222', qty: 36, tag: '21' }, { lot: '6223', qty: 20, tag: '22' }], po)])
    const after = m.flujoLots(st(), D8, D9), rowA = (lot, code) => after.find((l) => l.lot === lot).rows.find((r) => r.code === code)
    const x = rowA('6222', '2286'), y = rowA('6223', '2286'), z = rowA('6222', '4419')
    eq('2286 / 6222: 514 cajas, 72 en el PO en 2 pallets, 442 sin pedido; 85 mezclas − 79.25 usadas = 5.75; 514 × 8 = 4,112 > 3,487 pouches: quedan 0 y Packing empacó de más', [x.cases, x.pallets, x.casesOnPo, x.palletsOnPo, x.casesFree, x.mixes, x.mixesUsed, x.mixesLeft, x.unitWord, x.unitsMade, x.unitsUsed, x.unitsLeft, x.packedOver], [514, 12, 72, 2, 442, 85, 79.25, 5.75, 'pouches', 3487, 4112, 0, true])
    eq('2286 / 6223: sus 40 cajas van en dos pallets de dos lotes que cuentan como pallets del 6222 (más cajas): 20 en el PO, 20 sin pedido, 0 pallets propios', [y.cases, y.pallets, y.casesOnPo, y.palletsOnPo, y.casesFree], [40, 0, 20, 0, 20])
    eq('4419 / 6222 (MFO, en platos): 1,506 hechos, 242 × 6 = 1,452 usados, quedan 54 platos; sin PO, 242 sin pedido', [z.unitWord, z.unitsMade, z.unitsUsed, z.unitsLeft, z.casesOnPo, z.casesFree, z.mixesUsed], ['platos', 1506, 1452, 54, 0, 242, null])
    eq('los pallets con PO del lote dicen su pedido; el de dos lotes, solo sus cajas de este lote y el total del pallet', m.flujoRecords(st(), '6222', '2286').pallets.filter((p) => p.po).map((p) => [p.poLabel, p.lotQty, p.lotTag, p.total, p.of?.[0]]), [['Cliente · PO 4471', 36, '20', 36, 1], ['Cliente · PO 4471', 36, '21', 56, 2]])
    const sx = after.find((l) => l.lot === '6222').sum
    eq('el total del lote 6222: lo sin empacar palabra por palabra (pouches aparte de platos), cajas sin pedido y en pedidos', [sx.left, sx.casesFree, sx.freeRows, sx.casesOnPo, sx.palletsOnPo], [[{ word: 'pouches', qty: 0, rows: 0 }, { word: 'platos', qty: 54, rows: 1 }], 684, 2, 72, 2])
    const all = m.flujoSum(after.flatMap((l) => l.rows))
    eq('los totales de las tiles sobre todo lo que se ve: pouches, platos (20 + 251 + 54) y copas aparte; 1,322 cajas sin pedido en 9 códigos, 92 en pedidos en 2 pallets (el de dos lotes cuenta una vez)', [all.left, all.casesFree, all.freeRows, all.casesOnPo, all.palletsOnPo], [[{ word: 'pouches', qty: 0, rows: 0 }, { word: 'platos', qty: 325, rows: 3 }, { word: 'copas', qty: 60, rows: 1 }], 1322, 9, 92, 2])
    eq('el chip "Con inventario": fuera los códigos sin nada sin empacar ni cajas sin pedido', m.flujoFilter(after, { q: '', lot: '', route: '', state: '', inv: true }).flatMap((l) => l.rows.map((r) => l.lot + '/' + r.code)), ['6229/4419', '6228/4419', '6227/E9', '6226/4419', '6225/4433', '6224/4433', '6223/2286', '6223/4419', '6222/2286', '6222/4419'])
    const sheet2 = m.flujoSheet(after)
    eq('el Excel: las columnas de CONSUMO, y la fila 2286 / 6222 con su PO', [sheet2[0].slice(26, 34), sheet2.find((r) => r[0] === '6222' && r[2] === '2286').slice(26, 34)], [['CONSUMO: MEZCLAS USADAS', 'MEZCLAS QUE QUEDAN', 'UNIDAD', 'UNIDADES USADAS EN CAJAS', 'UNIDADES QUE QUEDAN', 'CAJAS EN PEDIDOS', 'CAJAS SIN PEDIDO', 'PALLETS EN PEDIDOS'], [79.25, 5.75, 'pouches', 4112, 0, 72, 442, 2]])
    eq('… la fila 4419 / 6222 en platos (sin yield: mezclas en blanco), y la de 4433 / 6225 (libras) en blanco menos las cajas', [sheet2.find((r) => r[0] === '6222' && r[2] === '4419').slice(26, 34), sheet2.find((r) => r[0] === '6225' && r[2] === '4433').slice(26, 34)], [['', '', 'platos', 1452, 54, 0, 242, 0], ['', '', '', '', '', 0, 30, 0]])
    eq('la leyenda explica cada columna de CONSUMO', m.flujoLegend('x').map((r) => r[0]).slice(-14, -5),['CONSUMO', 'CONSUMO: MEZCLAS USADAS', 'MEZCLAS QUE QUEDAN', 'UNIDAD', 'UNIDADES USADAS EN CAJAS', 'UNIDADES QUE QUEDAN', 'CAJAS EN PEDIDOS', 'CAJAS SIN PEDIDO', 'PALLETS EN PEDIDOS'])
    const cx = (r, k) => m.flujoConsumo(r).find((x) => x.key === k)?.text
    eq('el consumo en palabras, con los números reales', [cx(x, 'mixes'), cx(x, 'units'), cx(x, 'cases'), cx(x, 'pallets')], ['85 hechas · usadas 3,487 pouches ÷ (5.5 yield × 8 por caja) = 79.25 · quedan 5.75', '3,487 pouches hechos · usados en cajas 514 cs × 8 por caja = 4,112 · quedan 0 · Packing empacó más de lo que reportó RTE', '514 hechas · 72 en pedidos (2 pallets) · 442 sin pedido', '12 hechos · 2 en pedidos'])
    eq('y para MFO: en platos; sin yield no hay mezclas usadas; en libras no hay unidades ni mezclas', [cx(z, 'mixes'), cx(z, 'units'), cx(rowA('6225', '4433'), 'units'), cx(rowA('6225', '4433'), 'mixes')], ['0 hechas · usadas: nada que calcular (Falta en Productos: yield)', '1,506 platos hechos · usados en cajas 242 cs × 6 por caja = 1,452 · quedan 54', 'MFO lo registró en libras: no se pasa a cajas', '2 hechas · usadas: nada que calcular (MFO lo registró en libras: no se pasa a cajas)'])
    // ---- SPIRAL and the runs just started (Jose, 2026-10-19 morning, from the floor: "Spiral está trabajando y no
    // sale en Flujo ese código"). Avance's two rules hid them here: a Spiral run weighing its mezclas in pounds (or
    // counting them in cases) makes no mezclas, and a run with no unit yet counts nothing ----
    m.mergeProducts([{ code: 'S1', name: 'Sopa de res', pouchesPerCase: 6, casesPerMix: 10, cratesPerCart: 24, pouchesPerCrate: 10, casesPerPallet: 50, spiralUnit: 'lb', updatedAt: 0 }])
    // S1 / 6230: Spiral only weighed it (400 + 350 lb), nothing else of the lot anywhere; S2 (not in Productos) counted in cases
    run(spiral, 'S1', '6230', D9, null, [[400], [350]], { measure: 'lb' })
    run(spiral, 'S2', '6230', D9, null, [[40], [40]], { measure: 'cajas' })
    const sp = m.flujoLots(st(), D9, D9), spLot = sp.find((l) => l.lot === '6230')
    const s1 = spLot.rows.find((r) => r.code === 'S1'), s2 = spLot.rows.find((r) => r.code === 'S2')
    eq('un código que Spiral solo pesó en libras tiene su fila: 750 lb aparte, 0 mezclas, Spiral como cuarto, sin empacar, y nada se pasa a cajas', [spLot.days, s1.mixes, s1.mixRoom, s1.spiralApart, s1.hasAny, s1.state, s1.projected, s1.segun, s1.running, s1.missing, s1.days.map((d) => [d.date, d.mixes, d.spiral, d.spiralApart])], [[D9], 0, 'Spiral', [{ word: 'lb', qty: 750 }], true, 'unpacked', null, 0, false, [], [[D9, 0, 0, [{ word: 'lb', qty: 750 }]]]])
    eq('uno contado en cajas, que no está en Productos, también sale y lo dice', [s2.spiralApart, s2.inTable, s2.missing, s2.name, s2.state], [[{ word: 'cajas', qty: 80 }], false, ['product'], '', 'unpacked'])
    eq('el lote que solo Spiral tocó está en la lista de lotes y entre los conocidos', [sp.map((l) => l.lot).includes('6230'), m.lotsKnown(st()).includes('6230')], [true, true])
    eq('cómo se calculó: lo de Spiral aparte, en palabras, y sin mezclas no hay PROD que explicar', [ex(s1, 'spiral'), ex(a, 'spiral'), ex(s1, 'prod')], ['Spiral registró 750 lb de este lote: no se pasa a cajas; el yield es por mezcla', 'Spiral registró 1,500 lb de este lote: no se pasa a cajas; el yield es por mezcla', undefined])
    eq('Avance no cambia: lo que Spiral cuenta aparte sigue aparte en su vista del lote', m.lotRows(st(), '6230').length, 0)
    // the same code in both measures in one lot (a Spiral line in pounds, another day in cases): both said, never added
    run(spiral, 'S1', '6230', D9, null, [[20]], { measure: 'cajas' })
    // a Spiral run just started on lot 6231 with no mezcla yet, and a Kitchen run just started on 6230: each gives its
    // lot a row of its code in zeros, "en curso", and the lot is on the list from its first minute
    const openSp = run(spiral, 'S3', '6231', D9, null, [], { open: true })
    const openK = run(kitchen, 'S1', '6230', D9, null, [], { open: true })
    const sp2 = m.flujoLots(st(), D9, D9), l6231 = sp2.find((l) => l.lot === '6231'), s3 = l6231.rows[0], s1k = sp2.find((l) => l.lot === '6230').rows.find((r) => r.code === 'S1')
    eq('una corrida recién empezada, sin nada registrado: su lote está en la lista y su código tiene fila en ceros, en curso', [sp2.map((l) => l.lot).slice(0, 3), l6231.days, l6231.rows.map((r) => r.code), s3.hasAny, s3.running, s3.openIn, s3.state, s3.mixes, s3.cases, s3.spiralApart, s3.missing, s3.days.map((d) => d.date), ex(s3, 'open'), m.lotsKnown(st()).slice(0, 2)], [['6231', '6230', '6229'], [D9], ['S3'], false, true, ['Spiral'], 'none', 0, 0, [], ['product'], [D9], 'acaba de empezar en Spiral: todavía no hay nada registrado de este lote', ['6231', '6230']])
    eq('con registros y una corrida abierta: "en curso" dice en qué cuarto; las dos medidas de Spiral, libras primero, sin sumarlas', [s1k.running, s1k.openIn, ex(s1k, 'open'), s1k.spiralApart, s1k.mixes, s1k.mixRoom], [true, ['Kitchen'], 'sigue corriendo en Kitchen: estos números todavía cambian', [{ word: 'lb', qty: 750 }, { word: 'cajas', qty: 20 }], 0, 'Spiral'])
    const sheet3 = m.flujoSheet(sp2), r3 = (lot, code) => sheet3.find((r) => r[0] === lot && r[2] === code)
    eq('el Excel: SPIRAL APARTE y SPIRAL EN tras las de CONSUMO; con las dos medidas, en texto y sin unidad; la fila recién empezada en ceros, "sí" en curso', [sheet3[0].slice(-4, -2), r3('6230', 'S1').slice(-4, -2), r3('6230', 'S2').slice(-4, -2), r3('6222', '2286').slice(-4, -2), [...r3('6231', 'S3').slice(7, 8), ...r3('6231', 'S3').slice(23, 26), ...r3('6231', 'S3').slice(-4, -2)]], [['SPIRAL APARTE', 'SPIRAL EN'], ['750 lb · 20 cajas', ''], [80, 'cajas'], [1500, 'lb'], [0, 'Sin registros', 'sí', 'no está en Productos', '', '']])
    eq('la leyenda explica las dos columnas de Spiral', m.flujoLegend('x').slice(-5, -3).map((r) => r[0]), ['SPIRAL APARTE', 'SPIRAL EN'])
    // a Packing run just started whose pallet, half built, moved on to the next lot: both lots are on the list, each
    // with the code's row in zeros and running (nothing counts until the pallet is marked done)
    const openP = run(p2, 'S1', '6232', D9, 50, [], { open: true }); tick(); m.palletLotEnds(openP, 10, '30', '6233')
    const sp4 = m.flujoLots(st(), D9, D9)
    eq('un pallet a medio armar que pasó al lote siguiente: los dos lotes en la lista, con la fila de su código en ceros y en curso (Packing)', [['6232', '6233'].map((l) => (({ cases, pallets, running, openIn, state }) => [cases, pallets, running, openIn, state])(sp4.find((x) => x.lot === l).rows.find((r) => r.code === 'S1'))), ['6233', '6232'].every((l, i) => m.lotsKnown(st())[i] === l)], [[[0, 0, true, ['Packing'], 'none'], [0, 0, true, ['Packing'], 'none']], true])
    // ended with nothing recorded: the row and its lot go (nothing of them was ever counted); a lot with records stays
    m.endRun(openSp, false); m.endRun(openK, false)
    const sp5 = m.flujoLots(st(), D9, D9)
    eq('terminada sin registrar nada: la fila y el lote se van; el otro lote se queda con lo suyo, ya sin "en curso"', [sp5.some((l) => l.lot === '6231'), (({ running, openIn, spiralApart }) => [running, openIn, spiralApart])(sp5.find((l) => l.lot === '6230').rows.find((r) => r.code === 'S1'))], [false, [false, [], [{ word: 'lb', qty: 750 }, { word: 'cajas', qty: 20 }]]])
    // ---- THE LOT'S PROGRAM (Jose, 2026-10-19: a room's program may name its lot): what the office programmed of a
    // code for a lot, in any room and on any day, against what the lot has of it; a program without a lot is the
    // day's and is attributed to no lot; a lot only programmed is listed with its codes in zeros ----
    m.setPlan(D9, 'Kitchen', '2286', 80, '6222'); m.setPlan(D9, 'RTE', '2286', 3500, '6222'); m.setPlan(D9, 'Packing', '2286', 500, '6222'); m.setPlan(D9, 'MFO', '4419', 1500, '6222')
    m.setPlan(D8, 'Kitchen', 'S1', 5, '6230'); m.setPlan(D9, 'Kitchen', 'S1', 10, '6230'); m.setPlan(D9, 'Spiral', 'S1', 1000, '6230')
    m.setPlan(D8, 'Kitchen', '4433', 7) // no lot: the day's program, Avance's
    m.setPlan(D9, 'Kitchen', 'P9', 4, '6240') // a lot nobody has started
    const pg = m.flujoLots(st(), D8, D9), pRow = (lot, code) => pg.find((l) => l.lot === lot).rows.find((r) => r.code === code)
    const progOf = (r) => r.prog.map((p) => [p.dept, p.word, p.qty, p.made, p.left])
    eq('2286 / 6222: el programa de cada cuarto contra lo hecho del lote en su palabra (85 mezclas: completo con 5 de más; 3,487 de 3,500 pouches; 514 de 500 cajas)', progOf(pRow('6222', '2286')), [['Kitchen', 'mezclas', 80, 85, -5], ['RTE', 'pouches', 3500, 3487, 13], ['Packing', 'cajas', 500, 514, -14]])
    eq('4419 / 6222: MFO en platos; 4433 / 6224: su programa no tiene lote y no se le atribuye', [progOf(pRow('6222', '4419')), progOf(pRow('6224', '4433'))], [[['MFO', 'platos', 1500, 1506, -6]], []])
    eq('S1 / 6230: los dos días del programa de Kitchen suman (15; Kitchen no hizo ninguna); Spiral en libras, como cuenta el código (750 de 1,000)', progOf(pRow('6230', 'S1')), [['Kitchen', 'mezclas', 15, 0, 15], ['Spiral', 'lb', 1000, 750, 250]])
    const p9 = pg.find((l) => l.lot === '6240')
    eq('un lote solo programado está en la lista, primero, con su código en ceros: "Sin registros", sin días, con lo programado; y no cuenta como lote registrado', [pg.map((l) => l.lot).slice(0, 2), p9.days, p9.rows.map((r) => [r.code, r.state, r.hasAny, r.running, r.mixes, r.days]), progOf(p9.rows[0]), p9.sum.prog, m.lotsKnown(st()).includes('6240')], [['6240', '6233'], [], [['P9', 'none', false, false, 0, []]], [['Kitchen', 'mezclas', 4, 0, 4]], [{ dept: 'Kitchen', word: 'mezclas', qty: 4 }], false])
    eq('el programa se atribuye al lote en cualquier día: mirando solo el 8, el 6222 trae el programa escrito el 9; el lote solo programado el 9 no está', [pRow('6222', '2286').prog.length, m.flujoLots(st(), D8, D8).find((l) => l.lot === '6222').rows.find((r) => r.code === '2286').prog.length, m.flujoLots(st(), D8, D8).some((l) => l.lot === '6240')], [3, 3, false])
    const ex2 = (r) => m.flujoExplain(r).find((x) => x.key === 'program')?.text
    eq('cómo se calculó: el programa del lote, cuarto por cuarto, en palabras; la banda del lote, cada palabra una vez', [ex2(pRow('6222', '2286')), ex2(pRow('6230', 'S1')), ex2(pRow('6224', '4433')), m.progSumText(pg.find((l) => l.lot === '6222').sum.prog), m.progSumText(pRow('6230', 'S1').prog), pRow('6222', '2286').prog.map((p) => m.progText(p))], ['80 mezclas (Kitchen) · hechas 85 · completo (+5); 3,500 pouches (RTE) · hechos 3,487 · faltan 13; 500 cajas (Packing) · hechas 514 · completo (+14)', '15 mezclas (Kitchen) · hechas 0 · faltan 15; 1,000 lb (Spiral) · hechas 750 · faltan 250', undefined, '80 mezclas · 3,500 pouches · 1,500 platos · 500 cajas', '15 mezclas · 1,000 lb Spiral', ['prog. 80 mezclas', 'prog. 3,500 pouches', 'prog. 500 cajas']])
    eq('la columna PROGRAMADO: cada cuarto en su palabra, nombrado solo cuando hace falta (la misma regla que la banda)', [m.flujoProgLines(pRow('6222', '2286').prog), m.flujoProgLines(pRow('6230', 'S1').prog)], [[{ dept: 'Kitchen', qty: 80, word: 'mezclas' }, { dept: 'RTE', qty: 3500, word: 'pouches' }, { dept: 'Packing', qty: 500, word: 'cajas' }], [{ dept: 'Kitchen', qty: 15, word: 'mezclas' }, { dept: 'Spiral', qty: 1000, word: 'lb Spiral' }]])
    const sheet4 = m.flujoSheet(pg), r4 = (lot, code) => sheet4.find((r) => r[0] === lot && r[2] === code)
    eq('el Excel: PROGRAMADO y PROG. CUARTO al final; con un cuarto, número y cuarto con su unidad; con varios, en texto; sin programa, en blanco', [sheet4[0].slice(-2), r4('6222', '4419').slice(-2), r4('6230', 'S1').slice(-2), r4('6222', '2286').slice(-2), r4('6224', '4433').slice(-2), [...r4('6240', 'P9').slice(0, 3), ...r4('6240', 'P9').slice(-2)]], [['PROGRAMADO', 'PROG. CUARTO'], [1500, 'MFO · platos'], ['15 mezclas Kitchen · 1,000 lb Spiral', ''], ['80 mezclas Kitchen · 3,500 pouches RTE · 500 cajas Packing', ''], ['', ''], ['6240', '', 'P9', 4, 'Kitchen · mezclas']])
    eq('la leyenda explica las dos columnas del programa', m.flujoLegend('x').slice(-3, -1).map((r) => r[0]), ['PROGRAMADO', 'PROG. CUARTO'])
    eq('Avance no cambia: el programa del día sigue siendo del día, con o sin lote', m.planRows(st(), D9, 'Kitchen').filter((r) => r.planned > 0).map((r) => [r.code, r.planned, r.lot]), [['2286', 80, '6222'], ['P9', 4, '6240'], ['S1', 10, '6230']])
    // ---- the program's word, read as the PlanCard reads it (review of 2026-10-19): an MFO program for a code MFO
    // weighs in pounds is in pounds (Flujo said "0 of 300 platos" while the PlanCard said "240 of 300 lb"); with no
    // bin of the lot yet, the word of the code's newest bin on the device; a Spiral program for a code Productos does
    // not say how Spiral counts goes in what Spiral registered of the lot; and the band never adds Kitchen's and
    // Spiral's mezclas programs into one figure ----
    m.setPlan(D9, 'MFO', '4433', 300, '6225')
    m.setPlan(D8, 'MFO', '4433', 100, '6241') // a lot with no bin of 4433 yet: its newest bin on this device is in pounds
    m.mergeProducts([{ code: 'N7', name: 'Sin unidad de Spiral', pouchesPerCase: 6, casesPerMix: 10, cratesPerCart: 24, pouchesPerCrate: 10, casesPerPallet: 50, updatedAt: 0 }])
    run(spiral, 'N7', '6250', D9, null, [[400], [350]], { measure: 'lb' })
    m.setPlan(D9, 'Spiral', 'N7', 1000, '6250')
    m.setPlan(D9, 'Spiral', 'P9', 4, '6240')
    const pg2 = m.flujoLots(st(), D8, D9), pRow2 = (lot, code) => pg2.find((l) => l.lot === lot).rows.find((r) => r.code === code)
    eq('4433 / 6225: MFO lo pesó en libras y su programa se lee en libras, como en la tarjeta del programa (240 de 300 lb); la banda nombra a MFO', [progOf(pRow2('6225', '4433')), ex2(pRow2('6225', '4433')), m.progSumText(pRow2('6225', '4433').prog), m.flujoSheet([pg2.find((l) => l.lot === '6225')]).find((r) => r[2] === '4433').slice(-2), m.planRows(st(), D9, 'MFO').filter((r) => r.code === '4433').map((r) => [r.unit, r.planned, r.done, r.left])], [[['MFO', 'lb', 300, 240, 60]], '300 lb (MFO) · hechas 240 · faltan 60', '300 lb MFO', [300, 'MFO · lb'], [['lb', 300, 240, 60]]])
    eq('4433 / 6241: sin bins del lote todavía, la palabra del último bin del código en el aparato (lb)', [progOf(pRow2('6241', '4433')), pRow2('6241', '4433').state], [[['MFO', 'lb', 100, 0, 100]], 'none'])
    eq('4419 / 6222 sigue en platos; 2286 / 6222 y S1 / 6230 como antes', [progOf(pRow2('6222', '4419')), progOf(pRow2('6222', '2286')), progOf(pRow2('6230', 'S1'))], [[['MFO', 'platos', 1500, 1506, -6]], [['Kitchen', 'mezclas', 80, 85, -5], ['RTE', 'pouches', 3500, 3487, 13], ['Packing', 'cajas', 500, 514, -14]], [['Kitchen', 'mezclas', 15, 0, 15], ['Spiral', 'lb', 1000, 750, 250]]])
    eq('N7 / 6250: Productos no dice en qué cuenta Spiral el código; el programa va en lo que Spiral registró del lote (lb), como lo lee la tarjeta', [progOf(pRow2('6250', 'N7')), m.planRows(st(), D9, 'Spiral').filter((r) => r.code === 'N7').map((r) => [r.unit, r.planned, r.done])], [[['Spiral', 'lb', 1000, 750, 250]], [['lb', 1000, 750]]])
    const l40 = pg2.find((l) => l.lot === '6240')
    eq('P9 / 6240 programado en Kitchen y en Spiral: la banda nombra cada cuarto y no los suma (unas mismas mezclas no son "8")', [l40.sum.prog, m.progSumText(l40.sum.prog), progOf(l40.rows[0]), m.flujoSheet([l40])[1].slice(-2), m.progSumText(pg2.find((l) => l.lot === '6222').sum.prog)], [[{ dept: 'Kitchen', word: 'mezclas', qty: 4 }, { dept: 'Spiral', word: 'mezclas', qty: 4 }], '4 mezclas Kitchen · 4 mezclas Spiral', [['Kitchen', 'mezclas', 4, 0, 4], ['Spiral', 'mezclas', 4, 0, 4]], ['4 mezclas Kitchen · 4 mezclas Spiral', ''], '80 mezclas · 3,500 pouches · 1,500 platos · 500 cajas'])
    eq('bajo PROD, con los dos cuartos programados, cada renglón nombra el suyo', l40.rows[0].prog.map((p) => m.progText(p, true)), ['prog. 4 mezclas Kitchen', 'prog. 4 mezclas Spiral'])
    return { sheet }
  })
  const z = await fl.use(async (m) => m.loadZip())
  const bytes = await fl.use(async (m) => m.xlsxBytes([{ name: 'Flujo de datos', rows: got.sheet }]))
  const xml = z.strFromU8(z.unzipSync(bytes)['xl/worksheets/sheet1.xml'])
  eq('en el archivo de Excel los números van como números, con sus dos decimales', [xml.includes('<v>435.88</v>'), xml.includes('<v>6.13</v>'), xml.includes('<t xml:space="preserve">SEGÚN RTE (CS)</t>')], [true, true, true])
}
section('Una línea quitada vuelve tal cual: la misma línea, con su nombre (2026-10-17: Spiral quedó sin líneas)')
{
  const ln = await device('ln', { user: 'Eli', usual: true })
  ln.use((m) => {
    const st = () => m.store.get(), lineOf = (name) => st().lines.find((l) => l.dept === 'Spiral' && l.name === name)
    clock = oct(10, 6, 0)
    m.addLine('Spiral', 'Racks'); m.addLine('Spiral', 'Spiral')
    const racks = lineOf('Racks'), spiralId = lineOf('Spiral').id
    m.startRun(racks, '0889', '6290', DAY, null); clock = oct(10, 7, 0); m.unitDone(st().runs.at(-1).id, null); clock = oct(10, 8, 0); m.endRun(st().runs.at(-1).id, false)
    clock = oct(10, 16, 25); m.removeLine(racks.id); m.removeLine(spiralId)
    eq('las dos se quitaron, y el historial dice cuáles, quién y cuándo', [st().lines.filter((l) => l.dept === 'Spiral').length, m.removedLines(st(), 'Spiral').map((x) => [x.name, x.by, x.at === oct(10, 16, 25)])], [0, [['Racks', 'Eli', true], ['Spiral', 'Eli', true]]])
    eq('volver a poner una: la misma línea, con su nombre, y sus registros con ella', [m.restoreLine('Spiral', racks.id), lineOf('Racks')?.id === racks.id, m.lineNameOf(st(), st().runs.at(-1).lineId, '')], [true, true, 'Racks'])
    eq('agregar otra con el nombre de una quitada la trae de vuelta, sin hacer una nueva', [m.addLine('Spiral', 'spiral'), lineOf('Spiral')?.id === spiralId, st().lines.filter((l) => l.dept === 'Spiral').length, m.removedLines(st(), 'Spiral').length], [true, true, 2, 0])
    eq('y queda en el historial', st().changes.filter((c) => c.what === 'Línea puesta de nuevo en Spiral').map((c) => c.after), ['Racks', 'Spiral'])
    eq('una que no se quitó no se vuelve a poner', m.restoreLine('Spiral', 'nope'), false)
    // two lines of one room with one name (a copy made on a tablet that had no lines): told, the one with codes first
    m.applyRemote('act_lines', { id: 'cp1', dept: 'Spiral', name: 'racks ', deleted: false, updated_at: new Date(oct(10, 15, 36)).toISOString() })
    eq('dos líneas con el mismo nombre se dicen juntas, la que tiene códigos primero', m.duplicateLines(st(), 'Spiral').map((g) => g.map((l) => l.id)), [[racks.id, 'cp1']])
    eq('y no en otro cuarto', m.duplicateLines(st(), 'RTE'), [])
    m.removeLine('cp1')
    eq('quitada la copia, ya no hay aviso', m.duplicateLines(st(), 'Spiral'), [])
    // the version of before made a new line each time: the same name taken off several times is offered once, the last
    m.applyRemote('act_lines', { id: 'st1', dept: 'Spiral', name: 'Stuffed', deleted: false, updated_at: new Date(oct(10, 9, 0)).toISOString() })
    clock = oct(10, 9, 30); m.removeLine('st1')
    m.applyRemote('act_lines', { id: 'st2', dept: 'Spiral', name: 'Stuffed', deleted: false, updated_at: new Date(oct(10, 12, 0)).toISOString() })
    clock = oct(10, 12, 30); m.removeLine('st2')
    eq('un nombre quitado varias veces se ofrece una sola vez: la última', m.removedLines(st(), 'Spiral').map((x) => [x.name, x.id]), [['Stuffed', 'st2']])
    eq('suben al servidor como la misma línea, puesta otra vez', m.outbox.items().filter((i) => i.table === 'act_lines' && i.key === racks.id).map((i) => i.row.deleted), [false])
    // what operators may do with their room's lines: a manager turns each on or off in Ajustes, for every device
    eq('al principio los operadores agregan líneas y no las quitan', [st().lineRules.add, st().lineRules.remove], [true, false])
    clock = oct(10, 17, 0); m.setLineRules({ remove: true })
    eq('quitar se enciende: sube con lo que fija el manager, y queda en el historial', [st().lineRules.remove, m.outbox.items().filter((i) => i.table === 'act_targets' && i.key === 'opt:oplines').map((i) => [i.row.per_hour, i.row.per_shift]), st().changes.filter((c) => c.refKey === 'opt:oplines').map((c) => [c.before, c.after])], [true, [[1, 1]], [['agregan líneas · no quitan líneas', 'agregan líneas · quitan líneas libres']]])
    m.setLineRules({ remove: true })
    eq('decir lo que ya está no manda nada', m.outbox.items().filter((i) => i.table === 'act_targets' && i.key === 'opt:oplines').length, 1)
    m.applyRemote('act_targets', { dept: 'opt:oplines', per_hour: 0, per_shift: 0, updated_at: new Date(oct(10, 18, 0)).toISOString() })
    eq('lo que dice otro manager llega a este aparato', [st().lineRules.add, st().lineRules.remove], [false, false])
    m.applyRemote('act_targets', { dept: 'opt:oplines', per_hour: 1, per_shift: 1, updated_at: new Date(oct(10, 17, 30)).toISOString() })
    eq('una versión vieja no lo cambia', [st().lineRules.add, st().lineRules.remove], [false, false])
  })
}
section('Un código que nadie registró: la oficina lo agrega después, en cualquier cuarto, con lo que sepa')
{
  // Jose, 2026-10-17: the office wants to add any code of any room that was not recorded, choosing the date and the
  // hours; what they do not know stays blank ("somebody said they did 4 and nothing was registered")
  const of = await device('office', { user: 'Noelia', usual: true })
  of.use((m) => {
    const st = () => m.store.get()
    m.role.set('office')
    const lineOf = (dept, name) => { m.addLine(dept, name); return st().lines.find((l) => l.dept === dept && l.name === name) }
    const r1 = lineOf('RTE', 'Línea 1'), k1 = lineOf('Kitchen', 'Braiser 1'), p1 = lineOf('Packing', 'Línea 1'), m1 = lineOf('MFO', 'Línea 1')
    clock = oct(10, 14, 0)
    // four carts of 240 pouches from 10:00 to 11:00; the lot and who made them are known
    const id = m.addRunLater({ dept: 'RTE', lineId: r1.id, code: 'a100', lot: '6287', date: DAY, startedAt: oct(10, 10, 0), endedAt: oct(10, 11, 0), units: [{ qty: 240 }, { qty: 240 }, { qty: 240 }, { qty: 240 }], perUnit: 240, madeBy: 'Ana' })
    const r = st().runs.find((x) => x.id === id)
    eq('la corrida queda cerrada, con sus carros repartidos entre sus horas, hecha por quien se dijo', [r.dept, r.line, r.code, r.lot, r.date, r.startedAt, r.endedAt, r.units.map((u) => [Math.round((u.at - oct(10, 10, 0)) / M), u.qty, u.by]), r.perUnit, r.by], ['RTE', 'Línea 1', 'A100', '6287', DAY, oct(10, 10, 0), oct(10, 11, 0), [[15, 240, 'Ana'], [30, 240, 'Ana'], [45, 240, 'Ana'], [60, 240, 'Ana']], 240, 'Ana'])
    eq('y en el historial, con el nombre de quien la agregó', st().changes.filter((c) => c.refKey === id).map((c) => [c.by, c.what.split(' · ').pop(), c.after]), [['Noelia', 'Se agregó después', '4 carros · 960 pouches · 10:00 AM – 11:00 AM · lote 6287']])
    eq('el reporte la cuenta como cualquier otra', (({ byDept, rows }) => [byDept.map((d) => [d.dept, d.units, d.qty]), rows.map((x) => [x.r.code, x.units, x.qty, x.st.working])])(m.reportOf(st(), DAY, clock, { only: 'RTE' })), [[['RTE', 4, 960]], [['A100', 4, 960, 3_600_000]]])
    eq('a esas horas la línea ya tenía código: no se agrega, y nada cambia', [m.addRunLater({ dept: 'RTE', lineId: r1.id, code: 'B200', date: DAY, startedAt: oct(10, 10, 30), endedAt: oct(10, 12, 0), units: [{ qty: 100 }] }), st().runs.length], ['', 1])
    eq('justo después, sí', !!m.addRunLater({ dept: 'RTE', lineId: r1.id, code: 'B200', date: DAY, startedAt: oct(10, 11, 0), endedAt: oct(10, 11, 30), units: [] }), true)
    // Kitchen: only the hour is known; three mezclas and nothing else
    const k = m.addRunLater({ dept: 'Kitchen', lineId: k1.id, code: 'C300', date: DAY, startedAt: oct(10, 8, 0), units: [{ qty: null }, { qty: null }, { qty: null }] })
    const kr = st().runs.find((x) => x.id === k)
    eq('sin hora de fin: las mezclas van una por minuto y el código termina con la última; sin lote, y la hizo quien la agregó', [kr.lot, kr.by, kr.units.map((u) => Math.round((u.at - oct(10, 8, 0)) / M)), kr.endedAt - oct(10, 8, 0), m.madeText(kr, m.runQty(st(), kr))], ['', 'Noelia', [0, 1, 2], 2 * M, '3 mezclas'])
    // Packing: pallets with their tags, in order; MFO: bins of platos, the same hour of start and end
    const p = m.addRunLater({ dept: 'Packing', lineId: p1.id, code: 'A100', lot: '6287', date: DAY, startedAt: oct(10, 9, 0), endedAt: oct(10, 9, 40), units: [{ qty: 36, ref: '1741' }, { qty: 36, ref: '1742' }], perUnit: 36 })
    const pr = st().runs.find((x) => x.id === p)
    eq('pallets con sus tags, en la lista de pallets del reporte', [pr.units.map((u) => [u.qty, u.ref]), m.reportOf(st(), DAY, clock, { only: 'Packing' }).pallets.map((x) => [x.n, x.parts[0].tag, x.total])], [[[36, '1741'], [36, '1742']], [[1, '1741', 36], [2, '1742', 36]]])
    const mf = m.addRunLater({ dept: 'MFO', lineId: m1.id, code: 'M100', date: DAY, startedAt: oct(10, 9, 0), endedAt: oct(10, 9, 0), units: [{ qty: 30, ref: '1' }, { qty: 30, ref: '2' }], bin: 'platos' })
    const mr = st().runs.find((x) => x.id === mf)
    eq('bins de platos con la misma hora de inicio y fin: cada bin en su instante, y el cuarto los cuenta en platos, tal cual', [m.binOf(mr), mr.units.map((u) => u.at - oct(10, 9, 0)), m.madeText(mr, m.runQty(st(), mr)), m.deptToday(st(), 'MFO', DAY, clock).qty], ['platos', [0, 1], '2 bins · 60 platos', 60])
    // a set up left open on the line before those hours ends where the code started
    clock = oct(10, 7, 0); m.startStop('RTE', r1.id, 'Set up', '')
    const sid = st().stops.find((x) => x.lineId === r1.id && !x.endedAt).id
    clock = oct(10, 14, 0)
    m.addRunLater({ dept: 'RTE', lineId: r1.id, code: 'C300', date: DAY, startedAt: oct(10, 7, 30), endedAt: oct(10, 8, 0), units: [] })
    eq('el Set up abierto termina donde empezó el código agregado', st().stops.find((x) => x.id === sid).endedAt, oct(10, 7, 30))
    eq('sin línea, con una línea de otro cuarto, o sin código: nada', [m.addRunLater({ dept: 'RTE', lineId: 'nope', code: 'X', date: DAY, startedAt: oct(10, 12, 0), units: [] }), m.addRunLater({ dept: 'Kitchen', lineId: r1.id, code: 'X', date: DAY, startedAt: oct(10, 12, 0), units: [] }), m.addRunLater({ dept: 'RTE', lineId: r1.id, code: '  ', date: DAY, startedAt: oct(10, 12, 0), units: [] })], ['', '', ''])
    eq('todo sube al servidor', m.outbox.items().filter((i) => i.table === 'act_runs').length, 6)
  })
}
section('Un registro de Packing agregado después: sus pallets uno por uno, con sus cajas, su tag y su PO, como los de la línea')
{
  // Jose, 2026-10-18: "Puedes hacer que aparezca lo de poner PO cuando estamos agregando registro en packing y también
  // que podamos agregar múltiples pallets más rápido". Each pallet of the record is kept exactly as one finished on the
  // line, so the report, Avance, the orders (and what they lack) and the search count it like any other
  const lt = await device('later', { user: 'Noelia', usual: true })
  lt.use((m) => {
    const st = () => m.store.get()
    m.role.set('office')
    m.addLine('Packing', 'Línea 1'); m.addLine('Packing', 'Línea 2')
    const [p1, p2] = ['Línea 1', 'Línea 2'].map((n) => st().lines.find((l) => l.dept === 'Packing' && l.name === n))
    clock = oct(10, 5, 0)
    const po1 = m.saveOrder(null, { customer: 'Cliente Seis', po: '6001', code: 'P700', cases: 240, shipBy: '', dest: '' })
    const po2 = m.saveOrder(null, { customer: '', po: '6002', code: 'P700', cases: null, shipBy: '', dest: '' })
    const other = m.saveOrder(null, { customer: 'Cliente Ocho', po: '8001', code: 'E500', cases: 100, shipBy: '', dest: '' })
    // a pallet finished on the line, to hold the added ones against
    clock = oct(10, 6, 0); m.startRun(p2, 'P700', '6283', DAY, 48)
    const lr = () => st().runs.find((r) => r.lineId === p2.id)
    clock = oct(10, 6, 30); m.palletDone(lr().id, [{ lot: '6283', qty: 48, tag: '3100' }], po1)
    clock = oct(10, 7, 0); m.endRun(lr().id, false)
    clock = oct(10, 14, 0)
    // the list as it was typed: two of 48 for PO 6001 (from the quick bar), one of 30 for PO 6002 without its tag yet,
    // one given to an order of another code and one to an order this device does not know
    const rows = [{ qty: '48', tag: '3001', po: po1 }, { qty: '48', tag: ' 3002 ', po: po1 }, { qty: '30', tag: '', po: po2 }, { qty: '40', tag: '3004', po: other }, { qty: '40', tag: '3005', po: 'nope' }]
    eq('la lista se puede guardar', [m.checkLaterPallets(rows).ok, m.checkLaterPallets(rows).cases], [true, [48, 48, 30, 40, 40]])
    const { units, perUnit } = m.laterPalletUnits(st(), 'p700', ' 6287 ', rows)
    eq('cada pallet lleva el lote del registro con sus cajas y su tag, y su PO; el de otro código o uno que no existe no se pone', units, [
      { qty: 48, ref: '3001', lots: [{ lot: '6287', qty: 48, tag: '3001' }], po: po1 },
      { qty: 48, ref: '3002', lots: [{ lot: '6287', qty: 48, tag: '3002' }], po: po1 },
      { qty: 30, ref: '', lots: [{ lot: '6287', qty: 30 }], po: po2 },
      { qty: 40, ref: '3004', lots: [{ lot: '6287', qty: 40, tag: '3004' }] },
      { qty: 40, ref: '3005', lots: [{ lot: '6287', qty: 40, tag: '3005' }] }])
    eq('sus cajas por pallet son las que propondría la línea (aquí, las de la última corrida del código)', perUnit, 48)
    const id = m.addRunLater({ dept: 'Packing', lineId: p1.id, code: 'p700', lot: '6287', date: DAY, startedAt: oct(10, 9, 0), endedAt: oct(10, 9, 50), units, perUnit, madeBy: 'Ana' })
    const r = () => st().runs.find((x) => x.id === id)
    const keys = (u) => Object.keys(u).sort()
    eq('se guardan con las mismas partes que el pallet de la línea', [keys(r().units[0]), keys(lr().units[0])], [['at', 'by', 'lots', 'po', 'qty', 'ref'], ['at', 'by', 'lots', 'po', 'qty', 'ref']])
    eq('en orden, repartidos en sus horas, con sus cajas, tags, lotes y PO, hechos por quien se dijo', r().units.map((u) => [Math.round((u.at - oct(10, 9, 0)) / M), u.qty, u.ref, u.lots.map((l) => [l.lot, l.qty, l.tag ?? '']), u.po === po1 ? 1 : u.po === po2 ? 2 : u.po ?? '', u.by]), [[10, 48, '3001', [['6287', 48, '3001']], 1, 'Ana'], [20, 48, '3002', [['6287', 48, '3002']], 1, 'Ana'], [30, 30, '', [['6287', 30, '']], 2, 'Ana'], [40, 40, '3004', [['6287', 40, '3004']], '', 'Ana'], [50, 40, '3005', [['6287', 40, '3005']], '', 'Ana']])
    eq('la corrida: código escrito como se guarda, su lote, y sus cajas por pallet', [r().code, r().lot, r().perUnit], ['P700', '6287', 48])
    // the orders: what each has, and what it still lacks
    const lacks = (o) => { const x = st().orders.find((y) => y.id === o); return x.cases == null ? null : x.cases - m.orderMade(st(), o) }
    eq('el PO 6001 suma el pallet de la línea y los dos agregados (le faltan 96 cajas); el 6002, el de 30; el de otro código, nada', [m.orderMade(st(), po1), lacks(po1), m.orderPallets(st(), po1).done.length, m.orderMade(st(), po2), m.orderMade(st(), other)], [144, 96, 3, 30, 0])
    eq('en el historial, con quién y los PO de sus pallets', st().changes.filter((c) => c.refKey === id).map((c) => [c.by, c.what.split(' · ').pop(), c.after]), [['Noelia', 'Se agregó después', '5 pallets · 206 cajas · 9:00 AM – 9:50 AM · lote 6287 · Cliente Seis · PO 6001: 2 pallets · PO 6002: 1 pallet']])
    // the report, Avance, the room's total and the search count them as the line's
    const rep = m.reportOf(st(), DAY, clock, { only: 'Packing' })
    eq('en la lista de pallets del reporte: sus lotes, tags, cajas, PO y su lugar en el PO', rep.pallets.filter((p) => p.r.id === id).map((p) => [p.n, p.parts.map((x) => [x.lot, x.qty, x.tag]), p.total, p.order, p.of]), [[1, [['6287', 48, '3001']], 48, 'Cliente Seis · PO 6001', [2, 5]], [2, [['6287', 48, '3002']], 48, 'Cliente Seis · PO 6001', [3, 5]], [3, [['6287', 30, '']], 30, 'PO 6002', [1, null]], [4, [['6287', 40, '3004']], 40, '', null], [5, [['6287', 40, '3005']], 40, '', null]])
    const av = m.avanceRows(st(), DAY).find((x) => x.code === 'P700')
    eq('Avance y el total del cuarto cuentan sus cajas y sus pallets como los de la línea', [av.casesDone, av.palletsDone, m.deptToday(st(), 'Packing', DAY, clock).qty], [254, 6, 254])
    const found = (q) => m.searchReport(st(), rep, q, [], clock).hits.filter((h) => h.kind === 'pallet').map((h) => h.key)
    eq('la búsqueda encuentra cada pallet por su tag y por su PO', [found('3002'), found('6002')], [[m.hitKey.pallet(id, 2)], [m.hitKey.pallet(id, 3)]])
    // without the lot known: its cases and its tag alone, as a pallet of before lots were kept
    const bare = m.laterPalletUnits(st(), 'P700', '  ', [{ qty: '36', tag: '3200', po: po2 }])
    eq('sin lote: el pallet lleva sus cajas, su tag y su PO, sin lotes', bare.units, [{ qty: 36, ref: '3200', po: po2 }])
    const nb = m.addRunLater({ dept: 'Packing', lineId: p1.id, code: 'P700', date: DAY, startedAt: oct(10, 10, 0), endedAt: oct(10, 10, 20), units: bare.units, perUnit: bare.perUnit })
    eq('y el reporte lo muestra con su tag y su PO', m.reportOf(st(), DAY, clock, { only: 'Packing' }).pallets.filter((p) => p.r.id === nb).map((p) => [p.parts.map((x) => [x.lot, x.qty, x.tag]), p.order]), [[[['', 36, '3200']], 'PO 6002']])
    // what addRunLater itself keeps: only an order this device knows, only on what fills orders; a pallet's tags are its number
    const kept = (x) => st().runs.find((y) => y.id === x).units.map((u) => [u.qty, u.ref, u.po === po1 ? 1 : u.po ?? ''])
    const unknown = m.addRunLater({ dept: 'Packing', lineId: p1.id, code: 'P700', lot: '6287', date: DAY, startedAt: oct(10, 11, 0), endedAt: oct(10, 11, 10), units: [{ qty: 40, ref: '3400', po: 'nope' }, { qty: null, lots: [{ lot: '6287', qty: 20, tag: '3401' }, { lot: '6288', qty: 16, tag: '3402' }], po: po1 }] })
    eq('un PO que este aparato no conoce no se inventa; sin número escrito, el pallet lleva por número los tags de sus lotes', kept(unknown), [[40, '3400', ''], [36, '3401, 3402', 1]])
    const bins = m.addRunLater({ dept: 'Packing', lineId: p1.id, code: 'P700', date: DAY, startedAt: oct(10, 11, 30), endedAt: oct(10, 11, 40), units: [{ qty: 20, ref: '1', po: po1 }], bin: 'platos' })
    eq('un bin no lleva pedido', kept(bins), [[20, '1', '']])
    // the cases per pallet nobody types in that window
    clock = oct(10, 14, 30)
    m.saveProduct(st().products.length, { code: 'P800', name: 'Prueba', pouchesPerCase: 0, casesPerMix: 0, cratesPerCart: 24, pouchesPerCrate: 0, casesPerPallet: 60, updatedAt: 0 })
    // what the line starts the code with, never the pallets' own number (a short pallet would count as complete)
    eq('cajas por pallet: las que la línea pondría (tabla de productos, o la última corrida del código), aunque todos los pallets tengan otro número igual; si no, ninguna', [m.laterPerPallet(st(), 'P700', [40, 40]), m.laterPerPallet(st(), 'P800', [48, 30]), m.laterPerPallet(st(), 'P800', [40, 40]), m.laterPerPallet(st(), 'P800', [30]), m.laterPerPallet(st(), 'Z999', [48, 48]), m.laterPerPallet(st(), 'Z999', [48, 30]), m.laterPerPallet(st(), 'Z999', []), m.laterPerPallet(st(), 'Z999', [NaN, 0])], [48, 60, 60, 60, null, null, null, null])
    // one short pallet of 30 added for a PO of 240 cases of a code of 60 to the pallet: it is short, and its place in
    // the PO counts the PO's 4 pallets (240 / 60), not 8 (240 / 30)
    const po8 = m.saveOrder(null, { customer: '', po: '8800', code: 'P800', cases: 240, shipBy: '', dest: '' })
    const short = m.laterPalletUnits(st(), 'P800', '6290', [{ qty: '30', tag: '3500', po: po8 }])
    const sid = m.addRunLater({ dept: 'Packing', lineId: p1.id, code: 'P800', lot: '6290', date: DAY, startedAt: oct(10, 12, 0), endedAt: oct(10, 12, 10), units: short.units, perUnit: short.perUnit })
    const sp = m.reportOf(st(), DAY, clock, { only: 'Packing' }).pallets.filter((p) => p.r.id === sid)
    eq('un pallet corto agregado después queda corto: la corrida lleva las cajas por pallet del código, y su lugar en el PO es 1 de 5 (2026-10-22: el corto deja 210 cajas, 4 pallets más de 60)', [st().runs.find((x) => x.id === sid).perUnit, sp.map((p) => [p.total, p.total < p.r.perUnit, p.of])], [60, [[30, true, [1, 5]]]])
    // what the window checks before it saves
    const ck = (list) => { const c = m.checkLaterPallets(list.map((x) => (typeof x === 'string' ? { qty: x, tag: '', po: '' } : { po: '', ...x }))); return [c.ok, c.missing, c.twice] }
    eq('sin pallets no se guarda', ck([]), [false, [], []])
    eq('cada pallet con sus cajas: un número entero mayor que 0 (dice cuáles faltan)', [ck(['48', '', '0']), ck(['4.5', 'x', ' 12 '])], [[false, [2, 3], []], [false, [1, 2], []]])
    eq('un tag escrito dos veces en la lista se señala (con espacios o en minúsculas es el mismo); sin tag no cuenta', [ck([{ qty: '48', tag: ' 3001' }, { qty: '48', tag: '3001 ' }, '48', '48']), ck([{ qty: '1', tag: 'a1' }, { qty: '1', tag: 'A1' }]), m.tagTwice(['A1'], ' a1 ')], [[false, [], ['3001']], [false, [], ['A1']], true])
    eq('hasta 500 pallets por registro', [ck(Array.from({ length: 500 }, () => '1'))[0], ck(Array.from({ length: 501 }, () => '1'))[0], m.LATER_MAX], [true, false, 500])
    // "Agregar y otro" on a run: three pallets found together, added one after the other at the hour they chose, with its PO
    // (the PO is made bigger first: a complete PO takes no more pallets since 2026-10-21, and it already has 240 of 240)
    m.saveOrder(po1, { customer: 'Cliente Seis', po: '6001', code: 'P700', cases: 400, shipBy: '', dest: '' })
    const ats = ['3101', '3102', '3103'].map((tag) => m.addUnit(lr().id, { at: oct(10, 6, 45), qty: null, lots: [{ lot: '6283', qty: 48, tag }], po: po1 }))
    eq('tres pallets seguidos a la misma hora: cada uno en su instante, en el orden en que se agregaron, cada uno con su PO', [ats.map((a) => a - oct(10, 6, 45)), lr().units.map((u) => [u.ref, u.po === po1])], [[0, 1, 2], [['3100', true], ['3101', true], ['3102', true], ['3103', true]]])
    eq('el PO los suma y cada uno queda en el historial con su PO', [m.orderMade(st(), po1), st().changes.filter((c) => c.refKey === lr().id && c.what.includes('Se agregó pallet')).map((c) => c.after)], [144 + 36 + 144, ['48 cajas · 6283: 48 (tag 3101) · Cliente Seis · PO 6001', '48 cajas · 6283: 48 (tag 3102) · Cliente Seis · PO 6001', '48 cajas · 6283: 48 (tag 3103) · Cliente Seis · PO 6001']])
  })
}

section('Pallets que nadie registró, agregados desde un pedido de la pestaña Pedidos: el registro empieza en ese pedido, y nada más')
{
  // Jose, 2026-10-18: "también de agregar registro de pallet desde packing tab pedidos, que también ahí se pueda
  // agregar y que salga la opción de agregar PO en los dos lados". The window opened from an order's "+ Pallets"
  // starts on that order (the person tapped it); what it adds is kept as from Terminados, and the order counts it
  const fo = await device('fromorder', { user: 'Noelia', usual: true })
  fo.use((m) => {
    const st = () => m.store.get()
    m.role.set('office')
    m.addLine('Packing', 'Línea 1')
    const p1 = st().lines.find((l) => l.dept === 'Packing')
    clock = oct(10, 5, 0)
    const po1 = m.saveOrder(null, { customer: 'Cliente Uno', po: '4471', code: '0900', cases: 144, shipBy: '', dest: '' })
    const po2 = m.saveOrder(null, { customer: '', po: '4472', code: '900', cases: null, shipBy: '', dest: '' })
    const other = m.saveOrder(null, { customer: 'Cliente Dos', po: '5501', code: 'E500', cases: 100, shipBy: '', dest: '' })
    const o1 = st().orders.find((o) => o.id === po1)
    clock = oct(10, 14, 0)
    // how the window opens: from the order, Packing in pallets with that order's code and the order in the quick bar
    // (and on each pallet "+ Un pallet" adds); from Terminados or the report, as it always did
    const before = JSON.stringify(st()), copy = JSON.stringify(o1)
    const start = m.laterStart('Packing', o1)
    eq('desde el pedido: Packing, en pallets, el código del pedido y ese pedido; nada más', start, { dept: 'Packing', kind: '', code: '0900', quickPo: po1, oneTakesBar: true })
    eq('desde el pedido, abierto en cualquier cuarto, es de Packing', m.laterStart('RTE', o1).dept, 'Packing')
    eq('sin pedido, como siempre: el cuarto donde se abrió (Kitchen si ninguno), nada escogido, "+ Un pallet" sin pedido', [m.laterStart('Packing'), m.laterStart(undefined)], [{ dept: 'Packing', kind: null, code: '', quickPo: '', oneTakesBar: false }, { dept: 'Kitchen', kind: null, code: '', quickPo: '', oneTakesBar: false }])
    eq('es puro: lo mismo cada vez, sin tocar lo guardado ni el pedido', [m.laterStart('Packing', o1), JSON.stringify(st()) === before, JSON.stringify(o1) === copy], [start, true, true])
    // an order stays on the bar or a pallet only while it is one of the code's: another code sends it back to "Sin pedido"
    eq('el pedido sigue mientras el código es el suyo (0900, 900 y " 0900 " son el mismo); con otro código, o uno que no existe, no', [m.laterPoFits(st(), po1, '0900'), m.laterPoFits(st(), po1, ' 900 '), m.laterPoFits(st(), po2, '0900'), m.laterPoFits(st(), po1, 'E500'), m.laterPoFits(st(), other, '0900'), m.laterPoFits(st(), 'nope', '0900'), m.laterPoFits(st(), '', 'E500')], [true, true, true, false, false, false, true])
    // what was typed: two of 48 with the quick bar (its Pedido as it opened) and one with "+ Un pallet" (it takes the
    // bar's order), its cases and tag typed; one moved to the other order of the code on its row
    const rows = [{ qty: '48', tag: '7001', po: start.quickPo }, { qty: '48', tag: '7002', po: start.quickPo }, { qty: '30', tag: '', po: start.quickPo }, { qty: '40', tag: '7004', po: po2 }]
    eq('la lista se puede guardar', m.checkLaterPallets(rows).ok, true)
    // the line under the title says what goes to the order, from the list and from the bar (review, 2026-10-18: with
    // the bar on "Sin pedido" it said nothing went to it while two pallets on the list carried it, and were saved to it)
    const at = (x) => m.laterToOrder(st(), po1, { byPallet: true, code: '0900', quickPo: po1, list: [], ...x })
    eq('lo que va al pedido: lista vacía y la barra en él; la barra en "Sin pedido" con 2 suyos en la lista; la barra en el otro pedido; nada suyo y la barra en otro',
      [at({}), at({ quickPo: '', list: rows.slice(0, 2) }), at({ quickPo: po2, list: rows }), at({ quickPo: po2, list: rows.slice(3) })],
      [{ listed: 0, next: true }, { listed: 2, next: false }, { listed: 3, next: false }, { listed: 0, next: false }])
    eq('con Bins, otro código o sin pedido, nada va a él (aunque la lista lo tenga: no se guarda con él)', [at({ byPallet: false, list: rows }), at({ code: 'E500', list: rows }), m.laterToOrder(st(), '', { byPallet: true, code: '0900', quickPo: '', list: rows })], [{ listed: 0, next: false }, { listed: 0, next: false }, { listed: 0, next: false }])
    eq('lo que dice que va al pedido es lo que se guarda con él', [at({ list: rows }).listed, m.laterPalletUnits(st(), '0900', '', rows).units.filter((u) => u.po === po1).length, at({ code: ' 900 ', list: rows }).listed], [3, 3, 3])
    const { units, perUnit } = m.laterPalletUnits(st(), start.code, '6300', rows)
    const id = m.addRunLater({ dept: start.dept, lineId: p1.id, code: start.code, lot: '6300', date: DAY, startedAt: oct(10, 9, 0), endedAt: oct(10, 9, 40), units, perUnit })
    const r = st().runs.find((x) => x.id === id)
    eq('se guarda como desde Terminados: cada pallet con su lote, sus cajas, su tag y su pedido', r.units.map((u) => [u.qty, u.ref, u.lots.map((l) => [l.lot, l.qty, l.tag ?? '']), u.po === po1 ? 1 : u.po === po2 ? 2 : u.po ?? '']), [[48, '7001', [['6300', 48, '7001']], 1], [48, '7002', [['6300', 48, '7002']], 1], [30, '', [['6300', 30, '']], 1], [40, '7004', [['6300', 40, '7004']], 2]])
    // what the Pedidos tab shows of each order (it reads the same store): made, what it lacks, its pallets
    const o = (x) => st().orders.find((y) => y.id === x)
    eq('el pedido queda al día en Pedidos: hechas 126, faltan 18, 3 pallets; el otro pedido del código, el suyo; el de otro código, nada', [m.orderMade(st(), po1), o(po1).cases - m.orderMade(st(), po1), m.orderPallets(st(), po1).done.length, m.orderMade(st(), po2), m.orderPallets(st(), po2).done.length, m.orderMade(st(), other)], [126, 18, 3, 40, 1, 0])
    eq('en el historial, con quién y los pedidos', st().changes.filter((c) => c.refKey === id).map((c) => [c.by, c.after]), [['Noelia', '4 pallets · 166 cajas · 9:00 AM – 9:40 AM · lote 6300 · Cliente Uno · PO 4471: 3 pallets · PO 4472: 1 pallet']])
  })
}
section('Un pallet agregado desde la ventana de los pallets de un PO: a una corrida ya registrada de su código, o un registro nuevo')
{
  // Jose, 2026-10-18: "que cuando esté viendo los pedidos y los PO pueda también agregarle otro pallet". The window
  // offers the runs of the order's code this device holds (Packing's pallets: not its bins, not deleted, not another
  // room or code), the newest first; the pallet added to one starts on that order, lands on it and counts
  const fw = await device('powindow', { user: 'Noelia', usual: true })
  fw.use((m) => {
    const st = () => m.store.get(), runOf = (id) => st().runs.find((r) => r.id === id)
    m.role.set('office')
    const lineOf = (dept, name) => { m.addLine(dept, name); return st().lines.find((l) => l.dept === dept && l.name === name) }
    const p1 = lineOf('Packing', 'Línea 1'), p2 = lineOf('Packing', 'Línea 2'), r1 = lineOf('RTE', 'Línea 1')
    clock = oct(10, 5, 0)
    const po = m.saveOrder(null, { customer: 'Cliente Ocho', po: '8801', code: '0950', cases: 144, shipBy: '', dest: '' })
    const other = m.saveOrder(null, { customer: 'Cliente Ocho', po: '8802', code: '950', cases: null, shipBy: '', dest: '' })
    const elsewhere = m.saveOrder(null, { customer: '', po: '8803', code: 'F100', cases: 50, shipBy: '', dest: '' })
    const o = () => st().orders.find((x) => x.id === po)
    // a run of twenty days ago that gave a pallet to the other order: kept apart for it, no longer among this device's runs
    const long = oct(10, 5, 0) - 20 * 86_400_000
    m.applyRemote('act_runs', runRow({ id: 'old-0950', dept: 'Packing', lineId: p1.id, code: '0950', date: m.dayOf(long), startedAt: long, endedAt: long + 3_600_000, units: [{ at: long + 600_000, qty: 36, ref: '4001', by: 'Luis', po: other }], perUnit: 36 }))
    m.prune()
    eq('la vieja queda aparte para su pedido, fuera de las corridas del aparato', [st().runs.some((r) => r.id === 'old-0950'), st().orderRuns.map((r) => r.id)], [false, ['old-0950']])
    clock = oct(10, 12, 0)
    const pal = (tag, order) => ({ qty: 36, ref: tag, lots: [{ lot: '6280', qty: 36, tag }], ...(order ? { po: order } : {}) })
    const early = m.addRunLater({ dept: 'Packing', lineId: p1.id, code: '0950', lot: '6280', date: '2026-10-07', startedAt: oct(7, 9, 0), endedAt: oct(7, 10, 0), units: [pal('5001', po), pal('5002')], perUnit: 36 })
    const today = m.addRunLater({ dept: 'Packing', lineId: p2.id, code: '950', lot: '6283', date: DAY, startedAt: oct(10, 6, 0), endedAt: oct(10, 7, 0), units: [pal('5003')], perUnit: 36 })
    const bins = m.addRunLater({ dept: 'Packing', lineId: p1.id, code: '0950', date: DAY, startedAt: oct(10, 8, 0), endedAt: oct(10, 8, 30), units: [{ qty: 40, ref: '1' }], bin: 'pouches' })
    const gone = m.addRunLater({ dept: 'Packing', lineId: p2.id, code: '0950', date: '2026-10-09', startedAt: oct(9, 9, 0), endedAt: oct(9, 10, 0), units: [pal('5004')], perUnit: 36 })
    m.deleteRun(gone)
    const code2 = m.addRunLater({ dept: 'Packing', lineId: p1.id, code: 'F100', date: DAY, startedAt: oct(10, 10, 0), endedAt: oct(10, 11, 0), units: [pal('5005')], perUnit: 36 })
    const rte = m.addRunLater({ dept: 'RTE', lineId: r1.id, code: '0950', date: DAY, startedAt: oct(10, 9, 0), endedAt: oct(10, 10, 0), units: [{ qty: 240 }], perUnit: 240 })
    clock = oct(10, 13, 0); m.startRun(p1, '0950', '6283', DAY, 36)
    const going = st().runs.find((r) => r.lineId === p1.id && !r.endedAt)?.id
    clock = oct(10, 14, 0)
    eq('todas se guardaron', [early, today, bins, gone, code2, rte, going].every(Boolean), true)
    const before = JSON.stringify(st())
    const list = m.orderAddRuns(st(), o())
    eq('las corridas del código del pedido en este aparato, la más nueva primero (la que corre también), con sus pallets y los de este PO; no los bins, ni la borrada, ni otro código, ni otro cuarto, ni la vieja guardada aparte', list.map((x) => [x.r.id, x.r.endedAt === null, x.pallets, x.toOrder]), [[going, true, 0, 0], [today, false, 1, 0], [early, false, 2, 1]])
    eq('es puro: no toca lo guardado; el otro pedido del mismo código ("950") da las mismas corridas, con lo suyo', [JSON.stringify(st()) === before, m.orderAddRuns(st(), st().orders.find((x) => x.id === other)).map((x) => [x.r.id, x.toOrder])], [true, [[going, 0], [today, 0], [early, 0]]])
    eq('un código sin corridas de pallets en este aparato: ninguna (solo un registro nuevo); el de F100, la suya', [m.orderAddRuns(st(), { id: 'x', code: 'Z999' }), m.orderAddRuns(st(), st().orders.find((x) => x.id === elsewhere)).map((x) => x.r.id)], [[], [code2]])
    // "Agregar pallet" starts on the order only when it is one its Pedido offers: an order of the run's code, on a run that fills orders
    eq('el Pedido empieza en ese pedido; nunca en uno de otro código, en una corrida de bins o de otro cuarto, en uno que no existe, ni sin pedido', [m.unitStartPo(st(), runOf(today), po), m.unitStartPo(st(), runOf(today), other), m.unitStartPo(st(), runOf(today), elsewhere), m.unitStartPo(st(), runOf(bins), po), m.unitStartPo(st(), runOf(rte), po), m.unitStartPo(st(), runOf(today), 'nope'), m.unitStartPo(st(), runOf(today)), m.unitStartPo(st(), runOf(today), '')], [po, other, '', '', '', '', '', ''])
    // and its lot starts as the run's only when the run has touched no other lot (unitStartLot): a fact, never a guess
    eq('el lote empieza en el único lote que la corrida tiene (en la que corre, el suyo)', [m.unitStartLot(st(), runOf(early)), m.unitStartLot(st(), runOf(going))], ['6280', '6283'])
    // the run of today, chosen in the window: a pallet found with its tag at 6:30, and with "Agregar y otro" one more at
    // 6:45, both with the order the window started on (it stays for the next one, as it was chosen)
    const start = m.unitStartPo(st(), list[1].r, po)
    const a1 = m.addUnit(today, { at: m.nearDay(runOf(today).startedAt, '06:30'), qty: null, lots: [{ lot: '6283', qty: 36, tag: '5101' }], po: start })
    const a2 = m.addUnit(today, { at: m.nearDay(runOf(today).startedAt, '06:45'), qty: null, lots: [{ lot: '6283', qty: 30, tag: '5102' }], po: start })
    eq('los dos quedan en la corrida a su hora, con sus cajas, su tag y ese pedido', [a1, a2, runOf(today).units.map((u) => [u.at, u.qty, u.ref, u.po === po])], [oct(10, 6, 30), oct(10, 6, 45), [[oct(10, 6, 30), 36, '5101', true], [oct(10, 6, 45), 30, '5102', true], [oct(10, 7, 0), 36, '5003', false]]])
    eq('el pedido los cuenta: hechas 102, faltan 42, 3 pallets (el de otro día también); el otro pedido del código sigue con el suyo', [m.orderMade(st(), po), o().cases - m.orderMade(st(), po), m.orderPallets(st(), po).done, m.orderMade(st(), other), m.orderPallets(st(), other).done.length], [102, 42, [oct(7, 9, 30), oct(10, 6, 30), oct(10, 6, 45)], 36, 1])
    // what the PO window lists (it reads the same store): the pallets of the order, the two new ones among them
    eq('la ventana del PO los muestra al momento, con su corrida y su hora', m.orderRunsOf(st(), po).flatMap((r) => r.units.filter((u) => u.po === po).map((u) => [r.id === today ? 'hoy' : r.id === early ? 'antes' : r.id, u.at])).sort((x, y) => x[1] - y[1]), [['antes', oct(7, 9, 30)], ['hoy', oct(10, 6, 30)], ['hoy', oct(10, 6, 45)]])
    eq('y la lista para escoger corrida ya dice 3 pallets, 2 de este PO', m.orderAddRuns(st(), o()).map((x) => [x.r.id, x.pallets, x.toOrder])[1], [today, 3, 2])
    eq('con dos lotes en sus pallets (6283 y 6280), la lista dice los dos y el lote del pallet siguiente empieza vacío, para escribirlo', [[...m.runLots(st(), runOf(today))].sort(), m.unitStartLot(st(), runOf(today))], [['6280', '6283'], ''])
    eq('en el historial, con quién y el pedido', st().changes.filter((c) => c.refKey === today && c.what.includes('Se agregó pallet')).map((c) => [c.by, c.what.split(' · ').pop(), c.after]), [['Noelia', 'Se agregó pallet 1 (6:30 AM)', '36 cajas · 6283: 36 (tag 5101) · Cliente Ocho · PO 8801'], ['Noelia', 'Se agregó pallet 2 (6:45 AM)', '30 cajas · 6283: 30 (tag 5102) · Cliente Ocho · PO 8801']])
    // on the run still running: the pallet goes in, and the pallet being built on the line is not touched
    const open = JSON.stringify(runOf(going).extra ?? null)
    m.addUnit(going, { at: m.nearDay(runOf(going).startedAt, '13:20'), qty: null, lots: [{ lot: '6283', qty: 36, tag: '5201' }], po: m.unitStartPo(st(), runOf(going), po) })
    eq('en la que corre también: el pedido lo cuenta, y lo que la línea arma sigue igual', [m.orderMade(st(), po), runOf(going).endedAt, JSON.stringify(runOf(going).extra ?? null) === open], [138, null, true])
    // and it goes up as it is: what another tablet gets is the same pallets, with their order, on the same runs
    const up = (id) => m.outbox.items().find((i) => i.table === 'act_runs' && i.key === id)?.row.units.map((u) => [u.ref, u.po === po])
    eq('sube al servidor cada corrida con sus pallets y su pedido', [up(today), up(going)], [[['5101', true], ['5102', true], ['5003', false]], [['5201', true]]])
    // the line goes on to its next lot while the code runs (review, 2026-10-18): its first lot is no longer the pallet's
    m.setLotNow(going, '6290')
    eq('la que corre pasó al lote 6290: la lista dice los dos, y el lote del pallet ya no empieza en el primero', [[...m.runLots(st(), runOf(going))], m.unitStartLot(st(), runOf(going))], [['6283', '6290'], ''])
  })
}
section('Un comentario en un registro agregado después: se guarda, se ve, se busca, va al Excel y se corrige en Corregir')
{
  // Jose, 2026-10-18, on a photo of "Agregar un registro · Packing": "Puedes también poner aquí una casilla para poner
  // comentarios por favor". The comment is kept in the run's extra (act_runs.extra, a jsonb column the server already
  // has), written only by a person: when the record is added, or in Corregir
  const nt = await device('nota', { user: 'Noelia', usual: true })
  const said = 'Se hizo en la línea 1: la 2 estaba parada'
  const ids = nt.use((m) => {
    const st = () => m.store.get(), runOf = (id) => st().runs.find((r) => r.id === id)
    m.role.set('office')
    m.addLine('Packing', 'Línea 1'); m.addLine('MFO', 'Línea 1'); m.addLine('RTE', 'Línea 1')
    const line = (dept) => st().lines.find((l) => l.dept === dept)
    clock = oct(10, 14, 0)
    const pal = (tag) => ({ qty: 36, ref: tag, lots: [{ lot: '6283', qty: 36, tag }] })
    // typed on two lines and with spaces around it: kept on one line, as it reads
    const id = m.addRunLater({ dept: 'Packing', lineId: line('Packing').id, code: 'A100', lot: '6283', date: DAY, startedAt: oct(10, 9, 0), endedAt: oct(10, 10, 0), units: [pal('7001'), pal('7002')], perUnit: 36, note: '  Se hizo en la línea 1:\n  la 2 estaba parada  ' })
    const r = runOf(id)
    eq('el comentario queda en la corrida, en una línea y sin espacios de más; sus pallets siguen siendo pallets que llenan pedidos', [r.extra, m.noteOf(r), !!m.cfgOf(r).orders, r.units.map((u) => u.ref)], [{ note: said }, said, true, ['7001', '7002']])
    eq('y en la línea del historial de quien lo agregó', st().changes.filter((c) => c.refKey === id).map((c) => [c.by, c.what.split(' · ').pop(), c.after]), [['Noelia', 'Se agregó después', m.madeText(r, m.runQty(st(), r)) + ' · 9:00 AM – 10:00 AM · lote 6283 · Comentario: ' + said]])
    // blank, or only spaces: no comment at all (the app puts nothing in)
    const none = m.addRunLater({ dept: 'RTE', lineId: line('RTE').id, code: 'B200', date: DAY, startedAt: oct(10, 9, 0), endedAt: oct(10, 10, 0), units: [{ qty: 240 }], note: '   ' })
    eq('en blanco: la corrida no lleva comentario, ni su historial', ['extra' in runOf(none), m.noteOf(runOf(none)), st().changes.find((c) => c.refKey === none).after.includes('Comentario')], [false, '', false])
    // MFO's bins of platos with a comment: both are kept; one longer than the box takes is cut where the box cuts
    const mf = m.addRunLater({ dept: 'MFO', lineId: line('MFO').id, code: 'M100', date: DAY, startedAt: oct(10, 11, 0), endedAt: oct(10, 11, 30), units: [{ qty: 30, ref: '1' }], bin: 'platos', note: 'x'.repeat(400) })
    eq('con los bins: los dos quedan; de más de 300 caracteres quedan 300', [m.binOf(runOf(mf)), m.noteOf(runOf(mf)).length, m.NOTE_MAX], ['platos', 300, 300])
    eq('sube al servidor con la corrida', m.outbox.items().find((i) => i.table === 'act_runs' && i.key === id).row.extra, { note: said })
    // the report: the run's line, the Excel's Resumen (its last column) and the search
    const rep = m.reportOf(st(), DAY, clock)
    eq('el reporte lo trae en la corrida', rep.rows.filter((x) => x.r.id === id).map((x) => m.noteOf(x.r)), [said])
    const sheet = m.runsSheet(st(), rep)
    eq('el Excel (Resumen): la columna Comentario, la última, con el comentario tal cual; sin comentario, vacía', [sheet[0].length, sheet[0].at(-1), sheet.slice(1).map((row) => [row[2], row.length, row.at(-1)])], [21, 'Comentario', [['A100', 21, said], ['B200', 21, ''], ['M100', 21, 'x'.repeat(300)]]])
    const found = (q) => m.searchReport(st(), rep, q).hits.filter((h) => h.kind === 'run').map((h) => h.runId)
    eq('la búsqueda encuentra la corrida por su comentario (sin acentos ni mayúsculas, palabra por palabra)', [found('estaba parada'), found('LINEA 1 PARADA'), found('parada B200')], [[id], [id], []])
    // Corregir: it opens with the comment, which is corrected like the rest and has its line in the history
    const opened = m.draftOf(runOf(id))
    eq('Corregir abre con el comentario', opened.note, said)
    clock = oct(10, 14, 5)
    m.applyDraft(id, opened, { ...opened, note: 'Tags 7001 & 7002 <revisar>' })
    const lines = () => st().changes.filter((c) => c.refKey === id && c.what.endsWith(' · Comentario')).map((c) => [c.by, c.what, c.before, c.after])
    eq('se corrige: queda el nuevo, y el historial dice antes → después', [m.noteOf(runOf(id)), lines()], ['Tags 7001 & 7002 <revisar>', [['Noelia', 'Corrida A100 del ' + DAY + ' (Packing, Línea 1) · Comentario', said, 'Tags 7001 & 7002 <revisar>']]])
    eq('y va a otra tablet', m.outbox.items().find((i) => i.table === 'act_runs' && i.key === id).row.extra, { note: 'Tags 7001 & 7002 <revisar>' })
    clock = oct(10, 14, 6)
    const o2 = m.draftOf(runOf(id)); m.applyDraft(id, o2, { ...o2, lot: '6284' })
    const { note: _n, ...bare } = m.draftOf(runOf(id)); m.applyDraft(id, bare, { ...bare, lot: '6285' })
    m.addUnit(id, { at: oct(10, 9, 50), qty: null, lots: [{ lot: '6283', qty: 30, tag: '7003' }] })
    eq('corregir otra cosa (también desde un formulario sin el comentario) o agregar un pallet no lo toca', [runOf(id).lot, runOf(id).units.length, m.noteOf(runOf(id)), lines().length], ['6285', 3, 'Tags 7001 & 7002 <revisar>', 1])
    // a run without a comment: saving Corregir with the box empty adds nothing; typing one adds it
    const n0 = m.draftOf(runOf(none)); m.applyDraft(none, n0, { ...n0, note: '  ' })
    eq('sin comentario y la casilla vacía: nada cambia', ['extra' in runOf(none), m.outbox.items().filter((i) => i.key === none).length], [false, 1])
    const n1 = m.draftOf(runOf(none)); m.applyDraft(none, n1, { ...n1, note: 'Agregado por la oficina' })
    eq('escrito en Corregir, queda', m.noteOf(runOf(none)), 'Agregado por la oficina')
    return { id, none, mf, sheet: m.runsSheet(st(), m.reportOf(st(), DAY, clock)) }
  })
  // the Excel file itself: the comment is an inline text of the Resumen sheet, with its signs written as XML wants them
  const z = await nt.use(async (m) => m.loadZip())
  const bytes = await nt.use(async (m) => m.xlsxBytes([{ name: 'Resumen', rows: ids.sheet }]))
  const xml = z.strFromU8(z.unzipSync(bytes)['xl/worksheets/sheet1.xml'])
  eq('en el archivo de Excel: el encabezado y el comentario, como texto, con & y < bien escritos', [xml.includes('<t xml:space="preserve">Comentario</t>'), xml.includes('<t xml:space="preserve">Tags 7001 &amp; 7002 &lt;revisar&gt;</t>'), xml.includes('<t xml:space="preserve">Agregado por la oficina</t>')], [true, true, true])
  nt.use((m) => {
    const st = () => m.store.get(), runOf = (id) => st().runs.find((r) => r.id === id)
    // cleared in Corregir (a minute and a half later: its own line in the history). The run keeps the key, empty
    clock = oct(10, 14, 10)
    const o = m.draftOf(runOf(ids.id)); m.applyDraft(ids.id, o, { ...o, note: '' })
    eq('borrado en Corregir: la corrida queda sin comentario (la marca vacía se guarda), y el historial lo dice', [runOf(ids.id).extra, m.noteOf(runOf(ids.id)), st().changes.filter((c) => c.refKey === ids.id && c.what.endsWith(' · Comentario')).map((c) => [c.before, c.after])], [{ note: '' }, '', [[said, 'Tags 7001 & 7002 <revisar>'], ['Tags 7001 & 7002 <revisar>', '']]])
    eq('y ya no se encuentra por él, ni sale en el Excel', [m.searchReport(st(), m.reportOf(st(), DAY, clock), 'revisar').hits.filter((h) => h.kind === 'run').length, m.runsSheet(st(), m.reportOf(st(), DAY, clock))[1].at(-1)], [0, ''])
  })
  // the app opened again (a reload, an update): every comment is read back, the cleared one as cleared
  const stored = nt.use(() => JSON.parse(localStorage.getItem('act_v1')))
  const again = await device('nota-otra-vez', { seed: stored, user: 'Noelia' })
  again.use((m) => {
    const r = (id) => m.store.get().runs.find((x) => x.id === id)
    eq('al volver a abrir la app, los comentarios siguen (el borrado, como borrado)', [r(ids.id).extra, m.noteOf(r(ids.none)), m.noteOf(r(ids.mf)), m.binOf(r(ids.mf))], [{ note: '' }, 'Agregado por la oficina', 'x'.repeat(300), 'platos'])
  })
}
section('El comentario no se pierde cuando otra tablet cambia la misma corrida, ni con una versión de la app de antes')
{
  // Two tablets change the same run from the same version: the office writes a comment in Corregir while the line's
  // tablet, without signal, puts a lot on the pallet it builds. The comment merges on its own, apart from the rest of
  // the extra: each one's change is kept, whichever reaches the server first
  const line = await device('nota-linea', { user: 'Lucía' }), office = await device('nota-oficina', { user: 'Jose' })
  const both = [line, office]
  const settle2 = () => { for (let n = 0; n < 20; n++) { if (!both.some((d) => first(d))) return; for (const d of both) send(d, both) } throw new Error('las dos tablets no terminan de ponerse de acuerdo') }
  const runAt = (d, id) => d.use((m) => m.store.get().runs.find((r) => r.id === id))
  const look = (r) => ({ note: r.extra?.note, open: r.extra?.open?.parts.map((p) => [p.lot, p.qty, p.tag]) ?? [], lotNow: r.extra?.lotNow ?? '', pallets: r.units.map((u) => u.ref), lot: r.lot })
  const agree = (what, id, want) => {
    eq(what + ' · línea', look(runAt(line, id)), want)
    eq(what + ' · oficina', look(runAt(office, id)), want)
    const sv = server.get('act_runs|' + id)
    eq(what + ' · servidor', look({ extra: sv.extra ?? undefined, units: sv.units, lot: sv.lot }), want)
    eq(what + ' · nada pendiente', both.map((d) => d.use((m) => m.outbox.size())), [0, 0])
  }
  const fix = (d, id, patch) => d.use((m) => { const o = m.draftOf(m.store.get().runs.find((r) => r.id === id)); m.applyDraft(id, o, { ...o, ...patch }) })
  const hearServer = (d, id) => d.use((m) => m.applyRemote('act_runs', server.get('act_runs|' + id)))
  clock = oct(10, 6, 0)
  line.use((m) => { m.addLine('Packing', 'Línea 1'); m.startRun(m.store.get().lines[0], 'A100', '6283', DAY, 36) })
  const id = line.use((m) => m.store.get().runs[0].id)
  clock = oct(10, 6, 30); line.use((m) => m.palletDone(id, [{ lot: '6283', qty: 36, tag: '3100' }], ''))
  settle2()
  // the office's version reaches the server first; the line comes back, merges its change into it and sends it
  clock = oct(10, 7, 0); fix(office, id, { note: 'Pallet 1 sin film' })
  clock = oct(10, 7, 5); line.use((m) => m.palletLotEnds(id, 20, '3101', '6284'))
  send(office, [office])
  hearServer(line, id); settle2()
  agree('el comentario de la oficina y el lote del pallet que arma la línea quedan los dos', id, { note: 'Pallet 1 sin film', open: [['6283', 20, '3101']], lotNow: '6284', pallets: ['3100'], lot: '6283' })
  // the other order: the line's version first; the office merges its comment into it
  clock = oct(10, 8, 0); line.use((m) => m.palletDone(id, [{ lot: '6283', qty: 20, tag: '3101' }, { lot: '6284', qty: 16, tag: '3102' }], '')); settle2()
  clock = oct(10, 8, 10); line.use((m) => m.palletLotEnds(id, 12, '3103', '6285'))
  clock = oct(10, 8, 12); fix(office, id, { note: 'Pallet 1 sin film; pallet 2 revisado' })
  send(line, [line])
  hearServer(office, id); settle2()
  agree('al revés también: el lote nuevo de la línea y el comentario corregido', id, { note: 'Pallet 1 sin film; pallet 2 revisado', open: [['6284', 12, '3103']], lotNow: '6285', pallets: ['3100', '3101, 3102'], lot: '6283' })
  clock = oct(10, 9, 0); line.use((m) => m.endRun(id, false)); settle2()
  const note = 'Pallet 1 sin film; pallet 2 revisado'
  // A tablet still on the build of before comments (until it updates by itself, a few minutes) adds a pallet in
  // Corregir: it writes the run as it knows it, without the comment (those builds drop what they do not know)
  const oldWrite = (at, tag) => {
    const was = server.get('act_runs|' + id), { note: _gone, ...known } = was.extra ?? {}
    const row = { ...was, units: [...was.units, { at, qty: 36, ref: tag, by: 'Tablet vieja', lots: [{ lot: '6285', qty: 36, tag }] }].sort((a, b) => a.at - b.at), extra: Object.keys(known).length ? known : null, updated_at: iso(clock), updated_by: 'Tablet vieja' }
    land({ table: 'act_runs', key: id, row })
  }
  clock = oct(10, 9, 30); fix(office, id, { lot: '6290' }) // the office corrects the lot, without signal yet
  oldWrite(oct(10, 8, 50), '3104')
  hearServer(line, id)
  eq('la tablet de la línea, que no cambió nada, toma la versión del servidor tal cual y no escribe nada', [look(runAt(line, id)).note, look(runAt(line, id)).pallets.length, line.use((m) => m.outbox.size())], [undefined, 4, 0])
  hearServer(office, id); settle2()
  agree('la oficina, que tenía un cambio suyo, lo junta con esa versión: el comentario vuelve, y quedan el pallet de la tablet vieja y su lote', id, { note, open: [], lotNow: '6285', pallets: ['3100', '3101, 3102', '3104', '3103'], lot: '6290' })
  // a comment cleared on purpose is not brought back by a merge
  clock = oct(10, 10, 0); line.use((m) => m.addUnit(id, { at: oct(10, 8, 55), qty: null, lots: [{ lot: '6285', qty: 10, tag: '3105' }] }))
  clock = oct(10, 10, 1); fix(office, id, { note: '' }); send(office, [office])
  hearServer(line, id); settle2()
  agree('borrado en una, con otro cambio en la otra: queda borrado, y el pallet también queda', id, { note: '', open: [], lotNow: '6285', pallets: ['3100', '3101, 3102', '3104', '3105', '3103'], lot: '6290' })
  // What is left: an old build's write that NO tablet with this build merges (nobody had a change of that run waiting)
  // leaves the run without it everywhere. The history still says it, word for word
  clock = oct(10, 12, 0); fix(office, id, { note }); settle2()
  clock = oct(10, 12, 30); oldWrite(oct(10, 8, 58), '3106'); hearServer(line, id); hearServer(office, id); settle2()
  eq('una escritura de la versión de antes que nadie junta: la corrida queda sin comentario, pero el historial lo guarda', [look(runAt(office, id)).note, look(runAt(line, id)).note, server.get('act_runs|' + id).extra?.note, office.use((m) => m.store.get().changes.filter((c) => !c.deleted && c.refKey === id && c.what.endsWith(' · Comentario')).map((c) => c.after).at(-1))], [undefined, undefined, undefined, note])
}
section('Un código y su lote que siguen al día siguiente: Avance dice lo pendiente, o completado')
{
  // what Jose confirmed on 2026-10-16: Packing had 100 cases of a code on Wednesday's program and made 60; on Thursday
  // they went on with Wednesday's lot. Wednesday's Avance says what was pending and whether Thursday finished it, in
  // each room's own unit; Thursday's says what came from Wednesday's lot.
  const cy = await device('carry', { user: 'Oficina', usual: true })
  cy.use((m) => {
    const st = () => m.store.get(), wed = '2026-10-14', thu = '2026-10-15', lotWed = m.lotFor(wed)
    m.addLine('Packing', 'Línea 1'); m.addLine('Kitchen', 'Braiser 1')
    const pl = st().lines.find((l) => l.dept === 'Packing'), kl = st().lines.find((l) => l.dept === 'Kitchen')
    m.setPlan(wed, 'Packing', 'A100', 100); m.setPlan(wed, 'Kitchen', 'A100', 10)
    // Wednesday: 60 cases and 6 mezclas
    clock = oct(14, 8, 0); m.startRun(pl, 'A100', lotWed, wed, 20); m.startRun(kl, 'A100', lotWed, wed, null)
    for (let i = 1; i <= 3; i++) { clock = oct(14, 8 + i, 0); m.unitDone(st().runs.find((r) => r.lineId === pl.id && r.date === wed).id, 20) }
    for (let i = 1; i <= 6; i++) { clock = oct(14, 8, i * 5); m.unitDone(st().runs.find((r) => r.lineId === kl.id && r.date === wed).id, null) }
    clock = oct(14, 14, 0); for (const r of st().runs.filter((r) => !r.endedAt)) m.endRun(r.id, false)
    eq('el miércoles quedaron pendientes 40 cajas y 4 mezclas, y el jueves todavía no hizo nada', m.carriedOver(st(), wed).map((x) => [x.dept, x.code, x.unit, x.pending, x.made, x.next, x.done]), [['Kitchen', 'A100', 'mezclas', 4, 0, thu, false], ['Packing', 'A100', 'cajas', 40, 0, thu, false]])
    // Thursday: they go on with Wednesday's lot: 2 pallets of 20 (the second with cases of two lots), 4 mezclas
    clock = oct(15, 7, 0); m.startRun(pl, 'A100', lotWed, thu, 20); m.startRun(kl, 'A100', lotWed, thu, null)
    const pr = () => st().runs.find((r) => r.lineId === pl.id && r.date === thu), kr = () => st().runs.find((r) => r.lineId === kl.id && r.date === thu)
    clock = oct(15, 8, 0); m.unitDone(pr().id, 20)
    clock = oct(15, 9, 0); m.unitDone(pr().id, 20, '1800', [{ lot: lotWed, qty: 15 }, { lot: m.lotFor(thu), qty: 5 }])
    for (let i = 1; i <= 4; i++) { clock = oct(15, 7, i * 5); m.unitDone(kr().id, null) }
    eq('el jueves hizo 35 cajas del lote del miércoles (del pallet mixto solo las 15 de ese lote) y las 4 mezclas', m.carriedOver(st(), wed).map((x) => [x.dept, x.pending, x.made, x.done]), [['Kitchen', 4, 4, true], ['Packing', 40, 35, false]])
    eq('y el jueves dice lo que vino del lote del miércoles, en la unidad de cada cuarto', m.cameFrom(st(), thu).map((x) => [x.dept, x.code, x.unit, x.made, x.from]), [['Kitchen', 'A100', 'mezclas', 4, wed], ['Packing', 'A100', 'cajas', 35, wed]])
    eq('un día sin nada pendiente ni nada de ayer no dice nada', [m.carriedOver(st(), thu), m.cameFrom(st(), wed)], [[], []])
  })
}
section('Códigos dejados corriendo de noche: el reloj se pausa cuando nadie registra nada, y nada se termina solo')
{
  // what Jose saw on 2026-10-16 at 2:33 AM, with nobody in the plant: "Turno 2 · 11:32:43 · desde las 3:00 PM" in
  // Packing and Spiral, codes left running since the second shift (which ends at 1:00 AM). The hours between shifts
  // with nothing recorded were already set aside, but only once over (at 6:00 AM); the live clock ran until then.
  const nt = await device('night', { user: 'Luis', usual: true })
  nt.use((m) => {
    const st = () => m.store.get(), min = (x) => Math.round(x / M), run = () => st().runs.find((r) => r.code === 'A100')
    m.addLine('Packing', 'Línea 1'); const l = st().lines.find((x) => x.dept === 'Packing')
    clock = oct(10, 16, 0); m.startRun(l, 'A100', '6283', DAY, 36)
    for (const h of [17, 19, 21, 23]) { clock = oct(10, h, 0); m.unitDone(run().id, 36) }
    // 1:30 AM: half an hour past the shift's end, nothing recorded: still counting (they may be about to)
    clock = oct(11, 1, 30)
    eq('media hora después de la 1:00 AM sin registros, todavía cuenta', [min(m.runStats(st(), run(), clock).working), m.deptToday(st(), 'Packing', DAY, clock).paused], [570, 0])
    // 2:33 AM: over an hour with nothing recorded: the time since 1:00 AM is set aside, the clock waits at 1:00 AM
    clock = oct(11, 2, 33)
    const t = m.deptToday(st(), 'Packing', DAY, clock)
    eq('a las 2:33 AM, con más de una hora sin registros, el tiempo desde la 1:00 AM no cuenta y el reloj del turno espera ahí', [min(m.runStats(st(), run(), clock).working), t.paused === oct(11, 1, 0), min(t.shiftMs), run().endedAt], [540, true, 540, null])
    eq('en el reporte igual: 9 horas trabajando, no 10 y media', min(m.reportOf(st(), DAY, clock, { only: 'Packing' }).working), 540)
    // 2:50 AM: a pallet is recorded after all: somebody was there, the whole stretch counts again
    clock = oct(11, 2, 50); m.unitDone(run().id, 36)
    clock = oct(11, 3, 0)
    eq('un registro a las 2:50 AM trae todo el rato de vuelta: 11 horas', [min(m.runStats(st(), run(), clock).working), m.deptToday(st(), 'Packing', DAY, clock).paused], [660, 0])
  })
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
      ['Packing', 'A100', 2, 100, [['6283', 2, 80, [50, 30]], ['6284', 0, 20, [0, 20]]]]])
    eq('los lotes de un código suman el código, y los códigos suman el departamento', [day.byCode.map((c) => c.lots.reduce((t, l) => t + l.qty, 0) === c.qty), day.byDept.map((d) => day.byCode.filter((c) => c.dept === d.dept).reduce((t, c) => t + c.qty, 0) === d.qty), day.byDept.map((d) => { const b = day.byShift.find((x) => x.dept === d.dept); return b.first.qty + b.second.qty === d.qty && b.day.qty === d.qty })], [[true, true, true], [true, true], [true, true]])
    eq('el parado, causa por causa, de mayor a menor: juntas son el total de Parado', [day.reasons.map((x) => [x.reason, min(x.ms)]), day.reasons.reduce((t, x) => t + x.ms, 0) === day.down], [[['Problema mecánico', 20], ['Break', 10]], true])
    const two = m.reportOf(st(), DAY, clock, { shift: 2 })
    eq('con el turno 2: lo de ese turno solo, en los números grandes, en los lotes y en las causas', [two.byDept.map(dept), two.byCode.map(codeLots), two.reasons.map((x) => [x.reason, min(x.ms)]), two.byShift.length], [[['RTE', 3, 4, 728], ['Packing', 1, 1, 50]], [
      ['RTE', 'A100', 2, 440, [['6283', 1, 240, null], ['6284', 1, 200, null]]],
      ['RTE', 'B200', 2, 288, [['6283', 2, 288, null]]],
      ['Packing', 'A100', 1, 50, [['6283', 1, 30, null], ['6284', 0, 20, null]]]], [['Problema mecánico', 20]], 0])
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

section('Buscar en el reporte')
{
  // one Packing run of A100 with twelve pallets (the second with two lots, each with its tag, for a PO), and an RTE run
  // of 0100, lot 6123, recorded by Ana: a cart in each shift and a mechanical stop with a note. No pallet is recorded at
  // a minute 12, so "12" can only be pallet 12 (or a unit 12).
  const bus = await device('bus', { user: 'Nino' })
  bus.use((m) => {
    const st = () => m.store.get()
    clock = T0
    m.addLine('Packing', 'Línea 1')
    const pack = st().lines.find((l) => l.dept === 'Packing')
    m.startRun(pack, 'A100', '6283', DAY, 36)
    const pr = () => st().runs.find((r) => r.code === 'A100')
    const po = m.saveOrder(null, { customer: 'Cliente A', po: '4500011', code: 'A100', cases: 72, shipBy: '2026-10-15', dest: '' })
    clock = T0 + 1 * M; m.unitDone(pr().id, 36, '1749')
    clock = T0 + 2 * M; m.unitDone(pr().id, 0, '', [{ lot: '6283', qty: 20, tag: '1750' }, { lot: '6284', qty: 16, tag: '1751' }], po)
    for (let n = 3; n <= 12; n++) { clock = T0 + (n === 12 ? 13 : n) * M; m.unitDone(pr().id, 36, String(2000 + n)) }
    m.user.set('Ana')
    clock = T0 + 3 * M; m.addLine('RTE', 'Línea 2')
    const rte = st().lines.find((l) => l.dept === 'RTE')
    m.startRun(rte, '0100', '6123', DAY, 240)
    const rr = () => st().runs.find((r) => r.code === '0100')
    clock = T0 + 5 * M; m.unitDone(rr().id, 240) // 3:05 PM, the first shift
    clock = T0 + 20 * M; m.startStop('RTE', rte.id, 'Problema mecánico', 'banda floja')
    clock = T0 + 25 * M; m.endStop(st().stops.find((x) => !x.endedAt).id)
    clock = T0 + 30 * M; m.unitDone(rr().id, 240) // 3:30 PM, the second shift
    clock = T0 + 40 * M
    const rep = m.reportOf(st(), DAY, clock), pid = pr().id, rid = rr().id
    const find = (q, r = rep) => m.searchReport(st(), r, q, [], clock)
    const of = (q, kind, r) => find(q, r).hits.filter((h) => h.kind === kind).map((h) => h.key)
    eq('el tag del segundo lote de un pallet encuentra ese pallet, y la unidad de ese lote (no la del otro lote)', [of('1751', 'pallet'), find('1751').keys.has(m.hitKey.unit(pid, 1, '6284')), find('1751').keys.has(m.hitKey.unit(pid, 1, '6283'))], [[m.hitKey.pallet(pid, 2)], true, false])
    eq('"12" es el pallet 12, nunca el lote 6123 ni el tag 1749', [of('12', 'pallet'), of('12', 'run'), find('12').hits.some((h) => h.kind === 'unit' && h.runId === rid)], [[m.hitKey.pallet(pid, 12)], [], false])
    eq('un número corto es una palabra entera: "61" no encuentra el lote 6123, "612" sí', [find('61').hits.length, of('612', 'run'), of('612', 'unit').length], [0, [m.hitKey.run(rid)], 2])
    eq('la causa se encuentra sin acentos, en mayúsculas y en inglés; y por su detalle', ['mecanico', 'MECÁNICO', 'mechanical', 'banda'].map((q) => of(q, 'stop').length), [1, 1, 1, 1])
    eq('cada palabra tiene que estar: "A100 6284" trae solo lo que lleva las dos', [find('A100 6284').hits.map((h) => h.kind), of('A100 6284', 'pallet'), find('A100 9999').hits.length], [['code', 'pallet', 'unit', 'run'], [m.hitKey.pallet(pid, 2)], 0])
    eq('el PO encuentra sus pallets', of('4500011', 'pallet'), [m.hitKey.pallet(pid, 2)])
    eq('el nombre de quien registró encuentra sus unidades y su corrida', [of('ana', 'unit').length, of('ana', 'run'), find('ana').hits.some((h) => h.runId === pid)], [2, [m.hitKey.run(rid)], false])
    const one = m.reportOf(st(), DAY, clock, { shift: 1 })
    eq('con el turno 1 no se encuentra el carro del turno 2; con el día completo, sí', [of('3:30', 'unit', one).length, of('3:30', 'unit').length], [0, 1])
    const scopes = (q, r = rep) => find(q, r).scopes
    eq('"0100" y "100" ofrecen ver solo el código 0100; un lote exacto, ese lote; el nombre de una línea, esa línea; un departamento, ese', [scopes('0100'), scopes('100'), scopes('6283'), scopes('línea 2'), scopes('RTE Línea 2'), scopes('packing')], [[{ kind: 'code', value: '0100' }], [{ kind: 'code', value: '0100' }], [{ kind: 'lot', value: '6283' }], [{ kind: 'line', value: rte.id }], [{ kind: 'line', value: rte.id }], [{ kind: 'dept', value: 'Packing' }]])
    eq('no se ofrece lo que ya es el filtro', [scopes('100', m.reportOf(st(), DAY, clock, { code: '0100' })), scopes('6283', m.reportOf(st(), DAY, clock, { lot: '6283' }))], [[], []])
    eq('una búsqueda vacía no trae nada', [find('').hits, find('').keys.size, find('').scopes, find('   ').hits, find('   ').keys.size, find('   ').scopes], [[], 0, [], [], 0, []])
    eq('cada pallet se encuentra por su tag, con la misma llave que usa la tabla', rep.pallets.map((p) => find(p.parts[0].tag).keys.has(m.hitKey.pallet(p.r.id, p.n))), rep.pallets.map(() => true))
    eq('los cambios del día también, para quien los ve', m.searchReport(st(), rep, 'Pedido nuevo', st().changes, clock).hits.map((h) => h.kind), ['change'])
    eq('los lotes de una corrida: los de sus unidades', [...m.runLots(st(), pr())].sort(), ['6283', '6284'])
  })
}

section('Al volver a abrir, cada línea, corrida y paro recuerda el sello del servidor: un aviso atrasado no vuelve a abrir lo terminado (auditoría 2026-10-17, S8)')
{
  // The stamp the server gives each version (synced_at) is what tells a late echo of an older version from news. It
  // was saved on the device but not read back: after any reload (a new version, the language, a reload by hand) a
  // page of a pull that came late could open again a code the tablet had just ended, and send it open to the server
  const again = async (name, tag) => { on = name; const m = await import(bundle + '?' + name + '-' + tag); return { name, use: (fn) => { on = name; return fn(m) } } }
  clock = T0 + 600 * M
  let rl = await device('rl', { user: 'Nino' })
  const v1 = { ...runRow({ id: 'R8', lineId: 'L8', line: 'Línea 8', startedAt: clock - 60 * M, units: [unit(clock - 50 * M, 240)], perUnit: 240, updatedAt: clock - 50 * M }), synced_at: iso(clock - 50 * M + 500) }
  const l1 = { id: 'L8', dept: 'RTE', name: 'Línea 8', deleted: false, updated_at: iso(clock - 90 * M), updated_by: 'x', synced_at: iso(clock - 90 * M + 500) }
  const s1 = { ...stopRow({ id: 'S8', lineId: 'L8', startedAt: clock - 40 * M, reason: 'Break' }), synced_at: iso(clock - 40 * M + 500) }
  rl.use((m) => { m.applyRemote('act_lines', l1); m.applyRemote('act_runs', v1); m.applyRemote('act_stops', s1) })
  rl = await again('rl', 'reabierta')
  const held = (m) => { const s = m.store.get(); return [s.lines.find((l) => l.id === 'L8')?.syncedAt, s.runs.find((r) => r.id === 'R8')?.syncedAt, s.stops.find((x) => x.id === 'S8')?.syncedAt] }
  eq('al volver a abrir, la línea, la corrida y el paro tienen el sello que tenían', rl.use(held), [Date.parse(l1.synced_at), Date.parse(v1.synced_at), Date.parse(s1.synced_at)])
  // the tablet ends the stop, records a unit, ends the code and renames the line; the server takes it all
  clock += M
  rl.use((m) => { m.endStop('S8'); m.unitDone('R8', 240); m.endRun('R8'); m.renameLine('L8', 'Línea 9') })
  for (let it = first(rl); it; it = first(rl)) rl.use((m) => m.markSent(it))
  // a page of a pull asked before all that arrives now, with the versions the server had then
  rl.use((m) => { m.applyRemote('act_runs', v1); m.applyRemote('act_stops', s1); m.applyRemote('act_lines', l1) })
  eq('el código sigue terminado con sus dos unidades, el paro terminado, la línea con su nombre nuevo, y no se manda nada', rl.use((m) => { const s = m.store.get(), r = s.runs.find((x) => x.id === 'R8'); return [!!r.endedAt, r.units.length, !!s.stops.find((x) => x.id === 'S8').endedAt, s.lines.find((l) => l.id === 'L8').name, m.outbox.size()] }), [true, 2, true, 'Línea 9', 0])
  // and an old copy saved without stamps (earlier versions) still opens, simply without them
  const old = await device('rl-old', { seed: { lines: [{ id: 'L1', dept: 'RTE', name: 'Línea 1', updatedAt: 1, syncedAt: 'x' }], runs: [{ id: 'R1', dept: 'RTE', lineId: 'L1', code: 'A100', startedAt: T0, units: [], updatedAt: 2 }], stops: [{ id: 'S1', dept: 'RTE', lineId: 'L1', startedAt: T0, updatedAt: 3, syncedAt: -5 }] } })
  eq('lo guardado sin sello, o con uno que no es un sello, se lee sin él', old.use(held).map((x) => x ?? null).concat(old.use((m) => [m.store.get().lines.length, m.store.get().runs.length, m.store.get().stops.length])), [null, null, null, 1, 1, 1])
}

section('Una línea puesta de nuevo sin señal no se vuelve a quitar con la bajada de todo (auditoría 2026-10-17)')
{
  // A line taken off and put back while the tablet could not send: the first pull after a new version brings
  // everything again, the line as it was taken off among it, before the tablet sends. The line was gone again, and
  // the history said it was back
  const rs = await device('rs', { user: 'Jose' })
  clock = T0 + 700 * M
  rs.use((m) => m.addLine('RTE', 'Línea R')); send(rs, [rs])
  const lid = rs.use((m) => m.store.get().lines.find((l) => l.name === 'Línea R').id)
  clock += M; rs.use((m) => m.removeLine(lid)); send(rs, [rs])
  clock += M
  eq('sin señal se pone de nuevo', rs.use((m) => m.restoreLine('RTE', lid)), true)
  rs.use((m) => m.applyRemote('act_lines', server.get('act_lines|' + lid)))
  eq('la bajada trae la línea quitada: sigue puesta en la tablet y su cambio sigue en la cola', rs.use((m) => [m.store.get().lines.some((l) => l.id === lid), m.outbox.items().filter((i) => i.key === lid).map((i) => i.row.deleted)]), [true, [false]])
  send(rs, [rs])
  eq('y llega al servidor puesta otra vez', [server.get('act_lines|' + lid).deleted, rs.use((m) => m.store.get().lines.find((l) => l.id === lid)?.name), rs.use((m) => m.outbox.size())], [false, 'Línea R', 0])
  // taken off again and put back again, while another tablet had already put it back under another name: it stays
  // back, with the name the other tablet gave it (what each one changed is kept)
  clock += M; rs.use((m) => m.removeLine(lid)); send(rs, [rs])
  clock += M; rs.use((m) => m.restoreLine('RTE', lid))
  const other = { ...server.get('act_lines|' + lid), name: 'Línea R2', deleted: false, updated_at: iso(clock + 1000) }
  land({ table: 'act_lines', key: lid, row: other })
  rs.use((m) => m.applyRemote('act_lines', server.get('act_lines|' + lid)))
  send(rs, [rs])
  eq('si otra tablet ya la puso con otro nombre, queda puesta con ese nombre', [server.get('act_lines|' + lid).deleted, server.get('act_lines|' + lid).name, rs.use((m) => m.store.get().lines.find((l) => l.id === lid)?.name)], [false, 'Línea R2', 'Línea R2'])
}

// =====================================================================================================================
//  The audit of 2026-10-17: files for Excel, texts typed by hand, ids, typed numbers, set ups counted twice, the
//  pallet being built, "Subir al servidor", and a room this version does not know yet
// =====================================================================================================================
section('Un CSV que se abre en Excel no lleva fórmulas: un texto que empieza con = + - @ va como texto (auditoría 2026-10-17, H1)')
calc.use((m) => {
  eq('una celda de texto que Excel tomaría por fórmula lleva delante el apóstrofo ("es texto" para Excel)', [m.csvCell('=1+1'), m.csvCell('+Pollo'), m.csvCell('-5B'), m.csvCell('@x'), m.csvCell('=HYPERLINK("http://x","ver")')], ['"\'=1+1"', '"\'+Pollo"', '"\'-5B"', '"\'@x"', '"\'=HYPERLINK(""http://x"",""ver"")"'])
  eq('un número, negativo o no, va como número; un texto normal, tal cual', [m.csvCell(-5), m.csvCell(12.5), m.csvCell('Break'), m.csvCell(''), m.csvCell(null), m.csvCell("O'Brien")], ['"-5"', '"12.5"', '"Break"', '""', '""', '"O\'Brien"'])
  const p = (code, name) => ({ code, name, pouchesPerCase: 6, casesPerMix: 10, cratesPerCart: 24, pouchesPerCrate: 6, casesPerPallet: 40, updatedAt: 0 })
  const csv = m.productsCsv([p('A100', '=X'), p('-5B', '+Y'), p('C300', "'Comilla")]), rows = csv.split('\r\n')
  eq('en la tabla de productos, cada celda así va guardada', [rows[1].split(',')[1], rows[2].split(',')[0], rows[2].split(',')[1]], ['"\'=X"', '"\'-5B"', '"\'+Y"'])
  eq('y la app la vuelve a leer exactamente como era', m.parseProductsCsv(csv).map((x) => [x.code, x.name]), [['A100', '=X'], ['-5B', '+Y'], ['C300', "'Comilla"]])
  eq('un archivo que la oficina volvió a guardar con el apóstrofo se lee sin él; delante de otra cosa se queda', m.parseProductsCsv('Código;Producto\r\n"\'=Z";\'=W\r\nD400;\'Pollo').map((x) => [x.code, x.name]), [['=Z', '=W'], ['D400', "'Pollo"]])
})

section('Una causa escrita a mano como "__proto__" o "constructor" no deja la pantalla en blanco ni pierde su tiempo (auditoría 2026-10-17, H2)')
{
  on = 'en1'; localStorage.setItem('act_lang', 'en')
  const en1 = await device('en1', { seed: { lines: [{ id: 'LP', dept: 'RTE', name: 'Línea 1', updatedAt: 1 }], runs: [], stops: [], products: [], schedule: {}, changes: [], targets: [], shifts: [NO_GAP] } })
  en1.use((m) => {
    eq('la app está en inglés', m.lang, 'en')
    const words = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']
    eq('una palabra que no es un texto de la app sale tal cual, nunca algo de JavaScript', words.map((k) => m.tr(k)), words)
    eq('lo que sí está en inglés sigue traducido', [m.tr('Problema mecánico'), m.tr('Se ven {0} de {1}', 1, 2)], ['Mechanical issue', 'Showing 1 of 2'])
    eq('lo que lleva un bin, escrito a mano, tampoco', [m.binWord('__proto__'), m.binWord('constructor'), m.binWord('platos')], ['__proto__', 'constructor', m.tr('platos')])
    m.applyRemote('act_runs', runRow({ id: 'rP', lineId: 'LP', startedAt: T0 - 120 * M, endedAt: T0 - 60 * M }))
    m.applyRemote('act_stops', stopRow({ id: 'sP1', lineId: 'LP', reason: '__proto__', startedAt: T0 - 110 * M, endedAt: T0 - 80 * M }))
    m.applyRemote('act_stops', stopRow({ id: 'sP2', lineId: 'LP', reason: 'constructor', startedAt: T0 - 75 * M, endedAt: T0 - 65 * M }))
    const s = m.store.get(), r = s.runs.find((x) => x.id === 'rP'), st = m.runStats(s, r, T0)
    eq('las dos causas cuentan su tiempo, como números', [st.down / M, Object.entries(st.reasons).map(([k, v]) => [k, typeof v, v / M])], [40, [['__proto__', 'number', 30], ['constructor', 'number', 10]]])
    eq('también en el turno', Object.entries(m.runInShift(s, r, T0, m.shiftsOf(s, DAY), 1).reasons).map(([k, v]) => [k, v / M]), [['__proto__', 30], ['constructor', 10]])
    eq('y en el reporte, en "Parado por causa"', m.reportOf(s, DAY, T0).reasons.map((x) => [x.reason, x.ms / M]), [['__proto__', 30], ['constructor', 10]])
  })
}

section('Un aparato sin crypto.randomUUID (navegador viejo, o la app abierta por http) hace ids que el servidor acepta (auditoría 2026-10-17, H5)')
{
  const real = globalThis.crypto
  const uuid4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  const old = await device('oldtab')
  Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value: { getRandomValues: (a) => real.getRandomValues(a) } })
  try {
    const ids = old.use((m) => {
      m.addLine('RTE', 'Línea V')
      const line = m.store.get().lines.find((l) => l.name === 'Línea V')
      m.startRun(line, 'A100', '6283', DAY, 240)
      m.startStop('RTE', line.id, 'Break', '')
      const s = m.store.get()
      return [line.id, s.runs.at(-1).id, s.stops.at(-1).id, ...s.changes.map((c) => c.id)]
    })
    eq('la línea, la corrida, el paro y el historial llevan un UUID v4 de verdad', ids.map((x) => uuid4.test(x)), ids.map(() => true))
    eq('cada uno distinto', new Set(ids).size, ids.length)
  } finally { Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value: real }) }
}

section('Corregir: un waste que no es un número no se guarda como 0 (auditoría 2026-10-17, H6)')
{
  const kw = await device('kw')
  kw.use((m) => {
    m.applyRemote('act_runs', runRow({ id: 'rW', dept: 'Kitchen', line: 'Braiser 1', startedAt: T0 - 60 * M, endedAt: T0 - 10 * M, waste: 25 }))
    const run = () => m.store.get().runs.find((r) => r.id === 'rW')
    const fix = (w) => { const o = m.draftOf(run()); m.applyDraft('rW', o, { ...o, waste: w }); return run().waste }
    eq('"25..5", "1.234.5" o una coma sola no son números: el waste se queda en 25', [fix('25..5'), fix('1.234.5'), fix(',')], [25, 25, 25])
    eq('la caja lo puede decir; un número, o nada, está bien', [m.wasteProblem('25..5') !== '', m.wasteProblem('25,5'), m.wasteProblem(''), m.wasteProblem(' 7 ')], [true, '', '', ''])
    eq('la coma sigue siendo el punto decimal, y vacío es nada', [fix('25,5'), fix('1,250'), fix('')], [25.5, 1.25, 0])
    // review of 2026-10-18: the form closed as if saved, and the rest of what was corrected went in without its waste
    m.applyRemote('act_runs', runRow({ id: 'rW2', dept: 'Kitchen', lineId: 'K9', line: 'Braiser 9', code: 'C100', startedAt: T0 - 60 * M, endedAt: T0 - 10 * M, waste: 25 }))
    const o = m.draftOf(m.store.get().runs.find((r) => r.id === 'rW2'))
    const why = m.applyDraft('rW2', o, { ...o, code: 'c200', waste: '25..5' })
    const r2 = m.store.get().runs.find((r) => r.id === 'rW2')
    eq('Corregir con un waste que no es un número: dice por qué y no guarda nada (ni el código), para que se escriba bien', [why !== '', r2.code, r2.waste], [true, 'C100', 25])
    eq('escrito bien, guarda todo y no dice nada', [m.applyDraft('rW2', o, { ...o, code: 'c200', waste: '25,5' }), m.store.get().runs.find((r) => r.id === 'rW2').code, m.store.get().runs.find((r) => r.id === 'rW2').waste], ['', 'C200', 25.5])
    // "Agregar un registro que nadie registró": the waste goes as typed, and one that is not a number adds nothing
    m.addLine('Kitchen', 'Braiser 7')
    const k7 = m.store.get().lines.find((l) => l.name === 'Braiser 7')
    const later = (waste, h) => m.addRunLater({ dept: 'Kitchen', lineId: k7.id, code: 'C300', date: DAY, startedAt: new Date(2026, 9, 10, h, 0, 0).getTime(), endedAt: new Date(2026, 9, 10, h, 30, 0).getTime(), units: [{ qty: null }], waste })
    const n0 = m.store.get().runs.length
    eq('agregado después con waste "25..5": no se agrega (antes quedaba con 0 lb)', [later('25..5', 8), m.store.get().runs.length], ['', n0])
    const ok1 = later('2,5', 9), ok2 = later('', 10)
    eq('con "2,5" o sin waste, se agrega con 2.5 y con 0', [m.store.get().runs.find((r) => r.id === ok1)?.waste, m.store.get().runs.find((r) => r.id === ok2)?.waste], [2.5, 0])
  })
}

section('Reporte: dos Set up abiertos a la vez en una línea cuentan su tiempo una vez (auditoría 2026-10-17, H7)')
{
  const su = await device('su')
  su.use((m) => {
    const at = (h, mi = 0) => new Date(2026, 9, 10, h, mi, 0).getTime()
    // line LS: two tablets both put it in set up from 10:00 (the next code closed both at 10:30); and the same stop twice
    m.applyRemote('act_runs', runRow({ id: 'rS1', lineId: 'LS', startedAt: at(8), endedAt: at(10), units: [unit(at(9, 30), 240)] }))
    m.applyRemote('act_runs', runRow({ id: 'rS2', lineId: 'LS', startedAt: at(10, 30), endedAt: at(11, 30), units: [unit(at(11), 240)] }))
    for (const id of ['su1', 'su2']) m.applyRemote('act_stops', stopRow({ id, lineId: 'LS', reason: 'Set up', startedAt: at(10), endedAt: at(10, 30) }))
    for (const id of ['pm1', 'pm2']) m.applyRemote('act_stops', stopRow({ id, lineId: 'LS', reason: 'Problema mecánico', startedAt: at(9), endedAt: at(9, 20) }))
    const rep = m.reportOf(m.store.get(), DAY, T0)
    eq('el Set up del día, el del cuarto y el de cada turno: 30 minutos, no 60', [rep.setup / M, rep.byDept[0].setup / M, rep.byShift[0].day.setup / M, rep.byShift[0].first.setup / M], [30, 30, 30, 30])
    eq('la lista de paros sigue con los cuatro registros, y "Parado" sigue en 20 minutos', [rep.stops.length, rep.down / M], [4, 20])
    // line LT, the same hours: its two set ups do not touch each other, and another line's time is its own
    m.applyRemote('act_runs', runRow({ id: 'rT1', lineId: 'LT', line: 'Línea 2', startedAt: at(8), endedAt: at(10), units: [unit(at(9), 240)] }))
    m.applyRemote('act_runs', runRow({ id: 'rT2', lineId: 'LT', line: 'Línea 2', startedAt: at(10, 30), endedAt: at(11, 30), units: [unit(at(11), 240)] }))
    m.applyRemote('act_stops', stopRow({ id: 'st1', lineId: 'LT', reason: 'Set up', startedAt: at(10), endedAt: at(10, 10) }))
    m.applyRemote('act_stops', stopRow({ id: 'st2', lineId: 'LT', reason: 'Set up', startedAt: at(10, 20), endedAt: at(10, 30) }))
    eq('dos set ups que no se tocan se suman, y los de otra línea a la misma hora también: 30 + 20', m.reportOf(m.store.get(), DAY, T0).setup / M, 50)
  })
}

section('Packing: lo que la línea pone en el pallet que arma no se pierde cuando un manager corrige otra cosa de la corrida (auditoría 2026-10-17, S7)')
{
  const pk = await device('pk', { user: 'Lina' }), pm = await device('pm', { user: 'Santiago' })
  const both = [pk, pm]
  const runOf = (d, id) => d.use((m) => m.store.get().runs.find((r) => r.id === id))
  const view = (r) => r && { pallets: r.units.map((u) => u.ref), open: (r.extra?.open?.parts ?? []).map((p) => [p.lot, p.qty, p.tag]), lotNow: r.extra?.lotNow ?? '', removed: r.extra?.removed ?? [], ended: !!(r.endedAt ?? r.ended_at) }
  const onServer = (id) => server.get('act_runs|' + id)
  /** a new code on a new Packing line of the line's tablet, known to both devices */
  const newPacking = (line, code, lot) => {
    clock += M
    pk.use((m) => { m.addLine('Packing', line); m.startRun(m.store.get().lines.find((l) => l.name === line), code, lot, DAY, 60) })
    return pk.use((m) => m.store.get().runs.at(-1).id)
  }
  /** the manager's change goes up after the server's newer row of that run reached the manager (as a pull, or the refresh before sending, brings it) */
  const managerSends = (id) => { pm.use((m) => m.applyRemote('act_runs', onServer(id))); send(pm, both) }
  const everywhere = (what, id, want) => {
    eq(what + ' · servidor', view(onServer(id)), want)
    eq(what + ' · la línea y el manager, sin nada pendiente', [view(runOf(pk, id)), view(runOf(pm, id)), pk.use((m) => m.outbox.size()), pm.use((m) => m.outbox.size())], [want, want, 0, 0])
  }
  clock = T0 + 900 * M
  {
    // the line: lot 6283 ran out on the pallet being built (20 cases, tag X) and 6284 goes on, unheard by the manager,
    // who takes pallet 2 off (recorded twice) from the version before
    const id = newPacking('Línea P', 'P100', '6283')
    clock += M; pk.use((m) => m.unitDone(id, 60, 'T1'))
    clock += M; pk.use((m) => m.unitDone(id, 60, 'T2'))
    send(pk, both)
    const t2 = runOf(pm, id).units[1].at
    clock += M; pk.use((m) => m.palletLotEnds(id, 20, 'X', '6284')); send(pk, [pk])
    clock += M; pm.use((m) => m.updateRun(id, { units: runOf(pm, id).units.filter((u) => u.at !== t2) }))
    managerSends(id)
    everywhere('el pallet quitado sigue quitado, y el lote que se acabó (sus cajas y su tag) y el lote de ahora siguen', id, { pallets: ['T1'], open: [['6283', 20, 'X']], lotNow: '6284', removed: [t2], ended: false })
  }
  {
    // the line ends the code (what was on the pallet being built becomes its last pallet) while the manager, who has
    // not heard it, takes pallet 1 off: the ended run carries no pallet "being built" any more
    const id = newPacking('Línea S', 'P200', '6290')
    clock += M; pk.use((m) => m.unitDone(id, 60, 'T1'))
    clock += M; pk.use((m) => m.palletLotEnds(id, 20, 'X', '6291'))
    send(pk, both)
    const t1 = runOf(pm, id).units[0].at
    clock += M; pk.use((m) => m.endRun(id)); send(pk, [pk])
    clock += M; pm.use((m) => m.updateRun(id, { units: runOf(pm, id).units.filter((u) => u.at !== t1) }))
    managerSends(id)
    everywhere('el código terminado: su último pallet es el que se armaba, y no queda otro abierto que se contaría dos veces', id, { pallets: ['X'], open: [], lotNow: '6291', removed: [t1], ended: true })
  }
  {
    // both build the same pallet: the line adds a lot while the manager writes the tag of the one before; both stay
    const id = newPacking('Línea Q', 'P300', '6300')
    clock += M; pk.use((m) => m.palletLotEnds(id, 10, '', '6301')); send(pk, both)
    clock += M; pk.use((m) => m.palletLotEnds(id, 15, 'B', '6302')); send(pk, [pk])
    clock += M; pm.use((m) => m.palletPartFix(id, 0, { tag: 'A' }))
    managerSends(id)
    everywhere('los dos arman el mismo pallet: el tag que puso el manager y el lote que agregó la línea quedan', id, { pallets: [], open: [['6300', 10, 'A'], ['6301', 15, 'B']], lotNow: '6302', removed: [], ended: false })
  }
  {
    // the line closes the pallet (Pallet completo) while the manager corrects one of its lots: the close stands (Jose's
    // rule), and what it closed is not left on the next pallet to be counted again
    const id = newPacking('Línea R', 'P400', '6400')
    clock += M; pk.use((m) => m.palletLotEnds(id, 10, 'A', '6401'))
    clock += M; pk.use((m) => m.palletLotEnds(id, 15, 'B', '6402')); send(pk, both)
    clock += M; pk.use((m) => m.palletDone(id, [{ lot: '6400', qty: 10, tag: 'A' }, { lot: '6401', qty: 15, tag: 'B' }, { lot: '6402', qty: 5, tag: 'C' }], '')); send(pk, [pk])
    clock += M; eq('(el manager corrige un lote del pallet que todavía ve abierto)', pm.use((m) => m.palletPartFix(id, 1, { qty: 16 })), true)
    managerSends(id)
    everywhere('un pallet cerrado en la línea mientras el manager corregía uno de sus lotes: queda cerrado, y nada de él sigue abierto', id, { pallets: ['A, B, C'], open: [], lotNow: '6402', removed: [], ended: false })
    eq('y el pallet lleva sus tres lotes, 30 cajas', onServer(id).units.map((u) => [u.qty, u.lots.map((l) => l.lot)]), [[30, ['6400', '6401', '6402']]])
  }
  {
    // review of 2026-10-18: a pallet of two lots is reopened ("Pallet completo" tapped too early); the line puts the
    // next lot on it while the manager, who has not heard it, writes the tag of the second lot. Every lot of the
    // reopened pallet had the pallet's moment, so the manager's lot replaced the first one: lot 6500 was gone and
    // 6501 was counted twice, on the server and on every screen
    const id = newPacking('Línea Z', 'P900', '6500')
    clock += M; pk.use((m) => m.palletLotEnds(id, 10, 'A', '6501'))
    clock += M; pk.use((m) => m.palletDone(id, [{ lot: '6500', qty: 10, tag: 'A' }, { lot: '6501', qty: 20, tag: 'B' }], ''))
    const pallet = runOf(pk, id).units[0].at
    clock += M; eq('(el último pallet se vuelve a abrir)', pk.use((m) => m.reopenPallet(id, '6502')), true)
    send(pk, both)
    const ats = runOf(pm, id).extra.open.parts.map((p) => p.at)
    eq('cada lote del pallet que se volvió a abrir tiene su propio momento, el último el del pallet', [new Set(ats).size, ats.at(-1), ats.every((t) => t <= pallet)], [2, pallet, true])
    clock += M; pk.use((m) => m.palletLotEnds(id, 5, 'C', '6503')); send(pk, [pk])
    clock += M; pm.use((m) => m.palletPartFix(id, 1, { tag: 'B2' }))
    managerSends(id)
    everywhere('pallet vuelto a abrir: el tag del manager y el lote de la línea quedan, y ningún lote se pierde ni se cuenta dos veces', id, { pallets: [], open: [['6500', 10, 'A'], ['6501', 20, 'B2'], ['6502', 5, 'C']], lotNow: '6503', removed: [pallet], ended: false })
  }
  {
    // the same, with a pallet an older version of the app reopened on the floor: its two lots share one moment
    const id = newPacking('Línea Y', 'P950', '6510')
    send(pk, both)
    const shared = clock - 30_000, live = { ...onServer(id), extra: { lotNow: '6512', open: { parts: [{ lot: '6510', qty: 20, tag: 'A', at: shared, by: 'Lina' }, { lot: '6511', qty: 16, tag: 'B', at: shared, by: 'Lina' }], po: '' } }, updated_at: iso(clock), synced_at: iso(landed += 1000) }
    server.set('act_runs|' + id, live)
    for (const d of both) d.use((m) => m.applyRemote('act_runs', live))
    clock += M; pk.use((m) => m.palletLotEnds(id, 5, 'C', '6513')); send(pk, [pk])
    clock += M; pm.use((m) => m.palletPartFix(id, 1, { qty: 18 }))
    managerSends(id)
    everywhere('lotes que comparten un momento: la corrección del manager va a su lote, y los otros dos siguen como estaban', id, { pallets: [], open: [['6510', 20, 'A'], ['6511', 18, 'B'], ['6512', 5, 'C']], lotNow: '6513', removed: [], ended: false })
  }
}

section('"Subir al servidor": solo lo que el servidor nunca recibió de este aparato (auditoría 2026-10-17, H4)')
{
  const run = (id, more = {}) => ({ id, dept: 'RTE', lineId: 'LU1', line: 'Línea 1', code: 'A100', lot: '6283', date: DAY, startedAt: T0 - 60 * M, endedAt: T0 - 30 * M, units: [], perUnit: 240, waste: 0, by: 'Ana', updatedAt: T0 - 30 * M, ...more })
  const stop = (id, more = {}) => ({ id, dept: 'RTE', lineId: 'LU1', reason: 'Break', note: '', startedAt: T0 - 50 * M, endedAt: T0 - 45 * M, by: 'Ana', updatedAt: T0 - 45 * M, ...more })
  const up = await device('up', { seed: {
    lines: [{ id: 'LU1', dept: 'RTE', name: 'Línea 1', updatedAt: 0 }, { id: 'LU2', dept: 'RTE', name: 'Línea 2', updatedAt: T0 - 9 * M, syncedAt: T0 - 9 * M }],
    runs: [run('rU1'), run('rU2', { syncedAt: T0 - 29 * M })],
    stops: [stop('sU1'), stop('sU2', { syncedAt: T0 - 44 * M })],
    products: [{ code: 'A100', name: 'Pollo', pouchesPerCase: 6, casesPerMix: 10, cratesPerCart: 24, pouchesPerCrate: 6, casesPerPallet: 40, updatedAt: T0 - 99 * M }],
    schedule: { [DAY]: { A100: 3 } },
    changes: [{ id: 'cU', at: T0 - 10 * M, by: 'Ana', dept: 'RTE', what: 'algo', before: '', after: '', refTable: 'act_runs', refKey: 'rU1', updatedAt: T0 - 10 * M }],
    targets: [{ dept: 'RTE', perHour: 5, perShift: 40, updatedAt: T0 - 9 * M }],
    shifts: [NO_GAP], lineTargets: [{ lineId: 'LU1', perHour: 2, perDay: 9, updatedAt: T0 }], turnGoals: [{ key: 'RTE@1', perHour: 5, total: 40, updatedAt: T0 }],
    plans: [{ date: DAY, dept: 'RTE', code: 'A100', qty: 3, updatedAt: T0 }],
    orders: [{ id: 'o1', customer: 'Cliente', po: '77', code: 'A100', cases: 10, shipBy: '', dest: '', closed: false, createdAt: T0, by: 'Ana', updatedAt: T0 }],
  } })
  up.use((m) => {
    const n = m.uploadAll()
    eq('van la línea, la corrida y el paro que el servidor no tiene; nada de lo que ya tiene, ni productos, programa, metas, horarios, historial o pedidos', [n, m.outbox.items().map((i) => i.table + '|' + i.key).sort()], [3, ['act_lines|LU1', 'act_runs|rU1', 'act_stops|sU1']])
  })
}

section('Un registro de un cuarto que esta versión no conoce (QC) no deja en blanco el reporte ni ninguna pantalla (auditoría 2026-10-17)')
{
  const qc = await device('qc', { user: 'Oficina' })
  qc.use((m) => {
    m.applyRemote('act_lines', { id: 'LQ', dept: 'QC', name: 'Mesa 1', deleted: false, updated_at: iso(T0), synced_at: iso(T0 + 1) })
    m.applyRemote('act_runs', runRow({ id: 'rQ', dept: 'QC', lineId: 'LQ', line: 'Mesa 1', startedAt: T0 - 60 * M, endedAt: T0 - 30 * M, units: [unit(T0 - 50 * M, 12)] }))
    m.applyRemote('act_stops', stopRow({ id: 'sQ', dept: 'QC', lineId: 'LQ', startedAt: T0 - 45 * M, endedAt: T0 - 40 * M }))
    m.applyRemote('act_changes', { id: 'cQ', at: iso(T0 - 20 * M), by_name: 'Oficina', dept: 'QC', what: 'Algo de QC', before: '', after: 'x', ref_table: 'act_runs', ref_key: 'rQ', deleted: false, updated_at: iso(T0 - 20 * M) })
    m.applyRemote('act_runs', runRow({ id: 'rK', startedAt: T0 - 60 * M, endedAt: T0 - 30 * M, units: [unit(T0 - 50 * M, 240)] }))
    const s = m.store.get()
    eq('la línea, la corrida y el paro de QC se quedan en el servidor; lo de los cuartos conocidos llega como siempre', [s.lines.some((l) => l.id === 'LQ'), s.runs.map((r) => r.id), s.stops.some((x) => x.id === 'sQ'), m.outbox.size()], [false, ['rK'], false, 0])
    eq('el historial se guarda tal cual, con su cuarto', s.changes.find((c) => c.id === 'cQ')?.dept, 'QC')
    let crashed = ''
    try { const rep = m.reportOf(s, DAY, T0); m.searchReport(s, rep, 'QC', s.changes, T0); for (const d of m.DEPTS) m.deptToday(s, d, DAY, T0) } catch (e) { crashed = String(e) }
    eq('el reporte, su búsqueda y cada cuarto salen', crashed, '')
  })
  // a copy kept on the device with rows of such a room (written by a version that knew it): read without them
  const qc2 = await device('qc2', { seed: { lines: [{ id: 'LQ2', dept: 'QC', name: 'Mesa', updatedAt: 1 }, { id: 'LK2', dept: 'RTE', name: 'Línea 1', updatedAt: 1 }], runs: [{ id: 'rQ2', dept: 'QC', lineId: 'LQ2', line: 'Mesa', code: 'Q1', lot: '1', date: DAY, startedAt: T0 - 60 * M, endedAt: null, units: [], perUnit: null, waste: 0, by: 'x', updatedAt: 1 }, { id: 'rK2', dept: 'RTE', lineId: 'LK2', line: 'Línea 1', code: 'A100', lot: '1', date: DAY, startedAt: T0 - 60 * M, endedAt: null, units: [], perUnit: 240, waste: 0, by: 'x', updatedAt: 1 }], stops: [{ id: 'sQ2', dept: 'QC', lineId: 'LQ2', reason: 'Break', note: '', startedAt: T0 - 10 * M, endedAt: null, by: 'x', updatedAt: 1 }], products: [], schedule: {}, changes: [], targets: [], shifts: [NO_GAP] } })
  qc2.use((m) => {
    const s = m.store.get()
    eq('al volver a abrir: solo lo de los cuartos que conoce', [s.lines.map((l) => l.id), s.runs.map((r) => r.id), s.stops.length], [['LK2'], ['rK2'], 0])
    let crashed = ''
    try { m.reportOf(s, DAY, T0) } catch (e) { crashed = String(e) }
    eq('y el reporte sale', crashed, '')
  })
}

// =====================================================================================================================
//  "¿Seguro?" (Jose, 2026-10-18): a quantity typed that is more than twice the usual for that product and room
// =====================================================================================================================
section('¿Seguro?: más del doble de lo usual se pregunta antes de guardar; sin lo usual no se pregunta (Jose, 2026-10-18)')
{
  // A 2400 typed for 240 counts ten carts. The usual is only one the app already has: the run's own quantity per unit,
  // the products table's (pouches per cart, cases per pallet), or the last run of the code counted the same way. A room
  // with none of these (Kitchen, Spiral, MFO, Packing's bins) is never asked: no figure is made up for it.
  const sq = await device('sure', { user: 'Luis', usual: true })
  sq.use((m) => {
    const st = () => m.store.get(), run = (id) => st().runs.find((r) => r.id === id)
    const lineOf = (dept, name) => { m.addLine(dept, name); return st().lines.find((l) => l.dept === dept && l.name === name) }
    const started = (line, ...args) => { m.startRun(line, ...args); return m.openRun(st(), line.id) }
    clock = oct(10, 6, 0)
    // the office's table: A100 24 crates × 10 pouches, 36 cases a pallet; B200 24 × 6, 40 a pallet
    m.applyRemote('act_products', productRow('A100', 'Albóndigas', 8, 18, 24, 10, 36))
    m.applyRemote('act_products', productRow('B200', 'Pimientos', 8, 6, 24, 6, 40))
    eq('la regla: más del doble pregunta; el doble justo, menos o nada, no; sin lo usual (o con 0), nunca', [m.tooMuch(481, 240), m.tooMuch(480, 240), m.tooMuch(240, 240), m.tooMuch(0, 240), m.tooMuch(72.5, 36), m.tooMuch(72, 36), m.tooMuch(2400, null), m.tooMuch(2400, undefined), m.tooMuch(2400, 0), m.tooMuch(NaN, 240)], [true, false, false, false, true, false, false, false, false, false])
    // each room's runs, started as the line starts them
    const rte = started(lineOf('RTE', 'Línea S1'), 'A100', '6283', DAY, 240)
    const pal = started(lineOf('Packing', 'Línea S1'), 'A100', '6283', DAY, 36)
    const bins = started(lineOf('Packing', 'Línea S2'), 'B200', '6283', DAY, null, 'platos')
    const mfo = started(lineOf('MFO', 'Línea S1'), 'A100', '6283', DAY, null, 'platos')
    const mfoLb = started(lineOf('MFO', 'Línea S2'), 'C300', '6283', DAY, null, 'lb')
    const spiLb = started(lineOf('Spiral', 'Línea S1'), 'A100', '6283', DAY, null, '', 'lb')
    const spiMix = started(lineOf('Spiral', 'Línea S2'), 'B200', '6283', DAY, null)
    const kit = started(lineOf('Kitchen', 'Braiser S1'), 'A100', '6283', DAY, null)
    eq('lo usual de un carro, de un pallet y de un bin: el de la corrida; los cuartos sin cantidad por unidad no tienen', [rte, pal, bins, mfo, mfoLb, spiLb, spiMix, kit].map((r) => m.usualOf(st(), r)), [240, 36, null, null, null, null, null, null])
    eq('RTE: 2400 pouches en un carro de 240 pregunta; 480 no', [m.tooMuch(2400, m.usualOf(st(), rte)), m.tooMuch(480, m.usualOf(st(), rte))], [true, false])
    eq('Packing: un pallet de 80 cajas donde lo usual son 36 pregunta; 72 no', [m.tooMuch(80, m.usualOf(st(), pal)), m.tooMuch(72, m.usualOf(st(), pal))], [true, false])
    eq('MFO (platos y libras), Spiral (libras y mezclas), Kitchen y los bins de Packing: nada se pregunta, ni con 99999', [mfo, mfoLb, spiLb, spiMix, kit, bins].map((r) => m.tooMuch(99999, m.usualOf(st(), r))), [false, false, false, false, false, false])
    // a code about to start, or added after the fact: the products table, else the last run of the code counted that way
    eq('al empezar o al agregar un registro: la tabla de productos (RTE 24 × 10 y 24 × 6, Packing 36 y 40 por pallet; el código como sea que se escriba)', [m.usualFor(st(), 'RTE', 'A100'), m.usualFor(st(), 'RTE', 'B200'), m.usualFor(st(), 'Packing', ' a100 '), m.usualFor(st(), 'Packing', 'B200', '')], [240, 144, 36, 40])
    const lt = lineOf('RTE', 'Línea S3')
    m.addRunLater({ dept: 'RTE', lineId: lt.id, code: 'B200', lot: '6283', date: DAY, startedAt: oct(10, 4, 0), endedAt: oct(10, 5, 0), units: [{ qty: 300 }], perUnit: 300 })
    eq('la tabla manda sobre la última corrida del código (como la cantidad que se propone al empezar)', [m.usualFor(st(), 'RTE', 'B200'), m.lastPerUnit(st(), 'RTE', 'B200')], [144, 144])
    eq('los bins de Packing, MFO, Spiral y Kitchen no tienen lo usual, aunque el código esté en la tabla', [m.usualFor(st(), 'Packing', 'B200', 'platos'), m.usualFor(st(), 'MFO', 'A100', 'platos'), m.usualFor(st(), 'MFO', 'A100', 'lb'), m.usualFor(st(), 'Spiral', 'A100', 'lb'), m.usualFor(st(), 'Spiral', 'A100', ''), m.usualFor(st(), 'Kitchen', 'A100', '')], [null, null, null, null, null, null])
    eq('un código que no está en la tabla y nunca corrió: no hay lo usual, no se pregunta', [m.usualFor(st(), 'RTE', 'QQ1'), m.tooMuch(5000, m.usualFor(st(), 'RTE', 'QQ1'))], [null, false])
    const lr = lineOf('RTE', 'Línea S2')
    const q1 = m.addRunLater({ dept: 'RTE', lineId: lr.id, code: 'QQ1', lot: '6283', date: DAY, startedAt: oct(10, 4, 0), endedAt: oct(10, 5, 0), units: [{ qty: 180 }], perUnit: 180 })
    eq('sin tabla: lo que tuvo la última corrida del código (lo que la caja propone al empezar)', [m.usualFor(st(), 'RTE', 'qq1'), m.lastPerUnit(st(), 'RTE', 'QQ1')], [180, 180])
    m.deleteRun(q1)
    eq('una corrida borrada no cuenta como lo usual', m.usualFor(st(), 'RTE', 'QQ1'), null)
    const lp = lineOf('Packing', 'Línea S3')
    const qb = m.addRunLater({ dept: 'Packing', lineId: lp.id, code: 'QQ2', lot: '6283', date: DAY, startedAt: oct(10, 4, 0), endedAt: oct(10, 5, 0), units: [{ qty: 500 }], perUnit: 500, bin: 'platos' })
    eq('unos bins de platos no son lo usual de los pallets del código, pero sí de sus propios bins', [m.usualFor(st(), 'Packing', 'QQ2', ''), m.usualOf(st(), run(qb))], [null, 500])
    const qr = m.addRunLater({ dept: 'RTE', lineId: lr.id, code: 'A100', lot: '6283', date: DAY, startedAt: oct(10, 2, 0), endedAt: oct(10, 3, 0), units: [{ qty: null }], perUnit: null })
    eq('un registro agregado sin cantidad por carro: lo de la tabla', m.usualOf(st(), run(qr)), 240)

    // one question at a time: the box it asks about carries the number typed, never the usual
    const boxes = [{ key: 'per', n: 240, usual: 240 }, { key: 'u1', n: 2400, usual: 240 }, { key: 'u2', n: 900, usual: 240 }, { key: 'u3', n: 1e6, usual: null }]
    const first = m.askFirst(boxes, {})
    eq('pregunta por el primero de más del doble, con el número escrito y lo usual tal cual', [first?.key, first?.n, first?.usual], ['u1', 2400, 240])
    eq('"Corregir" no confirma nada: al guardar otra vez con el mismo número, vuelve a preguntar', m.askFirst(boxes, {})?.key, 'u1')
    eq('"Sí" a uno pasa al siguiente; con los dos dichos, se guarda (lo que no tiene lo usual nunca pregunta)', [m.askFirst(boxes, { u1: 2400 })?.key, m.askFirst(boxes, { u1: 2400, u2: 900 })], ['u2', null])
    eq('un número cambiado después del "Sí" se pregunta otra vez', m.askFirst(boxes.map((b) => (b.key === 'u1' ? { ...b, n: 2500 } : b)), { u1: 2400, u2: 900 })?.key, 'u1')

    // Corregir: only what was changed in the form is asked about, held against the quantity per unit in the form
    clock = oct(10, 7, 0); m.unitDone(rte.id, 240)
    clock = oct(10, 7, 20); m.unitDone(rte.id, 240)
    clock = oct(10, 7, 40); m.unitDone(rte.id, 120)
    const opened = m.draftOf(run(rte.id)), at = opened.units.map((u) => u.at)
    const form = (patch) => ({ ...opened, ...patch, units: opened.units.map((u, i) => ({ ...u, ...(patch.units?.[i] ?? {}) })) })
    const asked = (d) => m.draftChecks(st(), run(rte.id), opened, d).map((b) => [b.key, b.n, b.usual, b.index])
    eq('nada cambiado: nada que preguntar', asked(form({})), [])
    eq('un carro cambiado a 2400: se mira ese, con lo usual de la corrida; los otros no', asked(form({ units: [{ qty: '2400' }] })), [['u' + at[0], 2400, 240, 0]])
    eq('y es el que se pregunta', m.askFirst(m.draftChecks(st(), run(rte.id), opened, form({ units: [{ qty: '2400' }] })), {})?.n, 2400)
    eq('los pouches por carro cambiados: se miran contra los de la corrida, y los carros contra los nuevos', asked(form({ per: '600', units: [{}, {}, { qty: '1000' }] })), [['per', 600, 240, -1], ['u' + at[2], 1000, 600, 2]])
    eq('un carro dejado en blanco no tiene número: no se pregunta', m.askFirst(m.draftChecks(st(), run(rte.id), opened, form({ units: [{ qty: '' }] })), {}), null)
    const later = { at: oct(10, 7, 50), qty: '9999', ref: '', by: 'Luis' }
    eq('un carro agregado mientras el formulario estaba abierto (ya se preguntó al agregarlo) no se vuelve a mirar', asked({ ...opened, units: [...opened.units, later] }), [])
    // what is saved after "Sí" is what was typed: the usual is never put in its place
    const typed = form({ units: [{ qty: '2400' }] })
    eq('después del "Sí" se guarda el número escrito, no lo usual', [m.applyDraft(rte.id, opened, typed), run(rte.id).units.map((u) => u.qty)], ['', [2400, 240, 120]])
    // a pallet whose lots were changed: its number is the sum of its lots
    clock = oct(10, 8, 0); m.palletDone(pal.id, [{ lot: '6283', qty: 20, tag: '1' }, { lot: '6284', qty: 16, tag: '2' }], '')
    const po = m.draftOf(run(pal.id)), pat = po.units[0].at
    const lots = [{ lot: '6283', qty: 50 }, { lot: '6284', qty: 40 }]
    eq('un pallet con sus lotes cambiados: se mira la suma (90 cajas, lo usual 36), de dos lotes', m.draftChecks(st(), run(pal.id), po, { ...po, units: [{ ...po.units[0], qty: '90', lots }] }).map((b) => [b.key, b.n, b.usual, b.lots]), [['u' + pat, 90, 36, 2]])
  })
  // The screens: every box that saves a counted quantity goes through the question, and the question itself only
  // shows the two numbers, with "Sí" green and "Corregir" grey; "Corregir" just closes it (the box keeps its number)
  const { readFileSync } = await import('node:fs')
  const src = (f) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src', f), 'utf8')
  const app = src('App.tsx'), editors = src('editors.tsx')
  const body = (text, name) => { const i = text.search(new RegExp('function ' + name + '\\b')); const j = text.slice(i + 1).search(/\n(?:export )?function /); return i < 0 ? '' : text.slice(i, j < 0 ? undefined : i + 1 + j) }
  const uses = (text, tag) => text.split('\n').filter((l) => l.includes('<' + tag + ' '))
  eq('cada ventana de cantidad dice lo usual (menos la del waste, que no es una unidad)', [...uses(app, 'QtyDialog'), ...uses(app, 'LotsDialog')].map((l) => l.includes('usual=') || /Waste de/.test(l)), [...uses(app, 'QtyDialog'), ...uses(app, 'LotsDialog')].map(() => true))
  eq('se pregunta antes de guardar en cada ventana: carro, pallet, lote del pallet, empezar, Corregir, agregar unidad, agregar registro', [body(app, 'QtyDialog'), body(app, 'LotsDialog'), body(app, 'PalletDoneDialog'), body(app, 'LotEndDialog'), body(app, 'PartDialog'), body(app, 'LineCard'), body(editors, 'RunEditor'), body(editors, 'AddUnitDialog'), body(editors, 'AddRunDialog')].map((b) => b.includes('useSure()') && b.includes('sure.check(') && b.includes('{sure.ui}')), [true, true, true, true, true, true, true, true, true])
  const sureUi = body(app, 'SureDialog'), hook = body(app, 'useSure')
  eq('la pregunta no tiene ninguna caja que llenar: dice el número escrito y lo usual; "Sí, n" verde y "Corregir" gris', [sureUi.includes('<input'), /className="btn primary"[^>]*>\{tr\('Sí, \{0\}'/.test(sureUi), /className="btn"[^>]*>\{tr\('Corregir'\)/.test(sureUi), sureUi.includes('box.n') && sureUi.includes('box.usual')], [false, true, true, true])
  eq('"Corregir" solo cierra la pregunta: no toca la caja, y nada queda confirmado', [/onBack=\{\(\) => setAsking\(null\)\}/.test(hook), (hook.match(/sure\.current\[/g) ?? []).length], [true, 1])
  eq('un "Sí" vale para ese guardar: el "Empezar" de una línea vuelve a preguntar con el código siguiente, y una pregunta que quedó abierta cuando la línea recibió un código se quita', [/sure\.current = \{\}\s*\n\s*save\(\)/.test(hook), /if \(run && sure\.open\) sure\.cancel\(\)/.test(body(app, 'LineCard'))], [true, true])
}

section('Un cambio del programa o de una meta que espera en la cola no pisa otro hecho después en el servidor (Jose, 2026-10-18)')
{
  // The program and what is set for everybody go whole, the last change standing (by the moment each change was made,
  // as every screen already picks between two versions). A change waiting here that meets a version of the server made
  // after it leaves the queue, the screen shows the server's, and the history says what was not sent and why
  const lww = await device('lww', { user: 'Santiago' })
  lww.use((m) => {
    const st = () => m.store.get(), at = (ms) => new Date(ms).toISOString()
    const goal = (k) => { const g = st().turnGoals.find((x) => x.key === k); return g && [g.perHour, g.total] }
    const waiting = () => m.outbox.items().filter((i) => i.table === 'act_targets' || i.table === 'act_plan').map((i) => i.table + '|' + i.key)
    const notes = () => st().changes.filter((c) => c.what.includes('no se subió')).map((c) => [c.by, c.what, c.before, c.after])
    clock = T0 + 60 * M; m.setShiftGoal('RTE', 1, 10, 80)
    m.applyRemote('act_targets', { dept: 'RTE@1', per_hour: 9, per_shift: 72, updated_at: at(T0 + 59 * M), updated_by: 'Edgar' })
    eq('una versión del servidor hecha antes que la de aquí: la de aquí sigue en la cola y en la pantalla', [waiting(), goal('RTE@1'), notes()], [['act_targets|RTE@1'], [10, 80], []])
    m.applyRemote('act_targets', { dept: 'RTE@1', per_hour: 12, per_shift: 96, updated_at: at(T0 + 61 * M), updated_by: 'Edgar' })
    eq('una hecha después: la de aquí sale de la cola, se ve la del servidor y el historial dice lo que no se subió', [waiting(), goal('RTE@1'), notes()], [[], [12, 96], [['Santiago', 'Meta RTE · Turno 1 · no se subió: Edgar lo cambió después', '10 por hora · 80 del turno', '12 por hora · 96 del turno']]])
    clock = T0 + 70 * M; m.setPlan(DAY, 'Packing', '0889', 40)
    m.applyRemote('act_plan', { date: DAY, dept: 'Packing', code: '889', qty: 55, updated_at: at(T0 + 71 * M), updated_by: 'Edgar' })
    eq('el programa de un cuarto, igual', [waiting(), m.planOf(st(), DAY, 'Packing').map((p) => p.qty), notes().at(-1)], [[], [55], ['Santiago', 'Programa ' + DAY + ' · Packing · 889 · no se subió: Edgar lo cambió después', '40', '55']])
    // the program's lot: since 2026-10-20 a code of another lot is another row of the program (the office's 889 of
    // lots 6292 and 6290): the server's row of lot 6284 never takes the place of the one of lot 6283 waiting here; a
    // newer version of that same lot does
    clock = T0 + 72 * M; m.setPlan(DAY, 'Packing', '0889', 55, '6283')
    m.applyRemote('act_plan', { date: DAY, dept: 'Packing', code: '889', qty: 55, lot: '6284', updated_at: at(T0 + 73 * M), updated_by: 'Edgar' })
    const said = notes().length
    eq('con otro lote es otro renglón: el de aquí sigue en la cola, y quedan los dos', [waiting(), m.planOf(st(), DAY, 'Packing').map((p) => [p.lot, p.qty]), notes().length], [['act_plan|' + DAY + '|Packing|889|6283'], [['', 55], ['6283', 55], ['6284', 55]], said])
    m.applyRemote('act_plan', { date: DAY, dept: 'Packing', code: '889', qty: 60, lot: '6283', updated_at: at(T0 + 74 * M), updated_by: 'Edgar' })
    eq('una versión del servidor de ese mismo lote hecha después: la de aquí sale de la cola y el historial lo dice', [waiting(), m.planOf(st(), DAY, 'Packing').map((p) => [p.lot, p.qty]), notes().at(-1)], [[], [['', 55], ['6284', 55], ['6283', 60]], ['Santiago', 'Programa ' + DAY + ' · Packing · 889 · lote 6283 · no se subió: Edgar lo cambió después', '55', '60']])
    clock = T0 + 80 * M; m.setShiftWeek('2026-11-02', '3333311')
    m.applyRemote('act_targets', { dept: 'shiftweek:2026-11-02', per_hour: 3333333, per_shift: null, updated_at: at(T0 + 81 * M), updated_by: 'Edgar' })
    eq('el calendario, igual, dicho como lo dice el historial', [waiting(), m.weekOf(st(), '2026-11-02'), notes().at(-1)], [[], '3333333', ['Santiago', 'Turnos de la semana desde el 2026-11-02 · no se subió: Edgar lo cambió después', 'dom 1 y 2, lun 1 y 2, mar 1 y 2, mié 1 y 2, jue 1 y 2, vie solo 1, sáb solo 1', 'Turnos 1 y 2 todos los días']])
    m.addLine('RTE'); const line = st().lines.at(-1)
    clock = T0 + 90 * M; m.setLineShiftGoal(line, 2, 5, null)
    m.applyRemote('act_targets', { dept: 'line:' + line.id + '@2', per_hour: 6, per_shift: null, updated_at: at(T0 + 91 * M), updated_by: 'Edgar' })
    eq('la meta de una línea, con el nombre de la línea', notes().at(-1), ['Santiago', 'Meta ' + line.name + ' (RTE) · Turno 2 · no se subió: Edgar lo cambió después', '5 por hora', '6 por hora'])
    const said2 = notes().length
    clock = T0 + 100 * M; m.setLineRules({ remove: true })
    m.applyRemote('act_targets', { dept: 'opt:oplines', per_hour: 1, per_shift: 1, updated_at: at(T0 + 101 * M), updated_by: 'Edgar' })
    eq('el servidor ya tiene lo mismo, hecho después: sale de la cola y no hay nada que decir', [waiting(), st().lineRules.remove, notes().length], [[], true, said2])
  })
}

section('Un comentario en cada pallet: se guarda con el pallet, se corrige en Corregir con su línea del historial, se ve en el reporte, se busca y va al Excel')
{
  // Jose, 2026-10-18, on the lots of a pallet in Corregir: "agregar también comentarios a cada registro con lotes
  // combinados". The comment goes on the unit itself (act_runs.units), beside the run's own comment (extra.note):
  // typed at "Pallet completo", in the lots window, in "Agregar pallet" or in Corregir, never by the app
  const pn = await device('pnota', { user: 'Noelia' })
  const ids = pn.use((m) => {
    const st = () => m.store.get(), run = () => st().runs.find((r) => r.code === 'A100'), unit = (i) => run().units[i]
    m.role.set('office')
    m.addLine('Packing', 'Línea 1'); m.addLine('RTE', 'Línea 1')
    const line = (dept) => st().lines.find((l) => l.dept === dept)
    clock = oct(10, 8, 0); m.startRun(line('Packing'), 'A100', '6283', DAY, 36)
    const id = run().id
    // "Pallet completo" with a comment typed on two lines and with spaces around it: kept on one line, as it reads
    clock = oct(10, 8, 30); m.palletDone(id, [{ lot: '6283', qty: 20, tag: '3100' }, { lot: '6284', qty: 16, tag: '3101' }], '', '  Pallet con dos lotes:\n  se acabó el 6283  ')
    eq('el pallet lleva su comentario, en una línea; el resto del pallet como siempre', [unit(0).note, unit(0).qty, unit(0).ref, unit(0).lots], ['Pallet con dos lotes: se acabó el 6283', 36, '3100, 3101', [{ lot: '6283', qty: 20, tag: '3100' }, { lot: '6284', qty: 16, tag: '3101' }]])
    // blank, or only spaces: the pallet has no comment at all (no key); the run's own comment is another thing
    clock = oct(10, 9, 0); m.palletDone(id, [{ lot: '6284', qty: 36, tag: '3102' }], '', '   ')
    eq('sin comentario: el pallet no lleva la marca, y la corrida no lleva comentario propio por eso', ['note' in unit(1), unit(1).ref, m.noteOf(run())], [false, '3102', ''])
    // a cart of a room without lots, with a comment longer than the box takes: cut where the box cuts
    clock = oct(10, 9, 5); m.startRun(line('RTE'), 'B200', '6283', DAY, 240)
    const rte = st().runs.find((r) => r.code === 'B200').id
    clock = oct(10, 9, 10); m.unitDone(rte, 240, '', undefined, undefined, 'x'.repeat(400))
    eq('un carro con comentario de más de 300 caracteres: quedan 300', st().runs.find((r) => r.id === rte).units[0].note.length, 300)
    eq('sube al servidor dentro de cada unidad', m.outbox.items().find((i) => i.table === 'act_runs' && i.key === id).row.units.map((u) => u.note ?? null), ['Pallet con dos lotes: se acabó el 6283', null])
    // the tags window (fillUnit): the comment is kept when nothing is said of it, written when it is
    clock = oct(10, 9, 20); m.fillUnit(id, unit(1).at, 36, [{ lot: '6284', qty: 36, tag: '3102' }], '3102')
    eq('poner el tag no toca el comentario (ni pone uno)', 'note' in unit(1), false)
    m.fillUnit(id, unit(1).at, 36, [{ lot: '6284', qty: 36, tag: '3102' }], '3102', 'Tag puesto después')
    eq('escrito en la ventana de los tags, queda', unit(1).note, 'Tag puesto después')
    // a pallet added after the fact ("Agregar pallet") with a comment: on the pallet and in its history line
    clock = oct(10, 9, 30); const at = m.addUnit(id, { at: oct(10, 8, 45), qty: null, lots: [{ lot: '6283', qty: 30, tag: '3099' }], note: ' Encontrado en el piso ' })
    eq('agregado después: el comentario va en el pallet y en el historial', [run().units.find((u) => u.at === at).note, st().changes.filter((c) => c.refKey === id && c.what.includes('Se agregó pallet')).map((c) => [c.what.split(' · ').pop(), c.after])], ['Encontrado en el piso', [['Se agregó pallet 2 (8:45 AM)', '30 cajas · 6283: 30 (tag 3099) · Comentario: Encontrado en el piso']]])
    // Corregir: the form opens with each pallet's comment; corrected or cleared there, the history says it, pallet by pallet
    const opened = m.draftOf(run())
    eq('Corregir abre con el comentario de cada pallet', opened.units.map((u) => u.note ?? null), ['Pallet con dos lotes: se acabó el 6283', 'Encontrado en el piso', 'Tag puesto después'])
    clock = oct(10, 10, 0)
    m.applyDraft(id, opened, { ...opened, units: opened.units.map((u, i) => (i === 0 ? { ...u, note: ' Pallet con dos lotes ' } : i === 2 ? { ...u, note: '' } : u)) })
    eq('corregido uno y borrado otro: quedan así (el borrado, con la marca vacía); el de en medio no se toca', run().units.map((u) => u.note ?? null), ['Pallet con dos lotes', 'Encontrado en el piso', ''])
    const lines = () => st().changes.filter((c) => c.refKey === id && c.what.endsWith('· Comentario')).map((c) => [c.what.split(' · ').slice(-2).join(' · '), c.before, c.after])
    eq('el historial lo dice, pallet por pallet (también el escrito en la ventana de los tags)', lines(), [['Pallet 2 · Comentario', '', 'Tag puesto después'], ['Pallet 1 · Comentario', 'Pallet con dos lotes: se acabó el 6283', 'Pallet con dos lotes'], ['Pallet 3 · Comentario', 'Tag puesto después', '']])
    // saving the form without touching the comments changes nothing of them; a form of before (its units without the key) neither
    clock = oct(10, 10, 5)
    const o2 = m.draftOf(run()); m.applyDraft(id, o2, { ...o2, lot: '6283' })
    const bare = { ...o2, units: o2.units.map(({ note: _n, ...u }) => u) }; m.applyDraft(id, bare, { ...bare, lot: '6290' })
    eq('corregir otra cosa, también desde un formulario sin comentarios, no los toca', [run().lot, run().units.map((u) => u.note ?? null), lines().length], ['6290', ['Pallet con dos lotes', 'Encontrado en el piso', ''], 3])
    // a record added after the fact with a comment on one of its pallets: on that pallet only
    clock = oct(10, 10, 30); m.endRun(id)
    const later = m.addRunLater({ dept: 'Packing', lineId: line('Packing').id, code: 'C300', lot: '6283', date: DAY, startedAt: oct(10, 12, 0), endedAt: oct(10, 13, 0), units: [{ qty: null, lots: [{ lot: '6283', qty: 36, tag: '4001' }], note: ' sin film ' }, { qty: null, lots: [{ lot: '6283', qty: 36, tag: '4002' }] }], perUnit: 36 })
    eq('un registro agregado después con un comentario en un pallet: queda en ese pallet solo', st().runs.find((r) => r.id === later).units.map((u) => u.note ?? null), ['sin film', null])
    // the report: each pallet with its comment, the search finds it by it, and the Excel has it last (Pallets and Unidades)
    clock = oct(10, 14, 0)
    const rep = m.reportOf(st(), DAY, clock)
    eq('el reporte: cada pallet con su comentario', rep.pallets.filter((p) => p.r.id === id).map((p) => [p.n, p.note]), [[1, 'Pallet con dos lotes'], [2, 'Encontrado en el piso'], [3, '']])
    const found = (q, kind) => m.searchReport(st(), rep, q).hits.filter((h) => h.kind === kind).map((h) => h.key)
    eq('la búsqueda encuentra el pallet por su comentario, y el carro por el suyo', [found('encontrado piso', 'pallet'), found('dos lotes', 'pallet'), found('xxxx', 'unit').length, found('xxxx', 'pallet').length], [['pallet:' + id + ':2'], ['pallet:' + id + ':1'], 1, 0])
    const pal = m.palletsSheet(st(), rep), uni = m.unitsSheet(st(), rep)
    eq('el Excel, Pallets: la columna Comentario, la última, en la primera línea de cada pallet', [pal[0].at(-1), pal.slice(1).map((row) => [row[2], row[0], row[3], row.at(-1)])], ['Comentario', [['A100', 1, '6283', 'Pallet con dos lotes'], ['A100', 1, '6284', ''], ['A100', 2, '6283', 'Encontrado en el piso'], ['A100', 3, '6284', ''], ['C300', 1, '6283', 'sin film'], ['C300', 2, '6283', '']]])
    eq('y Unidades, igual, también el carro de RTE', [uni[0].at(-1), uni.slice(1).map((row) => [row[0], row[2], row[4], row.at(-1)])], ['Comentario', [['Packing', 'A100', 1, 'Pallet con dos lotes'], ['Packing', 'A100', 1, 'Pallet con dos lotes'], ['Packing', 'A100', 2, 'Encontrado en el piso'], ['Packing', 'A100', 3, ''], ['RTE', 'B200', 1, 'x'.repeat(300)], ['Packing', 'C300', 1, 'sin film'], ['Packing', 'C300', 2, '']]])
    return { id, rte }
  })
  // the app opened again (a reload, an update): every pallet's comment is read back, the cleared one as cleared
  const stored = pn.use(() => JSON.parse(localStorage.getItem('act_v1')))
  const again = await device('pnota-otra-vez', { seed: stored, user: 'Noelia' })
  again.use((m) => {
    const r = (id) => m.store.get().runs.find((x) => x.id === id)
    eq('al volver a abrir la app, los comentarios de los pallets siguen (el borrado, como borrado)', [r(ids.id).units.map((u) => u.note ?? null), r(ids.rte).units[0].note.length], [['Pallet con dos lotes', 'Encontrado en el piso', ''], 300])
    // a run that arrives from the server (another device): each unit's comment is read the same way, cleaned; what is not text is no comment
    m.applyRemote('act_runs', runRow({ id: 'r-sv', dept: 'Packing', startedAt: oct(10, 11, 0), endedAt: oct(10, 12, 0), units: [{ at: oct(10, 11, 30), qty: 36, ref: '5', by: 'Ana', lots: [{ lot: '6283', qty: 36, tag: '5' }], note: '  del servidor \n ok ' }, { at: oct(10, 11, 40), qty: 36, ref: '6', by: 'Ana', note: 7 }] }))
    eq('una corrida que llega del servidor: el comentario de cada unidad se lee igual, limpio', m.store.get().runs.find((r) => r.id === 'r-sv').units.map((u) => ('note' in u ? u.note : null)), ['del servidor ok', null])
  })
}
section('El comentario de un pallet no se pierde cuando otra tablet cambia la misma corrida, ni con una versión de la app de antes')
{
  // Two tablets change the same run from the same version: the office corrects a pallet's comment in Corregir while
  // the line, without signal, finishes the next pallet (with a comment of its own). Units are matched by their moment:
  // the corrected one keeps its correction, the new one comes with its comment, whichever reaches the server first
  const line = await device('pnota-linea', { user: 'Lucía' }), office = await device('pnota-oficina', { user: 'Jose' })
  const both = [line, office]
  const settle2 = () => { for (let n = 0; n < 20; n++) { if (!both.some((d) => first(d))) return; for (const d of both) send(d, both) } throw new Error('las dos tablets no terminan de ponerse de acuerdo') }
  const runAt = (d, id) => d.use((m) => m.store.get().runs.find((r) => r.id === id))
  const look = (r) => ({ notes: r.units.map((u) => u.note ?? null), pallets: r.units.map((u) => u.ref), lot: r.lot })
  const agree = (what, id, want) => {
    eq(what + ' · línea', look(runAt(line, id)), want)
    eq(what + ' · oficina', look(runAt(office, id)), want)
    const sv = server.get('act_runs|' + id)
    eq(what + ' · servidor', look({ units: sv.units, lot: sv.lot }), want)
    eq(what + ' · nada pendiente', both.map((d) => d.use((m) => m.outbox.size())), [0, 0])
  }
  const fixNote = (d, id, i, note) => d.use((m) => { const o = m.draftOf(runAt(d, id)); m.applyDraft(id, o, { ...o, units: o.units.map((u, k) => (k === i ? { ...u, note } : u)) }) })
  const hearServer = (d, id) => d.use((m) => m.applyRemote('act_runs', server.get('act_runs|' + id)))
  clock = oct(10, 6, 0)
  line.use((m) => { m.addLine('Packing', 'Línea 1'); m.startRun(m.store.get().lines[0], 'A100', '6283', DAY, 36) })
  const id = line.use((m) => m.store.get().runs[0].id)
  clock = oct(10, 6, 30); line.use((m) => m.palletDone(id, [{ lot: '6283', qty: 36, tag: '3100' }], '', 'Film roto, se cambió'))
  settle2()
  // the office's version reaches the server first; the line comes back, merges its new pallet into it and sends it
  clock = oct(10, 7, 0); fixNote(office, id, 0, 'Film roto, se cambió en el turno 1')
  clock = oct(10, 7, 5); line.use((m) => m.palletDone(id, [{ lot: '6283', qty: 36, tag: '3101' }], '', 'Pallet 2 ok'))
  send(office, [office])
  hearServer(line, id); settle2()
  agree('la corrección de la oficina y el pallet nuevo de la línea, con su comentario, quedan los dos', id, { notes: ['Film roto, se cambió en el turno 1', 'Pallet 2 ok'], pallets: ['3100', '3101'], lot: '6283' })
  // the other way round: the line's version first (a comment written in the tags window), then the office's, which
  // cleared pallet 1's comment on purpose: it stays cleared
  clock = oct(10, 8, 0); line.use((m) => m.palletDone(id, [{ lot: '6283', qty: 36, tag: '3102' }], '', '')); settle2()
  clock = oct(10, 8, 10); line.use((m) => m.fillUnit(id, runAt(line, id).units[2].at, 36, [{ lot: '6283', qty: 36, tag: '3102' }], '3102', 'Sin PO todavía'))
  clock = oct(10, 8, 12); fixNote(office, id, 0, '')
  send(line, [line])
  hearServer(office, id); settle2()
  agree('al revés también: el comentario nuevo de la línea y el borrado de la oficina (que se queda borrado)', id, { notes: ['', 'Pallet 2 ok', 'Sin PO todavía'], pallets: ['3100', '3101', '3102'], lot: '6283' })
  clock = oct(10, 9, 0); line.use((m) => m.endRun(id, false)); settle2()
  // A tablet still on the build of before pallet comments (until it updates by itself) adds a pallet in Corregir: it
  // writes the run as it knows it, every pallet without its comment (those builds keep only at/qty/ref/by/lots/po).
  // A device with a change of its own waiting merges the comments back (the cleared one stays cleared); one with
  // nothing waiting takes the server's version as it is, as with the run's own comment
  const oldWrite = (at, tag) => {
    const was = server.get('act_runs|' + id)
    const row = { ...was, units: [...was.units.map(({ note: _gone, ...u }) => u), { at, qty: 36, ref: tag, by: 'Tablet vieja', lots: [{ lot: '6283', qty: 36, tag }] }].sort((a, b) => a.at - b.at), updated_at: iso(clock), updated_by: 'Tablet vieja' }
    land({ table: 'act_runs', key: id, row })
  }
  clock = oct(10, 9, 30); fixNote(office, id, 1, 'Pallet 2 ok, revisado') // the office corrects a comment, without signal yet
  oldWrite(oct(10, 8, 50), '3103')
  hearServer(line, id)
  eq('la tablet de la línea, sin cambios suyos, toma la versión del servidor tal cual: sin comentarios en los pallets, y no escribe nada', [look(runAt(line, id)).notes, line.use((m) => m.outbox.size())], [[null, null, null, null], 0])
  hearServer(office, id); settle2()
  agree('la oficina, con un cambio suyo, los junta con esa versión: vuelven los comentarios (el borrado, borrado) y queda el pallet de la tablet vieja', id, { notes: ['', 'Pallet 2 ok, revisado', 'Sin PO todavía', null], pallets: ['3100', '3101', '3102', '3103'], lot: '6283' })
}

section('Un comentario y un tag en el mismo pallet desde dos tablets: quedan los dos (revisión 2026-10-18)')
{
  // The lots window invites the line to leave a tag blank and put it later; the office, meanwhile, comments on that
  // same pallet in Corregir. The unit's comment merges apart from the rest of the unit (mergeUnit: the rule of
  // mergeNote, unit by unit): whichever version reaches the server first, the tag and the comment both stay, on the
  // line, in the office and on the server, and the line's history agrees with the row (before, the corrected unit
  // went whole and one of the two was lost in either order)
  const line = await device('ptag-linea', { user: 'Lucía' }), office = await device('ptag-oficina', { user: 'Jose' })
  const both = [line, office]
  const settle2 = () => { for (let n = 0; n < 20; n++) { if (!both.some((d) => first(d))) return; for (const d of both) send(d, both) } throw new Error('las dos tablets no terminan de ponerse de acuerdo') }
  const runAt = (d, id) => d.use((m) => m.store.get().runs.find((r) => r.id === id))
  const look = (r) => r.units.map((u) => [u.ref, (u.lots ?? []).map((l) => l.tag).join(','), u.note ?? null])
  const agree = (what, id, want) => {
    eq(what + ' · línea', look(runAt(line, id)), want)
    eq(what + ' · oficina', look(runAt(office, id)), want)
    eq(what + ' · servidor', look(server.get('act_runs|' + id)), want)
    eq(what + ' · nada pendiente', both.map((d) => d.use((m) => m.outbox.size())), [0, 0])
  }
  const fixNote = (d, id, i, note) => d.use((m) => { const o = m.draftOf(runAt(d, id)); m.applyDraft(id, o, { ...o, units: o.units.map((u, k) => (k === i ? { ...u, note } : u)) }) })
  const putTag = (d, id, i, tag) => d.use((m) => m.fillUnit(id, runAt(d, id).units[i].at, 36, [{ lot: '6283', qty: 36, tag }], tag))
  const hearServer = (d, id) => d.use((m) => m.applyRemote('act_runs', server.get('act_runs|' + id)))
  clock = oct(10, 6, 0)
  line.use((m) => { m.addLine('Packing', 'Línea 1'); m.startRun(m.store.get().lines[0], 'A100', '6283', DAY, 36) })
  const id = line.use((m) => m.store.get().runs[0].id)
  // pallet 1 done without its tag; the office comments on it first (its version lands first); the line, from the
  // version without the comment, puts the tag
  clock = oct(10, 6, 30); line.use((m) => m.palletDone(id, [{ lot: '6283', qty: 36, tag: '' }], '')); settle2()
  clock = oct(10, 7, 0); fixNote(office, id, 0, 'Pallet sin tag: revisar')
  clock = oct(10, 7, 5); putTag(line, id, 0, '3100')
  send(office, [office]); hearServer(line, id); settle2()
  agree('el comentario de la oficina llegó primero y la línea puso el tag después: quedan los dos', id, [['3100', '3100', 'Pallet sin tag: revisar']])
  // the other order: pallet 2 without its tag; the line's tag lands first; the office comments from the version without it
  clock = oct(10, 8, 0); line.use((m) => m.palletDone(id, [{ lot: '6283', qty: 36, tag: '' }], '')); settle2()
  clock = oct(10, 8, 10); putTag(line, id, 1, '3101')
  clock = oct(10, 8, 12); fixNote(office, id, 1, 'Pallet 2 sin tag: revisar')
  send(line, [line]); hearServer(office, id); settle2()
  agree('al revés: el tag de la línea llegó primero y la oficina comentó después: quedan los dos', id, [['3100', '3100', 'Pallet sin tag: revisar'], ['3101', '3101', 'Pallet 2 sin tag: revisar']])
  eq('el historial de la línea dice lo mismo que la fila', line.use((m) => m.store.get().changes.filter((c) => c.refKey === id && !c.deleted && c.what.endsWith('N° de tag')).map((c) => [c.before, c.after])), [['', '3100'], ['', '3101']])
  // a comment cleared on purpose by the office while the line corrects another pallet's tag: cleared it stays, the tag stays
  clock = oct(10, 9, 0); fixNote(office, id, 1, '')
  clock = oct(10, 9, 2); putTag(line, id, 0, '3100A')
  send(office, [office]); hearServer(line, id); settle2()
  agree('un comentario borrado a propósito mientras la línea corrige el tag de otro pallet: borrado queda, y el tag también', id, [['3100A', '3100A', 'Pallet sin tag: revisar'], ['3101', '3101', '']])
  // both comment on the same pallet from the same version: the one that merges keeps its own (the rule of the run's
  // comment, mergeNote), and nothing else of the pallet moves
  clock = oct(10, 9, 30); fixNote(office, id, 0, 'Lo vio la oficina')
  clock = oct(10, 9, 31); fixNote(line, id, 0, 'Lo vio la línea')
  send(office, [office]); hearServer(line, id); settle2()
  agree('las dos comentaron el mismo pallet: queda el de quien juntó las dos versiones (la línea), con su tag', id, [['3100A', '3100A', 'Lo vio la línea'], ['3101', '3101', '']])
}

// =====================================================================================================================
//  Production orders (Jose and the office clerk, 2026-10-19): "no es una cantidad por lote, es una cantidad por mezcla"
// =====================================================================================================================
section('Pedidos de producción: la cuenta de la oficina, día por día, con su propio ejemplo (Jose, 2026-10-19)')
{
  const wo = await device('wo', { user: 'Oficina' })
  wo.use((m) => {
    const st = () => m.store.get()
    /** moments of one day of October: n of them, `step` minutes apart */
    const mins = (d, h, mi, n, step = 1) => Array.from({ length: n }, (_, i) => oct(d, h, mi + i * step))
    // a run of a room that arrives from another tablet with one unit at each moment given
    let nr = 0
    const ranOn = (dept, code, date, ats, o = {}) => {
      const id = 'wo-run-' + ++nr
      const units = ats.map((at, i) => ({ at, qty: o.qty == null ? null : Array.isArray(o.qty) ? o.qty[i] : o.qty, ref: '', by: o.by ?? 'Luis', ...(o.lots?.[i] ? { lots: o.lots[i] } : {}) }))
      m.applyRemote('act_runs', { ...runRow({ id, dept, lineId: o.lineId ?? 'WL-' + dept, line: o.line ?? 'Línea 1', code, lot: o.lot ?? '6291', date, startedAt: ats[0] - M, endedAt: ats.at(-1) + M, units, perUnit: o.per ?? null }), ...(o.extra ? { extra: o.extra } : {}) })
      return id
    }
    const status = (id, today) => m.orderStatus(st(), m.workOrderOf(st(), id), today)
    const row = (x) => [x.date, x.programmed, x.made1, x.made2, x.made, x.pending, x.cumMade, x.disponible, x.sinProgramar]
    // ---- the office's example: 1000 mezclas; day 1 programmed 80, made 50; day 2 programmed 80, made 70 ----
    clock = oct(18, 6, 0)
    const A = m.saveWorkOrder({ dept: 'Kitchen', code: '0889', qty: 1000, unit: 'mezclas', startDate: '2026-10-18', wo: '4512', note: '' })
    m.setPlan('2026-10-18', 'Kitchen', '0889', 80, '', A)
    ranOn('Kitchen', '0889', '2026-10-18', mins(18, 8, 0, 30)) // shift 1
    ranOn('Kitchen', '0889', '2026-10-18', mins(18, 17, 0, 20)) // shift 2
    clock = oct(19, 6, 0)
    m.setPlan('2026-10-19', 'Kitchen', '0889', 80, '', A)
    ranOn('Kitchen', '0889', '2026-10-19', mins(19, 8, 0, 40))
    ranOn('Kitchen', '0889', '2026-10-19', mins(19, 17, 0, 30))
    const s19 = status(A, '2026-10-19')
    eq('día 18: de 1000 se programan 80 (920 sin programar); hicieron 50 (30 y 20): quedan 30, que vuelven: 950 disponibles', row(s19.byDay[0]), ['2026-10-18', 80, 30, 20, 50, 30, 50, 950, 920])
    eq('día 19: de los 950 se programan 80 (870); hicieron 70 (40 y 30): quedan 10: 870 + 10 = 880 disponibles', row(s19.byDay[1]), ['2026-10-19', 80, 40, 30, 70, 10, 120, 880, 870])
    eq('el pedido el 19: hechas 120, disponibles 880, pendientes del día 10, sin programar 870', [s19.made, s19.disponible, s19.pendingToday, s19.sinProgramar, s19.state, s19.over, s19.waiting], [120, 880, 10, 870, 'abierto', 0, false])
    clock = oct(20, 5, 0)
    const b20 = status(A, '2026-10-20')
    eq('el 20, sin programa todavía: los 10 volvieron al pedido, 880 disponibles y sin programar', [b20.disponible, b20.sinProgramar, b20.pendingToday], [880, 880, 0])
    m.setPlan('2026-10-20', 'Kitchen', '0889', 80, '', A)
    const s20 = status(A, '2026-10-20')
    eq('el 20 se programan 80 de los 880: 800 sin programar; el 19 sigue diciendo lo que dijo', [s20.disponible, s20.sinProgramar, s20.pendingToday, s20.byDay.map(row)], [880, 800, 80, [['2026-10-18', 80, 30, 20, 50, 30, 50, 950, 920], ['2026-10-19', 80, 40, 30, 70, 10, 120, 880, 870], ['2026-10-20', 80, 0, 0, 0, 80, 120, 880, 800]]])
    // the order's window says each day in the office's own words (src/woSum.ts), with the very same numbers
    const dd = (d) => d.slice(8) + '/' + d.slice(5, 7)
    eq('la cuenta de la oficina en palabras: 1000 − 80 → 920; hicieron 50: 920 + 30 = 950; 950 − 80 → 870; hicieron 70: 870 + 10 = 880', s19.byDay.map((d) => m.orderDayLine(d, 1000, '2026-10-20', dd)), ['18/10: de 1,000 disponibles se programaron 80 → quedan 920 sin programar. Se hicieron 50 → quedaron 30 pendientes, que vuelven al pedido: 920 + 30 = 950 disponibles.', '19/10: de 950 disponibles se programaron 80 → quedan 870 sin programar. Se hicieron 70 → quedaron 10 pendientes, que vuelven al pedido: 870 + 10 = 880 disponibles.'])
    eq('el 20, hoy: de los 880 se programan 80 → 800 sin programar; lo que no se haga vuelve al pedido', m.orderDayLine(s20.byDay[2], 1000, '2026-10-20', dd), '20/10 (hoy): de 880 disponibles se programaron 80 → quedan 800 sin programar. Van 0, faltan 80; lo que no se haga hoy vuelve al pedido.')
    eq('lo disponible para programar cada mañana (el diálogo del programa, el 20): 1000 el 18, 950 el 19, 880 el 20; el 21, los 880 menos las 80 que el 20 ya tiene programadas', ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'].map((d) => m.availOn(m.workOrderOf(st(), A), s20, d, '2026-10-20')), [1000, 950, 880, 800])
    eq('un día que completa el pedido con de más: lo disponible esa mañana es el total menos lo de antes (140), no 0 + lo hecho', m.orderDayLine({ date: '2026-10-18', programmed: 240, made: 240, pending: 0, cumMade: 600, disponible: 0 }, 500, '2026-10-20', dd), '18/10: de 140 disponibles se programaron 240 y se hicieron 240: el pedido se completó (100 de más).')
    eq('un día sin programa, y uno que hizo más de lo programado', [m.orderDayLine({ date: '2026-10-18', programmed: 0, made: 60, pending: 0, cumMade: 60, disponible: 240 }, 300, '2026-10-20', dd), m.orderDayLine({ date: '2026-10-18', programmed: 50, made: 60, pending: 0, cumMade: 60, disponible: 240 }, 300, '2026-10-20', dd)], ['18/10: sin programa ese día. Se hicieron 60: quedan 300 − 60 = 240 disponibles.', '18/10: de 300 disponibles se programaron 50 y se hicieron 60, más de lo programado: quedan 300 − 60 = 240 disponibles.'])
    eq('las libras con sus decimales', [m.woN(1543.4), m.woN(2950.7), m.woN(1000)], ['1,543.4', '2,950.7', '1,000'])
    eq('"ayer quedaron 10 pendientes de 0889": vuelven al pedido, y no se programa nada solo', [m.prevPending(st(), 'Kitchen', '2026-10-20'), m.planOf(st(), '2026-10-21', 'Kitchen')], [[{ code: '0889', lot: '', n: 10, unit: 'mezclas', date: '2026-10-19', orderId: A, was: '' }], []])
    eq('la tarjeta del cuarto sigue con sus números del día (hecho, por turno, pendiente) y dice de qué pedido es', m.planRows(st(), '2026-10-19', 'Kitchen').map((r) => [r.code, r.planned, r.done, r.byShift, r.left, r.orderId]), [['0889', 80, 70, [40, 30], 10, A]])
    eq('el pedido se guarda con su código como lo escribe la app, su unidad, su WO, quién y cuándo', [m.workOrderOf(st(), A).code, m.workOrderOf(st(), A).unit, m.workOrderOf(st(), A).wo, m.workOrderOf(st(), A).createdBy, m.workOrderOf(st(), A).createdAt], ['889', 'mezclas', '4512', 'Oficina', oct(18, 6, 0)])
    eq('y sube a su tabla, y el programa con su pedido', [m.outbox.items().find((i) => i.table === 'act_work_orders' && i.key === A)?.row.qty, m.outbox.items().find((i) => i.table === 'act_plan' && i.key === '2026-10-18|Kitchen|889')?.row.order_id], [1000, A])

    // ---- a day with one shift ----
    clock = oct(21, 5, 0)
    m.setDayShifts('2026-10-21', 2)
    const K2 = m.saveWorkOrder({ dept: 'Kitchen', code: 'K2', qty: 100, unit: 'mezclas', startDate: '2026-10-21', wo: '', note: '' })
    ranOn('Kitchen', 'K2', '2026-10-21', [...mins(21, 8, 0, 5), ...mins(21, 18, 0, 5)])
    eq('un día de un solo turno (solo el 2): todo lo hecho es de ese turno', status(K2, '2026-10-21').byDay.map((x) => [x.made1, x.made2, x.made]), [[0, 10, 10]])

    // ---- an order with a lot (Jose, 2026-10-20): only that lot counts for it; an order without a lot takes any ----
    clock = oct(21, 5, 1)
    const LA = m.saveWorkOrder({ dept: 'Kitchen', code: 'L1', lot: ' 6290 ', qty: 50, unit: 'mezclas', startDate: '2026-10-21', wo: '', note: '' })
    clock = oct(21, 5, 2)
    const LB = m.saveWorkOrder({ dept: 'Kitchen', code: 'L1', qty: 100, unit: 'mezclas', startDate: '2026-10-21', wo: '', note: '' })
    ranOn('Kitchen', 'L1', '2026-10-21', mins(21, 8, 0, 4), { lot: '6292' })
    ranOn('Kitchen', 'L1', '2026-10-21', mins(21, 9, 0, 3), { lot: '6290', lineId: 'WL-K2', line: 'Braiser 2' })
    eq('el pedido con lote 6290 (el más viejo) toma solo las 3 de su lote; las 4 del 6292 van al pedido sin lote', [status(LA, '2026-10-21').made, status(LB, '2026-10-21').made], [3, 4])
    eq('su lote se guarda sin espacios, sube con el pedido y queda en la historia', [m.workOrderOf(st(), LA).lot, m.outbox.items().find((i) => i.table === 'act_work_orders' && i.key === LA)?.row.lot, st().changes.some((c) => c.after.includes('lote 6290'))], ['6290', '6290', true])
    m.saveWorkOrder({ dept: 'Kitchen', code: 'L1', lot: '', qty: 50, unit: 'mezclas', startDate: '2026-10-21', wo: '', note: '' }, LA)
    eq('sin lote otra vez: toma lo más viejo de cualquier lote (las 4 del 6292 primero) y la historia dice el cambio', [status(LA, '2026-10-21').made, status(LB, '2026-10-21').made, st().changes.some((c) => c.what.endsWith('· Lote') && c.before === '6290' && c.after === '')], [7, 0, true])
    m.saveWorkOrder({ dept: 'Kitchen', code: 'L1', lot: '6290', qty: 50, unit: 'mezclas', startDate: '2026-10-21', wo: '', note: '' }, LA)
    const kept = JSON.parse(localStorage.getItem('act_v1')).workOrders.find((o) => o.id === LA)
    eq('al abrir la app otra vez el pedido sigue con su lote (lo que load() lee)', kept?.lot, '6290')
    eq('un pedido del servidor sin la columna (antes del 022) queda sin lote', m.workOrderOf(st(), LB).lot, '')

    // ---- the moment an order is complete ----
    clock = oct(22, 5, 0)
    const C1 = m.saveWorkOrder({ dept: 'Kitchen', code: 'C9', qty: 100, unit: 'mezclas', startDate: '2026-10-22', wo: 'WO-1', note: '' })
    clock = oct(22, 5, 1)
    const C2 = m.saveWorkOrder({ dept: 'Kitchen', code: 'C9', qty: 50, unit: 'mezclas', startDate: '2026-10-22', wo: 'WO-2', note: '' })
    const runC = ranOn('Kitchen', 'C9', '2026-10-22', mins(22, 6, 0, 120), { line: 'Braiser 3', by: 'Luis' })
    const c1 = status(C1, '2026-10-22'), c2 = status(C2, '2026-10-22')
    eq('se completa con la mezcla 100: cuál, de qué corrida y línea, quién, cuándo y de qué día', [c1.state, c1.made, c1.completedAt, c1.completedBy, c1.finishDay, c1.finishAt, c1.disponible], ['completado', 100, oct(22, 6, 99), { runId: runC, k: 100, at: oct(22, 6, 99), day: '2026-10-22', shift: 1, n: 1, by: 'Luis', line: 'Braiser 3' }, '2026-10-22', oct(22, 6, 99), 0])
    eq('la 101 ya es del pedido siguiente', [c2.made, c2.state, c2.disponible, c2.finishDay], [20, 'abierto', 30, ''])
    eq('las corridas que contaron, con cuánto dio cada una a cada pedido', [c1.runs, c2.runs], [[{ runId: runC, day: '2026-10-22', units: 100, n: 100 }], [{ runId: runC, day: '2026-10-22', units: 20, n: 20 }]])

    // ---- two or three orders of one code: the oldest first ----
    const save = (code, qty, start, wo) => m.saveWorkOrder({ dept: 'Kitchen', code, qty, unit: 'mezclas', startDate: start, wo, note: '' })
    clock = oct(23, 5, 0); const X = save('F1', 10, '2026-10-12', 'X')
    clock = oct(23, 5, 1); const Y = save('F1', 10, '2026-10-12', 'Y')
    clock = oct(23, 5, 2); const Z = save('F1', 10, '2026-10-11', 'Z')
    ranOn('Kitchen', 'F1', '2026-10-10', mins(10, 8, 0, 3)) // before any of them starts
    ranOn('Kitchen', 'F1', '2026-10-11', mins(11, 8, 0, 4))
    ranOn('Kitchen', 'F1', '2026-10-12', mins(12, 8, 0, 20))
    const made = () => [X, Y, Z].map((id) => { const x = status(id, '2026-10-23'); return [x.made, x.state] })
    eq('el más viejo primero: el que empieza antes (Z), y de dos del mismo día el que se escribió antes (X, luego Y); lo de antes de empezar no cuenta para nadie', made(), [[10, 'completado'], [4, 'abierto'], [10, 'completado']])
    eq('el diálogo del programa ofrece los abiertos de ese código, el más viejo primero', [m.openWorkOrdersFor(st(), 'Kitchen', 'F1', '', '2026-10-12'), m.openWorkOrdersFor(st(), 'Kitchen', 'F1', '', '2026-10-10')].map((l) => l.map((o) => o.wo)), [['Y'], []])
    clock = oct(23, 6, 0); m.setPlan('2026-10-12', 'Kitchen', 'F1', 6, '', Y)
    eq('un programa del día que nombra a Y: Y se lleva las primeras 6 de ese día; lo demás, el más viejo primero', [made(), status(Y, '2026-10-23').byDay.map(row)], [[[8, 'abierto'], [6, 'abierto'], [10, 'completado']], [['2026-10-12', 6, 6, 0, 6, 0, 6, 4, 4]]])
    clock = oct(23, 6, 2); m.setPlan('2026-10-12', 'Kitchen', 'F1', 0)
    eq('quitado ese programa, todo vuelve al más viejo primero', made(), [[10, 'completado'], [4, 'abierto'], [10, 'completado']])
    clock = oct(12, 8, 8) + 30_000; m.closeWorkOrder(X)
    const x = m.workOrderOf(st(), X)
    eq('cerrar a mano: desde ese momento no se lleva nada (X 3), lo que sigue va al siguiente (Y completo)', [made(), x.closedBy, x.closedAt, status(X, '2026-10-23').finishDay], [[[3, 'cerrado'], [10, 'completado'], [10, 'completado']], 'Oficina', oct(12, 8, 8) + 30_000, '2026-10-12'])
    eq('cerrado no se cierra otra vez', m.closeWorkOrder(X), false)
    clock = oct(23, 7, 0); m.reopenWorkOrder(X)
    eq('reabierto: cuenta como si nunca se hubiera cerrado', made(), [[10, 'completado'], [4, 'abierto'], [10, 'completado']])
    clock = oct(23, 7, 2); m.deleteWorkOrder(Z)
    eq('uno borrado (puesto por error) suelta lo suyo: cuenta para los otros', made(), [[10, 'completado'], [10, 'completado'], [0, 'borrado']])
    eq('y sale de la lista de pedidos (el último terminado primero)', m.ordersOf(st(), 'Kitchen', '2026-10-23').filter((r) => r.order.code === 'F1').map((r) => r.order.wo), ['Y', 'X'])
    const hist = (id) => st().changes.filter((c) => c.refTable === 'act_work_orders' && c.refKey === id).map((c) => [c.what, c.dept, c.before, c.after])
    eq('el historial de X: lo escribió la oficina, lo cerró, lo reabrió', hist(X), [['Pedido de producción nuevo · Kitchen · F1', 'Kitchen', '', '10 mezclas desde 2026-10-12 · WO X'], ['Pedido de producción F1 WO X (Kitchen) · Cerrado', 'Kitchen', '', 'cerrado'], ['Pedido de producción F1 WO X (Kitchen) · Reabierto', 'Kitchen', 'cerrado', 'abierto']])
    eq('y el de Z, borrado', hist(Z).at(-1), ['Pedido de producción F1 WO Z (Kitchen) · Borrado', 'Kitchen', '10 mezclas', ''])
    clock = oct(23, 8, 0)
    eq('cambiarlo: total, WO, día de inicio y nota; el cuarto, el código y la unidad no se cambian', [m.saveWorkOrder({ dept: 'RTE', code: 'ZZ', qty: 12, unit: 'pouches', startDate: '2026-10-12', wo: 'X2', note: ' para  el cliente ' }, X), m.workOrderOf(st(), X).dept, m.workOrderOf(st(), X).code, m.workOrderOf(st(), X).unit, m.workOrderOf(st(), X).qty, m.workOrderOf(st(), X).note, hist(X).slice(3)], [X, 'Kitchen', 'F1', 'mezclas', 12, 'para el cliente', [['Pedido de producción F1 WO X2 (Kitchen) · Total', 'Kitchen', '10 mezclas', '12 mezclas'], ['Pedido de producción F1 WO X2 (Kitchen) · WO', 'Kitchen', 'X', 'X2'], ['Pedido de producción F1 WO X2 (Kitchen) · Nota', 'Kitchen', '', 'para el cliente']]])
    const n0 = st().workOrders.length
    eq('no se guarda: sin cantidad, sin código, sin día, con una unidad que el cuarto no cuenta, en un cuarto que no existe', [m.saveWorkOrder({ dept: 'Kitchen', code: 'Q', qty: 0, unit: 'mezclas', startDate: '2026-10-23', wo: '', note: '' }), m.saveWorkOrder({ dept: 'Kitchen', code: ' ', qty: 5, unit: 'mezclas', startDate: '2026-10-23', wo: '', note: '' }), m.saveWorkOrder({ dept: 'Kitchen', code: 'Q', qty: 5, unit: 'mezclas', startDate: 'hoy', wo: '', note: '' }), m.saveWorkOrder({ dept: 'Kitchen', code: 'Q', qty: 5, unit: 'lb', startDate: '2026-10-23', wo: '', note: '' }), m.saveWorkOrder({ dept: 'QC', code: 'Q', qty: 5, unit: 'mezclas', startDate: '2026-10-23', wo: '', note: '' }), st().workOrders.length], [null, null, null, null, null, n0])

    // ---- each room in its own unit ----
    clock = oct(24, 5, 0)
    const add = (dept, code, qty, unit) => m.saveWorkOrder({ dept, code, qty, unit, startDate: '2026-10-24', wo: '', note: '' })
    const R = add('RTE', 'R5', 1000, 'pouches')
    const runR = ranOn('RTE', 'R5', '2026-10-24', mins(24, 7, 0, 6, 10), { qty: 240, per: 240 })
    const r = status(R, '2026-10-24')
    eq('RTE: un pedido de 1000 pouches se completa con el carro 5, que no se parte (1200: 200 de más); el carro 6 no es de nadie', [r.made, r.over, r.disponible, r.state, r.completedBy.k, r.runs], [1200, 200, 0, 'completado', 5, [{ runId: runR, day: '2026-10-24', units: 5, n: 1200 }]])
    const P = add('Packing', 'P5', 315, 'cajas')
    ranOn('Packing', 'P5', '2026-10-24', mins(24, 8, 0, 3, 20), { qty: 105, per: 105, lot: '6297', lots: [null, [{ lot: '6297', qty: 50 }, { lot: '6298', qty: 55 }], null] })
    ranOn('Packing', 'P5', '2026-10-24', mins(24, 9, 30, 2), { qty: 50, extra: { bin: 'platos' } })
    const p = status(P, '2026-10-24')
    eq('Packing: cada pallet cuenta sus cajas (uno de dos lotes, entero); los bins de una línea de Packing no son cajas', [p.made, p.state, [...p.lots].sort()], [315, 'completado', ['6297', '6298']])
    const M1 = add('MFO', 'M5', 100, 'platos'), M2 = add('MFO', 'M5', 40, 'copas')
    ranOn('MFO', 'M5', '2026-10-24', mins(24, 10, 0, 2), { qty: 60, extra: { bin: 'platos' } })
    ranOn('MFO', 'M5', '2026-10-24', mins(24, 11, 0, 1), { qty: 50, extra: { bin: 'copas' } })
    ranOn('MFO', 'M5', '2026-10-24', mins(24, 12, 0, 1), { qty: 30 }) // a bin of before 2026-10-17: it counted cases
    eq('MFO: un pedido de platos cuenta los bins de platos; uno de copas, los de copas; los de cajas de antes, ninguno', [M1, M2].map((id) => [status(id, '2026-10-24').made, status(id, '2026-10-24').state]), [[120, 'completado'], [50, 'completado']])
    const S1 = add('Spiral', 'S5', 3000, 'lb'), S2 = add('Spiral', 'S5', 10, 'mezclas')
    ranOn('Spiral', 'S5', '2026-10-24', mins(24, 13, 0, 2), { qty: [1543.4, 1407.3], extra: { measure: 'lb' } })
    ranOn('Spiral', 'S5', '2026-10-24', mins(24, 14, 0, 2))
    eq('Spiral: uno en libras suma las libras de cada mezcla pesada; uno en mezclas cuenta las mezclas de siempre', [status(S1, '2026-10-24').made, status(S1, '2026-10-24').disponible, status(S2, '2026-10-24').made], [2950.7, 49.3, 2])
    eq('la unidad de cada pedido, como la dice la pantalla', [R, P, M1, M2, S1, S2, A].map((id) => m.orderUnitWord(m.workOrderOf(st(), id))), ['pouches', 'cajas', 'platos', 'copas', 'lb', 'mezclas', 'mezclas'])
    eq('la unidad que se ofrece para un pedido nuevo: la del cuarto, la de la tabla de productos en Spiral, la de los últimos bins en MFO', [m.orderUnitDefault(st(), 'RTE', 'R5'), m.orderUnitDefault(st(), 'Packing', 'P5'), m.orderUnitDefault(st(), 'MFO', 'M5'), m.orderUnitDefault(st(), 'MFO', 'NUEVO'), m.orderUnitDefault(st(), 'Spiral', 'S5'), m.orderUnitDefault(st(), 'Kitchen', 'A1')], ['pouches', 'cajas', 'copas', 'platos', 'mezclas', 'mezclas'])
    eq('las formas de escribir un código que se le piden al servidor', [m.codeVariants('0889'), m.codeVariants(' ab-1 '), m.codeVariants('1234567')], [['889', '0889', '00889', '000889'], ['AB-1', 'ab-1'], ['1234567']])

    // ---- a day's program and its order ----
    clock = oct(25, 6, 0)
    const L1 = m.saveWorkOrder({ dept: 'Kitchen', code: 'L7', qty: 200, unit: 'mezclas', startDate: '2026-10-25', wo: '7001', note: '' })
    const L2 = m.saveWorkOrder({ dept: 'Kitchen', code: 'L7', qty: 100, unit: 'mezclas', startDate: '2026-10-25', wo: '', note: '' })
    const key = '2026-10-25|Kitchen|L7', sentPlan = () => m.outbox.items().find((i) => i.table === 'act_plan' && i.key === key)?.row
    m.setPlan('2026-10-25', 'Kitchen', 'L7', 40, '', L1)
    eq('un programa con su pedido: sube con order_id', [sentPlan().order_id, m.planRows(st(), '2026-10-25', 'Kitchen').map((x) => x.orderId)], [L1, [L1]])
    clock = oct(25, 6, 3); m.setPlan('2026-10-25', 'Kitchen', 'L7', 40, '', L2)
    clock = oct(25, 6, 6); m.setPlan('2026-10-25', 'Kitchen', 'L7', 45)
    eq('cambiado sin decir de qué pedido: sigue siendo del suyo', [m.planOf(st(), '2026-10-25', 'Kitchen')[0].orderId, sentPlan().order_id], [L2, L2])
    clock = oct(25, 6, 9); m.setPlan('2026-10-25', 'Kitchen', 'L7', 45, '', null)
    clock = oct(25, 6, 12); m.setPlan('2026-10-25', 'Kitchen', 'L7', 45, '', null)
    eq('sin pedido: un programa del día como antes; la fila sube con order_id vacío (para que el servidor lo suelte)', [m.planOf(st(), '2026-10-25', 'Kitchen')[0].orderId, 'order_id' in sentPlan(), sentPlan().order_id, m.planRows(st(), '2026-10-25', 'Kitchen').map((x) => x.orderId)], [undefined, true, null, ['']])
    eq('el historial dice de qué pedido es el programa, y de cuál era', st().changes.filter((c) => c.refTable === 'act_plan' && c.refKey === key).map((c) => [c.what, c.before, c.after]), [['Programa 2026-10-25 · Kitchen · L7 · pedido WO 7001', '', '40'], ['Programa 2026-10-25 · Kitchen · L7 · pedido L7 desde 2026-10-25', '40 · pedido WO 7001', '40'], ['Programa 2026-10-25 · Kitchen · L7 · pedido L7 desde 2026-10-25', '40', '45'], ['Programa 2026-10-25 · Kitchen · L7', '45 · pedido L7 desde 2026-10-25', '45']])
    m.applyRemote('act_plan', { date: '2026-10-25', dept: 'RTE', code: 'OLD', qty: 5, lot: '', updated_at: iso(oct(25, 6, 20)) })
    m.applyRemote('act_plan', { date: '2026-10-25', dept: 'RTE', code: 'NEW', qty: 5, lot: '', order_id: L1, updated_at: iso(oct(25, 6, 20)) })
    m.applyRemote('act_plan', { date: '2026-10-25', dept: 'RTE', code: 'BAD', qty: 5, lot: '', order_id: 'no-es-un-id', updated_at: iso(oct(25, 6, 20)) })
    eq('del servidor: uno de antes del 020 (sin la columna) es un programa del día; uno con su pedido lo trae', ['OLD', 'NEW', 'BAD'].map((c) => m.planOf(st(), '2026-10-25', 'RTE').find((p) => p.code === c)?.orderId ?? ''), ['', L1, ''])

    // ---- orders from the server ----
    const U = (n) => '40000000-0000-4000-8000-' + String(n).padStart(12, '0')
    const woRow = (id, o = {}) => ({ id, dept: 'Kitchen', code: 'N1', wo: '', qty: 50, unit: 'mezclas', start_date: '2026-10-26', note: '', created_at: iso(oct(26, 5, 0)), created_by: 'Edgar', closed_at: null, closed_by: null, deleted: false, updated_at: iso(oct(26, 5, 0)), updated_by: 'Edgar', ...o })
    clock = oct(26, 9, 30)
    m.applyRemote('act_work_orders', woRow(U(1), { code: '0077' }))
    m.applyRemote('act_work_orders', woRow(U(1), { code: '0077', qty: '60', updated_at: iso(oct(26, 6, 0)) }))
    m.applyRemote('act_work_orders', woRow(U(1), { code: '0077', qty: 55, updated_at: iso(oct(26, 5, 30)) }))
    eq('del servidor: queda la versión más nueva (una vieja que llega tarde no la pisa), con su código como lo escribe la app', [m.workOrderOf(st(), U(1)).qty, m.workOrderOf(st(), U(1)).code, m.workOrderOf(st(), U(1)).createdBy], [60, '77', 'Edgar'])
    m.applyRemote('act_work_orders', woRow(U(2), { dept: 'QC' }))
    m.applyRemote('act_work_orders', woRow('no-es-un-id'))
    eq('uno de un cuarto que esta versión no conoce, o sin id de verdad, no entra', [m.workOrderOf(st(), U(2)), m.workOrderOf(st(), 'no-es-un-id')], [undefined, undefined])
    m.applyRemote('act_work_orders', woRow(U(1), { code: '0077', qty: 60, deleted: true, updated_at: iso(oct(26, 7, 0)) }))
    eq('uno borrado queda marcado, cuenta como borrado y sale de la lista', [m.workOrderOf(st(), U(1)).deleted, status(U(1), '2026-10-26').state, m.ordersOf(st(), null, '2026-10-26').some((x) => x.order.id === U(1))], [true, 'borrado', false])
    // a change waiting here and a newer one from the server: the newer one stands, and the history says what was not sent
    clock = oct(26, 8, 0)
    const Q = m.saveWorkOrder({ dept: 'Kitchen', code: 'N2', qty: 30, unit: 'mezclas', startDate: '2026-10-26', wo: '', note: '' })
    m.applyRemote('act_work_orders', woRow(Q, { code: 'N2', qty: 35, updated_at: iso(oct(26, 8, 5)) }))
    eq('un pedido que espera en la cola pierde con una versión hecha después en el servidor, y el historial lo dice', [m.outbox.items().some((i) => i.table === 'act_work_orders' && i.key === Q), m.workOrderOf(st(), Q).qty, st().changes.filter((c) => c.refKey === Q).map((c) => [c.what, c.by, c.before, c.after]).at(-1)], [false, 35, ['Pedido de producción N2 (Kitchen) · no se subió: Edgar lo cambió después', 'Oficina', '30 mezclas', '35 mezclas']])
    // a change waiting here, and an older one from another tablet of another field: both stand
    clock = oct(26, 9, 0)
    const W = m.saveWorkOrder({ dept: 'Kitchen', code: 'N3', qty: 40, unit: 'mezclas', startDate: '2026-10-26', wo: '', note: '' })
    const sentW = m.outbox.items().find((i) => i.table === 'act_work_orders' && i.key === W)
    m.markSent(sentW)
    clock = oct(26, 9, 10); m.closeWorkOrder(W)
    m.applyRemote('act_work_orders', { ...sentW.row, note: 'para el cliente X', updated_at: iso(oct(26, 9, 5)), updated_by: 'Edgar' })
    const qW = m.outbox.items().find((i) => i.table === 'act_work_orders' && i.key === W)
    eq('esta tablet lo cerró y otra le puso una nota antes: sube cerrado y con la nota, y así se ve aquí', [!!qW?.row.closed_at, qW?.row.note, qW?.row.updated_by, m.workOrderOf(st(), W).note, m.workOrderOf(st(), W).closedAt != null], [true, 'para el cliente X', 'Oficina', 'para el cliente X', true])
  })
  // the orders, a program's order and the closed accounts are stored fields: read back on every reload (the rule of
  // 2026-10-17: nothing below `let state = load()` is read in it, and every stored field gets this check)
  const saved = JSON.parse(disks.get('wo').get('act_v1'))
  const back = await device('wo-again', { seed: saved, user: 'Oficina' })
  const keptOf = (d) => d.use((m) => { const s = m.store.get(); return [s.workOrders, s.plans.filter((p) => p.orderId).map((p) => [p.date, p.dept, p.code, p.orderId]), s.orderSeals] })
  eq('al volver a abrir: los pedidos (los cerrados y los borrados también) y el pedido de cada programa, tal cual', keptOf(back), keptOf(wo))
  eq('lo guardado tiene pedidos cerrados, borrados y programas con pedido', back.use((m) => [m.store.get().workOrders.some((o) => o.closedAt != null), m.store.get().workOrders.some((o) => o.deleted), m.store.get().plans.some((p) => p.orderId)]), [true, true, true])
}

section('Pedidos de producción: un aparato guarda 14 días y un pedido dura más; lo terminado cierra su cuenta (2026-10-19)')
{
  const win = await device('wo-win', { user: 'Oficina' })
  let captured = null
  win.use((m) => {
    const st = () => m.store.get()
    const mins = (d, h, mi, n) => Array.from({ length: n }, (_, i) => oct(d, h, mi + i))
    let nr = 0
    const rows = []
    const ranOn = (code, date, ats) => { const row = runRow({ id: 'win-run-' + ++nr, dept: 'Kitchen', lineId: 'WK', line: 'Braiser 1', code, date, startedAt: ats[0] - M, endedAt: ats.at(-1) + M, units: ats.map((at) => unit(at, null, '', 'Luis')) }); rows.push(row); m.applyRemote('act_runs', row); return row }
    const save = (code, qty, start, wo = '') => m.saveWorkOrder({ dept: 'Kitchen', code, qty, unit: 'mezclas', startDate: start, wo, note: '' })
    clock = oct(2, 5, 0); const A = save('W1', 50, '2026-10-03', 'A')
    clock = oct(2, 5, 1); const B = save('W2', 100, '2026-10-05', 'B')
    clock = oct(2, 5, 2); const C = save('W3', 10, '2026-10-02', 'C')
    clock = oct(2, 5, 3); const D = save('W3', 100, '2026-10-02', 'D')
    const w1 = [ranOn('W1', '2026-10-03', mins(3, 8, 0, 30)), ranOn('W1', '2026-10-04', mins(4, 8, 0, 20))]
    ranOn('W2', '2026-10-05', mins(5, 8, 0, 40))
    ranOn('W3', '2026-10-02', mins(2, 8, 0, 15))
    m.applyRemote('act_plan', { date: '2026-10-05', dept: 'Kitchen', code: 'W2', qty: 40, lot: '', order_id: B, updated_at: iso(oct(4, 12, 0)) })
    m.applyRemote('act_plan', { date: '2026-10-05', dept: 'Kitchen', code: 'ZZ', qty: 9, lot: '', updated_at: iso(oct(4, 12, 0)) })
    clock = oct(31, 12, 0)
    eq('el 31 el aparato guarda desde el 18', m.firstKeptDay(), '2026-10-18')
    eq('lo que tiene que guardar por sus pedidos: cada código desde el primer día de sus pedidos sin cerrar', m.workNeeds(st()).map((n) => [n.q, n.from]).sort(), [['Kitchen|W1|', '2026-10-03'], ['Kitchen|W2|', '2026-10-05'], ['Kitchen|W3|', '2026-10-02']])
    m.prune()
    eq('lo viejo de los pedidos en juego se queda aparte (y el programa que nombra un pedido); lo demás se va', [st().runs.length, st().orderRuns.map((r) => r.code).sort(), st().plans.map((p) => [p.date, p.code])], [0, ['W1', 'W1', 'W2', 'W3'], [['2026-10-05', 'W2']]])
    const a0 = m.orderStatus(st(), m.workOrderOf(st(), A), '2026-10-31')
    eq('antes de bajar del servidor nada se cierra, y los números dicen que pueden faltar días', [st().orderSeals.length, a0.complete, a0.state, a0.made, a0.finishDay], [0, false, 'completado', 50, '2026-10-04'])
    m.markPulled(); m.prune()
    eq('bajado el servidor pero sin los días viejos de ese pedido: tampoco', [st().orderSeals.length, m.queueHeld('Kitchen|W1|', '2026-10-03'), m.queueHeld('Kitchen|W1|', '2026-10-20')], [0, false, true])
    m.markFetched('Kitchen|W1|', '2026-10-03')
    const before = m.orderStatus(st(), m.workOrderOf(st(), A), '2026-10-31')
    m.prune()
    const pick = (x) => [x.made, x.disponible, x.state, x.completedAt, x.completedBy, x.finishAt, x.finishDay, x.lots]
    const after = m.orderStatus(st(), m.workOrderOf(st(), A), '2026-10-31')
    const mark = m.outbox.items().find((i) => i.table === 'act_changes' && i.key === 'wodone:' + A)
    eq('terminado antes de los días que guarda: su cuenta se cierra, sube como marca de su cuarto, y sus corridas viejas se van', [before.complete, st().orderSeals.map((x) => x.id), mark?.row.ref_table, mark?.row.ref_key, mark?.row.dept, st().orderRuns.filter((r) => r.code === 'W1').length, after.sealed], [true, [A], 'act_work_orders:done', A, 'Kitchen', 0, true])
    eq('y sus números son los mismos, ahora de su cuenta', pick(after), pick(before))
    eq('la cuenta no guarda el día por día (la ventana del pedido lo trae del servidor): ni aquí ni en su marca', [after.byDay, 'byDay' in st().orderSeals[0], 'byDay' in JSON.parse(mark.row.after), before.byDay.length], [[], false, false, 2])
    m.prune()
    eq('otra poda: nada cambia (no vuelve a abrirse)', [pick(m.orderStatus(st(), m.workOrderOf(st(), A), '2026-10-31')), st().orderSeals.length], [pick(before), 1])
    m.markFetched('Kitchen|W3|', '2026-10-02'); m.prune()
    const c = m.orderStatus(st(), m.workOrderOf(st(), C), '2026-10-31')
    eq('C terminó, pero D, que se le cruza, sigue abierto: no se cierra ninguno; B abierto conserva lo suyo', [c.state, c.sealed, st().orderSeals.length, st().orderRuns.filter((r) => r.code === 'W2').length, m.orderStatus(st(), m.workOrderOf(st(), D), '2026-10-31').made], ['completado', false, 1, 1, 5])
    eq('el grupo de una cuenta cerrada: sus pedidos y su primer día (lo que se le pide al servidor para contarlo otra vez)', [m.orderGroup(st(), m.workOrderOf(st(), A)), m.orderGroup(st(), m.workOrderOf(st(), D))], [{ q: 'Kitchen|W1|', from: '2026-10-03', ids: [A] }, { q: 'Kitchen|W3|', from: '2026-10-02', ids: [] }])
    // worked out again with the server's records ("Calcular otra vez con el servidor"): the same, nothing to write; with
    // a correction of an old run, the account changes and goes up again
    const again = m.stateWith(st(), { runs: rows.filter((r) => r.code === 'W1') }, [A], true)
    const x = m.orderStatus(again, m.workOrderOf(again, A), '2026-10-31')
    eq('contado otra vez con los registros del servidor: lo mismo, y completo, con su día por día', [x.sealed, x.complete, x.made, x.completedBy, x.byDay, m.resealGroup(again, [A], '2026-10-31')], [false, true, 50, before.completedBy, before.byDay, 0])
    const fixed = rows.filter((r) => r.code === 'W1').map((r) => (r.date === '2026-10-03' ? { ...r, units: [...r.units, unit(oct(3, 9, 0), null, '', 'Luis')] } : r))
    const again2 = m.stateWith(st(), { runs: fixed }, [A], true)
    eq('con una mezcla de más en un día viejo, se completa una antes, y la cuenta se escribe otra vez', [m.orderStatus(again2, m.workOrderOf(again2, A), '2026-10-31').completedBy.k, m.resealGroup(again2, [A], '2026-10-31'), m.orderStatus(st(), m.workOrderOf(st(), A), '2026-10-31').completedBy.k], [19, 1, 19])
    captured = { orders: m.outbox.items().filter((i) => i.table === 'act_work_orders').map((i) => i.row), mark: m.outbox.items().find((i) => i.table === 'act_changes' && i.key === 'wodone:' + A).row, A }
    // an order typed later with a start day before the account was closed: the account no longer stands
    clock = oct(31, 12, 5); const A2 = save('W1', 10, '2026-10-04', 'A2')
    const v = m.orderStatus(st(), m.workOrderOf(st(), A), '2026-10-31')
    eq('un pedido nuevo con fecha de antes del cierre: la cuenta ya no vale, se cuenta otra vez, y dice que faltan días', [v.sealed, v.complete, m.queueHeld('Kitchen|W1|', '2026-10-03'), m.workNeeds(st()).find((n) => n.q === 'Kitchen|W1|')?.from], [false, false, false, '2026-10-03'])
    for (const r of w1) m.applyRemote('act_runs', r)
    m.markFetched('Kitchen|W1|', '2026-10-03'); m.prune()
    eq('traídos otra vez los días viejos: A completo como antes, el nuevo de cero, y nada se cierra mientras él siga abierto', [pick(m.orderStatus(st(), m.workOrderOf(st(), A), '2026-10-31')).slice(0, 3), m.orderStatus(st(), m.workOrderOf(st(), A2), '2026-10-31').made, st().orderRuns.filter((r) => r.code === 'W1').length], [[50, 0, 'completado'], 0, 2])
  })
  // the closed accounts are a stored field too
  const back = await device('wo-win-again', { seed: JSON.parse(disks.get('wo-win').get('act_v1')), user: 'Oficina' })
  eq('al volver a abrir, las cuentas cerradas se leen tal cual', back.use((m) => m.store.get().orderSeals), win.use((m) => m.store.get().orderSeals))
  // a device that never held those days takes the account from its mark, and a mark taken away takes it away
  const other = await device('wo-mark', { user: 'Mesa' })
  other.use((m) => {
    for (const r of captured.orders.filter((o) => o.code !== 'W1' || o.wo !== 'A2')) m.applyRemote('act_work_orders', r)
    m.applyRemote('act_changes', { ...captured.mark, updated_at: iso(oct(31, 12, 1)) })
    const o = m.workOrderOf(m.store.get(), captured.A), x = m.orderStatus(m.store.get(), o, '2026-10-31')
    eq('otro aparato que nunca tuvo esos días: la marca le da la cuenta (completo; el día por día lo trae la ventana del pedido), sin ninguna corrida', [x.sealed, x.state, x.made, x.byDay.length, m.store.get().runs.length + m.store.get().orderRuns.length, m.store.get().changes.some((c) => c.refTable === 'act_work_orders:done')], [true, 'completado', 50, 0, 0, false])
    eq('y no necesita traer nada de ese pedido', m.workNeeds(m.store.get()).some((n) => n.q === 'Kitchen|W1|'), false)
    m.applyRemote('act_changes', { ...captured.mark, deleted: true, updated_at: iso(oct(31, 13, 0)) })
    eq('una marca quitada quita la cuenta: se vuelve a contar con los registros', [m.store.get().orderSeals.length, m.orderStatus(m.store.get(), o, '2026-10-31').sealed], [0, false])
  })
}

section('Pedidos de producción: lo que corrigió la revisión del 2026-10-19 (un pedido cerrado a medio día, MFO en copas o libras)')
{
  const rv = await device('wo-rv', { user: 'Oficina' })
  rv.use((m) => {
    const st = () => m.store.get()
    const mins = (d, h, mi, n) => Array.from({ length: n }, (_, i) => oct(d, h, mi + i))
    let nr = 0
    const ranOn = (dept, code, date, ats, o = {}) => { const id = 'rv-run-' + ++nr; m.applyRemote('act_runs', { ...runRow({ id, dept, lineId: 'RV-' + dept, line: 'Línea 1', code, lot: '6291', date, startedAt: ats[0] - M, endedAt: ats.at(-1) + M, units: ats.map((at) => unit(at, o.qty ?? null, '', 'Luis')) }), ...(o.extra ? { extra: o.extra } : {}) }); return id }
    const save = (dept, code, qty, u, start, wo) => m.saveWorkOrder({ dept, code, qty, unit: u, startDate: start, wo, note: '' })
    const status = (id, today) => m.orderStatus(st(), m.workOrderOf(st(), id), today)
    const dd = (d) => d.slice(8) + '/' + d.slice(5, 7)
    // ---- closed by hand at 9:00 with 30 made, while the day's program of 80 names it: the next 30 go to B ----
    clock = oct(18, 6, 0); const A = save('Kitchen', 'P1', 1000, 'mezclas', '2026-10-18', 'A')
    clock = oct(18, 6, 1); const B = save('Kitchen', 'P1', 1000, 'mezclas', '2026-10-18', 'B')
    m.setPlan('2026-10-18', 'Kitchen', 'P1', 80, '', A)
    ranOn('Kitchen', 'P1', '2026-10-18', mins(18, 8, 0, 30))
    clock = oct(18, 9, 0); m.closeWorkOrder(A)
    ranOn('Kitchen', 'P1', '2026-10-18', mins(18, 10, 0, 30))
    clock = oct(19, 6, 0)
    const sa = status(A, '2026-10-19')
    eq('cerrado a las 9 con 30 hechas: desde ese día no le queda nada pendiente (lo que siguió fue al B)', [sa.state, sa.made, sa.pendingToday, sa.byDay.map((x) => [x.date, x.programmed, x.made, x.pending, !!x.closed]), status(B, '2026-10-19').made], ['cerrado', 30, 0, [['2026-10-18', 80, 30, 0, true]], 30])
    eq('la tarjeta de ese día: 60 hechas, 20 pendientes', m.planRows(st(), '2026-10-18', 'Kitchen').map((r) => [r.code, r.planned, r.done, r.left]), [['P1', 80, 60, 20]])
    eq('el aviso del 19 dice esos mismos 20, nombra el pedido cerrado y no dice que vuelven a él', m.prevPending(st(), 'Kitchen', '2026-10-19'), [{ code: 'P1', lot: '', n: 20, unit: 'mezclas', date: '2026-10-18', orderId: '', was: A }])
    eq('la ventana del pedido lo dice en palabras', m.orderDayLine(sa.byDay[0], 1000, '2026-10-19', dd), '18/10: de 1,000 disponibles se programaron 80. Se hicieron 30 para el pedido hasta que se cerró: lo que faltaba ya no vuelve a él (quedan 970 sin hacer).')
    // ---- closed before the first mezcla: the room made the 80 for the next one; nothing is pending anywhere ----
    clock = oct(20, 5, 0); const C = save('Kitchen', 'P2', 500, 'mezclas', '2026-10-20', 'C')
    clock = oct(20, 5, 1); const D = save('Kitchen', 'P2', 500, 'mezclas', '2026-10-20', 'D')
    m.setPlan('2026-10-20', 'Kitchen', 'P2', 80, '', C)
    clock = oct(20, 6, 30); m.closeWorkOrder(C)
    ranOn('Kitchen', 'P2', '2026-10-20', mins(20, 8, 0, 80))
    clock = oct(21, 6, 0)
    const sc = status(C, '2026-10-21')
    eq('cerrado antes de la primera: el D se llevó las 80; ni el pedido ni el aviso dicen "80 pendientes"', [sc.byDay.map((x) => [x.made, x.pending]), status(D, '2026-10-21').made, m.prevPending(st(), 'Kitchen', '2026-10-21').filter((p) => p.code === 'P2'), m.orderDayLine(sc.byDay[0], 500, '2026-10-21', dd)], [[[0, 0]], 80, [], '20/10: el pedido estaba cerrado: no se le cuenta nada.'])
    // ---- completed in the middle of the day: the notice says the card's pending, and that the order is complete ----
    clock = oct(22, 5, 0); const E = save('Kitchen', 'P3', 50, 'mezclas', '2026-10-22', 'E')
    clock = oct(22, 5, 1); const F = save('Kitchen', 'P3', 500, 'mezclas', '2026-10-22', 'F')
    m.setPlan('2026-10-22', 'Kitchen', 'P3', 80, '', E)
    ranOn('Kitchen', 'P3', '2026-10-22', mins(22, 8, 0, 70))
    clock = oct(23, 6, 0)
    eq('completo con la 50 y 20 más para el F: la tarjeta dejó 10 pendientes, y el aviso dice esos 10 y nombra el pedido completo', [status(E, '2026-10-23').state, status(F, '2026-10-23').made, m.planRows(st(), '2026-10-22', 'Kitchen').map((r) => r.left), m.prevPending(st(), 'Kitchen', '2026-10-23').filter((p) => p.code === 'P3')], ['completado', 20, [10], [{ code: 'P3', lot: '', n: 10, unit: 'mezclas', date: '2026-10-22', orderId: '', was: E }]])
    // ---- MFO: the program offers its orders of every word (platos, copas, lb), not only the word of its last bins ----
    clock = oct(24, 5, 0); const Zc = save('MFO', 'Z900', 100, 'copas', '2026-10-24', '900')
    const offered = (code, date) => m.programOrderChoices(st(), 'MFO', code, date).map((o) => o.wo)
    eq('un pedido de copas de un código sin bins en este aparato se ofrece en el programa', offered('Z900', '2026-10-24'), ['900'])
    clock = oct(24, 5, 1); const Zp = save('MFO', 'Z900', 200, 'platos', '2026-10-24', '901')
    clock = oct(24, 5, 2); save('MFO', 'Z900', 30, 'lb', '2026-10-24', '902')
    eq('sin bins: todos los de ese código, el más viejo primero', offered('Z900', '2026-10-24'), ['900', '901', '902'])
    ranOn('MFO', 'Z900', '2026-10-24', mins(24, 8, 0, 1), { qty: 40, extra: { bin: 'platos' } })
    eq('con bins de platos: primero los de platos, luego los demás', offered('Z900', '2026-10-24'), ['901', '900', '902'])
    ranOn('MFO', 'Z900', '2026-10-24', mins(24, 9, 0, 1), { qty: 25, extra: { bin: 'copas' } })
    eq('con bins de copas los últimos: primero los de copas', [offered('Z900', '2026-10-24'), m.orderUnitDefault(st(), 'MFO', 'Z900')], [['900', '901', '902'], 'copas'])
    clock = oct(24, 10, 0); m.setPlan('2026-10-24', 'MFO', 'Z900', 60, '', Zc)
    eq('el programa queda con el pedido de copas, que cuenta sus copas; el de platos, sus platos', [m.planRows(st(), '2026-10-24', 'MFO').map((r) => r.orderId), status(Zc, '2026-10-24').made, status(Zp, '2026-10-24').made], [[Zc], 25, 40])
    eq('un código que nadie escribió no ofrece nada', [offered('', '2026-10-24'), offered('NADA', '2026-10-24')], [[], []])
    // ---- Spiral: the unit the row says; elsewhere the room's own count ----
    clock = oct(24, 11, 0); save('Spiral', 'S9', 3000, 'lb', '2026-10-24', '950')
    clock = oct(24, 11, 1); save('Spiral', 'S9', 40, 'mezclas', '2026-10-24', '951')
    save('RTE', 'R9', 2400, 'pouches', '2026-10-24', '952')
    eq('Spiral ofrece los de la unidad del renglón; RTE los suyos', [m.programOrderChoices(st(), 'Spiral', 'S9', '2026-10-24', 'lb'), m.programOrderChoices(st(), 'Spiral', 'S9', '2026-10-24', 'mezclas'), m.programOrderChoices(st(), 'Spiral', 'S9', '2026-10-24', 'cajas'), m.programOrderChoices(st(), 'RTE', 'R9', '2026-10-24')].map((l) => l.map((o) => o.wo)), [['950'], ['951'], [], ['952']])
  })
}

section('Pedidos de producción: un año de pedidos semanales de un código no llena el aparato (revisión del 2026-10-19)')
{
  // Until the review each closed account kept the whole list of its code's orders typed so far: the 52nd of a year of
  // weekly orders carried 52 of them, and the accounts of one code took 200,000 letters on every device
  const yr = await device('wo-year', { user: 'Oficina' })
  yr.use((m) => {
    const st = () => m.store.get()
    const at = (k, h, mi = 0) => new Date(2025, 9, 6 + 7 * k, h, mi, 0).getTime() // Monday 6 October 2025 and every week after
    const dayOfK = (k) => { const d = new Date(at(k, 12)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
    const ids = []
    for (let k = 0; k < 52; k++) {
      clock = at(k, 5)
      const id = m.saveWorkOrder({ dept: 'Kitchen', code: '0889', qty: 10, unit: 'mezclas', startDate: dayOfK(k), wo: String(4500 + k), note: '' })
      ids.push(id)
      m.setPlan(dayOfK(k), 'Kitchen', '0889', 10, '', id)
      const ats = Array.from({ length: 10 }, (_, i) => at(k, 8, i))
      m.applyRemote('act_runs', runRow({ id: 'yr-run-' + k, dept: 'Kitchen', lineId: 'YR', line: 'Braiser 1', code: '0889', lot: '6291', date: dayOfK(k), startedAt: ats[0] - M, endedAt: ats.at(-1) + M, units: ats.map((t) => unit(t, null, '', 'Luis')) }))
    }
    clock = at(56, 12)
    const today = dayOfK(56)
    m.markPulled(); m.markFetched('Kitchen|889|', dayOfK(0)); m.prune()
    const seals = st().orderSeals, sizes = seals.map((x) => JSON.stringify(x).length), marks = m.outbox.items().filter((i) => i.table === 'act_changes' && i.key.startsWith('wodone:'))
    eq('las 52 cuentas se cierran, cada una con sus números', [seals.length, ids.every((id) => { const x = m.orderStatus(st(), m.workOrderOf(st(), id), today); return x.sealed && x.state === 'completado' && x.made === 10 }), marks.length], [52, true, 52])
    eq('cada cuenta es corta y del mismo tamaño, la primera y la 52 (la firma: 16 letras y cuántos pedidos)', [Math.max(...sizes) < 450, Math.max(...sizes) - Math.min(...sizes) <= 10, seals.every((x) => /^\d+:[0-9a-f]{16}$/.test(x.sig)), seals.find((x) => x.id === ids[51]).sig.startsWith('52:'), seals.find((x) => x.id === ids[0]).sig.startsWith('1:')], [true, true, true, true, true])
    eq('y su marca en el servidor también', Math.max(...marks.map((i) => i.row.after.length)) < 400, true)
    eq('todas juntas: menos de 25,000 letras en el aparato (eran 200,000)', JSON.stringify(seals).length < 25_000, true)
    const standing = () => ids.map((id) => m.orderStatus(st(), m.workOrderOf(st(), id), today).sealed)
    clock = at(56, 12, 5); m.saveWorkOrder({ dept: 'Kitchen', code: '0889', qty: 11, unit: 'mezclas', startDate: dayOfK(51), wo: '4551', note: '' }, ids[51])
    eq('cambiar el último pedido anula solo su cuenta', standing().map((x, k) => (x ? '' : k)).filter((x) => x !== ''), [51])
    clock = at(56, 12, 6); m.saveWorkOrder({ dept: 'Kitchen', code: '0889', qty: 12, unit: 'mezclas', startDate: dayOfK(25), wo: '4525', note: '' }, ids[25])
    eq('cambiar el 26 anula su cuenta y las de todos los que empezaron después (se cuentan otra vez), no las de antes', [standing().slice(0, 25).every(Boolean), standing().slice(25).some(Boolean)], [true, false])
    clock = at(56, 12, 7); const late = m.saveWorkOrder({ dept: 'Kitchen', code: '0889', qty: 5, unit: 'mezclas', startDate: dayOfK(3), wo: 'tarde', note: '' })
    eq('un pedido nuevo con fecha de la semana 4: anula las cuentas desde la 4', [standing().slice(0, 3).every(Boolean), standing().slice(3).some(Boolean), !!late], [true, false, true])
  })
}

section('Pedidos de producción: lo que corrigió la revisión del 2026-10-20')
{
  const rv2 = await device('wo-rv2', { user: 'Oficina' })
  let marks = null
  rv2.use((m) => {
    const st = () => m.store.get()
    const mins = (d, h, mi, n) => Array.from({ length: n }, (_, i) => oct(d, h, mi + i))
    let nr = 0
    const rowOf = (code, date, ats) => runRow({ id: 'rv2-run-' + ++nr, dept: 'Kitchen', lineId: 'RV2', line: 'Braiser 1', code, lot: '', date, startedAt: ats[0] - M, endedAt: ats.at(-1) + M, units: ats.map((at) => unit(at, null, '', 'Luis')) })
    const ran = (code, date, ats) => { const row = rowOf(code, date, ats); m.applyRemote('act_runs', row); return row }
    const save = (code, qty, start, wo) => m.saveWorkOrder({ dept: 'Kitchen', code, qty, unit: 'mezclas', startDate: start, wo, note: '' })
    const status = (id, today) => m.orderStatus(st(), m.workOrderOf(st(), id), today)
    const dd = (d) => d.slice(8) + '/' + d.slice(5, 7)

    // ---- the days programmed ahead, in the office's own sum: of the 920, 50 still pending today: 870, then 790, then 710 ----
    clock = oct(18, 5, 0); const A = save('0789', 1000, '2026-10-18', '4512')
    m.setPlan('2026-10-18', 'Kitchen', '0789', 80, '', A); ran('0789', '2026-10-18', mins(18, 8, 0, 50))
    clock = oct(19, 5, 0); m.setPlan('2026-10-19', 'Kitchen', '0789', 80, '', A); ran('0789', '2026-10-19', mins(19, 8, 0, 30))
    clock = oct(19, 13, 0); m.setPlan('2026-10-20', 'Kitchen', '0789', 80, '', A); m.setPlan('2026-10-21', 'Kitchen', '0789', 80, '', A)
    const x = status(A, '2026-10-19'), o = m.workOrderOf(st(), A)
    eq('la tabla: sin programar 870 el 19 (hoy), 790 el 20, 710 el 21', x.byDay.map((r) => [r.date, r.sinProgramar]), [['2026-10-18', 920], ['2026-10-19', 870], ['2026-10-20', 790], ['2026-10-21', 710]])
    eq('y cada día por delante lo dice con los números de su fila, como la oficina (decían "de 920 … quedan 840" los dos)', x.byDay.slice(1).map((r, i) => m.orderDayLine(r, 1000, '2026-10-19', dd, x.byDay[i])), ['19/10 (hoy): de 950 disponibles se programaron 80 → quedan 870 sin programar. Van 30, faltan 50; lo que no se haga hoy vuelve al pedido.', '20/10: de 870 disponibles se programaron 80 → quedan 790 sin programar.', '21/10: de 790 disponibles se programaron 80 → quedan 710 sin programar.'])
    eq('el diálogo del programa ofrece lo mismo para cada día (decía 920 para el 20 y el 21): 950 hoy, 870 el 20, 790 el 21, 710 el 22', ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'].map((d) => m.availOn(o, x, d, '2026-10-19')), [950, 870, 790, 710])
    eq('lo mismo con los números del día que se programa (el diálogo los pide con ese día)', ['2026-10-20', '2026-10-21'].map((d) => m.availOn(o, m.orderStatus(st(), o, d), d, '2026-10-19')), [870, 790])

    // ---- an order closed by hand before its start day (cancelled), its account closed, then reopened ----
    clock = oct(1, 6, 0); const CB = save('CB', 100, '2026-10-10', 'CB')
    clock = oct(3, 6, 0); m.closeWorkOrder(CB)
    clock = oct(30, 12, 0); m.markFetched('Kitchen|CB|', '2026-10-10'); m.markPulled(); m.prune()
    const c0 = status(CB, '2026-10-30'), seal = st().orderSeals.find((s) => s.id === CB)
    eq('cerrado antes de empezar: su cuenta se cierra hasta su día de inicio (era hasta el día que se cerró, y él no estaba en su firma)', [c0.sealed, c0.state, seal?.upto, seal?.sig.startsWith('1:')], [true, 'cerrado', '2026-10-10', true])
    clock = oct(30, 13, 0); m.reopenWorkOrder(CB)
    eq('reabierto: la cuenta ya no vale', status(CB, '2026-10-30').sealed, false)
    ran('CB', '2026-10-30', mins(30, 14, 0, 10))
    eq('y lo que se registra de CB cuenta para él (se quedaba en 0 para siempre)', [status(CB, '2026-10-30').state, status(CB, '2026-10-30').made, status(CB, '2026-10-30').disponible, m.workNeeds(st()).some((n) => n.q === 'Kitchen|CB|')], ['abierto', 10, 90, true])

    // ---- a closed account whose old records the office corrected afterwards: "Calcular otra vez con el servidor" ----
    clock = oct(1, 5, 0); const Q = save('Q3', 100, '2026-10-01', 'Q')
    const qrows = [ran('Q3', '2026-10-01', mins(1, 8, 0, 50)), ran('Q3', '2026-10-02', mins(2, 8, 0, 50))]
    clock = oct(30, 14, 0); m.markFetched('Kitchen|Q3|', '2026-10-01'); m.prune()
    const base = status(Q, '2026-10-30'), mark0 = m.outbox.items().find((i) => i.table === 'act_changes' && i.key === 'wodone:' + Q)?.row
    eq('completo con 100 y cerrada su cuenta, que sube como marca', [base.sealed, base.state, base.made, !!mark0, mark0?.deleted], [true, 'completado', 100, true, false])
    // the office takes away a mezcla of the first day in the Reporte: the server now has 49 that day
    const fixed = qrows.map((r, k) => (k === 0 ? { ...r, units: r.units.slice(1), updated_at: iso(oct(30, 14, 5)) } : r))
    const g = m.orderGroup(st(), m.workOrderOf(st(), Q)), view = m.stateWith(st(), { runs: fixed }, g.ids, true), w = m.orderStatus(view, m.workOrderOf(view, Q), '2026-10-30')
    eq('la ventana lo cuenta con los registros del servidor (99, abierto) y ofrece calcular otra vez por la cuenta de este aparato, no por la suya (que nunca dice "cerrada")', [w.sealed, w.state, w.made, m.recountOffer(base, w, true), m.recountOffer(w, w, true), m.recountOffer(base, base, true), m.recountOffer(base, w, false), m.recountOffer(null, w, true)], [false, 'abierto', 99, 'differs', '', 'same', '', ''])
    clock = oct(30, 14, 10)
    const n = m.resealGroup(view, g.ids, '2026-10-30'), after = status(Q, '2026-10-30')
    const mark1 = m.outbox.items().find((i) => i.table === 'act_changes' && i.key === 'wodone:' + Q)?.row
    eq('ya no está terminado: la cuenta se quita aquí (−1, no "coincide"), su marca sube quitada, y el pedido se cuenta otra vez con sus registros', [n, after.sealed, st().orderSeals.some((s) => s.id === Q), mark1?.deleted, m.workNeeds(st()).some((x) => x.q === 'Kitchen|Q3|'), after.complete], [-1, false, false, true, true, false])
    eq('otra vez: ya no hay cuenta que quitar', m.resealGroup(view, g.ids, '2026-10-30'), 0)
    marks = { first: mark0, gone: mark1, Q, order: m.outbox.items().find((i) => i.table === 'act_work_orders' && i.key === Q)?.row }
  })
  // another device that had the account from its mark lets it go with the mark taken away
  const far = await device('wo-rv2-far', { user: 'Mesa' })
  far.use((m) => {
    m.applyRemote('act_work_orders', marks.order)
    m.applyRemote('act_changes', marks.first)
    const o = () => m.workOrderOf(m.store.get(), marks.Q), x0 = m.orderStatus(m.store.get(), o(), '2026-10-30')
    m.applyRemote('act_changes', marks.gone)
    const x1 = m.orderStatus(m.store.get(), o(), '2026-10-30')
    eq('otro aparato: con la marca, completo; con la marca quitada, ya no (se cuenta con los registros)', [x0.sealed, x0.state, x1.sealed, m.store.get().orderSeals.length], [true, 'completado', false, 0])
  })
  // the history's search: word by word, as Flujo's
  calc.use((m) => {
    const a = { code: '889', productCode: '0889', wo: '4512', note: 'para el cliente', name: 'Beef Stew', lots: ['6290'] }
    const b = { code: 'A100', wo: '7001', note: '', lots: ['6290', '6291'] }
    const finds = (q) => [m.woMatch(a, m.woTokens(q)), m.woMatch(b, m.woTokens(q))]
    eq('"0889" (el código como lo escribe la oficina), "889", "WO 4512", "wo4512", "4512", "beef", "cliente"', ['0889', '889', 'WO 4512', 'wo4512', '4512', 'beef', 'cliente'].map(finds), [[true, false], [true, false], [true, false], [true, false], [true, false], [true, false], [true, false]])
    eq('"A100 6290" (código y lote), "a100", "6291"; "WO" solo y nada escrito: todos', ['A100 6290', 'a100', '6291', 'WO', ''].map(finds), [[false, true], [false, true], [false, true], [true, true], [true, true]])
    eq('"0889" sin el producto en la tabla (el pedido guarda 889)', m.woMatch({ code: '889', wo: '', note: '', lots: [] }, m.woTokens('0889')), true)
    eq('lo que no está no sale: "0890", "WO 4513", "A100 6292", "4512 6291"', ['0890', 'WO 4513', 'A100 6292', '4512 6291'].map(finds), [[false, false], [false, false], [false, false], [false, false]])
  })
}

section('MFO: un bin con varios lotes, corregido en Corregir (2026-10-20)')
{
  // the office: "otro código en el mismo bin 6291" / "que se pueda poner también varios lotes a un bin"
  const mb = await device('mfo-lotes', { user: 'Jose', usual: true })
  mb.use((m) => {
    const st = () => m.store.get()
    m.addLine('MFO', 'Línea 1')
    const l = st().lines.find((x) => x.dept === 'MFO')
    const id = m.addRunLater({ dept: 'MFO', lineId: l.id, code: '4563', lot: '6290', date: DAY, startedAt: oct(10, 7, 0), endedAt: oct(10, 10, 0), units: [{ qty: 690, ref: '1' }, { qty: 630, ref: '2' }, { qty: 450, ref: '3' }], bin: 'platos' })
    const r = () => st().runs.find((x) => x.id === id)
    const opened = m.draftOf(r()), draft = m.draftOf(r())
    // bin 1: 400 platos of 6290 and 290 of 6291, as the lots window gives them (its quantity is their sum)
    draft.units[0] = { ...draft.units[0], qty: '690', lots: [{ lot: '6290', qty: 400 }, { lot: '6291', qty: 290 }] }
    // bin 3: all of it of 6291
    draft.units[2] = { ...draft.units[2], qty: '450', lots: [{ lot: '6291', qty: 450 }] }
    eq('se guarda sin problema', m.applyDraft(id, opened, draft), '')
    const parts = r().units.map((u) => m.unitParts(st(), r(), u).map((p) => [p.lot, p.qty]))
    eq('cada bin con sus lotes; el bin 2 sigue con el lote de la corrida', parts, [[['6290', 400], ['6291', 290]], [['6290', 630]], [['6291', 450]]])
    eq('el bin conserva su número y su cantidad es la suma de sus lotes', r().units.map((u) => [u.ref, u.qty]), [['1', 690], ['2', 630], ['3', 450]])
    const lotOf = (lot) => m.flujoLots(st(), DAY, DAY).find((x) => x.lot === lot)?.rows.find((x) => x.code === '4563')
    eq('Flujo: el lote 6290 cuenta 1,030 platos y el 6291 cuenta 740', [lotOf('6290')?.mfoUnits, lotOf('6291')?.mfoUnits], [1030, 740])
    eq('el historial dice los lotes de cada bin', st().changes.filter((x) => x.refKey === id && / · lotes$/.test(x.what)).map((x) => x.after), ['6290: 400 + 6291: 290', '6291: 450'])
  })
}

// =====================================================================================================================
//  The plant's Reason Codes (Jose, 2026-10-20: the list of his new boss; a manager's switch in Ajustes)
// =====================================================================================================================
section('Códigos de paro (Reason Codes): apagados todo como siempre; encendidos, cada paro lleva un código de la lista')
{
  const rc = await device('codes', { user: 'Jose' })
  rc.use((m) => {
    const st = () => m.store.get()
    const code = (k) => m.codeReason(m.REASON_CODES.find((c) => c.code === k))
    eq('la lista: 37 códigos, cada uno con su definición, su familia y su categoría; los PLN son planeados', [m.REASON_CODES.length, new Set(m.REASON_CODES.map((c) => c.code)).size, m.REASON_CODES.every((c) => c.def && c.label && m.REASON_CATS.some((k) => k.key === c.cat)), m.REASON_CODES.filter((c) => c.planned).map((c) => c.code), m.REASON_CODES.filter((c) => c.family === 'Quality').map((c) => c.code), m.REASON_CODES.filter((c) => c.family === 'Performance').map((c) => c.code)], [37, 37, true, ['PLN-01', 'PLN-02', 'PLN-03', 'PLN-04', 'PLN-05', 'PLN-06'], ['QAL-01', 'QAL-02', 'QAL-03', 'QAL-04'], ['PER-01', 'PER-02', 'PER-03', 'PER-04']])
    eq('un paro con código se guarda como su código y su nombre en español; PLN-03 es el Set up de siempre', [code('EQP-01'), code('OTH-01'), code('PLN-03'), m.reasonCodeOf('Set up')?.code, m.reasonCodeOf('EQP-01 Falla mecánica')?.code, m.reasonCodeOf('Break'), m.reasonCodeOf('XYZ-01 algo')], ['EQP-01 Falla mecánica', 'OTH-01 Otro (explicar en el detalle)', 'Set up', 'PLN-03', 'EQP-01', undefined, undefined])
    eq('un código escrito a mano (o en inglés) es el mismo código; con palabras propias se queda como se escribió', [m.tidyReason('RTE', 'eqp-01'), m.tidyReason('RTE', 'EQP 01'), m.tidyReason('RTE', 'EQP-01 Mechanical failure'), m.tidyReason('RTE', 'eqp-01 falla mecanica'), m.tidyReason('RTE', 'pln-03'), m.tidyReason('RTE', 'EQP-01 se trabó la banda'), m.tidyReason('RTE', 'break')], ['EQP-01 Falla mecánica', 'EQP-01 Falla mecánica', 'EQP-01 Falla mecánica', 'EQP-01 Falla mecánica', 'Set up', 'EQP-01 se trabó la banda', 'Break'])
    clock = T0
    m.addLine('RTE', 'Línea 1')
    const line = st().lines.find((l) => l.dept === 'RTE')
    m.startRun(line, 'A100', '6283', DAY, 240)
    const run = () => st().runs.find((r) => r.lineId === line.id)
    eq('al principio están apagados', st().reasonCodes, { on: false, updatedAt: 0 })
    clock = T0 + 10 * M
    eq('apagados: un paro con una causa de las de siempre, como siempre', m.startStop('RTE', line.id, 'Break', ''), true)
    const old = st().stops.find((x) => x.reason === 'Break')
    clock = T0 + 20 * M; m.endStop(old.id)
    clock = T0 + 21 * M; m.setReasonCodes(true)
    const sent = () => m.outbox.items().filter((i) => i.table === 'act_targets' && i.key === 'opt:reasoncodes')
    eq('se encienden: sube con lo que fija el manager (1 = encendidos) y queda en el historial', [st().reasonCodes.on, sent().map((i) => [i.row.dept, i.row.per_hour]), st().changes.filter((c) => c.refKey === 'opt:reasoncodes').map((c) => [c.what, c.before, c.after, c.dept])], [true, [['opt:reasoncodes', 1]], [['Códigos de paro', 'apagados', 'encendidos', null]]])
    m.setReasonCodes(true)
    eq('decir lo que ya está no manda nada', sent().length, 1)
    clock = T0 + 30 * M
    const n0 = st().stops.length
    eq('encendidos: una causa que no es de la lista no para la línea, ni escrita a mano ("Otra")', [m.startStop('RTE', line.id, 'Break', ''), m.startStop('RTE', line.id, 'se trabó la banda', ''), m.startStop('RTE', line.id, '', ''), st().stops.length], [false, false, false, n0])
    eq('encendidos: un código seguido de palabras propias no es un código de la lista (no se guarda)', [m.startStop('RTE', line.id, 'EQP-01 se trabó la banda', ''), m.reasonProblem(st(), 'RTE', 'EQP-01 se trabó la banda', ''), st().stops.length], [false, 'Con los códigos de paro encendidos, la razón tiene que ser uno de la lista.', n0])
    eq('una causa así, escrita antes con los códigos apagados, se dice como se escribió (no se tapa con el nombre del código)', [m.reasonText(st(), 'EQP-01 se trabó la banda'), m.reasonCodeOf('EQP-01 se trabó la banda')?.code], ['EQP-01 se trabó la banda', 'EQP-01'])
    eq('la categoría de los SCH es Programación (Programa es el programa del día)', m.catOf('sch').label, 'Programación')
    eq('con un código sí, y el detalle es opcional', [m.startStop('RTE', line.id, 'EQP-01 Falla mecánica', '  banda rota '), st().stops.at(-1).reason, st().stops.at(-1).note], [true, 'EQP-01 Falla mecánica', 'banda rota'])
    clock = T0 + 50 * M; m.endStop(st().stops.at(-1).id)
    clock = T0 + 60 * M
    eq('OTH-01 sin detalle no se acepta; con detalle sí', [m.startStop('RTE', line.id, code('OTH-01'), ''), m.startStop('RTE', line.id, code('OTH-01'), '   '), m.reasonProblem(st(), 'RTE', code('OTH-01'), ''), m.startStop('RTE', line.id, code('OTH-01'), 'se fue el agua')], [false, false, 'Con OTH-01 hay que escribir el detalle.', true])
    const oth = st().stops.at(-1)
    clock = T0 + 65 * M; m.endStop(oth.id)
    eq('al corregir, OTH-01 no se queda sin su detalle', [m.updateStop(oth.id, { note: '' }), st().stops.find((x) => x.id === oth.id).note], [false, 'se fue el agua'])
    clock = T0 + 70 * M; m.startStop('RTE', line.id, code('PLN-01'), '')
    clock = T0 + 100 * M; m.endStop(st().stops.at(-1).id)
    // PLN-03 chosen in the list is the Set up: counted apart, not as stopped, and kept as 'Set up' (016's trigger looks for it)
    clock = T0 + 110 * M
    eq('PLN-03 de la lista empieza un Set up: se guarda "Set up"', [m.startStop('RTE', line.id, code('PLN-03'), ''), st().stops.at(-1).reason], [true, 'Set up'])
    clock = T0 + 125 * M; m.endStop(st().stops.at(-1).id)
    clock = T0 + 130 * M; m.startStop('RTE', line.id, 'qal-04', '')
    eq('un código escrito a mano se guarda con el nombre de la lista', st().stops.at(-1).reason, 'QAL-04 Proceso fuera de control')
    clock = T0 + 136 * M; m.endStop(st().stops.at(-1).id)
    clock = T0 + 140 * M
    const rs = m.runStats(st(), run(), clock)
    eq('el Set up de PLN-03 cuenta aparte; lo demás es tiempo parado, código por código', [rs.setup / M, rs.down / M, Object.fromEntries(Object.entries(rs.reasons).map(([k, v]) => [k, v / M]))], [15, 71, { Break: 10, 'EQP-01 Falla mecánica': 20, 'OTH-01 Otro (explicar en el detalle)': 5, 'PLN-01 Break / comida': 30, 'QAL-04 Proceso fuera de control': 6 }])
    // the stop of before the codes keeps its cause: nobody rewrites the history
    eq('el paro de antes sigue con su causa escrita', st().stops.find((x) => x.id === old.id).reason, 'Break')
    eq('se le puede corregir la hora sin tocar su causa', [m.updateStop(old.id, { endedAt: T0 + 19 * M }), st().stops.find((x) => x.id === old.id).reason, st().stops.find((x) => x.id === old.id).endedAt], [true, 'Break', T0 + 19 * M])
    m.updateStop(old.id, { endedAt: T0 + 20 * M })
    eq('pero si se le cambia la causa, tiene que ser un código', [m.updateStop(old.id, { reason: 'Limpieza' }), st().stops.find((x) => x.id === old.id).reason], [false, 'Break'])
    // the report: a Pareto by code, the time planned and not, by OEE family; the stop of before is "Sin código"
    const rep = m.reportOf(st(), DAY, clock)
    const p = m.paretoOf(rep)
    eq('Pareto por código: el de más tiempo primero, con sus veces y sus minutos', p.rows.map((r) => [r.code, r.times, r.ms / M]), [['PLN-01', 1, 30], ['EQP-01', 1, 20], ['PLN-03', 1, 15], ['', 1, 10], ['QAL-04', 1, 6], ['OTH-01', 1, 5]])
    eq('planeado contra no planeado, sin código aparte, y por familia OEE; todo suma el Parado más el Set up', [p.planned / M, p.unplanned / M, p.uncoded / M, p.families.map((f) => [f.family, f.ms / M]), p.total / M, (rep.down + rep.setup) / M], [45, 31, 10, [['Availability', 70], ['Performance', 0], ['Quality', 6]], 86, 86])
    eq('el reporte del día tiene paros con código', m.hasCodedStops(rep), true)
    eq('la hoja Paros del Excel lleva código, planeado o no, familia y categoría, al final', [m.CODE_HEADS(), m.codeCells('EQP-01 Falla mecánica'), m.codeCells('Set up'), m.codeCells('PLN-01 Break / comida'), m.codeCells('Break')], [['Código', 'Planeado / No planeado', 'Familia', 'Categoría'], ['EQP-01', 'No planeado', 'Disponibilidad', 'Equipo'], ['PLN-03', 'Planeado', 'Disponibilidad', 'Set up / cambio'], ['PLN-01', 'Planeado', 'Disponibilidad', 'Paro planeado'], ['Sin código', '', '', '']])
    eq('en pantalla: el Set up con su código mientras están encendidos; una causa de antes como era', [m.reasonText(st(), 'Set up'), m.reasonText(st(), 'EQP-01 Falla mecánica'), m.reasonText(st(), 'Break')], ['PLN-03 · Cambio de producto (Set up)', 'EQP-01 · Falla mecánica', 'Break'])
    // two stops covering the same moment on a line: that moment goes to the one that began first (as always)
    clock = T0 + 150 * M; m.startStop('RTE', line.id, code('MAT-01'), '')
    clock = T0 + 155 * M; m.startStop('RTE', null, code('LAB-01'), '')
    clock = T0 + 160 * M; for (const x of st().stops.filter((y) => !y.endedAt)) m.endStop(x.id)
    const both = m.runStats(st(), run(), clock).reasons
    eq('un rato cubierto por dos paros cuenta una vez, para el que empezó primero', [both['MAT-01 Falta de material'] / M, both['LAB-01 Falta de personal'] ?? 0], [10, 0])
    // dividing a stop: the rest takes a code too
    const mat = st().stops.find((x) => x.reason === 'MAT-01 Falta de material')
    eq('al dividir, el resto tiene que llevar un código (y OTH-01 su detalle)', [m.splitStop(mat.id, T0 + 153 * M, 'Break'), m.splitStop(mat.id, T0 + 153 * M, code('OTH-01'), ''), !!m.splitStop(mat.id, T0 + 153 * M, code('MAT-04'), 'montacargas')], ['', '', true])
    // off again: every stop as before
    clock = T0 + 170 * M; m.setReasonCodes(false)
    eq('se apagan: sube 0, queda en el historial, y las causas de siempre vuelven', [st().reasonCodes.on, sent().map((i) => i.row.per_hour), st().changes.filter((c) => c.refKey === 'opt:reasoncodes').map((c) => c.after), m.startStop('RTE', line.id, 'Break', ''), m.reasonText(st(), 'Set up')], [false, [0], ['encendidos', 'apagados'], true, 'Set up'])
    m.endStop(st().stops.at(-1).id)
    eq('apagados, el reporte sigue mostrando el Pareto porque el día tiene paros con código', m.hasCodedStops(m.reportOf(st(), DAY, clock)), true)
    // another manager's word arrives; an older one does not change it
    m.applyRemote('act_targets', { dept: 'opt:reasoncodes', per_hour: 1, per_shift: null, updated_at: iso(T0 + 180 * M), updated_by: 'Edgar' })
    eq('lo que dice otro manager llega a este aparato', st().reasonCodes, { on: true, updatedAt: T0 + 180 * M })
    m.applyRemote('act_targets', { dept: 'opt:reasoncodes', per_hour: 0, per_shift: null, updated_at: iso(T0 + 175 * M), updated_by: 'Edgar' })
    eq('una versión vieja no lo cambia', st().reasonCodes.on, true)
    eq('la fila de los códigos no es la meta de nadie', [st().targets, st().turnGoals, st().lineTargets], [[], [], []])
  })
  // the switch is a stored field: read back on every reload (the rule of 2026-10-17)
  const saved = JSON.parse(disks.get('codes').get('act_v1'))
  const back = await device('codes-again', { seed: saved, user: 'Jose' })
  eq('al volver a abrir: los códigos siguen encendidos, con su hora', back.use((m) => m.store.get().reasonCodes), { on: true, updatedAt: T0 + 180 * M })
  const before = await device('codes-before', { seed: { ...saved, reasonCodes: undefined }, user: 'Jose' })
  eq('lo guardado por una versión de antes, sin el campo: apagados', before.use((m) => m.store.get().reasonCodes), { on: false, updatedAt: 0 })
  // a switch waiting to go up loses to a newer one on the server, and the history says so
  const q = await device('codes-queue', { user: 'Jose' })
  q.use((m) => {
    clock = T0 + 200 * M; m.setReasonCodes(true)
    m.applyRemote('act_targets', { dept: 'opt:reasoncodes', per_hour: 0, per_shift: null, updated_at: iso(T0 + 201 * M), updated_by: 'Edgar' })
    eq('el servidor lo cambió después: el de aquí sale de la cola, se queda lo del servidor y se dice', [m.outbox.items().filter((i) => i.key === 'opt:reasoncodes').length, m.store.get().reasonCodes.on, m.store.get().changes.filter((c) => /no se subió/.test(c.what)).map((c) => [c.what, c.before, c.after])], [0, false, [['Códigos de paro · no se subió: Edgar lo cambió después', 'encendidos', 'apagados']]])
  })
}

section('Asistencia: cada supervisor anota a su gente, saca a quien se va, y el % de faltas sale solo (Santiago, 2026-10-20)')
{
  const at = await device('attendance', { user: 'Santiago' })
  await at.use(async (m) => {
    const st = () => m.store.get(), D = '2026-10-20'
    eq('sin cambiar nada, cada cuarto espera lo de la hoja de Santiago', m.DEPTS.map((d) => m.attExpectedOf(st(), d, 1)), [6, 18, 11, 10, 21])
    clock = T0 + 5 * M
    const ids = ['Juan Pérez', 'María', '105', 'Pedro'].map((n) => m.attAdd(D, 'Kitchen', 1, n))
    eq('cuatro anotados en Kitchen turno 1: 4 de 6, faltan 2 (33%)', [ids.every(Boolean), m.attendanceOf(st(), D, 1, ['Kitchen']).rows[0]], [true, { dept: 'Kitchen', expected: 6, actual: 4, miss: 2, pct: 2 / 6, over: 0, gone: 0 }])
    eq('el mismo nombre otra vez (con otros espacios y acentos) no se anota dos veces', m.attAdd(D, 'Kitchen', 1, '  juan   perez '), '')
    const up = m.outbox.items().find((i) => i.table === 'act_changes' && i.key === 'att:' + ids[0])
    eq('cada persona sube a la historia del servidor, aparte (act_attendance), con su cuarto', [up?.row.dept, up?.row.ref_table, JSON.parse(up?.row.after ?? '{}').name, st().changes.some((c) => c.refTable === 'act_attendance')], ['Kitchen', 'act_attendance', 'Juan Pérez', false])
    clock = T0 + 60 * M
    m.attRemove(ids[3], 'casa')
    eq('Pedro se fue a su casa: sigue en la lista, marcado, y ya no cuenta: 3 de 6 (50%)', [m.attOf(st(), D, 'Kitchen', 1).find((x) => x.id === ids[3]).gone.why, m.attendanceOf(st(), D, 1, ['Kitchen']).rows[0].actual, m.attendanceOf(st(), D, 1, ['Kitchen']).rows[0].pct], ['casa', 3, 0.5])
    m.attRemove(ids[1], 'otro', 'RTE', true)
    eq('María pasó a cubrir RTE: sale de Kitchen y queda anotada en RTE, diciendo de dónde viene', [m.attendanceOf(st(), D, 1, ['Kitchen']).rows[0].actual, m.attOf(st(), D, 'RTE', 1).map((x) => [x.name, x.from])], [2, [['María', 'Kitchen']]])
    m.attBack(ids[3])
    eq('sacado por error: vuelve y cuenta otra vez', m.attendanceOf(st(), D, 1, ['Kitchen']).rows[0].actual, 3)
    m.attDelete(ids[2])
    eq('anotado por error: se quita de la lista (en el servidor queda marcado)', [m.attOf(st(), D, 'Kitchen', 1).map((x) => x.name), m.outbox.items().find((i) => i.key === 'att:' + ids[2])?.row.deleted], [['Juan Pérez', 'María', 'Pedro'], true])
    m.setAttExpected('Kitchen', 1, 5)
    const t = m.outbox.items().find((i) => i.table === 'act_targets' && i.key === 'opt:att:Kitchen:1')
    eq('el manager cambia los esperados de Kitchen turno 1 a 5: sube, queda en el historial, y el % se rehace (2 de 5: faltan 3, 60%)', [t?.row.per_hour, st().changes.some((c) => c.what.includes('personas esperadas') && c.before === '6' && c.after === '5'), m.attendanceOf(st(), D, 1, ['Kitchen']).rows[0].pct], [5, true, 0.6])
    eq('los esperados no son la meta de nadie', [st().targets, st().turnGoals, st().lineTargets], [[], [], []])
    const tot = m.attendanceOf(st(), D, 1).total
    eq('el total de la planta en el turno 1: lo de cada cuarto sumado (María cuenta en RTE)', [tot.expected, tot.actual, tot.gone], [5 + 18 + 11 + 10 + 21, 3, 1])
    // what another tablet writes arrives; an older version does not change it
    m.applyRemote('act_changes', { id: 'att:R1', at: iso(T0 + 70 * M), by_name: 'Edgar', dept: 'Packing', what: 'Asistencia', before: '', after: JSON.stringify({ date: D, shift: 2, name: 'Luis', gone: null, from: '' }), ref_table: 'act_attendance', ref_key: 'R1', deleted: false, updated_at: iso(T0 + 70 * M), updated_by: 'Edgar' })
    m.applyRemote('act_targets', { dept: 'opt:att:Packing:2', per_hour: 19, per_shift: null, updated_at: iso(T0 + 70 * M), updated_by: 'Edgar' })
    m.applyRemote('act_targets', { dept: 'opt:att:Packing:2', per_hour: 30, per_shift: null, updated_at: iso(T0 + 65 * M), updated_by: 'Edgar' })
    eq('lo que anota otra tablet llega (Luis en Packing turno 2, 19 esperados; una versión vieja no lo cambia)', [m.attOf(st(), D, 'Packing', 2).map((x) => [x.name, x.by]), m.attExpectedOf(st(), 'Packing', 2), st().changes.some((c) => c.id === 'att:R1')], [[['Luis', 'Edgar']], 19, false])
    // the Excel: a sheet with its own bar chart, the % as percents
    const z = await m.loadZip()
    const rows = [['Cuarto', 'Esperados', 'Vinieron', '% Falta'], ['KITCHEN', 6, 5, m.xPct(1 / 6)], ['SPIRAL', 11, 6, m.xPct(5 / 11)]]
    const files = z.unzipSync(await m.xlsxBytes([{ name: 'Resumen', rows: [['a']] }, { name: 'Asistencia', rows, chart: { title: '% de faltas', series: '% Falta', cat: 0, val: 3, from: 2, to: 3, at: 6, pct: true } }]))
    const chart = z.strFromU8(files['xl/charts/chart2.xml'] ?? new Uint8Array())
    eq('el Excel lleva la gráfica de barras de la hoja Asistencia, de sus propias celdas, en %', [!!files['xl/drawings/drawing2.xml'], chart.includes("<c:f>'Asistencia'!$D$2:$D$3</c:f>"), chart.includes('<c:barDir val="bar"/>'), chart.includes('formatCode="0%"'), z.strFromU8(files['xl/worksheets/sheet2.xml']).includes('<drawing r:id="rId1"/>'), z.strFromU8(files['[Content_Types].xml']).includes('/xl/charts/chart2.xml'), !files['xl/charts/chart1.xml']], [true, true, true, true, true, true, true])
    eq('el % va como número con formato de porcentaje', z.strFromU8(files['xl/worksheets/sheet2.xml']).includes('<c r="D2" s="5"><v>0.1667</v></c>'), true)
  })
  const back = await device('attendance-again', { seed: JSON.parse(disks.get('attendance').get('act_v1')), user: 'Santiago' })
  eq('al volver a abrir: la gente anotada y los esperados siguen', back.use((m) => [m.attOf(m.store.get(), '2026-10-20', 'Kitchen', 1).length, m.attExpectedOf(m.store.get(), 'Kitchen', 1), m.attExpectedOf(m.store.get(), 'Packing', 2)]), [3, 5, 19])
}
section('Reporte KPI del día: el plan de Costco del planner, lo real del 0889 y la productividad (Edgar, 2026-10-22)')
{
  // a planner shaped as Yasbelth's (made-up numbers): two months side by side, Day / Mixes / Cases / Actual cs
  const csv = ['Costco MVM Planner,,,,,Case,Trays', 'East Rutherford,,,,,1,8', 'October 2026 - November 2026,,,,,Batches,Pallets,Cases', ',,,,,60,30,1080',
    'October,,,,November,,,', 'Day,Mixes,Cases,Actual cs,Day,Mixes,Cases,Actual cs',
    ...Array.from({ length: 31 }, (_, i) => [i + 1, 100, '"1,800"', i === 0 ? '"1,679"' : '', i < 30 ? i + 1 : '', i < 30 ? (i === 25 ? '' : 60) : '', i < 30 ? (i === 25 ? '' : '"1,080"') : '', ''].join(',')),
    'Total,"3,100","55,800",0,Total,"1,740","31,320",0', 'Forecast,"1,409","25,356","25,356",Forecast,"1,753","31,545","31,545"', 'INSTRUCTIONS:'].join('\r\n')
  const kp = await device('kpi', { user: 'Jose' })
  kp.use((m) => {
    const st = () => m.store.get()
    const p = m.parsePlanner(csv, 'planner.csv')
    eq('el planner se lee: cada día con sus mezclas y cajas, el año del título, 18 cajas por mezcla, y el forecast de cada mes', [Object.keys(p.days).length, p.days['2026-10-10'], p.days['2026-11-30'], p.days['2026-11-26'], p.perMix, p.forecast], [31 + 29, { mixes: 100, cases: 1800 }, { mixes: 60, cases: 1080 }, undefined, 18, { '2026-10': 25356, '2026-11': 31545 }])
    eq('lo real escrito a mano en el planner no se lee (lo tiene Actividad)', JSON.stringify(p).includes('1679'), false)
    eq('un archivo que no es el planner se dice', typeof m.parsePlanner('a,b\n1,2'), 'string')
    eq('un planner de enero después de diciembre: enero es del año siguiente', Object.keys(m.parsePlanner(['Plan,December 2026 - January 2027', 'December,,,,January,,,', 'Day,Mixes,Cases,Actual cs,Day,Mixes,Cases,Actual cs', '1,80,"1,440",,1,60,"1,080",'].join('\n')).days), ['2026-12-01', '2027-01-01'])
    m.kpiPut('plan:0889', p)
    eq('el plan se guarda en el servidor aparte (act_kpi)', [m.outbox.items().find((i) => i.key === 'kpi:plan:0889')?.row.ref_table, !!m.costcoPlan(st())], ['act_kpi', true])
    clock = T0
    for (const d of ['Spiral', 'Packing']) if (!st().lines.some((l) => l.dept === d)) m.addLine(d, 'Línea 1')
    const line = (d) => st().lines.find((l) => l.dept === d)
    m.startRun(line('Spiral'), '0889', '6292', DAY, null)
    m.startRun(line('Packing'), '0889', '6292', DAY, 36)
    const run = (d) => st().runs.find((r) => r.dept === d && r.code === '0889')
    for (let k = 1; k <= 5; k++) { clock = T0 + k * 10 * M; m.unitDone(run('Spiral').id, null) }
    for (let k = 1; k <= 3; k++) { clock = T0 + k * 20 * M; m.unitDone(run('Packing').id, 36) }
    const day = m.costcoDay(st(), DAY, clock)
    eq('el día de Costco: lo planeado y lo hecho (mezclas de Spiral, cajas de Packing)', [day.planMixes, day.planCases, day.mixes, day.cases, day.diff], [100, 1800, 5, 108, -1692])
    const mo = m.costcoMonth(st(), DAY, clock)
    eq('el mes: plan y real hasta ese día, el plan del mes, y lo que hace falta por día para cumplirlo', [mo.monthPlan, mo.planToDate, mo.actualToDate, mo.left, mo.perDay, mo.forecast], [55800, 18000, 108, 21, Math.ceil((55800 - 108) / 21), 25356])
    // productivity: the attendance and what each room made
    const a = m.attAdd(DAY, 'Packing', 1, 'Ana', '', '', true), b = m.attAdd(DAY, 'Packing', 1, 'Beto')
    eq('una persona se anota como temporal, y se puede cambiar', [st().attendance.find((x) => x.id === a).temp, m.attSetTemp(b, true), st().attendance.find((x) => x.id === b).temp, m.attSetTemp(b, false), st().attendance.find((x) => x.id === b).temp], [true, true, true, true, undefined])
    eq('el temporal viaja al servidor con la persona', JSON.parse(m.outbox.items().find((i) => i.key === 'att:' + a).row.after).temp, true)
    const lab = m.laborOf(st(), DAY, clock), pk = lab.rows.find((r) => r.dept === 'Packing')
    const w = m.workSpan(st(), DAY, 'Packing', 1), h = Math.max(0, Math.min(w.to, clock) - w.from) / 3600000
    eq('Packing: programados, vinieron, temporales, horas-persona, lo que hizo y por hora-persona', [pk.scheduled, pk.showed, pk.temps, pk.hours, pk.made, pk.unit, pk.perHour], [m.attExpectedOf(st(), 'Packing', 1) + (m.attShifts(st(), DAY).length > 1 ? m.attExpectedOf(st(), 'Packing', 2) : 0), 2, 1, Math.round(2 * h * 10) / 10, 108, 'cajas', Math.round((108 / (Math.round(2 * h * 10) / 10)) * 100) / 100])
    eq('el total de la planta: las cajas de Packing sobre las horas de todos', [lab.total.cases, lab.total.hours], [108, pk.hours])
    eq('las horas del turno son las de su horario (de su hora de empezar a la de terminar), no el corte entre turnos', [new Date(w.from).getHours() + ':' + new Date(w.from).getMinutes(), w.to > w.from], [m.shiftsOf(st(), DAY, 'Packing').first.replace(/^0/, '').replace(':00', ':0'), true])
    // who sees it, and the notes
    eq('lo ve el admin; otro, solo si su nombre está en la lista', [m.seesKpi(st(), true, 'Jose'), m.seesKpi(st(), false, 'Edgar Carhuapoma')], [true, false])
    m.kpiPut('access', { names: ['Edgar Carhuapoma'] })
    eq('con Edgar en la lista lo ve (sin importar mayúsculas ni acentos); otro manager no', [m.seesKpi(st(), false, 'edgar carhuapoma'), m.seesKpi(st(), false, 'Mike')], [true, false])
    m.kpiPut('note:' + DAY + ':costco', { text: 'Corrió todo el turno sin cambio de código' })
    eq('la nota del día se guarda por parte', [m.kpiNote(st(), DAY, 'costco'), m.kpiNote(st(), DAY, 'labor')], ['Corrió todo el turno sin cambio de código', ''])
    m.applyRemote('act_changes', { id: 'kpi:note:' + DAY + ':labor', at: iso(T0 + 90 * M), by_name: 'Edgar', dept: null, what: 'KPI', before: '', after: JSON.stringify({ text: 'Faltaron temporales' }), ref_table: 'act_kpi', ref_key: 'note:' + DAY + ':labor', deleted: false, updated_at: iso(T0 + 90 * M), updated_by: 'Edgar' })
    m.applyRemote('act_changes', { id: 'kpi:access', at: iso(T0 + 95 * M), by_name: 'Ana', dept: 'Packing', what: 'KPI', before: '', after: JSON.stringify({ names: ['Ana'] }), ref_table: 'act_kpi', ref_key: 'access', deleted: false, updated_at: iso(T0 + 95 * M), updated_by: 'Ana' })
    eq('un registro del reporte con cuarto (lo que un operador podría escribir) no se toma', m.kpiNames(st()), ['Edgar Carhuapoma'])
    eq('la nota que escribe Edgar en otro aparato llega, y no se mete en la historia', [m.kpiNote(st(), DAY, 'labor'), st().changes.some((c) => c.id.startsWith('kpi:'))], ['Faltaron temporales', false])
  })
  const back = await device('kpi-again', { seed: JSON.parse(disks.get('kpi').get('act_v1')), user: 'Jose' })
  eq('al volver a abrir: el plan, la lista, las notas y el temporal siguen', back.use((m) => [Object.keys(m.costcoPlan(m.store.get()).days).length, m.kpiNames(m.store.get()), m.kpiNote(m.store.get(), DAY, 'costco'), m.store.get().attendance.filter((x) => x.temp).length]), [60, ['Edgar Carhuapoma'], 'Corrió todo el turno sin cambio de código', 1])
}
section('Pesos en RTE: el operador escribe el peso de cada pouch, se guarda al momento, y dice bajo o sobre (Jose, 2026-10-22)')
{
  const wt = await device('weights', { user: 'Operador RTE' })
  wt.use((m) => {
    const st = () => m.store.get()
    clock = T0
    if (!st().lines.some((l) => l.dept === 'RTE')) m.addLine('RTE', 'Línea 1')
    m.startRun(st().lines.find((l) => l.dept === 'RTE'), '0889', '6292', DAY, 240)
    const run = st().runs.find((r) => r.code === '0889')
    const t = m.weightNew(run)
    eq('una prueba nueva no se guarda hasta su primer peso', [st().weights.length, (m.weightSave(t, []), st().weights.length)], [0, 0])
    clock = T0 + 5 * M
    m.weightSave(t, [{ w: 3.04 }])
    const up = m.outbox.items().find((i) => i.key === 'wt:' + t.id)
    eq('el primer peso ya se guarda y sube al servidor, aparte (act_weights), con su cuarto, línea, código y lote', [st().weights.length, up?.row.ref_table, up?.row.dept, JSON.parse(up?.row.after ?? '{}').entries, JSON.parse(up?.row.after ?? '{}').lot, st().changes.some((c) => c.refTable === 'act_weights')], [1, 'act_weights', 'RTE', [{ w: 3.04 }], '6292', false])
    m.weightSave(t, [{ w: 3.04 }, { w: 3.24 }, { w: 2.95 }, { w: 3.01 }])
    eq('cada peso que sigue escribe la misma prueba otra vez (no una nueva)', [st().weights.length, m.wtWeights(st().weights[0])], [1, [3.04, 3.24, 2.95, 3.01]])
    eq('sin objetivo no dice bajo ni sobre', m.weightClass(3.24, m.weightTarget(st(), '0889')), '')
    m.setWeightTarget('0889', 3.01, 0.05)
    const tg = m.weightTarget(st(), '889')
    eq('con el objetivo 3.01 ± 0.05: 2.95 es bajo, 3.04 bien, 3.24 sobre; y vale para 889 y 0889', [tg, [2.95, 3.04, 3.24, 2.96, 3.06].map((w) => m.weightClass(w, tg))], [{ pouch: 3.01, tol: 0.05 }, ['bajo', 'ok', 'sobre', 'ok', 'ok']])
    const w = m.weightsOf(st(), DAY)
    eq('el reporte KPI: por código, pruebas, revisados, pesados, promedio, mínimo, máximo, bajos y sobre', w.map((x) => [x.code, x.tests.length, x.checked, x.n, x.avg, x.min, x.max, x.under, x.over]), [['0889', 1, 4, 4, 3.06, 2.95, 3.24, 1, 1]])
    m.weightSave(t, [{ w: 3.04 }, { w: 3.24 }, { w: 2.95 }, { w: 3.01 }, { k: 'sobre' }, { k: 'sobre' }, { w: 2.99, k: 'bajo' }])
    const w2 = m.weightsOf(st(), DAY)[0]
    eq('los botones Sobre / Bajo cuentan un pouch sin peso; con peso, el peso va con su marca (la marca del operador manda)', [w2.checked, w2.n, w2.under, w2.over, m.entryClass({ w: 2.99, k: 'bajo' }, tg), m.entryClass({ k: 'sobre' }, null)], [7, 5, 2, 3, 'bajo', 'sobre'])
    eq('un toque sin peso ni marca no se guarda', [(m.weightSave(t, [...st().weights[0].entries, {}]), st().weights[0].entries.length)], [7])
    m.weightSave(t, [])
    eq('quitar todos los pesos deja la prueba borrada (marcada en el servidor)', [m.weightTestsOf(st(), DAY).length, m.outbox.items().find((i) => i.key === 'wt:' + t.id)?.row.deleted], [0, true])
    m.weightSave(t, [{ w: 3.1 }, { k: 'bajo' }])
    m.applyRemote('act_changes', { id: 'wt:R1', at: iso(T0 + 60 * M), by_name: 'Otro', dept: 'RTE', what: 'Peso', before: '', after: JSON.stringify({ date: DAY, lineId: 'x', line: 'Línea 2', code: '0889', lot: '6292', runId: 'r2', kind: 'pouch', weights: [3.0, 2.9] }), ref_table: 'act_weights', ref_key: 'R1', deleted: false, updated_at: iso(T0 + 60 * M), updated_by: 'Otro' })
    eq('la prueba de otra tablet llega; una de los primeros builds (solo pesos, en libras, sin unidad) se lee en onzas (× 16)', m.weightTestsOf(st(), DAY).map((x) => [x.line, x.entries]), [['Línea 1', [{ w: 3.1 }, { k: 'bajo' }]], ['Línea 2', [{ w: 48 }, { w: 46.4 }]]])
    eq('lo que sube ya dice que es en onzas', JSON.parse(m.outbox.items().find((i) => i.key === 'wt:' + t.id).row.after).unit, 'oz')
    m.applyRemote('act_changes', { id: 'kpi:target:4928', at: iso(T0 + 61 * M), by_name: 'Jose', dept: null, what: 'KPI', before: '', after: JSON.stringify({ code: '4928', pouch: 3, tol: 0.05 }), ref_table: 'act_kpi', ref_key: 'target:4928', deleted: false, updated_at: iso(T0 + 61 * M), updated_by: 'Jose' })
    eq('un objetivo puesto en libras (antes de las onzas) se lee en onzas; uno nuevo queda en onzas', [m.weightTarget(st(), '4928'), (m.setWeightTarget('4929', 48, 1), m.weightTarget(st(), '4929'))], [{ pouch: 48, tol: 0.8 }, { pouch: 48, tol: 1 }])
  })
  const back = await device('weights-again', { seed: JSON.parse(disks.get('weights').get('act_v1')), user: 'Operador RTE' })
  eq('al volver a abrir: las pruebas, sus pesos y sus marcas siguen (en onzas, sin volver a multiplicar)', back.use((m) => m.weightTestsOf(m.store.get(), DAY).map((x) => x.entries)), [[{ w: 3.1 }, { k: 'bajo' }], [{ w: 48 }, { w: 46.4 }]])
}
section('MFO: el roaster va en bags de libras, y la línea dice Bag en vez de bin (Jose, 2026-10-22)')
{
  const bg = await device('mfo-bags', { user: 'Operador MFO' })
  bg.use((m) => {
    const st = () => m.store.get()
    clock = T0
    m.addLine('MFO', 'Línea 9')
    const line = st().lines.find((l) => l.name === 'Línea 9')
    m.startRun(line, 'ROASTER', '6295', DAY, null, 'lb', '', 'bag')
    const run = () => st().runs.find((r) => r.code === 'ROASTER')
    const c = m.cfgOf(run())
    eq('la corrida guarda libras con la marca de bag, y la pantalla dice Bag, "Bag lista" y pide libras', [run().extra, c.unit, c.plural, c.done, c.qtyQ, c.qtyUnit, c.refLabel, m.mfoChoiceOf(run())], [{ bin: 'lb', pack: 'bag' }, 'Bag', 'Bags', 'Bag lista', '¿Cuántas libras lleva esta bag?', 'lb', 'N° de bag', 'bags'])
    clock = T0 + 10 * M; m.unitDone(run().id, 42.5, '1')
    clock = T0 + 20 * M; m.unitDone(run().id, 40, '2')
    eq('va al servidor con la marca de bag', m.outbox.items().filter((i) => i.table === 'act_runs').pop().row.extra, { bin: 'lb', pack: 'bag' })
    const rep = m.reportOf(st(), DAY, clock)
    const mfo = rep.byDept.find((d) => d.dept === 'MFO')
    eq('en el reporte cuenta como libras (lo mismo que un bin de libras), y sabe cuántas son bags', mfo.bins.map((b) => [b.word, b.units, b.qty, b.bags]), [['lb', 2, 82.5, 2]])
    m.startRun(st().lines.find((l) => l.dept === 'MFO' && l.name !== 'Línea 9') ?? (m.addLine('MFO', 'Línea 8'), st().lines.find((l) => l.name === 'Línea 8')), '4495', '6295', DAY, null, 'lb')
    eq('un bin de libras sigue siendo bin (sin la marca)', [m.cfgOf(st().runs.find((r) => r.code === '4495')).unit, st().runs.find((r) => r.code === '4495').extra], ['Bin', { bin: 'lb' }])
    eq('una marca que llega del servidor se guarda; una que no es bag no', [m.cleanExtra({ bin: 'lb', pack: 'bag' }), m.cleanExtra({ bin: 'lb', pack: 'caja' })], [{ bin: 'lb', pack: 'bag' }, { bin: 'lb' }])
  })
  const back = await device('mfo-bags-again', { seed: JSON.parse(disks.get('mfo-bags').get('act_v1')), user: 'Operador MFO' })
  eq('al volver a abrir: sigue siendo bag', back.use((m) => m.cfgOf(m.store.get().runs.find((r) => r.code === 'ROASTER')).unit), 'Bag')
}
section('Los pallets de un PO salen de lo que llevan sus pallets, no solo de Productos (Packing, 2026-10-22: PO de 100 cajas, "2 pallets de 13")')
{
  const pp = await device('po-pallets', { user: 'Ingrid' })
  pp.use((m) => {
    const st = () => m.store.get()
    clock = T0
    m.saveProduct(st().products.length, { code: '2010', name: 'Meatballs', pouchesPerCase: 8, casesPerMix: 14, cratesPerCart: 24, pouchesPerCrate: 0, casesPerPallet: 8, updatedAt: 0 })
    const oid = m.saveOrder(null, { customer: 'BJ', po: '117953991', code: '2010', cases: 100, shipBy: '2026-10-28', dest: '' })
    const o = st().orders.find((x) => x.id === oid)
    eq('sin pallets todavía, con lo de Productos (8 por pallet): 13', m.orderPallets(st(), o.id).need, 13)
    m.addLine('Packing', 'Línea 1')
    m.startRun(st().lines.find((l) => l.dept === 'Packing'), '2010', '6292', DAY, 50)
    const run = () => st().runs.find((r) => r.code === '2010')
    eq('con la línea en pallets de 50: 2', m.orderPallets(st(), o.id, run().perUnit).need, 2)
    clock = T0 + 10 * M; m.unitDone(run().id, 50, '1532', undefined, o.id)
    eq('un pallet de 50 hecho: le falta 1 (aunque Productos diga 8)', [m.orderPallets(st(), o.id).done.length, m.orderPallets(st(), o.id).need], [1, 2])
    clock = T0 + 20 * M; m.unitDone(run().id, 50, '1533', undefined, o.id)
    eq('completo por cajas: 2 de 2 pallets', [m.orderPallets(st(), o.id).need, m.orderFullText(st(), o.id)], [2, '2 de 2 pallets · 100 de 100 cajas'])
  })
}
section('Pedidos: urgente para que Packing le dé prioridad, y el comentario de Packing de por qué no se puede (la oficina, 2026-10-22)')
{
  const ur = await device('order-urgent', { user: 'Oficina' })
  ur.use((m) => {
    const st = () => m.store.get()
    clock = T0
    const a = m.saveOrder(null, { customer: 'BJ', po: '1001', code: '2010', cases: 100, shipBy: '2026-10-25', dest: '' })
    const b = m.saveOrder(null, { customer: 'LIDL', po: '1002', code: '2010', cases: 90, shipBy: '2026-10-28', dest: '' })
    eq('sin urgentes: primero el que sale antes', m.openOrdersFor(st(), '2010').map((o) => o.po), ['1001', '1002'])
    m.setOrderUrgent(b, true)
    eq('marcado urgente: sale primero, sube al servidor y queda en el historial', [m.openOrdersFor(st(), '2010').map((o) => o.po), JSON.parse(m.outbox.items().find((i) => i.key === 'po:' + b).row.after).urgent, st().changes.some((c) => c.what === 'Pedido urgente')], [['1002', '1001'], true, true])
    m.addLine('Packing', 'Línea 1')
    m.startRun(st().lines.find((l) => l.dept === 'Packing'), '2010', '6292', DAY, 50)
    eq('al hacer un pallet de ese código, se le propone primero el urgente', m.nextOrderFor(st(), st().runs.find((r) => r.code === '2010')), b)
    m.saveOrder(b, { customer: 'LIDL', po: '1002', code: '2010', cases: 90, shipBy: '2026-10-28', dest: 'Norte' })
    eq('editar el pedido sin tocar urgente lo deja urgente', st().orders.find((o) => o.id === b).urgent, true)
    m.setOrderUrgent(b, false)
    eq('ya no urgente: vuelve a su lugar', m.openOrdersFor(st(), '2010').map((o) => o.po), ['1001', '1002'])
    m.setOrderNote(a, '  Falta producto de RTE; sale mañana  ')
    const up = m.outbox.items().find((i) => i.key === 'ponote:' + a)
    eq('el comentario de Packing se guarda, con el cuarto Packing (un operador de Packing lo puede escribir), aparte de la historia', [m.orderNoteOf(st(), a).text, up.row.dept, up.row.ref_table, st().changes.some((c) => c.refTable === 'act_order_notes')], ['Falta producto de RTE; sale mañana', 'Packing', 'act_order_notes', false])
    m.applyRemote('act_changes', { id: 'ponote:' + b, at: iso(T0 + 30 * M), by_name: 'Ingrid', dept: 'Packing', what: 'Comentario del pedido', before: '', after: JSON.stringify({ text: 'Esperando bins de MFO' }), ref_table: 'act_order_notes', ref_key: b, deleted: false, updated_at: iso(T0 + 30 * M), updated_by: 'Ingrid' })
    eq('el comentario de otra tablet llega', [m.orderNoteOf(st(), b).text, m.orderNoteOf(st(), b).by], ['Esperando bins de MFO', 'Ingrid'])
    m.setOrderNote(b, '')
    eq('quitar el comentario lo deja borrado (marcado en el servidor)', [m.orderNoteOf(st(), b), m.outbox.items().find((i) => i.key === 'ponote:' + b)?.row.deleted], [null, true])
  })
  const back = await device('order-urgent-again', { seed: JSON.parse(disks.get('order-urgent').get('act_v1')), user: 'Oficina' })
  eq('al volver a abrir: el comentario sigue', back.use((m) => m.orderNoteOf(m.store.get(), m.store.get().orders.find((o) => o.po === '1001').id)?.text), 'Falta producto de RTE; sale mañana')
}
section('Reporte: el total de cada línea, en su departamento (Jose, 2026-10-22)')
{
  const lt = await device('line-totals', { user: 'Jose' })
  lt.use((m) => {
    const st = () => m.store.get()
    clock = T0
    m.addLine('Packing', 'Línea 1'); m.addLine('Packing', 'Línea 2'); m.addLine('RTE', 'Línea 1')
    const L = (d, n) => st().lines.find((l) => l.dept === d && l.name === n)
    m.startRun(L('Packing', 'Línea 1'), 'A100', '6283', DAY, 36)
    const r1 = () => st().runs.find((r) => r.code === 'A100')
    clock = T0 + 10 * M; m.unitDone(r1().id, 36)
    clock = T0 + 20 * M; m.unitDone(r1().id, 30)
    m.endRun(r1().id)
    m.startRun(L('Packing', 'Línea 1'), 'B200', '6283', DAY, 36)
    clock = T0 + 30 * M; m.unitDone(st().runs.find((r) => r.code === 'B200').id, 36)
    m.startRun(L('Packing', 'Línea 2'), 'A100', '6284', DAY, 36)
    clock = T0 + 40 * M; m.unitDone(st().runs.find((r) => r.code === 'A100' && r.lot === '6284').id, 20)
    const rep = m.reportOf(st(), DAY, clock)
    const pk = rep.byLine.filter((l) => l.dept === 'Packing').map((l) => [l.name, l.day.units, l.day.qty, l.codes, l.day.open])
    eq('cada línea de Packing con lo que lleva: pallets, cajas, sus códigos y si está en curso', pk, [['Línea 1', 3, 102, ['A100', 'B200'], true], ['Línea 2', 1, 20, ['A100'], true]])
    eq('las líneas suman lo del cuarto', rep.byLine.filter((l) => l.dept === 'Packing').reduce((t, l) => t + l.day.qty, 0), rep.byDept.find((d) => d.dept === 'Packing').qty)
    eq('una línea sin nada ese día no sale', rep.byLine.some((l) => l.dept === 'RTE'), false)
    eq('con un código escogido, cada línea cuenta solo ese código', m.reportOf(st(), DAY, clock, { code: 'A100' }).byLine.map((l) => [l.name, l.day.qty]), [['Línea 1', 66], ['Línea 2', 20]])
  })
}
section('Trasladar personal a otra línea o a otro cuarto, y los nombres en el Excel (Jose, 2026-10-22)')
{
  const mv = await device('att-move', { user: 'Supervisor RTE' })
  await mv.use(async (m) => {
    const st = () => m.store.get(), D = '2026-10-22'
    for (const d of ['RTE', 'Packing']) for (const n of ['Línea 1', 'Línea 2']) if (!st().lines.some((l) => l.dept === d && l.name === n)) m.addLine(d, n)
    const L = (d, n) => st().lines.find((l) => l.dept === d && l.name === n && !l.deleted).id
    clock = T0 + 5 * M
    const ana = m.attAdd(D, 'RTE', 1, 'Ana', '', L('RTE', 'Línea 1')), beto = m.attAdd(D, 'RTE', 1, 'Beto', '', L('RTE', 'Línea 1'))
    eq('anotados en RTE Línea 1', m.attOf(st(), D, 'RTE', 1).map((x) => [x.name, m.attLineText(st(), x.line)]), [['Ana', 'Línea 1'], ['Beto', 'Línea 1']])
    clock = T0 + 30 * M
    eq('Ana pasa a la Línea 2 de RTE: sigue contando en RTE, y queda de qué línea vino', [m.attMoveLine(ana, L('RTE', 'Línea 2')), m.attLineText(st(), m.attOf(st(), D, 'RTE', 1).find((x) => x.id === ana).line), m.attendanceOf(st(), D, 1, ['RTE']).rows[0].actual, m.attMovesText(st(), m.attOf(st(), D, 'RTE', 1).find((x) => x.id === ana))], [true, 'Línea 2', 2, 'Línea 1 → Línea 2 · ' + m.fmtTime(T0 + 30 * M)])
    eq('la línea viaja al servidor con la persona', JSON.parse(m.outbox.items().find((i) => i.key === 'att:' + ana).row.after).line, L('RTE', 'Línea 2'))
    eq('pasarla a la línea donde ya está no hace nada', m.attMoveLine(ana, L('RTE', 'Línea 2')), false)
    clock = T0 + 60 * M
    m.attRemove(beto, 'otro', 'Packing', false, L('Packing', 'Línea 2'))
    const pk = m.attOf(st(), D, 'Packing', 1)
    eq('Beto pasa a Packing Línea 2: sale de RTE y aparece solo en Packing, en esa línea, diciendo de dónde viene (nadie en Packing tuvo que anotarlo)', [m.attendanceOf(st(), D, 1, ['RTE']).rows[0].actual, pk.map((x) => [x.name, x.from, m.attLineText(st(), x.line), !!x.via]), m.attendanceOf(st(), D, 1, ['Packing']).rows[0].actual], [1, [['Beto', 'RTE', 'Línea 2', true]], 1])
    eq('lo que aparece en Packing no se guarda dos veces: es el registro de RTE', st().attendance.filter((x) => x.name === 'Beto').length, 1)
    eq('el total de la planta no cambia por trasladar', m.attendanceOf(st(), D, 1).total.actual, 2)
    // Packing's supervisor acts on him: he is written in Packing first (with the hour he came), then moved
    clock = T0 + 90 * M
    eq('Packing lo pasa a su Línea 1: queda anotado en Packing, con la hora en que llegó', [m.attMoveLine(pk[0].id, L('Packing', 'Línea 1')), m.attOf(st(), D, 'Packing', 1).map((x) => [x.name, x.from, m.attLineText(st(), x.line), !!x.via, x.at]), m.attendanceOf(st(), D, 1, ['Packing']).rows[0].actual], [true, [['Beto', 'RTE', 'Línea 1', false, T0 + 60 * M]], 1])
    eq('deshacer en RTE: vuelve a contar en RTE; lo que Packing ya anotó es de Packing y se queda', [m.attBack(beto), m.attendanceOf(st(), D, 1, ['RTE']).rows[0].actual], [true, 2])
    // undone before Packing touched him: he leaves Packing by himself
    const cata = m.attAdd(D, 'RTE', 1, 'Cata')
    m.attRemove(cata, 'otro', 'MFO')
    eq('Cata aparece en MFO', m.attOf(st(), D, 'MFO', 1).map((x) => x.name), ['Cata'])
    m.attBack(cata)
    eq('se deshace en RTE: ya no aparece en MFO', m.attOf(st(), D, 'MFO', 1).length, 0)
    eq('de un traslado no se puede borrar "por error" en el cuarto que lo recibe', (() => { m.attRemove(cata, 'otro', 'MFO'); return m.attDelete(m.attOf(st(), D, 'MFO', 1)[0].id) })(), false)
    eq('se puede mandar a su casa desde el cuarto que lo recibió', [m.attRemove(m.attOf(st(), D, 'MFO', 1)[0].id, 'casa'), m.attOf(st(), D, 'MFO', 1).map((x) => [x.name, x.gone?.why, x.from])], [true, [['Cata', 'casa', 'RTE']]])
    eq('una tablet vieja (sin línea) se lee igual: sin línea', m.attOf(st(), D, 'Kitchen', 1).length === 0 && (m.applyRemote('act_changes', { id: 'att:OLD', at: iso(T0), by_name: 'X', dept: 'Kitchen', what: 'Asistencia', before: '', after: JSON.stringify({ date: D, shift: 1, name: 'Vieja', gone: null, from: '' }), ref_table: 'act_attendance', ref_key: 'OLD', deleted: false, updated_at: iso(T0 + M), updated_by: 'X' }), m.attOf(st(), D, 'Kitchen', 1).map((x) => [x.name, x.line, x.moves])), [['Vieja', '', []]])
  })
  const back = await device('att-move-again', { seed: JSON.parse(disks.get('att-move').get('act_v1')), user: 'Supervisor RTE' })
  eq('al volver a abrir: la línea y los traslados siguen', back.use((m) => { const st = m.store.get(), a = st.attendance.find((x) => x.name === 'Ana'); return [m.attLineText(st, a.line), a.moves.length, m.attOf(st, '2026-10-22', 'Packing', 1).map((x) => m.attLineText(st, x.line))] }), ['Línea 2', 1, ['Línea 1']])
}
section('Cada cuarto cambia de turno por su cuenta: RTE se queda hasta las 3:30, Packing empieza el Turno 2 a las 2:40 (Jose, 2026-10-21)')
{
  const rc = await device('roomcut', { user: 'Jose' })
  rc.use((m) => {
    const st = () => m.store.get(), D = '2026-10-21', at = (h, mi) => oct(21, h, mi)
    const put = (id, dept, ats, qty) => m.applyRemote('act_runs', runRow({ id, dept, lineId: 'RC-' + dept, line: 'Línea 1', code: 'C' + dept.slice(0, 2), date: D, startedAt: at(13, 0), units: ats.map(([h, mi]) => unit(at(h, mi), qty)) }))
    put('rc-rte', 'RTE', [[14, 50], [15, 20], [15, 25]], 240)
    put('rc-pk', 'Packing', [[14, 50], [15, 0]], 50)
    put('rc-ki', 'Kitchen', [[14, 50]], null)
    const by = (d) => m.planRows(st(), D, d)[0].byShift
    eq('sin que nadie diga nada, todos cambian con la planta (3:15 PM)', [by('RTE'), by('Packing'), by('Kitchen')], [[240, 480], [100, 0], [1, 0]])
    clock = at(14, 40)
    eq('a las 2:40 Packing toca "Empezar Turno 2"', m.startSecondShift('Packing'), true)
    eq('lo de Packing desde las 2:40 es del Turno 2; Kitchen sigue con la planta', [by('Packing'), by('Kitchen')], [[0, 100], [1, 0]])
    clock = at(15, 30)
    m.endShift('RTE', 1)
    eq('a las 3:30 se va el Turno 1 de RTE: sus carros de las 3:20 y 3:25 son del Turno 1', by('RTE'), [720, 0])
    eq('el Reporte del Turno 1 cuenta los tres carros de RTE y ninguno de Packing', [m.reportOf(st(), D, clock, { shift: 1 }).rows.filter((x) => x.r.dept === 'RTE').reduce((t, x) => t + x.units, 0), m.reportOf(st(), D, clock, { shift: 1 }).rows.filter((x) => x.r.dept === 'Packing').reduce((t, x) => t + x.units, 0)], [3, 0])
    eq('la tarjeta del piso: a las 3:20 RTE estaba en el Turno 1, Spiral (sin cambio propio) ya en el 2', [m.turnOf(st(), D, at(15, 20), 'RTE').shift, m.turnOf(st(), D, at(15, 20), 'Spiral').shift, m.turnOf(st(), D, at(15, 20)).shift], [1, 2, 2])
    const up = m.outbox.items().filter((i) => i.table === 'act_changes' && String(i.key).startsWith('cut:'))
    eq('cada cambio sube a la historia del servidor, aparte (act_shiftcut), con su cuarto, y queda en Cambios', [up.map((i) => [i.row.dept, i.row.ref_table, JSON.parse(i.row.after).how]).sort(), st().changes.filter((c) => c.what.startsWith('Cambio de turno de ')).length], [[['Packing', 'act_shiftcut', 'inicio'], ['RTE', 'act_shiftcut', 'fin']], 2])
    eq('muy lejos del cambio de la planta (9:00 AM) no se toma', m.setShiftMark(D, 'MFO', at(9, 0), 'manual'), false)
    // another tablet's word arrives
    m.applyRemote('act_changes', { id: 'cut:' + D + ':Kitchen', at: iso(at(14, 45)), by_name: 'Edgar', dept: 'Kitchen', what: 'Cambio de turno', before: '', after: JSON.stringify({ date: D, at: at(14, 45), how: 'inicio' }), ref_table: 'act_shiftcut', ref_key: D + ':Kitchen', deleted: false, updated_at: iso(at(15, 31)), updated_by: 'Edgar' })
    eq('lo que dice otra tablet llega: Kitchen empezó el Turno 2 a las 2:45, su mezcla de las 2:50 es del 2', by('Kitchen'), [0, 1])
    m.clearShiftMark(D, 'Packing')
    eq('un manager regresa Packing al cambio de la planta: todo vuelve al Turno 1', by('Packing'), [100, 0])
    eq('lo de otro día no cambia: el cambio es del día que se dijo', m.turnOf(st(), '2026-10-22', oct(22, 15, 20), 'RTE').shift, 2)
  })
  const again = await device('roomcut-again', { seed: JSON.parse(disks.get('roomcut').get('act_v1')), user: 'Jose' })
  eq('al volver a abrir: el cambio de RTE sigue (3:30) y el de Packing quitado', again.use((m) => [m.roomMark(m.store.get(), '2026-10-21', 'RTE')?.how, m.roomMark(m.store.get(), '2026-10-21', 'Packing')]), ['fin', undefined])
}
section('Agregar un registro: qué tenía la línea a esa hora y sus horas libres del turno (Jose, 2026-10-21)')
{
  const fr = await device('freehours', { user: 'Jose' })
  fr.use((m) => {
    const st = () => m.store.get(), D = '2026-10-22', at = (h, mi = 0) => oct(22, h, mi)
    m.applyRemote('act_lines', { id: 'FL3', dept: 'RTE', name: 'Línea 3', deleted: false, updated_at: iso(at(4)), updated_by: 'x' })
    m.applyRemote('act_runs', runRow({ id: 'fr-a', dept: 'RTE', lineId: 'FL3', line: 'Línea 3', code: '2286', date: D, startedAt: at(7), endedAt: at(9, 30) }))
    m.applyRemote('act_runs', runRow({ id: 'fr-b', dept: 'RTE', lineId: 'FL3', line: 'Línea 3', code: '0889', date: D, startedAt: at(12), endedAt: null }))
    clock = at(14)
    const t = m.lineTimes(st(), 'FL3', D, 'RTE', 1, clock)
    eq('Turno 1 de la Línea 3: libre antes de las 7, de 9:30 a 12; ocupada por 2286 y por 0889, que sigue en curso', [t.free.map((x) => [new Date(x.from).getHours() * 60 + new Date(x.from).getMinutes(), new Date(x.to).getHours() * 60 + new Date(x.to).getMinutes()]), t.busy.map((r) => r.code)], [[[210, 420], [570, 720]], ['2286', '0889']])
    eq('lo que la ocupa a las 13:00 es el 0889 que sigue en curso (lo que el aviso nombra)', m.runsOnLine(st(), 'FL3', at(13), at(13, 30)).map((r) => r.code), ['0889'])
    eq('a las 10:00 cabe un registro: no se cruza con nada', m.runsOnLine(st(), 'FL3', at(10), at(11)).length, 0)
    const id = m.addRunLater({ dept: 'RTE', lineId: 'FL3', code: '7777', date: D, startedAt: at(10), endedAt: at(11), units: [{ qty: 240 }] })
    eq('y se agrega en ese rato libre', !!id, true)
    m.applyRemote('act_runs', runRow({ id: 'fr-c', dept: 'RTE', lineId: 'FL3', line: 'Línea 3', code: '4928', date: D, startedAt: at(11, 10), endedAt: at(11, 20) + 40_000 }))
    eq('el 4928 terminó a las 11:20 y 40 segundos: un registro desde las 11:20 entra (solo se tocan esos segundos)', !!m.addRunLater({ dept: 'RTE', lineId: 'FL3', code: '4980', date: D, startedAt: at(11, 20), endedAt: at(11, 40), units: [{ qty: 182 }] }), true)
    eq('pero desde las 11:15 no: ahí corría el 4928', m.addRunLater({ dept: 'RTE', lineId: 'FL3', code: '4980', date: D, startedAt: at(11, 15), endedAt: at(11, 18), units: [{ qty: 182 }] }), '')
    eq('la 1:03 AM escrita con la fecha de hoy es la de esta noche (la ventana lo dice y ofrece el día anterior)', m.nearDay(new Date(D + 'T15:30:00').getTime(), '01:03') > clock, true)
    eq('el Turno 2 todavía no empieza (son las 2:00 PM): no tiene horas libres para agregar', m.lineTimes(st(), 'FL3', D, 'RTE', 2, clock).free.length, 0)
  })
}
section('Un PO completo ya no lleva más pallets: el de 3 pallets no acepta el 4 (la oficina, 2026-10-21)')
{
  const pk = await device('po-limit', { user: 'Jose' })
  pk.use((m) => {
    const st = () => m.store.get(), D = '2026-10-22', at = (h, mi = 0) => oct(22, h, mi)
    clock = at(8)
    m.applyRemote('act_lines', { id: 'PL1', dept: 'Packing', name: 'Línea 1', deleted: false, updated_at: iso(at(6)), updated_by: 'x' })
    m.applyRemote('act_runs', runRow({ id: 'pl-run', dept: 'Packing', lineId: 'PL1', line: 'Línea 1', code: '0889', lot: '6293', date: D, startedAt: at(7), endedAt: null, perUnit: 40 }))
    const po = m.saveOrder(null, { customer: 'Costco', po: '45821', code: '0889', cases: 120, shipBy: D, dest: 'NJ' })
    const po2 = m.saveOrder(null, { customer: 'Walmart', po: '45822', code: '0889', cases: 400, shipBy: '2026-10-25', dest: 'PA' })
    const pallet = (k) => { clock = at(9, k); return m.palletDone('pl-run', [{ lot: '6293', qty: 40, tag: 'T' + k }], po) }
    eq('el PO de 120 cajas a 40 por pallet lleva 3 pallets: los tres entran', [pallet(1), pallet(2), pallet(3)], [true, true, true])
    eq('ya está completo: 3 de 3 pallets, 120 de 120 cajas', [m.orderFull(st(), po, 40), m.orderFullText(st(), po, 40)], [true, '3 de 3 pallets · 120 de 120 cajas'])
    eq('el cuarto pallet para ese PO no se acepta', pallet(4), false)
    eq('el pallet que se arma ya no se le puede poner a ese PO, y la app propone el siguiente PO del código', [m.palletOrder('pl-run', po), m.nextOrderFor(st(), m.store.get().runs.find((r) => r.id === 'pl-run'))], [false, po2])
    clock = at(9, 10)
    m.palletDone('pl-run', [{ lot: '6293', qty: 40, tag: 'T5' }], '')
    const free = st().runs.find((r) => r.id === 'pl-run').units.at(-1).at
    eq('en Corregir, un pallet sin PO tampoco se puede pasar a ese PO completo', m.setUnitOrder('pl-run', free, po), false)
    const first = st().runs.find((r) => r.id === 'pl-run').units[0].at
    eq('pero uno que ya era suyo se puede dejar en él (no cuenta contra sí mismo)', m.orderFull(st(), po, 40, { runId: 'pl-run', at: first }), false)
    eq('un registro agregado después con un pallet más para ese PO no se agrega', m.addRunLater({ dept: 'Packing', lineId: 'PL1', code: '0889', date: D, startedAt: at(5), endedAt: at(5, 30), units: [{ qty: 40, po }], perUnit: 40 }), '')
    eq('y uno para el otro PO sí', !!m.addRunLater({ dept: 'Packing', lineId: 'PL1', code: '0889', date: D, startedAt: at(5), endedAt: at(5, 30), units: [{ qty: 40, po: po2 }], perUnit: 40 }), true)
    eq('al otro PO (400 cajas, ya con 40) le caben nueve pallets de 40: un registro con diez lo pasa', [m.orderOver(st(), Array.from({ length: 9 }, () => ({ po: po2, qty: 40 })), 40), m.orderOver(st(), Array.from({ length: 10 }, () => ({ po: po2, qty: 40 })), 40)], ['', po2])
  })
}
section('Lotes: lo que dieron las mezclas, lo que cada cuarto debía hacer, lo que falta y lo que se perdió (Jose, 2026-10-22)')
{
  const lt = await device('lotes', { user: 'Jose' })
  lt.use((m) => {
    const st = () => m.store.get(), D = '2026-10-22', at = (h, mi = 0) => oct(22, h, mi)
    clock = at(20)
    // 0889: 20 cajas por mezcla, 24 pouches por caja, 36 cajas por pallet, a RTE
    m.applyRemote('act_products', productRow('0889', 'Meatballs', 24, 20, 24, 0, 36, at(1)))
    // 3310: 30 cajas por mezcla, 10 platos por caja, 40 cajas por pallet, a MFO
    m.applyRemote('act_products', productRow('3310', 'Chicken bowl', 10, 30, 0, 0, 40, at(1)))
    m.setPackRoom('3310', 'MFO')
    const mins = (h, n, step = 2) => Array.from({ length: n }, (_, i) => at(h, i * step))
    const run = (id, dept, code, lot, ats, o = {}) => m.applyRemote('act_runs', { ...runRow({ id, dept, lineId: 'LT-' + dept + (o.line ?? ''), line: 'Línea 1', code, lot, date: D, startedAt: ats[0] - 60_000, endedAt: o.open ? null : ats.at(-1) + 60_000, units: ats.map((t, i) => (o.units ? o.units(t, i) : unit(t, o.qty ?? null))) }), ...(o.extra ? { extra: o.extra } : {}) })
    // ---- 0889 · 6293: Kitchen 14 mezclas → RTE 6,500 de 6,720 pouches → Packing 260 cajas en 8 pallets, todo terminado
    run('lt-k', 'Kitchen', '0889', '6293', mins(6, 14))
    run('lt-r', 'RTE', '0889', '6293', mins(8, 25), { qty: 260 })
    run('lt-p', 'Packing', '0889', '6293', mins(11, 8), { units: (t, i) => ({ at: t, qty: i < 7 ? 36 : 8, ref: '', by: 'x', lots: [{ lot: '6293', qty: i < 7 ? 36 : 8, tag: 'T' + i }] }) })
    // ---- 3310 · 6292: Spiral 6 mezclas → MFO 1,600 de 1,800 platos, terminado; Packing no ha empezado
    run('lt-s', 'Spiral', '3310', '6292', mins(6, 6))
    run('lt-m', 'MFO', '3310', '6292', mins(9, 16), { qty: 100, extra: { bin: 'platos' } })
    // ---- 0889 · 6294: Kitchen 8 mezclas, RTE todavía trabajando (2,340 pouches)
    run('lt-k2', 'Kitchen', '0889', '6294', mins(13, 8), { line: '2' })
    run('lt-r2', 'RTE', '0889', '6294', mins(15, 9), { qty: 260, open: true, line: '2' })
    // the same day, with nobody on it any more: RTE and Packing may still go on with it (they end the code every shift):
    // what is missing is "falta", not a loss (Jose, 2026-10-22: the 889 · 6289 that read "88.8% lost" at 1 AM)
    const same = m.lotChains(st(), D, D, D).find((c) => c.code === '0889' && c.lot === '6293')
    eq('el mismo día, sin nadie en él: lo que le falta a RTE es "falta" (pend) y Packing sigue en camino (RTE todavía le puede mandar), el lote va en camino y no se dice pérdida', [same.steps[1].state, same.steps[2].state, same.status, same.totalLoss], ['pend', 'run', 'run', null])
    eq('un día después tampoco: hacen falta 2 días sin registros del lote en ese cuarto', m.lotChains(st(), D, D, '2026-10-23').find((c) => c.code === '0889' && c.lot === '6293').steps[1].state, 'pend')
    // two days later with nothing more of it: now it is lost
    const list = m.lotChains(st(), D, D, '2026-10-24')
    const one = (code, lot) => list.find((c) => c.code === code && c.lot === lot)
    const a = one('0889', '6293')
    eq('0889 · 6293: las 14 mezclas dan 280 cajas', [a.mixes, a.originCases, a.route, a.mixRoom], [14, 280, 'RTE', 'Kitchen'])
    eq('RTE debía hacer 6,720 pouches (280 × 24), hizo 6,500 y terminó: pérdida 220 (3.3%)', [a.steps[1].dept, a.steps[1].expected, a.steps[1].done, a.steps[1].gap, Math.round(a.steps[1].pct * 1000) / 10, a.steps[1].state], ['RTE', 6720, 6500, 220, 3.3, 'loss'])
    eq('Packing se mide contra lo que RTE le pasó: 6,500 ÷ 24 = 270.83 cajas, hizo 260 en 8 pallets (de 8): pérdida 10.83', [a.steps[2].expected, a.steps[2].done, a.steps[2].gap, a.steps[2].state, a.steps[2].pallets], [270.83, 260, 10.83, 'loss', { expected: 8, done: 8 }])
    eq('pérdida total del lote contra lo que dieron las mezclas: 280 − 260 = 20 cajas (7.1%), terminado', [a.totalLoss, Math.round(a.totalPct * 1000) / 10, a.status, m.lossClass(a.totalPct)], [20, 7.1, 'done', 'bad'])
    const b = one('3310', '6292')
    eq('3310 · 6292 va a MFO: 6 mezclas × 30 = 180 cajas × 10 platos = 1,800 platos; hizo 1,600: pérdida 200 (11.1%)', [b.route, b.mixRoom, b.originCases, b.steps[1].unit, b.steps[1].expected, b.steps[1].done, b.steps[1].gap, b.steps[1].state], ['MFO', 'Spiral', 180, 'platos', 1800, 1600, 200, 'loss'])
    eq('Packing debe 1,600 ÷ 10 = 160 cajas (4 pallets) y no ha empezado: nadie lo trabaja, el lote va atrás, sin pérdida total todavía', [b.steps[2].expected, b.steps[2].pallets.expected, b.steps[2].state, b.status, b.totalLoss], [160, 4, 'wait', 'late', null])
    const c = one('0889', '6294')
    eq('0889 · 6294: RTE sigue trabajando: lo que no llega todavía es "falta", no pérdida', [c.steps[1].expected, c.steps[1].done, c.steps[1].gap, c.steps[1].state, c.status], [3840, 2340, 1500, 'run', 'run'])
    eq('y Packing, sin nada todavía mientras RTE sigue, no ha empezado', c.steps[2].state, 'wait')
    const sum = m.lotsSummary(list)
    eq('el resumen: 2 en camino, 1 terminado, pérdida de lo terminado 20 de 280 cajas (7.1%), el peor es 0889 · 6293', [sum.running, sum.done, sum.lost, sum.expected, Math.round(sum.pct * 1000) / 10, sum.worst?.lot], [2, 1, 20, 280, 7.1, '6293'])
    eq('dónde se pierde más: MFO 11.1%, Packing 4%, RTE 3.3% (cada uno en su unidad, de lo que terminó)', sum.byRoom.map((x) => [x.dept, Math.round(x.pct * 1000) / 10]), [['MFO', 11.1], ['Packing', 4], ['RTE', 3.3]])
    eq('primero los terminados, el que más perdió arriba; luego los que van atrás y los que siguen', list.map((x) => x.code + '·' + x.lot), ['0889·6293', '3310·6292', '0889·6294'])
    eq('buscar por código, lote o producto', [list.filter((x) => m.chainMatch(x, '889')).length, list.filter((x) => m.chainMatch(x, '6292')).length, list.filter((x) => m.chainMatch(x, 'bowl')).length], [2, 1, 1])
    // a code with no numbers in Productos: said, never invented
    run('lt-x', 'Kitchen', 'ZZ1', '6293', mins(7, 3), { line: '9' })
    const x = m.lotChains(st(), D, D, '2026-10-24').find((y) => y.code === 'ZZ1')
    eq('un código que no está en Productos: no se inventa nada y dice qué falta', [x.originCases, x.steps[1].expected, x.steps[1].state, x.missing], [null, null, 'nocalc', ['el código en Productos']])
  })
}
section('Programa del día: la pestaña del admin, prendida para todos desde Ajustes (Jose, 2026-10-20)')
{
  const pv = await device('program-view', { user: 'Jose' })
  pv.use((m) => {
    const st = () => m.store.get()
    eq('al principio solo el admin la ve (apagado)', st().programView, { on: false, updatedAt: 0 })
    clock = T0 + 10 * M; m.setProgramView(true)
    const up = m.outbox.items().filter((i) => i.table === 'act_targets' && i.key === 'opt:programview')
    eq('se prende: sube a act_targets con 1 y queda en el historial', [st().programView.on, up.map((i) => i.row.per_hour), st().changes.filter((c) => c.refKey === 'opt:programview').map((c) => [c.what, c.before, c.after])], [true, [1], [['Programa del día', 'solo el admin', 'para todos']]])
    m.applyRemote('act_targets', { dept: 'opt:programview', per_hour: 0, per_shift: null, updated_at: iso(T0 + 20 * M), updated_by: 'Edgar' })
    eq('lo que dice otro manager llega, y una versión vieja no lo cambia', [st().programView.on, (m.applyRemote('act_targets', { dept: 'opt:programview', per_hour: 1, per_shift: null, updated_at: iso(T0 + 15 * M), updated_by: 'Edgar' }), st().programView.on)], [false, false])
    eq('la fila no es la meta de nadie ni toca los códigos de paro', [st().targets, st().turnGoals, st().lineTargets, st().reasonCodes.on], [[], [], [], false])
    clock = T0 + 30 * M; m.setProgramView(true)
    // the attendance switch (2026-10-21): the same, under its own key
    eq('la asistencia empieza apagada (solo el admin)', st().attView.on, false)
    clock = T0 + 31 * M; m.setAttView(true)
    eq('se prende: sube opt:attview con 1, queda en el historial, y no toca el Programa', [m.outbox.items().find((i) => i.key === 'opt:attview')?.row.per_hour, st().changes.some((c) => c.refKey === 'opt:attview' && c.after === 'para todos'), st().programView.on], [1, true, true])
    m.applyRemote('act_targets', { dept: 'opt:attview', per_hour: 0, per_shift: null, updated_at: iso(T0 + 40 * M), updated_by: 'Edgar' })
    eq('otro manager la apaga: llega', st().attView.on, false)
    // the Lotes and Flujo tabs (2026-10-22): both start off (Flujo, which nobody used, stays the admin's)
    eq('Lotes y Flujo empiezan apagadas', [st().viewOpts.lotes.on, st().viewOpts.flujo.on], [false, false])
    clock = T0 + 41 * M; m.setViewOpt('lotes', true)
    eq('se prende Lotes: sube opt:view:lotes con 1 y queda en el historial; Flujo sigue apagada', [m.outbox.items().find((i) => i.key === 'opt:view:lotes')?.row.per_hour, st().changes.some((c) => c.what === 'Pestaña Lotes' && c.after === 'para todos'), st().viewOpts.flujo.on], [1, true, false])
    m.applyRemote('act_targets', { dept: 'opt:view:flujo', per_hour: 1, per_shift: null, updated_at: iso(T0 + 50 * M), updated_by: 'Edgar' })
    eq('otro manager prende Flujo: llega', st().viewOpts.flujo.on, true)
  })
  const back = await device('program-view-again', { seed: JSON.parse(disks.get('program-view').get('act_v1')), user: 'Jose' })
  eq('al volver a abrir sigue prendido, con su hora', back.use((m) => m.store.get().programView.on), true)
  eq('y la asistencia sigue como quedó (apagada)', back.use((m) => m.store.get().attView.on), false)
  eq('y Lotes y Flujo siguen como quedaron', back.use((m) => [m.store.get().viewOpts.lotes.on, m.store.get().viewOpts.flujo.on]), [true, true])
}

// =====================================================================================================================
console.log('')
if (failed.length) { console.log(failed.length + ' FALLARON de ' + (passed + failed.length) + ':\n'); for (const f of failed) console.log('  ✗ ' + f + '\n'); process.exit(1) }
console.log('✓ ' + passed + ' comprobaciones, todas correctas')
process.exit(0)
