// Shared responsive frame for all Observatory chart widgets. Wraps Recharts'
// ResponsiveContainer so every instrument fills the HudTile body consistently
// and stays centered.
//
// NOTE: .hud-tile-body is `display: flex; flex-direction: column`, and a flex
// child with `height="100%"` collapses ResponsiveContainer to 0 (it measures
// the parent as 0 tall) — that was the "legend-only / empty tile" bug on
// Status-Mix / Volumen/Tag. We therefore pass an explicit numeric pixel
// height to ResponsiveContainer (NOT "100%") so it always has a concrete box
// to render into. The width stays "100%" (ResponsiveContainer handles width
// fine); only height must be concrete here.
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
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <ResponsiveContainer width="100%" height={height}>
        {children}
      </ResponsiveContainer>
    </div>
  )
}
