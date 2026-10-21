import { useRef, useState } from 'react'
import { attAdd, attBack, attDelete, attendanceOf, attExpectedOf, attOf, attRemove, DEPTS, fmtTime, setAttExpected, type AttEntry, type Dept, type State } from './store'
import { writesIn } from './powers'
import { useWho } from './App'
import { DEPT_LOOK, deptVars } from './look'
import { tr } from './i18n'

/**
 * A room's attendance on the floor (Santiago, 2026-10-20: "que cada supervisor registre las personas ... nombre o
 * números y según la cantidad muestre" expected, actual and % missing). The card says it at a glance; its window is
 * where the supervisor writes each person (a name or a number, Enter adds the next), takes one out who went to cover
 * another room or went home (the % is worked out again, and the person stays in the list, marked), or deletes one
 * written by mistake. The people expected are a fixed number per room and shift that the managers and the office
 * change here (store.ts, ATT_DEFAULT and setAttExpected).
 */
export const pctText = (x: number) => Math.round(x * 100) + '%'

export function AttendanceCard({ s, dept, date, shift, edit }: { s: State; dept: Dept; date: string; shift: 1 | 2; edit: boolean }) {
  const [open, setOpen] = useState(false)
  const r = attendanceOf(s, date, shift, [dept]).rows[0]
  return (
    <div className="att-card">
      <div className="att-line">
        <b>{tr('👥 Asistencia · Turno {0}', shift)}</b>
        <span className="att-n">{tr('{0} de {1}', r.actual, r.expected)}</span>
        <span className={'att-miss' + (r.pct >= 0.25 ? ' red' : r.miss ? ' amber' : ' ok')}>{r.miss ? tr('faltan {0} · {1}', r.miss, pctText(r.pct)) : r.over ? tr('✓ completos (+{0})', r.over) : tr('✓ completos')}</span>
        <button type="button" className={'btn sm ' + (edit ? 'soft' : '')} onClick={() => setOpen(true)}>{edit ? tr('Anotar personas') : tr('Ver personas')}</button>
      </div>
      <div className="att-bar"><i style={{ width: Math.min(100, r.expected ? Math.round((r.actual / r.expected) * 100) : 0) + '%' }} /></div>
      {open && <AttendanceDialog s={s} dept={dept} date={date} shift={shift} edit={edit} onClose={() => setOpen(false)} />}
    </div>
  )
}

function AttendanceDialog({ s, dept, date, shift: inCourse, edit, onClose }: { s: State; dept: Dept; date: string; shift: 1 | 2; edit: boolean; onClose: () => void }) {
  const who = useWho()
  const boss = !!who.admin || who.role === 'mgr' || who.role === 'office'
  const [shift, setShift] = useState<1 | 2>(inCourse)
  const [name, setName] = useState('')
  const [twice, setTwice] = useState('')
  const [out, setOut] = useState<{ id: string; why?: 'otro'; to?: Dept } | null>(null)
  const [said, setSaid] = useState('')
  const [editingN, setEditingN] = useState<string | null>(null)
  const box = useRef<HTMLInputElement>(null)
  const list = attOf(s, date, dept, shift), here = list.filter((x) => !x.gone), gone = list.filter((x) => !!x.gone)
  const r = attendanceOf(s, date, shift, [dept]).rows[0]
  const add = () => {
    const n = name.trim()
    if (!n) return
    if (!attAdd(date, dept, shift, n)) { setTwice(n); return }
    setName(''); setTwice(''); setSaid('')
    box.current?.focus()
  }
  const take = (x: AttEntry, why: 'otro' | 'casa', to: Dept | '' = '') => {
    const there = why === 'otro' && !!to && writesIn(who, to)
    attRemove(x.id, why, to, there)
    setOut(null)
    setSaid(why === 'casa' ? tr('{0} salió: se fue a su casa.', x.name) : there ? tr('{0} pasó a {1}: ya quedó anotado allá.', x.name, to) : tr('{0} pasó a {1}: avísale al supervisor de {1} para que lo anote.', x.name, to))
  }
  const goneText = (x: AttEntry) => (x.gone?.why === 'casa' ? tr('se fue a su casa') : tr('pasó a {0}', x.gone?.to || tr('otro cuarto'))) + ' · ' + fmtTime(x.gone?.at ?? 0)
  return (
    <div className="veil rc-veil" onClick={onClose}>
      <div className="dlg att-dlg" onClick={(e) => e.stopPropagation()} style={deptVars(dept)}>
        <h3>{tr('Asistencia · {0} {1}', DEPT_LOOK[dept].emoji, dept)}</h3>
        <div className="chips">{([1, 2] as const).map((k) => <button key={k} type="button" className={'chip' + (shift === k ? ' on' : '')} onClick={() => { setShift(k); setOut(null); setSaid('') }}>{tr('Turno {0}', k)}{k === inCourse ? ' ' + tr('(en curso)') : ''}</button>)}</div>
        <div className="att-sum">
          <div><label>{tr('Esperados')}</label>{editingN != null ? (
            <form className="att-exp" onSubmit={(e) => { e.preventDefault(); const n = Number(editingN); if (n >= 0) setAttExpected(dept, shift, n); setEditingN(null) }}>
              <input value={editingN} inputMode="numeric" autoFocus aria-label={tr('Esperados')} onChange={(e) => setEditingN(e.target.value.replace(/\D/g, ''))} /><button type="submit" className="btn sm primary">{tr('Guardar')}</button>
            </form>
          ) : <b>{r.expected}{boss && edit && <button type="button" className="lnk sm" onClick={() => setEditingN(String(attExpectedOf(s, dept, shift)))}>{tr('✎ Cambiar')}</button>}</b>}</div>
          <div><label>{tr('Vinieron')}</label><b>{r.actual}</b></div>
          <div className={r.miss ? 'miss' : 'ok'}><label>{tr('% Falta')}</label><b>{pctText(r.pct)}</b><small>{r.miss ? tr('faltan {0}', r.miss) : r.over ? tr('+{0} de más', r.over) : tr('✓ completos')}</small></div>
        </div>
        {edit && (
          <form className="att-add" onSubmit={(e) => { e.preventDefault(); add() }}>
            <input ref={box} value={name} maxLength={60} placeholder={tr('Nombre o número de la persona')} autoComplete="off" aria-label={tr('Nombre o número de la persona')} onChange={(e) => { setName(e.target.value); setTwice('') }} />
            <button type="submit" className="btn primary" disabled={!name.trim()}>{tr('+ Anotar')}</button>
          </form>
        )}
        {twice && <p className="hint amber">{tr('{0} ya está anotado en este turno.', twice)}</p>}
        {said && <p className="hint ok">{said}</p>}
        {!list.length ? <p className="hint">{tr('Nadie anotado todavía en este turno.')}</p> : (
          <ol className="att-list">
            {here.map((x) => (
              <li key={x.id}>
                <span className="att-name">{x.name}{x.from && <small> · {tr('viene de {0}', x.from)}</small>}</span>
                <small className="att-at">{fmtTime(x.at)}</small>
                {edit && out?.id !== x.id && <button type="button" className="btn xs" onClick={() => { setOut({ id: x.id }); setSaid('') }}>{tr('✕ Sacar')}</button>}
                {out?.id === x.id && (
                  <div className="att-out">
                    {!out.why ? (
                      <>
                        <span>{tr('¿Por qué sale {0}?', x.name)}</span>
                        <button type="button" className="btn sm soft" onClick={() => setOut({ id: x.id, why: 'otro' })}>{tr('Pasó a otro cuarto')}</button>
                        <button type="button" className="btn sm soft" onClick={() => take(x, 'casa')}>{tr('Se fue a su casa')}</button>
                        <button type="button" className="btn sm danger" onClick={() => { attDelete(x.id); setOut(null) }}>{tr('Anotado por error')}</button>
                        <button type="button" className="btn sm" onClick={() => setOut(null)}>{tr('Cancelar')}</button>
                      </>
                    ) : (
                      <>
                        <span>{tr('¿A qué cuarto pasó?')}</span>
                        {DEPTS.filter((d) => d !== dept).map((d) => <button key={d} type="button" className="btn sm soft" onClick={() => take(x, 'otro', d)}>{DEPT_LOOK[d].emoji} {d}</button>)}
                        <button type="button" className="btn sm" onClick={() => setOut({ id: x.id })}>{tr('← Atrás')}</button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        {gone.length > 0 && (
          <>
            <h4>{tr('Salieron · no cuentan')}</h4>
            <ul className="att-gone">{gone.map((x) => <li key={x.id}><s>{x.name}</s> <small>{goneText(x)}</small>{edit && <button type="button" className="lnk sm" onClick={() => attBack(x.id)}>{tr('Deshacer')}</button>}</li>)}</ul>
          </>
        )}
        <div className="dbtns"><button type="button" className="btn primary" onClick={onClose}>{tr('Listo')}</button></div>
      </div>
    </div>
  )
}
