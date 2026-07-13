use axum::{extract::State, response::IntoResponse, Json};
use serde::Serialize;
use serde_json::json;

use crate::{github_activity, AppState};

/// Public, unauthenticated, visitor-facing widgets for the homepage — the
/// concrete demonstration that content.de.json's hero.subheadline ("keine
/// statische Broschüre, sondern ein live laufendes Forschungsinstrument") is
/// actually true, not just marketing copy. Every endpoint below is
/// deliberately narrow: bare aggregate counts (never row content) for
/// `live_stats`, `signal_levels`, and `simulation_status`; a day-bucketed
/// scalar aggregate (never a raw embedding or per-turn value) for
/// `ccet_trend`; a controlled-vocabulary category/level label (never note or
/// signal text) for `current_focus`; and an already-public GitHub fact — a
/// merged PR's title/date/link — for `shipping_feed`. None of these require
/// or expose any admin secret (`CHAT_API_SECRET`), the NVIDIA key, the
/// Stripe key, the GitHub token itself (`state.github_token` is only ever
/// used server-side to call GitHub, never echoed back), or the `ccet_turns`
/// `embedding` BLOB (never selected by any query in this module, not even
/// for internal aggregation — the SQL aggregates over `stable`/
/// `terms_reused` only).
///
/// No `authz::require_admin` check on any handler below — that omission is
/// intentional, not an oversight; these routes are the whole point of this
/// module.

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

// ── /api/public/signal-levels ───────────────────────────────────────────────

/// Bare per-level counts from `emergence_signals` — the same 4-way split
/// (`level IN ('human','ai','interaction','system')`, see emergence.rs's
/// schema/prompt) the admin Observatory already renders as 4 stat tiles, but
/// here reduced to exactly 4 integers. No `pattern`, `observation`, `scope`,
/// or `source_conversation_id` — the columns that actually carry content —
/// are ever selected by this query, so there is no code path here that could
/// leak signal text even by future accident.
#[derive(Debug, Serialize, PartialEq)]
pub struct SignalLevels {
    pub human: i64,
    pub ai: i64,
    pub interaction: i64,
    pub system: i64,
}

pub async fn signal_levels(State(state): State<AppState>) -> impl IntoResponse {
    let rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT level, COUNT(*) FROM emergence_signals GROUP BY level")
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

    let mut out = SignalLevels { human: 0, ai: 0, interaction: 0, system: 0 };
    for (level, count) in rows {
        match level.as_str() {
            "human" => out.human = count,
            "ai" => out.ai = count,
            "interaction" => out.interaction = count,
            "system" => out.system = count,
            // Schema's CHECK constraint means this shouldn't happen — if it
            // ever does (hand-edited row, future migration), the extra
            // bucket is silently dropped from the public total rather than
            // surfacing an unknown level string.
            _ => {}
        }
    }
    Json(out).into_response()
}

// ── /api/public/ccet-trend ──────────────────────────────────────────────────

/// How many trailing days the trend covers — a visible window, not an
/// all-time average, so the line actually shows movement rather than settling
/// into one flat historical number.
const CCET_TREND_WINDOW_DAYS: i64 = 14;

/// One day's aggregate CEI/Resonance-Frequency — computed with the exact same
/// formulas as `chat::compute_cei`/`chat::compute_resonance_frequency`
/// (stable turns / total turns, reused-terms turns / total turns), just
/// bucketed by day via SQL `GROUP BY` instead of over chat.rs's global
/// rolling window. Deliberately NOT reusing `ccet_turns.embedding` or
/// `similarity_to_prev` here at all — even in aggregate form — per the
/// no-inversion requirement: only the two pre-computed 0/1 flags
/// (`stable`, `terms_reused`) are read, and they're immediately collapsed
/// into a same-day average, never returned per-turn.
#[derive(Debug, Serialize, PartialEq)]
pub struct CcetTrendPoint {
    pub date: String,
    pub cei: f32,
    pub resonance_frequency: f32,
    pub turns: i64,
}

#[derive(Serialize)]
pub struct CcetTrendResp {
    pub window_days: i64,
    pub points: Vec<CcetTrendPoint>,
}

pub async fn ccet_trend(State(state): State<AppState>) -> impl IntoResponse {
    // `stable`/`terms_reused` are INTEGER NOT NULL (0/1) columns — SUM() over
    // an all-integer, all-NOT-NULL column is itself a non-NULL integer in
    // SQLite whenever the GROUP BY produced the row at all (i.e. COUNT(*) >=
    // 1), so plain i64 (not Option<i64>) is the correct, safe decode target.
    let rows: Vec<(String, i64, i64, i64)> = sqlx::query_as(
        "SELECT date(created_at) AS day, COUNT(*) AS total, SUM(stable) AS stable_sum, SUM(terms_reused) AS reused_sum \
         FROM ccet_turns \
         WHERE created_at >= datetime('now', ?1) \
         GROUP BY day ORDER BY day ASC",
    )
    .bind(format!("-{CCET_TREND_WINDOW_DAYS} days"))
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let points = rows
        .into_iter()
        .map(|(date, total, stable_sum, reused_sum)| CcetTrendPoint {
            date,
            cei: stable_sum as f32 / total as f32,
            resonance_frequency: reused_sum as f32 / total as f32,
            turns: total,
        })
        .collect();

    Json(CcetTrendResp { window_days: CCET_TREND_WINDOW_DAYS, points }).into_response()
}

// ── /api/public/current-focus ───────────────────────────────────────────────

/// How recent an emergence signal has to be to count toward "what's active
/// right now" — a short window so this genuinely reads as live activity
/// rather than all-time history repeated back.
const CURRENT_FOCUS_WINDOW_MINUTES: i64 = 30;

/// "What's the research system doing right now" reduced to two bare category/
/// label values — never note title/body, never signal observation/pattern/
/// scope, never a conversation id. `active_level` is whichever of the 4
/// emergence-signal levels fired most often in the last
/// `CURRENT_FOCUS_WINDOW_MINUTES` (ties broken by most recent); `None` when
/// nothing fired in that window at all — an honest "quiet right now" rather
/// than falling back to stale all-time history. `active_category` is simply
/// the category of the single most recently updated research note — again
/// only ever one of the 6 fixed enum values research.rs's schema allows
/// (`paper|hypothesis|idea|concept|framework|prototype`), never its title or
/// body.
#[derive(Debug, Serialize, PartialEq)]
pub struct CurrentFocus {
    pub active_level: Option<String>,
    pub active_category: Option<String>,
    pub window_minutes: i64,
}

pub async fn current_focus(State(state): State<AppState>) -> impl IntoResponse {
    let active_level: Option<String> = sqlx::query_scalar(
        "SELECT level FROM emergence_signals WHERE created_at >= datetime('now', ?1) \
         GROUP BY level ORDER BY COUNT(*) DESC, MAX(created_at) DESC LIMIT 1",
    )
    .bind(format!("-{CURRENT_FOCUS_WINDOW_MINUTES} minutes"))
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let active_category: Option<String> =
        sqlx::query_scalar("SELECT category FROM research_notes ORDER BY updated_at DESC LIMIT 1")
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();

    Json(CurrentFocus { active_level, active_category, window_minutes: CURRENT_FOCUS_WINDOW_MINUTES }).into_response()
}

// ── /api/public/simulation-status ───────────────────────────────────────────

/// Bare per-status counts from `simulation_runs` — the same
/// pending/complete/error split `STATUS_ACCENT` in SimulationLab.tsx already
/// renders, reduced to exactly 3 integers. No `hypothesis`, `parameters`,
/// `narrative`, or `related_signal_ids` — the columns that actually carry
/// content — are ever selected by this query.
#[derive(Debug, Serialize, PartialEq)]
pub struct SimulationStatusTally {
    pub pending: i64,
    pub complete: i64,
    pub error: i64,
}

pub async fn simulation_status(State(state): State<AppState>) -> impl IntoResponse {
    let rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT status, COUNT(*) FROM simulation_runs GROUP BY status")
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

    let mut out = SimulationStatusTally { pending: 0, complete: 0, error: 0 };
    for (status, count) in rows {
        match status.as_str() {
            "pending" => out.pending = count,
            "complete" => out.complete = count,
            "error" => out.error = count,
            // No CHECK constraint on this column (unlike emergence_signals.level)
            // — a future/legacy status string is silently dropped from the
            // public total rather than surfacing an unknown bucket.
            _ => {}
        }
    }
    Json(out).into_response()
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
            stripe_webhook_secret: String::new(),
            ddg_api_base: "https://api.duckduckgo.com".to_string(),
            hermes_url: String::new(),
            hermes_api_key: String::new(),
            hermes_boot_grace: crate::hermes::HERMES_BOOT_GRACE,
            mcp_token: String::new(),
            audit_lock: std::sync::Arc::new(tokio::sync::Mutex::new(())),
            github_token,
            github_api_base,
            eil_github_token: String::new(),
            eil_github_repo: String::new(),
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

    // ── signal_levels ────────────────────────────────────────────────────

    /// Proves the endpoint returns exactly four bare per-level integers and
    /// never the actual pattern/observation/scope/source_conversation_id
    /// content, even when that content is present and deliberately looks
    /// like something sensitive.
    #[tokio::test]
    async fn signal_levels_returns_bare_counts_only_never_row_content() {
        let state = test_state("http://127.0.0.1:1".to_string(), String::new()).await;

        sqlx::query("INSERT INTO emergence_signals (id, pattern, level, status, confidence, evolution, observation, scope, source_conversation_id) VALUES ('s1','SECRET PATTERN','human','active','high','stable','SECRET OBSERVATION','SECRET SCOPE','SECRET-CONV-ID')")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO emergence_signals (id, pattern, level, status, confidence, evolution, observation) VALUES ('s2','p2','human','active','high','stable','o2')")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO emergence_signals (id, pattern, level, status, confidence, evolution, observation) VALUES ('s3','p3','ai','active','high','stable','o3')")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO emergence_signals (id, pattern, level, status, confidence, evolution, observation) VALUES ('s4','p4','system','active','high','stable','o4')")
            .execute(&state.db).await.unwrap();

        let res = signal_levels(axum::extract::State(state.clone())).await.into_response();
        assert_eq!(res.status(), axum::http::StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let raw = String::from_utf8(bytes.to_vec()).unwrap();

        assert!(!raw.contains("SECRET"), "response leaked row content: {raw}");

        let body: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let obj = body.as_object().expect("response must be a flat object");
        assert_eq!(obj.len(), 4, "must return exactly the four documented level counts, nothing else: {raw}");
        assert_eq!(body["human"], 2);
        assert_eq!(body["ai"], 1);
        assert_eq!(body["interaction"], 0);
        assert_eq!(body["system"], 1);
    }

    #[tokio::test]
    async fn signal_levels_on_empty_table_returns_zeros_not_an_error() {
        let state = test_state("http://127.0.0.1:1".to_string(), String::new()).await;
        let res = signal_levels(axum::extract::State(state.clone())).await.into_response();
        assert_eq!(res.status(), axum::http::StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["human"], 0);
        assert_eq!(body["ai"], 0);
        assert_eq!(body["interaction"], 0);
        assert_eq!(body["system"], 0);
    }

    // ── ccet_trend ───────────────────────────────────────────────────────

    /// Inserts a `ccet_turns` row directly (bypassing the real NVIDIA embed
    /// call), with a deliberately identifiable `conversation_id` and a
    /// non-trivial embedding blob, so the leakage test below has something
    /// concrete to prove is never echoed back. `days_ago` controls which
    /// day-bucket (and, for large values, whether the row falls outside the
    /// trend window at all) the row lands in.
    async fn insert_ccet_turn(db: &sqlx::SqlitePool, id: &str, conversation_id: &str, stable: i64, terms_reused: i64, days_ago: i64) {
        sqlx::query(
            "INSERT INTO ccet_turns (id, conversation_id, embedding, similarity_to_prev, stable, prev_stable, terms_reused, created_at) \
             VALUES (?1, ?2, ?3, 0.91, ?4, 1, ?5, datetime('now', ?6))",
        )
        .bind(id)
        .bind(conversation_id)
        .bind(vec![0xDEu8, 0xAD, 0xBE, 0xEF, 0x00, 0x01])
        .bind(stable)
        .bind(terms_reused)
        .bind(format!("-{days_ago} days"))
        .execute(db)
        .await
        .unwrap();
    }

    /// Proves the trend endpoint returns only day-bucketed CEI/Resonance-
    /// Frequency scalars + a turn count — never the conversation id, the
    /// embedding blob/field, or a raw per-turn similarity value that the
    /// no-inversion requirement forbids.
    #[tokio::test]
    async fn ccet_trend_returns_bucketed_aggregates_never_embedding_or_conversation_id() {
        let state = test_state("http://127.0.0.1:1".to_string(), String::new()).await;
        // Today's bucket: 3 turns, 2 stable, 1 terms_reused.
        insert_ccet_turn(&state.db, "t1", "SECRET-CONV-ID-1", 1, 1, 0).await;
        insert_ccet_turn(&state.db, "t2", "SECRET-CONV-ID-1", 1, 0, 0).await;
        insert_ccet_turn(&state.db, "t3", "SECRET-CONV-ID-1", 0, 0, 0).await;

        let res = ccet_trend(axum::extract::State(state.clone())).await.into_response();
        assert_eq!(res.status(), axum::http::StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let raw = String::from_utf8(bytes.to_vec()).unwrap();

        assert!(!raw.contains("SECRET"), "conversation id leaked into the public trend: {raw}");
        assert!(!raw.contains("embedding"), "embedding field/blob leaked into the public trend: {raw}");
        assert!(!raw.contains("conversation_id"), "conversation_id field leaked into the public trend: {raw}");
        assert!(!raw.contains("similarity"), "raw per-turn similarity leaked into the public trend: {raw}");
        assert!(!raw.contains("0.91"), "raw per-turn similarity value leaked into the public trend: {raw}");

        let body: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(body["window_days"], CCET_TREND_WINDOW_DAYS);
        let points = body["points"].as_array().unwrap();
        assert_eq!(points.len(), 1, "all three turns land in today's single day-bucket");
        assert_eq!(points[0]["turns"], 3);
        assert!((points[0]["cei"].as_f64().unwrap() - (2.0 / 3.0)).abs() < 0.01, "{}", points[0]);
        assert!((points[0]["resonance_frequency"].as_f64().unwrap() - (1.0 / 3.0)).abs() < 0.01, "{}", points[0]);
        let point_obj = points[0].as_object().unwrap();
        assert_eq!(point_obj.len(), 4, "each point must be exactly date+cei+resonance_frequency+turns: {raw}");
    }

    #[tokio::test]
    async fn ccet_trend_excludes_turns_older_than_the_window() {
        let state = test_state("http://127.0.0.1:1".to_string(), String::new()).await;
        insert_ccet_turn(&state.db, "old1", "old-conv", 1, 1, CCET_TREND_WINDOW_DAYS + 5).await;
        insert_ccet_turn(&state.db, "new1", "new-conv", 1, 0, 0).await;

        let res = ccet_trend(axum::extract::State(state.clone())).await.into_response();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let points = body["points"].as_array().unwrap();
        assert_eq!(points.len(), 1, "the turn beyond the window must not appear: {body}");
        assert_eq!(points[0]["turns"], 1);
    }

    #[tokio::test]
    async fn ccet_trend_on_empty_table_returns_empty_points_not_an_error() {
        let state = test_state("http://127.0.0.1:1".to_string(), String::new()).await;
        let res = ccet_trend(axum::extract::State(state.clone())).await.into_response();
        assert_eq!(res.status(), axum::http::StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["points"].as_array().unwrap().len(), 0);
    }

    // ── current_focus ────────────────────────────────────────────────────

    /// Proves the endpoint returns only the controlled-vocabulary
    /// level/category labels — never the signal's pattern/observation/
    /// scope/source_conversation_id, and never the note's title/body.
    #[tokio::test]
    async fn current_focus_returns_labels_only_never_note_or_signal_content() {
        let state = test_state("http://127.0.0.1:1".to_string(), String::new()).await;
        sqlx::query("INSERT INTO emergence_signals (id, pattern, level, status, confidence, evolution, observation, scope, source_conversation_id) VALUES ('s1','SECRET PATTERN','system','active','high','stable','SECRET OBSERVATION','SECRET SCOPE','SECRET-CONV-ID')")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO research_notes (id, category, title, body) VALUES ('n1','idea','SECRET NOTE TITLE','SECRET NOTE BODY')")
            .execute(&state.db).await.unwrap();

        let res = current_focus(axum::extract::State(state.clone())).await.into_response();
        assert_eq!(res.status(), axum::http::StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let raw = String::from_utf8(bytes.to_vec()).unwrap();

        assert!(!raw.contains("SECRET"), "response leaked note/signal content: {raw}");

        let body: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(body["active_level"], "system");
        assert_eq!(body["active_category"], "idea");
        assert_eq!(body["window_minutes"], CURRENT_FOCUS_WINDOW_MINUTES);
        let obj = body.as_object().unwrap();
        assert_eq!(obj.len(), 3, "must return exactly active_level+active_category+window_minutes, nothing else: {raw}");
    }

    #[tokio::test]
    async fn current_focus_ignores_signals_older_than_the_window() {
        let state = test_state("http://127.0.0.1:1".to_string(), String::new()).await;
        sqlx::query(
            "INSERT INTO emergence_signals (id, pattern, level, status, confidence, evolution, observation, created_at) \
             VALUES ('old','p','ai','active','high','stable','o', datetime('now', ?1))",
        )
        .bind(format!("-{} minutes", CURRENT_FOCUS_WINDOW_MINUTES + 15))
        .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO emergence_signals (id, pattern, level, status, confidence, evolution, observation) VALUES ('new','p','human','active','high','stable','o')")
            .execute(&state.db).await.unwrap();

        let res = current_focus(axum::extract::State(state.clone())).await.into_response();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["active_level"], "human", "only the in-window signal should be picked as active: {body}");
    }

    #[tokio::test]
    async fn current_focus_on_empty_tables_returns_nulls_not_an_error() {
        let state = test_state("http://127.0.0.1:1".to_string(), String::new()).await;
        let res = current_focus(axum::extract::State(state.clone())).await.into_response();
        assert_eq!(res.status(), axum::http::StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["active_level"], serde_json::Value::Null);
        assert_eq!(body["active_category"], serde_json::Value::Null);
    }

    // ── simulation_status ────────────────────────────────────────────────

    /// Proves the endpoint returns exactly three bare per-status integers
    /// and never the actual hypothesis/narrative content.
    #[tokio::test]
    async fn simulation_status_returns_bare_counts_only_never_row_content() {
        let state = test_state("http://127.0.0.1:1".to_string(), String::new()).await;

        sqlx::query("INSERT INTO simulation_runs (id, hypothesis, status) VALUES ('r1','SECRET HYPOTHESIS ONE','pending')")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO simulation_runs (id, hypothesis, narrative, status) VALUES ('r2','SECRET HYPOTHESIS TWO','SECRET NARRATIVE','complete')")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO simulation_runs (id, hypothesis, narrative, status) VALUES ('r3','SECRET HYPOTHESIS THREE','SECRET ERROR TEXT','error')")
            .execute(&state.db).await.unwrap();
        sqlx::query("INSERT INTO simulation_runs (id, hypothesis, status) VALUES ('r4','SECRET HYPOTHESIS FOUR','pending')")
            .execute(&state.db).await.unwrap();

        let res = simulation_status(axum::extract::State(state.clone())).await.into_response();
        assert_eq!(res.status(), axum::http::StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let raw = String::from_utf8(bytes.to_vec()).unwrap();

        assert!(!raw.contains("SECRET"), "response leaked row content: {raw}");

        let body: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let obj = body.as_object().expect("response must be a flat object");
        assert_eq!(obj.len(), 3, "must return exactly the three documented status counts, nothing else: {raw}");
        assert_eq!(body["pending"], 2);
        assert_eq!(body["complete"], 1);
        assert_eq!(body["error"], 1);
    }

    #[tokio::test]
    async fn simulation_status_on_empty_table_returns_zeros_not_an_error() {
        let state = test_state("http://127.0.0.1:1".to_string(), String::new()).await;
        let res = simulation_status(axum::extract::State(state.clone())).await.into_response();
        assert_eq!(res.status(), axum::http::StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["pending"], 0);
        assert_eq!(body["complete"], 0);
        assert_eq!(body["error"], 0);
    }
}
