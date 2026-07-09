import { useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders, useAdminFetch } from '../../lib/adminApi'

interface Signal {
  id: string
  pattern: string
  status: string
  confidence: string
  evolution: string
  observation: string
  scope: string | null
  source_conversation_id: string | null
  created_at: string
}

const EVOLUTION_ARROW: Record<string, string> = {
  increasing: '↑', decreasing: '↓', steady: '→', unclear: '?',
}

const STATUS_ACCENT: Record<string, string> = {
  emerging: '#f59e0b', stable: '#10b981', fading: '#6b7280', hypothetical: '#8b5cf6',
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/// The most important Observatory module: Jarvis's own qualitative read of
/// what's emerging in the research dialogue, not a stats pipeline. A new
/// signal set is generated automatically after every Forschung exchange
/// (see backend/src/emergence.rs) — this page just lists what's accumulated.
/// Every card carries the experimental badge deliberately: this is model
/// interpretation, never presented as validated fact.
export function EmergenceMonitor() {
  const [refreshKey, setRefreshKey] = useState(0)
  const { data, loading } = useAdminFetch<Signal[]>('/api/observatory/emergence/signals', [refreshKey])
  const [analyzing, setAnalyzing] = useState(false)

  const requestAnalysis = async () => {
    // No specific conversation in context on this page — the automatic
    // per-turn trigger (chat.rs) is the primary mechanism; this button just
    // forces a fresh pass over the most recently active conversation,
    // without waiting for the next message to arrive.
    setAnalyzing(true)
    try {
      const convRes = await fetch(`${API_BASE}/api/chat/conversations?kind=chat`, { headers: authHeaders() })
      const conversations = convRes.ok ? await convRes.json() : []
      const latestId = conversations[0]?.id
      if (!latestId) return
      await fetch(`${API_BASE}/api/observatory/emergence/analyze`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ conversation_id: latestId }),
      })
      setRefreshKey(k => k + 1)
    } finally {
      setAnalyzing(false)
    }
  }

  if (loading) return <div className="obs-panel"><div className="obs-empty">Lade…</div></div>

  const signals = data ?? []

  return (
    <div className="obs-panel">
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className="panel-add-btn" onClick={requestAnalysis} disabled={analyzing}>
          {analyzing ? 'Analysiert…' : '⟳ Jetzt erneut analysieren'}
        </button>
        <button
          className="panel-add-btn"
          disabled={signals.length === 0}
          onClick={() => downloadJson(`emergence-signals-${new Date().toISOString().slice(0, 10)}.json`, signals)}
        >
          ⬇ Exportieren
        </button>
      </div>
      {signals.length === 0 ? (
        <div className="obs-card"><div className="obs-empty">Noch keine Signale erkannt — sie entstehen automatisch nach jedem Forschungsgespräch.</div></div>
      ) : (
        signals.map(s => (
          <div className="obs-item-card" key={s.id} style={{ ['--obs-accent' as string]: STATUS_ACCENT[s.status] ?? '#3b6bf6' }}>
            <div className="obs-item-title">{s.pattern}</div>
            <div className="obs-item-meta">
              <span className="obs-pill" style={{ background: `${STATUS_ACCENT[s.status] ?? '#3b6bf6'}1a`, color: STATUS_ACCENT[s.status] ?? '#3b6bf6' }}>{s.status}</span>
              {' · '}Konfidenz: {s.confidence}
              {' · '}Verlauf: {EVOLUTION_ARROW[s.evolution] ?? '?'} {s.evolution}
              {s.scope && <> · {s.scope}</>}
              {' · '}{s.created_at}
            </div>
            <div className="obs-item-body">{s.observation}</div>
          </div>
        ))
      )}
    </div>
  )
}
