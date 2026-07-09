import { useState } from 'react'

interface ChartPoint { label: string; value: number }

// Catmull-Rom → cubic Bézier smoothing — the difference between a business
// dashboard and a spreadsheet screenshot. Applied to both the line and the
// area-fill path.
function smoothPath(pts: { x: number; y: number }[]): string {
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

/// Shared BI-grade area/line chart — smooth curve, gradient fill, gridlines,
/// hover crosshair + tooltip. Replaces the flat solid-fill bar divs used
/// across the Observatory modules. Pure inline SVG, no charting library.
export function ObsChart({ data, color = '#3b6bf6', height = 110, valueFormat, gradientId }: {
  data: ChartPoint[]
  color?: string
  height?: number
  valueFormat?: (v: number) => string
  gradientId: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  if (!data.length) return <div className="obs-empty">Keine Daten.</div>

  const W = 640
  const H = height
  const padTop = 14, padBottom = 4, padLeft = 2, padRight = 2
  const max = Math.max(...data.map(d => d.value), 1)
  const innerW = W - padLeft - padRight
  const innerH = H - padTop - padBottom
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0

  const points = data.map((d, i) => ({
    x: padLeft + i * stepX,
    y: padTop + innerH - (d.value / max) * innerH,
    ...d,
  }))

  const linePath = smoothPath(points)
  const areaPath = `${linePath} L ${points[points.length - 1].x},${padTop + innerH} L ${points[0].x},${padTop + innerH} Z`
  const gridLines = [0, 0.33, 0.66, 1].map(f => padTop + innerH * f)
  const fmt = valueFormat ?? ((v: number) => String(v))

  return (
    <div className="obs-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="obs-chart">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridLines.map((y, i) => <line key={i} x1={padLeft} x2={W - padRight} y1={y} y2={y} className="obs-chart-grid" />)}
        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {hover !== null && (
          <line x1={points[hover].x} x2={points[hover].x} y1={padTop} y2={padTop + innerH} className="obs-chart-crosshair" />
        )}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={hover === i ? 4.5 : 2} fill={color} stroke="#fff" strokeWidth={hover === i ? 1.5 : 0} />
            <rect
              x={p.x - (stepX || W) / 2} y={0} width={stepX || W} height={H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="obs-chart-tooltip" style={{ left: `${(points[hover].x / W) * 100}%` }}>
          <div className="obs-chart-tooltip-value">{fmt(points[hover].value)}</div>
          <div className="obs-chart-tooltip-label">{points[hover].label}</div>
        </div>
      )}
      <div className="obs-chart-axis">
        {data.map((d, i) => <span key={i}>{d.label}</span>)}
      </div>
    </div>
  )
}
