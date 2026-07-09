use axum::{extract::State, http::{HeaderMap, StatusCode}, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{authz::require_admin, chat::CHAT_MODEL, AppState};

/// Emergence signal detection — the Observatory's actual reason to exist.
/// Deliberately an LLM interpretation of what's happening in a research
/// conversation, not a hand-coded statistics pipeline dressed up as science:
/// per the lab's own framing, this research area works through dialogue, not
/// classic ML. Fires automatically after every completed Forschung exchange
/// (see chat.rs::stream_chat), spawned as a background task so it never
/// delays the visible reply finishing — an explicit, accepted tradeoff of an
/// extra NVIDIA call on every single turn, for maximum responsiveness.
pub async fn init_schema(db: &SqlitePool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS emergence_signals (
            id TEXT PRIMARY KEY,
            pattern TEXT NOT NULL,
            status TEXT NOT NULL,
            confidence TEXT NOT NULL,
            evolution TEXT NOT NULL,
            observation TEXT NOT NULL,
            scope TEXT,
            source_conversation_id TEXT,
            created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create emergence_signals");
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_es_created ON emergence_signals(created_at)")
        .execute(db)
        .await
        .ok();
}

fn extract_json_array(text: &str) -> Option<Vec<serde_json::Value>> {
    let trimmed = text.trim();
    if let Ok(v) = serde_json::from_str::<Vec<serde_json::Value>>(trimmed) {
        return Some(v);
    }
    let first = trimmed.find('[')?;
    let last = trimmed.rfind(']')?;
    if last <= first {
        return None;
    }
    serde_json::from_str::<Vec<serde_json::Value>>(&trimmed[first..=last]).ok()
}

pub async fn analyze_recent_interactions(state: &AppState, conversation_id: &str) {
    if state.nvidia_api_key.is_empty() {
        return;
    }
    let db = &state.db;

    let mut recent_messages: Vec<(String, String)> = sqlx::query_as(
        "SELECT role, content FROM chat_messages WHERE conversation_id = ?1 ORDER BY created_at DESC LIMIT 20",
    )
    .bind(conversation_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    if recent_messages.len() < 2 {
        return; // nothing meaningful to interpret yet
    }
    recent_messages.reverse();
    let transcript: String = recent_messages
        .iter()
        .map(|(role, content)| format!("{role}: {content}"))
        .collect::<Vec<_>>()
        .join("\n");

    let recent_tools: Vec<(String,)> = sqlx::query_as(
        "SELECT tool_name FROM agent_tool_calls WHERE conversation_id = ?1 ORDER BY created_at DESC LIMIT 10",
    )
    .bind(conversation_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let tool_summary = if recent_tools.is_empty() {
        "keine".to_string()
    } else {
        recent_tools.iter().map(|(t,)| t.clone()).collect::<Vec<_>>().join(", ")
    };

    let user_prompt = format!(
        "Hier ist ein Ausschnitt aus einem laufenden Forschungsgespräch (neueste Nachricht zuletzt):\n\n{transcript}\n\nZuletzt verwendete Werkzeuge: {tool_summary}\n\n\
Schau dir an, was in diesem Gespräch strukturell passiert — nicht den Inhalt zusammenfassen, sondern: entstehen neue Muster? Verschiebt sich der Fokus? Gibt es Rückkopplung, Wiederholung, Anpassung, Rollenveränderung? Antworte NUR mit einem JSON-Array (kein Text davor oder danach, keine Code-Block-Markierung) von 0 bis 3 Objekten in genau dieser Form:\n\
[{{\"pattern\": \"kurzer Name des Musters\", \"status\": \"emerging|stable|fading|hypothetical\", \"confidence\": \"experimental|tentative|moderate\", \"evolution\": \"increasing|decreasing|steady|unclear\", \"observation\": \"1-2 Sätze, was genau du beobachtest\", \"scope\": \"worum es inhaltlich geht\"}}]\n\
Wenn wirklich nichts Bemerkenswertes zu erkennen ist, antworte mit einem leeren Array []."
    );

    let res = state
        .http
        .post("https://integrate.api.nvidia.com/v1/chat/completions")
        .bearer_auth(&state.nvidia_api_key)
        .json(&json!({
            "model": CHAT_MODEL,
            "messages": [
                { "role": "system", "content": "Du analysierst Forschungsgespräche für ein Emergence-Observatory. Du interpretierst qualitativ, wie ein Forschungspartner, nicht wie eine Statistik-Pipeline. Antworte ausschließlich mit validem JSON, wie angefordert — kein Fließtext." },
                { "role": "user", "content": user_prompt },
            ],
            "max_tokens": 700,
            "temperature": 0.4,
            "stream": false,
        }))
        .send()
        .await;

    let res = match res {
        Ok(r) => r,
        Err(e) => { tracing::warn!("emergence analysis request failed: {e}"); return; }
    };
    if !res.status().is_success() {
        return;
    }
    let parsed: serde_json::Value = match res.json().await {
        Ok(v) => v,
        Err(_) => return,
    };
    let content = parsed["choices"][0]["message"]["content"].as_str().unwrap_or("");
    let Some(signals) = extract_json_array(content) else { return };

    for sig in signals {
        let pattern = sig.get("pattern").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if pattern.is_empty() {
            continue;
        }
        let status = sig.get("status").and_then(|v| v.as_str()).unwrap_or("hypothetical").to_string();
        let confidence = sig.get("confidence").and_then(|v| v.as_str()).unwrap_or("experimental").to_string();
        let evolution = sig.get("evolution").and_then(|v| v.as_str()).unwrap_or("unclear").to_string();
        let observation = sig.get("observation").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let scope = sig.get("scope").and_then(|v| v.as_str()).map(|s| s.to_string());

        let _ = sqlx::query(
            "INSERT INTO emergence_signals (id, pattern, status, confidence, evolution, observation, scope, source_conversation_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&pattern)
        .bind(&status)
        .bind(&confidence)
        .bind(&evolution)
        .bind(&observation)
        .bind(&scope)
        .bind(conversation_id)
        .execute(db)
        .await;
    }
}

#[derive(Serialize)]
pub struct SignalOut {
    id: String,
    pattern: String,
    status: String,
    confidence: String,
    evolution: String,
    observation: String,
    scope: Option<String>,
    source_conversation_id: Option<String>,
    created_at: String,
}

type SignalRow = (String, String, String, String, String, String, Option<String>, Option<String>, String);
fn to_out(r: SignalRow) -> SignalOut {
    SignalOut {
        id: r.0, pattern: r.1, status: r.2, confidence: r.3, evolution: r.4,
        observation: r.5, scope: r.6, source_conversation_id: r.7, created_at: r.8,
    }
}

pub async fn list_signals(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let rows: Vec<SignalRow> = sqlx::query_as(
        "SELECT id, pattern, status, confidence, evolution, observation, scope, source_conversation_id, created_at FROM emergence_signals ORDER BY created_at DESC LIMIT 50",
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    Json(rows.into_iter().map(to_out).collect::<Vec<_>>()).into_response()
}

#[derive(Deserialize)]
pub struct AnalyzeReq {
    conversation_id: String,
}

/// Manual re-run, independent of the automatic per-turn trigger — lets Laura
/// force a fresh pass on demand too.
pub async fn analyze(State(state): State<AppState>, headers: HeaderMap, Json(body): Json<AnalyzeReq>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    analyze_recent_interactions(&state, &body.conversation_id).await;
    StatusCode::NO_CONTENT.into_response()
}
