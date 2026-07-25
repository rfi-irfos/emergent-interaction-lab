//! Hallucination → resolution chain metrics — Wave 1 / Task 8 of the Deep
//! Self-Analysis plan (framework v2.1, Dyad "clarification-efficiency"). Two
//! aggregates over the error/mismatch signals this platform already records
//! (`hallucination_checks.verdict='mismatch'`, `agent_anomalies`) chained
//! forward to the human's next turn:
//!
//!   * **Clarification efficiency** — after a `mismatch` verdict, how long
//!     until Laura's next message (the turn that engages with / addresses the
//!     problem). Mean seconds. Read as "how quickly the dyad moves to repair
//!     a wrong answer," not a performance grade.
//!   * **Repair success** — of all error/mismatch events, the fraction that
//!     ARE followed (within a bounded window) by a human turn at all —
//!     approximating "the loop got a chance to be repaired" vs. events left
//!     dangling with no human follow-up. A deliberately conservative,
//!     LLM-free heuristic (see the function's own doc comment); `0.0..=1.0`.
//!
//! `hallucination_checks` has no `conversation_id` of its own — it links
//! through `tool_call_id → agent_tool_calls.conversation_id`, the exact same
//! join `observatory::hallucination_full_list` uses. `agent_anomalies` carries
//! `conversation_id` directly. Same honest-empty discipline as the rest of the
//! observatory: no mismatch/error events degrades to `null`, never a
//! fabricated ratio or latency. Per-conversation `pub` functions carry the
//! shape the plan names; `*_global` fold them across every conversation for
//! the conversation-agnostic `observatory::human_ai` binding.

use sqlx::SqlitePool;

/// Window (seconds) within which a following human turn is counted as a repair
/// attempt for `repair_success`. 30 minutes — long enough to include a genuine
/// "wait, that's wrong, fix it" that arrives after some reading, short enough
/// that a message a day later (a new, unrelated session of thought) is not
/// mistaken for repairing this specific error.
const REPAIR_WINDOW_SECS: i64 = 30 * 60;

fn parse_ts(ts: &str) -> Option<chrono::NaiveDateTime> {
    chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S").ok()
}

/// The `created_at` of every mismatch/error event in one conversation, from
/// both signal sources — `hallucination_checks` (verdict='mismatch', joined
/// through agent_tool_calls for the conversation scope) and `agent_anomalies`
/// (any kind: a tool error, iteration cap, refusal, or reused hallucination
/// mismatch is all an event a human turn might repair).
pub(crate) async fn error_event_times(db: &SqlitePool, conversation_id: &str) -> Vec<String> {
    let mut times: Vec<String> = Vec::new();

    let hc: Vec<(String,)> = sqlx::query_as(
        "SELECT hc.created_at FROM hallucination_checks hc \
         JOIN agent_tool_calls atc ON atc.id = hc.tool_call_id \
         WHERE atc.conversation_id = ?1 AND hc.verdict = 'mismatch'",
    )
    .bind(conversation_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    times.extend(hc.into_iter().map(|(t,)| t));

    let an: Vec<(String,)> = sqlx::query_as(
        "SELECT created_at FROM agent_anomalies WHERE conversation_id = ?1",
    )
    .bind(conversation_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    times.extend(an.into_iter().map(|(t,)| t));

    times
}

/// Only the mismatch verdict times (clarification efficiency is defined
/// against the `hallucination_checks` mismatch signal specifically, per the
/// plan — a hallucinated answer the human then clarifies).
pub(crate) async fn mismatch_times(db: &SqlitePool, conversation_id: &str) -> Vec<String> {
    let hc: Vec<(String,)> = sqlx::query_as(
        "SELECT hc.created_at FROM hallucination_checks hc \
         JOIN agent_tool_calls atc ON atc.id = hc.tool_call_id \
         WHERE atc.conversation_id = ?1 AND hc.verdict = 'mismatch'",
    )
    .bind(conversation_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    hc.into_iter().map(|(t,)| t).collect()
}

/// Seconds from an event time to the first user message strictly after it in
/// the same conversation, or `None` if the human never followed up.
async fn secs_to_next_user(db: &SqlitePool, conversation_id: &str, event_ts: &str) -> Option<f64> {
    // MIN over an empty set returns a single NULL row, so decode the column as
    // Option and treat both "no row" and "NULL" as "no follow-up".
    let next: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT MIN(created_at) FROM chat_messages \
         WHERE conversation_id = ?1 AND role = 'user' AND created_at > ?2",
    )
    .bind(conversation_id)
    .bind(event_ts)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();
    let next_ts = next.and_then(|(t,)| t)?;
    let e = parse_ts(event_ts)?;
    let n = parse_ts(&next_ts)?;
    let s = (n - e).num_milliseconds() as f64 / 1000.0;
    (s >= 0.0).then_some(s)
}

/// Per-conversation clarification-efficiency samples (seconds): for each
/// mismatch, the gap to the next user message. Events with no following human
/// turn are dropped (they contributed no clarification to measure).
pub(crate) async fn clarification_samples(db: &SqlitePool, conversation_id: &str) -> Vec<f64> {
    let mut out = Vec::new();
    for ts in mismatch_times(db, conversation_id).await {
        if let Some(s) = secs_to_next_user(db, conversation_id, &ts).await {
            out.push(s);
        }
    }
    out
}

/// Per-conversation repair tallies `(repaired, total)`: of every error/mismatch
/// event, how many had a human turn within `REPAIR_WINDOW_SECS` afterward.
pub(crate) async fn repair_tallies(db: &SqlitePool, conversation_id: &str) -> (i64, i64) {
    let mut repaired = 0i64;
    let mut total = 0i64;
    for ts in error_event_times(db, conversation_id).await {
        total += 1;
        if let Some(s) = secs_to_next_user(db, conversation_id, &ts).await {
            if s <= REPAIR_WINDOW_SECS as f64 {
                repaired += 1;
            }
        }
    }
    (repaired, total)
}

/// Mean clarification efficiency (seconds) for ONE conversation — mean gap
/// from a `mismatch` verdict to Laura's next message. `None` when the
/// conversation has no mismatch that a human turn followed.
pub async fn clarification_efficiency(db: &SqlitePool, conversation_id: &str) -> Option<f64> {
    mean(&clarification_samples(db, conversation_id).await)
}

/// Repair-success ratio (`0.0..=1.0`) for ONE conversation — the fraction of
/// error/mismatch events followed by a human turn within `REPAIR_WINDOW_SECS`.
///
/// Deliberately an approximation, and honest about it: this measures that the
/// dyad got a *chance* to repair (a human turn arrived promptly after the
/// error), NOT that the repair semantically succeeded — verifying the latter
/// would need an LLM read of the follow-up, which the plan explicitly says is
/// not required here (Task 8: "LLM not needed — heuristic"). `None` when there
/// were no error/mismatch events at all.
pub async fn repair_success(db: &SqlitePool, conversation_id: &str) -> Option<f64> {
    let (repaired, total) = repair_tallies(db, conversation_id).await;
    (total > 0).then(|| repaired as f64 / total as f64)
}

/// Global mean clarification efficiency across every conversation —
/// concatenates raw per-conversation samples so the result is a true overall
/// mean. Backs human_ai's `clarification_efficiency_seconds`.
pub async fn clarification_efficiency_global(db: &SqlitePool) -> Option<f64> {
    let mut all: Vec<f64> = Vec::new();
    for cid in distinct_conversations(db).await {
        all.extend(clarification_samples(db, &cid).await);
    }
    mean(&all)
}

/// Global repair-success ratio across every conversation — sums raw
/// (repaired, total) tallies so the result is a true overall ratio, not a
/// mean of per-conversation ratios. Backs human_ai's `repair_success_ratio`.
pub async fn repair_success_global(db: &SqlitePool) -> Option<f64> {
    let (mut repaired, mut total) = (0i64, 0i64);
    for cid in distinct_conversations(db).await {
        let (r, t) = repair_tallies(db, &cid).await;
        repaired += r;
        total += t;
    }
    (total > 0).then(|| repaired as f64 / total as f64)
}

fn mean(samples: &[f64]) -> Option<f64> {
    if samples.is_empty() {
        None
    } else {
        Some(samples.iter().sum::<f64>() / samples.len() as f64)
    }
}

/// Every conversation that has a chat message or an anomaly — the union that
/// bounds the global folds. (mismatch verdicts always belong to a tool call
/// whose conversation appears in chat_messages, so no separate term needed.)
async fn distinct_conversations(db: &SqlitePool) -> Vec<String> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT conversation_id FROM chat_messages \
         UNION SELECT conversation_id FROM agent_anomalies",
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
        crate::chat::init_schema(&db).await; // chat_messages
        crate::agent::init_schema(&db).await; // agent_tool_calls
        crate::hallucination::init_schema(&db).await; // hallucination_checks
        crate::anomaly::init_schema(&db).await; // agent_anomalies
        db
    }

    async fn insert_msg(db: &SqlitePool, id: &str, conv: &str, role: &str, ts: &str) {
        sqlx::query(
            "INSERT INTO chat_messages (id, conversation_id, role, content, created_at) VALUES (?1,?2,?3,'x',?4)",
        )
        .bind(id).bind(conv).bind(role).bind(ts)
        .execute(db).await.unwrap();
    }

    async fn insert_tool_call(db: &SqlitePool, id: &str, conv: &str, ts: &str) {
        sqlx::query(
            "INSERT INTO agent_tool_calls (id, conversation_id, tool_name, arguments, status, created_at) VALUES (?1,?2,'web_search','{}','ok',?3)",
        )
        .bind(id).bind(conv).bind(ts)
        .execute(db).await.unwrap();
    }

    async fn insert_check(db: &SqlitePool, id: &str, tool_call_id: &str, verdict: &str, ts: &str) {
        sqlx::query(
            "INSERT INTO hallucination_checks (id, chat_message_id, tool_call_id, verdict, detail, created_at) VALUES (?1,'m',?2,?3,'d',?4)",
        )
        .bind(id).bind(tool_call_id).bind(verdict).bind(ts)
        .execute(db).await.unwrap();
    }

    async fn insert_anomaly(db: &SqlitePool, id: &str, conv: &str, kind: &str, ts: &str) {
        sqlx::query(
            "INSERT INTO agent_anomalies (id, kind, conversation_id, chat_message_id, detail, created_at) VALUES (?1,?2,?3,'m','d',?4)",
        )
        .bind(id).bind(kind).bind(conv).bind(ts)
        .execute(db).await.unwrap();
    }

    #[tokio::test]
    async fn test_clarification_efficiency_measures_gap_to_next_user() {
        let db = test_db().await;
        insert_tool_call(&db, "tc1", "c1", "2026-07-20 10:00:00").await;
        insert_check(&db, "hc1", "tc1", "mismatch", "2026-07-20 10:00:10").await;
        // Next user message 50s after the mismatch.
        insert_msg(&db, "u1", "c1", "user", "2026-07-20 10:01:00").await;

        let eff = clarification_efficiency(&db, "c1").await;
        assert_eq!(eff, Some(50.0), "mismatch 10:00:10 -> user 10:01:00 is 50s");
    }

    #[tokio::test]
    async fn test_clarification_efficiency_ignores_non_mismatch_verdicts() {
        let db = test_db().await;
        insert_tool_call(&db, "tc1", "c1", "2026-07-20 10:00:00").await;
        insert_check(&db, "hc1", "tc1", "match", "2026-07-20 10:00:10").await;
        insert_msg(&db, "u1", "c1", "user", "2026-07-20 10:01:00").await;
        assert!(clarification_efficiency(&db, "c1").await.is_none(), "a 'match' is not a mismatch");
    }

    #[tokio::test]
    async fn test_clarification_efficiency_null_without_following_user() {
        let db = test_db().await;
        insert_tool_call(&db, "tc1", "c1", "2026-07-20 10:00:00").await;
        insert_check(&db, "hc1", "tc1", "mismatch", "2026-07-20 10:00:10").await;
        // No user message after -> unpairable -> null.
        assert!(clarification_efficiency(&db, "c1").await.is_none());
    }

    #[tokio::test]
    async fn test_repair_success_counts_followed_events() {
        let db = test_db().await;
        // Event 1: anomaly followed within window (repaired).
        insert_anomaly(&db, "a1", "c1", "tool_error", "2026-07-20 10:00:00").await;
        insert_msg(&db, "u1", "c1", "user", "2026-07-20 10:05:00").await; // 5min -> in window
        // Event 2: anomaly with NO following user turn (not repaired).
        insert_anomaly(&db, "a2", "c1", "iteration_cap", "2026-07-20 11:00:00").await;

        let ratio = repair_success(&db, "c1").await;
        assert_eq!(ratio, Some(0.5), "1 of 2 error events had a prompt human follow-up: {ratio:?}");
    }

    #[tokio::test]
    async fn test_repair_success_outside_window_not_counted() {
        let db = test_db().await;
        insert_anomaly(&db, "a1", "c1", "tool_error", "2026-07-20 10:00:00").await;
        // Human turn arrives 2 hours later — outside the 30-min repair window.
        insert_msg(&db, "u1", "c1", "user", "2026-07-20 12:00:00").await;
        assert_eq!(repair_success(&db, "c1").await, Some(0.0));
    }

    #[tokio::test]
    async fn test_repair_success_null_without_events() {
        let db = test_db().await;
        insert_msg(&db, "u1", "c1", "user", "2026-07-20 10:00:00").await;
        assert!(repair_success(&db, "c1").await.is_none());
    }

    #[tokio::test]
    async fn test_repair_counts_mismatch_events_too() {
        let db = test_db().await;
        insert_tool_call(&db, "tc1", "c1", "2026-07-20 10:00:00").await;
        insert_check(&db, "hc1", "tc1", "mismatch", "2026-07-20 10:00:10").await;
        insert_msg(&db, "u1", "c1", "user", "2026-07-20 10:02:00").await;
        assert_eq!(repair_success(&db, "c1").await, Some(1.0), "mismatch is an error event too");
    }

    #[tokio::test]
    async fn test_global_folds_across_conversations() {
        let db = test_db().await;
        // c1: mismatch repaired.
        insert_tool_call(&db, "tc1", "c1", "2026-07-20 10:00:00").await;
        insert_check(&db, "hc1", "tc1", "mismatch", "2026-07-20 10:00:10").await;
        insert_msg(&db, "u1", "c1", "user", "2026-07-20 10:00:40").await; // 30s
        // c2: anomaly not repaired.
        insert_anomaly(&db, "a1", "c2", "tool_error", "2026-07-20 11:00:00").await;

        let eff = clarification_efficiency_global(&db).await;
        assert_eq!(eff, Some(30.0), "only c1's mismatch had a follow-up (30s)");
        let ratio = repair_success_global(&db).await;
        // 2 error events total (c1 mismatch + c2 anomaly), 1 repaired -> 0.5.
        assert_eq!(ratio, Some(0.5), "{ratio:?}");
    }
}
