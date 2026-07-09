import { useMemo } from 'react'
import { useAdminFetch } from '../../lib/adminApi'

interface ToolCallCount { tool: string; count: number }
interface OverviewData {
  web_visits_30d: number
  chat_conversations: number
  blog_posts_draft: number
  blog_posts_published: number
  research_notes: number
  simulation_runs: number
  agent_tool_calls_7d: number
  tool_call_counts: ToolCallCount[]
}

const NODES = [
  { id: 'site', label: 'Public Site', accent: '#3b6bf6' },
  { id: 'chat', label: 'Chat / RAG', accent: '#8b5cf6' },
  { id: 'blog', label: 'Blog', accent: '#f59e0b' },
  { id: 'research', label: 'Research', accent: '#14b8a6' },
  { id: 'simulation', label: 'Simulation', accent: '#10b981' },
]

const CX = 300, CY = 230, R = 168

// Hand-placed inline SVG, no graph library — same glow-stroke technique
// (blurred wide stroke + crisp thin stroke) as the public hero's horizon
// line, applied to a different picture. Jarvis sits at the hub since it's
// reachable from every module, not siloed in one.
export function SystemMap() {
  const { data, loading } = useAdminFetch<OverviewData>('/api/observatory/overview')

  const positions = useMemo(() => NODES.map((n, i) => {
    const angle = (-90 + i * (360 / NODES.length)) * (Math.PI / 180)
    return { ...n, x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) }
  }), [])

  if (loading) return <div className="obs-panel"><div className="obs-empty">Lade…</div></div>
  if (!data) return <div className="obs-panel"><div className="obs-empty">Keine Daten verfügbar.</div></div>

  const toolCount = (tool: string) => data.tool_call_counts.find(t => t.tool === tool)?.count ?? 0
  const nodeCount: Record<string, number> = {
    site: data.web_visits_30d,
    chat: data.chat_conversations,
    blog: data.blog_posts_draft + data.blog_posts_published,
    research: data.research_notes,
    simulation: data.simulation_runs,
  }
  // 'chat' is a structural edge (shared conversation storage with the Forschung
  // tab), not backed by a discrete tool call — given a nominal weight of 1.
  const edgeWeight: Record<string, number> = {
    site: toolCount('get_content_section') + toolCount('get_recent_analytics'),
    chat: 1,
    blog: toolCount('draft_blog_post'),
    research: toolCount('log_research_note'),
    simulation: toolCount('run_simulation_scenario'),
  }
  const maxWeight = Math.max(...Object.values(edgeWeight), 1)

  return (
    <div className="obs-panel">
      <div className="obs-card obs-map-card">
        <svg viewBox="0 0 600 460" style={{ width: '100%', maxWidth: 640, display: 'block', margin: '0 auto' }} aria-hidden="true">
          {positions.map(p => {
            const w = 1 + (edgeWeight[p.id] / maxWeight) * 4
            const opacity = 0.28 + (edgeWeight[p.id] / maxWeight) * 0.5
            return (
              <g key={`edge-${p.id}`}>
                <path id={`obs-map-path-${p.id}`} d={`M ${CX} ${CY} L ${p.x} ${p.y}`} fill="none" stroke="none" />
                <line x1={CX} y1={CY} x2={p.x} y2={p.y} stroke={p.accent} strokeWidth={w + 5} opacity={opacity * 0.22} style={{ filter: 'blur(4px)' }} />
                <line x1={CX} y1={CY} x2={p.x} y2={p.y} stroke={p.accent} strokeWidth={w} opacity={opacity} />
                <circle r="3.5" fill={p.accent}>
                  <animateMotion dur={`${3 + Math.random() * 2}s`} repeatCount="indefinite">
                    <mpath href={`#obs-map-path-${p.id}`} />
                  </animateMotion>
                </circle>
              </g>
            )
          })}

          <circle cx={CX} cy={CY} r={36} fill="#111827" />
          <circle cx={CX} cy={CY} r={36} fill="none" stroke="#3b6bf6" strokeWidth={2} opacity={0.6} />
          <text x={CX} y={CY - 4} textAnchor="middle" fontSize={12} fontWeight={800} fill="#fff">Jarvis</text>
          <text x={CX} y={CY + 13} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,.6)">{data.agent_tool_calls_7d} / 7T</text>

          {positions.map(p => (
            <g key={p.id}>
              <circle cx={p.x} cy={p.y} r={30} fill="#fff" stroke={p.accent} strokeWidth={2} style={{ filter: 'drop-shadow(0 2px 5px rgba(15,23,42,.12))' }} />
              <text x={p.x} y={p.y - 3} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#111827">{p.label}</text>
              <text x={p.x} y={p.y + 12} textAnchor="middle" fontSize={10} fontWeight={800} fill={p.accent}>{nodeCount[p.id]}</text>
            </g>
          ))}
        </svg>
      </div>
      <p style={{ fontSize: 12, color: '#9aa0a8', textAlign: 'center', marginTop: 4 }}>
        Kantenstärke = Jarvis-Werkzeugaufrufe der letzten 30 Tage · Zahl im Knoten = Aktivität des jeweiligen Moduls
      </p>
    </div>
  )
}
