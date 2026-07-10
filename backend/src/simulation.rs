use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
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
    let res = state
        .http
        .post("https://integrate.api.nvidia.com/v1/chat/completions")
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
}

type RunRow = (String, String, String, Option<String>, String, String, String, Option<String>);
fn to_out(r: RunRow) -> RunOut {
    let related_signal_ids = decode_related_signal_ids(&r.7);
    RunOut { id: r.0, hypothesis: r.1, parameters: r.2, narrative: r.3, status: r.4, created_at: r.5, updated_at: r.6, related_signal_ids }
}

pub async fn list_runs(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let rows: Vec<RunRow> = sqlx::query_as(
        "SELECT id, hypothesis, parameters, narrative, status, created_at, updated_at, related_signal_ids FROM simulation_runs ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    Json(rows.into_iter().map(to_out).collect::<Vec<_>>()).into_response()
}

#[derive(Deserialize)]
pub struct CreateRunReq {
    hypothesis: String,
    parameters: Option<serde_json::Value>,
    /// Optional: ids of emergence_signals rows this run is exploring —
    /// e.g. picked from the recent signals surfaced for the conversation
    /// this hypothesis grew out of. Not every run relates to one.
    related_signal_ids: Option<Vec<String>>,
}

pub async fn create_run(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<CreateRunReq>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let id = Uuid::new_v4().to_string();
    let parameters = req.parameters.unwrap_or(json!({})).to_string();
    let related_signal_ids = encode_related_signal_ids(&req.related_signal_ids);
    let _ = sqlx::query("INSERT INTO simulation_runs (id, hypothesis, parameters, related_signal_ids, status) VALUES (?1,?2,?3,?4,'pending')")
        .bind(&id)
        .bind(&req.hypothesis)
        .bind(&parameters)
        .bind(&related_signal_ids)
        .execute(&state.db)
        .await;

    match run_scenario(&state, &req.hypothesis, &parameters).await {
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
    }
}

pub async fn get_run(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let row: Option<RunRow> = sqlx::query_as(
        "SELECT id, hypothesis, parameters, narrative, status, created_at, updated_at, related_signal_ids FROM simulation_runs WHERE id = ?1",
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
    StatusCode::NO_CONTENT.into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::State as AxState;
    use std::{collections::HashMap, path::PathBuf, sync::{Arc, RwLock}};

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
            ddg_api_base: "https://api.duckduckgo.com".to_string(),
            github_token: String::new(),
            github_api_base: "https://api.github.com".to_string(),
            chat_model_idx: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            chat_request_count: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }
    }

    async fn create(state: &AppState, hypothesis: &str, related_signal_ids: Option<Vec<String>>) -> String {
        let res = create_run(
            AxState(state.clone()),
            HeaderMap::new(),
            Json(CreateRunReq { hypothesis: hypothesis.to_string(), parameters: None, related_signal_ids }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        body["id"].as_str().unwrap().to_string()
    }

    #[tokio::test]
    async fn related_signal_ids_round_trip_through_create_and_list() {
        let state = test_state().await;
        let id = create(&state, "mehr Kontext -> stabilere Interaktion", Some(vec!["sig-1".to_string(), "sig-2".to_string()])).await;

        let res = list_runs(AxState(state.clone()), HeaderMap::new()).await.into_response();
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
}
