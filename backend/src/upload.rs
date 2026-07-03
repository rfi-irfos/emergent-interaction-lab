use axum::{
    extract::{Multipart, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use axum_extra::extract::cookie::CookieJar;
use serde::Serialize;
use uuid::Uuid;

use crate::{auth::get_session, AppState};

#[derive(Serialize)]
struct UploadResponse {
    url: String,
    filename: String,
}

pub async fn upload_file(
    State(state): State<AppState>,
    jar: CookieJar,
    mut multipart: Multipart,
) -> impl IntoResponse {
    if get_session(&jar, &state).is_none() {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    while let Ok(Some(field)) = multipart.next_field().await {
        let original_name = field.file_name().unwrap_or("upload").to_string();
        let ext = std::path::Path::new(&original_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin");

        // Sanitize: only allow safe image extensions
        let ext = match ext.to_lowercase().as_str() {
            "jpg" | "jpeg" => "jpg",
            "png" => "png",
            "gif" => "gif",
            "webp" => "webp",
            "svg" => "svg",
            _ => return (StatusCode::BAD_REQUEST, "Only image files allowed").into_response(),
        };

        let filename = format!("{}.{}", Uuid::new_v4(), ext);
        let path = state.uploads_dir.join(&filename);

        let data = match field.bytes().await {
            Ok(b) => b,
            Err(_) => return (StatusCode::BAD_REQUEST, "Failed to read file data").into_response(),
        };

        if data.len() > 10 * 1024 * 1024 {
            return (StatusCode::PAYLOAD_TOO_LARGE, "Max file size is 10MB").into_response();
        }

        if let Err(e) = tokio::fs::write(&path, &data).await {
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("Save failed: {e}")).into_response();
        }

        let url = format!("/uploads/{filename}");
        return Json(UploadResponse { url, filename }).into_response();
    }

    (StatusCode::BAD_REQUEST, "No file in request").into_response()
}
