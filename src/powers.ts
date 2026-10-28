import { tr } from './i18n'
/**
 * What each person may do in Actividad beyond working their line. The role says what they start with; the owner (and a
 * manager, for operators and the office) gives or takes powers one by one. A person can also belong to a shift: the
 * report then opens on it, and what the other shift recorded is theirs to look at but not to correct, unless they hold
 * the power for it.
 */
export type Power = 'fix' | 'del' | 'goals' | 'shifts' | 'orders' | 'day' | 'depts' | 'products' | 'people' | 'othershift'
export const POWERS: { key: Power; label: string }[] = [
  { key: 'fix', label: tr('Corregir registros') },
  { key: 'del', label: tr('Borrar corridas y paros') },
  { key: 'goals', label: tr('Poner metas') },
  { key: 'shifts', label: tr('Cambiar el horario de los turnos') },
  { key: 'orders', label: tr('Crear pedidos con PO') },
  { key: 'day', label: tr('Empezar el día') },
  { key: 'depts', label: tr('Ver todos los departamentos') },
  { key: 'products', label: tr('Productos y programa') },
  { key: 'people', label: tr('Manejar empleados') },
  { key: 'othershift', label: tr('Corregir lo del otro turno') },
]
const ALL = POWERS.map((p) => p.key)
/** 'viewer' = somebody from the office who looks and never touches: every room, Avance and the report, no button */
export type Role = 'op' | 'mgr' | 'office' | 'viewer'
export type Who = { role: Role; admin?: boolean; powers?: Power[] | null; shift?: 0 | 1 | 2; dept?: string; freezer?: boolean } // dept = an operator's room; freezer = works in Freezer RTE too
/** what a role starts with: the office everything, a manager everything but correcting the other shift, an operator nothing, a viewer only looking at every room */
export const defaultPowers = (role: Role | null | undefined): Power[] => (role === 'office' ? ALL : role === 'mgr' ? ALL.filter((p) => p !== 'othershift') : role === 'viewer' ? ['depts'] : [])
/** the powers saved for a person, as they are kept: only real ones, each once; null = none saved (the role's own) */
export const cleanPowers = (x: unknown): Power[] | null => (Array.isArray(x) ? ALL.filter((p) => x.map(String).includes(p)) : null)
export const cleanShift = (x: unknown): 0 | 1 | 2 => (Number(x) === 1 ? 1 : Number(x) === 2 ? 2 : 0)
/**
 * the Actividad roles this person may give in Empleados (new accounts and the role of others): the owner (a Freezer RTE
 * admin) all of them; anybody else operator and "Solo ver" only, because manager and office accounts are Jose's alone
 * (his decision of 2026-10-18; the act-users function refuses the rest)
 */
export const rolesGiven = (admin: boolean | undefined): Role[] => (admin ? ['op', 'mgr', 'office', 'viewer'] : ['op', 'viewer'])
/**
 * may the browser be offered this person's user name and PIN to keep, right after they signed in? Only an operator's
 * (Jose, 2026-10-18): a floor tablet is shared, and a manager's, the office's, a "Solo ver" or a Freezer RTE admin's PIN
 * kept on it would let anybody walking by in with that account. w = who the server just said signed in (null / 'none' /
 * not known = no)
 */
export const keepsPin = (w: { role?: string; admin?: boolean } | null | undefined | string): boolean => !!w && typeof w === 'object' && w.role === 'op' && !w.admin
/** the owner holds every power; a viewer never more than looking; anybody else, the ones saved for them, or their role's */
export const powersOf = (w: Who): Power[] => (w.admin ? ALL : w.role === 'viewer' ? defaultPowers('viewer') : w.powers ?? defaultPowers(w.role))
export const canDo = (w: Who, p: Power) => powersOf(w).includes(p)
/** may this person correct a record of these shifts ("1", "2" or "1 y 2")? One of their own shift, or any with the power */
export const canShift = (w: Who, shifts: string) => !w.shift || canDo(w, 'othershift') || shifts.includes(String(w.shift))
/**
 * may this person write a room's lines, codes, stops and history? The server's own rule (migrations/001,
 * act_can_write): a manager or the office every room, an operator only their own, somebody who only looks none.
 * "Ver todos los departamentos" lets an operator look at the other rooms, not write them: the screens used to offer
 * it all the same, the server refused, and the rows waited on the tablet for ever (review of 2026-10-18). The same
 * rule as writesRoom in store.ts, read from who is on the screen
 */
export const writesIn = (w: Who, room: string) => w.role === 'mgr' || w.role === 'office' || (w.role === 'op' && !!room && room === w.dept)
