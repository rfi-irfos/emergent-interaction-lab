/// Every place a raw backend value (a status, category, or event type) gets
/// shown directly to Laura instead of a plain German word — one shared
/// module instead of each app inventing (or forgetting) its own label map.
/// Convention: `Record<string,string>`, looked up with `MAP[raw] ?? raw` so
/// an unmapped future value still shows *something* instead of breaking.

export const INBOX_STATUS_LABELS: Record<string, string> = {
  new: 'Neu',
  replied: 'Beantwortet',
  done: 'Erledigt',
}

export const BLOG_STATUS_LABELS: Record<string, string> = {
  draft: 'Entwurf',
  published: 'Veröffentlicht',
}

export const RESEARCH_NOTE_STATUS_LABELS: Record<string, string> = {
  active: 'Aktiv',
  archived: 'Archiviert',
}

export const SIMULATION_STATUS_LABELS: Record<string, string> = {
  pending: 'Ausstehend',
  complete: 'Abgeschlossen',
  error: 'Fehler',
}

/// German label for every entry in Changelog.tsx's KNOWN_EVENT_TYPES —
/// keep this list in sync if a new auditlog::record() call site is added
/// server-side.
export const EVENT_TYPE_LABELS: Record<string, string> = {
  admin_login: 'Anmeldung',
  anomaly_detected: 'Anomalie erkannt',
  blog_post_deleted: 'Blogbeitrag gelöscht',
  blog_published: 'Blogbeitrag veröffentlicht',
  chat_conversation_deleted: 'Gespräch gelöscht',
  content_updated: 'Website-Inhalt geändert',
  dashboard_deleted: 'Dashboard gelöscht',
  hallucination_mismatch: 'Falschbehauptung erkannt',
  order_recorded: 'Bestellung erfasst',
  product_created: 'Produkt angelegt',
  research_item_deleted: 'Research-Eintrag gelöscht',
  simulation_run_deleted: 'Simulation gelöscht',
}

export const RESEARCH_CATEGORY_LABELS: Record<string, string> = {
  paper: 'Paper',
  hypothesis: 'Hypothese',
  idea: 'Idee',
  concept: 'Konzept',
  framework: 'Framework',
  prototype: 'Prototyp',
}

/// The human/ai/interaction/system 4-value concept — Gesamtübersicht's
/// donut, Flugschreiber's stat labels, and (after the Stage 2 copy pass)
/// anywhere else this same concept is rendered, all read from here instead
/// of three different label conventions.
export const SYSTEM_SIGNAL_LABELS: Record<string, string> = {
  human: 'Mensch',
  ai: 'KI',
  interaction: 'Interaktion',
  system: 'System',
}

/// SystemMap's own, DIFFERENT 5-node taxonomy — not the same concept as
/// SYSTEM_SIGNAL_LABELS above, do not merge the two.
export const SYSTEM_MAP_NODE_LABELS: Record<string, string> = {
  human: 'Mensch',
  ai_systems: 'KI-Systeme',
  organization: 'Organisation',
  technology: 'Technologie',
  information_dynamics: 'Informationsdynamik',
}

/// Colocated here (moved from AgentActivity.tsx, unchanged) so every raw-
/// value label map in the app lives in one place.
export const AGENT_ACTIVITY_KIND_LABELS: Record<string, string> = {
  pull_request: 'Pull Request',
  commit: 'Commit',
  workflow_run: 'Workflow',
  deploy: 'Deploy',
}
