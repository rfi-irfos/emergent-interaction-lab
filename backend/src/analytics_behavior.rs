//! Typing-behavior analytics over `human_behavior` — Wave 2 / Task 11 of the
//! Deep Self-Analysis plan (framework v2.1, Dimension 3 "Cognitive Load" +
//! Dimension 1 "Attention"). Reads the raw events human_behavior::ingest
//! captured and derives:
//!
//!   * **Typing velocity curve** — chars-per-minute per one-minute window of
//!     keydown activity (a curve, not one number, because the framework wants
//!     velocity *over the course of composing*, cf. Tier C §20 Temporal
//!     Perception).
//!   * **Pause pattern** — inter-key interval distribution (mean/median/max),
//!     the cognitive-load hesitation signal.
//!   * **Backspace ratio** — backspace events / total key events (keydown +
//!     backspace), the correction-pressure signal.
//!   * **Idle distribution** — idle_start→idle_end durations, the attention
//!     drop-out signal.
//!
//! Timestamp convention: prefers the browser-side `client_ts_ms` (millisecond
//! resolution — inter-key intervals are sub-second, and the server-side
//! `created_at` is both second-granular and skewed by batching); events
//! without it fall back to `created_at` parsed as epoch ms. Same honest-empty
//! discipline as every other analytics module: no events → empty Vec / `None`
//! / `null` fields, never a fabricated 0.0.
//!
//! Global `*_global` variants fold across every conversation for the
//! (conversation-agnostic) `observatory::human_ai` binding, concatenating raw
//! samples so means are true means, not means-of-means.

use serde_json::{json, Value};
use sqlx::SqlitePool;

/// A pause longer than this (ms) between consecutive keydowns ends a typing
/// burst — intervals above it are "pauses between thoughts", not inter-key
/// rhythm, and are excluded from the velocity denominator (they'd otherwise
/// drown the CPM signal in idle time that the idle_* events already measure).
const BURST_GAP_MS: i64 = 5_000;

/// Millisecond timestamps of all events of one type in a conversation,
/// ascending. Prefers `client_ts_ms`; falls back to `created_at` (parsed as
/// SQLite wall-clock, second resolution) so pre-`client_ts_ms` rows or
/// clients that omit `ts` still count.
async fn event_ts_ms(db: &SqlitePool, conversation_id: &str, event_type: &str) -> Vec<i64> {
    let rows: Vec<(Option<i64>, String)> = sqlx::query_as(
        "SELECT client_ts_ms, created_at FROM human_behavior \
         WHERE conversation_id = ?1 AND event_type = ?2 ORDER BY COALESCE(client_ts_ms, 0), created_at, id",
    )
    .bind(conversation_id)
    .bind(event_type)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let mut out: Vec<i64> = rows
        .iter()
        .filter_map(|(client_ms, created_at)| {
            client_ms.or_else(|| {
                chrono::NaiveDateTime::parse_from_str(created_at, "%Y-%m-%d %H:%M:%S")
                    .ok()
                    .map(|dt| dt.and_utc().timestamp_millis())
            })
        })
        .collect();
    out.sort_unstable();
    out
}

fn mean(samples: &[f64]) -> Option<f64> {
    if samples.is_empty() {
        None
    } else {
        Some(samples.iter().sum::<f64>() / samples.len() as f64)
    }
}

fn median(sorted: &[f64]) -> Option<f64> {
    if sorted.is_empty() {
        return None;
    }
    let mid = sorted.len() / 2;
    Some(if sorted.len() % 2 == 0 {
        (sorted[mid - 1] + sorted[mid]) / 2.0
    } else {
        sorted[mid]
    })
}

/// Chars-per-minute per one-minute window of keydown activity, ascending by
/// window. Each keydown counts as one char (the client never sends the
/// character itself — count, not content). Empty when the conversation has
/// no keydown events. Minute windows are anchored to the first keydown, so
/// the curve reads "minute 1 of typing, minute 2, …" rather than wall-clock
/// minutes; gaps (windows with no keys) are skipped, not zero-filled — the
/// curve is a velocity profile of active typing, and idleness is the
/// idle_distribution's job.
pub async fn typing_velocity_curve(db: &SqlitePool, conversation_id: &str) -> Vec<f64> {
    let ts = event_ts_ms(db, conversation_id, "keydown").await;
    velocity_curve_from_ts(&ts)
}

/// Pure core of [`typing_velocity_curve`], separated for direct unit testing.
fn velocity_curve_from_ts(ts: &[i64]) -> Vec<f64> {
    if ts.is_empty() {
        return Vec::new();
    }
    let start = ts[0];
    let mut counts: std::collections::BTreeMap<i64, i64> = std::collections::BTreeMap::new();
    for t in ts {
        let window = (t - start) / 60_000;
        *counts.entry(window).or_insert(0) += 1;
    }
    // count per minute IS chars per minute for a one-minute window.
    counts.values().map(|&n| n as f64).collect()
}

/// Inter-key interval distribution for one conversation:
/// `{mean_ms, median_ms, max_ms, long_pauses, sample_size}` where
/// `long_pauses` counts intervals above [`BURST_GAP_MS`] (thought-pauses).
/// All-null shape (`{"sample_size": 0, ...nulls}`) when fewer than two
/// keydowns exist — an interval needs a pair.
pub async fn pause_pattern(db: &SqlitePool, conversation_id: &str) -> Value {
    let ts = event_ts_ms(db, conversation_id, "keydown").await;
    pause_pattern_from_ts(&ts)
}

fn pause_pattern_from_ts(ts: &[i64]) -> Value {
    let mut intervals: Vec<f64> = ts.windows(2).map(|w| (w[1] - w[0]) as f64).collect();
    if intervals.is_empty() {
        return json!({
            "mean_ms": null,
            "median_ms": null,
            "max_ms": null,
            "long_pauses": 0,
            "sample_size": 0,
        });
    }
    intervals.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let long_pauses = intervals.iter().filter(|&&i| i > BURST_GAP_MS as f64).count();
    json!({
        "mean_ms": mean(&intervals),
        "median_ms": median(&intervals),
        "max_ms": intervals.last().copied(),
        "long_pauses": long_pauses,
        "sample_size": intervals.len(),
    })
}

/// backspace events / (keydown + backspace) for one conversation — `None`
/// when no key events exist at all (honest empty, not 0.0). The client
/// convention is that Backspace presses are logged as `'backspace'`, NOT
/// double-logged as `'keydown'`, so the denominator is a plain sum.
pub async fn backspace_ratio(db: &SqlitePool, conversation_id: &str) -> Option<f64> {
    let (keydowns,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM human_behavior WHERE conversation_id = ?1 AND event_type = 'keydown'",
    )
    .bind(conversation_id)
    .fetch_one(db)
    .await
    .unwrap_or((0,));
    let (backspaces,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM human_behavior WHERE conversation_id = ?1 AND event_type = 'backspace'",
    )
    .bind(conversation_id)
    .fetch_one(db)
    .await
    .unwrap_or((0,));
    let total = keydowns + backspaces;
    if total == 0 {
        None
    } else {
        Some(backspaces as f64 / total as f64)
    }
}

/// idle_start→idle_end durations for one conversation:
/// `{mean_seconds, max_seconds, count}`. Pairs each idle_start with the next
/// idle_end after it (unclosed trailing idle_starts are dropped — the window
/// never ended, so its duration would be a fabrication). Null-means/zero-count
/// shape when nothing pairs.
pub async fn idle_distribution(db: &SqlitePool, conversation_id: &str) -> Value {
    let starts = event_ts_ms(db, conversation_id, "idle_start").await;
    let ends = event_ts_ms(db, conversation_id, "idle_end").await;
    idle_distribution_from_ts(&starts, &ends)
}

fn idle_durations_s(starts: &[i64], ends: &[i64]) -> Vec<f64> {
    let mut durations = Vec::new();
    let mut ei = 0usize;
    for &s in starts {
        while ei < ends.len() && ends[ei] <= s {
            ei += 1;
        }
        if ei < ends.len() {
            durations.push((ends[ei] - s) as f64 / 1000.0);
            ei += 1;
        }
    }
    durations
}

fn idle_distribution_from_ts(starts: &[i64], ends: &[i64]) -> Value {
    let durations = idle_durations_s(starts, ends);
    json!({
        "mean_seconds": mean(&durations),
        "max_seconds": durations.iter().cloned().fold(None::<f64>, |acc, d| Some(acc.map_or(d, |a| a.max(d)))),
        "count": durations.len(),
    })
}

/// Every conversation that has at least one behavior event.
async fn distinct_conversations(db: &SqlitePool) -> Vec<String> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT DISTINCT conversation_id FROM human_behavior")
            .fetch_all(db)
            .await
            .unwrap_or_default();
    rows.into_iter().map(|(c,)| c).collect()
}

/// Global mean typing velocity (CPM) across every conversation's curve —
/// concatenates all per-minute samples (true mean). `None` when no keydown
/// exists anywhere. Backs human_ai's `typing_velocity_cpm`.
pub async fn typing_velocity_global(db: &SqlitePool) -> Option<f64> {
    let mut all: Vec<f64> = Vec::new();
    for cid in distinct_conversations(db).await {
        all.extend(typing_velocity_curve(db, &cid).await);
    }
    mean(&all)
}

/// Global backspace ratio: total backspaces / total key events across all
/// conversations (a true ratio over raw counts, not a mean of ratios).
/// Backs human_ai's `backspace_ratio`.
pub async fn backspace_ratio_global(db: &SqlitePool) -> Option<f64> {
    let (keydowns,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM human_behavior WHERE event_type = 'keydown'")
            .fetch_one(db)
            .await
            .unwrap_or((0,));
    let (backspaces,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM human_behavior WHERE event_type = 'backspace'")
            .fetch_one(db)
            .await
            .unwrap_or((0,));
    let total = keydowns + backspaces;
    if total == 0 {
        None
    } else {
        Some(backspaces as f64 / total as f64)
    }
}

/// Global mean idle duration (seconds) — concatenates raw paired durations
/// across conversations. `None` when nothing pairs anywhere. Backs human_ai's
/// `mean_idle_seconds`.
pub async fn mean_idle_seconds_global(db: &SqlitePool) -> Option<f64> {
    let mut all: Vec<f64> = Vec::new();
    for cid in distinct_conversations(db).await {
        let starts = event_ts_ms(db, &cid, "idle_start").await;
        let ends = event_ts_ms(db, &cid, "idle_end").await;
        all.extend(idle_durations_s(&starts, &ends));
    }
    mean(&all)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_db() -> SqlitePool {
        let db = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::human_behavior::init_schema(&db).await;
        db
    }

    async fn insert_event(db: &SqlitePool, conv: &str, event_type: &str, ts_ms: i64) {
        sqlx::query(
            "INSERT INTO human_behavior (conversation_id, event_type, client_ts_ms) VALUES (?1, ?2, ?3)",
        )
        .bind(conv)
        .bind(event_type)
        .bind(ts_ms)
        .execute(db)
        .await
        .unwrap();
    }

    const T0: i64 = 1_753_400_000_000; // arbitrary epoch-ms anchor

    // ── typing_velocity_curve ───────────────────────────────────────────────

    #[tokio::test]
    async fn velocity_curve_counts_keydowns_per_minute_window() {
        let db = test_db().await;
        // Minute 0: 3 keydowns; minute 1: 2 keydowns.
        for i in 0..3 {
            insert_event(&db, "c1", "keydown", T0 + i * 1_000).await;
        }
        insert_event(&db, "c1", "keydown", T0 + 61_000).await;
        insert_event(&db, "c1", "keydown", T0 + 62_000).await;
        // A backspace must NOT count as a typed char.
        insert_event(&db, "c1", "backspace", T0 + 2_500).await;

        let curve = typing_velocity_curve(&db, "c1").await;
        assert_eq!(curve, vec![3.0, 2.0]);
    }

    #[tokio::test]
    async fn velocity_curve_empty_without_keydowns() {
        let db = test_db().await;
        insert_event(&db, "c1", "scroll", T0).await;
        assert!(typing_velocity_curve(&db, "c1").await.is_empty());
    }

    // ── pause_pattern ───────────────────────────────────────────────────────

    #[tokio::test]
    async fn pause_pattern_computes_interval_stats() {
        let db = test_db().await;
        // Intervals: 100ms, 300ms, 6000ms (one long pause).
        insert_event(&db, "c1", "keydown", T0).await;
        insert_event(&db, "c1", "keydown", T0 + 100).await;
        insert_event(&db, "c1", "keydown", T0 + 400).await;
        insert_event(&db, "c1", "keydown", T0 + 6_400).await;

        let v = pause_pattern(&db, "c1").await;
        assert_eq!(v["sample_size"], 3, "{v}");
        assert!((v["mean_ms"].as_f64().unwrap() - (100.0 + 300.0 + 6000.0) / 3.0).abs() < 1e-9, "{v}");
        assert_eq!(v["median_ms"].as_f64().unwrap(), 300.0, "{v}");
        assert_eq!(v["max_ms"].as_f64().unwrap(), 6000.0, "{v}");
        assert_eq!(v["long_pauses"], 1, "only the 6s gap exceeds BURST_GAP_MS: {v}");
    }

    #[tokio::test]
    async fn pause_pattern_honest_empty_below_two_keydowns() {
        let db = test_db().await;
        insert_event(&db, "c1", "keydown", T0).await;
        let v = pause_pattern(&db, "c1").await;
        assert!(v["mean_ms"].is_null(), "{v}");
        assert_eq!(v["sample_size"], 0, "{v}");
    }

    // ── backspace_ratio ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn backspace_ratio_over_all_key_events() {
        let db = test_db().await;
        for i in 0..3 {
            insert_event(&db, "c1", "keydown", T0 + i * 100).await;
        }
        insert_event(&db, "c1", "backspace", T0 + 400).await;
        let r = backspace_ratio(&db, "c1").await;
        assert_eq!(r, Some(0.25), "1 backspace / 4 key events");
    }

    #[tokio::test]
    async fn backspace_ratio_none_without_key_events() {
        let db = test_db().await;
        insert_event(&db, "c1", "scroll", T0).await;
        assert!(backspace_ratio(&db, "c1").await.is_none());
    }

    // ── idle_distribution ───────────────────────────────────────────────────

    #[tokio::test]
    async fn idle_distribution_pairs_start_with_next_end() {
        let db = test_db().await;
        // Two closed windows: 30s and 90s; one trailing unclosed start.
        insert_event(&db, "c1", "idle_start", T0).await;
        insert_event(&db, "c1", "idle_end", T0 + 30_000).await;
        insert_event(&db, "c1", "idle_start", T0 + 60_000).await;
        insert_event(&db, "c1", "idle_end", T0 + 150_000).await;
        insert_event(&db, "c1", "idle_start", T0 + 200_000).await; // never ends

        let v = idle_distribution(&db, "c1").await;
        assert_eq!(v["count"], 2, "unclosed trailing idle_start is dropped: {v}");
        assert_eq!(v["mean_seconds"].as_f64().unwrap(), 60.0, "mean of 30s and 90s: {v}");
        assert_eq!(v["max_seconds"].as_f64().unwrap(), 90.0, "{v}");
    }

    #[tokio::test]
    async fn idle_distribution_honest_empty() {
        let db = test_db().await;
        let v = idle_distribution(&db, "c1").await;
        assert_eq!(v["count"], 0, "{v}");
        assert!(v["mean_seconds"].is_null(), "{v}");
    }

    // ── globals ─────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn globals_fold_across_conversations() {
        let db = test_db().await;
        // c1: 2 keydowns in one minute; c2: 4 keydowns in one minute.
        insert_event(&db, "c1", "keydown", T0).await;
        insert_event(&db, "c1", "keydown", T0 + 1_000).await;
        for i in 0..4 {
            insert_event(&db, "c2", "keydown", T0 + i * 1_000).await;
        }
        insert_event(&db, "c2", "backspace", T0 + 5_000).await;
        insert_event(&db, "c1", "idle_start", T0 + 10_000).await;
        insert_event(&db, "c1", "idle_end", T0 + 30_000).await; // 20s
        insert_event(&db, "c2", "idle_start", T0 + 10_000).await;
        insert_event(&db, "c2", "idle_end", T0 + 50_000).await; // 40s

        let cpm = typing_velocity_global(&db).await;
        assert_eq!(cpm, Some(3.0), "true mean of per-minute samples [2, 4]");
        let bs = backspace_ratio_global(&db).await;
        assert_eq!(bs, Some(1.0 / 7.0), "1 backspace / 7 key events overall");
        let idle = mean_idle_seconds_global(&db).await;
        assert_eq!(idle, Some(30.0), "mean of 20s and 40s");
    }

    #[tokio::test]
    async fn globals_honest_empty_on_bare_db() {
        let db = test_db().await;
        assert!(typing_velocity_global(&db).await.is_none());
        assert!(backspace_ratio_global(&db).await.is_none());
        assert!(mean_idle_seconds_global(&db).await.is_none());
    }
}
