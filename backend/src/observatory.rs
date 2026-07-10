use axum::{extract::{Query, State}, http::{HeaderMap, StatusCode}, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{authz::require_admin, AppState};

macro_rules! guard {
    ($state:expr, $headers:expr) => {
        if !require_admin(&$state, &$headers) {
            return StatusCode::UNAUTHORIZED.into_response();
        }
    };
}

/// Truncates free text to a satellite-sized excerpt for SystemMap's
/// drill-down, always on a char boundary — German prose routinely carries
/// multi-byte characters (ü/ß) right at the cut point, and a byte-index
/// slice can panic or split a codepoint. Never pads a short text; only ever
/// shortens a long one, in keeping with SystemMap's own "no fabricated
/// content" ethos.
fn excerpt(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let truncated: String = trimmed.chars().take(max_chars).collect();
    format!("{}…", truncated.trim_end())
}

// ── Behavioral Landscape ─────────────────────────────────────────────────────
// Group patterns in research activity, not individual visitor surveillance:
// research-note category mix, tool-type distribution, conversation-length
// distribution — all real, all aggregate, none of it web-traffic data.
//
// `?range=7d|30d|all` (default 30d) — previously every sub-query here was a
// live/all-time-only snapshot (category_mix and length_distribution had no
// window at all; tool_distribution's 30 days was hardcoded), so there was no
// way to ask "how did behavior look last week" instead of "right now."

/// Stand-in for "no real filter" when `range=all` — bound the same way as
/// every other window below (`datetime('now', '-N days')`), just far enough
/// back that it can never exclude a real row.
const RANGE_ALL_DAYS: i64 = 36_500;

/// Resolves the `?range=` query param to a `(label, days)` pair — the label
/// is echoed back in the response so the frontend selector can confirm what
/// an unrecognized/absent value actually fell back to. Defaults (and falls
/// back) to "30d", matching `tool_distribution`'s pre-existing hardcoded
/// window so the default view doesn't regress for anyone already relying on
/// it.
fn resolve_range(range: Option<&str>) -> (&'static str, i64) {
    match range {
        Some("7d") => ("7d", 7),
        Some("all") => ("all", RANGE_ALL_DAYS),
        _ => ("30d", 30),
    }
}

#[derive(Debug, Deserialize)]
pub struct BehaviorQuery {
    pub range: Option<String>,
}

pub async fn behavior(State(state): State<AppState>, headers: HeaderMap, Query(q): Query<BehaviorQuery>) -> impl IntoResponse {
    guard!(state, headers);
    let db = &state.db;

    let (range_label, range_days) = resolve_range(q.range.as_deref());
    let window = format!("-{range_days} days");

    let category_mix: Vec<(String, i64)> = sqlx::query_as(
        "SELECT category, COUNT(*) FROM research_notes WHERE created_at > datetime('now', ?1) GROUP BY category ORDER BY COUNT(*) DESC"
    ).bind(&window).fetch_all(db).await.unwrap_or_default();

    let tool_distribution: Vec<(String, i64)> = sqlx::query_as(
        "SELECT tool_name, COUNT(*) FROM agent_tool_calls WHERE created_at > datetime('now', ?1) GROUP BY tool_name ORDER BY COUNT(*) DESC"
    ).bind(&window).fetch_all(db).await.unwrap_or_default();

    let length_distribution: Vec<(String, i64)> = sqlx::query_as(
        "SELECT bucket, COUNT(*) FROM (
            SELECT CASE WHEN cnt <= 4 THEN 'kurz' WHEN cnt <= 15 THEN 'mittel' ELSE 'lang' END as bucket
            FROM (SELECT conversation_id, COUNT(*) as cnt FROM chat_messages WHERE created_at > datetime('now', ?1) GROUP BY conversation_id)
        ) GROUP BY bucket"
    ).bind(&window).fetch_all(db).await.unwrap_or_default();

    // Individual recent calls within the same range, not just the aggregate
    // count above — every other consumer of agent_tool_calls so far only
    // ever aggregates, discarding exactly which calls happened and what
    // they touched.
    let recent_tool_calls: Vec<(String, String, Option<String>, Option<String>, String)> = sqlx::query_as(
        "SELECT tool_name, status, conversation_id, result, created_at FROM agent_tool_calls \
         WHERE created_at > datetime('now', ?1) ORDER BY created_at DESC LIMIT 10"
    ).bind(&window).fetch_all(db).await.unwrap_or_default();

    Json(json!({
        "range": range_label,
        "category_mix": category_mix.into_iter().map(|(c,n)| json!({"category":c,"count":n})).collect::<Vec<_>>(),
        "tool_distribution": tool_distribution.into_iter().map(|(t,n)| json!({"tool":t,"count":n})).collect::<Vec<_>>(),
        "length_distribution": length_distribution.into_iter().map(|(b,n)| json!({"bucket":b,"count":n})).collect::<Vec<_>>(),
        "recent_tool_calls": recent_tool_calls.into_iter().map(|(tool_name, status, conversation_id, result, created_at)| json!({
            "tool_name": tool_name,
            "status": status,
            "conversation_id": conversation_id,
            "result": result,
            "created_at": created_at,
        })).collect::<Vec<_>>(),
    })).into_response()
}

// ── Information Dynamics ─────────────────────────────────────────────────────
// Real: chat_documents/chat_chunks corpus growth + chat_retrievals trend —
// knowledge accumulation and how well it's actually getting reused.

/// `?gap_only=true` narrows `recent_retrievals` to just the queries that
/// `is_gap` below already flags — previously `is_gap` was computed and
/// rendered as a per-row pill but had no way to filter *to* just those rows,
/// so a knowledge gap could easily be buried among 9 unrelated normal
/// queries in the capped top-10 feed.
#[derive(Debug, Deserialize)]
pub struct InformationQuery {
    pub gap_only: Option<bool>,
}

pub async fn information(State(state): State<AppState>, headers: HeaderMap, Query(q): Query<InformationQuery>) -> impl IntoResponse {
    guard!(state, headers);
    let db = &state.db;
    let gap_only = q.gap_only.unwrap_or(false);
    let (documents,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_documents").fetch_one(db).await.unwrap_or((0,));
    let (chunks,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_chunks").fetch_one(db).await.unwrap_or((0,));
    let retrieval_by_day: Vec<(String, f64, f64)> = sqlx::query_as(
        "SELECT date(created_at) as day, AVG(top_score), AVG(hit_count) FROM chat_retrievals WHERE created_at > datetime('now','-14 days') GROUP BY day ORDER BY day"
    ).fetch_all(db).await.unwrap_or_default();

    // Real, per-query view of what retrieval actually returned — the daily
    // averages above wash out individual failures. Surfaces genuine
    // knowledge gaps (a query with zero hits, or a top hit too weak to pass
    // chat.rs's own relevance threshold) instead of only ever averaging
    // scores away. Carries id + conversation_id too now: SystemMap's
    // "Information Dynamics" satellites point at one of these specific
    // retrieval events, not just the aggregate count.
    //
    // The `WHERE` predicate below (`hit_count = 0 OR top_score < ?1`) is
    // the same test `is_gap` computes per-row further down — kept as two
    // separate branches (rather than one query with a conditional clause)
    // so the "show everything" path never pays for or binds the threshold
    // at all, and so the `LIMIT 10` applies *after* filtering when
    // `gap_only` is set (the 10 most recent gaps, not the 10 most recent
    // rows of any kind with gaps then filtered out of that page).
    let recent_retrievals: Vec<(String, String, String, f64, i64, String)> = if gap_only {
        sqlx::query_as(
            "SELECT id, conversation_id, query_text, top_score, hit_count, created_at FROM chat_retrievals \
             WHERE hit_count = 0 OR top_score < ?1 ORDER BY created_at DESC LIMIT 10"
        )
        .bind(crate::chat::RETRIEVAL_MIN_SCORE as f64)
        .fetch_all(db).await.unwrap_or_default()
    } else {
        sqlx::query_as(
            "SELECT id, conversation_id, query_text, top_score, hit_count, created_at FROM chat_retrievals ORDER BY created_at DESC LIMIT 10"
        ).fetch_all(db).await.unwrap_or_default()
    };

    // Real uploaded documents, most recent first — backs SystemMap's
    // "Technology" node satellites (chunks are derived from a document, not
    // independently clickable items, so the document itself is the real
    // record to surface).
    let recent_documents: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id, filename, created_at FROM chat_documents ORDER BY created_at DESC LIMIT 5"
    ).fetch_all(db).await.unwrap_or_default();

    Json(json!({
        "documents": documents,
        "chunks": chunks,
        "gap_only": gap_only,
        "retrieval_by_day": retrieval_by_day.into_iter().map(|(day, avg_score, avg_hits)| json!({"day":day,"avg_top_score":avg_score,"avg_hit_count":avg_hits})).collect::<Vec<_>>(),
        "recent_retrievals": recent_retrievals.into_iter().map(|(id, conversation_id, query_text, top_score, hit_count, created_at)| json!({
            "id": id,
            "conversation_id": conversation_id,
            "query_text": query_text,
            "top_score": top_score,
            "hit_count": hit_count,
            "created_at": created_at,
            "is_gap": hit_count == 0 || (top_score as f32) < crate::chat::RETRIEVAL_MIN_SCORE,
        })).collect::<Vec<_>>(),
        "recent_documents": recent_documents.into_iter().map(|(id, filename, created_at)| json!({
            "id": id,
            "filename": filename,
            "created_at": created_at,
        })).collect::<Vec<_>>(),
    })).into_response()
}

// ── Interaction Dynamics (renamed from Human–AI Interaction) ────────────────
// Real: the live token-by-token breakdown anchor stays; latency/confidence
// reframed as pacing/adaptation signals, plus a conversation-length-over-time
// trend for "development over time," not just a raw message tally.

pub async fn human_ai(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    guard!(state, headers);
    let db = &state.db;
    let (user_msgs,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_messages WHERE role='user'").fetch_one(db).await.unwrap_or((0,));
    let (assistant_msgs,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_messages WHERE role='assistant'").fetch_one(db).await.unwrap_or((0,));

    // Real individual user turns, most recent first — backs SystemMap's
    // "Human" node satellites (Laura's own messages, not Jarvis's replies).
    let recent_user_messages: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT id, content, conversation_id, created_at FROM chat_messages WHERE role='user' ORDER BY created_at DESC LIMIT 5"
    ).fetch_all(db).await.unwrap_or_default();

    let messages_by_day: Vec<(String, i64)> = sqlx::query_as(
        "SELECT date(created_at) as day, COUNT(*) FROM chat_messages WHERE created_at > datetime('now','-14 days') GROUP BY day ORDER BY day"
    ).fetch_all(db).await.unwrap_or_default();

    // Mean token-confidence over the most recent assistant messages that
    // actually carry token_info (capped sample to bound compute).
    let recent: Vec<(Option<String>,)> = sqlx::query_as(
        "SELECT token_info FROM chat_messages WHERE role='assistant' AND token_info IS NOT NULL ORDER BY created_at DESC LIMIT 50"
    ).fetch_all(db).await.unwrap_or_default();
    let mut prob_sum = 0.0f64;
    let mut prob_count = 0usize;
    for (info,) in recent {
        if let Some(info) = info {
            if let Ok(tokens) = serde_json::from_str::<Vec<serde_json::Value>>(&info) {
                for t in tokens {
                    if let Some(p) = t.get("probability").and_then(|v| v.as_f64()) {
                        prob_sum += p;
                        prob_count += 1;
                    }
                }
            }
        }
    }
    let mean_confidence = if prob_count > 0 { Some(prob_sum / prob_count as f64) } else { None };

    // Average latency between a user message and the next assistant message
    // in the same conversation (paired by proximity, not by id linkage) —
    // read as pacing, not a raw performance metric.
    let pairs: Vec<(String,String,String,String)> = sqlx::query_as(
        "SELECT a.conversation_id, a.created_at, b.role, b.created_at FROM chat_messages a
         JOIN chat_messages b ON b.conversation_id = a.conversation_id AND b.created_at > a.created_at
         WHERE a.role='user' AND b.role='assistant'
         AND b.created_at = (SELECT MIN(c.created_at) FROM chat_messages c WHERE c.conversation_id = a.conversation_id AND c.created_at > a.created_at AND c.role='assistant')
         ORDER BY a.created_at DESC LIMIT 100"
    ).fetch_all(db).await.unwrap_or_default();
    let latencies: Vec<f64> = pairs.iter().filter_map(|(_, user_ts, _, asst_ts)| {
        let u = chrono::NaiveDateTime::parse_from_str(user_ts, "%Y-%m-%d %H:%M:%S").ok()?;
        let a = chrono::NaiveDateTime::parse_from_str(asst_ts, "%Y-%m-%d %H:%M:%S").ok()?;
        Some((a - u).num_milliseconds() as f64 / 1000.0)
    }).filter(|s| *s >= 0.0).collect();
    let mean_latency_s = if !latencies.is_empty() { Some(latencies.iter().sum::<f64>() / latencies.len() as f64) } else { None };

    // The module anchors around this: the actual token-by-token breakdown of
    // the most recent reply, not just an averaged number.
    let latest: Option<(String, String, String)> = sqlx::query_as(
        "SELECT content, token_info, created_at FROM chat_messages WHERE role='assistant' AND token_info IS NOT NULL ORDER BY created_at DESC LIMIT 1"
    ).fetch_optional(db).await.unwrap_or(None);
    let (latest_reply, latest_tokens, latest_at) = match latest {
        Some((content, token_info, created_at)) => (
            Some(content),
            serde_json::from_str::<serde_json::Value>(&token_info).ok(),
            Some(created_at),
        ),
        None => (None, None, None),
    };

    Json(json!({
        "user_messages": user_msgs,
        "assistant_messages": assistant_msgs,
        "messages_by_day": messages_by_day.into_iter().map(|(day,count)| json!({"day":day,"count":count})).collect::<Vec<_>>(),
        "mean_token_confidence": mean_confidence,
        "mean_latency_seconds": mean_latency_s,
        "latency_sample_size": latencies.len(),
        "latest_reply": latest_reply,
        "latest_tokens": latest_tokens,
        "latest_at": latest_at,
        "recent_user_messages": recent_user_messages.into_iter().map(|(id, content, conversation_id, created_at)| json!({
            "id": id,
            "excerpt": excerpt(&content, 90),
            "conversation_id": conversation_id,
            "created_at": created_at,
        })).collect::<Vec<_>>(),
    })).into_response()
}

// ── Scope trends (System State citing real Interaction Dynamics data) ──────
// For each scope emergence_signals has observed, the message-volume trend
// of the specific conversations that scope's signals came from — a real,
// computed "this system's interaction volume is up/down" figure, not an
// invented one. Lets System State's narrative cite an actual Interaction
// Dynamics number inline instead of the two modules staying disconnected.

pub async fn scope_trends(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    guard!(state, headers);
    let db = &state.db;

    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT DISTINCT scope, source_conversation_id FROM emergence_signals WHERE scope IS NOT NULL AND source_conversation_id IS NOT NULL"
    ).fetch_all(db).await.unwrap_or_default();

    let mut by_scope: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for (scope, conv_id) in rows {
        by_scope.entry(scope).or_default().push(conv_id);
    }

    let mut out = Vec::new();
    for (scope, conv_ids) in by_scope {
        let placeholders: Vec<String> = (1..=conv_ids.len()).map(|i| format!("?{i}")).collect();
        let in_clause = placeholders.join(",");

        let recent_sql = format!(
            "SELECT COUNT(*) FROM chat_messages WHERE conversation_id IN ({in_clause}) AND created_at > datetime('now','-7 days')"
        );
        let mut q = sqlx::query_as::<_, (i64,)>(&recent_sql);
        for id in &conv_ids { q = q.bind(id); }
        let (messages_7d,): (i64,) = q.fetch_one(db).await.unwrap_or((0,));

        let prev_sql = format!(
            "SELECT COUNT(*) FROM chat_messages WHERE conversation_id IN ({in_clause}) AND created_at > datetime('now','-14 days') AND created_at <= datetime('now','-7 days')"
        );
        let mut q2 = sqlx::query_as::<_, (i64,)>(&prev_sql);
        for id in &conv_ids { q2 = q2.bind(id); }
        let (messages_prev_7d,): (i64,) = q2.fetch_one(db).await.unwrap_or((0,));

        out.push(json!({
            "scope": scope,
            "conversation_count": conv_ids.len(),
            "messages_7d": messages_7d,
            "messages_prev_7d": messages_prev_7d,
        }));
    }

    Json(out).into_response()
}

// ── AI Activity (SystemMap "AI Systems" node drill-down) ────────────────────
// Real individual items backing the aggregate "ai" count in SystemMap.tsx
// (assistant messages + tool calls): two unrelated tables, merged into one
// recency-sorted feed capped at 5, so a satellite can point at an actual
// reply or an actual tool invocation instead of just a bigger number.

#[derive(Serialize)]
pub struct AiActivityItem {
    id: String,
    kind: String,
    label: String,
    status: Option<String>,
    conversation_id: Option<String>,
    created_at: String,
}

fn merge_recent_ai_activity(
    messages: Vec<(String, String, Option<String>, String)>,
    tool_calls: Vec<(String, String, String, Option<String>, String)>,
) -> Vec<AiActivityItem> {
    let mut items: Vec<AiActivityItem> = Vec::new();
    items.extend(messages.into_iter().map(|(id, content, conversation_id, created_at)| AiActivityItem {
        id, kind: "message".to_string(), label: excerpt(&content, 90), status: None, conversation_id, created_at,
    }));
    items.extend(tool_calls.into_iter().map(|(id, tool_name, status, conversation_id, created_at)| AiActivityItem {
        id, kind: "tool_call".to_string(), label: tool_name, status: Some(status), conversation_id, created_at,
    }));
    items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    items.truncate(5);
    items
}

pub async fn ai_activity(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    guard!(state, headers);
    let db = &state.db;

    let messages: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT id, content, conversation_id, created_at FROM chat_messages WHERE role='assistant' ORDER BY created_at DESC LIMIT 5"
    ).fetch_all(db).await.unwrap_or_default();

    let tool_calls: Vec<(String, String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT id, tool_name, status, conversation_id, created_at FROM agent_tool_calls ORDER BY created_at DESC LIMIT 5"
    ).fetch_all(db).await.unwrap_or_default();

    let items = merge_recent_ai_activity(
        messages.into_iter().map(|(id, content, conversation_id, created_at)| (id, content, Some(conversation_id), created_at)).collect(),
        tool_calls,
    );
    Json(items).into_response()
}

// ── Organization (SystemMap "Organization" node drill-down) ────────────────
// Real individual items backing the aggregate "organization" count (research
// notes + blog drafts + simulation runs): three separate tables with no
// shared schema, merged the same way analytics.rs's own recent_activity feed
// already does for its own purposes — sorted by recency, capped at 5.

#[derive(Serialize)]
pub struct OrganizationItem {
    id: String,
    kind: String,
    title: String,
    conversation_id: Option<String>,
    created_at: String,
}

fn merge_recent_organization_items(
    notes: Vec<(String, String, Option<String>, String)>,
    posts: Vec<(String, String, Option<String>, String)>,
    runs: Vec<(String, String, String)>,
) -> Vec<OrganizationItem> {
    let mut items: Vec<OrganizationItem> = Vec::new();
    items.extend(notes.into_iter().map(|(id, title, conversation_id, created_at)| OrganizationItem {
        id, kind: "research_note".to_string(), title, conversation_id, created_at,
    }));
    items.extend(posts.into_iter().map(|(id, title, conversation_id, created_at)| OrganizationItem {
        id, kind: "blog_post".to_string(), title, conversation_id, created_at,
    }));
    items.extend(runs.into_iter().map(|(id, hypothesis, created_at)| OrganizationItem {
        id, kind: "simulation_run".to_string(), title: hypothesis, conversation_id: None, created_at,
    }));
    items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    items.truncate(5);
    items
}

pub async fn organization(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    guard!(state, headers);
    let db = &state.db;

    let notes: Vec<(String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT id, title, source_conversation_id, created_at FROM research_notes ORDER BY created_at DESC LIMIT 5"
    ).fetch_all(db).await.unwrap_or_default();

    let posts: Vec<(String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT id, title, source_conversation_id, created_at FROM blog_posts ORDER BY created_at DESC LIMIT 5"
    ).fetch_all(db).await.unwrap_or_default();

    let runs: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id, hypothesis, created_at FROM simulation_runs ORDER BY created_at DESC LIMIT 5"
    ).fetch_all(db).await.unwrap_or_default();

    Json(merge_recent_organization_items(notes, posts, runs)).into_response()
}

// ── System Diagnostics (folded into the bottom of System State) ────────────
// Real: config presence flags, agent error rate, DB reachability. No longer
// its own nav item — this is the "Technology" side of the system under
// observation, not a separate business/CMS concern.

pub async fn diagnostics(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    guard!(state, headers);
    let db = &state.db;
    let db_ok = sqlx::query_as::<_, (i64,)>("SELECT 1").fetch_one(db).await.is_ok();
    let (agent_calls_total,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM agent_tool_calls WHERE created_at > datetime('now','-7 days')").fetch_one(db).await.unwrap_or((0,));
    let (agent_calls_error,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM agent_tool_calls WHERE status != 'ok' AND created_at > datetime('now','-7 days')").fetch_one(db).await.unwrap_or((0,));

    Json(json!({
        "db_reachable": db_ok,
        "nvidia_api_key_configured": !state.nvidia_api_key.is_empty(),
        "chat_secret_configured": !state.chat_secret.is_empty(),
        "agent_tool_calls_7d": agent_calls_total,
        "agent_tool_call_errors_7d": agent_calls_error,
    })).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::{Query as AxQuery, State as AxState};
    use std::{
        collections::HashMap,
        path::PathBuf,
        sync::{atomic::AtomicU64, atomic::AtomicUsize, Arc, RwLock},
    };

    async fn test_state() -> AppState {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::chat::init_schema(&db).await;
        crate::research::init_schema(&db).await;
        crate::agent::init_schema(&db).await;
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
            ddg_api_base: "https://api.duckduckgo.com".to_string(),
            chat_model_idx: Arc::new(AtomicUsize::new(0)),
            chat_request_count: Arc::new(AtomicU64::new(0)),
            github_token: String::new(),
            github_api_base: "https://api.github.com".to_string(),
        }
    }

    // ── resolve_range (pure) ────────────────────────────────────────────────

    #[test]
    fn resolve_range_defaults_to_30d_for_none_and_unrecognized() {
        assert_eq!(resolve_range(None), ("30d", 30));
        assert_eq!(resolve_range(Some("")), ("30d", 30));
        assert_eq!(resolve_range(Some("90d")), ("30d", 30));
    }

    #[test]
    fn resolve_range_recognizes_7d_and_all() {
        assert_eq!(resolve_range(Some("7d")), ("7d", 7));
        assert_eq!(resolve_range(Some("all")), ("all", RANGE_ALL_DAYS));
    }

    // ── behavior: range actually filters, not just accepted-and-ignored ────

    #[tokio::test]
    async fn behavior_7d_range_excludes_older_research_notes_and_tool_calls() {
        let state = test_state().await;
        sqlx::query("INSERT INTO research_notes (id, category, title, body, created_at) VALUES ('n_new','idea','New','B', datetime('now'))")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO research_notes (id, category, title, body, created_at) VALUES ('n_old','idea','Old','B', datetime('now','-20 days'))")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO agent_tool_calls (id, tool_name, arguments, status, created_at) VALUES ('t_new','log_research_note','{}','ok', datetime('now'))")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO agent_tool_calls (id, tool_name, arguments, status, created_at) VALUES ('t_old','log_research_note','{}','ok', datetime('now','-20 days'))")
            .execute(&state.db).await.unwrap();

        let res = behavior(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(BehaviorQuery { range: Some("7d".to_string()) }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), axum::http::StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(body["range"], "7d");
        let category_total: i64 = body["category_mix"].as_array().unwrap().iter().map(|b| b["count"].as_i64().unwrap()).sum();
        assert_eq!(category_total, 1, "the 20-day-old research note must not count under range=7d: {body}");
        let tool_total: i64 = body["tool_distribution"].as_array().unwrap().iter().map(|b| b["count"].as_i64().unwrap()).sum();
        assert_eq!(tool_total, 1, "the 20-day-old tool call must not count under range=7d: {body}");
        assert_eq!(body["recent_tool_calls"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn behavior_all_range_includes_everything() {
        let state = test_state().await;
        sqlx::query("INSERT INTO research_notes (id, category, title, body, created_at) VALUES ('n_old','idea','Old','B', datetime('now','-400 days'))")
            .execute(&state.db).await.unwrap();

        let res = behavior(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(BehaviorQuery { range: Some("all".to_string()) }),
        )
        .await
        .into_response();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(body["range"], "all");
        let category_total: i64 = body["category_mix"].as_array().unwrap().iter().map(|b| b["count"].as_i64().unwrap()).sum();
        assert_eq!(category_total, 1, "range=all must reach even a 400-day-old note: {body}");
    }

    #[tokio::test]
    async fn behavior_default_range_matches_the_old_hardcoded_30_day_window() {
        let state = test_state().await;
        sqlx::query("INSERT INTO agent_tool_calls (id, tool_name, arguments, status, created_at) VALUES ('t_29','log_research_note','{}','ok', datetime('now','-29 days'))")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO agent_tool_calls (id, tool_name, arguments, status, created_at) VALUES ('t_31','log_research_note','{}','ok', datetime('now','-31 days'))")
            .execute(&state.db).await.unwrap();

        let res = behavior(AxState(state.clone()), HeaderMap::new(), AxQuery(BehaviorQuery { range: None })).await.into_response();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(body["range"], "30d");
        let tool_total: i64 = body["tool_distribution"].as_array().unwrap().iter().map(|b| b["count"].as_i64().unwrap()).sum();
        assert_eq!(tool_total, 1, "no explicit range must preserve the historical 30-day tool_distribution window: {body}");
    }

    // ── information: gap_only actually filters, not just accepted ──────────

    async fn insert_retrieval(db: &sqlx::SqlitePool, id: &str, query_text: &str, top_score: f64, hit_count: i64) {
        sqlx::query("INSERT INTO chat_retrievals (id, conversation_id, query_text, top_score, hit_count) VALUES (?1,'c1',?2,?3,?4)")
            .bind(id).bind(query_text).bind(top_score).bind(hit_count)
            .execute(db).await.unwrap();
    }

    #[tokio::test]
    async fn information_gap_only_filters_to_zero_hits_or_below_threshold() {
        let state = test_state().await;
        // Real hit, well above RETRIEVAL_MIN_SCORE (0.15).
        insert_retrieval(&state.db, "r_good", "gute Anfrage", 0.72, 3).await;
        // Zero hits at all — a gap.
        insert_retrieval(&state.db, "r_zero", "keine Treffer", 0.0, 0).await;
        // A hit, but too weak to pass the relevance threshold — also a gap.
        insert_retrieval(&state.db, "r_weak", "schwacher Treffer", 0.05, 1).await;

        let res = information(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(InformationQuery { gap_only: Some(true) }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), axum::http::StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(body["gap_only"], true);
        let rows = body["recent_retrievals"].as_array().unwrap();
        assert_eq!(rows.len(), 2, "only the zero-hit and below-threshold rows must survive gap_only=true: {body}");
        let ids: std::collections::HashSet<&str> = rows.iter().map(|r| r["id"].as_str().unwrap()).collect();
        assert!(ids.contains("r_zero"));
        assert!(ids.contains("r_weak"));
        assert!(!ids.contains("r_good"), "a real, above-threshold hit must not appear under gap_only=true: {body}");
        assert!(rows.iter().all(|r| r["is_gap"] == true), "every returned row must itself be flagged is_gap: {body}");
    }

    #[tokio::test]
    async fn information_without_gap_only_returns_everything() {
        let state = test_state().await;
        insert_retrieval(&state.db, "r_good", "gute Anfrage", 0.72, 3).await;
        insert_retrieval(&state.db, "r_zero", "keine Treffer", 0.0, 0).await;

        let res = information(AxState(state.clone()), HeaderMap::new(), AxQuery(InformationQuery { gap_only: None })).await.into_response();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(body["gap_only"], false);
        assert_eq!(body["recent_retrievals"].as_array().unwrap().len(), 2, "the default (no filter) view must still show every row: {body}");
    }

    #[test]
    fn excerpt_leaves_short_text_untouched() {
        assert_eq!(excerpt("Kurzer Text", 90), "Kurzer Text");
    }

    #[test]
    fn excerpt_truncates_long_text_on_a_char_boundary_with_ellipsis() {
        // German prose routinely carries multi-byte characters (ü/ß) right
        // at the truncation point — this must never panic or split a
        // codepoint, and must never silently pad a short text either.
        let text = "Die Übertragung überschritt die üblichen Größenordnungen deutlich, mehr als erwartet";
        let out = excerpt(text, 20);
        assert!(out.ends_with('…'), "expected an ellipsis marker, got {out:?}");
        assert_eq!(out.chars().count(), 21); // 20 kept chars + the ellipsis marker
    }

    #[test]
    fn merge_recent_ai_activity_sorts_messages_and_tool_calls_by_recency() {
        let messages = vec![
            ("m1".to_string(), "erste Antwort".to_string(), Some("c1".to_string()), "2026-07-08 10:00:00".to_string()),
            ("m2".to_string(), "zweite Antwort".to_string(), Some("c1".to_string()), "2026-07-10 09:00:00".to_string()),
        ];
        let tool_calls = vec![
            ("t1".to_string(), "log_research_note".to_string(), "ok".to_string(), Some("c1".to_string()), "2026-07-09 12:00:00".to_string()),
        ];
        let items = merge_recent_ai_activity(messages, tool_calls);
        assert_eq!(items.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), vec!["m2", "t1", "m1"]);
    }

    #[test]
    fn merge_recent_ai_activity_caps_at_five_items_newest_first() {
        let messages: Vec<_> = (0..6).map(|i| (
            format!("m{i}"), format!("Antwort {i}"), Some("c1".to_string()), format!("2026-07-{:02} 10:00:00", i + 1),
        )).collect();
        let items = merge_recent_ai_activity(messages, vec![]);
        assert_eq!(items.len(), 5);
        assert_eq!(items[0].id, "m5"); // newest of the six survives the cap
    }

    #[test]
    fn merge_recent_organization_items_sorts_across_all_three_sources() {
        let notes = vec![("n1".to_string(), "Note".to_string(), None, "2026-07-08 08:00:00".to_string())];
        let posts = vec![("p1".to_string(), "Post".to_string(), Some("c2".to_string()), "2026-07-10 08:00:00".to_string())];
        let runs = vec![("r1".to_string(), "Hypothese".to_string(), "2026-07-09 08:00:00".to_string())];
        let items = merge_recent_organization_items(notes, posts, runs);
        assert_eq!(items.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), vec!["p1", "r1", "n1"]);
        assert_eq!(items[0].kind, "blog_post");
        assert_eq!(items[1].kind, "simulation_run");
        assert_eq!(items[2].kind, "research_note");
    }

    #[test]
    fn merge_recent_organization_items_caps_at_five_items() {
        let notes: Vec<_> = (0..7).map(|i| (
            format!("n{i}"), format!("Note {i}"), None, format!("2026-07-{:02} 08:00:00", i + 1),
        )).collect();
        let items = merge_recent_organization_items(notes, vec![], vec![]);
        assert_eq!(items.len(), 5);
        assert_eq!(items[0].id, "n6");
    }
}
