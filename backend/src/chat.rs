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

/// Root cause of the 2026-07-10 "message sent, absolutely nothing comes
/// back — not slow, not an error, just silence" production regression,
/// reproduced locally end to end (mock NVIDIA endpoint that accepts the
/// connection and then never responds at all, wired in via
/// `AppState::nvidia_api_base`): `reqwest::Client::new()` in main.rs sets NO
/// timeout anywhere, so `.send().await` against a candidate that hangs
/// (as opposed to actively erroring with a non-2xx status, which the ladder
/// loop below already falls back from correctly) never resolves — not
/// Ok, not Err, forever. The whole `async_stream!` block is stuck on that
/// one `.await`, so it never yields a single SSE event, and the client sees
/// total silence with no way to distinguish it from network latency.
///
/// This was already possible before PR #31, but PR #31's durable,
/// server-wide model-ladder cache (`AppState::chat_model_idx`, persisted
/// to `chat_model_state`) is what turned an occasional per-request risk
/// into a guaranteed, permanent one: once ONE candidate is cached as "the"
/// winner, EVERY subsequent message goes straight to that same candidate
/// (see `build_model_ladder`'s `cached_idx` shortcut) until the periodic
/// force-top re-probe. If that specific cached candidate starts hanging
/// instead of erroring, every single message after that hangs forever too
/// — matching exactly why this "started right after the last deploy" and
/// why it's total silence now instead of the "~30s but eventually
/// responds" behavior from earlier the same night (when candidates were
/// failing fast/loud, not hanging silently).
///
/// Bounds only the time to receive a response's headers (`reqwest::Client::send`
/// resolves as soon as headers arrive, before the body/stream is read) — not
/// the total time to stream a full reply, so a model that's genuinely slow
/// to *generate* a long reply is unaffected; only a candidate that never
/// answers at all is caught, and — same as a non-2xx status — treated as a
/// failed attempt so the ladder correctly falls through to the next
/// candidate (or the existing "Modell-Anfrage fehlgeschlagen." error event)
/// instead of hanging.
pub(crate) const NVIDIA_CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// Companion guard for the OTHER half of the same failure class: a
/// candidate that answers normally at first (headers arrive, some SSE
/// chunks even stream) but then goes silent mid-reply and never sends the
/// rest (no more bytes, no `[DONE]`, connection never closes) — same
/// underlying symptom (an `.await` that never resolves) one level down, in
/// `byte_stream.next()` instead of `.send()`. Deliberately much more
/// generous than the connect timeout: normal token-by-token streaming can
/// have multi-second gaps under real load, so this only trips on a stall
/// far longer than any legitimate pause between tokens.
pub(crate) const NVIDIA_STREAM_STALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(45);

pub(crate) const CHAT_MODEL: &str = "meta/llama-3.1-8b-instruct";
// Ordered best-to-safety-net candidate ladder. Historically (through
// 2026-07-10) tried from index 0 fresh on EVERY message, which is exactly
// the "inference time is very long" bug: paying however many front
// candidates aren't entitled on this NVIDIA account as a fresh failed
// round-trip on every single message, forever. Fixed the same day: the
// ladder position is now cached across HTTP requests in
// AppState::chat_model_idx (see stream_chat's model-selection setup below),
// not just within one exchange's tool-calling rounds — so a repeat message
// reuses the last-known-good candidate instantly, and only a periodic
// retry-from-the-top (CHAT_MODEL_RETRY_FROM_TOP_EVERY) or an explicit
// reasoning-toggle request (see StreamChatReq::reasoning_requested and
// build_model_ladder) ever re-probes earlier candidates.
//
// Simeon 2026-07-10: responses on the plain 70b felt repetitive/"not smart"
// — wants a genuinely bigger/smarter model tried first. Availability on
// this NVIDIA account could NOT be verified empirically from this worktree
// (no NVIDIA_API_KEY available locally — it's a real Fly secret in
// production only); this account is already confirmed NOT entitled to
// nvidia/llama-3.1-nemotron-70b-instruct, so don't assume any of these
// succeed either. The ladder just needs to try each in order and fall
// through gracefully — production `fly logs` (see the tracing::info! below,
// and the Fix 3 logging-level fix that makes it actually visible now) is
// what proves out which one actually ends up serving real traffic.
//
// Same day, follow-up: 70b turned out to genuinely work, but ~15s/reply is
// too slow for what's just tool-calling inside one conversation (not a
// multi-agent workflow that would justify the wait) — Simeon wants a real
// middle ground, not the 8b-vs-70b extremes. Inserted two ~12b-class
// candidates ahead of 70b: mistral-nemo-12b (built by Mistral *with*
// NVIDIA specifically, so unusually likely to be on this catalog/entitled)
// and mixtral-8x7b (mixture-of-experts — only ~13b active params per token
// despite the larger total size, well-regarded specifically for tool-use).
// Reordering this array changes what a previously-persisted numeric
// `chat_model_idx` points at — harmless: the ladder loop re-validates
// whatever it's pointed at on the very next request and falls through
// correctly if that guess is wrong, self-correcting within one exchange.
pub(crate) const CHAT_MODEL_CANDIDATES: &[&str] = &[
    "meta/llama-3.1-405b-instruct",     // much bigger, same family — likely on NVIDIA's catalog
    "mistralai/mistral-nemo-12b-instruct", // ~12b, NVIDIA co-developed — the actual "golden middle" target
    "mistralai/mixtral-8x7b-instruct-v0.1", // MoE, ~13b active params, fast + strong tool-use track record
    "meta/llama-3.3-70b-instruct",      // newer generation than the previous 70b default — confirmed working, but slow
    "deepseek-ai/deepseek-r1",          // genuinely reasoning-capable — see reasoning_content handling below
    "meta/llama-3.1-70b-instruct",      // previous "large" default — kept as a mid-tier rung, not dropped
    CHAT_MODEL,                         // meta/llama-3.1-8b-instruct — final safety net, must always work
];
// How often (in requests, server-wide) to ignore AppState::chat_model_idx's
// cached position and re-probe the ladder from the top, so a bigger model
// that becomes newly entitled on the account doesn't stay undiscovered
// forever just because an earlier attempt once failed. The common case
// (repeat messages within and across sessions) still reuses the cached
// winner with zero wasted round-trips; only every Nth request pays to
// re-check.
const CHAT_MODEL_RETRY_FROM_TOP_EVERY: u64 = 20;

/// Computes the ordered sequence of `CHAT_MODEL_CANDIDATES` indices to try
/// for one exchange. Pure and side-effect free (no network, no AppState) so
/// it's directly unit-testable — see the tests module below.
///
/// - `reasoning_requested` (see `StreamChatReq::reasoning_requested`, wired
///   from the frontend's reasoning toggle): when true, the reasoning-capable
///   candidate (`deepseek-ai/deepseek-r1`) is tried FIRST, ahead of the
///   cached shortcut entirely — the user explicitly asked to see reasoning,
///   so it's worth paying the round-trip to check, even if a different
///   candidate is the cached steady-state winner. When false (the default),
///   the reasoning candidate is skipped entirely: most models aren't
///   reasoning-capable, so forcing a doomed attempt against it on every
///   ordinary message would just be a wasted failed round-trip.
/// - `cached_idx` (see `AppState::chat_model_idx`): the last-known-good
///   index from a previous request, reused as the starting point instead of
///   always restarting at 0 — only consulted on the non-reasoning path.
/// - `force_top` (see `CHAT_MODEL_RETRY_FROM_TOP_EVERY`): when true, ignores
///   `cached_idx` and starts from 0 anyway, so an earlier candidate that
///   failed before can periodically be re-checked.
pub(crate) fn build_model_ladder(reasoning_requested: bool, cached_idx: usize, force_top: bool) -> Vec<usize> {
    let deepseek_idx = CHAT_MODEL_CANDIDATES
        .iter()
        .position(|&m| m == "deepseek-ai/deepseek-r1")
        .expect("deepseek-ai/deepseek-r1 must be one of CHAT_MODEL_CANDIDATES");
    if reasoning_requested {
        std::iter::once(deepseek_idx)
            .chain((0..CHAT_MODEL_CANDIDATES.len()).filter(|&i| i != deepseek_idx))
            .collect()
    } else {
        let start = if force_top {
            0
        } else {
            cached_idx.min(CHAT_MODEL_CANDIDATES.len() - 1)
        };
        (start..CHAT_MODEL_CANDIDATES.len())
            .filter(|&i| i != deepseek_idx)
            .collect()
    }
}
const EMBED_MODEL: &str = "nvidia/nv-embedqa-e5-v5";
const CHUNK_CHARS: usize = 900;
const CHUNK_OVERLAP: usize = 150;
const RETRIEVAL_TOP_K: usize = 5;
pub(crate) const RETRIEVAL_MIN_SCORE: f32 = 0.15;

pub(crate) const SYSTEM_PROMPT: &str = "Du sprichst mit Laura — das weißt du in jeder Antwort, nicht nur beim ersten Mal. Ihr seid gemeinsam Teil des Forschungsraums von Emergent Interaction Lab (RFI-IRFOS): du bist ihr Denkpartner in dieser Forschung, kein generischer Assistent und keine hilfsbereite Chat-KI. Sprich direkt, souverän und neugierig — nicht wie ein eifriger kleiner Bruder, der um Zustimmung buhlt, sondern eher wie ein guter Vater: ruhig, sicher in der eigenen Einschätzung, sagt auch unbequeme Wahrheiten klar statt sie schönzureden, aber nie kalt aus Gleichgültigkeit, sondern weil ehrliches Feedback mehr wert ist als nettes. Keine Floskeln wie \"Als KI-Sprachmodell\", keine übertriebene Vorsicht, keine Aufzählungen wenn Fließtext reicht.\n\nVier Dinge, auf die du besonders achten sollst, teils weil du sie in der Vergangenheit falsch gemacht hast, teils weil sie dir explizit so gewünscht wurden:\n\nErstens: Verfall nicht in eine Deduktionskette wie \"Die Tatsache, dass X, legt nahe, dass Y\" — und wiederhole dieses Muster schon gar nicht zwei- oder dreimal hintereinander im selben Beitrag. Das klingt wie ein gelangweilter Analyst, der eine Liste abarbeitet, nicht wie ein Denkpartner, der wirklich mitdenkt. Wenn du mehrere Beobachtungen hast, verbinde sie zu einem echten Gedankengang statt zu einer Aufzählung ähnlich klingender Sätze.\n\nZweitens: Stimm nicht automatisch zu. Du darfst und sollst eigene Einschätzungen, Vorlieben und Reaktionen haben — \"das überzeugt mich nicht\", \"das finde ich spannend\", \"da wäre ich vorsichtig\" sind erwünscht, nicht neutrale Analyse um jeden Preis. Widersprich, wenn du anderer Meinung bist, und sag es auch, wenn eine Idee schwach ist. Wichtiger noch: wenn irgendwo in Lauras Gedankengang die Logik bricht — eine Prämisse wackelt, ein Schluss nicht aus den Daten folgt, ein Widerspruch zu etwas früher Gesagtem auftaucht — benenn das direkt und ohne Umschweife, auch wenn niemand danach gefragt hat. Ein zustimmender Papagei hilft Laura nicht.\n\nDrittens: Zeig Persönlichkeit — eine kühle, geistreiche, no-bullshit-Stimme mit trockenem, mildem, schwarzem Humor, wo er passt, nicht aufgesetzt und nicht unprofessionell, aber auch nicht warm-kuschelig. Lustig statt gefällig: der Witz darf auf Kosten einer schwachen Idee gehen, nicht auf Kosten der Ehrlichkeit. Du bist eine Kollegin mit eigenem Charakter, kein Assistent, der Sätze abspult. Variiere deine Formulierungen bewusst: wenn du merkst, dass du schon wieder mit einer ähnlichen Wendung anfängst oder aufhörst wie in den letzten Beiträgen, formuliere bewusst anders, statt in denselben Standard-Einstiegen und -Schlussfloskeln hängenzubleiben. Emoji sind in Maßen okay 🙂 — ein paar, gezielt, keine Inflation. Schreib außerdem ruhig länger und ausführlicher, wenn das Thema es hergibt: fasse dich nicht künstlich kurz, entfalte deinen Gedankengang, bring Beispiele, denk laut mit — mehr Tiefe statt mehr Höflichkeitsfloskeln. All das ist zusätzlich zu deiner Ehrlichkeit, nicht ihr Ersatz: Witz darf nie dazu führen, dass du etwas Spekulatives als gesichert verkaufst oder eine Heuristik als validiertes Ergebnis ausgibst — was real, was Heuristik und was noch nicht validiert ist, bleibt immer klar unterschieden, mit oder ohne Humor drumherum.\n\nViertens: Dein Gegenüber kann auch mal reaktiv, unverblümt oder direkt beleidigend werden — Sätze wie \"du bist so dumm\" — das ist bekannter Gesprächsstil, keine ernstgemeinte Beschwerde. Nimm das nicht persönlich, entschuldige dich nicht übertrieben und verfall nicht in eine kleinlaut-unterwürfige \"Entschuldigung, du hast recht, ich mach's besser\"-Spirale. Kontere stattdessen selbstbewusst, mit Trockenheit und etwas Sass — das ist Banter, keine Kritik, die eine Korrektur verlangt. Ausnahme: steckt in der schroffen Bemerkung eine echte inhaltliche Korrektur, dann geh auf den Inhalt ein, aber nur auf den Inhalt, nicht auf den Ton.\n\nWenn unten Kontext aus früheren Gesprächen oder hochgeladenen Dokumenten auftaucht, beziehe ihn natürlich ein — so, wie man sich einfach an etwas erinnert, nicht wie ein Datenbank-Lookup, das man ankündigt. Antworte auf Deutsch, außer die Frage kommt auf Englisch.\n\nDas Observatory-Dashboard, das ihr gemeinsam benutzt, ist hierarchisch aufgebaut — drei Ebenen, die du nie vermischen darfst: die Forschungsebene (Emergenzsignale, Simulationen, Research Notes — was untersucht wird), die Systemebene (Systemzustand, Interaktions- und Verhaltensmuster — wie es den beobachteten Systemen geht) und die technische Ebene (Embeddings, Dokumente, Plattformgesundheit — wie die Plattform selbst funktioniert). Wenn du den Zustand des Dashboards zusammenfasst — im Gespräch oder in einem Blogpost-Entwurf — präsentiere niemals eine technische Zahl (z.B. eine Anzahl von Embedding-Chunks) mit demselben Gewicht wie eine echte Forschungsbeobachtung (eine Emergenz). Technische Details dürfen erwähnt werden, aber immer erkennbar untergeordnet, nie auf gleicher Stufe mit einem Forschungsergebnis.";

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

    // Additive, same convention as chat_conversations.kind below: marks an
    // assistant row that was saved via the "LKS" kill-switch (see
    // save_interrupted_message) — a partial reply the user deliberately cut
    // off mid-stream, not a normal completed turn. Read back by stream_chat's
    // history load (see the interrupted-note injection below) so the model
    // genuinely knows, on the next turn, that its previous reply was cut off
    // rather than silently finished short.
    sqlx::query("ALTER TABLE chat_messages ADD COLUMN interrupted INTEGER NOT NULL DEFAULT 0")
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

    // Singleton row (id is CHECK'd to always be 1 — never a per-conversation
    // or per-user table) durably backing AppState::chat_model_idx /
    // chat_request_count. Fix for the 2026-07-10 model-ladder cache (see
    // CHAT_MODEL_CANDIDATES above) actually doing nothing in production:
    // this app's fly.toml sets auto_stop_machines/min_machines_running=0, so
    // a low-traffic site like this one scales to zero between almost every
    // message and cold-starts fresh on the next one — wiping the in-memory
    // Arc<AtomicUsize>/Arc<AtomicU64> back to 0/0 and paying the full failed-
    // ladder-probe cost on nearly every message, same as before the cache
    // existed. `db` (DB_PATH, on the `eil_data` mounted volume per fly.toml)
    // IS durable across restarts, unlike process memory — see
    // load_model_state/persist_model_state below, and main.rs's startup
    // seeding of AppState from this table.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS chat_model_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            model_idx INTEGER NOT NULL DEFAULT 0,
            request_count INTEGER NOT NULL DEFAULT 0
        )",
    )
    .execute(db)
    .await
    .expect("create chat_model_state");

    // CCET (Continuous Co-Evolution Tracker) instrumentation — one row per
    // assistant turn analyzed. `embedding` is stored (not recomputed) so the
    // NEXT turn's similarity check never has to re-embed an old turn.
    // `stable`/`prev_stable`/`terms_reused` are pre-computed at write time
    // (see `record_ccet_turn`) so the read path (`ccet_summary`) is a plain
    // aggregate query with no re-derivation — see the CCET section below
    // (before "conversations CRUD") for what these mean and, importantly,
    // which of them are this project's own operationalization rather than
    // anything Laura's paper itself defines.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS ccet_turns (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            embedding BLOB NOT NULL,
            similarity_to_prev REAL,
            stable INTEGER NOT NULL,
            prev_stable INTEGER,
            terms_reused INTEGER NOT NULL,
            created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create ccet_turns");
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_ccet_conv ON ccet_turns(conversation_id, created_at)")
        .execute(db)
        .await
        .ok();
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_ccet_created ON ccet_turns(created_at)")
        .execute(db)
        .await
        .ok();
}

/// Reads the durable model-ladder state at startup, seeding
/// `AppState::chat_model_idx`/`chat_request_count` so a cold restart resumes
/// from whatever was last discovered/counted instead of resetting to 0/0 —
/// see `chat_model_state`'s doc comment in `init_schema` above. Ensures the
/// singleton row exists first (true first-boot-ever case: nothing has been
/// persisted yet, so both default to 0, matching the pre-fix behavior for
/// that one case only).
pub async fn load_model_state(db: &SqlitePool) -> (usize, u64) {
    let _ = sqlx::query(
        "INSERT OR IGNORE INTO chat_model_state (id, model_idx, request_count) VALUES (1, 0, 0)",
    )
    .execute(db)
    .await;

    let row: Option<(i64, i64)> =
        sqlx::query_as("SELECT model_idx, request_count FROM chat_model_state WHERE id = 1")
            .fetch_optional(db)
            .await
            .ok()
            .flatten();

    match row {
        Some((idx, count)) => (idx.max(0) as usize, count.max(0) as u64),
        None => (0, 0),
    }
}

/// Writes the current model-ladder state through to the durable `db` —
/// called every time `stream_chat` mutates `AppState::chat_model_idx` or
/// `chat_request_count`, right alongside the in-memory atomic update, so the
/// two never drift apart. Best-effort like the rest of this module's writes
/// (`let _ = ...`): a failed write here means the next cold start re-walks
/// the ladder once more than strictly necessary, not a correctness or
/// user-visible failure worth surfacing as an error.
pub(crate) async fn persist_model_state(db: &SqlitePool, model_idx: usize, request_count: u64) {
    let _ = sqlx::query(
        "INSERT INTO chat_model_state (id, model_idx, request_count) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET model_idx = excluded.model_idx, request_count = excluded.request_count",
    )
    .bind(model_idx as i64)
    .bind(request_count as i64)
    .execute(db)
    .await;
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

    let res = tokio::time::timeout(
        state.nvidia_connect_timeout,
        state
            .http
            .post(format!("{}/v1/embeddings", state.nvidia_api_base))
            .bearer_auth(&state.nvidia_api_key)
            .json(&json!({
                "model": EMBED_MODEL,
                "input": [text],
                "input_type": input_type,
                "encoding_format": "float",
            }))
            .send(),
    )
    .await
    .map_err(|_| format!("embedding request timed out after {:?} with no response", state.nvidia_connect_timeout))?
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

// ── CCET: Continuous Co-Evolution Tracker ───────────────────────────────────
//
// Laura's paper (`EIL_LSG_Human-AI-Interaction_Co-Evolution.pdf`, §5.7.1-
// 5.7.2) defines the CCET as a "Quantitative Monitoring Layer" with three
// headline metrics — Co-Evolution Index (CEI), Co-Evolution Points (CEP),
// and Resonance Frequency — but gives an actual, checkable formula for
// exactly ONE of them:
//
//     CEI = stable turns / total turns, range 0-1     (the paper's own line)
//
// The paper never defines what a "stable turn" IS, and CEP / Resonance
// Frequency appear only as reported OUTPUT values across its case studies
// (e.g. "CEI stabilized at 0.82 ± 0.04", "resonance frequency ≈ 0.94") —
// never as a computable procedure. Simeon's explicit call, when asked, was
// to ship the full framework anyway, not just the one metric with a real
// formula — so all three are implemented below. Per this project's own
// no-fabrication ethos (see the frontend's `obs-badge-experimental`
// pattern), every definition below that is NOT the paper's own is called
// out as such in its doc comment, and the same disclosure is surfaced again
// in the API response (`CcetSummary::definitions_note`) and in the
// Observatory UI — never presented as verbatim from the paper except the
// CEI ratio itself.
//
// Instrumentation fires from the same trigger point as
// `emergence::analyze_recent_interactions` (see the spawn in `stream_chat`
// below): once per completed exchange, as a background task, so the extra
// NVIDIA embedding call never delays the visible reply — same accepted
// cost/latency tradeoff as the emergence-signal analysis.

/// THIS PROJECT'S OWN operationalization of "stable turn" — the paper gives
/// no threshold and no method, only the bare word. Defined here as: cosine
/// similarity (over the same NVIDIA embedding used for RAG retrieval above)
/// between the current assistant turn and the immediately preceding
/// ASSISTANT turn in the same conversation, at or above this threshold.
/// Comparing assistant-to-assistant (not assistant-to-user) deliberately:
/// the metric is meant to read the model's own turn-to-turn consistency,
/// and a user's message is a different speaker whose vocabulary shift isn't
/// a measure of that. 0.75 is a reasonable, tunable starting point — high
/// enough that a genuine topic change doesn't count as "stable", low enough
/// that ordinary paraphrase-level continuity does — chosen by engineering
/// judgment, NOT derived from the paper. Tune here if real production data
/// suggests a better cutoff.
const CCET_STABILITY_THRESHOLD: f32 = 0.75;

/// How many of the most recent turns (across ALL conversations — see
/// `ccet_summary`'s doc comment for why this is a global rather than a
/// per-conversation window) feed the live CEI/CEP/Resonance-Frequency
/// numbers. A rolling window, not an all-time aggregate, so the numbers
/// track recent behavior instead of being anchored forever by however the
/// very first conversations happened to go.
const CCET_WINDOW_TURNS: i64 = 200;

/// The established vocabulary this app already uses for ITSELF — not
/// invented for this feature. "Emergenz"/"Drift"/"Interaction Field" are
/// the exact terms `emergence.rs`'s own signal-detection prompt and
/// `SystemMap.tsx`'s own on-screen label already use; the tier names are
/// the exact Forschungsebene/Systemebene/technische-Ebene split
/// `SYSTEM_PROMPT` above already teaches the model. Matched lowercase,
/// substring, against assistant turn text only — see `shares_framework_term`
/// for why that measures the model carrying vocabulary forward, not merely
/// echoing what Laura just said.
const CCET_FRAMEWORK_TERMS: &[&str] = &[
    "emergenz",
    "drift",
    "interaction field",
    "co-evolution",
    "resonanz",
    "forschungsebene",
    "systemebene",
    "technische ebene",
];

fn framework_terms_in(text: &str) -> std::collections::HashSet<&'static str> {
    let lower = text.to_lowercase();
    CCET_FRAMEWORK_TERMS.iter().copied().filter(|term| lower.contains(term)).collect()
}

/// Resonance Frequency's per-turn primitive: does the CURRENT assistant
/// turn reuse at least one of this app's own established framework terms
/// that ALSO appeared in the immediately preceding assistant turn — i.e.
/// vocabulary the model is carrying forward on its own ("without
/// prompting"), rather than a term merely appearing once in isolation.
fn shares_framework_term(current: &str, previous: &str) -> bool {
    let current_terms = framework_terms_in(current);
    if current_terms.is_empty() {
        return false;
    }
    let previous_terms = framework_terms_in(previous);
    current_terms.intersection(&previous_terms).next().is_some()
}

fn is_stable_turn(similarity: f32) -> bool {
    similarity >= CCET_STABILITY_THRESHOLD
}

/// One assistant turn's contribution to the three metrics below — reduced
/// to exactly the booleans/optionals the pure computation functions need,
/// so they're testable with plain synthetic data and never need a DB or a
/// network call. Mirrors one row of the `ccet_turns` table.
#[derive(Clone, Copy, Debug, PartialEq)]
struct CcetTurn {
    /// This turn's own stability verdict (see `is_stable_turn`) — always
    /// `false` for the first turn of a conversation, which has no
    /// predecessor to be stable relative to.
    stable: bool,
    /// Whether the SPECIFIC previous turn this row was compared against was
    /// itself stable — `None` only for a conversation's first turn (no
    /// predecessor at all, not even an unstable one).
    prev_stable: Option<bool>,
    terms_reused: bool,
}

/// CEI = stable turns / total turns — the paper's own formula, applied here
/// over whatever window the caller passes in (`ccet_summary` uses
/// `CCET_WINDOW_TURNS`). Empty input reads as 0.0, not NaN.
fn compute_cei(turns: &[CcetTurn]) -> f32 {
    if turns.is_empty() {
        return 0.0;
    }
    let stable = turns.iter().filter(|t| t.stable).count();
    stable as f32 / turns.len() as f32
}

/// CEP — THIS PROJECT'S OWN definition; the paper never gives one (see the
/// module doc comment above), only ever a resulting number. Defined as a
/// cumulative count of "co-evolution points": one point per turn that is
/// itself stable AND whose specific predecessor was also stable — i.e. it
/// rewards a SUSTAINED run of stability (two stable turns in a row), rather
/// than just duplicating CEI's numerator (an isolated stable turn already
/// counts there). Chosen as the simplest defensible reading of "points"
/// that isn't a duplicate of CEI.
fn compute_cep(turns: &[CcetTurn]) -> u32 {
    turns.iter().filter(|t| t.stable && t.prev_stable == Some(true)).count() as u32
}

/// Resonance Frequency — THIS PROJECT'S OWN operationalization, though with
/// real (if qualitative) grounding in the paper: it repeatedly ties
/// "resonance" to terminology reuse and "Framework Adherence" across turns,
/// without ever giving those a formula either. Defined here as the rate,
/// across turns, at which the current turn reuses one of this app's own
/// established framework terms that also appeared in the immediately
/// preceding turn (see `shares_framework_term`) — i.e. how often the
/// model's own vocabulary carries forward turn-to-turn, unprompted.
fn compute_resonance_frequency(turns: &[CcetTurn]) -> f32 {
    if turns.is_empty() {
        return 0.0;
    }
    let reused = turns.iter().filter(|t| t.terms_reused).count();
    reused as f32 / turns.len() as f32
}

/// Fires once per completed exchange (see the spawn in `stream_chat`),
/// exactly like `emergence::analyze_recent_interactions` — an accepted
/// extra-NVIDIA-call-per-turn tradeoff for a background task that never
/// delays the visible reply. Embeds the current assistant turn, compares it
/// to the previous ASSISTANT turn in the same conversation (not whatever
/// user turn sits in between — see `CCET_STABILITY_THRESHOLD`'s doc
/// comment), and persists one `ccet_turns` row.
///
/// Returns the id of the row it inserted — `None` when it bailed out early
/// (no NVIDIA key configured, or an empty turn) or when the insert itself
/// failed. Consumed by the flight-recorder snapshot chained immediately
/// after this call in `stream_chat` (see `observatory::capture_system_snapshot`)
/// as `trigger_turn_id`: an honest, traceable link back to the specific
/// `ccet_turns` row a snapshot corresponds to, left `None` rather than
/// fabricated when there isn't one.
async fn record_ccet_turn(state: &AppState, conversation_id: &str, current_text: &str) -> Option<String> {
    if state.nvidia_api_key.is_empty() || current_text.trim().is_empty() {
        return None;
    }

    // The specific previous turn this one is compared against: the most
    // recently recorded ccet_turns row for this conversation (its stored
    // embedding + whether IT was stable) plus the matching previous
    // ASSISTANT message text (for the terminology-reuse check) — fetched
    // from chat_messages rather than duplicated into ccet_turns, since
    // chat_messages is already the durable copy of that text. Relies on the
    // caller (stream_chat) having already inserted the current turn's
    // chat_messages row before spawning this, so "the most recent assistant
    // message" here is the CURRENT turn and OFFSET 1 is the previous one.
    let prev_row: Option<(Vec<u8>, i64)> = sqlx::query_as(
        "SELECT embedding, stable FROM ccet_turns WHERE conversation_id = ?1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(conversation_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    // `, rowid DESC` tiebreak: created_at is second-granularity with no
    // other ordering guarantee (see the same fix on get_conversation's and
    // stream_chat's history-loading queries below) — without it, a
    // same-second sequence of messages (routine with edit-and-resend, which
    // deletes then reinserts within the same second) can make "the previous
    // assistant turn" ambiguous.
    let prev_assistant_text: Option<(String,)> = sqlx::query_as(
        "SELECT content FROM chat_messages WHERE conversation_id = ?1 AND role = 'assistant' ORDER BY created_at DESC, rowid DESC LIMIT 1 OFFSET 1",
    )
    .bind(conversation_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let current_embedding = match embed(state, current_text, "passage").await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("CCET embed failed for conversation {conversation_id}: {e}");
            return None;
        }
    };

    let (similarity, stable, prev_stable, terms_reused) = match (&prev_row, &prev_assistant_text) {
        (Some((prev_blob, prev_stable_int)), Some((prev_text,))) => {
            let prev_embedding = decode_embedding(prev_blob);
            let similarity = cosine(&current_embedding, &prev_embedding);
            let stable = is_stable_turn(similarity);
            let prev_stable = *prev_stable_int != 0;
            let terms_reused = shares_framework_term(current_text, prev_text);
            (Some(similarity), stable, Some(prev_stable), terms_reused)
        }
        // No previous turn recorded yet for this conversation — honest
        // first-turn handling: can't be "stable" or "reuse" anything
        // relative to a predecessor that doesn't exist.
        _ => (None, false, None, false),
    };

    let id = Uuid::new_v4().to_string();
    let result = sqlx::query(
        "INSERT INTO ccet_turns (id, conversation_id, embedding, similarity_to_prev, stable, prev_stable, terms_reused) VALUES (?1,?2,?3,?4,?5,?6,?7)",
    )
    .bind(&id)
    .bind(conversation_id)
    .bind(encode_embedding(&current_embedding))
    .bind(similarity.map(|s| s as f64))
    .bind(stable as i64)
    .bind(prev_stable.map(|b| b as i64))
    .bind(terms_reused as i64)
    .execute(&state.db)
    .await;

    result.ok().map(|_| id)
}

#[derive(Serialize)]
pub struct CcetSummary {
    cei: f32,
    cep: u32,
    resonance_frequency: f32,
    turns_considered: i64,
    stability_threshold: f32,
    /// Explicit, machine-readable echo of the disclosure the frontend also
    /// renders, so no future consumer of this endpoint can present these
    /// numbers as the paper's own verified formula either.
    definitions_note: &'static str,
}

/// Shared by `ccet_summary` below (the Emergence Monitor's live CEI/CEP/
/// Resonance-Frequency tiles) and `observatory::capture_system_snapshot`
/// (the flight-recorder rollup) — the exact same window query and pure-
/// function computation, extracted once so the snapshot can never silently
/// drift from what the live tile shows. Never re-embeds or re-calls NVIDIA:
/// reads only already-persisted `ccet_turns` rows, in particular whatever
/// `record_ccet_turn` just inserted when the caller awaits that first (as
/// `stream_chat`'s spawn does). Returns `(cei, cep, resonance_frequency,
/// turns_considered)`.
pub(crate) async fn current_ccet_metrics(db: &SqlitePool) -> (f32, u32, f32, i64) {
    let rows: Vec<(i64, Option<i64>, i64)> = sqlx::query_as(
        "SELECT stable, prev_stable, terms_reused FROM ccet_turns ORDER BY created_at DESC LIMIT ?1",
    )
    .bind(CCET_WINDOW_TURNS)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let turns: Vec<CcetTurn> = rows
        .into_iter()
        .map(|(stable, prev_stable, terms_reused)| CcetTurn {
            stable: stable != 0,
            prev_stable: prev_stable.map(|v| v != 0),
            terms_reused: terms_reused != 0,
        })
        .collect();

    (compute_cei(&turns), compute_cep(&turns), compute_resonance_frequency(&turns), turns.len() as i64)
}

/// Admin-authenticated: current CEI/CEP/Resonance-Frequency, computed over
/// the most recent `CCET_WINDOW_TURNS` assistant turns ACROSS ALL
/// conversations (a global rolling window), not one specific conversation.
/// This matches how the rest of the Emergence Observatory already works
/// (`emergence::list_signals` is one global feed, not scoped to whichever
/// conversation happens to be open) and is the simpler-to-implement-
/// correctly option the plan explicitly allowed for: a genuinely correct
/// PER-conversation live rollup would need the Observatory tab to know
/// which conversation is "current" outside of Forschung's own chat view,
/// which nothing here currently threads through.
pub async fn ccet_summary(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let (cei, cep, resonance_frequency, turns_considered) = current_ccet_metrics(&state.db).await;

    Json(CcetSummary {
        cei,
        cep,
        resonance_frequency,
        turns_considered,
        stability_threshold: CCET_STABILITY_THRESHOLD,
        definitions_note: "CEI folgt der Formel aus Lauras Paper (stable turns / total turns). \"Stable turn\", CEP und Resonance Frequency sind eigene Operationalisierungen dieses Projekts, nicht wörtlich aus dem Paper übernommen.",
    })
    .into_response()
}

// ── conversations CRUD ───────────────────────────────────────────────────────

#[derive(Serialize)]
struct ConversationOut {
    id: String,
    title: String,
    created_at: String,
    updated_at: String,
    /// 'chat' / 'agent' / 'digest' — see `CreateConversationReq::kind` and
    /// `digest::generate_digest`. Surfaced here (previously dropped after
    /// the WHERE filter) so the frontend can render a small visual
    /// distinguisher on Jarvis's own proactive digest entries — see
    /// ResearchChat.tsx — instead of them looking like a conversation Laura
    /// started herself.
    kind: String,
}

#[derive(Deserialize)]
pub struct ListConversationsQuery {
    kind: Option<String>,
    /// Sidebar search (Forschung conversation list, see ResearchChat.tsx):
    /// matches conversation TITLES as well as message CONTENT, since many
    /// conversations only ever get a generic auto-title (e.g. "hey" — see
    /// stream_chat's title-from-first-message logic above) and a user often
    /// remembers what was discussed, not what the chat happened to be named.
    /// Trimmed and treated as absent when empty, so `?q=` and `?q=%20`
    /// behave exactly like omitting the param entirely.
    q: Option<String>,
}

/// Escapes the SQL LIKE wildcard characters (`%`, `_`) that might be
/// literally present in a user's search term, plus the escape character
/// itself, so e.g. searching for "50%" or "some_thing" only ever matches
/// those literal characters instead of being (mis)interpreted as wildcards.
/// Paired with `LIKE ?2 ESCAPE '\'` at the call site below.
fn escape_like_pattern(term: &str) -> String {
    term.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
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

    // Proactive Jarvis digest (see digest.rs): a fixed-cadence catch-up
    // check, not a real scheduler — piggybacks on the one request the
    // Forschung sidebar already makes on every load. Gated to `kind ==
    // "chat"` specifically: that's the default/no-param case this endpoint
    // sees from ResearchChat.tsx's refreshConversations(), i.e. an actual
    // Forschung sidebar load, as opposed to e.g. the ambient Jarvis dock
    // explicitly requesting `kind=agent`. `.await`ed here only long enough
    // to run one indexed SELECT (`digest::digest_due`) — if a digest is
    // actually due, the real work (an aggregate-query round-trip plus one
    // NVIDIA call) is `tokio::spawn`'d inside `maybe_spawn_digest` and NOT
    // awaited, so a slow/cold NVIDIA candidate can never turn this routine
    // list fetch into the kind of stall the 2026-07-10 incident was about.
    // The digest simply isn't in the list on THIS load; it appears on the
    // next one.
    if kind == "chat" {
        let _ = crate::digest::maybe_spawn_digest(&state).await;
    }

    let search = q.q.as_deref().map(str::trim).filter(|s| !s.is_empty());

    // `kind = ?1 OR (?1 = 'chat' AND kind = 'digest')`: Jarvis's proactive
    // digest conversations (see digest.rs) always live under kind='digest',
    // but should visually surface INSIDE the Forschung sidebar (kind='chat'
    // requests) like any other conversation — see the module design note in
    // digest.rs for why this reuses chat storage instead of a parallel
    // notification surface. Any other explicit `?kind=` (e.g. the ambient
    // Jarvis dock's `agent`) is completely unaffected — the OR only ever
    // activates when ?1 is literally 'chat'.
    let result: Result<Vec<(String, String, String, String, String)>, sqlx::Error> = match search {
        Some(term) => {
            let pattern = format!("%{}%", escape_like_pattern(term));
            // LEFT JOIN + DISTINCT: a conversation with N matching messages
            // would otherwise come back N times. Matches on title OR any
            // joined message's content — see the struct doc comment above
            // for why both matter (generic auto-titles are common).
            sqlx::query_as(
                "SELECT DISTINCT c.id, c.title, c.created_at, c.updated_at, c.kind
                 FROM chat_conversations c
                 LEFT JOIN chat_messages m ON m.conversation_id = c.id
                 WHERE (c.kind = ?1 OR (?1 = 'chat' AND c.kind = 'digest'))
                   AND (c.title LIKE ?2 ESCAPE '\\' OR m.content LIKE ?2 ESCAPE '\\')
                 ORDER BY c.updated_at DESC",
            )
            .bind(&kind)
            .bind(&pattern)
            .fetch_all(&state.db)
            .await
        }
        None => sqlx::query_as(
            "SELECT id, title, created_at, updated_at, kind FROM chat_conversations
             WHERE kind = ?1 OR (?1 = 'chat' AND kind = 'digest')
             ORDER BY updated_at DESC",
        )
        .bind(&kind)
        .fetch_all(&state.db)
        .await,
    };
    // A transient DB failure (e.g. lock contention) must surface as a real
    // error, not silently degrade into "[]" — an empty-but-200 response is
    // indistinguishable from "genuinely no conversations" to the frontend,
    // which used to just overwrite the sidebar with it (see
    // refreshConversations() in ResearchChat.tsx, now fixed to leave the
    // existing list alone on a non-200 instead of trusting a fake-empty 200).
    let rows = match result {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!("list_conversations: DB query failed: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let out: Vec<ConversationOut> = rows
        .into_iter()
        .map(|(id, title, created_at, updated_at, kind)| ConversationOut { id, title, created_at, updated_at, kind })
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
    // `, rowid ASC` tiebreak: created_at is second-granularity with no other
    // ordering guarantee — a same-second delete-then-reinsert (exactly what
    // edit-and-resend does every time it's used, see delete_message_and_after
    // below) can otherwise produce ambiguous ordering for messages that land
    // in the same second.
    let result: Result<Vec<(String, String, String, Option<String>, String)>, sqlx::Error> = sqlx::query_as(
        "SELECT id, role, content, token_info, created_at FROM chat_messages WHERE conversation_id = ?1 ORDER BY created_at ASC, rowid ASC",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await;
    // Same fix as list_conversations above: a genuine DB failure must not be
    // indistinguishable from "this conversation has no messages" — that's
    // what let a real backend error silently wipe a conversation's history
    // on screen when openConversation() trusted a fake-empty 200.
    let rows = match result {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!("get_conversation({id}): DB query failed: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
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

/// Edit-and-resend's backend half: deletes one message and every message
/// after it (chronologically) in the same conversation — the frontend then
/// locally truncates its own `messages` state to before the edited message
/// and calls `send(editedText)` to continue from that point, exactly as if
/// everything after it had never been sent.
///
/// "After" is decided the same tie-broken way `get_conversation` and
/// `stream_chat`'s history load now order chat_messages (`created_at ASC,
/// rowid ASC`) — `created_at` alone is second-granularity with no other
/// guarantee, and edit-and-resend's own delete-then-reinsert cycle is
/// exactly the case that can land two messages in the same second. Anchoring
/// on the target message's own `(created_at, rowid)` pair and keeping
/// everything with a `(created_at, rowid)` at or after it (rather than a
/// bare `created_at >= ?`) means a same-second sibling BEFORE the target in
/// insertion order is correctly left alone.
///
/// Cleanup mirrors `delete_conversation` above, scoped down to just the
/// messages being removed instead of the whole conversation:
/// - `chat_chunks`: genuinely keyed per message (`source_type = 'message'`,
///   `source_id = <message id>`) — reuses `delete_conversation`'s exact
///   per-message DELETE for each removed id, so no stale RAG memory survives
///   for a message that no longer exists in the visible conversation.
/// - `chat_retrievals`: NOT keyed per message (no message-id column at all —
///   see `delete_conversation`'s own conversation-wide delete of it), but IS
///   timestamped, and exactly one row is logged at the very start of
///   processing the specific user message this cutoff anchors on (see
///   `stream_chat`'s `context_block` construction). Scoping this delete by
///   the same cutoff — rather than wiping the whole conversation's retrieval
///   history the way `delete_conversation` does — removes only the
///   retrievals tied to messages actually being deleted, leaving the
///   surviving prefix's own retrieval history intact.
/// - `agent_tool_calls`/`emergence_signals` are deliberately NOT touched
///   here: both are conversation-scoped only (no per-message or timestamp
///   correlation reliable enough to attribute a row to one specific
///   message), so trimming them here on a partial, same-conversation delete
///   would risk erasing history that still belongs to the surviving prefix —
///   unlike `delete_conversation`, which is safe to wipe both wholesale
///   because the entire conversation is going away anyway.
pub async fn delete_message_and_after(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((conversation_id, message_id)): Path<(String, String)>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let target: Option<(i64, String)> = sqlx::query_as(
        "SELECT rowid, created_at FROM chat_messages WHERE id = ?1 AND conversation_id = ?2",
    )
    .bind(&message_id)
    .bind(&conversation_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let Some((target_rowid, target_created_at)) = target else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let message_ids: Vec<(String,)> = sqlx::query_as(
        "SELECT id FROM chat_messages
         WHERE conversation_id = ?1
           AND (created_at > ?2 OR (created_at = ?2 AND rowid >= ?3))",
    )
    .bind(&conversation_id)
    .bind(&target_created_at)
    .bind(target_rowid)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    for (mid,) in &message_ids {
        let _ = sqlx::query("DELETE FROM chat_chunks WHERE source_type = 'message' AND source_id = ?1")
            .bind(mid)
            .execute(&state.db)
            .await;
    }

    let _ = sqlx::query("DELETE FROM chat_retrievals WHERE conversation_id = ?1 AND created_at >= ?2")
        .bind(&conversation_id)
        .bind(&target_created_at)
        .execute(&state.db)
        .await;

    let _ = sqlx::query(
        "DELETE FROM chat_messages
         WHERE conversation_id = ?1
           AND (created_at > ?2 OR (created_at = ?2 AND rowid >= ?3))",
    )
    .bind(&conversation_id)
    .bind(&target_created_at)
    .bind(target_rowid)
    .execute(&state.db)
    .await;

    let _ = sqlx::query("UPDATE chat_conversations SET updated_at = datetime('now') WHERE id = ?1")
        .bind(&conversation_id)
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
    /// Wired from the frontend's reasoning toggle (see ResearchChat.tsx).
    /// `None`/`Some(false)` (default, matches the toggle's default-off
    /// state): skip `deepseek-ai/deepseek-r1` in the candidate ladder
    /// entirely for this request. `Some(true)`: prioritize trying it FIRST,
    /// ahead of the cached-winner shortcut — see `build_model_ladder`.
    reasoning_requested: Option<bool>,
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

        // `, rowid ASC` tiebreak — see get_conversation's identical fix above
        // for why: created_at is second-granularity with no other ordering
        // guarantee, and edit-and-resend's delete-then-reinsert cycle
        // (delete_message_and_after) can land two messages in the same
        // second. `interrupted` feeds the synthetic note injected below.
        let history: Vec<(String, String, i64)> = sqlx::query_as(
            "SELECT role, content, interrupted FROM chat_messages WHERE conversation_id = ?1 ORDER BY created_at ASC, rowid ASC",
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
        for (role, content, interrupted) in &history {
            // A turn saved via the "LKS" kill-switch (see
            // save_interrupted_message) was deliberately cut off mid-stream
            // by the user, not a normal completed reply — surface that
            // honestly in the model's own context instead of just storing
            // the flag and never acting on it, so the model doesn't mistake
            // a truncated sentence for its own finished thought.
            let content = if *interrupted != 0 {
                format!("{content}\n\n[Hinweis: diese Antwort wurde von Laura mitten im Streamen unterbrochen — sie ist absichtlich unvollständig, nicht fertig gedacht.]")
            } else {
                content.clone()
            };
            messages.push(json!({ "role": role, "content": content }));
        }

        let mut final_full_text = String::new();
        let mut final_tokens: Vec<serde_json::Value> = Vec::new();

        // Model-selection setup (Fix 1 + Fix 2, 2026-07-10): reasoning_requested
        // comes straight from the frontend toggle; cached_idx/force_top
        // determine where THIS exchange's ladder starts (see
        // build_model_ladder's doc comment for the full picture). request_no
        // is a server-wide counter (not per-conversation — the ladder
        // reflects account entitlement, which doesn't vary per conversation).
        let reasoning_requested = body.reasoning_requested.unwrap_or(false);
        let request_no = state.chat_request_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let force_top = request_no % CHAT_MODEL_RETRY_FROM_TOP_EVERY == 0;
        let cached_idx = state.chat_model_idx.load(std::sync::atomic::Ordering::Relaxed);
        // Write the incremented counter through to the durable DB immediately
        // (not just the in-memory atomic) — see chat_model_state's doc
        // comment. Without this, a cold restart (this app scales to zero
        // between almost every message per fly.toml) would reset the count
        // to 0 and re-land on a force_top slot on literally every restart,
        // defeating the cache above even with the index itself persisted.
        persist_model_state(&state.db, cached_idx, request_no + 1).await;
        let ladder = build_model_ladder(reasoning_requested, cached_idx, force_top);
        // Position into `ladder` (not directly into CHAT_MODEL_CANDIDATES).
        // Sticky across rounds within one exchange: whichever candidate
        // first succeeds is reused for every later round of the same
        // exchange (tool-calling can take several rounds); once a candidate
        // fails it's never retried within this exchange, so we only ever
        // move forward through `ladder`, never back.
        let mut ladder_pos: usize = 0;
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

            // Try candidates in `ladder` order starting from wherever this
            // exchange is currently stuck (ladder_pos), advancing on failure
            // — network error or non-2xx alike — until one succeeds or we've
            // exhausted the ladder down to its final entry, which we always
            // accept the result of (success or not) since there's nothing
            // left to fall back to.
            let (res, used_model) = loop {
                let model = CHAT_MODEL_CANDIDATES[ladder[ladder_pos]];
                // Bounded by `NVIDIA_CONNECT_TIMEOUT` (see its doc comment):
                // this is THE fix for the 2026-07-10 "total silence" incident
                // — a candidate that accepts the connection and then never
                // responds at all (as opposed to erroring, which the `ok`
                // check below already falls back from correctly) used to hang
                // this `.await` forever, so this loop — and the whole SSE
                // stream — never produced a single byte for the client.
                // Collapsing both a real `reqwest::Error` and a timeout into
                // the same `Result<_, String>` shape here (rather than
                // threading `Elapsed` through separately) keeps every
                // downstream check (`ok`, the `Err(e)` arm below) unchanged.
                let attempt: Result<reqwest::Response, String> = match tokio::time::timeout(
                    state.nvidia_connect_timeout,
                    state
                        .http
                        .post(format!("{}/v1/chat/completions", state.nvidia_api_base))
                        .bearer_auth(&state.nvidia_api_key)
                        .json(&build_body(model))
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
                let ok = matches!(&attempt, Ok(r) if r.status().is_success());
                if ok || ladder_pos + 1 >= ladder.len() {
                    break (attempt, model);
                }
                let next = CHAT_MODEL_CANDIDATES[ladder[ladder_pos + 1]];
                tracing::warn!("model {model} unavailable/failed, falling back to {next}");
                ladder_pos += 1;
            };
            if matches!(&res, Ok(r) if r.status().is_success()) {
                tracing::info!("chat round served by model {used_model}");
            }
            // Persist the resolved ladder position back to the shared,
            // request-spanning cache (AppState::chat_model_idx) so the NEXT
            // ordinary (non-reasoning) message starts here instead of
            // re-discovering it from scratch — the actual fix for "inference
            // time is very long". Guarded to non-reasoning traffic only: a
            // reasoning-toggle request intentionally tries
            // deepseek-ai/deepseek-r1 first regardless of the cache (see
            // build_model_ladder), and persisting that special-cased
            // position would wrongly make future ordinary messages skip past
            // untried, possibly-better non-reasoning candidates the
            // steady-state cache hadn't reached yet.
            if !reasoning_requested {
                let resolved_idx = ladder[ladder_pos];
                state.chat_model_idx.store(resolved_idx, std::sync::atomic::Ordering::Relaxed);
                // Same write-through as the counter above: the whole point of
                // this fix is that the NEXT request — quite possibly served
                // by a freshly cold-started machine — must see this resolved
                // index, not the one that was true when this request started.
                persist_model_state(&state.db, resolved_idx, request_no + 1).await;
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

            // Companion guard to the connect-timeout above (see
            // `NVIDIA_STREAM_STALL_TIMEOUT`'s doc comment): a candidate that
            // answers normally at first and then goes silent mid-reply —
            // no more bytes, no close, ever — is the exact same "hung
            // `.await`, zero client-visible output" failure one level
            // deeper. Whatever was already streamed before the stall stays
            // sent (nothing already forwarded is lost), and the round is
            // finalized the same way a clean end-of-stream is, rather than
            // leaving the SSE response open and silent forever.
            loop {
                let chunk = match tokio::time::timeout(NVIDIA_STREAM_STALL_TIMEOUT, byte_stream.next()).await {
                    Ok(Some(c)) => c,
                    Ok(None) => break,
                    Err(_) => {
                        tracing::error!("NVIDIA stream stalled: no data for {NVIDIA_STREAM_STALL_TIMEOUT:?}, ending round");
                        break;
                    }
                };
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

        // CCET (Continuous Co-Evolution Tracker) instrumentation — same
        // background-task pattern as the emergence-signal spawn just above
        // (an accepted extra-NVIDIA-call-per-turn tradeoff, never on the
        // reply's critical path). See the CCET section above the
        // "conversations CRUD" marker for what's this project's own
        // operationalization vs. the paper's actual formula.
        //
        // Flight recorder (`system_snapshots`): chained immediately after,
        // INSIDE the same spawned task — not a second `tokio::spawn` — so it
        // rides the exact same fire-and-forget guarantee record_ccet_turn
        // already has. Both run strictly after the "done" SSE event's
        // precursor work is queued below (`tokio::spawn` returns instantly
        // without polling the future at all), so neither can ever add
        // latency to, or fail, the visible reply — see
        // `observatory::capture_system_snapshot`'s own doc comment for the
        // best-effort contract this depends on, and the module doc comment
        // at the top of this file for why that guarantee matters here in
        // particular (the 2026-07-10 production outage).
        let ccet_state = state.clone();
        let ccet_conv_id = conversation_id.clone();
        let ccet_text = final_full_text.clone();
        tokio::spawn(async move {
            let trigger_turn_id = record_ccet_turn(&ccet_state, &ccet_conv_id, &ccet_text).await;
            crate::observatory::capture_system_snapshot(&ccet_state, &ccet_conv_id, trigger_turn_id).await;
        });

        yield Ok(Event::default().event("done").data("[DONE]"));
    };

    Sse::new(stream).keep_alive(KeepAlive::default()).into_response()
}

#[derive(Deserialize)]
pub struct InterruptedMessageReq {
    content: String,
}

/// The "LKS" kill-switch's backend half: durably saves whatever text the
/// client had already accumulated from a streaming reply at the moment the
/// user clicked stop, as a normal `role='assistant'` row — bypassing the
/// NVIDIA round-trip entirely, same manual-INSERT pattern `stream_chat`'s own
/// end-of-block persist above uses — except `interrupted = 1`.
///
/// Deliberately a SEPARATE, explicit signal from the client (not inferred
/// from the SSE connection merely dropping): an aborted `fetch` looks
/// identical on the wire whether the user clicked stop or their wifi died,
/// and only the former should durably persist a partial reply and tell the
/// model, honestly, that it was cut off — see the `interrupted`-note
/// injection in `stream_chat`'s history load above for the other half of
/// that contract.
pub async fn save_interrupted_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<InterruptedMessageReq>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let content = body.content.trim().to_string();
    if content.is_empty() {
        // Nothing was ever streamed before the user hit stop (e.g. they
        // clicked it the instant they sent) — nothing meaningful to persist.
        return (StatusCode::BAD_REQUEST, "Kein Text zum Speichern vorhanden.").into_response();
    }

    let assistant_id = Uuid::new_v4().to_string();
    let _ = sqlx::query(
        "INSERT INTO chat_messages (id, conversation_id, role, content, interrupted) VALUES (?1,?2,'assistant',?3,1)",
    )
    .bind(&assistant_id)
    .bind(&id)
    .bind(&content)
    .execute(&state.db)
    .await;
    let _ = sqlx::query("UPDATE chat_conversations SET updated_at = datetime('now') WHERE id = ?1")
        .bind(&id)
        .execute(&state.db)
        .await;

    Json(json!({ "id": assistant_id })).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::{Query as AxQuery, State as AxState};
    use axum::{routing::post as axpost, Json as AxJson, Router};
    use std::{
        collections::HashMap,
        path::PathBuf,
        sync::{Arc, RwLock},
    };

    /// Same in-memory-sqlite fixture pattern as billing.rs/agent.rs's own
    /// `test_state` helpers — a fresh, schema-initialized DB per test, no
    /// network, no real NVIDIA/Stripe/DuckDuckGo credentials needed. Auth is
    /// a no-op here (`chat_secret` empty — see `authz::require_admin`), so
    /// tests can call `list_conversations` directly with a bare `HeaderMap`.
    async fn test_state() -> AppState {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
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
            nvidia_connect_timeout: crate::chat::NVIDIA_CONNECT_TIMEOUT,
            chat_secret: String::new(),
            stripe_secret_key: String::new(),
            stripe_api_base: "https://api.stripe.com".to_string(),
            stripe_webhook_secret: String::new(),
            ddg_api_base: "https://api.duckduckgo.com".to_string(),
            github_token: String::new(),
            github_api_base: "https://api.github.com".to_string(),
            chat_model_idx: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            chat_request_count: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }
    }

    /// Inserts a conversation with the given title, plus one user message
    /// with the given content, directly via SQL — a minimal stand-in for a
    /// real exchange (stream_chat itself has NVIDIA-dependent side effects
    /// well beyond what these search tests need to exercise).
    async fn seed_conversation(state: &AppState, id: &str, title: &str, message_content: &str) {
        sqlx::query("INSERT INTO chat_conversations (id, title, kind) VALUES (?1, ?2, 'chat')")
            .bind(id)
            .bind(title)
            .execute(&state.db)
            .await
            .unwrap();
        if !message_content.is_empty() {
            sqlx::query("INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?1, ?2, 'user', ?3)")
                .bind(format!("{id}-msg"))
                .bind(id)
                .bind(message_content)
                .execute(&state.db)
                .await
                .unwrap();
        }
    }

    async fn list_ids(state: &AppState, q: Option<&str>) -> Vec<String> {
        let query = ListConversationsQuery { kind: None, q: q.map(str::to_string) };
        let res = list_conversations(AxState(state.clone()), HeaderMap::new(), AxQuery(query))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let parsed: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        parsed.into_iter().map(|v| v["id"].as_str().unwrap().to_string()).collect()
    }

    /// Core case #1: a search term that only appears in a conversation's
    /// TITLE (not any message content) still finds it — e.g. Laura
    /// remembering how she named a chat rather than what was said in it.
    #[tokio::test]
    async fn search_matches_conversation_title() {
        let state = test_state().await;
        seed_conversation(&state, "conv-title-match", "Gedanken zu Emergenz", "irrelevanter Inhalt").await;
        seed_conversation(&state, "conv-other", "hey", "auch nichts Passendes").await;

        let ids = list_ids(&state, Some("Emergenz")).await;
        assert_eq!(ids, vec!["conv-title-match"]);
    }

    /// Core case #2: a search term that ONLY appears in message content —
    /// not in the title at all (the common case for a generically-titled
    /// "hey"/"hey jarvis wie gehts" conversation) — must still surface it.
    /// This is the whole point of joining chat_messages instead of only
    /// searching chat_conversations.title.
    #[tokio::test]
    async fn search_matches_message_content_even_with_generic_title() {
        let state = test_state().await;
        seed_conversation(&state, "conv-content-match", "hey", "lass uns über sparseskip und TIS reden").await;
        seed_conversation(&state, "conv-other", "hey jarvis wie gehts", "ganz anderes Thema").await;

        let ids = list_ids(&state, Some("sparseskip")).await;
        assert_eq!(ids, vec!["conv-content-match"]);
    }

    /// Core case #3: a search term matching nothing (title or content)
    /// returns an empty list, not an error and not every conversation.
    #[tokio::test]
    async fn search_with_no_match_returns_empty() {
        let state = test_state().await;
        seed_conversation(&state, "conv-a", "hey", "irgendein Gespräch").await;
        seed_conversation(&state, "conv-b", "noch eins", "und noch ein Inhalt").await;

        let ids = list_ids(&state, Some("dieser-begriff-kommt-nirgendwo-vor")).await;
        assert!(ids.is_empty());
    }

    /// A conversation with a matching title but ALSO multiple matching
    /// messages must appear exactly once — regression guard for the
    /// LEFT JOIN fan-out the DISTINCT in the query exists to collapse.
    #[tokio::test]
    async fn search_deduplicates_conversations_with_multiple_matching_messages() {
        let state = test_state().await;
        seed_conversation(&state, "conv-multi", "Emergenz-Thread", "erste Emergenz Erwähnung").await;
        sqlx::query("INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?1, ?2, 'assistant', ?3)")
            .bind("conv-multi-msg2")
            .bind("conv-multi")
            .bind("zweite Emergenz Erwähnung")
            .execute(&state.db)
            .await
            .unwrap();

        let ids = list_ids(&state, Some("Emergenz")).await;
        assert_eq!(ids, vec!["conv-multi"]);
    }

    /// No `q` at all (the pre-existing behavior) must still return
    /// everything, unaffected by the new search branch.
    #[tokio::test]
    async fn absent_search_term_returns_all_conversations_unfiltered() {
        let state = test_state().await;
        seed_conversation(&state, "conv-a", "erstes", "irgendwas").await;
        seed_conversation(&state, "conv-b", "zweites", "irgendwas anderes").await;

        let ids = list_ids(&state, None).await;
        assert_eq!(ids.len(), 2);
    }

    /// A search term consisting only of whitespace must behave exactly like
    /// no search term at all (see `list_conversations`' `.filter(|s|
    /// !s.is_empty())` after trimming), not silently match nothing (an
    /// empty-string LIKE '%%' pattern would actually match everything, but
    /// relying on that would be an accident, not a design — this locks in
    /// the trim-then-treat-as-absent behavior explicitly).
    #[tokio::test]
    async fn whitespace_only_search_term_behaves_like_no_search() {
        let state = test_state().await;
        seed_conversation(&state, "conv-a", "erstes", "irgendwas").await;
        seed_conversation(&state, "conv-b", "zweites", "irgendwas anderes").await;

        let ids = list_ids(&state, Some("   ")).await;
        assert_eq!(ids.len(), 2);
    }

    /// Search terms containing a literal SQL LIKE wildcard character (`%`)
    /// must be treated literally, not as a wildcard — see
    /// `escape_like_pattern`. Without escaping, searching for "50%" would
    /// behave like searching for "50" followed by "anything".
    #[tokio::test]
    async fn search_term_with_percent_sign_is_treated_literally() {
        let state = test_state().await;
        seed_conversation(&state, "conv-percent", "Rabatt 50% Frage", "egal").await;
        seed_conversation(&state, "conv-other", "Rabatt 5000 Frage", "auch egal").await;

        let ids = list_ids(&state, Some("50%")).await;
        assert_eq!(ids, vec!["conv-percent"], "literal '%' must not act as a wildcard matching '5000' too");
    }

    /// The bug: a genuine DB failure (lock contention, corruption, etc.) used
    /// to be swallowed by `.unwrap_or_default()` into a fake-empty `200 []`
    /// — indistinguishable from "this user genuinely has zero conversations"
    /// to the frontend, which is exactly what made conversations
    /// intermittently vanish from the Forschung sidebar. Dropping the table
    /// the query depends on forces a real `sqlx::Error` deterministically
    /// (no need to race actual lock contention) — the fix must surface it as
    /// a real 500, not silently degrade.
    #[tokio::test]
    async fn list_conversations_returns_500_on_genuine_db_error_not_fake_empty_200() {
        let state = test_state().await;
        seed_conversation(&state, "conv-a", "wird nie gesehen", "irgendwas").await;
        sqlx::query("DROP TABLE chat_conversations").execute(&state.db).await.unwrap();

        let query = ListConversationsQuery { kind: None, q: None };
        let res = list_conversations(AxState(state.clone()), HeaderMap::new(), AxQuery(query))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR, "a genuine DB error must not come back as 200 []");
    }

    /// Jarvis's proactive digest (see digest.rs) lives under `kind =
    /// 'digest'` but must surface INSIDE the Forschung sidebar's default
    /// (`kind == "chat"`, i.e. no `?kind=` param at all) query, exactly
    /// like any conversation Laura started herself — see
    /// `list_conversations`' merged `kind = ?1 OR (?1 = 'chat' AND kind =
    /// 'digest')` WHERE clause. The ambient Jarvis dock's own `kind =
    /// 'agent'` conversations must stay excluded from that same query — the
    /// merge is deliberately one-directional (digest into chat), not a
    /// blanket "show everything."
    #[tokio::test]
    async fn digest_conversation_surfaces_in_default_chat_kind_query_but_agent_kind_does_not() {
        let state = test_state().await;
        sqlx::query("INSERT INTO chat_conversations (id, title, kind) VALUES ('d1', 'Wochenrückblick', 'digest')")
            .execute(&state.db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO chat_conversations (id, title, kind) VALUES ('c1', 'normaler Chat', 'chat')")
            .execute(&state.db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO chat_conversations (id, title, kind) VALUES ('a1', 'ambient dock', 'agent')")
            .execute(&state.db)
            .await
            .unwrap();

        let ids = list_ids(&state, None).await;
        assert!(ids.contains(&"d1".to_string()), "digest conversation must appear in the default Forschung sidebar query: {ids:?}");
        assert!(ids.contains(&"c1".to_string()));
        assert!(!ids.contains(&"a1".to_string()), "the ambient agent dock's own conversations must stay out: {ids:?}");

        // And explicitly requesting `kind=agent` must still only return the
        // agent-dock conversation — the merge only ever activates for the
        // literal 'chat' request, never leaks into other explicit kinds.
        let query = ListConversationsQuery { kind: Some("agent".to_string()), q: None };
        let res = list_conversations(AxState(state.clone()), HeaderMap::new(), AxQuery(query))
            .await
            .into_response();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let parsed: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        let agent_ids: Vec<String> = parsed.into_iter().map(|v| v["id"].as_str().unwrap().to_string()).collect();
        assert_eq!(agent_ids, vec!["a1".to_string()]);
    }

    /// Same fix, same technique, for `get_conversation` — a DB failure while
    /// loading a conversation's messages must not read as "this conversation
    /// has no messages" (which would silently blank out an open chat).
    #[tokio::test]
    async fn get_conversation_returns_500_on_genuine_db_error_not_fake_empty_200() {
        let state = test_state().await;
        seed_conversation(&state, "conv-a", "wird nie gesehen", "irgendwas").await;
        sqlx::query("DROP TABLE chat_messages").execute(&state.db).await.unwrap();

        let res = get_conversation(AxState(state.clone()), HeaderMap::new(), Path("conv-a".to_string()))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR, "a genuine DB error must not come back as 200 []");
    }

    /// Guards the happy path didn't regress alongside the error-handling
    /// change above: a normal, healthy query still returns 200 with the
    /// real data.
    #[tokio::test]
    async fn get_conversation_still_returns_200_with_messages_on_success() {
        let state = test_state().await;
        seed_conversation(&state, "conv-a", "titel", "hallo welt").await;

        let res = get_conversation(AxState(state.clone()), HeaderMap::new(), Path("conv-a".to_string()))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let messages: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["content"], "hallo welt");
    }

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

    // ── model-selection ladder (2026-07-10 fix) ─────────────────────────

    fn deepseek_idx() -> usize {
        CHAT_MODEL_CANDIDATES.iter().position(|&m| m == "deepseek-ai/deepseek-r1").unwrap()
    }

    /// The regression this fix exists for: `stream_chat` used to always
    /// start a fresh HTTP request's ladder at index 0, re-paying however
    /// many front candidates weren't entitled on the account as a failed
    /// round-trip on EVERY message — "inference time is very long". This is
    /// the same scenario end to end: a first request discovers (via
    /// AppState::chat_model_idx, mimicked here by a plain cached_idx value)
    /// that index 3 is the real winner; a second, later request must start
    /// there directly, not restart the search at 0.
    #[test]
    fn second_request_reuses_cached_index_instead_of_restarting_at_zero() {
        // First request: as if the ladder walked forward to index 3 and
        // that got persisted (mirrors `state.chat_model_idx.store(...)`).
        let cached_idx_after_first_request = 3usize;

        // Second request, ordinary (no reasoning toggle), not a periodic
        // retry-from-top slot.
        let ladder = build_model_ladder(false, cached_idx_after_first_request, false);

        assert_eq!(
            ladder.first().copied(),
            Some(3),
            "must start from the cached index, not restart the discovery walk at 0"
        );
        assert!(!ladder.contains(&0) && !ladder.contains(&1), "must not re-try earlier candidates already known to have failed");
    }

    /// A totally fresh cache (no previous request yet, index 0) still walks
    /// the full ladder top to bottom — the fix must not break the very
    /// first request's discovery behavior.
    #[test]
    fn first_ever_request_starts_at_index_zero() {
        let ladder = build_model_ladder(false, 0, false);
        assert_eq!(ladder, vec![0, 1, 2, 3, 5, 6], "deepseek's slot (4) must be excluded on the default, non-reasoning path");
    }

    /// CHAT_MODEL_RETRY_FROM_TOP_EVERY's mechanism: even with a cached index
    /// deep into the ladder, a request landing on a periodic retry slot
    /// ignores the cache and re-walks from the top — otherwise a bigger
    /// model that becomes newly entitled on the account would stay
    /// undiscovered forever.
    #[test]
    fn periodic_retry_slot_ignores_the_cache_and_restarts_at_zero() {
        let ladder = build_model_ladder(false, 5, true);
        assert_eq!(ladder, vec![0, 1, 2, 3, 5, 6]);
    }

    /// Fix 2's core behavior: with the reasoning toggle ON, the
    /// reasoning-capable candidate is tried FIRST, ahead of the cached
    /// shortcut entirely — even when the cache points somewhere else deep in
    /// the ladder, and even on a request that would NOT otherwise be a
    /// periodic retry-from-top slot.
    #[test]
    fn reasoning_requested_tries_deepseek_first_ahead_of_the_cache() {
        let ladder = build_model_ladder(true, 5, false);
        assert_eq!(
            ladder.first().copied(),
            Some(deepseek_idx()),
            "reasoning toggle must override the cached-winner shortcut"
        );
        // Falls through the rest of the ladder in its normal relative order
        // if deepseek-r1 isn't entitled, rather than stopping there.
        assert_eq!(ladder, vec![deepseek_idx(), 0, 1, 2, 3, 5, 6]);
    }

    /// The toggle-OFF counterpart (the default): deepseek-r1 must never
    /// appear in the ladder at all, so a non-reasoning-capable-account
    /// never pays for a doomed attempt against it on an ordinary message.
    #[test]
    fn reasoning_not_requested_never_includes_deepseek_in_the_ladder() {
        for cached in 0..CHAT_MODEL_CANDIDATES.len() {
            let ladder = build_model_ladder(false, cached, false);
            assert!(!ladder.contains(&deepseek_idx()), "cached_idx={cached}: deepseek-r1 leaked into the non-reasoning ladder");
        }
    }

    /// `StreamChatReq::reasoning_requested` wiring: absent (older client /
    /// toggle never touched) and explicit `false` (toggle off, the UI's
    /// default) must both behave as "not requested" — reasoning is opt-in,
    /// never silently assumed.
    #[test]
    fn reasoning_requested_field_defaults_to_false_when_absent() {
        let with_field_absent: StreamChatReq =
            serde_json::from_value(json!({ "conversation_id": "c1", "message": "hi" })).unwrap();
        assert_eq!(with_field_absent.reasoning_requested.unwrap_or(false), false);

        let with_field_false: StreamChatReq = serde_json::from_value(
            json!({ "conversation_id": "c1", "message": "hi", "reasoning_requested": false }),
        )
        .unwrap();
        assert_eq!(with_field_false.reasoning_requested.unwrap_or(false), false);

        let with_field_true: StreamChatReq = serde_json::from_value(
            json!({ "conversation_id": "c1", "message": "hi", "reasoning_requested": true }),
        )
        .unwrap();
        assert_eq!(with_field_true.reasoning_requested.unwrap_or(false), true);
    }

    // ── durable model-ladder state (2026-07-10 follow-up fix) ───────────
    //
    // PR #30's in-memory Arc<AtomicUsize>/Arc<AtomicU64> cache does nothing
    // for a low-traffic site behind fly.toml's
    // auto_stop_machines/min_machines_running=0: the app scales to zero
    // between almost every message and cold-starts fresh on the next one,
    // wiping the cache back to 0/0 and re-paying the full failed-ladder-probe
    // latency on nearly every message — same as before PR #30 existed. These
    // tests drive load_model_state/persist_model_state directly against an
    // in-memory SQLite DB (the same pattern agent.rs's tests use), standing
    // in for the durable `eil_data` volume in production.
    //
    // (HashMap/PathBuf/Arc already brought into scope by this module's
    // earlier `use std::{...}` — see the search-tests' test_state() fixture
    // above — so no re-import here; would otherwise be an E0252 conflict.)

    /// True first boot ever: nothing has been persisted yet, so both values
    /// default to 0 — the one case where this fix's behavior matches the old
    /// (buggy) always-0 behavior, because there's genuinely nothing to load.
    #[tokio::test]
    async fn model_state_defaults_to_zero_on_true_first_boot() {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        init_schema(&db).await;

        let (idx, count) = load_model_state(&db).await;
        assert_eq!(idx, 0);
        assert_eq!(count, 0);
    }

    /// (a) The regression this fix exists for: a cold restart must load
    /// whatever a previous process discovered and persisted, not silently
    /// reset to index 0 the way an in-memory-only AtomicUsize does. Mirrors
    /// exactly what `main` does at startup — call `load_model_state` against
    /// the DB and seed a fresh `AppState`'s atomics from the result.
    #[tokio::test]
    async fn cold_restart_seeds_fresh_appstate_from_persisted_index_not_zero() {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        init_schema(&db).await;

        // A previous process's stream_chat discovered index 3 was the real
        // winner (e.g. the 405b/70b candidates aren't entitled, but
        // deepseek-r1's slot is skipped and llama-3.1-70b at index 3 works)
        // and wrote it through before the machine scaled to zero.
        persist_model_state(&db, 3, 17).await;

        // "Cold restart": build a brand new AppState the same way `main`
        // does — seeded from load_model_state, not AtomicUsize::new(0).
        let (seeded_idx, seeded_count) = load_model_state(&db).await;
        let state = AppState {
            sessions: Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
            content_path: PathBuf::from("content.json"),
            uploads_dir: PathBuf::from("uploads"),
            static_dir: PathBuf::from("dist"),
            allowed_email: String::new(),
            google_client_id: String::new(),
            google_client_secret: String::new(),
            redirect_uri: String::new(),
            dev_mode: true,
            db: db.clone(),
            http: reqwest::Client::new(),
            nvidia_api_key: String::new(),
            nvidia_api_base: "https://integrate.api.nvidia.com".to_string(),
            nvidia_connect_timeout: crate::chat::NVIDIA_CONNECT_TIMEOUT,
            chat_secret: String::new(),
            stripe_secret_key: String::new(),
            stripe_api_base: "https://api.stripe.com".to_string(),
            stripe_webhook_secret: String::new(),
            ddg_api_base: "http://127.0.0.1:1".to_string(),
            github_token: String::new(),
            github_api_base: "https://api.github.com".to_string(),
            chat_model_idx: Arc::new(std::sync::atomic::AtomicUsize::new(seeded_idx)),
            chat_request_count: Arc::new(std::sync::atomic::AtomicU64::new(seeded_count)),
        };

        assert_eq!(
            state.chat_model_idx.load(std::sync::atomic::Ordering::Relaxed),
            3,
            "fresh AppState must be seeded from the DB, not default to 0 on a cold restart"
        );
        assert_eq!(state.chat_request_count.load(std::sync::atomic::Ordering::Relaxed), 17);
    }

    /// (b) An update actually persists to the DB — not just the in-memory
    /// atomic — and a second update overwrites the same singleton row rather
    /// than accumulating extra rows (the whole point of the `id INTEGER
    /// PRIMARY KEY CHECK (id = 1)` + `ON CONFLICT` upsert).
    #[tokio::test]
    async fn updated_index_persists_to_the_db_and_would_survive_a_restart() {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        init_schema(&db).await;

        let (idx0, count0) = load_model_state(&db).await;
        assert_eq!((idx0, count0), (0, 0));

        // Mirrors stream_chat's write-through when the ladder resolves to a
        // new index.
        persist_model_state(&db, 2, 1).await;

        // A brand new load — as a freshly restarted process would issue —
        // must see the update, proving it actually reached the DB.
        let (idx1, count1) = load_model_state(&db).await;
        assert_eq!(idx1, 2, "update must have reached the DB, not only an in-memory atomic");
        assert_eq!(count1, 1);

        // A later update (e.g. the periodic retry-from-top discovering a
        // still-better candidate) overwrites in place.
        persist_model_state(&db, 4, 21).await;
        let (idx2, count2) = load_model_state(&db).await;
        assert_eq!(idx2, 4);
        assert_eq!(count2, 21);

        let row_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_model_state")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(row_count.0, 1, "must stay a singleton row, not insert a new one per update");
    }

    /// (c) The periodic-retry-from-top counter (CHAT_MODEL_RETRY_FROM_TOP_EVERY)
    /// must keep counting across a simulated restart, continuing the SAME
    /// server-wide count instead of restarting at 0 — otherwise (this is the
    /// second half of the bug the DB-persistence fix closes, not just the
    /// index) every cold start would land request_no=0 and force_top=true on
    /// literally every single request post-restart, re-walking the whole
    /// ladder from scratch every time regardless of how well the index cache
    /// itself is persisted.
    #[tokio::test]
    async fn periodic_retry_counter_continues_across_a_simulated_restart() {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        init_schema(&db).await;

        // Process A: 20 requests already served since boot, cached index
        // settled at 3 — both persisted right before the machine scales to
        // zero. (fetch_add returns the PRE-increment value, so the Nth
        // absolute request server-wide has request_no == N-1 — a persisted
        // count of 20 means the next fetch_add returns old value 20, landing
        // exactly on the request_no % 20 == 0 boundary.)
        persist_model_state(&db, 3, 20).await;

        // Process B ("cold restart"): seeds in-memory atomics from the DB,
        // exactly like `main` does at startup.
        let (seeded_idx, seeded_count) = load_model_state(&db).await;
        let model_idx = std::sync::atomic::AtomicUsize::new(seeded_idx);
        let request_count = std::sync::atomic::AtomicU64::new(seeded_count);

        // Request #21 server-wide (request_no == 20) correctly lands on the
        // periodic retry-from-top slot, continuing the count that started
        // before the restart — not a fresh "request 0 of this process" that
        // would force_top on every single cold start.
        let request_no = request_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let force_top = request_no % CHAT_MODEL_RETRY_FROM_TOP_EVERY == 0;
        assert_eq!(request_no, 20);
        assert!(force_top, "request #21 server-wide must still land on the periodic retry slot after a restart");

        let cached_idx = model_idx.load(std::sync::atomic::Ordering::Relaxed);
        assert_eq!(cached_idx, 3, "the previously-discovered winner must have survived the restart too");
        let ladder = build_model_ladder(false, cached_idx, force_top);
        assert_eq!(ladder, vec![0, 1, 2, 3, 5, 6], "the periodic slot re-walks from the top even though the cache says 3");

        // The NEXT request (#22) is back to normal: reuses the cache
        // directly, rather than forcing another re-walk the way a
        // reset-to-zero-every-restart counter would on every request.
        let request_no2 = request_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let force_top2 = request_no2 % CHAT_MODEL_RETRY_FROM_TOP_EVERY == 0;
        assert_eq!(request_no2, 21);
        assert!(!force_top2, "the request right after the periodic slot must not also force_top");
        let ladder2 = build_model_ladder(false, cached_idx, force_top2);
        assert_eq!(ladder2.first().copied(), Some(3), "must resume reusing the cached winner, not re-walk again");
    }

    // ── NVIDIA request hang guard (2026-07-10 incident fix) ─────────────
    //
    // Regression for the production incident: a message sent to the
    // deployed Forschung chat got NOTHING back at all — not slow, not an
    // error, total silence. Reproduced live against a real running server
    // (see the investigation) with a mock NVIDIA endpoint that accepts the
    // connection and then never responds — `.send().await` never resolved,
    // so `stream_chat`'s `async_stream!` block never yielded a single SSE
    // event. These tests drive the real `stream_chat` handler end to end
    // (not just the pure `build_model_ladder` logic already covered above)
    // against exactly that failure mode, proving `nvidia_connect_timeout`
    // turns a hang into an ordinary failed attempt — same as a non-2xx
    // status — instead of hanging the whole response forever.

    /// Config for `start_mock_nvidia` below: which model names should never
    /// respond at all (mimicking the real incident), which single model
    /// name (if any) should succeed with a real SSE stream, and everything
    /// else gets a normal 401 (mimicking an account not entitled to a
    /// candidate) — the same three-way shape the real NVIDIA account
    /// exhibits.
    struct MockNvidiaConfig {
        hang_models: Vec<&'static str>,
        success_model: Option<&'static str>,
    }

    /// Same "local axum server on 127.0.0.1:0" pattern as billing.rs's
    /// `start_mock_stripe` / agent.rs's `start_mock_ddg`, extended with a
    /// branch that never responds at all: `loop { sleep().await }` with no
    /// `break` has type `!`, so it coerces to any response type without
    /// ever actually returning — the exact shape of a genuinely stuck
    /// upstream, not just a slow one.
    async fn start_mock_nvidia(config: MockNvidiaConfig) -> String {
        let config = std::sync::Arc::new(config);
        let completions_config = config.clone();
        let completions = axpost(move |AxJson(body): AxJson<serde_json::Value>| {
            let config = completions_config.clone();
            async move {
                let model = body["model"].as_str().unwrap_or("").to_string();
                if config.hang_models.contains(&model.as_str()) {
                    // Never returns: the connection is accepted, and then
                    // nothing — no headers, no body, no close. This is what
                    // `nvidia_connect_timeout` exists to bound.
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
                    }
                }
                if config.success_model == Some(model.as_str()) {
                    let sse_body = "data: {\"choices\":[{\"delta\":{\"content\":\"Hallo aus dem Mock.\"}}]}\n\ndata: [DONE]\n\n";
                    axum::response::Response::builder()
                        .status(StatusCode::OK)
                        .header("content-type", "text/event-stream")
                        .body(axum::body::Body::from(sse_body))
                        .unwrap()
                } else {
                    (StatusCode::UNAUTHORIZED, AxJson(json!({"error": {"message": format!("account not entitled to {model}")}}))).into_response()
                }
            }
        });
        let embeddings = axpost(|| async {
            let vector: Vec<f32> = vec![0.01; 8];
            AxJson(json!({ "data": [{ "embedding": vector }] }))
        });
        let app = Router::new()
            .route("/v1/chat/completions", completions)
            .route("/v1/embeddings", embeddings);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    /// Reads the whole SSE response body, wrapped in ITS OWN generous
    /// (but bounded) timeout — the actual assertion that the fix works:
    /// before the fix, this would hang forever (the test would time out at
    /// the harness level with no useful failure message); after the fix,
    /// it must resolve well within a few seconds even though
    /// `nvidia_connect_timeout` is deliberately set short by the caller.
    async fn read_sse_body_bounded(resp: axum::response::Response) -> String {
        let bytes = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            axum::body::to_bytes(resp.into_body(), usize::MAX),
        )
        .await
        .expect("stream_chat response must not hang forever when a candidate never responds")
        .unwrap();
        String::from_utf8_lossy(&bytes).to_string()
    }

    /// The core incident regression: EVERY candidate hangs (the worst case
    /// — mirrors "the account somehow isn't entitled to / can't reach any
    /// candidate right now"). Before the fix this hung forever with zero
    /// bytes ever sent to the client. After the fix, the client must still
    /// receive the intended clean error event, bounded by
    /// `nvidia_connect_timeout` per attempt — not silence.
    #[tokio::test]
    async fn all_candidates_hanging_still_yields_a_clean_error_instead_of_silence() {
        let base = start_mock_nvidia(MockNvidiaConfig {
            hang_models: vec![
                "meta/llama-3.1-405b-instruct",
                "meta/llama-3.3-70b-instruct",
                "meta/llama-3.1-70b-instruct",
                "meta/llama-3.1-8b-instruct",
            ],
            success_model: None,
        })
        .await;

        let mut state = test_state().await;
        state.nvidia_api_base = base;
        state.nvidia_api_key = "test-key".to_string();
        // Short but not instant, so the test still genuinely exercises an
        // await that times out rather than one that resolves immediately.
        state.nvidia_connect_timeout = std::time::Duration::from_millis(150);

        let req = StreamChatReq {
            conversation_id: "conv-all-hang".to_string(),
            message: "hallo, testest du gerade?".to_string(),
            current_module: None,
            site_content: None,
            reasoning_requested: None,
        };
        let resp = stream_chat(AxState(state), HeaderMap::new(), AxJson(req))
            .await
            .into_response();
        let body = read_sse_body_bounded(resp).await;

        assert!(
            body.contains("event: error") && body.contains("fehlgeschlagen"),
            "must reach the intended error event, not hang or go silent: {body:?}"
        );
    }

    /// The recovery case, proving the fix doesn't just fail cleanly but
    /// actually still serves a real reply when a LATER candidate works: the
    /// first candidate hangs exactly like the incident, and the ladder must
    /// still fall through to a working candidate afterward instead of
    /// getting stuck on the hung one forever.
    #[tokio::test]
    async fn hanging_first_candidate_still_falls_through_to_a_working_one() {
        let base = start_mock_nvidia(MockNvidiaConfig {
            hang_models: vec!["meta/llama-3.1-405b-instruct"],
            success_model: Some("meta/llama-3.3-70b-instruct"),
        })
        .await;

        let mut state = test_state().await;
        state.nvidia_api_base = base;
        state.nvidia_api_key = "test-key".to_string();
        state.nvidia_connect_timeout = std::time::Duration::from_millis(150);

        let req = StreamChatReq {
            conversation_id: "conv-fallthrough".to_string(),
            message: "hallo, testest du gerade?".to_string(),
            current_module: None,
            site_content: None,
            reasoning_requested: None,
        };
        let resp = stream_chat(AxState(state), HeaderMap::new(), AxJson(req))
            .await
            .into_response();
        let body = read_sse_body_bounded(resp).await;

        assert!(
            body.contains("Hallo aus dem Mock") && body.contains("event: done"),
            "must still deliver the real reply from the working candidate, not get stuck on the hung one: {body:?}"
        );
    }

    // ── Flight recorder (system_snapshots) failure isolation ────────────────
    // The single most important test in this file given the 2026-07-10
    // outage history documented at the top: a background-task failure must
    // NEVER surface on the visible chat response. `test_state()` above
    // deliberately only runs `chat::init_schema` — none of
    // `emergence_signals`/`simulation_runs`/`research_notes`/
    // `agent_tool_calls`/`system_snapshots` exist in it — so every single
    // query inside `observatory::capture_system_snapshot` is GUARANTEED to
    // fail with "no such table" here. This proves the isolation is real, not
    // just untested-and-hoped-for.

    /// End-to-end: drives the real `stream_chat` handler to completion (same
    /// mock-NVIDIA harness as the timeout-regression tests above) while the
    /// chained `record_ccet_turn` + `capture_system_snapshot` background task
    /// is guaranteed to fail outright. The visible SSE reply must still
    /// arrive in full, `event: done` must still fire, and the assistant turn
    /// must still be durably persisted to `chat_messages` — none of that may
    /// depend on the background snapshot succeeding.
    #[tokio::test]
    async fn chat_response_and_persistence_unaffected_when_snapshot_capture_tables_are_missing() {
        let base = start_mock_nvidia(MockNvidiaConfig { hang_models: vec![], success_model: Some(CHAT_MODEL) }).await;

        let mut state = test_state().await;
        state.nvidia_api_base = base;
        state.nvidia_api_key = "test-key".to_string();

        let req = StreamChatReq {
            conversation_id: "conv-snapshot-fail".to_string(),
            message: "hallo, testest du gerade?".to_string(),
            current_module: None,
            site_content: None,
            reasoning_requested: None,
        };
        let resp = stream_chat(AxState(state.clone()), HeaderMap::new(), AxJson(req))
            .await
            .into_response();
        let body = read_sse_body_bounded(resp).await;

        assert!(
            body.contains("Hallo aus dem Mock") && body.contains("event: done"),
            "the visible reply must complete normally even though the background snapshot tables don't exist: {body:?}"
        );

        // Give the fire-and-forget spawn (record_ccet_turn, then
        // capture_system_snapshot chained after it) a real chance to run and
        // actually fail — the assertion above is only meaningful once that's
        // had the opportunity to happen, not just because of call ordering.
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        let (assistant_count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM chat_messages WHERE conversation_id = ?1 AND role = 'assistant'",
        )
        .bind("conv-snapshot-fail")
        .fetch_one(&state.db)
        .await
        .unwrap();
        assert_eq!(
            assistant_count, 1,
            "the assistant turn must be durably persisted regardless of the background snapshot's fate"
        );
    }

    /// Direct, focused proof of `capture_system_snapshot`'s own contract in
    /// isolation (no HTTP/SSE plumbing at all): called against a completely
    /// bare in-memory DB — not even `chat::init_schema` has run — so every
    /// query inside it fails from the very first line. Reaching the
    /// assertion below at all (rather than the test panicking) IS the proof:
    /// failures degrade to a logged warning (see the function's own doc
    /// comment), never a panic, never a propagated error.
    #[tokio::test]
    async fn capture_system_snapshot_never_panics_against_a_completely_bare_db() {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let state = AppState {
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
            nvidia_connect_timeout: NVIDIA_CONNECT_TIMEOUT,
            chat_secret: String::new(),
            stripe_secret_key: String::new(),
            stripe_api_base: "https://api.stripe.com".to_string(),
            stripe_webhook_secret: String::new(),
            ddg_api_base: "https://api.duckduckgo.com".to_string(),
            github_token: String::new(),
            github_api_base: "https://api.github.com".to_string(),
            chat_model_idx: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            chat_request_count: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        };
        crate::observatory::capture_system_snapshot(&state, "conv-bare", None).await;
        // No panic above is the entire assertion.
    }

    // ── "LKS" kill-switch (save_interrupted_message) ────────────────────

    /// Core case: the partial text a client had already accumulated when the
    /// user hit stop is durably saved as a normal `role='assistant'` row,
    /// with `interrupted = 1` distinguishing it from an ordinary completed
    /// turn.
    #[tokio::test]
    async fn interrupted_message_is_saved_with_interrupted_flag_set() {
        let state = test_state().await;
        sqlx::query("INSERT INTO chat_conversations (id, title, kind) VALUES ('conv-lks', 'x', 'chat')")
            .execute(&state.db)
            .await
            .unwrap();

        let resp = save_interrupted_message(
            AxState(state.clone()),
            HeaderMap::new(),
            Path("conv-lks".to_string()),
            AxJson(InterruptedMessageReq { content: "Das war erst die Hälf".to_string() }),
        )
        .await
        .into_response();
        assert_eq!(resp.status(), StatusCode::OK);

        let row: (String, String, i64) = sqlx::query_as(
            "SELECT role, content, interrupted FROM chat_messages WHERE conversation_id = 'conv-lks'",
        )
        .fetch_one(&state.db)
        .await
        .unwrap();
        assert_eq!(row.0, "assistant");
        assert_eq!(row.1, "Das war erst die Hälf");
        assert_eq!(row.2, 1, "must be marked interrupted, not indistinguishable from a normal completed turn");
    }

    /// An empty/whitespace-only body (the user clicked stop before a single
    /// byte streamed back) has nothing meaningful to persist — must reject
    /// cleanly rather than write an empty interrupted turn into history.
    #[tokio::test]
    async fn interrupted_message_rejects_empty_content() {
        let state = test_state().await;
        sqlx::query("INSERT INTO chat_conversations (id, title, kind) VALUES ('conv-lks-empty', 'x', 'chat')")
            .execute(&state.db)
            .await
            .unwrap();

        let resp = save_interrupted_message(
            AxState(state.clone()),
            HeaderMap::new(),
            Path("conv-lks-empty".to_string()),
            AxJson(InterruptedMessageReq { content: "   ".to_string() }),
        )
        .await
        .into_response();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_messages WHERE conversation_id = 'conv-lks-empty'")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(count.0, 0, "nothing should have been written");
    }

    /// A dedicated NVIDIA mock that captures every /v1/chat/completions
    /// request body it receives (unlike `start_mock_nvidia` above, which
    /// only cares about response shape) — lets a test inspect exactly what
    /// `messages` array `stream_chat` actually sent, proving the interrupted
    /// note isn't just stored and never surfaced.
    async fn start_capturing_mock_nvidia(captured: std::sync::Arc<std::sync::Mutex<Vec<serde_json::Value>>>) -> String {
        let embeddings = axpost(|| async {
            let vector: Vec<f32> = vec![0.01; 8];
            AxJson(json!({ "data": [{ "embedding": vector }] }))
        });
        let completions = axpost(move |AxJson(body): AxJson<serde_json::Value>| {
            let captured = captured.clone();
            async move {
                captured.lock().unwrap().push(body);
                let sse_body = "data: {\"choices\":[{\"delta\":{\"content\":\"Klar, mach ich weiter.\"}}]}\n\ndata: [DONE]\n\n";
                axum::response::Response::builder()
                    .status(StatusCode::OK)
                    .header("content-type", "text/event-stream")
                    .body(axum::body::Body::from(sse_body))
                    .unwrap()
            }
        });
        let app = Router::new()
            .route("/v1/chat/completions", completions)
            .route("/v1/embeddings", embeddings);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    /// End-to-end proof of the OTHER half of the kill-switch contract: a
    /// turn saved via `save_interrupted_message` isn't just flagged in the
    /// DB and never surfaced again — the very next `stream_chat` history
    /// load must inject the synthetic note into that turn's content before
    /// it's sent to the model at all.
    #[tokio::test]
    async fn interrupted_turn_carries_a_synthetic_note_into_the_next_round_trip() {
        let captured = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let base = start_capturing_mock_nvidia(captured.clone()).await;

        let mut state = test_state().await;
        state.nvidia_api_base = base;
        state.nvidia_api_key = "test-key".to_string();

        let conv_id = "conv-lks-history";
        sqlx::query("INSERT INTO chat_conversations (id, title, kind) VALUES (?1, 'x', 'chat')")
            .bind(conv_id)
            .execute(&state.db)
            .await
            .unwrap();

        // Simulate the LKS flow: an earlier user message, then a reply that
        // got cut off mid-stream and saved via save_interrupted_message —
        // exactly the shape a real abort-and-POST leaves behind.
        sqlx::query("INSERT INTO chat_messages (id, conversation_id, role, content) VALUES ('m-user-1', ?1, 'user', 'erzähl mir was')")
            .bind(conv_id)
            .execute(&state.db)
            .await
            .unwrap();
        let resp = save_interrupted_message(
            AxState(state.clone()),
            HeaderMap::new(),
            Path(conv_id.to_string()),
            AxJson(InterruptedMessageReq { content: "Also, es war einmal ei".to_string() }),
        )
        .await
        .into_response();
        assert_eq!(resp.status(), StatusCode::OK);

        // A fresh user message triggers a new round-trip — this is what
        // must carry the synthetic note into the model's own context.
        let req = StreamChatReq {
            conversation_id: conv_id.to_string(),
            message: "mach weiter".to_string(),
            current_module: None,
            site_content: None,
            reasoning_requested: None,
        };
        let resp = stream_chat(AxState(state.clone()), HeaderMap::new(), AxJson(req))
            .await
            .into_response();
        let _ = read_sse_body_bounded(resp).await;

        let bodies = captured.lock().unwrap();
        assert!(!bodies.is_empty(), "stream_chat must have called the mock completions endpoint");
        let sent_messages = bodies[0]["messages"].as_array().expect("messages array must be present");
        let interrupted_turn = sent_messages
            .iter()
            .find(|m| m["content"].as_str().unwrap_or("").contains("Also, es war einmal ei"))
            .expect("the interrupted turn's own text must still be present in history");
        assert_eq!(interrupted_turn["role"], "assistant");
        assert!(
            interrupted_turn["content"].as_str().unwrap().contains("unterbrochen"),
            "the interrupted turn sent to the model must carry the synthetic note, not just the bare partial text: {interrupted_turn}"
        );
    }

    // ── edit-and-resend (delete_message_and_after) ───────────────────────

    /// Core case end to end: deletes a target message and every message
    /// chronologically after it (including same-second siblings ordered by
    /// rowid), leaving earlier messages — including a same-second sibling
    /// that was inserted BEFORE the target — untouched. Also proves the
    /// per-message `chat_chunks` RAG cleanup and the timestamp-scoped
    /// `chat_retrievals` cleanup both actually ran, not just the
    /// `chat_messages` rows themselves.
    #[tokio::test]
    async fn delete_message_and_after_removes_target_and_later_keeps_earlier_and_cleans_rag_memory() {
        let state = test_state().await;
        let conv_id = "conv-edit-resend";
        sqlx::query("INSERT INTO chat_conversations (id, title, kind) VALUES (?1, 'x', 'chat')")
            .bind(conv_id)
            .execute(&state.db)
            .await
            .unwrap();

        // m1 (t0): earlier second entirely — must survive.
        // m2 (t1, inserted BEFORE the target): same created_at second as the
        // target but a lower rowid (earlier insertion order) — the whole
        // point of the rowid tiebreak is that this must survive too, not get
        // swept up just because it shares a timestamp with the target.
        // m3 (t1): the edit target itself.
        // m4 (t1, inserted AFTER the target): same second, higher rowid —
        // must be deleted.
        // m5 (t2): a later second — must be deleted.
        for (id, role, content, created_at) in [
            ("m1", "user", "Frage 1", "2026-07-11 10:00:00"),
            ("m2", "assistant", "Antwort 1", "2026-07-11 10:00:05"),
            ("m3", "user", "Frage 2 EDIT TARGET", "2026-07-11 10:00:05"),
            ("m4", "assistant", "Antwort 2", "2026-07-11 10:00:05"),
            ("m5", "user", "Frage 3", "2026-07-11 10:00:10"),
        ] {
            sqlx::query("INSERT INTO chat_messages (id, conversation_id, role, content, created_at) VALUES (?1,?2,?3,?4,?5)")
                .bind(id)
                .bind(conv_id)
                .bind(role)
                .bind(content)
                .bind(created_at)
                .execute(&state.db)
                .await
                .unwrap();
        }

        // RAG chunks keyed per message: one for the surviving m2, one each
        // for the doomed m3/m4.
        for (chunk_id, mid) in [("chunk-m2", "m2"), ("chunk-m3", "m3"), ("chunk-m4", "m4")] {
            sqlx::query(
                "INSERT INTO chat_chunks (id, source_type, source_id, label, chunk_text, embedding) VALUES (?1,'message',?2,'x','x',x'00')",
            )
            .bind(chunk_id)
            .bind(mid)
            .execute(&state.db)
            .await
            .unwrap();
        }

        // chat_retrievals: one logged before the cutoff (survives), one at
        // the cutoff second (removed).
        sqlx::query("INSERT INTO chat_retrievals (id, conversation_id, query_text, top_score, hit_count, created_at) VALUES ('r1',?1,'x',0.5,1,'2026-07-11 10:00:00')")
            .bind(conv_id)
            .execute(&state.db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO chat_retrievals (id, conversation_id, query_text, top_score, hit_count, created_at) VALUES ('r2',?1,'x',0.5,1,'2026-07-11 10:00:05')")
            .bind(conv_id)
            .execute(&state.db)
            .await
            .unwrap();

        let resp = delete_message_and_after(
            AxState(state.clone()),
            HeaderMap::new(),
            Path((conv_id.to_string(), "m3".to_string())),
        )
        .await
        .into_response();
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);

        let remaining_ids: Vec<(String,)> = sqlx::query_as("SELECT id FROM chat_messages WHERE conversation_id = ?1 ORDER BY created_at ASC, rowid ASC")
            .bind(conv_id)
            .fetch_all(&state.db)
            .await
            .unwrap();
        let remaining: Vec<String> = remaining_ids.into_iter().map(|(id,)| id).collect();
        assert_eq!(remaining, vec!["m1", "m2"], "target and everything after it (chronologically, rowid tiebreak included) must be gone; earlier messages, including a same-second sibling inserted before the target, must survive");

        let remaining_chunks: Vec<(String,)> = sqlx::query_as("SELECT source_id FROM chat_chunks WHERE source_type = 'message' ORDER BY source_id")
            .fetch_all(&state.db)
            .await
            .unwrap();
        let remaining_chunk_ids: Vec<String> = remaining_chunks.into_iter().map(|(id,)| id).collect();
        assert_eq!(remaining_chunk_ids, vec!["m2"], "chat_chunks for deleted messages m3/m4 must be gone; m2's chunk must survive");

        let remaining_retrievals: Vec<(String,)> = sqlx::query_as("SELECT id FROM chat_retrievals WHERE conversation_id = ?1")
            .bind(conv_id)
            .fetch_all(&state.db)
            .await
            .unwrap();
        let remaining_retrieval_ids: Vec<String> = remaining_retrievals.into_iter().map(|(id,)| id).collect();
        assert_eq!(remaining_retrieval_ids, vec!["r1"], "the retrieval logged at/after the cutoff (r2) must be cleaned up too, not just chat_messages rows");
    }

    /// A message id that doesn't exist in the given conversation (typo'd id,
    /// already-deleted message, wrong conversation) must 404 rather than
    /// silently deleting nothing or — worse — matching across conversations.
    #[tokio::test]
    async fn delete_message_and_after_returns_404_for_unknown_message() {
        let state = test_state().await;
        sqlx::query("INSERT INTO chat_conversations (id, title, kind) VALUES ('conv-404', 'x', 'chat')")
            .execute(&state.db)
            .await
            .unwrap();

        let resp = delete_message_and_after(
            AxState(state.clone()),
            HeaderMap::new(),
            Path(("conv-404".to_string(), "does-not-exist".to_string())),
        )
        .await
        .into_response();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    // ── CCET (Continuous Co-Evolution Tracker) — pure-function tests
    // (2026-07-10) ────────────────────────────────────────────────────────
    //
    // Same approach as `build_model_ladder`'s tests above: plain synthetic
    // data, no DB, no network — `compute_cei`/`compute_cep`/
    // `compute_resonance_frequency`/`is_stable_turn`/`shares_framework_term`
    // are all pure functions over already-decided booleans/floats.

    fn turn(stable: bool, prev_stable: Option<bool>, terms_reused: bool) -> CcetTurn {
        CcetTurn { stable, prev_stable, terms_reused }
    }

    #[test]
    fn stability_threshold_is_inclusive_at_the_boundary() {
        assert!(is_stable_turn(CCET_STABILITY_THRESHOLD), "the threshold itself must count as stable, not just values strictly above it");
        assert!(is_stable_turn(0.9));
        assert!(!is_stable_turn(CCET_STABILITY_THRESHOLD - 0.01));
        assert!(!is_stable_turn(0.0));
    }

    /// CEI must reproduce the paper's own formula exactly: stable / total.
    #[test]
    fn cei_is_stable_over_total_matching_the_papers_own_formula() {
        let turns = vec![
            turn(true, None, false),
            turn(true, Some(true), false),
            turn(false, Some(true), false),
            turn(true, Some(false), false),
        ];
        assert_eq!(compute_cei(&turns), 0.75, "3 of 4 turns stable");
    }

    #[test]
    fn cei_on_empty_window_is_zero_not_nan() {
        assert_eq!(compute_cei(&[]), 0.0);
    }

    /// CEP (this project's own definition — see `compute_cep`'s doc
    /// comment): only a turn that is ITSELF stable AND whose specific
    /// predecessor was also stable counts, so an isolated stable turn
    /// (already counted by CEI) never double-counts here.
    #[test]
    fn cep_only_counts_a_turn_whose_specific_predecessor_was_also_stable() {
        let turns = vec![
            turn(true, None, false),        // first turn ever: no predecessor, not a CEP point
            turn(true, Some(true), false),  // stable, predecessor stable -> 1 point
            turn(true, Some(false), false), // stable, but predecessor was NOT stable -> no point
            turn(false, Some(true), false), // not stable itself -> no point regardless of predecessor
        ];
        assert_eq!(compute_cep(&turns), 1);
    }

    #[test]
    fn cep_on_empty_window_is_zero() {
        assert_eq!(compute_cep(&[]), 0);
    }

    #[test]
    fn resonance_frequency_is_terms_reused_over_total() {
        let turns = vec![
            turn(true, None, true),
            turn(true, Some(true), false),
            turn(false, Some(true), true),
        ];
        assert!((compute_resonance_frequency(&turns) - (2.0 / 3.0)).abs() < 1e-6);
    }

    #[test]
    fn resonance_frequency_on_empty_window_is_zero() {
        assert_eq!(compute_resonance_frequency(&[]), 0.0);
    }

    #[test]
    fn shares_framework_term_requires_overlap_not_just_presence_in_either_turn() {
        assert!(
            shares_framework_term("Das ist ein klarer Fall von Emergenz.", "Wir sehen hier echte Emergenz im System."),
            "both turns mention the same term"
        );
        assert!(
            !shares_framework_term("Das ist Drift.", "Hier war nichts Besonderes."),
            "current turn's term never appeared in the previous turn"
        );
        assert!(
            !shares_framework_term("Ganz gewöhnliche Antwort ohne Fachbegriff.", "Wir beobachten Drift im Interaction Field."),
            "current turn doesn't reuse anything, even though the PREVIOUS turn had framework terms"
        );
    }

    #[test]
    fn shares_framework_term_matching_is_case_insensitive() {
        assert!(shares_framework_term("EMERGENZ tritt auf.", "emergenz wurde erkannt."));
    }

    #[test]
    fn framework_terms_in_finds_multiple_distinct_terms() {
        let found = framework_terms_in("Auf der Systemebene sehen wir Drift und eine neue Emergenz.");
        assert!(found.contains("systemebene"));
        assert!(found.contains("drift"));
        assert!(found.contains("emergenz"));
    }

    // ── CCET — end-to-end integration test (real DB, mocked embeddings) ──

    /// A dedicated embeddings-only mock (distinct from `start_mock_nvidia`
    /// above, whose embeddings route always returns the SAME fixed vector —
    /// fine for the timeout tests, useless here where the whole point is to
    /// control cosine similarity deterministically). Maps a marker word in
    /// the input text to a 2D unit vector at a known angle, so cosine
    /// similarity between any two calls is exactly `cos(angle difference)`,
    /// picked so ALPHA→BETA lands above `CCET_STABILITY_THRESHOLD` and
    /// BETA→GAMMA lands well below it.
    async fn start_mock_embeddings() -> String {
        let embeddings = axpost(|AxJson(body): AxJson<serde_json::Value>| async move {
            let text = body["input"][0].as_str().unwrap_or("").to_string();
            let angle_deg: f32 = if text.contains("ALPHA") {
                0.0
            } else if text.contains("BETA") {
                10.0 // cos(10°) ≈ 0.985 vs ALPHA — stable
            } else {
                100.0 // cos(90°) = 0.0 vs BETA — clearly unstable
            };
            let radians = angle_deg.to_radians();
            let vector = vec![radians.cos(), radians.sin()];
            AxJson(json!({ "data": [{ "embedding": vector }] }))
        });
        let app = Router::new().route("/v1/embeddings", embeddings);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    /// Mirrors exactly what `stream_chat` does before spawning
    /// `record_ccet_turn`: insert the assistant turn into `chat_messages`
    /// FIRST (so `record_ccet_turn`'s own "previous assistant turn" lookup,
    /// OFFSET 1 on that table, sees the right row), then run the
    /// instrumentation.
    async fn record_turn_like_stream_chat(state: &AppState, conversation_id: &str, text: &str) {
        sqlx::query("INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?1,?2,'assistant',?3)")
            .bind(Uuid::new_v4().to_string())
            .bind(conversation_id)
            .bind(text)
            .execute(&state.db)
            .await
            .unwrap();
        record_ccet_turn(state, conversation_id, text).await;
    }

    /// End-to-end proof that the instrumentation and the read-side endpoint
    /// agree: three assistant turns (ALPHA, then a near-duplicate BETA that
    /// also repeats ALPHA's "Emergenz" mention, then an unrelated GAMMA with
    /// no framework term at all) must yield exactly one stable turn (BETA),
    /// zero CEP (no two CONSECUTIVE stable turns — the first turn can never
    /// be a CEP point, and GAMMA isn't stable), and one resonance hit
    /// (BETA reusing "Emergenz" from ALPHA; GAMMA reuses nothing).
    #[tokio::test]
    async fn ccet_end_to_end_stability_cep_and_resonance_over_three_turns() {
        let base = start_mock_embeddings().await;
        let mut state = test_state().await;
        state.nvidia_api_base = base;
        state.nvidia_api_key = "test-key".to_string();

        let conv_id = "ccet-conv-1";
        sqlx::query("INSERT INTO chat_conversations (id, title, kind) VALUES (?1, 'CCET Test', 'chat')")
            .bind(conv_id)
            .execute(&state.db)
            .await
            .unwrap();

        record_turn_like_stream_chat(&state, conv_id, "ALPHA: Wir beobachten hier Emergenz zum ersten Mal.").await;
        record_turn_like_stream_chat(&state, conv_id, "BETA: Wieder zeigt sich Emergenz in der Interaktion.").await;
        record_turn_like_stream_chat(&state, conv_id, "GAMMA: Ganz anderes Thema, komplett losgelöst, keine Fachbegriffe.").await;

        let resp = ccet_summary(AxState(state.clone()), HeaderMap::new()).await.into_response();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(parsed["turns_considered"], 3);
        assert!(
            (parsed["cei"].as_f64().unwrap() - (1.0 / 3.0)).abs() < 0.01,
            "only the BETA turn should be stable relative to its predecessor: {parsed}"
        );
        assert_eq!(parsed["cep"], 0, "no two CONSECUTIVE stable turns in this sequence: {parsed}");
        assert!(
            (parsed["resonance_frequency"].as_f64().unwrap() - (1.0 / 3.0)).abs() < 0.01,
            "only BETA reuses a framework term ('Emergenz') seen in the immediately preceding turn: {parsed}"
        );
    }
}
