use axum::{extract::{Query, State}, http::{HeaderMap, HeaderValue, StatusCode}, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{authz::require_admin, chat::CHAT_MODEL, AppState};

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

        let _ = sqlx::query(
            "INSERT INTO emergence_signals (id, pattern, level, status, confidence, evolution, observation, scope, source_conversation_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&pattern)
        .bind(&level)
        .bind(&status)
        .bind(&confidence)
        .bind(&evolution)
        .bind(&observation)
        .bind(&scope)
        .bind(conversation_id)
        .execute(db)
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
}

type SignalRow = (String, String, String, String, String, String, String, Option<String>, Option<String>, String);
fn to_out(r: SignalRow) -> SignalOut {
    SignalOut {
        id: r.0, pattern: r.1, level: r.2, status: r.3, confidence: r.4, evolution: r.5,
        observation: r.6, scope: r.7, source_conversation_id: r.8, created_at: r.9,
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
        "SELECT id, pattern, level, status, confidence, evolution, observation, scope, source_conversation_id, created_at \
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
    use axum::extract::{Query as AxQuery, State as AxState};
    use std::{collections::HashMap, path::PathBuf, sync::{Arc, RwLock}};

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
        ListSignalsQuery { limit: None, offset: None, level: None, status: None, confidence: None, evolution: None }
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

    #[tokio::test]
    async fn requires_admin_auth() {
        let mut state = test_state().await;
        state.chat_secret = "shh".to_string();
        let res = list_signals(AxState(state), HeaderMap::new(), AxQuery(empty_query())).await.into_response();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }
}
