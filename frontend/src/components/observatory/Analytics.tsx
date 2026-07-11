import { Fragment, useState } from 'react'
import { useAdminFetch } from '../../lib/adminApi'
import { foldIntoOther } from '../../lib/chartMath'
import { ObsChart } from './ObsChart'
import { ObsDonut } from './ObsDonut'
import { ExportButtons } from './ExportButtons'
import { HudSkeleton } from './HudSkeleton'

interface DayCount { day: string; views: number }
interface Bucket { label: string; count: number }
interface ToolCallCount { tool: string; count: number }
interface ActivityItem { kind: string; label: string; created_at: string }
interface TrendPoint {
  bucket: string
  views: number
  chat_messages: number
  tool_calls: number
  research_notes: number
  blog_posts: number
  simulation_runs: number
}

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
  bucket: string
  days: number
  activity_trend: TrendPoint[]
}

const DAYS_OPTIONS = [7, 14, 30, 60, 90]
const TREND_COLUMNS: { key: Exclude<keyof TrendPoint, 'bucket'>; label: string }[] = [
  { key: 'views', label: 'Aufrufe' },
  { key: 'chat_messages', label: 'Nachrichten' },
  { key: 'tool_calls', label: 'Werkzeuge' },
  { key: 'research_notes', label: 'Notizen' },
  { key: 'blog_posts', label: 'Blog' },
  { key: 'simulation_runs', label: 'Simulationen' },
]

/// Verwaltung's business/CMS view — website traffic plus the admin-activity
/// counts that used to live in the Observatory's "System Overview" (page
/// views, conversations, blog drafts, research notes, simulations, Jarvis
/// actions). The Observatory itself is reserved for emergence signals now.
export function Analytics() {
  // Retrospective day/week breakdown (see backend/src/analytics.rs's
  // `?bucket=day|week&days=N`) — everything else on this page is an
  // all-time or fixed-window total; this is the one view that answers "what
  // happened on 2026-07-08" vs. "what happened this week" specifically.
  const [bucket, setBucket] = useState<'day' | 'week'>('day')
  const [days, setDays] = useState(30)
  const { data, loading, error } = useAdminFetch<AnalyticsData>(
    `/api/analytics?bucket=${bucket}&days=${days}`,
    [bucket, days],
  )

  if (loading) return <div className="obs-panel"><HudSkeleton variant="stats" rows={8} /></div>
  if (error) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>
  if (!data) return <div className="obs-panel"><div className="obs-empty">Noch keine Daten.</div></div>

  // foldIntoOther is a no-op under its 6-slice ceiling — only matters here
  // if a real deployment ever accumulates more distinct sources/tools than
  // that (see chartMath.ts's doc comment: fold the tail into "Andere"
  // rather than generating more hues, this codebase's own dataviz skill's
  // prescribed fix for a categorical series past the token ceiling).
  const topSourcesData = foldIntoOther(data.top_sources.map(s => ({ label: s.label || '(direkt)', value: s.count })))
  const toolCallCountsData = foldIntoOther(data.tool_call_counts.map(t => ({ label: t.tool, value: t.count })))

  return (
    <div className="obs-panel">
      <div className="obs-grid">
        <div className="obs-stat c-blue"><div className="obs-stat-value">{data.total_views}</div><div className="obs-stat-label">Seitenaufrufe (30 T.)</div></div>
        <div className="obs-stat c-blue"><div className="obs-stat-value">{data.unique_visitors}</div><div className="obs-stat-label">Unique Besucher (30 T.)</div></div>
        <div className="obs-stat c-purple"><div className="obs-stat-value">{data.chat_conversations}</div><div className="obs-stat-label">Gespräche</div></div>
        <div className="obs-stat c-purple"><div className="obs-stat-value">{data.chat_messages}</div><div className="obs-stat-label">Nachrichten</div></div>
        <div className="obs-stat c-teal"><div className="obs-stat-value">{data.research_notes}</div><div className="obs-stat-label">Research Notes</div></div>
        <div className="obs-stat c-teal"><div className="obs-stat-value">{data.simulation_runs}</div><div className="obs-stat-label">Simulationen</div></div>
        <div className="obs-stat c-purple"><div className="obs-stat-value">{data.agent_tool_calls_7d}</div><div className="obs-stat-label">Jarvis-Aktionen (7 T.)</div></div>
      </div>

      {/* blog_posts_draft/blog_posts_published used to be two separate stat
          numbers in the grid above — a 2-slice donut carries the exact same
          two counts plus the actual draft-vs-published split they never
          showed, so it replaces rather than duplicates them. */}
      <div className="obs-card">
        <div className="obs-section-label">Blog — Entwürfe vs. Veröffentlicht</div>
        <ObsDonut
          data={[
            { label: 'Entwürfe', value: data.blog_posts_draft, color: 'var(--obs-amber)' },
            { label: 'Veröffentlicht', value: data.blog_posts_published, color: 'var(--obs-green)' },
          ]}
          gradientIdPrefix="analytics-blog-status"
        />
      </div>

      <div className="obs-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
          <div className="obs-section-label" style={{ marginBottom: 0, flex: '1 1 auto' }}>
            Aktivität im Zeitverlauf — retrospektiv nach Tag oder Woche
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={bucket} onChange={e => setBucket(e.target.value as 'day' | 'week')} style={{ fontSize: 12, padding: '5px 8px' }}>
              <option value="day">Pro Tag</option>
              <option value="week">Pro Woche</option>
            </select>
            <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ fontSize: 12, padding: '5px 8px' }}>
              {DAYS_OPTIONS.map(d => <option key={d} value={d}>letzte {d} Tage</option>)}
            </select>
            {/* Exports the retrospective trend table above — the one
                dataset on this page actually gated by the bucket/days
                selector, so the export honestly reflects the active
                filter rather than some other fixed-window total shown
                elsewhere on the page. */}
            <ExportButtons
              rows={data.activity_trend.map(p => ({ ...p }))}
              filenameBase={`analytics-activity-${bucket}`}
              title={`Analytics — Aktivität pro ${bucket === 'week' ? 'Woche' : 'Tag'} (letzte ${days} Tage)`}
            />
          </div>
        </div>
        {data.activity_trend.length === 0
          ? <div className="obs-empty">Noch keine Aktivität in diesem Zeitraum.</div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: `92px repeat(${TREND_COLUMNS.length}, 1fr)`, gap: '4px 12px', minWidth: 560 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#9aa0a8', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  {bucket === 'week' ? 'Woche ab' : 'Datum'}
                </div>
                {TREND_COLUMNS.map(col => (
                  <div key={col.key} style={{ fontSize: 10, fontWeight: 800, color: '#9aa0a8', textTransform: 'uppercase', letterSpacing: '.05em', textAlign: 'right' }}>
                    {col.label}
                  </div>
                ))}
                {[...data.activity_trend].reverse().map(point => (
                  <Fragment key={point.bucket}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1f2937', fontVariantNumeric: 'tabular-nums', padding: '4px 0', borderTop: '1px solid rgba(15,23,42,.05)' }}>
                      {point.bucket}
                    </div>
                    {TREND_COLUMNS.map(col => (
                      <div
                        key={col.key}
                        style={{ fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: point[col.key] > 0 ? '#3b6bf6' : '#c7cbd3', fontWeight: point[col.key] > 0 ? 700 : 400, padding: '4px 0', borderTop: '1px solid rgba(15,23,42,.05)' }}
                      >
                        {point[col.key]}
                      </div>
                    ))}
                  </Fragment>
                ))}
              </div>
            </div>
          )
        }
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
          <ObsDonut data={topSourcesData} gradientIdPrefix="analytics-top-sources" />
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

      {data.tool_call_counts.length > 0 && (
        <div className="obs-card">
          <div className="obs-section-label">Jarvis-Werkzeugaufrufe (30 T.)</div>
          <ObsDonut data={toolCallCountsData} gradientIdPrefix="analytics-tool-calls" />
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
