use axum::{
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{authz::require_admin, AppState};

/// Hash-chained, append-only changelog — ported (right-sized, not verbatim)
/// from RFI-IRFOS's own Lighthouse project's real, shipped `audit_log`
/// system. Every security/integrity-relevant write this platform makes
/// (content edits, blog publishes, admin login, deletions, Stripe order
/// inserts, the two safety watchdogs) gets one row here via `record` below,
/// linked to the row before it by a SHA-256 hash so a human — or the
/// `/api/observatory/audit/verify` endpoint — can tell whether history has
/// been quietly rewritten.
///
/// Deliberately NOT the full Lighthouse machinery: no leader-election, no
/// external anchor-file/ntfy dual-mirror for detecting a database restored
/// independently of the app's own disk, no multi-admin governance-quorum
/// auto-lockdown. That machinery exists in Lighthouse because it runs
/// multi-machine HA Postgres, where "the DB gets restored from a snapshot
/// without the app process knowing" is a real, distinct failure mode from
/// "someone edited a row." Here it's one Fly machine with one SQLite file
/// that IS the volume — that split doesn't exist, so porting the extra
/// machinery would be pure complexity with no matching risk. The scope that
/// DOES port over, exactly: the hash chain, the DB-level immutability
/// triggers, and a verify endpoint that walks the chain.
pub async fn init_schema(db: &SqlitePool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS audit_log (
            id TEXT PRIMARY KEY,
            actor TEXT NOT NULL,
            event_type TEXT NOT NULL,
            summary TEXT NOT NULL,
            meta TEXT,
            prev_hash TEXT NOT NULL,
            row_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )",
    )
    .execute(db)
    .await
    .expect("create audit_log");
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_al_created ON audit_log(created_at)")
        .execute(db)
        .await
        .ok();

    // DB-level immutability: even a direct `sqlite3 visits.db` session (not
    // just this app's own HTTP layer) can't quietly rewrite or remove a row.
    // `CREATE TRIGGER IF NOT EXISTS` makes both statements idempotent across
    // restarts, same convention as every `CREATE TABLE IF NOT EXISTS` /
    // `CREATE INDEX IF NOT EXISTS` call in this codebase.
    sqlx::query(
        "CREATE TRIGGER IF NOT EXISTS audit_log_no_update
         BEFORE UPDATE ON audit_log
         BEGIN
             SELECT RAISE(ABORT, 'audit_log is append-only');
         END",
    )
    .execute(db)
    .await
    .expect("create audit_log_no_update trigger");
    sqlx::query(
        "CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
         BEFORE DELETE ON audit_log
         BEGIN
             SELECT RAISE(ABORT, 'audit_log is append-only');
         END",
    )
    .execute(db)
    .await
    .expect("create audit_log_no_delete trigger");
}

/// `prev_hash` for the very first row in the chain — a fixed, well-known
/// value (not empty string, not NULL) so `verify` below has one unambiguous
/// starting point to recompute from regardless of how many rows exist.
const GENESIS_HASH: &str = "genesis";

/// `SHA256(prev_hash ∥ actor ∥ event_type ∥ summary ∥ created_at)`, fields
/// joined with the `\u{1f}` unit-separator character before hashing — the
/// exact formula Lighthouse's own real audit_log uses. `meta` is
/// deliberately NOT a hash input (see `record`'s doc comment for why); this
/// function only ever sees the five fields that participate in the chain.
fn compute_row_hash(prev_hash: &str, actor: &str, event_type: &str, summary: &str, created_at: &str) -> String {
    const SEP: char = '\u{1f}';
    let joined = format!("{prev_hash}{SEP}{actor}{SEP}{event_type}{SEP}{summary}{SEP}{created_at}");
    let digest = Sha256::digest(joined.as_bytes());
    hex::encode(digest)
}

/// Writes one row to the append-only chain. `meta` is a free-form JSON blob
/// for extra detail (e.g. an order id, an amount, a deleted resource's id) —
/// stored alongside the chain but deliberately EXCLUDED from the hash input:
/// `serde_json::Value`'s own re-serialization can reorder object keys or
/// reformat numbers, which would make an honest, unmodified row look
/// tampered the moment it's read back and re-hashed. Only the five fields
/// that are stored and read back as exact, stable strings (`prev_hash`,
/// `actor`, `event_type`, `summary`, `created_at`) ever participate in the
/// hash.
///
/// Guards the "read last row_hash → compute this row's hash → insert"
/// sequence with `state.audit_lock` (a plain `tokio::sync::Mutex<()>>`, see
/// its own doc comment on `AppState` for why this is sufficient here and
/// not Lighthouse's fuller advisory-lock + mpsc-channel setup) so two
/// concurrent callers can never both read the same `prev_hash` and each
/// insert a row that claims to follow it.
///
/// Best-effort, matching every other background-write contract already in
/// this codebase (`anomaly::record`, `hallucination::check_message`,
/// `chat::record_ccet_turn`): a failed insert here must never panic and
/// must never block or fail the caller's own primary action, which by the
/// time this is called has already succeeded.
pub async fn record(state: &AppState, actor: &str, event_type: &str, summary: &str, meta: Option<serde_json::Value>) {
    let _guard = state.audit_lock.lock().await;

    let prev_hash: String = sqlx::query_scalar("SELECT row_hash FROM audit_log ORDER BY rowid DESC LIMIT 1")
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| GENESIS_HASH.to_string());

    // Microsecond precision, not the second-granularity `datetime('now')`
    // default every other table in this codebase uses — this timestamp is
    // itself a hash input, generated once here in Rust and stored verbatim,
    // never regenerated or reformatted by SQLite on the way in or out.
    let created_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
    let row_hash = compute_row_hash(&prev_hash, actor, event_type, summary, &created_at);
    let meta_json = meta.map(|m| m.to_string());
    let id = Uuid::new_v4().to_string();

    let _ = sqlx::query(
        "INSERT INTO audit_log (id, actor, event_type, summary, meta, prev_hash, row_hash, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
    )
    .bind(&id)
    .bind(actor)
    .bind(event_type)
    .bind(summary)
    .bind(&meta_json)
    .bind(&prev_hash)
    .bind(&row_hash)
    .bind(&created_at)
    .execute(&state.db)
    .await;
    // `_guard` drops here, releasing the lock only after the insert lands —
    // holding it across the insert (not just the read) is exactly what
    // closes the race this lock exists for.
}

// ── verify: walk the chain, recompute every hash ────────────────────────

#[derive(Serialize)]
pub struct VerifyOut {
    ok: bool,
    chain_intact: bool,
    broken_at_id: Option<String>,
    total: i64,
}

type ChainRow = (String, String, String, String, String, String, String);

/// `GET /api/observatory/audit/verify` — walks the whole chain from the
/// first row, recomputing each row's `row_hash` from its own stored fields
/// plus the previous row's stored `row_hash`, and reports the first row
/// where either the linkage (`prev_hash` doesn't match the actual previous
/// row's `row_hash`) or the hash itself (recomputed `row_hash` doesn't match
/// the stored one) doesn't check out. `chain_intact: true` means it walked
/// every row clean to the end — an empty table is trivially intact (nothing
/// to break).
pub async fn verify(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let rows: Vec<ChainRow> = sqlx::query_as(
        "SELECT id, actor, event_type, summary, created_at, prev_hash, row_hash FROM audit_log ORDER BY rowid ASC",
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let total = rows.len() as i64;
    let mut expected_prev = GENESIS_HASH.to_string();
    let mut broken_at_id: Option<String> = None;

    for (id, actor, event_type, summary, created_at, prev_hash, row_hash) in &rows {
        if prev_hash != &expected_prev {
            broken_at_id = Some(id.clone());
            break;
        }
        let recomputed = compute_row_hash(prev_hash, actor, event_type, summary, created_at);
        if &recomputed != row_hash {
            broken_at_id = Some(id.clone());
            break;
        }
        expected_prev = row_hash.clone();
    }

    let chain_intact = broken_at_id.is_none();
    Json(VerifyOut { ok: true, chain_intact, broken_at_id, total }).into_response()
}

// ── read API: paginated recent entries ──────────────────────────────────

const DEFAULT_LOG_LIMIT: i64 = 50;
const MAX_LOG_LIMIT: i64 = 200;

#[derive(Deserialize)]
pub struct ListLogQuery {
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Serialize)]
struct AuditLogOut {
    id: String,
    actor: String,
    event_type: String,
    summary: String,
    meta: Option<serde_json::Value>,
    created_at: String,
}

type LogRow = (String, String, String, String, Option<String>, String);

/// `GET /api/observatory/audit/log` — paginated, newest first. Same
/// `limit`/`offset` + `X-Total-Count` response header convention as
/// `emergence::list_signals` / `simulation::list_runs`, so the frontend's
/// changelog panel needs no new pagination idiom.
pub async fn list_log(State(state): State<AppState>, headers: HeaderMap, Query(q): Query<ListLogQuery>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let limit = q.limit.unwrap_or(DEFAULT_LOG_LIMIT).clamp(1, MAX_LOG_LIMIT);
    let offset = q.offset.unwrap_or(0).max(0);

    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log").fetch_one(&state.db).await.unwrap_or(0);

    let rows: Vec<LogRow> = sqlx::query_as(
        "SELECT id, actor, event_type, summary, meta, created_at FROM audit_log ORDER BY rowid DESC LIMIT ?1 OFFSET ?2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let out: Vec<AuditLogOut> = rows
        .into_iter()
        .map(|(id, actor, event_type, summary, meta, created_at)| AuditLogOut {
            id,
            actor,
            event_type,
            summary,
            meta: meta.and_then(|s| serde_json::from_str(&s).ok()),
            created_at,
        })
        .collect();

    let mut resp = Json(out).into_response();
    resp.headers_mut().insert(
        "x-total-count",
        HeaderValue::from_str(&total.to_string()).unwrap_or_else(|_| HeaderValue::from_static("0")),
    );
    resp
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::{Query as AxQuery, State as AxState};
    use serde_json::json;
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
            chat_secret: String::new(),
            stripe_secret_key: String::new(),
            stripe_api_base: "https://api.stripe.com".to_string(),
            stripe_webhook_secret: String::new(),
            ddg_api_base: "https://api.duckduckgo.com".to_string(),
            github_token: String::new(),
            github_api_base: "https://api.github.com".to_string(),
            audit_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    async fn row_count(db: &SqlitePool) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM audit_log").fetch_one(db).await.unwrap()
    }

    // ── record() chains correctly ───────────────────────────────────────

    #[tokio::test]
    async fn first_row_chains_from_the_genesis_hash() {
        let state = test_state().await;
        record(&state, "admin", "content_updated", "erste Änderung", None).await;

        let row: (String, String) = sqlx::query_as("SELECT prev_hash, row_hash FROM audit_log LIMIT 1")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(row.0, GENESIS_HASH);
        // The stored row_hash must equal what an independent recomputation
        // from the stored fields produces — proves record() and
        // compute_row_hash agree on the exact same formula.
        let (actor, event_type, summary, created_at): (String, String, String, String) =
            sqlx::query_as("SELECT actor, event_type, summary, created_at FROM audit_log LIMIT 1")
                .fetch_one(&state.db)
                .await
                .unwrap();
        assert_eq!(row.1, compute_row_hash(GENESIS_HASH, &actor, &event_type, &summary, &created_at));
    }

    #[tokio::test]
    async fn second_row_prev_hash_equals_first_rows_row_hash() {
        let state = test_state().await;
        record(&state, "admin", "content_updated", "eins", None).await;
        record(&state, "admin", "blog_published", "zwei", None).await;

        let rows: Vec<(String, String)> = sqlx::query_as("SELECT prev_hash, row_hash FROM audit_log ORDER BY rowid ASC")
            .fetch_all(&state.db)
            .await
            .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1].0, rows[0].1, "second row's prev_hash must equal the first row's row_hash");
    }

    #[tokio::test]
    async fn meta_is_stored_but_not_a_hash_input() {
        let state = test_state().await;
        record(&state, "admin", "order_recorded", "Bestellung", Some(json!({"order_id": "abc", "amount_cents": 4900}))).await;

        let (meta, actor, event_type, summary, created_at, prev_hash, row_hash): (
            Option<String>, String, String, String, String, String, String,
        ) = sqlx::query_as("SELECT meta, actor, event_type, summary, created_at, prev_hash, row_hash FROM audit_log LIMIT 1")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert!(meta.is_some(), "meta must be persisted");
        // Hash recomputed purely from the five chain fields (never meta)
        // must still match — proves meta genuinely never entered the hash.
        assert_eq!(row_hash, compute_row_hash(&prev_hash, &actor, &event_type, &summary, &created_at));
    }

    // ── immutability triggers reject real tamper attempts ────────────────

    #[tokio::test]
    async fn raw_update_against_audit_log_is_rejected() {
        let state = test_state().await;
        record(&state, "admin", "content_updated", "unveränderlich", None).await;

        let result = sqlx::query("UPDATE audit_log SET summary = 'GEFÄLSCHT' WHERE 1=1")
            .execute(&state.db)
            .await;
        assert!(result.is_err(), "a direct UPDATE against audit_log must be rejected by the BEFORE UPDATE trigger");

        // The row itself must be provably untouched, not just "the
        // statement returned an error" — belt and suspenders.
        let summary: String = sqlx::query_scalar("SELECT summary FROM audit_log LIMIT 1").fetch_one(&state.db).await.unwrap();
        assert_eq!(summary, "unveränderlich");
    }

    #[tokio::test]
    async fn raw_delete_against_audit_log_is_rejected() {
        let state = test_state().await;
        record(&state, "admin", "content_updated", "bleibt stehen", None).await;

        let result = sqlx::query("DELETE FROM audit_log WHERE 1=1").execute(&state.db).await;
        assert!(result.is_err(), "a direct DELETE against audit_log must be rejected by the BEFORE DELETE trigger");
        assert_eq!(row_count(&state.db).await, 1, "the row must still be present after the rejected DELETE");
    }

    // ── verify() ───────────────────────────────────────────────────────

    #[tokio::test]
    async fn verify_reports_chain_intact_true_on_an_empty_table() {
        let state = test_state().await;
        let res = verify(AxState(state.clone()), HeaderMap::new()).await.into_response();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["chain_intact"], json!(true));
        assert_eq!(body["total"], json!(0));
        assert_eq!(body["broken_at_id"], serde_json::Value::Null);
    }

    #[tokio::test]
    async fn verify_reports_chain_intact_true_for_a_healthy_multi_entry_chain() {
        let state = test_state().await;
        for i in 0..5 {
            record(&state, "admin", "content_updated", &format!("Änderung {i}"), None).await;
        }

        let res = verify(AxState(state.clone()), HeaderMap::new()).await.into_response();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["chain_intact"], json!(true));
        assert_eq!(body["total"], json!(5));
        assert_eq!(body["broken_at_id"], serde_json::Value::Null);
    }

    /// Proves the corruption-detection path without going through the
    /// immutability trigger (already proven rejected above): constructs the
    /// fixture at a lower level, via a raw INSERT that plants a row whose
    /// stored `row_hash` does not match what its own fields (chained
    /// correctly off the real previous row) actually hash to — exactly what
    /// a successful tamper (however it happened) would look like from
    /// verify()'s point of view.
    #[tokio::test]
    async fn verify_detects_a_corrupted_row_hash() {
        let state = test_state().await;
        record(&state, "admin", "content_updated", "gesund eins", None).await;
        record(&state, "admin", "content_updated", "gesund zwei", None).await;

        let real_prev_hash: String = sqlx::query_scalar("SELECT row_hash FROM audit_log ORDER BY rowid DESC LIMIT 1")
            .fetch_one(&state.db)
            .await
            .unwrap();
        let created_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
        let tampered_id = Uuid::new_v4().to_string();
        // prev_hash correctly links to the real chain, but row_hash is
        // deliberately NOT what compute_row_hash would produce for these
        // fields — the corruption verify() must catch.
        sqlx::query(
            "INSERT INTO audit_log (id, actor, event_type, summary, meta, prev_hash, row_hash, created_at) VALUES (?1,?2,?3,?4,NULL,?5,?6,?7)",
        )
        .bind(&tampered_id)
        .bind("admin")
        .bind("content_updated")
        .bind("manipuliert")
        .bind(&real_prev_hash)
        .bind("0000000000000000000000000000000000000000000000000000000000000000")
        .bind(&created_at)
        .execute(&state.db)
        .await
        .unwrap();

        let res = verify(AxState(state.clone()), HeaderMap::new()).await.into_response();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["chain_intact"], json!(false));
        assert_eq!(body["broken_at_id"], json!(tampered_id));
        assert_eq!(body["total"], json!(3));
    }

    #[tokio::test]
    async fn verify_requires_admin_auth() {
        let mut state = test_state().await;
        state.chat_secret = "s3cret".to_string();
        let res = verify(AxState(state), HeaderMap::new()).await.into_response();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    // ── list_log() ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn list_log_reports_total_count_via_header_and_respects_limit() {
        let state = test_state().await;
        for i in 0..3 {
            record(&state, "admin", "content_updated", &format!("Eintrag {i}"), None).await;
        }

        let res = list_log(AxState(state.clone()), HeaderMap::new(), AxQuery(ListLogQuery { limit: Some(2), offset: None }))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let total_header = res.headers().get("x-total-count").unwrap().to_str().unwrap().to_string();
        assert_eq!(total_header, "3");
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let entries: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(entries.len(), 2, "limit=2 must cap the page even though 3 rows exist");
        // Newest first.
        assert_eq!(entries[0]["summary"], json!("Eintrag 2"));
    }

    #[tokio::test]
    async fn list_log_requires_admin_auth() {
        let mut state = test_state().await;
        state.chat_secret = "s3cret".to_string();
        let res = list_log(AxState(state), HeaderMap::new(), AxQuery(ListLogQuery { limit: None, offset: None }))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }
}
