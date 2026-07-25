import { useState } from 'react'
import { useAdminFetch } from '../../lib/adminApi'
import { foldIntoOther } from '../../lib/chartMath'
import { hudStagger } from '../../lib/hudStagger'
import { HudGrid, HudTile, HudStat, useHeaderActions } from './Hud'
import { ObsDonut } from './ObsDonut'

// ── Bucket 2 · JARVIS THE MACHINE ───────────────────────────────────────────
// Reasoning architecture, refusal surface and error honesty — Jarvis viewed as
// a fully autonomous agent whose logging, refusal triggers and self-audits are
// ACCOUNTABILITY features of that autonomy, not hedges against it. Every copy
// below assumes the agent runs on its own; nothing here frames him as waiting
// on human input or as anything less than autonomous.
//
// Data is pulled from EXISTING endpoints only (no new backend work):
//   GET /api/observatory/behavior?range=    → tool_distribution (Werkzeug-Verhalten)
//   GET /api/observatory/anomalies/distribution?range= → 4-kind rollup (Refusal/Anomalie)
//   GET /api/observatory/anomalies?limit=   → recent anomaly rows (Refusal/Anomalie)
//   GET /api/observatory/hallucination-checks?limit= → recent verdicts (Halluzination)
//   GET /api/observatory/human-ai?range=    → assistant_messages / tokens / reasoning_ms

interface BehaviorData {
  range: string
  tool_distribution: { tool: string; count: number }[]
}

interface DistributionOut {
  range: string
  total: number
  by_kind: { kind: string; count: number }[]
}

interface AnomalyRow {
  id: string
  kind: string
  conversation_id: string
  chat_message_id: string | null
  detail: string
  created_at: string
}

interface CheckRow {
  id: string
  chat_message_id: string
  tool_call_id: string
  verdict: string
  detail: string
  created_at: string
}

interface HumanAiData {
  range: string
  assistant_messages: number
  total_completion_tokens: number
  total_reasoning_ms: number
}

const RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: '7d', label: 'Letzte 7 Tage' },
  { value: '30d', label: 'Letzte 30 Tage' },
  { value: 'all', label: 'Alle' },
]
const RANGE_SUFFIX: Record<string, string> = { '7d': 'letzte 7 Tage', '30d': 'letzte 30 Tage', all: 'alle' }

// The four anomaly kinds are a closed enum on the backend; the zero IS
// information (a kind that never fired in the window is itself a finding).
const ANOMALY_KIND_LABEL: Record<string, string> = {
  tool_error: 'Werkzeugfehler',
  iteration_cap: 'Iterations-Limit',
  refusal_triggered: 'Refusal ausgelöst',
  hallucination_mismatch: 'Halluzinations-Mismatch',
}

function anomalyAccent(kind: string): string {
  if (kind === 'tool_error' || kind === 'hallucination_mismatch') return 'var(--sem-danger)'
  if (kind === 'iteration_cap') return 'var(--obs-amber)'
  if (kind === 'refusal_triggered') return 'var(--obs-purple)'
  return 'var(--obs-teal)'
}

function verdictMeta(v: string): { label: string; color: string } {
  if (v === 'match') return { label: 'ok', color: 'var(--sem-success)' }
  if (v === 'mismatch') return { label: 'Mismatch', color: 'var(--sem-danger)' }
  return { label: 'nicht verifizierbar', color: 'var(--obs-amber)' }
}

// Wall-clock reasoning time measured live in chat::stream_chat — render as
// human-readable seconds / minutes / hours rather than a raw millisecond count.
function formatDuration(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${Math.round(s)} s`
  const m = s / 60
  if (m < 60) return `${Math.floor(m)} Min ${Math.round(s % 60)} s`
  const h = m / 60
  return `${Math.floor(h)} Std ${Math.round(m % 60)} Min`
}

const fmtInt = (v: number) => v.toLocaleString('de-DE')

export function MachineDashboard() {
  const [range, setRange] = useState('30d')

  const behaviorPath = `/api/observatory/behavior?range=${range}`
  const distributionPath = `/api/observatory/anomalies/distribution?range=${range}`
  const humanAiPath = `/api/observatory/human-ai?range=${range}`

  // List endpoints are all-time by design (no range param) — labelled "alle".
  const anomaliesPath = `/api/observatory/anomalies?limit=10`
  const checksPath = `/api/observatory/hallucination-checks?limit=10`

  const { data: behavior, loading: loadingBehavior, error: errorBehavior } =
    useAdminFetch<BehaviorData>(behaviorPath, [range])
  const { data: distribution, loading: loadingDist, error: errorDist } =
    useAdminFetch<DistributionOut>(distributionPath, [range])
  const { data: humanAi, loading: loadingHuman, error: errorHuman } =
    useAdminFetch<HumanAiData>(humanAiPath, [range])
  const { data: anomalies, loading: loadingAnom, error: errorAnom } =
    useAdminFetch<AnomalyRow[]>(anomaliesPath, [])
  const { data: checks, loading: loadingChecks, error: errorChecks } =
    useAdminFetch<CheckRow[]>(checksPath, [])

  useHeaderActions(
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <select value={range} onChange={e => setRange(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
        {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>,
    [range],
  )

  const loading = loadingBehavior || loadingDist || loadingHuman || loadingAnom || loadingChecks
  const error = errorBehavior || errorDist || errorHuman || errorAnom || errorChecks
  if (loading) return <div className="obs-panel"><div className="obs-empty">Lade Jarvis-Maschinendaten…</div></div>
  if (error) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>

  const toolDistributionData = foldIntoOther(
    (behavior?.tool_distribution ?? []).map(b => ({ label: b.tool, value: b.count })),
  )

  const byKind = distribution?.by_kind ?? []
  const maxKind = byKind.reduce((m, b) => Math.max(m, b.count), 0)

  return (
    <div className="obs-panel">
      <HudGrid cols={4}>
        <HudTile title="Reasoning-Volumen" badge={RANGE_SUFFIX[humanAi?.range ?? range] ?? (humanAi?.range ?? range)} accent="var(--obs-cyan)" span={4}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <HudStat
              value={humanAi?.assistant_messages ?? 0}
              label="Assistenten-Nachrichten"
              format={fmtInt}
              accent="var(--obs-teal)"
            />
            <HudStat
              value={humanAi?.total_completion_tokens ?? 0}
              label="Completion-Tokens"
              format={fmtInt}
              accent="var(--obs-purple)"
            />
            <HudStat
              value={humanAi?.total_reasoning_ms ?? 0}
              label="Reasoning-Zeit"
              format={formatDuration}
              accent="var(--obs-amber)"
            />
          </div>
        </HudTile>
      </HudGrid>

      <HudGrid cols={4}>
        <HudTile title="Werkzeug-Verhalten" badge={RANGE_SUFFIX[behavior?.range ?? range] ?? (behavior?.range ?? range)} accent="var(--obs-teal)" span={2}>
          {toolDistributionData.length === 0 || toolDistributionData.every(d => d.value === 0) ? (
            <div className="obs-empty">Noch keine Werkzeugaufrufe.</div>
          ) : (
            <ObsDonut data={toolDistributionData} gradientIdPrefix="machine-tool-distribution" />
          )}
        </HudTile>

        <HudTile title="Refusal- & Anomalie-Oberfläche" badge={RANGE_SUFFIX[distribution?.range ?? range] ?? (distribution?.range ?? range)} accent="var(--obs-red)" span={2}>
          {byKind.length === 0 ? (
            <div className="obs-empty">Keine Anomalien im Zeitraum.</div>
          ) : (
            <div>
              {byKind.map(b => {
                const pct = maxKind > 0 ? b.count / maxKind : 0
                const accent = anomalyAccent(b.kind)
                return (
                  <div className="obs-item-card" key={b.kind} style={{ ...hudStagger(0), ['--obs-accent' as string]: accent, marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span className="obs-item-title">{ANOMALY_KIND_LABEL[b.kind] ?? b.kind}</span>
                      <span className="obs-item-meta">{b.count}</span>
                    </div>
                    <div style={{ height: 6, marginTop: 6, borderRadius: 3, background: 'var(--obs-track, rgba(255,255,255,0.08))', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct * 100}%`, background: accent, borderRadius: 3 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </HudTile>
      </HudGrid>

      <div className="obs-section-label">Letzte Anomalien</div>
      {!anomalies || anomalies.length === 0 ? (
        <div className="obs-card"><div className="obs-empty">Keine Anomalien im Zeitraum.</div></div>
      ) : (
        anomalies.map((a, i) => (
          <div
            className="obs-item-card"
            key={a.id}
            style={{ ...hudStagger(i), ['--obs-accent' as string]: anomalyAccent(a.kind) }}
          >
            <div className="obs-item-title">{ANOMALY_KIND_LABEL[a.kind] ?? a.kind}</div>
            <div className="obs-item-meta">{a.detail}</div>
            <div className="obs-item-meta" style={{ opacity: 0.7 }}>{a.created_at}</div>
          </div>
        ))
      )}

      <HudGrid cols={4}>
        <HudTile title="Halluzinations-Selbstkontrolle" badge="alle" accent="var(--obs-green)" span={4}>
          {!checks || checks.length === 0 ? (
            <div className="obs-empty">Noch keine Selbstkontroll-Prüfungen protokolliert.</div>
          ) : (
            checks.map((c, i) => {
              const meta = verdictMeta(c.verdict)
              return (
                <div
                  className="obs-item-card"
                  key={c.id}
                  style={{ ...hudStagger(i), ['--obs-accent' as string]: meta.color }}
                >
                  <div className="obs-item-title">{c.detail}</div>
                  <div className="obs-item-meta">
                    <span
                      className="obs-pill"
                      style={{
                        background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
                        color: meta.color,
                      }}
                    >
                      {meta.label}
                    </span>
                    {' · '}{c.created_at}
                  </div>
                </div>
              )
            })
          )}
        </HudTile>
      </HudGrid>

      <p style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.6 }}>
        Aggregierte Maschinentelemetrie über Jarvis' autonome Laufzeit — Refusal-, Fehler- und Halluzinations-Signale sind Teil seiner Eigenkontrolle.
      </p>
    </div>
  )
}
