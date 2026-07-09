import { useAdminFetch } from '../../lib/adminApi'

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

interface DiagnosticsData {
  db_reachable: boolean
  nvidia_api_key_configured: boolean
  chat_secret_configured: boolean
  agent_tool_calls_7d: number
  agent_tool_call_errors_7d: number
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
  const { data: signals, loading: signalsLoading } = useAdminFetch<Signal[]>('/api/observatory/emergence/signals')
  const { data: diag, loading: diagLoading } = useAdminFetch<DiagnosticsData>('/api/observatory/diagnostics')

  const byScope = new Map<string, Signal>()
  ;(signals ?? []).forEach(s => {
    const key = s.scope ?? 'Allgemein'
    const existing = byScope.get(key)
    if (!existing || s.created_at > existing.created_at) byScope.set(key, s)
  })
  const states = Array.from(byScope.entries())

  return (
    <div className="obs-panel">
      <div className="obs-section-label">Beobachtete Systeme</div>
      {signalsLoading && <div className="obs-empty">Lade…</div>}
      {!signalsLoading && states.length === 0 && (
        <div className="obs-card"><div className="obs-empty">Noch kein Systemzustand erkannt — entsteht automatisch aus Forschungsgesprächen.</div></div>
      )}
      {states.map(([scope, s]) => (
        <div className="obs-item-card" key={scope}>
          <div className="obs-item-title">{scope}</div>
          <div className="obs-item-meta">Zustand: {s.status} · zuletzt aktualisiert {s.created_at}</div>
          <div className="obs-item-body">{s.observation}</div>
        </div>
      ))}

      <div className="obs-section-label" style={{ marginTop: 26 }}>Technische Systemgesundheit</div>
      {diagLoading && <div className="obs-empty">Lade…</div>}
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
