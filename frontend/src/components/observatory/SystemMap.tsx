import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders } from '../../lib/adminApi'
import { TOOL_LABELS } from '../../lib/toolLabels'
import { HudSkeleton } from './HudSkeleton'

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

// Age-decay in [0,1]: a fresh record → 1 (bright, long trail), an old one →
// toward 0 (faint, evaporated), like an ant's pheromone path fading. Half-life
// ~7 days so a week-old trail is at half strength — matches the mostly-7d
// Age-decay in [0,1]: a fresh record → 1 (bright, long trail), an old one →
// toward 0 (faint, evaporated), like an ant's pheromone path fading.
function ageDecay(createdAt: string): number {
  const t = Date.parse(createdAt)
  if (Number.isNaN(t)) return 0.5
  const ageMs = Date.now() - t
  if (ageMs <= 0) return 1
  const halfLifeMs = 7 * 24 * 60 * 60 * 1000
  return Math.max(0.12, Math.pow(0.5, ageMs / halfLifeMs))
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
//
// Rendered as a pheromone TRAIL, not a lone dot: `createdAt` drives age-decay
// (older = fainter/shorter, like an ant trail evaporating) and `confidence`
// neutral weight rather than a fabricated one.
interface SatelliteItem {
  id: string
  label: string
  createdAt: string
  conversationId: string | null
  confidence: number | null
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
    confidence: null, // a raw human message carries no strength signal
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
        confidence: failed ? 0.2 : 1, // a failed call is a weak/broken trail
      }
    }
    return {
      id: item.id,
      label: `Antwort von Jarvis: „${item.label}“`,
      createdAt: item.created_at,
      conversationId: item.conversation_id ?? null,
      confidence: typeof item.confidence === 'number' ? item.confidence : null,
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
    confidence: null,
  }))
}

function buildTechnologySatellites(information: any): SatelliteItem[] {
  const rows = Array.isArray(information?.recent_documents) ? information.recent_documents : []
  return rows.map((d: any) => ({
    id: d.id,
    label: `Dokument hochgeladen: „${d.filename}“`,
    createdAt: d.created_at,
    conversationId: null,
    confidence: null,
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
      // Retrieval carries a genuine strength signal: the top similarity score
      // (0..1). A knowledge gap is the weakest possible trail.
      confidence: r.is_gap ? 0.05 : Math.max(0, Math.min(1, Number(r.top_score) || 0)),
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
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null)
  const fgRef = useRef<any>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [dims, setDims] = useState({ w: 800, h: 560 })

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

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setDims({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setDims({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Everything below MUST run unconditionally, on every render, in the same
  // order — including useTypewriter (it calls useState/useEffect internally)
  // and the graphData useMemo. Both used to sit after the `if (!counts)`
  // early return, which is a Rules-of-Hooks violation: the loading render
  // calls N hooks and bails out, the loaded render calls N+2. React throws
  // "Rendered fewer hooks than expected", GraphErrorBoundary catches it, and
  // the panel shows "konnte nicht geladen werden" on every single load —
  // this was the actual crash behind "die laden aber GARNICH nicht", not a
  // backend/data issue (verified: every API this fetches returns 200 even
  // against an empty local DB).
  const maxCount = counts ? Math.max(...Object.values(counts), 1) : 1

  const expandedNode = expanded ? NODES.find(n => n.id === expanded) : null
  const activeSatelliteNode = expandedSatellite ? NODES.find(n => n.id === expandedSatellite.nodeId) : null
  const activeSatelliteItem = expandedSatellite
    ? (satellites[expandedSatellite.nodeId] ?? []).find(s => s.id === expandedSatellite.itemId) ?? null
    : null

  const detailNode = activeSatelliteNode ?? expandedNode
  const detailText = activeSatelliteItem
    ? activeSatelliteItem.label
    : (expandedNode ? expandedNode.blurb(counts?.[expandedNode.id] ?? 0) : '')
  const typed = useTypewriter(detailText, !!detailNode)

  // Hover state comes from ForceGraph2D's onNodeHover (a node id string, or
  // null). Resolve it to the matching core/satellite for the tooltip.
  const hoveredMainNode = hoverNodeId && NODES.some(n => n.id === hoverNodeId)
    ? NODES.find(n => n.id === hoverNodeId) ?? null
    : null
  const hoveredSatelliteNode = hoveredMainNode ? null : (hoverNodeId ? NODES.find(n => hoverNodeId.startsWith(`${n.id}-sat-`)) ?? null : null)
  const hoveredSatelliteItem = hoveredSatelliteNode && hoverNodeId
    ? (satellites[hoveredSatelliteNode.id] ?? []).find(s => `${hoveredSatelliteNode.id}-sat-${s.id}` === hoverNodeId) ?? null
    : null

  // Build force-graph nodes: 5 cores + their satellites (real records).
  const graphData = useMemo(() => {
    const nodes: any[] = NODES.map(n => ({
      id: n.id, label: n.label, accent: n.accent, isCore: true,
      count: counts?.[n.id] ?? 0, size: 14 + Math.min((counts?.[n.id] ?? 0) / maxCount, 1) * 22,
    }))
    const links: any[] = []
    for (const n of NODES) {
      const sats = (satellites[n.id] ?? []).slice(0, 5)
      sats.forEach((s) => {
        const id = `${n.id}-sat-${s.id}`
        nodes.push({
          id, label: s.label, accent: n.accent, isCore: false,
          conf: s.confidence ?? 0.5, decay: ageDecay(s.createdAt),
          conversationId: s.conversationId, createdAt: s.createdAt, size: 4,
        })
        links.push({ source: n.id, target: id })
      })
    }
    return { nodes, links }
  }, [counts, satellites, maxCount])

  if (!counts) {
    if (!API_BASE) {
      return (
        <div className="obs-panel">
          <div className="obs-empty">
            Netzwerk-Darstellung ist live nur auf <a href="https://emergent-interaction-lab.fly.dev/#admin" style={{ color: 'var(--hud-cyan, #22d3ee)' }}>emergent-interaction-lab.fly.dev</a> verfügbar — diese GitHub-Pages-Spiegelung hat keinen Backend-Zugriff.
          </div>
        </div>
      )
    }
    return <div className="obs-panel"><HudSkeleton /></div>
  }

  const nodePaint = (node: any, ctx: CanvasRenderingContext2D) => {
    const x = node.x ?? 0, y = node.y ?? 0
    const r = node.size ?? 6
    if (node.isCore) {
      // glow + labeled core
      ctx.beginPath(); ctx.arc(x, y, r + 8, 0, 2 * Math.PI)
      ctx.fillStyle = node.accent + '22'; ctx.fill()
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI)
      ctx.fillStyle = '#0d141f'; ctx.fill()
      ctx.lineWidth = 2.5; ctx.strokeStyle = node.accent; ctx.stroke()
      ctx.font = '700 12px "SF Mono", Consolas, monospace'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillStyle = '#eefcff'; ctx.fillText(node.label, x, y - 2)
      ctx.fillStyle = node.accent; ctx.font = '800 12px "SF Mono", Consolas, monospace'
      ctx.fillText(String(node.count), x, y + 14)
    } else {
      // satellite dot — confidence/age encoded as glow + alpha
      const a = 0.22 + (node.decay ?? 0.5) * 0.5
      ctx.beginPath(); ctx.arc(x, y, r + 3, 0, 2 * Math.PI)
      ctx.fillStyle = node.accent + '33'; ctx.fill()
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI)
      ctx.fillStyle = node.accent; ctx.globalAlpha = a; ctx.fill(); ctx.globalAlpha = 1
    }
  }

  return (
    <div className="obs-panel">
      <div className="obs-card obs-map-card mycelium-card" ref={wrapRef} style={{ height: '74vh', minHeight: 420, overflow: 'hidden' }}>
        {/* Always-visible legend — what the diagram below actually shows,
            before any hovering/clicking. One line per node, same accent
            color as its dot/thread, so the mapping between "this colored
            thing" and "this is what it means" doesn't require guessing. */}
        <div className="mycelium-legend" style={{ position: 'absolute', left: 14, top: 14, right: 'auto', maxWidth: 380, zIndex: 5, pointerEvents: 'none' }}>
          <span className="mycelium-legend-title">Was zeigt dieses Netzwerk?</span>
          <span className="mycelium-legend-sub">Jeder Knoten ist ein Teilsystem; die Ausläufer sind Pheromon-Spuren echter Einzelereignisse — Länge/Helligkeit = Alter (frisch → hell, alt → verblasst), Dicke/Leuchten = Konfidenz. Knoten oder Spur anklicken für Details.</span>
          <div className="mycelium-legend-items">
            {NODES.map(n => (
              <span key={n.id} className="mycelium-legend-item">
                <span className="mycelium-legend-dot" style={{ background: n.accent }} />
                <strong>{n.label}</strong>: {n.legend}
              </span>
            ))}
          </div>
        </div>

        <ForceGraph2D
          ref={fgRef}
          width={dims.w}
          height={dims.h}
          graphData={graphData}
          backgroundColor="rgba(0,0,0,0)"
          nodeRelSize={1}
          nodeCanvasObject={nodePaint}
          nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
            const r = (node.size ?? 6) + 6
            ctx.fillStyle = color
            ctx.beginPath(); ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI); ctx.fill()
          }}
          linkColor={() => 'rgba(148,197,214,.18)'}
          linkWidth={1}
          onNodeHover={(node: any) => setHoverNodeId(node ? node.id : null)}
          cooldownTicks={140}
          onNodeClick={(node: any) => {
            try {
              if (node?.isCore) {
                setExpandedSatellite(null)
                setExpanded(cur => cur === node.id ? null : node.id)
              } else {
                const [nodeId] = String(node?.id ?? '').split('-sat-')
                const itemId = String(node?.id ?? '').split('-sat-')[1]
                setExpanded(null)
                setExpandedSatellite(cur => (cur && cur.itemId === itemId ? null : { nodeId, itemId }))
              }
            } catch { /* ignore click errors — never crash the OS on a node click */ }
          }}
          onNodeDragEnd={(node: any) => { node.fx = node.x; node.fy = node.y }}
        />

        {hoveredSatelliteNode && hoveredSatelliteItem ? (
          <div className="obs-map-tooltip" style={{ position: 'absolute', right: 14, top: 14, left: 'auto', zIndex: 6, maxWidth: 320 }}>
            <div className="obs-map-tooltip-title" style={{ color: hoveredSatelliteNode.accent }}>{hoveredSatelliteNode.label}</div>
            <div className="obs-map-tooltip-excerpt">{hoveredSatelliteItem.label}</div>
            <div className="obs-map-tooltip-meta">{hoveredSatelliteItem.createdAt}</div>
          </div>
        ) : hoveredMainNode ? (
          <div className="obs-map-tooltip" style={{ position: 'absolute', right: 14, top: 14, left: 'auto', zIndex: 6, maxWidth: 320 }}>
            <div className="obs-map-tooltip-title" style={{ color: hoveredMainNode.accent }}>{hoveredMainNode.label}</div>
            <div className="obs-map-tooltip-excerpt">{hoveredMainNode.blurb(counts[hoveredMainNode.id] ?? 0)}</div>
          </div>
        ) : null}

        {detailNode && (
          <div className="mycelium-detail" style={{ borderLeftColor: detailNode.accent, position: 'absolute', right: 14, bottom: 14, left: 'auto', maxWidth: 360, zIndex: 6 }}>
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
