use axum::{extract::State, http::{HeaderMap, StatusCode}, response::IntoResponse, Json};
use serde::Serialize;
use crate::{authz::require_admin, AppState};

#[derive(Serialize)]
pub struct DayCount { pub day: String, pub views: i64 }

#[derive(Serialize)]
pub struct Bucket { pub label: String, pub count: i64 }

#[derive(Serialize)]
pub struct ToolCallCount { pub tool: String, pub count: i64 }

#[derive(Serialize)]
pub struct ActivityItem { pub kind: String, pub label: String, pub created_at: String }

/// This is the business/CMS-facing view (Verwaltung → Analytics) — website
/// traffic plus the same admin-activity counts that used to live in the
/// Observatory's "System Overview" module. Deliberately business-KPI in
/// nature: the Observatory is reserved for emergence signals, this is where
/// page views, conversation counts and blog-draft counts belong instead.
#[derive(Serialize)]
pub struct AnalyticsData {
    pub total_views: i64,
    pub unique_visitors: i64,
    pub views_by_day: Vec<DayCount>,
    pub top_sources: Vec<Bucket>,
    pub top_paths: Vec<Bucket>,
    pub chat_conversations: i64,
    pub chat_messages: i64,
    pub blog_posts_draft: i64,
    pub blog_posts_published: i64,
    pub research_notes: i64,
    pub simulation_runs: i64,
    pub agent_tool_calls_7d: i64,
    pub tool_call_counts: Vec<ToolCallCount>,
    pub recent_activity: Vec<ActivityItem>,
}

pub async fn stats(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let db = &state.db;

    let (total_views, unique_visitors) = sqlx::query_as::<_, (i64, i64)>(
        "SELECT COUNT(*), COUNT(DISTINCT visitor) FROM web_visits WHERE created_at > datetime('now', '-30 days')"
    ).fetch_one(db).await.unwrap_or((0, 0));

    let views_by_day = sqlx::query_as::<_, (String, i64)>(
        "SELECT date(created_at) as day, COUNT(*) FROM web_visits \
         WHERE created_at > datetime('now', '-14 days') GROUP BY day ORDER BY day"
    ).fetch_all(db).await.unwrap_or_default()
    .into_iter().map(|(day, views)| DayCount { day, views }).collect();

    let top_sources = sqlx::query_as::<_, (String, i64)>(
        "SELECT source, COUNT(*) as cnt FROM web_visits \
         WHERE created_at > datetime('now', '-30 days') GROUP BY source ORDER BY cnt DESC LIMIT 8"
    ).fetch_all(db).await.unwrap_or_default()
    .into_iter().map(|(label, count)| Bucket { label, count }).collect();

    let top_paths = sqlx::query_as::<_, (String, i64)>(
        "SELECT path, COUNT(*) as cnt FROM web_visits \
         WHERE created_at > datetime('now', '-30 days') GROUP BY path ORDER BY cnt DESC LIMIT 8"
    ).fetch_all(db).await.unwrap_or_default()
    .into_iter().map(|(label, count)| Bucket { label, count }).collect();

    let (chat_conversations,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_conversations").fetch_one(db).await.unwrap_or((0,));
    let (chat_messages,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_messages").fetch_one(db).await.unwrap_or((0,));
    let (blog_posts_draft,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM blog_posts WHERE status='draft'").fetch_one(db).await.unwrap_or((0,));
    let (blog_posts_published,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM blog_posts WHERE status='published'").fetch_one(db).await.unwrap_or((0,));
    let (research_notes,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM research_notes").fetch_one(db).await.unwrap_or((0,));
    let (simulation_runs,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM simulation_runs").fetch_one(db).await.unwrap_or((0,));
    let (agent_tool_calls_7d,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM agent_tool_calls WHERE created_at > datetime('now','-7 days')").fetch_one(db).await.unwrap_or((0,));
    let tool_call_counts: Vec<ToolCallCount> = sqlx::query_as::<_, (String, i64)>(
        "SELECT tool_name, COUNT(*) FROM agent_tool_calls WHERE created_at > datetime('now','-30 days') GROUP BY tool_name"
    ).fetch_all(db).await.unwrap_or_default()
    .into_iter().map(|(tool, count)| ToolCallCount { tool, count }).collect();

    let mut recent_activity: Vec<ActivityItem> = Vec::new();
    let blog_rows: Vec<(String,String)> = sqlx::query_as("SELECT title, created_at FROM blog_posts ORDER BY created_at DESC LIMIT 5").fetch_all(db).await.unwrap_or_default();
    recent_activity.extend(blog_rows.into_iter().map(|(t,c)| ActivityItem{ kind:"blog".into(), label: t, created_at: c }));
    let note_rows: Vec<(String,String)> = sqlx::query_as("SELECT title, created_at FROM research_notes ORDER BY created_at DESC LIMIT 5").fetch_all(db).await.unwrap_or_default();
    recent_activity.extend(note_rows.into_iter().map(|(t,c)| ActivityItem{ kind:"research".into(), label: t, created_at: c }));
    let sim_rows: Vec<(String,String)> = sqlx::query_as("SELECT hypothesis, created_at FROM simulation_runs ORDER BY created_at DESC LIMIT 5").fetch_all(db).await.unwrap_or_default();
    recent_activity.extend(sim_rows.into_iter().map(|(t,c)| ActivityItem{ kind:"simulation".into(), label: t, created_at: c }));
    let tool_rows: Vec<(String,String)> = sqlx::query_as("SELECT tool_name, created_at FROM agent_tool_calls ORDER BY created_at DESC LIMIT 5").fetch_all(db).await.unwrap_or_default();
    recent_activity.extend(tool_rows.into_iter().map(|(t,c)| ActivityItem{ kind:"agent".into(), label: t, created_at: c }));
    recent_activity.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    recent_activity.truncate(12);

    Json(AnalyticsData {
        total_views, unique_visitors, views_by_day, top_sources, top_paths,
        chat_conversations, chat_messages, blog_posts_draft, blog_posts_published,
        research_notes, simulation_runs, agent_tool_calls_7d, tool_call_counts, recent_activity,
    }).into_response()
}
