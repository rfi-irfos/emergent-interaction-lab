// Sparkline as a real Recharts AreaChart — consistent with the rest of the
// Observatory chart language (Recharts) instead of a hand-rolled <svg>. No
// axes/grid: just the trend area, responsive and vertically centered in the
// HudTile body so it never sits misaligned next to the other instruments.
import { AreaChart, Area, YAxis, Tooltip } from 'recharts'
import { ObsChartFrame } from './ObsChartFrame'
import { resolveObsColor } from './obsColors'

export function ObsSparkline({
  points, color = 'var(--obs-teal)', height = 150,
}: {
  points: number[]
  color?: string
  height?: number
}) {
  if (points.length === 0) return <div className="obs-empty">Keine Daten.</div>
  const data = points.map((v, i) => ({ i, v }))
  return (
    <ObsChartFrame height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 6, left: 4 }}>
        <defs>
          <linearGradient id="obs-spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={resolveObsColor(color)} stopOpacity={0.28} />
            <stop offset="100%" stopColor={resolveObsColor(color)} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Tooltip
          cursor={{ stroke: 'rgba(120,150,170,.4)' }}
          contentStyle={{ background: '#11161f', border: '1px solid rgba(120,150,170,.25)', borderRadius: 6, fontSize: 12 }}
          labelFormatter={() => ''}
          formatter={((v: unknown) => [`${v} Signale`, 'Volumen']) as never}
        />
        <Area
          type="monotone"
          dataKey="v"
          stroke={resolveObsColor(color)}
          strokeWidth={2}
          fill="url(#obs-spark-fill)"
          isAnimationActive={true}
          animationDuration={550}
          dot={false}
          activeDot={{ r: 3, fill: color }}
        />
      </AreaChart>
    </ObsChartFrame>
  )
}
