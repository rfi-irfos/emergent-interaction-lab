use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::AppState;

#[derive(Deserialize)]
pub struct ContactRequest {
    pub name: String,
    pub email: String,
    pub phone: Option<String>,
    pub message: String,
}

#[derive(Serialize)]
struct ContactEntry {
    name: String,
    email: String,
    phone: String,
    message: String,
    received_at: String,
}

pub async fn submit_contact(
    State(state): State<AppState>,
    Json(body): Json<ContactRequest>,
) -> impl IntoResponse {
    if body.name.trim().is_empty() || body.email.trim().is_empty() || body.message.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "Pflichtfelder fehlen.").into_response();
    }
    if body.name.len() > 200 || body.email.len() > 200 || body.message.len() > 4000 {
        return (StatusCode::BAD_REQUEST, "Eingabe zu lang.").into_response();
    }

    let entry = ContactEntry {
        name: body.name.trim().to_string(),
        email: body.email.trim().to_string(),
        phone: body.phone.unwrap_or_default().trim().to_string(),
        message: body.message.trim().to_string(),
        received_at: chrono::Utc::now().to_rfc3339(),
    };

    let line = match serde_json::to_string(&entry) {
        Ok(s) => format!("{s}\n"),
        Err(e) => {
            tracing::error!("Contact serialize failed: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    let contacts_path = state.content_path
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .join("contacts.jsonl");

    match tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&contacts_path)
        .await
    {
        Ok(mut f) => {
            if let Err(e) = f.write_all(line.as_bytes()).await {
                tracing::error!("Contact write failed: {e}");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        }
        Err(e) => {
            tracing::error!("Contact open failed: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    }

    tracing::info!("Contact from {} ({})", entry.name, entry.email);
    StatusCode::OK.into_response()
}
