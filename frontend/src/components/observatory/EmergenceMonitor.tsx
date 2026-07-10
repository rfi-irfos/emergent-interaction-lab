import { useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders, useAdminFetch } from '../../lib/adminApi'

interface Signal {
  id: string
  pattern: string
  level: string
  status: string
  confidence: string
  evolution: string
  observation: string
  scope: string | null
  source_conversation_id: string | null
  created_at: string
}

// CCET (Continuous Co-Evolution Tracker) — see backend/src/chat.rs's own
// section doc comment (search "CCET") for the full disclosure. Laura's
// paper only ever gives a real formula for CEI (stable turns / total
// turns); "stable turn" itself, CEP, and Resonance Frequency are THIS
// PROJECT'S OWN operationalizations, never Laura's own verified numbers —
// `definitions_note` below is the backend's own words on that, rendered
// as-is rather than re-worded here so the disclosure can't drift out of
// sync between the two.
interface CcetSummary {
  cei: number
  cep: number
  resonance_frequency: number
  turns_considered: number
  stability_threshold: number
  definitions_note: string
}

const EVOLUTION_ARROW: Record<string, string> = {
  increasing: '↑', decreasing: '↓', steady: '→', unclear: '?',
}

const STATUS_ACCENT: Record<string, string> = {
  emerging: '#f59e0b', stable: '#10b981', fading: '#6b7280', hypothetical: '#8b5cf6',
}

// Nicht nur Human-AI — vier Ebenen, getrennt nach Laura's eigener
// Definition (siehe emergence.rs's Prompt für die genauen Kriterien).
const LEVEL_SECTIONS: { key: string; label: string; empty: string }[] = [
  { key: 'human', label: 'Human', empty: 'Noch keine Human-Signale erkannt — neue Verhaltensmuster, Hypothesen oder Forschungsfortschritt auf Lauras Seite.' },
  { key: 'ai', label: 'AI', empty: 'Noch keine AI-Signale erkannt — Antwortentwicklung, Modellverhalten oder semantische Verschiebung.' },
  { key: 'interaction', label: 'Interaction', empty: 'Noch keine Interaction-Signale erkannt — geteilte Muster, Co-Reasoning, rekursive Schleifen.' },
  { key: 'system', label: 'System', empty: 'Noch keine System-Signale erkannt — gesamtsystemische Veränderungen, neue Cluster, Drift.' },
]

// Same 4 keys as LEVEL_SECTIONS, just also carrying the .obs-stat accent
// class (obs-stat/obs-grid primitives, see App.css — the same ones
// Analytics.tsx/SystemState.tsx/InformationDynamics.tsx already use for
// every other Observatory stat row).
const LEVEL_STAT_ACCENT: Record<string, string> = {
  human: 'c-purple', ai: 'c-blue', interaction: 'c-teal', system: 'c-amber',
}

function formatPercent(v: number): string {
  return `${Math.round(v * 100)}%`
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
export function EmergenceMonitor({ onOpenConversation }: { onOpenConversation?: (conversationId: string) => void } = {}) {
  const [refreshKey, setRefreshKey] = useState(0)
  const { data, loading, error } = useAdminFetch<Signal[]>('/api/observatory/emergence/signals', [refreshKey])
  const { data: ccet } = useAdminFetch<CcetSummary>('/api/observatory/emergence/ccet', [refreshKey])
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
  if (error) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>

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
      {/* Summary strip — aggregated view above the flat card feed below,
          so every signal doesn't read with equal visual weight anymore.
          Two parts: (1) per-level counts, same obs-stat/obs-grid primitives
          the rest of the Observatory already uses; (2) the three CCET
          metrics, clearly marked as this project's own operationalization
          (see the CcetSummary doc comment above) — additive only, the
          detail cards below are unchanged. */}
      <div className="obs-section-label">Übersicht</div>
      <div className="obs-grid">
        {LEVEL_SECTIONS.map(section => (
          <div className={`obs-stat ${LEVEL_STAT_ACCENT[section.key]}`} key={section.key}>
            <div className="obs-stat-value">{signals.filter(s => s.level === section.key).length}</div>
            <div className="obs-stat-label">{section.label}</div>
          </div>
        ))}
      </div>

      <div className="obs-badge-experimental">Eigene Operationalisierung — nicht wörtlich aus Lauras Paper</div>
      <div className="obs-grid">
        <div className="obs-stat c-green">
          <div className="obs-stat-value">{ccet ? formatPercent(ccet.cei) : '—'}</div>
          <div className="obs-stat-label">CEI (Co-Evolution Index)</div>
        </div>
        <div className="obs-stat c-purple">
          <div className="obs-stat-value">{ccet ? ccet.cep : '—'}</div>
          <div className="obs-stat-label">CEP (Co-Evolution Points)</div>
        </div>
        <div className="obs-stat c-teal">
          <div className="obs-stat-value">{ccet ? formatPercent(ccet.resonance_frequency) : '—'}</div>
          <div className="obs-stat-label">Resonance Frequency</div>
        </div>
      </div>
      {ccet && (
        <div className="obs-warning-note" style={{ marginBottom: 22 }}>
          {ccet.definitions_note} Basis: die letzten {ccet.turns_considered} analysierten Turns, Stabilitätsschwelle (Kosinus-Ähnlichkeit) {formatPercent(ccet.stability_threshold)}.
        </div>
      )}

      {signals.length === 0 && (
        <div className="obs-card"><div className="obs-empty">Noch keine Signale erkannt — sie entstehen automatisch nach jedem Forschungsgespräch.</div></div>
      )}
      {signals.length > 0 && LEVEL_SECTIONS.map(section => {
        const levelSignals = signals.filter(s => s.level === section.key)
        return (
          <div key={section.key} style={{ marginBottom: 8 }}>
            <div className="obs-section-label">{section.label}</div>
            {levelSignals.length === 0 ? (
              <div className="obs-empty" style={{ padding: '12px 0', textAlign: 'left' }}>{section.empty}</div>
            ) : (
              levelSignals.map(s => (
                <div className="obs-item-card" key={s.id} style={{ ['--obs-accent' as string]: STATUS_ACCENT[s.status] ?? '#3b6bf6' }}>
                  <div className="obs-item-title">{s.pattern}</div>
                  <div className="obs-item-meta">
                    <span className="obs-pill" style={{ background: `${STATUS_ACCENT[s.status] ?? '#3b6bf6'}1a`, color: STATUS_ACCENT[s.status] ?? '#3b6bf6' }}>{s.status}</span>
                    {' · '}Konfidenz: {s.confidence}
                    {' · '}Verlauf: {EVOLUTION_ARROW[s.evolution] ?? '?'} {s.evolution}
                    {s.scope && <> · {s.scope}</>}
                    {' · '}{s.created_at}
                    {s.source_conversation_id && onOpenConversation && (
                      <>
                        {' · '}
                        <button
                          className="chat-inspect-toggle"
                          style={{ fontSize: 11, padding: 0 }}
                          onClick={() => onOpenConversation(s.source_conversation_id!)}
                        >
                          aus Gespräch ↗
                        </button>
                      </>
                    )}
                  </div>
                  <div className="obs-item-body">{s.observation}</div>
                </div>
              ))
            )}
          </div>
        )
      })}
    </div>
  )
}
