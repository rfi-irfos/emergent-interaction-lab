import { useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders } from '../../lib/adminApi'
import type { AdminSection } from '../../types/admin'
import type { SignalRef } from './SimulationCenter'

// One option within a branching decision run ("either the team does A
// because ..., or B because ..."). Mirrors backend/src/simulation.rs's
// `Branch` exactly: server-assigned `id`, client-supplied `option`/
// `rationale`, and its own `narrative`/`status` — a branch resolving to
// 'error' doesn't take the run or its sibling branches down with it.
export interface BranchOut {
  id: string
  option: string
  rationale: string
  narrative: string | null
  status: string
}

interface RunOut {
  id: string
  hypothesis: string
  parameters: string
  narrative: string | null
  status: string
  created_at: string
  related_signal_ids: string[] | null
  branches: BranchOut[] | null
}

// Hoisted to module scope (was a local const before) and exported so
// SimulationCenter's status filter dropdown lists exactly the same three
// values this file already renders distinct pill colors for — one source of
// truth for the closed pending/complete/error vocabulary instead of two.
// Branches use the exact same pending/complete/error vocabulary (see
// `Branch` in simulation.rs), so `BranchesList` below reuses this map too
// instead of inventing a second color scheme for the same three states.
export const STATUS_ACCENT: Record<string, string> = { pending: '#f59e0b', complete: '#10b981', error: '#ef4444' }

// Shared by this file's own run list and SimulationCenter's compare/detail
// view (RunColumn) — one rendering for "a run's branches", not two copies
// that could drift. Deliberately reuses obs-item-card/obs-pill (the exact
// primitives the top-level run card above already renders its own status
// with) rather than introducing new styling: a branch is "one option within
// the decision", not a new visual language.
export function BranchesList({ branches }: { branches: BranchOut[] }) {
  if (branches.length === 0) return null
  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="obs-compare-label">Zweige</div>
      {branches.map(b => (
        <div
          className="obs-item-card"
          key={b.id}
          style={{ ['--obs-accent' as string]: STATUS_ACCENT[b.status] ?? '#3b6bf6', padding: '10px 12px' }}
        >
          <div className="obs-item-title" style={{ fontSize: 12.5 }}>{b.option}</div>
          <div className="obs-item-meta">
            <span
              className="obs-pill"
              style={{ background: `${STATUS_ACCENT[b.status] ?? '#3b6bf6'}1a`, color: STATUS_ACCENT[b.status] ?? '#3b6bf6' }}
            >
              {b.status}
            </span>
          </div>
          {b.rationale && <div className="obs-item-body" style={{ fontStyle: 'italic' }}>{b.rationale}</div>}
          {b.narrative && <div className="obs-item-body" style={{ marginTop: 6 }}>{b.narrative}</div>}
        </div>
      ))}
    </div>
  )
}

interface SimulationLabProps {
  runs: RunOut[]
  loading: boolean
  loadingMore: boolean
  /// True only once some runs are already showing and a subsequent fetch
  /// (filter change or "Weitere laden") failed — SimulationCenter itself
  /// already renders the full-page error state for a first-load failure
  /// (honest fetch-error state, see #41), so this is just the inline note
  /// for a failure past that point.
  error: boolean
  total: number | null
  onLoadMore: () => void
  /// Called after a successful create or delete — the parent
  /// (SimulationCenter) owns the actual runs/pagination state and refetches
  /// page one, since a new run is always the newest and a deleted one
  /// should just disappear from wherever it was.
  onRefresh: () => void
  signals: SignalRef[]
  onNavigate?: (s: AdminSection) => void
}

export function SimulationLab({ runs: list, loading, loadingMore, error, total, onLoadMore, onRefresh, signals, onNavigate }: SimulationLabProps) {
  const [hypothesis, setHypothesis] = useState('')
  const [parameters, setParameters] = useState('')
  const [selectedSignalIds, setSelectedSignalIds] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // Optional branching decision on the run being authored — e.g. Laura's own
  // example, "either the team does A because ..., or B because ...". Empty
  // means the default flat hypothesis+narrative case (v1 is a single level
  // of branching: a 2-3-way decision point, not deep nesting).
  const [branchRows, setBranchRows] = useState<{ option: string; rationale: string }[]>([])

  const toggleSignal = (id: string) => {
    setSelectedSignalIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]))
  }

  const addBranching = () => setBranchRows([{ option: '', rationale: '' }, { option: '', rationale: '' }])
  const addBranchRow = () => setBranchRows(rows => [...rows, { option: '', rationale: '' }])
  // A decision needs at least two options — removing down to one isn't a
  // decision anymore, so dropping below 2 clears the section entirely
  // (back to "+ Verzweigung hinzufügen") rather than leaving a lone option.
  const removeBranchRow = (idx: number) => setBranchRows(rows => (rows.length <= 2 ? [] : rows.filter((_, i) => i !== idx)))
  const updateBranchRow = (idx: number, field: 'option' | 'rationale', value: string) =>
    setBranchRows(rows => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)))
  // Either no branching at all, or a real 2+-way decision with every option
  // actually labeled — an unlabeled option isn't a real branch to send.
  const branchesValid = branchRows.length === 0 || (branchRows.length >= 2 && branchRows.every(r => r.option.trim()))

  const submit = async () => {
    if (!hypothesis.trim() || running || !branchesValid) return
    setRunning(true)
    let paramsJson: unknown = {}
    if (parameters.trim()) {
      try { paramsJson = JSON.parse(parameters) } catch { paramsJson = { note: parameters } }
    }
    try {
      await fetch(`${API_BASE}/api/simulation/runs`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          hypothesis,
          parameters: paramsJson,
          related_signal_ids: selectedSignalIds.length ? selectedSignalIds : undefined,
          branches: branchRows.length >= 2
            ? branchRows.map(r => ({ option: r.option.trim(), rationale: r.rationale.trim() }))
            : undefined,
        }),
      })
      onRefresh()
      setHypothesis(''); setParameters(''); setSelectedSignalIds([]); setBranchRows([])
    } finally {
      setRunning(false)
    }
  }

  // The backend does an unconditional hard delete (no soft-delete, no
  // status guard — see simulation::delete_run) and until now nothing in the
  // frontend ever called it at all (confirmed dead capability, not just
  // unused UI). A native confirm() is the same deliberately minimal pattern
  // BlogDrafts.tsx uses for its delete button, adopted here after that
  // incident: this codebase has no custom modal, so a second explicit step
  // before an unrecoverable action is the whole point.
  const remove = async (id: string, hypothesisText: string) => {
    if (!window.confirm(`„${hypothesisText}" endgültig löschen?\n\nDas kann nicht rückgängig gemacht werden.`)) return
    setDeletingId(id)
    try {
      await fetch(`${API_BASE}/api/simulation/runs/${id}`, { method: 'DELETE', headers: authHeaders() })
      onRefresh()
    } finally {
      setDeletingId(null)
    }
  }

  // Signals already come back newest-first (list_signals ORDER BY
  // created_at DESC) — a run almost always explores something recent, not
  // the full backlog, so the picker only shows a short recent slice.
  const recentSignals = signals.slice(0, 10)

  return (
    <div className="obs-panel">
      <div className="obs-card">
        <div className="obs-form" style={{ marginBottom: 0 }}>
          <input placeholder="Hypothese, z.B. „Mehr Kontext führt zu stabileren Mensch-KI-Interaktionen“" value={hypothesis} onChange={e => setHypothesis(e.target.value)} />
          <textarea placeholder="Parameter (optional, freier Text oder JSON)" value={parameters} onChange={e => setParameters(e.target.value)} />
          <div>
            <div className="obs-compare-label" style={{ margin: '2px 0 6px' }}>Verzweigte Entscheidung (optional)</div>
            {branchRows.length === 0 ? (
              <button type="button" className="panel-add-btn" style={{ alignSelf: 'flex-start' }} onClick={addBranching}>
                + Verzweigung hinzufügen
              </button>
            ) : (
              <>
                {branchRows.map((b, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                    <input
                      placeholder={`Option ${String.fromCharCode(65 + idx)}, z.B. „Team macht A“`}
                      value={b.option}
                      onChange={e => updateBranchRow(idx, 'option', e.target.value)}
                      style={{ flex: '1 1 40%' }}
                    />
                    <input
                      placeholder="Begründung, z.B. „weil A schneller skaliert“"
                      value={b.rationale}
                      onChange={e => updateBranchRow(idx, 'rationale', e.target.value)}
                      style={{ flex: '1 1 50%' }}
                    />
                    <button
                      type="button"
                      className="chat-inspect-toggle"
                      style={{ fontSize: 14 }}
                      onClick={() => removeBranchRow(idx)}
                      title="Option entfernen"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button type="button" className="panel-add-btn" style={{ alignSelf: 'flex-start' }} onClick={addBranchRow}>
                  + weitere Option
                </button>
              </>
            )}
          </div>
          {recentSignals.length > 0 && (
            <div>
              <div className="obs-compare-label" style={{ margin: '2px 0 6px' }}>Verknüpfte Signale (optional)</div>
              {recentSignals.map(s => (
                <label key={s.id} className="panel-checkbox" style={{ fontSize: 12, marginBottom: 4 }}>
                  <input type="checkbox" checked={selectedSignalIds.includes(s.id)} onChange={() => toggleSignal(s.id)} />
                  {s.pattern}
                  {s.scope && <span style={{ color: '#9aa0a8' }}> · {s.scope}</span>}
                </label>
              ))}
            </div>
          )}
          <button className="panel-add-btn" style={{ alignSelf: 'flex-start' }} onClick={submit} disabled={running || !hypothesis.trim() || !branchesValid}>
            {running ? 'Denkt nach…' : 'Simulation starten'}
          </button>
        </div>
      </div>

      <div className="obs-section-label">Bisherige Läufe</div>
      {loading && list.length === 0 && <div className="obs-empty">Lade…</div>}
      {list.length === 0 && !loading && <div className="obs-empty">Noch keine Simulationen.</div>}
      {list.map(r => {
        const related = (r.related_signal_ids ?? [])
          .map(id => signals.find(s => s.id === id))
          .filter((s): s is SignalRef => Boolean(s))
        return (
          <div className="obs-item-card" key={r.id} style={{ ['--obs-accent' as string]: STATUS_ACCENT[r.status] ?? '#3b6bf6' }}>
            <div className="obs-item-title">{r.hypothesis}</div>
            <div className="obs-item-meta">
              <span className="obs-pill" style={{ background: `${STATUS_ACCENT[r.status] ?? '#3b6bf6'}1a`, color: STATUS_ACCENT[r.status] ?? '#3b6bf6' }}>{r.status}</span>
              {' · '}{r.created_at}
            </div>
            {related.length > 0 && (
              <div className="obs-item-meta" style={{ marginTop: -4 }}>
                {related.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    className="chat-inspect-toggle"
                    style={{ fontSize: 11, padding: 0, marginRight: 10 }}
                    onClick={() => onNavigate?.('emergence')}
                  >
                    Signal: {s.pattern} ↗
                  </button>
                ))}
              </div>
            )}
            {r.narrative && <div className="obs-item-body">{r.narrative}</div>}
            {r.branches && <BranchesList branches={r.branches} />}
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="panel-delete-btn"
                style={{ fontSize: 11, padding: '4px 10px' }}
                disabled={deletingId === r.id}
                onClick={() => remove(r.id, r.hypothesis)}
              >
                {deletingId === r.id ? 'Löscht…' : 'Löschen'}
              </button>
            </div>
          </div>
        )
      })}

      {error && <div className="obs-empty" style={{ padding: '8px 0' }}>Fehler beim Nachladen.</div>}
      {total !== null && list.length < total && (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button className="panel-add-btn" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? 'Lädt…' : `Weitere laden (${list.length} / ${total})`}
          </button>
        </div>
      )}
    </div>
  )
}
