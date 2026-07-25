import { useEffect, useState, type CSSProperties } from 'react'
import { useAdminFetch, adminFetch } from '../../lib/adminApi'
import { hudStagger } from '../../lib/hudStagger'
import { ExportButtons } from './ExportButtons'
import { HudSkeleton } from './HudSkeleton'
import { useHeaderActions } from './Hud'
import { AGENT_ACTIVITY_KIND_LABELS, AGENT_ACTIVITY_STATUS_LABELS } from '../../lib/labels'

interface ActivityItem {
  kind: 'pull_request' | 'commit' | 'workflow_run' | 'deploy'
  title: string
  detail: string | null
  status: string | null
  url: string | null
  timestamp: string
}
interface AgentActivityData {
  configured: boolean
  message: string | null
  items: ActivityItem[]
}

interface ToolCallRow {
  id?: string
  tool_name?: string
  arguments?: unknown
  result?: unknown
  status?: string
  created_at?: string
}

const KIND_COLORS: Record<ActivityItem['kind'], string> = {
  pull_request: '#3b6bf6',
  commit: '#8b5cf6',
  workflow_run: '#14b8a6',
  deploy: '#f59e0b',
}

function statusColor(item: ActivityItem): string {
  const s = (item.status ?? '').toLowerCase()
  if (s === 'failure' || s === 'error' || s === 'closed') return '#ef4444'
  if (s === 'merged' || s === 'success' || s === 'deployed') return '#10b981'
  return KIND_COLORS[item.kind]
}

function safeParseJson(s: string): unknown {
  try { return JSON.parse(s) } catch { return s }
}

function prettyJson(value: unknown): string {
  const v = typeof value === 'string' ? safeParseJson(value) : value
  try { return JSON.stringify(v, null, 2) } catch { return typeof value === 'string' ? value : String(value) }
}

function toolStatusColor(status: string): string {
  const s = status.toLowerCase()
  if (s === 'error' || s === 'failure' || s === 'failed') return '#ef4444'
  if (s === 'success' || s === 'ok' || s === 'done') return '#10b981'
  if (s === 'running' || s === 'pending') return '#f59e0b'
  return '#9aa0a8'
}

const DROPDOWN_PRE_STYLE: CSSProperties = {
  fontSize: 11,
  lineHeight: 1.5,
  color: '#c8cdd4',
  background: '#0a0d12',
  border: '1px solid #1f242c',
  borderRadius: 6,
  padding: 10,
  overflowX: 'auto',
  maxHeight: 280,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: 0,
}

const DRILLDOWN_INPUT_STYLE = {
  flex: '1 1 220px',
  minWidth: 160,
  fontSize: 12,
  padding: '6px 8px',
  background: '#0e1116',
  color: '#e8eaed',
  border: '1px solid #2a2f37',
  borderRadius: 6,
}

// Click-to-expand detail view, same .pem-overlay/.pem shell as
// Inbox/EmergenceMonitor/SystemState's own modals — a focused single-item
// read (larger type, no neighboring rows) rather than nothing happening
// beyond the inline row itself.
function AgentActivityModal({ item, onClose }: { item: ActivityItem; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="pem-overlay" onClick={onClose}>
      <div className="pem obs-signal-modal" onClick={e => e.stopPropagation()} style={{ ['--obs-accent' as string]: statusColor(item) }}>
        <div className="pem-header">
          <span className="pem-title">{item.title}</span>
          <button className="pem-close" onClick={onClose} title="Schließen (Esc)">✕</button>
        </div>
        <div className="pem-body obs-signal-modal-body">
          <div className="obs-item-meta" style={{ margin: '4px 0 12px' }}>
            <span className="obs-pill" style={{ background: `${KIND_COLORS[item.kind]}1a`, color: KIND_COLORS[item.kind] }}>
              {AGENT_ACTIVITY_KIND_LABELS[item.kind] ?? item.kind}
            </span>
            {item.status && (
              <>
                {' '}
                <span className="obs-pill" style={{ background: `${statusColor(item)}1a`, color: statusColor(item) }}>
                  {AGENT_ACTIVITY_STATUS_LABELS[item.status] ?? item.status}
                </span>
              </>
            )}
          </div>
          {item.detail && <div className="obs-signal-modal-observation" style={{ marginBottom: 10 }}>{item.detail}</div>}
          <div className="obs-item-meta">{item.timestamp}</div>
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer" className="panel-add-btn" style={{ marginTop: 16, display: 'inline-block', textDecoration: 'none' }}>
              Auf GitHub ansehen ↗
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

/// Real git/GitHub-level transparency: recent pull requests, commits on
/// main, GitHub Actions workflow runs (covers the GitHub Pages frontend
/// deploy), and this app's own deploy_log entries (covers `fly deploy`,
/// which GitHub's API cannot see) — one merged, timestamp-sorted feed, so
/// "what autonomous agent work has actually happened here" has a real answer
/// beyond chat narration. Degrades honestly (see backend/src/github_activity.rs)
/// when GITHUB_ACTIVITY_TOKEN isn't configured, same convention as
/// SystemState's chat_secret_configured warning.
export function AgentActivity() {
  const { data, loading, error } = useAdminFetch<AgentActivityData>('/api/observatory/agent-activity')
  // Client-side — the endpoint has no query params (it merges four already
  // per-source-capped sources into one ≤~80-item feed, see
  // backend/src/github_activity.rs), so everything is fetched in one shot
  // already and there's nothing to gain from a server round-trip here.
  const [kindFilter, setKindFilter] = useState<'' | ActivityItem['kind']>('')
  const [expandedItem, setExpandedItem] = useState<ActivityItem | null>(null)

  // Task 4 (Wave 0) drilldown: per-conversation RAW tool calls. The
  // aggregate feed above only shows GitHub-level activity; this reaches into
  // the agent_tool_calls table for the actual arguments/result JSON a
  // conversation handed to and got back from each tool. No conversation_id
  // source exists on this component, so the user supplies one.
  const [toolConvId, setToolConvId] = useState('')
  const [toolCalls, setToolCalls] = useState<ToolCallRow[]>([])
  const [toolLoading, setToolLoading] = useState(false)
  const [toolError, setToolError] = useState(false)

  const loadToolCalls = async () => {
    const id = toolConvId.trim()
    if (!id) return
    setToolLoading(true); setToolError(false); setToolCalls([])
    try {
      const res = await adminFetch(`/api/observatory/tool-calls/${encodeURIComponent(id)}`, {})
      if (!res.ok) throw new Error(String(res.status))
      setToolCalls(await res.json())
    } catch {
      setToolError(true)
    } finally {
      setToolLoading(false)
    }
  }

  const items = data ? (kindFilter ? data.items.filter(i => i.kind === kindFilter) : data.items) : []

  useHeaderActions(
    data && data.items.length > 0 ? (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={kindFilter} onChange={e => setKindFilter(e.target.value as '' | ActivityItem['kind'])} style={{ flex: '0 1 180px' }}>
          <option value="">Alle Typen</option>
          {(Object.keys(AGENT_ACTIVITY_KIND_LABELS) as ActivityItem['kind'][]).map(k => <option key={k} value={k}>{AGENT_ACTIVITY_KIND_LABELS[k]}</option>)}
        </select>
        <ExportButtons rows={items.map(i => ({ ...i }))} filenameBase="agent-activity" title="Agent-Aktivität" />
      </div>
    ) : null,
    [data, kindFilter],
  )

  if (loading) return <div className="obs-panel"><HudSkeleton variant="list" /></div>
  if (error) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>
  if (!data) return <div className="obs-panel"><div className="obs-empty">Keine Daten verfügbar.</div></div>

  return (
    <div className="obs-panel">
      {!data.configured && data.message && (
        <div className="obs-warning-note">▲ {data.message}</div>
      )}
      {data.items.length === 0
        ? <div className="obs-card"><div className="obs-empty">Noch keine Aktivität protokolliert.</div></div>
        : items.length === 0
        ? <div className="obs-card"><div className="obs-empty">Keine Treffer.</div></div>
        : items.map((item, i) => (
            <div
              className="obs-item-card obs-item-card-clickable"
              key={i}
              style={{ ...hudStagger(i), ['--obs-accent' as string]: statusColor(item) }}
              role="button"
              tabIndex={0}
              onClick={() => setExpandedItem(item)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedItem(item) } }}
            >
              <div className="obs-item-title">
                {item.url
                  ? <a href={item.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: 'inherit', textDecoration: 'none' }}>{item.title}</a>
                  : item.title}
              </div>
              <div className="obs-item-meta">
                <span className="obs-pill" style={{ background: `${KIND_COLORS[item.kind]}1a`, color: KIND_COLORS[item.kind] }}>
                  {AGENT_ACTIVITY_KIND_LABELS[item.kind] ?? item.kind}
                </span>
                {item.status && (
                  <>
                    {' '}
                    <span className="obs-pill" style={{ background: `${statusColor(item)}1a`, color: statusColor(item) }}>
                      {AGENT_ACTIVITY_STATUS_LABELS[item.status] ?? item.status}
                    </span>
                  </>
                )}
                {item.detail && <>{' · '}{item.detail}</>}
                {' · '}{item.timestamp}
                {item.url && (
                  <>
                    {' · '}
                    <a href={item.url} target="_blank" rel="noreferrer" className="chat-inspect-toggle" style={{ fontSize: 11, padding: 0 }} onClick={e => e.stopPropagation()}>
                      auf GitHub ansehen ↗
                    </a>
                  </>
                )}
              </div>
            </div>
          ))
      }

      <p style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.6 }}>
        Was tatsächlich am Code passiert ist — keine Erzählung aus dem Chat, sondern echte Einträge aus der
        Versionsverwaltung dieses Projekts. Veröffentlichungen werden separat erfasst, da sie dort nicht automatisch sichtbar sind.
      </p>
      <div className="obs-section-label" style={{ marginTop: 18 }}>Werkzeug-Aufrufe (Drilldown)</div>
      <div className="obs-card">
        <div className="obs-item-meta" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            value={toolConvId}
            onChange={e => setToolConvId(e.target.value)}
            placeholder="Conversation-ID"
            style={DRILLDOWN_INPUT_STYLE}
          />
          <button className="panel-add-btn" onClick={loadToolCalls} disabled={toolLoading || !toolConvId.trim()}>
            {toolLoading ? 'Lädt…' : 'Laden'}
          </button>
        </div>
        {toolError && <div className="obs-empty" style={{ padding: '8px 0' }}>Fehler beim Laden.</div>}
        {!toolLoading && !toolError && toolCalls.length === 0 && (
          <div className="obs-empty">Noch keine Werkzeug-Aufrufe geladen. Conversation-ID eingeben und „Laden“.</div>
        )}
        {toolCalls.map((tc, i) => (
          <div className="obs-item-card" key={tc.id ?? i} style={{ ...hudStagger(i) }}>
            <div className="obs-item-title">
              <span className="obs-pill" style={{ background: '#3b6bf61a', color: '#3b6bf6' }}>{tc.tool_name ?? '—'}</span>
              <span className="obs-pill" style={{ background: `${toolStatusColor(tc.status ?? '')}1a`, color: toolStatusColor(tc.status ?? '') }}>{tc.status ?? '—'}</span>
            </div>
            {tc.created_at && <div className="obs-item-meta" style={{ marginTop: 4 }}>{tc.created_at}</div>}
            <div style={{ marginTop: 8 }}>
              <div className="obs-item-meta" style={{ marginBottom: 2 }}>Argumente</div>
              <pre style={DROPDOWN_PRE_STYLE}>{prettyJson(tc.arguments)}</pre>
              <div className="obs-item-meta" style={{ margin: '8px 0 2px' }}>Ergebnis</div>
              <pre style={DROPDOWN_PRE_STYLE}>{prettyJson(tc.result)}</pre>
            </div>
          </div>
        ))}
      </div>

      {expandedItem && <AgentActivityModal item={expandedItem} onClose={() => setExpandedItem(null)} />}
    </div>
  )
}
