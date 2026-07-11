import { useState } from 'react'
import { smoothPath } from '../../lib/chartMath'

export interface Series { key: string; label: string; color: string; values: number[] }

/// Multi-series smoothed-line chart — the multi-metric generalization of
/// ObsChart (single line + area fill). Deliberately NO area fill per series:
/// ObsChart's single-series gradient fill doesn't generalize to N series —
/// six overlapping semi-transparent fills would be visual noise, so this
/// keeps only the smoothed stroke per series.
///
/// The crosshair/hit-test idiom is ObsChart's own "one invisible hit-rect per
/// point" generalized from "one point" to "one bucket": a single hit-rect per
/// x-index (not per point-per-series) drives one shared crosshair and one
/// stacked tooltip listing every series' value at that bucket — hovering
/// between two series' lines still hits the bucket, there's no per-line dead
/// zone. Reuses ObsChart's exact `.obs-chart-tooltip` box.
///
/// A clickable legend row above the chart toggles a series' line on/off.
/// Six independently-scaled metrics (views can dwarf research_notes/
/// blog_posts/simulation_runs by 10-100x) would otherwise flatten the small
/// series into the baseline — the shared y-scale is deliberately computed
/// from only the currently-VISIBLE series (see `max` below), so hiding the
/// dominant series rescales the chart and the smaller ones become readable,
/// rather than the toggle only removing clutter without fixing the scale
/// problem it's meant to solve.
export function ObsMultiChart({ labels, series, height = 140, valueFormat, gradientIdPrefix }: {
  labels: string[]
  series: Series[]
  height?: number
  valueFormat?: (v: number) => string
  gradientIdPrefix: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())

  if (!labels.length || !series.length) return <div className="obs-empty">Keine Daten.</div>

  const toggle = (key: string) => {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const visible = series.filter(s => !hidden.has(s.key))
  const fmt = valueFormat ?? ((v: number) => String(v))

  const W = 640
  const H = height
  const padTop = 14, padBottom = 4, padLeft = 2, padRight = 2
  const innerW = W - padLeft - padRight
  const innerH = H - padTop - padBottom
  const n = labels.length
  const stepX = n > 1 ? innerW / (n - 1) : 0
  // Scaled to the max of only the visible series — see doc comment above:
  // this is what makes the legend toggle actually solve the scale-mismatch
  // problem, not just declutter lines.
  const max = Math.max(1, ...visible.flatMap(s => s.values))

  const lines = visible.map(s => {
    const points = s.values.map((v, i) => ({
      x: padLeft + i * stepX,
      y: padTop + innerH - (Math.max(v, 0) / max) * innerH,
    }))
    return { ...s, points, path: smoothPath(points) }
  })

  const gridLines = [0, 0.33, 0.66, 1].map(f => padTop + innerH * f)

  // Thin the x-axis labels once a wide `?days=` window packs in far more
  // buckets than a flex row can caption legibly (e.g. 90 daily buckets) —
  // ObsChart never needed this (its callers top out around 14 points), but
  // this component's caller can pass up to 90. Keeps every span present (so
  // flex `space-between` spacing is unaffected) but blanks all but ~10.
  const maxLabels = 10
  const labelStep = Math.max(1, Math.ceil(n / maxLabels))

  return (
    <div className="obs-multichart-wrap">
      <div className="obs-multichart-legend">
        {series.map(s => {
          const isHidden = hidden.has(s.key)
          return (
            <button
              key={s.key}
              type="button"
              className={`obs-multichart-legend-item${isHidden ? ' is-hidden' : ''}`}
              onClick={() => toggle(s.key)}
              aria-pressed={!isHidden}
              title={isHidden ? `${s.label} einblenden` : `${s.label} ausblenden`}
            >
              <span className="obs-multichart-legend-swatch" style={{ background: s.color, color: s.color }} />
              {s.label}
            </button>
          )
        })}
      </div>

      {visible.length === 0
        ? <div className="obs-empty">Alle Serien ausgeblendet — Serie in der Legende anklicken.</div>
        : (
          <div className="obs-chart-wrap">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="obs-chart obs-multichart" style={{ height: H }}>
              <defs>
                {/* A subtle per-series stroke gradient (fading in left-to-right),
                    not an area fill — same "never a flat color" dimensionality
                    ObsChart's area gradient and ObsDonut's per-slice gradient
                    already establish, just applied to a line stroke instead of
                    a fill since this chart deliberately has none. Distinct ids
                    per series (via `gradientIdPrefix`, mandatory/no default —
                    same reason ObsChart/ObsDonut require it: SVG <defs> ids
                    aren't scoped by React, so multiple charts on one page would
                    otherwise collide) so hidden/toggled lines don't leave stale
                    defs pointing at nothing. */}
                {lines.map(l => (
                  <linearGradient key={l.key} id={`${gradientIdPrefix}-line-${l.key}`} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor={l.color} stopOpacity="0.55" />
                    <stop offset="100%" stopColor={l.color} stopOpacity="1" />
                  </linearGradient>
                ))}
              </defs>
              {gridLines.map((y, i) => <line key={i} x1={padLeft} x2={W - padRight} y1={y} y2={y} className="obs-chart-grid" />)}
              {lines.map(l => (
                <path
                  key={l.key}
                  d={l.path}
                  fill="none"
                  stroke={`url(#${gradientIdPrefix}-line-${l.key})`}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {hover !== null && (
                <line
                  x1={padLeft + hover * stepX} x2={padLeft + hover * stepX}
                  y1={padTop} y2={padTop + innerH}
                  className="obs-chart-crosshair"
                />
              )}
              {hover !== null && lines.map(l => (
                <circle
                  key={l.key}
                  cx={l.points[hover].x} cy={l.points[hover].y} r={3.5}
                  fill={l.color} stroke="#fff" strokeWidth={1.2}
                />
              ))}
              {/* One hit-rect per x-bucket (not per point-per-series) — covers
                  the full chart height so hovering anywhere in that bucket's
                  column, including between two lines, still registers. */}
              {labels.map((_, i) => (
                <rect
                  key={i}
                  x={padLeft + i * stepX - (stepX || W) / 2} y={0} width={stepX || W} height={H}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              ))}
            </svg>
            {hover !== null && (
              <div
                className="obs-chart-tooltip obs-multichart-tooltip"
                style={{ left: `${((padLeft + hover * stepX) / W) * 100}%` }}
              >
                <div className="obs-chart-tooltip-label">{labels[hover]}</div>
                {lines.map(l => (
                  <div key={l.key} className="obs-multichart-tooltip-row">
                    <span className="obs-multichart-tooltip-swatch" style={{ background: l.color }} />
                    <span className="obs-multichart-tooltip-name">{l.label}</span>
                    <span className="obs-multichart-tooltip-value">{fmt(l.values[hover])}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="obs-chart-axis">
              {labels.map((label, i) => <span key={i}>{i % labelStep === 0 || i === n - 1 ? label : ''}</span>)}
            </div>
          </div>
        )
      }
    </div>
  )
}
