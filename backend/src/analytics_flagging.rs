//! Mutual-Flagging Matrix (meta-layer "who flagged whom") — Wave 2 / Task 15
//! of the Deep Self-Analysis plan. The dyad flags each other constantly, just
//! through different channels, and until now those channels were only ever
//! surfaced separately. This module folds them into one matrix:
//!
//!   * **Laura flags Jarvis** — every `message_revisions` snapshot row is her
//!     explicitly rejecting his output as-was: `action='edit'` is a
//!     *modify-flag* ("wrong enough to rework") and `action='abandon'` is a
//!     *reject-flag* ("wrong enough to walk away"). Written by
//!     `chat::delete_message_and_after` BEFORE the hard-delete, so the trace
//!     survives the deletion.
//!   * **Jarvis flags Laura / himself** — the machine-side channels:
//!     `hallucination_checks` rows with `verdict='mismatch'` (his own output
//!     concretely contradicted a tool result — a self-flag his verifier
//!     raised) and every `agent_anomalies` row (tool_error / iteration_cap /
//!     refusal_triggered / hallucination_mismatch trip-wires).
//!
//! Same honest-empty discipline as every other observatory feed: missing
//! tables or zero rows degrade to zero counts, never to fabricated numbers.
//! `hallucination_checks` has no conversation_id of its own — it scopes via
//! `tool_call_id → agent_tool_calls.conversation_id`, the exact linkage
//! `observatory::hallucination_full_list` already uses.
//!
//! Both entry points are pure functions over the pool returning
//! `serde_json::Value`, following the `analytics_decisions` /
//! `analytics_resolution` module pattern, and are bound into the API by the
//! dedicated `observatory::flagging` handler (`/api/observatory/flagging`).

use serde_json::{json, Value};
use sqlx::SqlitePool;

/// One-cell count helper: run a `SELECT COUNT(*)` query with an optional
/// conversation filter already baked into the SQL, degrade to 0 on any error
/// (missing table on an older DB must never panic an analytics read).
async fn count(db: &SqlitePool, sql: &str, conversation_id: Option<&str>) -> i64 {
    let q = sqlx::query_as::<_, (i64,)>(sql);
    let q = match conversation_id {
        Some(cid) => q.bind(cid.to_string()),
        None => q.bind(Option::<String>::None),
    };
    q.fetch_one(db).await.map(|(n,)| n).unwrap_or(0)
}

/// The Mutual-Flagging Matrix for one conversation (`Some(cid)`) or globally
/// (`None`). Shape:
///
/// ```json
/// {
///   "laura_flags_jarvis": {"modify": n, "reject": n, "total": n},
///   "jarvis_flags": {"hallucination_mismatch": n, "anomalies": n, "total": n},
///   "total_flags": n
/// }
/// ```
///
/// Every query uses the `(?1 IS NULL OR conversation_id = ?1)` idiom so one
/// SQL string serves both the scoped and the global read.
pub async fn mutual_flagging_matrix(db: &SqlitePool, conversation_id: Option<&str>) -> Value {
    let modify = count(
        db,
        "SELECT COUNT(*) FROM message_revisions WHERE action='edit' AND (?1 IS NULL OR conversation_id = ?1)",
        conversation_id,
    )
    .await;
    let reject = count(
        db,
        "SELECT COUNT(*) FROM message_revisions WHERE action='abandon' AND (?1 IS NULL OR conversation_id = ?1)",
        conversation_id,
    )
    .await;
    // hallucination_checks scopes through agent_tool_calls — same join
    // observatory::hallucination_full_list uses.
    let mismatch = count(
        db,
        "SELECT COUNT(*) FROM hallucination_checks hc \
         JOIN agent_tool_calls atc ON atc.id = hc.tool_call_id \
         WHERE hc.verdict='mismatch' AND (?1 IS NULL OR atc.conversation_id = ?1)",
        conversation_id,
    )
    .await;
    let anomalies = count(
        db,
        "SELECT COUNT(*) FROM agent_anomalies WHERE (?1 IS NULL OR conversation_id = ?1)",
        conversation_id,
    )
    .await;

    let laura_total = modify + reject;
    let jarvis_total = mismatch + anomalies;
    json!({
        "laura_flags_jarvis": {
            "modify": modify,
            "reject": reject,
            "total": laura_total,
        },
        "jarvis_flags": {
            "hallucination_mismatch": mismatch,
            "anomalies": anomalies,
            "total": jarvis_total,
        },
        "total_flags": laura_total + jarvis_total,
    })
}

/// For every flag (both directions), did a subsequent message in the SAME
/// conversation follow it? A following user/assistant message means the dyad
/// kept working after the flag — the flag was *resolved* (worked through)
/// rather than left *open* (flag was the last word in that conversation).
///
/// Shape: `{"resolved": n, "open": n, "total": n, "resolved_ratio": f}` with
/// ratio `0.0` on zero flags (never a divide-by-zero).
pub async fn flag_resolution_type(db: &SqlitePool) -> Value {
    // (conversation_id, created_at) for every flag event across all three
    // sources. hallucination mismatches join through agent_tool_calls for
    // their conversation, same as the matrix above.
    let flags: Vec<(String, String)> = sqlx::query_as(
        "SELECT conversation_id, created_at FROM message_revisions \
         UNION ALL \
         SELECT conversation_id, created_at FROM agent_anomalies \
         UNION ALL \
         SELECT atc.conversation_id, hc.created_at FROM hallucination_checks hc \
           JOIN agent_tool_calls atc ON atc.id = hc.tool_call_id \
           WHERE hc.verdict='mismatch' AND atc.conversation_id IS NOT NULL",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let mut resolved = 0i64;
    let mut open = 0i64;
    for (cid, flag_ts) in &flags {
        let (following,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM chat_messages \
             WHERE conversation_id = ?1 AND created_at > ?2 AND role IN ('user','assistant')",
        )
        .bind(cid)
        .bind(flag_ts)
        .fetch_one(db)
        .await
        .unwrap_or((0,));
        if following > 0 {
            resolved += 1;
        } else {
            open += 1;
        }
    }

    let total = resolved + open;
    let resolved_ratio = if total > 0 {
        resolved as f64 / total as f64
    } else {
        0.0
    };
    json!({
        "resolved": resolved,
        "open": open,
        "total": total,
        "resolved_ratio": resolved_ratio,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_db() -> SqlitePool {
        let db = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::chat::init_schema(&db).await; // chat_messages + message_revisions
        crate::agent::init_schema(&db).await; // agent_tool_calls
        crate::hallucination::init_schema(&db).await; // hallucination_checks
        crate::anomaly::init_schema(&db).await; // agent_anomalies
        db
    }

    async fn insert_msg(db: &SqlitePool, id: &str, conv: &str, role: &str, ts: &str) {
        sqlx::query(
            "INSERT INTO chat_messages (id, conversation_id, role, content, created_at) VALUES (?1,?2,?3,'x',?4)",
        )
        .bind(id)
        .bind(conv)
        .bind(role)
        .bind(ts)
        .execute(db)
        .await
        .unwrap();
    }

    async fn insert_revision(db: &SqlitePool, conv: &str, message_id: &str, action: &str, ts: &str) {
        sqlx::query(
            "INSERT INTO message_revisions (conversation_id, message_id, old_content, action, created_at) VALUES (?1,?2,'old',?3,?4)",
        )
        .bind(conv)
        .bind(message_id)
        .bind(action)
        .bind(ts)
        .execute(db)
        .await
        .unwrap();
    }

    async fn insert_anomaly(db: &SqlitePool, id: &str, conv: &str, kind: &str, ts: &str) {
        sqlx::query(
            "INSERT INTO agent_anomalies (id, kind, conversation_id, chat_message_id, detail, created_at) VALUES (?1,?2,?3,NULL,'d',?4)",
        )
        .bind(id)
        .bind(kind)
        .bind(conv)
        .bind(ts)
        .execute(db)
        .await
        .unwrap();
    }

    async fn insert_check(db: &SqlitePool, id: &str, conv: &str, verdict: &str, ts: &str) {
        // hallucination_checks links to a conversation via its tool call.
        let tc_id = format!("tc-{id}");
        sqlx::query(
            "INSERT INTO agent_tool_calls (id, conversation_id, tool_name, arguments, status, created_at) VALUES (?1,?2,'t','{}','ok',?3)",
        )
        .bind(&tc_id)
        .bind(conv)
        .bind(ts)
        .execute(db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO hallucination_checks (id, chat_message_id, tool_call_id, verdict, detail, created_at) VALUES (?1,'m',?2,?3,'d',?4)",
        )
        .bind(id)
        .bind(&tc_id)
        .bind(verdict)
        .bind(ts)
        .execute(db)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn test_mutual_flagging() {
        let db = test_db().await;
        // Laura's side: one modify-flag, two reject-flags in c1.
        insert_revision(&db, "c1", "m1", "edit", "2026-07-20 10:00:00").await;
        insert_revision(&db, "c1", "m2", "abandon", "2026-07-20 10:01:00").await;
        insert_revision(&db, "c1", "m3", "abandon", "2026-07-20 10:02:00").await;
        // Jarvis's side: one mismatch (a 'match' must NOT count), one anomaly.
        insert_check(&db, "h1", "c1", "mismatch", "2026-07-20 10:03:00").await;
        insert_check(&db, "h2", "c1", "match", "2026-07-20 10:03:30").await;
        insert_anomaly(&db, "an1", "c1", "tool_error", "2026-07-20 10:04:00").await;
        // Noise in another conversation — must be excluded from the c1 view
        // but included in the global one.
        insert_revision(&db, "c2", "m9", "edit", "2026-07-20 11:00:00").await;

        let v = mutual_flagging_matrix(&db, Some("c1")).await;
        assert_eq!(v["laura_flags_jarvis"]["modify"], 1, "{v}");
        assert_eq!(v["laura_flags_jarvis"]["reject"], 2, "{v}");
        assert_eq!(v["laura_flags_jarvis"]["total"], 3, "{v}");
        assert_eq!(v["jarvis_flags"]["hallucination_mismatch"], 1, "'match' verdict must not count: {v}");
        assert_eq!(v["jarvis_flags"]["anomalies"], 1, "{v}");
        assert_eq!(v["jarvis_flags"]["total"], 2, "{v}");
        assert_eq!(v["total_flags"], 5, "{v}");

        let g = mutual_flagging_matrix(&db, None).await;
        assert_eq!(g["laura_flags_jarvis"]["modify"], 2, "global includes c2: {g}");
        assert_eq!(g["total_flags"], 6, "{g}");
    }

    #[tokio::test]
    async fn test_mutual_flagging_empty_is_zero_not_null() {
        let db = test_db().await;
        let v = mutual_flagging_matrix(&db, None).await;
        assert_eq!(v["laura_flags_jarvis"]["total"], 0);
        assert_eq!(v["jarvis_flags"]["total"], 0);
        assert_eq!(v["total_flags"], 0);
    }

    #[tokio::test]
    async fn test_flag_resolution() {
        let db = test_db().await;
        // Flag 1 (revision in c1 at 10:00) followed by a user message at
        // 10:05 → resolved.
        insert_revision(&db, "c1", "m1", "edit", "2026-07-20 10:00:00").await;
        insert_msg(&db, "u1", "c1", "user", "2026-07-20 10:05:00").await;
        // Flag 2 (anomaly in c2 at 11:00) with nothing after → open.
        insert_anomaly(&db, "an1", "c2", "tool_error", "2026-07-20 11:00:00").await;
        // Flag 3 (mismatch in c3 at 12:00) followed by an assistant message
        // → resolved. A 'match' check in c3 must not add a flag.
        insert_check(&db, "h1", "c3", "mismatch", "2026-07-20 12:00:00").await;
        insert_check(&db, "h2", "c3", "match", "2026-07-20 12:00:30").await;
        insert_msg(&db, "a1", "c3", "assistant", "2026-07-20 12:01:00").await;

        let v = flag_resolution_type(&db).await;
        assert_eq!(v["resolved"], 2, "{v}");
        assert_eq!(v["open"], 1, "{v}");
        assert_eq!(v["total"], 3, "{v}");
        assert!((v["resolved_ratio"].as_f64().unwrap() - 2.0 / 3.0).abs() < 1e-9, "{v}");
    }

    #[tokio::test]
    async fn test_flag_resolution_empty_is_zero_ratio() {
        let db = test_db().await;
        let v = flag_resolution_type(&db).await;
        assert_eq!(v["total"], 0);
        assert_eq!(v["resolved_ratio"].as_f64().unwrap(), 0.0);
    }
}
