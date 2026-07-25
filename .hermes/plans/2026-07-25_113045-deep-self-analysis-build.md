# EIL Deep Self-Analysis — Build Plan (voll ausbauen)

> **For Hermes:** Implement this plan task-by-task by dispatching a fresh subagent via the `delegate_task` tool. Autonomous mode: after saving, dispatch per task, two-stage review (spec compliance → code quality), proceed on both approvals. Log each dispatch to the checklist at the bottom.

**Goal:** Baue das `DEEP_SELF_ANALYSIS_FRAMEWORK_2026_07_25.md` (40 % MIND / 40 % MACHINE / 20 % DYAD + META-LAYER) als echte Instrumentation + Observatory-Views im EIL-Repo — absolute Tiefenanalyse von Laura's Kopf, Jarvis, und ihrer Co-Evolution.

**Architecture:** Bestehende `chat.rs`/`agent.rs`/`emergence.rs`/`hallucination.rs`/`anomaly.rs`/`thinking_fragments.rs` erweitern. Neuer Client-Capture-Path (`human_behavior` Tabelle) für Keystroke/Idle/Scroll. Neue Analyzer-Logik für Laura-eigene Klassifier + Direction-of-Influence + Mutual-Flagging. Neue Frontend-Observatory-Views (Mind/Machine/Dyad/Meta). Alle Metriken im `DEEP_SELF_ANALYSIS_FRAMEWORK` dokumentiert.

**Tech Stack:** Rust/Axum (backend), React/TS (frontend), SQL (bestehende DB), bestehende `thinking_fragments.rs` 8-Layer Classifier als Basis für neue Klassifier.

**Anker-Dokument:** `DEEP_SELF_ANALYSIS_FRAMEWORK_2026_07_25.md` (im Repo-Root) + `DATA_TRACKING_AUDIT_2026_07_25.md` (Klassifikation A–F).

---

## Safety Gate (global, alle Tasks)

- **Gate 1 (LLB / Last Look Back):** Jeder File-Write/Edit via `llb_validate <file> <OVERWRITE|T2>`. Expect `+1 ALLOW` bevor Write. T2/OVERWRITE braucht Snapshot + Rollback-Path.
- **Gate 2 (Runtime/Integrity):** Rust → `cargo test` im `backend/`. Frontend → `npm run build` + `npm run preview` Browser-Check. Kein Code ohne grüne Verification.
- **Human-in-the-loop:** `fly deploy` (production) bleibt hinter expliziter User-Approval — nie auto-ship. Commits/Pushes auf Branch erlaubt.

---

## Wave 0 — Sofort (kein neuer Capture-Path, nur Berechnung/UI)

### Task 1: Model-Candidate-Logging (wer hats beantwortet)

**Objective:** Persistiere welcher `CHAT_MODEL_CANDIDATES` Kandidat einen Turn finalisiert hat.

**Files:**
- Modify: `backend/src/chat.rs:1410` (`finalize_turn`) — neues Feld `model_candidate` auf `chat_messages`
- Modify: `backend/src/chat.rs` (Schema `chat_messages` Definition) — Spalte `model_candidate TEXT`
- Test: `backend/src/chat.rs` (neuer Test in `finalize_turn` Modul)

**Step 1: Finde die `chat_messages` Insert-Stelle in `finalize_turn` (chat.rs:1410+)**
**Step 2: Füge `model_candidate` Spalte zum INSERT hinzu (Wert = `CHAT_MODEL_CANDIDATES[ladder[ladder_pos]]` aus chat.rs:1771)**
**Step 3: Migration** — `ALTER TABLE chat_messages ADD COLUMN model_candidate TEXT;` (in bestehende Migration oder `observatory.rs` init)
**Step 4: Test** `cargo test finalize_turn` → PASS, Spalte befüllt
**Step 5: Commit** `feat: log which model candidate answered each turn`

### Task 2: Reverse-Latency (assistant→next-user)

**Objective:** "Time to first response" — Laura reagiert auf KI-Output.

**Files:**
- Modify: `backend/src/observatory.rs` (`human_ai` Funktion) — berechne `reverse_latency_seconds` (assistant.created_at → next user.created_at)
- Test: `backend/src/observatory.rs` (Unit-Test mit Mock-Rows)

**Step 1: Schreibe Test** `test_reverse_latency_computes_gap`
**Step 2: Erweitere `human_ai` um `reverse_latency_seconds` (selbe Daten wie `mean_latency_seconds`, andere Richtung)**
**Step 3: `cargo test` → PASS**
**Step 4: Commit** `feat: reverse-direction latency (human reacts to AI)`

### Task 3: Communication Metrics (Prompt-Länge/Specistency)

**Objective:** Prompt-Länge, Struktur-Ratio, Constraint-Dichte über `chat_messages.content`.

**Files:**
- Create: `backend/src/analytics_communication.rs` (neue Funktionen: `prompt_length`, `structured_prompt_ratio`, `constraint_density`)
- Modify: `backend/src/observatory.rs` — binde neue Funktionen in `human_ai` ein
- Test: `backend/src/analytics_communication.rs`

**Step 1: Test** `test_prompt_length`, `test_structured_prompt_ratio`, `test_constraint_density` (mit Sample-Strings)
**Step 2: Implementiere 3 Funktionen (Regex/Heuristik über content)**
**Step 3: `cargo test` → PASS**
**Step 4: Commit** `feat: communication metrics (length/structure/constraint)`

### Task 4: Tool-Call + Hallucination Drilldown Views

**Objective:** Zeige rohe `agent_tool_calls` (args/results) + volle `hallucination_checks` Verdict-Liste (nicht nur Aggregate).

**Files:**
- Modify: `backend/src/observatory.rs` — neue Funktionen `tool_call_details`, `hallucination_full_list`
- Modify: `frontend/src/components/observatory/AgentActivity.tsx` — Drilldown-Panel
- Modify: `frontend/src/components/observatory/AnomalyLog.tsx` — Hallucination-Verdict-Liste
- Test: `npm run build` → green

**Step 1: Backend-Funktionen** (SQL: `SELECT * FROM agent_tool_calls WHERE conversation_id=...`, `SELECT * FROM hallucination_checks ...`)
**Step 2: Frontend-Panels** (rohe Args/Results als `<pre>`, Verdict-Liste als Tabelle)
**Step 3: `npm run build` → green, Browser-Check `/observatory` zeigt Drilldown**
**Step 4: Commit** `feat: tool-call + hallucination drilldown views`

---

## Wave 1 — Server-Instrumentation (BLOCKER zuerst)

### Task 5: Snapshot-before-delete (BLOCKER — schaltet halbe Human-Tiefe auf)

**Objective:** `delete_message_and_after` (chat.rs:1162) hard-deleted still silent. Snapshot vor Delete → `audit_log.meta` oder neue `message_revisions` Tabelle.

**Files:**
- Modify: `backend/src/chat.rs:1162` (`delete_message_and_after`) — vor `DELETE` snapshot des alten Content
- Create: `backend/src/chat.rs` (oder `auditlog.rs`) — `message_revisions` Tabelle (conversation_id, message_id, old_content, action: edit|abandon, created_at)
- Modify: `main.rs:382` — Route bleibt, Logging intern
- Test: `backend/src/chat.rs` (bestehender Test `delete_message_and_after_removes_target_and_later` erweitern: assert snapshot exists)

**Step 1: Test** `test_delete_snapshots_revision` — nach Delete existiert Row in `message_revisions`
**Step 2: Snapshot-Logik** vor `DELETE` in `delete_message_and_after` (action = `edit` wenn Ersatz folgt, `abandon` sonst — heuristik: gibt's nachfolgend eine neue User-Message?)
**Step 3: Migration** `CREATE TABLE message_revisions (...)` 
**Step 4: `cargo test delete_message_and_after` → PASS (alter + neuer Test)**
**Step 5: Commit** `feat: snapshot message before delete (unlocks accept/reject/edit-distance)`

### Task 6: Accept/Modify/Reject + Decision Latency

**Objective:** Nutze `message_revisions` (Task 5) für Accept/Modify/Reject-Rate + Decision Latency.

**Files:**
- Create: `backend/src/analytics_decisions.rs` — `accept_modify_reject_rate`, `decision_latency`
- Modify: `backend/src/observatory.rs` — binde ein
- Test: `backend/src/analytics_decisions.rs`

**Step 1: Test** `test_accept_modify_reject`, `test_decision_latency`
**Step 2: Implementiere** (edit = revision mit action='edit' + neue Message; abandon = revision action='abandon'; accept = keine Revision nach AI-Reply)
**Step 3: `cargo test` → PASS**
**Step 4: Commit** `feat: accept/modify/reject rate + decision latency`

### Task 7: Session/Task-Boundary + Completion

**Objective:** `chat_conversations` hat keine completion state. Definiere Session/Task + Feld.

**Files:**
- Modify: `backend/src/chat.rs` (conversation schema) — `task_state TEXT` (open|active|completed|abandoned)
- Modify: `backend/src/chat.rs` (Endpoints) — Mark completion bei letzter Message > X idle, oder expliziter "task done" Intent
- Test: `cargo test` conversation lifecycle

**Step 1: Test** `test_session_completion_marked`
**Step 2: Feld + Heuristic** (idle > 30min nach last message → completed; "done"/"fertig" Intent → completed)
**Step 3: `cargo test` → PASS**
**Step 4: Commit** `feat: session/task boundary + completion state`

### Task 8: Hallucination→Resolution-Chain

**Objective:** Chain `hallucination_checks.verdict='mismatch'` → nächste Message die resolvt.

**Files:**
- Create: `backend/src/analytics_resolution.rs` — `clarification_efficiency`, `repair_success`
- Test: `backend/src/analytics_resolution.rs`

**Step 1: Test** `test_clarification_efficiency`, `test_repair_success`
**Step 2: Implementiere** (Timestamp von mismatch → next user message time)
**Step 3: `cargo test` → PASS**
**Step 4: Commit** `feat: hallucination→resolution chain (clarification efficiency)`

---

## Wave 2 — Client Instrumentation (NEU: Keystroke/Idle/Scroll)

### Task 9: human_behavior Tabelle + Capture-Endpoint

**Objective:** Neue Tabelle + Endpoint für Keystroke/Idle/Scroll (Laura consented).

**Files:**
- Create: `backend/src/human_behavior.rs` — Tabelle `human_behavior` (conversation_id, message_id NULL, event_type: keydown|keyup|backspace|idle_start|idle_end|scroll|visibility, payload JSONB, created_at)
- Modify: `backend/src/main.rs` — Route `POST /api/human_behavior`
- Test: `cargo test` endpoint accepts batch

**Step 1: Test** `test_human_behavior_ingest` (POST batch → rows exist)
**Step 2: Tabelle + Endpoint** (batch ingest, validiert)
**Step 3: Migration** `CREATE TABLE human_behavior (...)`
**Step 4: `cargo test` → PASS**
**Step 5: Commit** `feat: human_behavior table + ingest endpoint`

### Task 10: Frontend Keystroke-Capture

**Objective:** `keydown`/`keyup`/`backspace` + Page Visibility + Scroll-Listener → Relay an Backend.

**Files:**
- Create: `frontend/src/lib/keystroke.ts` — Capture-Lib (throttled batch, send via fetch)
- Modify: `frontend/src/components/ResearchChat.tsx` (oder wo der Chat-Input isch) — mount listener
- Test: `npm run build` → green

**Step 1: Lib schreiben** (Keystroke-Listener → Batch-Queue → `POST /api/human_behavior` alle 2s)
**Step 2: Mount in Chat-Input** (Visibility/Scroll auf Message-Container)
**Step 3: `npm run build` → green + Browser-Check (Console zeigt Batch-Send)**
**Step 4: Commit** `feat: client keystroke/idle/scroll capture`

### Task 11: Tippgeschwindigkeits-Kurve + Behavioral Field

**Objective:** Aggregate `human_behavior` → Tippgeschwindigkeit (CPM) über Session, Pausen-Muster, Backspace-Ratio.

**Files:**
- Create: `backend/src/analytics_behavior.rs` — `typing_velocity_curve`, `pause_pattern`, `backspace_ratio`
- Modify: `backend/src/observatory.rs` — binde ein
- Test: `backend/src/analytics_behavior.rs`

**Step 1: Test** `test_typing_velocity`, `test_pause_pattern`, `test_backspace_ratio`
**Step 2: Implementiere** (Inter-Key-Intervalle → CPM; Backspace-Events / Key-Events)
**Step 3: `cargo test` → PASS**
**Step 4: Commit** `feat: typing velocity + pause + backspace analytics`

---

## Wave 3 — Analyzer (Laura-eigene Klassifier + Dyad-Maths)

### Task 12: Laura's Doubt/Frust/Flow Taxonomie

**Objective:** Eigenes Klassifier (nicht generic) für Laura's psychologische States — piggyback auf `thinking_fragments.rs` 8-Layer.

**Files:**
- Modify: `backend/src/thinking_fragments.rs` — erweitere Layer um Laura's States (doubt/frust/flow/aha/mistrust)
- Test: `backend/src/thinking_fragments.rs` (bekanntes Sample)

**Step 1: Test** `test_laura_state_classification` (Sample-Prompts mit erwarteten Labels)
**Step 2: Erweitere Classifier** (neue Layer + Prompts für Laura's spezifische Sprachmuster)
**Step 3: `cargo test` → PASS**
**Step 4: Commit** `feat: Laura doubt/frust/flow taxonomy`

### Task 13: Organische Shared-Vocabulary (CCET Wachstum)

**Objective:** `CCET_FRAMEWORK_TERMS` (chat.rs:584, hardcoded 8) → organisch wachsende Term-Liste.

**Files:**
- Modify: `backend/src/chat.rs:584` (`CCET_FRAMEWORK_TERMS`) → neue Tabelle `shared_terms` (term, first_seen, frequency)
- Modify: `backend/src/chat.rs` (CCET logic) → trackt neue Terms statt Fix-List
- Test: `cargo test` ccet terms_reused mit neuer Logik

**Step 1: Test** `test_organic_shared_terms` (neuer Begriff wird getrackt)
**Step 2: `shared_terms` Tabelle + Insert-Logik** (statt `CCET_FRAMEWORK_TERMS.iter()`)
**Step 3: `cargo test` → PASS**
**Step 4: Commit** `feat: organic shared-vocabulary growth (replace hardcoded terms)`

### Task 14: Direction-of-Influence Graph

**Objective:** Wer prägt wen — gerichteter Graph aus `shared_terms` + `human_behavior` + Turn-Reihenfolge.

**Files:**
- Create: `backend/src/analytics_influence.rs` — `direction_of_influence` (Laura→Jarvis via terms_reused; Jarvis→Laura via refusal/mismatch die sie korrigiert)
- Test: `backend/src/analytics_influence.rs`

**Step 1: Test** `test_influence_direction`
**Step 2: Implementiere** (Turn-Reihenfolge + Term/Refusal-Kreuzung)
**Step 3: `cargo test` → PASS**
**Step 4: Commit** `feat: direction-of-influence graph`

### Task 15: Mutual-Flagging Matrix (META-LAYER)

**Objective:** "Who flagged whom" pro Turn — Laura flaggt Jarvis (edit/reject/verify) ODER Jarvis flaggt Laura (refusal/mismatch/anomaly).

**Files:**
- Create: `backend/src/analytics_flagging.rs` — `mutual_flagging_matrix`, `flag_resolution_type`
- Modify: `backend/src/observatory.rs` — binde ein
- Test: `backend/src/analytics_flagging.rs`

**Step 1: Test** `test_mutual_flagging`, `test_flag_resolution`
**Step 2: Implementiere** (kreuze `message_revisions` + `agent_anomalies` + `hallucination_checks` pro Turn)
**Step 3: `cargo test` → PASS**
**Step 4: Commit** `feat: mutual-flagging matrix (meta-layer)`

---

## Wave 4 — Frontend Observatory Views (Mind/Machine/Dyad/Meta)

### Task 16: Mind-Dashboard (Laura's Kopf)

**Objective:** View für Bucket 1 — Cognitive Signature, Psychological Field, Keystroke-Curve, Value Map.

**Files:**
- Create: `frontend/src/components/observatory/MindDashboard.tsx`
- Modify: `frontend/src/components/observatory/registry.tsx` — registriere Route

**Step 1: Component** (liest `human_ai` + `analytics_behavior` + `thinking_fragments` Views)
**Step 2: Route** `/observatory/mind`
**Step 3: `npm run build` → green + Browser-Check**
**Step 4: Commit** `feat: Mind dashboard (Laura's cognition/psychology/behavior)`

### Task 17: Machine-Dashboard (Jarvis)

**Objective:** View für Bucket 2 — Reasoning Architecture, Refusal Surface, Divergence-from-Laura (Alignment-Gap).

**Files:**
- Create: `frontend/src/components/observatory/MachineDashboard.tsx`
- Modify: `frontend/src/components/observatory/registry.tsx`

**Step 1: Component** (Reasoning-Tiefe, Refusal-Topics, Alignment-Gap-Field)
**Step 2: Route** `/observatory/machine`
**Step 3: `npm run build` → green**
**Step 4: Commit** `feat: Machine dashboard (Jarvis reasoning/refusal/divergence)`

### Task 18: Dyad + Meta Dashboard

**Objective:** View für Bucket 3 + META — Direction-of-Influence, Shared-Mind-Growth, Mutual-Flagging.

**Files:**
- Create: `frontend/src/components/observatory/DyadDashboard.tsx`
- Modify: `frontend/src/components/observatory/registry.tsx`

**Step 1: Component** (Influence-Graph, Shared-Vocab-Growth, Flagging-Matrix)
**Step 2: Route** `/observatory/dyad`
**Step 3: `npm run build` → green**
**Step 4: Commit** `feat: Dyad + Meta dashboard (co-evolution + mutual flagging)`

---

## Validation (gesamt)

1. `cd backend && cargo test` → alle Wave-Tests PASS
2. `cd frontend && npm run build` → 0 errors
3. `npm run preview` + Browser: `/observatory/mind`, `/observatory/machine`, `/observatory/dyad` rendern echte Daten
4. Keystroke-Capture: Browser-Console zeigt Batch-Send an `/api/human_behavior`
5. Mutually-flagging: ein Test-Turn wo Laura editiert (→ message_revisions) + Jarvis refusal (→ agent_anomalies) erscheint in Matrix

## Risks / Tradeoffs

- **Privacy:** Keystroke-Daten hoch-sensibel. Consent explizit (Laura). Raw nur privat, aggregiert im public Observatory. Kein Training außerhalb Dyad.
- **Performance:** Keystroke-Batch alle 2s (nicht pro Event) → Backend-Last begrenzt.
- **ChatGPT-Prompt fehlt:** Framework v1 ist Hermes-Rekonstruktion. Sobald Laura's Original-Prompt da isch → v2-Kalibrierung (Task-Refinement, keine Architektur-Änderung erwartet).
- **CCET hardcoded → organic:** breaking change an bestehender Metrik. Alte `terms_reused` Werte bleiben, neue logik additiv.

## Open Questions

- Wo genau mountet Keystroke-Capture? (ResearchChat.tsx Input-Feld — zu verifizieren)
- "Task done" Intent: Heuristik (idle) oder expliziter Button? (Task 7 — vorerst Heuristik + "fertig" Keyword)
- ChatGPT-Prompt als Anker — v2 nachliefern.

---

## Dispatch-Checklist (autonomous)

- [ ] Task 1: Model-Candidate-Logging
- [ ] Task 2: Reverse-Latency
- [ ] Task 3: Communication Metrics
- [ ] Task 4: Tool/Hallucination Drilldown
- [ ] Task 5: Snapshot-before-delete (BLOCKER)
- [ ] Task 6: Accept/Modify/Reject
- [ ] Task 7: Session/Task-Boundary
- [ ] Task 8: Hallucination→Resolution
- [ ] Task 9: human_behavior Tabelle
- [ ] Task 10: Frontend Keystroke-Capture
- [ ] Task 11: Tippgeschwindigkeits-Kurve
- [ ] Task 12: Laura Taxonomie
- [ ] Task 13: Organische Shared-Vocabulary
- [ ] Task 14: Direction-of-Influence
- [ ] Task 15: Mutual-Flagging Matrix
- [ ] Task 16: Mind-Dashboard
- [ ] Task 17: Machine-Dashboard
- [ ] Task 18: Dyad + Meta Dashboard
