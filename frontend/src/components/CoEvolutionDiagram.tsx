import { useMemo } from 'react'
import type { ProtocolNodeItem } from '../types/content'

interface Props {
  nodes: ProtocolNodeItem[]
  intro?: string
}

// Small, self-contained animated loop diagram for the public "Co-Evolution
// Protocol" section — a fixed 5-stage cycle, not a data-driven graph. Reuses
// the exact <animateMotion> particle idiom already proven in the admin
// KnowledgeGraph (components/observatory/KnowledgeGraph.tsx's edges: a
// <circle> with <animateMotion path="..." repeatCount="indefinite">), just
// simplified to one shared closed-loop path instead of per-edge radial
// spokes, since this has no pan/zoom infrastructure to reuse or need.
//
// Layout (2026-07-13, third pass): the per-stage descriptors stay radially
// arranged AROUND the chart, same as originally - that visual was correct
// and wanted, just too large (first pass at fixing "too much scroll" over-
// corrected by flattening the descriptors into a plain list on the right,
// which wasn't the actual ask). What actually needed to shrink is the
// radius/spacing, and the whole radial widget needed to move to the LEFT
// with only the general intro paragraph - not the per-stage descriptions -
// sitting beside it on the right. So: compact radial chart+descriptors as
// one left-hand unit (smaller chart, tighter descriptor radius/width/font
// than the original), plain intro text as its own right-hand column.
//
// No duplicate labeling: earlier drafts had the stage name floating next
// to the node in the SVG itself AND again as the descriptor's own
// heading — the same word twice per stage. The SVG now carries only the
// index number inside each node (color-matched to that node, so the
// number is the cross-reference to its descriptor); the descriptor block
// is the only place the stage name and its description live.
//
// Colors are all theme-aware CSS custom properties (var(--primary) / var(--accent))
// EXCEPT the five per-stage hues below, which are deliberately fixed literal
// colors rather than theme-derived — the whole point is that each stage
// reads as its own distinct color, which a single theme-tinted accent can't
// give five different values for. Never the fixed var(--brand-cyan) the
// hero band uses for anything else here — see App.css's "HUD FRAMING —
// public-site theme adaptation" comment for why a theme-independent color
// caused trouble once already.
const RADIAL_AREAS = ['top', 'right', 'botright', 'botleft', 'left']
const STAGE_COLORS = ['#22d3ee', '#8b5cf6', '#14b8a6', '#f59e0b', '#ec4899']

export function CoEvolutionDiagram({ nodes, intro }: Props) {
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  // Smaller viewBox than the original 400x400, and a tighter node ring
  // (R) - the whole radial unit is now a compact left-hand column instead
  // of the full-width centerpiece it used to be, so both the chart and the
  // ring the descriptors sit on shrink together.
  const W = 280, H = 280, CX = W / 2, CY = H / 2
  const R = 66          // node ring — the actual 5 stations
  const GROWTH_R1 = R + 18   // first faint outer ring — "this keeps going"
  const GROWTH_R2 = R + 33   // second, fainter still — fading outward, not closing off

  const n = nodes.length || 1
  const anglesDeg = nodes.map((_, i) => -90 + i * (360 / n))
  const colorFor = (i: number) => STAGE_COLORS[i % STAGE_COLORS.length]

  const ringPoints = (radius: number) => anglesDeg.map(deg => {
    const rad = deg * (Math.PI / 180)
    return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) }
  })
  const ringPath = (radius: number) => {
    const pts = ringPoints(radius)
    return pts.length > 1
      ? `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ') + ' Z'
      : ''
  }

  const points = nodes.map((node, i) => {
    const rad = anglesDeg[i] * (Math.PI / 180)
    return { ...node, x: CX + R * Math.cos(rad), y: CY + R * Math.sin(rad) }
  })

  // Open spiral, not a closed ring: just over one lap, radius growing
  // smoothly from R to GROWTH_R2 the whole way round. This is the visible
  // stroke AND the <animateMotion> path. Laura's correction (2026-07-13): the
  // interaction is "not a circle, a recursive loop" - a closed ring reads as
  // the same fixed cycle running forever, which is exactly the framing this
  // diagram is meant to avoid.
  //
  // Built from many small steps (not one straight segment per node), each
  // barely different in angle/radius from the last, so it reads as a
  // continuous curve. An earlier version connected only the 5 node angles
  // directly (like ringPath below) and let the closing segment jump straight
  // back to the start angle at the far larger end radius - visually that's
  // one long diagonal spike slashed across the whole diagram, not a spiral
  // (caught 2026-07-13 from a live screenshot after shipping it). Going
  // 1.12 laps instead of exactly one also means the endpoint sits at a
  // different angle than the start, not stacked back above node 0.
  // Node markers stay fixed at radius R on their own angles (unchanged) so
  // the descriptor layout math below still lines up with each node.
  const loopPath = (() => {
    const steps = 96
    const laps = 1.12
    const totalDeg = 360 * laps
    const pts = Array.from({ length: steps + 1 }, (_, i) => {
      const t = i / steps
      const deg = -90 + t * totalDeg
      const rad = deg * (Math.PI / 180)
      const radius = R + (GROWTH_R2 - R) * t
      return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) }
    })
    return pts.length > 1 ? `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ') : ''
  })()
  const growthPath1 = ringPath(GROWTH_R1)
  const growthPath2 = ringPath(GROWTH_R2)

  const chart = (
    <svg viewBox={`0 0 ${W} ${H}`} className="site-protocol-svg" role="img" aria-label={`Emergent Interaction: ${nodes.map(n => n.label).join(', ')}, a recursive loop that spirals outward each pass, not a closed circle`}>
      {!reducedMotion && growthPath2 && <path d={growthPath2} className="site-protocol-growth-ring site-protocol-growth-ring-2" />}
      {!reducedMotion && growthPath1 && <path d={growthPath1} className="site-protocol-growth-ring site-protocol-growth-ring-1" />}
      <path d={loopPath} className="site-protocol-loop" />
      {!reducedMotion && loopPath && (
        <>
          <circle r="4.2" className="site-protocol-particle site-protocol-particle-a">
            <animateMotion dur="10s" repeatCount="indefinite" path={loopPath} />
          </circle>
          <circle r="3.2" className="site-protocol-particle site-protocol-particle-b">
            <animateMotion dur="10s" begin="-5s" repeatCount="indefinite" path={loopPath} />
          </circle>
        </>
      )}
      {points.map((p, i) => {
        const stageColor = colorFor(i)
        return (
          <g key={p.id} style={{ ['--stage-c' as string]: stageColor }}>
            <circle cx={p.x} cy={p.y} r="14" className="site-protocol-node" />
            <text x={p.x} y={p.y + 5} textAnchor="middle" className="site-protocol-node-index">{String(i + 1).padStart(2, '0')}</text>
          </g>
        )
      })}
    </svg>
  )

  // Descriptor position on a circle around the radial widget's own center,
  // expressed as percentages so it's independent of the container's actual
  // pixel size — same angle each node's SVG position already uses, just a
  // wider radius so the text sits clear of the chart itself. Tighter radius
  // and narrower text width than the original (was 40% / 200px) - this is
  // now a compact left-hand unit, not the full-width centerpiece.
  const DESC_R_PCT = 34
  return (
    <div className="site-protocol-diagram">
      <div className="site-protocol-radial-col">
        <div className="site-protocol-radial">
          <div className="site-protocol-chart-center">{chart}</div>
          {points.map((p, i) => {
            const rad = anglesDeg[i] * (Math.PI / 180)
            const dx = Math.cos(rad)
            const leftPct = 50 + DESC_R_PCT * dx
            const topPct = 50 + DESC_R_PCT * Math.sin(rad)
            const align = Math.abs(dx) < 0.2 ? 'center' : dx < 0 ? 'right' : 'left'
            return (
              <div
                key={p.id}
                className={`site-protocol-desc site-protocol-desc--${RADIAL_AREAS[i]}`}
                style={{ left: `${leftPct}%`, top: `${topPct}%`, textAlign: align }}
              >
                <span className="site-protocol-legend-index" style={{ color: colorFor(i) }}>{String(i + 1).padStart(2, '0')}</span>
                <strong>{p.label}</strong>
                <p>{p.description}</p>
              </div>
            )
          })}
        </div>
      </div>
      {intro && (
        <div className="site-protocol-text-col">
          <p className="site-protocol-intro">{intro}</p>
        </div>
      )}
    </div>
  )
}
