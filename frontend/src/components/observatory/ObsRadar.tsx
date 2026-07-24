import { RadarChart, PolarGrid, PolarAngleAxis, Radar, Tooltip, ResponsiveContainer } from 'recharts'

export interface RadarAxis { key: string; label: string; value: number; max?: number; color?: string }

const RADAR_ACCENT = '#22d3ee'

/// Radar/spider chart, built on Recharts (see frontend/package.json) rather
/// than a hand-rolled SVG polygon — same external prop shape as before this
/// migration (axes/size/levels), so Denkfragmente.tsx (the only consumer)
/// needed zero changes. Each axis can carry its own `max`, so values are
/// normalized to a 0-100 scale for the shared radial axis; the real value
/// (not the normalized one) is what the tooltip and legend show.
export function ObsRadar({ axes, size = 280, levels = 4 }: { axes: RadarAxis[]; size?: number; levels?: number }) {
  if (axes.length === 0) return <div className="obs-empty">Keine Daten.</div>

  const data = axes.map(a => ({
    key: a.key,
    label: a.label,
    value: a.value,
    max: a.max ?? 100,
    normalized: a.max && a.max > 0 ? (a.value / a.max) * 100 : 0,
  }))

  return (
    <div className="obs-radar-wrap" style={{ width: size }}>
      <ResponsiveContainer width={size} height={size}>
        <RadarChart data={data} outerRadius={size / 2 - 22}>
          <PolarGrid className="obs-radar-ring" gridType="polygon" radialLines={true} polarRadius={Array.from({ length: levels }, (_, i) => ((i + 1) / levels) * 100)} />
          <PolarAngleAxis dataKey="label" tick={{ fontSize: 11 }} className="obs-radar-axis-label" />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null
              const p = payload[0].payload as (typeof data)[number]
              return (
                <div className="obs-chart-tooltip">
                  <div className="obs-chart-tooltip-value">{p.value}{p.max !== undefined ? ` / ${p.max}` : ''}</div>
                  <div className="obs-chart-tooltip-label">{p.label}</div>
                </div>
              )
            }}
          />
          <Radar
            dataKey="normalized"
            stroke={RADAR_ACCENT}
            fill={RADAR_ACCENT}
            fillOpacity={0.22}
            strokeWidth={2}
            className="obs-radar-area"
            dot={{ r: 3, fill: RADAR_ACCENT, stroke: '#fff', strokeWidth: 0 }}
          />
        </RadarChart>
      </ResponsiveContainer>
      <div className="obs-radar-legend">
        {axes.map(axis => (
          <span key={axis.key} className="obs-radar-legend-item">
            <span className="obs-radar-legend-swatch" style={{ background: axis.color ?? RADAR_ACCENT }} />
            {axis.label} · {axis.value}
          </span>
        ))}
      </div>
    </div>
  )
}
