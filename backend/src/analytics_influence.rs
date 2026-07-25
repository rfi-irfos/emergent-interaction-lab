//! Direction-of-Influence analyzer (who shapes whom) — Deep Self-Analysis
//! plan, Task 14. The dyad's mutual shaping runs through two observable
//! channels, and this module measures both directions:
//!
//!   * **Laura → Jarvis (vocabulary adoption)** — a `shared_terms` entry that
//!     appears FIRST in a *user* message and LATER in an *assistant* message:
//!     Laura coined (or introduced) the term, Jarvis adopted it. The reverse
//!     ordering (assistant first, user later) is Jarvis → Laura adoption.
//!   * **Jarvis → Laura (correction pressure)** — every
//!     `hallucination_checks` row with `verdict='mismatch'` that was followed
//!     by a *user* message in the same conversation: his verified error
//!     shaped her next turn. Same `tool_call_id → agent_tool_calls`
//!     conversation linkage the flagging matrix uses.
//!
//! Same honest-empty discipline as every other observatory feed: missing
//! tables or zero rows degrade to zero counts / empty lists, never to
//! fabricated numbers. Pure async function over the pool returning
//! `serde_json::Value`, following the `analytics_decisions` /
//! `analytics_flagging` module pattern, bound into the API by the thin
//! `observatory::influence` handler (`/api/observatory/influence`).

use serde_json::{json, Value};
use sqlx::SqlitePool;

/// First occurrence timestamp of `term` (case-insensitive substring) in a
/// message of the given `role`. `None` when the term never appeared on that
/// side (or the table is missing on an older DB — never panic).
async fn first_occurrence(db: &SqlitePool, term: &str, role: &str) -> Option<String> {
    sqlx::query_as::<_, (String,)>(
        "SELECT created_at FROM chat_messages \
         WHERE role = ?1 AND instr(lower(content), lower(?2)) > 0 \
         ORDER BY created_at ASC LIMIT 1",
    )
    .bind(role)
    .bind(term)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .map(|(ts,)| ts)
}

/// The Direction-of-Influence graph. Shape:
///
/// ```json
/// {
///   "laura_to_jarvis": {"count": n, "terms": [{"term","first_user_at","first_assistant_at"}, ...]},
///   "jarvis_to_laura": {
///     "adopted_terms": {"count": n, "terms": [{"term","first_assistant_at","first_user_at"}, ...]},
///     "correction_pressure": n
///   },
///   "balance": {"laura_to_jarvis_count": n, "jarvis_to_laura_count": n, "ratio": f|null}
/// }
/// ```
///
/// `ratio` is laura/jarvis and `null` when the jarvis side is zero (honest
/// null, never a fabricated or infinite number). Term lists are capped at 20
/// entries each, ordered by earliest adoption.
pub async fn direction_of_influence(db: &SqlitePool) -> Value {
    let terms: Vec<(String,)> = sqlx::query_as("SELECT term FROM shared_terms ORDER BY term")
        .fetch_all(db)
        .await
        .unwrap_or_default();

    let mut laura_to_jarvis: Vec<Value> = Vec::new();
    let mut jarvis_adopted: Vec<Value> = Vec::new();
    for (term,) in &terms {
        let user_at = first_occurrence(db, term, "user").await;
        let asst_at = first_occurrence(db, term, "assistant").await;
        match (user_at, asst_at) {
            (Some(u), Some(a)) if u < a => {
                // Laura used it first, Jarvis adopted it later.
                laura_to_jarvis.push(json!({
                    "term": term,
                    "first_user_at": u,
                    "first_assistant_at": a,
                }));
            }
            (Some(u), Some(a)) if a < u => {
                // Jarvis introduced it, Laura picked it up.
                jarvis_adopted.push(json!({
                    "term": term,
                    "first_assistant_at": a,
                    "first_user_at": u,
                }));
            }
            // Identical timestamps (undecidable) or one-sided/absent terms
            // (seeds never organically used) influence neither direction.
            _ => {}
        }
    }
    let l2j_count = laura_to_jarvis.len() as i64;
    let j2l_adopted_count = jarvis_adopted.len() as i64;
    laura_to_jarvis.sort_by(|a, b| a["first_assistant_at"].as_str().cmp(&b["first_assistant_at"].as_str()));
    jarvis_adopted.sort_by(|a, b| a["first_user_at"].as_str().cmp(&b["first_user_at"].as_str()));
    laura_to_jarvis.truncate(20);
    jarvis_adopted.truncate(20);

    // Correction pressure: mismatch verdicts followed by a user message in
    // the same conversation — his verified error shaped her next turn.
    // Same join style as analytics_flagging::flag_resolution_type.
    let mismatches: Vec<(String, String)> = sqlx::query_as(
        "SELECT atc.conversation_id, hc.created_at FROM hallucination_checks hc \
         JOIN agent_tool_calls atc ON atc.id = hc.tool_call_id \
         WHERE hc.verdict='mismatch' AND atc.conversation_id IS NOT NULL",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let mut correction_pressure = 0i64;
    for (cid, ts) in &mismatches {
        let (following,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM chat_messages \
             WHERE conversation_id = ?1 AND created_at > ?2 AND role = 'user'",
        )
        .bind(cid)
        .bind(ts)
        .fetch_one(db)
        .await
        .unwrap_or((0,));
        if following > 0 {
            correction_pressure += 1;
        }
    }

    let jarvis_total = j2l_adopted_count + correction_pressure;
    let ratio = if jarvis_total > 0 {
        Some(l2j_count as f64 / jarvis_total as f64)
    } else {
        None
    };
    json!({
        "laura_to_jarvis": {
            "count": l2j_count,
            "terms": laura_to_jarvis,
        },
        "jarvis_to_laura": {
            "adopted_terms": {
                "count": j2l_adopted_count,
                "terms": jarvis_adopted,
            },
            "correction_pressure": correction_pressure,
        },
        "balance": {
            "laura_to_jarvis_count": l2j_count,
            "jarvis_to_laura_count": jarvis_total,
            "ratio": ratio,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_db() -> SqlitePool {
        let db = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::chat::init_schema(&db).await; // chat_messages + shared_terms (seeded)
        crate::agent::init_schema(&db).await; // agent_tool_calls
        crate::hallucination::init_schema(&db).await; // hallucination_checks
        db
    }

    async fn insert_msg(db: &SqlitePool, id: &str, conv: &str, role: &str, content: &str, ts: &str) {
        sqlx::query(
            "INSERT INTO chat_messages (id, conversation_id, role, content, created_at) VALUES (?1,?2,?3,?4,?5)",
        )
        .bind(id)
        .bind(conv)
        .bind(role)
        .bind(content)
        .bind(ts)
        .execute(db)
        .await
        .unwrap();
    }

    async fn insert_term(db: &SqlitePool, term: &str) {
        sqlx::query("INSERT OR IGNORE INTO shared_terms (term, frequency) VALUES (?1, 1)")
            .bind(term)
            .execute(db)
            .await
            .unwrap();
    }

    async fn insert_mismatch(db: &SqlitePool, id: &str, conv: &str, ts: &str) {
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
            "INSERT INTO hallucination_checks (id, chat_message_id, tool_call_id, verdict, detail, created_at) VALUES (?1,'m',?2,'mismatch','d',?3)",
        )
        .bind(id)
        .bind(&tc_id)
        .bind(ts)
        .execute(db)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn test_influence_direction() {
        let db = test_db().await;
        // Term Laura coined and Jarvis adopted later.
        insert_term(&db, "flimmerkern").await;
        insert_msg(&db, "u1", "c1", "user", "let's call it the Flimmerkern", "2026-07-20 10:00:00").await;
        insert_msg(&db, "a1", "c1", "assistant", "the flimmerkern idea holds", "2026-07-20 10:01:00").await;
        // Term Jarvis introduced and Laura reused later.
        insert_term(&db, "gradientecho").await;
        insert_msg(&db, "a2", "c1", "assistant", "I call this a GradientEcho", "2026-07-20 11:00:00").await;
        insert_msg(&db, "u2", "c1", "user", "yes, the gradientecho again", "2026-07-20 11:05:00").await;
        // Correction pressure: mismatch followed by a user message.
        insert_mismatch(&db, "h1", "c2", "2026-07-20 12:00:00").await;
        insert_msg(&db, "u3", "c2", "user", "you got that wrong", "2026-07-20 12:01:00").await;
        // Mismatch with NO user follow-up must not count.
        insert_mismatch(&db, "h2", "c3", "2026-07-20 13:00:00").await;

        let v = direction_of_influence(&db).await;
        assert_eq!(v["laura_to_jarvis"]["count"], 1, "{v}");
        assert_eq!(v["laura_to_jarvis"]["terms"][0]["term"], "flimmerkern", "{v}");
        assert_eq!(v["jarvis_to_laura"]["adopted_terms"]["count"], 1, "{v}");
        assert_eq!(v["jarvis_to_laura"]["adopted_terms"]["terms"][0]["term"], "gradientecho", "{v}");
        assert_eq!(v["jarvis_to_laura"]["correction_pressure"], 1, "unfollowed mismatch must not count: {v}");
        assert_eq!(v["balance"]["laura_to_jarvis_count"], 1, "{v}");
        assert_eq!(v["balance"]["jarvis_to_laura_count"], 2, "{v}");
        assert!((v["balance"]["ratio"].as_f64().unwrap() - 0.5).abs() < 1e-9, "{v}");
    }

    #[tokio::test]
    async fn test_influence_empty_is_honest_zero() {
        let db = test_db().await;
        // Seeded framework terms exist but never appear in any message —
        // they must influence neither direction.
        let v = direction_of_influence(&db).await;
        assert_eq!(v["laura_to_jarvis"]["count"], 0, "{v}");
        assert_eq!(v["jarvis_to_laura"]["adopted_terms"]["count"], 0, "{v}");
        assert_eq!(v["jarvis_to_laura"]["correction_pressure"], 0, "{v}");
        assert!(v["balance"]["ratio"].is_null(), "zero jarvis side must be null ratio, not a number: {v}");
    }
}
