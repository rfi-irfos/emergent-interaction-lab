//! Decision-making metrics over `message_revisions` + `chat_messages` —
//! Wave 1 / Task 6 of the Deep Self-Analysis plan (framework v2.1,
//! Dimension 2 "Decision Making"). Two aggregates that quantify *how Laura
//! decides about Jarvis's output*:
//!
//!   * **Accept / Modify / Reject rate** — of the turns she could react to,
//!     how many did she keep as-is (accept), edit-and-resend (modify), or
//!     abandon outright (reject). "Modify" and "reject" are read directly off
//!     the `message_revisions` snapshot rows Task 5 writes in
//!     `chat::delete_message_and_after` BEFORE the hard-delete (`action`
//!     `'edit'` vs `'abandon'`); "accept" is inferred — an assistant reply
//!     whose immediately-following user message was never revised.
//!   * **Decision latency** — for each revision, how long after the AI reply
//!     it reacted to did she act. Read as deliberation time, not performance.
//!
//! Same honest-empty discipline as the rest of the observatory: no revisions
//! / no reactable turns degrades to zero counts and a `null` latency, never a
//! fabricated average. The per-conversation `pub` functions carry the shape
//! the plan names; the `*_global` ones fold them across every conversation for
//! the (conversation-agnostic) `observatory::human_ai` binding, aggregating
//! raw samples/counts so the global mean is a true mean, not a mean-of-means.

use serde_json::{json, Value};
use sqlx::SqlitePool;

/// Parse SQLite's `datetime('now')` wall-clock format (`YYYY-MM-DD HH:MM:SS`),
/// same convention `observatory::human_ai`'s latency pairing uses.
fn parse_ts(ts: &str) -> Option<chrono::NaiveDateTime> {
    chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S").ok()
}

/// Raw (accepted, modified, rejected) counts for one conversation — the
/// single source of truth both the per-conversation JSON and the global fold
/// build on.
///
///  * modified = `message_revisions` rows with `action='edit'`
///  * rejected = `message_revisions` rows with `action='abandon'`
///  * accepted = assistant messages whose immediately-following user message
///    (still present in `chat_messages`) was never snapshotted into
///    `message_revisions` — i.e. she kept the exchange rather than reworking it.
pub(crate) async fn amr_counts(db: &SqlitePool, conversation_id: &str) -> (i64, i64, i64) {
    let (modified,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM message_revisions WHERE conversation_id = ?1 AND action = 'edit'",
    )
    .bind(conversation_id)
    .fetch_one(db)
    .await
    .unwrap_or((0,));
    let (rejected,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM message_revisions WHERE conversation_id = ?1 AND action = 'abandon'",
    )
    .bind(conversation_id)
    .fetch_one(db)
    .await
    .unwrap_or((0,));

    // The immediately-following user message id for each assistant message —
    // same proximity-pairing convention (MIN created_at strictly after, same
    // conversation) as observatory::human_ai's latency query, only selecting
    // the id instead of the timestamp.
    let following: Vec<(String,)> = sqlx::query_as(
        "SELECT b.id FROM chat_messages a \
         JOIN chat_messages b ON b.conversation_id = a.conversation_id AND b.created_at > a.created_at \
         WHERE a.role = 'assistant' AND b.role = 'user' AND a.conversation_id = ?1 \
         AND b.created_at = (SELECT MIN(c.created_at) FROM chat_messages c \
             WHERE c.conversation_id = a.conversation_id AND c.created_at > a.created_at AND c.role = 'user')",
    )
    .bind(conversation_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let revised: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT message_id FROM message_revisions WHERE conversation_id = ?1",
    )
    .bind(conversation_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let revised_set: std::collections::HashSet<&str> =
        revised.iter().map(|(m,)| m.as_str()).collect();

    let accepted = following
        .iter()
        .filter(|(id,)| !revised_set.contains(id.as_str()))
        .count() as i64;

    (accepted, modified, rejected)
}

/// Per-revision decision latency samples (seconds) for one conversation: for
/// each `message_revisions` row, the gap between the AI reply it reacted to
/// (the most recent assistant message at/ before the snapshot time — the
/// revised user message itself is already hard-deleted, so the snapshot's own
/// `created_at` stands in for "when she acted") and that snapshot. Negative
/// gaps are dropped, same filter as human_ai's latency pipeline.
pub(crate) async fn decision_latency_samples(db: &SqlitePool, conversation_id: &str) -> Vec<f64> {
    let rows: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT mr.created_at, \
           (SELECT MAX(cm.created_at) FROM chat_messages cm \
              WHERE cm.conversation_id = mr.conversation_id AND cm.role = 'assistant' \
                AND cm.created_at <= mr.created_at) \
         FROM message_revisions mr WHERE mr.conversation_id = ?1",
    )
    .bind(conversation_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    rows.iter()
        .filter_map(|(rev_ts, asst_ts)| {
            let asst = asst_ts.as_ref()?;
            let r = parse_ts(rev_ts)?;
            let a = parse_ts(asst)?;
            let s = (r - a).num_milliseconds() as f64 / 1000.0;
            (s >= 0.0).then_some(s)
        })
        .collect()
}

/// Accept / Modify / Reject rollup for ONE conversation — the shape the plan
/// (Task 6) names: `{accepted, modified, rejected, total, modify_ratio,
/// reject_ratio}`. Ratios are `0.0` when there is nothing to react to (never a
/// divide-by-zero).
pub async fn accept_modify_reject_rate(db: &SqlitePool, conversation_id: &str) -> Value {
    let (accepted, modified, rejected) = amr_counts(db, conversation_id).await;
    amr_json(accepted, modified, rejected)
}

/// Mean decision latency (seconds) for ONE conversation, or `None` when no
/// revision in it could be paired with a preceding AI reply.
pub async fn decision_latency(db: &SqlitePool, conversation_id: &str) -> Option<f64> {
    let samples = decision_latency_samples(db, conversation_id).await;
    mean(&samples)
}

/// Global Accept / Modify / Reject rollup across every conversation — folds
/// `amr_counts` over the union of conversations that appear in either
/// `chat_messages` or `message_revisions` (a conversation whose messages were
/// all abandoned survives only in the latter). Backs human_ai's
/// `accept_modify_reject`.
pub async fn accept_modify_reject_global(db: &SqlitePool) -> Value {
    let convs = distinct_conversations(db).await;
    let (mut a, mut m, mut r) = (0i64, 0i64, 0i64);
    for cid in &convs {
        let (ca, cm, cr) = amr_counts(db, cid).await;
        a += ca;
        m += cm;
        r += cr;
    }
    amr_json(a, m, r)
}

/// Global mean decision latency (seconds) across every conversation —
/// concatenates raw per-conversation samples so the result is a true overall
/// mean, not a mean of per-conversation means. `None` when there is no sample
/// anywhere. Backs human_ai's `decision_latency_seconds`.
pub async fn decision_latency_global(db: &SqlitePool) -> Option<f64> {
    let convs = distinct_conversations(db).await;
    let mut all: Vec<f64> = Vec::new();
    for cid in &convs {
        all.extend(decision_latency_samples(db, cid).await);
    }
    mean(&all)
}

fn amr_json(accepted: i64, modified: i64, rejected: i64) -> Value {
    let total = accepted + modified + rejected;
    let (modify_ratio, reject_ratio) = if total > 0 {
        (modified as f64 / total as f64, rejected as f64 / total as f64)
    } else {
        (0.0, 0.0)
    };
    json!({
        "accepted": accepted,
        "modified": modified,
        "rejected": rejected,
        "total": total,
        "modify_ratio": modify_ratio,
        "reject_ratio": reject_ratio,
    })
}

fn mean(samples: &[f64]) -> Option<f64> {
    if samples.is_empty() {
        None
    } else {
        Some(samples.iter().sum::<f64>() / samples.len() as f64)
    }
}

/// Every conversation that has either a chat message or a revision snapshot.
async fn distinct_conversations(db: &SqlitePool) -> Vec<String> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT conversation_id FROM chat_messages \
         UNION SELECT conversation_id FROM message_revisions",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    rows.into_iter().map(|(c,)| c).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_db() -> SqlitePool {
        let db = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::chat::init_schema(&db).await; // chat_messages + message_revisions
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

    #[tokio::test]
    async fn test_accept_modify_reject_counts_each_bucket() {
        let db = test_db().await;
        // Conversation c1: user u1 -> assistant a1 -> user u2 (kept, accept).
        insert_msg(&db, "u1", "c1", "user", "2026-07-20 10:00:00").await;
        insert_msg(&db, "a1", "c1", "assistant", "2026-07-20 10:00:05").await;
        insert_msg(&db, "u2", "c1", "user", "2026-07-20 10:00:30").await;
        // One edit revision and one abandon revision (message ids don't need
        // to still exist — they were hard-deleted; the snapshot is the trace).
        insert_revision(&db, "c1", "gone_edit", "edit", "2026-07-20 10:05:00").await;
        insert_revision(&db, "c1", "gone_abandon", "abandon", "2026-07-20 10:06:00").await;

        let v = accept_modify_reject_rate(&db, "c1").await;
        assert_eq!(v["accepted"], 1, "a1's following user u2 was never revised: {v}");
        assert_eq!(v["modified"], 1, "{v}");
        assert_eq!(v["rejected"], 1, "{v}");
        assert_eq!(v["total"], 3, "{v}");
        assert!((v["modify_ratio"].as_f64().unwrap() - 1.0 / 3.0).abs() < 1e-9, "{v}");
        assert!((v["reject_ratio"].as_f64().unwrap() - 1.0 / 3.0).abs() < 1e-9, "{v}");
    }

    #[tokio::test]
    async fn test_accept_excludes_revised_following_user_message() {
        let db = test_db().await;
        // assistant a1 -> user u2, but u2 itself was revised (its id is in
        // message_revisions), so it is NOT an accept.
        insert_msg(&db, "a1", "c1", "assistant", "2026-07-20 10:00:00").await;
        insert_msg(&db, "u2", "c1", "user", "2026-07-20 10:00:30").await;
        insert_revision(&db, "c1", "u2", "edit", "2026-07-20 10:01:00").await;

        let v = accept_modify_reject_rate(&db, "c1").await;
        assert_eq!(v["accepted"], 0, "u2 was revised, so a1 is not an accept: {v}");
        assert_eq!(v["modified"], 1, "{v}");
    }

    #[tokio::test]
    async fn test_accept_modify_reject_empty_is_zero_not_null() {
        let db = test_db().await;
        let v = accept_modify_reject_rate(&db, "nope").await;
        assert_eq!(v["accepted"], 0);
        assert_eq!(v["total"], 0);
        assert_eq!(v["modify_ratio"].as_f64().unwrap(), 0.0);
        assert_eq!(v["reject_ratio"].as_f64().unwrap(), 0.0);
    }

    #[tokio::test]
    async fn test_decision_latency_pairs_revision_with_preceding_ai_reply() {
        let db = test_db().await;
        // assistant reply at 10:00:00; she edits/abandons at 10:02:00 -> 120s.
        insert_msg(&db, "a1", "c1", "assistant", "2026-07-20 10:00:00").await;
        insert_revision(&db, "c1", "gone", "edit", "2026-07-20 10:02:00").await;

        let lat = decision_latency(&db, "c1").await;
        assert_eq!(lat, Some(120.0), "10:00:00 reply -> 10:02:00 edit is 120s");
    }

    #[tokio::test]
    async fn test_decision_latency_mean_over_multiple() {
        let db = test_db().await;
        insert_msg(&db, "a1", "c1", "assistant", "2026-07-20 10:00:00").await;
        insert_revision(&db, "c1", "g1", "edit", "2026-07-20 10:00:10").await; // 10s
        insert_revision(&db, "c1", "g2", "abandon", "2026-07-20 10:00:30").await; // 30s
        let lat = decision_latency(&db, "c1").await;
        assert_eq!(lat, Some(20.0), "mean of 10s and 30s");
    }

    #[tokio::test]
    async fn test_decision_latency_null_without_preceding_reply() {
        let db = test_db().await;
        // A revision with no assistant message before it -> unpairable -> null.
        insert_revision(&db, "c1", "gone", "edit", "2026-07-20 10:02:00").await;
        assert!(decision_latency(&db, "c1").await.is_none());
    }

    #[tokio::test]
    async fn test_global_folds_across_conversations() {
        let db = test_db().await;
        insert_msg(&db, "a1", "c1", "assistant", "2026-07-20 10:00:00").await;
        insert_revision(&db, "c1", "g1", "edit", "2026-07-20 10:00:10").await; // 10s
        insert_msg(&db, "a2", "c2", "assistant", "2026-07-20 11:00:00").await;
        insert_revision(&db, "c2", "g2", "abandon", "2026-07-20 11:00:30").await; // 30s

        let v = accept_modify_reject_global(&db).await;
        assert_eq!(v["modified"], 1, "{v}");
        assert_eq!(v["rejected"], 1, "{v}");
        assert_eq!(v["total"], 2, "{v}");
        let lat = decision_latency_global(&db).await;
        assert_eq!(lat, Some(20.0), "true mean of 10s and 30s across conversations");
    }

    #[tokio::test]
    async fn test_global_decision_latency_null_when_no_revisions() {
        let db = test_db().await;
        insert_msg(&db, "a1", "c1", "assistant", "2026-07-20 10:00:00").await;
        assert!(decision_latency_global(&db).await.is_none());
    }
}
