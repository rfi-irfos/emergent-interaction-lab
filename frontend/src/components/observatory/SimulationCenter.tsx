import { useState } from 'react'
import { useAdminFetch } from '../../lib/adminApi'
import { SimulationLab } from './SimulationLab'

interface RunOut {
  id: string
  hypothesis: string
  parameters: string
  narrative: string | null
  status: string
  created_at: string
}

function formatParams(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
}

function RunColumn({ run }: { run: RunOut | null }) {
  if (!run) return <div className="obs-item-card obs-compare-empty"><div className="obs-empty">Lauf auswählen…</div></div>
  return (
    <div className="obs-item-card">
      <div className="obs-item-title">{run.hypothesis}</div>
      <div className="obs-item-meta">{run.status} · {run.created_at}</div>
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

/// Simulation is its own Kernbereich, not a sub-panel of Research Pulse —
/// promoted out per the plan (see ResearchPulse.tsx, which now just links
/// here instead of embedding <SimulationLab> directly). The compare view
/// needs no new schema or query: list_runs already returns everything
/// (hypothesis/parameters/narrative/status) a side-by-side comparison needs.
export function SimulationCenter() {
  const { data } = useAdminFetch<RunOut[]>('/api/simulation/runs')
  const runs = data ?? []
  const [idA, setIdA] = useState('')
  const [idB, setIdB] = useState('')

  const runA = runs.find(r => r.id === idA) ?? null
  const runB = runs.find(r => r.id === idB) ?? null

  return (
    <div className="obs-panel">
      <div className="obs-section-label">Aktive Simulationen</div>
      <SimulationLab />

      <div className="obs-section-label" style={{ marginTop: 24 }}>Vergleich</div>
      <div className="obs-form" style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
        <select value={idA} onChange={e => setIdA(e.target.value)} style={{ flex: 1 }}>
          <option value="">Lauf A wählen…</option>
          {runs.map(r => <option key={r.id} value={r.id}>{r.hypothesis} ({r.created_at})</option>)}
        </select>
        <select value={idB} onChange={e => setIdB(e.target.value)} style={{ flex: 1 }}>
          <option value="">Lauf B wählen…</option>
          {runs.map(r => <option key={r.id} value={r.id}>{r.hypothesis} ({r.created_at})</option>)}
        </select>
      </div>
      <div className="obs-compare-grid">
        <RunColumn run={runA} />
        <RunColumn run={runB} />
      </div>
    </div>
  )
}
