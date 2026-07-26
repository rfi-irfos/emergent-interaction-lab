// Concrete hex values for the Observatory's --obs-* palette.
// Recharts SVG `fill`/`stroke` props do NOT resolve CSS custom properties
// (var(--obs-blue)) — they render empty, making bars/lines invisible on the
// dark HUD background. Callers that feed Recharts must pass these real hex
// strings, not the CSS-var names. Keep in sync with App.css :root / .obs-panel.
export const OBS_COLORS = {
  blue: '#3b6bf6',
  purple: '#8b5cf6',
  teal: '#14b8a6',
  amber: '#f59e0b',
  green: '#10b981',
  red: '#ef4444',
} as const

export type ObsColorKey = keyof typeof OBS_COLORS

// Resolve a CSS-var color string ('var(--obs-blue)') or pass through a real
// color. Used when mapping STATUS_ACCENT / LEVEL_DONUT_COLORS (which hold
// 'var(--obs-*)' strings) to Recharts fill/stroke props.
export function resolveObsColor(c: string): string {
  const m = /^var\(--obs-([a-z]+)\)$/.exec(c.trim())
  if (m && m[1] in OBS_COLORS) return OBS_COLORS[m[1] as ObsColorKey]
  return c
}
