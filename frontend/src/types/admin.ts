// Shared between AdminPanel.tsx and the Observatory module registry so
// neither has to import the other just for this one type.
export type AdminSection =
  | 'inbox' | 'forschung' | 'blog' | 'analytics'
  | 'overview' | 'systemmap' | 'emergence' | 'behavior' | 'information'
  | 'humanai' | 'diagnostics' | 'simulation' | 'research' | 'innovation'
