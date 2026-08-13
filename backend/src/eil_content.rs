use axum::{extract::State, http::StatusCode, response::IntoResponse, Json, Router, routing::get};
use serde_json::{json, Map, Value};
use sqlx::sqlite::SqlitePool;
use sqlx::{Row, Column};

use crate::AppState;

/// Load the EIL research content schema on startup.
pub async fn init_schema(pool: &SqlitePool) {
    let schema = include_str!("eil_schema.sql");
    sqlx::query(schema)
        .execute(pool)
        .await
        .expect("create eil content schema");
    tracing::info!("EIL research content schema ready");
}

/// Seed the EIL entities from the bundled public-projection snapshot.
///
/// `eil_seed.json` is the *public projection* (the fields `get_public_snapshot`
/// selects), so it is missing the deeper NOT NULL columns the schema requires
/// (reconstruction_en, limitations_en, provenance_en, created_at, ...). We fill
/// those with safe defaults here so the inserts pass, then upsert. This keeps a
/// fresh deploy (which starts from an empty SQLite on the volume) from showing
/// an empty site until someone runs the live seed script by hand.
///
/// NOTE: the seeded rows carry only the projection fields + defaults — the
/// richer editorial fields stay empty until a full content export replaces
/// them. This is the safety net, not the canonical editorial source.
pub async fn seed(pool: &SqlitePool) {
    let raw = include_str!("eil_seed.json");
    let snap: Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("EIL seed: failed to parse eil_seed.json: {e}");
            return;
        }
    };

    let now = chrono::Utc::now().to_rfc3339();

    // (json_key, table, required NOT NULL columns the projection lacks -> default)
    let tables: &[(&str, &str, &[(&str, &str)])] = &[
        ("research_programs", "research_programs", &[
            ("status", "Published"), ("lifecycle", "Active"),
            ("program_type", "Core"), ("created_at", "PLACEHOLDER"),
            ("updated_at", "PLACEHOLDER"),
        ]),
        ("publications", "publications", &[
            ("publication_type", "Article"), ("publication_status", "Published"),
            ("created_at", "PLACEHOLDER"), ("updated_at", "PLACEHOLDER"),
        ]),
        ("case_studies", "case_studies", &[
            ("available_signals_en", ""), ("reconstruction_en", ""),
            ("synthesis_or_system_model_en", ""), ("limitations_en", ""),
            ("status", "Published"), ("created_at", "PLACEHOLDER"),
            ("updated_at", "PLACEHOLDER"),
        ]),
        ("methods", "methods", &[
            ("status", "Published"), ("lifecycle", "Active"),
            ("created_at", "PLACEHOLDER"), ("updated_at", "PLACEHOLDER"),
        ]),
        ("frameworks", "frameworks", &[
            ("status", "Published"), ("lifecycle", "Active"),
            ("created_at", "PLACEHOLDER"), ("updated_at", "PLACEHOLDER"),
        ]),
        ("systems", "systems", &[
            ("lifecycle", "Active"), ("status", "Published"),
            ("created_at", "PLACEHOLDER"), ("updated_at", "PLACEHOLDER"),
        ]),
        ("datasets", "datasets", &[
            ("provenance_en", ""), ("status", "Published"),
            ("created_at", "PLACEHOLDER"), ("updated_at", "PLACEHOLDER"),
        ]),
        ("profiles", "profiles", &[
            ("role", "Researcher"), ("status", "Published"),
            ("created_at", "PLACEHOLDER"), ("updated_at", "PLACEHOLDER"),
        ]),
    ];

    let mut seeded = 0usize;
    for (json_key, table, fills) in tables {
        let rows = match snap.get(*json_key).and_then(|v| v.as_array()) {
            Some(r) => r,
            None => continue,
        };
        for row in rows {
            let mut obj = match row.as_object() {
                Some(o) => o.clone(),
                None => continue,
            };
            for (col, def) in *fills {
                let val = if *def == "PLACEHOLDER" {
                    now.clone()
                } else {
                    (*def).to_string()
                };
                obj.entry((*col).to_string())
                    .or_insert_with(|| Value::String(val));
            }
            let cols: Vec<String> = obj.keys().cloned().collect();
            let placeholders = vec!["?"; cols.len()].join(",");
            let sql = format!(
                "INSERT OR IGNORE INTO {} ({}) VALUES ({})",
                table,
                cols.join(","),
                placeholders
            );
            let mut q = sqlx::query(&sql);
            for c in &cols {
                let v = obj.get(c).and_then(|x| x.as_str()).unwrap_or_default();
                q = q.bind(v);
            }
            if q.execute(pool).await.is_ok() {
                seeded += 1;
            }
        }
    }
    tracing::info!("EIL seed complete: {seeded} entity rows upserted");
}

fn row_to_json(row: &sqlx::sqlite::SqliteRow) -> Value {
    let mut m = Map::new();
    for col in row.columns() {
        let name = col.name();
        let val: Value = match row.try_get::<Option<String>, _>(name) {
            Ok(Some(s)) => Value::String(s),
            Ok(None) => Value::Null,
            Err(_) => match row.try_get::<Option<i64>, _>(name) {
                Ok(Some(i)) => json!(i),
                Ok(None) => Value::Null,
                Err(_) => match row.try_get::<Option<bool>, _>(name) {
                    Ok(Some(b)) => json!(b),
                    Ok(None) => Value::Null,
                    Err(_) => Value::Null,
                },
            },
        };
        m.insert(name.to_string(), val);
    }
    Value::Object(m)
}

async fn fetch_rels(pool: &SqlitePool, table: &str, cols: &[&str]) -> Vec<Value> {
    let q = format!("SELECT {} FROM {}", cols.join(", "), table);
    match sqlx::query(&q).fetch_all(pool).await {
        Ok(rows) => rows.iter().map(row_to_json).collect(),
        Err(_) => Vec::new(),
    }
}

/// Public projection: only Published entities, private/restricted fields excluded.
pub async fn get_public_snapshot(pool: &SqlitePool) -> Result<Value, sqlx::Error> {
    let programs = sqlx::query(
        "SELECT id, slug, title_en, title_de, description_en, description_de,
                core_question_en, core_question_de, maturity, lifecycle, research_context
         FROM research_programs WHERE status='Published'"
    )
    .fetch_all(pool)
    .await?;

    let cases = sqlx::query(
        "SELECT id, slug, title_en, title_de, system_class, claim_or_question_en,
                claim_or_question_de, derived_output, epistemic_status, evidence_access
         FROM case_studies WHERE status='Published' AND evidence_access != 'Restricted'"
    )
    .fetch_all(pool)
    .await?;

    let pubs = sqlx::query(
        "SELECT id, slug, title_en, title_de, abstract_en, abstract_de,
                publication_type, doi, url, citation
         FROM publications WHERE publication_status='Published'"
    )
    .fetch_all(pool)
    .await?;

    let frameworks = sqlx::query(
        "SELECT id, slug, title_en, title_de, description_en, description_de,
                framework_type, status, maturity, lifecycle, version
         FROM frameworks WHERE status='Published'"
    )
    .fetch_all(pool)
    .await?;

    let systems = sqlx::query(
        "SELECT id, slug, title_en, title_de, description_en, description_de,
                system_class, status, version
         FROM systems WHERE status='Published'"
    )
    .fetch_all(pool)
    .await?;

    let methods = sqlx::query(
        "SELECT id, slug, title_en, title_de, description_en, description_de,
                status, version
         FROM methods WHERE status='Published'"
    )
    .fetch_all(pool)
    .await?;

    let datasets = sqlx::query(
        "SELECT id, slug, name_en, name_de, description_en, description_de,
                access, data_type, version
         FROM datasets WHERE status='Published'"
    )
    .fetch_all(pool)
    .await?;

    let profiles = sqlx::query(
        "SELECT id, slug, name_en, name_de, bio_en, bio_de, role, status
         FROM profiles WHERE status='Published'"
    )
    .fetch_all(pool)
    .await?;

    // Relations for linking detail pages
    let rel_program_frameworks = fetch_rels(pool, "research_program_frameworks", &["program_id", "framework_id"]).await;
    let rel_program_methods = fetch_rels(pool, "research_program_methods", &["program_id", "method_id"]).await;
    let rel_program_evidence = fetch_rels(pool, "research_program_evidence", &["program_id", "case_id"]).await;
    let rel_program_publications = fetch_rels(pool, "research_program_publications", &["program_id", "publication_id"]).await;
    let rel_program_systems = fetch_rels(pool, "research_program_systems", &["program_id", "system_id"]).await;
    let rel_framework_methods = fetch_rels(pool, "framework_methods", &["framework_id", "method_id"]).await;
    let rel_system_frameworks = fetch_rels(pool, "system_frameworks", &["system_id", "framework_id"]).await;
    let rel_system_evidence = fetch_rels(pool, "system_evidence", &["system_id", "case_id"]).await;
    let rel_case_ops = fetch_rels(pool, "case_study_analytical_operations", &["case_id", "op_id"]).await;
    let rel_publication_authors = fetch_rels(pool, "publication_authors", &["publication_id", "profile_id"]).await;

    Ok(json!({
        "schema_version": "1.0.0",
        "research_programs": programs.iter().map(row_to_json).collect::<Vec<_>>(),
        "case_studies": cases.iter().map(row_to_json).collect::<Vec<_>>(),
        "publications": pubs.iter().map(row_to_json).collect::<Vec<_>>(),
        "frameworks": frameworks.iter().map(row_to_json).collect::<Vec<_>>(),
        "systems": systems.iter().map(row_to_json).collect::<Vec<_>>(),
        "methods": methods.iter().map(row_to_json).collect::<Vec<_>>(),
        "datasets": datasets.iter().map(row_to_json).collect::<Vec<_>>(),
        "profiles": profiles.iter().map(row_to_json).collect::<Vec<_>>(),
        "relations": {
            "research_program_frameworks": rel_program_frameworks,
            "research_program_methods": rel_program_methods,
            "research_program_evidence": rel_program_evidence,
            "research_program_publications": rel_program_publications,
            "research_program_systems": rel_program_systems,
            "framework_methods": rel_framework_methods,
            "system_frameworks": rel_system_frameworks,
            "system_evidence": rel_system_evidence,
            "case_study_analytical_operations": rel_case_ops,
            "publication_authors": rel_publication_authors,
        }
    }))
}

/// HTTP handler: serve public build snapshot JSON (for static site build).
pub async fn public_snapshot(State(state): State<AppState>) -> impl IntoResponse {
    match get_public_snapshot(&state.db).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// Router for EIL content endpoints.
pub fn router() -> Router<AppState> {
    Router::new().route("/public-snapshot", get(public_snapshot))
}
