import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders, useAdminFetch } from '../../lib/adminApi'
import { SimulationLab, STATUS_ACCENT, BranchesList } from './SimulationLab'
import type { BranchOut } from './SimulationLab'
import { ExportButtons } from './ExportButtons'
import type { AdminSection } from '../../types/admin'

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

// ExportButtons/lib/export.ts need already-flat rows — callers own flattening
// anything nested before handing rows there (see ExportButtons.tsx). A
// branched run doesn't fit one flat row: cramming N option/rationale/
// narrative/status sets into one cell would work but isn't actually
// readable in a CSV/Markdown table. Instead, a branched run becomes its own
// "run" row (unchanged shape, branch_* columns blank, narrative = the
// top-level synthesis line) PLUS one "branch" row per option carrying that
// branch's own status/narrative — `row_type` tells the two apart. A run
// with no branches produces exactly the one row it always did, just with
// the two new (blank) branch_* columns alongside it.
function flattenForExport(runs: RunOut[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  for (const r of runs) {
    rows.push({
      id: r.id,
      row_type: 'run',
      hypothesis: r.hypothesis,
      status: r.status,
      parameters: r.parameters,
      narrative: r.narrative ?? '',
      related_signal_ids: (r.related_signal_ids ?? []).join('; '),
      branch_option: '',
      branch_rationale: '',
      created_at: r.created_at,
    })
    for (const b of r.branches ?? []) {
      rows.push({
        id: r.id,
        row_type: 'branch',
        hypothesis: r.hypothesis,
        status: b.status,
        parameters: '',
        narrative: b.narrative ?? '',
        related_signal_ids: '',
        branch_option: b.option,
        branch_rationale: b.rationale,
        created_at: r.created_at,
      })
    }
  }
  return rows
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
      {run.branches && <BranchesList branches={run.branches} />}
    </div>
  )
}

// Cap how many compare slots can be open at once — N-way, not unbounded;
// beyond this the horizontal-scroll fallback in .obs-compare-grid would be
// doing all the work anyway, so a hard ceiling keeps the picker row sane.
const MAX_COMPARE = 6

// Backend page size for `GET /api/simulation/runs` — previously that query
// had no LIMIT at all (a genuinely unbounded read against a table that only
// grows); this is the new default page, with "Weitere laden" (offset) and
// the status filter (see backend/src/simulation.rs's list_runs) making the
// rest reachable without ever pulling the whole table at once.
const PAGE_SIZE = 20

/// Simulation is its own Kernbereich, not a sub-panel of Research Pulse —
/// promoted out per the plan (see ResearchPulse.tsx, which now just links
/// here instead of embedding <SimulationLab> directly). The compare view
/// needs no new schema or query: list_runs already returns everything
/// (hypothesis/parameters/narrative/status/related_signal_ids) a
/// side-by-side comparison needs. Extended from a fixed 2-column A/B view
/// to N runs at once (see plan item 8) — slots are added/removed, not a
/// hardcoded pair.
export function SimulationCenter({ onNavigate }: { onNavigate?: (s: AdminSection) => void } = {}) {
  // Owns the runs list directly (rather than useAdminFetch) because
  // pagination/filtering need a manual fetch that can either replace the
  // list (new filter, or after create/delete) or append to it ("Weitere
  // laden") — useAdminFetch's effect-on-deps model only ever replaces.
  const [runs, setRuns] = useState<RunOut[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  // Honest fetch-error state (see #41) — reimplemented here since this
  // manual fetch replaces useAdminFetch (which already had its own `error`).
  const [error, setError] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const { data: signalsData } = useAdminFetch<SignalRef[]>('/api/observatory/emergence/signals')
  const signals = signalsData ?? []
  const [compareIds, setCompareIds] = useState<string[]>(['', ''])

  const loadRuns = async (offset: number, append: boolean) => {
    if (append) setLoadingMore(true); else setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (statusFilter) params.set('status', statusFilter)
      const res = await fetch(`${API_BASE}/api/simulation/runs?${params}`, { headers: authHeaders() })
      if (!res.ok) throw new Error(String(res.status))
      const totalHeader = res.headers.get('X-Total-Count')
      const page: RunOut[] = await res.json()
      setRuns(prev => (append ? [...prev, ...page] : page))
      setTotal(totalHeader !== null ? Number(totalHeader) : null)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    loadRuns(0, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  const loadMoreRuns = () => loadRuns(runs.length, true)
  // A newly created run is always the most recent, so it's always on page
  // one — resetting there (rather than trying to preserve however many
  // pages were loaded via "Weitere laden") keeps this simple and correct.
  const refreshAfterMutation = () => loadRuns(0, false)

  // A compare slot pointing at a run that no longer exists (deleted, or
  // simply not on the currently loaded page after a refresh) degrades to
  // "unselected" rather than holding a dangling id the <select> can't match.
  useEffect(() => {
    setCompareIds(ids => ids.map(id => (id && !runs.some(r => r.id === id) ? '' : id)))
  }, [runs])

  if (error && runs.length === 0) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>

  const setCompareId = (idx: number, value: string) => {
    setCompareIds(ids => ids.map((v, i) => (i === idx ? value : v)))
  }
  const addCompareSlot = () => setCompareIds(ids => (ids.length < MAX_COMPARE ? [...ids, ''] : ids))
  const removeCompareSlot = (idx: number) => setCompareIds(ids => (ids.length > 1 ? ids.filter((_, i) => i !== idx) : ids))

  return (
    <div className="obs-panel">
      <div className="obs-section-label">
        Aktive Simulationen {total !== null && <span style={{ fontWeight: 400 }}>(geladen: {runs.length} von {total})</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ flex: '0 1 200px' }}>
          <option value="">Alle Status</option>
          {Object.keys(STATUS_ACCENT).map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        {/* Exports whatever is currently loaded/filtered (`runs`), same
            honesty-about-scope principle as EmergenceMonitor's export —
            related_signal_ids (an array) is flattened to a "; "-joined
            string since CSV/Markdown cells are plain text. */}
        <ExportButtons
          rows={flattenForExport(runs)}
          filenameBase="simulation-runs"
          title="Simulationsläufe"
        />
      </div>
      <SimulationLab
        runs={runs}
        loading={loading}
        loadingMore={loadingMore}
        // Only reached once some runs are already showing — the full-page
        // error state above already covers a failure on the very first load.
        error={error && runs.length > 0}
        total={total}
        onLoadMore={loadMoreRuns}
        onRefresh={refreshAfterMutation}
        signals={signals}
        onNavigate={onNavigate}
      />

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
