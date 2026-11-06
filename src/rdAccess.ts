import { kpiGet, kpiPut, type State } from './store'

/**
 * Who sees the redesign on the live app before everybody (Jose, 2026-11-06: "Santiago y mi amigo Eli de la oficina
 * quieren probar esta versión, pero solo ellos aún no el personal"): names kept on the server with the KPI's records
 * (no SQL), as the PPLH's list. When one of them signs in, the device turns the new design on (rd.ts reads
 * localStorage act_rd at start) and opens again; taken off the list, it goes back to the usual one. A device where the
 * design was turned on by hand (act_rd without act_rd_by) is left as it is.
 */
const KEY = 'rd-access'
const plain = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
export const rdNames = (s: State): string[] => { const v = kpiGet(s, KEY)?.data.names; return Array.isArray(v) ? v.map(String).filter(Boolean) : [] }
export const setRdNames = (names: string[]) => kpiPut(KEY, { names })
export const rdListed = (s: State, name: string) => !!name && rdNames(s).some((n) => plain(n) === plain(name))

/** turns the new design on or off on this device for whoever signed in; true when the app must open again */
export function rdFollow(s: State, name: string): boolean {
  try {
    const cur = localStorage.getItem('act_rd'), by = localStorage.getItem('act_rd_by')
    if (rdListed(s, name)) {
      if (cur === '1') return false
      localStorage.setItem('act_rd', '1'); localStorage.setItem('act_rd_by', 'list')
      return true
    }
    if (by !== 'list') return false
    localStorage.removeItem('act_rd'); localStorage.removeItem('act_rd_by')
    return cur === '1'
  } catch { return false }
}
