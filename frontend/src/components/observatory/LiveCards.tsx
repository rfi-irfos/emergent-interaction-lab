import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders } from '../../lib/adminApi'
import type { AdminSection } from '../../types/admin'
import type { ObservatoryTier } from './registry'

// One card per Observatory module, grouped into the same 3 tiers as the
// sidebar (Forschungsebene/Systemebene/Technische Ebene) — a flat row mixing
// all of them was the concrete manifestation of "33 Embedding Chunks reading
// next to Emergenz with no hierarchy" (see plan). Refetches after every
// completed chat exchange (refreshSignal), so it reads as "the system
// updating as you talk to it."
const MODULE_META: { id: AdminSection; label: string; accent: string; tier: ObservatoryTier }[] = [
  { id: 'emergence', label: 'Emergence Monitor', accent: '#f59e0b', tier: 'research' },
  { id: 'simulationcenter', label: 'Simulation Center', accent: '#8b5cf6', tier: 'research' },
  { id: 'research', label: 'Research Pulse', accent: '#14b8a6', tier: 'research' },
  { id: 'knowledgegraph', label: 'Knowledge Graph', accent: '#22d3ee', tier: 'research' },
  { id: 'systemmap', label: 'System Map', accent: '#3b6bf6', tier: 'system' },
  { id: 'systemstate', label: 'System State', accent: '#10b981', tier: 'system' },
  { id: 'agentactivity', label: 'Agent-Aktivität', accent: '#ef4444', tier: 'system' },
  { id: 'flugschreiber', label: 'Flugschreiber', accent: '#f59e0b', tier: 'system' },
  { id: 'interaction', label: 'Interaction Dynamics', accent: '#8b5cf6', tier: 'system' },
  { id: 'behavior', label: 'Behavioral Landscape', accent: '#3b6bf6', tier: 'system' },
  { id: 'information', label: 'Information Dynamics', accent: '#14b8a6', tier: 'technical' },
]

// Same "page-response's own X-Total-Count header, not just page length" care
// `emergence`/`simulationcenter` below already take (see the comment above
// the Promise.all) — both of these are freshly paginated endpoints from
// tonight, so a plain array-length tile would silently under-report past
// the first page exactly the way those two were fixed to avoid.
async function fetchTotalCount(path: string): Promise<number | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() })
    if (!res.ok) return null
    const header = res.headers.get('X-Total-Count')
    if (header !== null) return Number(header)
    const body = await res.json()
    return Array.isArray(body) ? body.length : null
  } catch {
    return null
  }
}

async function fetchJson(path: string): Promise<any> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

// Collapsed by default: these dashboard stat rows used to sit directly above
// the Forschung chat as bare siblings with only a sliver of gap, crowding
// the chat's reading area every time the tab opened. Collapsing them by
// default (remembered per-browser, same pattern as the sidebar) lets the
// chat read as a clean, focused REPL — the numbers are still one click away,
// not removed.
function loadLiveCardsCollapsed(): boolean {
  try { return localStorage.getItem('rfi_live_cards_collapsed') !== '0' } catch { return true }
}

export function LiveCards({ refreshSignal, onNavigate }: { refreshSignal: number; onNavigate: (s: AdminSection) => void }) {
  const [values, setValues] = useState<Partial<Record<AdminSection, string>>>({})
  const [collapsed, setCollapsed] = useState(loadLiveCardsCollapsed)

  const toggleCollapsed = () => {
    setCollapsed(c => {
      const next = !c
      try { localStorage.setItem('rfi_live_cards_collapsed', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [humanAi, signals, information, behavior, research, liveStats, notes, docs, agentActivityCount, snapshotsTotal] = await Promise.all([
        fetchJson('/api/observatory/human-ai'),
        // Still the plain (now-paginated-but-default-unchanged) call — only
        // used below for distinctScopes, which needs the actual signal rows,
        // not just a count. Its own count is no longer used for the
        // "emergence" tile (see liveStats below), so this staying capped at
        // the same old default page is not a new limitation.
        fetchJson('/api/observatory/emergence/signals'),
        fetchJson('/api/observatory/information'),
        fetchJson('/api/observatory/behavior'),
        fetchJson('/api/research/items'),
        // Bare aggregate counts (see backend/src/public.rs) — reused here
        // instead of `signals.length`/`runs.length` because those two list
        // endpoints are now paginated (see backend/src/emergence.rs and
        // simulation.rs): the response body alone would only ever report
        // the current page size, not the true total, once either table
        // grows past its default page.
        fetchJson('/api/public/live-stats'),
        fetchJson('/api/research/items?category=paper,hypothesis,idea,concept,framework,prototype'),
        fetchJson('/api/chat/documents'),
        // agent-activity has no pagination (see github_activity.rs — a
        // capped merged feed, not a table with a real total), so page
        // length genuinely is the count here, same as research/knowledgegraph
        // above. snapshots IS paginated (X-Total-Count), so this reads the
        // real total rather than however many happen to be on the first page.
        fetchTotalCount('/api/observatory/agent-activity'),
        fetchTotalCount('/api/observatory/snapshots?limit=1'),
      ])
      if (cancelled) return
      const toolTotal = Array.isArray(behavior?.tool_distribution)
        ? behavior.tool_distribution.reduce((sum: number, b: any) => sum + (b.count ?? 0), 0)
        : 0
      // systemstate must agree with what SystemState.tsx itself actually
      // shows (distinct systems/scopes tracked via emergence_signals) — it
      // previously sourced from technical diagnostics.db_reachable, which
      // silently disagreed with the page's own content. Fixed here.
      const distinctScopes = Array.isArray(signals)
        ? new Set(signals.map((s: any) => s.scope ?? 'Allgemein')).size
        : 0
      setValues({
        emergence: typeof liveStats?.emergence_signals === 'number' ? String(liveStats.emergence_signals) : (Array.isArray(signals) ? String(signals.length) : '—'),
        simulationcenter: typeof liveStats?.simulation_runs === 'number' ? String(liveStats.simulation_runs) : '—',
        research: Array.isArray(research) ? String(research.length) : '—',
        knowledgegraph: (Array.isArray(notes) ? notes.length : 0) + (Array.isArray(docs) ? docs.length : 0) > 0
          ? String((Array.isArray(notes) ? notes.length : 0) + (Array.isArray(docs) ? docs.length : 0))
          : '—',
        systemmap: humanAi ? String((humanAi.user_messages ?? 0) + (humanAi.assistant_messages ?? 0)) : '—',
        systemstate: String(distinctScopes),
        agentactivity: typeof agentActivityCount === 'number' ? String(agentActivityCount) : '—',
        flugschreiber: typeof snapshotsTotal === 'number' ? String(snapshotsTotal) : '—',
        interaction: typeof humanAi?.mean_token_confidence === 'number' ? `${Math.round(humanAi.mean_token_confidence * 100)}%` : '—',
        behavior: String(toolTotal),
        information: information ? String(information.chunks) : '—',
      })
    })()
    return () => { cancelled = true }
  }, [refreshSignal])

  const row = (tier: ObservatoryTier) => MODULE_META.filter(m => m.tier === tier)

  return (
    <div className={`live-cards-panel ${collapsed ? 'collapsed' : ''}`}>
      <button type="button" className="live-cards-panel-toggle" onClick={toggleCollapsed} aria-expanded={!collapsed}>
        <span className="live-cards-panel-chevron">{collapsed ? '▸' : '▾'}</span>
        Observatory-Kennzahlen
        {collapsed && <span className="live-cards-panel-hint">einblenden</span>}
      </button>
      {!collapsed && (
        <div className="live-cards-tiered">
          <div className="live-cards live-cards-research">
            {row('research').map(m => (
              <button key={m.id} className="live-card" style={{ ['--obs-accent' as string]: m.accent }} onClick={() => onNavigate(m.id)} title="Granulare Analyse öffnen">
                <span className="live-card-value">{values[m.id] ?? '…'}</span>
                <span className="live-card-label">{m.label}</span>
              </button>
            ))}
          </div>
          <div className="live-cards live-cards-system">
            {row('system').map(m => (
              <button key={m.id} className="live-card live-card-secondary" style={{ ['--obs-accent' as string]: m.accent }} onClick={() => onNavigate(m.id)} title="Granulare Analyse öffnen">
                <span className="live-card-value">{values[m.id] ?? '…'}</span>
                <span className="live-card-label">{m.label}</span>
              </button>
            ))}
          </div>
          <div className="live-cards live-cards-technical">
            {row('technical').map(m => (
              <button key={m.id} className="live-card live-card-technical" style={{ ['--obs-accent' as string]: m.accent }} onClick={() => onNavigate(m.id)} title="Granulare Analyse öffnen">
                <span className="live-card-value">{values[m.id] ?? '…'}</span>
                <span className="live-card-label">{m.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
