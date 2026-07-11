import { useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders } from '../../lib/adminApi'
import { TOOL_LABELS } from '../../lib/toolLabels'
import { useSvgPanZoom } from '../../hooks/useSvgPanZoom'
import type { ViewBox } from '../../lib/svgPanZoom'

// `legend` is the short, count-independent plain-language line shown in the
// always-visible legend strip below — previously the ONLY explanation of
// what each node even means was `blurb`, which only ever appeared after
// hovering or clicking that specific node first. Laura: "hardly anything
// makes sense" — you shouldn't have to click all 5 nodes once each just to
// find out what the diagram is even a diagram OF.
const NODES = [
  { id: 'human', label: 'Human', accent: '#22d3ee', legend: 'Deine Nachrichten in Forschungsgesprächen', blurb: (n: number) => `${n} Beobachtungen — Nutzer-Nachrichten aus Forschungsgesprächen mit Laura.` },
  { id: 'ai', label: 'AI Systems', accent: '#8b5cf6', legend: 'Jarvis\' Antworten und Werkzeugaufrufe', blurb: (n: number) => `${n} Beobachtungen — Antworten und Werkzeugaufrufe von Jarvis.` },
  { id: 'organization', label: 'Organization', accent: '#f59e0b', legend: 'Research Notes, Blogpost-Entwürfe, Simulationen', blurb: (n: number) => `${n} Beobachtungen — Research Notes, Blogpost-Entwürfe und Simulationsläufe.` },
  { id: 'technology', label: 'Technology', accent: '#10b981', legend: 'Hochgeladene Dokumente (RAG)', blurb: (n: number) => `${n} Beobachtungen — hochgeladene Dokumente und daraus erzeugte Chunks.` },
  { id: 'information', label: 'Information Dynamics', accent: '#14b8a6', legend: 'Wie oft frühere Gespräche/Dokumente wiederverwendet werden', blurb: (n: number) => `${n} Beobachtungen — Retrieval-Aktivität über alle Gespräche hinweg.` },
]

const CX = 300, CY = 230, R = 168

// Module-level constant so it's referentially stable across renders — the
// pan/zoom hook uses it as a dependency and doesn't deep-compare.
const BASE_VIEWBOX: ViewBox = { x: 0, y: 0, w: 600, h: 460 }

// Deterministic pseudo-random in [0,1) — stable satellite placement across
// re-renders (a real Math.random() would make the mycelium jitter every
// time `counts` refetches), still reads as organic rather than a grid.
function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

async function fetchJson(path: string): Promise<any> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

function useTypewriter(text: string, active: boolean) {
  const [shown, setShown] = useState('')
  useEffect(() => {
    if (!active) { setShown(''); return }
    setShown('')
    let i = 0
    const id = setInterval(() => {
      i += 2
      setShown(text.slice(0, i))
      if (i >= text.length) clearInterval(id)
    }, 12)
    return () => clearInterval(id)
  }, [text, active])
  return shown
}

// A satellite is a REAL underlying record (a message, a tool call, a research
// note, a document, a retrieval event) — never a decorative placeholder. Each
// node's satellite list length is however many genuine recent items the
// backend actually found, capped at 5, same visual budget as before. If a
// category has fewer real items than that cap, fewer satellites render —
// that gap is honest, not a bug.
interface SatelliteItem {
  id: string
  label: string
  createdAt: string
  conversationId: string | null
}

const ORGANIZATION_KIND_LABELS: Record<string, string> = {
  research_note: 'Research Note',
  blog_post: 'Blogpost-Entwurf',
  simulation_run: 'Simulationslauf',
}

function buildHumanSatellites(humanAi: any): SatelliteItem[] {
  const rows = Array.isArray(humanAi?.recent_user_messages) ? humanAi.recent_user_messages : []
  return rows.map((m: any) => ({
    id: m.id,
    label: `Nutzer-Nachricht: „${m.excerpt}“`,
    createdAt: m.created_at,
    conversationId: m.conversation_id ?? null,
  }))
}

function buildAiSatellites(aiActivity: any): SatelliteItem[] {
  const rows = Array.isArray(aiActivity) ? aiActivity : []
  return rows.map((item: any) => {
    if (item.kind === 'tool_call') {
      const toolLabel = TOOL_LABELS[item.label] ?? item.label
      const failed = item.status && item.status !== 'ok'
      return {
        id: item.id,
        label: `Werkzeugaufruf: ${toolLabel}${failed ? ' (Fehler)' : ''}`,
        createdAt: item.created_at,
        conversationId: item.conversation_id ?? null,
      }
    }
    return {
      id: item.id,
      label: `Antwort von Jarvis: „${item.label}“`,
      createdAt: item.created_at,
      conversationId: item.conversation_id ?? null,
    }
  })
}

function buildOrganizationSatellites(organization: any): SatelliteItem[] {
  const rows = Array.isArray(organization) ? organization : []
  return rows.map((item: any) => ({
    id: item.id,
    label: `${ORGANIZATION_KIND_LABELS[item.kind] ?? item.kind}: „${item.title}“`,
    createdAt: item.created_at,
    conversationId: item.conversation_id ?? null,
  }))
}

function buildTechnologySatellites(information: any): SatelliteItem[] {
  const rows = Array.isArray(information?.recent_documents) ? information.recent_documents : []
  return rows.map((d: any) => ({
    id: d.id,
    label: `Dokument hochgeladen: „${d.filename}“`,
    createdAt: d.created_at,
    conversationId: null,
  }))
}

function buildInformationSatellites(information: any): SatelliteItem[] {
  const rows = Array.isArray(information?.recent_retrievals) ? information.recent_retrievals : []
  return rows.slice(0, 5).map((r: any) => {
    const hits = r.is_gap ? 'Wissenslücke — keine ausreichenden Treffer' : `${r.hit_count} Treffer, Score ${Number(r.top_score).toFixed(2)}`
    return {
      id: r.id,
      label: `Retrieval-Anfrage: „${r.query_text}“ — ${hits}`,
      createdAt: r.created_at,
      conversationId: r.conversation_id ?? null,
    }
  })
}

/// The network this lab actually studies — human/AI/organization/technology/
/// information relationships — not this app's own internal architecture
/// diagram. "Society" is deliberately omitted: no real data proxy for it
/// exists anywhere in this system, and a fabricated number would be worse
/// than an honest gap.
///
/// Styled as a growing mycelium rather than a static org chart: each node
/// sprouts small satellite nodes proportional to its own activity, and
/// clicking a node — like a metatag — writes its underlying observation
/// out in place, typewriter-style, rather than just showing a static label.
/// Each satellite is itself clickable now too: it points at one real
/// individual record (a message, a tool call, a research note, a document,
/// a retrieval event) instead of only ever restating the aggregate count.
export function SystemMap({ onOpenConversation }: { onOpenConversation?: (conversationId: string) => void } = {}) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null)
  const [satellites, setSatellites] = useState<Record<string, SatelliteItem[]>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [expandedSatellite, setExpandedSatellite] = useState<{ nodeId: string; itemId: string } | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [hoveredSatellite, setHoveredSatellite] = useState<{ nodeId: string; itemId: string } | null>(null)
  // Destructured (not kept as one `panZoom` object) so eslint's
  // react-hooks/refs check can tell `viewBox` (plain state) apart from
  // `svgRef` (an actual ref) — bundling them behind one property access
  // makes the rule conservatively flag every `panZoom.viewBox.x` read.
  const {
    svgRef, viewBox, viewBoxStr, zoomLevel, isPanning, layoutKey,
    resetView, relayout, onPointerDown, onPointerMove, onPointerUp,
    onPointerCancel, onPointerLeave, onClickCapture,
  } = useSvgPanZoom(BASE_VIEWBOX)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [analytics, humanAi, information, diagnostics, aiActivity, organization] = await Promise.all([
        fetchJson('/api/analytics'),
        fetchJson('/api/observatory/human-ai'),
        fetchJson('/api/observatory/information'),
        fetchJson('/api/observatory/diagnostics'),
        fetchJson('/api/observatory/ai-activity'),
        fetchJson('/api/observatory/organization'),
      ])
      if (cancelled) return
      const retrievalActivity = Array.isArray(information?.retrieval_by_day)
        ? information.retrieval_by_day.reduce((sum: number, d: any) => sum + (d.avg_hit_count ?? 0), 0)
        : 0
      setCounts({
        human: humanAi?.user_messages ?? 0,
        ai: (humanAi?.assistant_messages ?? 0) + (diagnostics?.agent_tool_calls_7d ?? 0),
        organization: (analytics?.research_notes ?? 0) + (analytics?.blog_posts_draft ?? 0) + (analytics?.blog_posts_published ?? 0) + (analytics?.simulation_runs ?? 0),
        technology: (information?.documents ?? 0) + (information?.chunks ?? 0),
        information: Math.round(retrievalActivity),
      })
      setSatellites({
        human: buildHumanSatellites(humanAi),
        ai: buildAiSatellites(aiActivity),
        organization: buildOrganizationSatellites(organization),
        technology: buildTechnologySatellites(information),
        information: buildInformationSatellites(information),
      })
    })()
    return () => { cancelled = true }
  }, [])

  const positions = useMemo(() => NODES.map((n, i) => {
    const angle = (-90 + i * (360 / NODES.length)) * (Math.PI / 180)
    return { ...n, x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle), angle }
  }), [])

  const expandedNode = expanded ? NODES.find(n => n.id === expanded) : null
  const activeSatelliteNode = expandedSatellite ? NODES.find(n => n.id === expandedSatellite.nodeId) : null
  const activeSatelliteItem = expandedSatellite
    ? (satellites[expandedSatellite.nodeId] ?? []).find(s => s.id === expandedSatellite.itemId) ?? null
    : null

  // A selected satellite always wins over the tier-level aggregate blurb —
  // the two are mutually exclusive (see the two onClick handlers below),
  // but this keeps the detail-panel text derivation in one place.
  const detailNode = activeSatelliteNode ?? expandedNode
  const detailText = activeSatelliteItem
    ? activeSatelliteItem.label
    : (expandedNode ? expandedNode.blurb(counts?.[expandedNode.id] ?? 0) : '')
  const typed = useTypewriter(detailText, !!detailNode)

  // Hover mirrors the click-driven derivation above, but as a lighter
  // "glance" layer (a floating tooltip) rather than the typewriter panel —
  // it never touches `expanded`/`expandedSatellite` state. Looked up from
  // `positions` (not `NODES`) because the tooltip needs x/y, which only
  // `positions` carries.
  const hoveredMainNode = hoveredNode ? positions.find(p => p.id === hoveredNode) : null
  const hoveredSatelliteNode = hoveredSatellite ? positions.find(p => p.id === hoveredSatellite.nodeId) : null
  const hoveredSatelliteItem = hoveredSatellite
    ? (satellites[hoveredSatellite.nodeId] ?? []).find(s => s.id === hoveredSatellite.itemId) ?? null
    : null
  // Mirrors the satellite jitter formula used when rendering the dots
  // themselves (same pi/si-seeded hash) so the tooltip lands on the actual
  // dot rather than back at the parent node's center.
  const hoveredSatellitePos = (() => {
    if (!hoveredSatellite || !hoveredSatelliteNode) return null
    const pi = positions.findIndex(p => p.id === hoveredSatellite.nodeId)
    const si = (satellites[hoveredSatellite.nodeId] ?? []).findIndex(s => s.id === hoveredSatellite.itemId)
    if (pi < 0 || si < 0) return null
    const a = hoveredSatelliteNode.angle + (hash(pi * 13 + si) - 0.5) * 1.8
    const dist = 44 + hash(pi * 29 + si) * 26
    return { x: hoveredSatelliteNode.x + Math.cos(a) * dist, y: hoveredSatelliteNode.y + Math.sin(a) * dist }
  })()

  if (!counts) return <div className="obs-panel"><div className="obs-empty">Netzwerk wächst…</div></div>

  const maxCount = Math.max(...Object.values(counts), 1)

  return (
    <div className="obs-panel">
      <div className="obs-card obs-map-card mycelium-card">
        {/* Always-visible legend — what the diagram below actually shows,
            before any hovering/clicking. One line per node, same accent
            color as its dot/thread, so the mapping between "this colored
            thing" and "this is what it means" doesn't require guessing. */}
        <div className="mycelium-legend">
          <span className="mycelium-legend-title">Was zeigt dieses Netzwerk?</span>
          <span className="mycelium-legend-sub">Jeder Knoten ist ein Teilsystem; Kantenstärke = relative Aktivität. Klicken für Details.</span>
          <div className="mycelium-legend-items">
            {NODES.map(n => (
              <span key={n.id} className="mycelium-legend-item">
                <span className="mycelium-legend-dot" style={{ background: n.accent }} />
                <strong>{n.label}</strong>: {n.legend}
              </span>
            ))}
          </div>
        </div>
        <div className="obs-map-toolbar">
          <span className="obs-map-toolbar-zoom">{Math.round(zoomLevel * 100)}%</span>
          <button type="button" className="obs-map-toolbar-btn" onClick={resetView} title="Zoom/Pan zurücksetzen">
            ⟲ Ansicht zurücksetzen
          </button>
          <button type="button" className="obs-map-toolbar-btn" onClick={relayout} title="Layout neu anordnen">
            ⟳ Neu anordnen
          </button>
        </div>
        <svg
          ref={svgRef}
          viewBox={viewBoxStr}
          style={{
            width: '100%', maxWidth: 640, display: 'block', margin: '0 auto',
            cursor: isPanning ? 'grabbing' : 'grab', touchAction: 'none',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={onPointerLeave}
          onClickCapture={onClickCapture}
        >
          <defs>
            <radialGradient id="hub-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
            </radialGradient>
          </defs>

          <g key={layoutKey}>
            {positions.map((p, pi) => {
              const weight = counts[p.id] ?? 0
              const w = 1 + (weight / maxCount) * 4
              const opacity = 0.28 + (weight / maxCount) * 0.5
              // Organic thread: a gentle bezier bow instead of a straight line.
              const mx = (CX + p.x) / 2 + Math.sin(pi * 2.1) * 22
              const my = (CY + p.y) / 2 + Math.cos(pi * 2.1) * 22
              const items = satellites[p.id] ?? []
              return (
                <g key={`edge-${p.id}`}>
                  <path id={`obs-map-path-${p.id}`} d={`M ${CX} ${CY} Q ${mx} ${my} ${p.x} ${p.y}`} fill="none" stroke={p.accent} strokeWidth={w + 5} opacity={opacity * 0.2} style={{ filter: 'blur(4px)' }} />
                  <path d={`M ${CX} ${CY} Q ${mx} ${my} ${p.x} ${p.y}`} fill="none" stroke={p.accent} strokeWidth={w} opacity={opacity} strokeLinecap="round" />
                  <circle r="3.5" fill={p.accent}>
                    <animateMotion dur={`${3 + hash(pi) * 2}s`} repeatCount="indefinite">
                      <mpath href={`#obs-map-path-${p.id}`} />
                    </animateMotion>
                  </circle>
                  {/* Budding satellites — the "growing mycelium" itself: one per
                      real recent record this node actually has, up to 5. No
                      padding when fewer than 5 exist — an honest gap beats a
                      fabricated one. Each is independently clickable now. */}
                  {items.map((item, si) => {
                    const a = p.angle + (hash(pi * 13 + si) - 0.5) * 1.8
                    const dist = 44 + hash(pi * 29 + si) * 26
                    const sx = p.x + Math.cos(a) * dist
                    const sy = p.y + Math.sin(a) * dist
                    const isActive = expandedSatellite?.nodeId === p.id && expandedSatellite.itemId === item.id
                    return (
                      <g
                        key={item.id}
                        className={`mycelium-satellite ${isActive ? 'active' : ''}`}
                        style={{ animationDelay: `${si * 0.15 + pi * 0.1}s`, cursor: 'pointer', color: p.accent }}
                        onClick={() => {
                          setExpanded(null)
                          setExpandedSatellite(cur => (cur && cur.itemId === item.id ? null : { nodeId: p.id, itemId: item.id }))
                        }}
                        onMouseEnter={() => setHoveredSatellite({ nodeId: p.id, itemId: item.id })}
                        onMouseLeave={() => setHoveredSatellite(cur => (cur?.itemId === item.id ? null : cur))}
                      >
                        <line x1={p.x} y1={p.y} x2={sx} y2={sy} stroke={p.accent} strokeWidth={isActive ? 2 : 1} opacity={isActive ? 0.8 : 0.35} />
                        <circle className="mycelium-satellite-dot" cx={sx} cy={sy} r={isActive ? 6 : 3 + hash(si * 7) * 2} fill={p.accent} opacity={isActive ? 1 : 0.75} />
                      </g>
                    )
                  })}
                </g>
              )
            })}

            <circle cx={CX} cy={CY} r={58} fill="url(#hub-glow)" opacity={0.5} className="mycelium-pulse" />
            <circle className="mycelium-hub-core" cx={CX} cy={CY} r={36} fill="#0a0f16" />
            <circle className="mycelium-hub-core" cx={CX} cy={CY} r={36} fill="none" stroke="#22d3ee" strokeWidth={2} opacity={0.7} />
            <text x={CX} y={CY - 4} textAnchor="middle" fontSize={12} fontWeight={800} fill="#eefcff">Interaction Field</text>
            <text x={CX} y={CY + 13} textAnchor="middle" fontSize={9} fill="rgba(226,241,245,.65)">Jarvis vermittelt</text>

            {positions.map(p => (
              <g
                key={p.id}
                onClick={() => {
                  setExpandedSatellite(null)
                  setExpanded(cur => cur === p.id ? null : p.id)
                }}
                onMouseEnter={() => setHoveredNode(p.id)}
                onMouseLeave={() => setHoveredNode(cur => cur === p.id ? null : cur)}
                className={`mycelium-node ${expanded === p.id ? 'active' : ''}`}
                style={{ cursor: 'pointer', color: p.accent }}
              >
                <circle cx={p.x} cy={p.y} r={34} fill={p.accent} opacity={expanded === p.id ? 0.28 : 0} className="mycelium-node-ring" />
                <circle className="mycelium-node-core" cx={p.x} cy={p.y} r={30} fill="#0d141f" stroke={p.accent} strokeWidth={2} />
                <text x={p.x} y={p.y - 3} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#eefcff">{p.label}</text>
                <text x={p.x} y={p.y + 12} textAnchor="middle" fontSize={10} fontWeight={800} fill={p.accent}>{counts[p.id] ?? 0}</text>
              </g>
            ))}
          </g>
        </svg>

        {hoveredSatelliteNode && hoveredSatelliteItem && hoveredSatellitePos ? (
          <div
            className="obs-map-tooltip"
            style={{
              left: `${((hoveredSatellitePos.x - viewBox.x) / viewBox.w) * 100}%`,
              top: `${((hoveredSatellitePos.y - viewBox.y) / viewBox.h) * 100}%`,
            }}
          >
            <div className="obs-map-tooltip-title" style={{ color: hoveredSatelliteNode.accent }}>{hoveredSatelliteNode.label}</div>
            <div className="obs-map-tooltip-excerpt">{hoveredSatelliteItem.label}</div>
            <div className="obs-map-tooltip-meta">{hoveredSatelliteItem.createdAt}</div>
          </div>
        ) : hoveredMainNode ? (
          <div
            className="obs-map-tooltip"
            style={{
              left: `${((hoveredMainNode.x - viewBox.x) / viewBox.w) * 100}%`,
              top: `${((hoveredMainNode.y - viewBox.y) / viewBox.h) * 100}%`,
            }}
          >
            <div className="obs-map-tooltip-title" style={{ color: hoveredMainNode.accent }}>{hoveredMainNode.label}</div>
            <div className="obs-map-tooltip-excerpt">{hoveredMainNode.blurb(counts[hoveredMainNode.id] ?? 0)}</div>
          </div>
        ) : null}

        {detailNode && (
          <div className="mycelium-detail" style={{ borderLeftColor: detailNode.accent }}>
            <span className="mycelium-detail-tag" style={{ color: detailNode.accent }}>#{detailNode.label}</span>
            <span className="mycelium-detail-text">
              {typed}<span className="mycelium-caret">▌</span>
            </span>
            {activeSatelliteItem?.conversationId && onOpenConversation && (
              <button
                className="chat-inspect-toggle"
                style={{ fontSize: 11, padding: 0, alignSelf: 'flex-start' }}
                onClick={() => onOpenConversation(activeSatelliteItem.conversationId!)}
              >
                aus Gespräch ↗
              </button>
            )}
          </div>
        )}
      </div>
      <p style={{ fontSize: 12, color: 'rgba(148,190,199,.6)', textAlign: 'center', marginTop: 4 }}>
        Klick auf einen Knoten für die Zusammenfassung, Klick auf einen Ausläufer für den echten Einzeleintrag dahinter. „Society" ist bewusst nicht dargestellt — es gibt aktuell keine echte Datenquelle dafür, eine erfundene Zahl wäre schlechter als eine ehrliche Lücke.
      </p>
    </div>
  )
}
