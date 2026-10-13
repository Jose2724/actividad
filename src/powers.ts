/**
 * What each person may do in Actividad beyond working their line. The role says what they start with; the owner (and a
 * manager, for operators and the office) gives or takes powers one by one. A person can also belong to a shift: the
 * report then opens on it, and what the other shift recorded is theirs to look at but not to correct, unless they hold
 * the power for it.
 */
export type Power = 'fix' | 'del' | 'goals' | 'shifts' | 'orders' | 'day' | 'depts' | 'products' | 'people' | 'othershift'
export const POWERS: { key: Power; label: string }[] = [
  { key: 'fix', label: 'Corregir registros' },
  { key: 'del', label: 'Borrar corridas y paros' },
  { key: 'goals', label: 'Poner metas' },
  { key: 'shifts', label: 'Cambiar el horario de los turnos' },
  { key: 'orders', label: 'Crear pedidos con PO' },
  { key: 'day', label: 'Empezar el día' },
  { key: 'depts', label: 'Ver todos los departamentos' },
  { key: 'products', label: 'Productos y programa' },
  { key: 'people', label: 'Manejar empleados' },
  { key: 'othershift', label: 'Corregir lo del otro turno' },
]
const ALL = POWERS.map((p) => p.key)
export type Role = 'op' | 'mgr' | 'office'
export type Who = { role: Role; admin?: boolean; powers?: Power[] | null; shift?: 0 | 1 | 2 }
/** what a role starts with: the office everything, a manager everything but correcting the other shift, an operator nothing */
export const defaultPowers = (role: Role | null | undefined): Power[] => (role === 'office' ? ALL : role === 'mgr' ? ALL.filter((p) => p !== 'othershift') : [])
/** the powers saved for a person, as they are kept: only real ones, each once; null = none saved (the role's own) */
export const cleanPowers = (x: unknown): Power[] | null => (Array.isArray(x) ? ALL.filter((p) => x.map(String).includes(p)) : null)
export const cleanShift = (x: unknown): 0 | 1 | 2 => (Number(x) === 1 ? 1 : Number(x) === 2 ? 2 : 0)
/** the owner holds every power; anybody else, the ones saved for them, or their role's */
export const powersOf = (w: Who): Power[] => (w.admin ? ALL : w.powers ?? defaultPowers(w.role))
export const canDo = (w: Who, p: Power) => powersOf(w).includes(p)
/** may this person correct a record of these shifts ("1", "2" or "1 y 2")? One of their own shift, or any with the power */
export const canShift = (w: Who, shifts: string) => !w.shift || canDo(w, 'othershift') || shifts.includes(String(w.shift))
