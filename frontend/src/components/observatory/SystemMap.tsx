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
  { id: 'site', label: 'Public Site' },
  { id: 'chat', label: 'Chat / RAG' },
  { id: 'blog', label: 'Blog' },
  { id: 'research', label: 'Research' },
  { id: 'simulation', label: 'Simulation' },
]

const CX = 300, CY = 230, R = 170

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
      <svg viewBox="0 0 600 460" style={{ width: '100%', maxWidth: 640, display: 'block', margin: '0 auto' }} aria-hidden="true">
        {positions.map(p => {
          const w = 1 + (edgeWeight[p.id] / maxWeight) * 4
          const opacity = 0.3 + (edgeWeight[p.id] / maxWeight) * 0.55
          return (
            <g key={`edge-${p.id}`}>
              <path id={`obs-map-path-${p.id}`} d={`M ${CX} ${CY} L ${p.x} ${p.y}`} fill="none" stroke="none" />
              <line x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="#63f0ff" strokeWidth={w + 4} opacity={opacity * 0.25} style={{ filter: 'blur(3px)' }} />
              <line x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="#0099CC" strokeWidth={w} opacity={opacity} />
              <circle r="3" fill="#63f0ff">
                <animateMotion dur={`${3 + Math.random() * 2}s`} repeatCount="indefinite">
                  <mpath href={`#obs-map-path-${p.id}`} />
                </animateMotion>
              </circle>
            </g>
          )
        })}

        <circle cx={CX} cy={CY} r={34} fill="#0a0e1a" stroke="#63f0ff" strokeWidth={2} />
        <text x={CX} y={CY - 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#63f0ff">Jarvis</text>
        <text x={CX} y={CY + 12} textAnchor="middle" fontSize={9} fill="#9bb3c2">{data.agent_tool_calls_7d} / 7T</text>

        {positions.map(p => (
          <g key={p.id}>
            <circle cx={p.x} cy={p.y} r={26} fill="#fff" stroke="#0099CC" strokeWidth={1.5} />
            <text x={p.x} y={p.y - 2} textAnchor="middle" fontSize={9} fontWeight={700} fill="#333">{p.label}</text>
            <text x={p.x} y={p.y + 11} textAnchor="middle" fontSize={9} fill="#999">{nodeCount[p.id]}</text>
          </g>
        ))}
      </svg>
      <p style={{ fontSize: 12, color: '#888', textAlign: 'center', marginTop: 8 }}>
        Kantenstärke = Jarvis-Werkzeugaufrufe der letzten 30 Tage · Zahl im Knoten = Aktivität des jeweiligen Moduls
      </p>
    </div>
  )
}
