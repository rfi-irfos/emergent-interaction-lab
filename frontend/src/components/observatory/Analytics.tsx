import { useState } from 'react'
import { useAdminFetch } from '../../lib/adminApi'
import { foldIntoOther } from '../../lib/chartMath'
import { ObsChart } from './ObsChart'
import { ObsDonut } from './ObsDonut'
import { HudGrid, HudTile, useHeaderActions, HudHeaderActions } from './Hud'
import { ExportButtons } from './ExportButtons'
import { HudSkeleton } from './HudSkeleton'
import { Gesamtuebersicht, type EverythingData } from './Gesamtuebersicht'

interface DayCount { day: string; views: number }
interface Bucket { label: string; count: number }
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
  blog_posts_draft: number
  blog_posts_published: number
  recent_activity: ActivityItem[]
  bucket: string
  days: number
  activity_trend: TrendPoint[]
}

// The ONE global filter for this whole combined page (Analytics +
// Gesamtübersicht stacked together) — same 7d/30d/all vocabulary every
// other range-filtered Observatory module already uses. Replaces what used
// to be TWO independent filters (Analytics' own bucket=day|week&days=N
// retrospective selector, Gesamtübersicht's own range=7d|30d|all) that
// never agreed with each other and left half the page's own numbers
// (chat_conversations, chat_messages, research_notes, simulation_runs —
// see backend/src/analytics.rs) not responding to any filter at all.
const RANGE_OPTIONS: { value: '7d' | '30d' | 'all'; label: string }[] = [
  { value: '7d', label: 'Letzte 7 Tage' },
  { value: '30d', label: 'Letzte 30 Tage' },
  { value: 'all', label: 'Alle' },
]
const RANGE_SUFFIX: Record<string, string> = { '7d': 'letzte 7 Tage', '30d': 'letzte 30 Tage', all: 'alle' }

// Maps the one shared range onto backend/src/analytics.rs's own
// `?bucket=day|week&days=N` shape — day-granularity for the two shorter
// windows (fine-grained enough to be useful), week-granularity once the
// window is wide enough that daily buckets would just be noise. `all` uses
// MAX_TREND_DAYS (180, see analytics.rs) as the widest window the backend
// will actually serve, not a literal "forever."
const RANGE_TO_TREND_PARAMS: Record<string, { days: number; bucket: 'day' | 'week' }> = {
  '7d': { days: 7, bucket: 'day' },
  '30d': { days: 30, bucket: 'day' },
  all: { days: 180, bucket: 'week' },
}

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
// below can carry up to 180 points (`all`) inside a card roughly a third
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
///
/// Owns BOTH data sources for the combined page (its own `/api/analytics`
/// AND Gesamtübersicht's `/api/observatory/everything`) under the SAME
/// range, so there is exactly one filter, one page header, and one top KPI
/// block for what used to be two separately-filtered, separately-headered
/// stacked apps. Gesamtübersicht itself is now purely presentational (see
/// its own doc comment).
export function Analytics() {
  const [range, setRange] = useState<'7d' | '30d' | 'all'>('30d')
  const trendParams = RANGE_TO_TREND_PARAMS[range]
  const { data, loading, error } = useAdminFetch<AnalyticsData>(
    `/api/analytics?bucket=${trendParams.bucket}&days=${trendParams.days}`,
    [range],
  )
  const { data: everything, loading: everythingLoading, error: everythingError } = useAdminFetch<EverythingData>(
    `/api/observatory/everything?range=${range}`,
    [range],
  )

  const combinedLoading = loading || everythingLoading
  const combinedError = error || everythingError

  // One combined export covering both data sources under the one shared
  // filter — the per-tile exports Gesamtübersicht used to carry on its own
  // are gone (see its own doc comment); this single row is what's left.
  const summaryRow = (data && everything) ? [{
    range,
    total_views: data.total_views,
    unique_visitors: data.unique_visitors,
    conversations_total: everything.chat.conversations_total,
    user_messages: everything.chat.user_messages,
    assistant_messages: everything.chat.assistant_messages,
    research_notes_total: everything.research_notes.total,
    simulation_runs_total: everything.simulation_runs.total,
    agent_tool_calls_total: everything.agent_tool_calls.total,
    emergence_signals_total: everything.emergence_signals.total,
    ccet_cei: everything.ccet.cei,
    ccet_cep: everything.ccet.cep,
    ccet_resonance_frequency: everything.ccet.resonance_frequency,
    system_snapshots_total: everything.system_snapshots.total,
  }] : []

  useHeaderActions(
    <HudHeaderActions
      filters={
        <select value={range} onChange={e => setRange(e.target.value as '7d' | '30d' | 'all')} style={{ fontSize: 12, padding: '5px 8px' }}>
          {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      }
      action={<ExportButtons rows={summaryRow} filenameBase={`analytics-zusammenfassung-${range}`} title={`Analytics — Zusammenfassung (${RANGE_SUFFIX[range]})`} />}
    />,
    [range, data, everything],
  )

  if (combinedLoading) return <div className="obs-panel"><HudSkeleton variant="stats" rows={8} /></div>
  if (combinedError) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>
  if (!data || !everything) return <div className="obs-panel"><div className="obs-empty">Noch keine Daten.</div></div>

  // foldIntoOther is a no-op under its 6-slice ceiling — only matters here
  // if a real deployment ever accumulates more distinct sources than that
  // (see chartMath.ts's doc comment: fold the tail into "Andere" rather
  // than generating more hues, this codebase's own dataviz skill's
  // prescribed fix for a categorical series past the token ceiling).
  const topSourcesData = foldIntoOther(data.top_sources.map(s => ({ label: s.label || '(direkt)', value: s.count })))

  return (
    <div className="obs-panel">
      {/* ── ONE top KPI block for the whole combined page — card directly
          next to card, no section label/gap. Deduplicated: Analytics used
          to separately show chat_conversations/chat_messages/research_notes/
          simulation_runs/agent_tool_calls as flat all-time-ish totals right
          next to Gesamtübersicht's own range-filtered versions of the exact
          same numbers (10 cards total) — now that both halves share one
          filter, those pairs would show literally the same figure twice, so
          the flat duplicates are gone and Gesamtübersicht's richer
          range-filtered breakdown (Nachrichten split by Laura/Jarvis) is
          what's kept. */}
      <div className="obs-grid">
        <div className="obs-stat c-blue"><div className="obs-stat-value">{data.total_views}</div><div className="obs-stat-label">Seitenaufrufe</div></div>
        <div className="obs-stat c-teal"><div className="obs-stat-value">{data.unique_visitors}</div><div className="obs-stat-label">Unique Besucher</div></div>
        <div className="obs-stat c-purple"><div className="obs-stat-value">{everything.chat.conversations_total}</div><div className="obs-stat-label">Gespräche</div></div>
        <div className="obs-stat c-amber"><div className="obs-stat-value">{everything.chat.user_messages}</div><div className="obs-stat-label">Nachrichten (Laura)</div></div>
        <div className="obs-stat c-green"><div className="obs-stat-value">{everything.chat.assistant_messages}</div><div className="obs-stat-label">Antworten (Jarvis)</div></div>
        <div className="obs-stat c-red"><div className="obs-stat-value">{everything.research_notes.total}</div><div className="obs-stat-label">Research Notes</div></div>
        <div className="obs-stat c-blue"><div className="obs-stat-value">{everything.simulation_runs.total}</div><div className="obs-stat-label">Simulationen</div></div>
        <div className="obs-stat c-purple"><div className="obs-stat-value">{everything.agent_tool_calls.total}</div><div className="obs-stat-label">Jarvis-Werkzeuge</div></div>
      </div>

      {/* ── instrument wall: every chart in a fixed-size framed HudTile,
          never a lone full-width card. Jarvis-Werkzeuge's own donut is gone
          from here — Gesamtübersicht's version below already covers the
          same agent_tool_calls breakdown, now under the identical filter. */}
      <HudGrid cols={3}>
        <HudTile title="Blog" badge="STATUS" accent="var(--obs-amber)" span={1}>
          <div className="obs-section-label" style={{ marginBottom: 10 }}>Entwürfe vs. Veröffentlicht</div>
          <ObsDonut
            data={[
              { label: 'Entwürfe', value: data.blog_posts_draft, color: 'var(--obs-amber)' },
              { label: 'Veröffentlicht', value: data.blog_posts_published, color: 'var(--obs-green)' },
            ]}
            gradientIdPrefix="analytics-blog-status"
          />
        </HudTile>

        <HudTile title="Quellen" accent="var(--obs-teal)" span={1}>
          {data.top_sources.length > 0 ? (
            <ObsDonut data={topSourcesData} gradientIdPrefix="analytics-top-sources" />
          ) : <div className="obs-empty">Keine Quellen.</div>}
        </HudTile>

        <HudTile title="Aufrufe" accent="var(--obs-blue)" span={1}>
          {data.views_by_day.length > 0 ? (
            <ObsChart data={data.views_by_day.map(d => ({ label: d.day.slice(5), value: d.views }))} color="#3b6bf6" gradientId="analytics-views" />
          ) : <div className="obs-empty">Keine Aufrufe.</div>}
        </HudTile>
      </HudGrid>

      <HudGrid cols={3}>
        {/* No local bucket/day selector anymore — this always shows the
            currently selected global range, mapped to the finest sensible
            granularity (see RANGE_TO_TREND_PARAMS above). That was the
            other still-remaining "extra filter" this page had. */}
        <HudTile title="Aktivität im Zeitverlauf" badge="RETRO" accent="var(--obs-cyan)" span={3}>
          {data.activity_trend.length === 0
            ? <div className="obs-empty">Noch keine Aktivität in diesem Zeitraum.</div>
            : (
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
            )}
        </HudTile>
      </HudGrid>

      <HudGrid cols={4}>
        <HudTile title="Beliebteste Seiten" badge="RANK" accent="var(--obs-green)" span={2}>
          {data.top_paths.length > 0 ? (
            data.top_paths.map((p, i) => (
              <div className="obs-activity-row" key={p.label}>
                <span className="obs-activity-kind">#{i + 1}</span>
                <span className="obs-activity-label" style={{ fontFamily: 'monospace' }}>{p.label || '/'}</span>
                <span className="obs-activity-ts">{p.count}</span>
              </div>
            ))
          ) : <div className="obs-empty">Keine Pfade.</div>}
        </HudTile>

        <HudTile title="Laufende Aktivität" badge="LIVE" accent="var(--hud-cyan)" span={2}>
          {data.recent_activity.length === 0 && <div className="obs-empty">Noch keine Aktivität.</div>}
          {data.recent_activity.map((a, i) => (
            <div className="obs-activity-row" key={i}>
              <span className="obs-activity-kind">{a.kind}</span>
              <span className="obs-activity-label">{a.label}</span>
              <span className="obs-activity-ts">{a.created_at}</span>
            </div>
          ))}
        </HudTile>
      </HudGrid>

      <Gesamtuebersicht data={everything} />
    </div>
  )
}
