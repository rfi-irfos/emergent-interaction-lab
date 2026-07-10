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
    // scores away. Carries id + conversation_id too now: SystemMap's
    // "Information Dynamics" satellites point at one of these specific
    // retrieval events, not just the aggregate count.
    let recent_retrievals: Vec<(String, String, String, f64, i64, String)> = sqlx::query_as(
        "SELECT id, conversation_id, query_text, top_score, hit_count, created_at FROM chat_retrievals ORDER BY created_at DESC LIMIT 10"
    ).fetch_all(db).await.unwrap_or_default();

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
