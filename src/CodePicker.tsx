import { useState } from 'react'
import { catOf, codeLabel, codeReason, FAMILY_SHOWN, OTHER_CODE, REASON_CATS, REASON_CODES, reasonCodeOf, SETUP_CODE, type ReasonCat, type ReasonCode } from './reasons'
import { tr } from './i18n'

/**
 * Choosing the Reason Code of a stop (Jose, 2026-10-20, see reasons.ts). Thirty-seven codes do not fit one screen of a
 * tablet: first the categories, big, each in its own soft colour; one tap opens its codes, each a big button with its
 * code in bold, its label and its line of definition; "← Categorías" goes back. A planned code wears "Planeado", so it
 * is never taken for a breakdown. The code chosen is said under it, ticked, with its category.
 * value = the reason chosen so far, as a stop keeps it ('' = none). setup = PLN-03 (the Set up) may be chosen: only
 * where the Set up is offered today (a line; never "Parar todo"). skip = a code not offered (the part of a stop being
 * divided keeps its own).
 */
export function CodePicker({ value, setup, skip, onPick }: { value: string; setup?: boolean; skip?: string; onPick: (reason: string) => void }) {
  const chosen = value ? reasonCodeOf(value) : undefined
  const offered = (x: ReasonCode) => (setup || x.code !== SETUP_CODE) && x.code !== skip
  const [cat, setCat] = useState<ReasonCat | null>(() => (chosen && offered(chosen) ? chosen.cat : null))
  const cats = REASON_CATS.map((k) => ({ ...k, codes: REASON_CODES.filter((x) => x.cat === k.key && offered(x)) })).filter((k) => k.codes.length)
  const open = cats.find((k) => k.key === cat)
  return (
    <div className="rc-pick">
      {!open ? (
        <div className="rc-cats" role="group" aria-label={tr('Categorías')}>
          {cats.map((k) => (
            <button key={k.key} type="button" className={'rc-cat ' + k.tone + (chosen?.cat === k.key ? ' on' : '')} onClick={() => setCat(k.key)}>
              <b>{tr(k.label)}</b><small>{k.codes.length === 1 ? tr('1 código') : tr('{0} códigos', k.codes.length)}{chosen?.cat === k.key ? ' · ✓ ' + chosen.code : ''}</small>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="rc-head"><button type="button" className="btn sm" onClick={() => setCat(null)}>{tr('← Categorías')}</button><b className={'rc-catname ' + open.tone}>{tr(open.label)}</b></div>
          <div className="rc-codes">
            {open.codes.map((x) => { const on = chosen?.code === x.code; return <CodeButton key={x.code} x={x} on={on} onClick={() => onPick(codeReason(x))} /> })}
          </div>
        </>
      )}
      {chosen && <p className="rc-chosen">{'✓ '}<b>{chosen.code}</b>{' · ' + codeLabel(chosen)}{chosen.planned && <span className="rc-tag rc-planned">{tr('Planeado')}</span>}{chosen.cat !== 'oth' && <small>{' · ' + tr(catOf(chosen.cat).label)}</small>}</p>}
    </div>
  )
}
/**
 * one code as a big button: its code in bold, its label, its definition small, and "Planeado" when it is one. In the
 * list to read (no onClick) it is flat, not a button (nothing happens on a tap), and says too whether it is planned or
 * not and its OEE family, as the boss's table does
 */
function CodeButton({ x, on, onClick }: { x: ReasonCode; on: boolean; onClick?: () => void }) {
  const body = <><span className="rc-top"><b className="rc-code-id">{x.code}</b>{x.planned && <span className="rc-tag rc-planned">{tr('Planeado')}</span>}{on && <span className="rc-tick">✓</span>}</span><span className="rc-label">{codeLabel(x)}</span><small>{tr(x.def)}</small>{!onClick && <small className="rc-fam">{(x.planned ? tr('Planeado') : tr('No planeado')) + ' · ' + FAMILY_SHOWN[x.family]()}</small>}</>
  return onClick ? <button type="button" className={'rc-code' + (on ? ' on' : '') + (x.planned ? ' planned' : '')} aria-pressed={on} onClick={onClick}>{body}</button> : <div className={'rc-code ro' + (x.planned ? ' planned' : '')}>{body}</div>
}
/** the detail's box of a coded stop: OTH-01 needs it (its placeholder says so), any other code takes it if they want */
export const detailHint = (reason: string) => (reasonCodeOf(reason)?.code === OTHER_CODE ? tr('Explica la razón (obligatorio con {0})', OTHER_CODE) : tr('Detalle (opcional)'))
/**
 * under the detail's box while OTH-01 is chosen and its detail is still blank: the placeholder alone is cut on a phone
 * and goes away at the first letter, and "Confirmar" stays grey with nothing saying why (floor review, 2026-10-20)
 */
export function DetailNeeded({ reason, note }: { reason: string; note: string }) {
  return reasonCodeOf(reason)?.code === OTHER_CODE && !note.trim() ? <p className="rc-need">{tr('Con {0} hay que escribir la razón en el detalle para poder guardar.', OTHER_CODE)}</p> : null
}
/** a coded cause is ready to be saved: a code, and the detail OTH-01 needs */
export const codeReady = (reason: string, note: string) => { const c = reasonCodeOf(reason); return !!c && (c.code !== OTHER_CODE || note.trim().length > 0) }
/** the whole list, to read (Ajustes): by category, every code with its definition, planned or not */
export function CodeList() {
  return (
    <div className="rc-list">
      {REASON_CATS.map((k) => (
        <section key={k.key} className="rc-group">
          <h4 className={'rc-catname ' + k.tone}>{tr(k.label)}</h4>
          <div className="rc-codes">{REASON_CODES.filter((x) => x.cat === k.key).map((x) => <CodeButton key={x.code} x={x} on={false} />)}</div>
        </section>
      ))}
    </div>
  )
}
