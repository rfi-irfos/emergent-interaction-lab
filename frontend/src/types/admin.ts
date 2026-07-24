// Shared between AdminPanel.tsx and the Observatory module registry so
// neither has to import the other just for this one type.
//
// Verwaltung = business/admin (website content, comms, business KPIs).
// Observatory = emergence signals only — 7 concepts, not a CMS dashboard.
// 'website-kit' is the website builder, folded in as one more sidebar app
// rather than a separate top-level mode.
export type AdminSection =
  | 'inbox' | 'forschung' | 'blog' | 'analytics' | 'website-kit' | 'monetization'
  // 'systemmap' now hosts the merged "Knowledge & System Map" app
  // (KnowledgeSystemMap.tsx toggles between the two former separate views) —
  // the old standalone 'knowledgegraph' section id was retired with it.
  // 'interaction' now hosts the merged "Interaction+Information Dynamics"
  // app (InteractionInformationDynamics.tsx toggles between the two former
  // separate views) — the old standalone 'information' section id was
  // retired with it.
  | 'systemmap' | 'emergence' | 'systemstate' | 'interaction' | 'behavior' | 'research'
  // 'gesamtuebersicht' as a standalone section id was retired — it's now a
  // second tab inside 'analytics' (Analytics.tsx), not its own sidebar app.
  | 'simulationcenter' | 'agentactivity' | 'flugschreiber' | 'denkfragmente'
  // Anomalie-Log — Anomaly Watchdog v1 review surface (see
  // backend/src/anomaly.rs). Systemebene, not Forschungsebene: it's a
  // system-health/safety signal about JARVIS ITSELF (tool failures, the
  // tool-calling loop hitting its own round cap, the refusal instruction
  // firing, a reused hallucination-tracker mismatch), never a research
  // observable about Laura's own work — see registry.tsx's own placement
  // comment for the full reasoning.
  | 'anomalies'
  // Forschungspipeline — the 5-stage research methodik (Interaction
  // Observation → Behavior Analysis → Framework Extraction → Emergent
  // System Design → Implementation/Handover). A single orchestrating
  // overview that walks the pipeline with live data wired into each stage
  // and deep-links into the module that owns the detail. Not a 6th tier —
  // it sits beside the other top-level apps.
  | 'forschungspipeline'
  // Changelog — the full, standalone hash-chained audit_log surface (see
  // backend/src/auditlog.rs + components/observatory/Changelog.tsx).
  // Verwaltung-tier, same category as Analytics/Monetarisierung,
  // deliberately NOT nested under
  // Observatory's research/system/technical taxonomy: every row here is an
  // operational/business record (a content edit, a login, a Stripe order,
  // a deletion) about the PLATFORM ITSELF, never a research observable
  // about Laura's own work or a system-health signal about Jarvis's
  // behavior — a different axis entirely from what OBSERVATORY_MODULES
  // groups. The existing sidebar `AuditChangelog.tsx` widget (last 8
  // entries + a chain-intact dot) stays exactly as-is; this is a genuinely
  // separate, more complete surface, not a replacement.
  | 'changelog'
  // Ameisenhaufen — Laura's own nickname for the coevolution-factory
  // 50-center compliance/risk agent fleet (a separate Fly app, built on the
  // lauras-agents engine). Proxied read-only into EIL so she can see her own
  // agents at work without leaving this tool (see backend/src/coevolution.rs).
  | 'ameisenhaufen'
