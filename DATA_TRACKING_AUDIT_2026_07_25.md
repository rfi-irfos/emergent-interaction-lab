# EIL Observatory — Data Tracking Audit vs. 40/40/20 Metrics Framework

**Date:** 2026-07-25
**Scope:** Read-only backend/frontend archaeology. No code changed. Compares Simeon's 40% Human / 40% Model / 20% Dyad framework against what `backend/src/` already captures and what `frontend/src/components/observatory/*` already surfaces.

**Method:** Full read of `chat.rs`, `agent.rs`, `emergence.rs`, `coevolution.rs`, `anomaly.rs`, `research.rs`, `thinking_fragments.rs`, `blog.rs`, `simulation.rs`, `analytics.rs`, `dashboards.rs`, `observatory.rs`, `auditlog.rs`, `hallucination.rs`, `track.rs`, `github_activity.rs`, `digest.rs`/`digest/facts.rs`, plus the four target frontend components and the full observatory component directory listing.

## Classification legend

| Code | Meaning |
|---|---|
| **A — Captured & surfaced** | Exists in DB, already rendered in a dashboard component |
| **B — Captured, not surfaced** | Data exists in a table/field, no UI view reads it yet |
| **C — Derivable** | Computable from data already stored, needs new backend logic only (no new capture point) |
| **D — New server instrumentation** | New field/table, but logged from an event the backend already receives (existing endpoint, existing request) |
| **E — New client instrumentation** | Nothing the backend currently receives at all — needs new frontend event capture + new ingestion endpoint. Highest effort, most privacy-sensitive. |
| **F — Not honestly measurable** | Requires subjective judgment a log can't produce; forcing a number would be fabrication |

---

## Bucket 1 — Human (40%)

### Attention

| Metric | Class | Current source / gap | Effort |
|---|---|---|---|
| Time to first response (human reacting to AI output) | **C** | `chat_messages.created_at` timestamps exist for both roles. `observatory::human_ai` already computes the *reverse* direction (`mean_latency_seconds` = user→assistant gap). The assistant→next-user gap is the same computation run the other way. Caveat: second-granularity timestamps, no distinction between "reading" and "away from desk." | S |
| Time reading AI output | **E** | No scroll/dwell/visibility signal reaches the backend at all. | L |
| Scroll behavior | **E** | Nothing captured. | L |
| Idle time | **E** | Nothing captured; would need Page Visibility API + heartbeat. | M |
| Context/window switching | **E** | Nothing captured; needs `visibilitychange`/`blur`/`focus` listeners. | M |

### Decision Making

| Metric | Class | Current source / gap | Effort |
|---|---|---|---|
| Acceptance / modification / rejection rate | **D** | `delete_message_and_after` (chat.rs) already fires on every edit-and-resend, but it's a hard delete with no event log entry recording *why* — just gone. Add an explicit audit/event row at that existing call site classifying the action (edit vs. abandon). | S–M |
| Decision latency | **D** | Same event, pair with the timestamp of the AI reply being reacted to. Needs the above logging first. | S–M |
| Confidence before / confidence after | **E/F** | No self-report mechanism exists anywhere. A number here requires Laura to actively rate herself — this is a UI affordance decision, not a log-mining one. Needs a dedicated design pass with Laura before building anything. | L (design-gated) |

### Cognitive Load

| Metric | Class | Current source / gap | Effort |
|---|---|---|---|
| Typing pauses | **E** | Keystroke-level timing never reaches the backend. Most privacy-sensitive item in the whole framework. | L |
| Backspace frequency | **E** | Same — keystroke-level, not captured. | L |
| Rewrite/delete ratio (coarse, message-level) | **D** | Coarse proxy derivable once edit-and-resend events are logged (see Decision Making above) — message-level, not keystroke-level. | S–M |
| Edit distance | **D** | Currently impossible even in principle: `delete_message_and_after` hard-deletes the old row with no snapshot retained. Needs the delete path to snapshot old content (e.g. into `audit_log.meta` or a new `message_revisions` table) before it disappears, so a diff can be computed after the fact. | M |
| Undo frequency | **E** | App has no "undo" concept client-side; would need one built plus event capture. | M |

### Information Seeking

| Metric | Class | Current source / gap | Effort |
|---|---|---|---|
| Clarification questions | **C** | `chat_messages.content` (role='user') already stored in full. Run an LLM classifier over it (same pattern already proven by `thinking_fragments.rs`'s per-turn layer classifier) to flag clarification-seeking turns. | M |
| External searches | **F** | Outside the app's boundary entirely — the backend has no visibility into browser tabs outside itself. Not measurable without a browser extension, which is a different project. | — |
| Follow-up prompt count | **C** | Directly countable from existing `chat_messages` rows per conversation/topic window. | S |

### Learning

| Metric | Class | Current source / gap | Effort |
|---|---|---|---|
| Repeated mistakes | **C** | Would need semantic clustering of "correction" turns over time (embedding similarity, same machinery `chat.rs::embed`/`cosine` already provides for CCET). Real but non-trivial new logic. | M–L |
| Error correction speed | **D** | Needs a defined "error" anchor — cheapest is `hallucination_checks.verdict='mismatch'` or `agent_anomalies` rows — then measure time to the next human message that addresses it. | M |
| Prompt quality/complexity over time | **C** | Fully derivable from existing `chat_messages.content` — length, structure, lexical/syntactic complexity computed retroactively, trended over `created_at`. | S–M |
| Independence score | **F** | Not a single log-derivable number as stated — it's a composite the team would need to define a formula/weights for first (and even then it's a modeling choice, not a fact). Don't fabricate a scalar; decompose into named sub-metrics if wanted. | — |

### Trust

| Metric | Class | Current source / gap | Effort |
|---|---|---|---|
| Blind acceptance rate | **D** | Depends on the same accept/modify/reject event logging as Decision Making above — "blind" = accepted with zero follow-up/verification message. | M |
| Verification frequency | **C** | Could be approximated via LLM classification of user messages for verification-seeking language ("bist du sicher", "kannst du das belegen"), reusing the classifier pattern from `thinking_fragments.rs`. Approximate, not exact. | M |
| Override frequency | **D** | Same dependency as acceptance/rejection — an "override" is a reject+redo pattern, needs the edit-and-resend event logged with intent. | M |

### Persistence

| Metric | Class | Current source / gap | Effort |
|---|---|---|---|
| Attempts before abandonment | **C** | Derivable from existing message sequences: count of resend/retry-shaped events in a row before a conversation goes idle. | M |
| Retry frequency | **C** | Same underlying data, different aggregation. | S–M |
| Session continuation / task completion rate | **D** | The app currently has **no session or task boundary at all** — `chat_conversations` has `created_at`/`updated_at` only, no completion state. Needs a real definition of "session" and "task" plus a field to mark it, added at existing conversation endpoints. | M–L |

### Communication

| Metric | Class | Current source / gap | Effort |
|---|---|---|---|
| Prompt length/specificity | **C** | Directly computable from stored `chat_messages.content`. | S |
| Structured-prompt ratio | **C** | Detectable via formatting heuristics (lists, code fences, headers) over existing content. | S |
| Constraint density | **C** | Heuristic/NLP pass over existing content (counting explicit constraints/negations/specs) — more involved than the two above but still purely derivable. | M |

### Reflection

| Metric | Class | Current source / gap | Effort |
|---|---|---|---|
| Self-correction frequency | **C** | LLM-classify existing `chat_messages` for turns where a user corrects their own prior prompt — same classifier pattern as `thinking_fragments.rs`. | M |
| Revision cycles | **D** | Directly countable once edit-and-resend is logged as an explicit event (see Decision Making) instead of a silent hard delete. | S–M |
| Meta-comment frequency | **C** | Can piggyback on the existing `thinking_fragments.rs` classification infrastructure (already an 8-layer per-turn classifier) rather than building new. | M |

---

## Bucket 2 — Model (40%)

Model-side is the strongest-covered bucket by a wide margin — most of this is already flowing through `chat.rs`/`agent.rs`/`emergence.rs`/`anomaly.rs`/`hallucination.rs`.

| Metric | Class | Current source / gap | Effort |
|---|---|---|---|
| Token usage (prompt/completion) | **A** | `chat_messages.prompt_tokens`/`completion_tokens` → `observatory::human_ai` → `InteractionDynamics.tsx`/`TokenBreakdown`, `Analytics.tsx` | — |
| Reasoning time | **A** | `chat_messages.reasoning_ms` → same path as above | — |
| Per-token confidence/probability | **A** | `chat_messages.token_info` (logprobs) → `mean_token_confidence` → `InteractionDynamics.tsx` (`TokenBreakdown`) | — |
| Tool call log (name/args/result/status) | **B** | `agent_tool_calls` table fully populated (`tool_name`,`arguments`,`result`,`status`); aggregate counts surfaced (`tool_distribution`, `AgentActivity.tsx`) but **no view shows raw per-call arguments/results** — no detail/drill-down page exists. | S (view only) |
| Tool error rate | **A** | `agent_tool_calls.status != 'ok'` → `diagnostics.agent_tool_call_errors_7d`, `anomaly::distribution` → `AnomalyLog.tsx` | — |
| Iteration-cap hits (tool loop didn't resolve) | **A** | `agent_anomalies.kind = KIND_ITERATION_CAP` → `AnomalyLog.tsx` | — |
| Refusal-language heuristic | **A** | `agent_anomalies.kind = KIND_REFUSAL_TRIGGERED` (documented as a heuristic, not certified) → `AnomalyLog.tsx` | — |
| Self-consistency / hallucination check (match/mismatch/unverifiable) | **B** | `hallucination_checks` table fully populated; only the derived `hallucination_mismatch` badge and `AnomalyLog` kind are surfaced — **no dedicated hallucination_checks list/detail view** exists showing match/unverifiable verdicts too. | S–M |
| Which model candidate actually answered a turn | **D** | `CHAT_MODEL_CANDIDATES` ladder (chat.rs) is walked live per exchange but the winning candidate is **never persisted anywhere** — not on `chat_messages`, not elsewhere. Cheap add: one new column, set at the same point `finalize_turn` already writes token counts. | S |
| Response latency (model inference time) | **A (approx.)** | `observatory::human_ai.mean_latency_seconds` — paired by timestamp proximity (up to 100 pairs), not bound to a specific request/response pair. Approximate, not exact. | — |
| Model turn-to-turn self-consistency (CCET stability) | **A** | `ccet_turns.stable`/`similarity_to_prev` → CEI → `EmergenceMonitor.tsx`, `Flugschreiber.tsx` | — |
| AI-side emergence signals | **A** | `emergence_signals.level='ai'` → `EmergenceMonitor.tsx` | — |

---

## Bucket 3 — Human-AI Dyad / Emergence (20%)

This is the framework's own name for what the app already calls CEI/CEP/Resonance Frequency and the Emergence Monitor's human/ai/interaction/system taxonomy — read those first, as instructed. They are a genuine prior attempt at this bucket, explicitly self-disclosed in the code as **this project's own operationalization, not Laura's paper's literal formulas** (see `chat.rs` CCET module doc comment and `ccet_summary`'s `definitions_note` field, echoed in `EmergenceMonitor.tsx`'s "Eigene Operationalisierung" badge). That honesty framing should carry over to any new dyad metric built from this audit.

| Metric | Class | Current source / gap | Effort |
|---|---|---|---|
| Synchronization latency | **C** | Approximated today only in one direction (`mean_latency_seconds`, user→assistant). A true bidirectional sync-latency metric (both directions, properly request-bound rather than proximity-paired) is derivable from existing `chat_messages.created_at` with better join logic. | M |
| Mutual adaptation rate | **B** | Closest existing proxy is `ccet_turns.terms_reused` / `emergence_signals.verified_emergence`+`recurrence_count` — data exists but is framed as "stability"/"recurrence," not surfaced anywhere as "adaptation." Needs relabeling/a new view more than new capture, though see vocabulary note below. | S–M (view) |
| Clarification efficiency (misunderstanding → resolution time) | **D** | Needs an explicit "misunderstanding" anchor — cheapest option is chaining off `hallucination_checks.verdict='mismatch'` or `agent_anomalies` rows, then measuring time to the next message that resolves it. Builds on data the backend already receives per tool call. | M |
| Shared vocabulary growth | **C (narrow proxy exists)** | `ccet_turns.terms_reused` only checks reuse against a **hardcoded 8-term list** (`CCET_FRAMEWORK_TERMS` — "emergenz", "drift", "co-evolution", etc.), not organically discovered shared vocabulary. Generalizing to real growth (tracking an expanding shared-term set over time, not a fixed list) is new backend logic over existing embeddings/text, not new capture. | M–L |
| Initiative balance (who starts topics) | **C** | `chat_messages.role` already distinguishes human/assistant, but there's no topic-boundary concept at all. Needs topic segmentation logic (e.g. embedding-distance breaks, reusing `chat.rs::cosine`) layered on existing data before "who opened this topic" is answerable. | M–L |
| Repair success after errors | **C** | Derivable by linking `agent_anomalies`/`hallucination_checks` timestamps to a later verdict/turn that resolves cleanly — same existing tables, new join logic. | M |
| Co-created solution quality vs. either working alone | **F** | No counterfactual exists or can exist from logs alone — the tool never observes "human working alone" or "AI working alone" as a comparison condition. Any number here would be invented, not measured. Would need a deliberately designed comparison study, not instrumentation. | — |

---

## Counts by classification

| Class | Human | Model | Dyad | Total |
|---|---|---|---|---|
| A — Captured & surfaced | 0 | 10 | 0 | 10 |
| B — Captured, not surfaced | 0 | 2 | 1 | 3 |
| C — Derivable from existing data | 15 | 0 | 5 | 20 |
| D — New server instrumentation | 10 | 1 | 1 | 12 |
| E — New client instrumentation | 6 | 0 | 0 | 6 |
| F — Not honestly measurable | 2 (+1 partial) | 0 | 1 | 3–4 |

(33 human-bucket rows, 12 model-bucket rows, 7 dyad-bucket rows ≈ 52 total line items; a few rows carry a mixed classification, e.g. "confidence before/after" as E/F and "shared vocabulary growth" as C-with-an-existing-narrow-proxy.)

---

## Prioritized recommendation

### Wave 0 — cheap, build first (favor A→surfaced, B→surfaced, and pure-C derivations)
1. **Surface `agent_tool_calls` raw detail and `hallucination_checks` full verdict list.** Both tables are already fully populated; only aggregate counts are shown today. A drill-down view (tool call args/results; match/mismatch/unverifiable list, not just the mismatch badge) is UI work over data that already exists — no backend change needed.
2. **Communication metrics** (prompt length/specificity, structured-prompt ratio) and **prompt-complexity-over-time**: pure computation over `chat_messages.content` that's already stored in full. No new capture, no privacy question, immediate value for the Learning and Communication rows.
3. **Log which model candidate actually answered each turn.** One column, set at the exact point `finalize_turn` already writes token counts — cheapest server-side add in the whole audit, and closes an existing blind spot in the Model bucket (currently nobody can tell whether nemotron-49b or a fallback answered a given message).
4. **Reverse-direction latency** (assistant→next-user, i.e. "time to first response") — the data (`chat_messages.created_at` for both roles) is identical to what `mean_latency_seconds` already uses in the other direction; it's a query change, not new instrumentation.

### Wave 2 — right second wave (new server-side instrumentation, still built from events the backend already receives)
1. **Stop silently hard-deleting edited/rejected messages.** `delete_message_and_after` currently destroys the old content with zero trace. Snapshotting it before delete (even just into `audit_log.meta`) is the single highest-leverage fix in this audit — it unlocks accept/modify/reject rate, decision latency, revision cycles, edit distance, and rewrite/delete ratio all at once, none of which are possible even in principle today without it.
2. **Define a session/task boundary and completion state** for conversations — currently absent entirely. Needed for persistence metrics (session continuation, task completion rate) and would also make several Wave 3 dyad metrics (initiative balance, repair success) easier to scope.
3. **Chain hallucination/anomaly events to a resolution signal** for clarification-efficiency and repair-success tracking — builds directly on `hallucination_checks` and `agent_anomalies`, which already fire on every tool call.

### Wave 3 — expensive/sensitive tier, needs a dedicated design pass with Laura before building anything
**All client-side behavioral instrumentation** (typing pauses, backspace frequency, scroll behavior, idle time, window/context switching, and any self-report widget for confidence-before/after). None of this is technically hard in isolation, but:
- it's the only category in this whole audit that requires a **new data path from the browser to the server that doesn't exist today** (new event capture + new ingestion endpoint), as opposed to computing more from data already flowing in;
- it's the most privacy-sensitive category by a wide margin — keystroke-level and idle/attention tracking is a materially different consent surface than "the backend logs your chat messages," even though Laura has already consented to human-side behavioral tracking in general;
- self-report widgets (confidence before/after) are a UX design question, not an engineering one — where do they appear, how often, does asking distort the very behavior being measured.

Recommend scoping this wave as its own conversation with Laura about exactly which signals, exactly what granularity, and exactly how it's disclosed to her in the UI — not something to instrument opportunistically alongside the cheaper waves above.

### Flag, don't build
"Confidence before/after" without a defined UI mechanism, "independence score" as a single scalar, "external searches" (outside the app's boundary), and "co-created solution quality vs. either working alone" (no counterfactual condition exists to compare against) should not be forced into fake numbers. If wanted, each needs either a product decision (self-report UI) or a deliberately designed comparison study — not a log query.
