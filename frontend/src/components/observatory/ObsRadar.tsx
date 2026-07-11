import { useState } from 'react'
import { polarToCartesian, radarPoint } from '../../lib/chartMath'

export interface RadarAxis { key: string; label: string; value: number; max?: number; color?: string }

// Fixed-order categorical fallback for an axis that doesn't carry its own
// `color` — same idea as ObsDonut's DEFAULT_DONUT_COLORS (the shared
// 6-accent Observatory set), kept as its own small local copy rather than
// importing a private constant across component files. In practice every
// real caller today (Denkfragmente) always passes its own per-layer color,
// so this only matters as a defensive fallback.
const DEFAULT_RADAR_COLORS = [
  'var(--obs-blue)', 'var(--obs-purple)', 'var(--obs-teal)', 'var(--obs-amber)', 'var(--obs-green)', 'var(--obs-red)',
]

// The polygon itself represents ONE dataset (e.g. Denkfragmente's own
// layer-count distribution), not one series per axis — each axis vertex
// carries its own identity color (via RadarAxis.color, for the dot + legend),
// but the filled area/stroke is a single consistent accent, same hud-cyan
// literal the corner-frame decoration already falls back to elsewhere.
const RADAR_ACCENT = '#22d3ee'

/// Hand-rolled radar/spider chart — straight-edge polygon connecting each
/// axis's vertex (the actual spider-chart convention; deliberately NOT
/// Catmull-Rom smoothed like ObsChart/ObsMultiChart, which is right for a
/// continuous line series but wrong here since these "axes" aren't
/// sequential samples of one variable). No charting library, plain inline
/// SVG (see frontend/package.json), built specifically for Denkfragmente's
/// real 8-layer distribution but shaped as a generic reusable primitive.
///
/// Reuses ObsChart/ObsDonut's existing `.obs-chart-tooltip` hover idiom,
/// adapted to a radar vertex's own position instead of a line-point or a
/// donut-slice midpoint angle. Always renders a real text legend below the
/// chart (axis label + color swatch + value) — never hover-only — same
/// accessibility discipline as ObsDonut's own always-visible legend.
///
/// The only real consumer today (Denkfragmente) is a permanently-dark
/// Observatory-tier module (`denkfragmente` sits in OBSERVATORY_MODULES, so
/// AdminPanel.tsx's `.observatory-hud` class is applied unconditionally
/// whenever it's open, independent of the light/dark toggle — see
/// registry.tsx). Unlike ObsDonut/ObsGauge (which also render on Analytics'
/// plain white Verwaltung cards and so need a light-mode fallback plus a
/// `.observatory-hud`-gated glow on top of it), this component has no actual
/// light-mode render path to support — so its glow/pulse styling is a plain,
/// always-on treatment rather than a duplicated light/dark pair for a
/// context it will never render in.
export function ObsRadar({ axes, size = 280, levels = 4 }: { axes: RadarAxis[]; size?: number; levels?: number }) {
  const [hover, setHover] = useState<number | null>(null)

  if (axes.length === 0) return <div className="obs-empty">Keine Daten.</div>

  const cx = size / 2
  const cy = size / 2
  // Leaves headroom for the vertex dots + hover hit-circles at the outer
  // ring so they aren't clipped by the SVG viewport edge.
  const r = size / 2 - 22
  const count = axes.length
  const colorOf = (axis: RadarAxis, i: number) => axis.color ?? DEFAULT_RADAR_COLORS[i % DEFAULT_RADAR_COLORS.length]

  const vertices = axes.map((a, i) => radarPoint(cx, cy, r, i, count, a.value, a.max ?? 100))
  const polygonPoints = vertices.map(p => `${p.x},${p.y}`).join(' ')

  // `levels` concentric background rings for scale reference, drawn as the
  // same straight-edge polygon shape as the data area (not plain circles) —
  // the correct convention for a radar grid, where each ring should still
  // pass through every axis line at that level's fraction of the radius.
  const rings = Array.from({ length: levels }, (_, ringIndex) => {
    const level = (ringIndex + 1) / levels
    const pts = Array.from({ length: count }, (_, i) => polarToCartesian(cx, cy, r * level, -90 + (360 / count) * i))
    return pts.map(p => `${p.x},${p.y}`).join(' ')
  })

  const spokes = Array.from({ length: count }, (_, i) => polarToCartesian(cx, cy, r, -90 + (360 / count) * i))

  return (
    <div className="obs-radar-wrap" style={{ width: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="obs-radar-svg">
        {rings.map((points, i) => <polygon key={i} points={points} className="obs-radar-ring" />)}
        {spokes.map((p, i) => <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} className="obs-radar-spoke" />)}
        <polygon points={polygonPoints} className="obs-radar-area" style={{ color: RADAR_ACCENT }} />
        {vertices.map((p, i) => {
          const color = colorOf(axes[i], i)
          return (
            <g key={axes[i].key}>
              <circle cx={p.x} cy={p.y} r={hover === i ? 5 : 3} fill={color} stroke="#fff" strokeWidth={hover === i ? 1.5 : 0} className="obs-radar-vertex" />
              <circle
                cx={p.x} cy={p.y} r={11}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          )
        })}
      </svg>
      {hover !== null && (() => {
        const axis = axes[hover]
        const angle = -90 + (360 / count) * hover
        const vertexR = r * (axis.max && axis.max > 0 ? Math.min(1, Math.max(0, axis.value / axis.max)) : 0)
        const tip = polarToCartesian(cx, cy, vertexR + 14, angle)
        return (
          <div
            className="obs-chart-tooltip"
            style={{ left: `${(tip.x / size) * 100}%`, top: `${(tip.y / size) * 100}%`, transform: 'translate(-50%, -100%)' }}
          >
            <div className="obs-chart-tooltip-value">{axis.value}{axis.max !== undefined ? ` / ${axis.max}` : ''}</div>
            <div className="obs-chart-tooltip-label">{axis.label}</div>
          </div>
        )
      })()}
      <div className="obs-radar-legend">
        {axes.map((axis, i) => (
          <span key={axis.key} className="obs-radar-legend-item">
            <span className="obs-radar-legend-swatch" style={{ background: colorOf(axis, i) }} />
            {axis.label} · {axis.value}
          </span>
        ))}
      </div>
    </div>
  )
}
