import { useEffect, useState } from 'react'
import { adminFetch, useAdminFetch } from '../../lib/adminApi'
import { downloadJson } from '../../lib/export'
import { hudStagger } from '../../lib/hudStagger'
import { ExportButtons } from './ExportButtons'
import { HudSkeleton } from './HudSkeleton'
import { FilterPanel, HudGrid, HudTile, HudStat, useHeaderActions } from './Hud'
import { ObsDonut } from './ObsDonut'
import { STATUS_ACCENT } from './registry'

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
  // The "measured emergence" gate (see backend/src/emergence.rs's
  // verify_recurrence) — whether this signal actually cleared the Research
  // page's own 4-criteria bar (content.json, page id `research`, "When does
  // emergence count as measured?"), not just survived this turn's LLM
  // interpretation. `recurrence_count` is only meaningful once
  // `verified_emergence` is true; otherwise it's just the column's own
  // untouched default.
  verified_emergence: boolean
  recurrence_count: number
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

// Nicht nur Human-AI — vier Ebenen, getrennt nach Laura's eigener
// Definition (siehe emergence.rs's Prompt für die genauen Kriterien).
const LEVEL_SECTIONS: { key: string; label: string; empty: string }[] = [
  { key: 'human', label: 'Human', empty: 'Noch keine Human-Signale erkannt — neue Verhaltensmuster, Hypothesen oder Forschungsfortschritt auf Lauras Seite.' },
  { key: 'ai', label: 'AI', empty: 'Noch keine AI-Signale erkannt — Antwortentwicklung, Modellverhalten oder semantische Verschiebung.' },
  { key: 'interaction', label: 'Interaction', empty: 'Noch keine Interaction-Signale erkannt — geteilte Muster, Co-Reasoning, rekursive Schleifen.' },
  { key: 'system', label: 'System', empty: 'Noch keine System-Signale erkannt — gesamtsystemische Veränderungen, neue Cluster, Drift.' },
]

// Same 4 keys as LEVEL_SECTIONS — the color each level's donut slice takes,
// literal --obs-* CSS values rather than obs-stat class names (ObsDonut's
// `color` needs a real CSS color, not a class to attach); same assignment
// (human=purple, ai=blue, interaction=teal, system=amber) the old per-level
// obs-stat tiles used before this donut replaced them.
const LEVEL_DONUT_COLORS: Record<string, string> = {
  human: 'var(--obs-purple)', ai: 'var(--obs-blue)', interaction: 'var(--obs-teal)', system: 'var(--obs-amber)',
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

/// Simple horizontal proportion bar for the two influence directions —
/// existing CSS vars only (copied from the old Dyad+Meta dashboard, now
/// folded into this module).
function DirectionBar({ label, value, max, accent }: { label: string; value: number; max: number; accent: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
      <span style={{ flex: '0 0 130px', color: '#9aa0a8' }}>{label}</span>
      <span style={{ flex: 1, background: 'color-mix(in srgb, currentColor 8%, transparent)', borderRadius: 3, overflow: 'hidden', height: 8 }}>
        <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: accent, transition: 'width .4s ease' }} />
      </span>
      <span style={{ flex: '0 0 28px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

function formatPercent(v: number): string {
  return `${Math.round(v * 100)}%`
}

// A signal's observation text used to render in full, inline, on every card
// at once — the single biggest source of "hardly anything makes sense, too
// much data" on this page (Laura's own words). Truncating the inline card to
// a preview and pushing the full text + full meta behind a click both
// declutters the list AND gives individual signals somewhere to actually
// "pop" into, rather than sitting flat and static on the page.
const PREVIEW_CHARS = 130
function previewText(text: string): string {
  if (text.length <= PREVIEW_CHARS) return text
  return `${text.slice(0, PREVIEW_CHARS).trimEnd()}…`
}

/// Click-to-expand detail view for one signal — reuses the existing
/// `.pem-overlay`/`.pem` modal shell (AdminPanel.tsx's blog-edit modal) for
/// free: same scrim/close/click-outside-to-close behavior, and its already-
/// dark-HUD-themed CSS (`.observatory-hud .pem*`) applies automatically here
/// via ancestor cascade, since this component only ever mounts inside an
/// Observatory tab (see AdminPanel.tsx's OBSERVATORY_MODULES check on
/// `.crm-main`) — no new theme wiring needed. Also gets `.pem`'s existing
/// `site-modal-pop` entrance animation for free, which is exactly the
/// "signals need to pop" behavior asked for, not a new animation invented
/// from scratch.
function SignalDetailModal({ signal, onClose, onOpenConversation }: {
  signal: Signal
  onClose: () => void
  onOpenConversation?: (conversationId: string) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="pem-overlay" onClick={onClose}>
      <div className="pem obs-signal-modal" onClick={e => e.stopPropagation()} style={{ ['--obs-accent' as string]: STATUS_ACCENT[signal.status] ?? '#3b6bf6' }}>
        <div className="pem-header">
          <span className="pem-title">{signal.pattern}</span>
          <button className="pem-close" onClick={onClose} title="Schließen (Esc)">✕</button>
        </div>
        <div className="pem-body obs-signal-modal-body">
          {signal.verified_emergence ? (
            <div className="obs-badge-verified">
              ✓ Verifizierte Emergenz (gesehen in {signal.recurrence_count} Gesprächen)
            </div>
          ) : (
            <div className="obs-placeholder-tag">Beobachtung — noch nicht als gemessene Emergenz bestätigt</div>
          )}
          <div className="obs-item-meta" style={{ margin: '10px 0' }}>
            <span className="obs-pill" style={{ background: `${STATUS_ACCENT[signal.status] ?? '#3b6bf6'}1a`, color: STATUS_ACCENT[signal.status] ?? '#3b6bf6' }}>{signal.status}</span>
            {' · '}Ebene: {LEVEL_SECTIONS.find(l => l.key === signal.level)?.label ?? signal.level}
            {' · '}Konfidenz: {signal.confidence}
            {' · '}Verlauf: {EVOLUTION_ARROW[signal.evolution] ?? '?'} {signal.evolution}
            {signal.scope && <> · {signal.scope}</>}
            {' · '}{signal.created_at}
          </div>
          <div className="obs-signal-modal-observation">{signal.observation}</div>
          {signal.source_conversation_id && onOpenConversation && (
            <button
              className="panel-add-btn"
              style={{ marginTop: 16 }}
              onClick={() => { onOpenConversation(signal.source_conversation_id!); onClose() }}
            >
              Aus Gespräch öffnen ↗
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/// The most important Observatory module: Jarvis's own qualitative read of
/// what's emerging in the research dialogue, not a stats pipeline. A new
/// signal set is generated automatically after every Forschung exchange
/// (see backend/src/emergence.rs) — this page just lists what's accumulated.
/// Every card carries the experimental badge deliberately: this is model
/// interpretation, never presented as validated fact.
export function EmergenceMonitor({ onOpenConversation, focusSignalId, onFocusSignalHandled }: {
  onOpenConversation?: (conversationId: string) => void
  /// A specific signal to jump straight into, e.g. from SimulationCenter/Lab's
  /// "Signal: {pattern} ↗" chip — previously that chip just navigated here
  /// with no indication which signal was meant (confirmed dead end, see the
  /// plan). Independent of this page's own filters/pagination: the id is
  /// looked up directly via a wider fetch rather than requiring the signal to
  /// already be on the currently-loaded/filtered page.
  focusSignalId?: string | null
  onFocusSignalHandled?: () => void
} = {}) {
  // Which signal (if any) is currently expanded in the detail modal — see
  // SignalDetailModal above. Laura: "emergence signals need to pop and be
  // dynamic" — this is that interaction; the flat static card list itself
  // couldn't get more "alive" without either fabricating motion that means
  // nothing, or, as done here, actually giving each signal somewhere to go.
  const [expandedSignal, setExpandedSignal] = useState<Signal | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const { data: ccet } = useAdminFetch<CcetSummary>('/api/observatory/emergence/ccet', [refreshKey])
  const { data: influence } = useAdminFetch<{
    balance: { laura_to_jarvis_count: number; jarvis_to_laura_count: number; ratio: number | null }
    laura_to_jarvis: { count: number; terms: { term: string }[] }
    jarvis_to_laura: { adopted_terms: { count: number; terms: { term: string }[] }; correction_pressure: number }
  }>('/api/observatory/influence', [refreshKey])
  const { data: flagging } = useAdminFetch<{
    matrix: {
      laura_flags_jarvis: { modify: number; reject: number; total: number }
      jarvis_flags: { hallucination_mismatch: number; anomalies: number; total: number }
      total_flags: number
    }
    flag_resolution: { resolved: number; open: number; total: number; resolved_ratio: number }
  }>('/api/observatory/flagging', [refreshKey])
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
  // `?verified=true` — see backend/src/emergence.rs's `ListSignalsQuery.verified`.
  // A plain '' / 'true' string (not a bool) so it slots into the same
  // <select>-driven filter-bar pattern as the four filters above it, rather
  // than needing its own checkbox wiring.
  const [verifiedFilter, setVerifiedFilter] = useState('')

  const loadSignals = async (offset: number, append: boolean) => {
    if (append) setLoadingMore(true); else setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (levelFilter) params.set('level', levelFilter)
      if (statusFilter) params.set('status', statusFilter)
      if (confidenceFilter) params.set('confidence', confidenceFilter)
      if (evolutionFilter) params.set('evolution', evolutionFilter)
      if (verifiedFilter) params.set('verified', verifiedFilter)
      const res = await adminFetch(`/api/observatory/emergence/signals?${params}`, {})
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
  }, [refreshKey, levelFilter, statusFilter, confidenceFilter, evolutionFilter, verifiedFilter])

  // Jump-in from a related-signal chip elsewhere in the app. The signal is
  // real (the link only ever exists because some run's related_signal_ids
  // referenced it) but may not be on the currently loaded/filtered page, so
  // this looks it up directly with a wide, filter-independent fetch rather
  // than requiring "Weitere laden" to happen to reach it first.
  useEffect(() => {
    if (!focusSignalId) return
    let cancelled = false
    const already = signals.find(s => s.id === focusSignalId)
    if (already) {
      setExpandedSignal(already)
      onFocusSignalHandled?.()
      return
    }
    adminFetch(`/api/observatory/emergence/signals?limit=500`, {})
      .then(res => (res.ok ? res.json() : []))
      .then((page: Signal[]) => {
        if (cancelled) return
        const match = page.find(s => s.id === focusSignalId)
        if (match) setExpandedSignal(match)
      })
      .finally(() => { if (!cancelled) onFocusSignalHandled?.() })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignalId])

  const loadMore = () => loadSignals(signals.length, true)
  const resetFilters = () => {
    setLevelFilter(''); setStatusFilter(''); setConfidenceFilter(''); setEvolutionFilter(''); setVerifiedFilter('')
  }
  const filtersActive = Boolean(levelFilter || statusFilter || confidenceFilter || evolutionFilter || verifiedFilter)

  const requestAnalysis = async () => {
    // No specific conversation in context on this page — the automatic
    // per-turn trigger (chat.rs) is the primary mechanism; this button just
    // forces a fresh pass over the most recently active conversation,
    // without waiting for the next message to arrive.
    setAnalyzing(true)
    try {
      const convRes = await adminFetch(`/api/chat/conversations?kind=chat`, {})
      const conversations = convRes.ok ? await convRes.json() : []
      const latestId = conversations[0]?.id
      if (!latestId) return
      await adminFetch(`/api/observatory/emergence/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: latestId }),
      })
      setRefreshKey(k => k + 1)
    } finally {
      setAnalyzing(false)
    }
  }

  const activeFilterCount = [levelFilter, statusFilter, confidenceFilter, evolutionFilter, verifiedFilter].filter(Boolean).length

  // Previously all 5 filters + 2 action buttons + ExportButtons sat in one
  // flat, unwrapping flex row (then, one round of feedback later, two
  // clustered-but-still-always-visible rows) — "what the hell is this
  // filter? can there be ONE single filter with dropdowns please?" per
  // Laura's dad. Now it's ONE trigger (FilterPanel, see Hud.tsx) holding all
  // 5 dimensions in a popover, small enough to sit directly among the
  // action buttons in the normal one-line header actions row like every
  // other app — no more full-width wrapped toolbar override needed.
  useHeaderActions(
    <>
      <FilterPanel activeCount={activeFilterCount} onReset={resetFilters}>
        <label className="filter-panel-field">
          <span>Ebene</span>
          <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)}>
            <option value="">Alle Ebenen</option>
            {LEVEL_SECTIONS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <label className="filter-panel-field">
          <span>Status</span>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Alle Status</option>
            {Object.keys(STATUS_ACCENT).map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="filter-panel-field">
          <span>Konfidenz</span>
          <select value={confidenceFilter} onChange={e => setConfidenceFilter(e.target.value)}>
            <option value="">Alle Konfidenzen</option>
            {CONFIDENCE_LEVELS.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="filter-panel-field">
          <span>Verlauf</span>
          <select value={evolutionFilter} onChange={e => setEvolutionFilter(e.target.value)}>
            <option value="">Alle Verläufe</option>
            {Object.keys(EVOLUTION_ARROW).map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="filter-panel-field">
          <span>Signale</span>
          <select value={verifiedFilter} onChange={e => setVerifiedFilter(e.target.value)}>
            <option value="">Alle Signale</option>
            <option value="true">Nur verifiziert</option>
          </select>
        </label>
      </FilterPanel>
      <button className="panel-add-btn" onClick={requestAnalysis} disabled={analyzing}>
        {analyzing ? 'Analysiert…' : '⟳ Jetzt erneut analysieren'}
      </button>
      <button
        className="panel-add-btn"
        disabled={signals.length === 0}
        onClick={() => downloadJson(`emergence-signals-${new Date().toISOString().slice(0, 10)}.json`, signals)}
      >
        ⬇ JSON
      </button>
      <ExportButtons rows={signals.map(s => ({ ...s }))} filenameBase="emergence-signals" title="Emergence-Signale" />
    </>,
    [levelFilter, statusFilter, confidenceFilter, evolutionFilter, verifiedFilter, activeFilterCount, analyzing, signals],
  )

  if (loading && signals.length === 0) return <div className="obs-panel"><HudSkeleton variant="panel" /></div>
  if (error && signals.length === 0) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>

  // With a level filter active, only that one level was ever fetched from
  // the backend at all — showing the other 3 as zero/"empty" would
  // misleadingly read as "no signals of that level exist" rather than
  // "filtered out", so they're hidden entirely instead, both in the
  // "Übersicht" stat grid and in the detail sections below.
  const visibleSections = levelFilter ? LEVEL_SECTIONS.filter(s => s.key === levelFilter) : LEVEL_SECTIONS

  // Same honesty-about-scope reasoning as visibleSections above — with a
  // status filter active, only that ONE status was ever fetched from the
  // backend at all (see loadSignals' `params.set('status', ...)`), so a
  // status_mix donut showing the other 3 as literal zero would misleadingly
  // read as "no signals of that status exist" rather than "filtered out".
  const visibleStatuses = statusFilter ? [statusFilter] : Object.keys(STATUS_ACCENT)

  return (
    <div className="obs-panel">

      {/* Summary strip — aggregated view above the flat card feed below,
          so every signal doesn't read with equal visual weight anymore.
          Two parts: (1) per-level counts, same obs-stat/obs-grid primitives
          the rest of the Observatory already uses; (2) the three CCET
          metrics, derived views rather than validated cognitive-science
          (see the CcetSummary doc comment above) — additive only, the
          detail cards below are unchanged. Counts reflect the currently
          *loaded* signals, not necessarily the global total — see the
          "geladen" note below, honest about that now that this list is
          paginated instead of always holding everything up to the old cap. */}
      <div className="obs-section-label">
        Übersicht {total !== null && <span style={{ fontWeight: 400 }}>(geladen: {signals.length} von {total})</span>}
      </div>
      <HudGrid cols={4}>
        <HudTile title="Ebenen-Mix" badge="SIGNALE" accent="var(--obs-purple)" span={1}>
          <ObsDonut
            data={visibleSections.map(section => ({
              label: section.label,
              value: signals.filter(s => s.level === section.key).length,
              color: LEVEL_DONUT_COLORS[section.key],
            }))}
            centerLabel={`${signals.length}\nSignale`}
            gradientIdPrefix="emergence-level-mix"
          />
        </HudTile>
        <HudTile title="Status-Mix" badge="SIGNALE" accent="var(--obs-blue)" span={1}>
          <ObsDonut
            data={visibleStatuses.map(status => ({
              label: status,
              value: signals.filter(s => s.status === status).length,
              color: STATUS_ACCENT[status] ?? '#3b6bf6',
            }))}
            gradientIdPrefix="emergence-status-mix"
          />
        </HudTile>
        <HudTile title="Stabilität (CEI)" badge="CO-EVOLUTION" accent="var(--obs-green)" span={1}>
          {ccet ? (
            <ObsDonut
              data={[{ label: 'CEI', value: Math.round(ccet.cei * 1000), color: 'var(--obs-green)' }, { label: 'Rest', value: Math.max(0, 1000 - Math.round(ccet.cei * 1000)), color: 'rgba(255,255,255,0.08)' }]}
              centerLabel={`${formatPercent(ccet.cei)}\nCEI`}
              gradientIdPrefix="emergence-cei"
            />
          ) : (
            <div className="obs-stat c-green"><div className="obs-stat-value">—</div><div className="obs-stat-label">Stabilität (CEI)</div></div>
          )}
        </HudTile>
        <HudTile title="Rhythmus (Resonanz)" badge="CO-EVOLUTION" accent="var(--obs-teal)" span={1}>
          {ccet ? (
            <ObsDonut
              data={[{ label: 'Resonanz', value: Math.round(ccet.resonance_frequency * 1000), color: 'var(--obs-teal)' }, { label: 'Rest', value: Math.max(0, 1000 - Math.round(ccet.resonance_frequency * 1000)), color: 'rgba(255,255,255,0.08)' }]}
              centerLabel={`${formatPercent(ccet.resonance_frequency)}\nResonanz`}
              gradientIdPrefix="emergence-resonance"
            />
          ) : (
            <div className="obs-stat c-teal"><div className="obs-stat-value">—</div><div className="obs-stat-label">Rhythmus (Resonanz)</div></div>
          )}
        </HudTile>
      </HudGrid>

      <div className="obs-section-label">Geteiltes Feld — Dyad & Meta (META-Layer)</div>
      <HudGrid cols={4}>
        <HudTile title="Einfluss-Richtung" badge="TRAIT" accent="var(--obs-purple)" span={2}>
          {influence && (influence.balance.laura_to_jarvis_count > 0 || influence.balance.jarvis_to_laura_count > 0) ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <DirectionBar label="Laura → Jarvis" value={influence.balance.laura_to_jarvis_count} max={Math.max(influence.balance.laura_to_jarvis_count, influence.balance.jarvis_to_laura_count)} accent="var(--obs-purple)" />
              <DirectionBar label="Jarvis → Laura" value={influence.balance.jarvis_to_laura_count} max={Math.max(influence.balance.laura_to_jarvis_count, influence.balance.jarvis_to_laura_count)} accent="var(--obs-teal)" />
              {influence.balance.ratio != null && <p style={{ fontSize: 11, color: '#9aa0a8', margin: 0 }}>Verhältnis: {influence.balance.ratio.toFixed(2)}</p>}
            </div>
          ) : <div className="obs-empty">Noch keine gerichtete Einfluss-Beobachtung.</div>}
        </HudTile>

        <HudTile title="Laura flaggt Jarvis" badge="META" accent="var(--sem-warning, var(--obs-amber))" span={2}>
          {flagging && flagging.matrix.laura_flags_jarvis.total > 0 ? (
            <div style={{ display: 'flex', gap: 18 }}>
              <HudStat value={flagging.matrix.laura_flags_jarvis.modify} label="Modify" />
              <HudStat value={flagging.matrix.laura_flags_jarvis.reject} label="Reject" />
              <HudStat value={flagging.matrix.laura_flags_jarvis.total} label="Gesamt" />
            </div>
          ) : <div className="obs-empty">Noch kein Flag von Laura.</div>}
        </HudTile>

        <HudTile title="Jarvis flaggt" badge="META" accent="var(--sem-danger)" span={2}>
          {flagging && flagging.matrix.jarvis_flags.total > 0 ? (
            <div style={{ display: 'flex', gap: 18 }}>
              <HudStat value={flagging.matrix.jarvis_flags.hallucination_mismatch} label="Mismatch (Selbst)" />
              <HudStat value={flagging.matrix.jarvis_flags.anomalies} label="Anomalien" />
              <HudStat value={flagging.matrix.jarvis_flags.total} label="Gesamt" />
            </div>
          ) : <div className="obs-empty">Noch kein maschinelles Flag.</div>}
        </HudTile>

        <HudTile title="Flag-Auflösung" badge="META" accent="var(--sem-success)" span={2}>
          {flagging && flagging.flag_resolution.total > 0 ? (
            <div style={{ display: 'flex', gap: 18 }}>
              <HudStat value={flagging.flag_resolution.resolved} label="aufgelöst" />
              <HudStat value={flagging.flag_resolution.open} label="offen" />
              <HudStat value={flagging.flag_resolution.resolved_ratio * 100} label="Quote" format={v => `${Math.round(v)} %`} />
            </div>
          ) : <div className="obs-empty">Noch keine Flags.</div>}
        </HudTile>
      </HudGrid>

      <div className="obs-section-label">Signale <span style={{ opacity: .6, fontWeight: 400 }}>(max. 5 sichtbar, Rest scrollbar)</span></div>
      <div style={{ maxHeight: 540, overflowY: 'auto', paddingRight: 4 }}>
        {signals.length === 0 && !loading ? (
          <div className="obs-card">
            <div className="obs-empty">
              {filtersActive
                ? 'Keine Signale für diese Filterkombination.'
                : 'Noch keine Signale erkannt — sie entstehen automatisch nach jedem Forschungsgespräch.'}
              {!filtersActive && total !== null && total > 0 && ' (Filter aktiv?)'}
            </div>
          </div>
        ) : (
          visibleSections.map(section => {
            const levelSignals = signals.filter(s => s.level === section.key).slice(0, 5)
            if (levelSignals.length === 0) return null
            return (
              <div key={section.key} style={{ marginBottom: 8 }}>
                <div className="obs-section-label" style={{ fontSize: 11 }}>{section.label}</div>
                {levelSignals.map((s, i) => (
                  <div
                    className="obs-item-card obs-item-card-clickable"
                    key={s.id}
                    style={{ ...hudStagger(i), ['--obs-accent' as string]: STATUS_ACCENT[s.status] ?? '#3b6bf6' }}
                    onClick={() => setExpandedSignal(s)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedSignal(s) } }}
                  >
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
                            onClick={e => { e.stopPropagation(); onOpenConversation(s.source_conversation_id!) }}
                          >
                            aus Gespräch ↗
                          </button>
                        </>
                      )}
                    </div>
                    <div className="obs-item-body">
                      {previewText(s.observation)}
                      {s.observation.length > PREVIEW_CHARS && <span className="obs-item-more"> Details ansehen →</span>}
                    </div>
                  </div>
                ))}
              </div>
            )
          })
        )}
      </div>

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

      {expandedSignal && (
        <SignalDetailModal
          signal={expandedSignal}
          onClose={() => setExpandedSignal(null)}
          onOpenConversation={onOpenConversation}
        />
      )}
    </div>
  )
}
