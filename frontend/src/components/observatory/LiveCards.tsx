import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders } from '../../lib/adminApi'
import type { AdminSection } from '../../types/admin'

// One card per Observatory module (mirrors the sidebar exactly), each
// showing that module's own real-time headline metric — not a curated
// subset. Refetches after every completed chat exchange (refreshSignal),
// so it reads as "the system updating as you talk to it," not a static
// dashboard bolted on top.
const MODULE_META: { id: AdminSection; label: string; accent: string }[] = [
  { id: 'overview', label: 'System Overview', accent: '#3b6bf6' },
  { id: 'systemmap', label: 'System Map', accent: '#3b6bf6' },
  { id: 'emergence', label: 'Emergence Monitor', accent: '#f59e0b' },
  { id: 'behavior', label: 'Behavioral Observatory', accent: '#3b6bf6' },
  { id: 'information', label: 'Information Dynamics', accent: '#14b8a6' },
  { id: 'humanai', label: 'Human–AI Interaction', accent: '#8b5cf6' },
  { id: 'diagnostics', label: 'System Diagnostics', accent: '#10b981' },
  { id: 'simulation', label: 'Simulation Lab', accent: '#14b8a6' },
  { id: 'research', label: 'Research Workspace', accent: '#14b8a6' },
  { id: 'innovation', label: 'Innovation Lab', accent: '#8b5cf6' },
]

async function fetchJson(path: string): Promise<any> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

export function LiveCards({ refreshSignal, onNavigate }: { refreshSignal: number; onNavigate: (s: AdminSection) => void }) {
  const [values, setValues] = useState<Partial<Record<AdminSection, string>>>({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [overview, emergence, behavior, information, humanAi, diagnostics, workspace, innovation] = await Promise.all([
        fetchJson('/api/observatory/overview'),
        fetchJson('/api/observatory/emergence'),
        fetchJson('/api/observatory/behavior'),
        fetchJson('/api/observatory/information'),
        fetchJson('/api/observatory/human-ai'),
        fetchJson('/api/observatory/diagnostics'),
        fetchJson('/api/research/items?category=paper,hypothesis'),
        fetchJson('/api/research/items?category=idea,concept,framework,prototype'),
      ])
      if (cancelled) return
      setValues({
        overview: overview ? String(overview.web_visits_30d) : '—',
        systemmap: overview ? String(overview.agent_tool_calls_7d) : '—',
        emergence: typeof emergence?.variance_index === 'number' ? emergence.variance_index.toFixed(2) : '—',
        behavior: behavior ? String(behavior.total_visitors_30d) : '—',
        information: information ? String(information.chunks) : '—',
        humanai: typeof humanAi?.mean_token_confidence === 'number' ? `${Math.round(humanAi.mean_token_confidence * 100)}%` : '—',
        diagnostics: diagnostics ? String(diagnostics.agent_tool_call_errors_7d ?? 0) : '—',
        simulation: overview ? String(overview.simulation_runs) : '—',
        research: Array.isArray(workspace) ? String(workspace.length) : '—',
        innovation: Array.isArray(innovation) ? String(innovation.length) : '—',
      })
    })()
    return () => { cancelled = true }
  }, [refreshSignal])

  return (
    <div className="live-cards">
      {MODULE_META.map(m => (
        <button
          key={m.id}
          className="live-card"
          style={{ ['--obs-accent' as string]: m.accent }}
          onClick={() => onNavigate(m.id)}
          title="Granulare Analyse öffnen"
        >
          <span className="live-card-value">{values[m.id] ?? '…'}</span>
          <span className="live-card-label">{m.label}</span>
        </button>
      ))}
    </div>
  )
}
