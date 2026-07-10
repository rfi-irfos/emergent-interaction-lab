import { useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders } from '../../lib/adminApi'
import type { AdminSection } from '../../types/admin'
import type { SignalRef } from './SimulationCenter'

interface RunOut {
  id: string
  hypothesis: string
  parameters: string
  narrative: string | null
  status: string
  created_at: string
  related_signal_ids: string[] | null
}

interface SimulationLabProps {
  runs: RunOut[]
  loading: boolean
  onRunsChange: (runs: RunOut[]) => void
  signals: SignalRef[]
  onNavigate?: (s: AdminSection) => void
}

export function SimulationLab({ runs: list, loading, onRunsChange, signals, onNavigate }: SimulationLabProps) {
  const [hypothesis, setHypothesis] = useState('')
  const [parameters, setParameters] = useState('')
  const [selectedSignalIds, setSelectedSignalIds] = useState<string[]>([])
  const [running, setRunning] = useState(false)

  const toggleSignal = (id: string) => {
    setSelectedSignalIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]))
  }

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
        body: JSON.stringify({
          hypothesis,
          parameters: paramsJson,
          related_signal_ids: selectedSignalIds.length ? selectedSignalIds : undefined,
        }),
      })
      await res.json()
      const refreshed = await fetch(`${API_BASE}/api/simulation/runs`, { headers: authHeaders() })
      onRunsChange(await refreshed.json())
      setHypothesis(''); setParameters(''); setSelectedSignalIds([])
    } finally {
      setRunning(false)
    }
  }

  const STATUS_ACCENT: Record<string, string> = { pending: '#f59e0b', complete: '#10b981', error: '#ef4444' }
  // Signals already come back newest-first (list_signals ORDER BY
  // created_at DESC) — a run almost always explores something recent, not
  // the full 50-deep backlog, so the picker only shows a short recent slice.
  const recentSignals = signals.slice(0, 10)

  return (
    <div className="obs-panel">
      <div className="obs-card">
        <div className="obs-form" style={{ marginBottom: 0 }}>
          <input placeholder="Hypothese, z.B. „Mehr Kontext führt zu stabileren Mensch-KI-Interaktionen“" value={hypothesis} onChange={e => setHypothesis(e.target.value)} />
          <textarea placeholder="Parameter (optional, freier Text oder JSON)" value={parameters} onChange={e => setParameters(e.target.value)} />
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
          <button className="panel-add-btn" style={{ alignSelf: 'flex-start' }} onClick={submit} disabled={running || !hypothesis.trim()}>
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
          </div>
        )
      })}
    </div>
  )
}
