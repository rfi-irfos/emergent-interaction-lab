use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
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
    }))
}

/// HTTP handler: serve public build snapshot JSON (for static site build).
pub async fn public_snapshot(State(state): State<AppState>) -> impl IntoResponse {
    match get_public_snapshot(&state.db).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}
