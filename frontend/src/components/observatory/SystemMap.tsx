import { useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders } from '../../lib/adminApi'

const NODES = [
  { id: 'human', label: 'Human', accent: '#22d3ee', blurb: (n: number) => `${n} Beobachtungen — Nutzer-Nachrichten aus Forschungsgesprächen mit Laura.` },
  { id: 'ai', label: 'AI Systems', accent: '#8b5cf6', blurb: (n: number) => `${n} Beobachtungen — Antworten und Werkzeugaufrufe von Jarvis.` },
  { id: 'organization', label: 'Organization', accent: '#f59e0b', blurb: (n: number) => `${n} Beobachtungen — Research Notes, Blogpost-Entwürfe und Simulationsläufe.` },
  { id: 'technology', label: 'Technology', accent: '#10b981', blurb: (n: number) => `${n} Beobachtungen — hochgeladene Dokumente und daraus erzeugte Chunks.` },
  { id: 'information', label: 'Information Dynamics', accent: '#14b8a6', blurb: (n: number) => `${n} Beobachtungen — Retrieval-Aktivität über alle Gespräche hinweg.` },
]

const CX = 300, CY = 230, R = 168

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
export function SystemMap() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [analytics, humanAi, information, diagnostics] = await Promise.all([
        fetchJson('/api/analytics'),
        fetchJson('/api/observatory/human-ai'),
        fetchJson('/api/observatory/information'),
        fetchJson('/api/observatory/diagnostics'),
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
    })()
    return () => { cancelled = true }
  }, [])

  const positions = useMemo(() => NODES.map((n, i) => {
    const angle = (-90 + i * (360 / NODES.length)) * (Math.PI / 180)
    return { ...n, x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle), angle }
  }), [])

  const expandedNode = expanded ? NODES.find(n => n.id === expanded) : null
  const typed = useTypewriter(expandedNode ? expandedNode.blurb(counts?.[expandedNode.id] ?? 0) : '', !!expandedNode)

  if (!counts) return <div className="obs-panel"><div className="obs-empty">Netzwerk wächst…</div></div>

  const maxCount = Math.max(...Object.values(counts), 1)

  return (
    <div className="obs-panel">
      <div className="obs-card obs-map-card mycelium-card">
        <svg viewBox="0 0 600 460" style={{ width: '100%', maxWidth: 640, display: 'block', margin: '0 auto' }} aria-hidden="true">
          <defs>
            <radialGradient id="hub-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
            </radialGradient>
          </defs>

          {positions.map((p, pi) => {
            const weight = counts[p.id] ?? 0
            const w = 1 + (weight / maxCount) * 4
            const opacity = 0.28 + (weight / maxCount) * 0.5
            // Organic thread: a gentle bezier bow instead of a straight line.
            const mx = (CX + p.x) / 2 + Math.sin(pi * 2.1) * 22
            const my = (CY + p.y) / 2 + Math.cos(pi * 2.1) * 22
            const satelliteCount = Math.min(5, Math.round((weight / maxCount) * 5))
            return (
              <g key={`edge-${p.id}`}>
                <path id={`obs-map-path-${p.id}`} d={`M ${CX} ${CY} Q ${mx} ${my} ${p.x} ${p.y}`} fill="none" stroke={p.accent} strokeWidth={w + 5} opacity={opacity * 0.2} style={{ filter: 'blur(4px)' }} />
                <path d={`M ${CX} ${CY} Q ${mx} ${my} ${p.x} ${p.y}`} fill="none" stroke={p.accent} strokeWidth={w} opacity={opacity} strokeLinecap="round" />
                <circle r="3.5" fill={p.accent}>
                  <animateMotion dur={`${3 + hash(pi) * 2}s`} repeatCount="indefinite">
                    <mpath href={`#obs-map-path-${p.id}`} />
                  </animateMotion>
                </circle>
                {/* Budding satellites — the "growing mycelium" itself: more
                    activity sprouts more offshoot nodes near the parent. */}
                {Array.from({ length: satelliteCount }, (_, si) => {
                  const a = p.angle + (hash(pi * 13 + si) - 0.5) * 1.8
                  const dist = 44 + hash(pi * 29 + si) * 26
                  const sx = p.x + Math.cos(a) * dist
                  const sy = p.y + Math.sin(a) * dist
                  return (
                    <g key={si} className="mycelium-satellite" style={{ animationDelay: `${si * 0.15 + pi * 0.1}s` }}>
                      <line x1={p.x} y1={p.y} x2={sx} y2={sy} stroke={p.accent} strokeWidth={1} opacity={0.35} />
                      <circle cx={sx} cy={sy} r={3 + hash(si * 7) * 2} fill={p.accent} opacity={0.75} />
                    </g>
                  )
                })}
              </g>
            )
          })}

          <circle cx={CX} cy={CY} r={58} fill="url(#hub-glow)" opacity={0.5} className="mycelium-pulse" />
          <circle cx={CX} cy={CY} r={36} fill="#0a0f16" />
          <circle cx={CX} cy={CY} r={36} fill="none" stroke="#22d3ee" strokeWidth={2} opacity={0.7} />
          <text x={CX} y={CY - 4} textAnchor="middle" fontSize={12} fontWeight={800} fill="#eefcff">Interaction Field</text>
          <text x={CX} y={CY + 13} textAnchor="middle" fontSize={9} fill="rgba(226,241,245,.65)">Jarvis vermittelt</text>

          {positions.map(p => (
            <g
              key={p.id}
              onClick={() => setExpanded(cur => cur === p.id ? null : p.id)}
              className={`mycelium-node ${expanded === p.id ? 'active' : ''}`}
              style={{ cursor: 'pointer' }}
            >
              <circle cx={p.x} cy={p.y} r={34} fill={p.accent} opacity={expanded === p.id ? 0.28 : 0} className="mycelium-node-ring" />
              <circle cx={p.x} cy={p.y} r={30} fill="#0d141f" stroke={p.accent} strokeWidth={2} style={{ filter: `drop-shadow(0 0 6px ${p.accent}66)` }} />
              <text x={p.x} y={p.y - 3} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#eefcff">{p.label}</text>
              <text x={p.x} y={p.y + 12} textAnchor="middle" fontSize={10} fontWeight={800} fill={p.accent}>{counts[p.id] ?? 0}</text>
            </g>
          ))}
        </svg>

        {expandedNode && (
          <div className="mycelium-detail" style={{ borderLeftColor: expandedNode.accent }}>
            <span className="mycelium-detail-tag" style={{ color: expandedNode.accent }}>#{expandedNode.label}</span>
            <span className="mycelium-detail-text">{typed}<span className="mycelium-caret">▌</span></span>
          </div>
        )}
      </div>
      <p style={{ fontSize: 12, color: 'rgba(148,190,199,.6)', textAlign: 'center', marginTop: 4 }}>
        Kantenstärke und Anzahl der Ausläufer = relative Aktivität dieses Teilsystems. Klick auf einen Knoten für Details. „Society" ist bewusst nicht dargestellt — es gibt aktuell keine echte Datenquelle dafür, eine erfundene Zahl wäre schlechter als eine ehrliche Lücke.
      </p>
    </div>
  )
}
