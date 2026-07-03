use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::Value;
use std::collections::HashMap;
use crate::AppState;

pub fn derive_source(utm_source: &str, referrer: &str) -> String {
    let u = utm_source.trim().to_lowercase();
    if !u.is_empty() {
        return match u.as_str() {
            "li" | "linkedin"                           => "linkedin",
            "tw" | "x" | "twitter"                     => "twitter",
            "fb" | "facebook" | "meta"                  => "facebook",
            "ig" | "instagram"                          => "instagram",
            "gh" | "github"                             => "github",
            "yt" | "youtube"                            => "youtube",
            "google" | "bing" | "duckduckgo" | "search" => "search",
            "newsletter" | "email" | "mail"             => "email",
            other                                       => return other.to_string(),
        }.to_string();
    }
    let r = referrer.trim().to_lowercase();
    if r.is_empty() { return "direct".into(); }
    let host = r.split("://").nth(1).unwrap_or(&r).split('/').next().unwrap_or("");
    let host = host.strip_prefix("www.").unwrap_or(host);
    if host.contains("linkedin") || host == "lnkd.in" { "linkedin" }
    else if host.contains("github")                    { "github" }
    else if host == "t.co" || host.contains("twitter") || host == "x.com" { "twitter" }
    else if host.contains("facebook") || host == "fb.com" { "facebook" }
    else if host.contains("instagram")                 { "instagram" }
    else if host.contains("youtu")                     { "youtube" }
    else if host.contains("google") || host.contains("bing") || host.contains("duckduckgo") || host.contains("ecosia") { "search" }
    else if host.is_empty()                            { "direct" }
    else                                               { "referral" }
    .to_string()
}

async fn record(state: &AppState, path: &str, referrer: &str, utm_source: &str, utm_medium: &str, utm_campaign: &str, visitor: &str) {
    let source = derive_source(utm_source, referrer);
    let _ = sqlx::query(
        "INSERT INTO web_visits (path,source,referrer,utm_source,utm_medium,utm_campaign,visitor) VALUES (?1,?2,?3,?4,?5,?6,?7)"
    )
    .bind(path).bind(&source).bind(referrer).bind(utm_source).bind(utm_medium).bind(utm_campaign).bind(visitor)
    .execute(&state.db).await;
}

fn q<'a>(m: &'a HashMap<String, String>, k: &str) -> &'a str {
    m.get(k).map(|s| s.as_str()).unwrap_or("")
}

/// GET /api/track/pixel.gif — 1x1 transparent GIF beacon, no auth required.
pub async fn pixel(State(state): State<AppState>, Query(m): Query<HashMap<String, String>>) -> Response {
    record(&state, q(&m, "p"), q(&m, "r"), q(&m, "utm_source"), q(&m, "utm_medium"), q(&m, "utm_campaign"), q(&m, "v")).await;
    const GIF: [u8; 43] = [
        0x47,0x49,0x46,0x38,0x39,0x61,0x01,0x00,0x01,0x00,0x80,0x00,0x00,0x00,0x00,0x00,
        0xff,0xff,0xff,0x21,0xf9,0x04,0x01,0x00,0x00,0x00,0x00,0x2c,0x00,0x00,0x00,0x00,
        0x01,0x00,0x01,0x00,0x00,0x02,0x02,0x44,0x01,0x00,0x3b,
    ];
    (
        [(header::CONTENT_TYPE, "image/gif"),
         (header::CACHE_CONTROL, "no-store, max-age=0"),
         (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")],
        Body::from(GIF.to_vec()),
    ).into_response()
}

/// POST /api/track — JSON beacon (navigator.sendBeacon), CORS-open.
pub async fn beacon(State(state): State<AppState>, Json(b): Json<Value>) -> StatusCode {
    let g = |k: &str| b.get(k).and_then(|v| v.as_str()).unwrap_or("");
    record(&state, g("path"), g("referrer"), g("utm_source"), g("utm_medium"), g("utm_campaign"), g("visitor")).await;
    StatusCode::NO_CONTENT
}
