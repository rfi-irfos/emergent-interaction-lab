mod agent;
mod analytics;
mod anomaly;
mod auditlog;
mod auth;
mod authz;
mod billing;
mod blog;
mod chat;
mod contact;
mod content;
mod dashboards;
mod digest;
mod emergence;
mod github_activity;
mod hallucination;
mod hermes;
mod inspect;
mod mcp;
mod observatory;
mod public;
mod research;
mod simulation;
mod thinking_fragments;
mod track;
mod upload;

use axum::{http::HeaderName, routing::{get, post}, Router};
use sqlx::SqlitePool;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, RwLock},
};
use tower_http::{cors::CorsLayer, services::{ServeDir, ServeFile}};
use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct AppState {
    pub sessions: Arc<RwLock<HashMap<String, SessionData>>>,
    pub content_path: PathBuf,
    pub uploads_dir: PathBuf,
    pub static_dir: PathBuf,
    pub allowed_email: String,
    pub google_client_id: String,
    pub google_client_secret: String,
    pub redirect_uri: String,
    pub dev_mode: bool,
    pub db: SqlitePool,
    pub http: reqwest::Client,
    pub nvidia_api_key: String,
    /// Overridable so tests (and this incident's local reproduction) can
    /// point the chat/embedding calls at a local mock instead of the real
    /// NVIDIA API — never overridden in production, where it's always
    /// "https://integrate.api.nvidia.com".
    pub nvidia_api_base: String,
    /// How long to wait for a NVIDIA response's headers (not the full
    /// streamed body — see `chat::NVIDIA_CONNECT_TIMEOUT`'s doc comment)
    /// before treating a chat-completions/embeddings candidate as failed and
    /// falling back, same as a network error or non-2xx status. Overridable
    /// (same pattern as `nvidia_api_base`) so a test can prove the fix with a
    /// short timeout against a deliberately-hanging mock instead of waiting
    /// out the real production duration.
    pub nvidia_connect_timeout: std::time::Duration,
    pub chat_secret: String,
    pub stripe_secret_key: String,
    /// Overridable so tests can point at a local mock instead of the real
    /// Stripe API — never overridden in production, where it's always
    /// "https://api.stripe.com".
    pub stripe_api_base: String,
    /// Signing secret for `POST /api/billing/webhook` (see
    /// `billing::stripe_webhook`), read from `STRIPE_WEBHOOK_SECRET`. Empty
    /// means "webhook receipt not configured" — the handler logs a warning
    /// and returns 503 for every incoming request rather than either
    /// panicking or (worse) accepting unverified events, same
    /// missing-secret-degrades-gracefully convention as `stripe_secret_key`
    /// above. Never logged or echoed anywhere, including in tests — only
    /// ever compared against, never printed.
    pub stripe_webhook_secret: String,
    /// Overridable so tests can point the web_search tool at a local mock
    /// instead of the real DuckDuckGo Instant Answer API — never overridden
    /// in production, where it's always "https://api.duckduckgo.com".
    pub ddg_api_base: String,
    /// Base URL of the Hermes API server (a gateway platform: run it with
    /// `API_SERVER_ENABLED=1 API_SERVER_KEY=… hermes gateway run`) that backs
    /// the Forschung tab's second engine — see hermes.rs and the README.
    /// Empty (the default, and
    /// the state of the deployed site today) means no Hermes is configured:
    /// `hermes::enabled` is false, the engine selector never offers it, and
    /// every research turn takes the built-in path exactly as before. Doubles
    /// as the test seam, same pattern as `nvidia_api_base`/`ddg_api_base`.
    pub hermes_url: String,
    /// Bearer token for `hermes_url`. Server-side only, and the reason Hermes
    /// runs as a service rather than in the browser: this key buys inference,
    /// so it must never reach a visitor's tab. Never a `VITE_*` var.
    ///
    /// In the bundled deployment an operator never sets this: start.sh generates
    /// it per boot and hands the same value to both processes.
    pub hermes_api_key: String,
    /// How long a research turn waits for a still-booting Hermes before giving
    /// up — see `hermes::HERMES_BOOT_GRACE` for why the wait exists at all.
    /// Overridable (same pattern, and the same reason, as
    /// `nvidia_connect_timeout`) so a test can prove the give-up path against an
    /// unreachable Hermes in milliseconds instead of waiting out the real
    /// production grace period.
    pub hermes_boot_grace: std::time::Duration,
    /// Bearer token guarding `/api/mcp`, the MCP server that lets the bundled
    /// Hermes agent write research notes back into the lab (see mcp.rs).
    /// Generated per boot by start.sh and handed to BOTH processes — Hermes's
    /// config reads it back out of the environment as `${EIL_MCP_TOKEN}`.
    ///
    /// Empty (the default, and the state of any deployment not running the
    /// bundled agent) means the route does not exist at all. That matters more
    /// than usual here: this is a write path into the database exposed to a
    /// language model, so it fails closed.
    pub mcp_token: String,
    /// Server-side-only classic GitHub PAT, read from `GITHUB_ACTIVITY_TOKEN`
    /// — powers the Observatory's Agent-Aktivität transparency feed (real
    /// PRs/commits/workflow runs on this repo, see github_activity.rs). Never
    /// a `VITE_*` var: this must never reach the frontend bundle, unlike the
    /// client-side github.ts calls used for the content.json CMS, which are
    /// a completely different, unauthenticated read/write concern.
    pub github_token: String,
    /// Overridable so tests can point at a local mock instead of the real
    /// GitHub REST API — never overridden in production, where it's always
    /// "https://api.github.com".
    pub github_api_base: String,
    /// A SEPARATE token from `github_token` above — that one is read-only
    /// (Agent-Aktivität's own transparency feed) and must stay that way.
    /// This one, `EIL_GITHUB_TOKEN`, backs the MCP tools an autonomous agent
    /// (Hermes) can actually call (mcp.rs's github_* tools): read a file,
    /// list issues, open an issue, comment. Deliberately a fine-grained PAT
    /// scoped to ONE repo (`eil_github_repo` below), never the broad
    /// account-admin token this repo's own git/gh session already has —
    /// handing that one to a self-modifying, skill-authoring agent was
    /// refused outright 2026-07-13 (admin:org/delete_repo scopes on a
    /// personal account is a different risk tier entirely from "comment on
    /// an issue in this one repo"). Empty = the github_* tools report
    /// "not configured" rather than failing confusingly.
    pub eil_github_token: String,
    /// `owner/repo`, e.g. `rfi-irfos/emergent-interaction-lab` — the ONLY
    /// repo the github_* MCP tools operate on. Deliberately not
    /// agent-specified per call: a model choosing which repo to write to
    /// is exactly the kind of scope creep a fine-grained, single-repo PAT
    /// is supposed to make impossible even if the model tries.
    pub eil_github_repo: String,
    /// Google OAuth2 client id/secret + a long-lived refresh token, backing
    /// ONE Gmail MCP tool: gmail_create_draft. Deliberately draft-only, not
    /// send — an autonomous, self-modifying (skill-authoring), cron-
    /// scheduled agent with an unconditional "send real email as Laura"
    /// capability and no per-send human confirmation was refused outright
    /// 2026-07-14 (a bad turn or prompt injection could reach a real person
    /// with nobody able to catch it first). This matches an existing team
    /// rule elsewhere: Gmail automation stays drafts-only, human-in-the-loop
    /// always. A draft sits in Gmail until a human actually clicks send.
    /// Getting the refresh token itself still requires the account owner
    /// (Laura) to click through Google's OAuth consent screen once, live —
    /// nothing here can substitute for that; these three stay empty (the
    /// tool reports "not configured") until that's actually done.
    pub gmail_client_id: String,
    pub gmail_client_secret: String,
    pub gmail_refresh_token: String,
    /// Serializes `auditlog::record`'s "read last row_hash → compute this
    /// row's hash → insert" sequence (see auditlog.rs). SQLite itself is
    /// single-writer, so two concurrent inserts can never actually corrupt
    /// the table — but without this lock they could both read the same
    /// `prev_hash` and each insert a row claiming to follow it, producing
    /// two rows with the same `prev_hash` instead of a real linear chain.
    /// A plain `tokio::sync::Mutex<()>` (not the advisory-lock + mpsc-channel
    /// machinery Lighthouse's real multi-machine deployment needs) is
    /// sufficient here: single Fly machine, single process, no multi-writer
    /// concern beyond ordinary async task concurrency within it.
    pub audit_lock: Arc<tokio::sync::Mutex<()>>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SessionData {
    pub email: String,
    pub name: String,
    pub picture: String,
}

#[tokio::main]
async fn main() {
    // Load .env BEFORE initializing tracing, so a local RUST_LOG set there
    // (not present in production — the Docker image never copies a .env
    // file, Fly injects real env vars directly) actually takes effect for
    // local dev instead of being read too late.
    dotenvy::dotenv().ok();

    // Root cause of "tracing::info!/warn!/error! output never reaches fly
    // logs" (confirmed by reading tracing_subscriber 0.3's source in
    // ~/.cargo/registry: tracing_subscriber::fmt::init(), when the
    // "env-filter" feature is enabled — it is, see Cargo.toml — is shorthand
    // for `.with_env_filter(EnvFilter::from_default_env()).init()`, and
    // `EnvFilter::from_default_env()` installs `LevelFilter::ERROR` as the
    // DEFAULT DIRECTIVE whenever RUST_LOG isn't set. fly.toml's [env] block
    // never sets RUST_LOG, so production silently dropped every info!/warn!
    // line — including the "chat round served by model X" line this fix
    // depends on for verifying which model actually serves requests, and the
    // "model unavailable/failed, falling back to Y" warning. Explicitly
    // defaulting to "info" (while still honoring a real RUST_LOG if one IS
    // set, e.g. to turn on debug tracing temporarily) fixes this without
    // depending on Fly config to remember it.
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt().with_env_filter(env_filter).init();

    let dev_mode = std::env::var("DEV_MODE").unwrap_or_default() == "true";
    let uploads_dir = PathBuf::from(std::env::var("UPLOADS_DIR").unwrap_or("uploads".into()));
    let static_dir = PathBuf::from(std::env::var("STATIC_DIR").unwrap_or("../frontend/dist".into()));

    tokio::fs::create_dir_all(&uploads_dir).await.ok();

    let db_path = std::env::var("DB_PATH").unwrap_or("visits.db".into());
    let db = SqlitePool::connect(&format!("sqlite://{}?mode=rwc", db_path))
        .await.expect("open visits.db");
    // stream_chat fires many concurrent writes per exchange (message inserts,
    // chat_retrievals, chat_model_state, chat_chunks per text chunk,
    // ccet_turns, system_snapshots) against this single SQLite file. Default
    // journal mode serializes writers behind an exclusive lock, so under any
    // real concurrency that turns into "database is locked" errors — which
    // list_conversations/get_conversation used to swallow via
    // .unwrap_or_default() into a fake-empty 200 (see chat.rs), making
    // conversations intermittently vanish from the Forschung sidebar. WAL
    // lets readers and a writer proceed concurrently instead of blocking each
    // other, and busy_timeout makes any writer-vs-writer contention that
    // remains retry for up to 5s instead of failing immediately — fixing the
    // lock contention at its source rather than only handling it better
    // downstream.
    sqlx::query("PRAGMA journal_mode=WAL;").execute(&db).await.expect("enable WAL");
    sqlx::query("PRAGMA busy_timeout=5000;").execute(&db).await.expect("set busy_timeout");
    sqlx::query("CREATE TABLE IF NOT EXISTS web_visits (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL DEFAULT '/', source TEXT NOT NULL DEFAULT 'direct', referrer TEXT NOT NULL DEFAULT '', utm_source TEXT NOT NULL DEFAULT '', utm_medium TEXT NOT NULL DEFAULT '', utm_campaign TEXT NOT NULL DEFAULT '', visitor TEXT NOT NULL DEFAULT '', created_at DATETIME NOT NULL DEFAULT (datetime('now')))")
        .execute(&db).await.expect("create web_visits");
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_wv_created ON web_visits(created_at)")
        .execute(&db).await.ok();
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_wv_source ON web_visits(source, created_at)")
        .execute(&db).await.ok();
    // Deliberately early: every module below this point (blog, research,
    // billing, chat, anomaly, hallucination) writes to audit_log from its
    // own write paths once the state is constructed, so the table + its
    // immutability triggers must exist before any handler can ever run.
    auditlog::init_schema(&db).await;
    chat::init_schema(&db).await;
    blog::init_schema(&db).await;
    contact::init_schema(&db).await;
    research::init_schema(&db).await;
    simulation::init_schema(&db).await;
    agent::init_schema(&db).await;
    emergence::init_schema(&db).await;
    observatory::init_schema(&db).await;
    billing::init_schema(&db).await;
    billing::seed_webhub_products(&db).await;
    github_activity::init_schema(&db).await;
    thinking_fragments::init_schema(&db).await;
    hallucination::init_schema(&db).await;
    // Anomaly Watchdog v1 — deliberately last: it reads hallucination_checks
    // rows at detection time (see anomaly.rs's `detect_and_record`, signal
    // 4), so it's the natural final entry in this feature-addition order,
    // right after the tracker it partly builds on.
    anomaly::init_schema(&db).await;
    // Customizable Dashboard system (plan §A2) — see dashboards.rs's own
    // module doc comment; no dependency on any table above, placed last
    // simply as the newest addition.
    dashboards::init_schema(&db).await;

    let nvidia_api_key = std::env::var("NVIDIA_API_KEY").unwrap_or_default();
    match nvidia_api_key.len() {
        0 => tracing::warn!("NVIDIA_API_KEY missing at startup"),
        n => tracing::info!("NVIDIA_API_KEY present, length={n}"),
    }

    let github_token = std::env::var("GITHUB_ACTIVITY_TOKEN").unwrap_or_default();
    match github_token.len() {
        0 => tracing::warn!("GITHUB_ACTIVITY_TOKEN missing at startup — Agent-Aktivität will show only locally logged deploys, no real GitHub PRs/commits/workflow runs"),
        n => tracing::info!("GITHUB_ACTIVITY_TOKEN present, length={n}"),
    }

    let state = AppState {
        sessions: Arc::new(RwLock::new(HashMap::new())),
        content_path: PathBuf::from(std::env::var("CONTENT_PATH").unwrap_or("content.json".into())),
        uploads_dir: uploads_dir.clone(),
        static_dir: static_dir.clone(),
        allowed_email: std::env::var("ALLOWED_EMAIL").unwrap_or_default(),
        google_client_id: std::env::var("GOOGLE_CLIENT_ID").unwrap_or_default(),
        google_client_secret: std::env::var("GOOGLE_CLIENT_SECRET").unwrap_or_default(),
        redirect_uri: std::env::var("REDIRECT_URI")
            .unwrap_or("http://localhost:3000/auth/callback".into()),
        dev_mode,
        db,
        http: reqwest::Client::new(),
        nvidia_api_key,
        nvidia_api_base: std::env::var("NVIDIA_API_BASE")
            .unwrap_or("https://integrate.api.nvidia.com".into()),
        nvidia_connect_timeout: std::env::var("NVIDIA_CONNECT_TIMEOUT_SECS")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .map(std::time::Duration::from_secs)
            .unwrap_or(chat::NVIDIA_CONNECT_TIMEOUT),
        chat_secret: std::env::var("CHAT_API_SECRET").unwrap_or_default(),
        stripe_secret_key: std::env::var("STRIPE_SECRET_KEY").unwrap_or_default(),
        stripe_api_base: std::env::var("STRIPE_API_BASE").unwrap_or("https://api.stripe.com".into()),
        stripe_webhook_secret: std::env::var("STRIPE_WEBHOOK_SECRET").unwrap_or_default(),
        ddg_api_base: std::env::var("DDG_API_BASE").unwrap_or("https://api.duckduckgo.com".into()),
        // Trailing slash trimmed so hermes.rs can build paths by plain
        // concatenation without emitting `//api/sessions`, which Hermes's
        // router 404s on.
        hermes_url: std::env::var("HERMES_URL").unwrap_or_default().trim_end_matches('/').to_string(),
        hermes_api_key: std::env::var("HERMES_API_KEY").unwrap_or_default(),
        mcp_token: std::env::var("EIL_MCP_TOKEN").unwrap_or_default(),
        hermes_boot_grace: std::env::var("HERMES_BOOT_GRACE_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .map(std::time::Duration::from_secs)
            .unwrap_or(hermes::HERMES_BOOT_GRACE),
        github_token,
        github_api_base: std::env::var("GITHUB_API_BASE").unwrap_or("https://api.github.com".into()),
        eil_github_token: std::env::var("EIL_GITHUB_TOKEN").unwrap_or_default(),
        eil_github_repo: std::env::var("EIL_GITHUB_REPO").unwrap_or_default(),
        gmail_client_id: std::env::var("GMAIL_CLIENT_ID").unwrap_or_default(),
        gmail_client_secret: std::env::var("GMAIL_CLIENT_SECRET").unwrap_or_default(),
        gmail_refresh_token: std::env::var("GMAIL_REFRESH_TOKEN").unwrap_or_default(),
        audit_lock: Arc::new(tokio::sync::Mutex::new(())),
    };

    if state.chat_secret.is_empty() {
        tracing::warn!("CHAT_API_SECRET missing at startup — all admin endpoints are unauthenticated, do not use in production");
    }
    if state.stripe_secret_key.is_empty() {
        tracing::warn!("STRIPE_SECRET_KEY missing at startup — payment link creation will be unavailable");
    }
    if state.stripe_webhook_secret.is_empty() {
        tracing::warn!("STRIPE_WEBHOOK_SECRET missing at startup — incoming Stripe webhooks will be rejected (503), no orders will be recorded until it's configured");
    }
    // Not an error: no HERMES_URL is the normal, deployed state today, and the
    // Forschung tab simply never offers the Hermes engine. Only the half-set
    // case is worth a warning — a URL with no key means every Hermes turn would
    // fail its 401 at the session call.
    if !state.hermes_url.is_empty() && state.hermes_api_key.is_empty() {
        tracing::warn!("HERMES_URL is set but HERMES_API_KEY is missing — the Hermes research engine will be rejected by the API server and every Hermes turn will fail");
    }

    if dev_mode {
        tracing::warn!("DEV_MODE=true — auth is bypassed, do not use in production");
    }

    let index_html = static_dir.join("index.html");
    let spa_fallback = ServeDir::new(&static_dir)
        .not_found_service(ServeFile::new(&index_html));

    let app = Router::new()
        // Auth
        .route("/auth/google", get(auth::google_login))
        .route("/auth/callback", get(auth::google_callback))
        .route("/auth/logout", post(auth::logout))
        // API
        .route("/api/me", get(auth::get_me))
        .route("/api/content", get(content::get_content).put(content::update_content))
        .route("/api/upload", post(upload::upload_file))
        .route("/api/contact", post(contact::submit_contact))
        .route("/api/contact/messages", get(contact::list_messages))
        .route("/api/contact/messages/:id", axum::routing::patch(contact::update_status))
        .route("/api/analytics", get(analytics::stats))
        .route("/api/inspect", post(inspect::inspect))
        // Research chat (RAG + streaming)
        .route("/api/chat/conversations", get(chat::list_conversations).post(chat::create_conversation))
        .route("/api/chat/conversations/:id", get(chat::get_conversation).delete(chat::delete_conversation))
        // "LKS" kill-switch: durably saves a partial streamed reply as an
        // interrupted assistant turn, bypassing the NVIDIA round-trip.
        .route("/api/chat/conversations/:id/interrupted-message", post(chat::save_interrupted_message))
        // Edit-and-resend: deletes a message and everything chronologically
        // after it in the same conversation (see delete_message_and_after's
        // doc comment for the exact per-message/per-conversation cleanup).
        .route("/api/chat/conversations/:id/messages/:message_id", axum::routing::delete(chat::delete_message_and_after))
        .route("/api/chat/stream", post(chat::stream_chat))
        .route("/api/chat/engines", get(hermes::engines))
        // The bundled Hermes agent's write path back into the lab. Guarded by
        // EIL_MCP_TOKEN and absent entirely without it — see mcp.rs.
        .route("/api/mcp", post(mcp::handle))
        .route("/api/chat/documents", get(chat::list_documents).post(chat::upload_document))
        .route("/api/chat/documents/:id", axum::routing::delete(chat::delete_document))
        // Observatory (emergence signals only — business/CMS metrics live in /api/analytics)
        .route("/api/observatory/behavior", get(observatory::behavior))
        .route("/api/observatory/information", get(observatory::information))
        .route("/api/observatory/human-ai", get(observatory::human_ai))
        .route("/api/observatory/scope-trends", get(observatory::scope_trends))
        .route("/api/observatory/ai-activity", get(observatory::ai_activity))
        .route("/api/observatory/organization", get(observatory::organization))
        .route("/api/observatory/diagnostics", get(observatory::diagnostics))
        .route("/api/observatory/emergence/signals", get(emergence::list_signals))
        .route("/api/observatory/emergence/analyze", post(emergence::analyze))
        .route("/api/observatory/emergence/ccet", get(chat::ccet_summary))
        .route("/api/observatory/agent-activity", get(github_activity::agent_activity))
        .route("/api/observatory/deploy-log", post(github_activity::log_deploy))
        // Flight recorder: one typed rollup row captured automatically after
        // every chat turn (see chat.rs::stream_chat's CCET spawn) — this is
        // the paginated read path, same limit/offset + X-Total-Count
        // convention as emergence::list_signals / simulation::list_runs.
        .route("/api/observatory/snapshots", get(observatory::list_snapshots))
        // "Everything about me": one holistic rollup across every table this
        // platform has captured about her research activity (chat,
        // emergence signals, research notes, CCET, simulation runs, the
        // flight recorder, Jarvis tool calls), sectioned by source table
        // and filterable by the same `?range=7d|30d|all` convention as the
        // rest of this file — Laura's own ask, not a per-module export.
        // Deliberately excludes billing.rs (Stripe/order data), a separate
        // business-data concern.
        .route("/api/observatory/everything", get(observatory::everything))
        // Denkfragmente: per-conversation 8-Layer-Model timeline + the
        // aggregate distribution across all conversations — see
        // thinking_fragments.rs's module doc comment for the full
        // disclosure (this project's own operationalization of Laura's own
        // IEIA-2025 "8-Layer Model", classified per turn by an LLM call
        // spawned after chat.rs::stream_chat's SSE "done" event).
        .route("/api/observatory/fragments", get(thinking_fragments::list_sequence))
        .route("/api/observatory/fragments/distribution", get(thinking_fragments::distribution))
        // Hallucination Tracker v1: admin review list of every tool-call ↔
        // assistant-message comparison this platform has run — see
        // hallucination.rs's module doc comment for the bounded scope (only
        // checks a message's OWN linked tool-call results, never a general
        // fact-checker) and no-fabrication discipline. Same limit/offset +
        // X-Total-Count pagination convention as every other list endpoint
        // here; a plain, UI-agnostic row shape so the Phase J anomaly
        // watchdog can reuse it directly.
        .route("/api/observatory/hallucination-checks", get(hallucination::list_checks))
        // Anomaly Watchdog v1: "a watchdog that watches the watchdog" — the
        // admin review list for agent_anomalies (see anomaly.rs's module doc
        // comment for the full scope/honesty disclosure and the four
        // concrete signals it ever writes: a real tool-call failure, the
        // tool-calling loop hitting its own round cap, the Part-1 refusal
        // instruction in chat::SYSTEM_PROMPT firing per a keyword heuristic,
        // and a hallucination_checks 'mismatch' verdict reused as-is). Same
        // limit/offset + X-Total-Count pagination convention as every other
        // list endpoint here — a superset of hallucination-checks (which
        // only ever shows one of these four signals), so this is a new,
        // dedicated endpoint rather than hallucination::list_checks reused
        // directly, even though that endpoint's own doc comment anticipated
        // being reused by this exact feature.
        .route("/api/observatory/anomalies", get(anomaly::list_anomalies))
        // Same GROUP-BY-kind rollup as thinking_fragments::distribution /
        // observatory::behavior, just over the closed 4-value `kind` enum
        // (see anomaly.rs's KIND_* constants) instead of the 8-layer or
        // free-text buckets those two use — always returns all 4 kinds,
        // zero-filled, for a stable chart-legend response shape.
        .route("/api/observatory/anomalies/distribution", get(anomaly::distribution))
        // Hash-chained changelog (see auditlog.rs's module doc comment for
        // the full "ported from Lighthouse, right-sized for single-machine
        // SQLite" disclosure). `verify` walks the chain and recomputes every
        // hash; `log` is the paginated read path the sidebar's live feed
        // polls, same limit/offset + X-Total-Count convention as every
        // other list endpoint here.
        .route("/api/observatory/audit/verify", get(auditlog::verify))
        .route("/api/observatory/audit/log", get(auditlog::list_log))
        // Customizable Dashboard system (plan §A2, see dashboards.rs's own
        // module doc comment): a picker/switcher list, one dashboard's own
        // widgets nested in a single response (no N+1), and a per-widget
        // CRUD surface. `PATCH /api/dashboards/widgets/:id` is deliberately
        // NOT nested under `/api/dashboards/:id/...` — a widget id alone is
        // enough to address it, and this keeps the drag/resize/pencil-edit
        // hot path a flat, single-segment-id route.
        .route("/api/dashboards", get(dashboards::list_dashboards).post(dashboards::create_dashboard))
        .route("/api/dashboards/:id", get(dashboards::get_dashboard).delete(dashboards::delete_dashboard))
        .route("/api/dashboards/:id/widgets", post(dashboards::add_widget))
        .route(
            "/api/dashboards/widgets/:id",
            axum::routing::patch(dashboards::update_widget).delete(dashboards::delete_widget),
        )
        // Blog (agent can draft, only a human publishes)
        .route("/api/blog/posts", get(blog::list_posts).post(blog::create_post))
        .route("/api/blog/posts/:id", get(blog::get_post).put(blog::update_post).delete(blog::delete_post))
        .route("/api/blog/posts/:id/publish", post(blog::publish_post))
        // Research Workspace + Innovation Lab (shared table, filtered by category)
        .route("/api/research/items", get(research::list_items).post(research::create_item))
        .route("/api/research/items/:id", get(research::get_item).put(research::update_item).delete(research::delete_item))
        // Simulation Lab (genuinely functional, LLM-reasoned, always labeled exploratory)
        .route("/api/simulation/runs", get(simulation::list_runs).post(simulation::create_run))
        .route("/api/simulation/runs/:id", get(simulation::get_run).delete(simulation::delete_run))
        // Monetization (Verwaltung, not Observatory — business concern, not a research signal)
        .route("/api/billing/products", get(billing::list_products).post(billing::create_product))
        .route("/api/billing/products/:id", axum::routing::delete(billing::delete_product))
        .route("/api/billing/products/:id/payment-link", post(billing::create_payment_link))
        // Stripe webhook receiver (no `require_admin` — Stripe can't send our
        // x-chat-secret header; trust here comes entirely from the
        // Stripe-Signature HMAC check in billing::stripe_webhook instead).
        // Real sales/orders visibility: until this existed, a completed
        // Stripe purchase left zero trace anywhere in this system.
        .route("/api/billing/webhook", post(billing::stripe_webhook))
        // Admin-only sales/orders view, same limit/offset + X-Total-Count
        // pagination convention as emergence::list_signals / simulation::list_runs.
        .route("/api/billing/orders", get(billing::list_orders))
        // Public storefront feed (no auth — read-only, only products with a real payment_link_url)
        .route("/api/billing/public-products", get(billing::list_public_products))
        // Public homepage widgets (no auth — bare aggregate counts + curated
        // merged-PR feed only, see public.rs for the privacy contract)
        .route("/api/public/live-stats", get(public::live_stats))
        .route("/api/public/shipping-feed", get(public::shipping_feed))
        .route("/api/public/signal-levels", get(public::signal_levels))
        .route("/api/public/ccet-trend", get(public::ccet_trend))
        .route("/api/public/current-focus", get(public::current_focus))
        .route("/api/public/simulation-status", get(public::simulation_status))
        // Tracking pixel (public, no auth)
        .route("/api/track/pixel.gif", get(track::pixel))
        .route("/api/track", post(track::beacon))
        // Uploads
        .nest_service("/uploads", ServeDir::new(&uploads_dir))
        // React SPA
        .fallback_service(spa_fallback)
        .with_state(state)
        // `.permissive()` allows any origin/method/header on the *request*
        // side, but a browser only exposes a small CORS-safelisted set of
        // *response* headers to JS by default — a custom one like
        // `X-Total-Count` (emergence::list_signals, simulation::list_runs —
        // real pagination totals) needs an explicit exposure or the admin
        // panel silently can't read it when served cross-origin (e.g. from
        // GitHub Pages, see frontend/src/lib/apiBase.ts).
        .layer(CorsLayer::permissive().expose_headers([HeaderName::from_static("x-total-count")]));

    let port = std::env::var("PORT").unwrap_or("3000".into());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    tracing::info!("Listening on http://{addr}");
    axum::serve(listener, app).await.unwrap();
}
