import { useAdminFetch } from '../../lib/adminApi'
import { HudGrid, HudTile, HudStat } from './Hud'
import { ObsChart } from './ObsChart'
import { ObsDonut } from './ObsDonut'
import { ObsGauge } from './ObsGauge'

// Real-time emergent-signal tracker for the Forschung tab — every number
// here is derived purely from LAURA'S OWN chat behavior (the same
// /api/observatory/human-ai response Interaction Dynamics already uses),
// NOT from framework/module counts. This is the deliberate replacement for
// the old LiveCards strip, which tracked observatory *module* totals
// (Emergence Monitor, Simulation Center, knowledge-graph size, …) — those
// are platform-operational figures Laura explicitly said are useless up
// here. Everything below answers "how is her prompting/talking actually
// behaving, right now?": volume, cadence, length, the human↔AI balance, how
// confident the model is when it answers her, how fast it answers, and how
// many conversations she's actively driving.
interface HumanAi {
  range: string
  user_messages: number
  assistant_messages: number
  messages_by_day: { day: string; count: number }[]
  mean_token_confidence: number | null
  mean_latency_seconds: number | null
  latency_sample_size: number
  total_prompt_tokens: number
  total_completion_tokens: number
  total_reasoning_ms: number
  recent_user_messages: { id: string; excerpt: string; conversation_id: string; created_at: string }[]
}

// Inline horizontal bar — a 5th chart idiom alongside line/gauge/donut/
// sparkline so the wall reads as genuinely multi-type, not "donuts
// everywhere". Deliberately tiny (no new component file): one filled track.
function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ height: 6, borderRadius: 4, background: 'rgba(120,150,170,.14)', overflow: 'hidden', marginTop: 8 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, boxShadow: `0 0 10px ${color}`, transition: 'width .6s cubic-bezier(.16,1,.3,1)' }} />
    </div>
  )
}

// Mini sparkline reused for stat tiles — ObsChart at height 34 is a compact
// area line, a 4th idiom. Kept read-only (no axis) so it stays a spark, not
// a full chart competing with the volume trend tile.
function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length === 0) return <div style={{ fontSize: 10, color: '#6b7280', marginTop: 6 }}>—</div>
  return (
    <div style={{ marginTop: 8 }}>
      <ObsChart data={values.map((v, i) => ({ label: String(i), value: v }))} color={color} gradientId="forschung-spark" height={34} />
    </div>
  )
}

export function ForschungKpis({ refreshSignal }: { refreshSignal: number }) {
  const { data, loading, error } = useAdminFetch<HumanAi>('/api/observatory/human-ai', [refreshSignal])

  // Derive every KPI from Laura's data — no framework figures.
  const total = data?.user_messages ?? 0
  const days = data?.messages_by_day ?? []
  const activeDays = days.filter(d => d.count > 0).length
  const cadence = activeDays > 0 ? total / activeDays : 0
  const recents = data?.recent_user_messages ?? []
  const avgLen = recents.length > 0
    ? recents.reduce((s, m) => s + m.excerpt.length, 0) / recents.length
    : 0
  const assistant = data?.assistant_messages ?? 0
  const ratio = total + assistant > 0 ? total / (total + assistant) : 0
  const conf = data?.mean_token_confidence ?? null
  const latency = data?.mean_latency_seconds ?? null
  const trend = days.map(d => ({ label: d.day.slice(5), value: d.count }))

  // Token + reasoning accounting (lifetime, from the new human-ai fields).
  const promptTok = data?.total_prompt_tokens ?? 0
  const completionTok = data?.total_completion_tokens ?? 0
  const reasoningS = (data?.total_reasoning_ms ?? 0) / 1000

  // Sparkline series: last 7 buckets of the daily volume.
  const spark = days.slice(-7).map(d => d.count)

  return (
    <div className="forschung-kpis">
      <div className="forschung-kpis-head">
        <span className="forschung-kpis-title">EMERGENTE SIGNALE — LAURAS NUTZERVERHALTEN</span>
        <span className="forschung-kpis-sub">Echtzeit · nur aus Dialogdaten · kein Framework-KPI</span>
      </div>

      <HudGrid cols={4}>
        {/* 1 — Message-volume trend (compact line chart, half width) */}
        <HudTile title="Nachrichten-Volumen" badge="TREND" accent="var(--obs-purple)" span={2}>
          {trend.length > 0
            ? <ObsChart data={trend} color="var(--obs-purple)" gradientId="forschung-volume" height={56} />
            : <div className="obs-empty">Noch keine Daten.</div>}
        </HudTile>

        {/* 2 — Prompts (total) stat + sparkline */}
        <HudTile title="Prompts" badge="GESAMT" accent="var(--obs-cyan)" span={2}>
          <HudStat value={total} label="gesendete Nutzernachrichten" accent="var(--obs-cyan)" />
          <Spark values={spark} color="var(--obs-cyan)" />
        </HudTile>

        {/* 3 — Cadence stat */}
        <HudTile title="Prompts / Tag" badge="KADENZ" accent="var(--obs-teal)" span={2}>
          <HudStat value={Math.round(cadence * 10) / 10} label="Ø pro aktivem Tag" format={v => v.toFixed(1)} accent="var(--obs-teal)" />
          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 8 }}>
            {activeDays} aktive Tage · Fenster: {data?.range ?? '—'}
          </div>
        </HudTile>

        {/* 4 — Avg prompt length (bar) */}
        <HudTile title="Ø Prompt-Länge" badge="ZEICHEN" accent="var(--obs-green)" span={2}>
          <HudStat value={Math.round(avgLen)} label="Zeichen (letzte Prompts)" accent="var(--obs-green)" />
          <Bar value={avgLen} max={280} color="var(--obs-green)" />
        </HudTile>

        {/* 5 — Human↔AI ratio (donut) */}
        <HudTile title="Mensch ↔ KI" badge="VERHÄLTNIS" accent="var(--obs-blue)" span={2}>
          <ObsDonut
            data={[
              { label: 'Mensch', value: total, color: 'var(--obs-purple)' },
              { label: 'KI', value: assistant, color: 'var(--obs-blue)' },
            ]}
            size={120} thickness={13} gradientIdPrefix="forschung-ratio"
          />
          <div style={{ fontSize: 10, color: '#9aa0a8', textAlign: 'center', marginTop: 6 }}>
            {Math.round(ratio * 100)}% Mensch
          </div>
        </HudTile>

        {/* 6 — Model confidence (gauge) */}
        <HudTile title="Modell-Konfidenz" badge="SIGNAL" accent="var(--obs-blue)" span={2}>
          {conf !== null
            ? <ObsGauge value={conf} label="Ø Konfidenz" color="var(--obs-blue)" />
            : <div className="obs-empty">—</div>}
        </HudTile>

        {/* 7 — Reply latency stat */}
        <HudTile title="Antwort-Tempo" badge="LATENZ" accent="var(--obs-amber)" span={2}>
          <HudStat
            value={latency ?? 0}
            label={`Ø Sek. (${data?.latency_sample_size ?? 0} Proben)`}
            format={v => (latency !== null ? `${v.toFixed(1)}s` : '—')}
            accent="var(--obs-amber)"
          />
        </HudTile>

        {/* 8 — Token & Reasoning (in/out + reasoning time) */}
        <HudTile title="Token & Reasoning" badge="LEBENSLANG" accent="var(--obs-purple)" span={2}>
          <div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--obs-cyan)', lineHeight: 1 }}>{completionTok.toLocaleString('de-DE')}</div>
              <div style={{ fontSize: 9, color: '#9aa0a8', marginTop: 3 }}>TOKEN OUT</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--obs-teal)', lineHeight: 1 }}>{promptTok.toLocaleString('de-DE')}</div>
              <div style={{ fontSize: 9, color: '#9aa0a8', marginTop: 3 }}>TOKEN IN</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--obs-amber)', lineHeight: 1 }}>
                {reasoningS >= 60 ? `${(reasoningS / 60).toFixed(1)}m` : `${Math.round(reasoningS)}s`}
              </div>
              <div style={{ fontSize: 9, color: '#9aa0a8', marginTop: 3 }}>REASONING</div>
            </div>
          </div>
          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 8 }}>
            {promptTok === 0 ? 'Token-In erst ab Modellen mit usage-Report' : 'kumuliert über alle Antworten'}
          </div>
        </HudTile>
      </HudGrid>

      {error && <div className="obs-empty" style={{ marginTop: 8 }}>Fehler beim Laden der Nutzerdaten.</div>}
      {loading && !data && <div className="obs-empty" style={{ marginTop: 8 }}>Lade Signale…</div>}
    </div>
  )
}
