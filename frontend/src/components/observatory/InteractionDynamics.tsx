import { useState } from 'react'
import { useAdminFetch } from '../../lib/adminApi'
import { TokenBreakdown, type TokenInfo } from './TokenBreakdown'
import { ObsChart } from './ObsChart'
import { ObsDonut } from './ObsDonut'
import { ObsGauge } from './ObsGauge'
import { HudTile } from './Hud'
import { ExportButtons } from './ExportButtons'
import { HudSkeleton } from './HudSkeleton'
import { HudSectionHeader } from './Hud'

const RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: '7d', label: 'Letzte 7 Tage' },
  { value: '30d', label: 'Letzte 30 Tage' },
  { value: 'all', label: 'Alle' },
]

const RANGE_SUFFIX: Record<string, string> = { '7d': 'letzte 7 Tage', '30d': 'letzte 30 Tage', all: 'alle' }

interface DayCount { day: string; count: number }
interface InteractionData {
  range: string
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
///
/// `?range=7d|30d|all` scopes `messages_by_day` — the one genuinely
/// row-shaped dataset this view owns (see the export comment below) — same
/// convention as Behavioral Landscape's own range selector (backend/src/
/// observatory.rs's `resolve_range`). Every other field on this response
/// (totals, latest reply, mean confidence/latency) stays all-time/all-sample
/// regardless of `range`.
export function InteractionDynamics() {
  const [range, setRange] = useState('30d')
  const { data, loading, error } = useAdminFetch<InteractionData>(`/api/observatory/human-ai?range=${range}`, [range])

  if (loading) return <div className="obs-panel"><HudSkeleton variant="panel" /></div>
  if (error) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>
  if (!data) return <div className="obs-panel"><div className="obs-empty">Keine Daten verfügbar.</div></div>

  return (
    <div className="obs-panel">
      <HudSectionHeader title="Letzte Antwort — Token für Token" />
      {data.latest_tokens && data.latest_tokens.length > 0 ? (
        <div className="obs-item-card" style={{ ['--obs-accent' as string]: 'var(--obs-blue, #3b6bf6)' }}>
          {data.latest_reply && <div className="obs-item-meta">{data.latest_at}</div>}
          <TokenBreakdown tokens={data.latest_tokens} />
        </div>
      ) : (
        <div className="obs-card" style={{ padding: '14px 18px', marginBottom: 16 }}>
          <div className="obs-empty" style={{ padding: '8px 0' }}>Noch keine Antwort mit Token-Daten.</div>
        </div>
      )}

      {data.messages_by_day.length > 0 && (
        <HudTile title="Gesprächsentwicklung" badge={RANGE_SUFFIX[data.range] ?? data.range} accent="var(--obs-purple)" span={4}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <select value={range} onChange={e => setRange(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
              {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ExportButtons
              rows={data.messages_by_day.map(d => ({ ...d }))}
              filenameBase={`interaction-messages-by-day-${range}`}
              title={`Interaction Dynamics — Gesprächsentwicklung (${RANGE_SUFFIX[data.range] ?? data.range})`}
            />
          </div>
          <ObsChart data={data.messages_by_day.map(d => ({ label: d.day.slice(5), value: d.count }))} color="#8b5cf6" gradientId="interaction-trend" />
        </HudTile>
      )}

      {/* mean_token_confidence is a real 0-1 fraction — a gauge. user_messages
          vs assistant_messages becomes a thin 2-slice donut (smaller
          thickness/size than the default — this is a simple ratio, not a
          multi-category breakdown). mean_latency_seconds is a duration, not
          a fraction, so it stays a plain .obs-stat tile — kept rather than
          dropped, it's real information a gauge can't honestly represent. */}
      <HudTile title="Mensch ↔ KI" badge="RATIO" accent="var(--obs-blue)" span={2}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
          <ObsDonut
            data={[
              { label: 'Mensch', value: data.user_messages, color: 'var(--obs-purple)' },
              { label: 'KI', value: data.assistant_messages, color: 'var(--obs-blue)' },
            ]}
            size={120}
            thickness={13}
            gradientIdPrefix="interaction-message-ratio"
          />
          {data.mean_token_confidence !== null ? (
            <ObsGauge value={data.mean_token_confidence} label="Ø Modell-Konfidenz" color="var(--obs-blue)" />
          ) : (
            <div className="obs-stat c-blue"><div className="obs-stat-value">—</div><div className="obs-stat-label">Ø Modell-Konfidenz</div></div>
          )}
          <div className="obs-stat c-teal" style={{ flex: '0 1 190px' }}>
            <div className="obs-stat-value">{data.mean_latency_seconds !== null ? `${data.mean_latency_seconds.toFixed(1)}s` : '—'}</div>
            <div className="obs-stat-label">Ø Antwort-Tempo ({data.latency_sample_size} Proben)</div>
          </div>
        </div>
      </HudTile>
      <p style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.6 }}>
        Konfidenz und Antwort-Tempo sind Signale über Anpassung und Rhythmus des Gesprächs, keine Leistungsmessung. Klick auf ein Token oben für die Alternativen, die das Modell erwogen hat.
      </p>
    </div>
  )
}
