use axum::{
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    extract::State,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{authz::require_admin, chat::CHAT_MODEL, AppState};

/// The "Jarvis" tool-calling loop. Implemented as a prompt-based fenced-JSON
/// convention rather than NVIDIA's native OpenAI-style `tools` parameter:
/// this NIM deployment's actual support for structured tool_calls couldn't be
/// verified from this environment (no NVIDIA_API_KEY available locally to
/// spike against), and the fenced-JSON convention works against any plain
/// chat-completions endpoint regardless of vendor-specific tool-calling
/// support. See plan §1.3's named risk.
const MAX_TOOL_ITERATIONS: usize = 4;

pub async fn init_schema(db: &SqlitePool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS agent_tool_calls (
            id TEXT PRIMARY KEY,
            conversation_id TEXT,
            tool_name TEXT NOT NULL,
            arguments TEXT NOT NULL,
            result TEXT,
            status TEXT NOT NULL DEFAULT 'ok',
            created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create agent_tool_calls");
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_atc_created ON agent_tool_calls(created_at)")
        .execute(db)
        .await
        .ok();
}

fn build_system_prompt(module: &str) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "Du bist Jarvis — der ambiente KI-Assistent des Emergent Interaction Lab (RFI-IRFOS), erreichbar aus jedem Bereich des Verwaltungs-Dashboards, nicht nur aus einem einzelnen Chat-Tab. Der Admin schaut sich gerade an: \"{module}\".\n\n"
    ));
    s.push_str("Du hast Zugriff auf folgende Werkzeuge. Wenn du eines aufrufen willst, antworte NUR mit einem einzigen Codeblock in genau diesem Format, ohne weiteren Text davor oder danach:\n");
    s.push_str("```json\n{\"tool\": \"<name>\", \"arguments\": {\"...\": \"...\"}}\n```\n\n");
    s.push_str("Werkzeuge:\n");
    s.push_str("- draft_blog_post(title, body): legt einen Blogpost-Entwurf an (status=draft). Wird NIE automatisch veröffentlicht — das macht bewusst ein Mensch.\n");
    s.push_str("- log_research_note(category, title, body, tags?): category ist eines von paper/hypothesis/idea/concept/framework/prototype. Speist Research Workspace und Innovation Lab.\n");
    s.push_str("- get_recent_analytics(days?): liefert Seitenaufrufe/Unique Visitors der letzten N Tage (Standard 7).\n");
    s.push_str("- get_content_section(section): liest einen Top-Level-Abschnitt des aktuell im Browser geladenen Seiteninhalts (z.B. \"hero\", \"about\", \"usp\").\n");
    s.push_str("- run_simulation_scenario(hypothesis, parameters?): lässt dich eine Hypothese explorativ durchdenken (keine validierte Simulation, immer als solche kennzeichnen).\n\n");
    s.push_str("Wenn kein Werkzeug nötig ist, antworte einfach normal auf Deutsch, warm und direkt — keine Floskeln, keine \"Als KI-Sprachmodell\".");
    s
}

struct ToolCall {
    tool: String,
    arguments: serde_json::Value,
}

fn parse_tool_call(text: &str) -> Option<ToolCall> {
    let start = text.find("```")?;
    let after_start = &text[start + 3..];
    let after_start = after_start.strip_prefix("json").unwrap_or(after_start);
    let after_start = after_start.trim_start_matches('\n');
    let end = after_start.find("```")?;
    let json_str = after_start[..end].trim();
    let value: serde_json::Value = serde_json::from_str(json_str).ok()?;
    let tool = value.get("tool")?.as_str()?.to_string();
    let arguments = value.get("arguments").cloned().unwrap_or(json!({}));
    Some(ToolCall { tool, arguments })
}

async fn execute_tool(state: &AppState, call: &ToolCall, site_content: Option<&serde_json::Value>) -> String {
    match call.tool.as_str() {
        "draft_blog_post" => {
            let title = call.arguments.get("title").and_then(|v| v.as_str()).unwrap_or("Unbenannt");
            let body = call.arguments.get("body").and_then(|v| v.as_str()).unwrap_or("");
            let id = crate::blog::insert_post(state, title, body, "agent").await;
            json!({ "ok": true, "id": id, "status": "draft" }).to_string()
        }
        "log_research_note" => {
            let category = call.arguments.get("category").and_then(|v| v.as_str()).unwrap_or("idea");
            let title = call.arguments.get("title").and_then(|v| v.as_str()).unwrap_or("Unbenannt");
            let body = call.arguments.get("body").and_then(|v| v.as_str()).unwrap_or("");
            let tags = call.arguments.get("tags").and_then(|v| v.as_str()).unwrap_or("");
            let id = crate::research::insert_note(state, category, title, body, tags, "agent").await;
            json!({ "ok": true, "id": id }).to_string()
        }
        "get_recent_analytics" => {
            let days = call.arguments.get("days").and_then(|v| v.as_i64()).unwrap_or(7).clamp(1, 90);
            let row: (i64, i64) = sqlx::query_as(
                "SELECT COUNT(*), COUNT(DISTINCT visitor) FROM web_visits WHERE created_at > datetime('now', printf('-%d days', ?1))",
            )
            .bind(days)
            .fetch_one(&state.db)
            .await
            .unwrap_or((0, 0));
            json!({ "views": row.0, "unique_visitors": row.1, "days": days }).to_string()
        }
        "get_content_section" => {
            let section = call.arguments.get("section").and_then(|v| v.as_str()).unwrap_or("");
            match site_content.and_then(|c| c.get(section)) {
                Some(v) => v.to_string(),
                None => json!({ "error": "section not found in the content currently loaded in the admin's browser" }).to_string(),
            }
        }
        "run_simulation_scenario" => {
            let hypothesis = call.arguments.get("hypothesis").and_then(|v| v.as_str()).unwrap_or("");
            let parameters = call.arguments.get("parameters").cloned().unwrap_or(json!({})).to_string();
            match crate::simulation::run_scenario(state, hypothesis, &parameters).await {
                Ok(narrative) => {
                    let id = Uuid::new_v4().to_string();
                    let _ = sqlx::query(
                        "INSERT INTO simulation_runs (id, hypothesis, parameters, narrative, status) VALUES (?1,?2,?3,?4,'complete')",
                    )
                    .bind(&id)
                    .bind(hypothesis)
                    .bind(&parameters)
                    .bind(&narrative)
                    .execute(&state.db)
                    .await;
                    json!({ "ok": true, "id": id, "narrative": narrative }).to_string()
                }
                Err(e) => json!({ "ok": false, "error": e }).to_string(),
            }
        }
        other => json!({ "error": format!("unknown tool: {other}") }).to_string(),
    }
}

async fn log_tool_call(state: &AppState, conversation_id: &str, call: &ToolCall, result: &str) {
    let _ = sqlx::query(
        "INSERT INTO agent_tool_calls (id, conversation_id, tool_name, arguments, result, status) VALUES (?1,?2,?3,?4,?5,'ok')",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(conversation_id)
    .bind(&call.tool)
    .bind(call.arguments.to_string())
    .bind(result)
    .execute(&state.db)
    .await;
}

#[derive(Deserialize)]
pub struct AgentMessageReq {
    conversation_id: String,
    message: String,
    current_module: Option<String>,
    /// The SiteContent object as currently loaded in the admin's browser
    /// (already fetched there via useContent) — lets get_content_section
    /// answer from live state without the backend needing its own GitHub
    /// credentials/repo config.
    site_content: Option<serde_json::Value>,
}

#[derive(Serialize)]
pub struct AgentMessageOut {
    reply: String,
    tool_calls_made: Vec<String>,
    conversation_id: String,
}

pub async fn message(State(state): State<AppState>, headers: HeaderMap, Json(body): Json<AgentMessageReq>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if state.nvidia_api_key.is_empty() {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let user_message = body.message.trim().to_string();
    if user_message.is_empty() {
        return (StatusCode::BAD_REQUEST, "Nachricht darf nicht leer sein.").into_response();
    }
    let conversation_id = body.conversation_id.clone();

    let _ = sqlx::query("INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?1,?2,'user',?3)")
        .bind(Uuid::new_v4().to_string())
        .bind(&conversation_id)
        .bind(&user_message)
        .execute(&state.db)
        .await;
    let _ = sqlx::query("UPDATE chat_conversations SET updated_at = datetime('now') WHERE id = ?1")
        .bind(&conversation_id)
        .execute(&state.db)
        .await;

    let history: Vec<(String, String)> = sqlx::query_as(
        "SELECT role, content FROM chat_messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
    )
    .bind(&conversation_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let module_ctx = body.current_module.as_deref().unwrap_or("unbekannt");
    let mut messages = vec![json!({ "role": "system", "content": build_system_prompt(module_ctx) })];
    for (role, content) in &history {
        messages.push(json!({ "role": role, "content": content }));
    }

    let mut tool_calls_made = Vec::new();
    let mut final_reply = String::new();

    for _ in 0..MAX_TOOL_ITERATIONS {
        let res = state
            .http
            .post("https://integrate.api.nvidia.com/v1/chat/completions")
            .bearer_auth(&state.nvidia_api_key)
            .json(&json!({
                "model": CHAT_MODEL,
                "messages": messages,
                "max_tokens": 900,
                "temperature": 0.5,
                "stream": false,
            }))
            .send()
            .await;

        let res = match res {
            Ok(r) => r,
            Err(e) => { final_reply = format!("Verbindung zum Modell fehlgeschlagen: {e}"); break; }
        };
        if !res.status().is_success() {
            let status = res.status();
            let body_text = res.text().await.unwrap_or_default();
            final_reply = format!("Modell-Anfrage fehlgeschlagen ({status}): {body_text}");
            break;
        }
        let parsed: serde_json::Value = match res.json().await {
            Ok(v) => v,
            Err(e) => { final_reply = format!("Antwort konnte nicht gelesen werden: {e}"); break; }
        };
        let content = parsed["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string();

        match parse_tool_call(&content) {
            Some(call) => {
                let result = execute_tool(&state, &call, body.site_content.as_ref()).await;
                log_tool_call(&state, &conversation_id, &call, &result).await;
                tool_calls_made.push(call.tool.clone());
                messages.push(json!({ "role": "assistant", "content": content }));
                messages.push(json!({ "role": "system", "content": format!("[Ergebnis von {}]: {}", call.tool, result) }));
            }
            None => { final_reply = content; break; }
        }
    }
    if final_reply.trim().is_empty() {
        final_reply = "Ich habe mehrere Werkzeuge aufgerufen, konnte aber noch keine abschließende Antwort formulieren — frag gern nochmal genauer nach.".to_string();
    }

    let _ = sqlx::query("INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?1,?2,'assistant',?3)")
        .bind(Uuid::new_v4().to_string())
        .bind(&conversation_id)
        .bind(&final_reply)
        .execute(&state.db)
        .await;

    Json(AgentMessageOut { reply: final_reply, tool_calls_made, conversation_id }).into_response()
}
