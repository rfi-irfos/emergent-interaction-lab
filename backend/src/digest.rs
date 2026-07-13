use crate::{chat, AppState};
use serde::Deserialize;
use serde_json::json;
use sqlx::SqlitePool;
use uuid::Uuid;

/// Proactive Jarvis digest — Laura's own ask, verbatim-translated: "I think
/// it'd also be good if Jarvis could write ME messages. Like, e.g., 'I
/// looked at last week's analyses and this week X Y Z is coming up' — he
/// should interact with me [proactively]."
///
/// **Trigger: lazy/on-demand, not a real scheduler.** There is no cron job,
/// no Fly scheduled machine, no external process hitting an endpoint on a
/// timer — that's real infrastructure this doesn't need yet. Instead,
/// `maybe_spawn_digest` is called from `chat::list_conversations` on every
/// Forschung sidebar load: a single indexed SELECT (`digest_due`) asks "has
/// a digest already happened in the last `DIGEST_WINDOW_DAYS` days?", and if
/// not, generation is kicked off right then, piggybacking on a request that
/// was already happening anyway.
///
/// **Surface: reuses the existing chat infrastructure.** A digest is just
/// another `chat_conversations` row (`kind = 'digest'`, alongside the
/// existing `'chat'`/`'agent'` values — see chat.rs's `init_schema`) holding
/// one `chat_messages` row (`role = 'assistant'`). No new tables, no new
/// endpoints: `chat::list_conversations` merges `kind = 'digest'` into
/// Forschung's `kind = 'chat'` sidebar query, and `chat::get_conversation`
/// already reads any conversation's messages regardless of kind — opening a
/// digest "just works" the same way opening any other conversation does.
///
/// **Content: real data only.** Every number in the digest comes from an
/// aggregate query against tables this platform already owns
/// (emergence_signals, simulation_runs, research_notes), reusing the same
/// query SHAPES `observatory::everything` already established
/// (level_rows/status_rows/category_mix-style grouped counts, windowed via
/// `datetime('now', ?1)`) — see `gather_digest_facts`. What's still
/// pending/active is reported honestly as open, never dressed up as a
/// prediction of what Laura will do next — see `format_facts_for_prompt`'s
/// explicit instruction to the model, and `fallback_digest_text` for the
/// no-LLM-available case.
pub(crate) mod facts;

use facts::DigestFacts;

/// How far back "the last week" looks — the fixed cadence for the digest.
/// Not user-configurable (yet): one honest, fixed window.
pub(crate) const DIGEST_WINDOW_DAYS: i64 = 7;

/// Short addendum after `chat::SYSTEM_PROMPT` — same "append, don't fork the
/// persona" convention `agent::tool_instructions_block` already uses (see
/// its own doc comment in agent.rs): the digest should sound like the same
/// Jarvis Laura talks to every day, not a separate notification-bot voice.
/// Deliberately does NOT append `agent::tool_instructions_block` — a digest
/// is a one-shot monologue with no tool-calling round, so there's nothing
/// for the model to "act on" here, and inviting it to emit a tool-call JSON
/// blob would just risk that JSON landing in the stored prose instead of
/// real tool execution.
const DIGEST_FRAMING: &str = "\n\nDu schreibst hier ausnahmsweise keinen Antwort-Turn in einem laufenden Gespräch, sondern einen kurzen, proaktiven Wochenrückblick, den Laura vorfindet, wenn sie Forschung öffnet — genau das, was sie sich gewünscht hat: dass du dich auch mal von dir aus meldest, statt nur zu antworten, wenn sie fragt. Nutze ausschließlich die unten gelisteten echten Zahlen aus der Datenbank. Erfinde nichts hinzu und mach keine Vorhersage darüber, was Laura diese Woche tun wird — was noch offen oder pending ist, benenn ehrlich als offen/pending, nicht als Prognose. Kein Betreff, keine Grußformel wie in einer E-Mail — einfach der Rückblick selbst, in deiner eigenen Stimme.";

#[derive(Deserialize)]
struct CompletionResp {
    choices: Vec<CompletionChoice>,
}
#[derive(Deserialize)]
struct CompletionChoice {
    message: CompletionMessage,
}
#[derive(Deserialize)]
struct CompletionMessage {
    content: Option<String>,
}

/// A single, non-streaming (`"stream": false`) chat-completions attempt
/// against one candidate model. Deliberately NOT reusing `stream_chat`'s SSE
/// machinery — a background digest has no client waiting on a live stream,
/// so a plain request/response round-trip is simpler and sufficient here.
///
/// Carries the SAME two-layer timeout protection as every other outbound
/// NVIDIA call in this codebase (see `chat::NVIDIA_CONNECT_TIMEOUT` /
/// `chat::NVIDIA_STREAM_STALL_TIMEOUT`'s doc comments for the real
/// 2026-07-10 production outage this guards against — a hung `.await` with
/// no timeout took the whole chat path down): `nvidia_connect_timeout`
/// bounds `.send()` (a candidate that accepts the connection and never
/// answers at all), and `NVIDIA_STREAM_STALL_TIMEOUT` bounds `.json()` (a
/// candidate that answers with headers but then stalls mid-body) — the
/// non-streaming equivalent of the same failure class `stream_chat` guards
/// against one level lower, byte-by-byte, in its SSE loop.
async fn call_nvidia_once(
    state: &AppState,
    model: &str,
    messages: &[serde_json::Value],
) -> Result<String, String> {
    let body = json!({
        "model": model,
        "messages": messages,
        "max_tokens": 800,
        "temperature": 0.6,
        "stream": false,
    });
    let attempt: Result<reqwest::Response, String> = match tokio::time::timeout(
        state.nvidia_connect_timeout,
        state
            .http
            .post(format!("{}/v1/chat/completions", state.nvidia_api_base))
            .bearer_auth(&state.nvidia_api_key)
            .json(&body)
            .send(),
    )
    .await
    {
        Ok(Ok(r)) => Ok(r),
        Ok(Err(e)) => Err(format!("request failed: {e}")),
        Err(_) => Err(format!(
            "timed out after {:?} with no response",
            state.nvidia_connect_timeout
        )),
    };
    let res = attempt?;
    if !res.status().is_success() {
        let status = res.status();
        let body_text = res.text().await.unwrap_or_default();
        return Err(format!("NVIDIA API error {status}: {body_text}"));
    }
    let parsed: CompletionResp =
        match tokio::time::timeout(chat::NVIDIA_STREAM_STALL_TIMEOUT, res.json()).await {
            Ok(Ok(p)) => p,
            Ok(Err(e)) => return Err(format!("response parse failed: {e}")),
            Err(_) => {
                return Err(format!(
                    "response body read stalled for {:?}",
                    chat::NVIDIA_STREAM_STALL_TIMEOUT
                ))
            }
        };
    parsed
        .choices
        .into_iter()
        .next()
        .and_then(|c| c.message.content)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "empty completion".to_string())
}

/// Walks the same fixed model ladder `chat::stream_chat` uses, always
/// starting from the standard default candidate (see
/// `chat::build_model_ladder`'s doc comment).
///
/// Falls back to `facts::fallback_digest_text` (still real numbers, just no
/// model prose) if every candidate fails — matches this codebase's existing
/// graceful-degradation doctrine (e.g. `embed`'s failure just yields an
/// empty retrieval context) rather than blocking the digest entirely or
/// fabricating placeholder text.
async fn generate_prose(state: &AppState, facts: &DigestFacts) -> String {
    let ladder = chat::build_model_ladder(false);
    let messages = vec![
        json!({"role": "system", "content": format!("{}{}", chat::SYSTEM_PROMPT, DIGEST_FRAMING)}),
        json!({"role": "user", "content": facts::format_facts_for_prompt(facts)}),
    ];
    for &idx in &ladder {
        let model = chat::CHAT_MODEL_CANDIDATES[idx];
        match call_nvidia_once(state, model, &messages).await {
            Ok(text) => {
                tracing::info!("digest prose generated by model {model}");
                return text;
            }
            Err(e) => {
                tracing::warn!("digest generation: model {model} failed, trying next candidate: {e}");
            }
        }
    }
    tracing::warn!(
        "digest generation: every model candidate failed — falling back to facts-only text (still real data, no fabrication)"
    );
    facts::fallback_digest_text(facts)
}

/// The full generation flow: gather real facts, turn them into prose (or a
/// plain-facts fallback), and persist as one new `chat_conversations` row
/// (`kind = 'digest'`) with a single `role = 'assistant'` message.
///
/// `pub(crate)` (not private) so tests can call it directly — awaited
/// in-place rather than through `tokio::spawn` — to assert on the exact
/// content deterministically, with no race against a real background task.
/// The production call site (`maybe_spawn_digest` below) is what wraps this
/// in `tokio::spawn` so it never blocks a real request.
pub(crate) async fn generate_digest(state: &AppState) -> String {
    let digest_facts = facts::gather_digest_facts(&state.db).await;
    let prose = generate_prose(state, &digest_facts).await;

    let conv_id = Uuid::new_v4().to_string();
    // Title's date comes from SQLite's own clock (`date('now')`), not a
    // separate Rust-side `chrono::Utc::now()` — avoids any drift between
    // the process clock and the DB clock that every other timestamp in this
    // table (`created_at DEFAULT (datetime('now'))`) already uses.
    let _ = sqlx::query(
        "INSERT INTO chat_conversations (id, title, kind) VALUES (?1, 'Wochenrückblick — ' || date('now'), 'digest')",
    )
    .bind(&conv_id)
    .execute(&state.db)
    .await;

    let msg_id = Uuid::new_v4().to_string();
    let _ = sqlx::query(
        "INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?1, ?2, 'assistant', ?3)",
    )
    .bind(&msg_id)
    .bind(&conv_id)
    .bind(&prose)
    .execute(&state.db)
    .await;

    conv_id
}

/// True exactly when no digest conversation's `created_at` falls within the
/// current `DIGEST_WINDOW_DAYS`-day window — the entire "cron job", reduced
/// to one indexed SELECT run inline on the Forschung sidebar's existing
/// request path. See the module doc comment above for why this replaces a
/// real scheduler instead of just being a stopgap for one.
async fn digest_due(db: &SqlitePool) -> bool {
    let window = format!("-{DIGEST_WINDOW_DAYS} days");
    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM chat_conversations WHERE kind = 'digest' AND created_at > datetime('now', ?1) LIMIT 1",
    )
    .bind(&window)
    .fetch_optional(db)
    .await
    .unwrap_or(None);
    existing.is_none()
}

/// Called from `chat::list_conversations` on every Forschung sidebar load.
/// The fast path (one indexed SELECT, via `digest_due`) always runs inline
/// and resolves near-instantly; if a digest is actually due, the real work —
/// an aggregate-query round-trip plus one NVIDIA call, which can legitimately
/// take several seconds — is handed to `tokio::spawn` and NOT awaited here,
/// so a slow/cold NVIDIA candidate can never turn a routine "load my
/// conversation list" fetch into a stall. Matches this codebase's
/// established "never block the visible response" convention (see chat.rs's
/// emergence-signal/CCET spawns at the end of `stream_chat`, and
/// observatory.rs's `capture_system_snapshot` doc comment) — the digest
/// simply isn't in the list yet on THIS load; it appears on the next one,
/// once the background task finishes.
///
/// Returns the `JoinHandle` so tests can deterministically await completion
/// instead of racing a real background task; the production call site
/// (chat.rs) discards it, exactly like the emergence/CCET spawns do.
pub(crate) async fn maybe_spawn_digest(state: &AppState) -> Option<tokio::task::JoinHandle<()>> {
    // Same "missing secret degrades the feature off, not into a doomed
    // network attempt" convention this codebase already uses for
    // `chat_secret`/`stripe_webhook_secret` (see AppState's own doc
    // comments, and main.rs's startup warnings). Without a real
    // NVIDIA_API_KEY, `stream_chat` itself can't serve real replies either
    // — there's no reason a background digest should still spawn a task
    // whose every ladder candidate is guaranteed to fail. This also keeps
    // every OTHER test in this codebase that builds a bare `test_state()`
    // (empty key, by that convention) and happens to exercise
    // `list_conversations` from spawning an unrelated real-network side
    // effect it never asked for.
    if state.nvidia_api_key.is_empty() {
        return None;
    }
    if !digest_due(&state.db).await {
        return None;
    }
    let state = state.clone();
    Some(tokio::spawn(async move {
        generate_digest(&state).await;
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::post as axpost, Json as AxJson, Router};
    use std::{
        collections::HashMap,
        path::PathBuf,
        sync::{
            atomic::{AtomicU64, AtomicUsize},
            Arc, RwLock,
        },
    };

    /// Same in-memory-sqlite fixture pattern as chat.rs/billing.rs/agent.rs's
    /// own `test_state` helpers — a fresh, schema-initialized DB per test, no
    /// network, no real NVIDIA credentials needed unless a test explicitly
    /// points `nvidia_api_base` at a local mock.
    async fn test_state() -> AppState {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::chat::init_schema(&db).await;
        crate::emergence::init_schema(&db).await;
        crate::simulation::init_schema(&db).await;
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
            nvidia_connect_timeout: std::time::Duration::from_millis(150),
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
            audit_lock: std::sync::Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    /// A minimal `/v1/chat/completions` mock that ECHOES the request's user
    /// message straight back as the completion content — deliberately, so a
    /// test can assert that the exact real-facts text sent to the model
    /// (built from real seeded DB rows, see `seed_facts` below) is what
    /// lands in the stored `chat_messages.content`, proving the round trip
    /// carries real data end to end rather than a canned/placeholder string.
    async fn start_echo_mock_nvidia() -> String {
        let completions = axpost(|AxJson(body): AxJson<serde_json::Value>| async move {
            let user_content = body["messages"]
                .as_array()
                .and_then(|m| m.iter().find(|msg| msg["role"] == "user"))
                .and_then(|msg| msg["content"].as_str())
                .unwrap_or("")
                .to_string();
            AxJson(json!({
                "choices": [{ "message": { "content": format!("ECHO: {user_content}") } }]
            }))
        });
        let app = Router::new().route("/v1/chat/completions", completions);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    /// Seeds real, non-trivial rows across every table the digest reads —
    /// deliberately including at least one row that must NOT count toward
    /// each "still open" total (an already-'complete' run, an 'archived'
    /// note) so the aggregate queries are actually exercised, not just
    /// trivially satisfied by an all-or-nothing dataset.
    async fn seed_facts(state: &AppState) {
        sqlx::query(
            "INSERT INTO emergence_signals (id, pattern, level, status, confidence, evolution, observation, scope) \
             VALUES ('sig-1','p','human','active','medium','stable','o','s')",
        )
        .execute(&state.db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO emergence_signals (id, pattern, level, status, confidence, evolution, observation, scope) \
             VALUES ('sig-2','p','ai','active','medium','stable','o','s')",
        )
        .execute(&state.db)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO simulation_runs (id, hypothesis, status, updated_at) VALUES ('run-done','h','complete', datetime('now'))",
        )
        .execute(&state.db)
        .await
        .unwrap();
        sqlx::query("INSERT INTO simulation_runs (id, hypothesis, status) VALUES ('run-open','h','pending')")
            .execute(&state.db)
            .await
            .unwrap();

        sqlx::query("INSERT INTO research_notes (id, category, title, body, status) VALUES ('note-1','idea','t','b','active')")
            .execute(&state.db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO research_notes (id, category, title, body, status) VALUES ('note-2','idea','t','b','archived')")
            .execute(&state.db)
            .await
            .unwrap();
    }

    // ── gather_digest_facts: real aggregation, not placeholders ──────────

    #[tokio::test]
    async fn gather_digest_facts_reflects_real_seeded_rows() {
        let state = test_state().await;
        seed_facts(&state).await;

        let f = facts::gather_digest_facts(&state.db).await;

        assert_eq!(f.signals_total, 2);
        assert_eq!(f.signals_by_level, vec![("ai".to_string(), 1), ("human".to_string(), 1)]);
        assert_eq!(f.sims_completed, 1, "only the 'complete' run in-window counts");
        assert_eq!(f.sims_pending, 1, "the still-'pending' run counts as open, not completed");
        assert_eq!(f.notes_added, 2, "both notes were created just now, both in-window");
        assert_eq!(f.notes_active, 1, "only the 'active' note counts, not the 'archived' one");
    }

    // ── digest gets generated when none exists in the last 7 days ─────────

    #[tokio::test]
    async fn digest_is_generated_when_none_exists_in_last_7_days() {
        let mock_base = start_echo_mock_nvidia().await;
        let mut state = test_state().await;
        state.nvidia_api_base = mock_base;
        state.nvidia_api_key = "test-key".to_string();
        seed_facts(&state).await;

        let (count_before,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM chat_conversations WHERE kind = 'digest'")
                .fetch_one(&state.db)
                .await
                .unwrap();
        assert_eq!(count_before, 0);

        let handle = maybe_spawn_digest(&state)
            .await
            .expect("no digest exists yet in the window — generation must be spawned");
        handle.await.unwrap();

        let (count_after,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM chat_conversations WHERE kind = 'digest'")
                .fetch_one(&state.db)
                .await
                .unwrap();
        assert_eq!(count_after, 1, "exactly one digest conversation must now exist");

        let (title, content): (String, String) = sqlx::query_as(
            "SELECT c.title, m.content FROM chat_messages m \
             JOIN chat_conversations c ON c.id = m.conversation_id WHERE c.kind = 'digest'",
        )
        .fetch_one(&state.db)
        .await
        .unwrap();
        assert!(title.starts_with("Wochenrückblick"));
        assert!(
            content.starts_with("ECHO: "),
            "digest message must carry the model's real reply round-tripped through the mock, not a placeholder: {content:?}"
        );
        // The mock echoed the exact facts prompt back — proves the numbers
        // that reached the model (and therefore the stored content) are the
        // real seeded ones, not fabricated/canned text.
        assert!(content.contains("Neue Emergenzsignale gesamt: 2"), "{content:?}");
        assert!(content.contains("Abgeschlossene Simulationsläufe in diesem Zeitraum: 1"), "{content:?}");
        assert!(content.contains("Aktuell noch offene (pending) Simulationsläufe insgesamt: 1"), "{content:?}");
        assert!(content.contains("Aktuell aktive Research Notes insgesamt: 1"), "{content:?}");
    }

    // ── no duplicate digest when one already exists within the window ─────

    #[tokio::test]
    async fn no_duplicate_digest_when_one_already_exists_within_window() {
        let mut state = test_state().await;
        // A real (non-empty) key so this genuinely exercises the
        // `digest_due` check below, not the separate missing-key gate in
        // `maybe_spawn_digest` — no mock NVIDIA server is needed since a
        // due digest is never reached in this test.
        state.nvidia_api_key = "test-key".to_string();
        sqlx::query("INSERT INTO chat_conversations (id, title, kind) VALUES ('existing-digest', 'Wochenrückblick — schon da', 'digest')")
            .execute(&state.db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO chat_messages (id, conversation_id, role, content) VALUES ('existing-msg', 'existing-digest', 'assistant', 'echte Zahlen von letzter Woche')")
            .execute(&state.db)
            .await
            .unwrap();

        let handle = maybe_spawn_digest(&state).await;
        assert!(
            handle.is_none(),
            "must not spawn a second digest generation while one already exists within the 7-day window"
        );

        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_conversations WHERE kind = 'digest'")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(count, 1, "must still be exactly the one pre-existing digest conversation");
    }

    #[tokio::test]
    async fn digest_due_again_once_previous_one_is_older_than_the_window() {
        let state = test_state().await;
        sqlx::query(
            "INSERT INTO chat_conversations (id, title, kind, created_at) \
             VALUES ('old-digest', 'Wochenrückblick — alt', 'digest', datetime('now', '-8 days'))",
        )
        .execute(&state.db)
        .await
        .unwrap();

        assert!(
            digest_due(&state.db).await,
            "an 8-day-old digest is outside the 7-day window and must not block a fresh one"
        );
    }

    // ── fallback text (no LLM reachable) is still real, never placeholder ──

    #[tokio::test]
    async fn fallback_digest_text_reflects_real_facts_when_llm_unreachable() {
        let state = test_state().await;
        seed_facts(&state).await;

        let f = facts::gather_digest_facts(&state.db).await;
        let text = facts::fallback_digest_text(&f);

        assert!(text.contains("Neue Emergenzsignale: 2"), "{text:?}");
        assert!(text.contains("Abgeschlossene Simulationsläufe: 1"), "{text:?}");
        assert!(text.contains("Noch offene Simulationsläufe: 1"), "{text:?}");
        assert!(text.contains("Aktuell aktive Research Notes: 1"), "{text:?}");
        assert!(!text.to_lowercase().contains("lorem"));
        assert!(!text.contains("TODO"));
    }

    /// End-to-end proof that the graceful-degradation path (every ladder
    /// candidate failing) still produces a real, non-placeholder digest
    /// instead of leaving the conversation half-created or silently
    /// skipping it — mirrors this codebase's established
    /// hang/failure-tolerance doctrine (see chat.rs's
    /// `all_candidates_hanging_still_yields_a_clean_error_instead_of_silence`)
    /// applied to the digest path instead of the interactive one.
    #[tokio::test]
    async fn generate_digest_falls_back_to_real_facts_text_when_nvidia_unreachable() {
        let mut state = test_state().await;
        // Deliberately NOT overriding nvidia_api_base — it stays pointed at
        // a real host this test never actually reaches on the loopback
        // interface fast enough to matter, combined with a short connect
        // timeout so the whole ladder fails fast instead of the test
        // hanging.
        state.nvidia_api_base = "http://127.0.0.1:1".to_string(); // nothing listens on port 1
        state.nvidia_connect_timeout = std::time::Duration::from_millis(200);
        seed_facts(&state).await;

        let conv_id = generate_digest(&state).await;

        let (content,): (String,) = sqlx::query_as("SELECT content FROM chat_messages WHERE conversation_id = ?1")
            .bind(&conv_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert!(content.contains("Neue Emergenzsignale: 2"), "{content:?}");
        assert!(!content.starts_with("ECHO:"));
    }
}
