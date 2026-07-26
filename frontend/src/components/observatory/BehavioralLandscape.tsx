import { useState } from 'react'
import { useAdminFetch } from '../../lib/adminApi'
import { TOOL_LABELS } from '../../lib/toolLabels'
import { foldIntoOther } from '../../lib/chartMath'
import { HudGrid, HudTile, HudStat, useHeaderActions } from './Hud'

// ── Verhaltenslandschaft ──────────────────────────────────────────────────
// ONE module for "beide Verhaltensweisen" — Lauras Mind (Bucket 1) + Jarvis'
// Werkzeugverhalten (Bucket 2-Seite, die bereits in /behavior liegt). Die
// nutzlosen alten aggregates (category_mix / length_distribution /
// recent_tool_calls) sind raus; stattdessen Lauras echte Metriken aus
// /human-ai + /fragments/distribution (die gleichen Quellen wie das alte
// Mind-Dashboard), plus Jarvis' tool_distribution.
//
// Hausregel: null/leer vom Backend → "Noch keine Daten", nie eine 0 als
// echte Zahl verpackt.

interface ToolBucket { tool?: string; count: number }
interface BehaviorData {
  range: string
  tool_distribution: ToolBucket[]
}

interface AcceptModifyReject {
  accepted: number
  modified: number
  rejected: number
  total: number
  modify_ratio: number
  reject_ratio: number
}
interface HumanAiData {
  range: string
  user_messages: number | null
  assistant_messages: number | null
  typing_velocity_cpm: number | null
  backspace_ratio: number | null
  mean_idle_seconds: number | null
  avg_prompt_length: number | null
  avg_structured_prompt_ratio: number | null
  avg_constraint_density: number | null
  accept_modify_reject: AcceptModifyReject | null
  decision_latency_seconds: number | null
  reverse_latency_seconds: number | null
  clarification_efficiency_seconds: number | null
  repair_success_ratio: number | null
}
interface LayerBucket { layer: string; count: number }
interface DistributionData {
  range: string
  total: number
  by_layer: LayerBucket[]
}

const LAYER_LABELS: Record<string, string> = {
  facts: 'Fakten', analysis: 'Analyse', patterns: 'Muster', hypotheses: 'Hypothesen',
  symbols: 'Symbole', action: 'Handlung', counterarguments: 'Gegenargumente', blind_spot: 'Blinder Fleck',
}
const RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: '7d', label: 'Letzte 7 Tage' },
  { value: '30d', label: 'Letzte 30 Tage' },
  { value: 'all', label: 'Alle' },
]
const RANGE_SUFFIX: Record<string, string> = { '7d': 'letzte 7 Tage', '30d': 'letzte 30 Tage', all: 'alle' }

const fmtInt = (v: number) => String(Math.round(v))
const fmtPct = (v: number) => `${(v * 100).toFixed(1)} %`
const fmtSec = (v: number) => `${v.toFixed(1)} s`

function Stat({ value, label, format, accent }: { value: number | null | undefined; label: string; format?: (v: number) => string; accent?: string }) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <div style={{ flex: '1 1 120px', minWidth: 120 }}><div className="obs-empty">Noch keine Daten</div><div className="hud-stat-label" style={{ marginTop: 4 }}>{label}</div></div>
  }
  return <div style={{ flex: '1 1 120px', minWidth: 120 }}><HudStat value={value} label={label} format={format} accent={accent} /></div>
}

function LayerBar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? (count / max) * 100 : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <div style={{ width: 110, fontSize: 12, color: '#c7ccd4', flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, background: 'color-mix(in srgb, var(--obs-green) 10%, transparent)', borderRadius: 3, height: 14, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--obs-green)', borderRadius: 3 }} />
      </div>
      <div style={{ width: 48, textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: '#e6e9ee', flexShrink: 0 }}>{fmtInt(count)}</div>
    </div>
  )
}

export function BehavioralLandscape() {
  const [range, setRange] = useState('30d')
  const { data: behavior, loading: lB, error: eB } = useAdminFetch<BehaviorData>(`/api/observatory/behavior?range=${range}`, [range])
  const { data: mind, loading: lM, error: eM } = useAdminFetch<HumanAiData>(`/api/observatory/human-ai?range=${range}`, [range])
  const { data: dist, loading: lD } = useAdminFetch<DistributionData>(`/api/observatory/fragments/distribution?range=${range}`, [range])

  useHeaderActions(
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <select value={range} onChange={e => setRange(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
        {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>,
    [range],
  )

  if (lB || lM || lD) return <div className="obs-panel"><div className="obs-empty">Lade Verhaltensdaten…</div></div>
  if (eB || eM) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>

  const toolDist = foldIntoOther((behavior?.tool_distribution ?? []).map(b => ({ label: TOOL_LABELS[b.tool ?? ''] ?? (b.tool ?? '—'), value: b.count })))
  const amr = mind?.accept_modify_reject ?? null
  const layerMax = dist && dist.by_layer.length > 0 ? Math.max(...dist.by_layer.map(b => b.count)) : 0

  return (
    <div className="obs-panel">
      {/* ── LAURA · Kognitive Signatur (STATE) ── */}
      <div className="obs-section-label">Laura · Kognitive Signatur <span style={{ opacity: .6 }}>(STATE)</span></div>
      <HudGrid cols={4}>
        <HudTile title="Tippgeschwindigkeit" badge="STATE" accent="var(--obs-blue)" span={4}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <Stat value={mind?.typing_velocity_cpm} label="CPM" format={fmtInt} accent="var(--obs-blue)" />
            <Stat value={mind?.backspace_ratio} label="Backspace-Anteil" format={fmtPct} accent="var(--obs-blue)" />
            <Stat value={mind?.mean_idle_seconds} label="Mittlere Pause (s)" format={fmtSec} accent="var(--obs-blue)" />
            <Stat value={mind?.avg_prompt_length} label="Ø Prompt-Länge (Zeichen)" format={fmtInt} accent="var(--obs-blue)" />
          </div>
        </HudTile>
      </HudGrid>

      {/* ── LAURA · Entscheidungen (TRAIT) ── */}
      <HudGrid cols={4}>
        <HudTile title="Entscheidungen" badge="TRAIT" accent="var(--obs-purple)" span={2}>
          {amr ? (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <Stat value={amr.accepted} label="Akzeptiert" format={fmtInt} accent="var(--obs-purple)" />
              <Stat value={amr.modified} label="Modifiziert" format={fmtInt} accent="var(--obs-purple)" />
              <Stat value={amr.rejected} label="Verworfen" format={fmtInt} accent="var(--obs-purple)" />
              <Stat value={mind?.decision_latency_seconds} label="Entscheidungslatenz (s)" format={fmtSec} accent="var(--obs-purple)" />
            </div>
          ) : <div className="obs-empty">Noch keine Daten</div>}
        </HudTile>
        <HudTile title="Reaktion & Reparatur" badge="TRAIT" accent="var(--obs-teal)" span={2}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <Stat value={mind?.reverse_latency_seconds} label="Reaktionszeit Laura (s)" format={fmtSec} accent="var(--obs-teal)" />
            <Stat value={mind?.clarification_efficiency_seconds} label="Klarstellungseffizienz (s)" format={fmtSec} accent="var(--obs-teal)" />
            <Stat value={mind?.repair_success_ratio} label="Reparatur-Erfolg" format={fmtPct} accent="var(--obs-teal)" />
          </div>
        </HudTile>
      </HudGrid>

      {/* ── LAURA · Kommunikation + 8-Layer ── */}
      <HudGrid cols={4}>
        <HudTile title="Kommunikation" badge="STATE" accent="var(--obs-amber)" span={2}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <Stat value={mind?.avg_structured_prompt_ratio} label="Strukturierungsanteil" format={fmtPct} accent="var(--obs-amber)" />
            <Stat value={mind?.avg_constraint_density} label="Constraint-Dichte" format={fmtPct} accent="var(--obs-amber)" />
            <Stat value={mind?.user_messages} label="Laura-Nachrichten" format={fmtInt} accent="var(--obs-amber)" />
          </div>
        </HudTile>
        <HudTile title="8-Layer-Verteilung" badge="TRAIT" accent="var(--obs-green)" span={2}>
          {dist && dist.by_layer.length > 0 ? (
            <div>{dist.by_layer.map(b => <LayerBar key={b.layer} label={LAYER_LABELS[b.layer] ?? b.layer} count={b.count} max={layerMax} />)}</div>
          ) : <div className="obs-empty">Noch keine Daten</div>}
        </HudTile>
      </HudGrid>

      {/* ── JARVIS · Werkzeugverhalten ── */}
      <div className="obs-section-label">Jarvis · Werkzeugverhalten <span style={{ opacity: .6 }}>({RANGE_SUFFIX[behavior?.range ?? range] ?? range})</span></div>
      <HudGrid cols={4}>
        <HudTile title="Werkzeug-Verteilung" badge="MACHINE" accent="var(--obs-teal)" span={4}>
          {toolDist.length === 0 || toolDist.every(d => d.value === 0)
            ? <div className="obs-empty">Noch keine Werkzeugaufrufe.</div>
            : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
                {toolDist.map(d => (
                  <div key={d.label} style={{ minWidth: 130 }}>
                    <div style={{ fontSize: 12, color: '#c7ccd4' }}>{d.label}</div>
                    <div style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums', color: '#e6e9ee' }}>{fmtInt(d.value)}</div>
                  </div>
                ))}
              </div>
          }
        </HudTile>
      </HudGrid>
    </div>
  )
}
