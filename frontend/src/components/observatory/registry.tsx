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

// The Observatory, reframed: 7 emergence concepts, not a 10-module CMS
// dashboard. System Overview (business KPIs) moved to Verwaltung → Analytics.
// System Diagnostics, Simulation Lab, Research Workspace and Innovation Lab
// are no longer separate nav items — folded into System State / Research
// Pulse. See the plan for the full disposition table.
export const OBSERVATORY_MODULES: ObservatoryModuleDef[] = [
  { id: 'systemmap', label: 'System Map', icon: I(<><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="12" cy="18" r="3" /><line x1="8.5" y1="7.5" x2="15.5" y2="16" /><line x1="15.5" y1="7.5" x2="8.5" y2="16" /></>) },
  { id: 'emergence', label: 'Emergence Monitor', icon: I(<><path d="M3 17c2-6 4-9 6-9s3 8 6 8 3-9 6-9" /></>) },
  { id: 'systemstate', label: 'System State', icon: I(<><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /><circle cx="12" cy="12" r="6" /></>) },
  { id: 'interaction', label: 'Interaction Dynamics', icon: I(<><circle cx="9" cy="9" r="3" /><circle cx="17" cy="15" r="3" /><path d="M11 10.5 15 13.5" /></>) },
  { id: 'information', label: 'Information Dynamics', icon: I(<><circle cx="12" cy="12" r="3" /><path d="M12 3v6M12 15v6M3 12h6M15 12h6" /></>) },
  { id: 'behavior', label: 'Behavioral Landscape', icon: I(<><path d="M3 3v18h18" /><path d="M7 15l4-6 4 3 5-8" /></>) },
  { id: 'research', label: 'Research Pulse', icon: I(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>) },
]

export const SECTION_LABELS: Record<AdminSection, string> = {
  inbox: 'Inbox',
  forschung: 'Forschung',
  blog: 'Blog',
  analytics: 'Analytics',
  'website-kit': 'Website Kit',
  systemmap: 'System Map',
  emergence: 'Emergence Monitor',
  systemstate: 'System State',
  interaction: 'Interaction Dynamics',
  information: 'Information Dynamics',
  behavior: 'Behavioral Landscape',
  research: 'Research Pulse',
}
