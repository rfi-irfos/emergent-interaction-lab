use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{authz::require_admin, chat::CHAT_MODEL, AppState};

const SIMULATION_SYSTEM_PROMPT: &str = "Du hilfst dem Emergent Interaction Lab, eine Hypothese systematisch durchzudenken. Das ist explorative Modellierung, keine validierte Simulation: benenne Annahmen, zeige mögliche Entwicklungen unter den gegebenen Parametern, und weise aktiv auf Unsicherheiten und Grenzen des Gedankenmodells hin. Kein Orakel, kein Vorhersage-Ton — ein Denkwerkzeug. Antworte auf Deutsch, strukturiert in kurzen Absätzen.";

pub async fn init_schema(db: &SqlitePool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS simulation_runs (
            id TEXT PRIMARY KEY,
            hypothesis TEXT NOT NULL,
            parameters TEXT NOT NULL DEFAULT '{}',
            narrative TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at DATETIME NOT NULL DEFAULT (datetime('now')),
            updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create simulation_runs");
    // Additive: an optional, lightweight link from a run back to the
    // emergence signal(s) it explores. Nullable TEXT storing a JSON array of
    // signal ids — same pattern as chat_messages.token_info (see chat.rs),
    // not a join table, since this is always a small, run-owned list and the
    // signal's own record (pattern/observation/etc.) already lives in
    // emergence_signals; we only ever store the reference here.
    sqlx::query("ALTER TABLE simulation_runs ADD COLUMN related_signal_ids TEXT")
        .execute(db)
        .await
        .ok();
    // Additive, same pattern again: a nullable TEXT column storing a JSON
    // array of `Branch` objects for runs that model a decision point (e.g.
    // "either the team does A because ..., or B because ...") instead of a
    // single flat hypothesis. NULL for the (still default, still fully
    // supported) flat case — never `"[]"`, same "empty normalizes to NULL"
    // contract as `related_signal_ids`.
    sqlx::query("ALTER TABLE simulation_runs ADD COLUMN branches TEXT")
        .execute(db)
        .await
        .ok();
}

/// One option in a branching decision ("either A because ..., or B because
/// ..."). Each branch gets its own `narrative`/`status` (pending/complete/
/// error) so one branch's model call failing doesn't have to fail the whole
/// run or block the other branches from completing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Branch {
    id: String,
    option: String,
    rationale: String,
    narrative: Option<String>,
    status: String,
}

/// What the client actually sends to describe a branch — the server owns
/// `id`/`narrative`/`status` (assigned/resolved server-side), same division
/// of labor as `CreateRunReq` vs. the stored row for the flat case.
#[derive(Deserialize)]
pub struct BranchReq {
    option: String,
    rationale: String,
}

/// Same contract as `encode_related_signal_ids`: `None` for "no branches"
/// (the default, flat-hypothesis case), `Some(json)` for a non-empty list.
/// An empty list is normalized to `None` on the way in.
fn encode_branches(branches: &Option<Vec<Branch>>) -> Option<String> {
    branches
        .as_ref()
        .filter(|v| !v.is_empty())
        .map(|v| serde_json::to_string(v).unwrap_or_default())
}

/// Same defensive contract as `decode_related_signal_ids`: a malformed or
/// hand-edited value degrades to "no branches" rather than panicking
/// list/get.
fn decode_branches(raw: &Option<String>) -> Option<Vec<Branch>> {
    raw.as_deref().and_then(|s| serde_json::from_str::<Vec<Branch>>(s).ok()).filter(|v| !v.is_empty())
}

/// `None` for "no related signals" (not every run explores one), `Some(ids)`
/// for a non-empty explicit list. An empty list is normalized to `None` on
/// the way in so the column stays either NULL or a real, non-empty array —
/// never `"[]"` — keeping the "optional" contract unambiguous.
fn encode_related_signal_ids(ids: &Option<Vec<String>>) -> Option<String> {
    ids.as_ref()
        .filter(|v| !v.is_empty())
        .map(|v| serde_json::to_string(v).unwrap_or_default())
}

/// Defensive on the way out too: a hand-edited or otherwise malformed value
/// in the column must degrade to "no related signals" rather than panic the
/// whole list/get response.
fn decode_related_signal_ids(raw: &Option<String>) -> Option<Vec<String>> {
    raw.as_deref().and_then(|s| serde_json::from_str::<Vec<String>>(s).ok()).filter(|v| !v.is_empty())
}

/// Genuinely functional (not a static mock): the LLM reasons through the
/// hypothesis. Always surfaced in the UI as "AI-generated exploratory
/// reasoning, not a validated simulation model" — shared by the Simulation
/// Lab's own "Run" button and the agent's `run_simulation_scenario` tool, so
/// Jarvis has the same capability from any module, not a separate one.
pub async fn run_scenario(state: &AppState, hypothesis: &str, parameters: &str) -> Result<String, String> {
    if state.nvidia_api_key.is_empty() {
        return Err("NVIDIA_API_KEY not configured".to_string());
    }
    let user_prompt = format!(
        "Hypothese: {hypothesis}\nParameter: {parameters}\n\nDenke systematisch durch, was unter diesen Parametern passieren könnte."
    );
    // `state.nvidia_api_base` (not a hardcoded literal) — same convention
    // chat.rs's chat-completion call already uses, and defaults to the exact
    // same production URL this used to hardcode, so it's a no-op for real
    // traffic while making run_scenario mockable in tests the same way
    // chat.rs's is.
    let res = state
        .http
        .post(format!("{}/v1/chat/completions", state.nvidia_api_base))
        .bearer_auth(&state.nvidia_api_key)
        .json(&json!({
            "model": CHAT_MODEL,
            "messages": [
                { "role": "system", "content": SIMULATION_SYSTEM_PROMPT },
                { "role": "user", "content": user_prompt },
            ],
            "max_tokens": 900,
            "temperature": 0.6,
            "stream": false,
        }))
        .send()
        .await
        .map_err(|e| format!("simulation request failed: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("simulation API error {status}: {body}"));
    }
    let parsed: serde_json::Value = res.json().await.map_err(|e| format!("simulation parse failed: {e}"))?;
    let narrative = parsed["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string();
    if narrative.trim().is_empty() {
        return Err("empty response from model".to_string());
    }
    Ok(narrative)
}

#[derive(Serialize)]
pub struct RunOut {
    id: String,
    hypothesis: String,
    parameters: String,
    narrative: Option<String>,
    status: String,
    created_at: String,
    updated_at: String,
    related_signal_ids: Option<Vec<String>>,
    branches: Option<Vec<Branch>>,
}

type RunRow = (String, String, String, Option<String>, String, String, String, Option<String>, Option<String>);
fn to_out(r: RunRow) -> RunOut {
    let related_signal_ids = decode_related_signal_ids(&r.7);
    let branches = decode_branches(&r.8);
    RunOut { id: r.0, hypothesis: r.1, parameters: r.2, narrative: r.3, status: r.4, created_at: r.5, updated_at: r.6, related_signal_ids, branches }
}

// Previously: no LIMIT at all — a genuinely unbounded query against a table
// that only ever grows. `DEFAULT_RUNS_LIMIT` gives every existing caller
// that never passes params (LiveCards, SimulationCenter/Lab's own list) a
// sensible page instead of "everything ever run"; `limit`/`offset` reach the
// rest, and `status` (pending/complete/error — the same three values
// `STATUS_ACCENT` in SimulationLab.tsx already renders) narrows the page.
const DEFAULT_RUNS_LIMIT: i64 = 20;
const MAX_RUNS_LIMIT: i64 = 100;

#[derive(Deserialize)]
pub struct ListRunsQuery {
    limit: Option<i64>,
    offset: Option<i64>,
    status: Option<String>,
}

/// Comma-separated multi-value filter, same convention used by
/// research.rs's `category` param and emergence.rs's signal filters.
fn parse_multi(raw: &Option<String>) -> Vec<String> {
    raw.as_deref()
        .map(|s| s.split(',').map(|v| v.trim().to_string()).filter(|v| !v.is_empty()).collect())
        .unwrap_or_default()
}

pub async fn list_runs(State(state): State<AppState>, headers: HeaderMap, Query(q): Query<ListRunsQuery>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let limit = q.limit.unwrap_or(DEFAULT_RUNS_LIMIT).clamp(1, MAX_RUNS_LIMIT);
    let offset = q.offset.unwrap_or(0).max(0);

    let statuses = parse_multi(&q.status);
    let (where_sql, binds): (String, Vec<String>) = if statuses.is_empty() {
        (String::new(), Vec::new())
    } else {
        let placeholders = vec!["?"; statuses.len()].join(",");
        (format!("WHERE status IN ({placeholders})"), statuses)
    };

    // Total matching the filter (ignoring limit/offset), surfaced via
    // `X-Total-Count` so the frontend's "load more" / count tiles know the
    // real total without ever fetching the full table.
    let count_sql = format!("SELECT COUNT(*) FROM simulation_runs {where_sql}");
    let mut count_query = sqlx::query_scalar(&count_sql);
    for b in &binds {
        count_query = count_query.bind(b);
    }
    let total: i64 = count_query.fetch_one(&state.db).await.unwrap_or(0);

    let select_sql = format!(
        "SELECT id, hypothesis, parameters, narrative, status, created_at, updated_at, related_signal_ids, branches \
         FROM simulation_runs {where_sql} ORDER BY created_at DESC LIMIT ? OFFSET ?"
    );
    let mut row_query = sqlx::query_as(&select_sql);
    for b in &binds {
        row_query = row_query.bind(b);
    }
    let rows: Vec<RunRow> = row_query.bind(limit).bind(offset).fetch_all(&state.db).await.unwrap_or_default();

    let mut resp = Json(rows.into_iter().map(to_out).collect::<Vec<_>>()).into_response();
    resp.headers_mut().insert(
        "x-total-count",
        HeaderValue::from_str(&total.to_string()).unwrap_or_else(|_| HeaderValue::from_static("0")),
    );
    resp
}

#[derive(Deserialize)]
pub struct CreateRunReq {
    hypothesis: String,
    parameters: Option<serde_json::Value>,
    /// Optional: ids of emergence_signals rows this run is exploring —
    /// e.g. picked from the recent signals surfaced for the conversation
    /// this hypothesis grew out of. Not every run relates to one.
    related_signal_ids: Option<Vec<String>>,
    /// Optional: a run can model a decision point instead of a single flat
    /// hypothesis — e.g. "either the team does A because ..., or B because
    /// ...". Absent/empty is the default flat case, handled identically to
    /// before this field existed (additive capability, not a replacement).
    branches: Option<Vec<BranchReq>>,
}

pub async fn create_run(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<CreateRunReq>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let id = Uuid::new_v4().to_string();
    let parameters = req.parameters.unwrap_or(json!({})).to_string();
    let related_signal_ids = encode_related_signal_ids(&req.related_signal_ids);
    let branch_reqs: Vec<BranchReq> = req.branches.unwrap_or_default();

    // The default, still-fully-supported flat case — byte-for-byte the same
    // code path (same INSERT, same single run_scenario call, same response
    // shape) as before `branches` existed.
    if branch_reqs.is_empty() {
        let _ = sqlx::query("INSERT INTO simulation_runs (id, hypothesis, parameters, related_signal_ids, status) VALUES (?1,?2,?3,?4,'pending')")
            .bind(&id)
            .bind(&req.hypothesis)
            .bind(&parameters)
            .bind(&related_signal_ids)
            .execute(&state.db)
            .await;

        return match run_scenario(&state, &req.hypothesis, &parameters).await {
            Ok(narrative) => {
                let _ = sqlx::query("UPDATE simulation_runs SET narrative = ?1, status = 'complete', updated_at = datetime('now') WHERE id = ?2")
                    .bind(&narrative)
                    .bind(&id)
                    .execute(&state.db)
                    .await;
                Json(json!({ "id": id, "status": "complete", "narrative": narrative })).into_response()
            }
            Err(e) => {
                let _ = sqlx::query("UPDATE simulation_runs SET status = 'error', narrative = ?1, updated_at = datetime('now') WHERE id = ?2")
                    .bind(&e)
                    .bind(&id)
                    .execute(&state.db)
                    .await;
                Json(json!({ "id": id, "status": "error", "error": e })).into_response()
            }
        };
    }

    // Branching case: one run_scenario call per branch, each combining the
    // base hypothesis with that branch's own option+rationale so the
    // narrative it gets back is genuinely about that path, not a generic
    // rehash of the base hypothesis repeated N times.
    let mut branches: Vec<Branch> = branch_reqs
        .into_iter()
        .map(|b| Branch { id: Uuid::new_v4().to_string(), option: b.option, rationale: b.rationale, narrative: None, status: "pending".to_string() })
        .collect();

    let _ = sqlx::query("INSERT INTO simulation_runs (id, hypothesis, parameters, related_signal_ids, branches, status) VALUES (?1,?2,?3,?4,?5,'pending')")
        .bind(&id)
        .bind(&req.hypothesis)
        .bind(&parameters)
        .bind(&related_signal_ids)
        .bind(encode_branches(&Some(branches.clone())))
        .execute(&state.db)
        .await;

    for branch in branches.iter_mut() {
        let branch_hypothesis = format!(
            "{}\n\nBetrachte insbesondere diesen Zweig: Option '{}', Begründung: '{}'",
            req.hypothesis, branch.option, branch.rationale
        );
        match run_scenario(&state, &branch_hypothesis, &parameters).await {
            Ok(narrative) => {
                branch.narrative = Some(narrative);
                branch.status = "complete".to_string();
            }
            Err(e) => {
                branch.narrative = Some(e);
                branch.status = "error".to_string();
            }
        }
    }

    // Top-level status: 'complete' once every branch has resolved (complete
    // OR error) — a branch erroring is a per-branch outcome, not a run-level
    // one, so it must not flip the whole run to 'error' (that would make a
    // partial failure indistinguishable from every branch failing, and would
    // contradict the per-branch status this schema exists to carry). The
    // synthesis line below is what keeps a partial failure from silently
    // *reading* as full success even though the top-level status says
    // 'complete' — it's not left blank, and it's not an LLM call (a second
    // model round-trip synthesizing "how it went" would itself need the same
    // "not an oracle" framing as SIMULATION_SYSTEM_PROMPT for very little
    // real value over a factual count).
    let total = branches.len();
    let ok_count = branches.iter().filter(|b| b.status == "complete").count();
    let err_count = total - ok_count;
    let narrative = if err_count == 0 {
        format!("{ok_count} von {total} Zweigen erfolgreich durchdacht.")
    } else {
        format!("{ok_count} von {total} Zweigen erfolgreich durchdacht, {err_count} mit Fehler — Details je Zweig unten.")
    };

    let _ = sqlx::query("UPDATE simulation_runs SET narrative = ?1, status = 'complete', branches = ?2, updated_at = datetime('now') WHERE id = ?3")
        .bind(&narrative)
        .bind(encode_branches(&Some(branches.clone())))
        .bind(&id)
        .execute(&state.db)
        .await;

    Json(json!({ "id": id, "status": "complete", "narrative": narrative, "branches": branches })).into_response()
}

pub async fn get_run(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let row: Option<RunRow> = sqlx::query_as(
        "SELECT id, hypothesis, parameters, narrative, status, created_at, updated_at, related_signal_ids, branches FROM simulation_runs WHERE id = ?1",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);
    match row {
        Some(r) => Json(to_out(r)).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

pub async fn delete_run(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let _ = sqlx::query("DELETE FROM simulation_runs WHERE id = ?1").bind(&id).execute(&state.db).await;
    crate::auditlog::record(&state, "admin", "simulation_run_deleted", "Simulationslauf gelöscht", Some(json!({"id": id}))).await;
    StatusCode::NO_CONTENT.into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::{Query as AxQuery, State as AxState};
    use std::{collections::HashMap, path::PathBuf, sync::{Arc, RwLock}};

    fn empty_runs_query() -> ListRunsQuery {
        ListRunsQuery { limit: None, offset: None, status: None }
    }

    async fn test_state() -> AppState {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        init_schema(&db).await;
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
            // Deliberately empty: run_scenario's early-return path (no
            // network call) is all these storage/retrieval tests need —
            // they only care whether related_signal_ids round-trips.
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
            github_token: String::new(),
            github_api_base: "https://api.github.com".to_string(),
            eil_github_token: String::new(),
            eil_github_repo: String::new(),
            gmail_client_id: String::new(),
            gmail_client_secret: String::new(),
            gmail_refresh_token: String::new(),
            audit_lock: std::sync::Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    async fn create(state: &AppState, hypothesis: &str, related_signal_ids: Option<Vec<String>>) -> String {
        create_full(state, hypothesis, related_signal_ids, None).await.0
    }

    /// Full-fidelity variant of `create` that also accepts `branches` and
    /// hands back the whole response body (not just the id) — the branch
    /// tests need to inspect `branches`/`narrative`/`status` on the create
    /// response itself, not only after a follow-up `get_run`.
    async fn create_full(
        state: &AppState,
        hypothesis: &str,
        related_signal_ids: Option<Vec<String>>,
        branches: Option<Vec<BranchReq>>,
    ) -> (String, serde_json::Value) {
        let res = create_run(
            AxState(state.clone()),
            HeaderMap::new(),
            Json(CreateRunReq { hypothesis: hypothesis.to_string(), parameters: None, related_signal_ids, branches }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let id = body["id"].as_str().unwrap().to_string();
        (id, body)
    }

    /// Minimal local mock of the NVIDIA chat-completions endpoint, spun up
    /// on `127.0.0.1:0` (OS-assigned free port) exactly like chat.rs's own
    /// `start_mock_nvidia` — but branch-aware: it inspects the user message
    /// it was sent and fails (500) only when that message contains
    /// `fail_needle`, succeeding for everything else. That's what lets a
    /// single test drive one branch to a real success and a sibling branch
    /// to a real error deterministically, without a live network call.
    async fn start_branch_aware_mock(fail_needle: &'static str) -> String {
        use axum::{routing::post, Router};
        let completions = post(move |Json(body): Json<serde_json::Value>| async move {
            let content = body["messages"][1]["content"].as_str().unwrap_or("");
            if content.contains(fail_needle) {
                (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "mock branch failure" }))).into_response()
            } else {
                Json(json!({ "choices": [{ "message": { "content": format!("Mock-Antwort für: {content}") } }] })).into_response()
            }
        });
        let app = Router::new().route("/v1/chat/completions", completions);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn related_signal_ids_round_trip_through_create_and_list() {
        let state = test_state().await;
        let id = create(&state, "mehr Kontext -> stabilere Interaktion", Some(vec!["sig-1".to_string(), "sig-2".to_string()])).await;

        let res = list_runs(AxState(state.clone()), HeaderMap::new(), AxQuery(empty_runs_query())).await.into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let runs: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        let run = runs.iter().find(|r| r["id"] == id).expect("created run present in list");
        assert_eq!(run["related_signal_ids"], json!(["sig-1", "sig-2"]));
    }

    #[tokio::test]
    async fn related_signal_ids_round_trip_through_get_run() {
        let state = test_state().await;
        let id = create(&state, "Rückkopplung testen", Some(vec!["sig-9".to_string()])).await;

        let res = get_run(AxState(state.clone()), HeaderMap::new(), Path(id)).await.into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let run: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(run["related_signal_ids"], json!(["sig-9"]));
    }

    #[tokio::test]
    async fn related_signal_ids_omitted_stays_null_not_every_run_needs_one() {
        let state = test_state().await;
        let id = create(&state, "Hypothese ohne Signalbezug", None).await;

        let res = get_run(AxState(state.clone()), HeaderMap::new(), Path(id)).await.into_response();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let run: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(run["related_signal_ids"], serde_json::Value::Null);
    }

    #[tokio::test]
    async fn related_signal_ids_empty_vec_normalizes_to_null() {
        let state = test_state().await;
        let id = create(&state, "leere Auswahl übermittelt", Some(vec![])).await;

        let res = get_run(AxState(state.clone()), HeaderMap::new(), Path(id)).await.into_response();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let run: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(run["related_signal_ids"], serde_json::Value::Null);
    }

    /// Guards the defensive decode path: a malformed/legacy value in the
    /// column (e.g. hand-edited, or written by a future format change) must
    /// degrade to "no related signals" rather than panic list_runs/get_run.
    #[tokio::test]
    async fn malformed_related_signal_ids_column_degrades_to_null_instead_of_panicking() {
        let state = test_state().await;
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO simulation_runs (id, hypothesis, parameters, related_signal_ids, status) VALUES (?1,'x','{}','not-json','complete')")
            .bind(&id)
            .execute(&state.db)
            .await
            .unwrap();

        let res = get_run(AxState(state.clone()), HeaderMap::new(), Path(id)).await.into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let run: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(run["related_signal_ids"], serde_json::Value::Null);
    }

    async fn runs_body(res: axum::response::Response) -> (Vec<serde_json::Value>, Option<i64>) {
        let total = res
            .headers()
            .get("x-total-count")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<i64>().ok());
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        (body, total)
    }

    /// The core bug: `list_runs` previously had no LIMIT at all — a query
    /// against a table that only grows. Create more runs than the new
    /// default page size and confirm the default response is now bounded,
    /// while `X-Total-Count` still reports the real total and a follow-up
    /// page (via `offset`) reaches the rest.
    #[tokio::test]
    async fn list_runs_is_now_bounded_by_default_with_total_count_and_offset_reaching_the_rest() {
        let state = test_state().await;
        let n = (DEFAULT_RUNS_LIMIT + 5) as usize;
        for i in 0..n {
            create(&state, &format!("hypothesis-{i}"), None).await;
        }

        let (first_page, total) = runs_body(
            list_runs(AxState(state.clone()), HeaderMap::new(), AxQuery(empty_runs_query())).await.into_response(),
        )
        .await;
        assert_eq!(first_page.len(), DEFAULT_RUNS_LIMIT as usize, "unbounded query must now default to a real page size");
        assert_eq!(total, Some(n as i64), "X-Total-Count must reflect the true total, not just the page size");

        let (second_page, _) = runs_body(
            list_runs(
                AxState(state.clone()),
                HeaderMap::new(),
                AxQuery(ListRunsQuery { limit: Some(DEFAULT_RUNS_LIMIT), offset: Some(DEFAULT_RUNS_LIMIT), status: None }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(second_page.len(), 5, "runs beyond the default page must be reachable via offset");

        let first_ids: std::collections::HashSet<_> = first_page.iter().map(|r| r["id"].clone()).collect();
        let second_ids: std::collections::HashSet<_> = second_page.iter().map(|r| r["id"].clone()).collect();
        assert!(first_ids.is_disjoint(&second_ids));
    }

    /// `STATUS_ACCENT` in SimulationLab.tsx distinguishes pending/complete/
    /// error visually — this proves the backend can actually filter to just
    /// one of those, not only display them differently once already loaded.
    #[tokio::test]
    async fn status_filter_actually_filters() {
        let state = test_state().await;
        // create_run always resolves synchronously to 'complete' or 'error'
        // here (nvidia_api_key is empty in test_state -> run_scenario's
        // early-return Err path -> status='error'), so both real statuses
        // are exercised without needing a mock NVIDIA server.
        let ok_id = create(&state, "will error since no NVIDIA key is configured", None).await;
        let get_res = get_run(AxState(state.clone()), HeaderMap::new(), Path(ok_id.clone())).await.into_response();
        let bytes = axum::body::to_bytes(get_res.into_body(), usize::MAX).await.unwrap();
        let created: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(created["status"], "error", "sanity check: run_scenario's no-API-key path always lands on 'error' in tests");

        // A run that's still mid-flight in real usage — inserted directly
        // since create_run always resolves synchronously in this test setup.
        let pending_id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO simulation_runs (id, hypothesis, parameters, status) VALUES (?1,'still running','{}','pending')")
            .bind(&pending_id)
            .execute(&state.db)
            .await
            .unwrap();

        let (body, total) = runs_body(
            list_runs(
                AxState(state.clone()),
                HeaderMap::new(),
                AxQuery(ListRunsQuery { limit: None, offset: None, status: Some("pending".to_string()) }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(total, Some(1));
        assert_eq!(body.len(), 1);
        assert_eq!(body[0]["id"], pending_id);
    }

    /// `delete_run` was fully implemented and routed but had zero frontend
    /// callers (confirmed dead capability). This proves the endpoint itself
    /// is correct end-to-end: the run disappears from both `get_run` and
    /// `list_runs` after deletion — the same behavior the new
    /// SimulationLab.tsx delete button now actually triggers.
    #[tokio::test]
    async fn delete_run_removes_it_from_get_and_list() {
        let state = test_state().await;
        let id = create(&state, "temporary hypothesis", None).await;

        let del_res = delete_run(AxState(state.clone()), HeaderMap::new(), Path(id.clone())).await.into_response();
        assert_eq!(del_res.status(), StatusCode::NO_CONTENT);

        let get_res = get_run(AxState(state.clone()), HeaderMap::new(), Path(id.clone())).await.into_response();
        assert_eq!(get_res.status(), StatusCode::NOT_FOUND);

        let (body, total) = runs_body(
            list_runs(AxState(state.clone()), HeaderMap::new(), AxQuery(empty_runs_query())).await.into_response(),
        )
        .await;
        assert_eq!(total, Some(0));
        assert!(body.iter().all(|r| r["id"] != id));
    }

    #[tokio::test]
    async fn delete_run_requires_admin_auth() {
        let mut state = test_state().await;
        let id = create(&state, "protect me", None).await;
        state.chat_secret = "shh".to_string();

        let res = delete_run(AxState(state), HeaderMap::new(), Path(id)).await.into_response();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    // ── Branching decision-scenarios ─────────────────────────────────────

    /// New capability: branches round-trip through both `create_run`'s own
    /// response and a follow-up `get_run`. `nvidia_api_key` is empty here
    /// (same trick every other test in this file already relies on) so
    /// every branch resolves via `run_scenario`'s early-return `Err` path —
    /// deterministic, no network — which doubles as proof that a branch
    /// failing lands on that branch's own `status`/`narrative` rather than
    /// vanishing the run or getting silently dropped.
    #[tokio::test]
    async fn branches_round_trip_through_create_and_get() {
        let state = test_state().await;
        let branches = vec![
            BranchReq { option: "Option A".to_string(), rationale: "weil A skaliert".to_string() },
            BranchReq { option: "Option B".to_string(), rationale: "weil B günstiger ist".to_string() },
        ];
        let (id, created) = create_full(&state, "Team muss zwischen A und B entscheiden", None, Some(branches)).await;

        // Top-level: 'complete' even though every branch below individually
        // errored (no NVIDIA key configured) — a per-branch failure must not
        // read as a run-level failure.
        assert_eq!(created["status"], "complete");
        let created_branches = created["branches"].as_array().expect("branches present on create response");
        assert_eq!(created_branches.len(), 2);

        let res = get_run(AxState(state.clone()), HeaderMap::new(), Path(id)).await.into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let run: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(run["status"], "complete", "top-level status must be 'complete' once all branches resolved");
        let branches_out = run["branches"].as_array().expect("branches persisted and returned by get_run");
        assert_eq!(branches_out.len(), 2);
        for (b, expect_option, expect_rationale) in [
            (&branches_out[0], "Option A", "weil A skaliert"),
            (&branches_out[1], "Option B", "weil B günstiger ist"),
        ] {
            assert!(b["id"].as_str().is_some_and(|s| !s.is_empty()), "each branch gets its own id");
            assert_eq!(b["option"], expect_option);
            assert_eq!(b["rationale"], expect_rationale);
            assert_eq!(b["status"], "error", "no NVIDIA key configured in test_state -> every branch call errors");
            assert!(b["narrative"].as_str().is_some_and(|s| s.contains("NVIDIA_API_KEY")), "branch narrative carries its own error, not a blank");
        }

        // The top-level narrative is a real synthesis line, not silently
        // left blank — it must reflect that both branches errored.
        assert!(run["narrative"].as_str().unwrap().contains("0 von 2"), "synthesis line must reflect that both branches errored");
    }

    /// The core partial-failure guarantee: one branch's model call fails,
    /// the sibling branch succeeds, and neither poisons the other — the run
    /// itself still resolves to 'complete' with each branch carrying its own
    /// true outcome. Needs genuinely differing HTTP responses per branch
    /// (unlike the round-trip test above, where every call errors the same
    /// way), hence the branch-aware mock server.
    #[tokio::test]
    async fn one_branch_erroring_does_not_fail_the_whole_run_or_the_other_branch() {
        let base = start_branch_aware_mock("Option B").await;
        let mut state = test_state().await;
        state.nvidia_api_base = base;
        state.nvidia_api_key = "test-key".to_string();

        let branches = vec![
            BranchReq { option: "Option A".to_string(), rationale: "weil A skaliert".to_string() },
            BranchReq { option: "Option B".to_string(), rationale: "weil B günstiger ist".to_string() },
        ];
        let (id, created) = create_full(&state, "Team muss zwischen A und B entscheiden", None, Some(branches)).await;

        assert_eq!(created["status"], "complete", "one branch erroring must not flip the whole run to 'error'");
        let branches_out = created["branches"].as_array().unwrap();
        let a = branches_out.iter().find(|b| b["option"] == "Option A").expect("branch A present");
        let b = branches_out.iter().find(|b| b["option"] == "Option B").expect("branch B present");

        assert_eq!(a["status"], "complete", "branch A's own call succeeded and must be reported as such");
        assert!(a["narrative"].as_str().unwrap().contains("Mock-Antwort"), "branch A keeps its own real narrative");

        assert_eq!(b["status"], "error", "branch B's own call failed and must be reported as such");
        assert!(b["narrative"].as_str().unwrap().contains("mock branch failure"), "branch B carries its own error, not A's success bleeding over");

        // Persisted state agrees with the synchronous create response, not
        // just an in-memory value that never made it to the row.
        let res = get_run(AxState(state.clone()), HeaderMap::new(), Path(id)).await.into_response();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let run: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(run["status"], "complete");
        let persisted = run["branches"].as_array().unwrap();
        assert!(persisted.iter().any(|x| x["option"] == "Option A" && x["status"] == "complete"));
        assert!(persisted.iter().any(|x| x["option"] == "Option B" && x["status"] == "error"));
    }

    /// Backward compatibility: a request that omits `branches` entirely (the
    /// shape of every request the frontend and the `run_simulation_scenario`
    /// agent tool sent before this feature existed) must behave exactly as
    /// before — one `run_scenario` call for the flat hypothesis, the
    /// original `{id, status, narrative}` / `{id, status, error}` response
    /// shape with no `branches` key at all, and a persisted row whose
    /// `branches` column is NULL, never `"[]"` or a populated list.
    #[tokio::test]
    async fn no_branches_field_leaves_response_and_row_byte_for_byte_unchanged() {
        let state = test_state().await;
        let (id, created) = create_full(&state, "Hypothese ohne Branching", None, None).await;

        assert!(created.get("branches").is_none(), "flat case must not gain a branches key in the response");
        assert_eq!(created["status"], "error", "sanity check: no NVIDIA key configured -> same early-return path as before");
        assert!(created.get("error").is_some(), "flat error path still uses the original 'error' key, not a branches synthesis");
        assert!(created.get("narrative").is_none(), "flat error path never had a 'narrative' key, and still doesn't");

        let res = get_run(AxState(state.clone()), HeaderMap::new(), Path(id)).await.into_response();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let run: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(run["branches"], serde_json::Value::Null, "flat case's persisted row must have NULL branches, never '[]' or a populated list");
    }
}
