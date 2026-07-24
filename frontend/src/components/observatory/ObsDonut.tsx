import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

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

/// Donut/ring chart, built on Recharts (see frontend/package.json) rather
/// than hand-rolled SVG arcs — same external prop shape as before this
/// migration (data/size/thickness/centerLabel/valueFormat/colorFor/
/// gradientIdPrefix), so every existing caller needed zero changes.
/// Always renders a real text legend (label + color swatch) below the ring —
/// never color-only identity — same accessibility discipline this app has
/// followed since Denkfragmente.tsx's own 8-layer legend.
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
  const total = data.reduce((sum, d) => sum + Math.max(d.value, 0), 0)

  if (data.length === 0 || total <= 0) return <div className="obs-empty">Keine Daten.</div>

  const outerRadius = size / 2 - 3
  const innerRadius = Math.max(0, outerRadius - thickness)
  const fmt = valueFormat ?? ((_v: number, _t: number, pct: number) => `${Math.round(pct * 100)}%`)
  const colorOf = (slice: DonutSlice, i: number) => slice.color ?? colorFor?.(slice, i) ?? DEFAULT_DONUT_COLORS[i % DEFAULT_DONUT_COLORS.length]

  return (
    <div className="obs-donut-wrap" style={{ width: size }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <ResponsiveContainer width={size} height={size}>
          <PieChart>
            <defs>
              {data.map((slice, i) => {
                const color = colorOf(slice, i)
                return (
                  <linearGradient key={i} id={`${gradientIdPrefix}-slice-${i}`} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor={color} stopOpacity={0.72} />
                    <stop offset="100%" stopColor={color} stopOpacity={1} />
                  </linearGradient>
                )
              })}
            </defs>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              paddingAngle={data.filter(d => d.value > 0).length > 1 ? 2.5 : 0}
              startAngle={90}
              endAngle={-270}
              stroke="none"
            >
              {data.map((_slice, i) => (
                <Cell key={i} fill={`url(#${gradientIdPrefix}-slice-${i})`} className="obs-donut-segment" />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null
                const i = data.findIndex(d => d.label === payload[0].name)
                const value = payload[0].value as number
                return (
                  <div className="obs-chart-tooltip">
                    <div className="obs-chart-tooltip-value">{fmt(value, total, total > 0 ? value / total : 0)}</div>
                    <div className="obs-chart-tooltip-label">{i >= 0 ? data[i].label : payload[0].name}</div>
                  </div>
                )
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        {centerLabel !== undefined && (
          <div className="obs-donut-center" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', whiteSpace: 'pre-line', textAlign: 'center' }}>
            {centerLabel}
          </div>
        )}
      </div>
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
