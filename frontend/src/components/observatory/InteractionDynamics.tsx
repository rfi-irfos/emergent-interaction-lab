import { useAdminFetch } from '../../lib/adminApi'
import { TokenBreakdown, type TokenInfo } from './TokenBreakdown'
import { ObsChart } from './ObsChart'
import { ExportButtons } from './ExportButtons'

interface DayCount { day: string; count: number }
interface InteractionData {
  user_messages: number
  assistant_messages: number
  messages_by_day: DayCount[]
  mean_token_confidence: number | null
  mean_latency_seconds: number | null
  latency_sample_size: number
  latest_reply: string | null
  latest_tokens: TokenInfo[] | null
  latest_at: string | null
}

/// Interaction structure over time — not a chat-history log. Anchored around
/// the live token-by-token breakdown of the latest reply; latency and
/// confidence are read as pacing/adaptation signals, not performance metrics.
export function InteractionDynamics() {
  const { data, loading, error } = useAdminFetch<InteractionData>('/api/observatory/human-ai')

  if (loading) return <div className="obs-panel"><div className="obs-empty">Lade…</div></div>
  if (error) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>
  if (!data) return <div className="obs-panel"><div className="obs-empty">Keine Daten verfügbar.</div></div>

  return (
    <div className="obs-panel">
      <div className="obs-section-label">Letzte Antwort — Token für Token</div>
      {data.latest_tokens && data.latest_tokens.length > 0 ? (
        <div className="obs-item-card" style={{ ['--obs-accent' as string]: '#3b6bf6' }}>
          {data.latest_reply && <div className="obs-item-meta">{data.latest_at}</div>}
          <TokenBreakdown tokens={data.latest_tokens} />
        </div>
      ) : (
        <div className="obs-card"><div className="obs-empty">Noch keine Antwort mit Token-Daten.</div></div>
      )}

      {data.messages_by_day.length > 0 && (
        <div className="obs-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <div className="obs-section-label" style={{ marginBottom: 0 }}>Gesprächsentwicklung — letzte 14 Tage</div>
            {/* The one genuinely row-shaped dataset this view owns (same
                day+count shape as Analytics' views_by_day / Information
                Dynamics' retrieval_by_day, both exportable) — everything
                else on this page is either a single aggregate stat or the
                token-by-token detail of one specific reply, not a list. */}
            <ExportButtons
              rows={data.messages_by_day.map(d => ({ ...d }))}
              filenameBase="interaction-messages-by-day"
              title="Interaction Dynamics — Gesprächsentwicklung"
            />
          </div>
          <ObsChart data={data.messages_by_day.map(d => ({ label: d.day.slice(5), value: d.count }))} color="#8b5cf6" gradientId="interaction-trend" />
        </div>
      )}

      <div className="obs-grid">
        <div className="obs-stat c-purple"><div className="obs-stat-value">{data.user_messages}</div><div className="obs-stat-label">Beiträge (Mensch)</div></div>
        <div className="obs-stat c-purple"><div className="obs-stat-value">{data.assistant_messages}</div><div className="obs-stat-label">Beiträge (KI)</div></div>
        <div className="obs-stat c-blue">
          <div className="obs-stat-value">{data.mean_token_confidence !== null ? `${Math.round(data.mean_token_confidence * 100)}%` : '—'}</div>
          <div className="obs-stat-label">Ø Modell-Konfidenz</div>
        </div>
        <div className="obs-stat c-teal">
          <div className="obs-stat-value">{data.mean_latency_seconds !== null ? `${data.mean_latency_seconds.toFixed(1)}s` : '—'}</div>
          <div className="obs-stat-label">Ø Antwort-Tempo ({data.latency_sample_size} Proben)</div>
        </div>
      </div>
      <p style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.6 }}>
        Konfidenz und Antwort-Tempo sind Signale über Anpassung und Rhythmus des Gesprächs, keine Leistungsmessung. Klick auf ein Token oben für die Alternativen, die das Modell erwogen hat.
      </p>
    </div>
  )
}
