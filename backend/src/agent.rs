use serde_json::json;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::AppState;

/// Jarvis's tool-calling primitives, shared by chat.rs's stream_chat — tool
/// calling is merged into the one Forschung chat surface, not a separate
/// endpoint (see plan: "Jarvis lives in two disconnected places" fix).
///
/// Detection is a prompt-based fenced-JSON convention rather than NVIDIA's
/// native `tools` parameter (that support couldn't be verified from this
/// environment — no NVIDIA_API_KEY available locally to spike against).
/// `parse_tool_call` deliberately checks three shapes, because in practice
/// the model doesn't reliably wrap calls in a fenced block: it sometimes
/// replies with bare JSON and nothing else. Every shape is gated on the
/// parsed object naming a *known* tool, so ordinary prose containing
/// incidental braces never false-positives into a tool execution.
pub(crate) const MAX_TOOL_ITERATIONS: usize = 4;

const KNOWN_TOOLS: &[&str] = &[
    "draft_blog_post",
    "log_research_note",
    "get_recent_analytics",
    "get_content_section",
    "run_simulation_scenario",
    "get_blog_post",
    "revise_blog_post",
];

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

/// Appended after chat.rs's own warm-colleague SYSTEM_PROMPT — deliberately
/// just the tool list + calling convention, no separate persona ("Du bist
/// Jarvis…"), so the merged chat keeps one voice instead of two competing
/// framings. Strict "JSON and nothing else" wording matters mechanically,
/// not just stylistically: chat.rs uses the first non-whitespace character
/// of the reply to decide whether to buffer-and-suppress (possible tool
/// call) or stream live — the more consistently the model leads with `{`,
/// the more reliably that heuristic holds.
pub(crate) fn tool_instructions_block(module: &str) -> String {
    let mut s = String::new();
    s.push_str(&format!("\n\nDu kannst außerdem direkt handeln — du bist aus jedem Bereich des Verwaltungs-Dashboards erreichbar, gerade schaut der Admin sich an: \"{module}\". Wenn eine Nachricht eine Handlung verlangt (\"leg einen Blogpost-Entwurf an\", \"merk dir das als Research Note\", \"wie viele Besuche hatten wir\", \"was steht gerade im Hero-Text\", \"spiel diese Hypothese durch\"), antworte AUSSCHLIESSLICH mit einem JSON-Objekt in genau dieser Form, ohne jeden Text davor oder danach, ohne Erklärung, ohne Codeblock-Markierung:\n"));
    s.push_str("{\"tool\": \"<name>\", \"arguments\": {\"...\": \"...\"}}\n\n");
    s.push_str("Werkzeuge:\n");
    s.push_str("- draft_blog_post(title, body): legt einen Blogpost-Entwurf an (status=draft). Wird NIE automatisch veröffentlicht — das macht bewusst ein Mensch.\n");
    s.push_str("- log_research_note(category, title, body, tags?): category ist eines von paper/hypothesis/idea/concept/framework/prototype.\n");
    s.push_str("- get_recent_analytics(days?): liefert Seitenaufrufe/Unique Visitors der letzten N Tage (Standard 7).\n");
    s.push_str("- get_content_section(section): liest einen Top-Level-Abschnitt des aktuell im Browser geladenen Seiteninhalts (z.B. \"hero\", \"about\", \"usp\").\n");
    s.push_str("- run_simulation_scenario(hypothesis, parameters?): lässt dich eine Hypothese explorativ durchdenken (keine validierte Simulation, immer als solche kennzeichnen).\n");
    s.push_str("- get_blog_post(post_id): liest Titel und Text eines vorhandenen Blogpost-Entwurfs — nutze das, bevor du an einem Entwurf weiterschreibst.\n");
    s.push_str("- revise_blog_post(post_id, title?, body?): überschreibt Titel und/oder Text eines Entwurfs komplett. Funktioniert NUR bei einem Entwurf (status=draft) — ein bereits veröffentlichter Post wird nie automatisch verändert.\n\n");
    s.push_str("Wenn keine Handlung nötig ist, antworte ganz normal im Gespräch — kein JSON, keine Werkzeug-Erwähnung.");
    s
}

pub(crate) struct ToolCall {
    pub tool: String,
    pub arguments: serde_json::Value,
}

fn try_parse_as_tool_call(candidate: &str) -> Option<ToolCall> {
    let value: serde_json::Value = serde_json::from_str(candidate.trim()).ok()?;
    let tool = value.get("tool")?.as_str()?.to_string();
    if !KNOWN_TOOLS.contains(&tool.as_str()) {
        return None;
    }
    let arguments = value.get("arguments").cloned().unwrap_or(json!({}));
    Some(ToolCall { tool, arguments })
}

pub(crate) fn parse_tool_call(text: &str) -> Option<ToolCall> {
    let trimmed = text.trim();

    // 1. Whole reply is the JSON object — the common case in practice: the
    //    model frequently skips fencing entirely despite being asked for it.
    if let Some(call) = try_parse_as_tool_call(trimmed) {
        return Some(call);
    }

    // 2. A fenced ```json ... ``` block, per the original instruction.
    if let Some(start) = trimmed.find("```") {
        let after_start = &trimmed[start + 3..];
        let after_start = after_start.strip_prefix("json").unwrap_or(after_start);
        let after_start = after_start.trim_start_matches('\n');
        if let Some(end) = after_start.find("```") {
            if let Some(call) = try_parse_as_tool_call(&after_start[..end]) {
                return Some(call);
            }
        }
    }

    // 3. A bare JSON object embedded in surrounding prose (model adds
    //    commentary around the call instead of replying with only JSON).
    if let (Some(first), Some(last)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if last > first {
            if let Some(call) = try_parse_as_tool_call(&trimmed[first..=last]) {
                return Some(call);
            }
        }
    }

    None
}

pub(crate) async fn execute_tool(state: &AppState, call: &ToolCall, site_content: Option<&serde_json::Value>, conversation_id: &str) -> String {
    match call.tool.as_str() {
        "draft_blog_post" => {
            let title = call.arguments.get("title").and_then(|v| v.as_str()).unwrap_or("Unbenannt");
            let body = call.arguments.get("body").and_then(|v| v.as_str()).unwrap_or("");
            let id = crate::blog::insert_post(state, title, body, "agent", Some(conversation_id)).await;
            json!({ "ok": true, "id": id, "status": "draft" }).to_string()
        }
        "get_blog_post" => {
            let post_id = call.arguments.get("post_id").and_then(|v| v.as_str()).unwrap_or("");
            match crate::blog::fetch_post_json(state, post_id).await {
                Some(v) => v.to_string(),
                None => json!({ "error": "post not found" }).to_string(),
            }
        }
        "revise_blog_post" => {
            let post_id = call.arguments.get("post_id").and_then(|v| v.as_str()).unwrap_or("");
            let title = call.arguments.get("title").and_then(|v| v.as_str());
            let body = call.arguments.get("body").and_then(|v| v.as_str());
            match crate::blog::revise_draft(state, post_id, title, body).await {
                Ok(()) => json!({ "ok": true }).to_string(),
                Err(e) => json!({ "ok": false, "error": e }).to_string(),
            }
        }
        "log_research_note" => {
            let category = call.arguments.get("category").and_then(|v| v.as_str()).unwrap_or("idea");
            let title = call.arguments.get("title").and_then(|v| v.as_str()).unwrap_or("Unbenannt");
            let body = call.arguments.get("body").and_then(|v| v.as_str()).unwrap_or("");
            let tags = call.arguments.get("tags").and_then(|v| v.as_str()).unwrap_or("");
            let id = crate::research::insert_note(state, category, title, body, tags, "agent", Some(conversation_id)).await;
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

pub(crate) async fn log_tool_call(state: &AppState, conversation_id: &str, call: &ToolCall, result: &str) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_bare_unfenced_json_the_model_actually_sent() {
        // This is the exact shape observed in production: the model replies
        // with raw JSON and no fencing at all, despite being asked for one.
        let text = r#"{"tool": "draft_blog_post", "arguments": {"title": "Emergent Interaction Test", "body": "Dies ist ein Test."}}"#;
        let call = parse_tool_call(text).expect("should detect bare JSON tool call");
        assert_eq!(call.tool, "draft_blog_post");
        assert_eq!(call.arguments["title"], "Emergent Interaction Test");
    }

    #[test]
    fn detects_fenced_json_block() {
        let text = "```json\n{\"tool\": \"log_research_note\", \"arguments\": {\"category\": \"idea\", \"title\": \"x\", \"body\": \"y\"}}\n```";
        let call = parse_tool_call(text).expect("should detect fenced tool call");
        assert_eq!(call.tool, "log_research_note");
    }

    #[test]
    fn detects_json_embedded_in_surrounding_prose() {
        let text = "Klar, das mache ich: {\"tool\": \"get_recent_analytics\", \"arguments\": {\"days\": 7}} Einen Moment.";
        let call = parse_tool_call(text).expect("should detect embedded tool call");
        assert_eq!(call.tool, "get_recent_analytics");
    }

    #[test]
    fn ignores_ordinary_prose_with_incidental_braces() {
        let text = "Die Konfiguration sieht so aus: { nichts Bekanntes hier }. Kein Werkzeugaufruf.";
        assert!(parse_tool_call(text).is_none());
    }

    #[test]
    fn ignores_json_naming_an_unknown_tool() {
        let text = r#"{"tool": "delete_everything", "arguments": {}}"#;
        assert!(parse_tool_call(text).is_none());
    }

    #[test]
    fn ordinary_reply_is_never_misdetected() {
        let text = "Guten Tag! Es geht so: wir haben gerade über die Interaction Field Forschung gesprochen.";
        assert!(parse_tool_call(text).is_none());
    }
}
