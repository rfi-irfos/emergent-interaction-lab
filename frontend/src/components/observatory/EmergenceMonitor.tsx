import { useEffect, useState } from 'react'
import { adminFetch, useAdminFetch } from '../../lib/adminApi'
import { downloadJson } from '../../lib/export'
import { hudStagger } from '../../lib/hudStagger'
import { ExportButtons } from './ExportButtons'
import { HudSkeleton } from './HudSkeleton'
import { HudGrid, HudTile, HudSectionHeader } from './Hud'
import { ObsDonut } from './ObsDonut'
import { ObsGauge } from './ObsGauge'
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
export function EmergenceMonitor({ onOpenConversation }: { onOpenConversation?: (conversationId: string) => void } = {}) {
  // Which signal (if any) is currently expanded in the detail modal — see
  // SignalDetailModal above. Laura: "emergence signals need to pop and be
  // dynamic" — this is that interaction; the flat static card list itself
  // couldn't get more "alive" without either fabricating motion that means
  // nothing, or, as done here, actually giving each signal somewhere to go.
  const [expandedSignal, setExpandedSignal] = useState<Signal | null>(null)
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
      <HudSectionHeader
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
            {/* Exports whatever is currently loaded/filtered (`signals`), not
                silently the unfiltered full set — same honesty-about-scope
                principle as the X-Total-Count pagination above: if a level/
                status/confidence/evolution filter narrowed the page, the export
                reflects that narrowed page. */}
            <ExportButtons rows={signals.map(s => ({ ...s }))} filenameBase="emergence-signals" title="Emergence-Signale" />
          </div>
        }
      />

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
        {/* The "measured emergence" gate's own filter — same <select>
            convention as the four above (auto-themed via the existing
            .crm-body select dark-mode rule in App.css, no new CSS needed
            for the control itself). "Nur verifiziert" narrows to signals
            that actually cleared the Research page's own bar, not just
            this turn's LLM read — see the badge rendered per-card below. */}
        <select value={verifiedFilter} onChange={e => setVerifiedFilter(e.target.value)} style={{ flex: '1 1 140px' }}>
          <option value="">Alle Signale</option>
          <option value="true">Nur verifiziert</option>
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
          metrics, derived views rather than validated cognitive-science
          (see the CcetSummary doc comment above) — additive only, the
          detail cards below are unchanged. Counts reflect the currently
          *loaded* signals, not necessarily the global total — see the
          "geladen" note below, honest about that now that this list is
          paginated instead of always holding everything up to the old cap. */}
      <div className="obs-section-label">
        {/* Two donuts replace the old flat per-level stat-tile row — framed in
            fixed-size HUD tiles so they read as instruments, not one chart
            stretched across the viewport. Each tile sizes itself; the grid
            keeps several per row on desktop, stacking only when narrow. */}
        Übersicht {total !== null && <span style={{ fontWeight: 400 }}>(geladen: {signals.length} von {total})</span>}
      </div>
      <HudGrid cols={4}>
        <HudTile title="Ebenen-Mix" badge="SIGNALE" accent="var(--obs-purple)" span={2}>
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
        <HudTile title="Status-Mix" badge="SIGNALE" accent="var(--obs-blue)" span={2}>
          <ObsDonut
            data={visibleStatuses.map(status => ({
              label: status,
              value: signals.filter(s => s.status === status).length,
              color: STATUS_ACCENT[status] ?? '#3b6bf6',
            }))}
            gradientIdPrefix="emergence-status-mix"
          />
        </HudTile>
      </HudGrid>
      <p style={{ fontSize: 11, color: 'var(--gotham-text-dim, #9aa0a8)', marginTop: -4, marginBottom: 14 }}>
        Ebenen- und Status-Verteilung der aktuell geladenen Signale (siehe "geladen" oben) — kein serverseitiges Gesamt-Grouping.
      </p>

      <div
        className="obs-badge-experimental"
        title={ccet ? `${ccet.definitions_note} Basis: die letzten ${ccet.turns_considered} analysierten Turns, Stabilitätsschwelle (Kosinus-Ähnlichkeit) ${formatPercent(ccet.stability_threshold)}.` : undefined}
      >
        Eigene Operationalisierung — nicht wörtlich aus Lauras Paper
      </div>
      {/* CEI and Resonance Frequency are real 0-1 fractions — gauges. CEP is
          a plain point count, not a fraction, so it stays a plain .obs-stat
          tile rather than being forced into a gauge it doesn't fit; sitting
          right beside the two gauges is also the literal demonstration that
          ObsGauge slots in next to plain stat tiles without looking like a
          different component family. */}
      <HudGrid cols={4}>
        <HudTile title="CEI" badge="CO-EVOLUTION" accent="var(--obs-green)" span={1}>
          {ccet ? (
            <ObsGauge value={ccet.cei} label="Co-Evolution Index" color="var(--obs-green)" />
          ) : (
            <div className="obs-stat c-green"><div className="obs-stat-value">—</div><div className="obs-stat-label">CEI (Co-Evolution Index)</div></div>
          )}
        </HudTile>
        <HudTile title="Resonance" badge="CO-EVOLUTION" accent="var(--obs-teal)" span={1}>
          {ccet ? (
            <ObsGauge value={ccet.resonance_frequency} label="Resonance Frequency" color="var(--obs-teal)" />
          ) : (
            <div className="obs-stat c-teal"><div className="obs-stat-value">—</div><div className="obs-stat-label">Resonance Frequency</div></div>
          )}
        </HudTile>
        <HudTile title="CEP" badge="CO-EVOLUTION" accent="var(--obs-purple)" span={2}>
          <div className="obs-stat c-purple" style={{ flex: '0 1 160px' }}>
            <div className="obs-stat-value">{ccet ? ccet.cep : '—'}</div>
            <div className="obs-stat-label">CEP (Co-Evolution Points)</div>
          </div>
        </HudTile>
      </HudGrid>

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
              levelSignals.map((s, i) => (
                <div
                  className="obs-item-card obs-item-card-clickable"
                  key={s.id}
                  style={{ ...hudStagger(i), ['--obs-accent' as string]: STATUS_ACCENT[s.status] ?? '#3b6bf6' }}
                  onClick={() => setExpandedSignal(s)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedSignal(s) } }}
                >
                  {/* The "measured emergence" gate's own verdict, per-card —
                      mirrors the Research page's own "gemessene Emergenz"
                      vs. "Beobachtung" vocabulary exactly (content.json,
                      page id `research`, "Wann gilt Emergenz als
                      gemessen?"): a signal only reads as measured emergence
                      once it has actually recurred across ≥3 distinct
                      conversations with real CCET data behind it (see
                      emergence.rs's verify_recurrence) — every other signal
                      is honestly still just an observation, exactly as the
                      site's own methodology page has always defined the
                      line, now finally enforced instead of asserted. */}
                  {s.verified_emergence ? (
                    <div className="obs-badge-verified">
                      ✓ Verifizierte Emergenz (gesehen in {s.recurrence_count} Gesprächen)
                    </div>
                  ) : (
                    <div className="obs-placeholder-tag">Beobachtung — noch nicht als gemessene Emergenz bestätigt</div>
                  )}
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
