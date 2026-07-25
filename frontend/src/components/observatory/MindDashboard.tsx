import { useState } from 'react'
import { useAdminFetch } from '../../lib/adminApi'
import { HudGrid, HudTile, HudStat, useHeaderActions } from './Hud'

/// Bucket 1 ('Laura's Mind') of the 40/40/20 Deep Self-Analysis framework.
/// A read-only view over the EXISTING observatory endpoints — it never
/// fabricates a measurement: every metric that is `null` in the response
/// renders the honest 'Noch keine Daten' rather than a zero dressed up as a
/// real number (hard house rule across the Observatory).
///
/// Bucket 1 follows Laura's own pipeline: empfängt → interpretiert →
/// entscheidet → handelt → reflektiert. Each tile maps to one stage.
///
/// STATE vs TRAIT: session-level samples (Tippgeschwindigkeit, Idle, …) are
/// tagged 'STATE'; cross-session aggregates (Entscheidungsraten) are tagged
/// 'TRAIT'. The badges are the framework's own demand that the dashboard say
/// which kind of number each tile shows.

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
  mean_latency_seconds: number | null
  reverse_latency_seconds: number | null
  accept_modify_reject: AcceptModifyReject | null
  decision_latency_seconds: number | null
  clarification_efficiency_seconds: number | null
  repair_success_ratio: number | null
  typing_velocity_cpm: number | null
  backspace_ratio: number | null
  mean_idle_seconds: number | null
  avg_prompt_length: number | null
  avg_structured_prompt_ratio: number | null
  avg_constraint_density: number | null
}

interface LayerBucket {
  layer: string
  count: number
}

interface DistributionData {
  range: string
  total: number
  by_layer: LayerBucket[]
  definitions_note: string
}

/// Human-readable German labels for the 8-layer taxonomy (the closed backend
/// vocabulary is snake_cased English). Pure display mapping — never sent back.
const LAYER_LABELS: Record<string, string> = {
  facts: 'Fakten',
  analysis: 'Analyse',
  patterns: 'Muster',
  hypotheses: 'Hypothesen',
  symbols: 'Symbole',
  action: 'Handlung',
  counterarguments: 'Gegenargumente',
  blind_spot: 'Blinder Fleck',
}

const RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: '7d', label: '7 Tage' },
  { value: '30d', label: '30 Tage' },
  { value: 'all', label: 'Alle' },
]

const RANGE_SUFFIX: Record<string, string> = { '7d': 'letzte 7 Tage', '30d': 'letzte 30 Tage', all: 'alle' }

/// Renders a measured number as a HudStat, or the honest empty state when the
/// endpoint returned `null` for this metric. Never substitutes a 0 for a
/// missing measurement.
function Stat({
  value,
  label,
  format,
  accent,
}: {
  value: number | null | undefined
  label: string
  format?: (v: number) => string
  accent?: string
}) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return (
      <div style={{ flex: '1 1 120px', minWidth: 120 }}>
        <div className="obs-empty">Noch keine Daten</div>
        <div className="hud-stat-label" style={{ marginTop: 4 }}>{label}</div>
      </div>
    )
  }
  return (
    <div style={{ flex: '1 1 120px', minWidth: 120 }}>
      <HudStat value={value} label={label} format={format} accent={accent} />
    </div>
  )
}

const fmtInt = (v: number) => String(Math.round(v))
const fmtPct = (v: number) => `${(v * 100).toFixed(1)} %`
const fmtSec = (v: number) => `${v.toFixed(1)} s`

/// One proportional bar in the 8-layer distribution: label + count + a fill
/// whose width is the share of the window total. Inline styles only — no new
/// CSS class is introduced.
function LayerBar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? (count / max) * 100 : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <div style={{ width: 110, fontSize: 12, color: '#c7ccd4', flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, background: 'color-mix(in srgb, var(--obs-green) 10%, transparent)', borderRadius: 3, height: 14, overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: 'var(--obs-green)',
            borderRadius: 3,
          }}
        />
      </div>
      <div style={{ width: 48, textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: '#e6e9ee', flexShrink: 0 }}>
        {fmtInt(count)}
      </div>
    </div>
  )
}

export function MindDashboard() {
  const [range, setRange] = useState('30d')

  const { data: mind, loading, error } = useAdminFetch<HumanAiData>(
    `/api/observatory/human-ai?range=${range}`,
    [range],
  )
  const { data: dist } = useAdminFetch<DistributionData>(
    `/api/observatory/fragments/distribution?range=${range}`,
    [range],
  )

  useHeaderActions(
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <select
        value={range}
        onChange={e => setRange(e.target.value)}
        style={{ fontSize: 12, padding: '5px 8px' }}
        aria-label="Zeitraum"
      >
        {RANGE_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>,
    [range],
  )

  if (loading) return <div className="obs-panel"><div className="obs-empty">Lade Laura's Denk-Dashboard…</div></div>
  if (error) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>
  if (!mind) return <div className="obs-panel"><div className="obs-empty">Keine Daten verfügbar.</div></div>

  const amr = mind.accept_modify_reject
  const layerMax = dist && dist.by_layer.length > 0 ? Math.max(...dist.by_layer.map(b => b.count)) : 0

  return (
    <div className="obs-panel">
      <p style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.6, margin: '0 0 12px' }}>
        Laura's Mind (Bucket 1) — empfängt → interpretiert → entscheidet → handelt → reflektiert.
        Aggregierte Verhaltens- und Denkmuster über alle Gespräche ({RANGE_SUFFIX[mind.range] ?? mind.range}), keine Einzelpersonen-Überwachung.
      </p>

      {/* ── empfängt / Kognitive Signatur (STATE: sitzungsnahe Stichproben) ── */}
      <HudGrid cols={4}>
        <HudTile title="Kognitive Signatur" badge="STATE" accent="var(--obs-blue)" span={4}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <Stat value={mind.typing_velocity_cpm} label="Tippgeschwindigkeit (CPM)" format={fmtInt} accent="var(--obs-blue)" />
            <Stat value={mind.backspace_ratio} label="Backspace-Anteil" format={fmtPct} accent="var(--obs-blue)" />
            <Stat value={mind.mean_idle_seconds} label="Mittlere Pause (s)" format={fmtSec} accent="var(--obs-blue)" />
            <Stat value={mind.avg_prompt_length} label="Ø Prompt-Länge (Zeichen)" format={fmtInt} accent="var(--obs-blue)" />
          </div>
        </HudTile>
      </HudGrid>

      {/* ── entscheidet / Entscheidungen (TRAIT: über Sitzungen aggregiert) ── */}
      <HudGrid cols={4}>
        <HudTile title="Entscheidungen" badge="TRAIT" accent="var(--obs-purple)" span={2}>
          {amr ? (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <Stat value={amr.accepted} label="Akzeptiert" format={fmtInt} accent="var(--obs-purple)" />
              <Stat value={amr.modified} label="Modifiziert" format={fmtInt} accent="var(--obs-purple)" />
              <Stat value={amr.rejected} label="Verworfen" format={fmtInt} accent="var(--obs-purple)" />
              <Stat value={mind.decision_latency_seconds} label="Entscheidungs­latenz (s)" format={fmtSec} accent="var(--obs-purple)" />
            </div>
          ) : (
            <div className="obs-empty">Noch keine Daten</div>
          )}
        </HudTile>

        {/* ── handelt / Reaktion & Reparatur ── */}
        <HudTile title="Reaktion & Reparatur" badge="TRAIT" accent="var(--obs-teal)" span={2}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <Stat value={mind.reverse_latency_seconds} label="Reaktionszeit Laura (s)" format={fmtSec} accent="var(--obs-teal)" />
            <Stat value={mind.clarification_efficiency_seconds} label="Klarstellungs­effizienz (s)" format={fmtSec} accent="var(--obs-teal)" />
            <Stat value={mind.repair_success_ratio} label="Reparatur-Erfolg" format={fmtPct} accent="var(--obs-teal)" />
          </div>
        </HudTile>
      </HudGrid>

      {/* ── interpretiert / Kommunikation ── */}
      <HudGrid cols={4}>
        <HudTile title="Kommunikation" badge="STATE" accent="var(--obs-amber)" span={2}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <Stat value={mind.avg_structured_prompt_ratio} label="Strukturierungs­anteil" format={fmtPct} accent="var(--obs-amber)" />
            <Stat value={mind.avg_constraint_density} label="Constraint-Dichte" format={fmtPct} accent="var(--obs-amber)" />
            <Stat value={mind.user_messages} label="Laura-Nachrichten" format={fmtInt} accent="var(--obs-amber)" />
          </div>
        </HudTile>

        {/* ── reflektiert / 8-Layer-Verteilung ── */}
        <HudTile title="8-Layer-Verteilung" badge="TRAIT" accent="var(--obs-green)" span={2}>
          {dist && dist.by_layer.length > 0 ? (
            <div>
              {dist.by_layer.map(b => (
                <LayerBar
                  key={b.layer}
                  label={LAYER_LABELS[b.layer] ?? b.layer}
                  count={b.count}
                  max={layerMax}
                />
              ))}
              {dist.definitions_note && (
                <p style={{ fontSize: 11, color: '#9aa0a8', lineHeight: 1.5, margin: '8px 0 0' }}>{dist.definitions_note}</p>
              )}
            </div>
          ) : (
            <div className="obs-empty">Noch keine Daten</div>
          )}
        </HudTile>
      </HudGrid>
    </div>
  )
}
