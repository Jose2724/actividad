import { Fragment, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from './supabase'
import { lang, tr } from './i18n'
import { useWho } from './App'
import { AYUDA_IMAGES, AYUDA_LINKS } from './ayudaLinks'
import { REASON_CODES, codeReason, codeText, SETUP_CODE } from './reasons'
import { DEPT_LOOK } from './look'

/**
 * 🤖 Ayuda (Jose, 2026-11-06: "una IA para esta Web App. Así cualquier empleado pueda hacerle preguntas, que ella le
 * conteste correctamente, le ponga imagen y paso a paso cómo llegar y cómo hacerlo y también link para llegar más
 * rápido ... que solo le dé la info que le pertenece, que no puedan borrar nada con la IA"). The questions go to the
 * act-ayuda edge function, which knows who asks from the sign-in and answers from the app's guide cut to that role;
 * nothing here can change a record. An answer may hold [[ir:ID]] (a button to that screen, only if this person sees
 * it), [[img:ID]] (one of the app's own screenshots) and [[codigo:XXX-00]] (a button that picks that reason code in the
 * stop window, which the person still confirms). Off in Ajustes, only the owner has it.
 */
export type AyudaMsg = { role: 'user' | 'assistant'; text: string; image?: { type: string; data: string; url: string }; id?: string | null; rating?: 1 | -1; error?: boolean }
export type AyudaCtx = { tab?: string; room?: string }

/** the conversation stays while the app is open (closing the window keeps it; Nueva conversación clears it) */
let kept: AyudaMsg[] = []

/** may this person use it here? The owner, or everybody with the switch on; the demo shows it with an example */
export const ayudaShown = (on: boolean, admin: boolean) => !supabase || admin || on

/** the demo has no server to ask: an example of what an answer looks like (invented, said as such) */
const demoChat = (): AyudaMsg[] => [
  { role: 'user', text: tr('Marqué un carro de más en la Línea 2, ¿cómo lo quito?') },
  { role: 'assistant', text: [tr('Se quita en **Corregir** de tu línea:'), '1. ' + tr('En la tarjeta de la Línea 2, toca **Corregir** (debajo de los botones).'), '2. ' + tr('Busca el carro por la hora.'), '3. ' + tr('Tócalo para marcarlo y quítalo.'), '4. ' + tr('Toca **✓ Guardar**.'), tr('Si el código ya terminó, solo un manager lo corrige en Reportes.') + ' [[img:corregir-linea]] [[ir:act]] [[ir:rep:rec]]'].join('\n') },
  { role: 'user', text: tr('Se atoró el plástico en la selladora') },
  { role: 'assistant', text: tr('El código que va es **EQP-01 · Falla mecánica**: la máquina se atoró. Si solo se acabó el rollo y hubo que poner otro, sería **MAT-01 · Falta de material**.') + ' [[codigo:EQP-01]]' },
]

const ERR: Record<string, () => string> = {
  off: () => tr('La Ayuda todavía no está prendida para todos.'),
  limit: () => tr('Ya hiciste muchas preguntas hoy. Mañana puedes seguir.'),
  no_key: () => tr('La Ayuda no está lista en el servidor todavía. Avísale a Jose.'),
  busy: () => tr('La Ayuda está ocupada. Prueba otra vez en un minuto.'),
  not_signed_in: () => tr('Tu sesión se cerró. Sal y entra de nuevo con tu usuario.'),
  no_role: () => tr('Tu cuenta no tiene rol en esta app.'),
}

async function ask(list: AyudaMsg[], ctx: AyudaCtx, kind: 'ask' | 'paro'): Promise<{ text: string; id: string | null } | { error: string }> {
  if (!supabase) return { error: tr('La Ayuda necesita el servidor: en el demo no contesta.') }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { error: tr('Sin señal: la Ayuda necesita internet.') }
  const messages = list.filter((m) => !m.error).map((m, i, all) => ({ role: m.role, text: m.text, ...(m.image && i === all.length - 1 ? { image: { type: m.image.type, data: m.image.data } } : {}) }))
  const { data, error } = await supabase.functions.invoke('act-ayuda', { body: { messages, ctx, lang, kind } })
  if (error) {
    let code = ''
    try { const ctxRes = (error as { context?: Response }).context; code = ctxRes ? String((await ctxRes.json())?.error ?? '') : '' } catch { /* not json */ }
    return { error: ERR[code]?.() ?? tr('La Ayuda no pudo contestar. Prueba otra vez.') }
  }
  return { text: String(data?.text ?? ''), id: data?.id ?? null }
}

function rate(id: string, rating: 1 | -1) {
  void supabase?.functions.invoke('act-ayuda', { body: { action: 'rate', id, rating } })
}

/** a photo made small for the trip (longest side 1568 px, JPEG): what the AI reads best and the server takes */
async function shrink(file: Blob): Promise<{ type: string; data: string; url: string } | null> {
  if (!file.type.startsWith('image/')) return null
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url })
    const k = Math.min(1, 1568 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    const dataUrl = c.toDataURL('image/jpeg', 0.85)
    return { type: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1), url: dataUrl }
  } catch { return null } finally { URL.revokeObjectURL(url) }
}

/** **bold** inside a line */
function inline(text: string, key: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((t, i) => (t.startsWith('**') && t.endsWith('**') ? <b key={key + i}>{t.slice(2, -2)}</b> : <Fragment key={key + i}>{t}</Fragment>))
}

type Tools = { canGo: (id: string) => boolean; onGo: (id: string) => void; onCode?: (reason: string) => void }

/** an answer in the app's own words: paragraphs, numbered steps, bullets, and the three kinds of buttons */
export function AyudaText({ text, tools }: { text: string; tools: Tools }) {
  const links: string[] = [], imgs: string[] = [], codes: string[] = []
  const clean = text
    .replace(/\[\[ir:([\w:]+)\]\]/g, (_, id: string) => { if (!links.includes(id)) links.push(id); return '' })
    .replace(/\[\[img:([\w-]+)\]\]/g, (_, id: string) => { if (!imgs.includes(id)) imgs.push(id); return '' })
    .replace(/\[\[codigo:([A-Z]{3}-\d\d)\]\]/g, (_, c: string) => { if (!codes.includes(c)) codes.push(c); return '' })
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => { if (list) { const L = list.ordered ? 'ol' : 'ul'; blocks.push(<L key={'l' + blocks.length}>{list.items.map((t, i) => <li key={i}>{inline(t, 'li' + i)}</li>)}</L>); list = null } }
  for (const raw of clean.split('\n')) {
    const line = raw.trim()
    const o = /^\d+[.)]\s+(.*)$/.exec(line), u = /^[-•*]\s+(.*)$/.exec(line)
    if (o || u) {
      const ordered = !!o
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] } }
      list.items.push((o ?? u)![1])
    } else { flush(); if (line) blocks.push(<p key={'p' + blocks.length}>{inline(line.replace(/^#+\s*/, ''), 'p' + blocks.length)}</p>) }
  }
  flush()
  const okImgs = imgs.filter((id) => AYUDA_IMAGES[id]).slice(0, 2)
  const okLinks = links.filter((id) => AYUDA_LINKS[id] && tools.canGo(id)).slice(0, 3)
  const okCodes = codes.map((c) => REASON_CODES.find((x) => x.code === c)).filter((x): x is (typeof REASON_CODES)[number] => !!x && x.code !== SETUP_CODE)
  return (
    <div className="ay-text">
      {blocks}
      {okImgs.map((id) => <figure key={id} className="ay-shot"><a href={import.meta.env.BASE_URL + 'ayuda/img/' + id + '.png'} target="_blank" rel="noopener" title={tr('Ver en grande')}><img src={import.meta.env.BASE_URL + 'ayuda/img/' + id + '.png'} alt={AYUDA_IMAGES[id]} loading="lazy" /></a><figcaption>{AYUDA_IMAGES[id]}</figcaption></figure>)}
      {(okLinks.length > 0 || (tools.onCode && okCodes.length > 0)) && (
        <div className="ay-acts">
          {tools.onCode && okCodes.map((x) => <button key={x.code} type="button" className="btn primary sm" onClick={() => tools.onCode!(codeReason(x))}>✓ {tr('Usar {0}', codeText(x))}</button>)}
          {okLinks.map((id) => <button key={id} type="button" className="btn ay-go sm" onClick={() => tools.onGo(id)}>➜ {tr('Ir a {0}', tr(AYUDA_LINKS[id]))}</button>)}
        </div>
      )}
    </div>
  )
}

const roleWord = (role: string, admin?: boolean) => (admin ? tr('Dueño') : role === 'op' ? tr('Operador') : role === 'mgr' ? tr('Manager') : role === 'office' ? tr('Oficina') : tr('Solo ver'))

/** the header's button */
export function AyudaButton({ onOpen }: { onOpen: () => void }) {
  return <button type="button" className="rd-ayuda-btn" onClick={onOpen} title={tr('Ayuda')} aria-label={tr('Ayuda')}><span aria-hidden="true">🤖</span><span className="rd-ayuda-t">{tr('Ayuda')}</span></button>
}

/** the window: its top and its box to write stay; only the conversation scrolls */
export function AyudaWindow({ name, ctx, canGo, onGo, onClose }: { name: string; ctx: AyudaCtx; canGo: (id: string) => boolean; onGo: (id: string) => void; onClose: () => void }) {
  const who = useWho()
  const [msgs, setMsgs] = useState<AyudaMsg[]>(kept)
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState<AyudaMsg['image'] | undefined>()
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => { kept = msgs; const el = listRef.current; if (el) el.scrollTop = el.scrollHeight }, [msgs, busy])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const send = async (q = text) => {
    if (busy || (!q.trim() && !photo)) return
    const mine: AyudaMsg = { role: 'user', text: q.trim(), ...(photo ? { image: photo } : {}) }
    const next = [...msgs.filter((m) => !m.error), mine]
    setMsgs(next); setText(''); setPhoto(undefined); setBusy(true)
    const r = await ask(next, ctx, 'ask')
    setBusy(false)
    setMsgs([...next, 'error' in r ? { role: 'assistant', text: r.error, error: true } : { role: 'assistant', text: r.text, id: r.id }])
  }
  const takeFile = async (f: Blob | null | undefined) => { if (f) { const p = await shrink(f); if (p) setPhoto(p) } }
  const rated = (i: number, v: 1 | -1) => { const m = msgs[i]; if (!m.id || m.rating) return; rate(m.id, v); setMsgs(msgs.map((x, k) => (k === i ? { ...x, rating: v } : x))) }
  const tools: Tools = { canGo, onGo: (id) => { onGo(id); onClose() } }
  const ideas = who.role === 'op'
    ? [tr('¿Cómo corrijo una unidad que marqué de más?'), tr('Se atoró la máquina: ¿qué reason code pongo?'), tr('¿Cómo termino el turno?')]
    : [tr('¿Qué significa Trabajando y Parado?'), tr('¿Cómo leo la gráfica del Mini KPI?'), tr('¿Cómo corrijo un registro de otro turno?')]
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg rd-ayuda" role="dialog" aria-modal="true" aria-label={tr('Ayuda')} onClick={(e) => e.stopPropagation()}
        onPaste={(e) => { const f = [...e.clipboardData.items].find((x) => x.type.startsWith('image/'))?.getAsFile(); if (f) { e.preventDefault(); void takeFile(f) } }}>
        <div className="ay-top">
          <span className="ay-bot" aria-hidden="true">🤖</span><h3>{tr('Ayuda')}</h3>
          <span className="ay-who" title={tr('La Ayuda sabe quién eres por tu usuario')}>{roleWord(who.role, who.admin)}{who.role === 'op' && who.dept ? ' · ' + (DEPT_LOOK[who.dept as keyof typeof DEPT_LOOK]?.emoji ?? '') + ' ' + who.dept : ''}{who.shift ? ' · ' + tr('Turno {0}', who.shift) : ''}</span>
          {msgs.length > 0 && <button type="button" className="btn sm" onClick={() => setMsgs([])}>{tr('Nueva')}</button>}
          <button type="button" className="rd-x" aria-label={tr('Cerrar')} onClick={onClose}>✕</button>
        </div>
        <div className="ay-list" ref={listRef} aria-live="polite">
          {msgs.length === 0 && (
            <div className="ay-hello">
              <p>{tr('Hola {0}. Pregúntame cómo se usa la app, qué significa un número o qué reason code poner. También puedes mandar una foto de la pantalla.', name.split(' ')[0])}</p>
              <div className="ay-ideas">{ideas.map((x) => <button key={x} type="button" className="btn soft sm" onClick={() => void send(x)}>{x}</button>)}</div>
              <p className="ay-note">{tr('La Ayuda solo explica: no puede cambiar ni borrar nada. Puede equivocarse: si algo no cuadra, pregúntale a tu manager.')}</p>
              {!supabase && <button type="button" className="btn sm" onClick={() => setMsgs(demoChat())}>👀 {tr('Ver un ejemplo (demo)')}</button>}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={'ay-msg ' + (m.role === 'user' ? 'me' : 'ai') + (m.error ? ' err' : '')}>
              {m.image && <img className="ay-photo" src={m.image.url} alt={tr('Foto')} />}
              {m.role === 'user' ? (m.text && <p>{m.text}</p>) : m.error ? <p>{m.text}</p> : <AyudaText text={m.text} tools={tools} />}
              {m.role === 'assistant' && m.id && (
                <div className="ay-rate">
                  {m.rating ? <small>{m.rating === 1 ? tr('Gracias') : tr('Gracias: Jose lo va a revisar')}</small> : <>
                    <button type="button" aria-label={tr('Me sirvió')} title={tr('Me sirvió')} onClick={() => rated(i, 1)}>👍</button>
                    <button type="button" aria-label={tr('Está mal')} title={tr('Está mal')} onClick={() => rated(i, -1)}>👎</button>
                  </>}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="ay-msg ai ay-wait"><span /><span /><span /></div>}
        </div>
        <div className="ay-foot">
          {photo && <div className="ay-pending"><img src={photo.url} alt="" /><span>{tr('Foto lista')}</span><button type="button" className="lnk" onClick={() => setPhoto(undefined)}>✕</button></div>}
          <div className="ay-row">
            <button type="button" className="btn ay-cam" aria-label={tr('Mandar una foto')} title={tr('Mandar una foto')} onClick={() => fileRef.current?.click()}>📷</button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void takeFile(e.target.files?.[0]); e.target.value = '' }} />
            <textarea rows={1} value={text} placeholder={tr('Escribe tu pregunta…')} aria-label={tr('Escribe tu pregunta…')} maxLength={2000}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} />
            <button type="button" className="btn primary ay-send" disabled={busy || (!text.trim() && !photo)} aria-label={tr('Mandar')} onClick={() => void send()}>➤</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** inside the stop window: "what happened?" → the code that fits, with a button that picks it (the person confirms) */
export function AyudaParo({ room, line, onCode }: { room: string; line?: string; onCode: (reason: string) => void }) {
  const [open, setOpen] = useState(false)
  const [what, setWhat] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<{ text: string; error?: boolean } | null>(null)
  if (!open) return <button type="button" className="btn soft sm ay-parobtn" onClick={() => setOpen(true)}>🤖 {tr('¿No sabes qué código? Pregúntale a la Ayuda')}</button>
  const go = async () => {
    if (!what.trim() || busy) return
    setBusy(true); setAnswer(null)
    const q = tr('Paro en {0}{1}. Lo que pasó: {2}. ¿Qué reason code pongo?', room, line ? ' · ' + line : '', what.trim())
    const r = await ask([{ role: 'user', text: q }], { tab: 'paro', room }, 'paro')
    setBusy(false)
    setAnswer('error' in r ? { text: r.error, error: true } : { text: r.text })
  }
  return (
    <div className="ay-paro">
      <label className="rf"><span className="lab">🤖 {tr('¿Qué pasó? Cuéntalo con tus palabras')}</span>
        <textarea rows={2} value={what} autoFocus placeholder={tr('Se atoró el plástico en la selladora')} onChange={(e) => setWhat(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void go() } }} />
      </label>
      <button type="button" className="btn sm" disabled={busy || !what.trim()} onClick={() => void go()}>{busy ? tr('Pensando…') : tr('Preguntar')}</button>
      {answer && (answer.error ? <p className="red">{answer.text}</p> : <AyudaText text={answer.text} tools={{ canGo: () => false, onGo: () => {}, onCode: (r) => onCode(r) }} />)}
    </div>
  )
}
