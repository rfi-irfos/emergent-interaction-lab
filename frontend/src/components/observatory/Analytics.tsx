import { useAdminFetch } from '../../lib/adminApi'
import { ObsChart } from './ObsChart'

interface DayCount { day: string; views: number }
interface Bucket { label: string; count: number }
interface ToolCallCount { tool: string; count: number }
interface ActivityItem { kind: string; label: string; created_at: string }

interface AnalyticsData {
  total_views: number
  unique_visitors: number
  views_by_day: DayCount[]
  top_sources: Bucket[]
  top_paths: Bucket[]
  chat_conversations: number
  chat_messages: number
  blog_posts_draft: number
  blog_posts_published: number
  research_notes: number
  simulation_runs: number
  agent_tool_calls_7d: number
  tool_call_counts: ToolCallCount[]
  recent_activity: ActivityItem[]
}

/// Verwaltung's business/CMS view — website traffic plus the admin-activity
/// counts that used to live in the Observatory's "System Overview" (page
/// views, conversations, blog drafts, research notes, simulations, Jarvis
/// actions). The Observatory itself is reserved for emergence signals now.
export function Analytics() {
  const { data, loading } = useAdminFetch<AnalyticsData>('/api/analytics')

  if (loading) return <div className="obs-panel"><div className="obs-empty">Lade…</div></div>
  if (!data) return <div className="obs-panel"><div className="obs-empty">Noch keine Daten.</div></div>

  const maxSrc = Math.max(...data.top_sources.map(s => s.count), 1)

  return (
    <div className="obs-panel">
      <div className="obs-grid">
        <div className="obs-stat c-blue"><div className="obs-stat-value">{data.total_views}</div><div className="obs-stat-label">Seitenaufrufe (30 T.)</div></div>
        <div className="obs-stat c-blue"><div className="obs-stat-value">{data.unique_visitors}</div><div className="obs-stat-label">Unique Besucher (30 T.)</div></div>
        <div className="obs-stat c-purple"><div className="obs-stat-value">{data.chat_conversations}</div><div className="obs-stat-label">Gespräche</div></div>
        <div className="obs-stat c-purple"><div className="obs-stat-value">{data.chat_messages}</div><div className="obs-stat-label">Nachrichten</div></div>
        <div className="obs-stat c-amber"><div className="obs-stat-value">{data.blog_posts_draft}</div><div className="obs-stat-label">Blog-Entwürfe</div></div>
        <div className="obs-stat c-green"><div className="obs-stat-value">{data.blog_posts_published}</div><div className="obs-stat-label">Veröffentlicht</div></div>
        <div className="obs-stat c-teal"><div className="obs-stat-value">{data.research_notes}</div><div className="obs-stat-label">Research Notes</div></div>
        <div className="obs-stat c-teal"><div className="obs-stat-value">{data.simulation_runs}</div><div className="obs-stat-label">Simulationen</div></div>
        <div className="obs-stat c-purple"><div className="obs-stat-value">{data.agent_tool_calls_7d}</div><div className="obs-stat-label">Jarvis-Aktionen (7 T.)</div></div>
      </div>

      {data.views_by_day.length > 0 && (
        <div className="obs-card">
          <div className="obs-section-label">Seitenaufrufe — letzte 14 Tage</div>
          <ObsChart data={data.views_by_day.map(d => ({ label: d.day.slice(5), value: d.views }))} color="#3b6bf6" gradientId="analytics-views" />
        </div>
      )}

      {data.top_sources.length > 0 && (
        <div className="obs-card">
          <div className="obs-section-label">Quellen (30 T.)</div>
          {data.top_sources.map(s => (
            <div className="obs-bar-row" key={s.label}>
              <span style={{ width: 68, fontSize: 11, color: '#6b7280', fontWeight: 600, flexShrink: 0 }}>{s.label}</span>
              <div className="obs-bar-track"><div className="obs-bar-fill" style={{ width: `${(s.count / maxSrc) * 100}%` }} /></div>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#3b6bf6', minWidth: 24, textAlign: 'right' }}>{s.count}</span>
            </div>
          ))}
        </div>
      )}

      {data.top_paths.length > 0 && (
        <div className="obs-card">
          <div className="obs-section-label">Beliebteste Seiten</div>
          {data.top_paths.map((p, i) => (
            <div className="obs-activity-row" key={p.label}>
              <span className="obs-activity-kind">#{i + 1}</span>
              <span className="obs-activity-label" style={{ fontFamily: 'monospace' }}>{p.label || '/'}</span>
              <span className="obs-activity-ts">{p.count}</span>
            </div>
          ))}
        </div>
      )}

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
