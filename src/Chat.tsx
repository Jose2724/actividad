import { Fragment, useEffect, useRef, useState } from 'react'
import { chatOf, chatUnread, dayOf, DEPTS, fmtTime, sendChat, writesRoom, type Dept, type State } from './store'
import { DEPT_LOOK, deptVars } from './look'
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
const seenOf = (side: string, d: Dept) => { try { return Number(localStorage.getItem(SEEN + side + ':' + d)) || 0 } catch { return 0 } }
// the buttons can be put away and brought back (Jose, 2026-10-28): remembered on the device
const HIDDEN = 'act_chat_hidden'
const markSeen = (side: string, d: Dept, at: number) => { try { localStorage.setItem(SEEN + side + ':' + d, String(at)) } catch { /* private window: counted again next time */ } }

export function Chat({ s, home }: { s: State; home: Dept }) {
  const who = useWho()
  const side = who.role === 'op' ? 'room' : 'office'
  const rooms: Dept[] = side === 'room' ? [home] : DEPTS
  const [open, setOpen] = useState<Dept | null>(null)
  const [hidden, setHiddenState] = useState(() => { try { return localStorage.getItem(HIDDEN) === '1' } catch { return false } })
  const setHidden = (h: boolean) => { setHiddenState(h); if (h) setOpen(null); try { localStorage.setItem(HIDDEN, h ? '1' : '') } catch { /* no */ } }
  const [, bump] = useState(0)
  const unread = Object.fromEntries(rooms.map((d) => [d, chatUnread(s, d, side, seenOf(side, d))])) as Record<Dept, number>
  // the conversation that is open is read as it is looked at
  const last = open ? (chatOf(s, open).at(-1)?.at ?? 0) : 0
  useEffect(() => { if (open && last > seenOf(side, open)) { markSeen(side, open, last); bump((n) => n + 1) } }, [open, last])
  // a message that just came from the other side: a short buzz on devices that can
  const total = rooms.reduce((t, d) => t + unread[d], 0)
  const prev = useRef(total)
  useEffect(() => { if (total > prev.current) { try { (navigator as Navigator & { vibrate?: (ms: number) => boolean }).vibrate?.(150) } catch { /* no */ } } prev.current = total }, [total])
  if (hidden) {
    return (
      <button type="button" className="chat-peek" onClick={() => setHidden(false)} aria-label={tr('Mostrar los mensajes')} title={tr('Mostrar los mensajes')}>
        ‹{total > 0 && <i className="chat-badge">{total}</i>}
      </button>
    )
  }
  return (
    <>
      <div className={'chat-fabs' + (side === 'office' ? ' many' : '')}>
        <button type="button" className="chat-hide" onClick={() => setHidden(true)} aria-label={tr('Ocultar los mensajes')} title={tr('Ocultar los mensajes')}>×</button>
        {rooms.map((d) => (
          <button key={d} type="button" className={'chat-fab' + (open === d ? ' on' : '')} style={deptVars(d)} aria-label={tr('Mensajes · {0}', d)} title={tr('Mensajes · {0}', d)} onClick={() => setOpen(open === d ? null : d)}>
            <span className="chat-fab-ico" aria-hidden="true">{side === 'room' ? '💬' : DEPT_LOOK[d].emoji}</span>
            {side === 'office' && <small className="chat-fab-name">{d}</small>}
            {unread[d] > 0 && <i className="chat-badge">{unread[d]}</i>}
          </button>
        ))}
      </div>
      {open && <ChatWindow s={s} dept={open} side={side} onClose={() => setOpen(null)} />}
    </>
  )
}

function ChatWindow({ s, dept, side, onClose }: { s: State; dept: Dept; side: 'room' | 'office'; onClose: () => void }) {
  const who = useWho()
  const canWrite = who.role !== 'viewer' && writesRoom(dept)
  const list = chatOf(s, dept)
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [list.length, dept])
  const send = () => { if (sendChat(dept, text)) setText('') }
  return (
    <div className={'chat-win' + (side === 'office' ? ' office' : '')} style={deptVars(dept)} role="dialog" aria-label={tr('Mensajes · {0}', dept)}>
      <div className="chat-head">
        <span className="chat-avatar" aria-hidden="true">{side === 'room' ? '🏢' : DEPT_LOOK[dept].emoji}</span>
        <div><b>{side === 'room' ? tr('Oficina') : dept}</b><small>{side === 'room' ? tr('Mensajes con la oficina y los managers') : tr('Mensajes con {0}', dept)}</small></div>
        <button type="button" className="chat-x" onClick={onClose} aria-label={tr('Cerrar')}>×</button>
      </div>
      <div className="chat-body">
        {!list.length && <p className="chat-empty">{side === 'room' ? tr('Escribe aquí a la oficina. Lo ven en su pantalla y te contestan aquí mismo.') : tr('Todavía no hay mensajes con {0}. Escribe abajo: lo ven en las tablets de ese cuarto.', dept)}</p>}
        {list.map((x, i) => {
          const day = dayOf(x.at), before = i ? dayOf(list[i - 1].at) : ''
          return (
            <Fragment key={x.id}>
              {day !== before && <div className="chat-day">{longDate(day)}</div>}
              <div className={'chat-msg ' + (x.side === side ? 'mine' : 'theirs')}>
                <div className="chat-bubble">{x.text}</div>
                <small>{x.by} · {fmtTime(x.at)}</small>
              </div>
            </Fragment>
          )
        })}
        <div ref={end} />
      </div>
      {canWrite
        ? <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send() }}><input value={text} maxLength={600} placeholder={tr('Escribe un mensaje…')} aria-label={tr('Escribe un mensaje…')} autoComplete="off" onChange={(e) => setText(e.target.value)} /><button type="submit" className="chat-send" disabled={!text.trim()} aria-label={tr('Mandar')}>➤</button></form>
        : <p className="chat-ro">{tr('Solo ver: aquí no se escribe.')}</p>}
    </div>
  )
}
