import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders } from '../../lib/adminApi'
import { HudSkeleton } from './HudSkeleton'

interface SignalRow { id: string; pattern: string; observation: string; scope: string | null; source_conversation_id: string | null; created_at: string }
interface BlogRow { id: string; title: string; body: string; source_conversation_id: string | null; updated_at: string }
interface NoteRow { id: string; category: string; title: string; body: string; source_conversation_id: string | null; updated_at: string }
interface DocRow { id: string; filename: string; created_at: string }

const KIND_LABEL: Record<DetailItem['kind'], string> = {
  signal: 'Signal', post: 'Blogpost', note: 'Research Note', doc: 'Dokument',
}

interface DetailItem {
  id: string
  kind: 'signal' | 'post' | 'note' | 'doc'
  title: string
  excerpt: string
  timestamp: string
  conversationId: string | null
}

function truncate(text: string, len = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > len ? `${clean.slice(0, len)}…` : clean
}

// Unlike useAdminFetch (see lib/adminApi.ts), this graph fans out four
// requests in parallel and merges them, so a single {data, loading, error}
// triple doesn't fit — each call reports its own success/failure instead of
// silently collapsing a failure into "[]", which used to be indistinguishable
// from a genuinely empty knowledge base.
async function fetchJson(path: string): Promise<{ data: any; error: boolean }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() })
    return res.ok ? { data: await res.json(), error: false } : { data: null, error: true }
  } catch {
    return { data: null, error: true }
  }
}

/// Real entities (emergence-signal scopes, blog posts, research notes,
/// documents), connected by a heuristic — shared scope, or a blog post
/// sharing a source_conversation_id with a signal — not a genuine
/// relationship-graph engine (none exists in this codebase). Per Laura's own
/// rule for anything not-yet-real: show it with real data, tag it as a
/// placeholder, and let that tag disappear the moment a real graph backend
/// exists rather than leaving a stale disclaimer around forever. Today that
/// condition is always true (no such backend exists yet), so the tag always
/// shows — the check itself is what needs to change, not the tag's text.
export function KnowledgeGraph({ onOpenConversation }: { onOpenConversation?: (conversationId: string) => void } = {}) {
  const [signals, setSignals] = useState<SignalRow[] | null>(null)
  const [posts, setPosts] = useState<BlogRow[] | null>(null)
  const [notes, setNotes] = useState<NoteRow[] | null>(null)
  const [docs, setDocs] = useState<DocRow[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const fgRef = useRef<any>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [dims, setDims] = useState({ w: 800, h: 560 })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [s, p, n, d] = await Promise.all([
        fetchJson('/api/observatory/emergence/signals'),
        fetchJson('/api/blog/posts'),
        fetchJson('/api/research/items?category=paper,hypothesis,idea,concept,framework,prototype'),
        fetchJson('/api/chat/documents'),
      ])
      if (cancelled) return
      if (s.error || p.error || n.error || d.error) setError(true)
      setSignals(s.data ?? [])
      setPosts(p.data ?? [])
      setNotes(n.data ?? [])
      setDocs(d.data ?? [])
    })()
    return () => { cancelled = true }
  }, [])

  const [error, setError] = useState(false)

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

  if (error && !API_BASE) {
    return (
      <div className="obs-panel">
        <div className="obs-empty">
          Netzwerk-Darstellung ist live nur auf <a href="https://emergent-interaction-lab.fly.dev/#admin" style={{ color: 'var(--hud-cyan, #22d3ee)' }}>emergent-interaction-lab.fly.dev</a> verfügbar — diese GitHub-Pages-Spiegelung hat keinen Backend-Zugriff.
        </div>
      </div>
    )
  }
  if (error) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>
  if (!signals || !posts || !notes || !docs) return <div className="obs-panel"><HudSkeleton /></div>
  // every edge below is inferred from shared fields, not a curated linkage.
  // The day a real relationship store exists, swap this constant for that
  // check and the placeholder tag disappears on its own.
  const usingHeuristicEdges = true

  const scopeNames = Array.from(new Set(signals.map(s => s.scope).filter((s): s is string => !!s)))
  const scopeSignalCount = (scope: string) => signals.filter(s => s.scope === scope).length
  const scopeConvIds = (scope: string) => new Set(signals.filter(s => s.scope === scope).map(s => s.source_conversation_id).filter(Boolean))
  const linkedPosts = (scope: string) => {
    const convIds = scopeConvIds(scope)
    return posts.filter(p => p.source_conversation_id && convIds.has(p.source_conversation_id))
  }

  // Real per-item records behind each node — this is the actual drill-down
  // content (title/excerpt/timestamp/conversation-link), not just the
  // aggregate count the node bubble already shows.
  const scopeItems = (scope: string): DetailItem[] => {
    const sigItems: DetailItem[] = signals
      .filter(s => s.scope === scope)
      .map(s => ({ id: s.id, kind: 'signal', title: s.pattern, excerpt: s.observation, timestamp: s.created_at, conversationId: s.source_conversation_id }))
    const postItems: DetailItem[] = linkedPosts(scope)
      .map(p => ({ id: p.id, kind: 'post', title: p.title, excerpt: p.body, timestamp: p.updated_at, conversationId: p.source_conversation_id }))
    return [...sigItems, ...postItems]
  }
  const noteItems: DetailItem[] = notes.map(n => ({ id: n.id, kind: 'note', title: n.title, excerpt: n.body, timestamp: n.updated_at, conversationId: n.source_conversation_id }))
  const docItems: DetailItem[] = docs.map(d => ({ id: d.id, kind: 'doc', title: d.filename, excerpt: '', timestamp: d.created_at, conversationId: null }))

  const hub = { id: 'hub', label: 'Wissensbestand', accent: '#22d3ee', count: 0, kind: 'hub' as const, scope: null as string | null }
  const scopeNodes = scopeNames.map((scope, i) => ({ id: `scope-${i}`, label: scope, kind: 'scope' as const, accent: '#22d3ee', count: scopeSignalCount(scope), scope }))
  const noteNode = { id: 'notes', label: 'Research Notes', kind: 'notes' as const, accent: '#8b5cf6', count: notes.length, scope: null as string | null }
  const docNode = { id: 'docs', label: 'Dokumente', kind: 'docs' as const, accent: '#10b981', count: docs.length, scope: null as string | null }
  const nodes = [hub, ...scopeNodes, noteNode, docNode] as Array<{ id: string; label: string; accent: string; count: number; kind: any; scope: string | null }>

  const links = useMemo(() => {
    const ls: any[] = []
    for (const n of nodes) {
      if (n.id === 'hub') continue
      ls.push({ source: 'hub', target: n.id })
    }
    return ls
  }, [nodes.length])

  const graphData = useMemo(() => ({ nodes: nodes.map(n => ({ ...n })), links }), [nodes, links])

  const itemsForNode = (node: any | null | undefined): DetailItem[] =>
    node?.kind === 'scope' && node.scope ? scopeItems(node.scope)
      : node?.kind === 'notes' ? noteItems
      : node?.kind === 'docs' ? docItems
      : []

  const expandedNode = expanded ? nodes.find(p => p.id === expanded) : null
  const expandedLinkedPosts = expandedNode?.scope ? linkedPosts(expandedNode.scope) : []
  const expandedItems: DetailItem[] = itemsForNode(expandedNode)

  const nodePaint = (node: any, ctx: CanvasRenderingContext2D) => {
    const r = 8 + Math.min(node.count, 20) * 0.9
    const x = node.x ?? 0, y = node.y ?? 0
    // glow
    ctx.beginPath()
    ctx.arc(x, y, r + 6, 0, 2 * Math.PI)
    ctx.fillStyle = node.accent + '22'
    ctx.fill()
    // core
    ctx.beginPath()
    ctx.arc(x, y, r, 0, 2 * Math.PI)
    ctx.fillStyle = '#0d141f'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = node.accent
    ctx.stroke()
    // label
    ctx.font = '600 11px "SF Mono", Consolas, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#eefcff'
    ctx.fillText(node.label, x, y - 2)
    ctx.fillStyle = node.accent
    ctx.font = '800 11px "SF Mono", Consolas, monospace'
    ctx.fillText(String(node.count), x, y + 12)
  }

  return (
    <div className="obs-panel">
      {usingHeuristicEdges && (
        <div className="obs-placeholder-tag">
          (Platzhalter — heuristische Verknüpfung über gemeinsame Gesprächs-ID/Scope, keine echte Graph-Analyse)
        </div>
      )}
      <div className="obs-card obs-map-card mycelium-card" ref={wrapRef} style={{ height: '74vh', minHeight: 420, overflow: 'hidden' }}>
        <ForceGraph2D
          ref={fgRef}
          width={dims.w}
          height={dims.h}
          graphData={graphData}
          backgroundColor="rgba(0,0,0,0)"
          nodeRelSize={1}
          nodeCanvasObject={nodePaint}
          nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
            const r = 8 + Math.min(node.count, 20) * 0.9 + 6
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI)
            ctx.fill()
          }}
          linkColor={() => 'rgba(34,211,238,.22)'}
          linkWidth={1.2}
          cooldownTicks={120}
          onNodeClick={(node: any) => { try { setExpanded(cur => cur === node?.id ? null : node?.id) } catch { /* ignore click errors */ } }}
          onNodeDragEnd={(node: any) => { node.fx = node.x; node.fy = node.y }}
        />

        {expandedNode && (
          <div className="mycelium-detail" style={{ borderLeftColor: expandedNode.accent, position: 'absolute', right: 14, top: 14, left: 'auto', maxWidth: 360, zIndex: 5 }}>
            <span className="mycelium-detail-tag" style={{ color: expandedNode.accent }}>#{expandedNode.label}</span>
            <span className="mycelium-detail-text">
              {expandedNode.kind === 'scope' && (
                expandedLinkedPosts.length > 0
                  ? `${expandedNode.count} Emergenz-Signale · verknüpft mit ${expandedLinkedPosts.length} Blogpost(s)`
                  : `${expandedNode.count} Emergenz-Signale · noch keine verknüpften Blogposts aus diesem Gesprächskontext.`
              )}
              {expandedNode.kind === 'notes' && `${expandedNode.count} Research Notes im Bestand.`}
              {expandedNode.kind === 'docs' && `${expandedNode.count} hochgeladene Dokumente.`}
            </span>

            {expandedItems.length > 0 && (
              <div className="mycelium-detail-list">
                {expandedItems.map(item => (
                  <div className="mycelium-detail-item" key={`${item.kind}-${item.id}`} style={{ borderLeftColor: expandedNode.accent }}>
                    <div className="mycelium-detail-item-title">{KIND_LABEL[item.kind]}: {item.title}</div>
                    {item.excerpt && <div className="mycelium-detail-item-excerpt">{truncate(item.excerpt)}</div>}
                    <div className="mycelium-detail-item-meta">
                      {item.timestamp}
                      {item.conversationId && onOpenConversation && (
                        <>
                          {' · '}
                          <button
                            className="chat-inspect-toggle"
                            style={{ fontSize: 11, padding: 0 }}
                            onClick={() => onOpenConversation(item.conversationId!)}
                          >
                            aus Gespräch ↗
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <p style={{ fontSize: 12, color: 'rgba(148,190,199,.6)', textAlign: 'center', marginTop: 4 }}>
        Kantenstärke = Anzahl über die Gesprächs-ID verknüpfter Blogposts. Klick auf einen Knoten für die echten Einzeleinträge dahinter.
      </p>
    </div>
  )
}
