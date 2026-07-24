import { RadialBarChart, RadialBar, ResponsiveContainer } from 'recharts'

/// Radial gauge/meter, built on Recharts (see frontend/package.json) rather
/// than a hand-rolled SVG arc — a real charting library reads as a normal
/// instrument, not a custom one. `value` is a 0-1 fraction; the standard
/// "speedometer" sweep (270°, gap centered at the bottom) replaces the old
/// hand-rolled `sweepDeg`/`thresholdValue` props — neither was ever actually
/// used by a caller (grepped every ObsGauge call site before dropping them).
export function ObsGauge({
  value, label, size = 140, color = '#22d3ee', valueFormat,
}: {
  value: number
  label: string
  size?: number
  color?: string
  valueFormat?: (v: number) => string
}) {
  const clamped = Math.max(0, Math.min(1, value))
  const fmt = valueFormat ?? ((v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`)
  const data = [{ name: label, value: clamped * 100, fill: color }]

  return (
    <div className="obs-gauge-wrap" style={{ width: size }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <ResponsiveContainer width={size} height={size}>
          <RadialBarChart
            data={data}
            innerRadius={Math.max(8, Math.round(size * 0.34))}
            outerRadius={Math.max(8, Math.round(size * 0.34)) + Math.max(8, Math.round(size * 0.11))}
            startAngle={225}
            endAngle={-45}
            barSize={Math.max(8, Math.round(size * 0.11))}
          >
            <RadialBar
              dataKey="value"
              cornerRadius={99}
              background={{ fill: 'var(--gotham-border, rgba(120,150,170,.16))' }}
              className="obs-gauge-fill"
              isAnimationActive={true}
              animationDuration={550}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="obs-gauge-center" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div className="obs-stat-value" style={{ color }}>{fmt(value)}</div>
          <div className="obs-stat-label">{label}</div>
        </div>
      </div>
    </div>
  )
}
