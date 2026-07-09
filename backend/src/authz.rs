use axum::http::HeaderMap;

use crate::AppState;

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// The one auth mechanism the shipped admin UI actually round-trips through
/// today: a shared secret header, checked against `CHAT_API_SECRET`. Empty
/// secret means "no auth configured" (local/dev convenience), matching the
/// behavior this was extracted from (chat.rs's prior `is_authorized`).
pub fn require_admin(state: &AppState, headers: &HeaderMap) -> bool {
    if state.chat_secret.is_empty() {
        return true;
    }
    match headers.get("x-chat-secret").and_then(|v| v.to_str().ok()) {
        Some(provided) => constant_time_eq(provided.as_bytes(), state.chat_secret.as_bytes()),
        None => false,
    }
}
