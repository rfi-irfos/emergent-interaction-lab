//! Communication metrics over `chat_messages.content` — Wave 0 / Task 3 of
//! the Deep Self-Analysis plan. Three pure, side-effect-free heuristics that
//! quantify *how* Laura writes to Jarvis (not *what* about), so the
//! Interaction-Dynamics observatory can surface prompt length, how
//! structured her prompts are, and how constraint-heavy (spec-heavy) they
//! are — over a window, as aggregates.
//!
//! All three are deliberately dependency-free (no regex crate — none is used
//! anywhere else in this backend, same self-imposed rule as
//! `hallucination.rs`'s hand-rolled UUID scanner) and pure, so they are
//! directly unit-testable against literal fixtures and can be folded over a
//! query result in `observatory::human_ai` without any DB coupling.

/// Length of `content` in Unicode scalar values (chars), not bytes — German
/// prose routinely carries multi-byte characters (ü/ß/…), and a raw byte
/// count would over-report length for exactly the language Laura writes in.
pub fn prompt_length(content: &str) -> usize {
    content.chars().count()
}

/// Fraction (0.0..=1.0) of `content`'s non-empty lines that *look*
/// structured: a list marker (`-` / `*` / `+`), a numbered-list prefix
/// (`1.` / `2)` …), a Markdown header (`#`), or a fenced code block
/// (```` ``` ````). A rough proxy for "did she format this as a spec /
/// checklist" vs. "did she write a plain sentence." Empty / whitespace-only
/// content is `0.0` (nothing structured, and never a divide-by-zero).
pub fn structured_prompt_ratio(content: &str) -> f64 {
    let lines: Vec<&str> = content.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
    if lines.is_empty() {
        return 0.0;
    }
    let structured = lines.iter().filter(|line| line_is_structured(line)).count();
    structured as f64 / lines.len() as f64
}

/// A single trimmed, non-empty line judged structured or not. Kept separate
/// so the exact heuristic is testable in isolation and easy to extend.
fn line_is_structured(line: &str) -> bool {
    // Fenced code block delimiter.
    if line.starts_with("```") {
        return true;
    }
    // Markdown header.
    if line.starts_with('#') {
        return true;
    }
    // Unordered list marker followed by a space ("- x", "* x", "+ x").
    if let Some(rest) = line
        .strip_prefix("- ")
        .or_else(|| line.strip_prefix("* "))
        .or_else(|| line.strip_prefix("+ "))
    {
        // A bare "-" surrounded by spaces (a dash in prose) isn't a marker,
        // but "- something" is; `rest` is what follows the marker+space.
        let _ = rest;
        return true;
    }
    // Numbered list: leading digits then '.' or ')' then a space
    // ("1. foo", "2) bar").
    let digits: String = line.chars().take_while(|c| c.is_ascii_digit()).collect();
    if !digits.is_empty() {
        let after = &line[digits.len()..];
        if after.starts_with(". ") || after.starts_with(") ") {
            return true;
        }
    }
    false
}

/// Explicit constraint / negation / specification words per 100 chars — a
/// density, so a long prompt with two "muss" isn't scored the same as a
/// short one. Case-insensitive whole-token count over both German and
/// English constraint vocabulary. `0.0` for empty content (never a
/// divide-by-zero).
pub fn constraint_density(content: &str) -> f64 {
    let char_count = content.chars().count();
    if char_count == 0 {
        return 0.0;
    }
    let lower = content.to_lowercase();
    let hits = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|tok| !tok.is_empty())
        .filter(|tok| CONSTRAINT_WORDS.contains(tok))
        .count();
    (hits as f64) * 100.0 / (char_count as f64)
}

/// Whole-token constraint/negation/spec vocabulary — German + English.
/// Deliberately whole-token (matched against tokenized words, not
/// substrings) so "nur" doesn't fire inside "Nurse" and "not" doesn't fire
/// inside "note". Lowercase; `content` is lowercased before comparison.
const CONSTRAINT_WORDS: &[&str] = &[
    // German
    "nicht", "kein", "keine", "keinen", "darf", "muss", "müssen", "soll",
    "sollte", "bitte", "nur", "exakt", "genau", "vermeide", "niemals",
    // English
    "don't", "dont", "must", "should", "not", "never", "only", "avoid",
    "exactly", "no",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prompt_length_counts_chars_not_bytes() {
        assert_eq!(prompt_length(""), 0);
        assert_eq!(prompt_length("hello"), 5);
        // "ü" and "ß" are multi-byte but single chars.
        assert_eq!(prompt_length("müß"), 3);
    }

    #[test]
    fn test_structured_prompt_ratio_empty_is_zero() {
        assert_eq!(structured_prompt_ratio(""), 0.0);
        assert_eq!(structured_prompt_ratio("   \n  \n"), 0.0);
    }

    #[test]
    fn test_structured_prompt_ratio_plain_prose_is_zero() {
        assert_eq!(structured_prompt_ratio("Kannst du mir bitte helfen?"), 0.0);
    }

    #[test]
    fn test_structured_prompt_ratio_all_structured_is_one() {
        let content = "# Aufgabe\n- Punkt eins\n- Punkt zwei\n1. Schritt";
        assert!((structured_prompt_ratio(content) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn test_structured_prompt_ratio_mixed_is_fraction() {
        // 4 non-empty lines, 2 structured (the "- " ones) → 0.5.
        let content = "Hier ist mein Plan:\n- erstens\n- zweitens\nDanke.";
        assert!((structured_prompt_ratio(content) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn test_structured_prompt_ratio_code_fence_counts() {
        let content = "```\nlet x = 1;\n```";
        // "```", "let x = 1;", "```" → 2 fence lines structured of 3.
        let r = structured_prompt_ratio(content);
        assert!(r > 0.0 && r <= 1.0);
    }

    #[test]
    fn test_constraint_density_empty_is_zero() {
        assert_eq!(constraint_density(""), 0.0);
    }

    #[test]
    fn test_constraint_density_no_constraints_is_zero() {
        assert_eq!(constraint_density("Erzähl mir eine Geschichte über den Ozean."), 0.0);
    }

    #[test]
    fn test_constraint_density_counts_constraint_words() {
        // "Du darfst das nicht tun, nur exakt so." → darfst? no ("darf"
        // whole-token). Tokens: du, darfst, das, nicht, tun, nur, exakt, so.
        // Constraint hits: nicht, nur, exakt = 3.
        let content = "Du darfst das nicht tun, nur exakt so.";
        let density = constraint_density(content);
        let expected = 3.0 * 100.0 / content.chars().count() as f64;
        assert!((density - expected).abs() < 1e-9, "got {density}, expected {expected}");
    }

    #[test]
    fn test_constraint_density_whole_token_no_substring_false_positive() {
        // "Nurse" must NOT trigger "nur"; "note" must NOT trigger "not".
        assert_eq!(constraint_density("Nurse note"), 0.0);
    }

    #[test]
    fn test_constraint_density_english_words() {
        // "You must not do this" → must, not = 2.
        let content = "You must not do this";
        let expected = 2.0 * 100.0 / content.chars().count() as f64;
        assert!((constraint_density(content) - expected).abs() < 1e-9);
    }
}
