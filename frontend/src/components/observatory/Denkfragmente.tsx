import { useEffect, useState } from 'react'
import { adminFetch, useAdminFetch } from '../../lib/adminApi'
import { ExportButtons } from './ExportButtons'
import { HudSkeleton } from './HudSkeleton'
import { HudGrid, HudTile } from './Hud'
import { ObsRadar } from './ObsRadar'
import { ObsDonut } from './ObsDonut'
import { STATUS_ACCENT } from './registry'

// Denkfragmente — Laura's own ask, verbatim-translated: "I mostly look at my
// AI interaction meta-retrospectively, but the whole thing through
// fragment-based thinking — the interaction shows my way of thinking in
// multiple ways too. That needs to be tracked and visualized with my brain
// image." First raised 2026-07-08, explicitly parked pending its own design
// pass — this module is that pass.
//
// **Deliberately NOT an anatomical brain graphic.** There is no
// image-generation capability anywhere in this stack, and faking one in
// SVG/CSS would be exactly the kind of fabrication this whole platform's
// no-fabrication doctrine (see the `.obs-badge-experimental` convention
// below) exists to rule out. What this IS instead: a genuine sequence/flow
// visualization — a horizontal timeline across one conversation's turns,
// each turn a colored segment (one color per layer of Laura's own IEIA-2025
// "8-Layer Model", split/striped when a turn spans more than one) — the real
// functional equivalent of "visualizing how my thinking moves across
// fragments," without pretending to be an image it isn't. See
// backend/src/thinking_fragments.rs's module doc comment for the backend
// half of this same disclosure.
//
// The 8 layer NAMES (facts, analysis, patterns, hypotheses, symbols, action,
// counterarguments, blind_spot) are Laura's own, from content.json's
// Research page ("8-Layer Model — separates thinking into eight levels:
// ..."); classifying a real turn into 1-3 of them is an LLM's interpretation,
// never a validated cognitive-science instrument — see the
// `.obs-badge-experimental` badge below, and `definitions_note` echoed
// verbatim from the backend.

interface Fragment {
  id: string
  message_id: string
  layer: string
  excerpt: string
  created_at: string
  definitions_note: string
}

interface LayerBucket {
  layer: string
  count: number
}

interface Distribution {
  range: string
  total: number
  by_layer: LayerBucket[]
  definitions_note: string
}

interface ConversationSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
  kind: string
}

// Fixed order — matches content.json's own "8-Layer Model" listing exactly,
// so the legend and the aggregate bars always present the 8 layers in the
// same, recognizable sequence rather than an incidental sort order.
const LAYER_ORDER = [
  'facts', 'analysis', 'patterns', 'hypotheses', 'symbols', 'action', 'counterarguments', 'blind_spot',
] as const

const LAYER_LABELS: Record<string, string> = {
  facts: 'Fakten',
  analysis: 'Analyse',
  patterns: 'Muster',
  hypotheses: 'Hypothesen',
  symbols: 'Symbole',
  action: 'Handlung',
  counterarguments: 'Gegenargumente',
  blind_spot: 'Blinder Fleck',
}

// A categorical 8-color set chosen and validated with this codebase's own
// dataviz skill (Okabe-Ito-style CVD-safe palette, checked with
// scripts/validate_palette.js under `--pairs all` — every one of the 8
// layers can legitimately co-occur in the SAME striped segment below, not
// just sit next to its immediate neighbor, so all-pairs separation is what
// actually matters here, not just adjacent-pair). Tuned specifically for the
// dark "Observatory HUD" surface (`--hud-bg: #070b12`, see App.css) that
// every Observatory module — this one included — always renders against
// (AdminPanel.tsx applies `.observatory-hud` whenever the active section is
// an Observatory module, independent of the light/dark toggle). Passes CVD
// separation at floor-or-better and contrast >=3:1 against that surface for
// all 8 hues; one hue ("patterns") needed a dedicated dark-surface value —
// the shared, non-dark-tuned violet from the same source palette collided
// with "facts" under protan/deutan simulation. Never presented as
// perceptually flawless: the legend below is always visible text (not
// color-only), every segment carries a text tooltip, and the full data is
// exportable as a real table — the "secondary encoding" this skill requires
// whenever a categorical check comes back WARN instead of a clean PASS.
const LAYER_COLORS: Record<string, string> = {
  facts: '#2a78d6',
  analysis: '#1baf7a',
  patterns: '#96479e',
  hypotheses: '#eda100',
  symbols: '#e87ba4',
  action: '#008300',
  counterarguments: '#e34948',
  blind_spot: '#eb6834',
}

const RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: '7d', label: 'Letzte 7 Tage' },
  { value: '30d', label: 'Letzte 30 Tage' },
  { value: 'all', label: 'Alle' },
]
const RANGE_SUFFIX: Record<string, string> = { '7d': 'letzte 7 Tage', '30d': 'letzte 30 Tage', all: 'alle' }

interface Turn {
  message_id: string
  excerpt: string
  created_at: string
  layers: string[]
}

/// Reduces the flat, one-row-per-(turn,layer) API response into one entry
/// per turn, preserving first-appearance order (== chronological turn order,
/// since the backend already returns rows oldest-first) — the shape the
/// timeline actually renders. A turn spanning 3 layers arrives as 3 flat
/// rows and collapses back into exactly 1 `Turn` with `layers.length === 3`.
function groupByTurn(fragments: Fragment[]): Turn[] {
  const order: string[] = []
  const byId = new Map<string, Turn>()
  for (const f of fragments) {
    let turn = byId.get(f.message_id)
    if (!turn) {
      turn = { message_id: f.message_id, excerpt: f.excerpt, created_at: f.created_at, layers: [] }
      byId.set(f.message_id, turn)
      order.push(f.message_id)
    }
    turn.layers.push(f.layer)
  }
  return order.map(id => byId.get(id)!)
}

// ── INTRACHAT LOOP ────────────────────────────────────────────────────────
// The missing 90%: Laura's own data is captured + classified (above), but the
// platform never showed her the LOOP — how her input moved through the system
// in real time. Each of her turns is rendered as a "loop node": the raw
// transmission she sent → which of her own 8 layers fired → which emergence
// signals that conversation spawned around that moment → the nearest system
// snapshot delta (CEI / resonance shift). Reading top-to-bottom is the
// "writing the book about how to fly the plane, while flying it midair"
// metaphor: you watch the rulebook get written turn by turn, not after.
//
// All four nodes come from EXISTING endpoints (no backend change):
//   - input + layer:  /api/observatory/fragments?conversation_id=X  (excerpt)
//   - spawned signals:/api/observatory/emergence/signals  (client-filtered by
//                     source_conversation_id, aligned by created_at proximity)
//   - system shift:   /api/observatory/snapshots?range=all  (nearest CEI/resonance)
// Signals have no conversation_id server param, so we fetch all and filter
// client-side, same idiom EmergenceMonitor/SimulationCenter already use.

interface LoopSignal {
  id: string
  pattern: string
  level: string
  status: string
  source_conversation_id: string | null
  created_at: string
}
interface LoopSnapshot {
  created_at: string
  cei: number
  resonance_frequency: number
}

function alignSignals(turnTime: number, signals: LoopSignal[]): LoopSignal[] {
  // Signals spawned within 20 min after a turn belong to that turn's loop.
  const window = 20 * 60 * 1000
  return signals.filter(s => {
    const t = Date.parse(s.created_at)
    return s.source_conversation_id && t >= turnTime && t <= turnTime + window
  })
}

function nearestSnapshotDelta(turnTime: number, snaps: LoopSnapshot[]): { before?: LoopSnapshot; after?: LoopSnapshot } {
  if (snaps.length === 0) return {}
  const before = [...snaps].reverse().find(s => Date.parse(s.created_at) <= turnTime)
  const after = snaps.find(s => Date.parse(s.created_at) >= turnTime)
  return { before, after }
}

function fmtPct(v: number): string { return `${Math.round(v * 100)}%` }

function LoopNode({
  index, turn, signals, snap,
}: {
  index: number
  turn: Turn
  signals: LoopSignal[]
  snap?: { before?: LoopSnapshot; after?: LoopSnapshot }
}) {
  const spawned = alignSignals(Date.parse(turn.created_at), signals)
  const ceiBefore = snap?.before?.cei
  const ceiAfter = snap?.after?.cei
  const resBefore = snap?.before?.resonance_frequency
  const resAfter = snap?.after?.resonance_frequency
  const ceiDelta = ceiBefore !== undefined && ceiAfter !== undefined ? ceiAfter - ceiBefore : null
  const resDelta = resBefore !== undefined && resAfter !== undefined ? resAfter - resBefore : null
  return (
    <HudTile
      title={`TURN ${String(index + 1).padStart(3, '0')}`}
      badge="INTRACHAT"
      accent={LAYER_COLORS[turn.layers[0]] ?? 'var(--hud-cyan)'}
      span={4}
    >
      {/* 1 · RAW TRANSMISSION — Laura's own input (preview; backend truncates
          to 120 chars in the fragments excerpt; full text needs a message-by-id
          endpoint, flagged as a follow-up). */}
      <div style={{ fontFamily: "'SF Mono','JetBrains Mono',Consolas,monospace", fontSize: 12, lineHeight: 1.55, color: 'rgba(226,241,245,.9)', background: 'rgba(7,14,20,.5)', borderLeft: '2px solid var(--hud-cyan)', padding: '8px 10px', borderRadius: 6, marginBottom: 10 }}>
        {turn.excerpt || '—'}
      </div>
      {/* 2 · HER LAYERS — which of the 8 IEIA layers this turn drew on. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {turn.layers.map(layer => (
          <span key={layer} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color: '#eefcff', background: `${LAYER_COLORS[layer] ?? '#888'}22`, border: `1px solid ${LAYER_COLORS[layer] ?? '#888'}`, borderRadius: 20, padding: '2px 9px' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: LAYER_COLORS[layer] ?? '#888' }} />
            {LAYER_LABELS[layer] ?? layer}
          </span>
        ))}
      </div>
      {/* 3 + 4 · MODEL REACTION + SYSTEM SHIFT, side by side. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div style={{ fontSize: 9.5, letterSpacing: '.07em', textTransform: 'uppercase', color: 'rgba(148,190,199,.6)', marginBottom: 5 }}>Modell-Reaktion</div>
          {spawned.length === 0 ? (
            <div style={{ fontSize: 11, color: 'rgba(148,190,199,.45)' }}>keine Signale in diesem Fenster</div>
          ) : (
            spawned.map(s => (
              <div key={s.id} style={{ fontSize: 11, color: 'rgba(226,241,245,.82)', marginBottom: 4 }}>
                <span style={{ color: STATUS_ACCENT[s.status] ?? 'var(--hud-cyan)' }}>●</span> {s.pattern}
                <span style={{ color: 'rgba(148,190,199,.5)' }}> · {s.level}</span>
              </div>
            ))
          )}
        </div>
        <div>
          <div style={{ fontSize: 9.5, letterSpacing: '.07em', textTransform: 'uppercase', color: 'rgba(148,190,199,.6)', marginBottom: 5 }}>System-Shift</div>
          {ceiDelta === null ? (
            <div style={{ fontSize: 11, color: 'rgba(148,190,199,.45)' }}>kein Snapshot-Delta</div>
          ) : (
            <div style={{ display: 'flex', gap: 14 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "'SF Mono',monospace", color: ceiDelta >= 0 ? '#6ee7b7' : '#fca5a5' }}>{ceiDelta >= 0 ? '+' : ''}{fmtPct(Math.abs(ceiDelta))}</div>
                <div style={{ fontSize: 9, color: 'rgba(148,190,199,.55)', textTransform: 'uppercase' }}>CEI Δ</div>
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "'SF Mono',monospace", color: resDelta !== null && resDelta >= 0 ? '#6ee7b7' : '#fca5a5' }}>{(resDelta ?? 0) >= 0 ? '+' : ''}{fmtPct(Math.abs(resDelta ?? 0))}</div>
                <div style={{ fontSize: 9, color: 'rgba(148,190,199,.55)', textTransform: 'uppercase' }}>Resonanz Δ</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </HudTile>
  )
}

function IntrachatLoop({ conversationId }: { conversationId: string }) {
  const [signals, setSignals] = useState<LoopSignal[]>([])
  const [snaps, setSnaps] = useState<LoopSnapshot[]>([])
  const [loading, setLoading] = useState(false)
  const { data: fragments } = useAdminFetch<Fragment[]>(
    `/api/observatory/fragments?conversation_id=${encodeURIComponent(conversationId)}`,
    [conversationId],
  )
  useEffect(() => {
    if (!conversationId) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      adminFetch(`/api/observatory/emergence/signals?limit=200`, {}).then(r => r.ok ? r.json() : []),
      adminFetch(`/api/observatory/snapshots?range=all&limit=200`, {}).then(r => r.ok ? r.json() : { items: [] }),
    ]).then(([sig, snap]: [LoopSignal[], { items: LoopSnapshot[] }]) => {
      if (cancelled) return
      setSignals(sig)
      setSnaps((snap.items ?? []).slice().sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)))
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [conversationId])

  const turns = groupByTurn(fragments ?? [])
  if (!conversationId) return null
  if (turns.length === 0) return null
  return (
    <div style={{ marginTop: 8 }}>
      <div className="obs-section-label">Intrachat-Schleife — Laura → Modell → System</div>
      <p style={{ fontSize: 11.5, color: 'rgba(148,190,199,.6)', margin: '0 0 12px', lineHeight: 1.5 }}>
        Der geschlossene Kreis: was Laura eingibt (Transmis­sion) → welche ihrer 8 Denkebenen feuert → welche Emergenz-Signale das Gespräch
        in diesem Moment auslöst → wie sich der Systemzustand (CEI / Resonanz) verschiebt. Wie ein Handbuch übers Fliegen schreiben, während
        man die Maschine baut und fliegt.
      </p>
      {loading ? <HudSkeleton variant="list" rows={3} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {turns.map((turn, i) => (
            <LoopNode
              key={turn.message_id}
              index={i}
              turn={turn}
              signals={signals}
              snap={nearestSnapshotDelta(Date.parse(turn.created_at), snaps)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function Denkfragmente({ onOpenConversation }: { onOpenConversation?: (conversationId: string) => void } = {}) {
  // ── conversation picker — Laura's own Forschungsgespräche, newest first
  // (same as the Forschung sidebar's own default ordering) ────────────────
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [convLoading, setConvLoading] = useState(true)
  const [convError, setConvError] = useState(false)
  const [selectedConv, setSelectedConv] = useState('')

  useEffect(() => {
    let cancelled = false
    adminFetch(`/api/chat/conversations?kind=chat`, {})
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then((list: ConversationSummary[]) => {
        if (cancelled) return
        setConversations(list)
        setSelectedConv(prev => (prev && list.some(c => c.id === prev) ? prev : list[0]?.id ?? ''))
        setConvLoading(false)
      })
      .catch(() => { if (!cancelled) { setConvError(true); setConvLoading(false) } })
    return () => { cancelled = true }
  }, [])

  // ── per-conversation sequence ────────────────────────────────────────
  const [fragments, setFragments] = useState<Fragment[]>([])
  const [seqLoading, setSeqLoading] = useState(false)
  const [seqError, setSeqError] = useState(false)

  useEffect(() => {
    if (!selectedConv) {
      return
    }
    let cancelled = false
    setSeqLoading(true)
    setSeqError(false)
    adminFetch(`/api/observatory/fragments?conversation_id=${encodeURIComponent(selectedConv)}`, {})
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then((page: Fragment[]) => { if (!cancelled) { setFragments(page); setSeqLoading(false) } })
      .catch(() => { if (!cancelled) { setSeqError(true); setSeqLoading(false) } })
    return () => { cancelled = true }
  }, [selectedConv])
  // No conversation selected (the true-empty-state case, zero conversations
  // exist yet) — render as if there were no fragments, without a
  // synchronous `setFragments([])` inside the effect above (flagged by
  // react-hooks/set-state-in-effect; deriving it here instead is both the
  // recommended fix and simpler).
  const effectiveFragments = selectedConv ? fragments : []

  // ── aggregate distribution across ALL conversations ──────────────────
  const [range, setRange] = useState('all')
  const { data: distribution, loading: distLoading, error: distError } = useAdminFetch<Distribution>(
    `/api/observatory/fragments/distribution?range=${range}`,
    [range],
  )


  const turns = groupByTurn(effectiveFragments)
  const maxLayerCount = Math.max(...(distribution?.by_layer.map(b => b.count) ?? []), 1)

  return (
    <div className="obs-panel">
      {/* ── legend: always-visible text labels, not color-only identity — */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginBottom: 16 }}>
        {LAYER_ORDER.map(layer => (
          <span key={layer} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#6b7280', fontWeight: 600 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: LAYER_COLORS[layer], flexShrink: 0 }} />
            {LAYER_LABELS[layer]}
          </span>
        ))}
      </div>

      {/* ── per-conversation timeline ────────────────────────────────── */}
      <div className="obs-section-label">Denkfragmente — Gesprächsverlauf</div>
      <div className="obs-card">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          {convLoading ? (
            <span style={{ fontSize: 12, color: '#9aa0a8' }}>Lade Gespräche…</span>
          ) : convError ? (
            <span style={{ fontSize: 12, color: '#9aa0a8' }}>Gespräche konnten nicht geladen werden.</span>
          ) : conversations.length === 0 ? (
            <span style={{ fontSize: 12, color: '#9aa0a8' }}>Noch keine Forschungsgespräche vorhanden.</span>
          ) : (
            <select value={selectedConv} onChange={e => setSelectedConv(e.target.value)} style={{ flex: '1 1 260px', fontSize: 12, padding: '5px 8px' }}>
              {conversations.map(c => <option key={c.id} value={c.id}>{c.title} ({c.updated_at})</option>)}
            </select>
          )}
          {selectedConv && onOpenConversation && (
            <button className="chat-inspect-toggle" style={{ fontSize: 11 }} onClick={() => onOpenConversation(selectedConv)}>
              im Gespräch öffnen ↗
            </button>
          )}
          <ExportButtons
            rows={effectiveFragments.map(f => ({ ...f }))}
            filenameBase="denkfragmente-gespraech"
            title="Denkfragmente — ein Gespräch"
            disabled={effectiveFragments.length === 0}
          />
        </div>

        {seqLoading ? (
          <HudSkeleton variant="chart" />
        ) : seqError ? (
          <div className="obs-empty">Fehler beim Laden.</div>
        ) : !selectedConv ? (
          <div className="obs-empty">Wähle ein Gespräch, um seine Denkfragment-Sequenz zu sehen.</div>
        ) : turns.length === 0 ? (
          // Honest empty state — no backfill, no fabricated fragments for a
          // conversation that predates this feature or whose classification
          // simply hasn't landed yet (it runs as a background task after
          // each turn, see thinking_fragments.rs).
          <div className="obs-empty">
            Für dieses Gespräch gibt es noch keine Denkfragment-Historie — entweder ist es älter als dieses Feature, oder die
            Klassifizierung eines gerade abgeschlossenen Turns läuft noch im Hintergrund.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 3, overflowX: 'auto', paddingBottom: 6 }}>
              {turns.map(turn => (
                <div
                  key={turn.message_id}
                  title={`${turn.created_at}\n${turn.layers.map(l => LAYER_LABELS[l] ?? l).join(' + ')}\n\n${turn.excerpt}`}
                  style={{
                    display: 'flex', flex: '1 0 30px', minWidth: 30, height: 46, borderRadius: 6,
                    overflow: 'hidden', boxShadow: '0 1px 2px rgba(15,23,42,.08)', cursor: 'help',
                  }}
                >
                  {turn.layers.map(layer => (
                    <div key={layer} style={{ flex: 1, background: LAYER_COLORS[layer] ?? '#9aa0a8' }} />
                  ))}
                </div>
              ))}
            </div>
            <p style={{ fontSize: 11.5, color: '#9aa0a8', marginTop: 10, marginBottom: 0 }}>
              {turns.length} klassifizierte{turns.length === 1 ? 'r Turn' : ' Turns'} — links nach rechts in Gesprächsreihenfolge; ein
              geteiltes Segment heißt, der Turn wurde mehreren Ebenen zugeordnet. Zum Anzeigen der Ebenen und eines Textausschnitts mit
              der Maus über ein Segment fahren.
            </p>
          </>
        )}
      </div>

      {/* ── aggregate: which layers dominate across ALL conversations ─── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        <div className="obs-section-label" style={{ flex: 1 }}>
          Ebenen-Verteilung ({distribution ? (RANGE_SUFFIX[distribution.range] ?? distribution.range) : '…'})
        </div>
        <select value={range} onChange={e => setRange(e.target.value)} style={{ fontSize: 12, padding: '5px 8px', marginBottom: 10 }}>
          {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {distLoading ? (
        <HudSkeleton variant="chart" />
      ) : distError ? (
        <div className="obs-empty">Fehler beim Laden.</div>
      ) : !distribution || distribution.total === 0 ? (
        <div className="obs-card"><div className="obs-empty">Noch keine Denkfragmente über alle Gespräche hinweg — sie entstehen automatisch nach jedem Forschungsgespräch.</div></div>
      ) : (
        <HudGrid cols={4}>
          {/* (1) Layer counts as horizontal bars — one chart idiom. */}
          <HudTile title="Ebenen-Verteilung" badge="BARS" accent="var(--obs-purple)" span={2}>
            <div>
              {LAYER_ORDER.map(layer => {
                const count = distribution.by_layer.find(b => b.layer === layer)?.count ?? 0
                return (
                  <div key={layer} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                    <span style={{ width: 86, fontSize: 11, color: 'rgba(148,190,199,.72)', flexShrink: 0 }}>{LAYER_LABELS[layer]}</span>
                    <div style={{ flex: 1, height: 9, borderRadius: 4, background: 'rgba(120,150,170,.14)', overflow: 'hidden' }}>
                      <div style={{ width: `${maxLayerCount > 0 ? (count / maxLayerCount) * 100 : 0}%`, height: '100%', background: LAYER_COLORS[layer] }} />
                    </div>
                    <span style={{ width: 22, fontSize: 11, fontWeight: 700, textAlign: 'right', color: '#cfe8ef' }}>{count}</span>
                  </div>
                )
              })}
            </div>
          </HudTile>
          {/* (2) Radar/spider — one axis per layer, shared max so the shape
              reads as a real distribution, not a normalized blob. */}
          <HudTile title="Layer-Profil" badge="RADAR" accent="var(--obs-teal)" span={1}>
            <ObsRadar
              axes={LAYER_ORDER.map(layer => ({
                key: layer,
                label: LAYER_LABELS[layer],
                value: distribution.by_layer.find(b => b.layer === layer)?.count ?? 0,
                max: maxLayerCount,
                color: LAYER_COLORS[layer],
              }))}
            />
          </HudTile>
          {/* (3) Donut — the same counts, a third chart idiom beside the
              other two. */}
          <HudTile title="Top-Ebenen" badge="DONUT" accent="var(--obs-blue)" span={1}>
            <ObsDonut
              data={LAYER_ORDER.map(layer => ({
                label: LAYER_LABELS[layer],
                value: distribution.by_layer.find(b => b.layer === layer)?.count ?? 0,
                color: LAYER_COLORS[layer],
              }))}
              gradientIdPrefix="denkfragmente-layer-donut"
            />
          </HudTile>
        </HudGrid>
      )}
      <p style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.6 }}>
        Verteilung über alle Forschungsgespräche hinweg, nicht nur das oben gewählte — zeigt, welche Denkebenen (nach Lauras eigenem
        8-Layer-Model) über die Zeit dominieren.
      </p>

      {/* ── INTRACHAT LOOP: the missing 90% — Laura's own data shown as a
          live closed loop, not just classified. Rendered for the currently
          selected conversation. See IntrachatLoop above. */}
      <IntrachatLoop conversationId={selectedConv} />
    </div>
  )
}
