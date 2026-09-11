import { useEffect } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { SiteContent } from '../types/content'
import { useLang } from '../hooks/useLang'
import { useTheme } from '../hooks/useTheme'
import './InstitutionalSite.css'
import './InstitutionalFixes.css'
import institutionalFacts from '../../institutional-facts.json'

export type InstitutionalRoute =
  | 'home' | 'lab' | 'research' | 'methods' | 'systems' | 'publications' | 'observatory' | 'notes' | 'applied-research'
  | 'research-complex' | 'research-behavioral' | 'research-reconstruction' | 'research-human-ai'
  | 'research-integrity' | 'research-causality' | 'research-computational'

const BASE = import.meta.env.BASE_URL
const href = (route: InstitutionalRoute) => `${BASE}${route === 'home' ? '' : `${route}/`}`

// ---------------------------------------------------------------------------
// Content data — sourced from the 2026-09 content package
// (EIL_Complete_Website_REVISED_v2.zip). Per that package's README: DINGIR is
// the only world-state/world-model system represented (no separate "EIL
// World Model"), EIL Kernel is represented as built, Observatory is marked
// in development, and MetaCog is not represented as an implemented system.
// ---------------------------------------------------------------------------

type Domain = {
  slug: InstitutionalRoute
  titleDe: string; titleEn: string
  leadDe: string; leadEn: string
  scopeDe: string[]; scopeEn: string[]
  questionDe: string; questionEn: string
  approachDe: string; approachEn: string
  relationshipDe: string; relationshipEn: string
}

const researchDomains: Domain[] = [
  {
    slug: 'research-complex', titleDe: 'Emergente & Komplexe Systeme', titleEn: 'Emergent & Complex Systems',
    leadDe: 'Wie lokale Interaktionen systemweites Verhalten, Adaption, Instabilität und Veränderung erzeugen.',
    leadEn: 'How local interactions create system-level behavior, adaptation, instability and change.',
    scopeDe: ['Emergenz aus verteilter Interaktion', 'Systemdynamik über Zeit', 'Wechselwirkungen zwischen Systemen', 'Feedback und Kaskaden', 'interaktionsgetriebene Zustandsübergänge', 'nichtlineares Verhalten'],
    scopeEn: ['Emergence from distributed interaction', 'System dynamics across time', 'Cross-system effects', 'Feedback and cascades', 'Interaction-driven state transitions', 'Nonlinear behavior'],
    questionDe: 'Wann kippt eine Ansammlung lokaler Interaktionen in ein qualitativ neues Systemverhalten, das aus keiner Einzelkomponente allein ableitbar ist?',
    questionEn: 'When does a collection of local interactions tip into qualitatively new system-level behavior that cannot be derived from any single component alone?',
    approachDe: 'Interaktionsverläufe über Zeit beobachten, Feedback- und Kaskadeneffekte von Zufallsrauschen trennen, Zustandsübergänge markieren und prüfen, ob das entstehende Verhalten stabil, reversibel oder strukturell neu ist.',
    approachEn: 'Observe interaction trajectories over time, separate feedback and cascade effects from noise, mark state transitions and test whether the emerging behavior is stable, reversible or structurally new.',
    relationshipDe: 'Liefert die Systemdynamik-Perspektive für Rekonstruktion, Systemintegrität und Kausalität – Emergenz ist hier Untersuchungsgegenstand, nicht Erklärung für sich allein.',
    relationshipEn: 'Supplies the system-dynamics lens for Reconstruction, System Integrity and Causality — emergence is the object of study here, not a self-sufficient explanation.',
  },
  {
    slug: 'research-behavioral', titleDe: 'Behavioral & Interaction Intelligence', titleEn: 'Behavioral & Interaction Intelligence',
    leadDe: 'Verhalten und Interaktion als Evidenz für Systemzustand, Constraints und Entscheidungsdynamik nutzen.',
    leadEn: 'Using behavior and interaction as evidence about system state, constraints and decision dynamics.',
    scopeDe: ['Verhaltensmuster', 'Entscheidungsdynamik', 'Interaktionseffekte', 'adversariale Verhaltensanalyse', 'Abweichungsmuster', 'prädiktionsrelevantes Verhalten'],
    scopeEn: ['Behavioral patterns', 'Decision dynamics', 'Interaction effects', 'Adversarial behavioral analysis', 'Deviation patterns', 'Prediction-relevant behavior'],
    questionDe: 'Welcher Systemzustand, welche Beziehung oder welcher Mechanismus erklärt das beobachtete Verhalten und die vorliegende Evidenz am besten?',
    questionEn: 'What system state, relationship or mechanism best explains the observed behavior and the available evidence?',
    approachDe: 'Verhaltensspuren und Entscheidungen über Zeit sammeln, gegen erwartete Muster abgleichen, Abweichungen adversarial prüfen statt sie sofort zu erklären, und Befunde erst nach Gegenbelege-Test als prädiktionsrelevant einstufen.',
    approachEn: 'Collect behavioral traces and decisions over time, compare them against expected patterns, adversarially test deviations instead of explaining them away immediately, and only classify findings as prediction-relevant once they survive counter-evidence.',
    relationshipDe: 'Liefert die Verhaltensevidenz, auf der Systemrekonstruktion und Systemintegrität aufbauen, und speist die Observatory-Signale zu Drift und Rollenstabilität.',
    relationshipEn: 'Supplies the behavioral evidence that System Reconstruction and System Integrity build on, and feeds the Observatory\'s drift and role-stability signals.',
  },
  {
    slug: 'research-reconstruction', titleDe: 'Systemrekonstruktion', titleEn: 'System Reconstruction',
    leadDe: 'Verborgene Zustände und Mechanismen aus unvollständiger, verteilter oder longitudinaler Evidenz rekonstruieren.',
    leadEn: 'Reconstructing hidden states and mechanisms from incomplete, distributed or longitudinal evidence.',
    scopeDe: ['Hidden-State-Rekonstruktion', 'zeitliche Rekonstruktion', 'Beziehungsrekonstruktion', 'Constraint Discovery', 'Kausalketten', 'Zustandsübergänge', 'Unsicherheit und unvollständige Evidenz'],
    scopeEn: ['Hidden-state reconstruction', 'Temporal reconstruction', 'Relationship reconstruction', 'Constraint discovery', 'Causal chains', 'State transitions', 'Uncertainty and incomplete evidence'],
    questionDe: 'Welche Struktur, welcher Zustand oder welche Beziehung erklärt die verfügbaren Spuren am vollständigsten, wenn direkte Beobachtung nicht möglich ist?',
    questionEn: 'What structure, state or relationship most completely explains the available traces when direct observation is not possible?',
    approachDe: 'Fragmentierte, verteilte oder zeitlich versetzte Spuren zusammenführen, konkurrierende Rekonstruktionen gegeneinander testen, implizite Constraints aus Bruch- und Fehlerzuständen ableiten und Unsicherheit explizit halten statt sie in einer einzigen Erklärung aufzulösen.',
    approachEn: 'Bring together fragmented, distributed or time-shifted traces, test competing reconstructions against each other, infer implicit constraints from breakpoints and failure states, and keep uncertainty explicit rather than collapsing it into a single explanation.',
    relationshipDe: 'Zentrale Methode hinter DINGIR und dem Research Knowledge Graph, und Voraussetzung für belastbare Kausalitäts- und Prediction-Aussagen.',
    relationshipEn: 'The core method behind DINGIR and the Research Knowledge Graph, and a precondition for defensible causality and prediction claims.',
  },
  {
    slug: 'research-human-ai', titleDe: 'Mensch–KI-Systeme', titleEn: 'Human–AI Systems',
    leadDe: 'Untersuchung, wie sich menschliches und KI-Verhalten über langfristige Interaktion hinweg gemeinsam entwickelt – nicht in isolierten Sitzungen.',
    leadEn: 'Studying how human and AI behavior co-evolves across long-running interaction rather than isolated sessions.',
    scopeDe: ['Interaktionsverläufe', 'Adaption', 'Handlungsfähigkeit', 'Abhängigkeit', 'semantische Integrität', 'HMI / UX', 'Recovery', 'longitudinale Evaluation'],
    scopeEn: ['Interaction trajectories', 'Adaptation', 'Agency', 'Dependency', 'Semantic integrity', 'HMI / UX', 'Recovery', 'Longitudinal evaluation'],
    questionDe: 'Wie verändern sich Rollen, Handlungsfähigkeit und Vertrauen zwischen Mensch und KI über anhaltende Interaktion hinweg – und wann kippt Adaption in Abhängigkeit?',
    questionEn: 'How do roles, agency and trust between human and AI change across sustained interaction — and when does adaptation tip into dependency?',
    approachDe: 'Interaktionsverläufe longitudinal statt in Einzelsitzungen erfassen, Handlungsfähigkeit und semantische Integrität über Zeit vergleichen, Interface-bedingten Informationsverlust von tatsächlicher Verhaltensänderung trennen und Recovery nach Fehlanpassung explizit prüfen.',
    approachEn: 'Capture interaction trajectories longitudinally rather than session by session, compare agency and semantic integrity over time, separate interface-induced information loss from actual behavioral change, and explicitly test recovery after misadaptation.',
    relationshipDe: 'Verbindet die HMI-Perspektive mit Behavioral Analysis und liefert die longitudinale Baseline, gegen die das Observatory Drift und Rollenstabilität misst.',
    relationshipEn: 'Connects the HMI perspective with Behavioral Analysis and supplies the longitudinal baseline the Observatory measures drift and role stability against.',
  },
  {
    slug: 'research-integrity', titleDe: 'Systemintegrität & Runtime', titleEn: 'System Integrity & Runtime',
    leadDe: 'Verstehen, wann intelligente Systeme degradieren, ohne einen expliziten Fehler zu erzeugen.',
    leadEn: 'Understanding when intelligent systems degrade without producing an explicit error.',
    scopeDe: ['Drift', 'Regression', 'Widerspruch', 'Zustandsdivergenz', 'Constraint-Verlust', 'wiederholtes erfolgloses Verhalten', 'Runtime-Kontinuität', 'Recovery'],
    scopeEn: ['Drift', 'Regression', 'Contradiction', 'State divergence', 'Constraint loss', 'Repeated unsuccessful behavior', 'Runtime continuity', 'Recovery'],
    questionDe: 'Wo weicht der tatsächliche Systemzustand still von seinem zuvor validierten Zustand ab, ohne dass ein Fehler, ein Log oder ein Alarm das anzeigt?',
    questionEn: 'Where does the actual system state quietly diverge from its previously validated state, without an error, log or alert showing it?',
    approachDe: 'Erwarteten gegen tatsächlichen Zustand über Zeit vergleichen, wiederholtes erfolgloses Verhalten und Constraint-Verlust als eigenes Signal behandeln – nicht als Rauschen –, und Drift von echter, absichtlicher Veränderung unterscheiden, bevor Recovery eingeleitet wird.',
    approachEn: 'Compare expected against actual state over time, treat repeated unsuccessful behavior and constraint loss as a signal in its own right rather than noise, and distinguish drift from genuine, intentional change before recovery is initiated.',
    relationshipDe: 'Die Runtime-Grundlage des Observatory und von MIRROR – ohne diese Domain bleibt Drift unsichtbar, bis sie sich bereits zu einem Problem ausgewachsen hat.',
    relationshipEn: 'The runtime foundation behind the Observatory and MIRROR — without this domain, drift stays invisible until it has already grown into a problem.',
  },
  {
    slug: 'research-causality', titleDe: 'Kausalität, Prediction & DINGIR', titleEn: 'Causality, Prediction & DINGIR',
    leadDe: 'Kausale Struktur und Systemzustand rekonstruieren, um über Übergänge und plausible zukünftige Zustände zu schließen.',
    leadEn: 'Reconstructing causal structure and system state to reason about transitions and plausible future states.',
    scopeDe: ['DINGIR', 'Hidden-State-Rekonstruktion', 'Kausalketten', 'Zustandsübergänge', 'zeitliches Schließen', 'kontrafaktisches Schließen', 'Forecasting', 'Unsicherheit'],
    scopeEn: ['DINGIR', 'Hidden-state reconstruction', 'Causal chains', 'State transitions', 'Temporal reasoning', 'Counterfactual reasoning', 'Forecasting', 'Uncertainty'],
    questionDe: 'Welche kausale Kette und welche Alternativverläufe erklären einen Zustandsübergang am besten – und wann rechtfertigt das genug, um eine zukünftige Entwicklung als plausibel statt nur möglich zu bezeichnen?',
    questionEn: 'Which causal chain and which counterfactual paths best explain a state transition — and when is that enough to call a future development plausible rather than merely possible?',
    approachDe: 'Kausalketten aus rekonstruierten Zuständen ableiten, kontrafaktische Alternativen explizit gegenprüfen, zeitliches Schließen von reiner Korrelation trennen und Forecasts durchgehend mit einem Unsicherheitsgrad versehen statt mit einer einzelnen Zahl.',
    approachEn: 'Derive causal chains from reconstructed states, explicitly test counterfactual alternatives against each other, separate temporal reasoning from mere correlation, and carry forecasts with an explicit uncertainty level rather than a single number.',
    relationshipDe: 'DINGIR ist das für diese Domain repräsentierte System – es verbindet Evidenz, verborgenen Zustand, kausale Struktur, Zustandsübergänge und mögliche Zukünfte in einer Kette.',
    relationshipEn: 'DINGIR is the system represented for this domain — it chains evidence, hidden state, causal structure, state transitions and possible futures together.',
  },
  {
    slug: 'research-computational', titleDe: 'Intelligente & Computational Research Systems', titleEn: 'Intelligent & Computational Research Systems',
    leadDe: 'Entwurf der computational und Intelligence-Infrastruktur für zustandsbehaftete, mehrstufige und Multi-Agent-Forschung.',
    leadEn: 'Designing the computational and intelligence infrastructure needed for stateful, multi-step and multi-agent research.',
    scopeDe: ['Intelligence Design', 'Agent Intelligence', 'Multi-Agent Systems', 'EIL Kernel', 'Research Runtimes', 'Datenstrukturen', 'wissenschaftliche Visualisierung', 'experimentelle Infrastruktur'],
    scopeEn: ['Intelligence Design', 'Agent Intelligence', 'Multi-Agent Systems', 'EIL Kernel', 'Research runtimes', 'Data structures', 'Scientific visualization', 'Experimental infrastructure'],
    questionDe: 'Welche Architektur hält relevanten Zustand, Evidenz und Kontext über lange, mehrstufige und Multi-Agent-Forschungsprozesse hinweg zugänglich, statt sie im Arbeitskontext einer einzelnen Sitzung verloren gehen zu lassen?',
    questionEn: 'What architecture keeps relevant state, evidence and context accessible across long, multi-step, multi-agent research processes instead of letting it get lost in a single session\'s working context?',
    approachDe: 'Wiederkehrende analytische Operationen identifizieren und in spezialisierte Agentenrollen mit klaren Inputs, Outputs und Handoffs übersetzen, Zustand und Evidenz zentral statt pro Agent halten, und Infrastruktur erst nach echtem, wiederholtem Forschungsbedarf bauen.',
    approachEn: 'Identify recurring analytical operations and translate them into specialized agent roles with clear inputs, outputs and handoffs, hold state and evidence centrally rather than per agent, and build infrastructure only after genuine, repeated research demand.',
    relationshipDe: 'Die Infrastrukturebene hinter dem EIL Kernel, der Multi-Agent Research Environment und dem Research Knowledge Graph – macht die anderen sechs Domains operativ ausführbar.',
    relationshipEn: 'The infrastructure layer behind the EIL Kernel, the Multi-Agent Research Environment and the Research Knowledge Graph — what makes the other six domains operationally executable.',
  },
]


const intelligenceSystems = [
  ['JARVIS', 'MULTI-AGENT ORCHESTRATION', 'Koordiniert mehrere spezialisierte Agenten in einem gemeinsamen Workflow – verteilt Teilaufgaben, sammelt Ergebnisse zusammen und hält den Gesamtstatus, während einzelne Agenten unabhängig laufen.', 'Coordinates multiple specialized agents within one shared workflow — distributes subtasks, gathers their results back together and tracks overall status while individual agents run independently.', 'Ohne Orchestrator müsste jeder Agent selbst wissen, wann er dran ist und an wen er sein Ergebnis übergibt. JARVIS hält diese Reihenfolge und Zuständigkeit zentral, statt es jedem Agenten einzeln aufzubürden, und erkennt, wenn ein Agent nichts mehr liefert.', "Without an orchestrator, every agent would need to know on its own when it's its turn and who to hand results to. JARVIS holds that sequencing and ownership centrally instead of burdening every agent with it individually, and notices when an agent stops delivering."],
  ['NYX', 'SECURITY & VULNERABILITY SCANNING', 'Scannt Angriffsfläche, Abhängigkeiten, Konfiguration und exponierte Credentials und liefert eine nach Schweregrad sortierte Liste, was zuerst gefixt werden muss.', 'Scans attack surface, dependencies, configuration and exposed credentials, and delivers a severity-ranked list of what to fix first.', 'Beobachtet offene Ports, exponierte Services, TLS-Zertifikatsstatus und neu veröffentlichte CVEs, die den eigenen Stack betreffen. Erkennt bekannte Schwachstellen in Abhängigkeiten, falsch konfigurierte Zugriffsrechte und ungenutzte Accounts mit noch aktivem Zugriff. Liefert einen Bericht mit CVSS-artiger Einstufung pro Fund, der direkt an ein Entwicklungsteam übergeben werden kann.', 'Monitors open ports, exposed services, TLS certificate health and newly published CVEs affecting the stack. Detects known vulnerabilities in dependencies, misconfigured access rights and unused accounts still holding live access. Delivers a report with a CVSS-style severity rating per finding, ready to hand directly to a dev team.'],
  ['MIRROR', 'SYSTEM INTEGRITY', 'Erkennt Widerspruch, Drift, Regression und Abweichung von zuvor validierten Systemzuständen – bevor die Lücke zum eigentlichen Problem wird.', 'Detects contradiction, drift, regression and divergence from previously validated system states — before the gap becomes the actual problem.', 'Beobachtet Plan gegen tatsächlichen Zustand, Regelkonformität, Zielwerte gegen Ergebnisse und Team-Velocity gegen Zusagen. Erkennt stillschweigende Workarounds, ausgehöhlte Kennzahlen und übersehene Fristen. Liefert eine Frühwarnung statt eines Post-mortems, mit einer laufenden Integritäts-Kennzahl.', 'Monitors plan versus actual state, rule compliance, targets versus outcomes and team velocity versus commitments. Detects quiet workarounds, hollowed-out metrics and overlooked deadlines. Delivers an early warning instead of a post-mortem, with a running integrity score.'],
  ['ROBERT', 'SALES INTELLIGENCE', 'Sales-Intelligence-Agent, der Leads recherchiert, qualifiziert und Kontext für Outreach zusammenstellt – koordiniert über mehrere spezialisierte Teilrollen.', 'Sales-intelligence agent that researches and qualifies leads and assembles outreach context — coordinated across several specialized sub-roles.', 'Sammelt öffentlich verfügbare Signale zu einem Unternehmen – Größe, Branche, aktuelle Aktivität, passende Ansprechpartner – und bringt sie in eine Form, mit der eine Erstansprache konkret statt generisch sein kann. Ersetzt keine menschliche Entscheidung, wer angesprochen wird, liefert aber die Grundlage dafür.', "Gathers publicly available signals about a company — size, sector, current activity, relevant contacts — and turns them into something a first outreach message can actually be specific about instead of generic. Doesn't replace the human decision of who to reach out to, but supplies the basis for it."],
  ['ARGUS', 'INFORMATION INTELLIGENCE', 'Beobachtet Markt-, Presse- und Wettbewerbssignale kontinuierlich und markiert relevante Veränderungen, sobald sie auftreten – statt in periodischen Digests.', 'Continuously monitors market, press and competitive signals and flags relevant changes as they occur — rather than in periodic digests.', 'Beobachtet Wettbewerber-Ankündigungen, Erwähnungen, Presse, Stimmungsverschiebungen, Führungswechsel und Produktlaunches. Erkennt neue Marktbewegungen, sich formende Narrative und frühe Anzeichen eines Marktwandels. Liefert einen tagesaktuellen Alert statt eines wöchentlichen Digests, mit Historie und Quellenangabe.', 'Monitors competitor announcements, mentions, press, sentiment shifts, leadership changes and product launches. Detects emerging market movements, narratives forming before mainstream coverage and early signs of a market shift. Delivers a same-day alert instead of a weekly digest, with history and sourcing.'],
  ['ATLAS', 'ORCHESTRATION', 'Priorisiert und orchestriert Signale aus mehreren spezialisierten Agenten, macht Dringlichkeit sichtbar und löst Widersprüche zwischen Einzelbefunden auf.', 'Prioritizes and orchestrates signals across multiple specialized agents, surfacing urgency and resolving conflicts between their individual findings.', 'Beobachtet, was jeder Agent findet, welche Alerts sich überschneiden und wo Agenten voneinander abhängen. Erkennt widersprüchliche Berichte, doppelte Alerts und Engpässe zwischen Agenten. Liefert eine einzige priorisierte Liste statt zehn Einzelmeldungen, mit klarer nächster Handlung.', 'Monitors what every agent is finding, which alerts overlap and where agents depend on each other. Detects conflicting reports, duplicate alerts and bottlenecks between agents. Delivers one ranked list instead of ten separate alerts, with a clear next action.'],
  ['KOPERNIKUS', 'EXECUTION', 'Identifiziert Förder- und Kapitalquellen, die tatsächlich zum untersuchten System passen, statt generischer Datenbank-Treffer.', 'Identifies funding and capital sources that actually match the system under study, rather than generic database matches.', 'Beobachtet offene Förderprogramme, Investorenaktivität, neue Finanzierungsrunden und Bewerbungsfristen. Erkennt tatsächlich passende Programme, sich ändernde Eligibility-Regeln und knapp werdende Deadlines. Liefert eine kurze Liste echter Optionen statt eines Datenbank-Dumps, sortiert nach Passung und Frist.', 'Monitors open grant programs, investor activity, new funding rounds and application deadlines. Detects genuinely matching programs, changing eligibility rules and closing deadlines. Delivers a short list of real options instead of a database dump, ranked by fit and deadline.'],
  ['JANUS', 'SPECIALIZED AGENT', 'Spezialisiertes Intelligence-System; öffentliche Details bewusst begrenzt.', 'Specialized intelligence system; public detail intentionally limited.'],
  ['DAEDALUS', 'SPECIALIZED AGENT', 'Spezialisiertes Intelligence-System; öffentliche Details bewusst begrenzt.', 'Specialized intelligence system; public detail intentionally limited.'],
  ['DELTA', 'SPECIALIZED AGENT', 'Spezialisiertes Intelligence-System; öffentliche Details bewusst begrenzt.', 'Specialized intelligence system; public detail intentionally limited.'],
] as const

const engagements = [
  ['System Reconstruction', 'Case Intake Scan', '€700', 'Intake, erste Evidenzgrenzen und priorisierte offene Fragen.', 'Intake, initial evidence boundaries and prioritized open questions.'],
  ['System Reconstruction', 'Mangelcluster Sprint', '€2,200', 'Quellengebundene Mängel-, Themen- und Widerspruchsstruktur.', 'Source-traceable defect, theme and contradiction structure.'],
  ['System Reconstruction', 'Emergent Case Intelligence Sprint', '€12,500', 'Vollständige Rekonstruktion eines komplexen Falls.', 'Full reconstruction of a complex case.'],
  ['System Audit', 'Systemaudit', '€4,500', 'Diagnose von System, Organisation, Prozess, Produkt und Interaktion.', 'Diagnosis of system, organization, process, product and interaction.'],
  ['System Design', 'Framework Design from Analysis', '€19,500', 'Prüfregeln, Rollen, Kontrolllogik und Schnittstellen.', 'Review rules, roles, control logic and interfaces.'],
  ['System Design', 'Multi-Agent System Design', '€24,500', 'Baubare Spezifikation mit State, Memory, Audit und Drift.', 'Build-ready specification with state, memory, audit and drift.'],
  ['Implementation', 'Implementation Build', '€35,000', 'Technische Umsetzung; Engineering-Anteil separat ausgewiesen.', 'Technical implementation; engineering contribution credited separately.'],
  ['Ongoing Research Support', 'Retainer / Monitoring', '€2,700 / month', 'Review, Drift-Checks, Framework-Updates und laufende Kontrolle.', 'Review, drift checks, framework updates and ongoing control.'],
] as const

function Mark() { return <img className="eil-approved-mark" src={`${BASE}eil-favicon.png`} alt="" aria-hidden="true" /> }
function Status({ children }: { children: ReactNode }) { return <span className="eil-status">{children}</span> }
function handleAccordionToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
  const target = e.currentTarget
  if (target.open) {
    const groupName = target.getAttribute('name')
    const container = target.closest('.eil-section, section, .eil-main, .eil-site') || document
    const selector = groupName ? `details[name="${groupName}"]` : 'details.eil-fold-card, details.eil-disclosure'
    container.querySelectorAll<HTMLDetailsElement>(selector).forEach((el) => {
      if (el !== target && el.open) {
        el.open = false
      }
    })
  }
}
function Disclosure({ summary, children, group }: { summary: string; children: ReactElement | ReactElement[]; group?: string }) {
  return <details className="eil-disclosure" name={group || "eil-disclosure"} onToggle={handleAccordionToggle}><summary>{summary}</summary><div className="eil-disclosure-body">{children}</div></details>
}
function FoldCard({ title, subtitle, kicker, children, className = '', group }: { title: string; subtitle?: string; kicker?: ReactNode; children: ReactNode; className?: string; group?: string }) {
  return <details className={`eil-fold-card ${className}`.trim()} name={group || "eil-fold-card"} onToggle={handleAccordionToggle}><summary>{kicker&&<span className="eil-fold-kicker">{kicker}</span>}<strong>{title}</strong>{subtitle&&<small>{subtitle}</small>}</summary><div className="eil-fold-body">{children}</div></details>
}

export function InstitutionalSite({ route, content }: { route: InstitutionalRoute; content: SiteContent }) {
  const { lang, setLang } = useLang()
  const { theme, cycle } = useTheme()
  const de = lang === 'de'
  const tx = (german: string, english: string) => de ? german : english
  // Mirrors the zip content package's own <nav> order (index.html etc.):
  // Lab, Research, Systems, Methods, Publications, Observatory, Applied Research.
  const navigation: Array<[InstitutionalRoute, string, string]> = [
    ['lab', 'Lab', 'Lab'], ['research', 'Forschung', 'Research'], ['systems', 'Systeme', 'Systems'],
    ['methods', 'Methoden', 'Methods'], ['publications', 'Publikationen', 'Publications'],
    ['observatory', 'Observatory', 'Observatory'], ['applied-research', 'Applied Research', 'Applied Research'],
  ]

  useEffect(() => {
    const names: Record<InstitutionalRoute, string> = {
      home: '', lab: 'Lab', research: tx('Forschung', 'Research'), methods: tx('Methoden', 'Methods'),
      systems: tx('Systeme', 'Systems'), publications: tx('Publikationen', 'Publications'), observatory: 'Observatory',
      notes: 'Research Notes', 'applied-research': 'Applied Research',
      'research-complex': tx('Emergente & Komplexe Systeme', 'Emergent & Complex Systems'),
      'research-behavioral': 'Behavioral & Interaction Intelligence',
      'research-reconstruction': tx('Systemrekonstruktion', 'System Reconstruction'),
      'research-human-ai': tx('Mensch–KI-Systeme', 'Human–AI Systems'),
      'research-integrity': tx('Systemintegrität & Runtime', 'System Integrity & Runtime'),
      'research-causality': tx('Kausalität, Prediction & DINGIR', 'Causality, Prediction & DINGIR'),
      'research-computational': tx('Intelligente & Computational Research Systems', 'Intelligent & Computational Research Systems'),
    }
    document.title = `${names[route] ? `${names[route]} · ` : ''}Emergent Interaction Lab`
  }, [route, lang])

  const Header = () => <header className="eil-header">
    <a className="eil-brand" href={href('home')} aria-label="Emergent Interaction Lab — Home"><Mark /></a>
    <nav className="eil-nav" aria-label={tx('Hauptnavigation', 'Primary navigation')}>
      {navigation.map(([id, d, e]) => <a key={id} href={href(id)} className={route === id ? 'active' : ''}>{tx(d, e)}</a>)}
    </nav>
    <div className="eil-tools"><button onClick={() => setLang(de ? 'en' : 'de')}>{lang.toUpperCase()}</button><button onClick={cycle} aria-label={tx('Farbschema wechseln', 'Change color scheme')}>{theme === 'dark' ? '◐' : theme === 'light' ? '○' : '◉'}</button><a className="eil-contact-link" href={`${href('home')}#contact`}>{tx('Kontakt', 'Contact')}</a><details className="eil-mobile-menu"><summary aria-label={tx('Menü öffnen', 'Open menu')}>☰</summary><nav>{navigation.map(([id,d,e])=><a key={id} href={href(id)}>{tx(d,e)}</a>)}<a href={href('notes')}>Research Notes</a></nav></details></div>
  </header>

  // Footer content/structure mirrors the zip content package's own <footer>
  // (Explore: Research/Systems/Publications · Lab: About EIL/Observatory/
  // Applied Research). Only the functional necessities from the previous
  // footer are kept wired: language/theme toggles live in the header, and
  // the legal routes (#p/impressum, #p/datenschutz) plus GitHub/Research
  // Notes links stay reachable since those routes still exist server-side.
  const Footer = () => <footer className="eil-footer">
    <p className="eil-doctrine">Human rights are not subject to negotiation.<small>{tx('Emergent Interaction Lab · unabhängige Forschungsinstitution', 'Emergent Interaction Lab · independent research institution')}</small></p>
    <div className="eil-footer-row">
      <div className="eil-footer-brand"><Mark /><strong>Emergent Interaction Lab</strong></div>
      <nav className="eil-footer-links">
        <a href={href('research')}>{tx('Forschung', 'Research')}</a>
        <a href={href('systems')}>{tx('Systeme', 'Systems')}</a>
        <a href={href('publications')}>{tx('Publikationen', 'Publications')}</a>
        <a href={href('lab')}>{tx('Über EIL', 'About EIL')}</a>
        <a href={href('observatory')}>Observatory</a>
        <a href={href('applied-research')}>Applied Research</a>
        <a href={href('notes')}>Research Notes</a>
        <a href="https://github.com/rfi-irfos/emergent-interaction-lab">GitHub</a>
        <a href={`${href('home')}#p/datenschutz`}>Datenschutz</a>
        <a href={`${href('home')}#p/impressum`}>Impressum</a>
      </nav>
    </div>
  </footer>

  // Breadcrumb trail mirrors the zip content package's own pattern:
  // `Home / <Page>` for one-level pages, `Home / Research / <Domain>` for the
  // 7 research-domain detail pages. Last segment is plain text (current page).
  const Breadcrumbs = ({ trail }: { trail: Array<[string, InstitutionalRoute | null]> }) => {
    // Domain detail pages are 3 levels deep (Start / Research / <Domain>) and
    // were a dead end before this: no way back except the browser's own back
    // button, flagged live as a "Sackgasse" — the breadcrumb trail alone
    // wasn't prominent enough. An explicit arrow-back to the parent level
    // fixes that for any nested page, not just research domains.
    const parent = trail.length > 2 ? trail[trail.length - 2] : null
    return (
      <div className="eil-crumb-row">
        {parent && parent[1] && <a className="eil-back-link" href={href(parent[1])} aria-label={tx('Zurück', 'Back')}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg></a>}
        <div className="eil-breadcrumbs">
          {trail.map(([label, r], i) => (
            <span key={label}>
              {r ? <a href={href(r)}>{label}</a> : label}
              {i < trail.length - 1 ? ' / ' : ''}
            </span>
          ))}
        </div>
      </div>
    )
  }

  const PageHero = ({ eyebrow, title, body, crumbs }: { eyebrow: string; title: string; body: string; crumbs: Array<[string, InstitutionalRoute | null]> }) => <>
    <Breadcrumbs trail={crumbs} />
    <section className="eil-page-hero"><Status>{eyebrow}</Status><h1>{title}</h1><p>{body}</p></section>
  </>

  // -- Home ------------------------------------------------------------
  const Home = () => <>
    <section className="eil-home-hero"><div><Status>{tx('UNABHÄNGIGES FORSCHUNGSLABOR','INDEPENDENT RESEARCH LAB')}</Status><img className="eil-hero-wordmark-image" src={`${BASE}eil-hero-wordmark-full-alpha.png`} alt="Emergent Interaction Lab" /><h1 className="eil-hero-statement">{tx('EIL untersucht, wie menschliche, computationale und sozio-technische Systeme sich verhalten, interagieren, verändern und beobachtbar werden.', 'EIL investigates how human, computational and socio-technical systems behave, interact, change and become observable.')}</h1><div className="eil-actions"><a href={href('research')}>{tx('Forschung ansehen', 'Explore research')} →</a><a href={href('methods')}>{tx('Methoden', 'Methods')}</a></div></div></section>

    <section className="eil-section"><div className="eil-section-head"><Status>{tx('EIN LAB, MEHRERE VERBUNDENE FORSCHUNGSSCHICHTEN', 'ONE LAB, MULTIPLE INTERACTING RESEARCH LAYERS')}</Status><h2>{tx('Ein Lab. Mehrere ineinandergreifende Forschungsschichten.', 'One lab. Multiple interacting research layers.')}</h2><p>{tx('EIL ist keine Framework-Sammlung, kein reines Human–AI-Lab und kein Agentenkatalog. Die Arbeit verbindet Interaktion, Systemdynamik, Rekonstruktion, Intelligence Architecture, Runtime-Integrität, Kausalität, Experimentation und Evaluation.', 'EIL is not a framework collection, a Human–AI lab only, or an agent catalogue. Its work connects interaction, system dynamics, reconstruction, intelligence architecture, runtime integrity, causality, experimentation and evaluation.')}</p></div>
      <div className="eil-domain-chips">{['Emergent Interaction', 'Complex Systems', 'System Reconstruction', 'Intelligence Architecture', 'Multi-Agent Systems', 'DINGIR'].map(x => <span key={x}>{x}</span>)}</div>
      <div className="eil-role-grid" style={{ marginTop: 32 }}>
        <article><span className="eil-fold-kicker">{tx('EMERGENZ & DYNAMIK', 'EMERGENCE & DYNAMICS')}</span><h3>{tx('Interaktion', 'Interaction')}</h3><p>{tx('Wie lokale Interaktionen globales Verhalten, Struktur, Adaption und Veränderung über Zeit erzeugen.', 'How local interactions generate global behavior, structure, adaptation and change over time.')}</p></article>
        <article><span className="eil-fold-kicker">{tx('VERBORGENE ZUSTÄNDE & ÜBERGÄNGE', 'HIDDEN STATES & TRANSITIONS')}</span><h3>{tx('Rekonstruktion', 'Reconstruction')}</h3><p>{tx('Wie sich aus unvollständiger Evidenz Zustand, Beziehungen, Constraints und kausale Struktur rekonstruieren lassen.', 'How incomplete evidence can be used to reconstruct state, relationships, constraints and causal structure.')}</p></article>
        <article><span className="eil-fold-kicker">{tx('ARCHITEKTUREN, DIE UNTERSUCHEN', 'ARCHITECTURES THAT INVESTIGATE')}</span><h3>Intelligence</h3><p>{tx('Wie spezialisierte intelligente Systeme schließen, Zustand bewahren, koordinieren, Hypothesen prüfen, Fehler erkennen und sich erholen.', 'How specialized intelligent systems reason, preserve state, coordinate, test hypotheses, detect failure and recover.')}</p></article>
      </div>
    </section>

    <section className="eil-section"><div className="eil-section-head"><Status>{tx('RESEARCH MAP', 'RESEARCH MAP')}</Status><h2>{tx('Vier Ausschnitte aus sieben Forschungsdomänen.', 'Four glimpses across seven research domains.')}</h2></div>
      <div className="eil-domain-grid">
        <a className="eil-card" href={href('research-complex')}><Status>DOMAIN</Status><h3>{tx('Emergente & Komplexe Systeme', 'Emergent & Complex Systems')}</h3><p>{tx('Verteilte Interaktion, Systemdynamik und Wechselwirkungen zwischen Systemen.', 'Distributed interaction, system dynamics and cross-system effects.')}</p></a>
        <a className="eil-card" href={href('research-reconstruction')}><Status>DOMAIN</Status><h3>{tx('Systemrekonstruktion', 'System Reconstruction')}</h3><p>{tx('Verborgener Zustand, zeitliche Struktur, Evidenz und Übergangslogik.', 'Hidden state, temporal structure, evidence and transition logic.')}</p></a>
        <a className="eil-card" href={href('research-computational')}><Status>DOMAIN</Status><h3>{tx('Intelligente Systemarchitekturen', 'Intelligent System Architectures')}</h3><p>{tx('Agent-Intelligence, Multi-Agent-Systeme, Runtime und Forschungsinfrastruktur.', 'Agent intelligence, multi-agent systems, runtime and research infrastructure.')}</p></a>
        <a className="eil-card" href={href('research-human-ai')}><Status>DOMAIN</Status><h3>{tx('Mensch–KI-Systeme', 'Human–AI Systems')}</h3><p>{tx('Longitudinale Interaktion, HMI, Handlungsfähigkeit, Adaption und Evaluation.', 'Longitudinal interaction, HMI, agency, adaptation and evaluation.')}</p></a>
      </div>
      <a className="eil-text-link" href={href('research')}>{tx('Alle Domains ansehen', 'View all domains')} →</a>
    </section>

    <section className="eil-callout eil-research-environment"><Status>{tx('KI-GESTÜTZTE FORSCHUNG JENSEITS VON PROMPTING', 'AI-SUPPORTED RESEARCH BEYOND PROMPTING')}</Status><h2>{tx('KI bei EIL ist in strukturierte Forschungssysteme eingebettet.', 'AI at EIL is embedded into structured research systems.')}</h2><p>{tx('Die relevante Arbeit liegt in Architektur, Zustand, Evidenz, Reasoning, Rekonstruktion, Validierung und Kontinuität – nicht in isolierten Prompts.', 'The relevant work lies in architecture, state, evidence, reasoning, reconstruction, validation and continuity — not isolated prompts.')}</p>
      <small>{['Observe','Decompose','Reconstruct','Hypothesize','Challenge','Validate','Update'].join(' → ')}</small>
      <div style={{ marginTop: 26 }}><a className="eil-text-link" href={href('methods')}>{tx('Research Architecture ansehen', 'Explore research architecture')} →</a></div>
    </section>

    <section className="eil-section"><div className="eil-section-head"><Status>{tx('AUSGEWÄHLTE SYSTEME', 'SELECTED SYSTEMS')}</Status><h2>{tx('Vier von zehn Intelligence-Systemen.', 'Four of ten intelligence systems.')}</h2></div>
      <div className="eil-system-grid">{[intelligenceSystems[0], intelligenceSystems[1], intelligenceSystems[2], intelligenceSystems[3]].map(([name, kicker, d, e]) => <article className="eil-card" key={name}><Status>{kicker}</Status><h3>{name}</h3><p>{tx(d, e)}</p></article>)}</div>
      <a className="eil-text-link" href={href('systems')}>{tx('Systemarchitektur ansehen', 'Explore system architecture')} →</a>
    </section>

    <section className="eil-section eil-environment-overview"><div className="eil-section-head"><Status>{tx('INFRASTRUKTUR & AKTIVE FORSCHUNGSSYSTEME', 'INFRASTRUCTURE & ACTIVE RESEARCH SYSTEMS')}</Status><h2>{tx('Drei Systeme, drei unterschiedliche Reifegrade.', 'Three systems, three different maturity states.')}</h2></div>
      <div className="eil-environment-grid">
        <article><Status>{tx('GEBAUT', 'BUILT')}</Status><h3>EIL Kernel</h3><p>{tx('Existierende Runtime-Grundlage für zustandsbehaftete Agenten- und Forschungssysteme, inklusive Runtime, State, Context, Memory, Monitoring, Evidence, Recovery, Tests und Audit Trails.', 'Existing runtime foundation for stateful agent and research systems, including runtime, state, context, memory, monitoring, evidence, recovery, tests and audit trails.')}</p></article>
        <article><Status>{tx('AKTIVE FORSCHUNG', 'ACTIVE RESEARCH')}</Status><h3>DINGIR</h3><p>{tx('Das kollaborative System für Hidden-State-Rekonstruktion, Kausalketten, Zustandsübergänge und Prediction.', 'The collaborative system for hidden-state reconstruction, causal chains, state transitions and prediction.')}</p></article>
        <article><Status>{tx('IN ENTWICKLUNG', 'IN DEVELOPMENT')}</Status><h3>Observatory</h3><p>{tx('Experimentelle Forschungsumgebung für System-Observability, Rekonstruktionen, Daten und Visualisierung.', 'Experimental research environment for system observability, reconstructions, data and visualization.')}</p></article>
      </div>
    </section>

    <section className="eil-contact" id="contact"><div><Status>CONTACT</Status><h2>{tx('Mit dem Lab arbeiten', 'Work with the Lab')}</h2><p>{tx('Forschungskooperation, methodische Rückfrage oder Applied-Research-Anfrage.', 'Research collaboration, methodology question or applied-research enquiry.')}</p></div><form action="https://api.web3forms.com/submit" method="POST" className="eil-contact-form"><input type="hidden" name="access_key" value={import.meta.env.VITE_WEB3FORMS_KEY ?? ''}/><input type="hidden" name="subject" value="Emergent Interaction Lab enquiry"/><input name="name" required placeholder={tx('Name', 'Name')}/><input name="email" type="email" required placeholder={tx('E-Mail', 'Email')}/><textarea name="message" required rows={4} placeholder={tx('Worum geht es?', 'What would you like to discuss?')}/><button type="submit">{tx('Anfrage senden', 'Send enquiry')} →</button></form></section>
  </>

  // -- Lab ---------------------------------------------------------------
  const Lab = () => <>
    <PageHero eyebrow="LAB" title="Lab" body={tx('Eine interdisziplinäre Umgebung für die Rekonstruktion und den Entwurf komplexer intelligenter Systeme.', 'An interdisciplinary environment for reconstructing and designing complex intelligent systems.')} crumbs={[[tx('Start', 'Home'), 'home'], ['Lab', null]]} />
    <section className="eil-thesis"><p>{tx('EIL untersucht Emergenz, Interaktion, verborgenen Zustand, Systemverhalten und Intelligence über menschliche, computationale und sozio-technische Systeme hinweg. Methoden, Agenten, Datensätze und Software des Labs sind Instrumente innerhalb dieser größeren Forschungsumgebung.', 'EIL investigates emergence, interaction, hidden state, system behavior and intelligence across human, computational and socio-technical systems. Its methods, agents, datasets and software are instruments inside that larger research environment.')}</p></section>
    <section className="eil-section"><div className="eil-section-head"><Status>{tx('WAS EIL IST', 'WHAT EIL IS')}</Status><h2>{tx('EIL ist die maßgebliche Forschungsumgebung.', 'EIL is the paramount research environment.')}</h2><p>{tx('Kein einzelnes Framework, Benchmark, keine Agentenfamilie und keine Human–AI-Forschungslinie definiert das Lab für sich allein.', 'No single framework, benchmark, agent family or Human–AI research line defines the lab on its own.')}</p></div>
      <div className="eil-role-grid">
        <article><h3>{tx('Emergente Interaktion', 'Emergent Interaction')}</h3><p>{tx('Wie Interaktion zwischen Komponenten, Agenten, Menschen und Systemen Verhalten erzeugt, das sich nicht aus isolierten Teilen verstehen lässt.', 'How interaction between components, agents, people and systems generates behavior that cannot be understood from isolated parts.')}</p></article>
        <article><h3>{tx('Rekonstruktion verborgener Zustände', 'Hidden State Reconstruction')}</h3><p>{tx('Wie sich verborgene Zustände, Constraints, Beziehungen und kausale Strukturen aus unvollständiger Evidenz ableiten lassen.', 'How hidden states, constraints, relationships and causal structures can be inferred from incomplete evidence.')}</p></article>
        <article><h3>{tx('Intelligente Architekturen', 'Intelligent Architectures')}</h3><p>{tx('Wie Reasoning, Zustand, Memory, Evidenz, Koordination, Validierung und Recovery in autonome und Multi-Agent-Systeme eingebaut werden.', 'How reasoning, state, memory, evidence, coordination, validation and recovery are designed into autonomous and multi-agent systems.')}</p></article>
      </div>
    </section>
    <section className="eil-callout"><Status>{tx('KI-GESTÜTZT & LONGITUDINAL', 'AI-AUGMENTED & LONGITUDINAL')}</Status><h2>{tx('Statt isoliertem Prompting: kontinuierliche Arbeit mit KI über ausgedehnte Interaktionsverläufe hinweg.', 'Rather than isolated prompting: continuous work with AI across extended interaction histories.')}</h2><p style={{ marginTop: 12, fontFamily: "'Archivo', system-ui, sans-serif", fontWeight: 500, fontSize: 17 }}>{tx('Für Forschung, Analyse, Rekonstruktion, Modellierung, Systemdesign, Experimentation und Validierung.', 'For research, analysis, reconstruction, modeling, system design, experimentation and validation.')}</p><small>{['State','Context','Memory','Evidence','Reasoning','Hypotheses','Reconstruction','Challenge','Validation','Recovery'].join(' · ')}</small></section>
    <section className="eil-section"><div className="eil-role-grid">
      <article><h3>{tx('Intelligence Design', 'Intelligence Design')}</h3><p>{tx('Entwurf, wie ein intelligentes System ein Problem zerlegt, relevanten Zustand hält, Hypothesen generiert und verwirft, Pfade priorisiert, mit Unsicherheit umgeht, Widerspruch erkennt und seine nächsten Schritte aktualisiert.', 'Designing how an intelligent system decomposes a problem, maintains relevant state, generates and rejects hypotheses, prioritizes paths, handles uncertainty, recognizes contradiction and updates its next actions.')}</p></article>
      <article><h3>{tx('Multi-Agent Intelligence', 'Multi-Agent Intelligence')}</h3><p>{tx('Entwurf von Spezialisierung, Handoffs, Koordination und geteiltem Forschungszustand über größere Agentenstrukturen hinweg, statt jeden Agenten als isoliertes Interface zu behandeln.', 'Designing specialization, handoffs, coordination and shared research state across larger agent structures rather than treating every agent as an isolated interface.')}</p></article>
      <article><h3>{tx('Research Continuity', 'Research Continuity')}</h3><p>{tx('Bewahrung von Constraints, Evidenz, Entscheidungen und zuvor korrekten Zuständen über lang laufende Forschungs- und Betriebsprozesse hinweg.', 'Preserving constraints, evidence, decisions and prior correct states across long-running research and operational processes.')}</p></article>
    </div></section>
    <section className="eil-two-col">
      <article><Status>{tx('GRÜNDERIN · RESEARCH & INTELLIGENCE ARCHITECTURE', 'FOUNDER · RESEARCH & INTELLIGENCE ARCHITECTURE')}</Status><h2>Laura Serna Gaviria</h2><p>{tx('Laura Serna Gaviria gründete EIL. Ihre Arbeit konzentriert sich auf Research Architecture, Intelligence Design, Multi-Agent-Architektur, Systemrekonstruktion, Hidden-State-Reasoning, Behavioral-/System-Analyse, kausale und Übergangslogik, Evaluationsarchitektur und experimentelles Forschungsdesign.', 'Laura Serna Gaviria founded EIL. Her work centers on research architecture, intelligence design, multi-agent architecture, system reconstruction, hidden-state reasoning, behavioral/system analysis, causal and transition logic, evaluation architecture and experimental research design.')}</p></article>
      <article><Status>{tx('VERHÄLTNIS ZU RFI-IRFOS', 'RELATIONSHIP WITH RFI-IRFOS')}</Status><h2>{tx('Getrennte Rollen, explizite Attribution.', 'Distinct roles, explicit attribution.')}</h2><p>{tx('EIL und RFI-IRFOS sind getrennt. Kollaborative Systeme müssen Research-/Intelligence-Architektur von technischer Implementierung und Infrastrukturbeiträgen trennen, statt alle Arbeit einer Seite zuzuschreiben.', 'EIL and RFI-IRFOS are distinct. Collaborative systems must separate research/intelligence architecture from technical implementation and infrastructure contributions instead of attributing all work to one side.')}</p></article>
    </section>
  </>

  // -- Research ------------------------------------------------------------
  const Research = () => <>
    <PageHero eyebrow="RESEARCH" title={tx('Forschung', 'Research')} body={tx('Forschungsdomänen, verbunden durch Interaktion, Zustand und Systemveränderung.', 'Research domains connected by interaction, state and system change.')} crumbs={[[tx('Start', 'Home'), 'home'], [tx('Forschung', 'Research'), null]]} />
    <section className="eil-section"><div className="eil-section-head"><p>{tx('Die Research Map trennt Fragen von den Systemen, Methoden und Outputs, mit denen sie untersucht werden. EIL bleibt die übergreifende Umgebung über alle Domains hinweg.', 'The research map separates questions from the systems, methods and outputs used to investigate them. EIL remains the overarching environment across all domains.')}</p></div>
      <div className="eil-domain-grid">{researchDomains.map(d => <a className="eil-card" key={d.slug} href={href(d.slug)}><Status>{tx('FORSCHUNGSDOMÄNE', 'RESEARCH DOMAIN')}</Status><h3>{tx(d.titleDe, d.titleEn)}</h3><p>{tx(d.leadDe, d.leadEn)}</p><span className="eil-text-link">{tx('Domain öffnen', 'Open domain')} →</span></a>)}</div>
    </section>
  </>

  const ResearchDomainDetail = (d: Domain) => <div className="eil-domain-detail">
    <PageHero eyebrow={tx('FORSCHUNGSDOMÄNE', 'RESEARCH DOMAIN')} title={tx(d.titleDe, d.titleEn)} body={tx(d.leadDe, d.leadEn)} crumbs={[[tx('Start', 'Home'), 'home'], [tx('Forschung', 'Research'), 'research'], [tx(d.titleDe, d.titleEn), null]]} />
    <section className="eil-section"><div className="eil-section-head"><Status>SCOPE</Status></div>
      <div className="eil-domain-chips">{(de ? d.scopeDe : d.scopeEn).map(x => <span key={x}>{x}</span>)}</div>
      {d.slug === 'research-causality' && <p style={{ marginTop: 22, color: 'var(--soft)' }}>{tx('DINGIR ist EILs kollaboratives System für Hidden-State-Rekonstruktion, Kausalketten, Zustandsübergänge und prädiktives Reasoning – das für diese Domain repräsentierte System. ', 'DINGIR is EIL\'s collaborative system for hidden-state reconstruction, causal chains, state transitions and predictive reasoning — the system represented for this domain. ')}<a className="eil-text-link" href={href('systems')} style={{ marginTop: 0, display: 'inline' }}>{tx('Mehr zu DINGIR auf der Systeme-Seite', 'More on DINGIR on the Systems page')} →</a></p>}
    </section>
    <section className="eil-two-col eil-domain-qa">
      <article><Status>{tx('FORSCHUNGSFRAGE', 'RESEARCH QUESTION')}</Status><h2>{tx(d.questionDe, d.questionEn)}</h2></article>
      <article><Status>{tx('FORSCHUNGSANSATZ', 'RESEARCH APPROACH')}</Status><p>{tx(d.approachDe, d.approachEn)}</p></article>
    </section>
    <section className="eil-callout"><Status>{tx('BEZUG ZU EIL', 'RELATIONSHIP TO EIL')}</Status><p>{tx(d.relationshipDe, d.relationshipEn)}</p><a className="eil-text-link" href={href('research')}>{tx('Alle Domains ansehen', 'View all domains')} →</a></section>
  </div>

  // -- Methods ------------------------------------------------------------
  const methodEntries = [
    ['LIIE', tx('OPEN RESEARCH BENCHMARK', 'OPEN RESEARCH BENCHMARK'), 'Longitudinal Interaction Impact Evaluation', tx('Offener Research-Benchmark für mehrjährige Human–AI-Interaktionsverläufe, einschließlich vorteilhafter, erhaltender und sich verschlechternder Muster, Rekonstruktionsgenauigkeit, Handlungsfähigkeit, semantischer Integrität, Abhängigkeit, Unsicherheitskalibrierung, Recovery und False-State-Kontrollen.', 'Open research benchmark for multi-year Human–AI interaction trajectories, including beneficial, preserving and deteriorating patterns, reconstruction accuracy, agency, semantic integrity, dependency, uncertainty calibration, recovery and false-state controls.')],
    ['IEIA / EIA', tx('FORSCHUNGSSTRUKTUR', 'RESEARCH STRUCTURE'), tx('Iterative & Emergent Interaction Analysis', 'Iterative & Emergent Interaction Analysis'), tx('Zerlegt eine Interaktionsreihe in einzeln vergleichbare Episoden, statt eine Sitzung isoliert zu betrachten – so werden Muster erst über wiederholte Durchläufe sichtbar.', 'Breaks an interaction series into individually comparable episodes instead of looking at one session in isolation — patterns only become visible across repeated runs.')],
    ['CEI', tx('METRIK', 'METRIC'), 'Continuous Evolution Index', tx('Ein einzelner, über Zeit fortgeschriebener Wert, der zeigt, ob sich eine Interaktion in Richtung Verbesserung, Stillstand oder Verschlechterung bewegt – gemessen, nicht behauptet.', 'A single value, updated over time, showing whether an interaction is trending toward improvement, stagnation or deterioration — measured, not asserted.')],
    ['UIP / CCET', tx('RESEARCH INSTRUMENTE', 'RESEARCH INSTRUMENTS'), tx('User Integrity Protocol · Continuous Co-Evolution Tracker', 'User Integrity Protocol · Continuous Co-Evolution Tracker'), tx('UIP prüft, ob ein System einen Nutzer über die Zeit konsistent behandelt, statt bei jeder Sitzung neu zu raten. CCET verfolgt, wie sich Nutzer und System gemeinsam über wiederholte Interaktion verändern.', 'UIP checks whether a system treats a user consistently over time, instead of re-guessing at every session. CCET tracks how user and system change together across repeated interaction.')],
    ['LSG-24 / LAP-1 / LT-Data', tx('FORSCHUNGS- & DATENINSTRUMENTE', 'RESEARCH & DATA INSTRUMENTS'), tx('Framework-Familie', 'Framework family'), tx('Fallspezifische Research- und Dateninstrumente, jeweils für eine konkrete wiederkehrende Analyseaufgabe gebaut – keine Universallösung, die auf jeden Fall gestülpt wird.', 'Case-specific research and data instruments, each built for one concrete recurring analysis task — not a one-size-fits-all tool stretched over every case.')],
    ['8-Layer Model', tx('KONZEPTIONELLES MODELL', 'CONCEPTUAL MODEL'), tx('Historisches Framework-Modell', 'Historical framework model'), tx('Frühes Modell, das einen Reasoning-Verlauf in acht unterscheidbare Schichten zerlegt hat, um zu zeigen, wo ein Fehler im Denkprozess tatsächlich entsteht – nicht nur, wo er sichtbar wird. Heute primär von historischem Interesse.', 'An early model that broke a reasoning trace into eight distinguishable layers to show where an error in a thought process actually originates — not just where it becomes visible. Today mostly of historical interest.')],
  ] as const

  const processStages = [
    [tx('Beobachten', 'Observe'), tx('Interaktionsverläufe, Logs, Entscheidungen und Systemreaktionen werden mit Zeitstempel mitgeschnitten, während sie passieren – nicht nachträglich aus dem Gedächtnis rekonstruiert.', 'Interaction histories, logs, decisions and system responses are captured with timestamps as they happen — not reconstructed afterward from memory.')],
    [tx('Rekonstruieren', 'Reconstruct'), tx('Aus Logs, Fehlermeldungen, Teilaussagen und indirekten Spuren wird abgeleitet, welcher Zustand oder welche Regel das beobachtete Verhalten tatsächlich erklärt – mehrere konkurrierende Erklärungen werden gegeneinander geprüft, bevor eine übernommen wird.', 'From logs, error messages, partial statements and indirect traces, the actual state or rule behind the observed behavior is inferred — competing explanations are tested against each other before one is adopted.')],
    [tx('Modellieren', 'Model'), tx('Die rekonstruierten Zustände und Übergänge werden in eine konkrete Repräsentation gebracht – etwa eine Zustandstabelle, einen Kausalgraphen oder ein Übergangsdiagramm – mit explizit markierten Unsicherheiten statt einer glatten Einzelerklärung.', 'The reconstructed states and transitions are written into a concrete representation — a state table, causal graph or transition diagram — with uncertainty explicitly marked instead of collapsed into one clean story.')],
    [tx('Entwerfen', 'Design'), tx('Aus dem Modell wird eine konkrete Architektur abgeleitet: welche Rolle welchen Ausschnitt übernimmt, welche Daten zwischen welchen Komponenten fließen, und welche Regel greift, wenn sich eine Annahme als falsch herausstellt.', 'A concrete architecture is derived from the model: which role owns which slice, what data flows between which components, and what rule kicks in when an assumption turns out wrong.')],
    [tx('Bauen', 'Build'), tx('Das Design wird tatsächlich implementiert – als Skript, Agentenrolle, Dashboard oder Datenpipeline – und gegen echte Eingaben laufen gelassen, statt nur als Diagramm liegen zu bleiben.', 'The design is actually implemented — as a script, an agent role, a dashboard or a data pipeline — and run against real input, not left as a diagram.')],
    [tx('Validieren', 'Validate'), tx('Das laufende System wird mit neuen, bisher ungesehenen Fällen konfrontiert; Ergebnisse werden mit dem tatsächlichen späteren Ausgang verglichen und als bestätigt, widerlegt oder offen eingestuft – nie stillschweigend als richtig angenommen.', 'The running system is confronted with new, previously unseen cases; results are compared against the actual later outcome and classified as confirmed, falsified or unresolved — never silently assumed correct.')],
  ] as const

  const Methods = () => <>
    <PageHero eyebrow="METHODOLOGY" title={tx('Methoden', 'Methods')} body={tx('Methoden und Instrumente, entwickelt innerhalb der EIL-Forschung.', 'Methods and instruments developed inside EIL research.')} crumbs={[[tx('Start', 'Home'), 'home'], [tx('Methoden', 'Methods'), null]]} />
    <section className="eil-section"><div className="eil-section-head"><Status>{tx('FORSCHUNGS- & ENTWICKLUNGSPROZESS', 'RESEARCH & DEVELOPMENT PROCESS')}</Status><h2>{tx('KI-gestützter, longitudinaler Forschungs- und Entwicklungsprozess.', 'AI-augmented, longitudinal research and development process.')}</h2><p>{tx('Statt isoliertem Prompting arbeitet das Lab longitudinal mit KI über ausgedehnte Interaktionsverläufe hinweg – für Forschung, Analyse, Rekonstruktion, Modellierung, Systemdesign, Experimentation und Validierung.', 'Rather than isolated prompting, the Lab works longitudinally with AI across extended interaction histories — for research, analysis, reconstruction, modeling, system design, experimentation and validation.')}</p></div>
      <div className="eil-step-row">{processStages.map(([label]) => <span key={label}><b>{tx('SCHRITT', 'STEP')}</b>{label}</span>)}</div>
      <div className="eil-method-detail-list" style={{ marginTop: 24 }}>{processStages.map(([label, desc]) => <article key={label}><h2>{label}</h2><p>{desc}</p></article>)}</div>
      <p style={{ marginTop: 28, color: 'var(--soft)', fontSize: 13 }}>{tx('KI wird im gesamten Prozess als Forschungs-, Analyse-, Modellierungs- und Entwicklungswerkzeug eingesetzt; alle Konzepte, Architekturen, Interpretationen und finalen Entscheidungen bleiben in eigener Verantwortung.', "AI is used throughout this process as a research, analysis, modeling and development tool; all concepts, architectures, interpretations and final decisions remain the Lab's own responsibility.")}</p>
    </section>
    <section className="eil-section"><div className="eil-section-head"><Status>{tx('FORSCHUNGSWERKZEUGE', 'RESEARCH TOOLS')}</Status><p>{tx('Dies sind unterstützende Forschungswerkzeuge. Sie definieren das Lab nicht als Ganzes und bleiben den Forschungsfragen und Systemen, die sie unterstützen, untergeordnet.', 'These are supporting research tools. They do not define the lab as a whole and should remain subordinate to the research questions and systems they support.')}</p></div>
      <div className="eil-library-grid">{methodEntries.map(([name, status, full, desc]) => <FoldCard key={name} kicker={status} title={name} subtitle={full}><p>{desc}</p></FoldCard>)}</div>
    </section>
  </>

  // -- Systems ------------------------------------------------------------
  const Systems = () => <>
    <PageHero eyebrow="COMPUTATIONAL RESEARCH" title={tx('Systeme', 'Systems')} body={tx('Designte Intelligence über Agenten, Runtime und Forschungssysteme hinweg.', 'Designed intelligence across agents, runtime and research systems.')} crumbs={[[tx('Start', 'Home'), 'home'], [tx('Systeme', 'Systems'), null]]} />
    <section className="eil-section"><div className="eil-section-head"><p>{tx('Die Systemschicht operationalisiert die EIL-Forschung. Einzelne Agenten sind spezialisierte Intelligence-Komponenten innerhalb größerer Architekturen – keine eigenständigen Chatbot-Produkte.', 'The systems layer operationalizes EIL research. Individual agents are specialized intelligence components inside larger architectures — not standalone chatbot products.')}</p></div></section>
    <section className="eil-callout eil-agent-environment"><Status>{tx('MULTI-AGENT-ARCHITEKTUR', 'MULTI-AGENT ARCHITECTURE')}</Status><h2>{tx('Spezialisierte Lead Agents und Sub-Agents.', 'Specialized lead agents and sub-agents.')}</h2><p>{tx('Spezialisierte Lead Agents und Sub-Agents operieren über designte Rollen, Handoffs, Zustand, Evidenz und Runtime-Strukturen.', 'Specialized lead agents and sub-agents operate through designed roles, handoffs, state, evidence and runtime structures.')}</p>
      <p style={{ marginTop: 18, fontFamily: "'Archivo', system-ui, sans-serif", fontWeight: 450, fontSize: 16, lineHeight: 1.6, color: 'var(--soft)' }}>{tx(`Die aktuelle Architektur umfasst etwa 15 spezialisierte Lead Agents und mehr als ${institutionalFacts.specializedResearchAgentCrates} spezialisierte Sub-Agents über Forschungs- und Betriebskontexte hinweg. Ein einzelnes Modell in einem Chatfenster hält keinen geteilten Zustand, keine Handoffs und kein Audit-Trail über mehrere Schritte hinweg – sobald eine Aufgabe mehrere spezialisierte Perspektiven, parallele Recherche oder Kontinuität über Tage oder Wochen braucht, bricht dieses Modell zusammen. Die Lead-/Sub-Agent-Architektur hält explizit fest, welcher Agent was weiß, wer an wen übergibt und was passiert, wenn eine Rolle ausfällt oder abweicht.`, `The current architecture includes roughly 15 specialized lead agents and more than ${institutionalFacts.specializedResearchAgentCrates} specialized sub-agents across research and operational contexts. A single model in one chat window holds no shared state, no handoffs and no audit trail across multiple steps — once a task needs several specialized perspectives, parallel research or continuity across days or weeks, that model breaks down. The lead/sub-agent architecture keeps explicit track of what each agent knows, who hands off to whom, and what happens when a role fails or drifts.`)}</p>
      <small>{['Lead Agents', 'Specialists', 'Sub-Agents', 'Shared Context', 'Runtime / Evidence'].join(' · ')}</small>
    </section>
    <section className="eil-section"><div className="eil-section-head"><Status>{tx('AUSGEWÄHLTE INTELLIGENCE-SYSTEME', 'SELECTED INTELLIGENCE SYSTEMS')}</Status></div>
      <div className="eil-system-grid">{intelligenceSystems.map(([name, kicker, d, e, dDetail, eDetail]) => (
        dDetail
          ? <FoldCard key={name} group="intelligence-systems" kicker={kicker} title={name} subtitle={tx(d, e)}><p>{tx(dDetail, eDetail)}</p></FoldCard>
          : <article className="eil-card" key={name}><Status>{kicker}</Status><h3>{name}</h3><p>{tx(d, e)}</p></article>
      ))}</div>
    </section>
    <section className="eil-section"><div className="eil-environment-grid">
      <article><Status>{tx('GEBAUT', 'BUILT')}</Status><h3>EIL Kernel</h3><p>{tx('Der Kernel ist existierende Forschungsinfrastruktur für zustandsbehaftete Agentenoperation und Kontinuität. Er ist kein geplantes Konzept. Ohne ihn verliert jede neue Sitzung Kontext, Entscheidungen und zuvor validierte Zustände – der Kernel hält das über Sitzungen, Neustarts und Machine-Wechsel hinweg fest, statt bei jedem Neustart bei null anzufangen.', 'The Kernel is existing research infrastructure for stateful agent operation and continuity. It is not a planned concept. Without it, every new session loses context, decisions and previously validated states — the Kernel preserves that across sessions, restarts and machine changes instead of starting from zero every time.')}</p><p>{tx('Der Kernel umfasst innerhalb der bestätigten Architektur zusätzlich Evidence Handling, Testarchitektur sowie Guard A / Guard B.', 'The Kernel also includes evidence handling, test structures and Guard A / Guard B within the confirmed architecture.')}</p><small>{['Agent Logic', 'Runtime', 'State', 'Context', 'Memory', 'Drift', 'Monitoring', 'Feedback', 'Recovery', 'Audit Trails'].join(' · ')}</small></article>
      <article><Status>{tx('AKTIVE FORSCHUNG', 'ACTIVE RESEARCH')}</Status><h3>DINGIR</h3><p>{tx('DINGIR ist das kollaborative System für Hidden-State-Rekonstruktion, Kausalketten, Zustandsübergänge und prädiktives Reasoning.', 'DINGIR is the collaborative system for hidden-state reconstruction, causal chains, state transitions and predictive reasoning.')}</p><p>{tx('EIL trägt Forschung und Intelligence Architecture rund um Rekonstruktion, Hidden-State-Reasoning, kausale und zeitliche Struktur, Zustandsübergänge und Prediction-Logik bei; Engineering- und Implementierungs-Attribution bleibt bei tatsächlicher Zusammenarbeit explizit ausgewiesen.', 'EIL contributes research and intelligence architecture around reconstruction, hidden-state reasoning, causal and temporal structure, state transitions and prediction logic; engineering and implementation attribution should remain explicit where collaborative.')}</p><a className="eil-text-link" href={href('research-causality')} style={{ marginTop: 0, display: 'inline-block' }}>{tx('Forschungsdomäne Kausalität, Prediction & DINGIR ansehen', 'View the Causality, Prediction & DINGIR research domain')} →</a><small>{tx(['Evidenz', 'Verborgener Zustand', 'Kausale Struktur', 'Übergang', 'Mögliche Zukünfte'].join(' → '), ['Evidence', 'Hidden State', 'Causal Structure', 'Transition', 'Possible Futures'].join(' → '))}</small></article>
    </div></section>
  </>

  // -- Publications --------------------------------------------------------
  const Publications = () => <>
    <PageHero eyebrow="RESEARCH OUTPUTS" title={tx('Publikationen', 'Publications')} body={tx('Forschungsoutputs und offene Arbeit.', 'Research outputs and open work.')} crumbs={[[tx('Start', 'Home'), 'home'], [tx('Publikationen', 'Publications'), null]]} />
    <section className="eil-section"><div className="eil-section-head"><p>{tx('Publikationen, Benchmarks, Datensätze, Software und technische Notizen werden als Outputs der breiteren EIL-Forschungsumgebung präsentiert.', 'Publications, benchmarks, datasets, software and technical notes are presented as outputs of the broader EIL research environment.')}</p></div>
      <div className="eil-publication-list">{(content.papers?.items ?? []).map((p,i)=><article key={p.id}><div><Status>{p.type.toUpperCase()}</Status><span className="eil-index">{String(i+1).padStart(2,'0')}</span></div><h2>{p.title}</h2><div className="eil-pub-meta"><span>Authors: {p.authors.join(', ')}</span><span>Date: {p.date}</span><span>Version: {p.version}</span><span>Status: {p.status}</span><span>Peer review: {p.peerReviewStatus}</span><span>Pages: {p.pages}</span>{p.repository&&<span>Repository: {p.repository}</span>}</div><Disclosure summary={tx('Abstract und Links','Abstract and links')}><p>{p.description}</p><div className="eil-pub-actions">{p.doi&&<a href={p.doi}>DOI →</a>}<a href={`${BASE}${p.file}`}>{tx('Dokument öffnen','Open document')} →</a></div></Disclosure></article>)}</div>
    </section>
  </>

  // -- Observatory ----------------------------------------------------------
  const observatoryItems = [
    [tx('Experimente', 'Experiments'), tx('Strukturierte Ansichten aktiver und abgeschlossener Experimente.', 'Structured views of active and completed experiments.')],
    [tx('Zustand & Runtime', 'State & Runtime'), tx('Beobachtbarer Zustand und Runtime-Verhalten ausgewählter Forschungssysteme.', 'Observable state and runtime behavior for selected research systems.')],
    [tx('Rekonstruktionen', 'Reconstructions'), tx('Visueller Zugang zu rekonstruierten Zuständen, Beziehungen und Übergängen.', 'Visual access to reconstructed states, relationships and transitions.')],
    [tx('Research Streams', 'Research Streams'), tx('Lang laufende Forschungsstränge und Kontinuität über Untersuchungen hinweg.', 'Long-running research threads and continuity across investigations.')],
    [tx('Daten', 'Data'), tx('Evidenzstrukturen, Datensätze und zeitliche Information.', 'Evidence structures, datasets and temporal information.')],
    [tx('Wissenschaftliche Visualisierung', 'Scientific Visualization'), tx('Visualisierung von Verläufen, Systemdynamik, kausaler Struktur und anderen Forschungszuständen.', 'Visualization of trajectories, system dynamics, causal structure and other research states.')],
  ] as const

  const Observatory = () => <>
    <PageHero eyebrow="RESEARCH INSTRUMENT" title="Observatory" body={tx('Experimentelle Sichtbarkeit laufender Forschungssysteme.', 'Experimental visibility into ongoing research systems.')} crumbs={[[tx('Start', 'Home'), 'home'], ['Observatory', null]]} />
    <section className="eil-section"><div className="eil-section-head"><Status>{tx('IN ENTWICKLUNG', 'IN DEVELOPMENT')}</Status><p>{tx('Das Observatory ist eine sich in Entwicklung befindende Forschungsumgebung für Experimente, Zustand, Rekonstruktionen, Daten, Runtime-Verhalten und wissenschaftliche Visualisierung.', 'The Observatory is an in-development research environment for experiments, state, reconstructions, data, runtime behavior and scientific visualization.')}</p></div>
      <div className="eil-observatory-grid">{observatoryItems.map(([name,d])=><article key={name}><h3>{name}</h3><p>{d}</p></article>)}</div>
      <p style={{ marginTop: 34, color: 'var(--soft)', fontSize: 13 }}>{tx('Nur tatsächlich implementierte Elemente werden als operativ gekennzeichnet. Das Observatory bleibt als „in Entwicklung" markiert, bis dies anders verifiziert ist.', 'Only implemented elements should ever be labelled operational. The Observatory must remain marked in development until verified otherwise.')}</p>
    </section>
  </>

  // -- Notes ----------------------------------------------------------------
  const Notes = () => <><PageHero eyebrow="PUBLIC RESEARCH COMMUNICATION" title="Research Notes" body={tx('Lab Notes, Research Notes, Case Studies, Methods und Commentary – klar voneinander unterschieden.', 'Lab notes, research notes, case studies, methods and commentary—clearly distinguished.')} crumbs={[[tx('Start', 'Home'), 'home'], ['Research Notes', null]]} /><section className="eil-section"><div className="eil-notes-grid">{(content.news?.items ?? []).map(n=><article className="eil-card" key={n.id}><Status>RESEARCH NOTE · PRELIMINARY</Status><time>{n.date}</time><h3>{n.title}</h3><p>{n.body.replace(/<[^>]+>/g,'').slice(0,220)}…</p></article>)}</div></section></>

  // -- Applied Research -------------------------------------------------
  const appliedCapabilities = [
    [tx('Systemrekonstruktion', 'System Reconstruction'), tx('Systemzustand, Ereignisabfolgen, Constraints oder kausale Struktur aus unvollständiger und verteilter Evidenz rekonstruieren.', 'Reconstruct system state, event sequences, constraints or causal structure from incomplete and distributed evidence.')],
    [tx('KI-gestützte Systemdiagnostik', 'AI-Augmented System Diagnostics'), tx('Strukturierte Intelligence-Systeme einsetzen, um Verhalten, Systemzustände, Fehlermuster und verborgene Constraints zu untersuchen.', 'Use structured intelligence systems to investigate behavior, system conditions, failure patterns and hidden constraints.')],
    [tx('Behavioral- / Interaktionsanalyse', 'Behavioral / Interaction Analysis'), tx('Beobachtete Interaktionsmuster, Entscheidungsdynamik, Abweichungen und longitudinale Veränderung analysieren.', 'Analyze observed interaction patterns, decision dynamics, deviations and longitudinal change.')],
    [tx('Adversariale Systemanalyse', 'Adversarial Systems Analysis'), tx('Annahmen und behauptetes Systemverhalten gegen widersprüchliche Evidenz, Edge Cases und Fehlerzustände prüfen.', 'Challenge assumptions and stated system behavior against conflicting evidence, edge cases and failure conditions.')],
  ] as const

  const Applied = () => <>
    <PageHero eyebrow="APPLIED RESEARCH" title="Applied Research" body={tx('Forschungsmethoden angewendet auf begrenzte reale Systeme.', 'Research methods applied to bounded real-world systems.')} crumbs={[[tx('Start', 'Home'), 'home'], ['Applied Research', null]]} />
    <section className="eil-section"><div className="eil-section-head"><p>{tx('EIL kann Rekonstruktion, Behavioral Analysis, KI-gestützte Systemdiagnostik und adversariales Systemdenken auf konkrete externe Systeme anwenden, ohne das Lab in eine generische Beratung zu verwandeln.', 'EIL can apply reconstruction, behavioral analysis, AI-augmented system diagnostics and adversarial systems thinking to concrete external systems without turning the lab into a generic consultancy.')}</p></div>
      <div className="eil-process">{['Problem', tx('Forschungsfrage','Research Question'), tx('Abgrenzung','Boundary'), 'Evidence'].map((x,i)=><article key={x}><span>{String(i+1).padStart(2,'0')}</span><strong>{x}</strong></article>)}</div>
    </section>
    <section className="eil-section"><div className="eil-domain-grid">{appliedCapabilities.map(([name,d])=><article className="eil-card" key={name}><h3>{name}</h3><p>{d}</p></article>)}</div></section>
    <section className="eil-section"><div className="eil-section-head"><Status>{tx('BESTEHENDE ANGEBOTE & PREISE', 'VERIFIED EXISTING OFFERS')}</Status><p>{tx('Preise bleiben sichtbar, bestimmen aber nicht die institutionelle Hierarchie. Finale Preise hängen von Evidenzvolumen, Systemgrenze und Komplexität ab.', 'Prices remain visible without defining the institutional hierarchy. Final pricing depends on evidence volume, system boundary and complexity.')}</p></div>
      <div className="eil-engagement-list">{engagements.map(([category,name,price,d,e])=><article key={name}><div><Status>{category.toUpperCase()}</Status><strong>{price}</strong></div><h2>{name}</h2><p>{tx(d,e)}</p><a href={`${href('home')}#contact`}>{tx('Scope prüfen', 'Discuss scope')} →</a></article>)}</div>
    </section>
    <section className="eil-callout"><h2>{tx('Von der Forschungsfrage bis zum lauffähigen System.', 'From research question to working system.')}</h2><p>{tx('EIL entwirft, baut und validiert eigene Instrumente und Architekturen. Wo Produktions-Infrastruktur oder großskalige technische Umsetzung erforderlich ist, wird RFI-IRFOS separat als Engineering-Partner ausgewiesen.', 'EIL designs, builds and validates its own instruments and architectures. Where production infrastructure or large-scale technical implementation is required, RFI-IRFOS is credited separately as the engineering partner.')}</p></section>
  </>

  const pages: Record<InstitutionalRoute, () => ReactElement> = {
    home: Home, lab: Lab, research: Research, methods: Methods, systems: Systems,
    publications: Publications, observatory: Observatory, notes: Notes, 'applied-research': Applied,
    'research-complex': () => ResearchDomainDetail(researchDomains[0]),
    'research-behavioral': () => ResearchDomainDetail(researchDomains[1]),
    'research-reconstruction': () => ResearchDomainDetail(researchDomains[2]),
    'research-human-ai': () => ResearchDomainDetail(researchDomains[3]),
    'research-integrity': () => ResearchDomainDetail(researchDomains[4]),
    'research-causality': () => ResearchDomainDetail(researchDomains[5]),
    'research-computational': () => ResearchDomainDetail(researchDomains[6]),
  }
  const Page = pages[route]
  return <div className="eil-site" data-theme={theme}><Header/><main className="eil-main"><Page/></main><Footer/></div>
}
