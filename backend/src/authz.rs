use axum::http::{header, HeaderMap};

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

/// Accept the password-login session token used by the admin UI, with the
/// shared secret as a backwards-compatible machine/agent credential. The
/// bearer form is needed for the GitHub Pages -> Fly deployment, where the
/// browser cannot rely on a same-origin cookie.
pub fn require_admin(state: &AppState, headers: &HeaderMap) -> bool {
    if let Some(token) = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    {
        if state.sessions.read().unwrap().contains_key(token) {
            return true;
        }
    }

    // Same-origin fallback for the HttpOnly cookie issued by the login route.
    if let Some(cookie_header) = headers.get(header::COOKIE).and_then(|v| v.to_str().ok()) {
        if let Some(token) = cookie_header.split(';').find_map(|part| {
            let (name, value) = part.trim().split_once('=')?;
            (name == "rfi_session").then_some(value)
        }) {
            if state.sessions.read().unwrap().contains_key(token) {
                return true;
            }
        }
    }

    if state.chat_secret.is_empty() {
        return true;
    }
    match headers.get("x-chat-secret").and_then(|v| v.to_str().ok()) {
        Some(provided) => constant_time_eq(provided.as_bytes(), state.chat_secret.as_bytes()),
        None => false,
    }
}
