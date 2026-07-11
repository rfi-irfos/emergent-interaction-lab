use axum::{extract::{Query, State}, http::{HeaderMap, HeaderValue, StatusCode}, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::SqlitePool;
use uuid::Uuid;

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

// ── Flight Recorder (system_snapshots) ──────────────────────────────────────
// One row captured automatically right after every completed chat turn (see
// chat.rs::stream_chat's existing CCET spawn — `record_ccet_turn` /
// `capture_system_snapshot` are chained inside the SAME `tokio::spawn`, never
// a second one) — a typed, whole-system rollup at that exact moment: signal
// counts by level, CEI/CEP/Resonance-Frequency, simulation run counts by
// status, research notes total, and recent tool-call activity.
//
// Typed columns, not a JSON blob: matches every other table in this codebase
// (ccet_turns, simulation_runs, emergence_signals, orders, ...) and lets
// `list_snapshots` below filter/aggregate/select individual fields with
// plain SQL instead of every reader having to parse a JSON blob just to read
// one number. A blob would also make the historical schema silently
// unversioned — a typed column that's always been there is either present
// or (via `ALTER TABLE ... ADD COLUMN`, this codebase's own established
// additive-migration convention — see e.g. emergence_signals.level) added
// explicitly, never a key that may or may not exist inside opaque JSON.
//
// Best-effort only, by hard requirement: `capture_system_snapshot` is always
// invoked from a `tokio::spawn`'d background task (see the call site in
// chat.rs), and every failure inside it degrades to a logged warning — see
// its own doc comment below for why, given the real 2026-07-10 production
// outage chat.rs documents at the top of that file (a hung, un-timed-out
// await on the hot chat path took the whole app down; this table's capture
// must never become a second way for that to happen).

pub async fn init_schema(db: &SqlitePool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS system_snapshots (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            trigger_turn_id TEXT,
            signals_human INTEGER NOT NULL DEFAULT 0,
            signals_ai INTEGER NOT NULL DEFAULT 0,
            signals_interaction INTEGER NOT NULL DEFAULT 0,
            signals_system INTEGER NOT NULL DEFAULT 0,
            cei REAL NOT NULL DEFAULT 0,
            cep INTEGER NOT NULL DEFAULT 0,
            resonance_frequency REAL NOT NULL DEFAULT 0,
            sim_runs_pending INTEGER NOT NULL DEFAULT 0,
            sim_runs_complete INTEGER NOT NULL DEFAULT 0,
            sim_runs_error INTEGER NOT NULL DEFAULT 0,
            research_notes_total INTEGER NOT NULL DEFAULT 0,
            agent_tool_calls_7d INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create system_snapshots");
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_ss_created ON system_snapshots(created_at)")
        .execute(db)
        .await
        .ok();
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_ss_conv ON system_snapshots(conversation_id, created_at)")
        .execute(db)
        .await
        .ok();
}

/// Public (crate-visible) entry point — always called from a `tokio::spawn`
/// at the call site (chat.rs), never awaited on the chat response's own
/// path. Swallows every possible failure (a missing table on a DB that
/// hasn't run this module's `init_schema` yet, a lock contention hiccup, a
/// malformed row read elsewhere in the same connection pool — anything) into
/// a single logged warning, matching the graceful-degradation convention
/// this codebase already uses elsewhere for a non-critical background
/// dependency (see e.g. `billing::stripe_webhook`'s missing-secret handling,
/// or the NVIDIA connect/stream timeouts in chat.rs) rather than letting an
/// `Err` or a panic propagate anywhere near the request that triggered it.
pub async fn capture_system_snapshot(state: &AppState, conversation_id: &str, trigger_turn_id: Option<String>) {
    if let Err(e) = try_capture_system_snapshot(state, conversation_id, trigger_turn_id).await {
        tracing::warn!(
            "system snapshot capture failed for conversation {conversation_id} (non-fatal — the chat turn itself already completed): {e}"
        );
    }
}

/// Does the actual work, `?`-propagating any `sqlx::Error` up to the
/// warning-logging wrapper above instead of each query separately
/// swallowing its own failure with `.unwrap_or_default()` (the convention
/// every *read*-only handler in this file uses) — deliberately different
/// here because a partially-written row (e.g. real signal counts but a
/// silently-zeroed research-notes count because that one query alone
/// failed) would be a subtler, harder-to-notice honesty violation than
/// simply not writing the row at all this one time. The next turn tries
/// again regardless.
async fn try_capture_system_snapshot(
    state: &AppState,
    conversation_id: &str,
    trigger_turn_id: Option<String>,
) -> Result<(), sqlx::Error> {
    let db = &state.db;

    // Signal counts by level — same 4-way split/query shape as
    // `public::signal_levels` (emergence_signals.level's own CHECK
    // constraint: human/ai/interaction/system).
    let level_rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT level, COUNT(*) FROM emergence_signals GROUP BY level")
            .fetch_all(db)
            .await?;
    let mut signals_human = 0i64;
    let mut signals_ai = 0i64;
    let mut signals_interaction = 0i64;
    let mut signals_system = 0i64;
    for (level, count) in level_rows {
        match level.as_str() {
            "human" => signals_human = count,
            "ai" => signals_ai = count,
            "interaction" => signals_interaction = count,
            "system" => signals_system = count,
            _ => {}
        }
    }

    // CEI/CEP/Resonance-Frequency — reuses the exact query + pure functions
    // `chat::ccet_summary` itself uses (see `chat::current_ccet_metrics`),
    // never re-embedding or re-calling NVIDIA. Includes whatever turn
    // `record_ccet_turn` just inserted, since the caller (chat.rs's spawn)
    // awaits that first.
    let (cei, cep, resonance_frequency, _turns_considered) = crate::chat::current_ccet_metrics(db).await;

    // Simulation run counts by status — same 3-way split/query shape as
    // `public::simulation_status` (pending/complete/error).
    let status_rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT status, COUNT(*) FROM simulation_runs GROUP BY status")
            .fetch_all(db)
            .await?;
    let mut sim_runs_pending = 0i64;
    let mut sim_runs_complete = 0i64;
    let mut sim_runs_error = 0i64;
    for (status, count) in status_rows {
        match status.as_str() {
            "pending" => sim_runs_pending = count,
            "complete" => sim_runs_complete = count,
            "error" => sim_runs_error = count,
            _ => {}
        }
    }

    let research_notes_total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM research_notes")
        .fetch_one(db)
        .await?;

    // Same trailing 7-day window `analytics.rs`'s own `agent_tool_calls_7d`
    // already uses — reused verbatim rather than inventing a different
    // window for what is, on the dashboard, the same-labeled figure.
    let agent_tool_calls_7d: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM agent_tool_calls WHERE created_at > datetime('now','-7 days')")
            .fetch_one(db)
            .await?;

    sqlx::query(
        "INSERT INTO system_snapshots (
            id, conversation_id, trigger_turn_id,
            signals_human, signals_ai, signals_interaction, signals_system,
            cei, cep, resonance_frequency,
            sim_runs_pending, sim_runs_complete, sim_runs_error,
            research_notes_total, agent_tool_calls_7d
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(conversation_id)
    .bind(trigger_turn_id)
    .bind(signals_human)
    .bind(signals_ai)
    .bind(signals_interaction)
    .bind(signals_system)
    .bind(cei as f64)
    .bind(cep as i64)
    .bind(resonance_frequency as f64)
    .bind(sim_runs_pending)
    .bind(sim_runs_complete)
    .bind(sim_runs_error)
    .bind(research_notes_total)
    .bind(agent_tool_calls_7d)
    .execute(db)
    .await?;

    Ok(())
}

#[derive(Serialize)]
pub struct SnapshotOut {
    id: String,
    conversation_id: String,
    trigger_turn_id: Option<String>,
    signals_human: i64,
    signals_ai: i64,
    signals_interaction: i64,
    signals_system: i64,
    cei: f64,
    cep: i64,
    resonance_frequency: f64,
    sim_runs_pending: i64,
    sim_runs_complete: i64,
    sim_runs_error: i64,
    research_notes_total: i64,
    agent_tool_calls_7d: i64,
    created_at: String,
}

type SnapshotRow = (
    String,
    String,
    Option<String>,
    i64,
    i64,
    i64,
    i64,
    f64,
    i64,
    f64,
    i64,
    i64,
    i64,
    i64,
    i64,
    String,
);
fn snapshot_to_out(r: SnapshotRow) -> SnapshotOut {
    SnapshotOut {
        id: r.0,
        conversation_id: r.1,
        trigger_turn_id: r.2,
        signals_human: r.3,
        signals_ai: r.4,
        signals_interaction: r.5,
        signals_system: r.6,
        cei: r.7,
        cep: r.8,
        resonance_frequency: r.9,
        sim_runs_pending: r.10,
        sim_runs_complete: r.11,
        sim_runs_error: r.12,
        research_notes_total: r.13,
        agent_tool_calls_7d: r.14,
        created_at: r.15,
    }
}

// Same page-size convention as emergence.rs's list_signals /
// simulation.rs's list_runs.
const DEFAULT_SNAPSHOTS_LIMIT: i64 = 50;
const MAX_SNAPSHOTS_LIMIT: i64 = 200;

#[derive(Deserialize)]
pub struct ListSnapshotsQuery {
    limit: Option<i64>,
    offset: Option<i64>,
    /// `?range=7d|30d|all` — reuses `resolve_range` above verbatim (same
    /// values, same "30d" default, same RANGE_ALL_DAYS stand-in for "no
    /// filter") rather than inventing a second, subtly different range
    /// convention for the one other module in this file that filters by
    /// time window.
    range: Option<String>,
}

/// Admin-only, paginated — same `limit`/`offset` + `X-Total-Count` header
/// convention as `emergence::list_signals` / `simulation::list_runs` /
/// `billing::list_orders`: a flat, newest-first array, with the true total
/// (matching the active `?range=` filter, ignoring limit/offset) surfaced
/// via the response header so the frontend's "Weitere laden" can know how
/// much more there is without ever fetching the full table. This is the
/// actual "flight recorder" read path: every row here is a real, typed
/// rollup captured at real turn-completion time — never a placeholder, never
/// synthesized for a turn that predates this feature (older conversations
/// simply have no snapshot history).
pub async fn list_snapshots(State(state): State<AppState>, headers: HeaderMap, Query(q): Query<ListSnapshotsQuery>) -> impl IntoResponse {
    guard!(state, headers);
    let db = &state.db;
    let limit = q.limit.unwrap_or(DEFAULT_SNAPSHOTS_LIMIT).clamp(1, MAX_SNAPSHOTS_LIMIT);
    let offset = q.offset.unwrap_or(0).max(0);
    let (_, range_days) = resolve_range(q.range.as_deref());
    let window = format!("-{range_days} days");

    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM system_snapshots WHERE created_at > datetime('now', ?1)")
        .bind(&window)
        .fetch_one(db)
        .await
        .unwrap_or(0);

    let rows: Vec<SnapshotRow> = sqlx::query_as(
        "SELECT id, conversation_id, trigger_turn_id, signals_human, signals_ai, signals_interaction, signals_system, \
         cei, cep, resonance_frequency, sim_runs_pending, sim_runs_complete, sim_runs_error, research_notes_total, \
         agent_tool_calls_7d, created_at \
         FROM system_snapshots WHERE created_at > datetime('now', ?1) ORDER BY created_at DESC LIMIT ?2 OFFSET ?3",
    )
    .bind(&window)
    .bind(limit)
    .bind(offset)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let mut resp = Json(rows.into_iter().map(snapshot_to_out).collect::<Vec<_>>()).into_response();
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
        sync::{atomic::AtomicU64, atomic::AtomicUsize, Arc, RwLock},
    };

    async fn test_state() -> AppState {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::chat::init_schema(&db).await;
        crate::research::init_schema(&db).await;
        crate::agent::init_schema(&db).await;
        crate::emergence::init_schema(&db).await;
        crate::simulation::init_schema(&db).await;
        init_schema(&db).await; // system_snapshots (this module)
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

    // ── Flight recorder: capture_system_snapshot correctness ───────────────

    async fn insert_signal(db: &sqlx::SqlitePool, level: &str) {
        sqlx::query("INSERT INTO emergence_signals (id, pattern, level, status, confidence, evolution, observation) VALUES (?1,'p',?2,'emerging','moderate','steady','o')")
            .bind(Uuid::new_v4().to_string())
            .bind(level)
            .execute(db)
            .await
            .unwrap();
    }

    async fn insert_sim_run(db: &sqlx::SqlitePool, status: &str) {
        sqlx::query("INSERT INTO simulation_runs (id, hypothesis, status) VALUES (?1,'h',?2)")
            .bind(Uuid::new_v4().to_string())
            .bind(status)
            .execute(db)
            .await
            .unwrap();
    }

    async fn insert_research_note(db: &sqlx::SqlitePool, title: &str) {
        sqlx::query("INSERT INTO research_notes (id, category, title, body) VALUES (?1,'idea',?2,'b')")
            .bind(Uuid::new_v4().to_string())
            .bind(title)
            .execute(db)
            .await
            .unwrap();
    }

    async fn insert_tool_call(db: &sqlx::SqlitePool, days_ago: i64) {
        sqlx::query("INSERT INTO agent_tool_calls (id, tool_name, arguments, status, created_at) VALUES (?1,'log_research_note','{}','ok', datetime('now', ?2))")
            .bind(Uuid::new_v4().to_string())
            .bind(format!("-{days_ago} days"))
            .execute(db)
            .await
            .unwrap();
    }

    async fn insert_ccet_turn(db: &sqlx::SqlitePool, conversation_id: &str, stable: i64) {
        sqlx::query("INSERT INTO ccet_turns (id, conversation_id, embedding, similarity_to_prev, stable, prev_stable, terms_reused) VALUES (?1,?2,?3,0.9,?4,1,0)")
            .bind(Uuid::new_v4().to_string())
            .bind(conversation_id)
            .bind(vec![0u8, 1, 2, 3])
            .bind(stable)
            .execute(db)
            .await
            .unwrap();
    }

    /// The core correctness test: seeds every source table this rollup reads
    /// (emergence_signals, simulation_runs, research_notes, agent_tool_calls,
    /// ccet_turns) with a deliberately non-uniform mix, calls
    /// `capture_system_snapshot` once, and asserts every single column of
    /// the resulting row against hand-computed expected values — right
    /// counts, right CEI, not just "a row exists."
    #[tokio::test]
    async fn capture_system_snapshot_writes_a_correct_whole_system_rollup() {
        let state = test_state().await;

        // Signals: 2 human, 1 ai, 0 interaction, 3 system.
        for level in ["human", "human", "ai", "system", "system", "system"] {
            insert_signal(&state.db, level).await;
        }

        // Simulation runs: 1 pending, 2 complete, 1 error.
        for status in ["pending", "complete", "complete", "error"] {
            insert_sim_run(&state.db, status).await;
        }

        // Research notes: 5 total.
        for i in 0..5 {
            insert_research_note(&state.db, &format!("n{i}")).await;
        }

        // Tool calls: 2 inside the trailing 7-day window, 1 well outside it.
        insert_tool_call(&state.db, 0).await;
        insert_tool_call(&state.db, 1).await;
        insert_tool_call(&state.db, 10).await;

        // CCET turns: 3 stable, 1 not -> CEI = 0.75.
        for stable in [1i64, 1, 1, 0] {
            insert_ccet_turn(&state.db, "conv-x", stable).await;
        }

        capture_system_snapshot(&state, "conv-x", Some("trigger-turn-1".to_string())).await;

        let row: SnapshotRow = sqlx::query_as(
            "SELECT id, conversation_id, trigger_turn_id, signals_human, signals_ai, signals_interaction, signals_system, \
             cei, cep, resonance_frequency, sim_runs_pending, sim_runs_complete, sim_runs_error, research_notes_total, \
             agent_tool_calls_7d, created_at FROM system_snapshots ORDER BY created_at DESC LIMIT 1",
        )
        .fetch_one(&state.db)
        .await
        .unwrap();
        let out = snapshot_to_out(row);

        assert_eq!(out.conversation_id, "conv-x");
        assert_eq!(out.trigger_turn_id, Some("trigger-turn-1".to_string()));
        assert_eq!(out.signals_human, 2);
        assert_eq!(out.signals_ai, 1);
        assert_eq!(out.signals_interaction, 0);
        assert_eq!(out.signals_system, 3);
        assert!((out.cei - 0.75).abs() < 0.001, "cei: {}", out.cei);
        assert_eq!(out.sim_runs_pending, 1);
        assert_eq!(out.sim_runs_complete, 2);
        assert_eq!(out.sim_runs_error, 1);
        assert_eq!(out.research_notes_total, 5);
        assert_eq!(out.agent_tool_calls_7d, 2, "the 10-day-old tool call must not count");
    }

    /// No fabrication in the other direction too: every source table empty
    /// must write honest zeros (and a null trigger_turn_id, since none was
    /// given), not an error and not a skipped/missing row.
    #[tokio::test]
    async fn capture_system_snapshot_on_empty_tables_writes_honest_zeros() {
        let state = test_state().await;
        capture_system_snapshot(&state, "conv-empty", None).await;

        let row: SnapshotRow = sqlx::query_as(
            "SELECT id, conversation_id, trigger_turn_id, signals_human, signals_ai, signals_interaction, signals_system, \
             cei, cep, resonance_frequency, sim_runs_pending, sim_runs_complete, sim_runs_error, research_notes_total, \
             agent_tool_calls_7d, created_at FROM system_snapshots WHERE conversation_id = 'conv-empty'",
        )
        .fetch_one(&state.db)
        .await
        .unwrap();
        let out = snapshot_to_out(row);

        assert_eq!(out.trigger_turn_id, None);
        assert_eq!(out.signals_human, 0);
        assert_eq!(out.signals_ai, 0);
        assert_eq!(out.signals_interaction, 0);
        assert_eq!(out.signals_system, 0);
        assert_eq!(out.cei, 0.0);
        assert_eq!(out.cep, 0);
        assert_eq!(out.resonance_frequency, 0.0);
        assert_eq!(out.sim_runs_pending, 0);
        assert_eq!(out.sim_runs_complete, 0);
        assert_eq!(out.sim_runs_error, 0);
        assert_eq!(out.research_notes_total, 0);
        assert_eq!(out.agent_tool_calls_7d, 0);
    }

    /// Direct proof of the best-effort contract in isolation: a DB where
    /// NONE of the source tables (or `system_snapshots` itself) exist, so
    /// the very first query inside `try_capture_system_snapshot` fails.
    /// Reaching the end of this test at all (rather than a panic) is the
    /// assertion — see `capture_system_snapshot`'s own doc comment.
    #[tokio::test]
    async fn capture_system_snapshot_never_panics_when_every_source_table_is_missing() {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let mut state = test_state().await;
        state.db = db; // swap in a completely bare DB, bypassing test_state()'s own init_schema calls
        capture_system_snapshot(&state, "conv-bare", None).await;
    }

    // ── Flight recorder: list_snapshots pagination + range filter ──────────

    fn empty_snapshots_query() -> ListSnapshotsQuery {
        ListSnapshotsQuery { limit: None, offset: None, range: None }
    }

    async fn snapshots_body(res: axum::response::Response) -> (Vec<serde_json::Value>, Option<i64>) {
        let total = res
            .headers()
            .get("x-total-count")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<i64>().ok());
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        (body, total)
    }

    #[tokio::test]
    async fn list_snapshots_is_paginated_with_total_count_and_offset_reaching_the_rest() {
        let state = test_state().await;
        for i in 0..7 {
            capture_system_snapshot(&state, &format!("conv-{i}"), None).await;
        }

        let (first_page, total) = snapshots_body(
            list_snapshots(
                AxState(state.clone()),
                HeaderMap::new(),
                AxQuery(ListSnapshotsQuery { limit: Some(3), offset: Some(0), ..empty_snapshots_query() }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(first_page.len(), 3);
        assert_eq!(total, Some(7), "X-Total-Count must reflect the true total, not just the page size");

        let (second_page, _) = snapshots_body(
            list_snapshots(
                AxState(state.clone()),
                HeaderMap::new(),
                AxQuery(ListSnapshotsQuery { limit: Some(3), offset: Some(3), ..empty_snapshots_query() }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(second_page.len(), 3);

        let (third_page, _) = snapshots_body(
            list_snapshots(
                AxState(state.clone()),
                HeaderMap::new(),
                AxQuery(ListSnapshotsQuery { limit: Some(3), offset: Some(6), ..empty_snapshots_query() }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(third_page.len(), 1, "the 7th snapshot must be reachable via offset");

        let first_ids: std::collections::HashSet<_> = first_page.iter().map(|s| s["id"].clone()).collect();
        let second_ids: std::collections::HashSet<_> = second_page.iter().map(|s| s["id"].clone()).collect();
        assert!(first_ids.is_disjoint(&second_ids));
    }

    #[tokio::test]
    async fn list_snapshots_default_page_size_and_newest_first_ordering() {
        let state = test_state().await;
        capture_system_snapshot(&state, "conv-first", None).await;
        capture_system_snapshot(&state, "conv-second", None).await;

        let (body, total) = snapshots_body(
            list_snapshots(AxState(state.clone()), HeaderMap::new(), AxQuery(empty_snapshots_query())).await.into_response(),
        )
        .await;
        assert_eq!(total, Some(2));
        assert_eq!(body.len(), 2);
        assert_eq!(body[0]["conversation_id"], "conv-second", "newest capture must come first");
        assert_eq!(body[1]["conversation_id"], "conv-first");
    }

    #[tokio::test]
    async fn list_snapshots_range_filter_excludes_older_snapshots() {
        let state = test_state().await;
        // A snapshot inserted directly with an old created_at (capture_system_snapshot
        // always stamps "now", so an old row has to be seeded by hand — same
        // approach public.rs's own ccet_trend tests use).
        sqlx::query(
            "INSERT INTO system_snapshots (id, conversation_id, created_at) VALUES (?1, 'conv-old', datetime('now', '-20 days'))",
        )
        .bind(Uuid::new_v4().to_string())
        .execute(&state.db)
        .await
        .unwrap();
        capture_system_snapshot(&state, "conv-new", None).await;

        let (body, total) = snapshots_body(
            list_snapshots(
                AxState(state.clone()),
                HeaderMap::new(),
                AxQuery(ListSnapshotsQuery { range: Some("7d".to_string()), ..empty_snapshots_query() }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(total, Some(1), "the 20-day-old snapshot must not count under range=7d: {body:?}");
        assert_eq!(body.len(), 1);
        assert_eq!(body[0]["conversation_id"], "conv-new");

        let (all_body, all_total) = snapshots_body(
            list_snapshots(
                AxState(state.clone()),
                HeaderMap::new(),
                AxQuery(ListSnapshotsQuery { range: Some("all".to_string()), ..empty_snapshots_query() }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(all_total, Some(2), "range=all must reach the 20-day-old snapshot too: {all_body:?}");
    }

    #[tokio::test]
    async fn list_snapshots_requires_admin_auth() {
        let mut state = test_state().await;
        state.chat_secret = "shh".to_string();
        let res = list_snapshots(AxState(state), HeaderMap::new(), AxQuery(empty_snapshots_query())).await.into_response();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }
}
