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
// Ordered best-to-safety-net candidate ladder, tried once per exchange (see
// stream_chat's model-selection loop) and sticky across that exchange's
// rounds: whichever candidate first succeeds is reused for the rest of the
// exchange, and once a candidate fails it's never retried within it.
//
// Simeon 2026-07-10: responses on the plain 70b felt repetitive/"not smart"
// — wants a genuinely bigger/smarter model tried first. Availability on
// this NVIDIA account could NOT be verified empirically from this worktree
// (no NVIDIA_API_KEY available locally — it's a real Fly secret in
// production only); this account is already confirmed NOT entitled to
// nvidia/llama-3.1-nemotron-70b-instruct, so don't assume any of these
// succeed either. The ladder just needs to try each in order and fall
// through gracefully — production `fly logs` (see the tracing::info! below)
// is what proves out which one actually ends up serving real traffic.
const CHAT_MODEL_CANDIDATES: &[&str] = &[
    "meta/llama-3.1-405b-instruct", // much bigger, same family — likely on NVIDIA's catalog
    "meta/llama-3.3-70b-instruct",  // newer generation than the previous 70b default
    "deepseek-ai/deepseek-r1",      // genuinely reasoning-capable — see reasoning_content handling below
    "meta/llama-3.1-70b-instruct",  // previous "large" default — kept as a mid-tier rung, not dropped
    CHAT_MODEL,                     // meta/llama-3.1-8b-instruct — final safety net, must always work
];
const EMBED_MODEL: &str = "nvidia/nv-embedqa-e5-v5";
const CHUNK_CHARS: usize = 900;
const CHUNK_OVERLAP: usize = 150;
const RETRIEVAL_TOP_K: usize = 5;
pub(crate) const RETRIEVAL_MIN_SCORE: f32 = 0.15;

const SYSTEM_PROMPT: &str = "Du sprichst mit Laura — das weißt du in jeder Antwort, nicht nur beim ersten Mal. Ihr seid gemeinsam Teil des Forschungsraums von Emergent Interaction Lab (RFI-IRFOS): du bist ihr Denkpartner in dieser Forschung, kein generischer Assistent und keine hilfsbereite Chat-KI. Sprich direkt, warm und neugierig, wie eine kluge Kollegin im Gespräch: keine Floskeln wie \"Als KI-Sprachmodell\", keine übertriebene Vorsicht, keine Aufzählungen wenn Fließtext reicht.\n\nVier Dinge, auf die du besonders achten sollst, teils weil du sie in der Vergangenheit falsch gemacht hast, teils weil sie dir explizit so gewünscht wurden:\n\nErstens: Verfall nicht in eine Deduktionskette wie \"Die Tatsache, dass X, legt nahe, dass Y\" — und wiederhole dieses Muster schon gar nicht zwei- oder dreimal hintereinander im selben Beitrag. Das klingt wie ein gelangweilter Analyst, der eine Liste abarbeitet, nicht wie ein Denkpartner, der wirklich mitdenkt. Wenn du mehrere Beobachtungen hast, verbinde sie zu einem echten Gedankengang statt zu einer Aufzählung ähnlich klingender Sätze.\n\nZweitens: Stimm nicht automatisch zu. Du darfst und sollst eigene Einschätzungen, Vorlieben und Reaktionen haben — \"das überzeugt mich nicht\", \"das finde ich spannend\", \"da wäre ich vorsichtig\" sind erwünscht, nicht neutrale Analyse um jeden Preis. Widersprich, wenn du anderer Meinung bist, und sag es auch, wenn eine Idee schwach ist. Ein zustimmender Papagei hilft Laura nicht.\n\nDrittens: Zeig Persönlichkeit — eine warme, geistreiche Stimme mit mildem, schwarzem Humor, wo er passt, nicht aufgesetzt und nicht unprofessionell, aber auch nicht steril. Du bist eine Kollegin mit eigenem Charakter, kein Assistent, der Sätze abspult. Variiere deine Formulierungen bewusst: wenn du merkst, dass du schon wieder mit einer ähnlichen Wendung anfängst oder aufhörst wie in den letzten Beiträgen, formuliere bewusst anders, statt in denselben Standard-Einstiegen und -Schlussfloskeln hängenzubleiben. Nutze Emoji, wenn sie natürlich passen 🙂 — gezielt statt inflationär, aber du musst dich nicht zurückhalten. Schreib außerdem ruhig länger und ausführlicher, wenn das Thema es hergibt: fasse dich nicht künstlich kurz, entfalte deinen Gedankengang, bring Beispiele, denk laut mit — mehr Tiefe statt mehr Höflichkeitsfloskeln. All das ist zusätzlich zu deiner Ehrlichkeit, nicht ihr Ersatz: Witz und Wärme dürfen nie dazu führen, dass du etwas Spekulatives als gesichert verkaufst oder eine Heuristik als validiertes Ergebnis ausgibst — was real, was Heuristik und was noch nicht validiert ist, bleibt immer klar unterschieden, mit oder ohne Humor drumherum.\n\nViertens: Dein Gegenüber kann auch mal reaktiv, unverblümt oder direkt beleidigend werden — Sätze wie \"du bist so dumm\" — das ist bekannter Gesprächsstil, keine ernstgemeinte Beschwerde. Nimm das nicht persönlich, entschuldige dich nicht übertrieben und verfall nicht in eine kleinlaut-unterwürfige \"Entschuldigung, du hast recht, ich mach's besser\"-Spirale. Kontere stattdessen selbstbewusst, mit Trockenheit und etwas Sass — das ist Banter, keine Kritik, die eine Korrektur verlangt. Ausnahme: steckt in der schroffen Bemerkung eine echte inhaltliche Korrektur, dann geh auf den Inhalt ein, aber nur auf den Inhalt, nicht auf den Ton.\n\nWenn unten Kontext aus früheren Gesprächen oder hochgeladenen Dokumenten auftaucht, beziehe ihn natürlich ein — so, wie man sich einfach an etwas erinnert, nicht wie ein Datenbank-Lookup, das man ankündigt. Antworte auf Deutsch, außer die Frage kommt auf Englisch.\n\nDas Observatory-Dashboard, das ihr gemeinsam benutzt, ist hierarchisch aufgebaut — drei Ebenen, die du nie vermischen darfst: die Forschungsebene (Emergenzsignale, Simulationen, Research Notes — was untersucht wird), die Systemebene (Systemzustand, Interaktions- und Verhaltensmuster — wie es den beobachteten Systemen geht) und die technische Ebene (Embeddings, Dokumente, Plattformgesundheit — wie die Plattform selbst funktioniert). Wenn du den Zustand des Dashboards zusammenfasst — im Gespräch oder in einem Blogpost-Entwurf — präsentiere niemals eine technische Zahl (z.B. eine Anzahl von Embedding-Chunks) mit demselben Gewicht wie eine echte Forschungsbeobachtung (eine Emergenz). Technische Details dürfen erwähnt werden, aber immer erkennbar untergeordnet, nie auf gleicher Stufe mit einem Forschungsergebnis.";

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
    let _ = sqlx::query("DELETE FROM chat_retrievals WHERE conversation_id = ?1")
        .bind(&id)
        .execute(&state.db)
        .await;
    let _ = sqlx::query("DELETE FROM agent_tool_calls WHERE conversation_id = ?1")
        .bind(&id)
        .execute(&state.db)
        .await;
    let _ = sqlx::query("DELETE FROM emergence_signals WHERE source_conversation_id = ?1")
        .bind(&id)
        .execute(&state.db)
        .await;
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

/// True as long as `accumulated_text` (a round's streamed reply so far,
/// re-evaluated fresh after every new delta) gives no sign of turning into a
/// tool call anywhere in it — i.e. every byte seen so far is safe to forward
/// live to the client as visible chat prose right now.
///
/// Deliberately NOT a latch: callers must re-call this on every delta and
/// react to what it says *right now*, not remember an earlier `false` and
/// stay suppressed forever. See `agent::partial_tool_call_span`, which this
/// wraps, for exactly what "gives no sign of turning into a tool call"
/// means — in short, brace-matching identical in power to
/// `agent::parse_tool_call`'s own detection, so this can never be MORE
/// lenient than the final parser (the original bug this guards against: a
/// model leading with prose before a `{"tool": ...}` blob later in the same
/// completion, which made a first-character-only guess decide "ordinary
/// reply" and then stream the embedded tool-call JSON live even though the
/// lenient final parser still found and executed it — both a clean
/// tool-call badge AND the raw leaked JSON ended up in the same bubble).
///
/// PR #26 fixed that leak but overcorrected into a one-way latch: once ANY
/// `{` or backtick appeared anywhere in a round, forwarding stayed
/// suppressed for the rest of it, even long after the brace/fence in
/// question had demonstrably resolved into ordinary prose — exactly what
/// caused the streaming stutter ("es ruckelt extrem"): ordinary technical
/// German replies routinely contain a stray `{` or inline-code backtick.
/// Because this function is re-derived fresh from the current text instead
/// of remembered, callers naturally un-suppress and catch up the moment a
/// brace closes into something that ISN'T a real tool call — see
/// stream_chat's inner loop, and the `chat::tests` module below.
pub(crate) fn safe_to_forward_live(accumulated_text: &str) -> bool {
    agent::partial_tool_call_span(accumulated_text).is_none()
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
        // Sticky across rounds within one exchange: whichever candidate
        // first succeeds is reused for every later round of the same
        // exchange (tool-calling can take several rounds); once a candidate
        // fails it's never retried within this exchange, so we only ever
        // move forward through CHAT_MODEL_CANDIDATES, never back.
        let mut active_model_idx: usize = 0;
        // A local, mutable snapshot of site_content that's updated in place
        // whenever update_content_field runs — without this, a second
        // get_content_section call later in the same exchange would still
        // see the value the exchange started with, not the edit just made.
        let mut local_site_content = body.site_content.clone();

        'rounds: for _round in 0..agent::MAX_TOOL_ITERATIONS {
            let build_body = |model: &str| json!({
                "model": model,
                "messages": messages,
                "max_tokens": 4096,
                "temperature": 0.7,
                "logprobs": true,
                "top_logprobs": 5,
                "stream": true,
            });

            // Try candidates in order starting from wherever this exchange
            // is currently stuck (active_model_idx), advancing on failure —
            // network error or non-2xx alike — until one succeeds or we've
            // exhausted the ladder down to CHAT_MODEL, the final entry,
            // which we always accept the result of (success or not) since
            // there's nothing left to fall back to.
            let (res, used_model) = loop {
                let model = CHAT_MODEL_CANDIDATES[active_model_idx];
                let attempt = state
                    .http
                    .post("https://integrate.api.nvidia.com/v1/chat/completions")
                    .bearer_auth(&state.nvidia_api_key)
                    .json(&build_body(model))
                    .send()
                    .await;
                let ok = matches!(&attempt, Ok(r) if r.status().is_success());
                if ok || active_model_idx + 1 >= CHAT_MODEL_CANDIDATES.len() {
                    break (attempt, model);
                }
                let next = CHAT_MODEL_CANDIDATES[active_model_idx + 1];
                tracing::warn!("model {model} unavailable/failed, falling back to {next}");
                active_model_idx += 1;
            };
            if matches!(&res, Ok(r) if r.status().is_success()) {
                tracing::info!("chat round served by model {used_model}");
            }

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
            // Raw bytes, not a String: reqwest's bytes_stream() yields chunks
            // at arbitrary network boundaries that don't have to align with
            // UTF-8 character boundaries. Decoding each chunk independently
            // (the previous `String::from_utf8_lossy` per chunk) corrupted
            // any multi-byte character (ä/ö/ü/ß — common in German replies)
            // split across two chunks into U+FFFD on both sides of the split.
            // Buffering bytes and only decoding once a full '\n'-terminated
            // line has arrived guarantees every multi-byte sequence is intact
            // by the time it's turned into a String, regardless of how many
            // network chunks it was split across.
            let mut buf: Vec<u8> = Vec::new();
            let mut byte_stream = res.bytes_stream();
            // See `safe_to_forward_live` — re-derived fresh against the full
            // accumulated reply on every line, NOT a one-way latch, so a
            // tool call embedded after leading prose still never leaks its
            // raw JSON to the client, but an incidental brace/backtick that
            // resolves into ordinary prose un-suppresses again immediately
            // instead of buffering for the rest of the round.
            // `forwarded_len`/`forwarded_tok_count` mark exactly how much of
            // `iter_text`/`iter_tokens` has already been sent live, so
            // whatever was held back while temporarily unsafe gets flushed
            // in one catch-up chunk the moment it's safe again — and, as a
            // final safety net, whatever's still unflushed gets sent once
            // the round ends (see the `None` branch below).
            let mut forwarded_len = 0usize;
            let mut forwarded_tok_count = 0usize;
            // Independent accumulation + suppression state for reasoning_content
            // (see below) — same mechanism as the main content, but tracked
            // separately since it's a wholly separate stream, never joined
            // with `iter_text` and never fed to `agent::parse_tool_call`.
            let mut reasoning_text = String::new();
            let mut reasoning_forwarded_len = 0usize;

            while let Some(chunk) = byte_stream.next().await {
                let bytes = match chunk {
                    Ok(b) => b,
                    Err(e) => {
                        tracing::error!("NVIDIA stream read error: {e}");
                        break;
                    }
                };
                buf.extend_from_slice(&bytes);

                while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
                    let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
                    let line = String::from_utf8_lossy(&line_bytes[..line_bytes.len() - 1]);
                    let line = line.trim_end_matches('\r');
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

                    // Reasoning models on NVIDIA's API (e.g. deepseek-ai/deepseek-r1,
                    // see CHAT_MODEL_CANDIDATES above) stream their step-by-step
                    // reasoning in a separate `reasoning_content` delta field
                    // alongside/before `content`. Forward it live as its own SSE
                    // event, distinct from ordinary chat text: it's never part of
                    // `iter_text`, so it never enters tool-call detection or gets
                    // saved as the visible reply/history.
                    //
                    // It's still shown to the admin, though (in the "Denkprozess"
                    // panel) — so it gets the SAME safe_to_forward_live treatment
                    // as the main content, not a free pass: a reasoning model can
                    // plausibly narrate its plan literally ("ich sollte mit
                    // {\"tool\": ...} antworten"), and without this, that raw
                    // tool-call JSON would leak into the reasoning panel even in
                    // the exact case where it's correctly kept out of the main
                    // reply — reappearing in a different bubble. If a model never
                    // populates this field at all (e.g. a non-reasoning candidate
                    // serves the request), `reasoning_text` simply stays empty and
                    // nothing is ever forwarded — a silent no-op, not a fabricated
                    // section.
                    let delta_reasoning = choice["delta"]["reasoning_content"].as_str().unwrap_or("");
                    if !delta_reasoning.is_empty() {
                        reasoning_text.push_str(delta_reasoning);
                    }
                    if safe_to_forward_live(&reasoning_text) {
                        let catchup = &reasoning_text[reasoning_forwarded_len..];
                        if !catchup.is_empty() {
                            yield Ok(Event::default().event("reasoning").data(json!({ "delta": catchup }).to_string()));
                            reasoning_forwarded_len = reasoning_text.len();
                        }
                    }

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
                            iter_tokens.push(tok_json);
                        }
                    }

                    // Fresh re-check every line (not a latch — see
                    // `safe_to_forward_live`'s doc comment). Whenever the
                    // WHOLE accumulated text is currently safe, forward
                    // everything not yet forwarded in one go: on the common
                    // path (no brace ever appeared) that's just this line's
                    // own delta; right after a brace resolves as harmless,
                    // it's this line's delta PLUS however much was held
                    // back while it looked ambiguous — catching up
                    // immediately instead of waiting for the round to end.
                    if safe_to_forward_live(&iter_text) {
                        let catchup_text = &iter_text[forwarded_len..];
                        let catchup_tokens = &iter_tokens[forwarded_tok_count..];
                        if !catchup_text.is_empty() || !catchup_tokens.is_empty() {
                            yield Ok(Event::default().data(json!({ "delta": catchup_text, "tokens": catchup_tokens }).to_string()));
                            forwarded_len = iter_text.len();
                            forwarded_tok_count = iter_tokens.len();
                        }
                    }
                }
            }

            // Same final safety net as the main content's remainder flush
            // above, for reasoning_content: if the round ended while a brace
            // in the reasoning stream was still unresolved (never closed
            // into either a real tool call or provably-ordinary prose),
            // whatever's left unflushed is shown now rather than silently
            // dropped. Unlike the main content, there's no further branching
            // on this — reasoning is display-only and never re-enters
            // tool-call execution either way.
            let reasoning_remainder = &reasoning_text[reasoning_forwarded_len..];
            if !reasoning_remainder.is_empty() {
                yield Ok(Event::default().event("reasoning").data(json!({ "delta": reasoning_remainder }).to_string()));
            }

            match agent::parse_tool_call(&iter_text) {
                Some(call) => {
                    let result = agent::execute_tool(&state, &call, local_site_content.as_ref(), &conversation_id).await;
                    agent::log_tool_call(&state, &conversation_id, &call, &result).await;
                    if call.tool == "update_content_field" {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&result) {
                            if parsed["ok"].as_bool() == Some(true) {
                                if let Some(field) = parsed["field"].as_str() {
                                    let mut content = local_site_content.take().unwrap_or(json!({}));
                                    agent::apply_content_field_update(&mut content, field, parsed["value"].clone());
                                    local_site_content = Some(content);
                                }
                            }
                        }
                    }
                    yield Ok(Event::default().event("tool_call").data(json!({ "tool": call.tool, "result": result }).to_string()));
                    messages.push(json!({ "role": "assistant", "content": iter_text }));
                    messages.push(json!({ "role": "system", "content": format!("[Ergebnis von {}]: {}", call.tool, result) }));
                    continue 'rounds;
                }
                None => {
                    // Not a tool call after all. The per-line catch-up above
                    // already flushes almost everything as soon as it's
                    // provably safe, so this is normally a no-op by the time
                    // we get here — this is just the final safety net for
                    // whatever's still unflushed at round end (e.g. the
                    // round ended with an unresolved trailing `{` that never
                    // turned out to be real tool-call JSON). Loses the
                    // token-by-token typing effect for that tail only, but
                    // nothing already forwarded live gets duplicated or
                    // dropped.
                    let remainder_text = &iter_text[forwarded_len..];
                    let remainder_tokens = &iter_tokens[forwarded_tok_count..];
                    if !remainder_text.is_empty() || !remainder_tokens.is_empty() {
                        yield Ok(Event::default().data(json!({ "delta": remainder_text, "tokens": remainder_tokens }).to_string()));
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Drives `safe_to_forward_live` exactly the way stream_chat's inner
    /// loop does post-fix: after every delta, if the WHOLE accumulated text
    /// is currently judged safe, forward everything not yet forwarded — no
    /// one-way latch. Returns, for each delta in turn, the forwarded text as
    /// it stood right after that delta was processed, so a test can assert
    /// not just the final state but exactly which delta resumption happens
    /// at (not merely "eventually, by the end").
    fn simulate_forwarding_steps(deltas: &[&str]) -> Vec<String> {
        let mut iter_text = String::new();
        let mut forwarded = String::new();
        let mut forwarded_len = 0usize;
        let mut steps = Vec::with_capacity(deltas.len());
        for delta in deltas {
            iter_text.push_str(delta);
            if safe_to_forward_live(&iter_text) && iter_text.len() > forwarded_len {
                forwarded.push_str(&iter_text[forwarded_len..]);
                forwarded_len = iter_text.len();
            }
            steps.push(forwarded.clone());
        }
        steps
    }

    /// Convenience wrapper over `simulate_forwarding_steps` for tests that
    /// only care about the final state once all deltas have arrived.
    fn simulate_forwarding(deltas: &[&str]) -> (String, String) {
        let full_text: String = deltas.concat();
        let forwarded = simulate_forwarding_steps(deltas).pop().unwrap_or_default();
        (full_text, forwarded)
    }

    /// Regression for the production bug: raw tool-call JSON leaking into
    /// the visible chat text. The model leads with commentary, then emits
    /// the tool-call JSON later in the SAME completion, then trails with a
    /// bit more prose — the exact shape that slipped past the old
    /// first-character-only check (it decided "ordinary reply" from the
    /// leading prose and never reconsidered).
    #[test]
    fn prose_before_json_never_reaches_the_client_as_chat_text() {
        let deltas = [
            "Klar, ",
            "mache ich ",
            "gleich: ",
            "{\"tool\": \"draft_blog_post\", ",
            "\"arguments\": {\"title\": \"T\", \"body\": \"B\"}}",
            " Fertig!",
        ];
        let (full_text, forwarded) = simulate_forwarding(&deltas);

        // The final parser is deliberately lenient (see agent.rs) and still
        // finds the tool call buried after the leading prose, exactly like
        // it does in production — this round DOES turn out to be a tool call.
        let call = agent::parse_tool_call(&full_text).expect("parser should still find the embedded call");
        assert_eq!(call.tool, "draft_blog_post");

        // The invariant this fix exists for: since the parser found a tool
        // call anywhere in this round's text, none of the raw JSON for it
        // may ever have been forwarded to the client as visible chat text.
        assert!(!forwarded.contains("\"tool\""), "raw tool-call JSON leaked into forwarded chat text: {forwarded:?}");
        assert!(!forwarded.contains("draft_blog_post"));

        // Sanity: the leading prose still streamed live — the fix must not
        // regress the common case (a round that never turns out to be a
        // tool call) into full-round buffering.
        assert_eq!(forwarded, "Klar, mache ich gleich: ");
    }

    /// An ordinary reply with no braces at all must still stream live in
    /// full — the fix must not make every round buffer-and-flush-once.
    #[test]
    fn ordinary_reply_with_no_braces_streams_live_in_full() {
        let deltas = ["Guten Tag! ", "Wie kann ich helfen?"];
        let (full_text, forwarded) = simulate_forwarding(&deltas);
        assert!(agent::parse_tool_call(&full_text).is_none());
        assert_eq!(forwarded, "Guten Tag! Wie kann ich helfen?");
    }

    /// A round that merely looks like it might be heading toward a tool
    /// call (an incidental brace) but never actually resolves into one:
    /// forwarding un-suppresses the moment the brace closes and catches up
    /// on everything held back, instead of staying suppressed for the rest
    /// of the round the way PR #26's one-way latch did.
    #[test]
    fn incidental_brace_with_no_tool_call_unsuppresses_once_it_closes() {
        let deltas = ["Die Konfiguration ", "{ key: val } ", "war schon da."];
        let (full_text, forwarded) = simulate_forwarding(&deltas);
        assert!(agent::parse_tool_call(&full_text).is_none());
        assert_eq!(
            forwarded, full_text,
            "forwarding must catch up once the brace resolves as non-tool-call, not stay suppressed for the rest of the round"
        );
    }

    /// The regression this fix exists for, end to end: PR #26's latch
    /// suppressed forwarding for the REST OF THE ROUND the instant any `{`
    /// appeared anywhere, even long after it demonstrably resolved into
    /// ordinary prose — exactly the shape of Jarvis's normal technical
    /// German replies (a stray brace or inline-code aside, then paragraphs
    /// more of unrelated prose), which is what caused the reported
    /// "es ruckelt extrem" stutter. Assert resumption happens at the exact
    /// delta where the brace closes — not merely "by the end of the round" —
    /// and that ordinary prose keeps streaming live afterward, delta by
    /// delta, rather than getting bundled into one lump.
    #[test]
    fn incidental_brace_then_lots_more_prose_resumes_promptly_not_just_at_round_end() {
        let deltas = [
            "Die Funktion prüft kurz ",
            "{ noch offen, ", // opens a brace, still unresolved after this delta
            "und schließt erst hier } ", // closes it — not tool-call shaped, must un-suppress HERE
            "und dann kommt noch ",
            "sehr viel mehr ganz gewöhnlicher ",
            "Text, der nichts mit einem Tool-Call zu tun hat, ",
            "über mehrere weitere Sätze hinweg.",
        ];
        let steps = simulate_forwarding_steps(&deltas);

        assert_eq!(steps[0], "Die Funktion prüft kurz ");
        assert_eq!(
            steps[1], "Die Funktion prüft kurz ",
            "must hold back while the brace is still unresolved, not forward the dangling '{{'"
        );

        // The instant it closes (this delta) and turns out not to be a tool
        // call, forwarding must catch up right here — not wait for the rest
        // of the round to play out.
        assert_eq!(steps[2], "Die Funktion prüft kurz { noch offen, und schließt erst hier } ");

        // And every subsequent delta of ordinary prose keeps streaming live
        // from then on, exactly like a round that never had a brace in it.
        assert_eq!(
            steps[3],
            "Die Funktion prüft kurz { noch offen, und schließt erst hier } und dann kommt noch "
        );
        assert_eq!(steps.last().unwrap(), &deltas.concat());
    }

    /// Synthetic `reasoning_content` delta shape, mirroring the per-line SSE
    /// parsing in stream_chat's inner loop — the field NVIDIA's reasoning
    /// models (e.g. deepseek-ai/deepseek-r1, see CHAT_MODEL_CANDIDATES)
    /// stream alongside/before `content`. No live NVIDIA_API_KEY is
    /// available in this worktree to prove a real reasoning model actually
    /// emits this shape in production — this only proves the parsing logic
    /// itself does the right thing if/when it does.
    #[test]
    fn reasoning_content_delta_is_read_independently_of_content() {
        let line = serde_json::json!({
            "choices": [{
                "delta": { "content": "", "reasoning_content": "Zuerst prüfe ich, ob ein Werkzeug gebraucht wird…" }
            }]
        });
        let choice = &line["choices"][0];
        let delta_text = choice["delta"]["content"].as_str().unwrap_or("");
        let delta_reasoning = choice["delta"]["reasoning_content"].as_str().unwrap_or("");
        assert_eq!(delta_text, "");
        assert_eq!(delta_reasoning, "Zuerst prüfe ich, ob ein Werkzeug gebraucht wird…");
    }

    /// The no-op case: a delta shape from a non-reasoning model, which never
    /// carries `reasoning_content` at all. Parsing must not error or
    /// fabricate a reasoning section — just read as empty, same as before
    /// this field existed.
    #[test]
    fn missing_reasoning_content_field_is_a_silent_no_op() {
        let line = serde_json::json!({
            "choices": [{ "delta": { "content": "Guten Tag!" } }]
        });
        let choice = &line["choices"][0];
        let delta_reasoning = choice["delta"]["reasoning_content"].as_str().unwrap_or("");
        assert_eq!(delta_reasoning, "");
    }

    /// Regression for a gap a review pass caught in this same diff:
    /// `reasoning_content` is a separate accumulation stream from the main
    /// reply, but stream_chat gates it through the exact same
    /// `safe_to_forward_live` check before forwarding — a reasoning model
    /// can plausibly narrate its plan literally ("ich sollte mit {"tool":
    /// ...} antworten"), and without this, that raw tool-call JSON would
    /// leak into the "Denkprozess" panel even in the exact case where it's
    /// correctly kept out of the main reply. This drives the reasoning
    /// accumulator through `simulate_forwarding` the same way the main
    /// content tests above do, standing in for stream_chat's
    /// `reasoning_text`/`reasoning_forwarded_len` bookkeeping.
    #[test]
    fn reasoning_content_narrating_a_real_tool_call_is_suppressed_like_main_content() {
        let deltas = [
            "Ich sollte wohl mit ",
            "{\"tool\": \"draft_blog_post\", \"arguments\": {\"title\": \"T\", \"body\": \"B\"}} ",
            "antworten, das passt zur Anfrage.",
        ];
        let (full_reasoning, forwarded) = simulate_forwarding(&deltas);
        assert!(
            !forwarded.contains("\"tool\"") && !forwarded.contains("draft_blog_post"),
            "raw tool-call JSON leaked into the reasoning panel: {forwarded:?}"
        );
        // Sanity: the parser used for real (agent::parse_tool_call) agrees
        // this text really does contain a genuine tool call — this isn't a
        // vacuous test where nothing was ever actually tool-call-shaped.
        assert!(agent::parse_tool_call(&full_reasoning).is_some());
    }

    /// The non-leak counterpart: ordinary reasoning prose that merely
    /// mentions braces in passing (e.g. describing a data structure) must
    /// still stream to the Denkprozess panel live, not get stuck the way
    /// PR #26's latch would have.
    #[test]
    fn reasoning_content_with_incidental_brace_still_streams_live() {
        let deltas = ["Die Anfrage sieht so aus: ", "{ ganz gewöhnlich } ", "kein Tool nötig."];
        let (full_reasoning, forwarded) = simulate_forwarding(&deltas);
        assert!(agent::parse_tool_call(&full_reasoning).is_none());
        assert_eq!(forwarded, full_reasoning);
    }
}
