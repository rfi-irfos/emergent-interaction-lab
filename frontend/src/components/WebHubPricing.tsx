import { useEffect, useState } from 'react'
import { API_BASE } from '../lib/apiBase'
import { useLang } from '../hooks/useLang'

// The real WebHub service ladder — Laura's own product line, sold through
// real Stripe Payment Links (see backend/src/billing.rs's
// seed_webhub_products). Deliberately separate from `.site-pcard` /
// content.products (unrelated portfolio catalog) and from
// CertificationPage. Rendered directly on the main site as a tight card
// wall + themed modal: the card shows only name + price + a basket link +
// a "more" button; the modal carries the single-language narrative for
// whichever language the site is currently in (see DETAIL below) so the
// ladder reads as ONE method scoped to layers (Intake → Cluster → Derive
// → Reconstruct → Design → Build → Operate) — never "mysterious option A
// vs Z".
interface PublicProduct {
  name: string
  description: string
  description_de: string | null
  price_cents: number
  currency: string
  mode: string
  recurring_interval: string | null
  payment_link_url: string
  category: string
}

function formatPrice(cents: number, currency: string, lang: 'en' | 'de'): string {
  return new Intl.NumberFormat(lang === 'de' ? 'de-AT' : 'en-IE', {
    style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0,
  }).format(cents / 100)
}

// Core offer — called out visually; if renamed/removed upstream it simply
// stops matching and no card gets the badge. Nothing breaks.
const FLAGSHIP_NAME = 'Emergent Case Intelligence Sprint'

// (no bestseller highlight — pricing is not a sales funnel)

// Minimalist inline SVGs — never emojis.
const BASKET = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 9h14l-1.2 10.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8L5 9z" />
    <path d="M9 9 10.5 4" /><path d="M15 9 13.5 4" />
    <path d="M9.5 13v3" /><path d="M14.5 13v3" />
  </svg>
)
const PLUS = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)
const CROSS = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

// Phase chip + single-language-at-a-time narrative, keyed by product name.
// Deliberately outcome-only: what changes for the client / what they get,
// never the internal mechanism (no "how it's built" language) — a client
// buys a result, not a methodology explainer. Falls back to the backend
// `description`/`description_de` if a name isn't listed. `phase` is the
// ladder position — it makes the interdisciplinary arc explicit so no one
// wonders where a tier sits.
//
// Each tier carries a one-line `tagline` (the actual value proposition -
// why THIS tier over its neighbors, not a restatement of the DB
// description) plus 3-4 concrete `points` (what you get, specific enough
// to picture the deliverable). Rewritten 2026-07-13 per Laura/Simeon
// feedback: the old shape was one polished sentence per tier, all built on
// the same "X, not Y" template - technically fine, read as generic and
// interchangeable across 20+ modals. This shape forces real, differentiated
// substance per tier instead of one more clever line.
interface DetailLang { tagline: string; points: string[] }
const DETAIL: Record<string, { phase: string; en: DetailLang; de: DetailLang }> = {
  'Case Intake Scan': {
    phase: 'Intake',
    en: {
      tagline: 'A same-week read on where your case actually stands, before you commit to anything bigger.',
      points: [
        'A written case summary in plain terms - not a form to fill in',
        'A rough thematic map of which areas the case actually touches',
        'First defect or contradiction flags, wherever they are already visible',
        'A short, prioritized list of open questions for the next stage',
      ],
    },
    de: {
      tagline: 'Ein Blick, noch in derselben Woche, wo dein Fall wirklich steht - bevor du dich auf etwas Größeres festlegst.',
      points: [
        'Eine schriftliche Fallzusammenfassung in klarer Sprache - kein Formular zum Ausfüllen',
        'Eine grobe Themenzuordnung: welche Bereiche der Fall tatsächlich berührt',
        'Erste Mängel- oder Widerspruchshinweise, wo bereits sichtbar',
        'Eine kurze, priorisierte Liste offener Fragen für die nächste Stufe',
      ],
    },
  },
  'Mangelcluster Sprint': {
    phase: 'Cluster',
    en: {
      tagline: 'Turns a pile of scattered material - documents, notes, half a case file - into one structure you can actually work from.',
      points: [
        'A full defect list, each entry traceable back to its source material',
        'Thematic clusters: which issues actually belong together',
        'Contradictions and gaps named explicitly, not smoothed over',
        'A prioritized next-steps list, not just a longer list of problems',
      ],
    },
    de: {
      tagline: 'Macht aus verstreutem Material - Dokumente, Notizen, eine halbe Akte - eine Struktur, mit der sich tatsächlich arbeiten lässt.',
      points: [
        'Eine vollständige Mängelliste, jeder Eintrag rückverfolgbar zur Quelle',
        'Themencluster: welche Punkte wirklich zusammengehören',
        'Widersprüche und Lücken explizit benannt, nicht geglättet',
        'Eine priorisierte Liste nächster Schritte, keine bloß längere Problemliste',
      ],
    },
  },
  'Market & Competitor Intelligence': {
    phase: 'Market',
    en: {
      tagline: "The same observational method run on your case, aimed outward at your market instead.",
      points: [
        'Who else actually operates in your space, and how they are positioned and priced',
        'A structured, evidence-based read of the real competitive field - not a template SWOT',
        'The gaps and openings that are actually worth acting on',
        'A map, not a report you file away',
      ],
    },
    de: {
      tagline: 'Dieselbe beobachtende Methode, die auf einen Fall angewendet wird - hier nach außen auf deinen Markt gerichtet.',
      points: [
        'Wer sonst tatsächlich in deinem Feld agiert, wie positioniert und bepreist',
        'Eine strukturierte, evidenzbasierte Lesart des echten Wettbewerbsfelds - kein Template-SWOT',
        'Die Lücken und Chancen, die es wirklich wert sind, verfolgt zu werden',
        'Eine Landkarte, kein Bericht zum Abheften',
      ],
    },
  },
  'Framework Magnification': {
    phase: 'Derive',
    en: {
      tagline: "Makes the rules you're already operating by explicit, so you can use them on purpose instead of by accident.",
      points: [
        'The implicit frameworks, terms, and decision logic already running your case, written down',
        'A clear line between what is principle and what is one-off circumstance',
        'The foundation the next-stage agent or system design gets derived from',
      ],
    },
    de: {
      tagline: 'Macht die Regeln, nach denen du schon arbeitest, explizit - damit du sie bewusst nutzt, statt zufällig.',
      points: [
        'Die impliziten Frameworks, Begriffe und Entscheidungslogik deines Falls, schriftlich festgehalten',
        'Eine klare Trennung: was ist Prinzip, was ist Einzelfall',
        'Die Grundlage, aus der sich das nächste Agenten- oder Systemdesign ableitet',
      ],
    },
  },
  'Emergent Case Intelligence Sprint': {
    phase: 'Reconstruct',
    en: {
      tagline: 'The core offer: a complex case rebuilt from the ground up into what it actually is.',
      points: [
        'Full reconstruction from documents, case-file access, or a conversation history',
        'Every defect, contradiction, and gap identified and sourced back to the material',
        'The theme areas that actually structure the case',
        'The logic a framework or agent architecture gets derived from next',
      ],
    },
    de: {
      tagline: 'Das Kernangebot: ein komplexer Fall, von Grund auf rekonstruiert zu dem, was er wirklich ist.',
      points: [
        'Vollständige Rekonstruktion aus Dokumenten, Akteneinsicht oder Interaktionsverlauf',
        'Jeder Mangel, Widerspruch und jede Lücke identifiziert und auf die Quelle zurückgeführt',
        'Die Themenbereiche, die den Fall tatsächlich strukturieren',
        'Die Logik, aus der sich Framework oder Agentenarchitektur als Nächstes ableiten',
      ],
    },
  },
  'Multi-Agent System Design': {
    phase: 'Agent Design',
    en: {
      tagline: 'Turns the case logic into an actual agent-system design - a build-ready spec, not a slide deck.',
      points: [
        'A role model: which agent does what, and where its boundary sits',
        'Runtime logic plus explicit state and memory handling',
        'Audit and drift mechanisms designed in from the start, not bolted on later',
        'Explicit safety and alignment constraints as part of the design itself',
      ],
    },
    de: {
      tagline: 'Übersetzt die Fall-Logik in ein tatsächliches Agentensystem-Design - eine baubare Spezifikation, keine Slide-Deck-Vision.',
      points: [
        'Ein Rollenmodell: welcher Agent macht was, und wo liegt seine Grenze',
        'Runtime-Logik plus explizites State- und Memory-Handling',
        'Audit- und Drift-Mechanismen von Anfang an mitgedacht, nicht nachträglich angeflanscht',
        'Explizite Sicherheits- und Ausrichtungsvorgaben als Teil des Designs selbst',
      ],
    },
  },
  'Implementation Build': {
    phase: 'Build',
    en: {
      tagline: 'The designed system, actually running - not a document waiting for someone else to build it.',
      points: [
        'Automations and workflows wired up end to end',
        'Intake, routing, and the analysis pipeline live',
        'Delivery and monitoring in place from day one',
        'A follow-up plan for the first weeks of real use',
      ],
    },
    de: {
      tagline: 'Das entworfene System, tatsächlich am Laufen - kein Dokument, das auf einen anderen Bauherrn wartet.',
      points: [
        'Automationen und Workflows durchgängig verdrahtet',
        'Intake, Routing und Analysepipeline live',
        'Delivery und Monitoring von Tag eins an im Einsatz',
        'Ein Follow-up-Plan für die ersten Wochen im echten Betrieb',
      ],
    },
  },
  'Retainer / Monitoring': {
    phase: 'Operate',
    en: {
      tagline: "Ongoing care so the system doesn't quietly go stale the month after delivery.",
      points: [
        'New cases handled as they come in, not queued for a future sprint',
        'Regular review and drift checks against what was originally built',
        'Framework updates and system adjustments as the underlying case changes',
        'Continuous oversight - not a one-off handover',
      ],
    },
    de: {
      tagline: 'Laufende Betreuung, damit das System nicht schon im Monat nach der Auslieferung still veraltet.',
      points: [
        'Neue Fälle werden bearbeitet, wenn sie reinkommen - nicht für einen künftigen Sprint aufgeschoben',
        'Regelmäßige Reviews und Drift-Checks gegen das, was ursprünglich gebaut wurde',
        'Framework-Updates und Systemanpassungen, wenn sich der zugrunde liegende Fall ändert',
        'Laufende Aufsicht - keine einmalige Übergabe',
      ],
    },
  },
  'Framework Update': {
    phase: 'Maintain',
    en: {
      tagline: "A focused refresh, not a full re-audit, for when the underlying case has moved but the system hasn't caught up.",
      points: [
        'Updated frameworks and check routines',
        'Agent logic adjusted where the old rules no longer fit',
        'Nothing re-done that is still working',
      ],
    },
    de: {
      tagline: 'Eine gezielte Auffrischung, kein komplettes Re-Audit, wenn sich der Fall weiterentwickelt hat, das System aber nicht.',
      points: [
        'Aktualisierte Frameworks und Prüfroutinen',
        'Angepasste Agentenlogik, wo die alten Regeln nicht mehr passen',
        'Nichts wird neu gemacht, was noch funktioniert',
      ],
    },
  },

  // ── Systemaudit ladder — a separate methodology (system/organisation/
  // product diagnosis, not case reconstruction), see SYSTEMAUDIT_NAMES
  // above for the group split shown on the page.
  'Systemaudit': {
    phase: 'Diagnose',
    en: {
      tagline: 'The core diagnostic: how your system actually behaves in real use, not how the org chart says it should.',
      points: [
        'Diagnosis across system, organisation, process, product, and interaction',
        'Concrete friction points, sourced to where they actually occur',
        "An agent and automation model for what should watch this going forward",
      ],
    },
    de: {
      tagline: 'Die Kerndiagnose: wie sich dein System im echten Betrieb tatsächlich verhält - nicht, wie es das Organigramm vorsieht.',
      points: [
        'Diagnose über System, Organisation, Prozess, Produkt und Interaktion hinweg',
        'Konkrete Reibungspunkte, verortet dort, wo sie tatsächlich auftreten',
        'Ein Agenten- und Automatisierungsmodell für die künftige Überwachung',
      ],
    },
  },
  'Rollenreview': {
    phase: 'Review',
    en: {
      tagline: 'Who actually owns which decision, and where that is unclear or silently double-owned.',
      points: [
        'A role-by-role ownership map, not an org chart re-drawn',
        'Overlaps and gaps named explicitly',
        'Where ambiguity is the actual source of the friction you are feeling',
      ],
    },
    de: {
      tagline: 'Wer trägt welche Entscheidung wirklich - und wo ist das unklar oder doppelt vergeben.',
      points: [
        'Eine Zuständigkeitskarte Rolle für Rolle, kein neu gezeichnetes Organigramm',
        'Überschneidungen und Lücken explizit benannt',
        'Wo genau diese Unklarheit die eigentliche Reibung erzeugt',
      ],
    },
  },
  'Prozessreview': {
    phase: 'Review',
    en: {
      tagline: 'Where a process holds up under real load, and where it stalls at a handoff or an edge case.',
      points: [
        'The process walked end to end against real, not idealized, use',
        'Every handoff point checked for where it actually breaks',
        'Where a decision quietly never gets made, instead of being taken',
      ],
    },
    de: {
      tagline: 'Wo ein Prozess unter echter Last hält - und wo er an einer Übergabe oder einem Randfall stockt.',
      points: [
        'Der Prozess durchgespielt gegen echte, nicht idealisierte Nutzung',
        'Jede Übergabe geprüft, wo sie tatsächlich bricht',
        'Wo eine Entscheidung still nie getroffen wird, statt gefällt zu werden',
      ],
    },
  },
  'Root Level Review': {
    phase: 'Review',
    en: {
      tagline: "The deepest layer: not what's visibly broken, but what the whole system is quietly resting on.",
      points: [
        'Structural, organisational, and interaction foundations examined directly',
        'Where they load-bear versus where they are already failing under the surface',
        'What would have to hold for everything built on top to stay standing',
      ],
    },
    de: {
      tagline: 'Die tiefste Ebene: nicht, was sichtbar kaputt ist, sondern worauf das ganze System still ruht.',
      points: [
        'Strukturelle, organisationelle und interaktionale Grundlagen direkt geprüft',
        'Wo sie tragen - und wo sie bereits unter der Oberfläche versagen',
        'Was halten müsste, damit alles Darüberliegende stehen bleibt',
      ],
    },
  },
  'Schnittstellenreview': {
    phase: 'Review',
    en: {
      tagline: 'Where two systems or teams hand off to each other, and what actually gets lost or misread in that handoff.',
      points: [
        'Every interface between system parts, teams, or tools mapped',
        'The unowned handoffs named explicitly',
        'The assumptions each side makes about the other, made visible',
      ],
    },
    de: {
      tagline: 'Wo zwei Systeme oder Teams übergeben - und was dabei tatsächlich verloren geht oder falsch verstanden wird.',
      points: [
        'Jede Schnittstelle zwischen Systemteilen, Teams oder Tools kartiert',
        'Die unverantworteten Übergaben explizit benannt',
        'Die Annahmen, die jede Seite über die andere trifft, sichtbar gemacht',
      ],
    },
  },
  'Betriebsreview': {
    phase: 'Review',
    en: {
      tagline: 'Whether day-to-day operations can actually be watched and kept alive, not just launched.',
      points: [
        'The operating model checked against real load, not launch-day load',
        'Monitorability assessed: would anyone actually notice a failure starting?',
        'Concrete observability gaps named, not a general impression',
      ],
    },
    de: {
      tagline: 'Ob der laufende Betrieb wirklich beobachtbar und am Leben zu halten ist - nicht nur startklar.',
      points: [
        'Das Betriebsmodell gegen echte Last geprüft, nicht gegen Launch-Tag-Last',
        'Überwachbarkeit bewertet: würde ein beginnendes Versagen überhaupt auffallen?',
        'Konkrete Beobachtungslücken benannt, kein allgemeiner Eindruck',
      ],
    },
  },
  'Organisationsreview': {
    phase: 'Review',
    en: {
      tagline: 'The organisation as a whole: reporting lines, ownership gaps, and handovers that quietly break between teams.',
      points: [
        'The full org structure examined, not one role or process in isolation',
        'Reporting lines and responsibility gaps mapped',
        'Where a bad week would break something a good week quietly hides',
      ],
    },
    de: {
      tagline: 'Die Organisation als Ganzes: Berichtslinien, Zuständigkeitslücken und Übergaben, die zwischen Teams still brechen.',
      points: [
        'Die gesamte Organisationsstruktur geprüft, nicht nur eine Rolle oder ein Prozess isoliert',
        'Berichtslinien und Verantwortungslücken kartiert',
        'Wo eine schlechte Woche bricht, was eine gute Woche still verdeckt',
      ],
    },
  },
  'Produktreview': {
    phase: 'Review',
    en: {
      tagline: "Where the product's actual usage logic creates friction a user has to work around.",
      points: [
        'Real usage logic reconstructed from how the product is actually used',
        'Concrete friction points and where users route around them',
        'Specific, actionable correction points - not a list of opinions',
      ],
    },
    de: {
      tagline: 'Wo die tatsächliche Nutzungslogik des Produkts Reibung erzeugt, die Nutzer:innen umgehen müssen.',
      points: [
        'Die reale Nutzungslogik rekonstruiert aus der tatsächlichen Nutzung',
        'Konkrete Reibungspunkte und wo Nutzer:innen sie umgehen',
        'Spezifische, umsetzbare Korrekturpunkte - keine Meinungsliste',
      ],
    },
  },
  'Verhaltensreview': {
    phase: 'Review',
    en: {
      tagline: 'Where behavior actually shifts under sustained interaction, read as a trend, not dressed up as prediction.',
      points: [
        'Tool-usage patterns and how they change over time',
        'Tone and confidence shifts tracked against real, logged interaction',
        'A trend read - increasing, decreasing, or steady - labeled honestly as a trend, not a forecast',
        'Where a shift is worth watching before it becomes a problem',
      ],
    },
    de: {
      tagline: 'Wo sich Verhalten unter anhaltender Interaktion tatsächlich verschiebt - als Trend gelesen, nicht als Vorhersage verkauft.',
      points: [
        'Werkzeugnutzungsmuster und wie sie sich über Zeit verändern',
        'Tonfall- und Sicherheitsverschiebungen, verfolgt anhand echter, protokollierter Interaktion',
        'Ein Trend-Read - steigend, fallend oder stabil - ehrlich als Trend markiert, nicht als Prognose',
        'Wo sich eine Verschiebung zu beobachten lohnt, bevor sie zum Problem wird',
      ],
    },
  },
  'Framework Design from Analysis': {
    phase: 'Design',
    en: {
      tagline: 'Translates a diagnosis into a concrete, build-ready design - not another report to file away.',
      points: [
        'Agent roles and check rules specified',
        'Control logic and interfaces designed explicitly',
        'Safety and alignment mechanisms built into the design itself',
      ],
    },
    de: {
      tagline: 'Übersetzt eine Diagnose in ein konkretes, baureifes Design - keinen weiteren Bericht zum Abheften.',
      points: [
        'Agentenrollen und Prüfregeln festgelegt',
        'Kontrolllogik und Schnittstellen explizit entworfen',
        'Sicherheits- und Ausrichtungsmechanismen im Design selbst verankert',
      ],
    },
  },
  'System Design & Deployment': {
    phase: 'Build',
    en: {
      tagline: 'The designed system, actually built and running - infrastructure, agents, monitoring, live.',
      points: [
        'Infrastructure and agent logic implemented',
        'Monitoring and interfaces wired up',
        'A working system handed over, not a spec waiting on a second vendor',
      ],
    },
    de: {
      tagline: 'Das entworfene System, tatsächlich gebaut und im Betrieb - Infrastruktur, Agenten, Monitoring, live.',
      points: [
        'Infrastruktur und Agentenlogik implementiert',
        'Monitoring und Schnittstellen verdrahtet',
        'Ein funktionierendes System übergeben, keine Spezifikation, die auf einen zweiten Dienstleister wartet',
      ],
    },
  },
  'Watchtower Retainment': {
    phase: 'License',
    en: {
      tagline: 'A monthly license to keep the system, its agents, and its check routines alive and current.',
      points: [
        'Ongoing usage rights for the deployed system and its agents',
        'Regular care and adjustment as things change',
        'Not a one-off delivered and abandoned',
      ],
    },
    de: {
      tagline: 'Eine monatliche Lizenz, um System, Agenten und Prüfroutinen am Leben und aktuell zu halten.',
      points: [
        'Laufendes Nutzungsrecht für das ausgerollte System und seine Agenten',
        'Regelmäßige Pflege und Anpassung, wenn sich Dinge ändern',
        'Kein Einmalprodukt, das danach vergessen wird',
      ],
    },
  },
  'Multiagent System Coordination': {
    phase: 'Operate',
    en: {
      tagline: 'The agent family actually watching the system every month, not sitting idle after handover.',
      points: [
        'Continuous automated monitoring and evaluation',
        'Deviations caught and flagged for a human look',
        'Monthly operation of the full agent family',
      ],
    },
    de: {
      tagline: 'Die Agenten-Familie, die das System jeden Monat tatsächlich im Blick behält - statt nach der Übergabe stillzustehen.',
      points: [
        'Laufende automatisierte Überwachung und Auswertung',
        'Abweichungen erkannt und für einen menschlichen Blick markiert',
        'Monatlicher Betrieb der gesamten Agenten-Familie',
      ],
    },
  },
  'Further Development': {
    phase: 'Maintain',
    en: {
      tagline: 'The system kept current as your case or organisation moves, instead of quietly drifting out of date.',
      points: [
        'Monthly adjustments as things change',
        'Framework and agent updates rolled in as needed',
        'No re-audit from scratch each time - continuity, not restart',
      ],
    },
    de: {
      tagline: 'Das System bleibt aktuell, während sich dein Fall oder deine Organisation weiterentwickelt - statt still zu veralten.',
      points: [
        'Monatliche Anpassungen, wenn sich Dinge ändern',
        'Framework- und Agenten-Updates nach Bedarf eingespielt',
        'Kein Re-Audit von vorn bei jedem Mal - Kontinuität statt Neustart',
      ],
    },
  },
}

// Two genuinely different methodologies live in the same product list now
// (the original case-intelligence ladder from WEBHUB(1).md, and the newer
// system/organisation-diagnosis ladder from SYSTEMAUDIT_ANGEBOT.md) - a
// flat price-sorted wall interleaves them, which is exactly what read as
// cluttered. Split into two labelled groups (each still price-sorted
// within itself) with a divider between, rather than inventing a third
// arbitrary "tier" grouping neither source document describes. Anything
// not in this set defaults to the first group - a new product an admin
// adds later shows up somewhere sensible instead of silently vanishing.
const SYSTEMAUDIT_NAMES = new Set([
  'Systemaudit', 'Rollenreview', 'Prozessreview', 'Root Level Review', 'Schnittstellenreview',
  'Betriebsreview', 'Verhaltensreview', 'Organisationsreview', 'Produktreview', 'Framework Design from Analysis',
  'System Design & Deployment', 'Watchtower Retainment', 'Multiagent System Coordination', 'Further Development',
])

const COPY = {
  en: {
    eyebrow: 'Offer',
    title: "Your case isn't random. It has a logic. I find it.",
    intro: "Bring a complex case, a set of documents, case-file access, or a conversation history. I reconstruct what it actually is: the gaps, the contradictions, the recurring patterns - and the logic a framework or agent system gets built from. Not a vibe check. Structure. Your case is analysed through my own research lens - I'm studying emergence and building agents from it, not ingesting it as generic company data.",
    flagshipBadge: 'Core offer',
    recurring: 'month',
    more: 'More',
    loading: 'Loading the offer ladder…',
    error: 'Could not load pricing right now - reach out directly instead.',
    whatLabel: 'What this is',
    youGetLabel: 'You get',
    buy: 'Buy',
    close: 'Close',
    groupCase: 'Case Intelligence',
    groupSystemaudit: 'Systemaudit',
    consentTitle: 'Please confirm before checkout',
    consentB2b: 'I am acting as a business customer and confirm that this purchase is made in the course of my commercial or professional activity.',
    consentAgbBefore: 'I agree to the ',
    consentAgbLink: 'Terms of Service',
    consentAgbAfter: '. I understand that the service begins immediately upon payment and that no right of withdrawal applies. Refunds are excluded.',
    cancel: 'Cancel',
    continueToStripe: 'Continue to Stripe →',
  },
  de: {
    eyebrow: 'Angebot',
    title: 'Dein Fall ist kein Zufall - er hat eine Logik. Ich finde sie.',
    intro: 'Du bringst einen komplexen Fall, eine Dokumentation, Akteneinsicht oder einen Interaktionsverlauf. Ich rekonstruiere daraus, was er wirklich ist: Mängel, Widersprüche, Lücken - und die Logik, aus der sich ein Framework oder Agentensystem ableiten lässt. Kein Bauchgefühl. Struktur. Dein Fall wird durch meine eigene Forschungsbrille analysiert - ich erforsche Emergenz und baue Agenten daraus, ich nehme ihn nicht als generische Unternehmensdaten auf.',
    flagshipBadge: 'Kernangebot',
    recurring: 'Monat',
    more: 'Mehr',
    loading: 'Angebotsleiter wird geladen…',
    error: 'Preise konnten gerade nicht geladen werden - melde dich direkt.',
    whatLabel: 'Was das ist',
    youGetLabel: 'Das bekommst du',
    buy: 'Kaufen',
    close: 'Schließen',
    groupCase: 'Case Intelligence',
    groupSystemaudit: 'Systemaudit',
    consentTitle: 'Bitte vor dem Checkout bestätigen',
    consentB2b: 'Ich handle als Unternehmer und bestätige, dass dieser Kauf im Rahmen meiner gewerblichen oder beruflichen Tätigkeit erfolgt.',
    consentAgbBefore: 'Ich stimme den ',
    consentAgbLink: 'Allgemeinen Geschäftsbedingungen',
    consentAgbAfter: ' zu. Mir ist bewusst, dass die Leistung sofort nach Zahlung beginnt und daher kein Widerrufsrecht besteht. Rückerstattungen sind ausgeschlossen.',
    cancel: 'Abbrechen',
    continueToStripe: 'Weiter zu Stripe →',
  },
} as const

export function WebHubPricing() {
  const { lang } = useLang()
  const c = COPY[lang]
  const [products, setProducts] = useState<PublicProduct[] | null>(null)
  const [error, setError] = useState(false)
  const [active, setActive] = useState<PublicProduct | null>(null)
  // Legal consent gate before any Stripe redirect — mirrors rfi-irfos.com's
  // own B2B-checkout-confirmation modal (Abmahnung-proofing: self-declared
  // commercial customer excludes the KSchG consumer-protection Widerrufsrecht
  // per §1(2) KSchG / §18(1)(1) FAGG, matched by AgbContent in LegalPage.tsx).
  // Holds the product pending checkout; both checkboxes reset whenever a new
  // checkout is opened so consent is given fresh per purchase, not carried
  // over from an earlier one.
  const [checkoutTarget, setCheckoutTarget] = useState<PublicProduct | null>(null)
  const [b2bChecked, setB2bChecked] = useState(false)
  const [agbChecked, setAgbChecked] = useState(false)

  const openCheckout = (p: PublicProduct) => {
    setB2bChecked(false)
    setAgbChecked(false)
    setCheckoutTarget(p)
  }
  const confirmCheckout = () => {
    if (!checkoutTarget) return
    window.open(checkoutTarget.payment_link_url, '_blank', 'noopener,noreferrer')
    setCheckoutTarget(null)
  }

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/billing/public-products`)
      .then(res => { if (!res.ok) throw new Error(String(res.status)); return res.json() })
      .then((data: PublicProduct[]) => {
        if (cancelled) return
        // Case Intelligence first (it's the flagship ladder), then Systemaudit
        // — each group price-sorted within itself, see SYSTEMAUDIT_NAMES's own
        // comment for why a flat price sort across both reads as cluttered.
        const sorted = [...data.filter(p => p.category !== 'certification')].sort((a, b) => {
          const groupA = SYSTEMAUDIT_NAMES.has(a.name) ? 1 : 0
          const groupB = SYSTEMAUDIT_NAMES.has(b.name) ? 1 : 0
          return groupA !== groupB ? groupA - groupB : a.price_cents - b.price_cents
        })
        setProducts(sorted)
      })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])

  // Close modal(s) on Escape — checkout consent takes priority since it
  // renders on top of the detail modal.
  useEffect(() => {
    if (!active && !checkoutTarget) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (checkoutTarget) setCheckoutTarget(null)
      else setActive(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, checkoutTarget])

  if (!error && products !== null && products.length === 0) return null

  return (
    <section className="site-section site-webhub-pricing" id="webhub-pricing" data-cid="webhub-pricing.title">
      <div className="site-webhub-head">
        <div className="site-webhub-eyebrow">{c.eyebrow}</div>
        <h2 className="site-section-title">{c.title}</h2>
        <p className="site-webhub-intro">{c.intro}</p>
      </div>

      {products === null && !error && <p className="site-webhub-status">{c.loading}</p>}
      {error && <p className="site-webhub-status">{c.error}</p>}

      {products !== null && products.length > 0 && (() => {
        const caseGroup = products.filter(p => !SYSTEMAUDIT_NAMES.has(p.name))
        const auditGroup = products.filter(p => SYSTEMAUDIT_NAMES.has(p.name))
        const renderCard = (p: PublicProduct, i: number) => {
          const isFlagship = p.name === FLAGSHIP_NAME
          return (
            <div key={i} className={`site-webhub-card${isFlagship ? ' flagship' : ''}`}>
              {isFlagship && <div className="site-webhub-flag">{c.flagshipBadge}</div>}
              <h3>{p.name}</h3>
              <div className="site-webhub-price">
                {formatPrice(p.price_cents, p.currency, lang)}
                {p.mode === 'subscription' && <span className="site-webhub-per"> / {c.recurring}</span>}
              </div>
              <div className="site-webhub-row">
                <button
                  type="button"
                  className="site-webhub-buy"
                  title={`${c.buy}: ${p.name}`}
                  aria-label={`${c.buy}: ${p.name}`}
                  onClick={() => openCheckout(p)}
                >
                  {BASKET}
                </button>
                <button
                  type="button"
                  className="site-webhub-more"
                  onClick={() => setActive(p)}
                  aria-haspopup="dialog"
                >
                  {c.more} {PLUS}
                </button>
              </div>
            </div>
          )
        }
        return (
          <>
            {caseGroup.length > 0 && (
              <>
                <div className="site-webhub-group-label">{c.groupCase}</div>
                <div className="site-webhub-grid">{caseGroup.map(renderCard)}</div>
              </>
            )}
            {auditGroup.length > 0 && (
              <>
                <div className="site-webhub-group-divider" />
                <div className="site-webhub-group-label">{c.groupSystemaudit}</div>
                <div className="site-webhub-grid">{auditGroup.map(renderCard)}</div>
              </>
            )}
          </>
        )
      })()}

      {active && (
        <div
          className="site-webhub-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={active.name}
          onClick={(e) => { if (e.target === e.currentTarget) setActive(null) }}
        >
          <div className="site-webhub-modal">
            <button type="button" className="site-webhub-x" aria-label={c.close} onClick={() => setActive(null)}>
              {CROSS}
            </button>
            <span className="site-webhub-chip">{DETAIL[active.name]?.phase ?? active.category}</span>
            <h3 className="site-webhub-modal-name">{active.name}</h3>
            <div className="site-webhub-modal-price">
              {formatPrice(active.price_cents, active.currency, lang)}
              {active.mode === 'subscription' && <span className="site-webhub-per"> / {c.recurring}</span>}
            </div>

            {(() => {
              const detail = DETAIL[active.name]?.[lang]
              if (!detail) {
                // Fallback for a product not yet in DETAIL (e.g. freshly
                // added via the admin panel) — the plain DB description,
                // no bullets to invent.
                return (
                  <div className="site-webhub-blk">
                    <div className="site-webhub-lbl">{c.whatLabel}</div>
                    <div className="site-webhub-txt">
                      {lang === 'en' ? active.description : (active.description_de ?? active.description)}
                    </div>
                  </div>
                )
              }
              return (
                <>
                  <div className="site-webhub-blk">
                    <div className="site-webhub-lbl">{c.whatLabel}</div>
                    <div className="site-webhub-txt">{detail.tagline}</div>
                  </div>
                  {detail.points.length > 0 && (
                    <div className="site-webhub-blk">
                      <div className="site-webhub-lbl">{c.youGetLabel}</div>
                      <ul className="site-webhub-points">
                        {detail.points.map((pt, i) => <li key={i}>{pt}</li>)}
                      </ul>
                    </div>
                  )}
                </>
              )
            })()}

            <button type="button" className="site-webhub-buy big" onClick={() => openCheckout(active)}>
              {BASKET}<span>{c.buy}</span>
            </button>
          </div>
        </div>
      )}

      {checkoutTarget && (
        <div
          className="site-webhub-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={c.consentTitle}
          onClick={(e) => { if (e.target === e.currentTarget) setCheckoutTarget(null) }}
        >
          <div className="site-webhub-modal site-webhub-consent">
            <button type="button" className="site-webhub-x" aria-label={c.close} onClick={() => setCheckoutTarget(null)}>
              {CROSS}
            </button>
            <div className="site-webhub-lbl">{c.consentTitle}</div>
            <h3 className="site-webhub-modal-name">{checkoutTarget.name}</h3>
            <label className="site-webhub-consent-row">
              <input type="checkbox" checked={b2bChecked} onChange={e => setB2bChecked(e.target.checked)} />
              <span>{c.consentB2b}</span>
            </label>
            <label className="site-webhub-consent-row">
              <input type="checkbox" checked={agbChecked} onChange={e => setAgbChecked(e.target.checked)} />
              <span>
                {c.consentAgbBefore}
                <a href="#p/agb" target="_blank" rel="noopener noreferrer">{c.consentAgbLink}</a>
                {c.consentAgbAfter}
              </span>
            </label>
            <div className="site-webhub-consent-actions">
              <button type="button" className="site-webhub-consent-cancel" onClick={() => setCheckoutTarget(null)}>
                {c.cancel}
              </button>
              <button
                type="button"
                className="site-webhub-buy big"
                disabled={!b2bChecked || !agbChecked}
                onClick={confirmCheckout}
              >
                <span>{c.continueToStripe}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
