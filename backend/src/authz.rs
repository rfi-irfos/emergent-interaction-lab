use axum::http::HeaderMap;
use axum_extra::extract::cookie::CookieJar;

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

/// Admin gate: EITHER a valid `rfi_session` browser cookie OR the
/// `x-chat-secret` header (server-to-server: Hermes, scripts, deploy-log).
/// One login satisfies both — the cookie path is what the deployed GH Pages
/// admin UI actually uses; the header path stays for non-browser callers.
///
/// SECURITY (H1, 2026-07-19): an empty secret is FAIL-CLOSED in production —
/// it only opens the header path when `DEV_MODE=true` (explicit local/dev
/// convenience). The cookie path is unaffected by that fallback: a valid
/// session is always sufficient, dev mode or not.
pub fn require_admin(state: &AppState, headers: &HeaderMap, jar: &CookieJar) -> bool {
    if crate::auth::get_session(jar, state).is_some() {
        return true;
    }
    if state.chat_secret.is_empty() {
        // Fail closed unless this is an explicit dev machine.
        return state.dev_mode;
    }
    match headers.get("x-chat-secret").and_then(|v| v.to_str().ok()) {
        Some(provided) => constant_time_eq(provided.as_bytes(), state.chat_secret.as_bytes()),
        None => false,
    }
}
