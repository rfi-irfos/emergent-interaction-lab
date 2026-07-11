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
    "web_search",
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
    s.push_str("- update_content_field(field, value): schreibt einen Wert direkt in den Website-Kit-Entwurf, z.B. field=\"hero.title\" oder field=\"about.body\" — Punktnotation für verschachtelte Felder. Wird sofort im Entwurf übernommen (Laura sieht die Änderung live im Website Kit), aber erst mit \"Speichern\" dort tatsächlich veröffentlicht. Nutze get_content_section zuerst, um die genaue Feldstruktur zu sehen, bevor du sie überschreibst.\n");
    s.push_str("- web_search(query): sucht im offenen Web über die DuckDuckGo Instant Answer API — echte, live abgerufene Ergebnisse, keine Erfindung. Liefert aber nur bei bekannten Begriffen/Themen etwas (eine Zusammenfassung plus verwandte Themen), keine vollständige Trefferliste wie eine normale Suchmaschine — bei speziellen, sehr aktuellen oder ungewöhnlichen Fragen kommt oft nichts zurück. Wenn nichts gefunden wurde, sag das ehrlich (\"dazu hat die Websuche nichts gefunden\") statt etwas zu erfinden, und präsentiere Treffer nie als vollständiger oder autoritativer, als sie sind.\n\n");
    s.push_str("Wenn keine Handlung nötig ist, antworte ganz normal im Gespräch — kein JSON, keine Werkzeug-Erwähnung.");
    s
}

pub(crate) struct ToolCall {
    pub tool: String,
    pub arguments: serde_json::Value,
}

pub(crate) fn try_parse_as_tool_call(candidate: &str) -> Option<ToolCall> {
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
pub(crate) fn matching_brace_end(text: &str, start: usize) -> Option<usize> {
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

/// Streaming counterpart to `parse_tool_call`, used by chat.rs to decide —
/// on every delta, not just once the round is complete — whether the reply
/// accumulated *so far* could still turn into a tool call.
///
/// Returns the byte offset of the earliest `{` for which either:
/// - no matching `}` has arrived yet (the brace is still open — it might
///   still be forming tool-call JSON as more text streams in), or
/// - the span it closes into already parses as a real, known tool call,
///   exactly the shape `parse_tool_call` itself would find at round end.
///
/// Returns `None` once neither case applies anywhere in `text` — i.e. every
/// byte of `text` is safe to forward to the client right now, and (short of
/// more text arriving and opening a *new* brace) will stay safe.
///
/// Deliberately brace-only: no separate handling for fenced ```` ``` ````
/// blocks. Every shape `parse_tool_call` recognizes — bare JSON, fenced, or
/// embedded in prose — is, at the byte level, nothing more than a `{...}`
/// span; markdown fencing around it never changes whether that span exists
/// or what it parses as, so scanning for braces alone has identical
/// detection power. It also means an ordinary inline-code backtick (or even
/// a whole fenced code block with no JSON in it) never trips this check —
/// unlike the old `text.contains('{') || text.contains('`'))` latch it
/// replaces, which suppressed forwarding for the rest of the round the
/// instant ANY backtick appeared, tool call or not.
pub(crate) fn partial_tool_call_span(text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            match matching_brace_end(text, i) {
                Some(end) => {
                    if try_parse_as_tool_call(&text[i..=end]).is_some() {
                        return Some(i);
                    }
                    // Not a real tool call — keep scanning past it in case a
                    // later `{` in the same text is the real one (mirrors
                    // parse_tool_call's own shape-3 loop).
                    i += 1;
                }
                // Unterminated so far — still might close into a call once
                // more text streams in.
                None => return Some(i),
            }
        } else {
            i += 1;
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
            let id = crate::blog::insert_post(state, title, body, "agent", Some(conversation_id), None).await;
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
        "web_search" => {
            let query = call.arguments.get("query").and_then(|v| v.as_str()).unwrap_or("");
            web_search(state, query).await
        }
        other => json!({ "error": format!("unknown tool: {other}") }).to_string(),
    }
}

/// Live web grounding via DuckDuckGo's Instant Answer API (`format=json`,
/// no key required). Deliberately NOT scraping DuckDuckGo's `/html/`
/// results page: tested both from this deployment's network position, and
/// the HTML endpoint's anti-bot "anomaly" challenge blocked the
/// overwhelming majority of attempts (roughly 7 of 8, with the one
/// success not reproducible with the same technique afterward) — a
/// datacenter egress IP reads as automated traffic to DuckDuckGo, and
/// Fly.io's IP ranges are exactly that kind of IP too, so the same wall
/// would very plausibly bite in production. That would silently degrade
/// the tool to "search failed" most of the time — worse for genuine
/// grounding than an API that reliably answers but is thin for anything
/// that isn't a well-known topic/entity. The thinness is real (see
/// `extract_ddg_results`), so an empty result set is reported honestly as
/// "nothing found" rather than papered over.
pub(crate) async fn web_search(state: &AppState, query: &str) -> String {
    let query = query.trim();
    if query.is_empty() {
        return json!({ "ok": false, "error": "query darf nicht leer sein" }).to_string();
    }

    let res = state
        .http
        .get(format!("{}/", state.ddg_api_base))
        .query(&[("q", query), ("format", "json"), ("no_html", "1"), ("skip_disambig", "1")])
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await;

    let res = match res {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            tracing::warn!("DuckDuckGo search returned {}", r.status());
            return json!({
                "ok": false,
                "query": query,
                "error": "Websuche fehlgeschlagen — DuckDuckGo hat mit einem Fehler geantwortet.",
            })
            .to_string();
        }
        Err(e) => {
            tracing::warn!("DuckDuckGo search request failed: {e}");
            return json!({
                "ok": false,
                "query": query,
                "error": "Websuche fehlgeschlagen — keine Verbindung zu DuckDuckGo.",
            })
            .to_string();
        }
    };

    let body: serde_json::Value = match res.json().await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("DuckDuckGo search response could not be parsed: {e}");
            return json!({
                "ok": false,
                "query": query,
                "error": "Websuche fehlgeschlagen — Antwort von DuckDuckGo war nicht lesbar.",
            })
            .to_string();
        }
    };

    let results = extract_ddg_results(&body);
    let note = if results.is_empty() {
        "Keine Treffer über die DuckDuckGo Instant Answer API — die liefert nur bei bekannten Themen/Begriffen etwas, keine vollständige Trefferliste wie eine normale Suchmaschine. Das ist ein ehrliches 'nichts gefunden', keine Erfindung."
    } else {
        "Echte, live abgerufene Web-Ergebnisse, keine Erfindung — aber nicht automatisch vollständig oder abschließend."
    };

    json!({
        "ok": true,
        "query": query,
        "source": "DuckDuckGo Instant Answer API (live, kein API-Key)",
        "results": results,
        "note": note,
    })
    .to_string()
}

/// Pulls up to 5 usable `{title, url, snippet}` entries out of a DuckDuckGo
/// Instant Answer API response: the topic abstract (if any), then a direct
/// Answer/Definition quick-fact (if any), then RelatedTopics — which mixes
/// plain `{Text, FirstURL}` entries with `{Name, Topics: [...]}` category
/// groups, so both shapes are handled rather than assuming one.
fn extract_ddg_results(body: &serde_json::Value) -> Vec<serde_json::Value> {
    let mut out = Vec::new();

    let abstract_text = body.get("AbstractText").and_then(|v| v.as_str()).unwrap_or("");
    if !abstract_text.is_empty() {
        out.push(json!({
            "title": body.get("Heading").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or("Übersicht"),
            "url": body.get("AbstractURL").and_then(|v| v.as_str()).unwrap_or(""),
            "snippet": abstract_text,
        }));
    }

    let answer = body.get("Answer").and_then(|v| v.as_str()).unwrap_or("");
    if !answer.is_empty() {
        out.push(json!({ "title": "Direkte Antwort", "url": "", "snippet": answer }));
    }

    let definition = body.get("Definition").and_then(|v| v.as_str()).unwrap_or("");
    if !definition.is_empty() {
        out.push(json!({
            "title": body.get("DefinitionSource").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or("Definition"),
            "url": body.get("DefinitionURL").and_then(|v| v.as_str()).unwrap_or(""),
            "snippet": definition,
        }));
    }

    fn push_related(entry: &serde_json::Value, out: &mut Vec<serde_json::Value>) {
        if let Some(topics) = entry.get("Topics").and_then(|v| v.as_array()) {
            for t in topics {
                push_related(t, out);
            }
            return;
        }
        let text = entry.get("Text").and_then(|v| v.as_str()).unwrap_or("");
        if text.is_empty() {
            return;
        }
        let url = entry.get("FirstURL").and_then(|v| v.as_str()).unwrap_or("");
        let (title, snippet) = text.split_once(" - ").unwrap_or((text, text));
        out.push(json!({ "title": title, "url": url, "snippet": snippet }));
    }

    if let Some(related) = body.get("RelatedTopics").and_then(|v| v.as_array()) {
        for entry in related {
            if out.len() >= 5 {
                break;
            }
            push_related(entry, &mut out);
        }
    }

    out.truncate(5);
    out
}

/// Reads `result`'s own success/failure signal to decide the status this
/// tool call is logged under — fixes the bug where `log_tool_call` used to
/// hardcode `'ok'` on every single row regardless of what actually
/// happened, which made `observatory::diagnostics`'s `agent_calls_error`
/// figure permanently 0 no matter how many tool calls genuinely failed.
///
/// Field name verified against every one of `execute_tool`'s 9 match arms
/// above (not assumed): 7 of the 9 use a top-level `"ok": bool` — present on
/// EVERY failure path across all 9 tools, and on most success paths too
/// (`draft_blog_post`, `revise_blog_post`, `log_research_note`,
/// `update_content_field`, `run_simulation_scenario`, `web_search` all set
/// `"ok"` either way). The two exceptions are success-only shapes with no
/// `"ok"` field at all: `get_recent_analytics` (`{"views", "unique_visitors",
/// "days"}`, always a success — its only failure mode, a DB error, is
/// already swallowed to `(0, 0)` by `.unwrap_or((0, 0))` before this
/// function ever sees it) and `get_content_section`/`get_blog_post`'s
/// success shapes (the raw section value / raw post JSON, whatever that
/// happens to contain — never guaranteed to carry an "ok" key itself). Both
/// of THOSE tools' failure paths instead use a top-level `"error"` key with
/// no `"ok"` at all (`{"error": "post not found"}`, `{"error": "section not
/// found..."}`). So: `"ok"` wins when present (its own bool, either way);
/// otherwise a top-level `"error"` key means failure; otherwise — no "ok",
/// no "error" — it's one of the two known no-"ok" success shapes, logged as
/// `'ok'`. This mirrors execute_tool's own arms exactly; it does not guess.
///
/// `pub(crate)` (not private) as of the Anomaly Watchdog v1 (see
/// anomaly.rs): `chat::stream_chat`'s tool-calling round loop calls this
/// directly to flag a real tool-call failure, reusing this exact
/// classification rather than a second copy of it living in chat.rs.
pub(crate) fn tool_call_status(result: &str) -> &'static str {
    match serde_json::from_str::<serde_json::Value>(result) {
        Ok(v) => match v.get("ok").and_then(|x| x.as_bool()) {
            Some(true) => "ok",
            Some(false) => "error",
            None => {
                if v.get("error").is_some() {
                    "error"
                } else {
                    "ok"
                }
            }
        },
        // execute_tool always returns a `json!{...}.to_string()` — genuinely
        // unparsable JSON here would itself be a bug elsewhere in this
        // module, but this fails safe (logged as an error, not a panic)
        // rather than assuming success it has no evidence for.
        Err(_) => "error",
    }
}

/// `id` is generated by the caller (chat.rs's `stream_chat`, one round of
/// the tool-calling loop) rather than here, so the caller can durably link
/// this specific tool call's id into `chat_messages.tool_call_ids` even
/// though the actual INSERT below is best-effort (`let _ =`) like the rest
/// of this codebase's writes — see chat.rs's `tool_call_ids` accumulator.
pub(crate) async fn log_tool_call(state: &AppState, conversation_id: &str, id: &str, call: &ToolCall, result: &str) {
    let status = tool_call_status(result);
    let _ = sqlx::query(
        "INSERT INTO agent_tool_calls (id, conversation_id, tool_name, arguments, result, status) VALUES (?1,?2,?3,?4,?5,?6)",
    )
    .bind(id)
    .bind(conversation_id)
    .bind(&call.tool)
    .bind(call.arguments.to_string())
    .bind(result)
    .bind(status)
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

    #[test]
    fn detects_bare_web_search_tool_call() {
        let text = r#"{"tool": "web_search", "arguments": {"query": "emergent interaction lab"}}"#;
        let call = parse_tool_call(text).expect("should detect web_search tool call");
        assert_eq!(call.tool, "web_search");
        assert_eq!(call.arguments["query"], "emergent interaction lab");
    }

    // ── web_search dispatch, against a local mock of the DuckDuckGo Instant
    // Answer API (never the real network in the test suite) ────────────────

    use axum::{routing::get as axget, Json as AxJson, Router};
    use std::{collections::HashMap, path::PathBuf, sync::{Arc, RwLock}};

    /// Canned response shaped like a real DuckDuckGo Instant Answer API hit
    /// with both an abstract and a mix of plain/grouped RelatedTopics —
    /// exercises both shapes extract_ddg_results has to handle.
    async fn mock_ddg_hit() -> AxJson<serde_json::Value> {
        AxJson(json!({
            "AbstractText": "Human–computer interaction is the process through which people operate and engage with computer systems.",
            "AbstractURL": "https://en.wikipedia.org/wiki/Human-computer_interaction",
            "Heading": "Human-computer interaction",
            "Answer": "",
            "Definition": "",
            "RelatedTopics": [
                { "Text": "Information architecture - the structural design of shared information environments.", "FirstURL": "https://duckduckgo.com/Information_architecture" },
                { "Name": "Grouped", "Topics": [
                    { "Text": "Information design - presenting information for effective understanding.", "FirstURL": "https://duckduckgo.com/Information_design" }
                ] }
            ],
        }))
    }

    async fn mock_ddg_miss() -> AxJson<serde_json::Value> {
        AxJson(json!({
            "AbstractText": "", "AbstractURL": "", "Heading": "", "Answer": "", "Definition": "",
            "RelatedTopics": [],
        }))
    }

    async fn start_mock_ddg(hit: bool) -> String {
        let app = Router::new().route(
            "/",
            axget(move || async move { if hit { mock_ddg_hit().await } else { mock_ddg_miss().await } }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    async fn test_state(ddg_api_base: String) -> AppState {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
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
            ddg_api_base,
            github_token: String::new(),
            github_api_base: "https://api.github.com".to_string(),
            chat_model_idx: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            chat_request_count: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }
    }

    #[tokio::test]
    async fn web_search_tool_call_dispatches_and_parses_a_real_shaped_ddg_response() {
        let base = start_mock_ddg(true).await;
        let state = test_state(base).await;
        let call = ToolCall { tool: "web_search".to_string(), arguments: json!({ "query": "human computer interaction" }) };

        let result = execute_tool(&state, &call, None, "conv-1").await;
        let parsed: serde_json::Value = serde_json::from_str(&result).expect("valid JSON result");

        assert_eq!(parsed["ok"], true);
        assert_eq!(parsed["query"], "human computer interaction");
        let results = parsed["results"].as_array().expect("results array");
        // Abstract entry, plus the plain RelatedTopics entry, plus the one
        // nested inside a {Topics: [...]} group — proves both shapes flatten.
        assert_eq!(results.len(), 3);
        assert_eq!(results[0]["title"], "Human-computer interaction");
        assert!(results[0]["snippet"].as_str().unwrap().contains("Human–computer interaction"));
        assert_eq!(results[1]["title"], "Information architecture");
        assert_eq!(results[2]["title"], "Information design");
    }

    #[tokio::test]
    async fn web_search_tool_call_reports_an_honest_no_results_instead_of_fabricating() {
        let base = start_mock_ddg(false).await;
        let state = test_state(base).await;
        let call = ToolCall { tool: "web_search".to_string(), arguments: json!({ "query": "something obscure" }) };

        let result = execute_tool(&state, &call, None, "conv-1").await;
        let parsed: serde_json::Value = serde_json::from_str(&result).expect("valid JSON result");

        assert_eq!(parsed["ok"], true);
        assert_eq!(parsed["results"].as_array().unwrap().len(), 0);
        assert!(parsed["note"].as_str().unwrap().contains("Keine Treffer"));
    }

    #[tokio::test]
    async fn web_search_tool_call_fails_gracefully_instead_of_crashing_the_round() {
        // Nothing is listening on this base URL — simulates the network
        // failing outright (down, timeout, DNS) rather than mocking a
        // well-formed response, matching the "graceful failure" requirement.
        let state = test_state("http://127.0.0.1:1".to_string()).await;
        let call = ToolCall { tool: "web_search".to_string(), arguments: json!({ "query": "anything" }) };

        let result = execute_tool(&state, &call, None, "conv-1").await;
        let parsed: serde_json::Value = serde_json::from_str(&result).expect("valid JSON result even on failure");

        assert_eq!(parsed["ok"], false);
        assert!(parsed["error"].as_str().unwrap().contains("Websuche fehlgeschlagen"));
    }

    #[test]
    fn partial_span_is_none_for_plain_prose_with_no_braces() {
        assert!(partial_tool_call_span("Guten Tag! Wie kann ich helfen?").is_none());
    }

    #[test]
    fn partial_span_is_none_once_an_incidental_brace_pair_resolves_as_non_tool_call() {
        // Mirrors `ignores_ordinary_prose_with_incidental_braces` above: the
        // brace closes, but the inner text isn't valid tool-call JSON, so
        // nothing here should keep forwarding suppressed.
        let text = "Die Konfiguration { key: val } war schon da.";
        assert!(partial_tool_call_span(text).is_none());
    }

    #[test]
    fn partial_span_is_pending_while_a_brace_is_still_unterminated() {
        // The model has only streamed the opening of what *might* become
        // tool-call JSON — the closing `}` hasn't arrived yet.
        let text = "Klar, mache ich gleich: {\"tool\": \"draft_blog_post\", ";
        let span = partial_tool_call_span(text).expect("an unterminated brace must be reported as pending");
        assert_eq!(span, text.find('{').unwrap());
    }

    #[test]
    fn partial_span_locks_onto_a_real_tool_call_once_it_closes() {
        let text = "Klar, mache ich gleich: {\"tool\": \"draft_blog_post\", \"arguments\": {\"title\": \"T\", \"body\": \"B\"}}";
        let span = partial_tool_call_span(text).expect("a completed real tool call must report its start offset");
        assert_eq!(span, text.find('{').unwrap());
        // parse_tool_call must agree that this text really is a tool call —
        // otherwise this function and the final parser could disagree.
        assert!(parse_tool_call(text).is_some());
    }

    // ── log_tool_call status fix: real status, not hardcoded 'ok' ──────────
    // Regression covered here: log_tool_call used to INSERT every row with
    // a literal 'ok' regardless of what `result` actually said, which made
    // observatory::diagnostics's agent_calls_error permanently 0.

    #[test]
    fn tool_call_status_reads_explicit_ok_false_as_error() {
        // Matches revise_blog_post/update_content_field/run_simulation_scenario/
        // web_search's own failure shape: {"ok": false, "error": "..."}.
        assert_eq!(tool_call_status(r#"{"ok": false, "error": "refusing to revise a published post"}"#), "error");
    }

    #[test]
    fn tool_call_status_reads_explicit_ok_true_as_ok() {
        assert_eq!(tool_call_status(r#"{"ok": true, "id": "abc-123", "status": "draft"}"#), "ok");
    }

    #[test]
    fn tool_call_status_reads_error_only_shape_as_error() {
        // get_blog_post / get_content_section's failure shape: an "error"
        // key with no "ok" field at all.
        assert_eq!(tool_call_status(r#"{"error": "post not found"}"#), "error");
    }

    #[test]
    fn tool_call_status_reads_no_ok_no_error_shape_as_ok() {
        // get_recent_analytics's only shape (always a success by the time
        // it reaches log_tool_call — see this function's own doc comment)
        // and get_blog_post/get_content_section's success shape: neither
        // "ok" nor "error" present at all.
        assert_eq!(tool_call_status(r#"{"views": 42, "unique_visitors": 10, "days": 7}"#), "ok");
    }

    #[test]
    fn tool_call_status_fails_safe_on_unparsable_result() {
        assert_eq!(tool_call_status("not json at all"), "error");
    }

    #[tokio::test]
    async fn log_tool_call_persists_the_real_error_status_for_a_failed_call() {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        init_schema(&db).await;
        let state = test_state("https://api.duckduckgo.com".to_string()).await;
        // Reuse the real `db` above (test_state's own is a separate
        // in-memory instance) by constructing the call against it directly.
        let call = ToolCall { tool: "revise_blog_post".to_string(), arguments: json!({ "post_id": "p1" }) };
        let result = json!({ "ok": false, "error": "refusing to revise a post with status 'published'" }).to_string();

        log_tool_call(&state_with_db(&state, db.clone()), "conv-1", "call-1", &call, &result).await;

        let row: (String,) = sqlx::query_as("SELECT status FROM agent_tool_calls WHERE id = 'call-1'")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(row.0, "error", "a failed tool call must now be logged with status != 'ok', not hardcoded 'ok'");
    }

    #[tokio::test]
    async fn log_tool_call_persists_ok_status_for_a_successful_call() {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        init_schema(&db).await;
        let state = test_state("https://api.duckduckgo.com".to_string()).await;
        let call = ToolCall { tool: "draft_blog_post".to_string(), arguments: json!({ "title": "T", "body": "B" }) };
        let result = json!({ "ok": true, "id": "post-1", "status": "draft" }).to_string();

        log_tool_call(&state_with_db(&state, db.clone()), "conv-1", "call-2", &call, &result).await;

        let row: (String,) = sqlx::query_as("SELECT status FROM agent_tool_calls WHERE id = 'call-2'")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(row.0, "ok");
    }

    /// `test_state()` above builds its own throwaway in-memory DB — these
    /// two tests need `log_tool_call` to write into a specific `db` handle
    /// this test controls, so it can read the row back afterward. Swaps just
    /// the `db` field rather than duplicating the whole AppState literal
    /// (AppState/SqlitePool are both Clone).
    fn state_with_db(state: &AppState, db: sqlx::SqlitePool) -> AppState {
        AppState { db, ..state.clone() }
    }

    #[test]
    fn partial_span_keeps_scanning_past_a_non_tool_call_brace_to_find_a_later_real_one() {
        let text = "Die Konfiguration { key: val } war schon da. Jetzt aber: {\"tool\": \"get_recent_analytics\", \"arguments\": {\"days\": 3}}";
        let span = partial_tool_call_span(text).expect("the second, real tool call must still be found");
        // Must point at the SECOND `{` (the real call), not the first
        // (harmless, non-JSON) one.
        assert_eq!(span, text.rfind("{\"tool\"").unwrap());
    }
}
