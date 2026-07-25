import { useEffect, useState } from 'react'
import { adminFetch, useAdminFetch } from '../../lib/adminApi'
import { groupByDate, parseServerTimestamp } from '../../lib/dateGroups'
import { ExportButtons } from './ExportButtons'
import { HudSkeleton } from './HudSkeleton'
import { useHeaderActions } from './Hud'

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
// Routed through the shared semantic tokens (App.css :root) instead of
// hardcoded hex — the mapping itself was already the right one (new =
// needs attention, replied = in progress, done = resolved), it just wasn't
// reading from the one shared palette every other status pill in the app
// now uses.
const STATUS_COLOR: Record<string, string> = { new: 'var(--sem-danger)', replied: 'var(--sem-warning)', done: 'var(--sem-success)' }

/// Full-message view — clicking a message card previously did nothing
/// beyond the inline Antworten/Erledigt buttons (the message text itself
/// was already fully visible inline, but there was nowhere to go to read it
/// distraction-free or see all its metadata at once). Reuses the exact
/// `.pem-overlay`/`.pem` modal shell EmergenceMonitor.tsx's SignalDetailModal
/// already established (same scrim/close/Escape/click-outside behavior,
/// already dark-HUD-themed) rather than building a second modal system.
function InboxMessageModal({ message, onClose, onReply, onSetStatus, busy }: {
  message: ContactMessage
  onClose: () => void
  onReply: () => void
  onSetStatus: (status: string) => void
  busy: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="pem-overlay" onClick={onClose}>
      <div className="pem" onClick={e => e.stopPropagation()} style={{ ['--obs-accent' as string]: STATUS_COLOR[message.status] ?? 'var(--sem-neutral)' }}>
        <div className="pem-header">
          <span className="pem-title">{message.name}</span>
          <button className="pem-close" onClick={onClose} title="Schließen (Esc)">✕</button>
        </div>
        <div className="pem-body">
          <div className="obs-item-meta" style={{ marginBottom: 10 }}>
            <span className="obs-pill" style={{ background: `color-mix(in srgb, ${STATUS_COLOR[message.status] ?? 'var(--sem-neutral)'} 16%, transparent)`, color: STATUS_COLOR[message.status] ?? 'var(--sem-neutral)' }}>
              {STATUS_LABEL[message.status] ?? message.status}
            </span>
            {' · '}<a href={`mailto:${message.email}`} style={{ color: 'var(--hud-cyan, #22d3ee)' }}>{message.email}</a>
            {message.phone && <> · {message.phone}</>}
            {' · '}{parseServerTimestamp(message.created_at).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
          <p style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--panel-text, rgba(226,241,245,.9))', whiteSpace: 'pre-wrap' }}>
            {message.message || '(Kein Nachrichtentext übermittelt.)'}
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            {message.status === 'done' ? (
              <button className="panel-add-btn" disabled={busy} onClick={() => onSetStatus('new')}>Wieder öffnen</button>
            ) : (
              <>
                <a href={`mailto:${message.email}?subject=Re: Ihre Anfrage`} className="panel-add-btn" style={{ textDecoration: 'none' }} onClick={onReply}>Antworten</a>
                <button className="panel-delete-btn" disabled={busy} onClick={() => onSetStatus('done')}>Erledigt</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function InboxPlaceholder({ icon, text, sub }: { icon: string; text: string; sub?: string }) {
  return (
    <div style={{ minHeight: 'calc(100vh - 220px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center', padding: '24px' }}>
      <div style={{
        width: 46, height: 46, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, border: '1px solid rgba(34,211,238,.16)', background: 'var(--obs-card, rgba(11,17,26,.6))', color: 'var(--hud-cyan, #22d3ee)',
      }}>
        {icon}
      </div>
      <div style={{ color: 'var(--panel-text, rgba(226,241,245,.75))', fontSize: 13.5, fontWeight: 600 }}>{text}</div>
      {sub && <div style={{ color: 'var(--panel-text-dim, rgba(148,190,199,.6))', fontSize: 12, maxWidth: 280, lineHeight: 1.5 }}>{sub}</div>}
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
  const [openMessageId, setOpenMessageId] = useState<string | null>(null)
  const list = data ?? []
  const filteredList = statusFilter ? list.filter(m => m.status === statusFilter) : list
  const groups = groupByDate(filteredList, m => m.created_at)

  const setStatus = async (id: string, status: string) => {
    setUpdatingId(id)
    try {
      await adminFetch(`/api/contact/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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
  // Rendered as soon as data has loaded, independent of whether the inbox
  // currently has any messages — an empty inbox still needs its filter/
  // export controls visible (they just act on an empty set), the empty
  // state itself is a body-level placeholder below (see InboxPlaceholder).
  useHeaderActions(
    data ? (
      <>
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
      </>
    ) : null,
    [data, statusFilter, filteredList],
  )

  if (loading && !data) {
    return <div className="obs-panel" style={{ padding: 14 }}><HudSkeleton variant="list" /></div>
  }
  if (error) {
    return <InboxPlaceholder icon="!" text="Konnte nicht geladen werden." />
  }

  return (
    <div style={{ padding: 14 }}>
      {list.length === 0 ? (
        <InboxPlaceholder icon="◇" text="Keine neuen Anfragen." sub="Anfragen aus dem Kontaktformular der Website erscheinen hier automatisch." />
      ) : filteredList.length === 0 ? (
        <InboxPlaceholder icon="○" text="Keine Treffer." sub="Kein Eintrag mit diesem Status." />
      ) : (
        groups.map(group => (
          <div key={group.label} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--panel-text-dim, rgba(148,190,199,.6))', margin: '0 0 8px 2px' }}>
              {group.label}
            </div>
            {group.items.map(item => (
              <div
                key={item.id}
                className="obs-item-card"
                role="button"
                tabIndex={0}
                onClick={() => setOpenMessageId(item.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenMessageId(item.id) } }}
                style={{ background: 'var(--obs-card, rgba(11,17,26,.6))', borderRadius: 10, padding: 14, marginBottom: 12, border: '1px solid rgba(34,211,238,.16)', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{item.name}</div>
                    <a href={`mailto:${item.email}`} onClick={e => e.stopPropagation()} style={{ fontSize: 12, color: 'var(--hud-cyan, #22d3ee)' }}>{item.email}</a>
                    {item.phone && <div style={{ fontSize: 12, color: 'var(--panel-text-dim, rgba(148,190,199,.6))' }}>{item.phone}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span className="obs-pill" style={{ background: `color-mix(in srgb, ${STATUS_COLOR[item.status] ?? 'var(--sem-neutral)'} 16%, transparent)`, color: STATUS_COLOR[item.status] ?? 'var(--sem-neutral)' }}>
                      {STATUS_LABEL[item.status] ?? item.status}
                    </span>
                    <div style={{ fontSize: 10, color: 'var(--panel-text-dim, rgba(148,190,199,.6))', whiteSpace: 'nowrap' }}>
                      {parseServerTimestamp(item.created_at).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
                {item.message && <p style={{ fontSize: 12, margin: '8px 0 10px', color: 'var(--panel-text, rgba(226,241,245,.75))', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{item.message}</p>}
                <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
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
      {openMessageId && (() => {
        const openMessage = list.find(m => m.id === openMessageId)
        return openMessage ? (
          <InboxMessageModal
            message={openMessage}
            onClose={() => setOpenMessageId(null)}
            busy={updatingId === openMessage.id}
            onReply={() => { if (openMessage.status === 'new') setStatus(openMessage.id, 'replied') }}
            onSetStatus={status => setStatus(openMessage.id, status)}
          />
        ) : null
      })()}
    </div>
  )
}
