import { useState } from 'react'
import { useAdminFetch } from '../../lib/adminApi'
import { TOOL_LABELS } from '../../lib/toolLabels'
import { foldIntoOther } from '../../lib/chartMath'
import { ExportButtons } from './ExportButtons'
import { HudGrid, HudTile, useHeaderActions, HudHeaderActions } from './Hud'
import { HudSkeleton } from './HudSkeleton'
import { ObsDonut } from './ObsDonut'

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

// A plain percentage bar row — same .obs-bar-row/.obs-bar-track/.obs-bar-fill
// language as Bars() below, just for a single already-known 0-1 fraction
// instead of a list of counts. Replaces CCET's two ObsGauge circles: at
// this card's actual width (one of three equal cards in a row, not a full-
// width tile of its own) a gauge's ring was too small for its own center
// label to align inside it — a bar reads correctly at any width.
function PercentBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="obs-bar-row">
      <span style={{ width: 76, fontSize: 11, color: '#6b7280', fontWeight: 600, flexShrink: 0 }}>{label}</span>
      <div className="obs-bar-track"><div className="obs-bar-fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} /></div>
      <span style={{ fontSize: 11, fontWeight: 800, color: '#3b6bf6', minWidth: 34, textAlign: 'right' }}>{formatPercent(value)}</span>
    </div>
  )
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

  // One combined, single-row export of every section's headline number —
  // all directly comparable "how much of X happened" totals, so one flat
  // row is honest here (unlike the per-section breakdown lists below, which
  // have genuinely different shapes from each other and would just become
  // a sparse, confusing table if forced into one sheet together).
  const summaryRow = data ? [{
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
  }] : []

  // No visible header of its own — this stacks directly below Analytics on
  // the same page, so a second title/actions block here would read as two
  // stitched-together apps rather than one coherent page. The range filter
  // + the one export action button push into the SAME shared top-of-page
  // header Analytics itself sits under (see useHeaderActions/Hud.tsx),
  // which is also why the filter/action row now always renders at the true
  // top of the page rather than floating mid-scroll.
  useHeaderActions(
    data ? (
      <HudHeaderActions
        filters={
          <select value={range} onChange={e => setRange(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
            {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        }
        action={<ExportButtons rows={summaryRow} filenameBase={`gesamtuebersicht-zusammenfassung-${range}`} title={`Gesamtübersicht — Zusammenfassung (${RANGE_SUFFIX[data.range] ?? data.range})`} />}
      />
    ) : null,
    [range, data],
  )

  if (loading) return <div className="obs-panel"><HudSkeleton variant="panel" /></div>
  if (error) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>
  if (!data) return <div className="obs-panel"><div className="obs-empty">Keine Daten verfügbar.</div></div>

  return (
    <div className="obs-panel">

      {/* No section label, no separating gap — card directly next to card,
          flowing straight into the grid below instead of reading as its own
          boxed-off section. The raw conversation list that used to sit here
          duplicated what Forschung's own sidebar already shows, zero added
          value, so it's gone — these three numbers are what's left. */}
      <div className="obs-grid" style={{ marginBottom: 14 }}>
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

        {/* CCET/Simulationen/Flugschreiber — three equal cards in one row,
            not one oversized full-width tile plus two mismatched leftovers.
            CCET's two ObsGauge circles are gone: at one-third-row width a
            gauge's ring is too small for its own center label to sit inside
            it cleanly (confirmed broken on the live page) — a percentage
            bar reads correctly at any width, same idiom Simulationen's own
            status breakdown already uses. */}
        <HudTile
          title="CCET — Co-Evolution"
          badge="KENNZ"
          accent="var(--obs-green)"
          span={1}
        >
          <div
            style={{ fontSize: 11, color: '#9aa0a8', marginBottom: 10, cursor: 'help' }}
            title={data.ccet.definitions_note}
          >
            {data.ccet.turns_in_range} Turns im Zeitraum · {data.ccet.cep} CEP
          </div>
          <PercentBar label="CEI" value={data.ccet.cei} color="var(--obs-green)" />
          <PercentBar label="Resonanz" value={data.ccet.resonance_frequency} color="var(--obs-teal)" />
        </HudTile>

        <HudTile title="Simulationen" badge="STATUS" accent="var(--obs-amber)" span={1}>
          <div style={{ fontSize: 12, color: '#9aa0a8', marginBottom: 8 }}>{data.simulation_runs.total} Simulationen gesamt</div>
          {data.simulation_runs.by_status.length === 0
            ? <div className="obs-empty">Keine Simulationsläufe in diesem Zeitraum.</div>
            : <Bars rows={data.simulation_runs.by_status} labelKey="status" color="linear-gradient(90deg, #f59e0b, #fbbf24)" />
          }
        </HudTile>

        <HudTile title="Flugschreiber" badge="SNAP" accent="var(--obs-blue)" span={1}>
          <div className="obs-stat c-blue" style={{ marginBottom: 8 }}><div className="obs-stat-value">{data.system_snapshots.total}</div><div className="obs-stat-label">Snapshots im Zeitraum</div></div>
          {data.system_snapshots.total === 0
            ? <div className="obs-empty">Keine Snapshots in diesem Zeitraum.</div>
            : (
              <p style={{ fontSize: 11, color: '#9aa0a8', lineHeight: 1.5, margin: 0 }}>
                {data.system_snapshots.earliest} bis {data.system_snapshots.latest}.
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
