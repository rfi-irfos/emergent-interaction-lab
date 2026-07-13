use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{authz::require_admin, observatory::resolve_range, AppState};

/// Denkfragmente ("thinking fragments") — Laura's own ask, verbatim-
/// translated: "I mostly look at my AI interaction meta-retrospectively, but
/// the whole thing through fragment-based thinking — the interaction shows
/// my way of thinking in multiple ways too. That needs to be tracked and
/// visualized with my brain image." First raised 2026-07-08, explicitly
/// parked pending its own design pass — this module + Denkfragmente.tsx are
/// that pass.
///
/// **What this deliberately is NOT**: an anatomical "brain image." There is
/// no image-generation capability anywhere in this stack, and a fake brain
/// graphic faked in SVG/CSS would be exactly the kind of fabrication this
/// project's whole no-fabrication doctrine (see the `.obs-badge-experimental`
/// convention CCET already established, and this module's own disclosure
/// below) exists to rule out. What this IS: a genuine sequence/flow
/// visualization of which of Laura's own IEIA-2025 "8-Layer Model" layers
/// (see the Research page / content.json's own line: "8-Layer Model —
/// separates thinking into eight levels: facts, analysis, patterns,
/// hypotheses, symbols, action, counterarguments, blind spot") each of her
/// own conversation turns draws on — the real functional equivalent of
/// "visualizing how her thinking moves across fragments," without
/// pretending to be an anatomical image it isn't.
///
/// **THIS PROJECT'S OWN operationalization, same disclosure convention as
/// CCET** (see chat.rs's CCET section doc comment for the sibling case):
/// content.json names the eight layers as part of Laura's own framework but
/// gives no per-layer classification criteria — the one-line glosses in
/// `format_classify_prompt` below, and therefore every `thinking_fragments`
/// row this module ever writes, are this project's own reading of what each
/// layer means, not an algorithm from Laura's paper itself. Never presented
/// as a validated cognitive-science instrument — see `DEFINITIONS_NOTE`,
/// echoed in every API response below, and the frontend's own
/// `.obs-badge-experimental` badge.
///
/// **Only classifies Laura's own turns** (`role = 'user'` in chat_messages),
/// never the assistant's replies — matches her own framing above ("the
/// interaction shows MY way of thinking"), not the model's.
///
/// Fires from the exact same trigger point as
/// `emergence::analyze_recent_interactions` / `chat::record_ccet_turn` (see
/// the `tokio::spawn` after the SSE "done" event in `chat::stream_chat`) —
/// an accepted extra-NVIDIA-call-per-turn tradeoff, always a background
/// task, never on the visible reply's critical path.
pub async fn init_schema(db: &SqlitePool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS thinking_fragments (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            layer TEXT NOT NULL CHECK(layer IN ('facts','analysis','patterns','hypotheses','symbols','action','counterarguments','blind_spot')),
            created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create thinking_fragments");
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_tf_conv ON thinking_fragments(conversation_id, created_at)")
        .execute(db)
        .await
        .ok();
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_tf_message ON thinking_fragments(message_id)")
        .execute(db)
        .await
        .ok();
}

/// The closed vocabulary — same 8 keys as content.json's "8-Layer Model"
/// list, snake_cased for a stable API/DB key ("blind spot" -> "blind_spot").
pub(crate) const LAYER_KEYS: &[&str] = &[
    "facts",
    "analysis",
    "patterns",
    "hypotheses",
    "symbols",
    "action",
    "counterarguments",
    "blind_spot",
];

/// Disclosure echoed in every API response below, same convention as
/// `chat::CcetSummary::definitions_note` — so no consumer of this endpoint
/// can present these labels as Laura's paper's own verified classification.
const DEFINITIONS_NOTE: &str = "Die 8 Ebenen (facts, analysis, patterns, hypotheses, symbols, action, counterarguments, blind_spot) sind Lauras eigenes IEIA-2025 \"8-Layer Model\" (siehe Research-Seite). Die Zuordnung eines einzelnen Gesprächsbeitrags zu 1-3 dieser Ebenen ist die eigene Operationalisierung dieses Projekts per LLM-Einschätzung, nicht ein validiertes kognitionswissenschaftliches Instrument.";

const CLASSIFY_SYSTEM_PROMPT: &str = "Du ordnest einen einzelnen Gesprächsbeitrag von Laura einer oder mehreren von acht Denkebenen zu, Teil von Lauras eigenem IEIA-2025-Framework (dem \"8-Layer Model\"). Antworte AUSSCHLIESSLICH mit einem validen JSON-Array aus 1 bis 3 Strings, gewählt aus genau dieser geschlossenen Liste: [\"facts\",\"analysis\",\"patterns\",\"hypotheses\",\"symbols\",\"action\",\"counterarguments\",\"blind_spot\"]. Kein Text davor oder danach, keine Code-Block-Markierung.";

fn format_classify_prompt(user_text: &str) -> String {
    format!(
        "Ordne folgenden Gesprächsbeitrag von Laura den passenden Denkebenen zu (1 bis 3 von 8 — wähle nur, was wirklich zutrifft; erzwinge keine Ebene, die nicht präsent ist, aber wähle auch nicht künstlich nur eine, wenn der Beitrag erkennbar mehrere Ebenen mischt):\n\
- facts: reine Tatsachenaussagen, beobachtete Fakten, Daten\n\
- analysis: Einordnung, Bewertung, Ursache-Wirkung-Überlegungen\n\
- patterns: wiederkehrende Strukturen, Vergleiche, übergreifende Muster\n\
- hypotheses: neue Vermutungen, unbewiesene Annahmen, Denkversuche\n\
- symbols: Bilder, Metaphern, Traumbilder, symbolische Verdichtung\n\
- action: konkrete nächste Schritte, Entscheidungen, Handlungsabsichten\n\
- counterarguments: Einwände, Selbstwiderspruch, alternative Sichtweisen\n\
- blind_spot: explizit benannte eigene blinde Flecken, Unsicherheiten, Wissenslücken\n\n\
Beitrag:\n\"{user_text}\"\n\n\
Antworte NUR mit dem JSON-Array, kein weiterer Text."
    )
}

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

fn extract_json_string_array(text: &str) -> Option<Vec<String>> {
    let trimmed = text.trim();
    if let Ok(v) = serde_json::from_str::<Vec<String>>(trimmed) {
        return Some(v);
    }
    let first = trimmed.find('[')?;
    let last = trimmed.rfind(']')?;
    if last <= first {
        return None;
    }
    serde_json::from_str::<Vec<String>>(&trimmed[first..=last]).ok()
}

/// Validates the model's raw layer strings against the closed `LAYER_KEYS`
/// vocabulary, lowercases/trims, dedupes, and caps at 3 — never trusts the
/// model to have actually respected the prompt's own constraints.
fn sanitize_layers(raw: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for l in raw {
        let l = l.trim().to_lowercase();
        if LAYER_KEYS.contains(&l.as_str()) && !out.contains(&l) {
            out.push(l);
        }
        if out.len() == 3 {
            break;
        }
    }
    out
}

/// One classification attempt against one candidate model — same two-layer
/// timeout protection (`chat::NVIDIA_CONNECT_TIMEOUT` bounding `.send()`,
/// `chat::NVIDIA_STREAM_STALL_TIMEOUT` bounding the body read) as every
/// other outbound NVIDIA call in this codebase; see `digest::call_nvidia_once`'s
/// doc comment for the real 2026-07-10 production outage (a hung `.await`
/// with no timeout took the whole chat path down) this guards against. An
/// `Ok(vec![])` (not an `Err`) means the model answered but nothing in its
/// response survived `sanitize_layers` — a legitimate "could not classify,"
/// not a network/model failure worth retrying the ladder for.
async fn classify_once(state: &AppState, model: &str, messages: &[serde_json::Value]) -> Result<Vec<String>, String> {
    let body = json!({
        "model": model,
        "messages": messages,
        "max_tokens": 120,
        "temperature": 0.2,
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
        Err(_) => Err(format!("timed out after {:?} with no response", state.nvidia_connect_timeout)),
    };
    let res = attempt?;
    if !res.status().is_success() {
        let status = res.status();
        let body_text = res.text().await.unwrap_or_default();
        return Err(format!("NVIDIA API error {status}: {body_text}"));
    }
    let parsed: CompletionResp = match tokio::time::timeout(crate::chat::NVIDIA_STREAM_STALL_TIMEOUT, res.json()).await {
        Ok(Ok(p)) => p,
        Ok(Err(e)) => return Err(format!("response parse failed: {e}")),
        Err(_) => {
            return Err(format!(
                "response body read stalled for {:?}",
                crate::chat::NVIDIA_STREAM_STALL_TIMEOUT
            ))
        }
    };
    let content = parsed.choices.into_iter().next().and_then(|c| c.message.content).unwrap_or_default();
    let raw = extract_json_string_array(&content).unwrap_or_default();
    Ok(sanitize_layers(raw))
}

/// Persists one row per classified layer — the multi-layer-turn contract
/// this whole feature exists for: a turn spanning 3 layers produces 3 rows,
/// not one row with a packed/serialized list.
async fn persist_fragments(db: &SqlitePool, conversation_id: &str, message_id: &str, layers: &[String]) {
    for layer in layers {
        let _ = sqlx::query("INSERT INTO thinking_fragments (id, conversation_id, message_id, layer) VALUES (?1,?2,?3,?4)")
            .bind(Uuid::new_v4().to_string())
            .bind(conversation_id)
            .bind(message_id)
            .bind(layer)
            .execute(db)
            .await;
    }
}

/// Public (crate-visible) entry point — always called from a `tokio::spawn`
/// at the call site (chat.rs's `stream_chat`, right alongside the
/// emergence/CCET spawns), never awaited on the chat response's own path.
/// Walks the same fixed model ladder `digest::generate_prose` does (always
/// starting from the standard default, non-reasoning — see
/// `chat::build_model_ladder`'s doc comment), trying the next candidate only
/// on a genuine request/network/parse failure — an empty-but-successful
/// classification is trusted as-is (see `classify_once`'s doc comment)
/// rather than retried against a different candidate. Writes nothing at all
/// if every candidate fails or the model never returns a valid layer —
/// honest silence, not a fabricated/default row (matches this project's
/// established no-fabrication doctrine — see e.g.
/// `emergence::analyze_recent_interactions`'s own "erfinde nichts"
/// instruction).
pub(crate) async fn classify_turn(state: &AppState, conversation_id: &str, message_id: &str, user_text: &str) {
    if state.nvidia_api_key.is_empty() || user_text.trim().is_empty() {
        return;
    }
    let ladder = crate::chat::build_model_ladder(false);
    let messages = vec![
        json!({ "role": "system", "content": CLASSIFY_SYSTEM_PROMPT }),
        json!({ "role": "user", "content": format_classify_prompt(user_text) }),
    ];
    for &idx in &ladder {
        let model = crate::chat::CHAT_MODEL_CANDIDATES[idx];
        match classify_once(state, model, &messages).await {
            Ok(layers) => {
                if !layers.is_empty() {
                    persist_fragments(&state.db, conversation_id, message_id, &layers).await;
                } else {
                    tracing::info!(
                        "fragment classification for conversation {conversation_id}, message {message_id}: model {model} returned no valid layer — no rows written"
                    );
                }
                return;
            }
            Err(e) => {
                tracing::warn!("fragment classification: model {model} failed, trying next candidate: {e}");
            }
        }
    }
    tracing::warn!(
        "fragment classification: every model candidate failed for conversation {conversation_id}, message {message_id} — no fragments recorded"
    );
}

// ── read API ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct FragmentOut {
    id: String,
    message_id: String,
    layer: String,
    /// Short excerpt of the classified user turn's own text — hover
    /// context for the timeline segment, never the full message (same
    /// truncation idiom as `observatory::excerpt`; a small local copy here
    /// rather than reaching into that module's private helper).
    excerpt: String,
    created_at: String,
    definitions_note: &'static str,
}

fn excerpt(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let truncated: String = trimmed.chars().take(max_chars).collect();
    format!("{}…", truncated.trim_end())
}

#[derive(Deserialize)]
pub struct SequenceQuery {
    conversation_id: Option<String>,
}

/// Per-conversation sequence — the timeline this feature exists for. Flat,
/// oldest-first (real chronological turn order, so the frontend can render
/// it left-to-right as a real timeline without reversing it itself), one row
/// per (turn, layer) pair — a turn spanning 3 layers appears 3 times here,
/// matching the `thinking_fragments` table's own grain exactly. `, tf.rowid
/// ASC` tiebreak: same reasoning as `chat::get_conversation`'s own
/// ordering — `created_at` alone is second-granularity, and every layer of
/// the SAME turn is inserted in the same `persist_fragments` loop, almost
/// always within the very same second.
///
/// `conversation_id` is required — this is a per-conversation view (unlike
/// `distribution` below, a global rollup), so a missing/blank value is a
/// genuine 400, not silently "all conversations."
pub async fn list_sequence(State(state): State<AppState>, headers: HeaderMap, Query(q): Query<SequenceQuery>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(conversation_id) = q.conversation_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) else {
        return (StatusCode::BAD_REQUEST, "conversation_id ist erforderlich.").into_response();
    };

    let rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT tf.id, tf.message_id, tf.layer, cm.content, tf.created_at \
         FROM thinking_fragments tf \
         JOIN chat_messages cm ON cm.id = tf.message_id \
         WHERE tf.conversation_id = ?1 \
         ORDER BY tf.created_at ASC, tf.rowid ASC",
    )
    .bind(conversation_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let out: Vec<FragmentOut> = rows
        .into_iter()
        .map(|(id, message_id, layer, content, created_at)| FragmentOut {
            id,
            message_id,
            layer,
            excerpt: excerpt(&content, 120),
            created_at,
            definitions_note: DEFINITIONS_NOTE,
        })
        .collect();
    Json(out).into_response()
}

#[derive(Serialize)]
struct LayerBucket {
    layer: String,
    count: i64,
}

#[derive(Serialize)]
struct DistributionOut {
    range: String,
    total: i64,
    by_layer: Vec<LayerBucket>,
    definitions_note: &'static str,
}

#[derive(Deserialize)]
pub struct DistributionQuery {
    /// `?range=7d|30d|all` — reuses `observatory::resolve_range` verbatim
    /// (same values, same "30d" default) rather than inventing a second
    /// range convention; the aggregate "which layers dominate across all
    /// her conversations" view (Denkfragmente.tsx's own default) simply
    /// requests `range=all` explicitly instead of this endpoint changing
    /// its own default.
    range: Option<String>,
}

/// Aggregate distribution — layer counts across ALL conversations (a global
/// rollup, not scoped to one conversation), same "one global feed" shape as
/// `emergence::list_signals` / `chat::ccet_summary`.
pub async fn distribution(State(state): State<AppState>, headers: HeaderMap, Query(q): Query<DistributionQuery>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let (range_label, range_days) = resolve_range(q.range.as_deref());
    let window = format!("-{range_days} days");

    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT layer, COUNT(*) FROM thinking_fragments WHERE created_at > datetime('now', ?1) GROUP BY layer ORDER BY COUNT(*) DESC",
    )
    .bind(&window)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let total: i64 = rows.iter().map(|(_, c)| c).sum();
    let by_layer = rows.into_iter().map(|(layer, count)| LayerBucket { layer, count }).collect();

    Json(DistributionOut {
        range: range_label.to_string(),
        total,
        by_layer,
        definitions_note: DEFINITIONS_NOTE,
    })
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::{Query as AxQuery, State as AxState},
        routing::post as axpost,
        Json as AxJson, Router,
    };
    use std::{
        collections::HashMap,
        path::PathBuf,
        sync::{
            atomic::{AtomicU64, AtomicUsize},
            Arc, RwLock,
        },
    };

    /// Same in-memory-sqlite fixture pattern as chat.rs/digest.rs/emergence.rs's
    /// own `test_state` helpers — a fresh, schema-initialized DB per test.
    async fn test_state() -> AppState {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::chat::init_schema(&db).await;
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
            nvidia_api_key: String::new(),
            nvidia_api_base: "https://integrate.api.nvidia.com".to_string(),
            nvidia_connect_timeout: std::time::Duration::from_millis(300),
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

    async fn seed_message(db: &SqlitePool, conv_id: &str, msg_id: &str, content: &str) {
        sqlx::query("INSERT INTO chat_conversations (id) VALUES (?1)")
            .bind(conv_id)
            .execute(db)
            .await
            .ok();
        sqlx::query("INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?1,?2,'user',?3)")
            .bind(msg_id)
            .bind(conv_id)
            .bind(content)
            .execute(db)
            .await
            .unwrap();
    }

    /// Mock `/v1/chat/completions` that always returns a fixed JSON-array
    /// layer response — lets a test control exactly what "the model said"
    /// deterministically instead of depending on real NVIDIA output.
    async fn start_mock_nvidia(layers_json: &'static str) -> String {
        let completions = axpost(move |AxJson(_body): AxJson<serde_json::Value>| async move {
            AxJson(json!({ "choices": [{ "message": { "content": layers_json } }] }))
        });
        let app = Router::new().route("/v1/chat/completions", completions);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    // ── classify_turn: real rows linked to a real message ──────────────

    #[tokio::test]
    async fn classify_turn_writes_real_rows_linked_to_the_real_message() {
        let mock_base = start_mock_nvidia(r#"["facts"]"#).await;
        let mut state = test_state().await;
        state.nvidia_api_base = mock_base;
        state.nvidia_api_key = "test-key".to_string();
        seed_message(&state.db, "conv-1", "msg-1", "Ich habe beobachtet, dass X passiert ist.").await;

        classify_turn(&state, "conv-1", "msg-1", "Ich habe beobachtet, dass X passiert ist.").await;

        let rows: Vec<(String, String, String)> =
            sqlx::query_as("SELECT conversation_id, message_id, layer FROM thinking_fragments")
                .fetch_all(&state.db)
                .await
                .unwrap();
        assert_eq!(rows.len(), 1, "exactly one real row must be written, linked to the real conversation/message");
        assert_eq!(rows[0].0, "conv-1");
        assert_eq!(rows[0].1, "msg-1");
        assert_eq!(rows[0].2, "facts");
    }

    // ── the multi-layer-turn contract: 3 layers -> 3 rows ────────────────

    #[tokio::test]
    async fn multi_layer_turn_produces_multiple_rows() {
        let mock_base = start_mock_nvidia(r#"["facts","analysis","hypotheses"]"#).await;
        let mut state = test_state().await;
        state.nvidia_api_base = mock_base;
        state.nvidia_api_key = "test-key".to_string();
        seed_message(&state.db, "conv-2", "msg-2", "Mehrschichtiger Gedanke.").await;

        classify_turn(&state, "conv-2", "msg-2", "Mehrschichtiger Gedanke.").await;

        let rows: Vec<(String,)> = sqlx::query_as("SELECT layer FROM thinking_fragments WHERE message_id = 'msg-2' ORDER BY layer")
            .fetch_all(&state.db)
            .await
            .unwrap();
        let layers: Vec<String> = rows.into_iter().map(|(l,)| l).collect();
        assert_eq!(
            layers,
            vec!["analysis".to_string(), "facts".to_string(), "hypotheses".to_string()],
            "a turn spanning 3 layers must produce exactly 3 rows, one per layer — never a single packed row"
        );
    }

    #[tokio::test]
    async fn invalid_and_duplicate_layers_are_filtered_and_capped_at_three() {
        let mock_base = start_mock_nvidia(r#"["facts","facts","not-a-real-layer","analysis","patterns","symbols"]"#).await;
        let mut state = test_state().await;
        state.nvidia_api_base = mock_base;
        state.nvidia_api_key = "test-key".to_string();
        seed_message(&state.db, "conv-3", "msg-3", "Text").await;

        classify_turn(&state, "conv-3", "msg-3", "Text").await;

        let rows: Vec<(String,)> = sqlx::query_as("SELECT layer FROM thinking_fragments WHERE message_id = 'msg-3' ORDER BY layer")
            .fetch_all(&state.db)
            .await
            .unwrap();
        let layers: Vec<String> = rows.into_iter().map(|(l,)| l).collect();
        // "not-a-real-layer" is never a valid CHECK'd layer and must be
        // dropped; the duplicate "facts" collapses to one row; the result is
        // capped at 3 distinct layers even though the model listed more.
        assert_eq!(layers, vec!["analysis".to_string(), "facts".to_string(), "patterns".to_string()]);
    }

    #[tokio::test]
    async fn empty_key_or_empty_text_writes_nothing_no_network_call_needed() {
        let state = test_state().await; // empty nvidia_api_key by test_state's own default
        seed_message(&state.db, "conv-4", "msg-4", "Text").await;

        classify_turn(&state, "conv-4", "msg-4", "Text").await;

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM thinking_fragments").fetch_one(&state.db).await.unwrap();
        assert_eq!(count.0, 0);
    }

    /// Graceful degradation, same doctrine as digest.rs's own
    /// `generate_digest_falls_back_to_real_facts_text_when_nvidia_unreachable`:
    /// every ladder candidate failing must leave zero rows, never a
    /// fabricated/default layer.
    #[tokio::test]
    async fn every_candidate_failing_writes_nothing_honest_not_fabricated() {
        let mut state = test_state().await;
        state.nvidia_api_key = "test-key".to_string();
        state.nvidia_api_base = "http://127.0.0.1:1".to_string(); // nothing listens on port 1
        state.nvidia_connect_timeout = std::time::Duration::from_millis(200);
        seed_message(&state.db, "conv-5", "msg-5", "Text").await;

        classify_turn(&state, "conv-5", "msg-5", "Text").await;

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM thinking_fragments").fetch_one(&state.db).await.unwrap();
        assert_eq!(count.0, 0);
    }

    // ── list_sequence: real per-conversation endpoint behavior ─────────

    fn empty_seq_query() -> SequenceQuery {
        SequenceQuery { conversation_id: None }
    }

    #[tokio::test]
    async fn sequence_requires_conversation_id() {
        let state = test_state().await;
        let res = list_sequence(AxState(state), HeaderMap::new(), AxQuery(empty_seq_query())).await.into_response();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn sequence_requires_admin_auth() {
        let mut state = test_state().await;
        state.chat_secret = "shh".to_string();
        let res = list_sequence(
            AxState(state),
            HeaderMap::new(),
            AxQuery(SequenceQuery { conversation_id: Some("conv-1".to_string()) }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn sequence_returns_fragments_in_turn_order_with_excerpt() {
        let state = test_state().await;
        seed_message(
            &state.db,
            "conv-6",
            "msg-a",
            "Erster Gedanke, absichtlich ziemlich lang formuliert, damit die Kürzung auf 120 Zeichen im Test auch wirklich etwas zu tun bekommt und über die Grenze hinausgeht.",
        )
        .await;
        seed_message(&state.db, "conv-6", "msg-b", "Zweiter Gedanke").await;
        persist_fragments(&state.db, "conv-6", "msg-a", &["facts".to_string(), "analysis".to_string()]).await;
        persist_fragments(&state.db, "conv-6", "msg-b", &["symbols".to_string()]).await;

        let res = list_sequence(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(SequenceQuery { conversation_id: Some("conv-6".to_string()) }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body.len(), 3, "one row per (turn, layer) pair — msg-a has 2 layers, msg-b has 1");
        assert_eq!(body[0]["message_id"], "msg-a");
        assert_eq!(body[1]["message_id"], "msg-a");
        assert_eq!(body[2]["message_id"], "msg-b", "turn order must be preserved — msg-a's turn came first");
        assert!(
            body[0]["excerpt"].as_str().unwrap().ends_with('…'),
            "a >120-char message must be truncated with an ellipsis, not returned in full"
        );
    }

    #[tokio::test]
    async fn sequence_for_a_conversation_with_no_fragments_is_an_honest_empty_array() {
        let state = test_state().await;
        seed_message(&state.db, "conv-old", "msg-old", "Ein Gespräch von vor diesem Feature.").await;
        // Deliberately never calling persist_fragments — this conversation
        // predates the feature, exactly the "older conversations simply
        // have no fragment history" case.

        let res = list_sequence(
            AxState(state),
            HeaderMap::new(),
            AxQuery(SequenceQuery { conversation_id: Some("conv-old".to_string()) }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        assert!(body.is_empty(), "no backfilled/fabricated rows for a conversation that predates this feature");
    }

    // ── distribution: aggregate correctness against seeded data ─────────

    #[tokio::test]
    async fn distribution_aggregates_correctly_across_conversations() {
        let state = test_state().await;
        seed_message(&state.db, "conv-7", "msg-x", "a").await;
        seed_message(&state.db, "conv-8", "msg-y", "b").await;
        persist_fragments(&state.db, "conv-7", "msg-x", &["facts".to_string(), "analysis".to_string()]).await;
        persist_fragments(&state.db, "conv-8", "msg-y", &["facts".to_string()]).await;

        let res = distribution(AxState(state.clone()), HeaderMap::new(), AxQuery(DistributionQuery { range: Some("all".to_string()) }))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["total"], 3, "3 fragment rows were seeded across 2 conversations");
        let by_layer = body["by_layer"].as_array().unwrap();
        let facts = by_layer.iter().find(|b| b["layer"] == "facts").expect("facts bucket must exist");
        assert_eq!(facts["count"], 2, "facts appears once in conv-7 and once in conv-8 — must aggregate ACROSS conversations");
        let analysis = by_layer.iter().find(|b| b["layer"] == "analysis").expect("analysis bucket must exist");
        assert_eq!(analysis["count"], 1);
    }

    #[tokio::test]
    async fn distribution_range_filter_excludes_older_rows() {
        let state = test_state().await;
        seed_message(&state.db, "conv-9", "msg-new", "neu").await;
        seed_message(&state.db, "conv-9", "msg-old", "alt").await;
        persist_fragments(&state.db, "conv-9", "msg-new", &["facts".to_string()]).await;
        persist_fragments(&state.db, "conv-9", "msg-old", &["symbols".to_string()]).await;
        sqlx::query("UPDATE thinking_fragments SET created_at = datetime('now', '-40 days') WHERE message_id = 'msg-old'")
            .execute(&state.db)
            .await
            .unwrap();

        let res = distribution(AxState(state.clone()), HeaderMap::new(), AxQuery(DistributionQuery { range: Some("30d".to_string()) }))
            .await
            .into_response();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["total"], 1, "the 40-day-old symbols row must not count under range=30d");
        let by_layer = body["by_layer"].as_array().unwrap();
        assert!(by_layer.iter().all(|b| b["layer"] != "symbols"), "symbols must be excluded entirely, not just undercounted");
    }

    #[tokio::test]
    async fn distribution_requires_admin_auth() {
        let mut state = test_state().await;
        state.chat_secret = "shh".to_string();
        let res = distribution(AxState(state), HeaderMap::new(), AxQuery(DistributionQuery { range: None })).await.into_response();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    // ── sanitize_layers: pure-function unit coverage ─────────────────────

    #[test]
    fn sanitize_layers_rejects_unknown_strings_entirely() {
        let out = sanitize_layers(vec!["facts".to_string(), "made_up".to_string()]);
        assert_eq!(out, vec!["facts".to_string()]);
    }

    #[test]
    fn sanitize_layers_is_case_and_whitespace_tolerant() {
        let out = sanitize_layers(vec![" Facts ".to_string(), "BLIND_SPOT".to_string()]);
        assert_eq!(out, vec!["facts".to_string(), "blind_spot".to_string()]);
    }
}
