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
// Colors are all theme-aware CSS custom properties (var(--primary) / var(--accent)),
// never the fixed var(--brand-cyan) the hero band uses — that constant stays
// the same hex across all three themes by design, which is exactly what made
// the HUD corner-frame decoration invisible on the light theme until PR #65
// fixed it (see App.css's "HUD FRAMING — public-site theme adaptation"
// comment). This diagram is themed from the start instead of repeating that.
export function CoEvolutionDiagram({ nodes }: Props) {
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  const W = 440, H = 400, CX = W / 2, CY = H / 2 - 6, R = 150
  const n = nodes.length || 1

  const points = nodes.map((node, i) => {
    const angle = (-90 + i * (360 / n)) * (Math.PI / 180)
    return { ...node, x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) }
  })

  // Single closed loop visiting every node in sequence, back to the first —
  // used both as the visible stroke and as the <animateMotion> path, so the
  // particles travel exactly the line the eye follows, not a separate one.
  const loopPath = points.length > 1
    ? `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ') + ' Z'
    : ''

  return (
    <div className="site-protocol-diagram hud-corner-frame">
      <svg viewBox={`0 0 ${W} ${H}`} className="site-protocol-svg" role="img" aria-label="Co-Evolution Protocol: Interact, Retrieve, Surface, Validate, Feed Back, looping">
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
        {points.map((p, i) => (
          <g key={p.id}>
            <circle cx={p.x} cy={p.y} r="32" className="site-protocol-node" />
            <text x={p.x} y={p.y - 3} textAnchor="middle" className="site-protocol-node-label">{p.label}</text>
            <text x={p.x} y={p.y + 13} textAnchor="middle" className="site-protocol-node-index">{String(i + 1).padStart(2, '0')}</text>
          </g>
        ))}
      </svg>
      {/* Real text legend below the SVG — the diagram's own labels are compact
          by necessity (fixed 32px node radius), the full per-stage
          description always lives here too, never color/position-only. */}
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
    </div>
  )
}
