use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{QueryBuilder, Sqlite, SqlitePool};
use uuid::Uuid;

use crate::{authz::require_admin, AppState};

/// Customizable Dashboard system (plan §A2) — an admin-only canvas of
/// draggable/resizable chart widgets picked from a fixed frontend catalog
/// (`frontend/src/components/observatory/dashboardCatalog.ts`). This module
/// only ever stores *placement* (which catalog entry, where, how big, what
/// title/color override) — it never stores chart data itself, which is
/// always fetched live from the existing per-module endpoints the catalog
/// entry points at.
///
/// Deliberately **no** `creator`/`is_public`/`is_template`/sharing table —
/// same "right-sized, not verbatim" call already made once this session for
/// the audit-log hash-chain port (see auditlog.rs's own doc comment). This
/// is a single-admin tool: `authz::require_admin` doesn't distinguish
/// *which* admin at all today, so a per-user ownership model here would be
/// speculative complexity with nothing yet to attach it to.
pub async fn init_schema(db: &SqlitePool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS dashboards (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT (datetime('now')),
            updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create dashboards");
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS dashboard_widgets (
            id TEXT PRIMARY KEY,
            dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
            catalog_key TEXT NOT NULL,
            title TEXT,
            color_key TEXT,
            position_x INTEGER NOT NULL DEFAULT 0,
            position_y INTEGER NOT NULL DEFAULT 0,
            width INTEGER NOT NULL DEFAULT 4,
            height INTEGER NOT NULL DEFAULT 3,
            created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(db)
    .await
    .expect("create dashboard_widgets");
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_dw_dashboard ON dashboard_widgets(dashboard_id)")
        .execute(db)
        .await
        .ok();
}

// ── output shapes ────────────────────────────────────────────────────────

#[derive(Serialize)]
struct DashboardSummary {
    id: String,
    name: String,
    is_default: bool,
}

#[derive(Serialize)]
struct WidgetOut {
    id: String,
    dashboard_id: String,
    catalog_key: String,
    title: Option<String>,
    color_key: Option<String>,
    position_x: i64,
    position_y: i64,
    width: i64,
    height: i64,
    created_at: String,
}

#[derive(Serialize)]
struct DashboardDetail {
    id: String,
    name: String,
    is_default: bool,
    created_at: String,
    updated_at: String,
    widgets: Vec<WidgetOut>,
}

type SummaryRow = (String, String, bool);
type DashboardRow = (String, String, bool, String, String);
type WidgetRow = (String, String, String, Option<String>, Option<String>, i64, i64, i64, i64, String);

fn widget_row_to_out(r: WidgetRow) -> WidgetOut {
    WidgetOut {
        id: r.0,
        dashboard_id: r.1,
        catalog_key: r.2,
        title: r.3,
        color_key: r.4,
        position_x: r.5,
        position_y: r.6,
        width: r.7,
        height: r.8,
        created_at: r.9,
    }
}

// ── dashboards ───────────────────────────────────────────────────────────

/// `GET /api/dashboards` — the picker/switcher list, deliberately thin (no
/// nested widgets here — see `get_dashboard` below for the one-dashboard,
/// widgets-included view).
pub async fn list_dashboards(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let rows: Vec<SummaryRow> = sqlx::query_as("SELECT id, name, is_default FROM dashboards ORDER BY created_at DESC")
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();
    let out: Vec<DashboardSummary> = rows
        .into_iter()
        .map(|(id, name, is_default)| DashboardSummary { id, name, is_default })
        .collect();
    Json(out).into_response()
}

#[derive(Deserialize)]
pub struct CreateDashboardReq {
    name: String,
}

/// `POST /api/dashboards` — always created with `is_default = 0`; there is
/// no route in this phase to change that flag, matching the exact route
/// list this module was scoped to (no speculative "set as default"
/// endpoint).
pub async fn create_dashboard(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<CreateDashboardReq>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let name = req.name.trim();
    if name.is_empty() {
        return (StatusCode::BAD_REQUEST, "name ist erforderlich.").into_response();
    }
    let id = Uuid::new_v4().to_string();
    let _ = sqlx::query("INSERT INTO dashboards (id, name) VALUES (?1,?2)")
        .bind(&id)
        .bind(name)
        .execute(&state.db)
        .await;
    Json(json!({ "id": id })).into_response()
}

/// `DELETE /api/dashboards/:id` — cascades to every one of its
/// `dashboard_widgets` rows via the `ON DELETE CASCADE` foreign key (sqlx's
/// SQLite driver enables `PRAGMA foreign_keys` by default per connection —
/// see `SqliteConnectOptions::default()` — so this is a real DB-enforced
/// cascade, not something this handler has to do by hand).
pub async fn delete_dashboard(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _ = sqlx::query("DELETE FROM dashboards WHERE id = ?1").bind(&id).execute(&state.db).await;
    crate::auditlog::record(&state, "admin", "dashboard_deleted", "Dashboard gelöscht", Some(json!({"id": id}))).await;
    StatusCode::NO_CONTENT.into_response()
}

/// `GET /api/dashboards/:id` — the dashboard plus every one of its widgets
/// in one response (two queries total: one for the dashboard row, one for
/// all its widgets — never one query per widget).
pub async fn get_dashboard(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let row: Option<DashboardRow> = sqlx::query_as("SELECT id, name, is_default, created_at, updated_at FROM dashboards WHERE id = ?1")
        .bind(&id)
        .fetch_optional(&state.db)
        .await
        .unwrap_or(None);
    let Some((id, name, is_default, created_at, updated_at)) = row else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let widget_rows: Vec<WidgetRow> = sqlx::query_as(
        "SELECT id, dashboard_id, catalog_key, title, color_key, position_x, position_y, width, height, created_at \
         FROM dashboard_widgets WHERE dashboard_id = ?1 ORDER BY created_at ASC, rowid ASC",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(DashboardDetail {
        id,
        name,
        is_default,
        created_at,
        updated_at,
        widgets: widget_rows.into_iter().map(widget_row_to_out).collect(),
    })
    .into_response()
}

// ── widgets ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateWidgetReq {
    catalog_key: String,
    position_x: i64,
    position_y: i64,
    width: i64,
    height: i64,
    title: Option<String>,
    color_key: Option<String>,
}

/// `POST /api/dashboards/:id/widgets` — adds one widget from the frontend's
/// fixed catalog to the given dashboard. 404s on an unknown dashboard id
/// (checked explicitly, same `fetch_optional` + `NOT_FOUND` idiom as
/// `billing::create_payment_link`'s product lookup) rather than letting an
/// orphan-referencing insert fail on the foreign key constraint unchecked.
pub async fn add_widget(State(state): State<AppState>, headers: HeaderMap, Path(dashboard_id): Path<String>, Json(req): Json<CreateWidgetReq>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM dashboards WHERE id = ?1")
        .bind(&dashboard_id)
        .fetch_optional(&state.db)
        .await
        .unwrap_or(None);
    if exists.is_none() {
        return (StatusCode::NOT_FOUND, "dashboard not found").into_response();
    }

    let id = Uuid::new_v4().to_string();
    let _ = sqlx::query(
        "INSERT INTO dashboard_widgets (id, dashboard_id, catalog_key, title, color_key, position_x, position_y, width, height) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
    )
    .bind(&id)
    .bind(&dashboard_id)
    .bind(&req.catalog_key)
    .bind(&req.title)
    .bind(&req.color_key)
    .bind(req.position_x)
    .bind(req.position_y)
    .bind(req.width)
    .bind(req.height)
    .execute(&state.db)
    .await;

    Json(json!({ "id": id })).into_response()
}

#[derive(Deserialize, Default)]
pub struct UpdateWidgetReq {
    title: Option<String>,
    color_key: Option<String>,
    catalog_key: Option<String>,
    position_x: Option<i64>,
    position_y: Option<i64>,
    width: Option<i64>,
    height: Option<i64>,
}

/// `PATCH /api/dashboards/widgets/:id` — the one endpoint the frontend hits
/// both on drag/resize (mouseup-debounced, not mousemove) and on
/// pencil-popover field edits. Builds one dynamic `UPDATE ... SET`
/// statement covering only the fields actually present in the body — a
/// field simply absent from the JSON leaves its column untouched, it is
/// never required to resend the full widget object. An empty body (no
/// recognized field present) is a no-op, not an error.
pub async fn update_widget(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>, Json(req): Json<UpdateWidgetReq>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new("UPDATE dashboard_widgets SET ");
    let mut any = false;

    if let Some(v) = req.title.as_ref() {
        if any {
            qb.push(", ");
        }
        qb.push("title = ").push_bind(v.clone());
        any = true;
    }
    if let Some(v) = req.color_key.as_ref() {
        if any {
            qb.push(", ");
        }
        qb.push("color_key = ").push_bind(v.clone());
        any = true;
    }
    if let Some(v) = req.catalog_key.as_ref() {
        if any {
            qb.push(", ");
        }
        qb.push("catalog_key = ").push_bind(v.clone());
        any = true;
    }
    if let Some(v) = req.position_x {
        if any {
            qb.push(", ");
        }
        qb.push("position_x = ").push_bind(v);
        any = true;
    }
    if let Some(v) = req.position_y {
        if any {
            qb.push(", ");
        }
        qb.push("position_y = ").push_bind(v);
        any = true;
    }
    if let Some(v) = req.width {
        if any {
            qb.push(", ");
        }
        qb.push("width = ").push_bind(v);
        any = true;
    }
    if let Some(v) = req.height {
        if any {
            qb.push(", ");
        }
        qb.push("height = ").push_bind(v);
        any = true;
    }

    if !any {
        return StatusCode::NO_CONTENT.into_response();
    }

    qb.push(" WHERE id = ").push_bind(id);
    let _ = qb.build().execute(&state.db).await;
    StatusCode::NO_CONTENT.into_response()
}

/// `DELETE /api/dashboards/widgets/:id` — removes a single widget; the
/// owning dashboard and its other widgets are untouched.
pub async fn delete_widget(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    if !require_admin(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _ = sqlx::query("DELETE FROM dashboard_widgets WHERE id = ?1").bind(&id).execute(&state.db).await;
    StatusCode::NO_CONTENT.into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::State as AxState;
    use std::{
        collections::HashMap,
        path::PathBuf,
        sync::{Arc, RwLock},
    };

    /// Same in-memory-sqlite fixture pattern as thinking_fragments.rs/
    /// auditlog.rs's own `test_state` helpers — a fresh, schema-initialized
    /// DB per test.
    async fn test_state() -> AppState {
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        init_schema(&db).await;
        crate::auditlog::init_schema(&db).await;
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
            nvidia_connect_timeout: std::time::Duration::from_millis(300),
            chat_secret: String::new(),
            stripe_secret_key: String::new(),
            stripe_api_base: "https://api.stripe.com".to_string(),
            stripe_webhook_secret: String::new(),
            ddg_api_base: "https://api.duckduckgo.com".to_string(),
            hermes_url: String::new(),
            hermes_api_key: String::new(),
            hermes_boot_grace: crate::hermes::HERMES_BOOT_GRACE,
            mcp_token: String::new(),
            github_token: String::new(),
            github_api_base: "https://api.github.com".to_string(),
            audit_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    async fn dashboard_count(db: &SqlitePool) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM dashboards").fetch_one(db).await.unwrap()
    }

    async fn widget_count(db: &SqlitePool) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM dashboard_widgets").fetch_one(db).await.unwrap()
    }

    fn create_widget_req(catalog_key: &str) -> CreateWidgetReq {
        CreateWidgetReq {
            catalog_key: catalog_key.to_string(),
            position_x: 0,
            position_y: 0,
            width: 4,
            height: 3,
            title: Some("Ursprünglicher Titel".to_string()),
            color_key: Some("blue".to_string()),
        }
    }

    // ── dashboards CRUD ──────────────────────────────────────────────────

    #[tokio::test]
    async fn create_dashboard_writes_a_real_row_and_list_returns_it() {
        let state = test_state().await;
        let res = create_dashboard(AxState(state.clone()), HeaderMap::new(), Json(CreateDashboardReq { name: "Mein Dashboard".to_string() }))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let id = body["id"].as_str().unwrap().to_string();
        assert_eq!(dashboard_count(&state.db).await, 1);

        let list_res = list_dashboards(AxState(state.clone()), HeaderMap::new()).await.into_response();
        let bytes = axum::body::to_bytes(list_res.into_body(), usize::MAX).await.unwrap();
        let list: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["id"], json!(id));
        assert_eq!(list[0]["name"], json!("Mein Dashboard"));
        assert_eq!(list[0]["is_default"], json!(false), "a newly created dashboard must never default to is_default=true");
    }

    #[tokio::test]
    async fn create_dashboard_rejects_an_empty_name() {
        let state = test_state().await;
        let res = create_dashboard(AxState(state.clone()), HeaderMap::new(), Json(CreateDashboardReq { name: "   ".to_string() }))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        assert_eq!(dashboard_count(&state.db).await, 0, "no row must be written for a blank name");
    }

    #[tokio::test]
    async fn get_dashboard_returns_404_for_an_unknown_id() {
        let state = test_state().await;
        let res = get_dashboard(AxState(state.clone()), HeaderMap::new(), Path("no-such-id".to_string())).await.into_response();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    // ── widgets + the nested get_dashboard shape ─────────────────────────

    #[tokio::test]
    async fn get_dashboard_nests_its_widgets_in_one_response() {
        let state = test_state().await;
        let create_res = create_dashboard(AxState(state.clone()), HeaderMap::new(), Json(CreateDashboardReq { name: "Board".to_string() }))
            .await
            .into_response();
        let bytes = axum::body::to_bytes(create_res.into_body(), usize::MAX).await.unwrap();
        let dash_id = serde_json::from_slice::<serde_json::Value>(&bytes).unwrap()["id"].as_str().unwrap().to_string();

        add_widget(AxState(state.clone()), HeaderMap::new(), Path(dash_id.clone()), Json(create_widget_req("level_mix")))
            .await
            .into_response();
        add_widget(AxState(state.clone()), HeaderMap::new(), Path(dash_id.clone()), Json(create_widget_req("cei_gauge")))
            .await
            .into_response();

        let res = get_dashboard(AxState(state.clone()), HeaderMap::new(), Path(dash_id.clone())).await.into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["id"], json!(dash_id));
        assert_eq!(body["name"], json!("Board"));
        assert_eq!(body["is_default"], json!(false));
        let widgets = body["widgets"].as_array().unwrap();
        assert_eq!(widgets.len(), 2, "both widgets added to this dashboard must be nested in the same response");
        assert_eq!(widgets[0]["catalog_key"], json!("level_mix"));
        assert_eq!(widgets[1]["catalog_key"], json!("cei_gauge"));
    }

    #[tokio::test]
    async fn add_widget_returns_404_for_an_unknown_dashboard() {
        let state = test_state().await;
        let res = add_widget(AxState(state.clone()), HeaderMap::new(), Path("ghost-dashboard".to_string()), Json(create_widget_req("level_mix")))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
        assert_eq!(widget_count(&state.db).await, 0, "no orphan widget row must be written for an unknown dashboard");
    }

    // ── PATCH: real partial-update semantics ─────────────────────────────

    #[tokio::test]
    async fn patch_updates_only_the_fields_present_and_leaves_the_rest_untouched() {
        let state = test_state().await;
        let dash_id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO dashboards (id, name) VALUES (?1, 'Board')").bind(&dash_id).execute(&state.db).await.unwrap();
        let add_res = add_widget(AxState(state.clone()), HeaderMap::new(), Path(dash_id.clone()), Json(create_widget_req("level_mix")))
            .await
            .into_response();
        let bytes = axum::body::to_bytes(add_res.into_body(), usize::MAX).await.unwrap();
        let widget_id = serde_json::from_slice::<serde_json::Value>(&bytes).unwrap()["id"].as_str().unwrap().to_string();

        // Only patch the title — color_key, catalog_key, and every
        // position/size field must survive exactly as they were.
        let patch_req = UpdateWidgetReq { title: Some("Neuer Titel".to_string()), ..Default::default() };
        let res = update_widget(AxState(state.clone()), HeaderMap::new(), Path(widget_id.clone()), Json(patch_req)).await.into_response();
        assert_eq!(res.status(), StatusCode::NO_CONTENT);

        let row: (String, Option<String>, Option<String>, String, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT id, title, color_key, catalog_key, position_x, position_y, width, height FROM dashboard_widgets WHERE id = ?1",
        )
        .bind(&widget_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
        assert_eq!(row.1, Some("Neuer Titel".to_string()), "title must reflect the patch");
        assert_eq!(row.2, Some("blue".to_string()), "color_key must survive a patch that never mentioned it");
        assert_eq!(row.3, "level_mix", "catalog_key must survive untouched");
        assert_eq!(row.4, 0, "position_x must survive untouched");
        assert_eq!(row.5, 0, "position_y must survive untouched");
        assert_eq!(row.6, 4, "width must survive untouched");
        assert_eq!(row.7, 3, "height must survive untouched");
    }

    #[tokio::test]
    async fn patch_can_update_position_and_size_fields_together() {
        let state = test_state().await;
        let dash_id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO dashboards (id, name) VALUES (?1, 'Board')").bind(&dash_id).execute(&state.db).await.unwrap();
        let add_res = add_widget(AxState(state.clone()), HeaderMap::new(), Path(dash_id.clone()), Json(create_widget_req("level_mix")))
            .await
            .into_response();
        let bytes = axum::body::to_bytes(add_res.into_body(), usize::MAX).await.unwrap();
        let widget_id = serde_json::from_slice::<serde_json::Value>(&bytes).unwrap()["id"].as_str().unwrap().to_string();

        let patch_req = UpdateWidgetReq {
            position_x: Some(8),
            position_y: Some(12),
            width: Some(6),
            height: Some(5),
            ..Default::default()
        };
        update_widget(AxState(state.clone()), HeaderMap::new(), Path(widget_id.clone()), Json(patch_req)).await.into_response();

        let row: (i64, i64, i64, i64, Option<String>) = sqlx::query_as(
            "SELECT position_x, position_y, width, height, title FROM dashboard_widgets WHERE id = ?1",
        )
        .bind(&widget_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
        assert_eq!(row, (8, 12, 6, 5, Some("Ursprünglicher Titel".to_string())), "title must survive a drag/resize-only patch");
    }

    #[tokio::test]
    async fn patch_with_no_recognized_field_is_a_harmless_no_op() {
        let state = test_state().await;
        let dash_id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO dashboards (id, name) VALUES (?1, 'Board')").bind(&dash_id).execute(&state.db).await.unwrap();
        let add_res = add_widget(AxState(state.clone()), HeaderMap::new(), Path(dash_id.clone()), Json(create_widget_req("level_mix")))
            .await
            .into_response();
        let bytes = axum::body::to_bytes(add_res.into_body(), usize::MAX).await.unwrap();
        let widget_id = serde_json::from_slice::<serde_json::Value>(&bytes).unwrap()["id"].as_str().unwrap().to_string();

        let res = update_widget(AxState(state.clone()), HeaderMap::new(), Path(widget_id), Json(UpdateWidgetReq::default())).await.into_response();
        assert_eq!(res.status(), StatusCode::NO_CONTENT);
    }

    // ── DELETE: cascade ───────────────────────────────────────────────────

    #[tokio::test]
    async fn deleting_a_dashboard_cascades_to_its_widgets() {
        let state = test_state().await;
        let dash_id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO dashboards (id, name) VALUES (?1, 'Board')").bind(&dash_id).execute(&state.db).await.unwrap();
        add_widget(AxState(state.clone()), HeaderMap::new(), Path(dash_id.clone()), Json(create_widget_req("level_mix")))
            .await
            .into_response();
        add_widget(AxState(state.clone()), HeaderMap::new(), Path(dash_id.clone()), Json(create_widget_req("cei_gauge")))
            .await
            .into_response();
        assert_eq!(widget_count(&state.db).await, 2, "sanity: both widgets exist before the delete");

        let res = delete_dashboard(AxState(state.clone()), HeaderMap::new(), Path(dash_id.clone())).await.into_response();
        assert_eq!(res.status(), StatusCode::NO_CONTENT);

        assert_eq!(dashboard_count(&state.db).await, 0, "the dashboard row itself must be gone");
        assert_eq!(widget_count(&state.db).await, 0, "the FK's ON DELETE CASCADE must remove every one of its widgets too");
    }

    #[tokio::test]
    async fn deleting_one_widget_leaves_the_dashboard_and_its_other_widgets_intact() {
        let state = test_state().await;
        let dash_id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO dashboards (id, name) VALUES (?1, 'Board')").bind(&dash_id).execute(&state.db).await.unwrap();
        let add_res_1 = add_widget(AxState(state.clone()), HeaderMap::new(), Path(dash_id.clone()), Json(create_widget_req("level_mix")))
            .await
            .into_response();
        let bytes = axum::body::to_bytes(add_res_1.into_body(), usize::MAX).await.unwrap();
        let widget_id_1 = serde_json::from_slice::<serde_json::Value>(&bytes).unwrap()["id"].as_str().unwrap().to_string();
        add_widget(AxState(state.clone()), HeaderMap::new(), Path(dash_id.clone()), Json(create_widget_req("cei_gauge")))
            .await
            .into_response();

        let res = delete_widget(AxState(state.clone()), HeaderMap::new(), Path(widget_id_1)).await.into_response();
        assert_eq!(res.status(), StatusCode::NO_CONTENT);
        assert_eq!(widget_count(&state.db).await, 1, "only the targeted widget must be removed");
        assert_eq!(dashboard_count(&state.db).await, 1, "the owning dashboard must be untouched");
    }

    // ── admin auth required on every route ───────────────────────────────

    fn locked_state(state: &mut AppState) {
        state.chat_secret = "shh".to_string();
    }

    #[tokio::test]
    async fn list_dashboards_requires_admin_auth() {
        let mut state = test_state().await;
        locked_state(&mut state);
        let res = list_dashboards(AxState(state), HeaderMap::new()).await.into_response();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn create_dashboard_requires_admin_auth() {
        let mut state = test_state().await;
        locked_state(&mut state);
        let res = create_dashboard(AxState(state), HeaderMap::new(), Json(CreateDashboardReq { name: "X".to_string() }))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn get_dashboard_requires_admin_auth() {
        let mut state = test_state().await;
        locked_state(&mut state);
        let res = get_dashboard(AxState(state), HeaderMap::new(), Path("some-id".to_string())).await.into_response();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn delete_dashboard_requires_admin_auth() {
        let mut state = test_state().await;
        locked_state(&mut state);
        let res = delete_dashboard(AxState(state), HeaderMap::new(), Path("some-id".to_string())).await.into_response();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn add_widget_requires_admin_auth() {
        let mut state = test_state().await;
        locked_state(&mut state);
        let res = add_widget(AxState(state), HeaderMap::new(), Path("some-id".to_string()), Json(create_widget_req("level_mix")))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn update_widget_requires_admin_auth() {
        let mut state = test_state().await;
        locked_state(&mut state);
        let res = update_widget(AxState(state), HeaderMap::new(), Path("some-id".to_string()), Json(UpdateWidgetReq::default()))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn delete_widget_requires_admin_auth() {
        let mut state = test_state().await;
        locked_state(&mut state);
        let res = delete_widget(AxState(state), HeaderMap::new(), Path("some-id".to_string())).await.into_response();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }
}
