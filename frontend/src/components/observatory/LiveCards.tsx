import { useAdminFetch } from '../../lib/adminApi'
import type { AdminSection } from '../../types/admin'

interface OverviewData {
  web_visits_30d: number
  chat_conversations: number
  chat_messages: number
  blog_posts_draft: number
  research_notes: number
  simulation_runs: number
  agent_tool_calls_7d: number
}

const CARDS: { key: keyof OverviewData; label: string; target: AdminSection }[] = [
  { key: 'web_visits_30d', label: 'Besuche (30T)', target: 'overview' },
  { key: 'chat_messages', label: 'Nachrichten', target: 'humanai' },
  { key: 'agent_tool_calls_7d', label: 'Jarvis-Aktionen (7T)', target: 'diagnostics' },
  { key: 'blog_posts_draft', label: 'Blog-Entwürfe', target: 'blog' },
  { key: 'research_notes', label: 'Research Notes', target: 'research' },
  { key: 'simulation_runs', label: 'Simulationen', target: 'simulation' },
]

/// At-a-glance system state above the Forschung chat — refetches after every
/// completed exchange (via refreshSignal) so it feels tied to the
/// conversation, not a separate static dashboard. Each card jumps into the
/// matching Observatory module for a granular look.
export function LiveCards({ refreshSignal, onNavigate }: { refreshSignal: number; onNavigate: (s: AdminSection) => void }) {
  const { data } = useAdminFetch<OverviewData>('/api/observatory/overview', [refreshSignal])
  if (!data) return null
  return (
    <div className="live-cards">
      {CARDS.map(c => (
        <button key={c.key} className="live-card" onClick={() => onNavigate(c.target)} title="Granulare Analyse öffnen">
          <span className="live-card-value">{data[c.key]}</span>
          <span className="live-card-label">{c.label}</span>
        </button>
      ))}
      <button className="live-card live-card-more" onClick={() => onNavigate('overview')}>
        Alle Module →
      </button>
    </div>
  )
}
