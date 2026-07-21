use axum::http::HeaderMap;

use crate::AppState;

pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
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
/// today: a shared secret header, checked against `CHAT_API_SECRET`.
///
/// SECURITY (H1, 2026-07-19): an empty secret is FAIL-CLOSED in production. It
/// only opens the gate when `DEV_MODE=true` (explicit local/dev convenience).
/// Previously an unset secret on ANY deployment silently made every admin
/// endpoint public; now a prod machine with no secret configured refuses admin
/// access instead of granting it to everyone. Pair with the startup warning in
/// main.rs and set CHAT_API_SECRET on every real deployment.
pub fn require_admin(state: &AppState, headers: &HeaderMap) -> bool {
    if state.chat_secret.is_empty() {
        // Fail closed unless this is an explicit dev machine.
        return state.dev_mode;
    }
    match headers.get("x-chat-secret").and_then(|v| v.to_str().ok()) {
        Some(provided) => constant_time_eq(provided.as_bytes(), state.chat_secret.as_bytes()),
        None => false,
    }
}
