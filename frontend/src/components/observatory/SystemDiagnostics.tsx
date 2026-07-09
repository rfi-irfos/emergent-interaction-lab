import { useAdminFetch } from '../../lib/adminApi'

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
      <span style={{ fontWeight: 700, color: ok ? '#38A169' : '#e53e3e' }}>{ok ? 'OK' : 'Fehlt'}</span>
    </div>
  )
}

export function SystemDiagnostics() {
  const { data, loading } = useAdminFetch<DiagnosticsData>('/api/observatory/diagnostics')

  if (loading) return <div className="obs-panel"><div className="obs-empty">Lade…</div></div>
  if (!data) return <div className="obs-panel"><div className="obs-empty">Keine Daten verfügbar.</div></div>

  const errorRate = data.agent_tool_calls_7d > 0 ? Math.round((data.agent_tool_call_errors_7d / data.agent_tool_calls_7d) * 100) : 0

  return (
    <div className="obs-panel">
      <div className="obs-section">
        <div className="obs-section-label">Systemstatus</div>
        <StatusRow label="Datenbank erreichbar" ok={data.db_reachable} />
        <StatusRow label="NVIDIA_API_KEY konfiguriert" ok={data.nvidia_api_key_configured} />
        <StatusRow label="CHAT_API_SECRET konfiguriert" ok={data.chat_secret_configured} />
      </div>
      <div className="obs-grid">
        <div className="obs-stat"><div className="obs-stat-value">{data.agent_tool_calls_7d}</div><div className="obs-stat-label">Jarvis-Aufrufe (7 T.)</div></div>
        <div className="obs-stat"><div className="obs-stat-value">{errorRate}%</div><div className="obs-stat-label">Fehlerrate</div></div>
      </div>
      {!data.chat_secret_configured && (
        <p style={{ fontSize: 12, color: '#a9660a', lineHeight: 1.6 }}>
          Kein CHAT_API_SECRET gesetzt — alle Admin-Endpunkte sind aktuell ohne Zugriffsschutz erreichbar (dev-Komfort, siehe backend/src/authz.rs).
        </p>
      )}
    </div>
  )
}
