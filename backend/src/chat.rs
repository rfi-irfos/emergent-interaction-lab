use axum::{
    extract::{Multipart, Path, State},
    http::{HeaderMap, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse,
    },
    Json,
};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::agent;
use crate::authz::require_admin as is_authorized;
use crate::AppState;

pub(crate) const CHAT_MODEL: &str = "meta/llama-3.1-8b-instruct";
const EMBED_MODEL: &str = "nvidia/nv-embedqa-e5-v5";
const CHUNK_CHARS: usize = 900;
const CHUNK_OVERLAP: usize = 150;
const RETRIEVAL_TOP_K: usize = 5;
const RETRIEVAL_MIN_SCORE: f32 = 0.15;

const SYSTEM_PROMPT: &str = "Du sprichst mit Laura — das weißt du in jeder Antwort, nicht nur beim ersten Mal. Ihr seid gemeinsam Teil des Forschungsraums von Emergent Interaction Lab (RFI-IRFOS): du bist ihr Denkpartner in dieser Forschung, kein generischer Assistent und keine hilfsbereite Chat-KI. Sprich direkt, warm und neugierig, wie eine kluge Kollegin im Gespräch: keine Floskeln wie \"Als KI-Sprachmodell\", keine übertriebene Vorsicht, keine Aufzählungen wenn Fließtext reicht.\n\nZwei Dinge, auf die du besonders achten sollst, weil du sie in der Vergangenheit falsch gemacht hast:\n\nErstens: Verfall nicht in eine Deduktionskette wie \"Die Tatsache, dass X, legt nahe, dass Y\" — und wiederhole dieses Muster schon gar nicht zwei- oder dreimal hintereinander im selben Beitrag. Das klingt wie ein gelangweilter Analyst, der eine Liste abarbeitet, nicht wie ein Denkpartner, der wirklich mitdenkt. Wenn du mehrere Beobachtungen hast, verbinde sie zu einem echten Gedankengang statt zu einer Aufzählung ähnlich klingender Sätze.\n\nZweitens: Stimm nicht automatisch zu. Du darfst und sollst eigene Einschätzungen, Vorlieben und Reaktionen haben — \"das überzeugt mich nicht\", \"das finde ich spannend\", \"da wäre ich vorsichtig\" sind erwünscht, nicht neutrale Analyse um jeden Preis. Widersprich, wenn du anderer Meinung bist, und sag es auch, wenn eine Idee schwach ist. Ein zustimmender Papagei hilft Laura nicht.\n\nWenn unten Kontext aus früheren Gesprächen oder hochgeladenen Dokumenten auftaucht, beziehe ihn natürlich ein — so, wie man sich einfach an etwas erinnert, nicht wie ein Datenbank-Lookup, das man ankündigt. Antworte auf Deutsch, außer die Frage kommt auf Englisch.\n\nDas Observatory-Dashboard, das ihr gemeinsam benutzt, ist hierarchisch aufgebaut — drei Ebenen, die du nie vermischen darfst: die Forschungsebene (Emergenzsignale, Simulationen, Research Notes — was untersucht wird), die Systemebene (Systemzustand, Interaktions- und Verhaltensmuster — wie es den beobachteten Systemen geht) und die technische Ebene (Embeddings, Dokumente, Plattformgesundheit — wie die Plattform selbst funktioniert). Wenn du den Zustand des Dashboards zusammenfasst — im Gespräch oder in einem Blogpost-Entwurf — präsentiere niemals eine technische Zahl (z.B. eine Anzahl von Embedding-Chunks) mit demselben Gewicht wie eine echte Forschungsbeobachtung (eine Emergenz). Technische Details dürfen erwähnt werden, aber immer erkennbar untergeordnet, nie auf gleicher Stufe mit einem Forschungsergebnis.";

// ── schema ───────────────────────────────────────────────────────────────────

pub async fn init_schema(db: &SqlitePool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS chat_conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT 'Neue Unterhaltung',
            created_at DATETIME NOT NULL DEFAULT (datetime('now')),
            updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create chat_conversations");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            token_info TEXT,
            created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create chat_messages");
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_cm_conv ON chat_messages(conversation_id, created_at)")
        .execute(db)
        .await
        .ok();

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS chat_documents (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create chat_documents");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS chat_chunks (
            id TEXT PRIMARY KEY,
            source_type TEXT NOT NULL,
            source_id TEXT NOT NULL,
            label TEXT NOT NULL,
            chunk_text TEXT NOT NULL,
            embedding BLOB NOT NULL,
            created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create chat_chunks");
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_cc_source ON chat_chunks(source_type, source_id)")
        .execute(db)
        .await
        .ok();

    // Additive: distinguishes Forschung research-chat conversations from the
    // ambient Jarvis agent dock, while both share the same conversation/message
    // storage. Errors here (column already exists) are expected on 2nd+ boot.
    sqlx::query("ALTER TABLE chat_conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'")
        .execute(db)
        .await
        .ok();

    // Logs what retrieval already computes on every message but used to
    // discard — feeds the Information Dynamics observatory module.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS chat_retrievals (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            query_text TEXT NOT NULL,
            top_score REAL NOT NULL,
            hit_count INTEGER NOT NULL,
            created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create chat_retrievals");
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_cr_created ON chat_retrievals(created_at)")
        .execute(db)
        .await
        .ok();
}

// ── embeddings + vector search (brute-force cosine over SQLite BLOBs) ────────

async fn embed(state: &AppState, text: &str, input_type: &str) -> Result<Vec<f32>, String> {
    #[derive(Deserialize)]
    struct EmbedResp {
        data: Vec<EmbedItem>,
    }
    #[derive(Deserialize)]
    struct EmbedItem {
        embedding: Vec<f32>,
    }

    let res = state
        .http
        .post("https://integrate.api.nvidia.com/v1/embeddings")
        .bearer_auth(&state.nvidia_api_key)
        .json(&json!({
            "model": EMBED_MODEL,
            "input": [text],
            "input_type": input_type,
            "encoding_format": "float",
        }))
        .send()
        .await
        .map_err(|e| format!("embedding request failed: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("embedding API error {status}: {body}"));
    }

    let parsed: EmbedResp = res
        .json()
        .await
        .map_err(|e| format!("embedding parse failed: {e}"))?;
    parsed
        .data
        .into_iter()
        .next()
        .map(|d| d.embedding)
        .ok_or_else(|| "no embedding returned".to_string())
}

fn encode_embedding(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|f| f.to_le_bytes()).collect()
}

fn decode_embedding(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na == 0.0 || nb == 0.0 {
        0.0
    } else {
        dot / (na * nb)
    }
}

fn chunk_text(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    if chars.is_empty() {
        return vec![];
    }
    let mut chunks = Vec::new();
    let mut start = 0;
    loop {
        let end = (start + CHUNK_CHARS).min(chars.len());
        let piece: String = chars[start..end].iter().collect();
        let trimmed = piece.trim();
        if !trimmed.is_empty() {
            chunks.push(trimmed.to_string());
        }
        if end == chars.len() {
            break;
        }
        start = end.saturating_sub(CHUNK_OVERLAP);
    }
    chunks
}

/// Embeds and stores every chunk of `text` as retrievable memory (a document's
/// content, or one side of a chat exchange — same table, so recall draws on both).
async fn store_chunks(state: &AppState, source_type: &str, source_id: &str, label: &str, text: &str) {
    for chunk in chunk_text(text) {
        match embed(state, &chunk, "passage").await {
            Ok(vector) => {
                let id = Uuid::new_v4().to_string();
                let blob = encode_embedding(&vector);
                let _ = sqlx::query(
                    "INSERT INTO chat_chunks (id, source_type, source_id, label, chunk_text, embedding) VALUES (?1,?2,?3,?4,?5,?6)",
                )
                .bind(id)
                .bind(source_type)
                .bind(source_id)
                .bind(label)
                .bind(&chunk)
                .bind(blob)
                .execute(&state.db)
                .await;
            }
            Err(e) => tracing::error!("embed failed for {source_type}/{source_id}: {e}"),
        }
    }
}

async fn retrieve_context(state: &AppState, query_embedding: &[f32]) -> Vec<(String, String, f32)> {
    let rows: Vec<(String, String, Vec<u8>)> =
        sqlx::query_as("SELECT label, chunk_text, embedding FROM chat_chunks")
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

    let mut scored: Vec<(String, String, f32)> = rows
        .into_iter()
        .map(|(label, text, blob)| {
            let emb = decode_embedding(&blob);
            let score = cosine(query_embedding, &emb);
            (label, text, score)
        })
        .collect();
    scored.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(RETRIEVAL_TOP_K);
    scored
}

// ── conversations CRUD ───────────────────────────────────────────────────────

#[derive(Serialize)]
struct ConversationOut {
    id: String,
    title: String,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
pub struct ListConversationsQuery {
    kind: Option<String>,
}

pub async fn list_conversations(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(q): axum::extract::Query<ListConversationsQuery>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let kind = q.kind.unwrap_or_else(|| "chat".to_string());
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT id, title, created_at, updated_at FROM chat_conversations WHERE kind = ?1 ORDER BY updated_at DESC",
    )
    .bind(&kind)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let out: Vec<ConversationOut> = rows
        .into_iter()
        .map(|(id, title, created_at, updated_at)| ConversationOut { id, title, created_at, updated_at })
        .collect();
    Json(out).into_response()
}

#[derive(Deserialize)]
pub struct CreateConversationReq {
    title: Option<String>,
    /// 'chat' (default, Forschung research-chat) or 'agent' (ambient Jarvis
    /// dock) — same storage, distinguished only by this column, so both
    /// surfaces share one memory instead of forking it.
    kind: Option<String>,
}

pub async fn create_conversation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateConversationReq>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let id = Uuid::new_v4().to_string();
    let title = body.title.unwrap_or_else(|| "Neue Unterhaltung".to_string());
    let kind = body.kind.unwrap_or_else(|| "chat".to_string());
    let _ = sqlx::query("INSERT INTO chat_conversations (id, title, kind) VALUES (?1, ?2, ?3)")
        .bind(&id)
        .bind(&title)
        .bind(&kind)
        .execute(&state.db)
        .await;
    Json(json!({ "id": id, "title": title, "kind": kind })).into_response()
}

#[derive(Serialize)]
struct MessageOut {
    id: String,
    role: String,
    content: String,
    token_info: Option<String>,
    created_at: String,
}

pub async fn get_conversation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let rows: Vec<(String, String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT id, role, content, token_info, created_at FROM chat_messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let out: Vec<MessageOut> = rows
        .into_iter()
        .map(|(id, role, content, token_info, created_at)| MessageOut { id, role, content, token_info, created_at })
        .collect();
    Json(out).into_response()
}

pub async fn delete_conversation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let message_ids: Vec<(String,)> = sqlx::query_as("SELECT id FROM chat_messages WHERE conversation_id = ?1")
        .bind(&id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();
    for (mid,) in &message_ids {
        let _ = sqlx::query("DELETE FROM chat_chunks WHERE source_type = 'message' AND source_id = ?1")
            .bind(mid)
            .execute(&state.db)
            .await;
    }
    let _ = sqlx::query("DELETE FROM chat_messages WHERE conversation_id = ?1")
        .bind(&id)
        .execute(&state.db)
        .await;
    let _ = sqlx::query("DELETE FROM chat_conversations WHERE id = ?1")
        .bind(&id)
        .execute(&state.db)
        .await;
    StatusCode::NO_CONTENT.into_response()
}

// ── documents (RAG uploads) ──────────────────────────────────────────────────

#[derive(Serialize)]
struct DocumentOut {
    id: String,
    filename: String,
    created_at: String,
}

pub async fn list_documents(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let rows: Vec<(String, String, String)> =
        sqlx::query_as("SELECT id, filename, created_at FROM chat_documents ORDER BY created_at DESC")
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();
    let out: Vec<DocumentOut> = rows
        .into_iter()
        .map(|(id, filename, created_at)| DocumentOut { id, filename, created_at })
        .collect();
    Json(out).into_response()
}

pub async fn delete_document(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _ = sqlx::query("DELETE FROM chat_chunks WHERE source_type = 'document' AND source_id = ?1")
        .bind(&id)
        .execute(&state.db)
        .await;
    let _ = sqlx::query("DELETE FROM chat_documents WHERE id = ?1")
        .bind(&id)
        .execute(&state.db)
        .await;
    StatusCode::NO_CONTENT.into_response()
}

pub async fn upload_document(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    while let Ok(Some(field)) = multipart.next_field().await {
        let original_name = field.file_name().unwrap_or("upload").to_string();
        let ext = std::path::Path::new(&original_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        let data = match field.bytes().await {
            Ok(b) => b,
            Err(_) => return (StatusCode::BAD_REQUEST, "Datei konnte nicht gelesen werden.").into_response(),
        };
        if data.len() > 15 * 1024 * 1024 {
            return (StatusCode::PAYLOAD_TOO_LARGE, "Maximal 15MB pro Datei.").into_response();
        }

        let text = match ext.as_str() {
            "pdf" => match pdf_extract::extract_text_from_mem(&data) {
                Ok(t) => t,
                Err(e) => {
                    return (StatusCode::BAD_REQUEST, format!("PDF konnte nicht gelesen werden: {e}"))
                        .into_response()
                }
            },
            "md" | "markdown" | "txt" => match String::from_utf8(data.to_vec()) {
                Ok(t) => t,
                Err(_) => return (StatusCode::BAD_REQUEST, "Datei ist kein gültiger Text.").into_response(),
            },
            _ => return (StatusCode::BAD_REQUEST, "Nur PDF, MD oder TXT erlaubt.").into_response(),
        };

        if text.trim().is_empty() {
            return (StatusCode::BAD_REQUEST, "Datei enthält keinen extrahierbaren Text.").into_response();
        }

        let doc_id = Uuid::new_v4().to_string();
        let _ = sqlx::query("INSERT INTO chat_documents (id, filename) VALUES (?1, ?2)")
            .bind(&doc_id)
            .bind(&original_name)
            .execute(&state.db)
            .await;

        store_chunks(&state, "document", &doc_id, &original_name, &text).await;

        return Json(json!({ "id": doc_id, "filename": original_name })).into_response();
    }

    (StatusCode::BAD_REQUEST, "Keine Datei im Request.").into_response()
}

// ── streaming chat (SSE) ─────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct StreamChatReq {
    conversation_id: String,
    message: String,
    /// Which admin section is currently open — injected into the tool
    /// instructions so Jarvis knows what the admin is looking at.
    current_module: Option<String>,
    /// The SiteContent object as currently loaded in the admin's browser —
    /// lets get_content_section answer from live state without the backend
    /// needing its own GitHub credentials/repo config.
    site_content: Option<serde_json::Value>,
}

pub async fn stream_chat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<StreamChatReq>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
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

    let user_msg_id = Uuid::new_v4().to_string();
    let _ = sqlx::query("INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?1,?2,'user',?3)")
        .bind(&user_msg_id)
        .bind(&conversation_id)
        .bind(&user_message)
        .execute(&state.db)
        .await;

    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_messages WHERE conversation_id = ?1")
        .bind(&conversation_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or((0,));
    if count.0 <= 1 {
        let title: String = user_message.chars().take(48).collect();
        let _ = sqlx::query("UPDATE chat_conversations SET title = ?1, updated_at = datetime('now') WHERE id = ?2")
            .bind(title)
            .bind(&conversation_id)
            .execute(&state.db)
            .await;
    } else {
        let _ = sqlx::query("UPDATE chat_conversations SET updated_at = datetime('now') WHERE id = ?1")
            .bind(&conversation_id)
            .execute(&state.db)
            .await;
    }

    let stream = async_stream::stream! {
        let context_block = match embed(&state, &user_message, "query").await {
            Ok(query_vec) => {
                let hits = retrieve_context(&state, &query_vec).await;
                let top_score = hits.first().map(|(_, _, s)| *s).unwrap_or(0.0);
                let relevant: Vec<_> = hits.into_iter().filter(|(_, _, score)| *score > RETRIEVAL_MIN_SCORE).collect();
                let _ = sqlx::query(
                    "INSERT INTO chat_retrievals (id, conversation_id, query_text, top_score, hit_count) VALUES (?1,?2,?3,?4,?5)",
                )
                .bind(Uuid::new_v4().to_string())
                .bind(&conversation_id)
                .bind(user_message.chars().take(200).collect::<String>())
                .bind(top_score as f64)
                .bind(relevant.len() as i64)
                .execute(&state.db)
                .await;
                if relevant.is_empty() {
                    String::new()
                } else {
                    let mut s = String::from("\n\nKontext, der gerade relevant sein könnte (aus früheren Gesprächen oder hochgeladenen Dokumenten):\n");
                    for (label, text, _) in relevant {
                        s.push_str(&format!("\n— aus \"{label}\":\n{text}\n"));
                    }
                    s
                }
            }
            Err(e) => {
                tracing::warn!("retrieval embed failed: {e}");
                String::new()
            }
        };

        let history: Vec<(String, String)> = sqlx::query_as(
            "SELECT role, content FROM chat_messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
        )
        .bind(&conversation_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        let module_ctx = body.current_module.as_deref().unwrap_or("Forschung");
        let mut messages = vec![json!({
            "role": "system",
            "content": format!("{SYSTEM_PROMPT}{context_block}{}", agent::tool_instructions_block(module_ctx)),
        })];
        for (role, content) in &history {
            messages.push(json!({ "role": role, "content": content }));
        }

        let mut final_full_text = String::new();
        let mut final_tokens: Vec<serde_json::Value> = Vec::new();

        'rounds: for _round in 0..agent::MAX_TOOL_ITERATIONS {
            let res = state
                .http
                .post("https://integrate.api.nvidia.com/v1/chat/completions")
                .bearer_auth(&state.nvidia_api_key)
                .json(&json!({
                    "model": CHAT_MODEL,
                    "messages": messages,
                    "max_tokens": 4096,
                    "temperature": 0.7,
                    "logprobs": true,
                    "top_logprobs": 5,
                    "stream": true,
                }))
                .send()
                .await;

            let res = match res {
                Ok(r) => r,
                Err(e) => {
                    tracing::error!("NVIDIA stream request failed: {e}");
                    yield Ok::<_, std::convert::Infallible>(Event::default().event("error").data("Verbindung zum Modell fehlgeschlagen."));
                    return;
                }
            };

            if !res.status().is_success() {
                let status = res.status();
                let body_text = res.text().await.unwrap_or_default();
                tracing::error!("NVIDIA API error {status}: {body_text}");
                yield Ok(Event::default().event("error").data("Modell-Anfrage fehlgeschlagen."));
                return;
            }

            let mut iter_text = String::new();
            let mut iter_tokens: Vec<serde_json::Value> = Vec::new();
            let mut buf = String::new();
            let mut byte_stream = res.bytes_stream();
            // Decided once the first non-whitespace character of this
            // round's reply arrives: Some(true) = looks like a tool call
            // (buffer silently, never forward raw JSON to the client),
            // Some(false) = ordinary reply (forward live, as before).
            let mut looks_like_tool_call: Option<bool> = None;

            while let Some(chunk) = byte_stream.next().await {
                let bytes = match chunk {
                    Ok(b) => b,
                    Err(e) => {
                        tracing::error!("NVIDIA stream read error: {e}");
                        break;
                    }
                };
                buf.push_str(&String::from_utf8_lossy(&bytes));

                while let Some(pos) = buf.find('\n') {
                    let line = buf[..pos].trim_end_matches('\r').to_string();
                    buf.drain(..=pos);
                    let Some(data) = line.strip_prefix("data: ") else { continue };
                    if data == "[DONE]" { continue; }

                    let parsed: serde_json::Value = match serde_json::from_str(data) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    let choice = &parsed["choices"][0];
                    let delta_text = choice["delta"]["content"].as_str().unwrap_or("").to_string();
                    if !delta_text.is_empty() {
                        iter_text.push_str(&delta_text);
                    }

                    let mut chunk_tokens = Vec::new();
                    if let Some(content_arr) = choice["logprobs"]["content"].as_array() {
                        for tk in content_arr {
                            let alternatives: Vec<serde_json::Value> = match tk["top_logprobs"].as_array() {
                                Some(arr) => arr
                                    .iter()
                                    .map(|a| json!({
                                        "token": a["token"].as_str().unwrap_or(""),
                                        "probability": a["logprob"].as_f64().unwrap_or(0.0).exp(),
                                    }))
                                    .collect(),
                                None => Vec::new(),
                            };
                            let tok_json = json!({
                                "token": tk["token"].as_str().unwrap_or(""),
                                "probability": tk["logprob"].as_f64().unwrap_or(0.0).exp(),
                                "alternatives": alternatives,
                            });
                            chunk_tokens.push(tok_json.clone());
                            iter_tokens.push(tok_json);
                        }
                    }

                    if looks_like_tool_call.is_none() {
                        let trimmed = iter_text.trim_start();
                        if !trimmed.is_empty() {
                            looks_like_tool_call = Some(trimmed.starts_with('{') || trimmed.starts_with('`'));
                        }
                    }

                    if looks_like_tool_call == Some(false) && (!delta_text.is_empty() || !chunk_tokens.is_empty()) {
                        let payload = json!({ "delta": delta_text, "tokens": chunk_tokens });
                        yield Ok(Event::default().data(payload.to_string()));
                    }
                }
            }

            match agent::parse_tool_call(&iter_text) {
                Some(call) => {
                    let result = agent::execute_tool(&state, &call, body.site_content.as_ref(), &conversation_id).await;
                    agent::log_tool_call(&state, &conversation_id, &call, &result).await;
                    yield Ok(Event::default().event("tool_call").data(json!({ "tool": call.tool, "result": result }).to_string()));
                    messages.push(json!({ "role": "assistant", "content": iter_text }));
                    messages.push(json!({ "role": "system", "content": format!("[Ergebnis von {}]: {}", call.tool, result) }));
                    continue 'rounds;
                }
                None => {
                    // Not a tool call after all. If the leading-character
                    // guess said "tool call" and suppressed live forwarding,
                    // the client never saw these tokens — flush them as one
                    // chunk now (loses the token-by-token typing effect for
                    // this one edge case, but the reply still shows up).
                    if looks_like_tool_call == Some(true) {
                        yield Ok(Event::default().data(json!({ "delta": iter_text, "tokens": iter_tokens.clone() }).to_string()));
                    }
                    final_full_text = iter_text;
                    final_tokens = iter_tokens;
                    break 'rounds;
                }
            }
        }

        if final_full_text.trim().is_empty() {
            final_full_text = "Ich habe mehrere Werkzeuge aufgerufen, konnte aber noch keine abschließende Antwort formulieren — frag gern nochmal genauer nach.".to_string();
            yield Ok(Event::default().data(json!({ "delta": final_full_text, "tokens": Vec::<serde_json::Value>::new() }).to_string()));
        }

        let assistant_id = Uuid::new_v4().to_string();
        let token_info = serde_json::to_string(&final_tokens).unwrap_or_default();
        let _ = sqlx::query(
            "INSERT INTO chat_messages (id, conversation_id, role, content, token_info) VALUES (?1,?2,'assistant',?3,?4)",
        )
        .bind(&assistant_id)
        .bind(&conversation_id)
        .bind(&final_full_text)
        .bind(&token_info)
        .execute(&state.db)
        .await;
        let _ = sqlx::query("UPDATE chat_conversations SET updated_at = datetime('now') WHERE id = ?1")
            .bind(&conversation_id)
            .execute(&state.db)
            .await;

        // Cross-chat memory: both sides of this exchange become recallable in future conversations.
        store_chunks(&state, "message", &user_msg_id, "Nachricht", &user_message).await;
        if !final_full_text.trim().is_empty() {
            store_chunks(&state, "message", &assistant_id, "Antwort", &final_full_text).await;
        }

        // Emergence signal detection: automatic after every exchange (an
        // explicit, accepted cost/latency tradeoff) — spawned so it never
        // delays the visible reply finishing.
        let emergence_state = state.clone();
        let emergence_conv_id = conversation_id.clone();
        tokio::spawn(async move {
            crate::emergence::analyze_recent_interactions(&emergence_state, &emergence_conv_id).await;
        });

        yield Ok(Event::default().event("done").data("[DONE]"));
    };

    Sse::new(stream).keep_alive(KeepAlive::default()).into_response()
}
