import { useMemo } from 'react'
import type { ProtocolNodeItem } from '../types/content'

interface Props {
  nodes: ProtocolNodeItem[]
}

// Small, self-contained animated loop diagram for the public "Co-Evolution
// Protocol" section — a fixed 5-stage cycle, not a data-driven graph. Reuses
// the exact <animateMotion> particle idiom already proven in the admin
// KnowledgeGraph (components/observatory/KnowledgeGraph.tsx's edges: a
// <circle> with <animateMotion path="..." repeatCount="indefinite">), just
// simplified to one shared closed-loop path instead of per-edge radial
// spokes, since this has no pan/zoom infrastructure to reuse or need.
//
// Labels sit OUTSIDE the node circles (radially past them), not layered on
// top — a plain index number is all that lives inside each node now. Two
// faint, fading concentric copies of the same loop ring outside the label
// ring exist purely to signal that this isn't a closed five-step script
// running the same lap forever: each pass compounds outward rather than
// just repeating in place (the copy in content.json's protocol.intro/
// closing says this explicitly too — the rings are the visual echo of it,
// not the only place it's said).
//
// Colors are all theme-aware CSS custom properties (var(--primary) / var(--accent)),
// never the fixed var(--brand-cyan) the hero band uses — that constant stays
// the same hex across all three themes by design, which is exactly what made
// the HUD corner-frame decoration invisible on the light theme until PR #65
// fixed it (see App.css's "HUD FRAMING — public-site theme adaptation"
// comment). This diagram is themed from the start instead of repeating that.
export function CoEvolutionDiagram({ nodes }: Props) {
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  const W = 560, H = 520, CX = W / 2, CY = H / 2 - 8
  const R = 120        // node ring — the actual 5 stations
  const LABEL_R = R + 62  // where the label text sits, clear of the node circle
  const GROWTH_R1 = R + 88   // first faint outer ring — "this keeps going"
  const GROWTH_R2 = R + 116  // second, fainter still — fading outward, not closing off

  const n = nodes.length || 1
  const anglesDeg = nodes.map((_, i) => -90 + i * (360 / n))

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

  // Single closed loop visiting every node in sequence, back to the first —
  // used both as the visible stroke and as the <animateMotion> path, so the
  // particles travel exactly the line the eye follows, not a separate one.
  const loopPath = ringPath(R)
  const growthPath1 = ringPath(GROWTH_R1)
  const growthPath2 = ringPath(GROWTH_R2)

  return (
    <div className="site-protocol-diagram hud-corner-frame">
      {/* Real text legend FIRST, diagram SECOND — direct feedback: the
          animated loop read as decoration with no explanation above it;
          reading the five real stage descriptions before the visual gives
          the diagram something to refer back to instead of asking a
          visitor to decode an unlabeled loop first. */}
      <div className="site-protocol-legend">
        {points.map((p, i) => (
          <div key={p.id} className="site-protocol-legend-item">
            <span className="site-protocol-legend-index">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <strong>{p.label}</strong>
              <p>{p.description}</p>
            </div>
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="site-protocol-svg" role="img" aria-label="Co-Evolution Protocol: Interact, Retrieve, Surface, Validate, Feed Back, looping and compounding outward">
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
          const dx = p.x - CX
          const anchor = Math.abs(dx) < 14 ? 'middle' : dx < 0 ? 'end' : 'start'
          const labelRad = anglesDeg[i] * (Math.PI / 180)
          const lx = CX + LABEL_R * Math.cos(labelRad)
          const ly = CY + LABEL_R * Math.sin(labelRad)
          return (
            <g key={p.id}>
              <circle cx={p.x} cy={p.y} r="26" className="site-protocol-node" />
              <text x={p.x} y={p.y + 5} textAnchor="middle" className="site-protocol-node-index">{String(i + 1).padStart(2, '0')}</text>
              <text x={lx} y={ly} textAnchor={anchor} className="site-protocol-node-label">{p.label}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
