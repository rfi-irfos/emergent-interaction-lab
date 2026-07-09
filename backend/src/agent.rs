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
    "update_content_field",
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
    s.push_str("- revise_blog_post(post_id, title?, body?): überschreibt Titel und/oder Text eines Entwurfs komplett. Funktioniert NUR bei einem Entwurf (status=draft) — ein bereits veröffentlichter Post wird nie automatisch verändert.\n");
    s.push_str("- update_content_field(field, value): schreibt einen Wert direkt in den Website-Kit-Entwurf, z.B. field=\"hero.title\" oder field=\"about.body\" — Punktnotation für verschachtelte Felder. Wird sofort im Entwurf übernommen (Laura sieht die Änderung live im Website Kit), aber erst mit \"Speichern\" dort tatsächlich veröffentlicht. Nutze get_content_section zuerst, um die genaue Feldstruktur zu sehen, bevor du sie überschreibst.\n\n");
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

/// Finds the byte index of the `}` that closes the `{` at `start`, tracking
/// brace depth and skipping over string contents (so braces inside a quoted
/// argument value don't throw off the count). Operating on bytes is safe
/// here because every delimiter tracked (`{`, `}`, `"`, `\`) is single-byte
/// ASCII — a multi-byte UTF-8 continuation byte can never match one.
fn matching_brace_end(text: &str, start: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        if in_string {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

pub(crate) fn parse_tool_call(text: &str) -> Option<ToolCall> {
    let trimmed = text.trim();

    // 1. Whole reply is the JSON object — the common case in practice: the
    //    model frequently skips fencing entirely despite being asked for it.
    if let Some(call) = try_parse_as_tool_call(trimmed) {
        return Some(call);
    }

    // 2. A fenced ```json ... ``` block, per the original instruction. Tries
    //    every fenced block in order, not just the first — the model can
    //    emit an unrelated code fence before the one actually carrying the
    //    tool call.
    let mut rest = trimmed;
    while let Some(start) = rest.find("```") {
        let after_start = &rest[start + 3..];
        let after_start = after_start.strip_prefix("json").unwrap_or(after_start);
        let after_start = after_start.trim_start_matches('\n');
        match after_start.find("```") {
            Some(end) => {
                if let Some(call) = try_parse_as_tool_call(&after_start[..end]) {
                    return Some(call);
                }
                rest = &after_start[end + 3..];
            }
            None => break,
        }
    }

    // 3. A bare JSON object embedded in surrounding prose (model adds
    //    commentary around the call instead of replying with only JSON).
    //    Tries every `{` in the text in turn, using brace-depth matching to
    //    find its real closing `}`, instead of only the outermost
    //    first-`{`-to-last-`}` span — that greedy span silently swallows a
    //    valid call when the reply contains more than one brace pair.
    let mut search_from = 0;
    while let Some(rel_start) = trimmed[search_from..].find('{') {
        let start = search_from + rel_start;
        match matching_brace_end(trimmed, start) {
            Some(end) => {
                if let Some(call) = try_parse_as_tool_call(&trimmed[start..=end]) {
                    return Some(call);
                }
                search_from = start + 1;
            }
            None => break,
        }
    }

    None
}

/// Applies a dot-notation field update (e.g. "hero.title") to a JSON object
/// in place, creating intermediate objects as needed. Used to keep the
/// in-memory site_content snapshot for one exchange in sync with
/// update_content_field calls made earlier in that same exchange, so a
/// later get_content_section call in the same exchange sees the edit
/// instead of the value the exchange originally started with.
pub(crate) fn apply_content_field_update(content: &mut serde_json::Value, field: &str, value: serde_json::Value) {
    let parts: Vec<&str> = field.split('.').filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        return;
    }
    if !content.is_object() {
        *content = json!({});
    }
    let mut current = content;
    for part in &parts[..parts.len() - 1] {
        let obj = current.as_object_mut().expect("just ensured object above");
        let entry = obj.entry(part.to_string()).or_insert_with(|| json!({}));
        if !entry.is_object() {
            *entry = json!({});
        }
        current = entry;
    }
    if let Some(obj) = current.as_object_mut() {
        obj.insert(parts[parts.len() - 1].to_string(), value);
    }
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
        // No backend write happens here — site content only exists as the
        // browser's own draft state until Laura clicks "Speichern" in
        // Website Kit. This just echoes field/value back in the result;
        // ResearchChat.tsx is what actually applies it to the live draft
        // when it sees this specific tool in a tool_call event.
        "update_content_field" => {
            let field = call.arguments.get("field").and_then(|v| v.as_str()).unwrap_or("");
            if field.is_empty() {
                json!({ "ok": false, "error": "field is required" }).to_string()
            } else {
                // Keep the argument's original JSON type (bool/number/object/
                // array/string) instead of forcing it through .as_str() —
                // several real SiteContent fields (e.g. whatsapp.enabled,
                // hero.minHeight) aren't strings, and .as_str() silently
                // turned those into "" while still reporting ok:true.
                let value = call.arguments.get("value").cloned().unwrap_or(serde_json::Value::Null);
                json!({ "ok": true, "field": field, "value": value }).to_string()
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
    fn detects_fenced_call_when_an_unrelated_fence_comes_first() {
        // Regression: the model sometimes shows an example code fence before
        // the fence that actually carries the tool call — the parser used to
        // give up after the first fence failed to parse as a known tool.
        let text = "So sieht das Format aus:\n```\n{\"beispiel\": true}\n```\nUnd hier der echte Aufruf:\n```json\n{\"tool\": \"log_research_note\", \"arguments\": {\"category\": \"idea\", \"title\": \"x\", \"body\": \"y\"}}\n```";
        let call = parse_tool_call(text).expect("should detect the second fenced tool call");
        assert_eq!(call.tool, "log_research_note");
    }

    #[test]
    fn detects_embedded_call_when_an_unrelated_brace_pair_comes_first() {
        // Regression: a first-`{`-to-last-`}` greedy span used to swallow an
        // unrelated brace pair earlier in the reply, producing invalid JSON
        // for the whole span and silently missing the real tool call.
        let text = "Die Konfiguration { key: val } war schon da. Jetzt aber: {\"tool\": \"get_recent_analytics\", \"arguments\": {\"days\": 3}}";
        let call = parse_tool_call(text).expect("should detect the second embedded tool call");
        assert_eq!(call.tool, "get_recent_analytics");
        assert_eq!(call.arguments["days"], 3);
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

    #[test]
    fn apply_content_field_update_sets_nested_non_string_value() {
        // Regression: update_content_field used to force every value through
        // .as_str(), silently blanking non-string fields (e.g. a bool toggle
        // or a numeric minHeight) while still reporting ok:true.
        let mut content = json!({ "hero": { "title": "Alt", "minHeight": 400 } });
        apply_content_field_update(&mut content, "hero.minHeight", json!(720));
        assert_eq!(content["hero"]["minHeight"], 720);
        assert_eq!(content["hero"]["title"], "Alt");
    }

    #[test]
    fn apply_content_field_update_creates_missing_intermediate_objects() {
        let mut content = json!({});
        apply_content_field_update(&mut content, "whatsapp.enabled", json!(true));
        assert_eq!(content["whatsapp"]["enabled"], true);
    }
}
