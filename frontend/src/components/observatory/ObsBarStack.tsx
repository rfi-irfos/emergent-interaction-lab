// Horizontal stacked bar — a categorical distribution rendered as one bar
// segmented by category, each segment a solid colour with a real legend
// below. Visually distinct from the donut/ring/gauge used elsewhere so the
// four top widgets read as four different instrument types, not four donuts.
export interface BarSegment { label: string; value: number; color?: string }

const DEFAULT_BAR_COLORS = [
  'var(--obs-blue)', 'var(--obs-purple)', 'var(--obs-teal)', 'var(--obs-amber)', 'var(--obs-green)', 'var(--obs-red)',
]

export function ObsBarStack({
  data, colorFor,
}: {
  data: BarSegment[]
  colorFor?: (seg: BarSegment, i: number) => string
}) {
  const total = data.reduce((sum, d) => sum + Math.max(d.value, 0), 0)
  if (total <= 0) return <div className="obs-empty">Keine Daten.</div>
  return (
    <div>
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: 14,
          borderRadius: 7,
          overflow: 'hidden',
          background: 'var(--gotham-border, rgba(120,150,170,.16))',
        }}
      >
        {data.map((seg, i) => {
          const v = Math.max(seg.value, 0)
          if (v === 0) return null
          const color = seg.color ?? colorFor?.(seg, i) ?? DEFAULT_BAR_COLORS[i % DEFAULT_BAR_COLORS.length]
          return (
            <div
              key={seg.label}
              title={`${seg.label}: ${v} (${Math.round((v / total) * 100)}%)`}
              style={{ width: `${(v / total) * 100}%`, background: color }}
            />
          )
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 10 }}>
        {data.map((seg, i) => {
          const color = seg.color ?? colorFor?.(seg, i) ?? DEFAULT_BAR_COLORS[i % DEFAULT_BAR_COLORS.length]
          const pct = total > 0 ? Math.round((Math.max(seg.value, 0) / total) * 100) : 0
          return (
            <span key={seg.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9aa0a8' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: color, flex: '0 0 auto' }} />
              {seg.label} {pct}%
            </span>
          )
        })}
      </div>
    </div>
  )
}
