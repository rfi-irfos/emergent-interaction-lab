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

/// Real backend-persisted contact inbox. Previously the admin Inbox was
/// pure `localStorage` — written in the VISITOR's browser on form submit
/// (PublicSite.tsx's ContactForm) and read in the ADMIN's browser
/// (AdminPanel.tsx). `localStorage` never syncs across devices/browsers, so
/// a real visitor's submission on their own machine could never appear in
/// the admin's Inbox on a different machine: the unread badge and
/// Antworten/Erledigt buttons operated on a dataset that in production was
/// essentially always empty.
///
/// `status` supports 'new'/'replied'/'done' (not just a boolean) so the
/// existing Antworten/Erledigt UX has somewhere real to persist to, and so
/// "Erledigt" can mean `status = 'done'` instead of the old hard, permanent,
/// no-undo delete (see observatory/Inbox.tsx's "Wieder öffnen").
pub async fn init_schema(db: &SqlitePool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS contact_messages (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL DEFAULT '',
            message TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','replied','done')),
            created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create contact_messages");
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_cm_created ON contact_messages(created_at)")
        .execute(db)
        .await
        .ok();
}

#[derive(Deserialize)]
pub struct ContactRequest {
    pub name: String,
    pub email: String,
    pub phone: Option<String>,
    pub message: String,
}

#[derive(Serialize, Deserialize)]
pub struct ContactMessageOut {
    id: String,
    name: String,
    email: String,
    phone: String,
    message: String,
    status: String,
    created_at: String,
}

type ContactRow = (String, String, String, String, String, String, String);
fn to_out(r: ContactRow) -> ContactMessageOut {
    ContactMessageOut {
        id: r.0,
        name: r.1,
        email: r.2,
        phone: r.3,
        message: r.4,
        status: r.5,
        created_at: r.6,
    }
}

/// Public — no auth, this is the visitor-facing submission
/// (PublicSite.tsx's ContactForm posts here). The frontend separately keeps
/// firing a best-effort web3forms request for an email notification, same
/// as before this fix; this endpoint is the durable, cross-device record the
/// admin Inbox (GET /api/contact/messages) now actually reads from.
pub async fn submit_contact(
    State(state): State<AppState>,
    Json(body): Json<ContactRequest>,
) -> impl IntoResponse {
    if body.name.trim().is_empty() || body.email.trim().is_empty() || body.message.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "Pflichtfelder fehlen.").into_response();
    }
    if body.name.len() > 200 || body.email.len() > 200 || body.message.len() > 4000 {
        return (StatusCode::BAD_REQUEST, "Eingabe zu lang.").into_response();
    }

    let id = Uuid::new_v4().to_string();
    let name = body.name.trim().to_string();
    let email = body.email.trim().to_string();
    let phone = body.phone.unwrap_or_default().trim().to_string();
    let message = body.message.trim().to_string();

    if let Err(e) = sqlx::query(
        "INSERT INTO contact_messages (id, name, email, phone, message) VALUES (?1,?2,?3,?4,?5)",
    )
    .bind(&id)
    .bind(&name)
    .bind(&email)
    .bind(&phone)
    .bind(&message)
    .execute(&state.db)
    .await
    {
        tracing::error!("Contact insert failed: {e}");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }

    tracing::info!("Contact from {name} ({email})");
    Json(serde_json::json!({ "id": id })).into_response()
}

/// Admin — list all messages, newest first. A contact inbox is small by
/// nature, not a firehose, so no pagination yet.
pub async fn list_messages(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let rows: Vec<ContactRow> = sqlx::query_as(
        "SELECT id, name, email, phone, message, status, created_at FROM contact_messages ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    Json(rows.into_iter().map(to_out).collect::<Vec<_>>()).into_response()
}

#[derive(Deserialize)]
pub struct UpdateStatusReq {
    status: String,
}

/// Admin — Antworten/Erledigt (and the Inbox's "Wieder öffnen" undo) now
/// persist server-side instead of just local UI state.
pub async fn update_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<UpdateStatusReq>,
) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if !["new", "replied", "done"].contains(&req.status.as_str()) {
        return (StatusCode::BAD_REQUEST, "Ungültiger Status.").into_response();
    }
    let result = sqlx::query("UPDATE contact_messages SET status = ?1 WHERE id = ?2")
        .bind(&req.status)
        .bind(&id)
        .execute(&state.db)
        .await;
    match result {
        Ok(r) if r.rows_affected() > 0 => StatusCode::NO_CONTENT.into_response(),
        Ok(_) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("Contact status update failed: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::State as AxState;
    use std::{
        collections::HashMap,
        path::PathBuf,
        sync::{
            atomic::{AtomicU64, AtomicUsize},
            Arc, RwLock,
        },
    };

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
            // Empty secret == "no auth configured" (require_admin's own
            // dev-convenience rule) so these tests can call handlers
            // directly without constructing a real x-chat-secret header.
            chat_secret: String::new(),
            stripe_secret_key: String::new(),
            stripe_api_base: "https://api.stripe.com".to_string(),
            stripe_webhook_secret: String::new(),
            ddg_api_base: "https://api.duckduckgo.com".to_string(),
            hermes_url: String::new(),
            hermes_api_key: String::new(),
            hermes_boot_grace: crate::hermes::HERMES_BOOT_GRACE,
            mcp_token: String::new(),
            github_token: String::new(),
            github_api_base: "https://api.github.com".to_string(),
            audit_lock: std::sync::Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    fn body_json_sync(bytes: &[u8]) -> serde_json::Value {
        serde_json::from_slice(bytes).unwrap()
    }

    /// Full round trip proving the actual bug fix: a message submitted
    /// through the public, unauthenticated endpoint (as a real visitor's
    /// browser would) is retrievable through the admin-authenticated list
    /// endpoint (as the admin's, separate, browser would) — the whole point
    /// being that this no longer depends on both browsers sharing
    /// localStorage. Then proves status updates (Antworten -> replied,
    /// Erledigt -> done, and the undo back to new) persist server-side.
    #[tokio::test]
    async fn submitted_message_is_visible_to_admin_and_status_updates_persist() {
        let state = test_state().await;

        let submit_res = submit_contact(
            AxState(state.clone()),
            Json(ContactRequest {
                name: "Laura Serna Gaviria".to_string(),
                email: "laura@example.com".to_string(),
                phone: Some("+43 000".to_string()),
                message: "Interessiert an einer Kooperation.".to_string(),
            }),
        )
        .await
        .into_response();
        assert_eq!(submit_res.status(), StatusCode::OK);
        let submit_bytes = axum::body::to_bytes(submit_res.into_body(), usize::MAX).await.unwrap();
        let submit_body = body_json_sync(&submit_bytes);
        let id = submit_body["id"].as_str().unwrap().to_string();

        // Admin endpoint without a secret configured still requires calling
        // through require_admin (empty secret == open), proving the route
        // is reachable the same way the real admin UI reaches it.
        let list_res = list_messages(AxState(state.clone()), HeaderMap::new()).await.into_response();
        assert_eq!(list_res.status(), StatusCode::OK);
        let list_bytes = axum::body::to_bytes(list_res.into_body(), usize::MAX).await.unwrap();
        let list_body: Vec<ContactMessageOut> = serde_json::from_slice(&list_bytes).unwrap();
        assert_eq!(list_body.len(), 1);
        assert_eq!(list_body[0].id, id);
        assert_eq!(list_body[0].name, "Laura Serna Gaviria");
        assert_eq!(list_body[0].status, "new");

        // Antworten -> replied
        let update_res = update_status(
            AxState(state.clone()),
            HeaderMap::new(),
            Path(id.clone()),
            Json(UpdateStatusReq { status: "replied".to_string() }),
        )
        .await
        .into_response();
        assert_eq!(update_res.status(), StatusCode::NO_CONTENT);

        let list_res2 = list_messages(AxState(state.clone()), HeaderMap::new()).await.into_response();
        let list_bytes2 = axum::body::to_bytes(list_res2.into_body(), usize::MAX).await.unwrap();
        let list_body2: Vec<ContactMessageOut> = serde_json::from_slice(&list_bytes2).unwrap();
        assert_eq!(list_body2[0].status, "replied");

        // Erledigt -> done (status-based, not a delete: still listed)
        let update_res2 = update_status(
            AxState(state.clone()),
            HeaderMap::new(),
            Path(id.clone()),
            Json(UpdateStatusReq { status: "done".to_string() }),
        )
        .await
        .into_response();
        assert_eq!(update_res2.status(), StatusCode::NO_CONTENT);

        let list_res3 = list_messages(AxState(state.clone()), HeaderMap::new()).await.into_response();
        let list_bytes3 = axum::body::to_bytes(list_res3.into_body(), usize::MAX).await.unwrap();
        let list_body3: Vec<ContactMessageOut> = serde_json::from_slice(&list_bytes3).unwrap();
        assert_eq!(list_body3.len(), 1, "Erledigt must not delete the row");
        assert_eq!(list_body3[0].status, "done");

        // "Wieder öffnen" undo -> back to new
        let undo_res = update_status(
            AxState(state.clone()),
            HeaderMap::new(),
            Path(id.clone()),
            Json(UpdateStatusReq { status: "new".to_string() }),
        )
        .await
        .into_response();
        assert_eq!(undo_res.status(), StatusCode::NO_CONTENT);
        let list_res4 = list_messages(AxState(state.clone()), HeaderMap::new()).await.into_response();
        let list_bytes4 = axum::body::to_bytes(list_res4.into_body(), usize::MAX).await.unwrap();
        let list_body4: Vec<ContactMessageOut> = serde_json::from_slice(&list_bytes4).unwrap();
        assert_eq!(list_body4[0].status, "new");
    }

    #[tokio::test]
    async fn missing_required_fields_is_rejected() {
        let state = test_state().await;
        let res = submit_contact(
            AxState(state.clone()),
            Json(ContactRequest {
                name: "".to_string(),
                email: "a@b.com".to_string(),
                phone: None,
                message: "hi".to_string(),
            }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);

        let list_res = list_messages(AxState(state.clone()), HeaderMap::new()).await.into_response();
        let list_bytes = axum::body::to_bytes(list_res.into_body(), usize::MAX).await.unwrap();
        let list_body: Vec<ContactMessageOut> = serde_json::from_slice(&list_bytes).unwrap();
        assert!(list_body.is_empty(), "invalid submission must not be persisted");
    }

    #[tokio::test]
    async fn invalid_status_value_is_rejected() {
        let state = test_state().await;
        let submit_res = submit_contact(
            AxState(state.clone()),
            Json(ContactRequest {
                name: "X".to_string(),
                email: "x@example.com".to_string(),
                phone: None,
                message: "hi".to_string(),
            }),
        )
        .await
        .into_response();
        let submit_bytes = axum::body::to_bytes(submit_res.into_body(), usize::MAX).await.unwrap();
        let id = body_json_sync(&submit_bytes)["id"].as_str().unwrap().to_string();

        let res = update_status(
            AxState(state.clone()),
            HeaderMap::new(),
            Path(id),
            Json(UpdateStatusReq { status: "archived".to_string() }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }
}
