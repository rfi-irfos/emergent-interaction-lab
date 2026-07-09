import { useAdminFetch } from '../../lib/adminApi'
import { TokenBreakdown, type TokenInfo } from './TokenBreakdown'

interface HumanAiData {
  user_messages: number
  assistant_messages: number
  mean_token_confidence: number | null
  mean_latency_seconds: number | null
  latency_sample_size: number
  latest_reply: string | null
  latest_tokens: TokenInfo[] | null
  latest_at: string | null
}

/// Anchored around the live token-by-token breakdown of the most recent
/// reply (same visualization as Forschung's Token-Analyse), not just an
/// averaged confidence number — the aggregate stats sit below it as the
/// coarser, historical view.
export function HumanAiInteraction() {
  const { data, loading } = useAdminFetch<HumanAiData>('/api/observatory/human-ai')

  if (loading) return <div className="obs-panel"><div className="obs-empty">Lade…</div></div>
  if (!data) return <div className="obs-panel"><div className="obs-empty">Keine Daten verfügbar.</div></div>

  return (
    <div className="obs-panel">
      <div className="obs-section">
        <div className="obs-section-label">Letzte Antwort — Token für Token</div>
        {data.latest_tokens && data.latest_tokens.length > 0 ? (
          <div className="obs-item-card">
            {data.latest_reply && <div className="obs-item-meta">{data.latest_at}</div>}
            <TokenBreakdown tokens={data.latest_tokens} />
          </div>
        ) : (
          <div className="obs-empty">Noch keine Antwort mit Token-Daten.</div>
        )}
      </div>

      <div className="obs-grid">
        <div className="obs-stat"><div className="obs-stat-value">{data.user_messages}</div><div className="obs-stat-label">Nachrichten (Mensch)</div></div>
        <div className="obs-stat"><div className="obs-stat-value">{data.assistant_messages}</div><div className="obs-stat-label">Nachrichten (KI)</div></div>
        <div className="obs-stat">
          <div className="obs-stat-value">{data.mean_token_confidence !== null ? `${Math.round(data.mean_token_confidence * 100)}%` : '—'}</div>
          <div className="obs-stat-label">Ø Modell-Konfidenz</div>
        </div>
        <div className="obs-stat">
          <div className="obs-stat-value">{data.mean_latency_seconds !== null ? `${data.mean_latency_seconds.toFixed(1)}s` : '—'}</div>
          <div className="obs-stat-label">Ø Antwortzeit ({data.latency_sample_size} Proben)</div>
        </div>
      </div>
      <p style={{ fontSize: 12, color: '#888', lineHeight: 1.6 }}>
        Konfidenz ist der Token-Wahrscheinlichkeitswert direkt aus dem Modell — ein Signal über Modellsicherheit,
        keine Aussage über inhaltliche Richtigkeit. Klick auf ein Token oben für die Alternativen, die das Modell erwogen hat.
      </p>
    </div>
  )
}
