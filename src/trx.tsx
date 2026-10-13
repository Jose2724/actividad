import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { phrase } from './i18n'

/**
 * A text of the screen with pieces of the screen among its words (a number in bold, a button): the same as tr(), but
 * the pieces can be anything React shows. trx('Faltan {0} de {1}', <b>{left}</b>, total)
 */
export function trx(key: string, ...pieces: ReactNode[]): ReactNode {
  return phrase(key).split(/\{(\d+)\}/).map((p, i) => (i % 2 ? <Fragment key={i}>{pieces[Number(p)]}</Fragment> : p))
}
