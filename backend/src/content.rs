use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use axum_extra::extract::cookie::CookieJar;

use crate::{auth::get_session, AppState};

pub async fn get_content(State(state): State<AppState>) -> impl IntoResponse {
    match tokio::fs::read_to_string(&state.content_path).await {
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

pub async fn update_content(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let Some(session) = get_session(&jar, &state) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };

    let pretty = match serde_json::to_string_pretty(&body) {
        Ok(s) => s,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid JSON body").into_response(),
    };

    match tokio::fs::write(&state.content_path, pretty).await {
        Ok(_) => {
            // `content_updated` — real identity available here (unlike the
            // shared-secret `require_admin` endpoints), since this route
            // authenticates via the actual Google OAuth session cookie.
            crate::auditlog::record(&state, &session.email, "content_updated", "Website-Inhalt (content.json) aktualisiert", None).await;
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
