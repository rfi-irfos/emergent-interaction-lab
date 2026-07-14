import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders } from '../../lib/adminApi'
import { hudStagger } from '../../lib/hudStagger'
import { ObsChart } from './ObsChart'
import { HudGrid, HudTile, HudSectionHeader } from './Hud'
import { ExportButtons } from './ExportButtons'
import { HudSkeleton } from './HudSkeleton'

// One typed rollup row, captured automatically after every chat turn — see
// backend/src/observatory.rs's `capture_system_snapshot` (chained inside
// chat.rs's existing CCET background spawn, never on the chat response's
// own critical path) and `GET /api/observatory/snapshots`. Every field here
// is a real query result at real capture time — no placeholder rows, no
// synthetic backfill for turns that predate this feature.
interface Snapshot {
  id: string
  conversation_id: string
  trigger_turn_id: string | null
  signals_human: number
  signals_ai: number
  signals_interaction: number
  signals_system: number
  cei: number
  cep: number
  resonance_frequency: number
  sim_runs_pending: number
  sim_runs_complete: number
  sim_runs_error: number
  research_notes_total: number
  agent_tool_calls_7d: number
  created_at: string
}

// Same `?range=7d|30d|all` convention as Behavioral Landscape (see
// backend/src/observatory.rs's resolve_range, reused verbatim by
// list_snapshots) — same default (30d) too, for consistency.
const RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: '7d', label: 'Letzte 7 Tage' },
  { value: '30d', label: 'Letzte 30 Tage' },
  { value: 'all', label: 'Alle' },
]

// Backend default page size for GET /api/observatory/snapshots (see
// DEFAULT_SNAPSHOTS_LIMIT in observatory.rs) — kept in sync so the very
// first page loaded here matches what the backend would return anyway.
const PAGE_SIZE = 50

function formatPercent(v: number): string {
  return `${Math.round(v * 100)}%`
}

function totalSignals(s: Snapshot): number {
  return s.signals_human + s.signals_ai + s.signals_interaction + s.signals_system
}

function totalSimRuns(s: Snapshot): number {
  return s.sim_runs_pending + s.sim_runs_complete + s.sim_runs_error
}

/// Flugschreiber — the flight recorder. Unlike every other Observatory
/// module (which shows the live, current state), this one's entire point is
/// looking BACKWARD through history at exact past states: the trajectory
/// charts below plot the currently loaded page across time, and the list
/// underneath is scrubbable — click any past snapshot to inspect its exact
/// rollup values, not just read them off a chart's hover tooltip. This is
/// the concrete realization of Laura's own early "Interaction Replay flight
/// recorder" framing for this project.
export function Flugschreiber({ onOpenConversation }: { onOpenConversation?: (conversationId: string) => void } = {}) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [range, setRange] = useState('30d')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const load = async (offset: number, append: boolean) => {
    if (append) setLoadingMore(true); else setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset), range })
      const res = await fetch(`${API_BASE}/api/observatory/snapshots?${params}`, { headers: authHeaders() })
      if (!res.ok) throw new Error(String(res.status))
      const totalHeader = res.headers.get('X-Total-Count')
      const page: Snapshot[] = await res.json()
      setSnapshots(prev => (append ? [...prev, ...page] : page))
      setTotal(totalHeader !== null ? Number(totalHeader) : null)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  // A range change starts over from the newest page — "Weitere laden" below
  // is the only path that appends.
  useEffect(() => {
    load(0, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range])

  const loadMore = () => load(snapshots.length, true)
  // Tied to the actual user action (not synchronized via a second effect on
  // `range`): a selected snapshot from the previous range might not even be
  // in the new page anymore.
  const changeRange = (next: string) => { setRange(next); setSelectedId(null) }

  if (loading && snapshots.length === 0) return <div className="obs-panel"><HudSkeleton variant="panel" /></div>
  if (error && snapshots.length === 0) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>

  // The API returns newest-first (right for the scrub list below — most
  // recent snapshot on top); the trajectory charts read left-to-right as
  // "earlier → later", so they need the chronological reverse of that.
  const chronological = [...snapshots].reverse()
  const chartData = (fn: (s: Snapshot) => number) =>
    chronological.map(s => ({ label: s.created_at.slice(5, 16), value: fn(s) }))

  const selected = snapshots.find(s => s.id === selectedId) ?? snapshots[0] ?? null

  return (
    <div className="obs-panel">
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={range} onChange={e => changeRange(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
          {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {/* Exports whatever range filter currently narrowed the page to and
            whatever's been loaded so far via "Weitere laden" (`snapshots`) —
            same honesty-about-scope principle as the rest of the app. */}
        <ExportButtons
          rows={snapshots.map(s => ({ ...s }))}
          filenameBase={`flugschreiber-snapshots-${range}`}
          title="Flugschreiber: Snapshots"
        />
      </div>

      {snapshots.length === 0 ? (
        <div className="obs-card">
          <div className="obs-empty">
            Noch keine Snapshots in diesem Zeitraum - sie werden automatisch nach jedem Gesprächsturn aufgezeichnet.
            Ältere Gespräche, die vor dieser Funktion stattfanden, haben ehrlich keine Aufzeichnungshistorie, statt sie
            nachträglich zu erfinden.
          </div>
        </div>
      ) : (
        <>
          {/* Core KPI summary FIRST — direct feedback on this exact module's
              earlier layout: at-a-glance current-state tiles belong above
              the historical trend charts, not buried below them ("die core
              kpis müssen oben drauf, über diesen verlauf der zeit"). Exact
              values of whichever snapshot is selected in the scrub list
              below (defaults to the most recently loaded one), so this
              block doubles as "current state" (default) and "state at any
              past point" (after a scrub-list click) without two separate
              renderings of the same six stat rows. */}
          {selected && (
            <>
              <div className="obs-section-label">Snapshot-Detail: {selected.created_at}</div>

              <HudSectionHeader title="Signale" sub="Nach Herkunft — wie viele Beobachtungen aus welchem Kanal." />
              <HudGrid cols={4}>
                <div className="obs-stat c-purple"><div className="obs-stat-value">{selected.signals_human}</div><div className="obs-stat-label">Human</div></div>
                <div className="obs-stat c-blue"><div className="obs-stat-value">{selected.signals_ai}</div><div className="obs-stat-label">Signale: AI</div></div>
                <div className="obs-stat c-teal"><div className="obs-stat-value">{selected.signals_interaction}</div><div className="obs-stat-label">Signale: Interaction</div></div>
                <div className="obs-stat c-amber"><div className="obs-stat-value">{selected.signals_system}</div><div className="obs-stat-label">System</div></div>
              </HudGrid>

              <HudSectionHeader title="Emergenz-Indikatoren" sub="CCET-Metriken des ausgewählten Snapshots." />
              <HudGrid cols={3}>
                <div className="obs-stat c-green"><div className="obs-stat-value">{formatPercent(selected.cei)}</div><div className="obs-stat-label">CEI</div></div>
                <div className="obs-stat c-purple"><div className="obs-stat-value">{selected.cep}</div><div className="obs-stat-label">CEP</div></div>
                <div className="obs-stat c-teal"><div className="obs-stat-value">{formatPercent(selected.resonance_frequency)}</div><div className="obs-stat-label">Resonance</div></div>
              </HudGrid>

              <HudSectionHeader title="Simulationen" sub="Status der Simulationsläufe zum Snapshot-Zeitpunkt." />
              <HudGrid cols={3}>
                <div className="obs-stat c-amber"><div className="obs-stat-value">{selected.sim_runs_pending}</div><div className="obs-stat-label">Pending</div></div>
                <div className="obs-stat c-green"><div className="obs-stat-value">{selected.sim_runs_complete}</div><div className="obs-stat-label">Complete</div></div>
                <div className="obs-stat c-red"><div className="obs-stat-value">{selected.sim_runs_error}</div><div className="obs-stat-label">Error</div></div>
              </HudGrid>

              <HudSectionHeader title="Aktivität" sub="Jarvis-Output in diesem Zeitfenster." />
              <HudGrid cols={2}>
                <div className="obs-stat c-blue"><div className="obs-stat-value">{selected.research_notes_total}</div><div className="obs-stat-label">Research Notes</div></div>
                <div className="obs-stat c-red"><div className="obs-stat-value">{selected.agent_tool_calls_7d}</div><div className="obs-stat-label">Tool-Aufrufe (7T)</div></div>
              </HudGrid>

              <p style={{ fontSize: 12, color: 'rgba(148,190,199,.65)', marginBottom: 22 }}>
                {selected.trigger_turn_id
                  ? <> · CCET-Turn {selected.trigger_turn_id}</>
                  : ' · kein CCET-Turn verknüpft (z. B. weil zu diesem Zeitpunkt keine NVIDIA-Anbindung konfiguriert war)'}
                .
                {onOpenConversation && (
                  <>
                    {' '}
                    <button
                      className="chat-inspect-toggle"
                      style={{ fontSize: 11, padding: 0 }}
                      onClick={() => onOpenConversation(selected.conversation_id)}
                    >
                      aus Gespräch ↗
                    </button>
                  </>
                )}
              </p>
            </>
          )}

          <div className="obs-section-label">
            Verlauf über die Zeit <span style={{ fontWeight: 400 }}>(geladen: {snapshots.length} von {total ?? '…'})</span>
          </div>

          {/* Six trajectory charts — previously six full-width .obs-card
              rows (each tiny line chart stretched to the viewport). Now a
              fixed 3×2 instrument wall: each chart in its own sized HudTile,
              so the flight-recorder reads as one dense panel, not six
              stacked full-width sparklines. */}
          <HudGrid cols={3}>
            <HudTile title="Signale gesamt" badge="FLUG" accent="var(--obs-purple)" span={1}>
              <ObsChart data={chartData(totalSignals)} color="var(--obs-purple)" gradientId="fs-signals" />
            </HudTile>
            <HudTile title="CEI" badge="CO-EVO" accent="var(--obs-green)" span={1}>
              <ObsChart data={chartData(s => s.cei)} color="var(--obs-green)" gradientId="fs-cei" valueFormat={formatPercent} />
            </HudTile>
            <HudTile title="Resonance" badge="FREQ" accent="var(--obs-teal)" span={1}>
              <ObsChart data={chartData(s => s.resonance_frequency)} color="var(--obs-teal)" gradientId="fs-rf" valueFormat={formatPercent} />
            </HudTile>
            <HudTile title="Simulationen" badge="RUNS" accent="var(--obs-amber)" span={1}>
              <ObsChart data={chartData(totalSimRuns)} color="var(--obs-amber)" gradientId="fs-sims" />
            </HudTile>
            <HudTile title="Research Notes" badge="NOTES" accent="var(--obs-blue)" span={1}>
              <ObsChart data={chartData(s => s.research_notes_total)} color="var(--obs-blue)" gradientId="fs-notes" />
            </HudTile>
            <HudTile title="Jarvis-Tools" badge="7T" accent="var(--obs-red)" span={1}>
              <ObsChart data={chartData(s => s.agent_tool_calls_7d)} color="var(--obs-red)" gradientId="fs-tools" />
            </HudTile>
          </HudGrid>

          <div className="obs-section-label">Snapshots durchblättern</div>
          {snapshots.map((s, i) => (
            <div
              className="obs-item-card"
              key={s.id}
              role="button"
              tabIndex={0}
              style={{ ...hudStagger(i), ['--obs-accent' as string]: s.id === selected?.id ? 'var(--obs-blue)' : '#6b7280', cursor: 'pointer' }}
              onClick={() => setSelectedId(s.id)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setSelectedId(s.id) }}
            >
              <div className="obs-item-title">{s.created_at}{s.id === selected?.id && <span style={{ fontWeight: 400, color: 'var(--obs-blue)' }}> · ausgewählt</span>}</div>
              <div className="obs-item-meta">
                Signale: {totalSignals(s)} · CEI {formatPercent(s.cei)} · Simulationen: {totalSimRuns(s)} · Notes: {s.research_notes_total} · Tools (7T): {s.agent_tool_calls_7d}
              </div>
            </div>
          ))}

          {error && snapshots.length > 0 && (
            <div className="obs-empty" style={{ padding: '8px 0' }}>Fehler beim Nachladen.</div>
          )}
          {total !== null && snapshots.length < total && (
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <button className="panel-add-btn" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Lädt…' : `Weitere laden (${snapshots.length} / ${total})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
