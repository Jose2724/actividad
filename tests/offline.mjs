// The sign-in check with the real Supabase library and a server that cannot be reached (what a tablet meets with no
// WiFi). Real clock: the library's own retries take about half a minute. Run by: npm run check
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const disk = new Map()
const storage = { getItem: (k) => (disk.has(k) ? disk.get(k) : null), setItem: (k, v) => { disk.set(k, String(v)) }, removeItem: (k) => { disk.delete(k) }, key: (i) => [...disk.keys()][i] ?? null, get length() { return disk.size } }
Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage })
// enough of a browser for the library to keep the session in localStorage, as it does on a tablet
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true }, localStorage: storage, location: new URL('http://localhost/') }
globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' }
const m = await import(pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/.cache/act-check/device.js')).href)

const KEY = 'sb-127-auth-token' // where the library keeps the session for the test server (.env.test)
const session = (expiresIn) => JSON.stringify({ access_token: 'x.y.z', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + expiresIn, user: { id: 'u1', aud: 'authenticated', email: 'a@b.c' } })
/** 'nobody' when the check answers that no one is signed in; 'unknown' when it cannot tell (it throws) */
const who = async () => { try { return (await m.fetchMe()) === null ? 'nobody' : 'someone' } catch { return 'unknown' } }
let passed = 0
const failed = []
const eq = (what, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) passed++; else failed.push(`${what}\n      salió    ${JSON.stringify(got)}\n      esperado ${JSON.stringify(want)}`) }

console.log('· Abrir la app sin señal (librería real, servidor inalcanzable; tarda medio minuto)')
eq('nadie ha entrado en este aparato: pantalla de entrar', await who(), 'nobody')
disk.set(KEY, session(3000))
eq('sesión vigente y sin señal: no se sabe, la persona se queda dentro', await who(), 'unknown')
disk.set(KEY, session(-7200))
eq('sesión vencida hace 2 horas y sin señal: tampoco se la saca', await who(), 'unknown')
eq('y su sesión sigue guardada para cuando vuelva la señal', disk.has(KEY), true)

console.log('· Salir sin señal')
disk.set(KEY, session(3000))
await m.signOutHere()
eq('"Salir" quita la sesión del aparato aunque no llegue al servidor', [disk.has(KEY), disk.has('act_out')], [false, false])
eq('después de salir no queda nadie', await who(), 'nobody')
disk.set(KEY, session(3000)); disk.set('act_out', '1')
await m.finishSignOut()
eq('si la app se cerró a medio salir, se termina al abrir', disk.has(KEY), false)

console.log('· La última persona confirmada en el aparato')
m.rememberMe({ id: 'e1', name: 'Nino', username: 'nino', role: 'op', dept: 'RTE' })
eq('se recuerda', m.rememberedMe(), { id: 'e1', name: 'Nino', username: 'nino', role: 'op', dept: 'RTE' })
disk.set('act_me', '{"name":"","role":"op"}'); eq('un dato incompleto no vale', m.rememberedMe(), null)
disk.set('act_me', '{"name":"X","role":"jefe"}'); eq('un rol que no existe no vale', m.rememberedMe(), null)
disk.set('act_me', 'no es json'); eq('un dato dañado no vale', m.rememberedMe(), null)
m.rememberMe(null); eq('y se olvida al salir', disk.has('act_me'), false)

console.log('')
if (failed.length) { console.log(failed.length + ' FALLARON de ' + (passed + failed.length) + ':\n'); for (const f of failed) console.log('  ✗ ' + f + '\n'); process.exit(1) }
console.log('✓ ' + passed + ' comprobaciones, todas correctas')
process.exit(0)
