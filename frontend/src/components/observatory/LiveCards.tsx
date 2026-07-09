import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders } from '../../lib/adminApi'
import type { AdminSection } from '../../types/admin'

// One card per Observatory module (mirrors the sidebar exactly) — the
// reframed 7-concept Observatory, not the old 10-module business-KPI mix.
// Each card shows that module's own real-time emergence-relevant metric.
// Refetches after every completed chat exchange (refreshSignal), so it
// reads as "the system updating as you talk to it."
const MODULE_META: { id: AdminSection; label: string; accent: string }[] = [
  { id: 'systemmap', label: 'System Map', accent: '#3b6bf6' },
  { id: 'emergence', label: 'Emergence Monitor', accent: '#f59e0b' },
  { id: 'systemstate', label: 'System State', accent: '#10b981' },
  { id: 'interaction', label: 'Interaction Dynamics', accent: '#8b5cf6' },
  { id: 'information', label: 'Information Dynamics', accent: '#14b8a6' },
  { id: 'behavior', label: 'Behavioral Landscape', accent: '#3b6bf6' },
  { id: 'research', label: 'Research Pulse', accent: '#14b8a6' },
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
      const [humanAi, signals, diagnostics, information, behavior, research] = await Promise.all([
        fetchJson('/api/observatory/human-ai'),
        fetchJson('/api/observatory/emergence/signals'),
        fetchJson('/api/observatory/diagnostics'),
        fetchJson('/api/observatory/information'),
        fetchJson('/api/observatory/behavior'),
        fetchJson('/api/research/items'),
      ])
      if (cancelled) return
      const toolTotal = Array.isArray(behavior?.tool_distribution)
        ? behavior.tool_distribution.reduce((sum: number, b: any) => sum + (b.count ?? 0), 0)
        : 0
      setValues({
        systemmap: humanAi ? String((humanAi.user_messages ?? 0) + (humanAi.assistant_messages ?? 0)) : '—',
        emergence: Array.isArray(signals) ? String(signals.length) : '—',
        systemstate: diagnostics ? (diagnostics.db_reachable ? 'OK' : 'Issue') : '—',
        interaction: typeof humanAi?.mean_token_confidence === 'number' ? `${Math.round(humanAi.mean_token_confidence * 100)}%` : '—',
        information: information ? String(information.chunks) : '—',
        behavior: String(toolTotal),
        research: Array.isArray(research) ? String(research.length) : '—',
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
