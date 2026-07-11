import { useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders, useAdminFetch } from '../../lib/adminApi'
import { groupByDate, parseServerTimestamp } from '../../lib/dateGroups'
import { ExportButtons } from './ExportButtons'
import { HudSkeleton } from './HudSkeleton'

export interface ContactMessage {
  id: string
  name: string
  email: string
  phone: string
  message: string
  status: string
  created_at: string
}

const STATUS_LABEL: Record<string, string> = { new: 'Neu', replied: 'Beantwortet', done: 'Erledigt' }
const STATUS_COLOR: Record<string, string> = { new: '#ef4444', replied: '#f59e0b', done: '#10b981' }

function InboxPlaceholder({ icon, text, sub }: { icon: string; text: string; sub?: string }) {
  return (
    <div style={{ minHeight: 'calc(100vh - 220px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center', padding: '24px' }}>
      <div style={{
        width: 46, height: 46, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, border: '1px solid var(--panel-border, #e8e8e8)', background: 'var(--panel-surface, #f8f8f8)', color: 'var(--hud-cyan, #0099CC)',
      }}>
        {icon}
      </div>
      <div style={{ color: 'var(--panel-text, #444)', fontSize: 13.5, fontWeight: 600 }}>{text}</div>
      {sub && <div style={{ color: 'var(--panel-text-dim, #aaa)', fontSize: 12, maxWidth: 280, lineHeight: 1.5 }}>{sub}</div>}
    </div>
  )
}

/// Real backend-persisted contact inbox (see backend/src/contact.rs) —
/// replaces the old localStorage-only version, which was written in the
/// VISITOR's browser on form submit and read in the ADMIN's browser: since
/// localStorage never syncs across devices, a real visitor's submission on
/// their own machine could never appear here. `status` (new/replied/done)
/// backs the same Antworten/Erledigt UX the old version had, except
/// Erledigt now sets status='done' instead of a hard, permanent, no-undo
/// delete — "Wieder öffnen" is the undo.
///
/// Grouped by date with the same helper the Forschung conversation sidebar
/// uses (lib/dateGroups.ts) — a real backend means this list will actually
/// receive messages now, so it gets the same "unfilterable flat list at
/// scale" fix pre-emptively.
export function Inbox() {
  const [refreshKey, setRefreshKey] = useState(0)
  // 15s poll: a visitor can submit at any time, nobody should have to
  // navigate away and back to see a new inquiry land (same idiom as
  // ResearchNotesPanel's Jarvis-writes-mid-session poll).
  const { data, loading, error } = useAdminFetch<ContactMessage[]>('/api/contact/messages', [refreshKey], 15000)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  // Client-side, matching BlogDrafts/ResearchNotesPanel — contact.rs's
  // list_messages takes no query params, and inbox volume is small enough
  // that fetching everything and filtering here (before grouping by date)
  // is simpler than adding backend support for it.
  const [statusFilter, setStatusFilter] = useState('')
  const list = data ?? []
  const filteredList = statusFilter ? list.filter(m => m.status === statusFilter) : list
  const groups = groupByDate(filteredList, m => m.created_at)

  const setStatus = async (id: string, status: string) => {
    setUpdatingId(id)
    try {
      await fetch(`${API_BASE}/api/contact/messages/${id}`, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ status }),
      })
      setRefreshKey(k => k + 1)
    } finally {
      setUpdatingId(null)
    }
  }

  // A tall, mostly-empty crm-body (flex: 1, spans the full viewport) left a
  // one-line message floating near the top with a huge dead dark area below
  // it whenever there was nothing to show — loading, error, and truly-empty
  // all read as "did this break?" rather than "this is what Inbox looks like
  // with nothing in it yet." All three now render the same full-height,
  // centered placeholder shell instead, so the view is fully designed
  // before a single message ever arrives, not just once one does.
  if (loading && !data) {
    return <div style={{ padding: 14 }}><HudSkeleton variant="list" /></div>
  }
  if (error) {
    return <InboxPlaceholder icon="!" text="Konnte nicht geladen werden." />
  }

  return (
    <div style={{ padding: 14 }}>
      {list.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ flex: '0 1 180px' }}>
            <option value="">Alle Status</option>
            {Object.keys(STATUS_LABEL).map(v => <option key={v} value={v}>{STATUS_LABEL[v]}</option>)}
          </select>
          {/* Exports whatever status filter currently narrowed the inbox to
              (`filteredList`), not silently every message. */}
          <ExportButtons
            rows={filteredList.map(m => ({ ...m }))}
            filenameBase="inbox-messages"
            title="Inbox"
          />
        </div>
      )}
      {list.length === 0 ? (
        <InboxPlaceholder icon="✉" text="Keine neuen Anfragen." sub="Anfragen aus dem Kontaktformular der Website erscheinen hier automatisch." />
      ) : filteredList.length === 0 ? (
        <InboxPlaceholder icon="⚲" text="Keine Treffer." sub="Kein Eintrag mit diesem Status." />
      ) : (
        groups.map(group => (
          <div key={group.label} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--panel-text-dim, #999)', margin: '0 0 8px 2px' }}>
              {group.label}
            </div>
            {group.items.map(item => (
              <div key={item.id} style={{ background: 'var(--panel-surface, #f8f8f8)', borderRadius: 10, padding: 14, marginBottom: 12, border: '1px solid var(--panel-border, #e8e8e8)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{item.name}</div>
                    <a href={`mailto:${item.email}`} style={{ fontSize: 12, color: 'var(--hud-cyan, #0099CC)' }}>{item.email}</a>
                    {item.phone && <div style={{ fontSize: 12, color: 'var(--panel-text-dim, #666)' }}>{item.phone}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: `${STATUS_COLOR[item.status] ?? '#999'}1a`, color: STATUS_COLOR[item.status] ?? '#999' }}>
                      {STATUS_LABEL[item.status] ?? item.status}
                    </span>
                    <div style={{ fontSize: 10, color: 'var(--panel-text-dim, #aaa)', whiteSpace: 'nowrap' }}>
                      {parseServerTimestamp(item.created_at).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
                {item.message && <p style={{ fontSize: 12, margin: '8px 0 10px', color: 'var(--panel-text, #444)', lineHeight: 1.5 }}>{item.message}</p>}
                <div style={{ display: 'flex', gap: 8 }}>
                  {item.status === 'done' ? (
                    <button
                      className="panel-add-btn"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                      disabled={updatingId === item.id}
                      onClick={() => setStatus(item.id, 'new')}
                    >
                      Wieder öffnen
                    </button>
                  ) : (
                    <>
                      <a
                        href={`mailto:${item.email}?subject=Re: Ihre Anfrage`}
                        className="panel-add-btn"
                        style={{ fontSize: 11, padding: '4px 10px', textDecoration: 'none' }}
                        onClick={() => { if (item.status === 'new') setStatus(item.id, 'replied') }}
                      >
                        Antworten
                      </a>
                      <button
                        className="panel-delete-btn"
                        style={{ fontSize: 11, padding: '4px 10px' }}
                        disabled={updatingId === item.id}
                        onClick={() => setStatus(item.id, 'done')}
                      >
                        Erledigt
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  )
}
