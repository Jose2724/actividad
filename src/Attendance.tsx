import { useRef, useState } from 'react'
import { attAdd, attBack, attDelete, attendanceOf, attExpectedOf, attLineText, attMoveLine, attOf, attRemove, attSetTemp, byLineName, DEPTS, fmtTime, setAttExpected, type AttEntry, type Dept, type State } from './store'
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
/** a room's lines, in order (the removed ones out) */
export const roomLines = (s: State, dept: Dept) => s.lines.filter((l) => l.dept === dept && !l.deleted).sort(byLineName)

export function AttendanceCard({ s, dept, date, shift, edit }: { s: State; dept: Dept; date: string; shift: 1 | 2; edit: boolean }) {
  const [open, setOpen] = useState(false)
  const r = attendanceOf(s, date, shift, [dept]).rows[0]
  return (
    <div className="att-card">
      <div className="att-line">
        <b>{tr('👥 Asistencia · Turno {0}', shift)}</b>
        <span className="att-n">{tr('{0} de {1}', r.actual, r.expected)}</span>
        <span className={'att-miss' + (r.pct >= 0.25 ? ' red' : r.miss ? ' amber' : ' ok')}>{r.miss ? (r.miss === 1 ? tr('falta 1 persona · {0}', pctText(r.pct)) : tr('faltan {0} personas · {1}', r.miss, pctText(r.pct))) : r.over ? tr('✓ completos (+{0})', r.over) : tr('✓ completos')}</span>
        <button type="button" className={'btn sm ' + (edit ? 'soft' : '')} onClick={() => setOpen(true)}>{edit ? tr('Anotar personas') : tr('Ver personas')}</button>
      </div>
      <div className="att-bar"><i style={{ width: Math.min(100, r.expected ? Math.round((r.actual / r.expected) * 100) : 0) + '%' }} /></div>
      {open && <AttendanceDialog s={s} dept={dept} date={date} shift={shift} edit={edit} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** `note` = why it opened by itself (the start of a code or a Set up, with the attendance still to write: 2026-10-27) */
export function AttendanceDialog({ s, dept, date, shift: inCourse, edit, note = '', onClose }: { s: State; dept: Dept; date: string; shift: 1 | 2; edit: boolean; note?: string; onClose: () => void }) {
  const who = useWho()
  const boss = !!who.admin || who.role === 'mgr' || who.role === 'office'
  const [shift, setShift] = useState<1 | 2>(inCourse)
  const [name, setName] = useState('')
  const [twice, setTwice] = useState('')
  // the person being acted on: taken out (home, by mistake) or moved (to another line here, or another room and its line)
  const [out, setOut] = useState<{ id: string; mode: 'out' | 'move'; to?: Dept } | null>(null)
  const lines = roomLines(s, dept)
  const [addLine, setAddLine] = useState('')
  // a temp (agency) worker (2026-10-22, the Daily KPI: "who shows up ... especially TEMPS"): kept for the next one written
  const [addTemp, setAddTemp] = useState(false)
  const [said, setSaid] = useState('')
  const [editingN, setEditingN] = useState<string | null>(null)
  const box = useRef<HTMLInputElement>(null)
  const list = attOf(s, date, dept, shift), here = list.filter((x) => !x.gone), gone = list.filter((x) => !!x.gone)
  const r = attendanceOf(s, date, shift, [dept]).rows[0]
  const add = () => {
    const n = name.trim()
    if (!n) return
    if (!attAdd(date, dept, shift, n, '', lines.some((l) => l.id === addLine) ? addLine : '', addTemp)) { setTwice(n); return }
    setName(''); setTwice(''); setSaid('')
    box.current?.focus()
  }
  // gone to another room: they show up there by themselves ("viene de"), on the line chosen; nobody there has to write them
  const take = (x: AttEntry, why: 'otro' | 'casa', to: Dept | '' = '', toLine = '') => {
    attRemove(x.id, why, to, false, toLine)
    setOut(null)
    setSaid(why === 'casa' ? tr('{0} salió: se fue a su casa.', x.name) : tr('{0} pasó a {1}: ya aparece en la lista de {2}.', x.name, to + (toLine ? ' · ' + attLineText(s, toLine) : ''), to))
  }
  const move = (x: AttEntry, line: string) => {
    attMoveLine(x.id, line)
    setOut(null)
    setSaid(tr('{0} pasó a {1}.', x.name, attLineText(s, line) || tr('sin línea')))
  }
  const goneText = (x: AttEntry) => (x.gone?.why === 'casa' ? tr('se fue a su casa') : tr('pasó a {0}', (x.gone?.to || tr('otro cuarto')) + (x.gone?.line ? ' · ' + attLineText(s, x.gone.line) : ''))) + ' · ' + fmtTime(x.gone?.at ?? 0)
  // the people here, by line (the room's lines in order, then those on no line in particular)
  const groups = [...lines.map((l) => ({ id: l.id, name: attLineText(s, l.id), people: here.filter((x) => x.line === l.id) })), { id: '', name: tr('Sin línea'), people: here.filter((x) => !x.line || !lines.some((l) => l.id === x.line)) }].filter((g) => g.people.length > 0)
  const byLine = lines.length > 0 && here.some((x) => !!x.line)
  return (
    <div className="veil rc-veil" onClick={onClose}>
      <div className="dlg att-dlg" onClick={(e) => e.stopPropagation()} style={deptVars(dept)}>
        <h3>{tr('Asistencia · {0} {1}', DEPT_LOOK[dept].emoji, dept)}</h3>
        {note && <p className="hint red">{note}</p>}
        <div className="chips">{([1, 2] as const).map((k) => <button key={k} type="button" className={'chip' + (shift === k ? ' on' : '')} onClick={() => { setShift(k); setOut(null); setSaid('') }}>{tr('Turno {0}', k)}{k === inCourse ? ' ' + tr('(en curso)') : ''}</button>)}</div>
        <div className="att-sum">
          <div><label>{tr('Esperados')}</label>{editingN != null ? (
            <form className="att-exp" onSubmit={(e) => { e.preventDefault(); const n = Number(editingN); if (n >= 0) setAttExpected(dept, shift, n); setEditingN(null) }}>
              <input value={editingN} inputMode="numeric" autoFocus aria-label={tr('Esperados')} onChange={(e) => setEditingN(e.target.value.replace(/\D/g, ''))} /><button type="submit" className="btn sm primary">{tr('Guardar')}</button>
            </form>
          ) : <b>{r.expected}{boss && edit && <button type="button" className="lnk sm" onClick={() => setEditingN(String(attExpectedOf(s, dept, shift)))}>{tr('✎ Cambiar')}</button>}</b>}</div>
          <div><label>{tr('Vinieron')}</label><b>{r.actual}</b></div>
          <div className={r.miss ? 'miss' : 'ok'}><label>{tr('% Falta')}</label><b>{pctText(r.pct)}</b><small>{r.miss ? (r.miss === 1 ? tr('falta 1 persona') : tr('faltan {0} personas', r.miss)) : r.over ? tr('+{0} de más', r.over) : tr('✓ completos')}</small></div>
        </div>
        {edit && (
          <>
          {lines.length > 0 && <div className="chips att-lines"><span className="att-lab">{tr('Línea:')}</span>{[{ id: '', name: tr('Sin línea') }, ...lines.map((l) => ({ id: l.id, name: attLineText(s, l.id) }))].map((l) => <button key={l.id || '-'} type="button" className={'chip' + (addLine === l.id ? ' on' : '')} onClick={() => { setAddLine(l.id); box.current?.focus() }}>{l.name}</button>)}</div>}
          <div className="chips att-lines"><span className="att-lab">{tr('Es:')}</span><button type="button" className={'chip' + (!addTemp ? ' on' : '')} onClick={() => { setAddTemp(false); box.current?.focus() }}>{tr('De la compañía')}</button><button type="button" className={'chip' + (addTemp ? ' on' : '')} onClick={() => { setAddTemp(true); box.current?.focus() }}>{tr('Temporal (agencia)')}</button></div>
          <form className="att-add" onSubmit={(e) => { e.preventDefault(); add() }}>
            <input ref={box} value={name} maxLength={60} placeholder={tr('Nombre o número de la persona')} autoComplete="off" aria-label={tr('Nombre o número de la persona')} onChange={(e) => { setName(e.target.value); setTwice('') }} />
            <button type="submit" className="btn primary" disabled={!name.trim()}>{tr('+ Anotar')}</button>
          </form>
          </>
        )}
        {twice && <p className="hint amber">{tr('{0} ya está anotado en este turno.', twice)}</p>}
        {said && <p className="hint ok">{said}</p>}
        {!list.length ? <p className="hint">{tr('Nadie anotado todavía en este turno.')}</p> : groups.map((g) => (
          <div key={g.id || '-'} className="att-group">
            {byLine && <h4 className="att-gh">{g.name} <small>· {g.people.length}</small></h4>}
            <ol className="att-list">
              {g.people.map((x) => (
                <li key={x.id}>
                  <span className="att-name">{x.name}{x.temp && <small className="att-temp"> {tr('temporal')}</small>}{x.from && <small> · {tr('viene de {0}', x.from)}</small>}{x.moves.length > 0 && <small> · {tr('antes en {0}', attLineText(s, x.moves[x.moves.length - 1].from) || tr('sin línea'))}</small>}</span>
                  <small className="att-at">{fmtTime(x.at)}</small>
                  {edit && out?.id !== x.id && <>
                    <button type="button" className="btn xs soft" onClick={() => { setOut({ id: x.id, mode: 'move' }); setSaid('') }}>{tr('⇄ Trasladar')}</button>
                    <button type="button" className="btn xs" onClick={() => { setOut({ id: x.id, mode: 'out' }); setSaid('') }}>{tr('✕ Sacar')}</button>
                    <button type="button" className="lnk sm" onClick={() => attSetTemp(x.id, !x.temp)}>{x.temp ? tr('No es temporal') : tr('Es temporal')}</button>
                  </>}
                  {out?.id === x.id && out.mode === 'out' && (
                    <div className="att-out">
                      <span>{tr('¿Por qué sale {0}?', x.name)}</span>
                      <button type="button" className="btn sm soft" onClick={() => take(x, 'casa')}>{tr('Se fue a su casa')}</button>
                      {!x.via && <button type="button" className="btn sm danger" onClick={() => { attDelete(x.id); setOut(null) }}>{tr('Anotado por error')}</button>}
                      <button type="button" className="btn sm" onClick={() => setOut(null)}>{tr('Cancelar')}</button>
                      {x.via && <small className="hint">{tr('Si vino por error, deshazlo en {0}, de donde salió.', x.from)}</small>}
                    </div>
                  )}
                  {out?.id === x.id && out.mode === 'move' && !out.to && (
                    <div className="att-out">
                      <span>{tr('¿A dónde pasa {0}?', x.name)}</span>
                      {lines.length > 0 && <div className="att-row2"><small>{tr('Otra línea de {0}:', dept)}</small>{[...lines.map((l) => l.id), ''].filter((l) => l !== (lines.some((y) => y.id === x.line) ? x.line : '')).map((l) => <button key={l || '-'} type="button" className="btn sm soft" onClick={() => move(x, l)}>{attLineText(s, l) || tr('Sin línea')}</button>)}</div>}
                      <div className="att-row2"><small>{tr('Otro cuarto:')}</small>{DEPTS.filter((d) => d !== dept).map((d) => <button key={d} type="button" className="btn sm soft" onClick={() => (roomLines(s, d).length ? setOut({ id: x.id, mode: 'move', to: d }) : take(x, 'otro', d))}>{DEPT_LOOK[d].emoji} {d}</button>)}</div>
                      <button type="button" className="btn sm" onClick={() => setOut(null)}>{tr('Cancelar')}</button>
                    </div>
                  )}
                  {out?.id === x.id && out.mode === 'move' && out.to && (
                    <div className="att-out">
                      <span>{tr('¿A qué línea de {0} pasa {1}?', out.to, x.name)}</span>
                      {roomLines(s, out.to).map((l) => <button key={l.id} type="button" className="btn sm soft" onClick={() => take(x, 'otro', out.to, l.id)}>{attLineText(s, l.id)}</button>)}
                      <button type="button" className="btn sm soft" onClick={() => take(x, 'otro', out.to)}>{tr('Sin línea / no sé')}</button>
                      <button type="button" className="btn sm" onClick={() => setOut({ id: x.id, mode: 'move' })}>{tr('← Atrás')}</button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ))}
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
