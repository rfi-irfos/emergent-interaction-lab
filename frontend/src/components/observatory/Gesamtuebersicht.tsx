import { useState } from 'react'
import { useAdminFetch } from '../../lib/adminApi'
import { TOOL_LABELS } from '../../lib/toolLabels'
import { foldIntoOther } from '../../lib/chartMath'
import { ExportButtons } from './ExportButtons'
import { HudGrid, HudTile, HudSectionHeader } from './Hud'
import { HudSkeleton } from './HudSkeleton'
import { ObsDonut } from './ObsDonut'
import { ObsGauge } from './ObsGauge'

// "Gesamtübersicht" — Laura's own words, verbatim-translated: "I simply live
// my life, do my projects, and afterward I have ALL my user data spit out
// for me. I think that's the point that's missing the most." Every other
// export in this app is per-module (one table, one CSV) — this is the one
// module that rolls up EVERY table this platform has captured about her
// research activity, in one place, by time. See
// backend/src/observatory.rs's `everything` handler for the exact query
// shapes this renders (each one reused verbatim from the module that
// already owns that table — this page invents no new aggregation, it only
// presents what already exists in one holistic view).
//
// Deliberately still SECTIONED into one card per source table, not a flat
// merged list — Laura should always be able to tell which number came from
// where, matching every other Observatory module's own provenance
// conventions (CCET's own definitions_note, Flugschreiber's "no fabricated
// backfill" framing). An empty section renders its own honest empty state,
// never a placeholder number.

interface ConversationSummary { id: string; title: string; created_at: string; updated_at: string }
interface ChatSection { conversations_total: number; conversations: ConversationSummary[]; user_messages: number; assistant_messages: number }
interface LevelBucket { level: string; count: number }
interface EmergenceSection { total: number; by_level: LevelBucket[] }
interface CategoryBucket { category: string; count: number }
interface ResearchNotesSection { total: number; by_category: CategoryBucket[] }
interface CcetSection { cei: number; cep: number; resonance_frequency: number; turns_considered: number; turns_in_range: number; definitions_note: string }
interface StatusBucket { status: string; count: number }
interface SimulationRunsSection { total: number; by_status: StatusBucket[] }
interface SystemSnapshotsSection { total: number; earliest: string | null; latest: string | null }
interface ToolBucket { tool: string; count: number }
interface AgentToolCallsSection { total: number; by_tool: ToolBucket[] }

interface EverythingData {
  range: string
  chat: ChatSection
  emergence_signals: EmergenceSection
  research_notes: ResearchNotesSection
  ccet: CcetSection
  simulation_runs: SimulationRunsSection
  system_snapshots: SystemSnapshotsSection
  agent_tool_calls: AgentToolCallsSection
}

// Same `?range=7d|30d|all` convention as every other range-filtered
// Observatory module (see backend/src/observatory.rs's resolve_range) — the
// one genuinely different thing about "give me everything from this
// period" versus the per-module exports Laura already had is that this
// filter now applies across every section at once, not just one table.
const RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: '7d', label: 'Letzte 7 Tage' },
  { value: '30d', label: 'Letzte 30 Tage' },
  { value: 'all', label: 'Alle' },
]

const RANGE_SUFFIX: Record<string, string> = { '7d': 'letzte 7 Tage', '30d': 'letzte 30 Tage', all: 'alle' }

function formatPercent(v: number): string {
  return `${Math.round(v * 100)}%`
}

// Same level vocabulary/color assignment as EmergenceMonitor.tsx's own
// LEVEL_DONUT_COLORS — `emergence_signals.by_level` here is that exact same
// aggregation, just re-exposed at the rollup level (see this file's own doc
// comment: "each one reused verbatim from the module that already owns that
// table"), so its donut should read identically, not invent a new mapping.
const LEVEL_DONUT_COLORS: Record<string, string> = {
  human: 'var(--obs-purple)', ai: 'var(--obs-blue)', interaction: 'var(--obs-teal)', system: 'var(--obs-amber)',
}

function Bars<T extends { count: number }>({ rows, labelKey, labelMap, color }: {
  rows: T[]
  labelKey: keyof T
  labelMap?: Record<string, string>
  color: string
}) {
  const max = Math.max(...rows.map(r => r.count), 1)
  return (
    <>
      {rows.map((r, i) => {
        const rawLabel = String(r[labelKey])
        const label = labelMap?.[rawLabel] ?? rawLabel
        return (
          <div className="obs-bar-row" key={i}>
            <span style={{ width: 150, fontSize: 11, color: '#6b7280', fontWeight: 600, flexShrink: 0 }}>{label}</span>
            <div className="obs-bar-track"><div className="obs-bar-fill" style={{ width: `${(r.count / max) * 100}%`, background: color }} /></div>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#3b6bf6', minWidth: 24, textAlign: 'right' }}>{r.count}</span>
          </div>
        )
      })}
    </>
  )
}

export function Gesamtuebersicht() {
  const [range, setRange] = useState('30d')
  const { data, loading, error } = useAdminFetch<EverythingData>(`/api/observatory/everything?range=${range}`, [range])

  if (loading) return <div className="obs-panel"><HudSkeleton variant="panel" /></div>
  if (error) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>
  if (!data) return <div className="obs-panel"><div className="obs-empty">Keine Daten verfügbar.</div></div>

  // One combined, single-row export of every section's headline number —
  // all directly comparable "how much of X happened" totals, so one flat
  // row is honest here (unlike the per-section breakdown lists below, which
  // have genuinely different shapes from each other and would just become
  // a sparse, confusing table if forced into one sheet together).
  const summaryRow = [{
    range: data.range,
    conversations_total: data.chat.conversations_total,
    user_messages: data.chat.user_messages,
    assistant_messages: data.chat.assistant_messages,
    emergence_signals_total: data.emergence_signals.total,
    research_notes_total: data.research_notes.total,
    ccet_cei: data.ccet.cei,
    ccet_cep: data.ccet.cep,
    ccet_resonance_frequency: data.ccet.resonance_frequency,
    ccet_turns_in_range: data.ccet.turns_in_range,
    simulation_runs_total: data.simulation_runs.total,
    system_snapshots_total: data.system_snapshots.total,
    agent_tool_calls_total: data.agent_tool_calls.total,
  }]

  return (
    <div className="obs-panel">
      <HudSectionHeader
        title="Gesamtübersicht"
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={range} onChange={e => setRange(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
              {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ExportButtons rows={summaryRow} filenameBase={`gesamtuebersicht-zusammenfassung-${range}`} title={`Gesamtübersicht — Zusammenfassung (${RANGE_SUFFIX[data.range] ?? data.range})`} />
          </div>
        }
      />

      {/* ── Chat (chat_conversations / chat_messages) — three cards only;
          the raw conversation list below this used to duplicate what
          Forschung's own sidebar already shows, with zero added value. */}
      <div className="obs-section-label">Forschungsgespräche</div>
      <div className="obs-grid" style={{ marginBottom: 22 }}>
        <div className="obs-stat c-blue"><div className="obs-stat-value">{data.chat.conversations_total}</div><div className="obs-stat-label">Gespräche</div></div>
        <div className="obs-stat c-purple"><div className="obs-stat-value">{data.chat.user_messages}</div><div className="obs-stat-label">Nachrichten (Laura)</div></div>
        <div className="obs-stat c-teal"><div className="obs-stat-value">{data.chat.assistant_messages}</div><div className="obs-stat-label">Antworten (Jarvis)</div></div>
      </div>

      {/* ── Everything else: one uniform 3-across grid of same-size tiles —
          no per-tile export/filter controls (the single range selector +
          export in the page header above governs the whole page, full
          stop), no mixed span=4/2/1 sizes. */}
      <HudGrid cols={3}>
        <HudTile title="Emergenzsignale" badge="EBENE" accent="var(--obs-purple)" span={1}>
          <div style={{ fontSize: 12, color: '#9aa0a8', marginBottom: 8 }}>{data.emergence_signals.total} Signale gesamt</div>
          {data.emergence_signals.by_level.length === 0
            ? <div className="obs-empty">Keine Emergenzsignale in diesem Zeitraum.</div>
            : (
              <ObsDonut
                data={data.emergence_signals.by_level.map(b => ({ label: b.level, value: b.count, color: LEVEL_DONUT_COLORS[b.level] }))}
                gradientIdPrefix="gesamtuebersicht-emergence-level"
              />
            )
          }
        </HudTile>

        <HudTile title="Research Notes" badge="KAT" accent="var(--obs-blue)" span={1}>
          <div style={{ fontSize: 12, color: '#9aa0a8', marginBottom: 8 }}>{data.research_notes.total} Notes gesamt</div>
          {data.research_notes.by_category.length === 0
            ? <div className="obs-empty">Keine Research Notes in diesem Zeitraum.</div>
            : (
              <ObsDonut
                data={foldIntoOther(data.research_notes.by_category.map(b => ({ label: b.category, value: b.count })))}
                gradientIdPrefix="gesamtuebersicht-research-category"
              />
            )
          }
        </HudTile>

        <HudTile title="Jarvis-Werkzeuge" badge="TOOL" accent="var(--obs-red)" span={1}>
          <div style={{ fontSize: 12, color: '#9aa0a8', marginBottom: 8 }}>{data.agent_tool_calls.total} Aufrufe gesamt</div>
          {data.agent_tool_calls.by_tool.length === 0
            ? <div className="obs-empty">Keine Werkzeugaufrufe in diesem Zeitraum.</div>
            : (
              <ObsDonut
                data={foldIntoOther(data.agent_tool_calls.by_tool.map(b => ({ label: TOOL_LABELS[b.tool] ?? b.tool, value: b.count })))}
                gradientIdPrefix="gesamtuebersicht-tool-calls"
              />
            )
          }
        </HudTile>

        <HudTile title="CCET — Co-Evolution" badge="KENNZ" accent="var(--obs-green)" span={3}>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
            <ObsGauge value={data.ccet.cei} label="CEI" color="var(--obs-green)" valueFormat={formatPercent} />
            <ObsGauge value={data.ccet.resonance_frequency} label="Resonance Frequency" color="var(--obs-teal)" valueFormat={formatPercent} />
            <div className="obs-stat c-purple" style={{ flex: '0 1 150px' }}><div className="obs-stat-value">{data.ccet.cep}</div><div className="obs-stat-label">CEP</div></div>
            <div className="obs-stat c-amber" style={{ flex: '0 1 150px' }}><div className="obs-stat-value">{data.ccet.turns_in_range}</div><div className="obs-stat-label">Turns im Zeitraum</div></div>
          </div>
          <p style={{ fontSize: 11, color: '#9aa0a8', lineHeight: 1.6, margin: 0 }}>{data.ccet.definitions_note}</p>
        </HudTile>

        <HudTile title="Simulationen" badge="STATUS" accent="var(--obs-amber)" span={1}>
          <div style={{ fontSize: 12, color: '#9aa0a8', marginBottom: 8 }}>{data.simulation_runs.total} Simulationen gesamt</div>
          {data.simulation_runs.by_status.length === 0
            ? <div className="obs-empty">Keine Simulationsläufe in diesem Zeitraum.</div>
            : <Bars rows={data.simulation_runs.by_status} labelKey="status" color="linear-gradient(90deg, #f59e0b, #fbbf24)" />
          }
        </HudTile>

        <HudTile title="Flugschreiber" badge="SNAP" accent="var(--obs-blue)" span={2}>
          <div className="obs-grid">
            <div className="obs-stat c-blue"><div className="obs-stat-value">{data.system_snapshots.total}</div><div className="obs-stat-label">Snapshots im Zeitraum</div></div>
          </div>
          {data.system_snapshots.total === 0
            ? <div className="obs-empty" style={{ marginTop: 8 }}>Keine Snapshots in diesem Zeitraum.</div>
            : (
              <p style={{ fontSize: 12, color: '#9aa0a8', marginTop: 8 }}>
                Zeitraum der aufgezeichneten Snapshots: {data.system_snapshots.earliest} bis {data.system_snapshots.latest}.
              </p>
            )
          }
        </HudTile>
      </HudGrid>

      <p style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.6 }}>
        Geschäfts-/Zahlungsdaten (Stripe-Bestellungen) sind hier bewusst nicht enthalten — das ist ein separates
        Verwaltungs-Thema, kein Forschungsinteraktionsdatum. Siehe Monetarisierung → Bestellungen.
      </p>
    </div>
  )
}
