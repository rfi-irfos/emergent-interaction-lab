// Shared responsive frame for all Observatory chart widgets. Wraps Recharts'
// ResponsiveContainer so every instrument fills the HudTile body consistently
// and stays centered — no hand-rolled flex/absolute positioning per widget.
//
// CRITICAL: .hud-tile-body is `display: flex; flex-direction: column`. A flex
// child with only an inline `height` will collapse to 0 unless it's pinned
// with `flex: 0 0 <h>px` (flex-shrink: 0) — without that, Recharts'
// ResponsiveContainer measures its parent as 0px tall and renders nothing,
// leaving only the legend/label visible (the exact "empty tile" bug seen on
// Status-Mix / Volumen/Tag). pinning the frame height via flex-basis fixes it.
import { ResponsiveContainer } from 'recharts'

export function ObsChartFrame({
  height = 150, children,
}: {
  height?: number
  children: React.ReactElement
}) {
  return (
    <div
      style={{
        width: '100%',
        height,
        flex: `0 0 ${height}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  )
}
