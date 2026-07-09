use axum::{extract::State, http::{HeaderMap, StatusCode}, response::IntoResponse, Json};
use serde_json::json;

use crate::{authz::require_admin, AppState};

macro_rules! guard {
    ($state:expr, $headers:expr) => {
        if !require_admin(&$state, &$headers) {
            return StatusCode::UNAUTHORIZED.into_response();
        }
    };
}

// ── Behavioral Landscape ─────────────────────────────────────────────────────
// Group patterns in research activity, not individual visitor surveillance:
// research-note category mix, tool-type distribution, conversation-length
// distribution — all real, all aggregate, none of it web-traffic data.

pub async fn behavior(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    guard!(state, headers);
    let db = &state.db;

    let category_mix: Vec<(String, i64)> = sqlx::query_as(
        "SELECT category, COUNT(*) FROM research_notes GROUP BY category ORDER BY COUNT(*) DESC"
    ).fetch_all(db).await.unwrap_or_default();

    let tool_distribution: Vec<(String, i64)> = sqlx::query_as(
        "SELECT tool_name, COUNT(*) FROM agent_tool_calls WHERE created_at > datetime('now','-30 days') GROUP BY tool_name ORDER BY COUNT(*) DESC"
    ).fetch_all(db).await.unwrap_or_default();

    let length_distribution: Vec<(String, i64)> = sqlx::query_as(
        "SELECT bucket, COUNT(*) FROM (
            SELECT CASE WHEN cnt <= 4 THEN 'kurz' WHEN cnt <= 15 THEN 'mittel' ELSE 'lang' END as bucket
            FROM (SELECT conversation_id, COUNT(*) as cnt FROM chat_messages GROUP BY conversation_id)
        ) GROUP BY bucket"
    ).fetch_all(db).await.unwrap_or_default();

    // Individual recent calls, not just the 30-day count above — every
    // consumer of agent_tool_calls so far only ever aggregates, discarding
    // exactly which calls happened and what they touched.
    let recent_tool_calls: Vec<(String, String, Option<String>, Option<String>, String)> = sqlx::query_as(
        "SELECT tool_name, status, conversation_id, result, created_at FROM agent_tool_calls ORDER BY created_at DESC LIMIT 10"
    ).fetch_all(db).await.unwrap_or_default();

    Json(json!({
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

pub async fn information(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    guard!(state, headers);
    let db = &state.db;
    let (documents,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_documents").fetch_one(db).await.unwrap_or((0,));
    let (chunks,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_chunks").fetch_one(db).await.unwrap_or((0,));
    let retrieval_by_day: Vec<(String, f64, f64)> = sqlx::query_as(
        "SELECT date(created_at) as day, AVG(top_score), AVG(hit_count) FROM chat_retrievals WHERE created_at > datetime('now','-14 days') GROUP BY day ORDER BY day"
    ).fetch_all(db).await.unwrap_or_default();

    // Real, per-query view of what retrieval actually returned — the daily
    // averages above wash out individual failures. Surfaces genuine
    // knowledge gaps (a query with zero hits, or a top hit too weak to pass
    // chat.rs's own relevance threshold) instead of only ever averaging
    // scores away.
    let recent_retrievals: Vec<(String, f64, i64, String)> = sqlx::query_as(
        "SELECT query_text, top_score, hit_count, created_at FROM chat_retrievals ORDER BY created_at DESC LIMIT 10"
    ).fetch_all(db).await.unwrap_or_default();

    Json(json!({
        "documents": documents,
        "chunks": chunks,
        "retrieval_by_day": retrieval_by_day.into_iter().map(|(day, avg_score, avg_hits)| json!({"day":day,"avg_top_score":avg_score,"avg_hit_count":avg_hits})).collect::<Vec<_>>(),
        "recent_retrievals": recent_retrievals.into_iter().map(|(query_text, top_score, hit_count, created_at)| json!({
            "query_text": query_text,
            "top_score": top_score,
            "hit_count": hit_count,
            "created_at": created_at,
            "is_gap": hit_count == 0 || (top_score as f32) < crate::chat::RETRIEVAL_MIN_SCORE,
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
