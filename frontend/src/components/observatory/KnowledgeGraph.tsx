import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders } from '../../lib/adminApi'

interface SignalRow { id: string; pattern: string; observation: string; scope: string | null; source_conversation_id: string | null; created_at: string }
interface BlogRow { id: string; title: string; body: string; source_conversation_id: string | null; updated_at: string }
interface NoteRow { id: string; category: string; title: string; body: string; source_conversation_id: string | null; updated_at: string }
interface DocRow { id: string; filename: string; created_at: string }

const CX = 300, CY = 230, R = 160

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
      setSignals(s ?? [])
      setPosts(p ?? [])
      setNotes(n ?? [])
      setDocs(d ?? [])
    })()
    return () => { cancelled = true }
  }, [])

  if (!signals || !posts || !notes || !docs) return <div className="obs-panel"><div className="obs-empty">Graph wird aufgebaut…</div></div>

  // Real relationship engine does not exist anywhere in this codebase —
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

  const nodes = [
    ...scopeNames.map((scope, i) => ({ id: `scope-${i}`, label: scope, kind: 'scope' as const, accent: '#22d3ee', count: scopeSignalCount(scope), scope })),
    { id: 'notes', label: 'Research Notes', kind: 'notes' as const, accent: '#8b5cf6', count: notes.length, scope: null },
    { id: 'docs', label: 'Dokumente', kind: 'docs' as const, accent: '#10b981', count: docs.length, scope: null },
  ]

  const positions = nodes.map((n, i) => {
    const angle = (-90 + i * (360 / nodes.length)) * (Math.PI / 180)
    return { ...n, x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) }
  })

  const expandedNode = expanded ? positions.find(p => p.id === expanded) : null
  const expandedLinkedPosts = expandedNode?.scope ? linkedPosts(expandedNode.scope) : []
  const expandedItems: DetailItem[] =
    expandedNode?.kind === 'scope' && expandedNode.scope ? scopeItems(expandedNode.scope)
    : expandedNode?.kind === 'notes' ? noteItems
    : expandedNode?.kind === 'docs' ? docItems
    : []

  return (
    <div className="obs-panel">
      {usingHeuristicEdges && (
        <div className="obs-placeholder-tag">
          (Platzhalter — heuristische Verknüpfung über gemeinsame Gesprächs-ID/Scope, keine echte Graph-Analyse)
        </div>
      )}
      <div className="obs-card obs-map-card mycelium-card">
        <svg viewBox="0 0 600 460" style={{ width: '100%', maxWidth: 640, display: 'block', margin: '0 auto' }} aria-hidden="true">
          <circle cx={CX} cy={CY} r={34} fill="#0a0f16" stroke="#22d3ee" strokeWidth={2} opacity={0.5} />
          <text x={CX} y={CY + 4} textAnchor="middle" fontSize={10} fill="rgba(226,241,245,.7)">Wissensbestand</text>

          {positions.map((p, pi) => {
            const linked = p.kind === 'scope' && p.scope ? linkedPosts(p.scope).length : 0
            const opacity = 0.3 + Math.min(linked, 4) * 0.12
            return (
              <g key={`edge-${p.id}`}>
                <line x1={CX} y1={CY} x2={p.x} y2={p.y} stroke={p.accent} strokeWidth={1 + Math.min(linked, 4)} opacity={opacity} />
                {linked > 0 && (
                  <circle r="3" fill={p.accent}>
                    <animateMotion dur={`${3 + hash(pi) * 2}s`} repeatCount="indefinite" path={`M ${CX} ${CY} L ${p.x} ${p.y}`} />
                  </circle>
                )}
              </g>
            )
          })}

          {positions.map(p => (
            <g key={p.id} onClick={() => setExpanded(cur => cur === p.id ? null : p.id)} style={{ cursor: 'pointer' }}>
              <circle cx={p.x} cy={p.y} r={28} fill="#0d141f" stroke={p.accent} strokeWidth={2} style={{ filter: `drop-shadow(0 0 6px ${p.accent}66)` }} />
              <text x={p.x} y={p.y - 3} textAnchor="middle" fontSize={9} fontWeight={700} fill="#eefcff">{p.label}</text>
              <text x={p.x} y={p.y + 12} textAnchor="middle" fontSize={10} fontWeight={800} fill={p.accent}>{p.count}</text>
            </g>
          ))}
        </svg>

        {expandedNode && (
          <div className="mycelium-detail" style={{ borderLeftColor: expandedNode.accent }}>
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
