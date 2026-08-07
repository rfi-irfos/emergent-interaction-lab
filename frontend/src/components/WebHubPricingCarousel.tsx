import { useEffect, useState } from 'react'
import { API_BASE } from '../lib/apiBase'
import { useLang } from '../hooks/useLang'
import type { SiteContent } from '../types/content'
import { LENS_ORDER, SUBGROUP_ORDER, lensRank, subgroupRank, type SubgroupKey } from '../lib/pricingTiers'
import { PricingTierCarousel, type PricingTier } from './PricingTierCarousel'

// Core offer — called out visually; if renamed/removed upstream it simply
// stops matching and no card gets the badge. Nothing breaks.
const FLAGSHIP_NAME = 'Emergent Case Intelligence Sprint'

// German display names — the product `name` comes straight from Stripe
// (English-only, one name per product, no locale field) so the German site
// showed English tier names even after the rest of the copy was translated
// (flagged live, "die Pricings sind ja nicht mal auf Deutsch übersetzt").
// Keyed by the same canonical (Stripe) name DETAIL uses; a name missing
// here just falls back to the English original, same graceful-degradation
// pattern as DETAIL. Names already German (Systemaudit, the *-review
// products, Mangelcluster Sprint) aren't listed - nothing to translate.
const NAME_DE: Record<string, string> = {
  'Case Intake Scan': 'Fallaufnahme-Scan',
  'Market & Competitor Intelligence': 'Markt- & Wettbewerbsanalyse',
  'Framework Magnification': 'Framework-Schärfung',
  'Emergent Case Intelligence Sprint': 'Emergente Fallrekonstruktion',
  'Multi-Agent System Design': 'Multi-Agenten-Systemdesign',
  'Implementation Build': 'Implementierung',
  'Retainer / Monitoring': 'Betreuung / Monitoring',
  'Framework Update': 'Framework-Aktualisierung',
  'Root Level Review': 'Fundament-Review',
  'Framework Design from Analysis': 'Framework-Entwurf aus der Analyse',
  'System Design & Deployment': 'Systemdesign & Rollout',
  'Watchtower Retainment': 'Watchtower-Lizenz',
  'Multiagent System Coordination': 'Multi-Agenten-Koordination',
  'Further Development': 'Weiterentwicklung',
  'Behavior Analysis': 'Verhaltensanalyse',
  'Behavior Model': 'Verhaltensmodell',
}

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
      tagline: "You get a straight answer this week: where your case actually stands, and whether it's worth going further. No form to fill in, and no commitment beyond this one step.",
      points: [
        'You get a written case summary in plain language, not a form response.',
        'I map out, roughly, which areas the case actually touches.',
        'Any defects or contradictions that are already visible get flagged immediately.',
        'You leave with a short, prioritized list of open questions for the next stage.',
      ],
    },
    de: {
      tagline: 'Noch diese Woche bekommst du eine klare Antwort: wo dein Fall wirklich steht, und ob es sich lohnt, weiterzugehen. Kein Formular, keine Verpflichtung über diesen einen Schritt hinaus.',
      points: [
        'Du bekommst eine schriftliche Fallzusammenfassung in klarer Sprache, kein ausgefülltes Formular.',
        'Ich skizziere grob, welche Bereiche der Fall tatsächlich berührt.',
        'Bereits sichtbare Mängel oder Widersprüche werden sofort benannt.',
        'Am Ende steht eine kurze, priorisierte Liste offener Fragen für die nächste Stufe.',
      ],
    },
  },
  'Mangelcluster Sprint': {
    phase: 'Cluster',
    en: {
      tagline: "You bring scattered material - documents, notes, half a case file - and I turn it into one structure you can actually work from. Nothing gets smoothed over on the way.",
      points: [
        'You get a full defect list, and every entry traces back to its source material.',
        'I group the issues into thematic clusters, so you see what actually belongs together.',
        'Contradictions and gaps are named explicitly, not glossed over.',
        'You walk away with a prioritized list of next steps, not just a longer list of problems.',
      ],
    },
    de: {
      tagline: 'Du bringst verstreutes Material - Dokumente, Notizen, eine halbe Akte - und ich mach daraus eine Struktur, mit der sich tatsächlich arbeiten lässt. Dabei wird nichts geglättet.',
      points: [
        'Du bekommst eine vollständige Mängelliste, jeder Eintrag rückverfolgbar zur Quelle.',
        'Ich gruppiere die Themen in Cluster, damit sichtbar wird, was wirklich zusammengehört.',
        'Widersprüche und Lücken werden explizit benannt, nicht geglättet.',
        'Am Ende steht eine priorisierte Liste nächster Schritte, keine bloß längere Problemliste.',
      ],
    },
  },
  'Market & Competitor Intelligence': {
    phase: 'Market',
    en: {
      tagline: "The same observational method I use on a case, aimed outward at your market instead. You get a real read on where you stand, not a slide deck full of logos.",
      points: [
        "You learn who else genuinely operates in your space, and how they're positioned and priced.",
        'I give you a structured, evidence-based read of the real competitive field, not a template SWOT.',
        'The gaps and openings that are actually worth acting on get named specifically.',
        'You get a map you can navigate by, not a report you file away.',
      ],
    },
    de: {
      tagline: 'Dieselbe beobachtende Methode, die ich auf einen Fall anwende - hier nach außen auf deinen Markt gerichtet. Du bekommst eine echte Standortbestimmung, keine Folie voller Logos.',
      points: [
        'Du erfährst, wer tatsächlich in deinem Feld agiert, und wie diese Anbieter positioniert und bepreist sind.',
        'Ich liefere eine strukturierte, evidenzbasierte Lesart des echten Wettbewerbsfelds, kein Template-SWOT.',
        'Die Lücken und Chancen, die es wirklich wert sind, verfolgt zu werden, werden konkret benannt.',
        'Du bekommst eine Landkarte zum Navigieren, keinen Bericht zum Abheften.',
      ],
    },
  },
  'Framework Magnification': {
    phase: 'Derive',
    en: {
      tagline: "You're already operating by rules you've never written down. I make them explicit, so you use them on purpose instead of by accident.",
      points: [
        'The implicit frameworks, terms, and decision logic already running your case get written down.',
        "I draw a clear line between what's a real principle and what's just this one situation.",
        'You get the foundation the next stage - agent or system design - gets derived from.',
      ],
    },
    de: {
      tagline: 'Du arbeitest längst nach Regeln, die nie aufgeschrieben wurden. Ich mach sie explizit, damit du sie bewusst nutzt, statt zufällig.',
      points: [
        'Die impliziten Frameworks, Begriffe und Entscheidungslogik deines Falls werden schriftlich festgehalten.',
        'Ich ziehe eine klare Linie zwischen echtem Prinzip und bloßem Einzelfall.',
        'Du bekommst die Grundlage, aus der sich das nächste Agenten- oder Systemdesign ableitet.',
      ],
    },
  },
  'Emergent Case Intelligence Sprint': {
    phase: 'Reconstruct',
    en: {
      tagline: 'Your case, rebuilt from the ground up - what it actually is, not what it looked like from the outside. This is the core offer: full reconstruction, not a summary of what you already knew.',
      points: [
        'I reconstruct the case fully from your documents, case-file access, or a conversation history.',
        'Every defect, contradiction, and gap gets identified and sourced back to the material it came from.',
        'You get the theme areas that actually structure the case, not an arbitrary list.',
        'You walk away with the logic a framework or agent architecture gets derived from next.',
      ],
    },
    de: {
      tagline: 'Dein Fall, komplett neu aufgebaut - was er wirklich ist, nicht wonach er von außen aussah. Das ist das Kernangebot: vollständige Rekonstruktion, keine Zusammenfassung dessen, was du schon wusstest.',
      points: [
        'Ich rekonstruiere den Fall vollständig aus Dokumenten, Akteneinsicht oder Interaktionsverlauf.',
        'Jeder Mangel, Widerspruch und jede Lücke wird identifiziert und auf die Quelle zurückgeführt.',
        'Du bekommst die Themenbereiche, die den Fall tatsächlich strukturieren, keine willkürliche Liste.',
        'Am Ende steht die Logik, aus der sich Framework oder Agentenarchitektur als Nächstes ableiten.',
      ],
    },
  },
  'Multi-Agent System Design': {
    phase: 'Agent Design',
    en: {
      tagline: 'I turn the case logic into an actual agent-system design: a build-ready specification, not a slide deck someone still has to interpret.',
      points: [
        'You get a role model: which agent does what, and exactly where its boundary sits.',
        'I write the runtime logic together with explicit state and memory handling.',
        'Audit and drift mechanisms are designed in from the start, not bolted on afterward.',
        'Safety and alignment constraints are part of the design itself, not a footnote.',
      ],
    },
    de: {
      tagline: 'Ich übersetze die Fall-Logik in ein tatsächliches Agentensystem-Design: eine baubare Spezifikation, kein Slide-Deck, das erst noch jemand interpretieren muss.',
      points: [
        'Du bekommst ein Rollenmodell: welcher Agent macht was, und wo genau liegt seine Grenze.',
        'Ich schreibe die Runtime-Logik zusammen mit explizitem State- und Memory-Handling.',
        'Audit- und Drift-Mechanismen sind von Anfang an mitgedacht, nicht nachträglich angeflanscht.',
        'Sicherheits- und Ausrichtungsvorgaben sind Teil des Designs selbst, keine Fußnote.',
      ],
    },
  },
  'Implementation Build': {
    phase: 'Build',
    en: {
      tagline: 'The designed system, actually running - not a document waiting for someone else to build it. You get working software, delivered.',
      points: [
        'Automations and workflows are wired up end to end, not just sketched.',
        'Intake, routing, and the analysis pipeline go live as part of the build.',
        'Delivery and monitoring are in place from day one, not added later.',
        'You get a follow-up plan for the first weeks of real use.',
      ],
    },
    de: {
      tagline: 'Das entworfene System, tatsächlich am Laufen - kein Dokument, das auf einen anderen Bauherrn wartet. Du bekommst laufende Software, ausgeliefert.',
      points: [
        'Automationen und Workflows werden durchgängig verdrahtet, nicht nur skizziert.',
        'Intake, Routing und Analysepipeline gehen als Teil des Builds live.',
        'Delivery und Monitoring stehen ab Tag eins, nicht erst später.',
        'Du bekommst einen Follow-up-Plan für die ersten Wochen im echten Betrieb.',
      ],
    },
  },
  'Retainer / Monitoring': {
    phase: 'Operate',
    en: {
      tagline: "The system doesn't quietly go stale the month after delivery, because someone keeps watching it. That someone is me.",
      points: [
        'New cases get handled as they come in, not queued for a future sprint.',
        'I run regular reviews and drift checks against what was originally built.',
        'Frameworks and the system get updated as the underlying case changes.',
        "You get continuous oversight, not a one-off handover you're left with.",
      ],
    },
    de: {
      tagline: 'Das System veraltet nicht still im Monat nach der Auslieferung, weil jemand weiter hinschaut. Das bin ich.',
      points: [
        'Neue Fälle werden bearbeitet, wenn sie reinkommen, nicht für einen künftigen Sprint aufgeschoben.',
        'Ich führe regelmäßige Reviews und Drift-Checks gegen das ursprünglich Gebaute durch.',
        'Frameworks und System werden angepasst, wenn sich der zugrunde liegende Fall ändert.',
        'Du bekommst laufende Aufsicht, keine einmalige Übergabe, mit der du allein bleibst.',
      ],
    },
  },
  'Framework Update': {
    phase: 'Maintain',
    en: {
      tagline: "Your case has moved on but the system hasn't caught up yet. This is the focused refresh for that gap, not a full re-audit from scratch.",
      points: [
        'You get updated frameworks and check routines.',
        'Agent logic gets adjusted wherever the old rules no longer fit.',
        "Nothing gets redone that's still working fine.",
      ],
    },
    de: {
      tagline: 'Dein Fall hat sich weiterentwickelt, das System noch nicht. Das ist die gezielte Auffrischung für genau diese Lücke, kein komplettes Re-Audit von vorn.',
      points: [
        'Du bekommst aktualisierte Frameworks und Prüfroutinen.',
        'Die Agentenlogik wird angepasst, wo die alten Regeln nicht mehr passen.',
        'Nichts wird neu gemacht, was noch funktioniert.',
      ],
    },
  },

  // ── Systemaudit ladder — a separate methodology (system/organisation/
  // product diagnosis, not case reconstruction), see SYSTEMAUDIT_NAMES
  // above for the group split shown on the page.
  'Systemaudit': {
    phase: 'Diagnose',
    en: {
      tagline: 'I look at how your system actually behaves, not what the org chart claims it does. That gap is usually where the real cost sits.',
      points: [
        'I diagnose system, organisation, process, product, and interaction together, not each in isolation.',
        'Concrete friction points get named and traced back to where they actually occur.',
        'You get an agent and automation model for what should keep watching this going forward.',
      ],
    },
    de: {
      tagline: 'Ich schau mir an, wie dein System wirklich funktioniert, nicht, was das Organigramm behauptet. Genau in dieser Lücke steckt meistens der echte Preis.',
      points: [
        'Ich diagnostiziere System, Organisation, Prozess, Produkt und Interaktion gemeinsam, nicht jedes für sich.',
        'Konkrete Reibungspunkte werden benannt und dorthin zurückverfolgt, wo sie tatsächlich auftreten.',
        'Du bekommst ein Agenten- und Automatisierungsmodell für die künftige Überwachung.',
      ],
    },
  },
  'Rollenreview': {
    phase: 'Review',
    en: {
      tagline: "Someone owns every decision on paper. In practice it's often unclear, or silently double-owned. I find out which.",
      points: [
        'You get a role-by-role ownership map, not an org chart redrawn.',
        'Overlaps and gaps get named explicitly, not smoothed into a diagram.',
        "I point to exactly where ambiguity is the real source of the friction you're feeling.",
      ],
    },
    de: {
      tagline: 'Auf dem Papier trägt jemand jede Entscheidung. In der Praxis ist das oft unklar, oder heimlich doppelt vergeben. Ich finde heraus, was zutrifft.',
      points: [
        'Du bekommst eine Zuständigkeitskarte Rolle für Rolle, kein neu gezeichnetes Organigramm.',
        'Überschneidungen und Lücken werden explizit benannt, nicht in ein Diagramm geglättet.',
        'Ich zeige genau, wo diese Unklarheit die eigentliche Reibung erzeugt.',
      ],
    },
  },
  'Prozessreview': {
    phase: 'Review',
    en: {
      tagline: 'A process looks fine on the whiteboard. I check where it actually holds under real load, and where it stalls at a handoff or an edge case.',
      points: [
        'I walk the process end to end against real use, not the idealized version.',
        'Every handoff point gets checked for where it actually breaks.',
        'I name where a decision quietly never gets made, instead of pretending it was.',
      ],
    },
    de: {
      tagline: 'Auf dem Whiteboard sieht ein Prozess gut aus. Ich prüfe, wo er unter echter Last wirklich hält - und wo er an einer Übergabe oder einem Randfall stockt.',
      points: [
        'Ich spiele den Prozess durch, gegen echte, nicht idealisierte Nutzung.',
        'Jede Übergabe wird geprüft, wo sie tatsächlich bricht.',
        'Ich benenne, wo eine Entscheidung still nie getroffen wird, statt so zu tun, als wäre sie es.',
      ],
    },
  },
  'Root Level Review': {
    phase: 'Review',
    en: {
      tagline: "Not what's visibly broken - what the whole system is quietly resting on. This is the deepest layer, and the one most audits skip.",
      points: [
        'I examine the structural, organisational, and interaction foundations directly.',
        "You learn where they actually load-bear, and where they're already failing under the surface.",
        'I state plainly what would have to hold for everything built on top to stay standing.',
      ],
    },
    de: {
      tagline: 'Nicht, was sichtbar kaputt ist - worauf das ganze System still ruht. Das ist die tiefste Ebene, und die, die die meisten Audits auslassen.',
      points: [
        'Ich prüfe die strukturellen, organisationalen und interaktionalen Grundlagen direkt.',
        'Du erfährst, wo sie wirklich tragen und wo sie schon unter der Oberfläche versagen.',
        'Ich sage klar, was halten müsste, damit alles Darüberliegende stehen bleibt.',
      ],
    },
  },
  'Schnittstellenreview': {
    phase: 'Review',
    en: {
      tagline: 'Two systems or teams hand off to each other constantly. I check what actually gets lost or misread right at that handoff.',
      points: [
        'Every interface between system parts, teams, or tools gets mapped.',
        'The handoffs nobody actually owns get named explicitly.',
        'I make visible the assumptions each side quietly makes about the other.',
      ],
    },
    de: {
      tagline: 'Zwei Systeme oder Teams übergeben ständig aneinander. Ich prüfe, was genau dabei verloren geht oder falsch verstanden wird.',
      points: [
        'Jede Schnittstelle zwischen Systemteilen, Teams oder Tools wird kartiert.',
        'Die Übergaben, die niemand wirklich verantwortet, werden explizit benannt.',
        'Ich mach sichtbar, welche Annahmen jede Seite stillschweigend über die andere trifft.',
      ],
    },
  },
  'Betriebsreview': {
    phase: 'Review',
    en: {
      tagline: 'Launching a system is one thing. Watching it stay alive month after month is another. I check whether anyone would actually notice it failing.',
      points: [
        'The operating model gets checked against real load, not launch-day load.',
        'I assess monitorability honestly: would a failure starting actually get noticed?',
        'Concrete observability gaps get named, not a general impression.',
      ],
    },
    de: {
      tagline: 'Ein System zu starten ist eine Sache. Es Monat für Monat am Leben zu halten eine andere. Ich prüfe, ob überhaupt jemand ein beginnendes Versagen bemerken würde.',
      points: [
        'Das Betriebsmodell wird gegen echte Last geprüft, nicht gegen Launch-Tag-Last.',
        'Ich bewerte die Überwachbarkeit ehrlich: würde ein beginnendes Versagen tatsächlich auffallen?',
        'Konkrete Beobachtungslücken werden benannt, kein allgemeiner Eindruck.',
      ],
    },
  },
  'Organisationsreview': {
    phase: 'Review',
    en: {
      tagline: 'The organisation as a whole, not one role or process in isolation. Reporting lines and handovers usually break quietly, long before anyone notices.',
      points: [
        'I examine the full org structure, not a single role or process.',
        'Reporting lines and responsibility gaps get mapped explicitly.',
        'I show where a bad week breaks something a good week has been quietly hiding.',
      ],
    },
    de: {
      tagline: 'Die Organisation als Ganzes, nicht eine Rolle oder ein Prozess isoliert. Berichtslinien und Übergaben brechen meist still, lange bevor es jemand merkt.',
      points: [
        'Ich prüfe die gesamte Organisationsstruktur, nicht eine einzelne Rolle oder einen Prozess.',
        'Berichtslinien und Verantwortungslücken werden explizit kartiert.',
        'Ich zeige, wo eine schlechte Woche bricht, was eine gute Woche bisher still verdeckt hat.',
      ],
    },
  },
  'Produktreview': {
    phase: 'Review',
    en: {
      tagline: 'Users route around friction quietly, and most companies never see it happen. I reconstruct how the product is actually used and where that breaks down.',
      points: [
        'I reconstruct the real usage logic from how the product is actually used.',
        'Concrete friction points get named, along with where users route around them.',
        'You get specific, actionable correction points, not a list of opinions.',
      ],
    },
    de: {
      tagline: 'Nutzer:innen umgehen Reibung meist still, und die wenigsten Unternehmen bekommen das mit. Ich rekonstruiere, wie das Produkt tatsächlich genutzt wird, und wo es dabei hakt.',
      points: [
        'Ich rekonstruiere die reale Nutzungslogik aus der tatsächlichen Nutzung.',
        'Konkrete Reibungspunkte werden benannt, ebenso wo Nutzer:innen sie umgehen.',
        'Du bekommst spezifische, umsetzbare Korrekturpunkte, keine Meinungsliste.',
      ],
    },
  },
  'Verhaltensreview': {
    phase: 'Review',
    en: {
      tagline: 'I read how behavior actually shifts under sustained interaction. It gets reported as a trend you can act on, never dressed up as a prediction.',
      points: [
        "You get tool-usage patterns and how they've changed over time.",
        'Tone and confidence shifts get tracked against the real, logged interaction, not an impression.',
        'The trend - increasing, decreasing, or steady - is labeled honestly as a trend, not a forecast.',
        "I flag where a shift is worth watching before it turns into a problem.",
      ],
    },
    de: {
      tagline: 'Ich lese, wie sich Verhalten unter anhaltender Interaktion tatsächlich verschiebt. Berichtet wird das als Trend, auf den du reagieren kannst - nie als Vorhersage verkauft.',
      points: [
        'Du bekommst Werkzeugnutzungsmuster und wie sie sich über Zeit verändert haben.',
        'Tonfall- und Sicherheitsverschiebungen werden anhand echter, protokollierter Interaktion verfolgt, nicht nach Eindruck.',
        'Der Trend - steigend, fallend oder stabil - wird ehrlich als Trend markiert, nicht als Prognose.',
        'Ich markiere, wo sich eine Verschiebung zu beobachten lohnt, bevor sie zum Problem wird.',
      ],
    },
  },
  'Framework Design from Analysis': {
    phase: 'Design',
    en: {
      tagline: 'I translate a diagnosis into a concrete, build-ready design. Not another report to file away.',
      points: [
        'You get agent roles and check rules, specified in detail.',
        'I design the control logic and the interfaces explicitly, not as an afterthought.',
        'Safety and alignment mechanisms are built into the design itself, not added on top.',
      ],
    },
    de: {
      tagline: 'Ich übersetze eine Diagnose in ein konkretes, baureifes Design. Keinen weiteren Bericht zum Abheften.',
      points: [
        'Du bekommst Agentenrollen und Prüfregeln, im Detail festgelegt.',
        'Ich entwerfe die Kontrolllogik und die Schnittstellen explizit, nicht nachträglich.',
        'Sicherheits- und Ausrichtungsmechanismen sind im Design selbst verankert, nicht aufgesetzt.',
      ],
    },
  },
  'System Design & Deployment': {
    phase: 'Build',
    en: {
      tagline: 'Built. Running. Live. You get infrastructure, agents, and monitoring, not a slide deck.',
      points: [
        'I implement the infrastructure and the agent logic myself.',
        'Monitoring and interfaces are wired up as part of the build.',
        'You get a working system handed over, not a spec still waiting on a second vendor.',
      ],
    },
    de: {
      tagline: 'Gebaut. Im Betrieb. Live. Du bekommst Infrastruktur, Agenten und Monitoring, keine Folie.',
      points: [
        'Ich implementiere die Infrastruktur und die Agentenlogik selbst.',
        'Monitoring und Schnittstellen werden im Rahmen des Builds verdrahtet.',
        'Du bekommst ein funktionierendes System übergeben, keine Spezifikation, die auf einen zweiten Dienstleister wartet.',
      ],
    },
  },
  'Watchtower Retainment': {
    phase: 'License',
    en: {
      tagline: "A monthly license to keep the system, its agents, and its check routines alive. I'm the one keeping it current.",
      points: [
        'You get ongoing usage rights for the deployed system and its agents.',
        'I take care of it regularly, and adjust it as things change.',
        "It's not a one-off, delivered and then abandoned.",
      ],
    },
    de: {
      tagline: 'Eine monatliche Lizenz, um System, Agenten und Prüfroutinen am Leben zu halten. Ich bin diejenige, die dranbleibt.',
      points: [
        'Du bekommst laufendes Nutzungsrecht für das ausgerollte System und seine Agenten.',
        'Ich kümmere mich regelmäßig darum und passe an, wenn sich Dinge ändern.',
        'Das ist kein Einmalprodukt, das geliefert und dann vergessen wird.',
      ],
    },
  },
  'Multiagent System Coordination': {
    phase: 'Operate',
    en: {
      tagline: "The agent family actually watches your system every month. It doesn't sit idle after handover.",
      points: [
        'The agents run continuous automated monitoring and evaluation.',
        'Deviations get caught and flagged for a human to look at.',
        'You get the full agent family in operation, every month.',
      ],
    },
    de: {
      tagline: 'Die Agenten-Familie behält dein System jeden Monat tatsächlich im Blick. Sie steht nach der Übergabe nicht still.',
      points: [
        'Die Agenten überwachen und werten laufend automatisiert aus.',
        'Abweichungen werden erkannt und für einen menschlichen Blick markiert.',
        'Du bekommst die gesamte Agenten-Familie im monatlichen Betrieb.',
      ],
    },
  },
  'Further Development': {
    phase: 'Maintain',
    en: {
      tagline: "I keep the system current as your case or organisation moves. It doesn't quietly drift out of date.",
      points: [
        'I make monthly adjustments as things change.',
        'Framework and agent updates get rolled in as needed.',
        "There's no re-audit from scratch each time. It's continuity, not a restart.",
      ],
    },
    de: {
      tagline: 'Ich halte das System aktuell, während sich dein Fall oder deine Organisation weiterentwickelt. Es veraltet nicht still vor sich hin.',
      points: [
        'Ich passe monatlich an, wenn sich Dinge ändern.',
        'Framework- und Agenten-Updates spiele ich nach Bedarf ein.',
        'Kein Re-Audit von vorn bei jedem Mal. Das ist Kontinuität, kein Neustart.',
      ],
    },
  },
  'Behavior Analysis': {
    phase: 'Review',
    en: {
      tagline: "I read how behavior actually shifts under sustained interaction. It's measured as a trend, never dressed up as a prediction.",
      points: [
        'You get tool-usage patterns and how they change over time, reconstructed from logged interaction.',
        'Tone, confidence, and decision shifts get tracked against the real record.',
        'The trend - increasing, decreasing, or steady - is labeled honestly as a trend, not a forecast.',
        'I flag where a shift is worth watching before it becomes a problem.',
      ],
    },
    de: {
      tagline: 'Ich lese, wie sich Verhalten unter anhaltender Interaktion tatsächlich verschiebt. Gemessen wird das als Trend, nie als Vorhersage verkauft.',
      points: [
        'Du bekommst Werkzeugnutzungsmuster und wie sie sich über Zeit verändern, rekonstruiert aus protokollierter Interaktion.',
        'Tonfall-, Sicherheits- und Entscheidungsverschiebungen werden anhand des echten Records verfolgt.',
        'Der Trend - steigend, fallend oder stabil - wird ehrlich als Trend markiert, nicht als Prognose.',
        'Ich markiere, wo sich eine Verschiebung zu beobachten lohnt, bevor sie zum Problem wird.',
      ],
    },
  },
  'Behavior Model': {
    phase: 'Review',
    en: {
      tagline: 'I formalize the behavioral pattern. You get a working model you can test, hand over, and build on, not a slide.',
      points: [
        'I extract the recurring behavior pattern and write it down explicitly.',
        'You get a runnable model you can test against new data.',
        'I state the edge cases and where the model breaks, up front.',
        'You get something you can hand to a team or an agent system as a spec.',
      ],
    },
    de: {
      tagline: 'Ich formalisiere das Verhaltensmuster. Du bekommst ein lauffähiges Modell, das du testen, übergeben und weiterbauen kannst, keine Slide.',
      points: [
        'Ich extrahiere das wiederkehrende Verhaltensmuster und schreibe es explizit auf.',
        'Du bekommst ein lauffähiges Modell, das du gegen neue Daten testen kannst.',
        'Ich benenne die Randfälle und wo das Modell bricht, von vornherein.',
        'Du bekommst etwas, das du einem Team oder einem Agentensystem als Spezifikation übergeben kannst.',
      ],
    },
  },
}

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

const COPY = {
  en: {
    flagshipBadge: 'Core offer',
    recurring: 'month',
    loading: 'Loading the offer ladder…',
    error: 'Could not load pricing right now - reach out directly instead.',
    whatLabel: 'What this is',
    youGetLabel: 'You get',
    buy: 'Buy',
    close: 'Close',
    groupRekonstruktion: 'Rekonstruktion',
    groupAnalysen: 'Analysen',
    groupSystemaudit: 'Systemaudit',
    subgroupReviews: 'Reviews',
    subgroupSystemDesign: 'System design & build',
    subgroupOngoing: 'Ongoing',
    agentsEyebrow: 'Agents from the method',
    agentsIntro: 'These are not services you book by the hour. They are what the review perspectives produce: working agents built from the same case-logic above.',
    consentTitle: 'Please confirm before checkout',
    consentB2b: 'I am acting as a business customer and confirm that this purchase is made in the course of my commercial or professional activity.',
    consentAgbBefore: 'I agree to the ',
    consentAgbLink: 'Terms of Service',
    consentAgbAfter: '. I understand that the service begins immediately upon payment and that no right of withdrawal applies. Refunds are excluded.',
    cancel: 'Cancel',
    continueToStripe: 'Continue to Stripe →',
  },
  de: {
    flagshipBadge: 'Kernangebot',
    recurring: 'Monat',
    loading: 'Angebotsleiter wird geladen…',
    error: 'Preise konnten gerade nicht geladen werden - melde dich direkt.',
    whatLabel: 'Was das ist',
    youGetLabel: 'Das bekommst du',
    buy: 'Kaufen',
    close: 'Schließen',
    groupRekonstruktion: 'Rekonstruktion',
    groupAnalysen: 'Analysen',
    groupSystemaudit: 'Systemaudit',
    subgroupReviews: 'Reviews',
    subgroupSystemDesign: 'Systemdesign & Aufbau',
    subgroupOngoing: 'Laufend',
    agentsEyebrow: 'Agenten aus der Methode',
    agentsIntro: 'Das sind keine Leistungen, die du stundenweise buchst - das ist, was die Prüfperspektiven hervorbringen: lauffähige Agenten, gebaut aus derselben Fall-Logik wie oben.',
    consentTitle: 'Bitte vor dem Checkout bestätigen',
    consentB2b: 'Ich handle als Unternehmer und bestätige, dass dieser Kauf im Rahmen meiner gewerblichen oder beruflichen Tätigkeit erfolgt.',
    consentAgbBefore: 'Ich stimme den ',
    consentAgbLink: 'Allgemeinen Geschäftsbedingungen',
    consentAgbAfter: ' zu. Mir ist bewusst, dass die Leistung sofort nach Zahlung beginnt und daher kein Widerrufsrecht besteht. Rückerstattungen sind ausgeschlossen.',
    cancel: 'Abbrechen',
    continueToStripe: 'Weiter zu Stripe →',
  },
} as const

export function WebHubPricingCarousel({ content }: { content: SiteContent }) {
  const { lang } = useLang()
  const c = COPY[lang]
  const [products, setProducts] = useState<PublicProduct[] | null>(null)
  const [error, setError] = useState(false)
  // Agents (Call Laura / Lauras Team / Jarvis) emerge from the method — shown
  // as a separate strip, not in the buyable price grid.
  const agents = (content.productsBorn?.items ?? []).filter(a =>
    ['born-jarvis', 'born-calllaura', 'born-laurateam'].includes(a.id),
  )

  // Legal consent gate before any Stripe redirect — mirrors rfi-irfos.com's
  // own B2B-checkout-confirmation modal. Unchanged from the old modal.
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
        const sorted = [...data.filter(p => p.category !== 'certification')].sort((a, b) => {
          const ra = lensRank(a.name); const rb = lensRank(b.name)
          return ra !== rb ? ra - rb : a.price_cents - b.price_cents
        })
        setProducts(sorted)
      })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])

  // Only the checkout consent overlay needs to lock body scroll and handle
  // Escape now — the old modal locked scroll unconditionally because the
  // whole component WAS a full-page overlay; as inline homepage content it
  // must let the page scroll normally except while the consent popup is
  // actually open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && checkoutTarget) setCheckoutTarget(null)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = checkoutTarget ? 'hidden' : ''
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [checkoutTarget])

  const buildTier = (p: PublicProduct): PricingTier => ({
    key: p.name,
    name: lang === 'de' ? (NAME_DE[p.name] ?? p.name) : p.name,
    phase: DETAIL[p.name]?.phase ?? p.category,
    tagline: DETAIL[p.name]?.[lang]?.tagline ?? (lang === 'en' ? p.description : (p.description_de ?? p.description)),
    points: DETAIL[p.name]?.[lang]?.points ?? [],
    price: formatPrice(p.price_cents, p.currency, lang),
    perLabel: p.mode === 'subscription' ? `/ ${c.recurring}` : undefined,
    highlight: p.name === FLAGSHIP_NAME,
    isFlagship: p.name === FLAGSHIP_NAME,
  })

  if (!error && products !== null && products.length === 0) return null

  return (
    <div className="site-webhub-pricing">
      {products === null && !error && <p className="site-webhub-status">{c.loading}</p>}
      {error && <p className="site-webhub-status">{c.error}</p>}

      {products !== null && products.length > 0 && (() => {
        const renderGroup = (key: string, label: string, items: PublicProduct[]) => (
          <div key={key} className="site-webhub-group-panel">
            <div className="site-webhub-group-label">{label}</div>
            <PricingTierCarousel
              tiers={items.map(buildTier)}
              whatLabel={c.whatLabel}
              youGetLabel={c.youGetLabel}
              buyLabel={c.buy}
              flagshipBadge={c.flagshipBadge}
              onBuy={tier => {
                const p = items.find(p => p.name === tier.key)
                if (p) openCheckout(p)
              }}
            />
          </div>
        )

        return (
          <>
            {LENS_ORDER.map((lens, li) => {
              const group = products.filter(p => lensRank(p.name) === li)
              if (group.length === 0) return null
              const label = lens === 'rekonstruktion' ? c.groupRekonstruktion
                : lens === 'analysen' ? c.groupAnalysen
                : c.groupSystemaudit
              if (lens === 'systemaudit') {
                const subgroups = SUBGROUP_ORDER.map((sg, si) => ({
                  sg,
                  items: group.filter(p => subgroupRank(p.name) === si),
                })).filter(g => g.items.length > 0)
                const subLabel = (sg: SubgroupKey) =>
                  sg === 'reviews' ? c.subgroupReviews : sg === 'systemDesign' ? c.subgroupSystemDesign : c.subgroupOngoing
                // One "Systemaudit" heading for all three sub-bundles, not a
                // repeated "Systemaudit - X" label on each of the three panels
                // stacked on top of each other (flagged live).
                return (
                  <div key={lens} className="site-webhub-lens-group">
                    <div className="site-webhub-lens-label">{label}</div>
                    {subgroups.map(({ sg, items }) => renderGroup(`${lens}-${sg}`, subLabel(sg), items))}
                  </div>
                )
              }
              return renderGroup(lens, label, group)
            })}
            {agents.length > 0 && (
              <div className="site-webhub-agents">
                <div className="site-webhub-group-divider" />
                <div className="site-webhub-group-label site-webhub-agents-label">{c.agentsEyebrow}</div>
                <p className="site-webhub-agents-intro">{c.agentsIntro}</p>
                <div className="site-webhub-agents-row">
                  {agents.map(a => (
                    <div key={a.id} className="site-webhub-agent-card">
                      <span className="site-webhub-agent-builtby">{a.builtBy}</span>
                      <h4 className="site-webhub-agent-name">{a.name}</h4>
                      <p className="site-webhub-agent-desc">{a.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )
      })()}

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
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6 L18 18 M18 6 L6 18" />
              </svg>
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
    </div>
  )
}
