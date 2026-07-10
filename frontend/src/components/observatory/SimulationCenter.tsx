import { useState } from 'react'
import { useAdminFetch } from '../../lib/adminApi'
import { SimulationLab } from './SimulationLab'
import type { AdminSection } from '../../types/admin'

interface RunOut {
  id: string
  hypothesis: string
  parameters: string
  narrative: string | null
  status: string
  created_at: string
  related_signal_ids: string[] | null
}

// Minimal shape read out of /api/observatory/emergence/signals — just
// enough to label a linked run with which signal it explores. The full
// signal record (observation/confidence/evolution/etc.) lives in
// EmergenceMonitor; clicking through takes you there.
export interface SignalRef {
  id: string
  pattern: string
  scope: string | null
  created_at: string
}

function formatParams(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
}

function RunColumn({ run, signals, onNavigate }: { run: RunOut | null; signals: SignalRef[]; onNavigate?: (s: AdminSection) => void }) {
  if (!run) return <div className="obs-item-card obs-compare-empty"><div className="obs-empty">Lauf auswählen…</div></div>
  const related = (run.related_signal_ids ?? [])
    .map(id => signals.find(s => s.id === id))
    .filter((s): s is SignalRef => Boolean(s))
  return (
    <div className="obs-item-card">
      <div className="obs-item-title">{run.hypothesis}</div>
      <div className="obs-item-meta">{run.status} · {run.created_at}</div>
      {related.length > 0 && (
        <div className="obs-item-meta" style={{ marginTop: -2 }}>
          {related.map(s => (
            <button
              key={s.id}
              type="button"
              className="chat-inspect-toggle"
              style={{ fontSize: 11, padding: 0, marginRight: 8 }}
              onClick={() => onNavigate?.('emergence')}
            >
              Signal: {s.pattern} ↗
            </button>
          ))}
        </div>
      )}
      <div className="obs-compare-label">Parameter</div>
      <pre className="obs-compare-pre">{formatParams(run.parameters)}</pre>
      {run.narrative && (
        <>
          <div className="obs-compare-label">Ergebnis</div>
          <div className="obs-item-body">{run.narrative}</div>
        </>
      )}
    </div>
  )
}

// Cap how many compare slots can be open at once — N-way, not unbounded;
// beyond this the horizontal-scroll fallback in .obs-compare-grid would be
// doing all the work anyway, so a hard ceiling keeps the picker row sane.
const MAX_COMPARE = 6

/// Simulation is its own Kernbereich, not a sub-panel of Research Pulse —
/// promoted out per the plan (see ResearchPulse.tsx, which now just links
/// here instead of embedding <SimulationLab> directly). The compare view
/// needs no new schema or query: list_runs already returns everything
/// (hypothesis/parameters/narrative/status/related_signal_ids) a
/// side-by-side comparison needs. Extended from a fixed 2-column A/B view
/// to N runs at once (see plan item 8) — slots are added/removed, not a
/// hardcoded pair.
export function SimulationCenter({ onNavigate }: { onNavigate?: (s: AdminSection) => void } = {}) {
  const { data, loading } = useAdminFetch<RunOut[]>('/api/simulation/runs')
  const { data: signalsData } = useAdminFetch<SignalRef[]>('/api/observatory/emergence/signals')
  const [overrideRuns, setOverrideRuns] = useState<RunOut[] | null>(null)
  const runs = overrideRuns ?? data ?? []
  const signals = signalsData ?? []
  const [compareIds, setCompareIds] = useState<string[]>(['', ''])

  const setCompareId = (idx: number, value: string) => {
    setCompareIds(ids => ids.map((v, i) => (i === idx ? value : v)))
  }
  const addCompareSlot = () => setCompareIds(ids => (ids.length < MAX_COMPARE ? [...ids, ''] : ids))
  const removeCompareSlot = (idx: number) => setCompareIds(ids => (ids.length > 1 ? ids.filter((_, i) => i !== idx) : ids))

  return (
    <div className="obs-panel">
      <div className="obs-section-label">Aktive Simulationen</div>
      <SimulationLab runs={runs} loading={loading} onRunsChange={setOverrideRuns} signals={signals} onNavigate={onNavigate} />

      <div className="obs-section-label" style={{ marginTop: 24 }}>
        Vergleich{compareIds.length > 2 ? ` (${compareIds.length} Läufe)` : ''}
      </div>
      <div className="obs-form" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        {compareIds.map((id, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 200px' }}>
            <select value={id} onChange={e => setCompareId(idx, e.target.value)} style={{ flex: 1 }}>
              <option value="">Lauf {String.fromCharCode(65 + idx)} wählen…</option>
              {runs.map(r => <option key={r.id} value={r.id}>{r.hypothesis} ({r.created_at})</option>)}
            </select>
            {compareIds.length > 1 && (
              <button
                type="button"
                className="chat-inspect-toggle"
                style={{ fontSize: 14 }}
                onClick={() => removeCompareSlot(idx)}
                title="Slot entfernen"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {compareIds.length < MAX_COMPARE && (
          <button type="button" className="panel-add-btn" onClick={addCompareSlot}>+ Lauf hinzufügen</button>
        )}
      </div>
      <div className="obs-compare-grid" style={{ ['--obs-compare-cols' as string]: compareIds.length }}>
        {compareIds.map((id, idx) => (
          <RunColumn key={idx} run={runs.find(r => r.id === id) ?? null} signals={signals} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  )
}
