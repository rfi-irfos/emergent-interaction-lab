// Shared between AdminPanel.tsx and the Observatory module registry so
// neither has to import the other just for this one type.
//
// Verwaltung = business/admin (website content, comms, business KPIs).
// Observatory = emergence signals only — 7 concepts, not a CMS dashboard.
// 'website-kit' is the website builder, folded in as one more sidebar app
// rather than a separate top-level mode.
export type AdminSection =
  | 'inbox' | 'forschung' | 'blog' | 'analytics' | 'website-kit' | 'monetization'
  | 'systemmap' | 'emergence' | 'systemstate' | 'interaction' | 'information' | 'behavior' | 'research'
  | 'simulationcenter' | 'knowledgegraph' | 'agentactivity' | 'flugschreiber' | 'gesamtuebersicht' | 'denkfragmente'
