import { useEffect, useState } from 'react'
import { describeArc, gaugeSweepAngle, polarToCartesian } from '../../lib/chartMath'

/// Hand-rolled radial gauge/meter — a faint full-sweep background track plus
/// a foreground arc that fills to `value` (a 0-1 fraction). No charting
/// library (see frontend/package.json); the sweep-in animation is a plain
/// CSS `stroke-dashoffset` transition (see `.obs-gauge-fill` in App.css),
/// not a JS-driven animation loop.
///
/// The foreground arc's `d` is drawn ONCE at its full possible sweep
/// (`sweepDeg`, not `value`-dependent) — CSS can't smoothly interpolate a
/// changing path `d`, so instead the same fixed-length arc is progressively
/// *revealed* via `stroke-dasharray`/`stroke-dashoffset` (the standard SVG
/// "progress ring" technique), which CSS transitions natively.
///
/// One-shot "settle-in" sweep on mount/update, NOT a loop: the existing
/// decorative radar-dial CSS (App.css, HUD FRAMING section) explicitly
/// rejected a spinning/looping treatment because it reads as a loading
/// spinner — this doesn't repeat that mistake. Rendering the real target
/// offset on the very first paint would give the CSS transition nothing to
/// animate FROM, so the initial paint is deliberately forced to the
/// "empty" (0%) offset and the real value is applied one animation frame
/// later — the two different paints either side of that frame are what the
/// browser actually transitions between. Any *later* change to `value`
/// re-triggers the same transition for free (a changed `stroke-dashoffset`
/// always animates as long as the CSS transition rule is present), so this
/// also covers "on update", not just "on mount".
export function ObsGauge({
  value, label, size = 140, color = '#22d3ee', valueFormat, sweepDeg = 270, thresholdValue,
}: {
  value: number
  label: string
  size?: number
  color?: string
  valueFormat?: (v: number) => string
  sweepDeg?: number
  thresholdValue?: number
}) {
  const thickness = Math.max(8, Math.round(size * 0.11))
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - thickness / 2 - 6

  // Gauge opens at the bottom, centered: the untouched gap (360 - sweepDeg)
  // is split evenly either side of straight-down (angle 90 in this file's
  // convention — see chartMath.ts's polarToCartesian doc comment).
  const gapDeg = 360 - sweepDeg
  const startAngle = 90 + gapDeg / 2
  const endAngle = startAngle + sweepDeg
  const trackPath = describeArc(cx, cy, r, startAngle, endAngle)
  const arcLength = r * ((sweepDeg * Math.PI) / 180)

  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setRevealed(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const clampedFraction = gaugeSweepAngle(value, 1)
  const filledFraction = revealed ? clampedFraction : 0
  const dashOffset = arcLength * (1 - filledFraction)

  const fmt = valueFormat ?? ((v: number) => `${Math.round(gaugeSweepAngle(v, 1) * 100)}%`)

  const thresholdAngle = thresholdValue !== undefined ? startAngle + gaugeSweepAngle(thresholdValue, sweepDeg) : null
  const tickInner = thresholdAngle !== null ? polarToCartesian(cx, cy, r - thickness / 2 - 4, thresholdAngle) : null
  const tickOuter = thresholdAngle !== null ? polarToCartesian(cx, cy, r + thickness / 2 + 4, thresholdAngle) : null

  return (
    <div className="obs-gauge-wrap" style={{ width: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="obs-gauge">
        <path d={trackPath} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round" className="obs-gauge-track" style={{ color }} />
        <path
          d={trackPath}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          className="obs-gauge-fill"
          style={{ color, strokeDasharray: `${arcLength} ${arcLength}`, strokeDashoffset: dashOffset }}
        />
        {/* Targeting-reticle reference line at thresholdValue, when given —
            fixed universal color (not theme-dependent) so it reads
            correctly on both the plain-light and HUD-dark card surfaces
            without needing a separate light/dark override. */}
        {tickInner && tickOuter && (
          <line x1={tickInner.x} y1={tickInner.y} x2={tickOuter.x} y2={tickOuter.y} className="obs-gauge-threshold" />
        )}
      </svg>
      <div className="obs-gauge-center">
        <div className="obs-stat-value">{fmt(value)}</div>
        <div className="obs-stat-label">{label}</div>
      </div>
    </div>
  )
}
