import { useAdminFetch } from '../../lib/adminApi'
import { HudGrid, HudTile, HudStat } from './Hud'
import { ObsChart } from './ObsChart'

// Real-time emergent-signal tracker for the Forschung tab — every number
// here is derived purely from LAURA'S OWN chat behavior (the same
// /api/observatory/human-ai response Interaction Dynamics already uses),
// NOT from framework/module counts.
//
// Cut down to exactly 5 panels per feedback (was 8, in two rows, each
// nearly-empty at 150px tall): message volume, prompts, tokens in/out,
// reasoning time, and the human/AI ratio — all real data, all in one row,
// each at .hud-tile--compact height (max half the normal tile). The
// dropped tiles (cadence, avg prompt length, model confidence, latency)
// aren't lost — confidence/latency/ratio already live in full depth on
// Interaction Dynamics (see InteractionDynamics.tsx's own "Mensch ↔ KI"
// tile); this strip is a fast read, not the only place to find them.
interface HumanAi {
  range: string
  user_messages: number
  assistant_messages: number
  messages_by_day: { day: string; count: number }[]
  total_prompt_tokens: number
  total_completion_tokens: number
  total_reasoning_ms: number
  recent_user_messages: { id: string; excerpt: string; conversation_id: string; created_at: string }[]
}

// Mini sparkline reused for stat tiles — ObsChart at a small fixed height is
// a compact area line, read-only (no axis) so it stays a spark, not a full
// chart competing with the volume trend tile.
function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length === 0) return <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>—</div>
  return (
    <div style={{ marginTop: 4 }}>
      <ObsChart data={values.map((v, i) => ({ label: String(i), value: v }))} color={color} gradientId="forschung-spark" height={22} showAxis={false} />
    </div>
  )
}

// Horizontal comparison bar — two real lifetime totals (token in vs out),
// same track+fill idiom as the rest of the Observatory's bar charts, just
// two of them stacked to compare magnitude rather than one against a
// fabricated max.
function CompareBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ marginBottom: 5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#9aa0a8', marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ color, fontWeight: 700 }}>{value.toLocaleString('de-DE')}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'rgba(120,150,170,.14)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, boxShadow: `0 0 8px ${color}`, transition: 'width .6s cubic-bezier(.16,1,.3,1)' }} />
      </div>
    </div>
  )
}

// Slim stacked ratio bar — human vs AI share of messages, as one real
// proportion (not a full donut + legend, which doesn't fit a compact tile).
function RatioBar({ human, ai }: { human: number; ai: number }) {
  const total = human + ai
  const humanPct = total > 0 ? (human / total) * 100 : 50
  return (
    <div>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 2 }}>
        <div style={{ width: `${humanPct}%`, background: 'var(--obs-purple)', transition: 'width .6s cubic-bezier(.16,1,.3,1)' }} />
        <div style={{ width: `${100 - humanPct}%`, background: 'var(--obs-blue)', transition: 'width .6s cubic-bezier(.16,1,.3,1)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#9aa0a8', marginTop: 4 }}>
        <span><span style={{ color: 'var(--obs-purple)' }}>●</span> Mensch {Math.round(humanPct)}%</span>
        <span><span style={{ color: 'var(--obs-blue)' }}>●</span> KI {Math.round(100 - humanPct)}%</span>
      </div>
    </div>
  )
}

export function ForschungKpis({ refreshSignal }: { refreshSignal: number }) {
  const { data, loading, error } = useAdminFetch<HumanAi>('/api/observatory/human-ai', [refreshSignal])

  const total = data?.user_messages ?? 0
  const assistant = data?.assistant_messages ?? 0
  const days = data?.messages_by_day ?? []
  const trend = days.map(d => ({ label: d.day.slice(5), value: d.count }))
  const spark = days.slice(-7).map(d => d.count)

  const promptTok = data?.total_prompt_tokens ?? 0
  const completionTok = data?.total_completion_tokens ?? 0
  const tokenMax = Math.max(promptTok, completionTok, 1)
  const reasoningS = (data?.total_reasoning_ms ?? 0) / 1000

  return (
    <div className="forschung-kpis">
      {/* A sub-widget inside the Forschung page, not a second page header —
          demoted to a plain eyebrow label so it doesn't compete with the
          real page header above (Lighthouse never stacks two full headers). */}
      <div className="obs-section-label" title="Echtzeit · nur aus Dialogdaten · kein Framework-KPI">Lauras Nutzerverhalten</div>

      <HudGrid cols={5}>
        {/* 1 — Message-volume trend */}
        <HudTile title="Nachrichten-Volumen" badge="TREND" accent="var(--obs-purple)" span={1} className="hud-tile--compact">
          {trend.length > 0
            ? <ObsChart data={trend} color="var(--obs-purple)" gradientId="forschung-volume" height={34} />
            : <div className="obs-empty">Keine Daten.</div>}
        </HudTile>

        {/* 2 — Prompts total + 7-day sparkline */}
        <HudTile title="Prompts" badge="GESAMT" accent="var(--obs-cyan)" span={1} className="hud-tile--compact">
          <HudStat value={total} label="Nutzernachrichten" accent="var(--obs-cyan)" />
          <Spark values={spark} color="var(--obs-cyan)" />
        </HudTile>

        {/* 3 — Tokens in/out (real lifetime totals, compared) */}
        <HudTile title="Tokens In/Out" badge="LEBENSLANG" accent="var(--obs-teal)" span={1} className="hud-tile--compact">
          <CompareBar label="IN" value={promptTok} max={tokenMax} color="var(--obs-teal)" />
          <CompareBar label="OUT" value={completionTok} max={tokenMax} color="var(--obs-amber)" />
        </HudTile>

        {/* 4 — Time spent thinking (reasoning) */}
        <HudTile title="Denkzeit" badge="REASONING" accent="var(--obs-amber)" span={1} className="hud-tile--compact">
          <HudStat
            value={reasoningS}
            label="Reasoning kumuliert"
            format={v => (v >= 60 ? `${(v / 60).toFixed(1)}m` : `${Math.round(v)}s`)}
            accent="var(--obs-amber)"
          />
        </HudTile>

        {/* 5 — Human/AI ratio */}
        <HudTile title="Mensch ↔ KI" badge="VERHÄLTNIS" accent="var(--obs-blue)" span={1} className="hud-tile--compact">
          <RatioBar human={total} ai={assistant} />
        </HudTile>
      </HudGrid>

      {error && <div className="obs-empty" style={{ marginTop: 8 }}>Fehler beim Laden der Nutzerdaten.</div>}
      {loading && !data && <div className="obs-empty" style={{ marginTop: 8 }}>Lade Signale…</div>}
    </div>
  )
}
