use axum::{
    extract::{Multipart, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::Serialize;
use uuid::Uuid;

use crate::{authz::require_admin, AppState};

#[derive(Serialize)]
struct UploadResponse {
    url: String,
    filename: String,
}

pub async fn upload_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> impl IntoResponse {
    // Was gated on get_session() (the Google-OAuth cookie session) — but
    // nothing in the frontend ever calls /auth/google or /api/me (confirmed
    // by grep across frontend/src), so that cookie is never established by
    // the real admin UI. Every other admin surface (blog, research, chat,
    // observatory) authenticates via the x-chat-secret header through
    // authHeaders()/require_admin instead (see adminApi.ts's own doc
    // comment: "the one auth mechanism the shipped admin UI actually
    // round-trips through today"). Left as get_session, this endpoint was
    // unreachable from any real logged-in admin session — a second, silent
    // reason uploads were broken beyond the already-fixed UPLOADS_DIR volume
    // move. Matching require_admin here is what makes it actually callable
    // from BlogDrafts.tsx (and anything else using authHeaders()).
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    while let Ok(Some(field)) = multipart.next_field().await {
        let original_name = field.file_name().unwrap_or("upload").to_string();
        let ext = std::path::Path::new(&original_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin");

        // Sanitize: only allow safe raster/vector image extensions.
        // SVG is DELIBERATELY excluded (L2, 2026-07-19): an uploaded SVG can
        // carry inline <script>/<foreignObject> and files are served from
        // /uploads, so a stored SVG is a stored-XSS vector the moment anything
        // renders it inline instead of via <img>. Raster formats can't script.
        let ext = match ext.to_lowercase().as_str() {
            "jpg" | "jpeg" => "jpg",
            "png" => "png",
            "gif" => "gif",
            "webp" => "webp",
            _ => return (StatusCode::BAD_REQUEST, "Only raster image files allowed (jpg, png, gif, webp)").into_response(),
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
