import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { adminFetch } from '../../lib/adminApi'
import { hudStagger } from '../../lib/hudStagger'
import { ExportButtons } from './ExportButtons'
import { HudSkeleton } from './HudSkeleton'
import { HudSectionHeader } from './Hud'

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

const KIND_LABELS: Record<Anomaly['kind'], string> = {
  tool_error: 'Werkzeug-Fehler',
  iteration_cap: 'Runden-Obergrenze erreicht',
  refusal_triggered: 'Ablehnung ausgelöst (heuristisch)',
  hallucination_mismatch: 'Falschbehauptung (Hallucination Tracker)',
}

const KIND_COLORS: Record<Anomaly['kind'], string> = {
  tool_error: '#ef4444',
  iteration_cap: '#f59e0b',
  refusal_triggered: '#3b6bf6',
  hallucination_mismatch: '#8b5cf6',
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

  if (loading && items.length === 0) return <div className="obs-panel"><HudSkeleton variant="list" /></div>
  if (error && items.length === 0) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>

  return (
    <div className="obs-panel">
      <HudSectionHeader
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={kindFilter} onChange={e => setKindFilter(e.target.value as '' | Anomaly['kind'])} style={{ fontSize: 12, padding: '5px 8px' }}>
              <option value="">Alle Arten</option>
              {(Object.keys(KIND_LABELS) as Anomaly['kind'][]).map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
            <ExportButtons rows={items.map(i => ({ ...i }))} filenameBase="anomalie-log" title="Anomalie-Log" />
          </div>
        }
      />

      {items.length === 0 ? (
        <div className="obs-card">
          <div className="obs-empty">
            Noch keine Anomalien protokolliert — das Log füllt sich automatisch, sobald ein Werkzeugaufruf
            fehlschlägt, die Werkzeug-Runden-Obergrenze erreicht wird, die Ablehnungs-Instruktion heuristisch
            anschlägt, oder der Hallucination Tracker eine echte Falschbehauptung findet. Kein Eintrag heißt hier
            ehrlich: bisher nichts aufgefallen — nicht "wurde nicht überprüft".
          </div>
        </div>
      ) : (
        <>
          <div className="obs-section-label">
            Geloggte Anomalien <span style={{ fontWeight: 400 }}>(geladen: {items.length} von {total ?? '…'})</span>
          </div>
          {items.map((item, i) => (
            <div className="obs-item-card" key={item.id} style={{ ...hudStagger(i), ['--obs-accent' as string]: KIND_COLORS[item.kind] }}>
              <div className="obs-item-title">
                <span className="obs-pill" style={{ background: `${KIND_COLORS[item.kind]}1a`, color: KIND_COLORS[item.kind] }}>
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
                      onClick={() => onOpenConversation(item.conversation_id)}
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

          <p style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.6, marginTop: 14 }}>
            Vier mechanische Signale, kein zertifizierter Erkenner: ein fehlgeschlagener Werkzeugaufruf, eine
            erreichte Werkzeug-Runden-Obergrenze, ein heuristischer Stichwort-Treffer auf Ablehnungssprache in der
            Antwort, oder ein "mismatch"-Befund des Hallucination Trackers. Jeder Eintrag ist ein Hinweis zur
            menschlichen Durchsicht, kein bewiesener Befund.
          </p>
        </>
      )}
    </div>
  )
}
