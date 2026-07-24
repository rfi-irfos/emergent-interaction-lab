use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use axum_extra::extract::cookie::CookieJar;
use serde_json::json;

use crate::{authz::require_admin, AppState};

/// Laura's other project — "der Ameisenhaufen," her own nickname for the
/// 50-center `coevolution-factory` compliance/risk agent fleet (built on the
/// private `lauras-agents` 292-agent engine). She asked for it to be visible
/// from inside EIL so she never has to leave her one tool to see her own
/// agents at work.
///
/// This proxies coevolution-factory's own `GET /observatory` endpoint rather
/// than adding anything new over there — confirmed via a live check that it
/// already returns a rich JSON payload (per-center sessions/revenue, inter-
/// center debates, the Virtual Firm pipeline, spawn-candidate transparency
/// with the Laura gate, daughter/scale-out counts) when asked with an
/// `Accept: application/json` header, and that it needs no credential at all
/// (it's the same public cashflow page a browser would otherwise render as
/// HTML). This module exists so the browser never talks cross-origin to a
/// different Fly app directly — same admin-authed-through-EIL's-own-backend
/// convention every other Observatory module follows — and so an outage or
/// shape-change on that side degrades honestly instead of the frontend's own
/// fetch just failing with no explanation (same convention as
/// github_activity.rs's `configured` flag).
const COEVOLUTION_OBSERVATORY_URL: &str =
    "https://coevolution-factory-sparkling-mountain-1802.fly.dev/observatory";

pub async fn activity(State(state): State<AppState>, headers: HeaderMap, jar: CookieJar) -> impl IntoResponse {
    if !require_admin(&state, &headers, &jar) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let res = state
        .http
        .get(COEVOLUTION_OBSERVATORY_URL)
        .header("Accept", "application/json")
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => match r.json::<serde_json::Value>().await {
            Ok(data) => Json(json!({ "configured": true, "message": Option::<String>::None, "data": data })).into_response(),
            Err(e) => {
                tracing::error!("coevolution-factory response could not be parsed: {e}");
                Json(json!({
                    "configured": false,
                    "message": "Antwort der Coevolution Factory konnte nicht gelesen werden.",
                    "data": Option::<serde_json::Value>::None,
                }))
                .into_response()
            }
        },
        Ok(r) => {
            let status = r.status();
            tracing::error!("coevolution-factory fetch failed: {status}");
            Json(json!({
                "configured": false,
                "message": format!("Coevolution Factory nicht erreichbar (Status {status})."),
                "data": Option::<serde_json::Value>::None,
            }))
            .into_response()
        }
        Err(e) => {
            tracing::error!("coevolution-factory fetch failed: {e}");
            Json(json!({
                "configured": false,
                "message": "Coevolution Factory ist gerade nicht erreichbar.",
                "data": Option::<serde_json::Value>::None,
            }))
            .into_response()
        }
    }
}
