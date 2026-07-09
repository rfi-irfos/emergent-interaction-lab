use axum::{extract::State, http::{HeaderMap, StatusCode}, response::IntoResponse, Json};
use serde::Serialize;
use serde_json::json;

use crate::{authz::require_admin, AppState};

macro_rules! guard {
    ($state:expr, $headers:expr) => {
        if !require_admin(&$state, &$headers) {
            return StatusCode::UNAUTHORIZED.into_response();
        }
    };
}

// ── System Overview ──────────────────────────────────────────────────────────
// All real: aggregates across every module's own table. No mocked numbers.

#[derive(Serialize)]
struct ActivityItem { kind: String, label: String, created_at: String }

pub async fn overview(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    guard!(state, headers);
    let db = &state.db;

    let (web_visits_30d,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM web_visits WHERE created_at > datetime('now','-30 days')").fetch_one(db).await.unwrap_or((0,));
    let (chat_conversations,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_conversations").fetch_one(db).await.unwrap_or((0,));
    let (chat_messages,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_messages").fetch_one(db).await.unwrap_or((0,));
    let (blog_draft,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM blog_posts WHERE status='draft'").fetch_one(db).await.unwrap_or((0,));
    let (blog_published,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM blog_posts WHERE status='published'").fetch_one(db).await.unwrap_or((0,));
    let (research_notes,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM research_notes").fetch_one(db).await.unwrap_or((0,));
    let (simulation_runs,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM simulation_runs").fetch_one(db).await.unwrap_or((0,));
    let (agent_calls_7d,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM agent_tool_calls WHERE created_at > datetime('now','-7 days')").fetch_one(db).await.unwrap_or((0,));
    let tool_call_counts: Vec<(String,i64)> = sqlx::query_as(
        "SELECT tool_name, COUNT(*) FROM agent_tool_calls WHERE created_at > datetime('now','-30 days') GROUP BY tool_name"
    ).fetch_all(db).await.unwrap_or_default();

    let mut activity: Vec<ActivityItem> = Vec::new();
    let blog_rows: Vec<(String,String)> = sqlx::query_as("SELECT title, created_at FROM blog_posts ORDER BY created_at DESC LIMIT 5").fetch_all(db).await.unwrap_or_default();
    activity.extend(blog_rows.into_iter().map(|(t,c)| ActivityItem{ kind:"blog".into(), label: t, created_at: c }));
    let note_rows: Vec<(String,String)> = sqlx::query_as("SELECT title, created_at FROM research_notes ORDER BY created_at DESC LIMIT 5").fetch_all(db).await.unwrap_or_default();
    activity.extend(note_rows.into_iter().map(|(t,c)| ActivityItem{ kind:"research".into(), label: t, created_at: c }));
    let sim_rows: Vec<(String,String)> = sqlx::query_as("SELECT hypothesis, created_at FROM simulation_runs ORDER BY created_at DESC LIMIT 5").fetch_all(db).await.unwrap_or_default();
    activity.extend(sim_rows.into_iter().map(|(t,c)| ActivityItem{ kind:"simulation".into(), label: t, created_at: c }));
    let tool_rows: Vec<(String,String)> = sqlx::query_as("SELECT tool_name, created_at FROM agent_tool_calls ORDER BY created_at DESC LIMIT 5").fetch_all(db).await.unwrap_or_default();
    activity.extend(tool_rows.into_iter().map(|(t,c)| ActivityItem{ kind:"agent".into(), label: t, created_at: c }));
    activity.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    activity.truncate(12);

    Json(json!({
        "web_visits_30d": web_visits_30d,
        "chat_conversations": chat_conversations,
        "chat_messages": chat_messages,
        "blog_posts_draft": blog_draft,
        "blog_posts_published": blog_published,
        "research_notes": research_notes,
        "simulation_runs": simulation_runs,
        "agent_tool_calls_7d": agent_calls_7d,
        "recent_activity": activity,
        "tool_call_counts": tool_call_counts.into_iter().map(|(tool,count)| json!({"tool":tool,"count":count})).collect::<Vec<_>>(),
    })).into_response()
}

// ── Emergence Monitor ────────────────────────────────────────────────────────
// Underlying series are real; the single derived "variance index" is
// explicitly labeled experimental — there is no validated emergence metric.

pub async fn emergence(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    guard!(state, headers);
    let db = &state.db;
    let visits_by_day: Vec<(String,i64)> = sqlx::query_as(
        "SELECT date(created_at) as day, COUNT(*) FROM web_visits WHERE created_at > datetime('now','-14 days') GROUP BY day ORDER BY day"
    ).fetch_all(db).await.unwrap_or_default();
    let messages_by_day: Vec<(String,i64)> = sqlx::query_as(
        "SELECT date(created_at) as day, COUNT(*) FROM chat_messages WHERE created_at > datetime('now','-14 days') GROUP BY day ORDER BY day"
    ).fetch_all(db).await.unwrap_or_default();

    let counts: Vec<f64> = visits_by_day.iter().map(|(_, c)| *c as f64).collect();
    let variance_index = if counts.len() > 1 {
        let mean = counts.iter().sum::<f64>() / counts.len() as f64;
        if mean > 0.0 {
            let variance = counts.iter().map(|c| (c - mean).powi(2)).sum::<f64>() / counts.len() as f64;
            Some(variance.sqrt() / mean)
        } else { None }
    } else { None };

    Json(json!({
        "visits_by_day": visits_by_day.into_iter().map(|(day,count)| json!({"day":day,"count":count})).collect::<Vec<_>>(),
        "messages_by_day": messages_by_day.into_iter().map(|(day,count)| json!({"day":day,"count":count})).collect::<Vec<_>>(),
        "variance_index": variance_index,
        "variance_index_label": "EXPERIMENTELL — explorativer Indikator (Variationskoeffizient der täglichen Besuche), kein validiertes Emergenzmaß.",
    })).into_response()
}

// ── Behavioral Observatory ───────────────────────────────────────────────────
// Real: web_visits grouped by hour-of-day / day-of-week, return-visitor rate.

pub async fn behavior(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    guard!(state, headers);
    let db = &state.db;
    let by_hour: Vec<(String,i64)> = sqlx::query_as(
        "SELECT strftime('%H', created_at) as h, COUNT(*) FROM web_visits WHERE created_at > datetime('now','-30 days') GROUP BY h ORDER BY h"
    ).fetch_all(db).await.unwrap_or_default();
    let by_dow: Vec<(String,i64)> = sqlx::query_as(
        "SELECT strftime('%w', created_at) as d, COUNT(*) FROM web_visits WHERE created_at > datetime('now','-30 days') GROUP BY d ORDER BY d"
    ).fetch_all(db).await.unwrap_or_default();
    let (total_visitors,): (i64,) = sqlx::query_as(
        "SELECT COUNT(DISTINCT visitor) FROM web_visits WHERE created_at > datetime('now','-30 days')"
    ).fetch_one(db).await.unwrap_or((0,));
    let (returning_visitors,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM (SELECT visitor FROM web_visits WHERE created_at > datetime('now','-30 days') GROUP BY visitor HAVING COUNT(*) > 1)"
    ).fetch_one(db).await.unwrap_or((0,));

    Json(json!({
        "by_hour": by_hour.into_iter().map(|(h,c)| json!({"hour":h,"count":c})).collect::<Vec<_>>(),
        "by_day_of_week": by_dow.into_iter().map(|(d,c)| json!({"day":d,"count":c})).collect::<Vec<_>>(),
        "total_visitors_30d": total_visitors,
        "returning_visitors_30d": returning_visitors,
    })).into_response()
}

// ── Information Dynamics ─────────────────────────────────────────────────────
// Real: chat_documents/chat_chunks corpus growth + chat_retrievals trend.

pub async fn information(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    guard!(state, headers);
    let db = &state.db;
    let (documents,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_documents").fetch_one(db).await.unwrap_or((0,));
    let (chunks,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_chunks").fetch_one(db).await.unwrap_or((0,));
    let retrieval_by_day: Vec<(String, f64, f64)> = sqlx::query_as(
        "SELECT date(created_at) as day, AVG(top_score), AVG(hit_count) FROM chat_retrievals WHERE created_at > datetime('now','-14 days') GROUP BY day ORDER BY day"
    ).fetch_all(db).await.unwrap_or_default();

    Json(json!({
        "documents": documents,
        "chunks": chunks,
        "retrieval_by_day": retrieval_by_day.into_iter().map(|(day, avg_score, avg_hits)| json!({"day":day,"avg_top_score":avg_score,"avg_hit_count":avg_hits})).collect::<Vec<_>>(),
    })).into_response()
}

// ── Human–AI Interaction ─────────────────────────────────────────────────────
// Real: message counts, latency between exchange pairs, mean token-confidence
// — all derived from columns chat.rs already writes, no schema change needed.

pub async fn human_ai(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    guard!(state, headers);
    let db = &state.db;
    let (user_msgs,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_messages WHERE role='user'").fetch_one(db).await.unwrap_or((0,));
    let (assistant_msgs,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_messages WHERE role='assistant'").fetch_one(db).await.unwrap_or((0,));

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
    // in the same conversation (paired by proximity, not by id linkage).
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
    // the most recent reply, not just an averaged number — same shape
    // TokenBreakdown already renders in the Forschung chat's Token-Analyse.
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
        "mean_token_confidence": mean_confidence,
        "mean_latency_seconds": mean_latency_s,
        "latency_sample_size": latencies.len(),
        "latest_reply": latest_reply,
        "latest_tokens": latest_tokens,
        "latest_at": latest_at,
    })).into_response()
}

// ── System Diagnostics ───────────────────────────────────────────────────────
// Real: config presence flags, agent error rate, DB reachability.

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
