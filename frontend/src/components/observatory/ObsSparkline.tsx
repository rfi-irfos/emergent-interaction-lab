// Minimal SVG sparkline — a single unbroken line over a sequence of points,
// used to show a metric's shape over time (no axes, no grid, just the trend).
// Deliberately the fourth distinct widget type so the top row of the
// Emergence Monitor reads as donut + bar + sparkline + gauge.
export function ObsSparkline({
  points, color = 'var(--obs-teal)', width = 220, height = 64, fill = true,
}: {
  points: number[]
  color?: string
  width?: number
  height?: number
  fill?: boolean
}) {
  if (points.length === 0) return <div className="obs-empty">Keine Daten.</div>
  const w = width
  const h = height
  const pad = 4
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const stepX = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0
  const coords = points.map((p, i) => {
    const x = pad + i * stepX
    const y = h - pad - ((p - min) / range) * (h - pad * 2)
    return [x, y] as const
  })
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${h - pad} L${coords[0][0].toFixed(1)},${h - pad} Z`
  const gid = `spark-${Math.random().toString(36).slice(2, 8)}`
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gid})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
