import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders, useAdminFetch } from '../../lib/adminApi'
import { ExportButtons } from './ExportButtons'
import { HudSkeleton } from './HudSkeleton'

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
// THIS PROJECT'S OWN operationalization, same as CCET: the 8 layer NAMES
// (facts, analysis, patterns, hypotheses, symbols, action, counterarguments,
// blind_spot) are Laura's own, from content.json's Research page ("8-Layer
// Model — separates thinking into eight levels: ..."); classifying a real
// turn into 1-3 of them is an LLM's interpretation, never a validated
// cognitive-science instrument — see the `.obs-badge-experimental` badge
// below, and `definitions_note` echoed verbatim from the backend.

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

export function Denkfragmente({ onOpenConversation }: { onOpenConversation?: (conversationId: string) => void } = {}) {
  // ── conversation picker — Laura's own Forschungsgespräche, newest first
  // (same as the Forschung sidebar's own default ordering) ────────────────
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [convLoading, setConvLoading] = useState(true)
  const [convError, setConvError] = useState(false)
  const [selectedConv, setSelectedConv] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/chat/conversations?kind=chat`, { headers: authHeaders() })
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
    fetch(`${API_BASE}/api/observatory/fragments?conversation_id=${encodeURIComponent(selectedConv)}`, { headers: authHeaders() })
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

  const definitionsNote = effectiveFragments[0]?.definitions_note ?? distribution?.definitions_note

  const turns = groupByTurn(effectiveFragments)
  const maxLayerCount = Math.max(...(distribution?.by_layer.map(b => b.count) ?? []), 1)

  return (
    <div className="obs-panel">
      <div
        className="obs-badge-experimental"
        title={definitionsNote ?? 'Eigene Operationalisierung dieses Projekts, keine validierte kognitionswissenschaftliche Methode.'}
      >
        Eigene Operationalisierung — nicht wörtlich aus Lauras Paper
      </div>

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
      <div className="obs-card">
        {distLoading ? (
          <HudSkeleton variant="chart" />
        ) : distError ? (
          <div className="obs-empty">Fehler beim Laden.</div>
        ) : !distribution || distribution.total === 0 ? (
          <div className="obs-empty">Noch keine Denkfragmente über alle Gespräche hinweg — sie entstehen automatisch nach jedem Forschungsgespräch.</div>
        ) : (
          distribution.by_layer.map(b => (
            <div className="obs-bar-row" key={b.layer}>
              <span style={{ width: 130, fontSize: 11, color: '#6b7280', fontWeight: 600, flexShrink: 0 }}>{LAYER_LABELS[b.layer] ?? b.layer}</span>
              <div className="obs-bar-track">
                <div className="obs-bar-fill" style={{ width: `${(b.count / maxLayerCount) * 100}%`, background: LAYER_COLORS[b.layer] ?? '#3b6bf6' }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 800, color: LAYER_COLORS[b.layer] ?? '#3b6bf6', minWidth: 24, textAlign: 'right' }}>{b.count}</span>
            </div>
          ))
        )}
      </div>
      <p style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.6 }}>
        Verteilung über alle Forschungsgespräche hinweg, nicht nur das oben gewählte — zeigt, welche Denkebenen (nach Lauras eigenem
        8-Layer-Model) über die Zeit dominieren.
      </p>
    </div>
  )
}
