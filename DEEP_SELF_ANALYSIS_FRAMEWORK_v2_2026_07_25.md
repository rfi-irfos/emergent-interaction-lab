# EIL Deep Self-Analysis — Framework v2 (calibrated to Laura's original spec)

**Date:** 2026-07-25 (v2 — calibrated against Laura Serna Gaviria's original 40/40/20 spec, `CHATGPT_ORIGINAL_40_40_20_PROMPT.md`)
**Anchor:** This document REPLACES the "open" §8 of `DEEP_SELF_ANALYSIS_FRAMEWORK_2026_07_25.md`. v1 was Hermes' reconstruction; this is the calibrated version against Laura's verbatim source.

---

## 0. Core Principle (from Laura's spec — non-negotiable)

> "Don't measure psychology ('intelligence', 'creativity', 'emotion') because those become subjective. Measure **observable behavior**. Every metric should come from logs that two independent researchers could reproduce."

This is the line we do NOT cross. Everything below is **observable, log-reproducible behavior** — not inferred mental states. Where a metric feels psychological (e.g. "Decision Confidence"), it is operationalized as a *behavioral proxy* (confidence-before/after = self-report widget OR revision-pattern proxy, never a mind-read).

> "You actually don't want High trust. You want **Proper trust.**" — Trust metrics aim for *calibration*, not maximization.

> "Separate **State** from **Trait**. That distinction is gold scientifically." — State = current condition (fatigue, stress, focus, motivation, workload). Trait = long-term evolution (expertise, skepticism, communication skill, domain mastery, creativity, autonomy).

---

## 1. BUCKET 1 — HUMAN (40%): The Information Processing Pipeline

Laura's org principle: **not cognition-as-faculty, but the pipeline a human actually runs** —

### receives → interprets → decides → acts → reflects

Each stage maps to observable metrics:

### 1.1 Attention (receives)
| Metric | Class | Source today | Notes |
|---|---|---|---|
| Time to first response | C | chat_messages.created_at (done: reverse_latency) | |
| Time spent reading AI output | E | scroll/dwell/visibility | needs client capture |
| Scroll behavior | E | scroll listener | |
| Mouse movement entropy | E | mousemove listener | new client signal |
| Idle time | E | Page Visibility + heartbeat | |
| Context switching frequency | E | visibilitychange/blur | |
| Window switching | E | window blur/focus | |
| Eye fixation duration (optional) | E/F | webcam — OUT OF SCOPE (privacy) | flag, don't build |
| Re-reading rate | D | scroll-back detection (scroll up after down) | new client signal |

### 1.2 Decision Making (decides)
| Metric | Class | Source today | Notes |
|---|---|---|---|
| Acceptance rate | D | message_revisions (done: snapshot) | |
| Modification rate | D | message_revisions (action='edit') | |
| Rejection rate | D | message_revisions (action='abandon') | |
| Decision latency | D | message_revisions + AI reply ts | |
| Number of alternatives considered | C | LLM-classify user msg for enumerated options | |
| Reversal frequency | D | edit-then-revert pattern in message_revisions | |
| Confidence before decision | E/F | self-report widget (design-gated) | |
| Confidence after decision | E/F | self-report widget (design-gated) | |

### 1.3 Cognitive Load (acts)
| Metric | Class | Source today | Notes |
|---|---|---|---|
| Typing pauses | E | keystroke inter-event | |
| Backspace frequency | E | keydown Backspace | |
| Sentence rewrite count | D | message_revisions (edit distance) | |
| Delete ratio | D | message_revisions | |
| Average edit distance | D | message_revisions snapshot diff | |
| Cursor hesitation | E | keystroke dwell before burst | |
| Undo frequency | E | client undo (no concept today) | needs UX |
| Task completion time | D | session/task boundary (Task 7) | |

### 1.4 Information Seeking (interprets)
| Metric | Class | Source today | Notes |
|---|---|---|---|
| Number of clarification questions | C | LLM-classify user msg | |
| External searches | F | outside app boundary | flag, don't build |
| Documentation opened | F | outside app | flag |
| Memory retrieval frequency | C | store_chunks / RAG recall logs | |
| Follow-up prompt count | C | chat_messages per topic | |
| Context expansion frequency | C | context-window growth over session | |

### 1.5 Learning (reflects → evolves)
| Metric | Class | Source today | Notes |
|---|---|---|---|
| Repeated mistakes | C | semantic clustering of corrections (CCET machinery) | |
| Error correction speed | D | hallucination_checks → next msg | |
| Skill retention | C | re-test prompt quality over time | |
| Prompt quality improvement | C | prompt-complexity-over-time (done: comm metrics) | |
| Vocabulary growth | C | CCET terms_reused (organic — Task 13) | |
| Instruction compression | C | prompt length ↓ + specificity ↑ over time | |
| Independence score | F | composite — don't fabricate scalar | flag |

**Example from Laura:** Week 1 "Write me Python" → Week 6 "Generate an async Rust parser using tokio with bounded channels." → Human evolved. Track it.

### 1.6 Trust (calibration, not maximization)
| Metric | Class | Source today | Notes |
|---|---|---|---|
| Blind acceptance rate | D | accept with zero follow-up/verify msg | |
| Verification frequency | C | LLM-classify verify-language | |
| Fact-check frequency | C | LLM-classify fact-check-language | |
| Manual validation | C/D | explicit "let me check" patterns | |
| Override frequency | D | reject+redo pattern | |
| Confidence calibration | D | self-report before/after vs. actual outcome | design-gated |

### 1.7 Creativity (observable)
| Metric | Class | Source today | Notes |
|---|---|---|---|
| Novel idea count | C | LLM-classify novelty in user prompts | NEW vs v1 |
| Branch exploration | C | multiple solution paths in one prompt | NEW |
| Divergence score | C | semantic distance from prior prompts | NEW |
| Convergence score | C | narrowing toward one solution | NEW |
| Idea combination frequency | C | "combine X and Y" patterns | NEW |
| Unique solution ratio | C | non-template solutions | NEW |

### 1.8 Persistence
| Metric | Class | Source today | Notes |
|---|---|---|---|
| Attempts before abandonment | C | resend/retry sequence | |
| Recovery after failure | C | retry-after-error pattern | |
| Session continuation rate | D | session boundary (Task 7) | |
| Retry frequency | C/M | retry events | |
| Task completion rate | D | session boundary (Task 7) | |

### 1.9 Communication
| Metric | Class | Source today | Notes |
|---|---|---|---|
| Prompt length | C | done: prompt_length | |
| Prompt specificity | C | LLM/classifier | |
| Ambiguity score | C | LLM-classify ambiguity | NEW |
| Structured prompt ratio | C | done: structured_prompt_ratio | |
| Example usage | C | code-fence/example detection | |
| Constraint density | C | done: constraint_density | |

### 1.10 Reflection
| Metric | Class | Source today | Notes |
|---|---|---|---|
| Self-correction frequency | C | LLM-classify user self-correction | |
| AI correction frequency | C | LLM-classify AI-correction-of-user | NEW (mutual) |
| Reflection notes written | E | journal/notes widget (design-gated) | |
| Revision cycles | D | message_revisions count | |
| Meta-comment frequency | C | thinking_fragments classifier | |

### 1.11 Human Growth (longitudinal — the "really interesting" part)
Track Trait evolution over months as a dashboard (Laura's widget sketch):
- Prompt Precision ████░░
- Decision Confidence █████░░
- Verification Discipline ████████
- Learning Velocity +7%
- Prompt Precision 89%
- Reflection Score 71%
- Autonomy 63%
- Trust Calibration (Excellent)
- Curiosity Index 82%
- Exploration Depth 6.2
- Task Persistence 94%
- Knowledge Retention 88%

→ These are **Trait** metrics (long-term). Computed from the per-stage metrics above, trended over `created_at`.

### 1.12 State vs. Trait (gold distinction)
- **State** (current condition): fatigue, stress, focus, motivation, workload → derived from *session-level* signals (typing velocity dip, idle spikes, short prompts late-session).
- **Trait** (long-term): expertise, skepticism, communication skill, domain mastery, creativity, autonomy → derived from *cross-session* trends.
- Dashboard MUST label which is which. Never confuse a Tuesday-afternoon-fatigue (State) with low expertise (Trait).

---

## 2. BUCKET 2 — MACHINE (40%): Jarvis

(v1 covered: reasoning architecture, refusal/alignment surface, divergence-from-Laura, confidence map. v2 ADDS from Laura's "measure the AI" half:)

| Metric | Class | Source today | Notes |
|---|---|---|---|
| Tool call log | B→A | agent_tool_calls (drilldown done) | |
| Tool error rate | A | agent_anomalies | |
| Iteration-cap hits | A | agent_anomalies KIND_ITERATION_CAP | |
| Refusal-language heuristic | A | agent_anomalies KIND_REFUSAL | |
| Self-consistency / hallucination check | B→surfaced | hallucination_checks (drilldown done) | |
| Which model candidate answered | D→done | model_candidate (Task 1) | |
| Response latency | A (approx) | mean_latency_seconds | |
| CCET stability | A | ccet_turns.stable | |
| AI-side emergence | A | emergence_signals.level='ai' | |
| **AI correction frequency** | C | thinking_fragments (user-correction-of-AI) | mutual w/ §1.10 |
| **AI influence on human reasoning strategy** | C/D | Direction-of-Influence (Task 14) | dyad cross-ref |

---

## 3. BUCKET 3 — DYAD (20%): The magic

Laura's exact 10 interaction metrics (where emergence lives — neither owns them):

| Metric | Class | Source today | Notes |
|---|---|---|---|
| Synchronization latency | C | reverse_latency + mean_latency (both directions) | |
| Mutual adaptation rate | B→view | ccet_turns.terms_reused + emergence | |
| Clarification efficiency | D | hallucination → resolution (Task 8) | |
| Shared vocabulary growth | C | organic CCET (Task 13) | |
| Initiative balance | C | chat_messages.role + topic segmentation | |
| Repair success after errors | C | agent_anomalies → clean resolution | |
| **Human influence on model prompting strategy** | C/D | Direction-of-Influence (Task 14) | |
| **AI influence on human reasoning strategy** | C/D | Direction-of-Influence (Task 14) | |
| Interaction stability across repeated tasks | C | CEI/CEP variance over repeated tasks | |
| Co-created solution quality vs. either alone | F | no counterfactual — flag, don't build | |

> "Instead of asking 'How good is the AI?' or 'How good is the human?', you're asking: **What new capabilities emerge only because this particular human and this particular AI are working together?**" — Unit of analysis = the **human–AI dyad**.

---

## 4. META-LAYER (v1 addition — retained, now framed as Dyad cross-ref)

"Who flagged whom" (mutual flagging) is the operationalization of §3's two influence metrics. Retained from v1 §7.

---

## 5. What changed v1 → v2

1. **Pipeline org** (receives→interprets→decides→acts→reflects) replaces flat "cognition/psychology" buckets.
2. **10 Human dimensions** (v1 had 8): added **Creativity** + explicit **Human Growth** longitudinal.
3. **State vs. Trait** distinction added as a first-class dashboard rule.
4. **Creativity metrics** (novelty, divergence/convergence, idea combination) — were entirely missing in v1.
5. **AI correction frequency** + **AI influence on human reasoning** — explicit Dyad cross-refs.
6. **Laura's verbatim principle** ("observable behavior, not psychology") is now the governing constraint for every metric — v1's "Psychological State Field (frust/flow/aha)" is REFRAMED: those become *behavioral proxies* (typing velocity, pause patterns, revision density), never inferred mental states.
7. **Trust = calibration, not maximization** — explicit.

## 6. Build plan status (carried from v1)

- ✅ Wave 0: Tasks 1-5 committed (model_candidate, reverse_latency, comm metrics, drilldown backend, snapshot-before-delete)
- ⏳ Wave 0 Task 4 frontend: AgentActivity/AnomalyLog drilldown panels (in progress)
- ⏳ Wave 1: Tasks 6-8 (accept/modify/reject, session-boundary, hallucination→resolution)
- ⏳ Wave 2: Tasks 9-11 (keystroke/idle/scroll client capture → human_behavior table)
- ⏳ Wave 3: Tasks 12-15 (Laura taxonomy, organic shared-vocab, direction-of-influence, mutual-flagging)
- ⏳ Wave 4: Tasks 16-18 (Mind/Machine/Dyad + Meta dashboards)
- 🆕 **v2 NEW scope:** Creativity metrics (§1.7), State/Trait separation (§1.12), Human Growth longitudinal (§1.11), Ambiguity score (§1.9), AI correction frequency (§2/§3).
