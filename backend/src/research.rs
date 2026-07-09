use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{authz::require_admin, AppState};

/// Research Workspace (papers/hypotheses) and Innovation Lab (ideas/concepts/
/// frameworks/prototypes) share one table, filtered by `category` — the two
/// vision-doc modules are structurally identical (title/body/tags/status),
/// so this avoids building two parallel CRUD systems. See plan §5.
pub async fn init_schema(db: &SqlitePool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS research_notes (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL CHECK(category IN ('paper','hypothesis','idea','concept','framework','prototype')),
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active',
            source TEXT NOT NULL DEFAULT 'human',
            created_at DATETIME NOT NULL DEFAULT (datetime('now')),
            updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create research_notes");
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_rn_category ON research_notes(category, updated_at)")
        .execute(db)
        .await
        .ok();
    // Additive: links a note back to the Forschung conversation it grew out
    // of, mirroring blog_posts.source_conversation_id — the same "writing
    // about flying while flying" pattern, applied to research notes too.
    sqlx::query("ALTER TABLE research_notes ADD COLUMN source_conversation_id TEXT")
        .execute(db)
        .await
        .ok();
}

#[derive(Serialize)]
pub struct NoteOut {
    id: String,
    category: String,
    title: String,
    body: String,
    tags: String,
    status: String,
    source: String,
    created_at: String,
    updated_at: String,
    source_conversation_id: Option<String>,
}

type NoteRow = (String, String, String, String, String, String, String, String, String, Option<String>);
fn to_out(r: NoteRow) -> NoteOut {
    NoteOut {
        id: r.0, category: r.1, title: r.2, body: r.3, tags: r.4,
        status: r.5, source: r.6, created_at: r.7, updated_at: r.8, source_conversation_id: r.9,
    }
}

/// Shared by the human-facing `create_item` handler and the agent's
/// `log_research_note` tool. `source_conversation_id` is set when a note
/// grows out of a live Forschung talk, `None` for one created directly in
/// Research Pulse.
pub async fn insert_note(state: &AppState, category: &str, title: &str, body: &str, tags: &str, source: &str, source_conversation_id: Option<&str>) -> String {
    let id = Uuid::new_v4().to_string();
    let _ = sqlx::query(
        "INSERT INTO research_notes (id, category, title, body, tags, source, source_conversation_id) VALUES (?1,?2,?3,?4,?5,?6,?7)",
    )
    .bind(&id)
    .bind(category)
    .bind(title)
    .bind(body)
    .bind(tags)
    .bind(source)
    .bind(source_conversation_id)
    .execute(&state.db)
    .await;
    id
}

#[derive(Deserialize)]
pub struct ListQuery { category: Option<String> }

pub async fn list_items(State(state): State<AppState>, headers: HeaderMap, Query(q): Query<ListQuery>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let rows: Vec<NoteRow> = match &q.category {
        Some(cats) => {
            let wanted: Vec<&str> = cats.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
            let all: Vec<NoteRow> = sqlx::query_as(
                "SELECT id, category, title, body, tags, status, source, created_at, updated_at, source_conversation_id FROM research_notes ORDER BY updated_at DESC",
            )
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();
            all.into_iter().filter(|r| wanted.contains(&r.1.as_str())).collect()
        }
        None => sqlx::query_as(
            "SELECT id, category, title, body, tags, status, source, created_at, updated_at, source_conversation_id FROM research_notes ORDER BY updated_at DESC",
        )
        .fetch_all(&state.db)
        .await
        .unwrap_or_default(),
    };
    Json(rows.into_iter().map(to_out).collect::<Vec<_>>()).into_response()
}

#[derive(Deserialize)]
pub struct CreateItemReq { category: String, title: String, body: String, tags: Option<String> }

pub async fn create_item(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<CreateItemReq>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let id = insert_note(&state, &req.category, &req.title, &req.body, req.tags.as_deref().unwrap_or(""), "human", None).await;
    Json(serde_json::json!({ "id": id })).into_response()
}

pub async fn get_item(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let row: Option<NoteRow> = sqlx::query_as(
        "SELECT id, category, title, body, tags, status, source, created_at, updated_at, source_conversation_id FROM research_notes WHERE id = ?1",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);
    match row {
        Some(r) => Json(to_out(r)).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

#[derive(Deserialize)]
pub struct UpdateItemReq { title: Option<String>, body: Option<String>, tags: Option<String>, status: Option<String> }

pub async fn update_item(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>, Json(req): Json<UpdateItemReq>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    if let Some(t) = &req.title {
        let _ = sqlx::query("UPDATE research_notes SET title = ?1, updated_at = datetime('now') WHERE id = ?2").bind(t).bind(&id).execute(&state.db).await;
    }
    if let Some(b) = &req.body {
        let _ = sqlx::query("UPDATE research_notes SET body = ?1, updated_at = datetime('now') WHERE id = ?2").bind(b).bind(&id).execute(&state.db).await;
    }
    if let Some(tg) = &req.tags {
        let _ = sqlx::query("UPDATE research_notes SET tags = ?1, updated_at = datetime('now') WHERE id = ?2").bind(tg).bind(&id).execute(&state.db).await;
    }
    if let Some(s) = &req.status {
        let _ = sqlx::query("UPDATE research_notes SET status = ?1, updated_at = datetime('now') WHERE id = ?2").bind(s).bind(&id).execute(&state.db).await;
    }
    StatusCode::NO_CONTENT.into_response()
}

pub async fn delete_item(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let _ = sqlx::query("DELETE FROM research_notes WHERE id = ?1").bind(&id).execute(&state.db).await;
    StatusCode::NO_CONTENT.into_response()
}
