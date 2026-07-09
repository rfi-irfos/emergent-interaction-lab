import { useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders, useAdminFetch } from '../../lib/adminApi'

interface RunOut {
  id: string
  hypothesis: string
  parameters: string
  narrative: string | null
  status: string
  created_at: string
}

export function SimulationLab() {
  const { data, loading } = useAdminFetch<RunOut[]>('/api/simulation/runs')
  const [runs, setRuns] = useState<RunOut[] | null>(null)
  const [hypothesis, setHypothesis] = useState('')
  const [parameters, setParameters] = useState('')
  const [running, setRunning] = useState(false)

  const list = runs ?? data ?? []

  const submit = async () => {
    if (!hypothesis.trim() || running) return
    setRunning(true)
    let paramsJson: unknown = {}
    if (parameters.trim()) {
      try { paramsJson = JSON.parse(parameters) } catch { paramsJson = { note: parameters } }
    }
    try {
      const res = await fetch(`${API_BASE}/api/simulation/runs`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ hypothesis, parameters: paramsJson }),
      })
      await res.json()
      const refreshed = await fetch(`${API_BASE}/api/simulation/runs`, { headers: authHeaders() })
      setRuns(await refreshed.json())
      setHypothesis(''); setParameters('')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="obs-panel">
      <div className="obs-badge-experimental">KI-generierte explorative Überlegung, keine validierte Simulation</div>
      <div className="obs-form">
        <input placeholder="Hypothese, z.B. „Mehr Kontext führt zu stabileren Mensch-KI-Interaktionen“" value={hypothesis} onChange={e => setHypothesis(e.target.value)} />
        <textarea placeholder="Parameter (optional, freier Text oder JSON)" value={parameters} onChange={e => setParameters(e.target.value)} />
        <button className="panel-add-btn" style={{ alignSelf: 'flex-start' }} onClick={submit} disabled={running || !hypothesis.trim()}>
          {running ? 'Denkt nach…' : 'Simulation starten'}
        </button>
      </div>

      <div className="obs-section-label">Bisherige Läufe</div>
      {loading && !runs && <div className="obs-empty">Lade…</div>}
      {list.length === 0 && !loading && <div className="obs-empty">Noch keine Simulationen.</div>}
      {list.map(r => (
        <div className="obs-item-card" key={r.id}>
          <div className="obs-item-title">{r.hypothesis}</div>
          <div className="obs-item-meta">{r.status} · {r.created_at}</div>
          {r.narrative && <div className="obs-item-body">{r.narrative}</div>}
        </div>
      ))}
    </div>
  )
}
