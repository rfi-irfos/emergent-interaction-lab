use sqlx::SqlitePool;

use super::DIGEST_WINDOW_DAYS;

/// Everything the digest reports — assembled from real aggregate queries
/// against tables this platform already owns (emergence_signals,
/// simulation_runs, research_notes), reusing the exact query SHAPES
/// `observatory::everything` already established (level_rows / status_rows /
/// category_mix, all windowed via `datetime('now', ?1)`) rather than
/// inventing new SQL.
///
/// Two kinds of numbers, deliberately never blurred together (see
/// `format_facts_for_prompt`'s explicit framing instruction to the model):
/// what genuinely HAPPENED in the window (signals, completed runs, new
/// notes — backward-looking, closed facts, windowed by `created_at`/
/// `updated_at`) vs. what's genuinely still OPEN right now (pending runs,
/// active notes — forward-looking, but real present-tense state, never a
/// fabricated prediction of what Laura will do next — deliberately NOT
/// windowed by date, since a run pending for three weeks is still pending
/// today).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DigestFacts {
    pub range_days: i64,
    pub signals_by_level: Vec<(String, i64)>,
    pub signals_total: i64,
    pub sims_completed: i64,
    pub sims_pending: i64,
    pub notes_added: i64,
    pub notes_active: i64,
}

/// Runs the real aggregate queries. Every query independently degrades to
/// an honest zero on failure (`.unwrap_or_default()`/`.unwrap_or((0,))`,
/// the same graceful-degradation convention `observatory::everything` and
/// the rest of this codebase already use) rather than failing the whole
/// digest over one table's transient issue.
pub(crate) async fn gather_digest_facts(db: &SqlitePool) -> DigestFacts {
    let window = format!("-{DIGEST_WINDOW_DAYS} days");

    // Same shape as observatory::everything's level_rows.
    let signals_by_level: Vec<(String, i64)> = sqlx::query_as(
        "SELECT level, COUNT(*) FROM emergence_signals WHERE created_at > datetime('now', ?1) GROUP BY level ORDER BY level",
    )
    .bind(&window)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let signals_total: i64 = signals_by_level.iter().map(|(_, c)| c).sum();

    // Completed IN the window, keyed on `updated_at` — the timestamp
    // simulation.rs's own `UPDATE simulation_runs SET status = 'complete',
    // updated_at = ...` actually stamps at completion time, so a run
    // created long ago that only resolved this week is genuinely counted as
    // this week's completion.
    let (sims_completed,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM simulation_runs WHERE status = 'complete' AND updated_at > datetime('now', ?1)",
    )
    .bind(&window)
    .fetch_one(db)
    .await
    .unwrap_or((0,));

    // Still open RIGHT NOW — deliberately NOT windowed by created_at: a run
    // pending for three weeks is still genuinely pending today, and
    // dropping it because it wasn't CREATED this week would understate
    // what's actually still open.
    let (sims_pending,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM simulation_runs WHERE status = 'pending'")
        .fetch_one(db)
        .await
        .unwrap_or((0,));

    let (notes_added,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM research_notes WHERE created_at > datetime('now', ?1)",
    )
    .bind(&window)
    .fetch_one(db)
    .await
    .unwrap_or((0,));

    // Same "right now, not windowed" reasoning as sims_pending above.
    let (notes_active,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM research_notes WHERE status = 'active'")
        .fetch_one(db)
        .await
        .unwrap_or((0,));

    DigestFacts {
        range_days: DIGEST_WINDOW_DAYS,
        signals_by_level,
        signals_total,
        sims_completed,
        sims_pending,
        notes_added,
        notes_active,
    }
}

/// The user-turn message sent to the model — plain German prose listing
/// every real number, with an explicit instruction not to fabricate or
/// predict. Pure and DB/network-free, so it's directly unit-testable.
pub(crate) fn format_facts_for_prompt(facts: &DigestFacts) -> String {
    let mut s = format!(
        "Echte Zahlen der letzten {} Tage aus der Datenbank (Stichtag: heute) — nutze ausschließlich diese Zahlen, erfinde nichts hinzu und mach keine Vorhersage darüber, was Laura als Nächstes tun wird:\n\n",
        facts.range_days
    );
    s.push_str(&format!("- Neue Emergenzsignale gesamt: {}\n", facts.signals_total));
    if facts.signals_by_level.is_empty() {
        s.push_str("  (keine neuen Signale in diesem Zeitraum)\n");
    } else {
        for (level, count) in &facts.signals_by_level {
            s.push_str(&format!("  - Level \"{level}\": {count}\n"));
        }
    }
    s.push_str(&format!(
        "- Abgeschlossene Simulationsläufe in diesem Zeitraum: {}\n",
        facts.sims_completed
    ));
    s.push_str(&format!(
        "- Aktuell noch offene (pending) Simulationsläufe insgesamt: {}\n",
        facts.sims_pending
    ));
    s.push_str(&format!("- Neue Research Notes in diesem Zeitraum: {}\n", facts.notes_added));
    s.push_str(&format!(
        "- Aktuell aktive Research Notes insgesamt: {}\n",
        facts.notes_active
    ));
    s.push_str(
        "\nSchreib daraus einen kurzen, ehrlichen Wochenrückblick in deiner eigenen Stimme — kein Formularbrief, kein bloßes Abtippen der Liste. Was offen oder pending ist, benenn klar als offen/pending, nicht als Vorhersage, was als Nächstes passiert.",
    );
    s
}

/// Used only when every NVIDIA candidate fails (see `generate_prose` in the
/// parent module) — still real data, just without a model's prose wrapped
/// around it. Matches this codebase's graceful-degradation doctrine (e.g.
/// `chat::embed`'s failure just yields an empty retrieval context instead of
/// blocking the reply) rather than either blocking digest creation entirely
/// or fabricating placeholder text.
pub(crate) fn fallback_digest_text(facts: &DigestFacts) -> String {
    let mut s = format!(
        "Automatischer Rückblick der letzten {} Tage (echte Zahlen — das Sprachmodell war für die Zusammenfassung gerade nicht erreichbar):\n\n",
        facts.range_days
    );
    s.push_str(&format!("- Neue Emergenzsignale: {}\n", facts.signals_total));
    for (level, count) in &facts.signals_by_level {
        s.push_str(&format!("  - Level \"{level}\": {count}\n"));
    }
    s.push_str(&format!("- Abgeschlossene Simulationsläufe: {}\n", facts.sims_completed));
    s.push_str(&format!("- Noch offene Simulationsläufe: {}\n", facts.sims_pending));
    s.push_str(&format!("- Neue Research Notes: {}\n", facts.notes_added));
    s.push_str(&format!("- Aktuell aktive Research Notes: {}\n", facts.notes_active));
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_facts() -> DigestFacts {
        DigestFacts {
            range_days: 7,
            signals_by_level: vec![("ai".to_string(), 1), ("human".to_string(), 2)],
            signals_total: 3,
            sims_completed: 4,
            sims_pending: 5,
            notes_added: 6,
            notes_active: 7,
        }
    }

    #[test]
    fn format_facts_for_prompt_contains_every_real_number_not_a_placeholder() {
        let text = format_facts_for_prompt(&sample_facts());
        assert!(text.contains("Neue Emergenzsignale gesamt: 3"));
        assert!(text.contains("Level \"ai\": 1"));
        assert!(text.contains("Level \"human\": 2"));
        assert!(text.contains("Abgeschlossene Simulationsläufe in diesem Zeitraum: 4"));
        assert!(text.contains("Aktuell noch offene (pending) Simulationsläufe insgesamt: 5"));
        assert!(text.contains("Neue Research Notes in diesem Zeitraum: 6"));
        assert!(text.contains("Aktuell aktive Research Notes insgesamt: 7"));
        assert!(text.contains("keine Vorhersage"), "must instruct the model against fabricated predictions");
    }

    #[test]
    fn format_facts_for_prompt_honestly_reports_an_empty_window() {
        let empty = DigestFacts {
            range_days: 7,
            signals_by_level: vec![],
            signals_total: 0,
            sims_completed: 0,
            sims_pending: 0,
            notes_added: 0,
            notes_active: 0,
        };
        let text = format_facts_for_prompt(&empty);
        assert!(text.contains("keine neuen Signale in diesem Zeitraum"));
        assert!(text.contains("gesamt: 0"));
    }

    #[test]
    fn fallback_digest_text_contains_every_real_number() {
        let text = fallback_digest_text(&sample_facts());
        assert!(text.contains("Neue Emergenzsignale: 3"));
        assert!(text.contains("Abgeschlossene Simulationsläufe: 4"));
        assert!(text.contains("Noch offene Simulationsläufe: 5"));
        assert!(text.contains("Neue Research Notes: 6"));
        assert!(text.contains("Aktuell aktive Research Notes: 7"));
    }
}
