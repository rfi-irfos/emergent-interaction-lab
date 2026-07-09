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
}

type RunRow = (String, String, String, Option<String>, String, String, String);
fn to_out(r: RunRow) -> RunOut {
    RunOut { id: r.0, hypothesis: r.1, parameters: r.2, narrative: r.3, status: r.4, created_at: r.5, updated_at: r.6 }
}

pub async fn list_runs(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let rows: Vec<RunRow> = sqlx::query_as(
        "SELECT id, hypothesis, parameters, narrative, status, created_at, updated_at FROM simulation_runs ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    Json(rows.into_iter().map(to_out).collect::<Vec<_>>()).into_response()
}

#[derive(Deserialize)]
pub struct CreateRunReq { hypothesis: String, parameters: Option<serde_json::Value> }

pub async fn create_run(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<CreateRunReq>) -> impl IntoResponse {
    if !require_admin(&state, &headers) { return StatusCode::UNAUTHORIZED.into_response(); }
    let id = Uuid::new_v4().to_string();
    let parameters = req.parameters.unwrap_or(json!({})).to_string();
    let _ = sqlx::query("INSERT INTO simulation_runs (id, hypothesis, parameters, status) VALUES (?1,?2,?3,'pending')")
        .bind(&id)
        .bind(&req.hypothesis)
        .bind(&parameters)
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
        "SELECT id, hypothesis, parameters, narrative, status, created_at, updated_at FROM simulation_runs WHERE id = ?1",
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
