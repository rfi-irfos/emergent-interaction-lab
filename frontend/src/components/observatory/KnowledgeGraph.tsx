import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { API_BASE } from '../../lib/apiBase'
import { adminFetch } from '../../lib/adminApi'
import { HudSkeleton } from './HudSkeleton'
import { tuneForceGraph, resolveThemeColor, resolveAccentColor } from '../../lib/forceGraphTuning'
import { useForceGraphPopupAnchor } from '../../hooks/useForceGraphPopupAnchor'

// Node core radius, shared between the canvas painter and the collision
// force below so "how big a node LOOKS" and "how much space it RESERVES"
// never drift apart.
function nodeCoreRadius(node: any): number {
  return 8 + Math.min(node.count ?? 0, 20) * 0.9
}
// Collision radius = core bubble + an estimate of the label's half-width
// (monospace-ish ~6.2px/char at the 11px font nodePaint uses) + the count
// line below it. This is what was missing entirely before: with no
// collision force at all, d3-force only keeps NODE CENTERS apart via
// charge/link forces, which does nothing to stop two labels' TEXT from
// drawing on top of each other once there are more than a handful of nodes
// — exactly the "15-20 labels stacked illegibly" bug. A per-node radius
// (not one fixed value) means a long label like "KI-Systeme und Treiber der
// Emergenz" reserves real room, and a short one like "Docs" doesn't waste it.
function nodeCollideRadius(node: any): number {
  const label = String(node.label ?? '')
  const halfLabelWidth = (label.length * 6.2) / 2
  return Math.max(nodeCoreRadius(node) + 10, halfLabelWidth + 6)
}

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
    const res = await adminFetch(`${path}`, {})
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

  // Everything below MUST run unconditionally, in the same order, on every
  // render — including the two useMemo calls further down. They used to sit
  // after the error/loading early returns, which is a Rules-of-Hooks
  // violation: the loading render calls N hooks and bails out, the loaded
  // render calls N+2. React throws error #310 ("Rendered more hooks than
  // during the previous render"), GraphErrorBoundary catches it, and the
  // panel shows "Knowledge Graph konnte nicht geladen werden." on every
  // single load — this was the actual crash behind "die laden aber GARNICH
  // nicht" (verified live: same class of bug found+fixed in SystemMap.tsx).
  // every edge below is inferred from shared fields, not a curated linkage.
  const safeSignals = signals ?? []
  const safePosts = posts ?? []
  const safeNotes = notes ?? []
  const safeDocs = docs ?? []

  const scopeNames = Array.from(new Set(safeSignals.map(s => s.scope).filter((s): s is string => !!s)))
  const scopeSignalCount = (scope: string) => safeSignals.filter(s => s.scope === scope).length
  const scopeConvIds = (scope: string) => new Set(safeSignals.filter(s => s.scope === scope).map(s => s.source_conversation_id).filter(Boolean))
  const linkedPosts = (scope: string) => {
    const convIds = scopeConvIds(scope)
    return safePosts.filter(p => p.source_conversation_id && convIds.has(p.source_conversation_id))
  }

  // Real per-item records behind each node — this is the actual drill-down
  // content (title/excerpt/timestamp/conversation-link), not just the
  // aggregate count the node bubble already shows.
  const scopeItems = (scope: string): DetailItem[] => {
    const sigItems: DetailItem[] = safeSignals
      .filter(s => s.scope === scope)
      .map(s => ({ id: s.id, kind: 'signal', title: s.pattern, excerpt: s.observation, timestamp: s.created_at, conversationId: s.source_conversation_id }))
    const postItems: DetailItem[] = linkedPosts(scope)
      .map(p => ({ id: p.id, kind: 'post', title: p.title, excerpt: p.body, timestamp: p.updated_at, conversationId: p.source_conversation_id }))
    return [...sigItems, ...postItems]
  }
  const noteItems: DetailItem[] = safeNotes.map(n => ({ id: n.id, kind: 'note', title: n.title, excerpt: n.body, timestamp: n.updated_at, conversationId: n.source_conversation_id }))
  const docItems: DetailItem[] = safeDocs.map(d => ({ id: d.id, kind: 'doc', title: d.filename, excerpt: '', timestamp: d.created_at, conversationId: null }))

  const hub = { id: 'hub', label: 'Wissensbestand', accent: 'var(--hud-cyan, #22d3ee)', count: 0, kind: 'hub' as const, scope: null as string | null }
  const scopeNodes = scopeNames.map((scope, i) => ({ id: `scope-${i}`, label: scope, kind: 'scope' as const, accent: 'var(--hud-cyan, #22d3ee)', count: scopeSignalCount(scope), scope }))
  const noteNode = { id: 'notes', label: 'Research Notes', kind: 'notes' as const, accent: 'var(--obs-purple, #8b5cf6)', count: safeNotes.length, scope: null as string | null }
  const docNode = { id: 'docs', label: 'Dokumente', kind: 'docs' as const, accent: 'var(--obs-green, #10b981)', count: safeDocs.length, scope: null as string | null }
  const nodes = [hub, ...scopeNodes, noteNode, docNode] as Array<{ id: string; label: string; accent: string; count: number; kind: any; scope: string | null }>

  // `linkedPosts` count per scope actually drives the rendered stroke width
  // below (see `linkWidth`) — the caption under the graph claims "Kantenstärke
  // = Anzahl verknüpfter Blogposts", but until this, every edge was drawn at
  // the same hardcoded 1.2px regardless of `value` because nothing set it:
  // the caption described an encoding the graph never actually drew. Notes
  // and docs nodes have no "linked posts" concept, so they get a plain 0.
  const links = useMemo(() => {
    const ls: any[] = []
    for (const n of nodes) {
      if (n.id === 'hub') continue
      const value = n.kind === 'scope' && n.scope ? linkedPosts(n.scope).length : 0
      ls.push({ source: 'hub', target: n.id, value })
    }
    return ls
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, safePosts, safeSignals])

  const graphData = useMemo(() => ({ nodes: nodes.map(n => ({ ...n })), links }), [nodes, links])

  // Tune the physics as soon as data lands (or changes) and after the graph
  // has had one paint to mount — no collision force at all was the actual
  // bug behind the illegible stacked-label screenshot, see forceGraphTuning.ts.
  useEffect(() => {
    const id = window.setTimeout(() => tuneForceGraph(fgRef.current, nodeCollideRadius), 0)
    return () => window.clearTimeout(id)
  }, [graphData])

  // IMPORTANT: read the live node off `graphData.nodes` (the exact array
  // instance handed to ForceGraph2D, which the simulation mutates in place
  // with real x/y every tick), never off the plain `nodes` list above —
  // that one is rebuilt fresh every render via `.map(n => ({...n}))` and
  // never carries simulation coordinates, which is exactly why the old
  // "anchored" detail popup had nothing real to anchor to and fell back to
  // a fixed corner. Called unconditionally, before the early returns below,
  // same Rules-of-Hooks reasoning as the rest of this file.
  // Cast to `any`: ForceGraph2D mutates each node object in place with real
  // x/y every simulation tick, but the plain node type above (built for the
  // React render, not the graph engine) never declared those fields.
  const liveExpandedNode = (expanded ? graphData.nodes.find(n => n.id === expanded) : null) as { x?: number; y?: number; id?: string } | null
  const popupPos = useForceGraphPopupAnchor(fgRef, liveExpandedNode)

  if (error && !API_BASE) {
    return (
      <div className="obs-panel">
        <div className="obs-empty">
          Netzwerk-Darstellung ist live nur auf <a href="https://eil.fly.dev/#admin" style={{ color: 'var(--hud-cyan, #22d3ee)' }}>eil.fly.dev</a> verfügbar — diese GitHub-Pages-Spiegelung hat keinen Backend-Zugriff.
        </div>
      </div>
    )
  }
  if (error) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>
  if (!signals || !posts || !notes || !docs) return <div className="obs-panel"><HudSkeleton /></div>

  const itemsForNode = (node: any | null | undefined): DetailItem[] =>
    node?.kind === 'scope' && node.scope ? scopeItems(node.scope)
      : node?.kind === 'notes' ? noteItems
      : node?.kind === 'docs' ? docItems
      : []

  const expandedNode = expanded ? nodes.find(p => p.id === expanded) : null
  const expandedLinkedPosts = expandedNode?.scope ? linkedPosts(expandedNode.scope) : []
  const expandedItems: DetailItem[] = itemsForNode(expandedNode)

  // Resolved once per paint (not per node) — canvas fillStyle needs a real
  // computed color, not a literal `var(--x)` string; see forceGraphTuning.ts's
  // resolveThemeColor doc comment for why this used to be a permanent-dark
  // `#0d141f`/`#eefcff` pair regardless of the active theme.
  //
  // `globalScale` (react-force-graph-2d's 3rd nodeCanvasObject arg, see
  // node_modules/force-graph/dist/force-graph.mjs's `state.nodeCanvasObject(
  // node, ctx, state.globalScale)`) was never read here before — the label
  // font was a fixed 11px in GRAPH coordinate space, not screen space. With
  // only ~5-20 nodes, `onEngineStop`'s `zoomToFit` zooms in hard to fill the
  // canvas, and the canvas context is already transformed for that zoom by
  // the time this paints — so the "11px" text actually rendered at
  // 11×globalScale real screen pixels, ballooning past its own node circle
  // and stacking illegibly on top of neighboring nodes/labels. This is the
  // actual mechanism behind the reported "overlapping/unreadable labels"
  // bug (confirmed live: a 5-node graph zoomed to fit rendered ~40px text
  // from a 12px font declaration). Dividing by `globalScale` keeps the
  // label a constant, legible size on screen at any zoom level — the node
  // circle itself intentionally stays in graph space (so it still scales
  // with zoom, matching the collision force which also operates in graph
  // space).
  const nodePaint = (node: any, ctx: CanvasRenderingContext2D, globalScale = 1) => {
    const r = nodeCoreRadius(node)
    const x = node.x ?? 0, y = node.y ?? 0
    const fontScale = Math.max(globalScale, 0.0001)
    // Fallbacks are the LIGHT-theme defaults, not the old dark literals —
    // `--gotham-panel`/`--gotham-text` only exist while `.gotham` is applied
    // (dark/hc, see App.css's ADMIN SHELL THEME section), so an empty
    // getComputedStyle read here means "we're in light mode," same as
    // `.hud-tile`'s own `var(--gotham-panel, #ffffff)` convention.
    const chipBg = resolveThemeColor(wrapRef.current, '--gotham-panel', '#ffffff')
    const labelColor = resolveThemeColor(wrapRef.current, '--gotham-text', '#111827')
    const accent = resolveAccentColor(wrapRef.current, node.accent)
    // glow
    ctx.beginPath()
    ctx.arc(x, y, r + 6, 0, 2 * Math.PI)
    ctx.fillStyle = accent + '22'
    ctx.fill()
    // core
    ctx.beginPath()
    ctx.arc(x, y, r, 0, 2 * Math.PI)
    ctx.fillStyle = chipBg
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = accent
    ctx.stroke()
    // label — font size divided by globalScale, see the doc comment above
    ctx.font = `600 ${11 / fontScale}px "SF Mono", Consolas, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = labelColor
    ctx.fillText(node.label, x, y - 2 / fontScale)
    ctx.fillStyle = accent
    ctx.font = `800 ${11 / fontScale}px "SF Mono", Consolas, monospace`
    ctx.fillText(String(node.count), x, y + 12 / fontScale)
  }

  return (
    <div className="obs-panel">
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
            const r = nodeCoreRadius(node) + 6
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI)
            ctx.fill()
          }}
          linkColor={() => resolveThemeColor(wrapRef.current, '--hud-cyan', '#22d3ee') + '52'}
          linkWidth={(link: any) => 1.2 + Math.min(link.value ?? 0, 8) * 0.9}
          cooldownTicks={120}
          onEngineStop={() => { try { fgRef.current?.zoomToFit?.(400, 46) } catch { /* canvas may already be unmounted */ } }}
          onNodeClick={(node: any) => { try { setExpanded(cur => cur === node?.id ? null : node?.id) } catch { /* ignore click errors */ } }}
          // No onNodeDrag handler — see forceGraphTuning.ts's comment on the
          // removed reheatOnDrag: the library's own drag handler already
          // keeps the sim ticking + gently warm during a drag; an app-side
          // reheat on top of that was the actual "drag breaks mid-gesture"
          // bug (forced alpha=1 every tick, fighting the library's steady
          // alphaTarget(0.3)).
          onNodeDragEnd={(node: any) => { node.fx = node.x; node.fy = node.y }}
        />

        {/* Anchored to the real clicked node's live screen position (see
            useForceGraphPopupAnchor) — not a fixed corner. A CSS-triangle
            tail plus a translate that keeps the card fully on-canvas even
            near an edge makes the "this popup belongs to that node" link
            visually obvious without hunting for a thin connector line. */}
        {expandedNode && popupPos && (
          <div
            className="mycelium-detail mycelium-detail-anchored"
            style={{
              borderColor: expandedNode.accent,
              position: 'absolute',
              left: Math.min(Math.max(popupPos.x, 190), dims.w - 190),
              top: Math.min(Math.max(popupPos.y + 22, 14), dims.h - 40),
              transform: 'translateX(-50%)',
              right: 'auto',
              maxWidth: 360,
              zIndex: 5,
            }}
          >
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
                  <div className="mycelium-detail-item" key={`${item.kind}-${item.id}`} style={{ borderColor: expandedNode.accent }}>
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
      <p style={{ fontSize: 12, color: 'var(--gotham-text-dim, #6b7280)', textAlign: 'center', marginTop: 4 }}>
        Kantenstärke = Anzahl über die Gesprächs-ID verknüpfter Blogposts. Klick auf einen Knoten für die echten Einzeleinträge dahinter.
      </p>
    </div>
  )
}
