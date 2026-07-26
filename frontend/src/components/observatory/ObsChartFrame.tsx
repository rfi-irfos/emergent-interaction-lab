// Shared responsive frame for all Observatory chart widgets. Wraps Recharts'
// ResponsiveContainer so every instrument fills the HudTile body consistently
// and stays centered — no hand-rolled flex/absolute positioning per widget.
import { ResponsiveContainer } from 'recharts'

export function ObsChartFrame({
  height = 150, children,
}: {
  height?: number
  children: React.ReactElement
}) {
  return (
    <div style={{ width: '100%', height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  )
}
