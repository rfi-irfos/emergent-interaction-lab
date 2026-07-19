import { useEffect, useState } from 'react'
import { useAdminFetch } from '../../lib/adminApi'
import { hudStagger } from '../../lib/hudStagger'
import { HudSkeleton } from './HudSkeleton'
import { HudSectionHeader } from './Hud'
import { ExportButtons } from './ExportButtons'
import { STATUS_ACCENT } from './registry'

const RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: '7d', label: 'Letzte 7 Tage' },
  { value: '30d', label: 'Letzte 30 Tage' },
  { value: 'all', label: 'Alle' },
]

interface Signal {
  id: string
  pattern: string
  status: string
  confidence: string
  evolution: string
  observation: string
  scope: string | null
  created_at: string
}

function AlertRow({ signal, onOpen }: { signal: Signal; onOpen: (s: Signal) => void }) {
  const accent = STATUS_ACCENT[signal.status] ?? '#f59e0b'
  return (
    <div
      className="obs-activity-row obs-item-card-clickable"
      style={{ ['--obs-accent' as string]: accent, cursor: 'pointer' }}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(signal)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(signal) } }}
    >
      <span className="obs-activity-kind" style={{ background: accent }}>Achtung</span>
      <span className="obs-activity-label">{signal.pattern}</span>
      <span className="obs-activity-ts">{signal.scope ?? 'Allgemein'}</span>
    </div>
  )
}

interface DiagnosticsData {
  db_reachable: boolean
  nvidia_api_key_configured: boolean
  chat_secret_configured: boolean
  agent_tool_calls_7d: number
  agent_tool_call_errors_7d: number
}

interface ScopeTrend {
  scope: string
  conversation_count: number
  messages_7d: number
  messages_prev_7d: number
}

// Real Interaction Dynamics figure, cited inline instead of the two modules
// staying disconnected: the message-volume trend of the specific
// conversations this scope's signals actually came from.
function trendLine(t: ScopeTrend | undefined): string | null {
  if (!t || t.messages_7d === 0) return null
  if (t.messages_prev_7d === 0) return `${t.messages_7d} Nachrichten in den letzten 7 Tagen in ${t.conversation_count} beteiligten Gespräch(en) - neu diese Woche.`
  const pct = Math.round(((t.messages_7d - t.messages_prev_7d) / t.messages_prev_7d) * 100)
  const direction = pct > 0 ? `+${pct}%` : `${pct}%`
  return `${t.messages_7d} Nachrichten in den letzten 7 Tagen in ${t.conversation_count} beteiligten Gespräch(en) (${direction} ggü. Vorwoche).`
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="obs-activity-row">
      <span className="obs-activity-label">{label}</span>
      <span className={`obs-status-pill ${ok ? 'ok' : 'bad'}`}>{ok ? 'OK' : 'Fehlt'}</span>
    </div>
  )
}

// Click-to-expand detail view for one observed system (scope). Reuses the
// same `.pem-overlay`/`.pem` modal shell as EmergenceMonitor's signal modal
// — dark-HUD themed via ancestor cascade, Esc + click-outside to close.
function SystemStateModal({ scope, signal, count, trend, onClose }: {
  scope: string
  signal: Signal
  count: number
  trend: string | null
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="pem-overlay" onClick={onClose}>
      <div
        className="pem obs-signal-modal"
        onClick={e => e.stopPropagation()}
        style={{ ['--obs-accent' as string]: STATUS_ACCENT[signal.status] ?? '#3b6bf6' }}
      >
        <div className="pem-header">
          <span className="pem-title">{scope}</span>
          <button className="pem-close" onClick={onClose} title="Schließen (Esc)">✕</button>
        </div>
        <div className="pem-body obs-signal-modal-body">
          <div className="obs-item-meta" style={{ margin: '4px 0 12px' }}>
            <span className="obs-pill" style={{ background: `${STATUS_ACCENT[signal.status] ?? '#3b6bf6'}1a`, color: STATUS_ACCENT[signal.status] ?? '#3b6bf6' }}>{signal.status}</span>
            {' · '}Konfidenz: {signal.confidence}
            {' · '}Entwicklung: {signal.evolution}
            {' · '}{count} Beobachtungen in diesem Bereich
          </div>
          {trend && (
            <div className="obs-badge-verified" style={{ marginBottom: 12 }}>
              ↗ {trend}
            </div>
          )}
          <div className="obs-signal-modal-observation">{signal.observation}</div>
          <div className="obs-item-meta" style={{ marginTop: 14, opacity: 0.7 }}>
            Zuletzt aktualisiert: {signal.created_at}
          </div>
        </div>
      </div>
    </div>
  )
}

/// The current state of each system under observation — one narrative per
/// scope, built from the latest emergence_signals row touching that scope.
/// Technical system health (formerly its own "System Diagnostics" nav item)
/// lives at the bottom: it's genuinely a system under observation too, just
/// the technical one — not a business/CMS concern, so it stays here rather
/// than moving to Verwaltung.
///
/// `?range=7d|30d|all` narrows the underlying `/emergence/signals` fetch
/// that `states` below is built from (see backend/src/emergence.rs's
/// `list_signals` — reuses observatory.rs's `resolve_range` verbatim, same
/// convention as Behavioral Landscape's own range selector). Defaults to
/// "all" rather than Behavioral Landscape's "30d": unlike that view, this
/// fetch previously had no date restriction at all (just the newest-50
/// cap), so "all" is the default that doesn't regress the view for anyone
/// already relying on it.
export function SystemState() {
  const [range, setRange] = useState('all')
  const [expandedSignal, setExpandedSignal] = useState<Signal | null>(null)
  const { data: signals, loading: signalsLoading, error: signalsError } = useAdminFetch<Signal[]>(`/api/observatory/emergence/signals?range=${range}`, [range])
  const { data: diag, loading: diagLoading, error: diagError } = useAdminFetch<DiagnosticsData>('/api/observatory/diagnostics')
  const { data: scopeTrends } = useAdminFetch<ScopeTrend[]>('/api/observatory/scope-trends')
  const trendByScope = new Map((scopeTrends ?? []).map(t => [t.scope, t]))

  const byScope = new Map<string, Signal>()
  const countByScope = new Map<string, number>()
  ;(signals ?? []).forEach(s => {
    const key = s.scope ?? 'Allgemein'
    const existing = byScope.get(key)
    if (!existing || s.created_at > existing.created_at) byScope.set(key, s)
    countByScope.set(key, (countByScope.get(key) ?? 0) + 1)
  })
  const states = Array.from(byScope.entries())

  // Real "erhöhte Aufmerksamkeit" list — status='emerging' signals plus
  // existing diagnostics failure flags. Not "anomaly detection" (no
  // baseline exists to detect an anomaly against), just a surfaced view of
  // data that's already real elsewhere on this page.
  const emergingSignals = (signals ?? []).filter(s => s.status === 'emerging')
  const diagAlerts: { label: string; detail: string }[] = []
  if (diag) {
    if (!diag.db_reachable) diagAlerts.push({ label: 'Datenbank nicht erreichbar', detail: 'technisch' })
    if (!diag.nvidia_api_key_configured) diagAlerts.push({ label: 'NVIDIA_API_KEY fehlt', detail: 'technisch' })
    if (diag.agent_tool_call_errors_7d > 0) diagAlerts.push({ label: `${diag.agent_tool_call_errors_7d} Jarvis-Fehler in 7 Tagen`, detail: 'technisch' })
  }
  const hasAlerts = emergingSignals.length > 0 || diagAlerts.length > 0

  return (
    <div className="obs-panel">
      {hasAlerts && (
        <>
          <div className="obs-section-label">Signale mit erhöhter Aufmerksamkeit</div>
          <div className="obs-card" style={{ marginBottom: 22 }}>
            {emergingSignals.map(s => <AlertRow key={s.id} signal={s} onOpen={setExpandedSignal} />)}
            {diagAlerts.map((a, i) => <AlertRow key={`diag-${i}`} signal={{ id: `diag-${i}`, pattern: a.label, status: 'emerging', confidence: '—', evolution: '—', observation: a.label, scope: a.detail, created_at: '—' }} onOpen={setExpandedSignal} />)}
          </div>
        </>
      )}

      <HudSectionHeader
        title="Beobachtete Systeme"
        sub="Ein Kartenstapel pro Themenbereich deiner Forschung, mit dem jeweils aktuellsten Stand."
        actions={
          <>
            <select value={range} onChange={e => setRange(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
              {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {states.length > 0 && (
              <ExportButtons
                rows={states.map(([scope, s]) => ({
                  scope,
                  status: s.status,
                  confidence: s.confidence,
                  evolution: s.evolution,
                  observation: s.observation,
                  observation_count: countByScope.get(scope) ?? 0,
                  interaction_trend: trendLine(trendByScope.get(scope)) ?? '',
                  updated_at: s.created_at,
                }))}
                filenameBase={`system-state-${range}`}
                title="System State — Beobachtete Systeme"
              />
            )}
          </>
        }
      />
      {signalsLoading && <HudSkeleton variant="list" rows={2} />}
      {signalsError && <div className="obs-card"><div className="obs-empty">Fehler beim Laden.</div></div>}
      {!signalsLoading && !signalsError && states.length === 0 && (
        <div className="obs-card"><div className="obs-empty">Noch kein Systemzustand erkannt — entsteht automatisch aus Forschungsgesprächen.</div></div>
      )}
      {states.map(([scope, s], i) => {
        const trend = trendLine(trendByScope.get(scope))
        return (
          <div
            className="obs-item-card obs-item-card-clickable"
            key={scope}
            style={{ ...hudStagger(i), ['--obs-accent' as string]: STATUS_ACCENT[s.status] ?? 'var(--hud-cyan)' }}
            role="button"
            tabIndex={0}
            onClick={() => setExpandedSignal(s)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedSignal(s) } }}
          >
            <div className="obs-item-title">
              {scope}
              <span className="obs-pill" style={{ marginLeft: 8, background: 'rgba(59,107,246,.12)', color: 'var(--obs-blue, #3b6bf6)' }}>{countByScope.get(scope)} Beobachtungen</span>
              <span className="obs-item-more">Details ansehen →</span>
            </div>
            <div className="obs-item-meta">Zustand: {s.status} · zuletzt aktualisiert {s.created_at}</div>
            <div className="obs-item-meta" style={{ marginTop: -6 }}>Konfidenz: {s.confidence} · Entwicklung: {s.evolution}</div>
            <div className="obs-item-body">{s.observation}</div>
            {trend && <div className="obs-item-meta" style={{ marginTop: 8 }}>↗ Interaction Dynamics: {trend}</div>}
          </div>
        )
      })}
      {expandedSignal && (
        <SystemStateModal
          scope={expandedSignal.scope ?? 'Allgemein'}
          signal={expandedSignal}
          count={countByScope.get(expandedSignal.scope ?? 'Allgemein') ?? 0}
          trend={trendLine(trendByScope.get(expandedSignal.scope ?? 'Allgemein'))}
          onClose={() => setExpandedSignal(null)}
        />
      )}

      {/* Deliberately visually demoted from here down — same principle
          chat::SYSTEM_PROMPT itself is instructed to follow ("präsentiere
          niemals eine technische Zahl mit demselben Gewicht wie eine echte
          Forschungsbeobachtung"), now applied to this page's own layout, not
          just Jarvis's prose. Previously this technical block sat at equal
          visual weight (same .obs-section-label, same .obs-card) directly
          below the research narrative above — reads as one continuous list
          of "systems," server health and research findings undistinguished.
          `.obs-tech-section` (see App.css) mutes it: smaller label, no
          divider rule, a plain sentence instead of an obs-card wrapper. */}
      <div className="obs-tech-section">
        <div className="obs-tech-label">Technische Systemgesundheit</div>
        <p className="obs-section-sub">Das betrifft die Plattform selbst — Server, Datenbank, API-Zugänge — nicht deine Forschung.</p>
        {diagLoading && <HudSkeleton variant="stats" rows={2} />}
        {diagError && <div className="obs-empty">Fehler beim Laden.</div>}
        {diag && (
          <>
            <div className="obs-card" style={{ marginBottom: 16 }}>
              <StatusRow label="Datenbank erreichbar" ok={diag.db_reachable} />
              <StatusRow label="NVIDIA_API_KEY konfiguriert" ok={diag.nvidia_api_key_configured} />
              <StatusRow label="CHAT_API_SECRET konfiguriert" ok={diag.chat_secret_configured} />
            </div>
            <div className="obs-grid">
              <div className="obs-stat c-purple"><div className="obs-stat-value">{diag.agent_tool_calls_7d}</div><div className="obs-stat-label">Jarvis-Aufrufe (7 T.)</div></div>
              <div className={`obs-stat ${diag.agent_tool_call_errors_7d > 0 ? 'c-red' : 'c-green'}`}><div className="obs-stat-value">{diag.agent_tool_call_errors_7d}</div><div className="obs-stat-label">Fehler (7 T.)</div></div>
            </div>
            {!diag.chat_secret_configured && (
              <div className="obs-warning-note">
                ▲ Kein CHAT_API_SECRET gesetzt — alle Admin-Endpunkte sind aktuell ohne Zugriffsschutz erreichbar (dev-Komfort, siehe backend/src/authz.rs).
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
