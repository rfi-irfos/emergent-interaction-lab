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
// Layout (rebuilt 2026-07-13, second pass): a compact square chart on the
// LEFT, the intro text + a plain stacked descriptor list on the RIGHT.
// Previous layout positioned each descriptor radially around a large
// centered chart - correct geometrically, but 5 text blocks arranged in a
// circle around a big square made the whole section far taller than its
// actual content needed, forcing a lot of scroll to get past it (flagged
// live: "nobody wants to scroll this far down"). A plain side-by-side
// column layout is shorter, reads left-to-right/top-to-bottom naturally,
// and needs no per-node angle math for text placement at all - simpler
// code, not just a smaller widget.
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
const STAGE_COLORS = ['#22d3ee', '#8b5cf6', '#14b8a6', '#f59e0b', '#ec4899']

export function CoEvolutionDiagram({ nodes, intro }: Props) {
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  // Smaller viewBox than the previous 400x400 - this chart now sits in a
  // fixed-width column next to the text instead of being the whole
  // widget's centerpiece, so it doesn't need to be as large to read clearly.
  const W = 300, H = 300, CX = W / 2, CY = H / 2
  const R = 76         // node ring — the actual 5 stations
  const GROWTH_R1 = R + 21   // first faint outer ring — "this keeps going"
  const GROWTH_R2 = R + 39   // second, fainter still — fading outward, not closing off

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
            <circle cx={p.x} cy={p.y} r="17" className="site-protocol-node" />
            <text x={p.x} y={p.y + 5} textAnchor="middle" className="site-protocol-node-index">{String(i + 1).padStart(2, '0')}</text>
          </g>
        )
      })}
    </svg>
  )

  return (
    <div className="site-protocol-diagram">
      <div className="site-protocol-chart-col">{chart}</div>
      <div className="site-protocol-text-col">
        {intro && <p className="site-protocol-intro">{intro}</p>}
        <div className="site-protocol-legend">
          {points.map((p, i) => (
            <div key={p.id} className="site-protocol-legend-item">
              <span className="site-protocol-legend-index" style={{ color: colorFor(i) }}>{String(i + 1).padStart(2, '0')}</span>
              <div><strong>{p.label}</strong><p>{p.description}</p></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
