// The sign-in check with the real Supabase library and a server that cannot be reached (what a tablet meets with no
// WiFi). Real clock: the library's own retries take about half a minute. Run by: npm run check
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

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

console.log('· La copia que abre la app sin WiFi es la de la app, nunca una página de error (service worker, auditoría 2026-10-17, H3)')
{
  const code = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../public/sw.js'), 'utf8')
  /** public/sw.js in a stand-in browser: its cache, the network (`net`: path → [status, body, type], or nothing = no signal) and its events */
  const worker = (net) => {
    const kept = new Map(), on = {}
    const res = (status, body, type = 'basic') => ({ status, ok: status >= 200 && status < 300, type, body, clone: () => res(status, body, type), text: async () => body })
    const path = (x) => new URL(typeof x === 'string' ? x : x.url, 'http://tablet.local').pathname
    const caches = {
      open: async () => ({ put: async (k, r) => { kept.set(path(k), r) }, add: async () => {} }),
      match: async (k) => kept.get(path(k)), keys: async () => ['actividad-v1'], delete: async () => true,
    }
    const fetch = async (x) => { const r = net(path(x)); if (!r) throw new TypeError('Failed to fetch'); return res(...r) }
    const self = { registration: { scope: 'http://tablet.local/' }, addEventListener: (t, f) => { on[t] = f }, skipWaiting: () => {}, clients: { claim: () => {} } }
    vm.runInNewContext(code, { self, caches, fetch, location: { origin: 'http://tablet.local' }, URL, Promise, Error, TypeError, Set })
    const open = async (p) => { let answer; on.fetch({ request: { method: 'GET', mode: 'navigate', url: 'http://tablet.local' + p }, respondWith: (x) => { answer = x } }); const r = await answer; await new Promise((ok) => setTimeout(ok, 0)); return r?.body }
    const install = async () => { let done; on.install({ waitUntil: (x) => { done = x } }); try { await done; return 'instalado' } catch (e) { return 'no: ' + e.message } }
    return { kept, open, install, shell: () => kept.get('/')?.body }
  }
  const site = { '/': [200, '<html>la app</html>'], '/index.html': [200, '<html>la app</html>'], '/nope': [404, 'Not Found'], '/version.json': [200, '{"build":"x"}'] }
  let down = false
  const w = worker((p) => (down ? null : site[p]))
  eq('con señal se abre la app, y queda su copia', [await w.open('/'), w.shell()], ['<html>la app</html>', '<html>la app</html>'])
  site['/'] = [200, '<html>la app nueva</html>']
  await w.open('/?desde=qr')
  eq('una versión nueva reemplaza la copia (también abierta con algo detrás de "?")', w.shell(), '<html>la app nueva</html>')
  eq('un enlace mal escrito (404) se muestra, pero no reemplaza la copia', [await w.open('/nope'), w.shell()], ['Not Found', '<html>la app nueva</html>'])
  await w.open('/version.json')
  eq('version.json abierto a mano tampoco', w.shell(), '<html>la app nueva</html>')
  site['/'] = [503, 'Service Unavailable']
  await w.open('/')
  eq('ni un error del servidor en la misma dirección de la app', w.shell(), '<html>la app nueva</html>')
  site['/'] = [0, '', 'opaqueredirect']
  await w.open('/')
  eq('ni una redirección', w.shell(), '<html>la app nueva</html>')
  down = true
  eq('sin señal, la app abre con su copia', await w.open('/'), '<html>la app nueva</html>')
  const bad = worker((p) => (p === '/' ? [500, 'Internal Server Error'] : null))
  bad.kept.set('/', { body: '<html>la app de antes</html>' })
  eq('instalar una versión cuando el servidor da error: no se instala, y la copia de antes se queda', [await bad.install(), bad.shell()], ['no: shell 500', '<html>la app de antes</html>'])
  const good = worker((p) => (p === '/' ? [200, '<html>la app</html>'] : null))
  eq('con la página bien, se instala y guarda la copia', [await good.install(), good.shell()], ['instalado', '<html>la app</html>'])
}

console.log('')
if (failed.length) { console.log(failed.length + ' FALLARON de ' + (passed + failed.length) + ':\n'); for (const f of failed) console.log('  ✗ ' + f + '\n'); process.exit(1) }
console.log('✓ ' + passed + ' comprobaciones, todas correctas')
process.exit(0)
