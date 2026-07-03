mod analytics;
mod auth;
mod contact;
mod content;
mod track;
mod upload;

use axum::{routing::{get, post}, Router};
use sqlx::SqlitePool;
use std::{collections::HashMap, path::PathBuf, sync::{Arc, RwLock}};
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
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SessionData {
    pub email: String,
    pub name: String,
    pub picture: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    dotenvy::dotenv().ok();

    let dev_mode = std::env::var("DEV_MODE").unwrap_or_default() == "true";
    let uploads_dir = PathBuf::from(std::env::var("UPLOADS_DIR").unwrap_or("uploads".into()));
    let static_dir = PathBuf::from(std::env::var("STATIC_DIR").unwrap_or("../frontend/dist".into()));

    tokio::fs::create_dir_all(&uploads_dir).await.ok();

    let db_path = std::env::var("DB_PATH").unwrap_or("visits.db".into());
    let db = SqlitePool::connect(&format!("sqlite://{}?mode=rwc", db_path))
        .await.expect("open visits.db");
    sqlx::query("CREATE TABLE IF NOT EXISTS web_visits (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL DEFAULT '/', source TEXT NOT NULL DEFAULT 'direct', referrer TEXT NOT NULL DEFAULT '', utm_source TEXT NOT NULL DEFAULT '', utm_medium TEXT NOT NULL DEFAULT '', utm_campaign TEXT NOT NULL DEFAULT '', visitor TEXT NOT NULL DEFAULT '', created_at DATETIME NOT NULL DEFAULT (datetime('now')))")
        .execute(&db).await.expect("create web_visits");
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_wv_created ON web_visits(created_at)")
        .execute(&db).await.ok();
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_wv_source ON web_visits(source, created_at)")
        .execute(&db).await.ok();

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
    };

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
        .route("/api/analytics", get(analytics::stats))
        // Tracking pixel (public, no auth)
        .route("/api/track/pixel.gif", get(track::pixel))
        .route("/api/track", post(track::beacon))
        // Uploads
        .nest_service("/uploads", ServeDir::new(&uploads_dir))
        // React SPA
        .fallback_service(spa_fallback)
        .with_state(state)
        .layer(CorsLayer::permissive());

    let port = std::env::var("PORT").unwrap_or("3000".into());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    tracing::info!("Listening on http://{addr}");
    axum::serve(listener, app).await.unwrap();
}
