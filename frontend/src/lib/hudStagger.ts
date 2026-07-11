import type { CSSProperties } from 'react'

/// Small shared helper for the HUD "materializing" entrance: the existing
/// hud-card-in keyframe (see App.css's shared .obs-card/.obs-item-card/
/// .obs-map-card/.obs-stat rule) already animates every card in on mount,
/// but until now every card in a list popped in on the exact same frame —
/// this staggers that via an incremental animation-delay per rendered card,
/// so a freshly loaded (or freshly appended via "Weitere laden") list
/// visibly populates in sequence instead of snapping in all at once.
/// Capped (`maxSteps`) so a long list doesn't leave its tail waiting whole
/// seconds to appear.
export function hudStagger(index: number, stepMs = 45, maxSteps = 10): CSSProperties {
  return { animationDelay: `${Math.min(index, maxSteps) * stepMs}ms` }
}
