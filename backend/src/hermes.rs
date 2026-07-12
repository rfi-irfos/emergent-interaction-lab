//! Hermes as a second engine behind Jarvis in the Forschung tab.
//!
//! The built-in engine (`chat.rs`) drives one NVIDIA chat-completions call per
//! round and parses tool calls out of the model's own text (see `agent.rs` for
//! why that convention exists). It is stateless between turns: everything the
//! agent "remembers" is what `chat.rs` re-assembles from SQLite and the RAG
//! chunks on the next request.
//!
//! Hermes (github.com/NousResearch/hermes-agent, MIT) is a full agent runtime
//! with its own tool loop, its own skills, and — the reason it's here — its own
//! long-term memory that persists across turns and grows. This module drives it
//! over the HTTP API server Hermes already ships
//! (`gateway/platforms/api_server.py`), so nothing about Hermes is vendored into
//! this repo and it stays on its own release cycle.
//!
//! Why a service and not WASM in the browser: the agent needs a long-lived
//! process, a filesystem for its memory, and an inference key. In a browser tab
//! the key would ship to every visitor, the tools would not run, and the memory
//! would die with the tab — which is precisely the property we want. So Hermes
//! runs server-side and the tab streams from it.
//!
//! ## Wiring
//!
//! One Hermes session per EIL conversation, keyed by the SAME id — Hermes lets
//! the caller choose the session id on create, so there is no mapping table to
//! keep in sync. Hermes then keeps its own per-session memory under that id
//! while EIL keeps the transcript under the same id in `chat_messages`.
//!
//! A Hermes turn ends in `chat::finalize_turn`, exactly like a built-in one, so
//! the reply lands in the same tables and feeds the same cross-chat memory,
//! emergence, CCET and anomaly machinery. From the Forschung tab's point of
//! view the only difference is which engine produced the text.
//!
//! ## Opt-in
//!
//! `HERMES_URL` unset (the default, and the state of the deployed site today)
//! means this module is inert: `enabled()` is false, the engine selector never
//! offers Hermes, and `chat::stream_chat` behaves exactly as it did before.

use axum::{
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse,
    },
};
use futures::StreamExt;
use serde_json::json;
use uuid::Uuid;

use crate::agent::{self, ToolCall};
use crate::AppState;

/// Hermes runs a full tool loop per turn (its own web search, file and skill
/// tools), so a turn legitimately takes far longer than a single
/// chat-completions call. This bounds only the wait for response *headers* —
/// the same distinction `chat::NVIDIA_CONNECT_TIMEOUT` draws, and for the same
/// reason (a hung upstream must not translate into a silent, never-yielding
/// SSE stream) — never the time Hermes is allowed to spend generating.
const HERMES_CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// How long a research turn will wait for a Hermes that is still booting.
///
/// The bundled deployment runs `min_machines_running = 0` (see fly.toml), so an
/// idle machine is stopped and the next request wakes it. The Rust binary is
/// serving within milliseconds; Hermes — a Python agent loading its toolset — is
/// not, and took ~20s to become ready when driven locally. Without this, the
/// first research question after an idle period would fail against a Hermes that
/// was seconds away from being able to answer it.
///
/// Bounded, because waiting forever on a Hermes that is never coming (crashed,
/// misconfigured) would just hang the tab: past this, the turn fails with a
/// message that says what actually happened.
pub(crate) const HERMES_BOOT_GRACE: std::time::Duration = std::time::Duration::from_secs(45);

/// True when a Hermes API server is configured. Everything else in this module
/// is unreachable when this is false.
pub(crate) fn enabled(state: &AppState) -> bool {
    !state.hermes_url.is_empty()
}

/// Whether Hermes is configured AND actually answering right now.
///
/// `enabled` only says an operator pointed us at a URL. This says the thing at
/// that URL is alive — which is what the engine picker needs to know, so it
/// never offers an engine that is crashed, still booting, or misconfigured.
async fn healthy(state: &AppState) -> bool {
    if !enabled(state) {
        return false;
    }
    state
        .http
        .get(format!("{}/v1/models", state.hermes_url))
        .bearer_auth(&state.hermes_api_key)
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Create the Hermes session for this conversation if it doesn't exist yet.
///
/// Idempotent on purpose: Hermes answers 409 `session_exists` for an id it
/// already has, which is the expected outcome on every turn after the first and
/// is treated as success. Only a genuine failure (unreachable, 401, 5xx) is an
/// error — and it's reported rather than swallowed, because a Hermes turn that
/// silently ran without its session would be a turn that silently lost its
/// memory, which is the one thing this engine exists to provide.
/// Retried, not just attempted once, so a turn sent while Hermes is still
/// booting waits for it instead of failing in front of the user — see
/// `HERMES_BOOT_GRACE`. Only a *connection* failure is retried: a 401 is a
/// misconfiguration that will still be a 401 in 40 seconds, and retrying it
/// would turn a clear error into a long silence.
async fn ensure_session(state: &AppState, conversation_id: &str) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + state.hermes_boot_grace;
    let mut last_err = String::from("Hermes nicht erreichbar.");

    loop {
        let res = state
            .http
            .post(format!("{}/api/sessions", state.hermes_url))
            .bearer_auth(&state.hermes_api_key)
            .timeout(HERMES_CONNECT_TIMEOUT)
            .json(&json!({ "id": conversation_id }))
            .send()
            .await;

        match res {
            // 409 = the session already exists, which is the expected answer on
            // every turn after the first, and is success.
            Ok(r) if matches!(r.status().as_u16(), 201 | 409) => return Ok(()),
            Ok(r) if matches!(r.status().as_u16(), 401 | 403) => {
                return Err("Hermes lehnt den API-Key ab.".to_string());
            }
            Ok(r) => {
                // A 5xx can genuinely mean "still coming up" (the API server is
                // listening before the agent behind it is ready), so it's worth
                // one more try — but it's remembered as the failure to report.
                last_err = format!("Hermes-Session fehlgeschlagen (HTTP {}).", r.status().as_u16());
            }
            Err(_) => {
                last_err = "Hermes nicht erreichbar — startet der Agent gerade?".to_string();
            }
        }

        if tokio::time::Instant::now() >= deadline {
            return Err(last_err);
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}

/// `GET /api/chat/engines` — which engines this deployment can actually run.
///
/// The Forschung tab asks before rendering its engine picker, so the picker
/// only ever offers something that works: on a deployment with no `HERMES_URL`
/// (the default) the answer is just `["builtin"]` and the tab shows no picker at
/// all. This is the one place the frontend learns Hermes exists — deliberately a
/// capability list and not the URL or the key, neither of which the browser has
/// any business knowing.
pub async fn engines(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    if !crate::authz::require_admin(&state, &headers) {
        return axum::http::StatusCode::UNAUTHORIZED.into_response();
    }
    let mut available = vec!["builtin"];
    // Probed, not merely "is a URL configured": on a scaled-to-zero machine
    // Hermes is still booting for the first ~20s after a wake, and a picker that
    // offers an engine which cannot yet answer is worse than one that appears a
    // moment later. Same for a Hermes that crashed or was misconfigured.
    if healthy(&state).await {
        available.push("hermes");
    }
    axum::Json(json!({ "engines": available })).into_response()
}

/// One event parsed off Hermes's SSE stream — `event:` name plus decoded `data:`
/// JSON. Hermes's event vocabulary is documented at the top of its
/// `api_server.py`; the handful this module acts on are matched by name in
/// `stream_turn` and anything else is ignored rather than treated as an error,
/// so a Hermes release that adds new event types doesn't break the tab.
struct HermesEvent {
    name: String,
    data: serde_json::Value,
}

/// Drive one research turn through Hermes and re-emit it in the SSE dialect the
/// Forschung tab already speaks (`chat.rs`'s `delta` / `reasoning` / `tool_call`
/// / `error` / `done`), so `ResearchChat.tsx` renders a Hermes turn with the
/// code that already renders a built-in one.
///
/// The caller (`chat::stream_chat`) has already persisted the user message and
/// titled the conversation; this fn owns everything from the request to Hermes
/// through `finalize_turn`.
pub(crate) async fn stream_turn(
    state: AppState,
    conversation_id: String,
    user_msg_id: String,
    user_message: String,
) -> axum::response::Response {
    // Session first: a failure here means no memory, so it's surfaced as a
    // visible error event instead of quietly falling through to a memoryless
    // turn. Done before the stream starts so the tab gets a real HTTP-level
    // failure path too.
    if let Err(e) = ensure_session(&state, &conversation_id).await {
        let stream = async_stream::stream! {
            yield Ok::<_, std::convert::Infallible>(Event::default().event("error").data(e));
            yield Ok(Event::default().event("done").data("[DONE]"));
        };
        return Sse::new(stream).keep_alive(KeepAlive::default()).into_response();
    }

    let stream = async_stream::stream! {
        let res = state
            .http
            .post(format!("{}/api/sessions/{}/chat/stream", state.hermes_url, conversation_id))
            .bearer_auth(&state.hermes_api_key)
            .timeout(HERMES_CONNECT_TIMEOUT)
            .json(&json!({ "message": user_message }))
            .send()
            .await;

        let res = match res {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                yield Ok::<_, std::convert::Infallible>(
                    Event::default().event("error").data(format!("Hermes-Anfrage fehlgeschlagen (HTTP {}).", r.status().as_u16()))
                );
                yield Ok(Event::default().event("done").data("[DONE]"));
                return;
            }
            Err(_) => {
                yield Ok(Event::default().event("error").data("Verbindung zu Hermes fehlgeschlagen."));
                yield Ok(Event::default().event("done").data("[DONE]"));
                return;
            }
        };

        // What we accumulate across the turn so `finalize_turn` sees the same
        // shape a built-in turn produces.
        let mut final_full_text = String::new();
        let mut tool_call_ids: Vec<String> = Vec::new();
        let mut errored_tool_calls: Vec<(String, String)> = Vec::new();
        // Exactly what the tab has been shown so far. Tracked separately from
        // `final_full_text` because the two can legitimately diverge: Hermes can
        // finish a turn with `assistant.completed` having streamed no deltas at
        // all (its streaming is configurable, and a tool-only round can end that
        // way). Without this, such a turn is persisted to the DB and rendered as
        // an empty bubble — the reply exists, and nobody ever sees it.
        let mut streamed_text = String::new();

        let mut body = res.bytes_stream();
        let mut buf = String::new();

        while let Some(chunk) = body.next().await {
            let Ok(bytes) = chunk else { break };
            buf.push_str(&String::from_utf8_lossy(&bytes));

            // SSE frames are separated by a blank line. Anything after the last
            // separator is a partial frame and stays in `buf` for the next chunk.
            while let Some(split) = buf.find("\n\n") {
                let frame = buf[..split].to_string();
                buf.drain(..split + 2);

                let Some(ev) = parse_frame(&frame) else { continue };

                match ev.name.as_str() {
                    // Text as Hermes generates it. `tokens` is sent empty: it
                    // carries NVIDIA's per-token logprob detail for the KPI
                    // wall's token tile, which Hermes's API does not expose —
                    // honestly empty rather than fabricated, same principle as
                    // `prompt_tokens` being 0 when a model reports no usage.
                    "assistant.delta" => {
                        if let Some(d) = ev.data["delta"].as_str() {
                            if !d.is_empty() {
                                final_full_text.push_str(d);
                                streamed_text.push_str(d);
                                yield Ok(Event::default().data(json!({ "delta": d, "tokens": Vec::<serde_json::Value>::new() }).to_string()));
                            }
                        }
                    }

                    // Hermes folds reasoning previews into tool.progress under
                    // the reserved `_thinking` tool name (see its
                    // `_tool_progress`); everything else on that channel is
                    // in-flight tool chatter the tab has no lane for.
                    "tool.progress" => {
                        if ev.data["tool_name"].as_str() == Some("_thinking") {
                            if let Some(d) = ev.data["delta"].as_str() {
                                let trimmed = d.trim();
                                // For a model with no separate reasoning trace,
                                // Hermes's `reasoning.available` preview is just
                                // the finished answer again — observed live
                                // against its API server, which closes a turn
                                // with a `_thinking` preview identical to the
                                // text it had already streamed. Forwarding that
                                // would print the reply a second time in the
                                // tab's reasoning panel. A genuine reasoning
                                // model streams its trace BEFORE the answer,
                                // while `final_full_text` is still empty, so it
                                // can never be swallowed by this check.
                                if !trimmed.is_empty() && !final_full_text.contains(trimmed) {
                                    yield Ok(Event::default().event("reasoning").data(json!({ "delta": d }).to_string()));
                                }
                            }
                        }
                    }

                    // A finished Hermes tool call is logged into the same
                    // `agent_tool_calls` table the built-in engine writes, so
                    // the Observatory, the hallucination check and the anomaly
                    // watchdog see Hermes's tool use on equal terms with
                    // Jarvis's own.
                    "tool.completed" | "tool.failed" => {
                        let tool = ev.data["tool_name"].as_str().unwrap_or("unknown").to_string();
                        let failed = ev.name == "tool.failed";
                        let preview = ev.data["preview"].as_str().unwrap_or("").to_string();

                        // `agent::tool_call_status` reads ok/error off this
                        // JSON, so a Hermes failure has to say so in the shape
                        // that function already understands rather than in a
                        // second, parallel convention.
                        let result = if failed {
                            json!({ "ok": false, "error": preview }).to_string()
                        } else {
                            json!({ "ok": true, "result": preview }).to_string()
                        };

                        let call = ToolCall {
                            tool: tool.clone(),
                            arguments: ev.data["args"].clone(),
                        };
                        let id = Uuid::new_v4().to_string();
                        agent::log_tool_call(&state, &conversation_id, &id, &call, &result).await;
                        if failed {
                            errored_tool_calls.push((id.clone(), tool.clone()));
                        }
                        tool_call_ids.push(id);

                        yield Ok(Event::default().event("tool_call").data(json!({ "tool": tool, "result": result }).to_string()));
                    }

                    // Hermes's authoritative final text. Preferred over the
                    // accumulated deltas: Hermes may revise or re-emit the
                    // answer at completion (interrupts, guardrail halts), and
                    // this field is what it stands behind.
                    "assistant.completed" => {
                        if let Some(c) = ev.data["content"].as_str() {
                            if !c.trim().is_empty() {
                                final_full_text = c.to_string();
                            }
                        }
                    }

                    "run.failed" | "error" => {
                        let msg = ev.data["message"].as_str()
                            .or_else(|| ev.data["error"].as_str())
                            .unwrap_or("Hermes-Lauf fehlgeschlagen.");
                        yield Ok(Event::default().event("error").data(msg.to_string()));
                    }

                    "run.completed" => break,

                    _ => {}
                }
            }
        }

        // Same guarantee the built-in engine gives: never persist an empty
        // assistant turn silently.
        if final_full_text.trim().is_empty() {
            final_full_text = "Hermes hat den Lauf beendet, aber keine Antwort formuliert — frag gern nochmal genauer nach.".to_string();
            streamed_text.clear();
        }

        // Flush whatever the tab has NOT been shown. Normally a no-op: the
        // deltas already add up to the final text, so the tail is empty. It
        // matters in the case that has no deltas at all — Hermes ending a turn
        // with `assistant.completed` alone — where without this the reply is
        // persisted but never rendered, and the user sees an empty bubble.
        //
        // Only ever appends the missing tail, so nothing already on screen is
        // repeated. If Hermes REVISED the answer mid-turn (final text isn't an
        // extension of what streamed) the divergence is left alone rather than
        // papered over by re-sending the whole reply underneath the old one: the
        // authoritative text is what gets persisted, and the tab shows it on the
        // next load.
        if let Some(tail) = final_full_text.strip_prefix(&streamed_text) {
            if !tail.is_empty() {
                yield Ok(Event::default().data(json!({ "delta": tail, "tokens": Vec::<serde_json::Value>::new() }).to_string()));
            }
        }

        // The one and only place a Hermes turn diverges from a built-in one is
        // *which model produced the text* — everything downstream is shared.
        // `prompt_tokens`/`reasoning_ms` are 0 and `final_tokens` empty because
        // Hermes's API doesn't report them; `hit_iteration_cap` is false because
        // Hermes enforces its own iteration cap internally and does not tell us
        // when it hit one. Reporting 0/false is honest here, not a placeholder:
        // it means "not measured", and the KPI wall already renders an
        // unmeasured turn as such.
        crate::chat::finalize_turn(
            state.clone(),
            conversation_id.clone(),
            user_msg_id,
            user_message,
            final_full_text,
            Vec::new(),
            0,
            0,
            tool_call_ids,
            errored_tool_calls,
            false,
        )
        .await;

        yield Ok(Event::default().event("done").data("[DONE]"));
    };

    Sse::new(stream).keep_alive(KeepAlive::default()).into_response()
}

/// Parse one SSE frame into its event name and decoded JSON payload.
///
/// Returns `None` for a frame with no usable `data:` JSON (comments, keep-alive
/// pings, and — deliberately — anything malformed): a junk frame mid-turn should
/// cost that frame, not the whole stream.
fn parse_frame(frame: &str) -> Option<HermesEvent> {
    let mut name = String::new();
    let mut data = String::new();

    for line in frame.lines() {
        if let Some(v) = line.strip_prefix("event:") {
            name = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("data:") {
            // Multi-line `data:` fields concatenate with newlines per the SSE
            // spec. Hermes sends single-line JSON today, but honouring the spec
            // costs one line and removes a latent parse failure.
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(v.strip_prefix(' ').unwrap_or(v));
        }
    }

    if data.is_empty() {
        return None;
    }

    Some(HermesEvent {
        name,
        data: serde_json::from_str(&data).ok()?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::Path as AxPath, http::StatusCode, routing::post as axpost, Json as AxJson, Router};
    use serde_json::Value;
    use std::{
        collections::HashMap,
        path::PathBuf,
        sync::{Arc, RwLock},
    };

    /// A Hermes API server good enough to drive one real turn: it creates the
    /// session, then streams the exact event vocabulary `stream_turn` maps
    /// (`api_server.py`'s `assistant.delta` / `tool.completed` /
    /// `assistant.completed` / `run.completed`).
    ///
    /// Also serves `/v1/embeddings`, because a Hermes turn ends in the SAME
    /// `finalize_turn` a built-in one does — which embeds both sides of the
    /// exchange into cross-chat memory. Mocking it here is what lets the test
    /// below assert that a Hermes turn actually grows that memory rather than
    /// just rendering text.
    async fn start_mock_hermes() -> String {
        let sessions = axpost(|AxJson(body): AxJson<Value>| async move {
            let id = body["id"].as_str().unwrap_or("").to_string();
            (
                StatusCode::CREATED,
                AxJson(json!({ "object": "hermes.session", "session": { "id": id } })),
            )
        });

        let chat_stream = axpost(|AxPath(_id): AxPath<String>, AxJson(_body): AxJson<Value>| async move {
            let sse = concat!(
                "event: run.started\ndata: {\"seq\":1}\n\n",
                "event: message.started\ndata: {\"message\":{\"id\":\"msg_1\",\"role\":\"assistant\"}}\n\n",
                "event: assistant.delta\ndata: {\"delta\":\"Hallo aus \"}\n\n",
                "event: tool.progress\ndata: {\"tool_name\":\"_thinking\",\"delta\":\"kurz nachgedacht\"}\n\n",
                "event: assistant.delta\ndata: {\"delta\":\"Hermes.\"}\n\n",
                "event: tool.completed\ndata: {\"tool_name\":\"web_search\",\"preview\":\"3 Treffer\",\"args\":{\"query\":\"emergenz\"}}\n\n",
                "event: assistant.completed\ndata: {\"content\":\"Hallo aus Hermes.\",\"completed\":true}\n\n",
                "event: run.completed\ndata: {\"completed\":true}\n\n",
            );
            axum::response::Response::builder()
                .status(StatusCode::OK)
                .header("content-type", "text/event-stream")
                .body(axum::body::Body::from(sse))
                .unwrap()
        });

        let embeddings = axpost(|| async {
            let vector: Vec<f32> = vec![0.01; 8];
            AxJson(json!({ "data": [{ "embedding": vector }] }))
        });

        let app = Router::new()
            .route("/api/sessions", sessions)
            .route("/api/sessions/:id/chat/stream", chat_stream)
            .route("/v1/embeddings", embeddings);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    async fn test_state(hermes_url: String) -> AppState {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::chat::init_schema(&db).await;
        agent::init_schema(&db).await;
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
            nvidia_api_key: "test-key".to_string(),
            // Same server: it also answers /v1/embeddings, so finalize_turn's
            // memory write resolves against a mock instead of the real API.
            nvidia_api_base: hermes_url.clone(),
            nvidia_connect_timeout: crate::chat::NVIDIA_CONNECT_TIMEOUT,
            chat_secret: String::new(),
            stripe_secret_key: String::new(),
            stripe_api_base: "https://api.stripe.com".to_string(),
            stripe_webhook_secret: String::new(),
            ddg_api_base: "https://api.duckduckgo.com".to_string(),
            hermes_url,
            hermes_api_key: "test-key".to_string(),
            // Short but not zero, so the unreachable-Hermes test genuinely
            // exercises the retry-then-give-up path rather than skipping it —
            // same reasoning as chat.rs's short `nvidia_connect_timeout` in the
            // hanging-candidate tests.
            hermes_boot_grace: std::time::Duration::from_millis(150),
            github_token: String::new(),
            github_api_base: "https://api.github.com".to_string(),
            audit_lock: std::sync::Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    async fn read_sse(resp: axum::response::Response) -> String {
        let bytes = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            axum::body::to_bytes(resp.into_body(), usize::MAX),
        )
        .await
        .expect("a Hermes turn must not hang")
        .unwrap();
        String::from_utf8_lossy(&bytes).to_string()
    }

    /// The whole engine, end to end against a mock Hermes: the turn streams in
    /// the tab's own SSE dialect, and it LANDS — assistant message, tool call,
    /// and cross-chat memory — in exactly the tables a built-in turn writes.
    /// That last part is the point of the whole PR: a Hermes turn has to grow
    /// the same memory, or it's a chatbot in a tab rather than an agent in this
    /// system.
    #[tokio::test]
    async fn a_hermes_turn_streams_to_the_tab_and_lands_in_the_same_tables() {
        let base = start_mock_hermes().await;
        let state = test_state(base).await;

        let _ = sqlx::query("INSERT INTO chat_conversations (id, title) VALUES ('conv-h1','Test')")
            .execute(&state.db)
            .await;
        let _ = sqlx::query(
            "INSERT INTO chat_messages (id, conversation_id, role, content) VALUES ('um-1','conv-h1','user','Was ist Emergenz?')",
        )
        .execute(&state.db)
        .await;

        let resp = stream_turn(
            state.clone(),
            "conv-h1".to_string(),
            "um-1".to_string(),
            "Was ist Emergenz?".to_string(),
        )
        .await;
        let body = read_sse(resp).await;

        // 1. The tab sees text, reasoning, a tool call, and a clean close — in
        //    the dialect ResearchChat.tsx already renders.
        assert!(body.contains("Hallo aus "), "text deltas must reach the tab: {body:?}");
        assert!(body.contains("event: reasoning"), "reasoning must reach the tab: {body:?}");
        assert!(
            body.contains("event: tool_call") && body.contains("web_search"),
            "the tool call must reach the tab: {body:?}"
        );
        assert!(body.contains("event: done"), "the stream must close cleanly: {body:?}");

        // 2. The assistant's turn is persisted — Hermes's authoritative
        //    `assistant.completed` content, not the concatenated deltas.
        let saved: (String,) = sqlx::query_as(
            "SELECT content FROM chat_messages WHERE conversation_id = 'conv-h1' AND role = 'assistant'",
        )
        .fetch_one(&state.db)
        .await
        .expect("the Hermes turn must persist an assistant message");
        assert_eq!(saved.0, "Hallo aus Hermes.");

        // 3. Hermes's tool call is logged where the Observatory and the anomaly
        //    watchdog look for Jarvis's own.
        let tool: (String, String) =
            sqlx::query_as("SELECT tool_name, status FROM agent_tool_calls WHERE conversation_id = 'conv-h1'")
                .fetch_one(&state.db)
                .await
                .expect("a Hermes tool call must be logged like a built-in one");
        assert_eq!(tool.0, "web_search");
        assert_eq!(tool.1, "ok");

        // 4. The exchange grew cross-chat memory — both sides of it.
        let chunks: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_chunks")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert!(
            chunks.0 >= 2,
            "a Hermes turn must fold both sides of the exchange into cross-chat memory, got {}",
            chunks.0
        );
    }

    /// A deployment that runs Hermes and has NO NVIDIA account at all must
    /// still be able to hold a research conversation.
    ///
    /// `stream_chat` refuses a turn with an empty `nvidia_api_key` — correct for
    /// the built-in engine, which cannot generate a single token without it, and
    /// wrong for a Hermes turn, which never calls NVIDIA to generate. Without
    /// the engine-aware guard this test 503s, which would make "run Hermes
    /// instead of NVIDIA" impossible — the whole point of the engine.
    #[tokio::test]
    async fn a_hermes_only_deployment_answers_without_any_nvidia_key() {
        let base = start_mock_hermes().await;
        let mut state = test_state(base).await;
        state.nvidia_api_key = String::new(); // no NVIDIA account whatsoever

        let _ = sqlx::query("INSERT INTO chat_conversations (id, title) VALUES ('conv-h4','T')")
            .execute(&state.db)
            .await;

        // Built by deserialization rather than a struct literal: StreamChatReq's
        // fields are private to chat.rs, and going through serde is also the
        // more honest test — it's the exact path a real request body takes.
        let req: crate::chat::StreamChatReq = serde_json::from_value(json!({
            "conversation_id": "conv-h4",
            "message": "Was ist Emergenz?",
            "engine": "hermes",
        }))
        .unwrap();

        let resp = crate::chat::stream_chat(
            axum::extract::State(state.clone()),
            axum::http::HeaderMap::new(),
            AxJson(req),
        )
        .await
        .into_response();

        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "a Hermes turn must not be gated on an NVIDIA key it never uses"
        );
        let body = read_sse(resp).await;
        assert!(body.contains("Hallo aus "), "the Hermes reply must still stream: {body:?}");
    }

    /// A tool Hermes reports as FAILED has to be logged as an error, because
    /// that's the signal the anomaly watchdog counts.
    #[tokio::test]
    async fn a_failed_hermes_tool_call_is_recorded_as_an_error() {
        let sse = concat!(
            "event: tool.failed\ndata: {\"tool_name\":\"web_search\",\"preview\":\"upstream 500\",\"args\":{}}\n\n",
            "event: assistant.completed\ndata: {\"content\":\"Das ging schief.\"}\n\n",
            "event: run.completed\ndata: {\"completed\":true}\n\n",
        );
        let app = Router::new()
            .route(
                "/api/sessions",
                axpost(|| async { (StatusCode::CREATED, AxJson(json!({ "session": { "id": "x" } }))) }),
            )
            .route(
                "/api/sessions/:id/chat/stream",
                axpost(move || async move {
                    axum::response::Response::builder()
                        .status(StatusCode::OK)
                        .header("content-type", "text/event-stream")
                        .body(axum::body::Body::from(sse))
                        .unwrap()
                }),
            )
            .route(
                "/v1/embeddings",
                axpost(|| async { AxJson(json!({ "data": [{ "embedding": vec![0.01f32; 8] }] })) }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let state = test_state(format!("http://{addr}")).await;
        let _ = sqlx::query("INSERT INTO chat_conversations (id, title) VALUES ('conv-h2','T')")
            .execute(&state.db)
            .await;

        let resp = stream_turn(state.clone(), "conv-h2".to_string(), "um-2".to_string(), "hi".to_string()).await;
        let _ = read_sse(resp).await;

        let tool: (String, String) =
            sqlx::query_as("SELECT tool_name, status FROM agent_tool_calls WHERE conversation_id = 'conv-h2'")
                .fetch_one(&state.db)
                .await
                .expect("a failed Hermes tool call must still be logged");
        assert_eq!(tool.0, "web_search");
        assert_eq!(tool.1, "error", "a failed tool must be logged as an error, not silently as ok");
    }

    /// An unreachable Hermes must surface a visible error and close the stream —
    /// never hang the tab, and never persist a turn that silently lost its
    /// memory. Same principle as chat.rs's hanging-candidate regression.
    #[tokio::test]
    async fn an_unreachable_hermes_errors_visibly_instead_of_hanging() {
        // Port 1 on loopback: nothing listens, so the connection is refused fast.
        let state = test_state("http://127.0.0.1:1".to_string()).await;

        let resp = stream_turn(state.clone(), "conv-h3".to_string(), "um-3".to_string(), "hi".to_string()).await;
        let body = read_sse(resp).await;

        assert!(body.contains("event: error"), "must emit a visible error: {body:?}");
        assert!(body.contains("event: done"), "must still close the stream: {body:?}");

        let saved: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_messages WHERE conversation_id = 'conv-h3'")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(saved.0, 0, "a failed Hermes turn must not persist a phantom assistant message");
    }

    /// Hermes closing a turn by echoing the finished answer on the reasoning
    /// channel must not make the tab show that answer twice.
    ///
    /// This is the live-observed shape, not a hypothetical: driving a real
    /// hermes-agent API server with a non-reasoning model ends every turn with a
    /// `_thinking` preview identical to the text it just streamed.
    #[tokio::test]
    async fn an_echoed_answer_on_the_reasoning_channel_is_not_shown_twice() {
        let sse = concat!(
            "event: assistant.delta\ndata: {\"delta\":\"Hallo\"}\n\n",
            "event: tool.progress\ndata: {\"tool_name\":\"_thinking\",\"delta\":\"Hallo\"}\n\n",
            "event: assistant.completed\ndata: {\"content\":\"Hallo\"}\n\n",
            "event: run.completed\ndata: {\"completed\":true}\n\n",
        );
        let body = drive_turn_against(sse, "conv-echo").await;

        assert!(body.contains("Hallo"), "the answer itself must still stream: {body:?}");
        assert!(
            !body.contains("event: reasoning"),
            "an answer echoed back as reasoning must be suppressed, not rendered a second time: {body:?}"
        );
    }

    /// The other direction: a real reasoning trace — which arrives BEFORE the
    /// answer — must still reach the tab. The suppression above must not cost us
    /// genuine reasoning.
    #[tokio::test]
    async fn genuine_reasoning_that_precedes_the_answer_still_reaches_the_tab() {
        let sse = concat!(
            "event: tool.progress\ndata: {\"tool_name\":\"_thinking\",\"delta\":\"Erst überlegen, dann antworten.\"}\n\n",
            "event: assistant.delta\ndata: {\"delta\":\"Die Antwort ist 42.\"}\n\n",
            "event: assistant.completed\ndata: {\"content\":\"Die Antwort ist 42.\"}\n\n",
            "event: run.completed\ndata: {\"completed\":true}\n\n",
        );
        let body = drive_turn_against(sse, "conv-reasoning").await;

        assert!(
            body.contains("event: reasoning") && body.contains("Erst überlegen"),
            "real reasoning must still be forwarded: {body:?}"
        );
    }

    /// A turn that streams NO deltas and only lands its text in
    /// `assistant.completed` must still be shown to the user.
    ///
    /// Hermes can legitimately finish a turn this way — its streaming is
    /// configurable, and this repo's own seed config is free to change. Before
    /// this was handled, such a turn was persisted to `chat_messages` and the tab
    /// rendered an empty bubble: the answer existed and nobody could see it.
    #[tokio::test]
    async fn a_turn_with_no_deltas_still_shows_its_answer_in_the_tab() {
        let sse = concat!(
            "event: assistant.completed\ndata: {\"content\":\"Die ganze Antwort auf einmal.\"}\n\n",
            "event: run.completed\ndata: {\"completed\":true}\n\n",
        );
        let body = drive_turn_against(sse, "conv-nodeltas").await;

        assert!(
            body.contains("Die ganze Antwort auf einmal."),
            "a non-streamed reply must still reach the tab, not just the DB: {body:?}"
        );
    }

    /// The flip side: the normal streamed turn must NOT have its text repeated
    /// by the flush. Pins that the tail logic appends only what's missing.
    #[tokio::test]
    async fn a_normally_streamed_turn_is_not_repeated_by_the_final_flush() {
        let sse = concat!(
            "event: assistant.delta\ndata: {\"delta\":\"Hallo \"}\n\n",
            "event: assistant.delta\ndata: {\"delta\":\"Welt.\"}\n\n",
            "event: assistant.completed\ndata: {\"content\":\"Hallo Welt.\"}\n\n",
            "event: run.completed\ndata: {\"completed\":true}\n\n",
        );
        let body = drive_turn_against(sse, "conv-nodup").await;

        assert_eq!(
            body.matches("Welt.").count(),
            1,
            "the reply must appear exactly once, not be re-sent by the flush: {body:?}"
        );
    }

    /// The engine picker must not offer a Hermes that cannot answer.
    ///
    /// `HERMES_URL` being set only means an operator pointed us somewhere. On a
    /// scaled-to-zero machine that somewhere is still booting for ~20s after a
    /// wake, and it may be crashed or misconfigured. Reporting it as available
    /// would put an engine in the picker that fails the moment it's used.
    #[tokio::test]
    async fn a_configured_but_unreachable_hermes_is_not_offered_as_an_engine() {
        let state = test_state("http://127.0.0.1:1".to_string()).await;
        assert!(enabled(&state), "it IS configured…");
        assert!(!healthy(&state).await, "…but it cannot answer, so it must not be offered");
    }

    /// A turn sent while Hermes is still booting must WAIT for it, not fail.
    ///
    /// This is the cold-start case the bundled deployment creates: the Rust
    /// binary serves in milliseconds, the Python agent behind it does not. The
    /// mock refuses the first two session calls (as a not-yet-listening Hermes
    /// does) and then comes up — the turn must ride that out and still answer.
    #[tokio::test]
    async fn a_turn_sent_while_hermes_is_still_booting_waits_for_it() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let attempts = Arc::new(AtomicUsize::new(0));

        let sessions_attempts = attempts.clone();
        let app = Router::new()
            .route(
                "/api/sessions",
                axpost(move || {
                    let attempts = sessions_attempts.clone();
                    async move {
                        // First two calls: "not up yet."
                        if attempts.fetch_add(1, Ordering::SeqCst) < 2 {
                            return StatusCode::SERVICE_UNAVAILABLE.into_response();
                        }
                        (StatusCode::CREATED, AxJson(json!({ "session": { "id": "x" } }))).into_response()
                    }
                }),
            )
            .route(
                "/api/sessions/:id/chat/stream",
                axpost(|| async {
                    axum::response::Response::builder()
                        .status(StatusCode::OK)
                        .header("content-type", "text/event-stream")
                        .body(axum::body::Body::from(
                            "event: assistant.completed\ndata: {\"content\":\"Endlich wach.\"}\n\nevent: run.completed\ndata: {}\n\n",
                        ))
                        .unwrap()
                }),
            )
            .route(
                "/v1/embeddings",
                axpost(|| async { AxJson(json!({ "data": [{ "embedding": vec![0.01f32; 8] }] })) }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let mut state = test_state(format!("http://{addr}")).await;
        // Long enough to outlast the mock's two "still booting" refusals (the
        // retry sleeps 2s between attempts), far short of the production grace.
        state.hermes_boot_grace = std::time::Duration::from_secs(10);
        let _ = sqlx::query("INSERT INTO chat_conversations (id, title) VALUES ('conv-boot','T')")
            .execute(&state.db)
            .await;

        let resp = stream_turn(state.clone(), "conv-boot".to_string(), "um-b".to_string(), "hi".to_string()).await;
        let bytes = tokio::time::timeout(
            std::time::Duration::from_secs(20),
            axum::body::to_bytes(resp.into_body(), usize::MAX),
        )
        .await
        .expect("must not hang")
        .unwrap();
        let body = String::from_utf8_lossy(&bytes).to_string();

        assert!(
            body.contains("Endlich wach."),
            "a turn sent during boot must wait for Hermes and still answer: {body:?}"
        );
        assert!(
            attempts.load(Ordering::SeqCst) >= 3,
            "the session call must actually have been retried, got {} attempts",
            attempts.load(Ordering::SeqCst)
        );
    }

    /// Spin a one-off mock Hermes that replays `sse`, and run one turn through
    /// it. Shared by the reasoning tests, which care only about what reaches the
    /// tab.
    async fn drive_turn_against(sse: &'static str, conv: &'static str) -> String {
        let app = Router::new()
            .route(
                "/api/sessions",
                axpost(|| async { (StatusCode::CREATED, AxJson(json!({ "session": { "id": "x" } }))) }),
            )
            .route(
                "/api/sessions/:id/chat/stream",
                axpost(move || async move {
                    axum::response::Response::builder()
                        .status(StatusCode::OK)
                        .header("content-type", "text/event-stream")
                        .body(axum::body::Body::from(sse))
                        .unwrap()
                }),
            )
            .route(
                "/v1/embeddings",
                axpost(|| async { AxJson(json!({ "data": [{ "embedding": vec![0.01f32; 8] }] })) }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let state = test_state(format!("http://{addr}")).await;
        let _ = sqlx::query("INSERT INTO chat_conversations (id, title) VALUES (?1,'T')")
            .bind(conv)
            .execute(&state.db)
            .await;

        let resp = stream_turn(state, conv.to_string(), "um-x".to_string(), "hi".to_string()).await;
        read_sse(resp).await
    }

    #[test]
    fn parses_a_hermes_delta_frame() {
        let ev = parse_frame("event: assistant.delta\ndata: {\"delta\":\"Hallo\",\"seq\":1}").unwrap();
        assert_eq!(ev.name, "assistant.delta");
        assert_eq!(ev.data["delta"].as_str(), Some("Hallo"));
    }

    #[test]
    fn parses_a_frame_whose_data_has_no_leading_space() {
        // Hermes writes `data:{...}` in some paths and `data: {...}` in others;
        // both are valid SSE and both have to land.
        let ev = parse_frame("event: run.completed\ndata:{\"completed\":true}").unwrap();
        assert_eq!(ev.name, "run.completed");
        assert_eq!(ev.data["completed"].as_bool(), Some(true));
    }

    #[test]
    fn ignores_a_frame_with_no_data() {
        // Keep-alive comment frames must not be mistaken for events.
        assert!(parse_frame(": keep-alive").is_none());
        assert!(parse_frame("event: ping").is_none());
    }

    #[test]
    fn ignores_a_frame_with_unparsable_data() {
        // A junk frame costs that frame, never the stream.
        assert!(parse_frame("event: assistant.delta\ndata: {not json").is_none());
    }

    #[test]
    fn a_failed_tool_call_is_logged_as_an_error_by_the_shared_status_fn() {
        // The whole point of shaping Hermes's failure into `{"ok":false}` is
        // that `agent::tool_call_status` — which the anomaly watchdog reads —
        // already understands it. Pin that, so a change to either side breaks
        // here rather than silently in the Observatory.
        let failed = json!({ "ok": false, "error": "boom" }).to_string();
        let ok = json!({ "ok": true, "result": "done" }).to_string();
        assert_eq!(agent::tool_call_status(&failed), "error");
        assert_eq!(agent::tool_call_status(&ok), "ok");
    }
}
