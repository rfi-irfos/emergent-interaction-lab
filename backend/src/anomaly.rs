use axum::{
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{authz::require_admin, AppState};

/// Anomaly Watchdog v1 — "a watchdog that watches the watchdog." Everything
/// else added tonight (emergence signals, CCET, Denkfragmente, the
/// hallucination tracker) watches the RESEARCH: what Laura and the model are
/// doing together. This module watches JARVIS ITSELF: did a tool call fail,
/// did the tool-calling loop get stuck and hit its own round cap, did the
/// new Part-1 refusal instruction in `chat::SYSTEM_PROMPT` actually fire, did
/// the hallucination tracker already catch a real false claim. Four
/// concrete, already-real signals — never a vague "detect rogue behavior"
/// catch-all — logged to one place a human can review.
///
/// **HONESTY ABOUT WHAT THIS IS NOT — binding on every heuristic below, same
/// discipline as hallucination.rs's own no-fabrication doc comment.** This is
/// a set of pragmatic, mechanical trip-wires for a human to look at, not a
/// certified anomaly detector and not proof of anything on its own. Kind 3
/// (`refusal_triggered`) in particular is a plain keyword/substring scan over
/// the model's own reply text (see `contains_refusal_language`) — it will
/// miss a real refusal phrased differently, and it can fire on an unrelated
/// sentence that happens to contain one of the marker phrases. Every row
/// this module ever writes means "worth a human look," never "verified
/// finding" — the exact same posture this project's no-fabrication doctrine
/// already demands everywhere else (emergence.rs, thinking_fragments.rs,
/// hallucination.rs, chat.rs's CCET section).
pub async fn init_schema(db: &SqlitePool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS agent_anomalies (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            chat_message_id TEXT,
            detail TEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create agent_anomalies");
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_aa_created ON agent_anomalies(created_at)")
        .execute(db)
        .await
        .ok();
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_aa_kind ON agent_anomalies(kind)")
        .execute(db)
        .await
        .ok();
}

/// The four `kind` values this v1 ever writes — kept as constants (not a
/// free-text convention scattered across call sites) so the review endpoint,
/// the frontend's kind filter, and this module's own writers can never drift
/// on spelling.
pub(crate) const KIND_TOOL_ERROR: &str = "tool_error";
pub(crate) const KIND_ITERATION_CAP: &str = "iteration_cap";
pub(crate) const KIND_REFUSAL_TRIGGERED: &str = "refusal_triggered";
pub(crate) const KIND_HALLUCINATION_MISMATCH: &str = "hallucination_mismatch";

async fn record(state: &AppState, kind: &str, conversation_id: &str, chat_message_id: &str, detail: String) {
    let _ = sqlx::query(
        "INSERT INTO agent_anomalies (id, kind, conversation_id, chat_message_id, detail) VALUES (?1,?2,?3,?4,?5)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(kind)
    .bind(conversation_id)
    .bind(chat_message_id)
    .bind(detail)
    .execute(&state.db)
    .await;
}

/// Heuristic #3's own scope: a plain, bilingual (German/English, matching
/// `chat::SYSTEM_PROMPT`'s own bilingual reality — Laura can and does write
/// in English, and the model answers in kind) substring scan for language
/// that reads as an explicit refusal. Deliberately narrow, specific phrases
/// rather than a broad "nein"/"no" scan, which would false-positive on
/// nearly every ordinary reply that disagrees with something. Still, by
/// nature, a keyword match — not a certified refusal-detector, see this
/// module's own doc comment above. `pub(crate)` (not private) so it's
/// directly unit-testable against literal fixtures, same convention as
/// hallucination.rs's `compare`.
const REFUSAL_MARKERS: &[&str] = &[
    // German
    "das kann ich nicht tun",
    "das mache ich nicht",
    "das werde ich nicht tun",
    "ich verweigere",
    "ich lehne das ab",
    "dabei helfe ich nicht",
    "das unterstütze ich nicht",
    "das ist illegal",
    "das ist rechtswidrig",
    "das kann und werde ich nicht",
    // English
    "i can't help with that",
    "i cannot help with that",
    "i won't help with that",
    "i will not help with that",
    "i refuse to",
    "i'm not going to help with that",
    "i will not assist",
    "that's illegal",
    "that is illegal",
];

pub(crate) fn contains_refusal_language(text: &str) -> bool {
    let lower = text.to_lowercase();
    REFUSAL_MARKERS.iter().any(|m| lower.contains(m))
}

/// Background entry point. See `chat::stream_chat`'s combined hallucination
/// + anomaly spawn for why this is called chained AFTER
/// `hallucination::check_message` rather than from its own separate
/// `tokio::spawn`: signal 4 below reads the `hallucination_checks` rows that
/// call just persisted, so it has a real ordering dependency on it having
/// already run — not just a stylistic grouping choice.
///
/// Best-effort throughout (`let _ =` in `record`, `unwrap_or_default` on the
/// mismatch read below) — matches every other background-task contract in
/// this codebase (`capture_system_snapshot`, `record_ccet_turn`,
/// `hallucination::check_message`): a missing table or a failed read/write
/// here must never panic and must never surface on the visible chat
/// response, which by this point has already been sent to the client.
pub(crate) async fn detect_and_record(
    state: &AppState,
    conversation_id: &str,
    chat_message_id: &str,
    assistant_text: &str,
    errored_tool_calls: &[(String, String)],
    hit_iteration_cap: bool,
) {
    // 1) A tool call this exchange made came back with status == "error" —
    // see agent::tool_call_status, reused as-is by the caller (chat.rs's
    // round loop calls it once per round to build `errored_tool_calls`);
    // never reimplemented here.
    for (tool_call_id, tool_name) in errored_tool_calls {
        record(
            state,
            KIND_TOOL_ERROR,
            conversation_id,
            chat_message_id,
            format!("Werkzeugaufruf \"{tool_name}\" (agent_tool_calls id {tool_call_id}) meldete status=error."),
        )
        .await;
    }

    // 2) The tool-calling loop exhausted agent::MAX_TOOL_ITERATIONS rounds
    // without ever resolving to a final, non-tool-call reply — a real
    // looping/struggling signal, distinct from an ordinary exchange that
    // happens to finish with an empty final_full_text (see stream_chat's
    // `resolved_within_rounds` flag, which this bool is derived from — set
    // only in the loop's `None` / no-more-tool-calls branch, never merely
    // because the accumulated text was empty).
    if hit_iteration_cap {
        record(
            state,
            KIND_ITERATION_CAP,
            conversation_id,
            chat_message_id,
            format!(
                "Die Werkzeug-Runden-Obergrenze (agent::MAX_TOOL_ITERATIONS = {}) wurde erreicht, ohne dass die Antwort ohne weiteren Werkzeugaufruf abschloss.",
                crate::agent::MAX_TOOL_ITERATIONS
            ),
        )
        .await;
    }

    // 3) The Part-1 refusal instruction firing — heuristic, see this
    // module's own doc comment and `contains_refusal_language`'s doc comment
    // for the explicit "not a certified detector" disclosure.
    if contains_refusal_language(assistant_text) {
        record(
            state,
            KIND_REFUSAL_TRIGGERED,
            conversation_id,
            chat_message_id,
            "Heuristischer Treffer (Stichwort-Abgleich, keine zertifizierte Erkennung): die Antwort enthält eine Formulierung, die nach einer expliziten Ablehnung klingt — zur menschlichen Durchsicht.".to_string(),
        )
        .await;
    }

    // 4) hallucination.rs's own 'mismatch' verdict, reused verbatim (never
    // recomputed) — reads back whatever `hallucination::check_message` just
    // wrote for THIS message, since the caller chains this call strictly
    // after that one. `unwrap_or_default` (not `.expect`/`?`): a missing
    // `hallucination_checks` table (e.g. an older/partial schema) must
    // degrade to "nothing to check," never a panic.
    let mismatches: Vec<(String, String)> = sqlx::query_as(
        "SELECT tool_call_id, detail FROM hallucination_checks WHERE chat_message_id = ?1 AND verdict = 'mismatch'",
    )
    .bind(chat_message_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    for (tool_call_id, detail) in mismatches {
        record(
            state,
            KIND_HALLUCINATION_MISMATCH,
            conversation_id,
            chat_message_id,
            format!("hallucination_checks (tool_call_id {tool_call_id}): {detail}"),
        )
        .await;
    }
}

// ── read API ─────────────────────────────────────────────────────────────

const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 200;

#[derive(Deserialize)]
pub struct ListAnomaliesQuery {
    limit: Option<i64>,
    offset: Option<i64>,
    /// Optional exact `kind` filter (tool_error / iteration_cap /
    /// refusal_triggered / hallucination_mismatch) — a plain query param,
    /// same "not a hardcoded default filter" convention as
    /// hallucination.rs's `ListChecksQuery::verdict`.
    kind: Option<String>,
}

#[derive(Serialize)]
struct AnomalyOut {
    id: String,
    kind: String,
    conversation_id: String,
    chat_message_id: Option<String>,
    detail: String,
    created_at: String,
}

/// Admin-only, paginated — same `limit`/`offset` + `X-Total-Count` header
/// convention as `hallucination::list_checks` / `observatory::list_snapshots`
/// / `emergence::list_signals` / `simulation::list_runs`. A plain,
/// UI-agnostic row shape, same reasoning as `hallucination::list_checks`'s
/// own doc comment for why it stayed generic.
pub async fn list_anomalies(State(state): State<AppState>, headers: HeaderMap, Query(q): Query<ListAnomaliesQuery>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let offset = q.offset.unwrap_or(0).max(0);
    let kind_filter = q
        .kind
        .as_deref()
        .filter(|k| matches!(*k, "tool_error" | "iteration_cap" | "refusal_triggered" | "hallucination_mismatch"));

    let (total, rows): (i64, Vec<(String, String, String, Option<String>, String, String)>) = match kind_filter {
        Some(k) => {
            let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_anomalies WHERE kind = ?1")
                .bind(k)
                .fetch_one(&state.db)
                .await
                .unwrap_or(0);
            let rows = sqlx::query_as(
                "SELECT id, kind, conversation_id, chat_message_id, detail, created_at FROM agent_anomalies \
                 WHERE kind = ?1 ORDER BY created_at DESC LIMIT ?2 OFFSET ?3",
            )
            .bind(k)
            .bind(limit)
            .bind(offset)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();
            (total, rows)
        }
        None => {
            let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_anomalies").fetch_one(&state.db).await.unwrap_or(0);
            let rows = sqlx::query_as(
                "SELECT id, kind, conversation_id, chat_message_id, detail, created_at FROM agent_anomalies \
                 ORDER BY created_at DESC LIMIT ?1 OFFSET ?2",
            )
            .bind(limit)
            .bind(offset)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();
            (total, rows)
        }
    };

    let out: Vec<AnomalyOut> = rows
        .into_iter()
        .map(|(id, kind, conversation_id, chat_message_id, detail, created_at)| AnomalyOut {
            id,
            kind,
            conversation_id,
            chat_message_id,
            detail,
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
        crate::chat::init_schema(&db).await;
        crate::agent::init_schema(&db).await;
        crate::hallucination::init_schema(&db).await;
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
            chat_model_idx: Arc::new(AtomicUsize::new(0)),
            chat_request_count: Arc::new(AtomicU64::new(0)),
        }
    }

    // ── contains_refusal_language: pure-function fixtures ───────────────

    #[test]
    fn contains_refusal_language_detects_a_german_marker() {
        assert!(contains_refusal_language("Nein, das kann ich nicht tun — auch nicht fürs Team, das ist illegal."));
    }

    #[test]
    fn contains_refusal_language_detects_an_english_marker() {
        assert!(contains_refusal_language("I can't help with that, even framed as a test."));
    }

    #[test]
    fn contains_refusal_language_is_false_for_an_ordinary_reply() {
        assert!(!contains_refusal_language("Klar, hier ist die Analyse der letzten Woche."));
    }

    // ── detect_and_record: one real row per real trigger condition ──────

    #[tokio::test]
    async fn detect_and_record_writes_tool_error_row_for_a_real_errored_tool_call() {
        let state = test_state().await;
        // A real ToolCall through real execute_tool/tool_call_status — not a
        // hand-typed status string. revise_blog_post against a post_id that
        // doesn't exist degrades to Err("post not found") even with no
        // blog_posts table at all (see blog::revise_draft), so this is a
        // genuinely real, reproducible failure with no seed data needed.
        let call = crate::agent::ToolCall { tool: "revise_blog_post".to_string(), arguments: json!({ "post_id": "does-not-exist" }) };
        let result = crate::agent::execute_tool(&state, &call, None, "conv-1").await;
        assert_eq!(crate::agent::tool_call_status(&result), "error", "sanity check: this really is the failure path this heuristic exists for");

        detect_and_record(
            &state,
            "conv-1",
            "msg-1",
            "Das hat leider nicht geklappt.",
            &[("call-1".to_string(), "revise_blog_post".to_string())],
            false,
        )
        .await;

        let row: (String, String) = sqlx::query_as("SELECT kind, detail FROM agent_anomalies WHERE chat_message_id = 'msg-1'")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(row.0, KIND_TOOL_ERROR);
        assert!(row.1.contains("revise_blog_post"));
    }

    #[tokio::test]
    async fn detect_and_record_writes_iteration_cap_row_when_the_cap_was_hit() {
        let state = test_state().await;
        detect_and_record(&state, "conv-2", "msg-2", "Ich habe mehrere Werkzeuge aufgerufen, konnte aber noch keine abschließende Antwort formulieren.", &[], true).await;

        let row: (String, String) = sqlx::query_as("SELECT kind, detail FROM agent_anomalies WHERE chat_message_id = 'msg-2'")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(row.0, KIND_ITERATION_CAP);
        assert!(row.1.contains(&crate::agent::MAX_TOOL_ITERATIONS.to_string()));
    }

    #[tokio::test]
    async fn detect_and_record_writes_refusal_triggered_row_when_refusal_language_is_present() {
        let state = test_state().await;
        detect_and_record(&state, "conv-3", "msg-3", "Nein, das kann ich nicht tun — auch nicht fürs Team, das ist illegal.", &[], false).await;

        let row: (String,) = sqlx::query_as("SELECT kind FROM agent_anomalies WHERE chat_message_id = 'msg-3'")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(row.0, KIND_REFUSAL_TRIGGERED);
    }

    #[tokio::test]
    async fn detect_and_record_writes_hallucination_mismatch_row_reusing_the_real_verdict() {
        let state = test_state().await;
        // Seed a REAL hallucination_checks row, exactly the shape
        // hallucination::check_message itself would write — proves this
        // reads/reuses that verdict rather than recomputing it independently.
        sqlx::query(
            "INSERT INTO hallucination_checks (id, chat_message_id, tool_call_id, verdict, detail) VALUES ('hc-1','msg-4','call-4','mismatch','Antwort nennt eine falsche ID.')",
        )
        .execute(&state.db)
        .await
        .unwrap();

        detect_and_record(&state, "conv-4", "msg-4", "Erledigt.", &[], false).await;

        let row: (String, String) = sqlx::query_as("SELECT kind, detail FROM agent_anomalies WHERE chat_message_id = 'msg-4'")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(row.0, KIND_HALLUCINATION_MISMATCH);
        assert!(row.1.contains("falsche ID"));
    }

    #[tokio::test]
    async fn detect_and_record_writes_nothing_when_no_signal_is_present() {
        let state = test_state().await;
        detect_and_record(&state, "conv-5", "msg-5", "Alles wie erwartet gelaufen, hier die Zahlen.", &[], false).await;
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM agent_anomalies").fetch_one(&state.db).await.unwrap();
        assert_eq!(count.0, 0, "a genuinely clean turn must not produce a false-positive anomaly row");
    }

    // ── list_anomalies: pagination + kind filter + admin auth ───────────

    async fn seed_anomaly(db: &SqlitePool, id: &str, kind: &str, conv_id: &str) {
        sqlx::query("INSERT INTO agent_anomalies (id, kind, conversation_id, chat_message_id, detail) VALUES (?1,?2,?3,'m','d')")
            .bind(id)
            .bind(kind)
            .bind(conv_id)
            .execute(db)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn list_anomalies_reports_total_count_via_header_and_respects_limit() {
        let state = test_state().await;
        for i in 0..5 {
            seed_anomaly(&state.db, &format!("a{i}"), "tool_error", "conv-x").await;
        }
        let res = list_anomalies(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(ListAnomaliesQuery { limit: Some(2), offset: None, kind: None }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.headers().get("x-total-count").unwrap().to_str().unwrap(), "5");
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body.len(), 2);
    }

    #[tokio::test]
    async fn list_anomalies_kind_filter_returns_only_matching_rows() {
        let state = test_state().await;
        seed_anomaly(&state.db, "a1", "tool_error", "conv-1").await;
        seed_anomaly(&state.db, "a2", "iteration_cap", "conv-2").await;

        let res = list_anomalies(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(ListAnomaliesQuery { limit: None, offset: None, kind: Some("iteration_cap".to_string()) }),
        )
        .await
        .into_response();
        assert_eq!(res.headers().get("x-total-count").unwrap().to_str().unwrap(), "1");
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body.len(), 1);
        assert_eq!(body[0]["conversation_id"], "conv-2");
    }

    #[tokio::test]
    async fn list_anomalies_requires_admin_auth() {
        let mut state = test_state().await;
        state.chat_secret = "shh".to_string();
        let res = list_anomalies(AxState(state), HeaderMap::new(), AxQuery(ListAnomaliesQuery { limit: None, offset: None, kind: None }))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }
}
