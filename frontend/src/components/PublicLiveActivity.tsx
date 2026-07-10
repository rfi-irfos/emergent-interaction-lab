import { useEffect, useState } from 'react'
import { useLang } from '../hooks/useLang'
import { API_BASE } from '../lib/apiBase'

// How often to re-poll the two public homepage widgets below. Frequent
// enough to feel alive on a page a visitor might sit on for a minute, far
// from frequent enough to be a meaningful load — these are both cheap
// (COUNT(*) / a cached-by-nothing but tiny GitHub call) reads.
const POLL_MS = 45_000

// ── /api/public/live-stats ──────────────────────────────────────────────────
// Shape returned by the public, unauthenticated GET /api/public/live-stats
// (see backend/src/public.rs::live_stats) — four bare aggregate counts,
// never row content.
interface LiveStats {
  emergence_signals: number
  chat_conversations: number
  simulation_runs: number
  research_notes: number
}

const STATS_COPY = {
  en: {
    eyebrow: 'Live from the Observatory',
    title: 'Not a brochure — a running instrument',
    intro: 'These numbers are read straight from the same database the research runs on, refreshed automatically — not staged for this page.',
    emergence_signals: 'Emergence signals tracked',
    chat_conversations: 'Research conversations logged',
    simulation_runs: 'Simulations run',
    research_notes: 'Research notes written',
    loading: 'Loading live numbers…',
    unavailable: 'Live numbers are temporarily unavailable.',
  },
  de: {
    eyebrow: 'Live aus dem Observatory',
    title: 'Keine Broschüre — ein laufendes Instrument',
    intro: 'Diese Zahlen kommen direkt aus derselben Datenbank, mit der auch geforscht wird, und werden automatisch aktualisiert — nicht für diese Seite inszeniert.',
    emergence_signals: 'Emergenz-Signale erfasst',
    chat_conversations: 'Forschungsgespräche protokolliert',
    simulation_runs: 'Simulationen durchgeführt',
    research_notes: 'Forschungsnotizen verfasst',
    loading: 'Live-Zahlen werden geladen…',
    unavailable: 'Live-Zahlen sind gerade nicht verfügbar.',
  },
} as const

/**
 * Live activity ticker: four stat tiles polled from the public backend.
 * Skips fetching entirely in the admin canvas (`editMode`) — same
 * convention as `trackPageView` elsewhere in PublicSite.tsx — since polling
 * has no purpose while an admin is editing/previewing the page, and shows
 * static placeholder tiles there instead so the layout still previews.
 */
export function LiveStatsSection({ editMode, reveal }: { editMode: boolean; reveal: (cls: string) => string }) {
  const { lang } = useLang()
  const c = STATS_COPY[lang]
  const [stats, setStats] = useState<LiveStats | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (editMode) return
    let cancelled = false
    const load = () => {
      fetch(`${API_BASE}/api/public/live-stats`)
        .then(res => { if (!res.ok) throw new Error(String(res.status)); return res.json() })
        .then((data: LiveStats) => { if (!cancelled) { setStats(data); setError(false) } })
        .catch(() => { if (!cancelled) setError(true) })
    }
    load()
    const id = window.setInterval(load, POLL_MS)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [editMode])

  const tiles: Array<{ key: keyof LiveStats; label: string }> = [
    { key: 'emergence_signals', label: c.emergence_signals },
    { key: 'chat_conversations', label: c.chat_conversations },
    { key: 'simulation_runs', label: c.simulation_runs },
    { key: 'research_notes', label: c.research_notes },
  ]
  const fmt = (n: number) => n.toLocaleString(lang === 'de' ? 'de-AT' : 'en-IE')

  return (
    <section className={reveal('site-section site-livestats')} id="live-stats">
      <div className="site-eyebrow">{c.eyebrow}</div>
      <h2 className="site-section-title">{c.title}</h2>
      <p className="site-livestats-intro">{c.intro}</p>

      {editMode && (
        <div className="site-livestats-grid">
          {tiles.map(tile => (
            <div className="site-livestats-tile" key={tile.key}>
              <strong>—</strong>
              <span>{tile.label}</span>
            </div>
          ))}
        </div>
      )}

      {!editMode && stats === null && !error && <p className="site-livestats-status">{c.loading}</p>}
      {!editMode && error && <p className="site-livestats-status">{c.unavailable}</p>}
      {!editMode && stats !== null && (
        <div className="site-livestats-grid">
          {tiles.map(tile => (
            <div className="site-livestats-tile" key={tile.key}>
              <strong>{fmt(stats[tile.key])}</strong>
              <span>{tile.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── /api/public/shipping-feed ────────────────────────────────────────────────
// Shape returned by the public, unauthenticated GET /api/public/shipping-feed
// (see backend/src/public.rs::shipping_feed / ShippingItem) — merged PRs
// only, title + merge date + link, nothing else.
interface ShippingItem {
  title: string
  merged_at: string
  url: string
}
interface ShippingFeedResp {
  configured: boolean
  items: ShippingItem[]
}

const SHIPPING_COPY = {
  en: {
    eyebrow: 'Shipping log',
    title: 'Recent updates',
    loading: 'Loading recent updates…',
    unavailable: 'Recent updates are temporarily unavailable.',
    notConfigured: 'Recent updates are not connected yet.',
    empty: 'No merged updates yet.',
  },
  de: {
    eyebrow: 'Entwicklungs-Log',
    title: 'Neueste Entwicklungen',
    loading: 'Neueste Entwicklungen werden geladen…',
    unavailable: 'Neueste Entwicklungen sind gerade nicht verfügbar.',
    notConfigured: 'Neueste Entwicklungen sind noch nicht angebunden.',
    empty: 'Noch keine gemergten Entwicklungen.',
  },
} as const

function formatMergeDate(iso: string, lang: 'en' | 'de'): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(lang === 'de' ? 'de-AT' : 'en-IE', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * Compact "what's shipping" list: merged PR title + date, linking out to the
 * real PR on GitHub. Curated server-side (see backend/src/public.rs) — this
 * component just renders whatever comes back, no further filtering needed.
 */
export function ShippingFeedSection({ editMode, reveal }: { editMode: boolean; reveal: (cls: string) => string }) {
  const { lang } = useLang()
  const c = SHIPPING_COPY[lang]
  const [resp, setResp] = useState<ShippingFeedResp | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (editMode) return
    let cancelled = false
    const load = () => {
      fetch(`${API_BASE}/api/public/shipping-feed`)
        .then(res => { if (!res.ok) throw new Error(String(res.status)); return res.json() })
        .then((data: ShippingFeedResp) => { if (!cancelled) { setResp(data); setError(false) } })
        .catch(() => { if (!cancelled) setError(true) })
    }
    load()
    const id = window.setInterval(load, POLL_MS)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [editMode])

  return (
    <section className={reveal('site-section site-shipping')} id="shipping-feed">
      <div className="site-eyebrow">{c.eyebrow}</div>
      <h2 className="site-section-title">{c.title}</h2>

      {editMode && <p className="site-shipping-status">{c.loading}</p>}
      {!editMode && resp === null && !error && <p className="site-shipping-status">{c.loading}</p>}
      {!editMode && error && <p className="site-shipping-status">{c.unavailable}</p>}
      {!editMode && resp !== null && !resp.configured && <p className="site-shipping-status">{c.notConfigured}</p>}
      {!editMode && resp !== null && resp.configured && resp.items.length === 0 && (
        <p className="site-shipping-status">{c.empty}</p>
      )}
      {!editMode && resp !== null && resp.configured && resp.items.length > 0 && (
        <ul className="site-shipping-list">
          {resp.items.map((item, i) => (
            <li className="site-shipping-item" key={i}>
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="site-shipping-link">
                <span className="site-shipping-date">{formatMergeDate(item.merged_at, lang)}</span>
                <span className="site-shipping-title">{item.title}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── /api/public/current-focus ───────────────────────────────────────────────
// Shape returned by GET /api/public/current-focus (see
// backend/src/public.rs::current_focus / CurrentFocus) — two controlled-
// vocabulary labels (an emergence-signal level, a research-note category)
// and the window they were computed over. Never a note title/body or a
// signal's pattern/observation/scope.
interface CurrentFocus {
  active_level: string | null
  active_category: string | null
  window_minutes: number
}

// Same 4 keys emergence.rs's schema fixes ('human'|'ai'|'interaction'|
// 'system') — labels deliberately left in English, matching the admin
// Observatory's own LEVEL_SECTIONS (EmergenceMonitor.tsx), which never
// translates these either since they're this project's own framework terms,
// not ordinary German prose.
const LEVEL_LABEL: Record<string, string> = { human: 'Human', ai: 'AI', interaction: 'Interaction', system: 'System' }

const FOCUS_COPY = {
  en: {
    label: 'Right now',
    withBoth: (level: string, category: string) => <>Observatory is most active at the <strong>{level}</strong> level &middot; latest note logged as <strong>{category}</strong></>,
    levelOnly: (level: string) => <>Observatory is most active at the <strong>{level}</strong> level right now</>,
    categoryOnly: (category: string) => <>Latest research note logged as <strong>{category}</strong></>,
    quiet: 'Quiet right now — no new signals in the last window.',
  },
  de: {
    label: 'Gerade jetzt',
    withBoth: (level: string, category: string) => <>Observatory ist gerade am aktivsten auf Ebene <strong>{level}</strong> &middot; letzte Notiz kategorisiert als <strong>{category}</strong></>,
    levelOnly: (level: string) => <>Observatory ist gerade am aktivsten auf Ebene <strong>{level}</strong></>,
    categoryOnly: (category: string) => <>Letzte Forschungsnotiz kategorisiert als <strong>{category}</strong></>,
    quiet: 'Gerade ruhig — keine neuen Signale im letzten Zeitfenster.',
  },
} as const

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s
}

/**
 * Slim "currently exploring" indicator — a live-pulse badge naming which
 * Observatory level fired most recently and what the latest research note
 * was categorized as. Both values are controlled-vocabulary labels (4 fixed
 * levels, 6 fixed research-note categories, see backend/src/public.rs), never
 * note/signal content — the same non-identifying-signal contract as the rest
 * of this file.
 */
export function CurrentFocusBadge({ editMode, reveal }: { editMode: boolean; reveal: (cls: string) => string }) {
  const { lang } = useLang()
  const c = FOCUS_COPY[lang]
  const [focus, setFocus] = useState<CurrentFocus | null>(null)

  useEffect(() => {
    if (editMode) return
    let cancelled = false
    const load = () => {
      fetch(`${API_BASE}/api/public/current-focus`)
        .then(res => { if (!res.ok) throw new Error(String(res.status)); return res.json() })
        .then((data: CurrentFocus) => { if (!cancelled) setFocus(data) })
        .catch(() => { /* silent — a slim badge isn't worth an error state of its own */ })
    }
    load()
    const id = window.setInterval(load, POLL_MS)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [editMode])

  if (editMode) {
    return (
      <div className={reveal('site-focus-badge')}>
        <span className="site-focus-dot" aria-hidden="true" />
        <span>{c.label}: —</span>
      </div>
    )
  }
  if (focus === null) return null

  const level = focus.active_level ? LEVEL_LABEL[focus.active_level] ?? focus.active_level : null
  const category = focus.active_category ? capitalize(focus.active_category) : null

  return (
    <div className={reveal('site-focus-badge')}>
      <span className="site-focus-dot" aria-hidden="true" />
      <span className="site-focus-eyebrow">{c.label}:</span>{' '}
      <span>
        {level && category ? c.withBoth(level, category) : level ? c.levelOnly(level) : category ? c.categoryOnly(category) : c.quiet}
      </span>
    </div>
  )
}

// ── /api/public/signal-levels ───────────────────────────────────────────────
// Shape returned by GET /api/public/signal-levels (see
// backend/src/public.rs::signal_levels / SignalLevels) — four bare per-level
// counts, never signal content.
interface SignalLevels {
  human: number
  ai: number
  interaction: number
  system: number
}

const SIGNAL_LEVELS_COPY = {
  en: {
    eyebrow: 'Observatory',
    title: 'What kind of emergence is showing up',
    intro: 'Every detected signal is sorted into one of four levels — this is the live count in each, not what any single signal says.',
    loading: 'Loading signal counts…',
    unavailable: 'Signal counts are temporarily unavailable.',
    ariaPrefix: 'Emergence signal counts by level:',
  },
  de: {
    eyebrow: 'Observatory',
    title: 'Welche Art von Emergenz sich zeigt',
    intro: 'Jedes erkannte Signal wird einer von vier Ebenen zugeordnet — das ist die laufende Anzahl je Ebene, nicht der Inhalt eines einzelnen Signals.',
    loading: 'Signal-Zahlen werden geladen…',
    unavailable: 'Signal-Zahlen sind gerade nicht verfügbar.',
    ariaPrefix: 'Emergenz-Signale nach Ebene:',
  },
} as const

const SIGNAL_LEVEL_ORDER: Array<{ key: keyof SignalLevels; label: string }> = [
  { key: 'human', label: 'Human' },
  { key: 'ai', label: 'AI' },
  { key: 'interaction', label: 'Interaction' },
  { key: 'system', label: 'System' },
]

/**
 * Horizontal bar row per signal level — magnitude comparison across 4 fixed,
 * already-labeled categories, so one hue (var(--primary), the same accent
 * already used for stat-tile borders elsewhere on this page) carries all
 * four bars; identity comes from the adjacent text label, not from color.
 */
export function SignalLevelsSection({ editMode, reveal }: { editMode: boolean; reveal: (cls: string) => string }) {
  const { lang } = useLang()
  const c = SIGNAL_LEVELS_COPY[lang]
  const [levels, setLevels] = useState<SignalLevels | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (editMode) return
    let cancelled = false
    const load = () => {
      fetch(`${API_BASE}/api/public/signal-levels`)
        .then(res => { if (!res.ok) throw new Error(String(res.status)); return res.json() })
        .then((data: SignalLevels) => { if (!cancelled) { setLevels(data); setError(false) } })
        .catch(() => { if (!cancelled) setError(true) })
    }
    load()
    const id = window.setInterval(load, POLL_MS)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [editMode])

  const data: SignalLevels = levels ?? { human: 0, ai: 0, interaction: 0, system: 0 }
  const max = Math.max(1, ...SIGNAL_LEVEL_ORDER.map(l => data[l.key]))
  const total = SIGNAL_LEVEL_ORDER.reduce((s, l) => s + data[l.key], 0)
  const ariaLabel = `${c.ariaPrefix} ${SIGNAL_LEVEL_ORDER.map(l => `${l.label} ${data[l.key]}`).join(', ')}`

  return (
    <section className={reveal('site-section site-signal-levels')} id="signal-levels">
      <div className="site-eyebrow">{c.eyebrow}</div>
      <h2 className="site-section-title">{c.title}</h2>
      <p className="site-livestats-intro">{c.intro}</p>

      {!editMode && levels === null && !error && <p className="site-livestats-status">{c.loading}</p>}
      {!editMode && error && <p className="site-livestats-status">{c.unavailable}</p>}
      {(editMode || (levels !== null && !error)) && (
        <div className="site-signal-bars" role="img" aria-label={ariaLabel}>
          {SIGNAL_LEVEL_ORDER.map(l => {
            const count = data[l.key]
            const pct = total === 0 ? 0 : Math.max(count > 0 ? 4 : 0, (count / max) * 100)
            return (
              <div className="site-signal-bar-row" key={l.key}>
                <span className="site-signal-bar-label">{l.label}</span>
                <div className="site-signal-bar-track">
                  <div className="site-signal-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="site-signal-bar-value">{count.toLocaleString(lang === 'de' ? 'de-AT' : 'en-IE')}</span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ── /api/public/ccet-trend ──────────────────────────────────────────────────
// Shape returned by GET /api/public/ccet-trend (see
// backend/src/public.rs::ccet_trend / CcetTrendResp) — day-bucketed CEI and
// Resonance-Frequency scalars + a turn count. Never the ccet_turns embedding
// BLOB, never a per-turn similarity value, never a conversation id.
interface CcetTrendPoint {
  date: string
  cei: number
  resonance_frequency: number
  turns: number
}
interface CcetTrendResp {
  window_days: number
  points: CcetTrendPoint[]
}

const CCET_TREND_COPY = {
  en: {
    eyebrow: 'Observatory',
    title: 'Co-evolution health, over time',
    intro: (days: number) => `Daily average across the last ${days} days — how often the model's turns stay stable and reuse its own framework vocabulary, not any single conversation.`,
    cei: 'Continuous Evolution Index (CEI)',
    resonance: 'Resonance Frequency',
    loading: 'Loading the trend…',
    unavailable: 'The co-evolution trend is temporarily unavailable.',
    notEnoughData: 'Not enough turns yet to show a trend.',
    ariaLabel: (cei: number, res: number) => `CEI trend, currently ${Math.round(cei * 100)} percent; Resonance Frequency, currently ${Math.round(res * 100)} percent`,
  },
  de: {
    eyebrow: 'Observatory',
    title: 'Co-Evolution im Zeitverlauf',
    intro: (days: number) => `Tagesdurchschnitt über die letzten ${days} Tage — wie oft die Antworten des Modells stabil bleiben und sein eigenes Framework-Vokabular wiederverwenden, nicht ein einzelnes Gespräch.`,
    cei: 'Continuous Evolution Index (CEI)',
    resonance: 'Resonance Frequency',
    loading: 'Trend wird geladen…',
    unavailable: 'Der Co-Evolution-Trend ist gerade nicht verfügbar.',
    notEnoughData: 'Noch nicht genug Turns für einen Trend.',
    ariaLabel: (cei: number, res: number) => `CEI-Trend, aktuell ${Math.round(cei * 100)} Prozent; Resonance Frequency, aktuell ${Math.round(res * 100)} Prozent`,
  },
} as const

const CCET_CHART_W = 640
const CCET_CHART_H = 160
const CCET_PAD = 10

function ccetPath(values: number[]): string {
  if (values.length === 0) return ''
  const stepX = values.length > 1 ? (CCET_CHART_W - CCET_PAD * 2) / (values.length - 1) : 0
  return values
    .map((v, i) => {
      const x = CCET_PAD + i * stepX
      const y = CCET_PAD + (1 - Math.max(0, Math.min(1, v))) * (CCET_CHART_H - CCET_PAD * 2)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

/**
 * Small two-series trend line (CEI solid, Resonance Frequency dashed — the
 * dash, not just color, carries identity so the two stay distinguishable
 * under the high-contrast theme where both would otherwise render the same
 * amber). Reuses var(--primary) and var(--accent-purple), the site's
 * existing primary/secondary accent pair, rather than a new palette.
 */
export function CcetTrendSection({ editMode, reveal }: { editMode: boolean; reveal: (cls: string) => string }) {
  const { lang } = useLang()
  const c = CCET_TREND_COPY[lang]
  const [resp, setResp] = useState<CcetTrendResp | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (editMode) return
    let cancelled = false
    const load = () => {
      fetch(`${API_BASE}/api/public/ccet-trend`)
        .then(res => { if (!res.ok) throw new Error(String(res.status)); return res.json() })
        .then((data: CcetTrendResp) => { if (!cancelled) { setResp(data); setError(false) } })
        .catch(() => { if (!cancelled) setError(true) })
    }
    load()
    const id = window.setInterval(load, POLL_MS)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [editMode])

  const points = resp?.points ?? []
  const hasData = points.length >= 2
  const ceiPath = hasData ? ccetPath(points.map(p => p.cei)) : ''
  const resPath = hasData ? ccetPath(points.map(p => p.resonance_frequency)) : ''
  const last = points[points.length - 1]

  return (
    <section className={reveal('site-section site-ccet-trend')} id="ccet-trend">
      <div className="site-eyebrow">{c.eyebrow}</div>
      <h2 className="site-section-title">{c.title}</h2>
      <p className="site-livestats-intro">{c.intro(resp?.window_days ?? 14)}</p>

      {!editMode && resp === null && !error && <p className="site-livestats-status">{c.loading}</p>}
      {!editMode && error && <p className="site-livestats-status">{c.unavailable}</p>}
      {!editMode && resp !== null && !error && !hasData && <p className="site-livestats-status">{c.notEnoughData}</p>}

      {(editMode || (hasData && !error)) && (
        <div className="site-ccet-chart-wrap">
          <svg
            className="site-ccet-chart"
            viewBox={`0 0 ${CCET_CHART_W} ${CCET_CHART_H}`}
            preserveAspectRatio="none"
            role={hasData ? 'img' : undefined}
            aria-label={hasData && last ? c.ariaLabel(last.cei, last.resonance_frequency) : undefined}
          >
            {/* recessive midline, one step off the surface */}
            <line x1={CCET_PAD} y1={CCET_CHART_H / 2} x2={CCET_CHART_W - CCET_PAD} y2={CCET_CHART_H / 2} className="site-ccet-gridline" />
            {editMode ? (
              <text x={CCET_CHART_W / 2} y={CCET_CHART_H / 2} textAnchor="middle" className="site-ccet-placeholder-text">···</text>
            ) : (
              <>
                <path d={resPath} className="site-ccet-line-resonance" fill="none" />
                <path d={ceiPath} className="site-ccet-line-cei" fill="none" />
                {last && (
                  <>
                    <circle cx={CCET_CHART_W - CCET_PAD} cy={CCET_PAD + (1 - last.resonance_frequency) * (CCET_CHART_H - CCET_PAD * 2)} r="4" className="site-ccet-dot-resonance">
                      <title>{c.resonance}: {Math.round(last.resonance_frequency * 100)}%</title>
                    </circle>
                    <circle cx={CCET_CHART_W - CCET_PAD} cy={CCET_PAD + (1 - last.cei) * (CCET_CHART_H - CCET_PAD * 2)} r="4" className="site-ccet-dot-cei">
                      <title>{c.cei}: {Math.round(last.cei * 100)}%</title>
                    </circle>
                  </>
                )}
              </>
            )}
          </svg>
          <div className="site-ccet-legend">
            <span className="site-ccet-legend-item"><span className="site-ccet-swatch site-ccet-swatch-cei" />{c.cei}{last && !editMode ? ` — ${Math.round(last.cei * 100)}%` : ''}</span>
            <span className="site-ccet-legend-item"><span className="site-ccet-swatch site-ccet-swatch-resonance" />{c.resonance}{last && !editMode ? ` — ${Math.round(last.resonance_frequency * 100)}%` : ''}</span>
          </div>
        </div>
      )}
    </section>
  )
}

// ── /api/public/simulation-status ───────────────────────────────────────────
// Shape returned by GET /api/public/simulation-status (see
// backend/src/public.rs::simulation_status / SimulationStatusTally) — three
// bare per-status counts, never hypothesis/narrative content.
interface SimulationStatusTally {
  pending: number
  complete: number
  error: number
}

const SIMULATION_STATUS_COPY = {
  en: {
    eyebrow: 'Simulation Lab',
    title: 'Hypotheses being explored',
    intro: 'Every simulation run the lab has kicked off, by where it currently stands — not what any hypothesis says.',
    pending: 'Running',
    complete: 'Complete',
    error: 'Errored',
    loading: 'Loading run counts…',
    unavailable: 'Run counts are temporarily unavailable.',
  },
  de: {
    eyebrow: 'Simulation Lab',
    title: 'Untersuchte Hypothesen',
    intro: 'Jeder gestartete Simulationslauf, nach aktuellem Stand — nicht der Inhalt einer Hypothese.',
    pending: 'Läuft',
    complete: 'Abgeschlossen',
    error: 'Fehlgeschlagen',
    loading: 'Lauf-Zahlen werden geladen…',
    unavailable: 'Lauf-Zahlen sind gerade nicht verfügbar.',
  },
} as const

// Same 3 hex values as SimulationLab.tsx's own STATUS_ACCENT (admin
// Observatory) — kept as a second, small local copy rather than importing an
// admin-only component into the public bundle, but deliberately the same
// pending/complete/error color semantics so the two surfaces agree.
const SIM_STATUS_ACCENT: Record<keyof SimulationStatusTally, string> = { pending: '#f59e0b', complete: '#10b981', error: '#ef4444' }

/**
 * Three-tile status tally — same tile shell as LiveStatsSection above, each
 * tile's top border carrying the status color (not the number/text, which
 * stay in text tokens) so status reads by more than a swatch alone.
 */
export function SimulationStatusSection({ editMode, reveal }: { editMode: boolean; reveal: (cls: string) => string }) {
  const { lang } = useLang()
  const c = SIMULATION_STATUS_COPY[lang]
  const [tally, setTally] = useState<SimulationStatusTally | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (editMode) return
    let cancelled = false
    const load = () => {
      fetch(`${API_BASE}/api/public/simulation-status`)
        .then(res => { if (!res.ok) throw new Error(String(res.status)); return res.json() })
        .then((data: SimulationStatusTally) => { if (!cancelled) { setTally(data); setError(false) } })
        .catch(() => { if (!cancelled) setError(true) })
    }
    load()
    const id = window.setInterval(load, POLL_MS)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [editMode])

  const tiles: Array<{ key: keyof SimulationStatusTally; label: string }> = [
    { key: 'pending', label: c.pending },
    { key: 'complete', label: c.complete },
    { key: 'error', label: c.error },
  ]
  const fmt = (n: number) => n.toLocaleString(lang === 'de' ? 'de-AT' : 'en-IE')

  return (
    <section className={reveal('site-section site-livestats site-simulation-status')} id="simulation-status">
      <div className="site-eyebrow">{c.eyebrow}</div>
      <h2 className="site-section-title">{c.title}</h2>
      <p className="site-livestats-intro">{c.intro}</p>

      {!editMode && tally === null && !error && <p className="site-livestats-status">{c.loading}</p>}
      {!editMode && error && <p className="site-livestats-status">{c.unavailable}</p>}
      {(editMode || (tally !== null && !error)) && (
        <div className="site-livestats-grid site-livestats-grid-3">
          {tiles.map(tile => (
            <div className="site-livestats-tile" key={tile.key} style={{ borderTopColor: SIM_STATUS_ACCENT[tile.key] }}>
              <strong>{tally ? fmt(tally[tile.key]) : '—'}</strong>
              <span>{tile.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
