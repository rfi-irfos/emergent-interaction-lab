use axum::{
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{QueryBuilder, Sqlite, SqlitePool};
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
    /// Exact match against `actor` (e.g. `"admin"`, `"system"`, `"stripe"`,
    /// or a real logged-in email — see `record`'s call sites across the
    /// codebase for the actual values in use). Absent/blank means "any."
    actor: Option<String>,
    /// Exact match against `event_type` (e.g. `content_updated`,
    /// `blog_published`, `admin_login`, `anomaly_detected`, ...). Absent/
    /// blank means "any."
    event_type: Option<String>,
    /// Inclusive lower bound on `created_at`, compared as a plain string —
    /// `created_at` is stored as an RFC3339 timestamp (see `record`'s own
    /// microsecond-precision doc comment), which sorts lexicographically
    /// identically to chronological order as long as both bounds are given
    /// in the same UTC/zero-padded shape. This deliberately does NOT reuse
    /// `observatory::resolve_range`'s `?range=7d|30d|all` convention —
    /// that idiom answers "how far back from right now," a RELATIVE window
    /// expressed as `datetime('now', '-N days')`. `from`/`to` here are
    /// ABSOLUTE, caller-supplied bounds (a real date-range picker), which
    /// is a different shape of question — so this instead mirrors the
    /// direct value-comparison idiom `chat::delete_message_and_after`
    /// already uses for `created_at >= ?` against a caller-supplied
    /// timestamp, rather than inventing a third date-handling convention.
    from: Option<String>,
    /// Inclusive upper bound on `created_at`, same string-comparison idiom
    /// as `from` above. A caller sending a bare date (`"2026-07-01"`) rather
    /// than a full timestamp gets a same-day cutoff at midnight — the
    /// frontend is expected to append `T23:59:59.999999` (end of day) when
    /// the user picks a calendar day, exactly as the reverse is true for
    /// `from` defaulting to that day's midnight already.
    to: Option<String>,
    /// Free-text search over `summary` only (not `meta`, which is an
    /// unindexed opaque JSON blob) — a plain `LIKE '%...%'`, no wildcard
    /// escaping. This table is an admin-only, single-tenant append log, not
    /// a large multi-tenant corpus, so the simple form is deliberately
    /// enough (see the plan this shipped against).
    q: Option<String>,
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

/// Appends every present, non-blank filter in `q` onto `qb` as `WHERE`
/// (first hit) / `AND` (every hit after) clauses — shared between the count
/// query and the page query in `list_log` below so the two can never drift
/// apart (see that function's own doc comment for why that matters: a
/// filtered `X-Total-Count` that silently forgot one of the filters would
/// under/over-report how much more there is to page through). Same
/// `QueryBuilder<Sqlite>` dynamic-clause idiom `dashboards::update_widget`
/// already uses for its optional `SET` fields, just building a `WHERE`
/// instead of a `SET`.
fn append_log_filters<'q>(qb: &mut QueryBuilder<'q, Sqlite>, q: &'q ListLogQuery) {
    let mut any = false;

    if let Some(actor) = q.actor.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        qb.push(if any { " AND " } else { " WHERE " });
        qb.push("actor = ").push_bind(actor);
        any = true;
    }
    if let Some(event_type) = q.event_type.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        qb.push(if any { " AND " } else { " WHERE " });
        qb.push("event_type = ").push_bind(event_type);
        any = true;
    }
    if let Some(from) = q.from.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        qb.push(if any { " AND " } else { " WHERE " });
        qb.push("created_at >= ").push_bind(from);
        any = true;
    }
    if let Some(to) = q.to.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        qb.push(if any { " AND " } else { " WHERE " });
        qb.push("created_at <= ").push_bind(to);
        any = true;
    }
    if let Some(term) = q.q.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        qb.push(if any { " AND " } else { " WHERE " });
        qb.push("summary LIKE ").push_bind(format!("%{term}%"));
    }
}

/// `GET /api/observatory/audit/log` — paginated, newest first. Same
/// `limit`/`offset` + `X-Total-Count` response header convention as
/// `emergence::list_signals` / `simulation::list_runs`, so the frontend's
/// changelog panel needs no new pagination idiom.
///
/// `actor`/`event_type`/`from`/`to`/`q` (see `ListLogQuery`'s own field doc
/// comments for each) are all optional and combine with AND when several
/// are present at once — a request naming both `actor` and `event_type`
/// narrows to rows matching both, not either. Critically, `X-Total-Count`
/// is computed with the SAME filters as the page itself (via the shared
/// `append_log_filters` helper): the total is "how many rows match this
/// filtered view," never the unfiltered whole-table count, which would
/// otherwise make the frontend's "Weitere laden (X / Y)" counter and
/// load-more-availability check lie the moment any filter narrows the
/// result set below the true total.
pub async fn list_log(State(state): State<AppState>, headers: HeaderMap, Query(q): Query<ListLogQuery>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let limit = q.limit.unwrap_or(DEFAULT_LOG_LIMIT).clamp(1, MAX_LOG_LIMIT);
    let offset = q.offset.unwrap_or(0).max(0);

    let mut count_qb: QueryBuilder<Sqlite> = QueryBuilder::new("SELECT COUNT(*) FROM audit_log");
    append_log_filters(&mut count_qb, &q);
    let total: i64 = count_qb.build_query_scalar().fetch_one(&state.db).await.unwrap_or(0);

    let mut select_qb: QueryBuilder<Sqlite> =
        QueryBuilder::new("SELECT id, actor, event_type, summary, meta, created_at FROM audit_log");
    append_log_filters(&mut select_qb, &q);
    select_qb.push(" ORDER BY rowid DESC LIMIT ").push_bind(limit).push(" OFFSET ").push_bind(offset);
    let rows: Vec<LogRow> = select_qb.build_query_as().fetch_all(&state.db).await.unwrap_or_default();

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
            hermes_url: String::new(),
            hermes_api_key: String::new(),
            hermes_boot_grace: crate::hermes::HERMES_BOOT_GRACE,
            mcp_token: String::new(),
            github_token: String::new(),
            github_api_base: "https://api.github.com".to_string(),
            eil_github_token: String::new(),
            eil_github_repo: String::new(),
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

    fn empty_log_query() -> ListLogQuery {
        ListLogQuery { limit: None, offset: None, actor: None, event_type: None, from: None, to: None, q: None }
    }

    async fn log_body(res: axum::response::Response) -> (Vec<serde_json::Value>, Option<i64>) {
        let total = res.headers().get("x-total-count").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<i64>().ok());
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        (body, total)
    }

    #[tokio::test]
    async fn list_log_reports_total_count_via_header_and_respects_limit() {
        let state = test_state().await;
        for i in 0..3 {
            record(&state, "admin", "content_updated", &format!("Eintrag {i}"), None).await;
        }

        let res = list_log(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(ListLogQuery { limit: Some(2), ..empty_log_query() }),
        )
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
        let res = list_log(AxState(state), HeaderMap::new(), AxQuery(empty_log_query())).await.into_response();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn list_log_filters_by_exact_actor() {
        let state = test_state().await;
        record(&state, "admin", "content_updated", "von admin", None).await;
        record(&state, "system", "anomaly_detected", "von system", None).await;
        record(&state, "stripe", "order_recorded", "von stripe", None).await;

        let (body, total) = log_body(
            list_log(
                AxState(state.clone()),
                HeaderMap::new(),
                AxQuery(ListLogQuery { actor: Some("system".to_string()), ..empty_log_query() }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(total, Some(1), "X-Total-Count must reflect only the actor-filtered rows");
        assert_eq!(body.len(), 1);
        assert_eq!(body[0]["actor"], json!("system"));
        assert_eq!(body[0]["summary"], json!("von system"));
    }

    #[tokio::test]
    async fn list_log_filters_by_exact_event_type() {
        let state = test_state().await;
        record(&state, "admin", "content_updated", "eins", None).await;
        record(&state, "admin", "blog_published", "zwei", None).await;
        record(&state, "admin", "blog_published", "drei", None).await;

        let (body, total) = log_body(
            list_log(
                AxState(state.clone()),
                HeaderMap::new(),
                AxQuery(ListLogQuery { event_type: Some("blog_published".to_string()), ..empty_log_query() }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(total, Some(2));
        assert_eq!(body.len(), 2);
        assert!(body.iter().all(|e| e["event_type"] == json!("blog_published")));
    }

    #[tokio::test]
    async fn list_log_filters_by_free_text_q_over_summary() {
        let state = test_state().await;
        record(&state, "admin", "content_updated", "Startseite aktualisiert", None).await;
        record(&state, "admin", "blog_published", "Neuer Blogbeitrag veröffentlicht", None).await;

        let (body, total) = log_body(
            list_log(
                AxState(state.clone()),
                HeaderMap::new(),
                AxQuery(ListLogQuery { q: Some("Blogbeitrag".to_string()), ..empty_log_query() }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(total, Some(1), "free-text q must only match the row whose summary contains the term");
        assert_eq!(body.len(), 1);
        assert_eq!(body[0]["summary"], json!("Neuer Blogbeitrag veröffentlicht"));
    }

    /// `from`/`to` compare directly against the stored RFC3339 `created_at`
    /// string (see `ListLogQuery::from`'s doc comment for why) — seeds one
    /// deliberately old row the same way `observatory::list_snapshots_range_
    /// filter_excludes_older_snapshots` seeds an old fixture, since `record`
    /// itself always stamps "now" and can't produce an old row on demand.
    #[tokio::test]
    async fn list_log_filters_by_from_and_to_date_range() {
        let state = test_state().await;
        sqlx::query(
            "INSERT INTO audit_log (id, actor, event_type, summary, meta, prev_hash, row_hash, created_at) \
             VALUES (?1, 'admin', 'content_updated', 'alt', NULL, 'genesis', 'irrelevant-old-hash', '2020-01-01T00:00:00.000000Z')",
        )
        .bind(Uuid::new_v4().to_string())
        .execute(&state.db)
        .await
        .unwrap();
        record(&state, "admin", "content_updated", "neu", None).await;

        // `from` alone: excludes the 2020 row.
        let (body, total) = log_body(
            list_log(
                AxState(state.clone()),
                HeaderMap::new(),
                AxQuery(ListLogQuery { from: Some("2025-01-01T00:00:00.000000Z".to_string()), ..empty_log_query() }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(total, Some(1));
        assert_eq!(body.len(), 1);
        assert_eq!(body[0]["summary"], json!("neu"));

        // `to` alone: excludes the new row, keeps only the 2020 one.
        let (body, total) = log_body(
            list_log(
                AxState(state.clone()),
                HeaderMap::new(),
                AxQuery(ListLogQuery { to: Some("2020-12-31T23:59:59.999999Z".to_string()), ..empty_log_query() }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(total, Some(1));
        assert_eq!(body.len(), 1);
        assert_eq!(body[0]["summary"], json!("alt"));

        // `from` + `to` together, both far in the past: matches neither row.
        let (body, total) = log_body(
            list_log(
                AxState(state.clone()),
                HeaderMap::new(),
                AxQuery(ListLogQuery {
                    from: Some("2019-01-01T00:00:00.000000Z".to_string()),
                    to: Some("2019-12-31T23:59:59.999999Z".to_string()),
                    ..empty_log_query()
                }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(total, Some(0));
        assert_eq!(body.len(), 0);
    }

    #[tokio::test]
    async fn list_log_combines_actor_and_event_type_filters_with_and() {
        let state = test_state().await;
        record(&state, "admin", "content_updated", "admin+content", None).await;
        record(&state, "admin", "blog_published", "admin+blog", None).await;
        record(&state, "system", "content_updated", "system+content", None).await;

        let (body, total) = log_body(
            list_log(
                AxState(state.clone()),
                HeaderMap::new(),
                AxQuery(ListLogQuery {
                    actor: Some("admin".to_string()),
                    event_type: Some("content_updated".to_string()),
                    ..empty_log_query()
                }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(total, Some(1), "AND must narrow to only the row matching BOTH filters, not either alone");
        assert_eq!(body.len(), 1);
        assert_eq!(body[0]["summary"], json!("admin+content"));
    }

    /// The exact "off-by-one-in-spirit" bug the plan called out: a naive
    /// implementation might compute `X-Total-Count` from the whole,
    /// unfiltered table while still returning a filtered page — this proves
    /// the header tracks the FILTERED count even when it's smaller than the
    /// real table size.
    #[tokio::test]
    async fn list_log_total_count_header_reflects_filtered_count_not_whole_table() {
        let state = test_state().await;
        for i in 0..5 {
            record(&state, "admin", "content_updated", &format!("Eintrag {i}"), None).await;
        }
        record(&state, "system", "anomaly_detected", "der eine Ausreißer", None).await;

        let (body, total) = log_body(
            list_log(
                AxState(state.clone()),
                HeaderMap::new(),
                AxQuery(ListLogQuery { actor: Some("system".to_string()), ..empty_log_query() }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(total, Some(1), "must be the filtered count (1), never the unfiltered table total (6)");
        assert_eq!(body.len(), 1);
    }
}
