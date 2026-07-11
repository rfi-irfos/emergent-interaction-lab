import { useState } from 'react'
import { useAdminFetch } from '../../lib/adminApi'
import { TOOL_LABELS } from '../../lib/toolLabels'
import { ExportButtons } from './ExportButtons'

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

export function Gesamtuebersicht({ onOpenConversation }: { onOpenConversation?: (conversationId: string) => void } = {}) {
  const [range, setRange] = useState('30d')
  const { data, loading, error } = useAdminFetch<EverythingData>(`/api/observatory/everything?range=${range}`, [range])

  if (loading) return <div className="obs-panel"><div className="obs-empty">Lade…</div></div>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <p style={{ fontSize: 12, color: '#9aa0a8', margin: 0, maxWidth: 520 }}>
          Alles, was diese Plattform über deine Forschungsaktivität aufgezeichnet hat, an einem Ort — nach Quelltabelle
          getrennt, damit jede Zahl nachvollziehbar bleibt, gefiltert auf {RANGE_SUFFIX[data.range] ?? data.range}.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={range} onChange={e => setRange(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
            {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <ExportButtons rows={summaryRow} filenameBase={`gesamtuebersicht-zusammenfassung-${range}`} title={`Gesamtübersicht — Zusammenfassung (${RANGE_SUFFIX[data.range] ?? data.range})`} />
        </div>
      </div>

      {/* ── Chat (chat_conversations / chat_messages) ─────────────────── */}
      <div className="obs-section-label">Forschungsgespräche</div>
      <div className="obs-grid" style={{ marginBottom: 8 }}>
        <div className="obs-stat c-blue"><div className="obs-stat-value">{data.chat.conversations_total}</div><div className="obs-stat-label">Gespräche</div></div>
        <div className="obs-stat c-purple"><div className="obs-stat-value">{data.chat.user_messages}</div><div className="obs-stat-label">Nachrichten (Laura)</div></div>
        <div className="obs-stat c-teal"><div className="obs-stat-value">{data.chat.assistant_messages}</div><div className="obs-stat-label">Antworten (Jarvis)</div></div>
      </div>
      <div className="obs-card">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <ExportButtons rows={data.chat.conversations.map(c => ({ ...c }))} filenameBase={`gesamtuebersicht-gespraeche-${range}`} title="Gesamtübersicht — Forschungsgespräche" />
        </div>
        {data.chat.conversations.length === 0
          ? <div className="obs-empty">Keine Gespräche in diesem Zeitraum.</div>
          : data.chat.conversations.map(c => (
              <div className="obs-item-card" key={c.id}>
                <div className="obs-item-title">{c.title}</div>
                <div className="obs-item-meta">
                  {c.created_at} · zuletzt aktualisiert {c.updated_at}
                  {onOpenConversation && (
                    <>
                      {' · '}
                      <button className="chat-inspect-toggle" style={{ fontSize: 11, padding: 0 }} onClick={() => onOpenConversation(c.id)}>
                        öffnen ↗
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
        }
      </div>

      {/* ── Emergence Signals (emergence_signals) ─────────────────────── */}
      <div className="obs-section-label">Emergenzsignale nach Ebene</div>
      <div className="obs-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#9aa0a8' }}>{data.emergence_signals.total} Signale gesamt</span>
          <ExportButtons rows={data.emergence_signals.by_level.map(r => ({ ...r }))} filenameBase={`gesamtuebersicht-emergenzsignale-${range}`} title="Gesamtübersicht — Emergenzsignale nach Ebene" />
        </div>
        {data.emergence_signals.by_level.length === 0
          ? <div className="obs-empty">Keine Emergenzsignale in diesem Zeitraum.</div>
          : <Bars rows={data.emergence_signals.by_level} labelKey="level" color="linear-gradient(90deg, #8b5cf6, #a78bfa)" />
        }
      </div>

      {/* ── Research Notes (research_notes) ────────────────────────────── */}
      <div className="obs-section-label">Research Notes nach Kategorie</div>
      <div className="obs-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#9aa0a8' }}>{data.research_notes.total} Notes gesamt</span>
          <ExportButtons rows={data.research_notes.by_category.map(r => ({ ...r }))} filenameBase={`gesamtuebersicht-research-notes-${range}`} title="Gesamtübersicht — Research Notes nach Kategorie" />
        </div>
        {data.research_notes.by_category.length === 0
          ? <div className="obs-empty">Keine Research Notes in diesem Zeitraum.</div>
          : <Bars rows={data.research_notes.by_category} labelKey="category" color="linear-gradient(90deg, #3b6bf6, #6d92f9)" />
        }
      </div>

      {/* ── CCET (ccet_turns) ──────────────────────────────────────────── */}
      <div className="obs-section-label">CCET — Co-Evolution-Kennzahlen</div>
      <div className="obs-card">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <ExportButtons
            rows={[{ cei: data.ccet.cei, cep: data.ccet.cep, resonance_frequency: data.ccet.resonance_frequency, turns_considered: data.ccet.turns_considered, turns_in_range: data.ccet.turns_in_range }]}
            filenameBase={`gesamtuebersicht-ccet-${range}`}
            title="Gesamtübersicht — CCET"
          />
        </div>
        <div className="obs-grid" style={{ marginBottom: 8 }}>
          <div className="obs-stat c-green"><div className="obs-stat-value">{formatPercent(data.ccet.cei)}</div><div className="obs-stat-label">CEI</div></div>
          <div className="obs-stat c-purple"><div className="obs-stat-value">{data.ccet.cep}</div><div className="obs-stat-label">CEP</div></div>
          <div className="obs-stat c-teal"><div className="obs-stat-value">{formatPercent(data.ccet.resonance_frequency)}</div><div className="obs-stat-label">Resonance Frequency</div></div>
          <div className="obs-stat c-amber"><div className="obs-stat-value">{data.ccet.turns_in_range}</div><div className="obs-stat-label">Turns im Zeitraum</div></div>
        </div>
        <p style={{ fontSize: 11, color: '#9aa0a8', lineHeight: 1.6, margin: 0 }}>{data.ccet.definitions_note}</p>
      </div>

      {/* ── Simulation Runs (simulation_runs) ──────────────────────────── */}
      <div className="obs-section-label">Simulationen nach Status</div>
      <div className="obs-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#9aa0a8' }}>{data.simulation_runs.total} Simulationen gesamt</span>
          <ExportButtons rows={data.simulation_runs.by_status.map(r => ({ ...r }))} filenameBase={`gesamtuebersicht-simulationen-${range}`} title="Gesamtübersicht — Simulationen nach Status" />
        </div>
        {data.simulation_runs.by_status.length === 0
          ? <div className="obs-empty">Keine Simulationsläufe in diesem Zeitraum.</div>
          : <Bars rows={data.simulation_runs.by_status} labelKey="status" color="linear-gradient(90deg, #f59e0b, #fbbf24)" />
        }
      </div>

      {/* ── System Snapshots / Flugschreiber (system_snapshots) ────────── */}
      <div className="obs-section-label">Flugschreiber — Snapshots</div>
      <div className="obs-card">
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
      </div>

      {/* ── Agent Tool Calls (agent_tool_calls) ────────────────────────── */}
      <div className="obs-section-label">Jarvis-Werkzeugaufrufe nach Werkzeug</div>
      <div className="obs-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#9aa0a8' }}>{data.agent_tool_calls.total} Aufrufe gesamt</span>
          <ExportButtons rows={data.agent_tool_calls.by_tool.map(r => ({ ...r }))} filenameBase={`gesamtuebersicht-werkzeugaufrufe-${range}`} title="Gesamtübersicht — Jarvis-Werkzeugaufrufe" />
        </div>
        {data.agent_tool_calls.by_tool.length === 0
          ? <div className="obs-empty">Keine Werkzeugaufrufe in diesem Zeitraum.</div>
          : <Bars rows={data.agent_tool_calls.by_tool} labelKey="tool" labelMap={TOOL_LABELS} color="linear-gradient(90deg, #ef4444, #f87171)" />
        }
      </div>

      <p style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.6 }}>
        Geschäfts-/Zahlungsdaten (Stripe-Bestellungen) sind hier bewusst nicht enthalten — das ist ein separates
        Verwaltungs-Thema, kein Forschungsinteraktionsdatum. Siehe Monetarisierung → Bestellungen.
      </p>
    </div>
  )
}
