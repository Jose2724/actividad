import { useRef, useState, type InputHTMLAttributes } from 'react'
import { tr } from './i18n'

/**
 * A lot field (Jose, 2026-11-06: "Me están pidiendo que se pueda agregar letra en lote, pero esto no es común, so mejor
 * poner que pueda seleccionar letra cuando eso pase pero que el teclado por defecto salga en número"): the number pad
 * opens by default, and a small ABC button beside it switches the tablet to the letters keyboard (123 goes back). A lot
 * already holding a letter opens on letters. Nothing typed is changed: letters were always accepted, only the keyboard
 * could not write them.
 */
export function LotInput({ value, onChange, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'inputMode'> & { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [letters, setLetters] = useState(() => /[^\d\s]/.test(value))
  const flip = () => {
    const el = ref.current, next = !letters
    setLetters(next)
    if (!el) return
    // the keyboard only changes when the field is focused again: set it on the field now, inside the tap (iPad)
    el.inputMode = next ? 'text' : 'numeric'
    el.blur(); el.focus()
  }
  return (
    <span className="lotin">
      <input ref={ref} {...rest} className={className} value={value} inputMode={letters ? 'text' : 'numeric'} autoCapitalize="characters" onChange={(e) => onChange(e.target.value)} />
      <button type="button" className={'lotin-kb' + (letters ? ' on' : '')} title={letters ? tr('Teclado de números') : tr('Teclado con letras')} aria-label={letters ? tr('Teclado de números') : tr('Teclado con letras')} onPointerDown={(e) => e.preventDefault()} onClick={flip}>{letters ? '123' : 'ABC'}</button>
    </span>
  )
}
