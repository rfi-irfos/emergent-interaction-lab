import { useState } from 'react'
import { useAdminFetch } from '../lib/adminApi'

// One row per hash-chained entry in backend/src/auditlog.rs's audit_log
// table — see that module's own doc comment for the full "ported from
// Lighthouse, right-sized for single-machine SQLite" disclosure. `meta` is
// a free-form JSON blob (order ids, deleted-resource ids, anomaly kind,
// ...), deliberately excluded from the hash itself — see
// auditlog::record's doc comment for why.
interface AuditLogEntry {
  id: string
  actor: string
  event_type: string
  summary: string
  meta: Record<string, unknown> | null
  created_at: string
}

interface VerifyResult {
  ok: boolean
  chain_intact: boolean
  broken_at_id: string | null
  total: number
}

// Same "sidebar badge" poll cadence as AdminPanel.tsx's own inboxBadgeData
// fetch — this panel is the same kind of always-present sidebar widget, not
// a full Observatory module tab a human navigates to and stays on.
const PANEL_POLL_MS = 20000
const FEED_LIMIT = 8

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

/// Fixed panel pinned to the bottom of .crm-sidebar, BELOW the scrollable
/// .crm-nav — rendered as a separate flex sibling in AdminPanel.tsx (not
/// appended inside <nav className="crm-nav">), so it never scrolls away
/// with the nav list the way the nav itself now does (see App.css's
/// ".crm-nav { ... min-height: 0 ... }" comment for why that fix was
/// needed and why this new panel must NOT repeat the mistake it fixed).
///
/// Shows the most recent entries from GET /api/observatory/audit/log as a
/// compact live feed, click-to-expand full `meta` (reusing the existing
/// `.mycelium-detail` click-to-expand treatment rather than inventing new
/// styling), plus a chain-intact indicator sourced from
/// GET /api/observatory/audit/verify.
export function AuditChangelog({ collapsed }: { collapsed: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { data: entries } = useAdminFetch<AuditLogEntry[]>(`/api/observatory/audit/log?limit=${FEED_LIMIT}`, [], PANEL_POLL_MS)
  const { data: verify } = useAdminFetch<VerifyResult>('/api/observatory/audit/verify', [], PANEL_POLL_MS)
  const items = entries ?? []

  if (collapsed) {
    // Narrow icon-only rail (60px, see .crm-sidebar.collapsed) has no room
    // for the feed itself — just the chain-intact dot survives collapse, a
    // glance-able "is the log still healthy" signal without expanding the
    // sidebar back out.
    return (
      <div className="crm-audit-panel crm-audit-panel-collapsed" title={
        verify ? (verify.chain_intact ? `Kette intakt über ${verify.total} Einträge` : `Kette gebrochen bei Eintrag ${verify.broken_at_id}`) : 'Änderungsprotokoll'
      }>
        <span className={`crm-audit-chain-dot ${verify ? (verify.chain_intact ? 'intact' : 'broken') : ''}`} />
      </div>
    )
  }

  return (
    <div className="crm-audit-panel">
      <div className="crm-audit-panel-header">
        <span className="crm-audit-panel-title">Änderungsprotokoll</span>
        {verify && (
          <span
            className={`crm-audit-chain-badge ${verify.chain_intact ? 'intact' : 'broken'}`}
            title={verify.chain_intact ? `Kette intakt über ${verify.total} Einträge` : `Kette gebrochen bei Eintrag ${verify.broken_at_id}`}
          >
            {verify.chain_intact ? 'Kette intakt ✓' : 'Kette gebrochen ▲'}
          </span>
        )}
      </div>
      <div className="crm-audit-panel-feed">
        {items.length === 0 && <div className="crm-audit-panel-empty">Noch keine Einträge</div>}
        {items.map(entry => (
          <div
            key={entry.id}
            className="crm-audit-entry"
            onClick={() => setExpandedId(id => (id === entry.id ? null : entry.id))}
          >
            <div className="crm-audit-entry-row">
              <span className="crm-audit-entry-type">{entry.event_type}</span>
              <span className="crm-audit-entry-time">{formatTime(entry.created_at)}</span>
            </div>
            <div className="crm-audit-entry-summary">{entry.summary}</div>
            <div className="crm-audit-entry-actor">{entry.actor}</div>
            {expandedId === entry.id && (
              <div className="mycelium-detail">
                <div className="mycelium-detail-tag">META</div>
                <div className="mycelium-detail-text">
                  <pre style={{ margin: 0, fontFamily: 'inherit', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {entry.meta ? JSON.stringify(entry.meta, null, 2) : '– kein Metadaten-Objekt –'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
