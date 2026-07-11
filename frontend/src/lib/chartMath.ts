// Pure geometry shared by every hand-rolled Observatory chart primitive
// (ObsChart, ObsDonut, ObsGauge, …) — no DOM, no React, just numbers in,
// numbers/strings out, so it's trivially unit-testable and reusable across
// every chart component without duplicating the same trig in each one. This
// codebase deliberately hand-rolls its charts instead of pulling in a
// library (see frontend/package.json — no recharts/d3/visx/chart.js), so
// this file is effectively the "library" every chart component leans on.

export interface CartesianPoint { x: number; y: number }

/// Angle convention used throughout this file: 0deg = 3 o'clock (right),
/// increasing clockwise on screen (consistent with SVG's y-down coordinate
/// system). -90deg is therefore 12 o'clock (top) — the natural "start at
/// the top, sweep clockwise" convention every donut/gauge below defaults to.
export function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): CartesianPoint {
  const angleRad = (angleDeg * Math.PI) / 180
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) }
}

/// Builds the `d` attribute for a single SVG arc (an open `<path>`, not a
/// closed pie wedge — callers that want a filled wedge close it themselves).
/// `startAngle`/`endAngle` follow the same convention as polarToCartesian,
/// and are expected to satisfy `endAngle >= startAngle` (both donutSegments
/// and gaugeSweepAngle below only ever produce increasing angles).
///
/// Defensive against the one real degenerate case: a span of exactly (or
/// over) 360deg collapses to a zero-length arc in SVG, since the start and
/// end points land on the same coordinate — a single 100%-share donut slice
/// or a full gauge background track would otherwise silently vanish. Nudged
/// just under a full circle so it still renders as a visible ring.
export function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const span = endAngle - startAngle
  const effectiveEnd = span >= 360 ? startAngle + 359.999 : endAngle
  const effectiveSpan = effectiveEnd - startAngle
  const start = polarToCartesian(cx, cy, r, startAngle)
  const end = polarToCartesian(cx, cy, r, effectiveEnd)
  const largeArcFlag = effectiveSpan > 180 ? 1 : 0
  // sweepFlag=1 draws in the "positive-angle" direction, which — given this
  // file's increasing-angle-is-clockwise convention — is clockwise on screen.
  const sweepFlag = 1
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y}`
}

export interface DonutSegmentAngles { startAngle: number; endAngle: number; pct: number }

/// Turns a list of raw values into per-slice angle ranges, in input order,
/// starting at `startAngle` (default -90 = top) and sweeping clockwise.
/// Negative values are treated as 0 (a donut slice can't have negative
/// share); an all-zero/empty input returns zero-width slices at `startAngle`
/// rather than dividing by zero.
export function donutSegments(data: { value: number }[], startAngle = -90): DonutSegmentAngles[] {
  const total = data.reduce((sum, d) => sum + Math.max(d.value, 0), 0)
  if (total <= 0) {
    return data.map(() => ({ startAngle, endAngle: startAngle, pct: 0 }))
  }
  let angle = startAngle
  return data.map(d => {
    const value = Math.max(d.value, 0)
    const pct = value / total
    const sweep = pct * 360
    const segment = { startAngle: angle, endAngle: angle + sweep, pct }
    angle += sweep
    return segment
  })
}

/// Maps a gauge's 0-1 fraction to the degrees of its sweep that should read
/// as "filled". Clamps defensively — nothing upstream (a backend row, a
/// division that produced NaN, a stale prop) currently guarantees `value`
/// actually stays inside [0, 1], and a raw out-of-range value would either
/// silently under-fill or make describeArc's arc math misbehave.
export function gaugeSweepAngle(value: number, sweepDeg = 270): number {
  const safeValue = Number.isFinite(value) ? value : 0
  const clamped = Math.min(1, Math.max(0, safeValue))
  return clamped * sweepDeg
}

export interface NamedValue { label: string; value: number }

/// Folds a long tail of low-value entries into a single "Andere"/"Other"
/// bucket once a series exceeds a donut-slice ceiling — this codebase's own
/// dataviz skill's series-count ladder puts 7-8 slices as the token ceiling
/// before a generated Nth hue becomes indistinguishable from an existing one
/// under CVD, and "fold the tail into Other" is its own prescribed fix
/// rather than generating more hues. Keeps the top `maxSlices - 1` entries
/// by value (descending), sums the remainder into one final entry. A no-op
/// (returns `items` re-sorted by nothing, i.e. unchanged) when already at or
/// under the ceiling, so a genuinely small category count is never touched.
export function foldIntoOther<T extends NamedValue>(items: T[], maxSlices = 6, otherLabel = 'Andere'): NamedValue[] {
  if (items.length <= maxSlices) return items
  const sorted = [...items].sort((a, b) => b.value - a.value)
  const kept = sorted.slice(0, maxSlices - 1)
  const rest = sorted.slice(maxSlices - 1)
  const otherValue = rest.reduce((sum, item) => sum + item.value, 0)
  return [...kept, { label: otherLabel, value: otherValue }]
}

/// Catmull-Rom → cubic Bézier smoothing — the difference between a business
/// dashboard and a spreadsheet screenshot. Originally private to ObsChart.tsx;
/// moved here so other line-based charts can share it instead of duplicating it.
export function smoothPath(pts: CartesianPoint[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`
  let d = `M ${pts[0].x},${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`
  }
  return d
}
