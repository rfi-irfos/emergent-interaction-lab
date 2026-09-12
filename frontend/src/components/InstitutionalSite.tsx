import { useEffect, useState } from 'react'
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


type SpecEntry = {
  key: string; kicker: string; title: string
  leadDe: string; leadEn: string
  problemDe?: string; problemEn?: string
  archDe?: string[]; archEn?: string[]
  specDe?: [string, string][]; specEn?: [string, string][]
}

const intelligenceSystems: SpecEntry[] = [
  { key: 'jarvis', kicker: 'MULTI-AGENT ORCHESTRATION', title: 'JARVIS',
    leadDe: 'Koordiniert mehrere spezialisierte Agenten in einem gemeinsamen Workflow.', leadEn: 'Coordinates multiple specialized agents within one shared workflow.',
    problemDe: 'Ohne zentrale Orchestrierung muss jeder Agent selbst wissen, wann er dran ist und an wen er übergibt – bei mehr als ein paar Agenten wird das unkoordinierbar, und ein stiller Ausfall bleibt unbemerkt.', problemEn: "Without central orchestration, every agent has to know on its own when it's its turn and who to hand off to — past a handful of agents that stops being coordinable, and a silent failure goes unnoticed.",
    archDe: ['Verteilt Teilaufgaben an die passenden spezialisierten Agenten.', 'Sammelt Zwischenergebnisse zusammen und hält den Gesamtstatus.', 'Erkennt, wenn ein Agent nichts mehr liefert oder hängen bleibt.', 'Hält fest, welcher Agent was weiß und wer an wen übergibt.'],
    archEn: ['Distributes subtasks to the matching specialized agents.', 'Gathers intermediate results and tracks overall status.', 'Detects when an agent stops delivering or gets stuck.', 'Keeps track of what each agent knows and who hands off to whom.'],
    specDe: [['Rolle', 'Multi-Agent-Orchestrator'], ['Input', 'Teilaufgaben aus einem Workflow'], ['Output', 'Konsolidierter Status + Ergebnis']],
    specEn: [['Role', 'Multi-agent orchestrator'], ['Input', 'Subtasks from a workflow'], ['Output', 'Consolidated status + result']] },
  { key: 'nyx', kicker: 'SECURITY & VULNERABILITY SCANNING', title: 'NYX',
    leadDe: 'Scannt Angriffsfläche, Abhängigkeiten, Konfiguration und exponierte Credentials.', leadEn: 'Scans attack surface, dependencies, configuration and exposed credentials.',
    problemDe: 'Sicherheitslücken bleiben oft unentdeckt, bis sie ausgenutzt werden – ohne laufendes Scanning verlässt man sich auf Zufall oder seltene manuelle Audits.', problemEn: 'Security gaps often go undetected until they are exploited — without continuous scanning, you rely on luck or rare manual audits.',
    archDe: ['Beobachtet offene Ports, exponierte Services und TLS-Zertifikatsstatus.', 'Gleicht Abhängigkeiten gegen neu veröffentlichte CVEs ab.', 'Erkennt falsch konfigurierte Zugriffsrechte und ungenutzte Accounts mit noch aktivem Zugriff.', 'Ordnet jeden Fund nach Schweregrad, CVSS-artig.'],
    archEn: ['Monitors open ports, exposed services and TLS certificate health.', 'Matches dependencies against newly published CVEs.', 'Detects misconfigured access rights and unused accounts still holding live access.', 'Ranks every finding by severity, CVSS-style.'],
    specDe: [['Rolle', 'Security & Vulnerability Scanning'], ['Output', 'Priorisierte Findings-Liste, übergabefertig an ein Dev-Team']],
    specEn: [['Role', 'Security & vulnerability scanning'], ['Output', 'Prioritized findings list, ready to hand to a dev team']] },
  { key: 'mirror', kicker: 'SYSTEM INTEGRITY', title: 'MIRROR',
    leadDe: 'Erkennt Widerspruch, Drift, Regression und Abweichung von zuvor validierten Systemzuständen.', leadEn: 'Detects contradiction, drift, regression and divergence from previously validated system states.',
    problemDe: 'Ein Team kann wochenlang glauben, im Plan zu sein, während die Realität längst woanders ist – niemand meldet das von selbst.', problemEn: "A team can believe for weeks it's on plan while reality has already moved on — nobody reports that on its own.",
    archDe: ['Vergleicht Plan gegen tatsächlichen Zustand, Regelkonformität, Zielwerte gegen Ergebnisse.', 'Beobachtet Team-Velocity gegen Zusagen.', 'Erkennt stillschweigende Workarounds, ausgehöhlte Kennzahlen und übersehene Fristen.', 'Liefert eine Frühwarnung statt eines Post-mortems, mit einer laufenden Integritäts-Kennzahl.'],
    archEn: ['Compares plan versus actual state, rule compliance, targets versus outcomes.', 'Monitors team velocity versus commitments.', 'Detects quiet workarounds, hollowed-out metrics and overlooked deadlines.', 'Delivers an early warning instead of a post-mortem, with a running integrity score.'] },
  { key: 'robert', kicker: 'SALES INTELLIGENCE', title: 'ROBERT',
    leadDe: 'Sales-Intelligence-Agent, der Leads recherchiert, qualifiziert und Kontext für Outreach zusammenstellt.', leadEn: 'Sales-intelligence agent that researches and qualifies leads and assembles outreach context.',
    problemDe: 'Eine Erstansprache ohne konkreten Kontext liest sich generisch und wird ignoriert – Research für jeden Lead von Hand zu machen skaliert nicht.', problemEn: "A first outreach message without real context reads generic and gets ignored — doing research on every lead by hand doesn't scale.",
    archDe: ['Sammelt öffentlich verfügbare Signale zu einem Unternehmen – Größe, Branche, aktuelle Aktivität, passende Ansprechpartner.', 'Bringt sie in eine Form, mit der eine Erstansprache konkret statt generisch sein kann.', 'Koordiniert über mehrere spezialisierte Teilrollen.', 'Ersetzt keine menschliche Entscheidung, wer angesprochen wird, liefert aber die Grundlage dafür.'],
    archEn: ['Gathers publicly available signals about a company — size, sector, current activity, relevant contacts.', 'Turns them into something a first outreach message can actually be specific about.', 'Coordinated across several specialized sub-roles.', "Doesn't replace the human decision of who to reach out to, but supplies the basis for it."] },
  { key: 'argus', kicker: 'INFORMATION INTELLIGENCE', title: 'ARGUS',
    leadDe: 'Beobachtet Markt-, Presse- und Wettbewerbssignale kontinuierlich.', leadEn: 'Continuously monitors market, press and competitive signals.',
    problemDe: 'Wettbewerbsbewegungen werden oft erst über Wochen sichtbar, wenn sie längst Konsequenzen haben – ein wöchentlicher Digest kommt strukturell zu spät.', problemEn: 'Competitive moves often only become visible over weeks, by which point they already have consequences — a weekly digest is structurally too late.',
    archDe: ['Beobachtet Wettbewerber-Ankündigungen, Erwähnungen, Presse, Stimmungsverschiebungen, Führungswechsel und Produktlaunches.', 'Erkennt neue Marktbewegungen, sich formende Narrative und frühe Anzeichen eines Marktwandels.', 'Liefert einen tagesaktuellen Alert statt eines wöchentlichen Digests, mit Historie und Quellenangabe.'],
    archEn: ['Monitors competitor announcements, mentions, press, sentiment shifts, leadership changes and product launches.', 'Detects emerging market movements, narratives forming before mainstream coverage and early signs of a market shift.', 'Delivers a same-day alert instead of a weekly digest, with history and sourcing.'] },
  { key: 'atlas', kicker: 'ORCHESTRATION', title: 'ATLAS',
    leadDe: 'Priorisiert und orchestriert Signale aus mehreren spezialisierten Agenten.', leadEn: 'Prioritizes and orchestrates signals across multiple specialized agents.',
    problemDe: 'Zehn Agenten liefern zehn Einzelmeldungen – ohne Priorisierung weiß niemand, was zuerst drankommt oder wo sich Befunde widersprechen.', problemEn: 'Ten agents deliver ten separate alerts — without prioritization, nobody knows what to act on first or where findings conflict.',
    archDe: ['Beobachtet, was jeder Agent findet, welche Alerts sich überschneiden und wo Agenten voneinander abhängen.', 'Erkennt widersprüchliche Berichte, doppelte Alerts und Engpässe zwischen Agenten.', 'Liefert eine einzige priorisierte Liste statt zehn Einzelmeldungen, mit klarer nächster Handlung.'],
    archEn: ['Monitors what every agent is finding, which alerts overlap and where agents depend on each other.', 'Detects conflicting reports, duplicate alerts and bottlenecks between agents.', 'Delivers one ranked list instead of ten separate alerts, with a clear next action.'] },
  { key: 'kopernikus', kicker: 'EXECUTION', title: 'KOPERNIKUS',
    leadDe: 'Identifiziert Förder- und Kapitalquellen, die tatsächlich zum untersuchten System passen.', leadEn: 'Identifies funding and capital sources that actually match the system under study.',
    problemDe: 'Förderdatenbanken listen tausende Programme, von denen die meisten für den konkreten Fall gar nicht infrage kommen – das manuell zu sichten kostet mehr Zeit, als es bringt.', problemEn: "Grant databases list thousands of programs, most of which don't actually apply to the case at hand — sifting through them by hand costs more time than it saves.",
    archDe: ['Beobachtet offene Förderprogramme, Investorenaktivität, neue Finanzierungsrunden und Bewerbungsfristen.', 'Erkennt tatsächlich passende Programme, sich ändernde Eligibility-Regeln und knapp werdende Deadlines.', 'Liefert eine kurze Liste echter Optionen statt eines Datenbank-Dumps, sortiert nach Passung und Frist.'],
    archEn: ['Monitors open grant programs, investor activity, new funding rounds and application deadlines.', 'Detects genuinely matching programs, changing eligibility rules and closing deadlines.', 'Delivers a short list of real options instead of a database dump, ranked by fit and deadline.'] },
  { key: 'lynx', kicker: 'VISIBILITY & SEO INTELLIGENCE', title: 'LYNX',
    leadDe: 'Prüft, ob und wie ein Unternehmen online tatsächlich gefunden wird.', leadEn: 'Checks whether and how a company can actually be found online.',
    problemDe: 'Rankings und Sichtbarkeit verschlechtern sich oft lange bevor der Traffic-Verlust auffällt – ohne laufende Prüfung wird das erst nach dem Schaden bemerkt.', problemEn: "Rankings and visibility often degrade long before the traffic loss becomes obvious — without ongoing monitoring, it's noticed only after the damage is done.",
    archDe: ['Beobachtet Google-Rankings, Keyword-Performance und technische SEO-Signale wie Core Web Vitals und defekte Links.', 'Prüft, wie eine Marke in KI-Suchergebnissen erscheint, nicht nur in klassischer Suche.', 'Erkennt Seiten, die um dasselbe Keyword konkurrieren, und Content, den Suchmaschinen nicht sauber indexieren können.', 'Liefert eine priorisierte Fix-Liste statt nur eines Keyword-Reports.'],
    archEn: ['Monitors Google rankings, keyword performance and technical SEO signals like Core Web Vitals and broken links.', 'Checks how a brand shows up in AI search results, not just classic search.', "Detects pages competing against each other for the same keyword, and content search engines can't properly index.", 'Delivers a prioritized fix list, not just a keyword report.'],
    specDe: [['Rolle', 'Visibility & SEO Intelligence'], ['Output', 'Technischer SEO-Audit + priorisierte Fix-Liste']],
    specEn: [['Role', 'Visibility & SEO intelligence'], ['Output', 'Technical SEO audit + prioritized fix list']] },
  { key: 'janus', kicker: 'SPECIALIZED AGENT', title: 'JANUS',
    leadDe: 'Spezialisiertes Intelligence-System; öffentliche Details bewusst begrenzt.', leadEn: 'Specialized intelligence system; public detail intentionally limited.',
    problemDe: 'Die Rolle ist bewusst nicht öffentlich im Detail beschrieben.', problemEn: 'The role is intentionally not described in public detail.' },
  { key: 'daedalus', kicker: 'SPECIALIZED AGENT', title: 'DAEDALUS',
    leadDe: 'Spezialisiertes Intelligence-System; öffentliche Details bewusst begrenzt.', leadEn: 'Specialized intelligence system; public detail intentionally limited.',
    problemDe: 'Die Rolle ist bewusst nicht öffentlich im Detail beschrieben.', problemEn: 'The role is intentionally not described in public detail.' },
  { key: 'delta', kicker: 'SPECIALIZED AGENT', title: 'DELTA',
    leadDe: 'Spezialisiertes Intelligence-System; öffentliche Details bewusst begrenzt.', leadEn: 'Specialized intelligence system; public detail intentionally limited.',
    problemDe: 'Die Rolle ist bewusst nicht öffentlich im Detail beschrieben.', problemEn: 'The role is intentionally not described in public detail.' },
]

const infraSystems: SpecEntry[] = [
  { key: 'eil-kernel', kicker: 'GEBAUT', title: 'EIL Kernel',
    leadDe: 'Läuft bereits produktiv – kein Konzept auf dem Reißbrett.', leadEn: 'Already running in production — not a concept on the drawing board.',
    problemDe: 'Ohne persistente Infrastruktur verliert jede neue Sitzung Kontext, Entscheidungen und zuvor validierte Zustände – ein Agent, dessen Gedächtnis bei jedem Neustart zurückgesetzt wird, kann nicht longitudinal forschen.', problemEn: "Without persistent infrastructure, every new session loses context, decisions and previously validated states — an agent whose memory resets on every restart can't do longitudinal research.",
    archDe: ['Hält Runtime, State, Context und Memory über Sitzungen, Neustarts und Machine-Wechsel hinweg fest.', 'Protokolliert Entscheidungen und Zustände in Audit Trails statt sie stillschweigend zu überschreiben.', 'Umfasst Evidence Handling, Testarchitektur sowie Guard A / Guard B als eingebaute Kontrollmechanismen.', 'Erkennt Drift und meldet es über Monitoring/Feedback statt es zu ignorieren.'],
    archEn: ['Preserves runtime, state, context and memory across sessions, restarts and machine changes.', 'Logs decisions and states to audit trails instead of silently overwriting them.', 'Includes evidence handling, test structures and Guard A / Guard B as built-in controls.', 'Detects drift and surfaces it via monitoring/feedback instead of ignoring it.'],
    specDe: [['Status', 'Gebaut, in aktivem Einsatz'], ['Komponenten', 'Agent Logic · Runtime · State · Context · Memory · Drift · Monitoring · Feedback · Recovery · Audit Trails']],
    specEn: [['Status', 'Built, in active use'], ['Components', 'Agent Logic · Runtime · State · Context · Memory · Drift · Monitoring · Feedback · Recovery · Audit Trails']] },
  { key: 'dingir', kicker: 'AKTIVE FORSCHUNG', title: 'DINGIR',
    leadDe: 'Das kollaborative System für Hidden-State-Rekonstruktion, Kausalketten, Zustandsübergänge und prädiktives Reasoning.', leadEn: 'The collaborative system for hidden-state reconstruction, causal chains, state transitions and predictive reasoning.',
    problemDe: 'Ein Systemzustand, der nicht direkt beobachtbar ist, bleibt ohne Rekonstruktion eine Vermutung statt einer belastbaren Aussage.', problemEn: 'A system state that cannot be directly observed stays a guess rather than a defensible claim without reconstruction.',
    archDe: ['Verbindet Evidenz, verborgenen Zustand, kausale Struktur, Zustandsübergänge und mögliche Zukünfte in einer Kette.', 'EIL trägt Forschung und Intelligence Architecture rund um Rekonstruktion, Hidden-State-Reasoning, kausale und zeitliche Struktur bei.', 'Engineering- und Implementierungs-Attribution bleibt bei tatsächlicher Zusammenarbeit mit RFI-IRFOS explizit ausgewiesen.'],
    archEn: ['Chains evidence, hidden state, causal structure, state transitions and possible futures together.', 'EIL contributes research and intelligence architecture around reconstruction, hidden-state reasoning, causal and temporal structure.', 'Engineering and implementation attribution stays explicit where RFI-IRFOS actually collaborates.'],
    specDe: [['Status', 'Aktive Forschung'], ['Kette', 'Evidenz → Verborgener Zustand → Kausale Struktur → Übergang → Mögliche Zukünfte'], ['Zugehörige Domain', 'Kausalität, Prediction & DINGIR']],
    specEn: [['Status', 'Active research'], ['Chain', 'Evidence → Hidden State → Causal Structure → Transition → Possible Futures'], ['Related domain', 'Causality, Prediction & DINGIR']] },
]

const methodEntries: SpecEntry[] = [
  { key: 'liie', kicker: 'OPEN RESEARCH BENCHMARK', title: 'LIIE',
    leadDe: 'Longitudinal Interaction Impact Evaluation', leadEn: 'Longitudinal Interaction Impact Evaluation',
    problemDe: 'Kurzzeit-Tests zeigen nicht, ob eine Mensch-KI-Interaktion über Monate hinweg besser oder schlechter wird – Langzeitmuster brauchen einen Langzeit-Benchmark.', problemEn: 'Short-term tests can\'t show whether a human–AI interaction gets better or worse over months — long-term patterns need a long-term benchmark.',
    archDe: ['Erfasst vorteilhafte, erhaltende und sich verschlechternde Interaktionsmuster über mehrjährige Verläufe.', 'Misst Rekonstruktionsgenauigkeit, Handlungsfähigkeit und semantische Integrität.', 'Prüft Abhängigkeit, Unsicherheitskalibrierung, Recovery und False-State-Kontrollen.'],
    archEn: ['Captures beneficial, preserving and deteriorating interaction patterns across multi-year trajectories.', 'Measures reconstruction accuracy, agency and semantic integrity.', 'Tests dependency, uncertainty calibration, recovery and false-state controls.'] },
  { key: 'ieia', kicker: 'FORSCHUNGSSTRUKTUR', title: 'IEIA / EIA',
    leadDe: 'Iterative & Emergent Interaction Analysis', leadEn: 'Iterative & Emergent Interaction Analysis',
    problemDe: 'Eine einzelne Sitzung isoliert zu betrachten verschleiert, ob ein Muster Zufall oder echte Tendenz ist.', problemEn: 'Looking at a single session in isolation obscures whether a pattern is chance or a real trend.',
    archDe: ['Zerlegt eine Interaktionsreihe in einzeln vergleichbare Episoden.', 'Vergleicht Muster über wiederholte Durchläufe statt über eine Momentaufnahme.'],
    archEn: ['Breaks an interaction series into individually comparable episodes.', 'Compares patterns across repeated runs instead of a single snapshot.'] },
  { key: 'cei', kicker: 'METRIK', title: 'CEI',
    leadDe: 'Continuous Evolution Index', leadEn: 'Continuous Evolution Index',
    problemDe: 'Ob sich eine Interaktion verbessert oder verschlechtert, ist ohne durchgehende Messung reine Vermutung.', problemEn: 'Whether an interaction is improving or degrading is pure guesswork without continuous measurement.',
    archDe: ['Ein einzelner, über Zeit fortgeschriebener Wert.', 'Zeigt Trend Richtung Verbesserung, Stillstand oder Verschlechterung.', 'Gemessen aus stabilen Turns und getrackten Signalen, nicht behauptet.'],
    archEn: ['A single value, updated over time.', 'Shows a trend toward improvement, stagnation or deterioration.', 'Measured from stable turns and tracked signals, not asserted.'] },
  { key: 'uip-ccet', kicker: 'RESEARCH INSTRUMENTE', title: 'UIP / CCET',
    leadDe: 'User Integrity Protocol · Continuous Co-Evolution Tracker', leadEn: 'User Integrity Protocol · Continuous Co-Evolution Tracker',
    problemDe: 'Ohne festgehaltenen Verlauf behandelt ein System jeden Nutzer wie einen Erstkontakt, selbst nach hunderten Interaktionen.', problemEn: 'Without a recorded history, a system treats every user like a first contact, even after hundreds of interactions.',
    archDe: ['UIP prüft, ob ein System einen Nutzer über die Zeit konsistent behandelt, statt bei jeder Sitzung neu zu raten.', 'CCET verfolgt, wie sich Nutzer und System gemeinsam über wiederholte Interaktion verändern.', 'Beide arbeiten auf longitudinalen Snapshots, nicht auf Einzelsitzungen.'],
    archEn: ['UIP checks whether a system treats a user consistently over time, instead of re-guessing at every session.', 'CCET tracks how user and system change together across repeated interaction.', 'Both operate on longitudinal snapshots, not single sessions.'] },
  { key: 'lsg-24', kicker: 'FORSCHUNGS- & DATENINSTRUMENTE', title: 'LSG-24 / LAP-1 / LT-Data',
    leadDe: 'Framework-Familie', leadEn: 'Framework family',
    problemDe: 'Eine Universalmethode, die auf jeden Fall gestülpt wird, übersieht fallspezifische Besonderheiten.', problemEn: 'A one-size-fits-all method stretched over every case overlooks case-specific detail.',
    archDe: ['Jedes Instrument wurde für eine konkrete, wiederkehrende Analyseaufgabe gebaut.', 'Kein Fall wird in ein Standardschema gezwungen, das nicht passt.'],
    archEn: ['Each instrument was built for one concrete, recurring analysis task.', "No case gets forced into a standard schema that doesn't fit."] },
  { key: '8-layer', kicker: 'KONZEPTIONELLES MODELL', title: '8-Layer Model',
    leadDe: 'Historisches Framework-Modell', leadEn: 'Historical framework model',
    problemDe: 'Ein Fehler wird oft erst dort bemerkt, wo er sichtbar wird – nicht dort, wo er tatsächlich entstanden ist.', problemEn: "An error is often noticed where it becomes visible — not where it actually originated.",
    archDe: ['Zerlegt einen Reasoning-Verlauf in acht unterscheidbare Schichten.', 'Macht sichtbar, in welcher Schicht ein Fehler ursprünglich entsteht.', 'Heute primär von historischem Interesse, nicht aktiv weiterentwickelt.'],
    archEn: ['Breaks a reasoning trace into eight distinguishable layers.', 'Reveals which layer an error actually originates in.', 'Today mostly of historical interest, not actively developed further.'] },
]

const appliedCapabilities: SpecEntry[] = [
  { key: 'app-reconstruction', kicker: 'CORE CAPABILITY', title: 'Systemrekonstruktion',
    leadDe: 'Systemzustand, Ereignisabfolgen, Constraints oder kausale Struktur aus unvollständiger und verteilter Evidenz rekonstruieren.', leadEn: 'Reconstruct system state, event sequences, constraints or causal structure from incomplete and distributed evidence.',
    problemDe: 'Bei fragmentierter oder verteilter Evidenz lässt sich der wahre Systemzustand nicht direkt beobachten, nur erschließen.', problemEn: 'With fragmented or distributed evidence, the true system state can\'t be directly observed, only inferred.',
    archDe: ['Rekonstruiert Systemzustand, Ereignisabfolgen, Constraints oder kausale Struktur.', 'Arbeitet aus unvollständiger und verteilter Evidenz statt vollständigem Zugriff.', 'Nutzt dieselbe Methode wie die Forschungsdomäne Systemrekonstruktion.'],
    archEn: ['Reconstructs system state, event sequences, constraints or causal structure.', 'Works from incomplete and distributed evidence rather than full access.', 'Uses the same method as the System Reconstruction research domain.'] },
  { key: 'app-diagnostics', kicker: 'RESEARCH CAPABILITY', title: 'KI-gestützte Systemdiagnostik',
    leadDe: 'Strukturierte Intelligence-Systeme einsetzen, um Verhalten, Systemzustände, Fehlermuster und verborgene Constraints zu untersuchen.', leadEn: 'Use structured intelligence systems to investigate behavior, system conditions, failure patterns and hidden constraints.',
    problemDe: 'Manuelle Diagnostik skaliert nicht über viele Systeme oder große Datenmengen hinweg.', problemEn: "Manual diagnostics don't scale across many systems or large volumes of data.",
    archDe: ['Setzt strukturierte Intelligence-Systeme ein, um Verhalten und Systemzustände zu untersuchen.', 'Deckt Fehlermuster und verborgene Constraints auf, die isolierte Checks übersehen.'],
    archEn: ['Uses structured intelligence systems to investigate behavior and system states.', 'Surfaces failure patterns and hidden constraints that isolated checks miss.'] },
  { key: 'app-behavioral', kicker: 'RESEARCH CAPABILITY', title: 'Behavioral- / Interaktionsanalyse',
    leadDe: 'Beobachtete Interaktionsmuster, Entscheidungsdynamik, Abweichungen und longitudinale Veränderung analysieren.', leadEn: 'Analyze observed interaction patterns, decision dynamics, deviations and longitudinal change.',
    problemDe: 'Einzelne Interaktionen zeigen kein Muster – erst der Vergleich über Zeit macht Abweichung und Tendenz sichtbar.', problemEn: 'Single interactions show no pattern — only comparison over time makes deviation and trend visible.',
    archDe: ['Analysiert beobachtete Interaktionsmuster und Entscheidungsdynamik.', 'Verfolgt longitudinale Veränderung statt Momentaufnahmen.'],
    archEn: ['Analyzes observed interaction patterns and decision dynamics.', 'Tracks longitudinal change rather than snapshots.'] },
  { key: 'app-adversarial', kicker: 'RESEARCH CAPABILITY', title: 'Adversariale Systemanalyse',
    leadDe: 'Annahmen und behauptetes Systemverhalten gegen widersprüchliche Evidenz, Edge Cases und Fehlerzustände prüfen.', leadEn: 'Challenge assumptions and stated system behavior against conflicting evidence, edge cases and failure conditions.',
    problemDe: 'Ein System, das nur gegen erwartete Fälle getestet wird, bricht beim ersten unerwarteten.', problemEn: 'A system tested only against expected cases breaks on the first unexpected one.',
    archDe: ['Prüft Annahmen und behauptetes Verhalten gegen widersprüchliche Evidenz.', 'Testet Edge Cases und Fehlerzustände gezielt, statt zu hoffen, dass sie nicht eintreten.'],
    archEn: ['Tests assumptions and stated behavior against conflicting evidence.', "Deliberately tests edge cases and failure conditions instead of hoping they don't occur."] },
]

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

export function InstitutionalSite({ route, content }: { route: InstitutionalRoute; content: SiteContent }) {
  const { lang, setLang } = useLang()
  const { theme, cycle } = useTheme()
  const de = lang === 'de'
  const tx = (german: string, english: string) => de ? german : english

  // Replaces the old inline FoldCard accordion for Systems/Methods/Applied
  // Research: flagged live as "das ist kake" — a 3-line dropdown, not a real
  // explanation. SpecCard is the closed, clickable card; SpecModal is the
  // on-screen panel it opens, with real sections (what it is / problem it
  // solves / how it works / spec facts) instead of one paragraph.
  const [openModal, setOpenModal] = useState<string | null>(null)
  const allSpecEntries = [...intelligenceSystems, ...infraSystems, ...methodEntries, ...appliedCapabilities]

  useEffect(() => {
    if (!openModal) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenModal(null) }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [openModal])

  const SpecCard = ({ entry }: { entry: SpecEntry }) => (
    <button type="button" className="eil-spec-card" onClick={() => setOpenModal(entry.key)}>
      <Status>{entry.kicker}</Status><h3>{entry.title}</h3><p>{tx(entry.leadDe, entry.leadEn)}</p>
    </button>
  )

  const SpecModal = () => {
    const entry = allSpecEntries.find(e => e.key === openModal)
    if (!entry) return null
    return (
      <div className="eil-spec-overlay" role="dialog" aria-modal="true" aria-label={entry.title} onClick={(e) => { if (e.target === e.currentTarget) setOpenModal(null) }}>
        <div className="eil-spec-panel">
          <button type="button" className="eil-spec-x" aria-label={tx('Schließen', 'Close')} onClick={() => setOpenModal(null)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6 L18 18 M18 6 L6 18" /></svg>
          </button>
          <div className="eil-spec-scroll">
            <Status>{entry.kicker}</Status>
            <h1>{entry.title}</h1>
            <p className="eil-spec-lead">{tx(entry.leadDe, entry.leadEn)}</p>
            {entry.problemDe && <><h2>{tx('PROBLEM', 'PROBLEM')}</h2><p>{tx(entry.problemDe, entry.problemEn!)}</p></>}
            {entry.archDe && <><h2>{tx('ARCHITEKTUR', 'ARCHITECTURE')}</h2><ul>{(de ? entry.archDe : entry.archEn!).map(line => <li key={line}>{line}</li>)}</ul></>}
            {entry.specDe && <><h2>{tx('SPEC', 'SPEC')}</h2><dl className="eil-spec-dl">{(de ? entry.specDe : entry.specEn!).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></>}
          </div>
        </div>
      </div>
    )
  }

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
        <article><span className="eil-fold-kicker">{tx('EMERGENZ & DYNAMIK', 'EMERGENCE & DYNAMICS')}</span><h3>{tx('Interaktion', 'Interaction')}</h3><p>{tx('Wie lokale Interaktionen globales Verhalten, Struktur, Adaption und Veränderung über Zeit erzeugen.', 'How local interactions generate global behavior, structure, adaptation and change over time.')}</p><a className="eil-text-link" href={href('research-complex')}>{tx('Forschungsdomäne ansehen', 'View research domain')} →</a></article>
        <article><span className="eil-fold-kicker">{tx('VERBORGENE ZUSTÄNDE & ÜBERGÄNGE', 'HIDDEN STATES & TRANSITIONS')}</span><h3>{tx('Systemrekonstruktion', 'System Reconstruction')}</h3><p>{tx('Wie sich aus unvollständiger Evidenz Zustand, Beziehungen, Constraints und kausale Struktur rekonstruieren lassen.', 'How incomplete evidence can be used to reconstruct state, relationships, constraints and causal structure.')}</p><a className="eil-text-link" href={href('research-reconstruction')}>{tx('Forschungsdomäne ansehen', 'View research domain')} →</a></article>
        <article><span className="eil-fold-kicker">{tx('ARCHITEKTUREN, DIE UNTERSUCHEN', 'ARCHITECTURES THAT INVESTIGATE')}</span><h3>Intelligence</h3><p>{tx('Wie spezialisierte intelligente Systeme schließen, Zustand bewahren, koordinieren, Hypothesen prüfen, Fehler erkennen und sich erholen.', 'How specialized intelligent systems reason, preserve state, coordinate, test hypotheses, detect failure and recover.')}</p><a className="eil-text-link" href={href('research-computational')}>{tx('Forschungsdomäne ansehen', 'View research domain')} →</a></article>
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
      <div className="eil-system-grid">{intelligenceSystems.slice(0, 4).map(entry => <article className="eil-card" key={entry.key}><Status>{entry.kicker}</Status><h3>{entry.title}</h3><p>{tx(entry.leadDe, entry.leadEn)}</p></article>)}</div>
      <a className="eil-text-link" href={href('systems')}>{tx('Systemarchitektur ansehen', 'Explore system architecture')} →</a>
    </section>

    <section className="eil-section eil-environment-overview"><div className="eil-section-head"><Status>{tx('INFRASTRUKTUR & AKTIVE FORSCHUNGSSYSTEME', 'INFRASTRUCTURE & ACTIVE RESEARCH SYSTEMS')}</Status><h2>{tx('Drei Systeme, drei unterschiedliche Reifegrade.', 'Three systems, three different maturity states.')}</h2></div>
      <div className="eil-environment-grid">
        <article><Status>{tx('GEBAUT', 'BUILT')}</Status><h3>EIL Kernel</h3><p>{tx('Existierende Runtime-Grundlage für zustandsbehaftete Agenten- und Forschungssysteme, inklusive Runtime, State, Context, Memory, Monitoring, Evidence, Recovery, Tests und Audit Trails.', 'Existing runtime foundation for stateful agent and research systems, including runtime, state, context, memory, monitoring, evidence, recovery, tests and audit trails.')}</p></article>
        <article><Status>{tx('AKTIVE FORSCHUNG', 'ACTIVE RESEARCH')}</Status><h3>DINGIR</h3><p>{tx('Das kollaborative System für Hidden-State-Rekonstruktion, Kausalketten, Zustandsübergänge und Prediction.', 'The collaborative system for hidden-state reconstruction, causal chains, state transitions and prediction.')}</p></article>
        <article><Status>{tx('FORSCHUNGSINSTRUMENT', 'RESEARCH INSTRUMENT')}</Status><h3>Observatory</h3><p>{tx('Forschungsumgebung für System-Observability, Rekonstruktionen, Daten und Visualisierung, mit dem internen Content-/Admin-Panel verzahnt.', 'Research environment for system observability, reconstructions, data and visualization, tied into the internal content/admin panel.')}</p></article>
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
        <article><h3>{tx('Systemrekonstruktion (Hidden State Reconstruction)', 'System Reconstruction (Hidden State Reconstruction)')}</h3><p>{tx('Wie sich verborgene Zustände, Constraints, Beziehungen und kausale Strukturen aus unvollständiger Evidenz ableiten lassen.', 'How hidden states, constraints, relationships and causal structures can be inferred from incomplete evidence.')}</p><a className="eil-text-link" href={href('research-reconstruction')}>{tx('Forschungsdomäne ansehen', 'View research domain')} →</a></article>
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
      <div className="eil-library-grid">{methodEntries.map(entry => <SpecCard key={entry.key} entry={entry} />)}</div>
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
      <div className="eil-system-grid">{intelligenceSystems.map(entry => <SpecCard key={entry.key} entry={entry} />)}</div>
    </section>
    <section className="eil-section"><div className="eil-section-head"><Status>{tx('INFRASTRUKTUR', 'INFRASTRUCTURE')}</Status></div>
      <div className="eil-environment-grid">{infraSystems.map(entry => <SpecCard key={entry.key} entry={entry} />)}</div>
    </section>
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
    [tx('Experimente', 'Experiments'), tx('Welche Experimente laufen gerade, welche sind abgeschlossen, und mit welchem Ergebnis.', 'Which experiments are currently running, which are finished, and with what result.')],
    [tx('Zustand & Runtime', 'State & Runtime'), tx('Wie sich der Zustand ausgewählter Forschungssysteme über Zeit verändert, nicht nur eine Momentaufnahme.', 'How the state of selected research systems changes over time, not just a single snapshot.')],
    [tx('Rekonstruktionen', 'Reconstructions'), tx('Rekonstruierte Zustände, Beziehungen und Übergänge visuell statt als Textbericht zugänglich machen.', 'Making reconstructed states, relationships and transitions accessible visually instead of as a text report.')],
    [tx('Research Streams', 'Research Streams'), tx('Welche Forschungsstränge über mehrere Untersuchungen hinweg zusammenhängen, statt isolierter Einzelfälle.', 'Which research threads connect across multiple investigations, instead of isolated one-off cases.')],
    [tx('Daten', 'Data'), tx('Woher eine Evidenz stammt, wann sie erhoben wurde und welche Datensätze dahinterstehen.', 'Where a piece of evidence came from, when it was captured and which datasets it draws on.')],
    [tx('Wissenschaftliche Visualisierung', 'Scientific Visualization'), tx('Verläufe, Systemdynamik und kausale Struktur so darstellen, dass ein Muster tatsächlich erkennbar wird.', 'Representing trajectories, system dynamics and causal structure so a pattern actually becomes recognizable.')],
  ] as const

  const Observatory = () => <>
    <PageHero eyebrow="RESEARCH INSTRUMENT" title="Observatory" body={tx('Experimentelle Sichtbarkeit laufender Forschungssysteme.', 'Experimental visibility into ongoing research systems.')} crumbs={[[tx('Start', 'Home'), 'home'], ['Observatory', null]]} />
    <section className="eil-section"><div className="eil-section-head"><Status>{tx('FORSCHUNGSINSTRUMENT', 'RESEARCH INSTRUMENT')}</Status><p>{tx('Das Observatory ist die Forschungsumgebung für Experimente, Zustand, Rekonstruktionen, Daten, Runtime-Verhalten und wissenschaftliche Visualisierung. Es ist mit dem internen Content-/Admin-Panel verzahnt; daneben wird parallel ein eigenständiges internes Observatory weitergebaut.', 'The Observatory is the research environment for experiments, state, reconstructions, data, runtime behavior and scientific visualization. It ties into the internal content/admin panel; a standalone internal Observatory is being built out alongside it.')}</p></div>
      <div className="eil-observatory-grid">{observatoryItems.map(([name,d])=><article key={name}><h3>{name}</h3><p>{d}</p></article>)}</div>
    </section>
  </>

  // -- Notes ----------------------------------------------------------------
  const Notes = () => <><PageHero eyebrow="PUBLIC RESEARCH COMMUNICATION" title="Research Notes" body={tx('Lab Notes, Research Notes, Case Studies, Methods und Commentary – klar voneinander unterschieden.', 'Lab notes, research notes, case studies, methods and commentary—clearly distinguished.')} crumbs={[[tx('Start', 'Home'), 'home'], ['Research Notes', null]]} /><section className="eil-section"><div className="eil-notes-grid">{(content.news?.items ?? []).map(n=><article className="eil-card" key={n.id}><Status>RESEARCH NOTE · PRELIMINARY</Status><time>{n.date}</time><h3>{n.title}</h3><p>{n.body.replace(/<[^>]+>/g,'').slice(0,220)}…</p></article>)}</div></section></>

  // -- Applied Research -------------------------------------------------
  const appliedProcessSteps: [string, string, string][] = [
    ['Problem', 'Das konkrete Problem im externen System wird benannt, nicht vorausgesetzt.', 'The concrete problem in the external system gets named, not assumed.'],
    [tx('Forschungsfrage', 'Research Question'), 'Das Problem wird in eine prüfbare Frage übersetzt, die tatsächlich beantwortbar ist.', 'The problem gets translated into a testable question that can actually be answered.'],
    [tx('Abgrenzung', 'Boundary'), 'Systemgrenze und Scope werden schriftlich festgelegt, bevor untersucht wird.', 'System boundary and scope are fixed in writing before investigation starts.'],
    ['Evidence', 'Nur was tatsächlich belegt ist, geht in den Befund ein – keine Annahmen als Fakt.', 'Only what is actually documented goes into the finding — no assumptions dressed up as fact.'],
  ]

  const Applied = () => <>
    <PageHero eyebrow="APPLIED RESEARCH" title="Applied Research" body={tx('Forschungsmethoden angewendet auf begrenzte reale Systeme.', 'Research methods applied to bounded real-world systems.')} crumbs={[[tx('Start', 'Home'), 'home'], ['Applied Research', null]]} />
    <section className="eil-section"><div className="eil-section-head"><p>{tx('EIL kann Rekonstruktion, Behavioral Analysis, KI-gestützte Systemdiagnostik und adversariales Systemdenken auf konkrete externe Systeme anwenden, ohne das Lab in eine generische Beratung zu verwandeln.', 'EIL can apply reconstruction, behavioral analysis, AI-augmented system diagnostics and adversarial systems thinking to concrete external systems without turning the lab into a generic consultancy.')}</p></div>
      <div className="eil-process">{appliedProcessSteps.map(([label, d, e],i)=><article key={label}><span>{String(i+1).padStart(2,'0')}</span><strong>{label}</strong><p>{tx(d,e)}</p></article>)}</div>
    </section>
    <section className="eil-section"><div className="eil-domain-grid">{appliedCapabilities.map(entry => <SpecCard key={entry.key} entry={entry} />)}</div></section>
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
  return <div className="eil-site" data-theme={theme}><Header/><main className="eil-main"><Page/></main><Footer/>{openModal && <SpecModal/>}</div>
}
