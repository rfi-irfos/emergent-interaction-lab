import { useState } from 'react'
import { useAdminFetch } from '../../lib/adminApi'
import { hudStagger } from '../../lib/hudStagger'
import { ExportButtons } from './ExportButtons'
import { HudSkeleton } from './HudSkeleton'

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

const KIND_LABELS: Record<ActivityItem['kind'], string> = {
  pull_request: 'Pull Request',
  commit: 'Commit',
  workflow_run: 'Workflow',
  deploy: 'Deploy',
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

  if (loading) return <div className="obs-panel"><HudSkeleton variant="list" /></div>
  if (error) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>
  if (!data) return <div className="obs-panel"><div className="obs-empty">Keine Daten verfügbar.</div></div>

  const items = kindFilter ? data.items.filter(i => i.kind === kindFilter) : data.items

  return (
    <div className="obs-panel">
      {!data.configured && data.message && (
        <div className="obs-warning-note">⚠ {data.message}</div>
      )}

      <div className="obs-section-label">Agent-Aktivität (PRs, Commits, Workflows, Deploys)</div>
      {data.items.length > 0 && (
        <div style={{ display: 'flex', gap: 8, margin: '10px 0 14px', flexWrap: 'wrap' }}>
          <select value={kindFilter} onChange={e => setKindFilter(e.target.value as '' | ActivityItem['kind'])} style={{ flex: '0 1 180px' }}>
            <option value="">Alle Typen</option>
            {(Object.keys(KIND_LABELS) as ActivityItem['kind'][]).map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
          {/* Exports whatever type filter currently narrowed the feed to
              (`items`), not silently the unfiltered merged feed. */}
          <ExportButtons
            rows={items.map(i => ({ ...i }))}
            filenameBase="agent-activity"
            title="Agent-Aktivität"
          />
        </div>
      )}
      {data.items.length === 0
        ? <div className="obs-card"><div className="obs-empty">Noch keine Aktivität protokolliert.</div></div>
        : items.length === 0
        ? <div className="obs-card"><div className="obs-empty">Keine Treffer.</div></div>
        : items.map((item, i) => (
            <div className="obs-item-card" key={i} style={{ ...hudStagger(i), ['--obs-accent' as string]: statusColor(item) }}>
              <div className="obs-item-title">
                {item.url
                  ? <a href={item.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{item.title}</a>
                  : item.title}
              </div>
              <div className="obs-item-meta">
                <span className="obs-pill" style={{ background: `${KIND_COLORS[item.kind]}1a`, color: KIND_COLORS[item.kind] }}>
                  {KIND_LABELS[item.kind]}
                </span>
                {item.status && (
                  <>
                    {' '}
                    <span className="obs-pill" style={{ background: `${statusColor(item)}1a`, color: statusColor(item) }}>
                      {item.status}
                    </span>
                  </>
                )}
                {item.detail && <>{' · '}{item.detail}</>}
                {' · '}{item.timestamp}
                {item.url && (
                  <>
                    {' · '}
                    <a href={item.url} target="_blank" rel="noreferrer" className="chat-inspect-toggle" style={{ fontSize: 11, padding: 0 }}>
                      auf GitHub ansehen ↗
                    </a>
                  </>
                )}
              </div>
            </div>
          ))
      }

      <p style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.6 }}>
        Echte GitHub-/Git-Ereignisse für dieses Repository — keine Chat-Erzählung. Fly-Deploys sind kein
        GitHub-natives Ereignis und werden separat protokolliert.
      </p>
    </div>
  )
}
