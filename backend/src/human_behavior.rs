//! Browser→server behavioral capture — Wave 2 / Task 9 of the Deep
//! Self-Analysis plan (framework v2.1, Dimension 1 "Attention" + Dimension 3
//! "Cognitive Load"). This is the FIRST client-capture path in the backend:
//! the frontend batches raw interaction events (keystrokes, idle transitions,
//! scrolling, tab visibility) and POSTs them here, where they land in the
//! `human_behavior` table for the analytics layer (analytics_behavior.rs) to
//! read. Nothing here interprets the events — capture and analysis are
//! deliberately separate layers, same doctrine as agent_tool_calls vs the
//! observatory aggregates.
//!
//! Privacy posture: this is self-instrumentation (Laura observing Laura),
//! admin-gated like every other observatory surface — no anonymous visitor
//! is ever captured, because the ingest endpoint rejects anything without
//! the admin secret/session.

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use axum_extra::extract::cookie::CookieJar;
use sqlx::SqlitePool;

use crate::{authz::require_admin, AppState};

/// The closed event vocabulary. Anything else in a batch is silently skipped
/// (best-effort ingest, never a 4xx for one bad element in an otherwise good
/// batch — a lost keystroke event must never surface as a user-visible error).
pub const EVENT_TYPES: [&str; 7] = [
    "keydown",
    "keyup",
    "backspace",
    "idle_start",
    "idle_end",
    "scroll",
    "visibility",
];

/// Upper bound on how many events a single batch may insert — the client
/// flushes every few seconds, so a legitimate batch is dozens of rows, not
/// thousands; the cap bounds a runaway/hostile payload on the single-machine
/// SQLite file (same reasoning as main.rs's web_visits retention sweep).
const MAX_BATCH: usize = 500;

pub async fn init_schema(db: &SqlitePool) {
    // `client_ts_ms` is the browser-side epoch-milliseconds timestamp of the
    // event (`Date.now()` at capture time) — kept separate from `created_at`
    // (server arrival time) because inter-key intervals need millisecond
    // resolution and batching skews arrival times; datetime('now') only has
    // second resolution. The analytics layer prefers client_ts_ms and falls
    // back to created_at when absent.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS human_behavior (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT NOT NULL,
            message_id TEXT,
            event_type TEXT NOT NULL,
            payload TEXT,
            client_ts_ms INTEGER,
            created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create human_behavior");
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_hb_conv ON human_behavior(conversation_id, created_at)",
    )
    .execute(db)
    .await
    .ok();
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_hb_conv_type ON human_behavior(conversation_id, event_type)",
    )
    .execute(db)
    .await
    .ok();
}

/// Batch ingest: `POST /api/human-behavior/:conversation_id` with a JSON
/// array of `{event_type, payload?, ts?, message_id?}` objects.
///
///  * `event_type` — required, one of [`EVENT_TYPES`]; unknown types are
///    skipped, not rejected.
///  * `payload` — optional; stored verbatim when it's a string, otherwise
///    serialized JSON (scroll deltas, key metadata, visibility state…).
///    Deliberately NEVER the typed character itself — the client contract is
///    to send timing/metadata only, and nothing here re-derives content.
///  * `ts` — optional browser epoch-milliseconds (`Date.now()`).
///  * `message_id` — optional link to the chat message being composed.
///
/// Inserts are best-effort (`let _ =`) per the repo's instrumentation
/// convention: a missing table on an older DB or one malformed row never
/// blocks the rest of the batch. Returns 204 regardless of how many rows
/// actually landed — the client fire-and-forgets these.
pub async fn ingest(
    State(state): State<AppState>,
    headers: HeaderMap,
    jar: CookieJar,
    Path(conversation_id): Path<String>,
    Json(events): Json<Vec<serde_json::Value>>,
) -> impl IntoResponse {
    if !require_admin(&state, &headers, &jar) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    for ev in events.iter().take(MAX_BATCH) {
        let Some(event_type) = ev.get("event_type").and_then(|v| v.as_str()) else {
            continue;
        };
        if !EVENT_TYPES.contains(&event_type) {
            continue;
        }
        let payload: Option<String> = ev.get("payload").and_then(|p| {
            if p.is_null() {
                None
            } else if let Some(s) = p.as_str() {
                Some(s.to_string())
            } else {
                Some(p.to_string())
            }
        });
        let message_id: Option<String> = ev
            .get("message_id")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let client_ts_ms: Option<i64> = ev
            .get("ts")
            .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)));

        let _ = sqlx::query(
            "INSERT INTO human_behavior (conversation_id, message_id, event_type, payload, client_ts_ms) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&conversation_id)
        .bind(&message_id)
        .bind(event_type)
        .bind(&payload)
        .bind(client_ts_ms)
        .execute(&state.db)
        .await;
    }

    StatusCode::NO_CONTENT.into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::{Path as AxPath, State as AxState};
    use axum::response::IntoResponse;
    use serde_json::json;
    use std::{
        collections::HashMap,
        path::PathBuf,
        sync::{Arc, RwLock},
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
            chat_secret: String::new(),
            stripe_secret_key: String::new(),
            stripe_api_base: "https://api.stripe.com".to_string(),
            stripe_webhook_secret: String::new(),
            ddg_api_base: "https://api.duckduckgo.com".to_string(),
            hermes_url: String::new(),
            hermes_api_key: String::new(),
            hermes_boot_grace: crate::hermes::HERMES_BOOT_GRACE,
            mcp_token: String::new(),
            audit_lock: std::sync::Arc::new(tokio::sync::Mutex::new(())),
            github_token: String::new(),
            github_api_base: "https://api.github.com".to_string(),
            eil_github_token: String::new(),
            eil_github_repo: String::new(),
            gmail_client_id: String::new(),
            gmail_client_secret: String::new(),
            gmail_refresh_token: String::new(),
        }
    }

    async fn count_events(db: &SqlitePool, conv: &str) -> i64 {
        let (n,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM human_behavior WHERE conversation_id = ?1")
                .bind(conv)
                .fetch_one(db)
                .await
                .unwrap();
        n
    }

    #[tokio::test]
    async fn ingest_inserts_batch_rows_with_all_fields() {
        let state = test_state().await;
        let batch = vec![
            json!({"event_type": "keydown", "ts": 1_753_400_000_000i64, "message_id": "m1", "payload": {"key_class": "letter"}}),
            json!({"event_type": "backspace", "ts": 1_753_400_000_250i64}),
            json!({"event_type": "scroll", "payload": "down:120"}),
        ];
        let res = ingest(
            AxState(state.clone()),
            HeaderMap::new(),
            CookieJar::new(),
            AxPath("c1".to_string()),
            Json(batch),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::NO_CONTENT);
        assert_eq!(count_events(&state.db, "c1").await, 3);

        let (etype, mid, ts): (String, Option<String>, Option<i64>) = sqlx::query_as(
            "SELECT event_type, message_id, client_ts_ms FROM human_behavior WHERE conversation_id='c1' ORDER BY id LIMIT 1",
        )
        .fetch_one(&state.db)
        .await
        .unwrap();
        assert_eq!(etype, "keydown");
        assert_eq!(mid.as_deref(), Some("m1"));
        assert_eq!(ts, Some(1_753_400_000_000));
    }

    #[tokio::test]
    async fn ingest_skips_unknown_event_types_and_malformed_elements() {
        let state = test_state().await;
        let batch = vec![
            json!({"event_type": "keydown", "ts": 1i64}),
            json!({"event_type": "mousemove_torrent"}), // not in the vocabulary
            json!({"no_event_type": true}),
            json!("not even an object"),
        ];
        let res = ingest(
            AxState(state.clone()),
            HeaderMap::new(),
            CookieJar::new(),
            AxPath("c1".to_string()),
            Json(batch),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::NO_CONTENT, "bad elements are skipped, never a 4xx");
        assert_eq!(count_events(&state.db, "c1").await, 1);
    }

    #[tokio::test]
    async fn ingest_empty_batch_is_fine() {
        let state = test_state().await;
        let res = ingest(
            AxState(state.clone()),
            HeaderMap::new(),
            CookieJar::new(),
            AxPath("c1".to_string()),
            Json(vec![]),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::NO_CONTENT);
        assert_eq!(count_events(&state.db, "c1").await, 0);
    }
}
