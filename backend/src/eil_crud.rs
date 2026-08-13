use axum::{
    extract::{Json, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post, put},
    Router,
};
use serde_json::{json, Value};
use sqlx::sqlite::SqlitePool;
use sqlx::{Column, Row};
use crate::AppState;

fn row_to_json(row: &sqlx::sqlite::SqliteRow) -> Value {
    let mut m = serde_json::Map::new();
    for col in row.columns() {
        let name = col.name();
        let val: Value = match row.try_get::<Option<String>, _>(name) {
            Ok(Some(s)) => serde_json::Value::String(s),
            Ok(None) => serde_json::Value::Null,
            Err(_) => match row.try_get::<Option<i64>, _>(name) {
                Ok(Some(i)) => json!(i),
                Ok(None) => serde_json::Value::Null,
                Err(_) => match row.try_get::<Option<bool>, _>(name) {
                    Ok(Some(b)) => json!(b),
                    Ok(None) => serde_json::Value::Null,
                    Err(_) => serde_json::Value::Null,
                },
            },
        };
        m.insert(name.to_string(), val);
    }
    Value::Object(m)
}

async fn list_entities(pool: &SqlitePool, table: &str) -> Result<Value, sqlx::Error> {
    let rows = sqlx::query(&format!("SELECT * FROM {}", table)).fetch_all(pool).await?;
    Ok(json!(rows.iter().map(row_to_json).collect::<Vec<_>>()))
}

async fn get_entity(pool: &SqlitePool, table: &str, id: &str) -> Result<Value, sqlx::Error> {
    let row = sqlx::query(&format!("SELECT * FROM {} WHERE id=?", table))
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| row_to_json(&r)).unwrap_or(Value::Null))
}

async fn create_entity(pool: &SqlitePool, table: &str, mut data: Value) -> Result<Value, sqlx::Error> {
    data["id"] = json!(format!("{}_{}", table, uuid::Uuid::new_v4().simple()));
    let cols: Vec<String> = data.as_object().unwrap().keys().cloned().collect();
    let placeholders = vec!["?"; cols.len()].join(",");
    let sql = format!("INSERT INTO {} ({}) VALUES ({})", table, cols.join(","), placeholders);
    let mut q = sqlx::query(&sql);
    for c in &cols {
        q = q.bind(data.get(c).unwrap_or(&Value::Null).as_str().unwrap_or_default());
    }
    q.execute(pool).await?;
    Ok(json!({"id": data["id"]}))
}

async fn update_entity(pool: &SqlitePool, table: &str, id: &str, data: Value) -> Result<Value, sqlx::Error> {
    let mut q = sqlx::QueryBuilder::new(&format!("UPDATE {} SET ", table));
    let mut first = true;
    for (k, v) in data.as_object().unwrap() {
        if k == "id" { continue; }
        if !first { q.push(", "); }
        q.push(format!("{}=", k));
        q.push_bind(v.as_str().unwrap_or_default());
        first = false;
    }
    q.push(" WHERE id=");
    q.push_bind(id);
    q.build().execute(pool).await?;
    get_entity(pool, table, id).await
}

async fn delete_entity(pool: &SqlitePool, table: &str, id: &str) -> Result<StatusCode, sqlx::Error> {
    sqlx::query(&format!("DELETE FROM {} WHERE id=?", table))
        .bind(id)
        .execute(pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    let tables = [
        "research_programs", "publications", "methods", "frameworks",
        "systems", "case_studies", "experiments", "datasets", "profiles",
        "sources", "taxonomy_analytical_operations", "taxonomy_system_domains",
        "taxonomy_architecture_domains", "taxonomy_derived_output_types",
        "taxonomy_evidence_statuses", "taxonomy_validation_types",
    ];
    let mut router = Router::new();
    for table in tables {
        let t = table.to_string();
        router = router
            .route(&format!("/{}/list", table), get({
                let t = table.to_string();
                move |State(state): State<AppState>| async move {
                    match list_entities(&state.db, &t).await {
                        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
                        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
                    }
                }
            }))
            .route(&format!("/{}/:id", table), get({
                let t = table.to_string();
                move |State(state): State<AppState>, Path(id): Path<String>| async move {
                    match get_entity(&state.db, &t, &id).await {
                        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
                        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
                    }
                }
            }))
            .route(&format!("/{}/create", table), post({
                let t = table.to_string();
                move |State(state): State<AppState>, Json(data): Json<Value>| async move {
                    match create_entity(&state.db, &t, data).await {
                        Ok(v) => (StatusCode::CREATED, Json(v)).into_response(),
                        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
                    }
                }
            }))
            .route(&format!("/{}/:id", table), put({
                let t = table.to_string();
                move |State(state): State<AppState>, Path(id): Path<String>, Json(data): Json<Value>| async move {
                    match update_entity(&state.db, &t, &id, data).await {
                        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
                        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
                    }
                }
            }))
            .route(&format!("/{}/:id/delete", table), delete({
                let t = table.to_string();
                move |State(state): State<AppState>, Path(id): Path<String>| async move {
                    match delete_entity(&state.db, &t, &id).await {
                        Ok(_) => StatusCode::NO_CONTENT.into_response(),
                        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
                    }
                }
            }));
    }
    router
}
