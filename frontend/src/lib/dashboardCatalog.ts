import { foldIntoOther } from './chartMath'
import { TOOL_LABELS } from './toolLabels'
import { STATUS_ACCENT as EMERGENCE_STATUS_ACCENT } from '../components/observatory/registry'
import { STATUS_ACCENT as SIM_STATUS_ACCENT } from '../components/observatory/SimulationLab'

// Track A Phase 6c — the fixed widget catalog behind the customizable
// dashboard's "+ Widget" picker. Deliberately a *predefined* catalog, not
// freeform "chart any field" configuration (the same call the plan made for
// this feature from the start): every entry's `transform` is a direct port
// of the exact aggregation already shipped and screenshot-verified on the
// module that owns that data (EmergenceMonitor, Analytics, SimulationCenter,
// BehavioralLandscape, InteractionDynamics, Monetization, Denkfragmente,
// AnomalyLog's backend), not a re-derivation — see each entry's comment for
// the source file/lines it mirrors. A widget's `chartKind` and its
// `transform`'s actual return shape are linked by convention (this file),
// not the type system: `transform` is intentionally typed as `(raw: any) =>
// any` because the 4 possible return shapes (donut/gauge/radar/multiline
// props) don't share a structural union worth forcing through generics for
// a hand-authored, code-reviewed catalog — WidgetCard.tsx trusts the pairing
// and casts per `chartKind`.
export type ChartKind = 'donut' | 'gauge' | 'radar' | 'multiline'

export interface CatalogEntry {
  key: string
  title: string
  /** Groups entries in the "+ Widget" picker and drives the pencil's
   * data-source swap (only offered within the same `family`). */
  category: string
  chartKind: ChartKind
  /** Fetched with authHeaders() by WidgetCard.tsx; each widget fetches its
   * own data independently (no shared cache) — same "every module owns its
   * own fetch" convention as the rest of Observatory. */
  fetchPath: string
  /** Sibling entries this one can be swapped for via the pencil popover
   * without changing chartKind or grid size — e.g. the three Behavioral
   * Landscape donuts all read the same shape from the same endpoint. Entries
   * with no family (the two gauges, the radar, the multiline trend) have
   * nothing shape-compatible to swap to, so the pencil never offers a
   * data-source control for them. */
  family?: string
  defaultSize: { w: number; h: number }
  transform: (raw: any) => any
}

// Compact local copy of Denkfragmente.tsx's 8-Layer-Model axis order/labels/
// colors — not exported from that file (it's page-scoped there), and this
// is the only other consumer, so a small duplicated constant here beats
// coupling this catalog's import graph to a specific admin page component.
const LAYER_ORDER = ['facts', 'analysis', 'patterns', 'hypotheses', 'symbols', 'action', 'counterarguments', 'blind_spot'] as const
const LAYER_LABELS: Record<string, string> = {
  facts: 'Fakten', analysis: 'Analyse', patterns: 'Muster', hypotheses: 'Hypothesen',
  symbols: 'Symbole', action: 'Handlung', counterarguments: 'Gegenargumente', blind_spot: 'Blinder Fleck',
}
const LAYER_COLORS: Record<string, string> = {
  facts: '#3b82f6', analysis: '#8b5cf6', patterns: '#06b6d4', hypotheses: '#f59e0b',
  symbols: '#ec4899', action: '#10b981', counterarguments: '#ef4444', blind_spot: '#6b7280',
}

const TREND_SERIES = [
  { key: 'views', label: 'Views', color: '#34e1ff' },
  { key: 'chat_messages', label: 'Chat-Nachrichten', color: '#8b5cf6' },
  { key: 'tool_calls', label: 'Tool-Calls', color: '#f59e0b' },
  { key: 'research_notes', label: 'Research Notes', color: '#10b981' },
  { key: 'blog_posts', label: 'Blogposts', color: '#ec4899' },
  { key: 'simulation_runs', label: 'Simulation Runs', color: '#3b82f6' },
]

export const DASHBOARD_CATALOG: CatalogEntry[] = [
  // ── Emergence — mirrors EmergenceMonitor.tsx's own donut/gauge transforms ──
  {
    key: 'emergence-level-mix', title: 'Emergenz-Level-Mix', category: 'Emergence', chartKind: 'donut',
    fetchPath: '/api/observatory/emergence/signals?limit=200', family: 'emergence-signal-mix',
    defaultSize: { w: 3, h: 3 },
    // list_signals (backend/src/emergence.rs) returns a bare JSON array
    // (total count rides the `x-total-count` header, not a response field).
    transform: (raw: { level: string }[]) => {
      const levels = ['emerging', 'stable', 'fading', 'hypothetical']
      return { data: levels.map(l => ({ label: l, value: raw.filter(s => s.level === l).length, color: EMERGENCE_STATUS_ACCENT[l] })) }
    },
  },
  {
    key: 'emergence-status-mix', title: 'Emergenz-Status-Mix', category: 'Emergence', chartKind: 'donut',
    fetchPath: '/api/observatory/emergence/signals?limit=200', family: 'emergence-signal-mix',
    defaultSize: { w: 3, h: 3 },
    transform: (raw: { status: string }[]) => {
      const statuses = Array.from(new Set(raw.map(s => s.status)))
      return { data: statuses.map(s => ({ label: s, value: raw.filter(x => x.status === s).length })) }
    },
  },
  {
    key: 'emergence-cei-gauge', title: 'CEI (Confidence)', category: 'Emergence', chartKind: 'gauge',
    fetchPath: '/api/observatory/emergence/ccet', defaultSize: { w: 2, h: 2 },
    transform: (raw: { cei: number }) => ({ value: raw.cei, label: 'CEI' }),
  },
  {
    key: 'emergence-resonance-gauge', title: 'Resonanz-Frequenz', category: 'Emergence', chartKind: 'gauge',
    fetchPath: '/api/observatory/emergence/ccet', defaultSize: { w: 2, h: 2 },
    transform: (raw: { resonance_frequency: number }) => ({ value: raw.resonance_frequency, label: 'Resonanz' }),
  },

  // ── Analytics — mirrors Analytics.tsx's foldIntoOther donuts + activity_trend ──
  {
    key: 'analytics-top-sources', title: 'Top-Quellen', category: 'Analytics', chartKind: 'donut',
    fetchPath: '/api/analytics?days=30', family: 'analytics-donut', defaultSize: { w: 3, h: 3 },
    transform: (raw: { top_sources: { label: string; count: number }[] }) =>
      ({ data: foldIntoOther(raw.top_sources.map(s => ({ label: s.label || '(direkt)', value: s.count }))) }),
  },
  {
    key: 'analytics-tool-calls', title: 'Tool-Call-Verteilung', category: 'Analytics', chartKind: 'donut',
    fetchPath: '/api/analytics?days=30', family: 'analytics-donut', defaultSize: { w: 3, h: 3 },
    transform: (raw: { tool_call_counts: { tool: string; count: number }[] }) =>
      ({ data: foldIntoOther(raw.tool_call_counts.map(t => ({ label: t.tool, value: t.count }))) }),
  },
  {
    key: 'analytics-activity-trend', title: 'Aktivitäts-Trend', category: 'Analytics', chartKind: 'multiline',
    fetchPath: '/api/analytics?days=30', defaultSize: { w: 6, h: 3 },
    transform: (raw: { activity_trend: Record<string, number | string>[] }) => ({
      labels: raw.activity_trend.map(p => String(p.bucket).slice(5)),
      series: TREND_SERIES.map(s => ({ ...s, values: raw.activity_trend.map(p => Number(p[s.key]) || 0) })),
    }),
  },

  // ── Simulation — mirrors SimulationCenter.tsx's client-aggregated donuts ──
  {
    key: 'simulation-run-status', title: 'Run-Status', category: 'Simulation', chartKind: 'donut',
    fetchPath: '/api/simulation/runs?limit=200', family: 'simulation-donut', defaultSize: { w: 3, h: 3 },
    // list_runs (backend/src/simulation.rs) returns a bare JSON array too.
    transform: (raw: { status: string }[]) =>
      ({ data: Object.keys(SIM_STATUS_ACCENT).map(status => ({ label: status, value: raw.filter(r => r.status === status).length, color: SIM_STATUS_ACCENT[status] })) }),
  },
  {
    key: 'simulation-branch-status', title: 'Branch-Status', category: 'Simulation', chartKind: 'donut',
    fetchPath: '/api/simulation/runs?limit=200', family: 'simulation-donut', defaultSize: { w: 3, h: 3 },
    transform: (raw: { branches?: { status: string }[] }[]) => {
      const branches = raw.flatMap(r => r.branches ?? [])
      return { data: Object.keys(SIM_STATUS_ACCENT).map(status => ({ label: status, value: branches.filter(b => b.status === status).length, color: SIM_STATUS_ACCENT[status] })) }
    },
  },

  // ── Behavioral — mirrors BehavioralLandscape.tsx's foldIntoOther donuts ──
  {
    key: 'behavioral-category-mix', title: 'Kategorie-Mix', category: 'Behavioral', chartKind: 'donut',
    fetchPath: '/api/observatory/behavior?range=30d', family: 'behavioral-donut', defaultSize: { w: 3, h: 3 },
    transform: (raw: { category_mix: { category?: string; count: number }[] }) =>
      ({ data: foldIntoOther(raw.category_mix.map(b => ({ label: b.category ?? '—', value: b.count }))) }),
  },
  {
    key: 'behavioral-tool-distribution', title: 'Tool-Verteilung', category: 'Behavioral', chartKind: 'donut',
    fetchPath: '/api/observatory/behavior?range=30d', family: 'behavioral-donut', defaultSize: { w: 3, h: 3 },
    transform: (raw: { tool_distribution: { tool?: string; count: number }[] }) =>
      ({ data: foldIntoOther(raw.tool_distribution.map(b => ({ label: TOOL_LABELS[b.tool ?? ''] ?? (b.tool ?? '—'), value: b.count }))) }),
  },
  {
    key: 'behavioral-length-distribution', title: 'Längen-Verteilung', category: 'Behavioral', chartKind: 'donut',
    fetchPath: '/api/observatory/behavior?range=30d', family: 'behavioral-donut', defaultSize: { w: 3, h: 3 },
    transform: (raw: { length_distribution: { bucket?: string; count: number }[] }) =>
      ({ data: foldIntoOther(raw.length_distribution.map(b => ({ label: (b.bucket ?? '—').replace(/^./, c => c.toUpperCase()), value: b.count }))) }),
  },

  // ── Interaction — mirrors InteractionDynamics.tsx / ForschungKpis.tsx ──
  {
    key: 'interaction-message-ratio', title: 'Mensch ↔ KI', category: 'Interaction', chartKind: 'donut',
    fetchPath: '/api/observatory/human-ai?range=30d', defaultSize: { w: 3, h: 3 },
    transform: (raw: { user_messages: number; assistant_messages: number }) =>
      ({ data: [{ label: 'Mensch', value: raw.user_messages, color: 'var(--obs-purple)' }, { label: 'KI', value: raw.assistant_messages, color: 'var(--obs-blue)' }] }),
  },
  {
    key: 'interaction-confidence-gauge', title: 'Ø Modell-Konfidenz', category: 'Interaction', chartKind: 'gauge',
    fetchPath: '/api/observatory/human-ai?range=30d', defaultSize: { w: 2, h: 2 },
    transform: (raw: { mean_token_confidence: number | null }) => ({ value: raw.mean_token_confidence ?? 0, label: 'Konfidenz' }),
  },

  // ── Monetization — mirrors Monetization.tsx's client-fold-by-product ──
  {
    key: 'monetization-revenue-by-product', title: 'Umsatz nach Produkt', category: 'Monetization', chartKind: 'donut',
    fetchPath: '/api/billing/orders?limit=200', defaultSize: { w: 3, h: 3 },
    transform: (raw: { product_name: string | null; amount_cents: number }[]) => {
      const byProduct = raw.reduce<Record<string, number>>((acc, o) => {
        const key = o.product_name ?? 'Unbekanntes Produkt'
        acc[key] = (acc[key] ?? 0) + o.amount_cents
        return acc
      }, {})
      return { data: Object.entries(byProduct).map(([label, value]) => ({ label, value })) }
    },
  },

  // ── Anomalies — mirrors anomaly.rs's distribution endpoint (Phase 5),
  // previously built but never actually consumed by any frontend view. ──
  {
    key: 'anomaly-kind-mix', title: 'Anomalie-Arten', category: 'Anomalies', chartKind: 'donut',
    fetchPath: '/api/observatory/anomalies/distribution?range=30d', defaultSize: { w: 3, h: 3 },
    transform: (raw: { by_kind: { kind: string; count: number }[] }) => ({ data: raw.by_kind.map(b => ({ label: b.kind, value: b.count })) }),
  },

  // ── Denkfragmente — mirrors Denkfragmente.tsx's 8-layer radar ──
  {
    key: 'denkfragmente-layer-radar', title: '8-Layer-Verteilung', category: 'Denkfragmente', chartKind: 'radar',
    fetchPath: '/api/observatory/fragments/distribution?range=30d', defaultSize: { w: 4, h: 4 },
    transform: (raw: { by_layer: { layer: string; count: number }[] }) => {
      const max = Math.max(...raw.by_layer.map(b => b.count), 1)
      return {
        axes: LAYER_ORDER.map(layer => ({
          key: layer, label: LAYER_LABELS[layer],
          value: raw.by_layer.find(b => b.layer === layer)?.count ?? 0,
          max, color: LAYER_COLORS[layer],
        })),
      }
    },
  },
]

export function catalogEntry(key: string): CatalogEntry | undefined {
  return DASHBOARD_CATALOG.find(e => e.key === key)
}

export function catalogFamily(family: string | undefined): CatalogEntry[] {
  if (!family) return []
  return DASHBOARD_CATALOG.filter(e => e.family === family)
}
