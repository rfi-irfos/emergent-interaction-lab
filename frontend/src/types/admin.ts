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
  // Anomalie-Log — Anomaly Watchdog v1 review surface (see
  // backend/src/anomaly.rs). Systemebene, not Forschungsebene: it's a
  // system-health/safety signal about JARVIS ITSELF (tool failures, the
  // tool-calling loop hitting its own round cap, the refusal instruction
  // firing, a reused hallucination-tracker mismatch), never a research
  // observable about Laura's own work — see registry.tsx's own placement
  // comment for the full reasoning.
  | 'anomalies'
