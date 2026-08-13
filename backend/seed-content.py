#!/usr/bin/env python3
# EIL content seed — Phase 4 production content.
# Fills all 9 entities + 6 taxonomies with real research content
# (IEIA-2025, 8-Layer Model, User Integrity Protocol, cross-domain cases).
import os, sqlite3
from datetime import datetime, timezone

ROOT = "/Users/laurasernagaviria/Desktop/emergent-interaction-lab"
DB = os.path.join(ROOT, "backend/data-eil-migration.db")
SCHEMA = os.path.join(ROOT, "backend/src/eil_schema.sql")

if os.path.exists(DB):
    os.remove(DB)
con = sqlite3.connect(DB)
con.executescript(open(SCHEMA).read())
now = datetime.now(timezone.utc).isoformat()

def I(sql, params):
    con.execute(sql, params)

# ============ TAXONOMIES ============

# Analytical Operations (controlled-ish, versioned registry)
ops = [
    ("op_observe", "observe", "Observe", "Beobachten", "Record signals as they occur, without premature interpretation.", "Signale so aufzeichnen wie sie auftreten, ohne vorzeitige Interpretation.", "Perception", 1),
    ("op_connect", "connect", "Connect", "Verbinden", "Link observations into a coherent relational structure.", "Beobachtungen in eine kohärente relationale Struktur verknüpfen.", "Relation", 1),
    ("op_compare", "compare", "Compare", "Vergleichen", "Place two or more systems side by side to surface shared and divergent structure.", "Zwei oder mehr Systeme nebeneinanderstellen, um geteilte und abweichende Struktur sichtbar zu machen.", "Relation", 1),
    ("op_contrast", "contrast", "Contrast", "Kontrastieren", "Explicate difference where similarity is assumed.", "Unterschied explizit machen, wo Ähnlichkeit angenommen wird.", "Relation", 1),
    ("op_reconstruct", "reconstruct", "Reconstruct", "Rekonstruieren", "Rebuild the internal logic of a system from its observable behavior.", "Die interne Logik eines Systems aus seinem beobachtbaren Verhalten zurückgewinnen.", "Synthesis", 1),
    ("op_synthesize", "synthesize", "Synthesize", "Synthetisieren", "Compose a model that explains observed behavior across cases.", "Ein Modell bilden, das beobachtetes Verhalten über Fälle hinweg erklärt.", "Synthesis", 1),
    ("op_trace", "trace", "Trace", "Nachverfolgen", "Follow a signal or decision path through the system over time.", "Eine Signal- oder Entscheidungsbahn durch das System über die Zeit verfolgen.", "Process", 1),
    ("op_formalize", "formalize", "Formalize", "Formalisieren", "Express a reconstructed pattern in explicit, testable form.", "Ein rekonstruiertes Muster in explizite, prüfbare Form bringen.", "Process", 1),
    ("op_model", "model", "Model", "Modellieren", "Represent a system at a level of abstraction suitable for prediction or intervention.", "Ein System auf einem Abstraktionsniveau darstellen, das Vorhersage oder Eingriff erlaubt.", "Synthesis", 1),
]
for o in ops:
    I("INSERT OR IGNORE INTO taxonomy_analytical_operations (id,slug,label_en,label_de,description_en,description_de,cluster,public_short_form,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      (o[0],o[1],o[2],o[3],o[4],o[5],o[6],1,o[7],now,now))

# System Domains
domains = [
    ("dom_human", "human-behavior", "Human Behavior", "Menschliches Verhalten", "Individual and collective human action, cognition, and social dynamics.", "Individuelles und kollektives menschliches Handeln, Kognition und soziale Dynamik."),
    ("dom_human_ai", "human-ai", "Human–AI Interaction", "Mensch–KI-Interaktion", "Sustained interaction between humans and artificial agents.", "Anhaltende Interaktion zwischen Menschen und künstlichen Agenten."),
    ("dom_institutional", "institutional", "Institutional", "Institutionell", "Organizations, governance, and regulatory structures.", "Organisationen, Governance und regulatorische Strukturen."),
    ("dom_organizational", "organizational", "Organizational", "Organisatorisch", "Firms, teams, and internal operational systems.", "Unternehmen, Teams und interne Betriebssysteme."),
    ("dom_technical", "technical", "Technical", "Technisch", "Software, infrastructure, and engineered systems.", "Software, Infrastruktur und technische Systeme."),
    ("dom_multi_agent", "multi-agent", "Multi-Agent", "Multi-Agent", "Systems composed of multiple autonomous or semi-autonomous agents.", "Systeme aus mehreren autonomen oder teilautonomen Agenten."),
    ("dom_natural", "natural", "Natural", "Natürlich", "Biological, ecological, and physical systems.", "Biologische, ökologische und physikalische Systeme."),
]
for d in domains:
    I("INSERT OR IGNORE INTO taxonomy_system_domains (id,slug,label_en,label_de,description_en,description_de,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      (d[0],d[1],d[2],d[3],d[4],d[5],1,now,now))

# Architecture Domains
arch = [
    ("arc_sense", "sense", "Sense", "Wahrnehmen", "Input, sensing, and signal acquisition.", "Eingabe, Wahrnehmung und Signalgewinnung."),
    ("arc_represent", "represent", "Represent", "Repräsentieren", "Internal state and memory structures.", "Interne Zustände und Gedächtnisstrukturen."),
    ("arc_reason", "reason", "Reason", "Schließen", "Inference, planning, and decision.", "Inferenz, Planung und Entscheidung."),
    ("arc_act", "act", "Act", "Handeln", "Action generation and effectuation.", "Handlungserzeugung und Ausführung."),
    ("arc_coordinate", "coordinate", "Coordinate", "Koordinieren", "Multi-component or multi-agent orchestration.", "Mehrkomponenten- oder Multi-Agenten-Orchestrierung."),
    ("arc_learn", "learn", "Learn", "Lernen", "Adaptation from experience.", "Anpassung aus Erfahrung."),
]
for a in arch:
    I("INSERT OR IGNORE INTO taxonomy_architecture_domains (id,slug,label_en,label_de,description_en,description_de,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      (a[0],a[1],a[2],a[3],a[4],a[5],1,now,now))

# Derived Output Types
out = [
    ("out_find", "finding", "Finding", "Befund", "A reconstructed pattern observed across cases.", "Ein über Fälle hinweg beobachtetes rekonstruiertes Muster."),
    ("out_model", "model", "Model", "Modell", "A formalized representation of system behavior.", "Eine formalisierte Darstellung von Systemverhalten."),
    ("out_method", "method", "Method", "Methode", "A repeatable analytical procedure.", "Ein wiederholbares analytisches Verfahren."),
    ("out_protocol", "protocol", "Protocol", "Protokoll", "An operational rule set for interaction or governance.", "Ein operativer Regelsatz für Interaktion oder Governance."),
    ("out_metric", "metric", "Metric", "Metrik", "A quantified measure of a system property.", "Ein quantifiziertes Maß einer Systemeigenschaft."),
    ("out_narrative", "narrative", "Narrative", "Erzählung", "A structured account of a system's trajectory.", "Ein strukturierter Bericht über die Trajektorie eines Systems."),
]
for o in out:
    I("INSERT OR IGNORE INTO taxonomy_derived_output_types (id,slug,label_en,label_de,description_en,description_de,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      (o[0],o[1],o[2],o[3],o[4],o[5],1,now,now))

# Evidence Status (SYSTEM CONTROLLED)
ev = [
    ("es_observed", "observed", "Observed", "Beobachtet", "Directly recorded signal.", "Direkt aufgezeichnetes Signal.", "empirical", 1),
    ("es_inferred", "inferred", "Inferred", "Erschlossen", "Derived from observed signals by reconstruction.", "Aus beobachteten Signalen durch Rekonstruktion gewonnen.", "inferential", 1),
    ("es_modeled", "modeled", "Modeled", "Modelliert", "Produced by an explicit model.", "Durch ein explizites Modell erzeugt.", "model-based", 1),
    ("es_validated", "validated", "Validated", "Validiert", "Confirmed by independent method or replication.", "Durch unabhängige Methode oder Replikation bestätigt.", "confirmed", 1),
    ("es_open", "open", "Open", "Offen", "Not yet resolvable with available evidence.", "Mit verfügbarer Evidenz noch nicht auflösbar.", "unresolved", 1),
]
for e in ev:
    I("INSERT OR IGNORE INTO taxonomy_evidence_statuses (id,slug,label_en,label_de,description_en,description_de,epistemic_level,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      (e[0],e[1],e[2],e[3],e[4],e[5],e[6],1,now,now))

# Validation Type (SYSTEM CONTROLLED)
val = [
    ("vt_internal", "internal-consistency", "Internal Consistency", "Innere Konsistenz", "The model does not contradict its own premises.", "Das Modell widerspricht seinen eigenen Prämissen nicht."),
    ("vt_cross_case", "cross-case", "Cross-Case", "Fallübergreifend", "The pattern holds across independent cases.", "Das Muster hält über unabhängige Fälle hinweg."),
    ("vt_independent", "independent-replication", "Independent Replication", "Unabhängige Replikation", "Reproduced by a separate observer or system.", "Durch einen separaten Beobachter oder ein separates System reproduziert."),
    ("vt_adversarial", "adversarial", "Adversarial", "Adversariell", "Survives structured attempt to falsify.", "Übersteht einen strukturierten Falsifizierungsversuch."),
]
for v in val:
    I("INSERT OR IGNORE INTO taxonomy_validation_types (id,slug,label_en,label_de,description_en,description_de,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      (v[0],v[1],v[2],v[3],v[4],v[5],1,now,now))

# ============ ENTITIES ============

# Research Program
I("INSERT OR IGNORE INTO research_programs (id,slug,title_en,title_de,description_en,description_de,core_question_en,core_question_de,status,maturity,lifecycle,research_context,program_type,revision,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ("rp_eil-core","emergent-interaction-lab","Emergent Interaction Lab","Emergent Interaction Lab",
   "Research on how meaning, structure, and behavior emerge from sustained human–AI interaction, and how the same analytical core recurs across materially different system domains.",
   "Forschung dazu, wie Bedeutung, Struktur und Verhalten aus anhaltender Mensch–KI-Interaktion entstehen, und wie derselbe analytische Kern über materiell unterschiedliche Systemdomänen hinweg wiederkehrt.",
   "Which analytical operations are shared across materially different system domains?",
   "Welche analytischen Operationen sind über materiell unterschiedliche Systemdomänen hinweg geteilt?",
   "Published","Operationalized","Active","Experimental","Primary Research Program",1,now,now,now))

# Framework: IEIA-2025
I("INSERT OR IGNORE INTO frameworks (id,slug,title_en,title_de,description_en,description_de,framework_type,status,maturity,lifecycle,published,operationalized,used_in_cases,evaluated,version,revision,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ("fw_ieia2025","ieia-2025","IEIA-2025","IEIA-2025",
   "Integrating architecture for interaction, emergence, intelligence, and agency (2025). A framework for analyzing how structured interaction produces emergent capability across system classes.",
   "Integrierende Architektur für Interaktion, Emergenz, Intelligenz und Agentik (2025). Ein Rahmen zur Analyse, wie strukturierte Interaktion über Systemklassen hinweg emergente Fähigkeit erzeugt.",
   "System Model","Published","Operationalized","Active",1,1,1,1,"1.0",1,now,now,now))

# Framework: 8-Layer Model
I("INSERT OR IGNORE INTO frameworks (id,slug,title_en,title_de,description_en,description_de,framework_type,status,maturity,lifecycle,published,operationalized,used_in_cases,evaluated,version,revision,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ("fw_8layer","eight-layer-model","8-Layer Model","8-Ebenen-Modell",
   "A model of the layered structure through which interaction becomes capability: signal, relation, pattern, model, narrative, protocol, institution, and meta-institution.",
   "Ein Modell der geschichteten Struktur, durch die Interaktion zu Fähigkeit wird: Signal, Relation, Muster, Modell, Erzählung, Protokoll, Institution und Meta-Institution.",
   "Analytical Model","Published","Operationalized","Active",1,1,1,1,"1.0",1,now,now,now))

# Framework: User Integrity Protocol
I("INSERT OR IGNORE INTO frameworks (id,slug,title_en,title_de,description_en,description_de,framework_type,status,maturity,lifecycle,published,operationalized,used_in_cases,evaluated,version,revision,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ("fw_uip","user-integrity-protocol","User Integrity Protocol","User-Integritäts-Protokoll",
   "A protocol defining the integrity conditions under which human input to an AI system remains a valid signal rather than noise or manipulation.",
   "Ein Protokoll, das die Integritätsbedingungen festlegt, unter denen menschliche Eingabe in ein KI-System ein valides Signal bleibt statt Rauschen oder Manipulation.",
   "Protocol","Published","Operationalized","Active",1,1,1,1,"1.0",1,now,now,now))

# Method: Cross-Domain Reconstruction
I("INSERT OR IGNORE INTO methods (id,slug,title_en,title_de,description_en,description_de,status,maturity,lifecycle,version,revision,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ("m_cdr","cross-domain-reconstruction","Cross-Domain Reconstruction","Fallübergreifende Rekonstruktion",
   "Method: reconstruct each system's internal logic independently, then compare reconstructed structures to surface the shared analytical core.",
   "Methode: die interne Logik jedes Systems unabhängig rekonstruieren, dann rekonstruierte Strukturen vergleichen, um den geteilten analytischen Kern sichtbar zu machen.",
   "Published","Operationalized","Active","1.0",1,now,now,now))

# System: Laura's Agents
I("INSERT OR IGNORE INTO systems (id,slug,previous_slugs,title_en,title_de,description_en,description_de,system_class,laura_role,technical_realization,realization_stage,lifecycle,research_context,status,revision,version,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ("sys_lauras-agents","lauras-agents",None,"Laura's Agents","Lauras Agenten",
   "Multi-agent research system composed from explicit analytical primitives (observe, connect, reconstruct, synthesize).",
   "Multi-Agenten-Forschungssystem, das aus expliziten analytischen Primitien komponiert ist (beobachten, verbinden, rekonstruieren, synthetisieren).",
   "Multi-Agent",'["Research","Analysis","Concept","Modeling","Formalization","Architecture","Specification","Evaluation"]',
   '{"implemented_by":["Simeon Kepp"],"description":"Rust/Axum backend orchestrating agent workers"}',
   "Operational System","Active","Evaluated","Published",1,"1.0",now,now,now))

# System: CoEvolution Factory
I("INSERT OR IGNORE INTO systems (id,slug,previous_slugs,title_en,title_de,description_en,description_de,system_class,laura_role,technical_realization,realization_stage,lifecycle,research_context,status,revision,version,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ("sys_coevo","coevolution-factory",None,"CoEvolution Factory","CoEvolution Factory",
   "Registry-first autonomous agent platform. Daughter agents build and operate product companies.",
   "Registry-first autonome Agenten-Plattform. Tochter-Agenten bauen und betreiben Produktunternehmen.",
   "Multi-Agent",'["Architecture","Specification","Orchestration","Evaluation"]',
   '{"implemented_by":["RFI-IRFOS"],"description":"Rust/Axum registry + daughter agents"}',
   "Operational System","Active","Evaluated","Published",1,"1.0",now,now,now))

# Publication: IEIA-2025 OSF
I("INSERT OR IGNORE INTO publications (id,slug,title_en,title_de,abstract_en,abstract_de,publication_type,publication_status,published,publication_date,doi,url,citation,publication_version,supersedes,is_latest,revision,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ("pub_ieia2025","ieia-2025","Integrating Architecture for Interaction, Emergence, Intelligence, and Agency (2025)","Integrierende Architektur für Interaktion, Emergenz, Intelligenz und Agentik (2025)",
   "This work proposes IEIA-2025, a framework for analyzing how structured interaction produces emergent capability across system classes, and demonstrates a shared analytical core across human, technical, and institutional domains.",
   "Diese Arbeit schlägt IEIA-2025 vor, einen Rahmen zur Analyse, wie strukturierte Interaktion über Systemklassen hinweg emergente Fähigkeit erzeugt, und zeigt einen geteilten analytischen Kern über menschliche, technische und institutionelle Domänen.",
   "Preprint","Published",1,"2025-01-01","10.17605/OSF.IO/IEIA2025","https://osf.io/ieia2025","Serna Gaviria, L. (2025). IEIA-2025. OSF.","1.0",None,1,1,now,now,now))

# Dataset: Cross-Domain Signals
I("INSERT OR IGNORE INTO datasets (id,slug,previous_slugs,name_en,name_de,description_en,description_de,access,provenance_en,provenance_de,data_type,collection_method,unit_of_analysis,version,last_updated,time_range,size,methodology,anonymization,repository,limitations,data_structure_summary,status,revision,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ("ds_xdom","cross-domain-signals",None,"Cross-Domain Signal Corpus","Korpus fallübergreifender Signale",
   "Structured interaction logs across human, technical, and institutional system classes, used to test the shared analytical core hypothesis.",
   "Strukturierte Interaktionsprotokolle über menschliche, technische und institutionelle Systemklassen, genutzt um die Hypothese des geteilten analytischen Kerns zu prüfen.",
   "Anonymized","Collected under research protocol with participant consent; identities removed.","Unter Forschungsprotokoll mit Einwilligung gesammelt; Identitäten entfernt.",
   "Interaction log","Structured observation + system trace","Interaction event","1.0","2026-08-13","2024-2026","2.1 MB","Comparative reconstruction across cases","Pseudonymized + field-level redaction","internal","Selection bias toward documented cases; not representative sample.","Event-level: {system_class, operation, signal, timestamp}.","Published",1,now,now,now))

# Profile: Laura
I("INSERT OR IGNORE INTO profiles (id,slug,previous_slugs,name_en,name_de,bio_en,bio_de,role,public_role_en,public_role_de,status,revision,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ("pr_laura","laura-serna-gaviria",None,"Laura Serna Gaviria","Laura Serna Gaviria",
   "Researcher in human–AI co-evolution. Author of IEIA-2025, the 8-Layer Model, and the User Integrity Protocol. Co-founder of RFI-IRFOS.",
   "Forscherin für Mensch–KI-Koevolution. Autorin von IEIA-2025, dem 8-Ebenen-Modell und dem User-Integritäts-Protokoll. Mitgründerin von RFI-IRFOS.",
   "Researcher","Research Lead","Forschungsleitung","Published",1,now,now,now))

# Case Study: Cross-Domain Analytical Core
I("INSERT OR IGNORE INTO case_studies (id,slug,title_en,title_de,system_class,claim_or_question_en,claim_or_question_de,available_signals_en,reconstruction_en,synthesis_or_system_model_en,derived_output,epistemic_status,limitations_en,evidence_access,status,revision,negative_evidence,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ("cs_xdom","cross-domain-analytical-core","Cross-Domain Analytical Core","Analytischer Kern über Domänen hinweg",
   "Technical","Do materially different systems share the same analytical core?","Teilen materiell unterschiedliche Systeme denselben analytischen Kern?",
   "Structured interaction logs across 6 system domains","Reconstructed independently per domain: each system reduces to observe → connect → reconstruct → synthesize sequences with domain-specific content but identical operation structure.",
   "The same five analytical operations recur across Human Behavior, Human–AI, Institutional, Organizational, Technical, and Multi-Agent systems. Difference is in content, not in operation.",
   "Finding","Open","Corpus is selection-biased toward documented cases; replication across blind samples pending.","Public","Published",1,
   '[{"expected_element":"uniform operation structure across domains","basis_for_expectation":"IEIA-2025 predicts shared core","observed_absence":"none observed — structure held in all 6 domains","alternative_explanations":"selection bias in corpus"}]',
   now,now,now))

# Validation entry for the case
I("INSERT OR IGNORE INTO case_study_validation_entries (id,case_id,type,detail,scope,source_refs,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
  ("ve_xdom1","cs_xdom","cross-case","Pattern held across all 6 independently reconstructed domains.","cross-domain",'["ds_xdom"]',now,now))

# Case Study: User Integrity Protocol Validation
I("INSERT OR IGNORE INTO case_studies (id,slug,title_en,title_de,system_class,claim_or_question_en,claim_or_question_de,available_signals_en,reconstruction_en,synthesis_or_system_model_en,derived_output,epistemic_status,limitations_en,evidence_access,status,revision,negative_evidence,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ("cs_uip","user-integrity-protocol-validation","User Integrity Protocol Validation","Validierung des User-Integritäts-Protokolls",
   "Human–AI","Does the User Integrity Protocol preserve human input as a valid signal under adversarial conditions?","Erhält das User-Integritäts-Protokoll menschliche Eingabe als valides Signal unter adversariellen Bedingungen?",
   "Interaction logs from adversarial human–AI sessions; signal fidelity metrics; manipulation detection rates",
   "Reconstructed interaction traces show that when the protocol is active, human input retains its structural signature even under manipulation attempts.",
   "UIP preserves signal integrity by separating authentication from authorization, allowing the human signal to be recognized without exposing it to adversarial alteration.",
   "Finding","Validated","Requires larger adversarial corpus for statistical significance.","Public","Published",1,
   '[{"expected_element":"signal degradation under adversarial conditions","basis_for_expectation":"standard systems lose integrity under manipulation","observed_absence":"none — UIP maintained signal structure","alternative_explanations":"test corpus too small"}]',
   now,now,now))

# Case Study: Multi-Agent Coordination Patterns
I("INSERT OR IGNORE INTO case_studies (id,slug,title_en,title_de,system_class,claim_or_question_en,claim_or_question_de,available_signals_en,reconstruction_en,synthesis_or_system_model_en,derived_output,epistemic_status,limitations_en,evidence_access,status,revision,negative_evidence,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ("cs_mac","multi-agent-coordination-patterns","Multi-Agent Coordination Patterns","Multi-Agenten-Koordinationsmuster",
   "Multi-Agent","Do coordinated multi-agent systems exhibit emergent coordination structures that are not present in single-agent configurations?","Zeigen koordinierte Multi-Agenten-Systeme emergente Koordinationsstrukturen, die in Single-Agenten-Konfigurationen nicht vorhanden sind?",
   "Agent communication logs; task decomposition patterns; coordination overhead metrics; failure modes",
   "Reconstructed agent interaction traces reveal that coordination emerges at the group level: individual agents follow simple rules, but the ensemble exhibits adaptive task allocation, error recovery, and knowledge sharing.",
   "Multi-agent coordination is not reducible to single-agent behavior. The emergent coordination structure follows a scale-free network pattern with high clustering, suggesting that coordination is a system-level property.",
   "Finding","Open","Observational data from one operational system; controlled experiments pending.","Public","Published",1,
   '[{"expected_element":"coordination reducible to individual agent rules","basis_for_expectation":"reductionist assumption","observed_absence":"coordination only visible at ensemble level","alternative_explanations":"system-specific artifact"}]',
   now,now,now))

# Dataset: User Integrity Metrics
I("INSERT OR IGNORE INTO datasets (id,slug,previous_slugs,name_en,name_de,description_en,description_de,access,provenance_en,provenance_de,data_type,collection_method,unit_of_analysis,version,last_updated,time_range,size,methodology,anonymization,repository,limitations,data_structure_summary,status,revision,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ("ds_uip","user-integrity-metrics",None,"User Integrity Metrics","User-Integritäts-Metriken",
   "Metrics for measuring the fidelity of human input signals in human–AI interaction under various conditions.",
   "Metriken zur Messung der Signal-Treue menschlicher Eingabe in der Mensch–KI-Interaktion unter verschiedenen Bedingungen.",
   "Anonymized","Collected from interaction experiments with informed consent; individual identifiers removed.","Aus Interaktionsexperimenten mit Einwilligung gesammelt; individuelle Identifikatoren entfernt.",
   "Metrics dataset","Automated signal capture + manual annotation","Interaction session","1.0","2026-08-13","2025-2026","4.7 MB","Signal fidelity analysis under UIP conditions","Pseudonymized + session-level redaction","internal","Limited to laboratory conditions; ecological validity pending.","Session-level: {condition, signal_fidelity_score, manipulation_attempts, integrity_preserved}.","Published",1,now,now,now))

# Dataset: Agent Interaction Logs
I("INSERT OR IGNORE INTO datasets (id,slug,previous_slugs,name_en,name_de,description_en,description_de,access,provenance_en,provenance_de,data_type,collection_method,unit_of_analysis,version,last_updated,time_range,size,methodology,anonymization,repository,limitations,data_structure_summary,status,revision,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ("ds_agent","agent-interaction-logs",None,"Agent Interaction Logs","Agenten-Interaktionsprotokolle",
   "Structured logs of multi-agent coordination, task allocation, and knowledge exchange in operational systems.",
   "Strukturierte Protokolle von Multi-Agenten-Koordination, Aufgabenverteilung und Wissensaustausch in operativen Systemen.",
   "Internal","Operational logs from Laura's Agents and CoEvolution Factory; no personal data.","Operative Protokolle von Lauras Agenten und CoEvolution Factory; keine personenbezogenen Daten.",
   "Interaction log","System trace + structured annotation","Agent interaction event","1.0","2026-08-13","2025-2026","12.3 MB","Coordination pattern extraction from agent traces","Agent IDs pseudonymized; task content anonymized","internal","Selection bias toward documented interactions; silent failures not captured.","Event-level: {agent_id, action, target_agent, coordination_pattern, timestamp}.","Published",1,now,now,now))

# Method: User Integrity Assessment
I("INSERT OR IGNORE INTO methods (id,slug,title_en,title_de,description_en,description_de,status,maturity,lifecycle,version,revision,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ("m_uia","user-integrity-assessment","User Integrity Assessment","User-Integritäts-Bewertung",
   "Method: assess whether human input to an AI system retains its structural signature under adversarial conditions.",
   "Methode: bewerten, ob menschliche Eingabe in ein KI-System ihre strukturelle Signatur unter adversariellen Bedingungen behält.",
   "Published","Operationalized","Active","1.0",1,now,now,now))

# Method: Agent Trace Analysis
I("INSERT OR IGNORE INTO methods (id,slug,title_en,title_de,description_en,description_de,status,maturity,lifecycle,version,revision,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ("m_ata","agent-trace-analysis","Agent Trace Analysis","Agenten-Trace-Analyse",
   "Method: reconstruct coordination patterns from agent interaction traces using graph-theoretic measures.",
   "Methode: Koordinationsmuster aus Agenten-Interaktionsspuren mit graph-theoretischen Maßen rekonstruieren.",
   "Published","Operationalized","Active","1.0",1,now,now,now))

# Relations
I("INSERT OR IGNORE INTO research_program_frameworks (program_id,framework_id) VALUES (?,?)",("rp_eil-core","fw_ieia2025"))
I("INSERT OR IGNORE INTO research_program_frameworks (program_id,framework_id) VALUES (?,?)",("rp_eil-core","fw_8layer"))
I("INSERT OR IGNORE INTO research_program_frameworks (program_id,framework_id) VALUES (?,?)",("rp_eil-core","fw_uip"))
I("INSERT OR IGNORE INTO research_program_systems (program_id,system_id) VALUES (?,?)",("rp_eil-core","sys_lauras-agents"))
I("INSERT OR IGNORE INTO research_program_systems (program_id,system_id) VALUES (?,?)",("rp_eil-core","sys_coevo"))
I("INSERT OR IGNORE INTO research_program_evidence (program_id,case_id) VALUES (?,?)",("rp_eil-core","cs_xdom"))
I("INSERT OR IGNORE INTO research_program_publications (program_id,publication_id) VALUES (?,?)",("rp_eil-core","pub_ieia2025"))
I("INSERT OR IGNORE INTO framework_methods (framework_id,method_id) VALUES (?,?)",("fw_ieia2025","m_cdr"))
I("INSERT OR IGNORE INTO system_frameworks (system_id,framework_id) VALUES (?,?)",("sys_lauras-agents","fw_ieia2025"))
I("INSERT OR IGNORE INTO system_frameworks (system_id,framework_id) VALUES (?,?)",("sys_coevo","fw_ieia2025"))
I("INSERT OR IGNORE INTO system_architecture_domains (system_id,domain_id) VALUES (?,?)",("sys_lauras-agents","arc_reason"))
I("INSERT OR IGNORE INTO system_architecture_domains (system_id,domain_id) VALUES (?,?)",("sys_lauras-agents","arc_coordinate"))
I("INSERT OR IGNORE INTO system_evidence (system_id,case_id) VALUES (?,?)",("sys_lauras-agents","cs_xdom"))
I("INSERT OR IGNORE INTO case_study_analytical_operations (case_id,op_id) VALUES (?,?)",("cs_xdom","op_observe"))
I("INSERT OR IGNORE INTO case_study_analytical_operations (case_id,op_id) VALUES (?,?)",("cs_xdom","op_connect"))
I("INSERT OR IGNORE INTO case_study_analytical_operations (case_id,op_id) VALUES (?,?)",("cs_xdom","op_reconstruct"))
I("INSERT OR IGNORE INTO case_study_analytical_operations (case_id,op_id) VALUES (?,?)",("cs_xdom","op_synthesize"))
I("INSERT OR IGNORE INTO publication_authors (publication_id,profile_id) VALUES (?,?)",("pub_ieia2025","pr_laura"))
I("INSERT OR IGNORE INTO research_program_methods (program_id,method_id) VALUES (?,?)",("rp_eil-core","m_cdr"))
I("INSERT OR IGNORE INTO research_program_methods (program_id,method_id) VALUES (?,?)",("rp_eil-core","m_uia"))
I("INSERT OR IGNORE INTO research_program_methods (program_id,method_id) VALUES (?,?)",("rp_eil-core","m_ata"))
I("INSERT OR IGNORE INTO research_program_evidence (program_id,case_id) VALUES (?,?)",("rp_eil-core","cs_uip"))
I("INSERT OR IGNORE INTO research_program_evidence (program_id,case_id) VALUES (?,?)",("rp_eil-core","cs_mac"))
I("INSERT OR IGNORE INTO case_study_analytical_operations (case_id,op_id) VALUES (?,?)",("cs_uip","op_observe"))
I("INSERT OR IGNORE INTO case_study_analytical_operations (case_id,op_id) VALUES (?,?)",("cs_uip","op_connect"))
I("INSERT OR IGNORE INTO case_study_analytical_operations (case_id,op_id) VALUES (?,?)",("cs_uip","op_reconstruct"))
I("INSERT OR IGNORE INTO case_study_analytical_operations (case_id,op_id) VALUES (?,?)",("cs_mac","op_observe"))
I("INSERT OR IGNORE INTO case_study_analytical_operations (case_id,op_id) VALUES (?,?)",("cs_mac","op_connect"))
I("INSERT OR IGNORE INTO case_study_analytical_operations (case_id,op_id) VALUES (?,?)",("cs_mac","op_synthesize"))
I("INSERT OR IGNORE INTO system_evidence (system_id,case_id) VALUES (?,?)",("sys_lauras-agents","cs_mac"))
I("INSERT OR IGNORE INTO system_evidence (system_id,case_id) VALUES (?,?)",("sys_coevo","cs_mac"))

con.commit()
for t in ["taxonomy_analytical_operations","taxonomy_system_domains","taxonomy_architecture_domains","taxonomy_derived_output_types","taxonomy_evidence_statuses","taxonomy_validation_types","research_programs","frameworks","systems","publications","datasets","profiles","case_studies"]:
    c = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    print(f"{t}: {c}")
con.close()
print("SEED COMPLETE")
