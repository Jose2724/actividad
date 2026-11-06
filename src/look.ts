import type { CSSProperties } from 'react'
import type { Dept } from './store'
import { DARK } from './theme'
/**
 * Each room told apart at a glance (Jose, 2026-10-17: "que cada departamento tenga su color"): its emoji and its colour,
 * always beside its name. The colour says WHICH ROOM, never a state: green (running, the main button), red (stopped),
 * amber (set up), indigo (bins), rose (copas), orange (pounds) and blue (Spiral's cases) keep their meanings, so no room
 * wears them. color = the stripe and the fill of a chosen chip (white text on it); ink = the room's text; tint = the light
 * band behind a room's header and badge (never a button face: next to the grey buttons a tint reads as "no colour");
 * edge = the border of a tinted piece.
 */
export const DEPT_LOOK: Record<Dept, { emoji: string; color: string; ink: string; tint: string; edge: string }> = {
  Kitchen: { emoji: '🍲', color: '#a21caf', ink: '#86198f', tint: '#fae8ff', edge: '#c158cc' },
  RTE: { emoji: '🛒', color: '#0369a1', ink: '#075985', tint: '#e0f2fe', edge: '#3d8fc0' },
  Spiral: { emoji: '🌀', color: '#4a2c6e', ink: '#4a2c6e', tint: '#efe9f7', edge: '#8f74b0' },
  MFO: { emoji: '🍽️', color: '#5f6b0a', ink: '#4a5306', tint: '#f1f4d6', edge: '#8b9535' },
  Packing: { emoji: '📦', color: '#6b4f3f', ink: '#5a4033', tint: '#f3ece6', edge: '#9c8270' },
}
/** the freezer, which talks with the office though it is not a room of the floor (2026-10-28): Freezer RTE's blue */
export const FREEZER_LOOK = { emoji: '🧊', color: '#1f5fbf', ink: '#1e3a8a', tint: '#eaf2ff', edge: '#bfd3f6' }
/**
 * the same rooms on the dark theme (theme.ts): the stripe a little brighter, the room's text light, the band behind its
 * header a dark shade of its colour
 */
const DARK_LOOK: Record<Dept | 'Freezer', { color: string; ink: string; tint: string; edge: string }> = {
  Kitchen: { color: '#c43fd1', ink: '#f0abfc', tint: '#2c1f30', edge: '#8b3a94' },
  RTE: { color: '#1f8fd1', ink: '#7dd3fc', tint: '#1c2a33', edge: '#2f6f99' },
  Spiral: { color: '#8a63b8', ink: '#cdb8ec', tint: '#25202f', edge: '#6b5394' },
  MFO: { color: '#8f9c20', ink: '#dbe68e', tint: '#25271b', edge: '#6f7a2a' },
  Packing: { color: '#a07d68', ink: '#e6cfc0', tint: '#2a2420', edge: '#7a6252' },
  Freezer: { color: '#3b7ddd', ink: '#a9c8ff', tint: '#1b2433', edge: '#35588f' },
}
const dark = (l: { color: string; ink: string; tint: string; edge: string }) => (DARK ? (Object.entries(DEPT_LOOK).find(([, v]) => v.color === l.color)?.[0] ?? (l.color === FREEZER_LOOK.color ? 'Freezer' : '')) : '')
export const lookVars = (l0: { color: string; ink: string; tint: string; edge: string }) => { const k = dark(l0), l = k ? DARK_LOOK[k as Dept | 'Freezer'] : l0; return { '--d': l.color, '--d-ink': l.ink, '--d-tint': l.tint, '--d-edge': l.edge } as CSSProperties }
/** a room's colours as CSS variables on the element that wears them (styles.css uses only var(--d…), never a room's hex) */
export const deptVars = (d: Dept) => lookVars(DEPT_LOOK[d])
