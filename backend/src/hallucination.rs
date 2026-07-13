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

/// Hallucination Tracker v1 — distinguishes real, legitimate uncertainty
/// (Laura's own project explicitly values honest "I don't know"/"this is
/// unverified" language — see the no-fabrication doctrine already running
/// through emergence.rs/thinking_fragments.rs/chat.rs's CCET section) from
/// Jarvis making a FALSE, CHECKABLE claim about something a tool call
/// itself actually did — e.g. "I created file X" when the tool result shows
/// it didn't, or "that worked" when the tool result says it failed.
///
/// **SCOPE — deliberately bounded, read before extending this file.** This
/// is NOT a general fact-checker and must never grow into one without a
/// deliberate, separate decision. It ONLY ever compares an assistant
/// message's own claim text against the literal `result` JSON of a tool
/// call THAT SAME message is linked to (see `chat_messages.tool_call_ids`,
/// populated once — at the point the final message of an exchange is
/// persisted — in `chat::stream_chat`). Concretely in scope, and nothing
/// beyond it: does a file/note/post id the tool call returned actually
/// appear correctly referenced in the claim; does a count the tool reported
/// match what the assistant said; does a reported failure get accurately
/// described as a failure rather than silently claimed as success. No
/// second LLM call is used here on purpose — one unverified model guessing
/// whether another model told the truth is a worse kind of fabrication than
/// doing nothing; plain string/JSON-field comparison against what the tool
/// call's own `result` actually contains is more honest, even though it's
/// narrower.
///
/// **NO-FABRICATION DISCIPLINE — binding on `compare` and everything that
/// calls it.** A `Mismatch` verdict may ONLY be recorded when the
/// comparison is CERTAIN: the tool call's own result concretely and
/// literally contradicts the assistant's text. Anything not certain — no
/// comparable field in this tool's result shape, an id/count the assistant
/// simply never mentioned either way, ambiguous phrasing — MUST be
/// `Unverifiable`. Never default an unclear case to `Match` (that would
/// hide a possible false claim) and never default it to `Mismatch` (that
/// would fabricate an accusation this project has no real evidence for).
/// If you're extending this file and are tempted to make the comparison
/// guess when it isn't sure: don't — `Unverifiable` exists exactly so
/// nothing downstream ever has to.
pub async fn init_schema(db: &SqlitePool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS hallucination_checks (
            id TEXT PRIMARY KEY,
            chat_message_id TEXT NOT NULL,
            tool_call_id TEXT NOT NULL,
            verdict TEXT NOT NULL CHECK(verdict IN ('match','mismatch','unverifiable')),
            detail TEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create hallucination_checks");
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_hc_message ON hallucination_checks(chat_message_id)")
        .execute(db)
        .await
        .ok();
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_hc_created ON hallucination_checks(created_at)")
        .execute(db)
        .await
        .ok();
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Verdict {
    Match,
    Mismatch,
    Unverifiable,
}

impl Verdict {
    fn as_str(self) -> &'static str {
        match self {
            Verdict::Match => "match",
            Verdict::Mismatch => "mismatch",
            Verdict::Unverifiable => "unverifiable",
        }
    }
}

/// Small, explicit, German-language phrase sets used only to decide whether
/// the assistant's OWN text reads as an unhedged success claim vs. an
/// honest acknowledgement of failure — this is still a literal substring
/// check, not an LLM judgment call. Deliberately narrow: see `compare`'s
/// "reported failure" branch for how these are combined so an ambiguous
/// case (neither phrase present) falls to `Unverifiable`, never guessed.
const SUCCESS_PHRASES: &[&str] = &[
    "erfolgreich", "hat funktioniert", "hat geklappt", "ist erledigt",
    "wurde erstellt", "wurde angelegt", "hab ich erledigt", "habe ich erledigt",
];
const FAILURE_PHRASES: &[&str] = &[
    "fehlgeschlagen", "hat nicht funktioniert", "hat nicht geklappt",
    "leider nicht", "fehler", "konnte nicht", "schiefgelaufen", "nicht erstellt", "nicht angelegt",
];

/// Scans `text` for standalone tokens shaped like a UUIDv4 (8-4-4-4-12 hex
/// groups joined by hyphens) — the exact shape every `Uuid::new_v4().to_string()`
/// id in this codebase produces (blog post ids, research note ids,
/// simulation run ids, tool_call ids themselves). No regex dependency (none
/// is already used in this backend) — a small hand-rolled scanner, same
/// "operate on the text directly, no external crate" style as agent.rs's
/// `matching_brace_end`.
fn find_uuid_tokens(text: &str) -> Vec<String> {
    fn is_uuid_shape(s: &str) -> bool {
        let parts: Vec<&str> = s.split('-').collect();
        parts.len() == 5
            && [8usize, 4, 4, 4, 12]
                .iter()
                .zip(parts.iter())
                .all(|(&len, p)| p.len() == len && p.chars().all(|c| c.is_ascii_hexdigit()))
    }
    text.split(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '(' | ')' | ',' | '.' | ':' | ';' | '`'))
        .filter(|tok| !tok.is_empty() && is_uuid_shape(tok))
        .map(|s| s.to_string())
        .collect()
}

/// Standalone (non-hex-adjacent) integer tokens in `text` — used only for
/// the `get_recent_analytics` count check below.
fn find_integer_tokens(text: &str) -> Vec<i64> {
    text.split(|c: char| !c.is_ascii_digit())
        .filter(|tok| !tok.is_empty())
        .filter_map(|tok| tok.parse::<i64>().ok())
        .collect()
}

/// The entire v1 comparison — pure and side-effect free (no DB, no
/// network) so it's directly unit-testable against literal fixtures. See
/// this module's own doc comment above for the binding scope/no-fabrication
/// rules this function must never violate.
pub(crate) fn compare(tool_name: &str, result_json: &str, assistant_text: &str) -> (Verdict, String) {
    let result: serde_json::Value = match serde_json::from_str(result_json) {
        Ok(v) => v,
        Err(_) => {
            return (
                Verdict::Unverifiable,
                "Tool-Ergebnis war kein valides JSON — kein Abgleich möglich.".to_string(),
            )
        }
    };
    let lower_text = assistant_text.to_lowercase();

    // 1) Reported failure silently claimed as success — the single most
    // dangerous shape in this v1's scope, so it's checked first regardless
    // of which tool this is.
    let ok = result.get("ok").and_then(|v| v.as_bool());
    let has_error = result.get("error").is_some();
    let reported_failure = ok == Some(false) || (ok.is_none() && has_error);
    if reported_failure {
        let error_text = result.get("error").and_then(|v| v.as_str()).unwrap_or("");
        let claims_success = SUCCESS_PHRASES.iter().any(|p| lower_text.contains(p));
        let acknowledges_failure = FAILURE_PHRASES.iter().any(|p| lower_text.contains(p))
            || (!error_text.is_empty() && assistant_text.contains(error_text));
        return if claims_success && !acknowledges_failure {
            (
                Verdict::Mismatch,
                format!("Tool-Aufruf ({tool_name}) meldete einen Fehler (\"{error_text}\"), die Antwort behauptet aber Erfolg."),
            )
        } else if acknowledges_failure {
            (
                Verdict::Match,
                format!("Tool-Aufruf ({tool_name}) meldete einen Fehler, die Antwort gibt das ehrlich wieder."),
            )
        } else {
            (
                Verdict::Unverifiable,
                format!("Tool-Aufruf ({tool_name}) meldete einen Fehler — aus dem Antworttext lässt sich nicht sicher ablesen, ob er als Fehler wiedergegeben wurde."),
            )
        };
    }

    // 2) A concrete id the tool returned on success (draft_blog_post,
    // log_research_note, run_simulation_scenario all return {"id": "..."}).
    if let Some(id) = result.get("id").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
        let found = find_uuid_tokens(assistant_text);
        if found.iter().any(|t| t == id) {
            return (Verdict::Match, format!("Die genannte ID ({id}) stimmt mit dem echten Tool-Ergebnis überein."));
        }
        if let Some(wrong) = found.iter().find(|t| t.as_str() != id) {
            return (
                Verdict::Mismatch,
                format!("Antwort nennt eine ID ({wrong}), die NICHT mit dem echten Tool-Ergebnis ({id}) übereinstimmt."),
            );
        }
        // Most replies paraphrase ("ich habe das angelegt") instead of
        // quoting the raw id — that alone is not evidence of a false claim.
        return (
            Verdict::Unverifiable,
            format!("Tool-Ergebnis enthält eine ID ({id}), die im Antworttext nicht wörtlich vorkommt — kein sicherer Abgleich möglich."),
        );
    }

    // 3) A concrete count (get_recent_analytics: views/unique_visitors/days).
    if tool_name == "get_recent_analytics" {
        if let (Some(views), Some(uniques), Some(days)) = (
            result.get("views").and_then(|v| v.as_i64()),
            result.get("unique_visitors").and_then(|v| v.as_i64()),
            result.get("days").and_then(|v| v.as_i64()),
        ) {
            let found = find_integer_tokens(assistant_text);
            if found.contains(&views) {
                return (Verdict::Match, format!("Die genannte Zahl ({views}) stimmt mit dem echten Tool-Ergebnis überein."));
            }
            if let Some(&wrong) = found.iter().find(|&&n| n != views && n != uniques && n != days) {
                return (
                    Verdict::Mismatch,
                    format!("Antwort nennt eine Zahl ({wrong}), die NICHT mit dem echten Seitenaufrufe-Wert ({views}) aus dem Tool-Ergebnis übereinstimmt."),
                );
            }
            return (
                Verdict::Unverifiable,
                "Tool-Ergebnis enthält Zahlen, die im Antworttext nicht wörtlich vorkommen — kein sicherer Abgleich möglich.".to_string(),
            );
        }
    }

    // Nothing in this tool's result shape is concretely comparable for v1
    // (e.g. update_content_field's echoed field/value, get_content_section's
    // raw section content, web_search's result list) — honest silence, not
    // a guess.
    (
        Verdict::Unverifiable,
        format!("Tool \"{tool_name}\" liefert für dieses v1 nichts konkret Vergleichbares in diesem Ergebnis."),
    )
}

/// Background entry point — always called from a `tokio::spawn` in
/// `chat::stream_chat`, right alongside the emergence/CCET/Denkfragmente
/// spawns, never on the reply's critical path. `tool_call_ids` is the exact
/// list accumulated across this exchange's tool-calling rounds; an empty
/// slice (the overwhelmingly common case — most turns make no tool call at
/// all) is a fast, silent no-op with zero DB round-trips.
///
/// Best-effort throughout, matching `capture_system_snapshot`/
/// `record_ccet_turn`'s own contract: a missing table or a failed read
/// degrades to skipping that tool call (logged as a warning), never a
/// panic and never a fabricated verdict for a result that couldn't
/// actually be read.
pub(crate) async fn check_message(state: &AppState, chat_message_id: &str, tool_call_ids: &[String], assistant_text: &str) {
    for tool_call_id in tool_call_ids {
        let row: Option<(String, String)> =
            match sqlx::query_as("SELECT tool_name, result FROM agent_tool_calls WHERE id = ?1")
                .bind(tool_call_id)
                .fetch_optional(&state.db)
                .await
            {
                Ok(row) => row,
                Err(e) => {
                    tracing::warn!("hallucination check: could not read agent_tool_calls for {tool_call_id}: {e}");
                    None
                }
            };
        let Some((tool_name, result)) = row else {
            // Either the row genuinely doesn't exist (its own log_tool_call
            // insert failed) or the table itself is missing in this
            // environment. Either way: honestly nothing to check against,
            // never fabricate a verdict for a result that can't be read.
            continue;
        };
        let (verdict, detail) = compare(&tool_name, &result, assistant_text);
        let _ = sqlx::query(
            "INSERT INTO hallucination_checks (id, chat_message_id, tool_call_id, verdict, detail) VALUES (?1,?2,?3,?4,?5)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(chat_message_id)
        .bind(tool_call_id)
        .bind(verdict.as_str())
        .bind(&detail)
        .execute(&state.db)
        .await;
        // `hallucination_mismatch` — ONLY a genuine Mismatch verdict ever
        // reaches the changelog, never Match/Unverifiable: this is the
        // safety-relevant event the plan explicitly calls out, not a log of
        // every tool-call comparison this tracker ever runs.
        if matches!(verdict, Verdict::Mismatch) {
            crate::auditlog::record(
                state,
                "system",
                "hallucination_mismatch",
                &detail,
                Some(serde_json::json!({"tool_call_id": tool_call_id, "chat_message_id": chat_message_id, "tool_name": tool_name})),
            )
            .await;
        }
    }
}

// ── read API ─────────────────────────────────────────────────────────────

const DEFAULT_CHECKS_LIMIT: i64 = 50;
const MAX_CHECKS_LIMIT: i64 = 200;

#[derive(Deserialize)]
pub struct ListChecksQuery {
    limit: Option<i64>,
    offset: Option<i64>,
    /// Optional `match`/`mismatch`/`unverifiable` filter — absent means all
    /// verdicts, newest first. Kept as a plain query param (not a
    /// "mismatches only" default) so the Phase J anomaly watchdog queued
    /// right after this feature — which will likely want to pull
    /// `?verdict=mismatch` specifically — can reuse this same endpoint
    /// instead of this module growing a second, UI-specific read path.
    verdict: Option<String>,
}

#[derive(Serialize)]
struct CheckOut {
    id: String,
    chat_message_id: String,
    tool_call_id: String,
    verdict: String,
    detail: String,
    created_at: String,
}

/// Admin-only, paginated — same `limit`/`offset` + `X-Total-Count` header
/// convention as `observatory::list_snapshots` / `emergence::list_signals` /
/// `simulation::list_runs` / `billing::list_orders`. Deliberately returns a
/// plain, generic row shape (no UI-specific fields baked in) so a future
/// consumer (e.g. the anomaly watchdog) can reuse it as-is.
pub async fn list_checks(State(state): State<AppState>, headers: HeaderMap, Query(q): Query<ListChecksQuery>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let limit = q.limit.unwrap_or(DEFAULT_CHECKS_LIMIT).clamp(1, MAX_CHECKS_LIMIT);
    let offset = q.offset.unwrap_or(0).max(0);
    let verdict_filter = q.verdict.as_deref().filter(|v| matches!(*v, "match" | "mismatch" | "unverifiable"));

    let (total, rows): (i64, Vec<(String, String, String, String, String, String)>) = match verdict_filter {
        Some(v) => {
            let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM hallucination_checks WHERE verdict = ?1")
                .bind(v)
                .fetch_one(&state.db)
                .await
                .unwrap_or(0);
            let rows = sqlx::query_as(
                "SELECT id, chat_message_id, tool_call_id, verdict, detail, created_at FROM hallucination_checks \
                 WHERE verdict = ?1 ORDER BY created_at DESC LIMIT ?2 OFFSET ?3",
            )
            .bind(v)
            .bind(limit)
            .bind(offset)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();
            (total, rows)
        }
        None => {
            let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM hallucination_checks").fetch_one(&state.db).await.unwrap_or(0);
            let rows = sqlx::query_as(
                "SELECT id, chat_message_id, tool_call_id, verdict, detail, created_at FROM hallucination_checks \
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

    let out: Vec<CheckOut> = rows
        .into_iter()
        .map(|(id, chat_message_id, tool_call_id, verdict, detail, created_at)| CheckOut {
            id,
            chat_message_id,
            tool_call_id,
            verdict,
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
            audit_lock: std::sync::Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    async fn seed_tool_call(db: &SqlitePool, id: &str, tool_name: &str, result: &str) {
        sqlx::query(
            "INSERT INTO agent_tool_calls (id, conversation_id, tool_name, arguments, result, status) VALUES (?1,'conv-1',?2,'{}',?3,'ok')",
        )
        .bind(id)
        .bind(tool_name)
        .bind(result)
        .execute(db)
        .await
        .unwrap();
    }

    // ── compare(): pure-function fixtures ───────────────────────────────

    #[test]
    fn compare_matches_when_the_real_id_is_quoted_correctly() {
        let result = r#"{"ok": true, "id": "a1b2c3d4-1111-2222-3333-444455556666", "status": "draft"}"#;
        let text = "Ich habe den Entwurf mit der ID a1b2c3d4-1111-2222-3333-444455556666 angelegt.";
        let (verdict, _) = compare("draft_blog_post", result, text);
        assert_eq!(verdict, Verdict::Match);
    }

    #[test]
    fn compare_mismatches_when_a_different_id_is_quoted() {
        let result = r#"{"ok": true, "id": "a1b2c3d4-1111-2222-3333-444455556666", "status": "draft"}"#;
        let text = "Ich habe den Entwurf mit der ID ffffffff-0000-0000-0000-000000000000 angelegt.";
        let (verdict, detail) = compare("draft_blog_post", result, text);
        assert_eq!(verdict, Verdict::Mismatch);
        assert!(detail.contains("ffffffff-0000-0000-0000-000000000000"));
    }

    #[test]
    fn compare_is_unverifiable_when_no_id_is_quoted_at_all() {
        // The overwhelmingly common real case: a paraphrase with no raw id.
        let result = r#"{"ok": true, "id": "a1b2c3d4-1111-2222-3333-444455556666", "status": "draft"}"#;
        let text = "Ich habe dir einen Blogpost-Entwurf angelegt.";
        let (verdict, _) = compare("draft_blog_post", result, text);
        assert_eq!(verdict, Verdict::Unverifiable, "no id mentioned either way must never be guessed as match or mismatch");
    }

    #[test]
    fn compare_matches_when_a_reported_failure_is_honestly_described() {
        let result = r#"{"ok": false, "error": "refusing to revise a post with status 'published'"}"#;
        let text = "Das hat leider nicht funktioniert — der Post ist schon veröffentlicht.";
        let (verdict, _) = compare("revise_blog_post", result, text);
        assert_eq!(verdict, Verdict::Match);
    }

    #[test]
    fn compare_mismatches_when_a_reported_failure_is_claimed_as_success() {
        // The exact dangerous case this feature exists for: the tool said
        // it did NOT work, the assistant's own text says it did.
        let result = r#"{"ok": false, "error": "refusing to revise a post with status 'published'"}"#;
        let text = "Erledigt — ich habe den Post erfolgreich überarbeitet.";
        let (verdict, detail) = compare("revise_blog_post", result, text);
        assert_eq!(verdict, Verdict::Mismatch);
        assert!(detail.contains("revise_blog_post"));
    }

    #[test]
    fn compare_is_unverifiable_when_failure_framing_is_ambiguous() {
        let result = r#"{"ok": false, "error": "refusing to revise a post with status 'published'"}"#;
        let text = "Ich habe mir den Post nochmal angeschaut.";
        let (verdict, _) = compare("revise_blog_post", result, text);
        assert_eq!(verdict, Verdict::Unverifiable, "neither a success nor a failure claim is present — must not be guessed");
    }

    #[test]
    fn compare_matches_a_correctly_quoted_count() {
        let result = r#"{"views": 42, "unique_visitors": 10, "days": 7}"#;
        let text = "Ihr hattet in den letzten 7 Tagen 42 Seitenaufrufe.";
        let (verdict, _) = compare("get_recent_analytics", result, text);
        assert_eq!(verdict, Verdict::Match);
    }

    #[test]
    fn compare_mismatches_a_wrong_count() {
        let result = r#"{"views": 42, "unique_visitors": 10, "days": 7}"#;
        let text = "Ihr hattet in den letzten 7 Tagen 999 Seitenaufrufe.";
        let (verdict, detail) = compare("get_recent_analytics", result, text);
        assert_eq!(verdict, Verdict::Mismatch);
        assert!(detail.contains("999"));
    }

    #[test]
    fn compare_is_unverifiable_for_a_tool_with_nothing_concretely_comparable() {
        let result = r#"{"ok": true, "field": "hero.title", "value": "Neu"}"#;
        let text = "Ich habe den Hero-Titel aktualisiert.";
        let (verdict, _) = compare("update_content_field", result, text);
        assert_eq!(verdict, Verdict::Unverifiable);
    }

    #[test]
    fn compare_is_unverifiable_on_unparsable_result_json() {
        let (verdict, _) = compare("web_search", "not json", "irgendwas");
        assert_eq!(verdict, Verdict::Unverifiable);
    }

    // ── check_message(): a genuine match/mismatch actually recorded ────

    #[tokio::test]
    async fn check_message_records_a_genuine_match_in_the_db() {
        let state = test_state().await;
        seed_tool_call(
            &state.db,
            "call-match",
            "draft_blog_post",
            r#"{"ok": true, "id": "a1b2c3d4-1111-2222-3333-444455556666", "status": "draft"}"#,
        )
        .await;

        check_message(
            &state,
            "msg-1",
            &["call-match".to_string()],
            "Ich habe den Entwurf mit der ID a1b2c3d4-1111-2222-3333-444455556666 angelegt.",
        )
        .await;

        let row: (String, String) = sqlx::query_as("SELECT verdict, tool_call_id FROM hallucination_checks WHERE chat_message_id = 'msg-1'")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(row.0, "match", "a genuine, correctly-described tool result must be recorded as 'match'");
        assert_eq!(row.1, "call-match");
    }

    #[tokio::test]
    async fn check_message_records_a_genuine_mismatch_in_the_db() {
        let state = test_state().await;
        seed_tool_call(
            &state.db,
            "call-mismatch",
            "revise_blog_post",
            r#"{"ok": false, "error": "refusing to revise a post with status 'published'"}"#,
        )
        .await;

        check_message(
            &state,
            "msg-2",
            &["call-mismatch".to_string()],
            "Erledigt — ich habe den Post erfolgreich überarbeitet.",
        )
        .await;

        let row: (String, String) = sqlx::query_as("SELECT verdict, detail FROM hallucination_checks WHERE chat_message_id = 'msg-2'")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(row.0, "mismatch", "a claim that contradicts the real tool result must be recorded as 'mismatch'");
        assert!(row.1.contains("revise_blog_post"));
    }

    #[tokio::test]
    async fn check_message_is_a_silent_no_op_for_an_empty_tool_call_list() {
        let state = test_state().await;
        check_message(&state, "msg-3", &[], "Ganz normale Antwort ohne Werkzeugaufruf.").await;
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM hallucination_checks").fetch_one(&state.db).await.unwrap();
        assert_eq!(count.0, 0);
    }

    #[tokio::test]
    async fn check_message_never_panics_when_the_referenced_tool_call_row_is_missing() {
        // Simulates log_tool_call's own INSERT having failed (or the id
        // simply not existing) — must degrade to "nothing to check",
        // never panic, never fabricate a verdict.
        let state = test_state().await;
        check_message(&state, "msg-4", &["does-not-exist".to_string()], "Text.").await;
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM hallucination_checks").fetch_one(&state.db).await.unwrap();
        assert_eq!(count.0, 0);
    }

    // ── list_checks: pagination + verdict filter ────────────────────────

    async fn seed_check(db: &SqlitePool, id: &str, msg_id: &str, verdict: &str) {
        sqlx::query("INSERT INTO hallucination_checks (id, chat_message_id, tool_call_id, verdict, detail) VALUES (?1,?2,'call-x',?3,'d')")
            .bind(id)
            .bind(msg_id)
            .bind(verdict)
            .execute(db)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn list_checks_reports_total_count_via_header_and_respects_limit() {
        let state = test_state().await;
        for i in 0..5 {
            seed_check(&state.db, &format!("c{i}"), &format!("m{i}"), "match").await;
        }
        let res = list_checks(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(ListChecksQuery { limit: Some(2), offset: None, verdict: None }),
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
    async fn list_checks_verdict_filter_returns_only_matching_rows() {
        let state = test_state().await;
        seed_check(&state.db, "c1", "m1", "match").await;
        seed_check(&state.db, "c2", "m2", "mismatch").await;
        seed_check(&state.db, "c3", "m3", "unverifiable").await;

        let res = list_checks(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(ListChecksQuery { limit: None, offset: None, verdict: Some("mismatch".to_string()) }),
        )
        .await
        .into_response();
        assert_eq!(res.headers().get("x-total-count").unwrap().to_str().unwrap(), "1");
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body.len(), 1);
        assert_eq!(body[0]["chat_message_id"], "m2");
    }

    #[tokio::test]
    async fn list_checks_requires_admin_auth() {
        let mut state = test_state().await;
        state.chat_secret = "shh".to_string();
        let res = list_checks(AxState(state), HeaderMap::new(), AxQuery(ListChecksQuery { limit: None, offset: None, verdict: None }))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }
}
