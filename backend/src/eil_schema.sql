-- EIL Research Content Schema — Phase 4 implementation
-- Canonical editorial source: SQLite via Axum/Fly.io backend
-- Entity-based model. No page-based blobs.

-- ============ TAXONOMIES (controlled + editorially managed) ============

CREATE TABLE IF NOT EXISTS taxonomy_analytical_operations (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    label_en TEXT NOT NULL,
    label_de TEXT NOT NULL,
    description_en TEXT,
    description_de TEXT,
    cluster TEXT NOT NULL,
    public_short_form BOOLEAN NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS taxonomy_system_domains (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    label_en TEXT NOT NULL,
    label_de TEXT NOT NULL,
    description_en TEXT,
    description_de TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS taxonomy_architecture_domains (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    label_en TEXT NOT NULL,
    label_de TEXT NOT NULL,
    description_en TEXT,
    description_de TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS taxonomy_derived_output_types (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    label_en TEXT NOT NULL,
    label_de TEXT NOT NULL,
    description_en TEXT,
    description_de TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- SYSTEM CONTROLLED: do not allow free editorial extension
CREATE TABLE IF NOT EXISTS taxonomy_evidence_statuses (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    label_en TEXT NOT NULL,
    label_de TEXT NOT NULL,
    description_en TEXT,
    description_de TEXT,
    epistemic_level TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- SYSTEM CONTROLLED
CREATE TABLE IF NOT EXISTS taxonomy_validation_types (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    label_en TEXT NOT NULL,
    label_de TEXT NOT NULL,
    description_en TEXT,
    description_de TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- ============ SOURCES (evidence infrastructure, not public content entity) ============

CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    access TEXT NOT NULL CHECK (access IN ('Public','Anonymized','Private','Restricted')),
    description TEXT,
    date TEXT,
    public_reference TEXT,
    role_in_case TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- ============ FIRST-CLASS ENTITIES ============

CREATE TABLE IF NOT EXISTS research_programs (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    previous_slugs TEXT,  -- JSON array for redirect history
    title_en TEXT NOT NULL,
    title_de TEXT,
    description_en TEXT,
    description_de TEXT,
    core_question_en TEXT,
    core_question_de TEXT,
    status TEXT NOT NULL CHECK (status IN ('Draft','Review','Published','Archived')),
    maturity TEXT CHECK (maturity IN ('Conceptual','Operationalized','Evaluated')),
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('Active','Superseded','Archived')),
    research_context TEXT CHECK (research_context IN ('Experimental','Published Research','Case Evidence','Longitudinal Study')),
    program_type TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    version TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT
);

CREATE TABLE IF NOT EXISTS publications (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    previous_slugs TEXT,
    title_en TEXT NOT NULL,
    title_de TEXT,
    abstract_en TEXT,
    abstract_de TEXT,
    publication_type TEXT NOT NULL,
    publication_status TEXT NOT NULL CHECK (publication_status IN ('Draft','Review','Published','Archived')),
    published BOOLEAN NOT NULL DEFAULT 0,
    publication_date TEXT,
    doi TEXT,
    url TEXT,
    citation TEXT,
    publication_version TEXT,
    supersedes TEXT,
    is_latest BOOLEAN NOT NULL DEFAULT 1,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT
);

CREATE TABLE IF NOT EXISTS methods (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    previous_slugs TEXT,
    title_en TEXT NOT NULL,
    title_de TEXT,
    description_en TEXT,
    description_de TEXT,
    status TEXT NOT NULL CHECK (status IN ('Draft','Review','Published','Archived')),
    maturity TEXT CHECK (maturity IN ('Conceptual','Operationalized','Evaluated')),
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('Active','Superseded','Archived')),
    version TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT
);

CREATE TABLE IF NOT EXISTS frameworks (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    previous_slugs TEXT,
    title_en TEXT NOT NULL,
    title_de TEXT,
    description_en TEXT,
    description_de TEXT,
    framework_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('Draft','Review','Published','Archived')),
    maturity TEXT CHECK (maturity IN ('Conceptual','Operationalized','Evaluated')),
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('Active','Superseded','Archived')),
    published BOOLEAN NOT NULL DEFAULT 0,
    operationalized BOOLEAN NOT NULL DEFAULT 0,
    used_in_cases BOOLEAN NOT NULL DEFAULT 0,
    evaluated BOOLEAN NOT NULL DEFAULT 0,
    version TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT
);

CREATE TABLE IF NOT EXISTS systems (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    previous_slugs TEXT,
    title_en TEXT NOT NULL,
    title_de TEXT,
    description_en TEXT,
    description_de TEXT,
    system_class TEXT NOT NULL,
    laura_role TEXT,  -- JSON array
    technical_realization TEXT,  -- JSON: {implemented_by:[], description:""}
    realization_stage TEXT CHECK (realization_stage IN ('Concept','Architecture','Research Prototype','Operational System')),
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('Active','Archived')),
    research_context TEXT CHECK (research_context IN ('Experimental','Evaluated')),
    status TEXT NOT NULL CHECK (status IN ('Draft','Review','Published','Archived')),
    revision INTEGER NOT NULL DEFAULT 1,
    version TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT
);

CREATE TABLE IF NOT EXISTS case_studies (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    previous_slugs TEXT,
    title_en TEXT NOT NULL,
    title_de TEXT,
    description_en TEXT,
    description_de TEXT,
    system_class TEXT NOT NULL,
    claim_or_question_en TEXT NOT NULL,
    claim_or_question_de TEXT,
    available_signals_en TEXT NOT NULL,
    available_signals_de TEXT,
    reconstruction_en TEXT NOT NULL,
    reconstruction_de TEXT,
    synthesis_or_system_model_en TEXT NOT NULL,
    synthesis_or_system_model_de TEXT,
    challenge_en TEXT,
    challenge_de TEXT,
    alternative_explanations_en TEXT,
    alternative_explanations_de TEXT,
    derived_output TEXT NOT NULL,
    epistemic_status TEXT NOT NULL CHECK (epistemic_status IN ('Observed','Inferred','Modeled','Validated','Open')),
    limitations_en TEXT NOT NULL,
    limitations_de TEXT,
    evidence_access TEXT NOT NULL CHECK (evidence_access IN ('Public','Anonymized','Private','Restricted')),
    outcome_en TEXT,
    outcome_de TEXT,
    related_research_en TEXT,
    related_research_de TEXT,
    public_sources_en TEXT,
    public_sources_de TEXT,
    date TEXT,
    status TEXT NOT NULL CHECK (status IN ('Draft','Review','Published','Archived')),
    revision INTEGER NOT NULL DEFAULT 1,
    negative_evidence TEXT,  -- JSON: embedded array, not first-class
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT
);

CREATE TABLE IF NOT EXISTS experiments (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    previous_slugs TEXT,
    title_en TEXT NOT NULL,
    title_de TEXT,
    research_question_en TEXT NOT NULL,
    research_question_de TEXT,
    setup_en TEXT NOT NULL,
    setup_de TEXT,
    method_en TEXT NOT NULL,
    method_de TEXT,
    experiment_state TEXT NOT NULL CHECK (experiment_state IN ('Planned','Active','Completed','Paused','Archived')),
    baseline_en TEXT,
    baseline_de TEXT,
    comparison_en TEXT,
    comparison_de TEXT,
    metrics_en TEXT,
    metrics_de TEXT,
    results_en TEXT,
    results_de TEXT,
    limitations_en TEXT,
    limitations_de TEXT,
    related_system TEXT,
    status TEXT NOT NULL CHECK (status IN ('Draft','Review','Published','Archived')),
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT
);

CREATE TABLE IF NOT EXISTS datasets (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    previous_slugs TEXT,
    name_en TEXT NOT NULL,
    name_de TEXT,
    description_en TEXT,
    description_de TEXT,
    access TEXT NOT NULL CHECK (access IN ('Public','Anonymized','Private','Restricted')),
    provenance_en TEXT NOT NULL,
    provenance_de TEXT,
    data_type TEXT NOT NULL,
    collection_method TEXT,
    unit_of_analysis TEXT,
    version TEXT,
    last_updated TEXT,
    time_range TEXT,
    size TEXT,
    methodology TEXT,
    anonymization TEXT,
    repository TEXT,
    limitations TEXT,
    data_structure_summary TEXT,
    status TEXT NOT NULL CHECK (status IN ('Draft','Review','Published','Archived')),
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT
);

CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    previous_slugs TEXT,
    name_en TEXT NOT NULL,
    name_de TEXT,
    bio_en TEXT,
    bio_de TEXT,
    role TEXT NOT NULL,
    public_role_en TEXT,
    public_role_de TEXT,
    status TEXT NOT NULL CHECK (status IN ('Draft','Review','Published','Archived')),
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT
);

CREATE TABLE IF NOT EXISTS affiliations (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    organization TEXT NOT NULL,
    role_context TEXT,
    start_date TEXT,
    end_date TEXT,
    current BOOLEAN NOT NULL DEFAULT 1,
    public_reference TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS research_questions (
    id TEXT PRIMARY KEY,
    owner_program_id TEXT,
    owner_experiment_id TEXT,
    question_en TEXT NOT NULL,
    question_de TEXT NOT NULL,
    scope TEXT,
    status TEXT NOT NULL CHECK (status IN ('Open','Active','Answered','Superseded')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_program_id) REFERENCES research_programs(id),
    FOREIGN KEY (owner_experiment_id) REFERENCES experiments(id)
);

-- ============ RELATIONSHIP TABLES ============

CREATE TABLE IF NOT EXISTS case_study_sources (
    case_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    PRIMARY KEY (case_id, source_id),
    FOREIGN KEY (case_id) REFERENCES case_studies(id),
    FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE TABLE IF NOT EXISTS case_study_analytical_operations (
    case_id TEXT NOT NULL,
    op_id TEXT NOT NULL,
    PRIMARY KEY (case_id, op_id),
    FOREIGN KEY (case_id) REFERENCES case_studies(id),
    FOREIGN KEY (op_id) REFERENCES taxonomy_analytical_operations(id)
);

CREATE TABLE IF NOT EXISTS case_study_validation_entries (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    type TEXT NOT NULL,
    detail TEXT NOT NULL,
    scope TEXT NOT NULL,
    source_refs TEXT NOT NULL,  -- JSON array of source IDs
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (case_id) REFERENCES case_studies(id)
);

CREATE TABLE IF NOT EXISTS method_analytical_operations (
    method_id TEXT NOT NULL,
    op_id TEXT NOT NULL,
    PRIMARY KEY (method_id, op_id),
    FOREIGN KEY (method_id) REFERENCES methods(id),
    FOREIGN KEY (op_id) REFERENCES taxonomy_analytical_operations(id)
);

CREATE TABLE IF NOT EXISTS research_program_publications (
    program_id TEXT NOT NULL,
    publication_id TEXT NOT NULL,
    PRIMARY KEY (program_id, publication_id),
    FOREIGN KEY (program_id) REFERENCES research_programs(id),
    FOREIGN KEY (publication_id) REFERENCES publications(id)
);

CREATE TABLE IF NOT EXISTS research_program_methods (
    program_id TEXT NOT NULL,
    method_id TEXT NOT NULL,
    PRIMARY KEY (program_id, method_id),
    FOREIGN KEY (program_id) REFERENCES research_programs(id),
    FOREIGN KEY (method_id) REFERENCES methods(id)
);

CREATE TABLE IF NOT EXISTS research_program_frameworks (
    program_id TEXT NOT NULL,
    framework_id TEXT NOT NULL,
    PRIMARY KEY (program_id, framework_id),
    FOREIGN KEY (program_id) REFERENCES research_programs(id),
    FOREIGN KEY (framework_id) REFERENCES frameworks(id)
);

CREATE TABLE IF NOT EXISTS research_program_systems (
    program_id TEXT NOT NULL,
    system_id TEXT NOT NULL,
    PRIMARY KEY (program_id, system_id),
    FOREIGN KEY (program_id) REFERENCES research_programs(id),
    FOREIGN KEY (system_id) REFERENCES systems(id)
);

CREATE TABLE IF NOT EXISTS research_program_evidence (
    program_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    PRIMARY KEY (program_id, case_id),
    FOREIGN KEY (program_id) REFERENCES research_programs(id),
    FOREIGN KEY (case_id) REFERENCES case_studies(id)
);

CREATE TABLE IF NOT EXISTS framework_methods (
    framework_id TEXT NOT NULL,
    method_id TEXT NOT NULL,
    PRIMARY KEY (framework_id, method_id),
    FOREIGN KEY (framework_id) REFERENCES frameworks(id),
    FOREIGN KEY (method_id) REFERENCES methods(id)
);

CREATE TABLE IF NOT EXISTS system_frameworks (
    system_id TEXT NOT NULL,
    framework_id TEXT NOT NULL,
    PRIMARY KEY (system_id, framework_id),
    FOREIGN KEY (system_id) REFERENCES systems(id),
    FOREIGN KEY (framework_id) REFERENCES frameworks(id)
);

CREATE TABLE IF NOT EXISTS system_architecture_domains (
    system_id TEXT NOT NULL,
    domain_id TEXT NOT NULL,
    PRIMARY KEY (system_id, domain_id),
    FOREIGN KEY (system_id) REFERENCES systems(id),
    FOREIGN KEY (domain_id) REFERENCES taxonomy_architecture_domains(id)
);

CREATE TABLE IF NOT EXISTS system_evidence (
    system_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    PRIMARY KEY (system_id, case_id),
    FOREIGN KEY (system_id) REFERENCES systems(id),
    FOREIGN KEY (case_id) REFERENCES case_studies(id)
);

CREATE TABLE IF NOT EXISTS experiment_research_programs (
    experiment_id TEXT NOT NULL,
    program_id TEXT NOT NULL,
    PRIMARY KEY (experiment_id, program_id),
    FOREIGN KEY (experiment_id) REFERENCES experiments(id),
    FOREIGN KEY (program_id) REFERENCES research_programs(id)
);

CREATE TABLE IF NOT EXISTS experiment_datasets (
    experiment_id TEXT NOT NULL,
    dataset_id TEXT NOT NULL,
    PRIMARY KEY (experiment_id, dataset_id),
    FOREIGN KEY (experiment_id) REFERENCES experiments(id),
    FOREIGN KEY (dataset_id) REFERENCES datasets(id)
);

CREATE TABLE IF NOT EXISTS dataset_research_programs (
    dataset_id TEXT NOT NULL,
    program_id TEXT NOT NULL,
    PRIMARY KEY (dataset_id, program_id),
    FOREIGN KEY (dataset_id) REFERENCES datasets(id),
    FOREIGN KEY (program_id) REFERENCES research_programs(id)
);

CREATE TABLE IF NOT EXISTS publication_authors (
    publication_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    PRIMARY KEY (publication_id, profile_id),
    FOREIGN KEY (publication_id) REFERENCES publications(id),
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
);

-- ============ SNAPSHOT / PROJECTION LOG ============

CREATE TABLE IF NOT EXISTS editorial_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    generated_at TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    content_revision INTEGER NOT NULL,
    created_by TEXT,
    note TEXT
);

CREATE TABLE IF NOT EXISTS public_build_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    editorial_snapshot_id TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    content_revision INTEGER NOT NULL,
    locale_availability TEXT,  -- JSON
    FOREIGN KEY (editorial_snapshot_id) REFERENCES editorial_snapshots(snapshot_id)
);
