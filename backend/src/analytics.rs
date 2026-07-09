use axum::{extract::State, http::{HeaderMap, StatusCode}, response::IntoResponse, Json};
use serde::Serialize;
use crate::{authz::require_admin, AppState};

#[derive(Serialize)]
pub struct DayCount { pub day: String, pub views: i64 }

#[derive(Serialize)]
pub struct Bucket { pub label: String, pub count: i64 }

#[derive(Serialize)]
pub struct AnalyticsData {
    pub total_views: i64,
    pub unique_visitors: i64,
    pub views_by_day: Vec<DayCount>,
    pub top_sources: Vec<Bucket>,
    pub top_paths: Vec<Bucket>,
}

pub async fn stats(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let (total_views, unique_visitors) = sqlx::query_as::<_, (i64, i64)>(
        "SELECT COUNT(*), COUNT(DISTINCT visitor) FROM web_visits WHERE created_at > datetime('now', '-30 days')"
    ).fetch_one(&state.db).await.unwrap_or((0, 0));

    let views_by_day = sqlx::query_as::<_, (String, i64)>(
        "SELECT date(created_at) as day, COUNT(*) FROM web_visits \
         WHERE created_at > datetime('now', '-14 days') GROUP BY day ORDER BY day"
    ).fetch_all(&state.db).await.unwrap_or_default()
    .into_iter().map(|(day, views)| DayCount { day, views }).collect();

    let top_sources = sqlx::query_as::<_, (String, i64)>(
        "SELECT source, COUNT(*) as cnt FROM web_visits \
         WHERE created_at > datetime('now', '-30 days') GROUP BY source ORDER BY cnt DESC LIMIT 8"
    ).fetch_all(&state.db).await.unwrap_or_default()
    .into_iter().map(|(label, count)| Bucket { label, count }).collect();

    let top_paths = sqlx::query_as::<_, (String, i64)>(
        "SELECT path, COUNT(*) as cnt FROM web_visits \
         WHERE created_at > datetime('now', '-30 days') GROUP BY path ORDER BY cnt DESC LIMIT 8"
    ).fetch_all(&state.db).await.unwrap_or_default()
    .into_iter().map(|(label, count)| Bucket { label, count }).collect();

    Json(AnalyticsData { total_views, unique_visitors, views_by_day, top_sources, top_paths }).into_response()
}
