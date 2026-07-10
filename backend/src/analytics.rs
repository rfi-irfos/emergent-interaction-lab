use axum::{extract::{Query, State}, http::{HeaderMap, StatusCode}, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use crate::{authz::require_admin, AppState};

#[derive(Serialize)]
pub struct DayCount { pub day: String, pub views: i64 }

#[derive(Serialize)]
pub struct Bucket { pub label: String, pub count: i64 }

#[derive(Serialize)]
pub struct ToolCallCount { pub tool: String, pub count: i64 }

#[derive(Serialize)]
pub struct ActivityItem { pub kind: String, pub label: String, pub created_at: String }

// ── Day/week activity trend (`?bucket=day|week&days=N`) ─────────────────────
// Everything above this point only ever answers "what's the all-time/last-30d
// total" — no way to see "what happened on 2026-07-08" vs. "this week"
// specifically. `activity_trend` below answers that: one row per bucket,
// with a count for each of the metrics this dashboard already tracks as a
// bare total elsewhere, so a day (or week) can be inspected retrospectively
// instead of only ever seeing the lifetime aggregate.

/// Default trailing window when `?days=` is absent — wide enough to show a
/// few weeks of movement without scanning the whole table by default.
const DEFAULT_TREND_DAYS: i64 = 30;

/// Upper bound on `?days=` — keeps a caller from forcing an unbounded
/// full-table scan; 180 days is generous for a retrospective view without
/// being "just fetch everything."
const MAX_TREND_DAYS: i64 = 180;

#[derive(Debug, Deserialize)]
pub struct TrendQuery {
    pub bucket: Option<String>,
    pub days: Option<i64>,
}

/// Normalizes the `?bucket=` param to one of the two supported SQLite
/// bucketing granularities. Anything absent or unrecognized falls back to
/// "day" (the finest-grained, least-surprising default) rather than
/// erroring on a typo'd query param.
fn resolve_bucket(bucket: Option<&str>) -> &'static str {
    match bucket {
        Some("week") => "week",
        _ => "day",
    }
}

/// The SQL `GROUP BY` expression for a resolved bucket granularity. Reuses
/// the exact `date(created_at)` idiom `ccet_trend` (public.rs) already
/// established for daily buckets, for consistency; "week" buckets
/// Monday-start via SQLite's `weekday 0` modifier (jump to the next Sunday,
/// or stay put if `created_at` already falls on one) minus 6 days — verified
/// against known Mon–Sun/year-boundary cases in the test module below.
fn bucket_sql_expr(bucket: &str) -> &'static str {
    match bucket {
        "week" => "date(created_at, 'weekday 0', '-6 days')",
        _ => "date(created_at)",
    }
}

/// Clamps `?days=` into `[1, MAX_TREND_DAYS]`, defaulting to
/// `DEFAULT_TREND_DAYS` when absent — never an unbounded or negative window.
fn resolve_days(days: Option<i64>) -> i64 {
    days.unwrap_or(DEFAULT_TREND_DAYS).clamp(1, MAX_TREND_DAYS)
}

/// One bucket's (day- or week-aggregated) count across every metric this
/// trend tracks. `bucket` is the raw SQL bucket label (a `YYYY-MM-DD` date —
/// the bucket's own day for "day" granularity, that week's Monday for
/// "week").
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct TrendPoint {
    pub bucket: String,
    pub views: i64,
    pub chat_messages: i64,
    pub tool_calls: i64,
    pub research_notes: i64,
    pub blog_posts: i64,
    pub simulation_runs: i64,
}

/// Merges six independently bucketed `(bucket_label, count)` query results
/// (one per metric/table — each table has its own `created_at`, so there's
/// no single query that could produce this directly) into one
/// zero-filled, chronologically sorted time series. A bucket only one
/// metric actually touched still appears as a full row with every other
/// metric at 0, rather than the series silently omitting it or the caller
/// having to re-align six separately-shaped arrays by date itself.
fn merge_trend(
    views: Vec<(String, i64)>,
    chat_messages: Vec<(String, i64)>,
    tool_calls: Vec<(String, i64)>,
    research_notes: Vec<(String, i64)>,
    blog_posts: Vec<(String, i64)>,
    simulation_runs: Vec<(String, i64)>,
) -> Vec<TrendPoint> {
    use std::collections::BTreeMap;
    let mut map: BTreeMap<String, TrendPoint> = BTreeMap::new();
    fn slot<'a>(map: &'a mut BTreeMap<String, TrendPoint>, bucket: &str) -> &'a mut TrendPoint {
        map.entry(bucket.to_string()).or_insert_with(|| TrendPoint { bucket: bucket.to_string(), ..Default::default() })
    }
    for (b, c) in views { slot(&mut map, &b).views = c; }
    for (b, c) in chat_messages { slot(&mut map, &b).chat_messages = c; }
    for (b, c) in tool_calls { slot(&mut map, &b).tool_calls = c; }
    for (b, c) in research_notes { slot(&mut map, &b).research_notes = c; }
    for (b, c) in blog_posts { slot(&mut map, &b).blog_posts = c; }
    for (b, c) in simulation_runs { slot(&mut map, &b).simulation_runs = c; }
    // BTreeMap iterates in ascending key order — bucket labels are ISO
    // dates, so this is chronological order for free.
    map.into_values().collect()
}

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
    /// The resolved `?bucket=` granularity actually applied below ("day" or
    /// "week") — echoed back so the frontend's selector can stay in sync
    /// with what an unrecognized/absent query param actually fell back to.
    pub bucket: String,
    /// The resolved `?days=` window actually applied below, post-clamping.
    pub days: i64,
    /// Day- or week-bucketed, retrospective time series across the metrics
    /// this dashboard otherwise only shows as an all-time/30-day total —
    /// answers "what happened on 2026-07-08" or "this week", not just
    /// "ever."
    pub activity_trend: Vec<TrendPoint>,
}

pub async fn stats(State(state): State<AppState>, headers: HeaderMap, Query(q): Query<TrendQuery>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let db = &state.db;

    let bucket = resolve_bucket(q.bucket.as_deref());
    let days = resolve_days(q.days);
    let bucket_expr = bucket_sql_expr(bucket);
    let window = format!("-{days} days");

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

    // Six independently-bucketed counts (one per table, each with its own
    // `created_at`) over the resolved `bucket`/`days` window — merged below
    // into one retrospective time series per bucket.
    let views_trend: Vec<(String, i64)> = sqlx::query_as(&format!(
        "SELECT {bucket_expr} as b, COUNT(*) FROM web_visits WHERE created_at > datetime('now', ?1) GROUP BY b ORDER BY b"
    )).bind(&window).fetch_all(db).await.unwrap_or_default();

    let chat_messages_trend: Vec<(String, i64)> = sqlx::query_as(&format!(
        "SELECT {bucket_expr} as b, COUNT(*) FROM chat_messages WHERE created_at > datetime('now', ?1) GROUP BY b ORDER BY b"
    )).bind(&window).fetch_all(db).await.unwrap_or_default();

    let tool_calls_trend: Vec<(String, i64)> = sqlx::query_as(&format!(
        "SELECT {bucket_expr} as b, COUNT(*) FROM agent_tool_calls WHERE created_at > datetime('now', ?1) GROUP BY b ORDER BY b"
    )).bind(&window).fetch_all(db).await.unwrap_or_default();

    let research_notes_trend: Vec<(String, i64)> = sqlx::query_as(&format!(
        "SELECT {bucket_expr} as b, COUNT(*) FROM research_notes WHERE created_at > datetime('now', ?1) GROUP BY b ORDER BY b"
    )).bind(&window).fetch_all(db).await.unwrap_or_default();

    let blog_posts_trend: Vec<(String, i64)> = sqlx::query_as(&format!(
        "SELECT {bucket_expr} as b, COUNT(*) FROM blog_posts WHERE created_at > datetime('now', ?1) GROUP BY b ORDER BY b"
    )).bind(&window).fetch_all(db).await.unwrap_or_default();

    let simulation_runs_trend: Vec<(String, i64)> = sqlx::query_as(&format!(
        "SELECT {bucket_expr} as b, COUNT(*) FROM simulation_runs WHERE created_at > datetime('now', ?1) GROUP BY b ORDER BY b"
    )).bind(&window).fetch_all(db).await.unwrap_or_default();

    let activity_trend = merge_trend(
        views_trend, chat_messages_trend, tool_calls_trend,
        research_notes_trend, blog_posts_trend, simulation_runs_trend,
    );

    Json(AnalyticsData {
        total_views, unique_visitors, views_by_day, top_sources, top_paths,
        chat_conversations, chat_messages, blog_posts_draft, blog_posts_published,
        research_notes, simulation_runs, agent_tool_calls_7d, tool_call_counts, recent_activity,
        bucket: bucket.to_string(), days, activity_trend,
    }).into_response()
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
        // Mirrors main.rs's inline web_visits DDL — this table isn't owned
        // by any module's `init_schema`.
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS web_visits (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL DEFAULT '/', \
             source TEXT NOT NULL DEFAULT 'direct', referrer TEXT NOT NULL DEFAULT '', utm_source TEXT NOT NULL DEFAULT '', \
             utm_medium TEXT NOT NULL DEFAULT '', utm_campaign TEXT NOT NULL DEFAULT '', visitor TEXT NOT NULL DEFAULT '', \
             created_at DATETIME NOT NULL DEFAULT (datetime('now')))",
        )
        .execute(&db)
        .await
        .expect("create web_visits");
        crate::chat::init_schema(&db).await;
        crate::research::init_schema(&db).await;
        crate::simulation::init_schema(&db).await;
        crate::blog::init_schema(&db).await;
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
            stripe_webhook_secret: String::new(),
            ddg_api_base: "https://api.duckduckgo.com".to_string(),
            chat_model_idx: Arc::new(AtomicUsize::new(0)),
            chat_request_count: Arc::new(AtomicU64::new(0)),
            github_token: String::new(),
            github_api_base: "https://api.github.com".to_string(),
        }
    }

    fn empty_query() -> TrendQuery {
        TrendQuery { bucket: None, days: None }
    }

    // ── pure helpers ─────────────────────────────────────────────────────

    #[test]
    fn resolve_bucket_defaults_to_day_for_none_and_unrecognized() {
        assert_eq!(resolve_bucket(None), "day");
        assert_eq!(resolve_bucket(Some("")), "day");
        assert_eq!(resolve_bucket(Some("fortnight")), "day");
    }

    #[test]
    fn resolve_bucket_recognizes_week() {
        assert_eq!(resolve_bucket(Some("week")), "week");
    }

    #[test]
    fn resolve_days_defaults_and_clamps() {
        assert_eq!(resolve_days(None), DEFAULT_TREND_DAYS);
        assert_eq!(resolve_days(Some(0)), 1, "zero must clamp up to the 1-day floor");
        assert_eq!(resolve_days(Some(-30)), 1, "negative must clamp up to the 1-day floor");
        assert_eq!(resolve_days(Some(999)), MAX_TREND_DAYS, "must clamp down to the cap");
        assert_eq!(resolve_days(Some(14)), 14, "an in-range value passes through unchanged");
    }

    #[test]
    fn bucket_sql_expr_returns_expected_fragments() {
        assert_eq!(bucket_sql_expr("day"), "date(created_at)");
        assert_eq!(bucket_sql_expr("week"), "date(created_at, 'weekday 0', '-6 days')");
    }

    #[test]
    fn merge_trend_zero_fills_missing_metrics_and_sorts_chronologically() {
        let points = merge_trend(
            vec![("2026-07-09".to_string(), 5), ("2026-07-08".to_string(), 2)],
            vec![("2026-07-09".to_string(), 10)],
            vec![],
            vec![("2026-07-10".to_string(), 1)],
            vec![],
            vec![],
        );
        // Chronological order despite the inputs above being out of order.
        let buckets: Vec<&str> = points.iter().map(|p| p.bucket.as_str()).collect();
        assert_eq!(buckets, vec!["2026-07-08", "2026-07-09", "2026-07-10"]);

        assert_eq!(points[0], TrendPoint { bucket: "2026-07-08".into(), views: 2, chat_messages: 0, tool_calls: 0, research_notes: 0, blog_posts: 0, simulation_runs: 0 });
        assert_eq!(points[1], TrendPoint { bucket: "2026-07-09".into(), views: 5, chat_messages: 10, tool_calls: 0, research_notes: 0, blog_posts: 0, simulation_runs: 0 });
        assert_eq!(points[2], TrendPoint { bucket: "2026-07-10".into(), views: 0, chat_messages: 0, tool_calls: 0, research_notes: 1, blog_posts: 0, simulation_runs: 0 });
    }

    #[test]
    fn merge_trend_on_all_empty_inputs_returns_empty() {
        assert_eq!(merge_trend(vec![], vec![], vec![], vec![], vec![], vec![]), Vec::new());
    }

    // ── real SQLite date-bucketing math (no dependency on wall-clock "now") ─

    #[tokio::test]
    async fn week_bucket_sql_groups_monday_through_sunday_into_one_bucket() {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        // 2026-07-06 is a Monday, 07-08 Wednesday and 07-12 Sunday of the
        // *same* week; 07-13 is the following Monday. Hardcoded literal
        // dates (not relative to "now") so this test is deterministic
        // regardless of which day it actually runs on, and directly
        // exercises the exact fragment `bucket_sql_expr("week")` returns —
        // not a hand-copied duplicate that could silently drift from it.
        let expr = bucket_sql_expr("week");
        let sql = format!(
            "SELECT {expr} FROM (SELECT '2026-07-06' as created_at UNION ALL SELECT '2026-07-08' \
             UNION ALL SELECT '2026-07-12' UNION ALL SELECT '2026-07-13') ORDER BY created_at"
        );
        let rows: Vec<(String,)> = sqlx::query_as(&sql).fetch_all(&db).await.unwrap();
        let buckets: Vec<&str> = rows.iter().map(|(b,)| b.as_str()).collect();
        assert_eq!(buckets, vec!["2026-07-06", "2026-07-06", "2026-07-06", "2026-07-13"]);
    }

    #[tokio::test]
    async fn week_bucket_sql_handles_a_year_boundary() {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        // 2026-01-01 is a Thursday; its week's Monday falls in the prior
        // year, which the plain string-prefix slicing the frontend does
        // (`bucket.slice(5)`) would still render correctly, but only if the
        // SQL side computed the right calendar date in the first place.
        let expr = bucket_sql_expr("week");
        let sql = format!("SELECT {expr} FROM (SELECT '2026-01-01' as created_at)");
        let (bucket,): (String,) = sqlx::query_as(&sql).fetch_one(&db).await.unwrap();
        assert_eq!(bucket, "2025-12-29");
    }

    #[tokio::test]
    async fn day_bucket_sql_keeps_only_the_date_part() {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let expr = bucket_sql_expr("day");
        let sql = format!("SELECT {expr} FROM (SELECT '2026-07-08 23:59:59' as created_at)");
        let (bucket,): (String,) = sqlx::query_as(&sql).fetch_one(&db).await.unwrap();
        assert_eq!(bucket, "2026-07-08");
    }

    // ── handler: window filtering actually threads through Query params ────

    #[tokio::test]
    async fn stats_default_window_excludes_rows_older_than_30_days() {
        let state = test_state().await;
        sqlx::query("INSERT INTO web_visits (path, created_at) VALUES ('/', datetime('now'))")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO web_visits (path, created_at) VALUES ('/old', datetime('now', '-45 days'))")
            .execute(&state.db).await.unwrap();

        let res = stats(AxState(state.clone()), HeaderMap::new(), AxQuery(empty_query())).await.into_response();
        assert_eq!(res.status(), axum::http::StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(body["bucket"], "day");
        assert_eq!(body["days"], DEFAULT_TREND_DAYS);
        let points = body["activity_trend"].as_array().unwrap();
        assert_eq!(points.len(), 1, "the 45-day-old visit must not appear in the default 30-day window: {body}");
        assert_eq!(points[0]["views"], 1);
    }

    #[tokio::test]
    async fn stats_wider_days_param_includes_the_older_row() {
        let state = test_state().await;
        sqlx::query("INSERT INTO web_visits (path, created_at) VALUES ('/', datetime('now'))")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO web_visits (path, created_at) VALUES ('/old', datetime('now', '-45 days'))")
            .execute(&state.db).await.unwrap();

        let res = stats(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(TrendQuery { bucket: None, days: Some(60) }),
        )
        .await
        .into_response();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(body["days"], 60);
        let points = body["activity_trend"].as_array().unwrap();
        assert_eq!(points.len(), 2, "days=60 must widen the window to include the 45-day-old visit: {body}");
        let total_views: i64 = points.iter().map(|p| p["views"].as_i64().unwrap()).sum();
        assert_eq!(total_views, 2);
    }

    #[tokio::test]
    async fn stats_merges_metrics_from_different_tables_into_the_same_bucket() {
        let state = test_state().await;
        sqlx::query("INSERT INTO web_visits (path, created_at) VALUES ('/', datetime('now'))")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO chat_conversations (id) VALUES ('c1')").execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO chat_messages (id, conversation_id, role, content, created_at) VALUES ('m1','c1','user','hi', datetime('now'))")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO research_notes (id, category, title, body, created_at) VALUES ('n1','idea','T','B', datetime('now'))")
            .execute(&state.db).await.unwrap();

        let res = stats(AxState(state.clone()), HeaderMap::new(), AxQuery(empty_query())).await.into_response();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

        let points = body["activity_trend"].as_array().unwrap();
        assert_eq!(points.len(), 1, "same-day activity across three different tables must merge into a single bucket row: {body}");
        assert_eq!(points[0]["views"], 1);
        assert_eq!(points[0]["chat_messages"], 1);
        assert_eq!(points[0]["research_notes"], 1);
        assert_eq!(points[0]["blog_posts"], 0, "must zero-fill metrics with no activity that day");
        assert_eq!(points[0]["simulation_runs"], 0);
        assert_eq!(points[0]["tool_calls"], 0);
    }

    #[tokio::test]
    async fn stats_week_bucket_param_merges_two_days_in_the_same_week() {
        let state = test_state().await;
        // Two web_visits 1 day apart, both well inside the trailing 30-day
        // window — regardless of which calendar day the suite runs on,
        // "today" and "yesterday" fall in the same day-bucket under `week`
        // granularity unless today is itself a Monday, which would instead
        // prove the two land in *different* week-buckets. Either outcome is
        // asserted below so the test is never flaky.
        sqlx::query("INSERT INTO web_visits (path, created_at) VALUES ('/', datetime('now'))")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO web_visits (path, created_at) VALUES ('/', datetime('now', '-1 days'))")
            .execute(&state.db).await.unwrap();

        let res = stats(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(TrendQuery { bucket: Some("week".to_string()), days: None }),
        )
        .await
        .into_response();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(body["bucket"], "week");
        let points = body["activity_trend"].as_array().unwrap();
        let total_views: i64 = points.iter().map(|p| p["views"].as_i64().unwrap()).sum();
        assert_eq!(total_views, 2, "both visits must still be counted regardless of bucket boundaries: {body}");
        assert!(points.len() == 1 || points.len() == 2, "expected 1 bucket (same week) or 2 (crossed a Monday boundary), got {}: {body}", points.len());
    }
}
