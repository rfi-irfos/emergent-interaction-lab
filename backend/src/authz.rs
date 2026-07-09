use axum::http::HeaderMap;

use crate::AppState;

/// The one auth mechanism the shipped admin UI actually round-trips through
/// today: a shared secret header, checked against `CHAT_API_SECRET`. Empty
/// secret means "no auth configured" (local/dev convenience), matching the
/// behavior this was extracted from (chat.rs's prior `is_authorized`).
pub fn require_admin(state: &AppState, headers: &HeaderMap) -> bool {
    if state.chat_secret.is_empty() {
        return true;
    }
    headers.get("x-chat-secret").and_then(|v| v.to_str().ok()) == Some(state.chat_secret.as_str())
}
