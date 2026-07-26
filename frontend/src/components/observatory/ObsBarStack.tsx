// Horizontal stacked bar as a real Recharts BarChart (one category row,
// stacked segments) — consistent with the rest of the Observatory's chart
// language (Recharts) instead of a hand-rolled div bar. A legend below
// carries the labels + percentages (never color-only, same accessibility
// discipline as ObsDonut).
import { BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts'
import { ObsChartFrame } from './ObsChartFrame'
import { resolveObsColor } from './obsColors'

export interface BarSegment { label: string; value: number; color?: string }

const DEFAULT_BAR_COLORS = [
  'var(--obs-blue)', 'var(--obs-purple)', 'var(--obs-teal)', 'var(--obs-amber)', 'var(--obs-green)', 'var(--obs-red)',
]

export function ObsBarStack({
  data, colorFor, height = 150,
}: {
  data: BarSegment[]
  colorFor?: (seg: BarSegment, i: number) => string
  height?: number
}) {
  const total = data.reduce((sum, d) => sum + Math.max(d.value, 0), 0)
  if (total <= 0) return <div className="obs-empty">Keine Daten.</div>
  const chartData = [{ name: 'status', segments: data.map((seg, i) => ({
    name: seg.label,
    value: Math.max(seg.value, 0),
    color: seg.color ?? colorFor?.(seg, i) ?? DEFAULT_BAR_COLORS[i % DEFAULT_BAR_COLORS.length],
  })) }]
  // Build a single stacked bar: one Bar per segment, stacked on the same
  // (only) X category. Recharts stacks Bars that share a dataKey by stacking
  // if they reference the same category axis — we pass each segment as its own
  // dataKey via a flat transform instead.
  const flat = chartData[0].segments
  return (
    <div>
      <ObsChartFrame height={height}>
        <BarChart
          layout="vertical"
          data={[{ name: 'mix', ...Object.fromEntries(flat.map(s => [s.name, s.value])) }]}
          margin={{ top: 4, right: 8, bottom: 4, left: 8 }}
        >
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" hide />
          <Tooltip
            cursor={{ fill: 'rgba(120,150,170,.08)' }}
            contentStyle={{ background: '#11161f', border: '1px solid rgba(120,150,170,.25)', borderRadius: 6, fontSize: 12 }}
            formatter={((v: unknown, name: unknown) => [`${v} (${Math.round((Number(v) / total) * 100)}%)`, String(name)]) as never}
          />
          {flat.map((s, i) => (
            <Bar key={s.name} dataKey={s.name} stackId="status" fill={resolveObsColor(s.color)} radius={i === 0 ? [3, 0, 0, 3] : i === flat.length - 1 ? [0, 3, 3, 0] : 0} />
          ))}
        </BarChart>
      </ObsChartFrame>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 8 }}>
        {flat.map((s) => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0
          return (
            <span key={s.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9aa0a8' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, flex: '0 0 auto' }} />
              {s.name} {pct}%
            </span>
          )
        })}
      </div>
    </div>
  )
}
