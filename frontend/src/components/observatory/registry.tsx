import type { AdminSection } from '../../types/admin'

// Shared status → color map for emergence signals. Defined once here (not
// per-module) because EmergenceMonitor, SimulationCenter, InteractionDynamics
// and the Intrachat loop all need the same status hues.
export const STATUS_ACCENT: Record<string, string> = {
  emerging: '#f59e0b', stable: '#10b981', fading: '#6b7280', hypothetical: '#8b5cf6',
}

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
  // Denkfragmente — per-conversation 8-Layer-Model timeline + the aggregate
  // layer distribution across all conversations (see backend/src/
  // thinking_fragments.rs). Forschungsebene, NOT Systemebene where
  // Flugschreiber/Gesamtübersicht landed: those two are deliberately
  // cross-cutting system rollups (Flugschreiber = "Systemzustand über die
  // Zeit", Gesamtübersicht = every table at once) that read as "how is the
  // observed system doing," per SYSTEM_PROMPT's own 3-tier split in
  // chat.rs. This module is the opposite case: it is a direct research
  // observable about LAURA'S OWN THINKING (which of her own IEIA-2025
  // layers a turn belongs to) — squarely the same "what is being
  // researched" bucket Emergence Monitor/Research Pulse/Knowledge Graph
  // already sit in, not a rollup of the platform's own operational state.
  { id: 'denkfragmente', label: 'Denkfragmente', tier: 'research', icon: I(<><rect x="3" y="10" width="4" height="7" rx="1.2" /><rect x="9" y="6" width="4" height="11" rx="1.2" /><rect x="15" y="3" width="4" height="14" rx="1.2" /></>) },
  // Knowledge Graph and System Map merged into one app (KnowledgeSystemMap.tsx,
  // in-panel toggle) — both were force-graph views over this platform's own
  // records, neither big enough to earn a separate top-level slot.
  { id: 'systemmap', label: 'Knowledge & System Map', tier: 'system', icon: I(<><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="12" cy="18" r="3" /><line x1="8.5" y1="7.5" x2="15.5" y2="16" /><line x1="15.5" y1="7.5" x2="8.5" y2="16" /></>) },
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
  // Gesamtübersicht moved out of the Observatory entirely, per feedback —
  // it now lives as a second tab inside Verwaltung → Analytics
  // (Analytics.tsx), not as its own sidebar app. See Analytics.tsx's own
  // doc comment for the rationale.
  // Anomalie-Log — Anomaly Watchdog v1 (see backend/src/anomaly.rs): four
  // concrete, mechanical trip-wires logged after every chat turn (a tool
  // call failing, the tool-calling loop hitting its own round cap, the new
  // refusal instruction in chat::SYSTEM_PROMPT firing per a keyword
  // heuristic, a hallucination-tracker 'mismatch' verdict reused as-is).
  // Systemebene, NOT Forschungsebene or Technische Ebene: this is squarely
  // "wie es den beobachteten Systemen geht" per SYSTEM_PROMPT's own 3-tier
  // description in chat.rs — it watches JARVIS ITSELF (a system-health/
  // safety signal), not Laura's research (that's the research tier) and not
  // raw platform-mechanics figures like embedding-chunk counts (that's the
  // technical tier). Same bucket Flugschreiber/Gesamtübersicht/Agent-
  // Aktivität already sit in — all four are "how is the system doing,"
  // never a research observable.
  { id: 'anomalies', label: 'Anomalie-Log', tier: 'system', icon: I(<><path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4z" /><line x1="12" y1="8" x2="12" y2="13" /><circle cx="12" cy="16.3" r="0.9" fill="currentColor" stroke="none" /></>) },
  // Interaction Dynamics + Information Dynamics merged into one app
  // (InteractionInformationDynamics.tsx, in-panel toggle) — same treatment
  // as Knowledge & System Map above. 'system' tier kept (Interaction
  // Dynamics' original tier) rather than 'technical' (Information
  // Dynamics' original tier): the merged view leads with Interaction's
  // human/AI framing, so it reads first as a system-level observable.
  { id: 'interaction', label: 'Interaction+Information Dynamics', tier: 'system', icon: I(<><circle cx="9" cy="9" r="3" /><circle cx="17" cy="15" r="3" /><path d="M11 10.5 15 13.5" /></>) },
  { id: 'behavior', label: 'Behavioral Landscape', tier: 'system', icon: I(<><path d="M3 3v18h18" /><path d="M7 15l4-6 4 3 5-8" /></>) },
]

export function groupByTier(modules: ObservatoryModuleDef[] = OBSERVATORY_MODULES): Record<ObservatoryTier, ObservatoryModuleDef[]> {
  return {
    research: modules.filter(m => m.tier === 'research'),
    system: modules.filter(m => m.tier === 'system'),
    technical: modules.filter(m => m.tier === 'technical'),
  }
}

/// One line per app: "{title}: {description}", rendered once in the shared
/// top bar (AdminPanel.tsx) instead of a second/third title further down in
/// each panel — see HudSectionHeader call sites, which should carry
/// `actions` only (no `title`/`sub`) once they read from here.
///
/// `description` copy below is placeholder/structural — it needs to be
/// replaced with Laura's own voice before this ships. Kept short (one
/// sentence, no jargon) to match the target shape.
export interface SectionCopy { title: string; description: string }

export const SECTION_COPY: Record<AdminSection, SectionCopy> = {
  inbox: { title: 'Inbox', description: 'Nachrichten, die über die Website reinkommen.' },
  forschung: { title: 'Forschung', description: 'Der Jarvis-Chat — hier arbeitest du direkt mit ihm.' },
  blog: { title: 'Blog', description: 'Beiträge schreiben, bearbeiten, veröffentlichen.' },
  analytics: { title: 'Analytics', description: 'Was auf der Website passiert, und die Plattform im Überblick.' },
  'website-kit': { title: 'Website Kit', description: 'Texte, Bilder und Seiten der Website bearbeiten.' },
  monetization: { title: 'Monetarisierung', description: 'Produkte, Bestellungen, Umsatz.' },
  systemmap: { title: 'Knowledge & System Map', description: 'Wie Wissen und Systeme hier miteinander verknüpft sind.' },
  emergence: { title: 'Emergence Monitor', description: 'Emergenz-Signale aus der Mensch-KI-Ko-Evolution.' },
  systemstate: { title: 'System State', description: 'Beobachtete Systeme und ihr aktueller Zustand.' },
  interaction: { title: 'Interaction+Information Dynamics', description: 'Wie sich Gespräche und Wissen über Zeit entwickeln.' },
  behavior: { title: 'Behavioral Landscape', description: 'Verhaltensmuster im Zeitverlauf.' },
  research: { title: 'Research Pulse', description: 'Papers, Hypothesen, Ideen — der Forschungsfluss.' },
  simulationcenter: { title: 'Simulation Center', description: 'Simulationsläufe und ihre Ergebnisse.' },
  agentactivity: { title: 'Agent-Aktivität', description: 'Was das Entwicklungsteam gerade baut.' },
  flugschreiber: { title: 'Flugschreiber', description: 'Der Systemzustand über die Zeit, Schnappschuss für Schnappschuss.' },
  denkfragmente: { title: 'Denkfragmente', description: 'Deine eigenen Gedanken, eingeordnet nach dem 8-Layer-Modell.' },
  anomalies: { title: 'Anomalie-Log', description: 'Auffälligkeiten, die Jarvis selbst gemeldet hat.' },
  forschungspipeline: { title: 'Forschungspipeline', description: '' },
  changelog: { title: 'Changelog', description: 'Jede Änderung am Lab — nachvollziehbar, mit Kettensignatur.' },
}

/** @deprecated use `SECTION_COPY[x].title` — kept only until every consumer migrates. */
export const SECTION_LABELS: Record<AdminSection, string> = Object.fromEntries(
  Object.entries(SECTION_COPY).map(([k, v]) => [k, v.title])
) as Record<AdminSection, string>
