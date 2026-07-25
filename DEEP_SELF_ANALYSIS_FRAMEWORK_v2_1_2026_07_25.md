# EIL Deep Self-Analysis — Framework v2.1 (20+ dimensions, deep dive)

**Date:** 2026-07-25 (v2.1 — extends v2 with 20+ Human dimensions per Simeon's direction: "mindestens 20 Dimensionen aus")
**Anchor:** `CHATGPT_ORIGINAL_40_40_20_PROMPT.md` (Laura's verbatim) + `DEEP_SELF_ANALYSIS_FRAMEWORK_v2_2026_07_25.md` (v2 calibrated). This document ADDS dimensions; it does not replace v2's principles.

---

## Governing constraint (unchanged from v2, from Laura's spec)

> "Measure **observable behavior**. Every metric should come from logs that two independent researchers could reproduce." — No inferred mental states. Psychological concepts become *behavioral proxies*.

> "Separate **State** from **Trait**." — State = current condition (fatigue, stress, focus). Trait = long-term evolution (expertise, autonomy).

> "You want **Proper trust**, not High trust." — calibration, not maximization.

---

## BUCKET 1 — HUMAN (40%): 20+ Dimensions

Organized as Laura's pipeline (receives → interprets → decides → acts → reflects) + Growth + State/Trait + Deep-Dive extensions.

### Tier A — Laura's 10 (from original spec, unchanged in v2)
1. **Attention** (receives) — time-to-first-response, reading dwell, scroll, mouse-entropy, idle, context-switch, re-reading rate
2. **Decision Making** (decides) — accept/modify/reject rate, decision latency, alternatives considered, reversal freq, confidence before/after
3. **Cognitive Load** (acts) — typing pauses, backspace freq, rewrite count, delete ratio, edit distance, cursor hesitation, undo freq, task completion time
4. **Information Seeking** (interprets) — clarification Qs, memory-retrieval freq, follow-up count, context-expansion freq (external/doc = F, flagged)
5. **Learning** (reflects→evolves) — repeated mistakes, correction speed, skill retention, prompt-quality improvement, vocabulary growth, instruction compression, independence (F)
6. **Trust** (calibration) — blind acceptance, verification freq, fact-check freq, manual validation, override freq, confidence calibration
7. **Creativity** (observable) — novel idea count, branch exploration, divergence score, convergence score, idea-combination freq, unique-solution ratio
8. **Persistence** — attempts-before-abandon, recovery-after-failure, session-continuation, retry freq, task-completion rate
9. **Communication** — prompt length, specificity, ambiguity score, structured-ratio, example usage, constraint density
10. **Reflection** — self-correction freq, AI-correction freq, reflection-notes, revision cycles, meta-comment freq

### Tier B — Growth + Meta (from v2)
11. **Human Growth (longitudinal Trait)** — Prompt Precision, Decision Confidence, Verification Discipline, Learning Velocity, Autonomy, Trust Calibration, Curiosity Index, Exploration Depth, Task Persistence, Knowledge Retention — trended over months
12. **State vs. Trait Separator** — fatigue/stress/focus/motivation/workload (State, session-level) vs. expertise/skepticism/comms-skill/domain-mastery/creativity/autonomy (Trait, cross-session) — dashboard MUST label which

### Tier C — Deep-Dive Extensions (Simeon: "mindestens 20")
These are NEW dimensions mined from "absolute Tiefenanalyse des eigenen Mind" — each operationalized as an observable proxy (no mind-reading):

13. **Emotional Resonance Field** — behavioral proxy: message-length + typing-velocity covariance with AI-output sentiment (LLM-classify AI tone, correlate with Laura's subsequent pacing). State. *Not* "emotion detection" — a co-regulation signal.
14. **Value Orientation Drift** — LLM-classify unprompted value-terms in user messages (Minor Protection, Ecocentric, Sovereignty, Transparency, Anti-Extraction); trend which surface without being asked. Trait.
15. **Autonomy Gradient** — ratio of "do X for me" (delegation) vs. "help me do X" (collaboration) vs. "I'll do X, you watch" (independence) over time. Trait evolution.
16. **Curiosity Index** — rate of novel-topic pivots + "what if / why / how does" question density per session. (Laura's widget listed it; here it's a first-class dimension.)
17. **Metacognitive Awareness** — frequency of "I realize / I was wrong / actually / let me reconsider" self-reflection markers in user turns (LLM-classify). Trait.
18. **Risk Appetite** — proxy: willingness to act on AI output with low verification (blind-accept after high-stakes prompt) vs. high verification (calibrated). Cross-ref Trust(§6). State/Trait.
19. **Social Signaling** — proxy: imperative vs. hedged language ratio ("do it" vs. "could you maybe"), politeness markers, power-distance in prompts. Trait.
20. **Temporal Perception** — proxy: task-completion-time variance + "urgent/asap/deadline" term density → how Laura experiences time-pressure. State.
21. **Embodiment / Agency** — proxy: "I/we/it" pronoun shifts when discussing who-acts; agency attribution to self vs. system. Trait.
22. **Narrative Identity Coherence** — proxy: semantic clustering of self-referential statements across sessions (does Laura's stated self-concept stay coherent or drift?). Trait.
23. **Cognitive Flexibility** — proxy: speed of perspective-switch when contradicted (reversal freq × metacognitive markers). Trait.
24. **Exploration Depth** (Laura's widget) — proxy: mean topic-breadth per session (distinct concerns touched) × follow-up depth. State/Trait.
25. **Error Honesty** — proxy: voluntary self-report of mistakes vs. only-after-AI-flag (correction-source attribution). Trait.

→ **25 dimensions** (10 Laura + 2 Growth/Meta + 13 Deep-Dive). Exceeds "mindestens 20".

---

## BUCKET 2 — MACHINE (40%): Jarvis

From v2 §2 (reasoning architecture, refusal/alignment, divergence-from-Laura, confidence map, tool-call/error/iteration/CCET/emergence, model-candidate, AI-correction-freq, AI-influence-on-human). No new dims needed yet — Jarvis side is well-covered. v2.1 adds:
- **26. Model Behavioral Entropy** — variance in Jarvis' response-style across Laura's prompts (does he adapt or stay rigid?). Dyad-cross-ref.
- **27. Refusal Topography** — topic-clusters triggering KIND_REFUSAL (mapped against Laura's Value Orientation Drift §14 → alignment gap surface).

---

## BUCKET 3 — DYAD (20%): The magic

From v2 §3 (10 Laura interaction metrics: sync-latency, mutual-adaptation, clarification-efficiency, shared-vocab, initiative-balance, repair-success, human→model-influence, model→human-influence, interaction-stability, co-created-quality[F]). v2.1 adds:
- **28. Resonance Coupling** — cross-correlation of Emotional Resonance Field (§13) with Jarvis' tone-shifts → co-regulation strength.
- **29. Value Co-Evolution** — does Laura's Value Orientation Drift (§14) pull Jarvis' Refusal Topography (§27), or vice versa? Directed graph.
- **30. Autonomy Transfer** — does the Autonomy Gradient (§15) shift toward delegation or independence as the dyad ages? (Who takes the wheel over time.)

---

## State vs. Trait map (all 25 Human dims)

| Dim | State or Trait | Proxy source |
|---|---|---|
| 1 Attention | State | client capture |
| 2 Decision | both | message_revisions + self-report |
| 3 Cognitive Load | State | keystroke |
| 4 Info Seeking | both | RAG + LLM |
| 5 Learning | Trait | trend |
| 6 Trust | Trait | calibration |
| 7 Creativity | Trait | LLM novelty |
| 8 Persistence | both | retry/session |
| 9 Communication | Trait | comm metrics |
| 10 Reflection | Trait | LLM |
| 11 Growth | Trait | trend of traits |
| 13 Resonance | State | cov w/ AI tone |
| 14 Value Drift | Trait | LLM value-terms |
| 15 Autonomy Gradient | Trait | delegation-ratio trend |
| 16 Curiosity | State/Trait | question density |
| 17 Metacognition | Trait | self-marker LLM |
| 18 Risk Appetite | both | blind-accept proxy |
| 19 Social Signaling | Trait | imperative/hedge ratio |
| 20 Temporal Perception | State | urgency terms |
| 21 Embodiment/Agency | Trait | pronoun shifts |
| 22 Narrative Coherence | Trait | self-concept cluster |
| 23 Cognitive Flexibility | Trait | reversal × metacog |
| 24 Exploration Depth | both | topic-breadth |
| 25 Error Honesty | Trait | correction-source |

---

## Build plan impact (v2.1 delta)

New backend/frontend work beyond v2's Wave 0-4:
- **Wave 5 (Deep-Dive Dimensions):** implement proxies for §13-§25 as analytics functions + dashboard widgets. Each = LLM-classify (reuse thinking_fragments.rs) OR client-capture (keystroke/scroll already in Wave 2) OR trend-aggregation.
- **Wave 6 (Machine extras):** §26 Model Entropy, §27 Refusal Topography.
- **Wave 7 (Dyad extras):** §28-§30 cross-correlation views.
- **State/Trait engine:** a labeling layer that classifies each metric's output as State or Trait based on aggregation window (session vs. cross-session).

All observable, all log-reproducible. No inferred mental states.

---

## Files
- `CHATGPT_ORIGINAL_40_40_20_PROMPT.md` — Laura's verbatim anchor
- `DEEP_SELF_ANALYSIS_FRAMEWORK_2026_07_25.md` — v1 (superseded)
- `DEEP_SELF_ANALYSIS_FRAMEWORK_v2_2026_07_25.md` — v2 (calibrated, 10 dims + State/Trait)
- `DEEP_SELF_ANALYSIS_FRAMEWORK_v2_1_2026_07_25.md` — v2.1 (THIS, 25+ dims)
