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
    // Additive: multi-image support (BlogDrafts.tsx uploads via the existing
    // /api/upload endpoint, then attaches the returned URLs here). Nullable
    // TEXT storing a JSON array of URL strings — same pattern as
    // simulation_runs.related_signal_ids (see simulation.rs): NULL for "no
    // images" rather than "[]", kept unambiguous by encode_images below
    // normalizing an empty list back to NULL on the way in. Existing rows
    // keep images = NULL.
    sqlx::query("ALTER TABLE blog_posts ADD COLUMN images TEXT")
        .execute(db)
        .await
        .ok();
}

/// `None` for "no images" (not every post has one), `Some(urls)` for a
/// non-empty explicit list. An empty list is normalized to `None` on the way
/// in so the column stays either NULL or a real, non-empty array — never
/// `"[]"` — same convention as simulation.rs's encode_related_signal_ids.
fn encode_images(images: &Option<Vec<String>>) -> Option<String> {
    images.as_ref().filter(|v| !v.is_empty()).map(|v| serde_json::to_string(v).unwrap_or_default())
}

/// Defensive on the way out too: a hand-edited or otherwise malformed value
/// in the column must degrade to "no images" rather than panic list/get.
fn decode_images(raw: &Option<String>) -> Option<Vec<String>> {
    raw.as_deref().and_then(|s| serde_json::from_str::<Vec<String>>(s).ok()).filter(|v| !v.is_empty())
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
    images: Option<Vec<String>>,
}

type PostRow = (String, String, String, String, String, String, String, Option<String>, Option<String>, Option<String>);
fn to_out(r: PostRow) -> BlogPostOut {
    let images = decode_images(&r.9);
    BlogPostOut {
        id: r.0, title: r.1, body: r.2, status: r.3, source: r.4,
        created_at: r.5, updated_at: r.6, published_at: r.7, source_conversation_id: r.8,
        images,
    }
}

/// Shared by the human-facing `create_post` handler and the agent's
/// `draft_blog_post` tool — the agent always writes `source='agent'`,
/// `status='draft'` regardless of what it's asked, since publishing stays a
/// human action (see agent.rs). `source_conversation_id` is set when a draft
/// grows out of a live Forschung talk (see plan §5b), `None` for a post
/// created straight from the Blog tab. `images` is `None` for every
/// agent-drafted post today (Jarvis has no upload tool) — human creation via
/// `create_post` is the only caller that ever passes a non-empty list.
pub async fn insert_post(state: &AppState, title: &str, body: &str, source: &str, source_conversation_id: Option<&str>, images: Option<Vec<String>>) -> String {
    let id = Uuid::new_v4().to_string();
    let images = encode_images(&images);
    let _ = sqlx::query(
        "INSERT INTO blog_posts (id, title, body, status, source, source_conversation_id, images) VALUES (?1,?2,?3,'draft',?4,?5,?6)",
    )
    .bind(&id)
    .bind(title)
    .bind(body)
    .bind(source)
    .bind(source_conversation_id)
    .bind(&images)
    .execute(&state.db)
    .await;
    id
}

/// Read-only lookup for Jarvis's `get_blog_post` tool — direct DB access
/// rather than going through get_post's HTTP/auth layer, since this is
/// server-internal (invoked from agent::execute_tool, not its own route).
pub async fn fetch_post_json(state: &AppState, id: &str) -> Option<serde_json::Value> {
    let row: Option<PostRow> = sqlx::query_as(
        "SELECT id, title, body, status, source, created_at, updated_at, published_at, source_conversation_id, images FROM blog_posts WHERE id = ?1",
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
        "SELECT id, title, body, status, source, created_at, updated_at, published_at, source_conversation_id, images FROM blog_posts ORDER BY updated_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    Json(rows.into_iter().map(to_out).collect::<Vec<_>>()).into_response()
}

#[derive(Deserialize)]
pub struct CreatePostReq { title: String, body: String, images: Option<Vec<String>> }

pub async fn create_post(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<CreatePostReq>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let id = insert_post(&state, &req.title, &req.body, "human", None, req.images).await;
    Json(serde_json::json!({ "id": id })).into_response()
}

pub async fn get_post(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let row: Option<PostRow> = sqlx::query_as(
        "SELECT id, title, body, status, source, created_at, updated_at, published_at, source_conversation_id, images FROM blog_posts WHERE id = ?1",
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
pub struct UpdatePostReq { title: Option<String>, body: Option<String>, status: Option<String>, images: Option<Vec<String>> }

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
    // Explicit `Some(...)` — including an empty list, which encode_images
    // normalizes to NULL — is what lets BlogDrafts.tsx's edit form clear
    // every attached image by removing them all and saving; omitting the
    // field entirely (not sent by this codebase's only caller today, but a
    // real API consumer could) leaves existing images untouched.
    if let Some(imgs) = req.images {
        let encoded = encode_images(&Some(imgs));
        let _ = sqlx::query("UPDATE blog_posts SET images = ?1, updated_at = datetime('now') WHERE id = ?2").bind(&encoded).bind(&id).execute(&state.db).await;
    }
    StatusCode::NO_CONTENT.into_response()
}

pub async fn delete_post(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let _ = sqlx::query("DELETE FROM blog_posts WHERE id = ?1").bind(&id).execute(&state.db).await;
    crate::auditlog::record(&state, "admin", "blog_post_deleted", "Blogbeitrag gelöscht", Some(serde_json::json!({"id": id}))).await;
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
    crate::auditlog::record(&state, "admin", "blog_published", "Blogbeitrag veröffentlicht", Some(serde_json::json!({"id": id}))).await;
    StatusCode::NO_CONTENT.into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::State as AxState;
    use std::{collections::HashMap, path::PathBuf, sync::{Arc, RwLock}};

    /// Same in-memory-sqlite fixture pattern as simulation.rs/chat.rs's own
    /// `test_state` helpers — a fresh, schema-initialized DB per test, no
    /// network needed, auth a no-op via empty `chat_secret`.
    async fn test_state() -> AppState {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        init_schema(&db).await;
        AppState {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            content_path: PathBuf::from("content.json"),
            uploads_dir: PathBuf::from("uploads"),
            static_dir: PathBuf::from("dist"),
            allowed_email: String::new(),
            google_client_id: String::new(),
            google_client_secret: String::new(),
            redirect_uri: String::new(),
            dev_mode: true,
            db,
            http: reqwest::Client::new(),
            nvidia_api_key: String::new(),
            nvidia_api_base: "https://integrate.api.nvidia.com".to_string(),
            nvidia_connect_timeout: crate::chat::NVIDIA_CONNECT_TIMEOUT,
            chat_secret: String::new(),
            stripe_secret_key: String::new(),
            stripe_api_base: "https://api.stripe.com".to_string(),
            stripe_webhook_secret: String::new(),
            ddg_api_base: "https://api.duckduckgo.com".to_string(),
            hermes_url: String::new(),
            hermes_api_key: String::new(),
            github_token: String::new(),
            github_api_base: "https://api.github.com".to_string(),
            audit_lock: std::sync::Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    async fn create(state: &AppState, title: &str, images: Option<Vec<String>>) -> String {
        let res = create_post(
            AxState(state.clone()),
            HeaderMap::new(),
            Json(CreatePostReq { title: title.to_string(), body: "body".to_string(), images }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        body["id"].as_str().unwrap().to_string()
    }

    async fn get(state: &AppState, id: &str) -> serde_json::Value {
        let res = get_post(AxState(state.clone()), HeaderMap::new(), Path(id.to_string())).await.into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn images_round_trip_through_create_and_list() {
        let state = test_state().await;
        let id = create(&state, "mit Bildern", Some(vec!["/uploads/a.png".to_string(), "/uploads/b.jpg".to_string()])).await;

        let res = list_posts(AxState(state.clone()), HeaderMap::new()).await.into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let posts: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        let post = posts.iter().find(|p| p["id"] == id).expect("created post present in list");
        assert_eq!(post["images"], json_array(&["/uploads/a.png", "/uploads/b.jpg"]));
    }

    #[tokio::test]
    async fn images_round_trip_through_get_post() {
        let state = test_state().await;
        let id = create(&state, "einzelnes Bild", Some(vec!["/uploads/only.png".to_string()])).await;

        let post = get(&state, &id).await;
        assert_eq!(post["images"], json_array(&["/uploads/only.png"]));
    }

    #[tokio::test]
    async fn images_omitted_stays_null_not_every_post_needs_one() {
        let state = test_state().await;
        let id = create(&state, "ohne Bild", None).await;

        let post = get(&state, &id).await;
        assert_eq!(post["images"], serde_json::Value::Null);
    }

    #[tokio::test]
    async fn images_empty_vec_normalizes_to_null() {
        let state = test_state().await;
        let id = create(&state, "leere Liste übermittelt", Some(vec![])).await;

        let post = get(&state, &id).await;
        assert_eq!(post["images"], serde_json::Value::Null);
    }

    /// Guards the defensive decode path: a malformed/legacy value in the
    /// column must degrade to "no images" rather than panic list_posts/get_post.
    #[tokio::test]
    async fn malformed_images_column_degrades_to_null_instead_of_panicking() {
        let state = test_state().await;
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO blog_posts (id, title, body, status, source, images) VALUES (?1,'x','y','draft','human','not-json')")
            .bind(&id)
            .execute(&state.db)
            .await
            .unwrap();

        let post = get(&state, &id).await;
        assert_eq!(post["images"], serde_json::Value::Null);
    }

    /// The actual feature this test suite exists to prove: BlogDrafts.tsx's
    /// edit form (PUT /api/blog/posts/:id) can attach images to a post that
    /// was created without any, via update_post.
    #[tokio::test]
    async fn update_post_adds_images_to_a_post_created_without_any() {
        let state = test_state().await;
        let id = create(&state, "erst ohne, dann mit Bild", None).await;

        let res = update_post(
            AxState(state.clone()),
            HeaderMap::new(),
            Path(id.clone()),
            Json(UpdatePostReq { title: None, body: None, status: None, images: Some(vec!["/uploads/added.png".to_string()]) }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::NO_CONTENT);

        let post = get(&state, &id).await;
        assert_eq!(post["images"], json_array(&["/uploads/added.png"]));
    }

    /// Symmetric case: removing every attached image (an explicit empty
    /// list, not an omitted field) and saving must clear the column back to
    /// null — this is what "remove one before saving" down to zero looks
    /// like from BlogDrafts.tsx.
    #[tokio::test]
    async fn update_post_with_empty_images_list_clears_existing_images() {
        let state = test_state().await;
        let id = create(&state, "Bild wird entfernt", Some(vec!["/uploads/gone.png".to_string()])).await;

        let res = update_post(
            AxState(state.clone()),
            HeaderMap::new(),
            Path(id.clone()),
            Json(UpdatePostReq { title: None, body: None, status: None, images: Some(vec![]) }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::NO_CONTENT);

        let post = get(&state, &id).await;
        assert_eq!(post["images"], serde_json::Value::Null);
    }

    fn json_array(items: &[&str]) -> serde_json::Value {
        serde_json::Value::Array(items.iter().map(|s| serde_json::Value::String(s.to_string())).collect())
    }
}
