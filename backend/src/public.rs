use axum::{extract::State, response::IntoResponse, Json};
use serde::Serialize;
use serde_json::json;

use crate::{github_activity, AppState};

/// Public, unauthenticated, visitor-facing widgets for the homepage — the
/// concrete demonstration that content.de.json's hero.subheadline ("keine
/// statische Broschüre, sondern ein live laufendes Forschungsinstrument") is
/// actually true, not just marketing copy. Both endpoints below are
/// deliberately narrow: bare aggregate counts (never row content) for
/// `live_stats`, and an already-public GitHub fact — a merged PR's
/// title/date/link — for `shipping_feed`. Neither requires nor exposes any
/// admin secret (`CHAT_API_SECRET`), the NVIDIA key, the Stripe key, or the
/// GitHub token itself (`state.github_token` is only ever used server-side
/// to call GitHub, never echoed back).
///
/// No `authz::require_admin` check on either handler below — that omission
/// is intentional, not an oversight; these two routes are the whole point of
/// this module.

// ── /api/public/live-stats ──────────────────────────────────────────────────

/// Bare `SELECT COUNT(*)` against four existing tables — no row content, no
/// titles, no observation/body text, no conversation content, just integers.
/// Deliberately its own endpoint (rather than reusing e.g.
/// `emergence::list_signals` with a `?count_only=1` flag) so there is no code
/// path here that could ever be extended to return actual signal/
/// conversation/run/note content unauthenticated — the query shape below is
/// the entire contract.
pub async fn live_stats(State(state): State<AppState>) -> impl IntoResponse {
    let emergence_signals: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM emergence_signals")
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);
    let chat_conversations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM chat_conversations")
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);
    let simulation_runs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM simulation_runs")
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);
    let research_notes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM research_notes")
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

    Json(json!({
        "emergence_signals": emergence_signals,
        "chat_conversations": chat_conversations,
        "simulation_runs": simulation_runs,
        "research_notes": research_notes,
    }))
    .into_response()
}

// ── /api/public/shipping-feed ───────────────────────────────────────────────

/// How many merged PRs the public feed shows at most — "last 10-15" per the
/// plan; 12 splits the difference.
const SHIPPING_FEED_LIMIT: usize = 12;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ShippingItem {
    pub title: String,
    pub merged_at: String,
    pub url: String,
}

/// Curated "what's shipping" — reuses `github_activity::fetch_pulls` (same
/// token, same `reqwest::Client`, same GitHub REST call `agent_activity`
/// already makes) but narrows the result to exactly title + merge date +
/// link, and only for PRs that are genuinely merged.
///
/// "Genuinely merged" means `merged_at.is_some()`, which is a *stricter* bar
/// than GitHub's own `state == "closed"`: a PR can be closed without being
/// merged (abandoned/rejected), and that case has no merge date and nothing
/// worth showing as "shipped" work, so it's excluded here too, not just open/
/// draft PRs. No PR number, no PR body, no state string, no commit messages,
/// no workflow-run internals — only the three fields on `ShippingItem`.
///
/// Pure function (no I/O) so the filter/sort/cap logic is unit-testable
/// without a mock HTTP server — see `shipping_feed` below for the handler
/// that supplies real (or test-mocked) data.
pub fn filter_shipping_items(pulls: Vec<github_activity::GhPull>) -> Vec<ShippingItem> {
    let mut items: Vec<ShippingItem> = pulls
        .into_iter()
        .filter_map(|p| {
            p.merged_at.map(|merged_at| ShippingItem {
                title: p.title,
                merged_at,
                url: p.html_url,
            })
        })
        .collect();
    items.sort_by(|a, b| b.merged_at.cmp(&a.merged_at));
    items.truncate(SHIPPING_FEED_LIMIT);
    items
}

pub async fn shipping_feed(State(state): State<AppState>) -> impl IntoResponse {
    if state.github_token.is_empty() {
        // Same honest-degradation convention as agent_activity: never crash,
        // never silently return something misleading — just say it isn't
        // connected yet.
        return Json(json!({ "configured": false, "items": Vec::<ShippingItem>::new() })).into_response();
    }

    let pulls = match github_activity::fetch_pulls(&state).await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let items = filter_shipping_items(pulls);
    Json(json!({ "configured": true, "items": items })).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github_activity::GhPull;
    use axum::{routing::get as axget, Json as AxJson, Router};
    use std::{
        collections::HashMap,
        path::PathBuf,
        sync::{atomic::AtomicU64, atomic::AtomicUsize, Arc, RwLock},
    };

    fn pull(number: i64, title: &str, state: &str, merged_at: Option<&str>, updated_at: &str) -> GhPull {
        GhPull {
            number,
            title: title.to_string(),
            state: state.to_string(),
            merged_at: merged_at.map(|s| s.to_string()),
            html_url: format!("https://github.com/rfi-irfos/emergent-interaction-lab/pull/{number}"),
            updated_at: updated_at.to_string(),
        }
    }

    // ── filter_shipping_items (pure logic) ──────────────────────────────────

    #[test]
    fn filter_shipping_items_excludes_open_and_closed_without_merge() {
        let pulls = vec![
            pull(1, "Still open — do not leak", "open", None, "2026-07-10T09:00:00Z"),
            pull(2, "Closed without merging", "closed", None, "2026-07-09T09:00:00Z"),
            pull(3, "Merged feature", "closed", Some("2026-07-08T10:00:00Z"), "2026-07-08T10:05:00Z"),
        ];
        let items = filter_shipping_items(pulls);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Merged feature");
        assert_eq!(items[0].merged_at, "2026-07-08T10:00:00Z");
        assert_eq!(items[0].url, "https://github.com/rfi-irfos/emergent-interaction-lab/pull/3");
    }

    #[test]
    fn filter_shipping_items_sorts_newest_merged_first() {
        let pulls = vec![
            pull(1, "Older", "closed", Some("2026-07-01T00:00:00Z"), "2026-07-01T00:00:00Z"),
            pull(2, "Newest", "closed", Some("2026-07-09T00:00:00Z"), "2026-07-09T00:00:00Z"),
            pull(3, "Middle", "closed", Some("2026-07-05T00:00:00Z"), "2026-07-05T00:00:00Z"),
        ];
        let items = filter_shipping_items(pulls);
        let titles: Vec<&str> = items.iter().map(|i| i.title.as_str()).collect();
        assert_eq!(titles, vec!["Newest", "Middle", "Older"]);
    }

    #[test]
    fn filter_shipping_items_caps_at_the_limit() {
        // 20 distinct merge dates (all valid July days) so sorting +
        // truncation both have real work to do, built directly as owned
        // GhPull values rather than through the `pull()` &str helper.
        let pulls: Vec<GhPull> = (0..20)
            .map(|i| GhPull {
                number: i,
                title: format!("PR {i}"),
                state: "closed".to_string(),
                merged_at: Some(format!("2026-07-{:02}T00:00:00Z", i + 1)),
                html_url: format!("https://x/pull/{i}"),
                updated_at: "2026-07-01T00:00:00Z".to_string(),
            })
            .collect();
        let items = filter_shipping_items(pulls);
        assert_eq!(items.len(), SHIPPING_FEED_LIMIT);
    }

    // ── handlers (against a local mock GitHub + in-memory db) ──────────────

    async fn test_state(github_api_base: String, github_token: String) -> AppState {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::emergence::init_schema(&db).await;
        crate::chat::init_schema(&db).await;
        crate::simulation::init_schema(&db).await;
        crate::research::init_schema(&db).await;
        crate::github_activity::init_schema(&db).await;
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
            github_token,
            github_api_base,
        }
    }

    /// Proves the live-stats endpoint returns exactly four bare integers and
    /// never the actual row content, even when that content is present in
    /// the database and deliberately looks like something sensitive.
    #[tokio::test]
    async fn live_stats_returns_bare_counts_only_never_row_content() {
        let state = test_state("http://127.0.0.1:1".to_string(), String::new()).await;

        sqlx::query("INSERT INTO emergence_signals (id, pattern, status, confidence, evolution, observation) VALUES ('s1','p','active','high','stable','SECRET OBSERVATION ONE')")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO emergence_signals (id, pattern, status, confidence, evolution, observation) VALUES ('s2','p','active','high','stable','SECRET OBSERVATION TWO')")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO chat_conversations (id, title) VALUES ('c1','Private Conversation Title')")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO simulation_runs (id, hypothesis) VALUES ('r1','Private Hypothesis Text')")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO research_notes (id, category, title, body) VALUES ('n1','idea','Private Note Title','Private Note Body')")
            .execute(&state.db).await.unwrap();

        let res = live_stats(axum::extract::State(state.clone())).await.into_response();
        assert_eq!(res.status(), axum::http::StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let raw = String::from_utf8(bytes.to_vec()).unwrap();

        // Never leak any of the content-bearing text inserted above.
        assert!(!raw.contains("SECRET"), "response leaked row content: {raw}");
        assert!(!raw.contains("Private"), "response leaked row content: {raw}");

        let body: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let obj = body.as_object().expect("response must be a flat object");
        assert_eq!(obj.len(), 4, "must return exactly the four documented bare counts, nothing else: {raw}");
        assert_eq!(body["emergence_signals"], 2);
        assert_eq!(body["chat_conversations"], 1);
        assert_eq!(body["simulation_runs"], 1);
        assert_eq!(body["research_notes"], 1);
    }

    #[tokio::test]
    async fn live_stats_on_empty_tables_returns_zeros_not_an_error() {
        let state = test_state("http://127.0.0.1:1".to_string(), String::new()).await;
        let res = live_stats(axum::extract::State(state.clone())).await.into_response();
        assert_eq!(res.status(), axum::http::StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["emergence_signals"], 0);
        assert_eq!(body["chat_conversations"], 0);
        assert_eq!(body["simulation_runs"], 0);
        assert_eq!(body["research_notes"], 0);
    }

    async fn mock_pulls_mixed_states() -> AxJson<serde_json::Value> {
        AxJson(json!([
            { "number": 1, "title": "Open PR — in-progress work, must not leak", "state": "open", "merged_at": null, "html_url": "https://x/pull/1", "updated_at": "2026-07-10T09:00:00Z" },
            { "number": 2, "title": "Closed without merging", "state": "closed", "merged_at": null, "html_url": "https://x/pull/2", "updated_at": "2026-07-09T09:00:00Z" },
            { "number": 3, "title": "Merged feature A", "state": "closed", "merged_at": "2026-07-08T10:00:00Z", "html_url": "https://x/pull/3", "updated_at": "2026-07-08T10:05:00Z" },
            { "number": 4, "title": "Merged feature B", "state": "closed", "merged_at": "2026-07-09T10:00:00Z", "html_url": "https://x/pull/4", "updated_at": "2026-07-09T10:05:00Z" }
        ]))
    }

    async fn start_mock_github_pulls_only() -> String {
        let app = Router::new()
            .route("/repos/rfi-irfos/emergent-interaction-lab/pulls", axget(mock_pulls_mixed_states));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    /// End-to-end proof that the handler (not just the pure filter function)
    /// only ever surfaces merged PRs, in the minimal title+date+url shape,
    /// newest first — against a real HTTP round trip to a local mock GitHub,
    /// same pattern github_activity.rs's own tests use.
    #[tokio::test]
    async fn shipping_feed_returns_only_merged_prs_in_minimal_shape() {
        let gh_base = start_mock_github_pulls_only().await;
        let state = test_state(gh_base, "gh_mock_token".to_string()).await;

        let res = shipping_feed(axum::extract::State(state.clone())).await.into_response();
        assert_eq!(res.status(), axum::http::StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let raw = String::from_utf8(bytes.to_vec()).unwrap();

        assert!(!raw.contains("in-progress"), "open PR title leaked: {raw}");
        assert!(!raw.contains("Closed without merging"), "closed-without-merge PR leaked: {raw}");
        // Neither the GitHub token nor internal fields like PR number/state
        // should ever appear in the response.
        assert!(!raw.contains("gh_mock_token"));
        assert!(!raw.contains("\"number\""));
        assert!(!raw.contains("\"state\""));

        let body: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(body["configured"], true);
        let items = body["items"].as_array().unwrap();
        assert_eq!(items.len(), 2, "only the two genuinely merged PRs should appear");
        assert_eq!(items[0]["title"], "Merged feature B");
        assert_eq!(items[0]["merged_at"], "2026-07-09T10:00:00Z");
        assert_eq!(items[0]["url"], "https://x/pull/4");
        assert_eq!(items[1]["title"], "Merged feature A");
        // Exactly the three documented fields per item, nothing more.
        let item_obj = items[0].as_object().unwrap();
        assert_eq!(item_obj.len(), 3, "each item must be exactly title+merged_at+url: {raw}");
    }

    #[tokio::test]
    async fn shipping_feed_missing_github_token_degrades_gracefully() {
        let state = test_state("http://127.0.0.1:1".to_string(), String::new()).await;
        let res = shipping_feed(axum::extract::State(state.clone())).await.into_response();
        assert_eq!(res.status(), axum::http::StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["configured"], false);
        assert_eq!(body["items"].as_array().unwrap().len(), 0);
    }
}
