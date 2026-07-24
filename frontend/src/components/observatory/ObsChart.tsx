import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface ChartPoint { label: string; value: number }

/// Shared BI-grade area/line chart, built on Recharts (see
/// frontend/package.json) rather than hand-rolled SVG — a real charting
/// library reads as a normal, familiar chart (Laura's own years in Excel),
/// not a custom instrument. Same external prop shape as before this
/// migration, so every existing caller (Analytics, Flugschreiber,
/// InteractionDynamics, InformationDynamics, ...) needed zero changes.
export function ObsChart({ data, color = '#3b6bf6', height = 110, valueFormat, gradientId, showAxis = true }: {
  data: ChartPoint[]
  color?: string
  height?: number
  valueFormat?: (v: number) => string
  gradientId: string
  /** Hide the bottom label row — for tiny sparklines whose x-axis (bare
   * indices, not real dates) wouldn't mean anything to read anyway. */
  showAxis?: boolean
}) {
  if (!data.length) return <div className="obs-empty">Keine Daten.</div>

  const fmt = valueFormat ?? ((v: number) => String(v))

  // Recharts renders every tick by default — same collision problem the old
  // hand-rolled axis solved (a 90-point series overlapping into garbage) —
  // so labels are still thinned to ~7 evenly-spaced ticks, always including
  // the last one, via a custom tickFormatter that blanks the rest.
  const targetTicks = 7
  const tickStep = Math.max(1, Math.ceil(data.length / targetTicks))
  const tickFormatter = (label: string, index: number) =>
    (index % tickStep === 0 || index === data.length - 1) ? label : ''

  return (
    <div className="obs-chart-wrap" style={{ height }}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="obs-chart-grid" />
          {showAxis && (
            <XAxis
              dataKey="label"
              tickFormatter={tickFormatter as (v: string, i: number) => string}
              tickLine={false}
              axisLine={false}
              className="obs-chart-axis"
              interval={0}
              fontSize={10}
            />
          )}
          <YAxis hide domain={[0, 'dataMax']} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null
              return (
                <div className="obs-chart-tooltip">
                  <div className="obs-chart-tooltip-value">{fmt(payload[0].value as number)}</div>
                  <div className="obs-chart-tooltip-label">{label}</div>
                </div>
              )
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2.5}
            fill={`url(#${gradientId})`}
            dot={{ r: 2, fill: color, stroke: 'none' }}
            activeDot={{ r: 4.5, fill: color, stroke: '#fff', strokeWidth: 1.5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
