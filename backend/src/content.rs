use axum::{
    extract::{State, Query},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use axum_extra::extract::cookie::CookieJar;
use serde::Deserialize;

use crate::{auth::get_session, AppState};

#[derive(Deserialize, Default)]
pub struct LangQuery {
    lang: Option<String>,
}

/// Resolve the content file path for a language: `content.{lang}.json`
/// sits next to `content.json` (the `en` default) inside the configured
/// CONTENT_PATH directory. The base dir is taken from state.content_path
/// (which points at the persistent volume, e.g. /app/data/content.json).
fn path_for(state: &AppState, lang: &Option<String>) -> std::path::PathBuf {
    let base = &state.content_path;
    let dir = base.parent().unwrap_or_else(|| std::path::Path::new("."));
    let lang = lang.as_deref().unwrap_or("en");
    if lang == "en" {
        base.clone()
    } else {
        let fname = base
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.replace(".json", &format!(".{lang}.json")))
            .unwrap_or_else(|| format!("content.{lang}.json"));
        dir.join(fname)
    }
}

pub async fn get_content(
    State(state): State<AppState>,
    Query(q): Query<LangQuery>,
) -> impl IntoResponse {
    let path = path_for(&state, &q.lang);
    match tokio::fs::read_to_string(&path).await {
        Ok(raw) => match serde_json::from_str::<serde_json::Value>(&raw) {
            Ok(json) => Json(json).into_response(),
            Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "content.json is invalid JSON").into_response(),
        },
        Err(_) => {
            // Return default empty content if file doesn't exist yet
            Json(default_content()).into_response()
        }
    }
}

/// Snapshot the current on-disk content into `backups/` next to it before a
/// save overwrites it, keeping the last `KEEP` per language — the 2026-07-15
/// incident (a bad save silently replaced the live content with an old,
/// sensitive-text version and nobody could roll back) had no way back short
/// of manually re-diffing git history. Best-effort: a backup failure must
/// never block the actual save, so errors here are swallowed.
async fn snapshot_before_overwrite(path: &std::path::Path, lang: &str) {
    const KEEP: usize = 20;
    let Ok(existing) = tokio::fs::read(path).await else { return };
    let dir = path.parent().unwrap_or_else(|| std::path::Path::new(".")).join("backups");
    if tokio::fs::create_dir_all(&dir).await.is_err() {
        return;
    }
    let ts = chrono::Utc::now().format("%Y%m%dT%H%M%S%.6fZ");
    let backup_path = dir.join(format!("content.{lang}.{ts}.json"));
    let _ = tokio::fs::write(&backup_path, &existing).await;

    // Prune down to the newest KEEP backups for this language.
    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        let prefix = format!("content.{lang}.");
        let mut files = Vec::new();
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with(&prefix) && name.ends_with(".json") {
                    files.push(entry.path());
                }
            }
        }
        files.sort();
        if files.len() > KEEP {
            for old in &files[..files.len() - KEEP] {
                let _ = tokio::fs::remove_file(old).await;
            }
        }
    }
}

pub async fn update_content(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(q): Query<LangQuery>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let Some(session) = get_session(&jar, &state) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };

    let pretty = match serde_json::to_string_pretty(&body) {
        Ok(s) => s,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid JSON body").into_response(),
    };

    let path = path_for(&state, &q.lang);
    let lang_label = q.lang.as_deref().unwrap_or("en");
    snapshot_before_overwrite(&path, lang_label).await;
    match tokio::fs::write(&path, pretty).await {
        Ok(_) => {
            // `content_updated` — real identity available here (unlike the
            // shared-secret `require_admin` endpoints), since this route
            // authenticates via the actual Google OAuth session cookie.
            crate::auditlog::record(&state, &session.email, "content_updated", &format!("Website-Inhalt (content.{lang_label}.json) aktualisiert"), None).await;
            StatusCode::OK.into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("Write failed: {e}")).into_response(),
    }
}

fn default_content() -> serde_json::Value {
    serde_json::json!({
        "meta": {
            "title": "My Business",
            "description": "Welcome to our website",
            "primaryColor": "#0099CC",
            "accentColor": "#B3E600",
            "font": "system-ui, -apple-system, sans-serif"
        },
        "nav": {
            "logo": "",
            "brand": "My Business",
            "links": [
                { "label": "Produkte", "href": "#products" },
                { "label": "Über uns", "href": "#about" },
                { "label": "Kontakt", "href": "#contact" }
            ]
        },
        "hero": {
            "headline": "Willkommen bei uns",
            "subheadline": "Wir bieten Ihnen beste Qualität zu fairen Preisen.",
            "ctaLabel": "Mehr erfahren",
            "ctaHref": "#products",
            "image": ""
        },
        "features": {
            "title": "Unsere Leistungen",
            "items": [
                { "id": "f1", "title": "Schnell", "description": "Schnelle Lieferung österreichweit." },
                { "id": "f2", "title": "Günstig", "description": "Faire Preise, direkt vom Hersteller." },
                { "id": "f3", "title": "Sicher", "description": "2 Jahre Garantie auf alle Produkte." }
            ]
        },
        "products": {
            "title": "Unsere Produkte",
            "items": [
                { "id": "p1", "name": "Produkt 1", "description": "Kurze Beschreibung.", "price": "€99", "image": "" },
                { "id": "p2", "name": "Produkt 2", "description": "Kurze Beschreibung.", "price": "€149", "image": "" },
                { "id": "p3", "name": "Produkt 3", "description": "Kurze Beschreibung.", "price": "€199", "image": "" }
            ]
        },
        "contact": {
            "title": "Kontakt",
            "email": "info@example.at",
            "phone": "",
            "address": ""
        },
        "footer": {
            "brand": "My Business",
            "tagline": "Ihre erste Wahl",
            "links": [
                { "label": "AGB", "href": "/agb" },
                { "label": "Datenschutz", "href": "/datenschutz" },
                { "label": "Impressum", "href": "/impressum" }
            ],
            "copyright": "© 2024 My Business"
        }
    })
}
