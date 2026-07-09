use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{authz::require_admin, AppState};

pub async fn init_schema(db: &SqlitePool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS blog_posts (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            source TEXT NOT NULL DEFAULT 'human',
            created_at DATETIME NOT NULL DEFAULT (datetime('now')),
            updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
            published_at DATETIME
        )",
    )
    .execute(db)
    .await
    .expect("create blog_posts");
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_bp_status ON blog_posts(status, updated_at)")
        .execute(db)
        .await
        .ok();
    // Additive: links a post to the Forschung conversation it grew out of, so
    // the co-authoring loop (see plan §5b) can jump back to the source talk.
    // Existing rows keep source_conversation_id = NULL.
    sqlx::query("ALTER TABLE blog_posts ADD COLUMN source_conversation_id TEXT")
        .execute(db)
        .await
        .ok();
}

#[derive(Serialize)]
pub struct BlogPostOut {
    id: String,
    title: String,
    body: String,
    status: String,
    source: String,
    created_at: String,
    updated_at: String,
    published_at: Option<String>,
    source_conversation_id: Option<String>,
}

type PostRow = (String, String, String, String, String, String, String, Option<String>, Option<String>);
fn to_out(r: PostRow) -> BlogPostOut {
    BlogPostOut {
        id: r.0, title: r.1, body: r.2, status: r.3, source: r.4,
        created_at: r.5, updated_at: r.6, published_at: r.7, source_conversation_id: r.8,
    }
}

/// Shared by the human-facing `create_post` handler and the agent's
/// `draft_blog_post` tool — the agent always writes `source='agent'`,
/// `status='draft'` regardless of what it's asked, since publishing stays a
/// human action (see agent.rs). `source_conversation_id` is set when a draft
/// grows out of a live Forschung talk (see plan §5b), `None` for a post
/// created straight from the Blog tab.
pub async fn insert_post(state: &AppState, title: &str, body: &str, source: &str, source_conversation_id: Option<&str>) -> String {
    let id = Uuid::new_v4().to_string();
    let _ = sqlx::query(
        "INSERT INTO blog_posts (id, title, body, status, source, source_conversation_id) VALUES (?1,?2,?3,'draft',?4,?5)",
    )
    .bind(&id)
    .bind(title)
    .bind(body)
    .bind(source)
    .bind(source_conversation_id)
    .execute(&state.db)
    .await;
    id
}

/// Read-only lookup for Jarvis's `get_blog_post` tool — direct DB access
/// rather than going through get_post's HTTP/auth layer, since this is
/// server-internal (invoked from agent::execute_tool, not its own route).
pub async fn fetch_post_json(state: &AppState, id: &str) -> Option<serde_json::Value> {
    let row: Option<PostRow> = sqlx::query_as(
        "SELECT id, title, body, status, source, created_at, updated_at, published_at, source_conversation_id FROM blog_posts WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);
    row.map(to_out).and_then(|o| serde_json::to_value(o).ok())
}

/// Rewrites a draft's title/body wholesale — Jarvis's `revise_blog_post` tool.
/// Refuses on anything that isn't `status='draft'`, so an in-chat revision
/// pass can never silently rewrite content that's already live.
pub async fn revise_draft(state: &AppState, id: &str, title: Option<&str>, body: Option<&str>) -> Result<(), String> {
    let status: Option<(String,)> = sqlx::query_as("SELECT status FROM blog_posts WHERE id = ?1")
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .unwrap_or(None);
    match status {
        None => Err("post not found".to_string()),
        Some((s,)) if s != "draft" => Err(format!("refusing to revise a post with status '{s}' — only drafts can be revised")),
        Some(_) => {
            if let Some(t) = title {
                let _ = sqlx::query("UPDATE blog_posts SET title = ?1, updated_at = datetime('now') WHERE id = ?2").bind(t).bind(id).execute(&state.db).await;
            }
            if let Some(b) = body {
                let _ = sqlx::query("UPDATE blog_posts SET body = ?1, updated_at = datetime('now') WHERE id = ?2").bind(b).bind(id).execute(&state.db).await;
            }
            Ok(())
        }
    }
}

pub async fn list_posts(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let rows: Vec<PostRow> = sqlx::query_as(
        "SELECT id, title, body, status, source, created_at, updated_at, published_at, source_conversation_id FROM blog_posts ORDER BY updated_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    Json(rows.into_iter().map(to_out).collect::<Vec<_>>()).into_response()
}

#[derive(Deserialize)]
pub struct CreatePostReq { title: String, body: String }

pub async fn create_post(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<CreatePostReq>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let id = insert_post(&state, &req.title, &req.body, "human", None).await;
    Json(serde_json::json!({ "id": id })).into_response()
}

pub async fn get_post(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let row: Option<PostRow> = sqlx::query_as(
        "SELECT id, title, body, status, source, created_at, updated_at, published_at, source_conversation_id FROM blog_posts WHERE id = ?1",
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
pub struct UpdatePostReq { title: Option<String>, body: Option<String>, status: Option<String> }

pub async fn update_post(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>, Json(req): Json<UpdatePostReq>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    if let Some(t) = &req.title {
        let _ = sqlx::query("UPDATE blog_posts SET title = ?1, updated_at = datetime('now') WHERE id = ?2").bind(t).bind(&id).execute(&state.db).await;
    }
    if let Some(b) = &req.body {
        let _ = sqlx::query("UPDATE blog_posts SET body = ?1, updated_at = datetime('now') WHERE id = ?2").bind(b).bind(&id).execute(&state.db).await;
    }
    if let Some(s) = &req.status {
        let _ = sqlx::query("UPDATE blog_posts SET status = ?1, updated_at = datetime('now') WHERE id = ?2").bind(s).bind(&id).execute(&state.db).await;
    }
    StatusCode::NO_CONTENT.into_response()
}

pub async fn delete_post(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let _ = sqlx::query("DELETE FROM blog_posts WHERE id = ?1").bind(&id).execute(&state.db).await;
    StatusCode::NO_CONTENT.into_response()
}

/// Flips status to published server-side. The actual public-site bridge (
/// promoting into content.json's news.items and pushing via GitHub) happens
/// client-side when a human clicks "Veröffentlichen" — the backend has no
/// GitHub credentials, see content.rs / frontend/src/lib/github.ts.
pub async fn publish_post(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let _ = sqlx::query("UPDATE blog_posts SET status = 'published', published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1")
        .bind(&id)
        .execute(&state.db)
        .await;
    StatusCode::NO_CONTENT.into_response()
}
