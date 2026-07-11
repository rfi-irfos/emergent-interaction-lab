import { useAdminFetch } from '../../lib/adminApi'
import { ExportButtons } from './ExportButtons'

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

function AlertRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="obs-activity-row">
      <span className="obs-activity-kind" style={{ background: '#f59e0b' }}>Achtung</span>
      <span className="obs-activity-label">{label}</span>
      <span className="obs-activity-ts">{detail}</span>
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

/// The current state of each system under observation — one narrative per
/// scope, built from the latest emergence_signals row touching that scope.
/// Technical system health (formerly its own "System Diagnostics" nav item)
/// lives at the bottom: it's genuinely a system under observation too, just
/// the technical one — not a business/CMS concern, so it stays here rather
/// than moving to Verwaltung.
export function SystemState() {
  const { data: signals, loading: signalsLoading, error: signalsError } = useAdminFetch<Signal[]>('/api/observatory/emergence/signals')
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
            {emergingSignals.map(s => <AlertRow key={s.id} label={s.pattern} detail={s.scope ?? 'Allgemein'} />)}
            {diagAlerts.map((a, i) => <AlertRow key={`diag-${i}`} label={a.label} detail={a.detail} />)}
          </div>
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div className="obs-section-label" style={{ marginBottom: 0 }}>Beobachtete Systeme</div>
        {/* `states` (unlike the raw signal feed EmergenceMonitor exports) is
            this view's own real per-scope aggregation — latest signal plus
            observation count and the linked Interaction Dynamics trend for
            each scope — so it's a distinct, genuinely row-shaped dataset
            worth its own export rather than a duplicate of another module's. */}
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
            filenameBase="system-state"
            title="System State — Beobachtete Systeme"
          />
        )}
      </div>
      {signalsLoading && <div className="obs-empty">Lade…</div>}
      {signalsError && <div className="obs-card"><div className="obs-empty">Fehler beim Laden.</div></div>}
      {!signalsLoading && !signalsError && states.length === 0 && (
        <div className="obs-card"><div className="obs-empty">Noch kein Systemzustand erkannt — entsteht automatisch aus Forschungsgesprächen.</div></div>
      )}
      {states.map(([scope, s]) => {
        const trend = trendLine(trendByScope.get(scope))
        return (
          <div className="obs-item-card" key={scope}>
            <div className="obs-item-title">
              {scope}
              <span className="obs-pill" style={{ marginLeft: 8, background: 'rgba(59,107,246,.12)', color: 'var(--obs-blue, #3b6bf6)' }}>{countByScope.get(scope)} Beobachtungen</span>
            </div>
            <div className="obs-item-meta">Zustand: {s.status} · zuletzt aktualisiert {s.created_at}</div>
            <div className="obs-item-meta" style={{ marginTop: -6 }}>Konfidenz: {s.confidence} · Entwicklung: {s.evolution}</div>
            <div className="obs-item-body">{s.observation}</div>
            {trend && <div className="obs-item-meta" style={{ marginTop: 8 }}>📈 Interaction Dynamics: {trend}</div>}
          </div>
        )
      })}

      <div className="obs-section-label" style={{ marginTop: 26 }}>Technische Systemgesundheit</div>
      {diagLoading && <div className="obs-empty">Lade…</div>}
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
              ⚠ Kein CHAT_API_SECRET gesetzt — alle Admin-Endpunkte sind aktuell ohne Zugriffsschutz erreichbar (dev-Komfort, siehe backend/src/authz.rs).
            </div>
          )}
        </>
      )}
    </div>
  )
}
