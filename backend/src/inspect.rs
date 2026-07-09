use axum::{extract::State, http::{HeaderMap, StatusCode}, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};

use crate::{authz::require_admin, AppState};

const MODEL: &str = "meta/llama-3.1-8b-instruct";
const MAX_PROMPT_CHARS: usize = 300;
const MAX_TOKENS: u32 = 30;

#[derive(Deserialize)]
pub struct InspectRequest {
    pub prompt: String,
}

#[derive(Serialize)]
pub struct InspectToken {
    pub token: String,
    pub probability: f64,
    pub alternatives: Vec<InspectAlt>,
}

#[derive(Serialize)]
pub struct InspectAlt {
    pub token: String,
    pub probability: f64,
}

#[derive(Deserialize)]
struct NvidiaResponse {
    choices: Vec<NvidiaChoice>,
}

#[derive(Deserialize)]
struct NvidiaChoice {
    logprobs: Option<NvidiaLogprobs>,
}

#[derive(Deserialize)]
struct NvidiaLogprobs {
    content: Vec<NvidiaTokenLogprob>,
}

#[derive(Deserialize)]
struct NvidiaTokenLogprob {
    token: String,
    logprob: f64,
    top_logprobs: Vec<NvidiaTopLogprob>,
}

#[derive(Deserialize)]
struct NvidiaTopLogprob {
    token: String,
    logprob: f64,
}

pub async fn inspect(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<InspectRequest>,
) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let prompt = body.prompt.trim();
    if prompt.is_empty() {
        return (StatusCode::BAD_REQUEST, "Prompt darf nicht leer sein.").into_response();
    }
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return (StatusCode::BAD_REQUEST, "Prompt zu lang (max. 300 Zeichen).").into_response();
    }

    let api_key = match std::env::var("NVIDIA_API_KEY") {
        Ok(k) if !k.is_empty() => k,
        _ => {
            tracing::error!("NVIDIA_API_KEY not configured");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };

    let client = reqwest::Client::new();
    let res = client
        .post("https://integrate.api.nvidia.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": MODEL,
            "messages": [{ "role": "user", "content": prompt }],
            "max_tokens": MAX_TOKENS,
            "logprobs": true,
            "top_logprobs": 5,
            "temperature": 0.7,
        }))
        .send()
        .await;

    let res = match res {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("NVIDIA request failed: {e}");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        tracing::error!("NVIDIA API error {status}: {text}");
        return (StatusCode::BAD_GATEWAY, "Modell-Anfrage fehlgeschlagen.").into_response();
    }

    let parsed: NvidiaResponse = match res.json().await {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("NVIDIA response parse failed: {e}");
            return (StatusCode::BAD_GATEWAY, "Antwort konnte nicht gelesen werden.").into_response();
        }
    };

    let Some(logprobs) = parsed.choices.into_iter().next().and_then(|c| c.logprobs) else {
        return (StatusCode::BAD_GATEWAY, "Modell hat keine Token-Wahrscheinlichkeiten geliefert.").into_response();
    };

    let tokens: Vec<InspectToken> = logprobs
        .content
        .into_iter()
        .map(|t| InspectToken {
            token: t.token,
            probability: t.logprob.exp(),
            alternatives: t
                .top_logprobs
                .into_iter()
                .map(|a| InspectAlt { token: a.token, probability: a.logprob.exp() })
                .collect(),
        })
        .collect();

    Json(serde_json::json!({ "model": MODEL, "tokens": tokens })).into_response()
}
