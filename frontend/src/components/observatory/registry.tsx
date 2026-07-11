import type { AdminSection } from '../../types/admin'

// Icons kept tiny and inline, matching the existing crm-nav-item convention
// in AdminPanel.tsx (Inbox/Forschung/Blog/Analytics use the same style).
function I(paths: React.ReactNode) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{paths}</svg>
}

// Three genuinely different kinds of information, not one flat list: a
// research observable (Emergenz) must never read with the same weight as a
// technical figure (Embedding-Chunk count) — see the plan for the full
// reasoning. Tiers drive both the sidebar grouping and LiveCards' rows.
export type ObservatoryTier = 'research' | 'system' | 'technical'

export const TIER_LABELS: Record<ObservatoryTier, string> = {
  research: 'Forschungsebene',
  system: 'Systemebene',
  technical: 'Technische Ebene',
}

export interface ObservatoryModuleDef {
  id: AdminSection
  label: string
  icon: React.ReactNode
  tier: ObservatoryTier
}

// The Observatory, reframed: emergence concepts grouped into 3 tiers, not a
// flat CMS-style module list. System Overview (business KPIs) moved to
// Verwaltung → Analytics. System Diagnostics is folded into System State's
// footer (deliberately de-emphasized, "ganz unten, nicht prominent").
export const OBSERVATORY_MODULES: ObservatoryModuleDef[] = [
  { id: 'emergence', label: 'Emergence Monitor', tier: 'research', icon: I(<><path d="M3 17c2-6 4-9 6-9s3 8 6 8 3-9 6-9" /></>) },
  { id: 'simulationcenter', label: 'Simulation Center', tier: 'research', icon: I(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>) },
  { id: 'research', label: 'Research Pulse', tier: 'research', icon: I(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>) },
  { id: 'knowledgegraph', label: 'Knowledge Graph', tier: 'research', icon: I(<><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="18" r="2.5" /><circle cx="12" cy="12" r="2.5" /><line x1="8" y1="7.5" x2="10.2" y2="10.2" /><line x1="16" y1="7.5" x2="13.8" y2="10.2" /><line x1="8" y1="16.5" x2="10.2" y2="13.8" /><line x1="16" y1="16.5" x2="13.8" y2="13.8" /></>) },
  { id: 'systemmap', label: 'System Map', tier: 'system', icon: I(<><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="12" cy="18" r="3" /><line x1="8.5" y1="7.5" x2="15.5" y2="16" /><line x1="15.5" y1="7.5" x2="8.5" y2="16" /></>) },
  { id: 'systemstate', label: 'System State', tier: 'system', icon: I(<><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /><circle cx="12" cy="12" r="6" /></>) },
  { id: 'agentactivity', label: 'Agent-Aktivität', tier: 'system', icon: I(<><path d="M9 18l-6-6 6-6M15 6l6 6-6 6" /></>) },
  // Flugschreiber (flight recorder) — a typed, whole-system rollup captured
  // after every chat turn (see backend/src/observatory.rs's
  // capture_system_snapshot), scrubbable back through history. German label,
  // same convention as "Agent-Aktivität"/"Forschung"/"Monetarisierung"
  // elsewhere in this registry: used where the German term is the natural,
  // evocative one rather than an awkward English calque. Systemebene: this
  // is squarely "Systemzustand über die Zeit" (see the SYSTEM_PROMPT's own
  // 3-tier description in chat.rs) — a longitudinal view of overall system
  // state, not a research observable or a technical/platform-health figure.
  { id: 'flugschreiber', label: 'Flugschreiber', tier: 'system', icon: I(<><rect x="4" y="8" width="16" height="10" rx="2" /><circle cx="9" cy="13" r="1.4" /><circle cx="15" cy="13" r="1.4" /><path d="M12 8V4M9 4h6" /></>) },
  // "Everything about me" — one holistic rollup across every table this
  // platform has captured about Laura's research activity (chat, emergence
  // signals, research notes, CCET, simulation runs, the flight recorder,
  // Jarvis tool calls), see backend/src/observatory.rs's `everything`
  // handler. Systemebene, not Forschungsebene or Technische Ebene: this
  // deliberately spans all three tiers at once (it includes real research
  // observables AND technical figures), so it doesn't natively belong to
  // either — the same reasoning Flugschreiber's own placement above already
  // uses for the closest existing case (also a cross-cutting rollup of
  // signals + CCET + sims + notes + tool-calls into one longitudinal view),
  // just widened from "over time" to "across every source at once."
  { id: 'gesamtuebersicht', label: 'Gesamtübersicht', tier: 'system', icon: I(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>) },
  { id: 'interaction', label: 'Interaction Dynamics', tier: 'system', icon: I(<><circle cx="9" cy="9" r="3" /><circle cx="17" cy="15" r="3" /><path d="M11 10.5 15 13.5" /></>) },
  { id: 'behavior', label: 'Behavioral Landscape', tier: 'system', icon: I(<><path d="M3 3v18h18" /><path d="M7 15l4-6 4 3 5-8" /></>) },
  { id: 'information', label: 'Information Dynamics', tier: 'technical', icon: I(<><circle cx="12" cy="12" r="3" /><path d="M12 3v6M12 15v6M3 12h6M15 12h6" /></>) },
]

export function groupByTier(modules: ObservatoryModuleDef[] = OBSERVATORY_MODULES): Record<ObservatoryTier, ObservatoryModuleDef[]> {
  return {
    research: modules.filter(m => m.tier === 'research'),
    system: modules.filter(m => m.tier === 'system'),
    technical: modules.filter(m => m.tier === 'technical'),
  }
}

export const SECTION_LABELS: Record<AdminSection, string> = {
  inbox: 'Inbox',
  forschung: 'Forschung',
  blog: 'Blog',
  analytics: 'Analytics',
  'website-kit': 'Website Kit',
  monetization: 'Monetarisierung',
  systemmap: 'System Map',
  emergence: 'Emergence Monitor',
  systemstate: 'System State',
  interaction: 'Interaction Dynamics',
  information: 'Information Dynamics',
  behavior: 'Behavioral Landscape',
  research: 'Research Pulse',
  simulationcenter: 'Simulation Center',
  knowledgegraph: 'Knowledge Graph',
  agentactivity: 'Agent-Aktivität',
  flugschreiber: 'Flugschreiber',
  gesamtuebersicht: 'Gesamtübersicht',
}
