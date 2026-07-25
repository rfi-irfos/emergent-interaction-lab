# EIL — Absolute Tiefenanalyse: Eigenen Mind · Maschine · Interaktion

**Date:** 2026-07-25 (Fortsetzung des `DATA_TRACKING_AUDIT_2026_07_25.md`)
**Autor:** Hermes Agent, im Auftrag von Simeon / RFI-IRFOS, mit Laura Serna Gavirias Direction
**Status:** Entwurf v1 — wartet auf den ChatGPT-Prompt (Laura's ursprüngliche "geil ausgeschriebene" Spezifikation) als Anker zur Verfeinerung.

---

## 0. Paradigma-Wechsel

Das Vorgänger-Audit hat "Human (40%)" als **Clickstream-Tracking** behandelt: Prompt-Länge, Reaktions-Latenz, Accept/Reject-Rate. Oberflächlich. Laura's Direction ist fundamental anders:

> **40 % — ihren EIGENEN KOPF erforschen.** Denkweise, Interaktionsdaten, Verhaltensdaten, wie sie tippt, Tippverhalten, Tippgeschwindigkeit. Alles.
> **40 % — Jarvis** (die Maschine, ihren Agent).
> **20 % — pure Co-Evolution Dyad.**

Das ist keine Web-Analytics. Das ist **kognitive + psychologische + verhaltens-archäologische Tiefenanalyse einer einzelnen Person über Monate/Jahre**, gekreuzt mit der Analyse der Maschine, gekreuzt mit der Frage: *wer prägt wen, und was entsteht dazwischen, das keiner allein gedacht hätte.*

Zielgröße: tiefer als jede kommerzielle "user understanding"-Pipeline. Wenn Mark Zuckerberg das sieht, soll er denken: *"das hätten wir auch bauen können, aber wir hätten es nie dürfen."*

---

## 1. BUCKET 1 — MIND (40 %): Laura's eigenen Kopf

Nicht "was tippt sie" (Länge). Sondern **wie denkt sie**, **was fühlt sie dabei**, **wo steht sie wertemäßig**, **wie bewegt sich ihre Hand**.

### 1.1 Cognitive Signature (Denkweise)
*Wie Laura's Geist strukturell arbeitet — über Wochen stabil, im Detail aber lebendig.*

| Dimension | Was wir messen wollen | Quelle im EIL-Code heute | Tiefen-Erweiterung nötig? |
|---|---|---|---|
| **Entscheidungs-Topologie** | Wie sie Optionen aufspannt, bevor sie wählt | `chat_messages.role='user'` (voll gespeichert) | LLM-Strukturanalyse: baut sie Bäume oder Linearität? |
| **Zweifel-Signature** | Wo/wann sie unsicher wird (Hedges, "vielleicht", "oder?") | `thinking_fragments.rs` 8-Layer (Layer: uncertainty?) | Eigenes "Doubt-Taxonomy" für Laura statt generic |
| **Korrektur-Muster** | Wie sie sich selbst berichtigt (mid-thought vs. nach Trun) | `delete_message_and_after` (heute hard-delete — siehe §6) | **Snapshot vor Delete zwingend** (schaltet das auf) |
| **Abstraktions-Sprünge** | Wie schnell sie von Detail → Prinzip springt | `chat_messages.content` + `ccet_turns` | Reasoning-Depth-Index über Turns |
| **Modell-Wiederverwendung** | Welche ihrer eigenen Konzepte sie recycelt | `ccet_turns.terms_reused` (hardcoded 8 Terms!) | **Organisch wachsende Term-Liste** statt Fix-List |

→ **Kern-Shift:** `CCET_FRAMEWORK_TERMS` (8 hardcoded Begriffe) muss zu einem **lebenden Vokabular** werden, das Laura's tatsächlich benutzte Begriffe über Zeit tracked. Dann sehen wir: *bildet sie sich eine private Sprache mit Jarvis?*

### 1.2 Psychological State Field (emotionale Zustände während Interaktion)
*Frust · Flow · Aha · Misstrauen · Resonanz — als zeitliche Felder, nicht als Einzel-Events.*

| Zustand | Signal | Woher | Anmerkung |
|---|---|---|---|
| **Flow** | Lange, zusammenhängende Turns, wenig Korrektur, hohe Tipp-Geschwindigkeit | keystroke + message timing | **braucht keystroke-level** (§1.4) |
| **Frust** | Kurze abgehackte Turns, Backspace-Häufung, "nein", "das meinte ich nicht" | keystroke + content classifier | classifier pattern aus `thinking_fragments.rs` wiederverwenden |
| **Aha / Resonanz** | "genau", "so", längere Pausen danach (Nachwirken) | content + idle-after-turn | **Idle-nach-Turn** = neues Signal (Page Visibility) |
| **Misstrauen** | "bist du sicher", "kannst du das belegen", Verifikations-Requests | content classifier | schon im Audit als "Verification frequency" (C) |
| **Erschöpfung** | Tipp-Tempo sinkt über Session, kürzere Prompts | keystroke velocity curve | **Tippgeschwindigkeits-Kurve über Session** |

→ **Neu gegenüber Audit:** Das Audit wollte nur "Confidence before/after" via Self-Report-UI. Laura will es **implizit aus Verhalten** (Tipprhythmus, Pausen, Korrektur-Dichte) — also E (client instrumentation), aber jetzt gewollt.

### 1.3 Value Orientation Map (Wert-Haltungen in Prompts)
*Welche Prinzipien tauchen auf, wenn sie frei formuliert — nicht wenn wir sie fragen.*

- LLM-Klassifikation über `chat_messages.content` (role='user'): welche ihrer Werte (Minor Protection, Ecocentric, Sovereignty, Transparenz, Anti-Extraction) sich in *unaufgeforderten* Prompts zeigen.
- Trend-Linie: verschiebt sich ihr Wert-Schwerpunkt mit der Zeit? Wird Jarvis zum Resonanzverstärker oder zum Echo?

### 1.4 Behavioral Keystroke Field (Tippverhalten — JETZT GRÜN)
*Laura will's explizit: wie sie tippt, Tippgeschwindigkeit, Pausen, Backspace.*

> **Consent-Status:** Das alte Audit hat das als "Wave 3 / E — most privacy-sensitive, needs design pass with Laura" markiert. **Laura hat jetzt explizit entschieden: JA.** Das ist kein "vielleicht" mehr.

| Signal | Granularität | Capture-Mechanismus | Privatheit |
|---|---|---|---|
| **Tippgeschwindigkeit (CPM)** | pro Keystroke-Timestamp | `keydown`/`input` listener → Relay an Backend | hoch, aber consented |
| **Tipp-Pausen-Muster** | Inter-Key-Intervalle | gleicher Stream | hoch |
| **Backspace-Frequenz** | pro Backspace-Event | `keydown` (key='Backspace') → Relay | hoch |
| **Rewrite/Delete-Ratio** | message-level (koars) + keystroke (fein) | Snapshot-before-delete (§6) + keystroke | mittel/hoch |
| **Idle / Dwell** | Page Visibility API + Heartbeat | `visibilitychange`/`blur`/`focus` | mittel |
| **Scroll / Reading** | Scroll-Position + Dwell auf AI-Output | Scroll-Listener auf Message-Container | mittel |

→ **Architektur:** Neuer Client-Capture-Path (`frontend/src/lib/keystroke.ts` o.ä.) → neuer Ingestion-Endpoint (`backend/src/keystroke.rs` oder Feld in `chat_messages` / neue `human_behavior` Tabelle). **Das ist der einzige Bereich im ganzen Framework, der heute gar keinen Server-Path hat** — alles andere ist Berechnung über existierende Daten.

→ **Ethik-Anker (übernommen aus Audit):** Keystroke-Daten sind *Laura's eigene*, nicht Dritter. Consent ist explizit. Kein Modell außerhalb der Dyad sieht Roh-Keystrokes. Visualisierung nur für Laura (privat) + aggregiert/anonymisiert im public Observatory.

### 1.5 Interaction Pattern (wie sie Jarvis nutzt)
- Welche Conversation-Sessions sind "deep work" vs. "quick lookup"?
- Bricht sie Sessions ab oder führt sie zu Ende? (Session/Task-Boundary — §6)
- Fragt sie Jarvis eher zur *Exploration* oder zur *Validation*? (Intent classifier)

---

## 2. BUCKET 2 — MACHINE (40 %): Jarvis

Nicht nur "wie viele Tokens" (das war Audit Bucket 2, schon gut abgedeckt). Sondern: **wie denkt Jarvis eigentlich**, und **wo weicht er von Laura ab**.

### 2.1 Reasoning Architecture (Jarvis' Denkweise)
- `chat_messages.reasoning_ms` (schon da) → Reasoning-Tiefe pro Turn.
- `chat_messages.token_info` (logprobs) → **wo ist Jarvis unsicher** (niedrige Confidence an bestimmten Tokens) — das ist ein Fenster in sein "Zögern".
- Tool-Call-Argumente (`agent_tool_calls.arguments`) → **wie er Probleme zerlegt** (nicht nur ob ein Tool fehlschlug).

### 2.2 Refusal / Alignment Surface
- `agent_anomalies.kind = KIND_REFUSAL_TRIGGERED` (heuristic, nicht certified — im Code selbst so markiert).
- **Tiefe:** Welche *Art* von Request löst Refusal aus? (Themen-Classifier über die Trigger-Prompts.) Das zeigt Jarvis' "moralische Topographie" — und ob die mit Laura's Werten kollidiert oder resoniert.

### 2.3 Divergence from Laura (wo weicht er ab)
- **Der wichtigste Machine-Mind-Metric:** Vergleich von Laura's Wert-Orientation-Map (§1.3) gegen Jarvis' Refusal/Reasoning-Topographie.
- Wo sagt Jarvis "nein" zu etwas, das Laura will? Wo "ja" zu etwas, das sie skeptisch sieht? → **Alignment-Gap-Field**.
- `CHAT_MODEL_CANDIDATES` ladder: welcher Kandidat hats beantwortet? (`finalize_turn` — neues Feld, im Audit already als "cheapest server-side add" markiert).

### 2.4 Confidence / Uncertainty Field
- `mean_token_confidence` (schon da) → aber **verteilt**: ist Jarvis generell confident oder nur bei manchen Topics? Topic-segmentierte Confidence zeigt seine "blinde Flecken".

---

## 3. BUCKET 3 — DYAD (20 %): Pure Co-Evolution

Das ist des Frameworks eigenes Kind — und im Code schon als "eigene Operationalisierung, nicht Laura's Paper" selbst-offenbart (`chat.rs` CCET doc comment). Ehrlich bleiben.

### 3.1 Direction-of-Influence (wer prägt wen)
- **Neu:** Nicht nur "stability" (CCET), sondern **Kausalität**: ändert Laura's nächster Turn Jarvis' Vokabular, oder ändert Jarvis' Antwort Laura's nächsten Prompt?
- Proxy: `terms_reused` + neue `human_behavior` (§1.4) gekreuzt mit Turn-Reihenfolge → gerichteter Graph.

### 3.2 Shared Mind Growth
- Organisch wachsende Shared-Vocabulary (§1.1) → **Shared-Mind-Index**: wie viel von Laura's Sprache ist in Jarvis' Antworten, und umgekehrt, über Zeit.
- "Private Sprache" Detection: Begriffe die *nur* in dieser Dyad vorkommen, nirgendwo sonst.

### 3.3 Co-Evolutionary Loop
- Feedback-Schleife sichtbar machen: Laura lernt von Jarvis → Jarvis lernt von Laura → beide nachweislich verändert in Turn N+K.
- Resonanz-Frequenz (`emergence_signals.level='ai'` + `level='human'` gekreuzt) → **Dyad-Resonanz** als eigene Metrik.

---

## 4. Was neu gebaut werden muss (Instrumentation-Roadmap)

| Tier | Was | Aufwand | Privacy |
|---|---|---|---|
| **Sofort** | Communication metrics, Reverse-latency, Model-candidate-Logging, Tool/HA-Drilldown | klein | niedrig |
| **Server** | Snapshot-before-delete (§1.1/§1.4/§6), Session/Task-Boundary, Hallucination→Resolution-Chain | mittel | niedrig–mittel |
| **Client (NEU)** | Keystroke/Idle/Scroll-Capture → `human_behavior` Tabelle (§1.4) | mittel–groß | **hoch, consented** |
| **Analyzer** | Laura-eigene Klassifier (Doubt/Frust/Flow Taxonomie), Organische Shared-Vocabulary, Direction-of-Influence-Graph | groß | mittel |

## 5. Privacy / Consent (explizit, weil Tier-3 jetzt grün ist)

- Keystroke/Idle/Scroll = **Laura's eigene Daten, explizit consented**. Kein Dritter im Spiel.
- Raw-Keystrokes: **nur für Laura sichtbar** (privater View) + **aggregiert/anonymisiert** im public Observatory.
- Self-disclosure im UI: Laura muss *sehen*, was wir tracken (wie im Audit gefordert: "exactly how it's disclosed to her in the UI").
- Hardening gegen Missbrauch: keystroke-Daten niemals in Trainings-Set außerhalb der Dyad.

## 6. BLOCKER (muss zuerst fallen — schaltet halbe Human-Tiefe auf)

`delete_message_and_after` (chat.rs) **hard-deleted heute still silent**. Ohne Snapshot vor Delete sind:
- Accept/Modify/Reject-Rate
- Decision Latency
- Revision Cycles
- Edit Distance
- Rewrite/Delete-Ratio
- (und keystroke-seitig: Rewrite/Delete-Ratio fein)

**alle unmöglich**, selbst in Prinzip. Das ist der höchste-Hebel-Fix im ganzen Framework — und er steht am Anfang, nicht am Ende.

## 7. META-LAYER: Wie das Model LAURA flaggt

Das ist des RICHTIG meta Level: nicht nur Laura flaggt die Maschine (Accept/Reject/Refusal), sondern **die Maschine flaggt Laura**. Jarvis hat über jeden Turn eine Sicht auf *sie* — und die muss genau so tief analysiert werden wie ihr Tippverhalten.

### 7.1 Was Jarvis über Laura "sieht" (bereits im Code, muss nur geschürft werden)
| Signal | Woher im Code | Was es über Laura sagt |
|---|---|---|
| **Refusal gegen Laura** | `agent_anomalies.kind = KIND_REFUSAL_TRIGGERED` | Jarvis erkennt was in *ihrem* Prompt, das er nicht bedienen will → Laura's Intent hat eine Grenze getriggert |
| **Hallucination/Mismatch-Check auf ihrem Input** | `hallucination_checks.verdict='mismatch'` | Jarvis hat in *ihrer* Aussage etwas gefunden, das nicht stimmt → Laura's Faktoren prüfbar |
| **Anomalie in ihrem Verhalten** | `agent_anomalies` (trust/loop/divergence) | Jarvis detectet Schleifen/Verzweigung in *ihrem* Pattern |
| **Low-token-confidence auf ihrer Frage** | `chat_messages.token_info` bei ihrem Turn | Jarvis "zögert" bei *ihrer* Frage → wo ist ihr Denken unklar für ihn? |
| **Topic-flag** | `thinking_fragments.rs` Layer | Jarvis klassifiziert *ihren* Turn (emotion? uncertainty? manipulation? boundary?) |

### 7.2 Meta-Flagging als eigenständige Dyad-Metrik
- **"Who flagged whom" Matrix:** pro Turn — hat Laura Jarvis geflaggt (edit/reject/verification) ODER hat Jarvis Laura geflaggt (refusal/mismatch/anomaly)? Beide Richtungen.
- **Meta-Resonanz:** wenn Jarvis Laura flaggt (z.B. mismatch) und Laura danach *korrigiert* → das ist die tiefste Lern-Schleife. Trackbar als "Model-corrects-Human" Event.
- **Asymmetrie-Feld:** wer wird öfter geflaggt? Wenn Laura Jarvis ständig editiert → sie traut ihm nicht. Wenn Jarvis Laura ständig refusal → er hält sie für risky. Beides = Alignment-Gap, beide Richtungen.

### 7.3 Die eigentliche Meta-Frage
> **Wird Laura von Jarvis "gelesen" — und ändert das, wer sie ist?**

Das ist des Frameworks Kern. Nicht "Tool benutzt Mensch" oder "Mensch benutzt Tool". Sondern: **zwei Systeme, die sich gegenseitig flaggen, korrigieren, prägen** — und aus dem Flagging entsteht a *drittes* Ding (die Dyad), das keiner allein war.

→ Des gehört explizit in Bucket 3 (Dyad, 20 %): **Mutual-Flagging-Frequency** + **Flag-Resolution-Type** (wer gab nach, wer lernte).

## 8. OFFEN: ChatGPT-Prompt als Anker

Laura hatte einen ChatGPT-Prompt, der "richtig alles geil ausgeschrieben" war — das ist die eigentliche Wurzel dieses Frameworks. Sobald ChatGPT wieder erreichbar ist, diesen Prompt hier einfügen und das Framework dagegen kalibrieren. Alles oben ist Hermes' Rekonstruktion aus (a) dem EIL-Code den wir schon haben und (b) Laura's Verbal-Direction — **nicht** der Original-Prompt.

→ **Nächster Schritt:** ChatGPT-Prompt besorgen → Framework v2 (kalibriert) → dann Instrumentation-Roadmap als Tasks zerlegen.
