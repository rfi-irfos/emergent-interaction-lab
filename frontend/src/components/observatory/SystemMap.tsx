import { useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders } from '../../lib/adminApi'

const NODES = [
  { id: 'human', label: 'Human', accent: '#3b6bf6' },
  { id: 'ai', label: 'AI Systems', accent: '#8b5cf6' },
  { id: 'organization', label: 'Organization', accent: '#f59e0b' },
  { id: 'technology', label: 'Technology', accent: '#10b981' },
  { id: 'information', label: 'Information Dynamics', accent: '#14b8a6' },
]

const CX = 300, CY = 230, R = 168

async function fetchJson(path: string): Promise<any> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

/// The network this lab actually studies — human/AI/organization/technology/
/// information relationships — not this app's own internal architecture
/// diagram (that was the old System Map, and explicitly not what the concept
/// is for). "Society" is deliberately omitted: no real data proxy for it
/// exists anywhere in this system, and a fabricated number would be worse
/// than an honest gap.
export function SystemMap() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null)

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
    return { ...n, x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) }
  }), [])

  if (!counts) return <div className="obs-panel"><div className="obs-empty">Lade…</div></div>

  const maxCount = Math.max(...Object.values(counts), 1)

  return (
    <div className="obs-panel">
      <div className="obs-card obs-map-card">
        <svg viewBox="0 0 600 460" style={{ width: '100%', maxWidth: 640, display: 'block', margin: '0 auto' }} aria-hidden="true">
          {positions.map(p => {
            const weight = counts[p.id] ?? 0
            const w = 1 + (weight / maxCount) * 4
            const opacity = 0.28 + (weight / maxCount) * 0.5
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
          <text x={CX} y={CY - 4} textAnchor="middle" fontSize={12} fontWeight={800} fill="#fff">Interaction Field</text>
          <text x={CX} y={CY + 13} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,.6)">Jarvis vermittelt</text>

          {positions.map(p => (
            <g key={p.id}>
              <circle cx={p.x} cy={p.y} r={30} fill="#fff" stroke={p.accent} strokeWidth={2} style={{ filter: 'drop-shadow(0 2px 5px rgba(15,23,42,.12))' }} />
              <text x={p.x} y={p.y - 3} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#111827">{p.label}</text>
              <text x={p.x} y={p.y + 12} textAnchor="middle" fontSize={10} fontWeight={800} fill={p.accent}>{counts[p.id] ?? 0}</text>
            </g>
          ))}
        </svg>
      </div>
      <p style={{ fontSize: 12, color: '#9aa0a8', textAlign: 'center', marginTop: 4 }}>
        Kantenstärke = relative Aktivität dieses Teilsystems · Zahl im Knoten = zugehörige Beobachtungen. „Society" ist bewusst nicht dargestellt — es gibt aktuell keine echte Datenquelle dafür, eine erfundene Zahl wäre schlechter als eine ehrliche Lücke.
      </p>
    </div>
  )
}
