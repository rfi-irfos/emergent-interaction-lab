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
