import { useState } from 'react'
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
// Fixed order + fixed color per metric — the same 6-accent set every other
// Observatory primitive draws from (ObsDonut's DEFAULT_DONUT_COLORS, .obs-stat's
// c-blue/c-purple/…), assigned by entity, never re-cycled.
const TREND_COLUMNS: { key: Exclude<keyof TrendPoint, 'bucket'>; label: string; color: string }[] = [
  { key: 'views', label: 'Aufrufe', color: 'var(--obs-blue)' },
  { key: 'chat_messages', label: 'Nachrichten', color: 'var(--obs-purple)' },
  { key: 'tool_calls', label: 'Werkzeuge', color: 'var(--obs-teal)' },
  { key: 'research_notes', label: 'Notizen', color: 'var(--obs-amber)' },
  { key: 'blog_posts', label: 'Blog', color: 'var(--obs-green)' },
  { key: 'simulation_runs', label: 'Simulationen', color: 'var(--obs-red)' },
]

// ObsChart's `data` array drives its axis labels 1:1 (one <span> per point,
// laid out via flex `space-between`) with no thinning of its own — fine for
// its existing callers' small/fixed point counts, but this page's mini-charts
// below can carry up to 90 points (`?days=90`) inside a card roughly a third
// the width ObsChart's other callers render at. Blanking every label but a
// handful (kept at genuinely evenly-spaced indices, always including the
// last point) keeps every chart's x-position/shape intact — only the text is
// thinned — without touching ObsChart.tsx itself and risking a regression on
// its other, already-verified callers (Flugschreiber, InteractionDynamics, …).
function trendAxisLabel(n: number, i: number, bucket: string): string {
  const maxLabels = 6
  const step = Math.max(1, Math.ceil(n / maxLabels))
  return i % step === 0 || i === n - 1 ? bucket.slice(5) : ''
}

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
            // Small-multiples, NOT one shared-axis overlay (see ObsMultiChart.tsx,
            // built and available but deliberately not used here): views
            // routinely runs 50-300x research_notes/blog_posts/simulation_runs in
            // real seeded data, and a screenshot check of the unified-overlay
            // version confirmed the predicted failure mode — the dominant
            // series flattens the other five into an unreadable near-zero band,
            // and even toggling off the single worst offender still left three
            // series flattened (chat_messages/tool_calls still dwarf the
            // remaining three). Six independently-scaled mini-charts, each
            // auto-scaled to its own max, is the one that actually reads.
            <div className="obs-multichart-grid">
              {TREND_COLUMNS.map(col => {
                const total = data.activity_trend.reduce((sum, p) => sum + p[col.key], 0)
                return (
                  <div key={col.key} className="obs-multichart-mini">
                    <div className="obs-multichart-mini-head">
                      <span className="obs-multichart-mini-swatch" style={{ background: col.color }} />
                      <span className="obs-multichart-mini-label">{col.label}</span>
                      <span className="obs-multichart-mini-total">{total}</span>
                    </div>
                    <ObsChart
                      data={data.activity_trend.map((p, i) => ({ label: trendAxisLabel(data.activity_trend.length, i, p.bucket), value: p[col.key] }))}
                      color={col.color}
                      height={72}
                      gradientId={`analytics-activity-${col.key}`}
                    />
                  </div>
                )
              })}
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
