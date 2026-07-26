import { useState } from 'react'
import { useAdminFetch } from '../../lib/adminApi'
import { TOOL_LABELS } from '../../lib/toolLabels'
import { foldIntoOther } from '../../lib/chartMath'
import { HudSkeleton } from './HudSkeleton'
import { ObsDonut } from './ObsDonut'
import { HudGrid, HudTile, HudStat, useHeaderActions } from './Hud'

// ── AgentActivity · Jarvis the Machine (Bucket 2) ─────────────────────────
// Ersetzt den alten GitHub-Activity-Feed komplett (PR/Commit/Deploy-Chatter
// sagt nichts über Jarvis' Reasoning-Verhalten aus, was dieses Panel zeigt).
// Pullt ausschließlich EXISTIERENDE Endpoints — keine neuen Backend-Routen:
//   /behavior?range=          → tool_distribution (Werkzeug-Verhalten)
//   /anomalies/distribution   → 4-kind Rollup (Refusal/Anomalie)
//   /anomalies?limit=         → recent Anomaly-Rows
//   /hallucination-checks     → recent Verdicts (Halluzination)
//   /human-ai?range=          → assistant_messages / tokens / reasoning_ms
//
// Hausregel: null/leer → "Noch keine Daten", nie eine erfundene 0.

interface BehaviorData { range: string; tool_distribution: { tool?: string; count: number }[] }
interface AnomalyDist { tool_error: number; iteration_cap: number; refusal: number; hallucination_mismatch: number }
interface AnomalyRow { id: string; kind: string; conversation_id: string | null; chat_message_id: string | null; detail: string | null; created_at: string }
interface HallucinationRow { id: string; chat_message_id: string; tool_call_id: string; verdict: string; detail: string | null; created_at: string }
interface HumanAiData { range: string; assistant_messages: number | null; total_completion_tokens: number | null; total_reasoning_ms: number | null }

const RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: '7d', label: 'Letzte 7 Tage' },
  { value: '30d', label: 'Letzte 30 Tage' },
  { value: 'all', label: 'Alle' },
]
const RANGE_SUFFIX: Record<string, string> = { '7d': 'letzte 7 Tage', '30d': 'letzte 30 Tage', all: 'alle' }

const ANOMALY_KIND_LABEL: Record<string, string> = {
  tool_error: 'Werkzeugfehler', iteration_cap: 'Iterations-Limit', refusal_triggered: 'Refusal ausgelöst', hallucination_mismatch: 'Halluzinations-Mismatch',
}
function anomalyAccent(kind: string): string {
  if (kind === 'tool_error' || kind === 'hallucination_mismatch') return 'var(--sem-danger)'
  if (kind === 'iteration_cap') return 'var(--obs-amber)'
  return 'var(--obs-purple)'
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—'
  const s = ms / 1000
  if (s < 90) return `${Math.round(s)} s`
  const m = s / 60
  if (m < 90) return `${Math.round(m)} min`
  return `${(m / 60).toFixed(1)} h`
}

export function AgentActivity() {
  const [range, setRange] = useState('30d')
  const behaviorPath = `/api/observatory/behavior?range=${range}`
  const distPath = `/api/observatory/anomalies/distribution?range=${range}`
  const humanAiPath = `/api/observatory/human-ai?range=${range}`
  const anomaliesPath = `/api/observatory/anomalies?limit=8`
  const checksPath = `/api/observatory/hallucination-checks?limit=8`

  const { data: behavior, loading: lB } = useAdminFetch<BehaviorData>(behaviorPath, [range])
  const { data: dist, loading: lD } = useAdminFetch<AnomalyDist>(distPath, [range])
  const { data: humanAi, loading: lH } = useAdminFetch<HumanAiData>(humanAiPath, [range])
  const { data: anomalies, loading: lA } = useAdminFetch<AnomalyRow[]>(anomaliesPath, [])
  const { data: checks, loading: lC } = useAdminFetch<HallucinationRow[]>(checksPath, [])

  useHeaderActions(
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <select value={range} onChange={e => setRange(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
        {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>,
    [range],
  )

  if (lB || lD || lH || lA || lC) return <div className="obs-panel"><HudSkeleton variant="panel" /></div>

  const anomalyTotal = dist ? dist.tool_error + dist.iteration_cap + dist.refusal + dist.hallucination_mismatch : 0
  const anomalyBars = [
    { label: 'Tool-Fehler', value: dist?.tool_error ?? 0 },
    { label: 'Iteration-Cap', value: dist?.iteration_cap ?? 0 },
    { label: 'Refusal', value: dist?.refusal ?? 0 },
    { label: 'Halluzinations-Mismatch', value: dist?.hallucination_mismatch ?? 0 },
  ]
  const toolDist = foldIntoOther((behavior?.tool_distribution ?? []).map(b => ({ label: TOOL_LABELS[b.tool ?? ''] ?? (b.tool ?? '—'), value: b.count })))

  return (
    <div className="obs-panel">
      <HudGrid cols={4}>
        <HudTile title="Reasoning-Volumen" badge="TOKENS" accent="var(--obs-teal)" span={4}>
          {humanAi ? (
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              <HudStat value={humanAi.assistant_messages ?? 0} label="Antworten (Jarvis)" />
              <HudStat value={humanAi.total_completion_tokens ?? 0} label="Completion-Tokens" format={v => v.toLocaleString('de-AT')} />
              <div style={{ flex: '1 1 120px', minWidth: 120 }}>
                <div className="hud-stat-value" style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>{fmtDuration(humanAi.total_reasoning_ms)}</div>
                <div className="hud-stat-label">Reasoning-Zeit gesamt</div>
              </div>
            </div>
          ) : <div className="obs-empty">Noch keine Reasoning-Daten.</div>}
        </HudTile>

        <HudTile title="Werkzeug-Verhalten" badge={RANGE_SUFFIX[behavior?.range ?? range] ?? range} accent="var(--obs-purple)" span={2}>
          {toolDist.length === 0 || toolDist.every(d => d.value === 0)
            ? <div className="obs-empty">Noch keine Werkzeugaufrufe.</div>
            : <ObsDonut data={toolDist} gradientIdPrefix="machine-tool-distribution" />
          }
        </HudTile>

        <HudTile title="Refusal- & Anomalie-Oberfläche" badge="META" accent="var(--sem-danger)" span={2}>
          {anomalyTotal > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {anomalyBars.filter(b => b.value > 0).map(b => (
                <div key={b.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#9aa0a8' }}>{b.label}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{b.value}</span>
                </div>
              ))}
            </div>
          ) : <div className="obs-empty">Keine Anomalien im Zeitraum.</div>}
        </HudTile>
      </HudGrid>

      <div className="obs-section-label">Letzte Anomalien</div>
      {(anomalies ?? []).length === 0
        ? <div className="obs-card"><div className="obs-empty">Keine Anomalien protokolliert.</div></div>
        : (anomalies ?? []).map((a) => (
            <div className="obs-item-card" key={a.id} style={{ ['--obs-accent' as string]: anomalyAccent(a.kind) }}>
              <div className="obs-item-title">{ANOMALY_KIND_LABEL[a.kind] ?? a.kind}</div>
              <div className="obs-item-meta">{a.created_at}{a.detail ? ` · ${a.detail}` : ''}</div>
            </div>
          ))}

      <div className="obs-section-label">Halluzinations-Selbstkontrolle</div>
      {(checks ?? []).length === 0
        ? <div className="obs-card"><div className="obs-empty">Noch keine Prüfungen.</div></div>
        : (checks ?? []).map((c) => {
            const ok = c.verdict === 'match'
            return (
              <div className="obs-item-card" key={c.id} style={{ ['--obs-accent' as string]: ok ? 'var(--sem-success)' : 'var(--sem-danger)' }}>
                <div className="obs-item-meta">
                  <span className="obs-pill" style={{ background: ok ? 'color-mix(in srgb, var(--sem-success) 14%, transparent)' : 'color-mix(in srgb, var(--sem-danger) 14%, transparent)', color: ok ? 'var(--sem-success)' : 'var(--sem-danger)' }}>{ok ? 'match' : 'mismatch'}</span>
                  {' · '}{c.created_at}
                </div>
              </div>
            )
          })}

    </div>
  )
}
