import type { CSSProperties } from 'react'
import type { Dept } from './store'
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
export const lookVars = (l: { color: string; ink: string; tint: string; edge: string }) => ({ '--d': l.color, '--d-ink': l.ink, '--d-tint': l.tint, '--d-edge': l.edge }) as CSSProperties
/** a room's colours as CSS variables on the element that wears them (styles.css uses only var(--d…), never a room's hex) */
export const deptVars = (d: Dept) => ({ '--d': DEPT_LOOK[d].color, '--d-ink': DEPT_LOOK[d].ink, '--d-tint': DEPT_LOOK[d].tint, '--d-edge': DEPT_LOOK[d].edge }) as CSSProperties
