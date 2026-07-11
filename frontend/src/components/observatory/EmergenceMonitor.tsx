import { useEffect, useState } from 'react'
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

// The three fixed confidence values the analysis prompt itself is
// constrained to (see emergence.rs's analyze_recent_interactions prompt) —
// same closed vocabulary as STATUS_ACCENT's keys and EVOLUTION_ARROW's keys
// above, just without its own accent map since confidence isn't rendered
// with a color today.
const CONFIDENCE_LEVELS = ['experimental', 'tentative', 'moderate']

// Backend page size for `GET /api/observatory/emergence/signals` — matches
// the old hardcoded `LIMIT 50` exactly, so the very first page a visitor
// sees is unchanged; `offset` (via "Weitere laden") is what makes the rest
// of the table reachable now (see backend/src/emergence.rs).
const PAGE_SIZE = 50

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
  const { data: ccet } = useAdminFetch<CcetSummary>('/api/observatory/emergence/ccet', [refreshKey])
  const [analyzing, setAnalyzing] = useState(false)

  // Real pagination + filters (see backend/src/emergence.rs's list_signals):
  // previously this always fetched a hardcoded top-50, with no way to reach
  // anything older and no way to narrow the page at all. `signals` is the
  // accumulated, currently-loaded set (grows via "Weitere laden"); `total`
  // is the true count matching the active filters (from the X-Total-Count
  // response header), not just how much has been loaded so far.
  const [signals, setSignals] = useState<Signal[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  // Honest fetch-error state (see #41) — a manual fetch replaces
  // useAdminFetch here (which already had its own `error` flag), so this
  // reimplements the same signal rather than silently dropping it.
  const [error, setError] = useState(false)
  const [levelFilter, setLevelFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [confidenceFilter, setConfidenceFilter] = useState('')
  const [evolutionFilter, setEvolutionFilter] = useState('')

  const loadSignals = async (offset: number, append: boolean) => {
    if (append) setLoadingMore(true); else setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (levelFilter) params.set('level', levelFilter)
      if (statusFilter) params.set('status', statusFilter)
      if (confidenceFilter) params.set('confidence', confidenceFilter)
      if (evolutionFilter) params.set('evolution', evolutionFilter)
      const res = await fetch(`${API_BASE}/api/observatory/emergence/signals?${params}`, { headers: authHeaders() })
      if (!res.ok) throw new Error(String(res.status))
      const totalHeader = res.headers.get('X-Total-Count')
      const page: Signal[] = await res.json()
      setSignals(prev => (append ? [...prev, ...page] : page))
      setTotal(totalHeader !== null ? Number(totalHeader) : null)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  // Any filter change (or a forced refreshKey bump) starts over from the
  // newest page — "load more" below is the only path that appends.
  useEffect(() => {
    loadSignals(0, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, levelFilter, statusFilter, confidenceFilter, evolutionFilter])

  const loadMore = () => loadSignals(signals.length, true)
  const resetFilters = () => {
    setLevelFilter(''); setStatusFilter(''); setConfidenceFilter(''); setEvolutionFilter('')
  }
  const filtersActive = Boolean(levelFilter || statusFilter || confidenceFilter || evolutionFilter)

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

  if (loading && signals.length === 0) return <div className="obs-panel"><div className="obs-empty">Lade…</div></div>
  if (error && signals.length === 0) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>

  // With a level filter active, only that one level was ever fetched from
  // the backend at all — showing the other 3 as zero/"empty" would
  // misleadingly read as "no signals of that level exist" rather than
  // "filtered out", so they're hidden entirely instead, both in the
  // "Übersicht" stat grid and in the detail sections below.
  const visibleSections = levelFilter ? LEVEL_SECTIONS.filter(s => s.key === levelFilter) : LEVEL_SECTIONS

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

      {/* Filter bar — level/status/confidence/evolution, each a closed
          vocabulary already fixed by the analysis prompt (see LEVEL_SECTIONS,
          STATUS_ACCENT, CONFIDENCE_LEVELS, EVOLUTION_ARROW above), so plain
          <select>s are enough; no free-text search needed for a handful of
          known values. Every change resets pagination to the first page. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)} style={{ flex: '1 1 140px' }}>
          <option value="">Alle Ebenen</option>
          {LEVEL_SECTIONS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ flex: '1 1 140px' }}>
          <option value="">Alle Status</option>
          {Object.keys(STATUS_ACCENT).map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={confidenceFilter} onChange={e => setConfidenceFilter(e.target.value)} style={{ flex: '1 1 140px' }}>
          <option value="">Alle Konfidenzen</option>
          {CONFIDENCE_LEVELS.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={evolutionFilter} onChange={e => setEvolutionFilter(e.target.value)} style={{ flex: '1 1 140px' }}>
          <option value="">Alle Verläufe</option>
          {Object.keys(EVOLUTION_ARROW).map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        {filtersActive && (
          <button type="button" className="chat-inspect-toggle" style={{ fontSize: 12 }} onClick={resetFilters}>
            Filter zurücksetzen
          </button>
        )}
      </div>

      {/* Summary strip — aggregated view above the flat card feed below,
          so every signal doesn't read with equal visual weight anymore.
          Two parts: (1) per-level counts, same obs-stat/obs-grid primitives
          the rest of the Observatory already uses; (2) the three CCET
          metrics, clearly marked as this project's own operationalization
          (see the CcetSummary doc comment above) — additive only, the
          detail cards below are unchanged. Counts reflect the currently
          *loaded* signals, not necessarily the global total — see the
          "geladen" note below, honest about that now that this list is
          paginated instead of always holding everything up to the old cap. */}
      <div className="obs-section-label">
        Übersicht {total !== null && <span style={{ fontWeight: 400 }}>(geladen: {signals.length} von {total})</span>}
      </div>
      <div className="obs-grid">
        {visibleSections.map(section => (
          <div className={`obs-stat ${LEVEL_STAT_ACCENT[section.key]}`} key={section.key}>
            <div className="obs-stat-value">{signals.filter(s => s.level === section.key).length}</div>
            <div className="obs-stat-label">{section.label}</div>
          </div>
        ))}
      </div>

      <div
        className="obs-badge-experimental"
        title={ccet ? `${ccet.definitions_note} Basis: die letzten ${ccet.turns_considered} analysierten Turns, Stabilitätsschwelle (Kosinus-Ähnlichkeit) ${formatPercent(ccet.stability_threshold)}.` : undefined}
      >
        Eigene Operationalisierung — nicht wörtlich aus Lauras Paper
      </div>
      <div className="obs-grid" style={{ marginBottom: 22 }}>
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

      {signals.length === 0 && !loading && (
        <div className="obs-card">
          <div className="obs-empty">
            {filtersActive
              ? 'Keine Signale für diese Filterkombination.'
              : 'Noch keine Signale erkannt — sie entstehen automatisch nach jedem Forschungsgespräch.'}
          </div>
        </div>
      )}
      {signals.length > 0 && visibleSections.map(section => {
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

      {/* Only reached once some signals are already showing — the full-page
          error state above already covers a failure on the very first load. */}
      {error && signals.length > 0 && (
        <div className="obs-empty" style={{ padding: '8px 0' }}>Fehler beim Nachladen.</div>
      )}
      {total !== null && signals.length < total && (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button className="panel-add-btn" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Lädt…' : `Weitere laden (${signals.length} / ${total})`}
          </button>
        </div>
      )}
    </div>
  )
}
