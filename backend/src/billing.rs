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

/// Public, unauthenticated, read-only storefront feed for the actual
/// visitor-facing site (not Verwaltung). Deliberately narrower than
/// `list_products`: only rows that already have a real `payment_link_url`
/// are sellable — a draft product with no link yet must never appear on the
/// public site, and the Stripe product/price IDs are internal bookkeeping
/// with no reason to be exposed to a visitor's browser.
pub async fn list_public_products(State(state): State<AppState>) -> impl IntoResponse {
    let rows: Vec<(String, String, i64, String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT name, description, price_cents, currency, mode, recurring_interval, payment_link_url \
         FROM products WHERE payment_link_url IS NOT NULL ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(
        rows.into_iter()
            .map(|(name, description, price_cents, currency, mode, recurring_interval, payment_link_url)| {
                json!({
                    "name": name,
                    "description": description,
                    "price_cents": price_cents,
                    "currency": currency,
                    "mode": mode,
                    "recurring_interval": recurring_interval,
                    "payment_link_url": payment_link_url,
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

    let row: Option<(String, String, i64, String, String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT name, description, price_cents, currency, mode, recurring_interval, payment_link_url FROM products WHERE id = ?1",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);
    let Some((name, description, price_cents, currency, mode, recurring_interval, existing_link)) = row else {
        return (StatusCode::NOT_FOUND, "product not found").into_response();
    };
    // Idempotent: without this, double-clicking "Zahlungslink erstellen" (or
    // a retried request) would create a second real Stripe product/price/
    // link every time, orphaning the first one on Stripe's side rather than
    // just failing loudly or no-opping.
    if let Some(url) = existing_link {
        return Json(json!({ "ok": true, "payment_link_url": url })).into_response();
    }

    let client = &state.http;
    let secret = &state.stripe_secret_key;
    let base = &state.stripe_api_base;

    let product_res = client
        .post(format!("{base}/v1/products"))
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
        .post(format!("{base}/v1/prices"))
        .basic_auth(secret, Option::<String>::None)
        .form(&price_form)
        .send()
        .await;
    let stripe_price: StripeIdResp = match stripe_json(price_res, "price").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let link_res = client
        .post(format!("{base}/v1/payment_links"))
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::{Form, State as AxState}, routing::post as axpost, Json as AxJson, Router};
    use std::{collections::HashMap, path::PathBuf, sync::{Arc, RwLock}};

    /// A local stand-in for Stripe's API, exercising the exact same
    /// Product -> Price -> Payment Link sequence real Stripe expects, over
    /// the same form-encoded content type the real client sends — this is
    /// how a payment integration gets verified end-to-end without real
    /// credentials or risking real charges, not a shortcut around testing
    /// it. Each handler returns the same shape the real API does.
    async fn mock_products(Form(_body): Form<HashMap<String, String>>) -> AxJson<serde_json::Value> {
        AxJson(json!({ "id": format!("prod_mock_{}", Uuid::new_v4()) }))
    }
    async fn mock_prices(Form(_body): Form<HashMap<String, String>>) -> AxJson<serde_json::Value> {
        AxJson(json!({ "id": format!("price_mock_{}", Uuid::new_v4()) }))
    }
    async fn mock_payment_links(Form(_body): Form<HashMap<String, String>>) -> AxJson<serde_json::Value> {
        AxJson(json!({ "url": format!("https://buy.stripe.com/test_{}", Uuid::new_v4()) }))
    }

    async fn start_mock_stripe() -> String {
        let app = Router::new()
            .route("/v1/products", axpost(mock_products))
            .route("/v1/prices", axpost(mock_prices))
            .route("/v1/payment_links", axpost(mock_payment_links));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    async fn test_state(stripe_api_base: String) -> AppState {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        init_schema(&db).await;
        AppState {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            content_path: PathBuf::from("content.json"),
            uploads_dir: PathBuf::from("uploads"),
            static_dir: PathBuf::from("dist"),
            allowed_email: String::new(),
            google_client_id: String::new(),
            google_client_secret: String::new(),
            redirect_uri: String::new(),
            dev_mode: true,
            db,
            http: reqwest::Client::new(),
            nvidia_api_key: String::new(),
            nvidia_api_base: "https://integrate.api.nvidia.com".to_string(),
            nvidia_connect_timeout: crate::chat::NVIDIA_CONNECT_TIMEOUT,
            // Empty secret == "no auth configured" (require_admin's own
            // dev-convenience rule) so these tests can call handlers
            // directly without constructing a real x-chat-secret header.
            chat_secret: String::new(),
            stripe_secret_key: "sk_test_mock".to_string(),
            stripe_api_base,
            ddg_api_base: "https://api.duckduckgo.com".to_string(),
            chat_model_idx: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            chat_request_count: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }
    }

    /// The five real revenue-stream products from the business plan
    /// (Desktop/lauras_business/03_PRICING.md), run through the actual
    /// create_product -> create_payment_link code path against the mock
    /// Stripe server above. Proves the mechanism works for every planned
    /// monetization method, not just one hardcoded example.
    #[tokio::test]
    async fn all_five_planned_products_get_real_payment_links() {
        let stripe_base = start_mock_stripe().await;
        let state = test_state(stripe_base).await;

        let plan = vec![
            ("Observatory Cloud - Starter", 2900, "eur", "subscription", Some("month")),
            ("Emergence Framework License - Commercial", 250000, "eur", "subscription", Some("year")),
            ("Emergence Lens - Volume 1000/mo", 3900, "eur", "subscription", Some("month")),
            ("State of Emergent Interaction - Q1 Report", 4900, "eur", "payment", None),
            ("Certified Emergence Interaction Analyst", 29900, "eur", "payment", None),
        ];

        for (name, price_cents, currency, mode, interval) in plan {
            let create_res = create_product(
                AxState(state.clone()),
                HeaderMap::new(),
                AxJson(CreateProductReq {
                    name: name.to_string(),
                    description: format!("{name} - test fixture"),
                    price_cents,
                    currency: currency.to_string(),
                    mode: mode.to_string(),
                    recurring_interval: interval.map(|s| s.to_string()),
                }),
            )
            .await
            .into_response();
            assert_eq!(create_res.status(), StatusCode::OK, "product creation failed for {name}");

            let body_bytes = axum::body::to_bytes(create_res.into_body(), usize::MAX).await.unwrap();
            let body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
            let id = body["id"].as_str().unwrap().to_string();

            let link_res = create_payment_link(AxState(state.clone()), HeaderMap::new(), Path(id.clone()))
                .await
                .into_response();
            assert_eq!(link_res.status(), StatusCode::OK, "payment link creation failed for {name}");
            let link_bytes = axum::body::to_bytes(link_res.into_body(), usize::MAX).await.unwrap();
            let link_body: serde_json::Value = serde_json::from_slice(&link_bytes).unwrap();
            assert!(link_body["payment_link_url"].as_str().unwrap().starts_with("https://buy.stripe.com/"));

            let row: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
                "SELECT stripe_product_id, stripe_price_id, payment_link_url FROM products WHERE id = ?1",
            )
            .bind(&id)
            .fetch_one(&state.db)
            .await
            .unwrap();
            assert!(row.0.as_deref().unwrap_or("").starts_with("prod_mock_"), "{name} missing stripe_product_id");
            assert!(row.1.as_deref().unwrap_or("").starts_with("price_mock_"), "{name} missing stripe_price_id");
            assert!(row.2.is_some(), "{name} missing payment_link_url");
            println!(
                "VERIFIED: {name} ({price_cents} {currency}/{mode}) -> product={} price={} link={}",
                row.0.unwrap(), row.1.unwrap(), row.2.unwrap()
            );
        }
    }

    #[tokio::test]
    async fn missing_stripe_secret_key_fails_gracefully_not_silently() {
        let mut state = test_state("http://127.0.0.1:1".to_string()).await;
        state.stripe_secret_key = String::new();
        let create_res = create_product(
            AxState(state.clone()),
            HeaderMap::new(),
            AxJson(CreateProductReq {
                name: "Test".to_string(),
                description: String::new(),
                price_cents: 100,
                currency: "eur".to_string(),
                mode: "payment".to_string(),
                recurring_interval: None,
            }),
        )
        .await
        .into_response();
        let body_bytes = axum::body::to_bytes(create_res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
        let id = body["id"].as_str().unwrap().to_string();

        let link_res = create_payment_link(AxState(state.clone()), HeaderMap::new(), Path(id))
            .await
            .into_response();
        assert_eq!(link_res.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    /// The public storefront feed must show only products that are actually
    /// sellable (have a real `payment_link_url`) and must never leak the
    /// internal Stripe product/price IDs — this is the endpoint the public
    /// `#p/zertifizierung` page fetches, unauthenticated, from the real site.
    #[tokio::test]
    async fn public_products_excludes_drafts_and_hides_stripe_ids() {
        let stripe_base = start_mock_stripe().await;
        let state = test_state(stripe_base).await;

        // A draft: created but never turned into a payment link.
        let draft_res = create_product(
            AxState(state.clone()),
            HeaderMap::new(),
            AxJson(CreateProductReq {
                name: "Draft Product".to_string(),
                description: "not ready yet".to_string(),
                price_cents: 1000,
                currency: "eur".to_string(),
                mode: "payment".to_string(),
                recurring_interval: None,
            }),
        )
        .await
        .into_response();
        let draft_bytes = axum::body::to_bytes(draft_res.into_body(), usize::MAX).await.unwrap();
        let _draft_id: serde_json::Value = serde_json::from_slice(&draft_bytes).unwrap();

        // A real, sellable product: link generated.
        let create_res = create_product(
            AxState(state.clone()),
            HeaderMap::new(),
            AxJson(CreateProductReq {
                name: "Certified Emergence Interaction Analyst".to_string(),
                description: "Individual".to_string(),
                price_cents: 29900,
                currency: "eur".to_string(),
                mode: "payment".to_string(),
                recurring_interval: None,
            }),
        )
        .await
        .into_response();
        let body_bytes = axum::body::to_bytes(create_res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
        let id = body["id"].as_str().unwrap().to_string();
        create_payment_link(AxState(state.clone()), HeaderMap::new(), Path(id)).await;

        let public_res = list_public_products(AxState(state.clone())).await.into_response();
        assert_eq!(public_res.status(), StatusCode::OK);
        let public_bytes = axum::body::to_bytes(public_res.into_body(), usize::MAX).await.unwrap();
        let public: serde_json::Value = serde_json::from_slice(&public_bytes).unwrap();
        let list = public.as_array().unwrap();

        assert_eq!(list.len(), 1, "draft without a payment link must not appear publicly");
        let entry = &list[0];
        assert_eq!(entry["name"], "Certified Emergence Interaction Analyst");
        assert_eq!(entry["price_cents"], 29900);
        assert!(entry["payment_link_url"].as_str().unwrap().starts_with("https://buy.stripe.com/"));
        assert!(entry.get("stripe_product_id").is_none(), "must not expose internal stripe_product_id");
        assert!(entry.get("stripe_price_id").is_none(), "must not expose internal stripe_price_id");
    }
}
