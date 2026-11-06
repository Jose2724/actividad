import { Fragment, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { CFG, DEPTS, deptStop, deptToday, fmtN, holdsOpen, lineLabel, openRun, openStop, SETUP, shiftGoalOf, stopsWaiting, turnOf, type Dept, type State } from './store'
import { DEPT_LOOK, FREEZER_LOOK, deptVars, lookVars } from './look'
import { HoldList } from './Holds'
import { LangSwitch, QrLink } from './App'
import { WhatIs } from './Numbers'
import { lang, tr } from './i18n'
import { trx } from './trx'
import { BUILD, reloadHeld } from './update'
import { saveTheme, themePick, type ThemePick } from './theme'

/**
 * The frame of the redesign (2026-11-05, see rd.ts): the app in sections, each with its own tabs. The tab ids are the
 * app's own (App.tsx), so every link that already led somewhere (a number to the Reporte, a lot to Avance, an order to
 * Flujo) leads to the same place in its section.
 */
export type RdTab = 'act' | 'pt' | 'wo' | 'po' | 'prod' | 'goals' | 'av' | 'lt' | 'pal' | 'hold' | 'fl' | 'home' | 'kpi' | 'wt' | 'dash' | 'mini' | 'pplh' | 'rep' | 'msg' | 'set'
export type RdSec = 'planta' | 'ind' | 'plan' | 'tra' | 'rep' | 'msg' | 'set'
export const RD_TABS: RdTab[] = ['act', 'pt', 'wo', 'po', 'prod', 'goals', 'av', 'lt', 'pal', 'hold', 'fl', 'home', 'kpi', 'wt', 'dash', 'mini', 'pplh', 'rep', 'msg', 'set']
const SEC_TABS: Record<RdSec, RdTab[]> = {
  planta: ['act'],
  ind: ['home', 'kpi', 'wt', 'dash', 'mini', 'pplh'],
  plan: ['pt', 'wo', 'po', 'prod', 'goals'],
  tra: ['av', 'lt', 'pal', 'hold', 'fl'],
  rep: ['rep'],
  msg: ['msg'],
  set: ['set'],
}
export const secOf = (t: RdTab): RdSec => (Object.keys(SEC_TABS) as RdSec[]).find((k) => SEC_TABS[k].includes(t)) ?? 'planta'
export const tabsOf = (sec: RdSec, sees: (t: RdTab) => boolean) => SEC_TABS[sec].filter(sees)
const SEC_ICON: Record<RdSec, string> = { planta: '🏭', ind: '📊', plan: '📅', tra: '🔎', rep: '📄', msg: '💬', set: '⚙' }
export const secLabel = (sec: RdSec, op: boolean) => (sec === 'planta' ? (op ? tr('Mi cuarto') : tr('Planta')) : sec === 'ind' ? tr('Indicadores') : sec === 'plan' ? tr('Planeación') : sec === 'tra' ? tr('Trazabilidad') : sec === 'rep' ? tr('Reportes') : sec === 'msg' ? tr('Mensajes') : tr('Ajustes'))
export const tabLabel = (t: RdTab) => ({
  act: tr('En vivo'), pt: tr('Programa del día'), wo: tr('Pedidos de producción'), po: tr('Pedidos con PO'), prod: tr('Productos'), goals: tr('Metas'),
  av: tr('Avance'), lt: tr('Lotes'), pal: tr('Pallets y bins'), hold: tr('On hold'), fl: tr('Flujo'),
  home: tr('Resumen'), kpi: tr('KPI diario'), wt: tr('Pesos'), dash: 'Dashboard', mini: tr('Mini KPI'), pplh: 'PPLH',
  rep: tr('Reportes'), msg: tr('Mensajes'), set: tr('Ajustes'),
})[t]

/** whether the screen is narrow enough for the bar at the bottom (the same width as the CSS) */
function useNarrow() {
  const q = '(max-width: 1023px)'
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const m = matchMedia(q), on = () => setNarrow(m.matches)
    m.addEventListener('change', on); return () => m.removeEventListener('change', on)
  }, [])
  return narrow
}

/**
 * the sections: a rail on the left on wide screens, a bar at the bottom on phones and tablets standing up (CSS). The
 * bar holds four and "Más", which opens the rest (and Freezer) from below
 */
export function RdNav({ secs, on, op, badge, onPick, freezer }: { secs: RdSec[]; on: RdSec; op: boolean; badge: Partial<Record<RdSec, number>>; onPick: (s: RdSec) => void; freezer?: string }) {
  const narrow = useNarrow()
  const [more, setMore] = useState(false)
  const all = secs.length + (freezer ? 1 : 0)
  const cut = narrow && all > 5
  const shown = cut ? secs.slice(0, 4) : secs, rest = cut ? secs.slice(4) : []
  const item = (k: RdSec, extra = '') => (
    <button key={k} type="button" className={'rd-navi' + (on === k ? ' on' : '') + extra} aria-current={on === k ? 'page' : undefined} onClick={() => { setMore(false); onPick(k) }}>
      <i aria-hidden="true">{SEC_ICON[k]}</i><span>{secLabel(k, op)}</span>{(badge[k] ?? 0) > 0 && <b className="rd-badge">{badge[k]}</b>}
    </button>
  )
  return (
    <nav className={'rd-nav' + (secs.length <= 4 ? ' few' : '')} aria-label={tr('Secciones')}>
      {shown.map((k) => item(k))}
      {cut && <button type="button" className={'rd-navi' + (rest.includes(on) ? ' on' : '')} aria-haspopup="dialog" onClick={() => setMore(true)}><i aria-hidden="true">☰</i><span>{tr('Más')}</span></button>}
      {!cut && freezer && <a className="rd-navi rd-fz" href={freezer}><i aria-hidden="true">🧊</i><span>{tr('Freezer')} ↗</span></a>}
      {more && (
        <div className="veil rd-menu-veil" onClick={() => setMore(false)}>
          <div className="rd-menu" role="dialog" aria-modal="true" aria-label={tr('Más')} onClick={(e) => e.stopPropagation()}>
            <div className="rd-menu-who"><div><b>{tr('Más')}</b></div><button type="button" className="rd-x" aria-label={tr('Cerrar')} onClick={() => setMore(false)}>✕</button></div>
            {rest.map((k) => <button key={k} type="button" className="rd-menu-it" onClick={() => { setMore(false); onPick(k) }}><i aria-hidden="true">{SEC_ICON[k]}</i><span>{secLabel(k, op)}</span>{(badge[k] ?? 0) > 0 && <b className="rd-badge">{badge[k]}</b>}</button>)}
            {freezer && <a className="rd-menu-it" href={freezer}><i aria-hidden="true">🧊</i><span>{tr('Freezer')} ↗</span></a>}
          </div>
        </div>
      )}
    </nav>
  )
}

/** a section's own tabs, in the style of the attendance window (underline and a count) */
export function RdTabs({ tabs, on, onPick, counts }: { tabs: RdTab[]; on: RdTab; onPick: (t: RdTab) => void; counts?: Partial<Record<RdTab, number>> }) {
  useEffect(() => { document.querySelector('.rd-tabs .on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [on])
  if (tabs.length < 2) return null
  return (
    <div className="rd-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t} type="button" role="tab" aria-selected={on === t} className={'rd-tab' + (on === t ? ' on' : '') + ((counts?.[t] ?? 0) > 0 && t === 'hold' ? ' hot' : '')} onClick={() => onPick(t)}>
          {tabLabel(t)}{(counts?.[t] ?? 0) > 0 && <span className="n">{counts?.[t]}</span>}
        </button>
      ))}
    </div>
  )
}

/**
 * The warnings in one strip under the top bar (the redesign): the first one in full, the rest one tap away. The red
 * ones (records not sent, storage full) are never hidden: each warning keeps its own words and its own button
 */
export function StatusStrip({ bars }: { bars: ReactNode[] }) {
  const list = bars.filter(Boolean)
  const [all, setAll] = useState(false)
  if (!list.length) return null
  const shown = all ? list : list.slice(0, 1)
  return (
    <div className="rd-strip" role="status">
      {shown.map((b, i) => <Fragment key={i}>{b}</Fragment>)}
      {list.length > 1 && <button type="button" className="rd-strip-more" onClick={() => setAll((x) => !x)}>{all ? tr('Ver menos') : list.length === 2 ? tr('+1 aviso') : tr('+{0} avisos', list.length - 1)}</button>}
    </div>
  )
}

/** the person's menu (the redesign): language, what the numbers mean, the QR, this device and Salir, under one's name */
export function PersonMenu({ name, role, mgr, onDevice, onLeave, leaveWord }: { name: string; role: string; mgr: boolean; onDevice: () => void; onLeave: () => void; leaveWord: string }) {
  const [open, setOpen] = useState(false)
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '·'
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [open])
  return (
    <>
      <button type="button" className="rd-me" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={tr('Menú de {0}', name)}>
        <span className="rd-av" aria-hidden="true">{initials}</span><span className="rd-mename"><b>{name}</b><small>{role}</small></span><span className="rd-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="veil rd-menu-veil" onClick={() => setOpen(false)}>
          <div className="rd-menu" role="dialog" aria-modal="true" aria-label={tr('Menú de {0}', name)} onClick={(e) => e.stopPropagation()}>
            <div className="rd-menu-who"><span className="rd-av big" aria-hidden="true">{initials}</span><div><b>{name}</b><small>{role}</small></div><button type="button" className="rd-x" aria-label={tr('Cerrar')} onClick={() => setOpen(false)}>✕</button></div>
            <div className="rd-menu-it"><i aria-hidden="true">🌐</i><span>{tr('Idioma')}</span><LangSwitch /></div>
            <div className="rd-menu-it"><i aria-hidden="true">🌓</i><span>{tr('Tema')}</span><ThemeSwitch /></div>
            <div className="rd-menu-it"><i aria-hidden="true">ⓘ</i><WhatIs label={tr('Qué significa cada número')} /></div>
            {mgr && <div className="rd-menu-it"><i aria-hidden="true">▦</i><QrLink label={tr('QR para abrir la app')} /></div>}
            <button type="button" className="rd-menu-it" onClick={() => { setOpen(false); onDevice() }}><i aria-hidden="true">📱</i><span>{tr('Este aparato')}</span><em>{tr('versión {0}', BUILD.slice(0, 7))}</em></button>
            <button type="button" className="btn rd-menu-out" onClick={() => { setOpen(false); onLeave() }}>{leaveWord}</button>
          </div>
        </div>
      )}
    </>
  )
}

/** what a line is doing right now, in the colours that say a state (green working, red stopped, amber Set up, grey free) */
function lineState(s: State, d: Dept, id: string): 'run' | 'stop' | 'su' | 'free' {
  const st = openStop(s, d, id)
  if (st) return st.reason === SETUP ? 'su' : 'stop'
  return openRun(s, id) ? 'run' : 'free'
}

/**
 * Toda la planta (the redesign): one card per room with its shift against its goal and each line in the colour of its
 * state, Freezer at the end, and on the side what needs looking at now. A card opens its room
 */
export function PlantOverview({ s, now, date, onRoom, freezer }: { s: State; now: number; date: string; onRoom: (d: Dept) => void; freezer?: string }) {
  const alerts: { k: string; level: 'r' | 'w' | 'i'; title: ReactNode; sub: ReactNode; d: Dept }[] = []
  for (const d of DEPTS) {
    const ds = deptStop(s, d)
    if (ds) alerts.push({ k: 'ds' + d, level: 'r', title: tr('Todo {0} parado', d), sub: trx('{0} · desde {1}', ds.reason, new Date(ds.startedAt).toLocaleTimeString(lang === 'en' ? 'en-US' : 'es-US', { hour: 'numeric', minute: '2-digit' })), d })
    for (const l of s.lines.filter((x) => x.dept === d)) {
      const st = openStop(s, d, l.id)
      if (st && st.lineId === l.id && st.reason !== SETUP && openRun(s, l.id)) alerts.push({ k: 'st' + l.id, level: 'r', title: tr('{0} · {1} parada {2} min', d, lineLabel(l.name), Math.max(1, Math.round((now - st.startedAt) / 60_000))), sub: st.reason, d })
    }
    const w = stopsWaiting(s, d).length
    if (w) alerts.push({ k: 'sw' + d, level: 'w', title: w === 1 ? tr('1 paro sin razón en {0}', d) : tr('{0} paros sin razón en {1}', w, d), sub: tr('esperan que un manager ponga la razón'), d })
    const h = holdsOpen(s, d).length
    if (h) alerts.push({ k: 'h' + d, level: 'i', title: h === 1 ? tr('1 unidad en On hold en {0}', d) : tr('{0} unidades en On hold en {1}', h, d), sub: tr('en revisión'), d })
  }
  return (
    <div className="rd-plant">
      <div className="rd-rooms">
        {DEPTS.map((d) => {
          const lines = s.lines.filter((l) => l.dept === d)
          const states = lines.map((l) => ({ l, st: lineState(s, d, l.id) }))
          const run = states.filter((x) => x.st === 'run').length, stop = states.filter((x) => x.st === 'stop').length
          const goal = shiftGoalOf(s, d, turnOf(s, date, now, d).shift).total, td = deptToday(s, d, date, now)
          const pct = goal ? Math.round((td.shiftQty / goal) * 100) : null
          return (
            <button key={d} type="button" className="rd-room" style={deptVars(d)} onClick={() => onRoom(d)}>
              <span className="rd-room-t"><b><i aria-hidden="true">{DEPT_LOOK[d].emoji}</i>{d}</b>
                {deptStop(s, d) ? <span className="rd-pill stop">{tr('Parado')}</span> : stop ? <span className="rd-pill stop">{stop === 1 ? tr('1 parada') : tr('{0} paradas', stop)}</span> : run ? <span className="rd-pill run">{run === 1 ? tr('1 trabajando') : tr('{0} trabajando', run)}</span> : <span className="rd-pill free">{tr('Sin trabajar')}</span>}
              </span>
              <span className="rd-bar"><i style={{ width: Math.min(100, pct ?? 0) + '%' }} /></span>
              <span className="rd-room-n"><span><b>{fmtN(td.shiftQty)}</b>{goal ? ' / ' + fmtN(goal) : ''} {td.unitLabel}</span><span>{pct != null ? pct + '%' : tr('sin meta')}</span></span>
              <span className="rd-chips">{states.map(({ l, st }) => <span key={l.id} className={'rd-chip ' + st}>{lineLabel(l.name)}</span>)}{!lines.length && <span className="rd-chip free">{tr('sin {0}', CFG[d].lineWord.toLowerCase())}</span>}</span>
            </button>
          )
        })}
        {freezer && (
          <a className="rd-room" style={lookVars(FREEZER_LOOK)} href={freezer}>
            <span className="rd-room-t"><b><i aria-hidden="true">🧊</i>Freezer</b><span className="rd-open">{tr('Abrir')} ↗</span></span>
            <span className="rd-room-n"><span>{tr('carritos, entregas y CCP-3')}</span></span>
          </a>
        )}
      </div>
      <aside className="rd-attn">
        <h3>{tr('Atención ahora')}{alerts.length > 0 && <span className="rd-pill stop">{alerts.length}</span>}</h3>
        {alerts.length ? alerts.map((a) => (
          <button key={a.k} type="button" className={'rd-alert ' + a.level} onClick={() => onRoom(a.d)}><b>{a.title}</b><span>{a.sub}</span></button>
        )) : <p className="rd-calm">✓ {tr('Todo en orden')}</p>}
      </aside>
    </div>
  )
}

/** every room's units on hold in one place (Trazabilidad › On hold) */
export function HoldsAll({ s }: { s: State }) {
  const rooms = DEPTS.filter((d) => holdsOpen(s, d).length)
  if (!rooms.length) return <p className="hint rd-empty">{tr('Nada en On hold.')}</p>
  return <div className="rd-stack">{rooms.map((d) => <section key={d} className="rd-holdroom" style={deptVars(d)}><h3><i aria-hidden="true">{DEPT_LOOK[d].emoji}</i> {d}</h3><HoldList s={s} dept={d} /></section>)}</div>
}

/** Claro, Oscuro or the device's own (theme.ts); the page opens again with it, as with the language */
function ThemeSwitch() {
  const [held, setHeld] = useState(false)
  const now = themePick()
  const pick = (t: ThemePick) => { if (t === now) return; if (reloadHeld()) { setHeld(true); return } saveTheme(t); location.reload() }
  const opts: { t: ThemePick; label: string }[] = [{ t: 'light', label: '☀ ' + tr('Claro') }, { t: 'dark', label: '🌙 ' + tr('Oscuro') }, { t: 'auto', label: tr('Auto') }]
  return (
    <span className="rd-theme" role="group" aria-label={tr('Tema')}>
      {opts.map((o) => <button key={o.t} type="button" className={now === o.t ? 'on' : ''} aria-pressed={now === o.t} title={o.t === 'auto' ? tr('Como el aparato') : undefined} onClick={() => pick(o.t)}>{o.label}</button>)}
      {held && <small className="err">{tr('La memoria del aparato está llena: cambia el tema después de hacer espacio.')}</small>}
    </span>
  )
}
