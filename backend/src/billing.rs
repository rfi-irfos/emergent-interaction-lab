use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    Json,
};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::Sha256;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{authz::require_admin, AppState};

type HmacSha256 = Hmac<Sha256>;

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

    // Additive: the payment link's own Stripe object id (`plink_...`), not
    // to be confused with `payment_link_url` (the opaque `buy.stripe.com/...`
    // slug) — Stripe manages those as two separate identifiers, so the URL
    // alone can't be used to recognize "this incoming webhook event is about
    // this product" later. Populated by create_payment_link below; read by
    // stripe_webhook to resolve an order back to the product it was for.
    // Same ALTER-TABLE-ADD-COLUMN-and-.ok() pattern as
    // simulation.rs::init_schema's related_signal_ids, for the same reason:
    // additive to an existing table, must not fail startup if it already
    // exists from a previous run.
    sqlx::query("ALTER TABLE products ADD COLUMN stripe_payment_link_id TEXT")
        .execute(db)
        .await
        .ok();

    // Real sales/orders visibility: previously a completed Stripe purchase
    // left zero trace anywhere in this system — payment links existed, but
    // nothing ever recorded that one had actually been paid. This table is
    // populated exclusively by stripe_webhook below, from real
    // `checkout.session.completed` events, never written to directly by any
    // admin action.
    //
    // `stripe_event_id` is UNIQUE and is the idempotency key: Stripe's
    // webhook delivery is at-least-once, not exactly-once, so the same
    // event can legitimately arrive more than once (retries after a slow
    // 2xx, redelivery after a Fly cold-start timeout, etc.) — stripe_webhook
    // uses `INSERT OR IGNORE` against this constraint so a duplicate
    // delivery is a no-op, not a second counted sale.
    //
    // `customer_email` carries exactly the same sensitivity as
    // `contact_messages.email` (see contact.rs) — admin-only, surfaced only
    // through the authenticated GET /api/billing/orders endpoint, never the
    // public storefront feed. Nothing beyond what Stripe's own
    // `checkout.session.completed` payload already includes is stored.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            stripe_event_id TEXT NOT NULL UNIQUE,
            stripe_session_id TEXT NOT NULL DEFAULT '',
            stripe_payment_link_id TEXT,
            product_id TEXT,
            amount_cents INTEGER NOT NULL,
            currency TEXT NOT NULL DEFAULT 'eur',
            customer_email TEXT,
            created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create orders");
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at)")
        .execute(db)
        .await
        .ok();
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

    crate::auditlog::record(&state, "admin", "product_created", &body.name, Some(json!({"id": id, "price_cents": body.price_cents, "currency": body.currency, "mode": body.mode}))).await;

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
    id: String,
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

    let _ = sqlx::query(
        "UPDATE products SET stripe_product_id = ?1, stripe_price_id = ?2, payment_link_url = ?3, stripe_payment_link_id = ?4 WHERE id = ?5",
    )
        .bind(&stripe_product.id)
        .bind(&stripe_price.id)
        .bind(&stripe_link.url)
        .bind(&stripe_link.id)
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

// ── Stripe webhook receiver + orders ─────────────────────────────────────────
//
// The other half of the payment-links mechanism above: a Payment Link gets a
// buyer to Stripe's checkout, but nothing in this system previously ever
// learned that a purchase actually completed. This section closes that loop:
// `stripe_webhook` verifies and records real `checkout.session.completed`
// events into `orders`, and `list_orders` is the admin-only read side (see
// Monetization.tsx's "Bestellungen" section).

/// Tolerance window (seconds) for the timestamp embedded in Stripe's
/// `Stripe-Signature` header, matching Stripe's own documented default —
/// guards against replay of an old, previously-valid signature, not just a
/// forged one. Kept generous rather than tight: this app's fly.toml scales
/// to zero between requests (see main.rs), so a cold start plus real network
/// latency can plausibly cost several seconds between Stripe signing the
/// request and this handler actually running it.
const STRIPE_WEBHOOK_TOLERANCE_SECS: i64 = 300;

/// Same constant-time byte comparison as `authz::require_admin`'s — kept as
/// its own small copy here rather than exporting authz's version, so the
/// comparison guarding whether an inbound webhook is trusted at all has no
/// cross-module coupling to audit; this file is sensitive enough to want
/// that boundary explicit.
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

/// Verifies a Stripe webhook's `Stripe-Signature` header against the raw
/// request body, per Stripe's documented scheme (see
/// https://docs.stripe.com/webhooks#verify-manually or any official
/// library's implementation): the header carries one or more
/// `t=<unix-ts>,v1=<hex-hmac>[,v1=<hex-hmac>...]` comma-separated pairs
/// (more than one `v1` shows up during a webhook signing-secret rotation —
/// a match against any single one is sufficient), and the signed message is
/// the literal byte string `"{timestamp}.{raw body}"`, HMAC-SHA256'd with
/// the webhook signing secret, hex-encoded.
///
/// Deliberately takes the raw, pre-JSON-parse bytes (`payload`) rather than
/// a re-serialized value — computing the HMAC over a round-tripped JSON
/// value would not reliably reproduce what Stripe actually signed (key
/// order, whitespace, and number formatting aren't guaranteed to survive a
/// parse-then-reserialize), so the signature must be checked before the
/// body is ever parsed as JSON at all.
fn verify_stripe_signature(
    payload: &[u8],
    sig_header: &str,
    secret: &str,
    tolerance_secs: i64,
) -> Result<(), String> {
    let mut timestamp: Option<i64> = None;
    let mut v1_sigs: Vec<&str> = Vec::new();
    for part in sig_header.split(',') {
        let mut kv = part.splitn(2, '=');
        let key = kv.next().unwrap_or("").trim();
        let value = kv.next().unwrap_or("").trim();
        match key {
            "t" => timestamp = value.parse::<i64>().ok(),
            "v1" => v1_sigs.push(value),
            _ => {}
        }
    }
    let Some(ts) = timestamp else {
        return Err("Stripe-Signature header missing a valid 't' component".to_string());
    };
    if v1_sigs.is_empty() {
        return Err("Stripe-Signature header missing a 'v1' component".to_string());
    }

    let now = chrono::Utc::now().timestamp();
    if (now - ts).abs() > tolerance_secs {
        return Err(format!(
            "timestamp {ts} outside {tolerance_secs}s tolerance of now ({now}) — possible replay"
        ));
    }

    let mut signed_payload = ts.to_string().into_bytes();
    signed_payload.push(b'.');
    signed_payload.extend_from_slice(payload);

    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return Err("webhook secret could not be used as an HMAC key".to_string()),
    };
    mac.update(&signed_payload);
    let expected_hex = hex::encode(mac.finalize().into_bytes());

    let matched = v1_sigs.iter().any(|sig| constant_time_eq(sig.as_bytes(), expected_hex.as_bytes()));
    if matched {
        Ok(())
    } else {
        Err("no 'v1' signature matched the computed HMAC".to_string())
    }
}

/// `POST /api/billing/webhook` — Stripe's own server calls this directly, so
/// it deliberately does NOT go through `require_admin` (Stripe has no way to
/// send our `x-chat-secret` header); trust instead comes entirely from the
/// `Stripe-Signature` HMAC check above. Handles
/// `checkout.session.completed` (a Payment Link completing checkout fires
/// this same event type); every other event type is acknowledged with 200
/// and otherwise ignored, since Stripe retries on anything but a 2xx and
/// there is currently nothing else here to react to.
///
/// Degrades the same way `create_payment_link` does when `STRIPE_SECRET_KEY`
/// is missing: an unconfigured `STRIPE_WEBHOOK_SECRET` logs a clear warning
/// and returns 503, never a panic and never a silent 200 that would let an
/// unverified event masquerade as processed.
pub async fn stripe_webhook(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if state.stripe_webhook_secret.is_empty() {
        tracing::warn!(
            "Stripe webhook received but STRIPE_WEBHOOK_SECRET is not configured — rejecting with 503, no order recorded. Set STRIPE_WEBHOOK_SECRET to enable sales tracking."
        );
        return (StatusCode::SERVICE_UNAVAILABLE, "STRIPE_WEBHOOK_SECRET not configured").into_response();
    }

    let Some(sig_header) = headers.get("stripe-signature").and_then(|v| v.to_str().ok()) else {
        tracing::warn!("Stripe webhook received with no Stripe-Signature header — rejected");
        return (StatusCode::BAD_REQUEST, "missing Stripe-Signature header").into_response();
    };

    if let Err(reason) = verify_stripe_signature(&body, sig_header, &state.stripe_webhook_secret, STRIPE_WEBHOOK_TOLERANCE_SECS) {
        tracing::warn!("Stripe webhook signature verification failed: {reason}");
        return (StatusCode::BAD_REQUEST, "signature verification failed").into_response();
    }

    // Only parsed as JSON once the signature above is confirmed to match —
    // an unverified body is never trusted enough to even look at its shape.
    let event: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Stripe webhook payload failed to parse as JSON despite a valid signature: {e}");
            return (StatusCode::BAD_REQUEST, "malformed payload").into_response();
        }
    };

    let event_id = event["id"].as_str().unwrap_or("").to_string();
    let event_type = event["type"].as_str().unwrap_or("").to_string();
    if event_id.is_empty() {
        tracing::warn!("Stripe webhook event has a valid signature but no 'id' field — cannot dedupe, rejecting");
        return (StatusCode::BAD_REQUEST, "missing event id").into_response();
    }

    if event_type != "checkout.session.completed" {
        tracing::info!("Stripe webhook: acknowledging and ignoring event type '{event_type}' (event {event_id})");
        return (StatusCode::OK, "ignored").into_response();
    }

    let obj = &event["data"]["object"];
    let session_id = obj["id"].as_str().unwrap_or("").to_string();
    let amount_cents = obj["amount_total"].as_i64().unwrap_or(0);
    let currency = obj["currency"].as_str().unwrap_or("eur").to_string();
    let customer_email = obj["customer_details"]["email"]
        .as_str()
        .or_else(|| obj["customer_email"].as_str())
        .map(|s| s.to_string());
    let payment_link_id = obj["payment_link"].as_str().map(|s| s.to_string());

    // Best-effort: resolve which of our own products this sale was for, so
    // the admin Orders view (Monetization.tsx) can show a real product name
    // instead of just a Stripe session id. `None` (no match, or no
    // payment_link on the session at all) is a normal, expected outcome —
    // not every checkout necessarily traces back to a Payment Link created
    // through this admin panel.
    let product_id: Option<String> = if let Some(ref pl_id) = payment_link_id {
        sqlx::query_scalar("SELECT id FROM products WHERE stripe_payment_link_id = ?1")
            .bind(pl_id)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None)
    } else {
        None
    };

    let order_id = Uuid::new_v4().to_string();
    let insert_result = sqlx::query(
        "INSERT OR IGNORE INTO orders \
         (id, stripe_event_id, stripe_session_id, stripe_payment_link_id, product_id, amount_cents, currency, customer_email) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
    )
    .bind(&order_id)
    .bind(&event_id)
    .bind(&session_id)
    .bind(&payment_link_id)
    .bind(&product_id)
    .bind(amount_cents)
    .bind(&currency)
    .bind(&customer_email)
    .execute(&state.db)
    .await;

    match insert_result {
        // `INSERT OR IGNORE` silently no-ops on the `stripe_event_id UNIQUE`
        // conflict — Stripe's at-least-once delivery means the exact same
        // event can arrive again (retry after a slow ack, redelivery after a
        // Fly cold-start timeout, etc.), and this must never count as a
        // second sale. Still answers 200: from Stripe's side this event was
        // already successfully processed the first time, so acknowledging
        // it again (rather than erroring) is what stops Stripe from
        // retrying forever.
        Ok(r) if r.rows_affected() == 0 => {
            tracing::info!("Stripe webhook: duplicate event {event_id} ignored (already recorded, not double-counted)");
        }
        Ok(_) => {
            tracing::info!(
                "Stripe webhook: order recorded for event {event_id} (session {session_id}, {amount_cents} {currency})"
            );
            crate::auditlog::record(&state, "stripe", "order_recorded", "Stripe-Bestellung erfasst", Some(json!({"order_id": order_id, "amount_cents": amount_cents, "currency": currency}))).await;
        }
        Err(e) => {
            tracing::error!("Stripe webhook: order insert failed for event {event_id}: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    }

    StatusCode::OK.into_response()
}

#[derive(Serialize)]
pub struct OrderOut {
    id: String,
    stripe_event_id: String,
    stripe_session_id: String,
    product_id: Option<String>,
    product_name: Option<String>,
    amount_cents: i64,
    currency: String,
    customer_email: Option<String>,
    created_at: String,
}

type OrderRow = (String, String, String, Option<String>, Option<String>, i64, String, Option<String>, String);
fn to_order_out(r: OrderRow) -> OrderOut {
    OrderOut {
        id: r.0,
        stripe_event_id: r.1,
        stripe_session_id: r.2,
        product_id: r.3,
        product_name: r.4,
        amount_cents: r.5,
        currency: r.6,
        customer_email: r.7,
        created_at: r.8,
    }
}

// Same default/max page-size convention as emergence::list_signals /
// simulation::list_runs — a small default keeps the first page cheap, a
// generous max keeps a single request from being able to force an
// unbounded scan.
const DEFAULT_ORDERS_LIMIT: i64 = 50;
const MAX_ORDERS_LIMIT: i64 = 200;

#[derive(Deserialize)]
pub struct ListOrdersQuery {
    limit: Option<i64>,
    offset: Option<i64>,
}

/// Admin-only — the whole point of this batch: previously a completed
/// Stripe sale left zero trace anywhere an admin could see it. Paginated
/// with the same `limit`/`offset` + `X-Total-Count` response header
/// convention as `emergence::list_signals` / `simulation::list_runs`, so the
/// Monetization.tsx "Bestellungen" list can reuse the exact same
/// load-more/pagination pattern the rest of the admin panel already has.
/// `customer_email` only ever appears through this authenticated endpoint —
/// same admin-only visibility as `contact_messages.email` — never the
/// public storefront feed.
pub async fn list_orders(State(state): State<AppState>, headers: HeaderMap, Query(q): Query<ListOrdersQuery>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let limit = q.limit.unwrap_or(DEFAULT_ORDERS_LIMIT).clamp(1, MAX_ORDERS_LIMIT);
    let offset = q.offset.unwrap_or(0).max(0);

    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders").fetch_one(&state.db).await.unwrap_or(0);

    let rows: Vec<OrderRow> = sqlx::query_as(
        "SELECT o.id, o.stripe_event_id, o.stripe_session_id, o.product_id, p.name, o.amount_cents, o.currency, o.customer_email, o.created_at \
         FROM orders o LEFT JOIN products p ON p.id = o.product_id \
         ORDER BY o.created_at DESC LIMIT ?1 OFFSET ?2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut resp = Json(rows.into_iter().map(to_order_out).collect::<Vec<_>>()).into_response();
    resp.headers_mut().insert(
        "x-total-count",
        HeaderValue::from_str(&total.to_string()).unwrap_or_else(|_| HeaderValue::from_static("0")),
    );
    resp
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::{Form, Query as AxQuery, State as AxState}, routing::post as axpost, Json as AxJson, Router};
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
        AxJson(json!({
            "id": format!("plink_mock_{}", Uuid::new_v4()),
            "url": format!("https://buy.stripe.com/test_{}", Uuid::new_v4()),
        }))
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
            // Overridden per-test (never a real value) wherever webhook
            // behavior is actually exercised — see the webhook test suite
            // below, which sets this to a throwaway test secret and never
            // logs or asserts on the value itself, only on behavior.
            stripe_webhook_secret: String::new(),
            ddg_api_base: "https://api.duckduckgo.com".to_string(),
            github_token: String::new(),
            github_api_base: "https://api.github.com".to_string(),
            chat_model_idx: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            chat_request_count: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            audit_lock: std::sync::Arc::new(tokio::sync::Mutex::new(())),
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

    // ── Stripe webhook signature verification + orders ──────────────────

    /// Computes a real Stripe-style `Stripe-Signature` header value the same
    /// way Stripe's own signing does: HMAC-SHA256 over `"{timestamp}.{raw
    /// payload}"`, hex-encoded, as `t=<ts>,v1=<hex>`. Used only by these
    /// tests to construct a genuinely valid signature against a throwaway
    /// test secret — no live Stripe account or credentials involved, and
    /// the secret used here is never a real one, never logged.
    fn sign_stripe_payload(secret: &str, timestamp: i64, payload: &[u8]) -> String {
        let mut signed_payload = timestamp.to_string().into_bytes();
        signed_payload.push(b'.');
        signed_payload.extend_from_slice(payload);
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(&signed_payload);
        let sig = hex::encode(mac.finalize().into_bytes());
        format!("t={timestamp},v1={sig}")
    }

    /// A minimal but realistic `checkout.session.completed` event body —
    /// only the fields stripe_webhook actually reads, matching the real
    /// Stripe payload shape (`data.object` is the Checkout Session).
    fn checkout_completed_payload(
        event_id: &str,
        session_id: &str,
        amount_cents: i64,
        currency: &str,
        email: Option<&str>,
        payment_link_id: Option<&str>,
    ) -> String {
        json!({
            "id": event_id,
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": session_id,
                    "amount_total": amount_cents,
                    "currency": currency,
                    "customer_details": { "email": email },
                    "payment_link": payment_link_id,
                }
            }
        })
        .to_string()
    }

    /// The core, non-negotiable guarantee: a genuinely valid Stripe
    /// signature (computed independently here, the same way Stripe itself
    /// would) results in a real order row with the right fields — and
    /// Stripe's at-least-once delivery redelivering the *exact same* event
    /// id a second time must not create a second row.
    #[tokio::test]
    async fn valid_signature_records_order_and_duplicate_event_id_is_not_double_counted() {
        let stripe_base = start_mock_stripe().await;
        let mut state = test_state(stripe_base).await;
        state.stripe_webhook_secret = "whsec_test_secret_never_real".to_string();

        let payload = checkout_completed_payload("evt_test_1", "cs_test_1", 4900, "eur", Some("laura@example.com"), None);
        let ts = chrono::Utc::now().timestamp();
        let sig = sign_stripe_payload(&state.stripe_webhook_secret, ts, payload.as_bytes());
        let mut headers = HeaderMap::new();
        headers.insert("stripe-signature", sig.parse().unwrap());

        let res1 = stripe_webhook(AxState(state.clone()), headers.clone(), Bytes::from(payload.clone())).await.into_response();
        assert_eq!(res1.status(), StatusCode::OK, "a validly-signed event must be accepted");

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders").fetch_one(&state.db).await.unwrap();
        assert_eq!(count, 1, "one valid event must record exactly one order");

        let row: (String, String, i64, String, Option<String>) = sqlx::query_as(
            "SELECT stripe_event_id, stripe_session_id, amount_cents, currency, customer_email FROM orders",
        )
        .fetch_one(&state.db)
        .await
        .unwrap();
        assert_eq!(row.0, "evt_test_1");
        assert_eq!(row.1, "cs_test_1");
        assert_eq!(row.2, 4900);
        assert_eq!(row.3, "eur");
        assert_eq!(row.4.as_deref(), Some("laura@example.com"));

        // Redelivery of the exact same event (Stripe's documented
        // at-least-once guarantee — a retry after a slow ack, or after this
        // app's Fly machine cold-starts mid-delivery, is expected behavior,
        // not an edge case).
        let res2 = stripe_webhook(AxState(state.clone()), headers, Bytes::from(payload)).await.into_response();
        assert_eq!(res2.status(), StatusCode::OK, "a duplicate delivery must still get a 2xx, or Stripe retries it forever");

        let count2: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders").fetch_one(&state.db).await.unwrap();
        assert_eq!(count2, 1, "the duplicate event id must not be double-counted");
        println!("VERIFIED: valid Stripe-style signature -> order inserted (event=evt_test_1, session=cs_test_1, 4900 eur); redelivered duplicate event id -> row count stayed {count2}");
    }

    /// A signature computed with the wrong secret (forged, or corrupted in
    /// transit) must be rejected outright — no order recorded, no trust
    /// extended to the payload at all.
    #[tokio::test]
    async fn invalid_signature_is_rejected() {
        let stripe_base = start_mock_stripe().await;
        let mut state = test_state(stripe_base).await;
        state.stripe_webhook_secret = "whsec_the_real_configured_secret".to_string();

        let payload = checkout_completed_payload("evt_test_bad_sig", "cs_test_bad", 1000, "eur", None, None);
        let ts = chrono::Utc::now().timestamp();
        let bad_sig = sign_stripe_payload("whsec_a_completely_different_secret", ts, payload.as_bytes());
        let mut headers = HeaderMap::new();
        headers.insert("stripe-signature", bad_sig.parse().unwrap());

        let res = stripe_webhook(AxState(state.clone()), headers, Bytes::from(payload)).await.into_response();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST, "a signature computed with the wrong secret must be rejected");

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders").fetch_one(&state.db).await.unwrap();
        assert_eq!(count, 0, "an invalid signature must never result in a recorded order");
        println!("VERIFIED: invalid signature -> 400, orders table stayed empty");
    }

    /// No `Stripe-Signature` header at all — same rejection as a wrong one,
    /// not treated as "unauthenticated but allowed" or a soft-pass.
    #[tokio::test]
    async fn missing_signature_header_is_rejected() {
        let stripe_base = start_mock_stripe().await;
        let mut state = test_state(stripe_base).await;
        state.stripe_webhook_secret = "whsec_the_real_configured_secret".to_string();

        let payload = checkout_completed_payload("evt_test_no_sig", "cs_test_no_sig", 1000, "eur", None, None);
        let res = stripe_webhook(AxState(state.clone()), HeaderMap::new(), Bytes::from(payload)).await.into_response();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders").fetch_one(&state.db).await.unwrap();
        assert_eq!(count, 0);
    }

    /// Matches `missing_stripe_secret_key_fails_gracefully_not_silently`
    /// above for `STRIPE_SECRET_KEY`: an unconfigured
    /// `STRIPE_WEBHOOK_SECRET` must degrade to a clear 503, never panic and
    /// never silently accept an unverifiable payload as if it were trusted.
    #[tokio::test]
    async fn missing_webhook_secret_degrades_gracefully_not_loudly() {
        let stripe_base = start_mock_stripe().await;
        let state = test_state(stripe_base).await; // stripe_webhook_secret left empty

        let payload = checkout_completed_payload("evt_test_no_secret", "cs_test_no_secret", 1000, "eur", None, None);
        let res = stripe_webhook(AxState(state.clone()), HeaderMap::new(), Bytes::from(payload)).await.into_response();
        assert_eq!(
            res.status(),
            StatusCode::SERVICE_UNAVAILABLE,
            "an unconfigured webhook secret must degrade to 503, never panic and never silently accept"
        );

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders").fetch_one(&state.db).await.unwrap();
        assert_eq!(count, 0);
    }

    /// Closes the loop this whole batch exists for: a real product gets a
    /// real (mock) payment link, its Stripe payment-link id lands in
    /// `products.stripe_payment_link_id`, and a webhook event referencing
    /// that same id resolves back to the product's name through
    /// `GET /api/billing/orders` — not just an anonymous session id.
    #[tokio::test]
    async fn webhook_order_resolves_to_known_product_via_payment_link_id() {
        let stripe_base = start_mock_stripe().await;
        let mut state = test_state(stripe_base).await;
        state.stripe_webhook_secret = "whsec_resolve_test".to_string();

        let create_res = create_product(
            AxState(state.clone()),
            HeaderMap::new(),
            AxJson(CreateProductReq {
                name: "State of Emergent Interaction - Q1 Report".to_string(),
                description: "test fixture".to_string(),
                price_cents: 4900,
                currency: "eur".to_string(),
                mode: "payment".to_string(),
                recurring_interval: None,
            }),
        )
        .await
        .into_response();
        let create_bytes = axum::body::to_bytes(create_res.into_body(), usize::MAX).await.unwrap();
        let product_id = serde_json::from_slice::<serde_json::Value>(&create_bytes).unwrap()["id"].as_str().unwrap().to_string();

        create_payment_link(AxState(state.clone()), HeaderMap::new(), Path(product_id.clone())).await;

        let plink_id: String = sqlx::query_scalar("SELECT stripe_payment_link_id FROM products WHERE id = ?1")
            .bind(&product_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert!(plink_id.starts_with("plink_mock_"));

        let payload = checkout_completed_payload("evt_test_resolve", "cs_test_resolve", 4900, "eur", Some("buyer@example.com"), Some(&plink_id));
        let ts = chrono::Utc::now().timestamp();
        let sig = sign_stripe_payload(&state.stripe_webhook_secret, ts, payload.as_bytes());
        let mut headers = HeaderMap::new();
        headers.insert("stripe-signature", sig.parse().unwrap());

        let res = stripe_webhook(AxState(state.clone()), headers, Bytes::from(payload)).await.into_response();
        assert_eq!(res.status(), StatusCode::OK);

        let orders_res = list_orders(AxState(state.clone()), HeaderMap::new(), AxQuery(ListOrdersQuery { limit: None, offset: None }))
            .await
            .into_response();
        let orders_bytes = axum::body::to_bytes(orders_res.into_body(), usize::MAX).await.unwrap();
        let orders: Vec<serde_json::Value> = serde_json::from_slice(&orders_bytes).unwrap();
        assert_eq!(orders.len(), 1);
        assert_eq!(orders[0]["product_id"], product_id);
        assert_eq!(orders[0]["product_name"], "State of Emergent Interaction - Q1 Report");
        assert_eq!(orders[0]["customer_email"], "buyer@example.com");
    }

    /// `GET /api/billing/orders` must actually require admin auth when one
    /// is configured (not just when the header happens to be absent by
    /// coincidence), and must page with the same limit/offset +
    /// X-Total-Count convention as emergence::list_signals.
    #[tokio::test]
    async fn orders_endpoint_is_admin_only_and_paginates() {
        let stripe_base = start_mock_stripe().await;
        let mut state = test_state(stripe_base).await;
        state.stripe_webhook_secret = "whsec_pagination_test".to_string();

        for i in 0..3i64 {
            let payload = checkout_completed_payload(&format!("evt_page_{i}"), &format!("cs_page_{i}"), 1000 + i, "eur", None, None);
            let ts = chrono::Utc::now().timestamp();
            let sig = sign_stripe_payload(&state.stripe_webhook_secret, ts, payload.as_bytes());
            let mut headers = HeaderMap::new();
            headers.insert("stripe-signature", sig.parse().unwrap());
            let res = stripe_webhook(AxState(state.clone()), headers, Bytes::from(payload)).await.into_response();
            assert_eq!(res.status(), StatusCode::OK);
        }

        // Admin gate: once a real chat_secret is configured, an
        // unauthenticated request must be rejected — same mechanism as
        // every other admin endpoint (authz::require_admin).
        state.chat_secret = "real-admin-secret-for-this-test".to_string();
        let unauth_res = list_orders(AxState(state.clone()), HeaderMap::new(), AxQuery(ListOrdersQuery { limit: None, offset: None }))
            .await
            .into_response();
        assert_eq!(unauth_res.status(), StatusCode::UNAUTHORIZED);

        let mut auth_headers = HeaderMap::new();
        auth_headers.insert("x-chat-secret", "real-admin-secret-for-this-test".parse().unwrap());

        let page1 = list_orders(AxState(state.clone()), auth_headers.clone(), AxQuery(ListOrdersQuery { limit: Some(2), offset: Some(0) }))
            .await
            .into_response();
        assert_eq!(page1.status(), StatusCode::OK);
        let total_header = page1.headers().get("x-total-count").and_then(|v| v.to_str().ok()).map(|s| s.to_string());
        assert_eq!(total_header.as_deref(), Some("3"), "X-Total-Count must reflect the true total, not just this page's size");
        let page1_bytes = axum::body::to_bytes(page1.into_body(), usize::MAX).await.unwrap();
        let page1_body: Vec<serde_json::Value> = serde_json::from_slice(&page1_bytes).unwrap();
        assert_eq!(page1_body.len(), 2);

        let page2 = list_orders(AxState(state.clone()), auth_headers, AxQuery(ListOrdersQuery { limit: Some(2), offset: Some(2) }))
            .await
            .into_response();
        let page2_bytes = axum::body::to_bytes(page2.into_body(), usize::MAX).await.unwrap();
        let page2_body: Vec<serde_json::Value> = serde_json::from_slice(&page2_bytes).unwrap();
        assert_eq!(page2_body.len(), 1, "the 3rd order must be reachable via offset");
    }
}
