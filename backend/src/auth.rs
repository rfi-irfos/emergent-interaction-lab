use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Redirect},
    Json,
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{AppState, SessionData};

const SESSION_COOKIE: &str = "rfi_session";

// ── helpers ──────────────────────────────────────────────────────────────────

pub fn get_session(jar: &CookieJar, state: &AppState) -> Option<SessionData> {
    let token = jar.get(SESSION_COOKIE)?.value().to_string();
    state.sessions.read().unwrap().get(&token).cloned()
}

fn make_cookie(token: String) -> Cookie<'static> {
    Cookie::build((SESSION_COOKIE, token))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .build()
}

// ── handlers ─────────────────────────────────────────────────────────────────

pub async fn google_login(
    State(state): State<AppState>,
    jar: CookieJar,
) -> impl IntoResponse {
    // DEV_MODE: auto-login without Google
    if state.dev_mode {
        let token = Uuid::new_v4().to_string();
        state.sessions.write().unwrap().insert(token.clone(), SessionData {
            email: "dev@localhost".into(),
            name: "Developer".into(),
            picture: "".into(),
        });
        return (jar.add(make_cookie(token)), Redirect::to("/admin")).into_response();
    }

    if state.google_client_id.is_empty() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "GOOGLE_CLIENT_ID not set").into_response();
    }

    let url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth\
         ?client_id={}\
         &redirect_uri={}\
         &response_type=code\
         &scope=openid+email+profile\
         &access_type=online",
        urlencoding::encode(&state.google_client_id),
        urlencoding::encode(&state.redirect_uri),
    );
    Redirect::to(&url).into_response()
}

#[derive(Deserialize)]
pub struct CallbackParams {
    code: Option<String>,
    error: Option<String>,
}

pub async fn google_callback(
    State(state): State<AppState>,
    Query(params): Query<CallbackParams>,
    jar: CookieJar,
) -> impl IntoResponse {
    if let Some(err) = params.error {
        return (StatusCode::UNAUTHORIZED, format!("OAuth error: {err}")).into_response();
    }

    let code = match params.code {
        Some(c) => c,
        None => return (StatusCode::BAD_REQUEST, "Missing code").into_response(),
    };

    // Exchange code for access token
    let client = reqwest::Client::new();
    let token_res = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("code", code.as_str()),
            ("client_id", &state.google_client_id),
            ("client_secret", &state.google_client_secret),
            ("redirect_uri", &state.redirect_uri),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await;

    let token_body: serde_json::Value = match token_res {
        Ok(r) => match r.json().await {
            Ok(j) => j,
            Err(_) => return (StatusCode::BAD_GATEWAY, "Token parse error").into_response(),
        },
        Err(_) => return (StatusCode::BAD_GATEWAY, "Token request failed").into_response(),
    };

    let access_token = match token_body["access_token"].as_str() {
        Some(t) => t.to_string(),
        None => return (StatusCode::UNAUTHORIZED, "No access token in response").into_response(),
    };

    // Get user info
    let userinfo: serde_json::Value = match client
        .get("https://www.googleapis.com/oauth2/v3/userinfo")
        .bearer_auth(&access_token)
        .send()
        .await
    {
        Ok(r) => r.json().await.unwrap_or_default(),
        Err(_) => return (StatusCode::BAD_GATEWAY, "Userinfo request failed").into_response(),
    };

    let email = userinfo["email"].as_str().unwrap_or("").to_string();

    // Check allowed email
    if !state.allowed_email.is_empty() && email != state.allowed_email {
        return (StatusCode::FORBIDDEN, "Email not authorized").into_response();
    }

    let session_data = SessionData {
        email: email.clone(),
        name: userinfo["name"].as_str().unwrap_or("").to_string(),
        picture: userinfo["picture"].as_str().unwrap_or("").to_string(),
    };

    let token = Uuid::new_v4().to_string();
    state.sessions.write().unwrap().insert(token.clone(), session_data);

    // `admin_login` — the real session-granting event on this platform (see
    // authz::require_admin's own doc comment: the shared x-chat-secret
    // header is "the one auth mechanism the shipped admin UI actually
    // round-trips through," but THIS Google OAuth callback is where a
    // session cookie with a real, identifiable admin email actually gets
    // minted). Not logged in `google_login`'s DEV_MODE auto-login branch —
    // that's a local-only bypass already loudly warned about at startup,
    // not a real security event worth chaining into the audit log.
    crate::auditlog::record(&state, &email, "admin_login", "Admin-Login via Google OAuth", None).await;

    (jar.add(make_cookie(token)), Redirect::to("/admin")).into_response()
}

pub async fn logout(
    State(state): State<AppState>,
    jar: CookieJar,
) -> impl IntoResponse {
    if let Some(cookie) = jar.get(SESSION_COOKIE) {
        state.sessions.write().unwrap().remove(cookie.value());
    }
    let removed = jar.remove(Cookie::from(SESSION_COOKIE));
    (removed, Redirect::to("/"))
}

#[derive(Serialize)]
pub struct MeResponse {
    email: String,
    name: String,
    picture: String,
}

pub async fn get_me(
    State(state): State<AppState>,
    jar: CookieJar,
) -> impl IntoResponse {
    match get_session(&jar, &state) {
        Some(s) => Json(MeResponse {
            email: s.email,
            name: s.name,
            picture: s.picture,
        })
        .into_response(),
        None => StatusCode::UNAUTHORIZED.into_response(),
    }
}

// tiny urlencoding helper (avoids adding a dep)
mod urlencoding {
    pub fn encode(s: &str) -> String {
        s.chars()
            .flat_map(|c| match c {
                'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => {
                    vec![c]
                }
                c => format!("%{:02X}", c as u32).chars().collect(),
            })
            .collect()
    }
}
