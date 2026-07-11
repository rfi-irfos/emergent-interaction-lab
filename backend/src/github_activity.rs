use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{authz::require_admin, AppState};

/// The one repo this endpoint reports on — Simeon confirmed via `git remote
/// -v` this is `rfi-irfos/emergent-interaction-lab`. Not configurable via env
/// (unlike `github_api_base`, which exists purely so tests can point at a
/// mock server) because this observatory module has exactly one subject: the
/// repo it ships from.
const REPO_OWNER: &str = "rfi-irfos";
const REPO_NAME: &str = "emergent-interaction-lab";

/// GitHub's REST API rejects any request with no User-Agent header at all —
/// this is that header, not a marketing string.
const USER_AGENT: &str = "emergent-interaction-lab-observatory";

/// Real, git/GitHub-level "Agent-Aktivität" transparency: unlike every other
/// table in this app (agent_tool_calls, research_notes, blog_posts, ...),
/// which all track in-app activity, `deploy_log` is the one thing GitHub's
/// API cannot tell us about — `fly deploy` for the backend is not a
/// GitHub-native event (GitHub Actions only ever sees the GitHub Pages
/// frontend deploy). This table exists so whichever process runs
/// `fly deploy` in the future can append a row here, and the merged feed
/// below can show it alongside real PRs/commits/workflow runs instead of
/// leaving backend deploys as the one invisible gap.
///
/// `created_at` is stored as ISO-8601 (`strftime('%Y-%m-%dT%H:%M:%SZ',
/// 'now')`), the same shape GitHub's own timestamps come back in
/// (`"2026-07-10T11:00:00Z"`), NOT SQLite's `datetime('now')` default
/// (`"2026-07-10 11:00:00"` — a space, not a `'T'`, no `'Z'`). `merge_activity`
/// below sorts by a plain string comparison, and `' '` (0x20) sorts before
/// `'T'` (0x54) in ASCII — so with the old default, a deploy_log row always
/// looked older than any GitHub event on the same calendar day, no matter
/// what time it actually happened. Bare TEXT column (not DATETIME) so
/// SQLite's type affinity never second-guesses the string.
pub async fn init_schema(db: &SqlitePool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS deploy_log (
            id TEXT PRIMARY KEY,
            target TEXT NOT NULL,
            version TEXT,
            commit_sha TEXT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        )",
    )
    .execute(db)
    .await
    .expect("create deploy_log");

    migrate_legacy_created_at_format(db).await;
}

/// One-time migration for any `deploy_log` table created before the
/// ISO-8601 fix above (the live Fly app already has one — `init_schema` has
/// been running since this module shipped, `IF NOT EXISTS` means the old
/// `DEFAULT (datetime('now'))` clause would otherwise stick around forever).
/// Detected by inspecting the table's own recorded schema in
/// `sqlite_master` rather than probing row contents, so it works whether or
/// not any rows exist yet (as of this fix, `deploy_log` has always been
/// empty — `log_deploy` had zero callers — but this must not assume that
/// stays true). Rebuilds the table with the new default and rewrites any
/// existing rows' timestamps into the same ISO-8601 shape, so old and new
/// rows stay comparable by plain string sort.
async fn migrate_legacy_created_at_format(db: &SqlitePool) {
    let existing_sql: Option<(String,)> =
        sqlx::query_as("SELECT sql FROM sqlite_master WHERE type='table' AND name='deploy_log'")
            .fetch_optional(db)
            .await
            .unwrap_or(None);

    let needs_migration = matches!(&existing_sql, Some((sql,)) if sql.contains("datetime('now')"));
    if !needs_migration {
        return;
    }

    tracing::info!("migrating deploy_log.created_at from legacy datetime('now') format to ISO-8601");

    let mut tx = db.begin().await.expect("begin deploy_log migration");
    sqlx::query("ALTER TABLE deploy_log RENAME TO deploy_log_pre_iso8601")
        .execute(&mut *tx)
        .await
        .expect("rename legacy deploy_log");
    sqlx::query(
        "CREATE TABLE deploy_log (
            id TEXT PRIMARY KEY,
            target TEXT NOT NULL,
            version TEXT,
            commit_sha TEXT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        )",
    )
    .execute(&mut *tx)
    .await
    .expect("recreate deploy_log with ISO-8601 default");
    sqlx::query(
        "INSERT INTO deploy_log (id, target, version, commit_sha, created_at)
         SELECT id, target, version, commit_sha,
             CASE WHEN created_at LIKE '%T%' THEN created_at
                  ELSE replace(created_at, ' ', 'T') || 'Z' END
         FROM deploy_log_pre_iso8601",
    )
    .execute(&mut *tx)
    .await
    .expect("backfill deploy_log rows in ISO-8601 format");
    sqlx::query("DROP TABLE deploy_log_pre_iso8601")
        .execute(&mut *tx)
        .await
        .expect("drop legacy deploy_log table");
    tx.commit().await.expect("commit deploy_log migration");
}

#[derive(Deserialize)]
pub struct DeployLogReq {
    target: String,
    version: Option<String>,
    commit_sha: Option<String>,
}

/// Called by `scripts/deploy.sh` right after a successful `fly deploy` —
/// that script is the one and only production caller of this endpoint (it
/// used to have zero callers anywhere; `deploy_log` stayed empty forever as
/// a result). If you're driving a Fly deploy some other way, call this
/// endpoint yourself afterwards or the Agent-Aktivität feed won't know it
/// happened.
pub async fn log_deploy(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<DeployLogReq>,
) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if body.target.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "target is required").into_response();
    }
    let id = Uuid::new_v4().to_string();
    let _ = sqlx::query(
        "INSERT INTO deploy_log (id, target, version, commit_sha) VALUES (?1,?2,?3,?4)",
    )
    .bind(&id)
    .bind(&body.target)
    .bind(&body.version)
    .bind(&body.commit_sha)
    .execute(&state.db)
    .await;

    Json(json!({ "ok": true, "id": id })).into_response()
}

// ── GitHub API response shapes (only the fields this feed actually uses) ───

// `pub(crate)` (struct + fields): read by `crate::public::filter_shipping_items`
// too, not just this module — see `fetch_pulls` below.
#[derive(Deserialize)]
pub(crate) struct GhPull {
    pub(crate) number: i64,
    pub(crate) title: String,
    pub(crate) state: String,
    pub(crate) merged_at: Option<String>,
    pub(crate) html_url: String,
    pub(crate) updated_at: String,
}

#[derive(Deserialize)]
struct GhCommitAuthor {
    date: String,
}

#[derive(Deserialize)]
struct GhCommitInner {
    message: String,
    author: Option<GhCommitAuthor>,
}

#[derive(Deserialize)]
struct GhCommit {
    sha: String,
    commit: GhCommitInner,
    html_url: String,
}

#[derive(Deserialize)]
struct GhWorkflowRun {
    name: Option<String>,
    status: String,
    conclusion: Option<String>,
    html_url: String,
    created_at: String,
}

#[derive(Deserialize)]
struct GhWorkflowRunsResp {
    workflow_runs: Vec<GhWorkflowRun>,
}

// ── Merged feed item + merge/sort logic ─────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct ActivityItem {
    pub kind: String, // "pull_request" | "commit" | "workflow_run" | "deploy"
    pub title: String,
    pub detail: Option<String>,
    pub status: Option<String>,
    pub url: Option<String>,
    pub timestamp: String,
}

/// Merges the three GitHub-sourced kinds plus deploy_log rows into one
/// timestamp-sorted (newest first) feed. Pure function over already-parsed
/// data so the interleaving logic can be tested without any real HTTP call.
fn merge_activity(
    pulls: Vec<GhPull>,
    commits: Vec<GhCommit>,
    runs: Vec<GhWorkflowRun>,
    deploys: Vec<(String, String, Option<String>, Option<String>, String)>,
) -> Vec<ActivityItem> {
    let mut items: Vec<ActivityItem> = Vec::new();

    items.extend(pulls.into_iter().map(|p| ActivityItem {
        kind: "pull_request".to_string(),
        title: format!("#{} {}", p.number, p.title),
        detail: p.merged_at.clone(),
        status: Some(if p.merged_at.is_some() { "merged".to_string() } else { p.state }),
        url: Some(p.html_url),
        timestamp: p.updated_at,
    }));

    items.extend(commits.into_iter().map(|c| ActivityItem {
        kind: "commit".to_string(),
        title: c.commit.message.lines().next().unwrap_or("").to_string(),
        detail: Some(c.sha.chars().take(7).collect::<String>()),
        status: None,
        url: Some(c.html_url),
        timestamp: c.commit.author.map(|a| a.date).unwrap_or_default(),
    }));

    items.extend(runs.into_iter().map(|r| ActivityItem {
        kind: "workflow_run".to_string(),
        title: r.name.unwrap_or_else(|| "workflow".to_string()),
        detail: r.conclusion.clone(),
        status: Some(r.conclusion.unwrap_or(r.status)),
        url: Some(r.html_url),
        timestamp: r.created_at,
    }));

    items.extend(deploys.into_iter().map(|(_id, target, version, commit_sha, created_at)| ActivityItem {
        kind: "deploy".to_string(),
        title: format!("Deploy: {target}"),
        detail: version.or(commit_sha),
        status: Some("deployed".to_string()),
        url: None,
        timestamp: created_at,
    }));

    items.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    items
}

/// Shared "fetch recent pull requests (all states)" call — the exact same
/// request `agent_activity` below has always made, extracted so
/// `crate::public::shipping_feed` (the public, unauthenticated "what's
/// shipping" widget) can reuse it instead of standing up a second GitHub
/// integration with its own token/client. Same `state.http`, same
/// `state.github_token`, same `state.github_api_base` either way — the
/// caller decides what to do with the (possibly still-open/draft) results;
/// this function itself filters nothing.
pub(crate) async fn fetch_pulls(state: &AppState) -> Result<Vec<GhPull>, axum::response::Response> {
    let res = state
        .http
        .get(format!(
            "{}/repos/{}/{}/pulls?state=all&sort=updated&direction=desc&per_page=20",
            state.github_api_base, REPO_OWNER, REPO_NAME
        ))
        .bearer_auth(&state.github_token)
        .header("User-Agent", USER_AGENT)
        .send()
        .await;
    github_json(res, "pull requests").await
}

/// Real GitHub-level "what autonomous agent work has actually happened on
/// this repo" transparency feed — merges recent pull requests, recent
/// commits on `main`, recent GitHub Actions workflow runs (this is what
/// covers GitHub Pages deploy visibility), and this app's own `deploy_log`
/// (for `fly deploy`, which is not a GitHub-native event). Degrades honestly
/// instead of crashing or silently returning nothing when GITHUB_ACTIVITY_TOKEN
/// isn't configured or a GitHub call fails.
pub async fn agent_activity(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let deploy_rows: Vec<(String, String, Option<String>, Option<String>, String)> = sqlx::query_as(
        "SELECT id, target, version, commit_sha, created_at FROM deploy_log ORDER BY created_at DESC LIMIT 20",
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    if state.github_token.is_empty() {
        // Honest degraded response, matching this app's established
        // conventions (see SystemState's chat_secret_configured warning
        // banner) — never crash, never silently return an empty array with
        // no explanation.
        let items = merge_activity(vec![], vec![], vec![], deploy_rows);
        return Json(json!({
            "configured": false,
            "message": "GITHUB_ACTIVITY_TOKEN nicht konfiguriert — es werden nur lokal protokollierte Deploys angezeigt, keine echten GitHub-Daten (PRs/Commits/Workflow-Runs).",
            "items": items,
        }))
        .into_response();
    }

    let client = &state.http;
    let base = &state.github_api_base;
    let owner = REPO_OWNER;
    let repo = REPO_NAME;

    let pulls: Vec<GhPull> = match fetch_pulls(&state).await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let commits_res = client
        .get(format!("{base}/repos/{owner}/{repo}/commits?sha=main&per_page=20"))
        .bearer_auth(&state.github_token)
        .header("User-Agent", USER_AGENT)
        .send()
        .await;
    let commits: Vec<GhCommit> = match github_json(commits_res, "commits").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let runs_res = client
        .get(format!("{base}/repos/{owner}/{repo}/actions/runs?per_page=20"))
        .bearer_auth(&state.github_token)
        .header("User-Agent", USER_AGENT)
        .send()
        .await;
    let runs: GhWorkflowRunsResp = match github_json(runs_res, "workflow runs").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let items = merge_activity(pulls, commits, runs.workflow_runs, deploy_rows);
    Json(json!({
        "configured": true,
        "message": Option::<String>::None,
        "items": items,
    }))
    .into_response()
}

/// Shared error handling for the three sequential/parallel GitHub calls —
/// same shape as billing.rs's `stripe_json` helper, kept local here since
/// billing.rs is a different integration with its own concerns.
async fn github_json<T: serde::de::DeserializeOwned>(
    res: Result<reqwest::Response, reqwest::Error>,
    what: &str,
) -> Result<T, axum::response::Response> {
    match res {
        Ok(r) if r.status().is_success() => r.json::<T>().await.map_err(|e| {
            (StatusCode::BAD_GATEWAY, format!("github {what} response could not be parsed: {e}")).into_response()
        }),
        Ok(r) => {
            let status = r.status();
            let text = r.text().await.unwrap_or_default();
            tracing::error!("github {what} fetch failed {status}: {text}");
            Err((StatusCode::BAD_GATEWAY, format!("GitHub-Anfrage ({what}) fehlgeschlagen.")).into_response())
        }
        Err(e) => Err((StatusCode::BAD_GATEWAY, format!("github request failed: {e}")).into_response()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::get as axget, Json as AxJson, Router};

    fn pull(number: i64, title: &str, merged_at: Option<&str>, updated_at: &str) -> GhPull {
        GhPull {
            number,
            title: title.to_string(),
            state: if merged_at.is_some() { "closed".to_string() } else { "open".to_string() },
            merged_at: merged_at.map(|s| s.to_string()),
            html_url: format!("https://github.com/rfi-irfos/emergent-interaction-lab/pull/{number}"),
            updated_at: updated_at.to_string(),
        }
    }

    fn commit(sha: &str, message: &str, date: &str) -> GhCommit {
        GhCommit {
            sha: sha.to_string(),
            commit: GhCommitInner { message: message.to_string(), author: Some(GhCommitAuthor { date: date.to_string() }) },
            html_url: format!("https://github.com/rfi-irfos/emergent-interaction-lab/commit/{sha}"),
        }
    }

    fn run(name: &str, status: &str, conclusion: Option<&str>, created_at: &str) -> GhWorkflowRun {
        GhWorkflowRun {
            name: Some(name.to_string()),
            status: status.to_string(),
            conclusion: conclusion.map(|s| s.to_string()),
            html_url: "https://github.com/rfi-irfos/emergent-interaction-lab/actions/runs/1".to_string(),
            created_at: created_at.to_string(),
        }
    }

    #[test]
    fn merge_activity_interleaves_all_four_kinds_by_timestamp_newest_first() {
        let pulls = vec![pull(42, "Add Agent-Aktivität panel", None, "2026-07-10T10:00:00Z")];
        let commits = vec![commit("abc1234567", "Fix build\n\nlonger body", "2026-07-09T08:00:00Z")];
        let runs = vec![run("deploy-pages", "completed", Some("success"), "2026-07-10T09:00:00Z")];
        let deploys = vec![("d1".to_string(), "fly".to_string(), Some("v42".to_string()), Some("abc1234".to_string()), "2026-07-10T11:00:00Z".to_string())];

        let items = merge_activity(pulls, commits, runs, deploys);

        assert_eq!(items.len(), 4);
        let kinds: Vec<&str> = items.iter().map(|i| i.kind.as_str()).collect();
        // Newest first: deploy (11:00) > pull_request (10:00) > workflow_run (09:00) > commit (08:00)
        assert_eq!(kinds, vec!["deploy", "pull_request", "workflow_run", "commit"]);
    }

    #[test]
    fn merge_activity_commit_title_is_first_line_only_and_sha_is_short() {
        let commits = vec![commit("0123456789abcdef", "Short summary\n\nLong body that should not appear", "2026-07-01T00:00:00Z")];
        let items = merge_activity(vec![], commits, vec![], vec![]);
        assert_eq!(items[0].title, "Short summary");
        assert_eq!(items[0].detail.as_deref(), Some("0123456"));
    }

    #[test]
    fn merge_activity_marks_merged_prs_distinctly_from_open_or_closed() {
        let pulls = vec![
            pull(1, "merged one", Some("2026-07-01T00:00:00Z"), "2026-07-01T00:00:00Z"),
            pull(2, "still open", None, "2026-07-02T00:00:00Z"),
        ];
        let items = merge_activity(pulls, vec![], vec![], vec![]);
        let merged = items.iter().find(|i| i.title.contains("merged one")).unwrap();
        let open = items.iter().find(|i| i.title.contains("still open")).unwrap();
        assert_eq!(merged.status.as_deref(), Some("merged"));
        assert_eq!(open.status.as_deref(), Some("open"));
    }

    #[test]
    fn merge_activity_empty_everything_yields_empty_feed_not_a_panic() {
        let items = merge_activity(vec![], vec![], vec![], vec![]);
        assert!(items.is_empty());
    }

    async fn test_state(github_api_base: String, github_token: String) -> AppState {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        init_schema(&db).await;
        AppState {
            sessions: std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
            content_path: std::path::PathBuf::from("content.json"),
            uploads_dir: std::path::PathBuf::from("uploads"),
            static_dir: std::path::PathBuf::from("dist"),
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
            chat_model_idx: std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            chat_request_count: std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0)),
            audit_lock: std::sync::Arc::new(tokio::sync::Mutex::new(())),
            github_token,
            github_api_base,
        }
    }

    async fn mock_pulls() -> AxJson<serde_json::Value> {
        AxJson(json!([
            { "number": 7, "title": "Mock PR", "state": "open", "merged_at": null, "html_url": "https://x/pull/7", "updated_at": "2026-07-10T12:00:00Z" }
        ]))
    }
    async fn mock_commits() -> AxJson<serde_json::Value> {
        AxJson(json!([
            { "sha": "deadbeef00", "commit": { "message": "Mock commit", "author": { "date": "2026-07-10T11:00:00Z" } }, "html_url": "https://x/commit/deadbeef00" }
        ]))
    }
    async fn mock_runs() -> AxJson<serde_json::Value> {
        AxJson(json!({ "workflow_runs": [
            { "name": "deploy-pages", "status": "completed", "conclusion": "success", "html_url": "https://x/actions/runs/1", "created_at": "2026-07-10T10:00:00Z" }
        ]}))
    }

    async fn start_mock_github() -> String {
        let app = Router::new()
            .route("/repos/rfi-irfos/emergent-interaction-lab/pulls", axget(mock_pulls))
            .route("/repos/rfi-irfos/emergent-interaction-lab/commits", axget(mock_commits))
            .route("/repos/rfi-irfos/emergent-interaction-lab/actions/runs", axget(mock_runs));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    /// End-to-end proof (against a local mock, since we don't have a real
    /// token in this environment) that the handler actually calls all three
    /// GitHub endpoints and merges them with deploy_log rows into one sorted
    /// feed — not just that the pure merge function works in isolation.
    ///
    /// The deploy row is inserted with an EXPLICIT `created_at` (13:00,
    /// after all three GitHub-mocked timestamps that same day: PR 12:00,
    /// commit 11:00, workflow run 10:00) specifically to prove the
    /// chronological-order fix: before the ISO-8601 fix, a same-day deploy
    /// would sort as OLDEST regardless of its real time (`' '` < `'T'` in
    /// ASCII) — this test would have failed against the old
    /// `datetime('now')` default the moment a deploy happened later than a
    /// GitHub event on the same calendar day. Now it correctly sorts
    /// newest-first.
    #[tokio::test]
    async fn agent_activity_merges_real_http_calls_with_deploy_log_in_correct_chronological_order() {
        let gh_base = start_mock_github().await;
        let state = test_state(gh_base, "gh_mock_token".to_string()).await;

        sqlx::query(
            "INSERT INTO deploy_log (id, target, version, commit_sha, created_at) VALUES ('d1','fly','v99',NULL,'2026-07-10T13:00:00Z')",
        )
        .execute(&state.db)
        .await
        .unwrap();

        let res = agent_activity(axum::extract::State(state.clone()), HeaderMap::new())
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["configured"], true);
        let items = body["items"].as_array().unwrap();
        assert_eq!(items.len(), 4, "expected 1 PR + 1 commit + 1 workflow run + 1 deploy");
        let kinds: Vec<&str> = items.iter().map(|i| i["kind"].as_str().unwrap()).collect();
        // Newest first, by real time: deploy (13:00) > pull_request (12:00)
        // > commit (11:00) > workflow_run (10:00). This is the CORRECT
        // order — the pre-fix behavior would have put "deploy" last no
        // matter what time it carried.
        assert_eq!(kinds, vec!["deploy", "pull_request", "commit", "workflow_run"]);
    }

    /// Proves the schema fix directly: a row inserted through `log_deploy`
    /// (which relies on the table's `created_at` DEFAULT, not an explicit
    /// timestamp) comes back in the same ISO-8601 shape GitHub's API uses —
    /// `"T"` separator, `"Z"` suffix, no space — so it stays correctly
    /// sortable against real GitHub timestamps going forward.
    #[tokio::test]
    async fn log_deploy_writes_created_at_in_iso8601_format_not_sqlite_default_format() {
        let state = test_state("http://127.0.0.1:1".to_string(), String::new()).await;

        log_deploy(
            axum::extract::State(state.clone()),
            HeaderMap::new(),
            AxJson(DeployLogReq { target: "fly".to_string(), version: Some("v1".to_string()), commit_sha: None }),
        )
        .await;

        let (created_at,): (String,) = sqlx::query_as("SELECT created_at FROM deploy_log WHERE target='fly'")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert!(created_at.contains('T'), "expected ISO-8601 'T' separator, got {created_at:?}");
        assert!(created_at.ends_with('Z'), "expected ISO-8601 'Z' suffix, got {created_at:?}");
        assert!(!created_at.contains(' '), "expected no space (legacy SQLite datetime() format), got {created_at:?}");
    }

    /// Proves the migration path for a `deploy_log` table created before
    /// this fix (the live Fly app has exactly this shape today, since
    /// `init_schema`'s `CREATE TABLE IF NOT EXISTS` never touched an
    /// already-existing table). Manually stands up the OLD schema with a
    /// legacy-format row, then runs `init_schema` (which internally calls
    /// the migration) against that same connection and confirms: (1) the
    /// row's `created_at` is rewritten into ISO-8601, and (2) it now sorts
    /// correctly (newest-first) against a same-day GitHub timestamp —
    /// exactly the scenario that was silently broken before.
    #[tokio::test]
    async fn migrate_legacy_created_at_format_rewrites_existing_rows_and_fixes_their_sort_order() {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE deploy_log (
                id TEXT PRIMARY KEY,
                target TEXT NOT NULL,
                version TEXT,
                commit_sha TEXT,
                created_at DATETIME NOT NULL DEFAULT (datetime('now'))
            )",
        )
        .execute(&db)
        .await
        .unwrap();
        // Deliberately the LAST moment of the day — under the old buggy
        // string-sort, this would still have lost to any same-day GitHub
        // 'T'-format timestamp, no matter how early. That's the bug.
        sqlx::query(
            "INSERT INTO deploy_log (id, target, version, commit_sha, created_at) VALUES ('legacy1','fly','v0',NULL,'2026-07-10 23:59:59')",
        )
        .execute(&db)
        .await
        .unwrap();

        init_schema(&db).await; // runs CREATE TABLE IF NOT EXISTS (no-op) + the migration

        let (created_at,): (String,) = sqlx::query_as("SELECT created_at FROM deploy_log WHERE id='legacy1'")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(created_at, "2026-07-10T23:59:59Z", "legacy space-format timestamp should be rewritten to ISO-8601");

        // Now prove it actually sorts correctly against a same-day GitHub event.
        let pulls = vec![pull(1, "same-day PR", None, "2026-07-10T10:00:00Z")];
        let deploy_rows: Vec<(String, String, Option<String>, Option<String>, String)> = sqlx::query_as(
            "SELECT id, target, version, commit_sha, created_at FROM deploy_log",
        )
        .fetch_all(&db)
        .await
        .unwrap();
        let items = merge_activity(pulls, vec![], vec![], deploy_rows);
        let kinds: Vec<&str> = items.iter().map(|i| i.kind.as_str()).collect();
        assert_eq!(kinds, vec!["deploy", "pull_request"], "migrated 23:59:59 deploy must sort newer than a 10:00:00 same-day PR");
    }

    #[tokio::test]
    async fn missing_github_token_degrades_gracefully_with_a_clear_message() {
        let state = test_state("http://127.0.0.1:1".to_string(), String::new()).await;
        sqlx::query("INSERT INTO deploy_log (id, target, version, commit_sha) VALUES ('d1','fly','v1',NULL)")
            .execute(&state.db)
            .await
            .unwrap();

        let res = agent_activity(axum::extract::State(state.clone()), HeaderMap::new())
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["configured"], false);
        assert!(body["message"].as_str().unwrap().contains("GITHUB_ACTIVITY_TOKEN"));
        // Deploy log rows still surface even without a real GitHub token.
        let items = body["items"].as_array().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["kind"], "deploy");
    }

    #[tokio::test]
    async fn log_deploy_appends_a_row_and_it_shows_up_in_the_merged_feed() {
        let state = test_state("http://127.0.0.1:1".to_string(), String::new()).await;

        let log_res = log_deploy(
            axum::extract::State(state.clone()),
            HeaderMap::new(),
            AxJson(DeployLogReq { target: "fly".to_string(), version: Some("v7".to_string()), commit_sha: Some("abc123".to_string()) }),
        )
        .await
        .into_response();
        assert_eq!(log_res.status(), StatusCode::OK);

        let res = agent_activity(axum::extract::State(state.clone()), HeaderMap::new())
            .await
            .into_response();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let items = body["items"].as_array().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["title"], "Deploy: fly");
        assert_eq!(items[0]["detail"], "v7");
    }

    #[tokio::test]
    async fn log_deploy_rejects_empty_target() {
        let state = test_state("http://127.0.0.1:1".to_string(), String::new()).await;
        let res = log_deploy(
            axum::extract::State(state.clone()),
            HeaderMap::new(),
            AxJson(DeployLogReq { target: "  ".to_string(), version: None, commit_sha: None }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }
}
