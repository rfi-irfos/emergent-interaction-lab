//! An MCP server, so the bundled Hermes agent can write back into the lab.
//!
//! Hermes runs its OWN tool loop with its OWN tools — it never calls the tools in
//! `agent.rs`. So out of the box a Hermes research turn could talk and remember,
//! but it could not do the thing the Forschung tab exists for: leave a note in
//! Research Pulse that outlives the conversation. It was a guest in the lab, not
//! a member of it.
//!
//! Hermes speaks MCP, and its client supports a plain `url:` (StreamableHTTP), so
//! rather than shipping a separate bridge process this backend just *is* the MCP
//! server. The agent gets three tools:
//!
//!   log_research_note     — write a note into the same `research_notes` table the
//!                           human UI and Jarvis's own `log_research_note` write to
//!   search_research_notes — read what the lab already knows, so it builds on
//!                           existing notes instead of re-deriving them
//!   web_search            — the backend's own keyless DuckDuckGo search (see
//!                           `web_search` below for why it has to come from here)
//!
//! ## Why this is a deliberately small surface
//!
//! This endpoint hands a language model a write path into the database, so it
//! exposes exactly these tools and nothing else — no generic query, no delete, no
//! update. The agent can add to the lab's knowledge and read it back. It cannot
//! remove or rewrite what's already there, so a bad turn (or a prompt injection
//! in a web page the agent read) can leave a junk note for a human to delete, but
//! it cannot destroy work. See `deploy/hermes-config.yaml` for the matching
//! restriction on Hermes's built-in toolset.
//!
//! ## Auth
//!
//! Bearer `EIL_MCP_TOKEN`, generated per boot by start.sh and handed to both this
//! backend and Hermes (whose config reads it back out of the environment via
//! `${EIL_MCP_TOKEN}`). Empty token = the route is off entirely, which is the
//! state of any deployment not running the bundled agent.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde_json::{json, Value};

use crate::AppState;

/// The MCP revision this server implements. Echoed back from the client's
/// `initialize` when it asks for one it knows, which is what the spec's version
/// negotiation asks of a server that can speak the client's dialect — our surface
/// (tools/list + tools/call, no resources, no prompts, no server-initiated
/// messages) has not changed across these revisions.
const DEFAULT_PROTOCOL_VERSION: &str = "2025-06-18";

pub(crate) fn enabled(state: &AppState) -> bool {
    !state.mcp_token.is_empty()
}

fn authorized(state: &AppState, headers: &HeaderMap) -> bool {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| t.trim() == state.mcp_token)
        .unwrap_or(false)
}

/// The tools the agent is allowed to reach. Kept next to the dispatcher in
/// `call_tool` so a tool can never be advertised without being implemented, or
/// implemented without being declared.
fn tool_definitions() -> Value {
    json!([
        {
            "name": "log_research_note",
            "description": "Log a research note into the Emergent Interaction Lab's Research Pulse, \
where it is visible to the team and outlives this conversation. Use it when the conversation \
produces something worth keeping: a hypothesis, an idea, a concept, a framework, a prototype \
sketch, or a summary of a paper. Prefer one substantial note over several thin ones. Search \
first — if a note on this already exists, build on it in a new note rather than repeating it.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "enum": ["paper", "hypothesis", "idea", "concept", "framework", "prototype"],
                        "description": "Which kind of note this is."
                    },
                    "title": { "type": "string", "description": "A short, specific title." },
                    "body": { "type": "string", "description": "The note itself, in Markdown." },
                    "tags": { "type": "string", "description": "Optional comma-separated tags." },
                    "conversation_id": {
                        "type": "string",
                        "description": "The id of the research conversation this note grew out of. \
It is given to you in your instructions for this turn — pass it so the note links back to the talk."
                    }
                },
                "required": ["category", "title", "body"]
            }
        },
        {
            "name": "web_search",
            "description": "Search the web for current information. Use it before answering anything \
you are not certain of, and to ground research notes in sources rather than recollection.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "The search query." }
                },
                "required": ["query"]
            }
        },
        {
            "name": "search_research_notes",
            "description": "Search the lab's existing research notes before writing a new one, or to \
ground an answer in what the lab already knows. Returns the most recently updated matches.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Free text matched against title and body. Omit to list the most recent notes." },
                    "category": {
                        "type": "string",
                        "enum": ["paper", "hypothesis", "idea", "concept", "framework", "prototype"],
                        "description": "Optionally restrict to one category."
                    },
                    "limit": { "type": "integer", "description": "Max notes to return (default 10, max 25)." }
                }
            }
        }
    ])
}

/// `POST /api/mcp` — the whole MCP surface, over StreamableHTTP.
///
/// Answers with plain JSON rather than an SSE stream: the spec allows it, and
/// every response this server produces is a single immediate result — there is
/// nothing to stream, and no server-initiated messages, so a stream would be
/// ceremony with no payload. Stateless, so no `Mcp-Session-Id` is issued.
pub async fn handle(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: String,
) -> impl IntoResponse {
    if !enabled(&state) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if !authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let Ok(req) = serde_json::from_str::<Value>(&body) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_response(Value::Null, -32700, "Parse error")),
        )
            .into_response();
    };

    let method = req["method"].as_str().unwrap_or("");
    let id = req["id"].clone();

    // A JSON-RPC notification has no `id` and must get no response body — the
    // client (`notifications/initialized`) is not waiting for one, and answering
    // it with a result is a protocol error.
    if id.is_null() {
        return StatusCode::ACCEPTED.into_response();
    }

    let result = match method {
        "initialize" => {
            // Echo the client's protocol version when it names one, so a Hermes
            // built against an older or newer MCP SDK than this file was written
            // for still negotiates cleanly.
            let version = req["params"]["protocolVersion"]
                .as_str()
                .unwrap_or(DEFAULT_PROTOCOL_VERSION)
                .to_string();
            Ok(json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "emergent-interaction-lab", "version": env!("CARGO_PKG_VERSION") }
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_definitions() })),
        "tools/call" => {
            let name = req["params"]["name"].as_str().unwrap_or("");
            let args = req["params"]["arguments"].clone();
            call_tool(&state, name, &args).await
        }
        // Declared unsupported rather than silently empty: a client that asks for
        // resources/prompts should learn we have none, not that we have zero.
        other => Err(format!("Method not supported: {other}")),
    };

    match result {
        Ok(value) => Json(json!({ "jsonrpc": "2.0", "id": id, "result": value })).into_response(),
        Err(msg) => Json(error_response(id, -32601, &msg)).into_response(),
    }
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// A tool's failure is returned as a RESULT with `isError: true`, not a JSON-RPC
/// error: the distinction matters because a JSON-RPC error is a protocol failure
/// the agent cannot act on, while `isError` is a tool telling the agent "that
/// didn't work, here's why" — which it can read and retry.
async fn call_tool(state: &AppState, name: &str, args: &Value) -> Result<Value, String> {
    match name {
        "log_research_note" => Ok(log_research_note(state, args).await),
        "search_research_notes" => Ok(search_research_notes(state, args).await),
        "web_search" => Ok(web_search(state, args).await),
        other => Err(format!("Unknown tool: {other}")),
    }
}

/// Web search, served from the backend's own DuckDuckGo-backed `agent::web_search`
/// — the same tool Jarvis uses.
///
/// This exists because Hermes's built-in `web` toolset needs a search-provider
/// API key of its own (`check_web_api_key`), and without one it silently drops
/// those tools: driven for real, the bundled agent was offered `memory` and
/// nothing else, so it could remember but not look anything up. Routing search
/// through the lab's own keyless tool keeps the one-key promise honest — an
/// operator sets NVIDIA_API_KEY and the agent can actually research.
///
/// (An operator who DOES configure a Hermes web key still gets Hermes's own web
/// tools on top; the `web` toolset stays enabled in the seed config for exactly
/// that case.)
async fn web_search(state: &AppState, args: &Value) -> Value {
    let query = args["query"].as_str().unwrap_or("").trim();
    if query.is_empty() {
        return text_result("A search needs a query.".to_string(), true);
    }
    let raw = crate::agent::web_search(state, query).await;
    // `agent::web_search` already returns the `{"ok":…}` JSON envelope the
    // built-in tool loop expects; MCP wants text content, so it's passed through
    // as-is rather than re-shaped — the model reads it perfectly well, and
    // reformatting would be a second place for the result shape to drift.
    text_result(raw, false)
}

fn text_result(text: String, is_error: bool) -> Value {
    json!({
        "content": [{ "type": "text", "text": text }],
        "isError": is_error
    })
}

const CATEGORIES: [&str; 6] = ["paper", "hypothesis", "idea", "concept", "framework", "prototype"];

async fn log_research_note(state: &AppState, args: &Value) -> Value {
    let category = args["category"].as_str().unwrap_or("").trim();
    let title = args["title"].as_str().unwrap_or("").trim();
    let body = args["body"].as_str().unwrap_or("").trim();
    let tags = args["tags"].as_str().unwrap_or("").trim();

    // Validated rather than trusted: `research_notes.category` has a CHECK
    // constraint, so a bad value from the model would otherwise fail the INSERT
    // silently (every write in this codebase is best-effort `let _ =`) and the
    // agent would believe it had logged a note that does not exist.
    if !CATEGORIES.contains(&category) {
        return text_result(
            format!("Unknown category {category:?}. Use one of: {}.", CATEGORIES.join(", ")),
            true,
        );
    }
    if title.is_empty() || body.is_empty() {
        return text_result("A note needs both a title and a body.".to_string(), true);
    }

    // Only linked when the id is real. The agent is told its conversation id in
    // the turn's instructions (see hermes.rs), but a model can garble or invent
    // one, and a note pointing at a conversation that does not exist is worse
    // than a note pointing at nothing.
    let conversation_id = args["conversation_id"].as_str().unwrap_or("").trim();
    let linked: Option<String> = if conversation_id.is_empty() {
        None
    } else {
        let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM chat_conversations WHERE id = ?1")
            .bind(conversation_id)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);
        exists.map(|r| r.0)
    };

    let id = crate::research::insert_note(
        state,
        category,
        title,
        body,
        tags,
        // Its own source, not "agent": the Research Pulse UI labels this so a
        // reader can tell which agent produced a note. Lumping Hermes in with
        // Jarvis would make the lab's own record of who-thought-what wrong.
        "hermes",
        linked.as_deref(),
    )
    .await;

    text_result(
        format!("Logged {category} note {id:?} — \"{title}\". It is now in Research Pulse."),
        false,
    )
}

async fn search_research_notes(state: &AppState, args: &Value) -> Value {
    let limit = args["limit"].as_i64().unwrap_or(10).clamp(1, 25);
    let query = args["query"].as_str().unwrap_or("").trim();
    let category = args["category"].as_str().unwrap_or("").trim();

    let rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT id, category, title, body, updated_at FROM research_notes \
         WHERE (?1 = '' OR title LIKE '%' || ?1 || '%' OR body LIKE '%' || ?1 || '%') \
           AND (?2 = '' OR category = ?2) \
         ORDER BY updated_at DESC LIMIT ?3",
    )
    .bind(query)
    .bind(category)
    .bind(limit)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    if rows.is_empty() {
        return text_result("No matching research notes yet.".to_string(), false);
    }

    let mut out = format!("{} note(s):\n\n", rows.len());
    for (id, cat, title, body, updated) in rows {
        // Truncated on a char boundary — `body` is user/model text and slicing it
        // by byte index would panic on any note containing an umlaut, which in a
        // German-language lab is most of them.
        let excerpt: String = body.chars().take(240).collect();
        out.push_str(&format!("- [{cat}] {title} (id {id}, updated {updated})\n  {excerpt}\n\n"));
    }
    text_result(out, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::{
        collections::HashMap,
        path::PathBuf,
        sync::{Arc, RwLock},
    };

    async fn state_with_token(token: &str) -> AppState {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::chat::init_schema(&db).await;
        crate::research::init_schema(&db).await;
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
            mcp_token: token.to_string(),
            github_token: String::new(),
            github_api_base: "https://api.github.com".to_string(),
            audit_lock: std::sync::Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    fn bearer(token: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("authorization", format!("Bearer {token}").parse().unwrap());
        h
    }

    async fn call(state: &AppState, headers: HeaderMap, body: Value) -> (StatusCode, Value) {
        let resp = handle(State(state.clone()), headers, body.to_string())
            .await
            .into_response();
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let parsed = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, parsed)
    }

    /// The endpoint is a write path into the DB for a language model. It must be
    /// shut, hard, unless a token is configured and presented.
    #[tokio::test]
    async fn the_mcp_endpoint_is_closed_without_the_right_token() {
        let state = state_with_token("secret").await;

        let (no_auth, _) = call(&state, HeaderMap::new(), json!({"jsonrpc":"2.0","id":1,"method":"tools/list"})).await;
        assert_eq!(no_auth, StatusCode::UNAUTHORIZED, "no token must be rejected");

        let (wrong, _) = call(&state, bearer("guess"), json!({"jsonrpc":"2.0","id":1,"method":"tools/list"})).await;
        assert_eq!(wrong, StatusCode::UNAUTHORIZED, "a wrong token must be rejected");

        // And with no token configured at all, the route does not exist.
        let off = state_with_token("").await;
        let (missing, _) = call(&off, bearer("secret"), json!({"jsonrpc":"2.0","id":1,"method":"tools/list"})).await;
        assert_eq!(missing, StatusCode::NOT_FOUND, "an unconfigured MCP route must be absent");
    }

    #[tokio::test]
    async fn it_advertises_exactly_the_tools_it_implements() {
        let state = state_with_token("secret").await;
        let (_, res) = call(&state, bearer("secret"), json!({"jsonrpc":"2.0","id":1,"method":"tools/list"})).await;

        let names: Vec<&str> = res["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, vec!["log_research_note", "web_search", "search_research_notes"]);
    }

    /// The point of the whole module: a note the agent writes lands in the same
    /// table the human UI reads, linked to the conversation it grew out of.
    #[tokio::test]
    async fn a_note_the_agent_logs_lands_in_research_pulse_linked_to_its_conversation() {
        let state = state_with_token("secret").await;
        let _ = sqlx::query("INSERT INTO chat_conversations (id, title) VALUES ('conv-1','Talk')")
            .execute(&state.db)
            .await;

        let (_, res) = call(
            &state,
            bearer("secret"),
            json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
                "name":"log_research_note",
                "arguments":{
                    "category":"hypothesis",
                    "title":"Emergenz braucht Rückkopplung",
                    "body":"Ohne Rückkopplung kein Musterwachstum.",
                    "conversation_id":"conv-1"
                }
            }}),
        )
        .await;
        assert_eq!(res["result"]["isError"], json!(false), "logging must succeed: {res}");

        let row: (String, String, String, Option<String>) = sqlx::query_as(
            "SELECT category, title, source, source_conversation_id FROM research_notes",
        )
        .fetch_one(&state.db)
        .await
        .expect("the note must be in research_notes");

        assert_eq!(row.0, "hypothesis");
        assert_eq!(row.1, "Emergenz braucht Rückkopplung");
        assert_eq!(row.2, "hermes", "the note must be attributed to Hermes, not to Jarvis");
        assert_eq!(row.3.as_deref(), Some("conv-1"), "it must link back to the talk it grew out of");
    }

    /// A conversation id the model invented must not be persisted as a link.
    #[tokio::test]
    async fn a_made_up_conversation_id_is_not_linked() {
        let state = state_with_token("secret").await;

        let (_, res) = call(
            &state,
            bearer("secret"),
            json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
                "name":"log_research_note",
                "arguments":{"category":"idea","title":"T","body":"B","conversation_id":"does-not-exist"}
            }}),
        )
        .await;
        assert_eq!(res["result"]["isError"], json!(false));

        let link: (Option<String>,) = sqlx::query_as("SELECT source_conversation_id FROM research_notes")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(link.0, None, "a note must never claim to come from a conversation that doesn't exist");
    }

    /// A bad category would fail the table's CHECK constraint on a best-effort
    /// INSERT, and the agent would believe it had written a note that isn't
    /// there. It has to be told instead.
    #[tokio::test]
    async fn a_bad_category_is_reported_to_the_agent_rather_than_silently_dropped() {
        let state = state_with_token("secret").await;

        let (_, res) = call(
            &state,
            bearer("secret"),
            json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
                "name":"log_research_note",
                "arguments":{"category":"brainwave","title":"T","body":"B"}
            }}),
        )
        .await;

        assert_eq!(res["result"]["isError"], json!(true), "the agent must learn this failed: {res}");
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM research_notes")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(count.0, 0, "nothing must be written");
    }

    #[tokio::test]
    async fn search_finds_a_note_the_agent_wrote_earlier() {
        let state = state_with_token("secret").await;
        crate::research::insert_note(&state, "concept", "Kopplungsdichte", "Wie eng Teile gekoppelt sind.", "", "hermes", None).await;

        let (_, res) = call(
            &state,
            bearer("secret"),
            json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
                "name":"search_research_notes","arguments":{"query":"Kopplung"}
            }}),
        )
        .await;

        let text = res["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("Kopplungsdichte"), "search must surface the note: {text}");
    }

    /// A notification (no `id`) must get no result body — answering one is a
    /// protocol error and the MCP client will not be waiting for it.
    #[tokio::test]
    async fn a_notification_gets_no_response_body() {
        let state = state_with_token("secret").await;
        let (status, _) = call(
            &state,
            bearer("secret"),
            json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
        )
        .await;
        assert_eq!(status, StatusCode::ACCEPTED);
    }

    /// Version negotiation: whatever revision the client speaks, we answer in.
    #[tokio::test]
    async fn initialize_echoes_the_clients_protocol_version() {
        let state = state_with_token("secret").await;
        let (_, res) = call(
            &state,
            bearer("secret"),
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}),
        )
        .await;
        assert_eq!(res["result"]["protocolVersion"], json!("2025-03-26"));
    }
}
