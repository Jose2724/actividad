import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { DEPTS, sendChat, uid, user, type ChatCall, type Dept } from './store'
import { deviceId } from './devices'
import { DEPT_LOOK, lookVars } from './look'
import { tr } from './i18n'

/**
 * Calls inside Mensajes (Jose, 2026-11-06: "¿se puede agregar llamada en los chats directo?"). His decisions:
 * - the office and each room call each other (not the Freezer, for now);
 * - an incoming call rings with a tone and a buzz for up to 30 s (only calls: the messages stay silent, 2026-10-30);
 * - nobody answered: "📞 Llamada perdida" stays in the conversation and counts as unread;
 * - a room calling the office rings on every office / manager device with the app open; the first to answer keeps it.
 *
 * How: the voice goes straight between the two devices (WebRTC, the browser's own calls) and only the words to find
 * each other go through the server: one Supabase Realtime channel per room ('act-call-<room>', broadcast), with
 * Presence saying which devices of each side have the app open. Nothing of a call is stored but the line the caller
 * writes in the chat at the end. The demo (no server) uses the browser's BroadcastChannel: two tabs of the same
 * browser can call each other, which is how this was tried.
 *
 * The flow: the caller opens its microphone and sends "ring" every 3 s for 30 s; each device of the other side
 * rings; the one that answers opens its microphone and says "take"; the caller sends its offer to that device only,
 * it answers, both trade their network paths ("ice"), and the audio connects. Either side's Colgar sends "end".
 */

type Side = 'room' | 'office'
type Why = 'hang' | 'decline' | 'cancel' | 'fail' | 'nomic' | 'taken'
type Sig =
  | { t: 'ring'; id: string; dev: string; side: Side; by: string }
  | { t: 'take'; id: string; dev: string; by: string }
  | { t: 'offer'; id: string; dev: string; to: string; sdp: string }
  | { t: 'answer'; id: string; dev: string; to: string; sdp: string }
  | { t: 'ice'; id: string; dev: string; to: string; c: RTCIceCandidateInit }
  | { t: 'end'; id: string; dev: string; why: Why; by?: string; to?: string }
  // the demo's own presence (on the server, Supabase Presence does it)
  | { t: 'here'; dev: string; side: Side; by: string; busy: boolean }
  | { t: 'who'; dev: string }
  | { t: 'bye'; dev: string }
type Peer = { dev: string; side: Side; by: string; busy: boolean }

const RING_MS = 30_000, RING_EVERY = 3_000, CONNECT_MS = 25_000
/** a public STUN server finds each device's way out to the internet; a TURN server (VITE_TURN_URL) relays the voice when the plant's network blocks the direct way */
function iceServers(): RTCIceServer[] {
  const env = import.meta.env as Record<string, string | undefined>
  const list: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
  const turn = (env.VITE_TURN_URL ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  if (turn.length) list.push({ urls: turn, username: env.VITE_TURN_USER ?? '', credential: env.VITE_TURN_PASS ?? '' })
  return list
}
const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }

// ---- what the screens show ----
export type CallPhase = 'idle' | 'mic' | 'calling' | 'incoming' | 'answering' | 'connecting' | 'live' | 'ended'
export type CallView = { phase: CallPhase; room?: Dept; out?: boolean; by?: string; liveAt?: number; note?: string; bad?: boolean; muted?: boolean }
let view: CallView = { phase: 'idle' }
/** who of the other side has the app open, per room: 'yes', 'busy' (all of them in a call) or 'no' */
export type Reach = 'yes' | 'busy' | 'no'
let reach: Partial<Record<Dept, Reach>> = {}
const subs = new Set<() => void>()
const tell = () => subs.forEach((f) => f())
const show = (v: CallView) => { view = v; tell() }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
export const useCall = () => useSyncExternalStore(subscribe, () => view, () => view)
export const useReach = (room: Dept) => useSyncExternalStore(subscribe, () => reach[room] ?? 'no', () => 'no' as Reach)
const inCall = () => !['idle', 'ended'].includes(view.phase)

// ---- this page ----
let meId = ''
/** this page (a device can have the app open twice: each tab is its own end of a call) */
const me = () => (meId ||= deviceId() + '-' + Math.random().toString(36).slice(2, 6))
let mySide: Side = 'office'
let wire: Wire | null = null
let remoteEl: HTMLAudioElement | null = null
const peers = new Map<Dept, Map<string, Peer>>()
function reckon() {
  const next: Partial<Record<Dept, Reach>> = {}
  for (const [room, m] of peers) {
    const theirs = [...m.values()].filter((p) => p.side !== mySide && p.dev !== me())
    next[room] = !theirs.length ? 'no' : theirs.some((p) => !p.busy) ? 'yes' : 'busy'
  }
  if (JSON.stringify(next) !== JSON.stringify(reach)) { reach = next; tell() }
}

// ---- the way the words go: Supabase Realtime on the server, BroadcastChannel in the demo ----
type Wire = { send: (room: Dept, m: Sig) => void; mark: () => void; close: () => void }
const topic = (room: Dept) => 'act-call-' + room.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const mine = () => ({ side: mySide, by: user.get(), busy: inCall() })
function openWire(rooms: Dept[], hear: (room: Dept, m: Sig) => void): Wire {
  const sb = supabase
  if (sb) {
    const chans = new Map(rooms.map((room) => {
      const ch = sb.channel(topic(room), { config: { broadcast: { self: false, ack: false }, presence: { key: me() } } })
      ch.on('broadcast', { event: 'sig' }, (p) => hear(room, p.payload as Sig))
      ch.on('presence', { event: 'sync' }, () => {
        const st = ch.presenceState<{ side?: Side; by?: string; busy?: boolean }>()
        const m = new Map<string, Peer>()
        for (const [dev, metas] of Object.entries(st)) { const x = metas.at(-1); if (x && (x.side === 'room' || x.side === 'office')) m.set(dev, { dev, side: x.side, by: String(x.by ?? ''), busy: !!x.busy }) }
        peers.set(room, m); reckon()
      })
      ch.subscribe((status) => { if (status === 'SUBSCRIBED') void ch.track(mine()) })
      return [room, ch] as const
    }))
    return {
      send: (room, m) => { void chans.get(room)?.send({ type: 'broadcast', event: 'sig', payload: m }) },
      mark: () => chans.forEach((ch) => { void ch.track(mine()) }),
      close: () => chans.forEach((ch) => { void sb.removeChannel(ch) }),
    }
  }
  if (typeof BroadcastChannel === 'undefined') return { send() {}, mark() {}, close() {} }
  // the demo: each page says it is here every 5 s; one not heard for 12 s is gone
  const seenAt = new Map<string, number>()
  const chans = new Map(rooms.map((room) => {
    const bc = new BroadcastChannel(topic(room))
    peers.set(room, new Map())
    bc.onmessage = (e) => {
      const m = e.data as Sig
      if (!m || typeof m !== 'object' || m.dev === me()) return
      if (m.t === 'here') { peers.get(room)?.set(m.dev, { dev: m.dev, side: m.side, by: m.by, busy: m.busy }); seenAt.set(room + '|' + m.dev, Date.now()); reckon() }
      else if (m.t === 'who') bc.postMessage({ t: 'here', dev: me(), ...mine() })
      else if (m.t === 'bye') { peers.get(room)?.delete(m.dev); reckon() }
      else hear(room, m)
    }
    return [room, bc] as const
  }))
  const here = () => chans.forEach((bc) => bc.postMessage({ t: 'here', dev: me(), ...mine() }))
  const sweep = () => { const old = Date.now() - 12_000; for (const [room, m] of peers) for (const dev of [...m.keys()]) if ((seenAt.get(room + '|' + dev) ?? 0) < old) m.delete(dev); reckon() }
  chans.forEach((bc) => bc.postMessage({ t: 'who', dev: me() }))
  here()
  const t = window.setInterval(() => { here(); sweep() }, 5000)
  const bye = () => chans.forEach((bc) => bc.postMessage({ t: 'bye', dev: me() }))
  window.addEventListener('pagehide', bye)
  return {
    send: (room, m) => chans.get(room)?.postMessage(m),
    mark: here,
    close: () => { window.clearInterval(t); window.removeEventListener('pagehide', bye); bye(); chans.forEach((bc) => bc.close()) },
  }
}

// ---- one call at a time ----
type Cur = {
  id: string; room: Dept; out: boolean
  /** the other end: for a call that comes in, the caller; for one that goes out, the device that answered */
  peer?: string; by?: string
  pc?: RTCPeerConnection; stream?: MediaStream; ice: RTCIceCandidateInit[]
  timers: number[]; ringT?: number; missT?: number; lastRing: number; liveAt?: number
  /** somebody on the other side could not answer for want of a microphone */
  nomic?: string
}
let cur: Cur | null = null
const send = (m: Sig) => { if (cur) wire?.send(cur.room, m) }
const other = (room: Dept) => (mySide === 'room' ? tr('la oficina') : room)
export const fmtCallTime = (secs: number) => { const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0') }

/** what the conversation keeps of a call (in Spanish, as the data is; the screen shows it through tr) */
const CALL_TEXT: Record<ChatCall['how'], string> = { done: '📞 Llamada', missed: '📞 Llamada perdida', declined: '📞 Llamada rechazada', failed: '📞 Llamada que no conectó' }
/** how a call line reads on the screen */
export function callLine(c: ChatCall): string {
  return c.how === 'done' ? tr('Llamada · {0}', fmtCallTime(c.secs)) : c.how === 'declined' ? tr('Llamada rechazada') : c.how === 'failed' ? tr('Llamada que no conectó') : tr('Llamada perdida')
}

function micNote(e: unknown): string {
  const n = (e as { name?: string })?.name ?? ''
  if (n === 'NotAllowedError' || n === 'SecurityError') return tr('El micrófono no está permitido en este aparato. Permítelo para esta página (el candado junto a la dirección) y vuelve a intentar.')
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return tr('Este aparato no tiene micrófono.')
  if (n === 'NotReadableError') return tr('Otra app está usando el micrófono. Ciérrala y vuelve a intentar.')
  return tr('No se pudo abrir el micrófono ({0}).', String((e as Error)?.message ?? e))
}
const canCall = () => typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

type End = { tell?: Why; to?: string; note?: string; bad?: boolean; how?: ChatCall['how']; write?: boolean; quiet?: boolean }
/** the call is over: everything let go, the other side told (tell), the caller writes the line in the chat */
function finish(o: End) {
  const c = cur
  if (!c) return
  cur = null
  c.timers.forEach((t) => { window.clearTimeout(t); window.clearInterval(t) })
  stopRing()
  try { c.pc?.close() } catch { /* already */ }
  c.stream?.getTracks().forEach((t) => t.stop())
  if (remoteEl) remoteEl.srcObject = null
  if (o.tell) wire?.send(c.room, { t: 'end', id: c.id, dev: me(), why: o.tell, by: user.get(), ...(o.to ? { to: o.to } : {}) })
  const secs = c.liveAt ? Math.max(1, Math.round((Date.now() - c.liveAt) / 1000)) : 0
  if (c.out && o.write !== false) {
    const how: ChatCall['how'] = secs ? 'done' : o.how ?? 'missed'
    sendChat(c.room, CALL_TEXT[how] + (secs ? ' · ' + fmtCallTime(secs) : ''), '', '', { how, secs })
  }
  if (o.quiet) show({ phase: 'idle' })
  else {
    const note = o.note ?? (secs ? tr('Llamada terminada · {0}', fmtCallTime(secs)) : '')
    show({ phase: 'ended', room: c.room, out: c.out, note, bad: o.bad })
    // a plain ending goes away by itself; a problem waits for Entendido
    if (!o.bad) window.setTimeout(() => { if (view.phase === 'ended' && !cur) show({ phase: 'idle' }) }, 3500)
  }
  wire?.mark()
}

function makePc(c: Cur): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: iceServers() })
  c.stream?.getTracks().forEach((t) => pc.addTrack(t, c.stream!))
  pc.onicecandidate = (e) => { if (e.candidate && cur === c && c.peer) send({ t: 'ice', id: c.id, dev: me(), to: c.peer, c: e.candidate.toJSON() }) }
  pc.ontrack = (e) => { if (remoteEl) { remoteEl.srcObject = e.streams[0] ?? new MediaStream([e.track]); void remoteEl.play().catch(() => { /* played on the next tap */ }) } }
  pc.onconnectionstatechange = () => {
    if (cur !== c) return
    const st = pc.connectionState
    if (st === 'connected') { if (!c.liveAt) { c.liveAt = Date.now(); show({ ...view, phase: 'live', liveAt: c.liveAt, note: '' }) } }
    else if (st === 'failed') finish({ tell: 'fail', how: 'failed', bad: true, note: c.liveAt ? tr('Se cortó la llamada.') : tr('No se pudo conectar el audio. La red de la planta puede estar bloqueándolo.') })
    else if (st === 'disconnected') c.timers.push(window.setTimeout(() => { if (cur === c && pc.connectionState !== 'connected') finish({ tell: 'hang', bad: true, note: tr('Se cortó la llamada.') }) }, 8000))
  }
  // the audio did not connect in time: most likely the network does not let it through
  c.timers.push(window.setTimeout(() => { if (cur === c && !c.liveAt) finish({ tell: 'fail', how: 'failed', bad: true, note: tr('No se pudo conectar el audio. La red de la planta puede estar bloqueándolo.') }) }, CONNECT_MS))
  return pc
}
async function addIce(c: Cur) {
  if (!c.pc?.remoteDescription) return
  for (const x of c.ice.splice(0)) { try { await c.pc.addIceCandidate(x) } catch { /* a stale path */ } }
}

/** the 📞 button: call a room (from the office) or the office (from a room's tablet) */
export async function startCall(room: Dept) {
  if (!wire || cur) return
  const r = reach[room] ?? 'no'
  if (!canCall()) return show({ phase: 'ended', room, out: true, bad: true, note: tr('Este navegador no puede hacer llamadas.') })
  if (r === 'no') return show({ phase: 'ended', room, out: true, bad: true, note: mySide === 'office' ? tr('La tablet de {0} no tiene la app abierta ahora.', room) : tr('Nadie de la oficina tiene la app abierta ahora.') })
  if (r === 'busy') return show({ phase: 'ended', room, out: true, bad: true, note: tr('Están en otra llamada. Intenta en un rato.') })
  const c: Cur = { id: uid(), room, out: true, ice: [], timers: [], lastRing: Date.now() }
  cur = c
  show({ phase: 'mic', room, out: true })
  try { c.stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO }) } catch (e) {
    if (cur === c) { cur = null; show({ phase: 'ended', room, out: true, bad: true, note: micNote(e) }) }
    return
  }
  if (cur !== c) { c.stream.getTracks().forEach((t) => t.stop()); return }
  show({ phase: 'calling', room, out: true })
  wire.mark()
  const ring = () => send({ t: 'ring', id: c.id, dev: me(), side: mySide, by: user.get() })
  ring()
  c.ringT = window.setInterval(ring, RING_EVERY); c.timers.push(c.ringT)
  c.missT = window.setTimeout(() => {
    if (cur === c && !c.peer) finish({ tell: 'cancel', how: 'missed', bad: true, note: c.nomic ? tr('No contestaron. {0} no tiene el micrófono permitido.', c.nomic) : tr('No contestaron.') })
  }, RING_MS)
  c.timers.push(c.missT)
}

/** Contestar */
export async function answerCall() {
  const c = cur
  if (!c || c.out || view.phase !== 'incoming') return
  stopRing()
  show({ ...view, phase: 'answering' })
  if (!canCall()) { finish({ tell: 'nomic', bad: true, note: tr('Este navegador no puede hacer llamadas.') }); return }
  try { c.stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO }) } catch (e) {
    if (cur === c) finish({ tell: 'nomic', bad: true, note: micNote(e) })
    return
  }
  if (cur !== c) { c.stream.getTracks().forEach((t) => t.stop()); return }
  c.pc = makePc(c)
  send({ t: 'take', id: c.id, dev: me(), by: user.get() })
  show({ ...view, phase: 'connecting' })
  wire?.mark()
}

/** Colgar: on the ringing screen it says no; while calling it gives up (a missed call); in a call it ends it */
export function hangUp() {
  if (!cur) { if (view.phase === 'ended') show({ phase: 'idle' }); return }
  if (!cur.out && view.phase === 'incoming') finish({ tell: 'decline', quiet: true })
  else if (cur.out && !cur.peer) finish({ tell: 'cancel', how: 'missed' })
  else finish({ tell: 'hang' })
}
export const closeNote = () => { if (view.phase === 'ended') show({ phase: 'idle' }) }
export function toggleMute() {
  const t = cur?.stream?.getAudioTracks() ?? []
  if (!t.length) return
  const muted = t[0].enabled
  t.forEach((x) => { x.enabled = !muted })
  show({ ...view, muted })
}

async function hear(room: Dept, m: Sig) {
  if (!m || typeof m !== 'object' || !('dev' in m) || m.dev === me()) return
  const c = cur
  switch (m.t) {
    case 'ring': {
      if (m.side === mySide) return // another office computer calling: not for this one
      if (c && c.id === m.id) { c.lastRing = Date.now(); return }
      if (c) {
        // both sides called each other at once: the office's call stays, the room's gives way (and writes nothing)
        if (c.out && c.room === room && !c.peer && mySide === 'room') finish({ tell: 'cancel', write: false, quiet: true })
        else return
      }
      const n: Cur = { id: m.id, room, out: false, peer: m.dev, by: m.by, ice: [], timers: [], lastRing: Date.now() }
      cur = n
      show({ phase: 'incoming', room, out: false, by: m.by })
      startRing()
      wire?.mark()
      // the caller stops by itself after 30 s; if its word is lost, this one stops too
      n.timers.push(window.setInterval(() => { if (cur === n && view.phase === 'incoming' && Date.now() - n.lastRing > 9000) finish({ quiet: true }) }, 2000))
      return
    }
    case 'take': {
      if (!c || c.id !== m.id) return
      if (c.out) {
        if (c.peer) { if (m.dev !== c.peer) wire?.send(room, { t: 'end', id: c.id, dev: me(), why: 'taken', to: m.dev }); return }
        c.peer = m.dev; c.by = m.by
        if (c.ringT) window.clearInterval(c.ringT)
        if (c.missT) window.clearTimeout(c.missT)
        show({ ...view, phase: 'connecting', by: m.by })
        const pc = (c.pc = makePc(c))
        const offer = await pc.createOffer()
        if (cur !== c) return
        await pc.setLocalDescription(offer)
        send({ t: 'offer', id: c.id, dev: me(), to: m.dev, sdp: offer.sdp ?? '' })
      } else if (view.phase === 'incoming') finish({ quiet: true }) // another device of this side answered
      return
    }
    case 'offer': {
      if (!c || c.id !== m.id || c.out || !c.pc) return
      if (m.to !== me()) { finish({ bad: false, note: tr('Otro aparato contestó primero.') }); return }
      await c.pc.setRemoteDescription({ type: 'offer', sdp: m.sdp })
      await addIce(c)
      const ans = await c.pc.createAnswer()
      if (cur !== c) return
      await c.pc.setLocalDescription(ans)
      send({ t: 'answer', id: c.id, dev: me(), to: m.dev, sdp: ans.sdp ?? '' })
      return
    }
    case 'answer': {
      if (!c || c.id !== m.id || !c.out || m.dev !== c.peer || m.to !== me() || !c.pc) return
      await c.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp })
      await addIce(c)
      return
    }
    case 'ice': {
      if (!c || c.id !== m.id || m.to !== me() || m.dev !== c.peer) return
      c.ice.push(m.c)
      await addIce(c)
      return
    }
    case 'end': {
      if (!c || c.id !== m.id || (m.to && m.to !== me())) return
      if (c.out) {
        if (c.peer && m.dev === c.peer) finish({ how: m.why === 'fail' ? 'failed' : 'missed', bad: m.why === 'fail', note: m.why === 'fail' ? tr('No se pudo conectar el audio. La red de la planta puede estar bloqueándolo.') : undefined })
        else if (!c.peer && m.why === 'decline') finish({ tell: 'cancel', how: 'declined', bad: true, note: tr('No pueden contestar ahora.') })
        else if (!c.peer && m.why === 'nomic') c.nomic = m.by || tr('El otro aparato')
        return
      }
      if (m.why === 'taken') { finish({ note: tr('Otro aparato contestó primero.') }); return }
      if (m.dev === c.peer) {
        // the caller hung up: before it was answered it is a missed call here too
        if (view.phase === 'incoming') finish({ quiet: true })
        else finish({ bad: m.why === 'fail', note: m.why === 'fail' ? tr('No se pudo conectar el audio. La red de la planta puede estar bloqueándolo.') : undefined })
      } else if (view.phase === 'incoming' && m.why === 'decline') finish({ quiet: true }) // another device of this side said no
      return
    }
  }
}

// ---- the ring (only for calls; Jose's OK, 2026-11-06) ----
let actx: AudioContext | null = null
function audioCtx(): AudioContext | null {
  try {
    const AC = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    actx ??= new AC()
    if (actx.state === 'suspended') void actx.resume()
    return actx
  } catch { return null }
}
/** "ding-dong ding-dong", soft */
function tone() {
  const a = audioCtx()
  if (!a || a.state !== 'running') return
  const t0 = a.currentTime
  ;[[0, 880], [0.38, 698], [0.95, 880], [1.33, 698]].forEach(([d, f]) => {
    const o = a.createOscillator(), g = a.createGain()
    o.type = 'sine'; o.frequency.value = f
    g.gain.setValueAtTime(0, t0 + d); g.gain.linearRampToValueAtTime(0.32, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t0 + d + 0.34)
    o.connect(g).connect(a.destination); o.start(t0 + d); o.stop(t0 + d + 0.36)
  })
}
let ringT = 0
function startRing() {
  stopRing()
  const beat = () => { tone(); try { (navigator as Navigator & { vibrate?: (p: number[]) => boolean }).vibrate?.([500, 250, 500]) } catch { /* no */ } }
  beat()
  ringT = window.setInterval(beat, 2600)
}
function stopRing() { if (ringT) { window.clearInterval(ringT); ringT = 0 } try { (navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(0) } catch { /* no */ } }

/** while the app is open, this page can call and be called: a room's tablet on its room, the office on every room */
function linkCalls(side: Side, rooms: Dept[]): () => void {
  mySide = side
  peers.clear(); reach = {}
  wire = openWire(rooms, (room, m) => { void hear(room, m).catch(() => { if (cur && cur.room === room) finish({ tell: 'fail', how: 'failed', bad: true, note: tr('No se pudo conectar el audio. La red de la planta puede estar bloqueándolo.') }) }) })
  // a browser plays a sound only after the person has touched the page: the first tap readies the ring
  const unlock = () => { audioCtx() }
  window.addEventListener('pointerdown', unlock, { once: true })
  const leave = () => { if (cur) finish({ tell: cur.out && !cur.peer ? 'cancel' : 'hang', how: 'missed' }) }
  window.addEventListener('pagehide', leave)
  return () => {
    leave()
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('pagehide', leave)
    wire?.close(); wire = null
    peers.clear(); reach = {}; tell()
  }
}

/** the ringing screen, the bar of a call, and the hidden player of the other side's voice: once, at the app's top */
export function CallHost({ side, home, on }: { side: Side; home: Dept; on: boolean }) {
  useEffect(() => (on ? linkCalls(side, side === 'room' ? [home] : DEPTS) : undefined), [on, side, home])
  const v = useCall()
  const audio = useRef<HTMLAudioElement>(null)
  useEffect(() => { remoteEl = audio.current; return () => { remoteEl = null } }, [])
  const [, tick] = useState(0)
  useEffect(() => { if (v.phase !== 'live') return; const i = window.setInterval(() => tick((n) => n + 1), 1000); return () => window.clearInterval(i) }, [v.phase])
  const room = v.room
  const look = room ? DEPT_LOOK[room] : undefined
  const them = room ? other(room) : ''
  return (
    <>
      <audio ref={audio} autoPlay playsInline className="call-audio" />
      {v.phase === 'incoming' && room && look && (
        <div className="call-in" style={lookVars(look)} role="alertdialog" aria-label={side === 'room' ? tr('Llamada de la oficina') : tr('Llamada de {0}', room)}>
          <div className="call-in-card">
            <span className="call-in-e" aria-hidden="true">{side === 'room' ? '🏢' : look.emoji}</span>
            <b>{side === 'room' ? tr('Llamada de la oficina') : tr('Llamada de {0}', room)}</b>
            {v.by && <small>{v.by}</small>}
            <div className="call-in-btns">
              <button type="button" className="call-no" onClick={hangUp}><span aria-hidden="true">📵</span>{tr('Colgar')}</button>
              <button type="button" className="call-yes" onClick={() => void answerCall()}><span aria-hidden="true">📞</span>{tr('Contestar')}</button>
            </div>
          </div>
        </div>
      )}
      {room && look && v.phase !== 'idle' && v.phase !== 'incoming' && (
        <div className={'call-bar' + (v.phase === 'live' ? ' live' : '') + (v.bad ? ' bad' : '')} style={lookVars(look)} role="status">
          <span className="call-bar-e" aria-hidden="true">{v.phase === 'ended' ? (v.bad ? '⚠️' : '📞') : side === 'room' ? '🏢' : look.emoji}</span>
          <span className="call-bar-t">
            {v.phase === 'mic' || v.phase === 'answering' ? tr('Abriendo el micrófono…')
              : v.phase === 'calling' ? tr('Llamando a {0}…', them)
              : v.phase === 'connecting' ? tr('Conectando…')
              : v.phase === 'live' ? <>{tr('En llamada con {0}', them)} · <b>{fmtCallTime(Math.max(0, Math.round((Date.now() - (v.liveAt ?? Date.now())) / 1000)))}</b></>
              : v.note || tr('Llamada terminada')}
            {v.by && v.phase !== 'ended' && v.phase !== 'calling' && v.phase !== 'mic' && <small>{v.by}</small>}
          </span>
          {v.phase === 'live' && <button type="button" className={'call-mute' + (v.muted ? ' on' : '')} onClick={toggleMute} aria-pressed={!!v.muted} aria-label={v.muted ? tr('Activar mi micrófono') : tr('Silenciar mi micrófono')} title={v.muted ? tr('Activar mi micrófono') : tr('Silenciar mi micrófono')}>{v.muted ? '🔇' : '🎙️'}</button>}
          {v.phase === 'ended'
            ? <button type="button" className="call-ok" onClick={closeNote}>{tr('Entendido')}</button>
            : <button type="button" className="call-no" onClick={hangUp}>{tr('Colgar')}</button>}
        </div>
      )}
    </>
  )
}

/** 📞 in a conversation's header, with a dot: green = somebody on the other side has the app open */
export function CallButton({ room, side }: { room: Dept; side: Side }) {
  const v = useCall(), r = useReach(room)
  const what = r === 'yes' ? (side === 'room' ? tr('Llamar a la oficina') : tr('Llamar a {0}', room)) : r === 'busy' ? tr('Están en otra llamada') : side === 'room' ? tr('Nadie de la oficina tiene la app abierta ahora.') : tr('La tablet de {0} no tiene la app abierta ahora.', room)
  return (
    <button type="button" className={'chat-call ' + r} onClick={() => void startCall(room)} disabled={inCall()} aria-label={what} title={what} data-phase={v.phase}>
      <span aria-hidden="true">📞</span><i aria-hidden="true" />
    </button>
  )
}
