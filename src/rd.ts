import { supabase } from './supabase'
/**
 * The redesign of 2026-11-05 (Jose: "rediseñar la web app completa, poner las cosas donde van ... que se vea todo
 * profesionalmente"; the catalogue he approved the same day): sections with a rail or a bottom bar, one status strip,
 * a menu under one's name, grouped settings, one search for everything and a summary for the bosses.
 *
 * It is on in the DEMO (no server) for Jose to show the bosses, and off on the live app until he says "Publícalo";
 * a device of the live app can try it with localStorage act_rd = "1" (and leave it with "0").
 */
const kept = (() => { try { return localStorage.getItem('act_rd') } catch { return null } })()
export const RD: boolean = kept === '1' ? true : kept === '0' ? false : !supabase

// (its colours, light or dark, are set in theme.ts)
