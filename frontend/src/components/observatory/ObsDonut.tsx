import { useState } from 'react'
import { describeArc, donutSegments } from '../../lib/chartMath'

export interface DonutSlice { label: string; value: number; color?: string }

// Fixed-order categorical fallback, reusing the SAME 6-accent set already
// used everywhere else in the Observatory (.obs-stat's c-blue/c-purple/
// c-teal/c-amber/c-green/c-red, and the obs-activity-row kind-badge cycle)
// rather than inventing a second palette — only used when a slice doesn't
// carry its own `color` and the caller didn't pass `colorFor` (e.g. for a
// real status/semantic mapping like emergence signal status, which should
// use its own reserved colors, not this generic identity fallback).
const DEFAULT_DONUT_COLORS = [
  'var(--obs-blue)', 'var(--obs-purple)', 'var(--obs-teal)', 'var(--obs-amber)', 'var(--obs-green)', 'var(--obs-red)',
]

/// Hand-rolled donut/ring chart — one `<path>` per slice via chartMath's
/// describeArc, no charting library (see frontend/package.json). Reuses
/// ObsChart's exact hover-tooltip idiom (position: absolute, `%`-based
/// placement, translate-centered, `.obs-chart-tooltip` styling) adapted
/// from 1D (a point's x-position along a line) to 2D (a point just outside
/// the ring, at the hovered slice's own midpoint angle) since a donut isn't
/// a line — same visual language, different geometry underneath it.
///
/// `gradientIdPrefix` (mandatory, no default) mirrors ObsChart's own
/// `gradientId` prop: SVG `<defs>` ids aren't scoped by React, so multiple
/// ObsDonut instances on the same page need distinct ids for their per-slice
/// gradients or the browser reuses whichever def id it saw first everywhere.
///
/// Always renders a real text legend (label + color swatch) below the ring —
/// never color-only identity — following the exact accessibility discipline
/// Denkfragmente.tsx already established for its own 8-layer legend.
export function ObsDonut({
  data, size = 160, thickness = 22, centerLabel, valueFormat, colorFor, gradientIdPrefix,
}: {
  data: DonutSlice[]
  size?: number
  thickness?: number
  centerLabel?: string
  valueFormat?: (v: number, total: number, pct: number) => string
  colorFor?: (slice: DonutSlice, i: number) => string
  gradientIdPrefix: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const total = data.reduce((sum, d) => sum + Math.max(d.value, 0), 0)

  if (data.length === 0 || total <= 0) return <div className="obs-empty">Keine Daten.</div>

  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - thickness / 2 - 3
  const segments = donutSegments(data, -90)
  // Small breathing-room gap between adjacent slices (rounded caps read as
  // distinct "pills" rather than one solid ring) — capped so a lone/near-
  // 100% slice never eats itself.
  const gapDeg = data.filter(d => d.value > 0).length > 1 ? 2.2 : 0
  const fmt = valueFormat ?? ((_v: number, _t: number, pct: number) => `${Math.round(pct * 100)}%`)
  const colorOf = (slice: DonutSlice, i: number) => slice.color ?? colorFor?.(slice, i) ?? DEFAULT_DONUT_COLORS[i % DEFAULT_DONUT_COLORS.length]

  return (
    <div className="obs-donut-wrap" style={{ width: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="obs-donut">
        <defs>
          {data.map((slice, i) => {
            const color = colorOf(slice, i)
            return (
              <linearGradient key={i} id={`${gradientIdPrefix}-slice-${i}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={color} stopOpacity="0.72" />
                <stop offset="100%" stopColor={color} stopOpacity="1" />
              </linearGradient>
            )
          })}
        </defs>
        {segments.map((seg, i) => {
          if (seg.pct <= 0) return null
          const color = colorOf(data[i], i)
          const halfGap = Math.min(gapDeg / 2, (seg.endAngle - seg.startAngle) / 4)
          const visiblePath = describeArc(cx, cy, r, seg.startAngle + halfGap, seg.endAngle - halfGap)
          // The hit-path uses the FULL (un-gapped) span at a much wider
          // stroke — "an invisible wider hit-path for hover" per spec — so
          // the boundary between two slices has no dead zone to hover into.
          const hitPath = describeArc(cx, cy, r, seg.startAngle, seg.endAngle)
          const dimmed = hover !== null && hover !== i
          return (
            <g key={i}>
              <path
                d={visiblePath}
                fill="none"
                stroke={`url(#${gradientIdPrefix}-slice-${i})`}
                strokeWidth={hover === i ? thickness + 4 : thickness}
                strokeLinecap="round"
                className="obs-donut-segment"
                style={{ color, opacity: dimmed ? 0.4 : 1 }}
              />
              <path
                d={hitPath}
                fill="none"
                stroke="transparent"
                strokeWidth={thickness + 18}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          )
        })}
      </svg>
      {centerLabel !== undefined && <div className="obs-donut-center">{centerLabel}</div>}
      {hover !== null && segments[hover].pct > 0 && (() => {
        const mid = (segments[hover].startAngle + segments[hover].endAngle) / 2
        const midRad = (mid * Math.PI) / 180
        const tx = cx + (r + thickness / 2 + 10) * Math.cos(midRad)
        const ty = cy + (r + thickness / 2 + 10) * Math.sin(midRad)
        return (
          <div
            className="obs-chart-tooltip"
            style={{ left: `${(tx / size) * 100}%`, top: `${(ty / size) * 100}%`, transform: 'translate(-50%, -50%)' }}
          >
            <div className="obs-chart-tooltip-value">{fmt(data[hover].value, total, segments[hover].pct)}</div>
            <div className="obs-chart-tooltip-label">{data[hover].label}</div>
          </div>
        )
      })()}
      <div className="obs-donut-legend">
        {data.map((slice, i) => (
          <span key={slice.label} className="obs-donut-legend-item">
            <span className="obs-donut-legend-swatch" style={{ background: colorOf(slice, i) }} />
            {slice.label} · {fmt(slice.value, total, total > 0 ? slice.value / total : 0)}
          </span>
        ))}
      </div>
    </div>
  )
}
