use axum::{extract::{Query, State}, http::{HeaderMap, HeaderValue, StatusCode}, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{authz::require_admin, chat::CHAT_MODEL, observatory::resolve_range, AppState};

/// Emergence signal detection — the Observatory's actual reason to exist.
/// Deliberately an LLM interpretation of what's happening in a research
/// conversation, not a hand-coded statistics pipeline dressed up as science:
/// per the lab's own framing, this research area works through dialogue, not
/// classic ML. Fires automatically after every completed Forschung exchange
/// (see chat.rs::stream_chat), spawned as a background task so it never
/// delays the visible reply finishing — an explicit, accepted tradeoff of an
/// extra NVIDIA call on every single turn, for maximum responsiveness.
pub async fn init_schema(db: &SqlitePool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS emergence_signals (
            id TEXT PRIMARY KEY,
            pattern TEXT NOT NULL,
            status TEXT NOT NULL,
            confidence TEXT NOT NULL,
            evolution TEXT NOT NULL,
            observation TEXT NOT NULL,
            scope TEXT,
            source_conversation_id TEXT,
            created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create emergence_signals");
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_es_created ON emergence_signals(created_at)")
        .execute(db)
        .await
        .ok();
    // Additive: separates signals into 4 genuinely different categories
    // (see plan — the dashboard must not read as one flat list of emergence
    // observations). Default 'interaction' for pre-existing rows: the prompt
    // that generated them only ever asked about dialogue-level dynamics
    // (Muster/Rückkopplung/Rollenveränderung), which is squarely
    // "interaction" under the 4-way split — the honest backfill choice.
    sqlx::query(
        "ALTER TABLE emergence_signals ADD COLUMN level TEXT NOT NULL DEFAULT 'interaction' \
         CHECK(level IN ('human','ai','interaction','system'))",
    )
    .execute(db)
    .await
    .ok();
    // Additive: the "measured emergence" gate (see `verify_recurrence`'s own
    // doc comment for the full mapping onto the Research page's own "When
    // does emergence count as measured?" section, content.json page id
    // `research`). `embedding` is nullable, unlike `level` above — there is
    // no honest backfill value for a vector on pre-existing rows, and a NULL
    // embedding just means that row was never a candidate for a recurrence
    // match (true for every row inserted before this migration, and for any
    // row whose own `chat::embed` call failed). `verified_emergence` and
    // `recurrence_count` both default to the same "not yet measured" state
    // every signal has always implicitly been in: an "observation" (the
    // Research page's own word for it), not "measured emergence" — this
    // migration only ever adds a path to earn the latter, never silently
    // grants it.
    sqlx::query("ALTER TABLE emergence_signals ADD COLUMN embedding BLOB")
        .execute(db)
        .await
        .ok();
    sqlx::query("ALTER TABLE emergence_signals ADD COLUMN verified_emergence INTEGER NOT NULL DEFAULT 0")
        .execute(db)
        .await
        .ok();
    sqlx::query("ALTER TABLE emergence_signals ADD COLUMN recurrence_count INTEGER NOT NULL DEFAULT 1")
        .execute(db)
        .await
        .ok();
}

// ── the "measured emergence" gate ───────────────────────────────────────
//
// The Research page's own "When does emergence count as measured?" section
// (content.json, page id `research`; German mirror in content.de.json under
// "Wann gilt Emergenz als gemessen?") states four explicit criteria. Until
// this section, NONE of them were enforced anywhere — every signal above
// was accepted straight from a single LLM call over one conversation's last
// 20 messages, logged at face value as if it already cleared that bar. The
// site's own page draws a sharp line between the two outcomes: "If any one
// of these four conditions is missing, the pattern is logged as an
// observation, but not counted as measured emergence." `verify_recurrence`
// below is what actually makes that distinction real instead of aspirational
// copy. How its logic maps onto the page's four stated criteria:
//
// 1. "occurs across at least three separate sessions" — the core of this
//    function: cosine similarity between this signal's `pattern` embedding
//    and every prior signal's stored embedding, counting DISTINCT
//    `source_conversation_id`s (this one, plus any sufficiently similar
//    prior ones) that are not this same conversation.
// 2. "is structural, not stylistic" — NOT independently re-checked here.
//    `analyze_recent_interactions`'s own prompt already constrains every
//    signal to exactly one of four "level" categories (human/ai/interaction/
//    system) and never offers a "stylistic" option at all — so a signal
//    reaching this function has already satisfied this criterion by
//    construction. Said explicitly, rather than silently skipped.
// 3. "reproduces without being re-specified" — evidenced by the SAME
//    recurrence check as #1: the pattern showing up independently in
//    separate conversations Laura never re-explained it into is itself the
//    observable signature of the model/interaction carrying it forward on
//    its own, not a separate check.
// 4. "is quantifiable in the CCET" — checked via `chat::current_ccet_metrics`
//    below; see that call site for exactly what "real" means here and one
//    honest limitation of reusing it.

/// THIS PROJECT'S OWN operationalization of "similar enough to count as the
/// same recurring pattern" — deliberately a SEPARATE constant from
/// `chat::CCET_STABILITY_THRESHOLD` (0.75), not a reuse of it, even though
/// both are cosine-similarity cutoffs over the same embedding model.
/// `CCET_STABILITY_THRESHOLD` compares full ASSISTANT TURNS (paragraph-
/// length prose, assistant-to-assistant, same conversation) for paraphrase-
/// level continuity. This compares short, LLM-generated PATTERN LABELS (a
/// few words to one short phrase, e.g. "Rekursive Selbstkorrektur-Schleife")
/// across DIFFERENT conversations, drawn from a fixed, narrow research
/// vocabulary (Emergenz/Muster/Rückkopplung/Drift and similar terms recur
/// constantly by DOMAIN alone, not because two patterns are the same
/// underlying dynamic). Short, jargon-dense text pairs from one narrow
/// domain routinely land above 0.75 on general-purpose embedding models even
/// when describing genuinely different things — reusing 0.75 here would
/// turn the recurrence gate into a rubber stamp instead of a real filter.
/// 0.90 is a deliberately stricter, engineering-judgment starting point
/// (same "not derived from the paper, tune with real production data"
/// caveat `CCET_STABILITY_THRESHOLD`'s own doc comment states) — high enough
/// that only genuinely close restatements of the same pattern match, not
/// merely shared subject-matter jargon.
const EMERGENCE_RECURRENCE_THRESHOLD: f32 = 0.90;

/// Cross-session recurrence check — see the module section doc comment
/// above for the full mapping onto the Research page's four stated
/// criteria. Called once per newly inserted signal, from
/// `insert_and_verify_signal` below, itself called from
/// `analyze_recent_interactions`'s own per-signal loop — deliberately NOT a
/// new `tokio::spawn` call site in `chat.rs`: signal lifecycle/verification
/// is this module's own concern, already running inside the existing
/// emergence spawn's async block.
async fn verify_recurrence(state: &AppState, signal_id: &str, conversation_id: &str, pattern: &str) {
    // Mirrors `record_ccet_turn`'s own early-bailout convention in chat.rs.
    // In production this is unreachable with an empty key regardless —
    // `analyze_recent_interactions`'s own top-level guard already returns
    // before any signal is ever inserted — but this function is also called
    // directly by tests below, so it carries its own guard rather than
    // relying entirely on a caller three frames up.
    if state.nvidia_api_key.is_empty() || pattern.trim().is_empty() {
        return;
    }

    let embedding = match crate::chat::embed(state, pattern, "passage").await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("emergence recurrence embed failed for signal {signal_id}: {e}");
            return;
        }
    };
    // Persisted regardless of whether this specific signal ends up verified
    // — a FUTURE signal still needs this row's embedding to compare against.
    let blob = crate::chat::encode_embedding(&embedding);
    let _ = sqlx::query("UPDATE emergence_signals SET embedding = ?1 WHERE id = ?2")
        .bind(&blob)
        .bind(signal_id)
        .execute(&state.db)
        .await;

    // Every prior signal (any level, any conversation) that already has a
    // stored embedding — excludes this row itself and anything never
    // embedded (pre-migration rows, or a row whose own `embed` call failed).
    let rows: Vec<(String, Option<String>, Vec<u8>)> = sqlx::query_as(
        "SELECT id, source_conversation_id, embedding FROM emergence_signals \
         WHERE embedding IS NOT NULL AND id != ?1",
    )
    .bind(signal_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut distinct_conversations: std::collections::HashSet<String> = std::collections::HashSet::new();
    distinct_conversations.insert(conversation_id.to_string());
    let mut matched_prior_ids: Vec<String> = Vec::new();

    for (other_id, other_conv, other_blob) in rows {
        // No conversation_id at all (e.g. a manually-inserted legacy row) —
        // can't attribute a distinct session to it, so it can never count.
        let Some(other_conv) = other_conv else { continue };
        // "whose source_conversation_id is a DIFFERENT conversation from the
        // current one" — same-conversation repeats don't add a new session.
        if other_conv == conversation_id {
            continue;
        }
        let other_embedding = crate::chat::decode_embedding(&other_blob);
        let similarity = crate::chat::cosine(&embedding, &other_embedding);
        if similarity >= EMERGENCE_RECURRENCE_THRESHOLD {
            distinct_conversations.insert(other_conv);
            matched_prior_ids.push(other_id);
        }
    }

    let recurrence_count = distinct_conversations.len() as i64;
    if recurrence_count < 3 {
        return; // stays verified_emergence = 0, exactly as today — an "observation," not "measured emergence."
    }

    // Criterion 4: real CCET data, not the empty-window default.
    // `current_ccet_metrics` is an explicitly GLOBAL rolling-window metric
    // across ALL conversations, not a per-conversation query (see its own
    // doc comment in chat.rs) — this codebase has no per-conversation CCET
    // lookup to reuse instead. This check is therefore honestly "the system
    // has real CCET data at all right now," not a provable guarantee that
    // THIS SPECIFIC conversation individually produced CCET turns — stated
    // plainly rather than silently overclaiming precision the underlying
    // function doesn't have. `turns_considered > 0` is exactly "not the
    // no-data/all-zero state," not merely a proxy for it: `compute_cei`/
    // `compute_cep`/`compute_resonance_frequency` all return 0.0/0/0.0
    // ONLY when given an empty turns window (their own doc comments: "empty
    // input reads as 0.0, not NaN") — so an empty window and an all-zero
    // result are the exact same state, and checking one field for it is
    // sufficient, not an approximation.
    let (_, _, _, turns_considered) = crate::chat::current_ccet_metrics(&state.db).await;
    if turns_considered <= 0 {
        return;
    }

    let mut ids_to_verify = matched_prior_ids;
    ids_to_verify.push(signal_id.to_string());
    for id in ids_to_verify {
        let _ = sqlx::query("UPDATE emergence_signals SET verified_emergence = 1, recurrence_count = ?1 WHERE id = ?2")
            .bind(recurrence_count)
            .bind(&id)
            .execute(&state.db)
            .await;
    }
}

/// One signal's insert + cross-session recurrence check — the actual body
/// of `analyze_recent_interactions`'s per-signal loop below, factored out
/// so tests can drive the real insert-then-verify code path directly
/// without depending on `analyze_recent_interactions`'s own NVIDIA
/// chat-completions call (hardcoded to the real API URL, unlike
/// `chat::embed`'s `state.nvidia_api_base` — not mockable in a test).
async fn insert_and_verify_signal(
    state: &AppState,
    conversation_id: &str,
    pattern: &str,
    level: &str,
    status: &str,
    confidence: &str,
    evolution: &str,
    observation: &str,
    scope: Option<&str>,
) -> Option<String> {
    let id = Uuid::new_v4().to_string();
    let result = sqlx::query(
        "INSERT INTO emergence_signals (id, pattern, level, status, confidence, evolution, observation, scope, source_conversation_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
    )
    .bind(&id)
    .bind(pattern)
    .bind(level)
    .bind(status)
    .bind(confidence)
    .bind(evolution)
    .bind(observation)
    .bind(scope)
    .bind(conversation_id)
    .execute(&state.db)
    .await;

    if result.is_err() {
        return None;
    }
    verify_recurrence(state, &id, conversation_id, pattern).await;
    Some(id)
}

fn extract_json_array(text: &str) -> Option<Vec<serde_json::Value>> {
    let trimmed = text.trim();
    if let Ok(v) = serde_json::from_str::<Vec<serde_json::Value>>(trimmed) {
        return Some(v);
    }
    let first = trimmed.find('[')?;
    let last = trimmed.rfind(']')?;
    if last <= first {
        return None;
    }
    serde_json::from_str::<Vec<serde_json::Value>>(&trimmed[first..=last]).ok()
}

pub async fn analyze_recent_interactions(state: &AppState, conversation_id: &str) {
    if state.nvidia_api_key.is_empty() {
        return;
    }
    let db = &state.db;

    let mut recent_messages: Vec<(String, String)> = sqlx::query_as(
        "SELECT role, content FROM chat_messages WHERE conversation_id = ?1 ORDER BY created_at DESC LIMIT 20",
    )
    .bind(conversation_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    if recent_messages.len() < 2 {
        return; // nothing meaningful to interpret yet
    }
    recent_messages.reverse();
    let transcript: String = recent_messages
        .iter()
        .map(|(role, content)| format!("{role}: {content}"))
        .collect::<Vec<_>>()
        .join("\n");

    let recent_tools: Vec<(String,)> = sqlx::query_as(
        "SELECT tool_name FROM agent_tool_calls WHERE conversation_id = ?1 ORDER BY created_at DESC LIMIT 10",
    )
    .bind(conversation_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let tool_summary = if recent_tools.is_empty() {
        "keine".to_string()
    } else {
        recent_tools.iter().map(|(t,)| t.clone()).collect::<Vec<_>>().join(", ")
    };

    let user_prompt = format!(
        "Hier ist ein Ausschnitt aus einem laufenden Forschungsgespräch (neueste Nachricht zuletzt):\n\n{transcript}\n\nZuletzt verwendete Werkzeuge: {tool_summary}\n\n\
Schau dir an, was in diesem Gespräch strukturell passiert — nicht den Inhalt zusammenfassen, sondern: entstehen neue Muster? Verschiebt sich der Fokus? Gibt es Rückkopplung, Wiederholung, Anpassung, Rollenveränderung? \
Skaliere die Tiefe deiner Beobachtung mit dem, was das Gespräch tatsächlich hergibt: wenn nur eine kurze Verschiebung erkennbar ist, reichen 1-2 Sätze — aber wenn du eine mehrschichtige Dynamik siehst (z.B. eine Verschiebung, die sich über mehrere Nachrichten aufbaut, oder ein Muster, das mit einem früheren zusammenhängt), schreib das auch aus, in einem kurzen Absatz statt einem Einzeiler. Nie künstlich aufblähen, aber auch nie eine echte Beobachtung auf einen Halbsatz zusammenstauchen, wenn mehr zu sagen ist. \
Ordne jedes Signal genau einer von vier Ebenen zu (\"level\"): \
\"human\" — neues Verhaltensmuster, neues Denkmodell, Wissensentwicklung, Hypothese, Forschungsfortschritt auf Seiten von Laura; \
\"ai\" — Antwortentwicklung, Modellverhalten, semantische Veränderung, Konsistenz, Unsicherheit, neue Verknüpfungen auf Seiten des Modells; \
\"interaction\" — gemeinsames Muster, neues Konzept, rekursive Schleife, Co-Reasoning, Strukturänderung im Dialog selbst; \
\"system\" — Veränderung im Gesamtsystem, neue Cluster oder Beziehungen, Drift, Selbstorganisation über den einzelnen Dialog hinaus. \
Für \"scope\" (worum es inhaltlich geht): bevorzuge, wo sinnvoll, einen dieser etablierten Systemnamen statt eigener Formulierungen, damit gleiche Systeme nicht unter leicht unterschiedlichen Namen auseinanderfallen: Human, AI, Human-AI, Organization, Information Space, Behavioral Model, Research System, Knowledge Base. Wenn keiner passt, formuliere frei. \
Warte nicht auf ein großes, eindeutiges Muster, bevor du etwas meldest — auch eine kleine, echte Beobachtung ist es wert, kurz notiert zu werden (z.B. eine einzelne auffällige Wortwahl, ein kurzer Tonwechsel, eine kleine Präzisierung in der Fragestellung). Solche kleinen Beobachtungen bekommen bewusst nur 1 Satz, nicht mehr — die Länge soll ehrlich widerspiegeln, wie viel wirklich zu sehen ist, in beide Richtungen: klein bleibt kurz, aber klein heißt nicht, dass es nicht gemeldet wird. Erfinde dabei nichts — wenn eine Nachricht wirklich nur Standardaustausch ohne jede erkennbare Verschiebung ist, gehört sie nicht ins Array. \
Antworte NUR mit einem JSON-Array (kein Text davor oder danach, keine Code-Block-Markierung) von 0 bis 3 Objekten in genau dieser Form:\n\
[{{\"pattern\": \"kurzer Name des Musters\", \"level\": \"human|ai|interaction|system\", \"status\": \"emerging|stable|fading|hypothetical\", \"confidence\": \"experimental|tentative|moderate\", \"evolution\": \"increasing|decreasing|steady|unclear\", \"observation\": \"so lang wie die Beobachtung es hergibt — ein Satz oder ein kurzer Absatz\", \"scope\": \"worum es inhaltlich geht\"}}]\n\
Wenn wirklich nichts Bemerkenswertes zu erkennen ist, antworte mit einem leeren Array []."
    );

    let res = state
        .http
        .post("https://integrate.api.nvidia.com/v1/chat/completions")
        .bearer_auth(&state.nvidia_api_key)
        .json(&json!({
            "model": CHAT_MODEL,
            "messages": [
                { "role": "system", "content": "Du analysierst Forschungsgespräche für ein Emergence-Observatory. Du interpretierst qualitativ, wie ein Forschungspartner, nicht wie eine Statistik-Pipeline. Antworte ausschließlich mit validem JSON, wie angefordert — kein Fließtext." },
                { "role": "user", "content": user_prompt },
            ],
            "max_tokens": 1600,
            "temperature": 0.4,
            "stream": false,
        }))
        .send()
        .await;

    let res = match res {
        Ok(r) => r,
        Err(e) => { tracing::warn!("emergence analysis request failed: {e}"); return; }
    };
    if !res.status().is_success() {
        return;
    }
    let parsed: serde_json::Value = match res.json().await {
        Ok(v) => v,
        Err(_) => return,
    };
    let content = parsed["choices"][0]["message"]["content"].as_str().unwrap_or("");
    let Some(signals) = extract_json_array(content) else { return };

    for sig in signals {
        let pattern = sig.get("pattern").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if pattern.is_empty() {
            continue;
        }
        let level = sig.get("level").and_then(|v| v.as_str()).unwrap_or("interaction").to_string();
        let level = if ["human", "ai", "interaction", "system"].contains(&level.as_str()) { level } else { "interaction".to_string() };
        let status = sig.get("status").and_then(|v| v.as_str()).unwrap_or("hypothetical").to_string();
        let confidence = sig.get("confidence").and_then(|v| v.as_str()).unwrap_or("experimental").to_string();
        let evolution = sig.get("evolution").and_then(|v| v.as_str()).unwrap_or("unclear").to_string();
        let observation = sig.get("observation").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let scope = sig.get("scope").and_then(|v| v.as_str()).map(|s| s.to_string());

        insert_and_verify_signal(
            state,
            conversation_id,
            &pattern,
            &level,
            &status,
            &confidence,
            &evolution,
            &observation,
            scope.as_deref(),
        )
        .await;
    }
}

#[derive(Serialize)]
pub struct SignalOut {
    id: String,
    pattern: String,
    level: String,
    status: String,
    confidence: String,
    evolution: String,
    observation: String,
    scope: Option<String>,
    source_conversation_id: Option<String>,
    created_at: String,
    /// The "measured emergence" gate's verdict — see `verify_recurrence`'s
    /// doc comment. `false` is the same "observation, not measured
    /// emergence" state every signal has always implicitly been in (the
    /// Research page's own vocabulary); `true` is only ever set by a real,
    /// passing recurrence check, never by the original single-conversation
    /// LLM classification above.
    verified_emergence: bool,
    /// How many DISTINCT conversations this pattern has been seen in —
    /// meaningful once `verified_emergence` is true, otherwise just the
    /// column's own default (1: this signal, not yet found recurring
    /// anywhere else).
    recurrence_count: i64,
}

type SignalRow = (String, String, String, String, String, String, String, Option<String>, Option<String>, String, i64, i64);
fn to_out(r: SignalRow) -> SignalOut {
    SignalOut {
        id: r.0, pattern: r.1, level: r.2, status: r.3, confidence: r.4, evolution: r.5,
        observation: r.6, scope: r.7, source_conversation_id: r.8, created_at: r.9,
        verified_emergence: r.10 != 0, recurrence_count: r.11,
    }
}

// Previous hard cap: `LIMIT 50` baked directly into the query, no
// offset/filter params at all — once more than 50 signals accumulated, older
// ones weren't just unfiltered, they were structurally unreachable from this
// endpoint even though they were sitting in the DB. `DEFAULT_SIGNALS_LIMIT`
// keeps the *default* page (no query params at all) identical to that old
// behavior, so every existing caller that never passed params (SystemState,
// KnowledgeGraph, LiveCards' distinctScopes calc) sees no change — but
// `offset`/`limit` now make the rest of the table reachable, and
// `level`/`status`/`confidence`/`evolution` (comma-separated, same
// multi-value convention as research.rs's `category` filter) let a caller
// narrow the page instead of always getting the unfiltered newest slice.
const DEFAULT_SIGNALS_LIMIT: i64 = 50;
const MAX_SIGNALS_LIMIT: i64 = 200;

#[derive(Deserialize)]
pub struct ListSignalsQuery {
    limit: Option<i64>,
    offset: Option<i64>,
    level: Option<String>,
    status: Option<String>,
    confidence: Option<String>,
    evolution: Option<String>,
    /// `?range=7d|30d|all` — reuses `observatory::resolve_range` verbatim
    /// (same values, same "30d" fallback for an unrecognized value, same
    /// `RANGE_ALL_DAYS` stand-in for "no filter") rather than inventing a
    /// second range convention. Backs SystemState.tsx's `states` list — the
    /// per-scope aggregation built client-side from this endpoint's rows —
    /// so a real date-range filter here is what actually narrows what
    /// System State shows, not a cosmetic param.
    ///
    /// Unlike `resolve_range`'s own default, an *absent* `range` here does
    /// NOT fall back to "30d": `DEFAULT_SIGNALS_LIMIT`'s backward-compat
    /// contract above requires a truly-param-free call to stay identical to
    /// the pre-`range` behavior (no date restriction at all), because
    /// KnowledgeGraph.tsx and LiveCards.tsx' distinctScopes calc both still
    /// call this endpoint with zero query params and must not be silently
    /// narrowed by a new default they never opted into.
    range: Option<String>,
    /// `?verified=true` narrows to signals that actually cleared the
    /// "measured emergence" gate (see `verify_recurrence`) — same
    /// `Option<bool>` convention as `observatory::InformationQuery::gap_only`.
    /// Absent (or any value other than `true`) applies no restriction, same
    /// as every other filter on this endpoint when unset.
    verified: Option<bool>,
}

/// Comma-separated multi-value filter, same convention as
/// `research::ListQuery.category` — trims each term and drops empties, so
/// `?level=` and `?level=human, ,ai` both behave sanely.
fn parse_multi(raw: &Option<String>) -> Vec<String> {
    raw.as_deref()
        .map(|s| s.split(',').map(|v| v.trim().to_string()).filter(|v| !v.is_empty()).collect())
        .unwrap_or_default()
}

/// Appends a bound `col IN (?,?,...)` clause when `values` is non-empty —
/// values are always bound as parameters, never interpolated into the SQL
/// string, so this is safe even though the column name/SQL shape is built
/// dynamically.
fn in_clause(col: &str, values: &[String], clauses: &mut Vec<String>, binds: &mut Vec<String>) {
    if values.is_empty() {
        return;
    }
    let placeholders = vec!["?"; values.len()].join(",");
    clauses.push(format!("{col} IN ({placeholders})"));
    binds.extend(values.iter().cloned());
}

pub async fn list_signals(State(state): State<AppState>, headers: HeaderMap, Query(q): Query<ListSignalsQuery>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let limit = q.limit.unwrap_or(DEFAULT_SIGNALS_LIMIT).clamp(1, MAX_SIGNALS_LIMIT);
    let offset = q.offset.unwrap_or(0).max(0);

    let mut clauses: Vec<String> = Vec::new();
    let mut binds: Vec<String> = Vec::new();
    in_clause("level", &parse_multi(&q.level), &mut clauses, &mut binds);
    in_clause("status", &parse_multi(&q.status), &mut clauses, &mut binds);
    in_clause("confidence", &parse_multi(&q.confidence), &mut clauses, &mut binds);
    in_clause("evolution", &parse_multi(&q.evolution), &mut clauses, &mut binds);
    // Only applies a date restriction when `range` was actually sent — see
    // the field's own doc comment for why an absent `range` must stay a
    // true no-op instead of adopting `resolve_range`'s "30d" default.
    if let Some(range) = q.range.as_deref() {
        let (_, range_days) = resolve_range(Some(range));
        clauses.push("created_at > datetime('now', ?)".to_string());
        binds.push(format!("-{range_days} days"));
    }
    // Plain boolean literal, not a bound param — nothing dynamic about it,
    // same as every other hardcoded fragment already in `clauses`.
    if q.verified.unwrap_or(false) {
        clauses.push("verified_emergence = 1".to_string());
    }
    let where_sql = if clauses.is_empty() { String::new() } else { format!("WHERE {}", clauses.join(" AND ")) };

    // Total matching the filters (ignoring limit/offset) — surfaced via the
    // `X-Total-Count` response header (see main.rs's CorsLayer::expose_headers)
    // so a paginated caller (EmergenceMonitor's "load more") knows how much
    // more there is without ever fetching the full result set itself.
    let count_sql = format!("SELECT COUNT(*) FROM emergence_signals {where_sql}");
    let mut count_query = sqlx::query_scalar(&count_sql);
    for b in &binds {
        count_query = count_query.bind(b);
    }
    let total: i64 = count_query.fetch_one(&state.db).await.unwrap_or(0);

    let select_sql = format!(
        "SELECT id, pattern, level, status, confidence, evolution, observation, scope, source_conversation_id, created_at, verified_emergence, recurrence_count \
         FROM emergence_signals {where_sql} ORDER BY created_at DESC LIMIT ? OFFSET ?"
    );
    let mut row_query = sqlx::query_as(&select_sql);
    for b in &binds {
        row_query = row_query.bind(b);
    }
    let rows: Vec<SignalRow> = row_query.bind(limit).bind(offset).fetch_all(&state.db).await.unwrap_or_default();

    let mut resp = Json(rows.into_iter().map(to_out).collect::<Vec<_>>()).into_response();
    resp.headers_mut().insert(
        "x-total-count",
        HeaderValue::from_str(&total.to_string()).unwrap_or_else(|_| HeaderValue::from_static("0")),
    );
    resp
}

#[derive(Deserialize)]
pub struct AnalyzeReq {
    conversation_id: String,
}

/// Manual re-run, independent of the automatic per-turn trigger — lets Laura
/// force a fresh pass on demand too.
pub async fn analyze(State(state): State<AppState>, headers: HeaderMap, Json(body): Json<AnalyzeReq>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    analyze_recent_interactions(&state, &body.conversation_id).await;
    StatusCode::NO_CONTENT.into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::{Query as AxQuery, State as AxState},
        routing::post as axpost,
        Json as AxJson, Router,
    };
    use std::{collections::HashMap, path::PathBuf, sync::{Arc, RwLock}};

    async fn test_state() -> AppState {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        // `chat::init_schema` first: the recurrence check's CCET criterion
        // (`verify_recurrence`'s call to `chat::current_ccet_metrics`) reads
        // the `ccet_turns` table, which only `chat::init_schema` creates —
        // same ordering `thinking_fragments.rs`'s own `test_state` already
        // uses for the same reason.
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
            audit_lock: std::sync::Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    /// Inserts a signal directly (bypassing the LLM call in
    /// `analyze_recent_interactions`) so tests can set up fixtures deterministically.
    async fn insert_signal(db: &SqlitePool, pattern: &str, level: &str, status: &str, confidence: &str, evolution: &str) -> String {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO emergence_signals (id, pattern, level, status, confidence, evolution, observation, scope, source_conversation_id) \
             VALUES (?1,?2,?3,?4,?5,?6,'obs','scope',NULL)",
        )
        .bind(&id)
        .bind(pattern)
        .bind(level)
        .bind(status)
        .bind(confidence)
        .bind(evolution)
        .execute(db)
        .await
        .unwrap();
        id
    }

    fn empty_query() -> ListSignalsQuery {
        ListSignalsQuery { limit: None, offset: None, level: None, status: None, confidence: None, evolution: None, range: None, verified: None }
    }

    async fn signals_body(res: axum::response::Response) -> (Vec<serde_json::Value>, Option<i64>) {
        let total = res
            .headers()
            .get("x-total-count")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<i64>().ok());
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        (body, total)
    }

    /// The core bug: previously `LIMIT 50` was hardcoded with no way to see
    /// past it. Insert 55 signals; the default (no query params at all) call
    /// must still behave exactly like the old hardcoded query (50, newest
    /// first) — but a follow-up call with `offset=50` must reach the 5 that
    /// would otherwise have been permanently invisible.
    #[tokio::test]
    async fn signals_beyond_old_50_cap_are_reachable_via_offset() {
        let state = test_state().await;
        for i in 0..55 {
            insert_signal(&state.db, &format!("pattern-{i}"), "interaction", "emerging", "moderate", "steady").await;
            // created_at has second resolution (datetime('now')); insert
            // order alone (rowid) already gives list_signals's ORDER BY
            // created_at DESC a stable relative order for equal timestamps
            // in SQLite, so no artificial delay is needed here.
        }

        let default_res = list_signals(AxState(state.clone()), HeaderMap::new(), AxQuery(empty_query())).await.into_response();
        let (default_page, default_total) = signals_body(default_res).await;
        assert_eq!(default_page.len(), 50, "default page must stay 50, matching the old hardcoded LIMIT");
        assert_eq!(default_total, Some(55), "X-Total-Count must reflect the true total, not just the page size");

        let next_res = list_signals(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(ListSignalsQuery { limit: Some(50), offset: Some(50), ..empty_query() }),
        )
        .await
        .into_response();
        let (next_page, _) = signals_body(next_res).await;
        assert_eq!(next_page.len(), 5, "the 5 signals beyond the old cap must now be reachable via offset");

        // No overlap between the two pages.
        let default_ids: std::collections::HashSet<_> = default_page.iter().map(|s| s["id"].clone()).collect();
        let next_ids: std::collections::HashSet<_> = next_page.iter().map(|s| s["id"].clone()).collect();
        assert!(default_ids.is_disjoint(&next_ids));
    }

    #[tokio::test]
    async fn level_filter_actually_filters() {
        let state = test_state().await;
        insert_signal(&state.db, "human-1", "human", "emerging", "moderate", "steady").await;
        insert_signal(&state.db, "ai-1", "ai", "emerging", "moderate", "steady").await;
        insert_signal(&state.db, "interaction-1", "interaction", "emerging", "moderate", "steady").await;

        let res = list_signals(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(ListSignalsQuery { level: Some("human".to_string()), ..empty_query() }),
        )
        .await
        .into_response();
        let (body, total) = signals_body(res).await;
        assert_eq!(total, Some(1));
        assert_eq!(body.len(), 1);
        assert_eq!(body[0]["pattern"], "human-1");
    }

    #[tokio::test]
    async fn status_filter_actually_filters() {
        let state = test_state().await;
        insert_signal(&state.db, "stable-1", "system", "stable", "moderate", "steady").await;
        insert_signal(&state.db, "fading-1", "system", "fading", "moderate", "steady").await;

        let res = list_signals(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(ListSignalsQuery { status: Some("fading".to_string()), ..empty_query() }),
        )
        .await
        .into_response();
        let (body, _) = signals_body(res).await;
        assert_eq!(body.len(), 1);
        assert_eq!(body[0]["pattern"], "fading-1");
    }

    #[tokio::test]
    async fn confidence_filter_actually_filters() {
        let state = test_state().await;
        insert_signal(&state.db, "exp-1", "system", "emerging", "experimental", "steady").await;
        insert_signal(&state.db, "tent-1", "system", "emerging", "tentative", "steady").await;

        let res = list_signals(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(ListSignalsQuery { confidence: Some("tentative".to_string()), ..empty_query() }),
        )
        .await
        .into_response();
        let (body, _) = signals_body(res).await;
        assert_eq!(body.len(), 1);
        assert_eq!(body[0]["pattern"], "tent-1");
    }

    #[tokio::test]
    async fn evolution_filter_actually_filters() {
        let state = test_state().await;
        insert_signal(&state.db, "up-1", "system", "emerging", "moderate", "increasing").await;
        insert_signal(&state.db, "down-1", "system", "emerging", "moderate", "decreasing").await;

        let res = list_signals(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(ListSignalsQuery { evolution: Some("increasing".to_string()), ..empty_query() }),
        )
        .await
        .into_response();
        let (body, _) = signals_body(res).await;
        assert_eq!(body.len(), 1);
        assert_eq!(body[0]["pattern"], "up-1");
    }

    /// Comma-separated multi-value filters (same convention as
    /// research.rs's `category` param) must OR together within one field.
    #[tokio::test]
    async fn comma_separated_level_filter_matches_any_listed_level() {
        let state = test_state().await;
        insert_signal(&state.db, "human-1", "human", "emerging", "moderate", "steady").await;
        insert_signal(&state.db, "ai-1", "ai", "emerging", "moderate", "steady").await;
        insert_signal(&state.db, "system-1", "system", "emerging", "moderate", "steady").await;

        let res = list_signals(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(ListSignalsQuery { level: Some("human, ai".to_string()), ..empty_query() }),
        )
        .await
        .into_response();
        let (body, total) = signals_body(res).await;
        assert_eq!(total, Some(2));
        let patterns: std::collections::HashSet<_> = body.iter().map(|s| s["pattern"].as_str().unwrap().to_string()).collect();
        assert_eq!(patterns, std::collections::HashSet::from(["human-1".to_string(), "ai-1".to_string()]));
    }

    // ── range filter: real narrowing, and a true no-op when absent ─────────
    // (same shape as observatory.rs's own `behavior`/`human_ai`/
    // `list_snapshots` range tests, which this reuses `resolve_range` from)

    #[tokio::test]
    async fn range_7d_excludes_older_signals() {
        let state = test_state().await;
        insert_signal(&state.db, "new-1", "system", "emerging", "moderate", "steady").await;
        let old_id = insert_signal(&state.db, "old-1", "system", "emerging", "moderate", "steady").await;
        sqlx::query("UPDATE emergence_signals SET created_at = datetime('now','-20 days') WHERE id = ?1")
            .bind(&old_id)
            .execute(&state.db)
            .await
            .unwrap();

        let res = list_signals(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(ListSignalsQuery { range: Some("7d".to_string()), ..empty_query() }),
        )
        .await
        .into_response();
        let (body, total) = signals_body(res).await;
        assert_eq!(total, Some(1), "the 20-day-old signal must not count under range=7d");
        assert_eq!(body.len(), 1);
        assert_eq!(body[0]["pattern"], "new-1");
    }

    #[tokio::test]
    async fn range_all_includes_everything() {
        let state = test_state().await;
        let old_id = insert_signal(&state.db, "ancient-1", "system", "emerging", "moderate", "steady").await;
        sqlx::query("UPDATE emergence_signals SET created_at = datetime('now','-500 days') WHERE id = ?1")
            .bind(&old_id)
            .execute(&state.db)
            .await
            .unwrap();

        let res = list_signals(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(ListSignalsQuery { range: Some("all".to_string()), ..empty_query() }),
        )
        .await
        .into_response();
        let (_, total) = signals_body(res).await;
        assert_eq!(total, Some(1), "range=all must reach even a 500-day-old signal");
    }

    /// The critical backward-compat case, distinct from `behavior`'s
    /// "default falls back to 30d" test: a *completely absent* `range` param
    /// must apply NO date restriction at all, not `resolve_range`'s own
    /// "30d" default — SystemState.tsx is about to start sending `range`
    /// explicitly, but KnowledgeGraph.tsx and LiveCards.tsx' distinctScopes
    /// calc still call this endpoint with zero query params (per
    /// `DEFAULT_SIGNALS_LIMIT`'s doc comment above) and must see byte-for-
    /// byte the same result set as before this field existed.
    #[tokio::test]
    async fn range_absent_applies_no_date_restriction_at_all() {
        let state = test_state().await;
        let old_id = insert_signal(&state.db, "ancient-1", "system", "emerging", "moderate", "steady").await;
        sqlx::query("UPDATE emergence_signals SET created_at = datetime('now','-500 days') WHERE id = ?1")
            .bind(&old_id)
            .execute(&state.db)
            .await
            .unwrap();

        let res = list_signals(AxState(state.clone()), HeaderMap::new(), AxQuery(empty_query())).await.into_response();
        let (body, total) = signals_body(res).await;
        assert_eq!(total, Some(1), "no range param at all must still reach a 500-day-old signal, matching pre-range behavior");
        assert_eq!(body.len(), 1);
    }

    #[tokio::test]
    async fn requires_admin_auth() {
        let mut state = test_state().await;
        state.chat_secret = "shh".to_string();
        let res = list_signals(AxState(state), HeaderMap::new(), AxQuery(empty_query())).await.into_response();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    // ── the "measured emergence" gate: verify_recurrence / insert_and_verify_signal ──

    /// Deterministic embeddings-only mock — same "marker word in the input
    /// text maps to a 2D unit vector at a known angle" technique as
    /// `chat.rs`'s own `start_mock_embeddings` (private to that module's own
    /// test mod, so reimplemented here rather than reused) — cosine
    /// similarity between any two calls is exactly `cos(angle difference)`,
    /// so a test can assert a specific match/no-match outcome instead of
    /// hoping a real embedding call happens to land on the right side of
    /// `EMERGENCE_RECURRENCE_THRESHOLD`. `marker_angles` maps a substring to
    /// an angle; any text matching none of them gets `default_angle`.
    async fn start_mock_embeddings(marker_angles: &'static [(&'static str, f32)], default_angle: f32) -> String {
        let embeddings = axpost(move |AxJson(body): AxJson<serde_json::Value>| async move {
            let text = body["input"][0].as_str().unwrap_or("").to_string();
            let angle_deg = marker_angles
                .iter()
                .find(|(marker, _)| text.contains(marker))
                .map(|(_, a)| *a)
                .unwrap_or(default_angle);
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

    /// Extends `insert_signal` with what THIS feature's tests need beyond
    /// the original signature: a real `source_conversation_id` (the
    /// original helper hardcodes NULL — fine for the pre-existing filter
    /// tests above, useless for testing cross-conversation recurrence) and
    /// a pre-computed embedding, so PRIOR fixture rows can be seeded
    /// without a network call — only the NEW signal under test needs a real
    /// (mocked) `embed()` call, exercised through `insert_and_verify_signal`
    /// itself.
    async fn insert_signal_with_conv_and_embedding(db: &SqlitePool, pattern: &str, conversation_id: &str, embedding: &[f32]) -> String {
        let id = Uuid::new_v4().to_string();
        let blob = crate::chat::encode_embedding(embedding);
        sqlx::query(
            "INSERT INTO emergence_signals (id, pattern, level, status, confidence, evolution, observation, scope, source_conversation_id, embedding) \
             VALUES (?1,?2,'interaction','emerging','moderate','steady','obs','scope',?3,?4)",
        )
        .bind(&id)
        .bind(pattern)
        .bind(conversation_id)
        .bind(blob)
        .execute(db)
        .await
        .unwrap();
        id
    }

    /// Seeds one real `ccet_turns` row so `chat::current_ccet_metrics`
    /// returns `turns_considered > 0` — the "real CCET value" criterion
    /// `verify_recurrence` checks. The actual stable/prev_stable/
    /// terms_reused values don't matter for that check (see its own doc
    /// comment: `turns_considered > 0` alone is the precise "not empty"
    /// test, not an approximation of it).
    async fn seed_real_ccet_turn(db: &SqlitePool) {
        sqlx::query(
            "INSERT INTO ccet_turns (id, conversation_id, embedding, similarity_to_prev, stable, prev_stable, terms_reused) \
             VALUES (?1, 'ccet-fixture-conv', ?2, NULL, 1, NULL, 0)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(crate::chat::encode_embedding(&[0.1_f32, 0.2]))
        .execute(db)
        .await
        .unwrap();
    }

    async fn verified_row(db: &SqlitePool, id: &str) -> (i64, i64) {
        sqlx::query_as("SELECT verified_emergence, recurrence_count FROM emergence_signals WHERE id = ?1")
            .bind(id)
            .fetch_one(db)
            .await
            .unwrap()
    }

    /// Required proof #1: a signal recurring via GENUINE embedding
    /// similarity across 3 distinct conversations, with real CCET data
    /// present, gets `verified_emergence = 1` with the correct
    /// `recurrence_count` — and, per the plan's "ideally the matched prior
    /// rows too," the two prior signals that fed the match get updated as
    /// well, not just the newest row.
    #[tokio::test]
    async fn recurrence_across_three_distinct_conversations_with_real_ccet_gets_verified() {
        // "NEWPATTERN" embeds at 2° — cos(2°) ≈ 0.9994, well above
        // EMERGENCE_RECURRENCE_THRESHOLD (0.90) against the priors' 0°.
        let mock_base = start_mock_embeddings(&[("NEWPATTERN", 2.0)], 90.0).await;
        let mut state = test_state().await;
        state.nvidia_api_base = mock_base;
        state.nvidia_api_key = "test-key".to_string();

        let prior_1 = insert_signal_with_conv_and_embedding(&state.db, "Rekursive Selbstkorrektur", "conv-1", &[1.0, 0.0]).await;
        let prior_2 = insert_signal_with_conv_and_embedding(&state.db, "Selbstkorrektur-Muster", "conv-2", &[1.0, 0.0]).await;
        seed_real_ccet_turn(&state.db).await;

        let new_id = insert_and_verify_signal(
            &state, "conv-3", "NEWPATTERN: noch eine Selbstkorrektur-Iteration",
            "human", "emerging", "moderate", "steady", "obs", None,
        )
        .await
        .expect("insert should succeed");

        let (verified, count) = verified_row(&state.db, &new_id).await;
        assert_eq!(verified, 1, "3 distinct conversations + real CCET data must verify the new signal");
        assert_eq!(count, 3);

        for prior_id in [&prior_1, &prior_2] {
            let (verified, count) = verified_row(&state.db, prior_id).await;
            assert_eq!(verified, 1, "a matched prior signal should also read verified, not just the newest row");
            assert_eq!(count, 3);
        }
    }

    /// Required proof #2: a signal appearing in only 1-2 conversations
    /// stays `verified_emergence = 0`, even with real CCET data present —
    /// proves the ≥3-distinct-conversations gate is the binding constraint
    /// here, not incidentally satisfied by the CCET check alone.
    #[tokio::test]
    async fn recurrence_across_only_two_distinct_conversations_stays_unverified() {
        let mock_base = start_mock_embeddings(&[("NEWPATTERN", 2.0)], 90.0).await;
        let mut state = test_state().await;
        state.nvidia_api_base = mock_base;
        state.nvidia_api_key = "test-key".to_string();

        insert_signal_with_conv_and_embedding(&state.db, "Selbstkorrektur-Muster", "conv-1", &[1.0, 0.0]).await;
        seed_real_ccet_turn(&state.db).await;

        let new_id = insert_and_verify_signal(
            &state, "conv-2", "NEWPATTERN: eine Selbstkorrektur",
            "human", "emerging", "moderate", "steady", "obs", None,
        )
        .await
        .unwrap();

        let (verified, count) = verified_row(&state.db, &new_id).await;
        assert_eq!(verified, 0, "only 2 distinct conversations must not clear the ≥3 bar");
        assert_eq!(count, 1, "recurrence_count must stay at its untouched default below the bar, not the insufficient observed count");
    }

    /// Required proof #3: two GENUINELY DIFFERENT patterns (orthogonal
    /// embeddings, similarity 0.0) must not get miscounted as recurrence of
    /// each other, even though there are 3 conversations' worth of signals
    /// in the table in total — distinctness of CONVERSATION is necessary
    /// but not sufficient; the patterns themselves must actually match.
    #[tokio::test]
    async fn dissimilar_patterns_across_conversations_are_not_miscounted_as_recurring() {
        // "NEWPATTERN" embeds at 0°; the two priors are seeded at 90°
        // (orthogonal -> cosine similarity 0.0) — genuinely different
        // dynamics, not a restatement of the same one.
        let mock_base = start_mock_embeddings(&[("NEWPATTERN", 0.0)], 0.0).await;
        let mut state = test_state().await;
        state.nvidia_api_base = mock_base;
        state.nvidia_api_key = "test-key".to_string();

        insert_signal_with_conv_and_embedding(&state.db, "Ganz anderes Muster A", "conv-1", &[0.0, 1.0]).await;
        insert_signal_with_conv_and_embedding(&state.db, "Ganz anderes Muster B", "conv-2", &[0.0, 1.0]).await;
        seed_real_ccet_turn(&state.db).await;

        let new_id = insert_and_verify_signal(
            &state, "conv-3", "NEWPATTERN: eine echte, andere Beobachtung",
            "human", "emerging", "moderate", "steady", "obs", None,
        )
        .await
        .unwrap();

        let (verified, count) = verified_row(&state.db, &new_id).await;
        assert_eq!(verified, 0, "orthogonal (dissimilar) prior signals must not count as the same recurring pattern");
        assert_eq!(count, 1);

        let untouched: Vec<(i64,)> = sqlx::query_as("SELECT verified_emergence FROM emergence_signals WHERE source_conversation_id IN ('conv-1','conv-2')")
            .fetch_all(&state.db)
            .await
            .unwrap();
        assert!(untouched.iter().all(|(v,)| *v == 0), "the two dissimilar priors must stay untouched too");
    }

    /// Criterion 4 in isolation: 3 distinct, genuinely similar
    /// conversations is not enough BY ITSELF without real CCET data behind
    /// it — proves the CCET check is a real second gate, not dead code.
    #[tokio::test]
    async fn recurrence_without_real_ccet_data_stays_unverified() {
        let mock_base = start_mock_embeddings(&[("NEWPATTERN", 2.0)], 90.0).await;
        let mut state = test_state().await;
        state.nvidia_api_base = mock_base;
        state.nvidia_api_key = "test-key".to_string();

        insert_signal_with_conv_and_embedding(&state.db, "Selbstkorrektur A", "conv-1", &[1.0, 0.0]).await;
        insert_signal_with_conv_and_embedding(&state.db, "Selbstkorrektur B", "conv-2", &[1.0, 0.0]).await;
        // Deliberately no seed_real_ccet_turn call — turns_considered stays 0.

        let new_id = insert_and_verify_signal(
            &state, "conv-3", "NEWPATTERN: eine dritte Selbstkorrektur",
            "human", "emerging", "moderate", "steady", "obs", None,
        )
        .await
        .unwrap();

        let (verified, _) = verified_row(&state.db, &new_id).await;
        assert_eq!(verified, 0, "3 distinct, genuinely similar conversations alone must not be enough without real CCET data");
    }

    /// Required proof #4 (regression guard): the existing single-conversation
    /// classification path is otherwise unchanged. Drives the exact function
    /// `analyze_recent_interactions`'s loop calls (`insert_and_verify_signal`)
    /// with no NVIDIA key configured — so `verify_recurrence` bails
    /// immediately, exactly as it's unreachable in production before this
    /// change's own top-level guard — and asserts every pre-existing field
    /// still round-trips correctly through the real public `list_signals`
    /// endpoint, with the two new fields at their honest defaults.
    #[tokio::test]
    async fn signal_without_recurrence_check_keeps_default_unverified_state_and_existing_fields_intact() {
        let state = test_state().await;
        let id = insert_and_verify_signal(
            &state, "conv-1", "ein Muster", "ai", "stable", "tentative", "increasing", "eine Beobachtung", Some("AI"),
        )
        .await
        .unwrap();

        let res = list_signals(AxState(state.clone()), HeaderMap::new(), AxQuery(empty_query())).await.into_response();
        let (body, total) = signals_body(res).await;
        assert_eq!(total, Some(1));
        assert_eq!(body[0]["id"], id);
        assert_eq!(body[0]["pattern"], "ein Muster");
        assert_eq!(body[0]["level"], "ai");
        assert_eq!(body[0]["status"], "stable");
        assert_eq!(body[0]["confidence"], "tentative");
        assert_eq!(body[0]["evolution"], "increasing");
        assert_eq!(body[0]["observation"], "eine Beobachtung");
        assert_eq!(body[0]["scope"], "AI");
        assert_eq!(body[0]["source_conversation_id"], "conv-1");
        assert_eq!(body[0]["verified_emergence"], false, "unchanged default — only a real passing recurrence check ever flips this");
        assert_eq!(body[0]["recurrence_count"], 1, "unchanged default");
    }

    /// `?verified=true` — same filter convention as level/status/confidence/
    /// evolution/range above, now covering the new column.
    #[tokio::test]
    async fn verified_filter_actually_filters() {
        let state = test_state().await;
        let unverified_id = insert_signal(&state.db, "obs-only", "system", "emerging", "moderate", "steady").await;
        let verified_id = insert_signal(&state.db, "measured-1", "system", "emerging", "moderate", "steady").await;
        // Bypasses the real recurrence pipeline on purpose — same "seed the
        // fixture directly" pattern every other filter test in this module
        // already uses; this test is about the SQL filter, not re-proving
        // verify_recurrence's own logic (covered above).
        sqlx::query("UPDATE emergence_signals SET verified_emergence = 1, recurrence_count = 4 WHERE id = ?1")
            .bind(&verified_id)
            .execute(&state.db)
            .await
            .unwrap();

        let res = list_signals(
            AxState(state.clone()),
            HeaderMap::new(),
            AxQuery(ListSignalsQuery { verified: Some(true), ..empty_query() }),
        )
        .await
        .into_response();
        let (body, total) = signals_body(res).await;
        assert_eq!(total, Some(1));
        assert_eq!(body[0]["id"], verified_id);
        assert_eq!(body[0]["recurrence_count"], 4);
        assert_ne!(body[0]["id"], unverified_id);
    }
}
