import { useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders } from '../../lib/adminApi'
import { hudStagger } from '../../lib/hudStagger'
import { ExportButtons } from './ExportButtons'
import { HudSkeleton } from './HudSkeleton'

// Real, standalone Verwaltung page for backend/src/auditlog.rs's
// hash-chained audit_log — the small sidebar `AuditChangelog.tsx` widget
// (last 8 entries + a glance-able chain-intact dot) stays exactly as-is;
// this is a genuinely separate, more complete surface: real pagination,
// real filters wired to `list_log`'s new query params, expandable per-row
// `meta`, CSV/Markdown export, and — the one thing Simeon's own reference
// point (RFI-IRFOS's Lighthouse project's real, shipped Changelog.tsx)
// never actually shipped on its live page — a working chain-verify UI.
// Lighthouse's live page has NO verify button at all (that only ever
// existed on its retired, dead Audit.tsx); ours does, because our backend's
// `/verify` endpoint is a real, working, walk-the-whole-chain check, not an
// orphaned leftover.
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

// Backend default page size for GET /api/observatory/audit/log (see
// DEFAULT_LOG_LIMIT in auditlog.rs) — kept in sync so the first page loaded
// here matches what the backend would return anyway, same convention as
// AnomalyLog.tsx's own PAGE_SIZE constant.
const PAGE_SIZE = 50

// Fixed, closed vocabulary defined entirely by backend call sites of
// `auditlog::record` (auth.rs, billing.rs, blog.rs, chat.rs, content.rs,
// dashboards.rs, anomaly.rs, hallucination.rs, research.rs,
// simulation.rs) — an `event_type` never comes from free user text the way
// `actor` sometimes does (a real login email), so seeding this dropdown
// from a static, known list is MORE complete than Lighthouse's own
// "actor dropdown built from loaded data" approach: a value that simply
// hasn't appeared on the currently-loaded page yet still shows up as a
// selectable filter instead of silently being unreachable. `eventTypeOptions`
// below unions this with whatever the loaded page has actually seen, so a
// future call site this list hasn't caught up with yet still surfaces
// correctly rather than being hidden.
const KNOWN_EVENT_TYPES = [
  'admin_login',
  'anomaly_detected',
  'blog_post_deleted',
  'blog_published',
  'chat_conversation_deleted',
  'content_updated',
  'dashboard_deleted',
  'hallucination_mismatch',
  'order_recorded',
  'product_created',
  'research_item_deleted',
  'simulation_run_deleted',
]

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'medium' })
}

export function Changelog() {
  const [items, setItems] = useState<AuditLogEntry[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const [actorFilter, setActorFilter] = useState('')
  const [eventTypeFilter, setEventTypeFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  // Raw input value (updates on every keystroke) vs. the debounced value
  // that actually drives the backend query — same split ResearchChat.tsx's
  // own conversation search already uses, so free-text search here doesn't
  // fire a LIKE query on every single keystroke.
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const [verify, setVerify] = useState<VerifyResult | null>(null)
  const [verifying, setVerifying] = useState(false)

  const runVerify = async () => {
    setVerifying(true)
    try {
      const res = await fetch(`${API_BASE}/api/observatory/audit/verify`, { headers: authHeaders() })
      if (!res.ok) throw new Error(String(res.status))
      setVerify(await res.json())
    } catch {
      setVerify(null)
    } finally {
      setVerifying(false)
    }
  }

  // Runs once on mount so the badge is never blank on arrival, plus the
  // "Kette jetzt prüfen" button below re-runs it on demand — a real,
  // working verify action Lighthouse's own live page never shipped (see
  // this module's own doc comment above).
  useEffect(() => {
    runVerify()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 280)
    return () => clearTimeout(t)
  }, [searchInput])

  const load = async (offset: number, append: boolean) => {
    if (append) setLoadingMore(true); else setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (actorFilter) params.set('actor', actorFilter)
      if (eventTypeFilter) params.set('event_type', eventTypeFilter)
      // Bare calendar days from <input type="date"> widened to a full-day
      // span — see auditlog::ListLogQuery's own doc comment for why `from`/
      // `to` compare directly against the stored RFC3339 `created_at`
      // string rather than reusing observatory::resolve_range's relative
      // "N days back" idiom.
      if (fromDate) params.set('from', `${fromDate}T00:00:00.000000Z`)
      if (toDate) params.set('to', `${toDate}T23:59:59.999999Z`)
      if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim())
      const res = await fetch(`${API_BASE}/api/observatory/audit/log?${params}`, { headers: authHeaders() })
      if (!res.ok) throw new Error(String(res.status))
      const totalHeader = res.headers.get('X-Total-Count')
      const page: AuditLogEntry[] = await res.json()
      setItems(prev => (append ? [...prev, ...page] : page))
      setTotal(totalHeader !== null ? Number(totalHeader) : null)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  // Any filter change starts over from the newest page — "Weitere laden"
  // below is the only path that appends, same convention as AnomalyLog's
  // kind filter / Flugschreiber's range filter.
  useEffect(() => {
    load(0, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorFilter, eventTypeFilter, fromDate, toDate, debouncedSearch])

  const loadMore = () => load(items.length, true)

  const actorOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const it of items) seen.add(it.actor)
    return Array.from(seen).sort()
  }, [items])

  const eventTypeOptions = useMemo(() => {
    const seen = new Set(KNOWN_EVENT_TYPES)
    for (const it of items) seen.add(it.event_type)
    return Array.from(seen).sort()
  }, [items])

  // ExportButtons/lib/export.ts need already-flat rows (see that file's own
  // doc comment) — `meta` is a nested object here, folded to a JSON string
  // so it survives as one plain CSV/Markdown cell instead of being dropped.
  const exportRows = useMemo(
    () => items.map(it => ({
      id: it.id,
      actor: it.actor,
      event_type: it.event_type,
      summary: it.summary,
      meta: it.meta ? JSON.stringify(it.meta) : '',
      created_at: it.created_at,
    })),
    [items],
  )

  const anyFilterActive = Boolean(actorFilter || eventTypeFilter || fromDate || toDate || debouncedSearch.trim())

  if (loading && items.length === 0) return <div className="obs-panel"><HudSkeleton variant="list" /></div>

  return (
    <div className="obs-panel">
      {/* ── Chain integrity — the one thing Lighthouse's own live Changelog
          page never shipped (only its retired Audit.tsx had a verify
          button); our backend's /verify endpoint is real and working, so
          this page gets a real, working verify UI. ────────────────────── */}
      <div className="obs-card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="panel-add-btn" onClick={runVerify} disabled={verifying}>
          {verifying ? 'Prüft…' : 'Kette jetzt prüfen'}
        </button>
        {verify && (
          <span
            className={`crm-audit-chain-badge ${verify.chain_intact ? 'intact' : 'broken'}`}
            title={verify.chain_intact ? `Kette intakt über ${verify.total} Einträge` : `Kette gebrochen bei Eintrag ${verify.broken_at_id}`}
          >
            {verify.chain_intact ? `Kette intakt ✓ (${verify.total} Einträge)` : `Kette gebrochen ⚠ bei Eintrag ${verify.broken_at_id}`}
          </span>
        )}
        {!verify && !verifying && <span className="obs-item-meta" style={{ margin: 0 }}>Noch nicht geprüft.</span>}
      </div>

      {/* ── Filters ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, margin: '16px 0 14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={actorFilter} onChange={e => setActorFilter(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
          <option value="">Alle Akteure</option>
          {actorOptions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={eventTypeFilter} onChange={e => setEventTypeFilter(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
          <option value="">Alle Ereignistypen</option>
          {eventTypeOptions.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          type="date"
          value={fromDate}
          onChange={e => setFromDate(e.target.value)}
          title="Von"
          style={{ fontSize: 12, padding: '5px 8px' }}
        />
        <input
          type="date"
          value={toDate}
          onChange={e => setToDate(e.target.value)}
          title="Bis"
          style={{ fontSize: 12, padding: '5px 8px' }}
        />
        <input
          type="text"
          placeholder="Suche in Zusammenfassung…"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          style={{ fontSize: 12, padding: '5px 8px', minWidth: 200, flex: '1 1 200px' }}
        />
        {/* Exports whatever is currently loaded/filtered (`items`), same
            "honest about scope" convention as every other Observatory
            export — see SimulationCenter.tsx/AnomalyLog.tsx's own
            ExportButtons call sites. */}
        <ExportButtons rows={exportRows} filenameBase="changelog" title="Änderungsprotokoll" />
      </div>

      {error && items.length === 0 && (
        <div className="obs-card"><div className="obs-empty">Fehler beim Laden.</div></div>
      )}

      {!error && items.length === 0 && (
        <div className="obs-card">
          <div className="obs-empty">
            {anyFilterActive
              ? 'Keine Einträge für diese Filterkombination.'
              : 'Noch keine Einträge im Änderungsprotokoll.'}
          </div>
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="obs-section-label">
            Einträge <span style={{ fontWeight: 400 }}>(geladen: {items.length} von {total ?? '…'})</span>
          </div>
          {items.map((entry, i) => (
            <div
              className="obs-item-card obs-item-card-clickable"
              key={entry.id}
              style={hudStagger(i)}
              onClick={() => setExpandedId(id => (id === entry.id ? null : entry.id))}
              role="button"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setExpandedId(id => (id === entry.id ? null : entry.id))
                }
              }}
            >
              <div className="obs-item-title">
                <span
                  className="obs-pill"
                  style={{ background: 'rgba(99,240,255,.12)', color: '#63f0ff', fontFamily: "'SF Mono','JetBrains Mono',Consolas,monospace" }}
                >
                  {entry.event_type}
                </span>
              </div>
              <div className="obs-item-body">{entry.summary}</div>
              <div className="obs-item-meta" style={{ marginTop: 6, marginBottom: 0 }}>
                {formatDateTime(entry.created_at)} · {entry.actor}
              </div>
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
    </div>
  )
}
