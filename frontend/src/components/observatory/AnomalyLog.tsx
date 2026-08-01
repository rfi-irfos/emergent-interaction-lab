import { useEffect, useState } from 'react'
import { adminFetch } from '../../lib/adminApi'
import { hudStagger } from '../../lib/hudStagger'
import { ExportButtons } from './ExportButtons'
import { HudSkeleton } from './HudSkeleton'
import { HudSectionHeader, useHeaderActions } from './Hud'

// One row per anomaly the Anomaly Watchdog v1 flagged — see
// backend/src/anomaly.rs's module doc comment for the full "what this is
// NOT" disclosure this UI must never contradict: four concrete, mechanical
// trip-wires for a human to review, never a certified detector.
// `refusal_triggered` in particular is a plain keyword scan over the
// model's own reply text. Every row here is a real detection at real
// capture time, chained into the same background spawn `chat::stream_chat`
// already runs after every turn (see that spawn's own doc comment for why
// it's combined with the hallucination-check spawn rather than a separate
// one).
interface Anomaly {
  id: string
  kind: 'tool_error' | 'iteration_cap' | 'refusal_triggered' | 'hallucination_mismatch'
  conversation_id: string
  chat_message_id: string | null
  detail: string
  created_at: string
}

interface HallucinationCheck {
  id?: string
  chat_message_id?: string
  tool_call_id?: string
  verdict?: string
  detail?: string
  created_at?: string
}

const KIND_LABELS: Record<Anomaly['kind'], string> = {
  tool_error: 'Werkzeug-Fehler',
  iteration_cap: 'Runden-Obergrenze erreicht',
  refusal_triggered: 'Ablehnung ausgelöst (heuristisch)',
  hallucination_mismatch: 'Falschbehauptung (Hallucination Tracker)',
}

// Real semantic accents (--sem-*, see App.css's fixed 5-value taxonomy)
// instead of a bespoke per-kind hex palette: a tool failure and a real
// hallucination mismatch are both genuinely bad (--sem-danger); the
// iteration-cap trip-wire is soft/advisory (--sem-warning, matching
// AgentActivity's own anomaly-surface accent for the same kind); the
// refusal heuristic gets the neutral-factual --sem-info tint since it's a
// keyword-scan flag, not a confirmed problem or a research signal.
const KIND_COLORS: Record<Anomaly['kind'], string> = {
  tool_error: 'var(--sem-danger)',
  iteration_cap: 'var(--sem-warning)',
  refusal_triggered: 'var(--sem-info)',
  hallucination_mismatch: 'var(--sem-danger)',
}

function verdictColor(verdict: string): string {
  const v = verdict.toLowerCase()
  if (v === 'match') return 'var(--sem-success)'
  if (v === 'mismatch') return 'var(--sem-danger)'
  return 'var(--sem-warning)'
}

// Real theme-aware fallbacks (light-appropriate) instead of a permanently
// dark-hardcoded input — this input previously rendered dark-on-dark
// regardless of the active theme.
const DRILLDOWN_INPUT_STYLE = {
  flex: '1 1 220px',
  minWidth: 160,
  fontSize: 12,
  padding: '6px 8px',
}

// Click-to-expand detail view — same .pem-overlay/.pem shell as the other
// Observatory detail modals (Inbox/EmergenceMonitor/SystemState/AgentActivity).
function AnomalyModal({ item, onClose, onOpenConversation }: {
  item: Anomaly
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
      <div className="pem obs-signal-modal" onClick={e => e.stopPropagation()} style={{ ['--obs-accent' as string]: KIND_COLORS[item.kind] }}>
        <div className="pem-header">
          <span className="pem-title">{KIND_LABELS[item.kind]}</span>
          <button className="pem-close" onClick={onClose} title="Schließen (Esc)">✕</button>
        </div>
        <div className="pem-body obs-signal-modal-body">
          <div className="obs-signal-modal-observation" style={{ marginBottom: 12 }}>{item.detail}</div>
          <div className="obs-item-meta">{item.created_at} · Gespräch {item.conversation_id}</div>
          {item.chat_message_id && <div className="obs-item-meta" style={{ marginTop: 4 }}>Nachricht {item.chat_message_id}</div>}
          {onOpenConversation && (
            <button className="panel-add-btn" style={{ marginTop: 16 }} onClick={() => { onOpenConversation(item.conversation_id); onClose() }}>
              Aus Gespräch öffnen ↗
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Backend default page size for GET /api/observatory/anomalies (see
// DEFAULT_LIMIT in anomaly.rs) — kept in sync so the first page loaded here
// matches what the backend would return anyway.
const PAGE_SIZE = 50

/// Anomalie-Log — "der Wachhund, der den Wachhund beobachtet." Unlike the
/// research-facing Observatory modules, this one watches JARVIS ITSELF, not
/// Laura's research: did a tool call fail, did the tool-calling loop hit its
/// own round cap, did the refusal instruction in the system prompt actually
/// fire (heuristically), did the hallucination tracker already catch a real
/// false claim. See backend/src/anomaly.rs's module doc comment for the
/// binding "what this is NOT" disclosure — every row is "worth a human
/// look," never a verified finding on its own.
export function AnomalyLog({ onOpenConversation }: { onOpenConversation?: (conversationId: string) => void } = {}) {
  const [items, setItems] = useState<Anomaly[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [kindFilter, setKindFilter] = useState<'' | Anomaly['kind']>('')
  const [expandedItem, setExpandedItem] = useState<Anomaly | null>(null)

  // Task 4 (Wave 0) drilldown: the FULL hallucination_checks verdict list for
  // a conversation — every match/mismatch/unverifiable row, not just the
  // mismatch ones this anomaly log already surfaces as rows. No
  // conversation_id source exists on this component, so the user supplies one.
  const [halConvId, setHalConvId] = useState('')
  const [hallucinations, setHallucinations] = useState<HallucinationCheck[]>([])
  const [halLoading, setHalLoading] = useState(false)
  const [halError, setHalError] = useState(false)

  const loadHallucinations = async () => {
    const id = halConvId.trim()
    if (!id) return
    setHalLoading(true); setHalError(false); setHallucinations([])
    try {
      const res = await adminFetch(`/api/observatory/hallucinations/${encodeURIComponent(id)}`, {})
      if (!res.ok) throw new Error(String(res.status))
      setHallucinations(await res.json())
    } catch {
      setHalError(true)
    } finally {
      setHalLoading(false)
    }
  }

  const load = async (offset: number, append: boolean) => {
    if (append) setLoadingMore(true); else setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (kindFilter) params.set('kind', kindFilter)
      const res = await adminFetch(`/api/observatory/anomalies?${params}`, {})
      if (!res.ok) throw new Error(String(res.status))
      const totalHeader = res.headers.get('X-Total-Count')
      const page: Anomaly[] = await res.json()
      setItems(prev => (append ? [...prev, ...page] : page))
      setTotal(totalHeader !== null ? Number(totalHeader) : null)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  // A filter change starts over from the newest page — "Weitere laden"
  // below is the only path that appends, same convention as Flugschreiber's
  // range filter.
  useEffect(() => {
    load(0, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindFilter])

  const loadMore = () => load(items.length, true)

  useHeaderActions(
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <select value={kindFilter} onChange={e => setKindFilter(e.target.value as '' | Anomaly['kind'])} style={{ fontSize: 12, padding: '5px 8px' }}>
        <option value="">Alle Arten</option>
        {(Object.keys(KIND_LABELS) as Anomaly['kind'][]).map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
      </select>
      <ExportButtons rows={items.map(i => ({ ...i }))} filenameBase="anomalie-log" title="Anomalie-Log" />
    </div>,
    [kindFilter, items],
  )

  if (loading && items.length === 0) return <div className="obs-panel"><HudSkeleton variant="list" /></div>
  if (error && items.length === 0) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>

  return (
    <div className="obs-panel">
      {items.length === 0 ? (
        <div className="obs-card">
          <div className="obs-empty">
            Noch keine Anomalien protokolliert — das Log füllt sich automatisch, sobald ein Werkzeugaufruf
            fehlschlägt, die Werkzeug-Runden-Obergrenze erreicht wird, die Ablehnungs-Instruktion heuristisch
            anschlägt, oder der Hallucination Tracker eine echte Falschbehauptung findet.
          </div>
        </div>
      ) : (
        <>
          <HudSectionHeader title="Geloggte Anomalien" sub={`geladen: ${items.length} von ${total ?? '…'}`} />
          {items.map((item, i) => (
            <div
              className="obs-item-card obs-item-card-clickable"
              key={item.id}
              style={{ ...hudStagger(i), ['--obs-accent' as string]: KIND_COLORS[item.kind] }}
              role="button"
              tabIndex={0}
              onClick={() => setExpandedItem(item)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedItem(item) } }}
            >
              <div className="obs-item-title">
                <span className="obs-pill" style={{ background: `color-mix(in srgb, ${KIND_COLORS[item.kind]} 16%, transparent)`, color: KIND_COLORS[item.kind] }}>
                  {KIND_LABELS[item.kind]}
                </span>
              </div>
              <div className="obs-item-meta">{item.detail}</div>
              <div className="obs-item-meta" style={{ marginTop: 4 }}>
                {item.created_at} · Gespräch {item.conversation_id}
                {onOpenConversation && (
                  <>
                    {' · '}
                    <button
                      className="chat-inspect-toggle"
                      style={{ fontSize: 11, padding: 0 }}
                      onClick={e => { e.stopPropagation(); onOpenConversation(item.conversation_id) }}
                    >
                      aus Gespräch ↗
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}

          {error && items.length > 0 && (
            <div className="obs-empty" style={{ padding: '8px 0' }}>Fehler beim Nachladen.</div>
          )}
          {total !== null && items.length < total && (
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <button className="panel-add-btn" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Lädt…' : `Weitere laden (${items.length} / ${total})`}
              </button>
            </div>
            )}
        </>
      )}
      {expandedItem && (
        <AnomalyModal item={expandedItem} onClose={() => setExpandedItem(null)} onOpenConversation={onOpenConversation} />
      )}
      <HudSectionHeader title="Halluzinations-Prüfungen (Drilldown)" />
      <div className="obs-card">
        <div className="obs-item-meta" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            value={halConvId}
            onChange={e => setHalConvId(e.target.value)}
            placeholder="Conversation-ID"
            style={DRILLDOWN_INPUT_STYLE}
          />
          <button className="panel-add-btn" onClick={loadHallucinations} disabled={halLoading || !halConvId.trim()}>
            {halLoading ? 'Lädt…' : 'Laden'}
          </button>
        </div>
        {halError && <div className="obs-empty" style={{ padding: '8px 0' }}>Fehler beim Laden.</div>}
        {!halLoading && !halError && hallucinations.length === 0 && (
          <div className="obs-empty">Noch keine Halluzinations-Prüfungen geladen. Conversation-ID eingeben und „Laden“.</div>
        )}
        {hallucinations.length > 0 && (
          <div className="obs-table-wrap" style={{ marginTop: 10 }}>
            <table className="obs-table">
              <thead>
                <tr>
                  <th>Zeit</th>
                  <th>Verdict</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {hallucinations.map((h, i) => (
                  <tr key={h.id ?? i}>
                    <td>{h.created_at ?? '—'}</td>
                    <td>
                      <span className="obs-pill" style={{ background: `color-mix(in srgb, ${verdictColor(h.verdict ?? '')} 16%, transparent)`, color: verdictColor(h.verdict ?? '') }}>{h.verdict ?? '—'}</span>
                    </td>
                    <td>{h.detail ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
