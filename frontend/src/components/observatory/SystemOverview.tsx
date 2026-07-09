import { useAdminFetch } from '../../lib/adminApi'

interface ActivityItem { kind: string; label: string; created_at: string }
interface OverviewData {
  web_visits_30d: number
  chat_conversations: number
  chat_messages: number
  blog_posts_draft: number
  blog_posts_published: number
  research_notes: number
  simulation_runs: number
  agent_tool_calls_7d: number
  recent_activity: ActivityItem[]
}

export function SystemOverview() {
  const { data, loading } = useAdminFetch<OverviewData>('/api/observatory/overview')

  if (loading) return <div className="obs-panel"><div className="obs-empty">Lade Systemzustand…</div></div>
  if (!data) return <div className="obs-panel"><div className="obs-empty">Observatory-Daten nicht verfügbar.</div></div>

  return (
    <div className="obs-panel">
      <div className="obs-grid">
        <div className="obs-stat c-blue"><div className="obs-stat-value">{data.web_visits_30d}</div><div className="obs-stat-label">Seitenaufrufe (30 T.)</div></div>
        <div className="obs-stat c-purple"><div className="obs-stat-value">{data.chat_conversations}</div><div className="obs-stat-label">Gespräche</div></div>
        <div className="obs-stat c-purple"><div className="obs-stat-value">{data.chat_messages}</div><div className="obs-stat-label">Nachrichten</div></div>
        <div className="obs-stat c-amber"><div className="obs-stat-value">{data.blog_posts_draft}</div><div className="obs-stat-label">Blog-Entwürfe</div></div>
        <div className="obs-stat c-green"><div className="obs-stat-value">{data.blog_posts_published}</div><div className="obs-stat-label">Veröffentlicht</div></div>
        <div className="obs-stat c-teal"><div className="obs-stat-value">{data.research_notes}</div><div className="obs-stat-label">Research Notes</div></div>
        <div className="obs-stat c-teal"><div className="obs-stat-value">{data.simulation_runs}</div><div className="obs-stat-label">Simulationen</div></div>
        <div className="obs-stat c-purple"><div className="obs-stat-value">{data.agent_tool_calls_7d}</div><div className="obs-stat-label">Jarvis-Aktionen (7 T.)</div></div>
      </div>

      <div className="obs-section-label">Laufende Aktivität</div>
      <div className="obs-card">
        {data.recent_activity.length === 0 && <div className="obs-empty">Noch keine Aktivität.</div>}
        {data.recent_activity.map((a, i) => (
          <div className="obs-activity-row" key={i}>
            <span className="obs-activity-kind">{a.kind}</span>
            <span className="obs-activity-label">{a.label}</span>
            <span className="obs-activity-ts">{a.created_at}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
