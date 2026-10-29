import { Fragment, useEffect, useRef, useState } from 'react'
import { CHAT_AUDIO_TEXT, CHAT_PHOTO_TEXT, CHAT_ROOMS, chatOf, chatSeenOf, chatUnread, dayOf, fmtTime, markChatSeen, sendChat, uid, writesRoom, type ChatRoom, type Dept, type State } from './store'
import { supabase } from './supabase'
import { DEPT_LOOK, FREEZER_LOOK, lookVars } from './look'

/** a room's look, the freezer's too */
const lookOf = (d: ChatRoom) => (d === 'Freezer' ? FREEZER_LOOK : DEPT_LOOK[d])
import { longDate, useWho } from './App'
import { tr } from './i18n'

/**
 * Messages between each room and the office (Jose, 2026-10-28: "que el operador de la tablet pueda escribir también
 * para atrás ... un botón de mandar mensaje a los de la oficina; el de la oficina lo recibe en un botón flotante
 * redondo, uno diferente por cada departamento, así sabe qué departamento le mandó"). A room's tablet has one round
 * button; the office and the managers have one per room, with the room's emoji and colour. Each opens the
 * conversation in its own window, like a chat. What is unread is each device's own: the moment it last looked at a
 * room's conversation (localStorage), so a message read on the office's computer still shows on a manager's phone.
 */
const SEEN = 'act_chat_seen:'
// (by side as well: a device that enters as the office and later as a room keeps them apart)
const seenOf = (side: string, d: ChatRoom) => { try { return Number(localStorage.getItem(SEEN + side + ':' + d)) || 0 } catch { return 0 } }
// the buttons can be put away and brought back (Jose, 2026-10-28): remembered on the device
const HIDDEN = 'act_chat_hidden'
const markSeen = (side: string, d: ChatRoom, at: number) => { try { localStorage.setItem(SEEN + side + ':' + d, String(at)) } catch { /* private window: counted again next time */ } }

export function Chat({ s, home }: { s: State; home: Dept }) {
  const who = useWho()
  const side = who.role === 'op' ? 'room' : 'office'
  const rooms: ChatRoom[] = side === 'room' ? [home] : CHAT_ROOMS
  const [open, setOpen] = useState<ChatRoom | null>(null)
  const [hidden, setHiddenState] = useState(() => { try { return localStorage.getItem(HIDDEN) === '1' } catch { return false } })
  const setHidden = (h: boolean) => { setHiddenState(h); if (h) setOpen(null); try { localStorage.setItem(HIDDEN, h ? '1' : '') } catch { /* no */ } }
  const [, bump] = useState(0)
  const unread = Object.fromEntries(rooms.map((d) => [d, chatUnread(s, d, side, seenOf(side, d))])) as Record<ChatRoom, number>
  // the conversation that is open is read as it is looked at
  const last = open ? (chatOf(s, open).at(-1)?.at ?? 0) : 0
  useEffect(() => { if (open && last > seenOf(side, open)) { markSeen(side, open, last); bump((n) => n + 1) } }, [open, last])
  // and the other side is told how far this one has looked (store.ts, markChatSeen; once per new message)
  useEffect(() => { if (open && last) markChatSeen(open, last) }, [open, last])
  // a message that just came from the other side: a short buzz on devices that can, and a tone (Jose, 2026-10-28: "que
  // suene también cuando llegue un mensaje"; the browser lets a page sound only after it was touched once)
  const total = rooms.reduce((t, d) => t + unread[d], 0)
  const prev = useRef(total)
  useEffect(() => { if (total > prev.current) { try { (navigator as Navigator & { vibrate?: (ms: number) => boolean }).vibrate?.(150) } catch { /* no */ } chime() } prev.current = total }, [total])
  if (hidden) {
    return (
      <button type="button" className="chat-peek" onClick={() => setHidden(false)} aria-label={tr('Mostrar los mensajes')} title={tr('Mostrar los mensajes')}>
        ‹{total > 0 && <i className="chat-badge">{total}</i>}
      </button>
    )
  }
  return (
    <>
      <div className={'chat-fabs' + (side === 'office' ? ' many' : '') + (open ? ' has-open' : '')}>
        <button type="button" className="chat-hide" onClick={() => setHidden(true)} aria-label={tr('Ocultar los mensajes')} title={tr('Ocultar los mensajes')}>×</button>
        {rooms.map((d) => (
          <button key={d} type="button" className={'chat-fab' + (open === d ? ' on' : '')} style={lookVars(lookOf(d))} aria-label={tr('Mensajes · {0}', d)} title={tr('Mensajes · {0}', d)} onClick={() => setOpen(open === d ? null : d)}>
            <span className="chat-fab-ico" aria-hidden="true">{side === 'room' ? '💬' : lookOf(d).emoji}</span>
            {side === 'office' && <small className="chat-fab-name">{d}</small>}
            {unread[d] > 0 && <i className="chat-badge">{unread[d]}</i>}
          </button>
        ))}
      </div>
      {open && <ChatWindow s={s} dept={open} side={side} onClose={() => setOpen(null)} />}
    </>
  )
}

/** two short notes, made here (no file to load); nothing when the page may not sound yet */
let audio: AudioContext | null = null
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    audio = audio ?? new Ctx()
    if (audio.state === 'suspended') void audio.resume().catch(() => undefined)
    const at = audio.currentTime
    for (const [f, t0] of [[880, 0], [1175, 0.14]] as const) {
      const o = audio.createOscillator(), g = audio.createGain()
      o.type = 'sine'; o.frequency.value = f
      g.gain.setValueAtTime(0.0001, at + t0); g.gain.exponentialRampToValueAtTime(0.25, at + t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + t0 + 0.16)
      o.connect(g).connect(audio.destination); o.start(at + t0); o.stop(at + t0 + 0.18)
    }
  } catch { /* no sound here */ }
}

// ---- photos (Jose, 2026-10-28: "que se puedan agregar imágenes, como yo pego aquí, o dar a un + para buscar alguna") ----
/** the photo made small enough to send (longest side `max`, JPEG): a tablet's camera gives 4,000 px and megabytes */
async function shrink(file: Blob, max: number): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const cv = document.createElement('canvas')
    cv.width = Math.max(1, Math.round(bmp.width * k)); cv.height = Math.max(1, Math.round(bmp.height * k))
    cv.getContext('2d')?.drawImage(bmp, 0, 0, cv.width, cv.height)
    bmp.close()
    return await new Promise<Blob>((r) => cv.toBlob((b) => r(b ?? file), 'image/jpeg', 0.82))
  } catch { return file }
}
const asDataUrl = (b: Blob) => new Promise<string>((r, j) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.onerror = () => j(fr.error); fr.readAsDataURL(b) })
const BUCKET = 'act_chat'
/** a link to see a photo of the bucket, good for an hour, kept while it is (a data: URL is itself) */
const links = new Map<string, { url: string; until: number }>()
async function photoUrl(path: string): Promise<string> {
  if (path.startsWith('data:')) return path
  const had = links.get(path)
  if (had && had.until > Date.now()) return had.url
  if (!supabase) return ''
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) return ''
  links.set(path, { url: data.signedUrl, until: Date.now() + 3300_000 })
  return data.signedUrl
}
function ChatImg({ path, onOpen }: { path: string; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState(path.startsWith('data:') ? path : links.get(path)?.url ?? '')
  const [gone, setGone] = useState(false)
  useEffect(() => { let on = true; if (!url) void photoUrl(path).then((u) => { if (on) { if (u) setUrl(u); else setGone(true) } }); return () => { on = false } }, [path]) // eslint-disable-line react-hooks/exhaustive-deps
  if (gone) return <span className="chat-img-gone">📷 {tr('Foto que este aparato no puede traer ahora')}</span>
  if (!url) return <span className="chat-img-wait">📷 …</span>
  return <img className="chat-img" src={url} alt={tr('Foto')} onClick={() => onOpen(url)} onError={() => { links.delete(path); setGone(true) }} />
}

// ---- voice notes (Jose, 2026-10-29: "¿y el audio?") ----
const REC_MAX_S = 60
/** the kind of recording this browser makes: Opus in WebM (Chrome, Android), else MP4 (Safari); '' = none */
function recMime(): string {
  const MR = (window as Window & { MediaRecorder?: typeof MediaRecorder }).MediaRecorder
  if (!MR) return ''
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MR.isTypeSupported(m)) ?? ''
}
const extOf = (mime: string) => (/mp4/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : 'webm')
function ChatAudio({ path }: { path: string }) {
  const [url, setUrl] = useState(path.startsWith('data:') ? path : links.get(path)?.url ?? '')
  const [gone, setGone] = useState(false)
  useEffect(() => { let on = true; if (!url) void photoUrl(path).then((u) => { if (on) { if (u) setUrl(u); else setGone(true) } }); return () => { on = false } }, [path]) // eslint-disable-line react-hooks/exhaustive-deps
  if (gone) return <span className="chat-img-gone">🎤 {tr('Nota de voz que este aparato no puede traer ahora')}</span>
  if (!url) return <span className="chat-img-wait">🎤 …</span>
  return <audio className="chat-audio" controls preload="none" src={url} onError={() => { links.delete(path); setGone(true) }} />
}

function ChatWindow({ s, dept, side, onClose }: { s: State; dept: ChatRoom; side: 'room' | 'office'; onClose: () => void }) {
  const who = useWho()
  const canWrite = who.role !== 'viewer' && writesRoom(dept)
  const list = chatOf(s, dept)
  // how far the other side has looked (2026-10-28): under each message of this side, "Visto · quién · hora" or "Sin ver
  // todavía". The freezer's app does not say it yet: nothing under the messages to the freezer
  const theirs = dept === 'Freezer' && side === 'office' ? null : chatSeenOf(s, dept, side === 'room' ? 'office' : 'room') ?? null
  const seenMark = (at: number) => (dept === 'Freezer' && side === 'office' ? null : theirs && theirs.at >= at ? <small className="chat-seen on">✓✓ {tr('Visto · {0} · {1}', theirs.by, fmtTime(theirs.seenAt))}</small> : <small className="chat-seen">✓ {tr('Sin ver todavía')}</small>)
  const [text, setText] = useState('')
  // a photo picked (pasted, or found with +) and not sent yet; busy = what the sending is doing or what went wrong
  const [pic, setPic] = useState<{ blob: Blob; url: string } | null>(null)
  // a voice note recorded and not sent yet; while recording, the recorder and its seconds
  const [note, setNote] = useState<{ blob: Blob; url: string; secs: number } | null>(null)
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null)
  const [recSecs, setRecSecs] = useState(0)
  const canRecord = !!recMime() && !!navigator.mediaDevices?.getUserMedia
  const dropNote = () => { setNote((was) => { if (was) URL.revokeObjectURL(was.url); return null }); setBusy('') }
  const stopRec = () => { try { recorder?.stop() } catch { /* already */ } }
  const startRec = async () => {
    if (recorder) { stopRec(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = recMime(), chunks: Blob[] = []
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      const t0 = Date.now()
      const tick = setInterval(() => { const sec = Math.round((Date.now() - t0) / 1000); setRecSecs(sec); if (sec >= REC_MAX_S) { try { mr.stop() } catch { /* already */ } } }, 250)
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      mr.onstop = () => {
        clearInterval(tick); stream.getTracks().forEach((tr) => tr.stop()); setRecorder(null)
        const blob = new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' }), secs = Math.max(1, Math.round((Date.now() - t0) / 1000))
        if (blob.size > 0) { dropPic(); setNote((was) => { if (was) URL.revokeObjectURL(was.url); return { blob, url: URL.createObjectURL(blob), secs } }) }
      }
      mr.start(1000); setRecorder(mr); setRecSecs(0); setBusy('')
    } catch (e) { setBusy(tr('No se pudo grabar ({0}). ¿El micrófono está permitido para esta página?', String((e as Error)?.message ?? e))) }
  }
  const [busy, setBusy] = useState('')
  const [zoom, setZoom] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [list.length, dept, pic])
  const takeFile = async (f: Blob | null | undefined) => {
    if (!f || !/^image\//.test(f.type)) return
    const small = await shrink(f, supabase ? 1280 : 640)
    setPic((was) => { if (was) URL.revokeObjectURL(was.url); return { blob: small, url: URL.createObjectURL(small) } })
    setBusy('')
  }
  const dropPic = () => { setPic((was) => { if (was) URL.revokeObjectURL(was.url); return null }); setBusy('') }
  const onPaste = (e: React.ClipboardEvent) => { const f = [...(e.clipboardData?.files ?? [])].find((x) => /^image\//.test(x.type)); if (f) { e.preventDefault(); void takeFile(f) } }
  const [sending, setSending] = useState(false)
  const send = async () => {
    if (sending || recorder || (!text.trim() && !pic && !note)) return
    let img = '', audio = ''
    if (note) {
      setSending(true)
      try {
        if (supabase) {
          const path = dept + '/' + uid() + '.' + extOf(note.blob.type)
          setBusy(tr('Subiendo la nota de voz…'))
          const { error } = await supabase.storage.from(BUCKET).upload(path, note.blob, { contentType: note.blob.type || 'audio/webm', upsert: false })
          if (error) { setBusy(tr('No se pudo mandar la nota de voz ({0}). ¿Hay señal? Vuelve a intentar.', error.message)); setSending(false); return }
          audio = path
        } else audio = await asDataUrl(note.blob)
      } catch (e) { setBusy(tr('No se pudo mandar la nota de voz ({0}). ¿Hay señal? Vuelve a intentar.', String((e as Error)?.message ?? e))); setSending(false); return }
    }
    if (pic) {
      setSending(true)
      try {
        if (supabase) {
          // the photo goes to the bucket first, under its room (the server's rules are the chat's), then the message names it
          const path = dept + '/' + uid() + '.jpg'
          setBusy(tr('Subiendo la foto…'))
          const { error } = await supabase.storage.from(BUCKET).upload(path, pic.blob, { contentType: 'image/jpeg', upsert: false })
          if (error) { setBusy(tr('No se pudo mandar la foto ({0}). ¿Hay señal? Vuelve a intentar.', error.message)); setSending(false); return }
          img = path
        } else img = await asDataUrl(pic.blob)
      } catch (e) { setBusy(tr('No se pudo mandar la foto ({0}). ¿Hay señal? Vuelve a intentar.', String((e as Error)?.message ?? e))); setSending(false); return }
    }
    if (sendChat(dept, text, img, audio)) { setText(''); dropPic(); dropNote() }
    setSending(false)
  }
  return (
    <div className={'chat-win' + (side === 'office' ? ' office' : '')} style={lookVars(lookOf(dept))} role="dialog" aria-label={tr('Mensajes · {0}', dept)}>
      <div className="chat-head">
        <span className="chat-avatar" aria-hidden="true">{side === 'room' ? '🏢' : lookOf(dept).emoji}</span>
        <div><b>{side === 'room' ? tr('Oficina') : dept}</b><small>{side === 'room' ? tr('Mensajes con la oficina y los managers') : tr('Mensajes con {0}', dept)}</small></div>
        <button type="button" className="chat-x" onClick={onClose} aria-label={tr('Cerrar')}>×</button>
      </div>
      <div className="chat-body">
        {!list.length && <p className="chat-empty">{side === 'room' ? tr('Escribe aquí a la oficina. Lo ven en su pantalla y te contestan aquí mismo.') : dept === 'Freezer' ? tr('Todavía no hay mensajes con el freezer. Escribe abajo: lo ven en Freezer RTE, en sus teléfonos.') : tr('Todavía no hay mensajes con {0}. Escribe abajo: lo ven en las tablets de ese cuarto.', dept)}</p>}
        {list.map((x, i) => {
          const day = dayOf(x.at), before = i ? dayOf(list[i - 1].at) : ''
          return (
            <Fragment key={x.id}>
              {day !== before && <div className="chat-day">{longDate(day)}</div>}
              <div className={'chat-msg ' + (x.side === side ? 'mine' : 'theirs')}>
                {x.img && <ChatImg path={x.img} onOpen={setZoom} />}
                {x.audio && <ChatAudio path={x.audio} />}
                {(x.text && !(x.img && x.text === CHAT_PHOTO_TEXT) && !(x.audio && x.text === CHAT_AUDIO_TEXT)) && <div className="chat-bubble">{x.text}</div>}
                <small>{x.by} · {fmtTime(x.at)}</small>
                {x.side === side && seenMark(x.at)}
              </div>
            </Fragment>
          )
        })}
        <div ref={end} />
      </div>
      {canWrite && (pic || note || recorder || busy) && (
        <div className="chat-pic">
          {pic && <img src={pic.url} alt="" />}
          {pic && !sending && <button type="button" className="chat-pic-x" onClick={dropPic} aria-label={tr('Quitar la foto')}>×</button>}
          {recorder && <span className="chat-rec"><i />{tr('Grabando… {0} s · toca el micrófono para parar', recSecs)}</span>}
          {note && !recorder && <audio className="chat-audio" controls src={note.url} />}
          {note && !recorder && !sending && <button type="button" className="chat-pic-x" onClick={dropNote} aria-label={tr('Quitar la nota de voz')}>×</button>}
          {busy && <small className={sending ? '' : 'err'}>{busy}</small>}
        </div>
      )}
      {canWrite
        ? <form className="chat-form" onSubmit={(e) => { e.preventDefault(); void send() }}>
            {/* a photo: found on the device (a tablet offers its camera too), or pasted into the box */}
            <label className="chat-plus" title={tr('Mandar una foto')}><input type="file" accept="image/*" onChange={(e) => { void takeFile(e.target.files?.[0]); e.target.value = '' }} /><span aria-hidden="true">+</span><span className="sr-only">{tr('Mandar una foto')}</span></label>
            {/* a voice note: one tap starts, another stops (at most a minute); it is heard before sending */}
            {canRecord && <button type="button" className={'chat-mic' + (recorder ? ' on' : '')} onClick={() => void startRec()} disabled={sending} aria-label={recorder ? tr('Parar la grabación') : tr('Grabar una nota de voz')} title={recorder ? tr('Parar la grabación') : tr('Grabar una nota de voz')}>{recorder ? '■' : '🎤'}</button>}
            <input value={text} maxLength={600} placeholder={pic ? tr('Un texto con la foto (opcional)') : note ? tr('Un texto con la nota de voz (opcional)') : tr('Escribe un mensaje…')} aria-label={tr('Escribe un mensaje…')} autoComplete="off" onChange={(e) => setText(e.target.value)} onPaste={onPaste} />
            <button type="submit" className="chat-send" disabled={sending || !!recorder || (!text.trim() && !pic && !note)} aria-label={tr('Mandar')}>➤</button>
          </form>
        : <p className="chat-ro">{tr('Solo ver: aquí no se escribe.')}</p>}
      {zoom && <div className="veil chat-zoom" onClick={() => setZoom('')} role="dialog" aria-label={tr('Foto')}><img src={zoom} alt={tr('Foto')} /><button type="button" className="chat-x" onClick={() => setZoom('')} aria-label={tr('Cerrar')}>×</button></div>}
    </div>
  )
}
