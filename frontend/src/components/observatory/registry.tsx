import type { AdminSection } from '../../types/admin'

// Icons kept tiny and inline, matching the existing crm-nav-item convention
// in AdminPanel.tsx (Inbox/Forschung/Blog/Analytics use the same style).
function I(paths: React.ReactNode) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{paths}</svg>
}

export interface ObservatoryModuleDef {
  id: AdminSection
  label: string
  icon: React.ReactNode
}

// Only the 10 net-new modules — the existing 4 Verwaltung sections
// (Inbox/Forschung/Blog/Analytics) keep their own hand-written sidebar
// buttons in AdminPanel.tsx, unchanged. See plan §"Frontend — admin
// Observatory": this registry exists to stop the jump from 4 to 14 sections
// from requiring 10 more hand-written ternary branches, not to replace the
// working pattern for the original 4.
export const OBSERVATORY_MODULES: ObservatoryModuleDef[] = [
  { id: 'overview', label: 'System Overview', icon: I(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>) },
  { id: 'systemmap', label: 'System Map', icon: I(<><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="12" cy="18" r="3" /><line x1="8.5" y1="7.5" x2="15.5" y2="16" /><line x1="15.5" y1="7.5" x2="8.5" y2="16" /></>) },
  { id: 'emergence', label: 'Emergence Monitor', icon: I(<><path d="M3 17c2-6 4-9 6-9s3 8 6 8 3-9 6-9" /></>) },
  { id: 'behavior', label: 'Behavioral Observatory', icon: I(<><path d="M3 3v18h18" /><path d="M7 15l4-6 4 3 5-8" /></>) },
  { id: 'information', label: 'Information Dynamics', icon: I(<><circle cx="12" cy="12" r="3" /><path d="M12 3v6M12 15v6M3 12h6M15 12h6" /></>) },
  { id: 'humanai', label: 'Human–AI Interaction', icon: I(<><circle cx="9" cy="9" r="3" /><circle cx="17" cy="15" r="3" /><path d="M11 10.5 15 13.5" /></>) },
  { id: 'diagnostics', label: 'System Diagnostics', icon: I(<><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /><circle cx="12" cy="12" r="6" /></>) },
  { id: 'simulation', label: 'Simulation Lab', icon: I(<><path d="M9 3v18M15 3v18M3 9h18M3 15h18" /></>) },
  { id: 'research', label: 'Research Workspace', icon: I(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>) },
  { id: 'innovation', label: 'Innovation Lab', icon: I(<><path d="M9 18h6M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z" /></>) },
]

export const SECTION_LABELS: Record<AdminSection, string> = {
  inbox: 'Inbox',
  forschung: 'Forschung',
  blog: 'Blog',
  analytics: 'Analytics',
  overview: 'System Overview',
  systemmap: 'System Map',
  emergence: 'Emergence Monitor',
  behavior: 'Behavioral Observatory',
  information: 'Information Dynamics',
  humanai: 'Human–AI Interaction',
  diagnostics: 'System Diagnostics',
  simulation: 'Simulation Lab',
  research: 'Research Workspace',
  innovation: 'Innovation Lab',
}
