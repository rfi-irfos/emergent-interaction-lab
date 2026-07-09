use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{authz::require_admin, AppState};

/// Generic "define a sellable product, get a real Stripe Payment Link"
/// mechanism — the shared foundation behind the framework-license, research-
/// report, and certification revenue streams from the business plan. Not
/// tied to any one product; each row here is one thing that can be sold.
pub async fn init_schema(db: &SqlitePool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            price_cents INTEGER NOT NULL,
            currency TEXT NOT NULL DEFAULT 'eur',
            mode TEXT NOT NULL DEFAULT 'payment',
            recurring_interval TEXT,
            stripe_product_id TEXT,
            stripe_price_id TEXT,
            payment_link_url TEXT,
            created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create products");
}

#[derive(Deserialize)]
pub struct CreateProductReq {
    name: String,
    description: String,
    price_cents: i64,
    currency: String,
    mode: String,
    recurring_interval: Option<String>,
}

pub async fn list_products(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let rows: Vec<(String, String, String, i64, String, String, Option<String>, Option<String>, Option<String>, Option<String>, String)> = sqlx::query_as(
        "SELECT id, name, description, price_cents, currency, mode, recurring_interval, stripe_product_id, stripe_price_id, payment_link_url, created_at FROM products ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(
        rows.into_iter()
            .map(|(id, name, description, price_cents, currency, mode, recurring_interval, stripe_product_id, stripe_price_id, payment_link_url, created_at)| {
                json!({
                    "id": id,
                    "name": name,
                    "description": description,
                    "price_cents": price_cents,
                    "currency": currency,
                    "mode": mode,
                    "recurring_interval": recurring_interval,
                    "stripe_product_id": stripe_product_id,
                    "stripe_price_id": stripe_price_id,
                    "payment_link_url": payment_link_url,
                    "created_at": created_at,
                })
            })
            .collect::<Vec<_>>(),
    )
    .into_response()
}

pub async fn create_product(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateProductReq>,
) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if body.name.trim().is_empty() || body.price_cents <= 0 {
        return (StatusCode::BAD_REQUEST, "name is required and price_cents must be positive").into_response();
    }
    if body.mode != "payment" && body.mode != "subscription" {
        return (StatusCode::BAD_REQUEST, "mode must be 'payment' or 'subscription'").into_response();
    }
    if body.mode == "subscription" && body.recurring_interval.as_deref().unwrap_or("").is_empty() {
        return (StatusCode::BAD_REQUEST, "recurring_interval is required when mode is 'subscription'").into_response();
    }

    let id = Uuid::new_v4().to_string();
    let _ = sqlx::query(
        "INSERT INTO products (id, name, description, price_cents, currency, mode, recurring_interval) VALUES (?1,?2,?3,?4,?5,?6,?7)",
    )
    .bind(&id)
    .bind(&body.name)
    .bind(&body.description)
    .bind(body.price_cents)
    .bind(&body.currency)
    .bind(&body.mode)
    .bind(&body.recurring_interval)
    .execute(&state.db)
    .await;

    Json(json!({ "ok": true, "id": id })).into_response()
}

pub async fn delete_product(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    // Deleting the local row does not deactivate an already-generated Stripe
    // payment link on Stripe's side — that's a separate, deliberate action
    // an admin would take directly in the Stripe dashboard if a product is
    // being retired after going live.
    let _ = sqlx::query("DELETE FROM products WHERE id = ?1").bind(&id).execute(&state.db).await;
    StatusCode::NO_CONTENT.into_response()
}

#[derive(Deserialize)]
struct StripeIdResp {
    id: String,
}
#[derive(Deserialize)]
struct StripeLinkResp {
    url: String,
}

/// Turns a product row into a real, shareable Stripe Payment Link:
/// Product -> Price -> Payment Link, in that order (Stripe's Payment Links
/// API requires an existing Price object, unlike Checkout Sessions which
/// accept inline price data).
pub async fn create_payment_link(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if state.stripe_secret_key.is_empty() {
        return (StatusCode::SERVICE_UNAVAILABLE, "STRIPE_SECRET_KEY not configured").into_response();
    }

    let row: Option<(String, String, i64, String, String, Option<String>)> = sqlx::query_as(
        "SELECT name, description, price_cents, currency, mode, recurring_interval FROM products WHERE id = ?1",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);
    let Some((name, description, price_cents, currency, mode, recurring_interval)) = row else {
        return (StatusCode::NOT_FOUND, "product not found").into_response();
    };

    let client = &state.http;
    let secret = &state.stripe_secret_key;

    let product_res = client
        .post("https://api.stripe.com/v1/products")
        .basic_auth(secret, Option::<String>::None)
        .form(&[("name", name.as_str()), ("description", description.as_str())])
        .send()
        .await;
    let stripe_product: StripeIdResp = match stripe_json(product_res, "product").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let mut price_form: Vec<(&str, String)> = vec![
        ("unit_amount", price_cents.to_string()),
        ("currency", currency),
        ("product", stripe_product.id.clone()),
    ];
    if mode == "subscription" {
        if let Some(interval) = recurring_interval {
            price_form.push(("recurring[interval]", interval));
        }
    }
    let price_res = client
        .post("https://api.stripe.com/v1/prices")
        .basic_auth(secret, Option::<String>::None)
        .form(&price_form)
        .send()
        .await;
    let stripe_price: StripeIdResp = match stripe_json(price_res, "price").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let link_res = client
        .post("https://api.stripe.com/v1/payment_links")
        .basic_auth(secret, Option::<String>::None)
        .form(&[("line_items[0][price]", stripe_price.id.as_str()), ("line_items[0][quantity]", "1")])
        .send()
        .await;
    let stripe_link: StripeLinkResp = match stripe_json(link_res, "payment link").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let _ = sqlx::query("UPDATE products SET stripe_product_id = ?1, stripe_price_id = ?2, payment_link_url = ?3 WHERE id = ?4")
        .bind(&stripe_product.id)
        .bind(&stripe_price.id)
        .bind(&stripe_link.url)
        .bind(&id)
        .execute(&state.db)
        .await;

    Json(json!({ "ok": true, "payment_link_url": stripe_link.url })).into_response()
}

/// Shared error handling for the three sequential Stripe calls above —
/// every one of them can fail for the same reasons (network error, non-2xx
/// status, unparseable body), so this collapses that into one place.
async fn stripe_json<T: serde::de::DeserializeOwned>(
    res: Result<reqwest::Response, reqwest::Error>,
    what: &str,
) -> Result<T, axum::response::Response> {
    match res {
        Ok(r) if r.status().is_success() => r.json::<T>().await.map_err(|e| {
            (StatusCode::BAD_GATEWAY, format!("stripe {what} response could not be parsed: {e}")).into_response()
        }),
        Ok(r) => {
            let status = r.status();
            let text = r.text().await.unwrap_or_default();
            tracing::error!("stripe {what} create failed {status}: {text}");
            Err((StatusCode::BAD_GATEWAY, format!("Stripe-Anfrage ({what}) fehlgeschlagen.")).into_response())
        }
        Err(e) => Err((StatusCode::BAD_GATEWAY, format!("stripe request failed: {e}")).into_response()),
    }
}
